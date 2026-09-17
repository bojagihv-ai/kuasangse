/**
 * 작업대의 「제품 넣기」 — 사진 + 이름 + 필수값 + 자동화 정책 한 장.
 *
 * 본문 계약은 옛 대량 투입과 글자 단위로 같다: buildProductPayload(bulk-intake-model) 가 만든
 * manual-product-intake 본문을 그대로 쓰고, 정책은 먼저 /api/automation/policy/snapshot 로 잠근다.
 * 다른 점은 화면뿐이다 — 한 제품을 한 장에서 넣고, 결정 지점 15개를 자동/내가 로 고를 수 있다.
 *
 * "자동" 은 조립공장이 스스로 고른다(GPT OAuth, 한도에 막히면 Claude OAuth 폴백 — 조립공장 설정).
 * "내가" 로 둔 결정은 줄에서 「내 차례」로 올라오고, 거기서 손·GPT·Claude 로 고른다.
 */
import { buildProductPayload, isSupportedImage, readImageName } from '../bulk-intake-model.mjs?bulkIntake=14';
import { loadCafe24Categories } from '../intake-categories.mjs?intakeCategories=1';
import { PRODUCT_VALUE_LABELS } from '../production-board-model.mjs?parallelBoard=46';
import { apiRequest, ORIGINS } from './api.mjs?wb=1';
import { readWorkfile, describeWorkfile, submitWorkfile, WORKFILE_COPY } from './workfile.mjs?wb=1';

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = value => (Array.isArray(value) ? value : []);

export const IMAGE_MODELS = Object.freeze([
  // 비우면 본문에 imageModel 이 실리지 않아 조립공장이 제 설정으로 고른다(옛 투입과 같다).
  { id: '', label: '조립공장 기본 설정' },
  { id: 'gemini-3.1-flash-image', label: '나노바나나2 (Gemini 3.1 Flash Image)' },
  { id: 'api-hub-openai-image', label: 'OpenAI 이미지 생성 (API Hub)' },
]);

export const PRESETS = Object.freeze([
  { key: 'full_auto', label: '전부 자동', hint: '조립공장이 다 고르고 Cafe24 승인만 사람이' },
  { key: 'representative_manual', label: '대표컷만 내가', hint: '대표 이미지에서 멈춰 내 차례로' },
  { key: 'representative_and_size_manual', label: '대표·사이즈컷 내가', hint: '' },
  { key: 'all_images_manual', label: '그림 전부 내가', hint: '대표·사이즈·옵션·이미지컷' },
  { key: 'custom', label: '직접 정하기', hint: '아래 15개를 하나씩' },
]);

export const DECISION_LABELS = Object.freeze({
  sinhwa_db_product: '신화DB 제품 매칭',
  cafe24_product: 'Cafe24 기존 상품 매칭',
  competitor_product: '경쟁사 제품 고르기',
  competitor_coupang: '경쟁사 · 쿠팡',
  competitor_smartstore: '경쟁사 · 스마트스토어',
  competitor_gmarket: '경쟁사 · G마켓',
  competitor_auction: '경쟁사 · 옥션',
  competitor_elevenst: '경쟁사 · 11번가',
  required_field_candidate: '필수값 후보',
  representative_image: '대표 이미지',
  size_image: '사이즈 이미지',
  option_image: '옵션 이미지',
  general_image: '이미지컷',
  section_variant: '섹션 변형',
  final_detail: '최종 상세',
});

export const DECISION_IDS = Object.freeze(Object.keys(DECISION_LABELS));

/** 화면 순서. 필수 8개가 앞, Cafe24 등록값이 뒤. 값 채우기 패널과 같은 이름을 쓴다. */
export const INTAKE_FIELDS = Object.freeze([
  { key: 'category', required: true, hint: '예: 지갑' },
  { key: 'material', required: true, hint: '예: 색동원단' },
  { key: 'originCountry', required: true, hint: '예: 대한민국' },
  { key: 'size', required: true, hint: '예: 가로15cm*세로8cm' },
  { key: 'salePrice', required: true, hint: '숫자만' },
  { key: 'stock', required: true, hint: '숫자만' },
  { key: 'usage', required: true, hint: '예: 동전·소품 보관' },
  { key: 'supplyPrice', required: false, hint: '숫자만' },
  { key: 'cafe24CategoryId', required: false, hint: '「분류 불러오기」로 고르거나 번호 직접' },
]);

