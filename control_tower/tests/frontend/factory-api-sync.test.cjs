const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const modelUrl = pathToFileURL(path.join(
  ROOT,
  'control_tower',
  'frontend',
  'src',
  'factory-sync-model.mjs',
)).href;
const bridgeUrl = pathToFileURL(path.join(
  ROOT,
  'src',
  'modules',
  'factory-control-command-bridge.mjs',
)).href;

function snapshot(overrides = {}) {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '41',
    sequence: 41,
    connected: true,
    capturedAt: '2026-07-26T10:00:00+09:00',
    session: {
      workspaceId: 'project:alpha',
      productId: 'cafe24:3001',
      productKey: 'product:alpha',
      runId: 'run-7',
      inputFingerprint: 'sha256:input',
      revision: 9,
      workfileName: 'alpha.kuasangse',
    },
    inputs: [
      { key: 'product', count: 1, missing: [] },
      { key: 'requirements', count: 8, missing: [] },
      { key: 'source_images', count: 4, missing: [] },
      { key: 'strategy', count: 1, missing: [] },
    ],
    stages: [
      stage('representative', 'hero-a', 2),
      stage('size', 'size-a', 2),
      stage('option_color', 'option-a', 2),
      stage('general', 'general-a', 2),
      stage('sections', 'section-a', 2),
      stage('final_detail', 'detail-a', 2),
    ],
    progress: {
      stageKey: 'sections',
      percent: 76,
      elapsedMs: 12345,
      mode: 'manual',
      status: 'blocked',
    },
    registration: {
      status: 'approval_required',
      blockers: ['approval_token'],
      categoryId: '24',
      htmlDigest: 'sha256:html',
      imageDigests: ['sha256:image-a'],
      selling: 'F',
      display: 'F',
      market_sync: 'F',
      idempotencyKey: 'publish-alpha-9',
      approvalTokenState: 'missing',
      remoteReadbackDigest: '',
      publicationReceipt: null,
    },
    ...overrides,
  };
}

function stage(key, selectedId, count) {
  const candidateIds = Array.from({ length: count }, (_, index) => (
    `${key}-${String.fromCharCode(97 + index)}`
  ));
  if (!candidateIds.includes(selectedId)) candidateIds[0] = selectedId;
  return {
    key,
    status: 'waiting_manual',
    selectedId,
    updatedAt: '2026-07-26T10:00:00+09:00',
    candidates: candidateIds.map((id, index) => ({
      id,
      assetId: `asset:${key}:${index}`,
      thumbnailUrl: `/api/assets/thumb/${key}-${index}`,
      digest: `sha256:${key}-${index}`,
      source: 'factory',
      model: 'image-model',
      confidence: 0.8,
      rationale: 'fixture',
    })),
  };
}

test('initial factory projection preserves actual groups, stage candidates and selected ids', async () => {
  const { normalizeFactoryProjection } = await import(`${modelUrl}?t=${Date.now()}`);
  const result = normalizeFactoryProjection(snapshot());
  assert.deepEqual(result.inputs.map(item => item.key), [
    'product',
    'requirements',
    'source_images',
    'strategy',
  ]);
  assert.deepEqual(result.stages.map(item => [item.key, item.candidates.length, item.selectedId]), [
    ['representative', 2, 'hero-a'],
    ['size', 2, 'size-a'],
    ['option_color', 2, 'option-a'],
    ['general', 2, 'general-a'],
    ['sections', 2, 'section-a'],
    ['final_detail', 2, 'detail-a'],
  ]);
  assert.equal(result.progress.percent, 76);
  assert.equal(result.registration.status, 'approval_required');
});

test('one incremental event updates only its bound product stage and rejects stale identity', async () => {
  const { applyFactoryDelta, FactorySyncConflict } = await import(`${modelUrl}?t=${Date.now()}`);
  const initial = await normalize(import(`${modelUrl}?i=${Date.now()}`), snapshot());
  const event = {
    schema: 'factory-control-event:v1',
    eventId: '42',
    sequence: 42,
    type: 'factory.stage.updated',
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    runId: 'run-7',
    inputFingerprint: 'sha256:input',
    revision: 9,
    stage: stage('size', 'size-b', 3),
  };
  const next = applyFactoryDelta(initial, event);
  assert.equal(next.stages.find(item => item.key === 'size').selectedId, 'size-b');
  assert.equal(next.stages.find(item => item.key === 'representative').selectedId, 'hero-a');
  assert.throws(
    () => applyFactoryDelta(next, { ...event, eventId: '43', sequence: 43, runId: 'run-stale' }),
    error => error instanceof FactorySyncConflict && error.code === 'stale_run_fingerprint',
  );
  assert.throws(
    () => applyFactoryDelta(next, { ...event, eventId: '40', sequence: 40 }),
    error => error instanceof FactorySyncConflict && error.code === 'stale_event_sequence',
  );
});

