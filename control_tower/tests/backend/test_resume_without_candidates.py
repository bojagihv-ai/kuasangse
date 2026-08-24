from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

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


def _prepared(bridge: FactorySyncBridge, suffix: str) -> str:
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix=suffix))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    return job_id


def test_resume_regenerates_when_the_waiting_stage_has_no_candidates(tmp_path: Path) -> None:
    """고를 후보가 하나도 없으면 결정을 요구하지 말고 다시 돌려야 한다.

    워커가 죽은 뒤 복원하면 후보가 없는 이른 시점으로 돌아갈 수 있다. 그때도 결정을
    요구하면 재개도 후보 생성도 못 해 작업이 영영 갇힌다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id = _prepared(bridge, "nocand")

    empty = _product_projection(job_id, sequence=120, revision=24)
    for stage in empty["stages"]:
        stage["candidates"] = []
        stage["selectedIds"] = []
    bridge.accept_session_projection(_envelope(empty, cursor=30))

    resumed = bridge.resume_product(job_id)
    assert resumed["status"] in {"queued", "running"}, f"재개되지 않았습니다: {resumed['status']}"


def test_resume_still_demands_a_decision_while_candidates_are_waiting(tmp_path: Path) -> None:
    """고를 후보가 있는데 아직 안 골랐다면 종전대로 결정을 요구한다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id = _prepared(bridge, "withcand")

    waiting = _product_projection(job_id, sequence=120, revision=24)
    waiting["stages"][0]["selectedIds"] = []
    assert waiting["stages"][0]["candidates"], "이 시험은 후보가 있는 상태를 전제로 한다"
    bridge.accept_session_projection(_envelope(waiting, cursor=30))

    assert _job(bridge, job_id)["status"] == "waiting_manual"
    with pytest.raises(FactorySyncError) as raised:
        bridge.resume_product(job_id)
    assert raised.value.code == "factory_decision_required"
