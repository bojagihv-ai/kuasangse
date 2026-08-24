from __future__ import annotations

from pathlib import Path
from typing import Any

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload, _product_projection
from test_parallel_production_board import _job, _live_worker, _run_to_waiting_manual


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


def _selected_projection(job_id: str, *, sequence: int, candidate_id: str) -> dict[str, Any]:
    projection = _product_projection(job_id, sequence=sequence, revision=sequence + 2)
    projection["stages"][0]["selectedIds"] = [candidate_id]
    return projection


def _apply_reserved_cut(
    bridge: FactorySyncBridge,
    job_id: str,
    *,
    candidate_id: str,
    reopen_sequence: int,
    applied_sequence: int,
    cursor: int,
) -> dict[str, Any] | None:
    """조립공장이 그 작업파일을 다시 열고, 예약된 컷 선택 주문을 수행한 상황을 재현한다."""
    worker = _live_worker()
    order = None
    for _ in range(4):
        order = bridge.claim(worker)["order"]
        if order is None or order["command"]["name"] == "selectFactoryACut":
            break
        # 예약을 적용하려면 조립공장이 그 작업파일을 다시 여는 복원 실행부터 끝내야 한다.
        _run_to_waiting_manual(bridge, order, job_id, sequence=reopen_sequence)
    if order is None or order["command"]["name"] != "selectFactoryACut":
        return order
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    receipt = {
        "schema": "factory-a-cut-receipt:v1",
        "stageKey": order["command"]["payload"]["stageKey"],
        "candidateId": candidate_id,
        "projection": _selected_projection(job_id, sequence=applied_sequence, candidate_id=candidate_id),
    }
    bridge.lifecycle(
        order["orderId"],
        "complete",
        {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": receipt},
    )
    return order


def _two_waiting_products(bridge: FactorySyncBridge) -> tuple[str, str]:
    bridge.hello(_hello())
    first = str(bridge.queue_product(_manual_product_job_payload(suffix="cycle-one"))["jobId"])
    second = str(bridge.queue_product(_manual_product_job_payload(suffix="cycle-two"))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], first, sequence=8)
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], second, sequence=20)
    return first, second


def test_reserved_cut_carries_the_product_into_its_next_stage_without_a_person(
    tmp_path: Path,
) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _ = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    assert _job(bridge, first_id)["autoResumePending"] is True
    # 예약만으로 그 작업이 다시 조립공장 순번에 선다.
    assert _job(bridge, first_id)["status"] == "queued"

    _apply_reserved_cut(
        bridge,
        first_id,
        candidate_id="representative-b",
        reopen_sequence=40,
        applied_sequence=60,
        cursor=9,
    )

    resumed = _job(bridge, first_id)
    assert resumed["status"] == "queued"
    assert resumed["dispatched"] is True
    assert resumed["autoResumePending"] is False
    assert "pendingSelection" not in resumed
    next_order = bridge.claim(_live_worker())["order"]
    assert next_order["command"]["name"] == "runFactoryProduct"
    assert next_order["command"]["payload"]["jobId"] == first_id


def test_opting_out_of_auto_resume_leaves_the_product_for_the_operator(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _ = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b", "autoResume": False},
    )
    assert _job(bridge, first_id)["autoResumePending"] is False

    _apply_reserved_cut(
        bridge,
        first_id,
        candidate_id="representative-b",
        reopen_sequence=40,
        applied_sequence=60,
        cursor=9,
    )

    held = _job(bridge, first_id)
    assert held["status"] == "waiting_manual"
    assert held["dispatched"] is False


def test_auto_resume_intent_survives_a_backend_restart(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    first_id, _ = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    restored = FactorySyncBridge(state_path=state_path)

    assert _job(restored, first_id)["autoResumePending"] is True
    assert _job(restored, first_id)["pendingSelection"]["autoResume"] is True


def test_batch_resume_moves_every_selected_product_forward(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, second_id = _two_waiting_products(bridge)
    # 두 작업 모두 자동 진행 없이 선택만 반영해 둔다.
    for job_id, reopen, applied, cursor in ((first_id, 40, 60, 9), (second_id, 80, 100, 11)):
        bridge.reserve_product_selection(
            job_id,
            {"stageKey": "representative", "candidateId": "representative-b", "autoResume": False},
        )
        _apply_reserved_cut(
            bridge,
            job_id,
            candidate_id="representative-b",
            reopen_sequence=reopen,
            applied_sequence=applied,
            cursor=cursor,
        )
    assert [_job(bridge, job_id)["status"] for job_id in (first_id, second_id)] == [
        "waiting_manual",
        "waiting_manual",
    ]

    result = bridge.resume_products([first_id, second_id])

    assert result["schema"] == "factory-batch-resume:v1"
    assert result["failed"] == 0
    assert result["resumed"] == 2
    assert [_job(bridge, job_id)["status"] for job_id in (first_id, second_id)] == ["queued", "queued"]


def test_batch_resume_reports_products_that_cannot_move_yet(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, second_id = _two_waiting_products(bridge)

    result = bridge.resume_products([first_id, second_id, "factory-job-missing"])

    reasons = {
        str(item["jobId"]): str(item.get("reason") or "")
        for item in result["results"]
        if item["status"] == "error"
    }
    assert result["resumed"] == 1
    assert result["failed"] == 2
    assert reasons["factory-job-missing"] == "factory_product_job_not_found"
    # 조립공장이 지금 열고 있는 작업은 컷을 고르지 않으면 조용히 넘어가지 않고 이유를 밝힌다.
    assert reasons[second_id] == "factory_decision_required"
    # 지금 열려 있지 않은 작업은 저장된 상태를 다시 여는 것으로 진행한다.
    assert first_id not in reasons
    assert _job(bridge, first_id)["status"] == "queued"
    assert _job(bridge, second_id)["status"] == "waiting_manual"


def test_a_worker_restart_does_not_swallow_a_reserved_cut(tmp_path: Path) -> None:
    """조립공장이 다시 켜져 선택 주문이 무효화돼도, 예약한 컷은 남아 다시 순번을 받는다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _ = _two_waiting_products(bridge)
    # 워커가 지금 들고 있는 작업이라 선택 주문이 곧바로 발행된다.
    applied = bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    assert applied["status"] == "reserved"

    # 조립공장이 다시 켜지며 다른 작업파일을 연 채로 접속한다.
    restart = {
        **_hello(session_id="factory-session-restarted"),
        "workerId": "factory-worker-restarted",
        "buildId": "build-restarted",
        "startedAt": 5000,
    }
    bridge.hello(restart)

    revived = _job(bridge, first_id)
    assert revived["pendingSelection"]["candidateId"] == "representative-b"
    assert revived["status"] == "queued"
    assert revived["dispatched"] is True
