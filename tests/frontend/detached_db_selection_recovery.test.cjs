'use strict';

// 회귀: 사람이 고른 DB/Cafe24 후보를 되돌릴 방법 없이 지워 버리던 문제.
//
// repairFactoryProductIdentityDrift 는 상품명과 확정 DB 가 서로 다른 물건이면
// 선택을 떼어낸다. 이름 비교는 공백을 지우고 소문자로 바꾼 뒤 한쪽이 다른 쪽을
// 포함하는지만 본다. 그래서 '수저집 파우치' 작업에서 '수저주머니' 를 고르면
// 불일치로 판정된다.
//
// 실제 피해: 2026-08-28 '수저집 파우치' 작업에서 고른 신화사DB 키 787 ·
//   Cafe24 키 2534 가 새로고침 한 번에 사라졌다. 저장본·IndexedDB·스냅샷
//   어디에도 남지 않아 복구가 불가능했다. 7월 16일에도 같은 일이 있었다.
//
// 계약: 떼어내되 버리지 않는다. product.detachedDbSelection 에 보관하고,
//       사용자가 되돌리거나 버릴 수 있어야 한다. 이 정리는 normalize 마다
//       돌기 때문에, 이미 비운 뒤 다시 들어와 빈 값으로 보관본을 덮으면 안 된다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'src/cafe24-sync.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// repairFactoryProductIdentityDrift 와 그것이 쓰는 신원 비교 헬퍼들을 실물로 싣는다.
function loadRepair() {
  const identity = sourceSlice(
    CORE_03,
    'function factoryNormalizeIdentityText(',
    'function factoryCurrentProductNameForIdentity(',
  );
  // 판정 로직 자체이므로 스텁으로 대체하지 않고 실물을 싣는다.
  const conflicts = sourceSlice(
    CORE_03,
    'function factoryObjectConflictsWithIdentity(',
    'function factoryProductScopedFieldIdsForRepair(',
  );
  const repair = sourceSlice(
    CORE_03,
    'function repairFactoryProductIdentityDrift(',
    'function factoryMergeIdentityScope(',
  );
  const context = vm.createContext({
    // 이 시나리오에서 쓰지 않는 보조 함수들은 없는 것으로 두면 실물이 알아서 건너뛴다.
    factoryReviewCandidateProductKey: value => String(value?.reviewProductKey || '').trim(),
    factoryIdentityTextFromObject: value => String(
      value?.product_name || value?.productName || value?.name || '',
    ).trim(),
  });
  vm.runInContext(
    `${identity}\n${conflicts}\n${repair}\nthis.repair = repairFactoryProductIdentityDrift;`,
    context,
  );
  return context.repair;
}

function factoryWith(overrides = {}) {
  return {
    product: {
      userProductName: '수저집 파우치',
      productName: '수저집 파우치',
      confirmedDb: { product_name: '수저주머니' },
      finalDb: { product_name: '수저주머니' },
      selectedDbCandidateKey: '787',
      selectedCafe24CandidateKey: '2534',
      dbLocked: true,
      detachedDbSelection: null,
      ...overrides,
    },
  };
}

test('신원이 다른 DB 선택은 버리지 않고 보관한다', () => {
  const repair = loadRepair();
  const result = repair(factoryWith());
  const product = result.product;

  assert.equal(product.selectedDbCandidateKey, '', '화면에서는 떼어낸다');
  assert.equal(product.confirmedDb, null);
  assert.equal(product.dbLocked, false);

  const kept = product.detachedDbSelection;
  assert.ok(kept, '보관하지 않으면 사용자가 되돌릴 방법이 없습니다.');
  assert.equal(kept.selectedDbCandidateKey, '787');
  assert.equal(kept.selectedCafe24CandidateKey, '2534');
  assert.equal(kept.dbLocked, true);
  assert.ok(kept.confirmedDb, '확정 DB 내용까지 보관해야 되돌릴 수 있습니다.');
  assert.equal(kept.detachedFromProductName, '수저집 파우치');
  assert.match(product.candidateReviewStatus, /되돌리기/);
});

test('정리가 여러 번 돌아도 보관본을 빈 값으로 덮지 않는다', () => {
  // normalizeFactoryState 는 복원마다 이 정리를 부른다. 두 번째부터는 이미
  // 비어 있으므로, 그 빈 값으로 앞선 보관본을 덮으면 결국 잃는 것과 같다.
  const repair = loadRepair();
  let state = repair(factoryWith());
  const first = state.product.detachedDbSelection.selectedDbCandidateKey;
  for (let index = 0; index < 5; index += 1) {
    state = repair(JSON.parse(JSON.stringify(state)));
  }
  assert.equal(state.product.detachedDbSelection.selectedDbCandidateKey, first);
  assert.equal(first, '787');
});

test('신원이 맞으면 건드리지 않는다', () => {
  const repair = loadRepair();
  const same = factoryWith({
    confirmedDb: { product_name: '수저집 파우치' },
    finalDb: { product_name: '수저집 파우치' },
  });
  const product = repair(same).product;
  assert.equal(product.selectedDbCandidateKey, '787', '맞는 선택을 떼어내면 안 됩니다.');
  assert.equal(product.detachedDbSelection, null);
});

test('되돌리기·버리기 동작이 존재하고 보관본을 정리한다', () => {
  assert.match(SYNC, /function factoryRestoreDetachedDbSelection\(/);
  assert.match(SYNC, /function factoryDiscardDetachedDbSelection\(/);

  const restore = sourceSlice(
    SYNC,
    'function factoryRestoreDetachedDbSelection(',
    'function factoryDiscardDetachedDbSelection(',
  );
  // 보관본의 값을 그대로 되돌리고, 되돌린 뒤에는 보관본을 비워야 한다.
  assert.match(restore, /selectedDbCandidateKey = String\(detached\.selectedDbCandidateKey/);
  assert.match(restore, /selectedCafe24CandidateKey = String\(detached\.selectedCafe24CandidateKey/);
  assert.match(restore, /confirmedDb = detached\.confirmedDb/);
  assert.match(restore, /detachedDbSelection = null/);
});

test('보관본은 정규화를 통과해 살아남고 화면에 되돌리기 버튼이 나온다', () => {
  // 정규화가 필드를 걸러내면 저장·복원 과정에서 보관본이 사라진다.
  assert.match(CORE_03, /detachedDbSelection: product\.detachedDbSelection && typeof product\.detachedDbSelection === 'object'/);

  assert.match(CORE_05, /function renderFactoryDetachedDbSelectionRestore\(/);
  assert.match(CORE_05, /data-factory-restore-detached-db/);
  assert.match(CORE_05, /data-factory-discard-detached-db/);
  assert.match(CORE_05, /renderFactoryDetachedDbSelectionRestore\(factory\)/);

  const dbTab = fs.readFileSync(path.join(ROOT, 'src/menus/factory/tabs/db-tab.mjs'), 'utf8');
  assert.match(dbTab, /'restore-detached-db': 'restoreDetachedDbSelection'/);
  assert.match(dbTab, /'discard-detached-db': 'discardDetachedDbSelection'/);
  assert.match(dbTab, /data-factory-restore-detached-db/);

  assert.match(CORE_03, /'factory\/db:restoreDetachedDbSelection', 'factory\/db:discardDetachedDbSelection'/);
});
