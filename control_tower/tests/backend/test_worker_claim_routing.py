from __future__ import annotations

from pathlib import Path

from flask import Flask
import pytest

from control_tower.backend.factory_sync import FactorySyncBridge
from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.routes import register_routes
from control_tower.backend.runtime_cache import JsonObject


BATCH_WORKER_CLAIM: JsonObject = {
    "workerId": "factory-worker-test",
    "sessionId": "factory-session-test",
    "contractVersion": "control-work-order:v1",
    "capabilityVersion": "batch-control-worker:v1",
}


class RemoteClaimStub:
    def __init__(self, result: JsonObject | None = None, error: PdpHttpError | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[JsonObject] = []

    def worker_claim(self, payload: JsonObject) -> JsonObject:
        self.calls.append(payload)
        if self.error is not None:
            raise self.error
        return self.result or {"claimed": False, "order": None}


class GenericFallbackFactorySync(FactorySyncBridge):
    def has_pending(self) -> bool:
        raise AssertionError("generic worker must not inspect the batch queue")


def _client(
    tmp_path: Path,
    remote: RemoteClaimStub,
    factory_sync: FactorySyncBridge | None = None,
):
    app = Flask(__name__)
    register_routes(
        app,
        pdp_api=remote,
        factory_sync_bridge=factory_sync or FactorySyncBridge(state_path=tmp_path / "factory-jobs.json"),
    )
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    return client, headers


def test_idle_batch_worker_claim_stops_before_generic_remote_fallback(tmp_path: Path) -> None:
    # Given: 로컬 factory/bridge 큐가 비어 있고 PDP의 generic claim은 batch payload를 거부한다.
    remote = RemoteClaimStub(error=PdpHttpError("pdp_request_invalid", 422))
    client, headers = _client(tmp_path, remote)

    # When: batch-control worker가 다음 작업을 요청한다.
    response = client.post("/api/worker/claim", json=BATCH_WORKER_CLAIM, headers=headers)

    # Then: 빈 로컬 큐는 정상 idle이고 외부 generic queue로 넘기지 않는다.
    assert response.status_code == 200
    assert response.get_json() == {"claimed": False, "order": None}
    assert remote.calls == []


@pytest.mark.parametrize("capability_version", ["unsupported-capability:v9", None])
def test_batch_contract_with_unsupported_capability_returns_422(
    tmp_path: Path,
    capability_version: str | None,
) -> None:
    # Given: exact batch contract와 지원하지 않는 capabilityVersion(또는 누락)을 준비한다.
    remote = RemoteClaimStub(result={"claimed": True, "order": {"orderId": "remote-order"}})
    client, headers = _client(tmp_path, remote)
    payload = {**BATCH_WORKER_CLAIM, "capabilityVersion": capability_version}
    if capability_version is None:
        payload.pop("capabilityVersion")

    # When: batch-control worker가 capability를 확인하지 않은 claim을 요청한다.
    response = client.post("/api/worker/claim", json=payload, headers=headers)

    # Then: generic remote fallback 대신 명시적인 capability 오류를 반환한다.
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "capability_version_unsupported"
    assert remote.calls == []


def test_generic_worker_claim_keeps_remote_fallback(tmp_path: Path) -> None:
    # Given: batch contract가 아닌 generic worker와 remote claim 응답을 준비한다.
    remote = RemoteClaimStub(result={"claimed": True, "order": {"orderId": "remote-order"}})
    client, headers = _client(tmp_path, remote)

    # When: generic worker가 작업을 요청한다.
    payload = {"workerId": "generic-worker"}
    response = client.post("/api/worker/claim", json=payload, headers=headers)

    # Then: 기존 remote fallback은 유지되고 HTTP payload에는 서버 세션만 추가된다.
    assert response.status_code == 200
    assert response.get_json() == {"claimed": True, "order": {"orderId": "remote-order"}}
    assert len(remote.calls) == 1
    assert remote.calls[0]["workerId"] == "generic-worker"
    assert remote.calls[0]["_httpSessionId"] == headers["X-Control-Tower-Session"]


def test_generic_worker_claim_keeps_remote_fallback_when_batch_queue_has_work(tmp_path: Path) -> None:
    # Given: batch 큐 조회를 generic worker가 건드리면 안 되는 상황과 remote 응답을 준비한다.
    remote = RemoteClaimStub(result={"claimed": True, "order": {"orderId": "remote-order"}})
    factory_sync = GenericFallbackFactorySync(state_path=tmp_path / "factory-jobs.json")
    client, headers = _client(tmp_path, remote, factory_sync)

    # When: generic worker가 작업을 요청한다.
    response = client.post("/api/worker/claim", json={"workerId": "generic-worker"}, headers=headers)

    # Then: local batch queue를 확인하지 않고 기존 remote fallback을 사용한다.
    assert response.status_code == 200
    assert response.get_json() == {"claimed": True, "order": {"orderId": "remote-order"}}
    assert len(remote.calls) == 1
