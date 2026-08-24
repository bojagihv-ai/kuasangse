"""관제탑을 다시 켜도 대기 중인 작업이 계속 흘러야 한다."""

from __future__ import annotations

from pathlib import Path

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _live_worker


def _bridge_with_queued_job(tmp_path: Path, suffix: str) -> tuple[FactorySyncBridge, str]:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix=suffix))["jobId"])
    return bridge, job_id


def test_queued_job_with_no_order_is_handed_out_when_asked(tmp_path: Path) -> None:
    # 주문 발행은 작업 상태가 바뀌는 순간에만 일어난다. 관제탑을 다시 켠 뒤 대기 중인
    # 작업만 남고 주문 기록이 없으면, 그 뒤로는 상태가 바뀔 일이 없어 아무도 발행을
    # 부르지 않는다. 워커가 계속 물어봐도 내줄 것이 없다고 답하고 큐가 영원히 멈춘다.
    bridge, job_id = _bridge_with_queued_job(tmp_path, "frozen")
    bridge._executions.clear()
    job = bridge._product_jobs[job_id]
    job.status = "queued"
    job.current_order_id = ""

    assert bridge.has_pending() is True
    claimed = bridge.claim(_live_worker())
    assert claimed["order"] is not None
    assert claimed["order"]["command"]["payload"]["jobId"] == job_id


def test_job_holding_an_unknown_order_is_stood_back_up(tmp_path: Path) -> None:
    # 관제탑이 모르는 주문은 진행될 수 없다. 워커가 하나뿐이라 그런 작업 하나가
    # 뒤에 선 작업까지 전부 붙든다.
    bridge, job_id = _bridge_with_queued_job(tmp_path, "orphan")
    bridge._executions.clear()
    job = bridge._product_jobs[job_id]
    job.status = "running"
    job.current_order_id = "factory-product-사라진주문"

    assert bridge.has_pending() is True
    assert bridge._product_jobs[job_id].current_order_id != "factory-product-사라진주문"


def test_nothing_to_hand_out_stays_empty(tmp_path: Path) -> None:
    # 대기 중인 작업이 없으면 없다고 답해야 한다. 여기서 거짓으로 있다고 하면
    # 관제탑이 외부 원장 대신 빈 주문을 계속 내민다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())

    assert bridge.has_pending() is False


def test_pending_order_is_not_replaced_by_a_new_one(tmp_path: Path) -> None:
    # 이미 내줄 주문이 있으면 그것을 그대로 쓴다. 물어볼 때마다 새로 발행하면
    # 워커 하나짜리 큐가 주문으로 뒤덮인다.
    bridge, _ = _bridge_with_queued_job(tmp_path, "single")

    before = len(bridge._executions)
    assert bridge.has_pending() is True
    assert bridge.has_pending() is True
    assert len(bridge._executions) == before
