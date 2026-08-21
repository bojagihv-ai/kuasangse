from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from typing import cast
from unittest.mock import patch

from flask import Flask

from control_tower.backend.app import create_app
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError
from control_tower.backend.policy import build_policy_snapshot
from control_tower.backend.routes import register_routes
from control_tower.backend.runtime_cache import JsonObject


def _identity() -> dict[str, object]:
    return {
        "productId": "cafe24:3001",
        "productKey": "product:alpha",
        "currentRunId": "run-7",
        "inputFingerprint": "sha256:input",
        "expectedWorkfileRevision": 9,
    }


def _worker() -> dict[str, object]:
    return {
        "workerId": "factory-worker-test",
        "contractVersion": "control-work-order:v1",
        "capabilityVersion": "batch-control-worker:v1",
    }


def test_snapshot_event_cursor_and_reconnect_do_not_duplicate() -> None:
    bridge = FactorySyncBridge()
    queued = bridge.queue_snapshot()
    claimed = bridge.claim(_worker())
    assert claimed["order"]["orderId"] == queued["orderId"]
    order = claimed["order"]
    bridge.lifecycle(order["orderId"], "ack", {**order, "workerId": "factory-worker-test", "accepted": True, "eventSequence": 1})
    projection = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 7,
        "cursor": "7",
        "connected": True,
        "session": {
            "productId": "cafe24:3001",
            "productKey": "product:alpha",
            "runId": "run-7",
            "inputFingerprint": "sha256:input",
            "revision": 9,
        },
        "inputs": [],
        "stages": [],
        "progress": {},
        "registration": {},
    }
    payload = {**order, "workerId": "factory-worker-test", "eventSequence": 2, "result": projection}
    bridge.lifecycle(order["orderId"], "events", payload)
    bridge.lifecycle(order["orderId"], "complete", payload)
    first = bridge.events_after("")
    resumed = bridge.events_after(first[-1]["eventId"])
    assert len(first) == 1
    assert resumed == []
    state = bridge.current_state()
    assert state["connected"] is False
    assert state["reason"] == "factory_session_missing"


def test_selection_order_binds_identity_and_rejects_stale_lifecycle() -> None:
    bridge = FactorySyncBridge()
    bridge.seed_projection(
        {
            "schema": "factory-control-projection:v1",
            "capabilityVersion": "factory-control-command:v1",
            "sequence": 7,
            "cursor": "7",
            "connected": True,
            "session": {
                "productId": "cafe24:3001",
                "productKey": "product:alpha",
                "runId": "run-7",
                "inputFingerprint": "sha256:input",
                "revision": 9,
            },
            "inputs": [],
            "stages": [],
            "progress": {},
            "registration": {},
        }
    )
    order = bridge.queue_selection(
        {
            "productId": "cafe24:3001",
            "productKey": "product:alpha",
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 9,
            "expectedRunId": "run-7",
            "expectedInputFingerprint": "sha256:input",
            "idempotencyKey": "a-cut:product:alpha:representative:representative-b:9",
        }
    )
    command = order["command"]
    assert command["name"] == "selectFactoryACut"
    assert command["payload"]["candidateId"] == "representative-b"
    assert order["productKey"] == "product:alpha"
    try:
        bridge.queue_selection(
            {
                **command["payload"],
                "expectedRevision": 8,
                "idempotencyKey": "stale",
            }
        )
    except FactorySyncError as error:
        assert error.code == "stale_workfile_revision"
    else:
        raise AssertionError("stale revision must fail")


def test_disconnected_state_is_blocked() -> None:
    bridge = FactorySyncBridge()
    state = bridge.current_state()
    assert state == {
        "schema": "factory-control-projection:v1",
        "connected": False,
        "status": "blocked",
        "reason": "factory_session_missing",
        "inputs": [],
        "stages": [],
        "eventCursor": "0",
    }


def test_blank_worker_rebinds_only_the_exact_hydration_payload_to_its_new_session() -> None:
    bridge = FactorySyncBridge()
    projection = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 1,
        "cursor": "1",
        "connected": True,
        "session": {
            "productId": "factory:old",
            "productKey": "old",
            "runId": "old-run",
            "inputFingerprint": "old-fingerprint",
            "revision": 3,
            "workspaceId": "project_old",
        },
        "inputs": [],
        "stages": [],
        "progress": {},
        "registration": {},
    }
    bridge.hello(
        {
            "schema": "factory-worker-session:v1",
            "sessionId": "worker-session-current",
            "_httpSessionId": "http-session-current",
            "workerId": "factory-worker-test",
            "buildId": "build-001",
            "capabilityVersion": "batch-control-worker:v1",
            "factoryCapabilityVersion": "factory-control-command:v1",
            "startedAt": 10,
            "cursor": 1,
            "identity": {
                "productId": "factory:old",
                "productKey": "old",
                "runId": "old-run",
                "inputFingerprint": "old-fingerprint",
                "revision": 3,
            },
            "projection": projection,
        }
    )

    workfile_text = '{"format":"kuasangse.factory.project"}'
    workfile_sha256 = sha256(workfile_text.encode("utf-8")).hexdigest()
    hydration_payload = {
        "fileName": "gpt가한방울수저집 (8).kuasangse",
        "workfileText": workfile_text,
        "expectedSha256": workfile_sha256,
        "expectedWorkspaceId": "project_mrx0tgw5_mrzrpg",
        "expectedProductId": "cafe24:2994",
        "expectedProductKey": "방울수저집",
        "expectedRunId": "factory_work_run_mrw3euf3_elu0dd",
        "expectedInputFingerprint": "fingerprint-001",
        "expectedWorkfileRevision": 3,
        "idempotencyKey": "workfile:b363c06c",
    }
    try:
        bridge.queue_workfile_hydration(
            {**hydration_payload, "expectedWorkfileRevision": 100}
        )
    except FactorySyncError as error:
        assert error.code == "stale_workfile_revision"
    else:
        raise AssertionError("stale workfile hydration must be rejected")

    order = bridge.queue_workfile_hydration(hydration_payload)

    assert order["workerSessionId"] == "worker-session-current"
    assert order["targetWorkerId"] == "factory-worker-test"
    assert order["command"]["kind"] == "factory-workfile"
    assert order["command"]["payload"]["expectedWorkspaceId"] == "project_mrx0tgw5_mrzrpg"
    bridge.hello(
        {
            "schema": "factory-worker-session:v1",
            "sessionId": "worker-session-next",
            "_httpSessionId": "http-session-next",
            "workerId": "factory-worker-test",
            "buildId": "build-002",
            "capabilityVersion": "batch-control-worker:v1",
            "factoryCapabilityVersion": "factory-control-command:v1",
            "startedAt": 11,
            "cursor": 1,
            "identity": {
                "productId": "factory:old",
                "productKey": "old",
                "runId": "old-run",
                "inputFingerprint": "old-fingerprint",
                "revision": 3,
            },
            "projection": {
                "schema": "factory-control-projection:v1",
                "capabilityVersion": "factory-control-command:v1",
                "sequence": 2,
                "cursor": "2",
                "connected": False,
                "status": "blocked",
                "reason": "factory_session_missing",
                "session": {"revision": 0},
                "inputs": [],
                "stages": [],
            },
        }
    )
    mismatches = {
        "expectedWorkspaceId": "project-changed",
        "expectedProductId": "cafe24:changed",
        "expectedProductKey": "changed-product",
        "expectedRunId": "run-changed",
        "expectedInputFingerprint": "fingerprint-changed",
        "expectedWorkfileRevision": 4,
        "expectedSha256": "0" * 64,
    }
    for field, changed_value in mismatches.items():
        try:
            bridge.queue_workfile_hydration(
                {**order["command"]["payload"], field: changed_value}
            )
        except FactorySyncError as error:
            assert error.code in {
                "factory_workfile_digest_mismatch",
                "idempotency_conflict",
            }
        else:
            raise AssertionError(f"changed hydration field must be rejected: {field}")
    rebound = bridge.queue_workfile_hydration(order["command"]["payload"])
    assert rebound["orderId"] == order["orderId"]
    assert rebound["workerSessionId"] == "worker-session-next"
    stale_claim = bridge.claim({**_worker(), "_httpSessionId": "http-session-stale"})
    assert stale_claim["order"] is None
    current_claim = bridge.claim({**_worker(), "_httpSessionId": "http-session-next"})
    assert current_claim["order"]["orderId"] == order["orderId"]
    claimed_order = current_claim["order"]
    bridge.lifecycle(
        claimed_order["orderId"],
        "ack",
        {
            **claimed_order,
            "workerId": "factory-worker-test",
            "accepted": True,
            "eventSequence": 1,
        },
    )
    hydrated_projection = {
        **projection,
        "sequence": 2,
        "cursor": "2",
        "session": {
            "workspaceId": "project_mrx0tgw5_mrzrpg",
            "productId": "cafe24:2994",
            "productKey": "방울수저집",
            "runId": "factory_work_run_mrw3euf3_elu0dd",
            "inputFingerprint": "fingerprint-001",
            "revision": 10,
        },
    }
    bridge.lifecycle(
        claimed_order["orderId"],
        "complete",
        {
            **claimed_order,
            "workerId": "factory-worker-test",
            "eventSequence": 2,
            "result": {
                "schema": "factory-workfile-hydration-receipt:v1",
                "capabilityVersion": "factory-workfile-hydration-command:v1",
                "workfileSha256": workfile_sha256,
                "projectId": "project_mrx0tgw5_mrzrpg",
                "name": "방울수저집",
                "projection": hydrated_projection,
            },
        },
    )
    assert bridge.current_state()["session"]["revision"] == 10


def test_factory_bff_snapshot_sync_rejects_selection_without_pdp_target() -> None:
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    projection = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 7,
        "cursor": "7",
        "connected": True,
        "session": {
            "productId": "cafe24:3001",
            "productKey": "product:alpha",
            "runId": "run-7",
            "inputFingerprint": "sha256:input",
            "revision": 9,
        },
        "inputs": [],
        "stages": [],
        "progress": {"stageKey": "sections", "percent": 76, "elapsedMs": 12345, "mode": "manual", "status": "blocked"},
        "registration": {"status": "blocked", "blockers": ["final_detail_a_cut"]},
    }

    synced = client.post("/api/factory/sync", json={"projection": projection}, headers=headers)
    state = client.get("/api/factory/state")
    selected = client.post(
        "/api/factory/a-cuts/select",
        json={
            "productId": "cafe24:3001",
            "productKey": "product:alpha",
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 9,
            "expectedRunId": "run-7",
            "expectedInputFingerprint": "sha256:input",
            "idempotencyKey": "a-cut:product:alpha:representative:representative-b:9",
        },
        headers=headers,
    )
    events = bridge.events_after("0")
    resumed = bridge.events_after(str(events[-1]["eventId"]))

    assert synced.status_code == 200
    assert state.get_json()["session"]["revision"] == 9
    assert selected.status_code == 422
    assert selected.get_json()["error"]["code"] == "decision_target_required"
    assert events[-1]["type"] == "factory.snapshot"
    assert resumed == []


