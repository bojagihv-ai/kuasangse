const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../../frontend/src/bulk-intake-model.mjs');

test('제품별 입력은 CSV와 공통값보다 우선하며 빈칸도 그대로 검증한다', async () => {
  const { buildBulkPlan } = await load();
  const products = [{ productName: '지갑', images: [{ fileName: 'wallet.jpg', role: 'base' }], requiredValues: { salePrice: '3000', category: '', cafe24CategoryId: '84' } }];
  const plan = buildBulkPlan({ products }, [{ productName: '지갑', requiredValues: { salePrice: '2000' } }], { salePrice: '1000', category: '기존 분류', size: '15x8cm' });
  assert.equal(plan.entries[0].requiredValues.salePrice, '3000');
  assert.equal(plan.entries[0].requiredValues.category, undefined);
  assert.equal(plan.entries[0].requiredValues.cafe24CategoryId, '84');
  assert.ok(plan.entries[0].issues.includes('category_missing'));
});

test('큐에 추가된 제품은 입력 사진과 값을 보존하되 다시 전송하지 않는다', async () => {
  const { buildBulkPlan, serializeWorkingState, hydrateWorkingState } = await load();
  const grouped = { products: [{ productName: '지갑', queued: true, queuedJobId: 'job-84', requiredValues: { salePrice: '2000', size: '15x8cm', cafe24CategoryId: '84' }, images: [{ blobId: 'photo', fileName: 'wallet.jpg', role: 'base' }] }] };
  const stored = serializeWorkingState({ grouped, settings: { imageModel: 'chosen-model', policy: 'all_images_manual' } });
  const restored = hydrateWorkingState(stored, new Map([['photo', new Blob(['image'])]]), blob => blob);
  assert.deepEqual(restored.grouped.products[0].requiredValues, grouped.products[0].requiredValues);
  assert.equal(restored.grouped.products[0].queuedJobId, 'job-84');
  assert.equal(restored.grouped.products[0].images.length, 1);
  assert.equal(restored.settings.policy, 'all_images_manual');
  const plan = buildBulkPlan(restored.grouped);
  assert.equal(plan.ready, 0);
  assert.equal(plan.entries[0].queued, true);
});

test('제품 크기는 공통 치수보다 우선하고 직접 보정한 mm 값은 보존한다', async () => {
  const { buildBulkPlan } = await load();
  const products = [{ productName: '지갑', images: [], requiredValues: { size: '20x10cm' } }];
  const defaults = { size: '15x8cm', widthMm: '150', depthMm: '80' };
  assert.equal(buildBulkPlan({ products }, [], defaults).entries[0].requiredValues.widthMm, '200');
  products[0].requiredValues.widthMm = '198';
  assert.equal(buildBulkPlan({ products }, [], defaults).entries[0].requiredValues.widthMm, '198');
});

test('Cafe24 분류 조회는 저장된 연결로 읽기 요청만 보내고 실패를 숨기지 않는다', async () => {
  const { loadCafe24Categories } = await import('../../frontend/src/intake-categories.mjs');
  const calls = [];
  const items = await loadCafe24Categories('http://local-hub', async (url, options) => {
    calls.push({ url, request: JSON.parse(options.body).body });
    const offset = calls.length === 1 ? 0 : 100;
    const rows = Array.from({ length: offset ? 1 : 100 }, (_, i) => ({ category_no: offset + i + 1, category_name: `분류${offset + i + 1}` }));
    return { ok: true, json: async () => ({ ok: true, response: { body: { data: { response: { categories: rows } } } } }) };
  });
  assert.equal(items.length, 101);
  assert.equal(calls[0].request.method, 'GET');
  assert.match(calls[1].request.path, /offset=100$/);
  assert.equal(calls[0].request.mallId, undefined);
  await assert.rejects(loadCafe24Categories('http://local-hub', async () => ({ ok: false, status: 401, json: async () => ({}) })), /401/);
});

test('Cafe24 분류는 API의 상위 경로와 번호를 사용하고 임의 분류를 만들지 않는다', async () => {
  const { normalizeCafe24Categories } = await import('../../frontend/src/intake-categories.mjs');
  const items = normalizeCafe24Categories([{ category_no: 84, category_name: '지갑', full_category_name: { 1: '잡화', 2: '지갑', 3: null } }, { category_name: '번호 없는 분류' }]);
  assert.deepEqual(items, [{ id: '84', name: '지갑', label: '잡화 > 지갑' }]);
});
