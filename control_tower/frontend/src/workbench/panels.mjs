/**
 * 작업대의 펼친 행 — 사람이 손대는 세 화면: 컷 고르기 · 값 채우기 · Cafe24 승인.
 *
 * 이 파일은 그리기만 한다. 사실은 행(row = buildQueueModel 의 한 줄, row.raw 는 보드 행)에서 읽고,
 * 행동은 handlers 로만 밖에 말한다. 어느 API 를 어떤 본문으로 부르는지는 main.mjs 가 안다.
 *
 * 컷 고르기는 손으로도, GPT·Claude 로도 된다 — 둘 다 같은 예약 API 를 타서 조립공장이 그 작업을
 * 다시 열 때 적용된다(살아 있는 작업이면 바로). 자동으로 골라도 어느 컷이 왜 골렸는지 영수증을 보인다.
 */
import { PRODUCT_VALUE_LABELS } from '../production-board-model.mjs?parallelBoard=46';
import { ORIGINS } from './api.mjs?wb=1';

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = value => (Array.isArray(value) ? value : []);

/** 자동 선택 판정자. 어느 쪽이든 관제탑 백엔드가 OAuth 로그인 상태를 확인하고 영수증을 검증한다. */
export const PROVIDERS = Object.freeze([
  { key: 'gpt-oauth', label: 'GPT로 고르기' },
  { key: 'claude-oauth', label: 'Claude로 고르기' },
]);

/** 조작자가 채우는 값. 순서는 화면 순서다. 필수 8개가 앞, Cafe24 등록값이 뒤. */
export const VALUE_FIELDS = Object.freeze([
  { key: 'productName', required: false, hint: '' },
  { key: 'category', required: true, hint: '예: 선물포장' },
  { key: 'material', required: true, hint: '예: 슬라브' },
  { key: 'originCountry', required: true, hint: '예: 대한민국' },
  { key: 'size', required: true, hint: '예: 55x55cm' },
  { key: 'salePrice', required: true, hint: '숫자만' },
  { key: 'stock', required: true, hint: '숫자만' },
  { key: 'usage', required: true, hint: '예: 선물포장 · 섹션 글에 쓰인다' },
  { key: 'optionMode', required: true, hint: 'none 이면 단일 옵션' },
  { key: 'supplyPrice', required: false, hint: '' },
  { key: 'cafe24CategoryId', required: false, hint: '' },
  { key: 'displayStatus', required: false, hint: 'T/F' },
  { key: 'sellingStatus', required: false, hint: 'T/F' },
]);

const THUMB_WIDTH = 240;

/**
 * 후보 그림 주소. 조립공장 보관함(/api/local-archive/...)은 조립공장 주소로, 나머지 /api 는 관제탑으로.
 * 원본(/image)은 160KB 가 넘어 8장을 한 번에 펴면 무겁다 — 보관함이 내주는 축소본(/thumbnail?w=)을 쓴다.
 */
