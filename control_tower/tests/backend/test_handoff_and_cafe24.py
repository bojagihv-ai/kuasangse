from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest

from control_tower.backend.cafe24_bridge import (
    CAFE24_COMMAND_KIND,
    CAFE24_COMMAND_NAME,
    CAFE24_RECONCILE_COMMAND_NAME,
    CAFE24_COMMAND_VERSION,
    Cafe24BridgeError,
    QueuedCafe24CommandBridge,
    build_cafe24_command,
    build_cafe24_reconcile_command,
)
from control_tower.backend.cafe24_staging import (
    APPROVAL_BINDING_FIELDS,
    Cafe24ApprovalGate,
    Cafe24StagingError,
    SAFE_DEFAULTS,
    build_preview,
    verify_readback,
)
from control_tower.backend.handoff import HandoffError, HandoffStore


def test_handoff_is_one_time_and_rejects_stale_revision() -> None:
    now = [100.0]
    store = HandoffStore(clock=lambda: now[0])
    issued = store.issue({"productId": "p1", "jobId": "j1", "workspaceId": "w1", "expectedRevision": 4}, factory_url="http://127.0.0.1:8081")
    with pytest.raises(HandoffError, match="stale_workfile_revision"):
        store.consume(str(issued["handoffToken"]), expected_revision=3)
    issued = store.issue({"productId": "p1", "jobId": "j1", "workspaceId": "w1", "expectedRevision": 4}, factory_url="http://127.0.0.1:8081")
    token = str(issued["handoffToken"])
    assert store.consume(token, expected_revision=4)["workspaceId"] == "w1"
    with pytest.raises(HandoffError, match="handoff_expired"):
        store.consume(token, expected_revision=4)


