from __future__ import annotations

from pathlib import Path
from typing import Any

from flask import Flask

from control_tower.backend.factory_sync import FactorySyncBridge
from control_tower.backend.routes import register_routes

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _live_worker, _run_to_waiting_manual


def _waiting_bridge(tmp_path: Path, count: int) -> tuple[FactorySyncBridge, list[str]]:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_ids = [
        str(bridge.queue_product(_manual_product_job_payload(suffix=f"route-{index}"))["jobId"])
        for index in range(count)
    ]
    for index, job_id in enumerate(job_ids):
        order = bridge.claim(_live_worker())["order"]
        _run_to_waiting_manual(bridge, order, job_id, sequence=8 + index * 10)
    return bridge, job_ids


def _client(bridge: FactorySyncBridge) -> tuple[Any, dict[str, str]]:
    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    return client, {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }


def test_batch_selection_reserves_every_waiting_product_in_one_request(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 4)
    client, headers = _client(bridge)

    response = client.post(
        "/api/factory/jobs/selections",
        json={
            "mode": "manual",
            "selections": [
                {"jobId": job_id, "stageKey": "representative", "candidateId": "representative-b"}
                for job_id in job_ids
            ],
        },
        headers=headers,
    )
    body = response.get_json()

    assert response.status_code == 200
    assert body["schema"] == "factory-batch-selection:v1"
    assert body["failed"] == 0
    assert body["applied"] + body["reserved"] == 4
    assert body["applied"] == 1
    assert {result["jobId"] for result in body["results"]} == set(job_ids)
    assert all(result["candidateId"] == "representative-b" for result in body["results"])


def test_batch_selection_infers_the_waiting_stage_for_each_product(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 2)
    client, headers = _client(bridge)

    response = client.post(
        "/api/factory/jobs/selections",
        json={
            "mode": "manual",
            "selections": [
                {"jobId": job_id, "candidateId": "representative-b"} for job_id in job_ids
            ],
        },
        headers=headers,
    )
    body = response.get_json()

    assert response.status_code == 200
    assert all(result["stageKey"] == "representative" for result in body["results"])
    assert body["failed"] == 0


def test_batch_selection_reports_bad_entries_without_dropping_the_good_ones(
    tmp_path: Path,
) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 2)
    client, headers = _client(bridge)

    response = client.post(
        "/api/factory/jobs/selections",
        json={
            "mode": "manual",
            "selections": [
                {"jobId": job_ids[0], "stageKey": "representative", "candidateId": "representative-b"},
                {"jobId": "factory-job-does-not-exist", "stageKey": "representative", "candidateId": "x"},
                {"jobId": job_ids[1], "stageKey": "representative", "candidateId": "nope"},
            ],
        },
        headers=headers,
    )
    body = response.get_json()
    by_job = {result["jobId"]: result for result in body["results"]}

    assert response.status_code == 200
    assert body["failed"] == 2
    assert by_job[job_ids[0]]["status"] in {"applied", "reserved"}
    assert by_job["factory-job-does-not-exist"]["status"] == "error"
    assert by_job[job_ids[1]]["reason"] == "candidate_membership_invalid"


def test_batch_selection_requires_the_session_csrf_pair(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 1)
    client, _ = _client(bridge)

    response = client.post(
        "/api/factory/jobs/selections",
        json={
            "mode": "manual",
            "selections": [
                {"jobId": job_ids[0], "stageKey": "representative", "candidateId": "representative-b"},
            ],
        },
    )

    assert response.status_code == 428


def test_reserved_selection_can_be_cleared_over_http(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 2)
    client, headers = _client(bridge)
    client.post(
        "/api/factory/jobs/selections",
        json={
            "mode": "manual",
            "selections": [
                {"jobId": job_ids[0], "stageKey": "representative", "candidateId": "representative-b"},
            ],
        },
        headers=headers,
    )

    cleared = client.post(
        f"/api/factory/jobs/{job_ids[0]}/selection/clear",
        json={},
        headers=headers,
    )

    assert cleared.status_code == 200
    assert cleared.get_json()["status"] == "cleared"
    board = client.get("/api/factory/jobs").get_json()
    target = next(job for job in board["jobs"] if job["jobId"] == job_ids[0])
    assert "pendingSelection" not in target


def test_board_endpoint_exposes_progress_for_every_product(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 3)
    client, _ = _client(bridge)

    board = client.get("/api/factory/jobs").get_json()

    assert [job["jobId"] for job in board["jobs"]] == job_ids
    for job in board["jobs"]:
        assert job["progress"]["schema"] == "factory-product-progress:v1"
        assert job["progress"]["totalStageCount"] == 6
        assert isinstance(job["progress"]["stages"], list)
        assert "dispatched" in job