export function thumbnailSrc(source, width = THUMB_WIDTH) {
  const raw = text(source);
  if (!raw) return '';
  const base = raw.startsWith('/api/local-archive/') ? ORIGINS.factoryBackend : ORIGINS.apiBase;
  let resolved;
  try {
    resolved = new URL(raw, `${base}/`);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(resolved.protocol)) return '';
  const matched = resolved.pathname.match(/^(.*\/api\/local-archive\/assets\/[^/?#]+)\/image$/u);
  if (matched) {
    resolved.pathname = `${matched[1]}/thumbnail`;
    resolved.search = `?w=${width}`;
  }
  return resolved.href;
}

/** 고를 수 있는 칸. 인박스가 가리킨 단계가 있으면 그것을 앞에 세운다. */
export function pickableCells(row) {
  const cells = list(record(row.raw).cells).filter(cell => cell.pickable);
  const wanted = text(row.stageKey);
  return cells.sort((a, b) => (text(b.stageKey) === wanted) - (text(a.stageKey) === wanted));
}

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function button(label, className, onClick, { disabled = false, action = '' } = {}) {
  const node = element('button', className, label);
  node.type = 'button';
  node.disabled = disabled;
  if (action) node.dataset.action = action;
  node.addEventListener('click', event => { event.stopPropagation(); onClick(event); });
  return node;
}

function candidateCaption(candidate) {
  const label = text(candidate.label) || text(candidate.id);
  const why = text(candidate.summary) || text(candidate.rationale);
  return { label, why };
}

/**
 * 컷 고르기. ui = { chosen: {stageKey: candidateId}, busy, receipt, note }
 * handlers: select({jobId, stageKey, candidateId}), judge({jobId, provider}), choose({stageKey, candidateId})
 */
export function providerName(provider) {
  return text(provider) === 'claude-oauth' ? 'Claude' : text(provider) === 'gpt-oauth' ? 'GPT' : text(provider);
}

/**
 * 자동 고르기 토글. 켜 두면 이 제품의 컷은 고른 판정자가 고른다 — 지금 기다리는 단계부터, 다음 단계도 저절로.
 * ui.autoPick = '' | 'gpt-oauth' | 'claude-oauth', ui.autoPickInherited = 전체 기본값에서 온 것인가.
 */
export function renderAutoToggle(row, ui = {}, handlers = {}) {
  const bar = element('div', 'wb-auto');
  bar.dataset.on = String(Boolean(text(ui.autoPick)));
  const provider = text(ui.autoPick);
  const label = element('label', 'wb-switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'auto-pick';
  input.setAttribute('role', 'switch');
  input.checked = Boolean(provider);
  label.append(input, element('span', '', '자동으로 고르기'));
  const select = document.createElement('select');
  select.name = 'auto-pick-provider';
  for (const item of PROVIDERS) select.append(new Option(providerName(item.key), item.key));
  select.value = provider || 'claude-oauth';
  select.disabled = !input.checked;
  input.addEventListener('change', () => handlers.setAutoPick?.({ jobId: row.jobId, provider: input.checked ? select.value : '' }));
  select.addEventListener('change', () => { if (input.checked) handlers.setAutoPick?.({ jobId: row.jobId, provider: select.value }); });
  bar.append(label, select);
  bar.append(element('span', 'wb-note', provider
    ? `${providerName(provider)}가 이 제품의 컷을 고릅니다 — 기다리는 단계부터 바로, 다음 단계도 저절로.${ui.autoPickInherited ? ' (전체 기본값)' : ''}`
    : '끄면 후보를 보고 내가 고릅니다. 한 번만 맡기려면 아래 GPT/Claude 버튼.'));
  return bar;
}

export function renderPickPanel(row, ui = {}, handlers = {}) {
  const root = element('div', 'wb-pick');
  root.dataset.panel = 'pick';
  root.append(renderAutoToggle(row, ui, handlers));
  const cells = pickableCells(row);
  const chosen = record(ui.chosen);
  if (!cells.length) {
    // 실측 2026-09-17: 인박스가 "컷 고르기" 라 해도 여섯 단계가 이미 다 골라진 작업이 셋 있었다.
    // 그때 빈 말 대신 고른 컷을 보여 준다 — 사람이 확인할 것은 "무엇을 골랐나" 다.
    root.append(renderChosenReview(row));
    return root;
  }
  for (const cell of cells) {
    const stageKey = text(cell.stageKey);
    const section = element('section', 'wb-stage');
    section.dataset.stageKey = stageKey;
    const head = element('div', 'wb-stage-head');
    head.append(element('b', '', `${text(cell.stageLabel) || stageKey} · 후보 ${list(cell.candidates).length}개`));
    if (text(cell.reservedCandidateId)) {
      head.append(element('span', 'wb-tag', '선택 예약됨 · 조립공장이 다시 열면 적용'));
    }
    section.append(head);

    const grid = element('div', 'wb-cuts');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', `${text(cell.stageLabel) || stageKey} 후보`);
    list(cell.candidates).forEach((candidate, index) => {
      const id = text(candidate.id);
      const { label, why } = candidateCaption(candidate);
      // 타일은 div — 안에 「크게」 버튼이 들어가므로 button 으로 두면 겹친 버튼이 된다. 키보드는 Enter/Space.
      const cut = element('div', 'wb-cut');
      cut.tabIndex = 0;
      cut.dataset.candidateId = id;
      cut.dataset.stageKey = stageKey;
      cut.setAttribute('role', 'radio');
      const picked = chosen[stageKey] === id;
      cut.setAttribute('aria-checked', String(picked));
      if (id && id === text(cell.reservedCandidateId)) cut.dataset.reserved = 'true';
      cut.title = why || label;
      const frame = element('span', 'wb-cut-frame');
      const src = thumbnailSrc(candidate.thumbnailUrl);
      if (src && candidate.kind !== 'document') {
        const image = document.createElement('img');
        image.alt = label;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.src = src;
        image.addEventListener('error', () => { frame.dataset.broken = 'true'; }, { once: true });
        frame.append(image);
        const full = fullImageSrc(candidate.contentUrl || candidate.thumbnailUrl);
        frame.append(button('크게', 'wb-cut-zoom', () => openLightbox(full, `${index + 1} · ${label}${why ? ` — ${why}` : ''}`), { action: 'zoom-cut' }));
      } else {
        frame.dataset.empty = 'true';
        frame.append(element('span', 'wb-cut-doc', candidate.kind === 'document' ? '문서' : '그림 없음'));
      }
      cut.append(frame);
      cut.append(element('span', 'wb-cut-n', String(index + 1)));
      cut.append(element('span', 'wb-cut-label', label));
      if (why) cut.append(element('span', 'wb-cut-why', why));
      const choose = () => handlers.choose?.({ stageKey, candidateId: id });
      cut.addEventListener('click', event => { event.stopPropagation(); choose(); });
      cut.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
      });
      grid.append(cut);
    });
    section.append(grid);

    const bar = element('div', 'wb-actions');
    const candidateId = text(chosen[stageKey]);
    bar.append(button(
      candidateId ? `${candidateId === text(cell.reservedCandidateId) ? '이미 예약된 컷' : '이 컷으로 확정'}` : '컷을 먼저 누르세요',
      'wb-btn primary',
      () => handlers.select?.({ jobId: row.jobId, stageKey, candidateId }),
      { disabled: !candidateId || ui.busy === true || candidateId === text(cell.reservedCandidateId), action: 'select-candidate' },
    ));
    bar.append(element('span', 'wb-or', '또는 자동으로'));
    for (const provider of PROVIDERS) {
      bar.append(button(
        provider.label,
        'wb-btn',
        () => handlers.judge?.({ jobId: row.jobId, provider: provider.key }),
        { disabled: ui.busy === true, action: `judge-${provider.key}` },
      ));
    }
    section.append(bar);
    root.append(section);
  }
  if (ui.receipt) root.append(renderReceipt(ui.receipt));
  if (text(ui.note)) root.append(element('p', 'wb-note', text(ui.note)));
  return root;
}

/** 원본 크기 주소. 축소본으로 바꾸지 않는다 — 크게 보기용. */
export function fullImageSrc(source) {
  const raw = text(source);
  if (!raw) return '';
  const base = raw.startsWith('/api/local-archive/') ? ORIGINS.factoryBackend : ORIGINS.apiBase;
  try {
    const resolved = new URL(raw, `${base}/`);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : '';
  } catch {
    return '';
  }
}

let lightbox = null;

/** 크게 보기. 한 장짜리 dialog 하나를 돌려쓴다. 바깥을 누르거나 ESC·닫기로 닫는다. */
export function openLightbox(src, caption = '') {
  if (!src || typeof document === 'undefined') return null;
  if (!lightbox) {
    lightbox = document.createElement('dialog');
    lightbox.className = 'wb-lightbox';
    lightbox.addEventListener('click', event => {
      if (event.target === lightbox || event.target?.dataset?.action === 'close-lightbox') lightbox.close();
    });
    document.body.append(lightbox);
  }
  lightbox.replaceChildren();
  const figure = element('figure');
  const image = document.createElement('img');
  image.src = src;
  image.alt = caption || '크게 보기';
  figure.append(image);
  const foot = element('div', 'wb-actions');
  if (caption) foot.append(element('figcaption', '', caption));
  foot.append(element('span', 'wb-spacer'));
  foot.append(button('닫기', 'wb-btn sm', () => lightbox.close(), { action: 'close-lightbox' }));
  figure.append(foot);
  lightbox.append(figure);
  if (typeof lightbox.showModal === 'function') lightbox.showModal();
  else lightbox.setAttribute('open', '');
  return lightbox;
}

/** 이미 고른 컷 한눈에 — 단계마다 몇 개 중 몇 번째를 골랐고 그 그림은 무엇인지. 고칠 일이 없으면 여기서 끝. */
export function renderChosenReview(row) {
  const box = element('section', 'wb-stage wb-chosen');
  box.dataset.stageKey = 'chosen';
  const cells = list(record(row.raw).cells);
  const picked = cells.filter(cell => text(cell.selectedId));
  // 아직 아무 후보도 안 만들어진 제품이면 빈 칸 여섯 개 대신 한 줄로.
  if (!picked.length && cells.every(cell => !Number(cell.candidateCount))) {
    box.append(element('p', 'wb-note', '아직 만든 컷이 없습니다. 조립공장이 대표이미지부터 만들면 여기에 후보가 뜹니다.'));
    return box;
  }
  const head = element('div', 'wb-stage-head');
  head.append(element('b', '', picked.length === cells.length && cells.length
    ? `여섯 단계를 다 골랐습니다 · 고른 컷 ${picked.length}개`
    : `고른 컷 ${picked.length}개 · 후보가 없는 단계 ${cells.length - picked.length}개`));
  box.append(head);
  const grid = element('div', 'wb-cuts');
  for (const cell of cells) {
    const cut = element('div', 'wb-cut');
    cut.dataset.stageKey = text(cell.stageKey);
    cut.dataset.chosen = String(Boolean(text(cell.selectedId)));
    const frame = element('span', 'wb-cut-frame');
    const src = text(cell.selectedId) && !cell.selectedIsDocument ? thumbnailSrc(cell.selectedThumbnailUrl) : '';
    if (src) {
      const image = document.createElement('img');
      image.alt = text(cell.stageLabel);
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = src;
      image.addEventListener('error', () => { frame.dataset.broken = 'true'; }, { once: true });
      frame.append(image);
    } else {
      frame.dataset.empty = 'true';
      frame.append(element('span', 'wb-cut-doc', text(cell.selectedId) ? (cell.selectedIsDocument ? '문서' : '그림 없음') : '후보 없음'));
    }
    cut.append(frame);
    cut.append(element('span', 'wb-cut-label', text(cell.stageLabel) || text(cell.stageKey)));
    cut.append(element('span', 'wb-cut-why', text(cell.selectedId)
      ? `${cell.candidateCount}개 중 ${cell.selectedIndex || '?'}번째`
      : cell.candidateCount ? `${cell.candidateCount}개 후보 · 아직 안 고름` : '이 제품엔 없는 단계'));
    grid.append(cut);
  }
  box.append(grid);
  return box;
}

/** 자동 선택 영수증 — 어느 판정자가, 어느 모델로, 얼마에, 왜. */
export function renderReceipt(receipt) {
  const source = record(receipt);
  const box = element('div', 'wb-receipt');
  box.dataset.provider = text(source.provider) || 'gpt-oauth';
  const parts = [
    text(source.provider) === 'claude-oauth' ? 'Claude' : text(source.provider) === 'gpt-oauth' ? 'GPT' : text(source.provider),
    text(source.model),
    Number.isFinite(Number(source.costUsd)) && source.costUsd !== undefined ? `$${Number(source.costUsd).toFixed(3)}` : '',
    text(source.candidateId) ? `고른 컷 ${text(source.candidateId)}` : '',
  ].filter(Boolean);
  box.append(element('b', '', parts.join(' · ')));
  const why = text(source.reason) || text(source.rationale) || text(source.summary);
  if (why) box.append(element('span', '', why));
  return box;
}

/**
 * 값 채우기. ui = { sources: [{jcode, productName, category}], siblings: [{jobId, productName, requiredValues}], busy, note }
 * handlers: save(jobId, values), search(query), importSource(source), copyFrom(jobId)
 */
export function renderValuesPanel(row, ui = {}, handlers = {}) {
  const root = element('form', 'wb-values');
  root.dataset.panel = 'values';
  root.noValidate = true;
  const raw = record(row.raw);
  const current = record(raw.requiredValues);
  // 신화DB·다른 제품에서 가져온 값은 저장 전까지 prefill 에만 있다. 저장은 current 와 다른 칸만 보낸다.
  const prefill = record(ui.prefill);
  const missing = new Set(list(raw.missingRequiredValues).map(text));
  const fields = [...VALUE_FIELDS].sort((a, b) => missing.has(b.key) - missing.has(a.key));

  const grid = element('div', 'wb-form');
  for (const field of fields) {
    const label = element('label', 'wb-field');
    label.dataset.key = field.key;
    if (missing.has(field.key)) label.dataset.missing = 'true';
    const name = element('span', 'wb-field-name', PRODUCT_VALUE_LABELS[field.key] || field.key);
    if (missing.has(field.key)) name.append(element('em', 'wb-tag warn', '비어 있음'));
    else if (field.required) name.append(element('em', 'wb-tag', '필수'));
    const input = document.createElement('input');
    input.type = 'text';
    input.name = field.key;
    input.value = field.key in prefill ? text(prefill[field.key]) : text(current[field.key]);
    if (field.key in prefill && text(prefill[field.key]) !== text(current[field.key])) label.dataset.prefilled = 'true';
    input.placeholder = field.hint;
    input.autocomplete = 'off';
    label.append(name, input);
    grid.append(label);
  }
  root.append(grid);

  const bring = element('div', 'wb-bring');
  const search = document.createElement('input');
  search.type = 'search';
  search.name = 'wb-source-query';
  search.placeholder = '신화DB 제품명으로 찾기 — 있는 제품이면 값을 불러온다';
  search.autocomplete = 'off';
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); handlers.search?.(search.value); }
  });
  bring.append(search);
  bring.append(button('찾기', 'wb-btn sm', () => handlers.search?.(search.value), { action: 'search-sources' }));
  const siblings = list(ui.siblings).filter(item => text(item.jobId) !== row.jobId);
  if (siblings.length) {
    const pick = document.createElement('select');
    pick.name = 'wb-copy-from';
    pick.append(new Option('줄의 다른 제품 값 복사…', ''));
    for (const item of siblings) pick.append(new Option(text(item.productName) || text(item.jobId), text(item.jobId)));
    pick.addEventListener('change', () => { if (pick.value) handlers.copyFrom?.(pick.value); });
    bring.append(pick);
  }
  root.append(bring);
  const sources = list(ui.sources);
  if (sources.length) {
    const found = element('ul', 'wb-sources');
    for (const source of sources.slice(0, 8)) {
      const item = element('li');
      const line = [text(source.productName), text(source.category) ? `분류 ${text(source.category)}` : '', `J${text(source.jcode)}`]
        .filter(Boolean).join(' · ');
      item.append(button(line, 'wb-link', () => handlers.importSource?.(source), { action: 'import-source' }));
      found.append(item);
    }
    root.append(found);
  } else if (ui.searched) {
    root.append(element('p', 'wb-note', '신화DB에 그 이름의 제품이 없습니다.'));
  }

  const bar = element('div', 'wb-actions');
  bar.append(button('값 저장', 'wb-btn primary', () => {
    const values = {};
    for (const input of root.querySelectorAll('.wb-form input')) {
      const next = text(input.value);
      if (next !== text(current[input.name])) values[input.name] = next;
    }
    handlers.save?.(row.jobId, values);
  }, { disabled: ui.busy === true, action: 'save-values' }));
  bar.append(element('span', 'wb-note', '바뀐 칸만 보낸다. 저장되면 조립공장이 이 값으로 이어 간다.'));
  root.append(bar);
  if (text(ui.note)) root.append(element('p', 'wb-note', text(ui.note)));
  root.addEventListener('submit', event => event.preventDefault());
  return root;
}

