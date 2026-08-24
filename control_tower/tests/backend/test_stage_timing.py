from __future__ import annotations

from pathlib import Path

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload
from test_parallel_production_board import _job, _live_worker, _run_to_waiting_manual


def _bridge(tmp_path: Path, clock: list[float]) -> FactorySyncBridge:
    return FactorySyncBridge(
        state_path=tmp_path / "factory-product-jobs.json",
        clock=lambda: clock[0],
        session_timeout_seconds=100_000.0,
    )


def test_timing_separates_machine_work_from_the_wait_on_a_person(tmp_path: Path) -> None:
    clock = [0.0]
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="timing"))["jobId"])

    clock[0] = 10.0
    order = bridge.claim(_live_worker())["order"]
    clock[0] = 42.5
    _run_to_waiting_manual(bridge, order, job_id, sequence=8, awaiting=False)

    machine_only = _job(bridge, job_id)["timing"]
    assert machine_only["schema"] == "factory-product-timing:v1"
    assert machine_only["stages"] == [{"stageKey": "representative", "machineMs": 32_500, "waitMs": 0}]
    assert machine_only["totalMachineMs"] == 32_500
    assert machine_only["totalWaitMs"] == 0

    clock[0] = 102.5
    bridge.resume_product(job_id)

    both = _job(bridge, job_id)["timing"]
    assert both["stages"] == [{"stageKey": "representative", "machineMs": 32_500, "waitMs": 60_000}]
    assert both["totalMachineMs"] == 32_500
    assert both["totalWaitMs"] == 60_000


def test_timing_accumulates_across_stages_and_survives_a_restart(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    clock = [0.0]
    bridge = _bridge(tmp_path, clock)
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="two-stage"))["jobId"])

    clock[0] = 5.0
    first_order = bridge.claim(_live_worker())["order"]
    clock[0] = 20.0
    _run_to_waiting_manual(bridge, first_order, job_id, sequence=8, awaiting=False)
    clock[0] = 30.0
    bridge.resume_product(job_id)
    clock[0] = 35.0
    second_order = bridge.claim(_live_worker())["order"]
    clock[0] = 50.0
    _run_to_waiting_manual(bridge, second_order, job_id, sequence=30, stage_key="size", awaiting=False)

    timing = _job(bridge, job_id)["timing"]
    assert timing["totalMachineMs"] == 30_000
    assert timing["totalWaitMs"] == 10_000
    assert {entry["stageKey"] for entry in timing["stages"]} == {"representative", "size"}

    restored = FactorySyncBridge(state_path=state_path, session_timeout_seconds=100_000.0)
    assert _job(restored, job_id)["timing"] == timing


def test_a_product_that_never_ran_reports_no_timing(tmp_path: Path) -> None:
    bridge = _bridge(tmp_path, [0.0])
    bridge.hello(_hello())
    bridge.queue_product(_manual_product_job_payload(suffix="never-ran"))
    bridge.queue_product(_manual_product_job_payload(suffix="never-ran-two"))

    idle = bridge.product_jobs()[1]

    assert "timing" not in idle
