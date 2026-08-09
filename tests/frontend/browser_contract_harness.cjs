const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { terminateOwnedProcessTree } = require('../../tools/owned_process_cleanup.cjs');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('../../tools/factory_cdp_test_utils.cjs');

const DEFAULT_APP_URL = 'http://127.0.0.1:8081/app.html';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9460';
const ROOT = path.resolve(__dirname, '..', '..');
let browserOpenSequence = 0;

function cdpUrlForAttempt(baseUrl, attempt) {
  const url = new URL(baseUrl);
  const basePort = Number(url.port);
  const port = basePort + Number(attempt || 0);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid browser contract CDP port: ${port}`);
  }
  url.port = String(port);
  return url.href.replace(/\/$/, '');
}

async function appServerReady(appUrl) {
  try {
    const response = await fetch(appUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

function findPython() {
  const candidates = [
    path.join(ROOT, 'backend', 'venv311', 'Scripts', 'python.exe'),
    path.join(ROOT, 'backend', 'venv', 'Scripts', 'python.exe'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || 'python';
}

async function ensureAppServer(appUrl) {
  if (await appServerReady(appUrl)) {
    return { started: false, cleanup: async () => {} };
  }
  const url = new URL(appUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new Error(`App test server is not ready at ${appUrl}`);
  }
  const child = spawn(findPython(), [
    '-m', 'http.server', url.port, '--bind', '127.0.0.1',
  ], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await appServerReady(appUrl)) {
      return { started: true, cleanup: () => terminateOwnedProcessTree(child) };
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await terminateOwnedProcessTree(child);
  throw new Error(`App test server is not ready at ${appUrl}`);
}

async function openBrowserContractHarness() {
  const appUrl = process.env.KUASANGSE_URL || DEFAULT_APP_URL;
  const cdpUrl = cdpUrlForAttempt(
    process.env.KUASANGSE_CDP_URL || DEFAULT_CDP_URL,
    browserOpenSequence++,
  );
  const appServer = await ensureAppServer(appUrl);
  let runtime;
  let cdp;
  try {
    runtime = await ensureCdp(cdpUrl);
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');

    cdp = connectCdp(target.webSocketDebuggerUrl);
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
    `, Math.max(1000, Number(process.env.KUASANGSE_BROWSER_READY_TIMEOUT_MS || 45000) || 45000));
  } catch (error) {
    await cdp?.close();
    await runtime?.cleanup?.();
    await appServer.cleanup();
    throw error;
  }

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
      await appServer.cleanup();
    },
  };
}

module.exports = { cdpUrlForAttempt, ensureAppServer, openBrowserContractHarness };