def test_cafe24_preview_is_safe_idempotent_and_readback_verified() -> None:
    preview = build_preview({"batchId": "b1", "productId": "p1", "productKey": "p1-key", "categoryId": "cat", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 3, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    assert preview["approvalRequired"] is True
    assert preview["externalWrite"] is False
    assert verify_readback({"payloadDigest": preview["payloadDigest"], "idempotencyKey": preview["idempotencyKey"]}, {"payloadDigest": preview["payloadDigest"], "externalProductNo": "42"})["status"] == "staged_verified"
    with pytest.raises(Cafe24StagingError, match="cafe24_readback_digest_mismatch"):
        verify_readback(preview, {"payloadDigest": "wrong"})


def test_cafe24_approval_gate_binds_once_to_payload_and_runtime_fence() -> None:
    preview = build_preview({"batchId": "b1", "productId": "p1", "productKey": "p1-key", "categoryId": "cat", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 3, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    gate = Cafe24ApprovalGate()
    request = gate.issue(preview)
    binding = {key: preview[key] if key in preview else preview["payload"][key] for key in ("payloadDigest", "productId", "productKey", "expectedWorkfileRevision", "expectedRunId", "expectedInputFingerprint", "idempotencyKey")}

    with pytest.raises(Cafe24StagingError, match="approval_binding_mismatch"):
        gate.approve(str(request["approvalRequestId"]), {**binding, "payloadDigest": "tampered"})
    approved = gate.approve(str(request["approvalRequestId"]), binding)
    with pytest.raises(Cafe24StagingError, match="stale_approval"):
        gate.consume(str(approved["approvalToken"]), {**binding, "expectedWorkfileRevision": 4})
    with pytest.raises(Cafe24StagingError, match="approval_token_reused"):
        gate.consume(str(approved["approvalToken"]), binding)
    request = gate.issue(preview)
    approved = gate.approve(str(request["approvalRequestId"]), binding)
    grant = gate.consume(str(approved["approvalToken"]), binding)

    assert grant["payloadDigest"] == preview["payloadDigest"]
    assert grant["approvalGrantDigest"]
    with pytest.raises(Cafe24StagingError, match="approval_token_reused"):
        gate.consume(str(approved["approvalToken"]), binding)


def test_cafe24_approval_validation_failure_requires_a_fresh_token_and_reservation_is_single_flight() -> None:
    preview = build_preview({"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 3, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    binding = {
        key: preview[key] if key in preview else preview["payload"][key]
        for key in APPROVAL_BINDING_FIELDS
    }
    gate = Cafe24ApprovalGate()
    request = gate.issue(preview)
    approved = gate.approve(str(request["approvalRequestId"]), binding)
    token = str(approved["approvalToken"])

    with pytest.raises(Cafe24StagingError, match="approval_binding_mismatch"):
        gate.reserve(token, {**binding, "productId": "cafe24:594"})
    with pytest.raises(Cafe24StagingError, match="approval_token_reused"):
        gate.reserve(token, binding)

    fresh_request = gate.issue(preview)
    fresh_approved = gate.approve(str(fresh_request["approvalRequestId"]), binding)
    fresh_token = str(fresh_approved["approvalToken"])

    def reserve_once() -> str:
        try:
            grant = gate.reserve(fresh_token, binding)
            return str(grant["approvalGrantDigest"])
        except Cafe24StagingError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=8) as executor:
        outcomes = list(executor.map(lambda _index: reserve_once(), range(8)))

    grant_digests = [outcome for outcome in outcomes if outcome != "approval_token_reused"]
    assert len(grant_digests) == 1
    assert outcomes.count("approval_token_reused") == 7
    gate.commit(grant_digests[0])
    with pytest.raises(Cafe24StagingError, match="approval_token_reused"):
        gate.reserve(fresh_token, binding)


def test_cafe24_command_contract_is_versioned_and_never_contains_raw_approval_token() -> None:
    preview = build_preview({"batchId": "b1", "productId": "p1", "productKey": "p1-key", "categoryId": "cat", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 3, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    command = build_cafe24_command(preview, "grant-digest")
    assert command["capabilityVersion"] == CAFE24_COMMAND_VERSION
    assert command["command"] == {"kind": CAFE24_COMMAND_KIND, "version": CAFE24_COMMAND_VERSION, "name": CAFE24_COMMAND_NAME, "payload": {**preview["payload"], "approvalGrantDigest": "grant-digest"}}
    assert "approvalToken" not in str(command)


def test_cafe24_reconcile_command_is_read_only_and_bound_to_original_preview() -> None:
    preview = build_preview({"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})

    command = build_cafe24_reconcile_command(preview, job_id="job-1")

    assert command["command"]["name"] == CAFE24_RECONCILE_COMMAND_NAME
    assert command["command"]["payload"] == {**preview["payload"], "jobId": "job-1"}
    assert command["payloadDigest"] == preview["payloadDigest"]
    assert "approvalToken" not in str(command)
    assert "approvalGrantDigest" not in str(command)


def test_queued_cafe24_bridge_rendezvous_returns_remote_digest_and_replays_idempotently() -> None:
    preview = build_preview({"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    command = build_cafe24_command(preview, "grant-digest", job_id="job-1")
    bridge = QueuedCafe24CommandBridge(execution_timeout_seconds=1.0)

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(bridge.execute, command)
        claimed = bridge.claim({"workerId": "worker-1", "contractVersion": "control-work-order:v1", "capabilityVersion": "batch-control-worker:v1"})
        order = claimed["order"]
        assert isinstance(order, dict)
        order_id = str(order["orderId"])
        bridge.lifecycle(order_id, "ack", {**order, "workerId": "worker-1", "accepted": True, "eventSequence": 1})
        result = {
            "status": "staged_verified",
            "payloadDigest": preview["payloadDigest"],
            "remoteReadbackDigest": "remote-html-digest",
            "externalProductNo": "2994",
            "idempotencyKey": preview["idempotencyKey"],
        }
        bridge.lifecycle(order_id, "events", {**order, "workerId": "worker-1", "status": "completed", "eventSequence": 2, "result": result})
        bridge.lifecycle(order_id, "complete", {**order, "workerId": "worker-1", "eventSequence": 2, "result": result})
        assert pending.result(timeout=1) == result

    assert bridge.execute(command) == result
    assert bridge.claim({"workerId": "worker-1", "contractVersion": "control-work-order:v1", "capabilityVersion": "batch-control-worker:v1"})["order"] is None


def test_queued_cafe24_bridge_returns_read_only_factory_preflight() -> None:
    bridge = QueuedCafe24CommandBridge(execution_timeout_seconds=1.0)

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(bridge.inspect)
        claimed = bridge.claim({"workerId": "worker-1", "contractVersion": "control-work-order:v1", "capabilityVersion": "batch-control-worker:v1"})
        order = claimed["order"]
        assert isinstance(order, dict)
        assert order["command"] == {
            "kind": "factory-cafe24",
            "version": "factory-cafe24-command:v1",
            "name": "inspectDetailToCafe24",
            "payload": {},
        }
        order_id = str(order["orderId"])
        bridge.lifecycle(order_id, "ack", {**order, "workerId": "worker-1", "accepted": True, "eventSequence": 1})
        result = {
            "schema": "factory-cafe24-preflight:v1",
            "status": "ready",
            "reason": "",
            "productId": "cafe24:2994",
            "productKey": "방울수저집",
            "htmlDigest": "canonical-html",
            "imageDigests": ["image-1"],
            "expectedWorkfileRevision": 108,
            "expectedRunId": "run-1",
            "expectedInputFingerprint": "fp-1",
        }
        bridge.lifecycle(order_id, "complete", {**order, "workerId": "worker-1", "eventSequence": 2, "result": result})

        assert pending.result(timeout=1) == result


def test_queued_cafe24_bridge_rejects_stale_worker_identity_and_tampered_result() -> None:
    preview = build_preview({"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    command = build_cafe24_command(preview, "grant-digest", job_id="job-1")
    bridge = QueuedCafe24CommandBridge(execution_timeout_seconds=1.0)

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(bridge.execute, command)
        order = bridge.claim({"workerId": "worker-1", "contractVersion": "control-work-order:v1", "capabilityVersion": "batch-control-worker:v1"})["order"]
        assert isinstance(order, dict)
        order_id = str(order["orderId"])
        with pytest.raises(Cafe24BridgeError, match="stale_run_fingerprint"):
            bridge.lifecycle(order_id, "ack", {**order, "currentRunId": "stale-run", "workerId": "worker-1", "accepted": True, "eventSequence": 1})
        bridge.lifecycle(order_id, "ack", {**order, "workerId": "worker-1", "accepted": True, "eventSequence": 1})
        with pytest.raises(Cafe24BridgeError, match="factory_cafe24_result_digest_mismatch"):
            bridge.lifecycle(order_id, "complete", {
                **order,
                "workerId": "worker-1",
                "eventSequence": 2,
                "result": {
                    "status": "staged_verified",
                    "payloadDigest": "tampered",
                    "remoteReadbackDigest": "remote-html-digest",
                    "externalProductNo": "2994",
                    "idempotencyKey": preview["idempotencyKey"],
                },
            })
        bridge.lifecycle(order_id, "fail", {**order, "workerId": "worker-1", "eventSequence": 2, "error": "test-stop"})
        with pytest.raises(Cafe24BridgeError, match="test-stop"):
            pending.result(timeout=1)
