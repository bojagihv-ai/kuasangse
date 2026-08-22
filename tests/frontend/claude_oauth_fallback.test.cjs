// Claude 구독 로그인 OAuth 폴백 계약.
//
// API Hub 의 claude-subscription-oauth 브리지는 Claude Code CLI 로
// Claude.ai 구독 로그인 세션을 호출한다. 구독을 쓰므로 폴백 1순위지만,
// 브리지가 프롬프트 텍스트만 받기 때문에 이미지 판독은 하지 못한다.
// 따라서 폴백은 '단일 대상'이 아니라 '능력 인지 체인'이어야 한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_01 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-01.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 정의가 필요합니다`);
  const signatureEnd = source.slice(start).match(/\)\s*\{/);
  const braceStart = start + signatureEnd.index + signatureEnd[0].lastIndexOf('{');
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} 경계를 찾지 못했습니다`);
}

function extractConst(source, name) {
  const match = source.match(new RegExp(`const ${name} =[\\s\\S]*?;\\r?\\n`));
  assert.ok(match, `${name} 상수가 필요합니다`);
  return match[0];
}

const PROVIDERS = {
  gpt_oauth: { label: 'ChatGPT 로그인 OAuth', vision: true, models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }] },
  openai: { label: 'OpenAI ChatGPT', vision: true, models: [{ id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' }] },
  ollama: { label: '로컬 Ollama', vision: true, models: [{ id: 'gemma4:e4b', label: 'Gemma4 e4b' }] },
  claude_oauth: {
    label: 'Claude 구독 로그인 OAuth',
    vision: false,
    imageGeneration: false,
    models: [{ id: 'claude-opus-5', label: 'Claude Opus 5 · 권장' }, { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }],
  },
};

function planner(config = {}) {
  const cfg = {
    llmProvider: 'gpt_oauth',
    llmModel: 'gpt-5.6-sol',
    fallbackProvider: 'claude_oauth',
    fallbackEnabled: true,
    fallbackModel: 'claude-opus-5',
    ...config,
  };
  const context = vm.createContext({ LLM_PROVIDERS: PROVIDERS, state: { modelConfig: cfg }, normalizeModelConfig: c => ({ ...c }) });
  vm.runInContext([
    extractConst(CORE_01, 'LLM_FALLBACK_PRIORITY'),
    extractConst(CORE_01, 'LLM_VISION_METHODS'),
    extractConst(CORE_01, 'LLM_IMAGE_GEN_METHODS'),
    extractFunction(CORE_01, 'providerSupportsLlmMethod'),
    extractFunction(CORE_01, 'llmFallbackPlan'),
    'plan = llmFallbackPlan; supports = providerSupportsLlmMethod;',
  ].join('\n'), context);
  return { plan: (method) => context.plan(cfg, method), supports: context.supports, cfg };
}

test('텍스트 분석은 Claude 구독 로그인 OAuth 로 폴백한다', () => {
  const { plan } = planner();
  const result = plan('analyzeCompetitorHTML');
  assert.equal(result.provider, 'claude_oauth', '구독을 쓰는 Claude 가 1순위여야 한다');
  assert.equal(result.model, 'claude-opus-5');
  assert.equal(result.label, 'Claude 구독 로그인 OAuth');
});

test('이미지 판독은 Claude 를 건너뛰고 능력 있는 다음 폴백으로 넘어간다', () => {
  const { plan } = planner();
  // 브리지가 이미지를 못 받으므로 Claude 로 넘기면 그냥 실패한다.
  const result = plan('analyzeCompetitorImages');
  assert.equal(result.provider, 'openai', 'vision 이 되는 다음 후보로 넘어가야 한다');
  assert.notEqual(result.provider, 'claude_oauth');
});

test('이미지 생성도 Claude 를 건너뛴다', () => {
  const { plan } = planner();
  const result = plan('generateImage');
  assert.notEqual(result?.provider, 'claude_oauth');
});

test('능력 판정은 provider 플래그를 그대로 따른다', () => {
  const { supports } = planner();
  assert.equal(supports('claude_oauth', 'analyzeCompetitorHTML'), true);
  assert.equal(supports('claude_oauth', 'analyzeCompetitorImages'), false);
  assert.equal(supports('claude_oauth', 'analyzeImage'), false);
  assert.equal(supports('claude_oauth', 'generateImage'), false);
  assert.equal(supports('openai', 'analyzeCompetitorImages'), true);
  assert.equal(supports('ollama', 'analyzeCompetitorImages'), true);
});

test('vision 후보가 하나도 없으면 폴백하지 않는다', () => {
  // Ollama·OpenAI 를 제외하고 Claude 만 남기면 이미지 폴백 대상이 없다.
  const onlyClaude = {
    claude_oauth: PROVIDERS.claude_oauth,
    gpt_oauth: PROVIDERS.gpt_oauth,
  };
  const cfg = { llmProvider: 'gpt_oauth', llmModel: 'gpt-5.6-sol', fallbackProvider: 'claude_oauth', fallbackEnabled: true, fallbackModel: 'claude-opus-5' };
  const context = vm.createContext({ LLM_PROVIDERS: onlyClaude, state: { modelConfig: cfg }, normalizeModelConfig: c => ({ ...c }) });
  vm.runInContext([
    extractConst(CORE_01, 'LLM_FALLBACK_PRIORITY'),
    extractConst(CORE_01, 'LLM_VISION_METHODS'),
    extractConst(CORE_01, 'LLM_IMAGE_GEN_METHODS'),
    extractFunction(CORE_01, 'providerSupportsLlmMethod'),
    extractFunction(CORE_01, 'llmFallbackPlan'),
    'plan = llmFallbackPlan;',
  ].join('\n'), context);
  assert.equal(context.plan(cfg, 'analyzeCompetitorImages'), null, '능력 있는 후보가 없으면 null 이어야 한다');
});

test('기본 실행 provider 와 같은 모델로는 재시도하지 않는다', () => {
  const { plan } = planner({ llmProvider: 'claude_oauth', llmModel: 'claude-opus-5', fallbackProvider: 'claude_oauth', fallbackModel: 'claude-opus-5' });
  const result = plan('analyzeCompetitorHTML');
  assert.notEqual(`${result?.provider}:${result?.model}`, 'claude_oauth:claude-opus-5');
});

test('폴백 사용 안 함이면 어떤 메서드도 폴백하지 않는다', () => {
  const { plan } = planner({ fallbackProvider: 'none', fallbackEnabled: false, fallbackModel: '' });
  assert.equal(plan('analyzeCompetitorHTML'), null);
  assert.equal(plan('analyzeCompetitorImages'), null);
});

test('ClaudeOAuthAPI 는 브리지 규약을 지킨다', () => {
  const cls = (CORE_01.match(/class ClaudeOAuthAPI extends GptOAuthAPI \{[\s\S]*?\n\}/) || [''])[0];
  assert.ok(cls, 'ClaudeOAuthAPI 정의가 필요합니다');
  // 프롬프트를 다시 쓰지 않고 전송 계층만 바꾼다.
  assert.match(cls, /extends GptOAuthAPI/);
  assert.match(cls, /\/api\/claude-oauth\/exec/, '브리지 엔드포인트를 사용해야 한다');
  // 브리지가 명시한 successContract 검증
  assert.match(cls, /usedClaudeOAuth !== true \|\| data\.rawTokenReturned === true/,
    '브리지 successContract(usedClaudeOAuth·rawTokenReturned)를 검증해야 한다');
  // 이미지 요청은 조용히 실패하지 않고 명확히 거절
  assert.match(cls, /analyzeCompetitorImages[\s\S]{0,200}이미지 판독을 지원하지 않습니다/);
  assert.match(cls, /generateImage[\s\S]{0,200}이미지 생성을 지원하지 않습니다/);
  // API 키 경로를 절대 쓰지 않는다(브리지 규약)
  assert.doesNotMatch(cls, /anthropic\.api_key|ANTHROPIC_API_KEY|api\.anthropic\.com/);
});

test('연결 판정은 브리지의 passCondition 을 그대로 쓴다', () => {
  const source = extractFunction(CORE_01, 'isClaudeOAuthConnected');
  const context = vm.createContext({ state: {} });
  vm.runInContext(`${source}\ncheck = isClaudeOAuthConnected;`, context);

  context.state.claudeOAuthStatus = { claudeLoginReady: true, mode: 'claude-subscription-oauth', usesApiKey: false };
  assert.equal(context.check(), true);

  context.state.claudeOAuthStatus = { claudeLoginReady: true, mode: 'claude-subscription-oauth', usesApiKey: true };
  assert.equal(context.check(), false, 'API 키를 쓰는 상태는 Claude OAuth 로 인정하면 안 된다');

  context.state.claudeOAuthStatus = { claudeLoginReady: false, mode: 'claude-subscription-oauth', usesApiKey: false };
  assert.equal(context.check(), false);

  context.state.claudeOAuthStatus = null;
  assert.equal(context.check(), false);
});

test('등록 모델과 노력 단계는 브리지 options 와 일치한다', () => {
  const block = (CORE_01.match(/claude_oauth: \{[\s\S]*?\n  \},/) || [''])[0];
  for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5']) {
    assert.match(block, new RegExp(id.replace(/[.]/g, '\\.')), `브리지 modelOptions 의 ${id} 가 필요합니다`);
  }
  assert.match(block, /vision: false/, '이미지 판독 불가를 명시해야 폴백이 건너뛴다');
  const efforts = (CORE_01.match(/const CLAUDE_OAUTH_EFFORTS = \[[\s\S]*?\];/) || [''])[0];
  for (const id of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.match(efforts, new RegExp(`'${id}'`), `브리지 effortOptions 의 ${id} 가 필요합니다`);
  }
});