export const GATE_STEPS = Object.freeze([
  { key: 'preview', label: '미리보기' },
  { key: 'approve', label: '승인' },
  { key: 'confirm', label: '확인' },
  { key: 'publish', label: '등록' },
]);

/**
 * Cafe24 승인. 관문(미리보기→승인→확인→등록)은 조립공장이 지금 열고 있는 제품에만 걸린다.
 * ctx = { live, connected, gate: { step, done: [], error, result } }
 * handlers: publish(jobId), open(jobId)
 */
export function renderCafe24Panel(row, ctx = {}, handlers = {}) {
  const root = element('div', 'wb-cafe24');
  root.dataset.panel = 'cafe24';
  const gate = record(ctx.gate);
  const done = new Set(list(gate.done).map(text));
  const steps = element('ol', 'wb-gate');
  for (const step of GATE_STEPS) {
    const item = element('li', '', step.label);
    item.dataset.step = step.key;
    item.dataset.state = done.has(step.key) ? 'done' : text(gate.step) === step.key ? 'now' : 'todo';
    steps.append(item);
  }
  root.append(steps);
  const bar = element('div', 'wb-actions');
  if (ctx.live && ctx.connected) {
    const registered = text(row.registrationStatus) === 'staged_verified';
    bar.append(button(
      registered ? 'Cafe24 에 등록됨' : gate.step ? '등록하는 중…' : '승인하고 Cafe24 에 등록',
      'wb-btn primary',
      () => handlers.publish?.(row.jobId),
      { disabled: registered || Boolean(gate.step), action: 'cafe24-publish' },
    ));
    bar.append(element('span', 'wb-note', registered
      ? '스토어에 올라간 것을 다시 읽어 확인했습니다.'
      : '네 단계를 한 번에 밟습니다. 등록 직전에 한 번 더 묻습니다.'));
  } else {
    bar.append(button(
      ctx.connected ? '조립공장에서 이 제품 열기' : '조립공장 연결 안 됨',
      'wb-btn primary',
      () => handlers.openInFactory?.(row.jobId),
      { disabled: !ctx.connected, action: 'open-in-factory' },
    ));
    bar.append(element('span', 'wb-note', ctx.connected
      ? '승인은 조립공장이 열고 있는 제품에만 걸립니다. 열면 이 자리에 승인 버튼이 뜹니다.'
      : '조립공장 창이 관제탑에 붙어 있어야 합니다.'));
  }
  root.append(bar);
  if (text(gate.error)) root.append(element('p', 'wb-note error', text(gate.error)));
  if (gate.result) {
    const result = record(gate.result);
    root.append(element('p', 'wb-note ok', [
      '등록 요청을 접수했습니다.',
      text(result.productNo) ? `상품번호 ${text(result.productNo)}` : '',
      text(result.status) ? `상태 ${text(result.status)}` : '',
    ].filter(Boolean).join(' · ')));
  }
  return root;
}

