from __future__ import annotations

from base64 import b64decode
from binascii import Error as Base64Error
from collections import Counter
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
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

from .asset_store import AssetStoreError, ProductAssetStore
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
# Cafe24 등록 대상 값. 투입할 때 지정해 두면 등록이 그대로 따라가고, 비워 두면 등록 시점에
# 정하거나 운영자가 스토어에서 직접 고른다. 필수로 두면 기존 투입이 전부 막히므로 선택이다.
PRODUCT_OPTIONAL_VALUE_KEYS = frozenset(
    {"cafe24CategoryId", "supplyPrice", "displayStatus", "sellingStatus"}
)
PRODUCT_VALUE_KEYS = PRODUCT_REQUIRED_VALUE_KEYS | PRODUCT_OPTIONAL_VALUE_KEYS
CAFE24_REGISTRATION_VALUE_KEYS = frozenset(
    {"categoryId", "salePrice", "supplyPrice", "displayStatus", "sellingStatus"}
)
PRODUCT_IMAGE_KEYS = frozenset(
    {"role", "ordinal", "name", "fileName", "colorName", "sha256", "dataUrl"}
)
PRODUCT_IMAGE_MODELS = frozenset({"api-hub-openai-image", "gemini-3.1-flash-image"})
WORKER_BUILD_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
ASSET_DESCRIPTOR_CACHE_LIMIT = 512


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


FACTORY_STAGE_KEYS: tuple[str, ...] = (
    "representative",
    "size",
    "option_color",
    "general",
    "sections",
    "final_detail",
)
PRODUCT_PROGRESS_SCHEMA = "factory-product-progress:v1"
PRODUCT_SELECTION_RESERVATION_SCHEMA = "factory-product-selection-reservation:v1"
PRODUCT_PROGRESS_CANDIDATE_KEYS = (
    "id",
    "assetId",
    "thumbnailUrl",
    "thumbnailRef",
    "digest",
    "source",
    "model",
    "confidence",
    "rationale",
)


def _public_progress_candidate(candidate: Mapping[str, JsonValue]) -> JsonObject:
    identifier = str(
        candidate.get("id") or candidate.get("candidateId") or candidate.get("assetId") or ""
    ).strip()
    public: JsonObject = {"id": identifier}
    for key in PRODUCT_PROGRESS_CANDIDATE_KEYS:
        if key == "id" or key not in candidate:
            continue
        value = candidate[key]
        if isinstance(value, (str, int, float)) and not isinstance(value, bool):
            public[key] = value
    return public


def _product_progress_snapshot(projection: Mapping[str, JsonValue] | None) -> JsonObject | None:
    """작업 하나의 공정 진행 상태를 projection 에서 뽑아 작업에 고정 보관할 형태로 만든다.

    워커가 다음 작업으로 넘어가도 이 스냅샷은 남아서, 멈춘 지점과 남은 후보를
    작업별로 나란히 보여줄 수 있다.
    """
    if not isinstance(projection, Mapping):
        return None
    raw_stages = projection.get("stages")
    stages: list[JsonValue] = []
    selected_count = 0
    awaiting: list[JsonValue] = []
    for raw in raw_stages if isinstance(raw_stages, list) else []:
        if not isinstance(raw, Mapping):
            continue
        key = str(raw.get("key") or raw.get("stageKey") or "").strip()
        if key not in FACTORY_STAGE_KEYS:
            continue
        raw_candidates = raw.get("candidates")
        candidates = [
            _public_progress_candidate(item)
            for item in (raw_candidates if isinstance(raw_candidates, list) else [])
            if isinstance(item, Mapping)
        ]
        raw_selected = raw.get("selectedIds")
        selected_ids = [
            str(item)
            for item in (raw_selected if isinstance(raw_selected, list) else [])
            if isinstance(item, str) and item.strip()
        ]
        selected_id = str(raw.get("selectedId") or raw.get("selectedCandidateId") or "").strip()
        if not selected_id and selected_ids:
            selected_id = selected_ids[0]
        status = str(raw.get("status") or ("waiting_manual" if candidates else "empty")).strip()
        if selected_id:
            selected_count += 1
        elif candidates:
            awaiting.append(key)
        stages.append(
            {
                "key": key,
                "status": status,
                "selectedId": selected_id,
                "candidateCount": len(candidates),
                "candidates": candidates,
            }
        )
    raw_progress = projection.get("progress")
    progress = raw_progress if isinstance(raw_progress, Mapping) else {}
    percent = progress.get("percent")
    raw_registration = projection.get("registration")
    registration = raw_registration if isinstance(raw_registration, Mapping) else {}
    blockers = registration.get("blockers")
    return {
        "schema": PRODUCT_PROGRESS_SCHEMA,
        "stageKey": str(progress.get("stageKey") or "").strip(),
        "percent": percent if isinstance(percent, int) and 0 <= percent <= 100 else 0,
        "mode": str(progress.get("mode") or progress.get("status") or "").strip(),
        "selectedStageCount": selected_count,
        "totalStageCount": len(FACTORY_STAGE_KEYS),
        "awaitingStageKeys": awaiting,
        "stages": stages,
        "registration": {
            "status": str(registration.get("status") or "").strip(),
            "blockers": [
                str(item)
                for item in (blockers if isinstance(blockers, list) else [])
                if isinstance(item, str) and item.strip()
            ],
        },
    }


PRODUCT_TIMING_SCHEMA = "factory-product-timing:v1"
MISSING_ASSET_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
MISSING_ASSET_MESSAGE = (
    "입력 이미지 원본을 찾지 못했습니다. 이미지를 다시 투입해야 이 작업을 진행할 수 있습니다."
)



