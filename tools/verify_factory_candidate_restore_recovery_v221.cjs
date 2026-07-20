const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9783';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_BASE || process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-restore-recovery-v221.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-restore-recovery-v221.png');

async function capture(cdp) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
}

function exact(left, right, keys) {
  return keys.every(key => left?.[key] === right?.[key]);
}

function buildRestoreRecoveryChecks(proof) {
  const backendKeys = ['status', 'hasSnapshot', 'workspaceId', 'revision', 'bodyLength', 'sha256'];
  return [
    { ok: proof.normalizedDraftScope === proof.expected.draftScope, message: `normalizeFactoryState가 저장본 draft scope를 보존하지 않았습니다: ${proof.normalizedDraftScope}` },
    { ok: proof.appWorkspaceId === proof.expected.projectId && proof.factoryWorkspaceId === proof.expected.projectId && proof.currentScope === proof.expected.currentScope, message: `app/factory scope 복구 불일치: ${JSON.stringify(proof)}` },
    { ok: proof.after.token?.version === 'factory-store:v1' && proof.after.token.workspaceId === proof.expected.projectId && Number(proof.after.token.revision) === 0 && Number(proof.after.token.fence) === Number(proof.before.token.fence) + 1, message: `factory store token scope/fence/revision 불일치: ${JSON.stringify({ before: proof.before.token, after: proof.after.token })}` },
    { ok: proof.db[0]?.scope === proof.expected.currentScope && proof.cafe24[0]?.scope === proof.expected.currentScope && proof.db[0]?.identity === proof.expected.currentIdentity && proof.cafe24[0]?.identity === proof.expected.currentIdentity, message: `draft DB/Cafe24 scope 또는 identity가 project로 복구되지 않았습니다: ${JSON.stringify({ db: proof.db[0], cafe24: proof.cafe24[0] })}` },
    { ok: proof.db[0]?.canApply === true && proof.cafe24[0]?.canApply === true && proof.buttons.dbDraft?.exists === true && proof.buttons.dbDraft.disabled === false && proof.buttons.cafeDraft?.exists === true && proof.buttons.cafeDraft.disabled === false, message: `복구 후보 버튼이 없거나 비활성입니다: ${JSON.stringify(proof.buttons)}` },
    { ok: proof.db[1]?.scope === proof.expected.foreignScope && proof.cafe24[1]?.scope === proof.expected.foreignScope && proof.db[1]?.identity === proof.expected.foreignIdentity && proof.cafe24[1]?.identity === proof.expected.foreignIdentity, message: `foreign 후보 scope/identity가 변했습니다: ${JSON.stringify({ db: proof.db[1], cafe24: proof.cafe24[1] })}` },
    { ok: proof.db[1]?.canApply === false && proof.cafe24[1]?.canApply === false && proof.buttons.dbForeign?.exists === true && proof.buttons.dbForeign.disabled === true && proof.buttons.cafeForeign?.exists === true && proof.buttons.cafeForeign.disabled === true, message: `foreign 후보가 선택 가능하거나 버튼이 활성입니다: ${JSON.stringify(proof.buttons)}` },
    { ok: proof.before.recovery.rawLength > 0 && proof.before.recovery.revisionsLength > 0 && proof.before.recovery.rawSha256 === proof.sentinel.recoverySha256 && proof.before.recovery.revisionsSha256 === proof.sentinel.revisionsSha256 && exact(proof.before.recovery, proof.after.recovery, ['rawLength', 'rawSha256', 'revisionsLength', 'revisionsSha256']), message: `non-empty sentinel 또는 skipPersistence 복구 namespace 불변성이 깨졌습니다: ${JSON.stringify({ sentinel: proof.sentinel, before: proof.before.recovery, after: proof.after.recovery })}` },
    { ok: proof.cleanup.recoveryRestored === true && proof.cleanup.revisionsRestored === true, message: `recovery sentinel cleanup이 원래 상태를 복원하지 못했습니다: ${JSON.stringify(proof.cleanup)}` },
    { ok: exact(proof.before.scopedBackend, proof.after.scopedBackend, backendKeys), message: `project backend last-work가 변했습니다: ${JSON.stringify({ before: proof.before.scopedBackend, after: proof.after.scopedBackend })}` },
    { ok: exact(proof.before.globalBackend, proof.after.globalBackend, backendKeys), message: `global backend last-work가 변했습니다: ${JSON.stringify({ before: proof.before.globalBackend, after: proof.after.globalBackend })}` },
  ];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let runtime = null;
  let cdp = null;
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
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateRestoreRecovery=v221` });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof normalizeFactoryState === 'function'
      && typeof applyWorkspacePayload === 'function'
      && typeof factoryCandidateReviewScopeKey === 'function'
      && typeof factoryCandidateReviewCanApply === 'function'
      && typeof workspacePersistenceApi === 'function'`, 60000);

    const proof = await evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory, readOperationToken }) => {
      const projectId = 'project_restore_recovery_target_v221';
      const draftWorkspaceId = 'draft:lastwork_restore_recovery_v221';
      const foreignWorkspaceId = 'project_restore_recovery_foreign_v221';
      const productName = '기존 저장본 후보 복구 검증 수저집';
      const productKey = factoryNormalizeIdentityText(productName);
      const runId = 'restore-recovery-run-v221';
      const fingerprint = 'restore-recovery-image-v221';
      const scopeKey = workspaceId => [workspaceId, productKey, 'candidate-review'].join('::');
      const identityKey = workspaceId => [workspaceId, runId, productKey, fingerprint, 'candidate-review'].join('::');
      const candidate = (kind, workspaceId) => kind === 'db'
        ? { jcode: 'DB-' + workspaceId, jname: workspaceId, product_name: workspaceId, match_query: productName, reviewProductName: productName, reviewProductScopeKey: scopeKey(workspaceId), reviewProductIdentityKey: identityKey(workspaceId) }
        : { product_no: 'C24-' + workspaceId, product_code: 'C24-' + workspaceId, product_name: workspaceId, match_query: productName, reviewProductName: productName, reviewProductScopeKey: scopeKey(workspaceId), reviewProductIdentityKey: identityKey(workspaceId) };
      const dbDraft = candidate('db', draftWorkspaceId);
      const dbForeign = candidate('db', foreignWorkspaceId);
      const cafeDraft = candidate('cafe24', draftWorkspaceId);
      const cafeForeign = candidate('cafe24', foreignWorkspaceId);
      const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')))), byte => byte.toString(16).padStart(2, '0')).join('');
      const readRecovery = async () => {
        const raw = (() => { try { return workspacePersistenceApi().readRecoveryValue('pdp_session') || ''; } catch (_) { return ''; } })();
        const revisions = localStorage.getItem('kuasangse_workspace_revisions_v1') || '';
        return { rawLength: raw.length, rawSha256: await digest(raw), revisionsLength: revisions.length, revisionsSha256: await digest(revisions) };
      };
      const readBackend = async workspaceId => {
        const suffix = workspaceId ? '?workspaceId=' + encodeURIComponent(workspaceId) : '';
        const response = await fetch(${JSON.stringify(BACKEND_BASE)} + '/api/last-work' + suffix, { cache: 'no-store' });
        const raw = await response.text();
        const payload = (() => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } })();
        return { status: response.status, hasSnapshot: payload.hasSnapshot === true, workspaceId: payload.workspaceId || '', revision: Number(payload.revision || 0), bodyLength: raw.length, sha256: await digest(raw) };
      };
      const persistence = workspacePersistenceApi();
      const recoveryKey = 'pdp_session';
      const revisionsKey = 'kuasangse_workspace_revisions_v1';
      const originalRecovery = persistence.readRecoveryValue(recoveryKey);
      const originalRevisions = localStorage.getItem(revisionsKey);
      const sentinelRecovery = JSON.stringify({ db04Sentinel: 'recovery-' + Date.now(), projectId });
      const sentinelRevisions = JSON.stringify({ ['db04:' + projectId]: { counter: 41, writerId: 'db04-sentinel' } });
      await persistence.writeRecoveryValue(recoveryKey, sentinelRecovery);
      localStorage.setItem(revisionsKey, sentinelRevisions);
      let scenario;
      try {
        const before = {
          token: readOperationToken(), recovery: await readRecovery(),
          scopedBackend: await readBackend('project:' + projectId), globalBackend: await readBackend(''),
        };
        const normalized = normalizeFactoryState({
        workspace: { id: draftWorkspaceId, name: productName, createdAt: 1735689600000 },
        currentProjectId: draftWorkspaceId,
        currentProjectName: productName,
        product: {
          productName, userProductName: productName, productKey, productIdentityKey: productKey,
          currentRunId: runId, generationRunId: runId, inputImageFingerprint: fingerprint,
          lockedInputImageFingerprint: fingerprint,
          pendingDbCandidates: [dbDraft, dbForeign], dbCandidates: [dbDraft, dbForeign],
          pendingCafe24Candidates: [cafeDraft, cafeForeign], cafe24Candidates: [cafeDraft, cafeForeign],
        },
        automation: { activeTab: 'db' },
      });
        const normalizedDraftScope = normalized.product.pendingDbCandidates[0].reviewProductScopeKey;
        applyWorkspacePayload({ name: productName, productName, step: 'factory', factory: normalized }, {
          projectId, createdAt: 1735689600000, skipPersistence: true, skipSideEffects: true, replaceWorkspace: true,
        });
        render();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const factory = readFactory();
        const app = readAppState();
        const db = factory.product?.pendingDbCandidates || [];
        const cafe24 = factory.product?.pendingCafe24Candidates || [];
        const button = selector => {
          const node = document.querySelector(selector);
          return { exists: !!node, disabled: node ? node.disabled : null };
        };
        const after = {
          token: readOperationToken(), recovery: await readRecovery(),
          scopedBackend: await readBackend('project:' + projectId), globalBackend: await readBackend(''),
        };
        scenario = {
          expected: { projectId, draftWorkspaceId, foreignWorkspaceId, draftScope: scopeKey(draftWorkspaceId), currentScope: scopeKey(projectId), foreignScope: scopeKey(foreignWorkspaceId), currentIdentity: identityKey(projectId), foreignIdentity: identityKey(foreignWorkspaceId) },
          sentinel: { recoverySha256: await digest(sentinelRecovery), revisionsSha256: await digest(sentinelRevisions) },
          normalizedDraftScope,
          appWorkspaceId: app.currentProjectId || '',
          factoryWorkspaceId: factory.workspace?.id || factory.currentProjectId || '',
          currentScope: factoryCandidateReviewScopeKey(factory),
          db: db.map(item => ({ scope: item.reviewProductScopeKey || '', identity: item.reviewProductIdentityKey || '', canApply: factoryCandidateReviewCanApply(item, factory) })),
          cafe24: cafe24.map(item => ({ scope: item.reviewProductScopeKey || '', identity: item.reviewProductIdentityKey || '', canApply: factoryCandidateReviewCanApply(item, factory) })),
          buttons: { dbDraft: button('[data-factory-apply-db-candidate="0"]'), dbForeign: button('[data-factory-apply-db-candidate="1"]'), cafeDraft: button('[data-factory-apply-cafe24-candidate="0"]'), cafeForeign: button('[data-factory-apply-cafe24-candidate="1"]') },
          before, after,
        };
      } finally {
        if (originalRecovery) await persistence.writeRecoveryValue(recoveryKey, originalRecovery);
        else await persistence.clearRecoveryValue(recoveryKey);
        if (originalRevisions === null) localStorage.removeItem(revisionsKey);
        else localStorage.setItem(revisionsKey, originalRevisions);
      }
      scenario.cleanup = {
        recoveryRestored: persistence.readRecoveryValue(recoveryKey) === originalRecovery,
        revisionsRestored: localStorage.getItem(revisionsKey) === originalRevisions,
      };
      return scenario;
    }`);
    await evaluate(cdp, `document.querySelector('[data-factory-apply-db-candidate="0"]')?.scrollIntoView({ block: 'center' })`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture(cdp);

    const checks = buildRestoreRecoveryChecks(proof);
    result = { ok: checks.every(check => check.ok), proof, checks, screenshotPath: SCREENSHOT_PATH };
    assertChecks(checks);
  } catch (error) {
    failure = error;
    result = result || { ok: false, error: error?.stack || String(error) };
  } finally {
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    try { cdp?.close(); } catch (_) {}
    try { await runtime?.cleanup?.(); } catch (_) {}
  }
  if (failure) throw failure;
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { buildRestoreRecoveryChecks };

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
