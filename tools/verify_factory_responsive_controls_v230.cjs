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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9490';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const NARROW_SCREENSHOT = path.join(OUT_DIR, 'factory-responsive-size-confirm-v230.png');
const WAIT_SCREENSHOT = path.join(OUT_DIR, 'factory-responsive-size-wait-v230.png');
const RAIL_SCREENSHOT = path.join(OUT_DIR, 'factory-responsive-status-rail-v230.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-responsive-controls-v230.json');

function pngInfo(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  return {
    signature,
    valid: signature === '89504e470d0a1a0a',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

async function capture(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return pngInfo(file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 535, height: 697, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${APP_URL}?responsiveControls=v230` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.render)', 60000);

    const narrow = await evaluate(cdp, `(() => {
      const productName = '슬라브나비수저집';
      state.step = 'factory';
      state.currentProjectId = 'responsive-size-confirm-v230';
      state.currentProjectName = '사이즈 확인 반응형 검증';
      state.productName = productName;
      state.factory = normalizeFactoryState({});
      const factory = factoryState();
      factory.product = {
        ...factory.product,
        productName,
        userProductName: productName,
        productKey: factoryNormalizeIdentityText(productName),
        confirmedDb: {
          product_name: productName,
          dimensions: '가로 4.8cm x 세로 23cm',
          spec: { width_mm: '4.8cm', depth_mm: '23cm', product_weight_g: '4g' },
        },
      };
      factory.automation = { ...factory.automation, activeTab: 'assets' };
      window.saveLastWorkNow = () => {};
      window.scheduleLastWorkSave = () => {};
      window.factoryLog = () => {};
      render();
      const button = document.querySelector('[data-factory-confirm-size-image]');
      button?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = button?.getBoundingClientRect();
      const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      const main = document.querySelector('main.main');
      const review = factoryAutomationSizeReviewStatus(factory);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        button: rect ? {
          text: button.textContent.trim(), disabled: button.disabled, hitIsButton: hit === button,
          top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height),
        } : null,
        requiredMissing: review.requiredMissing.map(item => item.fieldId),
        main: main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, overflowY: getComputedStyle(main).overflowY } : null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    })()`);
    const narrowPng = await capture(cdp, NARROW_SCREENSHOT);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 620, deviceScaleFactor: 1, mobile: false });
    const wait = await evaluate(cdp, `(() => {
      const productName = '상태 레일 반응형 검증 수저집';
      state.step = 'factory';
      state.currentProjectId = 'responsive-status-rail-v230';
      state.currentProjectName = '상태 레일 반응형 검증';
      state.productName = productName;
      state.factory = normalizeFactoryState({});
      const factory = factoryState();
      factory.workspace = { ...factory.workspace, id: state.currentProjectId };
      factory.product = {
        ...factory.product, productName, userProductName: productName,
        productKey: factoryNormalizeIdentityText(productName), selectedDbCandidateKey: 'DB-RAIL-V230',
        dbCandidateResolution: 'selected', confirmedDb: { jcode: 'DB-RAIL-V230', product_name: productName },
      };
      factory.automation = { ...factory.automation, activeTab: 'db' };
      factory.stages.size = {
        ...factory.stages.size, status: 'blocked',
        message: '신화사DB 확정 완료. 사이즈값을 확인했습니다. 사이즈이미지를 자동 생성하지 않습니다. 생성컷 선택에서 사이즈이미지 생성을 누르거나 전체 자동 실행을 사용해주세요.',
      };
      render();
      const panel = document.querySelector('[data-factory-candidate-size-wait]');
      const rail = document.querySelector('.factory-run-status-rail');
      const layout = document.querySelector('.factory-page-layout');
      const main = document.querySelector('main.main');
      panel?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const panelRect = panel?.getBoundingClientRect();
      const railRect = rail?.getBoundingClientRect();
      const overlapWidth = panelRect && railRect ? Math.max(0, Math.min(panelRect.right, railRect.right) - Math.max(panelRect.left, railRect.left)) : 0;
      const overlapHeight = panelRect && railRect ? Math.max(0, Math.min(panelRect.bottom, railRect.bottom) - Math.max(panelRect.top, railRect.top)) : 0;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panelText: panel?.textContent || '',
        messageVisible: !!panel && /자동 생성하지 않습니다/.test(panel.textContent || ''),
        runButtonVisible: !!panel?.querySelector('[data-factory-run-stage="size"]'),
        panelInViewport: !!panelRect && panelRect.top >= 0 && panelRect.bottom <= innerHeight,
        layout: layout ? { display: getComputedStyle(layout).display, flexDirection: getComputedStyle(layout).flexDirection } : null,
        rail: railRect ? { position: getComputedStyle(rail).position, belowPanel: railRect.top >= panelRect.bottom, width: Math.round(railRect.width), height: Math.round(railRect.height) } : null,
        overlapArea: overlapWidth * overlapHeight,
        main: main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, overflowY: getComputedStyle(main).overflowY } : null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    })()`);
    const waitPng = await capture(cdp, WAIT_SCREENSHOT);
    const rail = await evaluate(cdp, `(() => {
      const node = document.querySelector('.factory-run-status-rail');
      node?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = node?.getBoundingClientRect();
      return rect ? { inViewport: rect.top >= 0 && rect.bottom <= innerHeight, top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null;
    })()`);
    const railPng = await capture(cdp, RAIL_SCREENSHOT);

    const checks = [
      { ok: narrow.button?.text === '이 사이즈로 확인 완료' && !narrow.button.disabled && narrow.button.hitIsButton, message: `좁은 화면 사이즈 확인 버튼: ${JSON.stringify(narrow)}` },
      { ok: narrow.requiredMissing.length === 0 && narrow.button?.top >= 0 && narrow.button?.bottom <= narrow.viewport.height, message: `좁은 화면 필수값/도달성: ${JSON.stringify(narrow)}` },
      { ok: narrow.main?.scrollHeight > narrow.main?.clientHeight && /auto|scroll/.test(narrow.main?.overflowY || '') && !narrow.horizontalOverflow, message: `좁은 화면 스크롤/가로 넘침: ${JSON.stringify(narrow)}` },
      { ok: wait.messageVisible && wait.runButtonVisible && wait.panelInViewport, message: `1280×620 대기 카드: ${JSON.stringify(wait)}` },
      { ok: wait.layout?.display === 'flex' && wait.layout?.flexDirection === 'column' && wait.rail?.position === 'static' && wait.rail?.belowPanel && wait.overlapArea === 0, message: `1280×620 상태 레일 배치: ${JSON.stringify(wait)}` },
      { ok: wait.main?.scrollHeight > wait.main?.clientHeight && /auto|scroll/.test(wait.main?.overflowY || '') && rail?.inViewport && !wait.horizontalOverflow, message: `1280×620 상태 레일 도달성: ${JSON.stringify({ wait, rail })}` },
      { ok: narrowPng.valid && narrowPng.width === 535 && narrowPng.height === 697, message: `좁은 화면 PNG: ${JSON.stringify(narrowPng)}` },
      { ok: waitPng.valid && railPng.valid && waitPng.width === 1280 && waitPng.height === 620 && railPng.width === 1280 && railPng.height === 620, message: `1280×620 PNG: ${JSON.stringify({ waitPng, railPng })}` },
    ];
    const result = {
      ok: checks.every(check => check.ok), narrow, wait, rail,
      screenshots: { narrow: NARROW_SCREENSHOT, wait: WAIT_SCREENSHOT, rail: RAIL_SCREENSHOT },
      png: { narrow: narrowPng, wait: waitPng, rail: railPng }, checks,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    assertChecks(checks);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup?.();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
