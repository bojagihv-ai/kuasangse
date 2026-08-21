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
      categoryLabel: '전통공예품 > 일반공예품 > 기타공예용품',
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
    'workfile-report-ledger',
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
  assert.match(html, /production-workbench\.mjs\?[^"']*imageLoading=1/);
  assert.match(html, /<main\s+class=["']page["']\s+id=["']app["']/);
  assert.match(html, /main\.page\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/s);
  assert.match(html, /const API_BASE = localOrigin\("apiBase", "http:\/\/127\.0\.0\.1:5062"\)/);
  assert.match(html, /const FACTORY_BACKEND = localOrigin\("factoryBackend", "http:\/\/127\.0\.0\.1:5050"\)/);
  assert.match(html, /source\.startsWith\("\/api\/local-archive\/"\) \? FACTORY_BACKEND : API_BASE/);
  assert.doesNotMatch(html, /(?:factory-sync-workspace|a-cut-contact-sheet|artifact-inspector)[^{]*\{[^}]*(?:overflow-y:\s*(?:auto|scroll)|height:\s*\d+px)/s);
});

test('Cafe24 영수증과 연결된 작업파일 이름을 한 묶음으로 만든다', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?handoff=${Date.now()}`);
  const current = projection();
  const receipt = {
    schema: 'factory-cafe24-terminal-publication-receipt:v1',
    receiptId: 'receipt-alpha',
    jobId: 'job-7',
    productName: '방울수저집',
    remoteProductNo: '3000',
    productCode: 'P00000ALPHA',
    sourceWorkfileName: '방울수저집.kuasangse',
    mallId: 'bojagi1928',
    variantCount: 4,
  };
  current.registration.publicationReceipt = receipt;

  const ledger = workbench.buildWorkfilePublicationLedger(current, receipt);

  assert.equal(ledger.workfileName, '방울수저집.kuasangse');
  assert.equal(ledger.workfileSource, 'Cafe24 등록 영수증에 기록된 파일명');
  assert.equal(ledger.workfileExact, true);
  assert.equal(ledger.publication.productNo, '3000');
  assert.equal(ledger.publications.length, 1);
  assert.match(ledger.publication.storefrontUrl, /product_no=3000/);
  assert.match(ledger.creationMode, /자동 새 작업 생성 기록 없음/);
});

test('workbench consumes factory snapshot and SSE and uses only registered BFF command routes', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  for (const route of [
    '/api/factory/state',
    '/api/factory/events',
    '/api/factory/refresh',
    '/api/factory/a-cuts/select',
    '/api/factory/jobs',
    '/api/cafe24/preflight',
    '/api/cafe24/staging-preview',
    '/api/cafe24/approve',
    '/api/cafe24/confirm',
    '/api/cafe24/publish',
    '/api/cafe24/reconcile',
    '/api/automation/policy',
    '/api/pdp/work-bundles',
  ]) {
    assert.match(source, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(source, /new EventSourceImpl/);
  assert.match(source, /confirmed:\s*true/);
  assert.match(source, /confirmationNonce:\s*confirmation\.confirmationNonce/);
  assert.match(source, /등록 결과 재확인 · 재등록 없음/);
  assert.match(source, /FACTORY_CONTROL_EVENT_VERSION/);
  assert.match(source, /buildACutSelectionCommand/);
  assert.match(source, /projection = reconcileFactoryProjectionForSameWork\(projection, nextValue\);/);
  assert.doesNotMatch(source, /\/api\/automation\/decisions/);
  assert.match(source, /decisionMode/);
  assert.match(source, /expectedProjectionCursor/);
  assert.doesNotMatch(source, /image\.loading = ['"]lazy['"]/);
  assert.equal(
    (source.match(/image\.loading = ['"]eager['"]/g) || []).length,
    3,
    '생산관제의 이력·경쟁사·A컷 썸네일은 내부 스크롤에서 지연 로드되면 안 됩니다.',
  );
  assert.match(source, /CANDIDATE_PAGE_SIZE = 24/);
  assert.doesNotMatch(source, /factoryState|window\.state|app-core-0[56]|localStorage|indexedDB|querySelector\([^)]*factory/i);
  assert.match(source, /단계 → 제품 → 생산 묶음 순서로 적용됩니다/);
  assert.doesNotMatch(source, /stage\s*>\s*product\s*>\s*batch\s*>\s*batch_preset\s*>\s*auto_default/);
  assert.match(source, /data-decision-id/);
  assert.match(source, /effectiveSources/);
  assert.match(source, /control-tower:policy-locked/);
  assert.match(source, /draftDirty/);
  assert.doesNotMatch(source, /automationState\.snapshot\s*=\s*null/);
  assert.match(
    source,
    /reconnect\.addEventListener\('click', \(\) => \{\s*connectEvents\(true\);\s*void Promise\.allSettled\(\[refreshState\(\), refreshQueue\(\)\]\)/,
    '수동 재연결은 projection과 durable 제품 큐를 함께 다시 읽어야 합니다.',
  );
  assert.match(
    source,
    /async function refreshQueue\(\)[\s\S]*?\n    render\(\);/,
    '제품 큐 상태는 대기열뿐 아니라 NOW/NEXT와 단계 요약도 함께 다시 그려야 합니다.',
  );
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

test('history output stage page filters archived assets by the selected production stage', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?history-stage-page=${Date.now()}`);
  const bundle = workbench.normalizeWorkBundle({
    id: 'bundle-history',
    assets: [
      { id: 'size-1', phase: 'output', role: 'size', factoryStageKey: 'size' },
      { id: 'section-1', phase: 'output', role: 'section', factoryStageKey: 'sections' },
    ],
  });

  const sections = workbench.workBundleAssetPage(bundle, 'output', 0, 'sections');

  assert.equal(sections.total, 1);
  assert.equal(sections.items[0].id, 'section-1');
});

test('history section assets group into the detail-page production order', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?section-order=${Date.now()}`);
  const groups = workbench.groupWorkBundleSectionAssets([
    { id: 'faq', displayName: '020655_FAQ_(자주_묻는_질문)_섹션_결과' },
    { id: 'hook-earlier', displayName: '015312_훅_(Hook)_섹션_결과' },
    { id: 'header', displayName: '015144_헤더_(Header)_섹션_결과' },
    { id: 'hook-later', displayName: '070026_훅_(Hook)_섹션_결과' },
  ]);

  assert.deepEqual(groups.map(group => group.key), ['header', 'hook', 'faq']);
  assert.equal(groups[1].label, '훅 사진');
  assert.equal(groups[1].assets.length, 2);
  assert.equal(groups[1].latest.id, 'hook-later');
});

test('history section grouping keeps the canonical detailed-page order through CTA footer', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?canonical-section-order=${Date.now()}`);
  const groups = workbench.groupWorkBundleSectionAssets([
    { id: 'footer', displayName: 'CTA_푸터_(Footer)_섹션_결과' },
    { id: 'brand', displayName: '브랜드_스토리_섹션_결과' },
    { id: 'size-color', displayName: '섹션 size_color' },
    { id: 'certification', displayName: '인증_수상_(Certifications)_섹션_결과' },
    { id: 'specification', displayName: '섹션 specifications' },
  ]);

  assert.deepEqual(groups.map(group => group.key), [
    'specifications',
    'certifications',
    'size_color',
    'brand_story',
    'cta_footer',
  ]);
  assert.equal(groups.at(-1).label, 'CTA 푸터');
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

  const waitingJob = { jobId: 'job-7', status: 'waiting_manual', stageKey: 'general' };
  const jobEvent = workbench.applyFactorySseMessage(projection(), '90', {
    lastEventId: '91',
    data: JSON.stringify({ type: 'factory.product.updated', job: waitingJob }),
  });
  assert.deepEqual(jobEvent.job, waitingJob);
  const reboundJob = { jobId: 'job-7', status: 'blocked', stageKey: 'general', checkpointAvailable: true };
  const reboundEvent = workbench.applyFactorySseMessage(projection(), '91', {
    lastEventId: '92',
    data: JSON.stringify({ type: 'factory.product.checkpoint.rebound', job: reboundJob }),
  });
  assert.deepEqual(reboundEvent.job, reboundJob);
  assert.equal(reboundEvent.factoryEventCursor, '92');
  assert.throws(
    () => workbench.applyFactorySseMessage(projection(), '91', {
      lastEventId: '90',
      data: JSON.stringify({
        type: 'factory.product.updated',
        job: { ...waitingJob, status: 'queued' },
      }),
    }),
    error => error?.code === 'stale_factory_event_id',
  );
});