test('A-cut command binds full identity and reconnect deduplicates cursor events', async () => {
  const {
    buildACutSelectionCommand,
    normalizeFactoryProjection,
    resumeFactoryEvents,
  } = await import(`${modelUrl}?t=${Date.now()}`);
  const initial = normalizeFactoryProjection(snapshot());
  const command = buildACutSelectionCommand(initial, {
    stageKey: 'representative',
    candidateId: 'representative-b',
  });
  assert.deepEqual(command, {
    capabilityVersion: 'factory-control-command:v1',
    command: 'selectFactoryACut',
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    stageKey: 'representative',
    candidateId: 'representative-b',
    expectedRevision: 9,
    expectedRunId: 'run-7',
    expectedInputFingerprint: 'sha256:input',
    idempotencyKey: 'a-cut:product:alpha:representative:representative-b:9',
  });
  const delta = {
    schema: 'factory-control-event:v1',
    eventId: '42',
    sequence: 42,
    type: 'factory.a_cut.selected',
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    runId: 'run-7',
    inputFingerprint: 'sha256:input',
    revision: 10,
    stage: stage('representative', 'representative-b', 2),
    receipt: { receiptId: 'receipt-42', revision: 10 },
  };
  const resumed = resumeFactoryEvents(initial, [delta, delta], '41');
  assert.equal(resumed.sequence, 42);
  assert.equal(resumed.stages[0].selectedId, 'representative-b');
  assert.equal(resumed.receipts.length, 1);
});

test('missing factory session is honest disconnected state and 200 products remain paged', async () => {
  const {
    disconnectedFactoryProjection,
    projectFactoryProductPage,
  } = await import(`${modelUrl}?t=${Date.now()}`);
  const disconnected = disconnectedFactoryProjection('factory_session_missing');
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.status, 'blocked');
  assert.equal(disconnected.stages.length, 0);
  const products = Array.from({ length: 200 }, (_, index) => ({
    productId: `product-${index + 1}`,
  }));
  const page = projectFactoryProductPage(products, { start: 190, limit: 15 });
  assert.equal(page.items.length, 10);
  assert.equal(page.items.at(-1).productId, 'product-200');
  assert.equal(page.total, 200);
  assert.equal(page.start, 190);
});

test('registered bridge invokes only versioned snapshot and A-cut commands', async () => {
  const { createFactoryControlCommandBridge } = await import(`${bridgeUrl}?t=${Date.now()}`);
  const requests = [];
  const bridge = createFactoryControlCommandBridge({
    requestClassicRuntime: async request => {
      requests.push(request);
      return request.command === 'getFactoryProjection'
        ? snapshot()
        : { schema: 'factory-a-cut-receipt:v1', revision: 10, receiptId: 'receipt-42' };
    },
  });
  const projection = await bridge.getProjection();
  const receipt = await bridge.selectACut({
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    stageKey: 'representative',
    candidateId: 'representative-b',
    expectedRevision: 9,
    expectedRunId: 'run-7',
    expectedInputFingerprint: 'sha256:input',
    idempotencyKey: 'a-cut:product:alpha:representative:representative-b:9',
  });
  assert.equal(projection.schema, 'factory-control-projection:v1');
  assert.equal(receipt.schema, 'factory-a-cut-receipt:v1');
  assert.deepEqual(requests.map(item => item.command), [
    'getFactoryProjection',
    'selectFactoryACut',
  ]);
});

test('registered bridge validates and forwards one factory product run command', async () => {
  const { createFactoryControlCommandBridge } = await import(`${bridgeUrl}?product=${Date.now()}`);
  const requests = [];
  const bridge = createFactoryControlCommandBridge({
    requestClassicRuntime: async request => {
      requests.push(request);
      return {
        schema: 'factory-product-run-receipt:v1',
        jobId: request.payload.jobId,
        status: 'waiting_manual',
        stageKey: 'representative',
        projection: snapshot(),
        checkpoint: {
          schema: 'factory-product-checkpoint:v1',
          jobId: request.payload.jobId,
          projectId: `batch:${request.payload.jobId}`,
          productId: 'cafe24:3001',
          productKey: 'product:alpha',
          runId: 'run-7',
          inputFingerprint: 'sha256:input',
          revision: 9,
          status: 'waiting_manual',
          stageKey: 'representative',
          savedAt: 1,
        },
      };
    },
  });
  const receipt = await bridge.run('factory-control', 'runFactoryProduct', {
    schema: 'factory-product-run-command:v1',
    jobId: 'factory-job-1',
    batchId: 'batch-1',
    mode: 'manual',
    imageModel: 'api-hub-openai-image',
    startFresh: true,
    source: { kind: 'manual' },
    productName: '직접 입력 제품',
    requiredValues: { size: '20cm' },
    inputImages: [{ role: 'base', dataUrl: 'data:image/png;base64,aGVsbG8=', name: '정면' }],
  });

  assert.equal(receipt.schema, 'factory-product-run-receipt:v1');
  assert.equal(requests[0].command, 'runFactoryProduct');
  assert.equal(requests[0].payload.imageModel, 'api-hub-openai-image');
  assert.equal(requests[0].payload.inputImages[0].role, 'base');
});

async function normalize(modulePromise, value) {
  const module = await modulePromise;
  return module.normalizeFactoryProjection(value);
}
