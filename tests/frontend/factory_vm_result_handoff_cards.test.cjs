'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function cloneGrouped(grouped) {
  return Object.fromEntries(Object.entries(grouped || {}).map(([siteId, rows]) => [siteId, Array.isArray(rows) ? rows.slice() : []]));
}

test('fresh VM wrapper handoff publishes source and visible candidate rows after state replacement', async () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const workerSource = sourceSlice(
    source,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  const scope = {
    scopeKey: 'run-new::product-new::image-new',
    currentRunId: 'run-new',
    productKey: 'product-new',
    inputImageFingerprint: 'image-new',
    stageId: 'competitors',
  };
  const oldRow = { id: 'old-row', title: '이전 작업 후보', _search_runtime: 'vm', scopeKey: 'run-old::product-old::image-old' };
  const freshRows = Array.from({ length: 17 }, (_, index) => ({
    id: `vm-row-${index + 1}`,
    title: `새 VM 후보 ${index + 1}`,
    platform: 'coupang',
    _search_runtime: 'vm',
    _search_id: 'vm-search-new',
    scopeKey: scope.scopeKey,
  }));
  const initialMarket = {
    productName: '이전 상품',
    selectedSites: ['coupang'],
    marketTargets: { coupang: 17 },
    topN: 17,
    selectedImageIds: [],
    selectedIds: [],
    results: [oldRow],
    groupedResults: { coupang: [oldRow] },
    vmResults: [oldRow],
    vmGroupedResults: { coupang: [oldRow] },
    localResults: [],
    localGroupedResults: {},
    collectMode: 'vm',
    candidateView: 'vm',
    scrapedImages: [],
    productKey: 'product-old',
  };
  const state = {
    analysis: { product_name: '새 상품' },
    productName: '새 상품',
    compPage: { marketScrape: initialMarket },
  };
  const ensureCalls = [];
  let activeToken = { id: 'token-1' };
  const store = {
    getOperationToken: () => activeToken,
    isOperationCurrent: token => token === activeToken,
  };
  const factory = {
    product: { productName: '새 상품', analysis: {} },
    automation: {},
    goalRun: { progress: 0, failureReason: '이전 VM 후보 수집 실패' },
    stages: { db: {} },
    logs: [],
  };
  const goalProgressCalls = [];
  const parallelProgressCalls = [];
  const ensureMarket = options => {
    const raw = state.compPage.marketScrape || {};
    const next = {
      ...raw,
      results: Array.isArray(raw.results) ? raw.results.slice() : [],
      groupedResults: cloneGrouped(raw.groupedResults),
      vmResults: Array.isArray(raw.vmResults) ? raw.vmResults.slice() : [],
      vmGroupedResults: cloneGrouped(raw.vmGroupedResults),
      localResults: Array.isArray(raw.localResults) ? raw.localResults.slice() : [],
      localGroupedResults: cloneGrouped(raw.localGroupedResults),
      selectedIds: Array.isArray(raw.selectedIds) ? raw.selectedIds.slice() : [],
    };
    ensureCalls.push(options?.currentScope || null);
    state.compPage.marketScrape = next;
    return next;
  };
  const setCandidateSource = (market, source, rows, grouped) => {
    assert.equal(source, 'vm');
    market.vmResults = rows.slice();
    market.vmGroupedResults = cloneGrouped(grouped);
  };
  const applyCandidateSourceView = (market, source) => {
    assert.equal(source, 'vm');
    market.candidateView = 'vm';
    market.results = market.vmResults.slice();
    market.groupedResults = cloneGrouped(market.vmGroupedResults);
  };
  const context = vm.createContext({
    state,
    AbortController,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeStaleActionError: action => new Error(`stale: ${action}`),
    factoryCompetitorCandidateScopePayload: () => scope,
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, mutator) => ({ result: await mutator(factory) }),
    cleanDbSearchTerm: value => String(value || '').trim(),
    factoryWizardDbSearchQueryFromInput: () => '새 상품',
    ensureCompMarketScrapeState: ensureMarket,
    seedCompMarketDefaultProductContext: () => true,
    compMarketReadCandidateTargets: () => true,
    compMarketTargetForSite: () => 17,
    factoryAutomationStartRunCountForExecution: () => 3,
    compMarketApplyCurrentWorkScope: () => true,
    compMarketSetSiteSearchStatus: () => true,
    compMarketRecordVmSearchAttempt: () => true,
    factoryLog: () => true,
    factorySetParallelTaskProgress: (...args) => {
      parallelProgressCalls.push(args);
      return true;
    },
    factorySetGoalRunProgress: (_progress, _stage, _message, _type, options = {}) => {
      goalProgressCalls.push(options);
      if (options.failureReason !== undefined) factory.goalRun.failureReason = options.failureReason;
      return true;
    },
    scheduleLastWorkSave: () => true,
    factoryRuntimeRenderWithOwnedDraft: () => true,
    factoryYieldToPaint: async () => true,
    factoryStartGoalHeartbeat: () => 'heartbeat',
    factoryStopGoalHeartbeat: () => true,
    factoryVmCandidateTimeoutMs: () => 1000,
    factoryResolveTaskWithTimeout: async promise => promise,
    compMarketRunWithOwnedWorkScope: async (_ownedScope, action) => action(),
    runCompMarketScrape: async (_mode, options) => {
      assert.deepEqual(options.collectionContext.expectedScope, scope);
      const replaced = ensureMarket({ currentScope: scope });
      replaced.results = [];
      replaced.groupedResults = {};
      replaced.vmResults = [];
      replaced.vmGroupedResults = {};
      return { ok: true, searchId: 'vm-search-new', vmSearchId: 'vm-search-new', rawProducts: freshRows };
    },
    compMarketCollectionContextIsCurrent: () => true,
    factoryFreshVmCandidateRows: (_market, scrapeResult, ownedScope) => {
      assert.deepEqual(ownedScope, scope);
      assert.equal(scrapeResult.rawProducts.length, 17);
      return { searchId: 'vm-search-new', sourceRows: freshRows, rows: freshRows };
    },
    compMarketUpdateSiteSearchStatusFromGrouped: () => true,
    factoryImportCompetitorDataToFactory: (rows, _source, ownedFactory) => {
      ownedFactory.product.competitors = rows.slice();
      return rows.length;
    },
    compMarketGroupProducts: rows => ({ coupang: rows.slice() }),
    compMarketStoreCandidateSource: (market, source, rows, grouped) => {
      setCandidateSource(market, source, rows, grouped);
      applyCandidateSourceView(market, source);
    },
    compMarketSetCandidateSource: setCandidateSource,
    compMarketApplyCandidateSourceView: applyCandidateSourceView,
    compMarketPersistCandidateSnapshot: (market, currentScope) => {
      assert.deepEqual(currentScope, scope);
      assert.equal(market.vmResults.length, 17);
      assert.equal(market.results.length, 17);
      return true;
    },
    factorySyncCompetitorMarketToOwnedFactory: (ownedFactory, market) => {
      ownedFactory.competitors = ownedFactory.competitors && typeof ownedFactory.competitors === 'object'
        ? ownedFactory.competitors
        : {};
      ownedFactory.competitors.compPage = ownedFactory.competitors.compPage && typeof ownedFactory.competitors.compPage === 'object'
        ? ownedFactory.competitors.compPage
        : {};
      ownedFactory.competitors.compPage.marketScrape = JSON.parse(JSON.stringify(market));
      return true;
    },
    factoryShowVmCandidateSelectionTab: () => true,
    saveLastWorkNow: () => true,
    render: () => true,
  });
  vm.runInContext(`${workerSource}\nthis.runVmWorker = factoryRunVmCompetitorCollectionForSelection;`, context);

  const result = await context.runVmWorker({ factory, operationToken: activeToken, skipServicePreflight: true });

  assert.equal(result.ok, true);
  assert.equal(factory.product.competitors.length, 17);
  assert.equal(factory.competitors.compPage.marketScrape.vmResults.length, 17);
  assert.equal(state.compPage.marketScrape.vmResults.length, 17);
  assert.equal(state.compPage.marketScrape.results.length, 17);
  assert.equal(state.compPage.marketScrape.vmGroupedResults.coupang.length, 17);
  assert.equal(state.compPage.marketScrape.groupedResults.coupang.length, 17);
  assert.equal(state.compPage.marketScrape.candidateView, 'vm');
  assert.equal(factory.goalRun.failureReason, '');
  assert.ok(goalProgressCalls.some(options => options.failureReason === ''));
  assert.ok(parallelProgressCalls.some(([id, progress, status, message, options]) => (
    id === 'vm'
    && progress === 100
    && status === 'done'
    && /VM 후보 17건 수집 완료/.test(message)
    && options?.completedItemCount === 3
    && options?.expectedItemCount === 3
  )));
  assert.ok(state.compPage.marketScrape.results.every(row => row.id.startsWith('vm-row-')));
  assert.ok(!state.compPage.marketScrape.results.some(row => row.id === 'old-row'));
  assert.ok(ensureCalls.some(callScope => callScope?.scopeKey === scope.scopeKey));
});