test('transient state refresh failure keeps a usable production projection visible', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?state-refresh-degraded=${Date.now()}`);
  const retained = workbench.projectFactoryConnectivity(
    projection({ stages: [] }),
    { transport: 'reconnecting', apiError: 'HTTP_409' },
  );

  assert.equal(retained.state, 'degraded');
  assert.equal(retained.tone, 'warn');
  assert.match(retained.detail, /마지막 정상 상태/);

  const source = fs.readFileSync(MODULE, 'utf8');
  assert.match(
    source,
    /async function refreshState\(\) \{[\s\S]*?catch \(error\) \{[\s\S]*?if \(!projection\.connected\) setProjection\(disconnectedFactoryProjection/,
  );
});

test('cold state rejection keeps blocked durable Product B in the degraded queue detail', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?cold-state-degraded-queue=${Date.now()}`);
  const productB = {
    jobId: 'factory-job-a66111b339304b5ab3f2b8de4fedf751',
    status: 'blocked',
    stageKey: 'representative',
    productName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817',
    message: 'factory_product_checkpoint_save_failed: 작업 저장 실패: server persistence rejected (409)',
    checkpointAvailable: true,
    workfileName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817.kuasangse',
    selections: { representative: 'representative-b' },
    candidates: [{ id: 'representative-b' }],
  };
  const [stateResult, queueResult] = await Promise.allSettled([
    Promise.reject(Object.assign(new Error('HTTP_409'), { code: 'HTTP_409' })),
    Promise.resolve({ jobs: [productB] }),
  ]);
  assert.equal(stateResult.status, 'rejected');
  assert.equal(queueResult.status, 'fulfilled');

  const coldProjection = workbench.disconnectedFactoryProjection(stateResult.reason.code);
  const connectivity = workbench.projectFactoryConnectivity(coldProjection, {
    transport: 'reconnecting',
    apiError: stateResult.reason.code,
    hasDurableQueue: true,
  });
  assert.equal(connectivity.state, 'degraded');
  assert.equal(connectivity.tone, 'warn');
  assert.match(connectivity.detail, /작업 큐.*유지/);

  const model = workbench.projectFactoryQueueRenderModel(coldProjection, queueResult.value.jobs, {
    transport: 'reconnecting',
    apiError: stateResult.reason.code,
  });
  assert.deepEqual(model.queue, [productB]);
  assert.equal(model.detail.root, 'operator-queue-selection');
  assert.equal(model.detail.status, 'blocked');
  assert.equal(model.detail.job.jobId, productB.jobId);
  assert.equal(model.detail.job.workfileName, productB.workfileName);
  assert.deepEqual(model.detail.job.selections, productB.selections);
  assert.deepEqual(model.detail.job.candidates, productB.candidates);
  assert.match(model.detail.copy, /상태 조회 실패/);
  assert.doesNotMatch(model.detail.copy, /연결됨|정상/);
});

