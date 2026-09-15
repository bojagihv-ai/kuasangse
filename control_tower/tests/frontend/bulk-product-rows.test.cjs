const test = require('node:test');
const assert = require('node:assert/strict');

test('세 제품 이름을 한 번에 넣고 기존 제품과 사진은 그대로 보존한다', async () => {
  const { appendBulkProductRows } = await import('../../frontend/src/bulk-intake-model.mjs');
  const image = { fileName: 'original.jpg', role: 'base', colorName: '' };
  const original = { productName: '기존 지갑', images: [image], requiredValues: { salePrice: '2000' } };
  const products = [original];
  const result = appendBulkProductRows(products, '새 지갑\n새 보자기\n새 수저집\n기존 지갑\n새 지갑');
  assert.deepEqual(products.map(row => row.productName), ['기존 지갑', '새 지갑', '새 보자기', '새 수저집']);
  assert.equal(products[0], original);
  assert.equal(products[0].images[0], image);
  assert.equal(products[0].requiredValues.salePrice, '2000');
  assert.equal(result.added, 3);
  assert.equal(result.duplicates, 2);
});

test('머리글 포함 표 붙여넣기는 기존 파서의 치수·필수값을 그대로 사용한다', async () => {
  const { appendBulkProductRows } = await import('../../frontend/src/bulk-intake-model.mjs');
  const products = [];
  const result = appendBulkProductRows(products, '제품명\t소재\t크기\t판매가\n카드지갑\t색동원단\t15x8cm\t2000\n보자기\t면\t50x50cm\t3000');
  assert.equal(result.added, 2);
  assert.equal(products[0].requiredValues.widthMm, '150');
  assert.equal(products[1].requiredValues.material, '면');
  const before = structuredClone(products);
  const rejected = appendBulkProductRows(products, '알수없는열\t가격\n이름\t2000');
  assert.equal(rejected.added, 0);
  assert.ok(rejected.errors.length);
  assert.deepEqual(products, before);
});
