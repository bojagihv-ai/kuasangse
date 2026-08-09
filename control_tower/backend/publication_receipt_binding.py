from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, assert_never

from .cafe24_staging import SAFE_DEFAULTS, Cafe24StagingError, build_preview
from .canonical_json import canonical_json_digest
from .readback_canonical import (
    ReadbackProjectionError,
    canonical_readback_digest,
    normalize_readback_projection,
)
from .runtime_cache import JsonObject, JsonValue

RECEIPT_SCHEMA: Final = "factory-cafe24-publication-receipt:v1"
TERMINAL_SCHEMA: Final = "factory-cafe24-terminal-publication-receipt:v1"
PUBLICATION_IDENTITY_SCHEMA: Final = "pdp-publication-receipt-identity:v1"
PUBLICATION_KEY_PREFIX: Final = "pdp-publication-receipt:v1:"
_SHA256: Final = re.compile(r"^[a-f0-9]{64}$")
_IDENTITY_FIELDS: Final = (
    "productId",
    "productKey",
    "expectedWorkfileRevision",
    "expectedRunId",
    "expectedInputFingerprint",
)
_FORBIDDEN_FIELDS: Final = {"approvalgrantdigest"}


class ReceiptRecoveryError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class RecoveryBinding:
    job_id: str
    fingerprint: str
    staging_idempotency_key: str
    publication_idempotency_key: str
    publication_payload: JsonObject
    terminal_receipt: JsonObject


def _forbidden_field(key: str) -> bool:
    normalized = key.casefold().replace("_", "").replace("-", "")
    return (
        normalized in _FORBIDDEN_FIELDS
        or "authorization" in normalized
        or normalized.endswith(("token", "secret", "apikey"))
    )


def _contains_forbidden(value: JsonValue) -> bool:
    match value:
        case dict() as mapping:
            return any(
                _forbidden_field(key) or _contains_forbidden(child)
                for key, child in mapping.items()
            )
        case list() as values:
            return any(_contains_forbidden(child) for child in values)
        case str() | int() | float() | bool() | None:
            return False
        case unreachable:
            assert_never(unreachable)


def _mapping(mapping: Mapping[str, JsonValue], key: str) -> JsonObject:
    value = mapping.get(key)
    if not isinstance(value, dict):
        raise ReceiptRecoveryError("factory_receipt_invalid")
    return value


