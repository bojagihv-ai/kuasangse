const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9334';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const START_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-start-v184.png');
const DURING_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-during-v184.png');
const DONE_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-done-v184.png');
const SMALL_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-small-v184.png');
const FAILURE_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-failure-v184.png');
const STATUS_FAILURE_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-status-failure-v184.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-detail-progress-v184.json');

const readGoal = cdp => evaluate(cdp, `(() => {
  const node = document.querySelector('[data-factory-goal-status="automation"]');
  const stage = node?.querySelector('[data-factory-goal-stage]');
  const detailStage = document.querySelector('[data-factory-stage-jump="detail"]');
  return {
    title: node?.querySelector('[data-factory-goal-title]')?.textContent?.trim() || '',
    stage: stage?.textContent?.trim() || '',
    running: stage?.dataset.running === '1',
    ellipsis: !!stage?.querySelector('.factory-live-ellipsis'),
    log: node?.querySelector('[data-factory-goal-log-list]')?.textContent?.trim() || '',
    failureText: node?.querySelector('[data-factory-goal-failure]')?.textContent?.trim() || '',
    detailStage: detailStage?.textContent?.trim() || '',
    detailStageClass: detailStage?.className || '',
  };
})()`);

const capture = async (cdp, filePath) => {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
};

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

    await evaluate(cdp, `(() => {
      const candidate = {
        id: 'auction_ui_v184',
        platform: 'auction',
        title: '수저집 5000장 식당 업소용 통합 수저포장지 수저 커버',
        product_url: 'https://example.invalid/auction_ui_v184',
        thumbnail_url: '',
        _search_id: 'search_ui_v184',
        _vm_search_id: 'search_ui_v184',
      };
        window.__candidateV184 = candidate;
      window.__detailProgressModeV184 = 'success';
      const factory = window.factoryState();
      factory.product = {
        ...(factory.product || {}),
        userProductName: '슬라브나비수저집',
        productName: '슬라브나비수저집',
        productKey: '슬라브나비수저집',
        productIdentityKey: '슬라브나비수저집',
        currentRunId: 'factory_work_run_ui_v184',
        inputImageFingerprint: 'ui-v184-input',
        lockedInputImageFingerprint: 'ui-v184-input',
      };
      window.state.productName = '슬라브나비수저집';
      const scope = { ...window.compMarketCurrentWorkScope() };
      Object.assign(candidate, scope, { metadata: { ...scope } });
      factory.goalRun = {
        running: false,
        progress: 52,
        currentStage: 'VM 후보 검색 완료',
        failureReason: '',
        activeOperationId: '',
      };
      factory.stages = {
        ...(factory.stages || {}),
        detail: { ...(factory.stages?.detail || {}), status: 'idle', targetCount: 1, message: '' },
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
        searchId: 'search_ui_v184',
        sessionId: 'search_ui_v184',
        logs: [],
        scrapedImages: [{
          id: 'previous_image_ui_v184',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          title: '이전 작업 상세 이미지',
          platform: 'auction',
          candidateId: 'previous_candidate_ui_v184',
          productUrl: 'https://example.invalid/previous_ui_v184',
          detailOperationId: 'previous_operation_ui_v184',
          currentRunId: scope.currentRunId,
          generationRunId: scope.currentRunId,
          productKey: scope.productKey,
          inputImageFingerprint: scope.inputImageFingerprint,
          stageId: scope.stageId,
          metadata: { ...scope },
        }],
        selectedImageIds: [],
        detailSelectionVersion: 1,
        detailOperation: null,
      };
      window.compMarketEnsureVmDetailCaptureReady = async () => ({ ready: true, enabled: true, runtime: 'vm' });
      let statusCalls = 0;
      const endpointCalls = [];
      window.compMarketInvokeV1 = async endpointId => {
        endpointCalls.push(String(endpointId || ''));
        if (endpointId === window.JEPUM_MARKET_API?.endpoints?.createDetail || String(endpointId).includes('detail-captures_b')) {
          return { body: { job_id: 'detail_job_ui_v184' } };
        }
        if (endpointId === window.JEPUM_MARKET_API?.endpoints?.detailStatus || String(endpointId).includes('detail-captures-job-id_3')) {
          statusCalls += 1;
          if (window.__detailProgressModeV184 === 'status-failure') {
            return { body: { status: 'failed', completed: 0, failed: 1, total: 1, message: '검증용 상태 API 실패' } };
          }
          return { body: { status: statusCalls >= 4 ? 'completed' : 'running', completed: statusCalls >= 4 ? 1 : 0, total: 1 } };
        }
        if (endpointId === window.JEPUM_MARKET_API?.endpoints?.detailResults || String(endpointId).includes('results_f')) {
          if (window.__detailProgressModeV184 === 'status-failure') {
            return { body: {} };
          }
          if (window.__detailProgressModeV184 === 'failure') {
            return { body: { status: 'error', completed: 0, failed: 1, total: 1, message: '검증용 상세수집 실패' } };
          }
          return {
            body: {
              status: 'completed',
              completed: 1,
              failed: 0,
              currentRunId: scope.currentRunId,
              productKey: scope.productKey,
              inputImageFingerprint: scope.inputImageFingerprint,
              stageId: scope.stageId,
              scraped_data: {
                [candidate.id]: {
                  status: 'success',
                  title: candidate.title,
                  platform: candidate.platform,
                  product_url: candidate.product_url,
                  currentRunId: scope.currentRunId,
                  productKey: scope.productKey,
                  inputImageFingerprint: scope.inputImageFingerprint,
                  stageId: scope.stageId,
                  screenshot_paths: [
                    'C:\\JepumScraper\\data\\detail_pages\\auction_ui_v184\\detail.jpg',
                  ],
                  screenshot_urls: [
                    '/api/v1/detail-captures/detail_job_ui_v184/screenshots/auction_ui_v184/0',
                  ],
                },
              },
            },
          };
        }
        return { body: { ok: true } };
      };
      window.__detailProgressProbeV184 = window.compMarketExtractDetailImages({
        status: 'completed',
        results: [{
          id: candidate.id,
          candidateId: candidate.id,
          product_url: candidate.product_url,
          images: [{
            id: 'probe_image_ui_v184',
            base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            mime: 'image/png',
            candidateId: candidate.id,
            productUrl: candidate.product_url,
          }],
        }],
      }, [candidate]);
      window.__detailProgressStatusCallsV184 = () => statusCalls;
      window.__detailProgressEndpointCallsV184 = () => endpointCalls.slice();
      window.render();
      window.__detailProgressRunPromiseV184 = window.runCompMarketDetailCapture([candidate.id]);
      return true;
    })()`);

    await new Promise(resolve => setTimeout(resolve, 350));
    const start = await readGoal(cdp);
    await capture(cdp, START_SCREENSHOT);

    await new Promise(resolve => setTimeout(resolve, 5200));
    const during = await readGoal(cdp);
    await capture(cdp, DURING_SCREENSHOT);

    const runResult = await evaluate(cdp, 'window.__detailProgressRunPromiseV184');
    await evaluate(cdp, 'window.render(); true');
    await new Promise(resolve => setTimeout(resolve, 120));
    const done = await readGoal(cdp);
    const finalState = await evaluate(cdp, `(() => {
      const market = window.state.compPage.marketScrape || {};
      return {
        statusCalls: window.__detailProgressStatusCallsV184?.() || 0,
        detailStatus: market.detailOperation?.status || '',
        detailImageCount: Array.isArray(market.scrapedImages) ? market.scrapedImages.length : 0,
        detailCurrentImageCount: Number(market.detailOperation?.currentImageCount || 0),
        selectedIds: market.selectedIds || [],
        scope: window.compMarketCurrentWorkScope(),
        endpointCalls: window.__detailProgressEndpointCallsV184?.() || [],
        probeImageCount: Array.isArray(window.__detailProgressProbeV184) ? window.__detailProgressProbeV184.length : 0,
        probeImages: window.__detailProgressProbeV184 || [],
        candidateMatches: window.compMarketCandidateMatchesCurrentWork?.(window.__candidateV184, window.compMarketCurrentWorkScope()) ?? null,
      };
    })()`);
    await capture(cdp, DONE_SCREENSHOT);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 620,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 120));
    const layout = await evaluate(cdp, `(() => {
      const page = document.scrollingElement || document.documentElement;
      const main = document.querySelector('.main');
      const rail = document.querySelector('.factory-run-status-card');
      const logList = rail?.querySelector('[data-factory-goal-log-list]');
      const logStyle = logList ? getComputedStyle(logList) : null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pageScrollable: !!page && page.scrollHeight > page.clientHeight + 1,
        mainScrollable: !!main && main.scrollHeight > main.clientHeight + 1,
        railScrollable: !!rail && rail.scrollHeight > rail.clientHeight + 1,
        logScrollable: !!logList && (logList.scrollHeight > logList.clientHeight + 1 || ['auto', 'scroll'].includes(logStyle?.overflowY || '')),
        horizontalOverflow: !!page && page.scrollWidth > page.clientWidth + 1,
        stageRailPresent: !!document.querySelector('[data-factory-stage-log-container]'),
      };
    })()`);
    await capture(cdp, SMALL_SCREENSHOT);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 120));

    await evaluate(cdp, `(() => {
      window.__detailProgressModeV184 = 'failure';
      const candidateId = window.__candidateV184?.id || window.state?.compPage?.marketScrape?.selectedIds?.[0] || '';
      if (!candidateId) throw new Error('failure fixture candidate id is missing');
      window.__detailProgressFailurePromiseV184 = window.runCompMarketDetailCapture([candidateId]);
      return true;
    })()`);
    await evaluate(cdp, 'window.__detailProgressFailurePromiseV184');
    await evaluate(cdp, 'window.render(); true');
    await new Promise(resolve => setTimeout(resolve, 120));
    const failure = await readGoal(cdp);
    const failureState = await evaluate(cdp, `(() => {
      const market = window.state.compPage.marketScrape || {};
      const factory = window.factoryState();
      return {
        detailStatus: market.detailOperation?.status || '',
        stageStatus: factory.stages?.detail?.status || '',
        failureReason: factory.goalRun?.failureReason || '',
      };
    })()`);
    await capture(cdp, FAILURE_SCREENSHOT);

    await evaluate(cdp, `(() => {
      window.__detailProgressModeV184 = 'status-failure';
      const candidateId = window.__candidateV184?.id || window.state?.compPage?.marketScrape?.selectedIds?.[0] || '';
      if (!candidateId) throw new Error('status failure fixture candidate id is missing');
      window.__detailProgressStatusFailurePromiseV184 = window.runCompMarketDetailCapture([candidateId]);
      return true;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 120));
    const statusFailureStart = await readGoal(cdp);
    await evaluate(cdp, 'window.__detailProgressStatusFailurePromiseV184');
    await evaluate(cdp, 'window.render(); true');
    await new Promise(resolve => setTimeout(resolve, 120));
    const statusFailure = await readGoal(cdp);
    const statusFailureState = await evaluate(cdp, `(() => {
      const market = window.state.compPage.marketScrape || {};
      const factory = window.factoryState();
      return {
        detailStatus: market.detailOperation?.status || '',
        stageStatus: factory.stages?.detail?.status || '',
        failureReason: factory.goalRun?.failureReason || '',
      };
    })()`);
    await capture(cdp, STATUS_FAILURE_SCREENSHOT);

    const failures = [];
    if (!/상세페이지 수집 중/.test(start.stage) || !start.running || !start.ellipsis) failures.push(`start progress is not visibly running: ${JSON.stringify(start)}`);
    if (!/상세페이지 수집 중/.test(during.stage) || !during.running || !during.ellipsis) failures.push(`heartbeat stage is not still running: ${JSON.stringify(during)}`);
    if (!/상세페이지 수집 완료/.test(done.stage) || done.running || done.ellipsis) failures.push(`done state is not visibly closed: ${JSON.stringify(done)}`);
    if (!/진행/.test(start.detailStage) || !/running|current/.test(start.detailStageClass)) failures.push(`detail stage did not enter running state: ${JSON.stringify(start)}`);
    if (!/완료/.test(done.detailStage) || !/done/.test(done.detailStageClass) || !/1\/1개/.test(done.detailStage)) failures.push(`detail stage did not enter done state: ${JSON.stringify(done)}`);
    if (finalState.statusCalls < 4 || finalState.detailStatus !== 'done' || finalState.detailImageCount !== 2 || finalState.detailCurrentImageCount !== 1) failures.push(`VM detail completion mismatch: ${JSON.stringify(finalState)}`);
    if (finalState.probeImageCount !== 1 || !finalState.probeImages[0]?.currentRunId || finalState.probeImages[0]?.stageId !== finalState.scope.stageId || !finalState.candidateMatches) failures.push(`scope/base64 extraction mismatch: ${JSON.stringify(finalState)}`);
    if (!layout.mainScrollable || !layout.railScrollable || !layout.logScrollable || layout.horizontalOverflow || !layout.stageRailPresent) failures.push(`small viewport layout mismatch: ${JSON.stringify(layout)}`);
    if (!/수집 실패/.test(failure.stage) || failure.running || failure.ellipsis || failureState.detailStatus !== 'error' || failureState.stageStatus !== 'error') failures.push(`failure state is not visibly closed as an error: ${JSON.stringify({ failure, failureState })}`);
    if (!statusFailureStart.running || !statusFailureStart.ellipsis || statusFailureStart.failureText || !/수집 실패/.test(statusFailure.stage) || statusFailure.running || statusFailure.ellipsis || statusFailureState.detailStatus !== 'error' || statusFailureState.stageStatus !== 'error') failures.push(`status API failure was not preserved through an empty result: ${JSON.stringify({ statusFailureStart, statusFailure, statusFailureState })}`);

    const payload = {
      ok: failures.length === 0,
      result: { start, during, done, failure, statusFailureStart, statusFailure, runResult: runResult || null, ...finalState, failureState, statusFailureState },
      failures,
      screenshots: { start: START_SCREENSHOT, during: DURING_SCREENSHOT, done: DONE_SCREENSHOT, small: SMALL_SCREENSHOT, failure: FAILURE_SCREENSHOT, statusFailure: STATUS_FAILURE_SCREENSHOT },
      layout,
    };
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
