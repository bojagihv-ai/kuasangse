'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const PAYLOADS = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-payloads.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');

function sourceFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  const start = functionStart >= 6 && source.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
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
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function compile(source, name, globals) {
  const context = vm.createContext({ Promise, TypeError, encodeURIComponent, ...globals });
  vm.runInContext(`${sourceFunction(source, name)}\nthis.target = ${name};`, context);
  return context.target;
}

test('최종 등록은 stale Cafe24 후보가 같은 값이라고 해도 입력한 판매가를 실제 payload에 강제한다', async () => {
  const sent = [];
  const save = compile(SYNC, 'factorySaveCafe24ProductFromFinalDb', {
    CAFE24_CONTROL_API: { defaultMallId: '1' },
    confirm: () => true,
    parseCafe24Raw: target => target?.raw || {},
    factoryUpdateFinalDbFromFields: () => ({ finalDb: { sale_price: '5000' }, fields: [] }),
    factoryApplyFinalCafe24StatusToDb() {},
    factoryCafe24TargetCandidate: () => ({ product_no: '3000', mall_id: '1', raw: { price: '5000' } }),
    factoryNormalizeCafe24ProductPayloadForSave: value => ({ ...value }),
    // Simulates onlyChanged filtering against a stale candidate cache that still says 5000.
    factoryBuildCafe24UpdatePayload: () => ({ product_name: '모시꽃수파우치' }),
    factoryApplyFinalCafe24StatusToProduct() {},
    factoryCafe24MoneyText: value => String(value).replace(/,/g, ''),
    factoryCafe24PositiveMoneyText: value => Number(String(value).replace(/,/g, '')) > 0 ? String(value).replace(/,/g, '') : '',
    factoryCafe24SkippedUpdateFields: () => [],
    factoryCafe24PayloadSummary: () => '',
    factoryLog() {},
    factoryCafe24ControlPlanFromBody: () => null,
    factoryCafe24SaveVerificationRecord: value => value,
    factoryMergeCafe24Candidates: value => value || [],
    normalizeCafe24ProductCandidate: () => ({}),
    factoryRememberCafe24SyncResult() {},
    factoryCafe24FieldLabelByApiField: value => value,
  });
  const factory = { product: { cafe24Candidates: [], candidateAutoApply: false } };

  await save({
    factory,
    applyFinalRegistrationSettings: true,
    forceName: '모시꽃수파우치',
    forceSalePrice: '5000',
    confirm: () => true,
    callCafe24Console: async (_method, _path, request) => {
      sent.push(request.body.product);
      return {};
    },
    waitForProductEcho: async (_productNo, _mallId, product) => ({
      detail: { raw: product },
      verification: { checked: Object.keys(product).length, matched: Object.keys(product).length, missing: [], mismatches: [] },
      attempts: 1,
    }),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].price, '5000', 'stale cache must not remove the user-confirmed final sale price');
});

test('14/15 부분 상세 등록도 현재 작업 상세 이미지를 안전 설명 fallback에 포함한다', () => {
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({ html: '', source: 'section-preview-incomplete', blocked: true }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    buildExportHtml: () => '<section>텍스트만 있는 부분 상세</section>',
    factoryCafe24StripDetailAdminLabels: value => value,
    factoryCafe24DetailHtmlPreflight: () => ({ ok: true }),
    factoryCafe24DetailForeignProductCheck: () => ({ ok: true }),
    factoryCafe24BuildMarketSafeDetailHtml: () => '<main>안전 상세 설명</main>',
    factoryRegistrationDetailImageRefs: () => [{
      src: 'http://127.0.0.1:5050/api/local-archive/assets/current-detail/image',
      label: '현재 상세 이미지',
    }],
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });
  const factory = { product: {}, assets: [], stages: {} };
  const result = ensure(factory);

  assert.match(result.html, /<img\b/i, 'partial fallback must retain a current-work detail image');
  assert.match(result.html, /current-detail\/image/);
  assert.match(result.asset?.html || '', /<img\b/i, 'the persisted detail asset must retain the same current-work image');
});

