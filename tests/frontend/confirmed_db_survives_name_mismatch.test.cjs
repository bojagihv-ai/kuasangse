'use strict';

// 회귀: 사람이 고른 신화사DB/Cafe24 상품이 새로고침마다 떼어내지던 문제.
//
// 사용자 제보(2026-08-29):
//   "신화사db와 카페24제품은 이미 여러번 선택을했어 근데 클로드에서 다른부분을
//    업데이트하다보면 자꾸 날아가" / "내가 한 20번정도 계속같은문제로 고통받았던 문제야"
//
// 실측(브라우저 IndexedDB 를 앱을 띄우지 않고 직접 조회):
//   문서 batch:factory-job-d9881fb8d93b4d01... 안에서
//     확정 DB 2589 '누비꽃수파우치'      → 도장 없음 → **떼어내짐**
//     Cafe24 후보 394 '칠색단 수저집(대)…' → 도장 있음 → **살아남음**
//   두 이름 모두 제품명 '수저집 파우치' 와 안 맞는다. 차이는 도장 하나뿐이었다.
//
// 원인: factoryObjectConflictsWithIdentity 는 도장(reviewProductScopeKey 계열)이 없으면
//   **이름**으로 판정한다. 검색으로 긁어온 후보라면 이름이 제품명과 닮는 게 맞지만,
//   사람이 확정한 상품은 카탈로그 이름이라 제품명과 다른 것이 정상이다.
//   그래서 정상적인 확정이 매번 충돌로 판정돼 떼어내졌다.
//
// 계약:
//   1) 확정하는 순간 도장을 찍는다 (앞으로 고르는 것).
//   2) 도장이 없는 낡은 확정본은 이름만으로 떼어내지 않는다 (이미 저장된 것).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'src/cafe24-sync.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 로직 자체이므로 스텁으로 대체하지 않고 실물을 싣는다.
function loadConflict() {
  const identity = sourceSlice(
    CORE_03,
    'function factoryNormalizeIdentityText(',
    'function factoryCurrentProductNameForIdentity(',
  );
  const conflicts = sourceSlice(
    CORE_03,
    'function factoryObjectConflictsWithIdentity(',
    'function factoryProductScopedFieldIdsForRepair(',
  );
  const context = vm.createContext({
    factoryReviewCandidateProductKey: value => {
      // 실물과 같은 규칙: 도장에서 productKey 자리를 뽑는다.
      const scope = String(value?.reviewProductScopeKey || '').trim();
      const parts = scope.split('::');
      return parts.length === 3 ? parts[1] : '';
    },
    factoryIdentityTextFromObject: value => String(
      value?.product_name || value?.productName || value?.jname || value?.name || '',
    ).trim(),
  });
  vm.runInContext(
    `${identity}\n${conflicts}\nthis.conflicts = factoryObjectConflictsWithIdentity;`,
    context,
  );
  return context.conflicts;
}

const WORK_KEY = '수저집파우치';                       // factoryNormalizeIdentityText('수저집 파우치')
const SCOPE = `ws-1::${WORK_KEY}::candidate-review`;

test('도장이 있으면 카탈로그 이름이 달라도 충돌이 아니다', () => {
  // Cafe24 후보 394 가 살아남은 이유. 이름은 전혀 안 맞는다.
  const conflicts = loadConflict();
  const stamped = { product_name: '칠색단 수저집(대) 빨강에노란띠', reviewProductScopeKey: SCOPE };
  assert.equal(conflicts(stamped, WORK_KEY), false);
});

test('도장이 다른 작업 것이면 충돌이다', () => {
  // 남의 작업 후보가 섞이는 것은 계속 막아야 한다. 이게 원래 이 판정의 목적이다.
  const conflicts = loadConflict();
  const foreign = { product_name: '무엇이든', reviewProductScopeKey: 'ws-1::낙지발노리개::candidate-review' };
  assert.equal(conflicts(foreign, WORK_KEY), true);
});

