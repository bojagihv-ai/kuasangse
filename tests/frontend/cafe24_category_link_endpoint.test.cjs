'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function categoryLinkRegion() {
  const sync = source('src/cafe24-sync.js');
  const marker = 'Connect Cafe24 category';
  const at = sync.indexOf(marker);
  assert.notEqual(at, -1, '분류 연결 호출을 찾지 못했습니다');
  return sync.slice(Math.max(0, at - 900), at + 120);
}

test('분류 연결은 상품 갱신으로 한다', () => {
  // categories/{no}/products 는 Cafe24 가 parameter.product_no 를 잘못된 filter 로 보고
  // 422 로 거절한다. 그 경로를 쓰면 분류가 영영 붙지 않는다.
  const region = categoryLinkRegion();
  assert.ok(region.includes('add_category_no'), `add_category_no 를 쓰지 않습니다: ${region.slice(-300)}`);
  assert.ok(region.includes('/api/v2/admin/products/'), '상품 갱신 경로를 쓰지 않습니다');
  assert.ok(
    !region.includes('/products`, {'),
    '거절되는 categories/{no}/products 경로가 남아 있습니다',
  );
});

test('관제탑 등록 명령이 공급가·판매상태를 함께 싣는다', () => {
  const core = source('src/app-core-03.js');
  const at = core.indexOf('const FACTORY_CAFE24_FIELD_MAP');
  assert.notEqual(at, -1);
  const map = core.slice(at, at + 500);
  for (const key of ['salePrice', 'supplyPrice', 'displayStatus', 'sellingStatus']) {
    assert.ok(map.includes(key), `${key} 대응이 없습니다`);
  }
  assert.ok(map.includes("'purchase_price'"), '공급가 필드에 연결되지 않았습니다');
  assert.ok(map.includes("'selling_status'"), '판매상태 필드에 연결되지 않았습니다');
});

test('분류는 글자가 아니라 등록 행으로 넣는다', () => {
  // 글자 한 줄로 넣으면 등록 직전 점검이 분류를 읽지 못해 category_id 로 막힌다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlApplyCafe24Category(');
  assert.notEqual(at, -1, '분류 적용 경로가 없습니다');
  const region = core.slice(at, at + 900);
  assert.ok(region.includes('finalDb.category = ['), '분류를 등록 행으로 넣지 않습니다');
  assert.ok(region.includes('category_no:'), '분류 번호 칸이 없습니다');
});

test('등록 실행 전에 분류를 먼저 적용한다', () => {
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRegisterCafe24(');
  assert.notEqual(at, -1);
  const region = core.slice(at, core.indexOf('factoryRunFinalRegistration(', at));
  assert.ok(
    region.includes('factoryRuntimeControlApplyCafe24Category('),
    '등록 전에 분류를 적용하지 않습니다',
  );
});

test('투입 계약이 제품분류를 입력값으로 받는다', () => {
  const sync = source('control_tower/backend/factory_sync.py');
  assert.ok(sync.includes('PRODUCT_OPTIONAL_VALUE_KEYS'), '선택 입력 키가 없습니다');
  assert.ok(sync.includes('cafe24CategoryId'), '제품분류 입력값이 없습니다');
  assert.ok(sync.includes('_cafe24_values_from_job'), '투입값을 등록으로 넘기지 않습니다');
  // 필수로 바꾸면 기존 투입이 전부 막힌다.
  const requiredAt = sync.indexOf('PRODUCT_REQUIRED_VALUE_KEYS = frozenset(');
  const required = sync.slice(requiredAt, requiredAt + 220);
  assert.ok(!required.includes('cafe24CategoryId'), '제품분류를 필수로 두면 기존 투입이 막힙니다');
});

test('등록 실패는 영수증에 적힌 진짜 사유를 알린다', () => {
  // 실측: 스토어에는 상품 3015 가 만들어졌는데 관제탑은 "등록 차단: category_id" 라고
  // 적었다. 사람이 이미 지나간 항목을 붙들고 엉뚱한 곳을 고치게 된다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRegisterCafe24(');
  assert.notEqual(at, -1);
  const region = core.slice(at, core.indexOf('function factoryRuntimeControlCafe24BlockReason(', at));
  const errorAt = region.indexOf('const reason = String(');
  assert.notEqual(errorAt, -1);
  const reasonBlock = region.slice(errorAt, errorAt + 320);
  assert.ok(reasonBlock.includes('receipt.error'), '영수증의 실패 사유를 먼저 읽지 않습니다');
  assert.ok(
    reasonBlock.indexOf('receipt.error') < reasonBlock.indexOf('CafeBlockReason') || !reasonBlock.includes('CafeBlockReason'),
    '사전점검 목록을 영수증보다 먼저 읽습니다',
  );
});

test('스토어에 상품이 생겼으면 실패 보고에도 번호를 남긴다', () => {
  // 번호를 숨기면 다시 눌러 같은 상품을 하나 더 만든다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRegisterCafe24(');
  const region = core.slice(at, core.indexOf('function factoryRuntimeControlCafe24BlockReason(', at));
  assert.ok(region.includes('이미 생성됨'), '생성된 상품번호를 알리지 않습니다');
  assert.ok(region.includes('receipt.productNo'), '영수증의 상품번호를 보지 않습니다');
});

test('등록 명령은 다른 제품이 열려 있으면 자기 작업부터 연다', () => {
  // 열지 않고 등록하면 화면에 남아 있던 다른 제품의 값이 스토어로 나간다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRegisterCafe24(');
  assert.notEqual(at, -1);
  const region = core.slice(at, core.indexOf('factoryRunFinalRegistration(', at));
  assert.ok(region.includes('onTarget'), '현재 열린 작업을 확인하지 않습니다');
  assert.ok(
    region.includes('factoryRuntimeControlRestoreProductCheckpoint('),
    '다른 제품이 열려 있어도 복원하지 않습니다',
  );
});

test('이미 그 작업이 열려 있으면 다시 복원하지 않는다', () => {
  // 멀쩡히 열려 있는 작업을 다시 복원하면 방금 만든 결과를 잃을 수 있다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRegisterCafe24(');
  const region = core.slice(at, core.indexOf('factoryRunFinalRegistration(', at));
  assert.ok(region.includes('if (!onTarget &&'), '열려 있어도 무조건 복원합니다');
});