test('현재 섹션 HTML이 텍스트만 있어도 등록 전 현재 작업 상세 이미지를 함께 보존한다', () => {
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<main>현재 섹션 텍스트만 있는 상세</main>',
      source: 'current-section-export',
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 15, total: 15 }),
    factoryRegistrationDetailImageRefs: () => [{
      src: 'http://127.0.0.1:5050/api/local-archive/assets/current-detail/image',
      label: '현재 상세 이미지',
    }],
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });
  const result = ensure({ product: {}, assets: [], stages: {} });

  assert.match(result.html, /<img\b/i, 'complete text-only export must not discard current-work detail images');
  assert.match(result.asset?.html || '', /current-detail\/image/);
});

test('큰 로컬 상세 이미지는 등록용 경량 키로 보존해 전송 직전에 원본으로 확장한다', () => {
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({ html: '<main>현재 상세</main>', source: 'current-section-export' }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 15, total: 15 }),
    factoryRegistrationDetailImageRefs: () => [{
      src: '',
      transferSrc: 'data:image/png;base64,LARGE_CURRENT_DETAIL',
      storedLarge: true,
      label: '현재 상세 이미지',
    }],
    factoryRememberLightImage: () => 'current_detail_large',
    factoryLightImagePlaceholder: () => 'data:image/svg+xml,placeholder',
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });

  assert.match(result.html, /data-factory-light-image-key="current_detail_large"/);
  assert.doesNotMatch(result.html, /LARGE_CURRENT_DETAIL/);
});

test('상세 등록 직전에는 큰 현재 작업 이미지 원본도 요청한다', () => {
  assert.match(
    CORE,
    /factoryRegistrationDetailImageRefs\(factory, \{ includeTransferSrc: true \}\)/,
  );
});

test('최종 등록은 현재 작업의 보관된 상세 섹션 이미지를 먼저 복원한다', async () => {
  const prepareCalls = [];
  const run = compile(CORE, 'factoryRunFinalRegistration', {
    window: {},
    factoryUpdateFromInputs() {},
    factoryApplyFinalRegistrationBasicInfoInputs() {},
    factoryEnsureOpenMarketSync: () => ({}),
    factoryClearFinalRegistrationStaleResult() {},
    factoryApplyFinalCafe24StatusToDb() {},
    factoryUpdateFinalDbFromFields() {},
    factoryPrepareFinalRegistrationLocalAssets: async options => { prepareCalls.push(options); },
    factoryFinalRegistrationSettings: () => ({}),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: false, reason: 'stop after asset preparation' }),
    factoryFinalRegistrationCafe24Model: () => ({}),
    factoryFinalRegistrationBasicInfoModel: () => ({}),
    factoryUpdateFinalRegistrationStatus() {},
  });

  await run({ factory: { product: {} }, skipConfirm: true });

  assert.equal(prepareCalls.length, 1);
  assert.equal(prepareCalls[0].restoreCurrentWork, true, 'final registration must restore current-work section archives before detail HTML is built');
});

