const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
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

const confidenceLabel = extractFunction(core05, 'getCompetitorStyleConfidenceLabel');
const context = {};
vm.createContext(context);
vm.runInContext(confidenceLabel, context);

assert.equal(context.getCompetitorStyleConfidenceLabel('high'), '높음');
assert.equal(context.getCompetitorStyleConfidenceLabel('Medium'), '보통');
assert.equal(context.getCompetitorStyleConfidenceLabel('LOW'), '낮음');
assert.equal(context.getCompetitorStyleConfidenceLabel(''), '');
assert.equal(context.getCompetitorStyleConfidenceLabel('unrecognized'), '확인 필요');

console.log(JSON.stringify({
  ok: true,
  confidenceLabels: ['높음', '보통', '낮음', '확인 필요'],
}));
