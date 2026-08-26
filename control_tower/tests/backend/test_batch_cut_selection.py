from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_factory_sync import _hello, _manual_product_job_payload
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


def _two_waiting_products(bridge: FactorySyncBridge) -> tuple[str, str, dict[str, Any]]:
    bridge.hello(_hello())
    first_id = str(bridge.queue_product(_manual_product_job_payload(suffix="cut-one"))["jobId"])
    second_id = str(bridge.queue_product(_manual_product_job_payload(suffix="cut-two"))["jobId"])
    first_order = bridge.claim(_live_worker())["order"]
    first_projection = _run_to_waiting_manual(bridge, first_order, first_id, sequence=8)
    second_order = bridge.claim(_live_worker())["order"]
    _run_to_waiting_manual(bridge, second_order, second_id, sequence=20)
    return first_id, second_id, first_projection


def test_selection_for_a_product_the_worker_is_not_holding_is_reserved(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, second_id, _ = _two_waiting_products(bridge)

    reserved = bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    assert reserved["status"] == "reserved"
    assert reserved["reservation"]["candidateId"] == "representative-b"
    assert _job(bridge, first_id)["pendingSelection"]["stageKey"] == "representative"
    assert "pendingSelection" not in _job(bridge, second_id)


def test_reserved_selection_is_applied_when_the_worker_reopens_the_product(
    tmp_path: Path,
) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _, first_projection = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    # 예약과 동시에 그 작업이 다시 대기열에 서고, 워커가 그 작업파일을 다시 연다.
    assert _job(bridge, first_id)["status"] == "queued"
    restore = bridge.claim(_live_worker())["order"]
    assert restore["command"]["name"] == "runFactoryProduct"
    assert restore["command"]["payload"]["restoreOnly"] is True
    reopened = {**first_projection, "sequence": 40, "cursor": "40"}
    bridge.accept_session_projection(_session_envelope(reopened, cursor=9))

    order = bridge.claim(_live_worker())["order"]
    assert order["command"]["name"] == "selectFactoryACut"
    assert order["command"]["payload"]["candidateId"] == "representative-b"
    assert order["command"]["payload"]["stageKey"] == "representative"
    assert order["currentRunId"] == first_projection["session"]["runId"]
    # 주문이 나갔다고 예약을 지우지는 않는다. 주문이 무효화돼도 선택이 살아남아야 한다.
    assert _job(bridge, first_id)["pendingSelection"]["candidateId"] == "representative-b"


def test_reservation_survives_a_backend_restart(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    first_id, _, _ = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    restored = FactorySyncBridge(state_path=state_path)

    assert _job(restored, first_id)["pendingSelection"]["candidateId"] == "representative-b"


def test_reservation_rejects_a_candidate_that_is_not_on_the_product(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _, _ = _two_waiting_products(bridge)

    with pytest.raises(FactorySyncError) as error:
        bridge.reserve_product_selection(
            first_id,
            {"stageKey": "representative", "candidateId": "representative-zzz"},
        )
    assert error.value.code == "candidate_membership_invalid"

    with pytest.raises(FactorySyncError) as stage_error:
        bridge.reserve_product_selection(
            first_id,
            {"stageKey": "sections", "candidateId": "representative-b"},
        )
    assert stage_error.value.code == "candidate_membership_invalid"


def test_reservation_can_be_cleared_before_the_worker_returns(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _, _ = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    assert bridge.clear_product_selection(first_id)["status"] == "cleared"
    assert "pendingSelection" not in _job(bridge, first_id)


def test_many_waiting_products_can_be_reserved_in_one_pass(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_ids = [
        str(bridge.queue_product(_manual_product_job_payload(suffix=f"bulk-{index}"))["jobId"])
        for index in range(6)
    ]
    for index, job_id in enumerate(job_ids):
        order = bridge.claim(_live_worker())["order"]
        _run_to_waiting_manual(bridge, order, job_id, sequence=8 + index * 10)

    results = [
        bridge.reserve_product_selection(
            job_id,
            {"stageKey": "representative", "candidateId": "representative-b"},
        )
        for job_id in job_ids
    ]

    # 워커가 마지막으로 들고 있던 작업만 즉시 적용되고 나머지는 예약된다.
    assert [result["status"] for result in results[:-1]] == ["reserved"] * 5
    assert results[-1]["status"] == "applied"
    assert results[-1]["order"]["command"]["name"] == "selectFactoryACut"
    # 예약은 조립공장이 실제로 컷을 반영했다고 보고할 때까지 남는다.
    reserved_jobs = [job for job in bridge.product_jobs() if "pendingSelection" in job]
    assert len(reserved_jobs) == 6


def test_reservation_is_dropped_as_soon_as_the_candidate_disappears(
    tmp_path: Path,
) -> None:
    """후보가 다시 만들어져 예약한 컷이 사라지면 그 자리에서 예약을 접는다.

    전에는 워커가 작업파일을 통째로 다시 연 뒤에야 이것을 알아챘다. 사람은 몇 분
    동안 "적용하는 중" 을 보고 있다가 결국 못 찾았다는 말을 들었고, 컷은 그대로였다.
    실측 2026-08-26: 방울수저집 대표 후보가 10개에서 9개로 바뀌어 있었다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _, first_projection = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )
    assert _job(bridge, first_id)["pendingSelection"]["candidateId"] == "representative-b"

    # 조립공장이 후보를 다시 만들어 예약한 id 가 사라진 채로 보고한다.
    regenerated = {**first_projection, "sequence": 40, "cursor": "40"}
    regenerated["stages"] = [
        {
            **stage,
            "candidates": [
                candidate
                for candidate in stage.get("candidates", [])
                if candidate.get("id") != "representative-b"
            ],
        }
        for stage in regenerated["stages"]
    ]
    bridge.accept_session_projection(_session_envelope(regenerated, cursor=9))

    job = _job(bridge, first_id)
    assert "pendingSelection" not in job or job.get("pendingSelection") is None
    assert "새 후보 목록에 없습니다" in str(job["message"])

    # 예약이 접혔으므로 그 컷을 적용하는 주문도 나가지 않는다.
    for _ in range(3):
        claimed = bridge.claim(_live_worker())
        order = claimed.get("order") if isinstance(claimed, dict) else None
        if order is None:
            break
        assert order["command"]["name"] != "selectFactoryACut"


def test_reservation_survives_a_report_that_does_not_carry_its_stage(
    tmp_path: Path,
) -> None:
    """그 단계 보고가 아직 안 온 것과 후보가 사라진 것은 다르다.

    구분하지 않으면, 다른 단계를 보고할 때마다 멀쩡한 예약이 지워진다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    first_id, _, first_projection = _two_waiting_products(bridge)
    bridge.reserve_product_selection(
        first_id,
        {"stageKey": "representative", "candidateId": "representative-b"},
    )

    without_stage = {**first_projection, "sequence": 41, "cursor": "41"}
    without_stage["stages"] = [
        stage for stage in without_stage["stages"] if stage.get("key") != "representative"
    ]
    if not without_stage["stages"]:
        without_stage["stages"] = [{"key": "size", "status": "empty", "candidates": []}]
    bridge.accept_session_projection(_session_envelope(without_stage, cursor=10))

    assert _job(bridge, first_id)["pendingSelection"]["candidateId"] == "representative-b"
