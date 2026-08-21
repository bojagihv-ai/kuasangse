from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from threading import Event, RLock
from typing import Protocol
from uuid import uuid4

from .runtime_cache import JsonObject, JsonValue


CAFE24_COMMAND_KIND = "factory-cafe24"
CAFE24_COMMAND_NAME = "detailToCafe24"
CAFE24_PREFLIGHT_COMMAND_NAME = "inspectDetailToCafe24"
CAFE24_RECONCILE_COMMAND_NAME = "verifyDetailToCafe24"
CAFE24_COMMAND_VERSION = "factory-cafe24-command:v1"
WORK_ORDER_VERSION = "control-work-order:v1"
WORKER_CAPABILITY_VERSION = "batch-control-worker:v1"


class Cafe24BridgeError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class Cafe24CommandBridge(Protocol):
    def inspect(self) -> JsonObject: ...

    def execute(self, command: JsonObject) -> JsonObject: ...


class UnavailableCafe24CommandBridge:
    def inspect(self) -> JsonObject:
        raise Cafe24BridgeError("factory_cafe24_bridge_unavailable")

    def execute(self, command: JsonObject) -> JsonObject:
        raise Cafe24BridgeError("factory_cafe24_bridge_unavailable")


@dataclass(slots=True)
class _QueuedExecution:
    order: JsonObject
    payload_digest: str
    idempotency_key: str
    completed: Event = field(default_factory=Event)
    status: str = "pending"
    worker_id: str = ""
    target_worker_id: str = ""
    target_session_id: str = ""
    event_sequence: int = 0
    result: JsonObject | None = None
    error: str = ""


