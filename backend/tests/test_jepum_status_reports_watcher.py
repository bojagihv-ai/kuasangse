"""계약: VM 후보 수집기 상태는 **실제로 후보검색이 타는 부품**까지 본다.

주인님 2026-09-02: "켜져 있는 것과 쓸 수 있는 것을 구별하지 못한다."

전수 진단 #5 (high): 준비 판정(src/modules/local-service-preflight.mjs)은
/api/jepum-scraper/status 만 보는데, 그 응답은 호스트 스크래퍼 포트가 열려 있는지만 답했다.
정작 후보검색은 VM 안 공유폴더 watcher 가 처리한다. 그래서 watcher 만 죽은 흔한 고장에서
화면은 '준비 완료' 를 두 번 보여주고 5초 뒤 실패했다.

실측: 2026-08-31 이 watcher 가 41시간 죽어 있었고(커밋 d61c196), 2026-09-02 전수 진단
중에도 26분 죽어 있었다. 그때 /api/vm-bridge/readiness 는 candidateWatcherAlive: false 를
정확히 알고 있었는데, 준비 판정이 그 값을 보지 않았다.

그래서 스크래퍼 상태에 watcher 생사를 함께 싣는다. 프런트가 한 번 더 물어보지 않아도 되게.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import api_shared  # noqa: E402


def _stub_scraper(monkeypatch, *, port_open=True, health_ok=True):
    monkeypatch.setattr(api_shared, "_jepum_scraper_port", lambda: 43000)
    monkeypatch.setattr(api_shared, "_jepum_scraper_port_open", lambda port=None: port_open)

    class _Response:
        status_code = 200 if health_ok else 500
        ok = health_ok
        headers = {"content-type": "application/json"}

        def json(self):
            return {"ok": health_ok}

    monkeypatch.setattr(api_shared.requests, "get", lambda *a, **k: _Response())


def test_status_carries_the_watcher_verdict(monkeypatch):
    _stub_scraper(monkeypatch)
    monkeypatch.setattr(
        api_shared,
        "_jepum_watcher_verdict",
        lambda: {"candidateWatcherAlive": True, "heartbeatAgeSeconds": 3.2},
    )
    status = api_shared._jepum_scraper_status_payload()
    assert status["running"] is True
    assert status["candidateWatcherAlive"] is True
    assert status["usable"] is True


def test_dead_watcher_is_running_but_not_usable(monkeypatch):
    # 호스트 스크래퍼는 멀쩡한데 VM 안 watcher 만 죽은 그 고장.
    _stub_scraper(monkeypatch)
    monkeypatch.setattr(
        api_shared,
        "_jepum_watcher_verdict",
        lambda: {"candidateWatcherAlive": False, "heartbeatAgeSeconds": 1547.3},
    )
    status = api_shared._jepum_scraper_status_payload()
    assert status["running"] is True, "포트는 열려 있다 - 켜져 있는 것은 맞다"
    assert status["usable"] is False, "그런데 후보검색은 못 한다"
    assert status["candidateWatcherAlive"] is False
    assert status["heartbeatAgeSeconds"] == 1547.3
    # 무엇이 죽었고 무엇을 하면 되는지가 한국어로 있어야 한다.
    assert "watcher" in status["message"] or "후보 수집" in status["message"]
    assert "VM" in status["message"]
    assert "25분" in status["message"] or "분" in status["message"], "얼마나 오래 죽었는지 알려야 한다"


def test_scraper_off_is_not_usable(monkeypatch):
    _stub_scraper(monkeypatch, port_open=False)
    monkeypatch.setattr(
        api_shared,
        "_jepum_watcher_verdict",
        lambda: {"candidateWatcherAlive": False, "heartbeatAgeSeconds": None},
    )
    status = api_shared._jepum_scraper_status_payload()
    assert status["running"] is False
    assert status["usable"] is False


def test_watcher_probe_failure_does_not_break_status(monkeypatch):
    # watcher 를 못 물어봤다고 상태 조회 자체가 죽으면 안 된다.
    _stub_scraper(monkeypatch)

    def _boom():
        raise RuntimeError("bridge unavailable")

    monkeypatch.setattr(api_shared, "_jepum_watcher_verdict", _boom)
    status = api_shared._jepum_scraper_status_payload()
    assert status["running"] is True
    # 모르는 것을 '쓸 수 없다' 로 단정해 막지 않는다.
    assert status["usable"] is None
    assert status["candidateWatcherAlive"] is None


def test_real_watcher_probe_is_wired(monkeypatch):
    """대역이 아니라 **진짜 함수**가 불리는지 본다.

    위 검사들은 _jepum_watcher_verdict 를 대역으로 바꾸므로, 그 안의 import 이름이 틀려도
    통과한다. 실제로 2026-09-02 에 없는 이름(readiness_verdict)을 부르고 있었는데
    예외를 삼켜 usable 이 늘 None 이 됐다 - 조용히 못 쓰게 되는 자리다.
    """
    verdict = api_shared._jepum_watcher_verdict()
    assert isinstance(verdict, dict)
    assert "candidateWatcherAlive" in verdict
