const {
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');
const crypto = require('crypto');
const path = require('path');

function resolveTestScopePaths(scopeId, knownPath = '', repoRoot = process.cwd()) {
  if (!/^project:project_[a-z0-9_]+$/i.test(String(scopeId || ''))) throw new Error(`DB-03 cleanup rejected non-test scope: ${scopeId}`);
  const digest = crypto.createHash('sha256').update(scopeId).digest('hex');
  const stateRoot = process.env.KUASANGSE_LOCAL_STATE_FOLDER
    ? path.resolve(process.env.KUASANGSE_LOCAL_STATE_FOLDER)
    : path.resolve(repoRoot, 'backend', '.local');
  const safeRoot = path.join(stateRoot, 'pdp-last-work-scoped');
  const livePath = path.resolve(knownPath || path.join(safeRoot, `${digest}.json`));
  const relative = path.relative(safeRoot, livePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(livePath) !== `${digest}.json`) throw new Error(`DB-03 cleanup path escaped test scope: ${livePath}`);
  return { livePath, backupPath: livePath.replace(/\.json$/, '.bak.json') };
}

function readPersistedExpression() {
  return `(async () => {
    const raw = (() => { try { return workspacePersistenceApi().readRecoveryValue('pdp_session'); } catch (_) { return ''; } })();
    const value = (() => { try { return JSON.parse(raw || 'null'); } catch (_) { return null; } })();
    const rawText = String(raw || '');
    const rawDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawText));
    const rawSha256 = Array.from(new Uint8Array(rawDigest), byte => byte.toString(16).padStart(2, '0')).join('');
    const pick = item => ({
      projectId: item?.currentProjectId || item?.factory?.currentProjectId || item?.factory?.workspace?.id || '',
      workspaceScope: item?.workspaceScope || item?.workspaceId || null,
      workspaceRevision: item?.workspaceRevision || item?.factory?.workspaceRevision || null,
      productName: item?.productName || item?.factory?.product?.productName || '',
      dbKey: item?.factory?.product?.selectedDbCandidateKey || '',
      cafeKey: item?.factory?.product?.selectedCafe24CandidateKey || '',
      dbResolution: item?.factory?.product?.dbCandidateResolution || '',
      cafeResolution: item?.factory?.product?.cafe24CandidateResolution || '',
      dbScope: item?.factory?.product?.dbCandidates?.[0]?.reviewProductScopeKey || item?.factory?.product?.pendingDbCandidates?.[0]?.reviewProductScopeKey || '',
      cafeScope: item?.factory?.product?.cafe24Candidates?.[0]?.reviewProductScopeKey || item?.factory?.product?.pendingCafe24Candidates?.[0]?.reviewProductScopeKey || '',
      hasConfirmedDb: !!item?.factory?.product?.confirmedDb,
    });
    return {
      session: pick(value),
      rawLength: rawText.length,
      rawSha256,
      revisionRegistry: (() => { try { return JSON.parse(localStorage.getItem('kuasangse_workspace_revisions_v1') || '{}'); } catch (_) { return {}; } })(),
    };
  })()`;
}

function backendReadExpression(backendBase, workspaceScope) {
  const url = `${backendBase}/api/last-work?workspaceId=${encodeURIComponent(workspaceScope)}`;
  return `(async () => {
    const response = await fetch(${JSON.stringify(url)}, { cache: 'no-store' });
    const raw = await response.text();
    const payload = JSON.parse(raw || '{}');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { status: response.status, ok: payload.ok === true, hasSnapshot: payload.hasSnapshot === true, workspaceId: payload.workspaceId || '', revision: Number(payload.revision || 0), path: payload.path || '', sha256, bodyLength: raw.length };
  })()`;
}

async function reloadAndRead(cdp, appUrl, backendBase, workspaceScope) {
  const cycle = String(Date.now());
  await cdp.send('Page.navigate', { url: `${appUrl}?candidateWorkspaceTransition=v220&cycle=${cycle}` });
  const readyExpression = `location.search.includes(${JSON.stringify(`cycle=${cycle}`)}) && ${factoryCdpFixtureReadyExpression()}
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof workspacePersistenceApi === 'function'
    && typeof factoryCandidateReviewCanApply === 'function'`;
  try {
    await waitFor(cdp, readyExpression, 60000);
  } catch (error) {
    const readiness = await evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory, readOperationToken }) => ({
      href: location.href,
      readyState: document.readyState,
      hydrationReady: typeof classicRuntimeHydrationReady === 'boolean' ? classicRuntimeHydrationReady : null,
      initialRenderComplete: typeof classicRuntimeInitialRenderComplete === 'boolean' ? classicRuntimeInitialRenderComplete : null,
      stateError: readAppState()?.error || '',
      appWorkspaceId: readAppState()?.currentProjectId || '',
      factoryWorkspaceId: readFactory()?.workspace?.id || readFactory()?.currentProjectId || '',
      operationToken: readOperationToken(),
    })`).catch(diagnosticError => ({ diagnosticError: String(diagnosticError?.message || diagnosticError) }));
    throw new Error(`${error.message}\nreadiness=${JSON.stringify(readiness)}`);
  }
  await new Promise(resolve => setTimeout(resolve, 1600));
  return evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory, readOperationToken }) => {
    const appState = readAppState();
    const factory = readFactory();
    const token = readOperationToken();
    const projectId = appState.currentProjectId || factory.currentProjectId || factory.workspace?.id || '';
    const candidate = factory.product?.pendingDbCandidates?.[0] || factory.product?.dbCandidates?.[0] || {};
    return {
      appWorkspaceId: appState.currentProjectId || '',
      factoryWorkspaceId: factory.workspace?.id || factory.currentProjectId || '',
      scope: getCurrentLastWorkWorkspaceScope?.() || '',
      operationToken: token,
      operationTokenScope: workspacePersistenceApi().normalizeWorkspaceScope(token.workspaceId),
      state: {
        dbKey: factory.product?.selectedDbCandidateKey || '',
        cafeKey: factory.product?.selectedCafe24CandidateKey || '',
        dbResolution: factory.product?.dbCandidateResolution || '',
        cafeResolution: factory.product?.cafe24CandidateResolution || '',
        hasConfirmedDb: !!factory.product?.confirmedDb,
        dbCandidateScope: candidate.reviewProductScopeKey || '',
        cafeCandidateScope: factory.product?.pendingCafe24Candidates?.[0]?.reviewProductScopeKey || factory.product?.cafe24Candidates?.[0]?.reviewProductScopeKey || '',
      },
      persisted: await ${readPersistedExpression()},
      backend: await ${backendReadExpression(backendBase, workspaceScope)},
      projectId,
    };
  }`);
}

