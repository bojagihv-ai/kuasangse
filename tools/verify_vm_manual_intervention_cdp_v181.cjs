const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9334';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'vm-manual-intervention-v181.png');
const RESULT_PATH = path.join(OUT_DIR, 'vm-manual-intervention-v181.json');

async function capture(cdp, filePath) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
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
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?vm_manual_intervention_v181=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.ensureCompMarketScrapeState)', 60000);
    await new Promise(resolve => setTimeout(resolve, 1500));

    const result = await evaluate(cdp, `(async () => {
      const factory = window.factoryState();
      window.state.step = 'factory';
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.marketScrape = {
        ...(window.state.compPage.marketScrape || {}),
        detailJobId: 'manual_job_v181',
        phase: 'detail-manual',
        status: 'VM 상세수집은 추가 확인이 필요합니다.',
        manualIntervention: {
          id: 'manual_job_v181:manual',
          jobId: 'manual_job_v181',
          status: 'manual_required',
          platform: 'naver',
          target: '네이버 영수증 확인',
          manualTitle: '사람 확인 필요 · VM 화면에서 직접 해결',
          message: 'VM에서 영수증·보안 확인처럼 사람만 처리할 수 있는 화면이 감지됐습니다.',
          reason: 'receipt_or_human_verification',
          captureRuntime: 'vm',
          waitRemainingSec: 0,
          requestedAt: Date.now(),
        },
      };
      factory.goalRun = {
        ...(factory.goalRun || {}),
        running: false,
        progress: 90,
        currentStage: 'VM 상세페이지 수집은 추가 확인이 필요합니다.',
        failureReason: '',
        activeOperationId: 'manual_job_v181',
      };
      factory.logs = [{
        type: 'warn',
        stageId: 'detail',
        message: 'VM 상세수집은 추가 확인이 필요합니다. VM 상태와 로그인/보안확인을 확인해주세요.',
        time: '오후 02:00:00',
      }];
      await window.render();
      const panel = document.querySelector('[data-factory-manual-intervention]');
      const resume = panel?.querySelector('[data-factory-guide-action="resume-comp-market-detail"]');
      return {
        panelVisible: !!panel,
        panelText: panel?.innerText?.slice(0, 500) || '',
        openVmButton: !!panel?.querySelector('[data-factory-guide-action="open-vm-capture"]'),
        resumeButton: !!resume,
        resumeEnabled: !!resume && !resume.disabled,
        progressPill: document.querySelector('[data-factory-goal-pill]')?.textContent?.trim() || '',
        appBuild: document.documentElement.dataset.kuasangseBuildId || '',
      };
    })()`);
    await capture(cdp, SCREENSHOT_PATH);

    const failures = [];
    if (!result.panelVisible) failures.push('수동 개입 패널이 렌더링되지 않았습니다.');
    if (!result.openVmButton) failures.push('VM 화면 열기/확인 버튼이 없습니다.');
    if (!result.resumeButton || !result.resumeEnabled) failures.push('같은 작업 재개 버튼이 활성화되지 않았습니다.');
    if (!/사람 확인 필요|영수증|보안 확인/.test(result.panelText)) failures.push(`개입 사유가 패널에 표시되지 않았습니다: ${result.panelText}`);
    if (!/90%|확인 필요/.test(`${result.progressPill} ${result.panelText}`)) failures.push(`진행 상태가 개입 상태와 함께 표시되지 않았습니다: ${result.progressPill}`);

    const payload = { ok: failures.length === 0, result, failures, screenshot: SCREENSHOT_PATH, resultPath: RESULT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify(payload, null, 2));
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