test('도장이 없을 때 이름만으로 확정본을 죽이지 않는다', () => {
  // 실제 피해: 확정 DB '누비꽃수파우치' 가 제품명 '수저집 파우치' 와 다르다는 이유로 떼어내졌다.
  const conflicts = loadConflict();
  const legacyConfirmed = { product_name: '누비꽃수파우치' };
  assert.equal(
    conflicts(legacyConfirmed, WORK_KEY, { nameFallback: false }),
    false,
    '카탈로그 이름이 제품명과 다른 것은 정상입니다. 이것으로 선택을 버리면 안 됩니다.',
  );
  // 후보 목록처럼 이름이 근거가 되는 자리에서는 예전 동작을 유지한다.
  assert.equal(conflicts(legacyConfirmed, WORK_KEY), true);
});

test('확정본 판정은 이름 폴백을 끄고 부른다', () => {
  const repair = sourceSlice(
    CORE_03,
    'function repairFactoryProductIdentityDrift(',
    'function factoryMergeIdentityScope(',
  );
  assert.match(repair, /factoryObjectConflictsWithIdentity\(product\.confirmedDb, identityKey, \{ nameFallback: false \}\)/);
  // finalDb 는 다르다. 이름이 이 작업의 제품명을 따라가므로 이름 비교가 유효한 신호다.
  // 실측(같은 저장본): confirmedDb='누비꽃수파우치' / finalDb='수저집 파우치'.
  // 여기까지 풀면 제품을 바꿨을 때 이전 제품의 최종값이 남는다(회귀 FIELD-01).
  assert.match(repair, /factoryObjectConflictsWithIdentity\(product\.finalDb, identityKey\);/);
  // 후보 목록 쪽은 그대로 이름 폴백을 쓴다(검색 후보는 이름이 근거가 된다).
  assert.match(repair, /product\[key\]\.filter\(item => !factoryObjectConflictsWithIdentity\(item, identityKey\)\)/);
});

test('확정하는 순간 도장을 찍는다', () => {
  // 이게 없으면 앞으로 고르는 선택도 계속 도장 없이 저장돼 같은 문제가 재발한다.
  assert.match(SYNC, /function factoryStampReviewScopeOnConfirmed\(/);
  assert.match(SYNC, /current\.product\.confirmedDb = factoryStampReviewScopeOnConfirmed\(cloneData\(match\), current\)/);

  const stamp = sourceSlice(SYNC, 'function factoryStampReviewScopeOnConfirmed(', 'function factorySlimReviewCandidateList(');
  const fn = new Function(`
    ${stamp}
    function factoryCandidateReviewScopeKey() { return '${SCOPE}'; }
    function factoryCandidateReviewIdentityKey() { return 'ws-1::x::${WORK_KEY}::y::candidate-review'; }
    function factoryCandidateReviewProductName() { return '수저집 파우치'; }
    return factoryStampReviewScopeOnConfirmed;
  `)();
  const stamped = fn({ product_name: '누비꽃수파우치', jcode: '2589' }, {});
  assert.equal(stamped.reviewProductScopeKey, SCOPE, '도장이 안 찍히면 다음 새로고침에 또 떼어내집니다.');
  assert.equal(stamped.product_name, '누비꽃수파우치', '원본 내용은 그대로 둬야 합니다.');
  assert.equal(stamped.jcode, '2589');
});

test('도장을 못 만들면 원본을 그대로 둔다', () => {
  const stamp = sourceSlice(SYNC, 'function factoryStampReviewScopeOnConfirmed(', 'function factorySlimReviewCandidateList(');
  const fn = new Function(`
    ${stamp}
    function factoryCandidateReviewScopeKey() { return ''; }
    function factoryCandidateReviewIdentityKey() { return ''; }
    function factoryCandidateReviewProductName() { return ''; }
    return factoryStampReviewScopeOnConfirmed;
  `)();
  const value = { product_name: '누비꽃수파우치' };
  assert.equal(fn(value, {}), value, '빈 도장을 찍어 내용을 헝클면 안 됩니다.');
});
