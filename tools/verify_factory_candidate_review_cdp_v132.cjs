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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9342';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-review-v132.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-review-v132.png');

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
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryApplyCafe24CandidateFromReview)', 60000);
    proof = await evaluate(cdp, `(() => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      return (async () => {
        const productName = '나비수저집 부채집';
        const workspaceId = 'candidate_review_workspace_v132';
        const runId = 'candidate_review_run_v132';
        const inputImageFingerprint = 'candidate_review_input_v132';
        const factory = window.factoryState();
        window.state.step = 'factory';
        window.state.currentProjectId = workspaceId;
        window.state.currentProjectName = '후보 선택 검증 v132';
        window.state.productName = productName;
        factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
        factory.currentProjectId = workspaceId;
        factory.product = factory.product || {};
        factory.product.productName = productName;
        factory.product.userProductName = productName;
        factory.product.lockedInputImageFingerprint = inputImageFingerprint;
        factory.product.inputImageFingerprint = inputImageFingerprint;
        factory.product.currentRunId = runId;
        factory.product.productKey = window.factoryNormalizeIdentityText(productName);
        factory.automation = { ...(factory.automation || {}), activeTab: 'db', currentRunId: runId };
        factory.goalRun = { ...(factory.goalRun || {}), currentRunId: runId };
        factory.archive = { ...(factory.archive || {}), localRunId: '' };
        const reviewProductScopeKey = window.factoryCandidateReviewScopeKey(factory);
        const reviewProductIdentityKey = window.factoryCandidateReviewIdentityKey(factory);
        const candidates = [
          { product_no: 'P00000AA', product_code: 'P00000AA', product_name: '다른 수저집', price: '3000', reviewProductScopeKey, reviewProductIdentityKey, reviewProductName: productName },
          { product_no: 'P00000TM', product_code: 'P00000TM', product_name: '나비수저집 부채집 2장유통판매', price: '4000', reviewProductScopeKey, reviewProductIdentityKey, reviewProductName: productName },
        ];
        factory.product.pendingCafe24Candidates = candidates;
        factory.product.cafe24Candidates = [];
        factory.product.pendingDbCandidates = [];
        factory.product.dbCandidates = [];
        factory.product.selectedCafe24CandidateKey = '';
        factory.product.selectedDbCandidateKey = '';
        factory.product.dbCandidateResolution = '';
        factory.product.cafe24CandidateResolution = '';
        factory.product.candidateReviewStatus = '후보 수집 완료: 신화사DB 0건 · Cafe24 2건.';
        const originalDetail = window.fetchCafe24ProductFullByNo;
        window.fetchCafe24ProductFullByNo = async () => { throw new Error('OAuth 재승인이 필요한 상태입니다.'); };
        window.render();
        const secondButton = document.querySelector('[data-factory-apply-cafe24-candidate="1"]');
        const buttonPresent = !!secondButton;
        secondButton?.click();
        await pause(120);
        const selectedKey = window.factoryCafe24CandidateKey(candidates[1]);
        const selectedAfterOAuthError = window.factoryState().product.selectedCafe24CandidateKey;
        const selectedName = (window.factoryState().product.cafe24Candidates || [])[0]?.product_name || '';
        const selectedButtonText = Array.from(document.querySelectorAll('[data-factory-apply-cafe24-candidate]'))
          .find(button => button.closest('.factory-candidate-card')?.classList.contains('selected'))?.textContent?.trim() || '';
        window.fetchCafe24ProductFullByNo = originalDetail;

        const noCandidateFactory = window.factoryState();
        noCandidateFactory.product.pendingCafe24Candidates = [];
        noCandidateFactory.product.cafe24Candidates = [];
        noCandidateFactory.product.pendingDbCandidates = [];
        noCandidateFactory.product.dbCandidates = [];
        noCandidateFactory.product.selectedCafe24CandidateKey = '';
        noCandidateFactory.product.selectedDbCandidateKey = '';
        noCandidateFactory.product.dbCandidateResolution = '';
        noCandidateFactory.product.cafe24CandidateResolution = '';
        noCandidateFactory.product.candidateReviewStatus = '후보 수집 완료: 신화사DB 0건 · Cafe24 0건.';
        window.render();
        const noDbButton = document.querySelector('[data-factory-confirm-no-db-candidate]');
        const noCafeButton = document.querySelector('[data-factory-confirm-no-cafe24-candidate]');
        const noButtonsPresent = !!noDbButton && !!noCafeButton;
        noDbButton?.click();
        await pause(30);
        noCafeButton?.click();
        await pause(60);
        const completedFactory = window.factoryState();
        return {
          buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
          buttonPresent,
          selectedKey,
          selectedAfterOAuthError,
          selectedName,
          selectedButtonText,
          cafeResolution: completedFactory.product.cafe24CandidateResolution,
          noButtonsPresent,
          dbResolution: completedFactory.product.dbCandidateResolution,
          noCafeResolution: completedFactory.product.cafe24CandidateResolution,
          stage: completedFactory.stages?.db || {},
          candidateStatus: completedFactory.product.candidateReviewStatus || '',
          cafeStatus: completedFactory.product.cafe24ApiStatus || '',
          noDbButtonText: document.querySelector('[data-factory-confirm-no-db-candidate]')?.textContent?.trim() || '',
          noCafeButtonText: document.querySelector('[data-factory-confirm-no-cafe24-candidate]')?.textContent?.trim() || '',
        };
      })();
    })()`);
    await evaluate(cdp, "document.querySelector('.factory-candidate-review')?.scrollIntoView({ block: 'start' })");
    await new Promise(resolve => setTimeout(resolve, 120));
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
  const checks = [
    { ok: !!proof.buildId, message: 'loaded build id missing' },
    { ok: proof.buttonPresent, message: '2번 Cafe24 후보 선택 버튼이 렌더되지 않았습니다.' },
    { ok: proof.selectedAfterOAuthError === proof.selectedKey, message: `OAuth 오류 뒤 선택키가 보존되지 않았습니다: ${proof.selectedAfterOAuthError}` },
    { ok: proof.selectedName === '나비수저집 부채집 2장유통판매', message: `2번 후보명이 선택되지 않았습니다: ${proof.selectedName}` },
    { ok: proof.selectedButtonText === '확정됨', message: `2번 후보 UI가 확정됨으로 바뀌지 않았습니다: ${proof.selectedButtonText}` },
    { ok: proof.noButtonsPresent, message: '후보 없음 진행 버튼이 렌더되지 않았습니다.' },
    { ok: proof.dbResolution === 'none', message: `DB 후보 없음 상태가 저장되지 않았습니다: ${proof.dbResolution}` },
    { ok: proof.noCafeResolution === 'none', message: `Cafe24 후보 없음 상태가 저장되지 않았습니다: ${proof.noCafeResolution}` },
    { ok: proof.stage.status === 'done', message: `신제품 후보 없음 후 DB 단계가 완료되지 않았습니다: ${proof.stage.status}` },
    { ok: /신제품/.test(proof.stage.message) && /새 상품 등록 초안/.test(proof.cafeStatus), message: '신제품 진행 상태 문구가 저장되지 않았습니다.' },
  ];
  const failures = checks.filter(item => !item.ok).map(item => item.message);
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: failures.length === 0, proof, checks, failures, screenshotPath: SCREENSHOT_PATH }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
