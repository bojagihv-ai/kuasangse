from __future__ import annotations

import json
from pathlib import Path

from flask.testing import FlaskClient

from control_tower.backend.app import create_app
from control_tower.backend.cafe24_staging import SAFE_DEFAULTS, build_preview
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.readback_canonical import canonical_readback_digest
from control_tower.backend.runtime_cache import JsonObject


class ReceiptApi:
    def __init__(
        self,
        failure: PdpHttpError | None = None,
        *,
        events: JsonObject | None = None,
        lookup: JsonObject | PdpHttpError | None = None,
        auto_events: bool = False,
    ) -> None:
        self.calls: list[tuple[str, JsonObject]] = []
        self.lookup_calls: list[tuple[str, str]] = []
        self.event_calls: list[str] = []
        self.failure = failure
        self.events = events or {"jobId": "job-2994", "events": []}
        self.lookup = lookup
        self.auto_events = auto_events
        self.last_receipt: JsonObject | None = None

    def get_publication_receipt(self, job_id: str, idempotency_key: str) -> JsonObject:
        self.lookup_calls.append((job_id, idempotency_key))
        if isinstance(self.lookup, PdpHttpError):
            raise self.lookup
        if self.lookup is None:
            raise PdpHttpError("publication_receipt_not_found", 404)
        return self.lookup

    def create_publication_receipt(self, job_id: str, payload: JsonObject) -> JsonObject:
        self.calls.append((job_id, payload))
        if self.failure is not None:
            raise self.failure
        self.last_receipt = {
            "jobId": job_id,
            "receiptId": "receipt-001",
            **payload,
            "replayed": False,
        }
        return self.last_receipt

    def get_publication_events(self, job_id: str) -> JsonObject:
        self.event_calls.append(job_id)
        if self.auto_events and self.last_receipt is not None:
            return publication_events(self.last_receipt)
        if self.auto_events and isinstance(self.lookup, dict):
            return publication_events(self.lookup)
        return self.events


class ForbiddenCafe24Bridge:
    def __init__(self) -> None:
        self.calls = 0

    def inspect(self) -> JsonObject:
        self.calls += 1
        raise AssertionError("receipt-only recovery must not inspect Cafe24")

    def execute(self, command: JsonObject) -> JsonObject:
        self.calls += 1
        raise AssertionError(f"receipt-only recovery must not execute Cafe24: {command}")


class SuccessfulCafe24Bridge:
    def __init__(self) -> None:
        self.calls = 0

    def inspect(self) -> JsonObject:
        return {
            "schema": "factory-cafe24-preflight:v1",
            "status": "ready",
            "productId": "cafe24:2994",
            "productKey": "방울수저집",
            "htmlDigest": "html-2994",
            "imageDigests": ["image-2994"],
            "expectedWorkfileRevision": 109,
            "expectedRunId": "run-2994",
            "expectedInputFingerprint": "fingerprint-2994",
        }

    def execute(self, command: JsonObject) -> JsonObject:
        self.calls += 1
        return {
            "status": "staged_verified",
            "payloadDigest": command["payloadDigest"],
            "remoteReadbackDigest": "d" * 64,
            "externalProductNo": "2994",
            "idempotencyKey": command["idempotencyKey"],
        }


class FactoryState:
    def __init__(self) -> None:
        self.session = {
            "productId": "cafe24:2994",
            "productKey": "방울수저집",
            "revision": 109,
            "runId": "run-2994",
            "inputFingerprint": "fingerprint-2994",
        }
        self.registration: JsonObject = {
            "status": "blocked",
            "idempotencyKey": "cafe24-stage:batch-2994:방울수저집:html-2994",
            "publicationReceipt": None,
        }
        self.receipt_updates: list[JsonObject] = []
        self.approval_calls = 0
        self.worker_calls = 0

    def current_state(self) -> JsonObject:
        return {"session": self.session, "registration": self.registration}

    def record_publication_receipt(self, receipt: JsonObject) -> JsonObject:
        self.receipt_updates.append(receipt)
        self.registration = {
            **self.registration,
            "status": "staged_verified",
            "publicationReceipt": receipt,
        }
        return self.current_state()


def receipt() -> JsonObject:
    payload = {
        "batchId": "batch-2994",
        "productId": "cafe24:2994",
        "productKey": "방울수저집",
        "categoryId": "71",
        "htmlDigest": "html-2994",
        "imageDigests": ["image-2994"],
        "expectedWorkfileRevision": 109,
        "expectedRunId": "run-2994",
        "expectedInputFingerprint": "fingerprint-2994",
        **SAFE_DEFAULTS,
    }
    preview = build_preview(payload)
    canonical = preview["payload"]
    readback: JsonObject = {
        "schema": "cafe24-product-readback:v1",
        "productNo": 2994,
        "productCode": "P0000ELE",
        "productName": "방울수저집",
        "display": "F",
        "selling": "F",
        "marketSync": "F",
        "categories": [71, 88, 107],
        "hasOption": "F",
        "options": [],
        "variants": [
            {
                "variantCode": "P0000ELE000A",
                "display": "F",
                "selling": "F",
                "quantity": 0,
            },
        ],
        "images": [{"role": "detail", "sha256": "a" * 64, "bytes": 21355}],
        "detailHtmlDigest": "b" * 64,
        "detailHtmlBytes": 36886,
        "detailHtmlCharacters": 32369,
        "updatedAt": "2026-07-30T23:08:16+09:00",
    }
    return {
        "jobId": "job-2994",
        "factoryReceipt": {
            "schema": "factory-cafe24-publication-receipt:v1",
            "status": "staged_verified",
            "registrationMode": "update",
            "jobId": "job-2994",
            "payload": canonical,
            "payloadDigest": preview["payloadDigest"],
            "idempotencyKey": preview["idempotencyKey"],
            "productId": canonical["productId"],
            "productKey": canonical["productKey"],
            "expectedWorkfileRevision": canonical["expectedWorkfileRevision"],
            "expectedRunId": canonical["expectedRunId"],
            "expectedInputFingerprint": canonical["expectedInputFingerprint"],
            "remoteProductNo": "2994",
            "remoteReadback": readback,
            "remoteReadbackDigest": canonical_readback_digest(readback),
        },
    }


def client(
    tmp_path: Path,
    api: ReceiptApi,
) -> tuple[FlaskClient, dict[str, str], ForbiddenCafe24Bridge, FactoryState]:
    bridge = ForbiddenCafe24Bridge()
    factory_state = FactoryState()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    test_client = create_app(
        config,
        pdp_api=api,
        cafe24_bridge=bridge,
        factory_sync_bridge=factory_state,
    ).test_client()
    session = test_client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    return test_client, headers, bridge, factory_state


def publication_events(receipt_response: JsonObject) -> JsonObject:
    return {
        "jobId": receipt_response["jobId"],
        "events": [
            {
                "eventType": "PUBLICATION_RECEIPT",
                "payload": json.dumps(
                    {
                        key: receipt_response[key]
                        for key in (
                            "receiptId",
                            "target",
                            "targetKey",
                            "payloadDigest",
                            "observedPayloadDigest",
                            "remoteId",
                            "idempotencyKey",
                        )
                    },
                    separators=(",", ":"),
                ),
            },
        ],
    }
