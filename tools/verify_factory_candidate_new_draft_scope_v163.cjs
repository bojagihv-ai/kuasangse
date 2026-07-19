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

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9355';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-new-draft-scope-v163.json');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateDraftScope=v163` });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof factoryCurrentWorkspaceId === 'function'
      && typeof factoryCandidateReviewScopeKey === 'function'
      && typeof factoryCandidateReviewCanApply === 'function'
      && typeof factoryNormalizeIdentityText === 'function'
      && typeof rotateLastWorkDraftScope === 'function'`, 60000);
    proof = await evaluateFactoryCdpFixture(cdp, `({
      setAppState,
      cloneFactory,
      readFactory,
      replaceFactory,
    }) => {
      const productName = '새 초안 범위 검증 수저집';
      setAppState({
        currentProjectId: '',
        currentProjectName: '',
        productName,
      });
      const factory = cloneFactory();
      factory.workspace = { ...(factory.workspace || {}), id: '', name: '' };
      factory.currentProjectId = '';
      factory.currentProjectName = '';
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey: factoryNormalizeIdentityText(productName),
        currentRunId: 'draft-scope-run-v163',
        inputImageFingerprint: 'draft-scope-image-v163',
      };
      replaceFactory(factory);
      const currentFactory = readFactory();
      const beforeWorkspaceId = factoryCurrentWorkspaceId(currentFactory);
      const beforeScopeKey = factoryCandidateReviewScopeKey(currentFactory);
      const candidate = {
        product_name: '새 초안 후보',
        match_query: productName,
        reviewProductScopeKey: beforeScopeKey,
        reviewProductName: productName,
      };
      const beforeSelectable = factoryCandidateReviewCanApply(candidate, currentFactory);
      const rotatedScope = rotateLastWorkDraftScope();
      const afterWorkspaceId = factoryCurrentWorkspaceId(readFactory());
      const afterScopeKey = factoryCandidateReviewScopeKey(readFactory());
      const staleCandidate = { ...candidate, reviewProductScopeKey: beforeScopeKey };
      const staleSelectable = factoryCandidateReviewCanApply(staleCandidate, readFactory());
      return {
        buildId: typeof __KUASANGSE_APP_BUILD_ID__ === 'string' ? __KUASANGSE_APP_BUILD_ID__ : '',
        beforeWorkspaceId,
        beforeScopeKey,
        beforeSelectable,
        rotatedScope,
        afterWorkspaceId,
        afterScopeKey,
        staleSelectable,
      };
    }`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }

  const checks = [
    { ok: !!proof.beforeWorkspaceId, message: `new draft workspace id is empty: ${proof.beforeWorkspaceId}` },
    { ok: !!proof.beforeScopeKey, message: `new draft candidate scope key is empty: ${proof.beforeScopeKey}` },
    { ok: proof.beforeSelectable === true, message: `candidate from current new draft is not selectable: ${proof.beforeSelectable}` },
    { ok: !!proof.afterWorkspaceId && proof.afterWorkspaceId !== proof.beforeWorkspaceId, message: 'new draft rotation did not create a new workspace scope' },
    { ok: proof.staleSelectable === false, message: `candidate from previous draft remained selectable: ${proof.staleSelectable}` },
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: failures.length === 0, proof, checks, failures }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
