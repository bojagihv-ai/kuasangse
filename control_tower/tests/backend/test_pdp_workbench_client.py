from __future__ import annotations

from collections.abc import Mapping

import pytest

from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.pdp_workbench_client import PdpWorkbenchHttpApi
from control_tower.backend.runtime_cache import JsonObject, JsonValue


class FakeResponse:
    def __init__(
        self,
        status_code: int,
        payload: JsonValue,
        *,
        content: bytes = b"",
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = headers or {}

    def json(self) -> JsonValue:
        return self._payload


def test_workbench_client_routes_assets_and_control_contracts_with_server_auth() -> None:
    # Given: 신화사 두 API base와 transport 기록기를 준비한다.
    calls: list[JsonObject] = []

    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        calls.append({"method": method, "url": url, **kwargs})
        return FakeResponse(200, {"ok": True})

    client = PdpWorkbenchHttpApi(
        "http://assets/api/pdp-assets/v1",
        "http://control/api/pdp-control/v1",
        "server-only-key",
        request_fn=request,
    )

    # When: 제품·필드·자산 metadata와 배치·명령·검수·게시 계약을 호출한다.
    client.list_products({"q": "접시", "limit": 50})
    client.get_product(930001)
    client.get_product_fields(930001)
    client.get_product_assets(930001)
    client.create_batch({"jcodes": [930001]}, "batch-create")
    client.list_batches({"state": "RUNNING", "limit": 50})
    client.get_batch("batch-a")
    client.get_batch_items("batch-a")
    client.command_batch(
        "batch-a",
        {"command": "pause"},
        "batch-pause",
        4,
    )
    client.get_batch_events("batch-a", 7)
    client.decide_review(
        "review-a",
        {"decision": "approve", "rationale": "확인"},
        "review-approve",
        9,
    )
    client.create_publication(
        930001,
        {"target": "cafe24", "dryRun": True},
        "publication-dry-run",
    )

    # Then: 계약 경로·동시성 version header·키 비노출과 JSON metadata 경계가 보존되어야 한다.
    urls = [call["url"] for call in calls]
    assert urls == [
        "http://assets/api/pdp-assets/v1/products?q=%EC%A0%91%EC%8B%9C&limit=50",
        "http://assets/api/pdp-assets/v1/products/930001",
        "http://assets/api/pdp-assets/v1/products/930001/fields",
        "http://assets/api/pdp-assets/v1/products/930001/assets",
        "http://control/api/pdp-control/v1/production-batches",
        "http://control/api/pdp-control/v1/production-batches?state=RUNNING&limit=50",
        "http://control/api/pdp-control/v1/production-batches/batch-a",
        "http://control/api/pdp-control/v1/production-batches/batch-a/items",
        "http://control/api/pdp-control/v1/production-batches/batch-a/commands",
        "http://control/api/pdp-control/v1/production-batches/batch-a/events?after=7",
        "http://assets/api/pdp-assets/v1/reviews/review-a/decision",
        "http://assets/api/pdp-assets/v1/products/930001/publications",
    ]
    assert all(
        call["headers"]["X-PDP-Control-Service-Key"] == "server-only-key"
        for call in calls
    )
    assert calls[8]["headers"]["If-Match"] == "4"
    assert calls[8]["headers"]["Idempotency-Key"] == "batch-pause"
    assert calls[10]["headers"]["If-Match"] == "9"


def test_workbench_client_rejects_misleading_2xx_error_body() -> None:
    # Given: HTTP 200이지만 error envelope를 담은 신화사 응답을 준비한다.
    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        return FakeResponse(200, {"error": {"code": "stale_version"}})

    client = PdpWorkbenchHttpApi(
        "http://assets/api/pdp-assets/v1",
        "http://control/api/pdp-control/v1",
        "server-only-key",
        request_fn=request,
    )

    # When/Then: 성공으로 반환하지 않고 typed error로 승격해야 한다.
    with pytest.raises(PdpHttpError, match="stale_version") as captured:
        client.get_batch("batch-a")
    assert captured.value.status == 200


def test_workbench_client_rejects_missing_service_key_without_network() -> None:
    # Given: 비어 있는 서비스 키와 호출되면 실패하는 transport를 준비한다.
    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        raise AssertionError("network must not be called")

    client = PdpWorkbenchHttpApi(
        "http://assets/api/pdp-assets/v1",
        "http://control/api/pdp-control/v1",
        "",
        request_fn=request,
    )

    # When/Then: 브라우저 경로로 키를 보완하지 않고 서버 설정 오류를 낸다.
    with pytest.raises(PdpHttpError, match="pdp_auth_missing"):
        client.list_products({})


def test_workbench_client_lists_bundles_and_fetches_only_allowlisted_asset_bytes() -> None:
    calls: list[JsonObject] = []

    def request(method: str, url: str, **kwargs: JsonValue) -> FakeResponse:
        calls.append({"method": method, "url": url, **kwargs})
        if url.endswith("/thumbnail"):
            return FakeResponse(
                200,
                {},
                content=b"\xff\xd8\xfffixture",
                headers={
                    "Content-Type": "image/jpeg",
                    "Cache-Control": "private, max-age=600",
                },
            )
        return FakeResponse(200, {"items": []})

    client = PdpWorkbenchHttpApi(
        "http://assets/api/pdp-assets/v1",
        "http://control/api/pdp-control/v1",
        "server-only-key",
        request_fn=request,
    )

    client.list_work_bundles({"limit": 100})
    client.get_work_bundle("bundle-a")
    binary = client.get_work_bundle_asset(
        "/api/pdp-assets/v1/assets/asset-a/thumbnail",
    )

    assert [call["url"] for call in calls] == [
        "http://assets/api/pdp-assets/v1/work-bundles?limit=100",
        "http://assets/api/pdp-assets/v1/work-bundles/bundle-a",
        "http://assets/api/pdp-assets/v1/assets/asset-a/thumbnail",
    ]
    assert binary.content.startswith(b"\xff\xd8\xff")
    assert binary.content_type == "image/jpeg"
    assert binary.cache_control == "private, max-age=600"
    assert calls[-1]["headers"]["Accept"] == "image/*"
    for reference in (
        "https://evil.example/asset.jpg",
        "/api/pdp-assets/v1/%2e%2e/private",
        "/api/pdp-assets/v1/assets\\private",
    ):
        with pytest.raises(PdpHttpError, match="asset_reference_forbidden"):
            client.get_work_bundle_asset(reference)
    assert len(calls) == 3
