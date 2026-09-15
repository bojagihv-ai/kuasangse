const test = require('node:test');
const assert = require('node:assert/strict');
const { driver, deferred } = require('./native_factory_command_fixture.cjs');
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('whole fields and multi-use toggle are one original command, not local fallbacks', async () => {
  const h = await driver({ originalActions: true });
  await h.tabs.fields.invoke('commitAllFields', { fields: [{ fieldId: 'material', value: '면', eventType: 'input' }], renderAfter: true });
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].payload.action, 'commitAllFields');
  assert.equal(h.calls.filter(value => value === 'factory/fields:commitAllFields').length, 1);
  assert.equal(h.readLocal().store.getSnapshot().factory.product.finalDb.material, '면');
  const assets = await driver({ originalActions: true });
  await assets.tabs.assets.invoke('toggleAssetUse', 'photo-0');
  assert.equal(assets.posts.length, 1);
  assert.equal(assets.posts[0].payload.tabId, 'assets');
  assert.equal(assets.posts[0].payload.value, 'photo-0');
  assert.equal(assets.calls.filter(value => value === 'factory/assets:toggleFactoryAssetUse').length, 1);
  assert.deepEqual(assets.readLocal().store.getSnapshot().factory.stages.hero.selectedAssetIds, ['photo-1']);
  assert.equal(assets.readLocal().store.getSnapshot().factory.assets[0].used, false);
  assert.equal(assets.readLocal().store.getSnapshot().factory.assets[1].used, true);
});

test('explicit save waits for local async and commits only the same job checkpoint', async () => {
  const gate = deferred();
  const h = await driver({ actionGate: gate });
  const local = h.tabs.assets.invoke('addStageFiles', [new File(['keep'], 'keep.png')]);
  assert.throws(() => h.routing.save(), /pending/);
  gate.resolve(); await local;
  const receipt = await h.routing.save();
  assert.equal(receipt.value.action, 'save-checkpoint');
  assert.equal(h.posts[0].payload.tabId, 'workfile');
  assert.equal(h.routing.dirty, false);
});

test('refresh retains lost-response binding and fences every new key', async () => {
  const storage = memoryStorage();
  const h = await driver({ lostPost: true, storage, emptyBoot: true });
  await assert.rejects(h.invoke(), /response-lost/);
  assert.ok(storage.getItem('native-factory-command:v1'));
  await Promise.all([...h.server.orders.values()].map(order => order.promise));
  const fresh = await driver({ storage, server: h.server, bootEmpty: true });
  assert.notEqual(fresh.context, h.context);
  assert.notEqual(fresh.readLocal().store, h.readLocal().store);
  assert.equal(fresh.readLocal().jobId, '');
  assert.equal(fresh.readLocal().session.productKey, '');
  assert.equal(fresh.readLocal().session.workspaceId, '');
  assert.equal(fresh.routing.pending, true);
  assert.throws(fresh.invoke, /pending/);
  const count = h.posts.length;
  await fresh.routing.reconcile();
  assert.equal(h.posts.length, count, 'reloaded reconciliation is read-only');
  assert.equal(fresh.posts.length, 0);
  assert.equal(h.calls.filter(value => value === 'local').length, 1);
  assert.equal(fresh.routing.pending, false);
  assert.equal(fresh.readLocal().jobId, 'a');
  assert.equal(fresh.calls.filter(value => value === 'restore').length, 1);
  assert.equal(fresh.readLocal().store.getSnapshot().factory.assets.length, 6);
});

test('real multi-use action and saved A+B survive an empty first boot without any POST replay', async () => {
  const h = await driver({ storage: memoryStorage(), originalActions: true, lostPost: true, emptyBoot: true });
  const before = h.readLocal().store.getSnapshot().factory;
  await assert.rejects(h.tabs.assets.invoke('toggleAssetUse', 'photo-0'), /response-lost/);
  await Promise.all([...h.server.orders.values()].map(order => order.promise));
  const fresh = await driver({ storage: h.options.storage, server: h.server, bootEmpty: true, originalActions: true });
  assert.equal(fresh.readLocal().session.workspaceId, '');
  await fresh.routing.reconcile();
  const after = fresh.readLocal().store.getSnapshot().factory;
  assert.equal(h.posts.length, 1);
  assert.equal(fresh.posts.length, 0);
  assert.equal(h.calls.filter(value => value === 'factory/assets:toggleFactoryAssetUse').length, 1);
  assert.equal(h.calls.filter(value => value === 'checkpoint').length, 1);
  assert.deepEqual(after.stages.hero.selectedAssetIds, ['photo-1']);
  assert.deepEqual(after.fields, before.fields);
  assert.equal(after.assets.length, before.assets.length);
  assert.deepEqual(after.product, before.product);
  assert.equal(fresh.routing.canOpen('b'), true);
});

