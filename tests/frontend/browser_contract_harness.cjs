const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('../../tools/factory_cdp_test_utils.cjs');

const DEFAULT_APP_URL = 'http://127.0.0.1:8081/app.html';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9460';

async function assertAppServerReady(appUrl) {
  try {
    const response = await fetch(appUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`App test server is not ready at ${appUrl}: ${error.message || error}`);
  }
}

async function openBrowserContractHarness() {
  const appUrl = process.env.KUASANGSE_URL || DEFAULT_APP_URL;
  const cdpUrl = process.env.KUASANGSE_CDP_URL || DEFAULT_CDP_URL;
  await assertAppServerReady(appUrl);
  const runtime = await ensureCdp(cdpUrl);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');

  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: appUrl });
  await waitFor(cdp, `
    typeof factoryJobKeyMismatch === 'function' &&
    typeof factoryAssetMatchesCurrentJob === 'function' &&
    typeof optParseLayoutPatternInput === 'function' &&
    typeof publicSectionText === 'function'
  `, 45000);

  return {
    async call(fn, input = null) {
      return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(input)})`);
    },
    async setViewport(width, height) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    },
    async close() {
      await cdp.close();
      await runtime.cleanup?.();
    },
  };
}

module.exports = { openBrowserContractHarness };
