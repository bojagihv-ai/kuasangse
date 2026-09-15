from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

from flask import Flask
from flask.testing import FlaskClient
import pytest

from control_tower.backend.factory_sync import FactorySyncBridge
from control_tower.backend.routes import register_routes
from control_tower.backend.runtime_cache import JsonObject
from test_factory_sync import _hello, _manual_product_job_payload, _product_checkpoint
from test_parallel_production_board import _live_worker, _run_to_waiting_manual


@dataclass(frozen=True, slots=True)
class TabEnvironment:
    bridge: FactorySyncBridge
    client: FlaskClient
    headers: dict[str, str]
    job_id: str
    projection: JsonObject
    state_path: Path


@pytest.fixture
def tab_env(tmp_path: Path) -> TabEnvironment:
    state_path = tmp_path / "jobs.json"
    bridge = FactorySyncBridge(state_path=state_path, expected_build_id="build-live")
    bridge.hello(_hello())
    job_id = str(bridge.queue_product(_manual_product_job_payload(suffix="tab-command"))["jobId"])
    projection = _run_to_waiting_manual(
        bridge, bridge.claim(_live_worker())["order"], job_id, sequence=8,
    )
    projection["session"]["storeRevision"] = 20
    projection["storage"] = {"ok": True, "warning": ""}
    projection["sequence"] = 9
    projection["outputs"] = [{"id": "saved-output"}]
    bridge.accept_projection(projection)
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_routes(app, factory_sync_bridge=bridge)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    return TabEnvironment(
        bridge, client, {"X-Control-Tower-CSRF": session["csrfToken"]},
        job_id, projection, state_path,
    )


def tab_payload(env: TabEnvironment) -> JsonObject:
    session = env.projection["session"]
    return {
        "schema": "factory-tab-command:v1", "jobId": env.job_id,
        "tabId": "db", "action": "search", "value": {"query": "수저", "source": "all"},
        "expectedWorkspaceId": session["workspaceId"],
        "productId": session["productId"], "productKey": session["productKey"],
        "expectedRunId": session["runId"],
        "expectedInputFingerprint": session["inputFingerprint"],
        "expectedRevision": session["revision"],
        "expectedStoreRevision": session["storeRevision"],
        "idempotencyKey": "tab-search-once",
    }


def queue_tab(env: TabEnvironment, payload: JsonObject | None = None) -> JsonObject:
    response = env.client.post(
        f"/api/factory/jobs/{env.job_id}/tab-command",
        json=payload or tab_payload(env), headers=env.headers,
    )
    assert response.status_code == 202, response.get_json()
    body = response.get_json()
    assert body["accepted"] is True and body["status"] == "queued"
    order = env.client.post("/api/worker/claim", json=_live_worker(), headers=env.headers).get_json()["order"]
    assert order["orderId"] == body["orderId"]
    ack = env.client.post(
        f"/api/worker/{order['orderId']}/ack",
        json={**order, "workerId": "factory-worker-live", "accepted": True, "eventSequence": 1},
        headers=env.headers,
    )
    assert ack.status_code == 200, ack.get_json()
    return order


def tab_receipt(env: TabEnvironment, order: JsonObject) -> JsonObject:
    projection = deepcopy(env.projection)
    projection["sequence"] = 10
    projection["session"]["revision"] = 11
    projection["session"]["storeRevision"] = 21
    return {
        "schema": "factory-tab-command-receipt:v1", "jobId": env.job_id,
        "tabId": order["command"]["payload"]["tabId"],
        "action": order["command"]["payload"]["action"], "status": "applied",
        "projection": projection,
        "checkpoint": _product_checkpoint(
            env.job_id, projection, status="waiting_manual", stage_key="representative",
        ),
    }


def complete_tab(env: TabEnvironment, order: JsonObject, receipt: JsonObject):
    return env.client.post(
        f"/api/worker/{order['orderId']}/complete",
        json={**order, "workerId": "factory-worker-live", "eventSequence": 2, "result": receipt},
        headers=env.headers,
    )


def read_execution(env: TabEnvironment, order: JsonObject) -> JsonObject:
    response = env.client.get(f"/api/factory/jobs/{env.job_id}/tab-command/{order['orderId']}")
    assert response.status_code == 200
    return response.get_json()


