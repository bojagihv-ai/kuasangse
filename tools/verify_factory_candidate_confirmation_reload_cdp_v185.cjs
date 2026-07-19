const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-reload-v185.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-reload-v185.png');

function readPersistedExpression() {
  return `(() => {
    const read = key => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
    };
    const session = read('pdp_session');
    const bootstrap = read('pdp_last_work_bootstrap_v1');
    const snapshot = read('factory_last_snapshot_v1');
    const pick = value => ({
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
      bootstrap: pick(bootstrap),
      snapshot: pick(snapshot),
      revisionRegistry: read('kuasangse_workspace_revisions_v1') || {},
    };
  })()`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.navigate', { url: `${APP_URL}?candidateConfirmationReload=v185` });
  await waitFor(cdp, '!!(window.state && window.factoryState && window.saveLastWorkNow && window.render)', 60000);
  console.log('[v185] page-ready');

  const seed = String(Date.now());
  const projectId = `project_candidate_confirm_v185_${seed}`;
  const productName = `확정복원검증상품_${seed}`;
  const runId = `run_candidate_confirm_v185_${seed}`;
  const productKey = productName.replace(/\s+/g, '').toLowerCase();
  const inputImageFingerprint = `input_candidate_confirm_v185_${seed}`;
  const saved = await evaluate(cdp, `(async () => {
    const state = window.state;
    state.currentProjectId = ${JSON.stringify(projectId)};
    state.currentProjectName = ${JSON.stringify(productName)};
    state.currentProjectCreatedAt = Date.now();
    state.productName = ${JSON.stringify(productName)};
    state.step = 'factory';
    state.analysis = null;
    state.competitorData = null;
    state.analysisImages = [];
    state.sectionContents = {};
    state.sectionImages = {};
    state.sectionVariants = {};
    state.detailImageBlocks = [];
    state.fixedDetailImages = {};
    state.cuts = {};
    state.optionSorter = window.normalizeOptionSorterState(window.defaultOptionSorterState());
    state.compPage = {};
    state.aiRepairUndoStack = {};
    state.factory = window.normalizeFactoryState({});
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, {
      projectId: ${JSON.stringify(projectId)},
      projectName: ${JSON.stringify(productName)},
      createdAt: state.currentProjectCreatedAt,
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
    factory.automation.activeTab = 'db';
    const db = {
      product_name: '신화사 확정 후보',
      jcode: 'DB-V185',
      match_query: ${JSON.stringify(productName)},
      reviewProductName: ${JSON.stringify(productName)},
      reviewProductScopeKey: window.factoryCandidateReviewScopeKey(factory),
      reviewProductIdentityKey: window.factoryCandidateReviewIdentityKey(factory),
    };
    const cafe = {
      product_name: 'Cafe24 확정 후보',
      product_no: 'CAFE24-V185',
      product_code: 'CAFE24-V185',
      match_query: ${JSON.stringify(productName)},
      reviewProductName: ${JSON.stringify(productName)},
      reviewProductScopeKey: window.factoryCandidateReviewScopeKey(factory),
      reviewProductIdentityKey: window.factoryCandidateReviewIdentityKey(factory),
    };
    const dbKey = window.factorySinhwaCandidateKey(db);
    const cafeKey = window.factoryCafe24CandidateKey(cafe);
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
    window.render();
    const savePromise = window.saveLastWorkNow({ force: true, deep: true, server: false });
    const immediatePersisted = ${readPersistedExpression()};
    await new Promise(resolve => setTimeout(resolve, 2500));
    const settledPersisted = ${readPersistedExpression()};
    return {
      scope: window.getCurrentLastWorkWorkspaceScope(),
      runId: factory.product.currentRunId,
      productKey: factory.product.productKey,
      inputImageFingerprint: factory.product.inputImageFingerprint,
      state: {
        dbKey: factory.product.selectedDbCandidateKey,
        cafeKey: factory.product.selectedCafe24CandidateKey,
        dbResolution: factory.product.dbCandidateResolution,
        cafeResolution: factory.product.cafe24CandidateResolution,
        hasConfirmedDb: !!factory.product.confirmedDb,
      },
      immediatePersisted,
      persisted: settledPersisted,
    };
  })()`);
  console.log('[v185] seeded-and-saved');

  const firstReload = await reloadAndRead(cdp, projectId, productName);
  console.log('[v185] first-reload-read');
  const secondReload = await reloadAndRead(cdp, projectId, productName);
  console.log('[v185] second-reload-read');
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

  const checks = [
    { ok: Boolean(saved.state.dbKey && saved.state.cafeKey && saved.state.dbResolution === 'selected' && saved.state.cafeResolution === 'selected'), message: `저장 전 확정 상태가 불완전합니다: ${JSON.stringify(saved.state)}` },
    { ok: saved.persisted.session.dbKey === saved.state.dbKey && saved.persisted.session.cafeKey === saved.state.cafeKey && saved.persisted.session.dbResolution === 'selected' && saved.persisted.session.cafeResolution === 'selected' && saved.persisted.session.confirmedCafeKey === saved.state.cafeKey, message: `저장 직후 pdp_session 확정 메타데이터 불일치: ${JSON.stringify(saved.persisted.session)}` },
    { ok: firstReload.state.dbKey === saved.state.dbKey && firstReload.state.cafeKey === saved.state.cafeKey && firstReload.state.dbResolution === 'selected' && firstReload.state.cafeResolution === 'selected' && firstReload.state.confirmedCafeKey === saved.state.cafeKey, message: `첫 Ctrl+F5 후 확정 메타데이터 소실: ${JSON.stringify(firstReload)}` },
    { ok: secondReload.state.dbKey === saved.state.dbKey && secondReload.state.cafeKey === saved.state.cafeKey && secondReload.state.dbResolution === 'selected' && secondReload.state.cafeResolution === 'selected' && secondReload.state.confirmedCafeKey === saved.state.cafeKey, message: `두 번째 Ctrl+F5 후 확정 메타데이터 소실: ${JSON.stringify(secondReload)}` },
    { ok: firstReload.projectId === projectId && firstReload.productName === productName, message: `리로드 후 작업파일 식별자 변경: ${JSON.stringify(firstReload)}` },
  ];
  const result = { ok: checks.every(item => item.ok), saved, firstReload, secondReload, screenshot: SCREENSHOT_PATH, checks };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
  try { cdp.close(); } catch (_) {}
  await runtime.cleanup();
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

async function reloadAndRead(cdp, projectId, productName) {
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, '!!(window.state && window.factoryState && window.render)', 60000);
  await new Promise(resolve => setTimeout(resolve, 1400));
  return evaluate(cdp, `(() => {
    const factory = window.factoryState();
    return {
      projectId: window.state.currentProjectId || '',
      productName: window.state.productName || '',
      scope: window.getCurrentLastWorkWorkspaceScope?.() || '',
      expectedProjectId: ${JSON.stringify(projectId)},
      expectedProductName: ${JSON.stringify(productName)},
      state: {
        dbKey: factory.product.selectedDbCandidateKey || '',
        cafeKey: factory.product.selectedCafe24CandidateKey || '',
        dbResolution: factory.product.dbCandidateResolution || '',
        cafeResolution: factory.product.cafe24CandidateResolution || '',
        hasConfirmedDb: !!factory.product.confirmedDb,
        confirmedCafeKey: factory.product.confirmedCafe24ProductKey || '',
      },
      persisted: ${readPersistedExpression()},
      domConfirmedCount: document.body.innerText.includes('확정됨') ? (document.body.innerText.match(/확정됨/g) || []).length : 0,
    };
  })()`);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