test('ambiguous disconnected queue does not invent the first blocked product as current', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?ambiguous-disconnected-queue=${Date.now()}`);
  const disconnected = workbench.disconnectedFactoryProjection('factory.session.disconnected');
  const jobs = [
    { jobId: 'factory-job-a', productName: '자동화검증 자수 수저파우치 A 20260817', status: 'blocked', stageKey: 'representative' },
    { jobId: 'factory-job-b', productName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817', status: 'blocked', stageKey: 'option_color' },
  ];

  const model = workbench.projectFactoryQueueRenderModel(disconnected, jobs);

  assert.equal(model.activeJob, null);
  assert.equal(model.detail, null);
  assert.equal(workbench.currentFactoryProductLabel(disconnected, model.activeJob), '');
});

test('live Product B keeps its blocked option-color queue selection', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?live-b-baseline=${Date.now()}`);
  const productB = {
    jobId: 'factory-job-a66111b339304b5ab3f2b8de4fedf751',
    productName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817',
    status: 'blocked',
    stageKey: 'option_color',
    message: '색상옵션 값을 찾지 못했습니다.',
  };
  const current = projection({
    session: {
      ...projection().session,
      productKey: '수동a컷검증미니데스크오거나이저b20260817',
    },
    registration: { ...projection().registration, jobId: productB.jobId },
    progress: { ...projection().progress, status: 'blocked', stageKey: 'options' },
    stages: [
      { key: 'representative', status: 'done', selectedId: 'factory_hero_msx3fn23_1x5pej', candidates: [{ id: 'factory_hero_msx3fn23_1x5pej' }] },
      { key: 'size', status: 'done', selectedId: 'factory_size_msxcctca_e6wrpn', candidates: [{ id: 'factory_size_msxcctca_e6wrpn' }] },
      { key: 'option_color', status: 'blocked', candidates: [] },
    ],
  });

  const model = workbench.projectFactoryQueueRenderModel(current, [productB]);
  assert.equal(model.activeJob.jobId, productB.jobId);
  assert.equal(model.activeJob.stageKey, 'option_color');
  assert.equal(model.queue[0].message, productB.message);
});