test('factory competitor view reads the committed VM candidates instead of stale global compPage', () => {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const viewSource = sourceSlice(
    source,
    'function factoryRuntimeReadViewSnapshot()',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const factory = {
    competitors: {
      compPage: {
        marketScrape: {
          collectMode: 'vm',
          candidateView: 'vm',
          results: [{ id: 'vm-live-1' }],
          vmResults: [{ id: 'vm-live-1' }],
        },
      },
    },
  };
  const staleCompPage = {
    marketScrape: {
      collectMode: 'vm',
      candidateView: 'vm',
      results: [],
      vmResults: [],
    },
  };
  const store = {
    getSnapshot: () => ({ factory, competitors: { compPage: staleCompPage } }),
  };
  const context = vm.createContext({
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
  });
  vm.runInContext(`${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);

  const snapshot = context.readViewSnapshot();

  assert.deepEqual(
    snapshot.competitors.compPage.marketScrape.vmResults.map(item => item.id),
    ['vm-live-1'],
  );
  assert.deepEqual(
    snapshot.competitors.compPage.marketScrape.results.map(item => item.id),
    ['vm-live-1'],
  );
});

test('factory competitor view restores scoped legacy detail images when the committed slice is empty', () => {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const viewSource = sourceSlice(
    source,
    'function factoryRuntimeReadViewSnapshot()',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const legacyImages = [{ id: 'vm-image-1', src: '/api/vm-detail-capture/job/artifacts/0' }];
  const factory = { competitors: { compPage: { marketScrape: { results: [] } } } };
  const legacyCompPage = { marketScrape: { scrapedImages: legacyImages } };
  const store = { getSnapshot: () => ({ factory, competitors: { compPage: { marketScrape: { results: [] } } } }) };
  const context = vm.createContext({
    state: { compPage: legacyCompPage },
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
    compMarketCurrentWorkScope: () => ({ scopeKey: 'scope:current' }),
    compMarketFilterScrapedImagesForCurrentWork: images => images,
  });
  vm.runInContext(`${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);

  const snapshot = context.readViewSnapshot();

  assert.deepEqual(snapshot.competitors.compPage.marketScrape.scrapedImages, legacyImages);
});
