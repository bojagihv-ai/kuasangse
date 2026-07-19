const fs = require('fs');
const path = require('path');
const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-vm-button-failure-ui-v148.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-vm-button-failure-ui-v148.json');
const SITES = ['coupang', 'naver', 'gmarket', 'auction', 'elevenst'];

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
      width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1440),
      height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 980),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.runCompMarketScrape)', 60000);
    const summary = await evaluate(cdp, `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const resetState = () => {
        window.state.step = 'factory';
        window.state.productName = 'VM 후보 버튼 검증';
        window.state.imageBase64 = 'vm-button-failure-ui-v148-image';
        window.state.compPage = window.state.compPage || {};
        window.state.compPage.subStep = 'input';
        const factory = window.factoryState();
        factory.product = factory.product || {};
        factory.product.productName = 'VM 후보 버튼 검증';
        factory.product.userProductName = 'VM 후보 버튼 검증';
        factory.product.imageBase64 = 'vm-button-failure-ui-v148-image';
        factory.product.imageMime = 'image/png';
        factory.product.currentRunId = 'vm_button_failure_ui_v148';
        factory.product.productKey = 'vm-button-failure-ui-v148';
        factory.product.inputImageFingerprint = 'vm-button-failure-ui-v148-input';
        factory.automation = factory.automation || {};
        factory.automation.activeTab = 'competitor';
        factory.automation.activeTaskId = 'competitor-candidates';
        factory.goalRun = factory.goalRun || {};
        factory.goalRun.running = false;
        factory.goalRun.progress = 0;
        factory.goalRun.failureReason = '';
        factory.goalRun.currentStage = '';
        const market = window.ensureCompMarketScrapeState();
        market.productName = 'VM 후보 버튼 검증';
        market.selectedSites = ${JSON.stringify(SITES)};
        market.marketTargets = Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, 4]));
        market.totalTarget = 20;
        market.results = [];
        market.groupedResults = {};
        market.vmResults = [];
        market.vmGroupedResults = {};
        market.localResults = [];
        market.localGroupedResults = {};
        market.loading = false;
        market.error = '';
        market.status = '';
        market.logs = [];
        factory.stages = factory.stages || {};
        factory.stages.db = factory.stages.db || {};
        factory.stages.db.status = 'idle';
        factory.stages.db.message = '';
        window.render();
      };
      const collectButtonInfo = () => [...document.querySelectorAll('[data-factory-guide-action="rerun-vm-competitors"]')].map((button, index) => ({
        index,
        text: button.innerText.trim(),
        disabled: !!button.disabled,
        panelText: button.closest('.factory-automation-panel,.factory-card')?.innerText?.slice(0, 160) || '',
      }));

      resetState();
      await wait(120);
      const originalVmRoute = window.factoryRunVmCompetitorCollectionForSelection;
      const originalPromote = window.factoryPromoteStoredProductCandidateToInput;
      const routeCalls = [];
      window.factoryRunVmCompetitorCollectionForSelection = async () => {
        routeCalls.push('vm');
        return { ok: true, label: '경쟁사 후보 수집' };
      };
      window.factoryPromoteStoredProductCandidateToInput = async () => ({ ok: true });
      const initialButtons = collectButtonInfo();
      const clickResults = [];
      for (const buttonInfo of [initialButtons[0], initialButtons[initialButtons.length - 1]]) {
        const button = document.querySelectorAll('[data-factory-guide-action="rerun-vm-competitors"]')[buttonInfo?.index ?? -1];
        button?.click();
        await wait(220);
        clickResults.push({ index: buttonInfo?.index ?? -1, routeCalls: routeCalls.length });
      }
      window.factoryRunVmCompetitorCollectionForSelection = originalVmRoute;
      window.factoryPromoteStoredProductCandidateToInput = originalPromote;

      resetState();
      const originalScrape = window.runCompMarketScrape;
      window.runCompMarketScrape = async () => ({ ok: false, error: 'fetch failed' });
      const failureResult = await window.factoryRunVmCompetitorCollectionForSelection();
      await wait(120);
      window.runCompMarketScrape = originalScrape;
      const goal = window.factoryState().goalRun || {};
      const bars = [...document.querySelectorAll('[data-factory-goal-progress-bar]')].map(bar => ({
        progress: bar.style.getPropertyValue('--p'),
        parentClass: bar.parentElement?.className || '',
        background: getComputedStyle(bar).backgroundImage,
      }));
      const statuses = [...document.querySelectorAll('[data-factory-goal-status]')].map(node => ({
        borderColor: node.style.borderColor,
        background: node.style.background,
        title: node.querySelector('[data-factory-goal-title]')?.innerText || '',
        pill: node.querySelector('[data-factory-goal-pill]')?.innerText || '',
        failure: node.querySelector('[data-factory-goal-failure]')?.innerText || '',
      }));
      const panel = document.querySelector('#factoryCompetitorPickerPanel') || document.querySelector('#factoryAutomationWizard') || document.body;
      panel.scrollIntoView({ block: 'center', inline: 'nearest' });
      return {
        initialButtons,
        clickResults,
        routeCalls,
        failureResult,
        goal: {
          progress: goal.progress,
          currentStage: goal.currentStage,
          failureReason: goal.failureReason,
        },
        market: {
          error: window.ensureCompMarketScrapeState().error || '',
          status: window.ensureCompMarketScrapeState().status || '',
          phase: window.ensureCompMarketScrapeState().phase || '',
        },
        bars,
        statuses,
        bodyHasFailure: /실패|조회 실패|fetch failed/i.test(document.body.innerText || ''),
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const failures = [];
    if (summary.initialButtons.length < 2) failures.push(`VM rerun buttons=${summary.initialButtons.length}, expected at least 2`);
    if (summary.initialButtons.some(button => button.disabled)) failures.push('one or more VM rerun buttons are disabled before collection starts');
    if (summary.routeCalls.length !== 2) failures.push(`VM route calls=${summary.routeCalls.length}, expected 2 after clicking top and bottom buttons`);
    if (!summary.failureResult || summary.failureResult.ok !== false) failures.push('fetch failure did not return a failed VM collection result');
    if (summary.goal.failureReason !== 'fetch failed') failures.push(`failureReason=${summary.goal.failureReason || 'empty'}`);
    if (summary.goal.progress !== 52) failures.push(`goal progress=${summary.goal.progress}, expected 52 at fetch failure`);
    if (summary.market.error !== 'fetch failed') failures.push(`market.error=${summary.market.error || 'empty'}`);
    if (!summary.market.status.includes('실패')) failures.push(`market.status=${summary.market.status || 'empty'}`);
    if (!summary.bars.length) failures.push('goal progress bars missing');
    if (summary.bars.some(bar => bar.progress === '100%')) failures.push(`failure progress bar incorrectly shows 100%: ${JSON.stringify(summary.bars)}`);
    if (!summary.bars.some(bar => /failed/.test(bar.parentClass))) failures.push(`failure progress bar is not marked failed: ${JSON.stringify(summary.bars)}`);
    if (!summary.statuses.some(status => status.title.includes('실패') && status.pill.includes('52%'))) failures.push(`failure status/pill missing: ${JSON.stringify(summary.statuses)}`);
    if (!summary.bodyHasFailure) failures.push('visible failure copy missing from rendered page');
    const payload = { ok: failures.length === 0, summary, failures, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
