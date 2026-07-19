const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9334';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const START_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-start-v183.png');
const DONE_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-done-v183.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-detail-progress-v183.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyBust=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.runCompMarketDetailCapture)', 60000);
    await new Promise(resolve => setTimeout(resolve, 6000));

    const result = await evaluate(cdp, `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const readGoal = () => {
        const node = document.querySelector('[data-factory-goal-status="automation"]');
        const stage = node?.querySelector('[data-factory-goal-stage]');
        return {
          title: node?.querySelector('[data-factory-goal-title]')?.textContent?.trim() || '',
          stage: stage?.textContent?.trim() || '',
          running: stage?.dataset.running === '1',
          ellipsis: !!stage?.querySelector('.factory-live-ellipsis'),
          log: node?.querySelector('[data-factory-goal-log-list]')?.textContent?.trim() || '',
        };
      };
      const candidate = {
        id: 'auction_ui_v183',
        platform: 'auction',
        title: '수저집 5000장 식당 업소용 통합 수저포장지 수저 커버',
        product_url: 'https://example.invalid/auction_ui_v183',
        thumbnail_url: '',
        _search_id: 'search_ui_v183',
        _vm_search_id: 'search_ui_v183',
      };
      const factory = window.factoryState();
      factory.product = {
        ...(factory.product || {}),
        userProductName: '슬라브나비수저집',
        productName: '슬라브나비수저집',
        productKey: '슬라브나비수저집',
        productIdentityKey: '슬라브나비수저집',
        currentRunId: 'factory_work_run_ui_v183',
        inputImageFingerprint: 'ui-v183-input',
        lockedInputImageFingerprint: 'ui-v183-input',
      };
      window.state.productName = '슬라브나비수저집';
      const scope = { ...window.compMarketCurrentWorkScope() };
      Object.assign(candidate, scope, { metadata: { ...scope } });
      window.__detailProgressMarksV183 = [];
      const originalMarkDetailSelectionChanged = window.compMarketMarkDetailSelectionChanged;
      window.compMarketMarkDetailSelectionChanged = (market, message) => {
        window.__detailProgressMarksV183.push({
          message: String(message || ''),
          selectedIds: Array.isArray(market?.selectedIds) ? [...market.selectedIds] : [],
          detailSelectionVersion: market?.detailSelectionVersion,
        });
        return originalMarkDetailSelectionChanged(market, message);
      };
      factory.goalRun = {
        running: false,
        progress: 52,
        currentStage: 'VM 후보 검색 완료',
        failureReason: '',
        activeOperationId: '',
      };
      factory.automation = { ...(factory.automation || {}), activeTab: 'competitor', activeTaskId: 'competitor-candidates' };
      window.state.step = 'factory';
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.marketScrape = {
        ...(window.state.compPage.marketScrape || {}),
        factoryWorkKey: scope.scopeKey,
        currentRunId: scope.currentRunId,
        generationRunId: scope.currentRunId,
        productKey: scope.productKey,
        inputImageFingerprint: scope.inputImageFingerprint,
        stageId: scope.stageId,
        workProductName: scope.productName,
        productName: '슬라브나비수저집',
        results: [candidate],
        groupedResults: { auction: [candidate] },
        selectedIds: [candidate.id],
        selectedSites: ['auction'],
        marketTargets: { auction: 1 },
        searchId: 'search_ui_v183',
        sessionId: 'search_ui_v183',
        logs: [],
        scrapedImages: [],
        selectedImageIds: [],
        detailSelectionVersion: 1,
        detailOperation: null,
      };
      window.compMarketEnsureVmDetailCaptureReady = async () => ({ ready: true, enabled: true, runtime: 'vm' });
      let statusCalls = 0;
      window.compMarketInvokeV1 = async (endpointId) => {
        if (endpointId === window.JEPUM_MARKET_API?.endpoints?.createDetail || String(endpointId).includes('detail-captures_b')) {
          return { body: { job_id: 'detail_job_ui_v183' } };
        }
        if (endpointId === window.JEPUM_MARKET_API?.endpoints?.detailStatus || String(endpointId).includes('detail-captures-job-id_3')) {
          statusCalls += 1;
          return { body: { status: statusCalls >= 4 ? 'completed' : 'running', completed: statusCalls >= 4 ? 1 : 0, total: 1 } };
        }
        if (endpointId === window.JEPUM_MARKET_API?.endpoints?.detailResults || String(endpointId).includes('results_f')) {
          return { body: { status: 'completed', completed: 1, failed: 0, results: [] } };
        }
        return { body: { ok: true } };
      };
      window.render();
      const runPromise = window.runCompMarketDetailCapture([candidate.id]);
      await wait(350);
      const start = readGoal();
      const startMarket = window.state.compPage.marketScrape;
      const startShot = await new Promise(resolve => resolve(null));
      await wait(5200);
      const during = readGoal();
      const runResult = await runPromise;
      window.render();
      await wait(120);
      const done = readGoal();
      const doneMarket = window.state.compPage.marketScrape;
      return {
        start,
        during,
        done,
        runResult: runResult || null,
        statusCalls,
        startLoading: !!startMarket.loading,
        doneLoading: !!doneMarket.loading,
        detailStatus: doneMarket.detailOperation?.status || '',
        detailImageCount: Array.isArray(doneMarket.scrapedImages) ? doneMarket.scrapedImages.length : 0,
        scope: window.compMarketCurrentWorkScope(),
        marks: window.__detailProgressMarksV183,
        finalSelectedIds: doneMarket.selectedIds,
        finalDetailSelectionVersion: doneMarket.detailSelectionVersion,
        startShot,
      };
    })()`);

    const startShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(START_SCREENSHOT, Buffer.from(startShot.data, 'base64'));

    const doneShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(DONE_SCREENSHOT, Buffer.from(doneShot.data, 'base64'));

    const failures = [];
    if (!/상세페이지 수집 중/.test(result.start.stage)) failures.push(`start stage missing: ${JSON.stringify(result.start)}`);
    if (!result.start.running || !result.start.ellipsis) failures.push(`start progress is not visibly running: ${JSON.stringify(result.start)}`);
    if (!/상세페이지 수집 중/.test(result.during.stage) || !result.during.running) failures.push(`heartbeat stage is not still running: ${JSON.stringify(result.during)}`);
    if (!/상세페이지 수집 완료/.test(result.done.stage)) failures.push(`done stage missing: ${JSON.stringify(result.done)}`);
    if (result.done.running || result.done.ellipsis || result.doneLoading || result.detailStatus !== 'done') failures.push(`done state is not closed: ${JSON.stringify(result)}`);
    if (result.statusCalls < 4) failures.push(`mocked VM status was not polled through completion: ${result.statusCalls}`);

    const payload = { ok: failures.length === 0, result, failures, screenshots: { start: START_SCREENSHOT, done: DONE_SCREENSHOT } };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
    assertChecks(failures.map(message => ({ ok: false, message })));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
