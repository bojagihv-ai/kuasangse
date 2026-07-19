[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BridgeScript,
    [Parameter(Mandatory)][string]$BridgeRoot,
    [string]$WorkerBase = 'http://127.0.0.1:5002',
    [string]$StateRoot = 'C:\ProgramData\JepumVMWorker',
    [int]$RestartDelaySeconds = 3
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$RestartDelaySeconds = [Math]::Max(1, $RestartDelaySeconds)
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$logPath = Join-Path $StateRoot 'candidate-bridge-supervisor.log'

function Write-SupervisorLog {
    param([string]$Message)

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}

while ($true) {
    try {
        if (-not (Test-Path -LiteralPath $BridgeScript -PathType Leaf)) {
            throw "Candidate bridge script was not found: $BridgeScript"
        }
        $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', $BridgeScript,
            '-BridgeRoot', $BridgeRoot,
            '-WorkerBase', $WorkerBase
        ) -WorkingDirectory $StateRoot -WindowStyle Hidden -PassThru
        Write-SupervisorLog "Candidate bridge started: pid=$($process.Id)"
        $process.WaitForExit()
        Write-SupervisorLog "Candidate bridge exited: pid=$($process.Id), exitCode=$($process.ExitCode). Restarting in $RestartDelaySeconds seconds."
    } catch {
        Write-SupervisorLog "Candidate bridge supervisor error: $($_.Exception.Message). Restarting in $RestartDelaySeconds seconds."
    }
    Start-Sleep -Seconds $RestartDelaySeconds
}