class QueuedCafe24CommandBridge:
    def __init__(
        self,
        *,
        execution_timeout_seconds: float = 900.0,
        worker_target: Callable[[], Mapping[str, JsonValue]] | None = None,
    ) -> None:
        if execution_timeout_seconds <= 0:
            raise ValueError("execution_timeout_seconds must be positive")
        self._execution_timeout_seconds = execution_timeout_seconds
        self._worker_target = worker_target
        self._lock = RLock()
        self._executions: dict[str, _QueuedExecution] = {}
        self._active_by_idempotency: dict[str, str] = {}
        self._completed_by_idempotency: dict[str, tuple[str, JsonObject]] = {}

    def execute(self, command: JsonObject) -> JsonObject:
        order = _build_work_order(command)
        payload_digest = _required_text(command, "payloadDigest")
        idempotency_key = _required_text(command, "idempotencyKey")
        with self._lock:
            completed = self._completed_by_idempotency.get(idempotency_key)
            if completed is not None:
                completed_digest, completed_result = completed
                if completed_digest != payload_digest:
                    raise Cafe24BridgeError("idempotency_conflict")
                return dict(completed_result)
            active_order_id = self._active_by_idempotency.get(idempotency_key)
            if active_order_id is not None:
                execution = self._executions[active_order_id]
                if execution.payload_digest != payload_digest:
                    raise Cafe24BridgeError("idempotency_conflict")
            else:
                target_worker_id, target_session_id = self._current_worker_target()
                if target_worker_id:
                    order["targetWorkerId"] = target_worker_id
                    order["workerSessionId"] = target_session_id
                execution = _QueuedExecution(
                    order=order,
                    payload_digest=payload_digest,
                    idempotency_key=idempotency_key,
                    target_worker_id=target_worker_id,
                    target_session_id=target_session_id,
                )
                order_id = str(order["orderId"])
                self._executions[order_id] = execution
                self._active_by_idempotency[idempotency_key] = order_id
        return self._await_execution(execution)

    def inspect(self) -> JsonObject:
        order = _build_preflight_work_order()
        payload_digest = str(order["payloadDigest"])
        idempotency_key = str(order["idempotencyKey"])
        target_worker_id, target_session_id = self._current_worker_target()
        if target_worker_id:
            order["targetWorkerId"] = target_worker_id
            order["workerSessionId"] = target_session_id
        execution = _QueuedExecution(
            order=order,
            payload_digest=payload_digest,
            idempotency_key=idempotency_key,
            target_worker_id=target_worker_id,
            target_session_id=target_session_id,
        )
        with self._lock:
            self._executions[str(order["orderId"])] = execution
            self._active_by_idempotency[idempotency_key] = str(order["orderId"])
        return self._await_execution(execution)

    def _current_worker_target(self) -> tuple[str, str]:
        if self._worker_target is None:
            return "", ""
        target = self._worker_target()
        worker_id = str(target.get("workerId") or "")
        session_id = str(target.get("sessionId") or "")
        if not worker_id or not session_id:
            raise Cafe24BridgeError("factory_session_missing")
        return worker_id, session_id

    def _await_execution(self, execution: _QueuedExecution) -> JsonObject:
        idempotency_key = execution.idempotency_key
        if not execution.completed.wait(self._execution_timeout_seconds):
            with self._lock:
                if not execution.completed.is_set():
                    execution.status = "timed_out"
                    execution.error = "factory_cafe24_bridge_timeout"
                    self._active_by_idempotency.pop(idempotency_key, None)
            raise Cafe24BridgeError("factory_cafe24_bridge_timeout")
        if execution.error:
            raise Cafe24BridgeError(execution.error)
        if execution.result is None:
            raise Cafe24BridgeError("factory_cafe24_result_missing")
        return dict(execution.result)

    def claim(self, payload: JsonObject) -> JsonObject:
        with self._lock:
            if not any(execution.status == "pending" for execution in self._executions.values()):
                return {"claimed": False, "order": None}
        worker_id = _required_text(payload, "workerId")
        session_id = str(payload.get("sessionId") or "")
        if payload.get("contractVersion") != WORK_ORDER_VERSION:
            raise Cafe24BridgeError("contract_version_unsupported")
        if payload.get("capabilityVersion") != WORKER_CAPABILITY_VERSION:
            raise Cafe24BridgeError("capability_version_unsupported")
        with self._lock:
            for execution in self._executions.values():
                if execution.status != "pending":
                    continue
                if (
                    execution.target_worker_id
                    and (
                        execution.target_worker_id != worker_id
                        or execution.target_session_id != session_id
                    )
                ):
                    continue
                execution.status = "claimed"
                execution.worker_id = worker_id
                return {"claimed": True, "order": dict(execution.order)}
        return {"claimed": False, "order": None}

    def owns(self, order_id: str) -> bool:
        with self._lock:
            return order_id in self._executions

    def lifecycle(self, order_id: str, action: str, payload: JsonObject) -> JsonObject:
        with self._lock:
            execution = self._executions.get(order_id)
            if execution is None:
                raise Cafe24BridgeError("work_order_not_found")
            _assert_work_order_identity(execution, payload)
            worker_id = _required_text(payload, "workerId")
            if execution.worker_id != worker_id:
                raise Cafe24BridgeError("lease_conflict")
            if execution.target_session_id and payload.get("workerSessionId") != execution.target_session_id:
                raise Cafe24BridgeError("stale_factory_session")
            sequence = payload.get("eventSequence")
            if not isinstance(sequence, int) or sequence < 0:
                raise Cafe24BridgeError("stale_event_sequence")
            if action == "heartbeat":
                if execution.status not in {"acknowledged", "running"} or sequence < execution.event_sequence:
                    raise Cafe24BridgeError("stale_event_sequence")
                return {"accepted": True, "orderId": order_id, "status": execution.status}
            if action == "ack":
                if payload.get("accepted") is not True or execution.status != "claimed" or sequence <= execution.event_sequence:
                    raise Cafe24BridgeError("stale_event_sequence")
                execution.event_sequence = sequence
                execution.status = "acknowledged"
                return {"accepted": True, "orderId": order_id, "status": execution.status}
            if action == "events":
                if execution.status not in {"acknowledged", "running"} or sequence <= execution.event_sequence:
                    raise Cafe24BridgeError("stale_event_sequence")
                execution.event_sequence = sequence
                execution.status = "running"
                return {"accepted": True, "orderId": order_id, "status": execution.status}
            if action == "complete":
                if execution.status not in {"acknowledged", "running"} or sequence < execution.event_sequence:
                    raise Cafe24BridgeError("stale_event_sequence")
                result = payload.get("result")
                if not isinstance(result, dict):
                    raise Cafe24BridgeError("factory_cafe24_result_missing")
                verified = _validate_result(execution, result)
                execution.event_sequence = max(sequence, execution.event_sequence)
                execution.result = verified
                execution.status = "completed"
                self._active_by_idempotency.pop(execution.idempotency_key, None)
                self._completed_by_idempotency[execution.idempotency_key] = (
                    execution.payload_digest,
                    dict(verified),
                )
                execution.completed.set()
                return {"accepted": True, "orderId": order_id, "status": execution.status}
            if action == "fail":
                if execution.status not in {"claimed", "acknowledged", "running"} or sequence < execution.event_sequence:
                    raise Cafe24BridgeError("stale_event_sequence")
                execution.event_sequence = max(sequence, execution.event_sequence)
                execution.status = "failed"
                execution.error = str(payload.get("error") or "factory_cafe24_worker_failed")
                self._active_by_idempotency.pop(execution.idempotency_key, None)
                execution.completed.set()
                return {"accepted": True, "orderId": order_id, "status": execution.status}
            raise Cafe24BridgeError("worker_action_invalid")


