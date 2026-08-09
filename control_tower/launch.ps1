[CmdletBinding()]
param(
    [ValidateSet("Start", "Stop", "Status", "Open")]
    [string]$Action = "Start",
    [switch]$NoBrowser,
    [switch]$NoDialog,
    [switch]$Json,
    [ValidateRange(1, 65535)]
    [int]$BackendPort = 5062,
    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 8082,
    [string]$PdpServiceKeyPath = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "sinhwa-db-hub\.runtime\pdp-control-service-key.dpapi"),
    [string]$RuntimeRootOverride = "",
    [string]$FrontendRootOverride = "",
    [string]$CacheRootOverride = "",
    [string]$PdpControlBaseUrl = "",
    [string]$PdpAssetsBaseUrl = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ControlTowerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $ControlTowerRoot
$DefaultPdpControlBaseUrl = "http://127.0.0.1:8200/api/pdp-control/v1"
$DefaultPdpAssetsBaseUrl = "http://127.0.0.1:8200/api/pdp-assets/v1"
$SinhwaHubRoot = if (-not [string]::IsNullOrWhiteSpace($env:SINHWA_HUB_ROOT)) {
    $env:SINHWA_HUB_ROOT
}
else {
    Join-Path ([Environment]::GetFolderPath("UserProfile")) "sinhwa-db-hub"
}
$SinhwaHubManagerPath = Join-Path $SinhwaHubRoot "manage_sinhwa_servers.ps1"
$SinhwaHubOpenApiUrl = "http://127.0.0.1:8200/openapi.json"
$SinhwaHubFrontendUrl = "http://127.0.0.1:5173/"
$BackendHealthUrl = "http://127.0.0.1:$BackendPort/api/health"
$BackendJobsUrl = "http://127.0.0.1:$BackendPort/api/jobs"
$BackendReviewsUrl = "http://127.0.0.1:$BackendPort/api/reviews"
$FrontendUrl = "http://127.0.0.1:$FrontendPort/control-tower.html"
$FrontendReadyMarker = if ($BackendPort -eq 5062) {
    'const healthUrl = "http://127.0.0.1:5062/api/health";'
}
else {
    "const healthUrl = `"http://127.0.0.1:$BackendPort/api/health`";"
}
$FrontendRoot = if ([string]::IsNullOrWhiteSpace($FrontendRootOverride)) {
    Join-Path $ControlTowerRoot "frontend"
}
else {
    $FrontendRootOverride
}
$PythonPath = Join-Path $RepositoryRoot "backend\venv311\Scripts\python.exe"
$RuntimeRoot = if ([string]::IsNullOrWhiteSpace($RuntimeRootOverride)) {
    Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "KuaSangse\ProductionControl"
}
else {
    $RuntimeRootOverride
}
$StatePath = Join-Path $RuntimeRoot "launcher-state.json"
$MutexName = if ($BackendPort -eq 5062 -and $FrontendPort -eq 8082) {
    "Local\KuaSangseProductionControlLauncher"
}
else {
    "Local\KuaSangseProductionControlLauncher-$BackendPort-$FrontendPort"
}

function Initialize-RuntimeRoot {
    if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    }
}

function Restore-EnvironmentVariable {
    param(
        [string]$Name,
        [bool]$WasPresent,
        [string]$Value
    )

    if ($WasPresent) {
        [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::Process)
    }
    else {
        [Environment]::SetEnvironmentVariable($Name, $null, [EnvironmentVariableTarget]::Process)
    }
}

