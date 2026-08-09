'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function extractFunction(startMarker, endMarker) {
  const start = CORE.indexOf(startMarker);
  const end = CORE.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return CORE.slice(start, end);
}

function groupProducts(rows, siteIds) {
  const grouped = {};
  for (const row of rows || []) {
    const site = String(row.platform || row.site || 'etc');
    if (siteIds.length && !siteIds.includes(site)) continue;
    if (!grouped[site]) grouped[site] = [];
    grouped[site].push(row);
  }
  return grouped;
}

function flattenGrouped(grouped) {
  return Object.values(grouped || {}).flat();
}

function createBridgeRecoveryHarness({ inputImageFingerprint = 'image-a' } = {}) {
  const requests = [];
  const current = {
    currentRunId: 'run-current',
    productKey: '모시꽃수파우치',
    inputImageFingerprint,
    stageId: 'competitors',
  };
  const context = {
    URLSearchParams,
    COMP_MARKET_DEFAULT_TARGET: 3,
    compMarketAssertCollectionContext() {},
    compMarketCurrentWorkScope: () => current,
    async compMarketFetchVmCandidateBridge(pathname) {
      requests.push(pathname);
      const url = new URL(pathname, 'http://127.0.0.1:5050');
      if (url.searchParams.get('keyword')) return { jobs: [] };
      return {
        jobs: [{
          job_id: 'vm_candidate_variant',
          result: {
            products: [{
              id: 'candidate-a',
              platform: 'coupang',
              title: '모시꽃수파우치 경쟁 상품',
              product_url: 'https://example.test/candidate-a',
            }],
          },
        }],
      };
    },
    compMarketNormalizeSite: value => String(value || ''),
    compMarketGroupProducts: groupProducts,
    compMarketProductsFromPayload: payload => Array.isArray(payload?.products) ? payload.products : [],
    compMarketFlattenGrouped: flattenGrouped,
    compMarketAttachSearchMeta(rows, searchId, _sessionId, _sites, _runtime, keyword) {
      return rows.map(row => ({ ...row, _search_id: searchId, _source_keyword: keyword }));
    },
    compMarketMergeSearchProducts(rows) {
      return [...new Map((rows || []).map(row => [row.id, row])).values()];
    },
    compMarketStampRowsWithCurrentWork(rows) {
      return (rows || []).map(row => ({ ...row, ...current }));
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(
    'async function compMarketReadRecentVmBridgeProductsForSites(',
    'async function compMarketRecoverRecentCompletedProductsForSites(',
  ), context);
  return { context, current, requests };
}

test('같은 제품·입력 범위의 최근 VM 후보는 검색어 변형이 있어도 보관소에서 복구한다', async () => {
  const { context, requests } = createBridgeRecoveryHarness();

  const rows = await context.compMarketReadRecentVmBridgeProductsForSites(
    { productName: '모시꽃수파우치', topN: 3 },
    ['coupang'],
  );

  assert.equal(rows.length, 1, '정확 검색어가 비어도 같은 작업 범위 후보를 복구해야 합니다.');
  assert.equal(rows[0].id, 'candidate-a');
  assert.equal(requests.length, 2, '검색어 조회 뒤 범위 한정 조회를 추가로 수행해야 합니다.');
  const [exact, scoped] = requests.map(value => new URL(value, 'http://127.0.0.1:5050'));
  assert.equal(exact.searchParams.get('keyword'), '모시꽃수파우치');
  assert.equal(scoped.searchParams.get('keyword'), null, '범위 한정 fallback에는 검색어를 강제하지 않습니다.');
  assert.equal(scoped.searchParams.get('productKey'), '모시꽃수파우치');
  assert.equal(scoped.searchParams.get('inputImageFingerprint'), 'image-a');
  assert.equal(scoped.searchParams.get('stageId'), 'competitors');
});

test('입력이 없는 VM 후보 복구는 검색어 없는 범위 fallback을 사용하지 않는다', async () => {
  const { context, requests } = createBridgeRecoveryHarness({ inputImageFingerprint: '' });

  const rows = await context.compMarketReadRecentVmBridgeProductsForSites(
    { productName: '모시꽃수파우치', topN: 3 },
    ['coupang'],
  );

  assert.deepEqual(rows, []);
  assert.equal(requests.length, 1, '입력 이미지가 없으면 다른 작업 후보가 섞일 수 있는 fallback을 막아야 합니다.');
  assert.equal(new URL(requests[0], 'http://127.0.0.1:5050').searchParams.get('keyword'), '모시꽃수파우치');
});

test('최근 VM 후보 불러오기는 V1 검색 기록보다 VM 보관소 복구를 먼저 사용한다', async () => {
  const market = {
    results: [],
    groupedResults: {},
    selectedSites: ['coupang'],
    collectMode: 'vm',
    productName: '모시꽃수파우치',
    topN: 3,
  };
  const bridgeRows = [{ id: 'candidate-a', platform: 'coupang', title: '모시꽃수파우치 경쟁 상품' }];
  const calls = { bridge: 0, findLatest: 0, finalize: 0, status: [] };
  const context = {
    COMP_MARKET_SITES: [{ id: 'coupang' }],
    ensureCompMarketScrapeState: () => market,
    compMarketRestoreCandidateSnapshot: () => [],
    compMarketCurrentWorkScope: () => ({ productKey: '모시꽃수파우치', inputImageFingerprint: 'image-a', stageId: 'competitors' }),
    compMarketNormalizeSite: value => String(value || ''),
    compMarketSetStatus(message, phase) { calls.status.push({ message, phase }); },
    render() {},
    async compMarketReadRecentVmBridgeProductsForSites() {
      calls.bridge += 1;
      return bridgeRows;
    },
    compMarketGroupProducts: groupProducts,
    compMarketFlattenGrouped: flattenGrouped,
    compMarketUpdateSiteSearchStatusFromGrouped() {},
    compMarketFinalizeResults(picked, grouped) {
      calls.finalize += 1;
      market.results = picked;
      market.groupedResults = grouped;
      market.loading = false;
      return true;
    },
    compMarketLog() {},
    compMarketSave() {},
    async compMarketFindLatestSearchForProduct() {
      calls.findLatest += 1;
      return null;
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(
    'async function reloadCompMarketSearchResultsFromCurrentId(',
    'async function compMarketReadLatestCompletedProductsForSite(',
  ), context);

  await context.reloadCompMarketSearchResultsFromCurrentId();

  assert.equal(calls.bridge, 1, '최근 VM 후보 버튼은 VM 보관소를 우선 읽어야 합니다.');
  assert.equal(calls.findLatest, 0, 'VM 보관소 복구 성공 뒤 V1 검색 기록으로 우회하면 안 됩니다.');
  assert.equal(calls.finalize, 1);
  assert.deepEqual(market.results, bridgeRows);
});