const READ_DEADLINE_MS = 20_000;

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function button(label, className, onClick, { action = '', disabled = false, type = 'button' } = {}) {
  const node = element('button', className, label);
  node.type = type;
  node.disabled = disabled;
  if (action) node.dataset.action = action;
  node.addEventListener('click', event => { event.preventDefault(); onClick(event); });
  return node;
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => reject(new Error('image_read_timeout')), READ_DEADLINE_MS);
    reader.onload = () => { clearTimeout(timer); resolve(String(reader.result || '')); };
    reader.onerror = () => { clearTimeout(timer); reject(reader.error || new Error('image_read_failed')); };
    reader.readAsDataURL(file);
  });
}

export async function digestOf(file) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 투입을 막는 흠. 나머지는 조립공장이 채운다. */
export function validateDraft(draft) {
  const issues = [];
  if (!text(draft.productName)) issues.push('제품명이 비었습니다.');
  const photos = list(draft.photos);
  if (!photos.length) issues.push('사진이 없습니다.');
  else if (!photos.some(photo => photo.role === 'base')) issues.push('기본 사진이 하나는 있어야 합니다.');
  for (const photo of photos) {
    if (photo.role === 'color-option' && !text(photo.colorName)) issues.push(`${photo.fileName}: 색상옵션 사진에는 색상명이 필요합니다.`);
  }
  const values = record(draft.values);
  if (text(values.salePrice) && !/^\d{1,12}$/u.test(text(values.salePrice).replace(/[,\s원]/gu, ''))) issues.push('판매가는 숫자만 적습니다.');
  if (text(values.stock) && !/^\d{1,9}$/u.test(text(values.stock))) issues.push('기본 재고는 숫자만 적습니다.');
  if (draft.registrationMode === 'update' && !/^\d+$/u.test(text(draft.targetProductNo))) issues.push('기존 상품 수정이면 Cafe24 상품번호가 필요합니다.');
  return issues;
}

/** 정책 잠금 요청 본문. custom 은 full_auto 위에 productOverride 를 얹는다. */
export function policyRequest(draft, batchId) {
  const overrides = {};
  for (const [decision, mode] of Object.entries(record(draft.overrides))) {
    if (DECISION_IDS.includes(decision) && (mode === 'auto' || mode === 'manual')) overrides[decision] = mode;
  }
  return {
    batchId,
    productId: text(draft.productName),
    preset: text(draft.preset) || 'full_auto',
    batchOverride: {},
    productOverride: overrides,
    stageOverride: {},
  };
}

/** 사진·값·정책으로 조립공장 본문을 만든다. dataUrls/sha256s 는 photos 와 같은 순서. */
export function buildIntakePayload(draft, { batchId, dataUrls, sha256s, policySnapshot }) {
  const values = { ...record(draft.values) };
  values.displayStatus = draft.displayStatus === true ? 'T' : 'F';
  values.sellingStatus = draft.sellingStatus === true ? 'T' : 'F';
  const entry = {
    productName: text(draft.productName),
    images: list(draft.photos).map(photo => ({
      fileName: photo.fileName,
      name: photo.name,
      role: photo.role,
      colorName: text(photo.colorName),
    })),
    requiredValues: values,
    sourceSelection: draft.source?.kind === 'sinhwa-db'
      ? { kind: 'sinhwa-db', selectionId: String(draft.source.selectionId) }
      : { kind: 'manual' },
  };
  const payload = buildProductPayload(entry, {
    batchId,
    imageModel: text(draft.imageModel),
    dataUrls,
    sha256s,
    mode: policySnapshot?.locked === true ? 'auto' : 'manual',
    policySnapshot,
  });
  const registration = { registrationMode: draft.registrationMode === 'update' ? 'update' : 'create' };
  if (registration.registrationMode === 'update') registration.targetProductNo = text(draft.targetProductNo);
  return {
    ...payload,
    ...(text(draft.detailHint) ? { detailHint: text(draft.detailHint) } : {}),
    cafe24Registration: registration,
  };
}

