from __future__ import annotations

import json
from pathlib import Path

import pytest

from control_tower.backend.app import create_app
from control_tower.backend.cafe24_staging import SAFE_DEFAULTS
from control_tower.backend.canonical_json import canonical_json_digest
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.readback_canonical import canonical_readback_digest
from control_tower.backend.runtime_cache import JsonObject
from control_tower.tests.backend.publication_recovery_fixtures import (
    FactoryState,
    ReceiptApi,
    SuccessfulCafe24Bridge,
    client as make_client,
    publication_events as make_publication_events,
    receipt as make_receipt,
)


def _expected_publication_payload(request_body: JsonObject) -> JsonObject:
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
        "target": identity["target"],
        "targetKey": identity["targetKey"],
        "payloadDigest": identity["payloadDigest"],
        "remoteId": identity["remoteId"],
        "observedPayloadDigest": identity["observedPayloadDigest"],
        "idempotencyKey": (
            "pdp-publication-receipt:v1:" + canonical_json_digest(identity)
        ),
        "actor": "production-control-tower",
    }


def _receipt_response(request_body: JsonObject) -> JsonObject:
    return {
        "jobId": request_body["jobId"],
        "receiptId": "receipt-001",
        **_expected_publication_payload(request_body),
        "replayed": True,
    }


def test_receipt_only_recovery_classifies_upstream_contract_422_without_503(tmp_path: Path) -> None:
    api = ReceiptApi(PdpHttpError("pdp_request_invalid", 422))
    test_client, headers, bridge, state = make_client(tmp_path, api)

    response = test_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=make_receipt(),
        headers=headers,
    )

    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "receipt_payload_rejected"
    assert bridge.calls == 0
    assert state.registration["publicationReceipt"] is None


def test_legacy_publish_collapses_upstream_receipt_422_to_503(tmp_path: Path) -> None:
    api = ReceiptApi(PdpHttpError("pdp_request_invalid", 422))
    bridge = SuccessfulCafe24Bridge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    payload = make_receipt()["factoryReceipt"]["payload"]
    preview = client.post("/api/cafe24/staging-preview", json=payload, headers=headers).get_json()
    binding = {
        key: preview[key] if key in preview else preview["payload"][key]
        for key in (
            "payloadDigest",
            "productId",
            "productKey",
            "expectedWorkfileRevision",
            "expectedRunId",
            "expectedInputFingerprint",
            "idempotencyKey",
        )
    }
    approved = client.post(
        "/api/cafe24/approve",
        json={
            "approvalRequestId": preview["approvalRequestId"],
            "approved": True,
            **binding,
        },
        headers=headers,
    ).get_json()
    confirmed = client.post(
        "/api/cafe24/confirm",
        json={"approvalToken": approved["approvalToken"], "confirmed": True, **binding},
        headers=headers,
    ).get_json()

    response = client.post(
        "/api/cafe24/publish",
        json={
            "jobId": "job-2994",
            "approvalToken": approved["approvalToken"],
            "confirmationNonce": confirmed["confirmationNonce"],
            **binding,
        },
        headers=headers,
    )

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "blocked_external"
    assert bridge.calls == 1


