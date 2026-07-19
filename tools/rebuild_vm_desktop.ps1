[CmdletBinding()]
param(
    [string]$HostGateway = '10.0.2.2',
    [string]$Desktop = "$env:USERPROFILE\Desktop",
    [switch]$InstallChrome
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-DesktopLog {
    param([string]$Message)

    Write-Output "[VM-DESKTOP] $Message"
}

function Ensure-UrlShortcut {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Url
    )

    $path = Join-Path $Desktop "$Name.url"
    @(
        '[InternetShortcut]',
        "URL=$Url",
        'IconIndex=0'
    ) | Set-Content -LiteralPath $path -Encoding ASCII
    Write-DesktopLog "URL shortcut ready: $Name"
}

function Ensure-BrowserShortcut {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$BrowserPath
    )

    if (-not (Test-Path -LiteralPath $BrowserPath)) { return }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $Desktop "$Name.lnk"))
    $shortcut.TargetPath = $BrowserPath
    $shortcut.Arguments = $Url
    $shortcut.WorkingDirectory = Split-Path -Parent $BrowserPath
    $shortcut.IconLocation = "$BrowserPath,0"
    $shortcut.Save()
    Write-DesktopLog "Browser shortcut ready: $Name"
}

function Install-GoogleChrome {
    $chromeCandidates = @(
        'C:\Program Files\Google\Chrome\Application\chrome.exe',
        'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($chrome) { return $chrome }

    $installer = Join-Path $env:TEMP 'googlechromestandaloneenterprise64.msi'
    try {
        if (-not (Test-Path -LiteralPath $installer)) {
            Write-DesktopLog 'Downloading Google Chrome enterprise installer'
            Invoke-WebRequest -Uri 'https://dl.google.com/chrome/install/googlechromestandaloneenterprise64.msi' -OutFile $installer -UseBasicParsing
        }
        $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $installer, '/qn', '/norestart') -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -notin @(0, 3010)) {
            throw "MSI exitCode=$($process.ExitCode)"
        }
    } catch {
        Write-DesktopLog "Enterprise Chrome installer unavailable: $($_.Exception.Message)"
    }

    $chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($chrome) { return $chrome }

    $userInstaller = Join-Path $env:TEMP 'ChromeStandaloneSetup64.exe'
    if (-not (Test-Path -LiteralPath $userInstaller)) {
        Write-DesktopLog 'Downloading Google Chrome user installer'
        Invoke-WebRequest -Uri 'https://dl.google.com/chrome/install/ChromeStandaloneSetup64.exe' -OutFile $userInstaller -UseBasicParsing
    }
    $userProcess = Start-Process -FilePath $userInstaller -ArgumentList @('/silent', '/install') -Wait -PassThru -WindowStyle Hidden
    if ($userProcess.ExitCode -notin @(0, 3010)) {
        throw "Chrome user installer failed: exitCode=$($userProcess.ExitCode)"
    }
    $chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $chrome) { throw 'Chrome installation finished but chrome.exe was not found.' }
    return $chrome
}

New-Item -ItemType Directory -Force -Path $Desktop | Out-Null
$routes = @(
    @{ Name = 'API Hub'; Url = ('http://{0}:4321' -f $HostGateway) },
    @{ Name = '상세페이지 조립공장'; Url = ('http://{0}:8081/app.html' -f $HostGateway) },
    @{ Name = '경쟁사 모니터'; Url = ('http://{0}:8081/app.html' -f $HostGateway) },
    @{ Name = 'Cafe24 Control Tower'; Url = ('http://{0}:8787' -f $HostGateway) },
    @{ Name = '신화사 DB 허브'; Url = ('http://{0}:8200' -f $HostGateway) },
    @{ Name = 'JepumScraper VM 워커'; Url = 'http://127.0.0.1:5002/health' }
)

$browser = ''
if ($InstallChrome) {
    try { $browser = Install-GoogleChrome } catch { Write-DesktopLog $_.Exception.Message }
}
if (-not $browser) {
    $browser = @(
        'C:\Program Files\Google\Chrome\Application\chrome.exe',
        'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
        'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

foreach ($route in $routes) {
    Ensure-UrlShortcut -Name $route.Name -Url $route.Url
    if ($browser) { Ensure-BrowserShortcut -Name $route.Name -Url $route.Url -BrowserPath $browser }
}

Write-DesktopLog "Desktop reconstruction complete: $($routes.Count) routes"

