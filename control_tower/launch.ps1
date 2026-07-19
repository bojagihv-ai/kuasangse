[CmdletBinding()]
param(
    [ValidateSet("Start", "Stop", "Status", "Open")]
    [string]$Action = "Start",
    [switch]$NoBrowser,
    [switch]$NoDialog,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ControlTowerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $ControlTowerRoot
$BackendPort = 5062
$FrontendPort = 8082
$BackendHealthUrl = "http://127.0.0.1:$BackendPort/api/health"
$FrontendUrl = "http://127.0.0.1:$FrontendPort/control-tower.html"
$FrontendReadyMarker = 'const healthUrl = "http://127.0.0.1:5062/api/health";'
$FrontendRoot = Join-Path $ControlTowerRoot "frontend"
$PythonPath = Join-Path $RepositoryRoot "backend\venv311\Scripts\python.exe"
$RuntimeRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "KuaSangse\ProductionControl"
$StatePath = Join-Path $RuntimeRoot "launcher-state.json"
$MutexName = "Local\KuaSangseProductionControlLauncher"

function Initialize-RuntimeRoot {
    if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    }
}

function Get-PortOwners {
    param([int]$Port)

    $owners = New-Object "System.Collections.Generic.HashSet[int]"
    foreach ($connection in @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
        [void]$owners.Add([int]$connection.OwningProcess)
    }
    $pattern = "^\s*TCP\s+127\.0\.0\.1:$Port\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$"
    foreach ($line in @(netstat -ano -p TCP)) {
        $match = [regex]::Match([string]$line, $pattern)
        if ($match.Success) {
            [void]$owners.Add([int]$match.Groups["pid"].Value)
        }
    }
    return @($owners | Sort-Object)
}

function Test-ControlTowerBackend {
    try {
        $health = Invoke-RestMethod -Uri $BackendHealthUrl -Method Get -TimeoutSec 2
        return $health.service -eq "batch-production-control" -and $health.status -eq "ready"
    }
    catch {
        return $false
    }
}

function Test-ControlTowerFrontend {
    try {
        $response = Invoke-WebRequest -Uri $FrontendUrl -Method Get -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains($FrontendReadyMarker)
    }
    catch {
        return $false
    }
}

