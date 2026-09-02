const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const MODEL_URL = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'production-board-model.mjs'),
).href;
const BOARD_URL = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'production-board.mjs'),
).href;

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.listeners = new Map();
    this.textContent = '';
  }
  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest(selector) { return selector === '[data-action]' && this.dataset.action ? this : null; }
  remove() {}
  focus() {}
}

function installBoardDocument(t) {
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
  const windowListeners = new Map();
  globalThis.Element = FakeElement;
  globalThis.document = {
    createElement: tagName => new FakeElement(tagName),
    createTextNode: value => ({ textContent: String(value) }),
    addEventListener() {}, removeEventListener() {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [], activeElement: null,
    body: new FakeElement('body'),
  };
  globalThis.window = {
    location: { href: 'http://127.0.0.1/control-tower.html' },
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: type => windowListeners.delete(type),
  };
  t.after(() => Object.assign(globalThis, previous));
  return { root: new FakeElement('div'), windowListeners };
}

function dispatchBoardClick(root, dataset) {
  const target = new FakeElement('button');
  Object.assign(target.dataset, dataset);
  root.listeners.get('click')({ target });
}

function viewedCell(root) {
  const visit = node => {
    if (node?.className === 'board-candidate-strip') return { jobId: node.dataset.jobId, stageKey: node.dataset.stageKey };
    for (const child of node?.children || []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

function nodesByClass(root, className) {
  const matches = [];
  const visit = node => {
    if (String(node?.className || '').split(/\s+/u).includes(className)) matches.push(node);
    for (const child of node?.children || []) visit(child);
  };
  visit(root);
  return matches;
}

const jobRows = root => nodesByClass(root, 'board-row').filter(node => node.dataset.jobId);

function stage(key, { selectedId = '', candidates = [] } = {}) {
  return {
    key,
    status: selectedId ? 'selected' : candidates.length ? 'waiting_manual' : 'empty',
    selectedId,
    candidateCount: candidates.length,
    candidates: candidates.map(id => ({ id, thumbnailUrl: `http://127.0.0.1:5062/thumb/${id}` })),
  };
}

function job(overrides = {}) {
  return {
    schema: 'factory-product-job:v1',
    jobId: 'factory-job-a',
    productName: '공단보자기 45cm',
    workfileName: '공단보자기 45cm.kuasangse',
    status: 'waiting_manual',
    stageKey: 'representative',
    message: '대표이미지 결과를 선택해 주세요.',
    mode: 'manual',
    attempts: 1,
    imageCount: 4,
    dispatched: false,
    progress: {
      schema: 'factory-product-progress:v1',
      stageKey: 'representative',
      percent: 30,
      selectedStageCount: 0,
      totalStageCount: 6,
      awaitingStageKeys: ['representative'],
      stages: [stage('representative', { candidates: ['rep-a', 'rep-b'] })],
      registration: { status: 'blocked', blockers: [] },
    },
    ...overrides,
  };
}

test('여러 작업을 행으로, 여섯 공정을 열로 펼친다', async () => {
  const { projectProductionBoard, BOARD_STAGES } = await import(MODEL_URL);

  const board = projectProductionBoard([
    job({ jobId: 'job-1' }),
    job({ jobId: 'job-2', status: 'queued', progress: undefined }),
    job({ jobId: 'job-3', status: 'completed' }),
  ]);

  assert.equal(board.rows.length, 3);
  assert.deepEqual(board.rows.map(row => row.jobId), ['job-1', 'job-2', 'job-3']);
  assert.equal(BOARD_STAGES.length, 6);
  for (const row of board.rows) {
    assert.equal(row.cells.length, 6);
    assert.deepEqual(row.cells.map(cell => cell.stageKey), BOARD_STAGES.map(item => item.key));
  }
  assert.deepEqual(board.rows.map(row => row.order), [1, 2, 3]);
});

test('멈춘 칸은 고를 수 있고 아직 도달하지 않은 칸은 비어 있다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);

  const [row] = projectProductionBoard([job()]).rows;

  const representative = row.cells.find(cell => cell.stageKey === 'representative');
  const sections = row.cells.find(cell => cell.stageKey === 'sections');
  assert.equal(representative.state, 'awaiting');
  assert.equal(representative.candidateCount, 2);
  assert.equal(representative.pickable, true);
  assert.equal(sections.state, 'empty');
  assert.equal(sections.pickable, false);
  assert.equal(row.waitingStageKey, 'representative');
  assert.equal(row.statusLabel, '컷 선택 대기');
});

test('이미 고른 칸과 예약한 칸을 구분해 보여준다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);

  const [row] = projectProductionBoard([
    job({
      progress: {
        ...job().progress,
        selectedStageCount: 1,
        awaitingStageKeys: ['size'],
        stages: [
          stage('representative', { selectedId: 'rep-a', candidates: ['rep-a', 'rep-b'] }),
          stage('size', { candidates: ['size-a', 'size-b'] }),
        ],
      },
      pendingSelection: {
        schema: 'factory-product-selection-reservation:v1',
        stageKey: 'size',
        candidateId: 'size-b',
      },
    }),
  ]).rows;

  assert.equal(row.cells.find(cell => cell.stageKey === 'representative').state, 'selected');
  const size = row.cells.find(cell => cell.stageKey === 'size');
  assert.equal(size.state, 'reserved');
  assert.equal(size.reservedCandidateId, 'size-b');
  assert.equal(row.hasReservation, true);
  assert.equal(row.stepLabel, '1 / 6단계');
});

test('보드 요약은 상태별 작업 수와 남은 선택 칸을 센다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);

  const board = projectProductionBoard([
    job({ jobId: 'w-1' }),
    job({ jobId: 'w-2' }),
    job({ jobId: 'r-1', status: 'running' }),
    job({ jobId: 'q-1', status: 'queued', progress: undefined }),
    job({ jobId: 'c-1', status: 'completed', progress: undefined }),
    job({
      jobId: 'res-1',
      pendingSelection: { stageKey: 'representative', candidateId: 'rep-a' },
    }),
  ]);

  assert.deepEqual(board.summary, {
    total: 6,
    queued: 1,
    running: 1,
    waiting: 3,
    blocked: 0,
    completed: 1,
    reserved: 1,
    resumable: 3,
    autoResuming: 0,
    totalMachineMs: 0,
    totalWaitMs: 0,
    pickableCells: 2,
  });
});

test('명시한 후보의 수동 일괄 선택 요청은 예약되지 않은 대기 칸만 담는다', async () => {
  const { projectProductionBoard, buildBatchSelectionRequest } = await import(MODEL_URL);
  const board = projectProductionBoard([
    job({ jobId: 'w-1' }),
    job({ jobId: 'w-2' }),
    job({ jobId: 'res-1', pendingSelection: { stageKey: 'representative', candidateId: 'rep-b' } }),
    job({ jobId: 'q-1', status: 'queued', progress: undefined }),
  ]);

  const manual = buildBatchSelectionRequest(board, { candidateId: 'rep-b' });
  const auto = buildBatchSelectionRequest(board, { mode: 'auto' });

  assert.deepEqual(manual, {
    mode: 'manual',
    selections: [
      { jobId: 'w-1', stageKey: 'representative', candidateId: 'rep-b' },
      { jobId: 'w-2', stageKey: 'representative', candidateId: 'rep-b' },
    ],
  });
  assert.deepEqual(auto, { mode: 'auto', jobIds: ['w-1', 'w-2'] });
});

test('후보 ID가 없거나 현재 칸에 없으면 수동 일괄 선택 요청은 비어 있다', async () => {
  const { projectProductionBoard, buildBatchSelectionRequest } = await import(MODEL_URL);
  const board = projectProductionBoard([job({ jobId: 'w-1' }), job({ jobId: 'w-2' })]);

  assert.deepEqual(buildBatchSelectionRequest(board), { mode: 'manual', selections: [] });
  assert.deepEqual(buildBatchSelectionRequest(board, { candidateId: '   ' }), { mode: 'manual', selections: [] });
  assert.deepEqual(buildBatchSelectionRequest(board, { candidateId: 'missing' }), { mode: 'manual', selections: [] });
});

test('같은 후보의 예전 projection은 이동하지 않고 더 새 저장 차수만 다음 제품을 연다', async () => {
  const { advanceManualSelectionCursor, projectProductionBoard } = await import(MODEL_URL);
  const current = { jobId: 'w-1', stageKey: 'representative' };
  const selection = { jobId: 'w-1', stageKey: 'representative', candidateId: 'rep-b' };
  const board = projectProductionBoard([
    job({
      jobId: 'w-1',
      status: 'running',
      stageKey: 'size',
      progress: {
        ...job().progress,
        stageKey: 'size',
        awaitingStageKeys: ['size'],
        stages: [
          stage('representative', { selectedId: 'rep-b', candidates: ['rep-a', 'rep-b'] }),
          stage('size', { candidates: ['size-a'] }),
        ],
      },
    }),
    job({ jobId: 'w-2' }),
  ]);
  const receipt = {
    schema: 'factory-batch-selection:v1',
    mode: 'manual',
    results: [{ ...selection, status: 'applied' }],
  };

  assert.deepEqual(advanceManualSelectionCursor({
    board, current, selection, receipt, baselineRevision: 10, currentRevision: 10,
  }), current);
  assert.deepEqual(advanceManualSelectionCursor({
    board, current, selection, receipt, baselineRevision: 10, currentRevision: 11,
  }), { jobId: 'w-2', stageKey: 'representative' });
});

test('stale·누락·거절 receipt와 중간 보기 변경은 현재 제품을 유지한다', async () => {
  const { advanceManualSelectionCursor, projectProductionBoard } = await import(MODEL_URL);
  const current = { jobId: 'w-1', stageKey: 'representative' };
  const selection = { jobId: 'w-1', stageKey: 'representative', candidateId: 'rep-b' };
  const board = projectProductionBoard([
    job({
      jobId: 'w-1',
      progress: {
        ...job().progress,
        stages: [stage('representative', { selectedId: 'rep-b', candidates: ['rep-a', 'rep-b'] })],
      },
    }),
    job({ jobId: 'w-2' }),
  ]);
  const stale = {
    schema: 'factory-batch-selection:v1',
    mode: 'manual',
    results: [{ ...selection, status: 'reserved' }],
  };
  const rejected = {
    schema: 'factory-batch-selection:v1',
    mode: 'manual',
    results: [{ ...selection, status: 'error' }],
  };
  const mismatched = {
    schema: 'factory-batch-selection:v1',
    mode: 'manual',
    results: [{ ...selection, candidateId: 'rep-a', status: 'applied' }],
  };

  assert.deepEqual(advanceManualSelectionCursor({
    board, current, selection, receipt: stale, baselineRevision: 10, currentRevision: 9,
  }), current);
  assert.deepEqual(advanceManualSelectionCursor({
    board, current, selection, baselineRevision: 10, currentRevision: 11,
  }), current);
  assert.deepEqual(advanceManualSelectionCursor({
    board, current, selection, receipt: rejected, baselineRevision: 10, currentRevision: 11,
  }), current);
  assert.deepEqual(advanceManualSelectionCursor({
    board, current, selection, receipt: mismatched, baselineRevision: 10, currentRevision: 11,
  }), current);
  assert.deepEqual(
    advanceManualSelectionCursor({
      board: projectProductionBoard([
        job({
          jobId: 'w-1',
          progress: {
            ...job().progress,
            stages: [stage('representative', { selectedId: 'rep-b', candidates: ['rep-a', 'rep-b'] })],
          },
        }),
        job({ jobId: 'w-2' }),
      ]),
      current: { jobId: 'w-2', stageKey: 'representative' },
      selection,
      receipt: stale,
      baselineRevision: 10,
      currentRevision: 11,
    }),
    { jobId: 'w-2', stageKey: 'representative' },
  );
});

test('수동 카드 controller는 잘못된 후보를 보내지 않고 새 projection 뒤에만 이동한다', async t => {
  const { mountProductionBoard } = await import(BOARD_URL);
  const { root, windowListeners } = installBoardDocument(t);
  let revision = 10;
  let selectedId = '';
  let delaySelection = false;
  let releaseSelection = null;
  const selectionBodies = [];
  const jobs = () => [
    job({
      jobId: 'w-1',
      status: selectedId ? 'running' : 'waiting_manual',
      progress: {
        ...job().progress,
        stages: [stage('representative', { selectedId, candidates: ['rep-a', 'rep-b'] })],
      },
    }),
    job({ jobId: 'w-2' }),
  ];
  const runtime = {
    factoryBackend: 'http://127.0.0.1:43170',
    factoryApp: 'http://127.0.0.1:42170',
    assetUrl: value => value,
    setStatus() {},
    apiRequest: async (requestPath, options = {}) => {
      if (requestPath === '/api/factory/state') {
        return { connected: true, eventCursor: '1', registration: { jobId: 'w-1' }, session: { revision } };
      }
      if (requestPath === '/api/factory/jobs/selections') {
        const body = JSON.parse(options.body);
        selectionBodies.push(body);
        if (delaySelection) await new Promise(resolve => { releaseSelection = resolve; });
        selectedId = body.selections[0].candidateId;
        return {
          schema: 'factory-batch-selection:v1', mode: 'manual',
          results: [{ ...body.selections[0], status: 'applied' }],
        };
      }
      return {};
    },
  };
  const stop = mountProductionBoard(runtime, {
    root,
    EventSourceImpl: null,
    fetchJobs: async () => ({ jobs: jobs() }),
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  dispatchBoardClick(root, { action: 'open', jobId: 'w-1', stageKey: 'representative' });
  dispatchBoardClick(root, { action: 'pick', jobId: 'w-1', stageKey: 'representative', candidateId: '' });
  dispatchBoardClick(root, { action: 'pick', jobId: 'w-1', stageKey: 'representative', candidateId: 'unknown' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(selectionBodies.length, 0);

  dispatchBoardClick(root, { action: 'pick', jobId: 'w-1', stageKey: 'representative', candidateId: 'rep-b' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(selectionBodies.length, 1);
  assert.deepEqual(viewedCell(root), { jobId: 'w-1', stageKey: 'representative' });

  revision = 11;
  await windowListeners.get('control-tower:job-created')();
  assert.deepEqual(viewedCell(root), { jobId: 'w-2', stageKey: 'representative' });
  stop();

  revision = 10;
  selectedId = '';
  delaySelection = true;
  releaseSelection = null;
  selectionBodies.length = 0;
  const raceRoot = new FakeElement('div');
  const stopRace = mountProductionBoard(runtime, {
    root: raceRoot,
    EventSourceImpl: null,
    fetchJobs: async () => ({ jobs: jobs() }),
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  dispatchBoardClick(raceRoot, { action: 'open', jobId: 'w-1', stageKey: 'representative' });
  dispatchBoardClick(raceRoot, { action: 'pick', jobId: 'w-1', stageKey: 'representative', candidateId: 'rep-b' });
  await new Promise(resolve => setTimeout(resolve, 0));
  dispatchBoardClick(raceRoot, { action: 'open', jobId: 'w-2', stageKey: 'representative' });
  assert.deepEqual(viewedCell(raceRoot), { jobId: 'w-2', stageKey: 'representative' });
  revision = 11;
  releaseSelection();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(selectionBodies.length, 1);
  assert.deepEqual(viewedCell(raceRoot), { jobId: 'w-2', stageKey: 'representative' });
  stopRace();
});

test('이미 읽은 작업 큐는 다음 200 응답이 비어도 유지하고 갱신 지연을 알린다', async t => {
  const { mountProductionBoard } = await import(BOARD_URL);
  const { root, windowListeners } = installBoardDocument(t);
  const responses = [
    { jobs: [job({ jobId: 'keep-1' }), job({ jobId: 'keep-2' })] },
    { jobs: [] },
  ];
  const runtime = {
    factoryBackend: 'http://127.0.0.1:43170',
    factoryApp: 'http://127.0.0.1:42170',
    assetUrl: value => value,
    setStatus() {},
    apiRequest: async requestPath => requestPath === '/api/factory/state'
      ? { connected: true, session: {} }
      : {},
  };
  const stop = mountProductionBoard(runtime, {
    root,
    EventSourceImpl: null,
    fetchJobs: async () => responses.shift(),
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(jobRows(root).length, 2);

  await windowListeners.get('control-tower:job-created')();

  assert.equal(jobRows(root).length, 2, '빈 응답이 기존 작업 2건을 지웠습니다');
  const [status] = nodesByClass(root, 'status-message');
  assert.match(status.textContent, /마지막 작업 큐 2건 유지/u);
  assert.match(status.textContent, /상태 갱신 지연/u);
  assert.equal(status.dataset.tone, 'warning');
  stop();
});

test('잘못된 작업 목록과 API 오류도 이미 읽은 큐를 보존한다', async t => {
  const { mountProductionBoard } = await import(BOARD_URL);
  const { root, windowListeners } = installBoardDocument(t);
  const unavailable = new Error('HTTP_404');
  unavailable.code = 'HTTP_404';
  const responses = [
    { jobs: [job({ jobId: 'keep-1' })] },
    { jobs: 'malformed' },
    unavailable,
  ];
  const runtime = {
    factoryBackend: 'http://127.0.0.1:43170',
    factoryApp: 'http://127.0.0.1:42170',
    assetUrl: value => value,
    setStatus() {},
    apiRequest: async requestPath => requestPath === '/api/factory/state'
      ? { connected: true, session: { workspaceId: 'workspace-a' } }
      : {},
  };
  const stop = mountProductionBoard(runtime, {
    root,
    EventSourceImpl: null,
    fetchJobs: async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  await windowListeners.get('control-tower:job-created')();
  assert.equal(jobRows(root).length, 1, 'malformed 목록이 기존 작업을 지웠습니다');
  await windowListeners.get('control-tower:job-created')();
  assert.equal(jobRows(root).length, 1, '404 오류가 기존 작업을 지웠습니다');
  const [status] = nodesByClass(root, 'status-message');
  assert.match(status.textContent, /마지막 작업 큐 1건 유지/u);
  assert.equal(status.dataset.tone, 'warning');
  stop();
});

test('초기 빈 큐는 허용하고 blank session은 연결된 idle 워커로 구분한다', async t => {
  const { mountProductionBoard } = await import(BOARD_URL);
  const { root } = installBoardDocument(t);
  const runtime = {
    factoryBackend: 'http://127.0.0.1:43170',
    factoryApp: 'http://127.0.0.1:42170',
    assetUrl: value => value,
    setStatus() {},
    apiRequest: async requestPath => requestPath === '/api/factory/state'
      ? {
        connected: true,
        session: { workspaceId: '', productKey: '', runId: '', inputFingerprint: '', workfileName: '' },
      }
      : {},
  };
  const stop = mountProductionBoard(runtime, {
    root,
    EventSourceImpl: null,
    fetchJobs: async () => ({ jobs: [] }),
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(jobRows(root).length, 0);
  const [connection] = nodesByClass(root, 'board-connection');
  assert.equal(connection.hidden, false);
  assert.match(connection.textContent, /워커 연결됨/u);
  assert.match(connection.textContent, /현재 작업 없음/u);
  stop();
});

test('projection 연결 상태는 blank session과 실제 작업 identity를 구분한다', async () => {
  const { projectWorkerConnectionState } = await import(MODEL_URL);

  assert.equal(projectWorkerConnectionState({ connected: true, session: {} }), 'idle');
  assert.equal(projectWorkerConnectionState({
    connected: true,
    session: { workspaceId: '', productKey: '', runId: 'run-a', inputFingerprint: '', workfileName: '' },
  }), 'active');
  assert.equal(projectWorkerConnectionState({ connected: false, session: { runId: 'run-a' } }), 'disconnected');
});

test('일괄 선택 결과를 한 줄로 요약한다', async () => {
  const { summarizeBatchSelection } = await import(MODEL_URL);

  assert.deepEqual(
    summarizeBatchSelection({ applied: 1, reserved: 4, skipped: 0, failed: 0 }),
    { applied: 1, reserved: 4, skipped: 0, failed: 0, reasons: [], tone: 'ok', copy: '1건 즉시 적용 · 4건 예약' },
  );
  assert.equal(summarizeBatchSelection({ failed: 2 }).tone, 'error');
  assert.equal(summarizeBatchSelection({ skipped: 3 }).tone, 'warning');
  assert.equal(summarizeBatchSelection({}).copy, '선택할 대기 작업이 없습니다.');

  // 보류만 알려 주고 사유를 감추면 사람이 다음에 무엇을 해야 할지 모른다.
  // 실측 2026-08-26: 화면은 "3건 보류" 만 적었고, 서버가 준
  // policy_snapshot_missing 은 어디에도 없었다.
  const held = summarizeBatchSelection({
    skipped: 3,
    results: [
      { jobId: 'w-1', reason: 'policy_snapshot_missing' },
      { jobId: 'w-2', reason: 'policy_snapshot_missing' },
      { jobId: 'w-3', reason: 'no_candidates' },
    ],
  });
  assert.deepEqual(held.reasons, ['policy_snapshot_missing', 'no_candidates']);
  assert.equal(held.copy, '3건 보류 · 사유 정책 스냅샷 없음, 후보 없음');

  // 모르는 코드는 삼키지 말고 그대로 보여 준다.
  assert.equal(
    summarizeBatchSelection({ skipped: 1, results: [{ reason: 'brand_new_code' }] }).copy,
    '1건 보류 · 사유 brand_new_code',
  );
});

test('내부 오류 코드는 운영자 문장으로 바꾸고 원래 코드는 따로 남긴다', async () => {
  const { operatorMessage, projectProductionBoard } = await import(MODEL_URL);

  const raw = 'factory_product_checkpoint_save_failed: 작업 저장 실패: incoming snapshot changed work identity or dropped protected work data: optionSorter.images.length';
  assert.deepEqual(operatorMessage(raw), {
    copy: '작업 저장에 실패했습니다. 조립공장에서 이 작업을 다시 열고 재개하세요.',
    code: raw,
  });
  assert.deepEqual(operatorMessage('qa_drain'), { copy: '조립공장에서 처리하지 못했습니다.', code: 'qa_drain' });
  assert.deepEqual(operatorMessage('대표이미지 결과를 선택해 주세요.'), { copy: '대표이미지 결과를 선택해 주세요.', code: '' });
  assert.deepEqual(operatorMessage(''), { copy: '', code: '' });

  const [row] = projectProductionBoard([job({ status: 'blocked', message: raw })]).rows;
  assert.equal(row.message, '작업 저장에 실패했습니다. 조립공장에서 이 작업을 다시 열고 재개하세요.');
  assert.equal(row.messageCode, raw);
  assert.equal(row.statusLabel, '차단');
});


test('공정 시간을 기계와 사람 대기로 나눠 보여준다', async () => {
  const { projectProductionBoard, durationLabel, describeParallelHeadroom } = await import(MODEL_URL);

  assert.equal(durationLabel(0), '0초');
  assert.equal(durationLabel(45_000), '45초');
  assert.equal(durationLabel(192_000), '3분 12초');
  assert.equal(durationLabel(3_900_000), '1시간 5분');

  const board = projectProductionBoard([
    job({ jobId: 'a', timing: { totalMachineMs: 120_000, totalWaitMs: 60_000 } }),
    job({ jobId: 'b', timing: { totalMachineMs: 60_000, totalWaitMs: 60_000 } }),
  ]);

  assert.equal(board.rows[0].machineMs, 120_000);
  assert.equal(board.rows[0].waitMs, 60_000);
  assert.equal(board.summary.totalMachineMs, 180_000);
  assert.equal(board.summary.totalWaitMs, 120_000);

  const headroom = describeParallelHeadroom(board.summary);
  assert.equal(headroom.measured, true);
  assert.equal(headroom.machineSharePercent, 60);
  assert.match(headroom.copy, /기계 3분 0초 · 사람 대기 2분 0초 \(기계 비중 60%\)/);
  assert.match(headroom.copy, /절반 정도 효과/);
});

test('사람 대기가 대부분이면 조립공장을 늘려도 소용없다고 알린다', async () => {
  const { describeParallelHeadroom } = await import(MODEL_URL);

  const mostlyWaiting = describeParallelHeadroom({ totalMachineMs: 60_000, totalWaitMs: 540_000 });
  const mostlyMachine = describeParallelHeadroom({ totalMachineMs: 540_000, totalWaitMs: 60_000 });

  assert.equal(mostlyWaiting.machineSharePercent, 10);
  assert.equal(mostlyWaiting.tone, 'warning');
  assert.match(mostlyWaiting.copy, /크게 빨라지지 않습니다/);
  assert.equal(mostlyMachine.tone, 'ok');
  assert.match(mostlyMachine.copy, /빨라질 여지가 큽니다/);
  assert.equal(describeParallelHeadroom({}).measured, false);
});


test('차단된 작업은 왜 멈췄고 무엇을 하면 되는지 알려준다', async () => {
  const { projectProductionBoard, describeBlocked } = await import(MODEL_URL);

  const [saveFailed, unknown, waiting] = projectProductionBoard([
    job({ jobId: 'b1', status: 'blocked', message: 'factory_product_checkpoint_save_failed: 작업 저장 실패' }),
    job({ jobId: 'b2', status: 'blocked', message: 'qa_drain' }),
    job({ jobId: 'w1' }),
  ]).rows;

  assert.deepEqual(describeBlocked(saveFailed), {
    cause: '조립공장이 작업 상태를 저장하지 못했습니다.',
    action: '다시 시도하면 저장된 지점부터 이어서 진행합니다.',
  });
  assert.equal(describeBlocked(unknown).cause, '조립공장에서 처리하지 못했습니다.');
  assert.equal(describeBlocked(waiting), null);
});

test('고른 컷이 있으면 그 컷의 썸네일을 칸에 싣는다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);

  const [row] = projectProductionBoard([
    job({
      progress: {
        ...job().progress,
        selectedStageCount: 1,
        awaitingStageKeys: ['size'],
        stages: [
          stage('representative', { selectedId: 'rep-b', candidates: ['rep-a', 'rep-b'] }),
          stage('size', { candidates: ['size-a'] }),
        ],
      },
    }),
  ]).rows;

  const chosen = row.cells.find(cell => cell.stageKey === 'representative');
  const pending = row.cells.find(cell => cell.stageKey === 'size');
  assert.equal(chosen.state, 'selected');
  assert.equal(chosen.selectedThumbnailUrl, 'http://127.0.0.1:5062/thumb/rep-b');
  assert.equal(pending.selectedThumbnailUrl, '');
});


test('고른 컷을 못 불러오면 코드 대신 이유를 말한다', async () => {
  const { describeResultError } = await import(MODEL_URL);

  assert.equal(
    describeResultError('factory_history_manifest_unavailable'),
    '이 작업의 결과가 아직 보관함에 저장되지 않았습니다.',
  );
  assert.equal(describeResultError('factory_history_identity_mismatch'), '보관함에 있는 결과가 이 작업과 맞지 않습니다.');
  assert.equal(describeResultError('HTTP_500'), '고른 컷을 불러오지 못했습니다.');
});

test('영어 단계 이름은 화면에서 한글로 바뀐다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);

  const [general, option] = projectProductionBoard([
    job({ jobId: 'g', message: 'general 결과 중 쓸 컷을 골라 주세요.' }),
    job({ jobId: 'o', message: 'option_color 결과 중 쓸 컷을 골라 주세요.' }),
  ]).rows;

  assert.equal(general.message, '이미지컷 결과 중 쓸 컷을 골라 주세요.');
  assert.equal(option.message, '색상옵션 결과 중 쓸 컷을 골라 주세요.');
});


test('고른 컷은 단계별로 묶고 너무 많으면 앞의 몇 장만 보여준다', async () => {
  const { groupResultCuts } = await import(MODEL_URL);

  const assets = [
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `final-${index}`, phase: 'output', selectionState: 'selected', stage: 'final_detail',
      displayName: `최종 ${index}`, thumbnailReference: `/thumb/final-${index}`,
    })),
    { id: 'hero-1', phase: 'output', selectionState: 'selected', stage: 'representative', displayName: '대표 1', thumbnailReference: '/thumb/hero-1' },
    { id: 'odd', phase: 'output', selectionState: 'selected', stage: 'weird_stage', displayName: '기타 1', thumbnailReference: '/thumb/odd' },
    { id: 'skip', phase: 'output', selectionState: 'candidate', stage: 'final_detail', displayName: '후보', thumbnailReference: '/thumb/skip' },
    { id: 'input', phase: 'input', selectionState: 'selected', stage: 'representative', displayName: '입력', thumbnailReference: '/thumb/input' },
  ];

  const grouped = groupResultCuts(assets);

  assert.equal(grouped.total, 11);
  assert.deepEqual(grouped.groups.map(group => group.stageKey), ['representative', 'final_detail', 'other']);
  const final = grouped.groups.find(group => group.stageKey === 'final_detail');
  assert.equal(final.total, 9);
  assert.equal(final.cuts.length, 4);
  assert.equal(final.hidden, 5);
  assert.equal(grouped.groups[0].hidden, 0);
  assert.equal(grouped.groups.at(-1).stageLabel, '기타');
  assert.equal(groupResultCuts([]).total, 0);
});


test('진행 스냅샷이 없는 완료 작업은 보관함 기록으로 칸을 채운다', async () => {
  const { projectProductionBoard, stagesFromResults } = await import(MODEL_URL);

  const archived = [
    { id: 'a1', phase: 'output', selectionState: 'selected', stage: 'representative', thumbnailReference: '/thumb/a1' },
    { id: 'a2', phase: 'output', selectionState: 'selected', stage: 'representative', thumbnailReference: '/thumb/a2' },
    { id: 'a3', phase: 'output', selectionState: 'selected', stage: 'final_detail', thumbnailReference: '/thumb/a3' },
    { id: 'a4', phase: 'output', selectionState: 'candidate', stage: 'size', thumbnailReference: '/thumb/a4' },
  ];

  const stages = stagesFromResults(archived);
  assert.deepEqual([...stages.keys()], ['representative', 'final_detail']);
  assert.equal(stages.get('representative').selectedId, 'a1');

  const [row] = projectProductionBoard(
    [job({ jobId: 'done', status: 'completed', progress: undefined })],
    { results: { done: archived } },
  ).rows;

  assert.equal(row.cells.find(cell => cell.stageKey === 'representative').state, 'selected');
  assert.equal(row.cells.find(cell => cell.stageKey === 'representative').selectedThumbnailUrl, '/thumb/a1');
  assert.equal(row.cells.find(cell => cell.stageKey === 'final_detail').state, 'selected');
  assert.equal(row.cells.find(cell => cell.stageKey === 'size').state, 'empty');
  assert.equal(row.stepLabel, '2 / 6단계');
});

test('진행 스냅샷이 있으면 보관함 기록으로 덮어쓰지 않는다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);

  const [row] = projectProductionBoard(
    [job({ jobId: 'live' })],
    { results: { live: [{ id: 'x', phase: 'output', selectionState: 'selected', stage: 'final_detail', thumbnailReference: '/thumb/x' }] } },
  ).rows;

  // 실시간 진행이 우선이다. 보관함은 진행 정보가 아예 없을 때만 쓴다.
  assert.equal(row.cells.find(cell => cell.stageKey === 'final_detail').state, 'empty');
  assert.equal(row.cells.find(cell => cell.stageKey === 'representative').state, 'awaiting');
});


test('모듈 import 에 버전을 붙여 낡은 캐시가 남지 않게 한다', () => {
  // 버전 쿼리가 없으면 브라우저가 예전 모듈을 계속 써서 "고쳤는데 안 바뀐다"가 된다.
  const dir = path.join(__dirname, '..', '..', 'frontend', 'src');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'control-tower.html'), 'utf8');
  for (const name of ['production-board.mjs', 'bulk-intake.mjs']) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    const bare = source.match(/from '\.\/[\w.-]+\.mjs'/g) || [];
    assert.deepEqual(bare, [], `${name} 의 로컬 import 에 버전 쿼리가 없습니다`);
    assert.ok(
      html.includes(`src="./src/${name}?`),
      `${name} 스크립트 태그에 버전 쿼리가 없습니다`,
    );
  }
});

test('읽기 전용 Cafe24 값 화면은 동작하지 않는 승인 버튼 라벨을 만들지 않는다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'production-board.mjs'), 'utf8');

  assert.doesNotMatch(source, /for \(const label of \['일회 승인', '고정된 대상 1건 실행', '등록 결과 재확인 · 재등록 없음'\]\)/);
});

test('행 지문은 그 행이 그리는 것만 본다 — 흘러가는 총 시간에는 흔들리지 않는다', async () => {
  const { boardRowSignature, projectProductionBoard } = await import(MODEL_URL);

  // 같은 작업을 두 번 투영하면 지문이 같아야 한다. 같아야 행 노드를 다시 쓰고,
  // 다시 써야 누르는 순간 버튼이 갈아 끼워지지 않는다.
  const [before] = projectProductionBoard([job({ status: 'waiting_manual' })]).rows;
  const [again] = projectProductionBoard([job({ status: 'waiting_manual' })]).rows;
  assert.equal(boardRowSignature(before), boardRowSignature(again));

  // 표 전체의 총 기계/대기 시간이 흘러도 이 행이 그리는 것은 그대로다.
  const [ticked] = projectProductionBoard([
    job({ status: 'waiting_manual', timing: { totalMachineMs: 999999, totalWaitMs: 888888 } }),
  ]).rows;
  assert.equal(
    boardRowSignature(before),
    boardRowSignature(ticked),
    '총 시간만 흘렀는데 행을 다시 만들면, 새로고침마다 손 밑의 버튼이 사라진다',
  );

  // 반대로 이 행이 실제로 바뀌면 지문도 달라져야 한다.
  const [moved] = projectProductionBoard([job({ status: 'blocked' })]).rows;
  assert.notEqual(boardRowSignature(before), boardRowSignature(moved));

  // 바깥 사정(누르는 중·연결 끊김·고른 컷 펼침)도 행 모양을 바꾸므로 지문에 든다.
  assert.notEqual(boardRowSignature(before, { busy: true }), boardRowSignature(before));
  assert.notEqual(boardRowSignature(before, { connected: true }), boardRowSignature(before));
  assert.notEqual(boardRowSignature(before, { resultsOpen: true }), boardRowSignature(before));
});

test('Task 20 필수값 붙여넣기는 한글·raw 별칭을 안전한 적용값으로만 분류한다', async () => {
  const { parseRequiredValuePaste } = await import(MODEL_URL);

  const result = parseRequiredValuePaste([
    '판매가: 12000',
    'material\t면',
    '기본 재고\t99',
    'salePrice: 13000',
    '없는 필드: 값',
    '형식 오류',
    '제품명: 이미 있는 제품명',
  ].join('\n'), { existingValues: { productName: '보존할 제품명' } });

  assert.deepEqual(result.rows.map(row => [row.key, row.value, row.status]), [
    ['salePrice', '12000', 'recognized'],
    ['material', '면', 'recognized'],
    ['stock', '99', 'recognized'],
    ['salePrice', '13000', 'duplicate'],
    ['', '값', 'unknown'],
    ['', '', 'malformed'],
    ['productName', '이미 있는 제품명', 'locked'],
  ]);
  assert.deepEqual(result.applicableValues, { salePrice: '12000', material: '면', stock: '99' });

  const options = parseRequiredValuePaste('옵션 여부: 옵션 있음\noptionMode\t옵션 없음\n옵션 여부: 지원 안 함');
  assert.deepEqual(options.rows.map(row => [row.value, row.status]), [
    ['provided', 'recognized'], ['none', 'duplicate'], ['', 'malformed'],
  ]);
  assert.deepEqual(options.applicableValues, { optionMode: 'provided' });
});
