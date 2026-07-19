[CmdletBinding()]
param(
    [string]$TemplatePath = (Join-Path ${env:ProgramFiles} 'Oracle\VirtualBox\UnattendedTemplates\win_postinstall.cmd'),
    [Parameter(Mandatory)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$resolvedTemplate = (Resolve-Path -LiteralPath $TemplatePath).Path
if (Test-Path -LiteralPath $OutputPath) {
    throw "출력 템플릿이 이미 있습니다: $OutputPath"
}

$template = Get-Content -LiteralPath $resolvedTemplate -Raw
$marker = '@@VBOX_COND_IS_INSTALLING_ADDITIONS@@'
$markerIndex = $template.IndexOf($marker, [StringComparison]::Ordinal)
if ($markerIndex -lt 0) {
    throw 'VirtualBox post-install 템플릿에서 Guest Additions 블록을 찾지 못했습니다.'
}

$seedScript = @'
Start-Sleep -Seconds 30
& '\\VBOXSVR\KuasangseBootstrap\tools\bootstrap_jepumscraper_vm_worker.ps1' -SourceArchivePath '\\VBOXSVR\KuasangseBootstrap\output\vm-rebuild\jepumscraper-source.zip' -Port 5002
'@
$encodedSeedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($seedScript))
$seedTask = @"
rem
rem Seed the VM worker only after Guest Additions can provide the shared folder.
rem This task survives the Guest Additions reboot and runs as SYSTEM without user input.
rem
schtasks.exe /create /tn "JepumScraper VM Worker Bootstrap Seed" /sc onstart /ru SYSTEM /rl HIGHEST /delay 0000:30 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedSeedScript" /f

"@

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$template.Insert($markerIndex, $seedTask) | Set-Content -LiteralPath $OutputPath -Encoding ascii -NoNewline
Write-Output "VM_POSTINSTALL_TEMPLATE_READY: $OutputPath"
