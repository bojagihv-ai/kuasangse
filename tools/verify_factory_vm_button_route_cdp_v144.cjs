const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-vm-button-route-v144.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let summary = null;
  try {
    await cdp.opened;
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.factoryState && window.render && window.runCompMarketScrape)', 60000);
    summary = await evaluate(cdp, `(async () => {
      window.state.step = 'competitor';
      window.state.productName = '슬라브나비수저집';
      window.state.imageBase64 = 'vm-button-route-v144-image';
      window.state.compPage = window.state.compPage || {};
      window.state.compPage.subStep = 'input';
      const factory = window.factoryState();
      factory.product = factory.product || {};
      factory.automation = factory.automation || {};
      factory.product.productName = '슬라브나비수저집';
      factory.product.userProductName = '슬라브나비수저집';
      factory.product.productKey = window.factoryNormalizeIdentityText('슬라브나비수저집');
      factory.product.currentRunId = 'vm_button_route_v144';
      factory.product.inputImageFingerprint = 'vm-button-route-v144-image';
      factory.automation.currentRunId = 'vm_button_route_v144';
      const market = window.ensureCompMarketScrapeState();
      market.productName = '슬라브나비수저집';
      market.results = [];
      market.groupedResults = {};
      market.loading = false;
      window.render();

      const originalFactoryRoute = window.factoryRunVmCompetitorCollectionForSelection;
      const originalDirectRoute = window.runCompMarketScrape;
      const calls = { factory: 0, direct: 0 };
      try {
        window.factoryRunVmCompetitorCollectionForSelection = async () => {
          calls.factory += 1;
          return { ok: true };
        };
        window.runCompMarketScrape = async () => {
          calls.direct += 1;
          return { ok: true };
        };
        const button = document.getElementById('compMarketStart');
        if (!button) throw new Error('VM 후보 수집 버튼을 렌더하지 못했습니다.');
        button.click();
        await Promise.resolve();
        await Promise.resolve();
        return { calls, buttonText: button.innerText.trim() };
      } finally {
        window.factoryRunVmCompetitorCollectionForSelection = originalFactoryRoute;
        window.runCompMarketScrape = originalDirectRoute;
      }
    })()`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }

  const failures = [];
  if (summary?.calls?.factory !== 1) failures.push(`조립공장 VM 재수집 경로 호출 ${summary?.calls?.factory || 0}회, 기대 1회`);
  if (summary?.calls?.direct !== 0) failures.push(`직접 VM 검색 경로가 ${summary.calls.direct}회 호출됐습니다.`);
  const payload = { ok: failures.length === 0, summary, failures };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
  if (failures.length) throw new Error(`VM 버튼 경로 검증 실패:\n- ${failures.join('\n- ')}`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
