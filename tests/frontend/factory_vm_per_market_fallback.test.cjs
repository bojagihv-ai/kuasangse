'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
const SOURCE_05 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');

function sourceSlice(startMarker, endMarker, source = SOURCE) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('VM 후보 fallback은 전체 후보 수가 아니라 마켓별 목표 3건을 기준으로 이어간다', () => {
  const helperSource = sourceSlice(
    'function factoryVmCompetitorSitesBelowTarget(',
    'function factoryCompetitorCandidateScopePayload(',
  );
  const context = vm.createContext({
    compMarketNormalizeSite: value => {
      const text = String(value || '').toLowerCase();
      return text.includes('11') ? 'elevenst' : text;
    },
    compMarketTargetValue: value => Math.max(1, Number(value || 3)),
  });
  vm.runInContext(
    `${helperSource}\nthis.sitesBelowTarget = factoryVmCompetitorSitesBelowTarget;`,
    context,
  );

  const rows = [
    ...Array.from({ length: 3 }, (_, index) => ({ platform: 'naver', id: `n${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ platform: 'gmarket', id: `g${index}` })),
  ];
  const missing = Array.from(context.sitesBelowTarget(
    rows,
    ['coupang', 'naver', 'gmarket', 'auction', 'elevenst'],
    { coupang: 3, naver: 3, gmarket: 3, auction: 3, elevenst: 3 },
  ));

  assert.deepEqual(missing, ['coupang', 'auction', 'elevenst']);
});

test('VM 후보 검색어는 제품명 뒤 자연어 힌트를 입력 순서 그대로 우선한다', () => {
  const helperSource = sourceSlice(
    'function factoryVmCompetitorSearchTerms(',
    'function factoryVmCompetitorSitesBelowTarget(',
  );
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim().replace(/\s+/g, ' '),
    factoryProductSearchAnalyzer: () => ({
      terms: ['양단호박바늘쌈', '호박바늘쌈', '호박 바늘 보관'],
    }),
  });
  vm.runInContext(
    `${helperSource}\nthis.searchTerms = factoryVmCompetitorSearchTerms;`,
    context,
  );

  const terms = Array.from(context.searchTerms('양단호박바늘쌈', '바늘쌈, 바늘꽂이'));

  assert.deepEqual(terms.slice(0, 3), ['양단호박바늘쌈', '바늘쌈', '바늘꽂이']);
});

test('바늘쌈 제품은 힌트가 하나뿐이어도 바늘꽂이까지 세 번째 검색어로 보강한다', () => {
  const helperSource = sourceSlice(
    'function factoryVmCompetitorSearchTerms(',
    'function factoryVmCompetitorSitesBelowTarget(',
  );
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim().replace(/\s+/g, ' '),
    factoryProductSearchAnalyzer: () => ({
      terms: ['양단호박바늘쌈', '호박바늘쌈', '호박 바늘 보관'],
    }),
  });
  vm.runInContext(
    `${helperSource}\nthis.searchTerms = factoryVmCompetitorSearchTerms;`,
    context,
  );

  const terms = Array.from(context.searchTerms('양단호박바늘쌈', '바늘쌈'));

  assert.deepEqual(terms.slice(0, 3), ['양단호박바늘쌈', '바늘쌈', '바늘꽂이']);
});

test('VM 후보 수집은 양단호박바늘쌈 뒤 바늘쌈, 바늘꽂이 순서로 미달 마켓만 재검색한다', () => {
  const body = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );

  assert.match(body, /factoryVmCompetitorSearchTerms\(/);
  assert.match(body, /factoryVmCompetitorSitesBelowTarget\(/);
  assert.match(body, /compMarketTryVmSearch\(\s*market,\s*remainingSiteIds/);
  assert.match(body, /candidateSearchTerms\.slice\(1,\s*3\)/);
  assert.match(body, /market\.productName\s*=\s*originalProductName/);
});

test('개별 VM 브리지 검색 제한시간은 느린 옥션 검색을 포함해 10분을 보장한다', () => {
  const timeoutSource = sourceSlice(
    'function factoryVmCandidateTimeoutMs(',
    'function compMarketScopeIdentity(',
  );

  assert.match(timeoutSource, /return\s+600000\s*;/);
});

test('세 단계 VM 검색 전체 제한시간은 개별 검색 제한시간의 3배를 보장한다', () => {
  const collectionBody = sourceSlice(
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  assert.match(
    collectionBody,
    /const\s+timeoutMs\s*=\s*factoryVmCandidateTimeoutMs\(\)\s*\*\s*3\s*;/,
  );
});

test('VM 브리지 폴링은 워커 420초 제한보다 늦게 끝난다', () => {
  const bridgeBody = sourceSlice(
    'async function compMarketTryVmCandidateBridgeSearch(',
    'function compMarketDetailOperationUrl(',
  );

  assert.match(
    bridgeBody,
    /const\s+defaultMaxPolls\s*=\s*Math\.ceil\(factoryVmCandidateTimeoutMs\(\)\s*\/\s*1500\)\s*\+\s*20\s*;/,
  );
  assert.match(bridgeBody, /:\s*defaultMaxPolls\s*;/);
});

test('VM 후보 완료 상태를 런타임 소유 factory 경쟁사 화면에도 동기화한다', () => {
  const helperSource = sourceSlice(
    'function factorySyncCompetitorMarketToOwnedFactory(',
    'function factoryImportCompetitorDataToFactory(',
  );
  const context = vm.createContext({
    cloneData: value => JSON.parse(JSON.stringify(value)),
  });
  vm.runInContext(
    `${helperSource}\nthis.syncMarket = factorySyncCompetitorMarketToOwnedFactory;`,
    context,
  );

  const factory = {
    competitors: {
      compPage: {
        analysisResult: { keep: true },
        marketScrape: { results: [{ id: 'old' }] },
      },
    },
  };
  const market = {
    collectMode: 'vm',
    results: [{ id: 'new-1' }, { id: 'new-2' }],
    vmResults: [{ id: 'new-1' }, { id: 'new-2' }],
  };

  assert.equal(context.syncMarket(factory, market), true);
  assert.deepEqual(factory.competitors.compPage.analysisResult, { keep: true });
  assert.deepEqual(
    factory.competitors.compPage.marketScrape.results.map(item => item.id),
    ['new-1', 'new-2'],
  );
  market.results.push({ id: 'later-mutation' });
  assert.equal(factory.competitors.compPage.marketScrape.results.length, 2);

  const collectionBody = sourceSlice(
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  assert.match(
    collectionBody,
    /factorySyncCompetitorMarketToOwnedFactory\(factory,\s*updated\);/,
  );
});

test('G마켓과 옥션의 서로 다른 상품번호는 URL 경로가 같아도 중복 제거하지 않는다', () => {
  const helperSource = sourceSlice(
    'function compMarketCandidateDedupeKey(',
    'function compMarketSetCandidateSource(',
    SOURCE_05,
  );
  const context = vm.createContext({
    compMarketResultId: (_item, index) => `row_${index}`,
  });
  vm.runInContext(
    `${helperSource}\nthis.dedupeRows = compMarketDedupeCandidateRows;`,
    context,
  );

  const rows = [
    {
      id: 'gmarket_4550352483',
      platform: 'gmarket',
      product_url: 'https://item.gmarket.co.kr/Item?goodscode=4550352483',
    },
    {
      id: 'gmarket_4550352133',
      platform: 'gmarket',
      product_url: 'https://item.gmarket.co.kr/Item?goodscode=4550352133',
    },
    {
      id: 'auction_E312574360',
      platform: 'auction',
      product_url: 'http://itempage3.auction.co.kr/DetailView.aspx?itemno=E312574360',
    },
    {
      id: 'auction_D881245405',
      platform: 'auction',
      product_url: 'http://itempage3.auction.co.kr/DetailView.aspx?itemno=D881245405',
    },
  ];

  assert.equal(context.dedupeRows(rows).length, 4);
});

test('바늘꽂이 확장 검색은 바늘·반짇고리 후보를 허용하되 단호박 식품은 차단한다', () => {
  const helperSource = sourceSlice(
    'function factoryCompetitorCandidateTitleText(',
    'function factoryVmCompetitorSearchTerms(',
  );
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim().replace(/\s+/g, ' '),
  });
  vm.runInContext(
    `${helperSource}\nthis.matchesTerm = factoryCompetitorCandidateMatchesSearchTerm;`,
    context,
  );

  assert.equal(
    context.matchesTerm(
      { title: '지퍼형반짇고리 10입 반짓고리 바느질함 실바늘세트' },
      '바늘꽂이',
    ),
    true,
  );
  assert.equal(
    context.matchesTerm({ title: '담터 단호박마차 15T' }, '양단호박바늘쌈'),
    false,
  );
  assert.equal(
    context.matchesTerm(
      { title: '원픽 남성 바늘쌈 헨리넥 스웨터 가을 빈티지 캐주얼 니트 상의' },
      '바늘쌈',
    ),
    false,
  );
});

test('붙은 복합 검색어는 제목에서 상품 종류 토큰을 기준으로 후보를 유지한다', () => {
  const helperSource = sourceSlice(
    'function factoryCompetitorCandidateTitleText(',
    'function factoryVmCompetitorSearchTerms(',
  );
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim(),
  });
  vm.runInContext(
    `${helperSource}\nthis.matchesTerm = factoryCompetitorCandidateMatchesSearchTerm;`,
    context,
  );

  assert.equal(
    context.matchesTerm({ title: '모시 전통 자수 파우치 보관함' }, '전통파우치'),
    true,
  );
  assert.equal(
    context.matchesTerm({ title: '전통 브로치 코사지' }, '전통파우치'),
    false,
  );
});

test('미달 마켓은 본컴 fallback 전에 같은 검색어의 최근 성공 VM 후보만 복구한다', () => {
  const collectionBody = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );
  const recoveryReaderBody = sourceSlice(
    'async function compMarketReadLatestCompletedProductsForSite(',
    'async function compMarketRecoverRecentCompletedProductsForSites(',
  );

  assert.match(
    collectionBody,
    /compMarketRecoverRecentCompletedProductsForSites\(\s*market,\s*remainingSiteIds,\s*'vm',\s*collectionContext,?\s*\)/,
  );
  assert.match(
    collectionBody,
    /factoryFilterCompetitorRowsBySearchTerm\(\s*recentVmRows,\s*recoveryTerm,?\s*\)/,
  );
  assert.match(
    collectionBody,
    /factoryVmCompetitorRowsForWorkProduct\(\s*relevantRecentVmRows,\s*originalProductName,?\s*\)/,
  );
  assert.match(
    recoveryReaderBody,
    /listSearches,\s*\{\s*query:\s*\{\s*limit:\s*100\s*\}\s*\}/,
  );
});

test('VM 브리지 복구는 반복 실행 이력에 성공 결과가 밀려도 서버 최대 100건까지 확인한다', () => {
  const bridgeRecoveryBody = sourceSlice(
    'async function compMarketReadRecentVmBridgeProductsForSites(',
    'async function compMarketRecoverRecentCompletedProductsForSites(',
  );

  assert.match(
    bridgeRecoveryBody,
    /new URLSearchParams\(\{\s*keyword,\s*limit:\s*'100'\s*\}\)/,
  );
});

test('소유 초안 수집 중 복구한 VM 후보는 전역 화면이 아닌 수집 작업 범위표를 사용한다', async () => {
  const bridgeRecoveryBody = sourceSlice(
    'async function compMarketReadRecentVmBridgeProductsForSites(',
    'async function compMarketRecoverRecentCompletedProductsForSites(',
  );
  const currentScope = {
    scopeKey: 'run-1::product-1::image-1',
    currentRunId: 'run-1',
    productKey: 'product-1',
    inputImageFingerprint: 'image-1',
    stageId: 'competitors',
    productName: '양단호박바늘쌈',
  };
  const staleGlobalScope = {
    scopeKey: 'stale-run::stale-product::stale-image',
    currentRunId: 'stale-run',
    productKey: 'stale-product',
    inputImageFingerprint: 'stale-image',
    stageId: 'competitors',
    productName: '이전 화면 상품',
  };
  const context = vm.createContext({
    URLSearchParams,
    requestedPaths: [],
    COMP_MARKET_DEFAULT_TARGET: 3,
    compMarketAssertCollectionContext: () => true,
    compMarketCurrentWorkScope: () => staleGlobalScope,
    compMarketNormalizeSite: value => String(value || '').toLowerCase(),
    compMarketFetchVmCandidateBridge: async path => ({
      requestedPath: context.requestedPaths.push(path),
      jobs: [{
        job_id: 'vm_candidate_success',
        result: {
          products: [{
            id: 'naver-1',
            platform: 'naver',
            title: '수공예 호박바늘쌈 바늘꽂이',
          }],
        },
      }],
    }),
    compMarketProductsFromPayload: payload => payload.products || [],
    compMarketGroupProducts: rows => ({ naver: rows }),
    compMarketFlattenGrouped: grouped => Object.values(grouped).flat(),
    compMarketAttachSearchMeta: rows => rows,
    compMarketMergeSearchProducts: rows => rows,
    compMarketStampRowsWithCurrentWork: (rows, scope) => rows.map(row => ({
      ...row,
      factoryWorkKey: scope.scopeKey,
      currentRunId: scope.currentRunId,
      factoryProductKey: scope.productKey,
      inputImageFingerprint: scope.inputImageFingerprint,
      stageId: scope.stageId,
    })),
  });
  vm.runInContext(
    `${bridgeRecoveryBody}\nthis.readRecentVmBridge = compMarketReadRecentVmBridgeProductsForSites;`,
    context,
  );

  const rows = Array.from(await context.readRecentVmBridge(
    { productName: '바늘쌈', marketTargets: { naver: 3 } },
    ['naver'],
    { expectedScope: currentScope },
  ));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].factoryWorkKey, currentScope.scopeKey);
  assert.equal(rows[0].currentRunId, currentScope.currentRunId);
  assert.equal(rows[0].factoryProductKey, currentScope.productKey);
  assert.equal(rows[0].inputImageFingerprint, currentScope.inputImageFingerprint);
  assert.equal(rows[0].stageId, currentScope.stageId);
  const recoveryUrl = new URL(context.requestedPaths[0], 'http://127.0.0.1');
  assert.equal(recoveryUrl.searchParams.get('currentRunId'), null);
  assert.equal(recoveryUrl.searchParams.get('productKey'), currentScope.productKey);
  assert.equal(
    recoveryUrl.searchParams.get('inputImageFingerprint'),
    currentScope.inputImageFingerprint,
  );
  assert.equal(recoveryUrl.searchParams.get('stageId'), currentScope.stageId);
});

test('현재 작업 범위로 복구한 과거 성공 VM 후보는 현재 검색 ID가 달라도 유지한다', () => {
  const helperSource = sourceSlice(
    'function factoryFreshVmCandidateRows(',
    'function factoryVmCandidateSearchIdFromRow(',
  );
  const currentScope = {
    scopeKey: 'run-current::product::image',
    currentRunId: 'run-current',
    productKey: 'product',
    inputImageFingerprint: 'image',
    stageId: 'competitors',
  };
  const context = vm.createContext({
    compMarketCurrentWorkScope: () => currentScope,
    compMarketIsUsableCandidate: () => true,
    compMarketProductsFromPayload: () => [],
    factoryCompetitorCandidateMatchesSearchTerm: () => true,
    compMarketDedupeCandidateRows: rows => rows,
    compMarketCandidateMatchesCurrentWork: (row, scope) => row.factoryWorkKey === scope.scopeKey,
  });
  vm.runInContext(
    `${helperSource}\nthis.freshRows = factoryFreshVmCandidateRows;`,
    context,
  );

  const result = context.freshRows({
    searchId: 'current-job',
    searchRuns: [{ searchId: 'current-job' }],
    results: [
      {
        id: 'current-live',
        _search_runtime: 'vm',
        _vm_search_id: 'current-job',
        factoryWorkKey: currentScope.scopeKey,
      },
      {
        id: 'scoped-recovery',
        _search_runtime: 'vm',
        _vm_search_id: 'old-success-job',
        _recovered_search_result: true,
        previousWorkCandidate: true,
        factoryWorkKey: currentScope.scopeKey,
      },
      {
        id: 'foreign-recovery',
        _search_runtime: 'vm',
        _vm_search_id: 'old-foreign-job',
        _recovered_search_result: true,
        previousWorkCandidate: true,
        factoryWorkKey: 'foreign-run::foreign-product::foreign-image',
      },
    ],
  }, {}, currentScope);

  assert.deepEqual(
    Array.from(result.rows, row => row.id),
    ['current-live', 'scoped-recovery'],
  );
});

test('확장 검색 후보는 검색어가 아니라 원래 작업 제품명으로 범위를 고정한다', () => {
  const helperSource = sourceSlice(
    'function factoryVmCompetitorRowsForWorkProduct(',
    'function factoryVmCompetitorSearchTerms(',
  );
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim().replace(/\s+/g, ' '),
  });
  vm.runInContext(
    `${helperSource}\nthis.scopeRows = factoryVmCompetitorRowsForWorkProduct;`,
    context,
  );

  const rows = Array.from(context.scopeRows([
    {
      id: 'auction_D673970639',
      platform: 'auction',
      title: '반짇고리함 바느질함 실바늘',
      workProductName: '바늘꽂이',
      _source_keyword: '바늘꽂이',
    },
  ], '양단호박바늘쌈'));

  assert.equal(rows[0].workProductName, '양단호박바늘쌈');
  assert.equal(rows[0]._source_keyword, '바늘꽂이');
  const collectionBody = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );
  assert.match(
    collectionBody,
    /factoryVmCompetitorRowsForWorkProduct\(\s*relevantRetryRows,\s*originalProductName,\s*\)/,
  );
});

test('VM 후보 수집은 비동기 작업이 끝날 때까지 owned draft 범위를 유지한다', () => {
  const worker = sourceSlice(
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );

  assert.match(
    worker,
    /draft\s*=>\s*factoryRuntimeRenderWithOwnedDraft\(\s*draft,\s*\(\)\s*=>\s*factoryRunVmCompetitorCollectionForSelection\(\{/,
    '긴 VM 수집 중 compMarketSave/saveLastWorkNow가 committed factory로 빠지지 않도록 owned draft lease가 Promise 완료까지 유지돼야 한다',
  );
});

test('VM 후보 수집 완료 뒤 committed factory를 현재 화면에 즉시 다시 그린다', () => {
  const worker = sourceSlice(
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  const outerBranch = worker.slice(0, worker.indexOf('const factory = options.factory;'));

  assert.match(
    outerBranch,
    /scheduleLastWorkSave\(\);\s*render\(\);\s*return receipt\.result;/,
    'owned draft 커밋 뒤에는 오래된 state.step 조건 없이 최종 committed factory를 다시 그려야 한다',
  );
});

test('VM 상세수집의 사용자 인증 필요 응답은 ok false여도 안내 상태로 전달한다', async () => {
  const bridgeSource = sourceSlice(
    'function compMarketVmCandidateBridgeBaseUrl(',
    'async function compMarketTryVmCandidateBridgeSearch(',
  );
  const manualPayload = {
    ok: false,
    status: 'failed',
    manual_action_required: true,
    manual_items: [{
      platform: 'naver',
      status: 'login_required',
      manual_title: '네이버 로그인/2단계 인증 필요',
    }],
  };
  const context = vm.createContext({
    AbortController,
    clearTimeout,
    setTimeout,
    state: { backendBaseUrl: 'http://127.0.0.1:5050' },
    fetch: async () => ({
      ok: false,
      status: 409,
      json: async () => manualPayload,
    }),
  });
  vm.runInContext(
    `${bridgeSource}\nthis.fetchVmBridge = compMarketFetchVmCandidateBridge;`,
    context,
  );

  const result = await context.fetchVmBridge('/api/vm-detail-capture/test');

  assert.equal(result.manual_action_required, true);
  assert.equal(result.manual_items[0].status, 'login_required');
});
