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
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_BASE || process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';

async function newPage() {
  const target = await fetchJson(`${CDP_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.savePersistentState && window.__KUASANGSE_WORKSPACE_REVISION__)', 60000);
  await waitFor(cdp, `(() =>
    typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true &&
    typeof serverLastWorkHydrated !== 'undefined' && serverLastWorkHydrated === true &&
    typeof serverLastWorkHydrating !== 'undefined' && serverLastWorkHydrating === false &&
    typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false &&
    typeof persistentStateSaveRetryTimer !== 'undefined' && !persistentStateSaveRetryTimer &&
    typeof lastWorkSaveTimer !== 'undefined' && !lastWorkSaveTimer
  )()`, 60000);
  return { cdp, target };
}

async function saveRevision(cdp, workspaceId) {
  return evaluate(cdp, `(async () => {
    window.state.currentProjectId = ${JSON.stringify(workspaceId)};
    window.state.currentProjectName = 'Three session revision gate';
    const factory = window.factoryState();
    factory.workspace = { ...(factory.workspace || {}), id: ${JSON.stringify(workspaceId)} };
    factory.currentProjectId = ${JSON.stringify(workspaceId)};
    const scopeId = 'project:' + ${JSON.stringify(workspaceId)};
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    const persistenceApi = window.__KUASANGSE_WORKSPACE_PERSISTENCE__;
    const commitResults = [];
    window.__KUASANGSE_WORKSPACE_PERSISTENCE__ = Object.freeze({
      ...persistenceApi,
      commit: async command => {
        const result = await persistenceApi.commit(command);
        const requiredReplicas = [...new Set([
          ...(String(command.scopeId || '').startsWith('project:') ? ['server', 'indexeddb'] : ['indexeddb']),
          ...(Array.isArray(command.replicas) ? command.replicas : []),
        ])];
        const failedAdapters = (result.failures || []).map(item => item.adapter).filter(Boolean);
        commitResults.push({
          accepted: result.accepted,
          clean: result.clean,
          partial: result.partial,
          code: result.code || '',
          revision: result.envelope?.metadata?.revision || null,
          pendingReplicas: result.partial
            ? requiredReplicas.filter(name => failedAdapters.includes(name))
            : [],
          failures: (result.failures || []).map(item => ({
            adapter: item.adapter,
            message: item.message,
          })),
        });
        return result;
      },
    });
    const ownerId = 'revision gate · ' + lock.snapshot().sessionId.slice(-6);
    let authority = await lock.acquire({ scopeId, ownerId });
    if (authority.mode !== 'editing') {
      authority = await lock.takeover({ confirmed: true, scopeId, ownerId });
    }
    if (authority.mode !== 'editing') throw new Error('revision gate authority acquisition failed');
    const beforeCurrent = window.__KUASANGSE_WORKSPACE_REVISION__.current(scopeId);
    let persistenceCompletion = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      persistenceCompletion = window.savePersistentState({ skipVisibleSync: true });
      if (persistenceCompletion !== false) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!persistenceCompletion || typeof persistenceCompletion.then !== 'function') {
      throw new Error('savePersistentState durable completion Promise required');
    }
    const completionWasPublished = persistentStateSavePromise === persistenceCompletion;
    const persisted = await persistenceCompletion;
    if (persisted !== true) throw new Error('savePersistentState durable commit failed');
    const result = {
      beforeCurrent,
      revision: window.__KUASANGSE_WORKSPACE_REVISION__.current(scopeId),
      stateRevision: window.state.workspaceRevision || null,
      storedRevision: JSON.parse(localStorage.getItem('pdp_session') || 'null')?.workspaceRevision || null,
      authority: lock.snapshot(),
      completionWasPublished,
      completionClearedAfterAwait: persistentStateSavePromise === null,
      commitResults,
    };
    window.__KUASANGSE_WORKSPACE_PERSISTENCE__ = persistenceApi;
    return result;
  })()`);
}

async function waitForRevisionConvergence(cdp, scopeId, expectedRevision, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const [browser, authority, lastWork] = await Promise.all([
      evaluate(cdp, `(() => ({
        current: window.__KUASANGSE_WORKSPACE_REVISION__.current(${JSON.stringify(scopeId)}),
        stored: JSON.parse(localStorage.getItem('pdp_session') || 'null')?.workspaceRevision || null,
        authority: window.__KUASANGSE_WORKSPACE_LOCK__.snapshot(),
        persistenceSaving: persistentStateSaving,
        persistencePromisePending: !!persistentStateSavePromise,
      }))()`),
      fetchJson(`${BACKEND_BASE}/api/workspace-lock/status?workspaceId=${encodeURIComponent(scopeId)}`),
      fetchJson(`${BACKEND_BASE}/api/last-work?workspaceId=${encodeURIComponent(scopeId)}`),
    ]);
    last = { browser, authority, lastWork };
    const lastWorkRevision = lastWork?.snapshot?.persistenceEnvelope?.metadata?.revision
      || lastWork?.snapshot?.workspaceRevision
      || null;
    if (
      browser.current?.counter === expectedRevision.counter
      && browser.current?.writerId === expectedRevision.writerId
      && Number(authority?.revision) === expectedRevision.counter
      && Number(lastWork?.revision) === expectedRevision.counter
      && Number(lastWorkRevision?.counter) === expectedRevision.counter
      && !browser.persistenceSaving
      && !browser.persistencePromisePending
    ) return {
      browser,
      authority: {
        state: authority.state,
        revision: authority.revision,
        fencingToken: authority.fencingToken,
      },
      lastWork: {
        revision: lastWork.revision,
        snapshotRevision: lastWorkRevision,
      },
    };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`revision convergence timeout: ${JSON.stringify(last)}`);
}

async function main() {
  const runtime = await ensureCdp(CDP_URL);
  const pages = [];
  try {
    pages.push(await newPage(), await newPage(), await newPage());
    const workspaceId = `regression-three-session-v230-${Date.now()}`;
    const scopeId = `project:${workspaceId}`;
    const saves = [
      await saveRevision(pages[0].cdp, workspaceId),
      await saveRevision(pages[1].cdp, workspaceId),
      await saveRevision(pages[2].cdp, workspaceId),
    ];
    const [a, b, c] = saves.map(save => save.revision);

    assert.equal(a.scopeId, scopeId);
    assert.equal(b.counter, a.counter + 1);
    assert.equal(c.counter, b.counter + 1);
    assert.equal(new Set([a.writerId, b.writerId, c.writerId]).size, 3);
    saves.forEach((save, index) => {
      assert.equal(save.completionWasPublished, true, `save ${index + 1} completion was not published`);
      assert.equal(save.completionClearedAfterAwait, true, `save ${index + 1} completion did not clear`);
      const committed = save.commitResults.at(-1);
      assert.equal(committed?.accepted, true, `save ${index + 1} was not accepted`);
      assert.equal(committed?.clean, true, `save ${index + 1} was not clean`);
      assert.equal(committed?.partial, false, `save ${index + 1} was partial`);
      assert.deepEqual(committed?.pendingReplicas, [], `save ${index + 1} has pending replicas`);
      assert.equal(committed?.revision?.counter, index + 1);
    });

    const convergence = await waitForRevisionConvergence(pages[0].cdp, scopeId, c);

    const staleCheck = await evaluate(pages[0].cdp, `(() => {
      const api = window.__KUASANGSE_WORKSPACE_REVISION__;
      return {
        current: api.current(${JSON.stringify(scopeId)}),
        acceptsA: api.shouldApply(${JSON.stringify(a)}, ${JSON.stringify(scopeId)}, { allowEqual: true }),
        acceptsB: api.shouldApply(${JSON.stringify(b)}, ${JSON.stringify(scopeId)}, { allowEqual: true }),
        acceptsC: api.shouldApply(${JSON.stringify(c)}, ${JSON.stringify(scopeId)}, { allowEqual: true }),
        stored: JSON.parse(localStorage.getItem('pdp_session') || 'null')?.workspaceRevision || null,
      };
    })()`);
    assert.deepEqual(staleCheck.current, c);
    assert.equal(staleCheck.acceptsA, false);
    assert.equal(staleCheck.acceptsB, false);
    assert.equal(staleCheck.acceptsC, true);
    assert.deepEqual(staleCheck.stored, c);

    const dResult = await saveRevision(pages[0].cdp, workspaceId);
    const d = dResult.revision;
    assert.equal(d.counter, c.counter + 1);
    assert.equal(d.writerId, a.writerId);
    console.log(JSON.stringify({ ok: true, scopeId, revisions: { a, b, c, d }, saves, convergence, dResult, staleCheck }, null, 2));
  } finally {
    for (const page of pages) {
      try { await fetch(`${CDP_URL}/json/close/${page.target.id}`); } catch (_) {}
      try { page.cdp.close(); } catch (_) {}
    }
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
