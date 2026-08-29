'use strict';

// 회귀: 직접 입력한 사이즈/가로/세로가 새로고침마다 사라지던 문제.
//
// 사용자 제보(2026-08-29):
//   "왜자꾸 너가 코딩하나할떄마다 이게날라가냐고"
//   "하나고치면 하나망가지고 를 안하기위해서 회귀테스트도 하고 하는거잖아"
//   스크린샷 대조: 한 시간 전 사이즈/규격 '가로3.5cm*세로18cm', 가로 '3.5cm',
//   세로 '18cm' 가 모두 초록 확인됨 → 이후 셋 다 빈칸.
//
// 원인은 **내가 오늘 넣은 수정(7ceb866)** 이다.
//   factoryManualFieldSettingMatchesCurrentWork 는 setting.workspaceId 가 현재 저장 ID와
//   같아야 '현재 작업 것' 으로 인정한다(app-core-03.js:2018). 그리고 현재 저장 ID가
//   비어 있으면 아예 false 를 돌려준다(2017행의 `workspaceId &&`).
//   그런데 내가 넣은 작업파일 분리(startNewProjectDraft)는 저장 ID를 잠시 **빈 값**으로 만든다.
//   그 상태에서 신원 정리가 돌면 수동 입력값이 전부 '남의 것' 으로 몰려 지워졌다.
//
// 계약: 지금 작업이 무엇인지 모를 때는 사람이 직접 친 값을 지우지 않는다.
//       모른다는 것은 남의 것이라는 뜻이 아니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 자체가 검사 대상이므로 실물을 싣는다.
function loadRepair(currentProjectId) {
  const source = sourceSlice(
    CORE_03,
    'function repairFactoryProductIdentityDrift(',
    'function factoryMergeIdentityScope(',
  );
  const context = vm.createContext({
    state: { currentProjectId },
    cloneData: value => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value))),
    factoryNormalizeIdentityText: value => String(value ?? '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKeysCompatible: (a, b) => !!a && !!b && (String(a).includes(String(b)) || String(b).includes(String(a))),
    factoryObjectConflictsWithIdentity: (value, key) => {
      if (!value || !key) return false;
      const name = String(value.product_name || '').replace(/\s+/g, '').toLowerCase();
      return !!name && !name.includes(key) && !key.includes(name);
    },
    factoryProductScopedFieldIdsForRepair: () => ['size', 'width_mm', 'depth_mm', 'weight', 'sale_price'],
    factoryManualFieldSettingMatchesCurrentWork: () => false,   // 분리 직후엔 어느 것도 안 맞는다
    factoryBackfillManualFieldSettingScopeFromReview: () => {},
    factoryObjectHasEntries: value => !!value && Object.keys(value).length > 0,
  });
  vm.runInContext(`${source}\nthis.repair = repairFactoryProductIdentityDrift;`, context);
  return context.repair;
}

function factoryWithTypedSize(productName) {
  return {
    workspace: { id: '' },
    product: {
      userProductName: productName,
      // finalDb 이름이 현재 제품명과 다르므로 신원 정리가 발동한다.
      finalDb: { product_name: '수저집 파우치' },
      confirmedDb: null,
      dbFieldSettings: {
        size: { manualValue: '가로3.5cm*세로18cm', manualTouched: true, workspaceId: 'batch:old-job' },
        width_mm: { manualValue: '3.5cm', manualTouched: true, workspaceId: 'batch:old-job' },
        depth_mm: { manualValue: '18cm', manualTouched: true, workspaceId: 'batch:old-job' },
        weight: { manualValue: '1.00g', manualTouched: false, workspaceId: 'batch:old-job' },
      },
    },
    automation: { fieldReview: {} },
  };
}

test('작업파일을 가르는 중이면 직접 친 값을 지우지 않는다', () => {
  // 이것이 실제 사고다. 분리 직후 저장 ID가 비어 있는 순간에 정리가 돌았다.
  const repair = loadRepair('');            // 저장 ID를 아직 모른다
  const factory = factoryWithTypedSize('자수 미니 파우치 시험용');
  const fields = repair(factory).product.dbFieldSettings;

  assert.equal(fields.size?.manualValue, '가로3.5cm*세로18cm', '사람이 확인까지 눌러 넣은 값입니다.');
  assert.equal(fields.width_mm?.manualValue, '3.5cm');
  assert.equal(fields.depth_mm?.manualValue, '18cm');
  assert.ok(fields.weight, '자동값도 판단 근거가 없을 때는 함부로 지우지 않습니다.');
});

test('저장 ID를 알아도 사람이 넣은 값은 지우지 않는다', () => {
  // 사용자 규칙: "모든게 이미지고른거든 뭐든 안날라가야돼. 새작업 누르기전에는"
  // 지우는 것은 사람이 '새 작업' 을 눌렀을 때만이어야 한다.
  const repair = loadRepair('project_mine');
  const factory = factoryWithTypedSize('자수 미니 파우치 시험용');
  const fields = repair(factory).product.dbFieldSettings;
  assert.equal(fields.size?.manualValue, '가로3.5cm*세로18cm', '손으로 채운 값은 남아야 합니다.');
  assert.equal(fields.width_mm?.manualValue, '3.5cm');
  assert.equal(fields.depth_mm?.manualValue, '18cm');
});

test('자동으로 채워진 값은 예전처럼 정리한다', () => {
  // 자동값은 다시 만들어낼 수 있으므로 남의 것이면 치운다. 보호를 통째로 없앤 게 아니다.
  const repair = loadRepair('project_mine');
  const factory = factoryWithTypedSize('자수 미니 파우치 시험용');
  factory.product.dbFieldSettings.sale_price = { manualValue: '12500', manualTouched: false, workspaceId: 'batch:old-job' };
  const fields = repair(factory).product.dbFieldSettings;
  assert.equal(fields.sale_price, undefined, '자동으로 채운 남의 값은 계속 정리되어야 합니다.');
  assert.equal(fields.weight, undefined, '무게도 자동값이면 정리 대상입니다.');
});

test('신원이 어긋나지 않으면 애초에 아무것도 안 지운다', () => {
  const repair = loadRepair('project_mine');
  const factory = factoryWithTypedSize('수저집 파우치');   // finalDb 와 이름이 같다
  const fields = repair(factory).product.dbFieldSettings;
  assert.equal(fields.size?.manualValue, '가로3.5cm*세로18cm');
  assert.equal(fields.depth_mm?.manualValue, '18cm');
});

test('지우기 판단은 현재 저장 ID를 확인한 뒤에만 한다', () => {
  const repair = sourceSlice(CORE_03, 'function repairFactoryProductIdentityDrift(', 'function factoryMergeIdentityScope(');
  assert.match(repair, /const currentWorkspaceId = String\(/);
  assert.match(repair, /if \(currentWorkspaceId\) \{/, '저장 ID를 모르는 채로 지우면 사람이 친 값이 날아갑니다.');
  const guardAt = repair.indexOf('if (currentWorkspaceId) {');
  const deleteAt = repair.indexOf('delete product.dbFieldSettings[fieldId];');
  assert.ok(guardAt >= 0 && deleteAt > guardAt, '지우기가 확인 밖에 있습니다.');
});
