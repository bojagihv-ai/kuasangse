from __future__ import annotations

from pathlib import Path
from typing import Any

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import (
    _hello,
    _manual_product_job_payload,
    _product_checkpoint,
    _product_projection,
)
from test_parallel_production_board import _live_worker, _run_to_waiting_manual


def _complete_cut_order(
    bridge: FactorySyncBridge,
    *,
    projection: dict[str, Any],
    candidate_id: str,
    extra: dict[str, Any],
) -> None:
    """조립공장이 선택 주문을 수행하고 영수증을 돌려준 상황을 만든다."""
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
                **extra,
            },
        },
    )


def _prepared(bridge: FactorySyncBridge, suffix: str) -> str:
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix=suffix))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    return job_id


def test_selection_receipt_updates_the_job_checkpoint(tmp_path: Path) -> None:
    """A컷 선택이 작업 체크포인트에 남아야 다음 실행이 선택을 잃지 않는다.

    남기지 않으면 다음 실행이 선택 이전 체크포인트를 복원해 방금 고른 컷이 사라지고
    factory_decision_required 로 작업이 통째로 막힌다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id = _prepared(bridge, "ckpt")
    before = bridge._product_jobs[job_id].checkpoint
    assert before is not None

    bridge.reserve_product_selection(
        job_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    applied = _product_projection(job_id, sequence=120, revision=24)
    applied["stages"][0]["selectedIds"] = ["representative-b"]
    checkpoint = _product_checkpoint(
        job_id,
        applied,
        status="waiting_manual",
        stage_key="representative",
    )
    _complete_cut_order(
        bridge,
        projection=applied,
        candidate_id="representative-b",
        extra={"status": "waiting_manual", "checkpoint": checkpoint},
    )

    after = bridge._product_jobs[job_id].checkpoint
    assert after is not None
    assert after["revision"] == 24, "선택 이후 체크포인트가 갱신되지 않았습니다"
    assert after["revision"] != before["revision"]


def test_a_receipt_without_a_checkpoint_leaves_the_previous_one(tmp_path: Path) -> None:
    """체크포인트를 함께 보내지 않는 조립공장도 기존처럼 동작해야 한다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id = _prepared(bridge, "nockpt")
    before = bridge._product_jobs[job_id].checkpoint
    assert before is not None

    bridge.reserve_product_selection(
        job_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    applied = _product_projection(job_id, sequence=120, revision=24)
    applied["stages"][0]["selectedIds"] = ["representative-b"]
    _complete_cut_order(
        bridge,
        projection=applied,
        candidate_id="representative-b",
        extra={},
    )

    assert bridge._product_jobs[job_id].checkpoint == before