test('current product resolver keeps an existing valid session product', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?current-product-baseline=${Date.now()}`);
  const current = projection();

  assert.equal(workbench.currentFactoryProductLabel(current.session, { status: 'blocked', stageKey: 'option_color' }), 'product:alpha');
});

test('current product resolver keeps Product B from a blocked option-color state response', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?current-product-b-state=${Date.now()}`);
  const productBKey = '수동a컷검증미니데스크오거나이저b20260817';
  const productBJob = {
    jobId: 'factory-job-a66111b339304b5ab3f2b8de4fedf751',
    status: 'blocked',
    stageKey: 'option_color',
  };
  const state = projection({
    session: { ...projection().session, productKey: '' },
    registration: { ...projection().registration, jobId: productBJob.jobId, productKey: productBKey },
    stages: [
      { key: 'representative', status: 'done', selectedId: 'factory_hero_msx3fn23_1x5pej', candidates: [{ id: 'factory_hero_msx3fn23_1x5pej' }] },
      { key: 'size', status: 'done', selectedId: 'factory_size_msxcctca_e6wrpn', candidates: [{ id: 'factory_size_msxcctca_e6wrpn' }] },
      { key: 'option_color', status: 'blocked', candidates: [] },
    ],
  });
  const model = workbench.projectFactoryQueueRenderModel(state, [productBJob]);

  assert.equal(model.activeJob.stageKey, 'option_color');
  assert.equal(workbench.currentFactoryProductLabel(state, model.activeJob), productBKey);
});

