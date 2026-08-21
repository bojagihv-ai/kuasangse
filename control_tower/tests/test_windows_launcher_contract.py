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

    # Then: 서비스 listener는 생산관제 전용 포트만 소유해야 한다.
    assert all(fragment in source for fragment in required_fragments)
    assert "5050" not in source


def test_launcher_allows_the_loopback_factory_worker_origin_without_owning_its_port() -> None:
    source = _read_required(LAUNCHER_PATH)

    assert (
        '$env:CONTROL_TOWER_CORS_ORIGINS = '
        '"http://127.0.0.1:$FrontendPort,http://127.0.0.1:8081"'
    ) in source
    assert "http.server 8081" not in source


def test_launcher_serializes_double_clicks_and_never_blindly_kills_port_owners() -> None:
    # Given: 시작·정지·상태를 모두 담당하는 실행기 원문을 준비한다.
    source = _read_required(LAUNCHER_PATH)

    # When: 중복 실행과 프로세스 소유권 검증 계약을 찾는다.
    required_fragments = (
        "System.Threading.Mutex",
        "netstat.exe -ano -p TCP",
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
    assert f"    '{marker}'" in launcher_source
    assert "$BackendPort -eq 5062" in launcher_source
    assert "$response.Content.Contains($FrontendReadyMarker)" in launcher_source
    assert '$response.Content.Contains("<title>생산관제</title>")' not in launcher_source


def test_backend_launch_command_carries_repository_marker_for_safe_stop() -> None:
    source = _read_required(LAUNCHER_PATH)
    expected_arguments = '$arguments = "-m control_tower.backend.app --control-tower-root `"$RepositoryRoot`""'

    assert expected_arguments in source
    assert "-ArgumentList $arguments" in source


def test_launcher_replaces_every_owned_backend_family_but_rejects_any_non_owned_listener() -> None:
    # Given: Windows venv wrapper와 CPython child가 같은 backend port를 공유할 수 있다.
    source = _read_required(LAUNCHER_PATH)

    # When: stale backend port의 모든 listener를 분류한다.
    required_fragments = (
        "function Get-PortOwners",
        "netstat.exe -ano -p TCP",
        "function Get-ManagedProcessRoot",
        "$familyRoot = Get-ManagedProcessRoot",
        "foreach ($owner in $owners)",
        "Stop-ManagedProcessFamily -ProcessId $root -Role \"backend\"",
        "$owners.Count -eq 1 -and (Test-ControlTowerBackend)",
    )

    # Then: 모두 owned인 family만 함께 교체하고 하나라도 비소유면 계속 fail-closed한다.
    assert all(fragment in source for fragment in required_fragments)
    assert "Select-Object -First 1" not in source
    assert "포트를 다른 프로그램이 사용 중입니다" in source


def test_launcher_injects_current_user_dpapi_key_into_backend_child_only() -> None:
    # Given: shortcut가 실제로 실행하는 launcher 원문을 준비한다.
    source = _read_required(LAUNCHER_PATH)

    # When: service-key 획득과 backend child 시작 경계를 확인한다.
    required_fragments = (
        "PDP_CONTROL_SERVICE_KEY",
        "ProtectedData]::Unprotect",
        "DataProtectionScope]::CurrentUser",
        "FromBase64String",
        "Start-Backend",
        "Start-Frontend",
        "Start-ControlTowerBrowser",
        "finally",
    )

    # Then: key는 command line이 아닌 일시적 process environment로만 전달되어야 한다.
    assert all(fragment in source for fragment in required_fragments)
    assert "PDP_CONTROL_SERVICE_KEY=" not in source
    assert "X-PDP-Control-Service-Key" not in source


def test_launcher_opens_the_visible_default_browser_after_readiness() -> None:
    # Given: 이미 서버가 준비된 상태에서도 같은 launcher를 다시 실행한다.
    source = _read_required(LAUNCHER_PATH)

    # When: 사용자 화면을 여는 함수의 Windows Shell 호출을 확인한다.
    browser_open = '& (Join-Path $env:WINDIR "explorer.exe") $FrontendUrl | Out-Null'

    # Then: 백엔드만 확인하고 끝내지 않고 기본 브라우저의 실제 화면을 연다.
    assert browser_open in source
    assert "if (-not $NoBrowser)" in source


def test_launcher_starts_the_real_factory_worker_before_opening_production_control() -> None:
    source = _read_required(LAUNCHER_PATH)
    start_body = source[source.index("function Invoke-StartControlTower") :]

    assert 'Join-Path $RepositoryRoot "launcher.ps1"' in source
    assert '"-WorkerOnly"' in source
    assert "-WindowStyle Hidden" in source
    assert start_body.index("Start-FactoryWorkerBrowser") < start_body.index("Start-ControlTowerBrowser")


def test_launcher_waits_for_the_exact_manifest_worker_build_before_opening_control_tower() -> None:
    source = _read_required(LAUNCHER_PATH)
    worker_start = source.index("function Start-FactoryWorkerBrowser")
    worker_body = source[
        worker_start : source.index("function Stop-ManagedProcess", worker_start)
    ]

    assert 'Join-Path $RepositoryRoot "src\\runtime-manifest.json"' in source
    assert "$factoryState.expectedWorkerBuildId -ne $ExpectedWorkerBuildId" in source
    assert '"-ExpectedWorkerBuildId", $ExpectedWorkerBuildId' in worker_body
    assert "-Wait" in worker_body
    assert "$process.ExitCode -ne 0" in worker_body


def test_launcher_requires_business_api_readiness_and_replaces_only_owned_stale_backend() -> None:
    # Given: health와 process ownership을 함께 판단하는 launcher 원문을 준비한다.
    source = _read_required(LAUNCHER_PATH)

    # When/Then: jobs와 reviews가 모두 200이어야 재사용하고 owned family만 교체해야 한다.
    required_fragments = (
        "$BackendJobsUrl",
        "$BackendReviewsUrl",
        "Stop-ManagedProcessFamily",
        "Wait-PortAvailable",
        "Test-ManagedProcess",
    )
    assert all(fragment in source for fragment in required_fragments)


def test_launcher_supports_explicit_task_owned_runtime_without_changing_shortcut_defaults() -> None:
    # Given: production 기본값과 격리 검증 override가 공존하는 launcher를 준비한다.
    source = _read_required(LAUNCHER_PATH)

    # When/Then: 기본 5062/8082는 유지하되 tests가 임시 포트·artifact·runtime root를 주입할 수 있어야 한다.
    required_fragments = (
        "[int]$BackendPort = 5062",
        "[int]$FrontendPort = 8082",
        "[string]$PdpServiceKeyPath",
        "[string]$RuntimeRootOverride",
        "[string]$PdpControlBaseUrl",
        "[string]$PdpAssetsBaseUrl",
    )
    assert all(fragment in source for fragment in required_fragments)


def test_launcher_recovers_the_default_sinhwa_hub_before_control_tower_startup() -> None:
    # Given: 생산관제는 기본 설정에서 신화사 PDP API를 필수 작업 원장으로 사용한다.
    source = _read_required(LAUNCHER_PATH)

    # When: 신화사 Hub가 꺼진 상태에서 생산관제 시작 순서를 확인한다.
    dependency_call = "Ensure-SinhwaHubReady"
    backend_call = "Start-Backend"
    start_boundary = source.index("function Invoke-StartControlTower")
    start_body = source[start_boundary:]

    # Then: 고정된 신화사 관리 스크립트로 Hub를 먼저 복구하고 나서 생산관제를 띄워야 한다.
    required_fragments = (
        "manage_sinhwa_servers.ps1",
        "function Ensure-SinhwaHubReady",
        "SINHWA_HUB_ROOT",
        "-Action Start",
        "-BackendPort 8200",
        "-FrontendPort 5173",
        "-SqlContainerName disabled",
    )
    assert all(fragment in source for fragment in required_fragments)
    assert start_body.index(dependency_call) < start_body.index(backend_call)


def test_launcher_waits_only_for_the_sinhwa_manager_not_its_server_children() -> None:
    # Given: 신화사 관리 스크립트는 종료되지 않는 백엔드와 프론트엔드 자식 프로세스를 띄운다.
    source = _read_required(LAUNCHER_PATH)
    ensure_start = source.index("function Ensure-SinhwaHubReady")
    ensure_end = source.index("function Test-ControlTowerFrontend")
    ensure_body = source[ensure_start:ensure_end]

    # When: 생산관제 실행기가 신화사 관리 프로세스의 종료를 기다린다.
    # Then: 전체 프로세스 트리가 아니라 관리 프로세스 한 개만 기다려야 시작 흐름이 계속된다.
    assert "$managerProcess.WaitForExit()" in ensure_body
    assert "-Wait" not in ensure_body
