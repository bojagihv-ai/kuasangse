const assert = require('node:assert/strict');
const {
  connectCdp,
  ensureCdp,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  fetchJson,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';

const CAFE24_OAUTH_STUB_SOURCE = `(() => {
  const endpointHits = Object.create(null);
  let blockedExternalCalls = 0;
  let externalSendCalls = 0;
  const nativeFetch = window.fetch.bind(window);
  window.__KUASANGSE_OAUTH_STUB__ = Object.freeze({
    blockedExternalCalls: () => blockedExternalCalls,
    endpointHits: () => ({ ...endpointHits }),
    externalSendCalls: () => externalSendCalls,
  });
  window.fetch = (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    const url = new URL(rawUrl, window.location.href);
    const localHost = ['127.0.0.1', 'localhost'].includes(url.hostname);
    const apiHub = localHost && url.port === '4321';
    const controlTower = localHost && url.port === '8787';
    const cafe24 = /(^|\\.)cafe24\\.com$/i.test(url.hostname);
    if (!apiHub && !controlTower && !cafe24) {
      return nativeFetch(input, init);
    }
    blockedExternalCalls += 1;
    const endpoint = url.hostname + ':' + url.port + url.pathname;
    endpointHits[endpoint] = (endpointHits[endpoint] || 0) + 1;
    if (cafe24) externalSendCalls += 1;
    let body = {};
    if (url.pathname.endsWith('/setup-status')) {
      body = {
        selected_mall_id: 'bojagi1928',
        checks: [
          { id: 'token-keeper', status: 'pass', message: 'stub token status' },
          { id: 'mall-connection', status: 'pass', message: 'stub mall connection' },
          { id: 'scopes', status: 'pass', message: 'stub scopes' },
          { id: 'public-url', status: 'pass', message: 'stub public url' },
        ],
      };
    } else if (url.pathname.endsWith('/connections')) {
      body = { data: [] };
    } else if (url.pathname.endsWith('/refresh-token')) {
      body = { results: [] };
    }
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  };
})();`;

async function main() {
  const runtime = await ensureCdp(CDP_URL);
  const settleMs = Math.max(350, Number(process.env.KUASANGSE_OAUTH_ISOLATION_SETTLE_MS || 5000) || 5000);
  let cdp = null;
  let target = null;
  try {
    target = await fetchJson(`${CDP_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CAFE24_OAUTH_STUB_SOURCE });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof savePersistentState === 'function'
      && typeof factoryStartCafe24OAuthAutoRefresh === 'function'
      && typeof startCafe24OAuthAutoRefresh === 'function'
      && window.__KUASANGSE_WORKSPACE_REVISION__`, 60_000);
    await waitFor(cdp, `(() =>
      typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true &&
      typeof serverLastWorkHydrated !== 'undefined' && serverLastWorkHydrated === true &&
      typeof serverLastWorkHydrating !== 'undefined' && serverLastWorkHydrating === false &&
      typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false &&
      typeof persistentStateSaveRetryTimer !== 'undefined' && !persistentStateSaveRetryTimer &&
      typeof lastWorkSaveTimer !== 'undefined' && !lastWorkSaveTimer
      && typeof factoryLastSnapshotSaveTimer !== 'undefined' && !factoryLastSnapshotSaveTimer
      && typeof factoryLastSnapshotSavePending !== 'undefined' && factoryLastSnapshotSavePending === false
      && typeof serverLastWorkSaveTimer !== 'undefined' && !serverLastWorkSaveTimer
    )()`, 60_000);

    const workspaceId = `oauth-status-isolation-v246-${Date.now()}`;
    const result = await evaluateFactoryCdpFixture(cdp, `async ({
      setAppState,
      readFactory,
      cloneFactory,
      replaceFactory,
    }) => {
      const workspaceId = ${JSON.stringify(workspaceId)};
      const scopeId = 'project:' + workspaceId;
      setAppState({
        currentProjectId: workspaceId,
        currentProjectName: 'OAuth status isolation gate',
      });
      const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
      const ownerId = 'oauth isolation gate · ' + lock.snapshot().sessionId.slice(-6);
      let authority = await lock.acquire({ scopeId, ownerId });
      if (authority.mode !== 'editing') {
        authority = await lock.takeover({ confirmed: true, scopeId, ownerId });
      }
      if (authority.mode !== 'editing') throw new Error('OAuth isolation authority acquisition failed');
      const factory = cloneFactory();
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
      factory.currentProjectId = workspaceId;
      replaceFactory(factory);

      const initialSave = savePersistentState({ skipVisibleSync: true });
      if (!initialSave || typeof initialSave.then !== 'function' || await initialSave !== true) {
        throw new Error('OAuth isolation baseline save failed');
      }
      stopCafe24OAuthAutoRefresh();
      while (cafe24OAuthAutoRefreshPromise) {
        await Promise.resolve(cafe24OAuthAutoRefreshPromise).catch(() => null);
      }
      await new Promise(resolve => setTimeout(resolve, ${settleMs}));

      const beforeRevision = window.__KUASANGSE_WORKSPACE_REVISION__.current(scopeId);
      const previousCheckedAt = Number(readFactory().product?.cafe24OAuthStatus?.checkedAt || 0);
      const calls = [];
      const originalSave = savePersistentState;
      const originalSaveLastWorkNow = saveLastWorkNow;
      const originalSaveFactoryLastSnapshot = saveFactoryLastSnapshot;
      const originalSaveServerLastWorkSnapshot = saveServerLastWorkSnapshot;
      const durableSaveCalls = [];
      const externalSendCalls = [];
      savePersistentState = function(...args) {
        calls.push({ at: Date.now(), options: args[0] || {}, stack: new Error('unexpected workspace save').stack });
        return originalSave.apply(this, args);
      };
      saveLastWorkNow = function(...args) {
        durableSaveCalls.push({ name: 'saveLastWorkNow', args: args.length });
        return originalSaveLastWorkNow.apply(this, args);
      };
      saveFactoryLastSnapshot = function(...args) {
        durableSaveCalls.push({ name: 'saveFactoryLastSnapshot', args: args.length });
        return originalSaveFactoryLastSnapshot.apply(this, args);
      };
      saveServerLastWorkSnapshot = function(...args) {
        externalSendCalls.push({ name: 'saveServerLastWorkSnapshot', args: args.length });
        return originalSaveServerLastWorkSnapshot.apply(this, args);
      };
      try {
        factoryStartCafe24OAuthAutoRefresh();
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const checkedAt = Number(readFactory().product?.cafe24OAuthStatus?.checkedAt || 0);
          if (checkedAt > previousCheckedAt) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        await new Promise(resolve => setTimeout(resolve, 450));
      } finally {
        stopCafe24OAuthAutoRefresh();
        savePersistentState = originalSave;
        saveLastWorkNow = originalSaveLastWorkNow;
        saveFactoryLastSnapshot = originalSaveFactoryLastSnapshot;
        saveServerLastWorkSnapshot = originalSaveServerLastWorkSnapshot;
      }
      const afterRevision = window.__KUASANGSE_WORKSPACE_REVISION__.current(scopeId);
      const afterFactory = readFactory();
      return {
        statusCheckedAt: Number(afterFactory.product?.cafe24OAuthStatus?.checkedAt || 0),
        previousCheckedAt,
        calls,
        durableSaveCalls,
        externalSendCalls,
        blockedExternalCalls: window.__KUASANGSE_OAUTH_STUB__?.blockedExternalCalls?.() || 0,
        endpointHits: window.__KUASANGSE_OAUTH_STUB__?.endpointHits?.() || {},
        beforeRevision,
        afterRevision,
      };
    }`);

    assert.ok(result.statusCheckedAt >= result.previousCheckedAt && Object.values(result.endpointHits).some(count => count > 0), `Cafe24 OAuth status refresh must complete: ${JSON.stringify(result)}`);
    assert.equal(result.calls.length, 0, 'Cafe24 OAuth status refresh must not save workspace state');
    assert.equal(result.durableSaveCalls.length, 0, 'Cafe24 OAuth status refresh must not call durable local save helpers');
    assert.equal(result.externalSendCalls.length, 0, `Cafe24 OAuth status refresh must not send workspace state externally: ${JSON.stringify(result)}`);
    assert.ok(Object.values(result.endpointHits).some(count => count > 0), 'Cafe24 OAuth endpoint stub must be hit');
    assert.ok(
      Object.entries(result.endpointHits).some(([endpoint, count]) => endpoint.endsWith('/refresh-token') && count > 0),
      'Cafe24 OAuth refresh endpoint stub must be hit',
    );
    assert.ok(
      Object.entries(result.endpointHits).some(([endpoint, count]) => endpoint.endsWith('/setup-status') && count > 0),
      'Cafe24 OAuth status endpoint stub must be hit',
    );
    assert.ok(
      Object.entries(result.endpointHits).some(([endpoint, count]) => endpoint.endsWith('/connections') && count > 0),
      'Cafe24 OAuth connection endpoint stub must be hit',
    );
    assert.deepEqual(result.afterRevision, result.beforeRevision, 'Cafe24 OAuth status refresh must not consume a workspace revision');
    console.log(JSON.stringify({ ok: true, workspaceId, ...result }, null, 2));
  } finally {
    if (target) {
      try { await fetch(`${CDP_URL}/json/close/${target.id}`); } catch (_) {}
    }
    try { cdp?.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
