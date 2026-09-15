from __future__ import annotations

from pathlib import Path

from flask import Flask
from flask.testing import FlaskClient

from control_tower.backend.factory_sync import FactorySyncBridge
from control_tower.backend.human_presence import HumanPresenceStore
from control_tower.backend.routes import register_routes

from test_batch_selection_routes import _waiting_bridge


def _presence_payload() -> dict[str, str | int]:
    return {
        "presenceId": "human:project:alpha",
        "role": "human",
        "productName": "팔각자개상자",
        "workspaceId": "project:alpha",
        "stageKey": "detail",
        "stageLabel": "상세페이지",
        "message": "사이즈컷 3장 생성 중",
        "buildId": "build-human-presence-test",
        "sentAt": 1_788_742_321_223,
    }


def _client(
    bridge: FactorySyncBridge,
) -> tuple[FlaskClient, dict[str, str]]:
    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    return client, {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }


def test_presence_post_and_delete_require_csrf_and_are_idempotent() -> None:
    client, headers = _client(FactorySyncBridge())
    payload = _presence_payload()

    rejected_post = client.post("/api/factory/presence", json=payload)
    accepted_post = client.post("/api/factory/presence", json=payload, headers=headers)
    invalid_post = client.post(
        "/api/factory/presence",
        json={**payload, "role": "worker"},
        headers=headers,
    )
    listed = client.get("/api/factory/jobs")
    rejected_delete = client.delete(f"/api/factory/presence/{payload['presenceId']}")
    accepted_delete = client.delete(f"/api/factory/presence/{payload['presenceId']}", headers=headers)
    repeated_delete = client.delete(f"/api/factory/presence/{payload['presenceId']}", headers=headers)

    assert rejected_post.status_code == 428
    assert accepted_post.status_code == 200
    assert accepted_post.get_json() == {"ok": True, "expiresInMs": 45_000}
    assert invalid_post.status_code == 422
    assert listed.get_json()["humanPresences"] == [payload]
    assert rejected_delete.status_code == 428
    assert accepted_delete.status_code == 200
    assert repeated_delete.status_code == 200
    assert repeated_delete.get_json() == {"ok": True}


def test_presence_store_expires_after_45_seconds() -> None:
    now = [0.0]
    store = HumanPresenceStore(clock=lambda: now[0])
    payload = _presence_payload()

    store.upsert(payload)
    now[0] = 44.999
    before_expiry = store.active()
    now[0] = 45.0
    after_expiry = store.active()

    assert before_expiry == [payload]
    assert after_expiry == []


def test_presence_does_not_mutate_worker_or_selection_state(tmp_path: Path) -> None:
    bridge, job_ids = _waiting_bridge(tmp_path, 1)
    bridge.reserve_product_selection(
        job_ids[0],
        {"stageKey": "representative", "candidateId": "representative-b", "autoResume": False},
    )
    client, headers = _client(bridge)
    before_target = bridge.active_worker_target()
    before_state = bridge.current_state()
    before_jobs = bridge.product_jobs()
    before_events = bridge.events_after("0")
    before_reservation = before_jobs[0]["pendingSelection"]

    response = client.post("/api/factory/presence", json=_presence_payload(), headers=headers)
    after_jobs = bridge.product_jobs()

    assert response.status_code == 200
    assert bridge.active_worker_target() == before_target
    assert bridge.current_state() == before_state
    assert after_jobs == before_jobs
    assert bridge.events_after("0") == before_events
    assert after_jobs[0]["pendingSelection"] == before_reservation
