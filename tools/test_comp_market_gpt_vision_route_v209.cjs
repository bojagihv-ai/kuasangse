const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core01 = fs.readFileSync(path.join(root, 'src', 'app-core-01.js'), 'utf8');
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

const routeFunction = extractFunction(core01, 'getGptOAuthImageAnalysisRoute');
const routeContext = {
  GPT_OAUTH_IMAGE_ANALYSIS_FALLBACKS: {
    'gpt-5.3-codex-spark': 'gpt-5.5',
    'gpt-5.3-codex': 'gpt-5.5',
  },
  normalizeGptOAuthModelId(value) { return String(value || '').trim() || 'gpt-5.5'; },
  normalizeGptOAuthServiceTier(value) { return String(value || '').trim() || 'standard'; },
  getGptOAuthModelLabel(value) { return `label:${value}`; },
};
vm.createContext(routeContext);
vm.runInContext(routeFunction, routeContext);

const sparkRoute = routeContext.getGptOAuthImageAnalysisRoute('gpt-5.3-codex-spark', 'fast');
assert.deepEqual(
  JSON.parse(JSON.stringify(sparkRoute)),
  {
    requestedModel: 'gpt-5.3-codex-spark',
    requestedServiceTier: 'fast',
    modelId: 'gpt-5.5',
    serviceTier: 'standard',
    usedFallback: true,
    notice: 'label:gpt-5.3-codex-spark은 현재 상세페이지 픽셀 판독이 보장되지 않아, 이번 이미지 분석만 label:gpt-5.5 표준 경로로 자동 전환했습니다.',
  },
  'Spark 선택 시 이미지 분석은 실검증된 GPT-5.5 표준 경로로 전환되어야 합니다.',
);

const stableRoute = routeContext.getGptOAuthImageAnalysisRoute('gpt-5.5', 'standard');
assert.equal(stableRoute.modelId, 'gpt-5.5');
assert.equal(stableRoute.serviceTier, 'standard');
assert.equal(stableRoute.usedFallback, false, '이미지 판독 가능한 선택 모델은 불필요하게 바꾸면 안 됩니다.');

const futureRoute = routeContext.getGptOAuthImageAnalysisRoute('gpt-5.6-sol', 'fast');
assert.equal(futureRoute.modelId, 'gpt-5.6-sol');
assert.equal(futureRoute.serviceTier, 'fast');
assert.equal(futureRoute.usedFallback, false, '검증되지 않은 다른 선택 모델은 임의로 대체하지 않습니다.');

assert.match(
  core01,
  /async analyzeCompetitorImages\(imagesArray\)[\s\S]{0,900}getGptOAuthImageAnalysisRoute\(this\.model, this\.serviceTier\)[\s\S]{0,900}model:\s*route\.modelId[\s\S]{0,300}serviceTier:\s*route\.serviceTier/,
  '경쟁사 이미지 분석 호출은 계산된 이미지 판독 모델과 서비스 티어를 API Hub에 전달해야 합니다.',
);
assert.match(
  core06,
  /imageFallback:\s*true[\s\S]{0,1000}이미지 판독 모델 자동 전환/,
  '화면에는 선택 모델과 실제 이미지 판독 모델이 다를 때 자동 전환 사실을 남겨야 합니다.',
);

console.log(JSON.stringify({
  ok: true,
  sparkRoute,
  stableRoute,
  futureRoute,
  staticContracts: ['GptOAuthAPI.analyzeCompetitorImages', 'startCompetitorAnalysis'],
}));
