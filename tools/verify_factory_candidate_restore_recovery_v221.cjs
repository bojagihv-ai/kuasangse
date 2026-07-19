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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9783';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-restore-recovery-v221.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-restore-recovery-v221.png');

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
  let proof;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateRestoreRecovery=v221` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryCandidateReviewCanApply && window.applyWorkspacePayload && window.render)', 60000);
    proof = await evaluate(cdp, `(() => {
      const projectId = 'project_restore_recovery_target_v221';
      const productName = '기존 저장본 후보 복구 검증 수저집';
      const runId = 'restore-recovery-run-v221';
      const inputImageFingerprint = 'restore-recovery-image-v221';
      const productKey = window.factoryNormalizeIdentityText(productName);
      const draftWorkspaceId = 'draft:lastwork_restore_recovery_v221';
      const foreignWorkspaceId = 'project_restore_recovery_foreign_v221';
      const draftScopeKey = [draftWorkspaceId, productKey, 'candidate-review'].join('::');
      const foreignScopeKey = [foreignWorkspaceId, productKey, 'candidate-review'].join('::');
      const reviewIdentity = (workspaceId) => [workspaceId, runId, productKey, inputImageFingerprint, 'candidate-review'].join('::');
      const dbDraft = {
        jcode: 'DB-DRAFT-V221',
        jname: '기존 저장본 신화사DB 후보',
        product_name: '기존 저장본 신화사DB 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: draftScopeKey,
        reviewProductIdentityKey: reviewIdentity(draftWorkspaceId),
      };
      const dbForeign = {
        jcode: 'DB-FOREIGN-V221',
        jname: '다른 작업 신화사DB 후보',
        product_name: '다른 작업 신화사DB 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: foreignScopeKey,
        reviewProductIdentityKey: reviewIdentity(foreignWorkspaceId),
      };
      const cafeDraft = {
        product_no: 'C24-DRAFT-V221',
        product_code: 'C24-DRAFT-V221',
        product_name: '기존 저장본 Cafe24 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: draftScopeKey,
        reviewProductIdentityKey: reviewIdentity(draftWorkspaceId),
      };
      const cafeForeign = {
        product_no: 'C24-FOREIGN-V221',
        product_code: 'C24-FOREIGN-V221',
        product_name: '다른 작업 Cafe24 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: foreignScopeKey,
        reviewProductIdentityKey: reviewIdentity(foreignWorkspaceId),
      };
      const payload = {
        name: productName,
        productName,
        step: 'factory',
        factory: window.normalizeFactoryState({
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
        }),
      };
      window.applyWorkspacePayload(payload, {
        projectId,
        createdAt: 1735689600000,
        skipPersistence: true,
        skipSideEffects: true,
        replaceWorkspace: true,
      });
      window.render();
      const factory = window.factoryState();
      const dbCandidates = factory.product.pendingDbCandidates || [];
      const cafeCandidates = factory.product.pendingCafe24Candidates || [];
      const button = (selector) => {
        const element = document.querySelector(selector);
        return element ? { text: element.textContent.trim(), disabled: element.disabled, title: element.title } : null;
      };
      return {
        currentScopeKey: window.factoryCandidateReviewScopeKey(factory),
        db: dbCandidates.map(candidate => ({
          scope: candidate.reviewProductScopeKey || '',
          identity: candidate.reviewProductIdentityKey || '',
          selectable: window.factoryCandidateReviewCanApply(candidate, factory),
        })),
        cafe24: cafeCandidates.map(candidate => ({
          scope: candidate.reviewProductScopeKey || '',
          identity: candidate.reviewProductIdentityKey || '',
          selectable: window.factoryCandidateReviewCanApply(candidate, factory),
        })),
        buttons: {
          dbDraft: button('[data-factory-apply-db-candidate="0"]'),
          dbForeign: button('[data-factory-apply-db-candidate="1"]'),
          cafeDraft: button('[data-factory-apply-cafe24-candidate="0"]'),
          cafeForeign: button('[data-factory-apply-cafe24-candidate="1"]'),
        },
      };
    })()`);
    await evaluate(cdp, `document.querySelector('[data-factory-apply-db-candidate="0"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture(cdp, SCREENSHOT_PATH);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup?.();
  }

  const checks = [
    { ok: proof.currentScopeKey.includes('project_restore_recovery_target_v221'), message: `현재 저장본 scope가 예상과 다릅니다: ${proof.currentScopeKey}` },
    { ok: proof.db[0]?.scope === proof.currentScopeKey, message: `기존 저장본 DB 후보 scope가 현재 작업으로 복구되지 않았습니다: ${JSON.stringify(proof.db[0])}` },
    { ok: proof.cafe24[0]?.scope === proof.currentScopeKey, message: `기존 저장본 Cafe24 후보 scope가 현재 작업으로 복구되지 않았습니다: ${JSON.stringify(proof.cafe24[0])}` },
    { ok: proof.db[0]?.selectable === true && proof.buttons.dbDraft?.disabled === false, message: `기존 저장본 DB 후보 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof.db[0], button: proof.buttons.dbDraft })}` },
    { ok: proof.cafe24[0]?.selectable === true && proof.buttons.cafeDraft?.disabled === false, message: `기존 저장본 Cafe24 후보 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof.cafe24[0], button: proof.buttons.cafeDraft })}` },
    { ok: proof.db[1]?.scope.includes('project_restore_recovery_foreign_v221') && proof.db[1]?.selectable === false && proof.buttons.dbForeign?.disabled === true, message: `다른 작업 DB 후보가 잘못 복구됐습니다: ${JSON.stringify({ candidate: proof.db[1], button: proof.buttons.dbForeign })}` },
    { ok: proof.cafe24[1]?.scope.includes('project_restore_recovery_foreign_v221') && proof.cafe24[1]?.selectable === false && proof.buttons.cafeForeign?.disabled === true, message: `다른 작업 Cafe24 후보가 잘못 복구됐습니다: ${JSON.stringify({ candidate: proof.cafe24[1], button: proof.buttons.cafeForeign })}` },
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  const result = { ok: failures.length === 0, proof, checks, failures, screenshotPath: SCREENSHOT_PATH };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
