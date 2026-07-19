# One-shot import: all PDP Factory workflows into local n8n (한 번만 실행)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File "...\import-all-workflows.ps1" -RestartN8n
#
# CLI needs SQLite unlocked → 이 스크립트가 5678 리스너를 멈춘 뒤 import 합니다.

param(
  [switch]$RestartN8n,
  [switch]$SkipStop
)

$ErrorActionPreference = 'Stop'
$FactoryRoot = Split-Path $PSScriptRoot -Parent
$SourceDir = Join-Path $FactoryRoot 'workflows'
$BundleDir = Join-Path $FactoryRoot 'import'
$AllFile = Join-Path $BundleDir 'ALL-pdp-factory.json'
$BuildJs = Join-Path $PSScriptRoot 'build-import-bundle.js'
$N8nHost = 'http://127.0.0.1:5678'

function Write-Step([string]$msg) { Write-Host "[import] $msg" -ForegroundColor Cyan }

function Test-N8nUp {
  try {
    $null = Invoke-WebRequest -Uri $N8nHost -UseBasicParsing -TimeoutSec 2
    return $true
  } catch { return $false }
}

function Stop-N8nOnPort {
  Write-Step "Stopping listeners on port 5678 (DB unlock for CLI)..."
  $conns = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Step "Port 5678 free."
    return
  }
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      Write-Step "Stop PID $procId ($($p.ProcessName))"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
  if (Test-N8nUp) { throw "n8n still up on $N8nHost. Close it and re-run." }
  Write-Step "n8n stopped."
}

Write-Host ""
Write-Host "=== PDP Factory: import ALL workflows (once) ===" -ForegroundColor Green
Write-Host "Source: $SourceDir"
Write-Host ""

if (-not (Test-Path $SourceDir)) { throw "Missing workflows dir: $SourceDir" }
if (-not (Get-Command n8n -ErrorAction SilentlyContinue)) {
  throw "n8n CLI not found. npm i -g n8n 후 다시 실행."
}

Write-Step "Building bundle with node..."
& node $BuildJs
if ($LASTEXITCODE -ne 0) { throw "build-import-bundle.js failed" }
if (-not (Test-Path $AllFile)) { throw "Bundle missing: $AllFile" }

$count = (Get-ChildItem $SourceDir -Filter '*.json').Count

if (-not $SkipStop) {
  if (Test-N8nUp) { Stop-N8nOnPort }
  else { Write-Step "n8n not running — OK." }
}

Write-Step "CLI: n8n import:workflow --input=ALL-pdp-factory.json"
& n8n import:workflow --input=$AllFile
if ($LASTEXITCODE -ne 0) {
  Write-Step "Fallback: --separate folder import..."
  & n8n import:workflow --separate --input=$BundleDir
  if ($LASTEXITCODE -ne 0) { throw "import:workflow failed (exit $LASTEXITCODE)" }
}

Write-Step "list:workflow"
& n8n list:workflow

Write-Host ""
Write-Host "OK: $count workflows imported in ONE shot." -ForegroundColor Green
Write-Host "  File: $AllFile"
Write-Host "  UI:   $N8nHost"
Write-Host ""

if ($RestartN8n) {
  Write-Step "Restarting n8n in new window..."
  $startScript = Join-Path $PSScriptRoot 'start-n8n.ps1'
  if (Test-Path $startScript) {
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScript)
  } else {
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'n8n start')
  }
  Write-Host "Open $N8nHost in a few seconds."
} else {
  Write-Host "Start n8n:"
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-n8n.ps1`""
  Write-Host "Or re-run this script with -RestartN8n"
}
Write-Host ""
