# Detail Page AI Launcher (stable v3)
# Save as UTF-8 with BOM for Windows PowerShell 5.1
$ErrorActionPreference = 'SilentlyContinue'
try { $Host.UI.RawUI.WindowTitle = 'Detail Page AI - starting' } catch {}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = $PSScriptRoot }
if (-not $Root) { $Root = (Get-Location).Path }
$Backend = Join-Path $Root 'backend'
$ControlTowerBase = 'http://127.0.0.1:5062'
$EncodedControlTowerBase = [uri]::EscapeDataString($ControlTowerBase)
$NormalAppUrl = 'http://127.0.0.1:8081/app.html'
$WorkerAppUrl = 'http://127.0.0.1:8081/app.html?batchWorker=1&controlTowerBase=' + $EncodedControlTowerBase
$SinhwaHubRoot = if ($env:SINHWA_HUB_ROOT) {
  $env:SINHWA_HUB_ROOT
} else {
  Join-Path $env:USERPROFILE 'sinhwa-db-hub'
}
$SinhwaHubManager = Join-Path $SinhwaHubRoot 'manage_sinhwa_servers.ps1'
$PdpServiceKeyPath = Join-Path $SinhwaHubRoot '.runtime\pdp-control-service-key.dpapi'

$SachyApi = $env:SACHYOSANGSE_API_DIR
if (-not $SachyApi) {
  $candidate = Join-Path $env:USERPROFILE 'Documents\Playground\sachyosangse\apps\api'
  if (Test-Path $candidate) { $SachyApi = $candidate }
}

if (Test-Path 'C:\Python314\python.exe') {
  $PythonHttp = 'C:\Python314\python.exe'
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $PythonHttp = 'python'
} else {
  $PythonHttp = 'py'
}

$ChromeCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$Chrome = $ChromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$CertFile = Join-Path $Backend 'venv311\Lib\site-packages\certifi\cacert.pem'
$Waitress = Join-Path $Backend 'venv311\Scripts\waitress-serve.exe'
$ApiHubRoot = if (Test-Path 'C:\api-hub\src\server.js') { 'C:\api-hub' } else { $env:API_HUB_ROOT }
$ApiHubServer = if ($ApiHubRoot) { Join-Path $ApiHubRoot 'src\server.js' } else { '' }
$ApiHubLaunch = if ($ApiHubRoot) { Join-Path $ApiHubRoot 'launch-api-hub.ps1' } else { '' }

Write-Host ''
Write-Host '  ======================================================'
Write-Host '       Detail Page AI  - starting...'
Write-Host '  ======================================================'
Write-Host ('  root: ' + $Root)
Write-Host ''

if (-not (Test-Path $Waitress)) {
  Write-Host ('  ERROR: waitress not found: ' + $Waitress)
  Write-Host '  Press Enter to exit...'
  try { [void][System.Console]::ReadLine() } catch {}
  exit 1
}

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    try {
      $pattern = ':' + $port + ' '
      $pids = (netstat -ano | Select-String $pattern | Where-Object { $_ -match 'LISTENING' }) | ForEach-Object {
        ($_ -split '\s+')[-1]
      } | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique
      foreach ($p in $pids) {
        if ($p -and $p -ne '0') {
          Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
      }
    } catch {}
  }
}

function Wait-HttpReady {
  param([string]$Url, [int]$MaxTries = 40, [int]$DelaySec = 1)
  for ($i = 1; $i -le $MaxTries; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
      if ($r.StatusCode -lt 500) { return $true }
    } catch {}
    Start-Sleep -Seconds $DelaySec
  }
  return $false
}

function Test-HttpReady {
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return $r.StatusCode -lt 500
  } catch {}
  return $false
}

function Restore-EnvironmentVariable {
  param([string]$Name, [bool]$WasPresent, [string]$Value)
  if ($WasPresent) {
    [Environment]::SetEnvironmentVariable(
      $Name,
      $Value,
      [EnvironmentVariableTarget]::Process
    )
  } else {
    [Environment]::SetEnvironmentVariable(
      $Name,
      $null,
      [EnvironmentVariableTarget]::Process
    )
  }
}