def test_factory_bff_rejects_disconnected_selection_without_pdp_target() -> None:
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }

    disconnected = client.get("/api/factory/state")
    selection = client.post(
        "/api/factory/a-cuts/select",
        json={
            "productId": "cafe24:3001",
            "productKey": "product:alpha",
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 9,
            "expectedRunId": "run-7",
            "expectedInputFingerprint": "sha256:input",
            "idempotencyKey": "stale",
        },
        headers=headers,
    )

    assert disconnected.get_json()["connected"] is False
    assert selection.status_code == 422
    assert selection.get_json()["error"]["code"] == "decision_target_required"


def _live_projection(*, sequence: int = 7, revision: int = 9) -> dict[str, object]:
    return {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": sequence,
        "cursor": str(sequence),
        "connected": True,
        "session": {
            "productId": "factory:live-product",
            "productKey": "live-product",
            "runId": "run-live",
            "inputFingerprint": "sha256:live",
            "revision": revision,
        },
        "inputs": [{"key": "product", "count": 1, "missing": [], "items": []}],
        "stages": [
            {
                "key": "representative",
                "status": "connected",
                "selectedIds": ["representative-a"],
                "candidates": [{"id": "representative-a"}, {"id": "representative-b"}],
            }
        ],
        "progress": {"stageKey": "representative", "percent": 50, "status": "manual"},
        "registration": {"status": "blocked", "blockers": ["final_detail_a_cut"]},
    }


def _hello(*, session_id: str = "factory-session-live", cursor: int = 1) -> dict[str, object]:
    return {
        "schema": "factory-worker-session:v1",
        "sessionId": session_id,
        "workerId": "factory-worker-live",
        "buildId": "build-live",
        "capabilityVersion": "batch-control-worker:v1",
        "factoryCapabilityVersion": "factory-control-command:v1",
        "startedAt": 1000,
        "cursor": cursor,
        "projection": _live_projection(),
    }


def test_worker_build_admission_accepts_the_exact_runtime_manifest_build() -> None:
    expected_build = "20260811-webmcp-hydration-bridge-v1109"
    bridge = FactorySyncBridge(expected_build_id=expected_build)
    payload = _hello()
    payload["buildId"] = expected_build

    accepted = bridge.hello(payload)

    assert accepted["accepted"] is True
    assert bridge.current_state()["workerSession"]["buildId"] == expected_build


def test_stale_worker_build_cannot_admit_or_resume_before_queue_mutation(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    stale_build = "20260811-webmcp-hydration-bridge-v1104"
    current_build = "20260811-webmcp-hydration-bridge-v1109"
    legacy = FactorySyncBridge(state_path=state_path)
    stale_hello = _hello()
    stale_hello["buildId"] = stale_build
    legacy.hello(stale_hello)
    queued = legacy.queue_product(_manual_product_job_payload(suffix="stale-build-admission"))
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}
    order = legacy.claim(worker)["order"]
    legacy.lifecycle(
        order["orderId"],
        "fail",
        {**order, "workerId": worker["workerId"], "eventSequence": 1, "error": "legacy failure"},
    )

    bridge = FactorySyncBridge(state_path=state_path, expected_build_id=current_build)
    before_jobs = bridge.product_jobs()
    before_bytes = state_path.read_bytes()

    try:
        bridge.hello(stale_hello)
    except FactorySyncError as error:
        assert error.code == "factory_worker_build_mismatch"
    else:
        raise AssertionError("stale worker build must not be admitted")
    try:
        bridge.resume_product(str(queued["jobId"]))
    except FactorySyncError as error:
        assert error.code == "factory_worker_build_not_admitted"
    else:
        raise AssertionError("resume must fail before a current-build worker is admitted")

    assert bridge.active_worker_target() == {}
    assert bridge.product_jobs() == before_jobs
    assert state_path.read_bytes() == before_bytes
    assert bridge.claim(worker) == {"claimed": False, "order": None}


def test_worker_build_admission_rejects_absent_and_malformed_build_ids() -> None:
    bridge = FactorySyncBridge(expected_build_id="20260811-webmcp-hydration-bridge-v1109")
    for build_id, expected_code in (
        (None, "factory_control_field_missing:buildId"),
        ("v1109 build", "factory_worker_build_invalid"),
    ):
        payload = _hello()
        if build_id is None:
            del payload["buildId"]
        else:
            payload["buildId"] = build_id
        try:
            bridge.hello(payload)
        except FactorySyncError as error:
            assert error.code == expected_code
        else:
            raise AssertionError("absent or malformed worker build must be rejected")
        assert bridge.active_worker_target() == {}


def test_worker_build_admission_http_boundary_rejects_stale_then_accepts_exact_build() -> None:
    expected_build = "20260811-webmcp-hydration-bridge-v1109"
    app = Flask(__name__)
    bridge = FactorySyncBridge(expected_build_id=expected_build)
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    stale_payload = _hello()
    stale_payload["buildId"] = "20260811-webmcp-hydration-bridge-v1104"
    exact_payload = _hello()
    exact_payload["buildId"] = expected_build

    stale = client.post("/api/factory/session/hello", json=stale_payload, headers=headers)
    before_exact = client.get("/api/factory/state").get_json()
    exact = client.post("/api/factory/session/hello", json=exact_payload, headers=headers)
    after_exact = client.get("/api/factory/state").get_json()

    assert stale.status_code == 409
    assert stale.get_json()["error"]["code"] == "factory_worker_build_mismatch"
    assert before_exact["connected"] is False
    assert before_exact["expectedWorkerBuildId"] == expected_build
    assert exact.status_code == 200
    assert after_exact["connected"] is True
    assert after_exact["workerSession"]["buildId"] == expected_build


def test_verified_publication_receipt_updates_registration_once() -> None:
    bridge = FactorySyncBridge()
    projection = _live_projection()
    projection["session"]["revision"] = 10
    projection["registration"] = {
        "status": "blocked",
        "blockers": ["receipt_pending"],
        "expectedWorkfileRevision": 9,
        "idempotencyKey": "receipt-idempotency",
        "publicationReceipt": None,
    }
    bridge.seed_projection(projection)
    receipt = {
        "schema": "factory-cafe24-terminal-publication-receipt:v1",
        "status": "staged_verified",
        "productId": "factory:live-product",
        "productKey": "live-product",
        "expectedRunId": "run-live",
        "expectedInputFingerprint": "sha256:live",
        "expectedWorkfileRevision": 9,
        "idempotencyKey": "receipt-idempotency",
        "remoteReadbackDigest": "d" * 64,
        "remoteProductNo": "2994",
    }

    first = bridge.record_publication_receipt(receipt)
    replay = bridge.record_publication_receipt(receipt)

    assert first["registration"]["status"] == "staged_verified"
    assert first["registration"]["publicationReceipt"] == receipt
    assert replay["registration"]["publicationReceipt"] == receipt
    assert [event["type"] for event in bridge.events_after("0")] == [
        "factory.publication.receipt",
    ]


def test_live_session_hello_heartbeat_disconnect_and_stale_fences() -> None:
    now = [10.0]
    bridge = FactorySyncBridge(session_timeout_seconds=5.0, clock=lambda: now[0])

    hello = bridge.hello(_hello())
    state = bridge.current_state()
    assert hello["accepted"] is True
    assert state["connected"] is True
    assert state["workerSession"]["sessionId"] == "factory-session-live"
    assert state["workerSession"]["buildId"] == "build-live"
    assert state["session"]["productKey"] == "live-product"

    heartbeat = bridge.session_heartbeat(
        {
            **{key: value for key, value in _hello(cursor=2).items() if key != "projection"},
            "identity": {
                "productId": "factory:live-product",
                "productKey": "live-product",
                "runId": "run-live",
                "inputFingerprint": "sha256:live",
                "revision": 9,
            },
        }
    )
    assert heartbeat["accepted"] is True

    try:
        bridge.session_heartbeat(
            {
                **{key: value for key, value in _hello(cursor=1).items() if key != "projection"},
                "identity": {
                    "productId": "factory:live-product",
                    "productKey": "live-product",
                    "runId": "run-live",
                    "inputFingerprint": "sha256:live",
                    "revision": 9,
                },
            }
        )
    except FactorySyncError as error:
        assert error.code == "stale_session_cursor"
    else:
        raise AssertionError("stale heartbeat cursor must fail")

    try:
        bridge.session_heartbeat(
            {
                **{key: value for key, value in _hello(session_id="stale-session", cursor=3).items() if key != "projection"},
                "identity": {},
            }
        )
    except FactorySyncError as error:
        assert error.code == "stale_factory_session"
    else:
        raise AssertionError("foreign session heartbeat must fail")

    now[0] = 16.0
    expired = bridge.current_state()
    assert expired["connected"] is False
    assert expired["reason"] == "factory_heartbeat_timeout"


def test_default_worker_timeout_tolerates_one_minute_background_timer() -> None:
    now = [10.0]
    bridge = FactorySyncBridge(clock=lambda: now[0])
    bridge.hello(_hello())

    now[0] = 85.0
    assert bridge.current_state()["connected"] is True

    now[0] = 101.0
    assert bridge.current_state()["reason"] == "factory_heartbeat_timeout"


def test_connected_worker_clears_stale_factory_session_missing_reason() -> None:
    bridge = FactorySyncBridge()
    payload = _hello()
    payload["projection"] = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 1,
        "cursor": "1",
        "connected": False,
        "status": "blocked",
        "reason": "factory_session_missing",
        "session": {},
        "inputs": [],
        "stages": [],
    }

    bridge.hello(payload)
    state = bridge.current_state()

    assert state["connected"] is True
    assert state["status"] == "blocked"
    assert state["reason"] == ""


def test_live_session_routes_emit_snapshot_resume_without_duplicate_and_reject_stale_sync() -> None:
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }

    hello = client.post("/api/factory/session/hello", json=_hello(), headers=headers)
    events = bridge.events_after("0")
    resumed = bridge.events_after(str(events[-1]["eventId"]))
    stale = client.post(
        "/api/factory/sync",
        json={
            "sessionId": "factory-session-live",
            "workerId": "factory-worker-live",
            "buildId": "build-live",
            "cursor": 1,
            "projection": _live_projection(sequence=8),
        },
        headers=headers,
    )

    assert hello.status_code == 200
    assert events[-1]["type"] == "factory.snapshot"
    assert bridge.current_state()["eventCursor"] == events[-1]["eventId"]
    assert resumed == []
    assert stale.status_code == 409
    assert stale.get_json()["error"]["code"] == "stale_session_cursor"


