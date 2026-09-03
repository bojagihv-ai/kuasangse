"""작업 큐 삭제 — 화면에서만 지우지 않고 저장 파일에서도 실제로 없앤다.

2026-09-04: 잘못 넣은 제품(엉뚱한 이름·엉뚱한 경쟁사로 오염된 결과)을 지울 방법이 없어
큐에 유령처럼 남았다. "명목상으로만 삭제가 아니라 실제 기록상으로 지워지게" — 삭제 뒤
완전히 새로 띄운 브리지(재기동과 같다)로 같은 파일을 다시 읽어도 그 작업이 없어야 한다.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_factory_sync import _hello, _manual_product_job_payload


def _queued(bridge: FactorySyncBridge, suffix: str) -> str:
    # 워커가 붙어 있으면 queue_product 가 곧바로 주문을 내보내 current_order_id 가 찬다.
    # 실제로 지우고 싶은 경우는 그 주문이 끝난(성공/차단 뒤) 자리이므로, 기본은 비운 채로
    # 시작한다 — '아직 나가 있는 주문' 시험만 따로 다시 채운다.
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix=suffix))["jobId"])
    bridge._product_jobs[job_id].current_order_id = ""
    return job_id


def test_removed_job_is_actually_gone_from_the_persisted_file(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    job_id = _queued(bridge, "gone")

    result = bridge.remove_product_job(job_id)

    assert result == {"jobId": job_id, "productName": "직접 입력 제품 gone", "removed": True}
    assert job_id not in bridge._product_jobs
    assert job_id not in {job["jobId"] for job in bridge.product_jobs()}

    # 명목상 삭제가 아니라는 증거: 파일 자체에 그 jobId 문자열이 아예 없다.
    on_disk = state_path.read_text(encoding="utf-8")
    assert job_id not in on_disk

    # 재기동과 같은 조건 — 완전히 새 브리지가 같은 파일을 읽어도 없어야 한다.
    restarted = FactorySyncBridge(state_path=state_path)
    assert job_id not in restarted._product_jobs
    with pytest.raises(FactorySyncError) as missing:
        restarted.remove_product_job(job_id)
    assert missing.value.code == "factory_product_job_not_found"


def test_deleting_an_unknown_job_fails_clearly(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())

    with pytest.raises(FactorySyncError) as error:
        bridge.remove_product_job("factory-job-never-existed")
    assert error.value.code == "factory_product_job_not_found"


def test_cannot_delete_a_job_that_is_currently_dispatched_to_the_worker(tmp_path: Path) -> None:
    # 조립공장에 이미 나가 있는 주문의 jobId 가 갑자기 없어지면 워커가 돌아올 자리를 잃는다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = _queued(bridge, "busy")
    bridge._product_jobs[job_id].current_order_id = "factory-order-in-flight"

    with pytest.raises(FactorySyncError) as error:
        bridge.remove_product_job(job_id)
    assert error.value.code == "factory_product_job_busy"
    assert job_id in bridge._product_jobs  # 실패했으면 아무것도 지워지지 않아야 한다


def test_cannot_delete_the_job_the_workspace_is_currently_on(tmp_path: Path) -> None:
    # 화면이 존재하지 않는 작업을 계속 가리키게 되는 것을 막는다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = _queued(bridge, "active")
    bridge._projection = {"registration": {"jobId": job_id}, "session": {}}

    with pytest.raises(FactorySyncError) as error:
        bridge.remove_product_job(job_id)
    assert error.value.code == "factory_product_job_active_session"
    assert job_id in bridge._product_jobs

    # 워크스페이스가 다른 작업으로 넘어가면(또는 아예 없어지면) 그때는 지울 수 있다.
    bridge._projection = {"registration": {"jobId": "factory-job-somewhere-else"}, "session": {}}
    result = bridge.remove_product_job(job_id)
    assert result["removed"] is True


def test_cannot_delete_a_job_already_registered_to_cafe24(tmp_path: Path) -> None:
    # Cafe24 에 실제로 올라간 기록은 외부에 실제로 벌어진 일의 증거다 — 지우지 않는다.
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = _queued(bridge, "registered")
    bridge._product_jobs[job_id].progress = {"registration": {"status": "staged_verified"}}

    with pytest.raises(FactorySyncError) as error:
        bridge.remove_product_job(job_id)
    assert error.value.code == "factory_product_job_already_registered"
    assert job_id in bridge._product_jobs


def test_deleting_one_job_leaves_the_rest_of_the_file_untouched(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    kept_id = _queued(bridge, "kept")
    doomed_id = _queued(bridge, "doomed")

    bridge.remove_product_job(doomed_id)

    document = json.loads(state_path.read_text(encoding="utf-8"))
    remaining_ids = {job["jobId"] for job in document["jobs"]}
    assert remaining_ids == {kept_id}
    assert bridge.product_job_context(kept_id)["payload"]["productName"] == "직접 입력 제품 kept"
