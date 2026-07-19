const fs = require('fs');
const path = require('path');
const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-vm-candidate-ui-v145.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-vm-candidate-ui-v145.json');
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
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.ensureCompMarketScrapeState)', 60000);
    const summary = await evaluate(cdp, `(() => {
      window.state.step = 'competitor';
      window.state.productName = 'VM 후보 UI 검증';
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.subStep = 'input';
      const factory = window.factoryState();
      factory.product = factory.product || {};
      factory.product.productName = 'VM 후보 UI 검증';
      factory.product.userProductName = 'VM 후보 UI 검증';
      factory.product.currentRunId = 'vm_ui_v145';
      factory.product.productKey = 'vm- 후보-ui-검증';
      factory.product.inputImageFingerprint = 'vm-ui-v145-input';
      const market = window.ensureCompMarketScrapeState();
      market.productName = 'VM 후보 UI 검증';
      market.selectedSites = ${JSON.stringify(SITES)};
      market.marketTargets = Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, 4]));
      market.totalTarget = 20;
      market.results = [];
      market.groupedResults = {};
      market.loading = false;
      window.render();
      const panel = document.querySelector('#factoryCompetitorVmPanel') || document.querySelector('#compMarketName')?.closest('section') || document.body;
      panel.scrollIntoView({ block: 'start', inline: 'nearest' });
      return {
        targetInputs: Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, !!document.querySelector('[data-comp-market-target="' + site + '"]')])),
        targetValues: Object.fromEntries(${JSON.stringify(SITES)}.map(site => [site, document.querySelector('[data-comp-market-target="' + site + '"]')?.value || ''])),
        totalTargetValue: document.querySelector('#compMarketTotalTarget')?.value || '',
        vmButtonText: document.querySelector('#compMarketStart')?.innerText?.trim() || '',
        localButtonText: document.querySelector('#compMarketStartLocal')?.innerText?.trim() || '',
        detailVmButtonText: document.querySelector('#compMarketDetailSelected')?.innerText?.trim() || '',
        panelText: panel.innerText.slice(0, 2500),
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const failures = [];
    for (const site of SITES) if (!summary.targetInputs?.[site]) failures.push(`${site} target input missing`);
    if (summary.totalTargetValue !== '20') failures.push(`total target value is ${summary.totalTargetValue || 'empty'}`);
    if (!summary.vmButtonText.includes('VM 후보 수집')) failures.push('VM collection button missing');
    if (!summary.localButtonText.includes('본컴 후보 수집')) failures.push('local collection button missing');
    if (!summary.detailVmButtonText.includes('VM 상세수집')) failures.push('VM detail button missing');
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
