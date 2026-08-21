'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const VERIFY_SCRIPT = path.join(ROOT, 'tools', 'verify_factory_usage_ctrl_f5_persistence_v218.cjs');

function source() {
  return fs.readFileSync(VERIFY_SCRIPT, 'utf8');
}

function lastWorkFetchSource(text) {
  const start = text.indexOf('const serverRecord = await fetch(');
  const end = text.indexOf(').then(response => response.json());', start);
  assert.ok(start >= 0 && end > start, 'last-work fetch source boundary is required');
  return text.slice(start + 'const serverRecord = await '.length, end + 1);
}

test('usage Ctrl+F5 검증은 5050 literal을 직접 읽지 않는다', () => {
  assert.doesNotMatch(
    source(),
    /fetch\('http:\/\/127\.0\.0\.1:5050\/api\/last-work\?workspaceId='/,
    'production usage Ctrl+F5 read가 main 5050 literal로 되돌아가면 안 됩니다.',
  );
});

test('격리 backend base의 usage Ctrl+F5 last-work read가 task-owned server에 도달한다', async () => {
  const text = source();
  assert.match(
    text,
    /const BACKEND_BASE = process\.env\.KUASANGSE_BACKEND_BASE \|\| process\.env\.KUASANGSE_BACKEND_URL/,
    'usage Ctrl+F5 검증은 기존 isolated backend 환경 seam을 사용해야 합니다.',
  );
  assert.match(
    text,
    /\$\{JSON\.stringify\(`\$\{BACKEND_BASE\}\/api\/last-work\?workspaceId=`\)\}/,
    'last-work read는 BACKEND_BASE에서 URL을 만들어야 합니다.',
  );

  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, hasSnapshot: false }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const isolatedBase = `http://127.0.0.1:${server.address().port}`;
  const scopeId = 'usage_ctrl_f5_isolated_' + Date.now();
  const fetchSource = lastWorkFetchSource(text).replace(
    /\$\{JSON\.stringify\(`\$\{BACKEND_BASE\}\/api\/last-work\?workspaceId=`\)\}/,
    JSON.stringify(`${isolatedBase}/api/last-work?workspaceId=`),
  );

  try {
    await vm.runInNewContext(`(async () => ${fetchSource})()`, {
      encodeURIComponent,
      fetch,
      scopeId,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  assert.deepEqual(requests, [{
    method: 'GET',
    url: `/api/last-work?workspaceId=${encodeURIComponent(scopeId)}`,
  }], 'unique workspace GET must reach the isolated backend, not 5050');
});
