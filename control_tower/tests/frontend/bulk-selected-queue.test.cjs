const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/bulk-intake.mjs'), 'utf8');
const clickCode = source.slice(source.indexOf('  async function onClick('), source.indexOf('  function fillSizePairFromSize('));
const targetCode = source.slice(source.indexOf('  function invalidateConfirmation('), source.indexOf("  const batchTools ="));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('selected intake regression is registered once in the existing daily manifest', () => {
  const { buildRegressionSteps } = require('../../../tools/regression_manifest.cjs');
  const matches = buildRegressionSteps().filter(step => step.id === 'CT-INPUT-02');
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].args, ['--test', 'control_tower/tests/frontend/bulk-selected-queue.test.cjs', 'control_tower/tests/frontend/bulk-intake-automation-confirm.test.cjs']);
});

async function driver() {
  const model = await import('../../frontend/src/bulk-intake-model.mjs');
  const grouped = { products: ['A', 'B', 'C'].map(productName => ({ productName, images: [{ file: new File(['keep'], `${productName}.png`), fileName: `${productName}.png`, role: 'base' }], requiredValues: { widthMm: '150', depthMm: '80' } })) };
  const calls = [], statuses = [];
  class Element { constructor(scope) { this.dataset = { action: 'submit', queueScope: scope }; } closest() { return this; } }
  const context = vm.createContext({ Element, grouped, plan: model.buildBulkPlan(grouped), BLOCKING_ISSUES: model.BLOCKING_ISSUES,
    selectedForCommon: new Set(), busy: false, restorePending: false, inputReads: 0, composing: false,
    confirming: false, inputVersion: 0, planTimer: null, confirmState: null,
    imageModelSelect: { value: 'image-a' }, getJudgmentSettings: async () => ({ model: 'judgment-a', reasoningEffort: 'high' }),
    render() {}, clearTimeout() {}, setStatus: message => statuses.push(message),
    submitPlan: confirmed => calls.push(confirmed),
  });
  vm.runInContext(targetCode + clickCode, context);
  return { context, calls, statuses, click: scope => context.onClick({ target: new Element(scope) }) };
}

test('empty selected target is zero; all is explicit and excludes blocked/queued rows', async () => {
  const h = await driver(), c = h.context;
  await h.click('selected');
  assert.equal(c.confirmState, null);
  assert.equal(h.calls.length, 0);
  c.plan.entries[1].queued = true;
  c.plan.entries[2].issues.push('image_missing');
  await h.click('all');
  assert.equal(c.confirmState.entries.length, 1);
  assert.equal(c.confirmState.excluded, 2);
  await h.click('all');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].groups[0], c.grouped.products[0]);
});

for (const change of ['selection', 'image-model', 'values', 'photo', 'judgment']) test(`async confirmation requires a new confirmation after ${change}`, async () => {
  const h = await driver(), c = h.context;
  c.selectedForCommon.add(c.grouped.products[1]);
  await h.click('selected');
  const original = c.confirmState;
  const gate = deferred();
  c.getJudgmentSettings = () => gate.promise;
  const pending = h.click('selected');
  await h.click('selected');
  assert.equal(h.calls.length, 0);
  if (change === 'selection') { c.selectedForCommon.clear(); c.selectedForCommon.add(c.grouped.products[2]); }
  if (change === 'image-model') c.imageModelSelect.value = 'image-b';
  if (change === 'values') c.plan.entries[1].requiredValues.material = '면';
  if (change === 'photo') c.plan.entries[1].images[0].role = 'base-and-color';
  if (change !== 'judgment') c.invalidateConfirmation();
  gate.resolve({ model: change === 'judgment' ? 'judgment-b' : 'judgment-a', reasoningEffort: 'high' });
  await pending;
  assert.equal(h.calls.length, 0);
  if (change === 'values') assert.equal(original.entries[0].requiredValues.material, undefined);
  if (change === 'photo') assert.equal(original.entries[0].images[0].role, 'base');
  assert.equal(c.confirmState.entries[0].productName, change === 'selection' ? 'C' : 'B');
  await h.click('selected');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0], c.confirmState, 'the same confirmed object reaches submit');
});

test('local file/CSV read or restoring state cannot start either submit scope', async () => {
  for (const key of ['inputReads', 'restorePending']) {
    const h = await driver();
    h.context[key] = true;
    await h.click('all');
    assert.equal(h.context.confirmState, null);
    assert.equal(h.calls.length, 0);
  }
});

test('legacy commonTargets and pending request survive reload without serializing File; common apply leaves pending input unchanged', async () => {
  const model = await import('../../frontend/src/bulk-intake-model.mjs');
  const queueRequest = { payload: { batchId: 'original-2-B', idempotencyKey: 'same-C', productName: 'C', inputImages: [{ sha256: 'proof', role: 'base' }] }, judgment: { model: 'original' } };
  const grouped = { products: [{ productName: 'A', images: [], requiredValues: { material: 'keep' } },
    { productName: 'C', queueRequest, images: [{ blobId: 'c', fileName: 'c.png', file: new File(['bytes'], 'c.png') }] }] };
  const before = structuredClone(grouped.products[0]);
  const stored = model.serializeWorkingState({ grouped, settings: { commonTargets: [1], selectedProductIndex: 0 } });
  assert.equal(stored.products[1].images[0].file, undefined);
  const fresh = model.hydrateWorkingState(stored, new Map([['c', new Blob(['bytes'])]]));
  assert.notEqual(fresh.grouped.products[1], grouped.products[1]);
  assert.deepEqual(fresh.grouped.products[1].queueRequest, queueRequest);
  assert.deepEqual(fresh.settings.commonTargets, [1]);
  assert.equal(model.fillBulkProductRequiredValues(fresh.grouped.products[1], {}, { material: 'wrong' }), 0);
  assert.equal(await fresh.grouped.products[1].images[0].file.text(), 'bytes');
  assert.deepEqual(grouped.products[0], before);
});
