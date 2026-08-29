const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');
const {
  buildStartupChecks, buildStartupSeed, readBackendFingerprint,
  startupSeedScript, storageFingerprint,
} = require('./factory_startup_restore_harness_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const STORAGE_PROBE_URL = new URL('/src/runtime-manifest.json', APP_URL).href;
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9784';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_BASE || process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-startup-restore-v223.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-startup-restore-v223.png');

async function capture(cdp) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seed = buildStartupSeed(Date.now());
  let runtime = null;
  let cdp = null;
  let seedScriptId = null;
  let originalStorage = null;
  let proof = null;
  const cleanup = { seedScriptRemoved: false, storageRestored: false, cdpClosed: false, runtimeCleaned: false, errors: [] };
  let failure = null;
  const backend = {};
  const cleanupError = (stage, error) => {
    cleanup.errors.push({ stage, error: error?.stack || String(error) });
    failure = failure || error;
  };
  try {
    backend.beforeTarget = await readBackendFingerprint(BACKEND_BASE, seed.projectScope);
    backend.beforeGlobal = await readBackendFingerprint(BACKEND_BASE);
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
    await cdp.send('Page.navigate', { url: STORAGE_PROBE_URL });
    await waitFor(cdp, `document.readyState === 'complete'`, 15000);
    originalStorage = await evaluate(cdp, `({
      local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean).map(key => [key, localStorage.getItem(key)])),
      session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(Boolean).map(key => [key, sessionStorage.getItem(key)])),
    })`);
    const installed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: startupSeedScript(seed, { appOrigin: new URL(APP_URL).origin, backendOrigin: new URL(BACKEND_BASE).origin }),
    });
    seedScriptId = installed.identifier;
    const verifyUrl = new URL(APP_URL);
    verifyUrl.searchParams.set('candidateStartupRestore', `verify-v223-${seed.projectId}`);
    await cdp.send('Page.navigate', { url: verifyUrl.href });
    try {
      await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
        && state.currentProjectId === ${JSON.stringify(seed.projectId)}
        && typeof factoryCandidateReviewScopeKey === 'function'
        && typeof factoryCandidateReviewCanApply === 'function'
        && typeof getCurrentLastWorkWorkspaceScope === 'function'
        && typeof workspacePersistenceApi === 'function'`, 60000);
    } catch (error) {
      const diagnostic = await evaluate(cdp, `({
        readyState: document.readyState,
        stateProjectId: typeof state === 'object' ? state.currentProjectId || '' : '',
        stateProductName: typeof state === 'object' ? state.productName || '' : '',
        stateStep: typeof state === 'object' ? state.step || '' : '',
        factoryProjectId: typeof state === 'object' ? state.factory?.workspace?.id || '' : '',
        draftScope: sessionStorage.getItem('pdp_last_work_draft_scope_v1') || '',
        hasSession: !!sessionStorage.getItem('pdp_session'),
        hasBootstrap: !!sessionStorage.getItem('pdp_last_work_bootstrap_v1'),
        storageWarning: typeof state === 'object' ? state.storageWarning || '' : '',
        loadErrors: globalThis.__KUASANGSE_LOAD_ERRORS__ || [],
        startupConsole: globalThis.__DB05_NETWORK_PROBE__?.console || [],
        sessionProbe: (() => {
          try {
            const parsed = JSON.parse(sessionStorage.getItem('pdp_session') || '{}');
            const validation = workspacePersistenceApi().validateSnapshotIdentity(parsed);
            const bound = bindWorkspaceSnapshotToCurrentBranch(structuredClone(parsed));
            let loaded = null;
            let loadError = '';
            try { loaded = loadPersistentSession(); } catch (innerError) { loadError = String(innerError?.stack || innerError); }
            return {
              validation,
              boundProjectId: bound?.currentProjectId || '',
              boundScope: bound?.workspaceScope?.id || '',
              loadedProjectId: loaded?.currentProjectId || '',
              loadedScope: loaded?.workspaceScope?.id || '',
              loadError,
            };
          } catch (probeError) {
            return { probeError: String(probeError?.stack || probeError) };
          }
        })(),
        bodyText: String(document.body?.innerText || '').slice(0, 1200),
      })`);
      throw new Error(`${error.message}\nstartupDiagnostic=${JSON.stringify(diagnostic)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
    proof = await evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory, readOperationToken }) => {
      const app = readAppState();
      const factory = readFactory();
      const persistenceScope = getCurrentLastWorkWorkspaceScope();
      const view = candidate => ({
        scope: candidate?.reviewProductScopeKey || '',
        identity: candidate?.reviewProductIdentityKey || '',
        canApply: factoryCandidateReviewCanApply(candidate, factory),
      });
      const button = selector => {
        const node = document.querySelector(selector);
        return { exists: !!node, disabled: node ? node.disabled : null };
      };
      let token = readOperationToken();
      let authority = globalThis.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null;
      let mutationCount = globalThis.__DB05_NETWORK_PROBE__?.mutations?.length || 0;
      let stableSince = Date.now();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && Date.now() - stableSince < 1000) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const nextToken = readOperationToken();
        const nextAuthority = globalThis.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null;
        const nextMutationCount = globalThis.__DB05_NETWORK_PROBE__?.mutations?.length || 0;
        if (JSON.stringify(nextToken) !== JSON.stringify(token)
          || JSON.stringify(nextAuthority) !== JSON.stringify(authority)
          || nextMutationCount !== mutationCount) {
          token = nextToken;
          authority = nextAuthority;
          mutationCount = nextMutationCount;
          stableSince = Date.now();
        }
      }
      const settledToken = readOperationToken();
      const settledAuthority = globalThis.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null;
      return {
        appWorkspaceId: app.currentProjectId || '',
        factoryWorkspaceId: factory.workspace?.id || factory.currentProjectId || '',
        persistenceScope,
        branch: currentWorkspaceBranch(persistenceScope, app.currentProjectId),
        currentScope: factoryCandidateReviewScopeKey(factory),
        token, settledToken, authority, settledAuthority,
        db: (factory.product?.pendingDbCandidates || []).map(view),
        cafe24: (factory.product?.pendingCafe24Candidates || []).map(view),
        buttons: {
          dbDraft: button('[data-factory-apply-db-candidate="0"]'),
          dbForeign: button('[data-factory-apply-db-candidate="1"]'),
          cafeDraft: button('[data-factory-apply-cafe24-candidate="0"]'),
          cafeForeign: button('[data-factory-apply-cafe24-candidate="1"]'),
        },
        networkProbe: globalThis.__DB05_NETWORK_PROBE__ || null,
        loadErrors: globalThis.__KUASANGSE_LOAD_ERRORS__ || [],
      };
    }`);
    await evaluate(cdp, `document.querySelector('[data-factory-apply-db-candidate="0"]')?.scrollIntoView({ block: 'center' })`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture(cdp);
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (seedScriptId) await cdp?.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScriptId });
      cleanup.seedScriptRemoved = true;
    } catch (error) {
      cleanupError('seed-script-remove', error);
    } finally {
      try {
        if (cdp && originalStorage !== null) {
          await cdp.send('Page.navigate', { url: STORAGE_PROBE_URL });
          await waitFor(cdp, `document.readyState === 'complete'`, 15000);
          await evaluate(cdp, `(() => {
            const original = ${JSON.stringify(originalStorage)};
            localStorage.clear();
            sessionStorage.clear();
            for (const [key, value] of Object.entries(original.local || {})) localStorage.setItem(key, value);
            for (const [key, value] of Object.entries(original.session || {})) sessionStorage.setItem(key, value);
          })()`);
          const restored = await evaluate(cdp, `({
            local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean).map(key => [key, localStorage.getItem(key)])),
            session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(Boolean).map(key => [key, sessionStorage.getItem(key)])),
          })`);
          cleanup.beforeStorage = storageFingerprint(originalStorage);
          cleanup.afterStorage = storageFingerprint(restored);
          cleanup.storageRestored = JSON.stringify(originalStorage) === JSON.stringify(restored);
        }
      } catch (error) {
        cleanupError('storage-restore', error);
      } finally {
        try {
          backend.afterTarget = await readBackendFingerprint(BACKEND_BASE, seed.projectScope);
        } catch (error) {
          cleanupError('backend-target-read', error);
        } finally {
          try {
            backend.afterGlobal = await readBackendFingerprint(BACKEND_BASE);
          } catch (error) {
            cleanupError('backend-global-read', error);
          } finally {
            try {
              cdp?.close();
              cleanup.cdpClosed = true;
            } catch (error) {
              cleanupError('cdp-close', error);
              // 공통 보존 검사: 사람이 손으로 넣은 값이 조용히 사라지지 않았는가.
    // (2026-08-29 — 회귀가 145/145 초록불인데도 사용자 값이 날아간 뒤 세운 그물)
    await assertNoSilentFieldLoss(cdp, { allowAutoLoss: true });
  } finally {
              try {
                await runtime?.cleanup?.();
                cleanup.runtimeCleaned = true;
              } catch (error) {
                cleanupError('runtime-cleanup', error);
              }
            }
          }
        }
      }
    }
  }

  const expected = {
    projectId: seed.projectId, projectScope: seed.projectScope, draftWorkspaceId: seed.draftWorkspaceId,
    currentScope: seed.currentScope, currentIdentity: seed.currentIdentity,
    foreignScope: seed.foreignScope, foreignIdentity: seed.foreignIdentity,
    appOrigin: new URL(APP_URL).origin, backendOrigin: new URL(BACKEND_BASE).origin,
  };
  const completeProof = { ...(proof || {}), expected, cleanup, backend };
  const checkRecord = proof ? buildStartupChecks(completeProof) : {};
  const checks = Object.values(checkRecord);
  const result = { ok: !failure && checks.every(check => check.ok), proof: completeProof, checks, screenshotPath: SCREENSHOT_PATH };
  if (failure) result.error = failure?.stack || String(failure);
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  if (failure) throw failure;
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { main };

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
