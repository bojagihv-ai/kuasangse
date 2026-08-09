from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from backend.services import vm_candidate_bridge


def test_submit_accepts_queue_when_another_job_has_recent_watcher_activity(
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
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda _job_id, _deadline: False,
    )

    # When
    result = vm_candidate_bridge.submit({"keyword": "second-job"}, {})

    # Then
    result_dir = tmp_path / "results" / result["job_id"]
    assert result["ok"] is True
    assert result["status"] == "queued"
    assert not (result_dir / ".processing").exists()
    assert not (result_dir / "cancelled.json").exists()


def test_read_job_keeps_stale_queue_when_another_job_is_active(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", lambda _deadline: None)
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda _job_id, _deadline: True,
    )
    submitted = vm_candidate_bridge.submit({"keyword": "queued-job"}, {})
    queued_status = tmp_path / "results" / submitted["job_id"] / "status.json"
    status = json.loads(queued_status.read_text(encoding="utf-8"))
    status["created_at"] = time.time() - 31
    queued_status.write_text(json.dumps(status), encoding="utf-8")
    active_status = tmp_path / "results" / "vm_candidate_active456" / "status.json"
    active_status.parent.mkdir(parents=True)
    active_status.write_text(json.dumps({"status": "starting"}), encoding="utf-8")
    (active_status.parent / ".processing").touch()
    (tmp_path / ".host-watcher.heartbeat").touch()

    # When
    result = vm_candidate_bridge.read_job(submitted["job_id"])

    # Then
    assert result["ok"] is True
    assert result["status"] == "queued"
    assert result["error_code"] == ""


def test_timeout_reserves_processing_lock_and_writes_cancellation_tombstone(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)
    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", lambda _deadline: None)
    monkeypatch.setattr(
        vm_candidate_bridge,
        "_wait_for_watcher_claim",
        lambda _job_id, _deadline: False,
    )

    # When
    result = vm_candidate_bridge.submit({"keyword": "unclaimed-job"}, {})

    # Then
    result_dir = tmp_path / "results" / result["job_id"]
    tombstone = json.loads((result_dir / "cancelled.json").read_text(encoding="utf-8"))
    assert result["error_code"] == "vm_bridge_watcher_unresponsive"
    assert (result_dir / ".processing").is_file()
    assert tombstone["error_code"] == result["error_code"]


def test_launch_failure_does_not_overwrite_job_claimed_during_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_WATCHER_PROCESS", None)

    def claim_then_fail(_deadline: float) -> None:
        request_path = next((tmp_path / "requests").glob("*.json"))
        result_dir = tmp_path / "results" / request_path.stem
        (result_dir / ".processing").touch(exist_ok=False)
        raise OSError("simulated launch race")

    monkeypatch.setattr(vm_candidate_bridge, "_ensure_host_watcher", claim_then_fail)

    # When
    result = vm_candidate_bridge.submit({"keyword": "claimed-job"}, {})

    # Then
    status_path = tmp_path / "results" / result["job_id"] / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert result["ok"] is True
    assert result["status"] == "queued"
    assert status["status"] == "queued"
    assert "error_code" not in status
