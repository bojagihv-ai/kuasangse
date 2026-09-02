const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core05 = fs.readFileSync(path.join(root, 'src', 'app-core-05.js'), 'utf8');
const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');

function extractFunction(source, name) {
  const plainStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 && (plainStart < 0 || asyncStart < plainStart) ? asyncStart : plainStart;
  assert.ok(start >= 0, `${name} not found`);
  const signatureStart = source.indexOf('(', start);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') signatureDepth += 1;
    if (char === ')') signatureDepth -= 1;
    if (signatureDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} body start not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

const siteLabels = {
  coupang: '쿠팡',
  naver: '스마트스토어',
  gmarket: 'G마켓',
  auction: '옥션',
  elevenst: '11번가',
};
const candidateContext = {
  COMP_MARKET_SITES: Object.entries(siteLabels).map(([id, label]) => ({ id, label })),
  compMarketSiteLabel: siteId => siteLabels[siteId] || siteId,
  compMarketTargetForSite: (market, siteId) => Number(market.marketTargets?.[siteId] || 0),
  compMarketFilterCandidatesForCurrentWork: rows => rows.filter(row => row?.currentWork !== false),
};
vm.createContext(candidateContext);
vm.runInContext([
  extractFunction(core05, 'factoryVmSearchSelectedSiteIds'),
  extractFunction(core05, 'factoryVmSearchSiteRows'),
].join('\n'), candidateContext);

const staleConnectorError = 'JepumScraper network 연결 실패 · connector jepumscraper · endpoint api-v1-health · base 127.0.0.1:5012';
const sites = Object.keys(siteLabels);
const rows = candidateContext.factoryVmSearchSiteRows({
  selectedSites: sites,
  searchId: 'search-final',
  marketTargets: Object.fromEntries(sites.map(siteId => [siteId, 2])),
  groupedResults: {
    coupang: [{ id: 'coupang-1' }, { id: 'coupang-2' }],
    naver: [{ id: 'naver-1' }, { id: 'naver-2' }],
    gmarket: [{ id: 'gmarket-1' }, { id: 'gmarket-2' }],
    auction: [],
    elevenst: [{ id: 'elevenst-1' }, { id: 'elevenst-2' }],
  },
  error: staleConnectorError,
  collectionStatus: {
    error: staleConnectorError,
    marketReports: [
      { marketId: 'coupang', requested: 2, accepted: 2, shortfall: 0 },
      { marketId: 'naver', requested: 2, accepted: 2, shortfall: 0 },
      { marketId: 'gmarket', requested: 2, accepted: 2, shortfall: 0 },
      { marketId: 'auction', requested: 2, accepted: 0, shortfall: 2, shortfallReason: 'zero_result' },
      { marketId: 'elevenst', requested: 2, accepted: 2, shortfall: 0 },
    ],
  },
});
const auction = rows.find(row => row.siteId === 'auction');
assert.equal(auction.state, '검색 완료 · 결과 없음', '최종 마켓 보고서가 zero_result면 이전 공통 오류가 있어도 실패 카드가 되면 안 됩니다.');
assert.equal(auction.tone, 'warn');
assert.equal(auction.shortfallReason, 'zero_result');
assert.deepEqual(
  rows.filter(row => ['naver', 'gmarket'].includes(row.siteId)).map(row => row.state),
  ['2건 확보', '2건 확보'],
  '최종 결과에서 목표 달성한 마켓은 이전 공통 오류와 무관하게 확보 상태여야 합니다.'
);

const staleScopedRows = candidateContext.factoryVmSearchSiteRows({
  selectedSites: ['naver'],
  searchId: 'search-current-work',
  marketTargets: { naver: 2 },
  groupedResults: {
    naver: [
      { id: 'naver-old-1', currentWork: false },
      { id: 'naver-old-2', currentWork: false },
    ],
  },
  collectionStatus: {
    marketReports: [{ marketId: 'naver', requested: 2, accepted: 2, shortfall: 0 }],
  },
});
assert.equal(staleScopedRows[0].count, 0, '현재 작업 카드에서 숨긴 예전 스마트스토어 후보를 상단 확보 수에 포함하면 안 됩니다.');
assert.equal(staleScopedRows[0].accepted, 0, '상단 승인 수는 현재 작업에서 실제 보이는 카드 수와 같아야 합니다.');
assert.equal(staleScopedRows[0].state, '검색 완료 · 결과 없음');

const staleSavedStatusRows = candidateContext.factoryVmSearchSiteRows({
  selectedSites: ['naver'],
  searchId: 'search-current-work',
  marketTargets: { naver: 2 },
  groupedResults: { naver: [] },
  siteSearchStatus: [{ siteId: 'naver', label: '스마트스토어', status: '2건 확보', tone: 'ok' }],
});
assert.equal(staleSavedStatusRows[0].count, 0);
assert.equal(staleSavedStatusRows[0].accepted, 0);
assert.equal(
  staleSavedStatusRows[0].state,
  '검색 완료 · 결과 없음',
  '현재 작업 후보가 0건이면 과거에 저장된 확보 문구도 남기면 안 됩니다.'
);
assert.equal(staleSavedStatusRows[0].tone, 'warn');

const notSearchedRows = candidateContext.factoryVmSearchSiteRows({
  selectedSites: ['naver'],
  marketTargets: { naver: 2 },
  groupedResults: { naver: [] },
});
assert.equal(notSearchedRows[0].state, '대기', '검색 식별자나 시도 기록이 없으면 완료로 추정하면 안 됩니다.');

const malformedNoSearchRows = candidateContext.factoryVmSearchSiteRows({
  selectedSites: ['naver'],
  marketTargets: { naver: 2 },
  groupedResults: { naver: [] },
  collectionStatus: {
    marketReports: [{ marketId: 'naver', accepted: null, requested: '', status: {} }],
  },
});
assert.equal(
  malformedNoSearchRows[0].state,
  '대기',
  '유효한 검색 식별자 없이 null/빈 문자열/객체 필드만 있는 보고서를 검색 완료로 오인하면 안 됩니다.'
);
assert.equal(malformedNoSearchRows[0].tone, 'muted');

const failedRows = candidateContext.factoryVmSearchSiteRows({
  selectedSites: ['naver'],
  searchId: 'search-failed',
  marketTargets: { naver: 2 },
  groupedResults: { naver: [] },
  collectionStatus: {
    marketReports: [{ marketId: 'naver', requested: 2, accepted: 0, status: 'failed' }],
  },
});
assert.equal(failedRows[0].state, '수집 실패', '현재 최종 마켓 보고서의 실패 상태는 완료 0건보다 우선해야 합니다.');
assert.equal(failedRows[0].tone, 'error');

const bridgeContext = {
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  factoryCompetitorCandidateScopePayload: () => ({ currentRunId: 'run-final', productKey: 'product-final', inputImageFingerprint: 'image-final', stageId: 'competitors' }),
  compMarketAssertCollectionContext() {},
  compMarketAssertVmRuntimeProof() {},
  compMarketAttachSearchMeta: products => products,
  compMarketProductsFromPayload: () => [],
  compMarketLog() {},
  compMarketSave() {},
  compMarketSetStatus() {},
  compMarketSetSiteSearchStatus() {},
  compMarketRefreshVmCandidateBridgeView() {},
  compMarketNormalizeSite: value => String(value || '').toLowerCase() === 'auction' ? 'auction' : String(value || '').toLowerCase(),
  compMarketSiteLabel: siteId => siteLabels[siteId] || siteId,
  render() {},
  async compMarketFetchVmCandidateBridge(pathname) {
    if (pathname === '/api/vm-candidate-search') return { job_id: 'bridge-final' };
    return {
      status: 'completed',
      search_id: 'search-final',
      vm_search_id: 'search-final',
      progress: { current_market: 'auction', percent: 100, accepted: 8, elapsed_seconds: 1 },
      result: {
        search_id: 'search-final',
        session_id: 'search-final',
        market_reports: [{ market_id: 'auction', requested: 2, accepted: 0, shortfall: 2, shortfall_reason: 'zero_result' }],
      },
    };
  },
  compMarketNormalizeCollectionStatus(payload, market) {
    const rootPayload = payload?.result || payload || {};
    market.collectionStatus = {
      ...(market.collectionStatus || {}),
      marketReports: rootPayload.market_reports || [],
    };
    return market.collectionStatus;
  },
};
vm.createContext(bridgeContext);
vm.runInContext([
  extractFunction(core06, 'factoryVmCandidateTimeoutMs'),
  extractFunction(core06, 'compMarketTryVmCandidateBridgeSearch'),
].join('\n'), bridgeContext);

async function main() {
  const bridgeMarket = {
    productName: '테스트 상품',
    searchRuns: [],
    error: staleConnectorError,
    collectionStatus: { error: staleConnectorError },
  };
  await bridgeContext.compMarketTryVmCandidateBridgeSearch(bridgeMarket, ['auction'], {}, { maxPolls: 1 });
  assert.equal(bridgeMarket.error, '', '성공적으로 끝난 VM 브리지 결과는 이전 전역 연결 오류를 남기면 안 됩니다.');
  assert.equal(bridgeMarket.collectionStatus.error, '', '성공적으로 끝난 VM 브리지 결과는 이전 collectionStatus 오류도 비워야 합니다.');

  console.log(JSON.stringify({
    ok: true,
    auction: { state: auction.state, tone: auction.tone, shortfallReason: auction.shortfallReason },
    clearedStaleError: !bridgeMarket.error && !bridgeMarket.collectionStatus.error,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