def test_factory_sse_last_event_id_header_resumes_after_bff_event_only() -> None:
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    client.get("/api/session")
    bridge.hello(_hello())
    bridge.accept_projection(_live_projection(sequence=8, revision=10))
    events = bridge.events_after("0")
    assert [event["eventId"] for event in events] == ["1", "2"]

    response = client.get(
        "/api/factory/events?cursor=0",
        headers={"Last-Event-ID": "1"},
        buffered=False,
    )
    first_chunk = next(response.response).decode("utf-8")
    response.close()

    assert "id: 2\n" in first_chunk
    assert "id: 1\n" not in first_chunk
    assert "event: factory.snapshot\n" in first_chunk
    assert 'data: {"schema":"factory-control-sse:v1"' in first_chunk


def test_factory_sse_rejects_missing_and_invalid_session_before_streaming() -> None:
    # Given: 유효한 쿠키 없이 공장 이벤트를 구독하려는 두 client를 준비한다.
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    missing_session_client = app.test_client()
    invalid_session_client = app.test_client()
    invalid_session_client.set_cookie("control_tower_session", "expired-session")

    # When: 세션 쿠키가 없거나 만료된 값으로 SSE endpoint를 연다.
    missing_session = missing_session_client.get("/api/factory/events", buffered=False)
    invalid_session = invalid_session_client.get("/api/factory/events", buffered=False)

    # Then: 스트림이나 heartbeat를 시작하지 않고 인증 오류로 거부한다.
    assert missing_session.status_code == 401
    assert invalid_session.status_code == 401
    assert missing_session.mimetype == "application/json"
    assert invalid_session.mimetype == "application/json"
    assert "heartbeat" not in missing_session.get_data(as_text=True)
    assert "heartbeat" not in invalid_session.get_data(as_text=True)


def test_factory_sse_redacts_service_keys_from_event_body() -> None:
    # Given: service key 모양의 값이 들어간 projection과 같은 origin session cookie를 준비한다.
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    client.get("/api/session")
    projection = _live_projection(sequence=8, revision=10)
    projection["serviceKey"] = "fixture-only"
    bridge.accept_projection(projection)

    # When: EventSource 호환 GET으로 첫 SSE event를 수신한다.
    response = client.get("/api/factory/events", buffered=False)
    first_chunk = next(response.response).decode("utf-8")
    response.close()

    # Then: 정상 SSE 계약은 유지하면서 credential field와 값은 body에 없어야 한다.
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert "event: factory.snapshot\n" in first_chunk
    assert "serviceKey" not in first_chunk
    assert "fixture-only" not in first_chunk


def test_factory_state_redacts_sensitive_projection_fields_without_hiding_status() -> None:
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    projection = _live_projection(sequence=8, revision=10)
    projection["serviceKey"] = "fixture-service-key"
    projection["approvalToken"] = "fixture-approval-token"
    projection["nested"] = {
        "accessToken": "fixture-access-token",
        "token": "fixture-generic-token",
        "visibleStatus": "ready",
    }
    bridge.accept_projection(projection)

    response = app.test_client().get("/api/factory/state")
    body = response.get_json()

    assert response.status_code == 200
    assert body["connected"] is False
    assert body["nested"] == {"visibleStatus": "ready"}
    assert "fixture-service-key" not in response.get_data(as_text=True)
    assert "fixture-access-token" not in response.get_data(as_text=True)
    assert "fixture-approval-token" not in response.get_data(as_text=True)
    assert "fixture-generic-token" not in response.get_data(as_text=True)


def test_live_work_order_a_cut_completion_updates_receipt_revision_and_sse() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    order = bridge.queue_selection(
        {
            "productId": "factory:live-product",
            "productKey": "live-product",
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 9,
            "expectedRunId": "run-live",
            "expectedInputFingerprint": "sha256:live",
            "idempotencyKey": "live-a-cut:representative-b:9",
        }
    )
    live_worker = {
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
        "contractVersion": "control-work-order:v1",
        "capabilityVersion": "batch-control-worker:v1",
    }
    claimed = bridge.claim(live_worker)
    assert claimed["order"]["orderId"] == order["orderId"]
    bridge.lifecycle(order["orderId"], "ack", {**order, "workerId": "factory-worker-live", "accepted": True, "eventSequence": 1})
    projection = _live_projection(sequence=8, revision=10)
    projection["stages"][0]["selectedIds"] = ["representative-b"]
    receipt = {
        "schema": "factory-a-cut-receipt:v1",
        "receiptId": "factory-a-cut:live",
        "productId": "factory:live-product",
        "productKey": "live-product",
        "stageKey": "representative",
        "candidateId": "representative-b",
        "runId": "run-live",
        "inputFingerprint": "sha256:live",
        "revision": 10,
        "idempotencyKey": "live-a-cut:representative-b:9",
        "projection": projection,
    }
    payload = {**order, "workerId": "factory-worker-live", "eventSequence": 2, "result": receipt}
    bridge.lifecycle(order["orderId"], "events", payload)
    bridge.lifecycle(order["orderId"], "complete", payload)

    state = bridge.current_state()
    selected = state["stages"][0]
    events = bridge.events_after("0")
    assert state["session"]["revision"] == 10
    assert selected["selectedIds"] == ["representative-b"]
    assert events[-1]["type"] == "factory.a_cut.selected"
    assert events[-1]["receipt"]["receiptId"] == "factory-a-cut:live"


def _manual_product_job_payload(*, suffix: str = "a") -> dict[str, object]:
    return {
        "contractType": "manual-product-intake",
        "contractVersion": "1.0.0",
        "batchId": "batch-direct-input",
        "idempotencyKey": f"manual-product-{suffix}",
        "mode": "manual",
        "imageModel": "gemini-3.1-flash-image",
        "source": {"kind": "manual"},
        "productName": f"직접 입력 제품 {suffix}",
        "category": "주방",
        "requiredValues": {
            "material": "스테인리스",
            "originCountry": "대한민국",
            "size": "20cm",
            "salePrice": "12000",
            "usage": "주방용",
            "optionMode": "provided",
        },
        "inputImages": [
            {
                "role": "base",
                "ordinal": 1,
                "name": "정면",
                "fileName": "front.png",
                "sha256": "fixture-sha",
                "dataUrl": "data:image/png;base64,aGVsbG8=",
            }
        ],
    }


def _product_projection(
    job_id: str,
    *,
    sequence: int,
    revision: int,
) -> dict[str, object]:
    projection = _live_projection(sequence=sequence, revision=revision)
    projection["session"].update(
        {
            "workspaceId": f"batch:{job_id}",
            "productId": f"factory:{job_id}",
            "productKey": job_id,
            "runId": f"run:{job_id}",
            "inputFingerprint": f"sha256:{job_id}",
        }
    )
    projection["registration"]["jobId"] = job_id
    return projection


def _product_checkpoint(
    job_id: str,
    projection: dict[str, object],
    *,
    status: str,
    stage_key: str,
) -> dict[str, object]:
    session = projection["session"]
    return {
        "schema": "factory-product-checkpoint:v1",
        "jobId": job_id,
        "projectId": f"batch:{job_id}",
        "productId": session["productId"],
        "productKey": session["productKey"],
        "runId": session["runId"],
        "inputFingerprint": session["inputFingerprint"],
        "revision": session["revision"],
        "status": status,
        "stageKey": stage_key,
        "savedAt": 1,
    }


def _claim_checkpointed_product(
    bridge: FactorySyncBridge,
    *,
    suffix: str,
) -> tuple[JsonObject, JsonObject, JsonObject]:
    queued = bridge.queue_product(_manual_product_job_payload(suffix=suffix))
    worker: JsonObject = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    first_order = bridge.claim(worker)["order"]
    assert isinstance(first_order, dict)
    bridge.lifecycle(
        first_order["orderId"],
        "ack",
        {
            **first_order,
            "workerId": worker["workerId"],
            "accepted": True,
            "eventSequence": 1,
        },
    )
    projection = _product_projection(str(queued["jobId"]), sequence=8, revision=10)
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": queued["jobId"],
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": projection,
        "checkpoint": _product_checkpoint(
            str(queued["jobId"]),
            projection,
            status="waiting_manual",
            stage_key="representative",
        ),
    }
    completed = {
        **first_order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": receipt,
    }
    bridge.lifecycle(first_order["orderId"], "events", completed)
    bridge.lifecycle(first_order["orderId"], "complete", completed)
    bridge.resume_product(str(queued["jobId"]))
    current_order = bridge.claim(worker)["order"]
    assert isinstance(current_order, dict)
    bridge.lifecycle(
        current_order["orderId"],
        "ack",
        {
            **current_order,
            "workerId": worker["workerId"],
            "accepted": True,
            "eventSequence": 1,
        },
    )
    bridge.lifecycle(
        current_order["orderId"],
        "events",
        {**current_order, "workerId": worker["workerId"], "eventSequence": 2},
    )
    return queued, worker, current_order


