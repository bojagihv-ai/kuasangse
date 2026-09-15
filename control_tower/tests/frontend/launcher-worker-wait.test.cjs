const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const launcher = path.resolve(__dirname, '../../launch.ps1');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const windowsOnly = { skip: process.platform !== 'win32' };

function runWorker(t, { exitCode = 0, delaySeconds = 0, timeoutSeconds = 120 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-launch-worker-'));
  const files = Object.fromEntries(['runner', 'worker', 'helper'].map(role => [role, path.join(dir, `${role}.ps1`)]));
  const receiptPath = role => path.join(dir, `${role}.json`);
  const record = (role, processExpression) => `
$owned = ${processExpression}
@{ id = $owned.Id; startTicks = $owned.StartTime.ToUniversalTime().Ticks.ToString() } |
  ConvertTo-Json -Compress | Set-Content -LiteralPath ${quote(receiptPath(role))} -Encoding UTF8
`;
  let result;
  let receipt;
  t.diagnostic(JSON.stringify({ tempDir: dir, files: [...Object.values(files), ...Object.keys(files).map(receiptPath)] }));
  try {
    fs.writeFileSync(files.helper, 'Start-Sleep -Seconds 300\n');
    fs.writeFileSync(files.worker, `
param([switch]$WorkerOnly, [string]$ExpectedWorkerBuildId, [int]$ControlTowerPort)
$ErrorActionPreference = 'Stop'
${record('worker', '[Diagnostics.Process]::GetCurrentProcess()')}
if (-not $WorkerOnly -or $ExpectedWorkerBuildId -ne 'worker-wait-test' -or $ControlTowerPort -ne 41009) { exit 99 }
$helper = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ${quote(`"${files.helper}"`)}
) -WindowStyle Hidden -PassThru
${record('helper', '$helper')}
Start-Sleep -Seconds ${delaySeconds}
exit ${exitCode}
`);
    fs.writeFileSync(files.runner, `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
${record('runner', '[Diagnostics.Process]::GetCurrentProcess()')}
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(${quote(launcher)}, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$body = $ast.Find({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-FactoryWorkerBrowser'
}, $true)
Invoke-Expression $body.Extent.Text
$NoBrowser = $false; $BackendPort = 41009; $FrontendPort = 42011
$RepositoryRoot = ${quote(dir)}; $FactoryLauncherPath = ${quote(files.worker)}
$ExpectedWorkerBuildId = 'worker-wait-test'
try {
  Start-FactoryWorkerBrowser -TimeoutSeconds ${timeoutSeconds}
  @{ outcome = 'returned' } | ConvertTo-Json -Compress
} catch {
  @{ outcome = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
`);
    result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', files.runner], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
  } finally {
    // PID + creation time identify only this test's processes, including on RED/timeout.
    const cleanup = `
$ErrorActionPreference = 'Stop'
$observed = @()
foreach ($role in @('runner', 'worker', 'helper')) {
  $recordPath = Join-Path ${quote(dir)} ($role + '.json')
  if (-not (Test-Path -LiteralPath $recordPath)) { throw "Missing owned PID receipt: $recordPath" }
  $owned = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $process = Get-Process -Id $owned.id -ErrorAction SilentlyContinue
  $alive = $null -ne $process
  if ($alive) {
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $owned.startTicks) {
      throw "PID was reused; refusing cleanup: $($owned.id)"
    }
    $process.Kill()
    if (-not $process.WaitForExit(5000)) { throw "Owned PID did not exit: $($owned.id)" }
  }
  $observed += @{ role = $role; pid = $owned.id; aliveBeforeCleanup = $alive; gone = ($null -eq (Get-Process -Id $owned.id -ErrorAction SilentlyContinue)) }
}
$observed | ConvertTo-Json -Compress
`;
    const cleaned = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(cleanup, 'utf16le').toString('base64')], {
      encoding: 'utf8', timeout: 25000, windowsHide: true,
    });
    assert.equal(cleaned.status, 0, `Cleanup failed; retained ${dir}\n${cleaned.stderr}`);
    receipt = JSON.parse(cleaned.stdout.trim().replace(/^\uFEFF/, ''));
    assert.ok(receipt.every(row => row.gone), JSON.stringify(receipt));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('kua-launch-worker-'));
    fs.rmSync(dir, { recursive: true });
    t.diagnostic(JSON.stringify({ cleanup: receipt, tempDir: dir, removed: !fs.existsSync(dir), runnerStatus: result?.status, runnerError: result?.error?.code }));
  }
  assert.equal(result.error, undefined, `Launcher parent did not return while its helper lived: ${result.error?.code}\n${result.stderr}`);
  assert.equal(receipt.find(row => row.role === 'helper').aliveBeforeCleanup, true, 'Long-running descendant must still be alive when launcher returns');
  return { result, receipt, outcome: JSON.parse(result.stdout.trim()) };
}

test('worker launcher returns after its parent exits while the service child stays alive', windowsOnly, t => {
  const { result, receipt, outcome } = runWorker(t);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(outcome.outcome, 'returned');
  assert.equal(receipt.find(row => row.role === 'worker').aliveBeforeCleanup, false);
});

test('worker launcher preserves a nonzero parent exit as a failure with a live service child', windowsOnly, t => {
  const { result, receipt, outcome } = runWorker(t, { exitCode: 17 });
  assert.equal(result.status, 1);
  assert.equal(outcome.outcome, 'error');
  assert.match(outcome.message, /runtime build/);
  assert.equal(receipt.find(row => row.role === 'worker').aliveBeforeCleanup, false);
});

test('worker launcher reports a bounded parent timeout without stopping its services', windowsOnly, t => {
  const { result, receipt, outcome } = runWorker(t, { delaySeconds: 300, timeoutSeconds: 1 });
  const worker = receipt.find(row => row.role === 'worker');
  assert.equal(result.status, 1);
  assert.equal(outcome.outcome, 'error');
  assert.match(outcome.message, /1초.*종료.*PID=/);
  assert.ok(outcome.message.includes(`PID=${worker.pid}`));
  assert.equal(worker.aliveBeforeCleanup, true);
});
