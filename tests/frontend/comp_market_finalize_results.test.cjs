'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('F5 후보 보관함 복원은 빈 VM 소스 배열에 다시 덮어쓰이지 않는다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const ensureSource = sourceSlice(
    source,
    'function ensureCompMarketScrapeState(',
    'function compMarketStableKey(',
  );

  assert.match(
    ensureSource,
    /const hasStoredCandidateSources = hasNonEmptyCandidateSource\s*\|\|\s*\(\s*!restoredRows\.length\s*&&/,
  );
});

test('F5 후보 보관함은 상세수집 이미지와 선택을 함께 저장하고 복원한다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const snapshotSource = sourceSlice(
    source,
    'function compMarketPersistCandidateSnapshot(',
    'function compMarketFindCandidateSnapshot(',
  );
  const restoreSource = sourceSlice(
    source,
    'function compMarketRestoreCandidateSnapshot(',
    'function compMarketHasWorkPayload(',
  );
  const workerSource = fs.readFileSync(CORE_06, 'utf8');
  const detailWorker = sourceSlice(
    workerSource,
    'async function runCompMarketDetailCapture(',
    'function compMarketManualRetryCandidateIds(',
  );

  assert.match(snapshotSource, /scrapedImages:\s*Array\.isArray\(detailSnapshot\?\.scrapedImages\)/);
  assert.match(snapshotSource, /selectedImageIds:\s*Array\.isArray\(detailSnapshot\?\.selectedImageIds\)/);
  assert.match(restoreSource, /const restoredScrapedImages = Array\.isArray\(snapshot\.scrapedImages\)/);
  assert.match(restoreSource, /market\.selectedImageIds = Array\.isArray\(snapshot\.selectedImageIds\)/);
  assert.match(detailWorker, /finishDetailGoal\(detailGoalOutcome\);\s*if \(typeof compMarketPersistCandidateSnapshot === 'function'\)/);
});

test('VM 후보 워커 완료 뒤 결과 확정은 선언되지 않은 options 참조로 실패하지 않는다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const finalizeSource = sourceSlice(
    source,
    'function compMarketFinalizeResults(',
    'function compMarketDataUrlParts(',
  );
  const market = {
    collectMode: 'vm', selectedIds: [], logs: [], results: [], groupedResults: {},
  };
  let saveCount = 0;
  const context = vm.createContext({
    ensureCompMarketScrapeState: () => market,
    compMarketCollectionContextIsCurrent: () => true,
    compMarketCurrentWorkScope: () => ({ id: 'project:test' }),
    compMarketApplyCurrentWorkScope() {},
    compMarketIsUsableCandidate: item => !!item,
    compMarketCandidateMatchesCurrentWork: () => true,
    compMarketStampRowsWithCurrentWork: rows => rows,
    compMarketFilterCandidatesForCurrentWork: rows => rows,
    compMarketDedupeCandidateRows: rows => rows,
    compMarketResultId: item => String(item.id),
    compMarketNow: () => '00:00:00',
    compMarketSetCandidateSource() {},
    compMarketSave: () => { saveCount += 1; },
  });
  vm.runInContext(finalizeSource, context);

  assert.doesNotThrow(() => context.compMarketFinalizeResults(
    [{ id: 'candidate-1', platform: 'coupang' }],
    { coupang: [{ id: 'candidate-1', platform: 'coupang' }] },
    { expectedScope: { id: 'project:test' } },
  ));
  assert.equal(saveCount, 1);
  assert.equal(market.results.length, 1);
});