def _text(mapping: Mapping[str, JsonValue], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ReceiptRecoveryError("factory_receipt_invalid")
    return value.strip()


def _assert_current_identity(
    receipt: Mapping[str, JsonValue],
    state: Mapping[str, JsonValue],
) -> None:
    session = _mapping(state, "session")
    if receipt.get("productId") != session.get("productId"):
        raise ReceiptRecoveryError("factory_receipt_target_mismatch")
    if receipt.get("expectedWorkfileRevision") != session.get("revision"):
        raise ReceiptRecoveryError("stale_workfile_revision")
    for receipt_key, state_key in (
        ("productKey", "productKey"),
        ("expectedRunId", "runId"),
        ("expectedInputFingerprint", "inputFingerprint"),
    ):
        if receipt.get(receipt_key) != session.get(state_key):
            raise ReceiptRecoveryError("stale_run_fingerprint")
    registration = state.get("registration")
    if isinstance(registration, dict):
        current_key = registration.get("idempotencyKey")
        if current_key and receipt.get("idempotencyKey") != current_key:
            raise ReceiptRecoveryError("stale_run_fingerprint")


def parse_recovery(
    raw: JsonObject,
    factory_state: Mapping[str, JsonValue],
) -> RecoveryBinding:
    if _contains_forbidden(raw):
        raise ReceiptRecoveryError("factory_receipt_secret_forbidden")
    job_id = _text(raw, "jobId")
    receipt = _mapping(raw, "factoryReceipt")
    if (
        receipt.get("schema") != RECEIPT_SCHEMA
        or receipt.get("status") != "staged_verified"
        or receipt.get("registrationMode") != "update"
        or receipt.get("jobId") != job_id
    ):
        raise ReceiptRecoveryError("factory_receipt_invalid")
    _assert_current_identity(receipt, factory_state)
    try:
        preview = build_preview(_mapping(receipt, "payload"))
    except Cafe24StagingError as error:
        raise ReceiptRecoveryError("factory_receipt_tampered") from error
    for field in _IDENTITY_FIELDS:
        if receipt.get(field) != preview["payload"].get(field):
            raise ReceiptRecoveryError("factory_receipt_tampered")
    payload_digest = _text(receipt, "payloadDigest").casefold()
    staging_idempotency_key = _text(receipt, "idempotencyKey")
    remote_digest = _text(receipt, "remoteReadbackDigest").casefold()
    if (
        _SHA256.fullmatch(payload_digest) is None
        or _SHA256.fullmatch(remote_digest) is None
        or payload_digest != preview.get("payloadDigest")
        or staging_idempotency_key != preview.get("idempotencyKey")
    ):
        raise ReceiptRecoveryError("factory_receipt_tampered")
    product_id = _text(receipt, "productId")
    remote_product_no = _text(receipt, "remoteProductNo")
    if (
        not product_id.startswith("cafe24:")
        or product_id.removeprefix("cafe24:") != remote_product_no
    ):
        raise ReceiptRecoveryError("factory_receipt_target_mismatch")
    try:
        readback = normalize_readback_projection(_mapping(receipt, "remoteReadback"))
        computed_remote_digest = canonical_readback_digest(readback)
    except ReadbackProjectionError as error:
        raise ReceiptRecoveryError("factory_receipt_tampered") from error
    if (
        computed_remote_digest != remote_digest
        or readback["productNo"] != int(remote_product_no)
        or readback["productName"] != receipt.get("productKey")
        or {
            key: readback[{"market_sync": "marketSync"}.get(key, key)]
            for key in SAFE_DEFAULTS
        }
        != SAFE_DEFAULTS
    ):
        raise ReceiptRecoveryError("factory_receipt_tampered")
    publication_identity: JsonObject = {
        "schema": PUBLICATION_IDENTITY_SCHEMA,
        "jobId": job_id,
        "target": "cafe24",
        "targetKey": product_id,
        "payloadDigest": payload_digest,
        "remoteId": remote_product_no,
        "observedPayloadDigest": remote_digest,
    }
    publication_idempotency_key = PUBLICATION_KEY_PREFIX + canonical_json_digest(
        publication_identity
    )
    publication_payload: JsonObject = {
        key: value
        for key, value in publication_identity.items()
        if key not in {"schema", "jobId"}
    }
    publication_payload.update(
        {
            "idempotencyKey": publication_idempotency_key,
            "actor": "production-control-tower",
        },
    )
    terminal_receipt: JsonObject = {
        "schema": TERMINAL_SCHEMA,
        "status": "staged_verified",
        "registrationMode": "update",
        "jobId": job_id,
        "productId": product_id,
        "productKey": receipt["productKey"],
        "remoteProductNo": remote_product_no,
        "payloadDigest": payload_digest,
        "idempotencyKey": staging_idempotency_key,
        "stagingIdempotencyKey": staging_idempotency_key,
        "publicationIdempotencyKey": publication_idempotency_key,
        "remoteReadbackDigest": remote_digest,
        "expectedWorkfileRevision": receipt["expectedWorkfileRevision"],
        "expectedRunId": receipt["expectedRunId"],
        "expectedInputFingerprint": receipt["expectedInputFingerprint"],
        "safeDefaults": dict(SAFE_DEFAULTS),
    }
    return RecoveryBinding(
        job_id=job_id,
        fingerprint=canonical_json_digest(receipt),
        staging_idempotency_key=staging_idempotency_key,
        publication_idempotency_key=publication_idempotency_key,
        publication_payload=publication_payload,
        terminal_receipt=terminal_receipt,
    )
