from __future__ import annotations

from pathlib import Path

import pytest
from flask import Flask

from routes import public_api as public_routes
from services.public_automation import PublicAutomationService


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    service = PublicAutomationService(tmp_path / "public-api")
    monkeypatch.setattr(public_routes, "service", service)
    app = Flask(__name__)
    app.register_blueprint(public_routes.public_api, url_prefix="/api/v1")
    app.config.update(TESTING=True)
    return app.test_client(), service


def _create_job(client):
    response = client.post(
        "/api/v1/jobs",
        json={
            "name": "외부 API 테스트",
            "dry_run": False,
            "confirm": True,
        },
    )
    assert response.status_code == 201
    return response.get_json()["job"]["id"]


def test_health_and_openapi_describe_launcher_and_all_capabilities(client):
    http, _ = client

    health = http.get("/api/v1/health")
    assert health.status_code == 200
    assert health.get_json()["status"] == "ok"
    assert health.get_json()["launcher"]["api_hub_connector_id"] == "kuasangse_python_5050"

    response = http.get("/api/v1/openapi.json")
    assert response.status_code == 200
    document = response.get_json()
    assert document["openapi"].startswith("3.")
    assert document["x-launcher"]["health_url"].endswith("/api/v1/health")

    paths = document["paths"]
    expected = {
        "/jobs",
        "/jobs/{job_id}",
        "/jobs/{job_id}/inputs",
        "/jobs/{job_id}/generate",
        "/jobs/{job_id}/sections/{section_id}",
        "/jobs/{job_id}/preview",
        "/jobs/{job_id}/save",
        "/jobs/{job_id}/publish",
        "/jobs/{job_id}/status",
        "/jobs/{job_id}/logs",
    }
    assert expected.issubset(paths)


@pytest.mark.parametrize(
    ("payload", "status", "code"),
    [
        ({"name": "누락"}, 400, "SAFETY_OPTIONS_REQUIRED"),
        (
            {"name": "미확인", "dry_run": False, "confirm": False},
            409,
            "CONFIRMATION_REQUIRED",
        ),
    ],
)
def test_writes_require_explicit_dry_run_and_confirm(client, payload, status, code):
    http, _ = client
    response = http.post("/api/v1/jobs", json=payload)
    assert response.status_code == status
    assert response.get_json()["error"]["code"] == code


def test_job_input_section_preview_save_and_delete_lifecycle(client, tmp_path: Path):
    http, service = client

    dry_create = http.post(
        "/api/v1/jobs",
        json={"name": "계획만", "dry_run": True, "confirm": False},
    )
    assert dry_create.status_code == 200
    assert dry_create.get_json()["dry_run"] is True
    assert service.list_jobs() == []

    job_id = _create_job(http)
    image_path = tmp_path / "primary.png"
    image_path.write_bytes(b"not-decoded-by-contract-test")
    inputs = {
        "product": {"product_name": "모시바둑파우치", "price": 5000},
        "images": [{"role": "primary", "path": str(image_path)}],
        "dry_run": False,
        "confirm": True,
    }
    response = http.put(f"/api/v1/jobs/{job_id}/inputs", json=inputs)
    assert response.status_code == 200
    assert response.get_json()["job"]["inputs"]["product"]["price"] == 5000

    section = {
        "content": {
            "headline": "전통의 색을 담은 파우치",
            "body_text": "외부 API에서 편집한 섹션입니다.",
        },
        "image_path": str(image_path),
        "dry_run": False,
        "confirm": True,
    }
    edited = http.patch(
        f"/api/v1/jobs/{job_id}/sections/header",
        json=section,
    )
    assert edited.status_code == 200
    assert edited.get_json()["section"]["content"]["headline"].startswith("전통")

    preview = http.get(f"/api/v1/jobs/{job_id}/preview")
    assert preview.status_code == 200
    assert "전통의 색" in preview.get_json()["html"]

    saved = http.post(
        f"/api/v1/jobs/{job_id}/save",
        json={"dry_run": False, "confirm": True},
    )
    assert saved.status_code == 200
    assert Path(saved.get_json()["saved_path"]).is_file()

    status = http.get(f"/api/v1/jobs/{job_id}/status")
    logs = http.get(f"/api/v1/jobs/{job_id}/logs")
    assert status.status_code == 200
    assert logs.status_code == 200
    assert logs.get_json()["logs"]

    dry_delete = http.delete(
        f"/api/v1/jobs/{job_id}",
        json={"dry_run": True, "confirm": False},
    )
    assert dry_delete.status_code == 200
    assert http.get(f"/api/v1/jobs/{job_id}").status_code == 200

    deleted = http.delete(
        f"/api/v1/jobs/{job_id}",
        json={"dry_run": False, "confirm": True},
    )
    assert deleted.status_code == 200
    assert http.get(f"/api/v1/jobs/{job_id}").status_code == 404


