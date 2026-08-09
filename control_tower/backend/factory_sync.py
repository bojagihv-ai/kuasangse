from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
import re
from threading import Condition, RLock
from time import monotonic
from typing import Any, Callable
from uuid import uuid4

from .runtime_cache import JsonObject, JsonValue


COMMAND_KIND = "factory-control"
COMMAND_VERSION = "factory-control-command:v1"
WORK_ORDER_VERSION = "control-work-order:v1"
WORKER_CAPABILITY_VERSION = "batch-control-worker:v1"
WORKFILE_COMMAND_KIND = "factory-workfile"
WORKFILE_COMMAND_VERSION = "factory-workfile-hydration-command:v1"
MAX_WORKFILE_BYTES = 256 * 1024 * 1024


class FactorySyncError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(slots=True)
class _Execution:
    order: JsonObject
    status: str = "pending"
    worker_id: str = ""
    event_sequence: int = 0
    session_id: str = ""


@dataclass(slots=True)
class _FactorySession:
    session_id: str
    worker_id: str
    build_id: str
    capability_version: str
    factory_capability_version: str
    started_at: int
    cursor: int
    last_seen: float
    http_session_id: str


class FactorySyncBridge:
    def __init__(
        self,
        *,
        session_timeout_seconds: float = 45.0,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._executions: dict[str, _Execution] = {}
        self._projection: JsonObject | None = None
        self._events: list[JsonObject] = []
        self._event_sequence = 0
        self._factory_session: _FactorySession | None = None
        self._last_factory_session: _FactorySession | None = None
        self._session_timeout_seconds = max(1.0, session_timeout_seconds)
        self._clock = clock

    def current_state(self) -> JsonObject:
        with self._condition:
            self._expire_session_locked()
            if self._projection is None:
                return {
                    "schema": "factory-control-projection:v1",
                    "connected": False,
                    "status": "blocked",
                    "reason": "factory_session_missing",
                    "inputs": [],
                    "stages": [],
                }
            return self._public_state_locked()

    def hello(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        session = _factory_session_from_payload(payload, now=self._clock())
        projection_value = payload.get("projection")
        if not isinstance(projection_value, dict):
            raise FactorySyncError("factory_projection_invalid")
        projection = _validate_projection(projection_value)
        with self._condition:
            current = self._factory_session
            if current is not None:
                if session.session_id == current.session_id:
                    if session.cursor <= current.cursor:
                        raise FactorySyncError("stale_session_cursor")
                elif session.started_at <= current.started_at:
                    raise FactorySyncError("stale_factory_session")
            self._factory_session = session
            self._last_factory_session = session
            self._projection = projection
            event = self._append_event(
                "factory.snapshot",
                {"projection": self._public_state_locked()},
            )
            self._condition.notify_all()
            return {
                "accepted": True,
                "connected": True,
                "cursor": str(event["eventId"]),
                "sessionCursor": session.cursor,
            }

    def session_heartbeat(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        with self._condition:
            session = self._require_current_session_locked(payload)
            identity = payload.get("identity")
            if not isinstance(identity, dict):
                raise FactorySyncError("factory_session_identity_invalid")
            _assert_session_identity(self._projection, identity)
            session.cursor = _session_cursor(payload)
            session.last_seen = self._clock()
            self._last_factory_session = session
            return {
                "accepted": True,
                "connected": True,
                "cursor": str(self._event_sequence),
                "sessionCursor": session.cursor,
            }

    def accept_session_projection(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        projection_value = payload.get("projection")
        if not isinstance(projection_value, dict):
            raise FactorySyncError("factory_projection_invalid")
        normalized = _validate_projection(projection_value)
        with self._condition:
            session = self._require_current_session_locked(payload)
            previous = self._projection
            _assert_projection_is_fresh(previous, normalized)
            session.cursor = _session_cursor(payload)
            session.last_seen = self._clock()
            self._last_factory_session = session
            if previous is not None and _projection_content(previous) == _projection_content(normalized):
                self._projection = normalized
                return {
                    "accepted": True,
                    "changed": False,
                    "cursor": str(self._event_sequence),
                    "sessionCursor": session.cursor,
                }
            self._projection = normalized
            event_type, payload_value = _projection_event(previous, normalized)
            if event_type == "factory.snapshot":
                payload_value = {"projection": self._public_state_locked()}
            event = self._append_event(event_type, payload_value)
            self._condition.notify_all()
            return {
                "accepted": True,
                "changed": True,
                "cursor": str(event["eventId"]),
                "sessionCursor": session.cursor,
            }

    def seed_projection(self, projection: Mapping[str, JsonValue]) -> None:
        normalized = _validate_projection(projection)
        with self._lock:
            self._projection = normalized

    def accept_projection(self, projection: Mapping[str, JsonValue]) -> JsonObject:
        normalized = _validate_projection(projection)
        with self._condition:
            previous = self._projection
            _assert_projection_is_fresh(previous, normalized)
            if previous is not None and _projection_content(previous) == _projection_content(normalized):
                return {
                    "accepted": True,
                    "changed": False,
                    "cursor": str(self._event_sequence),
                }
            self._projection = normalized
            event_type, payload = _projection_event(previous, normalized)
            event = self._append_event(event_type, payload)
            self._condition.notify_all()
            return {
                "accepted": True,
                "changed": True,
                "cursor": str(event["eventId"]),
            }

    def record_publication_receipt(
        self,
        receipt: Mapping[str, JsonValue],
    ) -> JsonObject:
        if (
            receipt.get("schema")
            != "factory-cafe24-terminal-publication-receipt:v1"
            or receipt.get("status") != "staged_verified"
        ):
            raise FactorySyncError("publication_receipt_invalid")
        identity: JsonObject = {
            "productId": receipt.get("productId"),
            "productKey": receipt.get("productKey"),
            "runId": receipt.get("expectedRunId"),
            "inputFingerprint": receipt.get("expectedInputFingerprint"),
            "revision": receipt.get("expectedWorkfileRevision"),
        }
        with self._condition:
            _assert_session_identity(self._projection, identity)
            if self._projection is None:
                raise FactorySyncError("factory_session_missing")
            registration_value = self._projection.get("registration")
            if not isinstance(registration_value, dict):
                raise FactorySyncError("factory_registration_missing")
            idempotency_key = _required_text(receipt, "idempotencyKey")
            if registration_value.get("idempotencyKey") != idempotency_key:
                raise FactorySyncError("stale_run_fingerprint")
            existing = registration_value.get("publicationReceipt")
            if isinstance(existing, dict):
                if existing != receipt:
                    raise FactorySyncError("idempotency_conflict")
                return self._public_state_locked()
            registration: JsonObject = {
                **_copy(registration_value),
                "status": "staged_verified",
                "blockers": [],
                "publicationReceipt": _copy(dict(receipt)),
                "remoteReadbackDigest": receipt.get("remoteReadbackDigest"),
                "remoteProductNo": receipt.get("remoteProductNo"),
            }
            self._projection["registration"] = registration
            self._projection["status"] = "staged_verified"
            self._append_event(
                "factory.publication.receipt",
                {"publicationReceipt": _copy(dict(receipt))},
            )
            self._condition.notify_all()
            return self._public_state_locked()

    def events_after(self, cursor: str) -> list[JsonObject]:
        try:
            sequence = int(cursor or "0")
        except ValueError:
            sequence = 0
        with self._lock:
            return [_copy(event) for event in self._events if int(event["eventId"]) > sequence]

    def wait_events_after(self, cursor: str, timeout: float = 15.0) -> list[JsonObject]:
        with self._condition:
            events = self.events_after(cursor)
            if events:
                return events
            self._condition.wait(timeout=max(0.0, timeout))
            return self.events_after(cursor)

    def queue_snapshot(self) -> JsonObject:
        marker = uuid4().hex
        order: JsonObject = {
            "orderId": f"factory-sync-{marker}",
            "contractVersion": WORK_ORDER_VERSION,
            "capabilityVersion": WORKER_CAPABILITY_VERSION,
            "batchId": "factory-session",
            "productId": "factory-session",
            "productKey": "factory-session",
            "currentRunId": "factory-session",
            "stageId": "factory-sync",
            "operationToken": f"factory-sync:{marker}",
            "idempotencyKey": f"factory-sync:{marker}",
            "expectedWorkfileRevision": 0,
            "command": {
                "kind": COMMAND_KIND,
                "version": COMMAND_VERSION,
                "name": "getFactoryProjection",
                "payload": {},
            },
        }
        self._queue(order)
        return _copy(order)

    def queue_selection(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        with self._condition:
            self._expire_session_locked()
            if self._projection is None or self._projection.get("connected") is not True:
                raise FactorySyncError("factory_session_missing")
            session = self._projection.get("session")
            if not isinstance(session, dict):
                raise FactorySyncError("factory_session_missing")
            _assert_selection_identity(session, payload)
            worker_session_id = (
                self._factory_session.session_id
                if self._factory_session is not None
                else ""
            )
            target_worker_id = (
                self._factory_session.worker_id
                if self._factory_session is not None
                else ""
            )
            idempotency_key = _required_text(payload, "idempotencyKey")
            for execution in self._executions.values():
                if execution.order.get("idempotencyKey") != idempotency_key:
                    continue
                command = execution.order.get("command")
                existing_payload = (
                    command.get("payload") if isinstance(command, dict) else None
                )
                if existing_payload != dict(payload):
                    raise FactorySyncError("idempotency_conflict")
                return _copy(execution.order)
        stage_key = _required_text(payload, "stageKey")
        candidate_id = _required_text(payload, "candidateId")
        marker = uuid4().hex
        order: JsonObject = {
            "orderId": f"factory-a-cut-{marker}",
            "contractVersion": WORK_ORDER_VERSION,
            "capabilityVersion": WORKER_CAPABILITY_VERSION,
            "batchId": "factory-session",
            "productId": _required_text(payload, "productId"),
            "productKey": _required_text(payload, "productKey"),
            "currentRunId": _required_text(payload, "expectedRunId"),
            "stageId": stage_key,
            "operationToken": f"factory-a-cut:{marker}",
            "idempotencyKey": idempotency_key,
            "expectedWorkfileRevision": payload["expectedRevision"],
            "workerSessionId": worker_session_id,
            "targetWorkerId": target_worker_id,
            "command": {
                "kind": COMMAND_KIND,
                "version": COMMAND_VERSION,
                "name": "selectFactoryACut",
                "payload": {
                    **dict(payload),
                    "stageKey": stage_key,
                    "candidateId": candidate_id,
                },
            },
        }
        self._queue(order)
        return _copy(order)

    def queue_workfile_hydration(
        self,
        payload: Mapping[str, JsonValue],
    ) -> JsonObject:
        file_name = _required_text(payload, "fileName")
        if (
            "/" in file_name
            or "\\" in file_name
            or not file_name.casefold().endswith(".kuasangse")
        ):
            raise FactorySyncError("factory_workfile_name_invalid")
        workfile_text = _required_text(payload, "workfileText")
        workfile_bytes = workfile_text.encode("utf-8")
        if len(workfile_bytes) > MAX_WORKFILE_BYTES:
            raise FactorySyncError("factory_workfile_too_large")
        expected_sha256 = _required_text(payload, "expectedSha256").casefold()
        if (
            re.fullmatch(r"[a-f0-9]{64}", expected_sha256) is None
            or sha256(workfile_bytes).hexdigest() != expected_sha256
        ):
            raise FactorySyncError("factory_workfile_digest_mismatch")
        expected_revision = payload.get("expectedWorkfileRevision")
        if not isinstance(expected_revision, int) or expected_revision < 0:
            raise FactorySyncError("factory_control_revision_invalid")
        for field in (
            "expectedWorkspaceId",
            "expectedProductId",
            "expectedProductKey",
            "expectedRunId",
        ):
            _required_text(payload, field)
        expected_input_fingerprint = payload.get("expectedInputFingerprint")
        if (
            expected_input_fingerprint is not None
            and (
                not isinstance(expected_input_fingerprint, str)
                or not expected_input_fingerprint.strip()
            )
        ):
            raise FactorySyncError(
                "factory_control_field_missing:expectedInputFingerprint"
            )
        idempotency_key = _required_text(payload, "idempotencyKey")
        command_payload: JsonObject = {
            **dict(payload),
            "contractVersion": WORKFILE_COMMAND_VERSION,
            "capabilityVersion": WORKFILE_COMMAND_VERSION,
            "expectedSha256": expected_sha256,
        }
        with self._condition:
            self._expire_session_locked()
            current = self._factory_session
            if current is None:
                raise FactorySyncError("factory_session_missing")

            def assert_current_revision() -> None:
                projection = self._projection
                session = projection.get("session") if isinstance(projection, dict) else None
                if not isinstance(session, dict) or session.get("revision") != expected_revision:
                    raise FactorySyncError("stale_workfile_revision")

            for execution in self._executions.values():
                if execution.order.get("idempotencyKey") != idempotency_key:
                    continue
                command = execution.order.get("command")
                existing_payload = (
                    command.get("payload") if isinstance(command, dict) else None
                )
                if existing_payload != command_payload:
                    raise FactorySyncError("idempotency_conflict")
                if execution.status in {"pending", "failed"}:
                    assert_current_revision()
                    execution.status = "pending"
                    execution.worker_id = ""
                    execution.event_sequence = 0
                    execution.session_id = current.session_id
                    execution.order["workerSessionId"] = current.session_id
                    execution.order["targetWorkerId"] = current.worker_id
                    execution.order["workerHttpSessionId"] = current.http_session_id
                return _copy(execution.order)
            assert_current_revision()
            marker = uuid4().hex
            order: JsonObject = {
                "orderId": f"factory-workfile-{marker}",
                "contractVersion": WORK_ORDER_VERSION,
                "capabilityVersion": WORKER_CAPABILITY_VERSION,
                "batchId": "factory-session",
                "productId": _required_text(payload, "expectedProductId"),
                "productKey": _required_text(payload, "expectedProductKey"),
                "currentRunId": _required_text(payload, "expectedRunId"),
                "stageId": "workfile-hydration",
                "operationToken": f"factory-workfile:{expected_sha256}",
                "idempotencyKey": idempotency_key,
                "expectedWorkfileRevision": expected_revision,
                "workerSessionId": current.session_id,
                "targetWorkerId": current.worker_id,
                "workerHttpSessionId": current.http_session_id,
                "command": {
                    "kind": WORKFILE_COMMAND_KIND,
                    "version": WORKFILE_COMMAND_VERSION,
                    "name": "hydrateFactoryWorkfile",
                    "payload": command_payload,
                },
            }
            self._queue(order)
            return _copy(order)

    def _queue(self, order: JsonObject) -> None:
        with self._lock:
            self._executions[str(order["orderId"])] = _Execution(
                order=order,
                session_id=str(order.get("workerSessionId") or ""),
            )

    def claim(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        worker_id = _required_text(payload, "workerId")
        session_id = str(payload.get("sessionId") or "")
        http_session_id = str(payload.get("_httpSessionId") or "")
        if payload.get("contractVersion") != WORK_ORDER_VERSION:
            raise FactorySyncError("contract_version_unsupported")
        if payload.get("capabilityVersion") != WORKER_CAPABILITY_VERSION:
            raise FactorySyncError("capability_version_unsupported")
        with self._lock:
            for execution in self._executions.values():
                if execution.status != "pending":
                    continue
                target_worker_id = str(execution.order.get("targetWorkerId") or "")
                if target_worker_id and target_worker_id != worker_id:
                    continue
                command = execution.order.get("command")
                is_workfile_hydration = (
                    isinstance(command, dict)
                    and command.get("kind") == WORKFILE_COMMAND_KIND
                )
                if (
                    is_workfile_hydration
                    and execution.session_id
                    and (
                        execution.session_id != session_id
                        if session_id
                        else execution.order.get("workerHttpSessionId")
                        != http_session_id
                    )
                ):
                    continue
                execution.status = "claimed"
                execution.worker_id = worker_id
                return {"claimed": True, "order": _copy(execution.order)}
        return {"claimed": False, "order": None}

    def has_pending(self) -> bool:
        with self._lock:
            return any(execution.status == "pending" for execution in self._executions.values())

    def owns(self, order_id: str) -> bool:
        with self._lock:
            return order_id in self._executions

    def lifecycle(self, order_id: str, action: str, payload: Mapping[str, JsonValue]) -> JsonObject:
        with self._lock:
            execution = self._executions.get(order_id)
            if execution is None:
                raise FactorySyncError("work_order_not_found")
            if (
                execution.session_id
                and (
                    self._factory_session is None
                    or execution.session_id != self._factory_session.session_id
                )
            ):
                raise FactorySyncError("stale_factory_session")
            _assert_order_identity(execution.order, payload)
            if _required_text(payload, "workerId") != execution.worker_id:
                raise FactorySyncError("lease_conflict")
            sequence = payload.get("eventSequence")
            if not isinstance(sequence, int) or sequence < 0:
                raise FactorySyncError("stale_event_sequence")
            if action == "ack":
                if execution.status != "claimed" or payload.get("accepted") is not True or sequence <= execution.event_sequence:
                    raise FactorySyncError("stale_event_sequence")
                execution.status = "acknowledged"
                execution.event_sequence = sequence
            elif action == "heartbeat":
                if execution.status not in {"acknowledged", "running"} or sequence < execution.event_sequence:
                    raise FactorySyncError("stale_event_sequence")
            elif action == "events":
                if execution.status not in {"acknowledged", "running"} or sequence <= execution.event_sequence:
                    raise FactorySyncError("stale_event_sequence")
                execution.status = "running"
                execution.event_sequence = sequence
            elif action == "complete":
                if execution.status not in {"acknowledged", "running"} or sequence < execution.event_sequence:
                    raise FactorySyncError("stale_event_sequence")
                result = payload.get("result")
                if not isinstance(result, dict):
                    raise FactorySyncError("factory_control_result_missing")
                self._accept_result(execution, result)
                execution.status = "completed"
                execution.event_sequence = max(sequence, execution.event_sequence)
            elif action == "fail":
                if execution.status not in {"claimed", "acknowledged", "running"} or sequence < execution.event_sequence:
                    raise FactorySyncError("stale_event_sequence")
                execution.status = "failed"
                execution.event_sequence = max(sequence, execution.event_sequence)
                self._append_event("factory.worker.failed", {"error": str(payload.get("error") or "factory_worker_failed")})
            else:
                raise FactorySyncError("worker_action_invalid")
            return {"accepted": True, "orderId": order_id, "status": execution.status}

    def _accept_result(self, execution: _Execution, result: Mapping[str, JsonValue]) -> None:
        command = execution.order["command"]
        assert isinstance(command, dict)
        if command["name"] == "getFactoryProjection":
            self.accept_projection(result)
            return
        if command["name"] == "hydrateFactoryWorkfile":
            if result.get("schema") != "factory-workfile-hydration-receipt:v1":
                raise FactorySyncError("factory_workfile_receipt_invalid")
            payload = command.get("payload")
            projection = result.get("projection")
            if not isinstance(payload, dict) or not isinstance(projection, dict):
                raise FactorySyncError("factory_projection_missing")
            normalized = _validate_projection(projection)
            session = normalized.get("session")
            if not isinstance(session, dict):
                raise FactorySyncError("factory_projection_missing")
            pairs = (
                ("workspaceId", "expectedWorkspaceId"),
                ("productId", "expectedProductId"),
                ("productKey", "expectedProductKey"),
                ("runId", "expectedRunId"),
            )
            if any(session.get(actual) != payload.get(expected) for actual, expected in pairs):
                raise FactorySyncError("factory_workfile_projection_mismatch")
            if type(session.get("revision")) is not int or session["revision"] < 0:
                raise FactorySyncError("factory_workfile_projection_mismatch")
            expected_input_fingerprint = payload.get("expectedInputFingerprint")
            actual_input_fingerprint = session.get("inputFingerprint")
            if (
                not isinstance(actual_input_fingerprint, str)
                or not actual_input_fingerprint.strip()
                or (
                    isinstance(expected_input_fingerprint, str)
                    and actual_input_fingerprint != expected_input_fingerprint
                )
            ):
                raise FactorySyncError("factory_workfile_projection_mismatch")
            if (
                result.get("workfileSha256") != payload.get("expectedSha256")
                or result.get("projectId") != payload.get("expectedWorkspaceId")
                or result.get("name") != payload.get("expectedProductKey")
            ):
                raise FactorySyncError("factory_workfile_receipt_invalid")
            self._projection = normalized
            self._append_event(
                "factory.workfile.hydrated",
                {"receipt": dict(result), "projection": normalized},
            )
            self._condition.notify_all()
            return
        if result.get("schema") != "factory-a-cut-receipt:v1":
            raise FactorySyncError("factory_a_cut_receipt_invalid")
        projection = result.get("projection")
        if not isinstance(projection, dict):
            raise FactorySyncError("factory_projection_missing")
        normalized = _validate_projection(projection)
        _assert_projection_is_fresh(self._projection, normalized)
        self._projection = normalized
        self._append_event("factory.a_cut.selected", {"receipt": dict(result), "projection": normalized})
        self._condition.notify_all()

    def _append_event(self, event_type: str, payload: Mapping[str, Any]) -> JsonObject:
        self._event_sequence += 1
        event: JsonObject = {
            "schema": "factory-control-sse:v1",
            "eventId": str(self._event_sequence),
            "type": event_type,
            **_copy(payload),
        }
        self._events.append(event)
        if len(self._events) > 512:
            self._events = self._events[-512:]
        return event

    def _require_current_session_locked(
        self,
        payload: Mapping[str, JsonValue],
    ) -> _FactorySession:
        self._expire_session_locked()
        current = self._factory_session
        if current is None:
            raise FactorySyncError("factory_session_missing")
        if _required_text(payload, "sessionId") != current.session_id:
            raise FactorySyncError("stale_factory_session")
        if _required_text(payload, "workerId") != current.worker_id:
            raise FactorySyncError("stale_factory_session")
        if _required_text(payload, "buildId") != current.build_id:
            raise FactorySyncError("stale_factory_session")
        cursor = _session_cursor(payload)
        if cursor <= current.cursor:
            raise FactorySyncError("stale_session_cursor")
        return current

    def _expire_session_locked(self) -> None:
        current = self._factory_session
        if current is None:
            return
        if self._clock() - current.last_seen <= self._session_timeout_seconds:
            return
        self._last_factory_session = current
        self._factory_session = None
        self._append_event(
            "factory.session.disconnected",
            {
                "sessionId": current.session_id,
                "workerId": current.worker_id,
                "reason": "factory_heartbeat_timeout",
            },
        )
        self._condition.notify_all()

    def _public_state_locked(self) -> JsonObject:
        projection = (
            _copy(self._projection)
            if self._projection is not None
            else {
                "schema": "factory-control-projection:v1",
                "inputs": [],
                "stages": [],
            }
        )
        current = self._factory_session
        if current is not None:
            projection["connected"] = True
            projection["workerSession"] = _factory_session_public(current)
            if self._projection is not None and self._projection.get("connected") is not True:
                projection["status"] = "blocked"
            projection["reason"] = ""
            return projection
        projection["connected"] = False
        projection["status"] = "blocked"
        projection["reason"] = (
            "factory_heartbeat_timeout"
            if self._last_factory_session is not None
            else str(projection.get("reason") or "factory_session_missing")
        )
        if self._last_factory_session is not None:
            projection["workerSession"] = {
                **_factory_session_public(self._last_factory_session),
                "connected": False,
            }
        return projection


def _copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy(item) for item in value]
    return value


def _required_text(mapping: Mapping[str, JsonValue], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FactorySyncError(f"factory_control_field_missing:{key}")
    return value.strip()


def _session_cursor(mapping: Mapping[str, JsonValue]) -> int:
    value = mapping.get("cursor")
    if not isinstance(value, int) or value < 1:
        raise FactorySyncError("stale_session_cursor")
    return value


def _factory_session_from_payload(
    payload: Mapping[str, JsonValue],
    *,
    now: float,
) -> _FactorySession:
    if payload.get("schema") != "factory-worker-session:v1":
        raise FactorySyncError("factory_session_contract_unsupported")
    if payload.get("capabilityVersion") != WORKER_CAPABILITY_VERSION:
        raise FactorySyncError("capability_version_unsupported")
    if payload.get("factoryCapabilityVersion") != COMMAND_VERSION:
        raise FactorySyncError("factory_control_command_version_unsupported")
    started_at = payload.get("startedAt")
    if not isinstance(started_at, int) or started_at < 1:
        raise FactorySyncError("factory_session_started_at_invalid")
    return _FactorySession(
        session_id=_required_text(payload, "sessionId"),
        worker_id=_required_text(payload, "workerId"),
        build_id=_required_text(payload, "buildId"),
        capability_version=WORKER_CAPABILITY_VERSION,
        factory_capability_version=COMMAND_VERSION,
        started_at=started_at,
        cursor=_session_cursor(payload),
        last_seen=now,
        http_session_id=str(payload.get("_httpSessionId") or _required_text(payload, "sessionId")),
    )


def _factory_session_public(session: _FactorySession) -> JsonObject:
    return {
        "schema": "factory-worker-session:v1",
        "sessionId": session.session_id,
        "workerId": session.worker_id,
        "buildId": session.build_id,
        "capabilityVersion": session.capability_version,
        "factoryCapabilityVersion": session.factory_capability_version,
        "startedAt": session.started_at,
        "cursor": session.cursor,
        "connected": True,
    }


def _assert_session_identity(
    projection: Mapping[str, JsonValue] | None,
    identity: Mapping[str, JsonValue],
) -> None:
    if projection is None:
        if any(identity.values()):
            raise FactorySyncError("stale_run_fingerprint")
        return
    session = projection.get("session")
    if not isinstance(session, dict):
        if any(identity.values()):
            raise FactorySyncError("stale_run_fingerprint")
        return
    pairs = (
        ("productId", "productId"),
        ("productKey", "productKey"),
        ("runId", "runId"),
        ("inputFingerprint", "inputFingerprint"),
        ("revision", "revision"),
    )
    if any(identity.get(actual) != session.get(expected) for actual, expected in pairs):
        raise FactorySyncError("stale_run_fingerprint")


def _validate_projection(value: Mapping[str, JsonValue]) -> JsonObject:
    if value.get("schema") != "factory-control-projection:v1":
        raise FactorySyncError("factory_projection_invalid")
    if value.get("connected") is not True:
        return {
            **_copy(dict(value)),
            "schema": "factory-control-projection:v1",
            "connected": False,
            "status": "blocked",
            "reason": str(value.get("reason") or "factory_session_missing"),
            "inputs": _copy(value.get("inputs")) if isinstance(value.get("inputs"), list) else [],
            "stages": _copy(value.get("stages")) if isinstance(value.get("stages"), list) else [],
        }
    session = value.get("session")
    if not isinstance(session, dict):
        raise FactorySyncError("factory_projection_invalid")
    for field in ("productId", "productKey", "runId", "inputFingerprint"):
        _required_text(session, field)
    revision = session.get("revision")
    if not isinstance(revision, int) or revision < 0:
        raise FactorySyncError("factory_control_revision_invalid")
    return _copy(dict(value))


def _projection_content(value: Mapping[str, JsonValue]) -> JsonObject:
    return {
        key: _copy(item)
        for key, item in value.items()
        if key not in {"capturedAt", "cursor", "sequence"}
    }


def _assert_projection_is_fresh(
    previous: Mapping[str, JsonValue] | None,
    incoming: Mapping[str, JsonValue],
) -> None:
    if previous is None or previous.get("connected") is not True or incoming.get("connected") is not True:
        return
    previous_session = previous.get("session")
    incoming_session = incoming.get("session")
    if not isinstance(previous_session, dict) or not isinstance(incoming_session, dict):
        return
    if previous_session.get("productKey") != incoming_session.get("productKey"):
        return
    incoming_revision = incoming_session.get("revision")
    previous_revision = previous_session.get("revision")
    if isinstance(incoming_revision, int) and isinstance(previous_revision, int) and incoming_revision < previous_revision:
        raise FactorySyncError("stale_workfile_revision")
    incoming_sequence = incoming.get("sequence")
    previous_sequence = previous.get("sequence")
    if (
        isinstance(incoming_sequence, int)
        and isinstance(previous_sequence, int)
        and incoming_sequence <= previous_sequence
        and _projection_content(previous) != _projection_content(incoming)
    ):
        raise FactorySyncError("stale_event_sequence")
    if (
        previous_session.get("runId") != incoming_session.get("runId")
        or previous_session.get("inputFingerprint") != incoming_session.get("inputFingerprint")
    ) and isinstance(incoming_sequence, int) and isinstance(previous_sequence, int) and incoming_sequence <= previous_sequence:
        raise FactorySyncError("stale_run_fingerprint")


def _projection_event(
    previous: Mapping[str, JsonValue] | None,
    incoming: Mapping[str, JsonValue],
) -> tuple[str, JsonObject]:
    if previous is None or previous.get("connected") is not True or incoming.get("connected") is not True:
        return "factory.snapshot", {"projection": _copy(incoming)}
    previous_stages = {
        str(stage.get("key")): stage
        for stage in previous.get("stages", [])
        if isinstance(stage, dict) and stage.get("key")
    }
    incoming_stages = {
        str(stage.get("key")): stage
        for stage in incoming.get("stages", [])
        if isinstance(stage, dict) and stage.get("key")
    }
    changed = [
        key
        for key, stage in incoming_stages.items()
        if previous_stages.get(key) != stage
    ]
    previous_without_stages = {
        key: item
        for key, item in _projection_content(previous).items()
        if key != "stages"
    }
    incoming_without_stages = {
        key: item
        for key, item in _projection_content(incoming).items()
        if key != "stages"
    }
    if len(changed) == 1 and previous_without_stages == incoming_without_stages:
        session = incoming.get("session")
        assert isinstance(session, dict)
        return "factory.stage.updated", {
            "productId": session["productId"],
            "productKey": session["productKey"],
            "runId": session["runId"],
            "inputFingerprint": session["inputFingerprint"],
            "revision": session["revision"],
            "sequence": incoming.get("sequence", 0),
            "stage": _copy(incoming_stages[changed[0]]),
        }
    return "factory.snapshot", {"projection": _copy(incoming)}


def _assert_selection_identity(session: Mapping[str, JsonValue], payload: Mapping[str, JsonValue]) -> None:
    pairs = (
        ("productId", "productId"),
        ("productKey", "productKey"),
        ("runId", "expectedRunId"),
        ("inputFingerprint", "expectedInputFingerprint"),
    )
    if any(session.get(current) != payload.get(expected) for current, expected in pairs):
        raise FactorySyncError("stale_run_fingerprint")
    revision = payload.get("expectedRevision")
    if not isinstance(revision, int) or revision < 0:
        raise FactorySyncError("factory_control_revision_invalid")
    if revision != session.get("revision"):
        raise FactorySyncError("stale_workfile_revision")


def _assert_order_identity(order: Mapping[str, JsonValue], payload: Mapping[str, JsonValue]) -> None:
    for field in (
        "orderId",
        "productId",
        "productKey",
        "currentRunId",
        "operationToken",
        "idempotencyKey",
        "expectedWorkfileRevision",
    ):
        if order.get(field) != payload.get(field):
            if field == "expectedWorkfileRevision":
                raise FactorySyncError("stale_workfile_revision")
            if field in {"productId", "productKey", "currentRunId"}:
                raise FactorySyncError("stale_run_fingerprint")
            raise FactorySyncError("stale_fencing_token")
