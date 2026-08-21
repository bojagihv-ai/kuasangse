from __future__ import annotations

from base64 import b64decode
from binascii import Error as Base64Error
from collections import Counter
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import tempfile
from threading import Condition, RLock
from time import monotonic
from typing import Any, Callable
from uuid import uuid4

from .policy import DECISION_POINT_IDS, PolicyError, validate_policy_snapshot
from .runtime_cache import JsonObject, JsonValue


COMMAND_KIND = "factory-control"
COMMAND_VERSION = "factory-control-command:v1"
WORK_ORDER_VERSION = "control-work-order:v1"
WORKER_CAPABILITY_VERSION = "batch-control-worker:v1"
WORKFILE_COMMAND_KIND = "factory-workfile"
WORKFILE_COMMAND_VERSION = "factory-workfile-hydration-command:v1"
MAX_WORKFILE_BYTES = 256 * 1024 * 1024
PRODUCT_RUN_COMMAND = "runFactoryProduct"
PRODUCT_RUN_COMMAND_VERSION = "factory-product-run-command:v1"
PRODUCT_RUN_RECEIPT_VERSION = "factory-product-run-receipt:v1"
PRODUCT_CHECKPOINT_VERSION = "factory-product-checkpoint:v1"
PRODUCT_CHECKPOINT_REBIND_RECEIPT_VERSION = "factory-product-checkpoint-rebind-receipt:v1"
PRODUCT_JOB_STATE_SCHEMA = "factory-product-job-state:v1"
SENSITIVE_PRODUCT_FIELD = re.compile(
    r"authorization|bearer|secret|password|credential|token|api.?key|service.?key|csrf|cookie",
    re.IGNORECASE,
)
SENSITIVE_PRODUCT_VALUE = re.compile(
    r"\bbearer\s+\S+|\b(?:sk|AIza)[-_A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[?&](?:token|api.?key|secret)=",
    re.IGNORECASE,
)
PRODUCT_JOB_INPUT_KEYS = frozenset(
    {
        "batchId",
        "idempotencyKey",
        "mode",
        "source",
        "productName",
        "workfileName",
        "jcode",
        "imageModel",
        "requiredValues",
        "inputImages",
        "pdpJobId",
        "policySnapshot",
        "cafe24ApprovalMode",
        "contractType",
        "contractVersion",
        "category",
        "protectedState",
        "hydratedRevision",
    }
)
PRODUCT_REQUIRED_VALUE_KEYS = frozenset(
    {"category", "material", "originCountry", "size", "salePrice", "stock", "usage", "optionMode"}
)
PRODUCT_IMAGE_KEYS = frozenset(
    {"role", "ordinal", "name", "fileName", "colorName", "sha256", "dataUrl"}
)
PRODUCT_IMAGE_MODELS = frozenset({"api-hub-openai-image", "gemini-3.1-flash-image"})
WORKER_BUILD_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _policy_decision_modes(snapshot: Mapping[str, JsonValue]) -> JsonObject:
    resolved = snapshot.get("resolved")
    if not isinstance(resolved, dict):
        return {}
    return {
        decision: str(resolved[decision])
        for decision in DECISION_POINT_IDS
        if resolved.get(decision) in {"auto", "manual"}
    }


def _public_policy_summary(snapshot: Mapping[str, JsonValue]) -> JsonObject:
    decision_modes = _policy_decision_modes(snapshot)
    if len(decision_modes) != len(DECISION_POINT_IDS):
        return {}
    effective_sources = snapshot.get("effectiveSources")
    return {
        "snapshotId": str(snapshot.get("snapshotId") or ""),
        "preset": str(snapshot.get("preset") or ""),
        "resolved": decision_modes,
        "effectiveSources": {
            decision: str(effective_sources.get(decision) or "")
            for decision in DECISION_POINT_IDS
        }
        if isinstance(effective_sources, dict)
        else {},
    }


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


@dataclass(slots=True)
class _ProductJob:
    job_id: str
    payload: JsonObject
    status: str = "queued"
    stage_key: str = ""
    message: str = "조립공장 실행 대기"
    current_order_id: str = ""
    attempts: int = 0
    decision_status: str = ""
    start_fresh_next: bool = True
    restore_only: bool = False
    checkpoint: JsonObject | None = None
    checkpoint_rebind_receipt: JsonObject | None = None


@dataclass(slots=True)
class _MutableStateSnapshot:
    executions: dict[str, _Execution]
    projection: JsonObject | None
    events: list[JsonObject]
    event_sequence: int
    product_jobs: dict[str, _ProductJob]


