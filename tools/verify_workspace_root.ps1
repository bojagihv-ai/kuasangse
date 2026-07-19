[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath('C:\Users\kua\Documents\GitHub\kuasangse')
$actual = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1).Trim()

if ([string]::IsNullOrWhiteSpace($actual)) {
    throw 'Git 저장소 루트를 확인하지 못했습니다.'
}

$actual = [IO.Path]::GetFullPath($actual)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($actual, $expected)) {
    throw "잘못된 작업 루트입니다. expected=$expected actual=$actual"
}

Write-Output "WORKSPACE_OK: $actual"
