
// ════════════════════════════════════════════════════════════════
// SECTION DEFINITIONS (15 sections)
// ════════════════════════════════════════════════════════════════
const SECTIONS = [
  {n:1,name:"헤더 (Header)",id:"header",purpose:"제품을 깔끔한 화이트톤 배경으로 강조. 제품명을 상단에 크고 임팩트 있게 표시.",desc:"화이트 배경 + 제품 중앙 배치 + 제품명 강조",icon:"🎯"},
  {n:2,name:"훅 (Hook)",id:"hook",purpose:"구매 욕구를 자극하는 강렬한 비주얼과 카피. 고객의 페인포인트를 건드리고 제품이 해결책임을 암시.",desc:"구매 욕구 자극 훅 메시지 + 감성 이미지",icon:"🪝"},
  {n:3,name:"핵심 특징 (Key Features)",id:"key_features",purpose:"제품의 핵심 특장점 3~5가지를 아이콘/이미지와 함께 명확하게 전달.",desc:"핵심 특장점 3~5가지 아이콘+텍스트 그리드",icon:"⭐"},
  {n:4,name:"상세 스펙 (Specifications)",id:"specifications",purpose:"제품의 상세 사양, 크기, 재질, 무게 등 구체적인 정보 제공.",desc:"상세 사양 테이블 + 제품 디테일 이미지",icon:"📐"},
  {n:5,name:"사용 시나리오 (Use Scenarios)",id:"use_scenarios",purpose:"다양한 사용 상황을 보여주어 고객이 자신의 라이프스타일에서 제품을 상상할 수 있게 함.",desc:"라이프스타일 이미지 + 사용 상황 텍스트",icon:"🏠"},
  {n:6,name:"비교 우위 (Competitive Edge)",id:"competitive_edge",purpose:"경쟁 제품 대비 우위점을 시각적으로 비교.",desc:"경쟁사 대비 비교표 또는 Before/After",icon:"🏆"},
  {n:7,name:"소재/기술 (Material & Tech)",id:"material_tech",purpose:"사용된 소재의 우수성이나 특허 기술 등을 시각적으로 설명.",desc:"소재/기술력 강조 다크톤 섹션",icon:"🔬"},
  {n:8,name:"인증/수상 (Certifications)",id:"certifications",purpose:"제품이 받은 인증, 수상 내역, 테스트 결과 등으로 신뢰도 구축.",desc:"인증마크/수상내역 배지 나열",icon:"🏅"},
  {n:9,name:"리뷰/후기 (Reviews)",id:"reviews",purpose:"실제 사용자 후기를 활용한 사회적 증거.",desc:"고객 리뷰 카드 레이아웃",icon:"💬"},
  {n:10,name:"색상옵션",id:"size_color",purpose:"옵션분류기에서 확정한 색상 옵션표와 옵션 선택 정보를 제공.",desc:"최종 선택 색상옵션 이미지 + 옵션 안내",icon:"🎨"},
  {n:11,name:"프로모션 (Promotion)",id:"promotion",purpose:"특별 할인, 세트 구성, 사은품 등 구매 촉진 이벤트 섹션.",desc:"할인/이벤트/세트 구성 프로모션 배너",icon:"🎁"},
  {n:12,name:"배송/포장 (Shipping)",id:"shipping",purpose:"배송 정보, 포장 상태, 언박싱 경험 등을 보여줌.",desc:"배송정보 + 패키징 이미지",icon:"📦"},
  {n:13,name:"FAQ (자주 묻는 질문)",id:"faq",purpose:"고객들이 자주 묻는 질문을 미리 답변하여 구매 불안 해소.",desc:"아코디언 형식 FAQ 섹션",icon:"❓"},
  {n:14,name:"브랜드 스토리",id:"brand_story",purpose:"브랜드의 철학, 스토리, 가치를 전달하여 감성적 연결 형성.",desc:"브랜드 스토리텔링 다크 섹션",icon:"📖"},
  {n:15,name:"CTA 푸터 (Footer)",id:"cta_footer",purpose:"최종 구매 결정을 유도하는 강력한 CTA.",desc:"최종 CTA + 가격 + 구매버튼",icon:"🛒"},
];

// ════════════════════════════════════════════════════════════════
// MODEL CONFIG SYSTEM
// ════════════════════════════════════════════════════════════════
// LLM 프로바이더 및 모델 목록 정의
const LLM_PROVIDERS = {
  gpt_oauth: {
    label: 'ChatGPT 로그인 OAuth',
    icon: '◇',
    color: '#22c55e',
    vision: true,
    models: [
      { id: 'gpt-5.6-sol',          label: 'GPT-5.6 Sol · 최신',       desc: 'GPT-5.6 플래그십 · API Hub 최신 기본값 · 미리보기 권한 필요', inputPerM: 0, outputPerM: 0 },
      { id: 'gpt-5.6-terra',        label: 'GPT-5.6 Terra',            desc: 'GPT-5.6 균형형 · 미리보기 권한 필요', inputPerM: 0, outputPerM: 0 },
      { id: 'gpt-5.6-luna',         label: 'GPT-5.6 Luna · 빠름',      desc: 'GPT-5.6 고속형 · 미리보기 권한 필요', inputPerM: 0, outputPerM: 0 },
      { id: 'gpt-5.5',              label: 'GPT-5.5 · 안정 대체',      desc: 'GPT-5.6 권한이 없을 때 사용할 안정 대체 모델', inputPerM: 0, outputPerM: 0 },
      { id: 'gpt-5.4',              label: 'GPT-5.4',                  desc: 'ChatGPT OAuth 고성능 대체 모델', inputPerM: 0, outputPerM: 0 },
      { id: 'gpt-5.3-codex-spark',  label: 'GPT-5.3 Codex Spark',      desc: '빠른 코딩·API 연결 · 고속 티어 없음(표준만)', inputPerM: 0, outputPerM: 0 },
      { id: 'gpt-5.3-codex',        label: 'GPT-5.3 Codex',            desc: 'ChatGPT OAuth에서 서버가 거절할 수 있는 플랫폼/API 계열', inputPerM: 0, outputPerM: 0, oauthUnsupported: true },
    ],
  },
  gemini: {
    label: 'Google Gemini',
    icon: '✦',
    color: '#6366f1',
    vision: true,
    models: [
      { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash',       desc: '최신 안정 기본값 · 이미지/후보 판정 권장', inputPerM: 0, outputPerM: 0 },
      { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite',  desc: '저비용 대량 처리 · 고속', inputPerM: 0, outputPerM: 0 },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', desc: '고성능 추론/전략 · Preview', inputPerM: 0, outputPerM: 0 },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', desc: '멀티모달/에이전트 실험용 · Preview', inputPerM: 0, outputPerM: 0 },
    ],
  },
  openai: {
    label: 'OpenAI ChatGPT',
    icon: '◆',
    color: '#10a37f',
    vision: true,
    models: [
      { id: 'gpt-5.4-mini',   label: 'GPT-5.4 mini',   desc: '가성비(기본추천) · 실무 전반',      inputPerM: 0.75,  outputPerM: 4.50  },
      { id: 'gpt-5.4',        label: 'GPT-5.4',        desc: '최고성능 · 복잡한 추론/전략',      inputPerM: 2.50,  outputPerM: 15.00 },
      { id: 'gpt-5.4-nano',   label: 'GPT-5.4 nano',   desc: '최저비용 · 무료티어/대량 처리용',   inputPerM: 0.20,  outputPerM: 1.25  },
      { id: 'gpt-5.3-codex',  label: 'GPT-5.3-Codex',  desc: '코딩특화 · 에이전틱 생성',         inputPerM: 1.75,  outputPerM: 14.00 },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', desc: '초저비용 · 1M 컨텍스트',    inputPerM: 0.10,  outputPerM: 0.40  },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', desc: '저비용 · 1M 컨텍스트',      inputPerM: 0.40,  outputPerM: 1.60  },
      { id: 'gpt-4o-mini',  label: 'GPT-4o mini',  desc: '빠름 · 멀티모달',           inputPerM: 0.15,  outputPerM: 0.60  },
    ],
  },
  // 로컬 Ollama. 상세페이지 작업은 이미지 판독이 필수라 vision 지원 모델만 등록한다.
  // (gemma4-26b·gemma:latest·mistral-small 은 vision 미지원이라 제외)
  ollama: {
    label: '로컬 Ollama',
    icon: '▣',
    color: '#f59e0b',
    local: true,
    vision: true,
    models: [
      { id: 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL', label: 'Qwen3.8 27B · 판독 정확', desc: '로컬 vision · 실측 34초 · 이미지 내용을 가장 정확히 읽음(권장)', inputPerM: 0, outputPerM: 0 },
      { id: 'gemma4:e4b',   label: 'Gemma4 e4b · 빠름', desc: '로컬 vision · 실측 27초 · 빠르지만 판독이 일반론으로 흐를 수 있음', inputPerM: 0, outputPerM: 0 },
    ],
  },
  // API Hub 의 Claude OAuth 브리지(claude-subscription-oauth).
  // Claude.ai 구독 로그인을 Claude Code CLI 로 호출한다. API 키를 쓰지 않는다.
  // 브리지가 프롬프트 텍스트만 받으므로 이미지 판독·생성은 지원하지 않는다.
  claude_oauth: {
    label: 'Claude 구독 로그인 OAuth',
    icon: '✳',
    color: '#d97757',
    vision: false,
    imageGeneration: false,
    models: [
      { id: 'claude-opus-5',   label: 'Claude Opus 5 · 권장',  desc: '기본값. 1M 컨텍스트, 대부분의 작업에 적합한 플래그십.', inputPerM: 0, outputPerM: 0 },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5',       desc: '가볍고 빠른 통로. 단순 분류·추출에 적합.',              inputPerM: 0, outputPerM: 0 },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5',     desc: '가장 빠르고 저렴. 200K 컨텍스트.',                      inputPerM: 0, outputPerM: 0 },
      { id: 'claude-fable-5',  label: 'Claude Fable 5',        desc: '가장 어려운 추론·장기 작업용. 느리고 비용이 높다.',      inputPerM: 0, outputPerM: 0 },
    ],
  },
};

// API Hub 브리지가 요구하는 노력 단계. 모델 설정 UI 는 5개를 모두 노출해야 한다.
const CLAUDE_OAUTH_EFFORTS = [
  { id: 'low',    label: '낮음/빠름',   desc: '단순 조회 기본값' },
  { id: 'medium', label: '보통',        desc: '애매한 질문을 더 꼼꼼히 판단' },
  { id: 'high',   label: '높음/깊게',   desc: '기본 권장. 품질과 비용의 균형점' },
  { id: 'xhigh',  label: '매우 높음',   desc: '코딩·에이전트 작업에 가장 적합' },
  { id: 'max',    label: '최대',        desc: '비용보다 정확도가 중요할 때' },
];

const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

const GPT_OAUTH_API_BASE = 'http://127.0.0.1:4321';
const GPT_OAUTH_REASONING_EFFORTS = [
  { id: 'low', label: '빠름', desc: '빠른 초안·API 검색 기본값' },
  { id: 'medium', label: '보통', desc: '일반 상세페이지 작업' },
  { id: 'high', label: '깊게', desc: '복잡한 비교·전략·실패 원인 분석' },
  { id: 'xhigh', label: '매우 깊게', desc: '느리지만 가장 꼼꼼한 검토' },
];
const GPT_OAUTH_SERVICE_TIERS = [
  { id: 'standard', label: '표준', desc: '권장 기본값' },
  { id: 'fast', label: '고속', desc: '검증됨 · 사용량이 더 들 수 있음' },
  { id: 'flex', label: 'Flex', desc: 'GPT-5.6 권한·워크스페이스에 따라 거부될 수 있음' },
];
const GPT_OAUTH_EXECUTION_PRESETS = [
  { id: 'quick-coding', label: '빠른 일처리', description: '짧은 수정·API 연결', model: 'gpt-5.3-codex-spark', reasoningEffort: 'low', serviceTier: 'fast', timeoutMs: 120000 },
  { id: 'balanced', label: '표준 검토', description: '일반 추론·구현 검토', model: 'gpt-5.6-sol', reasoningEffort: 'medium', serviceTier: 'standard', timeoutMs: 120000 },
  { id: 'deep-review', label: '깊은 추론', description: '복잡한 설계·실패 원인 분석', model: 'gpt-5.6-sol', reasoningEffort: 'high', serviceTier: 'standard', timeoutMs: 180000 },
];

function includeCurrentGptOAuthModelOption(modelOptions = [], currentModelId = '') {
  const options = Array.isArray(modelOptions) ? modelOptions.filter(item => item?.id) : [];
  const modelId = String(currentModelId || '').trim();
  if (!modelId || options.some(item => item.id === modelId)) return options;
  const known = (LLM_PROVIDERS.gpt_oauth?.models || []).find(item => item.id === modelId);
  return [known || { id: modelId, label: modelId }, ...options];
}

function normalizeGptOAuthOptions(raw = {}) {
  const modelOptions = Array.isArray(raw.modelOptions) && raw.modelOptions.length
    ? raw.modelOptions.filter(item => item?.id).map(item => ({ ...item, label: item.label || item.id }))
    : LLM_PROVIDERS.gpt_oauth.models;
  const reasoningOptions = Array.isArray(raw.reasoningOptions) && raw.reasoningOptions.length
    ? raw.reasoningOptions.filter(item => item?.id).map(item => ({ ...item, label: item.label || item.id }))
    : GPT_OAUTH_REASONING_EFFORTS;
  const serviceTierOptions = Array.isArray(raw.serviceTierOptions) && raw.serviceTierOptions.length
    ? raw.serviceTierOptions.filter(item => item?.id).map(item => ({ ...item, label: item.label || item.id }))
    : GPT_OAUTH_SERVICE_TIERS;
  const executionPresets = Array.isArray(raw.executionPresets) && raw.executionPresets.length
    ? raw.executionPresets.filter(item => item?.id && item.model).map(item => ({ ...item, label: item.label || item.id }))
    : GPT_OAUTH_EXECUTION_PRESETS;
  return {
    modelOptions,
    reasoningOptions,
    serviceTierOptions,
    executionPresets,
    defaults: raw.defaults || { model: 'gpt-5.6-sol', reasoningEffort: 'low', serviceTier: 'standard' },
  };
}

function getGptOAuthUiOptions() {
  return normalizeGptOAuthOptions(state?.gptOAuthOptions || {});
}

function applyGptOAuthPreset(presetId) {
  const preset = getGptOAuthUiOptions().executionPresets.find(item => item.id === presetId);
  if (!preset || !state) return false;
  state.modelConfig = normalizeModelConfig({
    ...state.modelConfig,
    llmProvider: 'gpt_oauth',
    llmModel: preset.model,
    gptOAuthReasoningEffort: preset.reasoningEffort,
    gptOAuthServiceTier: preset.serviceTier,
    gptOAuthTimeoutMs: Number(preset.timeoutMs) || 120000,
  });
  state.gptOAuthProbe = null;
  saveModelConfig(state.modelConfig);
  return true;
}

function normalizeGptOAuthReasoningEffort(value) {
  return GPT_OAUTH_REASONING_EFFORTS.some(item => item.id === value) ? value : 'low';
}

function normalizeGptOAuthServiceTier(value, modelId = null) {
  const policy = typeof gptOAuthModelTierPolicy === 'function'
    ? gptOAuthModelTierPolicy(modelId || state?.modelConfig?.llmModel || '')
    : { allowFast: true, allowFlex: true };
  let tier = GPT_OAUTH_SERVICE_TIERS.some(item => item.id === value) ? value : 'standard';
  if (!policy.allowFast && tier === 'fast') tier = 'standard';
  if (!policy.allowFlex && tier === 'flex') tier = 'standard';
  return tier;
}

// 이미지 생성 모델 목록 (OpenAI + Gemini)
const IMAGE_MODELS = [
  { id: 'api-hub-openai-image', label: 'OpenAI 이미지 생성 (API Hub)', desc: 'API Hub에 저장된 OpenAI 연결 사용', inputPerM: 0, imageInputPerM: 0, outputPerM: 0, imageOut: 0, provider: 'api_hub_openai' },
  { id: 'gpt-image-2', label: 'OpenAI GPT Image 2', desc: 'OpenAI latest image generation/editing model', inputPerM: 5.00, imageInputPerM: 8.00, outputPerM: 30.00, imageOut: 0, provider: 'openai' },
  { id: 'gpt-image-1.5', label: 'OpenAI GPT Image 1.5', desc: 'High-quality OpenAI image model', inputPerM: 5.00, imageInputPerM: 8.00, outputPerM: 32.00, textOutputPerM: 10.00, imageOut: 0, provider: 'openai' },
  { id: 'gpt-image-1', label: 'OpenAI GPT Image 1', desc: 'Stable OpenAI image generation/editing model', inputPerM: 5.00, imageInputPerM: 10.00, outputPerM: 40.00, imageOut: 0, provider: 'openai' },
  { id: 'gpt-image-1-mini', label: 'OpenAI GPT Image 1 mini', desc: 'Cost-efficient OpenAI image model', inputPerM: 2.00, imageInputPerM: 2.50, outputPerM: 8.00, imageOut: 0, provider: 'openai' },
  { id: 'gemini-3.1-flash-image',       label: '나노바나나2 (Gemini 3.1 Flash Image)', desc: '빠름 · 기본값',  inputPerM: 0,  outputPerM: 0,  imageOut: 0  },
  { id: 'gemini-3.1-flash-image-preview',       label: '나노바나나2 Preview (Gemini 3.1 Flash Image)', desc: 'Preview 호환용',  inputPerM: 0.10,  outputPerM: 0.40,  imageOut: 0.02  },
  { id: 'gemini-3-pro-image-preview',       label: 'Gemini 3 Pro Image Preview', desc: '최고품질',  inputPerM: 3.50,  outputPerM: 10.50, imageOut: 0.039 },
];

// 설정 저장/불러오기
// 사용량 한도로 기본 provider 가 막혔을 때 자동으로 넘어갈 폴백 대상.
// 기본 실행 provider 는 gpt_oauth 로 유지하고, 폴백만 사용자가 지정한다.
const LLM_FALLBACK_PROVIDERS = ['none', 'claude_oauth', 'openai', 'ollama'];
// 지정한 폴백이 요청 메서드를 못 하면 이 순서로 다음 후보를 찾는다.
const LLM_FALLBACK_PRIORITY = ['claude_oauth', 'openai', 'ollama'];
const LLM_VISION_METHODS = ['analyzeImage', 'analyzeCompetitorImages'];
const LLM_IMAGE_GEN_METHODS = ['generateImage'];

function providerSupportsLlmMethod(providerId, method) {
  const provider = LLM_PROVIDERS[providerId];
  if (!provider) return false;
  if (LLM_IMAGE_GEN_METHODS.includes(method)) return provider.imageGeneration !== false;
  if (LLM_VISION_METHODS.includes(method)) return provider.vision !== false;
  return true;
}

function normalizeLlmFallbackConfig(c) {
  // 기본 폴백은 Claude 구독 로그인 OAuth. 구독을 쓰므로 추가 비용이 없다.
  // 다만 이미지 판독은 지원하지 않아, vision 이 필요한 호출에서는
  // providerSupportsLlmMethod 가 자동으로 다음 후보(OpenAI / Ollama)로 넘긴다.
  const provider = LLM_FALLBACK_PROVIDERS.includes(c.fallbackProvider) ? c.fallbackProvider : 'claude_oauth';
  c.fallbackProvider = provider;
  c.fallbackEnabled = c.fallbackEnabled !== false && provider !== 'none';
  const allowed = (LLM_PROVIDERS[provider]?.models || []).map(m => m.id);
  if (provider === 'none') {
    c.fallbackModel = '';
  } else if (!allowed.includes(c.fallbackModel)) {
    c.fallbackModel = allowed[0] || '';
  }
  const base = String(c.ollamaBaseUrl || '').trim().replace(/\/+$/, '');
  c.ollamaBaseUrl = base || OLLAMA_DEFAULT_BASE_URL;
  c.claudeOAuthEffort = normalizeClaudeOAuthEffort(c.claudeOAuthEffort);
  return c;
}

function normalizeModelConfig(cfg) {
  const c = { ...(cfg || {}) };
  const provider = ['gpt_oauth', 'gemini', 'openai', 'ollama', 'claude_oauth'].includes(c.llmProvider) ? c.llmProvider : 'gpt_oauth';
  c.llmProvider = provider;
  normalizeLlmFallbackConfig(c);

  const allowedLlm = (LLM_PROVIDERS[provider]?.models || []).map(m => m.id);
  if (!allowedLlm.includes(c.llmModel)) c.llmModel = allowedLlm[0] || (provider === 'gemini' ? 'gemini-3.5-flash' : 'gpt-5.6-sol');
  c.gptOAuthReasoningEffort = normalizeGptOAuthReasoningEffort(c.gptOAuthReasoningEffort || c.reasoningEffort);
  c.gptOAuthServiceTier = normalizeGptOAuthServiceTier(c.gptOAuthServiceTier || c.serviceTier, c.llmModel);

  const legacyImageModelMap = {
    'gemini-2.5-flash-image': 'gemini-3.1-flash-image',
  };
  if (legacyImageModelMap[c.imageModel]) c.imageModel = legacyImageModelMap[c.imageModel];
  const allowedImg = IMAGE_MODELS.map(m => m.id);
  if (!allowedImg.includes(c.imageModel)) c.imageModel = allowedImg[0] || 'gemini-3.1-flash-image';

  c.imageSizeMode = c.imageSizeMode === 'custom' ? 'custom' : 'auto';
  const w = Number.parseInt(c.imageWidth, 10);
  c.imageWidth = Number.isFinite(w) ? Math.max(64, Math.min(4096, w)) : 860;
  if (c.imageHeight == null || c.imageHeight === '') {
    c.imageHeight = null;
  } else {
    const h = Number.parseInt(c.imageHeight, 10);
    c.imageHeight = Number.isFinite(h) ? Math.max(64, Math.min(4096, h)) : null;
  }
  c.openaiKey = String(c.openaiKey || '').trim();
  return c;
}