def test_generation_delegates_to_existing_pipeline(client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    http, service = client
    job_id = _create_job(http)
    image_path = tmp_path / "primary.png"
    image_path.write_bytes(b"pipeline-boundary")
    http.put(
        f"/api/v1/jobs/{job_id}/inputs",
        json={
            "product": {"product_name": "API 생성"},
            "images": [{"role": "primary", "path": str(image_path)}],
            "dry_run": False,
            "confirm": True,
        },
    )

    calls = []

    class FakePipeline:
        projects = {}

        def create_project(self, image_path, product_name):
            project = {
                "id": "pipe-1",
                "image_path": image_path,
                "product_name": product_name,
                "status": "created",
                "progress": 0,
                "progress_message": "",
                "analysis": None,
                "competitor_data": None,
                "sections": {},
                "generated_images": {},
            }
            self.projects["pipe-1"] = project
            return project

        def get_project(self, project_id):
            return self.projects.get(project_id)

        def run_analysis(self, project_id):
            calls.append(("analyze", project_id))
            result = {"product_name": "API 생성", "category": "파우치"}
            self.projects[project_id]["analysis"] = result
            self.projects[project_id]["status"] = "analyzed"
            return result

    service.pipeline = FakePipeline()
    response = http.post(
        f"/api/v1/jobs/{job_id}/generate",
        json={
            "mode": "analysis",
            "background": False,
            "dry_run": False,
            "confirm": True,
        },
    )
    assert response.status_code == 200
    assert calls == [("analyze", "pipe-1")]
    assert response.get_json()["job"]["result"]["category"] == "파우치"


def test_publish_dry_run_never_calls_control_tower_and_confirmed_publish_uses_plan(
    client,
    monkeypatch: pytest.MonkeyPatch,
):
    http, service = client
    job_id = _create_job(http)
    target = {
        "mall_id": "bojagi1928",
        "method": "PUT",
        "path": "/api/v2/admin/products/2996",
        "body": {"shop_no": 1, "request": {"display": "F", "selling": "F"}},
        "title": "API 발행 계약 테스트",
    }

    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if url.endswith("/api/cafe24/console"):
            return {"mode": "plan", "plan": {"id": "plan-1", "risk_level": "low"}}
        if url.endswith("/api/change-plans/plan-1/approve"):
            return {"jobRunId": "control-job-1"}
        raise AssertionError(url)

    monkeypatch.setattr(service, "_request_json", fake_request)

    dry_run = http.post(
        f"/api/v1/jobs/{job_id}/publish",
        json={"target": target, "dry_run": True, "confirm": False},
    )
    assert dry_run.status_code == 200
    assert dry_run.get_json()["dry_run"] is True
    assert calls == []

    confirmed = http.post(
        f"/api/v1/jobs/{job_id}/publish",
        json={"target": target, "dry_run": False, "confirm": True},
    )
    assert confirmed.status_code == 202
    payload = confirmed.get_json()
    assert payload["change_plan_id"] == "plan-1"
    assert payload["control_job_id"] == "control-job-1"
    assert [call[1].rsplit("/", 1)[-1] for call in calls] == ["console", "approve"]