test('thin live session retains Product B name from its blocked option-color queue job', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?live-b-thin-session=${Date.now()}`);
  const productB = {
    jobId: 'factory-job-a66111b339304b5ab3f2b8de4fedf751',
    productName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817',
    status: 'blocked',
    stageKey: 'option_color',
    message: '색상옵션 값을 찾지 못했습니다.',
  };
  const thin = projection({
    session: null,
    registration: { ...projection().registration, jobId: productB.jobId },
    stages: [
      { key: 'representative', status: 'done', selectedId: 'factory_hero_msx3fn23_1x5pej', candidates: [{ id: 'factory_hero_msx3fn23_1x5pej' }] },
      { key: 'size', status: 'done', selectedId: 'factory_size_msxcctca_e6wrpn', candidates: [{ id: 'factory_size_msxcctca_e6wrpn' }] },
      { key: 'option_color', status: 'blocked', candidates: [] },
    ],
  });

  const model = workbench.projectFactoryQueueRenderModel(thin, [productB]);
  assert.equal(workbench.currentFactoryProductLabel(thin.session, model.activeJob), productB.productName);
});

test('malformed cold-state queue entries do not fabricate a durable operator detail', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?malformed-durable-queue=${Date.now()}`);
  const coldProjection = workbench.disconnectedFactoryProjection('HTTP_409');
  const options = { transport: 'reconnecting', apiError: 'HTTP_409' };

  const objectJobId = workbench.projectFactoryQueueRenderModel(coldProjection, [{ jobId: {} }], options);
  assert.deepEqual(objectJobId.queue, [], 'object jobId must not be string-coerced into durable queue data');
  assert.equal(objectJobId.activeJob, null);
  assert.equal(objectJobId.detail, null);
  assert.equal(objectJobId.connectivity.state, 'backend-error');

  const malformed = workbench.projectFactoryQueueRenderModel(coldProjection, [{}], options);
  assert.deepEqual(malformed.queue, []);
  assert.equal(malformed.activeJob, null);
  assert.equal(malformed.detail, null);
  assert.equal(malformed.connectivity.state, 'backend-error');

  const empty = workbench.projectFactoryQueueRenderModel(coldProjection, [], options);
  assert.deepEqual(empty.queue, []);
  assert.equal(empty.activeJob, null);
  assert.equal(empty.detail, null);
  assert.equal(empty.connectivity.state, 'backend-error');
});

test('mutating request retries once after canonical CSRF reacquisition', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?csrf-retry=${Date.now()}`);
  const csrfRequired = Object.assign(new Error('csrf_required'), { status: 428, code: 'csrf_required' });
  let initialAttempts = 0;
  const requests = [];
  const request = workbench.createCsrfRetryingApiRequest({
    apiRequest: async () => {
      initialAttempts += 1;
      throw csrfRequired;
    },
    assetUrl: value => `https://control.test${value}`,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/api/session')) return { ok: true, json: async () => ({ sessionId: 'fresh-session', csrfToken: 'fresh-csrf' }) };
      return { ok: true, json: async () => ({ accepted: true }) };
    },
  });

  assert.deepEqual(await request('/api/factory/refresh', { method: 'POST', body: '{}' }), { accepted: true });
  assert.equal(initialAttempts, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://control.test/api/session');
  assert.equal(requests[1].url, 'https://control.test/api/factory/refresh');
  assert.equal(requests[1].options.headers['X-Control-Tower-Session'], 'fresh-session');
  assert.equal(requests[1].options.headers['X-Control-Tower-CSRF'], 'fresh-csrf');
});