function saveModelConfig(cfg) {
  try {
    const normalized = normalizeModelConfig(cfg);
    normalized.openaiKey = '';
    delete normalized.openaiApiKey;
    localStorage.setItem('model_config', JSON.stringify(normalized));
  } catch(e) {}
}
function loadModelConfig() {
  try {
    const raw = localStorage.getItem('model_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrationKey = 'model_config_gpt56_default_migrated';
      if (parsed.llmProvider === 'gpt_oauth' && parsed.llmModel === 'gpt-5.5' && localStorage.getItem(migrationKey) !== '1') {
        parsed.llmModel = 'gpt-5.6-sol';
        localStorage.setItem(migrationKey, '1');
      }
      return normalizeModelConfig(parsed);
    }
  } catch(e) {}
  return normalizeModelConfig({
    llmProvider: 'gpt_oauth',
    llmModel: 'gpt-5.6-sol',
    gptOAuthReasoningEffort: 'low',
    gptOAuthServiceTier: 'standard',
    imageModel: 'gemini-3.1-flash-image',
    openaiKey: '',
    imageSizeMode: 'auto',   // 'auto' | 'custom'
    imageWidth: 860,          // px (custom 모드 시 사용)
    imageHeight: null,        // px or null (null = 비율 자동 유지)
  });
}
const OPENAI_KEY_STORAGE_KEY = 'pdp_openai_api_key';
const OPENAI_KEY_LEGACY_STORAGE_KEYS = ['openai_api_key', 'openaiKey', 'OPENAI_API_KEY'];

function saveOpenAIKey(key) {
  const value = String(key || '').trim();
  if (!value) return;
  try {
    localStorage.setItem(OPENAI_KEY_STORAGE_KEY, value);
    OPENAI_KEY_LEGACY_STORAGE_KEYS.forEach(storageKey => localStorage.removeItem(storageKey));
    const cfg = normalizeModelConfig(JSON.parse(localStorage.getItem('model_config') || '{}'));
    cfg.openaiKey = '';
    delete cfg.openaiApiKey;
    localStorage.setItem('model_config', JSON.stringify(cfg));
  } catch(e) {}
}

function loadOpenAIKey() {
  try {
    const current = String(localStorage.getItem(OPENAI_KEY_STORAGE_KEY) || '').trim();
    if (current) return current;
    for (const storageKey of OPENAI_KEY_LEGACY_STORAGE_KEYS) {
      const value = String(localStorage.getItem(storageKey) || '').trim();
      if (value) {
        saveOpenAIKey(value);
        return value;
      }
    }
    const cfg = JSON.parse(localStorage.getItem('model_config') || '{}');
    const migrated = String(cfg.openaiKey || cfg.openaiApiKey || '').trim();
    if (migrated) saveOpenAIKey(migrated);
    return migrated;
  } catch(e) {
    return '';
  }
}

function getRuntimeOpenAIKey() {
  try {
    if (state?.openaiKey) return state.openaiKey;
    const stored = loadOpenAIKey();
    if (stored && state) state.openaiKey = stored;
    return stored;
  } catch(e) {
    return loadOpenAIKey();
  }
}

// ════════════════════════════════════════════════════════════════
// TOKEN / COST TRACKER
// ════════════════════════════════════════════════════════════════
// 가격표를 동적으로 구성 (LLM_PROVIDERS + IMAGE_MODELS 기반)
function buildModelPricing() {
  const pricing = {};
  for (const prov of Object.values(LLM_PROVIDERS)) {
    for (const m of prov.models) {
      pricing[m.id] = { inputPerM: m.inputPerM, outputPerM: m.outputPerM, label: m.label, type: 'text' };
    }
  }
  for (const m of IMAGE_MODELS) {
    pricing[m.id] = { inputPerM: m.inputPerM, outputPerM: m.outputPerM, imageOut: m.imageOut, label: m.label, type: 'image' };
  }
  return pricing;
}
const MODEL_PRICING = buildModelPricing();

function getImageModelMeta(modelId = null) {
  const id = modelId || getImageModel();
  return IMAGE_MODELS.find(m => m.id === id) || null;
}

function getImageProvider(modelId = null) {
  const meta = getImageModelMeta(modelId);
  if (meta?.provider) return meta.provider;
  return (modelId || getImageModel()).startsWith('gpt-image') ? 'openai' : 'gemini';
}

function isOpenAIImageModel(modelId = null) {
  return ['openai', 'api_hub_openai'].includes(getImageProvider(modelId));
}

function hasImageConnection(modelId = null) {
  if (getImageProvider(modelId) === 'api_hub_openai') return true;
  return isOpenAIImageModel(modelId) ? !!getRuntimeOpenAIKey() : hasGeminiConnection();
}

function createImageClient(modelId = null) {
  const imgModel = modelId || getImageModel();
  if (getImageProvider(imgModel) === 'api_hub_openai') return new ApiHubOpenAIImageAPI();
  if (isOpenAIImageModel(imgModel)) {
    const openaiKey = getRuntimeOpenAIKey();
    if (!openaiKey) throw new Error('OpenAI image API 키가 설정되지 않았습니다.');
    return new OpenAIAPI(openaiKey, state.modelConfig.llmModel);
  }
  return createGeminiClient(state.modelConfig.llmModel);
}

function clampOpenAIImageSize(modelId, width, height) {
  if (!width) return 'auto';
  if (modelId === 'gpt-image-2') {
    const w = Math.max(256, Math.min(3840, width));
    const h = Math.max(256, Math.min(3840, height || width));
    return `${w}x${h}`;
  }
  const presets = [
    { id: '1024x1024', w: 1024, h: 1024 },
    { id: '1536x1024', w: 1536, h: 1024 },
    { id: '1024x1536', w: 1024, h: 1536 },
  ];
  const targetW = width;
  const targetH = height || width;
  const targetRatio = targetW / targetH;
  return presets
    .map(p => ({ ...p, score: Math.abs((p.w / p.h) - targetRatio) + Math.abs(p.w - targetW) / 2048 + Math.abs(p.h - targetH) / 2048 }))
    .sort((a, b) => a.score - b.score)[0].id;
}

function getRequestedImageSize(modelId = null) {
  const cfg = state.modelConfig || {};
  if (cfg.imageSizeMode !== 'custom' || !cfg.imageWidth) return 'auto';
  return clampOpenAIImageSize(modelId || getImageModel(), cfg.imageWidth, cfg.imageHeight || null);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl || '').split(',');
  const declaredMime = /data:([^;]+)/.exec(header || '')?.[1] || 'application/octet-stream';
  const mime = /^image\//i.test(declaredMime) && typeof inferImageMimeFromBase64 === 'function'
    ? inferImageMimeFromBase64(base64 || '', declaredMime)
    : declaredMime;
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function imageBase64Only(value = '') {
  const raw = String(value || '').trim();
  const match = /^data:(image\/[^;,]+);base64,(.+)$/i.exec(raw);
  return (match?.[2] || raw).replace(/\s+/g, '');
}

function inferImageMimeFromBase64(value = '', fallback = 'image/png') {
  const raw = String(value || '').trim();
  const match = /^data:(image\/[^;,]+);base64,(.+)$/i.exec(raw);
  const declared = match?.[1] || '';
  const compact = imageBase64Only(match?.[2] || raw);
  const head = compact.slice(0, 24);
  if (/^\/9j\//.test(head)) return 'image/jpeg';
  if (/^iVBORw0KGgo/i.test(head)) return 'image/png';
  if (/^R0lGOD/i.test(head)) return 'image/gif';
  if (/^UklGR/i.test(head)) return 'image/webp';
  const safe = String(declared || fallback || 'image/png').toLowerCase();
  if (safe === 'image/jpg') return 'image/jpeg';
  return /^image\//.test(safe) ? safe : 'image/png';
}

function normalizeImagePayloadForApi(base64 = '', mime = 'image/png') {
  const cleanBase64 = imageBase64Only(base64);
  return {
    base64: cleanBase64,
    mime: inferImageMimeFromBase64(base64, mime || 'image/png'),
  };
}

function gptOAuthVisionImageScale(width, height, options = {}) {
  const sourceWidth = Math.max(1, Math.round(Number(width) || 0));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 0));
  const maxDimension = Math.max(1024, Number(options.maxDimension) || 16000);
  const maxPixels = Math.max(1_000_000, Number(options.maxPixels) || 18_000_000);
  const dimensionScale = maxDimension / Math.max(sourceWidth, sourceHeight);
  const pixelScale = Math.sqrt(maxPixels / (sourceWidth * sourceHeight));
  const scale = Math.min(1, dimensionScale, pixelScale);
  const widthResult = Math.max(1, Math.round(sourceWidth * scale));
  const heightResult = Math.max(1, Math.round(sourceHeight * scale));
  return {
    width: widthResult,
    height: heightResult,
    changed: widthResult !== sourceWidth || heightResult !== sourceHeight,
  };
}

async function compactGptOAuthVisionImage(img, index = 0, options = {}) {
  if (!img?.base64 || typeof Image !== 'function' || typeof document === 'undefined') return img;
  const normalized = normalizeImagePayloadForApi(img.base64, img.mime || img.mimeType || 'image/png');
  if (!normalized.base64) return img;
  const dataUrl = `data:${normalized.mime};base64,${normalized.base64}`;
  const dimensions = await new Promise(resolve => {
    const image = new Image();
    const timeoutId = setTimeout(() => resolve(null), 10000);
    image.onload = () => {
      clearTimeout(timeoutId);
      resolve({
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
      });
    };
    image.onerror = () => {
      clearTimeout(timeoutId);
      resolve(null);
    };
    image.src = dataUrl;
  });
  if (!dimensions?.width || !dimensions.height) return img;
  const target = gptOAuthVisionImageScale(dimensions.width, dimensions.height, options);
  if (!target.changed) return img;
  try {
    const resizedDataUrl = await resizeImageDataUrl(dataUrl, target.width, target.height, {
      mime: options.outputMime || 'image/png',
      quality: options.quality,
    });
    const resized = normalizeImagePayloadForApi(resizedDataUrl, options.outputMime || 'image/png');
    if (!resized.base64) return img;
    return {
      ...img,
      base64: resized.base64,
      mime: resized.mime,
      analysisResize: {
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        width: target.width,
        height: target.height,
        index,
      },
    };
  } catch(_) {
    return img;
  }
}

async function prepareGptOAuthVisionImages(imagesArray, options = {}) {
  const items = Array.isArray(imagesArray) ? imagesArray.slice(0, 8) : [];
  const prepared = [];
  for (let i = 0; i < items.length; i++) {
    prepared.push(await compactGptOAuthVisionImage(items[i], i, options));
  }
  return prepared;
}

function imageSourceToPngDataUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!String(src || '').startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch(e) {
        reject(new Error('이미지를 편집용 PNG로 변환하지 못했습니다. 원본이 외부 URL이면 CORS 제한일 수 있습니다.'));
      }
    };
    img.onerror = () => reject(new Error('편집할 이미지를 불러오지 못했습니다.'));
    img.src = src;
  });
}

function maskCanvasHasPaint(canvas) {
  if (!canvas) return false;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) return true;
  }
  return false;
}

function buildTransparentEditMaskDataUrl(maskCanvas) {
  const out = document.createElement('canvas');
  out.width = maskCanvas.width;
  out.height = maskCanvas.height;
  const outCtx = out.getContext('2d', { willReadFrequently: true });
  outCtx.fillStyle = 'rgba(255,255,255,1)';
  outCtx.fillRect(0, 0, out.width, out.height);
  const source = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  const img = outCtx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < source.length; i += 4) {
    img.data[i] = 255;
    img.data[i + 1] = 255;
    img.data[i + 2] = 255;
    img.data[i + 3] = source[i + 3] > 8 ? 0 : 255;
  }
  outCtx.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

function calcOpenAIImageCost(modelId, usage) {
  const meta = getImageModelMeta(modelId);
  if (!meta || !usage) return null;
  const rawInputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const rawOutputTokens = usage.output_tokens || usage.image_tokens || 0;
  const inputTextTokens = usage.input_tokens_details?.text_tokens || usage.prompt_tokens_details?.text_tokens || usage.input_text_tokens || rawInputTokens;
  const inputImageTokens = usage.input_tokens_details?.image_tokens || usage.prompt_tokens_details?.image_tokens || usage.input_image_tokens || 0;
  const outputImageTokens = usage.output_tokens_details?.image_tokens || usage.output_image_tokens || rawOutputTokens;
  const outputTextTokens = usage.output_tokens_details?.text_tokens || usage.output_text_tokens || 0;
  let cost = 0;
  cost += (inputTextTokens / 1_000_000) * (meta.inputPerM || 0);
  cost += (inputImageTokens / 1_000_000) * (meta.imageInputPerM || meta.inputPerM || 0);
  cost += (outputImageTokens / 1_000_000) * (meta.outputPerM || 0);
  cost += (outputTextTokens / 1_000_000) * (meta.textOutputPerM || 0);
  return cost;
}

const tokenTracker = {
  sessions: {},      // modelId → { inputTokens, outputTokens, calls, imageCount, costUSD }
  callHistory: [],   // [{ts, model, label, provider, inputTokens, outputTokens, costUSD, op}]
  sessionStart: Date.now(),
  activeTab: 'stats',
  showDetail: false,
  bottomSafeAreaObserver: null,

  record(modelId, inputTokens, outputTokens, isImage = false, op = '', meta = null) {
    if (!this.sessions[modelId]) {
      this.sessions[modelId] = { inputTokens: 0, outputTokens: 0, calls: 0, imageCount: 0, costUSD: 0 };
    }
    const s = this.sessions[modelId];
    s.inputTokens  += inputTokens  || 0;
    s.outputTokens += outputTokens || 0;
    s.calls++;
    if (isImage) s.imageCount++;

    const p = MODEL_PRICING[modelId];
    // 이번 호출 단건 비용
    let callCost = 0;
    if (meta && Number.isFinite(meta.costUSD)) {
      callCost = meta.costUSD;
    } else if (p) {
      callCost  = ((inputTokens  || 0) / 1_000_000) * p.inputPerM;
      callCost += ((outputTokens || 0) / 1_000_000) * p.outputPerM;
      if (isImage && p.imageOut) callCost += p.imageOut;
    }
    s.costUSD = (s.costUSD || 0) + callCost;

    const provider = modelId.startsWith('gemini') ? 'Gemini' : 'OpenAI';
    this.callHistory.push({
      ts: Date.now(),
      model: modelId,
      label: p?.label || modelId,
      provider,
      inputTokens:  inputTokens  || 0,
      outputTokens: outputTokens || 0,
      costUSD: callCost,
      op: op || (isImage ? '이미지생성' : '텍스트'),
    });
    if (this.callHistory.length > 200) this.callHistory.shift();

    this.save();
    this.renderBar();
  },

  totals() {
    let totalIn = 0, totalOut = 0, totalCost = 0, totalCalls = 0;
    for (const s of Object.values(this.sessions)) {
      totalIn    += s.inputTokens;
      totalOut   += s.outputTokens;
      totalCost  += s.costUSD;
      totalCalls += s.calls;
    }
    return { totalIn, totalOut, totalCost, totalCalls };
  },

  sessionTotals() {
    let sIn = 0, sOut = 0, sCost = 0, sCalls = 0, gCost = 0, oCost = 0;
    for (const h of this.callHistory) {
      if (h.ts >= this.sessionStart) {
        sIn    += h.inputTokens;
        sOut   += h.outputTokens;
        sCost  += h.costUSD;
        sCalls++;
        if (h.provider === 'Gemini') gCost += h.costUSD;
        else oCost += h.costUSD;
      }
    }
    return { sIn, sOut, sCost, sCalls, gCost, oCost };
  },

  save() {
    try {
      localStorage.setItem('token_tracker', JSON.stringify(this.sessions));
      localStorage.setItem('token_history', JSON.stringify(this.callHistory.slice(-100)));
    } catch(e) {}
  },

  load() {
    try {
      const raw = localStorage.getItem('token_tracker');
      if (raw) this.sessions = JSON.parse(raw);
      const hist = localStorage.getItem('token_history');
      if (hist) this.callHistory = JSON.parse(hist);
    } catch(e) {}
  },

  reset() {
    this.sessions = {};
    this.callHistory = [];
    this.sessionStart = Date.now();
    try {
      localStorage.removeItem('token_tracker');
      localStorage.removeItem('token_history');
    } catch(e) {}
    this.renderBar();
  },

  renderBar() {
    let bar = document.getElementById('tokenBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tokenBar';
      bar.className = 'token-bar';
      document.body.appendChild(bar);
    }

    const { totalCost } = this.totals();
    const { sIn, sOut, sCost, sCalls, gCost, oCost } = this.sessionTotals();
    const fmtN   = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n);
    const fmtUSD = d => d < 0.0001 ? '$0.0000' : '$' + d.toFixed(4);
    const fmtKRW = d => '≈₩' + Math.round(d * 1380).toLocaleString();

    const lastCall = this.callHistory[this.callHistory.length - 1];
    const lastLabel = lastCall?.label || '-';
    const lastOp    = lastCall?.op    || '';
    const isImg = lastCall && MODEL_PRICING[lastCall.model]?.type === 'image';
    const hasCumul = totalCost > 0 && Math.abs(sCost - totalCost) > 0.00005;

    bar.innerHTML = `
      <span class="tb-label">💰 세션비용</span>
      <span class="tb-cost tb-animate" id="tbCostSession">${fmtUSD(sCost)}</span>
      <span style="color:var(--warn);font-family:monospace;font-size:10px;font-weight:700">${fmtKRW(sCost)}</span>
      ${hasCumul ? `<span class="sep">│</span><span class="tb-label">누적</span><span class="tb-cost" style="opacity:.55">${fmtUSD(totalCost)}</span>` : ''}
      ${gCost > 0.00001 ? `<span class="tb-provider g-badge" title="Gemini">G ${fmtUSD(gCost)}</span>` : ''}
      ${oCost > 0.00001 ? `<span class="tb-provider o-badge" title="OpenAI">O ${fmtUSD(oCost)}</span>` : ''}
      <span class="sep">│</span>
      <span class="tb-label">토큰</span>
      <span class="tb-val">${fmtN(sIn)}↑ ${fmtN(sOut)}↓</span>
      <span class="sep">│</span>
      <span class="tb-label">호출</span>
      <span class="tb-val">${sCalls}회</span>
      ${lastCall ? `
        <span class="sep">│</span>
        ${lastOp ? `<span class="tb-op-badge">${lastOp}</span>` : ''}
        <span class="tb-model ${isImg?'m-img':'m-flash'}">${lastLabel}</span>
        <span class="tb-call-cost">+${fmtUSD(lastCall.costUSD)}</span>
      ` : ''}
      <span class="sep">│</span>
      <button class="token-detail-btn" id="tbDetailBtn">내역 ▲</button>
      <button class="tb-reset" id="tbResetBtn">초기화</button>
    `;

    const syncBottomSafeArea = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height || bar.offsetHeight || 31);
      document.documentElement.style.setProperty('--token-bar-height', `${height}px`);
    };
    syncBottomSafeArea();
    if (!this.bottomSafeAreaObserver && typeof ResizeObserver === 'function') {
      this.bottomSafeAreaObserver = new ResizeObserver(syncBottomSafeArea);
      this.bottomSafeAreaObserver.observe(bar);
    }

    // 신규 호출 시 flash
    const el = document.getElementById('tbCostSession');
    if (el && sCalls > 0) { el.classList.remove('tb-animate'); void el.offsetWidth; el.classList.add('tb-animate'); }

    document.getElementById('tbDetailBtn')?.addEventListener('click', () => {
      this.showDetail = !this.showDetail;
      this.renderDetail();
    });
    document.getElementById('tbResetBtn')?.addEventListener('click', () => {
      if (confirm('토큰 사용 기록을 초기화할까요?')) this.reset();
    });
  },

  renderDetail() {
    let modal = document.getElementById('tokenModal');
    if (!this.showDetail) { modal?.remove(); return; }

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tokenModal';
      modal.className = 'token-modal';
      document.body.appendChild(modal);
    }

    const fmtUSD = d => '$' + d.toFixed(5);
    const fmtKRW = d => '₩' + Math.round(d * 1380).toLocaleString();
    const fmtN   = n => n.toLocaleString();

    // 모델별 통계 탭
    let rows = '';
    for (const [modelId, s] of Object.entries(this.sessions)) {
      const p   = MODEL_PRICING[modelId];
      const lbl = p?.label || modelId;
      const typ = p?.type  || 'text';
      rows += `
        <div class="token-row">
          <div>
            <div style="font-weight:600">${lbl}</div>
            <div class="model-name">${modelId}</div>
          </div>
          <div style="text-align:right;font-size:11px;line-height:1.8">
            <div>입력 <b>${fmtN(s.inputTokens)}</b> tok</div>
            <div>출력 <b>${fmtN(s.outputTokens)}</b> tok</div>
            ${typ==='image' ? `<div>이미지 <b>${s.imageCount}</b>장</div>` : ''}
            <div>호출 <b>${s.calls}</b>회</div>
            <div style="color:var(--ok);font-weight:700">${fmtUSD(s.costUSD)} ${fmtKRW(s.costUSD)}</div>
          </div>
        </div>`;
    }

    // 호출 이력 탭 (최신 50건)
    const recent = [...this.callHistory].reverse().slice(0, 50);
    let histRows = '';
    for (const h of recent) {
      const t = new Date(h.ts);
      const timeStr = t.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
      const isSess  = h.ts >= this.sessionStart;
      histRows += `
        <tr class="${isSess ? 'hist-session' : 'hist-old'}">
          <td>${timeStr}</td>
          <td><span class="hist-op">${h.op||'-'}</span></td>
          <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h.label}">${h.label}</td>
          <td style="font-family:monospace">${fmtN(h.inputTokens)}</td>
          <td style="font-family:monospace">${fmtN(h.outputTokens)}</td>
          <td style="color:var(--ok);font-weight:600;font-family:monospace">${fmtUSD(h.costUSD)}</td>
        </tr>`;
    }

    const { totalCost } = this.totals();
    const { sCost, sCalls } = this.sessionTotals();
    const tab = this.activeTab;

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">📊 API 사용량 실시간 추적</h3>
        <span style="cursor:pointer;font-size:18px;color:var(--text-m)" id="closeTokenModal">✕</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="token-tab-btn ${tab==='stats'?'active':''}" data-ttab="stats">모델별 통계</button>
        <button class="token-tab-btn ${tab==='history'?'active':''}" data-ttab="history">호출 이력 (${this.callHistory.length})</button>
      </div>
      ${tab === 'stats' ? `
        ${rows || '<div style="color:var(--text-m);font-size:13px;padding:16px 0">아직 API 호출 없음</div>'}
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700">
            <span>누적 총 비용</span>
            <span style="color:var(--ok)">${fmtUSD(totalCost)} (${fmtKRW(totalCost)})</span>
          </div>
          ${sCalls > 0 ? `
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;color:var(--primary-h)">
              <span>이번 세션 (${sCalls}회)</span>
              <span>${fmtUSD(sCost)} (${fmtKRW(sCost)})</span>
            </div>` : ''}
        </div>
      ` : `
        <div style="overflow-y:auto;max-height:360px">
          <table class="hist-table">
            <thead><tr>
              <th>시간</th><th>작업</th><th>모델</th><th>입력↑</th><th>출력↓</th><th>비용</th>
            </tr></thead>
            <tbody>${histRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-m);padding:20px">이력 없음</td></tr>'}</tbody>
          </table>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--text-m)">
          이번 세션(밝은 색) / 이전 세션(흐린 색) · 최근 ${this.callHistory.length}건
        </div>
      `}
      <div style="margin-top:8px;font-size:10px;color:var(--text-d)">
        * 환율 1USD = 1,380원 기준 | 공식 API 가격 기준 (변동 가능)
      </div>
    `;

    document.getElementById('closeTokenModal')?.addEventListener('click', () => {
      this.showDetail = false;
      modal.remove();
    });
    modal.querySelectorAll('[data-ttab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.ttab;
        this.renderDetail();
      });
    });
  },
};

// 앱 시작 시 저장된 사용량 복원
tokenTracker.load();

// ════════════════════════════════════════════════════════════════
// GEMINI API SERVICE
// ════════════════════════════════════════════════════════════════
const SECTION_CONTENT_PROVIDER_PROMPT_VERSION = 'section-content-provider-v1';

function buildSectionContentProviderPrompt(sectionDef, productAnalysis, customInstructions, competitorRef, options = {}) {
  const variant = options.variant === 'gpt_oauth' ? 'gpt_oauth' : 'standard';
  const activeDirectives = getEffectiveImageDirectives();
  const directiveHeading = variant === 'gpt_oauth'
    ? 'STRICT USER CONSTRAINTS:'
    : 'STRICT USER CONSTRAINTS (must be followed — override defaults):';
  const directiveBlock = activeDirectives.length > 0
    ? `\n${directiveHeading}\n${activeDirectives.map((directive, index) => `${index + 1}. ${directive}`).join('\n')}\n`
    : '';
  const brandBlock = buildBrandPromptBlock();
  const layoutBlock = buildLayoutPromptBlock();
  const responseSchema = variant === 'gpt_oauth'
    ? `  {
    "headline": "Main headline text in Korean",
    "subheadline": "Sub headline in Korean",
    "body_text": "Body copy in Korean (2-3 sentences)",
    "cta_text": "CTA text or empty string",
    "layout_suggestion": "Layout recommendation",
    "color_scheme": {"background":"#hex","text_primary":"#hex","text_secondary":"#hex","accent":"#hex"},
    "font_suggestion": {"headline_font":"Noto Sans KR","headline_size":"42px","headline_weight":"800","body_font":"Noto Sans KR","body_size":"16px"},
    "image_description": "Detailed section image direction",
    "product_placement": "How product image should be placed",
    "design_notes": "Design notes",
    "extra_elements": ["bullet or feature"]
  }`
    : `  {
    "headline": "Main headline text in Korean (impactful, short)",
    "subheadline": "Sub headline in Korean",
    "body_text": "Body copy in Korean (2-3 sentences)",
    "cta_text": "Call to action text if applicable, or empty string",
    "layout_suggestion": "Layout recommendation",
    "color_scheme": {
      "background": "#hex",
      "text_primary": "#hex",
      "text_secondary": "#hex",
      "accent": "#hex"
    },
    "font_suggestion": {
      "headline_font": "Noto Sans KR",
      "headline_size": "px value like 42px",
      "headline_weight": "700 or 900",
      "body_font": "Noto Sans KR",
      "body_size": "px value like 16px"
    },
    "image_description": "Detailed description of what the section image should look like",
    "product_placement": "Description of how the product image should be placed",
    "design_notes": "Additional design recommendations",
    "extra_elements": ["list of bullet points or features if applicable"]
  }`;
  const responseLead = variant === 'gpt_oauth' ? 'Return ONLY JSON:' : 'Return a JSON object:';
  const responseTail = variant === 'gpt_oauth' ? '' : '\nRespond ONLY with the JSON object.';

  return `You are a Korean e-commerce detail page content creator.

