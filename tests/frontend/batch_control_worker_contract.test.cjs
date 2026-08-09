const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

test('batch worker module is registered as one versioned ESM capability', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.modules.filter(item => item === 'src/modules/batch-control-worker.mjs').length, 1);
  assert.equal(manifest.modules.filter(item => item === 'src/modules/factory-cafe24-command-bridge.mjs').length, 1);
  assert.equal(manifest.modules.filter(item => item === 'src/modules/factory-control-command-bridge.mjs').length, 1);
  assert.equal(manifest.modules.filter(item => item === 'src/modules/factory-workspace-command-bridge.mjs').length, 0);
  assert.equal(manifest.modules.some(item => item.includes('control_tower/tests/fixtures')), false);
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  assert.equal(module.BATCH_CONTROL_WORKER_CAPABILITY_VERSION, 'batch-control-worker:v1');
  assert.equal(module.BATCH_CONTROL_CAFE24_COMMAND_VERSION, 'factory-cafe24-command:v1');
  assert.deepEqual(module.BATCH_CONTROL_COMMAND_KINDS, ['factory-composition', 'factory-store', 'workspace-persistence', 'factory-cafe24', 'factory-control', 'factory-workfile']);
});

test('production worker startup cannot seed or mutate an isolated test workspace', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-loader.js'), 'utf8');
  const classicRuntime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const classicHydration = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const persistentRuntime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'dist', 'app-runtime.bundle.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8');
  const launcher = fs.readFileSync(path.join(ROOT, 'launcher.ps1'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs'), 'utf8');
  assert.match(source, /searchParams\.get\('batchWorker'\) === '1'/);
  assert.match(source, /installBatchControlWorker/);
  assert.match(source, /installFactoryCafe24CommandBridge/);
  assert.match(source, /installFactoryControlCommandBridge/);
  assert.match(source, /__KUASANGSE_BATCH_CONTROL_COMMAND_BRIDGE__/);
  assert.match(source, /__KUASANGSE_FACTORY_CONTROL_COMMAND_BRIDGE__/);
  assert.match(source, /startPolling/);
  assert.match(source, /startProjectionPolling/);
  assert.match(source, /controlTowerBase/);
  assert.match(source, /\['127\.0\.0\.1', 'localhost'\]/);
  assert.match(source, /render: \(\) => requestClassicRuntime\('render', isBatchWorker \? \{ mode: 'batch-worker' \} : null\)/);
  assert.match(source, /batch-worker-shell/);
  assert.match(source, /const expectedRootSelector = isBatchWorker \? '\.batch-worker-shell' : '\.app'/);
  assert.doesNotMatch(source, /factoryState|window\.state/);
  assert.match(classicRuntime, /renderClassicRuntimeAfterHydration\(request\.payload\)/);
  assert.match(classicRuntime, /options\?\.mode === 'batch-worker'/);
  assert.match(classicHydration, /classicRuntimeIsBatchWorker/);
  assert.match(classicHydration, /if \(!batchWorker\) \{\s*await hydrateServerLastWorkSnapshot\(/);
  assert.match(
    classicHydration,
    /const initialWorkspaceAuthority = !batchWorker\s*&&\s*hydrationIdentityIsCurrent\(initialHydrationIdentity\)/,
    '백그라운드 batchWorker는 일반 작업 화면의 편집권을 획득하면 안 됩니다.',
  );
  assert.match(
    classicHydration,
    /activeAuthority = batchWorker\s*\?\s*null\s*:\s*await ensureWorkspaceEditAuthority\(activeHydrationIdentity\.scopeId\)/,
    '지연 복원 중 workspace identity가 바뀌어도 batchWorker는 편집권을 재획득하면 안 됩니다.',
  );
  assert.match(persistentRuntime, /suppressHydrationRender/);
  assert.match(classicRuntime, /request\.command === 'factory-cafe24-command'/);
  assert.match(classicRuntime, /factoryRuntimePublishTab\.invoke\('runGuideAction', request\.payload\)/);
  assert.doesNotMatch(bridgeSource, /app-core-0[56]|querySelector|window\.state|factoryState|localStorage|indexedDB/);
  assert.match(
    launcher,
    /app\.html\?batchWorker=1&controlTowerBase=' \+ \$EncodedControlTowerBase/,
  );
  for (const productionSource of [source, classicRuntime, bundle, manifest, launcher]) {
    assert.doesNotMatch(
      productionSource,
      /isolatedFactoryWorkspace|task13-live|registered-factory-workspace|local-contract|factory-live-candidate|factory-workspace-command-bridge|control_tower\/tests\/fixtures/,
    );
  }
});

test('factory projection preflight cache reuses an unchanged revision and invalidates on change', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function createFactoryControlPreflightCache(');
  const end = source.indexOf('\nconst factoryControlPreflightCache =', start);
  assert.ok(start >= 0 && end > start, 'factory preflight cache helper must be extractable');
  const createCache = new Function(`${source.slice(start, end)}; return createFactoryControlPreflightCache;`)();
  const cache = createCache();
  let calls = 0;
  const load = async () => ({ call: ++calls });

  const first = await cache.read('workspace-a:revision-1', load);
  const repeated = await cache.read('workspace-a:revision-1', load);
  const changed = await cache.read('workspace-a:revision-2', load);

  assert.equal(first.call, 1);
  assert.equal(repeated.call, 1);
  assert.equal(changed.call, 2);
});

test('isolated workspace builder exists only as a detached integration harness', async () => {
  const fixturePath = path.join(
    ROOT,
    'control_tower',
    'tests',
    'fixtures',
    'isolated-factory-workspace-harness.mjs',
  );
  const module = await import(pathToFileURL(fixturePath));
  const harness = module.createIsolatedFactoryWorkspaceHarness({
    workspaceId: 'fixture-workspace-a',
    productKey: 'fixture-product-a',
    productName: 'Fixture Product A',
    runId: 'fixture-run-a',
    inputFingerprint: 'sha256:fixture-input-a',
    candidates: [
      {
        id: 'representative-a',
        stageKey: 'representative',
        thumbnailUrl: 'fixture://representative-a',
        digest: 'sha256:representative-a',
      },
      {
        id: 'representative-b',
        stageKey: 'representative',
        thumbnailUrl: 'fixture://representative-b',
        digest: 'sha256:representative-b',
      },
    ],
  });
  const snapshot = harness.store.getSnapshot();
  assert.equal(harness.schema, 'factory-workspace-integration-harness:v1');
  assert.equal(snapshot.factory.workspace.id, 'fixture:fixture-workspace-a');
  assert.equal(snapshot.factory.product.productKey, 'fixture-product-a');
  assert.equal(snapshot.factory.assets.length, 2);
  assert.equal(harness.store.getOperationToken().revision, 0);
  assert.doesNotMatch(
    fs.readFileSync(fixturePath, 'utf8'),
    /localStorage|sessionStorage|indexedDB|querySelector|window\.state|factoryState/,
  );
  harness.dispose();
});

test('batch worker validates and executes the versioned factory A-cut selection command', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const payload = {
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    stageKey: 'representative',
    candidateId: 'representative-b',
    expectedRevision: 9,
    expectedRunId: 'run-7',
    expectedInputFingerprint: 'sha256:input',
    idempotencyKey: 'a-cut:product:alpha:representative:representative-b:9',
  };
  const order = {
    orderId: 'factory-a-cut-1',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'factory-session',
    productId: payload.productId,
    productKey: payload.productKey,
    currentRunId: payload.expectedRunId,
    stageId: payload.stageKey,
    operationToken: 'factory-a-cut:1',
    idempotencyKey: payload.idempotencyKey,
    expectedWorkfileRevision: payload.expectedRevision,
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'selectFactoryACut',
      payload,
    },
  };
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: {
      run: async (...args) => {
        calls.push(args);
        return { schema: 'factory-a-cut-receipt:v1', revision: 10 };
      },
    },
    fetchImpl: async url => responseFor(new URL(url).pathname),
  });

  await worker.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-control');
  assert.equal(calls[0][1], 'selectFactoryACut');
  assert.deepEqual(calls[0][2], payload);
});

