// 사용량 한도 폴백 계약.
//
// 기본 실행 provider 는 gpt_oauth 로 유지하고, 사용량 한도로 거절될 때만
// 사용자가 지정한 폴백 모델(OpenAI API / 로컬 Ollama)로 한 번 더 시도한다.
// 한도가 아닌 실패(키 없음·네트워크 등)는 폴백하지 않고 그대로 보고해야 한다.
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
  const re = new RegExp(`const ${name} =[\\s\\S]*?;\\r?\\n`);
  const match = source.match(re);
  assert.ok(match, `${name} 상수가 필요합니다`);
  return match[0];
}

const PROVIDERS = {
  gpt_oauth: { label: 'ChatGPT 로그인 OAuth', models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }] },
  openai: { label: 'OpenAI ChatGPT', models: [{ id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' }] },
  claude_oauth: {
    label: 'Claude 구독 로그인 OAuth',
    vision: false,
    imageGeneration: false,
    models: [{ id: 'claude-opus-5', label: 'Claude Opus 5 · 권장' }],
  },
  ollama: {
    label: '로컬 Ollama',
    local: true,
    models: [
      { id: 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL', label: 'Qwen3.8 27B · 판독 정확' },
      { id: 'gemma4:e4b', label: 'Gemma4 e4b · 빠름' },
    ],
  },
};

function createHarness({ config = {}, openaiKey = 'sk-test', fallbackImpl } = {}) {
  const calls = { primary: 0, fallback: 0, ollamaCtor: [], openaiCtor: [] };
  const modelConfig = {
    llmProvider: 'gpt_oauth',
    llmModel: 'gpt-5.6-sol',
    fallbackProvider: 'ollama',
    fallbackEnabled: true,
    fallbackModel: 'gemma4:e4b',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ...config,
  };
  const context = vm.createContext({
    LLM_PROVIDERS: PROVIDERS,
    OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
    state: { modelConfig },
    normalizeModelConfig: cfg => ({ ...cfg }),
    getRuntimeOpenAIKey: () => openaiKey,
    calls,
    OllamaAPI: class {
      constructor(model, baseUrl) { calls.ollamaCtor.push({ model, baseUrl }); this.model = model; }
      analyzeCompetitorImages(...args) { calls.fallback += 1; return fallbackImpl ? fallbackImpl(...args) : { ok: 'ollama' }; }
    },
    ClaudeOAuthAPI: class {
      constructor(model, opts) { calls.claudeCtor = calls.claudeCtor || []; calls.claudeCtor.push({ model, opts }); this.model = model; }
      analyzeCompetitorHTML() { calls.fallback += 1; return { ok: 'claude' }; }
      analyzeCompetitorImages() { throw new Error('Claude 구독 로그인 OAuth 브리지는 이미지 판독을 지원하지 않습니다.'); }
    },
    OpenAIAPI: class {
      constructor(key, model) { calls.openaiCtor.push({ key, model }); this.model = model; }
      analyzeCompetitorImages(...args) { calls.fallback += 1; return fallbackImpl ? fallbackImpl(...args) : { ok: 'openai' }; }
    },
    getLLMClient: () => ({ analyzeCompetitorImages: () => { calls.primary += 1; return { ok: 'primary' }; } }),
  });
  vm.runInContext([
    extractConst(CORE_01, 'LLM_USAGE_LIMIT_PATTERN'),
    extractConst(CORE_01, 'LLM_FALLBACK_PRIORITY'),
    extractConst(CORE_01, 'LLM_VISION_METHODS'),
    extractConst(CORE_01, 'LLM_IMAGE_GEN_METHODS'),
    extractFunction(CORE_01, 'isLlmUsageLimitError'),
    extractFunction(CORE_01, 'providerSupportsLlmMethod'),
    extractFunction(CORE_01, 'llmFallbackPlan'),
    extractFunction(CORE_01, 'createLlmFallbackClient'),
    `async ${extractFunction(CORE_01, 'runLlmWithFallback')}`,
    'runIt = runLlmWithFallback; isLimit = isLlmUsageLimitError; planIt = llmFallbackPlan;',
  ].join('\n'), context);
  return { context, calls, modelConfig };
}

function failWith(message) {
  return { analyzeCompetitorImages: () => { throw new Error(message); } };
}

test('사용량 한도 문구는 provider 표현이 달라도 모두 한도로 분류한다', () => {
  const { context } = createHarness();
  for (const message of [
    'codex-usage-limit',
    'Codex/ChatGPT GPT OAuth 사용량 한도에 도달해 AI 판독을 진행하지 못했습니다.',
    'Rate limit reached for gpt-5.4',
    'You exceeded your current quota',
    'HTTP 429 Too Many Requests',
    'insufficient_quota',
  ]) {
    assert.equal(context.isLimit(new Error(message)), true, `한도로 분류되어야 함: ${message}`);
  }
  for (const message of [
    'OpenAI API 키가 설정되지 않았습니다.',
    'Failed to fetch',
    'LLM 응답을 JSON으로 해석하지 못했습니다.',
  ]) {
    assert.equal(context.isLimit(new Error(message)), false, `한도가 아니어야 함: ${message}`);
  }
});

test('한도로 막히면 지정한 로컬 Ollama 모델로 전환하고 전환 사실을 알린다', async () => {
  const { context, calls } = createHarness();
  const notices = [];
  const result = await context.runIt('analyzeCompetitorImages', [[{ base64: 'x' }]], {
    client: failWith('codex-usage-limit: 사용량 한도'),
    onFallback: notice => notices.push(notice),
  });

  assert.equal(calls.fallback, 1, '폴백 클라이언트가 실행되어야 한다');
  assert.deepEqual(calls.ollamaCtor, [{ model: 'gemma4:e4b', baseUrl: 'http://127.0.0.1:11434' }]);
  assert.equal(result.ok, 'ollama');
  // VM 컨텍스트 객체라 prototype 이 달라 deepStrictEqual 대신 값으로 비교한다.
  assert.deepEqual(JSON.parse(JSON.stringify(result.__fallbackUsed)), {
    provider: 'ollama', model: 'gemma4:e4b', label: '로컬 Ollama', modelLabel: 'Gemma4 e4b · 빠름',
  }, '결과에 어떤 모델이 실제로 응답했는지 표시되어야 한다');
  assert.equal(notices.length, 1, '전환 사실을 화면에 알려야 한다');
  assert.match(notices[0].reason, /사용량 한도/);
});

test('한도가 아닌 실패는 폴백하지 않고 원래 오류를 그대로 보고한다', async () => {
  const { context, calls } = createHarness();
  await assert.rejects(
    () => context.runIt('analyzeCompetitorImages', [[]], { client: failWith('Failed to fetch') }),
    /Failed to fetch/,
  );
  assert.equal(calls.fallback, 0, '한도가 아닌데 폴백이 실행되면 안 된다');
});

test('폴백을 사용 안 함으로 두면 한도여도 전환하지 않는다', async () => {
  const { context, calls } = createHarness({ config: { fallbackProvider: 'none', fallbackEnabled: false, fallbackModel: '' } });
  await assert.rejects(
    () => context.runIt('analyzeCompetitorImages', [[]], { client: failWith('usage limit reached') }),
    /usage limit reached/,
  );
  assert.equal(calls.fallback, 0);
});

test('OpenAI 폴백인데 API 키가 없으면 원인과 폴백 불가를 함께 보고한다', async () => {
  const { context, calls } = createHarness({
    config: { fallbackProvider: 'openai', fallbackModel: 'gpt-5.4-mini' },
    openaiKey: '',
  });
  await assert.rejects(
    () => context.runIt('analyzeCompetitorImages', [[]], { client: failWith('codex-usage-limit') }),
    error => {
      assert.match(error.message, /codex-usage-limit/, '원래 한도 사유가 남아야 한다');
      assert.match(error.message, /폴백도 사용할 수 없습니다[\s\S]*API 키/, '폴백 불가 사유도 함께 알려야 한다');
      return true;
    },
  );
  assert.equal(calls.fallback, 0);
});

test('폴백도 실패하면 두 실패를 한 메시지로 합쳐 보고한다', async () => {
  const { context } = createHarness({
    fallbackImpl: () => { throw new Error('ollama 서버 응답 없음'); },
  });
  await assert.rejects(
    () => context.runIt('analyzeCompetitorImages', [[]], { client: failWith('사용량 한도 도달') }),
    error => {
      assert.match(error.message, /사용량 한도 도달/);
      assert.match(error.message, /폴백\(로컬 Ollama · Gemma4 e4b · 빠름\)도 실패/);
      return true;
    },
  );
});

test('기본과 같은 모델은 건너뛰고 능력 있는 다음 후보로 이어간다', async () => {
  // 같은 모델로 다시 부르는 것은 무의미하다. 다만 폴백을 포기하지는 않고
  // 체인의 다음 후보(요청 메서드를 실제로 수행할 수 있는 provider)로 넘어간다.
  const { context, calls } = createHarness({
    config: { llmProvider: 'ollama', llmModel: 'gemma4:e4b', fallbackProvider: 'ollama', fallbackModel: 'gemma4:e4b' },
  });
  const result = await context.runIt('analyzeCompetitorImages', [[]], { client: failWith('사용량 한도') });

  assert.equal(calls.fallback, 1, '체인의 다음 후보로는 넘어가야 한다');
  assert.deepEqual(calls.ollamaCtor, [], '같은 ollama 모델로 다시 시도하면 안 된다');
  assert.equal(result.ok, 'openai', 'vision 이 되는 다음 후보가 응답해야 한다');
  assert.equal(JSON.parse(JSON.stringify(result.__fallbackUsed)).provider, 'openai');
});

test('Ollama 폴백 모델은 vision 지원 모델만 등록한다', () => {
  const registered = (CORE_01.match(/ollama:\s*\{[\s\S]*?\n  \},/) || [''])[0];
  assert.ok(registered, 'LLM_PROVIDERS.ollama 등록이 필요합니다');
  // 실측으로 vision 미지원이 확인된 모델은 이미지 판독 폴백에 쓸 수 없다.
  for (const blocked of ['gemma4-26b-iq4', 'mistral-small']) {
    assert.doesNotMatch(registered, new RegExp(blocked), `${blocked} 은 vision 미지원이라 등록하면 안 됩니다`);
  }
  assert.match(registered, /Qwen3\.8-27B/, 'Qwen3.8 27B(vision 확인됨)는 등록되어야 합니다');
  assert.match(registered, /gemma4:e4b/, 'gemma4:e4b(vision 확인됨)는 등록되어야 합니다');
});

test('로컬 Ollama 는 이미지 생성을 지원하지 않는다고 명확히 알린다', async () => {
  const source = extractFunction(CORE_01, 'probeOllamaModels');
  assert.ok(source, 'probeOllamaModels 가 필요합니다');
  const classBody = (CORE_01.match(/class OllamaAPI extends OpenAIAPI \{[\s\S]*?\n\}/) || [''])[0];
  assert.match(classBody, /extends OpenAIAPI/, 'OpenAI 호환 경로를 재사용해야 프롬프트 중복이 생기지 않는다');
  assert.match(classBody, /generateImage[\s\S]*이미지 생성을 지원하지 않습니다/,
    '이미지 생성 요청은 조용히 실패하지 않고 명확히 거절해야 한다');
  assert.match(classBody, /\/v1/, 'OpenAI 호환 엔드포인트(/v1)를 사용해야 한다');
});

test('폴백 기본값은 Claude 구독 로그인이고 나머지는 명시 선택일 때만 쓴다', () => {
  // 로컬 27B 는 상주 시 15GB 를 물어 같은 PC 의 다른 공정 타이밍을 흔든다(GENERATE-01 사례).
  const normalize = extractFunction(CORE_01, 'normalizeLlmFallbackConfig');
  const context = vm.createContext({ LLM_PROVIDERS: PROVIDERS, OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434', normalizeClaudeOAuthEffort: v => v || 'high' });
  const fallbackProvidersConst = extractConst(CORE_01, 'LLM_FALLBACK_PROVIDERS');
  vm.runInContext(`${fallbackProvidersConst}\n${normalize}\nrun = normalizeLlmFallbackConfig;`, context);

  const fresh = context.run({});
  assert.equal(fresh.fallbackProvider, 'claude_oauth', '설정이 없으면 Claude 구독 로그인으로 폴백해야 한다');
  assert.equal(fresh.fallbackModel, 'claude-opus-5');
  assert.equal(fresh.fallbackEnabled, true);

  const explicit = context.run({ fallbackProvider: 'ollama' });
  assert.equal(explicit.fallbackProvider, 'ollama', '명시 선택은 존중해야 한다');
  assert.equal(explicit.fallbackModel, 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL');

  const off = context.run({ fallbackProvider: 'none' });
  assert.equal(off.fallbackEnabled, false);
  assert.equal(off.fallbackModel, '');
});

test('모든 LLM 공정이 폴백 경로를 지난다 (직접 llm.* 호출 금지)', () => {
  // 경쟁사 분석만 폴백에 걸려 있고 섹션 플랜·섹션 본문·이미지 분석이 빠져 있어서,
  // 한도에 걸리면 그 공정들만 그대로 실패했다(2026-08-21 섹션 플랜 생성 실패).
  const core06 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

  const direct = core06.match(/llm\.(?:analyze|generate|compare)[A-Za-z]*\(/g) || [];
  assert.deepEqual(direct, [], `폴백을 지나지 않는 직접 호출이 남았습니다: ${direct.join(', ')}`);

  // 실제로 감싸는 헬퍼가 있고 폴백 실행기로 위임해야 한다.
  assert.match(core06, /async function runLlmStage\(llm, method, args\)/);
  assert.match(core06, /runLlmStage[\s\S]{0,200}runLlmWithFallback\(method, args/);

  // 한도로 막히기 쉬운 공정 4종이 모두 연결됐는지 확인한다.
  for (const method of [
    'analyzeCompetitorImages',
    'analyzeCompetitorHTML',
    'generateCompetitorSectionPlan',
    'generateSectionContent',
    'analyzeImage',
  ]) {
    assert.ok(
      core06.includes(`runLlmStage(llm, '${method}'`),
      `${method} 가 폴백 경로에 연결되지 않았습니다`,
    );
  }
});
