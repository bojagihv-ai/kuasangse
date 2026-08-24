const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', ...parts), 'utf8');
}

test('완료된 작업에는 Cafe24 등록 버튼이 뜬다', () => {
  // 조립공장에는 등록 화면이 없다. 이 버튼이 없으면 사람이 등록을 시작할 방법 자체가 없다.
  const board = source('production-board.mjs');
  assert.ok(board.includes("row.cafe24ValuesReady ? 'cafe24' : 'cafe24-values'"), 'Cafe24 등록 버튼이 없습니다');
  assert.ok(board.includes("row.status === 'completed' && !row.cafe24Registered"));
});

test('등록값이 없는 작업은 먼저 값을 받는다', () => {
  // 값 없이 지시하면 조립공장 깊은 곳에서 "등록 차단: category_id" 로 끝나, 사람이
  // 어디를 고쳐야 하는지 알 수 없다.
  const board = source('production-board.mjs');
  assert.ok(board.includes("'Cafe24 값 입력'"), '값을 받는 길이 없습니다');
  assert.ok(board.includes('CAFE24_VALUE_FIELDS'), '입력 항목이 없습니다');
  assert.ok(board.includes('renderCafe24ValueForm'), '입력 폼을 그리지 않습니다');
});

test('상품분류 번호는 반드시 받는다', () => {
  // 나머지는 비워도 되지만 분류가 없으면 등록 자체가 막힌다.
  const board = source('production-board.mjs');
  assert.ok(board.includes('if (!values.categoryId)'), '분류 없이도 보냅니다');
  assert.ok(board.includes('Cafe24 상품분류 번호는 반드시'), '왜 막혔는지 알리지 않습니다');
});

test('받은 값은 등록 지시에 실어 보낸다', () => {
  const board = source('production-board.mjs');
  assert.ok(board.includes('registerCafe24(jobId, values = {})'), '값을 받을 자리가 없습니다');
  assert.ok(board.includes('JSON.stringify(values)'), '받은 값을 보내지 않습니다');
});

test('투입값이 있는지 모델이 알려준다', () => {
  const model = source('production-board-model.mjs');
  assert.ok(model.includes('cafe24ValuesReady'), '등록값 유무를 알려주지 않습니다');
  assert.ok(model.includes('cafe24Values: record(job.cafe24Values)'), '기존 값을 전달하지 않습니다');
});

test('등록 버튼은 관제탑 등록 지시 엔드포인트를 부른다', () => {
  const board = source('production-board.mjs');
  assert.ok(board.includes('/cafe24/register'), '등록 엔드포인트를 부르지 않습니다');
});

test('이미 등록된 작업에는 버튼을 다시 내지 않는다', () => {
  const model = source('production-board-model.mjs');
  assert.ok(model.includes('cafe24Registered'), '등록 여부를 모델이 알려주지 않습니다');
  assert.ok(model.includes("text(job.stageKey) === 'cafe24'"));
});

test('등록 지시 실패는 조용히 넘어가지 않는다', () => {
  const board = source('production-board.mjs');
  const at = board.indexOf('async function registerCafe24(');
  assert.notEqual(at, -1, 'registerCafe24 가 없습니다');
  const region = board.slice(at, at + 900);
  assert.ok(region.includes("'error'"), '실패를 사람에게 알리지 않습니다');
});