const SOURCE_VALUE_LABELS = Object.freeze([['material', '소재'], ['size', '사이즈'], ['salePrice', '판매가']]);

/**
 * 출처 확정 — 신화사DB·Cafe24 에서 "같은 제품" 을 고르거나 「후보 없음(새 제품)」으로 못박는다.
 * 조립공장이 스스로 못 정했을 때(판정자 한도 등) 사람 차례로 올라오는 단계다. 옛 앞면의 DB 탭 조작과
 * 같은 탭 명령(tabId db · apply-… / confirm-no-… / clear-…)을 보낸다.
 * ctx = { live, connected, db: {query, dbCandidates, cafe24Candidates, dbNone, cafe24None, selectedDbCandidateKey, selectedCafe24CandidateKey}, busy, note }
 * handlers: tabCommand({ jobId, tabId: 'db', action, value, label })
 */
export function renderSourcePanel(row, ctx = {}, handlers = {}) {
  const root = element('div', 'wb-source');
  root.dataset.panel = 'source';
  if (!ctx.live || !ctx.connected) {
    root.append(element('p', 'wb-note', '출처 확정은 조립공장이 열고 있는 제품에만 됩니다. 「조립공장에서 이 제품 열기」부터.'));
    return root;
  }
  const db = record(ctx.db);
  root.append(element('p', 'wb-note', `조립공장이 「${text(db.query) || row.productName}」로 찾은 후보입니다. 같은 제품이 있으면 고르고, 새 제품이면 「후보 없음」으로 못박습니다. 둘 다 정해지면 이어서 돌립니다.`));
  const groups = [
    ['db', '신화사DB', list(db.dbCandidates), db.dbNone === true, text(db.selectedDbCandidateKey)],
    ['cafe24', 'Cafe24', list(db.cafe24Candidates), db.cafe24None === true, text(db.selectedCafe24CandidateKey)],
  ];
  for (const [kind, title, rows, none, selectedKey] of groups) {
    const section = element('section', 'wb-stage');
    section.dataset.source = kind;
    section.dataset.decided = String(none || Boolean(selectedKey));
    const head = element('div', 'wb-stage-head');
    head.append(element('b', '', `${title} · 후보 ${rows.length}개`));
    head.append(element('span', none ? 'wb-tag' : selectedKey ? 'wb-tag' : 'wb-tag warn', none ? '후보 없음으로 확정' : selectedKey ? `확정 · ${selectedKey}` : '아직 안 정함'));
    section.append(head);
    if (rows.length) {
      const grid = element('div', 'wb-cuts wb-cuts-source');
      rows.forEach((item, index) => {
        const card = element('div', 'wb-cut');
        card.dataset.candidateKey = text(item.id);
        if (item.selected === true) card.dataset.chosen = 'true';
        const frame = element('span', 'wb-cut-frame');
        const src = thumbnailSrc(item.thumbnailUrl || item.contentUrl);
        if (src) {
          const image = document.createElement('img');
          image.alt = text(item.title) || text(item.label) || text(item.id);
          image.loading = 'lazy';
          image.decoding = 'async';
          image.src = src;
          image.addEventListener('error', () => { frame.dataset.broken = 'true'; }, { once: true });
          frame.append(image);
          frame.append(button('크게', 'wb-cut-zoom', () => openLightbox(fullImageSrc(item.contentUrl || item.thumbnailUrl), image.alt), { action: 'zoom-source' }));
        } else {
          frame.dataset.empty = 'true';
          frame.append(element('span', 'wb-cut-doc', '그림 없음'));
        }
        card.append(frame);
        card.append(element('span', 'wb-cut-n', String(index + 1)));
        card.append(element('span', 'wb-cut-label', `${text(item.title) || text(item.label) || text(item.id)} · ${text(item.id)}`));
        const values = record(item.values);
        const facts = SOURCE_VALUE_LABELS.filter(([key]) => text(values[key])).map(([key, label]) => `${label} ${text(values[key])}`).join(' · ');
        if (facts) card.append(element('span', 'wb-cut-why', facts));
        card.append(button(
          item.selected === true ? '확정됨' : '이 제품이 맞다',
          item.selected === true ? 'wb-btn sm' : 'wb-btn sm primary',
          () => handlers.tabCommand?.({ jobId: row.jobId, tabId: 'db', action: `apply-${kind}-candidate`, value: { candidateIdentity: item.identity }, label: `${title} 후보 확정` }),
          { disabled: item.selected === true || ctx.busy === true, action: `apply-${kind}-candidate` },
        ));
        grid.append(card);
      });
      section.append(grid);
    }
    const bar = element('div', 'wb-actions');
    bar.append(button(
      none ? '후보 없음으로 확정됨' : `${title} 에 없는 새 제품`,
      none ? 'wb-btn sm' : 'wb-btn sm primary',
      () => handlers.tabCommand?.({ jobId: row.jobId, tabId: 'db', action: `confirm-no-${kind}-candidate`, value: null, label: `${title} 후보 없음` }),
      { disabled: none || ctx.busy === true, action: `confirm-no-${kind}-candidate` },
    ));
    if (none || selectedKey) {
      bar.append(button('확정 해제', 'wb-btn sm ghost',
        () => handlers.tabCommand?.({ jobId: row.jobId, tabId: 'db', action: `clear-${kind}-candidate`, value: null, label: `${title} 확정 해제` }),
        { disabled: ctx.busy === true, action: `clear-${kind}-candidate` }));
    }
    section.append(bar);
    root.append(section);
  }
  if (text(ctx.note)) root.append(element('p', 'wb-note', text(ctx.note)));
  return root;
}

