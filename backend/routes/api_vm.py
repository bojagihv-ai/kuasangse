from __future__ import annotations

from flask import jsonify, request

from routes.api_shared import api
from services import vm_candidate_bridge


@api.route("/vm-candidate-search", methods=["POST"])
def submit_vm_candidate_search():
    payload = request.get_json(silent=True) or {}
    worker_payload = payload.get("worker_payload") if isinstance(payload.get("worker_payload"), dict) else payload.get("payload")
    identity = payload.get("identity") if isinstance(payload.get("identity"), dict) else {}
    if not isinstance(worker_payload, dict):
        return jsonify({"ok": False, "error": "worker_payload가 필요합니다."}), 400
    try:
        return jsonify(vm_candidate_bridge.submit(worker_payload, identity)), 202
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except OSError as exc:
        return jsonify({"ok": False, "error": f"VM 공유폴더에 요청을 기록하지 못했습니다: {exc}"}), 503


@api.route("/vm-candidate-search/<job_id>", methods=["GET"])
def read_vm_candidate_search(job_id: str):
    result = vm_candidate_bridge.read_job(job_id)
    result["bridge_version"] = "vm-shared-folder-v1"
    status = result.get("status")
    if status == "not_found":
        return jsonify(result), 404
    if status == "invalid_job_id":
        return jsonify(result), 400
    return jsonify(result)
