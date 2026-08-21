const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const launcher = fs.readFileSync(path.resolve(__dirname, '../../launcher.ps1'), 'utf8');

test('launcher keeps healthy 8081 and 5050 services running', () => {
  // Given: a launcher that may be invoked while the user is actively editing a local draft.
  // When: the launcher prepares its frontend and backend services.
  // Then: healthy listeners are reused instead of being globally force-killed.
  assert.doesNotMatch(launcher, /Stop-PortListeners\s+-Ports\s+@\(8081, 5050\)/);
  assert.match(launcher, /if \(-not \$backendOk\) \{/);
  assert.match(launcher, /if \(-not \$frontOk\) \{/);
});

test('launcher foregrounds the normal detail page and keeps the live batch worker minimized', () => {
  assert.match(launcher, /\$ControlTowerBase\s*=\s*'http:\/\/127\.0\.0\.1:' \+ \$ControlTowerPort/);
  assert.match(launcher, /\[uri\]::EscapeDataString\(\$ControlTowerBase\)/);
  assert.match(launcher, /\$NormalAppUrl\s*=\s*'http:\/\/127\.0\.0\.1:8081\/app\.html'/);
  assert.match(launcher, /\$WorkerAppUrl\s*=\s*'http:\/\/127\.0\.0\.1:8081\/app\.html\?batchWorker=1&controlTowerBase=/);
  assert.match(launcher, /Start-Process -FilePath \$Chrome -ArgumentList @\('--new-window', '--start-minimized', \$WorkerAppUrl\)/);
  assert.match(launcher, /Start-Process -FilePath \$Chrome -ArgumentList @\('--new-window', \$NormalAppUrl\)/);
});

test('worker-only launch never opens the normal editor', () => {
  assert.match(launcher, /param\([\s\S]*\[switch\]\$WorkerOnly[\s\S]*\)/);
  assert.match(launcher, /if \(-not \$WorkerOnly\) \{[\s\S]*Start-Process -FilePath \$Chrome -ArgumentList @\('--new-window', \$NormalAppUrl\)/);
  assert.match(launcher, /if \(\$sachyApiOk\) \{[\s\S]*sachyosangse API \(4000\) already running/);
  assert.match(launcher, /\[string\]\$ExpectedWorkerBuildId/);
  assert.match(launcher, /\$factoryState\.expectedWorkerBuildId -eq \$ExpectedWorkerBuildId/);
  assert.match(launcher, /\$factoryState\.workerSession\.buildId -eq \$ExpectedWorkerBuildId/);
  assert.match(launcher, /if \(-not \$workerReady\) \{[\s\S]*exit 1/);
});

test('launcher starts Sinhwa Hub first and injects the encrypted service key into backend child only', () => {
  const dependencyCall = launcher.indexOf('Ensure-SinhwaHubReady');
  const backendStart = launcher.indexOf("Start-Process -FilePath 'cmd.exe' -ArgumentList ('/k ' + $backendCmd)");

  assert.match(launcher, /manage_sinhwa_servers\.ps1/);
  assert.match(launcher, /ProtectedData\]::Unprotect/);
  assert.match(launcher, /DataProtectionScope\]::CurrentUser/);
  assert.match(launcher, /\$env:SINHWA_PDP_SERVICE_KEY = \$serviceKey/);
  assert.match(launcher, /Restore-EnvironmentVariable/);
  assert.ok(dependencyCall >= 0);
  assert.ok(backendStart > dependencyCall);
  assert.doesNotMatch(launcher, /SINHWA_PDP_SERVICE_KEY=/);
  assert.doesNotMatch(launcher, /X-PDP-Control-Service-Key/);
});
