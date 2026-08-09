from __future__ import annotations

from typing import Any

from flask import Blueprint, Response, jsonify, request

from services.public_automation import PublicAutomationError, PublicAutomationService


public_api = Blueprint("public_automation_api", __name__)
service = PublicAutomationService()


def _error_payload(error: PublicAutomationError):
    payload: dict[str, Any] = {
        "ok": False,
        "error": {"code": error.code, "message": error.message},
    }
    if error.details:
        payload["error"]["details"] = error.details
    return jsonify(payload), error.status


@public_api.errorhandler(PublicAutomationError)
def handle_public_automation_error(error: PublicAutomationError):
    return _error_payload(error)


def _body() -> dict[str, Any]:
    value = request.get_json(silent=True)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise PublicAutomationError("INVALID_JSON_BODY", "JSON 요청 본문은 객체여야 합니다.")
    return value


def _safety(body: dict[str, Any]) -> bool:
    if "dry_run" not in body or "confirm" not in body:
        raise PublicAutomationError(
            "SAFETY_OPTIONS_REQUIRED",
            "쓰기 요청에는 dry_run과 confirm 불리언 값을 모두 지정해야 합니다.",
        )
    if not isinstance(body["dry_run"], bool) or not isinstance(body["confirm"], bool):
        raise PublicAutomationError(
            "INVALID_SAFETY_OPTIONS",
            "dry_run과 confirm은 불리언 값이어야 합니다.",
        )
    if body["dry_run"]:
        return True
    if not body["confirm"]:
        raise PublicAutomationError(
            "CONFIRMATION_REQUIRED",
            "실제 실행은 dry_run=false, confirm=true일 때만 허용됩니다.",
            409,
        )
    return False


def _dry_run(action: str, job_id: str | None, changes: dict[str, Any]):
    return jsonify(
        {
            "ok": True,
            "dry_run": True,
            "action": action,
            "job_id": job_id,
            "changes": changes,
            "executed": False,
        }
    )


