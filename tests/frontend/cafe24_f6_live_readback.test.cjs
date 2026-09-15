'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { functionSource, readSourceLf } = require('./source_slice_utils.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SYNC = readSourceLf(path.join(ROOT, 'src/cafe24-sync.js'));
const FINAL = readSourceLf(path.join(ROOT, 'src/app-core-05.js'));

function compile(source, name, globals = {}) {
  const context = vm.createContext({ Object, String, Number, ...globals });
  const code = functionSource(source, name);
  assert.ok(code, `missing real function: ${name}`);
  vm.runInContext(`${code}\nthis.target = ${name};`, context, { filename: `production-source#${name}` });
  return context.target;
}

test('optionMode=none create payload sends has_option=F without option structure or variants', () => {
  const attach = compile(SYNC, 'factoryAttachCafe24OptionsToProductPayload', {
    factoryCafe24OptionSettingsFinalDb: (_factory, finalDb) => finalDb,
    factoryBuildCafe24OptionSyncPlan: () => ({
      optionName: '색상',
      optionValues: ['자주', '빨강'],
      optionGroups: [{ name: '색상', values: ['자주', '빨강'] }],
      productOptions: [{ name: '색상', value: ['자주', '빨강'] }],
      optionSettingsTouched: false,
      optionExtrasTouched: false,
    }),
    factoryBuildCafe24OptionsUpdatePayload: () => ({}),
    factoryCafe24PayloadValue: (_field, value) => String(value || '').trim(),
    cloneData: value => structuredClone(value),
  });
  const product = {
    has_option: 'T', option_type: 'T', option_list_type: 'C', select_one_by_option: 'F',
    options: [{ name: '색상', value: ['자주', '빨강'] }], variants: [{ option_value: '자주' }],
  };

  attach(product, { automation: { optionMode: 'none' }, product: { finalDb: {} } }, {});

  assert.equal(product.has_option, 'F');
  for (const key of ['option_type', 'option_list_type', 'select_one_by_option', 'options', 'variants']) {
    assert.equal(Object.hasOwn(product, key), false, `${key} must not be sent for optionMode=none`);
  }
});

test('provided/manual option payload remains unchanged', () => {
  const attach = compile(SYNC, 'factoryAttachCafe24OptionsToProductPayload', {
    factoryCafe24OptionSettingsFinalDb: (_factory, finalDb) => finalDb,
    factoryBuildCafe24OptionSyncPlan: () => ({
      optionName: '색상', optionValues: ['자주', '빨강'], optionGroups: [],
      productOptions: [{ name: '색상', value: ['자주', '빨강'] }],
      optionSettingsTouched: false, optionExtrasTouched: false,
    }),
    factoryBuildCafe24OptionsUpdatePayload: () => ({}),
    factoryCafe24PayloadValue: (_field, value) => String(value || '').trim(),
    cloneData: value => structuredClone(value),
  });
  const product = {};

  attach(product, { automation: { optionMode: 'provided' }, product: { finalDb: {} } }, {});

  assert.equal(product.has_option, 'T');
  assert.deepEqual(product.options, [{ name: '색상', value: ['자주', '빨강'] }]);
});

test('registration readback requires every expected representative-image slot without comparing archive URLs', () => {
  const compare = compile(FINAL, 'factoryCafe24CompareRegistrationReadback', {
    parseCafe24Raw: detail => detail.raw,
    factoryOpenMarketOptionSummary: () => ({ values: [], variants: [] }),
    factoryCafe24AdditionalInformationPayload: value => value || [],
    factoryCafe24DetailImageSrcValues: () => [],
  });

  const result = compare({ productName: 'QA 파우치', price: '3900', representativeImageCount: 4, variantCount: 0 }, {
    raw: { product_no: 'fixture-only', product_name: 'QA 파우치', price: '3900', detail_image: 'https://remote/hero.jpg' },
  });

  assert.equal(result.allMatched, false);
  assert.ok(result.mismatches.includes('대표이미지'));
});

test('create path makes category a required post-sync key and category mismatch cannot be reported as success', () => {
  const create = functionSource(SYNC, 'factoryCreateCafe24ProductFromFinalDb');
  const category = functionSource(SYNC, 'factorySyncCafe24CategoryLink');
  assert.ok(create && category, 'missing create/category source');
  assert.match(create, /requiredKeys:\s*\['images', 'additionalImages', 'category', 'options'\]/);
  assert.match(category, /if \(!verification\.matched\) return false;/);
});
