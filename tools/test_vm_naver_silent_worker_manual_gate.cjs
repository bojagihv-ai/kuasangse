const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'tools', 'vm_candidate_file_bridge.ps1'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'tools', 'bootstrap_jepumscraper_vm_worker.ps1'), 'utf8');

// Given a Naver detail job whose worker terminates with a blank error,
// When the guest bridge handles the terminal response,
// Then it must preserve the job as an actionable manual gate instead of an empty error.
assert.match(bridge, /silentNaverManualRequired/);
assert.match(bridge, /naver_manual_verification_suspected/);
assert.match(bridge, /네이버 영수증문제입니다/);
assert.match(bridge, /status\s*=\s*'manual_required'/);

// Given a VM reboot that starts the persistent ProgramData bootstrap,
// When the host bootstrap has changed,
// Then the guest must refresh its persistent copy before launching the worker and bridge.
assert.match(bootstrap, /function Update-PersistentBootstrapSource/);
assert.match(bootstrap, /갱신된 VM 부트스트랩으로 즉시 재실행합니다/);

console.log('VM_NAVER_SILENT_WORKER_MANUAL_GATE_PASS');