def openapi_document() -> dict[str, Any]:
    mutation_schema = {
        "type": "object",
        "required": ["dry_run", "confirm"],
        "properties": {
            "dry_run": {
                "type": "boolean",
                "description": "true이면 계획만 반환하고 상태를 변경하지 않습니다.",
            },
            "confirm": {
                "type": "boolean",
                "description": "실행은 dry_run=false와 confirm=true가 함께 필요합니다.",
            },
        },
    }

    def json_response(description: str) -> dict[str, Any]:
        return {
            "description": description,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }

    def operation(
        summary: str,
        *,
        body_schema: dict[str, Any] | None = None,
        response_code: str = "200",
    ) -> dict[str, Any]:
        value: dict[str, Any] = {
            "summary": summary,
            "responses": {
                response_code: json_response("성공"),
                "400": json_response("요청 검증 실패"),
                "404": json_response("작업 없음"),
                "409": json_response("확인 또는 상태 충돌"),
            },
        }
        if body_schema:
            value["requestBody"] = {
                "required": True,
                "content": {"application/json": {"schema": body_schema}},
            }
        return value

    job_parameter = {
        "name": "job_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string"},
    }
    section_parameter = {
        "name": "section_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string"},
    }
    safe_object = {"allOf": [mutation_schema], "additionalProperties": True}

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "상세페이지 AI 자동화 REST API",
            "version": "1.0.0",
            "description": (
                "작업, 입력, AI 생성, 섹션 편집, 미리보기, 저장, Cafe24 발행, "
                "상태와 로그를 분리한 로컬 자동화 API입니다."
            ),
        },
        "servers": [{"url": "http://127.0.0.1:5050/api/v1"}],
        "x-launcher": service.launcher_info(),
        "paths": {
            "/health": {"get": operation("서버 상태와 런처 정보 조회")},
            "/openapi.json": {"get": operation("OpenAPI JSON 조회")},
            "/docs": {"get": operation("사람이 읽는 API 문서 열기")},
            "/jobs": {
                "get": operation("작업 목록 조회"),
                "post": operation(
                    "작업 생성",
                    body_schema={
                        "allOf": [
                            mutation_schema,
                            {
                                "type": "object",
                                "properties": {"name": {"type": "string"}},
                            },
                        ]
                    },
                    response_code="201",
                ),
            },
            "/jobs/{job_id}": {
                "parameters": [job_parameter],
                "get": operation("작업 전체 조회"),
                "delete": operation("작업 삭제", body_schema=safe_object),
            },
            "/jobs/{job_id}/inputs": {
                "parameters": [job_parameter],
                "put": operation(
                    "이미지와 상품정보 입력",
                    body_schema={
                        "allOf": [
                            mutation_schema,
                            {
                                "type": "object",
                                "properties": {
                                    "product": {"type": "object"},
                                    "images": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "role": {"type": "string"},
                                                "path": {"type": "string"},
                                                "url": {"type": "string"},
                                                "label": {"type": "string"},
                                            },
                                        },
                                    },
                                },
                            },
                        ]
                    },
                ),
            },
            "/jobs/{job_id}/generate": {
                "parameters": [job_parameter],
                "post": operation(
                    "AI 분석과 섹션·이미지 생성",
                    body_schema={
                        "allOf": [
                            mutation_schema,
                            {
                                "type": "object",
                                "required": ["mode"],
                                "properties": {
                                    "mode": {
                                        "type": "string",
                                        "enum": [
                                            "analysis",
                                            "competitors",
                                            "section",
                                            "section_image",
                                            "all",
                                        ],
                                    },
                                    "section_id": {"type": "string"},
                                    "instructions": {"type": "string"},
                                    "section_instructions": {"type": "object"},
                                    "background": {"type": "boolean", "default": True},
                                },
                            },
                        ]
                    },
                ),
            },
            "/jobs/{job_id}/sections/{section_id}": {
                "parameters": [job_parameter, section_parameter],
                "patch": operation(
                    "섹션 콘텐츠와 이미지 편집",
                    body_schema={
                        "allOf": [
                            mutation_schema,
                            {
                                "type": "object",
                                "required": ["content"],
                                "properties": {
                                    "content": {"type": "object"},
                                    "config": {"type": "object"},
                                    "image_path": {"type": "string"},
                                },
                            },
                        ]
                    },
                ),
            },
            "/jobs/{job_id}/preview": {
                "parameters": [job_parameter],
                "get": operation("미리보기 JSON 또는 HTML 조회"),
            },
            "/jobs/{job_id}/save": {
                "parameters": [job_parameter],
                "post": operation("kuasangse 작업파일 저장", body_schema=safe_object),
            },
            "/jobs/{job_id}/publish": {
                "parameters": [job_parameter],
                "post": operation(
                    "Cafe24 Control Tower 변경안으로 발행",
                    body_schema={
                        "allOf": [
                            mutation_schema,
                            {
                                "type": "object",
                                "required": ["target"],
                                "properties": {
                                    "target": {
                                        "type": "object",
                                        "required": ["mall_id", "method", "path", "body"],
                                        "properties": {
                                            "mall_id": {"type": "string"},
                                            "method": {
                                                "type": "string",
                                                "enum": ["POST", "PUT", "PATCH", "DELETE"],
                                            },
                                            "path": {"type": "string"},
                                            "body": {"type": "object"},
                                            "title": {"type": "string"},
                                            "approval_phrase": {"type": "string"},
                                        },
                                    }
                                },
                            },
                        ]
                    },
                    response_code="202",
                ),
            },
            "/jobs/{job_id}/status": {
                "parameters": [job_parameter],
                "get": operation("작업과 Cafe24 발행 상태 조회"),
            },
            "/jobs/{job_id}/logs": {
                "parameters": [job_parameter],
                "get": operation("작업 로그 조회"),
            },
        },
        "components": {
            "schemas": {
                "SafetyOptions": mutation_schema,
                "Error": {
                    "type": "object",
                    "properties": {
                        "ok": {"type": "boolean"},
                        "error": {
                            "type": "object",
                            "properties": {
                                "code": {"type": "string"},
                                "message": {"type": "string"},
                            },
                        },
                    },
                },
            }
        },
    }


@public_api.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "kuasangse-public-automation-api",
            "version": "1.0.0",
            "launcher": service.launcher_info(),
            "capabilities": [
                "jobs",
                "inputs",
                "ai_generation",
                "section_editing",
                "preview",
                "save",
                "cafe24_publish",
                "status",
                "logs",
            ],
        }
    )


@public_api.get("/openapi.json")
def openapi_json():
    return jsonify(openapi_document())


@public_api.get("/docs")
def docs():
    document = openapi_document()
    rows = []
    for path, methods in document["paths"].items():
        for method, operation in methods.items():
            if method == "parameters":
                continue
            rows.append(
                f"<tr><td><code>{method.upper()}</code></td><td><code>/api/v1{path}</code></td>"
                f"<td>{operation.get('summary', '')}</td></tr>"
            )
    launcher = service.launcher_info()
    content = (
        "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>상세페이지 AI 자동화 API</title><style>"
        "body{margin:0;background:#0f1117;color:#eef1ff;font-family:Arial,sans-serif}"
        "main{max-width:1120px;margin:auto;padding:32px 20px 64px}"
        "a{color:#8da2ff}table{width:100%;border-collapse:collapse;background:#171a24}"
        "th,td{padding:12px;border:1px solid #30364a;text-align:left;vertical-align:top}"
        "code{color:#b9c5ff;overflow-wrap:anywhere}.card{padding:18px;background:#171a24;"
        "border:1px solid #30364a;border-radius:12px;margin:16px 0}"
        "@media(max-width:700px){th,td{display:block;width:auto}thead{display:none}}</style></head>"
        "<body><main><h1>상세페이지 AI 자동화 REST API</h1>"
        "<div class=\"card\"><strong>서버</strong> "
        f"<a href=\"{launcher['health_url']}\">{launcher['server_url']}</a><br>"
        f"<strong>OpenAPI JSON</strong> <a href=\"{launcher['openapi_url']}\">{launcher['openapi_url']}</a>"
        "</div><table><thead><tr><th>Method</th><th>Path</th><th>기능</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></main></body></html>"
    )
    return Response(content, content_type="text/html; charset=utf-8")


