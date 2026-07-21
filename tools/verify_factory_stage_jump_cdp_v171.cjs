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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9343';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-stage-jump-cuts-v171.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-stage-jump-cuts-v171.json');

function imageCutJumpState() {
  return `(() => {
    const factory = typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : {};
    const scrollRoot = document.querySelector('.app');
    const target = document.querySelector('#factoryAutomationAssetChooser_cuts');
    const rootRect = scrollRoot?.getBoundingClientRect();
    const targetRect = target?.getBoundingClientRect();
    const targetVisible = !!(rootRect && targetRect && targetRect.bottom > rootRect.top && targetRect.top < rootRect.bottom);
    return {
      activeTab: String(factory.automation?.activeTab || ''),
      assetsOpen: factory.uiPanels?.assets === true,
      targetExists: !!target,
      targetVisible,
      rootScrollTop: Number(scrollRoot?.scrollTop || 0),
      missingPositionLogs: (factory.logs || [])
        .map(log => log?.message || log?.text || String(log || ''))
        .filter(message => message.includes('이미지컷 위치를 아직 찾지 못했습니다.')),
    };
  })()`;
}

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
      width: 1280,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyStageJump=${Date.now()}` });
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);
    const before = await evaluateFactoryCdpFixture(cdp, `async ({ setAppState, cloneFactory, replaceFactory, renderApp }) => {
      const factory = cloneFactory();
      setAppState({ step: 'factory' });
      factory.automation = { ...(factory.automation || {}), activeTab: 'start' };
      factory.uiPanels = { ...(factory.uiPanels || {}), assets: false };
      factory.activeStage = 'db';
      factory.logs = [];
      replaceFactory(factory);
      await renderApp();
      const button = document.querySelector('[data-factory-stage-jump="cuts"]');
      if (!button) throw new Error('image-cut stage jump button not found');
      return { buttonText: String(button.textContent || '').trim(), ...(${imageCutJumpState()}) };
    }`);
    const click = await evaluate(cdp, `(() => {
      const button = document.querySelector('[data-factory-stage-jump="cuts"]');
      if (!button) throw new Error('image-cut stage jump button disappeared');
      button.click();
      return { clicked: true, buttonText: String(button.textContent || '').trim() };
    })()`);
    let targetWaitError = '';
    try {
      await waitFor(cdp, `(() => {
        const state = ${imageCutJumpState()};
        return state.activeTab === 'assets' && state.assetsOpen && state.targetExists && state.targetVisible;
      })()`, 5000);
    } catch (error) {
      targetWaitError = error?.message || String(error);
    }
    const after = await evaluate(cdp, imageCutJumpState());
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: before.activeTab === 'start' && before.targetExists === false, message: `precondition did not start from a closed asset panel: ${JSON.stringify(before)}` },
      { ok: click.clicked === true, message: `image-cut stage jump did not click: ${JSON.stringify(click)}` },
      { ok: after.activeTab === 'assets' && after.assetsOpen, message: `image-cut jump did not open the asset tab: ${JSON.stringify(after)}` },
      { ok: after.targetExists && after.targetVisible, message: `image-cut jump target is not rendered and visible: ${JSON.stringify({ after, targetWaitError })}` },
      { ok: after.missingPositionLogs.length === 0, message: `image-cut jump logged a false missing-position warning: ${JSON.stringify(after.missingPositionLogs)}` },
    ];
    const payload = {
      ok: checks.every(check => check.ok),
      before,
      click,
      after,
      targetWaitError,
      screenshot: SCREENSHOT_PATH,
      failures: checks.filter(check => !check.ok).map(check => check.message),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    try { await cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