def _durable_product_job(state_path: Path, job_id: str) -> JsonObject:
    document = json.loads(state_path.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    jobs = document.get("jobs")
    assert isinstance(jobs, list)
    for job in jobs:
        if isinstance(job, dict) and job.get("jobId") == job_id:
            return job
    raise AssertionError(f"durable product job missing: {job_id}")


def test_factory_product_queue_waits_for_manual_selection_then_resumes_sequentially() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    first = bridge.queue_product(_manual_product_job_payload(suffix="a"))
    second = bridge.queue_product(_manual_product_job_payload(suffix="b"))
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}

    claimed = bridge.claim(worker)
    order = claimed["order"]
    assert claimed["claimed"] is True
    assert order["command"]["name"] == "runFactoryProduct"
    assert order["command"]["payload"]["startFresh"] is True
    assert order["command"]["payload"]["requiredValues"]["category"] == "주방"
    assert order["command"]["payload"]["inputImages"][0]["dataUrl"].startswith("data:image/png;base64,")
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    projection = _product_projection(first["jobId"], sequence=8, revision=10)
    projection["stages"][0]["selectedIds"] = []
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": first["jobId"],
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": projection,
        "checkpoint": _product_checkpoint(
            first["jobId"],
            projection,
            status="waiting_manual",
            stage_key="representative",
        ),
    }
    complete = {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": receipt}
    bridge.lifecycle(order["orderId"], "events", complete)
    bridge.lifecycle(order["orderId"], "complete", complete)

    jobs = bridge.product_jobs()
    assert [job["status"] for job in jobs] == ["waiting_manual", "queued"]
    second_order = bridge.claim(worker)["order"]
    assert second_order["command"]["payload"]["jobId"] == second["jobId"]
    bridge.lifecycle(
        second_order["orderId"],
        "ack",
        {**second_order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    second_projection = _product_projection(second["jobId"], sequence=9, revision=11)
    second_receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": second["jobId"],
        "status": "completed",
        "stageKey": "",
        "message": "Cafe24 사전점검 준비 완료",
        "projection": second_projection,
        "checkpoint": _product_checkpoint(
            second["jobId"],
            second_projection,
            status="completed",
            stage_key="",
        ),
    }
    second_complete = {
        **second_order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": second_receipt,
    }
    bridge.lifecycle(second_order["orderId"], "events", second_complete)
    bridge.lifecycle(second_order["orderId"], "complete", second_complete)

    restoring = bridge.resume_product(first["jobId"])
    restore_order = bridge.claim(worker)["order"]
    assert restoring["status"] == "queued"
    assert restore_order["command"]["payload"]["restoreOnly"] is True
    assert restore_order["command"]["payload"]["checkpoint"]["projectId"] == f"batch:{first['jobId']}"
    bridge.lifecycle(
        restore_order["orderId"],
        "ack",
        {**restore_order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    restored = {
        **restore_order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": receipt,
    }
    bridge.lifecycle(restore_order["orderId"], "events", restored)
    bridge.lifecycle(restore_order["orderId"], "complete", restored)

    try:
        bridge.resume_product(first["jobId"])
    except FactorySyncError as error:
        assert error.code == "factory_decision_required"
    else:
        raise AssertionError("manual resume must require a selected candidate")

    selected_projection = _product_projection(first["jobId"], sequence=10, revision=12)
    selected_projection["stages"][0]["selectedIds"] = ["representative-a"]
    bridge.accept_projection(selected_projection)
    resumed = bridge.resume_product(first["jobId"])
    resumed_order = bridge.claim(worker)["order"]
    assert resumed["status"] == "queued"
    assert resumed_order["command"]["payload"]["startFresh"] is False
    assert resumed_order["command"]["payload"]["restoreOnly"] is False
    assert resumed_order["command"]["payload"]["expectedStageKey"] == "representative"
    assert [job["status"] for job in bridge.product_jobs()] == ["running", "completed"]


def test_factory_product_claim_publishes_running_job_to_sse() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload(suffix="claim-event"))
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}

    bridge.claim(worker)

    event = bridge.events_after("0")[-1]
    assert event["type"] == "factory.product.updated"
    assert event["job"]["jobId"] == queued["jobId"]
    assert event["job"]["status"] == "running"


def test_blocked_product_without_checkpoint_retries_from_fresh_payload() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload(suffix="retry-fresh"))
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}
    order = bridge.claim(worker)["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    bridge.lifecycle(
        order["orderId"],
        "fail",
        {**order, "workerId": worker["workerId"], "eventSequence": 2, "error": "workspace mutation scope is unavailable"},
    )

    retried = bridge.resume_product(queued["jobId"], image_model="api-hub-openai-image")
    retry_order = bridge.claim(worker)["order"]

    assert retried["status"] == "queued"
    assert retry_order["command"]["payload"]["startFresh"] is True
    assert retry_order["command"]["payload"]["restoreOnly"] is False
    assert retry_order["command"]["payload"]["expectedStageKey"] == ""
    assert retry_order["command"]["payload"]["imageModel"] == "api-hub-openai-image"
    assert len(retry_order["command"]["payload"]["inputImages"]) == 1


def test_blocked_product_with_checkpoint_restores_even_when_projection_has_same_job() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued, worker, current_order = _claim_checkpointed_product(
        bridge,
        suffix="blocked-same-job-checkpoint",
    )
    bridge.lifecycle(
        current_order["orderId"],
        "fail",
        {
            **current_order,
            "workerId": worker["workerId"],
            "eventSequence": 3,
            "error": "interrupted after checkpoint",
        },
    )

    bridge.resume_product(str(queued["jobId"]))
    restored_order = bridge.claim(worker)["order"]

    assert restored_order["command"]["payload"]["startFresh"] is False
    assert restored_order["command"]["payload"]["restoreOnly"] is True
    assert restored_order["command"]["payload"]["checkpoint"]["jobId"] == queued["jobId"]


def test_blocked_product_with_newer_same_job_projection_resumes_without_restoring_checkpoint() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued, worker, current_order = _claim_checkpointed_product(
        bridge,
        suffix="blocked-same-job-newer-projection",
    )
    bridge.lifecycle(
        current_order["orderId"],
        "fail",
        {
            **current_order,
            "workerId": worker["workerId"],
            "eventSequence": 3,
            "error": "checkpoint save rejected after later stage output",
        },
    )
    advanced_projection = _product_projection(str(queued["jobId"]), sequence=12, revision=11)
    bridge.accept_projection(advanced_projection)

    bridge.resume_product(str(queued["jobId"]))
    resumed_order = bridge.claim(worker)["order"]

    assert resumed_order["command"]["payload"]["startFresh"] is False
    assert resumed_order["command"]["payload"]["restoreOnly"] is False
    assert resumed_order["command"]["payload"]["expectedStageKey"] == "representative"


def test_completed_product_with_blocked_registration_restores_same_job_checkpoint() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued, worker, current_order = _claim_checkpointed_product(
        bridge,
        suffix="completed-blocked-registration",
    )
    completed_projection = _product_projection(str(queued["jobId"]), sequence=9, revision=11)
    completed = {
        **current_order,
        "workerId": worker["workerId"],
        "eventSequence": 3,
        "result": {
            "schema": "factory-product-run-receipt:v1",
            "jobId": queued["jobId"],
            "status": "completed",
            "stageKey": "",
            "message": "Cafe24 사전점검 준비 완료",
            "projection": completed_projection,
            "checkpoint": _product_checkpoint(
                str(queued["jobId"]),
                completed_projection,
                status="completed",
                stage_key="",
            ),
        },
    }
    bridge.lifecycle(current_order["orderId"], "events", completed)
    bridge.lifecycle(current_order["orderId"], "complete", completed)
    degraded_projection = _product_projection(str(queued["jobId"]), sequence=10, revision=11)
    degraded_projection["registration"].update({
        "status": "blocked",
        "blockers": ["section-preview-incomplete"],
    })
    bridge.accept_projection(degraded_projection)

    restoring = bridge.resume_product(str(queued["jobId"]))
    restore_order = bridge.claim(worker)["order"]

    assert restoring["status"] == "queued"
    assert restore_order["command"]["payload"]["startFresh"] is False
    assert restore_order["command"]["payload"]["restoreOnly"] is True
    assert restore_order["command"]["payload"]["checkpoint"]["jobId"] == queued["jobId"]


def test_product_completion_preserves_newer_same_run_projection() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload(suffix="completion-race"))
    worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    order = bridge.claim(worker)["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    receipt_projection = _product_projection(queued["jobId"], sequence=8, revision=10)
    newer_projection = _product_projection(queued["jobId"], sequence=9, revision=10)
    newer_projection["progress"]["message"] = "실시간 동기화가 완료 영수증보다 먼저 도착"
    bridge.accept_projection(newer_projection)
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": queued["jobId"],
        "status": "blocked",
        "stageKey": "",
        "message": "사이즈 이미지 생성 한도 초과",
        "projection": receipt_projection,
        "checkpoint": _product_checkpoint(
            queued["jobId"],
            receipt_projection,
            status="blocked",
            stage_key="",
        ),
    }
    completed = {
        **order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": receipt,
    }
    bridge.lifecycle(order["orderId"], "events", completed)
    bridge.lifecycle(order["orderId"], "complete", completed)

    assert bridge.product_jobs()[0]["status"] == "blocked"
    assert bridge.current_state()["sequence"] == 9
    assert bridge.current_state()["progress"]["message"] == newer_projection["progress"]["message"]


def test_restore_only_completion_accepts_authoritative_revision_after_transient_projection() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued, worker, current_order = _claim_checkpointed_product(
        bridge,
        suffix="restore-completion-race",
    )
    bridge.lifecycle(
        current_order["orderId"],
        "fail",
        {
            **current_order,
            "workerId": worker["workerId"],
            "eventSequence": 3,
            "error": "interrupted after checkpoint",
        },
    )
    bridge.resume_product(str(queued["jobId"]))
    restore_order = bridge.claim(worker)["order"]
    assert restore_order["command"]["payload"]["restoreOnly"] is True
    bridge.lifecycle(
        restore_order["orderId"],
        "ack",
        {
            **restore_order,
            "workerId": worker["workerId"],
            "accepted": True,
            "eventSequence": 1,
        },
    )

    receipt_projection = _product_projection(str(queued["jobId"]), sequence=20, revision=30)
    newer_projection = _product_projection(str(queued["jobId"]), sequence=21, revision=31)
    newer_projection["progress"]["message"] = "복원 상태 동기화가 완료 영수증보다 먼저 도착"
    bridge.accept_projection(newer_projection)
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": queued["jobId"],
        "status": "completed",
        "stageKey": "",
        "message": "Cafe24 사전점검 준비 완료",
        "projection": receipt_projection,
        "checkpoint": _product_checkpoint(
            str(queued["jobId"]),
            receipt_projection,
            status="completed",
            stage_key="",
        ),
    }
    completed = {
        **restore_order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": receipt,
    }
    bridge.lifecycle(restore_order["orderId"], "events", completed)
    bridge.lifecycle(restore_order["orderId"], "complete", completed)

    assert bridge.product_jobs()[0]["status"] == "completed"
    assert bridge._product_jobs[str(queued["jobId"])].checkpoint["revision"] == 30
    assert bridge.current_state()["session"]["revision"] == 30
    assert bridge.current_state()["progress"] == receipt_projection["progress"]


def test_factory_product_queue_forwards_locked_stage_decisions_to_worker() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    payload = _manual_product_job_payload(suffix="stage-policy")
    payload["mode"] = "auto"
    payload["policySnapshot"] = build_policy_snapshot(
        batch_id=str(payload["batchId"]),
        product_id=str(payload["productName"]),
        preset="full_auto",
        batch_override={},
        product_override={},
        stage_override={"representative_image": "manual", "size_image": "manual"},
    )

    queued = bridge.queue_product(payload)
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}
    order = bridge.claim(worker)["order"]

    assert queued["policy"]["snapshotId"] == payload["policySnapshot"]["snapshotId"]
    assert queued["policy"]["resolved"]["representative_image"] == "manual"
    assert order["command"]["payload"]["decisionModes"]["representative_image"] == "manual"
    assert order["command"]["payload"]["decisionModes"]["size_image"] == "manual"
    assert order["command"]["payload"]["decisionModes"]["general_image"] == "auto"


def test_factory_product_routes_accept_direct_input_and_return_full_queue() -> None:
    app = Flask(__name__)
    bridge = FactorySyncBridge()
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }

    created = client.post("/api/factory/jobs", json=_manual_product_job_payload(), headers=headers)
    listed = client.get("/api/factory/jobs")

    assert created.status_code == 202
    assert created.get_json()["job"]["sourceKind"] == "manual"
    assert "inputImages" not in created.get_json()["job"]
    assert listed.status_code == 200
    assert listed.get_json()["total"] == 1
    assert listed.get_json()["jobs"][0]["imageCount"] == 1


