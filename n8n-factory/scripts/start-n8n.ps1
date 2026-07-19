# Start n8n for PDP factory workflows
$ErrorActionPreference = 'Stop'
$FactoryRoot = Split-Path $PSScriptRoot -Parent
$ImportScript = Join-Path $PSScriptRoot 'import-all-workflows.ps1'

Write-Host "========================================" -ForegroundColor Green
Write-Host " PDP Factory n8n"
Write-Host "========================================" -ForegroundColor Green
Write-Host "UI:        http://localhost:5678"
Write-Host "Workflows: $FactoryRoot\workflows"
Write-Host "One-shot import (전부 한 번에):"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$ImportScript`" -RestartN8n"
Write-Host "========================================" -ForegroundColor Green
Write-Host "Starting n8n..."
n8n start
