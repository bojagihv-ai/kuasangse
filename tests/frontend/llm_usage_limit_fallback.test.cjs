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
    OpenAIAPI: class {
      constructor(key, model) { calls.openaiCtor.push({ key, model }); this.model = model; }
      analyzeCompetitorImages(...args) { calls.fallback += 1; return fallbackImpl ? fallbackImpl(...args) : { ok: 'openai' }; }
    },
    getLLMClient: () => ({ analyzeCompetitorImages: () => { calls.primary += 1; return { ok: 'primary' }; } }),
  });
  vm.runInContext([
    extractConst(CORE_01, 'LLM_USAGE_LIMIT_PATTERN'),
    extractFunction(CORE_01, 'isLlmUsageLimitError'),
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

test('기본 provider·모델과 폴백이 같으면 무의미한 재시도를 하지 않는다', async () => {
  const { context, calls } = createHarness({
    config: { llmProvider: 'ollama', llmModel: 'gemma4:e4b', fallbackProvider: 'ollama', fallbackModel: 'gemma4:e4b' },
  });
  await assert.rejects(
    () => context.runIt('analyzeCompetitorImages', [[]], { client: failWith('사용량 한도') }),
    /사용량 한도/,
  );
  assert.equal(calls.fallback, 0, '같은 모델로 다시 시도하면 안 된다');
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
