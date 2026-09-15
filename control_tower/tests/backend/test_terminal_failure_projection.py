from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from control_tower.backend.factory_sync import FactorySyncBridge

from test_factory_sync import _hello, _manual_product_job_payload, _product_projection
from test_parallel_production_board import _job, _live_worker


def _session_envelope(projection: dict[str, Any], *, cursor: int) -> dict[str, Any]:
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


def test_product_failure_stores_terminal_projection_trace_in_job_progress(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="terminal-trace"))["jobId"])
    order = bridge.claim(_live_worker())["order"]
    assert isinstance(order, dict)
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": "factory-worker-live", "accepted": True, "eventSequence": 1},
    )

    old = _product_projection(job_id, sequence=8, revision=10)
    old["progress"].update({"stageKey": "detail", "percent": 86, "status": "failed"})
    bridge.accept_session_projection(_session_envelope(old, cursor=8))

    terminal = deepcopy(old)
    terminal["sequence"] = 9
    terminal["cursor"] = "9"
    terminal["session"]["revision"] = 11
    terminal["progress"]["trace"] = {
        "schema": "factory-detail-stage-debug:v1",
        "correlationId": "job-terminal-trace:workspace:run:11:trace",
        "jobId": job_id,
        "workspaceId": f"batch:{job_id}",
        "runId": f"run:{job_id}",
        "revision": 11,
        "phase": "request_timeout",
        "request": "Key Features",
        "sectionId": "key_features",
        "sectionName": "핵심 특징",
        "errorCode": "factory_section_request_timeout",
        "at": 11,
        "requestTimeoutMs": 240000,
    }
    bridge.lifecycle(
        order["orderId"],
        "fail",
        {
            **order,
            "workerId": "factory-worker-live",
            "eventSequence": 2,
            "error": "factory_section_request_timeout",
            "terminalProjection": terminal,
        },
    )

    job = _job(bridge, job_id)
    assert job["status"] == "blocked"
    assert job["progress"]["percent"] == 86
    assert job["progress"]["trace"]["phase"] == "request_timeout"
    assert job["progress"]["trace"]["sectionId"] == "key_features"


def test_final_detail_retry_dispatches_a_fresh_non_restore_order(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="fresh-detail"))["jobId"])
    worker = _live_worker()
    first_order = bridge.claim(worker)["order"]
    assert isinstance(first_order, dict)
    bridge.lifecycle(
        first_order["orderId"],
        "ack",
        {**first_order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    blocked = _product_projection(job_id, sequence=8, revision=10)
    blocked["progress"].update({"stageKey": "detail", "percent": 86, "status": "failed"})
    blocked["registration"]["jobId"] = job_id
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": job_id,
        "status": "blocked",
        "stageKey": "final_detail",
        "message": "13/14 sections · key_features missing",
        "projection": blocked,
        "checkpoint": {
            "schema": "factory-product-checkpoint:v1",
            "jobId": job_id,
            "projectId": f"batch:{job_id}",
            "productId": blocked["session"]["productId"],
            "productKey": blocked["session"]["productKey"],
            "runId": blocked["session"]["runId"],
            "inputFingerprint": blocked["session"]["inputFingerprint"],
            "revision": blocked["session"]["revision"],
            "status": "blocked",
            "stageKey": "final_detail",
            "savedAt": 1,
        },
    }
    completed = {
        **first_order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": receipt,
    }
    bridge.lifecycle(first_order["orderId"], "events", completed)
    bridge.lifecycle(first_order["orderId"], "complete", completed)

    newer = deepcopy(blocked)
    newer["sequence"] = 9
    newer["cursor"] = "9"
    newer["session"]["revision"] = 11
    bridge.accept_session_projection(_session_envelope(newer, cursor=9))
    bridge.resume_product(
        job_id,
        expected_checkpoint_revision=10,
        expected_checkpoint_run_id=blocked["session"]["runId"],
    )

    retry = bridge.claim(worker)["order"]
    assert isinstance(retry, dict)
    payload = retry["command"]["payload"]
    assert payload["expectedStageKey"] == "final_detail"
    assert payload["restoreOnly"] is False
    assert payload["startFresh"] is False
