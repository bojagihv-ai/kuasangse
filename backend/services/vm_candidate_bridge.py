from __future__ import annotations
# noqa: SIZE_OK — bridge lifecycle and job-state locking must remain in this owned module.

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Final, Literal, assert_never

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_BRIDGE_ROOT = _ROOT / "output" / "vm-rebuild" / "vm-candidate-bridge"
_BRIDGE_ROOT = Path(os.getenv("KUASANGSE_VM_CANDIDATE_BRIDGE_DIR", str(_DEFAULT_BRIDGE_ROOT)))
_WATCHER_SCRIPT = _ROOT / "tools" / "vm_candidate_file_bridge.ps1"
_WATCHER_STATE_ROOT = Path(r"C:\ProgramData\JepumVMWorker")
_WATCHER_ENV_PATH = Path(r"C:\JepumScraper\.env")
_WATCHER_WORKER_BASE = "http://127.0.0.1:5002"
_LOCK = threading.Lock()
_WATCHER_START_LOCK = threading.Lock()
_WATCHER_PROCESS: subprocess.Popen[bytes] | None = None
_SAFE_JOB = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
_SUBMIT_READY_TIMEOUT_SECONDS: Final = 25.0
_WATCHER_BOOT_TIMEOUT_SECONDS: Final = 5.0
_WATCHER_HEARTBEAT_MAX_AGE_SECONDS: Final = 8.0
_ACTIVE_JOB_STATUSES: Final = frozenset({"starting", "submitted", "polling"})
_WATCHER_UNRESPONSIVE_CODE: Final = "vm_bridge_watcher_unresponsive"
_WATCHER_BUSY_MESSAGE: Final = "VM 워커가 다른 작업을 처리 중입니다. 대기열에서 기다립니다."
_DEFAULT_VM_NAME: Final = "Codex-AHK-TrainingRoom"
BridgeOperation = Literal["candidate_search", "detail_capture"]


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


def _read_artifact_manifest(result_dir: Path) -> list[dict[str, Any]]:
    manifest_path = result_dir / "artifact_manifest.json"
    try:
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except (OSError, TypeError, ValueError):
        return []
    rows = raw_manifest if isinstance(raw_manifest, list) else [raw_manifest]
    return [row for row in rows if isinstance(row, dict)]


def _artifact_path_from_manifest(
    result_dir: Path,
    artifact: dict[str, Any],
) -> Path | None:
    artifact_root = (result_dir / "artifacts").resolve()
    relative_path = str(artifact.get("relative_path", "")).strip()
    if relative_path:
        path = (result_dir / relative_path).resolve()
    else:
        product_id = re.sub(
            r"[^\w.-]+",
            "_",
            str(artifact.get("product_id", "")).strip(),
        ).strip("._") or "product"
        file_name = str(artifact.get("file_name", "")).strip()
        if not file_name or "/" in file_name or "\\" in file_name:
            return None
        path = (artifact_root / product_id / file_name).resolve()
    if not path.is_relative_to(artifact_root) or not path.is_file():
        return None
    return path


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    temp.replace(path)


def _watcher_heartbeat_path() -> Path:
    return _BRIDGE_ROOT / ".host-watcher.heartbeat"


def _watcher_heartbeat_is_fresh() -> bool:
    try:
        age_seconds = time.time() - _watcher_heartbeat_path().stat().st_mtime
    except OSError:
        return False
    return age_seconds <= _WATCHER_HEARTBEAT_MAX_AGE_SECONDS


def _watcher_is_responsive() -> bool:
    return _watcher_heartbeat_is_fresh()