def test_explicit_export_uses_tab_command_and_preserves_product(tab_env: TabEnvironment) -> None:
    before = tab_env.bridge.product_job_context(tab_env.job_id)
    payload = {**tab_payload(tab_env), "tabId": "workfile", "action": "export-current", "value": {}}
    order = queue_tab(tab_env, payload)
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["session"].update({
        "workfileSource": "browser-download-requested", "workfileName": "현재제품.kuasangse",
        "workfileBytes": 123, "workfileSha256": "a" * 64,
    })
    invalid = deepcopy(receipt)
    invalid["projection"]["session"]["workfileSource"] = "authoritative-store"
    assert complete_tab(tab_env, order, invalid).status_code in {409, 422}
    response = complete_tab(tab_env, order, receipt)
    assert response.status_code == 200, response.get_json()
    after = tab_env.bridge.product_job_context(tab_env.job_id)
    assert after["payload"] == before["payload"]
    assert after["job"]["status"] == before["job"]["status"]
    assert read_execution(tab_env, order)["receipt"]["projection"]["session"]["workfileSource"] == "browser-download-requested"


def test_export_rejects_blocked_job_and_caller_export_options(tab_env: TabEnvironment) -> None:
    payload = {**tab_payload(tab_env), "tabId": "workfile", "action": "export-current", "value": {}}
    invalid = {**payload, "value": {"saveAs": True}}
    url = f"/api/factory/jobs/{tab_env.job_id}/tab-command"
    assert tab_env.client.post(url, json=invalid, headers=tab_env.headers).status_code in {409, 422}
    tab_env.bridge._product_jobs[tab_env.job_id].status = "blocked"
    before = tab_env.bridge._mutable_state_snapshot_locked()
    response = tab_env.client.post(url, json=payload, headers=tab_env.headers)
    assert response.status_code == 409
    assert tab_env.bridge._mutable_state_snapshot_locked() == before


def test_tab_command_runs_then_restores_checkpoint_without_auto_resume(tab_env: TabEnvironment) -> None:
    # Given: 실제 Bridge에 저장된 선택 대기 작업.
    before = tab_env.bridge.product_job_context(tab_env.job_id)
    order = queue_tab(tab_env)
    assert order["command"] == {
        "kind": "factory-control", "version": "factory-control-command:v1",
        "name": "invokeFactoryTabCommand", "payload": tab_payload(tab_env),
    }
    running = tab_env.bridge.product_job_context(tab_env.job_id)["job"]
    assert running["status"] == "running" and running["stageKey"] == "representative"
    assert read_execution(tab_env, order)["status"] == "running"
    receipt = tab_receipt(tab_env, order)
    # When: 저장된 checkpoint를 가진 worker 영수증을 수락한다.
    response = complete_tab(tab_env, order, receipt)
    # Then: 완료 확인은 execution으로 하며 기존 공정은 자동 재개하지 않는다.
    assert response.status_code == 200, response.get_json()
    assert read_execution(tab_env, order) == {
        "jobId": tab_env.job_id, "orderId": order["orderId"],
        "status": "completed", "error": "", "receipt": receipt,
    }
    after = tab_env.bridge.product_job_context(tab_env.job_id)
    assert after["job"]["status"] == before["job"]["status"]
    assert after["job"]["stageKey"] == before["job"]["stageKey"]
    assert after["job"]["autoResumePending"] is False
    assert after["payload"] == before["payload"]
    assert after["checkpoint"] == receipt["checkpoint"]
    assert tab_env.bridge.has_pending() is False
    restored = FactorySyncBridge(state_path=tab_env.state_path)
    assert restored.product_job_context(tab_env.job_id)["checkpoint"] == receipt["checkpoint"]


def test_direct_select_passes_job_id_so_worker_can_return_checkpoint(tab_env: TabEnvironment) -> None:
    # Given: URL로 작업을 특정하는 기존 직접 A컷 선택 요청.
    payload = tab_payload(tab_env)
    payload.update(stageKey="representative", candidateId="representative-b", decisionMode="manual")
    # When: 실제 route를 거쳐 worker가 받는 명령을 읽는다.
    response = tab_env.client.post(
        f"/api/factory/jobs/{tab_env.job_id}/select", json=payload, headers=tab_env.headers,
    )
    assert response.status_code == 202, response.get_json()
    order = tab_env.bridge.claim(_live_worker())["order"]
    # Then: jobId가 있어야 worker가 해당 작업의 checkpoint를 생성할 수 있다.
    assert order["command"]["payload"]["jobId"] == tab_env.job_id
    tab_env.bridge.lifecycle(order["orderId"], "ack", {
        **order, "workerId": "factory-worker-live", "accepted": True, "eventSequence": 1,
    })
    receipt = tab_receipt(tab_env, {"command": {"payload": {"tabId": "db", "action": "search"}}})
    receipt.update(schema="factory-a-cut-receipt:v1", status="waiting_manual",
                   stageKey="representative", candidateId="representative-b")
    receipt["projection"]["stages"][0]["selectedIds"] = ["representative-b"]
    assert complete_tab(tab_env, order, receipt).status_code == 200
    assert tab_env.bridge.product_job_context(tab_env.job_id)["checkpoint"] == receipt["checkpoint"]