const SECTION_CONTENT_FIELDS = Object.freeze([
  ['headline', '제목'], ['subheadline', '보조 제목'], ['body_text', '본문'],
  ['cta_text', '행동 유도 문구'], ['layout_suggestion', '구성 지시'], ['extra_elements', '추가 요소 · 한 줄씩'],
]);

function labelOf(choices, id) {
  const hit = list(choices).find(item => text(item?.id) === text(id));
  return hit ? text(hit.label || hit.name || hit.id) : text(id);
}

function draftField(ctx, handlers, key, label, initial, { choices = null, multiline = false, placeholder = '' } = {}) {
  const wrapper = element('label', 'wb-field');
  wrapper.dataset.key = key;
  wrapper.append(element('span', 'wb-field-name', label));
  const drafts = record(ctx.drafts);
  const control = document.createElement(choices ? 'select' : multiline ? 'textarea' : 'input');
  control.name = key;
  if (choices) for (const choice of choices) control.append(new Option(text(choice.label || choice.name || choice.id), text(choice.id)));
  if (multiline) control.rows = 3;
  else if (!choices) control.type = 'text';
  if (placeholder && !choices) control.placeholder = placeholder;
  control.value = key in drafts ? text(drafts[key]) : text(initial);
  control.disabled = ctx.busy === true;
  control.addEventListener('input', () => handlers.remember?.(key, control.value));
  control.addEventListener('change', () => handlers.remember?.(key, control.value));
  wrapper.append(control);
  return { wrapper, control };
}

