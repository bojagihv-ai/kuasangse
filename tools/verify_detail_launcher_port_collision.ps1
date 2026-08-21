[CmdletBinding()]
param(
    [string]$LauncherPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($LauncherPath)) {
    $LauncherPath = Join-Path (Split-Path -Parent $PSScriptRoot) "launcher.ps1"
}

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }
}

if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
    throw "launcher not found: $LauncherPath"
}

$port = Get-FreeLoopbackPort
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$tempRoot = Join-Path $env:TEMP ("kuasangse-launcher-collision-" + [guid]::NewGuid().ToString("N"))
$launcherJob = $null

try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $listener.Start()
    $request = $listener.BeginGetContext($null, $null)
    $launcherJob = Start-Job -ScriptBlock {
        param($Path, $Port)
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Path -WorkerOnly -BackendPort $Port
        [pscustomobject]@{ exitCode = $LASTEXITCODE }
    } -ArgumentList $LauncherPath, $port

    if (-not $request.AsyncWaitHandle.WaitOne(10000)) {
        throw "launcher never requested the occupied-port endpoint"
    }
    $context = $listener.EndGetContext($request)
    try {
        $context.Response.StatusCode = 404
        $context.Response.ContentLength64 = 0
    }
    finally {
        $context.Response.Close()
    }

    if (-not ($launcherJob | Wait-Job -Timeout 10)) {
        throw "launcher did not fail closed within 10 seconds"
    }
    $records = @($launcherJob | Receive-Job -Keep 2>&1)
    $exitRecord = @($records | Where-Object { $_.PSObject.Properties.Match("exitCode").Count -gt 0 })[-1]
    $output = ($records | Where-Object { $_.PSObject.Properties.Match("exitCode").Count -eq 0 } | Out-String)
    if ($null -eq $exitRecord -or [int]$exitRecord.exitCode -ne 1) {
        throw "expected launcher exit code 1, got $($exitRecord.exitCode): $output"
    }
    if ($output -notmatch "occupied but is not a ready Detail Page AI backend") {
        throw "launcher did not report the occupied-port rejection: $output"
    }
    if (-not $listener.IsListening) {
        throw "launcher stopped the test-owned occupied-port listener"
    }

    [pscustomobject]@{
        ok = $true
        port = $port
        launcherExitCode = [int]$exitRecord.exitCode
        listenerStillRunning = $listener.IsListening
    } | ConvertTo-Json -Compress
}
finally {
    if ($null -ne $launcherJob) {
        if ($launcherJob.State -eq "Running") {
            Stop-Job -Job $launcherJob
        }
        Remove-Job -Job $launcherJob -Force
    }
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
