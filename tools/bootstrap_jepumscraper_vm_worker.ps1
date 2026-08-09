[CmdletBinding()]
param(
    [string]$SourceZipUrl = '',
    [string]$SourceArchivePath = '',
    [int]$Port = 5002,
    [string]$WorkerRoot = 'C:\JepumScraper',
    [string]$StateRoot = 'C:\ProgramData\JepumVMWorker',
    [string]$BridgeRoot = '\\VBOXSVR\KuasangseVmBridge',
    [switch]$NoRegister,
    [switch]$ForceRestart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-WorkerLog {
    param([string]$Message)

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $script:BootstrapLog -Value "[$timestamp] $Message"
}

function Invoke-WorkerNative {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Label
    )

    Write-WorkerLog "$Label 시작"
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $FilePath @Arguments *>> $script:BootstrapLog
        $nativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($nativeExitCode -ne 0) {
        throw "$Label 실패: exitCode=$nativeExitCode"
    }
    Write-WorkerLog "$Label 완료"
}

function Get-AutoHotkeyExecutable {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\AutoHotkey\v2\AutoHotkey64.exe'),
        'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe',
        'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    return ''
}

function Ensure-AutoHotkey {
    $existing = Get-AutoHotkeyExecutable
    if ($existing) {
        Write-WorkerLog "AutoHotkey v2 준비 완료: $existing"
        return $existing
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'AutoHotkey v2가 없고 winget을 찾지 못했습니다.'
    }
    Invoke-WorkerNative -FilePath $winget.Source -Arguments @(
        'install', '--id', 'AutoHotkey.AutoHotkey', '--exact', '--silent',
        '--accept-source-agreements', '--accept-package-agreements'
    ) -Label 'AutoHotkey v2 설치'

    $installed = Get-AutoHotkeyExecutable
    if (-not $installed) {
        throw 'AutoHotkey v2 설치 후 실행 파일을 찾지 못했습니다.'
    }
    Write-WorkerLog "AutoHotkey v2 설치 완료: $installed"
    return $installed
}

