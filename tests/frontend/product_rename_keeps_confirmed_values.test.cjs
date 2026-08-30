'use strict';

// 계약: **제품명을 바꾸는 것은 '새 작업' 이 아니다.**
//
// 주인님 규칙 (여러 번, 점점 강하게):
//   "필수값뿐만 아니라 모든 게, 이미지 고른 거든 뭐든 안 날아가야 한다. **새 작업 누르기 전에는.**"
//
// 2026-08-30 실측으로 잡은 사고:
//   조립공장에서 확인을 눌러 확정해 둔 필수값(사이즈·가로·세로·무게·소재·사용용도),
//   신화사DB 선택, 카페24 제품 선택이 통째로 사라지고 예전 값으로 되돌아갔다.
//   주인님은 이걸 "새로고침하면 날아간다" 로 겪으셨지만, 새로고침은 원인이 아니었다.
//
//   진짜 원인: factorySetCurrentProductIdentity 가 제품명이 바뀌면
//   factoryClearProductScopedDbManualFields 를 **보존 옵션 없이** 불렀다.
//   그 함수는 preserveManualFields / preserveDb / preserveCafe24 를 이미 갖고 있고,
//   형제 호출부(신화사 후보 변경·카페24 후보 변경)는 전부 넘기는데 여기만 빠져 있었다.
//   그래서 이름을 고치거나 파란 시작 버튼을 누르는 순간(둘 다 이 경로를 탄다)
//   manualTouched:true 인 값들이 그 자리에서 삭제됐다.
//
// 이 검사는 문자열 패턴이 아니라 **실제 함수를 돌려서** 살아남는지 본다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const CAFE24 = fs.readFileSync(path.join(ROOT, 'src/cafe24-sync.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

const CALL_SITE = sourceSlice(
  CORE_03,
  "if (productChanged && typeof factoryClearProductScopedDbManualFields === 'function') {",
  'if (options.setSearchQuery !== false)',
);

test('제품명 변경 호출부가 보존 옵션을 넘긴다', () => {
  assert.match(CALL_SITE, /preserveManualFields: true/, '사람이 확인한 값이 지워집니다.');
  assert.match(CALL_SITE, /preserveDb: true/, '신화사DB 선택이 지워집니다.');
  assert.match(CALL_SITE, /preserveCafe24: true/, '카페24 선택이 지워집니다.');
});

test('형제 호출부와 같은 규칙을 쓴다', () => {
  // '후보를 바꿀 때는 지키는데 이름을 바꿀 때는 안 지키는' 비대칭이 사고의 모양이었다.
  for (const reason of ['sinhwa-candidate-change', 'cafe24-candidate-change']) {
    const at = CAFE24.indexOf(`'${reason}'`);
    assert.notEqual(at, -1, `형제 호출부가 사라졌습니다: ${reason}`);
    assert.match(CAFE24.slice(at, at + 200), /preserveManualFields/);
  }
});

test('이름이 바뀌면 지우는 대신 사람에게 확인을 청한다', () => {
  assert.match(CALL_SITE, /candidateReviewStatus/);
  assert.match(CALL_SITE, /맞는지 확인해주세요/);
});

// ── 실물 실행: 확정값이 정말 살아남는가 ──────────────────────────────
function loadClearFunction() {
  const source = sourceSlice(
    CAFE24,
    'function factoryClearProductScopedDbManualFields(',
    '\nfunction factoryAutoFieldTextValue(',
  );
  const context = vm.createContext({
    state: { productInfoManualValues: {} },
    cloneData: value => (value === undefined ? value : JSON.parse(JSON.stringify(value))),
    FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS: ['size', 'width', 'length', 'weight', 'material', 'usage', 'sale_price'],
    factoryRecordFieldLoss: () => {},
    factoryCaptureLockedProductName: () => '',
    factoryRestoreLockedProductName: () => {},
    factoryResetCafe24DraftsForProduct: () => {},
    factoryDedupeSinhwaCandidates: rows => rows,
    factoryMergeCafe24Candidates: (a, b) => [...(a || []), ...(b || [])],
    console,
  });
  vm.runInContext(`${source}\nthis.clear = factoryClearProductScopedDbManualFields;`, context);
  return context.clear;
}

function buildFactory() {
  const manual = value => ({ value, manualValue: value, manualTouched: true });
  return {
    product: {
      productName: '슬라브나비수부채집',
      dbFieldSettings: {
        size: manual('가로 55cm x 세로 55cm'),
        weight: manual('120g'),
        material: manual('면 100%'),
        usage: manual('생활'),
        sale_price: manual('12500'),
      },
      confirmedDb: { id: 'db-1', material: '면 100%' },
      dbCandidates: [{ id: 'db-1' }],
      selectedDbCandidateKey: 'db-1',
      selectedCafe24CandidateKey: 'cafe24-1',
      confirmedCafe24ProductKey: 'cafe24-1',
    },
    automation: { fieldReview: { size: { status: 'confirmed' } } },
  };
}

test('실물 실행: 확정한 필수값이 이름 변경에도 살아남는다', () => {
  const clear = loadClearFunction();
  const factory = buildFactory();
  clear(factory, 'product-identity-change', {
    nextProductName: '방울수저집',
    preserveManualFields: true,
    preserveDb: true,
    preserveCafe24: true,
  });
  const kept = Object.keys(factory.product.dbFieldSettings || {}).sort();
  for (const fieldId of ['size', 'weight', 'material', 'usage', 'sale_price']) {
    assert.ok(kept.includes(fieldId), `확인해서 확정한 값이 사라졌습니다: ${fieldId}`);
  }
  assert.equal(factory.product.dbFieldSettings.size.manualValue, '가로 55cm x 세로 55cm');
});

test('실물 실행: DB·카페24 선택도 살아남는다', () => {
  const clear = loadClearFunction();
  const factory = buildFactory();
  clear(factory, 'product-identity-change', {
    nextProductName: '방울수저집',
    preserveManualFields: true,
    preserveDb: true,
    preserveCafe24: true,
  });
  assert.ok(factory.product.confirmedDb, '신화사DB 선택이 사라졌습니다.');
  assert.equal(factory.product.selectedDbCandidateKey, 'db-1');
  assert.equal(factory.product.selectedCafe24CandidateKey, 'cafe24-1');
});

test('검사에 힘이 있다 — 보존 옵션을 빼면 실제로 다 사라진다', () => {
  // 이 검사가 없으면 위 계약들이 '늘 통과하는 검사' 가 된다.
  const clear = loadClearFunction();
  const factory = buildFactory();
  clear(factory, 'product-identity-change', { nextProductName: '방울수저집' });
  const kept = Object.keys(factory.product.dbFieldSettings || {});
  assert.equal(kept.length, 0, '보존 옵션 없이도 값이 남는다면 이 검사는 아무것도 지키지 못합니다.');
  assert.equal(factory.product.confirmedDb, null);
});