test('factory projection polling pushes the registered public projection without originals', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const timers = [];
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    connected: true,
    session: {
      productId: 'cafe24:3001',
      productKey: 'product:alpha',
      runId: 'run-7',
      inputFingerprint: 'sha256:input',
      revision: 9,
    },
    inputs: [],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'session-001', csrfToken: 'csrf-001' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
    setIntervalImpl: callback => (timers.push(callback), timers.length),
    clearIntervalImpl() {},
  });

  const stop = worker.startProjectionPolling(25);
  await new Promise(resolve => setImmediate(resolve));
  await timers[0]();
  stop();

  assert.ok(posts.length >= 2);
  assert.equal(posts[0].endpoint, '/api/factory/session/hello');
  assert.ok(posts.slice(1).every(item => item.endpoint === '/api/factory/sync'));
  assert.ok(posts.every(item => item.body.projection.schema === 'factory-control-projection:v1'));
  assert.doesNotMatch(JSON.stringify(posts), /data:image|file:\/\//);
});

test('worker startup registers one real runtime session and idle heartbeat preserves its cursor identity', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '41',
    sequence: 41,
    connected: true,
    session: {
      productId: 'factory:live-product',
      productKey: 'live-product',
      runId: 'run-live',
      inputFingerprint: 'sha256:live',
      revision: 7,
    },
    inputs: [{ key: 'product', count: 1, missing: [], items: [] }],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'factory-worker-live',
    runtimeBuildId: 'build-live',
    workerSessionId: 'worker-session-live',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'csrf-session', csrfToken: 'csrf-live' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true, cursor: String(posts.length) }) };
    },
  });

  await worker.hello();
  await worker.sessionHeartbeat();

  assert.deepEqual(posts.map(item => item.endpoint), [
    '/api/factory/session/hello',
    '/api/factory/session/heartbeat',
  ]);
  assert.equal(posts[0].body.sessionId, 'worker-session-live');
  assert.equal(posts[0].body.buildId, 'build-live');
  assert.equal(posts[0].body.projection.session.productKey, 'live-product');
  assert.equal(posts[1].body.sessionId, 'worker-session-live');
  assert.ok(posts[1].body.cursor > posts[0].body.cursor);
  assert.equal(posts[1].body.identity.runId, 'run-live');
  assert.equal(posts[1].body.identity.inputFingerprint, 'sha256:live');
});