def _empty_timing() -> JsonObject:
    return {
        "schema": PRODUCT_TIMING_SCHEMA,
        "stages": [],
        "totalMachineMs": 0,
        "totalWaitMs": 0,
    }


def _accumulate_timing(
    timing: Mapping[str, JsonValue] | None,
    stage_key: str,
    *,
    machine_ms: int = 0,
    wait_ms: int = 0,
) -> JsonObject:
    """공정 한 단계에 든 기계 시간과 사람 대기 시간을 작업 기록에 더한다."""
    document = dict(timing) if isinstance(timing, Mapping) else _empty_timing()
    raw_stages = document.get("stages")
    stages = (
        [dict(entry) for entry in raw_stages if isinstance(entry, Mapping)]
        if isinstance(raw_stages, list)
        else []
    )
    target = next((entry for entry in stages if entry.get("stageKey") == stage_key), None)
    if target is None:
        target = {"stageKey": stage_key, "machineMs": 0, "waitMs": 0}
        stages.append(target)
    target["machineMs"] = int(target.get("machineMs") or 0) + max(0, machine_ms)
    target["waitMs"] = int(target.get("waitMs") or 0) + max(0, wait_ms)
    return {
        "schema": PRODUCT_TIMING_SCHEMA,
        "stages": stages,
        "totalMachineMs": sum(int(entry.get("machineMs") or 0) for entry in stages),
        "totalWaitMs": sum(int(entry.get("waitMs") or 0) for entry in stages),
    }


