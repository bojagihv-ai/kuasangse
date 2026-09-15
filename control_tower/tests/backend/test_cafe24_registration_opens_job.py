"""Cafe24 pending 값은 작업 공개 projection에서만 보인다."""

from __future__ import annotations

from pathlib import Path

from control_tower.backend.factory_sync import FactorySyncBridge

from test_cafe24_registration_order import _completed


def test_public_job_exposes_saved_pending_registration_values(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "pending-public")

    public = bridge.save_cafe24_registration_values(
        job_id,
        {"registrationMode": "update", "targetProductNo": "3024"},
    )

    assert public["cafe24Values"] == {
        "registrationMode": "update",
        "targetProductNo": "3024",
        "salePrice": "12000",
    }
    assert bridge.has_pending() is False


def test_blocked_completed_job_can_save_pending_values_without_registration(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "blocked-pending")
    bridge._product_jobs[job_id].status = "blocked"

    saved = bridge.save_cafe24_registration_values(job_id, {"categoryId": "119"})

    assert saved["cafe24Values"]["categoryId"] == "119"
    assert bridge.has_pending() is False
