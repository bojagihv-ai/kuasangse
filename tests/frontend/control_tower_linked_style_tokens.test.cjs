'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'tools/verify_control_tower.cjs'), 'utf8');
const start = source.indexOf('\n{', source.indexOf('// 정의되지 않은 CSS'));
const end = source.indexOf('\n// 모듈이 모듈을', start);
assert.ok(start >= 0 && end > start);
const checker = source.slice(start, end);
const html = fs.readFileSync(path.join(root, 'control_tower/frontend/control-tower.html'), 'utf8');

function verify(markup, alterStyle = value => value) {
  const errors = [];
  vm.runInNewContext(checker, {
    root, html: markup, path, URL,
    fs: { readFileSync: (file, encoding) => alterStyle(fs.readFileSync(file, encoding)) },
    console: { log() {}, error: message => errors.push(message) },
    process: { exit: code => { throw new Error(`exit=${code}: ${errors.join('\n')}`); } },
  });
}

test('운영 HTML에 연결된 공유 테마와 대량입력 CSS의 토큰을 검증한다', () => {
  assert.doesNotThrow(() => verify(html));
});

test('스타일시트 연결이 빠지면 그 파일의 토큰을 있다고 간주하지 않는다', () => {
  const missingLink = html.replace('<link href="./src/bulk-intake.css" rel="stylesheet">', '');
  assert.notEqual(missingLink, html);
  assert.throws(() => verify(missingLink), /--color-page-background/);
});

test('실제 CSS 정의가 사라지거나 새 미정의 토큰을 쓰면 실패한다', () => {
  assert.throws(() => verify(html, css => css.replace(/--content-max-width\s*:[^;]+;/, '')), /--content-max-width/);
  assert.throws(() => verify(`${html}<style>.probe { color: var(--missing-gate-token); }</style>`), /--missing-gate-token/);
});

function verifyModuleTokens(tokens, storedDigest) {
  const body = 'export const current = true;';
  const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  const writes = [];
  const files = new Map([
    ['first.mjs', `import './model.mjs?${tokens[0]}'`],
    ['second.mjs', `import './model.mjs?${tokens[1]}'`],
    ['model.mjs', body],
    ['module-cache-stamps.json', JSON.stringify({ 'model.mjs': { token: 'version=2', digest: storedDigest || digest } })],
  ]);
  const block = source.slice(source.indexOf('\n{', source.indexOf('// 모듈이 모듈을')));
  vm.runInNewContext(block, {
    root, path, crypto,
    fs: {
      existsSync: () => true,
      readdirSync: () => ['first.mjs', 'second.mjs', 'model.mjs'],
      readFileSync: file => files.get(path.basename(file)),
      writeFileSync: (_file, value) => writes.push(value),
    },
    console: { log() {}, error() {} },
    process: { exit: code => { throw new Error(`cache-check-exit=${code}`); } },
  });
  return writes;
}

test('같은 모듈의 모든 호출자가 같은 캐시 번호를 사용해야 한다', () => {
  assert.equal(verifyModuleTokens(['version=2', 'version=2']).length, 1);
  assert.throws(() => verifyModuleTokens(['version=1', 'version=2']), /cache-check-exit=1/);
});

test('내용이 바뀐 모듈이 이전 캐시 번호를 재사용하면 여전히 실패한다', () => {
  assert.throws(() => verifyModuleTokens(['version=2', 'version=2'], 'old-source-digest'), /cache-check-exit=1/);
});
