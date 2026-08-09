const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const FRONTEND = path.resolve(__dirname, '../../frontend');
const HTML = path.join(FRONTEND, 'control-tower.html');
const MODULE = path.join(FRONTEND, 'src', 'production-workbench.mjs');

function projection(overrides = {}) {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    sequence: 7,
    cursor: '7',
    connected: true,
    session: {
      workspaceId: 'project:alpha',
      productId: 'cafe24:3001',
      productKey: 'product:alpha',
      runId: 'run-7',
      inputFingerprint: 'sha256:input',
      revision: 9,
      workfileName: 'alpha.kuasangse',
    },
    inputs: [],
    stages: [],
    progress: {
      stageKey: 'sections',
      percent: 76,
      elapsedMs: 12345,
      mode: 'manual',
      status: 'blocked',
    },
    registration: {
      status: 'approval_required',
      blockers: [],
      jobId: 'job-7',
      productId: 'cafe24:3001',
      productKey: 'product:alpha',
      categoryId: '24',
      htmlDigest: 'sha256:html',
      imageDigests: ['sha256:image-a'],
      selling: 'F',
      display: 'F',
      market_sync: 'F',
      idempotencyKey: 'publish-alpha-9',
    },
    ...overrides,
  };
}

test('factory workbench exposes one compact API-driven master-detail surface', () => {
  const html = fs.readFileSync(HTML, 'utf8');

  for (const id of [
    'factory-sync-bar',
    'factory-product-progress',
    'io-progress-map',
    'a-cut-contact-sheet',
    'artifact-inspector',
    'factory-registration-panel',
    'product-list',
    'automation-policy-matrix',
    'automation-policy-summary',
    'work-bundle-input-assets',
    'work-bundle-output-assets',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const rejectedScaffoldId of ['io-overview', 'batch-overview', 'review-list']) {
    assert.doesNotMatch(html, new RegExp(`id=["']${rejectedScaffoldId}["']`));
  }
  assert.match(html, /src=["']\.\/src\/production-workbench\.mjs(?:\?[^"']*)?["']/);
  assert.match(html, /<main\s+class=["']page["']\s+id=["']app["']/);
  assert.match(html, /main\.page\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/s);
  assert.doesNotMatch(html, /(?:factory-sync-workspace|a-cut-contact-sheet|artifact-inspector)[^{]*\{[^}]*(?:overflow-y:\s*(?:auto|scroll)|height:\s*\d+px)/s);
});

test('workbench consumes factory snapshot and SSE and uses only registered BFF command routes', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  for (const route of [
    '/api/factory/state',
    '/api/factory/events',
    '/api/factory/refresh',
    '/api/factory/a-cuts/select',
    '/api/cafe24/preflight',
    '/api/cafe24/staging-preview',
    '/api/cafe24/approve',
    '/api/cafe24/publish',
    '/api/automation/policy',
    '/api/pdp/work-bundles',
  ]) {
    assert.match(source, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(source, /new EventSourceImpl/);
  assert.match(source, /FACTORY_CONTROL_EVENT_VERSION/);
  assert.match(source, /buildACutSelectionCommand/);
  assert.doesNotMatch(source, /\/api\/automation\/decisions/);
  assert.match(source, /decisionMode/);
  assert.match(source, /expectedProjectionCursor/);
  assert.match(source, /loading = 'lazy'|loading = "lazy"/);
  assert.match(source, /CANDIDATE_PAGE_SIZE = 24/);
  assert.doesNotMatch(source, /factoryState|window\.state|app-core-0[56]|localStorage|indexedDB|querySelector\([^)]*factory/i);
  assert.match(source, /stage\s*>\s*product\s*>\s*batch\s*>\s*batch_preset\s*>\s*auto_default/);
  assert.match(source, /data-decision-id/);
  assert.match(source, /effectiveSources/);
  assert.match(source, /control-tower:policy-locked/);
  assert.match(source, /draftDirty/);
  assert.doesNotMatch(source, /automationState\.snapshot\s*=\s*null/);
});

test('work-bundle roles remain explicit and 200 assets render at most 24 per page', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?bundle-page=${Date.now()}`);
  const assets = Array.from({ length: 200 }, (_, index) => ({
    id: `asset-${index}`,
    assetKey: `output:hero:${index}`,
    phase: index === 0 ? 'input' : 'output',
    stage: 'hero',
    role: index === 0 ? 'base' : 'hero',
    displayName: `자산 ${index}`,
    thumbnailReference: `/api/pdp/work-bundles/b/assets/${index}/thumbnail`,
    factoryStageKey: index === 0 ? null : 'representative',
  }));

  const bundle = workbench.normalizeWorkBundle({
    id: 'bundle-a',
    bundleKey: 'kuasangse:product-a',
    assets,
  });
  const first = workbench.workBundleAssetPage(bundle, 'output', 0);
  const last = workbench.workBundleAssetPage(bundle, 'output', 99);

  assert.equal(bundle.assets[0].role, 'base');
  assert.equal(first.total, 199);
  assert.equal(first.items.length, 24);
  assert.equal(last.page, 8);
  assert.equal(last.items.length, 7);
});

test('output stage state stays disconnected even when a stale snapshot still has stage rows', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?stage-state=${Date.now()}`);
  assert.deepEqual(
    workbench.factoryStageUiState({ selectedId: '', candidates: [] }, false),
    { state: 'disconnected', candidateCount: 0 },
  );
});

test('factory connectivity keeps a live status stream separate from a disconnected worker session', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?connectivity=${Date.now()}`);
  const heartbeatTimeout = workbench.projectFactoryConnectivity(
    projection({
      connected: false,
      status: 'blocked',
      blockReason: 'factory_heartbeat_timeout',
      capturedAt: '2026-07-31T01:23:45.000Z',
    }),
    { transport: 'live', lastEventAt: '2026-07-31T01:24:00.000Z' },
  );
  assert.equal(heartbeatTimeout.transportLabel, '상태 스트림 연결됨');
  assert.equal(heartbeatTimeout.factoryLabel, '조립공장 연결 끊김');
  assert.match(heartbeatTimeout.detail, /heartbeat 응답 시간 초과/);
  assert.equal(heartbeatTimeout.tone, 'error');

  const connected = workbench.projectFactoryConnectivity(projection(), { transport: 'live' });
  assert.equal(connected.factoryLabel, '조립공장 연결됨');

  const streamOnly = workbench.projectFactoryConnectivity(
    projection({ connected: false, reason: 'factory.session.disconnected' }),
    { transport: 'live' },
  );
  assert.equal(streamOnly.transportLabel, '상태 스트림 연결됨');
  assert.equal(streamOnly.factoryLabel, '조립공장 연결 끊김');

  const apiUnavailable = workbench.projectFactoryConnectivity(
    projection({ connected: false }),
    { transport: 'reconnecting', apiError: 'HTTP_503' },
  );
  assert.equal(apiUnavailable.factoryLabel, '생산관제 서버 오류');
  assert.match(apiUnavailable.detail, /상태 조회 실패/);

  const disconnectedEvent = workbench.applyFactorySseMessage(projection(), '89', {
    lastEventId: '90',
    data: JSON.stringify({
      type: 'factory.session.disconnected',
      blockReason: 'factory_heartbeat_timeout',
      occurredAt: '2026-07-31T01:24:00.000Z',
    }),
  });
  assert.equal(disconnectedEvent.projection.connected, false);
  assert.equal(disconnectedEvent.projection.reason, 'factory_heartbeat_timeout');
  assert.equal(disconnectedEvent.factoryEventCursor, '90');
});

test('candidate thumbnail projection uses a placeholder for empty and invalid URLs', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?thumbnail-state=${Date.now()}`);
  assert.deepEqual(workbench.resolveCandidateThumbnail({}), { kind: 'placeholder', url: '' });
  assert.deepEqual(
    workbench.resolveCandidateThumbnail({ thumbnailUrl: 'http://[invalid-thumbnail' }),
    { kind: 'placeholder', url: '' },
  );
  assert.deepEqual(
    workbench.resolveCandidateThumbnail({ thumbnailUrl: '/api/assets/thumb.webp' }, value => `https://qa.local${value}`),
    { kind: 'image', url: 'https://qa.local/api/assets/thumb.webp' },
  );
});

test('Cafe24 staging payload binds actual factory identity and F/F/F defaults', async () => {
  const moduleUrl = `${pathToFileURL(MODULE).href}?test=${Date.now()}-${Math.random()}`;
  const { buildCafe24StagingPayload } = await import(moduleUrl);

  assert.deepEqual(buildCafe24StagingPayload(projection()), {
    batchId: 'project:alpha',
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    categoryId: '24',
    htmlDigest: 'sha256:html',
    imageDigests: ['sha256:image-a'],
    expectedWorkfileRevision: 9,
    expectedRunId: 'run-7',
    expectedInputFingerprint: 'sha256:input',
    idempotencyKey: 'publish-alpha-9',
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  });
});

test('Cafe24 staging stays blocked while a factory blocker or disconnected session remains', async () => {
  const moduleUrl = `${pathToFileURL(MODULE).href}?test=${Date.now()}-${Math.random()}`;
  const { buildCafe24StagingPayload } = await import(moduleUrl);

  assert.throws(
    () => buildCafe24StagingPayload(projection({
      registration: { ...projection().registration, blockers: ['final_detail_a_cut'] },
    })),
    error => error.code === 'cafe24_preflight_blocked',
  );
  assert.throws(
    () => buildCafe24StagingPayload(projection({ connected: false })),
    error => error.code === 'factory_session_missing',
  );
});

test('registration execution requires one-time approval, target checkbox and a final confirmation', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(source, /!approval\.token \|\| !confirmInput\.checked/);
  assert.equal(
    (source.match(/execute\.disabled = !approval\.token \|\| !confirmInput\.checked \|\| !text\(registration\.jobId\)/g) || []).length,
    2,
  );
  assert.match(source, /window\.confirm\(/);
  assert.match(source, /approvalBinding\(approval\.preview\)/);
  assert.match(source, /approvalRequestId/);
  assert.doesNotMatch(source, /approvalToken[^]*textContent\s*=/);
});
