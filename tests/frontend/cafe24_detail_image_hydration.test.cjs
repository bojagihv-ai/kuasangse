'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SYNC_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
const PRODUCT_FORM_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-product-form.js'), 'utf8');
const FACTORY_CORE_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} not found`);
  const signatureStart = source.indexOf('(', start);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') signatureDepth += 1;
    if (char === ')') signatureDepth -= 1;
    if (signatureDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} body start not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

function compileFunction(source, name, globals = {}) {
  const context = vm.createContext({ Promise, TypeError, encodeURIComponent, ...globals });
  vm.runInContext(`${extractFunction(source, name)}\nthis.target = ${name};`, context);
  return context.target;
}

test('읽기 전용 복원 상태에서도 Cafe24 추가 이미지 payload는 빈 배열로 계산한다', () => {
  const context = vm.createContext({});
  const snippets = [
    'factoryCafe24AdditionalImageDrafts',
    'factoryCafe24AdditionalImagesPayload',
  ].map(name => extractFunction(PRODUCT_FORM_SOURCE, name));
  vm.runInContext(`${snippets.join('\n')}\nthis.payload = factoryCafe24AdditionalImagesPayload;`, context);
  const factory = Object.freeze({
    product: Object.freeze({ cafe24ImageDraft: Object.freeze({}) }),
  });

  assert.deepEqual(Array.from(context.payload(factory)), []);
});

test('선택 대표이미지가 로컬 보관 URL이면 상세 헤더 fallback보다 먼저 원본을 복원한다', async () => {
  const selected = {
    id: 'hero-selected',
    stageId: 'hero',
    used: true,
    rejected: false,
    image: '/api/local-archive/assets/hero-archive/image',
    metadata: { localArchiveId: 'hero-archive' },
  };
  const factory = {
    product: {},
    assets: [selected],
    stages: { hero: { selectedAssetIds: [selected.id], status: 'done' } },
  };
  let loadCount = 0;
  const hydrate = compileFunction(FACTORY_CORE_SOURCE, 'factoryHydrateCafe24ImagesFromLocalArchive', {
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryCafe24InlineImageFromCandidate: asset => /^data:image\//i.test(String(asset?.image || ''))
      ? { base64: String(asset.image).split(',')[1] || '' }
      : null,
    factoryCafe24ImagePayload: () => ({ detail_image: 'data:image/png;base64,SECTION_HEADER_FALLBACK' }),
    factoryLoadLocalArchiveAsset: async (_archiveId, options) => {
      loadCount += 1;
      options.factory.assets[0].image = 'data:image/png;base64,SELECTED_HERO';
      return true;
    },
    uniqueApiKeys: values => [...new Set(values)],
  });

  const result = await hydrate({ factory, stages: ['hero'], render: false });

  assert.equal(loadCount, 1, 'fallback 이미지가 있어도 명시적으로 선택한 대표이미지 원본을 복원해야 한다');
  assert.equal(result.hydrated, 1);
  assert.equal(factory.assets[0].image, 'data:image/png;base64,SELECTED_HERO');
});

test('Cafe24 상세 이미지 원본 endpoint가 404여도 보관 메타데이터 imageDataUrl로 전송 HTML을 복원한다', async () => {
  const calls = [];
  const fallbackDataUrl = 'data:image/jpeg;base64,ZmFrZS1pbWFnZQ==';
  const context = vm.createContext({
    state: { backendBaseUrl: 'http://127.0.0.1:5050' },
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    fetch: async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/local-archive/assets/archive-missing/image')) {
        return { ok: false, status: 404 };
      }
      if (url.endsWith('/api/local-archive/assets/archive-missing')) {
        return { ok: true, status: 200, json: async () => ({ imageDataUrl: fallbackDataUrl }) };
      }
      return { ok: false, status: 500 };
    },
  });
  const snippets = [
    'factoryCafe24DetailImageSrcValues',
    'factoryCafe24IsLocalDetailImageUrl',
    'factoryCafe24IsTransferDetailImageUrl',
    'factoryCafe24ResolveLocalDetailImageUrl',
    'factoryCafe24HydrateLocalDetailImages',
  ].map(name => extractFunction(SYNC_SOURCE, name));
  vm.runInContext(`${snippets.join('\n')}\nthis.hydrate = factoryCafe24HydrateLocalDetailImages;`, context);

  const result = await context.hydrate(
    '<p>before</p><img src="http://127.0.0.1:5050/api/local-archive/assets/archive-missing/image">',
  );

  assert.equal(result.replaced, 1);
  assert.match(result.html, /data:image\/jpeg;base64,ZmFrZS1pbWFnZQ==/);
  assert.deepEqual(calls, [
    'http://127.0.0.1:5050/api/local-archive/assets/archive-missing/image',
    'http://127.0.0.1:5050/api/local-archive/assets/archive-missing',
  ]);
});

test('대표이미지 후속 동기화는 응답에 요청 슬롯이 하나라도 없으면 등록 성공으로 끝내지 않는다', async () => {
  const slots = [
    { key: 'detail_image', label: '상세 이미지' },
    { key: 'list_image', label: '목록 이미지' },
  ];
  const factory = { product: { cafe24Candidates: [], candidateAutoApply: false } };
  const syncImages = compileFunction(SYNC_SOURCE, 'factorySyncCafe24ProductImages', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    FACTORY_CAFE24_IMAGE_SLOTS: slots,
    factoryCafe24TargetCandidate: () => null,
    parseCafe24Raw: detail => detail?.product || detail || {},
    factoryCafe24ImagePayload: () => ({
      image_upload_type: 'A',
      detail_image: 'data:image/png;base64,detail',
      list_image: 'data:image/png;base64,list',
    }),
    callCafe24Console: async () => ({ mode: 'direct', response: { ok: true } }),
    factoryCafe24ControlPlanFromBody: () => null,
    factoryExecuteCafe24ControlBody: async body => ({ body, job: null }),
    fetchCafe24ProductFullByNo: async () => ({
      product: { product_no: '3001', detail_image: 'https://cdn.example/detail.jpg', list_image: '' },
    }),
    factoryMergeCafe24Candidates: (existing, incoming) => [...(existing || []), ...incoming],
    normalizeCafe24ProductCandidate: value => value,
    factoryVerifyCafe24ImageEcho: (payload, raw) => {
      const checked = slots.filter(slot => payload[slot.key]).map(slot => slot.key);
      const present = checked.filter(key => String(raw?.[key] || '').trim());
      return { checked: checked.length, present: present.length, missing: checked.filter(key => !present.includes(key)) };
    },
    factoryCafe24Delay: async () => {},
    factoryCafe24FieldLabelByApiField: value => value,
    factoryRememberCafe24SyncResult() {},
    factoryLog() {},
  });

  const result = await syncImages({ factory, productNo: '3001', skipConfirm: true });

  assert.equal(result, false, 'a missing requested image slot must fail the required post-create step');
});

test('대표이미지 후속 동기화는 Cafe24 반영 지연 뒤 이미지 경로가 나타나면 성공한다', async () => {
  const slots = [
    { key: 'detail_image', label: '상세 이미지' },
    { key: 'list_image', label: '목록 이미지' },
  ];
  const factory = { product: { cafe24Candidates: [], candidateAutoApply: false } };
  let reads = 0;
  const syncImages = compileFunction(SYNC_SOURCE, 'factorySyncCafe24ProductImages', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    FACTORY_CAFE24_IMAGE_SLOTS: slots,
    factoryCafe24TargetCandidate: () => null,
    parseCafe24Raw: detail => detail?.product || detail || {},
    factoryCafe24ImagePayload: () => ({
      image_upload_type: 'A',
      detail_image: 'data:image/png;base64,detail',
      list_image: 'data:image/png;base64,list',
    }),
    callCafe24Console: async () => ({ mode: 'direct', response: { ok: true } }),
    factoryCafe24ControlPlanFromBody: () => null,
    factoryExecuteCafe24ControlBody: async body => ({ body, job: null }),
    fetchCafe24ProductFullByNo: async () => {
      reads += 1;
      return reads === 1
        ? { product: { product_no: '3005', detail_image: '', list_image: '' } }
        : { product: { product_no: '3005', detail_image: 'https://cdn.example/detail.jpg', list_image: 'https://cdn.example/list.jpg' } };
    },
    factoryMergeCafe24Candidates: (existing, incoming) => [...(existing || []), ...incoming],
    normalizeCafe24ProductCandidate: value => value,
    factoryVerifyCafe24ImageEcho: (payload, raw) => {
      const checked = slots.filter(slot => payload[slot.key]).map(slot => slot.key);
      const present = checked.filter(key => String(raw?.[key] || '').trim());
      return { checked: checked.length, present: present.length, missing: checked.filter(key => !present.includes(key)) };
    },
    factoryCafe24Delay: async () => {},
    factoryCafe24FieldLabelByApiField: value => value,
    factoryRememberCafe24SyncResult() {},
    factoryLog() {},
  });

  const result = await syncImages({ factory, productNo: '3005', skipConfirm: true });

  assert.notEqual(result, false);
  assert.equal(reads, 2);
});

test('신규 상품 후속 옵션 동기화는 새 품목코드에도 기존 옵션별 재고를 강제로 전달한다', () => {
  const values = Array.from({ length: 15 }, (_, index) => `${index + 1}.색상`);
  const rows = values.map((value, index) => ({
    key: `created_${index + 1}`,
    variant_code: `P0000ELL00${String.fromCharCode(65 + index)}`,
    option_value: value,
    option_pairs: [{ name: '색상', value }],
    quantity: '0',
    safety_inventory: '0',
    use_inventory: '재고관리 사용(T)',
    important_inventory: 'A',
    inventory_control_type: 'B',
    display_soldout: '품절 표시 안 함(F)',
  }));
  const factory = { product: { candidateAutoApply: false, cafe24Candidates: [] } };
  const buildPlan = compileFunction(SYNC_SOURCE, 'factoryBuildCafe24OptionSyncPlan', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    factoryCafe24TargetCandidate: () => ({ product_no: '3001' }),
    parseCafe24Raw: () => ({}),
    factoryCafe24OptionSettingsFinalDb: (_factory, finalDb) => finalDb,
    factoryDedupeRealOptionValues: input => [...new Set(input.map(String))],
    factoryCafe24CleanOptionGroupsForPayload: groups => groups,
    factoryBuildCafe24ProductOptionsPayload: () => ({ has_option: 'T' }),
    factoryCafe24OptionSettingsTouched: () => false,
    factoryCafe24OptionStructureTouched: () => false,
    factoryCafe24OptionExtrasModel: () => ({ useAdditionalOption: 'F', additionalOptions: [] }),
    factoryCafe24OptionExtrasTouched: () => false,
    factoryCafe24VariantEditsForCurrent: () => ({}),
    factoryCafe24ExistingOptionRoot: () => ({ options: [], has_option: 'T' }),
    factoryCafe24PayloadValue: (_key, value) => value,
    factoryCafe24OptionSetting: (_raw, _finalDb, _key, fallback) => fallback,
    factoryCafe24SourceVariantInventoryMap: () => new Map(),
    factoryCafe24SourceInventoryForRow: () => ({
      quantity: '99',
      safety_inventory: '0',
      use_inventory: 'T',
      important_inventory: 'A',
      inventory_control_type: 'B',
      display_soldout: 'F',
    }),
    factoryCafe24AutoInventoryPayload: (_row, seed) => ({
      quantity: seed.quantity,
      safety_inventory: seed.safety_inventory,
      use_inventory: seed.use_inventory,
      important_inventory: seed.important_inventory,
      inventory_control_type: seed.inventory_control_type,
      display_soldout: seed.display_soldout,
    }),
    cloneData: value => JSON.parse(JSON.stringify(value)),
  });
  const optionModel = {
    optionName: '색상',
    optionValues: values,
    editGroups: [{ name: '색상', values }],
    variants: rows,
  };

  const withoutForce = buildPlan(factory, {}, optionModel);
  assert.equal(withoutForce.inventoryUpdates.length, 0);
  assert.equal(withoutForce.hasChanges, false);

  const forced = buildPlan(factory, {}, optionModel, { forceInventory: true });
  assert.equal(forced.inventoryUpdates.length, 15);
  assert.equal(forced.hasChanges, true);
  assert.equal(forced.inventoryUpdates.every(item => item.body.quantity === '99'), true);
});

test('신규 상품의 이전 품목 재고 seed가 없어도 화면의 전체 재고 99를 새 품목에 사용한다', () => {
  const values = ['1.빨강', '2.연핑'];
  const rows = values.map((value, index) => ({
    key: `created_${index + 1}`,
    variant_code: `P0000ELM00${String.fromCharCode(65 + index)}`,
    option_value: value,
    option_pairs: [{ name: '색상', value }],
    quantity: '0',
  }));
  const buildPlan = compileFunction(SYNC_SOURCE, 'factoryBuildCafe24OptionSyncPlan', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    factoryCafe24TargetCandidate: () => ({ product_no: '3002' }),
    parseCafe24Raw: () => ({}),
    factoryCafe24OptionSettingsFinalDb: (_factory, finalDb) => finalDb,
    factoryDedupeRealOptionValues: input => [...new Set(input.map(String))],
    factoryCafe24CleanOptionGroupsForPayload: groups => groups,
    factoryBuildCafe24ProductOptionsPayload: () => [],
    factoryCafe24OptionSettingsTouched: () => false,
    factoryCafe24OptionStructureTouched: () => false,
    factoryCafe24OptionExtrasModel: () => ({ useAdditionalOption: 'F', additionalOptions: [] }),
    factoryCafe24OptionExtrasTouched: () => false,
    factoryCafe24VariantEditsForCurrent: () => ({}),
    factoryCafe24ExistingOptionRoot: () => ({ options: [], has_option: 'T' }),
    factoryCafe24PayloadValue: (_key, value) => String(value),
    factoryCafe24OptionSetting: (_raw, _finalDb, _key, fallback) => fallback,
    factoryCafe24SourceVariantInventoryMap: () => new Map(),
    factoryCafe24SourceInventoryForRow: () => null,
    factoryCafe24AutoInventoryPayload: row => ({ quantity: row.quantity }),
    cloneData: value => JSON.parse(JSON.stringify(value)),
  });
  const optionModel = {
    optionName: '색상',
    optionValues: values,
    editGroups: [{ name: '색상', values }],
    variants: rows,
  };

  const forced = buildPlan({ product: { candidateAutoApply: false } }, {}, optionModel, {
    forceInventory: true,
    forceInventoryQuantity: '99',
  });

  assert.deepEqual(Array.from(forced.inventoryUpdates, item => item.body.quantity), ['99', '99']);
});

test('생산관제 옵션 초안은 기존 1개 품목 대신 입력한 9개 예상 품목을 사전점검에 표시한다', () => {
  const values = ['초록', '꽃핑', '연핑', '연두', '산호', '민트', '노랑', '보라', '빨강'];
  const variantRows = compileFunction(PRODUCT_FORM_SOURCE, 'factoryCafe24VariantRows', {
    factoryRuntimeReadFactory: () => ({}),
    factoryCafe24TargetCandidate: () => ({
      product_no: '2994',
      variants: [{ variant_code: 'OLD0001', option_value: '1홍색', quantity: '99' }],
    }),
    parseCafe24Raw: target => target,
    factoryCafe24DraftMatchesCurrentProduct: () => true,
    factoryCafe24OptionGroupsDraft: () => [{ name: '색상', values }],
    factoryCafe24VariantKey: (_variant, index) => `old_${index + 1}`,
    factoryCafe24VariantOptionPairs: variant => [{ name: '색상', value: variant.option_value }],
    factoryCafe24VariantOptionValue: variant => variant.option_value,
    factoryCafe24FlagText: value => String(value),
    factoryCafe24SourceVariantInventoryMap: () => new Map(),
    factoryCafe24SourceInventoryForRow: () => null,
    factoryDbNormalizeKey: value => String(value || '').trim().toLowerCase(),
  });

  const rows = variantRows({
    product: {
      cafe24OptionGroupsDraft: [{ name: '색상', values }],
      cafe24VariantEdits: {},
    },
  }, values);

  assert.equal(rows.length, 9);
  assert.deepEqual(Array.from(rows, row => row.option_value), values);
  assert.equal(rows.every(row => row.variant_code === ''), true);
});

test('기존 1개 옵션을 9개로 교체하면 새 품목코드를 재조회해 전부 재고 99로 저장한다', async () => {
  const values = ['초록', '꽃핑', '연핑', '연두', '산호', '민트', '노랑', '보라', '빨강'];
  const refreshedRows = values.map((value, index) => ({
    key: `created_${index + 1}`,
    variant_code: `P0000ELE00${String.fromCharCode(65 + index)}`,
    option_value: value,
    option_pairs: [{ name: '색상', value }],
    quantity: '0',
    use_inventory: 'T',
  }));
  const plan = {
    productNo: '2994',
    mallId: 'bojagi1928',
    optionUpdate: { method: 'PUT', path: '/options', body: { option: { options: [{ name: '색상', value: values }] } } },
    optionGroupCount: 1,
    optionValueTotal: values.length,
    optionName: '색상',
    optionValues: values,
    optionGroups: [{ name: '색상', values }],
    optionExtras: { additionalOptions: [] },
    variantUpdates: [],
    inventoryUpdates: [{ variantCode: 'OLD0001', path: '/old/inventories', body: { quantity: '99' } }],
    warnings: [],
  };
  const inventoryWrites = [];
  const verificationPlans = [];
  const factory = { product: { cafe24Candidates: [] } };
  const syncOptions = compileFunction(SYNC_SOURCE, 'factorySyncCafe24OptionsAndVariants', {
    factoryUpdateFinalDbFromFields: () => ({ finalDb: {} }),
    factoryBuildCafe24OptionSyncPlan: () => plan,
    factoryLog() {},
    callCafe24Console: async (method, requestPath, options) => {
      if (requestPath.includes('/inventories')) inventoryWrites.push({ method, requestPath, body: options.body });
      return {};
    },
    factoryCafe24ControlPlanFromBody: () => null,
    factoryExecuteCafe24ControlBody: async () => ({}),
    factoryWaitForCafe24OptionEcho: async (_productNo, _mallId, verificationPlan) => {
      verificationPlans.push(verificationPlan);
      return {
        detail: { product_no: '2994', variants: refreshedRows },
        verification: {
          matched: true,
          message: '옵션 9개 · 재고검증 완료',
          actualGroupCount: 1,
          expectedGroupCount: 1,
          actualCount: 9,
          expectedCount: 9,
          variantCount: 9,
        },
        attempts: 1,
      };
    },
    factoryCafe24VariantRows: () => refreshedRows,
    factoryCafe24AutoInventoryPayload: row => ({ use_inventory: row.use_inventory, quantity: row.quantity }),
    factoryCafe24PayloadValue: (_field, value) => String(value),
    normalizeCafe24ProductCandidate: value => value,
    factoryMergeCafe24Candidates: (current, incoming) => [...(current || []), ...incoming],
    factoryVerifyCafe24OptionEcho: () => ({ matched: true }),
    factoryRememberCafe24SyncResult() {},
  });

  const result = await syncOptions({
    factory,
    skipConfirm: true,
    forceInventory: true,
    forceInventoryQuantity: '99',
  });

  assert.equal(result, true);
  assert.equal(inventoryWrites.length, 9);
  assert.deepEqual(inventoryWrites.map(item => item.body.quantity), Array(9).fill('99'));
  assert.equal(verificationPlans[0].inventoryUpdates.length, 0, 'structure echo must not wait for inventory before new codes exist');
  assert.equal(verificationPlans.at(-1).inventoryUpdates.length, 9);
});

test('옵션 재조회에서 재고가 다르면 신규 등록 후속 단계를 성공으로 보고하지 않는다', async () => {
  const factory = { product: { cafe24Candidates: [] } };
  const syncOptions = compileFunction(SYNC_SOURCE, 'factorySyncCafe24OptionsAndVariants', {
    factoryUpdateFinalDbFromFields: () => ({ finalDb: {} }),
    factoryBuildCafe24OptionSyncPlan: () => ({
      productNo: '3002',
      mallId: 'bojagi1928',
      optionUpdate: null,
      optionGroupCount: 1,
      optionValueTotal: 15,
      optionExtras: { additionalOptions: [] },
      variantUpdates: [],
      inventoryUpdates: [{ variantCode: 'P0000ELM000A', path: '/inventories', body: { quantity: '99' } }],
      warnings: [],
    }),
    factoryLog() {},
    callCafe24Console: async () => ({}),
    factoryCafe24ControlPlanFromBody: () => null,
    factoryExecuteCafe24ControlBody: async () => ({}),
    factoryWaitForCafe24OptionEcho: async () => ({
      detail: { product_no: '3002' },
      verification: {
        matched: false,
        message: '재고검증 0/1건',
        actualGroupCount: 1,
        expectedGroupCount: 1,
        actualCount: 15,
        expectedCount: 15,
        variantCount: 15,
      },
      attempts: 1,
    }),
    factoryMergeCafe24Candidates: value => value || [],
    normalizeCafe24ProductCandidate: () => ({}),
    factoryVerifyCafe24OptionEcho: () => ({ matched: false }),
    factoryRememberCafe24SyncResult() {},
  });

  const result = await syncOptions({ factory, skipConfirm: true, forceInventory: true, forceInventoryQuantity: '99' });

  assert.equal(result, false, 'inventory mismatch must fail the required options post-create step');
});

test('신규 등록 후 대표이미지가 실패해도 옵션 재고 99 후속 전송까지 시도하고 전체 결과는 실패로 남긴다', async () => {
  const calls = [];
  const factory = { product: { cafe24Candidates: [] } };
  const runPostCreate = compileFunction(SYNC_SOURCE, 'factoryRunCafe24PostCreateSync', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    factoryCafe24TargetInfo: () => ({ productNo: '3003', mallId: 'bojagi1928' }),
    factoryLog() {},
    factorySyncCafe24ProductImages: async options => {
      calls.push({ key: 'images', quantity: options.forceInventoryQuantity });
      return false;
    },
    factorySyncCafe24OptionsAndVariants: async options => {
      calls.push({ key: 'options', quantity: options.forceInventoryQuantity });
      return true;
    },
    factoryRememberCafe24SyncResult() {},
  });

  const result = await runPostCreate([
    { key: 'images', label: '상품 이미지', ready: true },
    { key: 'options', label: '옵션/품목/재고', ready: true },
  ], {
    productNo: '3003',
    mallId: 'bojagi1928',
    forceInventory: true,
    forceInventoryQuantity: '99',
    requiredKeys: ['images', 'options'],
    factory,
    render: false,
  });

  assert.deepEqual(calls, [
    { key: 'images', quantity: '99' },
    { key: 'options', quantity: '99' },
  ], 'one failed post-create surface must not prevent the independent inventory repair');
  assert.equal(result, false, 'a required image failure must still keep the overall registration result failed');
});
