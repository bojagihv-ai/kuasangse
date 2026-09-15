from __future__ import annotations

import json
from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_cafe24_registration_order import _completed
from test_factory_sync import _manual_product_job_payload


def test_pending_cafe24_registration_values_survive_bridge_restart(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    job_id, _ = _completed(bridge, "restart-values")
    chosen = {
        "registrationMode": "update",
        "targetProductNo": "3024",
        "categoryId": "82",
        "salePrice": "4000",
        "supplyPrice": "1000",
        "displayStatus": "F",
        "sellingStatus": "F",
    }

    bridge.save_cafe24_registration_values(job_id, chosen)
    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    persisted_job = next(job for job in persisted["jobs"] if job["jobId"] == job_id)
    assert persisted_job["payload"]["cafe24Registration"] == chosen

    restarted = FactorySyncBridge(state_path=state_path)

    assert restarted._product_jobs[job_id].payload["cafe24Registration"] == chosen


def test_malformed_cafe24_registration_is_rejected_at_product_boundary(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    payload = _manual_product_job_payload(suffix="restart-invalid")
    payload["cafe24Registration"] = {"registrationMode": "replace"}

    with pytest.raises(FactorySyncError) as raised:
        bridge.queue_product(payload)

    assert raised.value.code == "factory_cafe24_values_invalid"
