/**
 * 작업대의 "줄" — 제품 한 줄 = 상태 한 단어 · 이름 · 7단계 띠 · 버튼 하나.
 *
 * 새 사실을 만들지 않는다. 행의 상태·다음 할 일·막힌 사유는 검증된 순수 모델을 그대로 쓴다:
 *   projectProductionBoard(병렬 보드 파생) → buildNextActionInbox(급한 순) → 이 파일은 그리기만.
 * 그래서 옛 앞면과 이 앞면이 같은 작업을 두고 다른 말을 할 수 없다 — 2026-09-16 에 "전체" 가
 * 11건을 숨기는 동안 개요는 그 11건을 1순위라 부르던 모순은 모델이 둘이었기 때문이다.
 */
import { projectProductionBoard, describeBlocked } from '../production-board-model.mjs?parallelBoard=46';
import { buildNextActionInbox, inboxHeadline } from '../next-action-model.mjs?nextAction=3';
import { renderPickPanel, renderValuesPanel, renderCafe24Panel, renderSourcePanel, renderCompetitorPanel, renderSectionsPanel, providerName } from './panels.mjs?wb=1';

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = value => (Array.isArray(value) ? value : []);

export const FILTERS = Object.freeze([
  { key: 'mine', label: '내 차례' },
  { key: 'all', label: '전부' },
  { key: 'run', label: '돌아가는 중' },
  { key: 'blocked', label: '막힘' },
  { key: 'done', label: '완료' },
]);

/** 조작자가 보는 상태 네 가지. 색이 아니라 말로도 구분된다. */
export function rowState(row, inboxItem) {
  const status = text(row.status);
  // 인박스가 "사람이 손댈 일" 이라 하면 그게 내 차례다 — 생산이 끝나도 Cafe24 승인이 남았으면 아직 내 차례.
  if (status === 'blocked') return 'blocked';
  if (inboxItem) return 'mine';
  if (status === 'completed') return 'done';
  return 'run';
}

export const STATE_LABEL = Object.freeze({ mine: '내 차례', run: '돌아가는 중', blocked: '막힘', done: '완료' });

/** 7단계 띠: 보드의 여섯 공정 + Cafe24. 각 칸은 done / now / todo. */
export function stageStrip(row) {
  const cells = list(row.cells).map(cell => ({
    key: text(cell.stageKey),
    label: text(cell.stageLabel).replace('이미지', '').replace('옵션', '') || text(cell.stageKey),
    state: cell.selectedId ? 'done' : cell.pickable ? 'now' : 'todo',
  }));
  const registration = text(row.registrationStatus);
  const cafe24 = {
    key: 'cafe24',
    label: 'Cafe24',
    state: registration === 'staged_verified' || registration === 'registered_history'
      ? 'done'
      : row.approvalRequired || registration === 'approval_required' ? 'now' : 'todo',
  };
  const strip = [...cells, cafe24];
  // 돌아가는 중이면 첫 미완 칸이 지금 칸이다.
  if (text(row.status) === 'running' && !strip.some(s => s.state === 'now')) {
    const first = strip.find(s => s.state === 'todo');
    if (first) first.state = 'now';
  }
  return strip;
}

