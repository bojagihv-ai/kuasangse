"""후보검색용 watcher 하트비트 판정.

**주의: 이 판정으로 상세수집을 막으면 안 된다.** 두 경로는 다르다 —
실측 2026-08-31: 하트비트가 41시간 낡은 동안에도 vm_detail 작업 12건이 전부 성공했다.
상세수집 판정은 backend/tests/test_vm_detail_path_readiness.py 를 볼 것.
"""
import os
import time

import pytest

from services import vm_candidate_bridge


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    (tmp_path / "results").mkdir()
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)
    monkeypatch.setattr(vm_candidate_bridge, "_watcher_heartbeat_path",
                        lambda: tmp_path / ".host-watcher.heartbeat")
    return tmp_path


def test_하트비트가_없으면_후보검색_watcher는_죽은_것이다(bridge):
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["candidateWatcherAlive"] is False
    assert verdict["heartbeatAgeSeconds"] is None
    # 그래도 상세수집은 막지 않는다 — 그게 이 파일의 요점이다.
    assert verdict["detailPathUsable"] is True


def test_하트비트가_신선하면_후보검색_watcher는_살아_있다(bridge):
    (bridge / ".host-watcher.heartbeat").write_text("ok", encoding="utf-8")
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["candidateWatcherAlive"] is True
    assert verdict["heartbeatAgeSeconds"] is not None


def test_하트비트가_낡으면_나이와_함께_보고한다(bridge):
    path = bridge / ".host-watcher.heartbeat"
    path.write_text("ok", encoding="utf-8")
    stale = time.time() - (vm_candidate_bridge._WATCHER_HEARTBEAT_MAX_AGE_SECONDS + 120)
    os.utime(path, (stale, stale))
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["candidateWatcherAlive"] is False
    assert verdict["heartbeatAgeSeconds"] > vm_candidate_bridge._WATCHER_HEARTBEAT_MAX_AGE_SECONDS


def test_판정은_값싸야_한다(bridge):
    (bridge / ".host-watcher.heartbeat").write_text("ok", encoding="utf-8")
    started = time.monotonic()
    for _ in range(50):
        vm_candidate_bridge.watcher_readiness()
    assert time.monotonic() - started < 2.0