async function readCandidateApplyProof(cdp, { backendBase, workspaceScope, oldDbCandidate, oldCafeCandidate }) {
  return evaluateFactoryCdpFixture(cdp, `(async ({ readFactory }) => {
    const backendRead = async () => ${backendReadExpression(backendBase, workspaceScope)};
    const persistedRead = async () => ${readPersistedExpression()};
    const beforeFactory = readFactory();
    const beforePersisted = await persistedRead();
    const beforeBackend = await backendRead();
    const currentDb = beforeFactory.product?.pendingDbCandidates?.[0] || beforeFactory.product?.dbCandidates?.[0] || {};
    const currentCafe = beforeFactory.product?.pendingCafe24Candidates?.[0] || beforeFactory.product?.cafe24Candidates?.[0] || {};
    const currentScopeKey = factoryCandidateReviewScopeKey(beforeFactory);
    const staleScope = 'stale-db03::' + factoryCurrentProductKey(beforeFactory) + '::candidate-review';
    const foreignScope = 'foreign-db03::' + factoryCurrentProductKey(beforeFactory) + '::candidate-review';
    const make = (candidate, scope) => ({ ...candidate, reviewProductScopeKey: scope, reviewProductIdentityKey: String(candidate.reviewProductIdentityKey || '').replace(/^[^:]+(?=::)/, scope.split('::')[0]) });
    const oldDb = ${JSON.stringify(oldDbCandidate)};
    const oldCafe = ${JSON.stringify(oldCafeCandidate)};
    const staleDb = make(currentDb, staleScope);
    const foreignDb = make(currentDb, foreignScope);
    const staleCafe = make(currentCafe, staleScope);
    const foreignCafe = make(currentCafe, foreignScope);
    const pick = factory => ({
      selectedDbCandidateKey: factory.product?.selectedDbCandidateKey || '',
      selectedCafe24CandidateKey: factory.product?.selectedCafe24CandidateKey || '',
      dbCandidateResolution: factory.product?.dbCandidateResolution || '',
      cafe24CandidateResolution: factory.product?.cafe24CandidateResolution || '',
      confirmedDb: factory.product?.confirmedDb || null,
      confirmedCafe24ProductKey: factory.product?.confirmedCafe24ProductKey || '',
      cafe24DraftProductKey: factory.product?.cafe24DraftProductKey || '',
    });
    const sameBackend = (left, right) => ['status', 'ok', 'hasSnapshot', 'workspaceId', 'revision', 'sha256', 'bodyLength']
      .every(key => left?.[key] === right?.[key]);
    const sameRecovery = (left, right) => left?.rawLength === right?.rawLength
      && left?.rawSha256 === right?.rawSha256
      && JSON.stringify(left?.revisionRegistry || {}) === JSON.stringify(right?.revisionRegistry || {});
    const restoreState = snapshot => {
      Object.keys(state).forEach(key => { if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete state[key]; });
      Object.assign(state, structuredClone(snapshot));
    };
    const withNetworkStubs = async (kind, candidate, run) => {
      const originalDb = globalThis.fetchSinhwaProductDetail;
      const originalCafe = globalThis.fetchCafe24ProductFullByNo;
      const detail = async () => structuredClone(candidate);
      let installed = false;
      try {
        if (kind === 'db') {
          globalThis.fetchSinhwaProductDetail = detail;
          installed = globalThis.fetchSinhwaProductDetail === detail;
        } else {
          globalThis.fetchCafe24ProductFullByNo = detail;
          installed = globalThis.fetchCafe24ProductFullByNo === detail;
        }
        return { result: await run(), installed };
      } finally {
        globalThis.fetchSinhwaProductDetail = originalDb;
        globalThis.fetchCafe24ProductFullByNo = originalCafe;
      }
    };
    const attempt = async (name, candidate, kind, expectedApply = false) => {
      const baselineState = structuredClone(state);
      const baselineFactory = structuredClone(beforeFactory);
      const probe = structuredClone(beforeFactory);
      probe.product = { ...(probe.product || {}), pendingDbCandidates: kind === 'db' ? [candidate] : [], dbCandidates: kind === 'db' ? [candidate] : [], pendingCafe24Candidates: kind === 'cafe24' ? [candidate] : [], cafe24Candidates: kind === 'cafe24' ? [candidate] : [] };
      const selectionBefore = pick(probe);
      let outcome;
      let networkStubInstalled = false;
      try {
        const run = () => kind === 'db'
          ? factoryApplyDbCandidateFromReview(0, { factory: probe, render: false })
          : factoryApplyCafe24CandidateFromReview(0, { factory: probe, render: false });
        const applied = expectedApply ? await withNetworkStubs(kind, candidate, run) : { result: await run(), installed: false };
        networkStubInstalled = applied.installed;
        outcome = { status: 'resolved', value: applied.result === false ? false : applied.result === true ? true : String(applied.result ?? '') };
      } catch (error) { outcome = { status: 'rejected', message: String(error?.message || error) }; }
      const selectionAfter = pick(probe);
      const afterProbe = JSON.stringify(probe);
      restoreState(baselineState);
      const afterPersisted = await persistedRead();
      const afterBackend = await backendRead();
      const expectedKey = kind === 'db' ? factorySinhwaCandidateKey(candidate) : factoryCafe24CandidateKey(candidate);
      const mutationMatches = kind === 'db'
        ? outcome.value === true && selectionAfter.selectedDbCandidateKey === expectedKey && selectionAfter.dbCandidateResolution === 'selected' && factorySinhwaCandidateKey(selectionAfter.confirmedDb) === expectedKey
        : outcome.value === true && selectionAfter.selectedCafe24CandidateKey === expectedKey && selectionAfter.cafe24CandidateResolution === 'selected' && selectionAfter.confirmedCafe24ProductKey === expectedKey && selectionAfter.cafe24DraftProductKey === expectedKey;
      return {
        name,
        expectedApply,
        outcome,
        networkStubInstalled,
        mutationMatches,
        selectionUnchanged: JSON.stringify(selectionBefore) === JSON.stringify(selectionAfter),
        confirmedUnchanged: JSON.stringify(selectionBefore.confirmedDb) === JSON.stringify(selectionAfter.confirmedDb) && selectionBefore.confirmedCafe24ProductKey === selectionAfter.confirmedCafe24ProductKey,
        globalStateUnchanged: JSON.stringify(state) === JSON.stringify(baselineState),
        runtimeFactoryUnchanged: JSON.stringify(readFactory()) === JSON.stringify(baselineFactory),
        probeChanged: afterProbe !== JSON.stringify(baselineFactory),
        recoveryUnchanged: sameRecovery(beforePersisted, afterPersisted),
        backendUnchanged: sameBackend(beforeBackend, afterBackend),
        backendBefore: beforeBackend,
        backendAfter: afterBackend,
        recoveryBefore: beforePersisted,
        recoveryAfter: afterPersisted,
        selectionBefore,
        selectionAfter,
      };
    };
    const attempts = {
      currentDb: await attempt('currentDb', currentDb, 'db', true),
      currentCafe: await attempt('currentCafe', currentCafe, 'cafe24', true),
      oldDb: await attempt('oldDb', oldDb, 'db'),
      staleDb: await attempt('staleDb', staleDb, 'db'),
      foreignDb: await attempt('foreignDb', foreignDb, 'db'),
      oldCafe: await attempt('oldCafe', oldCafe, 'cafe24'),
      staleCafe: await attempt('staleCafe', staleCafe, 'cafe24'),
      foreignCafe: await attempt('foreignCafe', foreignCafe, 'cafe24'),
    };
    const rejected = ['oldDb', 'staleDb', 'foreignDb', 'oldCafe', 'staleCafe', 'foreignCafe'].map(name => attempts[name]);
    return {
      currentScopeKey,
      currentDbSelectable: factoryCandidateReviewCanApply(currentDb, beforeFactory),
      currentCafeSelectable: factoryCandidateReviewCanApply(currentCafe, beforeFactory),
      oldDbSelectable: factoryCandidateReviewCanApply(oldDb, beforeFactory),
      oldCafeSelectable: factoryCandidateReviewCanApply(oldCafe, beforeFactory),
      staleDbSelectable: factoryCandidateReviewCanApply(staleDb, beforeFactory),
      foreignDbSelectable: factoryCandidateReviewCanApply(foreignDb, beforeFactory),
      attempts,
      rejectedRecoveryUnchanged: rejected.every(item => item.recoveryUnchanged),
      rejectedBackendUnchanged: rejected.every(item => item.backendUnchanged),
      sameRecovery: sameRecovery(beforePersisted, await persistedRead()),
      backendBefore: beforeBackend,
      backendAfter: await backendRead(),
      sameBackend: sameBackend(beforeBackend, await backendRead()),
      beforeNamespace: beforePersisted.rawLength,
      afterNamespace: (await persistedRead()).rawLength,
    };
  })`);
}

module.exports = { backendReadExpression, readPersistedExpression, reloadAndRead, readCandidateApplyProof, resolveTestScopePaths };
