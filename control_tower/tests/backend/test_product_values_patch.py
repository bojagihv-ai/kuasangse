"""투입값을 보드에서 그 자리에서 채울 수 있어야 한다."""

from __future__ import annotations

from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_cafe24_registration_order import _completed


def _bridge(tmp_path: Path, suffix: str) -> tuple[FactorySyncBridge, str]:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    return bridge, _completed(bridge, suffix)[0]


def test_missing_values_are_reported_so_the_screen_can_ask(tmp_path: Path) -> None:
    # 어떤 값이 비었는지 모르면 화면은 무엇을 물어야 할지 알 수 없고, 사람은 입력·소스
    # 화면으로 되돌아가야 한다.
    bridge, job_id = _bridge(tmp_path, "missing")
    job = bridge._product_jobs[job_id]
    job.payload["requiredValues"] = {"material": "면 100%"}

    public = bridge._public_product_job(job)

    assert public["requiredValues"]["material"] == "면 100%"
    assert "usage" in public["missingRequiredValues"]
    assert "material" not in public["missingRequiredValues"]


def test_values_can_be_filled_in_place(tmp_path: Path) -> None:
    bridge, job_id = _bridge(tmp_path, "fill")
    bridge._product_jobs[job_id].payload["requiredValues"] = {}

    job = bridge.update_product_values(job_id, {"usage": "선물포장", "size": "55x55cm"})

    assert job["requiredValues"]["usage"] == "선물포장"
    assert job["requiredValues"]["size"] == "55x55cm"
    assert "usage" not in job["missingRequiredValues"]


def test_filling_keeps_the_values_that_were_already_there(tmp_path: Path) -> None:
    # 한 칸만 채우려고 눌렀는데 나머지가 지워지면 투입값을 통째로 다시 써야 한다.
    bridge, job_id = _bridge(tmp_path, "merge")
    bridge._product_jobs[job_id].payload["requiredValues"] = {"material": "면 100%"}

    job = bridge.update_product_values(job_id, {"usage": "선물포장"})

    assert job["requiredValues"]["material"] == "면 100%"
    assert job["requiredValues"]["usage"] == "선물포장"


def test_unknown_keys_are_refused(tmp_path: Path) -> None:
    # 계약에 없는 키를 받아 두면 조립공장이 payload 전체를 거절한다.
    bridge, job_id = _bridge(tmp_path, "unknown")

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_values(job_id, {"nope": "x"})
    assert error.value.code == "factory_product_values_invalid"


def test_a_running_job_is_not_edited_underneath(tmp_path: Path) -> None:
    # 조립공장이 이미 그 값으로 돌고 있는데 바꾸면, 화면과 결과가 어긋난다.
    bridge, job_id = _bridge(tmp_path, "busy")
    bridge._product_jobs[job_id].status = "running"

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_values(job_id, {"usage": "선물포장"})
    assert error.value.code == "factory_product_job_busy"


def test_empty_request_is_refused(tmp_path: Path) -> None:
    bridge, job_id = _bridge(tmp_path, "empty")

    with pytest.raises(FactorySyncError):
        bridge.update_product_values(job_id, {})
