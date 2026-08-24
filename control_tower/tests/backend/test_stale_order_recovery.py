from __future__ import annotations

from pathlib import Path

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _job, _live_worker


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _bridge(tmp_path: Path, clock: _Clock) -> FactorySyncBridge:
    return FactorySyncBridge(
        state_path=tmp_path / "factory-product-jobs.json",
        clock=clock,
        order_timeout_seconds=300.0,
    )


def test_a_forgotten_order_is_reclaimed(tmp_path: Path) -> None:
    """워커가 받아가 놓고 잊은 주문은 회수해서 다시 대기열에 세운다.

    회수하지 않으면 그 작업이 '실행 중' 으로 자리를 붙든 채, 워커가 하나뿐이라
    뒤에 선 작업까지 전부 멈춘다.
    """
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="stale"))["jobId"])

    worker = _live_worker()
    order = bridge.claim(worker)["order"]
    assert order is not None
    assert _job(bridge, job_id)["status"] == "running"

    # 워커가 이 주문을 잊는다: 아무 신호도 보내지 않는다.
    clock.advance(600)
    reclaimed = bridge.claim(worker)["order"]

    recovered = _job(bridge, job_id)
    assert recovered["status"] in {"queued", "running"}, recovered["message"]
    assert reclaimed is not None, "회수한 작업을 다시 내주지 않았습니다"


def test_a_working_order_is_left_alone(tmp_path: Path) -> None:
    """하트비트가 오는 주문은 오래 걸려도 회수하지 않는다."""
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="busy"))["jobId"])

    worker = _live_worker()
    order = bridge.claim(worker)["order"]
    assert order is not None
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )

    for index in range(6):
        clock.advance(200)
        bridge.lifecycle(
            order["orderId"],
            "heartbeat",
            {**order, "workerId": worker["workerId"], "eventSequence": 2 + index},
        )

    clock.advance(100)
    bridge.claim(worker)
    assert _job(bridge, job_id)["status"] == "running", "일하는 주문을 회수했습니다"
    assert bridge._executions[order["orderId"]].status != "superseded"


def test_an_untouched_pending_order_is_not_reclaimed(tmp_path: Path) -> None:
    """아직 아무도 받아가지 않은 주문은 회수 대상이 아니다."""
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    bridge.queue_product(_manual_product_job_payload(suffix="pending"))

    clock.advance(600)
    with bridge._condition:
        bridge._expire_stale_orders_locked()

    pending = [e for e in bridge._executions.values() if e.status == "pending"]
    assert pending, "대기 중이던 주문이 사라졌습니다"

def test_recovery_runs_even_when_nothing_is_pending(tmp_path: Path) -> None:
    """대기 주문이 하나도 없을 때야말로 회수가 돌아야 한다.

    회수를 claim() 안에만 두면, 잊힌 주문 탓에 대기 주문이 0 이 된 순간
    claim() 이 아예 호출되지 않아 교착에서 빠져나오지 못한다.
    """
    clock = _Clock()
    # 워커는 붙어 있고 주문만 잊힌 상황을 만든다: 세션은 살려 두고 주문만 늙힌다.
    bridge = FactorySyncBridge(
        state_path=tmp_path / "factory-product-jobs.json",
        clock=clock,
        order_timeout_seconds=300.0,
        session_timeout_seconds=100000.0,
    )
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="gate"))["jobId"])

    worker = _live_worker()
    order = bridge.claim(worker)["order"]
    assert order is not None
    assert bridge.has_pending() is False, "이 시험은 대기 주문이 0 인 상태를 전제로 한다"

    clock.advance(600)
    assert bridge.has_pending() is True, "회수가 돌지 않아 내줄 주문이 생기지 않았습니다"
    assert _job(bridge, job_id)["status"] in {"queued", "running"}

def test_a_pending_order_is_rebound_to_the_live_worker(tmp_path: Path) -> None:
    """옛 워커를 겨냥한 대기 주문은 지금 붙어 있는 워커가 집을 수 있게 맞춰준다.

    맞춰주지 않으면 현재 워커가 그 주문을 건너뛰고, 관제탑은 '실행 중' 으로
    표시한 채 아무도 그 일을 하지 않는 상태가 된다.
    """
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    bridge.queue_product(_manual_product_job_payload(suffix="rebind"))

    stale = next(e for e in bridge._executions.values() if e.status == "pending")
    stale.order["targetWorkerId"] = "factory-worker-사라진워커"
    stale.order["workerSessionId"] = "factory-session-사라진세션"
    stale.session_id = "factory-session-사라진세션"

    worker = _live_worker()
    claimed = bridge.claim(worker)["order"]
    assert claimed is not None, "현재 워커가 대기 주문을 집지 못했습니다"
    assert claimed["targetWorkerId"] == worker["workerId"]
