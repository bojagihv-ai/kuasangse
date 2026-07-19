[CmdletBinding()]
param([switch]$Json)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ControlTowerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $ControlTowerRoot
$LauncherPath = Join-Path $ControlTowerRoot "launch.ps1"
$IconPath = Join-Path $ControlTowerRoot "assets\production-control.ico"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "생산관제.lnk"
$PowerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

foreach ($requiredPath in ($LauncherPath, $IconPath, $PowerShellPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "바로가기 필수 파일이 없습니다: $requiredPath"
    }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $PowerShellPath
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherPath`" -Action Start"
$shortcut.WorkingDirectory = $RepositoryRoot
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Description = "제품 투입부터 검수와 출품 대기까지 관리하는 생산관제"
$shortcut.WindowStyle = 1
$shortcut.Save()

$saved = $shell.CreateShortcut($ShortcutPath)
if ($saved.TargetPath -ne $PowerShellPath -or $saved.IconLocation -ne "$IconPath,0") {
    throw "생산관제 바로가기 저장 결과가 요청한 실행기 또는 아이콘과 다릅니다."
}

$result = [pscustomobject][ordered]@{
    shortcutPath = $ShortcutPath
    targetPath = $saved.TargetPath
    arguments = $saved.Arguments
    workingDirectory = $saved.WorkingDirectory
    iconLocation = $saved.IconLocation
}
if ($Json) {
    $result | ConvertTo-Json -Depth 3 -Compress
}
else {
    $result
}