@dataclass(slots=True)
class _Execution:
    order: JsonObject
    status: str = "pending"
    worker_id: str = ""
    event_sequence: int = 0
    session_id: str = ""
    # 마지막으로 워커가 이 주문에 신호를 보낸 시각. 0 이면 아직 받아가지 않은 주문이다.
    # 관측용 값이라 상태 동등성 비교에서는 제외한다. 포함하면 실패한 연산이 상태를
    # 바꾸지 않았는지 확인하는 계약이 시각 차이만으로 깨진다.
    last_seen: float = field(default=0.0, compare=False)


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
    progress: JsonObject | None = None
    pending_selection: JsonObject | None = None
    auto_resume_pending: bool = False
    timing: JsonObject | None = None
    stage_started_at: float | None = None
    waiting_since: float | None = None
    assets_missing: bool = False


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
        # 워커는 브라우저 탭이라 창이 뒤로 밀리면 타이머가 조여져 신호가 늦어진다. 90 초는
        # 그 흔들림을 못 견뎌, 멀쩡히 일하는 워커가 끊기고 작업이 통째로 되돌아갔다.
        # 진짜로 죽은 워커는 주문 만료가 같은 기준으로 회수한다.
        session_timeout_seconds: float = 300.0,
        order_timeout_seconds: float = 300.0,
        clock: Callable[[], float] = monotonic,
        state_path: Path | None = None,
        expected_build_id: str = "",
        asset_store: ProductAssetStore | None = None,
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
        self._asset_descriptors: dict[str, JsonObject] = {}
        self._asset_store = asset_store or (
            ProductAssetStore(state_path.parent / "factory-input-assets")
            if state_path is not None
            else None
        )
        self._expected_build_id = expected_build_id
        if expected_build_id and WORKER_BUILD_ID.fullmatch(expected_build_id) is None:
            raise FactorySyncError("factory_worker_build_invalid")
        self._product_jobs, recovered_startup_orphan = self._load_product_jobs()
        needs_asset_migration = self._asset_store is not None and any(
            isinstance(image, dict) and isinstance(image.get("dataUrl"), str)
            for job in self._product_jobs.values()
            for image in (
                job.payload.get("inputImages")
                if isinstance(job.payload.get("inputImages"), list)
                else []
            )
        ) and not self._legacy_document_is_externalized()
        self._session_timeout_seconds = max(1.0, session_timeout_seconds)
        self._order_timeout_seconds = max(1.0, order_timeout_seconds)
        self._clock = clock
        if recovered_startup_orphan:
            self._persist_product_jobs_locked()
        elif needs_asset_migration:
            # 예전 상태 문서는 이미지 본문을 그대로 안고 있다. 기동할 때 한 번만 자산 저장소로 옮긴다.
            self._persist_product_jobs_locked()

    def _legacy_document_is_externalized(self) -> bool:
        """이미 assetRef 형태로 저장된 문서인지 본다."""
        path = self._state_path
        if path is None or not path.is_file():
            return True
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return True
        jobs = document.get("jobs")
        for job in jobs if isinstance(jobs, list) else []:
            payload = job.get("payload") if isinstance(job, dict) else None
            images = payload.get("inputImages") if isinstance(payload, dict) else None
            for image in images if isinstance(images, list) else []:
                if isinstance(image, dict) and isinstance(image.get("dataUrl"), str):
                    return False
        return True

    @property
    def _projection(self) -> JsonObject | None:
        return self._projection_value

    @_projection.setter
    def _projection(self, value: JsonObject | None) -> None:
        self._projection_value = value
        if not isinstance(value, dict):
            return
        jobs = getattr(self, "_product_jobs", None)
        if not jobs:
            return
        snapshot = _product_progress_snapshot(value)
        if snapshot is None:
            return
        job = self._job_for_projection_locked(value, jobs)
        if job is not None:
            job.progress = snapshot

    def _job_for_projection_locked(
        self,
        projection: Mapping[str, JsonValue],
        jobs: dict[str, _ProductJob],
    ) -> _ProductJob | None:
        registration = projection.get("registration")
        job_id = str(registration.get("jobId") or "") if isinstance(registration, Mapping) else ""
        if job_id in jobs:
            return jobs[job_id]
        session = projection.get("session")
        run_id = str(session.get("runId") or "") if isinstance(session, Mapping) else ""
        if run_id in jobs:
            return jobs[run_id]
        if not run_id:
            return None
        for job in jobs.values():
            checkpoint = job.checkpoint
            if isinstance(checkpoint, Mapping) and str(checkpoint.get("runId") or "") == run_id:
                return job
        return None

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
            self._flush_pending_selection_locked(self._projection)
            self._advance_after_selection_locked(self._projection or {})
            self._requeue_stranded_reservations_locked()
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
                self._flush_pending_selection_locked(normalized)
                self._advance_after_selection_locked(self._projection or {})
                return {
                    "accepted": True,
                    "changed": False,
                    "cursor": str(self._event_sequence),
                    "sessionCursor": session.cursor,
                }
            self._projection = normalized
            self._flush_pending_selection_locked(normalized)
            self._advance_after_selection_locked(self._projection or {})
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
            self._flush_pending_selection_locked(normalized)
            self._advance_after_selection_locked(self._projection or {})
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
            if job.assets_missing:
                raise FactorySyncError("factory_product_asset_missing")
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
                and self._stage_has_candidates_locked(job.stage_key)
                and not self._stage_has_selection_locked(job.stage_key)
            ):
                raise FactorySyncError("factory_decision_required")
            with self._product_state_transaction_locked():
                if image_model is not None:
                    job.payload["imageModel"] = image_model
                if job.waiting_since is not None:
                    job.timing = _accumulate_timing(
                        job.timing,
                        job.stage_key,
                        wait_ms=int((self._clock() - job.waiting_since) * 1000),
                    )
                    job.waiting_since = None
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

    def reserve_product_selection(
        self,
        job_id: str,
        payload: Mapping[str, JsonValue],
    ) -> JsonObject:
        """대기 중인 작업의 A컷 선택을 예약한다.

        조립공장 워커는 한 번에 작업파일 하나만 열 수 있으므로, 지금 열려 있지 않은
        작업의 선택은 예약해 두었다가 워커가 그 작업을 다시 열 때 자동으로 적용한다.
        """
        stage_key = _required_text(payload, "stageKey")
        candidate_id = _required_text(payload, "candidateId")
        receipt = payload.get("decisionReceipt")
        if receipt is not None and not isinstance(receipt, Mapping):
            raise FactorySyncError("factory_selection_receipt_invalid")
        with self._condition:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_missing")
            if job.status not in {"waiting_manual", "blocked"}:
                raise FactorySyncError("factory_selection_target_invalid")
            if not _progress_has_candidate(job.progress, stage_key, candidate_id):
                raise FactorySyncError("candidate_membership_invalid")
            auto_resume = payload.get("autoResume") is not False
            reservation: JsonObject = {
                "schema": PRODUCT_SELECTION_RESERVATION_SCHEMA,
                "stageKey": stage_key,
                "candidateId": candidate_id,
                "autoResume": auto_resume,
                "decisionMode": str(payload.get("decisionMode") or "manual"),
                "idempotencyKey": str(
                    payload.get("idempotencyKey")
                    or f"factory-job:{job_id}:{stage_key}:{candidate_id}"
                ),
                **(
                    {"decisionReceipt": _copy(dict(receipt))}
                    if isinstance(receipt, Mapping)
                    else {}
                ),
            }
            with self._product_state_transaction_locked():
                job.pending_selection = reservation
                job.auto_resume_pending = auto_resume
                self._persist_product_jobs_locked()
            applied = self._flush_pending_selection_locked(self._projection)
            requeued = False
            if applied is None and auto_resume:
                # 조립공장이 지금 다른 작업파일을 열고 있으면, 이 작업을 다시 대기열에 넣어
                # 워커가 순서대로 돌아와 예약한 컷을 적용하게 한다.
                requeued = self._requeue_for_reserved_selection_locked(job)
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )
            self._condition.notify_all()
            return {
                "jobId": job_id,
                "status": "applied" if applied is not None else "reserved",
                "requeued": requeued,
                "reservation": _copy(reservation),
                **({"order": applied} if applied is not None else {}),
            }

    def _requeue_stranded_reservations_locked(self) -> None:
        """주문이 무효화돼 순번을 잃은 예약을 다시 대기열에 세운다.

        워커가 다시 켜지면 예약해 둔 컷이 조용히 사라지는 대신 그 작업으로 돌아간다.
        """
        for job in list(self._product_jobs.values()):
            if (
                job.pending_selection is None
                or not job.auto_resume_pending
                or job.current_order_id
                or job.status not in {"waiting_manual", "blocked"}
            ):
                continue
            self._requeue_for_reserved_selection_locked(job)

    def _requeue_for_reserved_selection_locked(self, job: _ProductJob) -> bool:
        """예약한 컷을 적용하려면 조립공장이 그 작업파일을 다시 열어야 하므로 순번을 다시 잡는다."""
        try:
            self.resume_product(job.job_id)
        except FactorySyncError:
            return False
        return True

    def _resume_after_selection_locked(self, projection: Mapping[str, JsonValue]) -> None:
        """예약해 둔 컷이 조립공장에 반영되면, 그 작업을 다음 단계로 바로 이어서 진행한다.

        운영자가 작업마다 재개를 누르지 않아도 1번 → 2번 순서로 계속 돌게 하기 위한 고리다.
        """
        job = self._job_for_projection_locked(projection, self._product_jobs)
        if job is None:
            return
        if job.pending_selection is not None:
            job.pending_selection = None
            self._persist_product_jobs_locked()
        if not job.auto_resume_pending or job.status != "waiting_manual":
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )
            return
        self._advance_after_selection_locked(projection)

    def _advance_after_selection_locked(self, projection: Mapping[str, JsonValue]) -> None:
        """고른 컷이 조립공장 화면에 반영된 뒤에만 다음 단계로 넘긴다.

        반영 전에 재개하면 factory_decision_required 로 작업이 통째로 막히므로,
        아직이면 자동 진행 의도를 남겨 두고 다음 화면 보고를 기다린다.
        """
        job = self._job_for_projection_locked(projection, self._product_jobs)
        if job is None or not job.auto_resume_pending or job.status != "waiting_manual":
            return
        if not self._stage_has_selection_locked(job.stage_key):
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )
            return
        job.auto_resume_pending = False
        try:
            self.resume_product(job.job_id)
        except FactorySyncError as error:
            job.auto_resume_pending = True
            job.message = f"자동 진행 보류 · 직접 재개해 주세요 ({error.code})"
            self._persist_product_jobs_locked()
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )

    def resume_products(self, job_ids: Sequence[str]) -> JsonObject:
        """대기 중인 작업 여러 건을 한 번에 다음 단계로 넘긴다."""
        results: list[JsonValue] = []
        for job_id in job_ids:
            try:
                job = self.resume_product(str(job_id))
            except FactorySyncError as error:
                results.append({"jobId": str(job_id), "status": "error", "reason": error.code})
                continue
            results.append({"jobId": str(job_id), "status": "resumed", "job": job})
        return {
            "schema": "factory-batch-resume:v1",
            "results": results,
            "resumed": sum(1 for item in results if isinstance(item, dict) and item["status"] == "resumed"),
            "failed": sum(1 for item in results if isinstance(item, dict) and item["status"] == "error"),
        }

    def clear_product_selection(self, job_id: str) -> JsonObject:
        with self._condition:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_missing")
            if job.pending_selection is not None or job.auto_resume_pending:
                with self._product_state_transaction_locked():
                    job.pending_selection = None
                    job.auto_resume_pending = False
                    self._persist_product_jobs_locked()
                self._append_event(
                    "factory.product.updated",
                    {"job": self._public_product_job(job)},
                )
                self._condition.notify_all()
            return {"jobId": job_id, "status": "cleared"}

    def _flush_pending_selection_locked(
        self,
        projection: Mapping[str, JsonValue] | None,
    ) -> JsonObject | None:
        """워커가 연 작업에 예약된 선택이 있으면 지금 조립공장 주문으로 내보낸다."""
        if not isinstance(projection, Mapping) or projection.get("connected") is not True:
            return None
        session = projection.get("session")
        if not isinstance(session, Mapping):
            return None
        job = self._job_for_projection_locked(projection, self._product_jobs)
        reservation = job.pending_selection if job is not None else None
        if job is None or not isinstance(reservation, Mapping):
            return None
        stage_key = str(reservation.get("stageKey") or "")
        candidate_id = str(reservation.get("candidateId") or "")
        if not _projection_has_candidate(projection, stage_key, candidate_id):
            return None
        # 이 예약으로 이미 내보낸 주문이 아직 살아 있으면 다시 내지 않는다.
        # 중복 발행되면 조립공장이 같은 선택을 두 번 수행하고, 두 번째 완료 직후
        # 아직 반영되지 않은 화면에서 다음 단계가 시도되어 작업이 막힌다.
        base_key = str(reservation.get("idempotencyKey") or "")
        if base_key and any(
            execution.status in {"pending", "claimed", "acknowledged", "running"}
            and str(execution.order.get("idempotencyKey") or "").startswith(base_key)
            for execution in self._executions.values()
        ):
            return None
        queue_payload: JsonObject = {
            "productId": session["productId"],
            "productKey": session["productKey"],
            "stageKey": stage_key,
            "candidateId": candidate_id,
            "expectedRevision": session["revision"],
            "expectedRunId": session["runId"],
            "expectedInputFingerprint": session["inputFingerprint"],
            # 작업파일 판(revision)마다 주문을 새로 낸다. 이전 주문이 무효화돼도 다시 시도할 수 있다.
            "idempotencyKey": f"{reservation.get('idempotencyKey') or ''}:{session['revision']}",
        }
        try:
            order = self.queue_selection(queue_payload)
        except FactorySyncError:
            return None
        with self._product_state_transaction_locked():
            job.message = "예약한 A컷 선택을 조립공장에 적용하는 중"
            self._persist_product_jobs_locked()
        self._append_event(
            "factory.product.updated",
            {"job": self._public_product_job(job)},
        )
        return order

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

    def queue_cafe24_registration(
        self,
        job_id: str,
        cafe24: Mapping[str, JsonValue] | None = None,
    ) -> JsonObject:
        """완성된 작업을 Cafe24 에 등록하도록 조립공장에 지시한다.

        등록 대상 값(분류·판매가·진열)을 함께 실어 보낸다. 조립공장에는 등록 화면이 없어
        이 값을 주지 않으면 등록이 빈 값으로 어긋난다.
        """
        with self._condition:
            job = self._product_jobs.get(job_id)
            if job is None:
                raise FactorySyncError("factory_product_job_not_found")
            self._require_admitted_runtime_build_locked()
            if job.status != "completed":
                raise FactorySyncError("factory_cafe24_job_not_ready")
            if job.current_order_id:
                raise FactorySyncError("factory_product_job_busy")
            session = (self._projection or {}).get("session")
            if not isinstance(session, dict):
                raise FactorySyncError("factory_session_missing")
            registration = (self._projection or {}).get("registration")
            on_target = isinstance(registration, dict) and registration.get("jobId") == job_id
            # 워커가 지금 다른 제품을 물고 있어도, 저장해 둔 지점이 있으면 그것으로 이 작업을
            # 열어서 등록한다. 여기서 막아버리면 완성된 제품이 워커의 현재 상태에 따라
            # 등록되기도 하고 안 되기도 한다.
            checkpoint = _copy(job.checkpoint) if isinstance(job.checkpoint, dict) else None
            if not on_target and not checkpoint:
                raise FactorySyncError("factory_cafe24_target_mismatch")
            identity: Mapping[str, JsonValue] = session if on_target else (job.checkpoint or {})
            values = {
                **_cafe24_values_from_job(job.payload),
                **_normalize_cafe24_registration_values(cafe24),
            }
            marker = uuid4().hex
            worker_session_id = (
                self._factory_session.session_id if self._factory_session is not None else ""
            )
            target_worker_id = (
                self._factory_session.worker_id if self._factory_session is not None else ""
            )
            order: JsonObject = {
                "orderId": f"factory-cafe24-{marker}",
                "contractVersion": WORK_ORDER_VERSION,
                "capabilityVersion": WORKER_CAPABILITY_VERSION,
                "batchId": "factory-session",
                "productId": str(identity.get("productId") or ""),
                "productKey": str(identity.get("productKey") or ""),
                "currentRunId": str(identity.get("runId") or ""),
                "stageId": "cafe24",
                "operationToken": f"factory-cafe24:{marker}",
                "idempotencyKey": f"factory-cafe24:{job_id}:{marker}",
                "expectedWorkfileRevision": identity.get("revision"),
                "workerSessionId": worker_session_id,
                "targetWorkerId": target_worker_id,
                "command": {
                    "kind": COMMAND_KIND,
                    "version": COMMAND_VERSION,
                    "name": "registerFactoryCafe24",
                    "payload": {
                        **_copy(job.payload),
                        "jobId": job_id,
                        "cafe24": values,
                        **({"checkpoint": checkpoint} if checkpoint else {}),
                    },
                },
            }
            job.current_order_id = str(order["orderId"])
            job.message = "Cafe24 등록을 조립공장에 지시했습니다."
            self._persist_product_jobs_locked()
            self._queue(order)
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )
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
                    last_seen=execution.last_seen,
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
                    progress=_copy(job.progress),
                    pending_selection=_copy(job.pending_selection),
                    auto_resume_pending=job.auto_resume_pending,
                    timing=_copy(job.timing),
                    stage_started_at=job.stage_started_at,
                    waiting_since=job.waiting_since,
                    assets_missing=job.assets_missing,
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

    def _externalized_payload(self, payload: JsonObject) -> JsonObject:
        """상태 문서에 저장할 payload 에서 무거운 이미지 본문을 자산 저장소로 옮긴다."""
        store = self._asset_store
        images = payload.get("inputImages")
        if store is None or not isinstance(images, list) or not images:
            return _copy(payload)
        externalized: list[JsonValue] = []
        moved = False
        for image in images:
            data_url = image.get("dataUrl") if isinstance(image, dict) else None
            if not isinstance(image, dict) or not isinstance(data_url, str) or not data_url:
                externalized.append(_copy(image))
                continue
            descriptor = self._asset_descriptors.get(data_url)
            if descriptor is None:
                try:
                    descriptor = store.put_data_url(data_url)
                except AssetStoreError as error:
                    raise FactorySyncError("factory_product_state_write_failed") from error
                if len(self._asset_descriptors) >= ASSET_DESCRIPTOR_CACHE_LIMIT:
                    self._asset_descriptors.pop(next(iter(self._asset_descriptors)))
                self._asset_descriptors[data_url] = descriptor
            entry: JsonObject = {key: _copy(value) for key, value in image.items() if key != "dataUrl"}
            entry["assetRef"] = descriptor["assetRef"]
            entry["mediaType"] = descriptor["mediaType"]
            entry["byteLength"] = descriptor["byteLength"]
            externalized.append(entry)
            moved = True
        if not moved:
            return _copy(payload)
        document: JsonObject = {
            key: _copy(value) for key, value in payload.items() if key != "inputImages"
        }
        document["inputImages"] = externalized
        return document

    def _placeholder_payload(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        """원본을 못 찾은 이미지를 빈 자리로 채운다. 작업 자체는 목록에 남아 이유를 볼 수 있다."""
        images = payload.get("inputImages")
        document = dict(payload)
        document["inputImages"] = [
            {
                **{
                    key: value
                    for key, value in image.items()
                    if key not in {"assetRef", "mediaType", "byteLength", "dataUrl"}
                },
                "dataUrl": MISSING_ASSET_DATA_URL,
            }
            if isinstance(image, dict)
            else image
            for image in (images if isinstance(images, list) else [])
        ]
        return document

    def _internalized_payload(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        """상태 문서에서 읽은 payload 의 assetRef 를 원래 dataUrl 로 되돌린다."""
        images = payload.get("inputImages")
        if not isinstance(images, list) or not images:
            return dict(payload)
        restored: list[JsonValue] = []
        changed = False
        for image in images:
            if not isinstance(image, dict) or "assetRef" not in image:
                restored.append(image)
                continue
            store = self._asset_store
            if store is None:
                raise FactorySyncError("factory_product_asset_store_missing")
            try:
                data_url = store.data_url(str(image.get("assetRef") or ""))
            except AssetStoreError as error:
                raise FactorySyncError("factory_product_asset_missing") from error
            entry: JsonObject = {
                key: value
                for key, value in image.items()
                if key not in {"assetRef", "mediaType", "byteLength"}
            }
            entry["dataUrl"] = data_url
            if len(self._asset_descriptors) < ASSET_DESCRIPTOR_CACHE_LIMIT:
                self._asset_descriptors[data_url] = {
                    "assetRef": image["assetRef"],
                    "mediaType": image.get("mediaType", ""),
                    "byteLength": image.get("byteLength", 0),
                }
            restored.append(entry)
            changed = True
        if not changed:
            return dict(payload)
        document = dict(payload)
        document["inputImages"] = restored
        return document

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
            assets_missing = False
            try:
                runtime_payload = self._internalized_payload(payload)
            except FactorySyncError as error:
                if error.code != "factory_product_asset_missing":
                    raise
                assets_missing = True
                runtime_payload = self._placeholder_payload(payload)
                status = "blocked"
                current_order_id = ""
                message = MISSING_ASSET_MESSAGE
            jobs[job_id] = _ProductJob(
                job_id=job_id,
                payload=_normalize_product_job_payload(runtime_payload),
                status=status,
                stage_key=str(raw.get("stageKey") or ""),
                message=message,
                attempts=attempts,
                decision_status=str(raw.get("decisionStatus") or ""),
                start_fresh_next=start_fresh_next,
                restore_only=restore_only,
                checkpoint=normalized_checkpoint,
                checkpoint_rebind_receipt=normalized_rebind_receipt,
                progress=raw["progress"] if isinstance(raw.get("progress"), dict) else None,
                pending_selection=(
                    raw["pendingSelection"]
                    if isinstance(raw.get("pendingSelection"), dict)
                    else None
                ),
                auto_resume_pending=raw.get("autoResumePending") is True,
                timing=raw["timing"] if isinstance(raw.get("timing"), dict) else None,
                assets_missing=assets_missing or raw.get("assetsMissing") is True,
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
                    "payload": self._externalized_payload(job.payload),
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
                    "progress": _copy(job.progress),
                    "pendingSelection": _copy(job.pending_selection),
                    "autoResumePending": job.auto_resume_pending,
                    "timing": _copy(job.timing),
                    "assetsMissing": job.assets_missing,
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

    def _release_orphan_orders_locked(self) -> bool:
        """관제탑이 기억하지 못하는 주문을 붙들고 있는 작업을 풀어 준다.

        주문 기록은 메모리에만 있고 작업은 파일에 남는다. 관제탑을 다시 켜면 작업에는
        주문 번호가 적혀 있는데 그 주문은 어디에도 없다. 워커가 하나뿐이라 그런 작업
        하나가 뒤에 선 작업까지 전부 붙든다. 관제탑이 모르는 주문은 진행될 수 없으므로
        되돌려 세운다. 저장해 둔 지점이 있어 다시 세워도 처음부터 하지 않는다.
        """
        released = False
        for job in self._product_jobs.values():
            if job.status == "completed":
                continue
            order_id = str(job.current_order_id or "")
            if order_id and order_id in self._executions:
                continue
            if not order_id and job.status != "running":
                continue
            job.current_order_id = ""
            if job.status == "running":
                job.status = "queued"
                job.message = "관제탑이 다시 켜져 이 작업을 대기열에 다시 세웠습니다."
            released = True
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(job)},
            )
        if released:
            self._persist_product_jobs_locked()
        return released

    def _dispatch_next_product_locked(self) -> None:
        self._expire_session_locked()
        current = self._factory_session
        if current is None:
            return
        self._release_orphan_orders_locked()
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
                    # 그 단계에 고를 후보가 하나도 없을 때만 다시 만들라고 명시한다. 이 표식이
                    # 없으면 조립공장은 결정을 기다리며 멈춘다. 후보가 잠깐 비어 보이는 순간에
                    # 무조건 통과시키면 방금 고른 컷을 지우고 다시 만들어 버린다.
                    "regenerateStage": bool(
                        job.stage_key
                        and job.status == "waiting_manual"
                        and not self._stage_has_candidates_locked(job.stage_key)
                    ),
                    "restoreOnly": job.restore_only,
                    "adoptHydratedWorkfile": source_kind == "workfile",
                    **(
                        {"hydratedRevision": job.payload["hydratedRevision"]}
                        if source_kind == "workfile"
                        else {}
                    ),
                    # 저장해 둔 지점은 restoreOnly 가 아닐 때도 함께 보낸다. 워커가 다른
                    # 제품을 들고 있을 때 이것이 없으면 그 제품의 내용이 이 작업의 문서로
                    # 저장되고, 서버가 신원이 바뀌었다며 저장을 막는다.
                    **(
                        {"checkpoint": _copy(job.checkpoint)}
                        if isinstance(job.checkpoint, dict) and job.checkpoint
                        else {}
                    ),
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

    def _stage_has_candidates_locked(self, stage_key: str) -> bool:
        """그 단계에 실제로 고를 후보가 있는지 본다.

        후보가 하나도 없으면 운영자가 고를 것이 없다. 그때까지 결정을 요구하면
        재개도 못 하고 후보 생성도 못 해 작업이 갇힌다.
        """
        if not stage_key or not isinstance(self._projection, dict):
            return False
        stages = self._projection.get("stages")
        if not isinstance(stages, list):
            return False
        for stage in stages:
            if not isinstance(stage, dict) or stage.get("key") != stage_key:
                continue
            candidates = stage.get("candidates")
            return isinstance(candidates, list) and bool(candidates)
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
            # 등록에 필요한 값이 투입값에 있는지 화면이 알아야, 없을 때 사람에게 받을 수 있다.
            # 분류 입력이 생기기 전에 투입된 작업은 이 값이 비어 있다.
            "cafe24Values": _cafe24_values_from_job(job.payload),
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
            "dispatched": bool(job.current_order_id),
            "autoResumePending": job.auto_resume_pending,
            **({"timing": _copy(job.timing)} if job.timing is not None else {}),
            **({"assetsMissing": True} if job.assets_missing else {}),
            **(
                {"pendingSelection": _copy(job.pending_selection)}
                if job.pending_selection is not None
                else {}
            ),
            **({"progress": _copy(job.progress)} if job.progress is not None else {}),
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
            self._note_worker_liveness_locked(session_id)
            self._expire_stale_orders_locked()
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
                    execution.last_seen = self._clock()
                    for job in self._product_jobs.values():
                        if job.current_order_id == execution.order.get("orderId"):
                            job.status = "running"
                            job.stage_started_at = self._clock()
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
            # 회수를 claim() 안에만 두면 교착에서 빠져나올 수 없다. 워커가 잊은 주문 때문에
            # 대기 주문이 하나도 없는 상태가 되면 claim() 자체가 호출되지 않기 때문이다.
            # 내줄 것이 있는지 판단하기 전에 먼저 회수한다.
            self._expire_stale_orders_locked()
            if not any(execution.status == "pending" for execution in self._executions.values()):
                # 주문 발행은 작업 상태가 바뀌는 순간에만 일어난다. 관제탑을 다시 켜면
                # 주문 기록은 사라지고 대기 중인 작업만 남는데, 그 뒤로는 상태가 바뀔 일이
                # 없어 아무도 발행을 부르지 않는다. 그러면 워커가 계속 물어봐도 내줄 것이
                # 없다고 답하고, 큐는 영원히 멈춘다. 내줄 것이 없으면 여기서 한 번 발행한다.
                self._dispatch_next_product_locked()
            return any(execution.status == "pending" for execution in self._executions.values())

    def owns(self, order_id: str) -> bool:
        with self._lock:
            return order_id in self._executions

    def _expire_stale_orders_locked(self) -> None:
        """워커가 받아가 놓고 잊어버린 주문을 회수한다.

        주문에는 만료가 없어서, 워커가 그 주문을 잊으면 관제탑은 그 작업을 '실행 중'
        으로 붙든 채 영원히 기다린다. 워커가 하나뿐이라 그 작업이 자리를 차지하는 동안
        뒤에 선 작업까지 전부 멈춘다. 일하는 중이면 주문 하트비트가 계속 오므로
        살아 있는 주문은 여기서 회수되지 않는다.
        """
        now = self._clock()
        recovered = False
        for execution in self._executions.values():
            if execution.status not in {"claimed", "acknowledged", "running"}:
                continue
            if not execution.last_seen or now - execution.last_seen <= self._order_timeout_seconds:
                continue
            execution.status = "superseded"
            order_id = str(execution.order.get("orderId") or "")
            for job in self._product_jobs.values():
                if job.current_order_id != order_id:
                    continue
                job.current_order_id = ""
                job.status = "queued"
                job.restore_only = job.checkpoint is not None
                job.message = "조립공장이 응답하지 않아 이 작업을 다시 대기열에 세웠습니다."
                recovered = True
                self._append_event(
                    "factory.product.updated",
                    {"job": self._public_product_job(job)},
                )
                break
        if recovered:
            self._persist_product_jobs_locked()
            self._dispatch_next_product_locked()
        self._rebind_pending_orders_locked()

    def _rebind_pending_orders_locked(self) -> None:
        """지금 붙어 있는 워커가 집을 수 있도록 대기 주문의 수신자를 맞춘다.

        주문이 옛 워커를 겨냥한 채 남으면 현재 워커는 그것을 건너뛰고, 관제탑은
        '실행 중' 으로 표시한 채 아무도 그 일을 하지 않는 상태가 된다.
        """
        current = self._factory_session
        if current is None:
            return
        for execution in self._executions.values():
            if execution.status != "pending":
                continue
            command = execution.order.get("command")
            if not isinstance(command, dict) or command.get("name") != PRODUCT_RUN_COMMAND:
                continue
            if str(execution.order.get("targetWorkerId") or "") == current.worker_id:
                continue
            execution.session_id = current.session_id
            execution.order["workerSessionId"] = current.session_id
            execution.order["targetWorkerId"] = current.worker_id
            execution.order["workerHttpSessionId"] = current.http_session_id

    def _note_worker_liveness_locked(self, session_id: str) -> None:
        """주문을 받고 처리하는 것도 워커가 살아 있다는 증거다.

        세션 하트비트만 세면, 오래 도는 단계 중 하트비트 한 번이 늦어지는 것만으로
        멀쩡히 일하던 워커의 세션이 만료되고 그 작업이 통째로 갇힌다.
        """
        current = self._factory_session
        if current is None or not session_id or current.session_id != session_id:
            return
        current.last_seen = self._clock()
        self._last_factory_session = current

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
            self._note_worker_liveness_locked(execution.session_id)
            execution.last_seen = self._clock()
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
                # 조립공장이 오래 도는 동안 주기 동기화가 작업파일 판을 먼저 올리면,
                # 실제로 만들어진 결과가 뒤늦게 더 낮은 판을 달고 도착한다.
                # 같은 작업이 만든 결과라면 버리지 않는다. 신원은 바로 아래에서 다시 확인한다.
                revision_race = error.code == "stale_workfile_revision"
                if error.code != "stale_event_sequence" and not revision_race:
                    raise
                if self._projection is None:
                    raise
                incoming_session = normalized.get("session")
                current_session = self._projection.get("session")
                if not isinstance(incoming_session, dict) or not isinstance(current_session, dict):
                    raise
                if revision_race:
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
            reported_stage = str(result.get("stageKey") or "").strip()
            if job.stage_started_at is not None:
                job.timing = _accumulate_timing(
                    job.timing,
                    reported_stage,
                    machine_ms=int((self._clock() - job.stage_started_at) * 1000),
                )
                job.stage_started_at = None
            job.waiting_since = (
                self._clock() if status in {"waiting_manual", "blocked"} else None
            )
            job.status = status
            job.stage_key = reported_stage
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
            # 작업파일을 다시 연 직후이므로, 예약해 둔 컷이 있으면 여기서 바로 내보낸다.
            applied_selection = self._flush_pending_selection_locked(normalized)
            payload = command.get("payload")
            if not isinstance(payload, dict) or payload.get("restoreOnly") is not True:
                self._dispatch_next_product_locked()
            elif applied_selection is None and job.pending_selection is not None:
                job.pending_selection = None
                job.auto_resume_pending = False
                job.message = "예약한 컷을 지금 후보에서 찾지 못했습니다. 직접 골라 주세요."
                self._persist_product_jobs_locked()
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
        if command["name"] == "registerFactoryCafe24":
            if result.get("schema") != "factory-cafe24-registration-receipt:v1":
                raise FactorySyncError("factory_cafe24_receipt_invalid")
            registered_job_id = _required_text(result, "jobId")
            registered_job = self._product_jobs.get(registered_job_id)
            if registered_job is None or registered_job.current_order_id != execution.order.get("orderId"):
                raise FactorySyncError("factory_product_job_not_found")
            registered_projection = result.get("projection")
            if not isinstance(registered_projection, dict):
                raise FactorySyncError("factory_projection_missing")
            registered_normalized = _validate_projection(registered_projection)
            self._projection = registered_normalized
            registered_checkpoint = result.get("checkpoint")
            if isinstance(registered_checkpoint, dict):
                registered_job.checkpoint = _validate_product_checkpoint_receipt(
                    registered_checkpoint,
                    registered_job_id,
                    registered_normalized,
                    "completed",
                    "cafe24",
                )
            product_no = str(result.get("productNo") or "").strip()
            registered_job.current_order_id = ""
            registered_job.status = "completed"
            registered_job.stage_key = "cafe24"
            registered_job.message = (
                f"Cafe24 등록 완료 · 상품번호 {product_no}"
                if product_no
                else "Cafe24 등록 완료"
            )
            self._persist_product_jobs_locked()
            self._append_event(
                "factory.product.updated",
                {"job": self._public_product_job(registered_job)},
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
        # 선택 결과를 작업 체크포인트에 반영하지 않으면 다음 실행이 선택 이전 상태를 복원해
        # 방금 고른 A컷이 사라지고 factory_decision_required 로 막힌다.
        raw_checkpoint = result.get("checkpoint")
        if isinstance(raw_checkpoint, dict):
            checkpoint_job_id = str(raw_checkpoint.get("jobId") or "").strip()
            checkpoint_job = self._product_jobs.get(checkpoint_job_id)
            if checkpoint_job is not None:
                checkpoint_job.checkpoint = _validate_product_checkpoint_receipt(
                    raw_checkpoint,
                    checkpoint_job_id,
                    normalized,
                    str(result.get("status") or "waiting_manual").strip(),
                    str(result.get("stageKey") or "").strip(),
                )
                self._persist_product_jobs_locked()
        self._append_event("factory.a_cut.selected", {"receipt": dict(result), "projection": normalized})
        self._resume_after_selection_locked(normalized)
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


def _stage_candidate_ids(stage: Mapping[str, JsonValue]) -> list[str]:
    raw = stage.get("candidates")
    ids: list[str] = []
    for candidate in raw if isinstance(raw, list) else []:
        if not isinstance(candidate, Mapping):
            continue
        identifier = str(
            candidate.get("id") or candidate.get("candidateId") or candidate.get("assetId") or ""
        ).strip()
        if identifier:
            ids.append(identifier)
    return ids


def _progress_has_candidate(
    progress: Mapping[str, JsonValue] | None,
    stage_key: str,
    candidate_id: str,
) -> bool:
    if not isinstance(progress, Mapping) or not stage_key or not candidate_id:
        return False
    stages = progress.get("stages")
    for stage in stages if isinstance(stages, list) else []:
        if isinstance(stage, Mapping) and str(stage.get("key") or "") == stage_key:
            return candidate_id in _stage_candidate_ids(stage)
    return False


def _projection_has_candidate(
    projection: Mapping[str, JsonValue],
    stage_key: str,
    candidate_id: str,
) -> bool:
    stages = projection.get("stages")
    for stage in stages if isinstance(stages, list) else []:
        if not isinstance(stage, Mapping):
            continue
        if str(stage.get("key") or stage.get("stageKey") or "") != stage_key:
            continue
        return candidate_id in _stage_candidate_ids(stage)
    return False


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


def _cafe24_values_from_job(payload: Mapping[str, JsonValue]) -> JsonObject:
    """투입할 때 지정해 둔 등록 대상 값을 꺼낸다."""
    source = payload.get("requiredValues")
    values = source if isinstance(source, Mapping) else {}
    mapped = {
        "categoryId": values.get("cafe24CategoryId"),
        "salePrice": values.get("salePrice"),
        "supplyPrice": values.get("supplyPrice"),
        "displayStatus": values.get("displayStatus"),
        "sellingStatus": values.get("sellingStatus"),
    }
    return {key: str(value).strip() for key, value in mapped.items() if str(value or "").strip()}


def _normalize_cafe24_registration_values(
    value: Mapping[str, JsonValue] | None,
) -> JsonObject:
    """등록 대상 값만 추려서 문자열로 맞춘다."""
    source = value if isinstance(value, Mapping) else {}
    unknown = set(source) - CAFE24_REGISTRATION_VALUE_KEYS
    if unknown:
        raise FactorySyncError("factory_cafe24_values_invalid")
    normalized: JsonObject = {}
    for key in CAFE24_REGISTRATION_VALUE_KEYS:
        raw = source.get(key)
        if raw is None:
            continue
        if not isinstance(raw, (str, int)) or isinstance(raw, bool):
            raise FactorySyncError("factory_cafe24_values_invalid")
        text = str(raw).strip()
        if text:
            normalized[key] = text
    return normalized


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
        or set(required_values) - PRODUCT_VALUE_KEYS
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
