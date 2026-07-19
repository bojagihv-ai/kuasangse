const fs = require('fs');
const path = require('path');
const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const KEYWORD = process.env.KUASANGSE_VM_KEYWORD || '수저 파우치';
const SITES = ['coupang', 'naver', 'gmarket', 'auction', 'elevenst'];
const TARGET = 2;
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'vm-candidate-collection-live-v149.png');
const RESULT_PATH = path.join(OUT_DIR, 'vm-candidate-collection-live-v149.json');

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
      width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1440),
      height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 980),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?liveVmCollection=v149` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.runCompMarketScrape)', 60000);

    const seeded = await evaluate(cdp, `(async () => {
      const keyword = ${JSON.stringify(KEYWORD)};
      const sites = ${JSON.stringify(SITES)};
      const factory = window.factoryState();
      window.state.step = 'factory';
      window.state.productName = keyword;
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.subStep = 'input';
      factory.product = factory.product || {};
      factory.product.productName = keyword;
      factory.product.userProductName = keyword;
      factory.product.productKey = keyword;
      factory.product.productIdentityKey = keyword;
      factory.automation = factory.automation || {};
      factory.automation.activeTab = 'competitor';
      factory.automation.activeTaskId = 'competitor-candidates';
      const market = window.ensureCompMarketScrapeState();
      market.productName = keyword;
      market.searchKeyword = keyword;
      market.selectedSites = sites;
      market.marketTargets = Object.fromEntries(sites.map(site => [site, ${TARGET}]));
      market.totalTarget = sites.length * ${TARGET};
      market.topN = ${TARGET};
      market.collectMode = 'vm';
      market.loading = false;
      market.error = '';
      market.status = '';
      market.phase = 'idle';
      market.results = [];
      market.groupedResults = {};
      market.vmResults = [];
      market.vmGroupedResults = {};
      market.localResults = [];
      market.localGroupedResults = {};
      market.logs = [];
      window.render();
      const input = document.querySelector('#compMarketName');
      if (input) input.value = keyword;
      return {
        keyword,
        sites,
        marketTargets: market.marketTargets,
        totalTarget: market.totalTarget,
        imageReady: !!(factory.product.imageBase64 || factory.product.imagePreview || window.state.imageBase64),
        visibleInput: input?.value || '',
      };
    })()`);

    await evaluate(cdp, `(() => {
      const originalVmSearch = window.compMarketTryVmSearch;
      window.__vmRawProducts = [];
      window.compMarketTryVmSearch = async (...args) => {
        const rows = await originalVmSearch(...args);
        window.__vmRawProducts = Array.isArray(rows) ? rows : [];
        return rows;
      };
      window.__vmLiveDone = false;
      window.__vmLiveResult = null;
      window.__vmLiveError = '';
      window.__vmLivePromise = window.runCompMarketScrape('vm')
        .then(result => { window.__vmLiveResult = result; window.__vmLiveDone = true; return result; })
        .catch(error => { window.__vmLiveError = error?.stack || error?.message || String(error); window.__vmLiveDone = true; return { ok: false, error: window.__vmLiveError }; });
      return true;
    })()`);

    const timeline = [];
    const startedAt = Date.now();
    let finished = false;
    while (!finished && Date.now() - startedAt < 180000) {
      const point = await evaluate(cdp, `(() => {
        const market = window.ensureCompMarketScrapeState();
        const progress = market.collectionStatus || {};
        return {
          at: Date.now(),
          done: !!window.__vmLiveDone,
          result: window.__vmLiveResult || null,
          error: window.__vmLiveError || '',
          status: market.status || '',
          phase: market.phase || '',
          errorState: market.error || '',
          loading: !!market.loading,
          progress: Number.isFinite(Number(progress.progress)) ? Number(progress.progress) : null,
          currentMarket: progress.currentMarket || market.activeSiteLabel || '',
          accepted: Number(progress.accepted || progress.acceptedCount || 0) || 0,
          totalTarget: Number(progress.totalTarget || market.totalTarget || 0) || 0,
          selectedSites: market.selectedSites || [],
          siteSearchStatus: Array.isArray(market.siteSearchStatus) ? market.siteSearchStatus : [],
        };
      })()`);
      timeline.push(point);
      finished = point.done;
      if (!finished) await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const finalState = await evaluate(cdp, `(() => {
      const market = window.ensureCompMarketScrapeState();
      const grouped = market.groupedResults || {};
      const counts = Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, Array.isArray(grouped[site]) ? grouped[site].length : 0]));
      const allRows = typeof window.compMarketAllCandidateResults === 'function'
        ? window.compMarketAllCandidateResults(market)
        : (market.results || []);
      const runtimeCounts = allRows.reduce((out, row) => {
        const runtime = String(row?._search_runtime || row?.search_runtime || row?.capture_runtime || '').toLowerCase();
        const key = row?._assisted_fallback_for_vm || runtime.includes('assisted') ? 'market_assisted' : (runtime || 'unknown');
        out[key] = (out[key] || 0) + 1;
        return out;
      }, {});
      const panel = document.querySelector('#factoryCompetitorPickerPanel') || document.querySelector('#factoryCompetitorVmPanel') || document.body;
      panel.scrollIntoView({ block: 'center', inline: 'nearest' });
      return {
        result: window.__vmLiveResult || null,
        promiseError: window.__vmLiveError || '',
        status: market.status || '',
        phase: market.phase || '',
        error: market.error || '',
        loading: !!market.loading,
        searchId: market.searchId || '',
        vmSearchId: market.vmSearchId || '',
        sessionId: market.sessionId || '',
        counts,
        totalRows: allRows.length,
        runtimeCounts,
        results: (market.results || []).slice(0, 10).map(row => ({
          id: row.id || row.product_id || '',
          title: row.title || row.name || row.product_name || '',
          platform: row.platform || row.site || row.mall || '',
          runtime: row._search_runtime || row.search_runtime || '',
          assisted: !!(row._assisted_fallback_for_vm || row.assistedFallbackForVm),
          url: row.product_url || row.url || row.link || '',
        })),
        rawVmProducts: (window.__vmRawProducts || []).slice(0, 20).map(row => ({
          id: row.id || row.product_id || '',
          title: row.title || row.name || row.product_name || '',
          platform: row.platform || row.site || row.mall || row.source || row.channel || row.store || '',
          runtime: row._search_runtime || row.search_runtime || row.capture_runtime || '',
          currentRunId: row.currentRunId || row.generationRunId || '',
          productKey: row.productKey || row.factoryProductKey || '',
          inputImageFingerprint: row.inputImageFingerprint || '',
          stageId: row.stageId || '',
          url: row.product_url || row.url || row.link || row.detail_url || '',
        })),
        bodyHasVmLabel: /VM 결과|VM 후보/.test(document.body.innerText || ''),
        bodyHasAssistedLabel: /보조수집/.test(document.body.innerText || ''),
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const payload = {
      ok: !!finalState.result?.ok
        && finalState.error === ''
        && finalState.loading === false
        && SITES.every(site => finalState.counts?.[site] === TARGET)
        && finalState.totalRows === SITES.length * TARGET,
      keyword: KEYWORD,
      targetPerMarket: TARGET,
      totalTarget: SITES.length * TARGET,
      seeded,
      startedAt,
      finishedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      timeline: timeline.slice(-30),
      finalState,
      screenshot: SCREENSHOT_PATH,
      resultPath: RESULT_PATH,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) process.exitCode = 1;
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
