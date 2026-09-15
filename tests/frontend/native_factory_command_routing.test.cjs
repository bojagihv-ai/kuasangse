const test = require('node:test');
const assert = require('node:assert/strict');
const { driver, deferred, fn } = require('./native_factory_command_fixture.cjs');

async function contract(actions = {}, execute = () => true, runtime = {}) {
  const { createFactoryTabContract } = await import('../../src/menus/factory/factory-tab-contract.mjs');
  const token = Object.freeze({ workspaceId: 'batch:a' });
  return createFactoryTabContract({
    version: 'factory-tab:v1', id: 'factory/competitor', owner: 'competitors',
    capabilities: ['competitors:write'], commands: { guideAction: { capability: 'competitors:write', execute } },
    select: () => Object.freeze({}), render() {}, bind: () => () => {}, onEnter() {}, onLeave() {},
    persistence: { reads: ['competitors'], writes: ['competitors'] },
  }, { getSnapshot: () => Object.freeze({}), assertMutable() {}, getOperationToken: () => token,
    isOperationCurrent: value => value === token, reportError() {}, actions, renderHelpers: {}, ...runtime });
}

test('dispatch intercepts before local execution; worker local keeps the original command exactly once', async () => {
  // Given an intercepted original toggle.
  const calls = [];
  let tab;
  tab = await contract({ dispatchFactoryCommand: request => {
    calls.push('dispatch');
    assert.equal(request.tabId, 'factory/competitor');
    return { handled: true, result: Promise.resolve().then(() => tab.invokeLocal(request.commandName, ...request.args)) };
  } }, () => { calls.push('local'); return 'applied'; });
  // When the UI invokes it.
  assert.equal(await tab.invoke('guideAction', 'toggle-market:x'), 'applied');
  // Then dispatch precedes the single worker-local execution.
  assert.deepEqual(calls, ['dispatch', 'local']);
});

test('unhandled dispatch keeps local return timing and declaration checks', async () => {
  const calls = [];
  const tab = await contract({ dispatchFactoryCommand: () => { calls.push('dispatch'); } }, value => value);
  assert.equal(tab.invoke('guideAction', 'local'), 'local');
  assert.throws(() => tab.invokeLocal('unknown'), /undeclared/);
  assert.deepEqual(calls, ['dispatch']);
});

test('real runtime contract -> dispatcher -> worker-local -> checkpoint -> server receipt runs a toggle once and preserves A', async () => {
  const h = await driver();
  const before = h.readLocal().store.getSnapshot().factory;
  const receipt = await h.invoke();
  assert.deepEqual(h.calls, ['sync', 'post', 'local', 'checkpoint']);
  assert.equal(receipt.status, 'applied');
  assert.equal(h.routing.pending, false);
  const after = h.readLocal().store.getSnapshot().factory;
  assert.equal(after.selected, true);
  for (const key of ['fields', 'assets', 'logs']) assert.deepEqual(after[key], before[key]);
  assert.equal(h.posts[0].url, '/api/factory/jobs/a/tab-command');
});

test('lost or undefined acceptance remains fenced and reconciles the same key without replaying the toggle', async () => {
  for (const mode of ['lostPost', 'undefinedPost']) {
    const h = await driver({ [mode]: true });
    await assert.rejects(h.invoke(), /response-lost|unknown/);
    assert.ok(h.routing.pending);
    assert.throws(h.invoke, /pending/);
    assert.equal(h.routing.canOpen('b'), false);
    await h.routing.reconcile();
    assert.equal(h.calls.filter(call => call === 'local').length, 1);
    assert.equal(h.readLocal().store.getSnapshot().factory.selected, true);
    assert.deepEqual(h.posts[0].payload, h.posts[1].payload);
    assert.equal(h.routing.canOpen('b'), true);
  }
});

test('accepted timeout, missing receipt and mismatched receipt keep the fence until matching terminal receipt', async () => {
  for (const mode of ['pendingReceipt', 'getError', 'foreignReceipt']) {
    const h = await driver({ [mode]: true });
    await assert.rejects(h.invoke());
    assert.ok(h.routing.pending);
    assert.throws(() => h.routing.assertWorkerJob('b'), /pending/);
    h.options[mode] = false;
    await h.routing.reconcile();
    assert.equal(h.posts.length, 1);
    assert.equal(h.calls.filter(call => call === 'local').length, 1);
  }
});

test('failed terminal execution releases interaction but keeps dirty job-switch hold', async () => {
  const h = await driver({ failAction: true });
  await assert.rejects(h.invoke(), /not_applied/);
  assert.equal(h.routing.pending, false);
  assert.equal(h.routing.dirty, true);
  assert.equal(h.routing.canOpen('b'), false);
  assert.equal(h.routing.canOpen('a'), true);
  assert.equal(h.calls.includes('checkpoint'), false);
});

test('store replacement or same-work data changes across sync are rejected before any submit', async () => {
  for (const change of ['replaceStore', 'change']) {
    const gate = deferred();
    const h = await driver({ syncGate: gate });
    const pending = h.invoke();
    h[change]({ selected: true });
    gate.resolve();
    await assert.rejects(pending, /stale/);
    assert.equal(h.posts.length, 0);
  }
  const h = await driver({ projection: { session: {} } });
  await assert.rejects(h.invoke(), /stale/);
  assert.equal(h.posts.length, 0);
});

