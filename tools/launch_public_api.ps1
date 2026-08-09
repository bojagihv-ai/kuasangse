$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $repositoryRoot "backend"
$waitress = Join-Path $backendRoot "venv311\Scripts\waitress-serve.exe"
$certificate = Join-Path $backendRoot "venv311\Lib\site-packages\certifi\cacert.pem"
$healthUrl = "http://127.0.0.1:5050/api/v1/health"

function Test-PublicApi {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

if (Test-PublicApi) {
    exit 0
}

if (-not (Test-Path -LiteralPath $waitress)) {
    throw "waitress launcher not found: $waitress"
}

if (Test-Path -LiteralPath $certificate) {
    $env:SSL_CERT_FILE = $certificate
}

Start-Process `
    -FilePath $waitress `
    -ArgumentList @("--call", "--listen=127.0.0.1:5050", "--threads=16", "app:create_app") `
    -WorkingDirectory $backendRoot `
    -WindowStyle Hidden

for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (Test-PublicApi) {
        exit 0
    }
    Start-Sleep -Seconds 1
}

throw "public API did not become ready: $healthUrl"
