from __future__ import annotations

from pathlib import Path

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _job, _live_worker


class _Clock:
    """시험에서 시간을 직접 밀어 세션 만료 경계를 재현한다."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _bridge(tmp_path: Path, clock: _Clock) -> FactorySyncBridge:
    return FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json", clock=clock)


def test_order_lifecycle_keeps_the_session_alive(tmp_path: Path) -> None:
    """오래 도는 단계를 처리하는 중에는 세션 하트비트가 늦어도 끊기지 않는다.

    주문을 처리하는 것 자체가 워커가 살아 있다는 증거다. 이것을 세지 않으면
    멀쩡히 일하던 워커의 세션이 만료되고 그 작업이 통째로 갇힌다.
    """
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    bridge.queue_product(_manual_product_job_payload(suffix="alive"))

    worker = _live_worker()
    order = bridge.claim(worker)["order"]
    assert order is not None

    # 세션 하트비트 없이, 주문 생명주기만 보내며 만료 한계를 넘긴다.
    clock.advance(80)
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    clock.advance(80)
    bridge.lifecycle(
        order["orderId"],
        "heartbeat",
        {**order, "workerId": worker["workerId"], "eventSequence": 2},
    )
    clock.advance(80)

    assert bridge._factory_session is not None, "일하고 있는 워커의 세션이 만료됐습니다"
    # 만료 판정을 직접 돌려도 살아 있어야 한다.
    with bridge._condition:
        bridge._expire_session_locked()
    assert bridge._factory_session is not None


def test_a_silent_worker_still_expires(tmp_path: Path) -> None:
    """아무 신호도 없으면 종전대로 만료된다."""
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    bridge.queue_product(_manual_product_job_payload(suffix="silent"))
    assert bridge._factory_session is not None

    clock.advance(600)
    with bridge._condition:
        bridge._expire_session_locked()
    assert bridge._factory_session is None, "신호가 끊긴 워커가 만료되지 않았습니다"


def test_liveness_from_another_session_is_ignored(tmp_path: Path) -> None:
    """다른 세션의 주문 처리로는 현재 세션을 살려두지 않는다."""
    clock = _Clock()
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    current = bridge._factory_session
    assert current is not None
    before = current.last_seen

    clock.advance(50)
    with bridge._condition:
        bridge._note_worker_liveness_locked("factory-session-someone-else")
    assert bridge._factory_session is not None
    assert bridge._factory_session.last_seen == before
