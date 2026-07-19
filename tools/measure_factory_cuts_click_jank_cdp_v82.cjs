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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAADICAIAAADdvUsCAAABFUlEQVR4nO3UMQ0AAAwDsP1T2hkFQgmwJqC7YwAAwK8GgA0gA2gAG0AG0AE0gAygAWwAGUADyAAawAaQATSADKABbAAZQAPoABpABtAAMoAGsAFkAA1gA8gAGkAG0AAygAawAWQADWADyAAaQAbQADKABrABZAANYAPoABpABtAAMoAGsAFkAA1gA8gAGkAG0AAygAawAWQADWADyAAaQAbQADKABrABZAANYAPoABpABtAAMoAGsAFkAA1gA8gAGkAG0AAygAawAWQADWADyAAaQAbQADKABrABZAANYAPoABpABtAAMoAGsAFkAA1gA8gAGkAG0AAygAawAWQADWADyAAaQAbQADKABrABZAANYAPoABpABtAAMoAGsAEeL7sBP4F9GxQAAAAASUVORK5CYII=';

function svgDataUrl(label, color = '#ef4444') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650" viewBox="0 0 900 650">
    <rect width="900" height="650" fill="#fff7f2"/>
    <rect x="120" y="170" width="660" height="300" rx="34" fill="${color}"/>
    <text x="450" y="340" text-anchor="middle" font-size="46" font-family="Arial" fill="#ffffff">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = cdpRuntime.targets.find(item => item.type === 'page') || cdpRuntime.targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

  const setupMissing = await evaluate(cdp, `(() => {
    const f = window.factoryState();
    const productName = '띠수네모동전지갑';
    f.product = f.product || {};
    f.product.productName = productName;
    f.product.imageBase64 = '';
    f.product.imagePreview = '';
    f.product.inputImages = [];
    f.product.lockedInputImageFingerprint = '';
    f.automation = f.automation || {};
    f.automation.activeTab = 'start';
    window.state.productName = productName;
    window.state.imageBase64 = '';
    window.state.imagePreview = '';
    window.state.step = 'imagecuts';
    window.state.cuts = window.state.cuts || {};
    window.state.cuts.factoryStageId = 'cuts';
    window.state.cuts.promptSlotCount = 3;
    window.state.cuts.prompts = [
      { id: 'cut1', label: '컷 1', prompt: '밝은 배경 대표 컷', result: null, generating: false },
      { id: 'cut2', label: '컷 2', prompt: '진열컷', result: null, generating: false },
      { id: 'cut3', label: '컷 3', prompt: '감성컷', result: null, generating: false },
    ];
    window.state.cuts.sourceBase64 = '';
    window.state.cuts.sourcePreview = '';
    window.state.cuts.workImageBase64 = '';
    window.state.cuts.workImagePreview = '';
    window.render();
    const allBtn = document.getElementById('genAllCutsBtn');
    return {
      hasMissingNotice: /현재 제품 원본이 비어/.test(document.body.innerText || ''),
      hasPickButton: !!document.querySelector('[data-cuts-pick-current-product]'),
      hasStartButton: !!document.querySelector('[data-cuts-go-factory-start]'),
      allDisabled: !!allBtn?.disabled,
      allTitle: allBtn?.getAttribute('title') || '',
    };
  })()`);

  const setupFactory = await evaluate(cdp, `(() => {
    window.state.step = 'factory';
    const f = window.factoryState();
    f.automation = f.automation || {};
    f.automation.activeTab = 'start';
    window.render();
    return {
      hasQuickName: !!document.getElementById('factoryQuickProjectName'),
      hasQuickSave: !!document.getElementById('factoryQuickSaveProjectBtn'),
      hasQuickSaveAs: !!document.getElementById('factoryQuickSaveProjectAsBtn'),
      hasProductDrop: !!document.getElementById('factoryProductDrop'),
    };
  })()`);

  const fakeImage = svgDataUrl('current product', '#e11d48');
  const fakeResult = TINY_PNG_DATA_URL;
  const generateProof = await evaluate(cdp, `new Promise(async resolve => {
    const fakeImage = ${JSON.stringify(fakeImage)};
    const fakeResult = ${JSON.stringify(fakeResult)};
    const base64 = fakeImage.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const f = window.factoryState();
    const productName = '띠수네모동전지갑';
    f.product = f.product || {};
    f.product.productName = productName;
    f.product.imagePreview = fakeImage;
    f.product.imageBase64 = base64;
    f.product.imageMime = 'image/svg+xml';
    f.product.hasImage = true;
    const fingerprint = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(base64) : 'cuts_v82_input';
    if (window.factoryStampLockedInputImage) {
      window.factoryStampLockedInputImage(f, { base64, mime: 'image/svg+xml', preview: fakeImage, name: 'current-product.svg' }, { name: 'current-product.svg', setAt: Date.now() });
    } else {
      f.product.lockedInputImageFingerprint = fingerprint;
      f.product.inputImages = [{ id: 'cuts_v82_input', name: 'current-product.svg', base64, preview: fakeImage, mime: 'image/svg+xml', inputImageFingerprint: fingerprint, lockedInput: true }];
    }
    window.state.imageBase64 = base64;
    window.state.imagePreview = fakeImage;
    window.state.imageMime = 'image/svg+xml';
    if (window.syncProductImageAcrossWorkspaces) window.syncProductImageAcrossWorkspaces({ prefer: 'factory', lockInput: true });
    if (window.factoryApplyProductToApp) window.factoryApplyProductToApp();
    window.state.step = 'imagecuts';
    window.state.cuts.factoryStageId = 'cuts';
    window.state.cuts.promptSlotCount = 3;
    window.state.cuts.prompts = [
      { id: 'cut1', label: '컷 1', prompt: '밝은 배경 대표 컷', result: null, generating: false },
      { id: 'cut2', label: '컷 2', prompt: '진열컷', result: null, generating: false },
      { id: 'cut3', label: '컷 3', prompt: '감성컷', result: null, generating: false },
    ];
    if (window.factorySyncCutsSourceToCurrentProduct) window.factorySyncCutsSourceToCurrentProduct('cuts', { log: false });
    window.hasImageConnection = () => true;
    window.generateImageWithAbortableTimeout = async () => {
      await new Promise(r => setTimeout(r, 30));
      return fakeResult;
    };
    window.__cutsLongTasks = [];
    try {
      new PerformanceObserver(list => {
        window.__cutsLongTasks.push(...list.getEntries().map(entry => Math.round(entry.duration)));
      }).observe({ entryTypes: ['longtask'] });
    } catch (_) {}
    window.render();
    await new Promise(r => setTimeout(r, 80));
    const button = document.getElementById('genAllCutsBtn');
    const buttonState = {
      exists: !!button,
      disabled: !!button?.disabled,
      title: button?.getAttribute('title') || '',
      text: button?.innerText || '',
      sourcePart: !!(window.factorySourceImagePart && window.factorySourceImagePart('cuts', { preferStageInput: false })?.base64),
      productPayload: !!(window.currentProductImagePayload && window.currentProductImagePayload({ allowDerived: false, prefer: 'factory' })?.base64),
      productImages: Array.isArray(window.factoryState()?.product?.inputImages) ? window.factoryState().product.inputImages.length : 0,
      lockedFingerprint: window.factoryState()?.product?.lockedInputImageFingerprint || '',
    };
    const before = performance.now();
    button?.click();
    const clickReturnMs = Math.round(performance.now() - before);
    const started = Date.now();
    const timer = setInterval(() => {
      const resultCount = (window.state.cuts.prompts || []).filter(p => p.result).length;
      if (!window.state.cuts.runBusy && resultCount >= 3) {
        clearInterval(timer);
        resolve({
          clickReturnMs,
          buttonState,
          resultCount,
          runBusy: !!window.state.cuts.runBusy,
          bodyHasCuts: /이미지컷/.test(document.body.innerText || ''),
          longTasks: window.__cutsLongTasks || [],
          saveButtons: {
            quick: !!document.getElementById('factoryQuickSaveProjectBtn'),
          },
        });
      }
      if (Date.now() - started > 10000) {
        clearInterval(timer);
        resolve({
          clickReturnMs,
          buttonState,
          resultCount,
          runBusy: !!window.state.cuts.runBusy,
          bodyHasCuts: /이미지컷/.test(document.body.innerText || ''),
          longTasks: window.__cutsLongTasks || [],
          prompts: (window.state.cuts.prompts || []).map((p, index) => ({
            index,
            id: p.id,
            label: p.label,
            hasPrompt: !!String(p.prompt || '').trim(),
            hasResult: !!p.result,
            generating: !!p.generating,
            error: p.error || '',
            warning: p.warning || '',
          })),
          logs: (window.state.cuts.runLogs || []).slice(-12).map(log => ({
            type: log.type,
            message: log.message,
            detail: log.detail || '',
          })),
          timeout: true,
        });
      }
    }, 100);
  })`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(OUT_DIR, 'factory-cuts-click-cdp-v82.png');
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  cdp.close();
  await cdpRuntime.cleanup();

  const report = { url: APP_URL, setupMissing, setupFactory, generateProof, screenshot };
  console.log(JSON.stringify(report, null, 2));

  assertChecks([
    { ok: setupMissing.hasMissingNotice, message: '제품 원본 없음 안내가 보이지 않습니다.' },
    { ok: setupMissing.hasPickButton, message: '제품 사진 넣기 버튼이 없습니다.' },
    { ok: setupMissing.hasStartButton, message: '1단계 이동 버튼이 없습니다.' },
    { ok: setupMissing.allDisabled, message: '제품 원본이 없는데 전체 생성 버튼이 활성화되어 있습니다.' },
    { ok: /현재 제품 원본|제품 사진/.test(setupMissing.allTitle), message: `전체 생성 버튼 사유가 부정확합니다: ${setupMissing.allTitle}` },
    { ok: setupFactory.hasQuickName, message: '1단계 작업파일 이름 입력칸이 없습니다.' },
    { ok: setupFactory.hasQuickSave, message: '1단계 작업파일 저장 버튼이 없습니다.' },
    { ok: setupFactory.hasQuickSaveAs, message: '1단계 새 파일로 분리 버튼이 없습니다.' },
    { ok: setupFactory.hasProductDrop, message: '1단계 제품 사진 드롭 영역이 없습니다.' },
    { ok: !generateProof.timeout, message: '가짜 이미지컷 생성이 10초 안에 끝나지 않았습니다.' },
    { ok: generateProof.resultCount >= 3, message: `가짜 이미지컷 결과가 부족합니다: ${generateProof.resultCount}` },
    { ok: generateProof.clickReturnMs < 200, message: `생성 버튼 클릭 반환이 느립니다: ${generateProof.clickReturnMs}ms` },
    { ok: Math.max(0, ...(generateProof.longTasks || [])) < 250, message: `긴 메인스레드 작업이 남았습니다: ${(generateProof.longTasks || []).join(',')}` },
    { ok: generateProof.bodyHasCuts, message: '생성 후 이미지컷 화면 본문이 비었습니다.' },
  ]);

}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