test('최종 등록 준비는 marker로 남은 상세 섹션 이미지를 같은 상품·원본 보관본에서 복구한다', async () => {
  const recoverCalls = [];
  const prepare = compile(CORE, 'factoryPrepareFinalRegistrationLocalAssets', {
    state: {},
    factoryUpdateFinalRegistrationStatus() {},
    factoryRefreshLocalArchiveAssets: async () => ({ ok: true }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    factoryRegistrationDetailImageRefs: () => [{ src: 'http://archive/current-section/image' }],
    factoryRecoverPreviewSectionsFromLocalArchive: async options => {
      recoverCalls.push(options);
      return { ok: true, restored: 13, total: 13 };
    },
    factoryHydrateCafe24ImagesFromLocalArchive: async () => ({ ok: true, hydrated: 0, alreadyReady: true }),
  });

  await prepare({ factory: { product: {}, archive: {} }, render: false });

  assert.equal(recoverCalls.length, 1);
  assert.equal(recoverCalls[0].render, false);
  assert.equal(recoverCalls[0].persist, false);
});


test('14장 미리보기 중 한 장만 들어간 전송 HTML은 나머지 현재 작업 이미지를 버리지 않는다', () => {
  const refs = Array.from({ length: 14 }, (_, index) => ({
    src: `http://127.0.0.1:5050/api/local-archive/assets/section-${index + 1}/image`,
    label: `상세 섹션 ${index + 1}`,
  }));
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<main><img src="http://127.0.0.1:5050/api/local-archive/assets/section-4/image"></main>',
      source: 'current-section-export',
      sectionCount: 14,
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    factoryRegistrationDetailImageRefs: () => refs,
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치3',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });
  const imageSources = Array.from(result.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi), match => match[1]);

  assert.equal(imageSources.length, 14, `expected all 14 preview images, got ${imageSources.length}`);
  assert.equal(new Set(imageSources).size, 14, 'current preview images must be preserved without duplicates');
  assert.equal(Array.from(result.asset.html.matchAll(/<img\b/gi)).length, 14, 'persisted transfer asset must keep all 14 images');
});

test('Cafe24 CDN으로 바뀐 기존 섹션은 alt로 중복을 막고 누락 이미지는 body 안에 보강한다', () => {
  const refs = Array.from({ length: 14 }, (_, index) => ({
    src: `http://127.0.0.1:5050/api/local-archive/assets/section-${index + 1}/image`,
    label: `상세 섹션 ${index + 1}`,
  }));
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<!doctype html><html><body><main><img src="https://cdn.example/section-4.jpg" alt="상세 섹션 4"></main></body></html>',
      source: 'current-section-export',
      sectionCount: 14,
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    factoryRegistrationDetailImageRefs: () => refs,
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치3',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });
  const imageTags = Array.from(result.html.matchAll(/<img\b/gi));

  assert.equal(imageTags.length, 14, `expected one existing CDN image plus 13 missing images, got ${imageTags.length}`);
  assert.equal(Array.from(result.html.matchAll(/alt="상세 섹션 4"/g)).length, 1, 'the existing CDN section must not be duplicated');
  assert.doesNotMatch(result.html, /<\/html>\s*<div/i, 'missing image markup must stay inside the HTML document');
  assert.match(result.html, /<\/div><\/body><\/html>$/i, 'missing image markup must be inserted before the closing body tag');
});

