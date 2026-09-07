"""계약: **VM 이 꺼져 있으면 "켤까요?" 를 물을 수 있어야 한다.**

주인님 2026-09-06: "꺼져있으면 실행하게끔 UX가 가야하지 않어? 전엔 그랬었는데"

무슨 일이 있었나 (실측 2026-09-06):
  호스트 스크래퍼는 포트 43000 에서 멀쩡히 돌고 있었는데 **VM 이 통째로 꺼져 있어**
  후보 수집 watcher 가 35시간(2111분) 응답이 없었다. 그런데 화면은
  "VM 안에서 후보 수집 watcher 를 다시 실행해주세요" 라고만 했다.
  **들어갈 VM 자체가 꺼져 있는데** 사람에게 들어가라고 한 것이다.

  2026-09-02 에 이 갈래를 만들면서 "이미 켜져 있으니 켜라고 물어도 소용없다" 고 적었는데
  그 판단이 좁았다. 호스트가 켜져 있어도 **VM 은 켤 수 있다.**

주인님 상시 규칙: 필수 의존 서비스는 수동 기동만 시키지 말고 자동 기동을 먼저 권한다.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import api_shared  # noqa: E402
from services import vm_candidate_bridge  # noqa: E402


def _stub_scraper(monkeypatch, *, port_open=True):
    monkeypatch.setattr(api_shared, "_jepum_scraper_port", lambda: 43000)
    monkeypatch.setattr(api_shared, "_jepum_scraper_port_open", lambda port=None: port_open)

    class _Response:
        status_code = 200
        ok = True
        headers = {"content-type": "application/json"}

        def json(self):
            return {"ok": True}

    monkeypatch.setattr(api_shared.requests, "get", lambda *a, **k: _Response())


def test_vm_off_is_reported_as_startable(monkeypatch):
    """VM 이 꺼져 있으면 화면이 '켤까요?' 를 띄울 근거(canStartVm)를 준다."""
    _stub_scraper(monkeypatch)
    monkeypatch.setattr(api_shared, "_jepum_watcher_verdict", lambda: {
        "candidateWatcherAlive": False,
        "heartbeatAgeSeconds": 126554.0,
        "vmPowerState": "poweroff",
        "canStartVm": True,
    })
    status = api_shared._jepum_scraper_status_payload()
    assert status["running"] is True, "호스트 스크래퍼는 켜져 있다"
    assert status["usable"] is False, "그런데 후보 수집은 못 한다"
    assert status["canStartVm"] is True, "VM 은 켤 수 있다 - 화면이 물어봐야 한다"
    assert status["vmPowerState"] == "poweroff"
    # 문구가 "VM 안에서 실행해주세요" 로 끝나면 안 된다. 들어갈 VM 이 꺼져 있다.
    assert "꺼져" in status["message"], f"VM 이 꺼졌다는 사실을 말해야 합니다: {status['message']}"
    assert "VM 안에서" not in status["message"], \
        f"들어갈 VM 이 꺼져 있는데 들어가라고 합니다: {status['message']}"


def test_vm_on_but_watcher_dead_tells_the_truth(monkeypatch):
    """VM 은 켜져 있는데 watcher 만 죽은 경우 - 이때는 정말 VM 안에서 실행해야 한다."""
    _stub_scraper(monkeypatch)
    monkeypatch.setattr(api_shared, "_jepum_watcher_verdict", lambda: {
        "candidateWatcherAlive": False,
        "heartbeatAgeSeconds": 900.0,
        "vmPowerState": "running",
        "canStartVm": False,
    })
    status = api_shared._jepum_scraper_status_payload()
    assert status["canStartVm"] is False, "켜져 있으니 켤 것이 없다"
    assert "VM 안에서" in status["message"], f"이때는 VM 안에서 실행해야 합니다: {status['message']}"


def test_watcher_alive_does_not_pay_for_a_vm_lookup(monkeypatch):
    """watcher 가 멀쩡하면 VBoxManage 를 부르지 않는다.

    화면이 이 상태를 자주 읽는다. 멀쩡할 때마다 외부 프로세스를 띄우면 수백 ms 가 붙는다.
    """
    calls = []
    monkeypatch.setattr(vm_candidate_bridge, "vm_power_state", lambda: calls.append(1) or "running")
    monkeypatch.setattr(vm_candidate_bridge, "detail_capture_readiness", lambda: {})

    class _FreshPath:
        def stat(self):
            class _Stat:
                st_mtime = __import__("time").time()
            return _Stat()

    monkeypatch.setattr(vm_candidate_bridge, "_watcher_heartbeat_path", lambda: _FreshPath())
    verdict = vm_candidate_bridge.watcher_readiness()
    assert verdict["candidateWatcherAlive"] is True
    assert calls == [], "watcher 가 멀쩡한데 VM 전원을 물어봤습니다"
    assert verdict["canStartVm"] is False


def test_start_route_starts_the_vm_when_scraper_is_already_running(monkeypatch):
    """`이미 실행 중` 이라며 그냥 돌아가지 않는다 - VM 이 꺼졌으면 켠다."""
    from app import create_app
    from routes import api_core

    monkeypatch.setattr(api_core, "_jepum_scraper_status_payload", lambda: {
        "ok": True, "running": True, "usable": False, "canStartVm": True,
        "vmPowerState": "poweroff", "port": 43000, "message": "",
    })
    started = []
    monkeypatch.setattr(
        vm_candidate_bridge, "start_vm",
        lambda: started.append(1) or {"ok": True, "started": True, "vmPowerState": "running", "message": "VM 을 켰습니다."},
    )

    client = create_app().test_client()
    result = client.post("/api/jepum-scraper/start", json={},
                         headers={"Sec-Fetch-Site": "same-origin"})
    assert started == [1], "VM 을 켜지 않고 그냥 돌아갔습니다"
    payload = result.get_json()
    assert payload["vmStarted"] is True
    assert "VM" in payload["message"]


def test_start_route_leaves_a_running_vm_alone(monkeypatch):
    """VM 이 이미 켜져 있으면 건드리지 않는다."""
    from app import create_app
    from routes import api_core

    monkeypatch.setattr(api_core, "_jepum_scraper_status_payload", lambda: {
        "ok": True, "running": True, "usable": True, "canStartVm": False,
        "vmPowerState": "running", "port": 43000, "message": "",
    })
    monkeypatch.setattr(
        vm_candidate_bridge, "start_vm",
        lambda: (_ for _ in ()).throw(AssertionError("켜져 있는 VM 을 또 켰습니다")),
    )

    client = create_app().test_client()
    result = client.post("/api/jepum-scraper/start", json={},
                         headers={"Sec-Fetch-Site": "same-origin"})
    assert "이미 실행 중" in result.get_json()["message"]


def test_start_vm_is_a_real_function_not_a_name(monkeypatch):
    """대역이 아니라 **진짜 함수**가 있는지 본다.

    2026-09-02 에 없는 이름을 부르는데 예외를 삼켜 조용히 못 쓰게 된 적이 있다.
    """
    assert callable(vm_candidate_bridge.start_vm)
    assert callable(vm_candidate_bridge.vm_power_state)
    # VirtualBox 가 없는 환경에서도 던지지 않고 사람 말로 답해야 한다.
    monkeypatch.setattr(vm_candidate_bridge, "_vboxmanage_path", lambda: None)
    assert vm_candidate_bridge.vm_power_state() == "unknown"
    result = vm_candidate_bridge.start_vm()
    assert result["ok"] is False
    assert "VirtualBox" in result["message"]
