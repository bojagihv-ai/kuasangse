'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const sources = ['cafe24-options.js', 'cafe24-sync.js', 'cafe24-payloads.js', 'app-core-03.js', 'cafe24-product-form.js', 'app-core-05.js']
  .map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
function load(context, name) {
  const source = sources.find(text => new RegExp(`^(?:async )?function ${name}\\(`, 'm').test(text));
  if (!source) return;
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
function harness() {
  const raw = { product_no: '3027', mall_id: 'shop', detail_image: 'https://shop.example/web/product/main.jpg',
    has_option: 'T', options: [{ option_name: '색상', required_option: 'T', option_display_type: 'S',
      option_value: ['색동 1', '색동 2'].map((option_text, index) => ({ option_text, value_no: index + 1,
        option_color: '#ffffff', option_image_file: 'https://shop.example/web/button.gif', option_link_image: '' })) }],
    variants: [{ variant_code: 'V1' }, { variant_code: 'V2' }] };
  const factory = { workspace: { id: 'work' }, stages: { options: { selectedAssetIds: ['selected'] } },
    assets: [{ id: 'selected', stageId: 'options', sourceMap: { optionResultId: 'chosen' } }],
    product: { selectedCafe24CandidateKey: '3027', cafe24Candidates: [raw], cafe24ImageDraft: {}, finalDb: {} } };
  const sorter = { optionResults: ['old', 'chosen', 'new'].map(id => ({ id,
    splitImages: ['색동 1', '색동 2'].map((optionName, index) => ({ optionName,
      image: `data:image/png;base64,${Buffer.from(id + index).toString('base64')}` })) })) };
  const calls = [], logs = [];
  let planSerial = 0;
  let tokenCurrent = true;
  const context = vm.createContext({ URL, console, state: { optionSorter: sorter },
    CAFE24_CONTROL_API: { defaultMallId: 'shop' },
    cloneData: plain, factoryDbNormalizeKey: value => String(value).replace(/\s+/g, '').toLowerCase(),
    factoryCleanRealOptionValue: value => String(value || '').trim(),
    factoryDedupeRealOptionValues: values => [...new Set(values)],
    factoryRuntimeReadFactory: () => factory,
    factoryCafe24TargetCandidate: current => current.product.cafe24Candidates[0],
    parseCafe24Raw: value => value || {},
    factoryCafe24OptionSettingsFinalDb: (_factory, db) => db,
    factoryCafe24OptionEditorModel: () => ({ optionName: '색상', optionValues: ['색동 1', '색동 2'],
      editGroups: [{ name: '색상', values: ['색동 1', '색동 2'] }],
      variants: [{ key: 'V1', variant_code: 'V1' }, { key: 'V2', variant_code: 'V2' }] }),
    factoryCafe24CleanOptionGroupsForPayload: groups => groups,
    factoryBuildCafe24ProductOptionsPayload: () => [],
    factoryCafe24OptionSettingsTouched: () => false, factoryCafe24OptionStructureTouched: () => false,
    factoryCafe24OptionExtrasTouched: () => false,
    factoryCafe24OptionExtrasModel: () => ({ useAdditionalOption: 'F', additionalOptions: [] }),
    factoryCafe24OptionExtrasPayload: () => ({}), factoryCafe24VariantEditsForCurrent: () => ({}),
    factoryCafe24SourceVariantInventoryMap: () => new Map(), factoryCafe24SourceInventoryForRow: () => ({}),
    factoryCafe24AutoInventoryPayload: () => ({ quantity: '99' }), factoryCafe24PayloadValue: (_key, value) => value,
    factoryUpdateFinalDbFromFields: () => ({ finalDb: {} }), factoryLog: message => logs.push(message),
    factoryRememberCafe24SyncResult: (_factory, _key, result) => logs.push(result),
    factoryCafe24ImageDraft: current => current.product.cafe24ImageDraft,
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => 'operation' }),
    factoryRuntimeIsOperationCurrent: () => tokenCurrent,
    factoryRuntimeStaleActionError: () => new Error('STALE_FACTORY_RUNTIME_ACTION'),
    factoryCafe24ApprovedImageDataUrl: async image => image,
    callCafe24Console: async (method, url, options) => {
      calls.push({ method, url, options: plain(options) });
      const planId = `p${++planSerial}`;
      calls.at(-1).planId = planId;
      return { mode: 'plan', plan: { id: planId, mall_id: 'shop', operations: [{
        type: 'cafe24_api', method, path: url,
        after: { method, path: url, payload: plain(options.body) },
      }] } };
    },
    approveCafe24ControlPlan: async plan => ({ jobRunId: `j${plan.id}` }),
    waitCafe24ControlJob: async jobRunId => ({ status: 'succeeded', change_plan_id: jobRunId.slice(1),
      started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:00:01.000Z' }),
    invokeApiHubConnector: async (_connectorId, _endpointId, payload) => {
      const target = payload.query.q;
      const rows = calls.filter(call => `${call.method} ${call.url}` === target).map((call, index) => ({
        mall_id: 'shop', action: 'cafe24_api:succeeded', target_id: target,
        created_at: '2026-01-01T00:00:00.500Z',
        after: { requested: { method: call.method, path: call.url, payload: plain(call.options.body) },
          cafe24: { additionalimage: { additional_image: [{ big: `http://shop.cafe24.com/web/product/split${index + 1}.png` }] } } },
      }));
      return { data: rows };
    },
    factoryCafe24ImageDisplayUrl: value => value.startsWith('/') ? `https://shop.cafe24.com${value}` : value,
    fetchCafe24ProductFullByNo: async () => {
      const saved = calls.findLast(call => call.method === 'PUT');
      return { ...plain(raw), options: saved ? plain(saved.options.body.options).map(group => ({ ...group,
        option_value: group.option_value.map(value => ({ ...value,
          option_link_image: value.option_link_image
            ? (/^https?:\/\//i.test(value.option_link_image) ? value.option_link_image : `https://shop.cafe24.com${value.option_link_image}`)
            : '' })) })) : raw.options };
    },
    factoryAttachCafe24InventoryEchoes: async detail => detail,
    factoryVerifyCafe24OptionEcho: () => ({ matched: true, message: 'structure', actualGroupCount: 1, expectedGroupCount: 1 }),
    factoryCafe24Delay: async () => {}, factoryMergeCafe24Candidates: (_old, next) => next,
    normalizeCafe24ProductCandidate: value => value,
  });
  [
    'factoryCafe24ExistingOptionRoot', 'factoryCafe24ExistingOptionGroup', 'factoryCafe24ExistingOptionText',
    'factoryCafe24OptionsPayloadValueItems', 'factoryCafe24OriginalOptionsPayload', 'factoryCafe24OptionSetting',
    'factoryBuildCafe24OptionsUpdatePayload', 'factoryProjectFileImageFingerprint',
    'factoryCafe24SelectedOptionImages', 'factoryCafe24OptionImageUrl', 'factoryCafe24OptionImagePlan',
    'factoryCafe24ApplyOptionImageLinks', 'factoryCafe24VerifyOptionImageEcho',
    'factoryCafe24OptionImageGuard', 'factoryPrepareCafe24OptionImageLinks',
    'factoryBuildCafe24OptionSyncPlan', 'factoryCafe24CaptureOperationToken',
    'factoryCafe24ControlPlanFromBody', 'factoryCafe24ControlJobIdFromApproval', 'factoryExecuteCafe24ControlBody',
    'factoryCafe24DescriptionImageUrlsFromBody', 'factoryCafe24DetailBase64FromDataUrl',
    'factoryCafe24AdditionalImageResponseRaw', 'factoryCafe24AdditionalImageUrlsFromRaw', 'factoryCafe24ReadApprovedAdditionalImageResponse',
    'factoryUploadCafe24Image', 'factoryUploadCafe24OptionImage', 'factorySyncCafe24OptionsAndVariants', 'factoryWaitForCafe24OptionEcho',
  ].forEach(name => load(context, name));
  return { context, factory, sorter, raw, calls, logs, stale: () => { tokenCurrent = false; } };
}
test('이미지 연결만 누락된 기존 상품은 PUT 대상이며 재고와 품목은 쓰지 않는다', () => {
  const h = harness(), before = plain(h.factory);
  const plan = h.context.factoryBuildCafe24OptionSyncPlan(h.factory);
  assert.equal(plan.optionUpdate?.method, 'PUT');
  assert.equal(plan.optionImages.length, 2);
  assert.deepEqual(plain(plan.inventoryUpdates), []);
  assert.deepEqual(plain(plan.variantUpdates), []);
  assert.deepEqual(h.factory, before);
});
test('같은 이름의 다른 결과를 제외하고 선택 split 2개를 승인 업로드한 뒤 echo를 확인한다', async () => {
  const h = harness(), before = JSON.stringify(h.sorter);
  assert.equal(await h.context.factorySyncCafe24OptionsAndVariants({ factory: h.factory, skipConfirm: true }), true);
  assert.deepEqual(h.calls.map(call => call.method), ['POST', 'POST', 'PUT']);
  assert.deepEqual(h.calls.slice(0, 2).map(call => call.url),
    ['/api/v2/admin/products/3027/additionalimages', '/api/v2/admin/products/3027/additionalimages']);
  assert.deepEqual(h.calls.slice(0, 2).map(call => call.options.body.additional_image[0]),
    h.sorter.optionResults[1].splitImages.map(split => split.image.split(',')[1]));
  const values = h.calls[2].options.body.options[0].option_value;
  assert.deepEqual(values.map(value => value.option_link_image), ['/web/product/split1.png', '/web/product/split2.png']);
  assert.deepEqual(values.map(value => value.value_no), [1, 2]);
  assert.ok(values.every(value => value.option_image_file === h.raw.options[0].option_value[0].option_image_file));
  assert.equal(JSON.stringify(h.sorter), before);
});
test('옵션 asset 미선택은 일반 옵션 또는 신상품 계획의 새 오류가 아니다', () => {
  const h = harness(); h.factory.stages.options.selectedAssetIds = [];
  assert.doesNotThrow(() => h.context.factoryBuildCafe24OptionSyncPlan(h.factory));
  assert.equal(h.context.factoryBuildCafe24OptionSyncPlan(h.factory).hasChanges, false);
});
for (const kind of ['ambiguous', 'duplicate', 'missing']) test(`${kind} 선택은 업로드 전에 중단한다`, async () => {
  const h = harness();
  if (kind === 'ambiguous') h.factory.stages.options.selectedAssetIds.push('another');
  if (kind === 'duplicate') h.sorter.optionResults[1].splitImages[1].optionName = '색동 1';
  if (kind === 'missing') h.sorter.optionResults[1].splitImages[1].image = '';
  try { await h.context.factorySyncCafe24OptionsAndVariants({ factory: h.factory, skipConfirm: true }); } catch (_) {}
  assert.equal(h.calls.length, 0);
});
test('옵션 이름 echo가 통과해도 link 빈 값과 뒤바뀐 link는 실패한다', async () => {
  const h = harness();
  const plan = h.context.factoryBuildCafe24OptionSyncPlan(h.factory);
  await h.context.factoryPrepareCafe24OptionImageLinks(plan, h.factory, () => {});
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, h.raw).matched, false);
  const detail = { ...h.raw, options: plain(plan.optionUpdate.body.options) };
  detail.options[0].option_value.forEach(value => {
    if (!/^https?:\/\//i.test(value.option_link_image)) value.option_link_image = `https://shop.cafe24.com${value.option_link_image}`;
  });
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, detail).matched, true);
  detail.options[0].option_value.reverse();
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, detail).matched, false, '원래 옵션 순서도 보존해야 한다');
  detail.options[0].option_value.reverse();
  const [a, b] = detail.options[0].option_value;
  [a.option_link_image, b.option_link_image] = [b.option_link_image, a.option_link_image];
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, detail).matched, false);
});
test('승인 응답 경로는 확정 몰 host만 허용한다', () => {
  const h = harness();
  const plan = h.context.factoryBuildCafe24OptionSyncPlan(h.factory);
  assert.equal(h.context.factoryCafe24OptionImageUrl('https://shop.example/web/product/a.png', plan).path, '/web/product/a.png');
  for (const value of ['https://evil.example/web/a.png', '//evil.example/web/a.png', 'https://shop.example/web/../a.png',
    'https://shop.example/web/%2e%2e/a.png', 'data:image/png;base64,AAAA']) {
    assert.throws(() => h.context.factoryCafe24OptionImageUrl(value, plan));
  }
});
for (const change of ['token', 'selection', 'bytes']) test(`업로드 준비 await 중 ${change} 변경은 외부 쓰기 0`, async () => {
  const h = harness();
  h.context.factoryCafe24ApprovedImageDataUrl = async image => {
    if (change === 'token') h.stale();
    if (change === 'selection') h.factory.stages.options.selectedAssetIds = [];
    if (change === 'bytes') h.sorter.optionResults[1].splitImages[0].image += 'AA';
    return image;
  };
  assert.equal(await h.context.factorySyncCafe24OptionsAndVariants({ factory: h.factory, skipConfirm: true }), false);
  assert.equal(h.calls.length, 0);
});
test('두 번째 업로드 실패 후 첫 mapping을 재사용하고 원본을 보존한다', async () => {
  const h = harness(), original = h.context.callCafe24Console;
  h.context.callCafe24Console = async (...args) => {
    if (h.calls.length === 1) throw new Error('second upload failed');
    return original(...args);
  };
  assert.equal(await h.context.factorySyncCafe24OptionsAndVariants({ factory: h.factory, skipConfirm: true }), false);
  h.factory.product.cafe24ImageDraft = plain(h.factory.product.cafe24ImageDraft);
  assert.ok(!JSON.stringify(h.factory.product.cafe24ImageDraft).includes('data:image'), 'mapping은 이미지 원본을 중복 저장하지 않는다');
  h.context.callCafe24Console = original;
  assert.equal(await h.context.factorySyncCafe24OptionsAndVariants({ factory: h.factory, skipConfirm: true }), true);
  assert.deepEqual(h.calls.map(call => call.method), ['POST', 'POST', 'PUT']);
  const count = h.calls.length;
  assert.equal(h.context.factoryBuildCafe24OptionSyncPlan(h.factory).hasChanges, false);
  assert.equal(h.calls.length, count);
});

