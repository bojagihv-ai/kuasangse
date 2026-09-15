"""Cafe24 값 저장과 승인 게이트의 안전 계약."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

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


def _completed(bridge: FactorySyncBridge, suffix: str) -> tuple[str, dict[str, Any]]:
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix=suffix))["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    done = _product_projection(job_id, sequence=200, revision=40)
    for stage in done["stages"]:
        if stage.get("candidates"):
            stage["selectedIds"] = [stage["candidates"][0]["id"]]
    bridge.accept_session_projection(_envelope(done, cursor=40))
    job = bridge._product_jobs[job_id]
    job.status = "completed"
    job.current_order_id = ""
    return job_id, done


def test_saving_registration_values_never_queues_a_worker_command(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24-values-only")

    saved = bridge.save_cafe24_registration_values(job_id, {"categoryId": "119"})

    assert saved["cafe24Values"]["categoryId"] == "119"
    assert bridge.has_pending() is False
    assert bridge._product_jobs[job_id].current_order_id == ""


def test_legacy_registration_queue_is_rejected_without_creating_an_order(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24-legacy-queue")

    with pytest.raises(FactorySyncError) as raised:
        bridge.queue_cafe24_registration(job_id, {"categoryId": "119"})

    assert raised.value.code == "factory_cafe24_approval_required"
    assert bridge.has_pending() is False
    assert bridge._product_jobs[job_id].current_order_id == ""


def test_saved_registration_values_override_intake_values_without_queueing(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24-pending-override")
    bridge._product_jobs[job_id].payload["requiredValues"] = {"cafe24CategoryId": "119"}

    saved = bridge.save_cafe24_registration_values(job_id, {"categoryId": "142"})

    assert saved["cafe24Values"]["categoryId"] == "142"
    assert bridge.has_pending() is False


def test_saved_registration_values_are_carried_into_the_next_worker_order(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24-dispatch-payload")
    bridge.save_cafe24_registration_values(job_id, {"categoryId": "84"})

    bridge.resume_product(job_id)
    order = bridge.claim(_live_worker())["order"]

    assert order["command"]["payload"]["cafe24Registration"] == {"categoryId": "84"}


def test_invalid_pending_registration_values_are_rejected(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24-invalid-pending")

    with pytest.raises(FactorySyncError) as raised:
        bridge.save_cafe24_registration_values(job_id, {"registrationMode": "replace"})

    assert raised.value.code == "factory_cafe24_values_invalid"
