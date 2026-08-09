$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'backend\venv311\Scripts\python.exe'
$env:PYTHONPATH = Join-Path $root 'backend'
$env:KUASANGSE_REPORT_SOURCE = [Environment]::GetFolderPath('MyDocuments')
$reportFolderName = -join @(
  [char]0xC0C1, [char]0xC138, [char]0xD398, [char]0xC774, [char]0xC9C0,
  ' ', [char]0xC791, [char]0xC5C5, ' ',
  [char]0xB9AC, [char]0xD3EC, [char]0xD2B8
)
$env:KUASANGSE_REPORT_OUTPUT = Join-Path $env:KUASANGSE_REPORT_SOURCE $reportFolderName
$env:KUASANGSE_REPORT_RECEIPTS = Join-Path $root 'output\workfile-reports\publication-receipts.json'

& $python -m services.workfile_report_output
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Start-Process explorer.exe -ArgumentList $env:KUASANGSE_REPORT_OUTPUT
