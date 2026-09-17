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
export function renderPickPanel(row, ui = {}, handlers = {}) {
  const root = element('div', 'wb-pick');
  root.dataset.panel = 'pick';
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
      const cut = element('button', 'wb-cut');
      cut.type = 'button';
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
      } else {
        frame.dataset.empty = 'true';
        frame.append(element('span', 'wb-cut-doc', candidate.kind === 'document' ? '문서' : '그림 없음'));
      }
      cut.append(frame);
      cut.append(element('span', 'wb-cut-n', String(index + 1)));
      cut.append(element('span', 'wb-cut-label', label));
      if (why) cut.append(element('span', 'wb-cut-why', why));
      cut.addEventListener('click', event => {
        event.stopPropagation();
        handlers.choose?.({ stageKey, candidateId: id });
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

/** 이미 고른 컷 한눈에 — 단계마다 몇 개 중 몇 번째를 골랐고 그 그림은 무엇인지. 고칠 일이 없으면 여기서 끝. */
export function renderChosenReview(row) {
  const box = element('section', 'wb-stage wb-chosen');
  box.dataset.stageKey = 'chosen';
  const cells = list(record(row.raw).cells);
  const picked = cells.filter(cell => text(cell.selectedId));
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