test('VM 공통 인증 실패는 장터별 실패 사유로 복제하지 않는다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const finalizeSource = sourceSlice(
    source,
    'function compMarketFinalizeCollectionReports(',
    'function compMarketVmCandidateBridgeBaseUrl(',
  );
  const market = {
    selectedSites: ['coupang', 'gmarket'],
    error: '원격 서버에서 (401) 권한이 없음 오류',
    collectionStatus: { error: '원격 서버에서 (401) 권한이 없음 오류' },
  };
  const context = vm.createContext({
    ensureCompMarketScrapeState: () => market,
    compMarketTargetForSite: () => 4,
  });
  vm.runInContext(`${finalizeSource}\nthis.finalizeReports = compMarketFinalizeCollectionReports;`, context);

  const status = context.finalizeReports(market, { gmarket: [{ id: 'saved-result' }] });

  assert.deepEqual(
    Array.from(status.marketReports, report => report.shortfallReason),
    ['', ''],
  );
  assert.equal(status.marketReports[1].accepted, 1);
  assert.equal(market.collectionStatus.error, '원격 서버에서 (401) 권한이 없음 오류');
});

test('VM 공통 인증 실패는 단일 경고로 보이고 보존된 장터 결과와 분리된다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const rowSource = sourceSlice(
    source,
    'function factoryVmSearchSelectedSiteIds(',
    'function renderCompMarketCollectionMetrics(',
  );
  const renderSource = sourceSlice(
    source,
    'function renderFactoryVmSearchSiteBoard(',
    'function renderFactoryAutomationStatusCard(',
  );
  const context = vm.createContext({
    compMarketFilterCandidatesForCurrentWork: rows => rows,
    compMarketSiteLabel: siteId => siteId,
    compMarketTargetForSite: () => 4,
    escapeHtml: value => String(value ?? ''),
    escAttr: value => String(value ?? ''),
    renderCompMarketCollectionMetrics: () => '',
  });
  vm.runInContext(
    `${rowSource}\n${renderSource}\nthis.siteRows = factoryVmSearchSiteRows; this.renderBoard = renderFactoryVmSearchSiteBoard;`,
    context,
  );
  const market = {
    selectedSites: ['coupang', 'gmarket'],
    groupedResults: { gmarket: [{ id: 'saved-result' }] },
    searchId: 'search-previous',
    error: '원격 서버에서 (401) 권한이 없음 오류',
    collectionStatus: {
      error: '원격 서버에서 (401) 권한이 없음 오류',
      marketReports: [
        { marketId: 'coupang', requested: 4, accepted: 0, shortfall: 4 },
        { marketId: 'gmarket', requested: 4, accepted: 1, shortfall: 3 },
      ],
    },
  };

  const rows = Array.from(context.siteRows(market));
  const html = context.renderBoard(market, { force: true });

  assert.equal(rows[0].state, '이번 실행 미확정');
  assert.equal(rows[0].tone, 'muted');
  assert.equal(rows[0].shortfallReason, '');
  assert.equal(rows[1].tone, 'ok');
  assert.match(html, /data-vm-collection-global-error="1"/);
  assert.equal((html.match(/data-vm-collection-global-error="1"/g) || []).length, 1);
});

test('F5 복원 뒤 오류 문자열이 없어도 실패 ETA는 장터별 정상 0건으로 오인하지 않는다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const rowSource = sourceSlice(
    source,
    'function factoryVmSearchSelectedSiteIds(',
    'function renderCompMarketCollectionMetrics(',
  );
  const renderSource = sourceSlice(
    source,
    'function renderFactoryVmSearchSiteBoard(',
    'function renderFactoryAutomationStatusCard(',
  );
  const context = vm.createContext({
    compMarketFilterCandidatesForCurrentWork: rows => rows,
    compMarketSiteLabel: siteId => siteId,
    compMarketTargetForSite: () => 4,
    escapeHtml: value => String(value ?? ''),
    escAttr: value => String(value ?? ''),
    renderCompMarketCollectionMetrics: () => '',
  });
  vm.runInContext(
    `${rowSource}\n${renderSource}\nthis.siteRows = factoryVmSearchSiteRows; this.renderBoard = renderFactoryVmSearchSiteBoard;`,
    context,
  );
  const market = {
    selectedSites: ['coupang', 'gmarket'],
    groupedResults: { gmarket: [{ id: 'saved-result' }] },
    searchId: 'search-restored',
    collectionStatus: {
      progress: 52,
      eta: '실패',
    },
  };

  const rows = Array.from(context.siteRows(market));
  const html = context.renderBoard(market, { force: true });

  assert.equal(rows[0].state, '이번 실행 미확정');
  assert.equal(rows[0].tone, 'muted');
  assert.equal(rows[1].state, '1건 확보');
  assert.match(html, /이전 VM 수집이 완료 전에 중단되었습니다/);
  assert.equal((html.match(/data-vm-collection-global-error="1"/g) || []).length, 1);
});

