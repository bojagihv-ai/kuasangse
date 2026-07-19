const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9343';
const ROOT = path.resolve(__dirname, '..');
const RESULTS_ROOT = path.join(ROOT, 'output', 'vm-rebuild', 'vm-candidate-bridge', 'results');
const OUT_DIR = path.join(ROOT, 'output', 'debug-evidence');
const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 900 },
  { id: 'tablet', width: 768, height: 760 },
  { id: 'mobile', width: 375, height: 760 },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function latestCompletedDetailResult() {
  const candidates = fs.readdirSync(RESULTS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('vm_detail_'))
    .map(entry => {
      const dir = path.join(RESULTS_ROOT, entry.name);
      const statusFile = path.join(dir, 'status.json');
      const resultFile = path.join(dir, 'result.json');
      if (!fs.existsSync(statusFile) || !fs.existsSync(resultFile)) return null;
      const status = readJson(statusFile);
      if (String(status.status || '').toLowerCase() !== 'completed') return null;
      return { dir, resultFile, mtimeMs: fs.statSync(resultFile).mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    const payload = readJson(candidate.resultFile);
    const result = payload.result || payload;
    const scraped = result.scraped_data && typeof result.scraped_data === 'object' ? result.scraped_data : {};
    const entry = Object.entries(scraped).find(([, value]) => (
      Array.isArray(value?.screenshots) && value.screenshots.some(file => fs.existsSync(file))
    ));
    if (!entry) continue;
    const [productId] = entry;
    const product = (Array.isArray(result.products) ? result.products : [])
      .find(item => String(item?.id || item?.product_id || '') === productId);
    if (!product) continue;
    return { payload, product, productId, jobId: payload.job_id || result.job_id || path.basename(candidate.dir) };
  }
  throw new Error('실제 JPG가 있는 완료 VM 상세수집 결과를 찾지 못했습니다.');
}

async function capture(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(cdp, 'window.scrollTo(0, 0); true');
  await new Promise(resolve => setTimeout(resolve, 500));
  const inspection = await evaluate(cdp, `(() => {
    const host = document.querySelector('[data-qa-vm-detail-display]');
    const images = Array.from(host?.querySelectorAll('[data-comp-market-preview-image] img') || []);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      cardCount: host?.querySelectorAll('[data-comp-market-preview-image]').length || 0,
      loadedImageCount: images.filter(image => image.complete && image.naturalWidth > 0).length,
      smartstoreText: host?.querySelector('[data-qa-stale-smartstore]')?.innerText || '',
      pickerVisible: !!host?.querySelector('#factoryCompetitorImagePicker'),
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const screenshot = path.join(OUT_DIR, `vm-candidate-detail-display-20260715-${viewport.id}.png`);
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  return { ...inspection, screenshot };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const actual = latestCompletedDetailResult();
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyVmDetailDisplay=${Date.now()}` });
    await waitFor(cdp, 'typeof window.compMarketExtractDetailImages === "function" && typeof window.renderFactoryAutomationScrapedImagePicker === "function"', 60000);
    const payloadBase64 = Buffer.from(JSON.stringify(actual.payload), 'utf8').toString('base64');
    const productBase64 = Buffer.from(JSON.stringify(actual.product), 'utf8').toString('base64');
    const proof = await evaluate(cdp, `(() => {
      const actualPayload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${payloadBase64}'), char => char.charCodeAt(0))));
      const actualProduct = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${productBase64}'), char => char.charCodeAt(0))));
      const jobId = ${JSON.stringify(actual.jobId)};
      const factory = window.factoryState();
      factory.product = {
        ...(factory.product || {}),
        productName: 'VM 상세이미지 표시 검증',
        userProductName: 'VM 상세이미지 표시 검증',
        currentRunId: 'vm-detail-display-run-v194',
        generationRunId: 'vm-detail-display-run-v194',
        inputImageFingerprint: 'vm-detail-display-image-v194',
        lockedInputImageFingerprint: 'vm-detail-display-image-v194',
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: 'vm-detail-display-run-v194' };
      factory.goalRun = { ...(factory.goalRun || {}), currentRunId: 'vm-detail-display-run-v194' };
      const scope = window.compMarketCurrentWorkScope();
      const selected = window.compMarketStampRowsWithCurrentWork([actualProduct], scope, { replaceScope: true })[0];
      const market = {
        productName: scope.productName || selected.title || 'VM 상세수집 검증 상품',
        results: [selected],
        groupedResults: { coupang: [selected] },
        selectedIds: [selected.id],
        selectedImageIds: [],
        scrapedImages: [],
        detailSelectionVersion: 0,
        loading: false,
      };
      const operation = window.compMarketBeginDetailOperation(market, {
        ids: [selected.id], selectedItems: [selected], runtime: 'vm', scope,
      });
      const extracted = window.compMarketExtractDetailImages(actualPayload, [selected]);
      const scoped = extracted.map(image => ({
        ...image,
        factoryWorkKey: scope.scopeKey,
        currentRunId: scope.currentRunId,
        generationRunId: scope.currentRunId,
        productKey: scope.productKey,
        factoryProductKey: scope.productKey,
        scopeProductKey: scope.productKey,
        inputImageFingerprint: scope.inputImageFingerprint,
        stageId: scope.stageId,
        workProductName: scope.productName,
        metadata: {
          ...(image.metadata || {}),
          factoryWorkKey: scope.scopeKey,
          currentRunId: scope.currentRunId,
          generationRunId: scope.currentRunId,
          productKey: scope.productKey,
          factoryProductKey: scope.productKey,
          scopeProductKey: scope.productKey,
          inputImageFingerprint: scope.inputImageFingerprint,
          stageId: scope.stageId,
          workProductName: scope.productName,
        },
      }));
      const operationImages = window.compMarketStampDetailImagesForOperation(scoped, operation, [jobId]);
      market.scrapedImages = window.compMarketMergeScrapedImages([], operationImages, market);

      const staleRows = window.compMarketStampRowsWithCurrentWork([
        { id: 'naver-old-1', platform: 'naver', title: scope.productName || '검증 상품', product_url: 'https://example.invalid/naver/old-1' },
        { id: 'naver-old-2', platform: 'naver', title: scope.productName || '검증 상품', product_url: 'https://example.invalid/naver/old-2' },
      ], scope, { replaceScope: true }).map(row => ({ ...row, currentRunId: 'stale-run', generationRunId: 'stale-run' }));
      const staleMarket = {
        selectedSites: ['naver'], searchId: 'stale-smartstore-proof', marketTargets: { naver: 2 },
        groupedResults: { naver: staleRows },
        collectionStatus: { marketReports: [{ marketId: 'naver', requested: 2, accepted: 2, shortfall: 0 }] },
      };
      const host = document.createElement('main');
      host.dataset.qaVmDetailDisplay = 'true';
      host.style.cssText = 'box-sizing:border-box;min-height:100vh;padding:20px;background:var(--bg);color:var(--text);font-family:Pretendard,\"Noto Sans KR\",sans-serif;overflow-y:auto';
      host.innerHTML = '<section class="factory-section" style="max-width:1180px;margin:0 auto">'
        + '<h1 style="margin:0 0 8px;font-size:22px">VM 후보·상세이미지 실제 표시 검증</h1>'
        + '<p style="margin:0 0 14px;color:var(--text-m)">현재 작업과 다른 후보는 상단 수치에서 제외하고, 완료된 VM 상세 JPG는 선택 카드로 표시합니다.</p>'
        + '<div data-qa-stale-smartstore>' + window.renderFactoryVmSearchSiteBoard(staleMarket, { force: true }) + '</div>'
        + window.renderFactoryAutomationScrapedImagePicker(market, { previewLimit: 6, includePreviewModal: false })
        + '</section>';
      document.body.replaceChildren(host);
      return {
        extracted: extracted.length,
        operationImages: operationImages.length,
        mergedImages: market.scrapedImages.length,
        candidateIdWasUrl: extracted.some(image => {
          const candidateId = String(image.candidateId || '').toLowerCase();
          return candidateId.startsWith('http://') || candidateId.startsWith('https://');
        }),
      };
    })()`);

    await waitFor(cdp, `document.querySelectorAll('[data-comp-market-preview-image] img').length > 0 && Array.from(document.querySelectorAll('[data-comp-market-preview-image] img')).some(image => image.complete && image.naturalWidth > 0)`, 30000);
    const captures = [];
    for (const viewport of VIEWPORTS) captures.push(await capture(cdp, viewport));
    assertChecks([
      { ok: proof.extracted >= 1, message: `실제 VM 결과에서 상세이미지를 추출하지 못했습니다: ${JSON.stringify(proof)}` },
      { ok: proof.operationImages >= 1, message: `선택 후보 operation 필터가 실제 VM 이미지를 버렸습니다: ${JSON.stringify(proof)}` },
      { ok: proof.mergedImages >= 1, message: `상세이미지가 조립공장 목록에 병합되지 않았습니다: ${JSON.stringify(proof)}` },
      ...captures.map(item => ({ ok: item.cardCount >= 1 && item.loadedImageCount >= 1 && item.pickerVisible, message: `상세이미지 선택 카드가 보이지 않습니다: ${JSON.stringify(item)}` })),
      ...captures.map(item => ({ ok: /검색 완료 · 결과 없음/.test(item.smartstoreText) && /승인 0/.test(item.smartstoreText) && !/2건 확보/.test(item.smartstoreText), message: `예전 스마트스토어 2건이 상단 수치에 남았습니다: ${item.smartstoreText}` })),
      ...captures.map(item => ({ ok: item.scrollWidth <= item.viewport.width + 1, message: `가로 넘침이 발생했습니다: ${JSON.stringify(item)}` })),
    ]);
    const evidence = { ok: true, jobId: actual.jobId, proof, captures };
    const resultPath = path.join(OUT_DIR, 'vm-candidate-detail-display-20260715.json');
    fs.writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ ...evidence, resultPath }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
