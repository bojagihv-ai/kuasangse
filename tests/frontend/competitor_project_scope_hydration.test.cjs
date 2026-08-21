'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = CORE.indexOf(startMarker);
  const end = CORE.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable: ${startMarker}`);
  return CORE.slice(start, end);
}

test('same-work project snapshot is accepted when factory already carries project identity', () => {
  const scopeSource = sourceBetween(
    'function getCurrentLastWorkWorkspaceScope(',
    'function lastWorkSnapshotMatchesTakeoverWorkspace(',
  );
  const migrationBoundarySource = sourceBetween(
    'function currentBranchDocumentMigrationBoundary(',
    'function productImageBackupStorageId(',
  );
  const context = vm.createContext({
    state: {
      currentProjectId: '',
      factory: { workspace: { id: 'project_msnytli6_aj7z33' } },
    },
    factoryRuntimeReadFactory: () => context.state.factory,
    getStoredLastWorkDraftScope: () => 'draft:tab',
    workspacePersistenceApi: () => ({
      normalizeWorkspaceScope: value => String(value || ''),
      normalizeProjectScope: value => `project:${String(value || '').replace(/^project:/i, '')}`,
      createWorkBranch: ({ branchId, scopeId, documentScopeId }) => ({
        branchId, scopeId, documentScopeId,
      }),
      validateSnapshotIdentity: () => ({ ok: true, documentScopeId: 'project:project_msnytli6_aj7z33' }),
    }),
  });
  vm.runInContext(`${scopeSource}
    ${migrationBoundarySource}
    globalThis.matches = lastWorkSnapshotMatchesCurrentWorkspace;`, context);

  assert.equal(context.matches({
    workspaceScope: { id: 'project:project_msnytli6_aj7z33' },
  }), true);
});

test('compatible product suffix does not clear the restored competitor market', () => {
  const start = CORE.indexOf('function repairRestoredSessionIdentityDrift(');
  const end = CORE.indexOf('async function migrateDocumentSessionAssetsToCurrentBranch(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    state: {
      productName: '모시꽃수파우치3',
      compPage: { marketScrape: { productName: '모시꽃수파우치', vmResults: [{ id: 'vm-1' }] } },
      productInfoManualValues: {},
      dbMatchCandidates: [],
      storageWarning: '',
    },
    factoryNormalizeIdentityText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKeysCompatible: (left, right) => {
      const a = String(left || '');
      const b = String(right || '');
      return a === b || a.includes(b) || b.includes(a);
    },
    factoryProductScopedFieldIdsForRepair: () => [],
    factoryObjectConflictsWithIdentity: () => false,
  });
  vm.runInContext(`${CORE.slice(start, end)}
    globalThis.repair = repairRestoredSessionIdentityDrift;`, context);

  context.repair('asset-payload', {
    product: { productName: '모시꽃수파우치3', userProductName: '모시꽃수파우치3' },
  });
  assert.equal(context.state.compPage.marketScrape.vmResults.length, 1);
});

test('same work fingerprint accepts compatible product suffix at the identity boundary', () => {
  const boundarySource = sourceBetween(
    'function validateIncomingWorkspaceBoundary(',
    'const FACTORY_LAST_SNAPSHOT_RECOVERY_KEY',
  );
  const context = vm.createContext({
    state: {
      workIdentity: {
        initialProductKey: '모시꽃수파우치3',
        initialInputImageFingerprint: 'fp-1',
      },
      storageWarning: '',
    },
    workspacePersistenceApi: () => ({
      validateSnapshotIdentity: () => ({
        ok: true,
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'fp-1',
        identity: { instanceId: 'same-work' },
      }),
      workIdentitiesMatch: () => true,
    }),
    lastWorkIdentityKeysCompatible: (left, right) => {
      const a = String(left || '');
      const b = String(right || '');
      return a === b || a.includes(b) || b.includes(a);
    },
  });
  vm.runInContext(`${boundarySource}\n    globalThis.validate = validateIncomingWorkspaceBoundary;`, context);

  const result = context.validate({
    workspaceScope: { id: 'project:project_msnytli6_aj7z33' },
    productName: '모시꽃수파우치',
  });
  assert.equal(result.ok, true);
  assert.equal(context.state.storageWarning, '');
});

test('same product and input candidate survives a regenerated competitor run prefix', () => {
  const start = CORE_05.indexOf('function compMarketWorkKeysCompatible(');
  const end = CORE_05.indexOf('function compMarketWorkScopeMatchesCurrent(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(`${CORE_05.slice(start, end)}\n globalThis.compatible = compMarketWorkKeysCompatible;`, context);

  assert.equal(context.compatible(
    'factory_work_run_new::모시꽃수파우치::same-input::competitors',
    'factory_work_run_old::모시꽃수파우치::same-input::competitors',
  ), true);
});

test('same product input and stage survives a regenerated candidate run id', () => {
  const helperStart = CORE_05.indexOf('function compMarketWorkKeysCompatible(');
  const helperEnd = CORE_05.indexOf('function compMarketWorkScopeMatchesCurrent(', helperStart);
  const matcherStart = CORE_05.indexOf('function compMarketCandidateMatchesCurrentWork(');
  const matcherEnd = CORE_05.indexOf('function compMarketFilterCandidatesForCurrentWork(', matcherStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && matcherStart >= 0 && matcherEnd > matcherStart);
  const current = {
    scopeKey: 'factory_work_run_new::모시꽃수파우치::fp-1::competitors',
    currentRunId: 'factory_work_run_new',
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    productName: '모시꽃수파우치',
  };
  const candidate = {
    id: 'coupang-1',
    title: '전통 모시 꽃 자수 파우치',
    factoryWorkKey: 'factory_work_run_old::모시꽃수파우치::fp-1::competitors',
    currentRunId: 'factory_work_run_old',
    factoryProductKey: '모시꽃수파우치',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    workProductName: '모시꽃수파우치',
  };
  const context = vm.createContext({
    compMarketIsUsableCandidate: () => true,
    compMarketCurrentWorkScope: () => current,
    compMarketCurrentScopeHasAnyKey: () => true,
    compMarketCurrentScopeIsComplete: () => true,
    compMarketHasWorkPayloadStamp: () => true,
    compMarketScopeKeyText: value => String(value || ''),
    compMarketCandidateTitleText: item => String(item?.title || ''),
    compMarketCandidateNativeText: () => '',
    compMarketCandidateNormalizeText: value => String(value || '').replace(/\\s+/g, '').toLowerCase(),
    compMarketCandidateQueryTexts: () => [],
    compMarketTextLooksForeignForCurrent: () => false,
    compMarketTextCompatible: () => true,
    compMarketProductCategoryTokens: () => [],
  });
  vm.runInContext(`${CORE_05.slice(helperStart, helperEnd)}\n${CORE_05.slice(matcherStart, matcherEnd)}\n globalThis.matches = compMarketCandidateMatchesCurrentWork;`, context);

  assert.equal(context.matches(candidate, current, { allowHistoricalRun: true }), true);
});

test('same product and input survives the live work-instance prefix at render boundary', () => {
  const helperStart = CORE_05.indexOf('function compMarketWorkKeysCompatible(');
  const helperEnd = CORE_05.indexOf('function compMarketWorkScopeMatchesCurrent(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const context = vm.createContext({});
  vm.runInContext(`${CORE_05.slice(helperStart, helperEnd)}\n globalThis.compatible = compMarketWorkKeysCompatible;`, context);

  assert.equal(context.compatible(
    'project_msnytli6_aj7z33::factory_work_run_new::모시꽃수파우치::fp-1',
    'factory_work_run_old::모시꽃수파우치::fp-1',
  ), true);
});

test('captured detail image survives the live work-instance prefix at analysis boundary', () => {
  const helperStart = CORE_05.indexOf('function compMarketWorkKeysCompatible(');
  const helperEnd = CORE_05.indexOf('function compMarketWorkScopeMatchesCurrent(', helperStart);
  const payloadStart = CORE_05.indexOf('function compMarketRowWorkPayload(');
  const payloadEnd = CORE_05.indexOf('function compMarketHasWorkPayloadStamp(', payloadStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && payloadStart >= 0 && payloadEnd > payloadStart);
  const context = vm.createContext({
    compMarketCurrentScopeHasAnyKey: () => true,
    compMarketCurrentScopeIsComplete: () => true,
    compMarketScopeKeyText: value => String(value || ''),
    compMarketCandidateNormalizeText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    compMarketTextCompatible: () => true,
  });
  vm.runInContext(`${CORE_05.slice(helperStart, helperEnd)}\n${CORE_05.slice(payloadStart, payloadEnd)}\n globalThis.matches = compMarketWorkPayloadMatchesCurrent;`, context);

  const current = {
    scopeKey: 'project_msnytli6_aj7z33::factory_work_run_mss7zm8b_9i1ifd::방울수저집::fp-1',
    currentRunId: 'factory_work_run_mss7zm8b_9i1ifd',
    productKey: '방울수저집',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    productName: '방울수저집',
  };
  const capturedImage = {
    factoryWorkKey: 'factory_work_run_mss7zm8b_9i1ifd::방울수저집::fp-1',
    currentRunId: 'factory_work_run_mss7zm8b_9i1ifd',
    factoryProductKey: '방울수저집',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    workProductName: '방울수저집',
  };

  assert.equal(context.matches(capturedImage, current), true);
});

test('foreign run with missing work key is rejected even when product identity matches', () => {
  const helperStart = CORE_05.indexOf('function compMarketWorkKeysCompatible(');
  const helperEnd = CORE_05.indexOf('function compMarketWorkScopeMatchesCurrent(', helperStart);
  const matcherStart = CORE_05.indexOf('function compMarketCandidateMatchesCurrentWork(');
  const matcherEnd = CORE_05.indexOf('function compMarketFilterCandidatesForCurrentWork(', matcherStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && matcherStart >= 0 && matcherEnd > matcherStart);
  const current = {
    scopeKey: 'factory_work_run_new::모시꽃수파우치::fp-1::competitors',
    currentRunId: 'factory_work_run_new',
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    productName: '모시꽃수파우치',
  };
  const candidate = {
    id: 'coupang-foreign-run',
    title: '전통 모시 꽃 자수 파우치',
    currentRunId: 'factory_work_run_old',
    factoryProductKey: '모시꽃수파우치',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    workProductName: '모시꽃수파우치',
  };
  const context = vm.createContext({
    compMarketIsUsableCandidate: () => true,
    compMarketCurrentWorkScope: () => current,
    compMarketCurrentScopeHasAnyKey: () => true,
    compMarketCurrentScopeIsComplete: () => true,
    compMarketHasWorkPayloadStamp: () => true,
    compMarketScopeKeyText: value => String(value || ''),
    compMarketCandidateTitleText: item => String(item?.title || ''),
    compMarketCandidateNativeText: () => '',
    compMarketCandidateNormalizeText: value => String(value || '').replace(/\\s+/g, '').toLowerCase(),
    compMarketCandidateQueryTexts: () => [],
    compMarketTextLooksForeignForCurrent: () => false,
    compMarketTextCompatible: () => true,
    compMarketProductCategoryTokens: () => [],
  });
  vm.runInContext(`${CORE_05.slice(helperStart, helperEnd)}\n${CORE_05.slice(matcherStart, matcherEnd)}\n globalThis.matches = compMarketCandidateMatchesCurrentWork;`, context);

  assert.equal(context.matches(candidate, current, { allowHistoricalRun: true }), false);
});

test('foreign run reusing the current work key is rejected instead of treated as regenerated', () => {
  const helperStart = CORE_05.indexOf('function compMarketWorkKeysCompatible(');
  const helperEnd = CORE_05.indexOf('function compMarketWorkScopeMatchesCurrent(', helperStart);
  const matcherStart = CORE_05.indexOf('function compMarketCandidateMatchesCurrentWork(');
  const matcherEnd = CORE_05.indexOf('function compMarketFilterCandidatesForCurrentWork(', matcherStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && matcherStart >= 0 && matcherEnd > matcherStart);
  const current = {
    scopeKey: 'factory_work_run_new::모시꽃수파우치::fp-1::competitors',
    currentRunId: 'factory_work_run_new',
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    productName: '모시꽃수파우치',
  };
  const candidate = {
    id: 'coupang-foreign-same-work-key',
    title: '전통 모시 꽃 자수 파우치',
    factoryWorkKey: current.scopeKey,
    currentRunId: 'foreign-run',
    generationRunId: 'foreign-run',
    factoryProductKey: '모시꽃수파우치',
    inputImageFingerprint: 'fp-1',
    stageId: 'competitors',
    workProductName: '모시꽃수파우치',
  };
  const context = vm.createContext({
    compMarketIsUsableCandidate: () => true,
    compMarketCurrentWorkScope: () => current,
    compMarketCurrentScopeHasAnyKey: () => true,
    compMarketCurrentScopeIsComplete: () => true,
    compMarketHasWorkPayloadStamp: () => true,
    compMarketScopeKeyText: value => String(value || ''),
    compMarketCandidateTitleText: item => String(item?.title || ''),
    compMarketCandidateNativeText: () => '',
    compMarketCandidateNormalizeText: value => String(value || '').replace(/\\s+/g, '').toLowerCase(),
    compMarketCandidateQueryTexts: () => [],
    compMarketTextLooksForeignForCurrent: () => false,
    compMarketTextCompatible: () => true,
    compMarketProductCategoryTokens: () => [],
  });
  vm.runInContext(`${CORE_05.slice(helperStart, helperEnd)}\n${CORE_05.slice(matcherStart, matcherEnd)}\n globalThis.matches = compMarketCandidateMatchesCurrentWork;`, context);

  assert.equal(context.matches(candidate, current, { allowHistoricalRun: true }), false);
});

test('candidate source view keeps a selected candidate when its run-prefixed id is regenerated', () => {
  const start = CORE_05.indexOf('function compMarketCandidateSourceView(');
  const end = CORE_05.indexOf('function compMarketCandidateSiteId(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    compMarketAllCandidateResults: market => Array.isArray(market.results) ? market.results : [],
    compMarketResultId: (item, index) => String(item?.id || `row-${index}`),
  });
  vm.runInContext(`${CORE_05.slice(start, end)}
    globalThis.apply = compMarketApplyCandidateSourceView;`, context);

  const previous = {
    id: 'run-old::coupang_8206910987',
    product_url: 'https://coupang.com/vp/products/8206910987',
    factoryWorkKey: 'factory_work_run_old::모시꽃수파우치::fp-1::competitors',
  };
  const regenerated = {
    id: 'run-new::coupang_8206910987',
    product_url: 'https://coupang.com/vp/products/8206910987',
    factoryWorkKey: 'factory_work_run_new::모시꽃수파우치::fp-1::competitors',
  };
  const market = {
    selectedIds: [previous.id],
    results: [previous],
    vmResults: [regenerated],
    vmGroupedResults: { coupang: [regenerated] },
  };

  context.apply(market, 'vm', { preserveSelection: true });

  assert.deepEqual(Array.from(market.selectedIds), [regenerated.id]);
});

test('runtime view keeps nested selected candidate when canonical rows use a regenerated id', () => {
  const start = CORE_03.indexOf('function factoryRuntimeCandidateRows(');
  const end = CORE_03.indexOf('function factoryRuntimeReadViewSnapshot(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    compMarketSelectionIdsForVisibleRows: (selectedIds, previousRows, visibleRows) => {
      const selected = String(selectedIds[0] || '');
      const previous = previousRows.find(row => String(row?.id || '') === selected);
      const visible = visibleRows.find(row => String(row?.product_url || '') === String(previous?.product_url || ''));
      return visible ? [visible.id] : [];
    },
  });
  vm.runInContext(`${CORE_03.slice(start, end)}
    globalThis.resolve = factoryRuntimeResolveSelectedIdsForVisibleCandidates;`, context);

  const result = context.resolve(
    {
      results: [{ id: 'run-new::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
      selectedIds: [],
    },
    {
      results: [{ id: 'run-old::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
      selectedIds: ['run-old::coupang_8206910987'],
    },
  );
  assert.deepEqual(result, ['run-new::coupang_8206910987']);
});

test('runtime view falls back to nested selection when canonical selection is stale', () => {
  const start = CORE_03.indexOf('function factoryRuntimeCandidateRows(');
  const end = CORE_03.indexOf('function factoryRuntimeReadViewSnapshot(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    compMarketSelectionIdsForVisibleRows: (selectedIds, previousRows, visibleRows) => {
      const selected = new Set(selectedIds.map(String));
      const visible = new Map(visibleRows.map(row => [String(row?.product_url || row?.id || ''), row]));
      return Array.from(new Set(previousRows
        .filter(row => selected.has(String(row?.id || '')))
        .map(row => visible.get(String(row?.product_url || row?.id || ''))?.id)
        .filter(Boolean)));
    },
  });
  vm.runInContext(`${CORE_03.slice(start, end)}
    globalThis.resolve = factoryRuntimeResolveSelectedIdsForVisibleCandidates;`, context);

  const result = context.resolve(
    {
      results: [{ id: 'run-new::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
      selectedIds: ['stale-id'],
    },
    {
      results: [{ id: 'run-new::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
      selectedIds: ['run-new::coupang_8206910987'],
    },
  );
  assert.deepEqual(result, ['run-new::coupang_8206910987']);
});

test('same-work normalized state keeps persisted selection when restored rows are empty', () => {
  const start = CORE_05.indexOf('function compMarketSelectedIdsForNormalizedState(');
  const end = CORE_05.indexOf('function ensureCompMarketScrapeState(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(`${CORE_05.slice(start, end)}
    globalThis.resolve = compMarketSelectedIdsForNormalizedState;`, context);

  assert.deepEqual(
    Array.from(context.resolve(false, new Set(['run-new::coupang_8206910987']), [])),
    ['run-new::coupang_8206910987'],
  );
  assert.deepEqual(Array.from(context.resolve(false, new Set(), [])), []);
  assert.deepEqual(Array.from(context.resolve(true, new Set(['foreign']), ['foreign'])), []);
});

test('competitor render passes the current factory nesting to state normalization', () => {
  const start = CORE_05.indexOf('function factoryCompetitorMarketForRender(');
  const end = CORE_05.indexOf('function renderFactoryAutomationCompetitorPicker(', start);
  assert.ok(start >= 0 && end > start);
  const factory = { competitors: { compPage: { marketScrape: { selectedIds: ['saved'] } } } };
  let received = null;
  const context = vm.createContext({
    ensureCompMarketScrapeState: options => {
      received = options;
      return { selectedIds: ['saved'] };
    },
    state: { compPage: { marketScrape: {} } },
  });
  vm.runInContext(`${CORE_05.slice(start, end)}
    globalThis.read = factoryCompetitorMarketForRender;`, context);

  assert.deepEqual(Array.from(context.read(factory).selectedIds), ['saved']);
  assert.equal(received.factory, factory);
});

test('factory collect render passes normalized market to the visible competitor panel', () => {
  const start = CORE_05.indexOf('function renderFactoryAutomationCollect(');
  const end = CORE_05.indexOf('function renderFactoryAutomationGenerate(', start);
  assert.ok(start >= 0 && end > start);
  const factory = { competitors: { compPage: { marketScrape: { selectedIds: ['saved'] } } } };
  let received = null;
  const context = vm.createContext({
    factoryCompetitorMarketForRender: currentFactory => ({
      factory: currentFactory,
      selectedIds: ['saved'],
    }),
    renderCompMarketScrapePanel: (snapshot, market) => {
      received = { snapshot, market };
      return 'panel';
    },
    renderFactoryAutomationStep: () => '',
    renderFactoryAutomationStatusCard: () => '',
  });
  vm.runInContext(`${CORE_05.slice(start, end)}
    globalThis.render = renderFactoryAutomationCollect;`, context);

  context.render(factory, {
    dbCandidates: 0,
    confirmedDb: false,
    cafe24Candidates: 0,
    cafe24Selected: false,
    competitors: 14,
    sizeFacts: 0,
    heroAssets: 0,
    detailAssets: 0,
  });
  assert.equal(received.snapshot, null);
  assert.equal(received.market.factory, factory);
  assert.deepEqual(Array.from(received.market.selectedIds), ['saved']);
});

test('plain server selection resolves to a run-prefixed visible candidate', () => {
  const start = CORE_05.indexOf('function compMarketSelectionIdsForVisibleRows(');
  const end = CORE_05.indexOf('function compMarketSetCandidateSource(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    compMarketResultId: (item, index) => String(item?.id || `row-${index}`),
    compMarketCandidateDedupeKey: item => String(item?.product_url || item?.id || ''),
    compMarketWorkKeysCompatible: () => true,
  });
  vm.runInContext(`${CORE_05.slice(start, end)}
    globalThis.resolve = compMarketSelectionIdsForVisibleRows;`, context);

  assert.deepEqual(Array.from(context.resolve(
    ['coupang_8206910987'],
    [{ id: 'run-old::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
    [{ id: 'run-new::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
  )), ['run-new::coupang_8206910987']);
});

test('plain server selection resolves directly when no previous rows are available', () => {
  const start = CORE_05.indexOf('function compMarketSelectionIdsForVisibleRows(');
  const end = CORE_05.indexOf('function compMarketSetCandidateSource(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    compMarketResultId: (item, index) => String(item?.id || `row-${index}`),
    compMarketCandidateDedupeKey: item => String(item?.product_url || item?.id || ''),
    compMarketWorkKeysCompatible: () => true,
  });
  vm.runInContext(`${CORE_05.slice(start, end)}
    globalThis.resolve = compMarketSelectionIdsForVisibleRows;`, context);

  assert.deepEqual(Array.from(context.resolve(
    ['coupang_8206910987'],
    [],
    [{ id: 'run-new::coupang_8206910987', product_url: 'https://coupang.com/vp/products/8206910987' }],
  )), ['run-new::coupang_8206910987']);
});