test('명시적 최종 zero_result 보고만 복원된 공통 실패를 결과 없음으로 확정한다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const rowSource = sourceSlice(
    source,
    'function factoryVmSearchSelectedSiteIds(',
    'function renderCompMarketCollectionMetrics(',
  );
  const context = vm.createContext({
    compMarketFilterCandidatesForCurrentWork: rows => rows,
    compMarketSiteLabel: siteId => siteId,
    compMarketTargetForSite: () => 4,
  });
  vm.runInContext(`${rowSource}\nthis.siteRows = factoryVmSearchSiteRows;`, context);
  const market = {
    selectedSites: ['auction'],
    groupedResults: { auction: [] },
    searchId: 'search-final-zero',
    error: '이전 VM 워커 공통 실행 오류',
    collectionStatus: {
      error: '이전 VM 워커 공통 실행 오류',
      marketReports: [
        { marketId: 'auction', status: 'zero_result', requested: 4, accepted: 0, shortfall: 4 },
      ],
    },
  };

  const [row] = Array.from(context.siteRows(market));

  assert.equal(row.state, '검색 완료 · 결과 없음');
  assert.equal(row.tone, 'warn');
});

test('경쟁사 탭은 F5로 복원된 market 상태를 VM 현황 렌더러까지 전달한다', () => {
  const helperSource = fs.readFileSync(CORE_05, 'utf8');
  const adapterSource = fs.readFileSync(CORE_03, 'utf8');

  assert.match(
    helperSource,
    /function renderFactoryAutomationVmSearchInfo\(factory = factoryRuntimeReadFactory\(\), tone = 'info', marketOverride = null\)/,
  );
  assert.match(
    helperSource,
    /const market = marketOverride && typeof marketOverride === 'object'[\s\S]*state\.compPage\?\.marketScrape/,
  );
  assert.match(
    adapterSource,
    /renderFactoryAutomationVmSearchInfo: \(factory, tone, market\) => renderFactoryAutomationVmSearchInfo\([\s\S]*factoryRuntimeDetachedValue\(market\)/,
  );
});

test('장시간 VM 명령은 이전 커밋 범위가 아니라 호출자가 소유한 작업 범위로 후보를 확정한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const finalizeSource = sourceSlice(
    source,
    'function compMarketFinalizeResults(',
    'function compMarketDataUrlParts(',
  );
  const expectedScope = {
    scopeKey: 'run-new::product-new::image-new',
    currentRunId: 'run-new',
    productKey: 'product-new',
    inputImageFingerprint: 'image-new',
    stageId: 'competitors',
  };
  const committedScope = {
    scopeKey: 'run-old::product-old::image-old',
    currentRunId: 'run-old',
    productKey: 'product-old',
    inputImageFingerprint: 'image-old',
    stageId: 'competitors',
  };
  const market = { collectMode: 'vm', selectedIds: [], logs: [], results: [], groupedResults: {} };
  const observed = { ensured: null, applied: null, stamped: [] };
  const context = vm.createContext({
    ensureCompMarketScrapeState: options => { observed.ensured = options?.currentScope || null; return market; },
    compMarketCollectionContextIsCurrent: () => true,
    compMarketCurrentWorkScope: () => committedScope,
    compMarketApplyCurrentWorkScope(_market, scope) { observed.applied = scope; },
    compMarketIsUsableCandidate: item => !!item,
    compMarketCandidateMatchesCurrentWork: () => true,
    compMarketStampRowsWithCurrentWork(rows, scope) { observed.stamped.push(scope); return rows; },
    compMarketFilterCandidatesForCurrentWork: rows => rows,
    compMarketDedupeCandidateRows: rows => rows,
    compMarketResultId: item => String(item.id),
    compMarketNow: () => '00:00:00',
    compMarketSetCandidateSource() {},
    compMarketSave() {},
  });
  vm.runInContext(finalizeSource, context);

  const ok = context.compMarketFinalizeResults(
    [{ id: 'candidate-new', platform: 'naver' }],
    { naver: [{ id: 'candidate-new', platform: 'naver' }] },
    { expectedScope },
  );

  assert.equal(ok, true);
  assert.deepEqual(observed.ensured, expectedScope);
  assert.deepEqual(observed.applied, expectedScope);
  assert.ok(observed.stamped.length >= 2);
  assert.ok(observed.stamped.every(scope => scope === expectedScope));
});

