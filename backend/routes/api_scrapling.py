from __future__ import annotations

import uuid

from flask import jsonify, request

from routes.api_shared import api
from services import scrapling_service


_COMPETITOR_FETCH_JOBS = {}


@api.route("/scrapling/health", methods=["GET"])
def scrapling_health():
    return jsonify(scrapling_service.health())


@api.route("/scrapling/detail-capture", methods=["POST"])
def scrapling_detail_capture():
    payload = request.get_json(silent=True) or {}
    products = payload.get("products")
    if not isinstance(products, list) or not products:
        return jsonify({"ok": False, "error": "products 배열에 상세수집 후보를 넣어주세요."}), 400
    try:
        result = scrapling_service.capture_details(payload)
    except scrapling_service.ScraplingRequestError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except scrapling_service.ScraplingUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 503
    return jsonify(result), (200 if result.get("ok") else 422)


@api.route("/competitor/fetch-url", methods=["POST"])
def competitor_fetch_url():
    payload = request.get_json(silent=True) or {}
    try:
        html_text = scrapling_service.fetch_url_html_text(payload.get("url"))
    except scrapling_service.ScraplingRequestError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except scrapling_service.ScraplingUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 503
    job_id = f"competitor_{uuid.uuid4().hex}"
    _COMPETITOR_FETCH_JOBS[job_id] = {
        "status": "done",
        "result": {"html_text": html_text},
    }
    return jsonify({"job_id": job_id}), 202


@api.route("/competitor/job/<job_id>", methods=["GET"])
def competitor_fetch_job(job_id: str):
    job = _COMPETITOR_FETCH_JOBS.get(job_id)
    if job is None:
        return jsonify({"status": "error", "error": "경쟁사 수집 작업을 찾지 못했습니다."}), 404
    return jsonify(job)
