'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');

function sourceFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  const start = functionStart >= 6 && source.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf(') {', start) + 2;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

// 늦게 채워지는 항목 목록과 대기 폭은 모듈 수준 상수라, 함수만 잘라 오면 따라오지 않는다.
// 값을 여기 베껴 두면 실제와 어긋나므로 원본에서 그대로 읽는다.
function readbackSettleGlobals() {
  const labels = CORE.match(/CAFE24_READBACK_SETTLING_LABELS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(labels, 'CAFE24_READBACK_SETTLING_LABELS 를 찾지 못했습니다');
  const attempts = CORE.match(/CAFE24_READBACK_SETTLE_ATTEMPTS = (\d+)/);
  const delay = CORE.match(/CAFE24_READBACK_SETTLE_DELAY_MS = (\d+)/);
  assert.ok(attempts && delay, '재시도 상한/간격 상수를 찾지 못했습니다');
  return {
    CAFE24_READBACK_SETTLING_LABELS: new Set([...labels[1].matchAll(/'([^']+)'/g)].map(m => m[1])),
    CAFE24_READBACK_SETTLE_ATTEMPTS: Number(attempts[1]),
    CAFE24_READBACK_SETTLE_DELAY_MS: Number(delay[1]),
  };
}

function compile(name, globals = {}) {
  const context = vm.createContext({
    Object, Date, Math, Number, String, Set,
    ...readbackSettleGlobals(),
    ...globals,
  });
  vm.runInContext(`${sourceFunction(CORE, name)}\nthis.target = ${name};`, context);
  return context.target;
}

test('Cafe24 등록 영수증은 전송 전 A값을 고정하고 이미지·옵션·재고 read-back 감소를 실패로 남긴다', () => {
  const build = compile('factoryCafe24BuildRegistrationReceiptPreflight', {
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryCafe24ImagePayload: () => ({ detail_image: 'data:image/jpeg;base64,hero' }),
    factoryBuildCafe24OptionSyncPlan: () => ({ optionName: '색상', optionValues: ['빨강', '파랑'] }),
    factoryCafe24VariantRows: () => [
      { option_value: '빨강', quantity: 88, use_inventory: 'T' },
      { option_value: '파랑', quantity: 99, use_inventory: 'T' },
    ],
    factoryCafe24VariantNormalizedOptionKey: row => row.option_value,
    factoryCafe24InventoryPayload: row => ({ quantity: row.quantity, use_inventory: row.use_inventory }),
    factoryAutomationCounts: () => ({}),
    factoryAutomationReviewSummary: () => ({
      fields: [
        { id: 'size', label: '사이즈/규격', required: true, value: '21cm x 14cm' },
        { id: 'material', label: '소재', required: true, value: '모시' },
      ],
    }),
    factoryCafe24DetailImageSrcValues: html => [...html.matchAll(/<img\b[^>]*\bsrc=/gi)].map((_, index) => `image-${index}`),
  });
  const compare = compile('factoryCafe24CompareRegistrationReadback', {
    parseCafe24Raw: detail => detail.raw,
    factoryCafe24ValuesRoughlyEqual: (left, right) => Number(left) === Number(right) || String(left) === String(right),
    factoryOpenMarketOptionSummary: (_model, raw) => ({ values: raw.optionValues, variants: raw.variants }),
    factoryCafe24VariantNormalizedOptionKey: row => row.option_value,
    factoryCafe24InventoryPayload: row => ({ quantity: row.quantity, use_inventory: row.use_inventory }),
    factoryCafe24DetailImageSrcValues: html => [...html.matchAll(/<img\b[^>]*\bsrc=/gi)].map((_, index) => `image-${index}`),
  });

  const preflight = build({ product: { finalDb: {} } }, {
    mode: 'create',
    basicInfo: { productName: '모시꽃수파우치3', salePrice: '4670', consumerPrice: '0.00', supplyPrice: '500' },
    settings: { display: 'F', selling: 'F' },
    detailHtml: '<img src="one"><img src="two">',
  });
  assert.equal(Object.isFrozen(preflight), true);
  assert.equal(Object.isFrozen(preflight.optionValues), true);
  assert.equal(preflight.representativeImageCount, 1);
  assert.equal(preflight.detailImageCount, 2);
  assert.equal(preflight.variantCount, 2);
  assert.equal(preflight.requiredValues.size, '21cm x 14cm');
  assert.equal(Object.isFrozen(preflight.inventoryByOption['빨강']), true);
  assert.equal(preflight.inventoryByOption['빨강'].quantity, '88');
  assert.equal(preflight.inventoryByOption['파랑'].quantity, '99');

  const good = compare(preflight, { raw: {
    product_no: '4001', product_name: '모시꽃수파우치3', price: '4670.00', retail_price: '0', supply_price: '500',
    display: 'F', selling: 'F', detail_image: '/hero.jpg', description: '<img src="one"><img src="two">',
    additional_information: [{ key: 'custom_option1', name: '사이즈', value: '가로 21cm x 세로 14cm' }],
    product_material: '모시',
    optionValues: ['빨강', '파랑'],
    variants: [
      { option_value: '빨강', quantity: 88, use_inventory: 'T' },
      { option_value: '파랑', quantity: 99, use_inventory: 'T' },
    ],
  } }, { ok: true, productNo: '4001' });
  assert.equal(good.allMatched, true);
  assert.equal(Object.isFrozen(good.readback.inventoryByOption['빨강']), true);
  assert.throws(() => {
    good.readback.inventoryByOption['빨강'].quantity = '0';
  }, TypeError);
  assert.equal(good.readback.inventoryByOption['빨강'].quantity, '88');

  const missingRequired = compare(preflight, { raw: {
    product_no: '4001', product_name: '모시꽃수파우치3', price: '4670.00', retail_price: '0', supply_price: '500',
    display: 'F', selling: 'F', detail_image: '/hero.jpg', description: '<img src="one"><img src="two">',
    optionValues: ['빨강', '파랑'],
    variants: [
      { option_value: '빨강', quantity: 88, use_inventory: 'T' },
      { option_value: '파랑', quantity: 99, use_inventory: 'T' },
    ],
  } }, { ok: true, productNo: '4001' });
  assert.equal(missingRequired.allMatched, false);
  assert.deepEqual([...missingRequired.mismatches], ['필수값/사이즈']);

  const bad = compare(preflight, { raw: {
    product_no: '4001', product_name: '모시꽃수파우치3', price: '4669', retail_price: '0', supply_price: '500',
    display: 'F', selling: 'F', description: '<p>text only</p>', optionValues: ['빨강'],
    variants: [{ option_value: '빨강', quantity: 0, use_inventory: 'F' }],
  } }, { ok: true, productNo: '4001' });
  assert.equal(bad.allMatched, false);
  assert.deepEqual([...bad.mismatches], ['판매가', '대표이미지', '상세이미지', '옵션값', '품목 수', '옵션별 재고', '필수값/사이즈']);
  assert.match(CORE, /await factoryCafe24FinalizeRegistrationReceipt\(/);
});

test('Cafe24 등록 영수증 read-back은 전송 직전 상품번호를 fallback으로 사용한다', async () => {
  let fetchedProductNo = '';
  const finalize = compile('factoryCafe24FinalizeRegistrationReceipt', {
    CAFE24_CONTROL_API: { defaultMallId: 'shop1' },
    factoryCafe24TargetInfo: () => ({ mallId: 'shop1' }),
    fetchCafe24ProductFullByNo: async productNo => {
      fetchedProductNo = productNo;
      return { raw: { product_no: productNo } };
    },
    factoryCafe24CompareRegistrationReadback: () => ({
      productNo: '999',
      checkedAt: 1,
      allMatched: true,
      checks: [],
      mismatches: [],
      readback: {},
    }),
  });
  const factory = { product: { finalDb: {} } };
  const preflight = Object.freeze({ productNo: '999' });

  const receipt = await finalize(factory, { preflight });

  assert.equal(fetchedProductNo, '999');
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.productNo, '999');
});

test('Cafe24 등록 영수증은 mm와 cm로 표현된 같은 사이즈를 일치로 판정한다', () => {
  const compare = compile('factoryCafe24CompareRegistrationReadback', {
    parseCafe24Raw: detail => detail.raw,
    factoryCafe24ValuesRoughlyEqual: (left, right) => Number(left) === Number(right) || String(left) === String(right),
    factoryOpenMarketOptionSummary: () => ({ values: [], variants: [] }),
    factoryCafe24AdditionalInformationPayload: value => value,
    factoryCafe24DetailImageSrcValues: () => [],
  });
  const result = compare({
    productName: '방울수저집',
    price: '2000',
    optionValues: [],
    variantCount: 0,
    inventoryByOption: {},
    requiredValues: {
      size: '가로4cm*세로20cm',
      width_mm: '40mm',
      depth_mm: '200mm',
      material: '폴리에스테르 원단',
    },
  }, { raw: {
    product_no: '3011',
    product_name: '방울수저집',
    price: '2000.00',
    additional_information: [{ key: 'custom_option1', name: '사이즈', value: '가로4cm*세로20cm' }],
    product_material: '폴리에스테르 원단',
  } }, { ok: true, productNo: '3011' });

  assert.equal(result.allMatched, true);
  assert.equal(result.mismatches.includes('필수값/사이즈'), false);
});

test('Cafe24 등록 영수증은 재고 read-back 반영 시차만 제한적으로 재조회한다', async () => {
  let fetchCount = 0;
  let delayCount = 0;
  const finalize = compile('factoryCafe24FinalizeRegistrationReceipt', {
    CAFE24_CONTROL_API: { defaultMallId: 'shop1' },
    factoryCafe24TargetInfo: () => ({ mallId: 'shop1' }),
    fetchCafe24ProductFullByNo: async productNo => ({ raw: { product_no: productNo, quantity: fetchCount++ ? 99 : 0 } }),
    factoryAttachCafe24InventoryEchoes: async detail => detail,
    factoryCafe24Delay: async () => { delayCount += 1; },
    factoryCafe24CompareRegistrationReadback: (_preflight, detail) => {
      const matched = detail.raw.quantity === 99;
      return {
        productNo: detail.raw.product_no,
        checkedAt: fetchCount,
        allMatched: matched,
        checks: [{ label: '옵션별 재고', matched }],
        mismatches: matched ? [] : ['옵션별 재고'],
        readback: { quantity: detail.raw.quantity },
      };
    },
  });
  const factory = { product: { finalDb: {} } };

  const receipt = await finalize(factory, { preflight: Object.freeze({ productNo: '3011' }) });

  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.readback.quantity, 99);
  assert.equal(fetchCount, 2);
  assert.equal(delayCount, 1);
});