test('신규 최종 등록은 14개 생성 섹션 중 한 장만 확보되면 외부 상품 생성 전에 중단한다', async () => {
  const createCalls = [];
  const statuses = [];
  const sync = {};
  const run = compile(CORE, 'factoryRunFinalRegistration', {
    window: {},
    document: { getElementById: id => id === 'factoryCafe24InventoryAll' ? { value: '99' } : null },
    setTimeout: callback => { callback(); return 1; },
    FACTORY_PAGE_SESSION_ID: 'test-session',
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryUpdateFromInputs() {},
    factoryApplyFinalRegistrationBasicInfoInputs() {},
    factoryEnsureOpenMarketSync: () => sync,
    factoryClearFinalRegistrationStaleResult() {},
    factoryApplyFinalCafe24StatusToDb() {},
    factoryUpdateFinalDbFromFields() {},
    factoryFinalRegistrationSettings: () => ({ includeOpenMarket: false, targetLabel: '카페24만 등록', displayLabel: '진열안함', sellingLabel: '판매안함' }),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: true, ok: false, generated: 14, total: 15, label: '14/15개 섹션 생성' }),
    factoryFinalRegistrationCafe24Model: () => ({ canRun: true, mode: 'create', label: '새 상품' }),
    factoryFinalRegistrationBasicInfoModel: () => ({ productName: '모시꽃수파우치3', salePrice: '4688' }),
    factoryOpenMarketSelectedChannels: () => [],
    factoryOpenMarketLog() {},
    factoryCafe24TargetInfo: () => ({}),
    factoryHydrateCafe24ImagesFromLocalArchive: async () => ({ ok: true }),
    factoryCafe24ImagePayload: () => ({ detail_image: 'data:image/jpeg;base64,hero' }),
    factoryEnsureCurrentDetailHtmlAsset: () => ({
      html: '<main><img src="http://127.0.0.1:5050/api/local-archive/assets/only-one/image"></main>',
      source: 'partial-safe-fallback',
      partialFallback: true,
      sectionCount: 14,
    }),
    factoryCafe24DetailImageSrcValues: html => Array.from(String(html).matchAll(/<img\b[^>]*\bsrc=/gi)),
    factoryUpdateFinalRegistrationStatus(message) { statuses.push(String(message)); },
    factoryPatchFinalRegistrationStatusInPlace() {},
    factoryCreateCafe24ProductFromFinalDb: async options => { createCalls.push(options); return {}; },
    factoryRecordFinalRegistrationHistory: async () => ({}),
  });

  const result = await run({ factory: { product: {} }, skipConfirm: true, skipLocalAssetPrepare: true });

  assert.equal(result, false, 'incomplete detail image transfer must fail closed');
  assert.equal(createCalls.length, 0, 'a partial one-image detail must never create a Cafe24 product');
  assert.match(statuses.join(' | '), /상세 이미지 1\/14장/, 'the operator must see the exact missing-image count');
});

test('신규 최종 등록은 화면의 판매가와 전체 재고 99를 create 경계에 명시적으로 고정한다', async () => {
  const createCalls = [];
  const sync = {};
  const run = compile(CORE, 'factoryRunFinalRegistration', {
    window: {},
    document: { getElementById: id => id === 'factoryCafe24InventoryAll' ? { value: '99' } : null },
    setTimeout: callback => { callback(); return 1; },
    FACTORY_PAGE_SESSION_ID: 'test-session',
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryUpdateFromInputs() {},
    factoryApplyFinalRegistrationBasicInfoInputs() {},
    factoryEnsureOpenMarketSync: () => sync,
    factoryClearFinalRegistrationStaleResult() {},
    factoryApplyFinalCafe24StatusToDb() {},
    factoryUpdateFinalDbFromFields() {},
    factoryFinalRegistrationSettings: () => ({ includeOpenMarket: false, targetLabel: '카페24만 등록', displayLabel: '진열안함', sellingLabel: '판매안함' }),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: true, ok: true, generated: 14, total: 15, label: '14/15개 섹션 생성' }),
    factoryFinalRegistrationCafe24Model: () => ({ canRun: true, mode: 'create', label: '새 상품' }),
    factoryFinalRegistrationBasicInfoModel: () => ({ productName: '모시꽃수파우치3', salePrice: '4670' }),
    factoryOpenMarketSelectedChannels: () => [],
    factoryOpenMarketLog() {},
    factoryCafe24TargetInfo: () => ({}),
    factoryHydrateCafe24ImagesFromLocalArchive: async () => ({ ok: true }),
    factoryCafe24ImagePayload: () => ({ detail_image: 'data:image/jpeg;base64,hero' }),
    factoryEnsureCurrentDetailHtmlAsset: () => ({
      html: `<main>${Array.from({ length: 14 }, (_, index) => `<img src="https://cdn.example/detail-${index + 1}.jpg">`).join('')}</main>`,
      source: 'current-section-export',
      sectionCount: 14,
      reused: true,
    }),
    factoryUpdateFinalRegistrationStatus() {},
    factoryPatchFinalRegistrationStatusInPlace() {},
    factoryCreateCafe24ProductFromFinalDb: async options => { createCalls.push(options); return {}; },
    factoryRecordFinalRegistrationHistory: async () => ({}),
  });

  const result = await run({ factory: { product: {} }, skipConfirm: true, skipLocalAssetPrepare: true });

  assert.equal(result, true);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].forceSalePrice, '4670', 'create must not fall back to a stale cached price');
  assert.equal(createCalls[0].forceInventoryQuantity, '99', 'the visible all-inventory value must reach post-create inventory sync');
});