test('candidate identity is captured synchronously and fields discard UI-only keys on the wire', async () => {
  const gate = deferred();
  const db = await driver({ syncGate: gate });
  const request = db.tabs.db.invoke('apply-db-candidate', { index: 3 });
  assert.deepEqual(db.calls, ['capture:sinhwa:3', 'sync']);
  gate.resolve();
  await request;
  assert.deepEqual(db.posts[0].payload.value, { candidateIdentity: db.identity });
  const fields = await driver();
  await fields.tabs.fields.invoke('commitField', { id: 'material', value: '보존', label: '소재', eventType: 'input', renderAfter: true, previousValue: 'A' });
  assert.deepEqual(fields.posts[0].payload.value, { fieldId: 'material', value: '보존', label: '소재' });
});

test('File and FileList stay local without serialization or job diversion', async () => {
  const h = await driver();
  const file = new File(['local'], 'local.png');
  Object.defineProperty(file, 'toJSON', { value: () => { throw new Error('File serialized'); } });
  for (const value of [[file], { files: [file] }, { [Symbol.toStringTag]: 'FileList', 0: file, length: 1 }]) {
    await h.tabs.assets.invoke('addStageFiles', value);
  }
  assert.equal(h.posts.length, 0);
  assert.equal(h.routing.dirty, true);
  assert.throws(() => h.routing.beginOpen('b'), /dirty/);
});

test('original 8081/hidden route remains local; pending human command cannot use the worker bypass', async () => {
  const local = await driver({ native: false });
  await local.invoke();
  assert.deepEqual(local.calls, ['local']);
  const gate = deferred();
  const h = await driver({ actionGate: gate });
  const pending = h.invoke();
  assert.throws(() => h.tabs.assets.invoke('toggleAssetUse', 'x'), /pending/);
  gate.resolve();
  await pending;
  assert.equal(h.calls.filter(call => call === 'local').length, 1);
});

test('A-cut routes through the existing select endpoint and actual worker-local selection to matching SSE checkpoint receipt', async () => {
  const h = await driver();
  const receipt = await h.tabs.assets.invoke('selectACut', { stageKey: 'hero', candidateId: 'cut-a' });
  assert.equal(receipt.schema, 'factory-a-cut-receipt:v1');
  assert.equal(h.posts[0].url, '/api/factory/jobs/a/select');
  assert.equal(h.posts[0].payload.decisionMode, 'manual');
  assert.deepEqual(h.calls, ['sync', 'post', 'local', 'checkpoint', 'close']);
  assert.equal(h.routing.pending, false);
});

test('worker local preserves mutability, token and error guards', async () => {
  const errors = [], calls = [];
  const readonly = await contract({}, () => calls.push('local'), {
    assertMutable() { throw new Error('READ_ONLY'); }, reportError: error => errors.push(error.message),
  });
  assert.throws(() => readonly.invokeLocal('guideAction'), /READ_ONLY/);
  assert.deepEqual(calls, []);
  const stale = await contract({}, async () => true, { isOperationCurrent: () => false, reportError: error => errors.push(error.code) });
  await assert.rejects(stale.invokeLocal('guideAction'), /STALE_FACTORY_TAB_OPERATION/);
  assert.deepEqual(errors, ['READ_ONLY', 'STALE_FACTORY_TAB_OPERATION']);
});

test('native detection excludes 8081 and hidden worker; only explicit native console enables routing', async () => {
  const { isNativeFactoryConsole } = await import('../../src/modules/native-factory-command-routing.mjs');
  for (const href of ['http://127.0.0.1:8081/app.html', 'http://127.0.0.1:42011/factory-native/app.html?batchWorker=1',
    'http://127.0.0.1:8081/app.html?batchWorker=1&batchConsole=1']) assert.equal(isNativeFactoryConsole({ href }), false);
  assert.equal(isNativeFactoryConsole({ href: 'http://127.0.0.1:42011/factory-native/app.html?batchWorker=1&batchConsole=1' }), true);
});

test('Task10 publish worker inspect/run/verify remain on original guarded actions, outside native dispatch', async () => {
  const vm = require('node:vm');
  const { createPublishFactoryTab } = await import('../../src/menus/factory/tabs/publish-tab.mjs');
  const h = await driver();
  const calls = [];
  const context = vm.createContext({ factoryRuntimeReadViewSnapshot: () => Object.freeze({}),
    factoryRuntimeRequireStore: () => h.readLocal().store, factoryRuntimeIsOperationCurrent: token => h.readLocal().store.isOperationCurrent(token),
    installFactoryRuntimeStart: { nativeCommands: { dispatchNativeFactoryCommand: () => assert.fail('publish diverted') } },
    originalPublish: value => { calls.push(value.action); return true; },
  });
  vm.runInContext(fn('factoryRuntimeCapabilities'), context);
  context.capabilities = vm.runInContext("factoryRuntimeCapabilities({ runFactoryGuideAction: originalPublish }, {}, 'cafe24')", context);
  const tab = createPublishFactoryTab({ ...context.capabilities, actions: { ...context.capabilities.actions }, renderHelpers: {} });
  assert.equal(Object.hasOwn(context.capabilities.actions, 'dispatchFactoryCommand'), false);
  for (const prefix of ['inspect', 'run', 'verify']) {
    assert.equal(await tab.invoke('runGuideAction', { action: `${prefix}-batch-cafe24-registration` }), true);
  }
  assert.deepEqual(calls, ['inspect-batch-cafe24-registration', 'run-batch-cafe24-registration', 'verify-batch-cafe24-registration']);
  assert.equal(h.routing.dirty, false);
});
