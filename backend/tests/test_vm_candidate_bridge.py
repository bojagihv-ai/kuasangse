from __future__ import annotations
# noqa: SIZE_OK — required real PowerShell lifecycle scenarios share one owned bridge test seam.

import json
import os
import subprocess
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

from backend.services import vm_candidate_bridge

_FAKE_API_KEY = "vm-bridge-test-key-not-a-real-secret"


class _FakeWorkerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _FakeWorkerHandler)
        self.authenticated_requests = 0
        self.post_keywords: list[str] = []
        self.slow_post_started = threading.Event()
        self.release_slow_post = threading.Event()


class _FakeWorkerHandler(BaseHTTPRequestHandler):
    server: _FakeWorkerServer

    def _send_json(
        self,
        payload: dict[str, str | int | list[str]],
        status: int = 200,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if self.headers.get("X-API-Key", "") != _FAKE_API_KEY:
            self._send_json({"error": "unauthorized"}, status=401)
            return False
        self.server.authenticated_requests += 1
        return True

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            return
        path = urlsplit(self.path).path
        if path == "/api/v1/health":
            self._send_json({"status": "ok"})
        elif path == "/api/progress":
            self._send_json({"events": []})
        elif path.endswith("/results"):
            self._send_json({"status": "success", "total": 0, "marketReports": []})
        else:
            self._send_json(
                {"status": "success", "total": 0, "age_seconds": 0, "marketReports": []},
            )

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)
        if not self._authorized():
            return
        parsed = json.loads(raw_body.decode("utf-8"))
        keyword = str(parsed.get("keyword", "")) if isinstance(parsed, dict) else ""
        self.server.post_keywords.append(keyword)
        if keyword == "slow-blocking":
            self.server.slow_post_started.set()
            self.server.release_slow_post.wait(timeout=45)
        search_id = f"fake-search-{len(self.server.post_keywords)}"
        self._send_json({"search_id": search_id, "status": "success"})

    def log_message(self, _format: str, *_args: str) -> None:
        return


@dataclass(frozen=True, slots=True)
class _PowerShellBridgeHarness:
    bridge_root: Path
    state_root: Path
    heartbeat_path: Path
    server: _FakeWorkerServer
    watcher: subprocess.Popen[bytes]
    watcher_command: tuple[str, ...]


