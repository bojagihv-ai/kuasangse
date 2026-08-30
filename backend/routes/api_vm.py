from __future__ import annotations

from flask import jsonify, request, send_file

from routes.api_shared import api
from services import vm_candidate_bridge


@api.route("/vm-bridge/readiness", methods=["GET"])
def vm_bridge_readiness():
    """VM 경로를 쓸 수 있는지 값싸게 답한다(파일 stat 한 번)."""
    return jsonify(vm_candidate_bridge.watcher_readiness())


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


@api.route("/vm-detail-capture", methods=["POST"])
def submit_vm_detail_capture():
    payload = request.get_json(silent=True) or {}
    worker_payload = payload.get("worker_payload") if isinstance(payload.get("worker_payload"), dict) else payload.get("payload")
    identity = payload.get("identity") if isinstance(payload.get("identity"), dict) else {}
    if not isinstance(worker_payload, dict):
        return jsonify({"ok": False, "error": "worker_payload가 필요합니다."}), 400
    try:
        return jsonify(vm_candidate_bridge.submit_detail_capture(worker_payload, identity)), 202
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except OSError as exc:
        return jsonify({"ok": False, "error": f"VM 공유폴더에 상세수집 요청을 기록하지 못했습니다: {exc}"}), 503


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


@api.route("/vm-detail-capture/<job_id>", methods=["GET"])
def read_vm_detail_capture(job_id: str):
    result = vm_candidate_bridge.read_job(job_id)
    result["bridge_version"] = "vm-shared-folder-v1"
    status = result.get("status")
    if status == "not_found":
        return jsonify(result), 404
    if status == "invalid_job_id":
        return jsonify(result), 400
    return jsonify(result)


@api.route("/vm-detail-captures/recent", methods=["GET"])
def read_recent_vm_detail_captures():
    identity = {
        field: request.args.get(field, "")
        for field in ("currentRunId", "productKey", "inputImageFingerprint", "stageId")
        if request.args.get(field, "")
    }
    try:
        limit = max(1, min(int(request.args.get("limit", "8")), 24))
    except ValueError:
        limit = 8
    jobs = vm_candidate_bridge.list_recent_detail_jobs(identity, limit)
    return jsonify({"ok": True, "count": len(jobs), "jobs": jobs})


@api.route("/vm-candidate-searches/recent", methods=["GET"])
def read_recent_vm_candidate_searches():
    identity = {
        field: request.args.get(field, "")
        for field in ("currentRunId", "productKey", "inputImageFingerprint", "stageId")
        if request.args.get(field, "")
    }
    keyword = request.args.get("keyword", "")
    try:
        limit = max(1, min(int(request.args.get("limit", "8")), 100))
    except ValueError:
        limit = 8
    jobs = vm_candidate_bridge.list_recent_candidate_jobs(identity, keyword, limit)
    return jsonify({"ok": True, "count": len(jobs), "jobs": jobs})


@api.route("/vm-detail-capture/<job_id>/artifacts/<int:artifact_index>", methods=["GET"])
def read_vm_detail_capture_artifact(job_id: str, artifact_index: int):
    artifact_path = vm_candidate_bridge.read_artifact(job_id, artifact_index)
    if artifact_path is None:
        return jsonify({"ok": False, "error": "VM 상세수집 이미지 파일을 찾지 못했습니다."}), 404
    return send_file(artifact_path)
