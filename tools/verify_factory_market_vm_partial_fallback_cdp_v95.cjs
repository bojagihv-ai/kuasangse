const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9335';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const KEYWORD = '띠수네모동전지갑';
const SITES = ['coupang', 'naver', 'gmarket', 'auction', 'elevenst'];
const SITE_LABELS = {
  coupang: '쿠팡',
  naver: '스마트스토어',
  gmarket: 'G마켓',
  auction: '옥션',
  elevenst: '11번가',
};
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-market-vm-partial-fallback-cdp-v95.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-market-vm-partial-fallback-cdp-v95.json');

function svgData(label, color = '#6366f1') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <rect width="640" height="420" fill="#f8fafc"/>
  <rect x="150" y="112" width="340" height="196" rx="42" fill="${color}"/>
  <rect x="214" y="164" width="212" height="88" rx="26" fill="#111827" opacity=".16"/>
  <text x="320" y="222" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function capture(cdp) {
  await evaluate(cdp, `(() => {
    const panel = document.querySelector('#factoryCompetitorVmPanel')
      || document.querySelector('#compMarketName')?.closest('section')
      || document.body;
    panel.scrollIntoView({ block: 'start', inline: 'nearest' });
    window.scrollBy(0, -20);
    return true;
  })()`).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 500));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
}