function Test-ManagedProcess {
    param(
        [int]$ProcessId,
        [ValidateSet("backend", "frontend")]
        [string]$Role
    )

    if ($ProcessId -le 0) {
        return $false
    }
    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $process -or [string]::IsNullOrWhiteSpace([string]$process.CommandLine)) {
        return $false
    }
    $commandLine = [string]$process.CommandLine
    $ownsRepository = $commandLine.IndexOf($RepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $ownsRepository) {
        return $false
    }
    if ($Role -eq "backend") {
        return $commandLine.IndexOf("control_tower.backend.app", [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    return $commandLine.IndexOf("http.server", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine.IndexOf([string]$FrontendPort, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Assert-PortAvailableOrOwned {
    param(
        [int]$Port,
        [ValidateSet("backend", "frontend")]
        [string]$Role
    )

    $owners = @(Get-PortOwners -Port $Port)
    if ($owners.Count -eq 0) {
        return
    }
    $managedOwner = $owners.Count -eq 1 -and (Test-ManagedProcess -ProcessId $owners[0] -Role $Role)
    $isExpectedService = if ($Role -eq "backend") {
        Test-ControlTowerBackend
    }
    else {
        Test-ControlTowerFrontend
    }
    if ($owners.Count -ne 1 -or -not $managedOwner -or -not $isExpectedService) {
        throw "생산관제 $Role 포트 $Port 포트를 다른 프로그램이 사용 중입니다. 해당 프로그램은 종료하지 않았습니다. PIDs=$($owners -join ',')"
    }
}

function Wait-ServiceReady {
    param(
        [ValidateSet("backend", "frontend")]
        [string]$Role,
        [int]$TimeoutSeconds = 25
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $ready = if ($Role -eq "backend") {
            Test-ControlTowerBackend
        }
        else {
            Test-ControlTowerFrontend
        }
        if ($ready) {
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "생산관제 $Role 서비스가 ${TimeoutSeconds}초 안에 준비되지 않았습니다."
}

function Start-Backend {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $stdoutPath = Join-Path $RuntimeRoot "backend-$stamp.stdout.log"
    $stderrPath = Join-Path $RuntimeRoot "backend-$stamp.stderr.log"
    $arguments = "-m control_tower.backend.app --control-tower-root `"$RepositoryRoot`""
    $process = Start-Process -FilePath $PythonPath `
        -ArgumentList $arguments `
        -WorkingDirectory $RepositoryRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    return [int]$process.Id
}

function Start-Frontend {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $stdoutPath = Join-Path $RuntimeRoot "frontend-$stamp.stdout.log"
    $stderrPath = Join-Path $RuntimeRoot "frontend-$stamp.stderr.log"
    $arguments = "-m http.server $FrontendPort --bind 127.0.0.1 --directory `"$FrontendRoot`""
    $process = Start-Process -FilePath $PythonPath `
        -ArgumentList $arguments `
        -WorkingDirectory $RepositoryRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    return [int]$process.Id
}

function Stop-ManagedProcess {
    param(
        [int]$ProcessId,
        [ValidateSet("backend", "frontend")]
        [string]$Role
    )

    if (Test-ManagedProcess -ProcessId $ProcessId -Role $Role) {
        Stop-Process -Id $ProcessId -Force
    }
}

function Read-LauncherState {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-LauncherState {
    param(
        [int]$BackendProcessId,
        [int]$FrontendProcessId,
        [string]$Status
    )

    Initialize-RuntimeRoot
    $state = [ordered]@{
        service = "batch-production-control"
        repositoryRoot = $RepositoryRoot
        backendPid = $BackendProcessId
        frontendPid = $FrontendProcessId
        status = $Status
        updatedAt = [DateTime]::UtcNow.ToString("o")
    }
    $state | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Get-LauncherStatus {
    $backendOwners = @(Get-PortOwners -Port $BackendPort)
    $frontendOwners = @(Get-PortOwners -Port $FrontendPort)
    $backendOwner = if ($backendOwners.Count -eq 1) { [int]$backendOwners[0] } else { 0 }
    $frontendOwner = if ($frontendOwners.Count -eq 1) { [int]$frontendOwners[0] } else { 0 }
    $backendOwned = $backendOwners.Count -eq 0 -or ($backendOwners.Count -eq 1 -and (Test-ManagedProcess -ProcessId $backendOwner -Role "backend"))
    $frontendOwned = $frontendOwners.Count -eq 0 -or ($frontendOwners.Count -eq 1 -and (Test-ManagedProcess -ProcessId $frontendOwner -Role "frontend"))
    $backendReady = $backendOwners.Count -eq 1 -and $backendOwned -and (Test-ControlTowerBackend)
    $frontendReady = $frontendOwners.Count -eq 1 -and $frontendOwned -and (Test-ControlTowerFrontend)
    $hasConflict = -not $backendOwned -or -not $frontendOwned -or $backendOwners.Count -gt 1 -or $frontendOwners.Count -gt 1
    $status = if ($hasConflict) {
        "conflict"
    }
    elseif ($backendReady -and $frontendReady) {
        "ready"
    }
    elseif (-not $backendReady -and -not $frontendReady) {
        "stopped"
    }
    else {
        "partial"
    }
    return [pscustomobject][ordered]@{
        service = "batch-production-control"
        status = $status
        guiUrl = $FrontendUrl
        backend = [ordered]@{ ready = $backendReady; port = $BackendPort; pid = $backendOwner; owners = $backendOwners }
        frontend = [ordered]@{ ready = $frontendReady; port = $FrontendPort; pid = $frontendOwner; owners = $frontendOwners }
    }
}

function Invoke-StartControlTower {
    if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
        throw "생산관제 Python 실행 파일이 없습니다: $PythonPath"
    }
    if (-not (Test-Path -LiteralPath $FrontendRoot -PathType Container)) {
        throw "생산관제 웹 프론트엔드 폴더가 없습니다: $FrontendRoot"
    }
    Initialize-RuntimeRoot
    Assert-PortAvailableOrOwned -Port $BackendPort -Role "backend"
    Assert-PortAvailableOrOwned -Port $FrontendPort -Role "frontend"

    $startedBackend = 0
    $startedFrontend = 0
    try {
        if (-not (Test-ControlTowerBackend)) {
            $startedBackend = Start-Backend
            Wait-ServiceReady -Role "backend"
        }
        if (-not (Test-ControlTowerFrontend)) {
            $startedFrontend = Start-Frontend
            Wait-ServiceReady -Role "frontend"
        }
        Assert-PortAvailableOrOwned -Port $BackendPort -Role "backend"
        Assert-PortAvailableOrOwned -Port $FrontendPort -Role "frontend"
    }
    catch {
        Stop-ManagedProcess -ProcessId $startedFrontend -Role "frontend"
        Stop-ManagedProcess -ProcessId $startedBackend -Role "backend"
        throw
    }

    $backendOwner = [int](@(Get-PortOwners -Port $BackendPort)[0])
    $frontendOwner = [int](@(Get-PortOwners -Port $FrontendPort)[0])
    Write-LauncherState -BackendProcessId $backendOwner -FrontendProcessId $frontendOwner -Status "ready"
    if (-not $NoBrowser) {
        Start-Process -FilePath $FrontendUrl | Out-Null
    }
    return Get-LauncherStatus
}

function Invoke-StopControlTower {
    $state = Read-LauncherState
    if ($null -ne $state -and [string]$state.repositoryRoot -eq $RepositoryRoot) {
        Stop-ManagedProcess -ProcessId ([int]$state.frontendPid) -Role "frontend"
        Stop-ManagedProcess -ProcessId ([int]$state.backendPid) -Role "backend"
    }
    Write-LauncherState -BackendProcessId 0 -FrontendProcessId 0 -Status "stopped"
    return Get-LauncherStatus
}

function Show-LauncherError {
    param([string]$Message)

    if ($NoDialog) {
        return
    }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $Message,
        "생산관제 실행 실패",
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
}

$mutex = New-Object System.Threading.Mutex($false, $MutexName)
$lockTaken = $false
try {
    try {
        $lockTaken = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
    }
    catch [System.Threading.AbandonedMutexException] {
        $lockTaken = $true
    }
    if (-not $lockTaken) {
        throw "다른 생산관제 실행 요청을 30초 동안 기다렸지만 완료되지 않았습니다."
    }

    $result = switch ($Action) {
        "Start" { Invoke-StartControlTower }
        "Open" { Invoke-StartControlTower }
        "Stop" { Invoke-StopControlTower }
        "Status" { Get-LauncherStatus }
    }
    if ($Json) {
        $result | ConvertTo-Json -Depth 4 -Compress
    }
    else {
        $result
    }
}
catch {
    $message = $_.Exception.Message
    Write-Error $message
    Show-LauncherError -Message $message
    exit 1
}
finally {
    if ($lockTaken) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
