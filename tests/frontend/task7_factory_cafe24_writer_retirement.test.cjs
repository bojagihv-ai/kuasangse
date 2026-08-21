'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const appCore03Source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const appCore05Source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const appCore06Source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
const appCore04Source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-04.js'), 'utf8');
const payloadSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-payloads.js'), 'utf8');
const productFormSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-product-form.js'), 'utf8');
const cafe24ApiSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-api.js'), 'utf8');
const syncSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');

function sourceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  let paramsQuote = '';
  let paramsEscaped = false;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (paramsQuote) {
      if (paramsEscaped) paramsEscaped = false;
      else if (char === '\\') paramsEscaped = true;
      else if (char === paramsQuote) paramsQuote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      paramsQuote = char;
      continue;
    }
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `unterminated parameters for ${name}`);
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
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
  throw new Error(`unterminated function ${name}`);
}

function compileFunction(source, name, globals = {}) {
  const context = vm.createContext({ Promise, TypeError, console, ...globals });
  vm.runInContext(`${sourceFunction(source, name)}\nthis.target = ${name};`, context);
  return context.target;
}

function compileFunctions(source, names, globals = {}) {
  const context = vm.createContext({ Promise, TypeError, console, ...globals });
  const declarations = names.map(name => sourceFunction(source, name)).join('\n');
  vm.runInContext(`${declarations}\nthis.targets = { ${names.join(', ')} };`, context);
  return context.targets;
}

function freezeRecursively(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeRecursively);
  return Object.freeze(value);
}

function compileDbReviewModel(globals = {}) {
  const names = [
    'factoryDbFieldSetting',
    'factoryIsTechnicalRawDbField',
    'factoryDbCustomFieldList',
    'factoryBuildDbReviewModel',
  ];
  const combinedSource = [
    sourceFunction(appCore04Source, 'factoryDbFieldSetting'),
    ...names.slice(1).map(name => sourceFunction(productFormSource, name)),
  ].join('\n');
  return compileFunctions(combinedSource, names, {
    FACTORY_DB_FIELD_DEFS: [{ id: 'product_name', label: '상품명', required: true }],
    factoryDbSourceRows: () => [],
    factoryDeriveDbFieldValue: () => '',
    factoryIgnoreStaleCafe24OptionManual: () => false,
    factoryUniqueSourceValues: () => [],
    ...globals,
  }).factoryBuildDbReviewModel;
}

test('Cafe24 상세페이지 내보내기 이미지는 브라우저 이벤트 핸들러를 포함하지 않는다', () => {
  const section = compileFunction(appCore05Source, 'renderSectionTemplate', {
    state: {
      previewLayerMode: false,
      layoutTemplate: 'classic',
      activePreviewLayer: null,
      previewLayerEdits: {},
      currentSectionVariantIds: {},
      sectionVariants: {},
      sectionGenerationMeta: {},
    },
    applyBrandPresetToContent: value => value,
    displayableImageSrc: value => value,
    cssFontFamily: () => 'sans-serif',
    publicSectionText: value => String(value || ''),
    escapeHtml: value => String(value || ''),
    nl2br: value => String(value || ''),
    escAttr: value => String(value || ''),
    renderPreviewLayer: (_sectionId, _layerId, html) => html,
    renderExtraElements: () => '',
    resolveSectionRenderGenerationMode: () => 'full_image',
    renderFactoryLightImage: (src, alt) => `<img src="${src}" alt="${alt}" onerror="window.recover(this)">`,
  });
  const sectionHtml = section({ id: 'header', name: '헤더', n: 1 }, {}, 'https://example.com/header.jpg', 'export');
  assert.match(sectionHtml, /<img\b/);
  assert.doesNotMatch(sectionHtml, /\bonerror\s*=|\bwindow\./i);

  const inserted = compileFunction(appCore05Source, 'renderInsertedDetailImageBlock', {
    escAttr: value => String(value),
    escapeHtml: value => String(value),
    displayableImageSrc: value => value,
    renderFactoryLightImage: (src, alt) => `<img src="${src}" alt="${alt}" onerror="window.recover(this)">`,
  });
  const insertedHtml = inserted({ id: 'detail-1', dataUrl: 'https://example.com/detail.jpg', label: '상세 이미지' }, 'export');
  assert.match(insertedHtml, /<img\b/);
  assert.doesNotMatch(insertedHtml, /\bonerror\s*=|\bwindow\./i);

  const fixed = compileFunction(appCore05Source, 'renderFixedDetailImageForExport', {
    state: { fixedDetailImages: { brand: { dataUrl: 'https://example.com/brand.jpg' } } },
    loadFixedDetailImages: () => ({}),
    normalizeFixedDetailImages: value => value,
    displayableImageSrc: value => value,
    getFixedDetailImageSlot: () => ({ label: '브랜드 이미지' }),
    escAttr: value => String(value),
    renderFactoryLightImage: (src, alt) => `<img src="${src}" alt="${alt}" onerror="window.recover(this)">`,
  });
  const fixedHtml = fixed('brand');
  assert.match(fixedHtml, /<img\b/);
  assert.doesNotMatch(fixedHtml, /\bonerror\s*=|\bwindow\./i);
});

test('Cafe24 상세 payload guard는 설명 필드를 전부 지우고 빈 요청을 보내지 않는다', () => {
  const functions = compileFunctions(cafe24ApiSource, [
    'cafe24ConsoleIsRootProductWrite',
    'cafe24ConsoleProductObjectFromPayloadBody',
    'cafe24ConsoleRemoveUnsupportedProductFields',
    'cafe24ConsoleSanitizeProductDetailPayload',
  ], {
    CAFE24_CONSOLE_UNSUPPORTED_PRODUCT_FIELD_LABELS: {},
    cafe24ConsolePayloadGuard: {
      preflightProduct: () => ({
        ok: false,
        unsafeFields: ['description', 'mobile_description'],
        issues: ['상세설명 HTML에 이벤트 핸들러 속성이 포함되어 있습니다.'],
      }),
      sanitizeProduct: () => ({}),
    },
    factoryLog: () => {},
  });

  assert.throws(
    () => functions.cafe24ConsoleSanitizeProductDetailPayload('PUT', '/api/v2/admin/products/2994', {
      product: { description: '<img onerror="alert(1)">', mobile_description: '<img onerror="alert(1)">' },
    }),
    /상세설명 안전검사 실패.*이벤트 핸들러/,
  );
});

test('Cafe24 point payload always sends an explicit API unit for product creation', () => {
  const combinedSource = [
    sourceFunction(productFormSource, 'factoryCafe24PointsAmountRows'),
    sourceFunction(productFormSource, 'factoryCafe24PointsAmountPayload'),
  ].join('\n');
  const { factoryCafe24PointsAmountPayload } = compileFunctions(combinedSource, [
    'factoryCafe24PointsAmountRows',
    'factoryCafe24PointsAmountPayload',
  ], { factoryCafe24JsonPayload: value => value });
  const plain = value => JSON.parse(JSON.stringify(value));

  assert.deepEqual(
    plain(factoryCafe24PointsAmountPayload([{ points_rate: '0.00%' }])),
    [{ points_rate: '0.00', points_unit_by_payment: 'P' }],
  );
  assert.deepEqual(
    plain(factoryCafe24PointsAmountPayload([{ points_amount: '500' }])),
    [{ points_rate: '500', points_unit_by_payment: 'W' }],
  );
  assert.deepEqual(
    plain(factoryCafe24PointsAmountPayload([{ points_rate: '2', points_unit_by_payment: 'P' }])),
    [{ points_rate: '2', points_unit_by_payment: 'P' }],
  );
});

test('Cafe24 update payload includes required mileage parent settings with point rows', () => {
  const normalize = compileFunction(syncSource, 'factoryNormalizeCafe24ProductPayloadForSave', {
    factoryRemoveCafe24UnsupportedProductPayloadFields() {},
    factoryRemoveCafe24InvalidReferenceCodePayloadFields() {},
    factoryCafe24FieldLabelByApiField: value => value,
  });
  const notes = [];
  const normalized = normalize({
    points_amount: [{ points_rate: '0.00', points_unit_by_payment: 'P' }],
  }, notes);
  assert.equal(normalized.points_by_product, 'T');
  assert.equal(normalized.points_setting_by_payment, 'B');
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.points_amount)),
    [{ points_rate: '0.00', points_unit_by_payment: 'P' }],
  );
});

