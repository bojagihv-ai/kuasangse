"""계약: 스크래퍼 포트를 외우지 말고 찾아낼 것.

왜 이 검사가 있는가 — 같은 사고가 두 번 났다.
  2026-08-28: 코드가 5012 를 보는데 스크래퍼는 5003 에 있었다. 경쟁사 수집이 통째로 막혔다.
  2026-08-30: 5003 이 **이메일통합**에 영구 배정되어 스크래퍼가 43000 으로 옮겨갔다.
              앱은 5003 의 메일 프로그램을 "남의 프로그램" 으로 판정하고
              화면 전체를 세우는 알림창을 띄웠다 — 사람이 답할 때까지 앱이 멈췄다.
              그래서 스마트스토어(네이버)가 한 건도 안 잡혔다.

숫자를 또 고쳐 넣는 것으로는 세 번째를 못 막는다. 그래서:
  환경변수 → 지난번 찾은 포트 → **API 허브가 아는 주소** → 알려진 후보 순으로 찾고,
  포트가 열려 있다는 것만으로 믿지 않고 **검진으로 스크래퍼 본인인지 확인**한다.
"""
import os

from pathlib import Path

import pytest

from routes import api_shared  # conftest 가 backend 경로를 잡아 준다


@pytest.fixture(autouse=True)
def _clear_state(monkeypatch):
    monkeypatch.delenv("JEPUM_SCRAPER_PORT", raising=False)
    api_shared._JEPUM_PORT_CACHE["port"] = None
    api_shared._JEPUM_PORT_CACHE["checked_at"] = 0.0
    yield
    api_shared._JEPUM_PORT_CACHE["port"] = None
    api_shared._JEPUM_PORT_CACHE["checked_at"] = 0.0


def test_허브가_알려준_포트를_따라간다(monkeypatch):
    # 스크래퍼가 옮겨가도 허브만 최신이면 앱이 따라가야 한다.
    monkeypatch.setattr(api_shared, "_jepum_port_from_api_hub", lambda timeout=1.5: 43000)
    monkeypatch.setattr(api_shared, "_jepum_port_health_ok", lambda port, timeout=1.5: port == 43000)
    assert api_shared._jepum_scraper_port() == 43000


def test_포트가_열려있어도_남의_프로그램이면_고르지_않는다(monkeypatch):
    # 5003 에는 메일 통합관리센터가 열려 있다. 열렸다고 스크래퍼인 것이 아니다.
    monkeypatch.setattr(api_shared, "_jepum_port_from_api_hub", lambda timeout=1.5: None)
    monkeypatch.setattr(api_shared, "_jepum_port_health_ok", lambda port, timeout=1.5: port == 43000)
    assert api_shared._jepum_scraper_port() == 43000


def test_환경변수가_가장_세다(monkeypatch):
    # 주인님이 직접 알려 준 값은 무엇보다 우선한다.
    monkeypatch.setenv("JEPUM_SCRAPER_PORT", "5999")
    monkeypatch.setattr(api_shared, "_jepum_port_from_api_hub", lambda timeout=1.5: 43000)
    assert api_shared._jepum_scraper_port() == 5999


def test_찾은_포트로_실행중이라고_답한다(monkeypatch):
    # 이 판정이 뒤집혀서 수집이 막혔다. running 이어야 알림창이 안 뜬다.
    monkeypatch.setattr(api_shared, "_jepum_scraper_port", lambda force=False: 43000)
    monkeypatch.setattr(api_shared, "_jepum_scraper_port_open", lambda timeout=0.8, port=None: True)

    class _Resp:
        ok = True
        status_code = 200
        headers = {"content-type": "application/json"}

        @staticmethod
        def json():
            return {"status": "ok"}

    monkeypatch.setattr(api_shared.requests, "get", lambda url, timeout=2: _Resp())
    payload = api_shared._jepum_scraper_status_payload()
    assert payload["running"] is True
    assert payload["portConflict"] is False
    assert payload["port"] == 43000
    assert "43000" in payload["message"]


def test_아무데도_없으면_포트를_말해준다(monkeypatch):
    # "꺼져 있습니다" 만 나오고 어느 포트를 봤는지 안 알려 줘서 한참 헤맸다.
    monkeypatch.setattr(api_shared, "_jepum_port_from_api_hub", lambda timeout=1.5: None)
    monkeypatch.setattr(api_shared, "_jepum_port_health_ok", lambda port, timeout=1.5: False)
    monkeypatch.setattr(api_shared, "_jepum_scraper_port_open", lambda timeout=0.8, port=None: False)
    payload = api_shared._jepum_scraper_status_payload()
    assert payload["running"] is False
    assert str(payload["port"]) in payload["message"]
