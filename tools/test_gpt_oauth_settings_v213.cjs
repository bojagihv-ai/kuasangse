const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core01 = fs.readFileSync(path.join(root, 'src', 'app-core-01.js'), 'utf8');
const core05 = fs.readFileSync(path.join(root, 'src', 'app-core-05.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const signatureStart = source.indexOf('(', start);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    if (source[index] === '(') signatureDepth += 1;
    if (source[index] === ')') signatureDepth -= 1;
    if (signatureDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} body start not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

const modelContext = {};
vm.createContext(modelContext);
vm.runInContext(extractFunction(core01, 'normalizeGptOAuthModelId'), modelContext);
assert.equal(
  modelContext.normalizeGptOAuthModelId(''),
  'gpt-5.6-sol',
  'GPT OAuth 빈 모델은 최신 기본 모델로 정규화되어야 합니다.',
);

assert.match(core01, /id:\s*'gpt-5\.6-sol'/, 'GPT-5.6 Sol 모델 선택지가 필요합니다.');
assert.match(core01, /id:\s*'gpt-5\.6-terra'/, 'GPT-5.6 Terra 모델 선택지가 필요합니다.');
assert.match(core01, /id:\s*'gpt-5\.6-luna'/, 'GPT-5.6 Luna 모델 선택지가 필요합니다.');
assert.match(core01, /llmModel:\s*'gpt-5\.6-sol'/, '기본 LLM은 GPT-5.6 Sol이어야 합니다.');
assert.match(core01, /api\/llm\/options/, '모델·추론·티어 선택지는 API Hub 최신 옵션을 읽어야 합니다.');
assert.match(core01, /executionPresets/, 'API Hub 실행 프리셋을 설정 화면에 연결해야 합니다.');
assert.match(core05, /data-gpt-oauth-preset/, '추론 프리셋 버튼을 GUI에 노출해야 합니다.');
assert.match(core05, /gptOAuthReasoningSelect/, '추론 강도 선택 컨트롤이 필요합니다.');
assert.match(core05, /gptOAuthServiceTierSelect/, '속도·서비스 티어 선택 컨트롤이 필요합니다.');

console.log(JSON.stringify({
  ok: true,
  defaultModel: 'gpt-5.6-sol',
  models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  controls: ['model', 'reasoning-effort', 'service-tier', 'execution-preset'],
}));
