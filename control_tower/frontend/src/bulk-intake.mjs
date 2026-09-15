import {
  appendBulkProductRows,
  fillBulkProductRequiredValues,
  BLOCKING_ISSUES,
  buildBulkPlan,
  buildProductPayload,
  groupImageFiles,
  hydrateWorkingState,
  looksLikeCameraFileName,
  readSizePair,
  isSupportedImage,
  parseIntakeCsv,
  readImageName,
  readBulkQueueReceipt,
  serializeWorkingState,
  summarizeBulkIntake,
} from './bulk-intake-model.mjs?bulkIntake=14';
import { loadCafe24Categories } from './intake-categories.mjs?intakeCategories=1';
import { assertInputPolicySnapshot, inputPolicySummary, renderInputPolicyGrid, resolveInputPolicy, setInputDecision } from './automation-policy-model.mjs?automationPolicy=5';
import { beginProductSourceRequest, beginProductSourceSelection, buildProductFieldSummary, cancelProductSourceRequests, commitProductField,
  finishProductSourceRequest, finishProductSourceSelection, setProductFieldDraft } from './bulk-intake-source.mjs?bulkIntakeSource=1';

/**
 * '전체 자동' 이 실제로 무엇을 대신 정하는지 사람 말로. 값만 보여 주면 그 값이 뭘
 * 하는 건지는 여전히 몰라야 정상이다 — 실측 2026-09-03: 이 값이 숨은 화면(hidden
 * manual-intake-panel)의 기본값을 조용히 물려받고 있었고, 조작자는 그 존재조차 몰랐다.
 */
const AUTOMATION_PRESET_COPY = Object.freeze({
  full_auto: '대표·사이즈·색상옵션·이미지컷·섹션·최종 상세페이지까지 전부 AI가 고릅니다. 생산·A컷에서 언제든 다시 고를 수 있습니다.',
  representative_manual: '대표 이미지만 사람이 고릅니다. 나머지는 AI가 고릅니다.',
  representative_and_size_manual: '대표·사이즈 이미지를 사람이 고릅니다. 나머지는 AI가 고릅니다.',
  all_images_manual: '이미지컷까지 모든 생성 이미지를 사람이 고릅니다. 섹션·최종은 AI가 고릅니다.',
  custom: '아래 공정별 설정과 각 제품의 개별 설정을 적용합니다.',
});

// 회색 글씨는 보기일 뿐 값이 아니다. '주방' 처럼만 적어 두면 이미 채워진 것처럼 읽혀서,
// 아래 카드가 "분류 비어 있음" 이라고 말하는 것과 서로 어긋나 보인다. 보기라고 못박는다.
//
// 필드 기준은 조립공장의 직접 입력 폼(intake-form 의 required-*)이다 — 사람이 넣어야만 하는
// 값이 곧 이 폼의 전부다. 조립공장이 스스로 만드는 값은 여기 두지 않는다.
const DEFAULT_FIELDS = Object.freeze([
  { key: 'category', label: '상품 종류', placeholder: '예: 지갑, 수저집, 보자기', group: 'product' },
  { key: 'material', label: '소재', placeholder: '예: 면 100%', group: 'product' },
  { key: 'originCountry', label: '원산지', placeholder: '예: 대한민국', group: 'product' },
  { key: 'size', label: '크기', placeholder: '예: 20x15cm', group: 'product' },
  // 조립공장이 사이즈이미지를 그리려면 가로·세로가 숫자 두 개로 있어야 한다.
  // 크기에 '20x15' 처럼 적으면 아래 두 칸이 저절로 채워지고, 그 위에 직접 고칠 수 있다.
  { key: 'widthMm', label: '가로(mm)', placeholder: '예: 200', group: 'product' },
  { key: 'depthMm', label: '세로(mm)', placeholder: '예: 150', group: 'product' },
  { key: 'salePrice', label: '판매가', placeholder: '예: 12000', group: 'product' },
  // 재고는 조립공장 필수값인데 이 폼에만 빠져 있었다. 큐의 직접 입력 폼에는 있다.
  { key: 'stock', label: '재고', placeholder: '예: 99', group: 'product' },
  { key: 'usage', label: '용도', placeholder: '예: 생활', group: 'product' },
  // 여기서 고른 값이 Cafe24 등록까지 그대로 간다. 비워 두면 등록할 때 다시 고르면 된다.
  { key: 'cafe24CategoryId', label: '제품분류 번호', placeholder: '예: 119', group: 'cafe24' },
  { key: 'supplyPrice', label: '공급가', placeholder: '예: 500', group: 'cafe24' },
  { key: 'displayStatus', label: '진열', placeholder: '예: 진열안함', group: 'cafe24' },
  { key: 'sellingStatus', label: '판매', placeholder: '예: 판매안함', group: 'cafe24' },
]);

const NATIVE_EXTRA_FIELDS = Object.freeze([
  { key: 'category', label: '상품 종류', placeholder: '예: 보자기' },
  { key: 'originCountry', label: '원산지', placeholder: '예: 대한민국' },
  { key: 'displayStatus', label: '진열', select: true },
  { key: 'sellingStatus', label: '판매', select: true },
]);

const ISSUE_LABELS = Object.freeze({
  image_missing: '이미지 없음',
  product_name_missing: '제품명 비어 있음',
  product_name_from_file: '제품명이 사진 파일 이름 그대로입니다',
  base_image_missing: '기본 이미지 없음',
  color_name_missing: '옵션 사진에 색상명 없음',
  category_missing: '분류 비어 있음',
  sale_price_missing: '판매가 비어 있음',
  sale_price_invalid: '판매가는 원화 정수 12자리까지',
  supply_price_invalid: '공급가는 원화 정수만 입력',
  stock_invalid: '재고 자릿수 초과 (9자리까지)',
  size_mm_missing: '가로·세로 비어 있음',
  size_mm_invalid: '가로·세로가 2000mm 초과',
});

/**
 * 색상명을 어디서 가져올지. 세 갈래를 사람이 고른다.
 *
 * 파일명 규칙은 지어낸 것이 아니라 지금 쓰는 관례다 — 작업파일에 1.노랑 · 2번 이 그대로 있다.
 */
const COLOR_NAME_SOURCES = Object.freeze([
  { key: 'filename', label: '파일명', hint: '모시보자기_2_남색 → 남색' },
  { key: 'manual', label: '직접 입력', hint: '내가 타이핑' },
  { key: 'ai', label: 'AI 추천', hint: '사진을 보고 제안' },
]);

/** 색상명 앞에 붙일 번호 틀. {n} 은 몇 번째 색상인지, {색상} 은 색상명이다. */
const COLOR_NAME_PREFIXES = Object.freeze([
  { key: 'none', pattern: '{색상}' },
  { key: 'dot', pattern: '{n}.{색상}' },
  { key: 'dot-space', pattern: '{n}. {색상}' },
  { key: 'underscore', pattern: '{n}_{색상}' },
  { key: 'paren', pattern: '{n}) {색상}' },
  { key: 'pad-dot', pattern: '{nn}.{색상}' },
  { key: 'beon', pattern: '{n}번' },
]);

const COLOR_RULE_STORAGE_KEY = 'controlTower.bulkIntake.colorRule';
const DEFAULT_COLOR_RULE = Object.freeze({ source: 'filename', pattern: '{n}.{색상}' });

/** 저장해 둔 내 기본값을 읽는다. 없거나 깨졌으면 기본 조합을 쓴다. */
function loadColorRule() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLOR_RULE_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_COLOR_RULE };
    const source = COLOR_NAME_SOURCES.some(item => item.key === raw.source) ? raw.source : DEFAULT_COLOR_RULE.source;
    const pattern = typeof raw.pattern === 'string' && raw.pattern.trim() ? raw.pattern : DEFAULT_COLOR_RULE.pattern;
    return { source, pattern };
  } catch {
    return { ...DEFAULT_COLOR_RULE };
  }
}

/** 번호 틀을 실제 이름으로 편다. {색상} 이 없는 틀(‘2번’)은 색상명 없이도 뜻이 통한다. */
export function applyColorNamePattern(pattern, ordinal, colorName) {
  const name = String(colorName || '').trim();
  const text = String(pattern || DEFAULT_COLOR_RULE.pattern);
  if (!name && text.includes('{색상}')) return '';
  return text
    .replace(/\{nn\}/g, String(ordinal).padStart(2, '0'))
    .replace(/\{n\}/g, String(ordinal))
    .replace(/\{색상\}/g, name)
    .trim();
}

/**
 * 파일명에 적어 둔 색상명을 꺼낸다.
 *
 * 같은 제품으로 묶이려면 파일명에 번호가 있어야 한다(제품명_번호). 그래서 색상명을
 * 파일명에 담는 자리는 그 뒤다 — 제품명_번호_색상 (모시보자기_2_남색).
 * 번호 없이 제품명_색상 으로 적으면 그 자체가 다른 제품 이름이 되어 따로 떨어지므로,
 * 여기서 꼬리만 떼어 쓰면 제품명 일부를 색상명으로 잘못 넣게 된다.
 */
export function colorNameFromImage(image) {
  return String(image?.fileColorName || '').trim();
}

const thumbUrls = new WeakMap();

/** 고른 파일의 미리보기 주소를 한 번만 만든다. */
function thumbUrl(image) {
  const file = image?.file;
  if (!file) return '';
  if (!thumbUrls.has(file)) thumbUrls.set(file, URL.createObjectURL(file));
  return thumbUrls.get(file);
}

/** 썸네일을 누르면 원본 크기로 띄운다. */
function openLightbox(url, caption) {
  const overlay = element('div', 'bulk-lightbox');
  const image = document.createElement('img');
  // 크게 보는 그림은 원본이라 크다. 메인 스레드에서 풀면 화면 전체가 멎는다.
  // 실측 2026-08-25: 보드 확대창에서 같은 증상으로 화면 캡처가 30초 넘게 멈췄다.
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = url;
  image.alt = caption;
  const label = element('p', 'bulk-lightbox-caption', caption);
  const close = element('button', 'board-action ghost', '닫기');
  close.type = 'button';
  overlay.append(image, label, close);
  const dismiss = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  // 크게 본 뒤 돌아가는 길이 마우스뿐이면 답답하다. ESC 로도 닫는다.
  function onKey(event) {
    if (event.key === 'Escape') dismiss();
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target === close) dismiss();
  });
  document.body.append(overlay);
}

const SKIP_LABELS = Object.freeze({
  unsupported_type: '이미지 파일이 아님',
  product_name_missing: '제품명을 읽을 수 없음',
});

