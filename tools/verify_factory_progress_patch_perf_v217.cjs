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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9337';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-lag-progress-patch-v217.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-lag-progress-patch-v217.json');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?factoryProgressPatch=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryStartGoalHeartbeat && window.factoryStopGoalHeartbeat)', 60000);

    const result = await evaluate(cdp, `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const factory = window.factoryState();
      const stages = ['db', 'hero', 'size', 'options', 'cuts', 'detail', 'export'];
      window.state.step = 'factory';
      factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
      factory.goalRun = {
        running: true,
        progress: 20,
        currentStage: '진행 패치 성능 검증',
        failureReason: '',
        activeOperationId: 'factory-progress-patch-v217',
      };
      factory.stages = factory.stages || {};
      stages.forEach(stageId => {
        factory.stages[stageId] = { ...(factory.stages[stageId] || {}), status: 'running', message: '검증 대기' };
      });
      factory.logs = Array.from({ length: 80 }, (_, index) => ({
        time: '오전 10:00:00',
        type: index % 5 === 0 ? 'warn' : 'info',
        stageId: stages[index % stages.length],
        message: '진행 패치 성능 검증 로그 ' + (index + 1),
      }));
      window.render();
      await wait(40);

      const original = window.renderFactoryStageRailBody;
      let stageRailRenderCount = 0;
      window.renderFactoryStageRailBody = (...args) => {
        stageRailRenderCount += 1;
        return original(...args);
      };
      window.factoryPatchGoalRunStatusInPlace();
      stageRailRenderCount = 0;

      for (let progress = 22; progress <= 80; progress += 2) {
        factory.goalRun.progress = progress;
        window.factoryPatchGoalRunStatusInPlace();
      }
      window.renderFactoryStageRailBody = original;
      factory.goalRun.running = false;
      window.factoryPatchGoalRunStatusInPlace();
      return {
        stageRailRenderCount,
        logCount: factory.logs.length,
        statusNodeCount: document.querySelectorAll('[data-factory-goal-status]').length,
        stageRailNodeCount: document.querySelectorAll('[data-factory-stage-log-container]').length,
        progress: factory.goalRun.progress,
      };
    })()`);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    const failures = [];
    if (result.statusNodeCount < 1) failures.push('조립공장 진행 상태 패널을 렌더하지 못했습니다.');
    if (result.stageRailNodeCount < 1) failures.push('조립공장 공정/로그 패널을 렌더하지 못했습니다.');
    if (result.logCount !== 80) failures.push(`검증용 로그 80건이 유지되지 않았습니다: ${result.logCount}`);
    if (result.stageRailRenderCount !== 0) failures.push(`새 로그나 공정 상태 변경이 없는 하트비트가 공정/로그 패널을 ${result.stageRailRenderCount}회 다시 만들었습니다.`);
    const payload = { ok: failures.length === 0, result, failures, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
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
