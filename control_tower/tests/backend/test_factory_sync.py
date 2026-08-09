from __future__ import annotations

from hashlib import sha256
from flask import Flask

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError
from control_tower.backend.routes import register_routes


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
    }


def test_workfile_hydration_order_is_bound_to_current_worker_session_and_exact_digest() -> None:
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
            "projection": projection,
        }
    )
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


def test_verified_publication_receipt_updates_registration_once() -> None:
    bridge = FactorySyncBridge()
    projection = _live_projection()
    projection["registration"] = {
        "status": "blocked",
        "blockers": ["receipt_pending"],
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
