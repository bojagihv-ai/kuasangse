from __future__ import annotations

from pathlib import Path
from typing import Any

from flask import Flask

from control_tower.backend.factory_sync import FactorySyncBridge
from control_tower.backend.policy import build_policy_snapshot
from control_tower.backend.routes import register_routes
from control_tower.backend.runtime_cache import JsonObject

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _live_worker, _run_to_waiting_manual


class RecordingJudge:
    """GPT OAuth 판단을 대신해 두 번째 후보를 고르는 시험용 판정자."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def judge(self, **kwargs: Any) -> JsonObject:
        self.calls.append(kwargs)
        selected = str(kwargs["candidates"][1]["candidateId"])
        return {
            "receipt": {
                "model": "gpt-test",
                "reasoningEffort": kwargs["reasoning_effort"],
                "serviceTier": kwargs["service_tier"],
                "preset": kwargs["preset"],
                "judgement": {
                    "decision": "selected",
                    "selectedCandidateId": selected,
                    "confidence": 0.91,
                    "scoreGap": 0.2,
                    "riskFlags": [],
                    "rationale": "후보 증거 비교",
                    "scores": {
                        "sameProductLikelihood": 0.9,
                        "taskSuitability": 0.9,
                        "quality": 0.85,
                    },
                },
                "evidence": {},
            },
        }


class HoldingJudge(RecordingJudge):
    """자동 판단이 확신하지 못해 사람에게 넘기는 경우."""

    def judge(self, **kwargs: Any) -> JsonObject:
        receipt = super().judge(**kwargs)
        judgement = receipt["receipt"]["judgement"]
        judgement["decision"] = "hold"
        judgement["confidence"] = 0.2
        judgement["scoreGap"] = 0.01
        return receipt


def _payload_with_policy(suffix: str) -> dict[str, Any]:
    payload = _manual_product_job_payload(suffix=suffix)
    payload["policySnapshot"] = build_policy_snapshot(
        str(payload["batchId"]),
        str(payload["productName"]),
        "full_auto",
        {},
        {},
        {},
    )
    return payload


def _run_to_waiting_manual_with_digests(
    bridge: FactorySyncBridge,
    order: dict[str, Any],
    job_id: str,
    *,
    sequence: int,
) -> None:
    """실제 조립공장처럼 contentDigest 를 갖춘 후보를 보고해 자동 판단이 가능한 상태로 만든다."""
    import test_factory_sync as fixtures

    original = fixtures._live_projection

    def with_digests(**kwargs: Any) -> dict[str, Any]:
        projection = original(**kwargs)
        for candidate in projection["stages"][0]["candidates"]:
            candidate["digest"] = f"sha256:{candidate['id']}"
            candidate["assetId"] = candidate["id"]
        return projection

    fixtures._live_projection = with_digests
    try:
        _run_to_waiting_manual(bridge, order, job_id, sequence=sequence)
    finally:
        fixtures._live_projection = original


def _waiting_bridge(tmp_path: Path, count: int) -> tuple[FactorySyncBridge, list[str]]:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_ids = [
        str(bridge.queue_product(_payload_with_policy(f"auto-{index}"))["jobId"])
        for index in range(count)
    ]
    for index, job_id in enumerate(job_ids):
        order = bridge.claim(_live_worker())["order"]
        _run_to_waiting_manual_with_digests(bridge, order, job_id, sequence=8 + index * 10)
    return bridge, job_ids


def _client(bridge: FactorySyncBridge, judge: RecordingJudge) -> tuple[Any, dict[str, str]]:
    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=bridge, gpt_judge=judge)
    client = app.test_client()
    meta = client.get("/api/session").get_json()
    return client, {
        "X-Control-Tower-CSRF": meta["csrfToken"],
        "X-Control-Tower-Session": meta["sessionId"],
    }


def test_auto_batch_selection_picks_a_cut_for_every_waiting_product(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 3)
    judge = RecordingJudge()
    client, headers = _client(bridge, judge)

    response = client.post("/api/factory/jobs/selections", json={"mode": "auto"}, headers=headers)
    body = response.get_json()

    assert response.status_code == 200
    assert body["mode"] == "auto"
    assert body["failed"] == 0
    assert body["skipped"] == 0
    assert body["applied"] + body["reserved"] == 3
    assert len(judge.calls) == 3
    assert {result["candidateId"] for result in body["results"]} == {"representative-b"}
    assert all(result["stageKey"] == "representative" for result in body["results"])
    receipts = [result["decisionReceipt"] for result in body["results"]]
    assert all(receipt["decisionMethod"] == "gpt_oauth_single_review" for receipt in receipts)
    assert all(receipt["selectedCandidateId"] == "representative-b" for receipt in receipts)
    assert all(receipt["decisionType"] == "representative_image" for receipt in receipts)
    assert all(receipt["policySnapshotId"].startswith("policy:") for receipt in receipts)
    board = {job["jobId"]: job for job in bridge.product_jobs()}
    reserved = [job for job in board.values() if "pendingSelection" in job]
    assert len(reserved) == 3
    assert all(job["pendingSelection"]["decisionMode"] == "auto" for job in reserved)
    assert set(board) == set(job_ids)


def test_auto_batch_selection_leaves_uncertain_products_for_a_person(tmp_path: Path) -> None:
    bridge, _ = _waiting_bridge(tmp_path, 2)
    client, headers = _client(bridge, HoldingJudge())

    body = client.post("/api/factory/jobs/selections", json={"mode": "auto"}, headers=headers).get_json()

    assert body["applied"] == 0
    assert body["reserved"] == 0
    assert body["skipped"] == 2
    assert all(result["status"] == "skipped" for result in body["results"])
    assert all("pendingSelection" not in job for job in bridge.product_jobs())


def test_auto_batch_selection_can_target_named_products_only(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 3)
    judge = RecordingJudge()
    client, headers = _client(bridge, judge)

    body = client.post(
        "/api/factory/jobs/selections",
        json={"mode": "auto", "jobIds": job_ids[:2]},
        headers=headers,
    ).get_json()

    assert len(judge.calls) == 2
    assert {result["jobId"] for result in body["results"]} == set(job_ids[:2])
    assert body["failed"] == 0


def test_auto_batch_selection_skips_products_without_an_automation_policy(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="no-policy"))["jobId"])
    order = bridge.claim(_live_worker())["order"]
    _run_to_waiting_manual_with_digests(bridge, order, job_id, sequence=8)
    judge = RecordingJudge()
    client, headers = _client(bridge, judge)

    body = client.post("/api/factory/jobs/selections", json={"mode": "auto"}, headers=headers).get_json()

    assert body["skipped"] == 1
    assert body["results"][0]["reason"] == "policy_snapshot_missing"
    assert judge.calls == []
