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
const RESULT_PATH = path.join(OUT_DIR, 'factory-input-restore-and-cafe24-link-v165.json');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?inputRestoreAndCafe24Link=v165` });
    await waitFor(cdp, '!!(window.factoryState && window.applyProductImageBackupPayload && window.factoryCafe24CandidateProductUrl && window.renderFactoryCandidateCards)', 60000);
    proof = await evaluate(cdp, `(() => {
      const productName = '복원검증제품-v165';
      const factory = window.factoryState();
      window.state.productName = productName;
      window.state.imageBase64 = '';
      window.state.imagePreview = '__stored_in_indexeddb__';
      factory.product = {
        ...(factory.product || {}),
        productName,
        imageBase64: null,
        imagePreview: '__stored_in_indexeddb__',
        hasImage: true,
        inputImages: [{ id: 'restore-marker-v165', name: '검증제품.png', hasImage: true, preview: '__stored_in_indexeddb__' }],
      };
      const base64 = 'RkVTVF9JTk1BR0VfUkVTVE9SRV9WMTY1';
      const backup = {
        productName,
        primary: { source: 'factory', base64, mime: 'image/png', name: '검증제품.png' },
      };
      const restoreChanged = window.applyProductImageBackupPayload(backup, { restoreInline: true });
      const restoredFactory = window.factoryState().product;
      const cafeCandidate = {
        product_no: '2534',
        product_name: '나비수저집 부채첩 2장묶음판매',
        mall_id: 'bojagi1928',
        match_score: 92,
      };
      const directCandidate = { product_no: '1', product_url: 'https://shop.example/product/1' };
      document.body.innerHTML = window.renderFactoryCandidateCards([cafeCandidate], 'cafe24');
      const link = document.querySelector('a[title*="Cafe24 쇼핑몰"]');
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        restoreChanged,
        restoredState: {
          hasBase64: window.state.imageBase64 === base64,
          previewHasBase64: String(window.state.imagePreview || '').includes(base64),
          factoryHasStoredReference: restoredFactory.hasImage === true
            && restoredFactory.imagePreview === '__stored_in_indexeddb__'
            && restoredFactory.imageRef === 'current-product-image',
          inputHasStoredReference: restoredFactory.inputImages?.[0]?.hasImage === true
            && restoredFactory.inputImages?.[0]?.preview === '__stored_in_indexeddb__',
        },
        generatedUrl: window.factoryCafe24CandidateProductUrl(cafeCandidate),
        directUrl: window.factoryCafe24CandidateProductUrl(directCandidate),
        missingUrl: window.factoryCafe24CandidateProductUrl({ product_name: 'URL 없음' }),
        renderedLink: link ? { href: link.getAttribute('href'), text: link.textContent.trim(), target: link.target } : null,
      };
    })()`);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }

  const checks = [
    { ok: proof.buildId === '20260713-candidate-scope-oauth-refresh-ui-v168', message: `unexpected build: ${proof.buildId}` },
    { ok: proof.restoreChanged === true, message: `image backup restore did not report a change: ${proof.restoreChanged}` },
    ...Object.entries(proof.restoredState || {}).map(([key, value]) => ({ ok: value === true, message: `restored image check failed: ${key}=${value}` })),
    { ok: proof.generatedUrl === 'https://bojagi1928.cafe24.com/product/detail.html?product_no=2534', message: `unexpected generated Cafe24 URL: ${proof.generatedUrl}` },
    { ok: proof.directUrl === 'https://shop.example/product/1', message: `direct candidate URL was not preferred: ${proof.directUrl}` },
    { ok: proof.missingUrl === '', message: `candidate without product number produced a URL: ${proof.missingUrl}` },
    { ok: proof.renderedLink?.href === proof.generatedUrl, message: `rendered product link href mismatch: ${proof.renderedLink?.href}` },
    { ok: String(proof.renderedLink?.text || '').replace(/\s+/g, '').endsWith('제품링크'), message: `rendered product link label mismatch: ${proof.renderedLink?.text}` },
    { ok: proof.renderedLink?.target === '_blank', message: `rendered product link target mismatch: ${proof.renderedLink?.target}` },
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