test('VM 후보 필터는 호출자가 넘긴 owned-draft 범위를 사용한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const filterSource = sourceSlice(
    source,
    'function factoryFreshVmCandidateRows(',
    'function factoryVmCandidateSearchIdFromRow(',
  );
  const expectedScope = { scopeKey: 'new-scope' };
  const context = vm.createContext({
    compMarketCurrentWorkScope: () => ({ scopeKey: 'old-scope' }),
    compMarketIsUsableCandidate: () => true,
    compMarketCandidateMatchesCurrentWork: (_item, scope) => scope === expectedScope,
    compMarketDedupeCandidateRows: rows => rows,
  });
  vm.runInContext(filterSource, context);

  const result = context.factoryFreshVmCandidateRows({
    searchId: 'vm-run',
    results: [{ id: 'candidate-new', search_id: 'vm-run', search_runtime: 'vm' }],
  }, {}, expectedScope);

  assert.equal(result.rows.length, 1);
});

test('VM 후보 필터는 다른 작업의 무표식 화면 후보를 현재 실행 원본으로 재라벨링하지 않는다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const filterSource = sourceSlice(
    source,
    'function factoryFreshVmCandidateRows(',
    'function factoryVmCandidateSearchIdFromRow(',
  );
  const expectedScope = { scopeKey: 'pumpkin-needle-wrap' };
  const context = vm.createContext({
    compMarketCurrentWorkScope: () => expectedScope,
    compMarketProductsFromPayload: payload => payload?.rawProducts || [],
    compMarketIsUsableCandidate: () => true,
    compMarketCandidateMatchesCurrentWork: () => false,
    compMarketDedupeCandidateRows: rows => rows,
  });
  vm.runInContext(filterSource, context);

  const result = context.factoryFreshVmCandidateRows({
    searchId: 'search-pumpkin',
    searchKeyword: '호박바늘쌈',
    results: [{
      id: 'stale-crystal-wrapping',
      title: '튤립 크리스탈 보자기',
      search_id: 'search-pumpkin',
      search_runtime: 'vm',
    }],
  }, {
    ok: true,
    searchId: 'search-pumpkin',
    rawProducts: [],
  }, expectedScope);

  assert.equal(result.sourceRows.length, 0);
  assert.equal(result.rows.length, 0);
});

