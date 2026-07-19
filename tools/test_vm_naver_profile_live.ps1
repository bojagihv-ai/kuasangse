[CmdletBinding()]
param(
    [string]$Keyword = 'notebook',
    [ValidateRange(1, 10)]
    [int]$TopN = 1,
    [ValidateRange(15, 180)]
    [int]$TimeoutSeconds = 90,
    [string]$WorkerBase = 'http://127.0.0.1:5002',
    [string]$StateRoot = 'C:\ProgramData\JepumVMWorker',
    [string]$BridgeRoot = '\\VBOXSVR\KuasangseVmBridge'
)

$ErrorActionPreference = 'Stop'

function Get-SafeWorkerLogLines {
    param([string[]]$Paths)

    $routes = foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        Get-Content -LiteralPath $path -Tail 400 -ErrorAction SilentlyContinue |
            ForEach-Object {
                if ($_ -match 'VM Chrome CDP') {
                    'vm_chrome_cdp'
                } elseif ($_ -match 'Chrome profile session') {
                    'chrome_profile_playwright'
                }
            }
    }

    $routes | Where-Object { $_ } | Select-Object -Unique
}

function Invoke-DirectNaverProbe {
    param([string]$Query, [int]$Count)

    $pythonCandidates = @(
        'C:\Program Files\Python312\python.exe',
        (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $python = $pythonCandidates | Select-Object -First 1
    if (-not $python) {
        throw 'VM Python runtime was not found for the direct Naver probe.'
    }

    $env:CHROME_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
    $env:NAVER_DEBUG_PORT = '9222'
    $probe = Join-Path $PSScriptRoot 'test_vm_naver_profile_live.py'
    if (-not (Test-Path -LiteralPath $probe -PathType Leaf)) {
        throw "VM direct Naver probe is missing: $probe"
    }

    Push-Location 'C:\JepumScraper'
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $python $probe $Query $Count 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    $totalLine = $output | Where-Object { $_ -match '^VM_NAVER_LIVE_DIRECT_TOTAL=' } | Select-Object -Last 1
    $total = if ($totalLine) { [int]($totalLine -replace '^VM_NAVER_LIVE_DIRECT_TOTAL=', '') } else { 0 }
    $htmlStateLine = $output | Where-Object { $_ -match '^VM_NAVER_LIVE_HTML_STATE=' } | Select-Object -Last 1
    $htmlState = if ($htmlStateLine) { [string]($htmlStateLine -replace '^VM_NAVER_LIVE_HTML_STATE=', '') } else { '' }
    $routes = foreach ($line in $output) {
        if ($line -match 'VM Chrome CDP') {
            'vm_chrome_cdp'
        } elseif ($line -match 'Chrome profile session') {
            'chrome_profile_playwright'
        }
    }
    return [ordered]@{
        exit_code = [int]$exitCode
        total = [int]$total
        routes = @($routes | Where-Object { $_ } | Select-Object -Unique)
        error = if ($exitCode -eq 0) { '' } else { 'python_probe_failed' }
        html_state = $htmlState
    }
}

$keyCandidates = @(
    (Join-Path $StateRoot 'jepumscraper_worker_api_key.txt'),
    (Join-Path $BridgeRoot 'jepumscraper_worker_api_key.txt')
)
$keyPath = $keyCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $keyPath) {
    Write-Output 'VM_NAVER_LIVE_MODE=direct_scraper_no_api_key'
    $direct = Invoke-DirectNaverProbe -Query $Keyword -Count $TopN
    Write-Output "VM_NAVER_LIVE_RESULT status=direct exit_code=$($direct.exit_code) total=$($direct.total) error=$($direct.error)"
    if ($direct.html_state) { Write-Output "VM_NAVER_LIVE_HTML_STATE=$($direct.html_state)" }
    Write-Output 'VM_NAVER_SESSION_ROUTE_LOG_BEGIN'
    $direct.routes | ForEach-Object { Write-Output "VM_NAVER_SESSION_ROUTE=$_" }
    Write-Output 'VM_NAVER_SESSION_ROUTE_LOG_END'
    if ($direct.exit_code -ne 0 -or $direct.total -lt 1) {
        exit 2
    }
    exit 0
}

$apiKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'VM worker API key file is empty.'
}

$headers = @{ 'X-API-Key' = $apiKey }
$requestBody = @{
    keyword = $Keyword
    platforms = @('naver')
    search_runtime = 'local'
    top_n = $TopN
} | ConvertTo-Json -Depth 4 -Compress

$created = Invoke-RestMethod -Method Post -Uri "$WorkerBase/api/v1/searches" -Headers $headers -ContentType 'application/json' -Body $requestBody -TimeoutSec 30
$searchId = [string]$created.search_id
if ([string]::IsNullOrWhiteSpace($searchId)) {
    throw 'Search creation response did not include search_id.'
}

Write-Output "VM_NAVER_LIVE_SEARCH_ID=$searchId"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$status = $created
do {
    Start-Sleep -Seconds 2
    $status = Invoke-RestMethod -Method Get -Uri "$WorkerBase/api/v1/searches/$searchId" -Headers $headers -TimeoutSec 15
    Write-Output "VM_NAVER_LIVE_POLL status=$($status.status) total=$($status.total) age_seconds=$($status.age_seconds)"
} while ($status.status -in @('queued', 'running') -and (Get-Date) -lt $deadline)

$errorText = [string]$status.error
Write-Output "VM_NAVER_LIVE_RESULT status=$($status.status) total=$($status.total) error=$errorText"
Write-Output 'VM_NAVER_SESSION_ROUTE_LOG_BEGIN'
Get-SafeWorkerLogLines -Paths @(
    (Join-Path $StateRoot 'vm-worker-stdout.log'),
    (Join-Path $StateRoot 'vm-worker-stderr.log')
) | ForEach-Object { Write-Output $_ }
Write-Output 'VM_NAVER_SESSION_ROUTE_LOG_END'

if ($status.status -ne 'success' -or [int]$status.total -lt 1) {
    exit 2
}