test('refresh with only journal never clears pending for unknown, running, foreign, or missing saved receipt', async () => {
  for (const mode of ['getError', 'pendingReceipt', 'missingSaved']) {
    const h = await driver({ storage: memoryStorage(), lostPost: true, emptyBoot: true });
    await assert.rejects(h.invoke());
    await Promise.all([...h.server.orders.values()].map(order => order.promise));
    const fresh = await driver({ storage: h.options.storage, server: h.server, bootEmpty: true });
    fresh.options[mode] = true;
    await assert.rejects(fresh.routing.reconcile());
    assert.equal(h.posts.length, 1);
    assert.equal(fresh.routing.pending, true);
    assert.throws(fresh.invoke, /pending/);
    fresh.options[mode] = false;
    await fresh.routing.reconcile();
    assert.equal(fresh.posts.length, 0);
    assert.equal(h.posts.length, 1);
  }
});

test('interrupted local File requires explicit verified recovery then reattachment and checkpoint save', async () => {
  const storage = memoryStorage();
  const gate = deferred(), h = await driver({ storage, actionGate: gate, emptyBoot: true });
  const local = h.tabs.assets.invoke('addStageFiles', [new File(['A+B'], 'B.png')]);
  const interruptedJournal = storage.getItem('native-factory-command:v1');
  gate.resolve(); await local;
  storage.setItem('native-factory-command:v1', interruptedJournal);
  const fresh = await driver({ storage, server: h.server, bootEmpty: true });
  assert.throws(() => fresh.routing.save(), /pending/);
  fresh.options.missingSaved = true;
  await assert.rejects(fresh.routing.recoverLocal(), /unverified/);
  assert.equal(fresh.routing.localActive, true);
  fresh.options.missingSaved = false;
  await fresh.routing.recoverLocal();
  assert.equal(fresh.routing.localActive, false);
  assert.equal(fresh.routing.dirty, true, 'editing recovery is not checkpoint success');
  await fresh.tabs.assets.invoke('addStageFiles', [new File(['A+B'], 'B.png')]);
  await fresh.routing.save();
  assert.equal(fresh.posts.length, 1);
  assert.equal(fresh.posts[0].payload.action, 'save-checkpoint');
  assert.equal(fresh.routing.canOpen('b'), true);
});

test('bound job identity edits are rejected before the original handler or File serialization', async () => {
  const h = await driver();
  const before = h.readLocal().store.getSnapshot();
  const file = new File(['new'], 'new.png');
  Object.defineProperty(file, 'toJSON', { value: () => assert.fail('File serialized') });
  for (const action of ['setProductName', 'setProductImage', 'promoteStoredProductImage', 'runDb']) {
    assert.throws(() => h.routing.dispatch({ tabId: 'factory/start', commandName: action, args: [action === 'setProductImage' ? file : '다른 제품'] }), /requires_new_job/);
  }
  assert.deepEqual(h.readLocal().store.getSnapshot(), before);
  assert.equal(h.posts.length, 0);
  assert.equal(h.routing.dirty, false);
});

test('session storage failure fences before any external command', async () => {
  const h = await driver({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
  assert.throws(h.invoke, /quota/);
  assert.equal(h.posts.length, 0);
  assert.equal(h.calls.length, 0);
});

test('pending A-cut selection survives empty boot and reconciles by same key without a second selection', async () => {
  const h = await driver({ storage: memoryStorage(), lostPost: true, emptyBoot: true });
  await assert.rejects(h.tabs.assets.invoke('selectACut', { stageKey: 'hero', candidateId: 'cut-a' }));
  await Promise.all([...h.server.orders.values()].map(order => order.promise));
  const fresh = await driver({ storage: h.options.storage, server: h.server, bootEmpty: true });
  await fresh.routing.reconcile();
  assert.equal(h.posts.length, 1);
  assert.equal(fresh.posts.length, 0);
  assert.equal(h.calls.filter(value => value === 'local').length, 1);
  assert.equal(fresh.routing.pending, false);
});
