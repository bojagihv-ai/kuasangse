const test = require('node:test');
const assert = require('node:assert/strict');

test('명시 공통값 적용은 선택 제품의 빈칸만 채우고 기존 입력과 사진을 보존한다', async () => {
  const { fillBulkProductRequiredValues } = await import('../../frontend/src/bulk-intake-model.mjs');
  const images = [{ fileName: '기존사진.jpg', role: 'base' }];
  const selected = { productName: '지갑', images, requiredValues: { material: '', salePrice: '2000' } };
  const other = { productName: '다른 제품', requiredValues: { material: '마' } };
  const beforeOther = structuredClone(other);
  const count = fillBulkProductRequiredValues(selected, { salePrice: '2000', category: '지갑' }, { salePrice: '5000', category: '보자기', material: '면', size: '20x15cm' });
  assert.equal(count, 4);
  assert.equal(selected.requiredValues.material, '면');
  assert.equal(selected.requiredValues.salePrice, '2000');
  assert.equal(selected.requiredValues.category, undefined);
  assert.equal(selected.requiredValues.widthMm, '200');
  assert.equal(selected.requiredValues.depthMm, '150');
  assert.equal(selected.images, images);
  assert.deepEqual(other, beforeOther);
});

test('큐에 추가된 제품과 비어 있는 공통값은 기존 값을 바꾸지 않는다', async () => {
  const { fillBulkProductRequiredValues } = await import('../../frontend/src/bulk-intake-model.mjs');
  const queued = { queued: true, requiredValues: { material: '색동원단' } };
  assert.equal(fillBulkProductRequiredValues(queued, {}, { material: '면' }), 0);
  const product = { requiredValues: { material: '면' } };
  assert.equal(fillBulkProductRequiredValues(product, product.requiredValues, { material: '' }), 0);
  assert.deepEqual(product.requiredValues, { material: '면' });
});

test('기존 치수와 다른 공통 크기는 치수 묶음을 섞지 않는다', async () => {
  const { fillBulkProductRequiredValues } = await import('../../frontend/src/bulk-intake-model.mjs');
  const product = { requiredValues: { widthMm: '500' } };
  assert.equal(fillBulkProductRequiredValues(product, product.requiredValues, { size: '20x15cm', material: '면' }), 1);
  assert.deepEqual(product.requiredValues, { widthMm: '500', material: '면' });
});

test('새 제품은 이전 제품의 기본값을 물려받지 않고 기존 저장 제품은 보존한다', async () => {
  const { appendBulkProductRows, buildBulkPlan, serializeWorkingState, hydrateWorkingState } = await import('../../frontend/src/bulk-intake-model.mjs');
  const grouped = { products: [{ productName: '기존 지갑', images: [] }] };
  const defaults = { material: '색동원단', salePrice: '2000', size: '15x8cm' };
  appendBulkProductRows(grouped.products, '새 보자기');
  const plan = buildBulkPlan(grouped, [], defaults);
  assert.equal(plan.entries[0].requiredValues.salePrice, '2000');
  assert.equal(plan.entries[1].requiredValues.salePrice, undefined);
  assert.equal(plan.entries[1].requiredValues.material, undefined);
  const restored = hydrateWorkingState(serializeWorkingState({ grouped, defaults }), new Map());
  assert.equal(buildBulkPlan(restored.grouped, [], restored.defaults).entries[1].requiredValues.salePrice, undefined);
});