function Get-WorkerPython {
    $candidates = @(
        'C:\Program Files\Python312\python.exe',
        (Join-Path $env:LocalAppData 'Programs\Python\Python312\python.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    $installer = Join-Path $script:StateRoot 'python-3.12.10-amd64.exe'
    if (-not (Test-Path -LiteralPath $installer)) {
        Write-WorkerLog 'Python 3.12 설치 파일 다운로드 시작'
        Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile $installer
    }

    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $installAllUsers = if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { '1' } else { '0' }
    $process = Start-Process -FilePath $installer -ArgumentList @(
        '/quiet',
        "InstallAllUsers=$installAllUsers",
        'PrependPath=1',
        'Include_pip=1',
        'Include_test=0'
    ) -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Python 설치 실패: exitCode=$($process.ExitCode)"
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    throw "Python 설치 후 실행 파일을 찾지 못했습니다: $($candidates -join ', ')"
}

function Get-InteractiveChromeUserDataDirectory {
    $candidates = [System.Collections.Generic.List[string]]::new()
    try {
        $activeUser = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
        if ($activeUser) {
            $userName = $activeUser.Split('\')[-1]
            $candidates.Add((Join-Path (Join-Path 'C:\Users' $userName) 'AppData\Local\Google\Chrome\User Data'))
        }
    } catch {
    }
    try {
        Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction Stop |
            ForEach-Object {
                $candidate = Join-Path $_.FullName 'AppData\Local\Google\Chrome\User Data'
                if ($candidate -notin $candidates) {
                    $candidates.Add($candidate)
                }
            }
    } catch {
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'Local State') -PathType Leaf) {
            return $candidate
        }
    }
    return (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data')
}

function Get-NaverChromeCdpUserDataDirectory {
    $cdpProfile = 'C:\TrainingRoom\tools\chrome-profile-naver-cdp'
    if (Test-Path -LiteralPath (Join-Path $cdpProfile 'Local State') -PathType Leaf) {
        return $cdpProfile
    }
    return Get-InteractiveChromeUserDataDirectory
}

function Install-WorkerSource {
    if (Test-Path -LiteralPath (Join-Path $WorkerRoot 'main.py')) {
        return
    }
    $archive = Join-Path $script:StateRoot 'jepumscraper-source.zip'
    $staging = Join-Path $script:StateRoot 'source-staging'
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($SourceArchivePath)) {
        if (-not (Test-Path -LiteralPath $SourceArchivePath)) {
            throw "SourceArchivePath를 찾지 못했습니다: $SourceArchivePath"
        }
        Write-WorkerLog 'JepumScraper 소스 아카이브 복사 시작'
        Copy-Item -LiteralPath $SourceArchivePath -Destination $archive -Force
    } elseif (-not [string]::IsNullOrWhiteSpace($SourceZipUrl)) {
        if ($SourceZipUrl -notmatch '^http://10\.0\.2\.2:\d+/.+') {
            throw 'SourceZipUrl은 VM 호스트의 로컬 전송 주소여야 합니다.'
        }
        Write-WorkerLog 'JepumScraper 소스 다운로드 시작'
        Invoke-WebRequest -Uri $SourceZipUrl -OutFile $archive
    } else {
        throw '첫 부팅에는 -SourceArchivePath 또는 -SourceZipUrl이 필요합니다.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
    if (-not (Test-Path -LiteralPath (Join-Path $staging 'main.py'))) {
        throw '소스 아카이브에 main.py가 없습니다.'
    }
    Remove-Item -LiteralPath $WorkerRoot -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $staging -Destination $WorkerRoot
    Write-WorkerLog 'JepumScraper 소스 설치 완료'
}

function Get-WorkerSharedSourceRoot {
    $sourceRoots = @(
        '\\VBOXSVR\KuasangseBootstrap\output\vm-rebuild\source-stage\JepumScraper',
        'Z:\output\vm-rebuild\source-stage\JepumScraper'
    )
    foreach ($sourceRoot in $sourceRoots) {
        if (Test-Path -LiteralPath (Join-Path $sourceRoot 'main.py') -PathType Leaf) {
            return $sourceRoot
        }
    }
    return ''
}

function Update-PersistentBootstrapSource {
    $sourceCandidates = @(
        '\\VBOXSVR\KuasangseBootstrap\tools\bootstrap_jepumscraper_vm_worker.ps1',
        'Z:\tools\bootstrap_jepumscraper_vm_worker.ps1'
    )
    $source = $sourceCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $source) {
        Write-WorkerLog '호스트의 최신 VM 부트스트랩을 찾지 못해 현재 사본을 유지합니다.'
        return $false
    }

    $target = Join-Path $script:StateRoot 'bootstrap_jepumscraper_vm_worker.ps1'
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $targetHash = if (Test-Path -LiteralPath $target -PathType Leaf) {
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    } else {
        ''
    }
    if ($sourceHash -eq $targetHash) {
        return $false
    }

    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-WorkerLog "최신 VM 부트스트랩 영구 사본 갱신 완료: $sourceHash"
    return $true
}

function Sync-WorkerSourcePatch {
    $sourceRoot = Get-WorkerSharedSourceRoot
    if (-not $sourceRoot) {
        Write-WorkerLog '호스트 공유 소스를 찾지 못해 VM 워커 패치 동기화를 건너뜁니다.'
        return
    }
    $patches = @(
        @{ Source = (Join-Path $sourceRoot 'main.py'); Relative = 'main.py' },
        @{ Source = (Join-Path $sourceRoot 'engine\browser_profile.py'); Relative = 'engine\browser_profile.py' },
        @{ Source = (Join-Path $sourceRoot 'engine\pro_crawler.py'); Relative = 'engine\pro_crawler.py' },
        @{ Source = (Join-Path $sourceRoot 'scrapers\coupang_scraper.py'); Relative = 'scrapers\coupang_scraper.py' },
        @{ Source = (Join-Path $sourceRoot 'scrapers\auction_scraper.py'); Relative = 'scrapers\auction_scraper.py' },
        @{ Source = (Join-Path $sourceRoot 'scrapers\elevenst_scraper.py'); Relative = 'scrapers\elevenst_scraper.py' },
        @{ Source = (Join-Path $sourceRoot 'scrapers\gmarket_scraper.py'); Relative = 'scrapers\gmarket_scraper.py' },
        @{ Source = (Join-Path $sourceRoot 'scrapers\naver_shopping_scraper.py'); Relative = 'scrapers\naver_shopping_scraper.py' },
        @{ Source = (Join-Path $sourceRoot 'services\search_service.py'); Relative = 'services\search_service.py' },
        @{ Source = (Join-Path $sourceRoot 'services\detail_scraper.py'); Relative = 'services\detail_scraper.py' },
        @{ Source = (Join-Path $sourceRoot 'services\vm_capture_client.py'); Relative = 'services\vm_capture_client.py' },
        @{ Source = (Join-Path $sourceRoot 'tools\naver_login_click_v2.ahk'); Relative = 'tools\naver_login_click_v2.ahk' }
    )
    foreach ($patch in $patches) {
        if (-not (Test-Path -LiteralPath $patch.Source -PathType Leaf)) {
            continue
        }
        $target = Join-Path $WorkerRoot $patch.Relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Copy-Item -LiteralPath $patch.Source -Destination $target -Force
        Write-WorkerLog ("호스트 공유 소스 동기화 완료: " + $patch.Relative)
    }
}

function Register-WorkerBootTask {
    if ($NoRegister) {
        return
    }

    $taskName = 'JepumScraper VM Worker'
    $taskScript = Join-Path $script:StateRoot 'bootstrap_jepumscraper_vm_worker.ps1'
    if (-not [IO.Path]::GetFullPath($PSCommandPath).Equals([IO.Path]::GetFullPath($taskScript), [StringComparison]::OrdinalIgnoreCase)) {
        Copy-Item -LiteralPath $PSCommandPath -Destination $taskScript -Force
    }
    $taskArgument = "-NoProfile -ExecutionPolicy Bypass -File `"$taskScript`" -Port $Port -WorkerRoot `"$WorkerRoot`" -StateRoot `"$StateRoot`" -BridgeRoot `"$BridgeRoot`" -NoRegister"
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgument
    $taskTrigger = New-ScheduledTaskTrigger -AtStartup
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    try {
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
        Unregister-ScheduledTask -TaskName 'JepumScraper VM Worker Bootstrap Seed' -Confirm:$false -ErrorAction SilentlyContinue
        Write-WorkerLog 'SYSTEM 부팅 작업 등록 완료'
    } catch {
        # A standard auto-logon VM account cannot create a SYSTEM task. Keep
        # the worker persistent without weakening Windows authentication by
        # falling back to the current user's Run key.
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        $runCommand = "`"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"$taskScript`" -Port $Port -WorkerRoot `"$WorkerRoot`" -StateRoot `"$StateRoot`" -BridgeRoot `"$BridgeRoot`" -NoRegister"
        New-Item -Path $runKey -Force | Out-Null
        Set-ItemProperty -Path $runKey -Name 'JepumScraper VM Worker' -Value $runCommand -Type String
        Write-WorkerLog 'SYSTEM 부팅 작업 권한 없음: 현재 자동 로그인 계정의 Run 키로 대체 등록 완료'
    }
}

function Start-Worker {
    $healthUrl = "http://127.0.0.1:$Port/health"
    try {
        $existing = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($existing.ok) {
            $apiHealth = $null
            $apiHealthAvailable = $false
            try {
                $apiHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
                $apiHealthAvailable = $true
            } catch {
                Write-WorkerLog '기존 VM 워커의 v1 상태 API를 확인하지 못해 새 VM 환경으로 교체합니다.'
            }

            if ($apiHealthAvailable -and -not [bool]$apiHealth.auth.enabled -and -not $ForceRestart) {
                Write-WorkerLog '기존 VM 워커가 이미 준비됨: auth.enabled=false'
                return
            }

            if ($ForceRestart) {
                Write-WorkerLog '명시적 재시작 요청으로 기존 VM 워커를 교체합니다.'
            } elseif ($apiHealthAvailable) {
                Write-WorkerLog '기존 워커에 인증이 켜져 있어 VM 워커 환경으로 재기동합니다.'
            }
            $listenerPids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique)
            foreach ($listenerPid in $listenerPids) {
                if ([int]$listenerPid -le 0) {
                    continue
                }
                try {
                    Stop-Process -Id $listenerPid -Force -ErrorAction Stop
                    Write-WorkerLog "기존 VM 워커 종료: pid=$listenerPid"
                } catch {
                    Write-WorkerLog "기존 VM 워커 종료 실패: pid=$listenerPid · $($_.Exception.Message)"
                }
            }
            Start-Sleep -Seconds 1
        }
    } catch {
        # A new worker is required.
    }

    $python = Get-WorkerPython
    $requirements = Join-Path $WorkerRoot 'requirements.txt'
    if (-not (Test-Path -LiteralPath $requirements)) {
        throw "requirements.txt가 없습니다: $requirements"
    }

    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $WorkerRoot 'ms-playwright'
    $dependencyMarker = Join-Path $script:StateRoot 'dependencies-ready'
    $dependenciesReady = Test-Path -LiteralPath $dependencyMarker
    if ($dependenciesReady) {
        $dependencyProbe = Start-Process -FilePath $python -ArgumentList @(
            '-c', 'import greenlet; from playwright.sync_api import sync_playwright'
        ) -Wait -PassThru -WindowStyle Hidden
        if ($dependencyProbe.ExitCode -ne 0) {
            $dependenciesReady = $false
            Remove-Item -LiteralPath $dependencyMarker -Force -ErrorAction SilentlyContinue
            Write-WorkerLog '의존성 마커는 있었지만 Playwright/greenlet import가 실패하여 복구 설치합니다.'
        }
    }
    if (-not $dependenciesReady) {
        $candidatePackages = @(
            'flask',
            'asgiref',
            'playwright',
            'Pillow',
            'ImageHash',
            'requests',
            'numpy',
            'beautifulsoup4',
            'aiohttp',
            'fake_useragent',
            'lxml',
            'DrissionPage',
            'pyautogui',
            'python-dotenv',
            'openpyxl',
            'pywin32',
            'google-api-python-client',
            'google-auth-oauthlib',
            'google-auth-httplib2'
        )
        # Do not self-upgrade pip during unattended bootstrap.  Replacing the
        # running pip package can return a non-zero exit code on a per-user
        # Python install and prevents the worker from ever opening port 5002.
        # A corrupt pip cache can make a first-run install fail even though all
        # required packages are otherwise available. The cache is optional, so
        # bootstrap must bypass it instead of leaving the VM worker half-built.
        Invoke-WorkerNative -FilePath $python -Arguments (@('-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', '--no-cache-dir') + $candidatePackages) -Label '후보 수집 의존성 설치'
        # pip may report "requirement already satisfied" even when greenlet's
        # compiled extension is missing or corrupt. Playwright then fails in
        # every browser-backed market, so repair that binary explicitly.
        Invoke-WorkerNative -FilePath $python -Arguments @(
            '-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location',
            '--no-cache-dir', '--force-reinstall', '--no-deps', 'greenlet'
        ) -Label 'Playwright greenlet 바이너리 복구'
        Invoke-WorkerNative -FilePath $python -Arguments @(
            '-c', 'import greenlet; from playwright.sync_api import sync_playwright'
        ) -Label 'Playwright 런타임 import 확인'
        Invoke-WorkerNative -FilePath $python -Arguments @('-m', 'playwright', 'install', 'chromium') -Label 'Playwright Chromium 설치'
        New-Item -ItemType File -Path $dependencyMarker -Force | Out-Null
    }

    $env:JEPUMSCRAPER_VM_WORKER = '1'
    $env:JEPUMSCRAPER_HOST = '0.0.0.0'
    $env:JEPUMSCRAPER_PORT = [string]$Port
    $env:JEPUMSCRAPER_BROWSER_HOST = '127.0.0.1'
    $env:CHROME_USER_DATA_DIR = Get-NaverChromeCdpUserDataDirectory
    $env:NAVER_DEBUG_PORT = '9222'
    Write-WorkerLog "네이버 Chrome 세션 경로 설정: $env:CHROME_USER_DATA_DIR"
    $stdout = Join-Path $script:StateRoot 'vm-worker-stdout.log'
    $stderr = Join-Path $script:StateRoot 'vm-worker-stderr.log'
    $process = Start-Process -FilePath $python -ArgumentList @('main.py') -WorkingDirectory $WorkerRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru

    $deadline = (Get-Date).AddMinutes(3)
    $lastError = ''
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            throw "VM 워커가 종료되었습니다: exitCode=$($process.ExitCode)"
        }
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
            if ($health.ok) {
                Write-WorkerLog "VM 워커 준비 완료: pid=$($process.Id), port=$Port"
                return
            }
        } catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Seconds 2
        }
    }
    throw "VM 워커 준비 시간 초과: $lastError"
}

function Start-CandidateBridge {
    $sourceCandidates = @(
        '\\VBOXSVR\KuasangseBootstrap\tools\vm_candidate_file_bridge.ps1',
        'Z:\tools\vm_candidate_file_bridge.ps1',
        (Join-Path $PSScriptRoot 'vm_candidate_file_bridge.ps1'),
        (Join-Path (Split-Path -Parent $PSCommandPath) 'vm_candidate_file_bridge.ps1')
    )
    $source = $sourceCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $source) {
        Write-WorkerLog 'VM 후보 파일 브리지 스크립트를 찾지 못했습니다.'
        return
    }
    $target = Join-Path $script:StateRoot 'vm_candidate_file_bridge.ps1'
    if (-not [IO.Path]::GetFullPath($source).Equals([IO.Path]::GetFullPath($target), [StringComparison]::OrdinalIgnoreCase)) {
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
    $supervisorCandidates = @(
        '\\VBOXSVR\KuasangseBootstrap\tools\vm_candidate_bridge_supervisor.ps1',
        'Z:\tools\vm_candidate_bridge_supervisor.ps1',
        (Join-Path $PSScriptRoot 'vm_candidate_bridge_supervisor.ps1'),
        (Join-Path (Split-Path -Parent $PSCommandPath) 'vm_candidate_bridge_supervisor.ps1')
    )
    $supervisorSource = $supervisorCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $supervisorSource) {
        Write-WorkerLog 'VM 후보 브리지 감시 스크립트를 찾지 못했습니다.'
        return
    }
    $supervisorTarget = Join-Path $script:StateRoot 'vm_candidate_bridge_supervisor.ps1'
    if (-not [IO.Path]::GetFullPath($supervisorSource).Equals([IO.Path]::GetFullPath($supervisorTarget), [StringComparison]::OrdinalIgnoreCase)) {
        Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force
    }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^powershell(\.exe)?$' -and $_.CommandLine -match 'vm_candidate_(file_bridge|bridge_supervisor)\.ps1' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $supervisorTarget,
        '-BridgeScript', $target,
        '-BridgeRoot', $BridgeRoot,
        '-WorkerBase', "http://127.0.0.1:$Port",
        '-StateRoot', $script:StateRoot
    )
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $script:StateRoot -WindowStyle Hidden | Out-Null
    Write-WorkerLog "VM 후보 파일 브리지 감시 시작: $BridgeRoot"
}

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$script:StateRoot = $StateRoot
$script:BootstrapLog = Join-Path $StateRoot 'bootstrap.log'

try {
    Write-WorkerLog 'VM 워커 부트스트랩 시작'
    $persistentBootstrapUpdated = Update-PersistentBootstrapSource
    $persistentBootstrap = Join-Path $script:StateRoot 'bootstrap_jepumscraper_vm_worker.ps1'
    if ($persistentBootstrapUpdated -and
        [IO.Path]::GetFullPath($PSCommandPath).Equals([IO.Path]::GetFullPath($persistentBootstrap), [StringComparison]::OrdinalIgnoreCase)) {
        $restartArguments = @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', $persistentBootstrap,
            '-Port', [string]$Port,
            '-WorkerRoot', $WorkerRoot,
            '-StateRoot', $StateRoot,
            '-BridgeRoot', $BridgeRoot,
            '-NoRegister',
            '-ForceRestart'
        )
        Start-Process -FilePath 'powershell.exe' -ArgumentList $restartArguments -WindowStyle Hidden | Out-Null
        Write-WorkerLog '갱신된 VM 부트스트랩으로 즉시 재실행합니다.'
        exit 0
    }
    Install-WorkerSource
    $null = Ensure-AutoHotkey
    Sync-WorkerSourcePatch
    Register-WorkerBootTask
    Start-Worker
    Start-CandidateBridge
} catch {
    Write-WorkerLog "VM 워커 부트스트랩 실패: $($_.Exception.Message)"
    throw
}
