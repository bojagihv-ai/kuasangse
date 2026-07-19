const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9342';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-vm-scope-isolation-v130.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let proof = null;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.compMarketCandidateMatchesCurrentWork)', 60000);

    proof = await evaluate(cdp, `(() => {
      const productName = '띠수네모동전지갑';
      const runId = 'vm_scope_run_v130';
      const productKey = window.factoryNormalizeIdentityText(productName);
      const inputFp = 'vm_scope_input_v130';
      const stageId = 'competitors';
      window.state.step = 'competitor';
      window.state.productName = productName;
      window.state.imageBase64 = inputFp;
      window.state.compPage = window.state.compPage || {};
      const factory = window.factoryState();
      factory.product = factory.product || {};
      factory.product.productName = productName;
      factory.product.userProductName = productName;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.productKey = productKey;
      factory.product.inputImageFingerprint = inputFp;
      factory.product.lockedInputImageFingerprint = inputFp;
      factory.automation = factory.automation || {};
      factory.automation.currentRunId = runId;
      const current = window.compMarketCurrentWorkScope();
      const base = {
        id: 'scope-current',
        title: productName,
        product_name: productName,
        product_url: 'https://example.com/current',
        thumbnail: 'https://example.com/current.jpg',
        price: '3500',
        platform: 'coupang',
        search_keyword: productName,
        _search_runtime: 'vm',
        _vm_search_id: 'vm_scope_search_v130',
      };
      const valid = window.compMarketStampRowsWithCurrentWork([base], current)[0];
      const assisted = window.factoryMarkAssistedVmCandidateRows([base], 'vm_scope_assisted_v130', productName)[0];
      const variants = [
        valid,
        { ...valid, id: 'scope-foreign-run', product_url: 'https://example.com/run', currentRunId: 'foreign-run', generationRunId: 'foreign-run' },
        { ...valid, id: 'scope-foreign-product', product_url: 'https://example.com/product', productKey: 'foreign-product', factoryProductKey: 'foreign-product', scopeProductKey: 'foreign-product' },
        { ...valid, id: 'scope-foreign-image', product_url: 'https://example.com/image', inputImageFingerprint: 'foreign-image' },
        { ...valid, id: 'scope-foreign-stage', product_url: 'https://example.com/stage', stageId: 'foreign-stage' },
      ];
      const directChecks = Object.fromEntries(variants.map(item => [item.id, window.compMarketCandidateMatchesCurrentWork(item, current)]));
      const market = window.compMarketDefaultState();
      window.compMarketApplyCurrentWorkScope(market, current);
      market.productName = productName;
      market.results = variants;
      market.groupedResults = { coupang: variants };
      market.suppressFactoryCompetitorFallback = true;
      window.state.compPage.marketScrape = market;
      const filtered = window.ensureCompMarketScrapeState();
      const rows = window.compMarketAllCandidateResults(filtered);
      const staleContext = { expectedScope: current };
      const abortedController = new AbortController();
      abortedController.abort();
      const abortedContextCurrent = window.compMarketCollectionContextIsCurrent({
        expectedScope: current,
        signal: abortedController.signal,
      });
      const nextProductName = '작업전환검증상품';
      const nextRunId = 'vm_scope_run_next_v130';
      const nextProductKey = window.factoryNormalizeIdentityText(nextProductName);
      const nextInputFp = 'vm_scope_input_next_v130';
      window.state.productName = nextProductName;
      window.state.imageBase64 = nextInputFp;
      const nextFactory = window.factoryState();
      nextFactory.product = nextFactory.product || {};
      nextFactory.automation = nextFactory.automation || {};
      nextFactory.goalRun = nextFactory.goalRun || {};
      nextFactory.product.productName = nextProductName;
      nextFactory.product.userProductName = nextProductName;
      nextFactory.product.currentRunId = nextRunId;
      nextFactory.product.generationRunId = nextRunId;
      nextFactory.product.productKey = nextProductKey;
      nextFactory.product.productIdentityKey = nextProductKey;
      nextFactory.product.inputImages = [];
      nextFactory.product.imageBase64 = nextInputFp;
      nextFactory.product.inputImageFingerprint = nextInputFp;
      nextFactory.product.lockedInputImageFingerprint = nextInputFp;
      nextFactory.automation.currentRunId = nextRunId;
      nextFactory.goalRun.currentRunId = nextRunId;
      if (typeof factoryLiveInputDraft === 'object' && factoryLiveInputDraft) {
        factoryLiveInputDraft.productName = nextProductName;
      }
      const nextScope = window.compMarketCurrentWorkScope();
      const nextMarket = window.compMarketDefaultState();
      window.compMarketApplyCurrentWorkScope(nextMarket, nextScope);
      nextMarket.productName = nextProductName;
      nextMarket.results = [];
      nextMarket.groupedResults = {};
      nextMarket.suppressFactoryCompetitorFallback = true;
      window.state.compPage.marketScrape = nextMarket;
      const staleFinalizeResult = window.compMarketFinalizeResults([valid], { coupang: [valid] }, staleContext);
      const nextAfterStaleFinalize = window.ensureCompMarketScrapeState();
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        current,
        validScope: {
          currentRunId: valid.currentRunId || '',
          productKey: valid.productKey || '',
          inputImageFingerprint: valid.inputImageFingerprint || '',
          stageId: valid.stageId || '',
        },
        directChecks,
        assistedScope: {
          accepted: window.compMarketCandidateMatchesCurrentWork(assisted, current),
          currentRunId: assisted.currentRunId || '',
          productKey: assisted.productKey || assisted.factoryProductKey || '',
          inputImageFingerprint: assisted.inputImageFingerprint || '',
          stageId: assisted.stageId || '',
        },
        visibleIds: rows.map(item => item.id),
        visibleScopes: rows.map(item => ({
          id: item.id,
          currentRunId: item.currentRunId || '',
          productKey: item.productKey || '',
          inputImageFingerprint: item.inputImageFingerprint || '',
          stageId: item.stageId || '',
        })),
        staleCompletion: {
          abortedContextCurrent,
          scopeChangedContextCurrent: window.compMarketCollectionContextIsCurrent(staleContext),
          staleFinalizeResult,
          nextScope,
          nextVisibleIds: window.compMarketAllCandidateResults(nextAfterStaleFinalize).map(item => item.id),
          nextMarketScope: {
            currentRunId: nextAfterStaleFinalize.currentRunId || '',
            productKey: nextAfterStaleFinalize.productKey || '',
            inputImageFingerprint: nextAfterStaleFinalize.inputImageFingerprint || '',
            stageId: nextAfterStaleFinalize.stageId || '',
          },
        },
      };
    })()`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await cdpRuntime.cleanup();
  }

  const failures = [];
  const expected = ['scope-current'];
  if (JSON.stringify(proof.visibleIds) !== JSON.stringify(expected)) failures.push(`기본 후보에 외부 스코프가 남았습니다: ${JSON.stringify(proof.visibleIds)}`);
  if (!proof.directChecks['scope-current']) failures.push('현재 작업 후보가 거부됐습니다.');
  for (const id of ['scope-foreign-run', 'scope-foreign-product', 'scope-foreign-image', 'scope-foreign-stage']) {
    if (proof.directChecks[id]) failures.push(`${id} 불일치 후보가 허용됐습니다.`);
  }
  for (const key of ['currentRunId', 'productKey', 'inputImageFingerprint', 'stageId']) {
    if (!proof.validScope[key]) failures.push(`현재 후보 ${key} 표기가 비어 있습니다.`);
    if (!proof.assistedScope[key]) failures.push(`보조 후보 ${key} 표기가 비어 있습니다.`);
  }
  if (!proof.assistedScope.accepted) failures.push('현재 작업의 보조수집 후보가 범위 검사에서 거부됐습니다.');
  if (proof.assistedScope.stageId !== proof.current.stageId) failures.push(`보조 후보 stageId가 다릅니다: ${proof.assistedScope.stageId}`);
  if (proof.staleCompletion.abortedContextCurrent) failures.push('중단된 수집 컨텍스트가 현재 작업으로 허용됐습니다.');
  if (proof.staleCompletion.scopeChangedContextCurrent) failures.push('작업 전환 뒤 이전 수집 컨텍스트가 현재 작업으로 허용됐습니다.');
  if (proof.staleCompletion.staleFinalizeResult !== false) failures.push('이전 작업의 지연 후보 최종 반영이 거부되지 않았습니다.');
  if (proof.staleCompletion.nextVisibleIds.length) failures.push(`작업 전환 뒤 이전 후보가 새 작업에 섞였습니다: ${JSON.stringify(proof.staleCompletion.nextVisibleIds)}`);
  for (const key of ['currentRunId', 'productKey', 'inputImageFingerprint', 'stageId']) {
    if (proof.staleCompletion.nextMarketScope[key] !== proof.staleCompletion.nextScope[key]) {
      failures.push(`새 작업 ${key}가 지연 결과로 변경됐습니다.`);
    }
  }
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: failures.length === 0, proof, failures }, null, 2));
  console.log(JSON.stringify({ ok: failures.length === 0, resultPath: RESULT_PATH, proof, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
