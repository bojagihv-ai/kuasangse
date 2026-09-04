/**
 * 개요 첫 화면의 "지금 할 일" 인박스.
 *
 * 관제탑은 같은 사실을 세 화면에서 세 방식으로 말해 왔다. 작업 큐는 목록을, 생산·A컷 보드는
 * 격자를, 개요의 제품별 작업대는 파일 연결 상태를 보여 준다. 그래서 화면을 열어도
 * "지금 내가 뭘 해야 하나" 는 사람이 직접 세 화면을 돌며 추려야 했다.
 *
 * 이 모델은 새 사실을 만들지 않는다. 이미 있는 보드 파생(projectProductionBoard)과 작업파일
 * 탭 상태를 받아, 사람이 손대야 하는 것만 급한 순으로 세우고 각 줄이 어느 화면으로 가야 하는지
 * 를 정한다. 기계가 하는 중인 것과 끝난 것은 따로 접어 둔다.
 */

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = value => (Array.isArray(value) ? value : []);
const integer = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);

export const INBOX_SCHEMA = 'control-tower-next-action-inbox:v1';

/** 급한 순. 앞의 것이 막히면 뒤의 것은 해도 소용이 없다. */
export const ACTION_ORDER = Object.freeze(['link', 'blocked', 'values', 'pick', 'cafe24']);