def test_receipt_only_recovery_is_idempotent_after_post_and_get_binding(tmp_path: Path) -> None:
    request_body = make_receipt()
    api = ReceiptApi(auto_events=True)
    client, headers, bridge, state = make_client(tmp_path, api)

    first = client.post("/api/cafe24/publication-receipts/recover", json=request_body, headers=headers)
    replay = client.post("/api/cafe24/publication-receipts/recover", json=request_body, headers=headers)

    assert first.status_code == 200
    assert first.get_json()["status"] == "staged_verified"
    assert replay.status_code == 200
    assert replay.get_json()["replayed"] is True
    assert len(api.calls) == 1
    assert len(api.lookup_calls) == 1
    assert api.event_calls == ["job-2994"]
    posted = api.calls[0][1]
    assert set(posted) == {
        "target",
        "targetKey",
        "payloadDigest",
        "remoteId",
        "observedPayloadDigest",
        "idempotencyKey",
        "actor",
    }
    assert posted["remoteId"] == "2994"
    assert posted["observedPayloadDigest"] == request_body["factoryReceipt"]["remoteReadbackDigest"]
    assert posted["idempotencyKey"] == _expected_publication_payload(request_body)["idempotencyKey"]
    assert posted["idempotencyKey"].startswith("pdp-publication-receipt:v1:")
    assert len(posted["idempotencyKey"]) <= 200
    assert posted["idempotencyKey"] != request_body["factoryReceipt"]["idempotencyKey"]
    assert state.registration["status"] == "staged_verified"
    terminal = state.registration["publicationReceipt"]
    assert terminal["remoteProductNo"] == "2994"
    assert terminal["expectedWorkfileRevision"] == 109
    assert terminal["expectedRunId"] == "run-2994"
    assert terminal["expectedInputFingerprint"] == "fingerprint-2994"
    assert terminal["stagingIdempotencyKey"] == request_body["factoryReceipt"]["idempotencyKey"]
    assert terminal["publicationIdempotencyKey"] == posted["idempotencyKey"]
    assert terminal["idempotencyKey"] == terminal["stagingIdempotencyKey"]
    assert terminal["safeDefaults"] == SAFE_DEFAULTS
    assert state.approval_calls == 0
    assert state.worker_calls == 0
    assert bridge.calls == 0


def test_publication_key_is_deterministic_domain_separated_and_identity_bound(
    tmp_path: Path,
) -> None:
    original = make_receipt()
    same = make_receipt()
    changed = make_receipt()
    changed["jobId"] = "job-2994-replacement"
    changed["factoryReceipt"]["jobId"] = "job-2994-replacement"

    first_api = ReceiptApi(auto_events=True)
    first_client, first_headers, _, _ = make_client(tmp_path / "first", first_api)
    same_api = ReceiptApi(auto_events=True)
    same_client, same_headers, _, _ = make_client(tmp_path / "same", same_api)
    changed_api = ReceiptApi(auto_events=True)
    changed_client, changed_headers, _, _ = make_client(tmp_path / "changed", changed_api)

    first = first_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=original,
        headers=first_headers,
    )
    replay = same_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=same,
        headers=same_headers,
    )
    replacement = changed_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=changed,
        headers=changed_headers,
    )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replacement.status_code == 200
    first_key = first_api.calls[0][1]["idempotencyKey"]
    assert same_api.calls[0][1]["idempotencyKey"] == first_key
    assert changed_api.calls[0][1]["idempotencyKey"] != first_key
    assert first_key == _expected_publication_payload(original)["idempotencyKey"]


def test_get_hit_avoids_post_and_proceeds_to_event_verification(tmp_path: Path) -> None:
    request_body = make_receipt()
    existing = _receipt_response(request_body)
    api = ReceiptApi(lookup=existing, auto_events=True)
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 200
    assert api.lookup_calls == [
        (request_body["jobId"], existing["idempotencyKey"]),
    ]
    assert api.calls == []
    assert api.event_calls == [request_body["jobId"]]
    assert state.registration["publicationReceipt"]["receiptId"] == "receipt-001"
    assert bridge.calls == 0


def test_get_404_allows_exactly_one_fake_post(tmp_path: Path) -> None:
    request_body = make_receipt()
    api = ReceiptApi(auto_events=True)
    client, headers, _, _ = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 200
    assert api.lookup_calls == [
        (request_body["jobId"], _expected_publication_payload(request_body)["idempotencyKey"]),
    ]
    assert len(api.calls) == 1


def test_get_5xx_blocks_without_post(tmp_path: Path) -> None:
    api = ReceiptApi(lookup=PdpHttpError("pdp_unavailable", 503))
    client, headers, bridge, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=make_receipt(),
        headers=headers,
    )

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "blocked_external"
    assert api.calls == []
    assert api.event_calls == []
    assert state.registration["publicationReceipt"] is None
    assert bridge.calls == 0


