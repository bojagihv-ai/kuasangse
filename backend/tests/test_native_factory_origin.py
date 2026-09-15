import pytest
from flask import Flask

import app as backend_app
from routes import api_shared


@pytest.fixture
def application(monkeypatch: pytest.MonkeyPatch) -> Flask:
    monkeypatch.setattr(backend_app, "start_automation_scheduler", lambda: None)
    monkeypatch.setattr(backend_app, "start_maintenance_scheduler", lambda: None)
    monkeypatch.delenv("KUASANGSE_ALLOW_ALL_CORS", raising=False)
    monkeypatch.delenv("KUASANGSE_CORS_ORIGINS", raising=False)
    return backend_app.create_app()


@pytest.mark.parametrize("origin", [
    "http://127.0.0.1:8081", "http://127.0.0.1:42011", "http://localhost:42011",
])
def test_original_and_native_factory_can_read_backend(application: Flask, origin: str) -> None:
    response = application.test_client().options("/api/draft-recovery", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
    })
    assert response.status_code == 200
    assert response.headers.get("Access-Control-Allow-Origin") == origin


@pytest.mark.parametrize("origin", ["https://untrusted.example", "http://127.0.0.1:42012"])
def test_native_origin_does_not_open_unrelated_origins(application: Flask, origin: str) -> None:
    response = application.test_client().options("/api/draft-recovery", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST",
    })
    assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.parametrize("origin,site,allowed", [
    ("http://127.0.0.1:8081", "same-site", True),
    ("http://127.0.0.1:42011", "same-site", True),
    ("http://localhost:42011", "same-site", True),
    ("http://127.0.0.1:42011", "cross-site", False),
    ("http://127.0.0.1:42012", "same-site", False),
    ("https://untrusted.example", "cross-site", False),
])
def test_native_local_actions_keep_same_site_boundary(application: Flask, origin: str, site: str, allowed: bool) -> None:
    with application.test_request_context("/api/cafe24-control/start", headers={
        "Origin": origin, "Sec-Fetch-Site": site,
    }):
        assert api_shared._local_action_request_allowed() is allowed