function Get-PdpControlServiceKey {
    if (-not [string]::IsNullOrWhiteSpace($env:PDP_CONTROL_SERVICE_KEY)) {
        return $env:PDP_CONTROL_SERVICE_KEY
    }
    if (-not (Test-Path -LiteralPath $PdpServiceKeyPath -PathType Leaf)) {
        throw "암호화된 신화사 서비스 키 파일이 없어 생산관제 백엔드를 시작하지 않았습니다."
    }

    Add-Type -AssemblyName System.Security
    $protectedBytes = $null
    $plainBytes = $null
    $decodedBytes = $null
    try {
        $protectedBytes = [System.IO.File]::ReadAllBytes($PdpServiceKeyPath)
        if ($protectedBytes.Length -eq 0) {
            throw "empty protected payload"
        }
        $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $protectedBytes,
            $null,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $serviceKey = ([System.Text.UTF8Encoding]::new($false)).GetString($plainBytes)
        $decodedBytes = [Convert]::FromBase64String($serviceKey)
        if ($decodedBytes.Length -lt 32) {
            throw "protected key is too short"
        }
        return $serviceKey
    }
    catch {
        throw "암호화된 신화사 서비스 키 파일이 비었거나 손상됐거나 현재 Windows 사용자로 복호화할 수 없어 생산관제 백엔드를 시작하지 않았습니다."
    }
    finally {
        if ($null -ne $plainBytes) {
            [Array]::Clear($plainBytes, 0, $plainBytes.Length)
        }
        if ($null -ne $decodedBytes) {
            [Array]::Clear($decodedBytes, 0, $decodedBytes.Length)
        }
    }
}