test('신규 등록 payload는 확정 사이즈를 Cafe24 추가정보에 병합하고 기존 행은 보존한다', () => {
  const mergeSize = compile(PAYLOADS, 'factoryCafe24MergeResolvedSizeAdditionalInformation', {
    factoryCafe24AdditionalInformationPayload: value => Array.isArray(value) ? value.map(row => ({ ...row })) : [],
  });
  const product = {
    additional_information: [
      { key: 'custom_option1', name: '사이즈', value: '' },
      { key: 'custom_option2', name: '색상', value: '15색' },
    ],
  };

  mergeSize(product, { size: '가로21cm*세로14cm' });

  assert.deepEqual(JSON.parse(JSON.stringify(product.additional_information)), [
    { key: 'custom_option1', name: '사이즈', value: '가로21cm*세로14cm' },
    { key: 'custom_option2', name: '색상', value: '15색' },
  ]);
});

test('신규 등록 builder만 확정 사이즈 추가정보 병합을 명시적으로 사용한다', () => {
  assert.match(
    PAYLOADS,
    /includeResolvedSizeAdditionalInformation[\s\S]{0,240}factoryCafe24MergeResolvedSizeAdditionalInformation/,
  );
  assert.match(
    SYNC,
    /factoryBuildCafe24UpdatePayload\(model\.finalDb, model\.fields, factory, \{[\s\S]{0,320}includeResolvedSizeAdditionalInformation:\s*true/,
  );
});

test('최종등록 패널은 undefined createModel을 실제 신규등록 미리보기로 다시 계산한다', () => {
  let previewCalls = 0;
  const resolveModel = compile(CORE, 'factoryFinalRegistrationCreateModel', {
    factoryCafe24CreatePreviewModel: () => {
      previewCalls += 1;
      return {
        product: {
          product_name: '기본값 확인 상품',
          price: '5000',
          manufacturer_code: 'M0000CJP',
          supplier_code: 'S0000000',
          brand_code: 'B00000PU',
          origin_classification: 'F',
          origin_place_no: 102,
        },
        dbModel: { finalDb: {} },
      };
    },
  });

  const result = resolveModel({ product: {} }, { createModel: undefined });

  assert.equal(previewCalls, 1);
  assert.equal(result.product.manufacturer_code, 'M0000CJP');
  assert.equal(resolveModel({ product: {} }, { createModel: null }), null, '명시적인 null은 그대로 존중한다');
});

test('신규 등록은 기본 제조·공급·브랜드와 대구 서구 원산지를 채우되 기존 DB/Cafe24 원산지를 보존한다', () => {
  const applyDefaults = compile(PAYLOADS, 'factoryApplyCafe24CreateReferenceDefaults', {});
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({}))), {
    manufacturer_code: 'M0000CJP',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    origin_classification: 'F',
    origin_place_no: 102,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({
    manufacturer_code: 'M0000000',
    supplier_code: 'S0000000',
    brand_code: 'B0000000',
  }))), {
    manufacturer_code: 'M0000CJP',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    origin_classification: 'F',
    origin_place_no: 102,
  }, 'Cafe24 미지정 기본 코드는 보자기천국 기본 코드로 교체한다');
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({
    manufacturer_code: 'M_EXISTING',
    made_in_code: 'CN',
  }))), {
    manufacturer_code: 'M_EXISTING',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    made_in_code: 'CN',
  }, '신화사DB 원산지가 있으면 국내 기본 지역을 덮어쓰지 않는다');
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({
    origin_classification: 'T',
    origin_place_no: 777,
  }))), {
    manufacturer_code: 'M0000CJP',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    origin_classification: 'T',
    origin_place_no: 777,
  }, 'Cafe24 원산지가 있으면 국내 기본 지역을 덮어쓰지 않는다');
  assert.match(PAYLOADS, /if \(options\.includeCreateReferenceDefaults === true\) \{\s*factoryApplyCafe24CreateReferenceDefaults\(product\);\s*\}/);
  assert.match(SYNC, /factoryBuildCafe24UpdatePayload\(model\.finalDb, model\.fields, factory, \{[\s\S]{0,360}includeCreateReferenceDefaults:\s*true/);
});