Section-scoped product facts:
${JSON.stringify(productAnalysis, null, 2)}
Only use the facts included above for this section. Do not pull omitted DB/Cafe24 values into the copy.

${competitorRef ? `Competitor Reference: ${competitorRef}` : ''}

Section to create: ${sectionDef.name}
Section number: ${sectionDef.n}
Section purpose: ${sectionDef.purpose}
User custom instructions: ${customInstructions || 'None'}
${directiveBlock}
${brandBlock}
${layoutBlock}
${variant === 'gpt_oauth' ? '' : 'Based on the product analysis, generate content for this section.\n'}${responseLead}
${responseSchema}${responseTail}`;
}

class GeminiAPI {
  constructor(apiKeyOrOptions, model) {
    const isObject = apiKeyOrOptions && typeof apiKeyOrOptions === 'object';
    this.apiKey = isObject ? (apiKeyOrOptions.apiKey || '') : (apiKeyOrOptions || '');
    this.model = isObject
      ? (apiKeyOrOptions.model || model || 'gemini-3.5-flash')
      : (model || 'gemini-3.5-flash');
    this.backendBaseUrl = (isObject ? apiKeyOrOptions.backendBaseUrl : '') || '';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  _normalizeBackendUrl() {
    return (this.backendBaseUrl || '').replace(/\/+$/, '');
  }

  _hasBackendRoute() {
    return !!this._normalizeBackendUrl();
  }

  async _generateContent(model, body, options = {}) {
    if (this._hasBackendRoute()) {
      const backendUrl = this._normalizeBackendUrl();
      const res = await fetch(`${backendUrl}/api/gemini/generate-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...body }),
        signal: options.signal,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
      return data;
    }

    if (!this.apiKey) {
      throw new Error('Gemini API key is required when backend URL is not set.');
    }

    const res = await fetch(`${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }

  async analyzeImage(imageBase64, mimeType, extraImages = []) {
    const prompt = buildProductImageAnalysisPrompt();
    const primary = normalizeImagePayloadForApi(imageBase64, mimeType || 'image/png');
    const refs = (extraImages || [])
      .map(img => img?.base64 ? normalizeImagePayloadForApi(img.base64, img.mime || img.mimeType || 'image/png') : null)
      .filter(img => img?.base64);

    const parts = [
      { text: prompt },
      { inline_data: { mime_type: primary.mime, data: primary.base64 } },
      // 추가 이미지 (멀티 이미지 분석)
      ...refs.map(img => ({ inline_data: { mime_type: img.mime, data: img.base64 } }))
    ];
    const body = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.12, maxOutputTokens: 4096 }
    };

    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '제품분석');
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }

  async generateSectionContent(sectionDef, productAnalysis, customInstructions, competitorRef) {
    const prompt = buildSectionContentProviderPrompt(
      sectionDef,
      productAnalysis,
      customInstructions,
      competitorRef,
      { variant: 'standard' },
    );

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    };

    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '섹션생성');
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }

  async generateImage(prompt, productImageBase64, mimeType, imageModel, extraImages = [], options = {}) {
    const imgMod = imageModel || getImageModel();
    const cfg = state.modelConfig;
    const sizeHint = options.sizeHintText || ((cfg.imageSizeMode === 'custom' && cfg.imageWidth)
      ? `Exact size: ${cfg.imageWidth}px wide${cfg.imageHeight ? ' × ' + cfg.imageHeight + 'px tall' : ''}.`
      : 'Size: 860px wide.');
    const promptIntro = options.promptIntro || 'Create a professional Korean e-commerce product detail page section image.';
    const activeDirectives = getEffectiveImageDirectives();
    const directiveStr = activeDirectives.length > 0
      ? `\n\nCRITICAL CONSTRAINTS — you MUST follow these exactly, no exceptions:\n${activeDirectives.map((d,i)=>`${i+1}. ${d}`).join('\n')}`
      : '';
    const brandBlock = buildBrandPromptBlock();
    const layoutBlock = buildLayoutPromptBlock();
    const parts = [
      { text: `${promptIntro} ${prompt} Style: clean, modern, high-end Korean shopping mall aesthetic. ${sizeHint}${directiveStr}\n${brandBlock}\n${layoutBlock}` }
    ];
    if (productImageBase64) {
      const primary = normalizeImagePayloadForApi(productImageBase64, mimeType || 'image/png');
      parts.push({ inline_data: { mime_type: primary.mime, data: primary.base64 } });
    }
    for (const img of extraImages || []) {
      if (img?.base64) {
        const ref = normalizeImagePayloadForApi(img.base64, img.mime || img.mimeType || 'image/png');
        parts.push({ inline_data: { mime_type: ref.mime, data: ref.base64 } });
      }
    }

    const body = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.8,
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          imageSize: options.outputImageSize || "1K",
          imageOutputOptions: { mimeType: options.outputMimeType || "image/jpeg" }
        }
      }
    };

    try {
      const data = await this._generateContent(imgMod, body, { signal: options.signal });
      tokenTracker.record(imgMod, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, true, '이미지생성');

      const textParts = [];
      for (const part of data.candidates?.[0]?.content?.parts || []) {
        let raw = null;
        if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
          raw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        } else if (part.inline_data && part.inline_data.mime_type?.startsWith('image/')) {
          raw = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
        } else if (typeof part.text === 'string' && part.text.trim()) {
          textParts.push(part.text.trim());
        }
        if (raw) return await applyImageSizeConfig(raw);
      }
      const reason = textParts.length
        ? `이미지 대신 텍스트 응답만 반환됨: ${textParts.join(' ').slice(0, 240)}`
        : '응답에 이미지 데이터가 없습니다.';
      throw new Error(reason);
    } catch (e) {
      console.warn('Image generation failed:', e.message);
      throw e;
    }
  }

  async searchSimilarProducts(productName, category) {
    // Use Gemini to generate competitor analysis since we can't call SerpAPI from browser
    const prompt = `You are a Korean e-commerce market analyst.
For the product "${productName}" in the category "${category}", provide competitor analysis.
Return a JSON object:
{
    "similar_products": [
        {"name": "product name", "price_range": "price", "strengths": "key strength", "detail_page_style": "description of their detail page approach"}
    ],
    "market_insights": "brief market analysis in Korean",
    "detail_page_trends": ["list of current detail page design trends for this category"],
    "recommended_approach": "recommended detail page strategy in Korean"
}
List 5-8 competitor products. Respond ONLY with JSON.`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 2048 }
    };

    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '유사상품');
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }

  async rankCafe24Candidates(context, candidates, options = {}) {
    const referenceImages = [];
    if (options.primaryImg?.base64) referenceImages.push(options.primaryImg);
    (options.extraImgs || []).forEach(img => { if (img?.base64) referenceImages.push(img); });
    const candidateImageLimit = Math.max(1, Math.min(16, Math.round(Number(options.maxCandidateImages || 16) || 16)));
    const candidateImages = Array.isArray(options.candidateImages)
      ? options.candidateImages.filter(img => img?.base64).slice(0, candidateImageLimit)
      : [];
    const parts = [
      { text: buildCafe24CandidateRankingPrompt({
        ...context,
        reference_image_count: Math.min(referenceImages.length, 5),
        candidate_image_count: candidateImages.length,
      }, candidates, 'Gemini') },
      ...referenceImages.slice(0, 5).flatMap((img, idx) => ([
        { text: `TARGET REFERENCE IMAGE ${idx + 1}` },
        {
          inline_data: {
            mime_type: img.mime || img.mimeType || 'image/png',
            data: img.base64,
          },
        },
      ])),
      ...candidateImages.flatMap((img, idx) => ([
        { text: `CAFE24 CANDIDATE IMAGE ${idx + 1}: rank=${img.rank || idx + 1}, product_no=${img.product_no || ''}, product_code=${img.product_code || ''}, product_name=${img.product_name || ''}` },
        {
          inline_data: {
            mime_type: img.mime || img.mimeType || 'image/png',
            data: img.base64,
          },
        },
      ])),
    ];
    const body = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 4096 }
    };
    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, 'Cafe24 후보 Gemini 재랭킹');
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseJsonObjectFromText(text);
  }

  // ── 경쟁사 상세페이지 분석 (이미지 스크린샷) ──────────────────
  async analyzeCompetitorImages(imagesArray) {
    // imagesArray: [{base64, mime}, ...]
    const parts = [{ text: `You are a senior Korean e-commerce detail page consultant with 15+ years of experience.
You have audited thousands of Naver Smartstore, Coupang, and brand mall detail pages.
Be brutally honest. A weak page should get 1-3 points, not 5-6. Reserve 9-10 only for truly exceptional pages.
Analyze every visible element: images, copy, layout, trust signals, CTAs, information density.
Also extract a reusable visual/style preset from the page: tone and manner, accent colors, background colors, font feeling, image direction, layout mood, repeated keywords, and phrases to avoid. This is for reference only; do not copy competitor product claims.
For every section and every scoring criterion, include visual_evidence when image input is available.
visual_evidence must identify the exact visual area that supports your judgment:
{
  "image_index": 1,
  "crop": {"x":0.00,"y":0.00,"width":1.00,"height":0.22},
  "label": "헤더/첫 화면",
  "reason": "이 영역에서 핵심 문구와 제품 이미지가 확인됨"
}
Coordinates are normalized 0-1 from the original input image. Use the tightest useful crop. If the evidence is text or a specific product/detail area, crop close enough that a human can read or inspect it. Avoid full-page, browser-chrome, admin-panel, or overly broad crops unless the criterion is explicitly about overall layout. If no visual evidence exists, use null.

Return ONLY a JSON object:
{
  "page_title": "제품/페이지 제목",
  "sections_found": [
    {
      "index": 1,
      "type": "header|hook|features|specs|scenarios|comparison|material|certification|review|size_color|promotion|shipping|faq|brand_story|cta|other",
      "headline": "감지된 헤드라인",
      "body_summary": "본문 내용 요약 (1-2문장)",
      "has_image": true,
      "estimated_purpose": "이 섹션의 마케팅 목적",
      "visual_evidence": {"image_index":1,"crop":{"x":0,"y":0,"width":1,"height":0.2},"label":"해당 섹션 근거 영역","reason":"근거 설명"}
    }
  ],
  "overall_strategy": "전체적인 판매 전략 설명 (2-3문장, 한국어)",
  "selling_strategies": ["전략1", "전략2"],
  "strengths": ["강점1", "강점2"],
  "weaknesses": ["약점1", "약점2"],
  "cta_patterns": ["CTA 패턴1"],
  "color_palette": ["#hex1", "#hex2"],
  "style_preset": {
    "preset_name": "타사 페이지에서 추출한 프리셋 이름",
    "tone_manner": "톤앤매너를 한국어로 구체화",
    "required_keywords": ["반복되는 핵심 키워드/무드"],
    "banned_phrases": ["이 톤에서 피해야 할 표현"],
    "headline_font_style": "헤드라인 폰트 느낌. 실제 폰트명을 모르면 굵은 고딕/부드러운 세리프/손글씨 느낌처럼 설명",
    "body_font_style": "본문 폰트 느낌",
    "accent_color": "#hex 또는 빈 문자열",
    "background_color": "#hex 또는 빈 문자열",
    "text_color": "#hex 또는 빈 문자열",
    "image_direction": ["이미지 연출 규칙", "사진 구도/소품/그림자/배경 방향"],
    "layout_style": "섹션 배치/여백/카드/그리드 느낌",
    "visual_mood": "전체 시각 무드",
    "global_instruction": "우리 상세페이지 브랜드 프리셋 전체 지시문으로 쓸 수 있는 한국어 문장",
    "confidence": "high|medium|low"
  },
  "total_sections_count": 10,
  "page_score": {
    "total": 3.2,
    "grade": "F",
    "verdict": "한줄 총평 (한국어, 솔직하고 직설적으로)",
    "top_priorities": ["① 가장 급한 개선사항 (구체적 액션)", "② 두번째 개선사항", "③ 세번째 개선사항"],
    "criteria": [
      {"name":"첫인상 & 헤더","icon":"🎯","score":5,"current_state":"현재 상태 (한국어 1문장)","issues":["문제점1","문제점2"],"to_perfect":"10점 받으려면 구체적으로 무엇을 추가/수정해야 하는지 (한국어, 최대한 상세히)","visual_evidence":{"image_index":1,"crop":{"x":0,"y":0,"width":1,"height":0.22},"label":"헤더 영역","reason":"평가 근거"}},
      {"name":"이미지 품질/수량","icon":"🖼","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법 상세히"},
      {"name":"제품 정보 충실도","icon":"📋","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"구매 설득력 & 훅","icon":"🪝","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"사용 시나리오 제시","icon":"🏠","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"신뢰도 & 사회적 증거","icon":"⭐","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"디자인 & 레이아웃","icon":"🎨","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"차별화 & 경쟁우위","icon":"🏆","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"CTA & 구매 유도","icon":"🛒","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"모바일 최적화 추정","icon":"📱","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"}
    ]
  }
}` }];

    for (const img of imagesArray.slice(0, 10)) {
      parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
    };
    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '경쟁사분석');
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }

  // ── 경쟁사 상세페이지 분석 (HTML 텍스트) ─────────────────────
  async analyzeCompetitorHTML(htmlText) {
    const stripped = htmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 15000);
    const prompt = `You are a senior Korean e-commerce detail page consultant with 15+ years of experience.
You have audited thousands of Naver Smartstore, Coupang, and brand mall detail pages.
Be brutally honest. A weak page should get 1-3 points, not 5-6. Reserve 9-10 only for truly exceptional pages.
The following is text content extracted from a competitor's product detail page HTML.

=== PAGE CONTENT ===
${stripped}

Analyze the content structure, marketing strategy, copy tone, and reusable brand preset cues.
Also extract a reusable style_preset. For HTML-only input, infer tone/copy/layout from text. Leave visual colors empty or low confidence if they are not visible.
Return ONLY a JSON object:
{
  "page_title": "제품/페이지 제목",
  "sections_found": [
    {
      "index": 1,
      "type": "header|hook|features|specs|scenarios|comparison|material|certification|review|size_color|promotion|shipping|faq|brand_story|cta|other",
      "headline": "감지된 헤드라인",
      "body_summary": "본문 내용 요약 (1-2문장)",
      "has_image": false,
      "estimated_purpose": "이 섹션의 마케팅 목적"
    }
  ],
  "overall_strategy": "전체적인 판매 전략 설명 (2-3문장, 한국어)",
  "selling_strategies": ["전략1", "전략2"],
  "strengths": ["강점1", "강점2"],
  "weaknesses": ["약점1", "약점2"],
  "cta_patterns": ["CTA 패턴1"],
  "color_palette": [],
  "style_preset": {
    "preset_name": "타사 페이지에서 추출한 프리셋 이름",
    "tone_manner": "톤앤매너를 한국어로 구체화",
    "required_keywords": ["반복되는 핵심 키워드/무드"],
    "banned_phrases": ["이 톤에서 피해야 할 표현"],
    "headline_font_style": "헤드라인 폰트 느낌",
    "body_font_style": "본문 폰트 느낌",
    "accent_color": "",
    "background_color": "",
    "text_color": "",
    "image_direction": ["HTML에서 유추 가능한 이미지 연출 방향"],
    "layout_style": "섹션 배치/여백/카드/그리드 느낌",
    "visual_mood": "전체 시각/카피 무드",
    "global_instruction": "우리 상세페이지 브랜드 프리셋 전체 지시문으로 쓸 수 있는 한국어 문장",
    "confidence": "high|medium|low"
  },
  "total_sections_count": 10,
  "page_score": {
    "total": 3.2,
    "grade": "F",
    "verdict": "한줄 총평 (한국어, 솔직하고 직설적으로)",
    "top_priorities": ["① 가장 급한 개선사항 (구체적 액션)", "② 두번째 개선사항", "③ 세번째 개선사항"],
    "criteria": [
      {"name":"첫인상 & 헤더","icon":"🎯","score":5,"current_state":"현재 상태 (한국어 1문장)","issues":["문제점1","문제점2"],"to_perfect":"10점 받으려면 구체적으로 무엇을 추가/수정해야 하는지 (한국어, 최대한 상세히)"},
      {"name":"이미지 품질/수량","icon":"🖼","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법 상세히"},
      {"name":"제품 정보 충실도","icon":"📋","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"구매 설득력 & 훅","icon":"🪝","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"사용 시나리오 제시","icon":"🏠","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"신뢰도 & 사회적 증거","icon":"⭐","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"디자인 & 레이아웃","icon":"🎨","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"차별화 & 경쟁우위","icon":"🏆","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"CTA & 구매 유도","icon":"🛒","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"모바일 최적화 추정","icon":"📱","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"}
    ]
  }
}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
    };
    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '경쟁사HTML');
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }

  // ── 경쟁사 분석 기반 15섹션 플랜 생성 ───────────────────────
  async generateCompetitorSectionPlan(analysisResult, productAnalysis) {
    const sectionsInfo = SECTIONS.map(s => ({ id: s.id, name: s.name, purpose: s.purpose }));
    const prompt = `You are a Korean e-commerce detail page strategist.
Based on a competitor's page analysis, create an optimized section plan for OUR product's detail page.

=== COMPETITOR ANALYSIS ===
${JSON.stringify(analysisResult, null, 2).substring(0, 5000)}

=== OUR PRODUCT INFO ===
${productAnalysis ? JSON.stringify(productAnalysis, null, 2).substring(0, 2000) : '아직 제품 분석 전입니다. 일반적인 전략으로 추천해주세요.'}

=== 15 SECTION TYPES ===
${JSON.stringify(sectionsInfo, null, 2)}

For EACH of the 15 sections, provide:
Return ONLY a JSON object:
{
  "strategy_summary": "전체 전략 요약 (2-3문장, 한국어)",
  "key_differentiators": ["차별화 포인트1", "차별화 포인트2"],
  "recommended_sections": [
    {
      "section_id": "header",
      "enabled": true,
      "recommended_instructions": "한국어로 이 섹션에 대한 구체적인 지시사항 3-5문장. 경쟁사 대비 어떻게 차별화할지 포함.",
      "competitor_reference": "경쟁사가 이 부분을 어떻게 했는지 (없으면 '경쟁사 미확인')",
      "improvement_suggestions": "경쟁사 대비 개선 포인트"
    }
  ]
}

IMPORTANT:
- recommended_instructions는 반드시 한국어. 15개 section_id 모두 포함. enabled=false여도 instructions 필수.
- analysisResult.page_score.criteria[].to_perfect에 있는 '10점 받으려면' 개선 멘트가 관련 섹션에 있으면, improvement_suggestions에 그 핵심을 보존하고 recommended_instructions에는 실제 반영 방식으로 풀어 써라.
- analysisResult.style_preset이 있으면 톤/컬러/레이아웃 방향을 우리 제품에 맞게 재해석해 반영하되, 타사 제품명/효능/가격/인증 문구는 복제하지 마라.
- improvement_suggestions는 추상적인 말 대신 "어떤 경쟁사 문제를 어떻게 개선할지"가 보이는 한글 문장으로 작성하라.`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 6000 }
    };
    const data = await this._generateContent(this.model, body);
    tokenTracker.record(this.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '섹션플랜');
    let text = data.candidates[0].content.parts[0].text.trim();
    text = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }
}

