const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../src/cafe24-sync.js'), 'utf8');

function functionSource(name, sourceText = source) {
  const start = sourceText.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0);
  const next = sourceText.slice(start + 1).search(/\n(?:async )?function /);
  return sourceText.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('batch DB collection preserves explicitly supplied field values while clearing stale candidate context', () => {
  const manual = { material: { manualTouched: true, manualValue: '면' }, width_mm: { manualTouched: true, manualValue: '200' }, depth_mm: { manualTouched: true, manualValue: '150' } };
  const factory = { product: { dbFieldSettings: { ...structuredClone(manual), auto_hint: { manualTouched: false, manualValue: '이전 추정값' } }, confirmedDb: { material: '이전 DB' } } };
  const state = { productInfoManualValues: { material: '면', width_mm: '200', depth_mm: '150' } };
  const context = vm.createContext({ state, factoryCaptureLockedProductName: () => '입력 제품', factoryRestoreLockedProductName() {} });
  vm.runInContext(functionSource('factoryResetDbContextForNewCollection'), context);
  context.factoryResetDbContextForNewCollection(factory, { preserveManualFields: true });
  for (const [id, value] of Object.entries(manual)) assert.deepEqual(factory.product.dbFieldSettings[id], value);
  assert.deepEqual(state.productInfoManualValues, { material: '면', width_mm: '200', depth_mm: '150' });
  assert.equal(factory.product.confirmedDb, null);
  assert.equal(factory.product.dbFieldSettings.auto_hint.manualValue, '');
});

test('fresh batch inputs use original manual-field setters with canonical names and no invented values', () => {
  const core = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');
  const factory = { product: {} };
  const assigned = {};
  const context = vm.createContext({ factorySetDbFieldManualValue: (id, value, options) => {
    assert.equal(options.factory, factory);
    assert.equal(options.deferFinalize, true);
    assert.equal(options.enabled, true);
    assigned[id] = value;
  } });
  vm.runInContext(functionSource('factoryRuntimeControlProvidedFieldEntries', core), context);
  vm.runInContext(functionSource('factoryRuntimeControlApplyProvidedRequiredFields', core), context);
  context.factoryRuntimeControlApplyProvidedRequiredFields(factory, { material: '면', originCountry: '국산', salePrice: '2000', widthMm: '150', depthMm: '80', size: '15x8cm', stock: '99', usage: '동전 보관', supplyPrice: '', cafe24CategoryId: '84' });
  assert.deepEqual(assigned, { material: '면', origin: '국산', sale_price: '2000', width_mm: '150mm', depth_mm: '80mm', size: '15x8cm', stock: '99', usage: '동전 보관' });
  for (const [input, expected] of [
    [{ widthMm: '150mm', depthMm: '8 cm' }, { width_mm: '150mm', depth_mm: '8 cm' }],
    [{ widthMm: '12.5', depthMm: '8.3mm', stock: '150' }, { width_mm: '12.5mm', depth_mm: '8.3mm', stock: '150' }],
    [{ widthMm: '', depthMm: '   ', size: '가로3.5cm*세로18cm', supplyPrice: '100' }, { size: '가로3.5cm*세로18cm', purchase_price: '100' }],
  ]) {
    assert.deepEqual(Object.fromEntries(context.factoryRuntimeControlProvidedFieldEntries(input)), expected);
  }
});

test('batch candidate collection forwards its explicit preserve-manual option before any lookup', async () => {
  const marker = new Error('stopped-before-lookup');
  let observed;
  const factory = { product: {} };
  const context = vm.createContext({ factoryCandidateCollectionScope: () => ({}), factoryCandidateSearchTerms: () => ['입력 제품'], factoryCaptureCandidateReviewSelection: () => ({}),
    factoryResetDbContextForNewCollection: (_factory, options) => { observed = options; throw marker; } });
  vm.runInContext(functionSource('factoryCollectProductCandidatesForReview'), context);
  await assert.rejects(context.factoryCollectProductCandidatesForReview({ factory, preserveManualFields: true }), error => error === marker);
  assert.equal(observed.preserveManualFields, true);
});
