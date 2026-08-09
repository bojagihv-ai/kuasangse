const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
const helperStart = source.indexOf('const FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS');
const helperEnd = source.indexOf('\nfunction factoryInferUsageFromSelectedProductText', helperStart);
if (helperStart < 0 || helperEnd < 0) throw new Error('required-field helper slice not found');

function loadHelpers() {
  const context = vm.createContext({
    Date,
    String,
    Number,
    Array,
    Object,
    Boolean,
    console,
    structuredClone: value => JSON.parse(JSON.stringify(value)),
    cloneData: value => JSON.parse(JSON.stringify(value)),
    state: { productInfoManualValues: {} },
    factoryCaptureLockedProductName: factory => String(factory?.product?.productName || ''),
    factoryRestoreLockedProductName: (factory, name) => {
      if (name) factory.product.productName = name;
    },
    factoryDbFieldSetting: (factory, fieldId, create = false) => {
      if (!factory.product.dbFieldSettings || typeof factory.product.dbFieldSettings !== 'object') {
        if (!create) return null;
        factory.product.dbFieldSettings = {};
      }
      if (!factory.product.dbFieldSettings[fieldId] && create) factory.product.dbFieldSettings[fieldId] = {};
      return factory.product.dbFieldSettings[fieldId] || null;
    },
  });
  vm.runInContext(`${source.slice(helperStart, helperEnd)}
this.factoryClearProductScopedDbManualFields = factoryClearProductScopedDbManualFields;
this.factorySetSelectedProductAutoField = factorySetSelectedProductAutoField;`, context);
  return context;
}

test('같은 상품의 수동 필수값은 후보 자동채움에 덮어쓰이지 않는다', async () => {
  const context = loadHelpers();
  const result = vm.runInContext(`(() => {
    const factory = {
      product: {
        dbFieldSettings: {
          size: {
            manualValue: '가로21cm*세로14cm',
            manualTouched: true,
          },
        },
      },
    };
    factorySetSelectedProductAutoField(factory, 'size', '자동 후보값', 'Cafe24 선택 상품');
    return factory.product.dbFieldSettings.size;
  })()`, context);

  assert.equal(result.manualValue, '가로21cm*세로14cm');
  assert.equal(result.manualTouched, true);
});

test('같은 후보 재적용의 필수값 초기화는 수동 필드와 확인 기록을 보존한다', async () => {
  const context = loadHelpers();
  const result = vm.runInContext(`(() => {
    const factory = {
      product: {
        selectedDbCandidateKey: '2589',
        dbCandidates: [{ jcode: '2589', product_name: '모시꽃수파우치' }],
        dbFieldSettings: {
          size: {
            manualValue: '가로21cm*세로14cm',
            manualTouched: true,
          },
          material: {
            manualValue: '모시',
            manualTouched: true,
          },
        },
      },
      automation: {
        fieldReview: {
          size: { value: '가로21cm*세로14cm', manualTouched: true },
          material: { value: '모시', manualTouched: true },
        },
      },
    };
    factoryClearProductScopedDbManualFields(factory, 'same-candidate-reapply', {
      preserveManualFields: true,
    });
    return {
      settings: factory.product.dbFieldSettings,
      reviews: factory.automation.fieldReview,
    };
  })()`, context);

  assert.equal(result.settings.size.manualValue, '가로21cm*세로14cm');
  assert.equal(result.settings.material.manualValue, '모시');
  assert.equal(result.reviews.size.value, '가로21cm*세로14cm');
  assert.equal(result.reviews.material.value, '모시');
});