// ════════════════════════════════════════════════════════════════
// IMAGE RESIZE HELPER (Canvas API — 정확한 픽셀 강제)
// ════════════════════════════════════════════════════════════════
function resizeImageDataUrl(dataUrl, targetW, targetH, options = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ratio = img.naturalWidth / img.naturalHeight;
        const w = Math.round(targetW);
        // targetH가 null이면 가로/세로 비율 유지
        const h = (targetH != null) ? Math.round(targetH) : Math.round(w / ratio);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // 선명한 렌더링을 위해 이중 패스 다운스케일
        if (img.naturalWidth > w * 2 || img.naturalHeight > h * 2) {
          const tmp = document.createElement('canvas');
          tmp.width = Math.round(img.naturalWidth / 2);
          tmp.height = Math.round(img.naturalHeight / 2);
          tmp.getContext('2d').drawImage(img, 0, 0, tmp.width, tmp.height);
          ctx.drawImage(tmp, 0, 0, w, h);
        } else {
          ctx.drawImage(img, 0, 0, w, h);
        }
        const mime = String(options.mime || 'image/png').toLowerCase();
        const quality = Number(options.quality);
        resolve(canvas.toDataURL(mime, Number.isFinite(quality) ? quality : undefined));
      } catch(e) {
        // 리사이즈 실패 시 원본 반환
        console.warn('resizeImageDataUrl failed, using original:', e);
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl); // 로드 실패 시 원본 반환
    img.src = dataUrl;
  });
}

// 현재 설정에 따라 이미지를 리사이즈 (auto 모드면 그냥 반환)
async function applyImageSizeConfig(dataUrl) {
  const cfg = state.modelConfig;
  if (!dataUrl || cfg.imageSizeMode !== 'custom' || !cfg.imageWidth) return dataUrl;
  return resizeImageDataUrl(dataUrl, cfg.imageWidth, cfg.imageHeight || null);
}

class ApiHubOpenAIImageAPI {
  async generateImage(prompt, productImageBase64, mimeType, imageModel, extraImages = [], options = {}) {
    const activeDirectives = getEffectiveImageDirectives();
    const directiveStr = activeDirectives.length > 0
      ? `\n\nCRITICAL CONSTRAINTS - follow exactly:\n${activeDirectives.map((directive, index) => `${index + 1}. ${directive}`).join('\n')}`
      : '';
    const promptIntro = options.promptIntro || 'Create a professional Korean e-commerce product detail page section image.';
    const sizeHint = options.sizeHintText ? `\n${options.sizeHintText}` : '';
    const fullPrompt = `${promptIntro} ${prompt}${sizeHint}${directiveStr}\n${buildBrandPromptBlock()}\n${buildLayoutPromptBlock()}`;
    const content = [{ type: 'input_text', text: fullPrompt }];
    const refs = [];
    if (productImageBase64) refs.push(normalizeImagePayloadForApi(productImageBase64, mimeType || 'image/png'));
    for (const image of extraImages || []) {
      if (image?.base64) refs.push(normalizeImagePayloadForApi(image.base64, image.mime || image.mimeType || 'image/png'));
    }
    for (const image of refs) {
      content.push({
        type: 'input_image',
        image_url: `data:${image.mime};base64,${image.base64}`,
        detail: 'high',
      });
    }

    const response = await fetch('http://127.0.0.1:4321/api/invoke/openai_chatgpt/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          model: 'gpt-5.6',
          input: [{ role: 'user', content }],
          tools: [{
            type: 'image_generation',
            action: 'generate',
            quality: 'medium',
            size: getRequestedImageSize('gpt-image-2'),
          }],
          tool_choice: { type: 'image_generation' },
        },
      }),
      signal: options.signal,
    });
    const envelope = await response.json().catch(() => ({}));
    const upstream = envelope?.response?.body || {};
    if (!response.ok || envelope?.ok !== true) {
      const message = upstream?.error?.message
        || (typeof envelope?.error === 'string' ? envelope.error : envelope?.error?.message)
        || 'API Hub OpenAI 이미지 생성 실패';
      throw new Error(String(message).slice(0, 500));
    }
    const generated = Array.isArray(upstream.output)
      ? upstream.output.find(item => item?.type === 'image_generation_call' && item.result)?.result
      : '';
    if (!generated) throw new Error('API Hub OpenAI 이미지 결과가 비어 있습니다.');
    tokenTracker.record('api-hub-openai-image', null, null, true, '이미지생성');
    return await applyImageSizeConfig(`data:image/png;base64,${generated}`);
  }
}