for (const failure of ['approval', 'unknown-host', 'empty-url', 'stale-after-upload']) test(`${failure}이면 옵션 PUT으로 진행하지 않는다`, async () => {
  const h = harness();
  if (failure === 'approval') h.context.approveCafe24ControlPlan = async () => { throw new Error('approval rejected'); };
  if (failure === 'unknown-host') h.context.factoryCafe24ReadApprovedAdditionalImageResponse = async () => ({ additionalimage: { additional_image: [{ big: 'https://evil.example/web/a.png' }] } });
  if (failure === 'empty-url') h.context.factoryCafe24ReadApprovedAdditionalImageResponse = async () => ({});
  if (failure === 'stale-after-upload') h.context.waitCafe24ControlJob = async () => { h.stale(); return { status: 'succeeded' }; };
  assert.equal(await h.context.factorySyncCafe24OptionsAndVariants({ factory: h.factory, skipConfirm: true }), false);
  assert.ok(h.calls.length <= 1);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 0);
});

test('이미지 전용 PUT은 미선택 옵션의 이미지와 기존 품목 집합을 보존한다', async () => {
  const h = harness();
  h.raw.options.push({ option_name: '크기', required_option: 'T', option_display_type: 'S',
    option_value: [{ option_text: '소', value_no: 3, option_link_image: 'https://shop.example/web/product/size.png',
      option_image_file: 'https://shop.example/web/size-button.gif' }] });
  const plan = h.context.factoryBuildCafe24OptionSyncPlan(h.factory);
  assert.equal(plan.optionUpdate.body.options[1].option_value[0].option_link_image, '/web/product/size.png');
  await h.context.factoryPrepareCafe24OptionImageLinks(plan, h.factory, () => {});
  const detail = { ...h.raw, options: plain(plan.optionUpdate.body.options), variants: plain(h.raw.variants) };
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, detail).matched, true);
  detail.variants[0].variant_code = 'RECREATED';
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, detail).matched, false);
  detail.variants = plain(h.raw.variants);
  detail.options[1].option_value[0].option_image_file = '';
  assert.equal(h.context.factoryCafe24VerifyOptionImageEcho(plan, detail).matched, false);
});

