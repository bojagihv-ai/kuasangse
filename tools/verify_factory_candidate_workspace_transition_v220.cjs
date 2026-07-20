const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');
const {
  backendReadExpression,
  readCandidateApplyProof,
  reloadAndRead,
  resolveTestScopePaths,
} = require('./factory_workspace_transition_harness_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9782';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:19232';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-workspace-transition-v220.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-workspace-transition-v220.png');

async function capture(cdp) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
}

async function cleanupWorkspaceArtifacts(scopeId, authority, knownPath = '') {
  if (!scopeId) return { skipped: true, reason: 'scope-not-created' };
  const statusUrl = `${BACKEND_BASE}/api/workspace-lock/status?workspaceId=${encodeURIComponent(scopeId)}`;
  const workUrl = `${BACKEND_BASE}/api/last-work?workspaceId=${encodeURIComponent(scopeId)}`;
  const { livePath, backupPath } = resolveTestScopePaths(scopeId, knownPath);
  let before = null;
  let lease = authority;
  let deleted = null;
  let released = null;
  try {
    before = await fetch(statusUrl).then(response => response.json());
    lease = before.leaseId === authority?.leaseId ? before : authority;
    if (lease?.leaseId && Number(lease.fencingToken) > 0) {
      const response = await fetch(workUrl, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: scopeId, leaseId: lease.leaseId, fencingToken: Number(lease.fencingToken), expectedRevision: Number(before.revision), revision: Number(before.revision) + 1 }) });
      deleted = { status: response.status, body: await response.json().catch(() => ({})) };
      if (deleted.status !== 200 || deleted.body?.cleared !== true) throw new Error(`DB-03 scoped DELETE failed: ${JSON.stringify(deleted)}`);
    }
  } finally {
    try {
      if (lease?.leaseId && Number(lease.fencingToken) > 0) {
        const response = await fetch(`${BACKEND_BASE}/api/workspace-lock/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: scopeId, leaseId: lease.leaseId, fencingToken: Number(lease.fencingToken) }) });
        released = { status: response.status, body: await response.json().catch(() => ({})) };
        if (released.status !== 200 || released.body?.leaseId !== '') throw new Error(`DB-03 authority release failed: ${JSON.stringify(released)}`);
      }
    } finally {
      for (const target of [livePath, backupPath]) fs.rmSync(target, { force: true });
    }
  }
  const afterWork = await fetch(workUrl, { cache: 'no-store' }).then(response => response.json());
  const afterAuthority = await fetch(statusUrl, { cache: 'no-store' }).then(response => response.json());
  const filesAbsent = [livePath, backupPath].every(target => !fs.existsSync(target));
  const leaseReleased = !afterAuthority.leaseId || afterAuthority.state === 'released' || afterAuthority.mode === 'released';
  if (afterWork.hasSnapshot !== false || !filesAbsent || !leaseReleased) throw new Error(`DB-03 cleanup incomplete: ${JSON.stringify({ afterWork, afterAuthority, filesAbsent })}`);
  return { scopeId, deleted, released, livePath, backupPath, filesAbsent, hasSnapshot: afterWork.hasSnapshot, leaseReleased };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let runtime = null;
  let cdp = null;
  let cleanupScope = '';
  let cleanupAuthority = null;
  let cleanupPath = '';
  let result = null;
  let failure = null;
  try {
    runtime = await ensureCdp(CDP_URL);
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateWorkspaceTransition=v220` });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof saveCurrentProject === 'function'
      && typeof factoryRuntimeReplaceFactorySnapshot === 'function'
      && typeof factoryCurrentWorkspaceId === 'function'
      && typeof factoryCurrentProductKey === 'function'
      && typeof factoryCandidateReviewScopeKey === 'function'
      && typeof factoryCandidateReviewIdentityKey === 'function'
      && typeof factorySinhwaCandidateKey === 'function'
      && typeof factoryCafe24CandidateKey === 'function'
      && typeof workspacePersistenceApi === 'function'
      && typeof flushQueuedPersistentState === 'function'
      && typeof workspaceLockApi === 'function'
      && typeof getCurrentLastWorkWorkspaceScope === 'function'`, 60000);
    console.log('[v220] canonical-page-ready');

    const seed = String(Date.now());
    const productName = `동일 제품 저장 전환 후보 검증 수저집_${seed}`;
    const runId = `candidate-workspace-transition-run-v220-${seed}`;
    const inputImageFingerprint = `candidate-workspace-transition-image-v220-${seed}`;
    const seedResult = await evaluateFactoryCdpFixture(cdp, `(async ({ setAppState, readAppState, readFactory, readOperationToken, cloneFactory, replaceFactory, renderApp }) => {
      const draftName = ${JSON.stringify(productName)};
      setAppState({ currentProjectId: '', currentProjectName: draftName, currentProjectCreatedAt: null, productName: draftName, backendBaseUrl: ${JSON.stringify(BACKEND_BASE)}, step: 'factory', analysis: null, competitorData: null, analysisImages: [], sectionContents: {}, sectionImages: {}, sectionVariants: {}, detailImageBlocks: [], fixedDetailImages: {}, cuts: {}, compPage: {}, aiRepairUndoStack: {} });
      localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)});
      const factory = cloneFactory();
      factory.workspace = { ...(factory.workspace || {}), id: '', name: draftName, createdAt: null };
      factory.currentProjectId = '';
      factory.currentProjectName = draftName;
      factory.product = { ...(factory.product || {}), productName: draftName, userProductName: draftName, productKey: factoryNormalizeIdentityText(draftName), productIdentityKey: factoryNormalizeIdentityText(draftName), currentRunId: ${JSON.stringify(runId)}, generationRunId: ${JSON.stringify(runId)}, inputImageFingerprint: ${JSON.stringify(inputImageFingerprint)}, lockedInputImageFingerprint: ${JSON.stringify(inputImageFingerprint)}, selectedDbCandidateKey: '', selectedCafe24CandidateKey: '', dbCandidateResolution: '', cafe24CandidateResolution: '', confirmedDb: null, confirmedCafe24ProductKey: '', cafe24DraftProductKey: '' };
      factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
      const draftScope = getCurrentLastWorkWorkspaceScope();
      const scopeKey = factoryCandidateReviewScopeKey(factory);
      const identityKey = factoryCandidateReviewIdentityKey(factory);
      const db = { jcode: 'DB-V220', jname: '동일 제품 신화사DB 후보', product_name: '동일 제품 신화사DB 후보', match_query: draftName, reviewProductName: draftName, reviewProductScopeKey: scopeKey, reviewProductIdentityKey: identityKey };
      const cafe = { product_no: 'C24-V220', product_code: 'C24-V220', product_name: '동일 제품 Cafe24 후보', match_query: draftName, reviewProductName: draftName, reviewProductScopeKey: scopeKey, reviewProductIdentityKey: identityKey };
      factory.product.pendingDbCandidates = [db];
      factory.product.dbCandidates = [db];
      factory.product.pendingCafe24Candidates = [cafe];
      factory.product.cafe24Candidates = [cafe];
      replaceFactory(factory, { mode: 'hydrate', workspaceId: draftScope, reason: 'db03-seed' });
      setAppState({ factory: cloneFactory() });
      renderApp();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const readPhase = () => { const app = readAppState(); const current = readFactory(); const stateFactory = app.factory || {}; const token = readOperationToken(); const button = selector => { const node = document.querySelector(selector); return { exists: !!node, disabled: node ? node.disabled : null }; }; return { appWorkspaceId: app.currentProjectId || '', stateFactoryWorkspaceId: stateFactory.workspace?.id || stateFactory.currentProjectId || '', factoryWorkspaceId: current.workspace?.id || current.currentProjectId || '', scope: getCurrentLastWorkWorkspaceScope(), token, authority: workspaceLockApi()?.snapshot?.() || null, dbScope: current.product?.pendingDbCandidates?.[0]?.reviewProductScopeKey || '', cafeScope: current.product?.pendingCafe24Candidates?.[0]?.reviewProductScopeKey || '', stateDbScope: stateFactory.product?.pendingDbCandidates?.[0]?.reviewProductScopeKey || '', stateCafeScope: stateFactory.product?.pendingCafe24Candidates?.[0]?.reviewProductScopeKey || '', dbKey: current.product?.selectedDbCandidateKey || '', cafeKey: current.product?.selectedCafe24CandidateKey || '', dbResolution: current.product?.dbCandidateResolution || '', cafeResolution: current.product?.cafe24CandidateResolution || '', hasConfirmedDb: !!current.product?.confirmedDb, buttons: { db: button('[data-factory-apply-db-candidate="0"]'), cafe24: button('[data-factory-apply-cafe24-candidate="0"]') } }; };
      const before = readPhase();
      const oldDbCandidate = structuredClone(db);
      const oldCafeCandidate = structuredClone(cafe);
      const saveResult = await saveCurrentProject();
      await new Promise(resolve => setTimeout(resolve, 700));
      const afterSave = readPhase();
      const appAfterSave = readAppState();
      const projectId = appAfterSave.currentProjectId || '';
      const persistedFactory = structuredClone(appAfterSave.factory || readFactory());
      const transitionResult = projectId
        ? factoryRuntimeReplaceFactorySnapshot(persistedFactory, { mode: 'hydrate', workspaceId: projectId, reason: 'db03-save-transition' })
        : null;
      setAppState({ factory: cloneFactory() });
      renderApp();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const persistAfterTransition = projectId ? await flushQueuedPersistentState({ skipSessionAssetSave: true }) : false;
      const afterTransition = readPhase();
      return { productName: draftName, projectId, draftScope, before, afterSave, afterTransition, oldDbCandidate, oldCafeCandidate, saveResult: saveResult || null, stateError: appAfterSave.error || '', transitionResult: transitionResult ? true : false, persistAfterTransition };
    })`);
    const projectScope = seedResult.projectId ? `project:${seedResult.projectId}` : '';
    cleanupScope = projectScope;
    cleanupAuthority = seedResult.afterTransition.authority;
    const backendAfterSave = await evaluateFactoryCdpFixture(cdp, `(async () => ${backendReadExpression(BACKEND_BASE, projectScope)})`);
    cleanupPath = backendAfterSave.path;
    if (process.env.KUASANGSE_DB03_FAIL_AFTER_SAVE === '1') throw new Error('DB03 forced post-save cleanup probe');
    const candidateProof = await readCandidateApplyProof(cdp, { backendBase: BACKEND_BASE, workspaceScope: projectScope, oldDbCandidate: seedResult.oldDbCandidate, oldCafeCandidate: seedResult.oldCafeCandidate });
    const reload = await reloadAndRead(cdp, APP_URL, BACKEND_BASE, projectScope);
    await capture(cdp);

    const beforeToken = seedResult.before.token || {};
    const afterToken = seedResult.afterTransition.token || {};
    const persistedRevision = reload.persisted.session?.workspaceRevision || {};
    const registeredRevision = reload.persisted.revisionRegistry?.[projectScope] || {};
    const attempts = Object.values(candidateProof.attempts || {});
    const currentAttempts = [candidateProof.attempts?.currentDb, candidateProof.attempts?.currentCafe].filter(Boolean);
    const rejectedAttempts = ['oldDb', 'staleDb', 'foreignDb', 'oldCafe', 'staleCafe', 'foreignCafe']
      .map(name => candidateProof.attempts?.[name]).filter(Boolean);
    const checks = [
      { ok: !!seedResult.draftScope && seedResult.before.appWorkspaceId === '' && seedResult.before.factoryWorkspaceId === '' && seedResult.before.scope === seedResult.draftScope && beforeToken.workspaceId === seedResult.draftScope && Number(beforeToken.revision) >= 1, message: `저장 전 draft app/factory/store scope 또는 revision 불일치: ${JSON.stringify(seedResult.before)}` },
      { ok: !!seedResult.projectId && seedResult.stateError === '' && seedResult.afterSave.appWorkspaceId === seedResult.projectId && seedResult.afterSave.stateFactoryWorkspaceId === seedResult.projectId && seedResult.afterSave.stateDbScope.startsWith(`${seedResult.projectId}::`) && seedResult.afterSave.stateCafeScope.startsWith(`${seedResult.projectId}::`) && seedResult.afterSave.scope === projectScope, message: `saveCurrentProject 실제 전환 후 app/state scope가 project로 바뀌지 않았습니다: ${JSON.stringify(seedResult)}` },
      { ok: seedResult.transitionResult === true && seedResult.persistAfterTransition === true && seedResult.afterTransition.appWorkspaceId === seedResult.projectId && seedResult.afterTransition.stateFactoryWorkspaceId === seedResult.projectId && seedResult.afterTransition.factoryWorkspaceId === seedResult.projectId && seedResult.afterTransition.scope === projectScope && afterToken.workspaceId === seedResult.projectId && Number(afterToken.revision) >= 1 && Number(afterToken.fence) > Number(beforeToken.fence), message: `canonical store transition token scope/revision 불일치: ${JSON.stringify({ before: seedResult.before, afterSave: seedResult.afterSave, afterTransition: seedResult.afterTransition })}` },
      { ok: seedResult.afterTransition.dbScope.startsWith(`${seedResult.projectId}::`) && seedResult.afterTransition.cafeScope.startsWith(`${seedResult.projectId}::`), message: `전환 후 DB/Cafe24 후보 scope가 project 범위가 아닙니다: ${JSON.stringify(seedResult.afterTransition)}` },
      { ok: seedResult.afterTransition.buttons?.db?.exists === true && seedResult.afterTransition.buttons.db.disabled === false, message: `전환 후 신화사DB 선택 버튼이 없거나 비활성입니다: ${JSON.stringify(seedResult.afterTransition.buttons?.db)}` },
      { ok: seedResult.afterTransition.buttons?.cafe24?.exists === true && seedResult.afterTransition.buttons.cafe24.disabled === false, message: `전환 후 Cafe24 선택 버튼이 없거나 비활성입니다: ${JSON.stringify(seedResult.afterTransition.buttons?.cafe24)}` },
      { ok: backendAfterSave.ok === true && backendAfterSave.hasSnapshot === true && backendAfterSave.workspaceId === projectScope && backendAfterSave.sha256 && backendAfterSave.bodyLength > 0, message: `saveCurrentProject backend last-work snapshot이 없습니다: ${JSON.stringify(backendAfterSave)}` },
      { ok: candidateProof.currentScopeKey === seedResult.afterTransition.dbScope && candidateProof.currentDbSelectable === true && candidateProof.currentCafeSelectable === true && candidateProof.oldDbSelectable === false && candidateProof.oldCafeSelectable === false && candidateProof.staleDbSelectable === false && candidateProof.foreignDbSelectable === false, message: `현재/old/stale/foreign 후보 scope 판정 불일치: ${JSON.stringify(candidateProof)}` },
      { ok: attempts.length === 8 && currentAttempts.length === 2 && currentAttempts.every(attempt => attempt.outcome?.status === 'resolved' && attempt.outcome.value === true && attempt.mutationMatches === true && attempt.networkStubInstalled === true && attempt.probeChanged === true && attempt.globalStateUnchanged === true && attempt.runtimeFactoryUnchanged === true && attempt.recoveryUnchanged === true && attempt.backendUnchanged === true), message: `현재 DB/Cafe24 실제 inner apply 성공·정확한 mutation 또는 probe isolation이 확인되지 않았습니다: ${JSON.stringify(candidateProof.attempts)}` },
      { ok: rejectedAttempts.length === 6 && rejectedAttempts.every(attempt => attempt.outcome?.status === 'resolved' && attempt.outcome.value === false && attempt.selectionUnchanged === true && attempt.confirmedUnchanged === true && attempt.networkStubInstalled === false && attempt.globalStateUnchanged === true && attempt.runtimeFactoryUnchanged === true && attempt.recoveryUnchanged === true && attempt.backendUnchanged === true), message: `실제 production 후보 apply seam이 old/stale/foreign 후보를 거부하지 않았거나 selection/confirmed/recovery/backend가 변했습니다: ${JSON.stringify(candidateProof.attempts)}` },
      { ok: candidateProof.rejectedRecoveryUnchanged === true && candidateProof.rejectedBackendUnchanged === true && candidateProof.sameRecovery === true && candidateProof.sameBackend === true && candidateProof.beforeNamespace > 0 && candidateProof.afterNamespace === candidateProof.beforeNamespace, message: `후보 거부 시 recovery namespace 또는 backend last-work body/SHA/revision이 정확히 불변이 아닙니다: ${JSON.stringify(candidateProof)}` },
      { ok: reload.appWorkspaceId === seedResult.projectId && reload.factoryWorkspaceId === seedResult.projectId && reload.scope === projectScope && reload.operationToken?.version === 'factory-store:v1' && reload.operationToken?.workspaceId === seedResult.projectId && reload.operationTokenScope === projectScope && reload.operationToken?.revision === 1 && reload.operationToken?.fence === 2, message: `reload 후 app/factory/store workspace identity 또는 operation token exact identity가 보존되지 않았습니다: ${JSON.stringify(reload)}` },
      { ok: reload.state.dbCandidateScope === candidateProof.currentScopeKey && reload.state.cafeCandidateScope === candidateProof.currentScopeKey && reload.state.dbKey === '' && reload.state.cafeKey === '' && reload.state.dbResolution === '' && reload.state.cafeResolution === '' && reload.state.hasConfirmedDb === false, message: `reload 후 후보 scope 또는 미확정 selection 상태가 변했습니다: ${JSON.stringify(reload)}` },
      { ok: reload.persisted.session?.projectId === seedResult.projectId && reload.persisted.session?.workspaceScope?.id === projectScope && persistedRevision.scopeId === projectScope && persistedRevision.counter === backendAfterSave.revision && persistedRevision.writerId === seedResult.afterTransition.authority?.sessionId && JSON.stringify(persistedRevision) === JSON.stringify(registeredRevision) && reload.persisted.session?.dbScope === candidateProof.currentScopeKey && reload.persisted.session?.cafeScope === candidateProof.currentScopeKey, message: `persisted workspace transition 또는 workspaceRevision exact identity가 reload 뒤 복원되지 않았습니다: ${JSON.stringify(reload.persisted)}` },
      { ok: reload.backend?.workspaceId === projectScope && reload.backend?.hasSnapshot === true && reload.backend?.revision === backendAfterSave.revision + 1 && reload.backend?.sha256 && reload.backend?.bodyLength > 0, message: `reload 후 global last-work scope/revision exact invariant 불일치: ${JSON.stringify({ saved: backendAfterSave, reload: reload.backend })}` },
    ];
    result = { ok: checks.every(item => item.ok), seed: seedResult, backendAfterSave, candidateProof, reload, screenshotPath: SCREENSHOT_PATH, checks };
    assertChecks(checks);
  } catch (error) {
    failure = error;
    result = result || { ok: false, error: error?.stack || String(error) };
  } finally {
    try { result.cleanup = await cleanupWorkspaceArtifacts(cleanupScope, cleanupAuthority, cleanupPath); } catch (error) { result.cleanup = { ok: false, error: error?.stack || String(error) }; failure = failure || error; }
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    try { cdp?.close(); } catch (_) {}
    try { await runtime?.cleanup?.(); } catch (_) {}
  }
  if (failure) throw failure;
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
