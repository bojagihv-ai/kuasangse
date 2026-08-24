from __future__ import annotations

from pathlib import Path
from typing import Any

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload, _product_projection
from test_parallel_production_board import _live_worker, _run_to_waiting_manual


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


def _pending_cut_orders(bridge: FactorySyncBridge) -> list[str]:
    return [
        str(execution.order["orderId"])
        for execution in bridge._executions.values()
        if execution.order.get("command", {}).get("name") == "selectFactoryACut"
        and execution.status in {"pending", "claimed", "acknowledged", "running"}
    ]


def test_one_reservation_never_issues_two_cut_orders(tmp_path: Path) -> None:
    """작업파일 판이 올라가도 같은 예약으로 선택 주문을 두 번 내지 않는다.

    두 번 내면 조립공장이 같은 선택을 두 번 수행하고, 두 번째 완료 직후
    아직 반영되지 않은 화면 상태에서 다음 단계가 시도되어 작업이 막힌다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="dup"))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)

    bridge.reserve_product_selection(
        job_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    assert len(_pending_cut_orders(bridge)) == 1

    # 주기 동기화가 판을 올리며 여러 번 도착해도 주문은 하나로 유지되어야 한다.
    for index, revision in enumerate((30, 31, 32), start=1):
        moved = _product_projection(job_id, sequence=100 + index * 10, revision=revision)
        moved["stages"][0]["selectedIds"] = []
        bridge.accept_session_projection(_envelope(moved, cursor=10 + index))

    assert len(_pending_cut_orders(bridge)) == 1, "같은 예약으로 선택 주문이 여러 번 나갔습니다"


def test_a_superseded_cut_order_can_be_issued_again(tmp_path: Path) -> None:
    """이미 낸 주문이 무효화됐다면 다시 낼 수 있어야 한다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="revive"))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    bridge.reserve_product_selection(
        job_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    issued = _pending_cut_orders(bridge)
    assert len(issued) == 1

    # 워커가 다시 켜지며 이전 주문이 무효화된 상황을 만든다.
    for execution in bridge._executions.values():
        if execution.order["orderId"] == issued[0]:
            execution.status = "superseded"

    again = _product_projection(job_id, sequence=200, revision=40)
    again["stages"][0]["selectedIds"] = []
    bridge.accept_session_projection(_envelope(again, cursor=20))

    revived = _pending_cut_orders(bridge)
    assert len(revived) == 1
    assert revived[0] != issued[0], "무효화된 주문이 다시 발행되지 않았습니다"