/** 줄 전체를 모델로 만든다. 그리기는 renderQueue 가 한다. */
export function buildQueueModel({ jobs, projection, activeJobId = '', results = {} } = {}) {
  const board = projectProductionBoard(list(jobs), { results });
  const inbox = buildNextActionInbox({ board, tabs: [], activeJobId });
  const inboxByJob = new Map(inbox.items.map(item => [text(item.jobId), item]));
  const orderByJob = new Map(inbox.items.map((item, index) => [text(item.jobId), index]));
  const rows = board.rows.map(row => {
    const item = inboxByJob.get(text(row.jobId)) || null;
    const state = rowState(row, item);
    const blocked = describeBlocked(row);
    return Object.freeze({
      jobId: text(row.jobId),
      productName: text(row.productName) || text(row.jobId),
      state,
      stateLabel: STATE_LABEL[state],
      headline: item ? text(item.headline) : text(record(row.nextAction).copy),
      detail: item
        ? text(item.detail)
        : state === 'blocked' && blocked ? text(blocked.cause) : text(row.message),
      waitLabel: item ? text(item.waitLabel) : '',
      stale: item?.stale === true,
      live: text(activeJobId) && text(activeJobId) === text(row.jobId),
      kind: item ? text(item.kind) : state,
      primary: item ? record(item.primary) : null,
      stageKey: item ? text(item.stageKey) : text(record(row.nextAction).stageKey),
      strip: stageStrip(row),
      percent: Number(row.percent) || 0,
      registrationStatus: text(row.registrationStatus),
      canDelete: text(row.jobId) !== text(activeJobId)
        && text(row.status) !== 'running'
        && text(row.registrationStatus) !== 'staged_verified',
      canResume: state === 'blocked',
      hasCuts: list(row.cells).some(cell => list(cell.candidates).length),
      raw: row,
      order: orderByJob.has(text(row.jobId))
        ? orderByJob.get(text(row.jobId))
        : state === 'run' ? 1000 + row.order : state === 'blocked' ? 2000 + row.order : 3000 + row.order,
    });
  }).sort((a, b) => a.order - b.order);
  return Object.freeze({
    rows,
    headline: inboxHeadline(inbox),
    counts: {
      // 머리글 숫자는 인박스의 것 — 막힘도 사람이 손댈 일이라 "내 차례" 에 든다.
      mine: inbox.summary.mine,
      run: rows.filter(r => r.state === 'run').length,
      blocked: rows.filter(r => r.state === 'blocked').length,
      done: rows.filter(r => r.state === 'done').length,
    },
  });
}

/** 제품별 자동 고르기 설정. 'off' 는 전체 기본값이 켜져 있어도 이 제품은 내가 고른다는 뜻. */
export function autoPickFor(jobId, autoPick = {}, autoPickDefault = '') {
  const explicit = text(record(autoPick)[jobId]);
  if (explicit === 'off') return { provider: '', inherited: false };
  if (explicit) return { provider: explicit, inherited: false };
  return { provider: text(autoPickDefault), inherited: Boolean(text(autoPickDefault)) };
}

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

/**
 * 줄을 그린다. 한 번에 한 행만 펼쳐진다. 행의 버튼은 handlers 로만 밖에 말한다.
 * handlers: { resume(jobId), remove(jobId, productName), open(row), choose, select, judge, save, search,
 *             importSource, copyFrom, openInFactory, publish, setAutoPick, tabCommand }
 * source: { jobId, db } — 조립공장이 지금 열고 있는 제품이 출처 확정을 기다리면 그 자료.
 */
/** 왜 이 행은 못 지우는가 — 체크박스 title 로 보인다. 백엔드(delete_product_job)가 거절하는 세 경우 그대로. */
export function deleteBlockReason(row) {
  if (row.canDelete) return '';
  if (row.live) return '조립공장이 지금 열고 있는 제품이라 지울 수 없습니다. 다른 제품으로 넘어간 뒤.';
  if (text(record(row.raw).status) === 'running') return '돌아가는 중이라 지울 수 없습니다. 멈추거나 끝난 뒤.';
  if (text(row.registrationStatus) === 'staged_verified') return 'Cafe24 에 등록된 작업이라 지울 수 없습니다.';
  return '지금은 지울 수 없습니다.';
}

