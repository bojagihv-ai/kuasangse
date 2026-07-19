const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core03 = fs.readFileSync(path.join(root, 'src', 'app-core-03.js'), 'utf8');
const core05 = fs.readFileSync(path.join(root, 'src', 'app-core-05.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const signatureStart = source.indexOf('(', start);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') signatureDepth += 1;
    if (char === ')') signatureDepth -= 1;
    if (signatureDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} body start not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

const backendBase = extractFunction(core05, 'factoryBackendBaseUrl');
const archiveBase = extractFunction(core03, 'factoryRuntimeBackendBaseUrl');
const archiveUrl = extractFunction(core03, 'factoryRuntimeArchiveImageUrl');

assert.doesNotMatch(
  backendBase,
  /\bstate\b/,
  '영속 세션을 복원하는 동안 lexical state를 읽으면 TDZ 오류가 납니다.'
);
assert.doesNotMatch(
  archiveBase,
  /\bstate\b/,
  '아카이브 이미지 URL 계산은 초기 부팅 전에 lexical state를 읽으면 안 됩니다.'
);
assert.match(archiveUrl, /factoryRuntimeBackendBaseUrl\(\)/);

console.log(JSON.stringify({ ok: true }));