/**
 * 섹션 설정 — 조립공장의 섹션 15개 공정을 그대로 편집한다. 지시문(프롬프트)은 비우면 조립공장 기본,
 * 적으면 그 섹션만 바뀐다. 옛 앞면의 섹션 편집(renderFactorySectionControls)과 같은 탭 명령을 보낸다.
 * ctx = { live, connected, sections, options: {basisModes, generationModes, assemblySources, cutUsages, cutCandidates}, drafts, busy, note }
 * handlers: tabCommand({jobId, tabId:'sections', action, value, label}), remember(key, value)
 */
export function renderSectionsPanel(row, ctx = {}, handlers = {}) {
  const root = element('details', 'wb-sections');
  root.dataset.panel = 'sections';
  if (ctx.open === true) root.open = true;
  const sections = list(ctx.sections);
  const options = record(ctx.options);
  const summary = element('summary', '', `섹션 설정 · ${sections.length}개 공정 · 프롬프트는 조립공장 기본, 바꾸면 그 섹션만`);
  root.append(summary);
  root.addEventListener('toggle', () => handlers.rememberOpen?.('__root', root.open));
  if (!ctx.live || !ctx.connected) {
    root.append(element('p', 'wb-note', '섹션 설정은 조립공장이 열고 있는 제품에만 됩니다.'));
    return root;
  }
  root.append(element('p', 'wb-note', '순서·사용 여부·생성 기준·생성 방식·지시문·기준 자료·이미지컷 배치·문구 직접 수정 — 조립공장 섹션 탭과 같은 항목입니다. 저장 버튼마다 조립공장에 바로 적용됩니다.'));
  const send = (action, value, label) => handlers.tabCommand?.({ jobId: row.jobId, tabId: 'sections', action, value, label });
  sections.forEach((section, index) => {
    const id = text(section.id);
    const card = element('details', 'wb-section');
    card.dataset.sectionId = id;
    if (record(ctx.openSections)[id]) card.open = true;
    const enabled = section.enabled !== false;
    const custom = text(section.instruction).length > 0;
    card.append(element('summary', '', `${String(index + 1).padStart(2, '0')} ${text(section.label) || id} · ${enabled ? '사용' : '사용 안 함'} · 기준 ${labelOf(options.basisModes, section.basisMode)} · 방식 ${labelOf(options.generationModes, section.generationMode)} · 지시문 ${custom ? '직접' : '기본'}`));
    card.addEventListener('toggle', () => handlers.rememberOpen?.(id, card.open));
    const body = element('div', 'wb-section-body');

    const bar = element('div', 'wb-actions');
    bar.append(button(enabled ? '섹션 사용 안 함' : '섹션 사용', 'wb-btn sm', () => send('setSectionEnabled', { sectionId: id, enabled: !enabled }, `${text(section.label) || id} ${enabled ? '끄기' : '켜기'}`), { disabled: ctx.busy === true, action: 'section-enabled' }));
    for (const [offset, label] of [[-1, '위로'], [1, '아래로']]) {
      const target = index + offset;
      bar.append(button(label, 'wb-btn sm ghost', () => {
        const ids = sections.map(item => text(item.id));
        [ids[index], ids[target]] = [ids[target], ids[index]];
        send('updateSectionOrder', ids, `${text(section.label) || id} ${label}`);
      }, { disabled: ctx.busy === true || target < 0 || target >= sections.length, action: `section-move-${offset < 0 ? 'up' : 'down'}` }));
    }
    body.append(bar);

    const modes = element('div', 'wb-form');
    for (const [key, label, choices, action, valueKey] of [
      ['basisMode', '생성 기준', options.basisModes, 'setSectionBasisMode', 'basisId'],
      ['generationMode', '생성 방식', options.generationModes, 'setSectionGenerationMode', 'modeId'],
    ]) {
      if (!list(choices).length) continue;
      const field = draftField(ctx, handlers, `${id}:${key}`, label, section[key], { choices });
      field.wrapper.append(button(`${label} 저장`, 'wb-btn sm', () => send(action, { sectionId: id, [valueKey]: field.control.value }, `${text(section.label) || id} ${label}`), { disabled: ctx.busy === true, action: `save-${key}` }));
      modes.append(field.wrapper);
    }
    body.append(modes);

    const instruction = draftField(ctx, handlers, `${id}:instruction`, '섹션 지시문 (프롬프트)', section.instruction, { multiline: true, placeholder: '비우면 조립공장 기본 지시문으로 만듭니다. 적으면 이 섹션만 이 지시문을 씁니다.' });
    const instructionBar = element('div', 'wb-actions');
    instructionBar.append(button('지시문 저장', 'wb-btn sm primary', () => send('updateSectionInstruction', { sectionId: id, value: instruction.control.value }, `${text(section.label) || id} 지시문`), { disabled: ctx.busy === true, action: 'save-instruction' }));
    if (custom) instructionBar.append(button('기본으로 되돌리기', 'wb-btn sm ghost', () => send('updateSectionInstruction', { sectionId: id, value: '' }, `${text(section.label) || id} 지시문 기본`), { disabled: ctx.busy === true, action: 'reset-instruction' }));
    instruction.wrapper.append(instructionBar);
    body.append(instruction.wrapper);

    const assembly = record(section.assembly);
    if (list(options.assemblySources).length) {
      const sources = element('div', 'wb-actions');
      sources.append(element('span', 'wb-field-name', '기준 자료'));
      for (const source of options.assemblySources) {
        const selected = record(assembly.sources)[text(source.id)] === true;
        const toggle = button(`${selected ? '포함' : '제외'} · ${text(source.label || source.name || source.id)}`, selected ? 'wb-btn sm' : 'wb-btn sm ghost',
          () => send('updateSectionAssemblySource', { sectionId: id, sourceId: text(source.id), selected: !selected }, `${text(section.label) || id} 기준 자료`),
          { disabled: ctx.busy === true, action: 'toggle-assembly-source' });
        toggle.setAttribute('aria-pressed', String(selected));
        sources.append(toggle);
      }
      body.append(sources);
    }
    const placement = element('div', 'wb-form');
    if (list(options.cutUsages).length) {
      const use = draftField(ctx, handlers, `${id}:cutUsage`, '이미지컷 사용 방식', assembly.cutUsage, { choices: options.cutUsages });
      use.wrapper.append(button('사용 방식 저장', 'wb-btn sm', () => send('updateSectionAssemblyCutUsage', { sectionId: id, cutUsage: use.control.value }, `${text(section.label) || id} 이미지컷 사용 방식`), { disabled: ctx.busy === true, action: 'save-cut-usage' }));
      placement.append(use.wrapper);
    }
    if (list(options.cutCandidates).length) {
      const cut = draftField(ctx, handlers, `${id}:cut`, '배치할 이미지컷', assembly.cutAssetKey, { choices: [{ id: '', label: '선택 안 함' }, ...options.cutCandidates] });
      cut.wrapper.append(button('배치 컷 저장', 'wb-btn sm', () => send('updateSectionAssemblyCut', { sectionId: id, cutAssetKey: cut.control.value }, `${text(section.label) || id} 배치 컷`), { disabled: ctx.busy === true, action: 'save-cut' }));
      placement.append(cut.wrapper);
    }
    const note = draftField(ctx, handlers, `${id}:note`, '배치 지시', assembly.note, { multiline: true });
    note.wrapper.append(button('배치 지시 저장', 'wb-btn sm', () => send('updateSectionAssemblyNote', { sectionId: id, note: note.control.value }, `${text(section.label) || id} 배치 지시`), { disabled: ctx.busy === true, action: 'save-note' }));
    placement.append(note.wrapper);
    body.append(placement);

    const content = element('details', 'wb-section-content');
    content.append(element('summary', '', '상세 문구 직접 수정'));
    const edits = new Map();
    const contentGrid = element('div', 'wb-form');
    for (const [key, label] of SECTION_CONTENT_FIELDS) {
      const current = record(section.content)[key];
      const field = draftField(ctx, handlers, `${id}:content:${key}`, label, Array.isArray(current) ? current.join('\n') : current, { multiline: true });
      edits.set(key, field.control);
      contentGrid.append(field.wrapper);
    }
    content.append(contentGrid);
    content.append(button('상세 문구 저장', 'wb-btn sm', () => send('saveManualSection', {
      sectionId: id, content: Object.fromEntries([...edits].map(([key, control]) => [key, control.value])),
    }, `${text(section.label) || id} 상세 문구`), { disabled: ctx.busy === true, action: 'save-content' }));
    body.append(content);

    body.append(button('이 섹션 생성', 'wb-btn sm primary', () => send('generateSection', { sectionId: id }, `${text(section.label) || id} 생성`), { disabled: ctx.busy === true, action: 'generate-section' }));
    card.append(body);
    root.append(card);
  });
  if (text(ctx.note)) root.append(element('p', 'wb-note', text(ctx.note)));
  return root;
}

