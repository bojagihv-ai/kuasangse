from __future__ import annotations

import html
import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from services.section_definitions import get_section_by_id


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
DEFAULT_DATA_ROOT = BACKEND_ROOT / ".local" / "public-api"
DEFAULT_CONTROL_TOWER_URL = "http://127.0.0.1:8787"


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


@dataclass(frozen=True)
class PublicAutomationError(Exception):
    code: str
    message: str
    status: int = 400
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


class PublicAutomationService:
    def __init__(
        self,
        root: str | Path = DEFAULT_DATA_ROOT,
        pipeline=None,
        control_tower_url: str = DEFAULT_CONTROL_TOWER_URL,
    ):
        self.root = Path(root)
        self.jobs_root = self.root / "jobs"
        self.exports_root = self.root / "exports"
        self._pipeline = pipeline
        self.control_tower_url = control_tower_url.rstrip("/")
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        self.exports_root.mkdir(parents=True, exist_ok=True)

    @property
    def pipeline(self):
        if self._pipeline is None:
            from services.pipeline import pipeline

            self._pipeline = pipeline
        return self._pipeline

    @pipeline.setter
    def pipeline(self, value) -> None:
        self._pipeline = value

    @staticmethod
    def launcher_info() -> dict[str, str]:
        return {
            "type": "windows",
            "original_launcher": str(REPOSITORY_ROOT / "launcher.bat"),
            "api_launcher": str(REPOSITORY_ROOT / "tools" / "launch_public_api.ps1"),
            "docs_launcher": str(REPOSITORY_ROOT / "tools" / "launch_public_api_docs.vbs"),
            "working_directory": str(REPOSITORY_ROOT),
            "server_url": "http://127.0.0.1:5050",
            "health_url": "http://127.0.0.1:5050/api/v1/health",
            "openapi_url": "http://127.0.0.1:5050/api/v1/openapi.json",
            "docs_url": "http://127.0.0.1:5050/api/v1/docs",
            "api_hub_connector_id": "kuasangse_python_5050",
            "shortcut_path": str(Path.home() / "Desktop" / "상세페이지 AI 자동화 API.lnk"),
        }

    def _job_path(self, job_id: str) -> Path:
        if not job_id or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for character in job_id):
            raise PublicAutomationError("INVALID_JOB_ID", "작업 ID 형식이 올바르지 않습니다.")
        return self.jobs_root / f"{job_id}.json"

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)

    def _persist(self, job: dict[str, Any]) -> dict[str, Any]:
        job["updated_at"] = _now()
        self._write_json(self._job_path(job["id"]), job)
        return job

    @staticmethod
    def _log(job: dict[str, Any], action: str, message: str, level: str = "info") -> None:
        job.setdefault("logs", []).append(
            {
                "at": _now(),
                "level": level,
                "action": action,
                "message": message,
            }
        )

    def list_jobs(self) -> list[dict[str, Any]]:
        jobs = []
        for path in self.jobs_root.glob("*.json"):
            try:
                jobs.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        jobs.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return jobs

    def create_job(self, name: str) -> dict[str, Any]:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        timestamp = _now()
        job = {
            "id": job_id,
            "name": str(name or "상세페이지 자동화 작업").strip(),
            "status": "created",
            "progress": 0,
            "progress_message": "작업이 생성되었습니다.",
            "created_at": timestamp,
            "updated_at": timestamp,
            "inputs": {"product": {}, "images": []},
            "pipeline_project_id": None,
            "pipeline": {},
            "sections": {},
            "result": None,
            "publish": None,
            "saved_path": "",
            "logs": [],
        }
        self._log(job, "job.create", "외부 API 작업을 생성했습니다.")
        return self._persist(job)

    def get_job(self, job_id: str) -> dict[str, Any]:
        path = self._job_path(job_id)
        if not path.is_file():
            raise PublicAutomationError("JOB_NOT_FOUND", "작업을 찾지 못했습니다.", 404)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise PublicAutomationError("JOB_READ_FAILED", "작업 파일을 읽지 못했습니다.", 500) from error

    def set_inputs(
        self,
        job_id: str,
        product: dict[str, Any],
        images: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not isinstance(product, dict):
            raise PublicAutomationError("INVALID_PRODUCT_INPUT", "product는 객체여야 합니다.")
        if not isinstance(images, list):
            raise PublicAutomationError("INVALID_IMAGE_INPUT", "images는 배열이어야 합니다.")
        normalized_images = []
        for index, image in enumerate(images):
            if not isinstance(image, dict):
                raise PublicAutomationError("INVALID_IMAGE_INPUT", f"images[{index}]는 객체여야 합니다.")
            path = str(image.get("path") or "").strip()
            url = str(image.get("url") or "").strip()
            if not path and not url:
                raise PublicAutomationError("INVALID_IMAGE_INPUT", f"images[{index}]에 path 또는 url이 필요합니다.")
            normalized_images.append(
                {
                    "role": str(image.get("role") or "reference").strip(),
                    "path": path,
                    "url": url,
                    "label": str(image.get("label") or "").strip(),
                }
            )

        job = self.get_job(job_id)
        job["inputs"] = {"product": product, "images": normalized_images}
        job["status"] = "inputs_ready"
        job["progress_message"] = "상품정보와 이미지 입력이 준비되었습니다."
        self._log(job, "inputs.update", f"상품정보와 이미지 {len(normalized_images)}건을 저장했습니다.")
        return self._persist(job)

    @staticmethod
    def _primary_image_path(job: dict[str, Any]) -> str:
        images = job.get("inputs", {}).get("images", [])
        primary = next((item for item in images if item.get("role") == "primary" and item.get("path")), None)
        candidate = primary or next((item for item in images if item.get("path")), None)
        if not candidate:
            raise PublicAutomationError(
                "PRIMARY_IMAGE_REQUIRED",
                "AI 생성에는 로컬 path가 있는 primary 이미지가 필요합니다.",
                422,
            )
        path = Path(candidate["path"]).expanduser()
        if not path.is_file():
            raise PublicAutomationError("IMAGE_NOT_FOUND", f"입력 이미지 파일을 찾지 못했습니다: {path}", 422)
        return str(path.resolve())

    def _pipeline_project(self, job: dict[str, Any]) -> dict[str, Any]:
        project_id = job.get("pipeline_project_id")
        project = self.pipeline.get_project(project_id) if project_id else None
        if project:
            return project

        product = job.get("inputs", {}).get("product", {})
        project = self.pipeline.create_project(
            self._primary_image_path(job),
            str(product.get("product_name") or product.get("name") or job.get("name") or ""),
        )
        snapshot = job.get("pipeline") or {}
        for key in ("analysis", "competitor_data", "sections", "generated_images"):
            if key in snapshot:
                project[key] = snapshot[key]
        job["pipeline_project_id"] = project["id"]
        return project

    @staticmethod
    def _capture_pipeline(job: dict[str, Any], project: dict[str, Any]) -> None:
        job["pipeline"] = {
            "analysis": project.get("analysis"),
            "competitor_data": project.get("competitor_data"),
            "sections": project.get("sections", {}),
            "generated_images": project.get("generated_images", {}),
        }
        job["sections"] = project.get("sections", {})
        job["status"] = project.get("status", job.get("status", "created"))
        job["progress"] = project.get("progress", job.get("progress", 0))
        job["progress_message"] = project.get("progress_message", job.get("progress_message", ""))

    def _run_generation(self, job_id: str, mode: str, body: dict[str, Any]) -> dict[str, Any]:
        job = self.get_job(job_id)
        project = self._pipeline_project(job)
        job["status"] = "running"
        job["progress_message"] = f"{mode} 생성을 실행 중입니다."
        self._log(job, "generation.start", f"AI 생성 모드 {mode}를 시작했습니다.")
        self._persist(job)

        try:
            if mode == "analysis":
                result = self.pipeline.run_analysis(project["id"])
            elif mode == "competitors":
                result = self.pipeline.run_competitor_search(project["id"])
            elif mode == "section":
                section_id = str(body.get("section_id") or "").strip()
                if not section_id:
                    raise PublicAutomationError("SECTION_ID_REQUIRED", "section 모드에는 section_id가 필요합니다.", 422)
                result = self.pipeline.generate_section(
                    project["id"],
                    section_id,
                    str(body.get("instructions") or ""),
                )
            elif mode == "section_image":
                section_id = str(body.get("section_id") or "").strip()
                if not section_id:
                    raise PublicAutomationError("SECTION_ID_REQUIRED", "section_image 모드에는 section_id가 필요합니다.", 422)
                result = {"image_path": self.pipeline.generate_section_image(project["id"], section_id)}
            elif mode == "all":
                instructions = body.get("section_instructions") or {}
                if not isinstance(instructions, dict):
                    raise PublicAutomationError("INVALID_SECTION_INSTRUCTIONS", "section_instructions는 객체여야 합니다.")
                result = self.pipeline.generate_all_sections(project["id"], instructions)
            else:
                raise PublicAutomationError(
                    "INVALID_GENERATION_MODE",
                    "mode는 analysis, competitors, section, section_image, all 중 하나여야 합니다.",
                    422,
                )
            self._capture_pipeline(job, project)
            job["result"] = result
            if mode != "all":
                job["status"] = "completed"
                job["progress"] = max(1, int(job.get("progress") or 0))
                job["progress_message"] = f"{mode} 생성이 완료되었습니다."
            self._log(job, "generation.complete", f"AI 생성 모드 {mode}가 완료되었습니다.")
            return self._persist(job)
        except PublicAutomationError:
            raise
        except Exception as error:
            job["status"] = "failed"
            job["progress_message"] = "AI 생성에 실패했습니다."
            self._log(job, "generation.failed", str(error), "error")
            self._persist(job)
            raise PublicAutomationError("GENERATION_FAILED", str(error), 502) from error

    def generate(self, job_id: str, body: dict[str, Any], background: bool) -> dict[str, Any]:
        mode = str(body.get("mode") or "").strip()
        self.get_job(job_id)
        if not background:
            return {"accepted": False, "job": self._run_generation(job_id, mode, body)}

        def runner() -> None:
            try:
                self._run_generation(job_id, mode, body)
            except PublicAutomationError:
                return

        job = self.get_job(job_id)
        job["status"] = "queued"
        job["progress_message"] = f"{mode} 생성 대기 중입니다."
        self._log(job, "generation.queued", f"AI 생성 모드 {mode}를 백그라운드 실행으로 등록했습니다.")
        queued_job = self._persist(job)
        thread = threading.Thread(target=runner, daemon=True, name=f"public-api-{job_id}")
        thread.start()
        return {"accepted": True, "job": queued_job}

    def edit_section(self, job_id: str, section_id: str, body: dict[str, Any]) -> dict[str, Any]:
        content = body.get("content")
        if not isinstance(content, dict):
            raise PublicAutomationError("INVALID_SECTION_CONTENT", "content는 객체여야 합니다.")
        job = self.get_job(job_id)
        section_definition = get_section_by_id(section_id) or {
            "section_id": section_id,
            "section_name": section_id,
        }
        section = {
            "config": body.get("config") if isinstance(body.get("config"), dict) else section_definition,
            "content": content,
            "image_path": str(body.get("image_path") or ""),
            "updated_at": _now(),
        }
        job.setdefault("sections", {})[section_id] = section
        job.setdefault("pipeline", {}).setdefault("sections", {})[section_id] = section
        project_id = job.get("pipeline_project_id")
        project = self.pipeline.get_project(project_id) if project_id else None
        if project:
            project.setdefault("sections", {})[section_id] = section
        job["status"] = "editing"
        job["progress_message"] = f"섹션 {section_id} 편집 내용이 저장되었습니다."
        self._log(job, "section.edit", f"섹션 {section_id}를 편집했습니다.")
        self._persist(job)
        return section

    @staticmethod
    def _section_image_url(image_path: str) -> str:
        if not image_path:
            return ""
        if image_path.startswith(("http://", "https://", "/static/")):
            return image_path
        return f"/static/generated/{Path(image_path).name}"

    def preview(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        product = job.get("inputs", {}).get("product", {})
        sections = job.get("sections") or job.get("pipeline", {}).get("sections") or {}
        rendered = []
        for section_id, section in sections.items():
            content = section.get("content") or {}
            headline = html.escape(str(content.get("headline") or section_id))
            body_text = html.escape(str(content.get("body_text") or content.get("body") or ""))
            image_url = self._section_image_url(str(section.get("image_path") or ""))
            image = f'<img src="{html.escape(image_url)}" alt="{headline}">' if image_url else ""
            rendered.append(
                f'<section data-section-id="{html.escape(section_id)}">'
                f"<h2>{headline}</h2>{image}<p>{body_text}</p></section>"
            )
        product_name = html.escape(
            str(product.get("product_name") or product.get("name") or job.get("name") or "")
        )
        document = (
            '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<style>body{margin:0;background:#f4f5f8;color:#17171c;font-family:Arial,sans-serif}"
            "main{width:min(860px,100%);margin:auto;background:#fff}"
            "header,section{padding:32px}section img{display:block;width:100%;height:auto}"
            "h1,h2{margin:0 0 16px}p{line-height:1.7;white-space:pre-wrap}</style></head>"
            f"<body><main><header><h1>{product_name}</h1></header>{''.join(rendered)}</main></body></html>"
        )
        return {
            "job_id": job_id,
            "product_name": product_name,
            "section_count": len(sections),
            "html": document,
        }

    def save_export(self, job_id: str) -> Path:
        job = self.get_job(job_id)
        export_path = self.exports_root / f"{job_id}.kuasangse"
        export = {
            "format": "kuasangse-public-api",
            "version": 1,
            "saved_at": _now(),
            "job": job,
            "preview": self.preview(job_id),
        }
        self._write_json(export_path, export)
        job["saved_path"] = str(export_path)
        job["status"] = "saved"
        job["progress_message"] = "kuasangse 작업파일을 저장했습니다."
        self._log(job, "job.save", f"작업파일을 저장했습니다: {export_path.name}")
        self._persist(job)
        return export_path

    @staticmethod
    def _contains_secret(value: Any) -> bool:
        secret_keys = {
            "access_token",
            "refresh_token",
            "authorization",
            "client_secret",
            "api_key",
        }
        if isinstance(value, dict):
            return any(str(key).lower() in secret_keys or PublicAutomationService._contains_secret(item) for key, item in value.items())
        if isinstance(value, list):
            return any(PublicAutomationService._contains_secret(item) for item in value)
        return False

    def validate_publish_target(self, target: Any) -> dict[str, Any]:
        if not isinstance(target, dict):
            raise PublicAutomationError("INVALID_PUBLISH_TARGET", "target은 객체여야 합니다.")
        mall_id = str(target.get("mall_id") or "").strip()
        method = str(target.get("method") or "").strip().upper()
        path = str(target.get("path") or "").strip()
        body = target.get("body")
        if not mall_id:
            raise PublicAutomationError("MALL_ID_REQUIRED", "Cafe24 mall_id가 필요합니다.", 422)
        if method not in {"POST", "PUT", "PATCH", "DELETE"}:
            raise PublicAutomationError("INVALID_PUBLISH_METHOD", "발행 method는 POST, PUT, PATCH, DELETE만 허용합니다.", 422)
        if not path.startswith("/api/v2/admin/"):
            raise PublicAutomationError("INVALID_PUBLISH_PATH", "Cafe24 Admin API 경로만 허용합니다.", 422)
        if not isinstance(body, dict):
            raise PublicAutomationError("INVALID_PUBLISH_BODY", "발행 body는 객체여야 합니다.", 422)
        if self._contains_secret(body):
            raise PublicAutomationError("SECRET_IN_PAYLOAD", "발행 payload에 인증정보를 포함할 수 없습니다.", 422)
        return {
            "mall_id": mall_id,
            "method": method,
            "path": path,
            "body": body,
            "title": str(target.get("title") or f"{method} {path}").strip(),
            "approval_phrase": str(target.get("approval_phrase") or ""),
        }

    def publish(self, job_id: str, target: dict[str, Any]) -> dict[str, Any]:
        job = self.get_job(job_id)
        plan_response = self._request_json(
            "POST",
            f"{self.control_tower_url}/api/cafe24/console",
            json={
                "mallId": target["mall_id"],
                "method": target["method"],
                "path": target["path"],
                "body": target["body"],
                "title": target["title"],
                "executeDirect": False,
            },
        )
        plan = plan_response.get("plan") or {}
        plan_id = str(plan.get("id") or "")
        if not plan_id:
            raise PublicAutomationError("PUBLISH_PLAN_FAILED", "Cafe24 변경안 ID를 받지 못했습니다.", 502)
        requirement = plan.get("approval_requirement") or {}
        if requirement.get("required") and not target.get("approval_phrase"):
            raise PublicAutomationError(
                "APPROVAL_PHRASE_REQUIRED",
                "고위험 Cafe24 변경안의 승인 문구가 필요합니다.",
                409,
                {"change_plan_id": plan_id, "approval_requirement": requirement},
            )
        approval = self._request_json(
            "POST",
            f"{self.control_tower_url}/api/change-plans/{plan_id}/approve",
            json={"confirmation": target.get("approval_phrase") or None},
        )
        control_job_id = str(approval.get("jobRunId") or "")
        job["publish"] = {
            "target": {
                "mall_id": target["mall_id"],
                "method": target["method"],
                "path": target["path"],
                "title": target["title"],
            },
            "change_plan_id": plan_id,
            "control_job_id": control_job_id,
            "status": "queued",
            "created_at": _now(),
        }
        job["status"] = "publishing"
        job["progress_message"] = "Cafe24 변경안이 승인되어 실행 대기 중입니다."
        self._log(job, "publish.queued", f"Cafe24 변경안 {plan_id}을 승인했습니다.")
        self._persist(job)
        return {
            "change_plan_id": plan_id,
            "control_job_id": control_job_id,
            "risk_level": plan.get("risk_level"),
            "status": "queued",
        }

    def refresh_publish_status(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        publish = job.get("publish") or {}
        control_job_id = publish.get("control_job_id")
        if not control_job_id or publish.get("status") in {"succeeded", "failed", "partial"}:
            return job
        try:
            jobs = self._request_json("GET", f"{self.control_tower_url}/api/jobs?limit=100")
        except PublicAutomationError:
            return job
        rows = jobs if isinstance(jobs, list) else jobs.get("jobs", [])
        matched = next((row for row in rows if row.get("id") == control_job_id), None)
        if not matched:
            return job
        publish["status"] = matched.get("status")
        publish["progress"] = matched.get("progress")
        publish["success_count"] = matched.get("success_count")
        publish["failure_count"] = matched.get("failure_count")
        if publish["status"] in {"succeeded", "failed", "partial"}:
            job["status"] = "published" if publish["status"] == "succeeded" else "publish_failed"
            job["progress_message"] = f"Cafe24 발행 결과: {publish['status']}"
            self._log(job, "publish.complete", job["progress_message"])
        return self._persist(job)

    def delete_job(self, job_id: str) -> None:
        path = self._job_path(job_id)
        if not path.is_file():
            raise PublicAutomationError("JOB_NOT_FOUND", "작업을 찾지 못했습니다.", 404)
        path.unlink()

    @staticmethod
    def _request_json(method: str, url: str, **kwargs) -> Any:
        try:
            response = requests.request(method, url, timeout=30, **kwargs)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            raise PublicAutomationError(
                "UPSTREAM_REQUEST_FAILED",
                f"외부 발행 제어 서버 요청에 실패했습니다: {type(error).__name__}",
                502,
            ) from error
