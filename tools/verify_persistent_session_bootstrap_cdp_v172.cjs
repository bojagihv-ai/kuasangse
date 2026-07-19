const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9342';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'persistent-session-bootstrap-v172.png');
const RESULT_PATH = path.join(OUT_DIR, 'persistent-session-bootstrap-v172.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let originalSession = null;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const originalWarn = console.warn.bind(console);
        console.warn = (...args) => {
          try {
            const warnings = JSON.parse(sessionStorage.getItem('__verify_persistent_bootstrap_warnings__') || '[]');
            warnings.push(args.map(value => String(value?.message || value)).join(' '));
            sessionStorage.setItem('__verify_persistent_bootstrap_warnings__', JSON.stringify(warnings.slice(-20)));
          } catch (_) {}
          return originalWarn(...args);
        };
      })()`,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyPersistentBootstrap=prepare-${Date.now()}` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.render && window.factoryState)', 60000);
    originalSession = await evaluate(cdp, `(() => ({
      hasSession: localStorage.getItem('pdp_session') !== null,
      session: localStorage.getItem('pdp_session'),
    }))()`);
    const seed = String(Date.now());
    const productName = `PersistentBootstrapV172-${seed}`;
    const projectId = `persistent_bootstrap_v172_${seed}`;
    const workspaceId = `project:${projectId}`;
    const session = {
      step: 'factory',
      currentProjectId: projectId,
      currentProjectName: productName,
      workspaceScope: { id: workspaceId },
      productName,
      analysisImages: [],
      factory: {
        workspace: { id: workspaceId, name: productName },
        product: { productName, userProductName: productName },
        assets: [],
        stages: {},
      },
    };
    await evaluate(cdp, `(() => {
      const state = window.__kuasangseState;
      state.step = 'factory';
      state.currentProjectId = ${JSON.stringify(projectId)};
      state.currentProjectName = ${JSON.stringify(productName)};
      state.productName = ${JSON.stringify(productName)};
      state.factory = window.normalizeFactoryState(${JSON.stringify(session.factory)});
      state.factory.workspace = { ...(state.factory.workspace || {}), id: ${JSON.stringify(workspaceId)}, name: ${JSON.stringify(productName)} };
      state.factory.product = { ...(state.factory.product || {}), productName: ${JSON.stringify(productName)}, userProductName: ${JSON.stringify(productName)} };
      window.savePersistentState({ skipVisibleSync: true });
    })()`);
    const beforeReload = await evaluate(cdp, `(() => {
      const rawText = localStorage.getItem('pdp_session') || '';
      let raw = {};
      try { raw = JSON.parse(rawText); } catch (_) {}
      return {
        rawLength: rawText.length,
        rawStep: raw.step || '',
        rawProductName: raw.productName || '',
        rawWorkspaceId: raw.workspaceScope?.id || raw.workspaceScope || raw.workspaceId || '',
      };
    })()`);
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyPersistentBootstrap=restore-${seed}` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState)', 60000);
    const restored = await evaluate(cdp, `(() => {
      const state = window.__kuasangseState;
      const factory = window.factoryState();
      const storedRaw = localStorage.getItem('pdp_session') || '';
      let stored = {};
      try { stored = JSON.parse(storedRaw); } catch (_) {}
      return {
        step: state.step,
        productName: state.productName,
        projectId: state.currentProjectId,
        workspaceId: factory.workspace?.id || '',
        factoryProductName: factory.product?.productName || '',
        factoryUserProductName: factory.product?.userProductName || '',
        storedSessionLength: storedRaw.length,
        storedSessionStep: stored.step || '',
        storedSessionProductName: stored.productName || '',
        storedSessionWorkspaceId: stored.workspaceScope?.id || stored.workspaceScope || stored.workspaceId || '',
        warnings: JSON.parse(sessionStorage.getItem('__verify_persistent_bootstrap_warnings__') || '[]')
          .filter(message => message.includes('Persistent session load failed')),
      };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: restored.step === 'factory', message: `saved factory step was not restored: ${JSON.stringify(restored)}` },
      { ok: restored.productName === productName, message: `saved product name was not restored: ${JSON.stringify(restored)}` },
      { ok: restored.projectId === projectId && restored.workspaceId === workspaceId, message: `saved workspace scope was not restored: ${JSON.stringify(restored)}` },
      { ok: restored.factoryProductName === productName && restored.factoryUserProductName === productName, message: `saved factory product identity was not restored: ${JSON.stringify(restored)}` },
      { ok: beforeReload.rawProductName === productName && beforeReload.rawWorkspaceId === workspaceId, message: `persistent session producer did not save the test scope: ${JSON.stringify(beforeReload)}` },
      { ok: restored.storedSessionProductName === productName && restored.storedSessionWorkspaceId === workspaceId, message: `persistent session was overwritten with another scope during navigation: ${JSON.stringify(restored)}` },
      { ok: restored.warnings.length === 0, message: `persistent session emitted a load warning: ${JSON.stringify(restored.warnings)}` },
    ];
    const payload = {
      ok: checks.every(check => check.ok),
      beforeReload,
      restored,
      screenshot: SCREENSHOT_PATH,
      failures: checks.filter(check => !check.ok).map(check => check.message),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    if (originalSession) {
      try {
        await evaluate(cdp, `(() => {
          const original = ${JSON.stringify(originalSession)};
          if (original.hasSession) localStorage.setItem('pdp_session', original.session);
          else localStorage.removeItem('pdp_session');
        })()`);
      } catch (_) {}
    }
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