export function renderQueue(root, model, {
  filter = 'all', openJobId = '', handlers = {}, panel = {}, projection = {},
  autoPick = {}, autoPickDefault = '', source = {}, selected = new Set(), sections = {},
} = {}) {
  root.replaceChildren();
  root.dataset.filter = filter;
  const visible = model.rows.filter(row => filter === 'all' || row.state === filter);
  if (!visible.length) {
    root.append(element('p', 'wb-empty', model.rows.length ? '이 보기에 해당하는 제품이 없습니다.' : '아직 줄에 선 제품이 없습니다. 위의 「제품 넣기」로 시작하세요.'));
    return;
  }
  for (const row of visible) {
    const auto = autoPickFor(row.jobId, autoPick, autoPickDefault);
    const article = element('article', 'wb-row');
    article.dataset.jobId = row.jobId;
    article.dataset.state = row.state;
    article.dataset.kind = row.kind;
    article.dataset.stale = String(row.stale);
    article.dataset.live = String(row.live);
    article.dataset.open = String(openJobId === row.jobId);
    article.dataset.autoPick = auto.provider || 'off';

    const head = element('div', 'wb-row-head');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.setAttribute('aria-expanded', String(openJobId === row.jobId));

    // 앞의 체크박스 — 여러 작업을 골라 한 번에 지운다. 못 지우는 행은 잠그고 이유를 title 로 말한다.
    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'wb-row-pick';
    pick.name = 'select-job';
    pick.value = row.jobId;
    pick.checked = selected.has(row.jobId);
    pick.disabled = !row.canDelete;
    pick.title = row.canDelete ? '지울 작업으로 고르기' : deleteBlockReason(row);
    pick.setAttribute('aria-label', `${row.productName} 고르기`);
    pick.addEventListener('click', event => event.stopPropagation());
    pick.addEventListener('keydown', event => event.stopPropagation());
    pick.addEventListener('change', () => handlers.toggleSelect?.(row.jobId, pick.checked));
    head.append(pick);

    head.append(element('span', 'wb-state', row.stateLabel));

    const name = element('div', 'wb-name');
    name.append(element('b', '', row.productName));
    const sub = [row.headline, row.waitLabel && row.waitLabel !== '방금' ? `${row.waitLabel} 대기` : '']
      .filter(Boolean).join(' · ');
    if (row.stale) name.append(element('span', 'wb-stale', `오래 묵음 · ${row.waitLabel} 대기`));
    if (sub) name.append(element('span', row.state === 'mine' ? 'wb-sub wb-wait' : 'wb-sub', row.stale ? row.headline : sub));
    if (auto.provider) name.append(element('span', 'wb-auto-tag', `자동 고르기 · ${providerName(auto.provider)}${auto.inherited ? ' (전체 기본)' : ''}`));
    head.append(name);

    const strip = element('div', 'wb-strip');
    for (const seg of row.strip) {
      const i = element('i');
      i.dataset.s = seg.state;
      i.title = seg.key;
      i.append(element('span', '', seg.label));
      strip.append(i);
    }
    head.append(strip);

    const action = element('button', row.state === 'mine' ? 'wb-btn primary sm' : 'wb-btn sm', primaryLabel(row, source));
    action.type = 'button';
    action.dataset.action = 'primary';
    action.addEventListener('click', event => {
      event.stopPropagation();
      if (row.state === 'blocked') handlers.resume?.(row.jobId);
      else handlers.open?.(row);
    });
    head.append(action);

    head.addEventListener('click', () => handlers.open?.(row));
    head.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handlers.open?.(row); }
    });
    article.append(head);

    if (openJobId === row.jobId) article.append(renderPanel(row, handlers, panel, projection, { auto, source, sections }));
    root.append(article);
  }
}

/** 행 오른쪽 버튼의 말. 무엇을 하러 들어가는지 말한다 — 옛 보드 이름이 아니라. */
export function primaryLabel(row, source = {}) {
  // 막힌 작업은 먼저 되살려야 한다 — 컷이 있어도 버튼은 다시 시작. 컷은 행을 펼치면 보인다.
  if (row.state === 'blocked') return '다시 시작';
  if (row.state === 'done') return '기록 보기';
  if (text(record(source).jobId) === row.jobId) return text(record(source).stage) === 'competitors' ? '경쟁사 고르기' : '출처 확정';
  if (row.kind === 'pick' || row.hasCuts) return '생성컷 보기';
  if (row.kind === 'values') return '값 채우기';
  if (row.kind === 'cafe24') return 'Cafe24 승인';
  if (row.kind === 'link') return '이어 열기';
  if (row.state === 'run') return '보기';
  return text(record(row.primary).label) || '열기';
}

/** 이 행이 조립공장이 지금 열고 있는 제품이고 Cafe24 승인만 남았는가. */
export function cafe24Pending(row, projection) {
  const registration = record(record(projection).registration);
  const live = text(registration.jobId) && text(registration.jobId) === row.jobId;
  // 살아 있는 제품의 등록 상태는 조립공장 투영이 정본이다. 작업 목록의 진행 스냅샷은 한 박자 늦을 수 있다.
  const status = text(registration.status) || text(row.registrationStatus);
  return Boolean(live) && (status === 'approval_required' || row.raw?.approvalRequired === true);
}

