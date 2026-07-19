const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');

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

const detailCapture = extractFunction(core06, 'runCompMarketDetailCapture');

assert.match(detailCapture, /factorySetGoalRunProgress/);
assert.match(detailCapture, /factoryStartGoalHeartbeat/);
assert.match(detailCapture, /factoryStopGoalHeartbeat/);
assert.match(detailCapture, /상세페이지 수집 중/);
assert.match(detailCapture, /상세페이지 수집 완료/);
assert.match(detailCapture, /상세수집 실패/);
assert.match(detailCapture, /running:\s*true/);
assert.match(detailCapture, /running:\s*false/);

console.log(JSON.stringify({
  ok: true,
  contract: 'detail collection exposes start, heartbeat, completion, and failure states',
}));
