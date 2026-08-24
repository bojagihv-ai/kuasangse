'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function runProductSource() {
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRunProduct(');
  assert.notEqual(at, -1, '제품 실행 함수를 찾지 못했습니다');
  return core.slice(at, at + 1600);
}

test('저장해 둔 지점이 있으면 다른 제품을 들고 있을 때 먼저 연다', () => {
  // 실측: 워커가 단색을 든 채 R6 주문을 받아 R6 문서에 저장하려 했고, 서버가 신원이
  // 바뀌었다며 막았다. 막히지 않았다면 다른 제품 내용이 R6 문서를 덮었을 것이다.
  const region = runProductSource();
  assert.ok(region.includes('payload.checkpoint'), '저장 지점을 보지 않습니다');
  assert.ok(
    region.includes('factoryRuntimeControlRestoreProductCheckpoint(payload)'),
    '다른 제품을 들고 있어도 열지 않습니다',
  );
});

test('이미 그 작업을 들고 있으면 다시 열지 않는다', () => {
  // 멀쩡히 진행 중인 작업을 다시 복원하면 방금 만든 결과를 잃는다.
  const region = runProductSource();
  assert.ok(region.includes("!== targetJobId"), '현재 열린 작업을 확인하지 않습니다');
});

test('여는 일은 준비보다 먼저 한다', () => {
  const region = runProductSource();
  const openAt = region.indexOf('factoryRuntimeControlRestoreProductCheckpoint(payload);');
  const prepareAt = region.indexOf('factoryRuntimeControlPrepareProduct(payload)');
  assert.notEqual(openAt, -1);
  assert.notEqual(prepareAt, -1);
  assert.ok(openAt < prepareAt, '준비한 뒤에야 작업을 엽니다');
});

test('관제탑은 저장 지점을 restoreOnly 가 아닐 때도 실어 보낸다', () => {
  // 보내지 않으면 워커는 무엇을 열어야 할지 모른다.
  const sync = source('control_tower/backend/factory_sync.py');
  const at = sync.indexOf('"name": PRODUCT_RUN_COMMAND,');
  assert.notEqual(at, -1);
  const region = sync.slice(at, at + 2200);
  assert.ok(region.includes('isinstance(job.checkpoint, dict) and job.checkpoint'), '저장 지점을 조건부로만 보냅니다');
  assert.ok(!region.includes('if job.restore_only else {}'), '아직 restoreOnly 일 때만 보냅니다');
});

test('계약은 복원 전용이 아니어도 저장 지점을 받는다', () => {
  // 받지 않으면 워커가 다른 제품을 들고 있을 때 이 작업을 열 방법이 없다.
  const contract = source('src/modules/batch-control-product-contract.mjs');
  assert.ok(
    contract.includes("payload.restoreOnly === true || payload.checkpoint !== undefined"),
    '복원 전용일 때만 저장 지점을 받습니다',
  );
  assert.ok(
    !contract.includes("else if (payload.checkpoint !== undefined) {"),
    '아직 저장 지점을 거절합니다',
  );
});

test('복원 전용 주문에는 저장 지점이 여전히 반드시 있어야 한다', () => {
  const contract = source('src/modules/batch-control-product-contract.mjs');
  const at = contract.indexOf('payload.restoreOnly === true || payload.checkpoint !== undefined');
  assert.notEqual(at, -1);
  const region = contract.slice(at, at + 200);
  assert.ok(region.includes('validateProductCheckpoint(payload.checkpoint, payload.jobId)'), '검사를 건너뜁니다');
});
