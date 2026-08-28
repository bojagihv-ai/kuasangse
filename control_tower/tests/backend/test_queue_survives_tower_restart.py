"""관제탑을 다시 켜도 대기 중인 작업이 계속 흘러야 한다.

여기의 '재시작' 은 흉내가 아니다: A 인스턴스로 상태를 만들고 참조를 버린 뒤,
같은 상태 파일 위에 B 인스턴스를 새로 세운다. JSON 왕복과 시동 고아 변환
(factory_sync._load_product_jobs) 이 실제로 실행되는 것이 이 파일의 존재 이유다.
같은 객체의 내부 상태를 손으로 고쳐 재시작을 흉내내면 그 두 경로가 통째로 빠진다.
"""

from __future__ import annotations

from pathlib import Path

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _job, _live_worker, _run_to_waiting_manual


def _restart(state_path: Path) -> FactorySyncBridge:
    """상태 파일만 남기고 새 프로세스가 뜬 것과 같은 브리지를 돌려준다."""
    return FactorySyncBridge(state_path=state_path)


def test_full_queue_survives_a_real_restart(tmp_path: Path) -> None:
    # 사람이 고르던 작업(waiting_manual + 예약 + 체크포인트), 워커가 물고 있던 작업,
    # 순수 대기 작업 — 세 가지가 재시작 후 각각 제 모습으로 올라와야 한다.
    state_path = tmp_path / "factory-product-jobs.json"
    first_bridge = FactorySyncBridge(state_path=state_path)
    first_bridge.hello(_hello())

    manual_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="manual"))["jobId"])
    order = first_bridge.claim(_live_worker())["order"]
    _run_to_waiting_manual(first_bridge, order, manual_id, sequence=8)
    # autoResume=False: 예약이 파일에 남는 것 자체를 검증한다. 기본값 True 는 즉시
    # 재큐를 시도해 상태가 움직여 버린다.
    first_bridge.reserve_product_selection(
        manual_id,
        {"stageKey": "representative", "candidateId": "representative-b", "autoResume": False},
    )
    running_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="running"))["jobId"])
    queued_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="queued"))["jobId"])
    assert _job(first_bridge, running_id)["dispatched"] is True
    assert _job(first_bridge, queued_id)["dispatched"] is False

    del first_bridge
    restarted = _restart(state_path)

    manual = _job(restarted, manual_id)
    assert manual["status"] == "waiting_manual"
    assert manual["checkpointAvailable"] is True
    assert manual["pendingSelection"]["candidateId"] == "representative-b"
    # 워커가 주문을 물고 있던 작업은 소유권이 죽었다고 정직하게 말해야 한다.
    # 이것이 화면의 '복구 필요' 다 — queued 로 올라오면 유령 주문을 영원히 기다린다.
    running = _job(restarted, running_id)
    assert running["status"] == "blocked"
    assert "백엔드 재시작" in running["message"]
    assert _job(restarted, queued_id)["status"] == "queued"


def test_worker_reconnect_resumes_the_restarted_queue(tmp_path: Path) -> None:
    # 재시작 후 워커가 다시 접속하면: 순수 대기 작업은 그대로 배정되고,
    # 소유권이 죽은 작업은 재개 한 번으로 대기열에 복귀해야 한다.
    state_path = tmp_path / "factory-product-jobs.json"
    first_bridge = FactorySyncBridge(state_path=state_path)
    first_bridge.hello(_hello())
    orphan_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="orphan"))["jobId"])
    waiting_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="waiting"))["jobId"])

    del first_bridge
    restarted = _restart(state_path)
    restarted.hello(_hello())

    # 순수 대기 작업이 먼저 배정된다 — blocked 작업이 대기열을 막으면 안 된다.
    assert restarted.has_pending() is True
    claimed = restarted.claim(_live_worker())
    assert claimed["order"] is not None
    assert claimed["order"]["command"]["payload"]["jobId"] == waiting_id

    # 소유권이 죽은 작업은 재개로 살린다. 체크포인트가 없었으니 처음부터 다시 돈다.
    assert _job(restarted, orphan_id)["status"] == "blocked"
    restarted.resume_product(orphan_id)
    assert _job(restarted, orphan_id)["status"] == "queued"


def test_queued_job_with_no_order_is_handed_out_when_asked(tmp_path: Path) -> None:
    # 주문 발행은 작업 상태가 바뀌는 순간에만 일어난다. 재시작 뒤 대기 작업만 남으면
    # 그 뒤로 상태가 바뀔 일이 없어 아무도 발행을 부르지 않는다. 워커가 물어볼 때
    # 내줄 수 있어야 큐가 되살아난다.
    state_path = tmp_path / "factory-product-jobs.json"
    first_bridge = FactorySyncBridge(state_path=state_path)
    first_bridge.hello(_hello())
    str(first_bridge.queue_product(_manual_product_job_payload(suffix="held"))["jobId"])
    frozen_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="frozen"))["jobId"])

    del first_bridge
    restarted = _restart(state_path)
    restarted.hello(_hello())

    assert restarted.has_pending() is True
    claimed = restarted.claim(_live_worker())
    assert claimed["order"] is not None
    assert claimed["order"]["command"]["payload"]["jobId"] == frozen_id


def test_job_holding_an_unknown_order_is_stood_back_up(tmp_path: Path) -> None:
    # 관제탑이 모르는 주문은 진행될 수 없다. 재시작이 그런 작업을 blocked 로 바꿔
    # 정체를 드러내고, 재개 한 번으로 대기열에 복귀해 뒤에 선 작업까지 풀린다.
    state_path = tmp_path / "factory-product-jobs.json"
    first_bridge = FactorySyncBridge(state_path=state_path)
    first_bridge.hello(_hello())
    orphan_id = str(first_bridge.queue_product(_manual_product_job_payload(suffix="orphan"))["jobId"])
    assert _job(first_bridge, orphan_id)["dispatched"] is True

    del first_bridge
    restarted = _restart(state_path)
    restarted.hello(_hello())

    assert _job(restarted, orphan_id)["status"] == "blocked"
    restarted.resume_product(orphan_id)
    assert restarted.has_pending() is True
    claimed = restarted.claim(_live_worker())
    assert claimed["order"] is not None
    assert claimed["order"]["command"]["payload"]["jobId"] == orphan_id
    assert claimed["order"]["orderId"] != ""


def test_nothing_to_hand_out_stays_empty(tmp_path: Path) -> None:
    # 대기 중인 작업이 없으면 재시작 후에도 없다고 답해야 한다. 여기서 거짓으로
    # 있다고 하면 관제탑이 외부 원장 대신 빈 주문을 계속 내민다.
    state_path = tmp_path / "factory-product-jobs.json"
    first_bridge = FactorySyncBridge(state_path=state_path)
    first_bridge.hello(_hello())

    del first_bridge
    restarted = _restart(state_path)
    restarted.hello(_hello())

    assert restarted.has_pending() is False


def test_pending_order_is_not_replaced_by_a_new_one(tmp_path: Path) -> None:
    # 이미 내줄 주문이 있으면 그것을 그대로 쓴다. 물어볼 때마다 새로 발행하면
    # 워커 하나짜리 큐가 주문으로 뒤덮인다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    bridge.queue_product(_manual_product_job_payload(suffix="single"))

    before = len(bridge._executions)
    assert bridge.has_pending() is True
    assert bridge.has_pending() is True
    assert len(bridge._executions) == before
