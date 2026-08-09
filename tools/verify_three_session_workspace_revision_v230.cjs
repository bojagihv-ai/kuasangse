const assert = require('node:assert/strict');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  fetchJson,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';

async function newPage() {
  const target = await fetchJson(`${CDP_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof savePersistentState === 'function'
    && window.__KUASANGSE_WORKSPACE_REVISION__`, 60000);
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

async function saveRevision(cdp, workspaceId, marker) {
  return evaluateFactoryCdpFixture(cdp, `async ({
    setAppState,
    readAppState,
    cloneFactory,
    replaceFactory,
  }) => {
    setAppState({
      currentProjectId: ${JSON.stringify(workspaceId)},
      currentProjectName: 'Three session revision gate',
    });
    const scopeId = getCurrentLastWorkWorkspaceScope();
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    const authority = lock.snapshot();
    if (!scopeId.startsWith('draft:')) throw new Error('tab-local draft scope required');
    if (!['editing', 'offline-edit'].includes(authority.mode) || authority.scopeId !== scopeId) {
      throw new Error('tab-local draft authority required');
    }
    const factory = cloneFactory();
    factory.workspace = { ...(factory.workspace || {}), id: ${JSON.stringify(workspaceId)} };
    factory.currentProjectId = ${JSON.stringify(workspaceId)};
    factory.product = { ...(factory.product || {}), productName: ${JSON.stringify(marker)} };
    replaceFactory(factory);
    setAppState({ productName: ${JSON.stringify(marker)} });
    await settleWorkspaceScopeTransitionPersistence();
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
      stateRevision: readAppState().workspaceRevision || null,
      storedRevision: JSON.parse(sessionStorage.getItem('pdp_session') || 'null')?.workspaceRevision || null,
      sharedActiveSnapshot: localStorage.getItem('pdp_session'),
      authority: lock.snapshot(),
      branch: currentWorkspaceBranch(scopeId, ${JSON.stringify(workspaceId)}),
      productName: readAppState().productName,
      completionWasPublished,
      completionClearedAfterAwait: persistentStateSavePromise === null,
      persistenceCommitted: persisted === true,
    };
    return result;
  }`);
}

async function main() {
  const runtime = await ensureCdp(CDP_URL);
  const pages = [];
  try {
    pages.push(await newPage(), await newPage(), await newPage());
    const workspaceId = `regression-three-session-v230-${Date.now()}`;
    const saves = [
      await saveRevision(pages[0].cdp, workspaceId, 'branch-a'),
      await saveRevision(pages[1].cdp, workspaceId, 'branch-b'),
      await saveRevision(pages[2].cdp, workspaceId, 'branch-c'),
    ];
    const [a, b, c] = saves.map(save => save.revision);
    const scopeIds = saves.map(save => save.authority.scopeId);
    const documentScope = `project:${workspaceId}`;

    assert.equal(new Set(scopeIds).size, 3);
    scopeIds.forEach(scopeId => assert.match(scopeId, /^draft:/));
    assert.deepEqual(saves.map(save => save.productName), ['branch-a', 'branch-b', 'branch-c']);
    saves.forEach(save => {
      assert.equal(save.revision.scopeId, save.authority.scopeId);
      assert.equal(save.storedRevision.scopeId, save.authority.scopeId);
      assert.equal(save.branch.scopeId, save.authority.scopeId);
      assert.equal(save.branch.documentScopeId, documentScope);
      assert.equal(save.branch.documentId, workspaceId);
    });
    assert.equal(new Set([a.writerId, b.writerId, c.writerId]).size, 3);
    saves.forEach((save, index) => {
      assert.equal(save.completionWasPublished, true, `save ${index + 1} completion was not published`);
      assert.equal(save.completionClearedAfterAwait, true, `save ${index + 1} completion did not clear`);
      assert.equal(save.persistenceCommitted, true, `save ${index + 1} was not committed`);
      assert.equal(save.sharedActiveSnapshot, null, `save ${index + 1} leaked active work into shared localStorage`);
    });

    const dResult = await saveRevision(pages[0].cdp, workspaceId, 'branch-a-second-save');
    const d = dResult.revision;
    assert.deepEqual(dResult.beforeCurrent, a);
    assert.equal(d.counter, a.counter + 1);
    assert.equal(d.writerId, a.writerId);
    assert.equal(d.scopeId, a.scopeId);

    const branchState = await Promise.all(pages.map((page, index) => evaluate(page.cdp, `(() => ({
      current: window.__KUASANGSE_WORKSPACE_REVISION__.current(${JSON.stringify(scopeIds[index])}),
      stored: JSON.parse(sessionStorage.getItem('pdp_session') || 'null')?.workspaceRevision || null,
      productName: state.productName,
      sharedActiveSnapshot: localStorage.getItem('pdp_session'),
    }))()`)));
    assert.deepEqual(branchState[0].current, d);
    assert.deepEqual(branchState[1].current, b);
    assert.deepEqual(branchState[2].current, c);
    assert.deepEqual(branchState.map(item => item.productName), ['branch-a-second-save', 'branch-b', 'branch-c']);
    branchState.forEach(item => assert.equal(item.sharedActiveSnapshot, null));

    const staleCheck = await evaluate(pages[0].cdp, `(() => {
      const api = window.__KUASANGSE_WORKSPACE_REVISION__;
      return {
        current: api.current(${JSON.stringify(scopeIds[0])}),
        acceptsA: api.shouldApply(${JSON.stringify(a)}, ${JSON.stringify(scopeIds[0])}, { allowEqual: true }),
        acceptsD: api.shouldApply(${JSON.stringify(d)}, ${JSON.stringify(scopeIds[0])}, { allowEqual: true }),
        acceptsForeignB: api.shouldApply(${JSON.stringify(b)}, ${JSON.stringify(scopeIds[0])}, { allowEqual: true }),
        stored: JSON.parse(sessionStorage.getItem('pdp_session') || 'null')?.workspaceRevision || null,
        sharedActiveSnapshot: localStorage.getItem('pdp_session'),
      };
    })()`);
    assert.deepEqual(staleCheck.current, d);
    assert.equal(staleCheck.acceptsA, false);
    assert.equal(staleCheck.acceptsD, true);
    assert.equal(staleCheck.acceptsForeignB, false);
    assert.deepEqual(staleCheck.stored, d);
    assert.equal(staleCheck.sharedActiveSnapshot, null);
    console.log(JSON.stringify({ ok: true, documentScope, scopeIds, revisions: { a, b, c, d }, saves, dResult, branchState, staleCheck }, null, 2));
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
