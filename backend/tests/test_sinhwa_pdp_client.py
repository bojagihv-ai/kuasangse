from __future__ import annotations

import pytest
from flask import Flask

from services.sinhwa_pdp_client import SinhwaPdpApiError, SinhwaPdpClient
from routes import api_core


class _Response:
    def __init__(self, status_code: int, payload: object) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> object:
        return self._payload


def test_context_client_reads_product_inputs_and_output_collections(monkeypatch) -> None:
    calls: list[tuple[str, str, dict[str, str]]] = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs.get("headers", {})))
        if url.endswith("/products/920001"):
            return _Response(200, {"catalog": {"jcode": 920001}, "workspace": {"version": 4}})
        if url.endswith("/fields"):
            return _Response(200, {"jcode": 920001, "version": 4, "fields": []})
        if url.endswith("/assets"):
            return _Response(200, {"items": [], "workspaceVersion": 4, "currentACutLinkId": None})
        if url.endswith(("/sections", "/compositions", "/runs", "/events")):
            return _Response(200, {"items": [], "nextCursor": None, "version": 4})
        raise AssertionError(url)

    monkeypatch.setattr("services.sinhwa_pdp_client.requests.request", fake_request)
    client = SinhwaPdpClient(base_url="http://127.0.0.1:8200/api/pdp-assets/v1", service_key="server-only")

    context = client.get_product_context(920001)

    assert context["product"]["catalog"]["jcode"] == 920001
    assert set(context) == {"product", "fields", "assets", "sections", "compositions", "runs", "events"}
    assert all(headers["X-PDP-Control-Service-Key"] == "server-only" for _, _, headers in calls)


def test_client_search_uses_pdp_catalog_endpoint(monkeypatch) -> None:
    calls: list[tuple[str, str, dict[str, object]]] = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _Response(200, {"items": [{"jcode": 920001}], "nextCursor": None})

    monkeypatch.setattr("services.sinhwa_pdp_client.requests.request", fake_request)
    client = SinhwaPdpClient(base_url="http://127.0.0.1:8200/api/pdp-assets/v1", service_key="server-only")

    page = client.search_products("수납", 8)

    assert page["items"][0]["jcode"] == 920001
    assert calls[0][0] == "GET"
    assert "q=%EC%88%98%EB%82%A9" in calls[0][1]


def test_client_preserves_remote_error_without_exposing_service_key(monkeypatch) -> None:
    def fake_request(*args, **kwargs):
        return _Response(409, {"error": {"code": "stale_version", "message": "stale"}})

    monkeypatch.setattr("services.sinhwa_pdp_client.requests.request", fake_request)
    client = SinhwaPdpClient(base_url="http://127.0.0.1:8200/api/pdp-assets/v1", service_key="server-only")

    with pytest.raises(SinhwaPdpApiError) as error:
        client.save_field(920001, {"fieldKey": "material", "state": "confirmed"}, "field:920001:material", 3)

    assert error.value.status == 409
    assert error.value.code == "stale_version"
    assert "server-only" not in str(error.value)


def test_client_rejects_missing_service_key_before_network(monkeypatch) -> None:
    def fail_if_called(*args, **kwargs):
        raise AssertionError("network must not be called")

    monkeypatch.setattr("services.sinhwa_pdp_client.requests.request", fail_if_called)
    client = SinhwaPdpClient(base_url="http://127.0.0.1:8200/api/pdp-assets/v1", service_key="")

    with pytest.raises(SinhwaPdpApiError) as error:
        client.get_product_context(920001)

    assert error.value.code == "service_key_missing"


def test_automation_backend_exposes_context_without_browser_service_key(monkeypatch) -> None:
    class FakeClient:
        def get_product_context(self, jcode: int) -> dict[str, object]:
            return {"product": {"catalog": {"jcode": jcode}}, "fields": {"fields": []}}

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().get("/api/sinhwa-pdp/products/920001/context")

    assert response.status_code == 200
    assert response.get_json()["product"]["catalog"]["jcode"] == 920001


def test_automation_backend_exposes_pdp_product_search(monkeypatch) -> None:
    class FakeClient:
        def search_products(self, query: str, limit: int) -> dict[str, object]:
            return {"items": [{"jcode": 920001, "name": query}], "limit": limit}

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().get("/api/sinhwa-pdp/products/search?q=%EC%88%98%EB%82%A9&limit=8")

    assert response.status_code == 200
    assert response.get_json()["items"][0]["jcode"] == 920001


