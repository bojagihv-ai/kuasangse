from __future__ import annotations

import importlib.util
import itertools
import json
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from flask import Blueprint, Flask
from flask.testing import FlaskClient

from backend.config import Config


@pytest.fixture()
def client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest,
) -> FlaskClient:
    limit = getattr(request, "param", Config.MAX_CONTENT_LENGTH)
    shared = ModuleType("routes.api_shared")
    isolated_config = SimpleNamespace(
        LOCAL_STATE_FOLDER=str(tmp_path), MAX_CONTENT_LENGTH=limit,
    )
    blueprint = Blueprint("draft_recovery_limits", __name__)
    monkeypatch.setattr(shared, "Config", isolated_config, raising=False)
    monkeypatch.setattr(shared, "api", blueprint, raising=False)
    monkeypatch.setitem(sys.modules, "routes.api_shared", shared)
    source = Path(__file__).parents[1] / "routes" / "api_draft_recovery.py"
    spec = importlib.util.spec_from_file_location("routes._isolated_draft_recovery", source)
    assert spec is not None and spec.loader is not None
    route = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(route)
    ticks = itertools.count(1_800_000_000)
    monkeypatch.setattr(route, "time", SimpleNamespace(time=lambda: next(ticks)))
    app = Flask(__name__)
    app.config.update(TESTING=True, MAX_CONTENT_LENGTH=limit)
    app.register_blueprint(blueprint, url_prefix="/api")
    return app.test_client()


def test_full_image_snapshot_above_24_mib_round_trips(client: FlaskClient) -> None:
    fixture = os.environ.get("KUASANGSE_DRAFT_RECOVERY_FIXTURE")
    snapshot = (
        json.loads(Path(fixture).read_text(encoding="utf-8-sig"))
        if fixture else {
            "assets": {"optionSorter": {"images": [{"base64": "A" * (25 * 1024 * 1024)}]}},
            "lightweight": {"productName": "복구 한도 검증"},
        }
    )
    body = {"scopeId": "draft:large-recovery", "snapshot": snapshot}
    assert len(json.dumps(body).encode()) > 24 * 1024 * 1024

    saved = client.post("/api/draft-recovery", json=body)

    assert saved.status_code == 200
    listed = client.get("/api/draft-recovery?scopeId=draft:large-recovery").get_json()
    saved_at = listed["entries"][0]["savedAt"]
    restored = client.get(
        f"/api/draft-recovery/entry?scopeId=draft:large-recovery&savedAt={saved_at}",
    )
    assert restored.status_code == 200
    assert restored.get_json()["snapshot"] == snapshot


@pytest.mark.parametrize("client", [1536], indirect=True)
def test_encoded_copy_above_configured_limit_is_rejected(client: FlaskClient) -> None:
    snapshot = {"image": ""}
    body = {"scopeId": "draft:limit", "snapshot": snapshot}
    overhead = len(json.dumps(body, separators=(",", ":")).encode())
    snapshot["image"] = "A" * (1536 - overhead)

    response = client.post(
        "/api/draft-recovery", data=json.dumps(body, separators=(",", ":")),
        content_type="application/json",
    )

    assert response.status_code == 413
    assert response.get_json()["ok"] is False
    assert client.get("/api/draft-recovery?scopeId=draft:limit").get_json()["entries"] == []


@pytest.mark.parametrize("scope", ["", "batch:job", "../outside"])
def test_invalid_scope_is_rejected(client: FlaskClient, scope: str) -> None:
    response = client.post("/api/draft-recovery", json={"scopeId": scope, "snapshot": {}})
    assert response.status_code == 400


def test_non_object_snapshot_is_rejected(client: FlaskClient) -> None:
    response = client.post(
        "/api/draft-recovery", json={"scopeId": "draft:invalid", "snapshot": []},
    )
    assert response.status_code == 400


def test_recovery_retains_the_latest_five_copies(client: FlaskClient) -> None:
    saved_ids: list[int] = []
    for index in range(8):
        response = client.post(
            "/api/draft-recovery", json={"scopeId": "project:retention", "snapshot": {"n": index}},
        )
        assert response.status_code == 200
        saved_ids.append(response.get_json()["savedAt"])

    listed = client.get("/api/draft-recovery?scopeId=project:retention").get_json()

    assert [row["savedAt"] for row in listed["entries"]] == saved_ids[-5:][::-1]
