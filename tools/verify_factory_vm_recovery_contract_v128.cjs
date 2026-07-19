const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9341';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-vm-recovery-contract-v128.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let summary = null;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.compMarketEnsureJepumApiReady && window.factoryVmCandidateTimeoutMs)', 60000);

    summary = await evaluate(cdp, `(async () => {
      const originalInvoke = window.compMarketInvokeV1;
      const originalFetch = window.fetchJsonWithTimeout;
      let invokeCount = 0;
      const startCalls = [];
      let health = null;
      let error = '';
      try {
        window.compMarketInvokeV1 = async () => {
          invokeCount += 1;
          if (invokeCount === 1) throw new Error('Failed to fetch');
          return { ok: true, searches: { running: 0 } };
        };
        window.fetchJsonWithTimeout = async (url, options, timeoutMs) => {
          startCalls.push({ url, method: options?.method || 'GET', timeoutMs });
          return { ok: true, running: true, message: 'JepumScraper started' };
        };
        health = await window.compMarketEnsureJepumApiReady(1000);
      } catch (caught) {
        error = String(caught?.message || caught || '');
      } finally {
        window.compMarketInvokeV1 = originalInvoke;
        window.fetchJsonWithTimeout = originalFetch;
      }
      return {
        invokeCount,
        startCalls,
        health,
        error,
        timeoutMs: window.factoryVmCandidateTimeoutMs(),
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      };
    })()`);
  } finally {
    try {
      cdp.close();
    } catch (_) {}
    await cdpRuntime.cleanup();
  }

  const failures = [];
  if (summary.error) failures.push(`자동 복구 호출 실패: ${summary.error}`);
  if (summary.invokeCount !== 2) failures.push(`JepumScraper health 재시도 횟수 ${summary.invokeCount}, 기대 2`);
  if (summary.startCalls.length !== 1) failures.push(`JepumScraper 시작 API 호출 수 ${summary.startCalls.length}, 기대 1`);
  if (summary.startCalls[0] && !/\/api\/jepum-scraper\/start$/.test(summary.startCalls[0].url)) {
    failures.push(`잘못된 시작 API: ${summary.startCalls[0].url}`);
  }
  if (!summary.health?.ok) failures.push('자동 시작 후 health 응답을 받지 못했습니다.');
  if (summary.timeoutMs < 330000) failures.push(`조립공장 VM 제한시간 ${summary.timeoutMs}ms, 기대 330000ms 이상`);
  if (summary.buildId !== '20260710-vm-scope-isolation-v131') failures.push(`오래된 앱 build ID: ${summary.buildId}`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: failures.length === 0, summary, failures }, null, 2));
  console.log(JSON.stringify({ ok: failures.length === 0, resultPath: RESULT_PATH, summary, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
