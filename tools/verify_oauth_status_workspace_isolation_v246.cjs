const assert = require('node:assert/strict');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  fetchJson,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';

async function main() {
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  let target = null;
  try {
    target = await fetchJson(`${CDP_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.savePersistentState && window.__KUASANGSE_WORKSPACE_REVISION__)', 60_000);
    await waitFor(cdp, `(() =>
      typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true &&
      typeof serverLastWorkHydrated !== 'undefined' && serverLastWorkHydrated === true &&
      typeof serverLastWorkHydrating !== 'undefined' && serverLastWorkHydrating === false &&
      typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false &&
      typeof persistentStateSaveRetryTimer !== 'undefined' && !persistentStateSaveRetryTimer &&
      typeof lastWorkSaveTimer !== 'undefined' && !lastWorkSaveTimer
    )()`, 60_000);

    const workspaceId = `oauth-status-isolation-v246-${Date.now()}`;
    const result = await evaluate(cdp, `(async () => {
      const workspaceId = ${JSON.stringify(workspaceId)};
      const scopeId = 'project:' + workspaceId;
      window.state.currentProjectId = workspaceId;
      window.state.currentProjectName = 'OAuth status isolation gate';
      const factory = window.factoryState();
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
      factory.currentProjectId = workspaceId;
      const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
      const ownerId = 'oauth isolation gate · ' + lock.snapshot().sessionId.slice(-6);
      let authority = await lock.acquire({ scopeId, ownerId });
      if (authority.mode !== 'editing') {
        authority = await lock.takeover({ confirmed: true, scopeId, ownerId });
      }
      if (authority.mode !== 'editing') throw new Error('OAuth isolation authority acquisition failed');

      const initialSave = window.savePersistentState({ skipVisibleSync: true });
      if (!initialSave || typeof initialSave.then !== 'function' || await initialSave !== true) {
        throw new Error('OAuth isolation baseline save failed');
      }
      stopCafe24OAuthAutoRefresh();
      while (cafe24OAuthAutoRefreshPromise) {
        await Promise.resolve(cafe24OAuthAutoRefreshPromise).catch(() => null);
      }
      await new Promise(resolve => setTimeout(resolve, 350));

      const beforeRevision = window.__KUASANGSE_WORKSPACE_REVISION__.current(scopeId);
      const previousCheckedAt = Number(factory.product?.cafe24OAuthStatus?.checkedAt || 0);
      const calls = [];
      const originalSave = window.savePersistentState;
      window.savePersistentState = function(...args) {
        calls.push({ at: Date.now(), options: args[0] || {}, stack: new Error('unexpected workspace save').stack });
        return originalSave.apply(this, args);
      };
      try {
        factoryStartCafe24OAuthAutoRefresh();
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const checkedAt = Number(factory.product?.cafe24OAuthStatus?.checkedAt || 0);
          if (checkedAt > previousCheckedAt) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        await new Promise(resolve => setTimeout(resolve, 450));
      } finally {
        stopCafe24OAuthAutoRefresh();
        window.savePersistentState = originalSave;
      }
      const afterRevision = window.__KUASANGSE_WORKSPACE_REVISION__.current(scopeId);
      return {
        statusCheckedAt: Number(factory.product?.cafe24OAuthStatus?.checkedAt || 0),
        previousCheckedAt,
        calls,
        beforeRevision,
        afterRevision,
      };
    })()`);

    assert.ok(result.statusCheckedAt > result.previousCheckedAt, 'Cafe24 OAuth status refresh must complete');
    assert.equal(result.calls.length, 0, 'Cafe24 OAuth status refresh must not save workspace state');
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
