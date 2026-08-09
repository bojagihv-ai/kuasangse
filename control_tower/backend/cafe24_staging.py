from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
import secrets
from threading import RLock
import time
from typing import Final, Literal, assert_never

from .canonical_json import canonical_json_digest
from .runtime_cache import JsonObject, JsonValue


class Cafe24StagingError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


SAFE_DEFAULTS: Final = {"selling": "F", "display": "F", "market_sync": "F"}
APPROVAL_BINDING_FIELDS: Final = (
    "payloadDigest",
    "productId",
    "productKey",
    "expectedWorkfileRevision",
    "expectedRunId",
    "expectedInputFingerprint",
    "idempotencyKey",
)


def _digest(value: JsonValue) -> str:
    return canonical_json_digest(value)


def build_preview(
    payload: Mapping[str, JsonValue],
    *,
    authority: Mapping[str, JsonValue] | None = None,
) -> JsonObject:
    required = ("batchId", "productId", "productKey", "categoryId", "htmlDigest", "imageDigests", "expectedWorkfileRevision", "expectedRunId", "expectedInputFingerprint")
    if any(not str(payload.get(key, "")).strip() for key in required[:-1]) or not isinstance(payload.get("imageDigests"), list):
        raise Cafe24StagingError("approval_target_required" if any(not str(payload.get(key, "")).strip() for key in ("productId", "productKey", "categoryId", "htmlDigest")) or not payload.get("imageDigests") else "approval_binding_required")
    if not isinstance(payload.get("expectedWorkfileRevision"), int) or payload["expectedWorkfileRevision"] < 0:
        raise Cafe24StagingError("approval_binding_required")
    if any(not isinstance(item, str) or not item.strip() for item in payload["imageDigests"]):
        raise Cafe24StagingError("staging_image_digest_invalid")
    settings = {key: payload.get(key, SAFE_DEFAULTS[key]) for key in SAFE_DEFAULTS}
    if settings != SAFE_DEFAULTS:
        raise Cafe24StagingError("unsafe_cafe24_defaults")
    canonical_source = _authority_checkpoint(payload, authority) if authority is not None else payload
    idempotency_value = payload.get("idempotencyKey")
    idempotency_key = str(idempotency_value).strip() if isinstance(idempotency_value, str) and idempotency_value.strip() else f"cafe24-stage:{payload['batchId']}:{canonical_source['productKey']}:{canonical_source['htmlDigest']}"
    canonical = {"batchId": payload["batchId"], "productId": canonical_source["productId"], "productKey": canonical_source["productKey"], "categoryId": payload["categoryId"], "htmlDigest": canonical_source["htmlDigest"], "imageDigests": canonical_source["imageDigests"], "expectedWorkfileRevision": canonical_source["expectedWorkfileRevision"], "expectedRunId": canonical_source["expectedRunId"], "expectedInputFingerprint": canonical_source["expectedInputFingerprint"], **SAFE_DEFAULTS}
    canonical["idempotencyKey"] = idempotency_key
    return {"payload": canonical, "payloadDigest": _digest(canonical), "idempotencyKey": idempotency_key, "approvalRequired": True, "externalWrite": False}


def _authority_checkpoint(
    payload: Mapping[str, JsonValue],
    authority: Mapping[str, JsonValue],
) -> JsonObject:
    if authority.get("schema") != "factory-cafe24-preflight:v1" or authority.get("status") != "ready":
        raise Cafe24StagingError("factory_cafe24_preflight_incomplete")
    exact_fields = (
        "productId",
        "productKey",
        "htmlDigest",
        "expectedWorkfileRevision",
        "expectedRunId",
        "expectedInputFingerprint",
    )
    for field in exact_fields:
        if payload.get(field) != authority.get(field):
            match field:
                case "productId":
                    raise Cafe24StagingError("factory_cafe24_target_mismatch")
                case "expectedWorkfileRevision":
                    raise Cafe24StagingError("stale_workfile_revision")
                case "htmlDigest":
                    raise Cafe24StagingError("stale_detail_html_digest")
                case "productKey" | "expectedRunId" | "expectedInputFingerprint":
                    raise Cafe24StagingError("stale_run_fingerprint")
                case unreachable:
                    assert_never(unreachable)
    expected_images = payload.get("imageDigests")
    authority_images = authority.get("imageDigests")
    if not isinstance(expected_images, list) or not isinstance(authority_images, list):
        raise Cafe24StagingError("staging_image_digest_invalid")
    if sorted(expected_images) != sorted(authority_images):
        raise Cafe24StagingError("stale_image_digest")
    return {field: authority[field] for field in (*exact_fields, "imageDigests")}


def verify_readback(preview: Mapping[str, JsonValue], readback: Mapping[str, JsonValue]) -> JsonObject:
    expected = str(preview.get("payloadDigest", ""))
    actual = str(readback.get("payloadDigest", ""))
    if not expected or not actual or expected != actual:
        raise Cafe24StagingError("cafe24_readback_digest_mismatch")
    remote_digest = readback.get("remoteReadbackDigest", actual)
    return {"status": "staged_verified", "payloadDigest": expected, "remoteReadbackDigest": remote_digest, "externalProductNo": readback.get("externalProductNo"), "idempotencyKey": preview.get("idempotencyKey")}


@dataclass(frozen=True, slots=True)
class _ApprovalRecord:
    request_id: str
    preview: JsonObject
    expires_at: float
    approved_token_digest: str | None = None
    state: Literal["issued", "approved", "reserved", "consumed", "rejected"] = "issued"


