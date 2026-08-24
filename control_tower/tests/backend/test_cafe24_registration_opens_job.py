"""워커가 다른 제품을 물고 있어도 완성된 작업을 등록할 수 있어야 한다."""

from __future__ import annotations

from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_cafe24_registration_order import _completed


def _payload(order):
    return order["command"]["payload"]


def _point_worker_elsewhere(bridge: FactorySyncBridge) -> None:
    bridge._projection["registration"] = {"jobId": "factory-job-other"}
    bridge._projection["session"] = {
        "workspaceId": "batch:factory-job-other",
        "productId": "factory:다른제품",
        "productKey": "다른제품",
        "runId": "run-other",
        "inputFingerprint": "other",
        "revision": 3,
    }


def test_registration_carries_the_checkpoint_when_worker_holds_another_product(tmp_path: Path) -> None:
    # 여기서 막으면 완성된 제품이 워커의 현재 상태에 따라 등록되기도 하고 안 되기도 한다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "openself")
    _point_worker_elsewhere(bridge)

    order = bridge.queue_cafe24_registration(job_id, {})

    assert _payload(order)["jobId"] == job_id
    assert _payload(order)["checkpoint"]["jobId"] == job_id


def test_registration_identity_comes_from_the_checkpoint_not_the_open_product(tmp_path: Path) -> None:
    # 열려 있던 다른 제품의 식별값을 실어 보내면 엉뚱한 상품이 스토어로 나간다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "openident")
    checkpoint = dict(bridge._product_jobs[job_id].checkpoint or {})
    _point_worker_elsewhere(bridge)

    order = bridge.queue_cafe24_registration(job_id, {})

    assert order["productKey"] == checkpoint["productKey"]
    assert order["currentRunId"] == checkpoint["runId"]
    assert order["productKey"] != "다른제품"


def test_registration_without_a_checkpoint_still_requires_the_open_product(tmp_path: Path) -> None:
    # 열 방법이 없으면 잘못된 제품을 등록하느니 거절하는 편이 낫다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "opennone")
    bridge._product_jobs[job_id].checkpoint = None
    _point_worker_elsewhere(bridge)

    with pytest.raises(FactorySyncError) as error:
        bridge.queue_cafe24_registration(job_id, {})
    assert error.value.code == "factory_cafe24_target_mismatch"


def test_registration_uses_the_live_session_when_the_product_is_already_open(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, done = _completed(bridge, "openlive")

    order = bridge.queue_cafe24_registration(job_id, {})

    assert order["productKey"] == done["session"]["productKey"]
    assert _payload(order)["jobId"] == job_id


def test_public_job_tells_whether_registration_values_exist(tmp_path: Path) -> None:
    # 분류 입력이 생기기 전에 투입된 작업은 이 값이 비어 있다. 화면이 그것을 알아야
    # 사람에게 값을 받을 수 있고, 모른 채 지시하면 "등록 차단: category_id" 로 끝난다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "values")

    public = bridge._public_product_job(bridge._product_jobs[job_id])

    assert "cafe24Values" in public
    assert isinstance(public["cafe24Values"], dict)


def test_public_job_reports_the_values_that_were_supplied(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "supplied")
    job = bridge._product_jobs[job_id]
    job.payload["requiredValues"] = {
        **(job.payload.get("requiredValues") or {}),
        "cafe24CategoryId": "119",
        "supplyPrice": "500",
    }

    public = bridge._public_product_job(job)

    assert public["cafe24Values"]["categoryId"] == "119"
    assert public["cafe24Values"]["supplyPrice"] == "500"
