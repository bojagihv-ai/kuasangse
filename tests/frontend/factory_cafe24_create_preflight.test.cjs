'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { functionSource, readSourceLf } = require('./source_slice_utils.cjs');

const ROOT = path.resolve(__dirname, '../..');
const CORE = readSourceLf(path.join(ROOT, 'src/app-core-03.js'));
const PAYLOADS = readSourceLf(path.join(ROOT, 'src/cafe24-payloads.js'));
const SECTIONS = readSourceLf(path.join(ROOT, 'src/app-core-02.js'));
const FINAL = readSourceLf(path.join(ROOT, 'src/app-core-05.js'));
const INFO = '고른 최종 A컷을 등록 본문으로 사용합니다.';

function install(context, source, names) {
  for (const name of names) {
    const code = functionSource(source, name);
    assert.ok(code, `missing real function: ${name}`);
    vm.runInContext(code, context, { filename: `production-source#${name}` });
  }
}

function fixture(mode = 'create', productNo = '') {
  const factory = {
    workspace: { id: 'preflight-work' },
    openMarketSync: { cafe24RegistrationMode: mode },
    automation: { optionMode: 'provided', currentRunId: 'run-1' },
    product: {
      currentProductKey: 'product-1', inputImageFingerprint: 'fingerprint-1',
      finalDb: { product_no: productNo, category: [{ category_no: '107' }] },
      cafe24ReferenceLists: { categories: [{ code: '107', name: '주방용품' }] },
      cafe24OptionGroupsDraft: [{ name: '색상', values: ['초록', '노랑'] }],
    },
    assets: [{ id: 'hero-1', type: 'image', stageId: 'hero', used: true, image: 'hero.jpg' }],
  };
  const detail = { html: '<main><img src="detail.jpg"></main>', source: 'detail-asset-selected', message: INFO };
  const revision = { scopeId: 'project:preflight-work', counter: 19 };
  const forbidden = () => assert.fail('preflight must not invoke external I/O or a write planner');
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder,
    state: { currentProjectId: 'preflight-work' },
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryCurrentProductKey: value => value.product.currentProductKey,
    factoryCurrentInputImageFingerprint: value => value.product.inputImageFingerprint,
    factoryCafe24TargetInfo: value => ({ productNo: value.product.finalDb.product_no }),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => revision,
    factoryRuntimeResolveCafe24Category: async value => context.factoryRuntimeCafe24CategorySelection(value),
    factoryCafe24CurrentScopedDetailHtml: () => detail,
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => ({ revision: 19, fence: 1 }) }),
    factoryControlPreflightCache: { read: (_key, load) => load() },
    factoryControlAssetStage: (_factory, key) => ({ key, candidates: [], selectedIds: [] }),
    factoryControlSectionStage: () => ({ key: 'sections', candidates: [], selectedIds: [] }),
    factoryProjectFileImageFingerprint: value => value,
    factoryControlProjectionSequence: 0,
    factoryControlInputGroups: () => [], factoryControlProgress: () => ({}),
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryFinalRegistrationSettings: value => value.openMarketSync,
    factoryBuildCafe24OptionSyncPlan: forbidden,
    fetch: forbidden, callCafe24Console: forbidden, fetchCafe24ProductDetailByNo: forbidden,
  });
  install(context, CORE, [
    'factoryCurrentWorkflowRunId', 'factoryRuntimeCafe24CategorySelection',
    'factoryRuntimeSha256Text', 'factoryRuntimeBatchImageReferences',
    'factoryRuntimeBatchCafe24Binding', 'factoryRuntimeBatchCafe24BindingMatches',
    'factoryRuntimeInspectBatchCafe24Registration', 'factoryRuntimeControlProjection',
  ]);
  install(context, FINAL, ['factoryFinalRegistrationCafe24Model']);
  return { factory, detail, revision, context };
}

test('PIN update with an existing target keeps its ready identity and normalized options', async t => {
  const { context, factory } = fixture('update', '3011'); // Given
  const before = structuredClone(factory);
  const result = await context.factoryRuntimeInspectBatchCafe24Registration(); // When
  const projection = await context.factoryRuntimeControlProjection();
  t.diagnostic(JSON.stringify({ status: result.status, productId: result.productId, blockers: projection.registration.blockers }));
  assert.equal(result.status, 'ready'); // Then
  assert.equal(result.reason, '');
  assert.equal(result.productId, 'cafe24:3011');
  assert.equal(result.productId, projection.session.productId);
  assert.deepEqual(Array.from(result.optionValues), ['초록', '노랑']);
  assert.equal(result.variantCount, 2);
  assert.equal(result.inventoryQuantity, '99');
  assert.equal(projection.registration.status, 'approval_required');
  assert.equal(context.factoryFinalRegistrationCafe24Model(factory).canRun, true);
  assert.deepEqual(factory, before);
});

test('create without a remote number matches the existing create path and projection identity', async t => {
  const { context, factory } = fixture(); // Given
  const before = structuredClone(factory);
  const existing = context.factoryFinalRegistrationCafe24Model(factory, { createModel: { fieldNames: ['product_name', 'price'], requiredMissing: [] } });
  const result = await context.factoryRuntimeInspectBatchCafe24Registration(); // When
  const projection = await context.factoryRuntimeControlProjection();
  t.diagnostic(JSON.stringify({ existingCanRun: existing.canRun, status: result.status, reason: result.reason, productId: result.productId, projectionProductId: projection.session.productId, blockers: projection.registration.blockers }));
  assert.equal(existing.canRun, true); // Then
  assert.equal(result.status, 'ready');
  assert.equal(result.reason, '');
  assert.equal(result.productId, 'factory:product-1');
  assert.equal(result.productId, projection.session.productId);
  assert.equal(result.productId, projection.registration.productId);
  assert.deepEqual(Array.from(projection.registration.blockers), []);
  assert.equal(projection.registration.status, 'approval_required');
  assert.equal(projection.registration.approvalTokenState, 'missing');
  assert.deepEqual(factory, before);
});

