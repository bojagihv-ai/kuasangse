"""SINHWA_PDP_SERVICE_KEY 없이 뜬 백엔드는 시작 로그에 큰 경고를 남겨야 한다.

주인님(2026-09-02, 묶음 G5 #4): "켜져 있는 것과 쓸 수 있는 것을 구별하지 못한다."
공식 기동 경로 셋(start-backend.bat / start-all.bat / tools/launch_public_api.ps1)이
키 없이 백엔드를 띄웠고, launcher.ps1 도 키 로드에 실패하면 말없이 키 없이 띄운 뒤
'Backend ready' 를 찍었다. 그러면 /api/sections 는 200 인데 신화사 동기화는 전부
실패한다 — 살아 있는 것과 쓸 수 있는 것이 다르다.

이 검사는 create_app() 을 **실제로 실행**해 경고가 로그에 찍히는지, 키가 있으면
찍히지 않는지를 본다.
"""
from __future__ import annotations

import logging

import app as app_module


def _quiet_schedulers(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "start_automation_scheduler", lambda: None)
    monkeypatch.setattr(app_module, "start_maintenance_scheduler", lambda: None)


def test_create_app_warns_loudly_when_service_key_missing(monkeypatch, caplog) -> None:
    # Given: 키가 없는 환경(.env 에도 없고 프로세스 env 에도 없다).
    monkeypatch.delenv("SINHWA_PDP_SERVICE_KEY", raising=False)
    _quiet_schedulers(monkeypatch)

    # When: 백엔드를 만든다.
    with caplog.at_level(logging.WARNING):
        app_module.create_app()

    # Then: 무엇이 없고 무엇을 하면 되는지가 WARNING 이상으로 남는다.
    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    joined = "\n".join(record.getMessage() for record in warnings)
    assert "SINHWA_PDP_SERVICE_KEY" in joined, "무엇이 없는지 이름을 적어야 한다"
    assert "신화사" in joined, "무엇이 안 되는지(신화사 동기화) 한국어로 적어야 한다"
    assert "launcher" in joined.lower(), "무엇을 하면 되는지(런처로 다시 띄우기) 적어야 한다"


def test_create_app_stays_quiet_when_service_key_present(monkeypatch, caplog) -> None:
    # Given: 키가 있다(값 자체는 아무거나 — 여기서는 검증하지 않는다).
    monkeypatch.setenv("SINHWA_PDP_SERVICE_KEY", "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk=")
    _quiet_schedulers(monkeypatch)

    # When
    with caplog.at_level(logging.WARNING):
        app_module.create_app()

    # Then: 키 경고는 없어야 한다(다른 경고와 섞이지 않도록 이름으로 거른다).
    assert not [r for r in caplog.records if "SINHWA_PDP_SERVICE_KEY" in r.getMessage()]
