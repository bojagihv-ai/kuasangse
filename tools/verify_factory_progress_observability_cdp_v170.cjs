const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluateFactoryCdpFixture,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9334';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-progress-observability-v170.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-progress-observability-v170.json');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyBust=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryStartGoalHeartbeat && window.factoryClearRestoredImageGenerationRuntime)', 60000);
    const result = await evaluateFactoryCdpFixture(cdp, `async ({
      cloneFactory,
      readFactory,
      replaceFactory,
      renderApp,
      setAppState,
    }) => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const factory = cloneFactory();
      setAppState({ step: 'factory' });
      factory.automation = factory.automation || {};
      factory.automation.activeTab = 'db';
      factory.goalRun = {
        running: true,
        progress: 20,
        currentStage: '실시간 로그 간격 검증',
        failureReason: '',
        activeOperationId: 'observability-v170',
      };
      factory.logs = [];
      replaceFactory(factory);
      const timer = factoryStartGoalHeartbeat('실시간 로그 간격 검증', 20, 80, 10);
      await wait(90);
      factoryStopGoalHeartbeat(timer);
      const heartbeatLogDelta = (readFactory().logs || []).length;

      const recovered = cloneFactory();
      recovered.goalRun = {
        running: true,
        progress: 58,
        currentStage: '이미지 생성 중',
        failureReason: '',
        activeOperationId: '',
      };
      recovered.logs = [];
      recovered.stages = recovered.stages || {};
      recovered.stages.size = {
        ...(recovered.stages.size || {}),
        status: 'running',
        message: '기존 사이즈컷 전용 엔진으로 생성 중',
        currentRunId: 'stale_observability_v170',
        latestGenerationRunId: 'stale_observability_v170',
        generationRunId: 'stale_observability_v170',
        runStartedAt: Date.now() - 1000,
        runHeartbeatAt: Date.now() - 1000,
      };
      replaceFactory(recovered);
      state.cuts = state.cuts || {};
      state.cuts.sizeRunBusy = false;
      state.cuts.sizePrompts = [];
      const recoveryDiagnostics = {
        beforeGoal: structuredClone(readFactory().goalRun || {}),
        activeStageKeysBefore: Array.from(factoryActiveImageStageRunKeys),
      };
      const restored = factoryClearRestoredImageGenerationRuntime({ log: false, save: false, clearCutsRuntime: false });
      recoveryDiagnostics.afterGoal = structuredClone(readFactory().goalRun || {});
      recoveryDiagnostics.activeStageKeysAfter = Array.from(factoryActiveImageStageRunKeys);
      await renderApp();
      await wait(80);
      const goal = readFactory().goalRun || {};
      const statuses = [...document.querySelectorAll('[data-factory-goal-status]')].map(node => ({
        title: node.querySelector('[data-factory-goal-title]')?.innerText || '',
        pill: node.querySelector('[data-factory-goal-pill]')?.innerText || '',
        failure: node.querySelector('[data-factory-goal-failure]')?.innerText || '',
        failedBar: node.querySelector('.factory-progress')?.classList.contains('failed') || false,
      }));
      return {
        heartbeatLogDelta,
        recoveryDiagnostics,
        restored,
        goal: {
          running: !!goal.running,
          progress: goal.progress,
          currentStage: goal.currentStage || '',
          failureReason: goal.failureReason || '',
        },
        statuses,
        warningVisible: statuses.some(status => /이전 이미지 생성이 화면 복원 중/.test(status.failure)),
      };
    }`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const failures = [];
    if (result.heartbeatLogDelta > 1) failures.push(`heartbeat visible log delta=${result.heartbeatLogDelta}, expected at most 1 within a sub-30-second window`);
    if (!result.restored || result.goal.running) failures.push(`stale image-generation recovery did not stop the run: ${JSON.stringify(result.goal)}`);
    if (!result.warningVisible) failures.push(`recovery warning copy is missing: ${JSON.stringify(result.statuses)}`);
    if (result.statuses.some(status => status.title.includes('실패') || status.pill.includes('실패') || status.failedBar)) {
      failures.push(`recovery-only warning is rendered as failure: ${JSON.stringify(result.statuses)}`);
    }
    if (!result.statuses.some(status => status.pill.includes('확인 필요'))) {
      failures.push(`recovery-only status is not marked as confirmation-needed: ${JSON.stringify(result.statuses)}`);
    }
    const payload = { ok: failures.length === 0, result, failures, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
    assertChecks(failures.map(message => ({ ok: false, message })));
  } finally {
    try { await cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