for (const mode of ['create', 'auto', '']) {
  test(`PIN ${mode || 'unset'} with a remote reference preserves projection identity`, async () => {
    const { context } = fixture(mode, '2994'); // Given
    const result = await context.factoryRuntimeInspectBatchCafe24Registration(); // When
    const projection = await context.factoryRuntimeControlProjection();
    assert.equal(result.status, 'ready'); // Then
    assert.equal(result.productId, 'cafe24:2994');
    assert.equal(result.productId, projection.registration.productId);
    assert.equal(projection.registration.status, 'approval_required');
  });
}

for (const mode of ['update', 'auto', '', 'unknown']) {
  test(`PIN ${mode || 'unset'} without a remote target stays fail-closed`, async () => {
    const { context } = fixture(mode); // Given
    const result = await context.factoryRuntimeInspectBatchCafe24Registration(); // When
    const projection = await context.factoryRuntimeControlProjection();
    assert.equal(result.status, 'blocked'); // Then
    assert.equal(projection.registration.status, 'blocked');
    assert.ok(projection.registration.blockers.includes('product_id'));
  });
}

const missingCases = [
  ['product key', value => { value.factory.product.currentProductKey = ''; }],
  ['run id', value => { value.factory.automation.currentRunId = ''; }],
  ['fingerprint', value => { value.factory.product.inputImageFingerprint = ''; }],
  ['revision', value => { value.revision.counter = 'invalid'; }],
  ['HTML', value => { value.detail.html = '  '; value.detail.message = ''; value.detail.source = ''; }],
  ['images', value => { value.factory.assets = []; }],
  ['provided options', value => { value.factory.product.cafe24OptionGroupsDraft = []; }],
  ['blank options', value => { value.factory.product.cafe24OptionGroupsDraft[0].values = ['  ']; }],
  ['category', value => { value.factory.product.finalDb.category = []; }],
  ['blocked detail', value => { value.detail.blocked = true; value.detail.message = 'detail rejected'; }],
];
for (const [name, remove] of missingCases) {
  test(`create stays fail-closed for missing or invalid ${name}`, async () => {
    const value = fixture(); // Given
    remove(value);
    const result = await value.context.factoryRuntimeInspectBatchCafe24Registration(); // When
    const projection = await value.context.factoryRuntimeControlProjection();
    assert.equal(result.status, 'blocked'); // Then
    assert.notEqual(result.reason, INFO);
    assert.notEqual(result.reason, 'detail-asset-selected');
    assert.ok(result.reason);
    assert.equal(projection.registration.status, 'blocked');
  });
}

test('create allows no options only when the existing option mode does not require them', async () => {
  const { context, factory } = fixture(); // Given
  factory.automation.optionMode = 'none';
  factory.product.cafe24OptionGroupsDraft = [];
  const result = await context.factoryRuntimeInspectBatchCafe24Registration(); // When
  assert.equal(result.status, 'ready'); // Then
  assert.equal(result.variantCount, 0);
});

for (const [name, remove] of missingCases.filter(([name]) => ['category', 'blocked detail'].includes(name))) {
  test(`an existing update target cannot bypass invalid ${name}`, async () => {
    const value = fixture('update', '3011'); // Given
    remove(value);
    const result = await value.context.factoryRuntimeInspectBatchCafe24Registration(); // When
    assert.equal(result.status, 'blocked'); // Then
    assert.notEqual(result.reason, INFO);
  });
}

for (const field of ['currentRunId', 'productKey', 'inputImageFingerprint']) {
  test(`PIN actual scoped HTML rejects foreign ${field} before create preflight`, async () => {
    const { context } = fixture(); // Given
    const scope = { currentRunId: 'run-1', productKey: 'product-1', inputImageFingerprint: 'fingerprint-1' };
    context.state.sectionWorkScope = { ...scope, [field]: 'foreign' };
    context.sectionWorkScopeMeta = () => scope;
    context.factoryCurrentPreviewSectionStatus = () => ({ requiredSections: [{ id: 's1' }, { id: 's2' }], requiredIds: ['s1', 's2'], generatedIds: ['s1'], generated: 1 });
    context.buildExportHtml = () => assert.fail('foreign scope cannot export HTML');
    install(context, SECTIONS, ['normalizeSectionScopeKeyPart', 'sectionWorkScopeMatchesForDetailTransfer']);
    install(context, PAYLOADS, ['factoryCafe24ResolveSectionScopeCheck', 'factoryCafe24CurrentScopedDetailHtml']);
    const result = await context.factoryRuntimeInspectBatchCafe24Registration(); // When
    const projection = await context.factoryRuntimeControlProjection();
    assert.equal(result.status, 'blocked'); // Then
    assert.equal(result.htmlDigest, '');
    assert.equal(projection.registration.status, 'blocked');
    assert.ok(projection.registration.blockers.includes('html_digest'));
  });
}
