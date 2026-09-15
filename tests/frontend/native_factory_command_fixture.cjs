const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../../src/app-core-03.js'), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

async function driver(options = {}) {
  const { createFactoryStore } = await import('../../src/modules/factory-store.mjs');
  const { createFactoryTabContract } = await import('../../src/menus/factory/factory-tab-contract.mjs');
  const { tabCommandPayload } = await import('../../src/modules/factory-control-payloads.mjs');
  const { createFactoryControlCommandBridge } = await import('../../src/modules/factory-control-command-bridge.mjs');
  const { createNativeFactoryCommandRouting } = await import('../../src/modules/native-factory-command-routing.mjs');
  const { createNativeCommandJournal, nativeCommandDigest } = await import('../../src/modules/native-command-journal.mjs');
  const digest = bytes => require('node:crypto').webcrypto.subtle.digest('SHA-256', bytes);
  const { buildFactoryTabCommand } = await import('../../control_tower/frontend/src/factory-operator-controls.mjs');
  const initial = { factory: { workspace: { id: 'batch:a' }, product: { productName: '상품', currentRunId: 'run-a', inputImageFingerprint: 'photo-a', finalDb: { material: '원본', sale_price: '1000' } },
    goalRun: { jobId: 'a', running: false }, fields: Array.from({ length: 36 }, (_, i) => `field-${i}`),
    assets: Array.from({ length: 6 }, (_, i) => ({ id: `photo-${i}`, stageId: 'hero', used: i < 2 })),
    stages: { hero: { selectedAssetIds: ['photo-0', 'photo-1'] } }, logs: ['keep'], selected: false } };
  const server = options.server || { orders: new Map(), savedSnapshot: initial, savedRevision: 7 };
  let store = createFactoryStore(options.bootEmpty ? { workspaceId: 'empty', revision: 0, initialSnapshot: { factory: { product: {}, goalRun: {}, workspace: {} } } }
    : { workspaceId: 'batch:a', revision: 4, initialSnapshot: initial });
  let revision = options.bootEmpty ? 0 : 7, routing, received;
  const calls = [], posts = [], statuses = [], orders = server.orders;
  const checkpoint = { schema: 'factory-product-checkpoint:v1', jobId: 'a', projectId: 'batch:a', productId: 'factory:상품',
    productKey: '상품', runId: 'run-a', inputFingerprint: 'photo-a', revision, status: 'waiting_manual', stageKey: 'competitors', savedAt: 123 };
  const context = vm.createContext({ state: { currentProjectId: options.bootEmpty ? '' : 'batch:a' }, installFactoryRuntimeStart: { tabCommandPayload },
    factoryRuntimeTabCommandReceipts: new Map(), factoryRuntimeTabCommandFlight: null,
    factoryRuntimeRequireStore: () => store, factoryRuntimeReadFactory: () => store.getSnapshot().factory,
    factoryRuntimeReadViewSnapshot: () => store.getSnapshot(), factoryCurrentProductKey: f => f.product.productName,
    factoryCurrentWorkflowRunId: f => f.product.currentRunId, factoryCurrentInputImageFingerprint: f => f.product.inputImageFingerprint,
    factoryCafe24TargetInfo: () => ({}), factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ scopeId: 'project:batch:a', counter: revision }),
    factoryRuntimeControlCheckpointFromProjection: Object.assign(() => checkpoint, { latest: checkpoint }),
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeDeferredOperationsPending: () => false,
    factoryAssetHasCurrentProductPayload: () => true, factoryAssetIsCompletedCurrentSizeRun: () => false,
    factoryAutomationReviewSummary: () => ({ fields: [{ id: 'material' }, { id: 'sale_price' }] }), factoryAutomationCounts: () => ({}),
    orderedSections: () => [{ id: 'hero' }], SECTION_BASIS_MODES: [], SECTION_GENERATION_MODES: [],
    SECTION_ASSEMBLY_SOURCES: [], SECTION_ASSEMBLY_CUT_USAGES: [],
  });
  for (const name of ['factoryRuntimeControlTabScope', 'factoryRuntimeControlTabScopeMatches', 'factoryRuntimeControlTabWorkflow',
    'factoryRuntimeControlValidateTabValue', 'factoryRuntimeControlInvokeTabCommand',
    'factoryRuntimeControlAssertSelection', 'factoryRuntimeControlSelectACut']) vm.runInContext(fn(name), context);
  const readLocal = () => ({ store, token: store.getOperationToken(), jobId: store.getSnapshot().factory.goalRun?.jobId || '', session: context.factoryRuntimeControlTabScope() });
  const projection = () => ({ schema: 'factory-control-projection:v1', connected: true, session: readLocal().session,
    registration: { jobId: 'a' }, cursor: '9', stages: [{ key: 'hero', candidates: [{ id: 'cut-a' }],
      selectedIds: store.getSnapshot().factory.selected ? ['cut-a'] : [] }],
    ...(options.originalActions ? { stages: [{ key: 'representative', candidates: store.getSnapshot().factory.assets || [],
      selectedIds: store.getSnapshot().factory.stages?.hero?.selectedAssetIds || [] }],
      inputs: [{ key: 'operator_controls', count: 1, items: [{ schema: 'factory-operator-controls:v1',
        fields: Object.entries(store.getSnapshot().factory.product.finalDb || {}).map(([fieldId, value]) => ({ fieldId, value })) }] }] } : {}),
  });
  context.factoryRuntimeControlProjection = async () => projection();
  Object.assign(context, {
    factoryRuntimeDetachedValue: structuredClone,
    factoryRuntimeControlAdoptProductProject: jobId => context.state.currentProjectId = `batch:${jobId}`,
    getCurrentDocumentWorkspaceScope: id => `project:${id}`, getCurrentLastWorkWorkspaceScope: () => 'project:batch:a',
    ensureWorkspaceEditAuthority: async scopeId => ({ mode: 'editing', scopeId }),
    saveCurrentProject: async guard => { guard.assertCurrent(); calls.push('checkpoint'); revision += 1;
      server.savedSnapshot = store.getSnapshot(); server.savedRevision = revision; return true; },
    factoryRuntimeControlCheckpointFromProjection: Object.assign((_payload, p, status, stageKey) => ({ ...checkpoint, revision: p.session.revision, status, stageKey }), { latest: checkpoint }),
    loadProjectRecord: async id => {
      calls.push('restore');
      if (options.missingSaved || !server.savedSnapshot) throw new Error('native_command_restore_unverified');
      store = createFactoryStore({ workspaceId: id, revision: 0, initialSnapshot: server.savedSnapshot });
      revision = server.savedRevision;
      return { payload: server.savedSnapshot };
    },
    factoryRuntimeUpdateOwnedFactory: async (_action, _owner, mutate) => {
      const draft = structuredClone(store.getSnapshot().factory), value = mutate(draft);
      store.update(() => draft, { owner: 'factory', expectedRevision: store.getOperationToken().revision }); return value;
    },
    factoryApplySelectedAssetsToSections: () => true, factoryRuntimeControlProvidedColorOptionsMatch: () => true,
  });
  for (const name of ['factoryRuntimeControlCheckpointProjectId', 'factoryRuntimeControlValidateProductCheckpoint',
    'factoryRuntimeControlProjectionMatchesCheckpoint', 'factoryRuntimeControlSaveProductCheckpoint', 'factoryRuntimeControlRestoreProductCheckpoint']) vm.runInContext(fn(name), context);
  const execute = async value => {
    calls.push('local'); await options.actionGate?.promise;
    if (options.failAction) return false;
    store.update(factory => ({ ...factory, selected: !factory.selected }), { owner: 'factory', expectedRevision: store.getOperationToken().revision });
    return Object.freeze({ schema: 'factory-runtime-command-receipt:v1', operationToken: store.getOperationToken(), value: true });
  };
  const tabs = {};
  for (const [id, names] of Object.entries({ competitor: ['guideAction', 'marketAction'], fields: ['commitField', 'commitAllFields'],
    db: ['apply-db-candidate', 'search'], sections: ['updateSectionAssemblySource'], assets: ['selectACut', 'toggleAssetUse', 'openStageFile', 'addStageFiles'] })) {
    tabs[id] = createFactoryTabContract({ version: 'factory-tab:v1', id: `factory/${id}`, owner: 'factory', capabilities: ['factory:write'],
      commands: Object.fromEntries(names.map(name => [name, { capability: 'factory:write', execute }])),
      select: () => store.getSnapshot(), render() {}, bind: () => () => {}, onEnter() {}, onLeave() {}, persistence: { reads: ['factory'], writes: ['factory'] },
    }, { getSnapshot: () => store.getSnapshot(), assertMutable: () => store.assertMutable('factory'), getOperationToken: () => store.getOperationToken(),
      isOperationCurrent: token => store.isOperationCurrent(token), reportError() {}, renderHelpers: {},
      actions: { dispatchFactoryCommand: request => options.native === false ? undefined : routing.dispatch(request) } });
  }
  Object.assign(context, { factoryRuntimeDbTab: tabs.db, factoryRuntimeFieldsTab: tabs.fields,
    factoryRuntimeCompetitorTab: tabs.competitor, factoryRuntimeSectionsTab: tabs.sections, factoryRuntimeAssetsTab: tabs.assets,
    saveLastWorkNow: async () => {}, factoryRuntimeSha256Text: async () => 'digest' });
  if (options.originalActions) {
    const { createFieldsFactoryTab } = await import('../../src/menus/factory/tabs/fields-tab.mjs');
    const { createAssetsFactoryTab } = await import('../../src/menus/factory/tabs/assets-tab.mjs');
    Object.assign(context, {
      factoryRuntimeBridgeAction: (name, operation, mutate) => {
        calls.push(name);
        const draft = structuredClone(store.getSnapshot().factory), value = mutate(draft);
        store.update(() => draft, { owner: 'factory', expectedRevision: store.getOperationToken().revision });
        return { schema: 'factory-runtime-command-receipt:v1', operationToken: store.getOperationToken(), value };
      },
      factoryCommitAutomationWizardFieldValue: (id, value, label, render, draft) => { draft.product.finalDb[id] = value; },
      factoryLog: (message, level, draft) => draft.logs.push(message), uniqueApiKeys: values => [...new Set(values)],
    });
    for (const name of ['factoryRuntimeFieldsActions', 'factoryRuntimeAssetsActions']) vm.runInContext(fn(name), context);
    const assetSource = fs.readFileSync(require('node:path').resolve(__dirname, '../../src/app-core-06.js'), 'utf8');
    const start = assetSource.indexOf('function factoryToggleAssetUse(');
    vm.runInContext(assetSource.slice(start, assetSource.indexOf('\nfunction ', start + 1)), context);
    const capabilities = actions => ({ getSnapshot: () => store.getSnapshot(), assertMutable: () => store.assertMutable('factory'),
      getOperationToken: () => store.getOperationToken(), isOperationCurrent: token => store.isOperationCurrent(token), reportError() {},
      renderHelpers: Object.fromEntries(['factoryAutomationCounts', 'factoryAutomationWizardTasks', 'renderFactoryAutomationStatusCard', 'renderFactoryAutomationAssetChooser', 'renderFactoryAutomationTaskChecklist'].map(name => [name, () => ({})])),
      actions: { ...actions, dispatchFactoryCommand: request => options.native === false ? undefined : routing.dispatch(request) } });
    tabs.fields = createFieldsFactoryTab(capabilities(context.factoryRuntimeFieldsActions()));
    tabs.assets = createAssetsFactoryTab(capabilities(context.factoryRuntimeAssetsActions()));
    Object.assign(context, { factoryRuntimeFieldsTab: tabs.fields, factoryRuntimeAssetsTab: tabs.assets });
  }
  const bridge = createFactoryControlCommandBridge({ requestClassicRuntime: request => context.factoryRuntimeControlInvokeTabCommand(request.payload) });
  const apiRequest = async (url, init = {}) => {
    if (url === '/api/factory/jobs') return { jobs: [{ jobId: 'a', status: 'waiting_manual' }] };
    if (init.method === 'POST') {
      const p = JSON.parse(init.body); posts.push({ url, payload: p }); calls.push('post');
      if (options.rejectPost) throw Object.assign(new Error('rejected'), { status: 409 });
      let order = orders.get(p.idempotencyKey);
      if (!order) {
        const execution = url.endsWith('/select') ? context.factoryRuntimeControlSelectACut(p) : bridge.invokeFactoryTabCommand(p);
        const promise = execution.then(receipt => {
          if (url.endsWith('/select')) received(receipt);
          return { status: 'completed', receipt };
        }, error => ({ status: 'failed', error: error.message }));
        order = { orderId: `order-${orders.size}`, promise, payload: p, selection: url.endsWith('/select') }; orders.set(p.idempotencyKey, order);
      } else await bridge.invokeFactoryTabCommand(p);
      if (options.lostPost && posts.length === 1) throw new Error('response-lost');
      if (options.undefinedPost && posts.length === 1) return undefined;
      return url.endsWith('/select') ? { accepted: true, order: { orderId: order.orderId } } : { accepted: true, orderId: order.orderId };
    }
    if (options.getError) throw Object.assign(new Error('receipt-unavailable'), { status: 404 });
    if (url.includes('/command-receipt/')) {
      const key = decodeURIComponent(url.split('/command-receipt/')[1]);
      const order = orders.get(key);
      if (!order) throw Object.assign(new Error('receipt-unavailable'), { status: 404 });
      return { jobId: 'a', orderId: order.orderId, idempotencyKey: key,
        commandName: order.selection ? 'selectFactoryACut' : 'invokeFactoryTabCommand',
        requestDigest: await nativeCommandDigest(order.payload, order.selection, digest),
        ...(options.pendingReceipt ? { status: 'running' } : await order.promise) };
    }
    const order = [...orders.values()].find(item => url.endsWith(`/${item.orderId}`));
    if (options.pendingReceipt) return { jobId: 'a', orderId: order.orderId, status: 'running' };
    const result = { jobId: 'a', orderId: order.orderId, ...await order.promise };
    if (options.foreignReceipt && result.receipt) result.receipt = { ...result.receipt, jobId: 'other' };
    return result;
  };
  const identity = Object.freeze({ type: 'sinhwa', candidateKey: 'clicked', productNo: '', jcode: 'clicked', productCode: '', scopeKey: 'scope', identityKey: 'identity' });
  const io = { readLocal, readLocalProjection: async () => projection(), digest,
    randomUUID: () => require('node:crypto').randomUUID(),
    journal: createNativeCommandJournal({ read: () => options.storage?.getItem('native-factory-command:v1'),
      write: text => options.storage?.setItem('native-factory-command:v1', text) }),
    restoreCheckpoint: receipt => context.factoryRuntimeControlRestoreProductCheckpoint({ jobId: receipt.checkpoint.jobId,
      checkpoint: receipt.checkpoint, restoreBaseline: receipt.projection.stages, restoreOnly: true }),
    restoreLocalDraft: async () => {
      if (options.missingSaved) throw new Error('native_command_restore_unverified');
      calls.push('restore-local');
      store = createFactoryStore({ workspaceId: 'batch:a', revision: 0, initialSnapshot: server.savedSnapshot });
      revision = server.savedRevision;
      context.state.currentProjectId = 'batch:a';
    },
    verifySavedCheckpoint: async checkpoint => !options.missingSaved && server.savedRevision >= checkpoint.revision,
    readSavedLocalProof: async () => !options.missingSaved,
    buildCommand: buildFactoryTabCommand, apiRequest,
    readProjection: async () => { await options.projectionGate?.promise; return options.projection || projection(); },
    syncProjection: async () => { calls.push('sync'); await options.syncGate?.promise; },
    captureCandidate: (type, index) => { calls.push(`capture:${type}:${index}`); return identity; },
    watchSelection: (_cursor, receive) => { received = receive; return () => calls.push('close'); },
    onState: value => statuses.push(value), wait: () => new Promise(resolve => setImmediate(resolve)), maxPolls: 2,
  };
  routing = createNativeFactoryCommandRouting(io);
  return { tabs, io, useRouting: value => { routing = value; }, get routing() { return routing; }, server, calls, posts, statuses, context, options, readLocal, projection, identity,
    invoke: () => tabs.competitor.invoke('marketAction', { type: 'toggle-candidate', candidateId: 'x' }),
    replaceStore: () => { store = createFactoryStore({ workspaceId: 'batch:a', revision: 4, initialSnapshot: initial }); },
    change: patch => store.update(factory => ({ ...factory, ...patch }), { owner: 'factory', expectedRevision: store.getOperationToken().revision }),
    receive: value => received(value),
  };
}
module.exports = { driver, deferred, fn };
