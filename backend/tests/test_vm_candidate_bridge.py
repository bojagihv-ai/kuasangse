from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services import vm_candidate_bridge


def test_submit_includes_options_for_legacy_vm_bridge(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)

    result = vm_candidate_bridge.submit(
        {"keyword": "수저 파우치", "sites": ["coupang"]},
        {"productKey": "test-product"},
    )

    request_path = tmp_path / "requests" / f"{result['job_id']}.json"
    payload = json.loads(request_path.read_text(encoding="utf-8"))

    assert payload["worker_payload"]["options"] == {
        "search_runtime": "local",
        "candidate_runtime": "local",
        "runtime": "local",
    }
