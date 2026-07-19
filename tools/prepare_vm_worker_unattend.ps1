[CmdletBinding()]
param(
    [string]$TemplatePath = (Join-Path ${env:ProgramFiles} 'Oracle\VirtualBox\UnattendedTemplates\win_nt6_unattended.xml'),
    [Parameter(Mandatory)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$resolvedTemplate = (Resolve-Path -LiteralPath $TemplatePath).Path
if (Test-Path -LiteralPath $OutputPath) {
    throw "출력 템플릿이 이미 있습니다: $OutputPath"
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Copy-Item -LiteralPath $resolvedTemplate -Destination $OutputPath
Write-Output "VM_UNATTEND_TEMPLATE_READY: $OutputPath"