test('경쟁사 후보 관련성 필터는 호박바늘쌈 검색에서 크리스탈 보자기를 격리한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const relevanceSource = sourceSlice(
    source,
    'function factoryCompetitorCandidateTitleText(',
    'function factoryCompetitorCandidateScopePayload(',
  );
  const context = vm.createContext({ cleanDbSearchTerm: value => String(value || '').trim() });
  vm.runInContext(relevanceSource, context);

  assert.equal(
    context.factoryCompetitorCandidateMatchesSearchTerm(
      { title: '튤립 크리스탈 보자기 선물포장' },
      '호박바늘쌈',
    ),
    false,
  );
  assert.equal(
    context.factoryCompetitorCandidateMatchesSearchTerm(
      { title: '호박 모양 전통 바늘쌈지 바늘집' },
      '호박바늘쌈',
    ),
    true,
  );
  assert.equal(
    context.factoryCompetitorCandidateMatchesSearchTerm(
      { title: '담터 단호박 마차 50T' },
      '양단호박바늘쌈',
    ),
    false,
    '상품 종류를 나타내는 바늘쌈/바늘꽂이 없이 단호박만 겹치는 식품은 후보가 아니어야 합니다.',
  );
  assert.equal(
    context.factoryCompetitorCandidateMatchesSearchTerm(
      { title: '전통 호박 모양 바늘꽂이 바늘쌈지' },
      '양단호박바늘쌈',
    ),
    true,
  );
});

test('VM 확장 검색어는 제품명 다음에 자연어 힌트를 순서대로 사용한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const analyzerSource = sourceSlice(
    source,
    'function factoryProductSearchAnalyzer(',
    'function factoryCompetitorCandidateScopePayload(',
  );
  const context = vm.createContext({ cleanDbSearchTerm: value => String(value || '').trim() });
  vm.runInContext(analyzerSource, context);

  const terms = Array.from(context.factoryVmCompetitorSearchTerms(
    '호박바늘쌈',
    '호박 바늘쌈지, 전통 바느질 바늘집',
  ));

  assert.deepEqual(terms.slice(0, 3), [
    '호박바늘쌈',
    '호박 바늘쌈지',
    '전통 바느질 바늘집',
  ]);
});

test('VM 후보 factory 반영은 렌더 전역이 아니라 호출자가 소유한 draft 범위를 사용한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const importSource = sourceSlice(
    source,
    'function factoryImportCompetitorDataToFactory(',
    'async function factoryCollectCompetitorReferencesForReview(',
  );
  const expectedScope = { scopeKey: 'owned-pumpkin-needle-wrap' };
  const observed = { matched: [], stamped: null };
  const factory = { product: {} };
  const context = vm.createContext({
    cloneData: value => structuredClone(value),
    compMarketCandidateMatchesCurrentWork: (_item, scope) => {
      observed.matched.push(scope);
      return scope === expectedScope;
    },
    compMarketIsUsableCandidate: () => true,
    compMarketStampRowsWithCurrentWork: (rows, scope) => {
      observed.stamped = scope;
      return rows;
    },
  });
  vm.runInContext(importSource, context);

  const count = context.factoryImportCompetitorDataToFactory(
    [{ id: 'needle-wrap', title: '전통 호박 바늘쌈지' }],
    'JepumScraper VM 후보 수집',
    factory,
    expectedScope,
  );

  assert.equal(count, 1);
  assert.ok(observed.matched.every(scope => scope === expectedScope));
  assert.equal(observed.stamped, expectedScope);
});

test('VM 후보 필터는 방금 끝난 브리지 원본 후보만 범위 보정용으로 보존한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const filterSource = sourceSlice(
    source,
    'function factoryFreshVmCandidateRows(',
    'function factoryVmCandidateSearchIdFromRow(',
  );
  const context = vm.createContext({
    compMarketCurrentWorkScope: () => ({ scopeKey: 'new-scope' }),
    compMarketIsUsableCandidate: () => true,
    compMarketCandidateMatchesCurrentWork: () => false,
    compMarketDedupeCandidateRows: rows => rows,
  });
  vm.runInContext(filterSource, context);

  const result = context.factoryFreshVmCandidateRows({
    searchId: 'vm-run',
    searchKeyword: '호박바늘쌈',
    results: [],
  }, {
    searchId: 'vm-run',
    rawProducts: [{
      id: 'candidate-without-scope',
      title: '호박 모양 전통 바늘쌈지',
      search_id: 'vm-run',
      search_runtime: 'vm',
    }],
  }, { scopeKey: 'new-scope' });

  assert.equal(result.sourceRows.length, 1);
  assert.equal(result.rows.length, 0);
});

