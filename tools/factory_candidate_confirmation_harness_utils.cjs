const {
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

function readPersistedExpression() {
  return `(async () => {
    const read = async key => {
      try {
        const raw = await workspacePersistenceApi().readRecoveryValue(key);
        return { value: JSON.parse(raw || 'null'), raw: String(raw || '') };
      } catch (_) {
        return { value: null, raw: '' };
      }
    };
    const fingerprint = raw => {
      const text = String(raw || '');
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return { length: text.length, hash: (hash >>> 0).toString(16) };
    };
    const sessionRecord = await read('pdp_session');
    const session = sessionRecord.value;
    const pick = value => ({
      step: value?.step || '',
      projectId: value?.currentProjectId || value?.factory?.currentProjectId || value?.factory?.workspace?.id || '',
      workspaceScope: value?.workspaceScope || value?.workspaceId || null,
      workspaceRevision: value?.workspaceRevision || value?.factory?.workspaceRevision || null,
      productName: value?.productName || value?.factory?.product?.productName || '',
      dbKey: value?.factory?.product?.selectedDbCandidateKey || '',
      cafeKey: value?.factory?.product?.selectedCafe24CandidateKey || '',
      dbResolution: value?.factory?.product?.dbCandidateResolution || '',
      cafeResolution: value?.factory?.product?.cafe24CandidateResolution || '',
      hasConfirmedDb: !!value?.factory?.product?.confirmedDb,
      confirmedCafeKey: value?.factory?.product?.confirmedCafe24ProductKey || '',
    });
    return {
      session: pick(session),
      namespace: { session: fingerprint(sessionRecord.raw) },
      revisionRegistry: (() => {
        try { return JSON.parse(localStorage.getItem('kuasangse_workspace_revisions_v1') || '{}'); } catch (_) { return {}; }
      })(),
    };
  })()`;
}

async function reloadAndRead(cdp, appUrl) {
  const cycle = String(Date.now());
  await cdp.send('Page.navigate', { url: `${appUrl}?candidateConfirmationReload=v185&cycle=${cycle}` });
  await waitFor(cdp, `location.search.includes(${JSON.stringify(`cycle=${cycle}`)}) && ${factoryCdpFixtureReadyExpression()}
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof factoryCandidateReviewCanApply === 'function'
    && typeof workspacePersistenceApi === 'function'`, 60000);
  await new Promise(resolve => setTimeout(resolve, 1400));
  return evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory, readOperationToken }) => {
    const appState = readAppState();
    const factory = readFactory();
    const operationToken = readOperationToken();
    const factoryWorkspaceId = factory.workspace?.id || factory.currentProjectId || '';
    const dbCandidates = factory.product?.pendingDbCandidates?.length
      ? factory.product.pendingDbCandidates
      : (factory.product?.dbCandidates || []);
    const cafeCandidates = factory.product?.pendingCafe24Candidates?.length
      ? factory.product.pendingCafe24Candidates
      : (factory.product?.cafe24Candidates || []);
    return {
      projectId: appState.currentProjectId || '',
      productName: appState.productName || factory.product?.productName || '',
      scope: getCurrentLastWorkWorkspaceScope?.() || '',
      operationToken,
      factoryWorkspaceId,
      operationTokenScope: workspacePersistenceApi().normalizeProjectScope(operationToken.workspaceId),
      factoryWorkspaceScope: workspacePersistenceApi().normalizeProjectScope(factoryWorkspaceId),
      state: {
        dbKey: factory.product?.selectedDbCandidateKey || '',
        cafeKey: factory.product?.selectedCafe24CandidateKey || '',
        dbResolution: factory.product?.dbCandidateResolution || '',
        cafeResolution: factory.product?.cafe24CandidateResolution || '',
        hasConfirmedDb: !!factory.product?.confirmedDb,
        confirmedCafeKey: factory.product?.confirmedCafe24ProductKey || '',
      },
      candidateState: {
        route: String(appState.step || ''),
        activeTab: String(factory.automation?.activeTab || ''),
        pendingDbCount: Number(factory.product?.pendingDbCandidates?.length || 0),
        dbCount: Number(factory.product?.dbCandidates?.length || 0),
        pendingCafeCount: Number(factory.product?.pendingCafe24Candidates?.length || 0),
        cafeCount: Number(factory.product?.cafe24Candidates?.length || 0),
        currentScopeKey: factoryCandidateReviewScopeKey(factory),
        dbScopeKey: factoryCandidateReviewScopeKeyFromCandidate(dbCandidates[0] || {}),
        cafeScopeKey: factoryCandidateReviewScopeKeyFromCandidate(cafeCandidates[0] || {}),
        dbSelectable: dbCandidates[0] ? factoryCandidateReviewCanApply(dbCandidates[0], factory) : false,
        cafeSelectable: cafeCandidates[0] ? factoryCandidateReviewCanApply(cafeCandidates[0], factory) : false,
        dbButtonCount: document.querySelectorAll('[data-factory-apply-db-candidate]').length,
        cafeButtonCount: document.querySelectorAll('[data-factory-apply-cafe24-candidate]').length,
        reviewPanelCount: document.querySelectorAll('.factory-candidate-review').length,
        activeFactoryTab: document.querySelector('[data-factory-tab].active')?.getAttribute('data-factory-tab') || '',
        hydrationActive: typeof classicRuntimeHydrationActive === 'boolean' ? classicRuntimeHydrationActive : null,
        initialRenderComplete: typeof classicRuntimeInitialRenderComplete === 'boolean' ? classicRuntimeInitialRenderComplete : null,
        hiddenCandidateNotice: document.querySelector('[data-factory-stale-candidate-notice]')?.textContent?.trim() || '',
      },
      persisted: await ${readPersistedExpression()},
      domConfirmedCount: document.body.innerText.includes('확정됨') ? (document.body.innerText.match(/확정됨/g) || []).length : 0,
    };
  }`);
}

async function readCandidateProof(cdp, { productKey, runId, inputImageFingerprint, backendBase, workspaceScope }) {
  const staleScope = `project:stale-candidate-v185::${productKey}::candidate-review`;
  const staleIdentity = `project:stale-candidate-v185::${runId}::${productKey}::${inputImageFingerprint}::candidate-review`;
  const foreignScope = `project:foreign-candidate-v185::${productKey}::candidate-review`;
  const foreignIdentity = `project:foreign-candidate-v185::${runId}::${productKey}::foreign-input::candidate-review`;
  const backendUrl = `${backendBase}/api/last-work?workspaceId=${encodeURIComponent(workspaceScope)}`;
  return evaluateFactoryCdpFixture(cdp, `(async ({ readFactory }) => {
    const readBackendLastWork = async () => {
      const response = await fetch(${JSON.stringify(backendUrl)}, { cache: 'no-store' });
      const raw = await response.text();
      const payload = JSON.parse(raw || '{}');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      return { status: response.status, ok: payload.ok === true, hasSnapshot: payload.hasSnapshot === true, workspaceId: payload.workspaceId || '', revision: Number(payload.revision || 0), sha256, bodyLength: raw.length };
    };
    const backendBefore = await readBackendLastWork();
    const beforePersisted = await ${readPersistedExpression()};
    const beforeFactory = readFactory();
    const currentCandidate = beforeFactory.product?.dbCandidates?.[0] || beforeFactory.product?.confirmedDb || {};
    const currentCafeCandidate = beforeFactory.product?.cafe24Candidates?.[0] || {
      product_name: currentCandidate.product_name || 'Cafe24 후보',
      product_no: 'CAFE24-V185',
      product_code: 'CAFE24-V185',
    };
    const currentScopeKey = factoryCandidateReviewScopeKey(beforeFactory);
    const makeCandidate = (candidate, scopeKey, identityKey) => ({
      ...candidate,
      reviewProductScopeKey: scopeKey,
      reviewProductIdentityKey: identityKey,
    });
    const staleCandidate = {
      ...makeCandidate(currentCandidate, ${JSON.stringify(staleScope)}, ${JSON.stringify(staleIdentity)}),
    };
    const foreignCandidate = {
      ...makeCandidate(currentCandidate, ${JSON.stringify(foreignScope)}, ${JSON.stringify(foreignIdentity)}),
    };
    const staleCafeCandidate = makeCandidate(currentCafeCandidate, ${JSON.stringify(staleScope)}, ${JSON.stringify(staleIdentity)});
    const foreignCafeCandidate = makeCandidate(currentCafeCandidate, ${JSON.stringify(foreignScope)}, ${JSON.stringify(foreignIdentity)});
    const currentSelectable = factoryCandidateReviewCanApply(currentCandidate, beforeFactory);
    const staleSelectable = factoryCandidateReviewCanApply(staleCandidate, beforeFactory);
    const foreignSelectable = factoryCandidateReviewCanApply(foreignCandidate, beforeFactory);
    const pick = value => ({
      dbKey: value.product?.selectedDbCandidateKey || '',
      cafeKey: value.product?.selectedCafe24CandidateKey || '',
      dbResolution: value.product?.dbCandidateResolution || '',
      cafeResolution: value.product?.cafe24CandidateResolution || '',
      confirmedDb: value.product?.confirmedDb || null,
      confirmedCafeKey: value.product?.confirmedCafe24ProductKey || '',
    });
    const applyAttempt = async (candidate, kind) => {
      const probe = structuredClone(beforeFactory);
      probe.product = {
        ...(probe.product || {}),
        pendingDbCandidates: [candidate],
        dbCandidates: [candidate],
        pendingCafe24Candidates: [candidate],
        cafe24Candidates: [candidate],
      };
      const selectionBefore = pick(probe);
      let outcome;
      try {
        const value = kind === 'db'
          ? await factoryApplyDbCandidateFromReview(0, { factory: probe, render: false })
          : await factoryApplyCafe24CandidateFromReview(0, { factory: probe, render: false });
        outcome = { status: 'resolved', value: value === true ? true : value === false ? false : String(value ?? '') };
      } catch (error) {
        outcome = { status: 'rejected', message: String(error?.message || error) };
      }
      const selectionAfter = pick(probe);
      return {
        outcome,
        selectionBefore,
        selectionAfter,
        selectionUnchanged: JSON.stringify(selectionBefore) === JSON.stringify(selectionAfter),
        confirmedDbUnchanged: JSON.stringify(selectionBefore.confirmedDb) === JSON.stringify(selectionAfter.confirmedDb),
      };
    };
    const staleDbAttempt = await applyAttempt(staleCandidate, 'db');
    const foreignDbAttempt = await applyAttempt(foreignCandidate, 'db');
    const staleCafe24Attempt = await applyAttempt(staleCafeCandidate, 'cafe24');
    const foreignCafe24Attempt = await applyAttempt(foreignCafeCandidate, 'cafe24');
    const afterPersisted = await ${readPersistedExpression()};
    const afterFactory = readFactory();
    const backendAfter = await readBackendLastWork();
    return {
      currentScopeKey,
      currentSelectable,
      staleSelectable,
      foreignSelectable,
      staleDbAttempt,
      foreignDbAttempt,
      staleCafe24Attempt,
      foreignCafe24Attempt,
      sameSession: JSON.stringify(beforePersisted.session) === JSON.stringify(afterPersisted.session),
      sameNamespace: JSON.stringify(beforePersisted.namespace) === JSON.stringify(afterPersisted.namespace),
      sameSelection: JSON.stringify(pick(beforeFactory)) === JSON.stringify(pick(afterFactory)),
      sameBackendLastWork: backendBefore.sha256 === backendAfter.sha256 && backendBefore.bodyLength === backendAfter.bodyLength,
      beforeNamespace: beforePersisted.namespace,
      afterNamespace: afterPersisted.namespace,
      backendBefore,
      backendAfter,
    };
  })`);
}

module.exports = { readPersistedExpression, reloadAndRead, readCandidateProof };
