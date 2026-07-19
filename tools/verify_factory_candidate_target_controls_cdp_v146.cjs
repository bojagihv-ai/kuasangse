const fs = require('fs');
const path = require('path');
const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_NAME = process.env.KUASANGSE_SCREENSHOT_NAME || 'factory-candidate-target-controls-v146.png';
const SCREENSHOT_PATH = path.join(OUT_DIR, SCREENSHOT_NAME);
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-target-controls-v146.json');
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
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.ensureCompMarketScrapeState)', 60000);
    const summary = await evaluate(cdp, `(async () => {
      window.state.step = 'factory';
      window.state.productName = '수량 확인 검증 상품';
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.subStep = 'input';
      const factory = window.factoryState();
      factory.product = factory.product || {};
      factory.product.productName = '수량 확인 검증 상품';
      factory.product.userProductName = '수량 확인 검증 상품';
      factory.product.currentRunId = 'target_controls_v146';
      factory.product.productKey = 'target-controls-v146';
      factory.product.inputImageFingerprint = 'target-controls-v146-input';
      factory.automation = factory.automation || {};
      factory.automation.activeTab = 'competitor';
      factory.automation.activeTaskId = 'competitor-candidates';
      const market = window.ensureCompMarketScrapeState();
      market.productName = '수량 확인 검증 상품';
      market.selectedSites = ${JSON.stringify(SITES)};
      market.marketTargets = Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, 4]));
      market.totalTarget = 20;
      market.results = [];
      market.groupedResults = {};
      market.loading = false;
      window.render();
      const targetInputs = Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, document.querySelector('[data-factory-comp-market-target="' + site + '"]')?.value || '']));
      const calls = { local: 0, confirm: 0 };
      const confirmMessages = [];
      const originalConfirm = window.confirm;
      const originalRun = window.runCompMarketScrape;
      const originalPromote = window.factoryPromoteStoredProductCandidateToInput;
      window.confirm = message => { calls.confirm += 1; confirmMessages.push(String(message || '')); return false; };
      window.runCompMarketScrape = async mode => { if (mode === 'local') calls.local += 1; return { ok: true }; };
      window.factoryPromoteStoredProductCandidateToInput = async () => ({ ok: true });
      try {
        document.querySelector('[data-factory-guide-action="rerun-local-competitors"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 250));
      } finally {
        window.confirm = originalConfirm;
        window.runCompMarketScrape = originalRun;
        window.factoryPromoteStoredProductCandidateToInput = originalPromote;
      }
      const editedTotalInput = document.querySelector('[data-factory-comp-market-total-target]');
      const editedCoupangInput = document.querySelector('[data-factory-comp-market-target="coupang"]');
      if (editedTotalInput) {
        editedTotalInput.value = '17';
        editedTotalInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (editedCoupangInput) {
        editedCoupangInput.value = '6';
        editedCoupangInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      window.confirm = message => { calls.confirm += 1; confirmMessages.push(String(message || '')); return true; };
      window.runCompMarketScrape = async mode => { if (mode === 'local') calls.local += 1; return { ok: true }; };
      window.factoryPromoteStoredProductCandidateToInput = async () => ({ ok: true });
      try {
        document.querySelector('[data-factory-guide-action="rerun-local-competitors"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 250));
      } finally {
        window.confirm = originalConfirm;
        window.runCompMarketScrape = originalRun;
        window.factoryPromoteStoredProductCandidateToInput = originalPromote;
      }
      const resetTotalInput = document.querySelector('[data-factory-comp-market-total-target]');
      const resetCoupangInput = document.querySelector('[data-factory-comp-market-target="coupang"]');
      if (resetTotalInput) {
        resetTotalInput.value = '20';
        resetTotalInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (resetCoupangInput) {
        resetCoupangInput.value = '4';
        resetCoupangInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const scope = window.compMarketCurrentWorkScope();
      const stamp = row => window.compMarketStampRowsWithCurrentWork
        ? window.compMarketStampRowsWithCurrentWork([row], scope)[0]
        : row;
      const vmRow = stamp({ id: 'vm-v146', platform: 'coupang', title: 'VM 후보 v146', product_url: 'https://example.com/vm-v146', sourceLabel: 'VM 수집', search_runtime: 'vm' });
      const localRow = stamp({ id: 'local-v146', platform: 'coupang', title: '본컴 후보 v146', product_url: 'https://example.com/local-v146', sourceLabel: '본컴 수집', search_runtime: 'local' });
      const activeMarket = window.ensureCompMarketScrapeState();
      activeMarket.vmResults = [vmRow];
      activeMarket.vmGroupedResults = { coupang: [vmRow] };
      activeMarket.localResults = [localRow];
      activeMarket.localGroupedResults = { coupang: [localRow] };
      window.compMarketApplyCandidateSourceView(activeMarket, 'vm', { preserveSelection: false });
      window.render();
      document.querySelector('[data-comp-market-source-view="local"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const localViewRows = window.ensureCompMarketScrapeState().results.map(item => item.id);
      document.querySelector('[data-comp-market-source-view="vm"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const vmViewRows = window.ensureCompMarketScrapeState().results.map(item => item.id);
      const sourceViewButtons = [...document.querySelectorAll('[data-comp-market-source-view]')].map(button => button.dataset.compMarketSourceView || '');
      const targetControls = document.querySelector('[data-factory-candidate-target-controls]');
      const panel = targetControls?.closest('.factory-automation-panel')
        || document.querySelector('[data-factory-guide-action="rerun-vm-competitors"]')?.closest('.factory-automation-panel')
        || document.body;
      (targetControls || panel).scrollIntoView({ block: 'center', inline: 'nearest' });
      return {
        targetInputs,
        totalTargetInput: document.querySelector('[data-factory-comp-market-total-target]')?.value || '',
        calls,
        confirmMessages,
        sourceViewButtons,
        localViewRows,
        vmViewRows,
        panelText: panel.innerText.slice(0, 3000),
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 400));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const failures = [];
    for (const site of SITES) if (!summary.targetInputs?.[site]) failures.push(`${site} factory target input missing`);
    if (summary.totalTargetInput !== '20') failures.push(`factory total target is ${summary.totalTargetInput || 'empty'}`);
    if (summary.calls?.confirm !== 2) failures.push(`local collection confirmation count=${summary.calls?.confirm || 0}`);
    if (summary.calls?.local !== 1) failures.push(`local collection did not execute once after confirmation count=${summary.calls?.local || 0}`);
    if (!summary.confirmMessages?.[1]?.includes('총 목표 17건') || !summary.confirmMessages?.[1]?.includes('쿠팡 6건')) failures.push('edited total/market target was not reflected in local confirmation');
    if (!summary.sourceViewButtons.includes('vm') || !summary.sourceViewButtons.includes('local')) failures.push('VM/local candidate view buttons missing');
    if (!summary.localViewRows?.includes('local-v146') || !summary.vmViewRows?.includes('vm-v146')) failures.push('VM/local candidate view switching did not select the matching source rows');
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