class Cafe24ApprovalGate:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic, ttl_seconds: float = 300.0) -> None:
        self._clock = clock
        self._ttl_seconds = ttl_seconds
        self._lock = RLock()
        self._requests: dict[str, _ApprovalRecord] = {}
        self._tokens: dict[str, str] = {}
        self._consumed_tokens: set[str] = set()

    def issue(self, preview: JsonObject) -> JsonObject:
        with self._lock:
            request_id = secrets.token_urlsafe(18)
            self._requests[request_id] = _ApprovalRecord(request_id, dict(preview), self._clock() + self._ttl_seconds)
        return {"approvalRequestId": request_id, "approvalTarget": _approval_target(preview), "approvalRequired": True}

    def approve(self, request_id: str, binding: Mapping[str, JsonValue]) -> JsonObject:
        with self._lock:
            record = self._record(request_id)
            _assert_binding(record.preview, binding)
            if record.approved_token_digest is not None:
                raise Cafe24StagingError("approval_already_issued")
            token = secrets.token_urlsafe(32)
            token_digest = _digest(token)
            self._tokens[token_digest] = request_id
            self._requests[request_id] = replace(record, approved_token_digest=token_digest, state="approved")
        return {"approvalRequestId": request_id, "approvalToken": token, "payloadDigest": record.preview["payloadDigest"], "idempotencyKey": record.preview["idempotencyKey"]}

    def reserve(self, token: str, binding: Mapping[str, JsonValue]) -> JsonObject:
        token_digest = _digest(token)
        with self._lock:
            record = self._token_record(token_digest)
            try:
                _assert_binding(record.preview, binding)
            except Cafe24StagingError:
                self._finish(token_digest, record, "rejected")
                raise
            self._requests[record.request_id] = replace(record, state="reserved")
            return {"approvalRequestId": record.request_id, "payload": record.preview["payload"], "payloadDigest": record.preview["payloadDigest"], "idempotencyKey": record.preview["idempotencyKey"], "approvalGrantDigest": token_digest}

    def commit(self, approval_grant_digest: str) -> None:
        with self._lock:
            record = self._token_record(approval_grant_digest, required_state="reserved")
            self._finish(approval_grant_digest, record, "consumed")

    def reject(self, approval_grant_digest: str) -> None:
        with self._lock:
            record = self._token_record(approval_grant_digest, required_state="reserved")
            self._finish(approval_grant_digest, record, "rejected")

    def consume(self, token: str, binding: Mapping[str, JsonValue]) -> JsonObject:
        grant = self.reserve(token, binding)
        self.commit(str(grant["approvalGrantDigest"]))
        return grant

    def _record(self, request_id: str) -> _ApprovalRecord:
        record = self._active_record(request_id)
        if record.state in {"reserved", "consumed", "rejected"}:
            raise Cafe24StagingError("approval_token_reused")
        return record

    def _active_record(self, request_id: str) -> _ApprovalRecord:
        record = self._requests.get(request_id)
        if record is None:
            raise Cafe24StagingError("approval_request_invalid")
        if record.expires_at <= self._clock():
            raise Cafe24StagingError("approval_request_stale")
        return record

    def _token_record(
        self,
        token_digest: str,
        *,
        required_state: Literal["approved", "reserved"] = "approved",
    ) -> _ApprovalRecord:
        if token_digest in self._consumed_tokens:
            raise Cafe24StagingError("approval_token_reused")
        request_id = self._tokens.get(token_digest)
        if request_id is None:
            raise Cafe24StagingError("approval_token_invalid")
        record = self._active_record(request_id)
        if record.approved_token_digest != token_digest:
            raise Cafe24StagingError("approval_token_invalid")
        if record.state != required_state:
            raise Cafe24StagingError("approval_token_reused")
        return record

    def _finish(
        self,
        token_digest: str,
        record: _ApprovalRecord,
        state: Literal["consumed", "rejected"],
    ) -> None:
        self._consumed_tokens.add(token_digest)
        self._requests[record.request_id] = replace(record, state=state)


def _approval_target(preview: Mapping[str, JsonValue]) -> JsonObject:
    payload = preview.get("payload")
    if not isinstance(payload, dict):
        raise Cafe24StagingError("staging_payload_invalid")
    target: JsonObject = {key: payload[key] for key in ("productId", "productKey", "categoryId", "htmlDigest", "imageDigests")}
    for key in ("payloadDigest", "idempotencyKey", "expectedWorkfileRevision", "expectedRunId", "expectedInputFingerprint"):
        target[key] = preview.get(key) if key in preview else payload.get(key)
    return target


def _assert_binding(preview: Mapping[str, JsonValue], binding: Mapping[str, JsonValue]) -> None:
    expected = {key: preview.get(key) if key in preview else _payload_value(preview, key) for key in APPROVAL_BINDING_FIELDS}
    for key, value in expected.items():
        if binding.get(key) != value:
            if key == "expectedWorkfileRevision":
                raise Cafe24StagingError("stale_approval")
            raise Cafe24StagingError("approval_binding_mismatch")


def _payload_value(preview: Mapping[str, JsonValue], key: str) -> JsonValue:
    payload = preview.get("payload")
    if not isinstance(payload, dict):
        raise Cafe24StagingError("staging_payload_invalid")
    return payload.get(key)
