from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_factory_sync import (
    _hello,
    _manual_product_job_payload,
    _product_checkpoint,
    _product_projection,
)
from test_parallel_production_board import _job, _live_worker, _run_to_waiting_manual


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


def test_registration_order_carries_the_target_values(tmp_path: Path) -> None:
    """관제탑이 지정한 분류·판매가·진열이 주문에 실려야 한다.

    조립공장에는 등록 화면이 없어 이 값을 주지 않으면 등록이 빈 값으로 어긋난다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24ok")

    order = bridge.queue_cafe24_registration(
        job_id,
        {"categoryId": "119", "salePrice": "2700", "displayStatus": "F"},
    )
    command = order["command"]
    assert command["name"] == "registerFactoryCafe24"
    assert command["payload"]["jobId"] == job_id
    assert command["payload"]["cafe24"] == {
        "categoryId": "119",
        "salePrice": "2700",
        "displayStatus": "F",
    }
    assert _job(bridge, job_id)["status"] == "completed"


def test_registration_receipt_marks_the_job_registered(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, done = _completed(bridge, "cafe24receipt")
    order = bridge.queue_cafe24_registration(job_id, {"categoryId": "119", "salePrice": "2700"})

    worker = _live_worker()
    claimed = None
    for _ in range(4):
        claimed = bridge.claim(worker)["order"]
        if claimed is None or claimed["orderId"] == order["orderId"]:
            break
    assert claimed is not None and claimed["orderId"] == order["orderId"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    bridge.lifecycle(
        order["orderId"],
        "complete",
        {
            **order,
            "workerId": worker["workerId"],
            "eventSequence": 2,
            "result": {
                "schema": "factory-cafe24-registration-receipt:v1",
                "jobId": job_id,
                "productNo": "5123",
                "projection": done,
                "checkpoint": _product_checkpoint(
                    job_id, done, status="completed", stage_key="cafe24"
                ),
            },
        },
    )

    registered = _job(bridge, job_id)
    assert registered["status"] == "completed"
    assert "5123" in registered["message"], registered["message"]
    assert bridge._product_jobs[job_id].stage_key == "cafe24"


def test_a_job_that_is_not_done_cannot_be_registered(tmp_path: Path) -> None:
    """아직 만들고 있는 작업을 스토어에 올리지 않는다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="cafe24early"))["jobId"])
    with pytest.raises(FactorySyncError) as raised:
        bridge.queue_cafe24_registration(job_id, {"categoryId": "119"})
    assert raised.value.code == "factory_cafe24_job_not_ready"


def test_unknown_target_values_are_rejected(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    job_id, _ = _completed(bridge, "cafe24bad")
    with pytest.raises(FactorySyncError) as raised:
        bridge.queue_cafe24_registration(job_id, {"categoryId": "119", "무엇": "x"})
    assert raised.value.code == "factory_cafe24_values_invalid"

def test_intake_category_flows_into_the_registration_order(tmp_path: Path) -> None:
    """투입할 때 고른 제품분류가 등록 주문까지 그대로 간다.

    이것이 없으면 운영자가 관제탑에서 분류를 지정할 방법이 없어, 등록 뒤 스토어에서
    손으로 다시 골라야 한다.
    """
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    payload = _manual_product_job_payload(suffix="intakecat")
    payload["requiredValues"] = {
        **payload["requiredValues"],
        "cafe24CategoryId": "119",
        "supplyPrice": "500",
        "displayStatus": "F",
        "sellingStatus": "F",
    }
    job_id = str(bridge.queue_product(payload)["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    done = _product_projection(job_id, sequence=200, revision=40)
    bridge.accept_session_projection(_envelope(done, cursor=40))
    job = bridge._product_jobs[job_id]
    job.status = "completed"
    job.current_order_id = ""

    order = bridge.queue_cafe24_registration(job_id, None)
    values = order["command"]["payload"]["cafe24"]
    assert values["categoryId"] == "119"
    assert values["supplyPrice"] == "500"
    assert values["displayStatus"] == "F"
    assert values["sellingStatus"] == "F"
    assert values["salePrice"] == payload["requiredValues"]["salePrice"]


def test_an_explicit_request_overrides_the_intake_value(tmp_path: Path) -> None:
    """등록할 때 다시 고르면 그것이 이긴다."""
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    payload = _manual_product_job_payload(suffix="override")
    payload["requiredValues"] = {**payload["requiredValues"], "cafe24CategoryId": "119"}
    job_id = str(bridge.queue_product(payload)["jobId"])
    _run_to_waiting_manual(bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8)
    bridge.accept_session_projection(
        _envelope(_product_projection(job_id, sequence=200, revision=40), cursor=40)
    )
    job = bridge._product_jobs[job_id]
    job.status = "completed"
    job.current_order_id = ""

    order = bridge.queue_cafe24_registration(job_id, {"categoryId": "142"})
    assert order["command"]["payload"]["cafe24"]["categoryId"] == "142"
