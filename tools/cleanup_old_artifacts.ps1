# 상세페이지 AI - 오래된 생성물/백업 정리 (디스크 경량화)
# 사용: powershell -ExecutionPolicy Bypass -File tools\cleanup_old_artifacts.ps1
# 기본: generated 30일 초과 삭제, last-work 백업 14일 초과 삭제, output/recovery 60일 초과 삭제

param(
  [int]$GeneratedDays = 30,
  [int]$LastWorkBackupDays = 14,
  [int]$RecoveryDays = 60,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Generated = Join-Path $Root "backend\static\generated"
$Local = Join-Path $Root "backend\.local"
$Recovery = Join-Path $Root "output\recovery"

function Remove-OlderThan($Path, $Days, $Filter = '*') {
  if (-not (Test-Path $Path)) {
    Write-Host "skip (missing): $Path"
    return [pscustomobject]@{ Count = 0; MB = 0 }
  }
  $cutoff = (Get-Date).AddDays(-$Days)
  $files = Get-ChildItem -Path $Path -Recurse -File -Filter $Filter -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff }
  $sum = ($files | Measure-Object Length -Sum).Sum
  $mb = if ($sum) { [math]::Round($sum / 1MB, 1) } else { 0 }
  if ($WhatIf) {
    Write-Host "WHATIF would remove $($files.Count) files ($mb MB) from $Path older than $Days days"
  } else {
    $files | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "removed $($files.Count) files ($mb MB) from $Path older than $Days days"
  }
  return [pscustomobject]@{ Count = $files.Count; MB = $mb }
}

Write-Host "=== kuasangse artifact cleanup ==="
Write-Host "root: $Root"
Write-Host ""

$r1 = Remove-OlderThan $Generated $GeneratedDays
# keep current last-work.json; only backups
$r2 = Remove-OlderThan $Local $LastWorkBackupDays "pdp-last-work*.json"
# never delete the live file if matched somehow
$live = Join-Path $Local "pdp-last-work.json"
if ((Test-Path $live) -and -not $WhatIf) {
  # no-op: live file is current
}
$r3 = Remove-OlderThan $Recovery $RecoveryDays

Write-Host ""
Write-Host "done. generated=$($r1.Count), lastwork_backups=$($r2.Count), recovery=$($r3.Count)"
if ($WhatIf) { Write-Host "(WhatIf mode — nothing deleted)" }
