'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function finalizeSource() {
  const core = source('src/app-core-05.js');
  const at = core.indexOf('async function factoryCafe24FinalizeRegistrationReceipt(');
  assert.notEqual(at, -1, '등록 후 대조 함수를 찾지 못했습니다');
  const end = core.indexOf(String.fromCharCode(10) + 'function ', at + 10);
  assert.notEqual(end, -1);
  return core.slice(at, end);
}

test('등록 직후 비어 있는 이미지는 기다렸다 다시 읽는다', () => {
  // 실측: 02:51 등록 시점에는 detail/list/small/tiny 가 모두 비어 대표이미지가 불일치였고,
  // 같은 상품 3015 를 나중에 다시 읽으니 네 칸 모두 채워져 전부 일치했다. 재시도가 재고에만
  // 걸려 있으면 실제로 올라간 상품이 영영 실패로 기록된다.
  const core = source('src/app-core-05.js');
  const at = core.indexOf('const CAFE24_READBACK_SETTLING_LABELS');
  assert.notEqual(at, -1, '늦게 채워지는 항목 목록이 없습니다');
  const block = core.slice(at, core.indexOf(');', at));
  for (const label of ['옵션별 재고', '대표이미지', '상세이미지']) {
    assert.ok(block.includes(label), `${label} 을(를) 재시도 대상으로 보지 않습니다`);
  }
});

test('재시도는 늦게 채워지는 항목일 때만 돈다', () => {
  // 상품명이나 판매가가 틀린 것은 기다린다고 고쳐지지 않는다. 바로 실패로 알려야 한다.
  const region = finalizeSource();
  assert.ok(region.includes('CAFE24_READBACK_SETTLING_LABELS.has(label)'), '재시도 조건이 목록을 쓰지 않습니다');
  assert.ok(
    !region.includes("label === '옵션별 재고'"),
    '아직 재고 한 항목만 재시도합니다',
  );
});

test('재시도에는 상한이 있다', () => {
  // 끝없이 기다리면 배치가 그 자리에서 멈춘다.
  const region = finalizeSource();
  assert.ok(region.includes('CAFE24_READBACK_SETTLE_ATTEMPTS - 1'), '재시도 상한이 없습니다');
  assert.ok(region.includes('factoryCafe24Delay(CAFE24_READBACK_SETTLE_DELAY_MS)'), '재시도 사이에 기다리지 않습니다');
});

test('기다리는 폭은 저장 에코 대기와 같은 수준이다', () => {
  // 8초로는 이미지 반영을 못 기다린다. 저장 에코는 30초를 기다린다.
  const core = source('src/app-core-05.js');
  const attempts = Number((core.match(/CAFE24_READBACK_SETTLE_ATTEMPTS = (\d+)/) || [])[1]);
  const delay = Number((core.match(/CAFE24_READBACK_SETTLE_DELAY_MS = (\d+)/) || [])[1]);
  assert.ok(attempts >= 10, `재시도 횟수가 너무 적습니다: ${attempts}`);
  assert.ok(attempts * delay >= 25000, `기다리는 폭이 너무 짧습니다: ${attempts * delay}ms`);
  assert.ok(attempts * delay <= 60000, `기다리는 폭이 너무 깁니다: ${attempts * delay}ms`);
});

test('대조가 끝내 어긋나면 그대로 실패로 알린다', () => {
  const region = finalizeSource();
  assert.ok(region.includes('read-back 불일치'), '불일치를 알리지 않습니다');
  assert.ok(region.includes("status: comparison.allMatched ? 'verified' : 'mismatch'"), '영수증 상태를 남기지 않습니다');
});
