from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_factory_sync import (
    _hello,
    _manual_product_job_payload,
    _product_checkpoint,
    _product_projection,
)
from test_parallel_production_board import _job, _live_worker


def _session_envelope(projection: dict[str, Any], *, cursor: int) -> dict[str, Any]:
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


def test_a_first_run_result_survives_the_periodic_sync_revision_race(tmp_path: Path) -> None:
    """조립공장이 오래 돌면 주기 동기화가 revision 을 먼저 올린다.

    그 사이 만들어진 결과는 낮은 revision 을 달고 도착하는데, 같은 작업의 결과라면
    버리지 말고 받아야 한다. 버리면 실제로 생성한 컷이 통째로 사라진다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="race"))["jobId"])
    order = bridge.claim(_live_worker())["order"]
    assert order["command"]["payload"]["restoreOnly"] is False
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": "factory-worker-live", "accepted": True, "eventSequence": 1},
    )

    # 실행이 도는 동안 주기 동기화가 먼저 도착해 revision 을 12 까지 올린다.
    ahead = _product_projection(job_id, sequence=40, revision=12)
    bridge.accept_session_projection(_session_envelope(ahead, cursor=9))
    assert bridge.current_state()["session"]["revision"] == 12

    # 실행 결과는 그보다 낮은 revision(5)을 달고 뒤늦게 도착한다.
    behind = _product_projection(job_id, sequence=60, revision=5)
    behind["stages"][0]["selectedIds"] = []
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": job_id,
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": behind,
        "checkpoint": _product_checkpoint(
            job_id,
            behind,
            status="waiting_manual",
            stage_key="representative",
        ),
    }
    body = {**order, "workerId": "factory-worker-live", "eventSequence": 2, "result": receipt}
    bridge.lifecycle(order["orderId"], "events", body)
    bridge.lifecycle(order["orderId"], "complete", body)

    job = _job(bridge, job_id)
    assert job["status"] == "waiting_manual", f"결과가 버려졌습니다: {job['message']}"
    assert job["stageKey"] == "representative"
    assert job["checkpointAvailable"] is True
    assert job["progress"]["stages"][0]["candidateCount"] == 2


def test_another_products_late_result_is_still_rejected(tmp_path: Path) -> None:
    """신원이 다른 결과는 revision 이 낮으면 그대로 거부해야 한다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="foreign"))["jobId"])
    order = bridge.claim(_live_worker())["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": "factory-worker-live", "accepted": True, "eventSequence": 1},
    )
    bridge.accept_session_projection(
        _session_envelope(_product_projection(job_id, sequence=40, revision=12), cursor=9),
    )

    # 같은 작업이라고 주장하지만 입력 지문이 다른 결과를 보낸다.
    foreign = _product_projection(job_id, sequence=60, revision=5)
    foreign["session"]["inputFingerprint"] = "sha256:someone-else"
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": job_id,
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": foreign,
        "checkpoint": _product_checkpoint(
            job_id,
            foreign,
            status="waiting_manual",
            stage_key="representative",
        ),
    }
    body = {**order, "workerId": "factory-worker-live", "eventSequence": 2, "result": receipt}

    bridge.lifecycle(order["orderId"], "events", body)
    with pytest.raises(FactorySyncError) as error:
        bridge.lifecycle(order["orderId"], "complete", body)
    assert error.value.code == "stale_run_fingerprint"
    # 거부된 결과가 작업 상태를 오염시키지 않는다.
    job = _job(bridge, job_id)
    assert job["status"] == "running"
    assert job["checkpointAvailable"] is False