const COMPETITOR_SITES = Object.freeze([
  ['coupang', '쿠팡'], ['naver', '스마트스토어'], ['gmarket', 'G마켓'], ['auction', '옥션'], ['elevenst', '11번가'],
]);

/** 후보 id 앞머리(coupang_…, naver_ss_…)로 쇼핑몰을 가른다. 조립공장이 후보를 그렇게 이름 짓는다. */
export function competitorSite(candidate) {
  const id = text(candidate?.id);
  const hit = COMPETITOR_SITES.find(([key]) => id.startsWith(`${key}_`));
  return hit ? hit[0] : 'other';
}

/**
 * 경쟁사 고르기 — 쇼핑몰마다 참고할 상품을 하나 이상 고른다. 조립공장은 후보가 있는 쇼핑몰마다 고른 것이 없으면
 * 「경쟁사 선택 대기」로 멈춘다(자동이면 GPT 가 고르는데, 한도에 막히면 사람 차례). 옛 앞면의 경쟁사 탭과 같은
 * 탭 명령(competitor · marketAction toggle-candidate)을 보내고, 다 고르면 이어 돌린다.
 * ctx = { live, connected, competitor: { candidates, searchKeyword, selectedSites, detailImages }, busy, note }
 * handlers: tabCommand({jobId, tabId:'competitor', action, value, label}), resume(jobId)
 */
