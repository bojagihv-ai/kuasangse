'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { functionSource, readSourceLf } = require('./source_slice_utils.cjs');
const source = readSourceLf(path.resolve(__dirname, '../../src/cafe24-payloads.js'));
function runtime(fields = []) {
  const context = vm.createContext({
    CAFE24_PRODUCT_ARRAY_PAYLOAD_FIELDS: new Set(), CAFE24_PRODUCT_JSON_PAYLOAD_FIELDS: new Set(),
    factoryCafe24FormSourceContext: () => ({}), factoryCafe24RawForForm: () => ({}),
    factoryCafe24FormFieldsFlat: () => fields, factoryCafe24FieldVisibleInInput: () => true,
    factoryCafe24CanonicalUpdateField: value => value, factoryCafe24FormFieldKey: field => field.id,
    factoryCafe24FormManualSetting: () => null, factoryCafe24SelectOptionValue: value => value,
    factoryCafe24ApiFieldNameFromSource: field => field.apiField,
    factoryTruthyCafe24Flag: () => '', factoryAuthoritativeProductName: () => '',
    factoryRemoveCafe24InvalidReferenceCodePayloadFields: () => {},
    factoryCafe24EnsureScopedDetailHtmlPayload: () => {}, factoryCafe24SanitizeDetailHtmlPayload: () => {},
    factoryCafe24PruneEmptyProductPayload: () => {},
  });
  for (const name of ['factoryCafe24WeightValueForPayload', 'factoryCafe24PayloadValue',
    'factoryCafe24ResolvedFormValue', 'factoryMergeCafe24VisibleFormPayload', 'factoryBuildCafe24UpdatePayload']) {
    const body = functionSource(source, name);
    assert.ok(body, `missing real function: ${name}`);
    vm.runInContext(body, context);
  }
  return context;
}
test('포장 포함 총무게 15g는 product_weight payload에서 정확히 0.015kg다', () => {
  assert.equal(runtime().factoryCafe24PayloadValue('product_weight', '15g'), '0.015');
});
test('Cafe24 상품 무게 재조회는 서버의 kg 소수 둘째 자리 정규화를 허용한다', () => {
  const api = runtime();
  api.factoryCafe24ValuesRoughlyEqual = () => false;
  const body = functionSource(source, 'factoryCafe24ProductFieldValuesEqual');
  assert.ok(body, 'missing real function: factoryCafe24ProductFieldValuesEqual');
  vm.runInContext(body, api);
  assert.equal(api.factoryCafe24ProductFieldValuesEqual('product_weight', '15g', '0.02'), true);
  assert.equal(api.factoryCafe24ProductFieldValuesEqual('product_weight', '15g', '0.03'), false);
});
test('공통 무게 변환은 기존 단위 해석과 0 및 소수 정밀도를 유지한다', () => {
  const convert = runtime().factoryCafe24WeightValueForPayload;
  for (const [value, key, finalDb, expected] of [
    ['15g', 'weight', {}, '0.015'], ['15', 'product_weight_g', {}, '0.015'],
    ['15', 'weight', {}, '0.015'], ['15', 'product_weight', {}, '15'],
    ['1.25 kg', 'product_weight', {}, '1.25'], ['0.015 kg', 'product_weight', {}, '0.015'],
    ['0.5g', 'product_weight', {}, '0.0005'], ['0.001g', 'product_weight', {}, '0.000001'],
    ['1,500그램', 'weight', {}, '1.5'], ['0', 'product_weight', {}, '0'],
    ['0g', 'weight', {}, '0'], ['15', 'product_weight', { weight_unit: 'g' }, '0.015'],
    ['15g', '', {}, '0.015'], ['', 'product_weight', {}, ''], ['미확인', 'product_weight', {}, '미확인'],
  ]) {
    const before = structuredClone(finalDb);
    assert.equal(convert(value, key, Object.freeze(finalDb)), expected, `${value} (${key})`);
    assert.deepEqual(finalDb, before);
  }
});
test('기존 폼의 일반 입력과 선택형 무게 필드 모두 15g를 0.015kg로 전송한다', () => {
  for (const selectOptions of [undefined, [{ value: '15g', label: '포장 포함 15g' }]]) {
    const field = { id: 'weight', apiField: 'product_weight', ...(selectOptions ? { selectOptions } : {}) };
    const api = runtime([field]);
    const finalDb = Object.freeze({ weight: '15g' });
    const factory = Object.freeze({ product: Object.freeze({}) });
    const product = api.factoryMergeCafe24VisibleFormPayload({}, finalDb, factory);
    assert.equal(product.product_weight, '0.015');
    assert.equal(finalDb.weight, '15g');
    assert.deepEqual(factory, { product: {} });
  }
});
test('최종 update payload의 직접 매핑과 사용자 정의 필드 경로도 정확한 kg를 유지한다', () => {
  const api = runtime();
  const direct = Object.freeze({ product_weight: '15g' });
  assert.equal(api.factoryBuildCafe24UpdatePayload(direct, [], {}).product_weight, '0.015');
  const custom = Object.freeze({ packed_weight: '15g' });
  const fields = [{ id: 'packed_weight', apiField: 'product_weight', custom: true, enabled: true }];
  assert.equal(api.factoryBuildCafe24UpdatePayload(custom, fields, {}).product_weight, '0.015');
  assert.deepEqual(direct, { product_weight: '15g' });
  assert.deepEqual(custom, { packed_weight: '15g' });
});
