const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9334';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const START_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-start-v183.png');
const DONE_SCREENSHOT = path.join(OUT_DIR, 'factory-detail-progress-done-v183.png');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?visualBust=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

    const readGoal = `(() => {
      const node = document.querySelector('[data-factory-goal-status="automation"]');
      const stage = node?.querySelector('[data-factory-goal-stage]');
      return {
        title: node?.querySelector('[data-factory-goal-title]')?.textContent?.trim() || '',
        stage: stage?.textContent?.trim() || '',
        running: stage?.dataset.running === '1',
        ellipsis: !!stage?.querySelector('.factory-live-ellipsis'),
      };
    })()`;
    const start = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      factory.automation = { ...(factory.automation || {}), activeTab: 'competitor', activeTaskId: 'competitor-candidates' };
      factory.goalRun = { running: true, progress: 58, currentStage: 'VM 상세페이지 수집 중', failureReason: '', activeOperationId: '' };
      window.state.step = 'factory';
      window.render();
      return ${readGoal};
    })()`);
    const startShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(START_SCREENSHOT, Buffer.from(startShot.data, 'base64'));

    const done = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      factory.goalRun = { running: false, progress: 64, currentStage: 'VM 상세페이지 수집 완료 · 이미지 1장', failureReason: '', activeOperationId: '' };
      window.render();
      return ${readGoal};
    })()`);
    const doneShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(DONE_SCREENSHOT, Buffer.from(doneShot.data, 'base64'));

    const failures = [];
    if (!start.running || !start.ellipsis || !/상세페이지 수집 중/.test(start.stage)) failures.push(`start visual state mismatch: ${JSON.stringify(start)}`);
    if (done.running || done.ellipsis || !/상세페이지 수집 완료/.test(done.stage)) failures.push(`done visual state mismatch: ${JSON.stringify(done)}`);
    const payload = { ok: failures.length === 0, start, done, screenshots: { start: START_SCREENSHOT, done: DONE_SCREENSHOT } };
    console.log(JSON.stringify(payload, null, 2));
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
