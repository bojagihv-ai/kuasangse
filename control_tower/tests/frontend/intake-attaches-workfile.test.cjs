const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', ...parts), 'utf8');
}

test('제품 사진 등록 자리에서 작업파일도 함께 받는다', () => {
  // 작업파일이 이미지 등록과 떨어진 별도 섹션에만 있으면, 이어서 할 작업이 있는데도
  // 매번 새 작업으로 시작하게 된다.
  const html = source('control-tower.html');
  const at = html.indexOf('for="base-images"');
  assert.notEqual(at, -1);
  const region = html.slice(at, at + 1400);
  assert.ok(region.includes('id="intake-workfile"'), '투입 폼에 작업파일 칸이 없습니다');
  assert.ok(region.includes('이어서 할 작업파일'), '무엇을 넣는 칸인지 알려주지 않습니다');
});

test('작업파일을 붙이면 그 작업을 이어서 진행하도록 보낸다', () => {
  const js = source('src', 'product-intake.mjs');
  assert.ok(js.includes("kind: 'workfile'"), '작업파일 원본으로 보내지 않습니다');
  assert.ok(js.includes('attachedWorkfile'), '붙인 작업파일을 기억하지 않습니다');
  const at = js.indexOf('idempotencyKey: state.attachedWorkfile');
  assert.notEqual(at, -1, '작업파일과 새 작업의 열쇠를 구분하지 않습니다');
});

test('붙이지 않으면 예전처럼 새 작업으로 시작한다', () => {
  const js = source('src', 'product-intake.mjs');
  assert.ok(js.includes("{ source: { kind: 'manual' } }"), '새 작업 경로가 사라졌습니다');
});

test('작업 정보가 없는 파일은 붙이지 않고 이유를 말한다', () => {
  // 신원이 비면 조립공장이 어느 작업을 이어야 할지 알 수 없다.
  const js = source('src', 'product-intake.mjs');
  assert.ok(js.includes("'workspaceId', 'productKey', 'runId', 'inputFingerprint'"), '신원을 확인하지 않습니다');
  assert.ok(js.includes('붙일 수 없습니다'), '왜 안 붙었는지 알리지 않습니다');
});

test('관제탑이 요구하는 작업파일 원본 키를 모두 채운다', () => {
  // 키가 하나라도 다르면 관제탑이 factory_product_source_invalid 로 거절한다.
  const js = source('src', 'product-intake.mjs');
  const at = js.indexOf("kind: 'workfile'");
  const region = js.slice(at, at + 600);
  for (const key of ['revision', 'runId', 'workspaceId', 'productKey', 'inputFingerprint']) {
    assert.ok(region.includes(`${key}: identity.${key}`), `${key} 를 보내지 않습니다`);
  }
  // sha256 과 productId 는 따로 계산해 축약 표기로 싣는다.
  assert.ok(region.includes('sha256,'), 'sha256 을 보내지 않습니다');
  assert.ok(region.includes('productId,'), 'productId 를 보내지 않습니다');
});

test('작업파일에 productId 가 없어도 조립공장과 같은 규칙으로 유도한다', () => {
  // 실측: 실제 .kuasangse 에는 productId 가 없고 confirmedCafe24ProductKey "594" 만
  // 있었다. 유도하지 않으면 진짜 작업파일은 하나도 붙일 수 없다.
  const js = source('src', 'product-intake.mjs');
  const at = js.indexOf('const derivedProductId =');
  assert.notEqual(at, -1, 'productId 유도가 없습니다');
  const region = js.slice(at, at + 700);
  assert.ok(region.includes('confirmedCafe24ProductKey'), 'Cafe24 확정 번호를 보지 않습니다');
  assert.ok(region.includes('`cafe24:${productNo}`'), 'Cafe24 제품 신원을 만들지 않습니다');
  assert.ok(region.includes('`factory:${key}`'), '아직 안 올린 제품 신원을 만들지 않습니다');
});

test('유도해도 신원을 못 채우면 붙이지 않는다', () => {
  const js = source('src', 'product-intake.mjs');
  assert.ok(js.includes("if (!productId) missing.push('productId')"), 'productId 없이 통과시킵니다');
});