def test_automation_sync_reports_authoritative_save_only_after_all_writes(monkeypatch) -> None:
    class FakeClient:
        def save_field(self, jcode, payload, idempotency_key, expected_version):
            return {"kind": "field", "jcode": jcode, "key": idempotency_key}

        def save_section(self, jcode, payload, idempotency_key):
            return {"kind": "section", "jcode": jcode, "key": idempotency_key}

        def save_composition(self, jcode, payload, idempotency_key):
            return {"kind": "composition", "jcode": jcode, "key": idempotency_key}

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().post(
        "/api/sinhwa-pdp/products/920001/sync",
        json={
            "idempotencyKey": "run:920001:1",
            "expectedVersion": 4,
            "field": {"fieldKey": "material", "state": "confirmed"},
            "sections": [{"payload": {"sectionKey": "hero"}}],
            "composition": {"payload": {"name": "v1"}},
        },
    )

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["authoritativeSaved"] is True
    assert len(payload["results"]) == 3


def test_automation_sync_keeps_local_fallback_when_remote_state_write_fails(monkeypatch) -> None:
    class FakeClient:
        def save_field(self, jcode, payload, idempotency_key, expected_version):
            return {"kind": "field", "jcode": jcode}

        def save_section(self, jcode, payload, idempotency_key):
            raise SinhwaPdpApiError("network_error")

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().post(
        "/api/sinhwa-pdp/products/920001/sync",
        json={
            "idempotencyKey": "run:920001:retry",
            "field": {"fieldKey": "material", "state": "confirmed"},
            "sections": [{"payload": {"sectionKey": "hero"}}],
        },
    )

    payload = response.get_json()
    assert response.status_code == 502
    assert payload["authoritativeSaved"] is False
    assert payload["localFallbackRequired"] is True
    assert len(payload["completed"]) == 1


def test_client_creates_work_bundle_with_server_only_credentials(monkeypatch) -> None:
    calls: list[tuple[str, str, dict[str, object]]] = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _Response(
            201,
            {
                "id": "bundle-1",
                "bundleKey": "kuasangse:workspace-1",
                "version": 1,
                "assets": [],
            },
        )

    monkeypatch.setattr(
        "services.sinhwa_pdp_client.requests.request",
        fake_request,
    )
    client = SinhwaPdpClient(
        base_url="http://127.0.0.1:8200/api/pdp-assets/v1",
        service_key="server-only",
    )

    result = client.create_work_bundle(
        {
            "bundleKey": "kuasangse:workspace-1",
            "workfileName": "제품.kuasangse",
        },
        "work-bundle:workspace-1:r1",
    )

    assert result["id"] == "bundle-1"
    assert calls[0][0] == "POST"
    assert calls[0][1].endswith("/work-bundles")
    assert calls[0][2]["headers"]["Idempotency-Key"] == "work-bundle:workspace-1:r1"
    assert calls[0][2]["headers"]["X-PDP-Control-Service-Key"] == "server-only"


def test_client_marks_work_bundle_activity_with_server_only_credentials(
    monkeypatch,
) -> None:
    calls: list[tuple[str, str, dict[str, object]]] = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _Response(
            200,
            {
                "bundleKey": "kuasangse:workspace-1",
                "clientId": "browser-session-1",
                "seenAt": "2026-07-28T12:00:00Z",
                "expiresInSeconds": 15,
            },
        )

    monkeypatch.setattr(
        "services.sinhwa_pdp_client.requests.request",
        fake_request,
    )
    client = SinhwaPdpClient(
        base_url="http://127.0.0.1:8200/api/pdp-assets/v1",
        service_key="server-only",
    )

    result = client.mark_work_bundle_activity(
        "kuasangse:workspace-1",
        "browser-session-1",
    )

    assert result["expiresInSeconds"] == 15
    assert calls[0][0] == "POST"
    assert calls[0][1].endswith("/work-bundles/activity")
    assert calls[0][2]["json"] == {
        "bundleKey": "kuasangse:workspace-1",
        "clientId": "browser-session-1",
    }
    assert calls[0][2]["headers"]["X-PDP-Control-Service-Key"] == "server-only"