@pytest.mark.parametrize(
    ("upstream_error", "status", "code"),
    [
        (PdpHttpError("receipt_lookup_conflict", 409), 409, "receipt_lookup_conflict"),
        (PdpHttpError("receipt_lookup_invalid", 422), 422, "receipt_lookup_invalid"),
    ],
)
def test_get_contract_error_is_preserved_without_post(
    tmp_path: Path,
    upstream_error: PdpHttpError,
    status: int,
    code: str,
) -> None:
    api = ReceiptApi(lookup=upstream_error)
    client, headers, _, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=make_receipt(),
        headers=headers,
    )

    assert response.status_code == status
    assert response.get_json()["error"]["code"] == code
    assert api.calls == []
    assert state.registration["publicationReceipt"] is None


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("target", "other"),
        ("targetKey", "cafe24:9999"),
        ("payloadDigest", "0" * 64),
        ("observedPayloadDigest", "1" * 64),
        ("remoteId", "9999"),
        ("idempotencyKey", "pdp-publication-receipt:v1:" + "2" * 64),
    ],
)
def test_get_receipt_identity_mismatch_is_rejected_without_post(
    tmp_path: Path,
    field: str,
    replacement: str,
) -> None:
    request_body = make_receipt()
    existing = _receipt_response(request_body)
    existing[field] = replacement
    api = ReceiptApi(lookup=existing, auto_events=True)
    client, headers, _, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "publication_receipt_mismatch"
    assert api.calls == []
    assert api.event_calls == [request_body["jobId"]]
    assert state.registration["publicationReceipt"] is None


@pytest.mark.parametrize(
    "field",
    [
        "target",
        "targetKey",
        "payloadDigest",
        "observedPayloadDigest",
        "remoteId",
        "idempotencyKey",
    ],
)
def test_get_receipt_missing_immutable_identity_is_rejected_without_terminal(
    tmp_path: Path,
    field: str,
) -> None:
    request_body = make_receipt()
    valid_receipt = _receipt_response(request_body)
    events = make_publication_events(valid_receipt)
    incomplete_receipt = dict(valid_receipt)
    incomplete_receipt.pop(field)
    api = ReceiptApi(lookup=incomplete_receipt, events=events)
    client, headers, _, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "publication_receipt_mismatch"
    assert api.calls == []
    assert state.registration["publicationReceipt"] is None


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("target", "other"),
        ("targetKey", "cafe24:9999"),
        ("payloadDigest", "0" * 64),
        ("observedPayloadDigest", "1" * 64),
        ("remoteId", "9999"),
        ("idempotencyKey", "pdp-publication-receipt:v1:" + "2" * 64),
    ],
)
def test_publication_event_identity_mismatch_is_rejected(
    tmp_path: Path,
    field: str,
    replacement: str,
) -> None:
    request_body = make_receipt()
    existing = _receipt_response(request_body)
    events = make_publication_events(existing)
    payload = json.loads(events["events"][0]["payload"])
    payload[field] = replacement
    events["events"][0]["payload"] = json.dumps(payload, separators=(",", ":"))
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, _, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "publication_receipt_mismatch"
    assert api.calls == []
    assert state.registration["publicationReceipt"] is None


@pytest.mark.parametrize(
    "field",
    [
        "target",
        "targetKey",
        "payloadDigest",
        "observedPayloadDigest",
        "remoteId",
        "idempotencyKey",
    ],
)
def test_publication_event_missing_immutable_identity_is_rejected_without_terminal(
    tmp_path: Path,
    field: str,
) -> None:
    request_body = make_receipt()
    existing = _receipt_response(request_body)
    events = make_publication_events(existing)
    payload = json.loads(events["events"][0]["payload"])
    payload.pop(field)
    events["events"][0]["payload"] = json.dumps(payload, separators=(",", ":"))
    api = ReceiptApi(lookup=existing, events=events)
    client, headers, _, state = make_client(tmp_path, api)

    response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=headers,
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "publication_receipt_mismatch"
    assert api.calls == []
    assert state.registration["publicationReceipt"] is None


