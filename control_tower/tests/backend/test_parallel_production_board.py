from __future__ import annotations

from pathlib import Path
from typing import Any

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import (
    _hello,
    _manual_product_job_payload,
    _product_checkpoint,
    _product_projection,
    _worker,
)


def _live_worker() -> dict[str, Any]:
    return {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}


def _run_to_waiting_manual(
    bridge: FactorySyncBridge,
    order: dict[str, Any],
    job_id: str,
    *,
    sequence: int,
    stage_key: str = "representative",
    awaiting: bool = True,
) -> dict[str, Any]:
    worker = _live_worker()
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    projection = _product_projection(job_id, sequence=sequence, revision=sequence + 2)
    if awaiting:
        projection["stages"][0]["selectedIds"] = []
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": job_id,
        "status": "waiting_manual",
        "stageKey": stage_key,
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": projection,
        "checkpoint": _product_checkpoint(
            job_id,
            projection,
            status="waiting_manual",
            stage_key=stage_key,
        ),
    }
    completed = {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": receipt}
    bridge.lifecycle(order["orderId"], "events", completed)
    bridge.lifecycle(order["orderId"], "complete", completed)
    return projection


def _job(bridge: FactorySyncBridge, job_id: str) -> dict[str, Any]:
    return next(job for job in bridge.product_jobs() if job["jobId"] == job_id)


def test_waiting_product_releases_the_worker_to_the_next_product(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    first_id = str(bridge.queue_product(_manual_product_job_payload(suffix="lane-one"))["jobId"])
    second_id = str(bridge.queue_product(_manual_product_job_payload(suffix="lane-two"))["jobId"])

    first_order = bridge.claim(_live_worker())["order"]
    assert first_order["command"]["payload"]["jobId"] == first_id
    _run_to_waiting_manual(bridge, first_order, first_id, sequence=8)

    second_order = bridge.claim(_live_worker())["order"]

    assert second_order is not None
    assert second_order["command"]["payload"]["jobId"] == second_id
    assert _job(bridge, first_id)["status"] == "waiting_manual"
    assert _job(bridge, second_id)["status"] == "running"


def test_each_product_keeps_its_own_stopped_progress_when_the_worker_moves_on(
    tmp_path: Path,
) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    first_id = str(bridge.queue_product(_manual_product_job_payload(suffix="keep-one"))["jobId"])
    second_id = str(bridge.queue_product(_manual_product_job_payload(suffix="keep-two"))["jobId"])

    first_order = bridge.claim(_live_worker())["order"]
    _run_to_waiting_manual(bridge, first_order, first_id, sequence=8)
    first_progress = _job(bridge, first_id)["progress"]

    second_order = bridge.claim(_live_worker())["order"]
    _run_to_waiting_manual(bridge, second_order, second_id, sequence=20, awaiting=False)

    stopped = _job(bridge, first_id)["progress"]
    moved_on = _job(bridge, second_id)["progress"]

    assert stopped == first_progress
    assert stopped["schema"] == "factory-product-progress:v1"
    assert stopped["awaitingStageKeys"] == ["representative"]
    assert stopped["stages"][0]["candidateCount"] == 2
    assert stopped["stages"][0]["selectedId"] == ""
    assert stopped["totalStageCount"] == 6
    # 두 번째 작업은 자기 자신의 진행만 보고한다.
    assert moved_on["awaitingStageKeys"] == []
    assert moved_on["stages"][0]["selectedId"] == "representative-a"
    assert moved_on["selectedStageCount"] == 1


def test_stopped_progress_survives_a_backend_restart(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="restart"))["jobId"])
    order = bridge.claim(_live_worker())["order"]
    _run_to_waiting_manual(bridge, order, job_id, sequence=8)
    before = _job(bridge, job_id)["progress"]

    restored = FactorySyncBridge(state_path=state_path)

    assert _job(restored, job_id)["progress"] == before
    assert _job(restored, job_id)["progress"]["awaitingStageKeys"] == ["representative"]


def test_board_reports_every_product_side_by_side(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_ids = [
        str(bridge.queue_product(_manual_product_job_payload(suffix=f"board-{index}"))["jobId"])
        for index in range(5)
    ]
    for index, job_id in enumerate(job_ids[:3]):
        order = bridge.claim(_live_worker())["order"]
        assert order["command"]["payload"]["jobId"] == job_id
        _run_to_waiting_manual(bridge, order, job_id, sequence=8 + index * 10)

    board = bridge.product_jobs()

    assert [job["jobId"] for job in board] == job_ids
    waiting = [job for job in board if job["status"] == "waiting_manual"]
    assert len(waiting) == 3
    assert all(job["progress"]["awaitingStageKeys"] == ["representative"] for job in waiting)
    assert [job["status"] for job in board[3:]] == ["queued", "queued"]
    # 4번째 작업은 이미 워커에게 배정된 상태이고, 5번째는 아직 대기열에 있다.
    assert [job["dispatched"] for job in board[3:]] == [True, False]


def test_a_projection_without_job_identity_never_overwrites_another_products_progress(
    tmp_path: Path,
) -> None:
    """워커가 재접속하며 보낸 신원 없는 화면 상태가 남의 작업 진행도를 지우면 안 된다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    first_id = str(bridge.queue_product(_manual_product_job_payload(suffix="identity-one"))["jobId"])
    bridge.queue_product(_manual_product_job_payload(suffix="identity-two"))
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], first_id, sequence=8)
    before = _job(bridge, first_id)["progress"]
    assert before["stages"][0]["candidateCount"] == 2

    # 두 번째 작업이 배정된 상태에서, 어떤 작업인지 밝히지 않는 화면 상태가 들어온다.
    bridge.claim(_live_worker())
    anonymous = _product_projection("nobody", sequence=200, revision=202)
    anonymous["registration"].pop("jobId")
    anonymous["session"]["runId"] = "run:unknown-workspace"
    bridge.accept_projection(anonymous)

    assert _job(bridge, first_id)["progress"] == before
