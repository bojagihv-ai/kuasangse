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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9358';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-persistence-v164.json');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidatePersistence=v164` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.sanitizeLastWorkPayloadProductScope && window.normalizeFactoryState)', 60000);
    proof = await evaluate(cdp, `(() => {
      const productName = '슬라브나비수저집';
      const workspaceId = 'project:candidate-persistence-v164';
      const factory = window.factoryState();
      window.state.currentProjectId = workspaceId;
      window.state.currentProjectName = productName;
      window.state.productName = productName;
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId, name: productName };
      factory.currentProjectId = workspaceId;
      factory.currentProjectName = productName;
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey: window.factoryNormalizeIdentityText(productName),
        currentRunId: 'candidate-persistence-run-v164',
        inputImageFingerprint: 'candidate-persistence-image-v164',
      };
      const scopeKey = window.factoryCandidateReviewScopeKey(factory);
      const identityKey = window.factoryCandidateReviewIdentityKey(factory);
      const matchingCandidate = {
        product_name: '나비수저집-대',
        match_query: productName,
        reviewProductScopeKey: scopeKey,
        reviewProductName: productName,
      };
      const foreignCandidate = {
        product_name: '다른 작업 후보',
        match_query: '다른 작업',
        reviewProductScopeKey: 'project:foreign-v164::다른작업::candidate-review',
        reviewProductIdentityKey: 'project:foreign-v164::foreign-run::다른작업::foreign-image::candidate-review',
        reviewProductName: '다른 작업',
      };
      const arrays = ['dbCandidates', 'pendingDbCandidates', 'cafe24Candidates', 'pendingCafe24Candidates'];
      const sourceProduct = {
        ...factory.product,
        ...Object.fromEntries(arrays.map(key => [key, [matchingCandidate, foreignCandidate]])),
      };
      const payload = {
        productName,
        currentProjectName: productName,
        factory: { ...factory, product: sourceProduct },
        dbMatchCandidates: [matchingCandidate, foreignCandidate],
      };
      const sanitized = window.sanitizeLastWorkPayloadProductScope(payload, { mutate: false, targetName: productName });
      const normalized = window.normalizeFactoryState({ ...factory, product: sourceProduct });
      const sanitizeCounts = Object.fromEntries(arrays.map(key => [key, sanitized.factory.product[key].length]));
      const normalizeCounts = Object.fromEntries(arrays.map(key => [key, normalized.product[key].length]));
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        scopeKey,
        identityKey,
        matchingConflict: window.factoryObjectConflictsWithIdentity(matchingCandidate, window.factoryNormalizeIdentityText(productName)),
        foreignConflict: window.factoryObjectConflictsWithIdentity(foreignCandidate, window.factoryNormalizeIdentityText(productName)),
        sanitizeCounts,
        sanitizeDbMatchCount: sanitized.dbMatchCandidates.length,
        normalizeCounts,
        normalizedDbCandidateNames: normalized.product.dbCandidates.map(item => item.product_name),
      };
    })()`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }

  const checks = [
    { ok: proof.matchingConflict === false, message: `matching review candidate was treated as foreign: ${proof.matchingConflict}` },
    { ok: proof.foreignConflict === true, message: `foreign review candidate was not rejected: ${proof.foreignConflict}` },
    ...Object.entries(proof.sanitizeCounts).map(([key, count]) => ({
      ok: count === 1,
      message: `${key} persistence filter kept ${count} rows; expected one current-scope row`,
    })),
    { ok: proof.sanitizeDbMatchCount === 1, message: `dbMatchCandidates persistence filter kept ${proof.sanitizeDbMatchCount} rows; expected one` },
    ...Object.entries(proof.normalizeCounts).map(([key, count]) => ({
      ok: count === 1,
      message: `${key} normalize filter kept ${count} rows; expected one current-scope row`,
    })),
    { ok: proof.normalizedDbCandidateNames?.[0] === '나비수저집-대', message: `normalized DB candidate title changed: ${proof.normalizedDbCandidateNames?.join(', ')}` },
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