export function renderCompetitorPanel(row, ctx = {}, handlers = {}) {
  const root = element('div', 'wb-source wb-competitor');
  root.dataset.panel = 'competitor';
  if (!ctx.live || !ctx.connected) {
    root.append(element('p', 'wb-note', '경쟁사 고르기는 조립공장이 열고 있는 제품에만 됩니다. 「조립공장에서 이 제품 열기」부터.'));
    return root;
  }
  const competitor = record(ctx.competitor);
  const candidates = list(competitor.candidates);
  root.append(element('p', 'wb-note', `조립공장이 「${text(competitor.searchKeyword) || row.productName}」로 모은 경쟁사 후보입니다. 쇼핑몰마다 참고할 상품을 하나 이상 고르면 이어 돌릴 수 있습니다. 사진은 각 쇼핑몰에서 바로 옵니다.`));
  const groups = new Map();
  for (const candidate of candidates) {
    const site = competitorSite(candidate);
    if (!groups.has(site)) groups.set(site, []);
    groups.get(site).push(candidate);
  }
  let missing = 0;
  for (const [site, label] of [...COMPETITOR_SITES, ['other', '기타']]) {
    const rows = groups.get(site) || [];
    if (!rows.length) continue;
    const picked = rows.filter(item => item.selected === true).length;
    if (!picked) missing += 1;
    const section = element('section', 'wb-stage');
    section.dataset.site = site;
    section.dataset.decided = String(picked > 0);
    const head = element('div', 'wb-stage-head');
    head.append(element('b', '', `${label} · 후보 ${rows.length}개`));
    head.append(element('span', picked ? 'wb-tag' : 'wb-tag warn', picked ? `참고 ${picked}개` : '아직 안 고름'));
    section.append(head);
    const grid = element('div', 'wb-cuts wb-cuts-source');
    rows.forEach((item, index) => {
      const card = element('div', 'wb-cut');
      card.dataset.candidateId = text(item.id);
      if (item.selected === true) card.dataset.chosen = 'true';
      const frame = element('span', 'wb-cut-frame');
      const src = text(item.thumbnailUrl);
      if (/^https?:\/\//u.test(src)) {
        const image = document.createElement('img');
        image.alt = text(item.label) || text(item.id);
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.src = src;
        image.addEventListener('error', () => { frame.dataset.broken = 'true'; }, { once: true });
        frame.append(image);
        frame.append(button('크게', 'wb-cut-zoom', () => openLightbox(src, image.alt), { action: 'zoom-competitor' }));
      } else {
        frame.dataset.empty = 'true';
        frame.append(element('span', 'wb-cut-doc', '그림 없음'));
      }
      card.append(frame);
      card.append(element('span', 'wb-cut-n', String(index + 1)));
      card.append(element('span', 'wb-cut-label', text(item.label) || text(item.id)));
      card.append(button(
        item.selected === true ? '참고 해제' : '이 상품 참고',
        item.selected === true ? 'wb-btn sm' : 'wb-btn sm primary',
        () => handlers.tabCommand?.({ jobId: row.jobId, tabId: 'competitor', action: 'marketAction', value: { type: 'toggle-candidate', candidateId: text(item.id) }, label: `${label} 후보 ${item.selected === true ? '해제' : '참고'}` }),
        { disabled: ctx.busy === true, action: 'toggle-competitor' },
      ));
      grid.append(card);
    });
    section.append(grid);
    root.append(section);
  }
  const bar = element('div', 'wb-actions');
  bar.append(button('고른 대로 이어 돌리기', 'wb-btn primary', () => handlers.resume?.(row.jobId), { disabled: missing > 0 || ctx.busy === true, action: 'resume-after-competitors' }));
  bar.append(element('span', 'wb-note', missing > 0 ? `아직 안 고른 쇼핑몰 ${missing}곳` : '쇼핑몰마다 참고 상품이 있습니다. 이어 돌리면 조립공장이 대표이미지부터 만듭니다.'));
  root.append(bar);
  if (text(ctx.note)) root.append(element('p', 'wb-note', text(ctx.note)));
  return root;
}
