const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../src/modules', name)));

function payload(overrides = {}) {
  return { schema: 'factory-tab-command:v1', jobId: 'job-a', tabId: 'db', action: 'search',
    value: { query: '짧은 검색어', source: 'all' }, expectedWorkspaceId: 'batch:job-a',
    productId: 'factory:상품', productKey: '상품', expectedRunId: 'run-a', expectedInputFingerprint: 'image-a',
    expectedRevision: 7, expectedStoreRevision: 4, idempotencyKey: 'cmd-a', ...overrides };
}
function order(p) {
  return { contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    orderId: 'order-a', batchId: 'batch-a', productId: p.productId, productKey: p.productKey,
    currentRunId: p.expectedRunId, stageId: 'db', operationToken: 'remote-lease',
    idempotencyKey: p.idempotencyKey, expectedWorkfileRevision: p.expectedRevision,
    command: { kind: 'factory-control', version: 'factory-control-command:v1', name: 'invokeFactoryTabCommand', payload: p } };
}
function receipt(p) {
  return { schema: 'factory-tab-command-receipt:v1', jobId: p.jobId, tabId: p.tabId, action: p.action, status: 'applied',
    projection: { schema: 'factory-control-projection:v1', session: { workspaceId: p.expectedWorkspaceId,
      productId: p.productId, productKey: p.productKey, runId: p.expectedRunId,
      inputFingerprint: p.expectedInputFingerprint, revision: 8, storeRevision: 5 }, registration: { jobId: p.jobId } },
    checkpoint: { schema: 'factory-product-checkpoint:v1', jobId: p.jobId, projectId: p.expectedWorkspaceId,
      productId: p.productId, productKey: p.productKey, runId: p.expectedRunId,
      inputFingerprint: p.expectedInputFingerprint, revision: 8, status: 'blocked', stageKey: 'sections', savedAt: 123 } };
}

test('tab command passes the work order contract and bridge without running a product', async () => {
  const { validateOrder } = await load('batch-control-contract.mjs');
  const { createFactoryControlCommandBridge } = await load('factory-control-command-bridge.mjs');
  const p = payload();
  assert.equal(validateOrder(order(p)).command.name, 'invokeFactoryTabCommand');
  const calls = [];
  const bridge = createFactoryControlCommandBridge({ requestClassicRuntime: async value => { calls.push(value); return receipt(p); } });
  assert.equal((await bridge.run('factory-control', 'invokeFactoryTabCommand', p)).status, 'applied');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'invokeFactoryTabCommand');
  assert.equal(typeof bridge.invokeFactoryTabCommand, 'function');
});

test('allowlist and both revisions fail closed before dispatch', async () => {
  const { tabCommandPayload } = await load('factory-control-payloads.mjs');
  const cases = [ { tabId: 'publish' }, { action: 'run-db' }, { schema: 'v2' }, { operationToken: {} },
    { expectedRevision: '7' }, { expectedStoreRevision: -1 }, { expectedWorkspaceId: 'batch:foreign' },
    { value: { query: 'x', source: 'unknown' } },
    { action: 'apply-db-candidate', value: { index: 0 } },
    { tabId: 'fields', action: 'commitField', value: { fieldId: 'product_name', value: 'foreign' } },
    { tabId: 'sections', action: 'saveManualSection', value: { sectionId: 'hero', content: { apiKey: 'secret' } } } ];
  for (const change of cases) assert.throws(() => tabCommandPayload(payload(change)), undefined, JSON.stringify(change));
  assert.equal(tabCommandPayload(payload()).value.query, '짧은 검색어');
});

test('foreign work orders and mismatched checkpoint receipts are rejected', async () => {
  const { validateOrder } = await load('batch-control-contract.mjs');
  const { createFactoryControlCommandBridge } = await load('factory-control-command-bridge.mjs');
  const p = payload();
  for (const change of [{ productId: 'foreign' }, { currentRunId: 'foreign' }, { expectedWorkfileRevision: 99 }, { idempotencyKey: 'foreign' }]) {
    assert.throws(() => validateOrder({ ...order(p), ...change }), /identity_mismatch/);
  }
  for (const change of [{ jobId: 'foreign' }, { status: 'completed' }, { tabId: 'fields' }, { checkpoint: { ...receipt(p).checkpoint, runId: 'foreign' } }]) {
    const bridge = createFactoryControlCommandBridge({ requestClassicRuntime: async () => ({ ...receipt(p), ...change }) });
    await assert.rejects(bridge.run('factory-control', 'invokeFactoryTabCommand', p), /receipt_invalid|checkpoint_invalid/);
  }
});

test('every declared section action accepts its exact native value shape and rejects wrong keys', async () => {
  const { tabCommandPayload, FACTORY_TAB_COMMAND_ACTIONS } = await load('factory-control-payloads.mjs');
  const shapes = { updateSectionInstruction: { sectionId: 'hero', value: '지시문' },
    updateSectionAssemblySource: { sectionId: 'hero', sourceId: 'current', selected: true },
    updateSectionAssemblyCutUsage: { sectionId: 'hero', cutUsage: 'prompt' },
    updateSectionAssemblyCut: { sectionId: 'hero', cutAssetKey: 'cut:a' },
    updateSectionAssemblyNote: { sectionId: 'hero', note: '메모' },
    saveManualSection: { sectionId: 'hero', content: { body_text: '부분 수정' } },
    applySectionVariant: { sectionId: 'hero', variantId: 'variant-a' }, generateSection: { sectionId: 'hero' },
    setSectionBasisMode: { sectionId: 'hero', basisId: 'current' }, setSectionGenerationMode: { sectionId: 'hero', modeId: 'mixed' },
    updateSectionOrder: ['hero', 'features'], setSectionEnabled: { sectionId: 'hero', enabled: false } };
  assert.deepEqual(Object.keys(shapes).sort(), [...FACTORY_TAB_COMMAND_ACTIONS.sections].sort());
  for (const [action, value] of Object.entries(shapes)) {
    assert.equal(tabCommandPayload(payload({ tabId: 'sections', action, value })).action, action);
    if (!Array.isArray(value)) assert.throws(() => tabCommandPayload(payload({ tabId: 'sections', action, value: { ...value, index: 0 } })));
  }
  assert.throws(() => tabCommandPayload(payload({ tabId: 'sections', action: 'updateSectionOrder', value: ['hero', 'hero'] })));
});