def test_automation_backend_marks_current_work_bundle_activity(
    monkeypatch,
) -> None:
    captured: dict[str, str] = {}

    class FakeClient:
        def mark_work_bundle_activity(
            self,
            bundle_key: str,
            client_id: str,
        ) -> dict[str, object]:
            captured.update(bundle_key=bundle_key, client_id=client_id)
            return {
                "bundleKey": bundle_key,
                "clientId": client_id,
                "expiresInSeconds": 15,
            }

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().post(
        "/api/sinhwa-pdp/work-bundles/activity",
        json={
            "bundleKey": "kuasangse:workspace-1",
            "clientId": "browser-session-1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.get_json()["expiresInSeconds"] == 15
    assert captured == {
        "bundle_key": "kuasangse:workspace-1",
        "client_id": "browser-session-1",
    }


def test_automation_work_bundle_sync_updates_an_existing_bundle(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []

    class FakeClient:
        def create_work_bundle(self, manifest, idempotency_key):
            calls.append(("create", idempotency_key))
            raise SinhwaPdpApiError(
                "bundle_exists",
                status=409,
                details={"currentVersion": 3},
            )

        def list_work_bundles(self, query, limit=50):
            calls.append(("list", query))
            return {
                "items": [
                    {
                        "id": "bundle-1",
                        "bundleKey": "kuasangse:workspace-1",
                        "version": 3,
                    },
                ],
            }

        def update_work_bundle(
            self,
            bundle_id,
            manifest,
            idempotency_key,
            expected_version,
        ):
            calls.append(("update", expected_version))
            return {
                "id": bundle_id,
                "bundleKey": manifest["bundleKey"],
                "version": 4,
                "assets": [],
                "replayed": False,
            }

        def get_work_bundle(self, bundle_id):
            calls.append(("get", bundle_id))
            return {
                "id": bundle_id,
                "bundleKey": "kuasangse:workspace-1",
                "version": 4,
                "assets": [
                    {
                        "id": "asset-competitor-1",
                        "assetKey": "input:competitor:coupang_8206910987",
                        "storedAssetId": "stored-competitor-1",
                        "contentReference": "/api/pdp-assets/v1/assets/stored-competitor-1/content",
                    },
                ],
            }

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().post(
        "/api/sinhwa-pdp/work-bundles/sync",
        json={
            "idempotencyKey": "work-bundle:workspace-1:r4",
            "manifest": {
                "bundleKey": "kuasangse:workspace-1",
                "workfileName": "제품.kuasangse",
            },
        },
    )

    assert response.status_code == 200, response.text
    assert response.get_json()["authoritativeSaved"] is True
    assert response.get_json()["bundle"]["version"] == 4
    assert response.get_json()["bundle"]["assets"][0]["storedAssetId"] == "stored-competitor-1"
    assert calls == [
        ("create", "work-bundle:workspace-1:r4"),
        ("list", "kuasangse:workspace-1"),
        ("update", 3),
        ("get", "bundle-1"),
    ]


def test_automation_work_bundle_asset_proxy_streams_content_without_browser_key(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeClient:
        def upload_work_bundle_asset(
            self,
            bundle_id,
            asset_id,
            stream,
            mime_type,
                filename,
                idempotency_key,
                expected_version,
                content_length=None,
            ):
            assert stream is not api_core.request.stream
            assert stream.seekable() is True
            assert stream.tell() == 0
            captured.update(
                {
                    "bundle_id": bundle_id,
                    "asset_id": asset_id,
                    "content": stream.read(),
                    "mime_type": mime_type,
                    "filename": filename,
                    "idempotency_key": idempotency_key,
                    "expected_version": expected_version,
                    "content_length": content_length,
                }
            )
            return {
                "id": asset_id,
                "storedAssetId": "stored-1",
                "replayed": False,
            }

    monkeypatch.setattr(api_core, "SinhwaPdpClient", FakeClient)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")

    response = app.test_client().put(
        "/api/sinhwa-pdp/work-bundles/bundle-1/assets/asset-1/content",
        data=b"png-content",
        headers={
            "Content-Type": "image/png",
            "X-Asset-Filename": "base.png",
            "Idempotency-Key": "asset-upload-1",
            "If-Match": "1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.get_json()["storedAssetId"] == "stored-1"
    assert captured == {
        "bundle_id": "bundle-1",
        "asset_id": "asset-1",
        "content": b"png-content",
        "mime_type": "image/png",
        "filename": "base.png",
        "idempotency_key": "asset-upload-1",
        "expected_version": 1,
        "content_length": len(b"png-content"),
    }
