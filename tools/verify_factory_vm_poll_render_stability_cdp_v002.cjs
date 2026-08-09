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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9357';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-vm-poll-render-stability-v002.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-vm-poll-render-stability-v002.png');

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
      width: 1920,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?factoryVmPollRenderStability=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.compMarketTryVmCandidateBridgeSearch)', 60000);

    const result = await evaluate(cdp, `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      state.step = 'factory';
      const factory = window.factoryState();
      factory.product = {
        ...(factory.product || {}),
        userProductName: 'VM 폴링 렌더 검증',
        productName: 'VM 폴링 렌더 검증',
      };
      factory.automation = {
        ...(factory.automation || {}),
        activeTab: 'db',
        activeTaskId: 'db-select',
        parallelProgress: {
          ...(factory.automation?.parallelProgress || {}),
          vm: { progress: 20, status: 'running', expectedItemCount: 3, completedItemCount: 0, message: 'VM 후보 수집 준비' },
        },
      };
      factory.goalRun = {
        ...(factory.goalRun || {}),
        running: true,
        progress: 34,
        currentStage: 'VM 경쟁사 후보 수집 중',
        activeOperationId: 'factory-vm-poll-render-stability-v002',
        failureReason: '',
      };
      window.render();
      await wait(900);

      const app = document.querySelector('.app');
      if (!app) throw new Error('앱 스크롤 컨테이너를 찾지 못했습니다.');
      app.scrollTop = Math.min(180, Math.max(0, app.scrollHeight - app.clientHeight));
      const before = { scrollTop: app.scrollTop, scrollHeight: app.scrollHeight };
      const originalRender = window.render;
      const originalPatchAppHtml = window.patchAppHtml;
      const originalRenderShellFrame = window.renderShellFrame;
      const originalFetch = window.fetch;
      let renderCount = 0;
      let patchAppHtmlCount = 0;
      let renderShellFrameCount = 0;
      const renderShellFrameStacks = [];
      let pollCount = 0;
      let actionError = '';
      window.render = function(...args) {
        renderCount += 1;
        return originalRender.apply(this, args);
      };
      if (typeof originalPatchAppHtml === 'function') {
        window.patchAppHtml = function(...args) {
          patchAppHtmlCount += 1;
          return originalPatchAppHtml.apply(this, args);
        };
      }
      if (typeof originalRenderShellFrame === 'function') {
        window.renderShellFrame = function(...args) {
          renderShellFrameCount += 1;
          renderShellFrameStacks.push(String(new Error('render-shell-frame').stack || '').split('\\n').slice(0, 5));
          return originalRenderShellFrame.apply(this, args);
        };
      }
      // render() is a lexical binding in the app bundle. Verify the hook
      // reaches the actual full-shell renderer before trusting its count.
      window.render();
      await wait(80);
      const instrumentation = {
        patchAppHtmlReachable: patchAppHtmlCount > 0,
        renderShellFrameReachable: renderShellFrameCount > 0,
      };
      renderCount = 0;
      patchAppHtmlCount = 0;
      renderShellFrameCount = 0;
      renderShellFrameStacks.length = 0;
      window.fetch = async (input, init = {}) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input?.url, window.location.href);
        if (!requestUrl.pathname.startsWith('/api/vm-candidate-search')) return originalFetch(input, init);
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            job_id: 'vm-poll-render-stability-v002',
            search_runtime: 'vm',
            transport: 'vm_shared_folder',
            vm_search_id: 'vm-poll-render-stability-v002',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        pollCount += 1;
        const completed = pollCount === 4;
        const percent = completed ? 100 : pollCount * 20;
        return new Response(JSON.stringify({
          ok: true,
          status: completed ? 'completed' : 'running',
          search_id: completed ? 'vm-poll-render-result-v002' : '',
          vm_search_id: 'vm-poll-render-stability-v002',
          search_runtime: 'vm',
          transport: 'vm_shared_folder',
          progress: {
            message: 'VM 진행 ' + pollCount + '/4',
            current_market: 'coupang',
            percent,
            accepted: pollCount,
            elapsed_seconds: pollCount,
          },
          result: completed ? {
            session_id: 'vm-poll-render-session-v002',
            search_runtime: 'vm',
            transport: 'vm_shared_folder',
            vm_search_id: 'vm-poll-render-stability-v002',
            products: [],
          } : {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      try {
        const market = ensureCompMarketScrapeState();
        market.productName = 'VM 폴링 렌더 검증';
        market.searchKeyword = market.productName;
        market.selectedSites = ['coupang'];
        market.marketTargets = { coupang: 3 };
        await compMarketTryVmCandidateBridgeSearch(
          market,
          ['coupang'],
          { product_name: market.productName },
          { maxPolls: 4, factory },
        );
      } catch (error) {
        actionError = String(error?.message || error);
      } finally {
        window.fetch = originalFetch;
        window.render = originalRender;
        if (typeof originalPatchAppHtml === 'function') window.patchAppHtml = originalPatchAppHtml;
        if (typeof originalRenderShellFrame === 'function') window.renderShellFrame = originalRenderShellFrame;
      }
      await wait(80);
      const after = { scrollTop: app.scrollTop, scrollHeight: app.scrollHeight };
      const vmBridgeRenderCount = renderShellFrameStacks.filter(stack => (
        stack.some(line => line.includes('compMarketTryVmCandidateBridgeSearch'))
      )).length;
      return {
        actionError,
        pollCount,
        renderCount,
        patchAppHtmlCount,
        renderShellFrameCount,
        renderShellFrameStacks,
        vmBridgeRenderCount,
        instrumentation,
        before,
        after,
        statusText: String(ensureCompMarketScrapeState().status || ''),
      };
    })()`);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    const failures = [];
    if (result.actionError) failures.push(`VM 폴링 모사 실행이 실패했습니다: ${result.actionError}`);
    if (result.pollCount !== 4) failures.push(`VM 폴링 4회를 완료하지 못했습니다: ${result.pollCount}`);
    if (!result.instrumentation?.patchAppHtmlReachable && !result.instrumentation?.renderShellFrameReachable) {
      failures.push('전역 렌더 계측 훅이 실제 앱 셸에 연결되지 않았습니다.');
    }
    if (result.vmBridgeRenderCount > 0) {
      failures.push(`VM 상태 폴링이 전역 셸 렌더를 ${result.vmBridgeRenderCount}회 직접 호출했습니다.`);
    }
    if (Math.abs(result.after.scrollTop - result.before.scrollTop) > 1) {
      failures.push(`VM 진행 갱신 중 주 스크롤 위치가 변했습니다: ${result.before.scrollTop} → ${result.after.scrollTop}`);
    }
    if (!result.statusText.includes('100%')) failures.push(`마지막 VM 진행 문구가 완료 상태로 갱신되지 않았습니다: ${result.statusText}`);
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
