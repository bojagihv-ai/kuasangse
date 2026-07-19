# Detail Page AI Launcher (stable v3)
# Save as UTF-8 with BOM for Windows PowerShell 5.1
$ErrorActionPreference = 'SilentlyContinue'
try { $Host.UI.RawUI.WindowTitle = 'Detail Page AI - starting' } catch {}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = $PSScriptRoot }
if (-not $Root) { $Root = (Get-Location).Path }
$Backend = Join-Path $Root 'backend'

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

Stop-PortListeners -Ports @(8081, 5050)
if ($SachyApi -and (Test-Path $SachyApi)) {
  Stop-PortListeners -Ports @(4000)
}
Start-Sleep -Seconds 1

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

Write-Host '  [2/4] Backend (5050, threads=16)...'
$backendCmd = 'cd /d "' + $Backend + '" && set SSL_CERT_FILE=' + $CertFile + ' && "' + $Waitress + '" --call --listen=127.0.0.1:5050 --threads=16 app:create_app'
Start-Process -FilePath 'cmd.exe' -ArgumentList ('/k ' + $backendCmd) -WindowStyle Minimized

Write-Host '  [3/4] Frontend (8081)...'
Start-Process -FilePath $PythonHttp -ArgumentList @('-m', 'http.server', '8081', '--directory', $Root) -WindowStyle Minimized

Write-Host ''
Write-Host '  Waiting for servers (health check)...'
$hubOk = Wait-HttpReady -Url 'http://127.0.0.1:4321/api/status' -MaxTries 30 -DelaySec 1
$backendOk = Wait-HttpReady -Url 'http://127.0.0.1:5050/api/sections' -MaxTries 45 -DelaySec 1
$frontOk = Wait-HttpReady -Url 'http://127.0.0.1:8081/app.html' -MaxTries 20 -DelaySec 1

if ($hubOk) { Write-Host '  API Hub ready (GPT OAuth)' } else { Write-Host '  API Hub slow/missing - GPT OAuth login may fail until C:\api-hub is running' }
if ($backendOk) { Write-Host '  Backend ready' } else { Write-Host '  Backend slow - opening browser anyway' }
if ($frontOk) { Write-Host '  Frontend ready' } else { Write-Host '  Frontend slow' }

Write-Host '  Opening browser...'
if ($Chrome) {
  Start-Process -FilePath $Chrome -ArgumentList @('--new-window', 'http://127.0.0.1:8081/app.html')
} else {
  Start-Process 'http://127.0.0.1:8081/app.html'
}

Write-Host ''
Write-Host '  Done. Servers keep running in background.'
Write-Host ''
Start-Sleep -Seconds 2