// ════════════════════════════════════════════════════════════════
// OPENAI API SERVICE
// ════════════════════════════════════════════════════════════════
class OpenAIAPI {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
    this.baseUrl = 'https://api.openai.com/v1';
  }

  // JSON 응답 파싱 헬퍼
  _parseJSON(text) {
    text = text.trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }

  async _parseOAIResponse(res, label = 'OpenAI image') {
    let data = null;
    const raw = await res.text().catch(() => '');
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      throw new Error(`${label} 응답 파싱 실패 (${res.status}): ${String(raw || '').slice(0, 200)}`);
    }
    if (!res.ok || data?.error) {
      const msg = data?.error?.message || data?.error || `${label} 실패 (${res.status})`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  async generateImage(prompt, productImageBase64, mimeType, imageModel, extraImages = [], options = {}) {
    const imgModel = imageModel || getImageModel();
    const requestedSize = getRequestedImageSize(imgModel);
    const outputFormat = 'png';
    const activeDirectives = getEffectiveImageDirectives();
    const directiveStr = activeDirectives.length > 0
      ? `\n\nCRITICAL CONSTRAINTS - follow exactly:\n${activeDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : '';
    const brandBlock = buildBrandPromptBlock();
    const layoutBlock = buildLayoutPromptBlock();
    const promptIntro = options.promptIntro || 'Create a professional Korean e-commerce product detail page section image.';
    const sizeHint = options.sizeHintText ? `\n${options.sizeHintText}` : '';
    const fullPrompt = `${promptIntro} ${prompt}${sizeHint}${directiveStr}\n${brandBlock}\n${layoutBlock}`;
    const refs = [];
    if (productImageBase64) refs.push(normalizeImagePayloadForApi(productImageBase64, mimeType || 'image/png'));
    for (const img of extraImages || []) {
      if (img?.base64) refs.push(normalizeImagePayloadForApi(img.base64, img.mime || img.mimeType || 'image/png'));
    }

    let data;
    if (refs.length > 0) {
      const form = new FormData();
      form.append('model', imgModel);
      form.append('prompt', fullPrompt);
      form.append('size', requestedSize);
      form.append('quality', 'auto');
      form.append('output_format', outputFormat);
      // OpenAI accepts repeated "image" parts; multi-ref docs also show "image[]".
      // Use "image[]" for 2+ refs (multi reference), "image" for single-ref edits.
      const imageField = refs.length > 1 ? 'image[]' : 'image';
      refs.forEach((img, idx) => {
        const ext = img.mime === 'image/jpeg' ? 'jpg' : (img.mime.split('/')[1] || 'png');
        const blob = dataUrlToBlob(`data:${img.mime};base64,${img.base64}`);
        form.append(imageField, blob, `reference-${idx + 1}.${ext}`);
      });
      const res = await fetch(`${this.baseUrl}/images/edits`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        body: form,
        signal: options.signal,
      });
      data = await this._parseOAIResponse(res, `OpenAI images/edits (${imgModel})`);
    } else {
      const res = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: imgModel,
          prompt: fullPrompt,
          size: requestedSize,
          quality: 'auto',
          output_format: outputFormat,
          n: 1,
        }),
        signal: options.signal,
      });
      data = await this._parseOAIResponse(res, `OpenAI images/generations (${imgModel})`);
    }

    const usage = data.usage || null;
    tokenTracker.record(
      imgModel,
      usage?.input_tokens,
      usage?.output_tokens,
      true,
      '이미지생성',
      usage ? { costUSD: calcOpenAIImageCost(imgModel, usage) } : null
    );

    const first = data.data?.[0];
    if (!first) return null;
    if (first.b64_json) {
      return await applyImageSizeConfig(`data:image/${data.output_format || outputFormat};base64,${first.b64_json}`);
    }
    if (first.url) return first.url;
    return null;
  }

  async editImageWithMask(imageDataUrl, maskDataUrl, prompt, imageModel) {
    const imgModel = imageModel || getImageModel();
    const outputFormat = 'png';
    const form = new FormData();
    form.append('model', imgModel);
    form.append('prompt', prompt);
    form.append('image', dataUrlToBlob(imageDataUrl), 'source.png');
    form.append('mask', dataUrlToBlob(maskDataUrl), 'mask.png');
    form.append('size', 'auto');
    form.append('quality', 'auto');
    form.append('output_format', outputFormat);
    form.append('n', '1');

    const res = await fetch(`${this.baseUrl}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: form
    });
    const data = await this._parseOAIResponse(res, `OpenAI image edit (${imgModel})`);

    const usage = data.usage || null;
    tokenTracker.record(
      imgModel,
      usage?.input_tokens,
      usage?.output_tokens,
      true,
      'AI부분수정',
      usage ? { costUSD: calcOpenAIImageCost(imgModel, usage) } : null
    );

    const first = data.data?.[0];
    if (!first) return null;
    if (first.b64_json) return `data:image/${data.output_format || outputFormat};base64,${first.b64_json}`;
    if (first.url) return first.url;
    return null;
  }

  async analyzeImage(imageBase64, mimeType, extraImages = []) {
    const prompt = `You are a professional e-commerce product analyst. Analyze this product image in extreme detail.
Return a JSON object with the following fields:
{
    "product_name": "detected product name in Korean",
    "product_name_en": "detected product name in English",
    "category": "product category",
    "brand": "brand name if visible",
    "colors": ["list of colors detected"],
    "materials": ["detected or estimated materials"],
    "shape": "product shape description",
    "size_estimate": "estimated size",
    "key_features": ["list of 5-10 key features"],
    "target_audience": "target customer demographic",
    "price_range_estimate": "estimated price range in KRW",
    "mood": "overall mood/aesthetic of the product",
    "use_cases": ["list of use cases"],
    "selling_points": ["list of unique selling points"],
    "style_keywords": ["style-related keywords for design"],
    "complementary_colors": ["colors that complement the product"],
    "text_color_recommendation": "recommended text color for overlay",
    "detailed_description": "A detailed Korean description for marketing",
    "reasoning": {
        "product_name_basis": "한 문장으로: 제품명을 어떻게 판단했는지 (이미지 텍스트 인식인지, 형태 추론인지)",
        "category_basis": "한 문장으로: 카테고리를 어떻게 분류했는지",
        "price_basis": "한 문장으로: 가격대를 어떻게 추정했는지 (소재·마감·브랜드 등 근거)",
        "material_basis": "한 문장으로: 소재를 어떻게 판단했는지 (텍스처·광택·색감 등)",
        "target_basis": "한 문장으로: 타겟 고객을 어떻게 추정했는지",
        "confidence": "overall|high|medium|low — 이미지 품질·정보량 기준 전체 분석 신뢰도"
    }
}
Important:
- If the image contains overlaid marketing/title text, logo placeholders, or page copy, do not let that text override the physical product. For example, text saying "wallet" must not make a flat lidded gift box into a wallet.
- Use visible text as product-name evidence only when it is printed on the product label/packaging itself and matches the object shape.
- product_name and category must prioritize the physical object type, silhouette, closure, color placement, and top/bottom pattern split.
Respond ONLY with the JSON object, no other text.`;
    const primary = normalizeImagePayloadForApi(imageBase64, mimeType || 'image/png');
    const refs = (extraImages || [])
      .map(img => img?.base64 ? normalizeImagePayloadForApi(img.base64, img.mime || img.mimeType || 'image/png') : null)
      .filter(img => img?.base64);

    const body = {
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${primary.mime};base64,${primary.base64}`, detail: 'high' } },
          // 추가 이미지 (멀티 이미지 분석)
          ...refs.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: 'high' } }))
        ]
      }],
      max_completion_tokens: 4096,
      temperature: 0.3,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    tokenTracker.record(this.model, data.usage?.prompt_tokens, data.usage?.completion_tokens, false, '제품분석');
    return this._parseJSON(data.choices[0].message.content);
  }

  async generateSectionContent(sectionDef, productAnalysis, customInstructions, competitorRef) {
    const prompt = buildSectionContentProviderPrompt(
      sectionDef,
      productAnalysis,
      customInstructions,
      competitorRef,
      { variant: 'standard' },
    );

    const body = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 2048,
      temperature: 0.7,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    tokenTracker.record(this.model, data.usage?.prompt_tokens, data.usage?.completion_tokens, false, '섹션생성');
    return this._parseJSON(data.choices[0].message.content);
  }

  async searchSimilarProducts(productName, category) {
    const prompt = `You are a Korean e-commerce market analyst.
For the product "${productName}" in the category "${category}", provide competitor analysis.
Return a JSON object:
{
    "similar_products": [
        {"name": "product name", "price_range": "price", "strengths": "key strength", "detail_page_style": "description of their detail page approach"}
    ],
    "market_insights": "brief market analysis in Korean",
    "detail_page_trends": ["list of current detail page design trends for this category"],
    "recommended_approach": "recommended detail page strategy in Korean"
}
List 5-8 competitor products. Respond ONLY with JSON.`;

    const body = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 2048,
      temperature: 0.5,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    tokenTracker.record(this.model, data.usage?.prompt_tokens, data.usage?.completion_tokens, false, '유사상품');
    return this._parseJSON(data.choices[0].message.content);
  }

  // ── 경쟁사 상세페이지 분석 (이미지 스크린샷) ──────────────────
  async analyzeCompetitorImages(imagesArray) {
    const content = [{ type: 'text', text: `You are a senior Korean e-commerce detail page consultant with 15+ years of experience.
You have audited thousands of Naver Smartstore, Coupang, and brand mall detail pages.
Be brutally honest. A weak page should get 1-3 points, not 5-6. Reserve 9-10 only for truly exceptional pages.
Analyze every visible element: images, copy, layout, trust signals, CTAs, information density.
Also extract a reusable visual/style preset from the page: tone and manner, accent colors, background colors, font feeling, image direction, layout mood, repeated keywords, and phrases to avoid. This is for reference only; do not copy competitor product claims.
For every section and every scoring criterion, include visual_evidence when image input is available.
visual_evidence must identify the exact visual area that supports your judgment:
{
  "image_index": 1,
  "crop": {"x":0.00,"y":0.00,"width":1.00,"height":0.22},
  "label": "헤더/첫 화면",
  "reason": "이 영역에서 핵심 문구와 제품 이미지가 확인됨"
}
Coordinates are normalized 0-1 from the original input image. Use the tightest useful crop. If the evidence is text or a specific product/detail area, crop close enough that a human can read or inspect it. Avoid full-page, browser-chrome, admin-panel, or overly broad crops unless the criterion is explicitly about overall layout. If no visual evidence exists, use null.
Return ONLY a JSON object:
{
  "page_title": "제품/페이지 제목",
  "sections_found": [{"index":1,"type":"header|hook|features|specs|scenarios|comparison|material|certification|review|size_color|promotion|shipping|faq|brand_story|cta|other","headline":"감지된 헤드라인","body_summary":"본문 요약","has_image":true,"estimated_purpose":"마케팅 목적","visual_evidence":{"image_index":1,"crop":{"x":0,"y":0,"width":1,"height":0.2},"label":"해당 섹션 근거 영역","reason":"근거 설명"}}],
  "overall_strategy": "전체 전략 (한국어 2-3문장)",
  "selling_strategies": ["전략1"],
  "strengths": ["강점1"],
  "weaknesses": ["약점1"],
  "cta_patterns": ["CTA 패턴1"],
  "color_palette": ["#hex"],
  "style_preset": {
    "preset_name": "타사 페이지에서 추출한 프리셋 이름",
    "tone_manner": "톤앤매너를 한국어로 구체화",
    "required_keywords": ["반복되는 핵심 키워드/무드"],
    "banned_phrases": ["이 톤에서 피해야 할 표현"],
    "headline_font_style": "헤드라인 폰트 느낌. 실제 폰트명을 모르면 굵은 고딕/부드러운 세리프/손글씨 느낌처럼 설명",
    "body_font_style": "본문 폰트 느낌",
    "accent_color": "#hex 또는 빈 문자열",
    "background_color": "#hex 또는 빈 문자열",
    "text_color": "#hex 또는 빈 문자열",
    "image_direction": ["이미지 연출 규칙", "사진 구도/소품/그림자/배경 방향"],
    "layout_style": "섹션 배치/여백/카드/그리드 느낌",
    "visual_mood": "전체 시각 무드",
    "global_instruction": "우리 상세페이지 브랜드 프리셋 전체 지시문으로 쓸 수 있는 한국어 문장",
    "confidence": "high|medium|low"
  },
  "total_sections_count": 10,
  "page_score": {
    "total": 3.2,
    "grade": "F",
    "verdict": "한줄 총평 (한국어, 솔직하고 직설적으로)",
    "top_priorities": ["① 가장 급한 개선사항 (구체적 액션)", "② 두번째 개선사항", "③ 세번째 개선사항"],
    "criteria": [
      {"name":"첫인상 & 헤더","icon":"🎯","score":5,"current_state":"현재 상태 (한국어 1문장)","issues":["문제점1","문제점2"],"to_perfect":"10점 받으려면 구체적으로 무엇을 추가/수정해야 하는지 (한국어, 최대한 상세히)","visual_evidence":{"image_index":1,"crop":{"x":0,"y":0,"width":1,"height":0.22},"label":"헤더 영역","reason":"평가 근거"}},
      {"name":"이미지 품질/수량","icon":"🖼","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법 상세히"},
      {"name":"제품 정보 충실도","icon":"📋","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"구매 설득력 & 훅","icon":"🪝","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"사용 시나리오 제시","icon":"🏠","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"신뢰도 & 사회적 증거","icon":"⭐","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"디자인 & 레이아웃","icon":"🎨","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"차별화 & 경쟁우위","icon":"🏆","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"CTA & 구매 유도","icon":"🛒","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"모바일 최적화 추정","icon":"📱","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"}
    ]
  }
}` }];
    for (const img of imagesArray.slice(0, 8)) {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: 'high' } });
    }
    const body = { model: this.model, messages: [{ role: 'user', content }], max_completion_tokens: 8192, temperature: 0.3 };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    tokenTracker.record(this.model, d.usage?.prompt_tokens, d.usage?.completion_tokens, false, '경쟁사분석');
    return this._parseJSON(d.choices[0].message.content);
  }

  // ── 경쟁사 상세페이지 분석 (HTML 텍스트) ─────────────────────
  async analyzeCompetitorHTML(htmlText) {
    const stripped = htmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);
    const prompt = `You are a senior Korean e-commerce detail page consultant with 15+ years of experience.
You have audited thousands of Naver Smartstore, Coupang, and brand mall detail pages.
Be brutally honest. A weak page should get 1-3 points, not 5-6. Reserve 9-10 only for truly exceptional pages.
Text extracted from a competitor's product detail page:
=== PAGE CONTENT ===
${stripped}
Analyze the content structure, marketing strategy, copy tone, and reusable brand preset cues.
Also extract a reusable style_preset. For HTML-only input, infer tone/copy/layout from text. Leave visual colors empty or low confidence if they are not visible.
Return ONLY a JSON object:
{
  "page_title": "제품/페이지 제목",
  "sections_found": [{"index":1,"type":"header|hook|features|specs|scenarios|comparison|material|certification|review|size_color|promotion|shipping|faq|brand_story|cta|other","headline":"헤드라인","body_summary":"본문 요약","has_image":false,"estimated_purpose":"목적"}],
  "overall_strategy": "전략 (한국어 2-3문장)",
  "selling_strategies": ["전략1"],
  "strengths": ["강점1"],
  "weaknesses": ["약점1"],
  "cta_patterns": ["CTA1"],
  "color_palette": [],
  "style_preset": {
    "preset_name": "타사 페이지에서 추출한 프리셋 이름",
    "tone_manner": "톤앤매너를 한국어로 구체화",
    "required_keywords": ["반복되는 핵심 키워드/무드"],
    "banned_phrases": ["이 톤에서 피해야 할 표현"],
    "headline_font_style": "헤드라인 폰트 느낌",
    "body_font_style": "본문 폰트 느낌",
    "accent_color": "",
    "background_color": "",
    "text_color": "",
    "image_direction": ["HTML에서 유추 가능한 이미지 연출 방향"],
    "layout_style": "섹션 배치/여백/카드/그리드 느낌",
    "visual_mood": "전체 시각/카피 무드",
    "global_instruction": "우리 상세페이지 브랜드 프리셋 전체 지시문으로 쓸 수 있는 한국어 문장",
    "confidence": "high|medium|low"
  },
  "total_sections_count": 10,
  "page_score": {
    "total": 3.2,
    "grade": "F",
    "verdict": "한줄 총평 (한국어, 솔직하고 직설적으로)",
    "top_priorities": ["① 가장 급한 개선사항 (구체적 액션)", "② 두번째 개선사항", "③ 세번째 개선사항"],
    "criteria": [
      {"name":"첫인상 & 헤더","icon":"🎯","score":5,"current_state":"현재 상태 (한국어 1문장)","issues":["문제점1","문제점2"],"to_perfect":"10점 받으려면 구체적으로 무엇을 추가/수정해야 하는지 (한국어, 최대한 상세히)"},
      {"name":"이미지 품질/수량","icon":"🖼","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법 상세히"},
      {"name":"제품 정보 충실도","icon":"📋","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"구매 설득력 & 훅","icon":"🪝","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"사용 시나리오 제시","icon":"🏠","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"신뢰도 & 사회적 증거","icon":"⭐","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"디자인 & 레이아웃","icon":"🎨","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"차별화 & 경쟁우위","icon":"🏆","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"CTA & 구매 유도","icon":"🛒","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"모바일 최적화 추정","icon":"📱","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"}
    ]
  }
}`;
    const body = { model: this.model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 8192, temperature: 0.3 };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    tokenTracker.record(this.model, d.usage?.prompt_tokens, d.usage?.completion_tokens, false, '경쟁사HTML');
    return this._parseJSON(d.choices[0].message.content);
  }

  // ── 경쟁사 분석 기반 15섹션 플랜 생성 ───────────────────────
  async generateCompetitorSectionPlan(analysisResult, productAnalysis) {
    const sectionsInfo = SECTIONS.map(s => ({ id: s.id, name: s.name, purpose: s.purpose }));
    const prompt = `You are a Korean e-commerce detail page strategist.
Based on competitor analysis, create an optimized 15-section plan for OUR product.

=== COMPETITOR ANALYSIS ===
${JSON.stringify(analysisResult).substring(0, 4000)}

=== OUR PRODUCT ===
${productAnalysis ? JSON.stringify(productAnalysis).substring(0, 2000) : '제품 분석 전. 일반적 전략으로 추천.'}

=== 15 SECTIONS ===
${JSON.stringify(sectionsInfo)}

Return ONLY a JSON object:
{
  "strategy_summary": "전략 요약 (한국어 2-3문장)",
  "key_differentiators": ["차별화1","차별화2"],
  "recommended_sections": [{"section_id":"header","enabled":true,"recommended_instructions":"한국어 구체적 지시사항 3-5문장","competitor_reference":"경쟁사 방식","improvement_suggestions":"개선 포인트"}]
}
IMPORTANT:
- recommended_instructions 반드시 한국어. 15개 모두 포함.
- analysisResult.page_score.criteria[].to_perfect의 '10점 받으려면' 초록 개선 멘트가 관련 섹션에 있으면 improvement_suggestions에 핵심을 보존하고, recommended_instructions에는 그 개선을 실제 상세페이지 구성으로 어떻게 반영할지 써라.
- analysisResult.style_preset이 있으면 톤/컬러/레이아웃 방향을 우리 제품에 맞게 재해석해 반영하되, 타사 제품명/효능/가격/인증 문구는 복제하지 마라.
- improvement_suggestions는 추상적인 말 대신 "어떤 경쟁사 문제를 어떻게 개선할지"가 보이는 한글 문장으로 작성하라.`;
    const body = { model: this.model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 6000, temperature: 0.5 };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    tokenTracker.record(this.model, d.usage?.prompt_tokens, d.usage?.completion_tokens, false, '섹션플랜');
    return this._parseJSON(d.choices[0].message.content);
  }
}

// ════════════════════════════════════════════════════════════════
// LOCAL OLLAMA (OpenAI 호환 엔드포인트)
// ════════════════════════════════════════════════════════════════
// Ollama 는 /v1/chat/completions 에서 OpenAI 스키마와 data:image base64 vision 을
// 그대로 지원한다. 프롬프트·파싱을 다시 쓰지 않고 OpenAIAPI 를 상속해 baseUrl 만 바꾼다.
class OllamaAPI extends OpenAIAPI {
  constructor(model, baseUrl = OLLAMA_DEFAULT_BASE_URL) {
    super('ollama', model);            // 로컬 서버는 키를 검사하지 않는다
    const root = String(baseUrl || OLLAMA_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    this.rootUrl = root || OLLAMA_DEFAULT_BASE_URL;
    this.baseUrl = `${this.rootUrl}/v1`;
    this.isLocal = true;
  }

  // 로컬 모델은 이미지 생성을 하지 못한다. 조용히 빈 결과를 주지 않고 명확히 알린다.
  async generateImage() {
    throw new Error('로컬 Ollama 모델은 이미지 생성을 지원하지 않습니다. 이미지 생성은 Gemini 또는 OpenAI를 사용하세요.');
  }
}

async function probeOllamaModels(baseUrl = OLLAMA_DEFAULT_BASE_URL, fetchImpl = fetch) {
  const root = String(baseUrl || OLLAMA_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const res = await fetchImpl(`${root}/api/tags`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return (data?.models || []).map(m => String(m?.name || '')).filter(Boolean);
}

// ════════════════════════════════════════════════════════════════
// GPT OAUTH API HUB BRIDGE
// ════════════════════════════════════════════════════════════════
function parseJsonObjectFromText(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
  try { return JSON.parse(cleaned); } catch(e) {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch(e) {}
  }
  throw new Error('LLM 응답을 JSON으로 해석하지 못했습니다.');
}

function buildCafe24CandidateRankingPrompt(context, candidates, engineLabel = 'LLM') {
  return `You are a Korean ecommerce product matching judge.
You must choose from the provided Cafe24 candidates only. Do not invent products.
The attached reference image(s), when present, are the TARGET product to match.
Candidate image attachments, when present, are labeled with the same rank/product_no as CAFE24 CANDIDATES. Use them to compare the target image against candidate visuals.
Use the direct product name first when present, then visual evidence from the reference image, image analysis clues, visible text, category, color, shape, and candidate metadata.
If MATCH CONTEXT says image_only_mode is true, ignore user-entered names, natural hints, prior cached names, and any product names not derived from the current image analysis.
Hidden/unlisted Cafe24 products are valid candidates; display=F does not mean wrong.
If the image-only AI name conflicts with the direct input name, treat the direct input name as stronger evidence.
Penalize candidates whose silhouette, closure shape, top/bottom pattern split, color placement, or product type does not match the reference image.
For small rectangular products, first decide the product type from the reference image: wallet/pouch, flat gift box, lidded box, wrapping cloth, envelope, or other. Only apply wallet-specific clues when the target is visually a wallet.
For pouch/wallet-like products, compare the side silhouette, zipper/opening shape, half-moon vs flat rectangle shape, strap/tab position, and pattern band placement before relying on generic color or wallet terms.
For long narrow rounded cases, first lock the product type from explicit evidence. If the current image analysis or search context says 필통/펜케이스/pencil case/pen case, prefer pen-case candidates and reject eyeglass cases unless the target image or text explicitly says 안경/glasses.
Candidate image URLs may be provided as metadata, but do not assume you can open URLs unless candidate image attachments are present.

MATCH CONTEXT:
${JSON.stringify(context, null, 2)}

CAFE24 CANDIDATES:
${JSON.stringify(candidates, null, 2)}

Return ONLY JSON:
{
  "ranking_basis": "short Korean explanation of how ${engineLabel} judged, including the strongest visual criteria",
  "ranked_candidates": [
    {
      "rank": 1,
      "product_no": "Cafe24 product_no from candidates",
      "product_code": "Cafe24 product_code from candidates",
      "product_name": "Cafe24 product_name from candidates",
      "similarity_score": 0,
      "decision": "match|candidate|reject",
      "reason": "Korean reason tied to the reference image, name, category, color, shape, and candidate metadata"
    }
  ]
}
Rules:
- similarity_score must be an integer from 0 to 100. Use 90+ only when the candidate image/name/metadata strongly matches the target. Do not leave scores at 0 except clear rejects.
- Return the exact candidate rank/product_no/product_code/product_name copied from CAFE24 CANDIDATES.
- Sort ranked_candidates from best match to weakest match.`;
}

function buildProductImageAnalysisPrompt() {
  return `You are a professional e-commerce product analyst. Analyze the attached product image(s) in extreme detail.
Return a JSON object with the following fields:
{
    "product_name": "detected product name in Korean",
    "product_name_en": "detected product name in English",
    "category": "product category",
    "brand": "brand name if visible",
    "colors": ["list of colors detected"],
    "materials": ["detected or estimated materials"],
    "shape": "product shape description",
    "size_estimate": "estimated size",
    "key_features": ["list of 5-10 key features"],
    "visual_match_terms": ["Korean visual search terms such as 색동, 카드지갑, 누비, 퀼팅, 직사각형, 덮개형, 전통 지갑 when they are visually supported"],
    "product_type_candidates": ["ranked Korean product type candidates inferred only from the image"],
    "candidate_search_queries": ["short Korean Cafe24-style search queries derived only from visible features; do not use user-entered names"],
    "target_audience": "target customer demographic",
    "price_range_estimate": "estimated price range in KRW",
    "mood": "overall mood/aesthetic of the product",
    "use_cases": ["list of use cases"],
    "selling_points": ["list of unique selling points"],
    "style_keywords": ["style-related keywords for design"],
    "complementary_colors": ["colors that complement the product"],
    "text_color_recommendation": "recommended text color for overlay",
    "detailed_description": "A detailed Korean description for marketing",
    "reasoning": {
        "product_name_basis": "한 문장으로: 제품명을 어떻게 판단했는지 (이미지 텍스트 인식인지, 형태 추론인지)",
        "category_basis": "한 문장으로: 카테고리를 어떻게 분류했는지",
        "price_basis": "한 문장으로: 가격대를 어떻게 추정했는지 (소재·마감·브랜드 등 근거)",
        "material_basis": "한 문장으로: 소재를 어떻게 판단했는지 (텍스처·광택·색감 등)",
        "target_basis": "한 문장으로: 타겟 고객을 어떻게 추정했는지",
        "confidence": "overall|high|medium|low — 이미지 품질·정보량 기준 전체 분석 신뢰도"
    }
}
Important:
- If the image contains overlaid marketing/title text, logo placeholders, or page copy, do not let that text override the physical product. For example, text saying "wallet" must not make a flat lidded gift box into a wallet.
- Use visible text as product-name evidence only when it is printed on the product label/packaging itself and matches the object shape.
- product_name, product_type_candidates, visual_match_terms, and candidate_search_queries must prioritize the physical object type, silhouette, closure, color placement, and top/bottom pattern split.
Respond ONLY with the JSON object, no other text.`;
}

function buildCompetitorImageAnalysisPrompt() {
  return `You are a senior Korean e-commerce detail page consultant with 15+ years of experience.
You have audited thousands of Naver Smartstore, Coupang, and brand mall detail pages.
Be brutally honest. A weak page should get 1-3 points, not 5-6. Reserve 9-10 only for truly exceptional pages.
Analyze every visible element in the attached screenshot images: images, copy, layout, trust signals, CTAs, information density.
Also extract a reusable visual/style preset from the page: tone and manner, accent colors, background colors, font feeling, image direction, layout mood, repeated keywords, and phrases to avoid. This is for reference only; do not copy competitor product claims.
For every section and every scoring criterion, include visual_evidence when image input is available.
visual_evidence must identify the exact visual area that supports your judgment:
{
  "image_index": 1,
  "crop": {"x":0.00,"y":0.00,"width":1.00,"height":0.22},
  "label": "헤더/첫 화면",
  "reason": "이 영역에서 핵심 문구와 제품 이미지가 확인됨"
}
Coordinates are normalized 0-1 from the original input image. Use the tightest useful crop. If the evidence is text or a specific product/detail area, crop close enough that a human can read or inspect it. Avoid full-page, browser-chrome, admin-panel, or overly broad crops unless the criterion is explicitly about overall layout. If no visual evidence exists, use null.
Return ONLY a JSON object:
{
  "page_title": "제품/페이지 제목",
  "sections_found": [{"index":1,"type":"header|hook|features|specs|scenarios|comparison|material|certification|review|size_color|promotion|shipping|faq|brand_story|cta|other","headline":"감지된 헤드라인","body_summary":"본문 요약","has_image":true,"estimated_purpose":"마케팅 목적","visual_evidence":{"image_index":1,"crop":{"x":0,"y":0,"width":1,"height":0.2},"label":"해당 섹션 근거 영역","reason":"근거 설명"}}],
  "overall_strategy": "전체 전략 (한국어 2-3문장)",
  "selling_strategies": ["전략1"],
  "strengths": ["강점1"],
  "weaknesses": ["약점1"],
  "cta_patterns": ["CTA 패턴1"],
  "color_palette": ["#hex"],
  "style_preset": {
    "preset_name": "타사 페이지에서 추출한 프리셋 이름",
    "tone_manner": "톤앤매너를 한국어로 구체화",
    "required_keywords": ["반복되는 핵심 키워드/무드"],
    "banned_phrases": ["이 톤에서 피해야 할 표현"],
    "headline_font_style": "헤드라인 폰트 느낌. 실제 폰트명을 모르면 굵은 고딕/부드러운 세리프/손글씨 느낌처럼 설명",
    "body_font_style": "본문 폰트 느낌",
    "accent_color": "#hex 또는 빈 문자열",
    "background_color": "#hex 또는 빈 문자열",
    "text_color": "#hex 또는 빈 문자열",
    "image_direction": ["이미지 연출 규칙", "사진 구도/소품/그림자/배경 방향"],
    "layout_style": "섹션 배치/여백/카드/그리드 느낌",
    "visual_mood": "전체 시각 무드",
    "global_instruction": "우리 상세페이지 브랜드 프리셋 전체 지시문으로 쓸 수 있는 한국어 문장",
    "confidence": "high|medium|low"
  },
  "total_sections_count": 10,
  "page_score": {
    "total": 3.2,
    "grade": "F",
    "verdict": "한줄 총평 (한국어, 솔직하고 직설적으로)",
    "top_priorities": ["① 가장 급한 개선사항 (구체적 액션)", "② 두번째 개선사항", "③ 세번째 개선사항"],
    "criteria": [
      {"name":"첫인상 & 헤더","icon":"🎯","score":5,"current_state":"현재 상태 (한국어 1문장)","issues":["문제점1","문제점2"],"to_perfect":"10점 받으려면 구체적으로 무엇을 추가/수정해야 하는지 (한국어, 최대한 상세히)","visual_evidence":{"image_index":1,"crop":{"x":0,"y":0,"width":1,"height":0.22},"label":"헤더 영역","reason":"평가 근거"}},
      {"name":"이미지 품질/수량","icon":"🖼","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법 상세히"},
      {"name":"제품 정보 충실도","icon":"📋","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"구매 설득력 & 훅","icon":"🪝","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"사용 시나리오 제시","icon":"🏠","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"신뢰도 & 사회적 증거","icon":"⭐","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"디자인 & 레이아웃","icon":"🎨","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"차별화 & 경쟁우위","icon":"🏆","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"CTA & 구매 유도","icon":"🛒","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"},
      {"name":"모바일 최적화 추정","icon":"📱","score":5,"current_state":"현재 상태","issues":["문제점1"],"to_perfect":"개선 방법"}
    ]
  }
}`;
}

function buildGptOAuthImagePayloads(primaryBase64, primaryMime, extraImages = [], options = {}) {
  const label = options.label || '이미지';
  const limit = Math.max(1, Math.min(Number(options.limit || 8), 8));
  const images = [];
  if (primaryBase64) {
    const primary = normalizeImagePayloadForApi(primaryBase64, primaryMime || 'image/png');
    images.push({ base64: primary.base64, mimeType: primary.mime, name: `${label} 1` });
  }
  (extraImages || []).forEach((img, idx) => {
    if (!img?.base64) return;
    const ref = normalizeImagePayloadForApi(img.base64, img.mime || img.mimeType || 'image/png');
    images.push({ base64: ref.base64, mimeType: ref.mime, name: `${label} ${images.length + 1}` });
  });
  return images.slice(0, limit);
}

function getGptOAuthModelLabel(modelId = null) {
  return getLlmModelLabel(modelId || state?.modelConfig?.llmModel, 'gpt_oauth') || modelId || '';
}

function getGptOAuthReasoningLabel(value = null) {
  const id = normalizeGptOAuthReasoningEffort(value || state?.modelConfig?.gptOAuthReasoningEffort);
  return GPT_OAUTH_REASONING_EFFORTS.find(item => item.id === id)?.label || id;
}

function getGptOAuthServiceTierLabel(value = null) {
  const id = normalizeGptOAuthServiceTier(value || state?.modelConfig?.gptOAuthServiceTier);
  return GPT_OAUTH_SERVICE_TIERS.find(item => item.id === id)?.label || id;
}

function normalizeGptOAuthStatus(raw) {
  const status = raw || {};
  return {
    connectorId: status.connectorId || status.connector_id || 'chatgpt_login_oauth',
    displayName: status.displayName || status.display_name || 'GPT OAuth (ChatGPT Login)',
    mode: status.mode || 'chatgpt-login-oauth',
    authMode: status.authMode || status.auth_mode || '',
    chatGptLoginReady: !!(status.chatGptLoginReady ?? status.chat_gpt_login_ready ?? status.connected),
    hasAccessToken: !!(status.hasAccessToken ?? status.has_access_token),
    hasRefreshToken: !!(status.hasRefreshToken ?? status.has_refresh_token),
    lastRefresh: status.lastRefresh || status.last_refresh || '',
    nextAction: status.nextAction || status.next_action || '',
    rawTokenReturned: !!(status.rawTokenReturned ?? status.raw_token_returned),
    apiKeyFallbackIgnored: status.apiKeyFallbackIgnored ?? status.api_key_fallback_ignored ?? true,
    readError: status.readError || status.read_error || '',
  };
}

function isGptOAuthConnected() {
  const s = normalizeGptOAuthStatus(state?.gptOAuthStatus);
  return s.connectorId === 'chatgpt_login_oauth'
    && s.mode === 'chatgpt-login-oauth'
    && s.authMode === 'chatgpt'
    && s.chatGptLoginReady
    && !s.rawTokenReturned;
}

async function refreshGptOAuthStatus(options = {}) {
  if (!state) return null;
  state.gptOAuthStatusLoading = true;
  state.gptOAuthStatusError = '';
  if (!options.silent) render();
  try {
    const res = await fetch(`${GPT_OAUTH_API_BASE}/api/playbooks/gpt-oauth/status`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || data?.message || `API Hub HTTP ${res.status}`);
    state.gptOAuthStatus = data;
    try {
      const optionsRes = await fetch(`${GPT_OAUTH_API_BASE}/api/llm/options`, { cache: 'no-store' });
      if (!optionsRes.ok) throw new Error(`API Hub HTTP ${optionsRes.status}`);
      state.gptOAuthOptions = normalizeGptOAuthOptions(await optionsRes.json());
      clearRuntimeDegraded('gpt-oauth-options');
    } catch (optionsError) {
      reportRuntimeDegradedOnce(
        'gpt-oauth-options',
        'GPT OAuth 모델 목록 갱신 저하 · 기존 목록을 유지합니다',
        optionsError,
      );
    }
    state.gptOAuthLastCheckedAt = Date.now();
    state.gptOAuthStatusError = '';
    return data;
  } catch(e) {
    const msg = e?.message || String(e);
    // Failed to fetch almost always means API Hub (4321) is down.
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      state.gptOAuthStatusError = `API Hub 연결 실패 (${GPT_OAUTH_API_BASE}). 바탕화면 API Hub를 실행하거나 상세페이지 런처를 다시 켜주세요.`;
    } else {
      state.gptOAuthStatusError = msg;
    }
    return null;
  } finally {
    state.gptOAuthStatusLoading = false;
    if (!options.silent) render();
  }
}

// 부팅 시 1회 조회가 실패하면 gptOAuthStatusError가 세션 내내 남아,
// 실제 연결이 정상이어도 getLLMClient() 게이트가 계속 막는다.
// 실행 직전에 낡거나 실패한 캐시만 다시 확인해 그 오탐을 없앤다.
const GPT_OAUTH_STATUS_STALE_MS = 5 * 60 * 1000;

async function ensureGptOAuthStatusFresh(options = {}) {
  if (!state) return null;
  let provider = '';
  try { provider = normalizeModelConfig(state.modelConfig).llmProvider; } catch (_) { provider = ''; }
  if (provider !== 'gpt_oauth') return state.gptOAuthStatus || null;
  if (state.gptOAuthStatusLoading) return state.gptOAuthStatus || null;
  const checkedAt = Number(state.gptOAuthLastCheckedAt || 0);
  const stale = !checkedAt || (Date.now() - checkedAt) > GPT_OAUTH_STATUS_STALE_MS;
  const needsRecheck = !!state.gptOAuthStatusError
    || !state.gptOAuthStatus
    || !isGptOAuthConnected()
    || stale;
  if (!needsRecheck) return state.gptOAuthStatus;
  try {
    return await refreshGptOAuthStatus({ silent: options.silent !== false });
  } catch (_) {
    return state.gptOAuthStatus || null;
  }
}

async function openGptOAuthLogin(force = false) {
  // These buttons only refresh ChatGPT browser OAuth session (~/.codex/auth.json).
  // They do NOT reset Codex usage limits / model quotas.
  if (force) {
    const ok = confirm([
      '강제 재로그인: 기존 ChatGPT 로그인 세션을 지우고 다시 로그인 창을 엽니다.',
      '',
      '의미 있는 경우: 세션 만료, 계정 변경, auth.json 손상.',
      '의미 없는 경우: 사용량 한도(리밋) 해제. 재로그인해도 한도는 그대로입니다.',
      '',
      '계속할까요?',
    ].join('\n'));
    if (!ok) return;
  }
  state.gptOAuthStatusLoading = true;
  state.gptOAuthStatusError = '';
  render();
  try {
    const res = await fetch(`${GPT_OAUTH_API_BASE}/api/llm/chatgpt-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ force: !!force }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data?.error || data?.message || `로그인 실행 실패 (${res.status})`);
    setUiNotice(
      force
        ? '강제 재로그인 창을 열었습니다. Chrome에서 ChatGPT 승인 후 상태 새로고침 → 실호출 점검을 누르세요. (한도 리셋 기능 아님)'
        : 'Chrome 로그인 창을 열었습니다. 세션이 없을 때만 필요합니다. 승인 후 상태 새로고침 → 실호출 점검을 누르세요.',
      'info'
    );
  } catch(e) {
    const msg = e?.message || String(e);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      state.gptOAuthStatusError = `API Hub 연결 실패 (${GPT_OAUTH_API_BASE}). 바탕화면 API Hub.lnk 실행 후 다시 시도하세요.`;
    } else {
      state.gptOAuthStatusError = msg;
    }
  } finally {
    state.gptOAuthStatusLoading = false;
    render();
    setTimeout(() => refreshGptOAuthStatus({ silent: false }), 1600);
  }
}