def _wait_for_path(path: Path, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for path: {path}")


def _wait_for_job_status(job_id: str, expected: str, timeout: float = 12.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if vm_candidate_bridge.read_job(job_id).get("status") == expected:
            return
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not reach {expected}")


@pytest.fixture
def powershell_bridge(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[_PowerShellBridgeHarness]:
    bridge_root = tmp_path / "bridge"
    state_root = tmp_path / "state"
    env_path = tmp_path / ".env"
    heartbeat_path = bridge_root / ".host-watcher.heartbeat"
    bridge_root.mkdir()
    state_root.mkdir()
    env_path.write_text(f'JEPUM_API_KEY="{_FAKE_API_KEY}"\n', encoding="utf-8")
    server = _FakeWorkerServer()
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    watcher_command = (
        str(powershell),
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(vm_candidate_bridge._WATCHER_SCRIPT),
        "-BridgeRoot",
        str(bridge_root),
        "-WorkerBase",
        f"http://127.0.0.1:{server.server_port}",
        "-PollMilliseconds",
        "100",
        "-JobTimeoutSeconds",
        "15",
        "-StateRoot",
        str(state_root),
        "-WorkerEnvPath",
        str(env_path),
        "-HeartbeatPath",
        str(heartbeat_path),
    )
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", bridge_root)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_STATE_ROOT", state_root)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_ENV_PATH", env_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_WORKER_BASE", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    watcher = subprocess.Popen(
        watcher_command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        _wait_for_path(heartbeat_path)
        assert watcher.poll() is None
        yield _PowerShellBridgeHarness(
            bridge_root=bridge_root,
            state_root=state_root,
            heartbeat_path=heartbeat_path,
            server=server,
            watcher=watcher,
            watcher_command=watcher_command,
        )
    finally:
        server.release_slow_post.set()
        if watcher.poll() is None:
            watcher.terminate()
            watcher.wait(timeout=5)
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

@pytest.fixture
def ready_watcher(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_ensure_host_watcher",
        lambda _deadline: None,
        raising=False,
    )
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda _job_id, _deadline: True,
        raising=False,
    )


def test_gui_bridge_job_wakes_sleeping_vm_display(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []

    class Completed:
        returncode = 0

    monkeypatch.setattr(
        vm_candidate_bridge,
        "_BRIDGE_ROOT",
        vm_candidate_bridge._DEFAULT_BRIDGE_ROOT,
    )
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_vboxmanage_path",
        lambda: Path(r"C:\VirtualBox\VBoxManage.exe"),
        raising=False,
    )
    monkeypatch.setattr(
        vm_candidate_bridge.subprocess,
        "run",
        lambda args, **_kwargs: calls.append([str(value) for value in args]) or Completed(),
    )

    assert vm_candidate_bridge._wake_vm_display_for_gui_job() is True
    assert calls == [[
        r"C:\VirtualBox\VBoxManage.exe",
        "controlvm",
        "Codex-AHK-TrainingRoom",
        "keyboardputscancode",
        "2a",
        "aa",
    ]]


def test_submit_includes_options_for_legacy_vm_bridge(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    ready_watcher: None,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)

    # When
    result = vm_candidate_bridge.submit(
        {"keyword": "수저 파우치", "sites": ["coupang"]},
        {"productKey": "test-product"},
    )

    request_path = tmp_path / "requests" / f"{result['job_id']}.json"
    payload = json.loads(request_path.read_text(encoding="utf-8"))

    # Then
    assert payload["worker_payload"]["execution_profile"] == "ui_parity"
    assert payload["worker_payload"]["browser_visibility"] == "gui"
    assert payload["worker_payload"]["options"] == {
        "search_runtime": "local",
        "candidate_runtime": "local",
        "runtime": "local",
        "execution_profile": "ui_parity",
        "browser_visibility": "gui",
    }


def test_submit_detail_capture_preserves_visible_profile_for_guest_worker(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    ready_watcher: None,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    worker_payload = {
        "products": [{"product_id": "gmarket-2720455669", "url": "https://item.gmarket.co.kr/Item?goodscode=2720455669"}],
        "execution_profile": "ui_parity",
        "browser_visibility": "visible",
    }

    # When
    result = vm_candidate_bridge.submit_detail_capture(
        worker_payload,
        {"productKey": "mosi-pouch"},
    )
    request_path = tmp_path / "requests" / f"{result['job_id']}.json"
    request_payload = json.loads(request_path.read_text(encoding="utf-8"))

    # Then
    assert request_payload["operation"] == "detail_capture"
    assert request_payload["worker_payload"]["execution_profile"] == "ui_parity"
    assert request_payload["worker_payload"]["browser_visibility"] == "visible"
    assert request_payload["worker_payload"]["options"] == {
        "capture_runtime": "local",
        "runtime": "local",
        "transport": "shared_folder",
    }


def test_list_recent_detail_jobs_matches_exact_work_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    matching_id = "vm_candidate_11111111111111111111111111111111"
    foreign_id = "vm_candidate_22222222222222222222222222222222"
    for job_id, product_key in ((matching_id, "모시바둑파우치"), (foreign_id, "방울수저집")):
        request_path = tmp_path / "requests" / f"{job_id}.json"
        result_dir = tmp_path / "results" / job_id
        request_path.parent.mkdir(parents=True, exist_ok=True)
        result_dir.mkdir(parents=True, exist_ok=True)
        request_path.write_text(json.dumps({
            "job_id": job_id,
            "operation": "detail_capture",
            "identity": {
                "currentRunId": "run-current",
                "productKey": product_key,
                "inputImageFingerprint": "image-current",
                "stageId": "competitors",
            },
        }, ensure_ascii=False), encoding="utf-8")
        (result_dir / "status.json").write_text(json.dumps({
            "ok": True,
            "job_id": job_id,
            "status": "completed",
        }), encoding="utf-8")
        (result_dir / "result.json").write_text(json.dumps({
            "result": {"status": "partial_success", "manual_action_required": True},
        }), encoding="utf-8")

    # When
    jobs = vm_candidate_bridge.list_recent_detail_jobs({
        "currentRunId": "run-current",
        "productKey": "모시바둑파우치",
        "inputImageFingerprint": "image-current",
        "stageId": "competitors",
    })

    # Then
    assert [job["job_id"] for job in jobs] == [matching_id]
    assert jobs[0]["result"]["status"] == "partial_success"


def test_list_recent_candidate_jobs_matches_identity_and_keyword(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    matching_id = "vm_candidate_33333333333333333333333333333333"
    foreign_id = "vm_candidate_44444444444444444444444444444444"
    for job_id, keyword in ((matching_id, "바늘쌈"), (foreign_id, "파우치")):
        request_path = tmp_path / "requests" / f"{job_id}.json"
        result_dir = tmp_path / "results" / job_id
        request_path.parent.mkdir(parents=True, exist_ok=True)
        result_dir.mkdir(parents=True, exist_ok=True)
        request_path.write_text(json.dumps({
            "job_id": job_id,
            "operation": "candidate_search",
            "identity": {
                "currentRunId": "run-current",
                "productKey": "양단호박바늘쌈",
                "inputImageFingerprint": "image-current",
                "stageId": "competitors",
            },
            "worker_payload": {"keyword": keyword},
        }, ensure_ascii=False), encoding="utf-8")
        (result_dir / "status.json").write_text(json.dumps({
            "ok": True,
            "job_id": job_id,
            "status": "completed",
        }), encoding="utf-8")
        (result_dir / "result.json").write_text(json.dumps({
            "result": {
                "status": "success",
                "keyword": keyword,
                "products": [{"id": f"{keyword}-1", "platform": "네이버쇼핑"}],
            },
        }, ensure_ascii=False), encoding="utf-8")

    jobs = vm_candidate_bridge.list_recent_candidate_jobs({
        "currentRunId": "run-current",
        "productKey": "양단호박바늘쌈",
        "inputImageFingerprint": "image-current",
        "stageId": "competitors",
    }, "바늘쌈")

    assert [job["job_id"] for job in jobs] == [matching_id]
    assert jobs[0]["result"]["products"][0]["platform"] == "네이버쇼핑"


def test_list_recent_candidate_jobs_can_recover_up_to_one_hundred_jobs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    for index in range(30):
        job_id = f"vm_candidate_{index:032x}"
        request_path = tmp_path / "requests" / f"{job_id}.json"
        result_dir = tmp_path / "results" / job_id
        request_path.parent.mkdir(parents=True, exist_ok=True)
        result_dir.mkdir(parents=True, exist_ok=True)
        request_path.write_text(json.dumps({
            "job_id": job_id,
            "operation": "candidate_search",
            "identity": {"productKey": "양단호박바늘쌈"},
            "worker_payload": {"keyword": "양단호박바늘쌈"},
        }, ensure_ascii=False), encoding="utf-8")
        (result_dir / "status.json").write_text(json.dumps({
            "ok": True,
            "job_id": job_id,
            "status": "completed",
        }), encoding="utf-8")
        (result_dir / "result.json").write_text(json.dumps({
            "result": {
                "status": "success",
                "keyword": "양단호박바늘쌈",
                "products": [{"id": f"candidate-{index}", "platform": "네이버쇼핑"}],
            },
        }, ensure_ascii=False), encoding="utf-8")

    jobs = vm_candidate_bridge.list_recent_candidate_jobs(
        {"productKey": "양단호박바늘쌈"},
        "양단호박바늘쌈",
        100,
    )

    assert len(jobs) == 30


def test_submit_starts_watcher_and_waits_for_claim(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_ensure_host_watcher",
        lambda _deadline: calls.append(("ensure", "")),
        raising=False,
    )
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda job_id, _deadline: calls.append(("claim", job_id)) or True,
        raising=False,
    )

    # When
    result = vm_candidate_bridge.submit({"keyword": "파우치"}, {})

    # Then
    assert calls == [("ensure", ""), ("claim", result["job_id"])]
    assert result["ok"] is True


def test_vm_bridge_never_spawns_windows_host_watcher_when_guest_heartbeat_is_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: the VM guest watcher has not announced readiness after a cold boot.
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    monkeypatch.setattr(vm_candidate_bridge, "_watcher_heartbeat_is_fresh", lambda: False)
    monkeypatch.setattr(
        vm_candidate_bridge.subprocess,
        "Popen",
        lambda *_args, **_kwargs: pytest.fail("Windows host watcher must never be spawned"),
    )

    # When / Then: bridge readiness fails closed without starting host automation.
    with pytest.raises(OSError, match="VM 내부"):
        vm_candidate_bridge._ensure_host_watcher(time.monotonic() + 0.01)


def test_submit_returns_actionable_error_when_watcher_does_not_claim(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_ensure_host_watcher",
        lambda _deadline: None,
        raising=False,
    )
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda _job_id, _deadline: False,
        raising=False,
    )

    # When
    result = vm_candidate_bridge.submit({"keyword": "파우치"}, {})

    # Then
    status_path = tmp_path / "results" / result["job_id"] / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert result["ok"] is False
    assert result["status"] == "error"
    assert result["error_code"] == "vm_bridge_watcher_unresponsive"
    assert status["error_code"] == result["error_code"]


def test_submit_returns_actionable_error_when_guest_watcher_is_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    def fail_readiness(_deadline: float) -> None:
        raise OSError("guest watcher heartbeat missing")

    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_ensure_host_watcher",
        fail_readiness,
        raising=False,
    )
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda _job_id, _deadline: pytest.fail("claim wait must not run"),
        raising=False,
    )

    # When
    result = vm_candidate_bridge.submit({"keyword": "파우치"}, {})

    # Then
    assert result["ok"] is False
    assert result["status"] == "error"
    assert result["error_code"] == "vm_bridge_guest_watcher_unavailable"
    assert "guest watcher heartbeat missing" in result["error"]


