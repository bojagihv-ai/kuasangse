const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
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

// 정의되지 않은 CSS 토큰은 오류를 내지 않고 그 선언만 조용히 사라진다. 테두리가 없어지고
// 모서리가 각지고 글자 크기가 상속되는데, 화면을 열어 보지 않으면 알 수 없다.
// 실측 2026-08-26: 이어붙여 보기 창의 배경이 통째로 투명했고 원인은 없는 토큰 이름이었다.
{
  const defined = new Set([...html.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  const used = new Map();
  for (const match of html.matchAll(/var\((--[a-z0-9-]+)/g)) {
    used.set(match[1], (used.get(match[1]) || 0) + 1);
  }
  const missing = [...used.keys()].filter(name => !defined.has(name)).sort();
  if (missing.length) {
    console.error('정의되지 않은 CSS 토큰이 쓰였습니다:');
    for (const name of missing) console.error(`  ${name} (${used.get(name)}곳)`);
    process.exit(1);
  }
  console.log(`CONTROL_TOWER_CSS_TOKENS_OK ${defined.size}`);
}

// 모듈이 모듈을 부를 때 쓰는 캐시 번호는 HTML 을 고쳐도 그대로 남는다. 그러면 고친
// 모듈이 브라우저에 영영 안 간다. 실측 2026-08-26: production-board-model.mjs 가
// parallelBoard=24 에 멈춰 있어, 고쳐 놓고도 화면은 옛 코드로 돌고 있었다.
// 파일 내용이 바뀌면 캐시 번호도 함께 올라가야 한다.
{
  const srcDir = path.join(root, 'control_tower', 'frontend', 'src');
  const stampPath = path.join(root, 'control_tower', 'frontend', 'module-cache-stamps.json');
  const stamps = fs.existsSync(stampPath) ? JSON.parse(fs.readFileSync(stampPath, 'utf8')) : {};
  const imports = new Map();
  for (const file of fs.readdirSync(srcDir).filter(name => name.endsWith('.mjs'))) {
    const body = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const match of body.matchAll(/'\.\/([a-z0-9-]+\.mjs)\?([^']+)'/g)) {
      imports.set(match[1], match[2]);
    }
  }
  const stale = [];
  const next = {};
  for (const [file, token] of imports) {
    const digest = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(srcDir, file)))
      .digest('hex')
      .slice(0, 16);
    next[file] = { token, digest };
    const seen = stamps[file];
    if (seen && seen.digest !== digest && seen.token === token) stale.push(file);
  }
  if (stale.length) {
    console.error('내용이 바뀌었는데 캐시 번호를 안 올린 모듈이 있습니다:');
    for (const file of stale) console.error(`  ${file} (지금 ?${imports.get(file)})`);
    console.error('부르는 쪽 import 의 물음표 뒤 숫자를 올려 주세요.');
    process.exit(1);
  }
  fs.writeFileSync(stampPath, `${JSON.stringify(next, null, 2)}
`);
  console.log(`CONTROL_TOWER_MODULE_CACHE_OK ${imports.size}`);
}