function formatGptOAuthBridgeError(data, status = '') {
  const raw = [
    data?.error,
    data?.message,
    data?.reason,
    data?.diagnostic,
  ].filter(Boolean).join('\n');
  if (/not supported when using Codex with a ChatGPT account|model is not supported/i.test(raw)) {
    return '선택 모델(예: GPT-5.3 Codex Spark)은 ChatGPT 계정 OAuth 경로에서 지원되지 않습니다. ChatGPT 앱에 보이는 Spark 한도와 무관합니다. Gemini 또는 한도 여유 있는 GPT-5.4/5.5를 사용하세요.';
  }
  if (/codex-usage-limit|usage limit|rate limit|quota|too many requests|429|insufficient_quota|billing|사용량|한도/i.test(raw)) {
    return 'Codex/ChatGPT GPT OAuth 사용량 한도에 도달해 AI 판독을 진행하지 못했습니다. 잠시 후 다시 시도하거나 모델/추론 강도를 낮춰주세요. (Chrome 재로그인으로 한도는 풀리지 않습니다.)';
  }
  if (/codex-exit-1/i.test(raw)) {
    return 'Codex GPT OAuth 실행이 실패했습니다(codex-exit-1). 모델 미지원·사용량 한도·세션 문제일 수 있습니다. 모델 설정의 "실호출 점검"으로 원인을 확인하세요.';
  }
  return data?.error || data?.message || (status ? `GPT OAuth bridge HTTP ${status}` : 'GPT OAuth bridge 호출 실패');
}

function formatAppErrorMessage(message) {
  const text = String(message || '');
  if (/The user aborted a request|AbortError|aborted a request/i.test(text)) {
    const formatted = text.replace(/The user aborted a request\.?/gi, 'Cafe24/API Hub 응답 대기 중 요청이 중단되었습니다. 사용자가 직접 취소한 뜻이 아니라 응답 시간이 길어져 브라우저가 끊은 상태입니다.')
      .replace(/AbortError:?/gi, '요청 중단:')
      .trim();
    const parts = formatted.split(/\s*·\s*/).map(part => part.trim()).filter(Boolean);
    return parts
      .filter((part, index) => !parts.slice(0, index).some(prev => prev.includes(part)))
      .join(' · ');
  }
  if (/codex-usage-limit|usage limit|rate limit|quota|too many requests|429|insufficient_quota|billing|사용량|한도/i.test(text)) {
    return text.replace(/codex-usage-limit|codex-exit-\d+/gi, '').trim()
      || 'Codex/ChatGPT GPT OAuth 사용량 한도에 도달해 AI 판독을 진행하지 못했습니다. 잠시 후 다시 시도하거나 모델/추론 강도를 낮춰주세요.';
  }
  if (/codex-exit-1/i.test(text)) {
    return text.replace(/codex-exit-1/gi, 'Codex GPT OAuth 실행 실패: 사용량 한도, ChatGPT 로그인 세션 만료, 또는 Codex 런타임 오류 가능').trim();
  }
  return text;
}

function normalizeGptOAuthModelId(modelId = '') {
  const raw = String(modelId || '').trim();
  // Keep Spark id as-is (ChatGPT OAuth supports gpt-5.3-codex-spark).
  // Do NOT map Spark -> gpt-5.3-codex (that id is rejected on ChatGPT OAuth).
  if (raw === 'codex-spark' || raw === 'gpt-5.3-codex-spark-preview') return 'gpt-5.3-codex-spark';
  return raw || 'gpt-5.6-sol';
}

const GPT_OAUTH_IMAGE_ANALYSIS_FALLBACKS = Object.freeze({
  'gpt-5.3-codex-spark': 'gpt-5.5',
  'gpt-5.3-codex': 'gpt-5.5',
});

function getGptOAuthImageAnalysisRoute(modelId = '', serviceTier = '') {
  const requestedModel = normalizeGptOAuthModelId(modelId || 'gpt-5.6-sol');
  const requestedServiceTier = normalizeGptOAuthServiceTier(serviceTier || 'standard');
  const imageModelId = GPT_OAUTH_IMAGE_ANALYSIS_FALLBACKS[requestedModel] || requestedModel;
  const usedFallback = imageModelId !== requestedModel;
  return {
    requestedModel,
    requestedServiceTier,
    modelId: imageModelId,
    serviceTier: usedFallback ? 'standard' : requestedServiceTier,
    usedFallback,
    notice: usedFallback
      ? `${getGptOAuthModelLabel(requestedModel)}은 현재 상세페이지 픽셀 판독이 보장되지 않아, 이번 이미지 분석만 ${getGptOAuthModelLabel(imageModelId)} 표준 경로로 자동 전환했습니다.`
      : '',
  };
}

/** Model-specific service tier / OAuth support policy. Login "connected" != call will succeed. */
function gptOAuthModelTierPolicy(modelId = '') {
  const uiId = String(modelId || state?.modelConfig?.llmModel || '').trim();
  const bridgeId = normalizeGptOAuthModelId(uiId);
  const meta = (LLM_PROVIDERS.gpt_oauth?.models || []).find(m => m.id === uiId || m.id === bridgeId) || null;
  const isSpark = bridgeId === 'gpt-5.3-codex-spark' || /spark/i.test(uiId);
  // Plain gpt-5.3-codex is still rejected on ChatGPT OAuth; Spark is the supported codex family id.
  const oauthUnsupported = !!(meta?.oauthUnsupported || bridgeId === 'gpt-5.3-codex');
  if (oauthUnsupported) {
    return {
      bridgeModelId: bridgeId,
      allowFast: false,
      allowFlex: false,
      forcedTier: 'standard',
      oauthUnsupported: true,
      note: 'gpt-5.3-codex 는 ChatGPT OAuth에서 거절됩니다. 같은 계열이면 gpt-5.3-codex-spark 를 선택하세요.',
    };
  }
  if (isSpark) {
    return {
      bridgeModelId: bridgeId,
      allowFast: false,
      allowFlex: false,
      forcedTier: 'standard',
      oauthUnsupported: false,
      note: 'GPT-5.3 Codex Spark 는 ChatGPT OAuth에서 사용 가능합니다. 고속(fast) 티어는 없고 표준만 씁니다. (ChatGPT 앱 Spark 한도와 연동)',
    };
  }
  return {
    bridgeModelId: bridgeId,
    allowFast: true,
    allowFlex: true,
    forcedTier: '',
    oauthUnsupported: false,
    note: '고속은 사용량이 더 들 수 있습니다. 선택한 모델의 ChatGPT OAuth 한도와 워크스페이스 권한을 사용합니다.',
  };
}

function getGptOAuthSelectedModelId() {
  const cfg = normalizeModelConfig(state?.modelConfig || {});
  if (cfg.llmProvider === 'gpt_oauth') return cfg.llmModel || 'gpt-5.6-sol';
  return cfg.llmModel || 'gpt-5.6-sol';
}

function summarizeGptOAuthProbe(probe = state?.gptOAuthProbe) {
  if (!probe || !probe.at) {
    return {
      kind: 'untested',
      label: '실호출 미점검',
      color: 'var(--text-m)',
      detail: '로그인 세션 연결과 실제 모델 호출 성공은 다릅니다. 아래 "실호출 점검"으로 확인하세요.',
    };
  }
  if (probe.kind === 'ok' && probe.ok) {
    return {
      kind: 'ok',
      label: '실호출 성공',
      color: 'var(--ok)',
      detail: `${probe.model || '-'} · ${probe.serviceTier || 'standard'} · ${new Date(probe.at).toLocaleTimeString('ko-KR')}`,
    };
  }
  if (probe.kind === 'model-unsupported' || /not supported when using Codex with a ChatGPT account|oauth-model-unsupported/i.test(String(probe.reason || '') + String(probe.error || '') + String(probe.diagnostic || ''))) {
    return {
      kind: 'model-unsupported',
      label: '이 모델 OAuth 미지원',
      color: 'var(--err)',
      detail: probe.error || 'ChatGPT 계정 OAuth 경로에서 이 모델이 거절됩니다. 앱에 보이는 Spark 한도와 무관합니다.',
    };
  }
  if (probe.kind === 'usage-limit' || /usage.?limit|한도|quota|429/i.test(String(probe.reason || '') + String(probe.error || ''))) {
    return {
      kind: 'usage-limit',
      label: '사용량 한도 초과',
      color: 'var(--err)',
      detail: probe.error || 'Codex/ChatGPT 사용량 한도입니다. 로그인 재시도와 무관합니다. 모델 변경 또는 한도 회복을 기다리세요.',
    };
  }
  if (probe.kind === 'network') {
    return {
      kind: 'network',
      label: 'API Hub 연결 실패',
      color: 'var(--err)',
      detail: probe.error || 'API Hub(4321)가 꺼져 있을 수 있습니다.',
    };
  }
  return {
    kind: 'call-failed',
    label: '실호출 실패',
    color: 'var(--warn)',
    detail: [probe.error, probe.reason, probe.diagnostic].filter(Boolean).join(' · ').slice(0, 320)
      || '모델 호출이 실패했습니다. 로그인 세션은 있어도 실행은 안 될 수 있습니다.',
  };
}

