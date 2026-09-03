import {
  BLOCKING_ISSUES,
  buildBulkPlan,
  buildProductPayload,
  groupImageFiles,
  hydrateWorkingState,
  readSizePair,
  isSupportedImage,
  parseIntakeCsv,
  readImageName,
  serializeWorkingState,
  summarizeBulkIntake,
} from './bulk-intake-model.mjs?bulkIntake=11';

// 회색 글씨는 보기일 뿐 값이 아니다. '주방' 처럼만 적어 두면 이미 채워진 것처럼 읽혀서,
// 아래 카드가 "분류 비어 있음" 이라고 말하는 것과 서로 어긋나 보인다. 보기라고 못박는다.
//
// 필드 기준은 조립공장의 직접 입력 폼(intake-form 의 required-*)이다 — 사람이 넣어야만 하는
// 값이 곧 이 폼의 전부다. 조립공장이 스스로 만드는 값은 여기 두지 않는다.
const DEFAULT_FIELDS = Object.freeze([
  { key: 'category', label: '분류', placeholder: '예: 주방', group: 'product' },
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

const ISSUE_LABELS = Object.freeze({
  image_missing: '이미지 없음',
  product_name_missing: '제품명 비어 있음',
  product_name_from_file: '제품명이 사진 파일 이름 그대로입니다',
  base_image_missing: '기본 이미지 없음',
  color_name_missing: '옵션 사진에 색상명 없음',
  category_missing: '분류 비어 있음',
  sale_price_missing: '판매가 비어 있음',
  sale_price_invalid: '판매가 자릿수 초과 (12자리까지)',
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

export function mountBulkIntake(runtime, { root = document.getElementById('bulk-intake') } = {}) {
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
  async function lockPolicy(productId, batchId) {
    const base = automation.snapshotRequest?.(String(productId)) || {
      productId: String(productId),
      preset: String(document.getElementById('batch-policy')?.value || '').trim() || 'full_auto',
      batchOverride: { ...(automation.batchOverride || {}) },
      productOverride: { ...(automation.productOverride || {}) },
      stageOverride: { ...(automation.stageOverride || {}) },
    };
    const policyRequest = { ...base, batchId: String(batchId || ''), productId: String(productId) };
    const policySnapshot = await requestWithDeadline('/api/automation/policy/snapshot', {
      method: 'POST',
      body: JSON.stringify(policyRequest),
    });
    automation.snapshot = policySnapshot;
    window.dispatchEvent(new CustomEvent('control-tower:policy-locked', {
      detail: { snapshotId: policySnapshot.snapshotId },
    }));
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
    const model = String(document.getElementById('model-select')?.value || '').trim();
    const reasoningEffort = String(document.getElementById('reasoning-select')?.value || '').trim();
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
        serviceTier: String(document.getElementById('tier-select')?.value || 'standard'),
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
  let status = { copy: '이미지 파일을 여러 개 고르면 제품별로 묶어 한 번에 투입합니다.', tone: '' };
  let progress = null;

  const heading = element('div', 'section-heading');
  const headingCopy = element('div');
  headingCopy.append(element('p', 'eyebrow', 'BULK INTAKE'), element('h2', '', '제품 일괄 투입'));
  heading.append(
    headingCopy,
    element('p', 'section-copy', '이미지를 좌라락 고르면 파일 이름으로 제품을 묶습니다. 제품별 값은 CSV 로 붙이거나 아래 기본값으로 채웁니다.'),
  );

  const pickers = element('div', 'bulk-pickers');
  const imageLabel = element('label', 'bulk-picker');
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.multiple = true;
  imageInput.accept = 'image/*';
  imageInput.id = 'bulk-image-input';
  imageLabel.append(element('span', '', '① 제품 사진 고르기 — 기본 이미지로 들어갑니다'), imageInput);

  const csvLabel = element('label', 'bulk-picker');
  const csvInput = document.createElement('input');
  csvInput.type = 'file';
  csvInput.accept = '.csv,.tsv,.txt';
  csvInput.id = 'bulk-csv-input';
  csvLabel.append(element('span', '', '② 제품 정보 CSV (선택)'), csvInput);
  pickers.append(imageLabel, csvLabel);

  // 사람이 넣어야만 하는 조립공장 필수값은 항상 보이고, Cafe24 등록값(선택)은 접어 둔다.
  // 열한 칸이 한 줄에 쏟아지면 무엇이 필수인지 읽히지 않는다.
  const defaultsBox = element('div', 'bulk-defaults');
  const factoryRow = element('div', 'bulk-defaults-row');
  factoryRow.append(element('span', 'bulk-defaults-label', '필수값 (전 제품 공통)'));
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

  const actions = element('div', 'bulk-actions');
  const submit = element('button', 'board-action primary', '작업 큐에 투입');
  submit.type = 'button';
  submit.dataset.action = 'submit';
  const reset = element('button', 'board-action ghost', '고른 파일 비우기');
  reset.type = 'button';
  reset.dataset.action = 'reset';
  const hint = element('span', 'board-toolbar-hint');
  actions.append(submit, reset, hint);

  const statusNode = element('p', 'status-message');
  const table = element('div', 'bulk-plan');

  root.replaceChildren(heading, pickers, defaultsBox, colorRuleDetails, bulkBar, actions, statusNode, table);

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

  async function saveWorkingState() {
    if (persistDisabled || busy) return;
    if (saveBusy) { saveAgain = true; return; }
    saveBusy = true;
    try {
      const db = await openWorkingDb();
      if (!db) return;
      // 사진 본문은 처음 볼 때 한 번만 넣는다. 같은 트랜잭션 안에서 안 쓰는 본문을 지워
      // 저장소가 비대해지지 않게 한다(비우기·투입 뒤에는 여기서 전부 지워진다).
      const referenced = new Set();
      const fresh = [];
      for (const product of grouped.products) {
        for (const image of product.images || []) {
          if (!image.file) continue;
          if (!image.blobId) { image.blobId = crypto.randomUUID(); fresh.push(image); }
          referenced.add(image.blobId);
        }
      }
      const stateRecord = serializeWorkingState({ grouped, csvRows, csvErrors, defaults });
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
    } catch {
      // 용량 초과 등. 이후로는 메모리 전용으로만 돈다 — 화면 동작은 그대로여야 한다.
      persistDisabled = true;
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
      if (!revived || (!revived.grouped.products.length && !revived.csvRows.length)) return;
      grouped = revived.grouped;
      csvRows = revived.csvRows;
      csvErrors = revived.csvErrors;
      for (const input of defaultsBox.querySelectorAll('[data-default-key]')) {
        const value = revived.defaults[input.dataset.defaultKey];
        if (typeof value === 'string') input.value = value;
      }
      const parts = [`이전에 작업하던 제품 ${revived.grouped.products.length}건을 복원했습니다`];
      if (revived.csvRows.length) parts.push(`CSV ${revived.csvRows.length}건 포함`);
      if (revived.dropped.length) parts.push(`사진 ${revived.dropped.length}장은 본문이 없어 빠졌습니다`);
      setStatus(`${parts.join(' · ')}. 이어서 하시거나 「고른 파일 비우기」로 지울 수 있습니다.`, 'ok');
      rebuild();
    } catch {
      // 깨진 기록이면 빈 화면으로 시작한다. 다음 저장이 새 기록으로 덮어쓴다.
    } finally {
      restorePending = false;
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
    input.hidden = true;
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
    // 파일 없이 시작하는 길. 이름을 치고 구역별 '사진 추가' 로 채우면 큐의 직접 입력과 같다.
    const blank = element('button', 'bulk-mini-action', '＋ 빈 제품 추가');
    blank.type = 'button';
    blank.addEventListener('click', () => {
      grouped.products.push({ productName: '', images: [] });
      schedulePlan();
    });
    bulkBar.append(blank);
  }

  function renderPlan() {
    const nodes = [];
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
      nodes.push(element('p', 'factory-empty-state', '아직 고른 이미지가 없습니다.'));
      table.replaceChildren(...nodes);
      return;
    }
    for (const [index, entry] of plan.entries.entries()) {
      const group = grouped.products[index];
      const card = element('div', 'bulk-product-card');
      card.dataset.state = entry.issues.length ? 'warn' : 'ready';

      const head = element('div', 'bulk-card-head');
      // 흠은 왼쪽 세로줄로만 알린다. 카드 전체를 물들이면 무엇이 문제인지가 아니라
      // 카드가 통째로 노래져서, 정작 어느 칸이 비었는지는 여전히 안 보인다.
      head.append(element('span', 'bulk-card-rail'));
      const nameLabel = element('label', 'bulk-name-field');
      nameLabel.append(element('span', '', '제품명'));
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = entry.productName;
      nameInput.placeholder = '예: 슬라브 겹보 55x55cm';
      // 다시 그릴 때 이 칸을 찾아 초점을 되살리기 위한 표식.
      nameInput.dataset.focusKey = `product-name:${index}`;
      // 한글은 여러 자판을 모아 한 글자를 만든다. 조합 중에 표를 다시 그리면 입력칸이
      // 통째로 갈아 끼워져 초점이 날아가고 글자가 깨진다. 조합이 끝난 뒤에 다시 센다.
      nameInput.addEventListener('compositionstart', () => { composing = true; });
      nameInput.addEventListener('compositionend', () => {
        composing = false;
        if (group) group.productName = nameInput.value.trim();
        schedulePlan();
      });
      nameInput.addEventListener('input', () => {
        if (group) group.productName = nameInput.value.trim();
        // 글자를 칠 때마다 다시 그리면 초점이 매번 나간다. 조합 중에는 세지 않는다.
        if (composing) return;
        schedulePlan();
      });
      nameLabel.append(nameInput);
      head.append(nameLabel);
      head.append(element('span', 'bulk-card-summary', `사진 ${entry.images.length}장`));
      if (entry.matchedCsv) head.append(element('span', 'bulk-card-badge', 'CSV 값 적용'));
      // 모자란 값은 머리글에서 바로 읽힌다. 카드 맨 아래에 두면 스크롤해야 보인다.
      head.append(element('span', 'bulk-card-spacer'));
      head.append(element('span', 'bulk-card-fact', `분류 ${entry.requiredValues.category || '—'}`));
      head.append(element('span', 'bulk-card-fact', `판매가 ${entry.requiredValues.salePrice || '—'}`));
      const verdict = element(
        'span',
        'bulk-card-verdict',
        entry.issues.length ? entry.issues.map(issue => ISSUE_LABELS[issue] || issue).join(' · ') : '준비됨',
      );
      verdict.dataset.tone = entry.issues.some(issue => BLOCKING_ISSUES.has(issue))
        ? 'blocked'
        : entry.issues.length ? 'warn' : 'ok';
      head.append(verdict);
      card.append(head);

      card.append(renderImageZones(group));
      nodes.push(card);
    }
    table.replaceChildren(...nodes);
  }

  function render() {
    submit.textContent = plan.ready ? `작업 큐에 ${plan.ready}건 투입` : '작업 큐에 투입';
    submit.disabled = busy || plan.ready === 0;
    reset.disabled = busy || (!grouped.products.length && !csvRows.length);
    // 막힌 건이 있으면 그것부터 말한다. 무엇을 채워야 버튼이 열리는지 모르면
    // 사람은 회색 버튼만 보고 고장으로 읽는다.
    hint.textContent = plan.blocked
      ? `${plan.blocked}건은 지금 상태로 투입할 수 없습니다. 카드 오른쪽에 적힌 항목을 채우거나 고쳐 주세요.`
      : plan.warned
        ? `${plan.warned}건은 값이 비어 있어도 투입은 됩니다. 조립공장에서 채우게 됩니다.`
        : plan.ready
          ? '파일 이름이 제품명이 됩니다. 같은 이름_숫자 는 한 제품의 여러 장으로 묶입니다.'
          : '';
    renderStatus();
    renderColorRule();
    renderBatchBar();
    renderPlan();
  }

  async function submitPlan() {
    // 차단 흠이 있는 건은 보내지 않는다. image_missing 만 거르면 색상명 없는 옵션 사진이
    // 조용히 기본 사진으로 강등된 채 수락되고, 기본 사진 없는 건은 서버 422 로 튕긴다 —
    // 버튼의 'N건 투입' 과 실제 전송 건수도 어긋난다.
    const entries = plan.entries.filter(entry => !entry.issues.some(issue => BLOCKING_ISSUES.has(issue)));
    if (!entries.length) return;
    busy = true;
    const batchId = `batch-bulk-${entries.length}-${entries[0].productName}`.slice(0, 60);
    const imageModel = document.getElementById('image-model-select')?.value || '';
    const results = [];
    progress = { done: 0, total: entries.length, current: entries[0].productName };
    render();
    try {
    for (const entry of entries) {
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
        const policySnapshot = await lockPolicy(entry.productName, batchId);
        const payload = buildProductPayload(entry, {
          batchId, imageModel, dataUrls, sha256s,
          mode: policySnapshot?.locked === true ? 'auto' : 'manual',
          policySnapshot,
        });
        const queued = await requestWithDeadline('/api/factory/jobs', { method: 'POST', body: JSON.stringify(payload) });
        const queuedJob = queued?.job && typeof queued.job === 'object' && !Array.isArray(queued.job)
          ? queued.job
          : {};
        results.push({
          productName: entry.productName,
          jobId: String(queuedJob.jobId || ''),
          status: 'queued',
        });
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
      grouped = { products: [], skipped: [] };
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
    for (const product of incoming.products) {
      const existing = grouped.products.find(item => item.productName === product.productName);
      if (!existing) {
        grouped.products.push(product);
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
    try {
      const parsed = parseIntakeCsv(await file.text());
      csvRows = parsed.rows;
      csvErrors = parsed.errors;
      setStatus(`CSV 제품 ${csvRows.length}건을 읽었습니다.`, csvErrors.length ? 'warning' : 'ok');
    } catch (error) {
      csvRows = [];
      csvErrors = [];
      setStatus(`CSV 를 읽지 못했습니다 · ${String(error?.message || error)}`, 'error');
    }
    rebuild();
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || busy) return;
    if (target.dataset.action === 'submit') void submitPlan();
    if (target.dataset.action === 'reset') {
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