/**
 * 펼친 행. 무엇을 보일지는 인박스의 kind 가 정한다:
 *   pick → 컷 고르기 · values → 값 채우기 · cafe24 → 승인 관문 · blocked → 다시 시작.
 * 출처 확정을 기다리는 살아 있는 제품이면 그 패널이 먼저다.
 * 살아 있는 제품에 승인만 남았으면 어느 kind 든 관문을 아래에 덧붙인다 — 화면을 옮길 이유가 없다.
 */
function renderPanel(row, handlers, ui = {}, projection = {}, { auto = {}, source = {}, sections = {} } = {}) {
  const panel = element('div', 'wb-panel');
  const why = element('div', 'wb-why', row.detail || row.headline || '');
  panel.append(why);
  const actions = element('div', 'wb-actions');
  if (row.state === 'blocked') {
    const resume = element('button', 'wb-btn primary', '저장된 지점부터 다시 시작');
    resume.type = 'button';
    resume.dataset.action = 'resume-factory-job';
    resume.addEventListener('click', () => handlers.resume?.(row.jobId));
    actions.append(resume);
  }
  if (row.state === 'run') {
    actions.append(element('span', 'wb-note', `진행 ${row.percent}% · 조립공장이 이 제품을 열고 있습니다. 사람 손이 필요해지면 위로 올라옵니다.`));
  }
  const connected = projection?.connected === true;
  const live = text(record(record(projection).registration).jobId) === row.jobId;
  const sourceWait = text(record(source).jobId) === row.jobId;
  if (sourceWait) {
    const shared = { live, connected, busy: record(ui.source).busy === true, note: text(record(ui.source).note) };
    if (text(record(source).stage) === 'competitors') {
      panel.append(renderCompetitorPanel(row, { ...shared, competitor: record(source).competitor }, handlers));
    } else {
      panel.append(renderSourcePanel(row, { ...shared, db: record(source).db }, handlers));
    }
  }
  const pickUi = { ...record(ui.pick), autoPick: auto.provider || '', autoPickInherited: auto.inherited === true };
  if (row.kind === 'pick' || row.hasCuts || (row.state === 'blocked' && list(record(row.raw).cells).some(cell => cell.pickable))) {
    panel.append(renderPickPanel(row, pickUi, handlers));
  }
  if (row.kind === 'values' || list(record(row.raw).missingRequiredValues).length) {
    panel.append(renderValuesPanel(row, { ...record(ui.values), siblings: list(ui.siblings) }, handlers));
  }
  // 섹션 설정은 조립공장이 열고 있는 제품에만 — 접힌 채로 두고, 프롬프트를 바꾸고 싶을 때만 편다.
  if (text(record(sections).jobId) === row.jobId && list(record(sections).sections).length) {
    const sectionUi = record(ui.sections);
    panel.append(renderSectionsPanel(row, {
      live, connected,
      sections: record(sections).sections, options: record(sections).options,
      drafts: record(sectionUi.drafts), openSections: record(sectionUi.open), open: sectionUi.expanded === true,
      busy: record(ui.source).busy === true, note: text(record(ui.source).note),
    }, handlers));
  }
  // 고를 컷이 하나도 안 남은 "컷 고르기" 는 사실상 등록 차례다 — 다음 걸음(관문 또는 열기)을 같이 보인다.
  const nothingToPick = row.kind === 'pick' && !list(record(row.raw).cells).some(cell => cell.pickable);
  if (row.kind === 'cafe24' || nothingToPick || cafe24Pending(row, projection)) {
    panel.append(renderCafe24Panel(row, { live, connected, gate: record(ui.gate) }, handlers));
  }
  if (row.state === 'done' && row.kind !== 'cafe24') {
    actions.append(element('span', 'wb-note', `등록 상태 ${row.registrationStatus || '기록 없음'} · 자세한 기록은 옛 화면의 작업파일 탭에 있습니다.`));
  }
  actions.append(element('span', 'wb-spacer'));
  if (row.canDelete) {
    const remove = element('button', 'wb-btn danger sm', row.state === 'done' ? '줄에서 치우기' : '작업 지우기');
    remove.type = 'button';
    remove.dataset.action = 'delete-factory-job';
    remove.addEventListener('click', () => handlers.remove?.(row.jobId, row.productName));
    actions.append(remove);
  }
  panel.append(actions);
  return panel;
}