async function probeGptOAuthLiveCall(options = {}) {
  if (!state) return null;
  state.gptOAuthProbeLoading = true;
  state.gptOAuthStatusError = '';
  if (!options.silent) render();
  const uiModel = options.model || getGptOAuthSelectedModelId();
  const policy = gptOAuthModelTierPolicy(uiModel);
  const bridgeModel = policy.bridgeModelId;
  const serviceTier = policy.allowFast
    ? normalizeGptOAuthServiceTier(options.serviceTier || state?.modelConfig?.gptOAuthServiceTier || 'standard')
    : 'standard';
  try {
    // Known-unsupported on ChatGPT OAuth path — don't waste a call; explain clearly.
    if (policy.oauthUnsupported) {
      state.gptOAuthProbe = {
        at: Date.now(),
        model: bridgeModel,
        uiModel,
        serviceTier: 'standard',
        ok: false,
        kind: 'model-unsupported',
        reason: 'chatgpt-oauth-model-unsupported',
        error: `모델 '${bridgeModel}'은 ChatGPT 계정 OAuth 경로에서 지원되지 않습니다. (Codex: not supported when using Codex with a ChatGPT account) ChatGPT 앱의 Spark 한도 표시와 무관합니다.`,
        diagnostic: policy.note || '',
        usedGptOAuth: false,
        textPreview: '',
      };
      state.gptOAuthStatusError = state.gptOAuthProbe.error;
      return state.gptOAuthProbe;
    }
    if (!isGptOAuthConnected()) {
      await refreshGptOAuthStatus({ silent: true });
    }
    const res = await fetch(`${GPT_OAUTH_API_BASE}/api/gpt-oauth/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        prompt: 'Reply with exactly: OK',
        model: bridgeModel,
        reasoningEffort: normalizeGptOAuthReasoningEffort(options.reasoningEffort || state?.modelConfig?.gptOAuthReasoningEffort || 'low'),
        serviceTier,
        timeoutMs: 90000,
        jsonOnly: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const reason = String(data.reason || '');
    const errorText = String(data.error || data.message || '');
    const diag = String(data.diagnostic || '');
    const blob = `${reason}\n${errorText}\n${diag}`;
    const isUnsupported = /not supported when using Codex with a ChatGPT account|model is not supported/i.test(blob);
    const isLimit = reason === 'codex-usage-limit'
      || /usage.?limit|rate.?limit|quota|한도|429|insufficient_quota/i.test(blob);
    const ok = !!(res.ok && data.ok === true && data.usedGptOAuth === true);
    state.gptOAuthProbe = {
      at: Date.now(),
      model: bridgeModel,
      uiModel,
      serviceTier,
      ok,
      kind: ok ? 'ok' : (isUnsupported ? 'model-unsupported' : (isLimit ? 'usage-limit' : 'call-failed')),
      reason: isUnsupported ? 'chatgpt-oauth-model-unsupported' : reason,
      error: isUnsupported
        ? `모델 '${bridgeModel}'은 ChatGPT 계정 OAuth에서 거절됩니다. ChatGPT 앱 Spark 한도와 별개입니다.`
        : (errorText || (ok ? '' : `GPT OAuth exec HTTP ${res.status}`)),
      diagnostic: diag.slice(0, 420),
      usedGptOAuth: data.usedGptOAuth === true,
      textPreview: String(data.text || '').slice(0, 40),
    };
    if (isUnsupported) {
      state.gptOAuthStatusError = state.gptOAuthProbe.error;
    } else if (isLimit) {
      state.gptOAuthStatusError = '사용량 한도 초과: 로그인 세션은 살아 있어도 모델 호출이 거절됩니다. Chrome 재로그인은 한도를 늘리지 않습니다.';
    } else if (!ok) {
      state.gptOAuthStatusError = `실호출 실패 (${bridgeModel}): ${errorText || reason || res.status}`;
    } else {
      state.gptOAuthStatusError = '';
    }
    return state.gptOAuthProbe;
  } catch (e) {
    const msg = e?.message || String(e);
    const network = /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
    state.gptOAuthProbe = {
      at: Date.now(),
      model: bridgeModel,
      uiModel,
      serviceTier,
      ok: false,
      kind: network ? 'network' : 'call-failed',
      reason: network ? 'network' : 'exception',
      error: network
        ? `API Hub 연결 실패 (${GPT_OAUTH_API_BASE}). 바탕화면 API Hub를 실행하세요.`
        : msg,
      diagnostic: '',
      usedGptOAuth: false,
    };
    state.gptOAuthStatusError = state.gptOAuthProbe.error;
    return state.gptOAuthProbe;
  } finally {
    state.gptOAuthProbeLoading = false;
    if (!options.silent) render();
  }
}

class GptOAuthAPI {
  constructor(model, options = {}) {
    this.model = normalizeGptOAuthModelId(model || 'gpt-5.6-sol');
    this.reasoningEffort = normalizeGptOAuthReasoningEffort(options.reasoningEffort || state?.modelConfig?.gptOAuthReasoningEffort);
    this.serviceTier = normalizeGptOAuthServiceTier(options.serviceTier || state?.modelConfig?.gptOAuthServiceTier);
    this.baseUrl = (options.baseUrl || GPT_OAUTH_API_BASE).replace(/\/+$/, '');
  }

  async _exec(prompt, options = {}) {
    const body = {
      prompt: String(prompt || ''),
      model: normalizeGptOAuthModelId(options.model || this.model),
      reasoningEffort: normalizeGptOAuthReasoningEffort(options.reasoningEffort || this.reasoningEffort),
      serviceTier: normalizeGptOAuthServiceTier(options.serviceTier || this.serviceTier),
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120000,
      jsonOnly: options.jsonOnly !== false,
    };
    if (options.imageBase64) {
      body.imageBase64 = options.imageBase64;
      body.mimeType = options.mimeType || options.mime || 'image/png';
    }
    if (Array.isArray(options.images) && options.images.length) {
      body.images = options.images.map((img, idx) => ({
        base64: img?.base64 || img?.imageBase64 || img?.data || '',
        mimeType: img?.mimeType || img?.mime || 'image/png',
        name: img?.name || `첨부 이미지 ${idx + 1}`,
      })).filter(img => img.base64);
    }
    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(Number(body.timeoutMs || 120000) + 15000, 45000), 315000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let data;
    try {
      res = await fetch(`${this.baseUrl}/api/gpt-oauth/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      data = await res.json().catch(() => ({ ok: false, error: `GPT OAuth bridge HTTP ${res.status}` }));
    } catch(e) {
      if (e?.name === 'AbortError') throw new Error(`GPT OAuth 호출이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다. API Hub 상태를 확인한 뒤 다시 실행해주세요.`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !data.ok) throw new Error(formatGptOAuthBridgeError(data, res?.status));
    if (data.usedGptOAuth !== true || data.rawTokenReturned === true) {
      throw new Error('GPT OAuth 응답 검증에 실패했습니다. usedGptOAuth/rawTokenReturned 상태를 확인해주세요.');
    }
    tokenTracker.record(body.model, null, null, false, options.purpose || 'GPT OAuth');
    return String(data.text || '');
  }

  async _execJson(prompt, options = {}) {
    const text = await this._exec(prompt, { ...options, jsonOnly: true });
    return parseJsonObjectFromText(text);
  }

  async analyzeImage(imageBase64, mimeType, extraImages = []) {
    const images = buildGptOAuthImagePayloads(imageBase64, mimeType, extraImages, {
      label: '제품 이미지',
      limit: 8,
    });
    if (!images.length) throw new Error('GPT OAuth 이미지 판독에 사용할 원본 이미지 데이터가 없습니다.');
    const analysis = await this._execJson(buildProductImageAnalysisPrompt(), {
      purpose: 'GPT OAuth 이미지 판독',
      images,
      timeoutMs: 180000,
    });
    analysis.llm_auth_mode = 'chatgpt-login-oauth';
    analysis.llm_auth_note = '제품 이미지 판독과 텍스트 추론을 모두 API Hub GPT OAuth/ChatGPT 로그인 세션으로 수행했습니다.';
    analysis.gpt_oauth_model = this.model;
    analysis.gpt_oauth_image_count = images.length;
    return analysis;
  }

  async generateSectionContent(sectionDef, productAnalysis, customInstructions, competitorRef) {
    const prompt = buildSectionContentProviderPrompt(
      sectionDef,
      productAnalysis,
      customInstructions,
      competitorRef,
      { variant: 'gpt_oauth' },
    );
    return this._execJson(prompt, { purpose: '섹션생성' });
  }

  async searchSimilarProducts(productName, category) {
    const prompt = `You are a Korean e-commerce market analyst.
For the product "${productName}" in the category "${category}", provide competitor analysis.
Return ONLY JSON:
{
  "similar_products": [
    {"name":"product name","price_range":"price","strengths":"key strength","detail_page_style":"description"}
  ],
  "market_insights": "brief market analysis in Korean",
  "detail_page_trends": ["current detail page design trend"],
  "recommended_approach": "recommended detail page strategy in Korean"
}
List 5-8 competitor products.`;
    return this._execJson(prompt, { purpose: '유사상품' });
  }

  async rankCafe24Candidates(context, candidates, options = {}) {
    const referenceImages = buildGptOAuthImagePayloads(null, null, [
      ...(options.primaryImg?.base64 ? [options.primaryImg] : []),
      ...(options.extraImgs || []),
    ], {
      label: '매칭 기준 제품 이미지',
      limit: 5,
    });
    const candidateImages = (Array.isArray(options.candidateImages) ? options.candidateImages : [])
      .filter(img => img?.base64)
      .slice(0, Math.max(0, 8 - referenceImages.length))
      .map((img, idx) => ({
        base64: img.base64,
        mimeType: img.mimeType || img.mime || 'image/jpeg',
        name: img.name || `Cafe24 후보 이미지 ${idx + 1} #${img.product_no || ''} ${img.product_name || ''}`.trim(),
      }));
    const images = [...referenceImages, ...candidateImages].slice(0, 8);
    const prompt = buildCafe24CandidateRankingPrompt({
      ...context,
      reference_image_count: referenceImages.length,
      candidate_image_count: candidateImages.length,
    }, candidates, 'GPT OAuth');
    return this._execJson(prompt, {
      purpose: 'Cafe24 후보 GPT 재랭킹',
      timeoutMs: 180000,
      images,
    });
  }

  async compareCafe24SinhwaOptions(payload = {}) {
    const prompt = `너는 한국 쇼핑몰 상품 DB 검수자다.
Cafe24 상품 옵션과 신화사DB 상품 옵션이 같은 제품 맥락인지 판정해라.

중요 기준:
- 상품명이 완전히 같지 않아도 핵심 제품명이 같고 수식어/용도어만 다르면 같은 맥락으로 본다.
  예: "방울수저집 수저주머니" 와 "방울수저집" 은 같은 맥락이다.
- 옵션명/옵션값이 색상, 사이즈, 수량 등 같은 축을 설명하면 일치에 가깝게 본다.
- 한쪽 옵션값이 일부만 있거나 DB가 비어 있으면 애매로 둔다.
- 서로 다른 제품군, 다른 형태, 다른 옵션 축이면 불일치다.
- 실제 저장값을 바꾸지 말고 검수 판단만 한다.

비교 데이터:
${JSON.stringify(payload, null, 2)}

반드시 JSON만 반환:
{
  "decision": "match | uncertain | mismatch",
  "score": 0,
  "label": "같은 맥락 | 검수 필요 | 불일치",
  "reason": "한국어로 짧게, 왜 그렇게 판단했는지",
  "name_relation": "상품명 관계 요약",
  "option_relation": "옵션명/옵션값 관계 요약"
}`;
    return this._execJson(prompt, {
      purpose: 'Cafe24/신화사 옵션 맥락 비교',
      timeoutMs: 120000,
    });
  }

  async structureCafe24FieldValue(payload = {}) {
    const apiField = String(payload.apiField || payload.fieldId || '').trim();
    const fieldLabel = String(payload.label || apiField || 'Cafe24 입력칸').trim();
    const sourceValue = String(payload.value || '').trim();
    const currentTargetValue = payload.currentTargetValue === undefined ? '' : payload.currentTargetValue;
    const currentTargetText = String(payload.currentTargetText || '').trim();
    const schemas = {
      product_volume: '{"use_product_volume":"T|F","unit":"mm|cm|inch 등","width":"숫자","height":"숫자","length":"숫자 또는 빈값"}',
      shipping_rates: '[{"key":"rate_1","minimum_amount":"숫자","maximum_amount":"숫자 또는 빈값","shipping_fee":"숫자, 무료는 0","description":"짧은 메모"}]',
      expiration_date: '{"start_date":"YYYY-MM-DD 또는 null","end_date":"YYYY-MM-DD 또는 null"}',
      icon_show_period: '{"start_date":"YYYY-MM-DD 또는 null","end_date":"YYYY-MM-DD 또는 null"}',
      promotion_period: '{"start_date":"YYYY-MM-DD 또는 null","end_date":"YYYY-MM-DD 또는 null"}',
      size_guide: '{"use":"T|F","type":"default","default":"","description":"설명 또는 null"}',
      additional_information: '[{"key":"custom_option1","name":"항목명","value":"값"}]',
    };
    const targetSchema = schemas[apiField] || '{"value":"구조화한 값"}';
    const prompt = `너는 Cafe24 상품등록 입력값 구조화 도우미다.
사용자가 신화사DB/수동 입력값을 Cafe24 입력칸으로 옮기려 한다.

규칙:
- 확실한 값만 구조화한다.
- 숫자 단위가 명확하면 숫자와 단위를 분리한다.
- 원문 값이 일부만 있고 현재 Cafe24 입력칸에 이미 단위/기본 구조가 있으면, 그 기존 값을 보존/활용해 목표 스키마를 완성한다.
- "무료" 배송비는 0으로 쓴다.
- 그래도 알 수 없는 값은 억지로 만들지 말고 decision을 "review"로 둔다.
- 결과는 반드시 JSON만 반환한다.

대상 Cafe24 필드:
- label: ${fieldLabel}
- apiField: ${apiField}
- target schema: ${targetSchema}

원문 값:
${sourceValue}

현재 Cafe24 입력칸 값(있으면 참고, 없으면 무시):
${currentTargetText || JSON.stringify(currentTargetValue, null, 2)}

반환 JSON:
{
  "decision": "structured | review",
  "payload": ${targetSchema},
  "reason": "한국어로 짧게"
}`;
    return this._execJson(prompt, {
      purpose: `Cafe24 ${fieldLabel} 구조화`,
      timeoutMs: 120000,
    });
  }

  async analyzeCompetitorImages(imagesArray) {
    const preparedImages = await prepareGptOAuthVisionImages(imagesArray, {
      maxDimension: 2048,
      maxPixels: 2_000_000,
      outputMime: 'image/jpeg',
      quality: 0.82,
    });
    const images = buildGptOAuthImagePayloads(null, null, preparedImages, {
      label: '경쟁사 상세페이지 이미지',
      limit: 8,
    });
    if (!images.length) throw new Error('GPT OAuth 경쟁사 이미지 판독에 사용할 원본 이미지 데이터가 없습니다.');
    const route = getGptOAuthImageAnalysisRoute(this.model, this.serviceTier);
    const result = await this._execJson(buildCompetitorImageAnalysisPrompt(), {
      purpose: 'GPT OAuth 경쟁사이미지',
      images,
      model: route.modelId,
      serviceTier: route.serviceTier,
      timeoutMs: 240000,
    });
    result.llm_auth_mode = 'chatgpt-login-oauth';
    result.llm_auth_note = '경쟁사 이미지 판독과 전략 평가를 모두 API Hub GPT OAuth/ChatGPT 로그인 세션으로 수행했습니다.';
    result.gpt_oauth_model = route.modelId;
    result.gpt_oauth_requested_model = route.requestedModel;
    result.gpt_oauth_image_fallback = route.usedFallback;
    if (route.notice) result.gpt_oauth_image_fallback_note = route.notice;
    result.gpt_oauth_image_count = images.length;
    return result;
  }

  async analyzeCompetitorHTML(htmlText) {
    const stripped = String(htmlText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);
    const prompt = `You are a senior Korean e-commerce detail page consultant.
Text extracted from a competitor detail page:
${stripped}

Analyze content structure, marketing strategy, copy tone, and reusable brand/style cues.
Return ONLY JSON:
{
  "page_title": "제품/페이지 제목",
  "sections_found": [{"index":1,"type":"header|hook|features|specs|other","headline":"헤드라인","body_summary":"본문 요약","has_image":false,"estimated_purpose":"목적"}],
  "overall_strategy": "전략 (한국어 2-3문장)",
  "selling_strategies": ["전략1"],
  "strengths": ["강점1"],
  "weaknesses": ["약점1"],
  "cta_patterns": ["CTA1"],
  "color_palette": [],
  "style_preset": {
    "preset_name": "프리셋 이름",
    "tone_manner": "톤앤매너",
    "required_keywords": ["키워드"],
    "banned_phrases": ["피해야 할 표현"],
    "headline_font_style": "헤드라인 폰트 느낌",
    "body_font_style": "본문 폰트 느낌",
    "accent_color": "",
    "background_color": "",
    "text_color": "",
    "image_direction": ["이미지 연출 방향"],
    "layout_style": "레이아웃 느낌",
    "visual_mood": "시각/카피 무드",
    "global_instruction": "브랜드 프리셋 지시문",
    "confidence": "high|medium|low"
  },
  "total_sections_count": 10,
  "page_score": {
    "total": 3.2,
    "grade": "F",
    "verdict": "한줄 총평",
    "top_priorities": ["① 개선사항"],
    "criteria": [{"name":"첫인상 & 헤더","icon":"🎯","score":5,"current_state":"현재 상태","issues":["문제점"],"to_perfect":"개선 방법"}]
  }
}`;
    return this._execJson(prompt, { purpose: '경쟁사HTML' });
  }

  async generateCompetitorSectionPlan(analysisResult, productAnalysis) {
    const sectionsInfo = SECTIONS.map(s => ({ id: s.id, name: s.name, purpose: s.purpose }));
    const prompt = `You are a Korean e-commerce detail page strategist.
Based on competitor analysis, create an optimized 15-section plan for OUR product.

=== COMPETITOR ANALYSIS ===
${JSON.stringify(analysisResult).substring(0, 4000)}

=== OUR PRODUCT ===
${productAnalysis ? JSON.stringify(productAnalysis).substring(0, 2000) : '제품 분석 전. 일반적 전략으로 추천.'}

=== 15 SECTIONS ===
${JSON.stringify(sectionsInfo)}

Return ONLY JSON:
{
  "strategy_summary": "전략 요약 (한국어 2-3문장)",
  "key_differentiators": ["차별화1","차별화2"],
  "recommended_sections": [{"section_id":"header","enabled":true,"recommended_instructions":"한국어 구체적 지시사항 3-5문장","competitor_reference":"경쟁사 방식","improvement_suggestions":"개선 포인트"}]
}
IMPORTANT: include all 15 section_id values.`;
    return this._execJson(prompt, { purpose: '섹션플랜' });
  }
}

// ════════════════════════════════════════════════════════════════
// CLAUDE SUBSCRIPTION OAUTH (API Hub 브리지)
// ════════════════════════════════════════════════════════════════
// API Hub 가 Claude Code CLI 로 Claude.ai 구독 로그인 세션을 호출한다.
// 앱은 OAuth 를 직접 구현하지 않고 브리지 엔드포인트만 부른다(브리지 규약).
// 브리지는 프롬프트 텍스트만 받으므로 이미지 판독·생성은 지원하지 않는다.
const CLAUDE_OAUTH_API_BASE = GPT_OAUTH_API_BASE;

function normalizeClaudeOAuthModelId(value) {
  const allowed = (LLM_PROVIDERS.claude_oauth?.models || []).map(m => m.id);
  const raw = String(value || '').trim();
  return allowed.includes(raw) ? raw : (allowed[0] || 'claude-opus-5');
}

function normalizeClaudeOAuthEffort(value) {
  const allowed = CLAUDE_OAUTH_EFFORTS.map(e => e.id);
  const raw = String(value || '').trim();
  return allowed.includes(raw) ? raw : 'high';
}

function isClaudeOAuthConnected() {
  const s = state?.claudeOAuthStatus;
  if (!s || typeof s !== 'object') return false;
  // 브리지가 명시한 passCondition 을 그대로 따른다.
  return s.claudeLoginReady === true
    && s.mode === 'claude-subscription-oauth'
    && s.usesApiKey === false;
}

async function refreshClaudeOAuthStatus(options = {}) {
  if (!state) return null;
  state.claudeOAuthStatusLoading = true;
  state.claudeOAuthStatusError = '';
  if (!options.silent) render();
  try {
    const res = await fetch(`${CLAUDE_OAUTH_API_BASE}/api/claude-oauth/status`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || `API Hub HTTP ${res.status}`);
    }
    state.claudeOAuthStatus = data.oauthStatus || null;
    state.claudeOAuthOptions = data.options || null;
    state.claudeOAuthLastCheckedAt = Date.now();
    state.claudeOAuthStatusError = '';
    return state.claudeOAuthStatus;
  } catch (e) {
    const msg = e?.message || String(e);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      state.claudeOAuthStatusError = `API Hub 연결 실패 (${CLAUDE_OAUTH_API_BASE}). 바탕화면 API Hub를 실행한 뒤 다시 시도하세요.`;
    } else {
      state.claudeOAuthStatusError = msg;
    }
    return null;
  } finally {
    state.claudeOAuthStatusLoading = false;
    if (!options.silent) render();
  }
}

// 실행 직전에 낡거나 실패한 캐시만 다시 확인한다(GPT OAuth 와 같은 이유).
async function ensureClaudeOAuthStatusFresh(options = {}) {
  if (!state) return null;
  if (state.claudeOAuthStatusLoading) return state.claudeOAuthStatus || null;
  const checkedAt = Number(state.claudeOAuthLastCheckedAt || 0);
  const stale = !checkedAt || (Date.now() - checkedAt) > GPT_OAUTH_STATUS_STALE_MS;
  const needsRecheck = !!state.claudeOAuthStatusError || !state.claudeOAuthStatus || !isClaudeOAuthConnected() || stale;
  if (!needsRecheck) return state.claudeOAuthStatus;
  try {
    return await refreshClaudeOAuthStatus({ silent: options.silent !== false });
  } catch (_) {
    return state.claudeOAuthStatus || null;
  }
}