test('VM 후보 필터는 화면 상태가 비어도 방금 끝난 브리지 응답 후보를 보존한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const filterSource = sourceSlice(
    source,
    'function factoryFreshVmCandidateRows(',
    'function factoryVmCandidateSearchIdFromRow(',
  );
  const expectedScope = { scopeKey: 'run-new::product-new::image-new' };
  const context = vm.createContext({
    compMarketCurrentWorkScope: () => expectedScope,
    compMarketProductsFromPayload: payload => payload?.result?.products || payload?.rawProducts || [],
    compMarketIsUsableCandidate: () => true,
    compMarketCandidateMatchesCurrentWork: (_item, scope) => scope === expectedScope,
    compMarketDedupeCandidateRows: rows => rows,
  });
  vm.runInContext(filterSource, context);

  const result = context.factoryFreshVmCandidateRows({
    searchId: 'vm-run',
    results: [],
  }, {
    ok: true,
    searchId: 'vm-run',
    result: {
      products: [{ id: 'bridge-candidate', search_id: 'vm-run', search_runtime: 'vm' }],
    },
  }, expectedScope);

  assert.equal(result.sourceRows.length, 1);
  assert.equal(result.rows.length, 1);
});

test('VM 후보 필터는 stale 화면 searchId보다 방금 끝난 브리지 응답 searchId를 우선한다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const filterSource = sourceSlice(
    source,
    'function factoryFreshVmCandidateRows(',
    'function factoryVmCandidateSearchIdFromRow(',
  );
  const expectedScope = { scopeKey: 'run-new::product-new::image-new' };
  const context = vm.createContext({
    compMarketCurrentWorkScope: () => expectedScope,
    compMarketProductsFromPayload: payload => payload?.result?.products || payload?.rawProducts || [],
    compMarketIsUsableCandidate: () => true,
    compMarketCandidateMatchesCurrentWork: (_item, scope) => scope === expectedScope,
    compMarketDedupeCandidateRows: rows => rows,
  });
  vm.runInContext(filterSource, context);

  const result = context.factoryFreshVmCandidateRows({
    searchId: 'vm-run-old',
    vmSearchId: 'vm-run-old',
    results: [],
  }, {
    ok: true,
    searchId: 'vm-run-current',
    vmSearchId: 'vm-run-current',
    rawProducts: [{
      id: 'bridge-candidate',
      search_id: 'vm-run-current',
      search_runtime: 'vm',
    }],
  }, expectedScope);

  assert.equal(result.searchId, 'vm-run-current');
  assert.equal(result.sourceRows.length, 1);
  assert.equal(result.rows.length, 1);
});

test('VM one-click 수집은 owned draft에서 후보 범위를 만든다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const collectSource = sourceSlice(
    source,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );

  assert.match(collectSource, /factoryCompetitorCandidateScopePayload\('competitors',\s*factory\)/);
  assert.match(collectSource, /market\.productName = productName;\s*market\.searchKeyword = productName;/);
  assert.match(collectSource, /isCurrent:\s*\(\)\s*=>/);
  assert.match(collectSource, /vmRows\.sourceRows\.length\s*&&\s*!vmRows\.rows\.length[\s\S]*factoryNormalizeVmRowsFromCurrentRun\(vmRows,\s*updated,\s*productName,\s*currentScope\)/);
  assert.match(collectSource, /const relevantGrouped =[\s\S]*compMarketGroupProducts\(\s*vmRows\.rows,/);
  assert.match(collectSource, /const retryRelevantGrouped =[\s\S]*compMarketGroupProducts\(\s*vmRows\.rows,/);
  assert.match(source, /rawProducts:\s*collectMode === 'vm' \? products : \[\]/);
});
