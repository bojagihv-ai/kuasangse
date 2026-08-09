from __future__ import annotations

import json
from pathlib import Path

import pytest

from control_tower.backend.canonical_json import canonical_json_digest
from control_tower.backend.runtime_cache import JsonObject
from control_tower.tests.backend.publication_recovery_fixtures import ReceiptApi
from control_tower.tests.backend.publication_recovery_fixtures import (
    client as make_client,
)
from control_tower.tests.backend.publication_recovery_fixtures import (
    receipt as make_receipt,
)

_ACTOR = "production-control-tower"
_COMMAND_KEY = "production-repair-20260731-0007-5f178170"


def _corrected_receipt(request_body: JsonObject) -> JsonObject:
    factory_receipt = request_body["factoryReceipt"]
    identity = {
        "schema": "pdp-publication-receipt-identity:v1",
        "jobId": request_body["jobId"],
        "target": "cafe24",
        "targetKey": factory_receipt["productId"],
        "payloadDigest": factory_receipt["payloadDigest"],
        "observedPayloadDigest": factory_receipt["remoteReadbackDigest"],
        "remoteId": factory_receipt["remoteProductNo"],
    }
    return {
        "jobId": request_body["jobId"],
        "receiptId": "receipt-001",
        "target": identity["target"],
        "targetKey": identity["targetKey"],
        "payloadDigest": identity["payloadDigest"],
        "observedPayloadDigest": identity["observedPayloadDigest"],
        "remoteId": identity["remoteId"],
        "idempotencyKey": (
            "pdp-publication-receipt:v1:" + canonical_json_digest(identity)
        ),
        "actor": _ACTOR,
        "proofState": "CORRECTED",
        "correctionId": "correction-001",
        "supersedesReceiptId": "receipt-001",
    }


def _corrected_events(existing: JsonObject) -> JsonObject:
    corrected_payload = {
        key: existing[key]
        for key in (
            "receiptId",
            "target",
            "targetKey",
            "payloadDigest",
            "observedPayloadDigest",
            "remoteId",
            "correctionId",
        )
    }
    corrected_payload["idempotencyKey"] = _COMMAND_KEY
    return {
        "jobId": existing["jobId"],
        "events": [
            {
                "eventType": "PUBLICATION_RECEIPT",
                "actor": _ACTOR,
                "payload": json.dumps(
                    {
                        "receiptId": existing["receiptId"],
                        "payloadDigest": existing["payloadDigest"],
                        "observedPayloadDigest": "0" * 64,
                    },
                    separators=(",", ":"),
                ),
            },
            {
                "eventType": "PUBLICATION_RECEIPT_CORRECTED",
                "actor": _ACTOR,
                "payload": json.dumps(corrected_payload, separators=(",", ":")),
            },
        ],
    }


def test_get_hit_accepts_corrected_canonical_proof_with_staging_key_preserved(
    tmp_path: Path,
) -> None:
    request_body = make_receipt()
    existing = _corrected_receipt(request_body)
    events = _corrected_events(existing)
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 200
    assert response.get_json()["status"] == "staged_verified"
    assert api.lookup_calls == [(request_body["jobId"], existing["idempotencyKey"])]
    assert (
        existing["idempotencyKey"] != request_body["factoryReceipt"]["idempotencyKey"]
    )
    assert api.calls == []
    assert state.registration["status"] == "staged_verified"
    assert bridge.calls == 0


@pytest.mark.parametrize("actor", [None, "another-actor"])
def test_get_hit_rejects_missing_or_wrong_lookup_actor(
    tmp_path: Path,
    actor: str | None,
) -> None:
    request_body = make_receipt()
    existing = _corrected_receipt(request_body)
    if actor is None:
        existing.pop("actor")
    else:
        existing["actor"] = actor
    api = ReceiptApi(lookup=existing, events=_corrected_events(existing))
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "publication_receipt_mismatch"
    assert response.get_json()["error"]["retryable"] is False
    assert api.calls == []
    assert state.receipt_updates == []
    assert bridge.calls == 0


@pytest.mark.parametrize("actor", [None, "another-actor"])
def test_get_hit_rejects_missing_or_wrong_corrected_event_actor(
    tmp_path: Path,
    actor: str | None,
) -> None:
    request_body = make_receipt()
    existing = _corrected_receipt(request_body)
    events = _corrected_events(existing)
    corrected_event = events["events"][1]
    if actor is None:
        corrected_event.pop("actor")
    else:
        corrected_event["actor"] = actor
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["retryable"] is False
    assert api.calls == []
    assert state.receipt_updates == []
    assert bridge.calls == 0


def test_get_hit_rejects_missing_corrected_event_command_idempotency_key(
    tmp_path: Path,
) -> None:
    request_body = make_receipt()
    existing = _corrected_receipt(request_body)
    events = _corrected_events(existing)
    payload = json.loads(events["events"][1]["payload"])
    payload.pop("idempotencyKey")
    events["events"][1]["payload"] = json.dumps(payload, separators=(",", ":"))
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["retryable"] is False
    assert api.calls == []
    assert state.receipt_updates == []
    assert bridge.calls == 0


def test_get_hit_rejects_wrong_present_publication_idempotency_key(
    tmp_path: Path,
) -> None:
    request_body = make_receipt()
    existing = _corrected_receipt(request_body)
    events = _corrected_events(existing)
    payload = json.loads(events["events"][1]["payload"])
    payload["publicationIdempotencyKey"] = "pdp-publication-receipt:v1:wrong"
    events["events"][1]["payload"] = json.dumps(payload, separators=(",", ":"))
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["retryable"] is False
    assert api.calls == []
    assert state.receipt_updates == []
    assert bridge.calls == 0


def test_corrected_proof_cannot_terminate_with_old_receipt_event(
    tmp_path: Path,
) -> None:
    request_body = make_receipt()
    existing = _corrected_receipt(request_body)
    events = _corrected_events(existing)
    events["events"] = [events["events"][0]]
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "receipt_readback_pending"
    assert api.calls == []
    assert state.receipt_updates == []
    assert bridge.calls == 0