/** 정책 잠금 → 사진 읽기 → 줄에 세우기. 돌아오는 값은 관제탑이 만든 작업. */
export async function submitDraft(draft, { request = apiRequest } = {}) {
  const issues = validateDraft(draft);
  if (issues.length) throw Object.assign(new Error(issues.join(' ')), { code: 'intake_invalid', issues });
  const batchId = `wb-${Date.now().toString(36)}`;
  const snapshot = await request('/api/automation/policy/snapshot', { method: 'POST', body: policyRequest(draft, batchId) });
  const dataUrls = [];
  const sha256s = [];
  for (const photo of list(draft.photos)) {
    dataUrls.push(await readAsDataUrl(photo.file));
    sha256s.push(await digestOf(photo.file));
  }
  const payload = buildIntakePayload(draft, { batchId, dataUrls, sha256s, policySnapshot: snapshot });
  const response = await request('/api/factory/jobs', { method: 'POST', body: payload });
  return { job: record(response?.job), payload, snapshot };
}

/**
 * 폼을 한 번 그린다. 입력값은 DOM 이 들고 있다가 제출할 때 읽는다 — 글자 칠 때마다 다시 그리지 않는다.
 * handlers: { queued(job), status(message, tone) }
 */
export function mountIntake(root, { handlers = {}, request = apiRequest, loadCategories = loadCafe24Categories } = {}) {
  const state = {
    photos: [],
    source: { kind: 'manual' },
    sources: [],
    categories: [],
    overrides: {},
    busy: false,
  };
  root.replaceChildren();

  const form = element('form', 'wb-intake-form');
  form.noValidate = true;

  // 0. 작업파일로 시작 — 조립공장에서 저장한 .kuasangse 를 그대로 줄에 세운다(옛 앞면의 작업파일 탭과 같은 경로).
  const workfileBlock = element('section', 'wb-intake-block wb-workfile');
  workfileBlock.append(element('h3', '', '작업파일(.kuasangse)로 시작'));
  const workfileInput = document.createElement('input');
  workfileInput.type = 'file';
  workfileInput.accept = '.kuasangse';
  workfileInput.id = 'wb-intake-workfile';
  workfileInput.hidden = true;
  const workfileLabel = element('label', 'wb-btn');
  workfileLabel.htmlFor = workfileInput.id;
  workfileLabel.textContent = '작업파일 고르기';
  const workfileLine = element('p', 'wb-note');
  workfileLine.id = 'wb-intake-workfile-summary';
  workfileLine.textContent = '조립공장에서 이미 진행하던 제품이면 사진·값을 다시 넣지 않고 그 작업파일부터 이어 갑니다. 조립공장이 다른 제품을 열고 있으면 안 됩니다.';
  const workfileBar = element('div', 'wb-actions');
  const workfileSubmit = button('이 작업파일로 줄에 세우기', 'wb-btn primary', () => void handleWorkfileSubmit(), { action: 'queue-workfile', disabled: true });
  workfileBar.append(workfileLabel, workfileSubmit);
  workfileBlock.append(workfileBar, workfileInput, workfileLine);
  form.append(workfileBlock);
  let workfile = null;
  workfileInput.addEventListener('change', async () => {
    const file = workfileInput.files?.[0];
    workfileInput.value = '';
    if (!file) return;
    workfile = null;
    workfileSubmit.disabled = true;
    workfileLine.textContent = `${file.name} 읽는 중…`;
    try {
      workfile = await readWorkfile(file);
      workfileLine.textContent = `${workfile.fileName} · ${describeWorkfile(workfile)}`;
      workfileSubmit.disabled = false;
    } catch (error) {
      workfileLine.textContent = `${file.name} · ${WORKFILE_COPY[text(error?.code)] || text(error?.message || error)}`;
    }
  });
  async function handleWorkfileSubmit() {
    if (!workfile || state.busy) return;
    if (!globalThis.confirm(`${text(workfile.classification?.product?.name) || workfile.fileName} 작업파일로 줄에 세울까요? 조립공장이 이 파일을 열어 이어 갑니다.`)) return;
    state.busy = true;
    workfileSubmit.disabled = true;
    workfileSubmit.textContent = '세우는 중…';
    try {
      const { job } = await submitWorkfile(workfile, { request });
      const name = text(job?.productName) || text(workfile.classification?.product?.name) || workfile.fileName;
      workfile = null;
      workfileLine.textContent = `${name} 을(를) 작업파일로 줄에 세웠습니다.`;
      handlers.queued?.(job);
      handlers.status?.(`${name} 을(를) 작업파일로 줄에 세웠습니다.`, 'ok');
    } catch (error) {
      const message = `${WORKFILE_COPY[text(error?.code)] || text(error?.message || error)}${text(error?.code) ? ` (${text(error.code)})` : ''}`;
      workfileLine.textContent = message;
      handlers.status?.(`작업파일로 세우지 못했습니다 · ${message}`, 'error');
      workfileSubmit.disabled = !workfile;
    } finally {
      state.busy = false;
      workfileSubmit.textContent = '이 작업파일로 줄에 세우기';
    }
  }

  // 1. 사진
  const photosBlock = element('section', 'wb-intake-block');
  photosBlock.append(element('h3', '', '1. 사진'));
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = 'image/*';
  fileInput.id = 'wb-intake-files';
  const fileLabel = element('label', 'wb-btn');
  fileLabel.htmlFor = fileInput.id;
  fileLabel.textContent = '사진 고르기';
  fileInput.hidden = true;
  const photoList = element('div', 'wb-photos');
  photoList.id = 'wb-intake-photos';
  photosBlock.append(fileLabel, fileInput, photoList, element('p', 'wb-note', '첫 장이 기본 사진입니다. 색상옵션 사진은 역할을 바꾸고 색상명을 적으세요. 이름은 파일명에서 옵니다.'));
  form.append(photosBlock);

  function renderPhotos() {
    photoList.replaceChildren();
    if (!state.photos.length) {
      photoList.append(element('p', 'wb-note', '아직 사진이 없습니다.'));
      return;
    }
    state.photos.forEach((photo, index) => {
      const card = element('div', 'wb-photo');
      card.dataset.index = String(index);
      card.dataset.role = photo.role;
      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = photo.name;
      card.append(image);
      const meta = element('div', 'wb-photo-meta');
      meta.append(element('b', '', photo.fileName));
      const role = document.createElement('select');
      role.name = `photo-role-${index}`;
      role.append(new Option('기본 사진', 'base'), new Option('색상옵션 사진', 'color-option'));
      role.value = photo.role;
      role.addEventListener('change', () => { photo.role = role.value; renderPhotos(); });
      meta.append(role);
      if (photo.role === 'color-option') {
        const color = document.createElement('input');
        color.type = 'text';
        color.name = `photo-color-${index}`;
        color.placeholder = '색상명 (예: 남색)';
        color.value = photo.colorName || '';
        color.addEventListener('input', () => { photo.colorName = color.value; });
        meta.append(color);
      }
      meta.append(button('빼기', 'wb-btn sm ghost', () => {
        URL.revokeObjectURL(photo.url);
        state.photos.splice(index, 1);
        renderPhotos();
      }, { action: 'remove-photo' }));
      card.append(meta);
      photoList.append(card);
    });
  }

  fileInput.addEventListener('change', () => {
    const skipped = [];
    for (const file of [...(fileInput.files || [])]) {
      if (!isSupportedImage(file.name)) { skipped.push(file.name); continue; }
      state.photos.push({
        file,
        fileName: file.name,
        name: readImageName(file.name) || file.name,
        role: state.photos.length ? 'base' : 'base',
        colorName: '',
        url: URL.createObjectURL(file),
      });
    }
    fileInput.value = '';
    if (skipped.length) handlers.status?.(`지원하지 않는 파일은 뺐습니다 · ${skipped.join(', ')}`, 'error');
    renderPhotos();
  });
  renderPhotos();

  // 2. 이름과 출처
  const nameBlock = element('section', 'wb-intake-block');
  nameBlock.append(element('h3', '', '2. 이름'));
  const nameGrid = element('div', 'wb-form');
  const nameField = element('label', 'wb-field');
  nameField.append(element('span', 'wb-field-name', '제품명'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.name = 'productName';
  nameInput.placeholder = '스토어에 올라갈 이름';
  nameInput.autocomplete = 'off';
  nameField.append(nameInput);
  const hintField = element('label', 'wb-field');
  hintField.append(element('span', 'wb-field-name', '상세 힌트 (선택)'));
  const hintInput = document.createElement('input');
  hintInput.type = 'text';
  hintInput.name = 'detailHint';
  hintInput.placeholder = '조립공장에 한 줄로 알려줄 것';
  hintInput.autocomplete = 'off';
  hintField.append(hintInput);
  nameGrid.append(nameField, hintField);
  nameBlock.append(nameGrid);

  const bring = element('div', 'wb-bring');
  const search = document.createElement('input');
  search.type = 'search';
  search.name = 'wb-intake-source-query';
  search.placeholder = '신화DB 에 있는 제품이면 여기서 찾아 잇기 (이름·분류를 가져오고 jcode 를 묶는다)';
  search.autocomplete = 'off';
  const sourceLine = element('p', 'wb-note');
  sourceLine.id = 'wb-intake-source';
  const sourceList = element('ul', 'wb-sources');
  async function searchSources() {
    const q = text(search.value);
    if (!q) return;
    try {
      const response = await request(`/api/pdp/sources?q=${encodeURIComponent(q)}`);
      state.sources = list(response?.sources);
    } catch (error) {
      handlers.status?.(`신화DB 찾기 실패 · ${text(error?.message || error)}`, 'error');
      return;
    }
    sourceList.replaceChildren();
    if (!state.sources.length) sourceList.append(element('li', 'wb-note', '신화DB에 그 이름의 제품이 없습니다.'));
    for (const source of state.sources.slice(0, 8)) {
      const item = element('li');
      const line = [text(source.productName), text(source.category) ? `분류 ${text(source.category)}` : '', `J${text(source.jcode)}`].filter(Boolean).join(' · ');
      item.append(button(line, 'wb-link', () => {
        state.source = { kind: 'sinhwa-db', selectionId: String(source.jcode), productName: text(source.productName), category: text(source.category) };
        if (!text(nameInput.value)) nameInput.value = text(source.productName);
        const categoryInput = form.querySelector('input[name="category"]');
        if (categoryInput && !text(categoryInput.value) && text(source.category)) categoryInput.value = text(source.category);
        renderSourceLine();
      }, { action: 'pick-source' }));
      sourceList.append(item);
    }
  }
  search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void searchSources(); } });
  bring.append(search, button('찾기', 'wb-btn sm', () => void searchSources(), { action: 'search-intake-sources' }));
  function renderSourceLine() {
    sourceLine.replaceChildren();
    if (state.source.kind === 'sinhwa-db') {
      sourceLine.append(document.createTextNode(`신화DB J${state.source.selectionId} · ${state.source.productName} 에 잇습니다. `));
      sourceLine.append(button('잇기 풀기', 'wb-link', () => { state.source = { kind: 'manual' }; renderSourceLine(); }, { action: 'clear-source' }));
    } else {
      sourceLine.textContent = '출처: 직접 입력 (신화DB 에 없는 새 제품)';
    }
  }
  renderSourceLine();
  nameBlock.append(bring, sourceList, sourceLine);
  form.append(nameBlock);

  // 3. 값
  const valuesBlock = element('section', 'wb-intake-block');
  valuesBlock.append(element('h3', '', '3. 값'));
  const valuesGrid = element('div', 'wb-form');
  for (const field of INTAKE_FIELDS) {
    const label = element('label', 'wb-field');
    label.dataset.key = field.key;
    const name = element('span', 'wb-field-name', PRODUCT_VALUE_LABELS[field.key] || field.key);
    if (field.required) name.append(element('em', 'wb-tag', '필수'));
    const input = document.createElement('input');
    input.type = 'text';
    input.name = field.key;
    input.placeholder = field.hint;
    input.autocomplete = 'off';
    label.append(name, input);
    if (field.key === 'cafe24CategoryId') {
      const categorySelect = document.createElement('select');
      categorySelect.name = 'cafe24CategorySelect';
      categorySelect.hidden = true;
      categorySelect.addEventListener('change', () => { input.value = categorySelect.value; });
      label.append(categorySelect);
      label.append(button('분류 불러오기', 'wb-btn sm', async event => {
        const trigger = event.currentTarget;
        trigger.disabled = true;
        try {
          state.categories = await loadCategories(ORIGINS.apiHub);
          categorySelect.replaceChildren(new Option('분류를 고르세요', ''));
          for (const category of state.categories) categorySelect.append(new Option(`${category.label} (${category.id})`, category.id));
          categorySelect.hidden = false;
          if (text(input.value)) categorySelect.value = text(input.value);
        } catch (error) {
          handlers.status?.(`Cafe24 분류를 못 불러왔습니다 · ${text(error?.message || error)}`, 'error');
        } finally {
          trigger.disabled = false;
        }
      }, { action: 'load-categories' }));
    }
    valuesGrid.append(label);
  }
  valuesBlock.append(valuesGrid);
  const toggles = element('div', 'wb-actions');
  const displayToggle = document.createElement('input');
  displayToggle.type = 'checkbox';
  displayToggle.name = 'displayStatus';
  const displayLabel = element('label', 'wb-check');
  displayLabel.append(displayToggle, document.createTextNode(' 등록 즉시 진열'));
  const sellingToggle = document.createElement('input');
  sellingToggle.type = 'checkbox';
  sellingToggle.name = 'sellingStatus';
  const sellingLabel = element('label', 'wb-check');
  sellingLabel.append(sellingToggle, document.createTextNode(' 등록 즉시 판매'));
  toggles.append(displayLabel, sellingLabel, element('span', 'wb-note', '둘 다 끄면 스토어에 올라가도 손님에겐 안 보입니다(기본).'));
  valuesBlock.append(toggles);

  const registrationRow = element('div', 'wb-actions');
  const registrationSelect = document.createElement('select');
  registrationSelect.name = 'registrationMode';
  registrationSelect.append(new Option('Cafe24 에 새 상품으로 등록', 'create'), new Option('Cafe24 기존 상품을 수정', 'update'));
  const targetInput = document.createElement('input');
  targetInput.type = 'text';
  targetInput.name = 'targetProductNo';
  targetInput.placeholder = '수정할 상품번호';
  targetInput.hidden = true;
  registrationSelect.addEventListener('change', () => { targetInput.hidden = registrationSelect.value !== 'update'; });
  registrationRow.append(registrationSelect, targetInput, element('span', 'wb-note', '새 상품이면 이름이 비슷한 기존 상품에 붙지 않습니다.'));
  valuesBlock.append(registrationRow);
  form.append(valuesBlock);

  // 4. 자동화
  const policyBlock = element('section', 'wb-intake-block');
  policyBlock.append(element('h3', '', '4. 어디까지 자동으로'));
  const policyRow = element('div', 'wb-form');
  const presetField = element('label', 'wb-field');
  presetField.append(element('span', 'wb-field-name', '정책'));
  const presetSelect = document.createElement('select');
  presetSelect.name = 'preset';
  for (const preset of PRESETS) presetSelect.append(new Option(preset.hint ? `${preset.label} — ${preset.hint}` : preset.label, preset.key));
  presetSelect.value = 'full_auto';
  presetField.append(presetSelect);
  const modelField = element('label', 'wb-field');
  modelField.append(element('span', 'wb-field-name', '이미지 생성 모델'));
  const modelSelect = document.createElement('select');
  modelSelect.name = 'imageModel';
  for (const model of IMAGE_MODELS) modelSelect.append(new Option(model.label, model.id));
  modelField.append(modelSelect);
  policyRow.append(presetField, modelField);
  policyBlock.append(policyRow);
  const matrix = element('div', 'wb-matrix');
  matrix.id = 'wb-intake-matrix';
  function renderMatrix() {
    matrix.replaceChildren();
    matrix.hidden = presetSelect.value !== 'custom';
    if (matrix.hidden) return;
    for (const decision of DECISION_IDS) {
      const row = element('div', 'wb-matrix-row');
      row.dataset.decision = decision;
      row.append(element('span', '', DECISION_LABELS[decision]));
      for (const mode of ['auto', 'manual']) {
        const label = element('label', 'wb-check');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `decision-${decision}`;
        radio.value = mode;
        radio.checked = (state.overrides[decision] || 'auto') === mode;
        radio.addEventListener('change', () => { state.overrides[decision] = mode; });
        label.append(radio, document.createTextNode(mode === 'auto' ? ' 자동' : ' 내가'));
        row.append(label);
      }
      matrix.append(row);
    }
  }
  presetSelect.addEventListener('change', renderMatrix);
  renderMatrix();
  policyBlock.append(matrix, element('p', 'wb-note', '자동 = 조립공장이 고른다(GPT OAuth, 한도면 Claude OAuth 폴백). 내가 = 줄에서 「내 차례」로 올라오고 손·GPT·Claude 로 고른다.'));
  form.append(policyBlock);

  // 5. 세우기
  const submitRow = element('div', 'wb-actions');
  const submit = button('줄에 세우기', 'wb-btn primary', () => void handleSubmit(), { action: 'queue-product', type: 'submit' });
  const problems = element('p', 'wb-note error');
  problems.id = 'wb-intake-problems';
  submitRow.append(submit, element('span', 'wb-note', '정책을 잠근 뒤 사진을 읽어 조립공장 줄에 세웁니다. 세우기 전에 한 번 묻습니다.'));
  form.append(submitRow, problems);

  function readDraft() {
    const values = {};
    for (const field of INTAKE_FIELDS) {
      const input = form.querySelector(`input[name="${field.key}"]`);
      const value = text(input?.value);
      if (value) values[field.key] = value;
    }
    return {
      productName: text(nameInput.value),
      detailHint: text(hintInput.value),
      photos: state.photos,
      values,
      displayStatus: displayToggle.checked,
      sellingStatus: sellingToggle.checked,
      registrationMode: registrationSelect.value,
      targetProductNo: text(targetInput.value),
      preset: presetSelect.value,
      overrides: presetSelect.value === 'custom' ? { ...state.overrides } : {},
      imageModel: modelSelect.value,
      source: state.source,
    };
  }

  async function handleSubmit() {
    if (state.busy) return;
    const draft = readDraft();
    const issues = validateDraft(draft);
    problems.textContent = issues.join(' ');
    if (issues.length) return;
    const presetLabel = PRESETS.find(item => item.key === draft.preset)?.label || draft.preset;
    if (!globalThis.confirm(`${draft.productName} 을(를) 사진 ${draft.photos.length}장, 정책 「${presetLabel}」로 줄에 세울까요?`)) return;
    state.busy = true;
    submit.disabled = true;
    submit.textContent = '세우는 중…';
    try {
      const { job } = await submitDraft(draft, { request });
      for (const photo of state.photos) URL.revokeObjectURL(photo.url);
      state.photos = [];
      state.source = { kind: 'manual' };
      state.overrides = {};
      form.reset();
      renderPhotos();
      renderSourceLine();
      renderMatrix();
      // 접고 줄을 새로 읽은 뒤에 말한다 — 말이 먼저 나오면 화면은 아직 옛 모습이다.
      handlers.queued?.(job);
      handlers.status?.(`${text(job.productName) || draft.productName} 을(를) 줄에 세웠습니다.`, 'ok');
    } catch (error) {
      const message = error?.code === 'intake_invalid' ? error.message : `줄에 세우지 못했습니다 · ${text(error?.message || error)}${text(error?.code) ? ` (${text(error.code)})` : ''}`;
      problems.textContent = message;
      handlers.status?.(message, 'error');
    } finally {
      state.busy = false;
      submit.disabled = false;
      submit.textContent = '줄에 세우기';
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void handleSubmit(); });
  root.append(form);
  return { readDraft, state };
}