test('최종 등록 원문은 재고 강제값 없이 이미지 dirty를 실제 옵션 writer까지 전달한다', async () => {
  const h = harness(), sync = {}, noop = () => {};
  Object.assign(h.context, {
    window: {}, setTimeout: callback => callback(), FACTORY_PAGE_SESSION_ID: 'test',
    FACTORY_CAFE24_IMAGE_SLOTS: [], factoryCafe24ImagePayload: () => ({}),
    factoryCafe24AdditionalImagesPayload: () => [], factoryCafe24TargetInfo: () => ({ productNo: '3027', mallId: 'shop' }),
    factoryCafe24EndpointDisabledReason: () => '', factoryCafe24IconPayload: () => ({ image_list: [] }),
    factoryCafe24SeoChanged: () => false, factoryCafe24EnglishShopNameSyncPlan: () => ({}),
    factoryCafe24TagsPayload: () => null, factoryCafe24RelationPayload: () => ({ rows: [] }),
    factoryCafe24MemoPayload: () => null, factoryCafe24MainDraft: () => ({}),
    factoryBuildDbReviewModel: () => ({ finalDb: {} }), factorySelectedCafe24CategoryRows: () => [],
    factoryCafe24IconTouched: () => false,
    factoryEnsureOpenMarketSync: () => sync, factoryClearFinalRegistrationStaleResult: noop,
    factoryApplyFinalCafe24StatusToDb: noop,
    factoryFinalRegistrationSettings: () => ({ includeOpenMarket: false }),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: true, ok: true, generated: 1 }),
    factoryFinalRegistrationCafe24Model: () => ({ canRun: true, mode: 'update', productNo: '3027' }),
    factoryFinalRegistrationBasicInfoModel: () => ({ productName: 'fixture', salePrice: '1000' }),
    factoryOpenMarketSelectedChannels: () => [], factoryOpenMarketLog: noop,
    factoryEnsureCurrentDetailHtmlAsset: () => ({ html: '<img src="https://shop.example/web/detail.jpg">', sectionCount: 1 }),
    factoryCafe24BuildRegistrationReceiptPreflight: () => ({}), factoryPatchFinalRegistrationStatusInPlace: noop,
    factoryUpdateFinalRegistrationStatus: noop, factorySaveCafe24ProductFromFinalDb: async () => ({}),
    factoryPublishCafe24ScopedDetailHtml: async () => { h.raw.description = '<img src="https://shop.example/web/detail.jpg">'; },
    factoryCafe24FinalizeRegistrationReceipt: async () => {}, factoryRecordFinalRegistrationHistory: async () => {},
    saveLastWorkNow: async () => {}, renderPreservingMainScroll: noop,
  });
  ['factoryCafe24CreatePostSyncPlan', 'factoryRunCafe24PostCreateSync', 'factoryRunFinalRegistration']
    .forEach(name => load(h.context, name));
  assert.equal(await h.context.factoryRunFinalRegistration({ factory: h.factory, headless: true,
    skipLocalAssetPrepare: true, skipConfirm: true }), true);
  assert.deepEqual(h.calls.map(call => call.method), ['POST', 'POST', 'PUT']);
  assert.ok(h.calls.every(call => !/variants|inventories/.test(call.url)));
});

test('확정 A 사본은 선택 결과의 실제 두 split만 계획에 넣는다', { skip: !process.env.KUASANGSE_OPTION_IMAGE_FIXTURE }, () => {
  const h = harness();
  const snapshot = JSON.parse(fs.readFileSync(process.env.KUASANGSE_OPTION_IMAGE_FIXTURE, 'utf8'));
  h.factory.stages = snapshot.lightweight.factory.stages;
  h.factory.assets = snapshot.lightweight.factory.assets;
  h.context.state.optionSorter = snapshot.assets.optionSorter;
  const before = h.context.state.optionSorter.optionResults.map(result => result.splitImages.map(split =>
    h.context.factoryProjectFileImageFingerprint(split.image)));
  const plan = h.context.factoryBuildCafe24OptionSyncPlan(h.factory);
  assert.equal(plan.optionImages.length, 2);
  assert.deepEqual(Array.from(plan.optionImages, image => image.image.length), [950790, 975326]);
  assert.ok(plan.optionImageIdentity.includes('or_1789271818986_l724'));
  assert.deepEqual(h.context.state.optionSorter.optionResults.map(result => result.splitImages.map(split =>
    h.context.factoryProjectFileImageFingerprint(split.image))), before);
});
