from __future__ import annotations

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
LAUNCHER_PATH = REPOSITORY_ROOT / "control_tower" / "launch.ps1"
INSTALLER_PATH = REPOSITORY_ROOT / "control_tower" / "install_shortcut.ps1"


def _read_required(path: Path) -> str:
    assert path.is_file(), f"필수 Windows 실행 파일이 없습니다: {path.name}"
    return path.read_text(encoding="utf-8")


def test_launcher_owns_only_isolated_control_tower_ports() -> None:
    # Given: 생산관제 전용 Windows 실행기 원문을 준비한다.
    source = _read_required(LAUNCHER_PATH)

    # When: 실행기가 소유하도록 선언한 포트와 기동 경로를 확인한다.
    required_fragments = (
        "$BackendPort = 5062",
        "$FrontendPort = 8082",
        "control_tower.backend.app",
        "http.server",
        "-WindowStyle Hidden",
    )

    # Then: 생산관제 전용 포트만 사용하고 기존 조립공장 포트를 언급하지 않아야 한다.
    assert all(fragment in source for fragment in required_fragments)
    assert "5050" not in source
    assert "8081" not in source


def test_launcher_serializes_double_clicks_and_never_blindly_kills_port_owners() -> None:
    # Given: 시작·정지·상태를 모두 담당하는 실행기 원문을 준비한다.
    source = _read_required(LAUNCHER_PATH)

    # When: 중복 실행과 프로세스 소유권 검증 계약을 찾는다.
    required_fragments = (
        "System.Threading.Mutex",
        "Get-NetTCPConnection",
        "Win32_Process",
        "CommandLine",
        "Test-ManagedProcess",
        "Stop-Process",
        "포트를 다른 프로그램이 사용 중입니다",
    )

    # Then: mutex와 명령행 검증을 모두 거친 안전한 실행기여야 한다.
    assert all(fragment in source for fragment in required_fragments)
    assert "taskkill" not in source.lower()
    assert "Stop-Process -Name" not in source


def test_shortcut_installer_targets_launcher_and_product_icon() -> None:
    # Given: 바탕화면 바로가기 설치기 원문을 준비한다.
    source = _read_required(INSTALLER_PATH)

    # When: Windows 바로가기의 대상과 아이콘 계약을 확인한다.
    required_fragments = (
        "WScript.Shell",
        "CreateShortcut",
        "생산관제.lnk",
        "launch.ps1",
        "production-control.ico",
        "GetFolderPath(\"Desktop\")",
    )

    # Then: 전용 실행기와 제품 아이콘을 쓰는 바탕화면 바로가기여야 한다.
    assert all(fragment in source for fragment in required_fragments)


def test_frontend_readiness_survives_windows_powershell_51_utf8_decoding() -> None:
    launcher_source = _read_required(LAUNCHER_PATH)
    frontend_source = (REPOSITORY_ROOT / "control_tower" / "frontend" / "control-tower.html").read_text(
        encoding="utf-8",
    )
    marker = 'const healthUrl = "http://127.0.0.1:5062/api/health";'

    assert marker.isascii()
    assert marker in frontend_source
    assert f"$FrontendReadyMarker = '{marker}'" in launcher_source
    assert "$response.Content.Contains($FrontendReadyMarker)" in launcher_source
    assert '$response.Content.Contains("<title>생산관제</title>")' not in launcher_source


def test_backend_launch_command_carries_repository_marker_for_safe_stop() -> None:
    source = _read_required(LAUNCHER_PATH)
    expected_arguments = '$arguments = "-m control_tower.backend.app --control-tower-root `"$RepositoryRoot`""'

    assert expected_arguments in source
    assert "-ArgumentList $arguments" in source


def test_launcher_rejects_hidden_second_listener_instead_of_trusting_first_pid() -> None:
    source = _read_required(LAUNCHER_PATH)
    required_fragments = (
        "function Get-PortOwners",
        "netstat -ano -p TCP",
        "$owners = @(Get-PortOwners -Port $Port)",
        "$owners.Count -ne 1",
        "Test-ManagedProcess -ProcessId $owners[0] -Role $Role",
    )

    assert all(fragment in source for fragment in required_fragments)
    assert "Select-Object -First 1" not in source