test('mutating request stops after one CSRF retry and EventSource refreshes coalesce', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?csrf-bounded=${Date.now()}`);
  const csrfRequired = Object.assign(new Error('csrf_required'), { status: 428, code: 'csrf_required' });
  let initialAttempts = 0;
  let retryAttempts = 0;
  const request = workbench.createCsrfRetryingApiRequest({
    apiRequest: async () => {
      initialAttempts += 1;
      throw csrfRequired;
    },
    assetUrl: value => `https://control.test${value}`,
    fetchImpl: async url => {
      if (url.endsWith('/api/session')) return { ok: true, json: async () => ({ sessionId: 'fresh-session', csrfToken: 'fresh-csrf' }) };
      retryAttempts += 1;
      return { ok: false, status: 428, json: async () => ({ error: { code: 'csrf_required' } }) };
    },
  });

  await assert.rejects(() => request('/api/factory/refresh', { method: 'POST', body: '{}' }), error => error.status === 428 && error.code === 'csrf_required');
  assert.equal(initialAttempts, 1);
  assert.equal(retryAttempts, 1);

  let refreshCalls = 0;
  let releaseRefresh;
  const refresh = workbench.coalesceRefreshState(() => {
    refreshCalls += 1;
    return new Promise(resolve => { releaseRefresh = resolve; });
  });
  const first = refresh();
  const second = refresh();
  assert.strictEqual(first, second);
  assert.equal(refreshCalls, 1);
  releaseRefresh();
  await first;
  const third = refresh();
  assert.equal(refreshCalls, 2);
  releaseRefresh();
  await third;

  const source = fs.readFileSync(MODULE, 'utf8');
  assert.match(source, /const refreshAfterEventError = coalesceRefreshState\(refreshState\);/);
  assert.match(source, /eventSource\.onerror = \(\) => \{\s*syncTransport = 'reconnecting';\s*void recoverEventStream\(\);/);
});

