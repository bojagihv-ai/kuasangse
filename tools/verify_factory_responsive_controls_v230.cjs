const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9490';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const NARROW_SCREENSHOT = path.join(OUT_DIR, 'factory-responsive-size-confirm-v230.png');
const WAIT_SCREENSHOT = path.join(OUT_DIR, 'factory-responsive-size-wait-v230.png');
const FOLLOWUP_SCREENSHOT = path.join(OUT_DIR, 'factory-responsive-followup-controls-v230.png');
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
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);

    const narrow = await evaluateFactoryCdpFixture(cdp, `async ({
      setAppState,
      readFactory,
      replaceFactory,
      renderApp,
    }) => {
      const productName = '슬라브나비수저집';
      const workspaceId = 'responsive-size-confirm-v230';
      setAppState({
        step: 'factory',
        currentProjectId: workspaceId,
        currentProjectName: '사이즈 확인 반응형 검증',
        productName,
      });
      const factory = normalizeFactoryState({});
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
      replaceFactory(factory, { mode: 'hydrate', reason: 'cdp-responsive-size-v230', workspaceId });
      window.saveLastWorkNow = () => {};
      window.scheduleLastWorkSave = () => {};
      window.factoryLog = () => {};
      await renderApp();
      const currentFactory = readFactory();
      const button = document.querySelector('[data-factory-confirm-size-image]');
      button?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = button?.getBoundingClientRect();
      const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      const scrollRoot = document.querySelector('.app');
      const review = factoryAutomationSizeReviewStatus(currentFactory);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        button: rect ? {
          text: button.textContent.trim(), disabled: button.disabled, hitIsButton: hit === button,
          top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height),
        } : null,
        requiredMissing: review.requiredMissing.map(item => item.fieldId),
        main: scrollRoot ? { scrollHeight: scrollRoot.scrollHeight, clientHeight: scrollRoot.clientHeight, overflowY: getComputedStyle(scrollRoot).overflowY } : null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    }`);
    const narrowPng = await capture(cdp, NARROW_SCREENSHOT);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 620, deviceScaleFactor: 1, mobile: false });
    const wait = await evaluateFactoryCdpFixture(cdp, `async ({
      setAppState,
      replaceFactory,
      renderApp,
    }) => {
      const productName = '상태 레일 반응형 검증 수저집';
      const workspaceId = 'responsive-status-rail-v230';
      setAppState({
        step: 'factory',
        currentProjectId: workspaceId,
        currentProjectName: '상태 레일 반응형 검증',
        productName,
      });
      const factory = normalizeFactoryState({});
      factory.workspace = { ...factory.workspace, id: workspaceId };
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
      replaceFactory(factory, { mode: 'hydrate', reason: 'cdp-responsive-rail-v230', workspaceId });
      await renderApp();
      const panel = document.querySelector('[data-factory-candidate-size-wait]');
      const layout = document.querySelector('.factory-automation-grid');
      const layoutPanels = Array.from(layout?.children || []).filter(node => node.matches?.('.factory-automation-panel'));
      const primaryPanel = layoutPanels[0] || null;
      const candidatePanel = document.querySelector('.factory-candidate-automation-panel');
      const scrollRoot = document.querySelector('.app');
      panel?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const panelRect = panel?.getBoundingClientRect();
      const primaryRect = primaryPanel?.getBoundingClientRect();
      const candidateRect = candidatePanel?.getBoundingClientRect();
      const overlapWidth = primaryRect && candidateRect ? Math.max(0, Math.min(primaryRect.right, candidateRect.right) - Math.max(primaryRect.left, candidateRect.left)) : 0;
      const overlapHeight = primaryRect && candidateRect ? Math.max(0, Math.min(primaryRect.bottom, candidateRect.bottom) - Math.max(primaryRect.top, candidateRect.top)) : 0;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panelText: panel?.textContent || '',
        messageVisible: !!panel && /자동 생성하지 않습니다/.test(panel.textContent || ''),
        runButtonVisible: !!panel?.querySelector('[data-factory-run-stage="size"]'),
        panelInViewport: !!panelRect && panelRect.top >= 0 && panelRect.bottom <= innerHeight,
        layout: layout ? {
          display: getComputedStyle(layout).display,
          columns: getComputedStyle(layout).gridTemplateColumns,
          panelCount: layoutPanels.length,
          tabCount: document.querySelectorAll('[data-factory-auto-tab]').length,
        } : null,
        candidatePanel: candidateRect ? {
          present: true,
          separate: candidateRect.left >= primaryRect.right || candidateRect.top >= primaryRect.bottom,
          width: Math.round(candidateRect.width),
          height: Math.round(candidateRect.height),
        } : null,
        overlapArea: overlapWidth * overlapHeight,
        main: scrollRoot ? { scrollHeight: scrollRoot.scrollHeight, clientHeight: scrollRoot.clientHeight, overflowY: getComputedStyle(scrollRoot).overflowY } : null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    }`);
    const waitPng = await capture(cdp, WAIT_SCREENSHOT);
    const sizeTargets = await evaluate(cdp, `(() => {
      const panel = document.querySelector('[data-factory-candidate-size-wait]');
      const inspect = selector => {
        const node = panel?.querySelector(selector) || null;
        node?.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rect = node?.getBoundingClientRect();
        const style = node ? getComputedStyle(node) : null;
        const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return {
          selector,
          present: !!node,
          panelScoped: !!node && node.closest('[data-factory-candidate-size-wait]') === panel,
          text: String(node?.textContent || '').trim(),
          disabled: !!node?.disabled,
          disabledReason: String(node?.title || ''),
          visible: !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden',
          inViewport: !!rect && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
          hitTestReachable: !!node && (node === hit || node.contains?.(hit)),
          top: rect ? Math.round(rect.top) : null,
          bottom: rect ? Math.round(rect.bottom) : null,
        };
      };
      return {
        runStage: inspect('[data-factory-run-stage="size"]'),
        focusGuide: inspect('[data-factory-guide-action="focus-size"]'),
      };
    })()`);
    const followupPng = await capture(cdp, FOLLOWUP_SCREENSHOT);

    const checks = [
      { ok: narrow.button?.text === '이 사이즈로 확인 완료' && !narrow.button.disabled && narrow.button.hitIsButton, message: `좁은 화면 사이즈 확인 버튼: ${JSON.stringify(narrow)}` },
      { ok: narrow.requiredMissing.length === 0 && narrow.button?.top >= 0 && narrow.button?.bottom <= narrow.viewport.height, message: `좁은 화면 필수값/도달성: ${JSON.stringify(narrow)}` },
      { ok: narrow.main?.scrollHeight > narrow.main?.clientHeight && /auto|scroll/.test(narrow.main?.overflowY || '') && !narrow.horizontalOverflow, message: `좁은 화면 스크롤/가로 넘침: ${JSON.stringify(narrow)}` },
      { ok: wait.messageVisible && wait.runButtonVisible && wait.panelInViewport, message: `1280×620 대기 카드: ${JSON.stringify(wait)}` },
      { ok: wait.layout?.display === 'grid' && wait.layout?.panelCount >= 2 && wait.layout?.tabCount === 7 && wait.candidatePanel?.present && wait.candidatePanel?.separate && wait.overlapArea === 0, message: `1280×620 canonical 공정 패널 배치: ${JSON.stringify(wait)}` },
      {
        ok: sizeTargets.runStage?.present
          && sizeTargets.runStage.panelScoped
          && sizeTargets.runStage.visible
          && sizeTargets.runStage.inViewport
          && sizeTargets.runStage.hitTestReachable
          && sizeTargets.runStage.disabled
          && /가로\/세로\/규격/.test(sizeTargets.runStage.disabledReason),
        message: `1280×620 사이즈 생성 대상(미확정 상태에서는 disabled지만 도달 가능): ${JSON.stringify(sizeTargets.runStage)}`,
      },
      {
        ok: sizeTargets.focusGuide?.present
          && sizeTargets.focusGuide.panelScoped
          && sizeTargets.focusGuide.visible
          && sizeTargets.focusGuide.inViewport
          && sizeTargets.focusGuide.hitTestReachable
          && !sizeTargets.focusGuide.disabled
          && sizeTargets.focusGuide.text === '생성컷 선택에서 확인',
        message: `1280×620 사이즈 focus 안내 대상: ${JSON.stringify(sizeTargets.focusGuide)}`,
      },
      { ok: wait.main?.scrollHeight > wait.main?.clientHeight && /auto|scroll/.test(wait.main?.overflowY || '') && !wait.horizontalOverflow, message: `1280×620 페이지 스크롤/가로 넘침: ${JSON.stringify(wait)}` },
      { ok: narrowPng.valid && narrowPng.width === 535 && narrowPng.height === 697, message: `좁은 화면 PNG: ${JSON.stringify(narrowPng)}` },
      { ok: waitPng.valid && followupPng.valid && waitPng.width === 1280 && waitPng.height === 620 && followupPng.width === 1280 && followupPng.height === 620, message: `1280×620 PNG: ${JSON.stringify({ waitPng, followupPng })}` },
    ];
    const result = {
      ok: checks.every(check => check.ok), narrow, wait, sizeTargets,
      screenshots: { narrow: NARROW_SCREENSHOT, wait: WAIT_SCREENSHOT, followup: FOLLOWUP_SCREENSHOT },
      png: { narrow: narrowPng, wait: waitPng, followup: followupPng }, checks,
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