@public_api.route("/jobs", methods=["GET", "POST"])
def jobs():
    if request.method == "GET":
        return jsonify({"jobs": service.list_jobs()})
    body = _body()
    if _safety(body):
        return _dry_run("job.create", None, {"name": body.get("name") or "상세페이지 자동화 작업"})
    job = service.create_job(str(body.get("name") or ""))
    return jsonify({"ok": True, "job": job}), 201


@public_api.route("/jobs/<job_id>", methods=["GET", "DELETE"])
def job(job_id: str):
    if request.method == "GET":
        return jsonify({"job": service.get_job(job_id)})
    body = _body()
    service.get_job(job_id)
    if _safety(body):
        return _dry_run("job.delete", job_id, {"preserve_exports": True})
    service.delete_job(job_id)
    return jsonify({"ok": True, "deleted": True, "job_id": job_id, "exports_preserved": True})


@public_api.put("/jobs/<job_id>/inputs")
def inputs(job_id: str):
    body = _body()
    service.get_job(job_id)
    product = body.get("product") or {}
    images = body.get("images") or []
    if _safety(body):
        return _dry_run(
            "inputs.update",
            job_id,
            {"product_fields": sorted(product), "image_count": len(images)},
        )
    updated = service.set_inputs(job_id, product, images)
    return jsonify({"ok": True, "job": updated})


@public_api.post("/jobs/<job_id>/generate")
def generate(job_id: str):
    body = _body()
    service.get_job(job_id)
    if _safety(body):
        return _dry_run(
            "generation.run",
            job_id,
            {
                "mode": body.get("mode"),
                "section_id": body.get("section_id"),
                "background": body.get("background", True),
            },
        )
    result = service.generate(job_id, body, body.get("background", True) is not False)
    return jsonify({"ok": True, **result}), 202 if result["accepted"] else 200


@public_api.patch("/jobs/<job_id>/sections/<section_id>")
def section(job_id: str, section_id: str):
    body = _body()
    service.get_job(job_id)
    if _safety(body):
        return _dry_run(
            "section.edit",
            job_id,
            {"section_id": section_id, "fields": sorted(key for key in body if key not in {"dry_run", "confirm"})},
        )
    edited = service.edit_section(job_id, section_id, body)
    return jsonify({"ok": True, "job_id": job_id, "section_id": section_id, "section": edited})


@public_api.get("/jobs/<job_id>/preview")
def preview(job_id: str):
    result = service.preview(job_id)
    if request.args.get("format") == "html":
        return Response(result["html"], content_type="text/html; charset=utf-8")
    return jsonify(result)


@public_api.post("/jobs/<job_id>/save")
def save(job_id: str):
    body = _body()
    service.get_job(job_id)
    if _safety(body):
        return _dry_run(
            "job.save",
            job_id,
            {"format": "kuasangse-public-api", "exports_preserved": True},
        )
    path = service.save_export(job_id)
    return jsonify({"ok": True, "job_id": job_id, "saved_path": str(path)})


@public_api.post("/jobs/<job_id>/publish")
def publish(job_id: str):
    body = _body()
    service.get_job(job_id)
    target = service.validate_publish_target(body.get("target"))
    if _safety(body):
        safe_target = {key: value for key, value in target.items() if key not in {"body", "approval_phrase"}}
        safe_target["payload_fields"] = sorted(target["body"])
        return _dry_run("cafe24.publish", job_id, safe_target)
    result = service.publish(job_id, target)
    return jsonify({"ok": True, "job_id": job_id, **result}), 202


@public_api.get("/jobs/<job_id>/status")
def status(job_id: str):
    job_value = service.refresh_publish_status(job_id)
    return jsonify(
        {
            "job_id": job_id,
            "status": job_value.get("status"),
            "progress": job_value.get("progress"),
            "progress_message": job_value.get("progress_message"),
            "publish": job_value.get("publish"),
            "updated_at": job_value.get("updated_at"),
        }
    )


@public_api.get("/jobs/<job_id>/logs")
def logs(job_id: str):
    job_value = service.get_job(job_id)
    return jsonify({"job_id": job_id, "logs": job_value.get("logs", [])})

