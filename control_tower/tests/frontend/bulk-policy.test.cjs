const assert = require('node:assert/strict');
const test = require('node:test');

test('visible preset and per-product decisions stay independent of hidden menu and freeze exactly', async () => {
  const policy = await import('../../frontend/src/automation-policy-model.mjs');
  const ids = Object.keys(policy.AUTOMATION_DECISIONS);
  const auto = Object.fromEntries(ids.map(id => [id, 'auto']));
  const registry = { decisionPointIds: ids, presets: { full_auto: auto, all_images_manual: { ...auto, representative_image: 'manual', size_image: 'manual', option_image: 'manual', general_image: 'manual' } } };
  const common = { size_image: 'auto' };
  const product = { representative_image: 'auto', final_detail: 'manual' };
  const request = { batchId: 'batch-A', productId: '지갑', preset: 'all_images_manual', batchOverride: common, productOverride: product, stageOverride: {} };
  const resolved = policy.resolveInputPolicy(registry, request);
  assert.equal(resolved.representative_image, 'auto');
  assert.equal(resolved.size_image, 'auto');
  assert.equal(resolved.option_image, 'manual');
  assert.equal(resolved.final_detail, 'manual');
  assert.equal(policy.resolveInputPolicy(registry, { ...request, productOverride: {} }).final_detail, 'auto');
  assert.deepEqual(policy.setInputDecision({}, 'competitor_product', 'manual', ids), Object.fromEntries(ids.filter(id => id.startsWith('competitor_')).map(id => [id, 'manual'])));
  assert.deepEqual(policy.setInputDecision({ final_detail: 'manual' }, 'competitor_product', '', ids), { final_detail: 'manual' });
  const snapshot = { locked: true, batchId: 'batch-A', productId: '지갑', resolved };
  assert.doesNotThrow(() => policy.assertInputPolicySnapshot(snapshot, request, resolved));
  assert.throws(() => policy.assertInputPolicySnapshot({ ...snapshot, productId: '다른 제품' }, request, resolved));
  assert.throws(() => policy.assertInputPolicySnapshot({ ...snapshot, resolved: auto }, request, resolved));
  assert.throws(() => policy.resolveInputPolicy(null, request));
  assert.throws(() => policy.resolveInputPolicy(registry, { ...request, productOverride: { unknown: 'manual' } }));
});

test('product decisions and frozen queued decisions survive working-state round trip', async () => {
  const { serializeWorkingState, hydrateWorkingState, buildBulkPlan } = await import('../../frontend/src/bulk-intake-model.mjs');
  const product = { productName: '지갑', images: [], decisionOverrides: { size_image: 'manual' }, queuedPolicySnapshot: { locked: true, resolved: { size_image: 'manual' } } };
  const stored = serializeWorkingState({ grouped: { products: [product] }, settings: { decisionOverrides: { representative_image: 'auto' } } });
  const revived = hydrateWorkingState(stored, new Map());
  assert.deepEqual(revived.grouped.products[0].decisionOverrides, product.decisionOverrides);
  assert.deepEqual(revived.grouped.products[0].queuedPolicySnapshot, product.queuedPolicySnapshot);
  assert.deepEqual(buildBulkPlan(revived.grouped).entries[0].decisionOverrides, product.decisionOverrides);
});

test('only an accepted matching queue receipt can lock a prepared product', async () => {
  const { readBulkQueueReceipt } = await import('../../frontend/src/bulk-intake-model.mjs');
  const input = { productName: '지갑', batchId: '묶음-A' };
  const job = { jobId: 'factory-job-1', ...input };
  assert.deepEqual(readBulkQueueReceipt({ accepted: true, job }, input), job);
  for (const invalid of [null, {}, { accepted: false }, { accepted: true, job: {} }, { accepted: true, job: { ...job, jobId: ' ' } }, { accepted: true, job: { ...job, productName: '다른 제품' } }, { accepted: true, job: { ...job, batchId: '묶음-B' } }]) {
    assert.throws(() => readBulkQueueReceipt(invalid, input));
  }
});

test('row summary counts actual decisions without changing full names or locked values', async () => {
  const policy = await import('../../frontend/src/automation-policy-model.mjs');
  const ids = Object.keys(policy.AUTOMATION_DECISIONS);
  const auto = Object.fromEntries(ids.map(id => [id, 'auto']));
  const manual = Object.fromEntries(ids.map(id => [id, 'manual']));
  const registry = { decisionPointIds: ids, presets: { full_auto: auto } };
  const mixed = policy.resolveInputPolicy(registry, { preset: 'full_auto', productOverride: { competitor_coupang: 'manual', final_detail: 'manual' } });
  const snapshot = Object.freeze({ locked: true, resolved: Object.freeze({ ...manual }) });
  const before = structuredClone({ auto, manual, mixed, snapshot });
  assert.equal(policy.inputPolicySummary(auto, 'row'), '전 공정 AI 판단');
  assert.equal(policy.inputPolicySummary(manual, 'row'), `직접 선택 ${ids.length}항목 · AI 판단 0항목`);
  assert.equal(policy.inputPolicySummary(mixed, 'row'), `직접 선택 2항목 · AI 판단 ${ids.length - 2}항목`);
  assert.equal(policy.inputPolicySummary({ extra: 'manual', size_image: 'auto', final_detail: 'auto' }, 'row'), '직접 선택 1항목 · AI 판단 2항목');
  assert.equal(policy.inputPolicySummary(snapshot.resolved, 'row'), `직접 선택 ${ids.length}항목 · AI 판단 0항목`);
  assert.equal(policy.inputPolicySummary(manual), `직접 선택: ${Object.values(policy.AUTOMATION_DECISIONS).join(' · ')}`);
  assert.equal(policy.inputPolicySummary(mixed), '직접 선택: 경쟁사 · 쿠팡 · 최종 상세페이지 A컷');
  assert.deepEqual({ auto, manual, mixed, snapshot }, before);
  console.log(JSON.stringify({ allAuto: policy.inputPolicySummary(auto, 'row'), allManual: policy.inputPolicySummary(manual, 'row'), mixed: policy.inputPolicySummary(mixed, 'row'), queuedLocked: policy.inputPolicySummary(snapshot.resolved, 'row'), fullManual: policy.inputPolicySummary(manual), unchanged: true }));
});