async function openClaudeOAuthLogin(force = false) {
  state.claudeOAuthStatusLoading = true;
  state.claudeOAuthStatusError = '';
  render();
  try {
    const path = force ? '/api/claude-oauth/relogin' : '/api/claude-oauth/login';
    const res = await fetch(`${CLAUDE_OAUTH_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `Claude 로그인 실행 실패 (${res.status})`);
    setUiNotice(
      data?.alreadyReady
        ? 'Claude 구독 로그인은 이미 준비된 상태입니다.'
        : 'Claude.ai 로그인 창을 열었습니다. 승인 후 상태 새로고침을 눌러주세요.',
      'info',
    );
  } catch (e) {
    const msg = e?.message || String(e);
    state.claudeOAuthStatusError = /failed to fetch|networkerror/i.test(msg)
      ? `API Hub 연결 실패 (${CLAUDE_OAUTH_API_BASE}). API Hub를 실행한 뒤 다시 시도하세요.`
      : msg;
  } finally {
    state.claudeOAuthStatusLoading = false;
    render();
    setTimeout(() => refreshClaudeOAuthStatus({ silent: false }), 1600);
  }
}

// GptOAuthAPI 를 상속해 전송 계층만 바꾼다. 대형 분석 프롬프트를 다시 쓰지 않는다.
class ClaudeOAuthAPI extends GptOAuthAPI {
  constructor(model, options = {}) {
    super('gpt-5.6-sol', options);
    this.model = normalizeClaudeOAuthModelId(model);
    this.effort = normalizeClaudeOAuthEffort(options.effort || state?.modelConfig?.claudeOAuthEffort);
    this.baseUrl = String(options.baseUrl || CLAUDE_OAUTH_API_BASE).replace(/\/+$/, '');
    this.authMode = 'claude-subscription-oauth';
  }

  async _exec(prompt, options = {}) {
    const body = {
      prompt: String(prompt || ''),
      model: normalizeClaudeOAuthModelId(options.model || this.model),
      effort: normalizeClaudeOAuthEffort(options.effort || this.effort),
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 180000,
      jsonOnly: options.jsonOnly !== false,
    };
    if (options.imageBase64 || (Array.isArray(options.images) && options.images.length)) {
      throw new Error('Claude 구독 로그인 OAuth 브리지는 이미지 판독을 지원하지 않습니다. 이미지 분석은 GPT OAuth·OpenAI·로컬 Ollama를 사용하세요.');
    }
    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(Number(body.timeoutMs || 180000) + 15000, 45000), 315000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let data;
    try {
      res = await fetch(`${this.baseUrl}/api/claude-oauth/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      data = await res.json().catch(() => ({ ok: false, error: `Claude OAuth bridge HTTP ${res.status}` }));
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new Error(`Claude OAuth 호출이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다. API Hub 상태를 확인한 뒤 다시 실행해주세요.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !data.ok) {
      if (data?.loginRequired) {
        throw new Error('Claude 구독 로그인이 필요합니다. 모델 설정에서 Claude 로그인을 실행해주세요.');
      }
      throw new Error(String(data?.error || `Claude OAuth bridge 호출 실패 (${res.status})`));
    }
    // 브리지가 명시한 successContract 를 그대로 검증한다.
    if (data.usedClaudeOAuth !== true || data.rawTokenReturned === true) {
      throw new Error('Claude OAuth 응답 검증에 실패했습니다. usedClaudeOAuth/rawTokenReturned 상태를 확인해주세요.');
    }
    tokenTracker.record(body.model, null, null, false, options.purpose || 'Claude OAuth');
    return String(data.text || '');
  }

  async analyzeImage() {
    throw new Error('Claude 구독 로그인 OAuth 브리지는 이미지 판독을 지원하지 않습니다.');
  }

  async analyzeCompetitorImages() {
    throw new Error('Claude 구독 로그인 OAuth 브리지는 이미지 판독을 지원하지 않습니다. 이미지 분석 폴백은 OpenAI API 또는 로컬 Ollama를 사용하세요.');
  }

  async generateImage() {
    throw new Error('Claude 구독 로그인 OAuth 브리지는 이미지 생성을 지원하지 않습니다.');
  }
}

// ════════════════════════════════════════════════════════════════
// LLM ROUTER — 선택된 프로바이더/모델로 자동 분기
// ════════════════════════════════════════════════════════════════
function getLLMClient() {
  const cfg = normalizeModelConfig(state.modelConfig);
  state.modelConfig = cfg;
  if (cfg.llmProvider === 'gpt_oauth') {
    if ((state.gptOAuthStatus || state.gptOAuthStatusError) && !isGptOAuthConnected()) {
      // 조회 자체가 실패한 경우에는 원인 메시지(API Hub 미기동 등)를 그대로 보여준다.
      throw new Error(state.gptOAuthStatusError
        || 'GPT OAuth 연결 상태를 확인할 수 없습니다. 모델 설정에서 상태 새로고침 또는 Chrome 로그인을 진행해주세요.');
    }
    return new GptOAuthAPI(cfg.llmModel, {
      reasoningEffort: cfg.gptOAuthReasoningEffort,
      serviceTier: cfg.gptOAuthServiceTier,
    });
  }
  if (cfg.llmProvider === 'openai') {
    const openaiKey = getRuntimeOpenAIKey();
    if (!openaiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 모델 설정에서 입력해주세요.');
    return new OpenAIAPI(openaiKey, cfg.llmModel);
  }
  if (cfg.llmProvider === 'ollama') {
    return new OllamaAPI(cfg.llmModel, cfg.ollamaBaseUrl);
  }
  if (cfg.llmProvider === 'claude_oauth') {
    if ((state.claudeOAuthStatus || state.claudeOAuthStatusError) && !isClaudeOAuthConnected()) {
      throw new Error(state.claudeOAuthStatusError
        || 'Claude 구독 로그인 상태를 확인할 수 없습니다. 모델 설정에서 상태 새로고침 또는 Claude 로그인을 진행해주세요.');
    }
    return new ClaudeOAuthAPI(cfg.llmModel, { effort: cfg.claudeOAuthEffort });
  }
  if (!hasGeminiConnection()) throw new Error('Gemini 연결 설정(API Key 또는 Backend URL)이 필요합니다.');
  return createGeminiClient(cfg.llmModel);
}

// ── LLM 폴백: 사용량 한도로 막혔을 때만 지정한 대체 모델로 한 번 더 시도 ──────
// 한도 판정은 formatGptOAuthBridgeError 와 같은 기준을 쓴다.
const LLM_USAGE_LIMIT_PATTERN =
  /codex-usage-limit|usage.?limit|rate.?limit|quota|too many requests|\b429\b|insufficient_quota|billing|사용량|한도/i;

function isLlmUsageLimitError(error) {
  return LLM_USAGE_LIMIT_PATTERN.test(String(error?.message || error || ''));
}

function llmFallbackPlan(cfg = normalizeModelConfig(state.modelConfig), method = '') {
  if (!cfg.fallbackEnabled || cfg.fallbackProvider === 'none') return null;
  // 지정한 폴백을 먼저 보고, 그 provider 가 요청 메서드를 못 하면 다음 후보로 넘어간다.
  const ordered = [cfg.fallbackProvider, ...LLM_FALLBACK_PRIORITY.filter(id => id !== cfg.fallbackProvider)];
  for (const providerId of ordered) {
    if (providerId === 'none' || !LLM_PROVIDERS[providerId]) continue;
    if (method && !providerSupportsLlmMethod(providerId, method)) continue;
    const preferred = providerId === cfg.fallbackProvider ? String(cfg.fallbackModel || '') : '';
    const models = LLM_PROVIDERS[providerId].models || [];
    const model = models.some(m => m.id === preferred) ? preferred : (models[0]?.id || '');
    if (!model) continue;
    if (providerId === cfg.llmProvider && model === cfg.llmModel) continue;
    const label = LLM_PROVIDERS[providerId].label || providerId;
    const modelLabel = models.find(m => m.id === model)?.label || model;
    return { provider: providerId, model, label, modelLabel, cfg };
  }
  return null;
}

function createLlmFallbackClient(plan) {
  if (plan.provider === 'claude_oauth') return new ClaudeOAuthAPI(plan.model, { effort: plan.cfg.claudeOAuthEffort });
  if (plan.provider === 'ollama') return new OllamaAPI(plan.model, plan.cfg.ollamaBaseUrl);
  if (plan.provider === 'openai') {
    const key = getRuntimeOpenAIKey();
    if (!key) throw new Error('폴백 대상이 OpenAI API인데 API 키가 없습니다. 모델 설정에서 키를 입력하세요.');
    return new OpenAIAPI(key, plan.model);
  }
  throw new Error(`지원하지 않는 폴백 provider: ${plan.provider}`);
}

// method 를 기본 클라이언트로 실행하고, 사용량 한도 실패일 때만 폴백으로 재시도한다.
// onFallback 은 화면 로그용 알림 훅이다(선택).
async function runLlmWithFallback(method, args = [], options = {}) {
  const cfg = normalizeModelConfig(state.modelConfig);
  const primary = options.client || getLLMClient();
  try {
    return await primary[method](...args);
  } catch (primaryError) {
    const plan = llmFallbackPlan(cfg, method);
    if (!plan || !isLlmUsageLimitError(primaryError)) throw primaryError;
    let fallbackClient;
    try {
      fallbackClient = createLlmFallbackClient(plan);
    } catch (setupError) {
      throw new Error(`${primaryError.message}\n폴백도 사용할 수 없습니다: ${setupError.message}`);
    }
    if (typeof options.onFallback === 'function') {
      options.onFallback({ plan, reason: primaryError.message || String(primaryError) });
    }
    try {
      const result = await fallbackClient[method](...args);
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        result.__fallbackUsed = { provider: plan.provider, model: plan.model, label: plan.label, modelLabel: plan.modelLabel };
      }
      return result;
    } catch (fallbackError) {
      throw new Error(
        `${primaryError.message}\n폴백(${plan.label} · ${plan.modelLabel})도 실패했습니다: ${fallbackError.message || fallbackError}`,
      );
    }
  }
}

function getAnalysisEngineModel(engine, settings = null) {
  const s = settings || normalizeAnalysisMatchSettings(state.analysisMatchSettings);
  if (engine === 'gpt_oauth') return normalizeAnalysisProviderModel('gpt_oauth', s.gptOAuthModel);
  if (engine === 'gemini') return normalizeAnalysisProviderModel('gemini', s.geminiModel);
  return normalizeModelConfig(state.modelConfig).llmModel;
}

function getAnalysisEngineClient(engine, settings = null) {
  const selected = normalizeAnalysisAiEngine(engine);
  const s = settings || normalizeAnalysisMatchSettings(state.analysisMatchSettings);
  if (selected === 'current') return getLLMClient();
  if (selected === 'gpt_oauth') {
    if ((state.gptOAuthStatus || state.gptOAuthStatusError) && !isGptOAuthConnected()) {
      // 조회 자체가 실패한 경우에는 원인 메시지(API Hub 미기동 등)를 그대로 보여준다.
      throw new Error(state.gptOAuthStatusError
        || 'GPT OAuth 연결 상태를 확인할 수 없습니다. 모델 설정에서 상태 새로고침 또는 Chrome 로그인을 진행해주세요.');
    }
    return new GptOAuthAPI(getAnalysisEngineModel('gpt_oauth', s), {
      reasoningEffort: state.modelConfig.gptOAuthReasoningEffort,
      serviceTier: state.modelConfig.gptOAuthServiceTier,
    });
  }
  if (selected === 'gemini') {
    if (!hasGeminiConnection()) throw new Error('Gemini 연결 설정(API Key 또는 Backend URL)이 필요합니다. 모델 설정 탭에서 Gemini 연결을 먼저 저장해주세요.');
    return createGeminiClient(getAnalysisEngineModel('gemini', s));
  }
  throw new Error('이 엔진은 LLM 클라이언트가 필요 없는 로컬 점수 모드입니다.');
}

function hasLlmConnection() {
  const cfg = normalizeModelConfig(state.modelConfig);
  if (cfg.llmProvider === 'gpt_oauth') return isGptOAuthConnected();
  return cfg.llmProvider === 'openai' ? !!getRuntimeOpenAIKey() : hasGeminiConnection();
}

function hasGeminiConnection() {
  return !!((state.backendBaseUrl && state.backendBaseUrl.trim()) || state.apiKey);
}

function createGeminiClient(model) {
  return new GeminiAPI({
    apiKey: state.apiKey,
    model: model || state.modelConfig.llmModel,
    backendBaseUrl: state.backendBaseUrl,
  });
}

function getImageModel() {
  return state.modelConfig.imageModel || 'gemini-3.1-flash-image';
}

function getCurrentLlmRunInfo() {
  const cfg = normalizeModelConfig(state.modelConfig);
  const provider = LLM_PROVIDERS[cfg.llmProvider] || LLM_PROVIDERS.openai;
  const model = (provider.models || []).find(m => m.id === cfg.llmModel);
  const route = cfg.llmProvider === 'gpt_oauth'
    ? `API Hub · ChatGPT 로그인 OAuth · 추론 ${getGptOAuthReasoningLabel(cfg.gptOAuthReasoningEffort)} · 속도 ${getGptOAuthServiceTierLabel(cfg.gptOAuthServiceTier)}`
    : (cfg.llmProvider === 'gemini'
      ? (state.backendBaseUrl ? '백엔드/Vertex 연결' : 'Gemini API Key 연결')
      : 'OpenAI API 연결');
  return {
    providerId: cfg.llmProvider,
    providerLabel: provider.label || cfg.llmProvider,
    modelId: cfg.llmModel,
    modelLabel: model?.label || cfg.llmModel,
    route,
    authMode: cfg.llmProvider === 'gpt_oauth' ? 'chatgpt-login-oauth' : (cfg.llmProvider === 'openai' ? 'api-key' : 'gemini'),
    connected: hasLlmConnection(),
    reasoningEffort: cfg.llmProvider === 'gpt_oauth' ? cfg.gptOAuthReasoningEffort : '',
    serviceTier: cfg.llmProvider === 'gpt_oauth' ? cfg.gptOAuthServiceTier : '',
  };
}

function getAnalysisEngineRunInfo(engine, settings = null) {
  const selected = normalizeAnalysisAiEngine(engine, engine === 'local');
  const s = settings || normalizeAnalysisMatchSettings(state.analysisMatchSettings);
  if (selected === 'current') return getCurrentLlmRunInfo();
  if (selected === 'local') {
    return {
      providerId: 'local',
      providerLabel: '로컬 점수',
      modelId: 'local-cafe24-score',
      modelLabel: '규칙 기반 후보 점수',
      route: '브라우저 로컬 점수',
      authMode: 'local',
      connected: true,
    };
  }
  const provider = LLM_PROVIDERS[selected] || {};
  const modelId = getAnalysisEngineModel(selected, s);
  const model = (provider.models || []).find(item => item.id === modelId);
  const route = selected === 'gpt_oauth'
    ? `API Hub · ChatGPT 로그인 OAuth · 추론 ${getGptOAuthReasoningLabel(state.modelConfig.gptOAuthReasoningEffort)} · 속도 ${getGptOAuthServiceTierLabel(state.modelConfig.gptOAuthServiceTier)}`
    : (state.backendBaseUrl ? '백엔드/Vertex 연결' : 'Gemini API Key 연결');
  return {
    providerId: selected,
    providerLabel: provider.label || selected,
    modelId,
    modelLabel: model?.label || modelId,
    route,
    authMode: selected === 'gpt_oauth' ? 'chatgpt-login-oauth' : 'gemini',
    connected: selected === 'gpt_oauth' ? isGptOAuthConnected() : hasGeminiConnection(),
    reasoningEffort: selected === 'gpt_oauth' ? state.modelConfig.gptOAuthReasoningEffort : '',
    serviceTier: selected === 'gpt_oauth' ? state.modelConfig.gptOAuthServiceTier : '',
  };
}

function renderModelRunLine(info, fallback = 'LLM 미사용') {
  if (!info) return fallback;
  const label = info.modelLabel || info.modelId || fallback;
  const id = info.modelId && info.modelId !== label ? ` · ${info.modelId}` : '';
  const provider = info.providerLabel || info.providerId || '';
  const route = info.route ? ` · ${info.route}` : '';
  return `${provider ? `${provider} · ` : ''}${label}${id}${route}`;
}

const DESKTOP_API_ICON_NAMES = {
  apiHub: 'API Hub',
  sinhwa: '신화사 DB 허브',
  cafe24: 'Cafe24 Control Tower',
  detailAutomation: '상세페이지 AI 자동화',
  jepumScraper: 'JepumScraper',
  competitorMonitor: '경쟁사 모니터',
};

const API_BADGE_COLORS = [
  '#60a5fa',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#a78bfa',
  '#14b8a6',
  '#f97316',
  '#38bdf8',
  '#eab308',
  '#f43f5e',
  '#84cc16',
  '#c084fc',
];

function apiStatusLevelLabel(level) {
  if (level === 'ok') return '연결';
  if (level === 'warn') return '확인';
  return '경로';
}

function getConnectedApiStatusItems() {
  const cfg = normalizeModelConfig(state.modelConfig || {});
  const imageProvider = getImageProvider();
  const items = [];
  const add = item => {
    if (!item || !item.name) return;
    const key = item.key || item.name;
    if (items.some(existing => existing.key === key)) return;
    items.push({
      level: 'idle',
      detail: '',
      desktopIconName: '',
      ...item,
      key,
    });
  };

  add({
    key: 'api-hub',
    name: DESKTOP_API_ICON_NAMES.apiHub,
    desktopIconName: `${DESKTOP_API_ICON_NAMES.apiHub}.lnk`,
    level: 'ok',
    detail: `${GPT_OAUTH_API_BASE} · 공통 브리지`,
  });

  const gptSelectedOrReady = cfg.llmProvider === 'gpt_oauth' || isGptOAuthConnected();
  if (gptSelectedOrReady) {
    add({
      key: 'gpt-oauth',
      name: 'ChatGPT 로그인 OAuth',
      level: isGptOAuthConnected() ? 'ok' : 'warn',
      detail: `${getLlmModelLabel(cfg.llmModel, 'gpt_oauth') || cfg.llmModel} · ${getGptOAuthReasoningLabel(cfg.gptOAuthReasoningEffort)} · API Hub`,
    });
  }

  const geminiUsed = cfg.llmProvider === 'gemini' || imageProvider === 'gemini' || !!state.apiKey || !!state.backendBaseUrl;
  if (geminiUsed) {
    const modelLabels = [
      cfg.llmProvider === 'gemini' ? getLlmModelLabel(cfg.llmModel, 'gemini') || cfg.llmModel : '',
      imageProvider === 'gemini' ? getImageModelLabel(cfg.imageModel) : '',
    ].filter(Boolean);
    add({
      key: 'gemini',
      name: 'Google Gemini',
      level: hasGeminiConnection() ? 'ok' : 'warn',
      detail: `${modelLabels.join(' / ') || '모델 선택됨'} · ${state.backendBaseUrl ? `백엔드 ${state.backendBaseUrl}` : (state.apiKey ? 'API Key 저장됨' : '키 필요')}`,
    });
  }

  const openAiUsed = cfg.llmProvider === 'openai' || imageProvider === 'openai' || !!getRuntimeOpenAIKey();
  if (openAiUsed) {
    add({
      key: 'openai',
      name: 'OpenAI API',
      level: getRuntimeOpenAIKey() ? 'ok' : 'warn',
      detail: `${cfg.llmProvider === 'openai' ? getLlmModelLabel(cfg.llmModel, 'openai') || cfg.llmModel : getImageModelLabel(cfg.imageModel)} · ${getRuntimeOpenAIKey() ? '키 저장됨' : '키 필요'}`,
    });
  }

  add({
    key: 'sinhwa-db',
    name: DESKTOP_API_ICON_NAMES.sinhwa,
    desktopIconName: `${DESKTOP_API_ICON_NAMES.sinhwa}.lnk`,
    level: 'ok',
    detail: `API Hub connector ${SINHWA_DB_API.connectorId} · 직접 ${SINHWA_DB_API.directBase}`,
  });

  add({
    key: 'cafe24-control',
    name: DESKTOP_API_ICON_NAMES.cafe24,
    desktopIconName: `${DESKTOP_API_ICON_NAMES.cafe24}.lnk`,
    level: 'ok',
    detail: `API Hub connector ${CAFE24_CONTROL_API.connectorId}`,
  });

  const serverDriveReady = !!state.auto?.serverConfig?.driveConnection?.ready;
  add({
    key: 'detail-automation',
    name: DESKTOP_API_ICON_NAMES.detailAutomation,
    desktopIconName: `${DESKTOP_API_ICON_NAMES.detailAutomation}.lnk`,
    level: state.auto?.serverConfig ? 'ok' : (state.auto?.serverError ? 'warn' : 'idle'),
    detail: `${state.auto?.serverApiBase || defaultServerAutomationApiBase()} · image-cuts/detail-page${serverDriveReady ? ' · Drive ready' : ''}`,
  });

  add({
    key: 'jepum-scraper',
    name: DESKTOP_API_ICON_NAMES.jepumScraper,
    desktopIconName: `${DESKTOP_API_ICON_NAMES.jepumScraper}.lnk`,
    level: state.backendBaseUrl ? 'ok' : 'warn',
    detail: `${(state.backendBaseUrl || 'http://127.0.0.1:5050').replace(/\/+$/, '')}/api/jepum-scraper`,
  });

  add({
    key: 'competitor-monitor',
    name: DESKTOP_API_ICON_NAMES.competitorMonitor,
    desktopIconName: `${DESKTOP_API_ICON_NAMES.competitorMonitor}.lnk`,
    level: state.compPage?.backendOk === true ? 'ok' : (state.compPage?.backendOk === false ? 'warn' : 'idle'),
    detail: `${(state.compPage?.scraperBase || 'http://127.0.0.1:5001').replace(/\/+$/, '')}/api/competitor · /api/health`,
  });

  const driveConfigured = state.auto?.driveConnected || state.auto?.gdClientId || state.auto?.serverConfig?.driveConnection;
  if (driveConfigured) {
    const serverDrive = state.auto?.serverConfig?.driveConnection || null;
    add({
      key: 'google-drive',
      name: 'Google Drive API',
      level: state.auto?.driveConnected || serverDrive?.ready ? 'ok' : 'warn',
      detail: serverDrive?.accountEmail || (state.auto?.driveConnected ? '브라우저 OAuth 연결됨' : 'OAuth 설정 필요'),
    });
  }

  return items;
}

function getNumberedApiStatusItems() {
  return getConnectedApiStatusItems().map((item, index) => ({
    ...item,
    apiNumber: index + 1,
    apiColor: API_BADGE_COLORS[index % API_BADGE_COLORS.length],
  }));
}

function apiKeyForProvider(providerId) {
  if (providerId === 'gpt_oauth') return 'gpt-oauth';
  if (providerId === 'gemini') return 'gemini';
  if (providerId === 'openai') return 'openai';
  if (providerId === 'api_hub_openai') return 'api-hub';
  return '';
}

function uniqueApiKeys(keys) {
  return [...new Set((keys || []).filter(Boolean))];
}

function getCurrentAiApiKeys({ llm = true, image = true } = {}) {
  const cfg = normalizeModelConfig(state.modelConfig || {});
  const keys = [];
  if (llm) keys.push(apiKeyForProvider(cfg.llmProvider));
  if (image) keys.push(apiKeyForProvider(getImageProvider()));
  return uniqueApiKeys(keys);
}

function getAnalysisMatchApiKeys() {
  const keys = [];
  try {
    const settings = typeof getAnalysisMatchSettings === 'function' ? getAnalysisMatchSettings() : null;
    if (settings?.imageInferenceEngine && settings.imageInferenceEngine !== 'current') {
      keys.push(apiKeyForProvider(settings.imageInferenceEngine));
    }
    if (settings?.cafe24RankEngine && settings.cafe24RankEngine !== 'current' && settings.cafe24RankEngine !== 'local') {
      keys.push(apiKeyForProvider(settings.cafe24RankEngine));
    }
  } catch(e) {}
  return uniqueApiKeys(keys);
}

function getApiKeysForStep(step, visibleKeys = []) {
  const currentAi = getCurrentAiApiKeys();
  const currentImage = getCurrentAiApiKeys({ llm: false, image: true });
  const analysisAi = uniqueApiKeys([...currentAi, ...getAnalysisMatchApiKeys()]);
  const visible = new Set(visibleKeys);
  const visibleOr = keys => uniqueApiKeys(keys).filter(key => visible.has(key));

  if (step === 'modelsettings') return visibleOr(visibleKeys);
  const map = {
    upload: [],
    analyzing: ['api-hub', ...analysisAi, 'sinhwa-db', 'cafe24-control'],
    competitor: ['competitor-monitor', ...currentAi],
    sections: [...currentAi],
    generating: [...currentAi],
    preview: ['google-drive'],
    imagecuts: ['detail-automation', ...currentImage],
    optionsorter: [...analysisAi, ...currentImage],
    factory: ['api-hub', ...analysisAi, ...currentImage, 'sinhwa-db', 'cafe24-control', 'competitor-monitor', 'detail-automation', 'google-drive'],
    automation: ['detail-automation', 'google-drive', 'gemini'],
    manual: [],
  };
  return visibleOr(map[step] || []);
}

function renderApiNumberBadge(item, className = 'nav-api-badge') {
  if (!item) return '';
  const title = `${item.apiNumber}번 · ${item.name}${item.desktopIconName ? ` · 바탕화면 아이콘: ${item.desktopIconName}` : ''}`;
  return `<span class="${className}" style="--api-color:${escAttr(item.apiColor)}" title="${escAttr(title)}" aria-label="${escAttr(title)}">${item.apiNumber}</span>`;
}

function renderNavApiBadges(step, apiMap) {
  const keys = getApiKeysForStep(step, [...apiMap.keys()]);
  if (!keys.length) return '';
  const labels = keys.map(key => {
    const item = apiMap.get(key);
    return item ? `${item.apiNumber}번 ${item.name}` : '';
  }).filter(Boolean);
  return `<span class="nav-api-badges" title="${escAttr(labels.join(' · '))}" aria-label="${escAttr(labels.join(' · '))}">
    ${keys.map(key => renderApiNumberBadge(apiMap.get(key))).join('')}
  </span>`;
}

function renderApiStatusStrip() {
  const items = getNumberedApiStatusItems();
  if (!items.length) return '';
  const collapsed = (() => {
    try { return localStorage.getItem('api_status_collapsed') === '1'; } catch(e) { return false; }
  })();
  const okCount = items.filter(item => item.level === 'ok').length;
  const warnCount = items.filter(item => item.level === 'warn').length;
  const idleCount = items.filter(item => item.level === 'idle').length;
  const summary = `${items.length}개 API · 연결 ${okCount} · 확인 ${warnCount} · 경로 ${idleCount}`;
  return `<div class="api-status-wrap" aria-label="연결 API 표시">
    <div class="api-status-strip ${collapsed ? 'collapsed' : ''}">
      <span class="api-status-title"><span class="material-icons-outlined" style="font-size:13px">lan</span> 연결 API</span>
      <span class="api-status-summary">${escapeHtml(summary)}</span>
      ${items.map(item => {
        const detailParts = [
          item.desktopIconName ? `바탕화면 아이콘: ${item.desktopIconName}` : '',
          item.detail || '',
          `상태: ${apiStatusLevelLabel(item.level)}`,
        ].filter(Boolean);
        return `<span class="api-status-chip ${item.level}" style="--api-color:${escAttr(item.apiColor)}" title="${escAttr(`${item.apiNumber}번 · ${detailParts.join(' · ')}`)}">
          <span class="api-status-no">${item.apiNumber}</span>
          <i class="api-status-dot"></i>
          <b>${escapeHtml(item.name)}</b>
          <span>${escapeHtml(apiStatusLevelLabel(item.level))}</span>
        </span>`;
      }).join('')}
      <button class="api-status-toggle" id="toggleApiStatusStrip" type="button" title="${collapsed ? '연결 API 전체 보기' : '연결 API 요약만 보기'}">
        <span class="material-icons-outlined" style="font-size:13px">${collapsed ? 'unfold_more' : 'unfold_less'}</span>${collapsed ? '펼치기' : '접기'}
      </button>
    </div>
  </div>`;
}

function getLlmModelLabel(modelId, providerId = null) {
  const providers = providerId && LLM_PROVIDERS[providerId]
    ? [LLM_PROVIDERS[providerId]]
    : Object.values(LLM_PROVIDERS);
  for (const provider of providers) {
    const found = (provider.models || []).find(m => m.id === modelId);
    if (found) return found.label;
  }
  return modelId || '';
}

function getImageModelLabel(modelId) {
  return getImageModelMeta(modelId)?.label || modelId || '';
}

function getCurrentImageRunInfo(modelId = null) {
  const imageModelId = modelId || getImageModel();
  const providerId = getImageProvider(imageModelId);
  const apiHubOpenAI = providerId === 'api_hub_openai';
  return {
    providerId,
    providerLabel: apiHubOpenAI ? 'OpenAI API Hub' : providerId === 'openai' ? 'OpenAI' : 'Google Gemini',
    modelId: imageModelId,
    modelLabel: getImageModelLabel(imageModelId),
    route: apiHubOpenAI
      ? 'API Hub 저장 연결'
      : providerId === 'openai'
      ? 'OpenAI API 연결'
      : (state.backendBaseUrl ? '백엔드/Vertex 연결' : 'Gemini API Key 연결'),
  };
}

const SINHWA_DB_API = {
  hubBase: 'http://127.0.0.1:4321',
  directBase: 'http://127.0.0.1:8200',
  connectorId: 'db_7db4f9f8f4074c80',
  endpoints: {
    search: 'api-search-api-v1-search-get_0cd83217e9d84714',
    detail: 'api-product-detail-api-v1-products-jcode-get_ccdaa741b2864607',
  },
};

const ANALYSIS_RUN_STALE_MS = 6 * 60 * 1000;
const ANALYSIS_DB_MATCH_TIMEOUT_MS = 45000;

