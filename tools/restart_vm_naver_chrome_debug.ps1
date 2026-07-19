[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 9222,
    [string]$InitialUrl = 'https://search.shopping.naver.com/search/all?query=notebook&sort=rel'
)

$ErrorActionPreference = 'Stop'

$chrome = Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chrome -PathType Leaf)) {
    throw 'VM Google Chrome executable was not found.'
}

$userData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
if (-not (Test-Path -LiteralPath $userData -PathType Container)) {
    throw 'VM interactive Chrome profile directory was not found.'
}
$debugUserData = 'C:\TrainingRoom\tools\chrome-profile-naver-cdp'

Get-Process -Name chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$exitDeadline = (Get-Date).AddSeconds(12)
while ((Get-Process -Name chrome -ErrorAction SilentlyContinue) -and (Get-Date) -lt $exitDeadline) {
    Start-Sleep -Milliseconds 300
}

$debugState = Join-Path $debugUserData 'Local State'
if (-not (Test-Path -LiteralPath $debugState -PathType Leaf)) {
    $sourceState = Join-Path $userData 'Local State'
    $sourceDefault = Join-Path $userData 'Default'
    if (-not (Test-Path -LiteralPath $sourceState -PathType Leaf) -or -not (Test-Path -LiteralPath $sourceDefault -PathType Container)) {
        throw 'VM source Chrome profile is incomplete.'
    }
    New-Item -ItemType Directory -Force -Path $debugUserData | Out-Null
    Copy-Item -LiteralPath $sourceState -Destination $debugState -Force
    & robocopy $sourceDefault (Join-Path $debugUserData 'Default') /E /R:0 /W:0 /NFL /NDL /NJH /NJS /XF SingletonLock SingletonCookie SingletonSocket | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "VM Naver Chrome profile clone failed: robocopy exitCode=$LASTEXITCODE"
    }
}

$arguments = @(
    "--remote-debugging-port=$Port",
    '--remote-allow-origins=*',
    "--user-data-dir=`"$debugUserData`"",
    '--profile-directory=Default',
    $InitialUrl
)
Start-Process -FilePath $chrome -ArgumentList $arguments | Out-Null

$ready = $false
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
    try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        if ($version.webSocketDebuggerUrl) {
            $ready = $true
            break
        }
    } catch {}
    Start-Sleep -Milliseconds 500
}

Write-Output "VM_NAVER_CHROME_CDP_READY=$ready"
if (-not $ready) {
    exit 2
}