test('Cafe24 payload core writers require an explicit transaction draft', () => {
  const reset = compileFunction(payloadSource, 'factoryResetCafe24DraftsForProduct');
  const sanitize = compileFunction(payloadSource, 'factoryCafe24SanitizeDetailHtmlPayload');
  const scopeDetail = compileFunction(payloadSource, 'factoryCafe24EnsureScopedDetailHtmlPayload');

  assert.throws(() => reset(), /factory draft is required/);
  assert.throws(() => sanitize({}, {}, undefined), /factory draft is required/);
  assert.throws(() => scopeDetail({}, {}, undefined), /factory draft is required/);
  for (const name of [
    'factoryResetCafe24DraftsForProduct',
    'factoryCafe24SanitizeDetailHtmlPayload',
    'factoryCafe24EnsureScopedDetailHtmlPayload',
  ]) {
    assert.doesNotMatch(sourceFunction(payloadSource, name), /factoryRuntimeReadFactory\s*\(/);
  }
});

test('reference auto-load uses one owned transaction, one draft, and saves after commit', async () => {
  const events = [];
  const snapshot = { product: {} };
  const draft = { product: {} };
  let transactionCount = 0;
  let refreshFactory = null;
  const ensure = compileFunction(payloadSource, 'factoryEnsureCafe24ReferenceLists', {
    factoryRuntimeReadFactory() {
      events.push('read');
      return snapshot;
    },
    factoryCafe24ReferenceListsReady() {
      return false;
    },
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      transactionCount += 1;
      events.push(`transaction:${command}:${owner}`);
      return Promise.resolve(mutate(draft)).then(result => {
        events.push('commit');
        return { result };
      });
    },
    factoryRefreshCafe24ReferenceLists(options) {
      refreshFactory = options.factory;
      events.push('refresh');
      return Promise.resolve({ categories: [] });
    },
    factoryLog() {},
    saveLastWorkNow(options) {
      events.push(`save:${options?.sync}`);
    },
  });

  await ensure();

  assert.equal(transactionCount, 1);
  assert.equal(refreshFactory, draft);
  assert.equal(draft.product.cafe24ReferenceAutoTried, true);
  assert.equal(draft.product.cafe24ReferenceLoading, false);
  assert.deepEqual(events, [
    'read',
    'transaction:factory/cafe24:refresh-reference-lists:cafe24',
    'refresh',
    'commit',
    'save:false',
  ]);
});

test('reference auto-load catch/finally mutate the same draft and stale rejection never saves', async () => {
  const draft = { product: {} };
  const logs = [];
  let saves = 0;
  const ensureFailure = compileFunction(payloadSource, 'factoryEnsureCafe24ReferenceLists', {
    factoryRuntimeReadFactory: () => ({ product: {} }),
    factoryCafe24ReferenceListsReady: () => false,
    factoryRuntimeUpdateOwnedFactory(_command, _owner, mutate) {
      return Promise.resolve(mutate(draft)).then(result => ({ result }));
    },
    factoryRefreshCafe24ReferenceLists(options) {
      assert.equal(options.factory, draft);
      return Promise.reject(new Error('reference-down'));
    },
    factoryLog(message, level, factory) {
      logs.push({ message, level, factory });
    },
    saveLastWorkNow() {
      saves += 1;
    },
  });

  const result = await ensureFailure();
  assert.equal(result, false);
  assert.equal(draft.product.cafe24ReferenceLoading, false);
  assert.match(draft.product.cafe24ReferenceStatus, /reference-down/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].factory, draft);
  assert.equal(saves, 1);

  const ensureStale = compileFunction(payloadSource, 'factoryEnsureCafe24ReferenceLists', {
    factoryRuntimeReadFactory: () => ({ product: {} }),
    factoryCafe24ReferenceListsReady: () => false,
    factoryRuntimeUpdateOwnedFactory: () => Promise.reject(new Error('STALE_FACTORY_STORE_REVISION')),
    saveLastWorkNow() {
      saves += 1;
    },
    console: { error() {} },
  });
  assert.equal(await ensureStale(), false);
  assert.equal(saves, 1, 'stale transaction must not trigger post-commit save');
});

test('reference auto-load skips transaction when a detached preflight says it is complete', () => {
  let transactions = 0;
  let saves = 0;
  const ensure = compileFunction(payloadSource, 'factoryEnsureCafe24ReferenceLists', {
    factoryRuntimeReadFactory: () => ({ product: { cafe24ReferenceLists: { categories: [{}] } } }),
    factoryCafe24ReferenceListsReady: () => true,
    factoryRuntimeUpdateOwnedFactory() {
      transactions += 1;
    },
    saveLastWorkNow() {
      saves += 1;
    },
  });

  assert.equal(ensure(), undefined);
  assert.equal(transactions, 0);
  assert.equal(saves, 0);
});