def build_cafe24_command(preview: Mapping[str, JsonValue], approval_grant_digest: str, *, job_id: str = "") -> JsonObject:
    payload = preview.get("payload")
    if not isinstance(payload, dict) or not approval_grant_digest.strip():
        raise Cafe24BridgeError("factory_cafe24_command_invalid")
    command_payload: JsonObject = {key: value for key, value in payload.items()}
    command_payload["approvalGrantDigest"] = approval_grant_digest
    if job_id.strip():
        command_payload["jobId"] = job_id
    return {
        "capabilityVersion": CAFE24_COMMAND_VERSION,
        "command": {
            "kind": CAFE24_COMMAND_KIND,
            "version": CAFE24_COMMAND_VERSION,
            "name": CAFE24_COMMAND_NAME,
            "payload": command_payload,
        },
        "payloadDigest": preview.get("payloadDigest"),
        "idempotencyKey": preview.get("idempotencyKey"),
    }


def build_cafe24_reconcile_command(preview: Mapping[str, JsonValue], *, job_id: str) -> JsonObject:
    payload = preview.get("payload")
    if not isinstance(payload, dict) or not job_id.strip():
        raise Cafe24BridgeError("factory_cafe24_command_invalid")
    return {
        "capabilityVersion": CAFE24_COMMAND_VERSION,
        "command": {
            "kind": CAFE24_COMMAND_KIND,
            "version": CAFE24_COMMAND_VERSION,
            "name": CAFE24_RECONCILE_COMMAND_NAME,
            "payload": {**payload, "jobId": job_id.strip()},
        },
        "payloadDigest": preview.get("payloadDigest"),
        "idempotencyKey": f"{_required_text(preview, 'idempotencyKey')}:reconcile",
    }


