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
  readPersistedExpression,
  readCandidateProof,
  reloadAndRead,
} = require('./factory_candidate_confirmation_harness_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:19232';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-reload-v185.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-reload-v185.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let runtime = null;
  let cdp = null;
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
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateConfirmationReload=v185` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof saveLastWorkNow === 'function'
    && typeof factoryStampWorkspaceIdentity === 'function'
    && typeof factoryCandidateReviewScopeKey === 'function'
    && typeof factoryCandidateReviewIdentityKey === 'function'
    && typeof factorySinhwaCandidateKey === 'function'
    && typeof factoryCafe24CandidateKey === 'function'
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof workspacePersistenceApi === 'function'`, 60000);
  console.log('[v185] page-ready');

  const seed = String(Date.now());
  const projectId = `project_candidate_confirm_v185_${seed}`;
  const productName = `확정복원검증상품_${seed}`;
  const runId = `run_candidate_confirm_v185_${seed}`;
  const productKey = productName.replace(/\s+/g, '').toLowerCase();
  const inputImageFingerprint = `input_candidate_confirm_v185_${seed}`;
  const expectedWorkspaceScope = `project:${projectId}`;
  const saved = await evaluateFactoryCdpFixture(cdp, `(async ({
    setAppState,
    readAppState,
    readFactory,
    readOperationToken,
    cloneFactory,
    replaceFactory,
    renderApp,
  }) => {
    const createdAt = Date.now();
    setAppState({
      currentProjectId: ${JSON.stringify(projectId)},
      currentProjectName: ${JSON.stringify(productName)},
      currentProjectCreatedAt: createdAt,
      productName: ${JSON.stringify(productName)},
      backendBaseUrl: ${JSON.stringify(BACKEND_BASE)},
      step: 'factory',
      analysis: null,
      competitorData: null,
      analysisImages: [],
      sectionContents: {},
      sectionImages: {},
      sectionVariants: {},
      detailImageBlocks: [],
      fixedDetailImages: {},
      cuts: {},
      optionSorter: normalizeOptionSorterState(defaultOptionSorterState()),
      compPage: {},
      aiRepairUndoStack: {},
    });
    localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)});
    const factory = cloneFactory();
    factoryStampWorkspaceIdentity(factory, {
      projectId: ${JSON.stringify(projectId)},
      projectName: ${JSON.stringify(productName)},
      createdAt,
    });
    factory.product = {
      ...factory.product,
      productName: ${JSON.stringify(productName)},
      userProductName: ${JSON.stringify(productName)},
      productKey: ${JSON.stringify(productKey)},
      productIdentityKey: ${JSON.stringify(productKey)},
      currentRunId: ${JSON.stringify(runId)},
      generationRunId: ${JSON.stringify(runId)},
      inputImageFingerprint: ${JSON.stringify(inputImageFingerprint)},
      lockedInputImageFingerprint: ${JSON.stringify(inputImageFingerprint)},
    };
    factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
    const db = {
      product_name: '신화사 확정 후보',
      jcode: 'DB-V185',
      match_query: ${JSON.stringify(productName)},
      reviewProductName: ${JSON.stringify(productName)},
      reviewProductScopeKey: factoryCandidateReviewScopeKey(factory),
      reviewProductIdentityKey: factoryCandidateReviewIdentityKey(factory),
    };
    const cafe = {
      product_name: 'Cafe24 확정 후보',
      product_no: 'CAFE24-V185',
      product_code: 'CAFE24-V185',
      match_query: ${JSON.stringify(productName)},
      reviewProductName: ${JSON.stringify(productName)},
      reviewProductScopeKey: factoryCandidateReviewScopeKey(factory),
      reviewProductIdentityKey: factoryCandidateReviewIdentityKey(factory),
    };
    const dbKey = factorySinhwaCandidateKey(db);
    const cafeKey = factoryCafe24CandidateKey(cafe);
    factory.product.dbCandidates = [db];
    factory.product.pendingDbCandidates = [db];
    factory.product.cafe24Candidates = [cafe];
    factory.product.pendingCafe24Candidates = [cafe];
    factory.product.selectedDbCandidateKey = dbKey;
    factory.product.selectedCafe24CandidateKey = cafeKey;
    factory.product.confirmedDb = { ...db, selected: true };
    factory.product.confirmedCafe24ProductKey = cafeKey;
    factory.product.cafe24DraftProductKey = cafeKey;
    factory.product.dbCandidateResolution = 'selected';
    factory.product.cafe24CandidateResolution = 'selected';
    factory.product.dbLocked = true;
    replaceFactory(factory, { mode: 'hydrate', workspaceId: ${JSON.stringify(projectId)} });
    renderApp();
    const operationTokenBeforeSave = readOperationToken();
    const readBackendLastWork = async () => {
      const response = await fetch(${JSON.stringify(`${BACKEND_BASE}/api/last-work?workspaceId=`)} + encodeURIComponent(${JSON.stringify(expectedWorkspaceScope)}), { cache: 'no-store' });
      const payload = await response.json();
      return { status: response.status, ok: payload.ok === true, hasSnapshot: payload.hasSnapshot === true, workspaceId: payload.workspaceId || '', revision: Number(payload.revision || 0) };
    };
    const backendBefore = await readBackendLastWork();
    const savePromise = saveLastWorkNow({ force: true, deep: true, server: false });
    if (savePromise && typeof savePromise.then === 'function') await savePromise;
    const afterSavePersisted = await ${readPersistedExpression()};
    const backendAfterSave = await readBackendLastWork();
    const operationTokenAfterSave = readOperationToken();
    await new Promise(resolve => setTimeout(resolve, 2500));
    const settledPersisted = await ${readPersistedExpression()};
    const backendSettled = await readBackendLastWork();
    const operationTokenSettled = readOperationToken();
    const currentFactory = readFactory();
    const currentState = readAppState();
    return {
      scope: getCurrentLastWorkWorkspaceScope(),
      expectedWorkspaceScope: ${JSON.stringify(expectedWorkspaceScope)},
      runId: currentFactory.product.currentRunId,
      productKey: currentFactory.product.productKey,
      inputImageFingerprint: currentFactory.product.inputImageFingerprint,
      operationTokenBeforeSave,
      operationTokenAfterSave,
      operationTokenSettled,
      backendBefore,
      backendAfterSave,
      backendSettled,
      operationTokenScope: workspacePersistenceApi().normalizeProjectScope(operationTokenAfterSave.workspaceId),
      appWorkspaceId: currentState.currentProjectId || '',
      appWorkspaceScope: getCurrentLastWorkWorkspaceScope(),
      state: {
        dbKey: currentFactory.product.selectedDbCandidateKey,
        cafeKey: currentFactory.product.selectedCafe24CandidateKey,
        dbResolution: currentFactory.product.dbCandidateResolution,
        cafeResolution: currentFactory.product.cafe24CandidateResolution,
        hasConfirmedDb: !!currentFactory.product.confirmedDb,
        reviewScopeKey: currentFactory.product.dbCandidates?.[0]?.reviewProductScopeKey || '',
        reviewIdentityKey: currentFactory.product.dbCandidates?.[0]?.reviewProductIdentityKey || '',
      },
      afterSavePersisted,
      persisted: settledPersisted,
    };
  })`);
  console.log('[v185] seeded-and-saved');

  const firstReload = await reloadAndRead(cdp, APP_URL);
  console.log('[v185] first-reload-read');
  const secondReload = await reloadAndRead(cdp, APP_URL);
  console.log('[v185] second-reload-read');
  const candidateProof = await readCandidateProof(cdp, { productKey, runId, inputImageFingerprint, backendBase: BACKEND_BASE, workspaceScope: expectedWorkspaceScope });
  console.log('[v185] stale-foreign-candidate-read');
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

  const savedRevision = Number(saved.afterSavePersisted.session?.workspaceRevision?.counter || 0);
  const savedRevisionEntry = saved.afterSavePersisted.revisionRegistry?.[expectedWorkspaceScope] || {};
  const backendReads = [saved.backendBefore, saved.backendAfterSave, saved.backendSettled];
  const backendSaveFlowValid = saved.backendBefore?.status === 200 && saved.backendBefore.ok === true
    && saved.backendBefore.hasSnapshot === false && saved.backendBefore.workspaceId === expectedWorkspaceScope
    && saved.backendAfterSave?.status === 200 && saved.backendAfterSave.ok === true
    && saved.backendAfterSave.hasSnapshot === true && saved.backendAfterSave.workspaceId === expectedWorkspaceScope
    && saved.backendSettled?.status === 200 && saved.backendSettled.ok === true
    && saved.backendSettled.hasSnapshot === true && saved.backendSettled.workspaceId === expectedWorkspaceScope
    && Number(saved.backendSettled.revision) >= Number(saved.backendAfterSave.revision);
  const checks = [
    { ok: saved.expectedWorkspaceScope === expectedWorkspaceScope && saved.scope === expectedWorkspaceScope && saved.appWorkspaceScope === expectedWorkspaceScope && saved.appWorkspaceId === projectId, message: `저장 시 app/workspace scope 불일치: ${JSON.stringify({ expectedWorkspaceScope, saved })}` },
    { ok: saved.runId === runId && saved.productKey === productKey && saved.inputImageFingerprint === inputImageFingerprint, message: `저장 시 작업 identity 불일치: ${JSON.stringify(saved)}` },
    { ok: Boolean(saved.state.dbKey && saved.state.cafeKey && saved.state.dbResolution === 'selected' && saved.state.cafeResolution === 'selected' && saved.state.hasConfirmedDb && saved.state.reviewScopeKey && saved.state.reviewIdentityKey.includes(runId) && saved.state.reviewIdentityKey.includes(inputImageFingerprint)), message: `저장 전 확정 상태가 불완전합니다: ${JSON.stringify(saved.state)}` },
    { ok: backendSaveFlowValid, message: `saveLastWorkNow backend last-work 저장 경계 불일치: ${JSON.stringify(backendReads)}` },
    { ok: saved.operationTokenBeforeSave?.workspaceId === projectId && Number(saved.operationTokenBeforeSave?.revision) === 0, message: `seed operation token 불일치: ${JSON.stringify(saved.operationTokenBeforeSave)}` },
    { ok: saved.operationTokenAfterSave?.workspaceId === projectId && saved.operationTokenScope === expectedWorkspaceScope && Number(saved.operationTokenAfterSave?.revision) >= Number(saved.operationTokenBeforeSave?.revision), message: `저장 후 operation token scope/revision 불일치: ${JSON.stringify(saved.operationTokenAfterSave)}` },
    { ok: saved.operationTokenSettled?.workspaceId === projectId && Number(saved.operationTokenSettled?.revision) >= Number(saved.operationTokenAfterSave?.revision), message: `저장 안정화 후 operation token revision 불일치: ${JSON.stringify(saved.operationTokenSettled)}` },
    { ok: saved.afterSavePersisted.session.dbKey === saved.state.dbKey && saved.afterSavePersisted.session.cafeKey === saved.state.cafeKey && saved.afterSavePersisted.session.dbResolution === 'selected' && saved.afterSavePersisted.session.cafeResolution === 'selected' && saved.afterSavePersisted.session.confirmedCafeKey === saved.state.cafeKey, message: `saveLastWorkNow 완료 후 pdp_session 확정 메타데이터 불일치: ${JSON.stringify(saved.afterSavePersisted.session)}` },
    { ok: saved.afterSavePersisted.session.projectId === projectId && saved.afterSavePersisted.session.workspaceScope?.id === expectedWorkspaceScope && saved.afterSavePersisted.session.workspaceRevision?.scopeId === expectedWorkspaceScope && savedRevision > 0 && savedRevisionEntry.scopeId === expectedWorkspaceScope && Number(savedRevisionEntry.counter) === savedRevision, message: `saveLastWorkNow 완료 후 작업파일 scope/revision 불일치: ${JSON.stringify(saved.afterSavePersisted)}` },
    { ok: saved.persisted.session.projectId === projectId && saved.persisted.session.workspaceScope?.id === expectedWorkspaceScope && saved.persisted.session.workspaceRevision?.scopeId === expectedWorkspaceScope && saved.persisted.session.dbKey === saved.state.dbKey && saved.persisted.session.cafeKey === saved.state.cafeKey && Number(saved.persisted.session.workspaceRevision?.counter) >= savedRevision && saved.persisted.revisionRegistry?.[expectedWorkspaceScope]?.scopeId === expectedWorkspaceScope && Number(saved.persisted.revisionRegistry?.[expectedWorkspaceScope]?.counter) >= savedRevision, message: `settled persisted envelope 불일치: ${JSON.stringify(saved.persisted)}` },
    { ok: saved.afterSavePersisted.namespace.session.length > 0 && saved.persisted.namespace.session.length > 0, message: `pdp_session recovery namespace가 비어 있습니다: ${JSON.stringify({ afterSave: saved.afterSavePersisted.namespace, settled: saved.persisted.namespace })}` },
    { ok: firstReload.projectId === projectId && firstReload.productName === productName && firstReload.scope === expectedWorkspaceScope && firstReload.factoryWorkspaceId === projectId && firstReload.factoryWorkspaceScope === expectedWorkspaceScope && firstReload.operationToken?.workspaceId === projectId && firstReload.operationTokenScope === expectedWorkspaceScope && Number(firstReload.operationToken?.revision) > 0, message: `첫 Ctrl+F5 후 app/factory/store identity 불일치: ${JSON.stringify(firstReload)}` },
    { ok: firstReload.state.dbKey === saved.state.dbKey && firstReload.state.cafeKey === saved.state.cafeKey && firstReload.state.dbResolution === 'selected' && firstReload.state.cafeResolution === 'selected' && firstReload.state.hasConfirmedDb === true && firstReload.state.confirmedCafeKey === saved.state.cafeKey && firstReload.domConfirmedCount === 2, message: `첫 Ctrl+F5 후 확정 메타데이터/DOM 소실: ${JSON.stringify(firstReload)}` },
    { ok: firstReload.persisted.session?.projectId === projectId && firstReload.persisted.session?.workspaceScope?.id === expectedWorkspaceScope && firstReload.persisted.session?.workspaceRevision?.scopeId === expectedWorkspaceScope && Number(firstReload.persisted.session?.workspaceRevision?.counter) > 0 && firstReload.persisted.revisionRegistry?.[expectedWorkspaceScope]?.scopeId === expectedWorkspaceScope, message: `첫 Ctrl+F5 후 작업파일 scope/revision 변경: ${JSON.stringify(firstReload.persisted)}` },
    { ok: secondReload.projectId === projectId && secondReload.productName === productName && secondReload.scope === expectedWorkspaceScope && secondReload.factoryWorkspaceId === projectId && secondReload.factoryWorkspaceScope === expectedWorkspaceScope && secondReload.operationToken?.workspaceId === projectId && secondReload.operationTokenScope === expectedWorkspaceScope && Number(secondReload.operationToken?.revision) > 0, message: `두 번째 Ctrl+F5 후 app/factory/store identity 불일치: ${JSON.stringify(secondReload)}` },
    { ok: secondReload.state.dbKey === saved.state.dbKey && secondReload.state.cafeKey === saved.state.cafeKey && secondReload.state.dbResolution === 'selected' && secondReload.state.cafeResolution === 'selected' && secondReload.state.hasConfirmedDb === true && secondReload.state.confirmedCafeKey === saved.state.cafeKey && secondReload.domConfirmedCount === 2, message: `두 번째 Ctrl+F5 후 확정 메타데이터/DOM 소실: ${JSON.stringify(secondReload)}` },
    { ok: secondReload.persisted.session?.projectId === projectId && secondReload.persisted.session?.workspaceScope?.id === expectedWorkspaceScope && secondReload.persisted.session?.workspaceRevision?.scopeId === expectedWorkspaceScope && Number(secondReload.persisted.session?.workspaceRevision?.counter) > 0 && secondReload.persisted.revisionRegistry?.[expectedWorkspaceScope]?.scopeId === expectedWorkspaceScope, message: `두 번째 Ctrl+F5 후 작업파일 scope/revision 변경: ${JSON.stringify(secondReload.persisted)}` },
    { ok: candidateProof.currentScopeKey === saved.state.reviewScopeKey && candidateProof.currentSelectable === true && candidateProof.staleSelectable === false && candidateProof.foreignSelectable === false, message: `현재/stale/foreign 후보 판정 오류: ${JSON.stringify(candidateProof)}` },
    { ok: [candidateProof.staleDbAttempt, candidateProof.foreignDbAttempt, candidateProof.staleCafe24Attempt, candidateProof.foreignCafe24Attempt].every(attempt => attempt?.outcome?.status === 'resolved' && attempt.outcome.value === false && attempt.selectionUnchanged === true && attempt.confirmedDbUnchanged === true), message: `실제 후보 적용 명령이 stale/foreign 후보를 거부하지 않았거나 선택/확정 상태를 바꿨습니다: ${JSON.stringify(candidateProof)}` },
    { ok: candidateProof.sameSession === true && candidateProof.sameNamespace === true && candidateProof.sameSelection === true && candidateProof.sameBackendLastWork === true && candidateProof.beforeNamespace.session.length > 0 && candidateProof.afterNamespace.session.length > 0 && JSON.stringify(candidateProof.backendBefore) === JSON.stringify(candidateProof.backendAfter), message: `stale/foreign 후보 시도 후 last-work namespace/SHA 또는 확정 상태 변경: ${JSON.stringify(candidateProof)}` },
  ];
  const result = { ok: checks.every(item => item.ok), saved, firstReload, secondReload, candidateProof, screenshot: SCREENSHOT_PATH, checks };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
  } finally {
    try { cdp?.close(); } catch (_) {}
    try { await runtime?.cleanup?.(); } catch (_) {}
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