def test_ensure_host_watcher_accepts_fresh_guest_heartbeat_without_host_launch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: the watcher running inside the VM has published a fresh shared-folder heartbeat.
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    (tmp_path / ".host-watcher.heartbeat").touch()
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_args, **_kwargs: pytest.fail("Windows host watcher must never be launched"),
    )

    # When
    deadline = time.monotonic() + 2
    vm_candidate_bridge._ensure_host_watcher(deadline)
    vm_candidate_bridge._ensure_host_watcher(deadline)

    # Then: both readiness checks complete from the guest heartbeat alone.


def test_read_job_turns_stale_queued_status_into_actionable_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    ready_watcher: None,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    submitted = vm_candidate_bridge.submit({"keyword": "파우치"}, {})
    status_path = tmp_path / "results" / submitted["job_id"] / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8"))
    status["created_at"] = time.time() - 31
    status_path.write_text(json.dumps(status), encoding="utf-8")

    # When
    result = vm_candidate_bridge.read_job(submitted["job_id"])

    # Then
    assert result["ok"] is False
    assert result["status"] == "error"
    assert result["error_code"] == "vm_bridge_watcher_unresponsive"


def test_submit_times_out_when_watcher_has_no_lifecycle_activity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", lambda _deadline: None)
    monkeypatch.setattr(vm_candidate_bridge, "_SUBMIT_READY_TIMEOUT_SECONDS", 0.05)

    # When
    result = vm_candidate_bridge.submit({"keyword": "hung-watcher"}, {})

    # Then
    assert result["ok"] is False
    assert result["status"] == "error"
    assert result["error_code"] == "vm_bridge_watcher_unresponsive"