def _required_text(mapping: Mapping[str, JsonValue], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise Cafe24BridgeError(f"factory_cafe24_field_missing:{key}")
    return value.strip()


def _build_work_order(command: JsonObject) -> JsonObject:
    if command.get("capabilityVersion") != CAFE24_COMMAND_VERSION:
        raise Cafe24BridgeError("factory_cafe24_command_version_unsupported")
    nested = command.get("command")
    if not isinstance(nested, dict):
        raise Cafe24BridgeError("factory_cafe24_command_invalid")
    command_name = nested.get("name")
    if (
        nested.get("kind") != CAFE24_COMMAND_KIND
        or command_name not in {CAFE24_COMMAND_NAME, CAFE24_RECONCILE_COMMAND_NAME}
        or nested.get("version") != CAFE24_COMMAND_VERSION
    ):
        raise Cafe24BridgeError("factory_cafe24_command_version_unsupported")
    payload = nested.get("payload")
    if not isinstance(payload, dict) or "approvalToken" in payload:
        raise Cafe24BridgeError("factory_cafe24_command_invalid")
    expected_revision = payload.get("expectedWorkfileRevision")
    if not isinstance(expected_revision, int) or expected_revision < 0:
        raise Cafe24BridgeError("factory_cafe24_revision_invalid")
    payload_digest = _required_text(command, "payloadDigest")
    operation_token = (
        f"cafe24:{_required_text(payload, 'approvalGrantDigest')}"
        if command_name == CAFE24_COMMAND_NAME
        else f"cafe24-reconcile:{payload_digest}"
    )
    return {
        "orderId": f"cafe24-{uuid4().hex}",
        "contractVersion": WORK_ORDER_VERSION,
        "capabilityVersion": WORKER_CAPABILITY_VERSION,
        "batchId": _required_text(payload, "batchId"),
        "productId": _required_text(payload, "productId"),
        "productKey": _required_text(payload, "productKey"),
        "currentRunId": _required_text(payload, "expectedRunId"),
        "stageId": "cafe24",
        "operationToken": operation_token,
        "idempotencyKey": _required_text(command, "idempotencyKey"),
        "expectedWorkfileRevision": expected_revision,
        "payloadDigest": payload_digest,
        "command": dict(nested),
    }


def _build_preflight_work_order() -> JsonObject:
    execution_id = uuid4().hex
    fence = f"cafe24-preflight:{execution_id}"
    return {
        "orderId": f"cafe24-preflight-{execution_id}",
        "contractVersion": WORK_ORDER_VERSION,
        "capabilityVersion": WORKER_CAPABILITY_VERSION,
        "batchId": "cafe24-preflight",
        "productId": "cafe24-preflight",
        "productKey": "cafe24-preflight",
        "currentRunId": "cafe24-preflight",
        "stageId": "cafe24",
        "operationToken": fence,
        "idempotencyKey": fence,
        "expectedWorkfileRevision": 0,
        "payloadDigest": fence,
        "command": {
            "kind": CAFE24_COMMAND_KIND,
            "version": CAFE24_COMMAND_VERSION,
            "name": CAFE24_PREFLIGHT_COMMAND_NAME,
            "payload": {},
        },
    }


def _assert_work_order_identity(execution: _QueuedExecution, payload: Mapping[str, JsonValue]) -> None:
    order = execution.order
    for field in ("orderId", "productId", "productKey", "currentRunId", "operationToken", "idempotencyKey", "expectedWorkfileRevision"):
        if payload.get(field) != order.get(field):
            if field in {"currentRunId", "productId", "productKey"}:
                raise Cafe24BridgeError("stale_run_fingerprint")
            if field == "expectedWorkfileRevision":
                raise Cafe24BridgeError("stale_workfile_revision")
            raise Cafe24BridgeError("stale_fencing_token")


def _validate_result(execution: _QueuedExecution, result: Mapping[str, JsonValue]) -> JsonObject:
    command = execution.order.get("command")
    if isinstance(command, dict) and command.get("name") == CAFE24_PREFLIGHT_COMMAND_NAME:
        if result.get("schema") != "factory-cafe24-preflight:v1" or result.get("status") not in {"ready", "blocked"}:
            raise Cafe24BridgeError("factory_cafe24_preflight_invalid")
        image_digests = result.get("imageDigests")
        if not isinstance(image_digests, list) or any(not isinstance(item, str) or not item.strip() for item in image_digests):
            raise Cafe24BridgeError("factory_cafe24_preflight_invalid")
        if result.get("status") == "ready":
            for field in ("productId", "productKey", "htmlDigest", "expectedRunId", "expectedInputFingerprint"):
                _required_text(result, field)
            revision = result.get("expectedWorkfileRevision")
            if not isinstance(revision, int) or revision < 0 or not image_digests:
                raise Cafe24BridgeError("factory_cafe24_preflight_invalid")
        return {key: value for key, value in result.items()}
    if result.get("status") != "staged_verified":
        raise Cafe24BridgeError("factory_cafe24_result_unverified")
    if result.get("payloadDigest") != execution.payload_digest:
        raise Cafe24BridgeError("factory_cafe24_result_digest_mismatch")
    if result.get("idempotencyKey") != execution.idempotency_key:
        raise Cafe24BridgeError("idempotency_conflict")
    remote_digest = _required_text(result, "remoteReadbackDigest")
    external_product_no = _required_text(result, "externalProductNo")
    remote_readback = result.get("remoteReadback")
    if not isinstance(remote_readback, dict):
        raise Cafe24BridgeError("factory_cafe24_readback_missing")
    option_values = remote_readback.get("optionValues")
    inventory_by_option = remote_readback.get("inventoryByOption")
    variant_count = remote_readback.get("variantCount")
    image_digests = remote_readback.get("imageDigests")
    if (
        str(remote_readback.get("productNo") or "").strip() != external_product_no
        or not str(remote_readback.get("productCode") or "").strip()
        or not str(remote_readback.get("productName") or "").strip()
        or any(remote_readback.get(field) != "F" for field in ("display", "selling", "marketSync"))
        or not isinstance(option_values, list)
        or any(not isinstance(value, str) or not value.strip() for value in option_values)
        or type(variant_count) is not int
        or variant_count < 0
        or not isinstance(inventory_by_option, dict)
        or not isinstance(image_digests, list)
        or not image_digests
        or any(not isinstance(value, str) or not value.strip() for value in image_digests)
        or type(remote_readback.get("representativeImageCount")) is not int
        or int(remote_readback["representativeImageCount"]) < 1
        or type(remote_readback.get("detailImageCount")) is not int
        or int(remote_readback["detailImageCount"]) < 1
        or not str(remote_readback.get("detailHtmlDigest") or "").strip()
    ):
        raise Cafe24BridgeError("factory_cafe24_readback_invalid")
    if option_values and (
        variant_count != len(option_values)
        or set(inventory_by_option) != set(option_values)
        or any(
            not isinstance(inventory_by_option[value], dict)
            or str(inventory_by_option[value].get("quantity") or "").strip() != "99"
            or str(inventory_by_option[value].get("useInventory") or "").strip().upper() != "T"
            for value in option_values
        )
    ):
        raise Cafe24BridgeError("factory_cafe24_options_readback_mismatch")
    return {
        "status": "staged_verified",
        "payloadDigest": execution.payload_digest,
        "remoteReadbackDigest": remote_digest,
        "remoteReadback": dict(remote_readback),
        "externalProductNo": external_product_no,
        "idempotencyKey": execution.idempotency_key,
    }