def test_restart_uses_get_receipt_and_never_reposts_pending_identity(tmp_path: Path) -> None:
    request_body = make_receipt()
    api = ReceiptApi()
    first_client, first_headers, _, _ = make_client(tmp_path / "first", api)

    pending = first_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=first_headers,
    )
    assert pending.status_code == 503
    assert len(api.calls) == 1
    assert api.last_receipt is not None

    api.lookup = api.last_receipt
    api.auto_events = True
    restarted_client, restarted_headers, _, restarted_state = make_client(
        tmp_path / "restarted",
        api,
    )
    recovered = restarted_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=request_body,
        headers=restarted_headers,
    )

    assert recovered.status_code == 200
    assert len(api.calls) == 1
    assert len(api.lookup_calls) == 2
    assert restarted_state.registration["publicationReceipt"]["receiptId"] == "receipt-001"


def test_receipt_only_recovery_503_or_unmatched_event_keeps_factory_blocked(tmp_path: Path) -> None:
    failed_api = ReceiptApi(PdpHttpError("pdp_unavailable", 503))
    failed_client, headers, bridge, failed_state = make_client(tmp_path, failed_api)

    failed = failed_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=make_receipt(),
        headers=headers,
    )

    assert failed.status_code == 503
    assert failed.get_json()["error"]["code"] == "blocked_external"
    assert failed_state.registration["status"] == "blocked"
    assert failed_state.registration["publicationReceipt"] is None
    assert failed_api.event_calls == []
    assert bridge.calls == 0

    unmatched_api = ReceiptApi(events={"jobId": "job-2994", "events": []})
    unmatched_client, unmatched_headers, unmatched_bridge, unmatched_state = make_client(
        tmp_path,
        unmatched_api,
    )
    unmatched = unmatched_client.post(
        "/api/cafe24/publication-receipts/recover",
        json=make_receipt(),
        headers=unmatched_headers,
    )

    assert unmatched.status_code == 503
    assert unmatched.get_json()["error"]["code"] == "receipt_readback_pending"
    assert unmatched_state.registration["status"] == "blocked"
    assert unmatched_state.registration["publicationReceipt"] is None
    assert unmatched_bridge.calls == 0


def test_pending_receipt_rejects_same_idempotency_key_with_changed_readback(
    tmp_path: Path,
) -> None:
    api = ReceiptApi(events={"jobId": "job-2994", "events": []})
    client, headers, bridge, state = make_client(tmp_path, api)
    original = make_receipt()
    changed = make_receipt()
    readback = changed["factoryReceipt"]["remoteReadback"]
    readback["updatedAt"] = "2026-07-30T23:09:00+09:00"
    changed["factoryReceipt"]["remoteReadbackDigest"] = canonical_readback_digest(readback)

    first = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=original,
        headers=headers,
    )
    conflict = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=changed,
        headers=headers,
    )

    assert first.status_code == 503
    assert conflict.status_code == 409
    assert conflict.get_json()["error"]["code"] == "idempotency_conflict"
    assert len(api.calls) == 1
    assert state.registration["status"] == "blocked"
    assert state.registration["publicationReceipt"] is None
    assert bridge.calls == 0


def test_receipt_only_recovery_rejects_stale_and_tampered_receipts(tmp_path: Path) -> None:
    api = ReceiptApi()
    client, headers, bridge, state = make_client(tmp_path, api)
    tampered = make_receipt()
    tampered["factoryReceipt"]["remoteReadbackDigest"] = "tampered"
    stale = make_receipt()
    stale["factoryReceipt"]["expectedWorkfileRevision"] = 108

    tampered_response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=tampered,
        headers=headers,
    )
    stale_response = client.post(
        "/api/cafe24/publication-receipts/recover",
        json=stale,
        headers=headers,
    )

    assert tampered_response.status_code == 409
    assert tampered_response.get_json()["error"]["code"] == "factory_receipt_tampered"
    assert stale_response.status_code == 409
    assert stale_response.get_json()["error"]["code"] == "stale_workfile_revision"
    assert api.calls == []
    assert state.receipt_updates == []
    assert bridge.calls == 0