function element(tag, className = '', textContent = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

async function digestOf(file) {
  try {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export function mountBulkIntake(runtime, { root = document.getElementById('bulk-intake'), imageModels, presetOptions, getJudgmentSettings, intake = null } = {}) {
  if (!root || !runtime) return () => {};
  const { apiRequest } = runtime;
  const automation = runtime.automation || {};
  const apiHub = String(runtime.apiHub || '').replace(/\/+$/, '');

  /**
   * 제품별 자동화 정책을 잠근다. 큐의 직접 입력 폼과 같은 절차다.
   *
   * 이것 없이 투입하면 자동화 정책이 기본값으로 돌아가, 같은 제품이라도 어느 폼으로
   * 넣었느냐에 따라 자동/수동 판단이 달라진다. 잠근 스냅샷을 payload 에 실어 보낸다.
   */
  // 투입 요청에 마감시한을 둔다. 실측 2026-08-28: 탭 네트워크가 잠깐 막힌 사이 투입을 누르니
  // 요청이 거절도 응답도 없이 매달렸고, 화면은 「0/1 투입 중」인 채 모든 버튼이 잠긴 채로 남았다.
  // 사람은 무엇이 잘못됐는지도, 다시 누를 방법도 없었다. 못 가면 못 갔다고 말해야 한다.
  const SUBMIT_TIMEOUT_MS = 30000;

  /**
   * 조립공장이 돌려준 코드를 사람 말로 옮긴다.
   *
   * 'policy_identity_missing' 같은 코드를 그대로 보여 주면 무엇을 고쳐야 하는지 알 수 없다.
   * 모르는 코드는 지어내지 말고 그대로 보여 준다 — 거짓 설명이 코드보다 나쁘다.
   */
  function submitFailureCopy(error) {
    const code = String(error?.code || '');
    const known = {
      policy_identity_missing: '자동화 정책이 이 묶음에 붙지 않았습니다. 자동판단 화면에서 정책을 확인하고 다시 투입해 주세요.',
      policy_snapshot_missing: '자동화 정책 스냅샷이 없습니다. 자동판단 화면에서 정책을 고른 뒤 다시 투입해 주세요.',
      factory_product_color_name_required: '색상 옵션 사진에 색상명이 비어 있습니다.',
      factory_product_payload_invalid: '투입 값이 조립공장 규격과 맞지 않습니다.',
      csrf_required: '관제탑 세션이 끊겼습니다. 새로고침한 뒤 다시 투입해 주세요.',
      session_required: '관제탑 세션이 끊겼습니다. 새로고침한 뒤 다시 투입해 주세요.',
    };
    return known[code] || String(code || error?.message || error);
  }

  async function requestWithDeadline(path, options, timeoutMs = SUBMIT_TIMEOUT_MS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
      return await apiRequest(path, controller ? { ...options, signal: controller.signal } : options);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`관제탑이 ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않았습니다`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 이 제품의 정책을 잠근다.
   *
   * batchId 는 반드시 이 작업이 실제로 실릴 묶음 이름이어야 한다. 조립공장은 받은
   * policySnapshot 의 batchId·productId 가 작업의 것과 정확히 같은지 대조하고, 다르면
   * policy_identity_missing 으로 통째로 거절한다(factory_sync.py). 화면의 '생산 묶음 이름'
   * 칸을 그대로 쓰면 대량 투입이 만드는 묶음 이름과 어긋나 한 건도 들어가지 못한다 —
   * 실측 2026-08-28, 실제 투입에서 전건 거절.
   */
  function policyRequestFor(entry, batchId = '') {
    return {
      batchId: String(batchId),
      productId: String(entry.productName),
      preset: String(policySelect.value || '').trim() || 'full_auto',
      batchOverride: { ...decisionOverrides },
      productOverride: { ...(entry.decisionOverrides || {}) },
      stageOverride: {},
    };
  }

  async function lockPolicy(entry, batchId) {
    const policyRequest = policyRequestFor(entry, batchId);
    const expected = resolveInputPolicy(policyRegistry, policyRequest);
    const policySnapshot = await requestWithDeadline('/api/automation/policy/snapshot', {
      method: 'POST',
      body: JSON.stringify(policyRequest),
    });
    assertInputPolicySnapshot(policySnapshot, policyRequest, expected);
    return policySnapshot;
  }

  /**
   * 사진을 GPT 에 보여 주고 색상명 후보를 받아 온다.
   *
   * API Hub 는 chat/completions 를 열지 않는다(404). 실호출 경로는 /api/gpt-oauth/exec 이고
   * images 배열에 data: 접두사 없는 순수 base64 를 넣는다 — 실측 2026-08-27, ok=true 로 응답.
   * 모델과 추론 깊이는 자동판단 화면에서 사람이 고른 값을 그대로 보낸다.
   * API Hub 는 그 두 값이 없으면 gpt-oauth-selection-required 로 거절한다.
   */
  async function requestAiColorNames(targets) {
    if (!apiHub) throw new Error('API Hub 주소를 알 수 없습니다.');
    const judgment = await getJudgmentSettings?.();
    const model = String(judgment?.model || document.getElementById('model-select')?.value || '').trim();
    const reasoningEffort = String(judgment?.reasoningEffort || document.getElementById('reasoning-select')?.value || '').trim();
    if (!model || !reasoningEffort) throw new Error('자동판단 화면에서 판단 모델과 추론 깊이를 먼저 고르세요.');
    const shots = [];
    for (const target of targets) {
      const base64 = await pureBase64(target.image.file);
      if (!base64) continue;
      shots.push({ base64, mimeType: target.image.file?.type || 'image/png', name: target.image.fileName });
    }
    if (!shots.length) throw new Error('보낼 수 있는 사진이 없습니다.');
    const prompt = [
      '옷감·보자기 제품 사진들이다. 사진마다 옷감의 색을 한국어 색상명 후보 3개로 답하라.',
      '색상명은 2~4글자 명사만 쓴다(예: 남색, 산호, 연두). 설명 문장을 쓰지 마라.',
      '사진 순서는 아래 이름 순서와 같다:',
      shots.map((shot, index) => `${index + 1}. ${shot.name}`).join('\n'),
      'JSON 객체 하나만 출력한다. 키는 사진 이름, 값은 색상명 3개 배열이다.',
    ].join('\n');
    const response = await fetch(`${apiHub}/api/gpt-oauth/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model,
        reasoningEffort,
        serviceTier: String(judgment?.serviceTier || document.getElementById('tier-select')?.value || 'standard'),
        timeoutMs: 180000,
        jsonOnly: true,
        images: shots,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(String(body?.error || body?.message || `HTTP ${response.status}`));
    }
    return parseColorSuggestions(body.text, shots.map(shot => shot.name));
  }

  /** 파일을 data: 접두사 없는 순수 base64 로 바꾼다. API Hub 가 그 모양만 받는다. */
  function pureBase64(file) {
    if (!file) return Promise.resolve('');
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  /** 모델이 돌려준 글을 이름→후보 표로 만든다. 모양이 어긋나도 화면이 죽지 않게 한다. */
  function parseColorSuggestions(text, names) {
    const out = new Map();
    let parsed = null;
    try {
      parsed = JSON.parse(String(text || '').replace(/^```(?:json)?|```$/g, '').trim());
    } catch {
      parsed = null;
    }
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      for (const name of names) {
        const picks = parsed[name];
        if (Array.isArray(picks)) out.set(name, picks.map(pick => String(pick || '').trim()).filter(Boolean).slice(0, 3));
      }
    } else if (Array.isArray(parsed)) {
      names.forEach((name, index) => {
        const picks = parsed[index];
        if (Array.isArray(picks)) out.set(name, picks.map(pick => String(pick || '').trim()).filter(Boolean).slice(0, 3));
        else if (typeof picks === 'string' && picks.trim()) out.set(name, [picks.trim()]);
      });
    }
    return out;
  }

  let plan = { entries: [], unmatchedCsv: [], ready: 0, blocked: 0, warned: 0 };
  let grouped = { products: [], skipped: [] };
  let csvRows = [];
  let csvErrors = [];
  let defaults = {};
  let busy = false;
  let inputVersion = 0;
  let inputReads = 0;
  let status = { copy: '제품명을 적고 사진을 추가하세요. 준비한 제품은 작업큐에 추가할 수 있습니다.', tone: '' };
  let progress = null;
  let categoryItems = [];
  let categoryStatus = 'Cafe24 분류를 불러오는 중…';
  let categoryLoading = false;
  let selectedProductIndex = 0;
  const selectedForCommon = new Set();
  let commonValues = {};
  let decisionOverrides = { ...(automation.batchOverride || {}), ...(automation.productOverride || {}), ...(automation.stageOverride || {}) };
  let policyRegistry = null;
  let policyError = '공정 설정 불러오는 중';

  const heading = element('div', 'section-heading');
  const headingCopy = element('div');
  headingCopy.append(element('h2', '', '대량 제품 입력'), element('p', 'status-message', '여러 제품 준비 → 선택 제품 편집 → 작업큐에 추가'));
  heading.append(headingCopy);
  const queueButton = document.getElementById('go-batch-intake');
  const creator = element('div', 'bulk-product-creator');
  const newNameLabel = element('label', 'bulk-name-field');
  const newName = document.createElement('input');
  newName.id = 'bulk-new-product-name';
  newName.placeholder = '제품명부터 입력하세요 · 예: 색동동전지갑';
  newNameLabel.append(element('span', '', '새 제품명'), newName);
  const addProduct = element('button', 'board-action', '＋ 제품 추가');
  addProduct.id = 'bulk-add-product';
  addProduct.type = 'button';
  creator.append(newNameLabel, addProduct);
  function createNamedProduct() {
    const productName = newName.value.trim();
    if (!productName) { newName.focus(); setStatus('먼저 새 제품명을 입력해 주세요.', 'warn'); return; }
    restoreCancelled = true;
    const existing = grouped.products.findIndex(item => !item.queued && item.productName === productName);
    if (existing < 0) grouped.products.push({ productName, images: [], inheritDefaults: false });
    newName.value = '';
    selectedProductIndex = existing < 0 ? grouped.products.length - 1 : existing;
    rebuild();
    const index = existing < 0 ? grouped.products.length - 1 : existing;
    root.querySelector(`[data-focus-key="product-name:${index}"]`)?.focus();
    setStatus(`${productName} · 선택 제품 편집에서 기본 사진과 상품정보를 채워 주세요.`);
  }
  addProduct.addEventListener('click', createNamedProduct);
  newName.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); createNamedProduct(); }
  });

  const multiRow = element('div', 'bulk-multi-row');
  const pasteLabel = element('label', 'bulk-paste-field');
  const pasteInput = document.createElement('textarea');
  pasteInput.id = 'bulk-product-rows';
  pasteInput.rows = 3;
  pasteInput.placeholder = '카드지갑\n색동동전지갑\n모시보자기';
  pasteLabel.append(element('span', '', '여러 제품명 · 한 줄에 하나씩 입력'), pasteInput);
  const pasteActions = element('div', 'bulk-paste-actions');
  const pasteAdd = element('button', 'board-action', '여러 제품을 목록에 추가');
  pasteAdd.id = 'bulk-add-rows';
  pasteAdd.type = 'button';
  pasteActions.append(pasteAdd, element('p', 'status-message', '표도 붙여넣을 수 있습니다. 첫 줄에 제품명·소재·크기·판매가 등 열 제목을 포함하세요. 기존 제품은 덮어쓰지 않습니다.'));
  multiRow.append(pasteLabel, pasteActions);
  pasteAdd.addEventListener('click', () => {
    if (busy || restorePending) return;
    const firstNew = grouped.products.length;
    const result = appendBulkProductRows(grouped.products, pasteInput.value);
    if (result.added) {
      restoreCancelled = true;
      selectedProductIndex = firstNew;
      pasteInput.value = '';
      rebuild();
    }
    setStatus(`${result.added}개 제품을 추가했습니다${result.duplicates ? ` · 중복 ${result.duplicates}개는 기존 입력 보존` : ''}${result.errors.length ? ' · 표의 제품명 열과 빈 이름을 확인하세요' : ''}.`, result.errors.length || !result.added ? 'warn' : 'ok');
  });

  const pickers = element('div', 'bulk-pickers');
  const imageLabel = element('label', 'bulk-picker');
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.multiple = true;
  imageInput.accept = 'image/*';
  imageInput.id = 'bulk-image-input';
  imageLabel.append(element('span', '', '파일명으로 여러 제품 한번에 묶기'), imageInput);

  const csvLabel = element('label', 'bulk-picker');
  const csvInput = document.createElement('input');
  csvInput.type = 'file';
  csvInput.accept = '.csv,.tsv,.txt';
  csvInput.id = 'bulk-csv-input';
  csvLabel.append(element('span', '', '제품 정보 CSV (선택)'), csvInput);
  pickers.append(imageLabel, csvLabel);

  // 사람이 넣어야만 하는 조립공장 필수값은 항상 보이고, Cafe24 등록값(선택)은 접어 둔다.
  // 열한 칸이 한 줄에 쏟아지면 무엇이 필수인지 읽히지 않는다.
  const defaultsBox = element('div', 'bulk-defaults');
  const factoryRow = element('div', 'bulk-defaults-row');
  factoryRow.append(element('span', 'bulk-defaults-label', '기존 저장 제품의 공통값'));
  const cafe24Details = document.createElement('details');
  cafe24Details.className = 'bulk-defaults-extra';
  const cafe24Summary = document.createElement('summary');
  cafe24Summary.textContent = 'Cafe24 등록값 (선택)';
  cafe24Details.append(cafe24Summary);
  const cafe24Row = element('div', 'bulk-defaults-row');
  cafe24Details.append(cafe24Row);
  for (const field of DEFAULT_FIELDS) {
    const label = element('label', 'bulk-default-field');
    label.dataset.group = field.group || 'product';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = field.placeholder;
    input.dataset.defaultKey = field.key;
    label.append(element('span', '', field.label), input);
    (field.group === 'cafe24' ? cafe24Row : factoryRow).append(label);
  }
  defaultsBox.append(factoryRow, cafe24Details);

  // 색상명 규칙은 자주 만지는 것이 아니다. 접어 두고, 지금 조합만 제목에 보여 준다.
  const colorRuleDetails = document.createElement('details');
  colorRuleDetails.className = 'bulk-color-rule';
  const colorRuleSummary = document.createElement('summary');
  colorRuleDetails.append(colorRuleSummary);
  const colorRuleBox = element('div', 'bulk-color-rule-body');
  colorRuleDetails.append(colorRuleBox);
  const bulkBar = element('div', 'bulk-batch-bar');

  // 자동화 방식 · 이미지 생성 모델 — 이 두 값은 예전에 숨은 옛 직접 입력 폼
  // (#image-model-select, #batch-policy · manual-intake-panel, hidden) 에서 조용히
  // 읽어 왔다. 조작자는 그 폼을 본 적이 없어 자신이 뭘 골랐는지도 몰랐다 — 실측
  // 2026-09-03: "자동 수동 선택하는것도 나 한번도 인식하지못했어. 내가 정하게끔
  // 해놨어야지." 이제 이 화면 자체에 보이는 컨트롤을 두고, 값은 여기서만 가져온다.
  const legacyImageModelSelect = document.getElementById('image-model-select');
  const legacyPolicySelect = document.getElementById('batch-policy');
  const automationBox = element('div', 'bulk-automation-box');
  const automationHead = element('div', 'bulk-automation-head');
  automationHead.append(
    element('strong', '', '자동화 설정'),
    element('span', 'status-message', '큐에 추가하기 전에 모델과 컷 선택 방식을 확인하세요.'),
  );
  const automationRow = element('div', 'bulk-automation-row');
  const imageModelField = element('label', 'field-stack');
  const imageModelSelect = document.createElement('select');
  imageModelSelect.id = 'bulk-image-model-select';
  imageModelSelect.innerHTML = legacyImageModelSelect ? legacyImageModelSelect.innerHTML : '';
  if (imageModels) imageModelSelect.replaceChildren(...imageModels.map(item => new Option(item.label, item.id)));
  if (legacyImageModelSelect) imageModelSelect.value = legacyImageModelSelect.value;
  imageModelField.append(element('span', '', '이미지 생성 모델'), imageModelSelect);
  const policyField = element('label', 'field-stack');
  const policySelect = document.createElement('select');
  policySelect.id = 'bulk-automation-preset-select';
  policySelect.innerHTML = legacyPolicySelect ? legacyPolicySelect.innerHTML : '';
  if (presetOptions) policySelect.replaceChildren(...presetOptions.map(item => new Option(item.label, item.id)));
  if (legacyPolicySelect) policySelect.value = legacyPolicySelect.value;
  policyField.append(element('span', '', '자동화 방식'), policySelect);
  automationRow.append(imageModelField, policyField);
  const automationCopy = element('p', 'status-message bulk-automation-copy');
  automationBox.append(automationHead, automationRow, automationCopy);
  const policyDetails = document.createElement('details');
  policyDetails.className = 'bulk-policy-details';
  policyDetails.open = true;
  policyDetails.append(element('summary', '', '공통 공정 설정 · 제품별로 바꿀 수 있습니다'));
  const policyGrid = element('div');
  const policyReload = element('button', 'bulk-mini-action', '설정 다시 읽기');
  policyReload.type = 'button';
  policyReload.addEventListener('click', () => { void loadInputPolicy(); });
  policyDetails.append(element('p', 'status-message', '직접 선택도 후보 이미지는 생성합니다. 생성 후 사람이 컷을 고릅니다. 이미 큐에 추가한 제품의 설정은 바뀌지 않습니다.'), policyGrid, policyReload);
  automationBox.append(policyDetails);
  async function loadInputPolicy() {
    try {
      policyRegistry = await requestWithDeadline('/api/automation/policy', {});
      resolveInputPolicy(policyRegistry, policyRequestFor({ productName: '' }));
      policyError = '';
    } catch (error) {
      policyError = String(error.message || error);
    }
    render();
  }
  function renderPolicyControls() {
    policyReload.disabled = busy || restorePending;
    try {
      const resolved = resolveInputPolicy(policyRegistry, policyRequestFor({ productName: '' }));
      policyGrid.replaceChildren(renderInputPolicyGrid({ registry: policyRegistry, overrides: decisionOverrides, resolved, disabled: busy || restorePending, onChange(id, mode) {
        decisionOverrides = setInputDecision(decisionOverrides, id, mode, policyRegistry.decisionPointIds);
        invalidateConfirmation();
        render();
        queueWorkingSave();
      } }));
      policyError = '';
    } catch (error) {
      policyError = String(error.message || error);
      policyGrid.replaceChildren(element('p', 'status-message', policyError));
    }
  }
  function renderAutomationCopy() {
    automationCopy.textContent = `기본 방식: ${AUTOMATION_PRESET_COPY[policySelect.value] || ''} 아래 공통 공정 설정과 제품별 설정이 우선합니다.`;
  }
  imageModelSelect.addEventListener('change', () => { invalidateConfirmation(); render(); queueWorkingSave(); });
  policySelect.addEventListener('change', () => { renderAutomationCopy(); invalidateConfirmation(); render(); queueWorkingSave(); });
  renderAutomationCopy();

  const actions = element('div', 'bulk-actions bulk-queue-actions');
  const submit = element('button', 'board-action primary', '입력 완료 제품 모두 추가');
  submit.id = 'bulk-queue-submit';
  submit.type = 'button';
  submit.dataset.action = 'submit';
  submit.dataset.queueScope = 'all';
  const submitSelected = element('button', 'board-action primary', '선택한 제품 추가');
  submitSelected.id = 'bulk-queue-submit-selected';
  submitSelected.type = 'button';
  submitSelected.dataset.action = 'submit';
  submitSelected.dataset.queueScope = 'selected';
  const reset = element('button', 'board-action ghost', '고른 파일 비우기');
  reset.type = 'button';
  reset.dataset.action = 'reset';
  const hint = element('span', 'board-toolbar-hint');
  hint.style.wordBreak = 'keep-all';
  actions.append(submitSelected, submit);
  if (queueButton) actions.append(queueButton);
  heading.append(actions);

  const statusNode = element('p', 'status-message');
  statusNode.id = 'bulk-intake-status';
  statusNode.setAttribute('role', 'status');
  statusNode.setAttribute('aria-live', 'polite');
  const table = element('div', 'bulk-plan');

  const commonBox = element('details', 'bulk-common-fields');
  const commonSummary = element('summary');
  const commonActions = element('div', 'bulk-common-actions');
  const commonAll = element('button', 'bulk-mini-action', '입력 제품 전체 선택');
  commonAll.type = 'button';
  commonAll.id = 'bulk-common-select-all';
  const commonApply = element('button', 'board-action', '선택 제품 빈칸 채우기');
  commonApply.type = 'button';
  commonApply.id = 'bulk-common-apply';
  commonActions.append(commonAll, commonApply);
  const commonFields = element('div', 'bulk-product-fields');
  const commonCategoryLabel = element('label', 'bulk-default-field');
  const commonCategory = document.createElement('select');
  commonCategory.id = 'bulk-common-category';
  commonCategory.dataset.commonKey = 'cafe24CategoryId';
  commonCategoryLabel.append(element('span', '', 'Cafe24 상품분류'), commonCategory);
  commonFields.append(commonCategoryLabel);
  for (const field of DEFAULT_FIELDS.filter(item => item.group === 'product' && !['widthMm', 'depthMm'].includes(item.key))) {
    const label = element('label', 'bulk-default-field');
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.commonKey = field.key;
    input.placeholder = field.placeholder;
    input.setAttribute('aria-label', `공통 ${field.label}`);
    label.append(element('span', '', field.label), input);
    commonFields.append(label);
  }
  commonBox.append(commonSummary, element('p', 'status-message', '체크는 제품만 선택합니다. 공통값 적용과 큐 추가는 각각의 버튼에서 실행합니다. 공통값은 기존 입력을 유지하고 빈칸만 채웁니다.'), commonFields, commonActions);
  function renderCommonControls() {
    const targets = grouped.products.filter(group => !group.queued && selectedForCommon.has(group));
    commonSummary.textContent = `공통 필수값 · 선택 ${targets.length}개 제품에 적용`;
    commonApply.disabled = busy || restorePending || !targets.length;
    commonAll.disabled = busy || restorePending || !grouped.products.some(group => !group.queued);
    commonCategory.replaceChildren(element('option', '', '분류 선택 · 적용할 때만 빈칸 채움'));
    commonCategory.firstElementChild.value = '';
    for (const item of categoryItems) {
      const option = element('option', '', `${item.label} · #${item.id}`);
      option.value = item.id;
      commonCategory.append(option);
    }
    commonCategory.value = commonValues.cafe24CategoryId || '';
    for (const input of commonBox.querySelectorAll('[data-common-key]')) input.disabled = busy || restorePending;
  }
  commonBox.addEventListener('input', event => {
    const key = event.target?.dataset?.commonKey;
    if (!key) return;
    commonValues[key] = event.target.value;
    if (key === 'cafe24CategoryId') {
      const selected = categoryItems.find(item => item.id === event.target.value);
      if (selected) {
        commonValues.category = selected.name;
        commonBox.querySelector('[data-common-key="category"]').value = selected.name;
      }
    }
    queueWorkingSave();
  });
  commonAll.addEventListener('click', () => {
    const targets = grouped.products.filter(group => !group.queued);
    const clear = targets.every(group => selectedForCommon.has(group));
    for (const group of targets) clear ? selectedForCommon.delete(group) : selectedForCommon.add(group);
    invalidateConfirmation();
    render();
    queueWorkingSave();
  });
  commonApply.addEventListener('click', () => {
    if (busy || restorePending) return;
    let changed = 0;
    for (const [index, group] of grouped.products.entries()) {
      if (selectedForCommon.has(group)) changed += fillBulkProductRequiredValues(group, plan.entries[index].requiredValues, commonValues);
    }
    rebuild();
    setStatus(changed ? `선택 제품의 빈칸 ${changed}개를 채웠습니다. 기존 값과 다른 제품은 보존했습니다.` : '채울 빈칸이 없습니다. 기존 값은 유지했습니다.', changed ? 'ok' : 'warn');
  });

  const confirmBox = element('div', 'bulk-confirm-box');
  confirmBox.id = 'bulk-queue-confirm';
  confirmBox.hidden = true;
  let confirmState = null;
  let confirming = false;
  function invalidateConfirmation() { inputVersion += 1; confirmState = null; }
  function queueRows(scope) {
    return plan.entries.map((entry, index) => ({ entry, group: grouped.products[index] }))
      .filter(({ entry, group }) => (scope !== 'selected' || selectedForCommon.has(group))
        && !entry.queued && !entry.issues.some(issue => BLOCKING_ISSUES.has(issue)));
  }

  const batchTools = element('details', 'bulk-batch-tools');
  batchTools.append(element('summary', '', '여러 제품 한번에 입력 · 파일명 묶기 / CSV / 공통값'));
  batchTools.append(element('p', 'status-message', '새 제품의 필수값은 위 공통 필수값에서 선택 적용하세요. 아래 공통값은 이전에 저장된 제품의 값 보존용이며, 새 제품에는 자동으로 넣지 않습니다.'), pickers, defaultsBox, bulkBar, colorRuleDetails, reset);
  const entryTools = element('div', 'bulk-entry-tools');
  entryTools.append(multiRow, creator);
  root.replaceChildren(heading, hint, confirmBox, statusNode, entryTools, commonBox, table, automationBox, batchTools);

  function setStatus(copy, tone = '') {
    status = { copy, tone };
    renderStatus();
  }

  function renderStatus() {
    statusNode.textContent = progress
      ? `${progress.done}/${progress.total} 투입 중 · ${progress.current}`
      : status.copy;
    statusNode.dataset.tone = progress ? '' : status.tone;
  }

  // 입력 중에 카드를 통째로 다시 그리면 글자를 칠 때마다 포커스가 튄다. 한 박자 뒤에 모은다.
  let planTimer = null;
  // 한글 조합 중인지. 조합 중에 다시 그리면 입력칸이 갈아 끼워져 글자가 깨진다.
  let composing = false;
  function schedulePlan() {
    invalidateConfirmation();
    if (planTimer) clearTimeout(planTimer);
    planTimer = setTimeout(() => {
      planTimer = null;
      // 조합이 아직 안 끝났으면 미룬다. 지금 그리면 글자가 깨진다.
      if (composing) {
        schedulePlan();
        return;
      }
      rebuild();
    }, 350);
  }

  /**
   * 다시 그리면 입력칸이 새 노드로 바뀌어 초점과 커서 자리가 사라진다.
   * 어디에 있었는지 적어 두었다가 그린 뒤 그대로 돌려놓는다.
   */
  function captureFocus() {
    const node = document.activeElement;
    if (!node || !node.dataset || !node.dataset.focusKey) return null;
    return {
      key: node.dataset.focusKey,
      start: typeof node.selectionStart === 'number' ? node.selectionStart : null,
      end: typeof node.selectionEnd === 'number' ? node.selectionEnd : null,
    };
  }

  function restoreFocus(mark) {
    if (!mark) return;
    const node = root.querySelector(`[data-focus-key="${mark.key}"]`);
    if (!node) return;
    node.focus();
    if (mark.start !== null && typeof node.setSelectionRange === 'function') {
      try { node.setSelectionRange(mark.start, mark.end); } catch (_) {}
    }
  }

  function rebuild() {
    invalidateConfirmation();
    defaults = Object.fromEntries(
      [...defaultsBox.querySelectorAll('[data-default-key]')].map(input => [input.dataset.defaultKey, input.value]),
    );
    plan = buildBulkPlan(grouped, csvRows, defaults);
    const mark = captureFocus();
    render();
    restoreFocus(mark);
    // 상태 변이는 전부 rebuild 로 모이므로, 여기 한 곳이 새로고침 생존 저장을 책임진다.
    queueWorkingSave();
  }

  // ── 새로고침 생존 ────────────────────────────────────────────────────────
  // 고른 사진과 손질한 값이 메모리에만 있어서 Ctrl+F5 한 번에 전부 날아갔다.
  // IndexedDB 두 저장소에 나눠 담는다: state(작은 기록, 저장마다) / blobs(사진 본문, 새 것만).
  // 이 기능은 덤이다 — 저장이 안 되는 환경(사생활 모드·용량 초과)에서는 조용히 꺼지고
  // 화면은 이전과 똑같이 메모리로만 돌아야 한다.
  const WORKING_DB_NAME = 'control-tower-bulk-intake';
  const WORKING_STATE_KEY = 'current';
  let workingDb = null;
  let persistDisabled = false;
  let saveTimer = null;
  let saveBusy = false;
  let saveAgain = false;
  // 복원이 판가름 나기 전에는 저장하지 않는다 — 마운트 직후의 빈 화면 저장이
  // 지난 기록과 사진 본문을 지워 버린 뒤에 복원이 도착하는 경합을 막는다.
  let restorePending = true;
  let restoreCancelled = false;

  function openWorkingDb() {
    if (workingDb || persistDisabled) return Promise.resolve(workingDb);
    return new Promise(resolve => {
      let request;
      try {
        request = indexedDB.open(WORKING_DB_NAME, 1);
      } catch {
        persistDisabled = true;
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      request.onsuccess = () => { workingDb = request.result; resolve(workingDb); };
      request.onerror = () => { persistDisabled = true; resolve(null); };
    });
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function saveWorkingState({ submission = false } = {}) {
    if (persistDisabled || restorePending || (busy && !submission)) return false;
    if (saveBusy) { saveAgain = true; return false; }
    saveBusy = true;
    try {
      const db = await openWorkingDb();
      if (!db) return false;
      // 사진 본문은 처음 볼 때 한 번만 넣는다. 같은 트랜잭션 안에서 안 쓰는 본문을 지워
      // 저장소가 비대해지지 않게 한다. 큐에 추가된 제품의 사진도 계속 보존한다.
      const referenced = new Set();
      const fresh = [];
      for (const product of grouped.products) {
        for (const image of product.images || []) {
          if (!image.file) continue;
          if (!image.blobId) { image.blobId = crypto.randomUUID(); fresh.push(image); }
          referenced.add(image.blobId);
        }
      }
      const stateRecord = serializeWorkingState({ grouped, csvRows, csvErrors, defaults, settings: { imageModel: imageModelSelect.value, policy: policySelect.value, decisionOverrides, commonValues, commonTargets: grouped.products.flatMap((group, index) => selectedForCommon.has(group) ? [index] : []), selectedProductIndex } });
      const tx = db.transaction(['state', 'blobs'], 'readwrite');
      const blobStore = tx.objectStore('blobs');
      for (const image of fresh) blobStore.put(image.file, image.blobId);
      tx.objectStore('state').put(stateRecord, WORKING_STATE_KEY);
      const keysRequest = blobStore.getAllKeys();
      // 지우기는 요청 콜백 안에서 바로 건다 — 트랜잭션이 살아 있을 때만 요청을 낼 수 있다.
      keysRequest.onsuccess = () => {
        for (const key of keysRequest.result) {
          if (!referenced.has(key)) blobStore.delete(key);
        }
      };
      await idbDone(tx);
      return true;
    } catch {
      // 용량 초과 등. 이후로는 메모리 전용으로만 돈다 — 화면 동작은 그대로여야 한다.
      persistDisabled = true;
      return false;
    } finally {
      saveBusy = false;
      if (saveAgain) {
        saveAgain = false;
        queueWorkingSave();
      }
    }
  }

  function queueWorkingSave() {
    if (persistDisabled || restorePending) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveWorkingState();
    }, 500);
  }

  async function clearWorkingState() {
    if (persistDisabled) return;
    try {
      const db = await openWorkingDb();
      if (!db) return;
      const tx = db.transaction(['state', 'blobs'], 'readwrite');
      tx.objectStore('state').delete(WORKING_STATE_KEY);
      tx.objectStore('blobs').clear();
      await idbDone(tx);
    } catch {
      // 지우기 실패는 다음 저장이 빈 상태로 덮어쓴다.
    }
  }

  async function restoreWorkingState() {
    try {
      const db = await openWorkingDb();
      if (!db) return;
      const tx = db.transaction(['state', 'blobs'], 'readonly');
      const blobStore = tx.objectStore('blobs');
      // 요청 세 개를 한꺼번에 걸어야 트랜잭션이 닫히기 전에 다 받는다.
      const [stored, keys, values] = await Promise.all([
        idbRequest(tx.objectStore('state').get(WORKING_STATE_KEY)),
        idbRequest(blobStore.getAllKeys()),
        idbRequest(blobStore.getAll()),
      ]);
      if (!stored) return;
      // 복원이 끝나기 전에 사람이 이미 새로 고르기 시작했거나 비웠으면 덮어쓰지 않는다.
      if (restoreCancelled || grouped.products.length || csvRows.length) return;
      const blobs = new Map(keys.map((key, index) => [key, values[index]]));
      const revived = hydrateWorkingState(stored, blobs);
      if (!revived) return;
      grouped = revived.grouped;
      csvRows = revived.csvRows;
      csvErrors = revived.csvErrors;
      commonValues = revived.settings.commonValues && typeof revived.settings.commonValues === 'object' && !Array.isArray(revived.settings.commonValues) ? revived.settings.commonValues : {};
      for (const input of commonBox.querySelectorAll('[data-common-key]')) input.value = commonValues[input.dataset.commonKey] || '';
      for (const index of Array.isArray(revived.settings.commonTargets) ? revived.settings.commonTargets : []) if (grouped.products[index]) selectedForCommon.add(grouped.products[index]);
      if (Number.isInteger(revived.settings.selectedProductIndex)) selectedProductIndex = Math.max(0, Math.min(revived.settings.selectedProductIndex, grouped.products.length - 1));
      if (revived.settings.imageModel) imageModelSelect.value = revived.settings.imageModel;
      if (revived.settings.policy) policySelect.value = revived.settings.policy;
      if (revived.settings.decisionOverrides) decisionOverrides = revived.settings.decisionOverrides;
      renderAutomationCopy();
      for (const input of defaultsBox.querySelectorAll('[data-default-key]')) {
        const value = revived.defaults[input.dataset.defaultKey];
        if (typeof value === 'string') input.value = value;
      }
      const parts = [`저장된 제품 ${revived.grouped.products.length}개를 복원했습니다`];
      if (revived.csvRows.length) parts.push(`CSV ${revived.csvRows.length}건 포함`);
      if (revived.dropped.length) parts.push(`사진 ${revived.dropped.length}장은 본문이 없어 빠졌습니다`);
      setStatus(`${parts.join(' · ')}. 이어서 입력하세요.`, 'ok');
      rebuild();
    } catch {
      // 깨진 기록이면 빈 화면으로 시작한다. 다음 저장이 새 기록으로 덮어쓴다.
    } finally {
      restorePending = false;
      render();
      // 복원 중에 눌린 저장(고르기·기본값 입력)이 있었으면 이제 반영한다.
      queueWorkingSave();
    }
  }

  const COLOR_ROLES = new Set(['color-option', 'base-and-color']);
  let colorRule = loadColorRule();

  /** 색상이 필요한 사진만 순서대로. 번호는 이 차례를 따른다. */
  function colorTargets(products) {
    const targets = [];
    for (const product of products) {
      if (product.queued || product.queueRequest) continue;
      let ordinal = 0;
      for (const image of (Array.isArray(product?.images) ? product.images : [])) {
        if (!COLOR_ROLES.has(image.role || 'base')) continue;
        ordinal += 1;
        targets.push({ product, image, ordinal });
      }
    }
    return targets;
  }

  /**
   * 고른 규칙으로 색상명을 채운다.
   *
   * 직접 입력을 고른 사람은 채워 주는 것을 원하지 않는다 — 그때는 번호만 다시 매긴다.
   * AI 추천은 넣기 전에 사람이 보고 고르는 창을 거친다.
   */
  async function fillColorNames(products) {
    const targets = colorTargets(products);
    if (!targets.length) {
      setStatus('색상 옵션으로 지정한 사진이 없습니다. 카드의 색상 구역에 사진을 넣거나 「색상으로 →」로 옮긴 뒤 실행해 주세요.', 'warn');
      return;
    }
    if (colorRule.source === 'ai') {
      await openAiColorNameDialog(targets);
      return;
    }
    for (const target of targets) {
      const base = colorRule.source === 'filename'
        ? colorNameFromImage(target.image)
        : String(target.image.colorName || '').replace(/^\s*\d+\s*[.)_번]?\s*/, '');
      target.image.colorName = applyColorNamePattern(colorRule.pattern, target.ordinal, base);
    }
    const filled = targets.filter(target => target.image.colorName).length;
    setStatus(`색상명 ${filled}/${targets.length}칸을 채웠습니다.`, filled === targets.length ? 'ok' : 'warn');
    schedulePlan();
  }

  /**
   * AI 가 제안한 색상명을 사람이 보고 고른 뒤에 넣는다.
   *
   * 바로 채워 넣지 않는 까닭: 색상명은 옵션표 슬롯명이 되어 스토어에 그대로 올라간다.
   * 사진 몇 장이 비슷한 색이면 AI 도 헷갈리므로, 넣기 전에 눈으로 보게 한다.
   */
  async function openAiColorNameDialog(targets) {
    const overlay = element('div', 'bulk-lightbox bulk-ai-dialog');
    const panel = element('div', 'bulk-ai-panel');
    const heading = element('div', 'bulk-ai-head');
    heading.append(element('h3', '', 'AI 추천 색상명'));
    const statusLine = element('p', 'status-message', `사진 ${targets.length}장을 한 번에 보고 색상명을 제안받습니다.`);
    heading.append(statusLine);
    panel.append(heading);
    const list = element('div', 'bulk-ai-rows');
    panel.append(list);
    const actions = element('div', 'bulk-ai-actions');
    const retry = element('button', 'board-action ghost', '다시 추천받기');
    retry.type = 'button';
    const cancel = element('button', 'board-action ghost', '취소');
    cancel.type = 'button';
    const apply = element('button', 'board-action primary', `${targets.length}칸에 넣기`);
    apply.type = 'button';
    apply.disabled = true;
    actions.append(retry, element('span', 'bulk-card-spacer'), cancel, apply);
    panel.append(actions);
    overlay.append(panel);
    const dismiss = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    function onKey(event) { if (event.key === 'Escape') dismiss(); }
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', dismiss);
    document.body.append(overlay);

    const chosen = new Map();
    const draw = suggestions => {
      list.replaceChildren();
      for (const target of targets) {
        const row = element('div', 'bulk-ai-row');
        const url = thumbUrl(target.image);
        if (url) {
          const thumb = document.createElement('img');
          thumb.src = url;
          thumb.alt = target.image.fileName;
          thumb.decoding = 'async';
          row.append(thumb);
        }
        row.append(element('span', 'bulk-shot-name', target.image.fileName));
        const picks = suggestions.get(target.image.fileName) || [];
        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'bulk-color-input';
        field.setAttribute('aria-label', `${target.image.fileName} 색상명`);
        field.value = chosen.get(target.image) ?? picks[0] ?? '';
        field.addEventListener('input', () => {
          chosen.set(target.image, field.value.trim());
          apply.disabled = ![...chosen.values()].some(Boolean);
        });
        for (const pick of picks.slice(0, 3)) {
          const chip = element('button', 'bulk-mini-action', pick);
          chip.type = 'button';
          chip.addEventListener('click', () => {
            field.value = pick;
            chosen.set(target.image, pick);
            apply.disabled = false;
          });
          row.append(chip);
        }
        if (field.value) chosen.set(target.image, field.value);
        row.append(element('span', 'bulk-card-spacer'), field);
        list.append(row);
      }
      apply.disabled = ![...chosen.values()].some(Boolean);
    };

    const ask = async () => {
      statusLine.textContent = '사진을 보고 색상명을 고르는 중…';
      apply.disabled = true;
      try {
        const suggestions = await requestAiColorNames(targets);
        statusLine.textContent = `추천 ${suggestions.size}건 · 넣기 전에 고치실 수 있습니다.`;
        draw(suggestions);
      } catch (error) {
        statusLine.textContent = `추천을 받지 못했습니다 · ${String(error?.message || error)}`;
        statusLine.dataset.tone = 'error';
        draw(new Map());
      }
    };
    retry.addEventListener('click', () => void ask());
    apply.addEventListener('click', () => {
      for (const target of targets) {
        const picked = String(chosen.get(target.image) || '').trim();
        if (!picked) continue;
        target.image.colorName = applyColorNamePattern(colorRule.pattern, target.ordinal, picked);
      }
      dismiss();
      setStatus('AI 추천 색상명을 넣었습니다. 각 칸에서 그대로 고칠 수 있습니다.', 'ok');
      schedulePlan();
    });
    await ask();
  }

  function renderThumb(image) {
    const url = thumbUrl(image);
    const thumbButton = element('button', 'bulk-thumb');
    thumbButton.type = 'button';
    thumbButton.title = '눌러서 크게 보기';
    if (url) {
      const thumb = document.createElement('img');
      thumb.src = url;
      thumb.alt = image.fileName;
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumbButton.append(thumb);
      thumbButton.addEventListener('click', () => openLightbox(url, image.fileName));
    } else {
      thumbButton.append(element('span', '', '없음'));
    }
    return thumbButton;
  }

  /** 색상명 입력칸. 한글 조합·초점 보존까지 챙긴다 — 다시 그릴 때 글자가 깨지면 못 쓴다. */
  function renderColorNameInput(image) {
    const colorInput = document.createElement('input');
    colorInput.type = 'text';
    colorInput.className = 'bulk-color-input';
    colorInput.placeholder = '색상명';
    colorInput.setAttribute('aria-label', `${image.fileName} 색상명`);
    colorInput.dataset.focusKey = `color:${image.fileName}`;
    colorInput.value = image.colorName || '';
    colorInput.dataset.missing = COLOR_ROLES.has(image.role || 'base') && !colorInput.value.trim() ? 'true' : 'false';
    colorInput.addEventListener('compositionstart', () => { composing = true; });
    colorInput.addEventListener('compositionend', () => {
      composing = false;
      image.colorName = colorInput.value.trim();
      schedulePlan();
    });
    colorInput.addEventListener('input', () => {
      image.colorName = colorInput.value.trim();
      colorInput.dataset.missing = COLOR_ROLES.has(image.role || 'base') && !colorInput.value.trim() ? 'true' : 'false';
      if (composing) return;
      schedulePlan();
    });
    return colorInput;
  }

  function moveButton(label, run) {
    const button = element('button', 'bulk-move-action', label);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  }

  /** 고른 파일들을 이 제품의 사진으로 붙인다. 구역이 정한 역할을 그대로 받는다. */
  function addImagesToGroup(group, fileList, role) {
    if (group.queued || group.queueRequest || busy || restorePending) return;
    const files = [...(fileList || [])].filter(file => isSupportedImage(file.name));
    if (!files.length) return;
    const start = group.images.length;
    for (const [index, file] of files.entries()) {
      // 파일명에 색상을 적어 왔으면(제품명_번호_색상) 색상 구역에 넣는 순간 이름까지 채운다.
      const parsed = readImageName(file.name);
      group.images.push({
        fileName: file.name,
        file,
        ordinal: start + index + 1,
        role,
        fileColorName: parsed.colorName || '',
        colorName: role === 'color-option' ? (parsed.colorName || '') : '',
        name: file.name.replace(/\.[A-Za-z0-9]+$/, ''),
      });
    }
    schedulePlan();
  }

  /** 구역 머리글에 붙는 '사진 추가' — 구역이 곧 역할이라, 여기로 넣으면 분류가 끝난다. */
  function zoneAddButton(group, role, label) {
    const wrap = element('label', 'bulk-zone-add');
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.setAttribute('aria-label', `${group.productName || '새 제품'} ${label}`);
    input.addEventListener('change', () => {
      addImagesToGroup(group, input.files, role);
      input.value = '';
    });
    wrap.append(element('span', '', label), input);
    return wrap;
  }

  /**
   * 사진을 역할별 두 구역으로 나눠 그린다: 기본 이미지(크게) / 색상 옵션(색상명과 나란히).
   *
   * 구역이 곧 역할이다 — 기본 구역의 '사진 추가' 로 넣으면 기본, 색상 구역으로 넣으면
   * 색상 옵션이다. 사진마다 분류를 묻지 않는다. 기본 사진은 제품의 얼굴이므로 크게 보여
   * 무엇이 대표인지 한눈에 알게 한다.
   */
  function renderImageZones(group) {
    const zones = element('div', 'bulk-zones');
    const images = group?.images || [];
    const baseImages = images.filter(image => (image.role || 'base') !== 'color-option');
    const colorImages = images.filter(image => (image.role || 'base') === 'color-option');

    const baseZone = element('div', 'bulk-zone bulk-zone-base');
    const baseHead = element('div', 'bulk-zone-head');
    baseHead.append(element('span', 'bulk-zone-label', `기본 이미지 ${baseImages.length}장`));
    baseHead.append(element('span', 'bulk-card-spacer'));
    baseHead.append(zoneAddButton(group, 'base', '＋ 기본 사진 추가'));
    baseZone.append(baseHead);
    const baseGrid = element('div', 'bulk-base-grid');
    for (const image of baseImages) {
      const cell = element('div', 'bulk-base-cell');
      cell.append(renderThumb(image));
      const name = element('span', 'bulk-shot-name', image.fileName);
      name.title = image.fileName;
      cell.append(name);
      const tools = element('div', 'bulk-base-tools');
      // '색상 겸용' — 같은 사진을 기본이자 한 색상 옵션으로 쓴다. 기본 사진 한 장으로
      // 단일 색상을 만들 때 필요하다. 켜면 색상명 칸이 그 자리에서 열린다.
      const dual = element('button', 'bulk-mini-action', '색상 겸용');
      dual.type = 'button';
      dual.dataset.on = image.role === 'base-and-color' ? 'true' : 'false';
      dual.addEventListener('click', () => {
        image.role = image.role === 'base-and-color' ? 'base' : 'base-and-color';
        schedulePlan();
      });
      tools.append(dual);
      tools.append(moveButton('색상으로 →', () => {
        image.role = 'color-option';
        // 파일명에 색상을 적어 왔으면(제품명_번호_색상) 옮기는 순간 그 이름을 쓴다.
        if (!image.colorName && image.fileColorName) image.colorName = image.fileColorName;
        schedulePlan();
      }));
      cell.append(tools);
      if (image.role === 'base-and-color') cell.append(renderColorNameInput(image));
      baseGrid.append(cell);
    }
    baseZone.append(baseGrid);
    if (!baseImages.length) {
      baseZone.append(element('p', 'bulk-zone-empty', '기본 사진이 없습니다. 「＋ 기본 사진 추가」로 넣거나 색상 옵션에서 옮겨 주세요.'));
    }
    zones.append(baseZone);

    const colorZone = element('div', 'bulk-zone');
    const colorHead = element('div', 'bulk-zone-head');
    colorHead.append(element('span', 'bulk-zone-label', `색상 옵션 ${colorImages.length}장`));
    colorHead.append(element('span', 'bulk-card-spacer'));
    // 색상명이 실제로 사는 자리에서 바로 AI 를 부른다. 전체 일괄은 색상명 규칙·전체 적용 줄에 있다.
    const groupTargets = colorTargets([group]);
    if (groupTargets.length) {
      const aiFill = element('button', 'bulk-mini-action', 'AI 색상명');
      aiFill.type = 'button';
      aiFill.title = '이 제품의 색상 사진을 AI 에 보여 주고 색상명을 추천받습니다.';
      aiFill.addEventListener('click', () => void openAiColorNameDialog(groupTargets));
      colorHead.append(aiFill);
    }
    colorHead.append(zoneAddButton(group, 'color-option', '＋ 색상 사진 추가'));
    colorZone.append(colorHead);
    for (const image of colorImages) {
      const row = element('div', 'bulk-shot-row');
      row.append(renderThumb(image), (() => {
        const name = element('span', 'bulk-shot-name', image.fileName);
        name.title = image.fileName;
        return name;
      })());
      row.append(renderColorNameInput(image));
      row.append(element('span', 'bulk-card-spacer'));
      row.append(moveButton('← 기본으로', () => {
        image.role = 'base';
        schedulePlan();
      }));
      colorZone.append(row);
    }
    if (!colorImages.length) {
      colorZone.append(element('p', 'bulk-zone-empty', '색상 옵션이 없으면 비워 두세요. 옵션 없는 제품으로 투입됩니다.'));
    }
    zones.append(colorZone);
    return zones;
  }

  /**
   * 사진마다 역할을 하나씩 고르게 하면 아홉 장이면 아홉 번을 누른다.
   * 가장 흔한 배치를 한 번에 적용할 수 있게 한다.
   */
  function applyRolePattern(products, pattern) {
    for (const product of products) {
      if (product.queued || product.queueRequest) continue;
      const images = Array.isArray(product?.images) ? product.images : [];
      images.forEach((image, index) => {
        if (pattern === 'all-base') {
          image.role = 'base';
          return;
        }
        image.role = index === 0 ? 'base' : 'color-option';
      });
    }
    schedulePlan();
  }


  /** 색상명 규칙. 접힌 제목에 지금 조합을 보여 주고, 펴면 바꿀 수 있다. */
  function renderColorRule() {
    const sourceLabel = COLOR_NAME_SOURCES.find(item => item.key === colorRule.source)?.label || colorRule.source;
    colorRuleSummary.textContent = `색상명 규칙 · ${sourceLabel} · ${applyColorNamePattern(colorRule.pattern, 1, '남색') || '(색상명 없음)'}`;
    colorRuleBox.replaceChildren();
    const line = (label) => {
      const row = element('div', 'bulk-color-rule-row');
      row.append(element('span', 'bulk-color-rule-label', label));
      return row;
    };
    const sourceRow = line('색상명 출처');
    for (const source of COLOR_NAME_SOURCES) {
      const chip = element('button', 'bulk-rule-chip');
      chip.type = 'button';
      chip.dataset.on = colorRule.source === source.key ? 'true' : 'false';
      chip.append(element('span', '', source.label));
      chip.append(element('span', 'bulk-rule-chip-hint', source.hint));
      chip.addEventListener('click', () => {
        colorRule = { ...colorRule, source: source.key };
        renderColorRule();
        renderBatchBar();
      });
      sourceRow.append(chip);
    }
    colorRuleBox.append(sourceRow);

    // 실행 줄. 출처를 고르기만 하고 돌릴 방법이 없던 것을 고친다 — 여기서 바로 실행한다.
    const runRow = line('실행');
    const targetCount = colorTargets(grouped.products).length;
    const runLabel = colorRule.source === 'ai'
      ? 'AI 추천 받기'
      : colorRule.source === 'filename' ? '파일명에서 채우기' : '번호만 다시 매기기';
    const run = element('button', 'bulk-rule-chip', runLabel);
    run.type = 'button';
    run.dataset.on = 'true';
    run.disabled = busy || !targetCount;
    run.addEventListener('click', () => void fillColorNames(grouped.products));
    runRow.append(run);
    runRow.append(element(
      'span',
      'bulk-rule-chip-hint',
      targetCount
        ? `색상 구역 사진 ${targetCount}장의 색상명을 채웁니다.`
        : '색상 구역에 사진을 먼저 넣으면 실행할 수 있습니다.',
    ));
    colorRuleBox.append(runRow);

    const prefixRow = line('번호 붙이기');
    for (const preset of COLOR_NAME_PREFIXES) {
      const chip = element('button', 'bulk-rule-chip', applyColorNamePattern(preset.pattern, 1, '남색') || '남색');
      chip.type = 'button';
      chip.dataset.on = colorRule.pattern === preset.pattern ? 'true' : 'false';
      chip.addEventListener('click', () => {
        colorRule = { ...colorRule, pattern: preset.pattern };
        renderColorRule();
      });
      prefixRow.append(chip);
    }
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 'bulk-rule-custom';
    custom.placeholder = '직접: {n}. {색상}';
    custom.setAttribute('aria-label', '번호 틀 직접 입력');
    if (!COLOR_NAME_PREFIXES.some(preset => preset.pattern === colorRule.pattern)) custom.value = colorRule.pattern;
    custom.addEventListener('input', () => {
      const pattern = custom.value.trim();
      if (!pattern) return;
      colorRule = { ...colorRule, pattern };
      previewNode.textContent = applyColorNamePattern(pattern, 1, '남색') || '(색상명 없음)';
      for (const chip of prefixRow.querySelectorAll('.bulk-rule-chip')) chip.dataset.on = 'false';
    });
    prefixRow.append(custom);
    colorRuleBox.append(prefixRow);

    const previewRow = line('미리보기');
    const previewNode = element('span', 'bulk-rule-preview', applyColorNamePattern(colorRule.pattern, 1, '남색') || '(색상명 없음)');
    previewRow.append(previewNode);
    previewRow.append(element('span', 'bulk-card-spacer'));
    const remember = element('button', 'bulk-mini-action', '내 기본값으로 저장');
    remember.type = 'button';
    remember.addEventListener('click', () => {
      try {
        localStorage.setItem(COLOR_RULE_STORAGE_KEY, JSON.stringify(colorRule));
        setStatus('이 조합을 기본값으로 저장했습니다.', 'ok');
      } catch {
        setStatus('기본값을 저장하지 못했습니다.', 'warn');
      }
    });
    const restore = element('button', 'bulk-mini-action', '기본값으로 되돌리기');
    restore.type = 'button';
    restore.addEventListener('click', () => {
      colorRule = loadColorRule();
      renderColorRule();
    });
    previewRow.append(remember, restore);
    colorRuleBox.append(previewRow);
  }

  /** 전체 제품 일괄 조작. 사진마다 하나씩 누르던 것을 한 번으로 줄인다. */
  function renderBatchBar() {
    bulkBar.replaceChildren();
    bulkBar.append(element('span', 'bulk-color-rule-label', '전체 제품에 적용'));
    const add = (label, run, primary = false) => {
      const button = element('button', primary ? 'bulk-rule-chip' : 'bulk-mini-action', label);
      button.type = 'button';
      if (primary) button.dataset.on = 'true';
      button.disabled = busy || !grouped.products.length;
      button.addEventListener('click', run);
      bulkBar.append(button);
    };
    add('첫 장만 기본, 나머지 색상옵션', () => applyRolePattern(grouped.products, 'first-base'), true);
    add('전부 기본 이미지', () => applyRolePattern(grouped.products, 'all-base'));
    // 어떤 출처로 채울지는 색상명 규칙에서 정한다 — 라벨에 그 출처를 그대로 보여 준다.
    const sourceLabel = COLOR_NAME_SOURCES.find(item => item.key === colorRule.source)?.label || colorRule.source;
    add(`색상명 채우기 · ${sourceLabel}`, () => void fillColorNames(grouped.products));
    bulkBar.append(element('span', 'bulk-card-spacer'));
  }

  async function refreshCategories() {
    if (categoryLoading) return;
    categoryLoading = true;
    categoryStatus = 'Cafe24 분류를 불러오는 중…';
    schedulePlan();
    try {
      categoryItems = await loadCafe24Categories(apiHub);
      categoryStatus = categoryItems.length ? `Cafe24 분류 ${categoryItems.length}개 · 이름으로 검색해 선택하세요.` : 'Cafe24에 등록된 분류가 없습니다.';
    } catch (error) {
      categoryStatus = `분류를 불러오지 못했습니다. ${error?.name === 'TimeoutError' ? '연결 응답 시간 초과' : String(error?.message || '')} · 다시 불러오기를 눌러 주세요.`;
    } finally {
      categoryLoading = false;
      schedulePlan();
    }
  }

  function productValue(group, key, value) {
    if (group.queued || group.queueRequest || busy || restorePending) return;
    group.requiredValues = { ...(group.requiredValues || {}), [key]: value };
  }

  const sourceCandidateId = (source, candidate) => String(source === 'sinhwa'
    ? candidate?.jcode || candidate?.id || ''
    : candidate?.product_no || candidate?.raw?.product_no || '');

  async function searchProductSource(group, source) {
    if (busy || restorePending) return;
    const query = String(group.productName || '').trim();
    if (!query) { setStatus('제품명을 먼저 입력하세요.', 'warn'); return; }
    const request = beginProductSourceRequest(group, source, query);
    if (!request) return;
    rebuild();
    try {
      const candidates = await intake.searchCandidates({ source, query, productName: query });
      if (busy || restorePending || !grouped.products.includes(group) || !finishProductSourceRequest(group, request, candidates, '', grouped.products[selectedProductIndex])) return;
      setStatus(`${query} · ${source === 'sinhwa' ? '신화사DB' : 'Cafe24'} 후보 ${candidates.length}건을 찾았습니다. 상품을 직접 선택하세요.`, candidates.length ? 'ok' : 'warn');
    } catch (error) {
      if (busy || restorePending || !grouped.products.includes(group) || !finishProductSourceRequest(group, request, [], String(error?.message || error), grouped.products[selectedProductIndex])) return;
      setStatus(`${query} 조회 실패 · ${String(error?.message || error)}`, 'error');
    }
    rebuild();
  }

  async function selectProductSource(group, source, candidate) {
    if (busy || restorePending) return;
    const selectionId = sourceCandidateId(source, candidate);
    const request = beginProductSourceSelection(group, source, selectionId);
    if (!request) return;
    const lookup = group.sourceLookup?.[source];
    if (lookup) lookup.status = 'selecting';
    rebuild();
    try {
      const result = await intake.selectCandidate({ source, candidate, productName: group.productName });
      if (busy || restorePending || !grouped.products.includes(group) || !finishProductSourceSelection(group, request, result, Date.now(), grouped.products[selectedProductIndex])) return;
      setStatus(`${result.label} 선택 · 원본 필수값의 빈칸만 채웠습니다. 값을 확인하고 수정하세요.`, 'ok');
    } catch (error) {
      if (group.queued || group.queueRequest || busy || restorePending || !grouped.products.includes(group) || grouped.products[selectedProductIndex] !== group
        || group.sourceSelectionRequest !== request || group.productName !== request.productName) return;
      delete group.sourceSelectionRequest;
      if (lookup) { lookup.status = 'error'; lookup.error = String(error?.message || error); }
      setStatus(`선택 상품 상세 확인 실패 · ${String(error?.message || error)}`, 'error');
    }
    rebuild();
  }

  function renderProductSourceLookup(group) {
    const section = element('section', 'bulk-source-lookup');
    section.append(element('strong', '', '제품 원본 찾기'));
    section.append(element('p', 'status-message', '제품명으로 기존 신화사DB와 Cafe24를 조회합니다. 조회만으로 현재 조립 작업이나 기존 Cafe24 상품은 바뀌지 않습니다.'));
    if (group.sourceSelection?.selectionId) {
      const selected = element('div', 'bulk-source-selected');
      if (group.sourceSelection.thumbnail) {
        const image = document.createElement('img');
        image.src = group.sourceSelection.thumbnail; image.alt = ''; image.width = 56; image.height = 56; image.loading = 'lazy';
        selected.append(image);
      }
      selected.append(element('span', '', `선택됨 · ${group.sourceSelection.label || group.sourceSelection.selectionId}`));
      section.append(selected);
    }
    for (const source of ['sinhwa', 'cafe24']) {
      const box = element('div', 'bulk-source-group');
      const label = source === 'sinhwa' ? '신화사DB' : 'Cafe24';
      const action = element('button', 'bulk-mini-action', `${label} 조회`);
      action.type = 'button'; action.dataset.sourceSearch = source;
      action.disabled = group.sourceLookup?.[source]?.status === 'loading' || group.sourceLookup?.[source]?.status === 'selecting';
      action.addEventListener('click', () => void searchProductSource(group, source));
      const lookup = group.sourceLookup?.[source];
      box.append(action, element('span', 'status-message', lookup?.status === 'loading' ? '조회 중…'
        : lookup?.status === 'selecting' ? '선택 상품 상세 확인 중…'
          : lookup?.error ? `확인 필요 · ${lookup.error}`
            : lookup?.status === 'done' ? `후보 ${lookup.candidates.length}건` : '제품명을 입력한 뒤 조회하세요.'));
      const candidates = element('div', 'bulk-source-candidates');
      for (const candidate of lookup?.candidates || []) {
        const card = element('button', 'bulk-source-candidate');
        card.type = 'button';
        card.dataset.sourceCandidate = `${source}:${sourceCandidateId(source, candidate)}`;
        const imageUrl = candidate.image || candidate.thumbnail || candidate.thumb_url || '';
        if (imageUrl) {
          const image = document.createElement('img'); image.src = imageUrl; image.alt = ''; image.width = 56; image.height = 56; image.loading = 'lazy'; card.append(image);
        }
        const name = candidate.product_name || candidate.jname || candidate.name || '이름 확인 필요';
        card.append(element('span', '', `${name} · #${sourceCandidateId(source, candidate) || '번호 없음'}`));
        card.addEventListener('click', () => void selectProductSource(group, source, candidate));
        candidates.append(card);
      }
      box.append(candidates); section.append(box);
    }
    return section;
  }

  function renderNativeRequiredFields(group, index) {
    const panel = element('div', 'bulk-native-required-fields');
    panel.innerHTML = intake.renderRequiredFields(buildProductFieldSummary(intake.definitions, group), {
      panelId: `bulk-required-fields-${index}`, showSourceLink: false,
    });
    if (group.queued || group.queueRequest || busy || restorePending) {
      for (const control of panel.querySelectorAll('input, button')) control.disabled = true;
      return panel;
    }
    const aliases = { product_name: 'productName', sale_price: 'salePrice', purchase_price: 'supplyPrice', stock: 'stock',
      size: 'size', width_mm: 'widthMm', depth_mm: 'depthMm', weight: 'weight', material: 'material', usage: 'usage' };
    for (const input of panel.querySelectorAll('[data-factory-wizard-field]')) {
      const fieldId = input.dataset.factoryWizardField;
      input.dataset.productField = aliases[fieldId] || fieldId;
      input.dataset.focusKey = `product-field:${index}:${input.dataset.productField}`;
      input.addEventListener('input', () => { setProductFieldDraft(group, fieldId, input.value); queueWorkingSave(); });
    }
    for (const button of panel.querySelectorAll('[data-factory-wizard-edit]')) button.addEventListener('click', () => {
      const fieldId = button.dataset.factoryWizardEdit;
      const current = panel.querySelector(`[data-factory-wizard-field="${fieldId}"]`);
      setProductFieldDraft(group, fieldId, current?.value || '');
      rebuild();
    });
    for (const button of panel.querySelectorAll('[data-factory-wizard-commit]:not([data-factory-wizard-edit])')) button.addEventListener('click', () => {
      const fieldId = button.dataset.factoryWizardCommit;
      const input = panel.querySelector(`[data-factory-wizard-field="${fieldId}"]`);
      commitProductField(group, fieldId, input?.value || '');
      rebuild();
    });
    panel.querySelector('[data-factory-wizard-commit-all]')?.addEventListener('click', () => {
      for (const input of panel.querySelectorAll('[data-factory-wizard-field]')) commitProductField(group, input.dataset.factoryWizardField, input.value);
      rebuild();
    });
    return panel;
  }

  function renderCategoryField(entry, group, index) {
    const box = element('div', 'intake-category-picker');
    const label = element('label', 'bulk-default-field');
    const select = document.createElement('select');
    select.id = `bulk-category-${index}`;
    select.dataset.focusKey = `category:${index}`;
    select.setAttribute('aria-label', `${entry.productName || '새 제품'} Cafe24 상품분류`);
    label.append(element('span', '', 'Cafe24 상품분류'), select);
    const searchRow = element('div', 'bulk-category-search');
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = '분류 검색 · 예: 지갑';
    search.setAttribute('aria-label', `${entry.productName || '새 제품'} 분류 검색`);
    search.dataset.focusKey = `category-search:${index}`;
    const refresh = element('button', 'bulk-mini-action', '다시 불러오기');
    refresh.type = 'button';
    refresh.disabled = categoryLoading;
    refresh.addEventListener('click', () => void refreshCategories());
    searchRow.append(search, refresh);
    const selectedId = entry.requiredValues.cafe24CategoryId || '';
    const updateOptions = () => {
      const term = search.value.trim().toLocaleLowerCase();
      const items = categoryItems.filter(item => !term || `${item.label} ${item.id}`.toLocaleLowerCase().includes(term) || item.id === selectedId);
      select.replaceChildren();
      const blank = element('option', '', selectedId ? '분류 선택 해제' : `분류를 선택하세요${entry.requiredValues.category ? ` · 현재 상품 종류: ${entry.requiredValues.category}` : ''}`);
      blank.value = '';
      select.append(blank);
      if (selectedId && !items.some(item => item.id === selectedId)) {
        const current = element('option', '', `기존 분류 #${selectedId} · 목록 확인 필요`);
        current.value = selectedId;
        select.append(current);
      }
      for (const item of items) {
        const option = element('option', '', `${item.label} · #${item.id}`);
        option.value = item.id;
        select.append(option);
      }
      select.value = selectedId;
      select.disabled = !items.length && !selectedId;
      feedback.textContent = term && !items.length ? '검색 결과가 없습니다. 다른 분류명을 입력하세요.' : categoryStatus;
    };
    const feedback = element('p', 'status-message');
    feedback.setAttribute('role', 'status');
    search.addEventListener('input', updateOptions);
    select.addEventListener('change', () => {
      productValue(group, 'cafe24CategoryId', select.value);
      const selected = categoryItems.find(item => item.id === select.value);
      if (selected) productValue(group, 'category', selected.name);
      rebuild();
    });
    updateOptions();
    box.append(label, searchRow, feedback);
    return box;
  }

  function renderProductFields(entry, group, index) {
    const panel = element('div', 'bulk-product-info');
    if (intake) panel.append(renderProductSourceLookup(group), renderNativeRequiredFields(group, index), renderCategoryField(entry, group, index));
    else panel.append(renderCategoryField(entry, group, index));
    const fields = element('div', 'bulk-product-fields');
    const extra = element('details', 'bulk-product-extra');
    extra.append(element('summary', '', '추가 상품정보 · 상품 종류 / 공급가 / 진열·판매'));
    const extraFields = element('div', 'bulk-product-fields');
    extra.append(extraFields);
    const fieldsToRender = intake ? NATIVE_EXTRA_FIELDS : DEFAULT_FIELDS.filter(item => item.key !== 'cafe24CategoryId');
    for (const field of fieldsToRender) {
      const label = element('label', 'bulk-default-field');
      const input = document.createElement(field.select || ['displayStatus', 'sellingStatus'].includes(field.key) ? 'select' : 'input');
      if (input.tagName === 'SELECT') {
        for (const [value, copy] of [['', '등록 기본값 유지'], ['F', '안 함'], ['T', '함']]) {
          const option = element('option', '', copy); option.value = value; input.append(option);
        }
      } else {
        input.type = 'text';
        input.placeholder = field.placeholder;
        if (['widthMm', 'depthMm', 'salePrice', 'stock', 'supplyPrice'].includes(field.key)) input.inputMode = 'decimal';
      }
      input.dataset.productField = field.key;
      input.dataset.focusKey = `product-field:${index}:${field.key}`;
      input.value = entry.requiredValues[field.key] || '';
      input.setAttribute('aria-label', `${entry.productName || '새 제품'} ${field.label}`);
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; schedulePlan(); });
      const update = () => {
        productValue(group, field.key, input.value);
        if (field.key === 'size') {
          const pair = readSizePair(input.value);
          for (const key of ['widthMm', 'depthMm']) if (!Object.hasOwn(group.requiredValues, key)) {
            const dimension = panel.querySelector(`[data-product-field="${key}"]`);
            if (dimension) dimension.value = pair[key];
          }
        }
        if (!composing) schedulePlan();
      };
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', update);
      label.append(element('span', '', field.label), input);
      (intake || field.group === 'cafe24' || field.key === 'category' ? extraFields : fields).append(label);
    }
    extra.addEventListener('toggle', () => { group.fieldsOpen = extra.open; });
    extra.open = group.fieldsOpen === true;
    panel.append(fields, extra);
    return panel;
  }

  function renderPlan() {
    const policyWasOpen = table.querySelector('.bulk-product-policy')?.open === true;
    const nodes = [];
    let selectedEditor = null;
    if (grouped.skipped.length) {
      nodes.push(element(
        'p',
        'bulk-note',
        `건너뛴 파일 ${grouped.skipped.length}개 · ${grouped.skipped
          .slice(0, 4)
          .map(item => `${item.fileName}(${SKIP_LABELS[item.reason] || item.reason})`)
          .join(', ')}`,
      ));
    }
    for (const error of csvErrors.slice(0, 3)) {
      nodes.push(element('p', 'bulk-note', `CSV ${error.line}행 · ${error.reason === 'product_name_column_missing' ? '제품명 열을 찾지 못했습니다' : '제품명이 비어 있습니다'}`));
    }
    if (plan.unmatchedCsv.length) {
      nodes.push(element('p', 'bulk-note', `이미지를 찾지 못한 CSV 제품 ${plan.unmatchedCsv.length}건 · ${plan.unmatchedCsv.slice(0, 4).join(', ')}`));
    }
    if (!plan.entries.length) {
      nodes.push(element('p', 'factory-empty-state', '위에 제품명을 여러 줄로 넣어 목록을 만드세요. 목록에서 제품을 골라 사진과 필수값을 편집합니다.'));
      table.replaceChildren(...nodes);
      return;
    }
    for (const [index, entry] of plan.entries.entries()) {
      const group = grouped.products[index];
      const card = element('div', 'bulk-product-card');
      card.dataset.state = entry.issues.length ? 'warn' : 'ready';
      card.dataset.productIndex = String(index);
      card.dataset.selected = String(index === selectedProductIndex);

      const head = element('div', 'bulk-card-head');
      const commonTarget = document.createElement('input');
      commonTarget.type = 'checkbox';
      commonTarget.checked = selectedForCommon.has(group);
      commonTarget.dataset.commonTarget = String(index);
      commonTarget.setAttribute('aria-label', `${entry.productName || '이름 없는 제품'} 제품 선택`);
      commonTarget.addEventListener('change', () => {
        commonTarget.checked ? selectedForCommon.add(group) : selectedForCommon.delete(group);
        invalidateConfirmation();
        render();
        queueWorkingSave();
      });
      head.append(commonTarget);
      if (group.queueRequest) head.append(element('span', 'status-message', '추가 결과 확인 필요 · 같은 요청으로 다시 확인'));
      // 흠은 왼쪽 세로줄로만 알린다. 카드 전체를 물들이면 무엇이 문제인지가 아니라
      // 카드가 통째로 노래져서, 정작 어느 칸이 비었는지는 여전히 안 보인다.
      head.append(element('span', 'bulk-card-rail'));
      const nameLabel = element('label', 'bulk-name-field');
      nameLabel.append(element('span', '', '제품명'));
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = entry.productName;
      nameInput.setAttribute('aria-label', `${index + 1}행 제품명`);
      nameInput.placeholder = '예: 슬라브 겹보 55x55cm';
      // 다시 그릴 때 이 칸을 찾아 초점을 되살리기 위한 표식.
      nameInput.dataset.focusKey = `product-name:${index}`;
      // 한글은 여러 자판을 모아 한 글자를 만든다. 조합 중에 표를 다시 그리면 입력칸이
      // 통째로 갈아 끼워져 초점이 날아가고 글자가 깨진다. 조합이 끝난 뒤에 다시 센다.
      nameInput.addEventListener('compositionstart', () => { composing = true; });
      nameInput.addEventListener('compositionend', () => {
        composing = false;
        if (group && !group.queued && !group.queueRequest && !busy && !restorePending) group.productName = nameInput.value.trim();
        schedulePlan();
      });
      nameInput.addEventListener('input', () => {
        if (group && !group.queued && !group.queueRequest && !busy && !restorePending) group.productName = nameInput.value.trim();
        // 글자를 칠 때마다 다시 그리면 초점이 매번 나간다. 조합 중에는 세지 않는다.
        if (composing) return;
        schedulePlan();
      });
      nameLabel.append(nameInput);
      head.append(nameLabel);
      head.append(element('span', 'bulk-card-summary', `사진 ${entry.images.length}장`));
      if (policyRegistry && !policyError) head.append(element('span', 'bulk-policy-row-summary', inputPolicySummary(entry.queuedPolicySnapshot?.resolved || resolveInputPolicy(policyRegistry, policyRequestFor(entry)), 'row')));
      if (entry.matchedCsv) head.append(element('span', 'bulk-card-badge', 'CSV 값 적용'));
      // 모자란 값은 머리글에서 바로 읽힌다. 카드 맨 아래에 두면 스크롤해야 보인다.
      head.append(element('span', 'bulk-card-spacer'));
      head.append(element('span', 'bulk-card-fact', `분류 ${entry.requiredValues.category || '—'}`));
      head.append(element('span', 'bulk-card-fact', `판매가 ${entry.requiredValues.salePrice || '—'}`));
      const verdict = element(
        'span',
        'bulk-card-verdict',
        entry.queued ? '작업큐에 추가됨' : entry.issues.length ? entry.issues.map(issue => ISSUE_LABELS[issue] || issue).join(' · ') : '큐 추가 준비됨',
      );
      verdict.dataset.tone = entry.issues.some(issue => BLOCKING_ISSUES.has(issue))
        ? 'blocked'
        : entry.issues.length ? 'warn' : 'ok';
      head.append(verdict);
      const rowActions = element('div', 'bulk-row-actions');
      const open = element('button', 'bulk-mini-action bulk-row-open', entry.queued ? '입력 내용 보기' : index === selectedProductIndex ? '편집 중' : '사진·필수값 편집');
      open.type = 'button';
      open.disabled = busy || restorePending;
      open.setAttribute('aria-expanded', String(index === selectedProductIndex));
      open.dataset.editProduct = String(index);
      open.addEventListener('click', () => {
        if (busy || restorePending) return;
        const previous = grouped.products[selectedProductIndex];
        if (previous && previous !== group) cancelProductSourceRequests(previous);
        selectedProductIndex = index; renderPlan(); queueWorkingSave();
      });
      rowActions.append(open);
      if (!entry.queued) {
        const remove = element('button', 'bulk-mini-action', '입력 취소');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${entry.productName || '이름 없는 제품'} 입력 취소`);
        let removeArmed = false;
        const keep = element('button', 'bulk-mini-action', '유지');
        keep.type = 'button';
        keep.hidden = true;
        keep.setAttribute('aria-label', `${entry.productName || '이름 없는 제품'} 입력 유지`);
        keep.addEventListener('click', () => {
          renderPlan();
          setStatus(`${entry.productName || '이름 없는 제품'} 입력을 유지했습니다.`);
        });
        remove.addEventListener('click', () => {
          if (!removeArmed) {
            removeArmed = true;
            keep.hidden = false;
            remove.textContent = '확인 · 입력 취소';
            remove.setAttribute('aria-label', `${entry.productName || '이름 없는 제품'} 입력 취소 확인`);
            setStatus(`${entry.productName || '이름 없는 제품'}의 입력과 사진 ${entry.images.length}장만 지웁니다. 「확인 · 입력 취소」 또는 「유지」를 선택하세요.`, 'warn');
            return;
          }
          selectedForCommon.delete(group);
          grouped.products.splice(index, 1);
          selectedProductIndex = Math.max(0, Math.min(selectedProductIndex, grouped.products.length - 1));
          rebuild();
          setStatus(`${entry.productName || '이름 없는 제품'} 입력만 취소했습니다. 다른 제품은 보존했습니다.`, 'ok');
        });
        rowActions.append(remove, keep);
      }
      head.append(rowActions);
      card.append(head);

      if (index === selectedProductIndex) {
        selectedEditor = element('section', 'bulk-selected-editor');
        selectedEditor.id = 'bulk-selected-editor';
        selectedEditor.dataset.state = entry.queued ? 'queued' : 'editing';
        selectedEditor.append(element('h3', '', `${entry.queued ? '입력 내용 보기' : '선택 제품 편집'} · ${entry.productName || '제품명을 입력하세요'}`));
        const editor = element('div', 'bulk-product-editor');
        editor.append(renderProductFields(entry, group, index), renderImageZones(group));
        selectedEditor.append(editor);
        if (policyRegistry && !policyError) {
          const decisions = document.createElement('details');
          decisions.className = 'bulk-product-policy';
          decisions.open = policyWasOpen;
          decisions.append(element('summary', '', entry.queued ? '이 제품의 확정 공정 설정' : '이 제품만 공정 설정 변경'));
          decisions.append(renderInputPolicyGrid({ registry: policyRegistry, overrides: group.decisionOverrides || {}, resolved: entry.queuedPolicySnapshot?.resolved || resolveInputPolicy(policyRegistry, policyRequestFor(entry)), product: true, disabled: entry.queued || Boolean(group.queueRequest) || busy || restorePending, onChange(id, mode) {
            if (group.queued || group.queueRequest || busy || restorePending) return;
            group.decisionOverrides = setInputDecision(group.decisionOverrides || {}, id, mode, policyRegistry.decisionPointIds);
            rebuild();
          } }));
          selectedEditor.append(decisions);
        }
        if (entry.queued) selectedEditor.append(element('p', 'status-message', '입력 원본을 보관 중입니다. 이후 편집은 작업큐에서 확인하세요.'));
        if (entry.queued || group.queueRequest || busy || restorePending) {
          for (const control of selectedEditor.querySelectorAll('input, select, textarea, button:not(.bulk-thumb)')) control.disabled = true;
        }
      }
      if (entry.queued) {
        card.dataset.state = 'queued';
      }
      if (entry.queued || busy || restorePending) {
        for (const control of card.querySelectorAll('input, select, .bulk-move-action, .bulk-mini-action:not(.bulk-row-open)')) control.disabled = true;
      }
      if (group.queueRequest) {
        for (const control of card.querySelectorAll('input:not([data-common-target]), select, .bulk-move-action, .bulk-mini-action:not(.bulk-row-open)')) control.disabled = true;
      }
      nodes.push(card);
    }
    if (selectedEditor) nodes.push(selectedEditor);
    table.replaceChildren(...nodes);
  }

  function labelledConfirmRow(label, value) {
    const dt = element('dt', '', label);
    const dd = element('dd', '', value);
    return [dt, dd];
  }

  /**
   * 큐로 보내기 전 마지막 확인. 실측 2026-09-03: 사진 넣고 바로 투입했더니 파일명이
   * 제품명이 된 채, 자동화 방식도 이미지 모델도 뭘로 진행되는지 한 번도 못 보고 넘어갔다.
   * "내가 정하게끔 해놨어야지" — 여기서 정확히 무엇으로 진행되는지 보여 주고 사람이
   * 한 번 더 눌러야 실제로 큐에 들어간다.
   */
  function renderConfirmBox() {
    confirmBox.hidden = !confirmState;
    confirmBox.replaceChildren();
    if (!confirmState) return;
    const { entries } = confirmState;
    confirmBox.append(element('strong', '', `작업큐에 추가할 제품 ${entries.length}개 · 마지막 확인`));
    confirmBox.append(element('p', 'status-message', `${confirmState.scope === 'selected' ? '선택 제품' : '준비된 전체'} · ${entries.length}개 추가 / 미준비·기투입 ${confirmState.excluded}개 제외`));

    const settings = document.createElement('dl');
    settings.className = 'bulk-confirm-settings';
    const modelLabel = imageModelSelect.selectedOptions[0]?.textContent.trim() || imageModelSelect.value || '지정 안 됨';
    settings.append(...labelledConfirmRow('이미지 생성 모델', modelLabel));
    const presetLabel = policySelect.selectedOptions[0]?.textContent.trim() || policySelect.value;
    settings.append(...labelledConfirmRow('공통 기본 자동화 방식', presetLabel));
    const judgment = confirmState.judgment;
    const decisionModel = String(judgment?.model || document.getElementById('model-select')?.value || '').trim();
    const decisionEffort = String(judgment?.reasoningEffort || document.getElementById('reasoning-select')?.value || '').trim();
    settings.append(...labelledConfirmRow(
      '판단 모델 (경쟁사·색상 등 AI 판단)',
      decisionModel && decisionEffort
        ? `${decisionModel} · 추론 ${decisionEffort}`
        : '자동판단 화면에서 설정되지 않음 — 자동 판단이 필요한 항목에서 막힐 수 있습니다',
    ));
    confirmBox.append(settings);
    confirmBox.append(element('p', 'bulk-automation-copy', '제품별 설정이 공통 기본보다 우선합니다. 공통·제품별 공정 설정을 반영한 실제 적용 방식은 아래 제품별 요약을 확인하세요.'));

    const flagged = entries.filter(entry => looksLikeCameraFileName(entry.productName));
    if (flagged.length) {
      const warn = element(
        'p',
        'bulk-confirm-warning',
        `제품명이 사진 파일 이름 그대로인 ${flagged.length}건은 그 이름으로 경쟁사도 검색됩니다 · `
          + `${flagged.slice(0, 4).map(entry => entry.productName).join(', ')}${flagged.length > 4 ? ' 외' : ''}`,
      );
      confirmBox.append(warn);
    }

    const list = document.createElement('ul');
    list.className = 'bulk-confirm-list';
    for (const entry of entries) {
      const li = document.createElement('li');
      li.append(element('span', '', entry.productName));
      li.append(element('small', 'bulk-policy-confirm-summary', inputPolicySummary(resolveInputPolicy(policyRegistry, policyRequestFor(entry)))));
      const request = confirmState.groups[entries.indexOf(entry)].queueRequest;
      if (request) li.append(element('small', 'status-message', `기존 요청 확인 · 이미지 모델 ${request.payload.imageModel || '지정 안 됨'} · 판단 ${request.judgment?.model || '지정 안 됨'} · 새 작업을 만들지 않습니다.`));
      if (looksLikeCameraFileName(entry.productName)) li.append(element('span', 'bulk-confirm-flag', '파일명 그대로'));
      list.append(li);
    }
    confirmBox.append(list);

    const row = element('div', 'bulk-confirm-actions');
    const confirm = element('button', 'board-action primary', `확인 · 작업큐에 ${entries.length}개 추가`);
    confirm.type = 'button';
    confirm.dataset.action = 'submit';
    confirm.dataset.queueScope = confirmState.scope;
    confirm.id = 'bulk-queue-confirm-submit';
    const cancel = element('button', 'board-action ghost', '다시 확인');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { confirmState = null; render(); });
    row.append(confirm, cancel);
    confirmBox.append(row);
  }

  function render() {
    renderPolicyControls();
    if (!plan.ready) confirmState = null;
    const selectedCount = grouped.products.filter(group => selectedForCommon.has(group)).length;
    const selectedReadyCount = queueRows('selected').length;
    submit.textContent = '입력 완료 제품 모두 추가';
    submitSelected.textContent = '선택한 제품 추가';
    submit.disabled = busy || restorePending || inputReads > 0 || plan.ready === 0 || Boolean(policyError);
    submitSelected.disabled = busy || restorePending || inputReads > 0 || selectedReadyCount === 0 || Boolean(policyError);
    for (const control of [newName, addProduct, pasteInput, pasteAdd, imageInput, csvInput, imageModelSelect, policySelect, ...defaultsBox.querySelectorAll('input')]) {
      control.disabled = busy || restorePending;
    }
    reset.disabled = busy || (!grouped.products.length && !csvRows.length);
    renderConfirmBox();
    // 막힌 건이 있으면 그것부터 말한다. 무엇을 채워야 버튼이 열리는지 모르면
    // 사람은 회색 버튼만 보고 고장으로 읽는다.
    hint.textContent = `선택한 ${selectedCount}개 중 ${selectedReadyCount}개 추가 가능 · 전체 ${plan.ready}개 추가 가능. `
      + (plan.blocked
      ? `${plan.blocked}개는 필수 정보가 빠져 제외됩니다. 제품 옆 안내를 확인해주세요.`
      : plan.warned
        ? '추가 정보는 조립공장에서 입력할 수 있습니다.'
        : plan.ready
          ? ''
          : '');
    renderStatus();
    renderCommonControls();
    renderColorRule();
    renderBatchBar();
    renderPlan();
  }

  async function submitPlan(confirmed) {
    // 차단 흠이 있는 건은 보내지 않는다. image_missing 만 거르면 색상명 없는 옵션 사진이
    // 조용히 기본 사진으로 강등된 채 수락되고, 기본 사진 없는 건은 서버 422 로 튕긴다 —
    // 버튼의 'N건 투입' 과 실제 전송 건수도 어긋난다.
    const { entries, groups } = confirmed;
    if (!entries.length || confirmed.version !== inputVersion || groups.some(group => !grouped.products.includes(group) || group.queued)) return;
    confirmState = null;
    busy = true;
    const batchId = `batch-bulk-${entries.length}-${entries[0].productName}`.slice(0, 60);
    const imageModel = confirmed.imageModel;
    const results = [];
    progress = { done: 0, total: entries.length, current: entries[0].productName };
    render();
    try {
    for (const [index, entry] of entries.entries()) {
      const group = groups[index];
      progress = { done: results.length, total: entries.length, current: entry.productName };
      renderStatus();
      try {
        const dataUrls = [];
        const sha256s = [];
        for (const image of entry.images) {
          dataUrls.push(await readAsDataUrl(image.file));
          sha256s.push(await digestOf(image.file));
        }
        // 큐의 직접 입력 폼과 같은 규칙: 제품마다 정책을 잠그고, 잠금 여부가 auto/manual 을 정한다.
        const request = group.queueRequest;
        const requestBatchId = request?.payload.batchId || batchId;
        const policySnapshot = request?.payload.policySnapshot || await lockPolicy(entry, requestBatchId);
        const policyRequest = policyRequestFor(entry, requestBatchId);
        assertInputPolicySnapshot(policySnapshot, policyRequest, resolveInputPolicy(policyRegistry, policyRequest));
        const payload = buildProductPayload(entry, {
          batchId: requestBatchId, imageModel, dataUrls, sha256s,
          mode: policySnapshot?.locked === true ? 'auto' : 'manual',
          policySnapshot,
        });
        const savedPayload = { ...payload, inputImages: payload.inputImages.map(({ dataUrl, ...image }) => image) };
        if (request && (JSON.stringify(request.payload) !== JSON.stringify(savedPayload)
          || JSON.stringify(request.judgment) !== JSON.stringify(confirmed.judgment))) {
          throw new Error('미해결 요청의 설정과 다릅니다. 기존 모델·입력 설정으로 되돌린 뒤 같은 요청을 확인하세요.');
        }
        group.queueRequest ||= { payload: savedPayload, judgment: confirmed.judgment };
        if (!(await saveWorkingState({ submission: true }))) throw new Error('전송 전 입력 보존을 확인하지 못했습니다. 저장 상태를 확인한 뒤 같은 요청을 다시 확인하세요.');
        if (confirmed.version !== inputVersion) throw new Error('입력이 바뀌었습니다. 전송 대상을 다시 확인하세요.');
        const queued = await requestWithDeadline('/api/factory/jobs', { method: 'POST', body: JSON.stringify(payload) });
        const queuedJob = readBulkQueueReceipt(queued, payload);
        if (group) {
          group.queued = true;
          group.queuedJobId = String(queuedJob.jobId || '');
          group.requiredValues = { ...entry.requiredValues };
          group.queuedPolicySnapshot = policySnapshot;
          delete group.queueRequest;
        }
        if (!(await saveWorkingState({ submission: true }))) throw new Error('작업큐 수락은 확인했지만 저장을 확인하지 못했습니다. 새로 추가하지 말고 기존 작업큐를 확인하세요.');
        results.push({ productName: entry.productName, jobId: String(queuedJob.jobId || ''), status: 'queued' });
      } catch (error) {
        results.push({
          productName: entry.productName,
          status: 'error',
          reason: submitFailureCopy(error),
        });
      }
    }
    } finally {
      // 무슨 일이 있어도 화면은 풀어 준다. 잠긴 채 남으면 사람이 다시 누를 길이 없다.
      progress = null;
      busy = false;
    }
    const summary = summarizeBulkIntake(results);
    const failed = results.filter(item => item.status === 'error');
    setStatus(
      failed.length
        ? `${summary.copy} · ${failed.slice(0, 3).map(item => `${item.productName}(${item.reason})`).join(', ')}`
        : summary.copy,
      summary.tone,
    );
    if (summary.queued) {
      imageInput.value = '';
      const jobIds = results
        .filter(item => item.status === 'queued')
        .map(item => String(item.jobId || ''))
        .filter(Boolean);
      window.dispatchEvent(new CustomEvent('control-tower:job-created', {
        detail: {
          jobIds,
          factoryJobIds: jobIds,
          productNames: results.filter(item => item.status === 'queued').map(item => item.productName),
        },
      }));
    }
    rebuild();
    if (summary.queued && !failed.length) window.controlTowerMenu?.activate('queue');
  }

  async function onImagePick() {
    // 여기서 고른 사진은 전부 기본 이미지다. 파일명 꼬리를 색상으로 넘겨짚어 색상 구역에
    // 넣으면, 사진 한 장짜리 제품이 기본 없음으로 막힌다 — 실측 2026-08-28:
    // 3.꽃핑_03_product_3.jpg 한 장이 색상 'product 3' 으로 분류되어 투입이 잠겼다.
    // 색상 사진은 카드의 색상 구역에서 사람이 직접 추가하거나 옮긴다.
    //
    // 그리고 통째로 갈아끼우지 않고 합친다 — 카드에서 색상 사진을 붙이고 이름을 다듬은
    // 뒤에 ① 로 사진을 더 고르면, 그 손질이 전부 날아가면 안 된다.
    const incoming = groupImageFiles([...(imageInput.files || [])]);
    restoreCancelled = true;
    for (const product of incoming.products) {
      const existing = grouped.products.find(item => !item.queued && item.productName === product.productName);
      if (existing?.queueRequest) { setStatus('미해결 제품의 사진은 같은 요청 확인 후 바꿀 수 있습니다.', 'warn'); continue; }
      if (!existing) {
        grouped.products.push({ ...product, inheritDefaults: false });
        continue;
      }
      for (const image of product.images) {
        if (existing.images.some(item => item.fileName === image.fileName)) continue;
        existing.images.push({ ...image, ordinal: existing.images.length + 1 });
      }
    }
    grouped.skipped = incoming.skipped;
    setStatus(
      grouped.products.length
        ? `제품 ${grouped.products.length}건으로 묶었습니다.`
        : '이미지 파일을 찾지 못했습니다.',
      grouped.products.length ? 'ok' : 'warning',
    );
    rebuild();
  }

  async function onCsvPick() {
    const file = (csvInput.files || [])[0];
    if (!file) {
      csvRows = [];
      csvErrors = [];
      rebuild();
      return;
    }
    inputReads += 1;
    invalidateConfirmation();
    render();
    try {
      const parsed = parseIntakeCsv(await file.text());
      csvRows = parsed.rows;
      csvErrors = parsed.errors;
      setStatus(`CSV 제품 ${csvRows.length}건을 읽었습니다.`, csvErrors.length ? 'warning' : 'ok');
    } catch (error) {
      csvRows = [];
      csvErrors = [];
      setStatus(`CSV 를 읽지 못했습니다 · ${String(error?.message || error)}`, 'error');
    } finally {
      inputReads -= 1;
    }
    rebuild();
  }

  async function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || busy || restorePending || inputReads || composing) return;
    if (target.dataset.action === 'submit') {
      if (confirming) return;
      if (planTimer) { clearTimeout(planTimer); planTimer = null; rebuild(); }
      const version = inputVersion;
      const scope = target.dataset.queueScope === 'selected' ? 'selected' : 'all';
      confirming = true;
      let judgment;
      try { judgment = await getJudgmentSettings?.(); }
      catch (error) { setStatus(`판단 설정 확인 실패 · ${error.message}`, 'error'); return; }
      finally { confirming = false; }
      if (planTimer) { clearTimeout(planTimer); planTimer = null; rebuild(); }
      if (!confirmState || confirmState.scope !== scope || version !== inputVersion) {
        const rows = queueRows(scope);
        if (!rows.length) return;
        const entries = rows.map(({ entry }) => ({ ...entry, requiredValues: { ...entry.requiredValues },
          decisionOverrides: { ...entry.decisionOverrides }, images: entry.images.map(image => ({ ...image })) }));
        const imageModel = imageModelSelect.value || '';
        confirmState = { entries, groups: rows.map(row => row.group), scope, version: inputVersion, judgment, imageModel,
          excluded: (scope === 'selected' ? grouped.products.filter(group => selectedForCommon.has(group)).length : plan.entries.length) - entries.length };
        render();
        return;
      }
      if (JSON.stringify(confirmState.judgment) !== JSON.stringify(judgment)) {
        confirmState.judgment = judgment;
        setStatus('원본 판단 모델 설정이 바뀌었습니다. 변경된 설정을 확인하고 다시 추가하세요.', 'warning');
        render();
        return;
      }
      void submitPlan(confirmState);
    }
    if (target.dataset.action === 'reset') {
      selectedForCommon.clear();
      grouped = { products: [], skipped: [] };
      csvRows = [];
      csvErrors = [];
      imageInput.value = '';
      csvInput.value = '';
      // 저장해 둔 새로고침 생존 기록도 함께 지운다 — 비운 뒤 새로고침했는데 되살아나면 안 된다.
      restoreCancelled = true;
      void clearWorkingState();
      setStatus('고른 파일을 비웠습니다.', '');
      rebuild();
    }
  }

  /**
   * 크기 한 줄에 '20x15' 처럼 적으면 가로·세로 칸을 대신 채워 준다.
   *
   * 사람이 그 칸을 직접 건드린 뒤에는 절대 덮어쓰지 않는다 — 타이핑할 때마다 파서가 돌면
   * 손으로 고쳐 둔 값이 다음 글자에 되돌아간다. 손댄 칸은 data-touched 로 표시해 둔다.
   */
  function fillSizePairFromSize(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.dataset) return;
    const key = target.dataset.defaultKey;
    if (key === 'widthMm' || key === 'depthMm') {
      target.dataset.touched = target.value.trim() ? 'true' : 'false';
      return;
    }
    if (key !== 'size') return;
    const pair = readSizePair(target.value);
    for (const [pairKey, value] of [['widthMm', pair.widthMm], ['depthMm', pair.depthMm]]) {
      if (!value) continue;
      const field = defaultsBox.querySelector(`[data-default-key="${pairKey}"]`);
      if (!field || field.dataset.touched === 'true') continue;
      field.value = value;
    }
  }

  imageInput.addEventListener('change', onImagePick);
  csvInput.addEventListener('change', onCsvPick);
  // 채우기가 먼저 돌아야 rebuild 가 채워진 값을 읽는다.
  defaultsBox.addEventListener('input', fillSizePairFromSize);
  defaultsBox.addEventListener('input', rebuild);
  root.addEventListener('click', onClick);
  rebuild();
  void restoreWorkingState();
  void refreshCategories();
  void loadInputPolicy();

  return () => {
    imageInput.removeEventListener('change', onImagePick);
    csvInput.removeEventListener('change', onCsvPick);
    defaultsBox.removeEventListener('input', fillSizePairFromSize);
    defaultsBox.removeEventListener('input', rebuild);
    root.removeEventListener('click', onClick);
  };
}

if (globalThis.controlTowerRuntime && document.getElementById('bulk-intake')) {
  mountBulkIntake(globalThis.controlTowerRuntime);
}
