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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9782';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-workspace-transition-v220.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-workspace-transition-v220.png');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateWorkspaceTransition=v220` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryCandidateReviewCanApply && window.saveCurrentProject && window.render)', 60000);
    proof = await evaluate(cdp, `(async () => {
      const productName = '동일 제품 저장 전환 후보 검증 수저집';
      const runId = 'candidate-workspace-transition-run-v220';
      const inputImageFingerprint = 'candidate-workspace-transition-image-v220';
      window.state.step = 'factory';
      window.state.currentProjectId = '';
      window.state.currentProjectName = productName;
      window.state.currentProjectCreatedAt = null;
      window.state.productName = productName;
      window.state.factory = window.normalizeFactoryState({});
      const factory = window.factoryState();
      factory.workspace = { ...(factory.workspace || {}), id: '', name: productName, createdAt: null };
      factory.currentProjectId = '';
      factory.currentProjectName = productName;
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey: window.factoryNormalizeIdentityText(productName),
        productIdentityKey: window.factoryNormalizeIdentityText(productName),
        currentRunId: runId,
        generationRunId: runId,
        inputImageFingerprint,
        lockedInputImageFingerprint: inputImageFingerprint,
        selectedDbCandidateKey: '',
        selectedCafe24CandidateKey: '',
      };
      factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
      const beforeWorkspaceId = window.factoryCurrentWorkspaceId(factory);
      const beforeScopeKey = window.factoryCandidateReviewScopeKey(factory);
      const beforeIdentityKey = window.factoryCandidateReviewIdentityKey(factory);
      const dbCandidate = {
        jcode: 'DB-V220',
        jname: '동일 제품 신화사DB 후보',
        product_name: '동일 제품 신화사DB 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: beforeScopeKey,
        reviewProductIdentityKey: beforeIdentityKey,
      };
      const cafe24Candidate = {
        product_no: 'C24-V220',
        product_code: 'C24-V220',
        product_name: '동일 제품 Cafe24 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: beforeScopeKey,
        reviewProductIdentityKey: beforeIdentityKey,
      };
      factory.product.pendingDbCandidates = [dbCandidate];
      factory.product.dbCandidates = [];
      factory.product.pendingCafe24Candidates = [cafe24Candidate];
      factory.product.cafe24Candidates = [];
      window.render();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = {
        dbSelectable: window.factoryCandidateReviewCanApply(dbCandidate, factory),
        cafe24Selectable: window.factoryCandidateReviewCanApply(cafe24Candidate, factory),
      };
      await window.saveCurrentProject();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const afterFactory = window.factoryState();
      const afterDbCandidate = afterFactory.product.pendingDbCandidates?.[0] || {};
      const afterCafe24Candidate = afterFactory.product.pendingCafe24Candidates?.[0] || {};
      const afterWorkspaceId = window.factoryCurrentWorkspaceId(afterFactory);
      const afterScopeKey = window.factoryCandidateReviewScopeKey(afterFactory);
      const dbButton = document.querySelector('[data-factory-apply-db-candidate="0"]');
      const cafe24Button = document.querySelector('[data-factory-apply-cafe24-candidate="0"]');
      return {
        beforeWorkspaceId,
        beforeScopeKey,
        beforeIdentityKey,
        before,
        afterWorkspaceId,
        afterScopeKey,
        afterDbCandidate: {
          reviewProductScopeKey: afterDbCandidate.reviewProductScopeKey || '',
          reviewProductIdentityKey: afterDbCandidate.reviewProductIdentityKey || '',
          productName: afterDbCandidate.product_name || afterDbCandidate.jname || '',
          selectable: window.factoryCandidateReviewCanApply(afterDbCandidate, afterFactory),
        },
        afterCafe24Candidate: {
          reviewProductScopeKey: afterCafe24Candidate.reviewProductScopeKey || '',
          reviewProductIdentityKey: afterCafe24Candidate.reviewProductIdentityKey || '',
          productName: afterCafe24Candidate.product_name || '',
          selectable: window.factoryCandidateReviewCanApply(afterCafe24Candidate, afterFactory),
        },
        buttons: {
          db: dbButton ? { text: dbButton.textContent.trim(), disabled: dbButton.disabled, title: dbButton.title } : null,
          cafe24: cafe24Button ? { text: cafe24Button.textContent.trim(), disabled: cafe24Button.disabled, title: cafe24Button.title } : null,
        },
      };
    })()`);
    await evaluate(cdp, `document.querySelector('[data-factory-apply-db-candidate="0"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture(cdp, SCREENSHOT_PATH);
    proof.scopeToggle = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const currentScopeKey = window.factoryCandidateReviewScopeKey(factory);
      const dbCandidate = factory.product.pendingDbCandidates?.[0] || {};
      const cafe24Candidate = factory.product.pendingCafe24Candidates?.[0] || {};
      dbCandidate.reviewProductScopeKey = currentScopeKey;
      cafe24Candidate.reviewProductScopeKey = currentScopeKey;
      window.render();
      const dbButton = document.querySelector('[data-factory-apply-db-candidate="0"]');
      const cafe24Button = document.querySelector('[data-factory-apply-cafe24-candidate="0"]');
      return {
        currentScopeKey,
        dbSelectable: window.factoryCandidateReviewCanApply(dbCandidate, factory),
        cafe24Selectable: window.factoryCandidateReviewCanApply(cafe24Candidate, factory),
        dbDisabled: dbButton?.disabled ?? null,
        cafe24Disabled: cafe24Button?.disabled ?? null,
      };
    })()`);
    proof.fileIdentityTransition = await evaluate(cdp, `(() => {
      const productName = '작업파일 저장 전환 후보 검증 수저집';
      const runId = 'candidate-file-transition-run-v220';
      const inputImageFingerprint = 'candidate-file-transition-image-v220';
      window.state.currentProjectId = '';
      window.state.currentProjectName = productName;
      window.state.currentProjectCreatedAt = null;
      window.state.productName = productName;
      window.rotateLastWorkDraftScope();
      window.state.factory = window.normalizeFactoryState({});
      const factory = window.factoryState();
      factory.workspace = { ...(factory.workspace || {}), id: '', name: productName, createdAt: null };
      factory.currentProjectId = '';
      factory.currentProjectName = productName;
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey: window.factoryNormalizeIdentityText(productName),
        productIdentityKey: window.factoryNormalizeIdentityText(productName),
        currentRunId: runId,
        generationRunId: runId,
        inputImageFingerprint,
        lockedInputImageFingerprint: inputImageFingerprint,
      };
      const beforeWorkspaceId = window.factoryCurrentWorkspaceId(factory);
      const beforeScopeKey = window.factoryCandidateReviewScopeKey(factory);
      const candidate = {
        jcode: 'FILE-DB-V220',
        jname: '작업파일 저장 전환 신화사DB 후보',
        product_name: '작업파일 저장 전환 신화사DB 후보',
        match_query: productName,
        reviewProductName: productName,
        reviewProductScopeKey: beforeScopeKey,
        reviewProductIdentityKey: window.factoryCandidateReviewIdentityKey(factory),
      };
      factory.product.pendingDbCandidates = [candidate];
      const beforeSelectable = window.factoryCandidateReviewCanApply(candidate, factory);
      const identity = window.factoryEnsureCurrentProjectIdentityForFile('작업파일 저장 전환 후보 검증');
      const currentScopeKey = window.factoryCandidateReviewScopeKey(factory);
      return {
        identity,
        beforeWorkspaceId,
        beforeScopeKey,
        beforeSelectable,
        currentScopeKey,
        candidateScopeKey: candidate.reviewProductScopeKey || '',
        candidateSelectable: window.factoryCandidateReviewCanApply(candidate, factory),
      };
    })()`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup?.();
  }

  const checks = [
    { ok: !!proof.beforeWorkspaceId, message: `저장 전 초안 workspaceId가 비었습니다: ${proof.beforeWorkspaceId}` },
    { ok: proof.before.dbSelectable === true && proof.before.cafe24Selectable === true, message: `저장 전 후보가 선택 가능하지 않습니다: ${JSON.stringify(proof.before)}` },
    { ok: !!proof.afterWorkspaceId && proof.afterWorkspaceId !== proof.beforeWorkspaceId, message: `저장 시 workspaceId가 새 프로젝트 ID로 전환되지 않았습니다: ${JSON.stringify({ before: proof.beforeWorkspaceId, after: proof.afterWorkspaceId })}` },
    { ok: proof.afterDbCandidate.reviewProductScopeKey === proof.afterScopeKey, message: `저장 후 신화사DB 후보 scope가 현재 작업 범위로 이관되지 않았습니다: ${JSON.stringify({ candidate: proof.afterDbCandidate.reviewProductScopeKey, current: proof.afterScopeKey })}` },
    { ok: proof.afterCafe24Candidate.reviewProductScopeKey === proof.afterScopeKey, message: `저장 후 Cafe24 후보 scope가 현재 작업 범위로 이관되지 않았습니다: ${JSON.stringify({ candidate: proof.afterCafe24Candidate.reviewProductScopeKey, current: proof.afterScopeKey })}` },
    { ok: proof.afterDbCandidate.selectable === true && proof.buttons.db?.disabled === false, message: `저장 후 신화사DB 후보 선택 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof.afterDbCandidate, button: proof.buttons.db })}` },
    { ok: proof.afterCafe24Candidate.selectable === true && proof.buttons.cafe24?.disabled === false, message: `저장 후 Cafe24 후보 선택 버튼이 잠겼습니다: ${JSON.stringify({ candidate: proof.afterCafe24Candidate, button: proof.buttons.cafe24 })}` },
    { ok: proof.scopeToggle.dbSelectable === true && proof.scopeToggle.cafe24Selectable === true && proof.scopeToggle.dbDisabled === false && proof.scopeToggle.cafe24Disabled === false, message: `후보 scope만 현재 저장 범위로 맞춘 토글이 버튼 잠김을 해제하지 못했습니다: ${JSON.stringify(proof.scopeToggle)}` },
    { ok: proof.fileIdentityTransition.beforeSelectable === true && !!proof.fileIdentityTransition.identity?.id, message: `작업파일 저장 전 후보 초기화가 잘못됐습니다: ${JSON.stringify(proof.fileIdentityTransition)}` },
    { ok: proof.fileIdentityTransition.candidateScopeKey === proof.fileIdentityTransition.currentScopeKey && proof.fileIdentityTransition.candidateSelectable === true, message: `작업파일 저장 범위 전환 뒤 후보가 잠겼습니다: ${JSON.stringify(proof.fileIdentityTransition)}` },
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