function checksFromSummary(summary) {
  const counts = summary.counts || {};
  const samples = summary.samples || {};
  const runtimeCounts = summary.runtimeCounts || {};
  const cardFieldChecks = summary.cardFieldChecks || {};
  const failures = [];
  for (const site of SITES) {
    if (!counts[site]) failures.push(`${SITE_LABELS[site]} 후보 0건`);
    const card = cardFieldChecks[site] || {};
    if (counts[site] && !card.hasThumbnail) failures.push(`${SITE_LABELS[site]} 대표 썸네일 없음`);
    if (counts[site] && !card.hasTitle) failures.push(`${SITE_LABELS[site]} 상품명 없음`);
    if (counts[site] && !card.hasPrice) failures.push(`${SITE_LABELS[site]} 가격 없음`);
    if (counts[site] && !card.hasUrl) failures.push(`${SITE_LABELS[site]} URL 없음`);
    if (counts[site] && !samples[site]?.runtimeLabel) failures.push(`${SITE_LABELS[site]} 런타임 라벨 없음`);
  }
  if (!runtimeCounts.vm) failures.push('VM 결과 후보가 0건입니다.');
  if (!runtimeCounts.market_assisted) failures.push('보조수집 결과 후보가 0건입니다.');
  if (!summary.renderedTextIncludesVm) failures.push('화면 텍스트에서 VM 결과 라벨을 확인하지 못했습니다.');
  if (!summary.renderedTextIncludesAssisted) failures.push('화면 텍스트에서 보조수집 라벨을 확인하지 못했습니다.');
  if (summary.scopeMismatches?.length) failures.push(`현재 작업과 다른 후보 ${summary.scopeMismatches.length}건이 표시됐습니다.`);
  for (const key of ['currentRunId', 'productKey', 'inputImageFingerprint', 'stageId']) {
    if (!summary.currentScope?.[key]) failures.push(`현재 작업 ${key}가 비어 있습니다.`);
  }
  return failures;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = cdpRuntime.targets.find(item => item.type === 'page') || cdpRuntime.targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let summary = null;
  let scrapeResult = null;
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
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.runCompMarketScrape)', 60000);

    const img = svgData('coin-wallet-v95');
    await evaluate(cdp, `(() => {
      const keyword = ${JSON.stringify(KEYWORD)};
      const image = ${JSON.stringify(img)};
      const base64 = image.replace(/^data:image\\/[^;,]+;base64,/i, '');
      const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(keyword) : keyword;
      const inputFp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(base64) : 'market_v95_input';
      const runId = 'market_vm_partial_v95_' + Date.now().toString(36);
      window.state.step = 'competitor';
      window.state.productName = keyword;
      window.state.imageBase64 = base64;
      window.state.imageMime = 'image/svg+xml';
      window.state.imagePreview = image;
      window.state.imageName = 'market-v95-input.svg';
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.subStep = 'input';
      window.state.compPage.marketScrape = window.compMarketDefaultState ? window.compMarketDefaultState() : {};
      const factory = window.factoryState();
      factory.product = factory.product || {};
      factory.product.productName = keyword;
      factory.product.userProductName = keyword;
      factory.product.productKey = productKey;
      factory.product.productIdentityKey = productKey;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.lockedCurrentRunId = runId;
      factory.product.inputImageFingerprint = inputFp;
      factory.product.lockedInputImageFingerprint = inputFp;
      factory.product.imageBase64 = base64;
      factory.product.imageMime = 'image/svg+xml';
      factory.product.imagePreview = image;
      factory.product.imageName = 'market-v95-input.svg';
      factory.product.inputImages = [{
        id: 'market_v95_input',
        name: 'market-v95-input.svg',
        base64,
        mime: 'image/svg+xml',
        preview: image,
        hasImage: true,
        currentRunId: runId,
        productKey,
        inputImageFingerprint: inputFp,
      }];
      factory.automation = factory.automation || {};
      factory.automation.currentRunId = runId;
      const market = window.ensureCompMarketScrapeState();
      market.productName = keyword;
      market.searchKeyword = keyword;
      market.selectedSites = ${JSON.stringify(SITES)};
      market.topN = 3;
      market.collectMode = 'vm';
      market.imageBase64 = base64;
      market.imagePreview = image;
      market.imageMime = 'image/svg+xml';
      market.imageName = 'market-v95-input.svg';
      market.results = [];
      market.groupedResults = {};
      market.logs = [];
      window.__marketV95ExpectedScope = window.compMarketCurrentWorkScope();
      window.render();
      return {
        keyword,
        runId,
        productKey,
        inputFp,
        visibleInput: document.querySelector('#compMarketName')?.value || '',
      };
    })()`);

    scrapeResult = await evaluate(cdp, `window.runCompMarketScrape('vm')`);
    await waitFor(cdp, '!!document.querySelector(".comp-market-result-card") || !!window.state?.compPage?.marketScrape?.lastUpdatedAt', 30000);

    summary = await evaluate(cdp, `(() => {
      const market = window.ensureCompMarketScrapeState();
      const sites = ${JSON.stringify(SITES)};
      const grouped = market.groupedResults || {};
      const rows = window.compMarketAllCandidateResults ? window.compMarketAllCandidateResults(market) : (market.results || []);
      const currentScope = window.__marketV95ExpectedScope || window.compMarketCurrentWorkScope();
      const rowScope = item => ({
        currentRunId: String(item?.currentRunId || item?.generationRunId || '').trim(),
        productKey: String(item?.productKey || item?.factoryProductKey || item?.scopeProductKey || '').trim(),
        inputImageFingerprint: String(item?.inputImageFingerprint || '').trim(),
        stageId: String(item?.stageId || '').trim(),
      });
      const scopeMismatches = rows.map((item, index) => ({
        id: item?.id || item?.product_id || item?.product_url || ('row_' + index),
        ...rowScope(item),
      })).filter(scope => (
        scope.currentRunId !== currentScope.currentRunId
        || scope.productKey !== currentScope.productKey
        || scope.inputImageFingerprint !== currentScope.inputImageFingerprint
        || scope.stageId !== currentScope.stageId
      ));
      const runtimeKey = item => {
        const runtime = String(item?._search_runtime || item?.search_runtime || item?.capture_runtime || '').toLowerCase();
        if (item?._assisted_fallback_for_vm || item?.assistedFallbackForVm || runtime.includes('assisted')) return 'market_assisted';
        if (runtime === 'vm') return 'vm';
        if (runtime === 'local') return 'local';
        return runtime || 'unknown';
      };
      const thumb = item => window.compMarketThumbSrc ? window.compMarketThumbSrc(item) : (item.thumbnail_url || item.thumbnail || item.image_url || '');
      const url = item => String(item?.product_url || item?.url || item?.link || item?.detail_url || '').trim();
      const price = item => String(item?.price || item?.sale_price || item?.price_text || '').trim();
      const title = item => String(item?.title || item?.name || item?.product_name || '').trim();
      const counts = {};
      const samples = {};
      const cardFieldChecks = {};
      for (const site of sites) {
        const siteRows = Array.isArray(grouped[site]) ? grouped[site] : [];
        counts[site] = siteRows.length;
        const first = siteRows[0] || null;
        samples[site] = first ? {
          title: title(first),
          platform: first.platform || first.site || first.mall || '',
          price: price(first),
          url: url(first),
          thumb: thumb(first),
          runtimeLabel: runtimeKey(first),
          searchId: first._search_id || first.search_id || first.searchId || '',
          vmSearchId: first._vm_search_id || first.vm_search_id || first.vmSearchId || '',
          sourceKeyword: first.source_keyword || first._source_keyword || first.search_keyword || '',
          scope: rowScope(first),
        } : null;
        cardFieldChecks[site] = first ? {
          hasThumbnail: !!thumb(first),
          hasTitle: !!title(first),
          hasPrice: !!price(first),
          hasUrl: /^https?:\\/\\//i.test(url(first)),
          hasMarket: !!(first.platform || first.site || first.mall),
        } : {};
      }
      const runtimeCounts = rows.reduce((acc, item) => {
        const key = runtimeKey(item);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const cards = Array.from(document.querySelectorAll('.comp-market-result-card')).map(card => card.innerText.trim()).slice(0, 12);
      const bodyText = document.body.innerText || '';
      return {
        scrapeResult: ${JSON.stringify(scrapeResult)},
        status: market.status || '',
        phase: market.phase || '',
        route: market.route || '',
        searchId: market.searchId || '',
        vmSearchId: market.vmSearchId || '',
        sessionId: market.sessionId || '',
        selectedSites: market.selectedSites || [],
        siteSearchStatus: market.siteSearchStatus || [],
        vmSearchAttempts: market.vmSearchAttempts || [],
        counts,
        totalRows: rows.length,
        currentScope,
        scopeMismatches,
        runtimeCounts,
        samples,
        cardFieldChecks,
        cards,
        renderedTextIncludesVm: bodyText.includes('VM 결과'),
        renderedTextIncludesAssisted: bodyText.includes('보조수집'),
        renderedTextIncludesUrlButton: bodyText.includes('원본 확인') || bodyText.includes('URL 입력'),
      };
    })()`);
    await capture(cdp);
  } catch (error) {
    try {
      await capture(cdp);
    } catch (_) {}
    const payload = {
      ok: false,
      url: APP_URL,
      error: error?.stack || error?.message || String(error),
      scrapeResult,
      summary,
      screenshot: fs.existsSync(SCREENSHOT_PATH) ? SCREENSHOT_PATH : '',
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    throw error;
  } finally {
    try { cdp.close(); } catch (_) {}
    await cdpRuntime.cleanup();
  }

  const failures = checksFromSummary(summary);
  const payload = {
    ok: failures.length === 0,
    url: APP_URL,
    keyword: KEYWORD,
    scrapeResult,
    summary,
    failures,
    screenshot: SCREENSHOT_PATH,
    resultPath: RESULT_PATH,
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
  if (failures.length) {
    throw new Error(`market VM partial fallback verification failed:\\n- ${failures.join('\\n- ')}`);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
