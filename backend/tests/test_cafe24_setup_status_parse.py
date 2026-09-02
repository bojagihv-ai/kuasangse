"""Cafe24 Control Tower 의 setup/status 본문을 읽어 '쓸 수 있는가' 를 답하는 계약.

주인님(2026-09-02, 묶음 G5 #16): "켜져 있는 것과 쓸 수 있는 것을 구별하지 못한다."
예전 _cafe24_control_status_payload 는 setup/status 가 HTTP 200 이면 running=True 로 끝냈다.
그러면 OAuth 가 끊겼거나 refresh 토큰이 만료돼도 준비 카드는 '준비 완료' 를 찍고,
수집은 첫 요청에서 401 로 죽는다.

본문 형태(실측 2026-09-02, http://127.0.0.1:8787/api/setup/status?include_secrets=0):
  {"ok":true,"data":{"missing_scopes":[...],"checks":[{"id":"mall-connection","status":"pass",...},
                                                        {"id":"scopes",...},{"id":"token-keeper",...}]}}
checks[].status 는 pass | warn | fail | info.
"""
from __future__ import annotations

from routes import api_shared


def _body(mall="pass", scopes="pass", token="pass", missing=(), token_message="access 1시간 59분 · refresh 13일 · 정상"):
    missing = list(missing)
    mall_check = {"id": "mall-connection", "label": "Cafe24 OAuth 연결", "status": mall,
                  "message": "bojagi1928 연결됨" if mall == "pass" else "bojagi1928 재연결 또는 토큰 점검 필요"}
    if mall != "pass":
        mall_check["action"] = "mall_id를 입력하고 Cafe24 연결을 시작하세요."
    scopes_check = {"id": "scopes", "label": "Cafe24 권한 범위", "status": scopes,
                    "message": "전체 scope 승인됨" if scopes == "pass" else f"{len(missing)}개 scope가 누락되었습니다."}
    if missing:
        scopes_check["action"] = ", ".join(missing[:5])
    token_check = {"id": "token-keeper", "label": "토큰 자동 유지", "status": token, "message": token_message}
    if token != "pass":
        token_check["action"] = "Cafe24 OAuth 연결을 다시 진행하세요."
    return {
        "ok": True,
        "data": {
            "selected_mall_id": "bojagi1928",
            "missing_scopes": missing,
            "checks": [
                {"id": "cafe24-client", "label": "Cafe24 앱 키", "status": "pass", "message": "준비됨"},
                mall_check,
                scopes_check,
                token_check,
                {"id": "ollama", "label": "Ollama", "status": "info", "message": "무관"},
            ],
        },
    }


def test_all_pass_is_usable_and_connected() -> None:
    verdict = api_shared._parse_cafe24_setup_status(_body())
    assert verdict["usable"] is True
    assert verdict["oauthState"] == "connected"
    assert verdict["missingScopes"] == []
    assert "access" in verdict["tokenMessage"]
    assert verdict["problem"] == ""


def test_expired_token_is_not_usable_even_though_tower_answers_200() -> None:
    verdict = api_shared._parse_cafe24_setup_status(
        _body(token="fail", token_message="access 만료됨 · refresh 만료됨 · reauth_required"),
    )
    assert verdict["usable"] is False
    assert verdict["oauthState"] == "reauth_required"
    assert "만료" in verdict["tokenMessage"]
    # 무엇이 잘못됐고 무엇을 하면 되는지
    assert "토큰" in verdict["problem"] and "다시" in verdict["problem"]


def test_disconnected_mall_is_not_usable() -> None:
    verdict = api_shared._parse_cafe24_setup_status(_body(mall="fail", scopes="info", token="info"))
    assert verdict["usable"] is False
    assert verdict["oauthState"] == "disconnected"
    assert "연결" in verdict["problem"]


def test_missing_scopes_are_reported_by_name() -> None:
    verdict = api_shared._parse_cafe24_setup_status(
        _body(scopes="warn", missing=("mall.write_product", "mall.read_category")),
    )
    assert verdict["usable"] is False
    assert verdict["oauthState"] == "scopes_missing"
    assert verdict["missingScopes"] == ["mall.write_product", "mall.read_category"]
    assert "mall.write_product" in verdict["problem"]


def test_expiring_token_stays_usable_but_carries_the_warning() -> None:
    verdict = api_shared._parse_cafe24_setup_status(
        _body(token="warn", token_message="access 3분 · refresh 2일 · access_expiring"),
    )
    assert verdict["usable"] is True
    assert verdict["oauthState"] == "expiring"
    assert "access_expiring" in verdict["tokenMessage"]


def test_unreadable_body_does_not_pretend_to_know() -> None:
    # 옛 판 Control Tower 나 깨진 본문이면 판정을 모른다고 답해야지, 쓸 수 없다고 막으면 안 된다.
    for body in (None, "not json", {"ok": True}, {"ok": True, "data": {"checks": "?"}}):
        verdict = api_shared._parse_cafe24_setup_status(body)
        assert verdict["usable"] is None, body
        assert verdict["oauthState"] == "unknown", body


class _Response:
    def __init__(self, body, ok=True, status_code=200):
        self._body = body
        self.ok = ok
        self.status_code = status_code
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._body


def test_status_payload_exports_usable_fields_from_live_body(monkeypatch) -> None:
    # Given: 포트가 열려 있고 setup/status 가 200 으로 답하지만 토큰이 만료됐다.
    monkeypatch.setattr(api_shared, "_cafe24_control_port_open", lambda: True)
    monkeypatch.setattr(
        api_shared.requests, "get",
        lambda *a, **k: _Response(_body(token="fail", token_message="reauth_required")),
    )

    # When
    status = api_shared._cafe24_control_status_payload()

    # Then: 켜져 있음(running) 과 쓸 수 있음(usable) 이 갈린다.
    assert status["running"] is True
    assert status["portConflict"] is False
    assert status["usable"] is False
    assert status["oauthState"] == "reauth_required"
    assert "reauth_required" in status["tokenMessage"]
    assert "다시" in status["message"], "준비 카드가 그대로 보여줄 문장 — 무엇을 하면 되는지가 들어가야 한다"


def test_status_payload_marks_healthy_tower_usable(monkeypatch) -> None:
    monkeypatch.setattr(api_shared, "_cafe24_control_port_open", lambda: True)
    monkeypatch.setattr(api_shared.requests, "get", lambda *a, **k: _Response(_body()))
    status = api_shared._cafe24_control_status_payload()
    assert status["running"] is True
    assert status["usable"] is True
    assert status["oauthState"] == "connected"


def test_status_payload_when_tower_is_off(monkeypatch) -> None:
    monkeypatch.setattr(api_shared, "_cafe24_control_port_open", lambda: False)
    status = api_shared._cafe24_control_status_payload()
    assert status["running"] is False
    assert status["usable"] is False
    assert status["oauthState"] == "unknown"
