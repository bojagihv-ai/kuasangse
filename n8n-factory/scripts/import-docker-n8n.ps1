# Import PDP Factory workflows into Docker n8n (n8n-docker)
# Host volume assumed: C:\n8n-data -> /home/node/.n8n
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File "...\import-docker-n8n.ps1"

param(
  [string]$ContainerName = "n8n-docker",
  [string]$HostN8nData = "C:\n8n-data"
)

$ErrorActionPreference = "Stop"
$FactoryRoot = Split-Path $PSScriptRoot -Parent
$BuildJs = Join-Path $PSScriptRoot "build-import-bundle.js"
$AllFile = Join-Path $FactoryRoot "import\ALL-pdp-factory.json"
$HostImport = Join-Path $HostN8nData "import-pdp-factory.json"
$ContainerImport = "/home/node/.n8n/import-pdp-factory.json"

function Write-Step([string]$msg) { Write-Host "[docker-import] $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "=== PDP Factory -> Docker n8n import ===" -ForegroundColor Green
Write-Host "Container: $ContainerName"
Write-Host "Host data: $HostN8nData"
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "docker not found"
}
$running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if (-not $running) {
  Write-Step "Starting container $ContainerName ..."
  docker start $ContainerName | Out-Null
  Start-Sleep -Seconds 3
}

Write-Step "Building workflow bundle..."
Push-Location $PSScriptRoot
try {
  node $BuildJs
  if ($LASTEXITCODE -ne 0) { throw "build-import-bundle.js failed" }
} finally {
  Pop-Location
}
if (-not (Test-Path $AllFile)) { throw "Missing bundle: $AllFile" }

if (-not (Test-Path $HostN8nData)) {
  Write-Step "Host data path missing, using docker cp only: $HostN8nData"
  docker cp $AllFile "${ContainerName}:/tmp/import-pdp-factory.json"
  $ContainerImport = "/tmp/import-pdp-factory.json"
} else {
  Write-Step "Copy bundle to host volume: $HostImport"
  Copy-Item -Force $AllFile $HostImport
  $ContainerImport = "/home/node/.n8n/import-pdp-factory.json"
}

Write-Step "Stop n8n container (unlock SQLite for CLI import)..."
docker stop $ContainerName | Out-Null
Start-Sleep -Seconds 2

Write-Step "CLI import via temporary container (same volume)..."
# Re-use same mounts as n8n-docker if possible
$image = docker inspect $ContainerName --format "{{.Config.Image}}"
$mounts = docker inspect $ContainerName --format "{{range .Mounts}}{{.Source}}|{{.Destination}};{{end}}"
Write-Step "Image=$image mounts=$mounts"

# Preferred: host bind C:\n8n-data
if (Test-Path $HostN8nData) {
  # Image ENTRYPOINT already is n8n — pass subcommand only (not "n8n import:...")
  docker run --rm `
    -v "${HostN8nData}:/home/node/.n8n" `
    -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false `
    $image `
    import:workflow --input=$ContainerImport
  $code = $LASTEXITCODE
} else {
  # fallback: start stopped container for one-shot import command
  docker start $ContainerName | Out-Null
  Start-Sleep -Seconds 2
  docker exec $ContainerName n8n import:workflow --input=$ContainerImport
  $code = $LASTEXITCODE
  docker stop $ContainerName | Out-Null
}

if ($code -ne 0) {
  Write-Step "import failed exit=$code — restarting container anyway"
  docker start $ContainerName | Out-Null
  throw "n8n import:workflow failed (exit $code)"
}

Write-Step "Start n8n container..."
docker start $ContainerName | Out-Null
Start-Sleep -Seconds 4

Write-Step "List workflows (via CLI inside running container)..."
docker exec $ContainerName n8n list:workflow 2>&1 | Out-String | Write-Host

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:5678/" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $ok = $true; break }
  } catch {
    Start-Sleep -Seconds 1
  }
}

if ($ok) {
  Write-Host ""
  Write-Host "OK: n8n is up at http://127.0.0.1:5678" -ForegroundColor Green
  Write-Host "Imported workflows (stable ids): pdp-00-master-orchestrator ... pdp-09-..."
  Write-Host "Open UI and confirm inactive PDP Factory workflows."
} else {
  Write-Host "WARN: container started but UI not yet responding. Check: docker logs $ContainerName" -ForegroundColor Yellow
}