class FactorySyncBridge:
    def __init__(
        self,
        *,
        session_timeout_seconds: float = 90.0,
        clock: Callable[[], float] = monotonic,
        state_path: Path | None = None,
        expected_build_id: str = "",
    ) -> None:
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._executions: dict[str, _Execution] = {}
        self._projection: JsonObject | None = None
        self._events: list[JsonObject] = []
        self._event_sequence = 0
        self._factory_session: _FactorySession | None = None
        self._last_factory_session: _FactorySession | None = None
        self._state_path = state_path
        self._expected_build_id = expected_build_id
        if expected_build_id and WORKER_BUILD_ID.fullmatch(expected_build_id) is None:
            raise FactorySyncError("factory_worker_build_invalid")
        self._product_jobs, recovered_startup_orphan = self._load_product_jobs()
        self._session_timeout_seconds = max(1.0, session_timeout_seconds)
        self._clock = clock
        if recovered_startup_orphan:
            self._persist_product_jobs_locked()

    def current_state(self) -> JsonObject:
        with self._condition:
            self._expire_session_locked()
            return self._public_state_locked()

    def active_worker_target(self) -> JsonObject:
        with self._condition:
            self._expire_session_locked()
            current = self._factory_session
            if current is None:
                return {}
            return {
                "workerId": current.worker_id,
                "sessionId": current.session_id,
                "buildId": current.build_id,
            }

    def hello(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        session = _factory_session_from_payload(payload, now=self._clock())
        if self._expected_build_id and session.build_id != self._expected_build_id:
            raise FactorySyncError("factory_worker_build_mismatch")
        projection_value = payload.get("projection")
        if not isinstance(projection_value, dict):
            raise FactorySyncError("factory_projection_invalid")
        projection = _validate_projection(projection_value)
        with self._condition:
            self._expire_session_locked()
            current = self._factory_session
            previous = current or self._last_factory_session
            if previous is not None:
                if session.session_id == previous.session_id:
                    if current is None:
                        raise FactorySyncError("stale_factory_session")
                    if session.cursor <= current.cursor:
                        raise FactorySyncError("stale_session_cursor")
                elif session.started_at <= previous.started_at:
                    raise FactorySyncError("stale_factory_session")
            replaced_session_id = (
                previous.session_id
                if previous is not None and previous.session_id != session.session_id
                else ""
            )
            self._factory_session = session
            self._last_factory_session = session
            self._projection = _preserve_terminal_publication_receipt(self._projection, projection)
            if replaced_session_id:
                _ = self._recover_inflight_products_locked(replaced_session_id, projection)
                self._rebind_selection_orders_locked(session, projection)
            self._reconcile_restored_product_jobs_locked(projection)
            for execution in self._executions.values():
                if execution.status != "pending" or execution.session_id == session.session_id:
                    continue
                command = execution.order.get("command")
                if not isinstance(command, dict) or command.get("name") != PRODUCT_RUN_COMMAND:
                    continue
                execution.session_id = session.session_id
                execution.order["workerSessionId"] = session.session_id
                execution.order["targetWorkerId"] = session.worker_id
                execution.order["workerHttpSessionId"] = session.http_session_id
            self._dispatch_next_product_locked()
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
            normalized = _preserve_terminal_publication_receipt(previous, normalized)
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
            normalized = _preserve_terminal_publication_receipt(previous, normalized)
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
        }
        with self._condition:
            if self._projection is None:
                raise FactorySyncError("factory_session_missing")
            session = self._projection.get("session")
            if not isinstance(session, dict) or type(session.get("revision")) is not int:
                raise FactorySyncError("factory_session_missing")
            _assert_session_identity(
                self._projection,
                {**identity, "revision": session["revision"]},
            )
            registration_value = self._projection.get("registration")
            if not isinstance(registration_value, dict):
                raise FactorySyncError("factory_registration_missing")
            expected_revision = receipt.get("expectedWorkfileRevision")
            if (
                type(expected_revision) is not int
                or registration_value.get("expectedWorkfileRevision") != expected_revision
                or expected_revision > session["revision"]
            ):
                raise FactorySyncError("stale_workfile_revision")
            idempotency_key = _required_text(receipt, "idempotencyKey")
            if registration_value.get("idempotencyKey") != idempotency_key:
                raise FactorySyncError("stale_run_fingerprint")
            existing = registration_value.get("publicationReceipt")
            if isinstance(existing, dict):
                if existing.get("schema") == "factory-cafe24-terminal-publication-receipt:v1":
                    if existing != receipt:
                        raise FactorySyncError("idempotency_conflict")
                    return self._public_state_locked()
                if (
                    existing.get("schema") != "kuasangse.cafe24-publication-receipt"
                    or str(existing.get("productNo") or "") != str(receipt.get("remoteProductNo") or "")
                    or str(existing.get("productName") or "") != str(receipt.get("productKey") or "")
                ):
                    raise FactorySyncError("idempotency_conflict")
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

    def queue_product(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        normalized = _normalize_product_job_payload(payload)
        with self._condition:
            idempotency_key = str(normalized["idempotencyKey"])
            for existing in self._product_jobs.values():
                if existing.payload.get("idempotencyKey") != idempotency_key:
                    continue
                existing_payload = _normalize_product_job_payload(existing.payload)
                if existing_payload != normalized:
                    raise FactorySyncError("idempotency_conflict")
                existing.payload = existing_payload
                return self._public_product_job(existing)
            job = _ProductJob(
                job_id=f"factory-job-{uuid4().hex}",
                payload=normalized,
            )
            with self._product_state_transaction_locked():
                self._product_jobs[job.job_id] = job
                self._append_event(
                    "factory.product.queued",
                    {"job": self._public_product_job(job)},
                )
                self._dispatch_next_product_locked()
                self._persist_product_jobs_locked()
            self._condition.notify_all()
            return self._public_product_job(job)

    def queue_product_from_workfile(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        allowed_fields = {
            "fileName",
            "workfileText",
            "expectedSha256",
            "expectedWorkspaceId",
            "expectedProductId",
            "expectedProductKey",
            "expectedRunId",
            "expectedInputFingerprint",
            "expectedWorkfileRevision",
            "expectedHydratedWorkfileRevision",
            "batchId",
            "mode",
            "productName",
            "imageModel",
            "requiredValues",
            "policySnapshot",
            "idempotencyKey",
        }
        if set(payload) - allowed_fields:
            raise FactorySyncError("factory_workfile_fork_payload_invalid")
        hydrated_revision = payload.get("expectedHydratedWorkfileRevision")
        if type(hydrated_revision) is not int or hydrated_revision < 0:
            raise FactorySyncError("factory_control_revision_invalid")
        source: JsonObject = {
            "kind": "workfile",
            "sha256": _required_text(payload, "expectedSha256").casefold(),
            "revision": hydrated_revision,
            "runId": _required_text(payload, "expectedRunId"),
            "workspaceId": _required_text(payload, "expectedWorkspaceId"),
            "productId": _required_text(payload, "expectedProductId"),
            "productKey": _required_text(payload, "expectedProductKey"),
            "inputFingerprint": _required_text(payload, "expectedInputFingerprint"),
        }
        product_input: JsonObject = {
            "source": source,
            "workfileName": _required_text(payload, "fileName"),
            "inputImages": [],
        }
        for key in ("batchId", "idempotencyKey", "mode", "productName", "imageModel", "requiredValues", "policySnapshot"):
            if key in payload:
                product_input[key] = _copy(payload[key])
        product_payload = _normalize_product_job_payload(product_input)
        idempotency_key = str(product_payload["idempotencyKey"])
        with self._condition:
            for existing in self._product_jobs.values():
                if existing.payload.get("idempotencyKey") != idempotency_key:
                    continue
                comparable = {
                    key: value
                    for key, value in existing.payload.items()
                    if key not in {"protectedState", "hydratedRevision"}
                }
                if comparable != product_payload:
                    raise FactorySyncError("idempotency_conflict")
                return {"accepted": True, "status": "hydrating"}
            self._require_admitted_runtime_build_locked()
            projection = self._projection
            session = projection.get("session") if isinstance(projection, dict) else None
            registration = projection.get("registration") if isinstance(projection, dict) else None
            if (
                not isinstance(session, dict)
                or session.get("revision") != payload.get("expectedWorkfileRevision")
                or any(session.get(field) for field in ("workspaceId", "productId", "productKey", "runId", "inputFingerprint"))
                or (isinstance(registration, dict) and bool(registration.get("jobId")))
            ):
                raise FactorySyncError("factory_workfile_fork_foreign_live_job")
        hydration_payload: JsonObject = {
            key: _copy(payload[key])
            for key in (
                "fileName",
                "workfileText",
                "expectedSha256",
                "expectedWorkspaceId",
                "expectedProductId",
                "expectedProductKey",
                "expectedRunId",
                "expectedInputFingerprint",
                "expectedWorkfileRevision",
                "idempotencyKey",
            )
        }
        hydration_payload["workfileFork"] = {
            "expectedHydratedWorkfileRevision": hydrated_revision,
            "productPayload": product_payload,
        }
        order = self.queue_workfile_hydration(hydration_payload)
        return {"accepted": True, "status": "hydrating", "orderId": order["orderId"]}

    def product_jobs(self) -> list[JsonObject]:
        with self._lock:
            return [self._public_product_job(job) for job in self._product_jobs.values()]

    def product_job_context(self, job_id: str) -> JsonObject:
        with self._lock:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_not_found")
            return {
                "job": self._public_product_job(job),
                "payload": _copy(job.payload),
                "checkpoint": _copy(job.checkpoint),
            }

    def queue_product_workfile_rebind(
        self,
        job_id: str,
        payload: Mapping[str, JsonValue],
    ) -> JsonObject:
        expected_fields = {
            "fileName",
            "workfileText",
            "expectedSha256",
            "expectedWorkspaceId",
            "expectedProductId",
            "expectedProductKey",
            "expectedRunId",
            "expectedInputFingerprint",
            "expectedWorkfileRevision",
            "expectedHydratedWorkfileRevision",
            "expectedCheckpointRevision",
            "expectedCheckpointRunId",
            "idempotencyKey",
        }
        if set(payload) != expected_fields:
            raise FactorySyncError("factory_workfile_rebind_payload_invalid")
        expected_checkpoint_revision = payload.get("expectedCheckpointRevision")
        if type(expected_checkpoint_revision) is not int or expected_checkpoint_revision < 0:
            raise FactorySyncError("factory_product_checkpoint_invalid")
        expected_checkpoint_run_id = _required_text(payload, "expectedCheckpointRunId")
        expected_hydrated_revision = payload.get("expectedHydratedWorkfileRevision")
        if type(expected_hydrated_revision) is not int or expected_hydrated_revision < 0:
            raise FactorySyncError("factory_control_revision_invalid")
        raw_workfile_text = payload.get("workfileText")
        if (
            not isinstance(raw_workfile_text, str)
            or not raw_workfile_text.strip()
            or sha256(raw_workfile_text.encode("utf-8")).hexdigest() != _required_text(payload, "expectedSha256").casefold()
        ):
            raise FactorySyncError("factory_workfile_digest_mismatch")
        with self._condition:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_not_found")
            checkpoint = _validate_product_checkpoint_state(job.checkpoint, job_id)
            required_values = job.payload.get("requiredValues")
            if not isinstance(required_values, dict):
                raise FactorySyncError("factory_product_required_values_missing")
            for field in PRODUCT_REQUIRED_VALUE_KEYS - {"stock"}:
                required_value = required_values.get(field)
                if not isinstance(required_value, str) or not required_value.strip():
                    raise FactorySyncError("factory_product_required_values_missing")
            identity_pairs = (
                ("projectId", "expectedWorkspaceId"),
                ("productId", "expectedProductId"),
                ("productKey", "expectedProductKey"),
                ("inputFingerprint", "expectedInputFingerprint"),
            )
            if any(checkpoint.get(actual) != payload.get(expected) for actual, expected in identity_pairs):
                raise FactorySyncError("factory_workfile_rebind_identity_mismatch")
            existing_receipt = job.checkpoint_rebind_receipt
            if existing_receipt is not None and _rebind_request_is_idempotent(
                existing_receipt,
                payload,
            ):
                if (
                    job.status != "blocked"
                    or existing_receipt.get("newRevision") != checkpoint.get("revision")
                    or existing_receipt.get("newRunId") != checkpoint.get("runId")
                ):
                    raise FactorySyncError("stale_product_checkpoint")
                return {
                    "accepted": True,
                    "idempotent": True,
                    "receipt": _copy(existing_receipt),
                }
            if (
                job.status != "blocked"
                or checkpoint["revision"] != expected_checkpoint_revision
                or checkpoint["runId"] != expected_checkpoint_run_id
            ):
                raise FactorySyncError("stale_product_checkpoint")
            live_projection = self._projection
            live_session = live_projection.get("session") if isinstance(live_projection, dict) else None
            live_registration = live_projection.get("registration") if isinstance(live_projection, dict) else None
            if (
                not isinstance(live_session, dict)
                or not isinstance(live_registration, dict)
                or live_registration.get("jobId") != job_id
                or any(
                    live_session.get(field) != checkpoint.get(field)
                    for field in ("productId", "productKey", "inputFingerprint")
                )
                or live_session.get("workspaceId") != checkpoint.get("projectId")
            ):
                raise FactorySyncError("factory_workfile_rebind_identity_mismatch")
            rebind: JsonObject = {
                "jobId": job_id,
                "expectedHydratedWorkfileRevision": expected_hydrated_revision,
                "expectedCheckpointRevision": expected_checkpoint_revision,
                "expectedCheckpointRunId": expected_checkpoint_run_id,
                "expectedCheckpointDigest": _json_digest(checkpoint),
                "requiredValues": _copy(job.payload.get("requiredValues")),
                "inputImages": _copy(job.payload.get("inputImages")),
                "protectedState": _protected_projection_state(self._projection),
            }
            return self.queue_workfile_hydration(payload, checkpoint_rebind=rebind)

    def resume_product(
        self,
        job_id: str,
        *,
        image_model: str | None = None,
        expected_checkpoint_revision: int | None = None,
        expected_checkpoint_run_id: str | None = None,
    ) -> JsonObject:
        with self._condition:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_not_found")
            self._require_admitted_runtime_build_locked()
            if image_model is not None and image_model not in PRODUCT_IMAGE_MODELS:
                raise FactorySyncError("factory_product_image_model_invalid")
            if job.status not in {"waiting_manual", "blocked", "completed"}:
                raise FactorySyncError("factory_product_job_not_resumable")
            rebind_receipt = job.checkpoint_rebind_receipt
            if rebind_receipt is not None:
                if (
                    type(expected_checkpoint_revision) is not int
                    or not isinstance(expected_checkpoint_run_id, str)
                    or not expected_checkpoint_run_id.strip()
                    or job.checkpoint is None
                    or expected_checkpoint_revision != job.checkpoint.get("revision")
                    or expected_checkpoint_run_id != job.checkpoint.get("runId")
                    or expected_checkpoint_revision != rebind_receipt.get("newRevision")
                    or expected_checkpoint_run_id != rebind_receipt.get("newRunId")
                ):
                    raise FactorySyncError("stale_product_checkpoint")
            elif expected_checkpoint_revision is not None or expected_checkpoint_run_id is not None:
                if (
                    type(expected_checkpoint_revision) is not int
                    or not isinstance(expected_checkpoint_run_id, str)
                    or job.checkpoint is None
                    or expected_checkpoint_revision != job.checkpoint.get("revision")
                    or expected_checkpoint_run_id != job.checkpoint.get("runId")
                ):
                    raise FactorySyncError("stale_product_checkpoint")
            registration = self._projection.get("registration") if isinstance(self._projection, dict) else None
            current_job_id = (
                str(registration.get("jobId") or "")
                if isinstance(registration, dict)
                else ""
            )
            current_session = (
                self._projection.get("session")
                if isinstance(self._projection, dict)
                and isinstance(self._projection.get("session"), dict)
                else {}
            )
            checkpoint_revision = (
                int(job.checkpoint.get("revision") or 0)
                if isinstance(job.checkpoint, dict)
                else 0
            )
            resume_live_checkpoint = (
                job.status == "blocked"
                and job.checkpoint is not None
                and current_job_id == job.job_id
                and isinstance(current_session.get("revision"), int)
                and int(current_session["revision"]) > checkpoint_revision
            )
            restart_fresh = job.status == "blocked" and job.checkpoint is None
            restore_only = (
                job.status == "blocked"
                and job.checkpoint is not None
                and not resume_live_checkpoint
            ) or (
                job.status == "completed"
                and job.checkpoint is not None
                and isinstance(registration, dict)
                and registration.get("status") == "blocked"
            ) or (current_job_id != job.job_id and not restart_fresh)
            if restore_only and job.checkpoint is None:
                raise FactorySyncError("factory_product_checkpoint_missing")
            if not restore_only and job.status == "completed":
                return self._public_product_job(job)
            if (
                not restore_only
                and job.status == "waiting_manual"
                and not self._stage_has_selection_locked(job.stage_key)
            ):
                raise FactorySyncError("factory_decision_required")
            with self._product_state_transaction_locked():
                if image_model is not None:
                    job.payload["imageModel"] = image_model
                job.status = "queued"
                job.restore_only = restore_only
                if restart_fresh:
                    job.start_fresh_next = True
                    job.stage_key = ""
                job.decision_status = ""
                job.message = (
                    "초기 실패 · 같은 입력으로 새 실행 대기"
                    if restart_fresh
                    else "제품 체크포인트 복원 대기"
                    if restore_only
                    else "선택 저장 완료 · 다음 단계 실행 대기"
                )
                self._dispatch_next_product_locked()
                self._append_event(
                    "factory.product.updated",
                    {"job": self._public_product_job(job)},
                )
                self._persist_product_jobs_locked()
            self._condition.notify_all()
            return self._public_product_job(job)

    def _require_admitted_runtime_build_locked(self) -> None:
        if not self._expected_build_id:
            return
        current = self._factory_session
        if current is None or current.build_id != self._expected_build_id:
            raise FactorySyncError("factory_worker_build_not_admitted")

    def hold_product_decision(self, job_id: str, stage_key: str) -> JsonObject:
        with self._condition:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_not_found")
            if job.status != "waiting_manual" or job.stage_key != stage_key:
                raise FactorySyncError("decision_target_required")
            with self._product_state_transaction_locked():
                job.decision_status = "manual_required"
                job.message = "GPT 자동판단 보류 · 수동 선택 필요"
                public_job = self._public_product_job(job)
                self._append_event("factory.product.updated", {"job": public_job})
                self._persist_product_jobs_locked()
            self._condition.notify_all()
            return public_job

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
        *,
        checkpoint_rebind: Mapping[str, JsonValue] | None = None,
    ) -> JsonObject:
        if "checkpointRebind" in payload:
            raise FactorySyncError("factory_workfile_payload_invalid")
        file_name = _required_text(payload, "fileName")
        if (
            "/" in file_name
            or "\\" in file_name
            or not file_name.casefold().endswith(".kuasangse")
        ):
            raise FactorySyncError("factory_workfile_name_invalid")
        workfile_text = payload.get("workfileText")
        if not isinstance(workfile_text, str) or not workfile_text.strip():
            raise FactorySyncError("factory_control_field_missing:workfileText")
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
            **({"checkpointRebind": _copy(dict(checkpoint_rebind))} if checkpoint_rebind is not None else {}),
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
                    blank_session = (
                        self._projection.get("session")
                        if isinstance(self._projection, dict)
                        else None
                    )
                    blank_rebind = (
                        execution.session_id != current.session_id
                        and isinstance(self._projection, dict)
                        and self._projection.get("connected") is False
                        and isinstance(blank_session, dict)
                        and set(blank_session).issubset({"revision"})
                        and blank_session.get("revision", 0) == 0
                        and isinstance(command_payload.get("expectedInputFingerprint"), str)
                        and bool(command_payload["expectedInputFingerprint"].strip())
                    )
                    if not blank_rebind:
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

    def _mutable_state_snapshot_locked(self) -> _MutableStateSnapshot:
        return _MutableStateSnapshot(
            executions={
                order_id: _Execution(
                    order=_copy(execution.order),
                    status=execution.status,
                    worker_id=execution.worker_id,
                    event_sequence=execution.event_sequence,
                    session_id=execution.session_id,
                )
                for order_id, execution in self._executions.items()
            },
            projection=_copy(self._projection),
            events=_copy(self._events),
            event_sequence=self._event_sequence,
            product_jobs={
                job_id: _ProductJob(
                    job_id=job.job_id,
                    payload=_copy(job.payload),
                    status=job.status,
                    stage_key=job.stage_key,
                    message=job.message,
                    current_order_id=job.current_order_id,
                    attempts=job.attempts,
                    decision_status=job.decision_status,
                    start_fresh_next=job.start_fresh_next,
                    restore_only=job.restore_only,
                    checkpoint=_copy(job.checkpoint),
                    checkpoint_rebind_receipt=_copy(job.checkpoint_rebind_receipt),
                )
                for job_id, job in self._product_jobs.items()
            },
        )

    def _restore_mutable_state_locked(self, snapshot: _MutableStateSnapshot) -> None:
        self._executions = snapshot.executions
        self._projection = snapshot.projection
        self._events = snapshot.events
        self._event_sequence = snapshot.event_sequence
        self._product_jobs = snapshot.product_jobs

    @contextmanager
    def _product_state_transaction_locked(self) -> Iterator[None]:
        snapshot = self._mutable_state_snapshot_locked()
        try:
            yield
        except Exception:
            self._restore_mutable_state_locked(snapshot)
            raise

    def _load_product_jobs(self) -> tuple[dict[str, _ProductJob], bool]:
        path = self._state_path
        if path is None or not path.exists():
            return {}, False
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise FactorySyncError("factory_product_state_read_failed") from error
        if not isinstance(document, dict) or document.get("schema") != PRODUCT_JOB_STATE_SCHEMA:
            raise FactorySyncError("factory_product_state_invalid")
        raw_jobs = document.get("jobs")
        if not isinstance(raw_jobs, list):
            raise FactorySyncError("factory_product_state_invalid")
        jobs: dict[str, _ProductJob] = {}
        recovered_startup_orphan = False
        for raw in raw_jobs:
            if not isinstance(raw, dict):
                raise FactorySyncError("factory_product_state_invalid")
            job_id = _required_text(raw, "jobId")
            payload = raw.get("payload")
            status = str(raw.get("status") or "")
            attempts = raw.get("attempts")
            start_fresh_next = raw.get("startFreshNext")
            restore_only = raw.get("restoreOnly", False)
            checkpoint = raw.get("checkpoint")
            checkpoint_rebind_receipt = raw.get("checkpointRebindReceipt")
            if (
                not isinstance(payload, dict)
                or status not in {"queued", "running", "waiting_manual", "blocked", "completed"}
                or type(attempts) is not int
                or attempts < 0
                or not isinstance(start_fresh_next, bool)
                or not isinstance(restore_only, bool)
                or job_id in jobs
            ):
                raise FactorySyncError("factory_product_state_invalid")
            normalized_checkpoint = (
                _validate_product_checkpoint_state(checkpoint, job_id)
                if checkpoint is not None
                else None
            )
            normalized_rebind_receipt = (
                _validate_product_checkpoint_rebind_receipt(
                    checkpoint_rebind_receipt,
                    job_id,
                    normalized_checkpoint,
                )
                if checkpoint_rebind_receipt is not None
                else None
            )
            if restore_only and normalized_checkpoint is None:
                raise FactorySyncError("factory_product_state_invalid")
            current_order_id = str(raw.get("currentOrderId") or "")
            if status == "running" or current_order_id:
                recovered_startup_orphan = True
                status = "blocked"
                message = "백엔드 재시작으로 작업 소유권이 만료되었습니다. 작업자가 재개해주세요."
                if current_order_id:
                    self._executions[current_order_id] = _Execution(
                        order={"orderId": current_order_id},
                        status="superseded",
                        session_id="startup-orphan",
                    )
            else:
                message = str(raw.get("message") or "조립공장 실행 대기")
            jobs[job_id] = _ProductJob(
                job_id=job_id,
                payload=_normalize_product_job_payload(payload),
                status=status,
                stage_key=str(raw.get("stageKey") or ""),
                message=message,
                attempts=attempts,
                decision_status=str(raw.get("decisionStatus") or ""),
                start_fresh_next=start_fresh_next,
                restore_only=restore_only,
                checkpoint=normalized_checkpoint,
                checkpoint_rebind_receipt=normalized_rebind_receipt,
            )
        return jobs, recovered_startup_orphan

    def _persist_product_jobs_locked(self) -> None:
        path = self._state_path
        if path is None:
            return
        document: JsonObject = {
            "schema": PRODUCT_JOB_STATE_SCHEMA,
            "jobs": [
                {
                    "jobId": job.job_id,
                    "payload": _copy(job.payload),
                    "status": job.status,
                    "stageKey": job.stage_key,
                    "message": job.message,
                    "currentOrderId": job.current_order_id,
                    "attempts": job.attempts,
                    "decisionStatus": job.decision_status,
                    "startFreshNext": job.start_fresh_next,
                    "restoreOnly": job.restore_only,
                    "checkpoint": _copy(job.checkpoint),
                    "checkpointRebindReceipt": _copy(job.checkpoint_rebind_receipt),
                }
                for job in self._product_jobs.values()
            ],
        }
        temp_path: Path | None = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix="factory-product-jobs-",
                suffix=".tmp",
                delete=False,
            )
            temp_path = Path(handle.name)
            with handle:
                json.dump(document, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            temp_path.replace(path)
        except OSError as error:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            raise FactorySyncError("factory_product_state_write_failed") from error

    def _rebind_selection_orders_locked(
        self,
        session: _FactorySession,
        projection: Mapping[str, JsonValue],
    ) -> None:
        projection_session = projection.get("session")
        for execution in self._executions.values():
            command = execution.order.get("command")
            if (
                execution.session_id == session.session_id
                or execution.status not in {"pending", "claimed", "acknowledged", "running"}
                or not isinstance(command, dict)
                or command.get("name") != "selectFactoryACut"
            ):
                continue
            payload = command.get("payload")
            if not isinstance(projection_session, dict) or not isinstance(payload, dict):
                execution.status = "superseded"
                continue
            try:
                _assert_selection_identity(projection_session, payload)
            except FactorySyncError:
                execution.status = "superseded"
                continue
            execution.status = "pending"
            execution.worker_id = ""
            execution.event_sequence = 0
            execution.session_id = session.session_id
            execution.order["workerSessionId"] = session.session_id
            execution.order["targetWorkerId"] = session.worker_id
            execution.order["workerHttpSessionId"] = session.http_session_id

    def _reconcile_restored_product_jobs_locked(
        self,
        projection: Mapping[str, JsonValue],
    ) -> None:
        registration = projection.get("registration")
        restored_job_id = (
            str(registration.get("jobId") or "")
            if isinstance(registration, dict)
            else ""
        )
        for job in self._product_jobs.values():
            if job.status == "queued" and not job.current_order_id and job.attempts > 0:
                job.start_fresh_next = restored_job_id != job.job_id

    def _recover_inflight_products_locked(
        self,
        replaced_session_id: str,
        projection: Mapping[str, JsonValue],
        *,
        operator_resumable: bool = False,
    ) -> bool:
        registration = projection.get("registration")
        restored_job_id = (
            str(registration.get("jobId") or "")
            if isinstance(registration, dict)
            else ""
        )
        jobs_by_order = {
            job.current_order_id: job
            for job in self._product_jobs.values()
            if job.current_order_id
        }
        recovered_product = False
        for execution in self._executions.values():
            command = execution.order.get("command")
            if (
                execution.session_id != replaced_session_id
                or execution.status not in {"claimed", "acknowledged", "running"}
                or not isinstance(command, dict)
                or command.get("name") != PRODUCT_RUN_COMMAND
            ):
                continue
            execution.status = "superseded"
            job = jobs_by_order.get(str(execution.order.get("orderId") or ""))
            if job is None:
                continue
            job.current_order_id = ""
            if operator_resumable:
                job.status = "blocked"
                job.message = "조립공장 워커 연결이 만료되었습니다. 작업자가 재개해주세요."
            else:
                job.status = "queued"
                job.restore_only = job.checkpoint is not None and restored_job_id != job.job_id
                job.start_fresh_next = restored_job_id != job.job_id and not job.restore_only
                job.message = (
                    "조립공장 워커 재연결 · 제품 체크포인트 복원 대기"
                    if job.restore_only
                    else "조립공장 워커 재연결 · 안전 재실행 대기"
                )
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )
            recovered_product = True
        return recovered_product

    def _dispatch_next_product_locked(self) -> None:
        self._expire_session_locked()
        current = self._factory_session
        if current is None:
            return
        if any(
            job.current_order_id
            or job.status == "running"
            for job in self._product_jobs.values()
            if job.status != "completed"
        ):
            return
        job = next((item for item in self._product_jobs.values() if item.status == "queued"), None)
        if job is None:
            return
        marker = uuid4().hex
        source = job.payload["source"]
        assert isinstance(source, dict)
        jcode = job.payload.get("jcode")
        product_id = f"sinhwa:{jcode}" if isinstance(jcode, int) else f"factory-job:{job.job_id}"
        revision = 0
        if isinstance(self._projection, dict):
            session = self._projection.get("session")
            if isinstance(session, dict) and isinstance(session.get("revision"), int):
                revision = int(session["revision"])
        runtime_payload = {
            key: _copy(job.payload[key])
            for key in (
                "batchId",
                "idempotencyKey",
                "mode",
                "source",
                "productName",
                "workfileName",
                "jcode",
                "imageModel",
                "requiredValues",
                "inputImages",
            )
            if key in job.payload
        }
        policy_snapshot = job.payload.get("policySnapshot")
        if isinstance(policy_snapshot, dict):
            runtime_payload["decisionModes"] = _policy_decision_modes(policy_snapshot)
        source_kind = str(source.get("kind") or "")
        order: JsonObject = {
            "orderId": f"factory-product-{marker}",
            "contractVersion": WORK_ORDER_VERSION,
            "capabilityVersion": WORKER_CAPABILITY_VERSION,
            "batchId": job.payload["batchId"],
            "productId": product_id,
            "productKey": str(job.payload["productName"]),
            "currentRunId": job.job_id,
            "stageId": job.stage_key or "factory-product",
            "operationToken": f"factory-product:{marker}",
            "idempotencyKey": f"{job.payload['idempotencyKey']}:{job.attempts + 1}",
            "expectedWorkfileRevision": revision,
            "workerSessionId": current.session_id,
            "targetWorkerId": current.worker_id,
            "workerHttpSessionId": current.http_session_id,
            "command": {
                "kind": COMMAND_KIND,
                "version": COMMAND_VERSION,
                "name": PRODUCT_RUN_COMMAND,
                "payload": {
                    **runtime_payload,
                    "schema": PRODUCT_RUN_COMMAND_VERSION,
                    "jobId": job.job_id,
                    "startFresh": job.start_fresh_next and not job.restore_only,
                    "expectedStageKey": job.stage_key,
                    "restoreOnly": job.restore_only,
                    "adoptHydratedWorkfile": source_kind == "workfile",
                    **(
                        {"hydratedRevision": job.payload["hydratedRevision"]}
                        if source_kind == "workfile"
                        else {}
                    ),
                    **({"checkpoint": _copy(job.checkpoint)} if job.restore_only else {}),
                },
            },
        }
        job.attempts += 1
        job.start_fresh_next = False
        job.current_order_id = str(order["orderId"])
        job.message = "조립공장 워커 할당 대기"
        self._queue(order)

    def _stage_has_selection_locked(self, stage_key: str) -> bool:
        if not stage_key or not isinstance(self._projection, dict):
            return False
        stages = self._projection.get("stages")
        if not isinstance(stages, list):
            return False
        for stage in stages:
            if not isinstance(stage, dict) or stage.get("key") != stage_key:
                continue
            selected = stage.get("selectedIds")
            return isinstance(selected, list) and bool(selected)
        return False

    def _public_product_job(self, job: _ProductJob) -> JsonObject:
        source = job.payload.get("source")
        source_kind = str(source.get("kind") or "") if isinstance(source, dict) else ""
        images = job.payload.get("inputImages")
        policy_snapshot = job.payload.get("policySnapshot")
        policy = _public_policy_summary(policy_snapshot) if isinstance(policy_snapshot, dict) else {}
        return {
            "schema": "factory-product-job:v1",
            "jobId": job.job_id,
            "batchId": job.payload["batchId"],
            "sourceKind": source_kind,
            **(
                {
                    "sourceSha256": str(source.get("sha256") or ""),
                    "sourceRevision": source.get("revision"),
                    "sourceRunId": str(source.get("runId") or ""),
                }
                if source_kind == "workfile" and isinstance(source, dict)
                else {}
            ),
            "productName": job.payload["productName"],
            "workfileName": str(
                job.payload.get("workfileName")
                or f"{job.payload.get('productName') or '상세페이지 작업'}.kuasangse"
            ),
            "jcode": job.payload.get("jcode"),
            "mode": job.payload["mode"],
            "status": job.status,
            "stageKey": job.stage_key,
            "message": job.message,
            "decisionStatus": job.decision_status,
            "imageCount": len(images) if isinstance(images, list) else 0,
            "attempts": job.attempts,
            "checkpointAvailable": job.checkpoint is not None,
            **({"policy": policy} if policy else {}),
        }

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
                if (
                    execution.session_id
                    and (
                        execution.session_id != session_id
                        if session_id
                        else execution.order.get("workerHttpSessionId")
                        != http_session_id
                    )
                ):
                    continue
                with self._product_state_transaction_locked():
                    execution.status = "claimed"
                    execution.worker_id = worker_id
                    for job in self._product_jobs.values():
                        if job.current_order_id == execution.order.get("orderId"):
                            job.status = "running"
                            job.message = (
                                "제품 체크포인트 복원 중"
                                if job.restore_only
                                else "조립공장 실행 중"
                            )
                            self._append_event(
                                "factory.product.updated",
                                {"job": self._public_product_job(job)},
                            )
                            self._persist_product_jobs_locked()
                            break
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
            if (
                execution.session_id
                and str(payload.get("workerSessionId") or "") != execution.session_id
            ):
                raise FactorySyncError("stale_factory_session")
            _assert_order_identity(execution.order, payload)
            if _required_text(payload, "workerId") != execution.worker_id:
                raise FactorySyncError("lease_conflict")
            sequence = payload.get("eventSequence")
            if not isinstance(sequence, int) or sequence < 0:
                raise FactorySyncError("stale_event_sequence")
            with self._product_state_transaction_locked():
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
                    for job in self._product_jobs.values():
                        if job.current_order_id == order_id:
                            job.status = "blocked"
                            job.current_order_id = ""
                            job.restore_only = False
                            job.message = str(payload.get("error") or "조립공장 실행 실패")
                            self._append_event(
                                "factory.product.updated",
                                {"job": self._public_product_job(job)},
                            )
                            if job.checkpoint is not None:
                                self._dispatch_next_product_locked()
                            break
                else:
                    raise FactorySyncError("worker_action_invalid")
                if action in {"complete", "fail"}:
                    self._persist_product_jobs_locked()
            return {"accepted": True, "orderId": order_id, "status": execution.status}

    def _accept_result(self, execution: _Execution, result: Mapping[str, JsonValue]) -> None:
        command = execution.order["command"]
        assert isinstance(command, dict)
        if command["name"] == "getFactoryProjection":
            self.accept_projection(result)
            return
        if command["name"] == PRODUCT_RUN_COMMAND:
            if result.get("schema") != PRODUCT_RUN_RECEIPT_VERSION:
                raise FactorySyncError("factory_product_receipt_invalid")
            job_id = _required_text(result, "jobId")
            job = self._product_jobs.get(job_id)
            if job is None or job.current_order_id != execution.order.get("orderId"):
                raise FactorySyncError("factory_product_job_not_found")
            status = str(result.get("status") or "")
            if status not in {"waiting_manual", "completed", "blocked"}:
                raise FactorySyncError("factory_product_receipt_invalid")
            projection = result.get("projection")
            if not isinstance(projection, dict):
                raise FactorySyncError("factory_projection_missing")
            normalized = _validate_projection(projection)
            source = job.payload.get("source")
            protected_state = job.payload.get("protectedState")
            adopt_transition = False
            if isinstance(source, dict) and source.get("kind") == "workfile":
                if not isinstance(protected_state, dict):
                    raise FactorySyncError("factory_workfile_fork_protected_state_reduced")
                candidate_state = _protected_projection_state(normalized)
                required_values = job.payload.get("requiredValues")
                if isinstance(required_values, dict) and required_values:
                    protected_state = {**protected_state, "inputs": []}
                    candidate_state = {**candidate_state, "inputs": []}
                if not _protected_state_is_preserved(protected_state, candidate_state):
                    raise FactorySyncError("factory_workfile_fork_protected_state_reduced")
                session = normalized.get("session")
                registration = normalized.get("registration")
                adopt_transition = (
                    isinstance(session, dict)
                    and isinstance(registration, dict)
                    and registration.get("jobId") == job_id
                    and session.get("workspaceId") == f"batch:{job_id}"
                    and all(
                        session.get(field) == source.get(field)
                        for field in ("productId", "productKey", "runId", "inputFingerprint")
                    )
                )
            try:
                if not adopt_transition:
                    _assert_projection_is_fresh(self._projection, normalized)
            except FactorySyncError as error:
                payload = command.get("payload")
                restore_revision_race = (
                    error.code == "stale_workfile_revision"
                    and isinstance(payload, dict)
                    and payload.get("restoreOnly") is True
                )
                if error.code != "stale_event_sequence" and not restore_revision_race:
                    raise
                if self._projection is None:
                    raise
                incoming_session = normalized.get("session")
                current_session = self._projection.get("session")
                if not isinstance(incoming_session, dict) or not isinstance(current_session, dict):
                    raise
                if restore_revision_race:
                    if any(
                        incoming_session.get(field) != current_session.get(field)
                        for field in (
                            "workspaceId",
                            "productId",
                            "productKey",
                            "runId",
                            "inputFingerprint",
                        )
                    ):
                        raise FactorySyncError("stale_run_fingerprint") from error
                else:
                    _assert_session_identity(self._projection, incoming_session)
                    normalized = _copy(self._projection)
            checkpoint = _validate_product_checkpoint_receipt(
                result.get("checkpoint"),
                job.job_id,
                normalized,
                status,
                str(result.get("stageKey") or "").strip(),
            )
            self._projection = normalized
            job.status = status
            job.stage_key = str(result.get("stageKey") or "").strip()
            job.message = str(result.get("message") or "").strip()
            job.decision_status = ""
            job.current_order_id = ""
            job.restore_only = False
            job.checkpoint = checkpoint
            self._append_event(
                "factory.product.updated",
                {
                    "job": self._public_product_job(job),
                    "projection": normalized,
                },
            )
            payload = command.get("payload")
            if not isinstance(payload, dict) or payload.get("restoreOnly") is not True:
                self._dispatch_next_product_locked()
            self._condition.notify_all()
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
            session_revision = session.get("revision")
            if type(session_revision) is not int or session_revision < 0:
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
            public_receipt: JsonObject = {
                "schema": "factory-workfile-hydration-receipt:v1",
                "capabilityVersion": WORKFILE_COMMAND_VERSION,
                "fileName": _required_text(payload, "fileName"),
                "workfileSha256": _required_text(payload, "expectedSha256"),
                "projectId": _required_text(payload, "expectedWorkspaceId"),
                "name": _required_text(payload, "expectedProductKey"),
            }
            public_projection = _public_hydration_projection(normalized, payload)
            checkpoint_rebind = payload.get("checkpointRebind")
            if checkpoint_rebind is not None:
                if not isinstance(checkpoint_rebind, dict) or set(checkpoint_rebind) != {
                    "jobId",
                    "expectedHydratedWorkfileRevision",
                    "expectedCheckpointRevision",
                    "expectedCheckpointRunId",
                    "expectedCheckpointDigest",
                    "requiredValues",
                    "inputImages",
                    "protectedState",
                }:
                    raise FactorySyncError("factory_workfile_rebind_invalid")
                job_id = _required_text(checkpoint_rebind, "jobId")
                expected_hydrated_revision = checkpoint_rebind.get("expectedHydratedWorkfileRevision")
                if type(expected_hydrated_revision) is not int or session_revision != expected_hydrated_revision:
                    raise FactorySyncError("factory_workfile_rebind_identity_mismatch")
                job = self._product_jobs.get(job_id)
                if job is None or job.status != "blocked":
                    raise FactorySyncError("stale_product_checkpoint")
                expected_checkpoint_digest = checkpoint_rebind.get("expectedCheckpointDigest")
                if (
                    not isinstance(job.checkpoint, dict)
                    or not isinstance(expected_checkpoint_digest, str)
                    or _json_digest(job.checkpoint) != expected_checkpoint_digest
                ):
                    raise FactorySyncError("stale_product_checkpoint")
                checkpoint = _validate_product_checkpoint_state(job.checkpoint, job_id)
                expected_checkpoint_revision = checkpoint_rebind.get("expectedCheckpointRevision")
                if (
                    not isinstance(expected_checkpoint_revision, int)
                    or checkpoint["revision"] != expected_checkpoint_revision
                    or checkpoint["runId"] != checkpoint_rebind.get("expectedCheckpointRunId")
                ):
                    raise FactorySyncError("stale_product_checkpoint")
                protected_state = checkpoint_rebind.get("protectedState")
                if not isinstance(protected_state, dict):
                    raise FactorySyncError("factory_workfile_rebind_protected_state_reduced")
                if (
                    job.payload.get("requiredValues") != checkpoint_rebind.get("requiredValues")
                    or job.payload.get("inputImages") != checkpoint_rebind.get("inputImages")
                    or not _protected_state_is_preserved(
                        protected_state,
                        _protected_projection_state(normalized),
                    )
                ):
                    raise FactorySyncError("factory_workfile_rebind_protected_state_reduced")
                checkpoint_revision = checkpoint.get("revision")
                if type(checkpoint_revision) is not int:
                    raise FactorySyncError("factory_product_checkpoint_invalid")
                if session_revision < checkpoint_revision:
                    raise FactorySyncError("factory_workfile_rebind_revision_regression")
                rebound_checkpoint = _validate_product_checkpoint_receipt(
                    {
                        "schema": PRODUCT_CHECKPOINT_VERSION,
                        "jobId": job_id,
                        "projectId": f"batch:{job_id}",
                        "productId": session["productId"],
                        "productKey": session["productKey"],
                        "runId": session["runId"],
                        "inputFingerprint": session["inputFingerprint"],
                        "revision": session_revision,
                        "status": job.status,
                        "stageKey": job.stage_key,
                        "savedAt": max(1, int(self._clock())),
                    },
                    job_id,
                    normalized,
                    job.status,
                    job.stage_key,
                )
                rebind_receipt: JsonObject = {
                    "schema": PRODUCT_CHECKPOINT_REBIND_RECEIPT_VERSION,
                    "jobId": job_id,
                    "workfileSha256": payload["expectedSha256"],
                    "oldRevision": checkpoint["revision"],
                    "oldRunId": checkpoint["runId"],
                    "newRevision": rebound_checkpoint["revision"],
                    "newRunId": rebound_checkpoint["runId"],
                    "checkpointDigest": _json_digest(rebound_checkpoint),
                }
                self._projection = normalized
                job.checkpoint = rebound_checkpoint
                job.checkpoint_rebind_receipt = rebind_receipt
                self._append_event(
                    "factory.product.checkpoint.rebound",
                    {"receipt": rebind_receipt, "job": self._public_product_job(job)},
                )
                self._condition.notify_all()
                return
            workfile_fork = payload.get("workfileFork")
            if workfile_fork is not None:
                if not isinstance(workfile_fork, dict) or set(workfile_fork) != {
                    "expectedHydratedWorkfileRevision",
                    "productPayload",
                }:
                    raise FactorySyncError("factory_workfile_fork_payload_invalid")
                product_payload = workfile_fork.get("productPayload")
                if not isinstance(product_payload, dict):
                    raise FactorySyncError("factory_workfile_fork_payload_invalid")
                normalized_product = _normalize_product_job_payload(product_payload)
                source = normalized_product.get("source")
                if (
                    not isinstance(source, dict)
                    or source.get("sha256") != payload.get("expectedSha256")
                    or source.get("revision") != workfile_fork.get("expectedHydratedWorkfileRevision")
                    or source.get("runId") != session.get("runId")
                    or source.get("workspaceId") != session.get("workspaceId")
                    or source.get("productId") != session.get("productId")
                    or source.get("productKey") != session.get("productKey")
                    or source.get("inputFingerprint") != session.get("inputFingerprint")
                ):
                    raise FactorySyncError("factory_workfile_fork_identity_mismatch")
                normalized_product["hydratedRevision"] = session_revision
                idempotency_key = str(normalized_product["idempotencyKey"])
                existing = next(
                    (
                        item
                        for item in self._product_jobs.values()
                        if item.payload.get("idempotencyKey") == idempotency_key
                    ),
                    None,
                )
                if existing is None:
                    normalized_product["protectedState"] = _protected_projection_state(normalized)
                    job = _ProductJob(
                        job_id=f"factory-job-{uuid4().hex}",
                        payload=normalized_product,
                        start_fresh_next=False,
                        message="작업파일 검증 완료 · 새 작업 실행 대기",
                    )
                    self._product_jobs[job.job_id] = job
                    self._append_event(
                        "factory.product.queued",
                        {"job": self._public_product_job(job)},
                    )
                    self._persist_product_jobs_locked()
                self._projection = normalized
                self._append_event(
                    "factory.workfile.hydrated",
                    {"receipt": public_receipt, "projection": public_projection},
                )
                self._dispatch_next_product_locked()
                self._condition.notify_all()
                return
            self._projection = normalized
            self._append_event(
                "factory.workfile.hydrated",
                {"receipt": public_receipt, "projection": public_projection},
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
        with self._product_state_transaction_locked():
            recovered_product = self._recover_inflight_products_locked(
                current.session_id,
                self._projection or {},
                operator_resumable=True,
            )
            if recovered_product:
                self._persist_product_jobs_locked()
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
        projection["eventCursor"] = str(self._event_sequence)
        if self._expected_build_id:
            projection["expectedWorkerBuildId"] = self._expected_build_id
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


def _has_sensitive_product_field(value: JsonValue) -> bool:
    if isinstance(value, dict):
        return any(
            SENSITIVE_PRODUCT_FIELD.search(key) is not None
            or _has_sensitive_product_field(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_has_sensitive_product_field(child) for child in value)
    return False


def _has_sensitive_product_value(value: JsonValue) -> bool:
    if isinstance(value, str):
        return SENSITIVE_PRODUCT_VALUE.search(value) is not None
    if isinstance(value, dict):
        return any(
            key != "dataUrl" and _has_sensitive_product_value(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_has_sensitive_product_value(child) for child in value)
    return False


def _validate_product_checkpoint_state(value: Any, job_id: str) -> JsonObject:
    if not isinstance(value, dict) or set(value) != {
        "schema",
        "jobId",
        "projectId",
        "productId",
        "productKey",
        "runId",
        "inputFingerprint",
        "revision",
        "status",
        "stageKey",
        "savedAt",
    }:
        raise FactorySyncError("factory_product_checkpoint_invalid")
    if (
        value.get("schema") != PRODUCT_CHECKPOINT_VERSION
        or value.get("jobId") != job_id
        or value.get("projectId") != f"batch:{job_id}"
        or value.get("status") not in {"waiting_manual", "blocked", "completed"}
        or not isinstance(value.get("stageKey"), str)
        or value["stageKey"] != value["stageKey"].strip()
        or type(value.get("revision")) is not int
        or value["revision"] < 0
        or type(value.get("savedAt")) is not int
        or value["savedAt"] < 1
    ):
        raise FactorySyncError("factory_product_checkpoint_invalid")
    for field in ("productId", "productKey", "runId", "inputFingerprint"):
        _required_text(value, field)
    return _copy(value)


def _validate_product_checkpoint_rebind_receipt(
    value: JsonValue,
    job_id: str,
    checkpoint: JsonObject | None,
) -> JsonObject:
    if checkpoint is None or not isinstance(value, dict) or set(value) != {
        "schema",
        "jobId",
        "workfileSha256",
        "oldRevision",
        "oldRunId",
        "newRevision",
        "newRunId",
        "checkpointDigest",
    }:
        raise FactorySyncError("factory_product_checkpoint_rebind_receipt_invalid")
    workfile_sha256 = value.get("workfileSha256")
    old_revision = value.get("oldRevision")
    old_run_id = value.get("oldRunId")
    checkpoint_revision = checkpoint.get("revision")
    checkpoint_run_id = checkpoint.get("runId")
    if (
        value.get("schema") != PRODUCT_CHECKPOINT_REBIND_RECEIPT_VERSION
        or value.get("jobId") != job_id
        or not isinstance(workfile_sha256, str)
        or re.fullmatch(r"[a-f0-9]{64}", workfile_sha256) is None
        or type(old_revision) is not int
        or old_revision < 0
        or not isinstance(old_run_id, str)
        or not old_run_id.strip()
        or value.get("newRevision") != checkpoint_revision
        or value.get("newRunId") != checkpoint_run_id
        or value.get("checkpointDigest") != _json_digest(checkpoint)
    ):
        raise FactorySyncError("factory_product_checkpoint_rebind_receipt_invalid")
    return dict(value)


def _json_digest(value: Mapping[str, JsonValue]) -> str:
    return sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _protected_member_digests(values: list[JsonValue]) -> list[JsonValue]:
    digests: list[JsonValue] = []
    for value in values:
        digests.append(
            sha256(
                json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
        )
    return digests


def _protected_projection_state(value: Mapping[str, JsonValue] | None) -> JsonObject:
    if value is None:
        raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
    inputs = value.get("inputs")
    stages = value.get("stages")
    outputs = value.get("outputs", [])
    if not isinstance(inputs, list) or not isinstance(stages, list) or not isinstance(outputs, list):
        raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
    protected_stages: JsonObject = {}
    for stage in stages:
        if not isinstance(stage, dict):
            raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
        stage_key = _required_text(stage, "key")
        selected = stage.get("selectedIds", [])
        candidates = stage.get("candidates", [])
        if (
            not isinstance(selected, list)
            or not isinstance(candidates, list)
            or stage_key in protected_stages
        ):
            raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
        candidate_ids: set[str] = set()
        for candidate in candidates:
            if not isinstance(candidate, dict):
                raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
            candidate_id = candidate.get("id")
            if not isinstance(candidate_id, str):
                raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
            candidate_ids.add(candidate_id)
        if len(candidate_ids) != len(candidates) or any(
            not isinstance(selected_id, str) or selected_id not in candidate_ids
            for selected_id in selected
        ):
            raise FactorySyncError("factory_workfile_rebind_protected_state_invalid")
        stage_state: JsonObject = {
            "selectedIds": _protected_member_digests(selected),
            "candidates": _protected_member_digests(candidates),
        }
        protected_stages[stage_key] = stage_state
    return {
        "inputs": _protected_member_digests(inputs),
        "outputs": _protected_member_digests(outputs),
        "stages": protected_stages,
    }


def _protected_state_is_preserved(
    baseline: Mapping[str, JsonValue],
    candidate: Mapping[str, JsonValue],
) -> bool:
    baseline_inputs = baseline.get("inputs")
    candidate_inputs = candidate.get("inputs")
    baseline_outputs = baseline.get("outputs")
    candidate_outputs = candidate.get("outputs")
    baseline_stages = baseline.get("stages")
    candidate_stages = candidate.get("stages")
    if (
        not isinstance(baseline_inputs, list)
        or not isinstance(candidate_inputs, list)
        or not isinstance(baseline_outputs, list)
        or not isinstance(candidate_outputs, list)
        or not isinstance(baseline_stages, dict)
        or not isinstance(candidate_stages, dict)
        or Counter(baseline_inputs) - Counter(candidate_inputs)
        or Counter(baseline_outputs) - Counter(candidate_outputs)
    ):
        return False
    for stage_key, baseline_stage in baseline_stages.items():
        candidate_stage = candidate_stages.get(stage_key)
        if not isinstance(baseline_stage, dict) or not isinstance(candidate_stage, dict):
            return False
        for field in ("selectedIds", "candidates"):
            baseline_members = baseline_stage.get(field)
            candidate_members = candidate_stage.get(field)
            if (
                not isinstance(baseline_members, list)
                or not isinstance(candidate_members, list)
                or Counter(baseline_members) - Counter(candidate_members)
            ):
                return False
    return True


def _rebind_request_is_idempotent(
    receipt: Mapping[str, JsonValue],
    payload: Mapping[str, JsonValue],
) -> bool:
    return (
        receipt.get("workfileSha256") == payload.get("expectedSha256")
        and receipt.get("oldRevision") == payload.get("expectedCheckpointRevision")
        and receipt.get("oldRunId") == payload.get("expectedCheckpointRunId")
        and receipt.get("newRevision") == payload.get("expectedHydratedWorkfileRevision")
        and receipt.get("newRunId") == payload.get("expectedRunId")
    )


def _validate_product_checkpoint_receipt(
    value: Any,
    job_id: str,
    projection: Mapping[str, JsonValue],
    status: str,
    stage_key: str,
) -> JsonObject:
    checkpoint = _validate_product_checkpoint_state(value, job_id)
    session = projection.get("session")
    if not isinstance(session, dict):
        raise FactorySyncError("factory_product_checkpoint_invalid")
    if (
        checkpoint["status"] != status
        or checkpoint["stageKey"] != stage_key
        or checkpoint["productId"] != session.get("productId")
        or checkpoint["productKey"] != session.get("productKey")
        or checkpoint["runId"] != session.get("runId")
        or checkpoint["inputFingerprint"] != session.get("inputFingerprint")
        or checkpoint["revision"] != session.get("revision")
    ):
        raise FactorySyncError("factory_product_checkpoint_invalid")
    registration = projection.get("registration")
    if not isinstance(registration, dict) or registration.get("jobId") != job_id:
        raise FactorySyncError("factory_product_checkpoint_invalid")
    return checkpoint


def _normalize_product_job_payload(payload: Mapping[str, JsonValue]) -> JsonObject:
    raw_payload = dict(payload)
    if set(raw_payload) - PRODUCT_JOB_INPUT_KEYS:
        raise FactorySyncError("factory_product_payload_invalid")
    if _has_sensitive_product_field(raw_payload) or _has_sensitive_product_value(raw_payload):
        raise FactorySyncError("factory_product_sensitive_field_forbidden")
    batch_id = _required_text(payload, "batchId")
    idempotency_key = _required_text(payload, "idempotencyKey")
    product_name = _required_text(payload, "productName")
    workfile_name = str(
        payload.get("workfileName") or f"{product_name}.kuasangse"
    ).strip()
    if (
        "/" in workfile_name
        or "\\" in workfile_name
        or not workfile_name.casefold().endswith(".kuasangse")
        or len(workfile_name) > 160
    ):
        raise FactorySyncError("factory_product_workfile_invalid")
    mode = _required_text(payload, "mode")
    if mode not in {"manual", "auto"}:
        raise FactorySyncError("factory_product_mode_invalid")
    image_model = payload.get("imageModel")
    if image_model is not None and image_model not in PRODUCT_IMAGE_MODELS:
        raise FactorySyncError("factory_product_image_model_invalid")
    source = payload.get("source")
    if not isinstance(source, dict) or source.get("kind") not in {"manual", "sinhwa-db", "workfile"}:
        raise FactorySyncError("factory_product_source_invalid")
    source_kind = str(source["kind"])
    expected_source_keys = (
        {"kind"}
        if source_kind == "manual"
        else {"kind", "selectionId"}
        if source_kind == "sinhwa-db"
        else {
            "kind",
            "sha256",
            "revision",
            "runId",
            "workspaceId",
            "productId",
            "productKey",
            "inputFingerprint",
        }
    )
    if set(source) != expected_source_keys:
        raise FactorySyncError("factory_product_source_invalid")
    source_revision = source.get("revision")
    if source_kind == "workfile" and (
        re.fullmatch(r"[a-f0-9]{64}", str(source.get("sha256") or "")) is None
        or type(source_revision) is not int
        or source_revision < 0
        or any(not isinstance(source.get(key), str) or not str(source[key]).strip() for key in (
            "runId",
            "workspaceId",
            "productId",
            "productKey",
            "inputFingerprint",
        ))
    ):
        raise FactorySyncError("factory_product_source_invalid")
    jcode = payload.get("jcode")
    if source_kind == "sinhwa-db" and (not isinstance(jcode, int) or jcode < 1):
        raise FactorySyncError("factory_product_jcode_invalid")
    if source_kind == "sinhwa-db" and source.get("selectionId") != str(jcode):
        raise FactorySyncError("factory_product_jcode_invalid")
    if jcode is not None and (not isinstance(jcode, int) or jcode < 1):
        raise FactorySyncError("factory_product_jcode_invalid")
    required_values = payload.get("requiredValues", {})
    if (
        not isinstance(required_values, dict)
        or set(required_values) - PRODUCT_REQUIRED_VALUE_KEYS
        or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in required_values.values())
    ):
        raise FactorySyncError("factory_product_required_values_invalid")
    normalized_required_values = {
        key: str(value).strip()
        for key, value in required_values.items()
        if str(value).strip()
    }
    category = str(payload.get("category") or "").strip()
    if category:
        if normalized_required_values.get("category") not in {None, category}:
            raise FactorySyncError("factory_product_required_values_invalid")
        normalized_required_values["category"] = category
    if (
        any(len(value) > 200 for value in normalized_required_values.values())
        or (
            "salePrice" in normalized_required_values
            and re.fullmatch(r"\d{1,12}", normalized_required_values["salePrice"]) is None
        )
        or (
            "stock" in normalized_required_values
            and re.fullmatch(r"\d{1,9}", normalized_required_values["stock"]) is None
        )
        or normalized_required_values.get("optionMode", "provided") not in {"provided", "none"}
    ):
        raise FactorySyncError("factory_product_required_values_invalid")
    images_value = payload.get("inputImages", [])
    if not isinstance(images_value, list):
        raise FactorySyncError("factory_product_images_invalid")
    images: list[JsonObject] = []
    total_bytes = 0
    for value in images_value:
        if not isinstance(value, dict) or set(value) - PRODUCT_IMAGE_KEYS:
            raise FactorySyncError("factory_product_images_invalid")
        role = str(value.get("role") or "")
        data_url = str(value.get("dataUrl") or "")
        prefix, separator, encoded = data_url.partition(",")
        if (
            role not in {"base", "color-option"}
            or not str(value.get("name") or "").strip()
            or not separator
            or not prefix.startswith("data:image/")
            or not prefix.endswith(";base64")
        ):
            raise FactorySyncError("factory_product_images_invalid")
        try:
            total_bytes += len(b64decode(encoded, validate=True))
        except (Base64Error, ValueError):
            raise FactorySyncError("factory_product_images_invalid") from None
        images.append(_copy(value))
    if source_kind == "manual" and not any(image.get("role") == "base" for image in images):
        raise FactorySyncError("factory_product_base_image_required")
    if total_bytes > MAX_WORKFILE_BYTES:
        raise FactorySyncError("factory_product_images_too_large")
    normalized_source: JsonObject = {key: value for key, value in source.items()}
    normalized_images: list[JsonValue] = [dict(image) for image in images]
    normalized: JsonObject = {
        "batchId": batch_id,
        "idempotencyKey": idempotency_key,
        "mode": mode,
        "source": normalized_source,
        "productName": product_name,
        "workfileName": workfile_name,
        "jcode": jcode,
        **({"imageModel": image_model} if image_model is not None else {}),
        "requiredValues": normalized_required_values,
        "inputImages": normalized_images,
    }
    pdp_job_id = payload.get("pdpJobId")
    if pdp_job_id is not None:
        if not isinstance(pdp_job_id, str) or not pdp_job_id.strip():
            raise FactorySyncError("factory_product_payload_invalid")
        normalized["pdpJobId"] = pdp_job_id.strip()
    policy_snapshot = payload.get("policySnapshot")
    if policy_snapshot is not None:
        if not isinstance(policy_snapshot, dict):
            raise FactorySyncError("factory_product_payload_invalid")
        try:
            validate_policy_snapshot(policy_snapshot)
        except PolicyError as error:
            raise FactorySyncError(error.code) from error
        expected_policy_product = str(jcode if jcode is not None else product_name)
        if (
            policy_snapshot.get("batchId") != batch_id
            or policy_snapshot.get("productId") != expected_policy_product
        ):
            raise FactorySyncError("policy_identity_missing")
        normalized["policySnapshot"] = _copy(policy_snapshot)
    protected_state = payload.get("protectedState")
    if protected_state is not None:
        if source_kind != "workfile" or not isinstance(protected_state, dict):
            raise FactorySyncError("factory_product_payload_invalid")
        normalized["protectedState"] = _copy(protected_state)
    hydrated_revision = payload.get("hydratedRevision")
    if hydrated_revision is not None:
        if source_kind != "workfile" or type(hydrated_revision) is not int or hydrated_revision < 0:
            raise FactorySyncError("factory_product_payload_invalid")
        normalized["hydratedRevision"] = hydrated_revision
    approval_mode = payload.get("cafe24ApprovalMode")
    if approval_mode is not None:
        if approval_mode != "existing_one_time_target_gate":
            raise FactorySyncError("factory_product_payload_invalid")
        normalized["cafe24ApprovalMode"] = approval_mode
    contract_type = payload.get("contractType")
    contract_version = payload.get("contractVersion")
    if (
        (contract_type is not None or contract_version is not None)
        and (contract_type != "manual-product-intake" or contract_version != "1.0.0")
    ):
        raise FactorySyncError("factory_product_payload_invalid")
    return normalized


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
    build_id = _required_text(payload, "buildId")
    if WORKER_BUILD_ID.fullmatch(build_id) is None:
        raise FactorySyncError("factory_worker_build_invalid")
    return _FactorySession(
        session_id=_required_text(payload, "sessionId"),
        worker_id=_required_text(payload, "workerId"),
        build_id=build_id,
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


def _public_hydration_projection(
    value: Mapping[str, JsonValue],
    payload: Mapping[str, JsonValue],
) -> JsonObject:
    def text(mapping: Mapping[str, JsonValue], key: str) -> str:
        item = mapping.get(key)
        return item.strip() if isinstance(item, str) else ""

    def integer(mapping: Mapping[str, JsonValue], key: str) -> int:
        item = mapping.get(key)
        return item if type(item) is int and item >= 0 else 0

    def number(mapping: Mapping[str, JsonValue], key: str) -> int | float | None:
        item = mapping.get(key)
        return item if isinstance(item, (int, float)) and not isinstance(item, bool) else None

    def strings(mapping: Mapping[str, JsonValue], key: str) -> list[JsonValue]:
        items = mapping.get(key)
        return [item.strip() for item in items if isinstance(item, str) and item.strip()] if isinstance(items, list) else []

    def public_progress(mapping: Mapping[str, JsonValue]) -> JsonObject:
        return {
            "status": text(mapping, "status"),
            "stageKey": text(mapping, "stageKey"),
            "stageLabel": text(mapping, "stageLabel"),
            "percent": number(mapping, "percent") or 0,
            "elapsedMs": integer(mapping, "elapsedMs"),
            "mode": text(mapping, "mode"),
            "message": text(mapping, "message"),
        }

    def public_publication(mapping: Mapping[str, JsonValue]) -> JsonObject:
        result: JsonObject = {}
        for key in (
            "schema", "receiptId", "status", "jobId", "productName", "productNo",
            "externalProductNo", "remoteProductNo", "productCode", "mallId",
            "registrationMode", "sourceWorkfileName", "registeredAt", "storefrontUrl",
            "productUrl", "productLink", "adminUrl", "remoteReadbackDigest",
        ):
            item = text(mapping, key)
            if item:
                result[key] = item
        for key in ("representativeImageCount", "detailImageCount", "variantCount"):
            item = mapping.get(key)
            if type(item) is int and item >= 0:
                result[key] = item
        remote = mapping.get("remoteReadback")
        if isinstance(remote, dict):
            result["remoteReadback"] = public_publication(remote)
        return result

    session_value = value.get("session")
    session = session_value if isinstance(session_value, dict) else {}
    inputs_value = value.get("inputs")
    inputs: list[JsonValue] = []
    if isinstance(inputs_value, list):
        for input_value in inputs_value:
            if not isinstance(input_value, dict):
                continue
            items_value = input_value.get("items")
            items: list[JsonValue] = []
            if isinstance(items_value, list):
                for item_value in items_value:
                    if not isinstance(item_value, dict):
                        continue
                    items.append({
                        "name": text(item_value, "name"),
                        "market": text(item_value, "market"),
                        "price": text(item_value, "price"),
                        "thumbnailUrl": text(item_value, "thumbnailUrl"),
                        "selected": item_value.get("selected") is True,
                        "analysisReady": item_value.get("analysisReady") is True,
                        "detailImageCount": integer(item_value, "detailImageCount"),
                    })
            inputs.append({
                "key": text(input_value, "key"),
                "count": integer(input_value, "count"),
                "missing": strings(input_value, "missing"),
                "items": items,
            })

    stages_value = value.get("stages")
    stages: list[JsonValue] = []
    if isinstance(stages_value, list):
        for stage_value in stages_value:
            if not isinstance(stage_value, dict):
                continue
            candidates_value = stage_value.get("candidates")
            candidates: list[JsonValue] = []
            if isinstance(candidates_value, list):
                for candidate_value in candidates_value:
                    if not isinstance(candidate_value, dict):
                        continue
                    candidate_id = text(candidate_value, "id") or text(candidate_value, "candidateId")
                    candidates.append({
                        "id": candidate_id,
                        "assetId": text(candidate_value, "assetId") or candidate_id,
                        "thumbnailUrl": text(candidate_value, "thumbnailUrl") or text(candidate_value, "thumbnailRef"),
                        "digest": text(candidate_value, "digest"),
                        "source": text(candidate_value, "source"),
                        "model": text(candidate_value, "model"),
                        "confidence": number(candidate_value, "confidence"),
                        "rationale": text(candidate_value, "rationale"),
                        "receipt": {} if isinstance(candidate_value.get("receipt"), dict) else None,
                    })
            selected_id = text(stage_value, "selectedId") or text(stage_value, "selectedCandidateId")
            selected_ids = stage_value.get("selectedIds")
            if not selected_id and isinstance(selected_ids, list) and selected_ids:
                selected_id = selected_ids[0] if isinstance(selected_ids[0], str) else ""
            stages.append({
                "key": text(stage_value, "key") or text(stage_value, "stageKey"),
                "status": text(stage_value, "status"),
                "selectedId": selected_id,
                "updatedAt": text(stage_value, "updatedAt"),
                "candidates": candidates,
            })

    registration_value = value.get("registration")
    registration_source = registration_value if isinstance(registration_value, dict) else {}
    registration: JsonObject = {}
    for key in (
        "jobId", "productId", "productKey", "mode", "status", "batchId", "categoryId",
        "categoryLabel", "htmlDigest", "idempotencyKey", "sourceWorkfileName", "productCode",
        "mallId", "optionName", "approvalTokenState", "remoteReadbackDigest", "remoteProductNo",
    ):
        item = text(registration_source, key)
        if item:
            registration[key] = item
    for key in ("expectedWorkfileRevision", "variantCount", "inventoryQuantity"):
        item = registration_source.get(key)
        if type(item) is int and item >= 0:
            registration[key] = item
    for key in ("blockers", "imageDigests", "optionValues"):
        items = strings(registration_source, key)
        if items:
            registration[key] = items
    for key in ("publicationReceipt", "remoteReadback"):
        item = registration_source.get(key)
        if isinstance(item, dict):
            registration[key] = public_publication(item)

    receipts_value = value.get("receipts")
    receipts: list[JsonValue] = []
    if isinstance(receipts_value, list):
        receipts = [public_publication(receipt) for receipt in receipts_value if isinstance(receipt, dict)]
    products_value = value.get("products")
    products: list[JsonValue] = []
    if isinstance(products_value, list):
        for product_value in products_value:
            if not isinstance(product_value, dict):
                continue
            progress_value = product_value.get("progress")
            products.append({
                "productId": text(product_value, "productId"),
                "productKey": text(product_value, "productKey"),
                "progress": public_progress(progress_value if isinstance(progress_value, dict) else {}),
            })

    progress_value = value.get("progress")
    return {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": COMMAND_VERSION,
        "cursor": text(value, "cursor") or str(integer(value, "sequence")),
        "sequence": integer(value, "sequence"),
        "connected": value.get("connected") is True,
        "status": text(value, "status"),
        "reason": text(value, "reason") or text(value, "blockReason"),
        "capturedAt": text(value, "capturedAt"),
        "session": {
            "workspaceId": _required_text(payload, "expectedWorkspaceId"),
            "productId": _required_text(payload, "expectedProductId"),
            "productKey": _required_text(payload, "expectedProductKey"),
            "runId": _required_text(payload, "expectedRunId"),
            "inputFingerprint": _required_text(payload, "expectedInputFingerprint"),
            "revision": integer(session, "revision"),
            "workfileName": _required_text(payload, "fileName"),
            "workfileSha256": _required_text(payload, "expectedSha256"),
            "workfileBytes": integer(session, "workfileBytes"),
        },
        "inputs": inputs,
        "stages": stages,
        "progress": public_progress(progress_value if isinstance(progress_value, dict) else {}),
        "registration": registration,
        "receipts": receipts,
        "products": products,
    }


def _projection_content(value: Mapping[str, JsonValue]) -> JsonObject:
    return {
        key: _copy(item)
        for key, item in value.items()
        if key not in {"capturedAt", "cursor", "sequence"}
    }


def _preserve_terminal_publication_receipt(
    previous: Mapping[str, JsonValue] | None,
    incoming: JsonObject,
) -> JsonObject:
    if previous is None:
        return incoming
    previous_session = previous.get("session")
    incoming_session = incoming.get("session")
    previous_registration = previous.get("registration")
    incoming_registration = incoming.get("registration")
    if (
        not isinstance(previous_session, dict)
        or not isinstance(incoming_session, dict)
        or not isinstance(previous_registration, dict)
        or not isinstance(incoming_registration, dict)
        or any(
            previous_session.get(key) != incoming_session.get(key)
            for key in ("productId", "productKey", "runId", "inputFingerprint", "revision")
        )
        or previous_registration.get("idempotencyKey")
        != incoming_registration.get("idempotencyKey")
    ):
        return incoming
    receipt = previous_registration.get("publicationReceipt")
    if (
        not isinstance(receipt, dict)
        or receipt.get("schema")
        != "factory-cafe24-terminal-publication-receipt:v1"
    ):
        return incoming
    merged = _copy(incoming)
    registration = _copy(incoming_registration)
    registration.update(
        {
            "status": "staged_verified",
            "blockers": [],
            "publicationReceipt": _copy(receipt),
            "remoteReadbackDigest": receipt.get("remoteReadbackDigest"),
            "remoteProductNo": receipt.get("remoteProductNo"),
        },
    )
    merged["registration"] = registration
    merged["status"] = "staged_verified"
    return merged


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