function Get-PdpControlServiceKey {
  if ($env:PDP_CONTROL_SERVICE_KEY) {
    return $env:PDP_CONTROL_SERVICE_KEY
  }
  if (-not (Test-Path -LiteralPath $PdpServiceKeyPath -PathType Leaf)) {
    return ''
  }
  Add-Type -AssemblyName System.Security
  $protectedBytes = $null
  $plainBytes = $null
  $decodedBytes = $null
  try {
    $protectedBytes = [System.IO.File]::ReadAllBytes($PdpServiceKeyPath)
    if ($protectedBytes.Length -eq 0) { return '' }
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $serviceKey = ([System.Text.UTF8Encoding]::new($false)).GetString($plainBytes)
    $decodedBytes = [Convert]::FromBase64String($serviceKey)
    if ($decodedBytes.Length -lt 32) { return '' }
    return $serviceKey
  } catch {
    return ''
  } finally {
    if ($null -ne $plainBytes) {
      [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    if ($null -ne $decodedBytes) {
      [Array]::Clear($decodedBytes, 0, $decodedBytes.Length)
    }
  }
}

function Test-SinhwaHubReady {
  try {
    $api = Invoke-WebRequest -Uri 'http://127.0.0.1:8200/openapi.json' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    $ui = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    return $api.StatusCode -eq 200 -and
      $api.Content.Contains('"/api/pdp-assets/v1/work-bundles"') -and
      $ui.StatusCode -eq 200
  } catch {}
  return $false
}

function Ensure-SinhwaHubReady {
  if (Test-SinhwaHubReady) { return $true }
  if (-not (Test-Path -LiteralPath $SinhwaHubManager -PathType Leaf)) {
    return $false
  }
  try {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $SinhwaHubManager +
      '" -Action Start -BackendPort 8200 -FrontendPort 5173 -SqlContainerName disabled'
    $managerProcess = Start-Process -FilePath 'powershell.exe' `
      -ArgumentList $arguments `
      -WindowStyle Hidden `
      -PassThru
    $managerProcess.WaitForExit()
    return $managerProcess.ExitCode -eq 0 -and (Test-SinhwaHubReady)
  } catch {}
  return $false
}

function Test-SinhwaBridgeConfigured {
  try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:5050/api/sinhwa-pdp/status' -TimeoutSec 2 -ErrorAction Stop
    $activity = Invoke-WebRequest `
      -Uri 'http://127.0.0.1:5050/api/sinhwa-pdp/work-bundles/activity' `
      -Method Options `
      -TimeoutSec 2 `
      -UseBasicParsing `
      -ErrorAction Stop
    $allowedMethods = [string]$activity.Headers['Allow']
    return $status.configured -eq $true -and
      $status.serviceKeyExposed -eq $false -and
      (($allowedMethods -split ',').Trim() -contains 'POST')
  } catch {}
  return $false
}

if ($SachyApi -and (Test-Path $SachyApi)) {
  Stop-PortListeners -Ports @(4000)
}

$sinhwaHubOk = Ensure-SinhwaHubReady
$backendOk = Test-HttpReady -Url 'http://127.0.0.1:5050/api/sections'
$frontOk = Test-HttpReady -Url 'http://127.0.0.1:8081/app.html'
if ($backendOk -and -not (Test-SinhwaBridgeConfigured)) {
  Stop-PortListeners -Ports @(5050)
  $backendOk = $false
}

# [0] API Hub (4321) - required for GPT OAuth / Cafe24 Control / connectors
$hubAlready = $false
try {
  $hubProbe = Invoke-WebRequest -Uri 'http://127.0.0.1:4321/api/status' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
  if ($hubProbe.StatusCode -lt 500) { $hubAlready = $true }
} catch {}
if ($hubAlready) {
  Write-Host '  [0/4] API Hub (4321) already running'
} elseif ($ApiHubServer -and (Test-Path $ApiHubServer)) {
  Write-Host '  [0/4] API Hub (4321) starting...'
  try {
    if ($ApiHubLaunch -and (Test-Path $ApiHubLaunch)) {
      Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$ApiHubLaunch) -WorkingDirectory $ApiHubRoot -WindowStyle Minimized
    } else {
      Start-Process -FilePath 'node.exe' -ArgumentList @('"' + $ApiHubServer + '"') -WorkingDirectory $ApiHubRoot -WindowStyle Minimized
    }
  } catch {
    Write-Host ('  [0/4] API Hub start failed: ' + $_)
  }
} else {
  Write-Host '  [0/4] API Hub path missing (C:\api-hub) - GPT OAuth may show Failed to fetch'
}

if ($SachyApi -and (Test-Path $SachyApi)) {
  Write-Host '  [1/4] sachyosangse API (4000)...'
  $apiArgs = '/k cd /d "' + $SachyApi + '" && pnpm dev'
  Start-Process -FilePath 'cmd.exe' -ArgumentList $apiArgs -WindowStyle Minimized
} else {
  Write-Host '  [1/4] sachyosangse API path missing - skip'
}

if ($backendOk) {
  Write-Host '  [2/4] Backend (5050) already running'
} else {
  Write-Host '  [2/4] Backend (5050, threads=16) starting...'
  $backendCmd = 'cd /d "' + $Backend + '" && set SSL_CERT_FILE=' + $CertFile + ' && "' + $Waitress + '" --call --listen=127.0.0.1:5050 --threads=16 app:create_app'
  $serviceKey = Get-PdpControlServiceKey
  $serviceKeyWasPresent = Test-Path -LiteralPath 'Env:SINHWA_PDP_SERVICE_KEY'
  $originalServiceKey = [Environment]::GetEnvironmentVariable(
    'SINHWA_PDP_SERVICE_KEY',
    [EnvironmentVariableTarget]::Process
  )
  try {
    if ($serviceKey) {
      $env:SINHWA_PDP_SERVICE_KEY = $serviceKey
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList ('/k ' + $backendCmd) -WindowStyle Minimized
  } finally {
    Restore-EnvironmentVariable -Name 'SINHWA_PDP_SERVICE_KEY' -WasPresent $serviceKeyWasPresent -Value $originalServiceKey
    $serviceKey = $null
  }
}

if ($frontOk) {
  Write-Host '  [3/4] Frontend (8081) already running'
} else {
  Write-Host '  [3/4] Frontend (8081) starting...'
  Start-Process -FilePath $PythonHttp -ArgumentList @('-m', 'http.server', '8081', '--directory', $Root) -WindowStyle Minimized
}

Write-Host ''
Write-Host '  Waiting for servers (health check)...'
$hubOk = Wait-HttpReady -Url 'http://127.0.0.1:4321/api/status' -MaxTries 30 -DelaySec 1
if (-not $backendOk) {
  $backendOk = Wait-HttpReady -Url 'http://127.0.0.1:5050/api/sections' -MaxTries 45 -DelaySec 1
}
if (-not $frontOk) {
  $frontOk = Wait-HttpReady -Url 'http://127.0.0.1:8081/app.html' -MaxTries 20 -DelaySec 1
}

if ($hubOk) { Write-Host '  API Hub ready (GPT OAuth)' } else { Write-Host '  API Hub slow/missing - GPT OAuth login may fail until C:\api-hub is running' }
if ($sinhwaHubOk) { Write-Host '  Sinhwa asset hub ready' } else { Write-Host '  Sinhwa asset hub unavailable - local saves continue and sync will retry later' }
if ($backendOk) { Write-Host '  Backend ready' } else { Write-Host '  Backend slow - opening browser anyway' }
if ($frontOk) { Write-Host '  Frontend ready' } else { Write-Host '  Frontend slow' }

Write-Host '  Opening background worker and normal editor...'
if ($Chrome) {
  Start-Process -FilePath $Chrome -ArgumentList @('--new-window', '--start-minimized', $WorkerAppUrl)
  Start-Sleep -Milliseconds 300
  Start-Process -FilePath $Chrome -ArgumentList @('--new-window', $NormalAppUrl)
} else {
  Start-Process $WorkerAppUrl
  Start-Process $NormalAppUrl
}

Write-Host ''
Write-Host '  Done. Servers keep running in background.'
Write-Host ''
Start-Sleep -Seconds 2