test('projection sync is fenced by the live session id and monotonically increasing cursor', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '1',
    sequence: 1,
    connected: false,
    reason: 'factory_workspace_missing',
    session: {},
    inputs: [],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'factory-worker-live',
    runtimeBuildId: 'build-live',
    workerSessionId: 'worker-session-live',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'csrf-session', csrfToken: 'csrf-live' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });

  await worker.hello();
  await worker.syncProjection();

  assert.equal(posts[1].endpoint, '/api/factory/sync');
  assert.equal(posts[1].body.sessionId, 'worker-session-live');
  assert.ok(posts[1].body.cursor > posts[0].body.cursor);
  assert.equal(posts[1].body.buildId, 'build-live');
});

test('Cafe24 batch revision fence reads the registered workspace authority capability', () => {
  const classicRuntime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.match(classicRuntime, /function factoryRuntimeAuthoritativeWorkspaceRevision/);
  assert.match(classicRuntime, /__KUASANGSE_WORKSPACE_LOCK__\?\.snapshot\?\.\(\)/);
  assert.match(classicRuntime, /authority\?\.mode === 'editing'/);
  assert.match(classicRuntime, /factoryRuntimeAuthoritativeWorkspaceRevision\(\)/);
});

test('batch worker fences order identifiers and rejects unknown command kinds', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run() {} },
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      json: async () => new URL(url).pathname === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { order: {} },
    }),
  });
  assert.equal(worker.capabilityVersion, 'batch-control-worker:v1');
  await assert.rejects(
    worker.start(),
    error => error.code === 'order_invalid' || error.code === 'contract_version_unsupported',
  );
});

test('batch worker sends ack event and complete in order for one remote command', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'order-001', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-001', productId: 'product-001', productKey: 'product-001', currentRunId: 'run-001',
    stageId: 'validation', operationToken: 'op-001', idempotencyKey: 'idem-001', expectedWorkfileRevision: 0,
    command: { kind: 'factory-composition', version: 'composition:v1', name: 'validation', payload: {} },
  };
  const responseFor = endpoint => ({ ok: true, status: 200, json: async () => endpoint === '/api/worker/claim' ? { order } : endpoint === '/api/session' ? { sessionId: 'session-001', csrfToken: 'csrf-001' } : { accepted: true } });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({ digest: 'result' }) },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responseFor(new URL(url).pathname); },
  });
  await worker.start();
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/api/session',
    '/api/worker/claim',
    '/api/worker/order-001/ack',
    '/api/worker/order-001/events',
    '/api/worker/order-001/complete',
  ]);
});

