const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.resolve(__dirname, '../../frontend/src/factory-operator-controls.mjs')).href;

const projection = () => ({ connected: true, session: {
  workspaceId: 'batch:job-a', productId: 'factory:a', productKey: 'a',
  runId: 'run-a', inputFingerprint: 'input-a', revision: 12, storeRevision: 30,
}, registration: { jobId: 'job-a' }, inputs: [{ key: 'operator_controls', items: [{
  schema: 'factory-operator-controls:v1', db: {}, competitor: {}, sections: [], fields: [],
}] }] });
const job = { jobId: 'job-a', status: 'waiting_manual' };

test('작업파일 다운로드는 같은 job 영수증의 요청 출처만 인정하고 디스크 저장이라고 하지 않는다', async () => {
  const { createFactoryOperatorControls, buildFactoryTabCommand } = await import(url);
  const live = { ...projection(), storage: { ok: true, warning: '' } };
  const args = { job, projection: live, tabId: 'workfile', action: 'export-current', value: {}, idempotencyKey: 'export-a' };
  assert.throws(() => buildFactoryTabCommand({ ...args, job: { ...job, status: 'blocked' } }));
  assert.throws(() => buildFactoryTabCommand({ ...args, projection: { ...live, storage: { ok: false } } }));
  for (const source of ['browser-download-requested', 'authoritative-store']) {
    let applied = 0;
    const controls = createFactoryOperatorControls({ getContext: () => ({ job, projection: live }),
      apiRequest: async (_url, options) => options?.method === 'POST' ? { accepted: true, orderId: 'download-a' } : {
        status: 'completed', receipt: { schema: 'factory-tab-command-receipt:v1', jobId: job.jobId,
          tabId: 'workfile', action: 'export-current', status: 'applied', projection: { ...live, session: {
            ...live.session, workfileSource: source, workfileName: '현재제품.kuasangse',
            workfileBytes: 123, workfileSha256: 'a'.repeat(64),
          } } },
      }, onApplied: () => { applied += 1; }, wait: async () => {} });
    await controls.submit('workfile', 'export-current', {}, '작업파일 다운로드', job.jobId);
    assert.equal(applied, source === 'browser-download-requested' ? 1 : 0);
    const status = controls.status(job.jobId);
    if (applied) {
      assert.match(status.message, /다운로드 요청/);
      assert.match(status.message, /디스크 저장 미확인/);
      assert.doesNotMatch(status.message, /다운로드 완료|저장했습니다/);
    } else assert.equal(status.tone, 'error');
    controls.stop();
  }
});

test('수동 탭 명령은 현재 제품과 문서·store 버전을 따로 고정한다', async () => {
  const { buildFactoryTabCommand } = await import(url);
  const payload = buildFactoryTabCommand({ job, projection: projection(), tabId: 'db', action: 'search', value: { query: '파우치', source: 'all' }, idempotencyKey: 'command-a' });
  assert.equal(payload.expectedRevision, 12);
  assert.equal(payload.expectedStoreRevision, 30);
  assert.equal(payload.expectedWorkspaceId, 'batch:job-a');
  assert.equal(payload.jobId, job.jobId);
  assert.deepEqual(payload.value, { query: '파우치', source: 'all' });
  for (const bad of [
    { ...projection(), registration: { jobId: 'job-b' } },
    { ...projection(), session: { ...projection().session, workspaceId: 'batch:job-b' } },
    { ...projection(), session: { ...projection().session, storeRevision: undefined } },
    { ...projection(), connected: false },
  ]) assert.throws(() => buildFactoryTabCommand({ job, projection: bad, tabId: 'db', action: 'search', value: {}, idempotencyKey: 'x' }));
  assert.throws(() => buildFactoryTabCommand({ job: { ...job, status: 'running' }, projection: projection(), tabId: 'db', action: 'search', value: {}, idempotencyKey: 'x' }));
});

test('수동 편집은 접수 응답을 완료로 보지 않고 같은 job 영수증을 기다린다', async () => {
  const { createFactoryOperatorControls } = await import(url);
  const states = [];
  let reads = 0;
  let refreshes = 0;
  const controls = createFactoryOperatorControls({
    getContext: () => ({ job, projection: projection() }),
    apiRequest: async (_url, options) => options?.method === 'POST'
      ? { accepted: true, orderId: 'order-a' }
      : ++reads === 1 ? { status: 'running' } : { status: 'completed', receipt: {
        schema: 'factory-tab-command-receipt:v1', jobId: 'job-a', tabId: 'db', action: 'search', status: 'applied',
      } },
    onChange: () => states.push(controls.status('job-a')),
    onApplied: () => { refreshes += 1; },
    wait: async () => {},
  });
  await controls.submit('db', 'search', { query: '파우치', source: 'all' }, '후보 검색');
  assert.equal(reads, 2);
  assert.equal(refreshes, 1);
  assert.equal(states[0].pending, true);
  assert.equal(states.at(-1).tone, 'ok');
  controls.stop();
});

test('필수값 펼침은 같은 제품 상태 갱신 뒤 유지되고 다른 제품에는 섞이지 않는다', async () => {
  const { renderFactoryFieldControls } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/factory-operator-source-panels.mjs')).href);
  const original = global.document;
  global.document = { createElement: tag => Object.assign(new EventTarget(), {
    tagName: tag, children: [], dataset: {}, open: false,
    append(...children) { this.children.push(...children); },
  }) };
  try {
    const drafts = new Map();
    const ctx = { job, projection: projection(), controller: {
      draft: (key, initial) => drafts.has(key) ? drafts.get(key) : initial,
      remember: (key, value) => drafts.set(key, value),
    } };
    const render = context => {
      const root = document.createElement('div');
      renderFactoryFieldControls(root, context, [{ fieldId: 'stock', label: '기본 재고', value: '99' }]);
      return root.children[0];
    };
    const panel = render(ctx);
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    assert.equal(render(ctx).open, true);
    assert.equal(render({ ...ctx, job: { ...job, jobId: 'job-b' } }).open, false);
  } finally { global.document = original; }
});
