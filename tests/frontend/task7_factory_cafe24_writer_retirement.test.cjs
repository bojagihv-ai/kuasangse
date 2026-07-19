'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const appCore04Source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-04.js'), 'utf8');
const payloadSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-payloads.js'), 'utf8');
const productFormSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-product-form.js'), 'utf8');
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
  };
  let activeCommand = '';
  const functions = compileFunctions(syncSource, [
    'factoryCafe24RunOwnedDraftMutation',
    'factoryScheduleSizeCutAfterCandidateConfirm',
    'factoryConfirmNoDbCandidate',
    'factoryConfirmNoCafe24Candidate',
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

  assert.equal(drafts['factory/db:schedule-size-cut-review'].automation.lastAutoSizeRunKey, '');
  assert.equal(drafts['factory/db:confirmNoDbCandidate'].product.dbCandidateResolution, 'none');
  assert.equal(drafts['factory/db:confirmNoCafe24Candidate'].product.cafe24CandidateResolution, 'none');
  assert.equal(drafts['factory/db:confirmNoCafe24Candidate'].product.cafe24DraftReset, true);
  assert.equal(events.filter(event => event === 'save').length, 3);
  assert.equal(events.filter(event => event === 'render').length, 3);
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
  ]) {
    assert.doesNotMatch(sourceFunction(syncSource, name), /factoryRuntimeReadFactory\s*\(/, name);
  }
});