test('Cafe24 product-form core writers require an explicit transaction draft', () => {
  const names = [
    'factoryEnableCafe24CoreDbFields',
    'factoryUpdateFinalDbFromFields',
    'factorySourcePanelState',
    'factoryCafe24ImageDraft',
    'factoryCafe24IconDraft',
    'factoryCafe24RelationDraft',
    'factoryCafe24MemoDraft',
    'factoryCafe24MainDraft',
    'factoryCafe24PromotionDraft',
    'factoryCafe24SeoDraft',
    'factoryCafe24TagsDraft',
  ];
  for (const name of names) {
    const writer = compileFunction(productFormSource, name);
    assert.throws(() => writer(), /factory draft is required/, name);
    assert.doesNotMatch(sourceFunction(productFormSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }
});

test('frozen review model builds canonical defaults without mutating its authority snapshot', () => {
  const buildReviewModel = compileDbReviewModel();
  const snapshot = {
    product: {
      dbFieldSettings: {},
      dbCustomFields: [],
    },
  };
  const expected = structuredClone(snapshot);
  const originalBytes = JSON.stringify(snapshot);
  freezeRecursively(snapshot);

  let model;
  assert.doesNotThrow(() => {
    model = buildReviewModel(snapshot);
  });

  assert.deepEqual(snapshot, expected);
  assert.equal(JSON.stringify(snapshot), originalBytes);
  assert.equal(model.fields[0].id, 'product_name');
  assert.equal(model.fields[0].enabled, true);
  assert.equal(model.fields[0].manualValue, '');
});

test('frozen review model builds custom defaults without mutating its authority snapshot', () => {
  const buildReviewModel = compileDbReviewModel();
  const snapshot = {
    product: {
      dbFieldSettings: {
        product_name: { enabled: true, manualValue: '기존 상품명' },
      },
      dbCustomFields: [{
        id: 'custom_material',
        label: '재질',
        enabled: true,
        manualValue: '스테인리스',
      }],
    },
  };
  const expected = structuredClone(snapshot);
  const originalBytes = JSON.stringify(snapshot);
  freezeRecursively(snapshot);

  let model;
  assert.doesNotThrow(() => {
    model = buildReviewModel(snapshot);
  });

  assert.deepEqual(snapshot, expected);
  assert.equal(JSON.stringify(snapshot), originalBytes);
  assert.equal(model.fields[0].manualValue, '기존 상품명');
  assert.equal(model.finalDb.product_name, '기존 상품명');
  assert.equal(model.fields[1].id, 'custom_material');
  assert.equal(model.fields[1].enabled, true);
  assert.equal(model.fields[1].manualValue, '스테인리스');
  assert.equal(model.finalDb.custom_material, '스테인리스');
});

test('passive review model leaves store workspace revision and operation token unchanged', async () => {
  const moduleUrl = pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-store.mjs'));
  moduleUrl.searchParams.set('cafe24-passive-review', `${Date.now()}-${Math.random()}`);
  const { createFactoryStore } = await import(moduleUrl.href);
  let updateCalls = 0;
  const store = createFactoryStore({
    workspaceId: 'review-workspace',
    revision: 41,
    initialSnapshot: {
      factory: {
        product: {
          dbFieldSettings: {},
          dbCustomFields: [],
        },
      },
      productDb: {},
      competitors: {},
      factoryAssets: {},
      detailDocument: {},
      cafe24: {},
    },
    assertMutable() {
      updateCalls += 1;
    },
  });
  const snapshotBefore = store.getSnapshot();
  const tokenBefore = store.getOperationToken();
  const bytesBefore = JSON.stringify(snapshotBefore);
  const buildReviewModel = compileDbReviewModel({
    factoryRuntimeReadFactory: () => store.getSnapshot().factory,
    factoryRuntimeUpdateOwnedFactory() {
      updateCalls += 1;
      throw new Error('passive review model must not update the store');
    },
  });

  const model = buildReviewModel();

  assert.equal(updateCalls, 0);
  assert.equal(store.getSnapshot(), snapshotBefore);
  assert.equal(JSON.stringify(store.getSnapshot()), bytesBefore);
  assert.equal(store.getOperationToken(), tokenBefore);
  assert.equal(store.getOperationToken().workspaceId, 'review-workspace');
  assert.equal(store.getOperationToken().revision, 41);
  assert.equal(model.fields[0].enabled, true);
  const reviewModelSource = sourceFunction(productFormSource, 'factoryBuildDbReviewModel');
  assert.doesNotMatch(reviewModelSource, /factoryDbFieldSetting\s*\(/);
  assert.doesNotMatch(reviewModelSource, /factoryRuntimeUpdateOwnedFactory\s*\(/);
});

test('DB input snapshot load and delete commit through exact commands before save/render', async () => {
  const sourceSnapshot = {
    id: 'snapshot-1',
    dbFieldSettings: { price: { manualValue: '4000' } },
    finalDb: { price: '4000' },
    confirmedDb: { price: '3900' },
    selectedDbCandidateKey: 'db-1',
    selectedCafe24CandidateKey: 'cafe-1',
    cafe24DraftProductKey: 'draft-1',
  };
  const loadDraft = { product: { dbInputSnapshots: [sourceSnapshot] } };
  const loadEvents = [];
  const load = compileFunction(productFormSource, 'factoryLoadDbInputSnapshot', {
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      loadEvents.push(`transaction:${command}:${owner}`);
      return Promise.resolve(mutate(loadDraft)).then(result => {
        loadEvents.push('commit');
        return { result };
      });
    },
    factoryDbInputSnapshotList: factory => factory.product.dbInputSnapshots,
    cloneData: value => JSON.parse(JSON.stringify(value)),
    factoryDbInputSnapshotLabel: snapshot => snapshot.id,
    factoryLog(_message, _level, factory) {
      assert.equal(factory, loadDraft);
      loadEvents.push('log');
    },
    saveLastWorkNow: () => loadEvents.push('save'),
    renderPreservingMainScroll: () => loadEvents.push('render'),
  });

  assert.equal(await load('snapshot-1'), true);
  assert.equal(loadDraft.product.finalDb.price, '4000');
  assert.notEqual(loadDraft.product.finalDb, sourceSnapshot.finalDb);
  assert.equal(loadDraft.product.selectedCafe24CandidateKey, 'cafe-1');
  assert.deepEqual(loadEvents, [
    'transaction:factory/cafe24:load-db-input-snapshot:cafe24',
    'log',
    'commit',
    'save',
    'render',
  ]);

  const deleteDraft = { product: { dbInputSnapshots: [sourceSnapshot, { id: 'snapshot-2' }] } };
  const deleteEvents = [];
  const remove = compileFunction(productFormSource, 'factoryDeleteDbInputSnapshot', {
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      deleteEvents.push(`transaction:${command}:${owner}`);
      return Promise.resolve(mutate(deleteDraft)).then(result => {
        deleteEvents.push('commit');
        return { result };
      });
    },
    factoryDbInputSnapshotList: factory => factory.product.dbInputSnapshots,
    factoryLog(_message, _level, factory) {
      assert.equal(factory, deleteDraft);
      deleteEvents.push('log');
    },
    saveLastWorkNow: () => deleteEvents.push('save'),
    renderPreservingMainScroll: () => deleteEvents.push('render'),
  });

  assert.equal(await remove('snapshot-1'), true);
  assert.equal(deleteDraft.product.dbInputSnapshots.length, 1);
  assert.equal(deleteDraft.product.dbInputSnapshots[0].id, 'snapshot-2');
  assert.deepEqual(deleteEvents, [
    'transaction:factory/cafe24:delete-db-input-snapshot:cafe24',
    'log',
    'commit',
    'save',
    'render',
  ]);
});

test('DB input snapshot stale rejection cannot save or render', async () => {
  let saves = 0;
  let renders = 0;
  const globals = {
    factoryRuntimeUpdateOwnedFactory: () => Promise.reject(new Error('STALE_FACTORY_STORE_REVISION')),
    saveLastWorkNow: () => { saves += 1; },
    renderPreservingMainScroll: () => { renders += 1; },
  };
  const load = compileFunction(productFormSource, 'factoryLoadDbInputSnapshot', globals);
  const remove = compileFunction(productFormSource, 'factoryDeleteDbInputSnapshot', globals);

  await assert.rejects(load('snapshot-1'), /STALE_FACTORY_STORE_REVISION/);
  await assert.rejects(remove('snapshot-1'), /STALE_FACTORY_STORE_REVISION/);
  assert.equal(saves, 0);
  assert.equal(renders, 0);
});

test('Cafe24 image draft edits use one owned transaction and save/render after commit', () => {
  const events = [];
  const draft = { product: { cafe24ImageDraft: { image_upload_type: 'A', additional_images: [] } } };
  const globals = {
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image', label: '상세' }],
    factoryRuntimeIsOperationCurrent: () => true,
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      const result = mutate(draft);
      events.push('commit');
      return { result };
    },
    factoryCafe24ImageDraft(factory) {
      return factory.product.cafe24ImageDraft;
    },
    factoryCafe24AdditionalImageDrafts(factory) {
      return [...(factory.product.cafe24ImageDraft.additional_images || [])];
    },
    factoryLog(_message, _level, factory) {
      assert.equal(factory, draft);
      events.push('log');
    },
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
    uid: () => 'additional-1',
  };
  const functions = compileFunctions(syncSource, [
    'factoryCafe24RunOwnedDraftMutation',
    'factorySetCafe24ImageDraftSlot',
    'factoryClearCafe24ImageDraftSlot',
    'factoryAddCafe24AdditionalImageDraft',
    'factoryRemoveCafe24AdditionalImageDraft',
    'factoryClearCafe24AdditionalImages',
  ], globals);

  assert.equal(functions.factorySetCafe24ImageDraftSlot('detail_image', { base64: 'abc' }), true);
  assert.equal(draft.product.cafe24ImageDraft.detail_image.base64, 'abc');
  assert.deepEqual(events.slice(-4), [
    'transaction:factory/cafe24:update-image-draft:cafe24',
    'commit',
    'save',
    'render',
  ]);

  assert.equal(functions.factoryAddCafe24AdditionalImageDraft({ base64: 'extra' }), true);
  assert.equal(draft.product.cafe24ImageDraft.additional_images.length, 1);
  assert.equal(functions.factoryRemoveCafe24AdditionalImageDraft(0), true);
  assert.equal(draft.product.cafe24ImageDraft.additional_images.length, 0);
  assert.equal(functions.factoryClearCafe24ImageDraftSlot('detail_image'), true);
  assert.equal(draft.product.cafe24ImageDraft.detail_image, undefined);
  assert.equal(functions.factoryClearCafe24AdditionalImages(), true);
  assert.equal(events.filter(item => item === 'save').length, 5);
  assert.equal(events.filter(item => item === 'render').length, 5);
});

test('Cafe24 image draft stale operation and delayed FileReader callbacks fail closed', () => {
  let transactions = 0;
  let saves = 0;
  let renders = 0;
  const functions = compileFunctions(syncSource, [
    'factoryCafe24RunOwnedDraftMutation',
    'factorySetCafe24ImageDraftSlot',
  ], {
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryRuntimeIsOperationCurrent: () => false,
    factoryRuntimeUpdateOwnedFactory() {
      transactions += 1;
    },
    saveLastWorkNow: () => { saves += 1; },
    render: () => { renders += 1; },
  });

  assert.equal(functions.factorySetCafe24ImageDraftSlot(
    'detail_image',
    { base64: 'stale' },
    { operationToken: { workspaceId: 'old' } },
  ), false);
  assert.equal(transactions, 0);
  assert.equal(saves, 0);
  assert.equal(renders, 0);

  for (const name of ['factorySetCafe24ImageDraftFile', 'factoryAddCafe24AdditionalImageFiles']) {
    const source = sourceFunction(syncSource, name);
    assert.match(source, /factoryCafe24CaptureOperationToken\s*\(\)/, name);
    assert.match(source, /operationToken,/, name);
  }
});

test('Cafe24 product image payload uses official data URLs and request envelope', async () => {
  const slots = [
    { key: 'detail_image', label: '상세 이미지' },
    { key: 'list_image', label: '목록 이미지' },
  ];
  const draft = {
    product: {
      cafe24ImageDraft: {
        image_upload_type: 'B',
        detail_image: { mime: 'image/jpeg', base64: 'jpeg-payload' },
        list_image: { mime: 'image/png', base64: 'data:image/png;base64,png-payload' },
      },
    },
  };
  const imageFunctions = compileFunctions(productFormSource, [
    'factoryCafe24ImageRequestValue',
    'factoryCafe24ImagePayload',
  ], {
    FACTORY_CAFE24_IMAGE_SLOTS: slots,
    factoryCafe24ImageDraft: factory => factory.product.cafe24ImageDraft,
    factoryCafe24GeneratedMainImage: () => null,
  });
  const imagePayload = imageFunctions.factoryCafe24ImagePayload(draft);
  assert.deepEqual(JSON.parse(JSON.stringify(imagePayload)), {
    image_upload_type: 'B',
    detail_image: 'data:image/jpeg;base64,jpeg-payload',
    list_image: 'data:image/png;base64,png-payload',
  });

  const syncImagesSource = sourceFunction(syncSource, 'factorySyncCafe24ProductImages');
  assert.match(syncImagesSource, /body:\s*\{\s*shop_no:\s*1,\s*request:\s*payload,\s*\}/s);
  assert.match(syncImagesSource, /executeDirect:\s*true/);
});

test('Cafe24 DOM/form drafts share one explicit draft and preserve post-commit save mode', () => {
  const events = [];
  const draft = {
    product: {
      cafe24IconDraft: {},
      cafe24RelationDraft: {},
      cafe24SeoDraft: {},
      cafe24TagsDraft: {},
      cafe24DraftProductKey: '',
    },
    automation: {},
  };
  const names = [
    'factoryCafe24RunOwnedDraftMutation',
    'factoryUpdateCafe24IconDraftFromDom',
    'factoryApplyCafe24RelationDraftFromDom',
    'factoryUpdateCafe24SeoTagsDraftFromDom',
    'factoryStoreCafe24OptionGroupDraft',
    'factoryStoreCafe24OptionExtrasDraft',
  ];
  const functions = compileFunctions(syncSource, names, {
    document: {
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    factoryRuntimeIsOperationCurrent: () => true,
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      const result = mutate(draft);
      events.push('commit');
      return { result };
    },
    factoryCafe24IconDraft(factory) {
      assert.equal(factory, draft);
      return factory.product.cafe24IconDraft;
    },
    factoryCafe24RelationDraft(factory) {
      assert.equal(factory, draft);
      return factory.product.cafe24RelationDraft;
    },
    factoryCafe24SeoDraft: factory => factory.product.cafe24SeoDraft,
    factoryCafe24TagsDraft: factory => factory.product.cafe24TagsDraft,
    factoryCafe24SeoChanged: () => false,
    factorySplitCafe24Tags: value => Array.isArray(value) ? value : [],
    factoryDbNormalizeKey: value => String(value || '').toLowerCase(),
    factoryDbFieldSetting: () => ({}),
    factoryUpdateFinalDbFromFields() {},
    factoryNormalizeCafe24OptionGroup: group => ({
      key: group.key || 'group_1',
      name: group.name || '',
      values: group.values || [],
    }),
    factorySetDbFieldManualValue(_field, _value, options) {
      assert.equal(options.factory, draft);
    },
    factoryCafe24CurrentProductKey: () => 'product-1',
    factoryCafe24OptionFlag: value => value || 'F',
    factoryNormalizeCafe24AdditionalOption: row => row,
    cloneData: value => JSON.parse(JSON.stringify(value)),
    factoryLog() {},
    scheduleLastWorkSave: () => events.push('schedule'),
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
  });

  functions.factoryUpdateCafe24IconDraftFromDom();
  functions.factoryApplyCafe24RelationDraftFromDom();
  functions.factoryUpdateCafe24SeoTagsDraftFromDom();
  functions.factoryStoreCafe24OptionGroupDraft([{ name: '색상', values: ['빨강'] }]);
  functions.factoryStoreCafe24OptionExtrasDraft({ useAdditionalOption: 'F' });

  assert.equal(events.filter(event => event === 'commit').length, 5);
  assert.equal(events.filter(event => event === 'schedule').length, 5);
  assert.equal(events.filter(event => event === 'save').length, 0);
  assert.equal(events.filter(event => event === 'render').length, 0);
  assert.equal(events.filter(event => event === 'transaction:factory/cafe24:update-form-drafts:cafe24').length, 5);
  assert.equal(draft.product.cafe24DraftProductKey, 'product-1');

  functions.factoryUpdateCafe24IconDraftFromDom({ renderAfter: true });
  assert.deepEqual(events.slice(-4), [
    'transaction:factory/cafe24:update-form-drafts:cafe24',
    'commit',
    'save',
    'render',
  ]);

  for (const name of names.slice(1)) {
    assert.doesNotMatch(sourceFunction(syncSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }
});

test('DB model actions use product-db transactions and persist presets only after commit', () => {
  const events = [];
  const draft = {
    product: {
      dbCustomFields: [],
      dbFieldSettings: {},
      confirmedDb: {},
      finalDb: { price: '4000' },
    },
    stages: {},
    automation: {},
  };
  const names = [
    'factoryCafe24RunOwnedDraftMutation',
    'factoryAddCustomDbFieldFromRow',
    'factoryApplyFinalDbToConfirmedDb',
    'factorySaveCurrentDbPreset',
    'factoryApplyDbPreset',
  ];
  const functions = compileFunctions(syncSource, names, {
    factoryRuntimeIsOperationCurrent: () => true,
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      const result = mutate(draft);
      events.push('commit');
      return { result };
    },
    factoryDbNormalizeKey: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    uid: () => 'field-1',
    factoryDbFieldSetting(factory, id) {
      factory.product.dbFieldSettings[id] = factory.product.dbFieldSettings[id] || {};
      return factory.product.dbFieldSettings[id];
    },
    factoryUpdateFinalDbFromFields(factory) {
      return { finalDb: factory.product.finalDb, missing: [] };
    },
    factorySetStageStatus(_stage, _status, _message, factory) {
      assert.equal(factory, draft);
    },
    factoryLog(_message, _level, factory) {
      assert.equal(factory, draft);
    },
    prompt: () => '기본 프리셋',
    factoryLoadDbFieldPresets: () => [{ id: 'old', name: '예전 프리셋' }],
    factoryPresetSnapshot: () => ({ customFields: [], enabled: {} }),
    factorySaveDbFieldPresets(presets) {
      events.push(`persist:${presets[0].name}`);
    },
    scheduleLastWorkSave: () => events.push('schedule'),
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
  });

  assert.equal(functions.factoryAddCustomDbFieldFromRow({
    sourceType: 'sinhwa',
    sourceLabel: '신화사',
    key: 'material',
    value: '스테인리스',
  }), true);
  assert.equal(draft.product.dbCustomFields.length, 1);
  assert.equal(functions.factoryApplyFinalDbToConfirmedDb().finalDb.price, '4000');
  assert.equal(draft.product.confirmedDb.price, '4000');

  const preset = functions.factorySaveCurrentDbPreset();
  assert.equal(preset.name, '기본 프리셋');
  const presetCommit = events.lastIndexOf('commit');
  const presetPersist = events.lastIndexOf('persist:기본 프리셋');
  assert.ok(presetPersist > presetCommit, 'preset persistence must follow store commit');
  assert.ok(events.lastIndexOf('save') > presetPersist, 'workspace save must follow preset persistence');

  assert.equal(functions.factoryApplyDbPreset('old'), true);
  for (const command of [
    'factory/db:add-custom-field',
    'factory/db:apply-final-db',
    'factory/db:save-field-preset',
    'factory/db:apply-field-preset',
  ]) {
    assert.ok(events.includes(`transaction:${command}:product-db`), command);
  }
});

test('Cafe24 target attachment is draft-only and DB model writers have no selector fallback', () => {
  const attach = compileFunction(syncSource, 'factoryAttachCafe24ProductAsCurrentTarget');
  assert.throws(() => attach({ product_no: 1 }), /factory draft is required/);
  for (const name of [
    'factoryAttachCafe24ProductAsCurrentTarget',
    'factoryAddCustomDbFieldFromRow',
    'factoryApplyFinalDbToConfirmedDb',
    'factorySaveCurrentDbPreset',
    'factoryApplyDbPreset',
  ]) {
    assert.doesNotMatch(sourceFunction(syncSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }
});

test('app/factory sync entries transact once and thread the owned draft into nested writers', () => {
  const events = [];
  const draft = { product: { inputImages: [] }, assets: [], stages: {}, automation: {} };
  const state = {
    productName: '슬라브나비수저집',
    imageBase64: 'abc',
    imageMime: 'image/png',
    imagePreview: 'data:image/png;base64,abc',
    analysis: null,
    optionSorter: { optionResults: [] },
    cuts: { prompts: [] },
    sectionImages: {},
  };
  const functions = compileFunctions(syncSource, [
    'factoryCafe24RunOwnedDraftMutation',
    'factoryApplyProductToApp',
    'factorySyncFromCurrentState',
  ], {
    state,
    factoryRuntimeIsOperationCurrent: () => true,
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      const result = mutate(draft);
      events.push('commit');
      return { result };
    },
    currentProductImagePayload: () => ({
      base64: state.imageBase64,
      mime: state.imageMime,
      preview: state.imagePreview,
      name: '제품사진',
    }),
    imageBase64Only: value => value,
    syncProductImageAcrossWorkspaces(options) {
      assert.equal(options.factory, draft);
    },
    cloneData: value => JSON.parse(JSON.stringify(value)),
    factoryRegisterAsset(_stage, _image, meta) {
      assert.equal(meta.factory, draft);
    },
    factoryUpdateFinalDbFromFields(factory) {
      assert.equal(factory, draft);
    },
    factoryLog(_message, _level, factory) {
      assert.equal(factory, draft);
    },
    SECTIONS: [],
    getCurrentImageRunInfo: () => ({ modelLabel: '' }),
    scheduleLastWorkSave: () => events.push('schedule'),
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
    uid: () => 'factory-input-1',
  });

  assert.equal(functions.factoryApplyProductToApp(), true);
  assert.equal(draft.product.productName, undefined);
  assert.equal(draft.product.imageBase64, 'abc');
  assert.equal(draft.product.inputImages[0].name, '제품사진');
  assert.deepEqual(events.slice(0, 3), [
    'transaction:factory/runtime:apply-product-to-app:product-db',
    'commit',
    'schedule',
  ]);

  assert.equal(functions.factorySyncFromCurrentState(), true);
  assert.equal(draft.product.productName, '슬라브나비수저집');
  assert.ok(events.includes('transaction:factory/runtime:sync-current-state:factory-assets'));
  assert.equal(events.filter(event => event === 'render').length, 0);
});

test('analysis-hub sync command commits before save/render and candidate helpers are draft-only', () => {
  const events = [];
  const applyLatest = compileFunctions(syncSource, [
    'factoryCafe24RunOwnedDraftMutation',
    'factoryApplyLatestToAnalysisHub',
  ], {
    factoryRuntimeIsOperationCurrent: () => true,
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      assert.equal(typeof mutate, 'function');
      events.push('commit');
      return { result: true };
    },
    saveLastWorkNow: () => events.push('save'),
    scheduleLastWorkSave: () => events.push('schedule'),
    render: () => events.push('render'),
  }).factoryApplyLatestToAnalysisHub;
  assert.equal(applyLatest(), true);
  assert.deepEqual(events, [
    'transaction:factory/runtime:apply-latest-to-analysis:product-db',
    'commit',
    'save',
    'render',
  ]);

  const candidateDraft = { product: { dbCandidates: [], cafe24Candidates: [] } };
  const block = compileFunction(syncSource, 'factoryBlockCandidateReviewSelection', {
    factorySetStageStatus(_stage, _status, _message, factory) {
      assert.equal(factory, candidateDraft);
    },
    factoryLog(_message, _level, factory) {
      assert.equal(factory, candidateDraft);
    },
  });
  assert.equal(block(candidateDraft, 'DB', { factory: candidateDraft, render: false }), false);
  assert.match(candidateDraft.product.candidateReviewStatus, /DB 후보 선택을 중단/);

  const restore = compileFunction(syncSource, 'factoryRestoreCandidateReviewSelection', {
    factoryCandidateReviewIdentityKey: () => 'identity',
    factoryDedupeSinhwaCandidates: rows => rows,
    factoryDedupeCafe24Candidates: rows => rows,
  });
  assert.equal(restore(candidateDraft, {
    identityKey: 'identity',
    selectedDbCandidateKey: 'db-1',
    confirmedDb: { id: 1 },
    dbCandidates: [{ id: 1 }],
    dbCandidateResolution: 'selected',
  }), true);
  assert.equal(candidateDraft.product.selectedDbCandidateKey, 'db-1');

  for (const name of [
    'factoryApplyProductToApp',
    'factoryApplyLatestToAnalysisHub',
    'factorySyncFromCurrentState',
    'factoryBlockCandidateReviewSelection',
    'factoryRestoreCandidateReviewSelection',
  ]) {
    assert.doesNotMatch(sourceFunction(syncSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }
  assert.match(sourceFunction(syncSource, 'factoryApplyLatestToAnalysisHub'), /factory:\s*draft/);
});

test('analysis-hub factory import preserves explicit size units and ignores Cafe24 category assignment objects', () => {
  const functions = compileFunctions(syncSource, [
    'factoryAnalysisImportText',
    'factoryAnalysisImportFirst',
    'factoryAnalysisImportCategoryText',
    'factoryAnalysisImportCategoryFirst',
    'factoryAnalysisImportDimensionText',
    'factoryAnalysisImportDimensionHasUnit',
    'factoryAnalysisImportDimensionNumber',
    'factoryAnalysisImportDimensions',
  ], {
    factorySourceRowsValueByAliases: () => '',
    hasProductValue: value => value !== null && value !== undefined && value !== '',
  });

  const dims = functions.factoryAnalysisImportDimensions(
    { size: '가로 4.8cm x 세로 23cm' },
    { spec: { width_mm: 4.8, depth_mm: 23 } },
    [],
  );
  assert.equal(dims.width, '4.8cm');
  assert.equal(dims.depth, '23cm');
  assert.equal(dims.summary, '가로 4.8cm x 세로 23cm');

  const assignments = [
    { category_no: 71, recommend: 'F', new: 'F' },
    { category_no: 88, recommend: 'F', new: 'F' },
  ];
  assert.equal(functions.factoryAnalysisImportCategoryText(assignments), '');
  assert.equal(functions.factoryAnalysisImportCategoryFirst('', assignments, '패션잡화 > 전통 소품 주머니'), '패션잡화 > 전통 소품 주머니');
  assert.equal(functions.factoryAnalysisImportCategoryText([{ category_name: '패션잡화 > 파우치' }]), '패션잡화 > 파우치');
});

test('successful Cafe24 create immediately becomes the update target to prevent duplicate registration', () => {
  const factory = {
    product: {
      selectedCafe24CandidateKey: '',
      confirmedCafe24ProductKey: '',
      cafe24DraftProductKey: '',
    },
    openMarketSync: {
      cafe24RegistrationMode: 'create',
      cafe24RegistrationModeUserTouched: false,
    },
  };
  const promote = compileFunction(syncSource, 'factoryPromoteCreatedCafe24ProductToUpdateTarget', {
    factoryAttachCafe24ProductAsCurrentTarget(product, source, draft) {
      assert.equal(product.product_no, 2994);
      assert.match(source, /created/);
      assert.equal(draft, factory);
      draft.product.selectedCafe24CandidateKey = '2994';
      draft.product.confirmedCafe24ProductKey = '2994';
      draft.product.cafe24DraftProductKey = '2994';
      return { productNo: 2994, key: '2994' };
    },
    factoryEnsureOpenMarketSync: draft => draft.openMarketSync,
  });

  const attached = promote(
    { product_no: 2994, product_name: '방울수저집', display: 'F', selling: 'F' },
    'created:2994',
    factory,
  );

  assert.equal(attached.productNo, 2994);
  assert.equal(factory.product.selectedCafe24CandidateKey, '2994');
  assert.equal(factory.product.confirmedCafe24ProductKey, '2994');
  assert.equal(factory.product.cafe24DraftProductKey, '2994');
  assert.equal(factory.openMarketSync.cafe24RegistrationMode, 'update');
  assert.equal(factory.openMarketSync.cafe24RegistrationModeUserTouched, true);
});

test('a new workflow run resets the registration target to create until the user chooses update', () => {
  const startRun = compileFunction(appCore03Source, 'factoryStartNewWorkflowRun', {
    uid: () => 'factory_work_run:new',
  });
  const factory = {
    openMarketSync: {
      cafe24RegistrationMode: 'update',
      cafe24RegistrationModeUserTouched: true,
    },
  };

  assert.equal(startRun(factory), 'factory_work_run:new');
  assert.equal(factory.openMarketSync.cafe24RegistrationMode, 'create');
  assert.equal(factory.openMarketSync.cafe24RegistrationModeUserTouched, false);
});

test('candidate DB cleanup helpers require and preserve the caller-owned draft', () => {
  const names = [
    'factoryResetDbContextForNewCollection',
    'factoryRestoreLockedProductName',
    'factoryClearProductScopedDbManualFields',
    'factoryAutofillRequiredFieldsFromSelectedProduct',
    'factorySyncAutomationOptionModeFromDbSources',
  ];
  for (const name of names) {
    const writer = compileFunction(syncSource, name);
    assert.throws(() => writer(), /factory draft is required/, name);
    assert.doesNotMatch(sourceFunction(syncSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }

  const state = { productName: '잠금 상품명', productInfoManualValues: { sale_price: '5000', product_name: '잠금 상품명' } };
  const draft = {
    product: {
      productName: '잠금 상품명',
      userProductName: '잠금 상품명',
      confirmedDb: { id: 'db-1' },
      dbCandidates: [{ id: 'db-1' }],
      cafe24Candidates: [{ product_no: 24 }],
      pendingCafe24Candidates: [{ product_no: 25 }],
      selectedCafe24CandidateKey: '24',
      confirmedCafe24ProductKey: '24',
      cafe24CandidateResolution: 'selected',
      cafe24DraftProductKey: '24',
      dbFieldSettings: { sale_price: { manualValue: '5000' }, custom_note: { manualValue: '유지' } },
      finalDb: { product_name: '잠금 상품명', sale_price: '5000' },
    },
    automation: { optionMode: 'provided', fieldReview: { sale_price: {}, custom_note: {} } },
  };
  const clear = compileFunctions(syncSource, [
    'factoryRestoreLockedProductName',
    'factoryClearProductScopedDbManualFields',
  ], {
    state,
    FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS: ['sale_price'],
    factoryCaptureLockedProductName: () => '잠금 상품명',
    cloneData: value => JSON.parse(JSON.stringify(value)),
    factoryDbFieldSetting(factory, id) {
      factory.product.dbFieldSettings[id] = factory.product.dbFieldSettings[id] || {};
      return factory.product.dbFieldSettings[id];
    },
  }).factoryClearProductScopedDbManualFields;

  clear(draft, 'candidate-change', { preserveCafe24: true });
  assert.equal(draft.product.confirmedDb, null);
  assert.equal(draft.product.cafe24Candidates.length, 1);
  assert.equal(draft.product.selectedCafe24CandidateKey, '24');
  assert.equal(draft.product.productName, '잠금 상품명');
  assert.equal(draft.product.dbFieldSettings.sale_price, undefined);
  assert.equal(draft.product.dbFieldSettings.custom_note.manualValue, '유지');
  assert.equal(draft.automation.fieldReview.sale_price, undefined);
  assert.equal(draft.automation.fieldReview.custom_note !== undefined, true);
  assert.equal(draft.automation.optionMode, 'pending');
  assert.equal(state.productInfoManualValues.sale_price, undefined);
});

test('Cafe24 candidate-only search holds an operation lease across its async owned transaction', () => {
  const source = sourceFunction(syncSource, 'factoryRunCafe24CandidateSearchOnly');
  assert.match(source, /operationLeaseHeld\s*!==\s*true/);
  assert.match(source, /factoryRuntimeWithOperationLease\(\s*'factory\/cafe24:run-candidate-search-only'/);
  assert.match(source, /operationLeaseHeld:\s*true/);
});

test('candidate collection captures the existing Cafe24 receipt before clearing search results', () => {
  const collectAll = sourceFunction(syncSource, 'factoryCollectProductCandidatesForReview');
  const collectCafe24 = sourceFunction(syncSource, 'factoryCollectCafe24CandidatesForReviewOnly');
  const runCafe24 = sourceFunction(syncSource, 'factoryRunCafe24CandidateSearchOnly');
  const runDbStage = sourceFunction(appCore06Source, 'factoryRunDbStage');

  for (const collector of [collectAll, collectCafe24]) {
    assert.match(
      collector,
      /const previousSelection = factoryCaptureCandidateReviewSelection\(factory\);[\s\S]*factoryResetDbContextForNewCollection\(factory,/,
      'the owned collector must snapshot #2995 before clearing candidates',
    );
    assert.match(
      collector,
      /const retainedCafe24Selection = restoredSelection && !!previousSelection\.selectedCafe24CandidateKey;/,
      'a restored Cafe24 receipt must outrank candidate auto-apply',
    );
    assert.match(
      collector,
      /if \([^)]*!retainedCafe24Selection\)/,
      'candidate auto-apply must not replace the restored Cafe24 product',
    );
  }
  assert.doesNotMatch(runCafe24, /factoryResetDbContextForNewCollection\(/);
  assert.doesNotMatch(runDbStage, /factoryResetDbContextForNewCollection\(/);
});

test('Cafe24 candidate searches await persistence before reporting completion', () => {
  for (const functionName of [
    'factoryRunCafe24CandidateSearchOnly',
    'factoryRunCafe24CandidateAdditionalSearch',
  ]) {
    const source = sourceFunction(syncSource, functionName);
    assert.match(
      source,
      /await\s+saveLastWorkNow\(\{\s*sync:\s*false,\s*factory:\s*receipt\.snapshot\.factory\s*\}\)/,
      functionName,
    );
  }
});

test('final registration owns basic field draft and review changes while holding one operation lease', () => {
  const runSource = sourceFunction(appCore05Source, 'factoryRunFinalRegistration');
  assert.match(runSource, /operationLeaseHeld\s*!==\s*true/);
  assert.match(runSource, /factoryRuntimeWithOperationLease\(\s*'factory\/final-registration:run'/);
  assert.match(runSource, /operationLeaseHeld:\s*true/);
  assert.match(
    runSource,
    /await\s+saveLastWorkNow\(\{\s*sync:\s*false,\s*factory:\s*receipt\.snapshot\.factory\s*\}\)/,
    'successful Cafe24 registration must persist the committed receipt before returning',
  );

  const createPolicies = new Function(
    `${sourceFunction(appCore03Source, 'factoryRuntimeCreateCommandPolicies')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  for (const command of [
    'factory/final-registration:apply-basic-info',
    'factory/final-registration:run',
  ]) {
    const fieldReviewPart = createPolicies()[command].parts.find(part => part.owner === 'product-db'
      && part.paths.includes('automation.fieldReview'));
    assert.ok(fieldReviewPart, `${command} must own automation.fieldReview`);
    const fieldDraftsPart = createPolicies()[command].parts.find(part => part.owner === 'product-db'
      && part.paths.includes('automation.fieldDrafts'));
    assert.ok(fieldDraftsPart, `${command} must own automation.fieldDrafts`);
  }
});

test('final registration confirmation is an automation-friendly in-page dialog', () => {
  const runSource = sourceFunction(appCore05Source, 'factoryRunFinalRegistration');
  const promptSource = sourceFunction(appCore05Source, 'factoryPromptFinalRegistrationConfirmation');
  const renderSource = sourceFunction(appCore05Source, 'renderFactoryFinalRegistrationPanel');
  assert.match(runSource, /await\s+factoryPromptFinalRegistrationConfirmation\(confirmLines/);
  assert.doesNotMatch(runSource, /window\.confirm/);
  assert.match(renderSource, /data-factory-guide-action="run-final-registration"/);
  assert.match(renderSource, /onclick="return window\.factoryRunFinalRegistrationButtonInline\(this,event\)"/);
  assert.match(promptSource, /role=["']dialog["']/);
  assert.match(promptSource, /aria-modal=["']true["']/);
  assert.match(promptSource, /data-factory-final-registration-confirm=["']confirm["']/);
  assert.match(promptSource, /확인하고 등록 실행/);
});

test('final registration status shell exists before the first progress update', () => {
  const renderSource = sourceFunction(appCore05Source, 'renderFactoryFinalRegistrationPanel');
  const patchSource = sourceFunction(appCore05Source, 'factoryPatchFinalRegistrationStatusInPlace');
  assert.match(renderSource, /data-final-registration-status-box/);
  assert.doesNotMatch(renderSource, /shownStatus\s*\?\s*`<div data-final-registration-status-box/);
  assert.match(patchSource, /statusBox\.style\.display\s*=\s*'block'/);
});

test('detail HTML images use the Cafe24 description-image upload resource', () => {
  const uploadSource = sourceFunction(syncSource, 'factoryUploadCafe24DetailInlineImages');
  assert.match(uploadSource, /['"]\/api\/v2\/admin\/products\/images['"]/);
  assert.match(uploadSource, /body:\s*\{\s*request:\s*null,/);
  assert.match(uploadSource, /requests:\s*payloadImages\.map\(image\s*=>\s*\(\{\s*image\s*\}\)\)/);
  assert.doesNotMatch(uploadSource, /body:\s*\{\s*image:/);
  assert.doesNotMatch(uploadSource, /\/additionalimages/);
});

test('final registration update mode finishes detail HTML and product image synchronization', () => {
  const runSource = sourceFunction(appCore05Source, 'factoryRunFinalRegistration');
  assert.match(runSource, /factoryPublishCafe24ScopedDetailHtml\s*\(/);
  assert.match(runSource, /factoryRunCafe24PostCreateSync\s*\(/);
  assert.match(runSource, /Cafe24 기존 상품 후속 등록 검증 완료/);
});

test('final registration can recover the latest exact-name Cafe24 product through a visible control', () => {
  const renderSource = sourceFunction(appCore05Source, 'renderFactoryFinalRegistrationPanel');
  const bindSource = sourceFunction(appCore05Source, 'bindFactoryOpenMarketEvents');
  const recoverSource = sourceFunction(appCore05Source, 'factoryResumeLatestExactCafe24Product');
  const guideSource = sourceFunction(appCore03Source, 'factoryRuntimePublishGuideAction');
  assert.match(renderSource, /data-factory-resume-exact-cafe24-product/);
  assert.match(renderSource, /data-factory-guide-action="resume-exact-cafe24-product"/);
  assert.match(renderSource, /동일명 최신 Cafe24 상품 이어서 수정/);
  assert.match(bindSource, /resumeButton\.dataset\.factoryGuideAction/);
  assert.match(recoverSource, /factoryFindLiveCafe24ProductByExactName\s*\(/);
  assert.match(recoverSource, /factoryAttachCafe24ProductAsCurrentTarget\s*\(/);
  assert.match(recoverSource, /cafe24RegistrationMode\s*=\s*'update'/);
  assert.match(
    recoverSource,
    /await\s+saveLastWorkNow\(\{\s*sync:\s*false,\s*factory:\s*receipt\.snapshot\.factory\s*\}\)/,
    'exact-name recovery must persist its committed Cafe24 target before returning',
  );
  assert.match(guideSource, /action === 'resume-exact-cafe24-product'/);
  assert.match(guideSource, /factoryResumeLatestExactCafe24Product\s*\(/);
  assert.match(guideSource, /action === 'run-final-registration'/);
  assert.match(guideSource, /factoryRunFinalRegistration\s*\(/);
});

test('dynamic final registration actions have a persistent document-level click fallback', () => {
  const handlerSource = sourceFunction(appCore06Source, 'handleFactoryFinalRegistrationDelegatedClick');
  const resumeInlineSource = sourceFunction(appCore06Source, 'factoryResumeExactCafe24ButtonInline');
  const runInlineSource = sourceFunction(appCore06Source, 'factoryRunFinalRegistrationButtonInline');
  const bindSource = sourceFunction(appCore06Source, 'bindClassicRuntimeDocumentEvents');
  assert.match(handlerSource, /data-factory-resume-exact-cafe24-product/);
  assert.match(handlerSource, /factoryResumeLatestExactCafe24Product\s*\(/);
  assert.match(handlerSource, /#factoryRunFinalRegistration/);
  assert.match(handlerSource, /factoryRunFinalRegistration\s*\(/);
  assert.match(resumeInlineSource, /factoryResumeLatestExactCafe24Product\s*\(/);
  assert.match(runInlineSource, /factoryRunFinalRegistration\s*\(/);
  assert.match(appCore06Source, /window\.factoryResumeExactCafe24ButtonInline\s*=\s*factoryResumeExactCafe24ButtonInline/);
  assert.match(appCore06Source, /window\.factoryRunFinalRegistrationButtonInline\s*=\s*factoryRunFinalRegistrationButtonInline/);
  assert.match(bindSource, /addEventListener\('click', handleFactoryFinalRegistrationDelegatedClick, true\)/);
  assert.match(bindSource, /removeEventListener\('click', handleFactoryFinalRegistrationDelegatedClick, true\)/);
});

test('startup detail pruning never reads app state before state initialization', () => {
  let completenessReads = 0;
  const prune = compileFunction(appCore03Source, 'factoryRuntimePruneAsset', {
    factoryAppStateReady: false,
    factoryRuntimeArchiveImageUrl: () => '',
    factoryInlineImageLooksHeavy: () => false,
    factorySanitizeHeavyInlineHolder: value => value,
    factoryCurrentDetailSectionsComplete: () => {
      completenessReads += 1;
      throw new ReferenceError("Cannot access 'state' before initialization");
    },
  });
  const html = '<section>복구 대상</section>'.repeat(1200);
  const pruned = prune({ stageId: 'detail', html }, true);
  assert.equal(completenessReads, 0);
  assert.equal(pruned.html, html);
});

test('selected detail HTML stays intact even when the current sections look complete', () => {
  const prune = compileFunction(appCore03Source, 'factoryRuntimePruneAsset', {
    factoryAppStateReady: true,
    factoryRuntimeArchiveImageUrl: () => '',
    factoryInlineImageLooksHeavy: () => false,
    factorySanitizeHeavyInlineHolder: value => value,
    factoryCurrentDetailSectionsComplete: () => true,
  });
  const html = `${'<img src="data:image/png;base64,full">'.repeat(14)}${'x'.repeat(25000)}`;
  const pruned = prune({ stageId: 'detail', html }, true);
  assert.equal(pruned.html, html);
  assert.equal(pruned.hasHtml, undefined);
});

test('background Cafe24 save verification keeps one operation token and commits before save/render', async () => {
  const events = [];
  const token = { workspaceId: 'work-1', operationId: 'save-1' };
  const draft = { product: { cafe24Candidates: [] } };
  let scheduled = null;
  let transactionPromise = null;
  const functions = compileFunctions(syncSource, [
    'factoryCafe24CaptureOperationToken',
    'factoryCafe24RunOwnedDraftMutation',
    'factoryStartCafe24SaveVerificationInBackground',
  ], {
    CAFE24_CONTROL_API: { defaultMallId: 'mall-1' },
    factoryRuntimeRequireStore() {
      return {
        getOperationToken() {
          events.push('capture-token');
          return token;
        },
      };
    },
    factoryRuntimeIsOperationCurrent(received) {
      assert.equal(received, token);
      events.push('token-current');
      return true;
    },
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      transactionPromise = Promise.resolve(mutate(draft)).then(result => {
        events.push('commit');
        return { result };
      });
      return transactionPromise;
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 0);
      events.push('schedule');
      scheduled = callback;
    },
    async factoryWaitForCafe24ProductEcho(productNo, mallId) {
      assert.equal(productNo, 2534);
      assert.equal(mallId, 'mall-1');
      events.push('echo');
      return {
        detail: { product_no: 2534, product_name: '슬라브나비수저집' },
        verification: { checked: 1, matched: 1, missing: [], mismatches: [] },
      };
    },
    factoryMergeCafe24Candidates(current, additions) {
      return [...current, ...additions];
    },
    normalizeCafe24ProductCandidate: detail => detail,
    factoryCafe24SaveVerificationRecord: value => value,
    factoryRememberCafe24SyncResult(factory, key, value) {
      assert.equal(factory, draft);
      factory.product.syncResult = { key, value };
    },
    factoryCafe24FieldLabelByApiField: value => value,
    factoryLog(_message, _level, factory) {
      assert.equal(factory, draft);
      events.push('log');
    },
    saveLastWorkNow(options) {
      events.push(`save:${options?.sync}`);
    },
    render() {
      events.push('render');
    },
  });

  functions.factoryStartCafe24SaveVerificationInBackground({
    productNo: 2534,
    product: { product_name: '슬라브나비수저집' },
  });
  assert.equal(typeof scheduled, 'function');
  scheduled();
  await transactionPromise;
  await Promise.resolve();

  assert.match(draft.product.cafe24ApiStatus, /반영완료/);
  assert.equal(draft.product.cafe24Candidates.length, 1);
  assert.deepEqual(events, [
    'capture-token',
    'schedule',
    'token-current',
    'transaction:factory/cafe24:save-product:cafe24',
    'echo',
    'log',
    'commit',
    'save:false',
    'render',
  ]);
  assert.doesNotMatch(
    sourceFunction(syncSource, 'factoryStartCafe24SaveVerificationInBackground'),
    /factoryRuntimeReadFactory\s*\(/,
  );
});

test('Cafe24 candidate rerank mutates only the delayed owned draft', async () => {
  const events = [];
  const token = { workspaceId: 'work-1', operationId: 'rerank-1' };
  const outerDraft = { product: { selectedCafe24CandidateKey: '' } };
  const ownedDraft = {
    product: {
      cafe24RerankKey: 'rerank-key',
      cafe24RerankRunning: true,
      selectedCafe24CandidateKey: '',
      naturalHint: '나비 수저집',
    },
  };
  const snapshot = { product: { cafe24RerankKey: 'rerank-key' } };
  let scheduled = null;
  let transactionPromise = null;
  const candidates = [{ id: 'a', score: 10 }, { id: 'b', score: 20 }];
  const functions = compileFunctions(syncSource, [
    'factoryCafe24CaptureOperationToken',
    'factoryCafe24RunOwnedDraftMutation',
    'factoryStartCafe24CandidateRerank',
  ], {
    getAnalysisMatchSettings: () => ({ cafe24RankEngine: 'gpt' }),
    normalizeAnalysisAiEngine: () => 'gpt',
    factoryCafe24RerankKey: () => 'rerank-key',
    getAnalysisEngineRunInfo: () => ({ providerLabel: 'GPT' }),
    setTimeout(callback, delay) {
      assert.equal(delay, 0);
      scheduled = callback;
    },
    factoryRuntimeReadFactory() {
      events.push('read-preflight');
      return snapshot;
    },
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => token }),
    factoryRuntimeIsOperationCurrent(received) {
      assert.equal(received, token);
      return true;
    },
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      events.push(`transaction:${command}:${owner}`);
      transactionPromise = Promise.resolve(mutate(ownedDraft)).then(result => {
        events.push('commit');
        return { result };
      });
      return transactionPromise;
    },
    getCafe24CandidateImageAttachLimit: () => 2,
    selectCafe24CandidatesForImagePayloads: rows => rows,
    fetchCafe24CandidateImagePayloads: async () => ({ payloads: [] }),
    rerankCafe24CandidatesWithGpt: async (_terms, rows) => ({
      candidates: rows,
      engineLabel: 'GPT',
      warning: '',
    }),
    factoryDedupeCafe24Candidates: rows => rows,
    factoryCandidateScore: candidate => candidate.score,
    factorySlimReviewCandidateList: rows => rows,
    factoryUpdateCandidateReviewStageStatus(factory) {
      assert.equal(factory, ownedDraft);
      events.push('stage');
    },
    factoryLog(_message, _level, factory) {
      assert.equal(factory, ownedDraft);
    },
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
  });

  functions.factoryStartCafe24CandidateRerank(['나비 수저집'], candidates, { factory: outerDraft });
  assert.equal(outerDraft.product.cafe24RerankRunning, true);
  assert.equal(typeof scheduled, 'function');
  scheduled();
  for (let index = 0; index < 20 && !transactionPromise; index += 1) await Promise.resolve();
  assert.ok(transactionPromise, 'owned rerank transaction starts after external image/LLM work resolves');
  await transactionPromise;
  await Promise.resolve();

  assert.equal(ownedDraft.product.cafe24RerankRunning, false);
  assert.equal(ownedDraft.product.pendingCafe24Candidates[0].id, 'b');
  assert.equal(outerDraft.product.pendingCafe24Candidates, undefined);
  assert.deepEqual(events, [
    'read-preflight',
    'transaction:factory/cafe24:rerank-candidates:cafe24',
    'stage',
    'commit',
    'save',
    'render',
  ]);
});

test('size review and no-candidate actions use exact owners and save only after commit', () => {
  const events = [];
  const drafts = {
    'factory/db:schedule-size-cut-review': { product: {}, automation: {}, stages: {} },
    'factory/db:confirmNoDbCandidate': {
      product: { productName: '슬라브나비수저집', confirmedDb: { id: 1 } },
      automation: {},
      stages: {},
    },
    'factory/db:confirmNoCafe24Candidate': {
      product: { productName: '슬라브나비수저집', selectedCafe24CandidateKey: '2534' },
      automation: {},
      stages: {},
    },
    'factory/db:clearDbCandidateSelection': {
      product: {
        productName: '슬라브나비수저집',
        confirmedDb: { id: 1 },
        selectedDbCandidateKey: 'db-1',
        dbCandidateResolution: 'selected',
        dbCandidates: [{ id: 'db-1' }],
        pendingDbCandidates: [{ id: 'db-1' }],
      },
      automation: {},
      stages: {},
    },
    'factory/db:clearCafe24CandidateSelection': {
      product: {
        productName: '슬라브나비수저집',
        selectedCafe24CandidateKey: '2534',
        confirmedCafe24ProductKey: '2534',
        cafe24DraftProductKey: '2534',
        cafe24CandidateResolution: 'selected',
        cafe24Candidates: [{ product_no: '2534' }],
        pendingCafe24Candidates: [{ product_no: '2534' }],
      },
      automation: {},
      stages: {},
    },
  };
  let activeCommand = '';
  const functions = compileFunctions(syncSource, [
    'factoryCafe24RunOwnedDraftMutation',
    'factoryScheduleSizeCutAfterCandidateConfirm',
    'factoryConfirmNoDbCandidate',
    'factoryConfirmNoCafe24Candidate',
    'factoryClearDbCandidateSelection',
    'factoryClearCafe24CandidateSelection',
  ], {
    state: { productName: '슬라브나비수저집' },
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      activeCommand = command;
      const expectedOwner = command === 'factory/db:schedule-size-cut-review'
        ? 'factory-assets'
        : 'product-db';
      assert.equal(owner, expectedOwner);
      events.push(`transaction:${command}:${owner}`);
      const result = mutate(drafts[command]);
      events.push(`commit:${command}`);
      activeCommand = '';
      return { result };
    },
    factoryHasSizeFacts: () => false,
    factorySetStageStatus(_stage, _status, _message, factory) {
      assert.equal(factory, drafts[activeCommand]);
    },
    factoryCaptureLockedProductName: factory => factory.product.productName,
    factoryRestoreLockedProductName(factory, productName) {
      assert.equal(factory, drafts[activeCommand]);
      factory.product.productName = productName;
    },
    factoryUpdateFinalDbFromFields(factory) {
      assert.equal(factory, drafts[activeCommand]);
      factory.product.finalDbUpdated = true;
    },
    factorySyncAutomationOptionModeFromDbSources(factory) {
      assert.equal(factory, drafts[activeCommand]);
      factory.automation.optionMode = 'pending';
    },
    factoryUpdateCandidateReviewStageStatus(factory) {
      assert.equal(factory, drafts[activeCommand]);
    },
    factoryResetCafe24DraftsForProduct(factory) {
      assert.equal(factory, drafts[activeCommand]);
      factory.product.cafe24DraftReset = true;
    },
    factoryLog(_message, _level, factory) {
      assert.equal(factory, drafts[activeCommand]);
      events.push(`log:${activeCommand}`);
    },
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
  });

  assert.equal(functions.factoryScheduleSizeCutAfterCandidateConfirm(), false);
  assert.equal(functions.factoryConfirmNoDbCandidate(), true);
  assert.equal(functions.factoryConfirmNoCafe24Candidate(), true);
  assert.equal(functions.factoryClearDbCandidateSelection(), true);
  assert.equal(functions.factoryClearCafe24CandidateSelection(), true);

  assert.equal(drafts['factory/db:schedule-size-cut-review'].automation.lastAutoSizeRunKey, '');
  assert.equal(drafts['factory/db:confirmNoDbCandidate'].product.dbCandidateResolution, 'none');
  assert.equal(drafts['factory/db:confirmNoCafe24Candidate'].product.cafe24CandidateResolution, 'none');
  assert.equal(drafts['factory/db:confirmNoCafe24Candidate'].product.cafe24DraftReset, true);
  assert.equal(drafts['factory/db:clearDbCandidateSelection'].product.selectedDbCandidateKey, '');
  assert.equal(drafts['factory/db:clearDbCandidateSelection'].product.dbCandidateResolution, '');
  assert.equal(drafts['factory/db:clearDbCandidateSelection'].product.pendingDbCandidates.length, 1);
  assert.equal(drafts['factory/db:clearCafe24CandidateSelection'].product.selectedCafe24CandidateKey, '');
  assert.equal(drafts['factory/db:clearCafe24CandidateSelection'].product.cafe24CandidateResolution, '');
  assert.equal(drafts['factory/db:clearCafe24CandidateSelection'].product.pendingCafe24Candidates.length, 1);
  assert.equal(events.filter(event => event === 'save').length, 5);
  assert.equal(events.filter(event => event === 'render').length, 5);
  for (const command of Object.keys(drafts)) {
    const commitIndex = events.indexOf(`commit:${command}`);
    const nextSaveIndex = events.indexOf('save', commitIndex);
    assert.ok(commitIndex >= 0, command);
    assert.ok(nextSaveIndex > commitIndex, `${command} must save after commit`);
  }
  for (const name of [
    'factoryScheduleSizeCutAfterCandidateConfirm',
    'factoryConfirmNoDbCandidate',
    'factoryConfirmNoCafe24Candidate',
    'factoryClearDbCandidateSelection',
    'factoryClearCafe24CandidateSelection',
  ]) {
    assert.doesNotMatch(sourceFunction(syncSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }
});
