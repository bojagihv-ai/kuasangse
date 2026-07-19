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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9800';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-asset-restore-v224.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-asset-restore-v224.png');

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
  let proof = null;

  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateAssetRestore=v224` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.applyWorkspacePayload && window.applySessionAssetsPayload && window.factoryCandidateReviewCanApply)', 60000);
    proof = await evaluate(cdp, `(() => {
      const projectId = 'project_asset_restore_target_v224';
      const productName = '자산복원 후보검증 수저집';
      const productKey = window.factoryNormalizeIdentityText(productName);
      const runId = 'asset-restore-run-v224';
      const inputImageFingerprint = 'asset-restore-image-v224';
      const draftWorkspaceId = 'draft:lastwork_asset_restore_v224';
      const foreignWorkspaceId = 'project_asset_restore_foreign_v224';
      const reviewScope = workspaceId => [workspaceId, productKey, 'candidate-review'].join('::');
      const reviewIdentity = workspaceId => [workspaceId, runId, productKey, inputImageFingerprint, 'candidate-review'].join('::');
      const dbDraft = {
        jcode: 'DB-ASSET-DRAFT-V224',
        jname: '자산복원 신화사DB 후보',
        product_name: '자산복원 신화사DB 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: reviewScope(draftWorkspaceId),
        reviewProductIdentityKey: reviewIdentity(draftWorkspaceId),
      };
      const dbForeign = {
        jcode: 'DB-ASSET-FOREIGN-V224',
        jname: '다른 작업 신화사DB 후보',
        product_name: '다른 작업 신화사DB 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: reviewScope(foreignWorkspaceId),
        reviewProductIdentityKey: reviewIdentity(foreignWorkspaceId),
      };
      const cafeDraft = {
        product_no: 'C24-ASSET-DRAFT-V224',
        product_code: 'C24-ASSET-DRAFT-V224',
        product_name: '자산복원 Cafe24 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: reviewScope(draftWorkspaceId),
        reviewProductIdentityKey: reviewIdentity(draftWorkspaceId),
      };
      const cafeForeign = {
        product_no: 'C24-ASSET-FOREIGN-V224',
        product_code: 'C24-ASSET-FOREIGN-V224',
        product_name: '다른 작업 Cafe24 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: reviewScope(foreignWorkspaceId),
        reviewProductIdentityKey: reviewIdentity(foreignWorkspaceId),
      };
      const baseFactory = {
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
          dbCandidates: [],
          pendingDbCandidates: [],
          cafe24Candidates: [],
          pendingCafe24Candidates: [],
        },
        automation: { activeTab: 'db' },
      };
      window.applyWorkspacePayload({
        name: productName,
        productName,
        step: 'factory',
        factory: window.normalizeFactoryState(baseFactory),
      }, {
        projectId,
        createdAt: 1735689600000,
        skipPersistence: true,
        skipSideEffects: true,
        replaceWorkspace: true,
      });
      const serverAssets = {
        workspaceScope: { id: 'project:' + projectId },
        currentProjectId: projectId,
        currentProjectName: productName,
        productName,
        factory: window.normalizeFactoryState({
          ...baseFactory,
          product: {
            ...baseFactory.product,
            pendingDbCandidates: [dbDraft, dbForeign],
            pendingCafe24Candidates: [cafeDraft, cafeForeign],
          },
        }),
      };
      const applied = window.applySessionAssetsPayload(serverAssets, {
        preserveInlineImages: true,
        allowScopedInlineImages: true,
      });
      window.render();
      const factory = window.factoryState();
      const inspect = candidate => ({
        scope: candidate?.reviewProductScopeKey || '',
        identity: candidate?.reviewProductIdentityKey || '',
        selectable: window.factoryCandidateReviewCanApply(candidate, factory),
      });
      const button = selector => {
        const element = document.querySelector(selector);
        return element ? { text: element.textContent.trim(), disabled: element.disabled, title: element.title } : null;
      };
      return {
        applied,
        currentScopeKey: window.factoryCandidateReviewScopeKey(factory),
        db: (factory.product?.pendingDbCandidates || []).map(inspect),
        cafe24: (factory.product?.pendingCafe24Candidates || []).map(inspect),
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
    { ok: proof?.applied === true, message: `서버 자산 복원이 적용되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: proof?.db?.[0]?.scope === proof.currentScopeKey, message: `자산 복원 DB draft 후보 범위가 현재 작업으로 복구되지 않았습니다: ${JSON.stringify(proof?.db?.[0])}` },
    { ok: proof?.cafe24?.[0]?.scope === proof.currentScopeKey, message: `자산 복원 Cafe24 draft 후보 범위가 현재 작업으로 복구되지 않았습니다: ${JSON.stringify(proof?.cafe24?.[0])}` },
    { ok: proof?.db?.[0]?.selectable === true && proof.buttons?.dbDraft?.disabled === false, message: `자산 복원 DB 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof?.db?.[0], button: proof?.buttons?.dbDraft })}` },
    { ok: proof?.cafe24?.[0]?.selectable === true && proof.buttons?.cafeDraft?.disabled === false, message: `자산 복원 Cafe24 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof?.cafe24?.[0], button: proof?.buttons?.cafeDraft })}` },
    { ok: proof?.db?.[1]?.selectable === false && proof.buttons?.dbForeign?.disabled === true, message: `다른 작업 DB 후보가 자산 복원에서 잘못 열렸습니다: ${JSON.stringify({ candidate: proof?.db?.[1], button: proof?.buttons?.dbForeign })}` },
    { ok: proof?.cafe24?.[1]?.selectable === false && proof.buttons?.cafeForeign?.disabled === true, message: `다른 작업 Cafe24 후보가 자산 복원에서 잘못 열렸습니다: ${JSON.stringify({ candidate: proof?.cafe24?.[1], button: proof?.buttons?.cafeForeign })}` },
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