def test_ensure_host_watcher_never_touches_stale_host_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: legacy runtime state still references an old Windows host watcher process.
    events: list[str] = []
    stale_process = SimpleNamespace(
        poll=lambda: None,
        terminate=lambda: events.append("terminate"),
        wait=lambda timeout: events.append(f"wait:{timeout}") or 0,
    )

    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", stale_process)
    monkeypatch.setattr(vm_candidate_bridge, "_watcher_heartbeat_is_fresh", lambda: False)
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_args, **_kwargs: events.append("launch"),
    )

    # When / Then: readiness fails closed without terminating or relaunching host automation.
    with pytest.raises(OSError, match="VM 내부"):
        vm_candidate_bridge._ensure_host_watcher(time.monotonic() + 0.01)

    assert events == []


def test_submit_accepts_queue_when_external_watcher_has_recent_active_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    active_status = tmp_path / "results" / "vm_candidate_active123" / "status.json"
    active_status.parent.mkdir(parents=True)
    active_status.write_text(json.dumps({"status": "polling"}), encoding="utf-8")
    (active_status.parent / ".processing").touch()
    (tmp_path / ".host-watcher.heartbeat").touch()
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", lambda _deadline: None)

    # When
    result = vm_candidate_bridge.submit({"keyword": "queued-behind-active"}, {})

    # Then
    result_dir = tmp_path / "results" / result["job_id"]
    assert result["ok"] is True
    assert result["status"] == "queued"
    assert result["queue_state"] == "watcher_busy"
    assert result["progress"]["message"] == "VM 워커가 다른 작업을 처리 중입니다. 대기열에서 기다립니다."
    assert not (result_dir / ".processing").exists()
    assert not (result_dir / "cancelled.json").exists()


