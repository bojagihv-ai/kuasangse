const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'src/modules', name)));
function fn(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} exists`);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const payload = overrides => ({ schema: 'factory-tab-command:v1', jobId: 'job-a', tabId: 'db', action: 'search',
  value: { query: '검색', source: 'all' }, expectedWorkspaceId: 'batch:job-a', productId: 'factory:상품', productKey: '상품',
  expectedRunId: 'run-a', expectedInputFingerprint: 'image-a', expectedRevision: 7, expectedStoreRevision: 4,
  idempotencyKey: 'request-a', ...overrides });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function harness(options = {}) {
  const { createFactoryStore } = await load('factory-store.mjs');
  const { tabCommandPayload } = await load('factory-control-payloads.mjs');
  const factory = { workspace: { id: 'batch:job-a' }, product: { productName: '상품', currentRunId: 'run-a', inputImageFingerprint: 'image-a' },
    goalRun: { jobId: 'job-a', running: false }, automation: {}, assets: [{ id: 'keep' }] };
  const store = createFactoryStore({ workspaceId: 'batch:job-a', revision: 4, initialSnapshot: { factory } });
  const state = { currentProjectId: 'batch:job-a' };
  const calls = [], saves = [];
  let documentRevision = 7;
  const checkpoint = { schema: 'factory-product-checkpoint:v1', jobId: 'job-a', projectId: 'batch:job-a',
    productId: 'factory:상품', productKey: '상품', runId: 'run-a', inputFingerprint: 'image-a', revision: 7,
    status: options.status || 'blocked', stageKey: 'sections', savedAt: 123 };
  const readFactory = () => store.getSnapshot().factory;
  const context = vm.createContext({ state, installFactoryRuntimeStart: { tabCommandPayload },
    factoryRuntimeTabCommandReceipts: new Map(), factoryRuntimeTabCommandFlight: null,
    factoryRuntimeRequireStore: () => store, factoryRuntimeReadFactory: readFactory,
    factoryRuntimeReadViewSnapshot: () => ({ factory: readFactory() }),
    factoryCurrentProductKey: f => f.product.productName,
    factoryCurrentWorkflowRunId: f => f.product.currentRunId,
    factoryCurrentInputImageFingerprint: f => f.product.inputImageFingerprint,
    factoryCafe24TargetInfo: () => ({}),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ scopeId: `project:${state.currentProjectId}`, counter: documentRevision }),
    factoryRuntimeControlCheckpointFromProjection: Object.assign((_p, projection, status, stageKey) => ({
      ...checkpoint, revision: projection.session.revision, status, stageKey,
    }), { latest: checkpoint }),
    factoryRuntimeControlCheckpointProjectId: id => `batch:${id}`,
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeStaleActionError: code => new Error(`STALE:${code}`),
    factoryRuntimeDeferredOperationsPending: () => false,
    factoryControlOperatorControls: () => ({ fields: [{ fieldId: 'material' }], sections: [{ id: 'hero' }] }),
  });
  for (const name of ['factoryRuntimeControlTabScope', 'factoryRuntimeControlTabScopeMatches', 'factoryRuntimeControlTabWorkflow',
    'factoryRuntimeControlValidateTabValue', 'factoryRuntimeControlInvokeTabCommand']) {
    vm.runInContext(fn('src/app-core-03.js', name), context);
  }
  context.factoryRuntimeControlProjection = async () => {
    await options.projectionGate?.promise;
    return { schema: 'factory-control-projection:v1', session: context.factoryRuntimeControlTabScope(), registration: { jobId: readFactory().goalRun.jobId } };
  };
  const tab = { invokeLocal: async (action, value) => {
    calls.push({ action, value });
    await options.actionGate?.promise;
    return options.result === undefined ? true : options.result;
  } };
  Object.assign(context, { factoryRuntimeDbTab: tab, factoryRuntimeFieldsTab: tab, factoryRuntimeCompetitorTab: tab, factoryRuntimeSectionsTab: tab, factoryRuntimeAssetsTab: tab });
  context.factoryRuntimeControlSaveProductCheckpoint = async (p, status, stageKey, guard = {}) => {
    guard.assertCurrent?.();
    saves.push({ status, stageKey });
    documentRevision += 1;
    return { projection: await context.factoryRuntimeControlProjection(), checkpoint: { ...checkpoint, revision: documentRevision, status, stageKey } };
  };
  return { context, store, calls, saves, state,
    invoke: p => context.factoryRuntimeControlInvokeTabCommand(p || payload()),
    change: patch => store.update(current => ({ ...current, ...patch }), { owner: 'factory', expectedRevision: store.getOperationToken().revision }),
  };
}

test('dispatcher invokes only the tab and checkpoints without changing job status or stage', async () => {
  const h = await harness();
  const result = await h.invoke();
  assert.equal(result.schema, 'factory-tab-command-receipt:v1');
  assert.equal(result.status, 'applied');
  assert.deepEqual(h.saves, [{ status: 'blocked', stageKey: 'sections' }]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.getSnapshot().factory.assets[0].id, 'keep');
});

async function exportHarness(options = {}) {
  const h = await harness({ status: 'waiting_manual', ...options });
  const project = h.context.factoryRuntimeControlProjection;
  h.context.factoryRuntimeControlProjection = async () => ({ ...await project(), connected: true,
    storage: { ok: true, warning: '' }, ...options.projection });
  const exports = [];
  h.context.window = {};
  h.context.exportCurrentProjectFile = async settings => {
    exports.push(JSON.parse(JSON.stringify(settings)));
    await options.exportGate?.promise;
    h.context.window.__KUASANGSE_LAST_WORKFILE_RECEIPT__ = {
      source: 'browser-download-requested', workspaceId: 'batch:job-a', fileName: '상품.kuasangse',
      bytes: 123, sha256: 'a'.repeat(64), ...options.receipt,
    };
    return options.failed ? null : { workspaceId: 'batch:job-a' };
  };
  return { ...h, exports, request: overrides => payload({ tabId: 'workfile', action: 'export-current', value: {}, ...overrides }) };
}

test('explicit workfile export reuses the exporter without a picker, product action or second save', async () => {
  const h = await exportHarness();
  const before = JSON.stringify(h.store.getSnapshot());
  const result = await h.invoke(h.request());
  assert.deepEqual(h.exports, [{ downloadOnly: true, skipBrowserDownload: false, saveAs: false }]);
  assert.equal(result.projection.session.workfileSource, 'browser-download-requested');
  assert.equal(result.projection.session.workfileSha256, 'a'.repeat(64));
  assert.equal(result.checkpoint.status, 'waiting_manual');
  assert.equal(h.calls.length + h.saves.length, 0);
  assert.equal(JSON.stringify(h.store.getSnapshot()), before);
  assert.equal(await h.invoke(h.request()), result);
  assert.equal(h.exports.length, 1);
});

test('export rejects blocked, busy, unsaved and mismatched jobs or revisions before dispatch', async () => {
  for (const options of [{ status: 'blocked' }, { projection: { storage: { ok: false } } },
    { projection: { registration: { jobId: 'other' } } }]) {
    const h = await exportHarness(options);
    await assert.rejects(h.invoke(h.request()));
    assert.equal(h.exports.length, 0);
  }
  for (const mismatch of [{ expectedRevision: 8 }, { expectedStoreRevision: 3 }, { expectedRunId: 'other' },
    { expectedInputFingerprint: 'other' }, { productId: 'other' }, { productKey: 'other' },
    { jobId: 'other', expectedWorkspaceId: 'batch:other' }, { value: { skipBrowserDownload: true } }]) {
    const h = await exportHarness();
    await assert.rejects(h.invoke(h.request(mismatch)));
    assert.equal(h.exports.length, 0);
  }
  for (const mode of ['projectBusy', 'lease', 'source']) {
    const h = await exportHarness();
    if (mode === 'projectBusy') h.state.projectBusy = true;
    if (mode === 'lease') h.store.acquireOperationLease('other');
    if (mode === 'source') h.state.currentProjectId = 'batch:other';
    await assert.rejects(h.invoke(h.request()));
    assert.equal(h.exports.length, 0);
  }
});

test('export never accepts a skipped, foreign or failed download receipt', async () => {
  for (const options of [{ failed: true }, { receipt: { source: 'authoritative-store' } },
    { receipt: { workspaceId: 'batch:other' } }, { receipt: { bytes: 0 } }, { receipt: { sha256: '' } }]) {
    const h = await exportHarness(options);
    await assert.rejects(h.invoke(h.request()));
    assert.equal(h.saves.length, 0);
  }
  const gate = deferred();
  const h = await exportHarness({ exportGate: gate });
  const pending = h.invoke(h.request());
  await new Promise(resolve => setImmediate(resolve));
  h.change({ product: { productName: '다른 상품', currentRunId: 'other', inputImageFingerprint: 'other' } });
  gate.resolve();
  await assert.rejects(pending, /stale|identity/);
});

test('stale identity, both revisions, foreign job and active lease are rejected before action', async () => {
  for (const mismatch of [{ expectedRevision: 8 }, { expectedStoreRevision: 3 }, { expectedRunId: 'foreign' },
    { expectedInputFingerprint: 'foreign' }, { productKey: 'foreign' }, { productId: 'foreign' },
    { jobId: 'foreign', expectedWorkspaceId: 'batch:foreign' }]) {
    const h = await harness();
    await assert.rejects(h.invoke(payload(mismatch)));
    assert.equal(h.calls.length, 0);
  }
  const h = await harness();
  const lease = h.store.acquireOperationLease('existing-generation');
  await assert.rejects(h.invoke(), /busy|lease/);
  assert.equal(h.calls.length, 0);
  lease.release();
});

test('scope change during projection or action rejects late completion without checkpoint', async () => {
  for (const phase of ['projectionGate', 'actionGate']) {
    const gate = deferred();
    const h = await harness({ [phase]: gate });
    const pending = h.invoke();
    await new Promise(resolve => setImmediate(resolve));
    h.change({ product: { productName: '다른 상품', currentRunId: 'run-b', inputImageFingerprint: 'image-b' } });
    gate.resolve();
    await assert.rejects(pending, /stale|STALE|identity/);
    assert.equal(h.saves.length, 0);
    if (phase === 'projectionGate') assert.equal(h.calls.length, 0);
  }
});

test('duplicate idempotency keys coalesce and failed actions never yield applied receipts', async () => {
  const gate = deferred();
  const h = await harness({ actionGate: gate });
  const first = h.invoke();
  const second = h.invoke();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 1);
  gate.resolve();
  assert.equal(await first, await second);
  assert.equal(h.saves.length, 1);
  await assert.rejects(h.invoke(payload({ value: { query: 'different', source: 'db' } })), /idempotency/);
  for (const result of [false, { ok: false }]) {
    const failed = await harness({ result });
    await assert.rejects(failed.invoke(), /not_applied/);
    assert.equal(failed.saves.length, 0);
  }
});

test('local token issuance, same-scope revision races and missing checkpoints fail closed', async () => {
  const gate = deferred();
  const h = await harness({ projectionGate: gate });
  const pending = h.invoke();
  await new Promise(resolve => setImmediate(resolve));
  h.change({ automation: { background: true } });
  gate.resolve();
  await assert.rejects(pending, /stale_revision/);
  assert.equal(h.calls.length, 0);
  const foreignStore = await harness();
  foreignStore.store.switchWorkspace('batch:other', { snapshot: foreignStore.store.getSnapshot(), revision: 4 });
  await assert.rejects(foreignStore.invoke(), /stale_identity/);
  const noCheckpoint = await harness();
  delete noCheckpoint.context.factoryRuntimeControlCheckpointFromProjection.latest;
  await assert.rejects(noCheckpoint.invoke(), /checkpoint_missing/);
});

test('checkpoint save stops before saving a foreign scope after delayed authority', async () => {
  const source = fn('src/app-core-03.js', 'factoryRuntimeControlSaveProductCheckpoint');
  const gate = deferred();
  let current = true, writes = 0;
  const context = vm.createContext({ state: {}, setTimeout,
    factoryRuntimeControlAdoptProductProject: () => 'batch:a', getCurrentDocumentWorkspaceScope: id => `project:${id}`,
    ensureWorkspaceEditAuthority: async () => { await gate.promise; return { mode: 'editing', scopeId: 'project:batch:a' }; },
    saveCurrentProject: async () => { writes += 1; return true; },
  });
  vm.runInContext(source, context);
  const pending = context.factoryRuntimeControlSaveProductCheckpoint({ jobId: 'a' }, 'blocked', 'sections', {
    assertCurrent: () => { if (!current) throw new Error('stale-scope'); },
  });
  current = false;
  gate.resolve();
  await assert.rejects(pending, /stale-scope/);
  assert.equal(writes, 0);
});

test('real bridge to dispatcher to fields tab and native action returns a checkpoint receipt', async () => {
  const { createFactoryControlCommandBridge } = await load('factory-control-command-bridge.mjs');
  const { createFieldsFactoryTab } = await import(pathToFileURL(path.join(root, 'src/menus/factory/tabs/fields-tab.mjs')));
  const h = await harness();
  Object.assign(h.context, {
    factoryAutomationCounts: () => ({}), factoryAutomationReviewSummary: () => ({ fields: [{ id: 'material', label: '소재' }] }),
    factoryRuntimeBridgeAction: (_name, operation, execute) => {
      assert.equal(h.store.isOperationCurrent(operation.operationToken), true);
      const draft = structuredClone(h.store.getSnapshot().factory);
      const value = execute(draft);
      h.store.update(() => draft, { owner: 'factory', expectedRevision: h.store.getOperationToken().revision });
      return { schema: 'factory-runtime-command-receipt:v1', operationToken: h.store.getOperationToken(), value };
    },
    factoryCommitAutomationWizardFieldValue: (fieldId, value, _label, _render, draft) => {
      draft.product.finalDb = { ...draft.product.finalDb, [fieldId]: value };
    },
  });
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeFieldsActions'), h.context);
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeControlCommand'), h.context);
  h.context.factoryRuntimeFieldsTab = createFieldsFactoryTab({ getSnapshot: () => h.store.getSnapshot(),
    assertMutable: () => h.store.assertMutable('product-db'), getOperationToken: () => h.store.getOperationToken(),
    isOperationCurrent: token => h.store.isOperationCurrent(token), reportError() {}, actions: { ...h.context.factoryRuntimeFieldsActions() } });
  const bridge = createFactoryControlCommandBridge({ requestClassicRuntime: request => h.context.factoryRuntimeControlCommand(request) });
  const result = await bridge.run('factory-control', 'invokeFactoryTabCommand', payload({ tabId: 'fields', action: 'commitField', value: { fieldId: 'material', label: '소재', value: '새 소재' } }));
  assert.equal(result.status, 'applied');
  assert.equal(result.projection.session.storeRevision, 5);
  assert.equal(result.checkpoint.status, 'blocked');
  assert.equal(result.checkpoint.stageKey, 'sections');
  assert.equal(h.store.getSnapshot().factory.product.finalDb.material, '새 소재');
  assert.equal(h.store.getSnapshot().factory.assets[0].id, 'keep');
});
