from __future__ import annotations

from flask import Flask

from routes import api_core, api_shared


class _UnexpectedProcessStart(RuntimeError):
    pass


class _WrongServiceResponse:
    ok = False
    status_code = 500
    headers: dict[str, str] = {}

    def json(self) -> dict[str, str]:
        return {}


def test_cafe24_status_marks_open_port_with_wrong_http_service_as_conflict(monkeypatch) -> None:
    # Given: TCP 8787 is open but the expected Control Tower endpoint is not served.
    monkeypatch.setattr(api_shared, '_cafe24_control_port_open', lambda: True)
    monkeypatch.setattr(api_shared.requests, 'get', lambda *args, **kwargs: _WrongServiceResponse())

    # When: the local service status is calculated.
    status = api_shared._cafe24_control_status_payload()

    # Then: callers can distinguish a port conflict from a stopped service.
    assert status['running'] is False
    assert status['portConflict'] is True


def test_cafe24_start_returns_immediately_when_another_service_owns_the_port(monkeypatch) -> None:
    # Given: the semantic status reports a port conflict.
    monkeypatch.setattr(api_core, '_local_action_request_allowed', lambda: True)
    monkeypatch.setattr(
        api_core,
        '_cafe24_control_status_payload',
        lambda: {
            'ok': True,
            'running': False,
            'portOpen': True,
            'portConflict': True,
            'healthOk': False,
            'port': 8787,
        },
    )

    def fail_if_started(*args, **kwargs):
        raise _UnexpectedProcessStart('port conflicts must not launch or poll')

    monkeypatch.setattr(api_core.subprocess, 'Popen', fail_if_started)
    app = Flask(__name__)

    # When: the start route is invoked.
    with app.test_request_context('/api/cafe24-control/start', method='POST'):
        response, status_code = api_core.cafe24_control_start()

    # Then: it returns a conflict without starting a process or entering the poll loop.
    assert status_code == 409
    assert response.get_json()['portConflict'] is True

