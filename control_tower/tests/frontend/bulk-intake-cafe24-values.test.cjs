const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODEL_URL = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'bulk-intake-model.mjs'),
).href;

test('제품분류를 CSV 열로 받아 투입값에 싣는다', async () => {
  // 이것이 없으면 운영자가 관제탑에서 분류를 지정할 방법이 없어, 등록 뒤 스토어에서 손으로 다시 골라야 한다.
  const { parseIntakeCsv } = await import(MODEL_URL);

  const { rows } = parseIntakeCsv([
    '상품명,분류,소재,원산지,크기,판매가,용도,재고,제품분류,공급가,진열,판매',
    '슬라브 겹보,선물포장,슬라브,대한민국,55x55cm,2700,선물포장,99,119,500,진열안함,판매안함',
  ].join('\n'));

  assert.equal(rows.length, 1);
  const values = rows[0].requiredValues;
  assert.equal(values.cafe24CategoryId, '119');
  assert.equal(values.supplyPrice, '500');
  assert.equal(values.displayStatus, 'F');
  assert.equal(values.sellingStatus, 'F');
  assert.equal(values.salePrice, '2700');
});

test('진열·판매는 말로 적어도 Cafe24 가 받는 T/F 로 바꾼다', async () => {
  const { parseIntakeCsv } = await import(MODEL_URL);

  const { rows } = parseIntakeCsv([
    '상품명,분류,소재,원산지,크기,판매가,용도,재고,진열,판매',
    '공단보자기,선물포장,공단,대한민국,45cm,3000,선물포장,99,진열함,판매함',
  ].join('\n'));

  assert.equal(rows[0].requiredValues.displayStatus, 'T');
  assert.equal(rows[0].requiredValues.sellingStatus, 'T');
});

test('제품분류를 비워도 투입은 막지 않는다', async () => {
  // 분류는 나중에 등록 시점에 골라도 된다.
  const { parseIntakeCsv } = await import(MODEL_URL);

  const { rows } = parseIntakeCsv([
    '상품명,분류,소재,원산지,크기,판매가,용도,재고',
    '공단보자기,선물포장,공단,대한민국,45cm,3000,선물포장,99',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].requiredValues.cafe24CategoryId, undefined);
  assert.equal(rows[0].requiredValues.salePrice, '3000');
});

test('분류번호에 섞인 글자는 숫자만 남긴다', async () => {
  const { parseIntakeCsv } = await import(MODEL_URL);

  const { rows } = parseIntakeCsv([
    '상품명,분류,소재,원산지,크기,판매가,용도,재고,제품분류',
    '실크겹보,선물포장,실크,대한민국,55cm,2700,선물포장,99,No.119',
  ].join('\n'));

  assert.equal(rows[0].requiredValues.cafe24CategoryId, '119');
});