def test_sinhwa_product_uses_selected_jcode_in_the_common_factory_queue() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    payload = _manual_product_job_payload(suffix="sinhwa")
    payload.update(
        {
            "source": {"kind": "sinhwa-db", "selectionId": "2994"},
            "jcode": 2994,
            "inputImages": [],
        }
    )

    queued = bridge.queue_product(payload)
    worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    order = bridge.claim(worker)["order"]

    assert queued["sourceKind"] == "sinhwa-db"
    assert order["productId"] == "sinhwa:2994"
    assert order["command"]["payload"]["source"]["kind"] == "sinhwa-db"
    assert order["command"]["payload"]["inputImages"] == []


def test_factory_product_queue_waits_for_current_worker_session() -> None:
    bridge = FactorySyncBridge()
    bridge.queue_product(_manual_product_job_payload())
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}

    assert bridge.claim(worker) == {"claimed": False, "order": None}
    bridge.hello(_hello())
    assert bridge.claim({**worker, "sessionId": "stale-session"}) == {"claimed": False, "order": None}
    assert bridge.claim(worker)["claimed"] is True


def test_pending_product_order_rebinds_to_restarted_build_worker() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload(suffix="pending-restart"))
    replacement = _hello(session_id="factory-session-next-build")
    replacement.update(
        {
            "workerId": "factory-worker-next-build",
            "buildId": "build-next",
            "startedAt": 1001,
        }
    )
    bridge.hello(replacement)

    assert bridge.claim(
        {
            **_worker(),
            "workerId": "factory-worker-live",
            "sessionId": "factory-session-live",
        }
    ) == {"claimed": False, "order": None}
    claimed = bridge.claim(
        {
            **_worker(),
            "workerId": "factory-worker-next-build",
            "sessionId": "factory-session-next-build",
        }
    )
    assert claimed["order"]["command"]["payload"]["jobId"] == queued["jobId"]


def test_inflight_selection_order_rebinds_to_restarted_worker_session() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    order = bridge.queue_selection(
        {
            "productId": "factory:live-product",
            "productKey": "live-product",
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 9,
            "expectedRunId": "run-live",
            "expectedInputFingerprint": "sha256:live",
            "idempotencyKey": "selection-restart:representative-b:9",
        }
    )
    old_worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    assert bridge.claim(old_worker)["order"]["orderId"] == order["orderId"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": old_worker["workerId"], "accepted": True, "eventSequence": 1},
    )

    replacement = _hello(session_id="factory-session-selection-restarted")
    replacement.update(
        {
            "workerId": "factory-worker-next-build",
            "buildId": "build-next",
            "startedAt": 1001,
        }
    )
    bridge.hello(replacement)

    try:
        bridge.lifecycle(
            order["orderId"],
            "events",
            {**order, "workerId": old_worker["workerId"], "eventSequence": 2},
        )
    except FactorySyncError as error:
        assert error.code == "stale_factory_session"
    else:
        raise AssertionError("restarted selection must reject the old worker session")

    rebound = bridge.claim(
        {
            **_worker(),
            "workerId": "factory-worker-next-build",
            "sessionId": "factory-session-selection-restarted",
        }
    )["order"]
    assert rebound["orderId"] == order["orderId"]
    assert rebound["workerSessionId"] == "factory-session-selection-restarted"
    assert rebound["targetWorkerId"] == "factory-worker-next-build"


