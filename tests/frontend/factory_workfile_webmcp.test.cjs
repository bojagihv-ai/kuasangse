const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = 'src/modules/factory-workfile-webmcp.mjs';
const INSTALL_MODULE_PATH = 'src/modules/batch-control-worker-install.mjs';
const TOOL_NAME = 'hydrate_factory_workfile';
const VERSION = 'factory-workfile-hydration-command:v1';

function hydrationPayload() {
  return {
    contractVersion: VERSION,
    capabilityVersion: VERSION,
    fileName: 'target.kuasangse',
    workfileText: '{"target":2994}',
    expectedSha256: 'b'.repeat(64),
    expectedWorkspaceId: 'project-target',
    expectedProductId: 'cafe24:2994',
    expectedProductKey: 'product-target',
    expectedRunId: 'run-target',
    expectedInputFingerprint: 'fingerprint-target',
    expectedWorkfileRevision: 3,
    idempotencyKey: 'workfile:target',
  };
}

function modelContextRegistry() {
  const registered = new Map();
  return {
    async registerTool(tool) {
      registered.set(tool.name, tool);
    },
    async getTools() {
      return [...registered.values()].map(({ execute, ...tool }) => tool);
    },
    async executeTool(name, input) {
      return registered.get(name)?.execute(input);
    },
  };
}

test('page registers one narrow WebMCP hydration tool and returns only a terminal redacted receipt', async () => {
  // Given: the real runtime manifest and a behavioral WebMCP registry seam.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8'));
  const registry = modelContextRegistry();
  const calls = [];
  const moduleEntry = manifest.modules.find(entry => entry === INSTALL_MODULE_PATH);

  if (moduleEntry) {
    const module = await import(pathToFileURL(path.join(ROOT, moduleEntry)));
    const createWorker = () => ({
      async hydrateFactoryWorkfile(payload) {
        calls.push(payload);
        const candidates = Array.from({ length: 41 }, (_, index) => ({ id: `asset-${index + 1}` }));
        return {
          schema: 'factory-workfile-hydration-receipt:v1',
          capabilityVersion: VERSION,
          workfileSha256: payload.expectedSha256,
          projectId: payload.expectedWorkspaceId,
          name: payload.expectedProductKey,
          projection: {
            schema: 'factory-control-projection:v1',
            session: {
              workspaceId: payload.expectedWorkspaceId,
              productId: payload.expectedProductId,
              productKey: payload.expectedProductKey,
              runId: payload.expectedRunId,
              inputFingerprint: payload.expectedInputFingerprint,
              revision: 10,
            },
            stages: [{ candidates, selectedIds: candidates.slice(0, 17).map(item => item.id) }],
          },
        };
      },
    });
    const inactive = module.installBatchControlWorkerWithFactory({}, {}, createWorker);
    assert.deepEqual(
      await inactive.webMcpReady,
      { active: false, toolName: TOOL_NAME },
    );
    const receipt = module.installBatchControlWorkerWithFactory(
      { document: { modelContext: registry } }, {}, createWorker,
    );
    await receipt.webMcpReady;
  }

  // When: an agent discovers and invokes the public tool through the registry.
  const tools = await registry.getTools();
  assert.deepEqual(tools.map(tool => tool.name), [TOOL_NAME]);
  const result = await registry.executeTool(TOOL_NAME, hydrationPayload());

  // Then: exactly one existing hydration command ran and no sensitive body escaped.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], hydrationPayload());
  assert.deepEqual(result, {
    schema: 'factory-workfile-webmcp-receipt:v1',
    capabilityVersion: VERSION,
    workfileSha256: 'b'.repeat(64),
    workspaceId: 'project-target',
    productId: 'cafe24:2994',
    productKey: 'product-target',
    runId: 'run-target',
    inputFingerprint: 'fingerprint-target',
    revision: 10,
    assetCount: 41,
    selectedAssetCount: 17,
  });
  assert.equal(JSON.stringify(result).includes('workfileText'), false);
});

