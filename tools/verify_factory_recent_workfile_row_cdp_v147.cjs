const fs = require('fs');
const path = require('path');
const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, process.env.KUASANGSE_SCREENSHOT_NAME || 'factory-recent-workfile-row-v147.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-recent-workfile-row-v147.json');

function fakeProjects() {
  return Array.from({ length: 6 }, (_, index) => ({
    id: `recent-workfile-v147-${index + 1}`,
    name: `최근 작업파일 ${index + 1}`,
    updatedAt: Date.now() - index * 60_000,
    snapshotCount: index,
    factorySummary: {
      hasFactory: true,
      product: { productName: `테스트 상품 ${index + 1}` },
      assetCount: index + 1,
      sectionTotal: 3,
      sectionGenerated: Math.min(index + 1, 3),
      finalTarget: 'cafe24_openmarket',
    },
    payload: { step: 'factory' },
  }));
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
      width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1440),
      height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 980),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);
    await waitFor(cdp, 'window.state.projectsLoaded === true', 60000);
    const summary = await evaluate(cdp, `(async () => {
      window.state.step = 'factory';
      window.state.projectsLoaded = true;
      window.state.projects = ${JSON.stringify(fakeProjects())};
      window.state.currentProjectId = 'recent-workfile-v147-2';
      window.state.currentProjectName = '최근 작업파일 2';
      window.state.factory = window.state.factory || {};
      window.state.factory.product = window.state.factory.product || {};
      window.state.factory.product.productName = '테스트 상품 2';
      window.render();
      await new Promise(resolve => setTimeout(resolve, 100));
      const cards = [...document.querySelectorAll('[data-factory-recent-workfile-card]')];
      const oldCards = [...document.querySelectorAll('.factory-saved-card')];
      const oldBatchControls = [
        '#factoryBatchSelectAll',
        '#factoryBatchClearSelection',
        '#factoryBatchCafe24Only',
        '#factoryBatchCafe24OpenMarket',
      ].filter(selector => document.querySelector(selector));
      const row = document.querySelector('[data-factory-recent-workfile-row]');
      const select = document.querySelector('#workspaceProjectSelect');
      const loadButtons = [...document.querySelectorAll('[data-factory-recent-load-project]')];
      const originalLoad = loadProjectRecord;
      let loadedId = '';
      loadProjectRecord = id => { loadedId = String(id || ''); };
      loadButtons[0]?.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      loadProjectRecord = originalLoad;
      row?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return {
        allFactoryProjects: window.factorySavedProjects?.().length || 0,
        recentCards: cards.length,
        oldCards: oldCards.length,
        oldBatchControls,
        rowExists: !!row,
        loadButtons: loadButtons.length,
        loadedId,
        globalSelectOptions: select ? [...select.options].map(option => option.value).filter(Boolean) : [],
        rowClass: row?.className || '',
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const failures = [];
    if (summary.allFactoryProjects !== 6) failures.push(`seeded factory projects=${summary.allFactoryProjects}`);
    if (summary.recentCards !== 4) failures.push(`recent cards=${summary.recentCards}, expected 4`);
    if (summary.oldCards !== 0) failures.push(`legacy saved cards remain=${summary.oldCards}`);
    if (summary.oldBatchControls.length) failures.push(`legacy batch controls remain=${summary.oldBatchControls.join(',')}`);
    if (!summary.rowExists) failures.push('recent workfile row missing');
    if (summary.loadButtons !== 4) failures.push(`recent load buttons=${summary.loadButtons}, expected 4`);
    if (!summary.loadedId) failures.push('recent workfile load did not call loadProjectRecord');
    if (summary.globalSelectOptions.length > 4) failures.push(`global workfile options=${summary.globalSelectOptions.length}, expected at most 4`);
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
