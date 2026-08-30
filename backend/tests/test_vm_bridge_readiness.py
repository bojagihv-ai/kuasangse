"""VM 경로 사용 가능 여부를 값싸게 답해야 한다.

후보검색은 제출 때 하트비트를 보고 5초 안에 실패를 알려 주는데, 상세수집은 같은 확인 없이
VM 으로 보내 job_timeout(3600초) 을 기다렸다 - 실측 2026-08-31. 화면이 먼저 물어볼 수 있어야
그 한 시간이 없어진다.
"""
import os
import time

import pytest

from services import vm_candidate_bridge


@pytest.fixture
def heartbeat(tmp_path, monkeypatch):
    path = tmp_path / ".host-watcher.heartbeat"
    monkeypatch.setattr(vm_candidate_bridge, "_watcher_heartbeat_path", lambda: path)
    return path


def test_하트비트가_없으면_쓸_수_없다고_답한다(heartbeat):
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["ok"] is False
    assert verdict["watcherAlive"] is False
    assert verdict["reason"] == "vm_bridge_guest_watcher_unavailable"
    assert verdict["heartbeatAgeSeconds"] is None
    assert verdict["message"]


def test_하트비트가_신선하면_쓸_수_있다고_답한다(heartbeat):
    heartbeat.write_text("ok", encoding="utf-8")
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["ok"] is True
    assert verdict["watcherAlive"] is True
    assert verdict["reason"] == ""
    assert verdict["heartbeatAgeSeconds"] is not None


def test_하트비트가_낡으면_나이와_함께_막는다(heartbeat):
    heartbeat.write_text("ok", encoding="utf-8")
    stale = time.time() - (vm_candidate_bridge._WATCHER_HEARTBEAT_MAX_AGE_SECONDS + 120)
    os.utime(heartbeat, (stale, stale))
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["ok"] is False
    assert verdict["watcherAlive"] is False
    assert verdict["heartbeatAgeSeconds"] > vm_candidate_bridge._WATCHER_HEARTBEAT_MAX_AGE_SECONDS
    # 몇 초째 죽어 있는지 사람이 읽을 수 있어야 한다.
    assert "초" in verdict["message"]


def test_판정은_파일_한_번만_본다_빠를_것(heartbeat):
    heartbeat.write_text("ok", encoding="utf-8")
    started = time.monotonic()
    for _ in range(50):
        vm_candidate_bridge.watcher_readiness()
    assert time.monotonic() - started < 1.0