def _detail_job_dirs():
    results = _BRIDGE_ROOT / "results"
    try:
        return sorted(
            (path for path in results.iterdir()
             if path.is_dir() and path.name.startswith("vm_detail_")),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return []


_DETAIL_STALL_SECONDS: Final = 240.0
_DETAIL_TERMINAL = frozenset({"completed", "success", "done", "error", "failed", "cancelled"})


def detail_capture_readiness() -> dict:
    """상세수집 VM 경로가 지금 쓸 만한지 답한다.

    **후보검색용 하트비트와 상세수집은 서로 다른 경로다.** 실측 2026-08-31:
    .host-watcher.heartbeat 가 41시간 낡아 있는 동안에도 vm_detail 작업 12건이 전부
    completed/success 로 끝났다. 그래서 하트비트로 상세수집을 막으면 멀쩡한 VM 을 막는다.
    (내가 실제로 그렇게 막았다 — 사용자가 "VM 잘 되는데 왜 안 된다고 하냐" 고 지적했다.)

    그래서 막는 것은 "직전 요청이 눈에 보이게 멎어 있을 때" 뿐이다. 근거가 없으면 통과시킨다.
    """
    for job_dir in _detail_job_dirs()[:3]:
        status = _read_json(job_dir / "status.json") or {}
        state = str(status.get("status") or "").lower()
        vm_state = str(status.get("vm_status") or "").lower()
        if state in _DETAIL_TERMINAL or vm_state in _DETAIL_TERMINAL:
            return {
                "ok": True,
                "detailPathUsable": True,
                "lastJob": job_dir.name,
                "lastStatus": state or vm_state,
                "message": "",
            }
        if state == "queued":
            try:
                age = time.time() - (job_dir / "status.json").stat().st_mtime
            except OSError:
                age = 0.0
            if age > _DETAIL_STALL_SECONDS:
                return {
                    "ok": False,
                    "detailPathUsable": False,
                    "lastJob": job_dir.name,
                    "lastStatus": "queued",
                    "queuedAgeSeconds": round(age, 1),
                    "reason": "vm_detail_capture_stalled",
                    "message": (
                        f"직전 VM 상세수집 요청이 {int(age)}초째 접수만 된 채 멈춰 있습니다. "
                        "VM 안의 수집 워커를 확인해 주세요. 그동안은 본컴 경로로 진행합니다."
                    ),
                }
            break
    return {
        "ok": True,
        "detailPathUsable": True,
        "lastJob": "",
        "lastStatus": "",
        "message": "",
    }


def watcher_readiness() -> dict:
    """VM 경로 상태를 한 번의 파일 확인으로 답한다.

    두 경로를 **따로** 답한다. 후보검색은 .host-watcher.heartbeat 로 판정하고,
    상세수집은 직전 vm_detail 작업이 실제로 응답했는지로 판정한다. 이 둘을 섞으면
    한쪽 고장으로 멀쩡한 다른 쪽을 막게 된다 - 실측 2026-08-31.

    화면의 상세수집 게이트는 detailPathUsable 만 본다.
    """
    detail = detail_capture_readiness()
    path = _watcher_heartbeat_path()
    try:
        age_seconds = round(time.time() - path.stat().st_mtime, 1)
        candidate_alive = age_seconds <= _WATCHER_HEARTBEAT_MAX_AGE_SECONDS
    except OSError:
        age_seconds = None
        candidate_alive = False
    return {
        **detail,
        "candidateWatcherAlive": candidate_alive,
        "heartbeatAgeSeconds": age_seconds,
        "maxAgeSeconds": _WATCHER_HEARTBEAT_MAX_AGE_SECONDS,
    }


def _vboxmanage_path() -> Path | None:
    configured = str(os.getenv("KUASANGSE_VBOXMANAGE", "")).strip()
    if configured:
        candidate = Path(configured)
        return candidate if candidate.is_file() else None
    installed = Path(r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe")
    if installed.is_file():
        return installed
    located = shutil.which("VBoxManage")
    return Path(located) if located else None


def _wake_vm_display_for_gui_job() -> bool:
    try:
        if _BRIDGE_ROOT.resolve() != _DEFAULT_BRIDGE_ROOT.resolve():
            return False
    except OSError:
        return False
    executable = _vboxmanage_path()
    if executable is None:
        return False
    vm_name = str(os.getenv("KUASANGSE_VM_NAME", _DEFAULT_VM_NAME)).strip() or _DEFAULT_VM_NAME
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        completed = subprocess.run(
            [
                str(executable),
                "controlvm",
                vm_name,
                "keyboardputscancode",
                "2a",
                "aa",
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            creationflags=creation_flags,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def _watcher_has_active_job(exclude_job_id: str) -> bool:
    for status_path in (_BRIDGE_ROOT / "results").glob("*/status.json"):
        if status_path.parent.name == exclude_job_id:
            continue
        if not (status_path.parent / ".processing").is_file():
            continue
        status_name = str(_read_json(status_path).get("status", "")).strip().lower()
        if status_name in _ACTIVE_JOB_STATUSES:
            return True
    return False


def _queued_response_for_watcher(job_id: str, response: dict[str, Any]) -> dict[str, Any]:
    if not _watcher_heartbeat_is_fresh() or not _watcher_has_active_job(job_id):
        return response
    progress = {"message": _WATCHER_BUSY_MESSAGE}
    status_path = _BRIDGE_ROOT / "results" / job_id / "status.json"
    with _LOCK:
        status = _read_json(status_path)
        if str(status.get("status", "")).strip().lower() != "queued":
            return response
        status.update({
            "queue_state": "watcher_busy",
            "progress": progress,
            "updated_at": time.time(),
        })
        _write_json(status_path, status)
    decorated = dict(response)
    decorated.update({"queue_state": "watcher_busy", "progress": progress})
    return decorated


def _ensure_host_watcher(deadline: float) -> None:
    with _WATCHER_START_LOCK:
        boot_deadline = min(deadline, time.monotonic() + _WATCHER_BOOT_TIMEOUT_SECONDS)
        while time.monotonic() < boot_deadline:
            if _watcher_heartbeat_is_fresh():
                return
            time.sleep(0.1)
        raise OSError(
            "VM 내부 후보 수집 watcher가 준비되지 않았습니다. "
            "VirtualBox GUI와 VM 워커가 준비된 뒤 다시 시도해주세요.",
        )


def _wait_for_watcher_claim(job_id: str, deadline: float) -> bool:
    result_dir = _BRIDGE_ROOT / "results" / job_id
    status_path = result_dir / "status.json"
    while time.monotonic() < deadline:
        if (result_dir / ".processing").is_file():
            return True
        status = str(_read_json(status_path).get("status", "")).strip().lower()
        if status and status != "queued":
            return True
        time.sleep(0.1)
    return (result_dir / ".processing").is_file()


def _mark_job_error(job_id: str, error_code: str, error: str) -> dict[str, Any] | None:
    result_dir = _BRIDGE_ROOT / "results" / job_id
    try:
        (result_dir / ".processing").touch(exist_ok=False)
    except FileExistsError:
        return None
    _write_json(result_dir / "cancelled.json", {
        "job_id": job_id,
        "error_code": error_code,
        "cancelled_at": time.time(),
    })
    status_path = result_dir / "status.json"
    status = _read_json(status_path)
    status.pop("queue_state", None)
    status.pop("progress", None)
    status.update({
        "ok": False,
        "job_id": job_id,
        "status": "error",
        "transport": "shared_folder",
        "search_runtime": "vm",
        "error_code": error_code,
        "error": error,
        "updated_at": time.time(),
    })
    with _LOCK:
        _write_json(status_path, status)
    return read_job(job_id)


def _submit(
    payload: dict[str, Any],
    identity: dict[str, Any],
    operation: BridgeOperation,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("VM 후보 요청은 JSON 객체여야 합니다.")
    display_wake_sent = _wake_vm_display_for_gui_job()
    worker_payload = dict(payload)
    raw_options = worker_payload.get("options")
    options = dict(raw_options) if isinstance(raw_options, dict) else {}
    match operation:
        case "candidate_search":
            worker_payload.setdefault("execution_profile", "ui_parity")
            worker_payload.setdefault("browser_visibility", "gui")
            options.setdefault("search_runtime", "local")
            options.setdefault("candidate_runtime", "local")
            options.setdefault("runtime", "local")
            options.setdefault("execution_profile", "ui_parity")
            options.setdefault("browser_visibility", "gui")
            runtime_field = "search_runtime"
        case "detail_capture":
            options.update({
                "capture_runtime": "local",
                "runtime": "local",
                "transport": "shared_folder",
            })
            runtime_field = "capture_runtime"
        case unreachable:
            assert_never(unreachable)
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
        "operation": operation,
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
            "vm_display_wake_sent": display_wake_sent,
            runtime_field: "vm",
            "created_at": request["created_at"],
        })
    queued_response = {
        "ok": True,
        "job_id": job_id,
        "status": "queued",
        "transport": "shared_folder",
        "vm_display_wake_sent": display_wake_sent,
        runtime_field: "vm",
        "identity": request["identity"],
    }
    deadline = time.monotonic() + _SUBMIT_READY_TIMEOUT_SECONDS
    try:
        _ensure_host_watcher(deadline)
    except OSError as exc:
        if _watcher_is_responsive():
            return _queued_response_for_watcher(job_id, queued_response)
        failure = _mark_job_error(
            job_id,
            "vm_bridge_guest_watcher_unavailable",
            f"VM 내부 후보 수집 watcher를 확인하지 못했습니다: {exc}",
        )
        return failure or read_job(job_id)
    if _watcher_is_responsive():
        return _queued_response_for_watcher(job_id, queued_response)
    if not _wait_for_watcher_claim(job_id, deadline) and not _watcher_is_responsive():
        failure = _mark_job_error(
            job_id,
            _WATCHER_UNRESPONSIVE_CODE,
            "VM 후보 bridge watcher가 25초 안에 작업을 가져가지 않았습니다. "
            "watcher 실행 상태와 공유폴더 쓰기 권한을 확인해주세요.",
        )
        return failure or read_job(job_id)
    return _queued_response_for_watcher(job_id, queued_response)


def submit(payload: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
    return _submit(payload, identity, "candidate_search")


def submit_detail_capture(payload: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
    return _submit(payload, identity, "detail_capture")


def list_recent_detail_jobs(identity: dict[str, Any], limit: int = 8) -> list[dict[str, Any]]:
    expected = identity if isinstance(identity, dict) else {}
    identity_fields = ("currentRunId", "productKey", "inputImageFingerprint", "stageId")
    request_paths = sorted(
        (_BRIDGE_ROOT / "requests").glob("vm_candidate_*.json"),
        key=lambda path: path.stat().st_mtime if path.is_file() else 0.0,
        reverse=True,
    )
    jobs: list[dict[str, Any]] = []
    for request_path in request_paths:
        request = _read_json(request_path)
        if request.get("operation") != "detail_capture":
            continue
        request_identity = request.get("identity") if isinstance(request.get("identity"), dict) else {}
        if any(
            str(expected.get(field, "")).strip()
            and str(request_identity.get(field, "")).strip() != str(expected.get(field, "")).strip()
            for field in identity_fields
        ):
            continue
        job = read_job(str(request.get("job_id", "")))
        if job.get("status") not in {"invalid_job_id", "not_found"}:
            jobs.append(job)
        if len(jobs) >= max(1, min(int(limit or 8), 24)):
            break
    return jobs


def list_recent_candidate_jobs(
    identity: dict[str, Any],
    keyword: str = "",
    limit: int = 8,
) -> list[dict[str, Any]]:
    expected = identity if isinstance(identity, dict) else {}
    expected_keyword = str(keyword or "").strip().casefold()
    identity_fields = ("currentRunId", "productKey", "inputImageFingerprint", "stageId")
    request_paths = sorted(
        (_BRIDGE_ROOT / "requests").glob("vm_candidate_*.json"),
        key=lambda path: path.stat().st_mtime if path.is_file() else 0.0,
        reverse=True,
    )
    jobs: list[dict[str, Any]] = []
    for request_path in request_paths:
        request = _read_json(request_path)
        if request.get("operation") != "candidate_search":
            continue
        request_identity = request.get("identity") if isinstance(request.get("identity"), dict) else {}
        if any(
            str(expected.get(field, "")).strip()
            and str(request_identity.get(field, "")).strip() != str(expected.get(field, "")).strip()
            for field in identity_fields
        ):
            continue
        worker_payload = request.get("worker_payload") if isinstance(request.get("worker_payload"), dict) else {}
        request_keyword = str(worker_payload.get("keyword", "")).strip().casefold()
        if expected_keyword and request_keyword != expected_keyword:
            continue
        job = read_job(str(request.get("job_id", "")))
        if job.get("status") == "completed" and job.get("ok") is True:
            jobs.append(job)
        if len(jobs) >= max(1, min(int(limit or 8), 100)):
            break
    return jobs


def _recover_silent_naver_manual_gate(
    request: dict[str, Any],
    response: dict[str, Any],
) -> dict[str, Any]:
    if (
        request.get("operation") != "detail_capture"
        or str(response.get("status", "")).lower() not in {"error", "failed"}
        or str(response.get("error", "")).strip()
        or str(response.get("error_code", "")).strip()
        or response.get("manual_action_required") is True
    ):
        return response
    worker_payload = request.get("worker_payload")
    products = worker_payload.get("products") if isinstance(worker_payload, dict) else []
    if not isinstance(products, list):
        return response
    naver_product = next((
        product
        for product in products
        if isinstance(product, dict)
        and "naver" in " ".join((
            str(product.get("platform", "")),
            str(product.get("product_url", product.get("url", ""))),
        )).lower()
    ), None)
    if naver_product is None:
        return response
    manual_item = {
        "product_id": str(naver_product.get("product_id", naver_product.get("id", ""))),
        "product_url": str(naver_product.get("product_url", naver_product.get("url", ""))),
        "title": str(naver_product.get("title", "")),
        "platform": "naver",
        "status": "manual_required",
        "manual_required": True,
        "manual_kind": "receipt_or_human_verification",
        "manual_title": "네이버 영수증문제입니다",
        "manual_message": "VM 화면에 표시된 답을 입력해주십시오. 입력 후 사용자 조치 완료 버튼으로 같은 상품을 다시 수집합니다.",
        "manual_location": "VM 화면",
    }
    response.update({
        "ok": False,
        "status": "manual_required",
        "error": "",
        "error_code": "naver_manual_verification_suspected",
        "manual_action_required": True,
        "manual_items": [manual_item],
        "manual_wait_remaining_sec": 0,
        "detail_summary": {
            "total": max(1, int(response.get("total", 0) or 0)),
            "success": 0,
            "failed": 0,
            "manual_action_required": True,
            "manual_items": [manual_item],
        },
    })
    return response


def read_job(job_id: str) -> dict[str, Any]:
    safe_id = _safe_job_id(job_id)
    if not safe_id:
        return {"ok": False, "status": "invalid_job_id", "error": "잘못된 VM 후보 작업 ID입니다."}
    request_path = _BRIDGE_ROOT / "requests" / f"{safe_id}.json"
    result_dir = _BRIDGE_ROOT / "results" / safe_id
    if not request_path.is_file():
        return {"ok": False, "status": "not_found", "error": "VM 후보 작업을 찾지 못했습니다."}
    request = _read_json(request_path)
    operation = str(request.get("operation", "candidate_search"))
    status = _read_json(result_dir / "status.json")
    result = _read_json(result_dir / "result.json")
    error_path = result_dir / "error.txt"
    error = error_path.read_text(encoding="utf-8-sig", errors="replace").strip() if error_path.is_file() else ""
    status_name = str(status.get("status", "queued"))
    try:
        queued_age = time.time() - float(status.get("created_at", request.get("created_at", 0)))
    except (TypeError, ValueError):
        queued_age = 0.0
    claimed = (result_dir / ".processing").is_file()
    stale_queued = (
        status_name == "queued"
        and queued_age >= _SUBMIT_READY_TIMEOUT_SECONDS
        and not claimed
        and not _watcher_is_responsive()
    )
    if stale_queued:
        failure = _mark_job_error(
            safe_id,
            _WATCHER_UNRESPONSIVE_CODE,
            "VM 후보 bridge watcher가 25초 안에 작업을 가져가지 않았습니다. "
            "watcher 실행 상태와 공유폴더 쓰기 권한을 확인해주세요.",
        )
        return failure or read_job(safe_id)
    response: dict[str, Any] = {
        "ok": bool(status.get("ok", True)) and status_name not in {"error", "failed"},
        "job_id": safe_id,
        "status": status_name,
        "queue_state": status.get("queue_state", ""),
        "transport": "shared_folder",
        "search_runtime": "vm",
        "identity": request.get("identity") if isinstance(request.get("identity"), dict) else {},
        "progress": status.get("progress") if isinstance(status.get("progress"), dict) else {},
        "search_id": status.get("search_id", ""),
        "vm_search_id": status.get("vm_search_id", ""),
        "error": error or status.get("error", ""),
        "error_code": status.get("error_code", ""),
        "updated_at": status.get("updated_at", ""),
    }
    if operation == "detail_capture":
        response.update({
            "capture_runtime": "vm",
            "vm_job_id": status.get("vm_job_id", ""),
            "vm_status": status.get("vm_status", status.get("worker_status", "")),
            "completed": status.get("completed", 0),
            "failed": status.get("failed", 0),
            "total": status.get("total", 0),
            "manual_action_required": bool(status.get("manual_action_required", False)),
            "manual_items": status.get("manual_items", []),
            "manual_wait_remaining_sec": status.get("manual_wait_remaining_sec", 0),
            "detail_summary": status.get("detail_summary", {}),
        })
    if result:
        response["result"] = result.get("result", result)
        response["search_id"] = response["search_id"] or result.get("search_id", "")
        response["vm_search_id"] = response["vm_search_id"] or result.get("vm_search_id", "")
    if operation == "detail_capture" and isinstance(response.get("result"), dict):
        manifest = _read_artifact_manifest(result_dir)
        scraped_data = response["result"].setdefault("scraped_data", {})
        if isinstance(scraped_data, dict):
            artifact_urls_by_product: dict[str, list[str]] = {}
            for artifact_index, artifact in enumerate(manifest):
                if _artifact_path_from_manifest(result_dir, artifact) is None:
                    continue
                product_id = str(artifact.get("product_id", "")).strip()
                if not product_id:
                    continue
                artifact_urls_by_product.setdefault(product_id, []).append(
                    f"/api/vm-detail-capture/{safe_id}/artifacts/{artifact_index}",
                )
            for product_id, artifact_urls in artifact_urls_by_product.items():
                detail = scraped_data.setdefault(product_id, {})
                if not isinstance(detail, dict):
                    continue
                guest_sources = [
                    value
                    for field in ("screenshots", "screenshot_paths", "screenshot_urls")
                    for value in (
                        detail.get(field, [])
                        if isinstance(detail.get(field), list)
                        else [detail.get(field)]
                    )
                    if isinstance(value, str) and value.strip()
                ]
                if guest_sources:
                    detail["vm_guest_screenshot_sources"] = list(
                        dict.fromkeys(guest_sources),
                    )
                detail["screenshots"] = list(artifact_urls)
                detail["screenshot_paths"] = list(artifact_urls)
                detail["screenshot_urls"] = list(artifact_urls)
    return _recover_silent_naver_manual_gate(request, response)


def read_artifact(job_id: str, artifact_index: int) -> Path | None:
    safe_id = _safe_job_id(job_id)
    if not safe_id or artifact_index < 0:
        return None
    result_dir = (_BRIDGE_ROOT / "results" / safe_id).resolve()
    manifest = _read_artifact_manifest(result_dir)
    if artifact_index >= len(manifest):
        return None
    artifact = manifest[artifact_index]
    return _artifact_path_from_manifest(result_dir, artifact)
