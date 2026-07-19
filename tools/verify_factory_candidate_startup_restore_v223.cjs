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
const STORAGE_PROBE_URL = new URL('/src/runtime-manifest.json', APP_URL).href;
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9784';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-startup-restore-v223.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-startup-restore-v223.png');
const STORAGE_KEYS = [
  'pdp_session',
  'pdp_last_work_bootstrap_v1',
  'factory_last_snapshot_v1',
];

async function capture(cdp, targetPath) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(targetPath, Buffer.from(screenshot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let originalStorage = null;
  let proof = null;
  let seededStorage = null;
  let seedScriptId = null;
  let projectId = '';
  let productKey = '';
  let foreignWorkspaceId = '';
  let navigationResult = null;
  let startupFailureDiagnostic = null;

  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: STORAGE_PROBE_URL });
    await waitFor(cdp, `document.readyState === 'complete'`, 15000);
    originalStorage = await evaluate(cdp, `(() => {
      const keys = ${JSON.stringify(STORAGE_KEYS)};
      return Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
    })()`);

    const seed = String(Date.now());
    projectId = `project_startup_restore_target_v223_${seed}`;
    const productName = `시작복원 후보검증 수저집 ${seed}`;
    productKey = productName.replace(/\s+/g, '').toLowerCase();
    const draftWorkspaceId = `draft:lastwork_startup_restore_v223_${seed}`;
    foreignWorkspaceId = `project_startup_restore_foreign_v223_${seed}`;
    const runId = `startup-restore-run-v223-${seed}`;
    const inputImageFingerprint = `startup-restore-image-v223-${seed}`;
    const scope = workspaceId => `${workspaceId}::${productKey}::candidate-review`;
    const identity = workspaceId => `${workspaceId}::${runId}::${productKey}::${inputImageFingerprint}::candidate-review`;
    const dbDraft = {
      jcode: 'DB-STARTUP-DRAFT-V223',
      jname: '시작 복원 신화사DB 후보',
      product_name: '시작 복원 신화사DB 후보',
      match_query: productName,
      reviewProductName: productName,
      reviewProductScopeKey: scope(draftWorkspaceId),
      reviewProductIdentityKey: identity(draftWorkspaceId),
    };
    const dbForeign = {
      jcode: 'DB-STARTUP-FOREIGN-V223',
      jname: '다른 작업 신화사DB 후보',
      product_name: '다른 작업 신화사DB 후보',
      match_query: productName,
      reviewProductName: productName,
      reviewProductScopeKey: scope(foreignWorkspaceId),
      reviewProductIdentityKey: identity(foreignWorkspaceId),
    };
    const cafeDraft = {
      product_no: 'C24-STARTUP-DRAFT-V223',
      product_code: 'C24-STARTUP-DRAFT-V223',
      product_name: '시작 복원 Cafe24 후보',
      match_query: productName,
      reviewProductName: productName,
      reviewProductScopeKey: scope(draftWorkspaceId),
      reviewProductIdentityKey: identity(draftWorkspaceId),
    };
    const cafeForeign = {
      product_no: 'C24-STARTUP-FOREIGN-V223',
      product_code: 'C24-STARTUP-FOREIGN-V223',
      product_name: '다른 작업 Cafe24 후보',
      match_query: productName,
      reviewProductName: productName,
      reviewProductScopeKey: scope(foreignWorkspaceId),
      reviewProductIdentityKey: identity(foreignWorkspaceId),
    };
    const session = {
      step: 'factory',
      currentProjectId: projectId,
      currentProjectName: productName,
      currentProjectCreatedAt: 1735689600000,
      workspaceScope: { id: `project:${projectId}` },
      productName,
      analysisImages: [],
      factory: {
        workspace: { id: projectId, name: productName, createdAt: 1735689600000 },
        currentProjectId: projectId,
        currentProjectName: productName,
        product: {
          productName,
          userProductName: productName,
          productKey,
          productIdentityKey: productKey,
          currentRunId: runId,
          generationRunId: runId,
          inputImageFingerprint,
          lockedInputImageFingerprint: inputImageFingerprint,
          pendingDbCandidates: [dbDraft, dbForeign],
          dbCandidates: [],
          pendingCafe24Candidates: [cafeDraft, cafeForeign],
          cafe24Candidates: [],
        },
        automation: { activeTab: 'db' },
        assets: [],
        stages: {},
      },
    };
    const bootstrap = {
      workspaceScope: { id: `project:${projectId}` },
      currentProjectId: projectId,
      currentProjectName: productName,
      currentProjectCreatedAt: 1735689600000,
      step: 'factory',
      savedAt: Date.now(),
    };
    const seedScript = `(() => {
      localStorage.setItem('pdp_session', ${JSON.stringify(JSON.stringify(session))});
      localStorage.setItem('pdp_last_work_bootstrap_v1', ${JSON.stringify(JSON.stringify(bootstrap))});
      localStorage.removeItem('factory_last_snapshot_v1');
    })()`;
    const seedScriptResult = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript });
    seedScriptId = seedScriptResult.identifier;
    seededStorage = {
      projectId,
      workspaceScope: bootstrap.workspaceScope.id,
      dbCandidateCount: session.factory.product.pendingDbCandidates.length,
      cafe24CandidateCount: session.factory.product.pendingCafe24Candidates.length,
    };
    const verifyUrl = new URL(APP_URL);
    verifyUrl.searchParams.set('candidateStartupRestore', `verify-v223-${seed}`);
    navigationResult = await cdp.send('Page.navigate', { url: verifyUrl.href });
    try {
      await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.factoryCandidateReviewCanApply)', 60000);
    } catch (error) {
      startupFailureDiagnostic = await evaluate(cdp, `(() => ({
        expectedProjectId: ${JSON.stringify(projectId)},
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        loader: window.__KUASANGSE_APP_LOADER__ || null,
        loadErrors: window.__KUASANGSE_LOAD_ERRORS__ || [],
        globals: {
          state: !!window.__kuasangseState,
          factoryState: typeof window.factoryState,
          candidateReview: typeof window.factoryCandidateReviewCanApply,
          render: typeof window.render,
        },
        appText: String(document.getElementById('app')?.innerText || '').slice(0, 2000),
        htmlLength: document.documentElement?.outerHTML?.length || 0,
        resources: performance.getEntriesByType('resource').map(entry => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
        })).slice(-80),
      }))()`).catch(diagnosticError => ({
        diagnosticError: String(diagnosticError?.stack || diagnosticError),
      }));
      const failureResult = {
        ok: false,
        error: String(error?.stack || error),
        navigationResult,
        seededStorage,
        diagnostic: startupFailureDiagnostic,
      };
      fs.writeFileSync(RESULT_PATH, JSON.stringify(failureResult, null, 2), 'utf8');
      try { await capture(cdp, SCREENSHOT_PATH); } catch (_) {}
      throw new Error(`${error.message}\nstartup diagnostic: ${JSON.stringify(startupFailureDiagnostic)}`);
    }
    const startupDiagnostic = await evaluate(cdp, `(() => ({
      expectedProjectId: ${JSON.stringify(projectId)},
      currentProjectId: window.__kuasangseState.currentProjectId || '',
      currentScope: window.getCurrentLastWorkWorkspaceScope?.() || '',
      storedSessionProjectId: (() => {
        try { return JSON.parse(localStorage.getItem('pdp_session') || '{}').currentProjectId || ''; } catch (_) { return ''; }
      })(),
      recoverySessionProjectId: (() => {
        try { return JSON.parse(window.workspacePersistenceApi().readRecoveryValue('pdp_session') || '{}').currentProjectId || ''; } catch (_) { return ''; }
      })(),
      storedBootstrapProjectId: (() => {
        try { return JSON.parse(localStorage.getItem('pdp_last_work_bootstrap_v1') || '{}').currentProjectId || ''; } catch (_) { return ''; }
      })(),
      authority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
      error: window.__kuasangseState.error || '',
      storageWarning: window.__kuasangseState.storageWarning || '',
      loadErrors: window.__KUASANGSE_LOAD_ERRORS__ || [],
    }))()`);
    if (startupDiagnostic.currentProjectId !== projectId) {
      throw new Error(`cold-start restore mismatch: ${JSON.stringify(startupDiagnostic)}`);
    }
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScriptId });
    seedScriptId = null;
    await evaluate(cdp, 'window.render()');
    proof = await evaluate(cdp, `(() => {
      const state = window.__kuasangseState;
      const factory = window.factoryState();
      const button = selector => {
        const element = document.querySelector(selector);
        return element ? { text: element.textContent.trim(), disabled: element.disabled, title: element.title } : null;
      };
      const view = candidate => ({
        scope: candidate?.reviewProductScopeKey || '',
        identity: candidate?.reviewProductIdentityKey || '',
        selectable: window.factoryCandidateReviewCanApply(candidate, factory),
      });
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        projectId: state.currentProjectId,
        currentScopeKey: window.factoryCandidateReviewScopeKey(factory),
        db: (factory.product?.pendingDbCandidates || []).map(view),
        cafe24: (factory.product?.pendingCafe24Candidates || []).map(view),
        buttons: {
          dbDraft: button('[data-factory-apply-db-candidate="0"]'),
          dbForeign: button('[data-factory-apply-db-candidate="1"]'),
          cafeDraft: button('[data-factory-apply-cafe24-candidate="0"]'),
          cafeForeign: button('[data-factory-apply-cafe24-candidate="1"]'),
        },
        stored: (() => {
          const raw = localStorage.getItem('pdp_session') || '';
          let session = {};
          try { session = JSON.parse(raw); } catch (_) {}
          return {
            rawLength: raw.length,
            projectId: session.currentProjectId || '',
            workspaceScope: session.workspaceScope?.id || session.workspaceScope || '',
            candidateCount: session.factory?.product?.pendingDbCandidates?.length || 0,
          };
        })(),
      };
    })()`);
    await evaluate(cdp, `document.querySelector('[data-factory-apply-db-candidate="0"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture(cdp, SCREENSHOT_PATH);
  } finally {
    if (seedScriptId) {
      try { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScriptId }); } catch (_) {}
    }
    if (originalStorage) {
      try {
        await evaluate(cdp, `(() => {
          const original = ${JSON.stringify(originalStorage)};
          Object.entries(original).forEach(([key, value]) => {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
          });
        })()`);
      } catch (_) {}
    }
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup?.();
  }

  const checks = [
    { ok: proof?.currentScopeKey === `${projectId}::${productKey}::candidate-review`, message: `시작 복원 현재 범위가 예상과 다릅니다: ${JSON.stringify(proof)}` },
    { ok: proof?.db?.[0]?.scope === proof.currentScopeKey, message: `시작 복원 DB draft 후보 범위가 현재 작업으로 복구되지 않았습니다: ${JSON.stringify(proof?.db?.[0])}` },
    { ok: proof?.cafe24?.[0]?.scope === proof.currentScopeKey, message: `시작 복원 Cafe24 draft 후보 범위가 현재 작업으로 복구되지 않았습니다: ${JSON.stringify(proof?.cafe24?.[0])}` },
    { ok: proof?.db?.[0]?.selectable === true && proof.buttons?.dbDraft?.disabled === false, message: `시작 복원 DB 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof?.db?.[0], button: proof?.buttons?.dbDraft })}` },
    { ok: proof?.cafe24?.[0]?.selectable === true && proof.buttons?.cafeDraft?.disabled === false, message: `시작 복원 Cafe24 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof?.cafe24?.[0], button: proof?.buttons?.cafeDraft })}` },
    { ok: proof?.db?.[1]?.scope.includes(foreignWorkspaceId) && proof.db?.[1]?.selectable === false && proof.buttons?.dbForeign?.disabled === true, message: `다른 작업 DB 후보가 시작 복원에서 잘못 열렸습니다: ${JSON.stringify({ candidate: proof?.db?.[1], button: proof?.buttons?.dbForeign })}` },
    { ok: proof?.cafe24?.[1]?.scope.includes(foreignWorkspaceId) && proof.cafe24?.[1]?.selectable === false && proof.buttons?.cafeForeign?.disabled === true, message: `다른 작업 Cafe24 후보가 시작 복원에서 잘못 열렸습니다: ${JSON.stringify({ candidate: proof?.cafe24?.[1], button: proof?.buttons?.cafeForeign })}` },
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  const result = { ok: failures.length === 0, proof, seededStorage, checks, failures, screenshotPath: SCREENSHOT_PATH };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