test('batch worker accepts only the versioned Cafe24 factory command and forwards no approval token', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'order-cafe24', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-001', productId: 'product-001', productKey: 'product-001', currentRunId: 'run-001',
    stageId: 'cafe24', operationToken: 'op-001', idempotencyKey: 'idem-001', expectedWorkfileRevision: 3,
    command: {
      kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'detailToCafe24',
      payload: {
        jobId: 'job-001', productId: 'product-001', productKey: 'product-001', categoryId: 'cat',
        htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 3, expectedRunId: 'run-001',
        expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001', approvalGrantDigest: 'grant',
      },
    },
  };
  const responseFor = endpoint => ({ ok: true, status: 200, json: async () => endpoint === '/api/worker/claim' ? { order } : endpoint === '/api/session' ? { sessionId: 'session-001', csrfToken: 'csrf-001' } : { accepted: true } });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async (...args) => { calls.push(args); return { remoteReadbackDigest: 'html' }; } },
    fetchImpl: async (url) => responseFor(new URL(url).pathname),
  });
  await worker.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-cafe24');
  assert.equal(calls[0][1], 'detailToCafe24');
  assert.equal(calls[0][2].approvalGrantDigest, 'grant');
  assert.equal('approvalToken' in calls[0][2], false);
});

test('batch worker routes the read-only Cafe24 preflight through the registered bridge', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'order-cafe24-preflight', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'cafe24-preflight', productId: 'cafe24-preflight', productKey: 'cafe24-preflight', currentRunId: 'cafe24-preflight',
    stageId: 'cafe24', operationToken: 'preflight-001', idempotencyKey: 'preflight-001', expectedWorkfileRevision: 0,
    command: {
      kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'inspectDetailToCafe24', payload: {},
    },
  };
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const result = {
    schema: 'factory-cafe24-preflight:v1',
    status: 'ready',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    htmlDigest: 'canonical-html',
    imageDigests: ['image-1'],
    expectedWorkfileRevision: 108,
    expectedRunId: 'run-001',
    expectedInputFingerprint: 'fp',
  };
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: {
      run: async () => { throw new Error('write bridge must not run'); },
      inspect: async () => { calls.push('inspect'); return result; },
    },
    fetchImpl: async url => responseFor(new URL(url).pathname),
  });

  await worker.start();

  assert.deepEqual(calls, ['inspect']);
});

test('batch worker routes Cafe24 reconciliation through the read-only registered bridge', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const payload = {
    jobId: 'job-001', batchId: 'batch-001', productId: 'cafe24:2994', productKey: '방울수저집',
    categoryId: '71', htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 108,
    expectedRunId: 'run-001', expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001',
    selling: 'F', display: 'F', market_sync: 'F',
  };
  const order = {
    orderId: 'order-cafe24-reconcile', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: payload.batchId, productId: payload.productId, productKey: payload.productKey, currentRunId: payload.expectedRunId,
    stageId: 'cafe24', operationToken: 'reconcile-001', idempotencyKey: payload.idempotencyKey,
    expectedWorkfileRevision: payload.expectedWorkfileRevision, payloadDigest: 'approved-payload',
    command: { kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'verifyDetailToCafe24', payload },
  };
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: {
      run: async () => { throw new Error('write bridge must not run'); },
      verify: async (...args) => {
        calls.push(args);
        return {
          status: 'staged_verified', payloadDigest: 'approved-payload',
          remoteReadbackDigest: 'remote-html', externalProductNo: '2994', idempotencyKey: 'idem-001',
        };
      },
    },
    fetchImpl: async url => responseFor(new URL(url).pathname),
  });

  await worker.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-cafe24');
  assert.equal(calls[0][1], 'verifyDetailToCafe24');
  assert.equal('approvalGrantDigest' in calls[0][2], false);
});

