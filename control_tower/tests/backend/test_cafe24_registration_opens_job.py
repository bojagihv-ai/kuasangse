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


def test_blocked_job_with_a_completed_checkpoint_can_be_registered_again(tmp_path: Path) -> None:
    # 등록값이 없어 거절되면 작업은 차단으로 남는다. 생성은 이미 끝나 있으므로, 값을
    # 채워 다시 지시하는 길을 막으면 사람이 코드를 고치기 전까지 영영 등록할 수 없다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "declined")
    job = bridge._product_jobs[job_id]
    # 실제 거절 흐름: 생성 완료 시점의 저장 지점이 남은 채 등록만 거절돼 차단된다.
    job.checkpoint = {**(job.checkpoint or {}), "status": "completed"}
    job.status = "blocked"
    job.message = "factory_cafe24_registration_declined: 등록 차단: category_id"

    order = bridge.queue_cafe24_registration(job_id, {"categoryId": "119"})

    assert _payload(order)["cafe24"]["categoryId"] == "119"
    assert _payload(order)["checkpoint"]["jobId"] == job_id


def test_blocked_job_without_a_finished_build_still_cannot_register(tmp_path: Path) -> None:
    # 생성이 끝나지 않은 작업까지 열어 주면 반쪽짜리 상세페이지가 스토어로 나간다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "halfbuilt")
    job = bridge._product_jobs[job_id]
    job.status = "blocked"
    job.checkpoint = {**(job.checkpoint or {}), "status": "waiting_manual"}

    with pytest.raises(FactorySyncError) as error:
        bridge.queue_cafe24_registration(job_id, {})
    assert error.value.code == "factory_cafe24_job_not_ready"


def test_registration_mode_can_be_chosen(tmp_path: Path) -> None:
    # 스토어에 같은 제품이 있으면 조립공장은 기본적으로 그 상품을 고치려 한다. 새 상품으로
    # 올리라고 지시할 길이 없으면, 살아 있는 상품을 덮어쓰는 것 말고는 방법이 없다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "regmode")

    order = bridge.queue_cafe24_registration(job_id, {"registrationMode": "create"})

    assert _payload(order)["cafe24"]["registrationMode"] == "create"


def test_unknown_registration_mode_is_refused(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "regmodebad")

    with pytest.raises(FactorySyncError) as error:
        bridge.queue_cafe24_registration(job_id, {"registrationMode": "replace"})
    assert error.value.code == "factory_cafe24_values_invalid"


def test_registration_mode_may_be_left_to_the_factory(tmp_path: Path) -> None:
    # 지정하지 않으면 조립공장이 스스로 판단한다. 예전 동작을 그대로 둔다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "regmodenone")

    order = bridge.queue_cafe24_registration(job_id, {})

    assert "registrationMode" not in _payload(order)["cafe24"]