test('Cafe24 전송 직전 추가정보는 공식 key/value만 남겨 실제 저장되게 한다', () => {
  const normalize = compile(SYNC, 'factoryNormalizeCafe24AdditionalInformationForSave', {
    factoryCafe24AdditionalInformationPayload: value => value.map(row => ({ ...row })),
  });

  const result = normalize([
    { key: 'custom_option1', name: '사이즈', value: '가로21cm*세로14cm' },
    { key: 'custom_option2', name: '색상', value: '15색' },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { key: 'custom_option1', value: '가로21cm*세로14cm' },
    { key: 'custom_option2', value: '15색' },
  ]);
});

test('직접 Cafe24 새 상품 등록도 로컬 대표이미지를 복원하고 화면의 전체 재고 99를 후속 전송에 고정한다', async () => {
  const planInputs = [];
  const postInputs = [];
  const createRequests = [];
  const logs = [];
  let hydrateCalls = 0;
  const factory = {
    product: {
      finalDb: { product_name: '모시꽃수파우치9', sale_price: '5000' },
      cafe24Candidates: [],
      candidateAutoApply: false,
      cafe24ImageDraft: {},
    },
    assets: [],
    stages: {},
  };
  const create = compile(SYNC, 'factoryCreateCafe24ProductFromFinalDb', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    FACTORY_CAFE24_IMAGE_SLOTS: [
      { key: 'detail_image' },
      { key: 'list_image' },
      { key: 'tiny_image' },
      { key: 'small_image' },
    ],
    document: { getElementById: id => id === 'factoryCafe24InventoryAll' ? { value: '99' } : null },
    state: { productName: '모시꽃수파우치9' },
    Date,
    setInterval: () => 1,
    clearInterval() {},
    confirm: () => true,
    factoryCafe24TargetInfo: () => ({}),
    factoryUpdateFinalDbFromFields: current => ({ finalDb: current.product.finalDb, fields: [] }),
    factoryApplyFinalCafe24StatusToDb() {},
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<main><img src="https://cdn.example/detail.jpg"></main>',
      source: 'current-section-export',
    }),
    factoryCafe24ExpandLightImageHtmlForTransfer: value => value,
    factoryCafe24StripDetailAdminLabels: value => value,
    factoryCafe24DetailHtmlPreflight: () => ({ ok: true, hasLightPlaceholder: false }),
    factoryBuildCafe24UpdatePayload: (_finalDb, _fields, _factory, buildOptions) => ({
      product_name: '모시꽃수파우치9',
      price: '5000',
      description: '<main><img src="https://cdn.example/detail.jpg"></main>',
      ...(buildOptions.includeCreateReferenceDefaults ? {
        manufacturer_code: 'M0000CJP',
        supplier_code: 'S0000000',
        brand_code: 'B00000PU',
        origin_classification: 'F',
        origin_place_no: 102,
      } : {}),
    }),
    factoryAttachCafe24OptionsToProductPayload() {},
    factoryAttachCafe24CategoryToProductPayload() {},
    factoryCafe24PositiveMoneyText: value => String(value || '').replace(/,/g, ''),
    factoryApplyFinalCafe24StatusToProduct() {},
    factoryNormalizeCafe24ProductPayloadForSave: value => ({ ...value }),
    factoryCafe24PruneEmptyProductPayload() {},
    factoryBuildCafe24OptionSyncPlan: (_current, _finalDb, _model, syncOptions) => {
      planInputs.push({ ...syncOptions });
      return { optionValueTotal: 15 };
    },
    factoryCafe24CreatePostSyncPlan: (_current, syncOptions) => {
      planInputs.push({ ...syncOptions });
      return {
        imageSlotCount: 4,
        readyActions: [
          { key: 'images', label: '상품 이미지', ready: true },
          { key: 'options', label: '옵션/품목/재고', ready: true },
        ],
      };
    },
    factoryHydrateCafe24ImagesFromLocalArchive: async () => {
      hydrateCalls += 1;
      return { ok: true, hydrated: 1 };
    },
    factoryCafe24ImagePayload: () => ({
      detail_image: 'data:image/jpeg;base64,hero',
      list_image: 'data:image/jpeg;base64,hero',
      tiny_image: 'data:image/jpeg;base64,hero',
      small_image: 'data:image/jpeg;base64,hero',
    }),
    factoryCafe24PayloadSummary: () => 'payload',
    factoryLog(message) { logs.push(String(message)); },
    callCafe24Console: async (_method, _path, request) => {
      createRequests.push(request.body);
      return { product: { product_no: 3003, product_code: 'P0000ELN', product_name: '모시꽃수파우치9' } };
    },
    factoryCafe24ControlPlanFromBody: () => null,
    factoryExtractCafe24ProductFromBody: body => body.product,
    normalizeCafe24ProductCandidate: value => ({ ...value, raw: value }),
    factoryMergeCafe24Candidates: (_current, incoming) => incoming,
    factoryCafe24CandidateKey: value => String(value.product_no || ''),
    cafe24ProductKey: value => String(value.product_no || ''),
    factoryPromoteCreatedCafe24ProductToUpdateTarget: () => ({ productNo: '3003' }),
    factoryCafe24SaveVerificationRecord: value => value,
    factoryWaitForCafe24ProductEcho: async () => ({
      detail: { raw: { product_no: 3003, product_name: '모시꽃수파우치9' } },
      verification: { checked: 2, matched: 2, missing: [], mismatches: [] },
      attempts: 1,
    }),
    factoryVerifyCafe24ProductEcho: () => ({ checked: 2, matched: 2, missing: [], mismatches: [] }),
    factoryPublishCafe24ScopedDetailHtml: async () => true,
    factoryRunCafe24PostCreateSync: async (_actions, options) => {
      postInputs.push({ ...options });
      return true;
    },
    fetchCafe24ProductFullByNo: async () => ({
      raw: {
        product_no: 3003,
        product_name: '모시꽃수파우치9',
        description: '<main><img src="https://cdn.example/detail.jpg"></main>',
        detail_image: '/web/product/big/3003.jpg',
      },
    }),
    parseCafe24Raw: value => value?.raw || value || {},
    factoryCafe24Delay: async () => {},
  });

  const result = await create({ factory, skipConfirm: true, render: false });

  assert.notEqual(result, false, factory.product.cafe24ApiStatus || logs.join(' | ') || 'direct create unexpectedly returned false');
  assert.equal(hydrateCalls, 1, 'the direct create button must hydrate the local representative image before creating a product');
  assert.equal(createRequests[0].manufacturer_code, 'M0000CJP');
  assert.equal(createRequests[0].supplier_code, 'S0000000');
  assert.equal(createRequests[0].brand_code, 'B00000PU');
  assert.equal(createRequests[0].origin_classification, 'F');
  assert.equal(createRequests[0].origin_place_no, 102);
  assert.equal(planInputs.every(input => input.forceInventoryQuantity === '99'), true, 'every direct-create plan must use the visible all-inventory quantity');
  assert.equal(postInputs.length, 1);
  assert.equal(postInputs[0].forceInventoryQuantity, '99');
});
