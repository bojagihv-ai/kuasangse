const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9359';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-cafe24-product-link-screen-v165.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-cafe24-product-link-screen-v165.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const expectedBuildId = currentSourceBuildId();
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1280),
      height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 820),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?cafe24ProductLinkScreen=v165` });
    await waitFor(cdp, '!!(window.factoryState && window.factoryCafe24CandidateProductUrl && window.renderFactoryCandidateCards)', 60000);
    const evidence = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      factory.product = {
        ...(factory.product || {}),
        productName: '띠수네모동전지갑',
        selectedCafe24CandidateKey: '2534',
      };
      const candidate = {
        product_no: '2534',
        product_name: '나비수저집 부채첩 2장묶음판매',
        mall_id: 'bojagi1928',
        match_score: 92,
        price: '4000',
        selling: true,
      };
      document.body.innerHTML = [
        '<main style="max-width:920px;margin:0 auto;padding:28px;background:#0f1017;color:#f4f4f5;font-family:Arial,sans-serif">',
        '<h1 style="font-size:24px;margin:0 0 8px">Cafe24 후보 확인</h1>',
        '<p style="color:#a6a7b0;margin:0 0 18px">현재 작업파일: 띠수네모동전지갑 · 후보 제품 링크 확인</p>',
        '<section class="factory-card" style="padding:16px;background:#171822;border:1px solid rgba(99,102,241,.45);border-radius:10px">',
        window.renderFactoryCandidateCards([candidate], 'cafe24'),
        '</section></main>',
      ].join('');
      const link = document.querySelector('a[title*="Cafe24 쇼핑몰"]');
      const card = document.querySelector('.factory-candidate-card');
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        cardText: card?.textContent || '',
        link: link ? {
          href: link.getAttribute('href'),
          text: link.textContent.trim(),
          target: link.target,
          rel: link.rel,
          visible: !!(link.offsetWidth && link.offsetHeight),
        } : null,
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: evidence.buildId === expectedBuildId, message: `실행 빌드와 현재 소스 빌드가 다릅니다: ${evidence.buildId} != ${expectedBuildId}` },
      { ok: /나비수저집/.test(evidence.cardText || ''), message: 'Cafe24 candidate name is not visible in the card' },
      { ok: evidence.link?.href === 'https://bojagi1928.cafe24.com/product/detail.html?product_no=2534', message: `unexpected product link href: ${evidence.link?.href}` },
      { ok: String(evidence.link?.text || '').replace(/\s+/g, '').endsWith('제품링크'), message: `product link label is not visible: ${evidence.link?.text}` },
      { ok: evidence.link?.target === '_blank', message: `product link target is not _blank: ${evidence.link?.target}` },
      { ok: evidence.link?.rel === 'noopener', message: `product link rel is not noopener: ${evidence.link?.rel}` },
      { ok: evidence.link?.visible === true, message: 'product link anchor is not visible' },
    ];
    const failures = checks.filter(check => !check.ok).map(check => check.message);
    const payload = { ok: failures.length === 0, evidence, checks, failures, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    assertChecks(checks);
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