test('registered Cafe24 bridge fences safe defaults and forwards through the classic runtime endpoint', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs')));
  const requests = [];
  const windowObject = {};
  const receipt = module.installFactoryCafe24CommandBridge(windowObject, {
    requestClassicRuntime: async payload => {
      requests.push(payload);
      return {
        status: 'staged_verified',
        remoteReadbackDigest: 'remote-html',
        externalProductNo: '2994',
      };
    },
  });
  const payload = {
    jobId: 'job-001', batchId: 'batch-001', productId: 'cafe24:2994', productKey: '방울수저집',
    categoryId: '71', htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 108,
    expectedRunId: 'run-001', expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001',
    approvalGrantDigest: 'grant', selling: 'F', display: 'F', market_sync: 'F',
  };
  const order = {
    orderId: 'order-001', productId: payload.productId, productKey: payload.productKey,
    currentRunId: payload.expectedRunId, expectedWorkfileRevision: 108, idempotencyKey: payload.idempotencyKey,
    payloadDigest: 'approved-payload', command: { kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'detailToCafe24' },
  };

  const result = await receipt.bridge.run('factory-cafe24', 'detailToCafe24', payload, order);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'run-batch-cafe24-registration');
  assert.equal(requests[0].batchControl.productId, 'cafe24:2994');
  assert.equal('approvalToken' in requests[0].batchControl, false);
  assert.deepEqual(result, {
    status: 'staged_verified',
    payloadDigest: 'approved-payload',
    remoteReadbackDigest: 'remote-html',
    externalProductNo: '2994',
    idempotencyKey: 'idem-001',
  });
  await assert.rejects(
    receipt.bridge.run('factory-cafe24', 'detailToCafe24', { ...payload, selling: 'T' }, order),
    error => error.code === 'unsafe_cafe24_defaults',
  );
});

test('registered Cafe24 bridge reconciles by remote readback without invoking the write action', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs')));
  const requests = [];
  const receipt = module.installFactoryCafe24CommandBridge({}, {
    requestClassicRuntime: async payload => {
      requests.push(payload);
      return { status: 'staged_verified', remoteReadbackDigest: 'remote-html', externalProductNo: '2994' };
    },
  });
  const payload = {
    jobId: 'job-001', batchId: 'batch-001', productId: 'cafe24:2994', productKey: '방울수저집',
    categoryId: '71', htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 108,
    expectedRunId: 'run-001', expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001',
    selling: 'F', display: 'F', market_sync: 'F',
  };
  const order = {
    orderId: 'order-001', productId: payload.productId, productKey: payload.productKey,
    currentRunId: payload.expectedRunId, expectedWorkfileRevision: 108, idempotencyKey: payload.idempotencyKey,
    payloadDigest: 'approved-payload',
    command: { kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'verifyDetailToCafe24' },
  };

  const result = await receipt.bridge.verify('factory-cafe24', 'verifyDetailToCafe24', payload, order);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'verify-batch-cafe24-registration');
  assert.equal('approvalGrantDigest' in requests[0].batchControl, false);
  assert.equal(result.remoteReadbackDigest, 'remote-html');
});

test('registered Cafe24 bridge exposes a versioned read-only factory preflight', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs')));
  const requests = [];
  const receipt = module.installFactoryCafe24CommandBridge({}, {
    requestClassicRuntime: async payload => {
      requests.push(payload);
      return {
        schema: 'factory-cafe24-preflight:v1',
        status: 'ready',
        productId: 'cafe24:2994',
        productKey: '방울수저집',
        htmlDigest: 'canonical-html',
        imageDigests: ['image-1'],
        expectedWorkfileRevision: 108,
        expectedRunId: 'run-001',
        expectedInputFingerprint: 'fp',
      };
    },
  });

  const preflight = await receipt.bridge.inspect();

  assert.deepEqual(requests, [{ action: 'inspect-batch-cafe24-registration' }]);
  assert.equal(preflight.schema, 'factory-cafe24-preflight:v1');
  assert.equal(preflight.productId, 'cafe24:2994');
  assert.equal(preflight.htmlDigest, 'canonical-html');
});

