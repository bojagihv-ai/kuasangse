const path = require('path');
const { chromium } = require('playwright');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');

function makeSvgDataUrl(index, bytes = 22000) {
  const filler = String(index).padStart(3, '0') + '-'.repeat(Math.max(0, bytes));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650" viewBox="0 0 900 650">
  <rect width="900" height="650" fill="#fff7f2"/>
  <rect x="70" y="80" width="760" height="490" rx="34" fill="#1b2135"/>
  <text x="450" y="285" text-anchor="middle" font-size="54" font-family="Arial" fill="#ffffff">perf ${index}</text>
  <text x="450" y="350" text-anchor="middle" font-size="22" font-family="Arial" fill="#a5b4fc">${filler}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function collect(page, label) {
  return page.evaluate((labelArg) => {
    const imgs = Array.from(document.images || []);
    const srcBytes = imgs.reduce((sum, img) => sum + String(img.currentSrc || img.src || '').length, 0);
    return {
      label: labelArg,
      renderMs: window.__KUASANGSE_RENDER_LAST_MS__ || 0,
      domNodes: document.querySelectorAll('*').length,
      imgCount: imgs.length,
      dataImgCount: imgs.filter(img => /^data:image\//i.test(String(img.src || ''))).length,
      objectUrlCount: imgs.filter(img => /^blob:/i.test(String(img.src || ''))).length,
      lightPendingCount: document.querySelectorAll('img[data-factory-light-image-key]:not([data-factory-light-loaded="1"])').length,
      lightLoadedCount: document.querySelectorAll('img[data-factory-light-image-key][data-factory-light-loaded="1"]').length,
      imgSrcBytes: srcBytes,
      lightStoreSize: window.__factoryLightImageStore?.size || 0,
      lightUrlSize: window.__factoryLightImageUrls?.size || 0,
      heapUsed: performance.memory?.usedJSHeapSize || 0,
      heapTotal: performance.memory?.totalJSHeapSize || 0,
    };
  }, label);
}

(async () => {
  const count = Number(process.env.FACTORY_PERF_ASSETS || 96);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (/error|warn|failed/i.test(text)) logs.push(text.slice(0, 500));
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.state && window.render && window.factoryState, null, { timeout: 60000 });

  const images = Array.from({ length: count }, (_, i) => makeSvgDataUrl(i + 1));
  const initial = await page.evaluate((payload) => {
    const stages = ['hero', 'size', 'cuts', 'options', 'detail'];
    const productName = '성능측정상품';
    const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(productName) : '성능측정상품';
    const inputImageFingerprint = window.factoryImagePayloadFingerprint
      ? window.factoryImagePayloadFingerprint(payload.images[0])
      : 'perf_input_v79';
    window.state.step = 'factory';
    window.state.productName = productName;
    window.state.imagePreview = payload.images[0];
    window.state.imageBase64 = payload.images[0].replace(/^data:image\/[^;,]+;base64,/i, '');
    const f = window.factoryState();
    f.product = f.product || {};
    f.product.productName = productName;
    f.product.currentRunId = 'perf_run_v79';
    f.product.lockedCurrentRunId = 'perf_run_v79';
    f.product.productKey = productKey;
    f.product.lockedProductKey = productKey;
    f.product.inputImageFingerprint = inputImageFingerprint;
    f.product.lockedInputImageFingerprint = inputImageFingerprint;
    f.product.imagePreview = payload.images[0];
    f.product.imageBase64 = payload.images[0].replace(/^data:image\/[^;,]+;base64,/i, '');
    f.product.inputImages = [{
      id: 'perf_input_image',
      name: '성능측정 입력 이미지',
      base64: f.product.imageBase64,
      preview: payload.images[0],
      mime: 'image/svg+xml',
      hasImage: true,
      inputImageFingerprint,
    }];
    f.automation = f.automation || {};
    f.automation.currentRunId = 'perf_run_v79';
    f.automation.activeTab = 'assets';
    f.uiPanels = f.uiPanels || {};
    f.uiPanels.assets = true;
    f.assetListExpanded = true;
    f.stages = f.stages || {};
    stages.forEach(stageId => {
      f.stages[stageId] = {
        ...(f.stages[stageId] || {}),
        status: 'done',
        currentRunId: 'perf_run_v79',
        latestGenerationRunId: 'perf_run_v79',
      };
    });
    f.assets = payload.images.map((image, index) => ({
      id: `perf_asset_${index}`,
      stageId: stages[index % stages.length],
      type: index % stages.length === 4 ? 'html' : 'image',
      title: `성능 측정 이미지 ${index + 1}`,
      image,
      html: index % stages.length === 4 ? `<section><img src="${image}"><p>성능 측정 상세 ${index + 1}</p></section>` : '',
      used: index % 13 === 0,
      currentRunId: 'perf_run_v79',
      productKey,
      inputImageFingerprint,
      generationRunId: 'perf_run_v79',
      metadata: {
        currentRunId: 'perf_run_v79',
        productKey,
        productIdentityKey: productKey,
        productName,
        inputImageFingerprint,
        inputImageKey: inputImageFingerprint,
        sourceImageKey: inputImageFingerprint,
        productImageKey: inputImageFingerprint,
        generationRunId: 'perf_run_v79',
        stageId: stages[index % stages.length],
        presetLabel: '성능측정',
      },
      sourceMap: {
        currentRunId: 'perf_run_v79',
        productKey,
        productIdentityKey: productKey,
        productName,
        inputImageFingerprint,
        inputImageKey: inputImageFingerprint,
        sourceImageKey: inputImageFingerprint,
        productImageKey: inputImageFingerprint,
        generationRunId: 'perf_run_v79',
        stageId: stages[index % stages.length],
      },
    }));
    window.state.factory = window.normalizeFactoryState ? window.normalizeFactoryState(f) : f;
    const start = performance.now();
    window.render();
    return { renderCallMs: Math.round(performance.now() - start) };
  }, { images });

  await page.waitForTimeout(900);
  await page.locator('[data-factory-auto-tab="assets"]').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('[data-factory-toggle-assets]').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const target = document.querySelector('#factoryAutomationAssetChooser_hero') || document.querySelector('[data-factory-toggle-assets]');
    target?.scrollIntoView?.({ block: 'start' });
  });
  await page.waitForTimeout(500);
  const afterRender = await collect(page, 'after-render');
  const toggle = await page.evaluate(() => {
    const btn = document.querySelector('[data-factory-toggle-assets]');
    if (!btn) return { found: false, clickMs: 0, renderMs: window.__KUASANGSE_RENDER_LAST_MS__ || 0 };
    const start = performance.now();
    btn.click();
    return {
      found: true,
      clickMs: Math.round(performance.now() - start),
      renderMs: window.__KUASANGSE_RENDER_LAST_MS__ || 0,
    };
  });
  await page.waitForTimeout(500);
  const afterToggle = await collect(page, 'after-toggle');
  await page.screenshot({ path: path.join(OUT_DIR, 'factory-perf-v79.png'), fullPage: false });
  await browser.close();

  console.log(JSON.stringify({
    url: APP_URL,
    count,
    initial,
    afterRender,
    toggle,
    afterToggle,
    consoleWarnings: logs.slice(0, 12),
    screenshot: path.join(OUT_DIR, 'factory-perf-v79.png'),
  }, null, 2));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