test('authenticated worker submission reaches only the versioned hydration bridge and waits for completion', async () => {
  // Given: one valid command, the existing worker endpoints, and a terminal bridge receipt.
  const workerModule = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const payload = hydrationPayload();
  const order = {
    orderId: 'factory-workfile-001',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'factory-session',
    productId: payload.expectedProductId,
    productKey: payload.expectedProductKey,
    currentRunId: payload.expectedRunId,
    stageId: 'workfile-hydration',
    operationToken: `factory-workfile:${payload.expectedSha256}`,
    idempotencyKey: payload.idempotencyKey,
    expectedWorkfileRevision: payload.expectedWorkfileRevision,
    command: { kind: 'factory-workfile', version: VERSION, name: 'hydrateFactoryWorkfile', payload },
  };
  const requests = [];
  const bridgeCalls = [];
  const terminal = {
    schema: 'factory-workfile-hydration-receipt:v1',
    capabilityVersion: VERSION,
    workfileSha256: payload.expectedSha256,
    projectId: payload.expectedWorkspaceId,
    name: payload.expectedProductKey,
    projection: {
      schema: 'factory-control-projection:v1',
      session: {
        workspaceId: payload.expectedWorkspaceId,
        productId: payload.expectedProductId,
        productKey: payload.expectedProductKey,
        runId: payload.expectedRunId,
        inputFingerprint: payload.expectedInputFingerprint,
        revision: 10,
      },
      stages: [],
    },
  };
  const worker = workerModule.createBatchControlWorker({
    workerId: 'worker-webmcp',
    workerSessionId: 'worker-session-webmcp',
    commandBridge: { run: async () => ({}) },
    projectionBridge: {
      async run(...args) {
        bridgeCalls.push(args);
        return terminal;
      },
    },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      requests.push({ endpoint, options });
      const body = endpoint === '/api/session'
        ? { sessionId: 'http-session', csrfToken: 'csrf-value' }
        : endpoint === '/api/factory/workfile/hydrate'
          ? { accepted: true, order: { orderId: order.orderId, idempotencyKey: order.idempotencyKey } }
          : endpoint === '/api/worker/claim'
            ? { order }
            : { accepted: true };
      return { ok: true, status: endpoint === '/api/factory/workfile/hydrate' ? 202 : 200, json: async () => body };
    },
  });

  // When: the page-owned worker submits one hydration request.
  const result = await worker.hydrateFactoryWorkfile(payload, 1000);

  // Then: auth stayed in-page, the exact bridge command ran once, and completion was returned.
  const submissions = requests.filter(request => request.endpoint === '/api/factory/workfile/hydrate');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].options.headers['X-Control-Tower-Session'], 'http-session');
  assert.equal(submissions[0].options.headers['X-Control-Tower-CSRF'], 'csrf-value');
  assert.deepEqual(JSON.parse(submissions[0].options.body), payload);
  assert.deepEqual(bridgeCalls.map(call => call.slice(0, 2)), [['factory-workfile', 'hydrateFactoryWorkfile']]);
  assert.deepEqual(result, terminal);
});

test('WebMCP hydration rejects generic control fields before worker submission', async () => {
  // Given: the registered tool and a payload with an arbitrary network field.
  const module = await import(pathToFileURL(path.join(ROOT, MODULE_PATH)));
  const registry = modelContextRegistry();
  let calls = 0;
  await module.installFactoryWorkfileWebMcp({ modelContext: registry }, {
    async hydrateFactoryWorkfile() {
      calls += 1;
      return {};
    },
  });

  // When/Then: registry execution rejects before reaching the worker.
  await assert.rejects(
    registry.executeTool(TOOL_NAME, { ...hydrationPayload(), url: 'http://example.invalid' }),
    error => error.code === 'factory_workfile_webmcp_payload_invalid',
  );
  assert.equal(calls, 0);
});

test('WebMCP hydration rejects a missing identity before worker submission', async () => {
  // Given: the registered tool and a payload missing its product identity.
  const module = await import(pathToFileURL(path.join(ROOT, MODULE_PATH)));
  const registry = modelContextRegistry();
  let calls = 0;
  await module.installFactoryWorkfileWebMcp({ modelContext: registry }, {
    async hydrateFactoryWorkfile() { calls += 1; return {}; },
  });
  const invalid = hydrationPayload();
  delete invalid.expectedProductId;

  // When/Then: registry execution rejects before reaching the worker.
  await assert.rejects(
    registry.executeTool(TOOL_NAME, invalid),
    error => error.code === 'factory_workfile_field_missing:expectedProductId',
  );
  assert.equal(calls, 0);
});

test('WebMCP hydration never reports an accepted queue response as completion', async () => {
  // Given: the registered tool and a worker response that is only queued.
  const module = await import(pathToFileURL(path.join(ROOT, MODULE_PATH)));
  const registry = modelContextRegistry();
  await module.installFactoryWorkfileWebMcp({ modelContext: registry }, {
    async hydrateFactoryWorkfile() {
      return { accepted: true, status: 'queued' };
    },
  });

  // When/Then: the public call rejects without manufacturing a receipt.
  await assert.rejects(
    registry.executeTool(TOOL_NAME, hydrationPayload()),
    error => error.code === 'factory_workfile_terminal_receipt_invalid',
  );
});

test('authenticated hydration wait is bounded and does not retry an idle claim', async () => {
  // Given: a valid queue receipt whose worker claim remains idle.
  const workerModule = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const payload = hydrationPayload();
  const requests = [];
  const worker = workerModule.createBatchControlWorker({
    workerId: 'worker-timeout',
    workerSessionId: 'worker-session-timeout',
    commandBridge: { run: async () => ({}) },
    fetchImpl: async (url) => {
      const endpoint = new URL(url).pathname;
      requests.push(endpoint);
      const body = endpoint === '/api/session'
        ? { sessionId: 'http-session', csrfToken: 'csrf-value' }
        : endpoint === '/api/factory/workfile/hydrate'
          ? { accepted: true, order: { orderId: 'factory-workfile-timeout', idempotencyKey: payload.idempotencyKey } }
          : { order: null };
      return { ok: true, status: endpoint === '/api/factory/workfile/hydrate' ? 202 : 200, json: async () => body };
    },
  });

  // When/Then: one bounded call times out after one submit and one claim.
  await assert.rejects(
    worker.hydrateFactoryWorkfile(payload, 10),
    error => error.code === 'factory_workfile_hydration_timeout',
  );
  assert.equal(requests.filter(endpoint => endpoint === '/api/factory/workfile/hydrate').length, 1);
  assert.equal(requests.filter(endpoint => endpoint === '/api/worker/claim').length, 1);
});
