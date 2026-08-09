const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const python = path.join(root, 'backend', 'venv311', 'Scripts', 'python.exe');

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(python, ['-m', 'pytest', '-q', 'control_tower/tests/backend', 'control_tower/tests/contracts/test_contracts.py'], { PYTHONPATH: root });
run(process.execPath, ['--test', 'control_tower/tests/contracts/contracts.test.mjs', 'tests/frontend/batch_control_worker_contract.test.cjs']);
run(process.execPath, ['tools/build_runtime_bundle.cjs', '--check']);

const html = fs.readFileSync(path.join(root, 'control_tower', 'frontend', 'control-tower.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
for (const match of scripts) Function(match[1]);
console.log(`CONTROL_TOWER_HTML_SCRIPTS_OK ${scripts.length}`);
