"""상세수집 VM 경로 판정은 후보검색용 하트비트와 섞이면 안 된다.

실측 2026-08-31: .host-watcher.heartbeat 가 41시간 낡아 있는 동안에도 vm_detail 작업
12건이 전부 completed/success 로 끝났다. 그 하트비트로 상세수집을 막으면 멀쩡한 VM 을
막는다 — 내가 실제로 그렇게 만들었고 사용자가 지적했다.
"""
import json
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


def _job(bridge, name, status, age_seconds=0.0):
    job = bridge / "results" / name
    job.mkdir()
    path = job / "status.json"
    path.write_text(json.dumps(status), encoding="utf-8")
    if age_seconds:
        stamp = time.time() - age_seconds
        os.utime(path, (stamp, stamp))
        os.utime(job, (stamp, stamp))
    return job


def test_직전_상세수집이_성공했으면_쓸_수_있다(bridge):
    _job(bridge, "vm_detail_aaa", {"status": "completed", "vm_status": "success"})
    verdict = vm_candidate_bridge.detail_capture_readiness()
    assert verdict["detailPathUsable"] is True


def test_하트비트가_낡아도_상세수집은_막지_않는다(bridge):
    # 실제로 있었던 상황: 하트비트 41시간, 상세수집 12건 성공.
    _job(bridge, "vm_detail_aaa", {"status": "completed", "vm_status": "success"})
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["detailPathUsable"] is True
    assert verdict["candidateWatcherAlive"] is False   # 후보검색은 따로 막힌 채로 보고된다


def test_직전_요청이_오래_접수만_돼_있으면_막는다(bridge):
    _job(bridge, "vm_detail_aaa", {"status": "queued"}, age_seconds=600)
    verdict = vm_candidate_bridge.detail_capture_readiness()
    assert verdict["detailPathUsable"] is False
    assert verdict["reason"] == "vm_detail_capture_stalled"
    assert verdict["queuedAgeSeconds"] > 240


def test_방금_접수된_요청은_막지_않는다(bridge):
    _job(bridge, "vm_detail_aaa", {"status": "queued"}, age_seconds=5)
    assert vm_candidate_bridge.detail_capture_readiness()["detailPathUsable"] is True


def test_근거가_없으면_통과시킨다(bridge):
    assert vm_candidate_bridge.detail_capture_readiness()["detailPathUsable"] is True