test('EventSource recovery renews the control session before reconnecting', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?event-session-recovery=${Date.now()}`);
  const calls = [];
  const session = await workbench.acquireControlSession({
    assetUrl: value => `https://control.test${value}`,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ sessionId: 'renewed-session', csrfToken: 'renewed-csrf' }) };
    },
  });

  assert.deepEqual(session, { sessionId: 'renewed-session', csrfToken: 'renewed-csrf' });
  assert.equal(calls[0].url, 'https://control.test/api/session');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.cache, 'no-store');

  const source = fs.readFileSync(MODULE, 'utf8');
  assert.match(source, /const recoverEventStream = coalesceRefreshState\(async \(\) => \{[\s\S]*?await acquireControlSession\([\s\S]*?await refreshAfterEventError\(\);[\s\S]*?connectEvents\(true\);/);
  assert.match(source, /eventSource\.onerror = \(\) => \{\s*syncTransport = 'reconnecting';\s*void recoverEventStream\(\);/);
});

test('connected factory without a product does not render a phantom queue row', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?queue-empty=${Date.now()}`);
  const empty = projection({
    session: {
      workspaceId: '',
      productId: '',
      productKey: '',
      runId: '',
      inputFingerprint: '',
      revision: 0,
      workfileName: '',
    },
    products: [],
  });

  assert.deepEqual(workbench.projectQueueProducts(empty), []);
  assert.equal(workbench.projectQueueProducts(projection())[0].productKey, 'product:alpha');
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
  const current = projection();
  current.registration.expectedWorkfileRevision = 8;

  assert.deepEqual(buildCafe24StagingPayload(current), {
    batchId: 'project:alpha',
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    categoryId: '24',
    htmlDigest: 'sha256:html',
    imageDigests: ['sha256:image-a'],
    expectedWorkfileRevision: 8,
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

test('registration execution preserves the target checkbox across refreshes and requires server confirmation nonce', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(source, /let registrationTargetConfirmed = false/);
  assert.match(source, /let registrationRenderKey = ''/);
  assert.match(source, /if \(root\.childElementCount && registrationRenderKey === nextRenderKey\) return/);
  assert.match(source, /confirmInput\.checked = registrationTargetConfirmed/);
  assert.match(source, /registrationTargetConfirmed = confirmInput\.checked/);
  assert.match(source, /!approval\.token \|\| !registrationTargetConfirmed/);
  assert.equal(
    (source.match(/execute\.disabled = !approval\.token \|\| !registrationTargetConfirmed \|\| !text\(registration\.jobId\)/g) || []).length,
    2,
  );
  assert.ok((source.match(/registrationTargetConfirmed = false/g) || []).length >= 4);
  assert.doesNotMatch(source, /window\.confirm\(/);
  assert.match(source, /confirmed:\s*true/);
  assert.match(source, /confirmationNonce:\s*confirmation\.confirmationNonce/);
  assert.match(source, /approvalBinding\(approval\.preview\)/);
  assert.match(source, /approvalRequestId/);
  assert.doesNotMatch(source, /approvalToken[^]*textContent\s*=/);
});

test('operator queue does not replace a focused action while the user activates it', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(source, /function renderQueue\(\) \{[\s\S]*if \(root\.contains\(document\.activeElement\)\) return;[\s\S]*root\.replaceChildren\(\)/);
});

test('operator queue refreshes after a focused resume action settles', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(
    source,
    /async function resumeFactoryJob\(jobId\) \{[\s\S]*finally \{[\s\S]*roots\.queue\?\.contains\(document\.activeElement\)[\s\S]*document\.activeElement\.blur\(\)[\s\S]*await Promise\.allSettled\(\[refreshState\(\), refreshQueue\(\)\]\);/,
  );
});

test('Cafe24 상품분류는 생산관제에서 숫자 코드 대신 조립공장 한글명을 표시한다', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(html, /label for="required-category">상품 종류 \*/);
  assert.match(source, /labelledValue\('Cafe24 상품분류', registration\.categoryLabel \|\| registration\.categoryId/);
  assert.match(source, /category_id: 'Cafe24 상품분류를 확인해 주세요\.'/);
});

test('Cafe24 등록 대상은 조립공장 update 모드를 기존 상품 수정으로 표시한다', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?registration-mode=${Date.now()}`);
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(source, /labelledValue\('Cafe24 등록 방식', cafe24RegistrationLabel/);
  assert.equal(
    workbench.cafe24RegistrationTargetLabel({ mode: 'update', productId: 'cafe24:3011' }, {}),
    '기존 상품 #3011 수정',
  );
  assert.equal(
    workbench.cafe24RegistrationTargetLabel({ mode: 'create', productId: 'cafe24:2994' }, {}),
    '새 상품 등록 · 참고 상품 #2994',
  );
  assert.doesNotMatch(source, /labelledValue\('Cafe24 대상'/);
});

test('waiting manual product rows normalize worker selectedIds and open candidates before resume', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?selected-ids=${Date.now()}`);
  const source = fs.readFileSync(MODULE, 'utf8');
  const normalized = workbench.normalizeFactoryProjection(projection({
    stages: [{
      key: 'representative',
      status: 'waiting_manual',
      selectedIds: ['representative-b'],
      candidates: [{ id: 'representative-a' }, { id: 'representative-b' }],
    }],
  }));
  assert.equal(normalized.stages[0].selectedId, 'representative-b');
  assert.equal(workbench.waitingManualJobAction({ mode: 'manual' }, normalized.stages[0]), 'resume');
  assert.equal(workbench.waitingManualJobAction({ mode: 'manual' }, { ...normalized.stages[0], selectedId: '' }), 'open');
  assert.equal(workbench.waitingManualJobAction({ mode: 'auto' }, normalized.stages[0]), 'resume');
  assert.match(source, /localJob\?\.status === 'waiting_manual'[\s\S]*?return resumeFactoryJob\(jobId\)/);
  assert.match(source, /if \(job\.status === 'waiting_manual'\) \{[\s\S]*jobId === projectionJobId[\s\S]*waitingManualJobAction\(job, stage\)/);
  assert.doesNotMatch(source, /job\.status === 'waiting_manual'[\s\S]{0,800}job\.checkpointAvailable[\s\S]{0,800}resumeFactoryJob\(job\.jobId\)/);
  assert.match(source, /job\.status === 'completed' && job\.checkpointAvailable/);
});

test('local manual factory jobs override global auto and allow their projection candidates', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?local-job-mode=${Date.now()}`);
  const localProjection = projection({ registration: { ...projection().registration, jobId: 'factory-job-manual' } });

  assert.equal(workbench.resolveLocalFactoryJobMode(localProjection, [
    { jobId: 'factory-job-manual', mode: 'manual' },
  ]), 'manual');
  assert.equal(workbench.resolveLocalFactoryJobMode(localProjection, [
    { jobId: 'factory-job-manual', mode: 'auto' },
  ]), 'auto');
});

