from __future__ import annotations

import pytest

from control_tower.backend.pdp_client import PdpControlHttpApi, PdpHttpError
from control_tower.backend.runtime_cache import JsonObject, JsonValue


class FakeResponse:
    def __init__(self, status_code: int, payload: JsonObject) -> None:
        self.status_code = status_code
        self._payload = payload

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self) -> JsonObject:
        return self._payload


def test_pdp_client_keeps_service_key_server_side_and_uses_versioned_paths() -> None:
    # Given: 서버에만 존재하는 서비스 키와 요청 기록기를 준비한다.
    calls: list[JsonObject] = []

    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        calls.append({"method": method, "url": url, **kwargs})
        return FakeResponse(200, {"capabilityVersion": "1.1.0"})

    client = PdpControlHttpApi("http://127.0.0.1:8200/api/pdp-control/v1", "server-only-key", request_fn=request)

    # When: capability를 조회한다.
    result = client.get_capabilities()

    # Then: key는 요청 header에만 있고 결과에는 없어야 한다.
    assert result == {"capabilityVersion": "1.1.0"}
    assert calls[0]["method"] == "GET"
    assert calls[0]["url"] == "http://127.0.0.1:8200/api/pdp-control/v1/capabilities"
    assert calls[0]["headers"] == {"Accept": "application/json", "X-PDP-Control-Service-Key": "server-only-key"}
    assert "server-only-key" not in str(result)


def test_pdp_client_maps_stale_remote_version_to_typed_error() -> None:
    # Given: 신화사 API가 stale_version을 반환하는 transport를 준비한다.
    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        return FakeResponse(409, {"error": {"code": "stale_version", "message": "stale"}})

    client = PdpControlHttpApi("http://127.0.0.1:8200/api/pdp-control/v1", "server-only-key", request_fn=request)

    # When/Then: typed PdpHttpError로 충돌을 노출해야 한다.
    with pytest.raises(PdpHttpError, match="stale_version"):
        client.create_job({"inputSnapshotId": "snapshot-001"})


def test_pdp_client_rejects_missing_key_without_network_call() -> None:
    # Given: 비어 있는 서비스 키와 호출되면 실패하는 transport를 준비한다.
    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        raise AssertionError("network must not be called")

    client = PdpControlHttpApi("http://127.0.0.1:8200/api/pdp-control/v1", "", request_fn=request)

    # When/Then: 인증 설정이 없으면 외부 차단 오류여야 한다.
    with pytest.raises(PdpHttpError, match="pdp_auth_missing"):
        client.get_capabilities()


def test_pdp_client_encodes_product_source_search_and_readiness_queries() -> None:
    calls: list[JsonObject] = []

    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        calls.append({"method": method, "url": url, **kwargs})
        return FakeResponse(200, {"sources": [], "inputKinds": ["manual", "db-selection"]})

    client = PdpControlHttpApi(
        "http://127.0.0.1:8200/api/pdp-control/v1",
        "server-only-key",
        request_fn=request,
    )

    client.list_sources({"q": "컵 & 접시"})
    client.get_readiness(900001)

    assert calls[0]["url"] == (
        "http://127.0.0.1:8200/api/pdp-control/v1/sources?"
        "q=%EC%BB%B5+%26+%EC%A0%91%EC%8B%9C"
    )
    assert calls[1]["url"] == (
        "http://127.0.0.1:8200/api/pdp-control/v1/readiness?jcode=900001"
    )


def test_pdp_client_uses_current_publication_receipt_and_event_paths() -> None:
    calls: list[JsonObject] = []

    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        calls.append({"method": method, "url": url, **kwargs})
        if method == "POST" or "publication-receipts?" in url:
            return FakeResponse(
                200,
                {
                    "jobId": "job-1",
                    "receiptId": "receipt-1",
                    "payloadDigest": "payload-1",
                    "observedPayloadDigest": "remote-1",
                    "replayed": False,
                },
            )
        return FakeResponse(200, {"jobId": "job-1", "events": []})

    client = PdpControlHttpApi(
        "http://127.0.0.1:8200/api/pdp-control/v1",
        "server-only-key",
        request_fn=request,
    )
    payload = {
        "target": "cafe24",
        "targetKey": "cafe24:2994",
        "payloadDigest": "payload-1",
        "remoteId": "2994",
        "observedPayloadDigest": "remote-1",
        "idempotencyKey": "idem-1",
        "actor": "production-control-tower",
    }

    client.create_publication_receipt("job-1", payload)
    client.get_publication_receipt("job-1", "idem:한글 & replay")
    client.get_publication_events("job-1")

    assert [(call["method"], call["url"]) for call in calls] == [
        ("POST", "http://127.0.0.1:8200/api/pdp-control/v1/jobs/job-1/publication-receipts"),
        (
            "GET",
            "http://127.0.0.1:8200/api/pdp-control/v1/jobs/job-1/publication-receipts"
            "?idempotencyKey=idem%3A%ED%95%9C%EA%B8%80+%26+replay",
        ),
        ("GET", "http://127.0.0.1:8200/api/pdp-control/v1/jobs/job-1/publication-events"),
    ]
    assert calls[0]["json"] == payload
