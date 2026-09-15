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

from unittest.mock import Mock

import pytest

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


@pytest.fixture
def guarded_tower(monkeypatch: pytest.MonkeyPatch) -> Mock:
    monkeypatch.setattr(api_shared, "_cafe24_control_port_open", lambda: True)
    monkeypatch.setattr(api_shared.requests, "get", Mock(return_value=_Response(
        {"ok": False, "error": {"code": "control_key_invalid"}}, ok=False, status_code=401,
    )))
    hub = Mock()
    monkeypatch.setattr(api_shared.requests, "post", hub)
    return hub


@pytest.mark.parametrize(("token", "usable", "oauth_state"), [
    ("pass", True, "connected"), ("fail", False, "reauth_required"), ("warn", True, "expiring"),
])
def test_auth_401_reads_setup_through_saved_hub_auth(
    guarded_tower: Mock, token: str, usable: bool, oauth_state: str,
) -> None:
    # Given: 인증된 Hub 조회만 실제 OAuth 검사표를 돌려준다.
    guarded_tower.return_value = _Response({
        "ok": True, "status": 200, "response": {"body": _body(token=token)},
    })
    # When
    status = api_shared._cafe24_control_status_payload()
    # Then: 인증이 필요한 서비스는 꺼진 것이 아니며, OAuth 판정은 그대로 유지한다.
    assert status["running"] is True
    assert status["portConflict"] is False
    assert status["healthOk"] is True
    assert status["usable"] is usable
    assert status["oauthState"] == oauth_state
    guarded_tower.assert_called_once_with(
        f"{api_shared._JEPUM_API_HUB_BASE}/api/invoke/cafe24_control_tower/setup-status",
        json={"query": {"include_secrets": 0}}, timeout=2,
    )


@pytest.mark.parametrize("hub_response", [
    pytest.param(_Response({"ok": False, "status": 200, "response": {"body": _body()}}), id="hub-error"),
    pytest.param(_Response({"ok": True, "status": 401, "response": {"body": _body()}}), id="upstream-error"),
    pytest.param(_Response({"ok": True, "status": 200, "response": {"body": _body()}},
                          ok=False, status_code=502), id="http-error"),
    pytest.param(_Response({"ok": True, "response": {"body": _body()}}), id="missing-status"),
    pytest.param(_Response([]), id="wrong-envelope"),
    pytest.param(_Response({"ok": True, "status": 200, "response": None}), id="missing-response"),
    pytest.param(_Response({"ok": True, "status": 200, "response": {"body": "not json"}}), id="bad-body"),
    pytest.param(_Response({"ok": True, "status": 200, "response": {"body": {
        "ok": True, "data": {"checks": [{"id": "mall-connection", "status": "pass"}]},
    }}}), id="incomplete-checks"),
    pytest.param(_Response({"ok": True, "status": 200, "response": {"body": {
        **_body(), "ok": False,
    }}}), id="setup-error"),
    pytest.param(_Response({"ok": True, "status": 200, "response": {"body": _body(token="info")}}),
                 id="unknown-token"),
])
def test_auth_401_with_untrusted_hub_status_stays_unknown(
    guarded_tower: Mock, hub_response: _Response,
) -> None:
    # Given: HTTP 성공만으로는 인증·검사 결과가 확인되지 않는다.
    guarded_tower.return_value = hub_response
    # When
    status = api_shared._cafe24_control_status_payload()
    # Then: 실행 사실과 미확인 OAuth 상태를 구분한다.
    assert status["running"] is True
    assert status["portConflict"] is False
    assert status["usable"] is None
    assert status["oauthState"] == "unknown"
    guarded_tower.assert_called_once()


@pytest.mark.parametrize("error", [api_shared.requests.Timeout(), ValueError()])
def test_auth_401_with_unreachable_or_non_json_hub_stays_unknown(
    guarded_tower: Mock, error: Exception,
) -> None:
    # Given
    guarded_tower.side_effect = error
    # When
    status = api_shared._cafe24_control_status_payload()
    # Then
    assert status["running"] is True
    assert status["portConflict"] is False
    assert status["usable"] is None
    assert status["oauthState"] == "unknown"
    guarded_tower.assert_called_once()


@pytest.mark.parametrize(("port_open", "http_status", "body"), [
    (False, 401, {"error": {"code": "control_key_invalid"}}),
    (True, 401, {"error": {"code": "unauthorized"}}),
    (True, 401, {"error": "control_key_invalid"}),
    (True, 500, {"error": {"code": "control_key_invalid"}}),
])
def test_other_services_and_closed_ports_never_use_hub(
    monkeypatch: pytest.MonkeyPatch, port_open, http_status, body,
) -> None:
    # Given
    monkeypatch.setattr(api_shared, "_cafe24_control_port_open", lambda: port_open)
    monkeypatch.setattr(api_shared.requests, "get", Mock(return_value=_Response(body, False, http_status)))
    hub = Mock(side_effect=AssertionError("unexpected Hub invocation"))
    monkeypatch.setattr(api_shared.requests, "post", hub)
    # When
    status = api_shared._cafe24_control_status_payload()
    # Then
    assert status["running"] is False
    assert status["portConflict"] is port_open
    assert status["usable"] is False
    hub.assert_not_called()
