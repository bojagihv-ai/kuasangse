const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9344';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-real-candidate-identity-v134.json');

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
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryApplyCafe24CandidateFromReview)', 60000);
    proof = await evaluate(cdp, `(() => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      return (async () => {
        const productName = '슬라브나비수저집';
        const workspaceId = 'candidate_identity_workspace_v134';
        const runId = 'candidate_identity_run_v134';
        const inputImageFingerprint = 'candidate_identity_input_v134';
        const factory = window.factoryState();
        window.state.step = 'factory';
        window.state.currentProjectId = workspaceId;
        window.state.currentProjectName = '후보 식별 검증 v134';
        window.state.productName = productName;
        factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
        factory.currentProjectId = workspaceId;
        factory.product.productName = productName;
        factory.product.userProductName = productName;
        factory.product.productKey = window.factoryNormalizeIdentityText(productName);
        factory.product.currentRunId = runId;
        factory.product.lockedInputImageFingerprint = inputImageFingerprint;
        factory.product.inputImageFingerprint = inputImageFingerprint;
        factory.automation = { ...(factory.automation || {}), activeTab: 'db', currentRunId: runId };
        factory.goalRun = { ...(factory.goalRun || {}), currentRunId: runId };
        factory.archive = { ...(factory.archive || {}), localRunId: '' };
        const candidate = {
          product_no: 'P00000TM',
          product_code: 'P00000TM',
          product_name: '나비수저집 부채집 2장유통판매',
          price: '4000',
          reviewProductScopeKey: window.factoryCandidateReviewScopeKey(factory),
          reviewProductIdentityKey: window.factoryCandidateReviewIdentityKey(factory),
          reviewProductName: productName,
        };
        factory.product.confirmedDb = { product_name: '나비수저집소', jcode: '1686' };
        factory.product.pendingCafe24Candidates = [candidate];
        factory.product.cafe24Candidates = [];
        factory.product.selectedCafe24CandidateKey = '';
        factory.product.cafe24CandidateResolution = '';
        const originalDetail = window.fetchCafe24ProductFullByNo;
        window.fetchCafe24ProductFullByNo = async () => { throw new Error('OAuth 재승인이 필요한 상태입니다.'); };
        window.render();
        document.querySelector('[data-factory-apply-cafe24-candidate="0"]')?.click();
        await pause(150);
        const current = window.factoryState();
        window.fetchCafe24ProductFullByNo = originalDetail;
        return {
          selectedKey: current.product.selectedCafe24CandidateKey || '',
          expectedKey: window.factoryCafe24CandidateKey(candidate),
          candidateStatus: current.product.candidateReviewStatus || '',
          cafeStatus: current.product.cafe24ApiStatus || '',
          dbName: current.product.confirmedDb?.product_name || '',
          buttonText: document.querySelector('[data-factory-apply-cafe24-candidate="0"]')?.textContent?.trim() || '',
        };
      })();
    })()`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
  const checks = [
    { ok: proof.selectedKey === proof.expectedKey, message: `실제 제품명 조합에서 Cafe24 선택키가 지워졌습니다: ${proof.selectedKey}` },
    { ok: proof.buttonText === '확정됨', message: `선택 후 카드 상태가 확정됨이 아닙니다: ${proof.buttonText}` },
  ];
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: checks.every(check => check.ok), proof, checks }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