test('manual A-cut policy list tolerates a live projection before its queue row arrives', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?manual-policy-list=${Date.now()}`);

  assert.deepEqual(workbench.manualACutDecisionIds({}), []);
  assert.deepEqual(workbench.manualACutDecisionIds({
    policy: { resolved: { representative_image: 'manual', size_image: 'auto', competitor_product: 'manual' } },
  }), ['representative_image']);
});

test('candidate cards expose a direct manual A-cut action without sending the user through the inspector', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(source, /select\.dataset\.action = 'select-a-cut-direct'/);
  assert.match(source, /select\.addEventListener\('click', \(\) => void selectACut\(stage, candidate\)\)/);
});

test('local factory jobs keep their locked decision mode for each A-cut stage', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?local-stage-policy=${Date.now()}`);
  const localProjection = projection({ registration: { ...projection().registration, jobId: 'factory-job-mixed' } });
  const jobs = [{
    jobId: 'factory-job-mixed',
    mode: 'auto',
    policy: { resolved: { representative_image: 'manual', size_image: 'auto' } },
  }];

  assert.equal(workbench.resolveLocalFactoryStageMode(localProjection, jobs, 'representative'), 'manual');
  assert.equal(workbench.resolveLocalFactoryStageMode(localProjection, jobs, 'size'), 'auto');
});

test('local automatic selection submits only at the waiting_manual boundary', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?local-auto-selection-status=${Date.now()}`);
  const localProjection = workbench.normalizeFactoryProjection(projection({
    registration: { ...projection().registration, jobId: 'factory-job-task-16' },
    stages: [{
      key: 'size',
      status: 'waiting_manual',
      selectedId: '',
      candidates: [{ id: 'size-auto-candidate' }],
    }],
  }));
  const submitCalls = [];
  const scheduler = workbench.createAutomaticSelectionScheduler({
    submit: async (stage, mode) => {
      submitCalls.push({ stage: stage.key, mode });
      return { selectedId: stage.candidates[0].id };
    },
  });
  const schedule = status => scheduler({
    projection: localProjection,
    workBundle: {},
    policySnapshot: { locked: true },
    localJob: {
      jobId: 'factory-job-task-16',
      status,
      stageKey: 'size',
      policy: { resolved: { representative_image: 'manual', size_image: 'auto' } },
    },
    isAutomatic: stage => stage.key === 'size',
  });

  for (const status of ['blocked', 'running', 'queued', 'completed', undefined, 'unrecognized']) {
    await schedule(status);
  }
  assert.equal(submitCalls.length, 0, 'blocked/non-waiting local jobs must not submit automatic selections');

  await schedule('waiting_manual');
  assert.deepEqual(submitCalls, [{ stage: 'size', mode: 'auto' }]);
});

test('in-flight factory jobs without a policy still render their active A-cut stage', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?inflight-empty-policy=${Date.now()}`);
  const localProjection = projection({ registration: { ...projection().registration, jobId: 'factory-job-inflight' } });

  assert.doesNotThrow(() => workbench.resolveLocalFactoryStageMode(localProjection, [
    { jobId: 'factory-job-inflight', mode: 'auto' },
  ], 'representative'));
  assert.equal(workbench.resolveLocalFactoryStageMode(localProjection, [
    { jobId: 'factory-job-inflight', mode: 'auto' },
  ], 'representative'), 'auto');
});

test('completed automatic jobs reopen candidate review as an explicit manual selection', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(
    source,
    /const automaticHeld = automatic && \(localJob\?\.status === 'completed' \|\| automaticDecisionHeld\(localJob, stage\.key\)\)/,
  );
});

test('completed result action opens the production A-cut workspace', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(
    source,
    /async function loadHistoricalWorkBundle\(jobId\) \{[\s\S]*?openMenu\('production-acut'\)/,
  );
});