test('batch worker routes a versioned workfile hydration order only through the registered command bridge', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'workfile-hydrate-001',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-001',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    currentRunId: 'factory_work_run_mrw3euf3_elu0dd',
    stageId: 'workfile-hydration',
    operationToken: 'workfile-hydration:001',
    idempotencyKey: 'workfile:b363c06c',
    expectedWorkfileRevision: 3,
    command: {
      kind: 'factory-workfile',
      version: 'factory-workfile-hydration-command:v1',
      name: 'hydrateFactoryWorkfile',
      payload: {
        contractVersion: 'factory-workfile-hydration-command:v1',
        capabilityVersion: 'factory-workfile-hydration-command:v1',
        fileName: 'gpt가한방울수저집 (8).kuasangse',
        workfileText: '{"format":"kuasangse.factory.project"}',
        expectedSha256: 'b363c06ce83373807f76a4323b35da4212eb6b8a3f5a77c7520acb18a13189d2',
        expectedWorkspaceId: 'project_mrx0tgw5_mrzrpg',
        expectedProductId: 'cafe24:2994',
        expectedProductKey: '방울수저집',
        expectedRunId: 'factory_work_run_mrw3euf3_elu0dd',
        expectedInputFingerprint: 'fingerprint-001',
        expectedWorkfileRevision: 3,
        idempotencyKey: 'workfile:b363c06c',
      },
    },
  };
  const responses = [];
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    workerSessionId: 'session-001',
    commandBridge: { run: async () => ({}) },
    projectionBridge: {
      async run(...args) {
        calls.push(args);
        return { schema: 'factory-workfile-hydration-receipt:v1' };
      },
    },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      responses.push({ endpoint, body: options.body ? JSON.parse(options.body) : null });
      return {
        ok: true,
        status: 200,
        json: async () => endpoint === '/api/session'
          ? { sessionId: 'http-session', csrfToken: 'csrf-001' }
          : endpoint === '/api/worker/claim'
            ? { order }
            : { accepted: true },
      };
    },
  });

  await worker.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-workfile');
  assert.equal(calls[0][1], 'hydrateFactoryWorkfile');
  assert.equal(calls[0][2].expectedWorkspaceId, 'project_mrx0tgw5_mrzrpg');
  const claims = responses.filter(item => item.endpoint === '/api/worker/claim');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].body.sessionId, 'session-001');
});

test('factory control bridge binds hydrated workfile receipt to the exact public projection', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-control-command-bridge.mjs')));
  const payload = {
    contractVersion: 'factory-workfile-hydration-command:v1',
    capabilityVersion: 'factory-workfile-hydration-command:v1',
    fileName: 'target.kuasangse',
    workfileText: '{"target":2994}',
    expectedSha256: 'b'.repeat(64),
    expectedWorkspaceId: 'project-target',
    expectedProductId: 'cafe24:2994',
    expectedProductKey: '방울수저집',
    expectedRunId: 'run-target',
    expectedInputFingerprint: 'fingerprint-target',
    expectedWorkfileRevision: 3,
    idempotencyKey: 'workfile:target',
  };
  const beforeProjection = {
    schema: 'factory-control-projection:v1',
    connected: true,
    session: { revision: 3 },
  };
  const projection = {
    schema: 'factory-control-projection:v1',
    connected: true,
    session: {
      workspaceId: 'project-target',
      productId: 'cafe24:2994',
      productKey: '방울수저집',
      runId: 'run-target',
      inputFingerprint: 'fingerprint-target',
      revision: 10,
    },
  };
  let hydrated = false;
  const bridge = module.createFactoryControlCommandBridge({
    requestClassicRuntime: async () => hydrated ? projection : beforeProjection,
    hydrateWorkfile: async () => {
      hydrated = true;
      return {
        schema: 'factory-workfile-hydration-receipt:v1',
        capabilityVersion: 'factory-workfile-hydration-command:v1',
        workfileSha256: 'b'.repeat(64),
        projectId: 'project-target',
        name: '방울수저집',
      };
    },
  });
  const order = {
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    currentRunId: 'run-target',
    expectedWorkfileRevision: 3,
    idempotencyKey: 'workfile:target',
  };

  const receipt = await bridge.run('factory-workfile', 'hydrateFactoryWorkfile', payload, order);

  assert.equal(receipt.projection.session.productId, 'cafe24:2994');
  assert.equal(receipt.projection.session.revision, 10);
  await assert.rejects(
    bridge.run('factory-workfile', 'hydrateFactoryWorkfile', {
      ...payload,
      expectedProductId: 'cafe24:594',
    }, order),
    error => error.code === 'factory_workfile_identity_mismatch',
  );
});

test('batch worker polling keeps claiming after idle without overlapping starts', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const timers = [];
  let claimCount = 0;
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({}) },
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      json: async () => new URL(url).pathname === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : new URL(url).pathname === '/api/worker/claim'
          ? (claimCount += 1, { order: null })
          : { accepted: true },
    }),
    setIntervalImpl: callback => (timers.push(callback), timers.length),
    clearIntervalImpl() {},
  });

  const stop = worker.startPolling(25);
  await new Promise(resolve => setImmediate(resolve));
  await timers[0]();
  stop();

  assert.ok(claimCount >= 2);
});
