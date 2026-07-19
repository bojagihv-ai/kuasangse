const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9360';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-new-work-preserves-input-image-v166.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-new-work-preserves-input-image-v166.json');

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
      width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1280),
      height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 900),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?newWorkInputImage=v166` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.startBlankWorkDraft)', 60000);
    const result = await evaluate(cdp, `(async () => {
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M/wHwAF/gL+Q8rXAAAAAElFTkSuQmCC';
      const preview = 'data:image/png;base64,' + base64;
      const productName = '새 작업 기본이미지 보존 검증';
      const fingerprint = 'new-work-input-image-fingerprint-v166';
      const factory = window.normalizeFactoryState({});
      window.state.step = 'factory';
      window.state.currentProjectId = 'project:new-work-input-v166';
      window.state.currentProjectName = productName;
      window.state.currentProjectCreatedAt = Date.now();
      window.state.productName = productName;
      window.state.imageBase64 = base64;
      window.state.imagePreview = preview;
      window.state.imageMime = 'image/png';
      window.state.imageName = 'new-work-input-v166.png';
      window.state.analysisImages = [{ name: 'new-work-input-v166.png', mime: 'image/png', base64, preview }];
      factory.workspace = { ...(factory.workspace || {}), id: 'project:new-work-input-v166', name: productName };
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        imageBase64: base64,
        imagePreview: preview,
        imageMime: 'image/png',
        imageName: 'new-work-input-v166.png',
        inputImageFingerprint: fingerprint,
        lockedInputImageFingerprint: fingerprint,
        hasImage: true,
        inputImages: [{ id: 'new-work-input-v166', name: 'new-work-input-v166.png', mime: 'image/png', base64, preview, inputImageFingerprint: fingerprint, lockedInput: true }],
      };
      window.state.factory = factory;
      window.render();
      const start = window.startBlankWorkDraft();
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const discard = document.querySelector('#workspaceDocumentModal [data-choice="discard"]');
        if (discard) {
          discard.click();
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await start;
      const restoredFactory = window.factoryState();
      const restoredInput = Array.isArray(restoredFactory.product?.inputImages)
        ? restoredFactory.product.inputImages.find(item => item?.base64 === base64 || String(item?.preview || '').includes(base64))
        : null;
      const restoredPreview = String(window.factoryProductPreview(restoredFactory) || '');
      const imageNodes = [...document.querySelectorAll('img')].filter(img => String(img.src || '').includes(base64));
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        stateImageBase64: window.state.imageBase64 === base64,
        stateImagePreview: String(window.state.imagePreview || '').includes(base64),
        stateImageMime: window.state.imageMime || '',
        stateProductName: window.state.productName || '',
        factoryImageBase64: restoredFactory.product?.imageBase64 === base64,
        factoryImagePreview: String(restoredFactory.product?.imagePreview || '').includes(base64),
        factoryHasImage: restoredFactory.product?.hasImage === true,
        factoryInputBase64: restoredInput?.base64 === base64,
        factoryInputPreview: String(restoredInput?.preview || '').includes(base64),
        factoryImageReference: restoredFactory.product?.imageRef || '',
        factoryInputHasImage: Array.isArray(restoredFactory.product?.inputImages) && restoredFactory.product.inputImages.some(item => item?.hasImage === true),
        factoryPreviewHasData: restoredPreview.includes(base64),
        renderedImageCount: imageNodes.length,
        factoryInputFingerprint: restoredFactory.product?.inputImageFingerprint || '',
        candidates: Array.isArray(restoredFactory.product?.competitors) ? restoredFactory.product.competitors.length : 0,
        assets: Array.isArray(restoredFactory.assets) ? restoredFactory.assets.length : 0,
        notice: String(window.state.uiNotice?.message || window.state.uiNotice || ''),
      };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: result.buildId === '20260713-candidate-scope-oauth-refresh-ui-v168', message: `unexpected build: ${result.buildId}` },
      { ok: result.stateImageBase64 === true && result.stateImagePreview === true, message: '새 작업 후 앱 기본이미지가 보존되지 않았습니다.' },
      { ok: result.factoryHasImage === true && result.factoryImageReference === 'current-product-image' && result.factoryPreviewHasData === true, message: '새 작업 후 조립공장 기본이미지가 보존되지 않았습니다.' },
      { ok: result.factoryInputHasImage === true, message: '새 작업 후 조립공장 입력 이미지 목록이 보존되지 않았습니다.' },
      { ok: result.stateProductName === '', message: `새 작업 제품명이 초기화되지 않았습니다: ${result.stateProductName}` },
      { ok: result.candidates === 0 && result.assets === 0, message: `새 작업에서 이전 후보/자산이 남았습니다: ${JSON.stringify({ candidates: result.candidates, assets: result.assets })}` },
    ];
    const payload = { ok: checks.every(check => check.ok), result, checks, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    assertChecks(checks);
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
