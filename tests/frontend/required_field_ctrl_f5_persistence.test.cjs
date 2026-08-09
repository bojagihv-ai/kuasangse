'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(name) {
  return fs.readFileSync(path.join(ROOT, 'src', name), 'utf8');
}

function extractFunction(text, name, nextName) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source boundary is required`);
  return text.slice(start, end);
}

function compileFunction(text, name, nextName, globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${extractFunction(text, name, nextName)}\nthis.target = ${name};`, context);
  return context.target;
}

test('필수값 확정 저장은 detached factory를 서버 Ctrl+F5 저장 경계까지 전달한다', () => {
  const persistence = source('app-core-02.js');
  const saveNow = extractFunction(persistence, 'saveLastWorkNow', 'flushLastWorkBeforeLeave');
  const saveServer = extractFunction(persistence, 'saveServerLastWorkSnapshot', 'scheduleServerLastWorkSave');

  assert.match(
    saveNow,
    /serverSaveOptions\.factorySnapshot\s*=\s*detachedFactory[\s\S]*saveServerLastWorkSnapshot\(\s*['"]manual-now['"]\s*,\s*serverSaveOptions/,
    '수동 필수값 확정 저장이 서버 저장 경계에서 최신 detached factory를 잃으면 안 됩니다.',
  );
  assert.match(
    saveServer,
    /buildServerLastWorkSnapshot\(\s*reason\s*,\s*\{\s*factorySnapshot:\s*requestedFactorySnapshot\s*\|\|\s*options\.factorySnapshot,\s*\}\s*\)/,
    '서버 스냅샷은 호출자가 전달한 최신 factory snapshot을 사용해야 합니다.',
  );
});

test('수동 판매가는 기존 최종등록 판매가 0에 의해 덮어써지지 않는다', () => {
  const productForm = source('cafe24-product-form.js');
  const updateFinalDb = extractFunction(productForm, 'factoryUpdateFinalDbFromFields', 'factoryPresetSnapshot');

  assert.match(
    updateFinalDb,
    /finalRegistrationSalePrice\s*&&\s*factoryCafe24PositiveMoneyText\(finalRegistrationSalePrice\)/,
    '최종등록 캐시의 0은 수동으로 확정한 양수 판매가를 덮어쓰면 안 됩니다.',
  );

  const appCore = source('app-core-05.js');
  const finalBasicInfo = extractFunction(appCore, 'factoryFinalRegistrationBasicInfoModel', 'factoryFinalRegistrationDetailModel');
  assert.match(
    finalBasicInfo,
    /factoryCafe24PositiveMoneyText/,
    '최종 등록 화면도 0 캐시보다 확정된 양수 판매가를 표시해야 합니다.',
  );
  assert.match(
    finalBasicInfo,
    /factoryAutomationFieldValue\(factory,\s*['"]sale_price['"]/, 
    '최종 등록 화면은 필수값에서 확인된 판매가를 최종등록 0보다 우선해야 합니다.',
  );

  const renderCache = extractFunction(appCore, 'factoryRenderCacheFinalBasicInfoModel', 'factoryRenderCacheFinalDetailModel');
  assert.doesNotMatch(
    renderCache,
    /factoryRenderCacheCreateModel\(factory,\s*cache\)/,
    '최종 등록 기본정보는 오래된 render cache의 판매가를 재사용하면 안 됩니다.',
  );

  assert.match(
    finalBasicInfo,
    /factoryRuntimeReadCommittedFactory/,
    '최종 등록 화면은 detached snapshot보다 현재 committed 필수값을 우선해야 합니다.',
  );

  const wizardCore = source('app-core-06.js');
  const commitField = extractFunction(wizardCore, 'factoryCommitAutomationWizardFieldValue', 'factoryApplyAutomationWizardFieldInput');
  assert.match(
    commitField,
    /factorySetFinalRegistrationBasicValue\(current,\s*fieldId,\s*value\)/,
    '필수값 판매가 확인은 최종등록 기본정보에도 반영되어야 합니다.',
  );
  assert.doesNotMatch(
    commitField,
    /scheduleLastWorkSave\(/,
    '필수값 확정 직후 stale render draft가 최신 판매가를 다시 0으로 저장하면 안 됩니다.',
  );
});

test('최종 등록 판매가 적용은 이전 0원 입력 초안을 지워 필수값 화면을 되돌리지 않는다', () => {
  const appCore = source('app-core-05.js');
  const setFinalBasicValue = compileFunction(
    appCore,
    'factorySetFinalRegistrationBasicValue',
    'factoryApplyFinalRegistrationBasicInfoInputs',
    {
      factoryNormalizeFinalRegistrationBasicValue(_fieldId, value) {
        return String(value ?? '').trim().replace(/,/g, '');
      },
      factorySetDbFieldManualValue(fieldId, value, options) {
        const factory = options.factory;
        factory.product.dbFieldSettings ||= {};
        factory.product.dbFieldSettings[fieldId] = {
          enabled: true,
          manualValue: value,
          manualTouched: true,
        };
      },
    },
  );
  const factory = {
    product: {
      finalDb: { sale_price: '0' },
      dbFieldSettings: {},
    },
    automation: {
      fieldDrafts: {
        sale_price: { value: '0', updatedAt: 1 },
        material: { value: '모시', updatedAt: 2 },
      },
    },
  };

  setFinalBasicValue(factory, 'sale_price', '5000');

  assert.equal(factory.product.cafe24FinalRegistration.price, '5000');
  assert.equal(factory.product.finalDb.sale_price, '5000');
  assert.equal(factory.product.dbFieldSettings.sale_price.manualValue, '5000');
  assert.equal(factory.automation.fieldDrafts.sale_price, undefined,
    '확정된 판매가보다 오래된 0원 입력 초안이 필수값 카드에 다시 표시되면 안 됩니다.');
  assert.deepEqual(factory.automation.fieldDrafts.material, { value: '모시', updatedAt: 2 },
    '판매가 확정은 다른 필수값의 입력 초안을 건드리면 안 됩니다.');
});

test('동일 작업 복원은 양수 판매가를 오래된 0으로 낮추지 않는다', () => {
  const core = source('app-core-03.js');
  const preserve = extractFunction(core, 'factoryPreserveProgressForSameWork', 'factoryHasMeaningfulWork');

  assert.match(
    preserve,
    /preservePositiveMoney/, 
    '동일 작업 복원은 판매가 0을 기존 양수 판매가보다 우선하면 안 됩니다.',
  );
  assert.match(
    preserve,
    /mergeBlankSafe\(value,\s*merged\[key\],\s*path/, 
    '복원 병합은 필드 경로를 전달해 금액 필드 보호를 적용해야 합니다.',
  );
});
