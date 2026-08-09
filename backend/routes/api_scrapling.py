from __future__ import annotations

from flask import jsonify, request

from routes.api_shared import api
from services import scrapling_service


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
