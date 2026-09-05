"""계약: Vertex 프로젝트 갈아끼우기 도구가 **안전하게** 동작한다.

주인님 2026-09-04: "앞으로도 아이디는 계속 바꿀 예정이니까 쉽게쉽게 갈아낄 수 있도록
시스템까지 만들어놔야 해"

이 도구는 사장님의 살아 있는 설정을 바꾼다. 그래서 지켜야 할 것이 셋이다.
  1. 막힐 것이 있으면 **아무것도 바꾸기 전에** 멈춘다.
  2. 확인하지 못한 것을 차단 사유로 쓰지 않는다 - 멀쩡한 프로젝트를 못 쓰게 된다.
  3. 설정을 쓰는 프로그램을 하나도 빠뜨리지 않는다.
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
from pathlib import Path

import pytest

TOOL_PATH = Path(__file__).resolve().parents[2] / "tools" / "switch_vertex_project.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("switch_vertex_project", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["switch_vertex_project"] = module
    spec.loader.exec_module(module)
    return module


def test_tool_exists_and_imports():
    assert TOOL_PATH.exists(), f"도구가 없습니다: {TOOL_PATH}"
    tool = load_tool()
    assert callable(tool.main)


def test_consumers_cover_every_program_that_reads_vertex_config():
    """설정을 읽는 프로그램을 하나라도 빠뜨리면, 그 프로그램만 옛 프로젝트를 계속 본다.

    실측 2026-09-04: 상세페이지와 사쵸상세가 서로의 경로를 코드에 박아 놓고 덮어썼다.
    한쪽을 고치면 다른 쪽을 잊는 구조였다. 이제 한 곳(CONSUMERS)에 모은다.
    """
    tool = load_tool()
    labels = [label for label, _ in tool.CONSUMERS]
    paths = [path for _, path in tool.CONSUMERS]
    assert len(set(paths)) == len(paths), "같은 경로가 두 번 들어 있습니다"
    assert all(os.path.isabs(path) for path in paths), "경로는 절대경로여야 합니다"
    assert any("kuasangse" in path for path in paths), "상세페이지가 목록에 없습니다"
    assert any("sachyosangse" in path for path in paths), "사쵸상세가 목록에 없습니다"
    assert all(label.strip() for label in labels), "이름 없는 항목이 있습니다"


def test_write_is_atomic_and_keeps_the_old_file_on_failure(tmp_path):
    """쓰다 실패해도 원본은 그대로여야 한다. 반쯤 쓰인 설정은 앱을 못 뜨게 한다."""
    tool = load_tool()
    target = tmp_path / "vertex-config.json"
    target.write_text(json.dumps({"project": "예전", "location": "global"}), encoding="utf-8")

    # 정상 경로
    assert tool.write_consumer(str(target), "새프로젝트", "asia-northeast3") == ""
    assert json.loads(target.read_text(encoding="utf-8")) == {
        "project": "새프로젝트", "location": "asia-northeast3",
    }

    # 폴더가 없으면 원본을 건드리지 않고 사유를 돌려준다.
    missing = tmp_path / "없는폴더" / "vertex-config.json"
    assert tool.write_consumer(str(missing), "x", "global") == "폴더 없음"

    # 임시 파일을 남기지 않는다.
    leftovers = list(tmp_path.glob("*.switching.tmp"))
    assert leftovers == [], f"임시 파일이 남았습니다: {leftovers}"


def test_unverifiable_billing_is_not_a_blocker():
    """**확인 못 한 것을 차단 사유로 쓰지 않는다.**

    실측 2026-09-04: 결제 조회에 할당량 헤더를 붙였더니 Cloud Billing API 가 꺼진
    프로젝트에서 403 이 났고, 도구가 그것을 '막힘' 으로 읽어 **멀쩡히 되는 프로젝트를
    거부**했다. 진짜 증거는 마지막의 실제 이미지 생성이다.
    """
    source = TOOL_PATH.read_text(encoding="utf-8")
    assert "결제 상태를 확인하지 못했습니다" not in source, \
        "결제 확인 실패를 차단 사유(problems)로 다시 넣었습니다 - 되는 프로젝트가 막힙니다"
    assert "확인 못 함(계속 진행합니다)" in source, \
        "결제를 확인하지 못했을 때 계속 진행한다는 표시가 없습니다"


def test_billing_lookup_does_not_send_quota_project_header():
    """할당량 헤더를 붙이면 그 프로젝트에 Cloud Billing API 까지 켜져 있어야 한다."""
    source = TOOL_PATH.read_text(encoding="utf-8")
    start = source.index("cloudbilling.googleapis.com")
    window = source[start:start + 260]
    assert "project_id" not in window.split("token")[-1][:80], \
        "결제 조회에 할당량 프로젝트를 넘기고 있습니다"


def test_stops_before_touching_settings_when_project_is_unreachable(monkeypatch, capsys):
    """접근 못 하는 프로젝트를 주면, 설정 파일을 **하나도** 건드리지 않고 멈춰야 한다."""
    tool = load_tool()
    written = []
    monkeypatch.setattr(tool, "write_consumer", lambda *a, **k: written.append(a) or "")
    monkeypatch.setattr(tool, "project_number", lambda token, pid: ("", "The caller does not have permission"))

    problems = tool.diagnose("project-없는-것", "가짜토큰")
    assert problems, "접근 불가인데 문제로 보고하지 않았습니다"
    assert "--login" in problems[0], "무엇을 하면 되는지 안내가 없습니다"
    assert written == [], "막혔는데도 설정 파일을 건드렸습니다"


def test_resolve_executable_finds_windows_batch_wrappers(monkeypatch):
    """Windows 에서 gcloud 는 gcloud.cmd 다. 못 찾으면 '토큰 없음' 이라 잘못 말한다."""
    tool = load_tool()
    calls = []

    def fake_which(name):
        calls.append(name)
        return r"C:\fake\gcloud.cmd" if name == "gcloud.cmd" else None

    monkeypatch.setattr(tool.shutil, "which", fake_which)
    assert tool.resolve_executable("gcloud") == r"C:\fake\gcloud.cmd"
    assert calls[0] == "gcloud" and "gcloud.cmd" in calls


def test_status_mode_changes_nothing(monkeypatch, capsys):
    """--status 는 진단만 한다. 요금도 안 나가고 설정도 안 바뀐다."""
    tool = load_tool()
    monkeypatch.setattr(sys, "argv", ["switch_vertex_project.py", "--status"])
    monkeypatch.setattr(tool, "access_token", lambda: "")
    monkeypatch.setattr(tool, "write_consumer", lambda *a, **k: pytest.fail("--status 가 설정을 바꿨습니다"))
    monkeypatch.setattr(tool, "verify_generation", lambda: pytest.fail("--status 가 요금 나가는 생성을 했습니다"))
    assert tool.main() == 0
    output = capsys.readouterr().out
    assert "지금 상태" in output