def test_read_job_persists_tombstone_before_returning_stale_queue_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    job_id = "vm_candidate_stale123"
    request_path = tmp_path / "requests" / f"{job_id}.json"
    status_path = tmp_path / "results" / job_id / "status.json"
    request_path.parent.mkdir(parents=True)
    status_path.parent.mkdir(parents=True)
    request_path.write_text(
        json.dumps({"job_id": job_id, "created_at": time.time() - 31}),
        encoding="utf-8",
    )
    status_path.write_text(
        json.dumps({"ok": True, "job_id": job_id, "status": "queued"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)

    # When
    result = vm_candidate_bridge.read_job(job_id)

    # Then
    persisted = json.loads(status_path.read_text(encoding="utf-8"))
    result_dir = status_path.parent
    assert result["status"] == "error"
    assert persisted["status"] == "error"
    assert (result_dir / ".processing").is_file()
    assert (result_dir / "cancelled.json").is_file()


def test_powershell_watcher_completes_single_job_with_env_auth(
    powershell_bridge: _PowerShellBridgeHarness,
) -> None:
    # Given
    harness = powershell_bridge

    # When
    submitted = vm_candidate_bridge.submit({"keyword": "single-job"}, {})
    _wait_for_job_status(str(submitted["job_id"]), "completed")

    # Then
    result_dir = harness.bridge_root / "results" / str(submitted["job_id"])
    flattened_args = " ".join(harness.watcher_command)
    bridge_log = (harness.state_root / "candidate-bridge.log").read_text(
        encoding="utf-8-sig",
        errors="replace",
    )
    assert harness.server.post_keywords == ["single-job"]
    assert harness.server.authenticated_requests > 0
    assert _FAKE_API_KEY not in flattened_args
    assert _FAKE_API_KEY not in bridge_log
    assert not (harness.state_root / "jepumscraper_worker_api_key.txt").exists()
    assert (harness.bridge_root / "requests" / f"{submitted['job_id']}.json").is_file()
    assert (result_dir / "result.json").is_file()


def test_powershell_watcher_prefers_worker_env_over_stale_state_key(
    powershell_bridge: _PowerShellBridgeHarness,
) -> None:
    # Given: an old bootstrap key remains in ProgramData after the worker key rotated.
    harness = powershell_bridge
    (harness.state_root / "jepumscraper_worker_api_key.txt").write_text(
        "stale-worker-key",
        encoding="utf-8",
    )

    # When
    submitted = vm_candidate_bridge.submit({"keyword": "rotated-worker-key"}, {})
    _wait_for_job_status(str(submitted["job_id"]), "completed")

    # Then: the canonical worker .env key authenticates the request.
    assert harness.server.post_keywords == ["rotated-worker-key"]
    assert harness.server.authenticated_requests > 0


def test_powershell_watcher_keeps_heartbeat_fresh_during_blocking_worker_call(
    powershell_bridge: _PowerShellBridgeHarness,
) -> None:
    # Given
    harness = powershell_bridge
    first = vm_candidate_bridge.submit({"keyword": "slow-blocking"}, {})
    assert harness.server.slow_post_started.wait(timeout=8)
    _wait_for_job_status(str(first["job_id"]), "starting")
    time.sleep(26)

    # When
    heartbeat_age = time.time() - harness.heartbeat_path.stat().st_mtime
    started = time.monotonic()
    second = vm_candidate_bridge.submit({"keyword": "queued-behind-slow"}, {})
    submit_elapsed = time.monotonic() - started

    # Then
    second_dir = harness.bridge_root / "results" / str(second["job_id"])
    assert heartbeat_age < 3
    assert submit_elapsed < 2
    assert second["status"] == "queued"
    assert second["queue_state"] == "watcher_busy"
    assert not (second_dir / "cancelled.json").exists()
    harness.server.release_slow_post.set()
    _wait_for_job_status(str(first["job_id"]), "completed")
    _wait_for_job_status(str(second["job_id"]), "completed")
    assert harness.server.post_keywords == ["slow-blocking", "queued-behind-slow"]


def test_powershell_watcher_rejects_duplicate_host_lock(
    powershell_bridge: _PowerShellBridgeHarness,
    tmp_path: Path,
) -> None:
    # Given
    harness = powershell_bridge
    duplicate_heartbeat = tmp_path / "duplicate.heartbeat"
    duplicate_args = list(harness.watcher_command)
    duplicate_args[duplicate_args.index("-HeartbeatPath") + 1] = str(duplicate_heartbeat)

    # When
    duplicate = subprocess.Popen(
        duplicate_args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        exit_code = duplicate.wait(timeout=8)
    finally:
        if duplicate.poll() is None:
            duplicate.terminate()
            duplicate.wait(timeout=5)

    # Then
    assert exit_code == 0
    assert harness.watcher.poll() is None
    assert not duplicate_heartbeat.exists()


def test_powershell_watcher_never_executes_tombstoned_request(
    powershell_bridge: _PowerShellBridgeHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    harness = powershell_bridge
    harness.watcher.terminate()
    harness.watcher.wait(timeout=5)
    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", lambda _deadline: None)
    monkeypatch.setattr(vm_candidate_bridge, "_SUBMIT_READY_TIMEOUT_SECONDS", 0.1)
    before_posts = list(harness.server.post_keywords)
    harness.heartbeat_path.unlink(missing_ok=True)
    failed = vm_candidate_bridge.submit({"keyword": "must-never-run"}, {})
    failed_dir = harness.bridge_root / "results" / str(failed["job_id"])

    # When
    replacement = subprocess.Popen(
        harness.watcher_command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        _wait_for_path(harness.heartbeat_path)
        time.sleep(0.5)
        persisted = json.loads((failed_dir / "status.json").read_text(encoding="utf-8-sig"))
    finally:
        replacement.terminate()
        replacement.wait(timeout=5)

    # Then
    assert failed["status"] == "error"
    assert (failed_dir / ".processing").is_file()
    assert (failed_dir / "cancelled.json").is_file()
    assert harness.server.post_keywords == before_posts
    assert persisted["status"] == "error"


def test_powershell_watcher_never_reexecutes_manual_required_request(
    powershell_bridge: _PowerShellBridgeHarness,
) -> None:
    # Given: a Naver detail job was intentionally paused for user verification.
    harness = powershell_bridge
    harness.watcher.terminate()
    harness.watcher.wait(timeout=5)
    harness.heartbeat_path.unlink(missing_ok=True)
    job_id = "vm_candidate_manual_gate_must_not_restart"
    request_path = harness.bridge_root / "requests" / f"{job_id}.json"
    result_dir = harness.bridge_root / "results" / job_id
    request_path.parent.mkdir(parents=True)
    result_dir.mkdir(parents=True)
    request_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "operation": "candidate_search",
                "worker_payload": {"keyword": "must-not-restart"},
            },
        ),
        encoding="utf-8",
    )
    (result_dir / "status.json").write_text(
        json.dumps(
            {
                "ok": False,
                "status": "manual_required",
                "manual_action_required": True,
            },
        ),
        encoding="utf-8",
    )
    before_posts = list(harness.server.post_keywords)

    # When: the VM bridge restarts after a reboot.
    replacement = subprocess.Popen(
        harness.watcher_command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        _wait_for_path(harness.heartbeat_path)
        time.sleep(0.5)
        persisted = json.loads((result_dir / "status.json").read_text(encoding="utf-8-sig"))
    finally:
        replacement.terminate()
        replacement.wait(timeout=5)

    # Then: only an explicit resume action may run the paused job again.
    assert harness.server.post_keywords == before_posts
    assert persisted["status"] == "manual_required"


def test_unresponsive_external_watcher_fails_in_about_twenty_five_seconds(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", lambda _deadline: None)

    # When
    started = time.monotonic()
    result = vm_candidate_bridge.submit({"keyword": "unresponsive-external"}, {})
    elapsed = time.monotonic() - started

    # Then
    assert 24.5 <= elapsed <= 28
    assert result["status"] == "error"
    assert result["error_code"] == "vm_bridge_watcher_unresponsive"


def test_detail_artifact_recovers_singleton_manifest_and_guest_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: PowerShell emitted one manifest row and a guest-only UNC path.
    job_id = "vm_candidate_artifact_singleton"
    product_id = "coupang_9166115822"
    request_dir = tmp_path / "requests"
    result_dir = tmp_path / "results" / job_id
    artifact_path = result_dir / "artifacts" / product_id / "1.jpg"
    request_dir.mkdir(parents=True)
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_bytes(b"vm-detail-image")
    (request_dir / f"{job_id}.json").write_text(
        json.dumps(
            {
                "job_id": job_id,
                "operation": "detail_capture",
                "identity": {"productKey": "pumpkin-pin-cushion"},
            },
        ),
        encoding="utf-8",
    )
    (result_dir / "status.json").write_text(
        json.dumps(
            {
                "ok": True,
                "status": "completed",
                "completed": 1,
                "failed": 0,
                "total": 1,
            },
        ),
        encoding="utf-8",
    )
    (result_dir / "result.json").write_text(
        json.dumps(
            {
                "result": {
                    "scraped_data": {
                        product_id: {
                            "screenshots": [r"C:\JepumScraper\output\1.jpg"],
                            "screenshot_paths": [r"C:\JepumScraper\output\1.jpg"],
                            "screenshot_urls": [],
                        },
                    },
                },
            },
        ),
        encoding="utf-8",
    )
    (result_dir / "artifact_manifest.json").write_text(
        json.dumps(
            {
                "product_id": product_id,
                "index": 0,
                "path": (
                    r"\\VBOXSVR\KuasangseVmBridge\results"
                    rf"\{job_id}\artifacts\{product_id}\1.jpg"
                ),
                "file_name": "1.jpg",
            },
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)

    # When
    job = vm_candidate_bridge.read_job(job_id)
    served_path = vm_candidate_bridge.read_artifact(job_id, 0)

    # Then: the host-served URL wins over paths that only exist inside the VM.
    expected_url = f"/api/vm-detail-capture/{job_id}/artifacts/0"
    detail = job["result"]["scraped_data"][product_id]
    assert detail["screenshots"] == [expected_url]
    assert detail["screenshot_paths"] == [expected_url]
    assert detail["screenshot_urls"][0] == expected_url
    assert served_path == artifact_path.resolve()
