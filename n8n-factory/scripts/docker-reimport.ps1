$ErrorActionPreference = 'Continue'
$dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (Test-Path $dd) {
  Write-Host 'Starting Docker Desktop...'
  Start-Process $dd
}

$ready = $false
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Seconds 3
  docker info 1>$null 2>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Write-Host ("wait docker... {0}" -f $i)
}
if (-not $ready) { throw 'Docker engine not ready' }
Write-Host 'Docker ready'

$FactoryRoot = Split-Path $PSScriptRoot -Parent
Push-Location $PSScriptRoot
if (Test-Path .\build-goal-unattended-workflow.js) {
  node .\build-goal-unattended-workflow.js
  if ($LASTEXITCODE -ne 0) { throw 'goal workflow build failed' }
}
node .\build-import-bundle.js
if ($LASTEXITCODE -ne 0) { throw 'bundle failed' }
Pop-Location

Copy-Item -Force (Join-Path $FactoryRoot 'import\ALL-pdp-factory.json') 'C:\n8n-data\import-pdp-factory.json'

docker start n8n-docker 2>$null
Start-Sleep -Seconds 2
docker stop n8n-docker
Start-Sleep -Seconds 2

docker run --rm `
  -v 'C:\n8n-data:/home/node/.n8n' `
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false `
  n8nio/n8n `
  import:workflow --input=/home/node/.n8n/import-pdp-factory.json

if ($LASTEXITCODE -ne 0) { throw 'import failed' }

docker start n8n-docker
Start-Sleep -Seconds 5
docker ps --filter 'name=n8n-docker'
Write-Host 'DONE'
