const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MODULE = pathToFileURL(path.resolve(__dirname, '../../frontend/src/production-workbench.mjs')).href;
const settle = () => new Promise(resolve => setImmediate(resolve));
const nodes = root => [root, ...(root.children || []).flatMap(nodes)];

class TestElement extends EventTarget {
  constructor(tagName = 'div') {
    super();
    Object.assign(this, { tagName: tagName.toUpperCase(), children: [], dataset: {},
      style: {}, attributes: {}, className: '', textContent: '', disabled: false });
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get isConnected() { return Boolean(this.parentNode); }
  append(...children) {
    for (const child of children) {
      child.remove?.();
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  insertBefore(child, sibling) {
    child.remove?.();
    child.parentNode = this;
    this.children.splice(this.children.indexOf(sibling), 0, child);
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  before(child) { this.parentNode?.insertBefore(child, this); }
  replaceWith(child) { this.before(child); this.remove(); }
  contains(child) { return nodes(this).includes(child); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  matches(selector) { return selector === '[data-operator-field]' && Boolean(this.dataset.operatorField); }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function projection(overrides = {}) {
  return {
    schema: 'factory-control-projection:v1', capabilityVersion: 'factory-control-command:v1',
    connected: true, currentJob: null, sequence: 1, cursor: '1',
    session: { workspaceId: 'batch:job-a', productId: 'product-a', productKey: '보존할 제품',
      runId: 'run-a', inputFingerprint: 'input-a', revision: 12, storeRevision: 30 },
    registration: { jobId: '' }, stages: [],
    inputs: [{ key: 'operator_controls', count: 1, items: [{ schema: 'factory-operator-controls:v1',
      fields: [{ fieldId: 'stock', label: '기본 재고', value: '99' }], db: {}, competitor: {},
      sections: [{ id: 'header', label: '헤더', instruction: '보존할 지시문' }],
    }] }],
    ...overrides,
    progress: { stageKey: 'required_values', status: 'manual', elapsedMs: 1000,
      stageLabel: '', mode: 'manual', ...overrides.progress },
  };
}

async function mount(t, initial, jobs = [], respond = () => undefined, search = '') {
  const { mountProductionWorkbench } = await import(MODULE);
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  const roots = new Map([
    'app', 'factory-sync-bar', 'sync-disclosure-summary-text', 'factory-product-progress',
    'workfile-report-ledger', 'io-progress-map', 'a-cut-contact-sheet', 'artifact-inspector',
    'factory-registration-panel', 'product-list', 'operator-queue-selection',
    'automation-policy-matrix', 'automation-policy-summary', 'work-bundle-input-assets',
    'work-bundle-output-assets', 'workfile-job-tabs', 'workfile-job-tabpanel', 'overview-stage-summary',
  ].map(id => [id, Object.assign(new TestElement(), { id })]));
  const body = new TestElement('body');
  body.append(...roots.values());
  const timers = new Map();
  let timerId = 0;
  let state = initial;
  const requests = [];
  const statuses = [];
  Object.assign(globalThis, {
    document: Object.assign(new EventTarget(), { body, activeElement: null,
      createElement: tag => new TestElement(tag), createComment: () => new TestElement('comment'),
      createTextNode: text => Object.assign(new TestElement('text'), { textContent: text }),
      getElementById: id => roots.get(id) || nodes(body).find(node => node.id === id) || null,
      querySelectorAll: () => [], querySelector: () => null,
    }),
    window: Object.assign(new EventTarget(), {
      location: { search, href: `http://test.invalid/control-tower.html${search}` },
      history: { replaceState() {} },
      setInterval: callback => { timers.set(++timerId, callback); return timerId; },
      clearInterval: id => timers.delete(id),
    }),
    MutationObserver: class { observe() {} disconnect() {} },
    Option: function (label, value) { return Object.assign(new TestElement('option'), { textContent: label, value }); },
    controlTowerMenu: { updateBadges() {} },
  });
  let stop;
  t.after(() => {
    stop?.();
    assert.equal(timers.size, 0);
    for (const key of ['document', 'window', 'MutationObserver', 'Option', 'controlTowerMenu']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('test_network_forbidden'); });
  stop = mountProductionWorkbench({ EventSourceImpl: null,
    apiRequest: async (url, options) => {
      requests.push({ url, method: options?.method || 'GET' });
      const response = respond(url, options);
      if (response !== undefined) return response;
      if (url === '/api/factory/state') return state;
      if (url === '/api/factory/jobs') return { jobs };
      return {};
    },
    setStatus: (...args) => statuses.push(args),
  });
  await settle();
  return { roots, requests, statuses,
    setState(next) { state = next; },
    async poll(next = state) { state = next; for (const callback of [...timers.values()]) callback(); await settle(); },
  };
}

const find = (root, key, value) => nodes(root).find(node => node.dataset?.[key] === value);
const content = root => nodes(root).map(node => node.textContent).join(' ');

test('queue row keyboard handler leaves nested action buttons to their own handlers', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/production-workbench.mjs'), 'utf8');
  assert.match(source, /row\.addEventListener\('keydown', event => \{\s*if \(event\.target !== row\) return;/);
});

test('Cafe24 panel follows the viewed product and locks non-live tabs', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/production-workbench.mjs'), 'utf8');
  assert.match(source, /function renderRegistration\(\) \{\s*const root = roots\.registration;\s*const current = viewedProjection\(\);/s);
  assert.match(source, /approvalState: \{ \.\.\.approval, receipt: currentReceipt \}/);
  assert.match(source, /readOnly: !liveView/);
  assert.match(source, /현재 등록 대상이 아니어서 읽기 전용입니다\. 작업 큐에서 이 제품을 이어 열어/);
});

test('native registration history renders remote 3024 images/options/stock with current approval separate', async t => {
  const { runtime, JOB } = require('../../../tests/frontend/factory_cafe24_native_receipt_fixture.cjs');
  const state = await runtime().project(); // Given
  const app = await mount(t, state, [{ jobId: JOB, productName: '전통 꽃자수 파우치', status: 'completed', stageKey: 'cafe24' }]); // When
  const panel = app.roots.get('factory-registration-panel');
  assert.equal(panel.dataset.status, 'registered_history'); // Then
  const rendered = content(panel);
  assert.match(rendered, /#3024/);
  assert.match(rendered, /14장 원격 확인/);
  assert.match(rendered, /4장 원격 확인/);
  assert.match(rendered, /자주.*빨강/);
  assert.match(rendered, /2개 품목.*99/);
  assert.doesNotMatch(rendered, /현재 편집 옵션|각 7|등록 실행 중/);
  assert.match(rendered, /현재.*별도 승인/);
  assert.match(content(app.roots.get('sync-disclosure-summary-text')), /등록 이력 확인.*현재 변경 별도 승인/);
  assert.equal(find(panel, 'action', 'cafe24-execute').disabled, true);
  assert.ok(app.requests.every(request => request.method === 'GET'));
  assert.equal(state.registration.approvalTokenState, 'missing');
});

for (const [runId, storageOk] of [['', true], ['foreign-run', true], ['saved-run', true], ['saved-run', false]]) {
  test(`same-job restore button checks checkpoint run identity: ${runId || 'missing'} / ${storageOk}`, async t => {
    const job = { jobId: 'job-a', productName: '보존할 제품', status: 'completed', stageKey: 'cafe24',
      checkpointAvailable: true, checkpointRunId: 'saved-run' };
    const state = projection({ registration: { jobId: job.jobId }, storage: { ok: storageOk, warning: storageOk ? '' : '저장 경고' } });
    state.session.runId = runId; // Given
    const before = structuredClone(state);
    let submitted;
    const app = await mount(t, state, [job], (url, options) => {
      if (url.endsWith('/history')) return { workBundle: { id: 'history:job-a' },
        history: { workspaceId: 'batch:job-a', runId: 'saved-run', revision: 12 } };
      if (url.endsWith('/resume')) {
        submitted = JSON.parse(options.body);
        return { job };
      }
    }); // When
    const open = find(app.roots.get('overview-stage-summary'), 'action', 'restore-viewed-job');
    assert.equal(Boolean(open), runId !== 'saved-run' || !storageOk); // Then
    assert.ok(app.requests.every(request => request.method === 'GET'));
    if (open) {
      assert.equal(open.disabled, false);
      open.dispatchEvent(new Event('click'));
      await settle();
      assert.deepEqual(submitted, { expectedCheckpointRevision: 12, expectedCheckpointRunId: 'saved-run' });
      assert.equal(app.requests.filter(request => request.method === 'POST').length, 1);
    }
    assert.deepEqual(state, before);
  });
}

test('running job without a checkpoint does not request history', async t => {
  const job = { jobId: 'job-running', productName: '실행 중 제품', status: 'running', checkpointAvailable: false };
  const state = projection({ registration: { jobId: job.jobId }, currentJob: job });
  const app = await mount(t, state, [job], (url) => {
    if (url.endsWith('/history')) throw new Error('history_request_for_running_job');
  }, '?factoryHistoryJob=job-running');

  assert.equal(app.requests.filter(request => request.url.endsWith('/history')).length, 0);
});

test('workfile export is explicit, current-job only and reports a requested download', async t => {
  const job = { jobId: 'job-a', productName: '현재 제품', status: 'waiting_manual', stageKey: 'required_values' };
  const state = projection({ registration: { jobId: job.jobId }, storage: { ok: true, warning: '' } });
  let submitted;
  const app = await mount(t, state, [job], (url, options) => {
    if (url.endsWith('/tab-command') && options?.method === 'POST') {
      submitted = JSON.parse(options.body);
      return { accepted: true, orderId: 'export-1' };
    }
    if (url.endsWith('/tab-command/export-1')) return { status: 'completed', receipt: {
      schema: 'factory-tab-command-receipt:v1', jobId: job.jobId, tabId: 'workfile', action: 'export-current', status: 'applied',
      projection: { ...state, session: { ...state.session, workfileSource: 'browser-download-requested',
        workfileName: '현재제품.kuasangse', workfileBytes: 123, workfileSha256: 'a'.repeat(64) } },
    } };
  });
  const ledger = app.roots.get('workfile-report-ledger');
  const button = find(ledger, 'operatorAction', 'workfile:export-current');
  assert.ok(button, 'export button is rendered without opening a browser');
  assert.equal(button.disabled, false);
  assert.ok(app.requests.every(request => request.method === 'GET'), 'mount does not export');
  button.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(submitted.jobId, job.jobId);
  assert.equal(submitted.expectedRevision, state.session.revision);
  assert.equal(submitted.expectedStoreRevision, state.session.storeRevision);
  assert.deepEqual(submitted.value, {});
  assert.match(content(ledger), /다운로드 요청.*디스크 저장 미확인/);
  await app.poll({ ...state, sequence: 3, registration: { jobId: 'other' } });
  assert.equal(find(ledger, 'operatorAction', 'workfile:export-current').disabled, true);
  assert.equal(app.requests.filter(request => request.method === 'POST').length, 1);
});

test('connected projection with null currentJob renders every operator panel read-only', async t => {
  const state = projection();
  const before = structuredClone(state);
  const app = await mount(t, state);
  const overview = app.roots.get('overview-stage-summary');
  for (const step of ['required', 'db', 'competitors', 'sections']) {
    find(overview, 'assemblyStep', step).dispatchEvent(new Event('click'));
    const fields = nodes(overview).filter(node => node.dataset?.operatorField);
    const actions = nodes(overview).filter(node => node.dataset?.operatorAction);
    assert.ok(fields.length > 0, `${step} fields remain visible`);
    assert.ok(actions.length > 0, `${step} actions remain visible`);
    assert.ok([...fields, ...actions].every(node => node.disabled), `${step} stays read-only`);
  }
  assert.doesNotMatch(content(app.roots.get('factory-sync-bar')), /상태 조회 실패|Cannot read/);
  assert.deepEqual(state, before);
  assert.ok(app.requests.every(request => request.method === 'GET'));
});

test('operator queue thumbnail 404 falls back to initials without losing image semantics', async t => {
  const state = projection();
  const job = { jobId: 'job-thumbnail-404', productName: '실패 썸네일 제품', status: 'running', stageKey: 'intake', imageCount: 1 };
  const app = await mount(t, state, [job]);
  const row = find(app.roots.get('product-list'), 'jobId', job.jobId);
  const thumb = nodes(row).find(node => node.className === 'operator-job-thumb');
  const image = thumb?.firstElementChild;

  assert.ok(row, 'the queue row remains rendered');
  assert.equal(image?.tagName, 'IMG');
  assert.equal(image?.alt, '');
  assert.equal(thumb?.getAttribute('role'), 'img');
  assert.match(thumb?.getAttribute('aria-label') || '', /제품 이미지$/u);

  image.dispatchEvent(new Event('error'));

  assert.equal(thumb.firstElementChild.tagName, 'TEXT');
  assert.equal(thumb.firstElementChild.textContent, '실패');
  assert.equal(thumb.getAttribute('role'), 'img');
  assert.match(thumb.getAttribute('aria-label') || '', /제품 이미지 없음$/u);
  assert.equal(row.dataset.jobId, job.jobId);
});

test('unchanged heartbeat preserves workbench nodes and a mounted document preview', async t => {
  const state = projection({ progress: { stageKey: 'intake', status: 'manual', elapsedMs: 1000 } });
  const app = await mount(t, state);
  const overview = app.roots.get('overview-stage-summary');
  const panel = document.getElementById('operator-assembly-body');
  const target = find(overview, 'productionBoardFocus', 'true');
  const frame = new TestElement('iframe');
  target.append(frame);
  for (let sequence = 2; sequence <= 4; sequence += 1) {
    await app.poll({ ...state, sequence, cursor: String(sequence), capturedAt: `heartbeat-${sequence}`,
      progress: { ...state.progress, elapsedMs: sequence * 1000 } });
    assert.ok(document.getElementById('operator-assembly-body') === panel, 'heartbeat must retain the workbench body');
    assert.ok(find(overview, 'productionBoardFocus', 'true') === target, 'heartbeat must retain the preview target');
    assert.ok(overview.contains(frame));
  }
});

test('event-cursor heartbeats preserve the overview stage control', async t => {
  const job = { jobId: 'factory-job-overview', productName: '개요 보존 제품', status: 'waiting_manual', stageKey: 'size', mode: 'manual' };
  const state = projection({
    registration: { jobId: job.jobId },
    progress: { stageKey: 'size', status: 'waiting_manual', eventCursor: '1' },
    stages: [
      { key: 'representative', candidates: [{ id: 'representative-a' }], selectedId: '' },
      { key: 'size', candidates: [{ id: 'size-a' }], selectedId: '' },
      { key: 'general', candidates: [{ id: 'general-a' }], selectedId: '' },
    ],
  });
  const app = await mount(t, state, [job]); // Given
  const overview = app.roots.get('overview-stage-summary');
  const body = document.getElementById('operator-assembly-body');
  const sizeButton = find(overview, 'cutStage', 'size');
  assert.ok(body && sizeButton, 'the overview size stage control is rendered');

  await app.poll({ ...state, sequence: 2, cursor: '2', progress: { ...state.progress, eventCursor: '2' } }); // When: only the heartbeat cursor changes

  assert.equal(document.getElementById('operator-assembly-body'), body);
  assert.equal(find(overview, 'cutStage', 'size'), sizeButton);
  assert.equal(sizeButton.isConnected, true); // Then
});

test('unchanged queue polling preserves the active candidate control', async t => {
  const job = { jobId: 'factory-job-a', productName: '컷 선택 제품', status: 'waiting_manual', stageKey: 'size', mode: 'manual' };
  const state = projection({
    registration: { jobId: job.jobId },
    progress: { stageKey: 'size', status: 'waiting_manual' },
    stages: [
      { key: 'representative', candidates: [{ id: 'representative-a' }], selectedId: '' },
      { key: 'size', candidates: [{ id: 'size-a' }, { id: 'size-b' }, { id: 'size-c' }], selectedId: '' },
      { key: 'general', candidates: [{ id: 'general-a' }], selectedId: '' },
    ],
  });
  const app = await mount(t, state, [job]); // Given
  find(app.roots.get('io-progress-map'), 'stageKey', 'size').dispatchEvent(new Event('click'));
  const queueSelection = app.roots.get('operator-queue-selection');
  const beforeRootChild = queueSelection.firstElementChild;
  const beforeCandidate = find(queueSelection, 'action', 'select-a-cut-direct');
  assert.ok(beforeCandidate, 'the size candidate control is rendered');
  assert.equal(beforeCandidate.disabled, false);

  await app.poll(); // When: the heartbeat returns the identical projection

  assert.equal(queueSelection.firstElementChild, beforeRootChild);
  const afterCandidate = find(queueSelection, 'action', 'select-a-cut-direct');
  assert.equal(afterCandidate, beforeCandidate);
  assert.equal(afterCandidate.disabled, false); // Then

  const changed = {
    ...state,
    sequence: 2,
    stages: state.stages.map(stage => stage.key === 'size'
      ? { ...stage, candidates: [...stage.candidates, { id: 'size-d' }] }
      : stage),
  };
  await app.poll(changed);
  assert.notEqual(queueSelection.firstElementChild, beforeRootChild);
  assert.ok(find(queueSelection, 'candidateId', 'size-d'));
});

test('detached work-bundle cards stop retries while attached cards retain the finite fallback', async t => {
  await mount(t, projection());
  const { createWorkBundleAssetCard } = await import(MODULE);
  const asset = { id: 'retry-a', assetKey: 'output:hero:retry-a', role: 'hero',
    factoryStageKey: 'representative', thumbnailReference: 'https://images.invalid/a/thumbnail' };
  const active = createWorkBundleAssetCard(asset);
  document.body.append(active);
  const activeFrame = active.firstElementChild;
  const activeImage = activeFrame.firstElementChild;
  activeImage.dispatchEvent(new Event('error'));
  assert.match(activeImage.src, /\?retry=\d+$/);
  activeImage.dispatchEvent(new Event('error'));
  assert.equal(activeFrame.firstElementChild.textContent, '이미지 불러오기 실패');
  const detached = createWorkBundleAssetCard(asset);
  document.body.append(detached);
  const oldImage = detached.firstElementChild.firstElementChild;
  const originalSrc = oldImage.src;
  detached.remove();
  oldImage.dispatchEvent(new Event('error'));
  assert.equal(oldImage.src, originalSrc, 'a removed card must not issue another request');
  assert.equal(detached.firstElementChild.firstElementChild, oldImage);
});

test('work-bundle images and failure placeholders survive unrelated heartbeat renders', async t => {
  const state = projection();
  const bundle = { id: 'bundle-a', bundleKey: 'kuasangse:batch:job-a', version: 1, assets: [
    { id: 'input-a', assetKey: 'input:base:a', phase: 'input', role: 'base', thumbnailReference: 'https://images.invalid/input' },
    { id: 'hero-a', assetKey: 'output:hero:a', phase: 'output', role: 'hero', factoryStageKey: 'representative', thumbnailReference: 'https://images.invalid/hero' },
  ] };
  const app = await mount(t, state, [], url => {
    if (url.startsWith('/api/pdp/work-bundles?')) return { items: [bundle] };
    if (url === '/api/pdp/work-bundles/bundle-a') return bundle;
  });
  await settle();
  const inputRoot = app.roots.get('work-bundle-input-assets');
  const outputRoot = app.roots.get('work-bundle-output-assets');
  const inputCard = find(inputRoot, 'assetId', 'input-a');
  const outputCard = find(outputRoot, 'assetId', 'hero-a');
  assert.ok(inputCard && outputCard);
  const failedImage = outputCard.firstElementChild.firstElementChild;
  failedImage.dispatchEvent(new Event('error'));
  failedImage.dispatchEvent(new Event('error'));
  const failure = outputCard.firstElementChild.firstElementChild;
  assert.equal(failure.dataset.broken, 'true');
  for (let sequence = 2; sequence <= 4; sequence += 1) {
    await app.poll({ ...state, sequence, cursor: String(sequence), progress: { ...state.progress, elapsedMs: sequence * 1000 } });
    assert.ok(find(inputRoot, 'assetId', 'input-a') === inputCard, 'input image must not remount on heartbeat');
    assert.ok(find(outputRoot, 'assetId', 'hero-a') === outputCard, 'output image must not remount on heartbeat');
    assert.ok(outputCard.firstElementChild.firstElementChild === failure);
  }
});

test('selection badge counts every selectedIds member instead of one per stage', async t => {
  const candidates = Array.from({ length: 16 }, (_, index) => ({ id: `section-${index}` }));
  const state = projection({ progress: { stageKey: 'intake', status: 'manual' }, stages: [
    { key: 'sections', candidates: candidates.slice(0, 8), selectedId: 'section-0', selectedIds: candidates.slice(0, 7).map(item => item.id) },
    { key: 'final_detail', candidates: candidates.slice(8), selectedId: 'section-8', selectedIds: candidates.slice(8, 15).map(item => item.id) },
  ] });
  const app = await mount(t, state);
  assert.match(content(find(app.roots.get('factory-sync-bar'), 'field', 'selection-counts')), /14\/16/);
});

test('real state and manual stage changes render, then heartbeat retains the selected view', async t => {
  const job = { jobId: 'job-a', productName: '현재 제품', status: 'waiting_manual', stageKey: 'representative' };
  const state = projection({ registration: { jobId: job.jobId }, progress: { stageKey: 'representative', status: 'waiting_manual' } });
  const app = await mount(t, state, [job]);
  const overview = app.roots.get('overview-stage-summary');
  const body = document.getElementById('operator-assembly-body');
  await app.poll();
  assert.ok(document.getElementById('operator-assembly-body') === body);
  find(overview, 'cutStage', 'size').dispatchEvent(new Event('click'));
  assert.equal(find(overview, 'productionBoardFocus', 'true').dataset.stageKey, 'size');
  const manualBody = document.getElementById('operator-assembly-body');
  await app.poll();
  assert.ok(document.getElementById('operator-assembly-body') === manualBody);
  const updated = { ...state, sequence: 2, progress: { ...state.progress, percent: 37, message: '후보 생성됨' } };
  await app.poll(updated);
  assert.ok(document.getElementById('operator-assembly-body') !== manualBody);
  assert.match(content(overview), /후보 생성됨/);
  assert.equal(find(overview, 'productionBoardFocus', 'true').dataset.stageKey, 'size');
});

test('saved selected job stays visible and read-only when the active worker disappears', async t => {
  const job = { jobId: 'job-a', productName: '이력 제품', status: 'waiting_manual', stageKey: 'required_values',
    checkpointAvailable: true, progress: { stages: [{ key: 'representative',
      candidates: [{ id: 'saved-a', label: '보존할 A컷' }], selectedId: 'saved-a' }] } };
  const before = structuredClone(job);
  const state = projection({ registration: { jobId: job.jobId } });
  const app = await mount(t, state, [job]);
  const overview = app.roots.get('overview-stage-summary');
  assert.equal(find(overview, 'operatorField', 'field:stock').disabled, false);
  await app.poll({ ...state, sequence: 2, registration: { jobId: '' }, currentJob: null });
  assert.match(content(overview), /이력 제품/);
  assert.equal(find(overview, 'operatorField', 'field:stock').value, '99');
  assert.ok(nodes(overview).filter(node => node.dataset?.operatorField || node.dataset?.operatorAction).every(node => node.disabled));
  assert.match(content(app.roots.get('operator-queue-selection')), /보기 전용/);
  assert.deepEqual(job, before);
  assert.ok(app.requests.every(request => request.method === 'GET'));
});

test('field drafts and expanded details survive polls while command feedback still renders', async t => {
  const job = { jobId: 'job-a', productName: '편집 제품', status: 'waiting_manual', stageKey: 'required_values' };
  const state = projection({ registration: { jobId: job.jobId } });
  const app = await mount(t, state, [job], (url, options) => {
    if (url.endsWith('/tab-command') && options?.method === 'POST') return { accepted: true, orderId: 'edit-1' };
    if (url.endsWith('/tab-command/edit-1')) return { status: 'completed', receipt: {
      schema: 'factory-tab-command-receipt:v1', jobId: job.jobId, tabId: 'fields', action: 'commitField', status: 'applied',
    } };
  });
  const overview = app.roots.get('overview-stage-summary');
  const details = nodes(overview).find(node => node.className === 'operator-field-details');
  const field = find(overview, 'operatorField', 'field:stock');
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  field.value = '123';
  field.dispatchEvent(new Event('input'));
  await app.poll();
  assert.ok(find(overview, 'operatorField', 'field:stock') === field);
  assert.equal(details.open, true);
  const applied = structuredClone(state);
  applied.sequence += 1;
  applied.session.revision += 1;
  applied.session.storeRevision += 1;
  applied.inputs[0].items[0].fields.push({ fieldId: 'material', label: '소재', value: '면' });
  app.setState(applied);
  find(overview, 'operatorAction', 'fields:commitField').dispatchEvent(new Event('click'));
  assert.match(content(overview), /요청을 확인하고 있습니다/);
  await settle();
  assert.match(content(overview), /이 값 저장 완료/);
  assert.equal(find(overview, 'operatorField', 'field:stock').value, '123');
  assert.equal(find(overview, 'operatorField', 'field:material')?.value, '면', 'new field response must be rendered');
  assert.equal(nodes(overview).find(node => node.className === 'operator-field-details').open, true);
  assert.equal(app.requests.filter(request => request.method === 'POST').length, 1);
});


test('non-current waiting job exposes an explicit resume action and keeps stale blockers out of the main queue', async t => {
  const liveJob = { jobId: 'job-live', productName: '현재 제품', status: 'running', stageKey: 'required_values' };
  const waitingJob = {
    jobId: 'job-waiting', productName: '선택할 제품', status: 'waiting_manual', stageKey: 'representative',
    mode: 'manual', checkpointAvailable: true,
    progress: { stageKey: 'representative', status: 'waiting_manual', stages: [
      { key: 'representative', status: 'waiting_manual', candidates: [{ id: 'waiting-cut' }], selectedId: '' },
    ] },
  };
  const staleJob = {
    jobId: 'job-stale', productName: '오래된 기록', status: 'blocked', stageKey: 'representative',
    message: 'stale_reference_decision', checkpointAvailable: false,
  };
  const state = projection({
    registration: { jobId: liveJob.jobId },
    progress: { stageKey: liveJob.stageKey, status: liveJob.status },
  });
  const app = await mount(t, state, [liveJob, waitingJob, staleJob], (url, options) => {
    if (url.endsWith('/history')) return { workBundle: { id: 'history:job-waiting' }, history: { workspaceId: 'batch:job-waiting', runId: 'saved-run', revision: 2 } };
    if (url.endsWith('/resume')) return { job: waitingJob };
    return undefined;
  });
  const queue = app.roots.get('product-list');
  const waitingRow = find(queue, 'jobId', waitingJob.jobId);
  const waitingResume = nodes(waitingRow).find(node => node.tagName === 'BUTTON' && node.textContent === '작업 재개');

  assert.ok(waitingResume, 'a non-current waiting job must expose a resume action');
  document.activeElement = waitingRow;
  waitingRow.dispatchEvent(new Event('click'));
  const focusedWaitingRow = find(queue, 'jobId', waitingJob.jobId);
  assert.equal(focusedWaitingRow.dataset.current, 'true', 'selecting a row must move queue focus with the workbench');
  document.activeElement = null;
  nodes(focusedWaitingRow).find(node => node.tagName === 'BUTTON' && node.textContent === '작업 재개').dispatchEvent(new Event('click'));
  await settle();
  await settle();
  assert.ok(app.requests.some(request => request.method === 'POST' && request.url.endsWith('/resume')));
  assert.match(content(queue), /오래된 기록/);
  assert.equal(queue.dataset.historicalBlockedCount, '1');
  assert.match(content(queue), /막힌 작업 1건/);
  assert.match(content(queue), /‘전체’ 에서 볼 수 있습니다/u);
});
