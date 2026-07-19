from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any


_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_BRIDGE_ROOT = _ROOT / "output" / "vm-rebuild" / "vm-candidate-bridge"
_BRIDGE_ROOT = Path(os.getenv("KUASANGSE_VM_CANDIDATE_BRIDGE_DIR", str(_DEFAULT_BRIDGE_ROOT)))
_LOCK = threading.Lock()
_SAFE_JOB = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


def bridge_root() -> Path:
    return _BRIDGE_ROOT


def _safe_job_id(value: Any) -> str:
    text = str(value or "").strip()
    return text if _SAFE_JOB.fullmatch(text) else ""


def _read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    temp.replace(path)


def submit(payload: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("VM 후보 요청은 JSON 객체여야 합니다.")
    worker_payload = dict(payload)
    raw_options = worker_payload.get("options")
    options = dict(raw_options) if isinstance(raw_options, dict) else {}
    options.setdefault("search_runtime", "local")
    options.setdefault("candidate_runtime", "local")
    options.setdefault("runtime", "local")
    worker_payload["options"] = options
    encoded_size = len(json.dumps(worker_payload, ensure_ascii=False).encode("utf-8"))
    if encoded_size > 16 * 1024 * 1024:
        raise ValueError("VM 후보 요청 이미지/본문이 너무 큽니다.")
    job_id = f"vm_candidate_{uuid.uuid4().hex}"
    request_path = _BRIDGE_ROOT / "requests" / f"{job_id}.json"
    result_dir = _BRIDGE_ROOT / "results" / job_id
    request = {
        "job_id": job_id,
        "created_at": time.time(),
        "operation": "candidate_search",
        "identity": identity if isinstance(identity, dict) else {},
        "worker_payload": worker_payload,
    }
    with _LOCK:
        _write_json(request_path, request)
        _write_json(result_dir / "status.json", {
            "ok": True,
            "job_id": job_id,
            "status": "queued",
            "transport": "shared_folder",
            "search_runtime": "vm",
            "created_at": request["created_at"],
        })
    return {
        "ok": True,
        "job_id": job_id,
        "status": "queued",
        "transport": "shared_folder",
        "search_runtime": "vm",
        "identity": request["identity"],
    }


def read_job(job_id: str) -> dict[str, Any]:
    safe_id = _safe_job_id(job_id)
    if not safe_id:
        return {"ok": False, "status": "invalid_job_id", "error": "잘못된 VM 후보 작업 ID입니다."}
    request_path = _BRIDGE_ROOT / "requests" / f"{safe_id}.json"
    result_dir = _BRIDGE_ROOT / "results" / safe_id
    if not request_path.is_file():
        return {"ok": False, "status": "not_found", "error": "VM 후보 작업을 찾지 못했습니다."}
    request = _read_json(request_path)
    status = _read_json(result_dir / "status.json")
    result = _read_json(result_dir / "result.json")
    error_path = result_dir / "error.txt"
    error = error_path.read_text(encoding="utf-8-sig", errors="replace").strip() if error_path.is_file() else ""
    response: dict[str, Any] = {
        "ok": bool(status.get("ok", True)) and status.get("status") not in {"error", "failed"},
        "job_id": safe_id,
        "status": status.get("status", "queued"),
        "transport": "shared_folder",
        "search_runtime": "vm",
        "identity": request.get("identity") if isinstance(request.get("identity"), dict) else {},
        "progress": status.get("progress") if isinstance(status.get("progress"), dict) else {},
        "search_id": status.get("search_id", ""),
        "vm_search_id": status.get("vm_search_id", ""),
        "error": error or status.get("error", ""),
        "updated_at": status.get("updated_at", ""),
    }
    if result:
        response["result"] = result.get("result", result)
        response["search_id"] = response["search_id"] or result.get("search_id", "")
        response["vm_search_id"] = response["vm_search_id"] or result.get("vm_search_id", "")
    return response