def test_product_queue_and_manual_hold_restore_after_backend_restart(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    first = bridge.queue_product(_manual_product_job_payload(suffix="durable-a"))
    second = bridge.queue_product(_manual_product_job_payload(suffix="durable-b"))
    worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    order = bridge.claim(worker)["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    held_projection = _product_projection(first["jobId"], sequence=8, revision=10)
    held_projection["stages"][0]["selectedIds"] = []
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": first["jobId"],
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": held_projection,
        "checkpoint": _product_checkpoint(
            first["jobId"],
            held_projection,
            status="waiting_manual",
            stage_key="representative",
        ),
    }
    completed = {
        **order,
        "workerId": worker["workerId"],
        "eventSequence": 2,
        "result": receipt,
    }
    bridge.lifecycle(order["orderId"], "events", completed)
    bridge.lifecycle(order["orderId"], "complete", completed)

    restored = FactorySyncBridge(state_path=state_path)
    restored_jobs = restored.product_jobs()
    assert [job["jobId"] for job in restored_jobs] == [first["jobId"], second["jobId"]]
    assert [job["status"] for job in restored_jobs] == ["waiting_manual", "blocked"]
    assert restored.product_job_context(first["jobId"])["payload"]["inputImages"][0]["dataUrl"] == "data:image/png;base64,aGVsbG8="

    restored.resume_product(second["jobId"])

    replacement = _hello(session_id="factory-session-backend-restarted")
    replacement.update(
        {
            "workerId": "factory-worker-next-build",
            "buildId": "build-next",
            "startedAt": 1001,
            "projection": held_projection,
        }
    )
    restored.hello(replacement)
    new_worker = {
        **_worker(),
        "workerId": "factory-worker-next-build",
        "sessionId": "factory-session-backend-restarted",
    }
    second_order = restored.claim(new_worker)["order"]
    assert second_order["command"]["payload"]["jobId"] == second["jobId"]
    restored.lifecycle(
        second_order["orderId"],
        "ack",
        {**second_order, "workerId": new_worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    second_projection = _product_projection(second["jobId"], sequence=9, revision=11)
    second_receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": second["jobId"],
        "status": "completed",
        "stageKey": "",
        "message": "Cafe24 사전점검 준비 완료",
        "projection": second_projection,
        "checkpoint": _product_checkpoint(
            second["jobId"],
            second_projection,
            status="completed",
            stage_key="",
        ),
    }
    second_completed = {
        **second_order,
        "workerId": new_worker["workerId"],
        "eventSequence": 2,
        "result": second_receipt,
    }
    restored.lifecycle(second_order["orderId"], "events", second_completed)
    restored.lifecycle(second_order["orderId"], "complete", second_completed)

    restored.resume_product(first["jobId"])
    resumed_order = restored.claim(new_worker)["order"]
    assert resumed_order["command"]["payload"]["jobId"] == first["jobId"]
    assert resumed_order["command"]["payload"]["startFresh"] is False
    assert resumed_order["command"]["payload"]["restoreOnly"] is True
    assert resumed_order["command"]["payload"]["checkpoint"]["projectId"] == f"batch:{first['jobId']}"


def test_product_queue_rejects_nested_sensitive_fields_before_persistence(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    source_secret = _manual_product_job_payload(suffix="source-secret")
    source_secret["source"] = {
        "kind": "manual",
        "accessToken": "fixture-access-token",
    }
    required_value_secret = _manual_product_job_payload(suffix="field-secret")
    required_value_secret["requiredValues"] = {
        "category": "주방",
        "credential": "fixture-credential",
    }
    hidden_value_secret = _manual_product_job_payload(suffix="hidden-value-secret")
    hidden_value_secret["requiredValues"]["material"] = "Bearer credential-value"

    for payload in (source_secret, required_value_secret, hidden_value_secret):
        try:
            bridge.queue_product(payload)
        except FactorySyncError as error:
            assert error.code == "factory_product_sensitive_field_forbidden"
        else:
            raise AssertionError("sensitive product fields must fail before persistence")

    assert bridge.product_jobs() == []
    assert state_path.exists() is False


def test_product_queue_allows_secret_like_bytes_inside_image_data_url(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    payload = _manual_product_job_payload(suffix="image-bytes")
    payload["inputImages"][0]["dataUrl"] = "data:image/png;base64,skAAAAAAAAAAAAAAAAAA"

    queued = bridge.queue_product(payload)

    assert queued["status"] == "queued"
    assert bridge.product_job_context(queued["jobId"])["payload"]["inputImages"][0]["dataUrl"] == payload["inputImages"][0]["dataUrl"]


def test_production_app_startup_fails_closed_for_corrupt_product_queue_state(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    for content, expected_code in (
        ("{not-json", "factory_product_state_read_failed"),
        ('{"schema":"wrong","jobs":[]}', "factory_product_state_invalid"),
    ):
        state_path.write_text(content, encoding="utf-8")
        try:
            create_app(
                ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
            )
        except FactorySyncError as error:
            assert error.code == expected_code
        else:
            raise AssertionError("corrupt durable queue state must stop app startup")


def test_product_queue_rolls_back_memory_and_order_when_persistence_fails(tmp_path: Path) -> None:
    blocked_parent = tmp_path / "not-a-directory"
    blocked_parent.write_text("fixture", encoding="utf-8")
    bridge = FactorySyncBridge(state_path=blocked_parent / "factory-product-jobs.json")
    bridge.hello(_hello())

    try:
        bridge.queue_product(_manual_product_job_payload(suffix="write-failure"))
    except FactorySyncError as error:
        assert error.code == "factory_product_state_write_failed"
    else:
        raise AssertionError("failed persistence must reject the queue request")

    worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    assert bridge.product_jobs() == []
    assert bridge.has_pending() is False
    assert bridge.claim(worker) == {"claimed": False, "order": None}
    assert [event["type"] for event in bridge.events_after("0")] == ["factory.snapshot"]


def test_product_completion_rolls_back_nested_projection_when_persistence_fails(tmp_path: Path) -> None:
    state_path = tmp_path / "queue" / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload(suffix="completion-write-failure"))
    worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    order = bridge.claim(worker)["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    before = bridge.current_state()
    state_path.unlink()
    state_path.parent.rmdir()
    state_path.parent.write_text("fixture", encoding="utf-8")
    result_projection = _product_projection(queued["jobId"], sequence=8, revision=10)
    result_projection["stages"][0]["selectedIds"] = []
    result = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": queued["jobId"],
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 결과를 선택해 주세요.",
        "projection": result_projection,
        "checkpoint": _product_checkpoint(
            queued["jobId"],
            result_projection,
            status="waiting_manual",
            stage_key="representative",
        ),
    }

    try:
        bridge.lifecycle(
            order["orderId"],
            "complete",
            {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": result},
        )
    except FactorySyncError as error:
        assert error.code == "factory_product_state_write_failed"
    else:
        raise AssertionError("failed completion persistence must roll back lifecycle state")

    after = bridge.current_state()
    assert after["session"] == before["session"]
    assert after["stages"] == before["stages"]
    assert bridge.product_jobs()[0]["status"] == "running"
    bridge.lifecycle(
        order["orderId"],
        "events",
        {**order, "workerId": worker["workerId"], "eventSequence": 2},
    )


def test_factory_heartbeat_timeout_terminalizes_claimed_product_once_and_preserves_checkpoint(
    tmp_path: Path,
) -> None:
    now = [10.0]
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(
        state_path=state_path,
        session_timeout_seconds=5.0,
        clock=lambda: now[0],
    )
    bridge.hello(_hello())
    queued, _, current_order = _claim_checkpointed_product(bridge, suffix="heartbeat-timeout")
    job_id = str(queued["jobId"])
    before_job = _durable_product_job(state_path, job_id)
    before_cursor = bridge.events_after("0")[-1]["eventId"]
    before_attempts = before_job["attempts"]
    before_payload = before_job["payload"]
    before_checkpoint = before_job["checkpoint"]
    now[0] = 16.0

    with patch.object(
        bridge,
        "_persist_product_jobs_locked",
        wraps=bridge._persist_product_jobs_locked,
    ) as persist:
        expired = bridge.current_state()
        after_first_read = state_path.read_bytes()
        repeated = bridge.current_state()

    after_job = _durable_product_job(state_path, job_id)
    in_memory = bridge._product_jobs[job_id]
    assert expired["connected"] is False
    assert expired["reason"] == "factory_heartbeat_timeout"
    assert repeated == expired
    assert bridge._executions[str(current_order["orderId"])].status == "superseded"
    assert in_memory.status == "blocked"
    assert in_memory.current_order_id == ""
    assert after_job["status"] == "blocked"
    assert after_job["currentOrderId"] == ""
    assert after_job["attempts"] == before_attempts
    assert after_job["payload"] == before_payload
    assert after_job["checkpoint"] == before_checkpoint
    assert [event["type"] for event in bridge.events_after(before_cursor)] == [
        "factory.product.updated",
        "factory.session.disconnected",
    ]
    assert persist.call_count == 1
    assert state_path.read_bytes() == after_first_read


def test_factory_heartbeat_timeout_fences_late_product_lifecycle(tmp_path: Path) -> None:
    now = [10.0]
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(
        state_path=state_path,
        session_timeout_seconds=5.0,
        clock=lambda: now[0],
    )
    bridge.hello(_hello())
    queued, worker, current_order = _claim_checkpointed_product(bridge, suffix="late-lifecycle")
    job_id = str(queued["jobId"])
    now[0] = 16.0
    bridge.current_state()
    protected_bytes = state_path.read_bytes()
    protected_checkpoint = _durable_product_job(state_path, job_id)["checkpoint"]

    assert bridge._executions[str(current_order["orderId"])].status == "superseded"
    for action in ("events", "complete", "fail"):
        try:
            bridge.lifecycle(
                str(current_order["orderId"]),
                action,
                {
                    **current_order,
                    "workerId": worker["workerId"],
                    "eventSequence": 3,
                },
            )
        except FactorySyncError as error:
            assert error.code == "stale_factory_session"
        else:
            raise AssertionError(f"late {action} must remain fenced after timeout")
        assert state_path.read_bytes() == protected_bytes
        assert _durable_product_job(state_path, job_id)["checkpoint"] == protected_checkpoint


def test_factory_startup_blocks_and_persists_running_product_orphan_until_explicit_resume(
    tmp_path: Path,
) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    queued, worker, old_order = _claim_checkpointed_product(bridge, suffix="startup-orphan")
    job_id = str(queued["jobId"])
    before_job = _durable_product_job(state_path, job_id)
    original_persist = FactorySyncBridge._persist_product_jobs_locked
    startup_persist_calls = [0]

    def counted_startup_persist(instance: FactorySyncBridge) -> None:
        startup_persist_calls[0] += 1
        original_persist(instance)

    with patch.object(
        FactorySyncBridge,
        "_persist_product_jobs_locked",
        new=counted_startup_persist,
    ):
        restored = FactorySyncBridge(state_path=state_path)

    restored_job = _durable_product_job(state_path, job_id)
    assert startup_persist_calls == [1]
    assert restored_job["status"] == "blocked"
    assert restored_job["currentOrderId"] == ""
    assert restored_job["attempts"] == before_job["attempts"]
    assert restored_job["payload"] == before_job["payload"]
    assert restored_job["checkpoint"] == before_job["checkpoint"]
    assert restored.owns(str(old_order["orderId"])) is True

    replacement = _hello(session_id="factory-session-after-backend-restart")
    replacement.update(
        {
            "workerId": "factory-worker-after-backend-restart",
            "buildId": "build-after-backend-restart",
            "startedAt": 1001,
        }
    )
    restored.hello(replacement)
    new_worker = {
        **_worker(),
        "workerId": "factory-worker-after-backend-restart",
        "sessionId": "factory-session-after-backend-restart",
    }
    assert restored.claim(new_worker) == {"claimed": False, "order": None}
    try:
        restored.lifecycle(
            str(old_order["orderId"]),
            "events",
            {**old_order, "workerId": worker["workerId"], "eventSequence": 3},
        )
    except FactorySyncError as error:
        assert error.code == "stale_factory_session"
    else:
        raise AssertionError("persisted orphan order must stay fenced after restart")

    restored.resume_product(job_id)
    resumed_order = restored.claim(new_worker)["order"]
    assert isinstance(resumed_order, dict)
    assert resumed_order["orderId"] != old_order["orderId"]
    assert resumed_order["command"]["payload"]["restoreOnly"] is True
    assert resumed_order["command"]["payload"]["checkpoint"] == before_job["checkpoint"]
    assert restored.product_jobs()[0]["attempts"] == int(before_job["attempts"]) + 1
    assert restored.product_job_context(job_id)["payload"] == before_job["payload"]


def test_factory_heartbeat_timeout_rolls_back_when_product_persistence_fails(
    tmp_path: Path,
) -> None:
    now = [10.0]
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(
        state_path=state_path,
        session_timeout_seconds=5.0,
        clock=lambda: now[0],
    )
    bridge.hello(_hello())
    queued, _, current_order = _claim_checkpointed_product(bridge, suffix="timeout-write-failure")
    job_id = str(queued["jobId"])
    before_bytes = state_path.read_bytes()
    before_events = bridge.events_after("0")
    before_job = _durable_product_job(state_path, job_id)
    now[0] = 16.0

    with patch.object(
        bridge,
        "_persist_product_jobs_locked",
        side_effect=FactorySyncError("factory_product_state_write_failed"),
    ):
        try:
            bridge.current_state()
        except FactorySyncError as error:
            assert error.code == "factory_product_state_write_failed"
        else:
            raise AssertionError("timeout persistence failure must reject the whole transition")

    now[0] = 10.0
    assert bridge.current_state()["connected"] is True
    assert bridge._executions[str(current_order["orderId"])].status == "running"
    assert bridge._product_jobs[job_id].status == "running"
    assert bridge._product_jobs[job_id].current_order_id == current_order["orderId"]
    assert bridge.events_after("0") == before_events
    assert state_path.read_bytes() == before_bytes
    assert _durable_product_job(state_path, job_id) == before_job


def test_replacement_hello_requeues_inflight_product_without_reducing_a() -> None:
    now = [10.0]
    bridge = FactorySyncBridge(session_timeout_seconds=5.0, clock=lambda: now[0])
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload(suffix="replacement-characterization"))
    old_worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    old_order = bridge.claim(old_worker)["order"]
    bridge.lifecycle(
        old_order["orderId"],
        "ack",
        {
            **old_order,
            "workerId": old_worker["workerId"],
            "accepted": True,
            "eventSequence": 1,
        },
    )
    bridge.lifecycle(
        old_order["orderId"],
        "events",
        {**old_order, "workerId": old_worker["workerId"], "eventSequence": 2},
    )
    before = bridge.product_job_context(queued["jobId"])
    before_attempts = bridge.product_jobs()[0]["attempts"]
    before_cursor = bridge.events_after("0")[-1]["eventId"]
    replacement_projection = _product_projection(queued["jobId"], sequence=8, revision=10)
    replacement = _hello(session_id="factory-session-replacement")
    replacement.update(
        {
            "workerId": "factory-worker-replacement",
            "buildId": "build-replacement",
            "startedAt": 1001,
            "projection": replacement_projection,
        }
    )

    bridge.hello(replacement)

    after = bridge.product_job_context(queued["jobId"])
    new_worker = {
        **_worker(),
        "workerId": "factory-worker-replacement",
        "sessionId": "factory-session-replacement",
    }
    rebound_order = bridge.claim(new_worker)["order"]
    assert after["payload"] == before["payload"]
    assert bridge.product_jobs()[0]["attempts"] == before_attempts + 1
    assert rebound_order["orderId"] != old_order["orderId"]
    assert rebound_order["command"]["payload"]["jobId"] == queued["jobId"]
    assert [event["type"] for event in bridge.events_after(before_cursor)] == [
        "factory.product.updated",
        "factory.snapshot",
        "factory.product.updated",
    ]


def test_replacement_hello_restores_checkpoint_before_startup_projection_hydrates() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued, _, old_order = _claim_checkpointed_product(
        bridge,
        suffix="replacement-checkpoint",
    )
    checkpoint = bridge._product_jobs[str(queued["jobId"])].checkpoint

    replacement = _hello(session_id="factory-session-replacement")
    replacement.update(
        {
            "workerId": "factory-worker-replacement",
            "buildId": "build-replacement",
            "startedAt": 1001,
            "projection": _live_projection(sequence=9, revision=11),
        }
    )
    bridge.hello(replacement)

    recovered = bridge.claim(
        {
            **_worker(),
            "workerId": "factory-worker-replacement",
            "sessionId": "factory-session-replacement",
        }
    )["order"]
    assert recovered["orderId"] != old_order["orderId"]
    assert recovered["command"]["payload"]["startFresh"] is False
    assert recovered["command"]["payload"]["restoreOnly"] is True
    assert recovered["command"]["payload"]["checkpoint"] == checkpoint


def test_factory_product_queue_recovers_inflight_order_after_worker_restart() -> None:
    now = [10.0]
    bridge = FactorySyncBridge(session_timeout_seconds=5.0, clock=lambda: now[0])
    bridge.hello(_hello())
    first = bridge.queue_product(_manual_product_job_payload(suffix="restart-a"))
    second = bridge.queue_product(_manual_product_job_payload(suffix="restart-b"))
    old_worker = {
        **_worker(),
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
    }
    old_order = bridge.claim(old_worker)["order"]
    bridge.lifecycle(
        old_order["orderId"],
        "ack",
        {
            **old_order,
            "workerId": old_worker["workerId"],
            "accepted": True,
            "eventSequence": 1,
        },
    )

    restored_projection = _live_projection(sequence=8, revision=10)
    restored_projection["registration"] = {
        "status": "blocked",
        "blockers": ["final_detail_a_cut"],
        "jobId": first["jobId"],
    }
    now[0] = 16.0
    try:
        bridge.hello(_hello(cursor=2))
    except FactorySyncError as error:
        assert error.code == "stale_factory_session"
    else:
        raise AssertionError("expired worker session must not revive through hello")
    try:
        bridge.hello(_hello(session_id="factory-session-not-newer", cursor=2))
    except FactorySyncError as error:
        assert error.code == "stale_factory_session"
    else:
        raise AssertionError("replacement session must have a newer start time")
    assert bridge.current_state()["reason"] == "factory_heartbeat_timeout"
    timed_out_first = next(job for job in bridge.product_jobs() if job["jobId"] == first["jobId"])
    assert timed_out_first["status"] == "blocked"
    bridge.resume_product(first["jobId"])
    replacement = _hello(session_id="factory-session-restarted")
    replacement.update(
        {
            "workerId": "factory-worker-next-build",
            "buildId": "build-next",
            "startedAt": 1001,
            "projection": restored_projection,
        }
    )
    bridge.hello(replacement)

    try:
        bridge.lifecycle(
            old_order["orderId"],
            "events",
            {**old_order, "workerId": old_worker["workerId"], "eventSequence": 2},
        )
    except FactorySyncError as error:
        assert error.code == "stale_factory_session"
    else:
        raise AssertionError("replaced worker order must stay fenced")

    new_worker = {
        **_worker(),
        "workerId": "factory-worker-next-build",
        "sessionId": "factory-session-restarted",
    }
    recovered_order = bridge.claim(new_worker)["order"]
    assert recovered_order["orderId"] != old_order["orderId"]
    assert recovered_order["command"]["payload"]["jobId"] == first["jobId"]
    assert recovered_order["command"]["payload"]["startFresh"] is False
    assert recovered_order["targetWorkerId"] == new_worker["workerId"]
    bridge.lifecycle(
        recovered_order["orderId"],
        "ack",
        {
            **recovered_order,
            "workerId": new_worker["workerId"],
            "accepted": True,
            "eventSequence": 1,
        },
    )
    completed_projection = _product_projection(first["jobId"], sequence=9, revision=11)
    completed_receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": first["jobId"],
        "status": "completed",
        "stageKey": "",
        "message": "Cafe24 사전점검 준비 완료",
        "projection": completed_projection,
        "checkpoint": _product_checkpoint(
            first["jobId"],
            completed_projection,
            status="completed",
            stage_key="",
        ),
    }
    completed = {
        **recovered_order,
        "workerId": new_worker["workerId"],
        "eventSequence": 2,
        "result": completed_receipt,
    }
    bridge.lifecycle(recovered_order["orderId"], "events", completed)
    bridge.lifecycle(recovered_order["orderId"], "complete", completed)

    next_order = bridge.claim(new_worker)["order"]
    assert next_order["command"]["payload"]["jobId"] == second["jobId"]
    assert [job["status"] for job in bridge.product_jobs()] == ["completed", "running"]


def test_local_factory_product_selection_does_not_require_a_pdp_bundle() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload())
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}
    order = bridge.claim(worker)["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    projection = _product_projection(queued["jobId"], sequence=8, revision=10)
    projection["stages"][0]["selectedIds"] = []
    projection["stages"][0]["candidates"][0]["digest"] = "sha256:representative-a"
    projection["stages"][0]["candidates"][1]["digest"] = "sha256:representative-b"
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": queued["jobId"],
        "status": "waiting_manual",
        "stageKey": "representative",
        "message": "대표이미지 선택 대기",
        "projection": projection,
        "checkpoint": _product_checkpoint(
            queued["jobId"],
            projection,
            status="waiting_manual",
            stage_key="representative",
        ),
    }
    completed = {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": receipt}
    bridge.lifecycle(order["orderId"], "events", completed)
    bridge.lifecycle(order["orderId"], "complete", completed)
    held = bridge.hold_product_decision(queued["jobId"], "representative")
    assert held["decisionStatus"] == "manual_required"
    assert held["message"] == "GPT 자동판단 보류 · 수동 선택 필요"

    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    selected = client.post(
        f"/api/factory/jobs/{queued['jobId']}/select",
        json={
            "decisionMode": "manual",
            "productId": projection["session"]["productId"],
            "productKey": projection["session"]["productKey"],
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 10,
            "expectedRunId": projection["session"]["runId"],
            "expectedInputFingerprint": projection["session"]["inputFingerprint"],
            "idempotencyKey": "local-product-select-b",
        },
        headers=headers,
    )

    assert selected.status_code == 202
    assert selected.get_json()["selectionStatus"] == "saving"
    assert selected.get_json()["order"]["command"]["name"] == "selectFactoryACut"


def test_completed_factory_product_allows_explicit_manual_candidate_correction() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    queued = bridge.queue_product(_manual_product_job_payload())
    worker = {**_worker(), "workerId": "factory-worker-live", "sessionId": "factory-session-live"}
    order = bridge.claim(worker)["order"]
    bridge.lifecycle(
        order["orderId"],
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    projection = _product_projection(queued["jobId"], sequence=8, revision=10)
    projection["stages"][0]["selectedIds"] = ["representative-a"]
    receipt = {
        "schema": "factory-product-run-receipt:v1",
        "jobId": queued["jobId"],
        "status": "completed",
        "stageKey": "",
        "message": "Cafe24 사전점검 준비 완료",
        "projection": projection,
        "checkpoint": _product_checkpoint(
            queued["jobId"],
            projection,
            status="completed",
            stage_key="",
        ),
    }
    completed = {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": receipt}
    bridge.lifecycle(order["orderId"], "events", completed)
    bridge.lifecycle(order["orderId"], "complete", completed)

    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    response = client.post(
        f"/api/factory/jobs/{queued['jobId']}/select",
        json={
            "decisionMode": "manual",
            "productId": projection["session"]["productId"],
            "productKey": projection["session"]["productKey"],
            "stageKey": "representative",
            "candidateId": "representative-b",
            "expectedRevision": 10,
            "expectedRunId": projection["session"]["runId"],
            "expectedInputFingerprint": projection["session"]["inputFingerprint"],
            "idempotencyKey": "completed-product-correction-b",
        },
        headers={
            "X-Control-Tower-CSRF": session["csrfToken"],
            "X-Control-Tower-Session": session["sessionId"],
        },
    )

    assert response.status_code == 202
    assert response.get_json()["selectionStatus"] == "saving"
    assert response.get_json()["order"]["command"]["name"] == "selectFactoryACut"
def test_workfile_fork_creates_distinct_job_only_after_exact_hydration_receipt(tmp_path: Path) -> None:
    state_path = tmp_path / "fork-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    hello = cast(JsonObject, deepcopy(_hello()))
    hello["projection"] = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 1,
        "cursor": "1",
        "connected": False,
        "session": {"revision": 0},
        "inputs": [],
        "stages": [],
        "progress": {},
        "registration": {},
    }
    bridge.hello(hello)
    workfile_text = '{"format":"kuasangse.factory.project","version":1}\n'
    workfile_sha = sha256(workfile_text.encode("utf-8")).hexdigest()
    request: JsonObject = {
        "fileName": "fork.kuasangse",
        "workfileText": workfile_text,
        "expectedSha256": workfile_sha,
        "expectedWorkspaceId": "workspace-fork",
        "expectedProductId": "product-fork",
        "expectedProductKey": "product-key-fork",
        "expectedRunId": "run-fork",
        "expectedInputFingerprint": "fingerprint-fork",
        "expectedWorkfileRevision": 0,
        "expectedHydratedWorkfileRevision": 87,
        "batchId": "batch-fork",
        "mode": "manual",
        "productName": "파일 포크 제품",
        "requiredValues": {},
        "idempotencyKey": f"factory-workfile-fork:{workfile_sha}:87:manual",
    }

    queued = bridge.queue_product_from_workfile(request)
    duplicate = bridge.queue_product_from_workfile(request)

    assert queued["status"] == "hydrating"
    assert duplicate["orderId"] == queued["orderId"]
    assert bridge.product_jobs() == []
    assert not state_path.exists()
    worker: JsonObject = {
        "workerId": "factory-worker-live",
        "contractVersion": "control-work-order:v1",
        "capabilityVersion": "batch-control-worker:v1",
        "sessionId": "factory-session-live",
    }
    claimed = bridge.claim(worker)
    order = claimed["order"]
    assert isinstance(order, dict)
    order_id = order.get("orderId")
    assert isinstance(order_id, str)
    command = order.get("command")
    assert isinstance(command, dict)
    assert command["name"] == "hydrateFactoryWorkfile"
    _ = bridge.lifecycle(
        order_id,
        "ack",
        {**order, "workerId": worker["workerId"], "accepted": True, "eventSequence": 1},
    )
    hydrated: JsonObject = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 2,
        "cursor": "2",
        "connected": True,
        "session": {
            "workspaceId": "workspace-fork",
            "productId": "product-fork",
            "productKey": "product-key-fork",
            "runId": "run-fork",
            "inputFingerprint": "fingerprint-fork",
            "revision": 91,
            "workfileName": "fork.kuasangse",
            "workfileSha256": workfile_sha,
            "workfileBytes": len(workfile_text.encode("utf-8")),
            "absolutePath": "C:/private/PROJECTION-SESSION-PATH-MARKER.kuasangse",
            "token": "PROJECTION-SESSION-TOKEN-MARKER",
        },
        "inputs": [{
            "key": "requirements",
            "count": 1,
            "items": [{
                "name": "소재 확인",
                "market": "manual",
                "price": "0",
                "selected": True,
                "analysisReady": False,
                "detailImageCount": 0,
                "rawBytes": "PROJECTION-INPUT-BYTES-MARKER",
                "unknownNested": {"path": "PROJECTION-INPUT-PATH-MARKER"},
            }],
            "missing": ["material"],
            "unknownArray": [{"base64": "PROJECTION-INPUT-BASE64-MARKER"}],
        }],
        "outputs": [{"id": "output-1"}],
        "stages": [{
            "key": "representative",
            "status": "waiting_manual",
            "candidates": [{
                "id": "candidate-1",
                "source": "hydrated",
                "model": "manual",
                "confidence": 1,
                "rationale": "보존된 후보",
                "receipt": {"token": "PROJECTION-CANDIDATE-TOKEN-MARKER"},
                "absolutePath": "C:/private/PROJECTION-CANDIDATE-PATH-MARKER.png",
                "unknownArray": [{"base64": "PROJECTION-CANDIDATE-BASE64-MARKER"}],
            }],
            "selectedIds": ["candidate-1"],
            "path": "PROJECTION-STAGE-PATH-MARKER",
        }],
        "progress": {
            "status": "waiting_manual",
            "stageKey": "required_fields",
            "percent": 20,
            "path": "PROJECTION-PROGRESS-PATH-MARKER",
        },
        "registration": {
            "status": "waiting_manual",
            "productKey": "product-key-fork",
            "token": "PROJECTION-REGISTRATION-TOKEN-MARKER",
            "unknownObject": {"rawBytes": "PROJECTION-REGISTRATION-BYTES-MARKER"},
        },
        "receipts": [{"receiptId": "receipt-safe", "unknownExtra": "PROJECTION-RECEIPT-EXTRA-MARKER"}],
        "products": [{
            "productId": "product-fork",
            "productKey": "product-key-fork",
            "progress": {"status": "waiting_manual", "base64": "PROJECTION-PRODUCT-BASE64-MARKER"},
            "path": "PROJECTION-PRODUCT-PATH-MARKER",
        }],
        "workfileText": "PROJECTION-TOP-WORKFILE-MARKER",
        "unknownArray": [{"absolutePath": "PROJECTION-TOP-PATH-MARKER"}],
    }
    result: JsonObject = {
        "schema": "factory-workfile-hydration-receipt:v1",
        "capabilityVersion": "factory-workfile-hydration-command:v1",
        "fileName": "fork.kuasangse",
        "workfileSha256": workfile_sha,
        "projectId": "workspace-fork",
        "name": "product-key-fork",
        "projection": hydrated,
        "workfileText": "RAW-WORKFILE-MARKER",
        "filePath": "C:/private/RAW-PATH-MARKER.kuasangse",
        "absolutePath": "C:/private/RAW-ABSOLUTE-MARKER.kuasangse",
        "rawBytes": "RAW-BYTES-MARKER",
        "base64": "RAW-BASE64-MARKER",
        "token": "RAW-TOKEN-MARKER",
        "unknownExtra": {"nested": "RAW-NESTED-MARKER"},
    }
    _ = bridge.lifecycle(
        order_id,
        "complete",
        {**order, "workerId": worker["workerId"], "eventSequence": 2, "result": result},
    )

    hydration_event = next(
        event for event in bridge.events_after("0") if event["type"] == "factory.workfile.hydrated"
    )
    expected_public_receipt = {
        "schema": "factory-workfile-hydration-receipt:v1",
        "capabilityVersion": "factory-workfile-hydration-command:v1",
        "fileName": "fork.kuasangse",
        "workfileSha256": workfile_sha,
        "projectId": "workspace-fork",
        "name": "product-key-fork",
    }
    assert hydration_event["receipt"] == expected_public_receipt
    stored_json = json.dumps(hydration_event, ensure_ascii=False)
    for marker in (
        "RAW-WORKFILE-MARKER",
        "RAW-PATH-MARKER",
        "RAW-ABSOLUTE-MARKER",
        "RAW-BYTES-MARKER",
        "RAW-BASE64-MARKER",
        "RAW-TOKEN-MARKER",
        "RAW-NESTED-MARKER",
        "PROJECTION-SESSION-PATH-MARKER",
        "PROJECTION-SESSION-TOKEN-MARKER",
        "PROJECTION-INPUT-BYTES-MARKER",
        "PROJECTION-INPUT-PATH-MARKER",
        "PROJECTION-INPUT-BASE64-MARKER",
        "PROJECTION-CANDIDATE-TOKEN-MARKER",
        "PROJECTION-CANDIDATE-PATH-MARKER",
        "PROJECTION-CANDIDATE-BASE64-MARKER",
        "PROJECTION-STAGE-PATH-MARKER",
        "PROJECTION-PROGRESS-PATH-MARKER",
        "PROJECTION-REGISTRATION-TOKEN-MARKER",
        "PROJECTION-REGISTRATION-BYTES-MARKER",
        "PROJECTION-RECEIPT-EXTRA-MARKER",
        "PROJECTION-PRODUCT-BASE64-MARKER",
        "PROJECTION-PRODUCT-PATH-MARKER",
        "PROJECTION-TOP-WORKFILE-MARKER",
        "PROJECTION-TOP-PATH-MARKER",
    ):
        assert marker not in stored_json
    public_projection = hydration_event["projection"]
    assert isinstance(public_projection, dict)
    assert set(public_projection) == {
        "schema", "capabilityVersion", "cursor", "sequence", "connected", "status",
        "reason", "capturedAt", "session", "inputs", "stages", "progress",
        "registration", "receipts", "products",
    }
    assert set(public_projection["session"]) == {
        "workspaceId", "productId", "productKey", "runId", "inputFingerprint",
        "revision", "workfileName", "workfileSha256", "workfileBytes",
    }
    assert public_projection["inputs"] == [{
        "key": "requirements",
        "count": 1,
        "missing": ["material"],
        "items": [{
            "name": "소재 확인",
            "market": "manual",
            "price": "0",
            "thumbnailUrl": "",
            "selected": True,
            "analysisReady": False,
            "detailImageCount": 0,
        }],
    }]
    assert public_projection["stages"][0]["selectedId"] == "candidate-1"
    assert set(public_projection["stages"][0]) == {
        "key", "status", "selectedId", "updatedAt", "candidates",
    }
    public_candidate = public_projection["stages"][0]["candidates"][0]
    assert set(public_candidate) == {
        "id", "assetId", "thumbnailUrl", "digest", "source", "model",
        "confidence", "rationale", "receipt",
    }
    assert public_candidate["receipt"] == {}
    assert public_projection["registration"] == {
        "status": "waiting_manual",
        "productKey": "product-key-fork",
    }
    assert public_projection["receipts"] == [{"receiptId": "receipt-safe"}]
    assert public_projection["products"] == [{
        "productId": "product-fork",
        "productKey": "product-key-fork",
        "progress": {
            "status": "waiting_manual",
            "stageKey": "",
            "stageLabel": "",
            "percent": 0,
            "elapsedMs": 0,
            "mode": "",
            "message": "",
        },
    }]
    assert bridge._projection == hydrated

    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    _ = client.get("/api/session")
    response = client.get("/api/factory/events?cursor=0", buffered=False)
    chunk = ""
    for chunk_bytes in response.response:
        assert isinstance(chunk_bytes, bytes)
        candidate_chunk = chunk_bytes.decode("utf-8")
        if "factory.workfile.hydrated" in candidate_chunk:
            chunk = candidate_chunk
            break
    response.close()
    assert chunk
    data_line = next(line[6:] for line in chunk.splitlines() if line.startswith("data: "))
    public_event = cast(JsonObject, json.loads(data_line))
    assert response.status_code == 200
    assert public_event["receipt"] == expected_public_receipt
    assert public_event["projection"] == public_projection
    public_json = json.dumps(public_event, ensure_ascii=False)
    assert all(marker not in public_json for marker in (
        "RAW-WORKFILE-MARKER",
        "RAW-PATH-MARKER",
        "RAW-ABSOLUTE-MARKER",
        "RAW-BYTES-MARKER",
        "RAW-BASE64-MARKER",
        "RAW-TOKEN-MARKER",
        "RAW-NESTED-MARKER",
        "PROJECTION-SESSION-PATH-MARKER",
        "PROJECTION-SESSION-TOKEN-MARKER",
        "PROJECTION-INPUT-BYTES-MARKER",
        "PROJECTION-INPUT-PATH-MARKER",
        "PROJECTION-INPUT-BASE64-MARKER",
        "PROJECTION-CANDIDATE-TOKEN-MARKER",
        "PROJECTION-CANDIDATE-PATH-MARKER",
        "PROJECTION-CANDIDATE-BASE64-MARKER",
        "PROJECTION-STAGE-PATH-MARKER",
        "PROJECTION-PROGRESS-PATH-MARKER",
        "PROJECTION-REGISTRATION-TOKEN-MARKER",
        "PROJECTION-REGISTRATION-BYTES-MARKER",
        "PROJECTION-RECEIPT-EXTRA-MARKER",
        "PROJECTION-PRODUCT-BASE64-MARKER",
        "PROJECTION-PRODUCT-PATH-MARKER",
        "PROJECTION-TOP-WORKFILE-MARKER",
        "PROJECTION-TOP-PATH-MARKER",
    ))
    forbidden_keys = {
        "workfileText", "path", "absolutePath", "rawBytes", "base64", "token",
        "unknownArray", "unknownNested", "unknownObject", "unknownExtra", "outputs",
    }
    assert all(f'"{key}"' not in stored_json for key in forbidden_keys)
    assert all(f'"{key}"' not in public_json for key in forbidden_keys)

    jobs = bridge.product_jobs()
    assert len(jobs) == 1
    assert jobs[0]["jobId"] != "run-fork"
    assert jobs[0]["sourceKind"] == "workfile"
    assert jobs[0]["sourceSha256"] == workfile_sha
    assert "workfileText" not in json.dumps(jobs, ensure_ascii=False)
    assert "workfileText" not in state_path.read_text(encoding="utf-8")
    assert bridge.queue_product_from_workfile(request)["status"] == "hydrating"
    try:
        bridge.queue_product_from_workfile({**request, "productName": "다른 제품"})
    except FactorySyncError as error:
        assert error.code == "idempotency_conflict"
    else:
        raise AssertionError("divergent duplicate must conflict")
    run_order = bridge.claim(worker)["order"]
    assert isinstance(run_order, dict)
    run_command = run_order.get("command")
    assert isinstance(run_command, dict)
    run_payload = run_command.get("payload")
    assert isinstance(run_payload, dict)
    assert run_command["name"] == "runFactoryProduct"
    assert run_payload["startFresh"] is False
    assert run_payload["adoptHydratedWorkfile"] is True
    assert run_payload["source"]["revision"] == 87
    assert run_payload["hydratedRevision"] == 91


def test_workfile_fork_restart_before_receipt_and_foreign_live_state_mutate_nothing(tmp_path: Path) -> None:
    state_path = tmp_path / "fork-restart.json"
    bridge = FactorySyncBridge(state_path=state_path)
    hello = cast(JsonObject, deepcopy(_hello()))
    hello["projection"] = {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 1,
        "cursor": "1",
        "connected": False,
        "session": {"revision": 0},
        "inputs": [],
        "stages": [],
        "progress": {},
        "registration": {},
    }
    bridge.hello(hello)
    workfile_text = '{"format":"kuasangse.factory.project","version":1}\n'
    workfile_sha = sha256(workfile_text.encode("utf-8")).hexdigest()
    request: JsonObject = {
        "fileName": "restart.kuasangse",
        "workfileText": workfile_text,
        "expectedSha256": workfile_sha,
        "expectedWorkspaceId": "workspace-fork",
        "expectedProductId": "product-fork",
        "expectedProductKey": "product-key-fork",
        "expectedRunId": "run-fork",
        "expectedInputFingerprint": "fingerprint-fork",
        "expectedWorkfileRevision": 0,
        "expectedHydratedWorkfileRevision": 87,
        "batchId": "batch-fork",
        "mode": "manual",
        "productName": "재시작 포크 제품",
        "requiredValues": {},
        "idempotencyKey": f"factory-workfile-fork:{workfile_sha}:87:manual",
    }
    bridge.queue_product_from_workfile(request)
    assert FactorySyncBridge(state_path=state_path).product_jobs() == []

    foreign = FactorySyncBridge()
    foreign.hello(cast(JsonObject, deepcopy(_hello())))
    before_jobs = foreign.product_jobs()
    before_projection = foreign.current_state()
    try:
        foreign.queue_product_from_workfile({**request, "expectedWorkfileRevision": 4})
    except FactorySyncError as error:
        assert error.code == "factory_workfile_fork_foreign_live_job"
    else:
        raise AssertionError("foreign live state must refuse workfile fork")
    assert foreign.product_jobs() == before_jobs
    assert foreign.current_state() == before_projection
