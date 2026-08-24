from __future__ import annotations

from pathlib import Path
from typing import Any

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload, _product_projection
from test_parallel_production_board import _job, _live_worker, _run_to_waiting_manual


def _envelope(projection: dict[str, Any], *, cursor: int) -> dict[str, Any]:
    return {
        "schema": "factory-worker-session:v1",
        "sessionId": "factory-session-live",
        "workerId": "factory-worker-live",
        "buildId": "build-live",
        "capabilityVersion": "batch-control-worker:v1",
        "factoryCapabilityVersion": "factory-control-command:v1",
        "startedAt": 1000,
        "cursor": cursor,
        "projection": projection,
    }


def _apply_cut(
    bridge: FactorySyncBridge,
    job_id: str,
    *,
    candidate_id: str,
    projection: dict[str, Any],
) -> None:
    """조립공장이 선택 주문을 수행하고 주어진 화면 상태를 보고한 상황을 만든다."""
    worker = _live_worker()
    order = None
    for _ in range(4):
        order = bridge.claim(worker)["order"]
        if order is None or order["command"]["name"] == "selectFactoryACut":
            break
    assert order is not None and order["command"]["name"] == "selectFactoryACut"
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    bridge.lifecycle(
        order["orderId"],
        "complete",
        {
            **order,
            "workerId": worker["workerId"],
            "eventSequence": 2,
            "result": {
                "schema": "factory-a-cut-receipt:v1",
                "stageKey": "representative",
                "candidateId": candidate_id,
                "projection": projection,
            },
        },
    )


def _prepared(bridge: FactorySyncBridge) -> str:
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="wait"))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    return job_id


def test_auto_resume_holds_until_the_factory_shows_the_selection(tmp_path: Path) -> None:
    """조립공장이 선택을 아직 화면에 반영하지 않았으면 다음 단계로 넘기지 않는다.

    이 확인 없이 재개하면 factory_decision_required 로 작업이 통째로 막힌다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id = _prepared(bridge)
    bridge.reserve_product_selection(
        job_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    # 조립공장이 선택 직후 빈 화면 상태를 보고한다(작업파일을 닫은 직후 등).
    blank = _product_projection(job_id, sequence=80, revision=20)
    for stage in blank["stages"]:
        stage["selectedIds"] = []
        stage["candidates"] = []
    _apply_cut(bridge, job_id, candidate_id="representative-b", projection=blank)

    held = _job(bridge, job_id)
    assert held["status"] == "waiting_manual", f"너무 일찍 재개했습니다: {held['message']}"
    # 아직 반영 전이므로 자동 진행 의도는 살아 있어야 다음 기회에 이어진다.
    assert held["autoResumePending"] is True

    # 조립공장이 선택을 반영한 화면을 보고하면 그때 다음 단계로 넘어간다.
    applied = _product_projection(job_id, sequence=120, revision=24)
    applied["stages"][0]["selectedIds"] = ["representative-b"]
    bridge.accept_session_projection(_envelope(applied, cursor=30))

    moved = _job(bridge, job_id)
    assert moved["status"] == "queued"
    assert moved["autoResumePending"] is False


def test_auto_resume_still_advances_when_the_selection_is_already_visible(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id = _prepared(bridge)
    bridge.reserve_product_selection(
        job_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    applied = _product_projection(job_id, sequence=80, revision=20)
    applied["stages"][0]["selectedIds"] = ["representative-b"]
    _apply_cut(bridge, job_id, candidate_id="representative-b", projection=applied)

    moved = _job(bridge, job_id)
    assert moved["status"] == "queued"
    assert moved["autoResumePending"] is False
    assert "pendingSelection" not in moved