function Get-PortOwners {
    param([int]$Port)

    $owners = New-Object "System.Collections.Generic.HashSet[int]"
    $pattern = "^\s*TCP\s+127\.0\.0\.1:$Port\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$"
    foreach ($line in @(netstat.exe -ano -p TCP)) {
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
        if ($health.service -ne "batch-production-control" -or $health.status -ne "ready") {
            return $false
        }
        $jobs = Invoke-WebRequest -Uri $BackendJobsUrl -Method Get -UseBasicParsing -TimeoutSec 4
        $reviews = Invoke-WebRequest -Uri $BackendReviewsUrl -Method Get -UseBasicParsing -TimeoutSec 4
        return $jobs.StatusCode -eq 200 -and $reviews.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Test-SinhwaHubReady {
    try {
        $openApi = Invoke-WebRequest -Uri $SinhwaHubOpenApiUrl -Method Get -UseBasicParsing -TimeoutSec 3
        $frontend = Invoke-WebRequest -Uri $SinhwaHubFrontendUrl -Method Get -UseBasicParsing -TimeoutSec 3
        return (
            $openApi.StatusCode -eq 200 -and
            $openApi.Content.Contains('"/api/pdp-control/v1/jobs"') -and
            $frontend.StatusCode -eq 200
        )
    }
    catch {
        return $false
    }
}

function Ensure-SinhwaHubReady {
    $effectiveControlUrl = if ([string]::IsNullOrWhiteSpace($PdpControlBaseUrl)) {
        $DefaultPdpControlBaseUrl
    }
    else {
        $PdpControlBaseUrl.TrimEnd("/")
    }
    $effectiveAssetsUrl = if ([string]::IsNullOrWhiteSpace($PdpAssetsBaseUrl)) {
        $DefaultPdpAssetsBaseUrl
    }
    else {
        $PdpAssetsBaseUrl.TrimEnd("/")
    }
    if (
        $effectiveControlUrl -ne $DefaultPdpControlBaseUrl -or
        $effectiveAssetsUrl -ne $DefaultPdpAssetsBaseUrl
    ) {
        return
    }
    if (Test-SinhwaHubReady) {
        return
    }
    if (-not (Test-Path -LiteralPath $SinhwaHubManagerPath -PathType Leaf)) {
        throw "신화사 DB 실행 관리 파일이 없어 생산관제를 시작하지 않았습니다: $SinhwaHubManagerPath"
    }

    $managerArguments = (
        "-NoProfile -ExecutionPolicy Bypass -File `"$SinhwaHubManagerPath`" " +
        "-Action Start -BackendPort 8200 -FrontendPort 5173 -SqlContainerName disabled"
    )
    $managerProcess = Start-Process -FilePath "powershell.exe" `
        -ArgumentList $managerArguments `
        -WindowStyle Hidden `
        -PassThru
    $managerProcess.WaitForExit()
    if ($managerProcess.ExitCode -ne 0 -or -not (Test-SinhwaHubReady)) {
        throw "신화사 DB Hub를 자동으로 시작하지 못해 생산관제를 시작하지 않았습니다."
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

function Get-ManagedProcessRoot {
    param(
        [int]$ProcessId,
        [ValidateSet("backend", "frontend")]
        [string]$Role
    )

    if ($ProcessId -le 0) {
        return 0
    }
    $rows = @(Get-CimInstance -ClassName Win32_Process)
    $process = $rows | Where-Object { [int]$_.ProcessId -eq $ProcessId }
    if ($null -eq $process -or [string]::IsNullOrWhiteSpace([string]$process.CommandLine)) {
        return 0
    }
    $commandLine = [string]$process.CommandLine
    $matchesRole = if ($Role -eq "backend") {
        $commandLine.IndexOf("control_tower.backend.app", [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    else {
        $commandLine.IndexOf("http.server", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf([string]$FrontendPort, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if (-not $matchesRole) {
        return 0
    }

    $visited = New-Object "System.Collections.Generic.HashSet[int]"
    while ($null -ne $process -and $visited.Add([int]$process.ProcessId)) {
        $commandLine = [string]$process.CommandLine
        $ownsRepository = $commandLine.IndexOf($RepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
        $ownsRole = if ($Role -eq "backend") {
            $commandLine.IndexOf("control_tower.backend.app", [StringComparison]::OrdinalIgnoreCase) -ge 0
        }
        else {
            $commandLine.IndexOf("http.server", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $commandLine.IndexOf([string]$FrontendPort, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $commandLine.IndexOf($FrontendRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
        }
        if ($ownsRepository -and $ownsRole) {
            return [int]$process.ProcessId
        }
        $parentId = [int]$process.ParentProcessId
        $process = $rows | Where-Object { [int]$_.ProcessId -eq $parentId }
    }
    return 0
}

function Test-ManagedProcess {
    param(
        [int]$ProcessId,
        [ValidateSet("backend", "frontend")]
        [string]$Role
    )

    return (Get-ManagedProcessRoot -ProcessId $ProcessId -Role $Role) -gt 0
}

function Stop-ManagedProcessFamily {
    param(
        [int]$ProcessId,
        [ValidateSet("backend", "frontend")]
        [string]$Role
    )

    $familyRoot = Get-ManagedProcessRoot -ProcessId $ProcessId -Role $Role
    if ($familyRoot -le 0) {
        throw "생산관제 $Role 프로세스 소유권을 확인할 수 없어 종료하지 않았습니다. PID=$ProcessId"
    }
    $rows = @(Get-CimInstance -ClassName Win32_Process)
    $family = New-Object "System.Collections.Generic.List[int]"
    [void]$family.Add($familyRoot)
    for ($index = 0; $index -lt $family.Count; $index++) {
        $parentId = $family[$index]
        foreach ($child in @($rows | Where-Object { [int]$_.ParentProcessId -eq $parentId })) {
            $childId = [int]$child.ProcessId
            if (-not $family.Contains($childId)) {
                [void]$family.Add($childId)
            }
        }
    }
    for ($index = $family.Count - 1; $index -ge 0; $index--) {
        Stop-Process -Id $family[$index] -Force -ErrorAction SilentlyContinue
    }
}

function Wait-PortAvailable {
    param(
        [int]$Port,
        [int]$TimeoutSeconds = 10
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@(Get-PortOwners -Port $Port).Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw "생산관제 포트 $Port listener가 ${TimeoutSeconds}초 안에 종료되지 않았습니다."
}

function Prepare-BackendPort {
    $owners = @(Get-PortOwners -Port $BackendPort)
    if ($owners.Count -eq 0) {
        return
    }
    $managedRoots = New-Object "System.Collections.Generic.HashSet[int]"
    foreach ($owner in $owners) {
        $root = Get-ManagedProcessRoot -ProcessId $owner -Role "backend"
        if ($root -le 0) {
            throw "생산관제 backend 포트 $BackendPort 포트를 다른 프로그램이 사용 중입니다. 해당 프로그램은 종료하지 않았습니다. PIDs=$($owners -join ',')"
        }
        [void]$managedRoots.Add($root)
    }
    if ($owners.Count -eq 1 -and (Test-ControlTowerBackend)) {
        return
    }
    foreach ($root in @($managedRoots | Sort-Object)) {
        Stop-ManagedProcessFamily -ProcessId $root -Role "backend"
    }
    Wait-PortAvailable -Port $BackendPort
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
    $serviceKey = Get-PdpControlServiceKey
    $environmentNames = @(
        "PDP_CONTROL_SERVICE_KEY",
        "CONTROL_TOWER_BACKEND_PORT",
        "CONTROL_TOWER_FRONTEND_PORT",
        "CONTROL_TOWER_CORS_ORIGINS",
        "CONTROL_TOWER_CACHE_ROOT",
        "PDP_CONTROL_BASE_URL",
        "PDP_ASSETS_BASE_URL"
    )
    $wasPresent = @{}
    $originalValues = @{}
    foreach ($name in $environmentNames) {
        $wasPresent[$name] = Test-Path -LiteralPath "Env:$name"
        $originalValues[$name] = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
    }
    try {
        $env:PDP_CONTROL_SERVICE_KEY = $serviceKey
        $env:CONTROL_TOWER_BACKEND_PORT = [string]$BackendPort
        $env:CONTROL_TOWER_FRONTEND_PORT = [string]$FrontendPort
        $env:CONTROL_TOWER_CORS_ORIGINS = "http://127.0.0.1:$FrontendPort,http://127.0.0.1:8081"
        if (-not [string]::IsNullOrWhiteSpace($CacheRootOverride)) {
            $env:CONTROL_TOWER_CACHE_ROOT = $CacheRootOverride
        }
        if (-not [string]::IsNullOrWhiteSpace($PdpControlBaseUrl)) {
            $env:PDP_CONTROL_BASE_URL = $PdpControlBaseUrl
        }
        if (-not [string]::IsNullOrWhiteSpace($PdpAssetsBaseUrl)) {
            $env:PDP_ASSETS_BASE_URL = $PdpAssetsBaseUrl
        }
        $process = Start-Process -FilePath $PythonPath `
            -ArgumentList $arguments `
            -WorkingDirectory $RepositoryRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -PassThru
    }
    finally {
        foreach ($name in $environmentNames) {
            Restore-EnvironmentVariable -Name $name -WasPresent ([bool]$wasPresent[$name]) -Value ([string]$originalValues[$name])
        }
        $serviceKey = $null
    }
    return [int]$process.Id
}

function Start-Frontend {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $stdoutPath = Join-Path $RuntimeRoot "frontend-$stamp.stdout.log"
    $stderrPath = Join-Path $RuntimeRoot "frontend-$stamp.stderr.log"
    $arguments = "-m http.server $FrontendPort --bind 127.0.0.1 --directory `"$FrontendRoot`""
    $serviceKeyWasPresent = Test-Path -LiteralPath "Env:PDP_CONTROL_SERVICE_KEY"
    $originalServiceKey = [Environment]::GetEnvironmentVariable("PDP_CONTROL_SERVICE_KEY", [EnvironmentVariableTarget]::Process)
    try {
        Remove-Item -LiteralPath "Env:PDP_CONTROL_SERVICE_KEY" -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath $PythonPath `
            -ArgumentList $arguments `
            -WorkingDirectory $RepositoryRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -PassThru
    }
    finally {
        Restore-EnvironmentVariable -Name "PDP_CONTROL_SERVICE_KEY" -WasPresent $serviceKeyWasPresent -Value $originalServiceKey
    }
    return [int]$process.Id
}

function Start-ControlTowerBrowser {
    $serviceKeyWasPresent = Test-Path -LiteralPath "Env:PDP_CONTROL_SERVICE_KEY"
    $originalServiceKey = [Environment]::GetEnvironmentVariable("PDP_CONTROL_SERVICE_KEY", [EnvironmentVariableTarget]::Process)
    try {
        Remove-Item -LiteralPath "Env:PDP_CONTROL_SERVICE_KEY" -ErrorAction SilentlyContinue
        & (Join-Path $env:WINDIR "explorer.exe") $FrontendUrl | Out-Null
    }
    finally {
        Restore-EnvironmentVariable -Name "PDP_CONTROL_SERVICE_KEY" -WasPresent $serviceKeyWasPresent -Value $originalServiceKey
    }
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
    Ensure-SinhwaHubReady
    Prepare-BackendPort
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
        Start-ControlTowerBrowser
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
