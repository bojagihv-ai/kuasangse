const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', ...parts), 'utf8');
}

test('완료된 작업에는 Cafe24 등록 버튼이 뜬다', () => {
  // 보드의 시작 버튼은 승인 단계로 안내해야 하며 즉시 외부 등록을 해서는 안 된다.
  const board = source('production-board.mjs');
  assert.ok(board.includes("'Cafe24 승인·등록 열기', {"), 'Cafe24 승인 단계 버튼이 없습니다');
  assert.ok(board.includes("(row.status === 'completed' || row.cafe24Declined) && !row.cafe24Registered"));
});

test('등록값이 없어 차단된 작업도 여기서 풀 수 있다', () => {
  // 원문 코드만 보여주고 길을 막으면, 값만 채우면 되는 작업이 영영 등록되지 않는다.
  const board = source('production-board.mjs');
  assert.ok(board.includes('row.cafe24Declined'), '차단된 등록을 다시 시도할 길이 없습니다');
  const model = source('production-board-model.mjs');
  assert.ok(model.includes('cafe24Declined'), '등록 거절 여부를 모델이 알려주지 않습니다');
});

test('등록값은 원할 때만 지정하는 보조 수단이다', () => {
  // 분류·공급가는 원래 필수가 아니다. 스토어에 이미 있는 제품은 조립공장이 원격에서
  // 읽어 온다. 미리 받아야만 등록되게 막으면 멀쩡한 제품이 등록되지 않는다.
  const board = source('production-board.mjs');
  assert.ok(board.includes("'Cafe24 값 지정'"), '값을 지정하는 길이 없습니다');
  assert.ok(board.includes('CAFE24_VALUE_FIELDS'), '입력 항목이 없습니다');
  assert.ok(board.includes('renderCafe24ValueForm'), '입력 폼을 그리지 않습니다');
});

test('분류번호를 등록 전제조건으로 삼지 않는다', () => {
  const board = source('production-board.mjs');
  assert.ok(!board.includes('if (!values.categoryId)'), '분류 없이는 못 보내게 막습니다');
  const model = source('production-board-model.mjs');
  assert.ok(!model.includes('cafe24ValuesReady'), '분류 유무로 등록을 가릅니다');
});

test('받은 값은 승인 전 pending 상태로 저장한다', () => {
  const board = source('production-board.mjs');
  assert.ok(board.includes('saveCafe24Values(jobId, values = {})'), '값을 저장할 자리가 없습니다');
  assert.ok(board.includes('JSON.stringify(values)'), '받은 값을 보내지 않습니다');
});

test('투입값이 있는지 모델이 알려준다', () => {
  const model = source('production-board-model.mjs');
  assert.ok(model.includes('const cafe24Values = record(job.cafe24Values)'), '기존 값을 읽지 않습니다');
  assert.ok(model.includes('      cafe24Values,'), '기존 값을 행에 전달하지 않습니다');
});

test('값 저장은 관제탑 pending endpoint만 부른다', () => {
  const board = source('production-board.mjs');
  assert.ok(board.includes('/cafe24/values'), '값 저장 endpoint를 부르지 않습니다');
  assert.ok(!board.includes('/cafe24/register'), '보드가 승인 없는 등록 endpoint를 부릅니다');
});

test('이미 등록된 작업에는 버튼을 다시 내지 않는다', () => {
  const model = source('production-board-model.mjs');
  assert.ok(model.includes('cafe24Registered'), '등록 여부를 모델이 알려주지 않습니다');
  assert.ok(model.includes("text(job.stageKey) === 'cafe24'"));
});

test('값 저장 실패는 조용히 넘어가지 않는다', () => {
  const board = source('production-board.mjs');
  const at = board.indexOf('async function saveCafe24Values(');
  assert.notEqual(at, -1, 'saveCafe24Values 가 없습니다');
  const region = board.slice(at, at + 900);
  assert.ok(region.includes("'error'"), '실패를 사람에게 알리지 않습니다');
});
