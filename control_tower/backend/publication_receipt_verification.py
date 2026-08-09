from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Final

from .publication_receipt_binding import ReceiptRecoveryError, RecoveryBinding
from .runtime_cache import JsonObject, JsonValue

_ACTOR: Final = "production-control-tower"
_PUBLICATION_FIELDS: Final = (
    "target",
    "targetKey",
    "payloadDigest",
    "observedPayloadDigest",
    "remoteId",
    "idempotencyKey",
)
_CORRECTED_FIELDS: Final = _PUBLICATION_FIELDS[:-1]


def verified_terminal_receipt(
    binding: RecoveryBinding,
    receipt_response: Mapping[str, JsonValue],
    event_response: Mapping[str, JsonValue],
) -> JsonObject | None:
    receipt_id = receipt_response.get("receiptId")
    if (
        not isinstance(receipt_id, str)
        or receipt_response.get("jobId") != binding.job_id
        or event_response.get("jobId") != binding.job_id
    ):
        raise ReceiptRecoveryError("publication_receipt_mismatch")
    _assert_publication_identity(receipt_response, binding)
    if receipt_response.get("actor") != _ACTOR:
        raise ReceiptRecoveryError("publication_receipt_mismatch")
    corrected = receipt_response.get("proofState") == "CORRECTED"
    correction_id = receipt_response.get("correctionId")
    if corrected and (
        not isinstance(correction_id, str)
        or not correction_id
        or receipt_response.get("supersedesReceiptId") != receipt_id
    ):
        raise ReceiptRecoveryError("publication_receipt_mismatch")
    events = event_response.get("events")
    if not isinstance(events, list):
        return None
    expected_event_type = (
        "PUBLICATION_RECEIPT_CORRECTED" if corrected else "PUBLICATION_RECEIPT"
    )
    for event in events:
        if not isinstance(event, dict) or event.get("eventType") != expected_event_type:
            continue
        payload = _event_payload(event)
        if payload is None or payload.get("receiptId") != receipt_id:
            continue
        if corrected:
            _assert_corrected_linkage(event, payload, correction_id)
            _assert_corrected_identity(payload, binding)
        else:
            _assert_publication_identity(payload, binding)
        return {
            **binding.terminal_receipt,
            "receiptId": receipt_id,
            "replayed": receipt_response.get("replayed") is True,
            "eventId": event.get("id"),
            "eventType": event["eventType"],
            "occurredAt": event.get("occurredAt"),
        }
    return None


def _event_payload(event: Mapping[str, JsonValue]) -> JsonObject | None:
    raw_payload = event.get("payload")
    if not isinstance(raw_payload, str):
        return None
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _assert_corrected_linkage(
    event: Mapping[str, JsonValue],
    payload: Mapping[str, JsonValue],
    correction_id: JsonValue,
) -> None:
    command_key = payload.get("idempotencyKey")
    if (
        event.get("actor") != _ACTOR
        or payload.get("correctionId") != correction_id
        or not isinstance(command_key, str)
        or not command_key.strip()
    ):
        raise ReceiptRecoveryError("publication_receipt_mismatch")


def _assert_corrected_identity(
    payload: Mapping[str, JsonValue],
    binding: RecoveryBinding,
) -> None:
    for field in _CORRECTED_FIELDS:
        if payload.get(field) != binding.publication_payload[field]:
            raise ReceiptRecoveryError("publication_receipt_mismatch")
    if (
        "publicationIdempotencyKey" in payload
        and payload.get("publicationIdempotencyKey")
        != binding.publication_idempotency_key
    ):
        raise ReceiptRecoveryError("publication_receipt_mismatch")


def _assert_publication_identity(
    candidate: Mapping[str, JsonValue],
    binding: RecoveryBinding,
) -> None:
    for field in _PUBLICATION_FIELDS:
        if candidate.get(field) != binding.publication_payload[field]:
            raise ReceiptRecoveryError("publication_receipt_mismatch")