/**
 * 이만큼 기다린 일은 "오래 묵음" 으로 따로 부른다.
 *
 * 실측 2026-09-04: 개요 첫 줄이 17시간 48분째 대기였는데, 7분짜리와 같은 모양으로 앉아 있었다.
 * 급한 순 정렬만으로는 하루를 묵은 일과 방금 생긴 일이 구분되지 않는다. 두 시간이면 조작자가
 * 한 번은 봤어야 할 시간이다 — 그 뒤로도 남아 있으면 잊힌 것이다.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const LINK_COPY = Object.freeze({
  rebind_required: {
    headline: '작업파일 연결 승인',
    detail: '저장해 둔 파일과 진행 중인 작업의 회차가 다릅니다. 어느 파일로 이어갈지 사람이 정해야 합니다.',
  },
  target_rebind_required: {
    headline: '이 작업에 파일 연결 승인',
    detail: '고른 작업과 파일의 제품이 같습니다. 연결할지는 자동으로 정하지 않습니다.',
  },
  unlinked: {
    headline: '작업파일 연결 필요',
    detail: '이 파일과 정확히 맞는 작업이 없습니다. 새 작업으로 시작하거나 맞는 작업을 골라 주세요.',
  },
  ambiguous: {
    headline: '어느 작업인지 고르기',
    detail: '여러 작업이 같은 제품이라고 말합니다. 자동으로 고르지 않습니다.',
  },
  stale: {
    headline: '작업파일 회차 확인',
    detail: '진행 중인 작업보다 파일이 낡았습니다. 최신 저장본을 다시 고르세요.',
  },
});

const VALUE_LABELS = Object.freeze({
  category: '상품 종류',
  material: '소재',
  origin: '원산지',
  size: '사이즈',
  salePrice: '판매가',
  supplyPrice: '공급가',
  stock: '재고',
  usage: '사용용도',
  productName: '제품명',
});

/** 몇 분 기다렸는지 사람 말로. 초 단위는 사람이 행동을 바꾸지 않으니 분부터 말한다. */
export function waitLabel(milliseconds) {
  const ms = integer(milliseconds);
  if (ms < 60_000) return '방금';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}시간 ${rest}분째` : `${hours}시간째`;
  return `${Math.floor(hours / 24)}일째`;
}

/** 목록은 훑어보는 곳이다. 한 줄을 넘기는 사유는 잘라 두고 자세한 것은 그 화면에서 본다. */
function clip(value, limit = 110) {
  const source = text(value);
  return source.length > limit ? `${source.slice(0, limit - 1)}…` : source;
}

function valueLabel(key) {
  return VALUE_LABELS[text(key)] || text(key);
}

function tabForJob(tabs, jobId) {
  const id = text(jobId);
  if (!id) return null;
  return list(tabs).find(tab => text(record(tab).jobId) === id) || null;
}

/**
 * 연결은 "파일을 연 사람" 에게만 할 일이다.
 *
 * 실측 2026-09-02: 옛 화면은 큐에 있는 모든 작업에 "연결이 필요합니다" 를 붙였다. 저장 파일을
 * 한 번도 열지 않았으면 맞는 파일이 없는 게 정상인데, 화면은 그것을 사고처럼 말했다. 그래서
 * 여섯 줄이 전부 빨간 경고였고 조작자는 이 화면을 통째로 무시하게 됐다.
 */
function linkNeedsPerson(tab) {
  const source = record(tab);
  const state = text(source.linkState);
  if (!LINK_COPY[state]) return false;
  // 작업 없이 파일만 연 탭은 연결할 곳을 사람이 정해 줘야 한다.
  if (!text(source.jobId)) return true;
  // 맞는 파일이 없다는 말은, 파일을 실제로 열었을 때만 뜻이 있다.
  if (['unlinked', 'ambiguous'].includes(state)) return source.hasWorkfile === true;
  // 회차가 어긋났다는 판정 자체가 파일이 있어야 나온다.
  return true;
}

function stageLabelOf(row, stageKey) {
  const cell = list(record(row).cells).find(item => text(record(item).stageKey) === text(stageKey));
  return text(record(cell).stageLabel) || text(stageKey) || '공정';
}

/**
 * 보드 행은 단계 키를 따로 들고 있지 않다(칸으로만 말한다). 지금 걸려 있는 칸을 찾아
 * 그 이름을 쓴다. 이게 없으면 화면이 "공정 확인하고 이어가기" 같은 빈 말을 하게 된다.
 */
function waitingStageOf(row) {
  const cells = list(record(row).cells);
  // 보드가 이미 "이 작업이 걸려 있는 단계" 를 정해 두었다. 여기서 따로 고르면 같은 줄의
  // 제목과 설명이 서로 다른 단계를 말한다(실측: 제목은 색상옵션, 설명은 최종).
  const declared = cells.find(item => text(record(item).stageKey) === text(record(row).waitingStageKey));
  const cell = declared
    || cells.find(item => record(item).pickable)
    || cells.find(item => !text(record(item).selectedId))
    || cells[0];
  return {
    stageKey: text(record(cell).stageKey),
    label: text(record(cell).stageLabel) || '남은 공정',
  };
}

function buildItem(row, tab, { activeJobId }) {
  const jobId = text(row.jobId);
  const productName = text(row.productName) || text(row.workfileName) || jobId || '이름 없는 제품';
  const base = {
    jobId,
    tabKey: text(record(tab).key) || (jobId ? `job:${jobId}` : ''),
    productName,
    workfileName: text(row.workfileName),
    live: Boolean(activeJobId) && text(activeJobId) === jobId,
    waitMs: integer(row.waitMs),
    waitLabel: waitLabel(row.waitMs),
    stale: integer(row.waitMs) >= STALE_AFTER_MS,
    reserved: row.hasReservation === true,
  };
  const nextAction = record(row.nextAction);
  const status = text(row.status);

  if (linkNeedsPerson(tab)) {
    const copy = LINK_COPY[text(record(tab).linkState)];
    return {
      ...base,
      kind: 'link',
      tone: 'attention',
      stageKey: '',
      headline: copy.headline,
      detail: copy.detail,
      primary: { label: '연결 화면 열기', route: 'workfile-desk' },
      secondary: [],
    };
  }

  // 실행이 멈춘 것만 "막혔다" 고 부른다.
  //
  // 실측 2026-09-02: 등록 차단 표시(product_id 없음 같은)는 아직 컷을 고르는 중인 작업에도
  // 붙는다. 그것까지 "막힌 작업 되살리기" 라고 부르면 큐 여덟 줄이 전부 빨간 막힘이 되어,
  // 정작 지금 할 일(컷 고르기, 값 채우기)이 묻힌다. 등록 차단은 생산이 끝난 뒤에 푸는 일이다.
  if (status === 'blocked') {
    return {
      ...base,
      kind: 'blocked',
      tone: 'error',
      stageKey: waitingStageOf(row).stageKey,
      headline: '막힌 작업 되살리기',
      detail: clip(text(row.message)) || '조립공장이 이 작업을 끝내지 못했습니다. 저장된 지점부터 다시 이어갈 수 있습니다.',
      primary: { label: '막힌 자리 열기', route: 'board' },
      secondary: [{ label: '작업 큐에서 보기', route: 'queue' }],
    };
  }

  const missingValues = list(row.missingRequiredValues).map(text).filter(Boolean);
  if (missingValues.length && status !== 'running') {
    return {
      ...base,
      kind: 'values',
      tone: 'attention',
      stageKey: '',
      headline: `투입값 채우기 · ${missingValues.map(valueLabel).join(', ')}`,
      detail: '값이 비면 무엇을 만들어도 등록에서 어긋납니다. 보드에서 그 자리에 바로 채울 수 있습니다.',
      primary: { label: '값 채우기', route: 'board-values' },
      secondary: [],
    };
  }

  if (text(nextAction.kind) === 'pick') {
    const stageKey = text(nextAction.stageKey);
    const cell = list(row.cells).find(item => text(record(item).stageKey) === stageKey);
    const candidateCount = integer(record(cell).candidateCount);
    return {
      ...base,
      kind: 'pick',
      tone: 'attention',
      stageKey,
      headline: `${stageLabelOf(row, stageKey)} 컷 고르기${candidateCount ? ` · 후보 ${candidateCount}개` : ''}`,
      detail: base.reserved
        ? '예약해 둔 컷이 있습니다. 확인하고 확정하면 다음 단계로 넘어갑니다.'
        : '자동 생성은 끝났습니다. 고르면 그 자리에서 다음 단계로 넘어갑니다.',
      primary: { label: '고르기', route: 'board', stageKey },
      secondary: [],
    };
  }

  // 사람 선택을 기다리는데 후보가 아직 안 온 작업(다른 제품을 보고 있을 때가 그렇다)도
  // 사람 몫이다. 여기서 빠뜨리면 화면에는 아무 일도 없는 것처럼 보이고, 그 제품은 잊힌다.
  if (status === 'waiting_manual') {
    return {
      ...base,
      kind: 'pick',
      tone: 'attention',
      stageKey: waitingStageOf(row).stageKey,
      headline: `${waitingStageOf(row).label} 확인하고 이어가기`,
      detail: clip(text(nextAction.copy)) || '이 제품은 사람 선택을 기다리는 중입니다. 보드에서 후보를 확인하세요.',
      primary: { label: '보드에서 열기', route: 'board', stageKey: waitingStageOf(row).stageKey },
      secondary: [],
    };
  }

  if (text(nextAction.kind) === 'cafe24' || (status === 'completed' && row.cafe24Registered !== true)) {
    const blockers = list(row.registrationBlockers).map(text).filter(Boolean);
    return {
      ...base,
      kind: 'cafe24',
      tone: 'attention',
      stageKey: 'cafe24',
      headline: row.registrationBlocked === true ? 'Cafe24 등록 막힘 풀기' : 'Cafe24 등록 점검',
      detail: blockers.length
        ? clip(`등록을 막고 있는 것 · ${blockers.slice(0, 2).join(', ')}`)
        : '생산은 끝났습니다. 등록값과 비공개 등록 결과를 확인한 뒤 승인하세요.',
      primary: { label: 'Cafe24 열기', route: 'cafe24' },
      secondary: [{ label: '만든 결과 보기', route: 'board' }],
    };
  }

  return null;
}

function watchingItem(row) {
  const status = text(row.status);
  if (!['running', 'queued'].includes(status)) return null;
  const nextAction = record(row.nextAction);
  return Object.freeze({
    jobId: text(row.jobId),
    productName: text(row.productName) || text(row.jobId),
    status,
    headline: text(nextAction.copy) || (status === 'running' ? '만드는 중' : '차례 대기'),
    waitLabel: waitLabel(row.waitMs),
  });
}

/**
 * 파일만 열고 아직 작업이 없는 탭(작업 큐에 행이 없는 것)도 사람이 손대야 할 일이다.
 * 보드 행에는 없으니 탭에서 직접 만든다.
 */
function orphanWorkfileItems(tabs, seenJobIds) {
  return list(tabs)
    .filter(tab => {
      const source = record(tab);
      if (text(source.jobId) && seenJobIds.has(text(source.jobId))) return false;
      return linkNeedsPerson(source);
    })
    .map(tab => {
      const source = record(tab);
      const copy = LINK_COPY[text(source.linkState)];
      return {
        jobId: text(source.jobId),
        tabKey: text(source.key),
        productName: text(source.productName) || text(source.workfileName) || '연 작업파일',
        workfileName: text(source.workfileName),
        live: false,
        waitMs: 0,
        waitLabel: '방금',
        reserved: false,
        kind: 'link',
        tone: 'attention',
        stageKey: '',
        headline: copy.headline,
        detail: copy.detail,
        primary: { label: '연결 화면 열기', route: 'workfile-desk' },
        secondary: [],
      };
    });
}

/**
 * @param {object} input
 * @param {object} input.board projectProductionBoard 결과
 * @param {Array} input.tabs workfile 작업파일 탭 스냅샷의 tabs
 * @param {string} input.activeJobId 지금 조립공장이 붙잡고 있는 작업
 */
export function buildNextActionInbox({ board: boardValue, tabs: tabsValue = [], activeJobId = '' } = {}) {
  const board = record(boardValue);
  const rows = list(board.rows);
  const tabs = list(tabsValue);
  const seenJobIds = new Set(rows.map(row => text(record(row).jobId)).filter(Boolean));

  const items = [];
  const watching = [];
  const done = [];
  for (const rowValue of rows) {
    const row = record(rowValue);
    if (!text(row.jobId)) continue;
    if (row.cafe24Registered === true) {
      done.push(Object.freeze({
        jobId: text(row.jobId),
        productName: text(row.productName) || text(row.jobId),
        headline: 'Cafe24 등록까지 끝',
      }));
      continue;
    }
    const item = buildItem(row, tabForJob(tabs, row.jobId), { activeJobId });
    if (item) {
      items.push(item);
      continue;
    }
    const watch = watchingItem(row);
    if (watch) watching.push(watch);
  }
  items.push(...orphanWorkfileItems(tabs, seenJobIds));

  items.sort((left, right) => {
    const order = ACTION_ORDER.indexOf(left.kind) - ACTION_ORDER.indexOf(right.kind);
    if (order !== 0) return order;
    // 같은 종류면 오래 기다린 것부터. 사람이 잊고 있던 것이 위로 온다.
    if (right.waitMs !== left.waitMs) return right.waitMs - left.waitMs;
    return left.productName.localeCompare(right.productName, 'ko');
  });

  const summary = Object.freeze({
    mine: items.length,
    stale: items.filter(item => item.stale).length,
    watching: watching.length,
    done: done.length,
    total: rows.length,
    byKind: Object.freeze(ACTION_ORDER.reduce((totals, kind) => ({
      ...totals,
      [kind]: items.filter(item => item.kind === kind).length,
    }), {})),
    waitMs: rows.reduce((total, row) => total + integer(record(row).waitMs), 0),
    machineMs: rows.reduce((total, row) => total + integer(record(row).machineMs), 0),
  });

  return Object.freeze({
    schema: INBOX_SCHEMA,
    summary,
    items: Object.freeze(items.map(item => Object.freeze({
      ...item,
      primary: Object.freeze(item.primary),
      secondary: Object.freeze(item.secondary.map(entry => Object.freeze(entry))),
    }))),
    watching: Object.freeze(watching),
    done: Object.freeze(done),
  });
}

/** 인박스 머리글 한 줄. 숫자만 던지지 않고 지금 상태를 문장으로 말한다. */
export function inboxHeadline(inboxValue) {
  const summary = record(record(inboxValue).summary);
  const mine = integer(summary.mine);
  const watching = integer(summary.watching);
  if (!mine && !watching && !integer(summary.total)) return '아직 투입된 제품이 없습니다.';
  if (!mine) {
    return watching
      ? `지금 사람이 할 일은 없습니다 · 자동 진행 ${watching}건 관찰 중`
      : '지금 사람이 할 일은 없습니다.';
  }
  const parts = [`손댈 일 ${mine}건`];
  if (integer(summary.stale)) parts.push(`오래 묵음 ${integer(summary.stale)}건`);
  if (watching) parts.push(`자동 진행 ${watching}건`);
  if (integer(summary.done)) parts.push(`등록 완료 ${integer(summary.done)}건`);
  return parts.join(' · ');
}
