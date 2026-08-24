const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', ...parts), 'utf8');
}

test('비어 있는 투입값을 이름으로 지목한다', () => {
  // 입력·소스 화면으로 되돌아가야만 고칠 수 있으면, 무엇이 비었는지도 알 수 없다.
  const model = source('src', 'production-board-model.mjs');
  assert.ok(model.includes('PRODUCT_VALUE_LABELS'), '값 이름을 사람 말로 두지 않습니다');
  assert.ok(model.includes("kind: 'values'"), '투입값 채우기를 지목하지 않습니다');
  assert.ok(model.includes('missingRequiredValues'), '빈 값 목록을 행에 싣지 않습니다');
});

test('투입값이 비면 다른 안내보다 먼저 지목한다', () => {
  // 값이 비어 있으면 무엇을 만들어도 어긋난다.
  const model = source('src', 'production-board-model.mjs');
  const at = model.indexOf("kind: 'values'");
  const pickAt = model.indexOf("kind: 'pick'");
  assert.notEqual(at, -1);
  assert.ok(at < pickAt, '컷 고르기를 투입값보다 먼저 지목합니다');
});

test('보드에서 그 자리에서 채울 수 있다', () => {
  const board = source('src', 'production-board.mjs');
  assert.ok(board.includes("action: 'product-values'"), '채우기 버튼이 없습니다');
  assert.ok(board.includes('renderProductValueForm'), '입력 폼을 그리지 않습니다');
  assert.ok(board.includes('/values'), '저장 엔드포인트를 부르지 않습니다');
});

test('한 칸만 고쳐도 나머지가 남는다', () => {
  // 이미 채운 값을 폼에 미리 넣어야, 통째로 다시 쓰지 않는다.
  const board = source('src', 'production-board.mjs');
  const at = board.indexOf('function renderProductValueForm');
  const region = board.slice(at, at + 2200);
  assert.ok(region.includes('row.requiredValues?.[key]'), '이미 채운 값을 보여주지 않습니다');
  assert.ok(region.includes("dataset.tone = 'attention'"), '비어 있는 칸을 구분하지 않습니다');
});

test('옵션 여부는 골라 넣게 한다', () => {
  // 자유 입력으로 두면 provided/none 이 아닌 값이 들어가 조립공장이 거절한다.
  const board = source('src', 'production-board.mjs');
  const at = board.indexOf('function renderProductValueForm');
  const region = board.slice(at, at + 2200);
  assert.ok(region.includes("'provided'") && region.includes("'none'"), '옵션 여부를 고르게 하지 않습니다');
});

test('저장 실패는 조용히 넘어가지 않는다', () => {
  const board = source('src', 'production-board.mjs');
  const at = board.indexOf('async function saveProductValues');
  assert.notEqual(at, -1);
  assert.ok(board.slice(at, at + 700).includes("'error'"), '실패를 알리지 않습니다');
});
