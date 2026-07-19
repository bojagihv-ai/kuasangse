const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9343';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 760 },
  { id: 'tablet', width: 768, height: 760 },
  { id: 'mobile', width: 375, height: 760 },
];

function screenshotPath(viewport) {
  return path.join(OUT_DIR, `vm-candidate-status-reconciliation-${viewport.id}-20260714.png`);
}

function pngDimensions(buffer) {
  assert.deepEqual(
    Array.from(buffer.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
    '브라우저 캡처가 PNG 파일이 아닙니다.'
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function captureViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(cdp, 'window.scrollTo(0, 0); true');
  const inspection = await evaluate(cdp, `(() => {
    const host = document.querySelector('[data-qa-vm-status-harness]');
    const auction = host?.querySelector('[data-qa-market="auction"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      auctionVisible: !!auction,
      auctionText: auction?.innerText || '',
      auctionStyle: auction?.getAttribute('style') || '',
      cardCount: host?.querySelectorAll('[data-qa-market]').length || 0,
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = screenshotPath(viewport);
  const buffer = Buffer.from(shot.data, 'base64');
  fs.writeFileSync(file, buffer);
  return { ...inspection, screenshot: file, png: pngDimensions(buffer) };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyStatusReconciliation=${Date.now()}` });
    await waitFor(cdp, 'typeof window.renderFactoryVmSearchSiteBoard === "function"', 60000);

    const state = await evaluate(cdp, `(() => {
      const siteIds = ['coupang', 'naver', 'gmarket', 'auction', 'elevenst'];
      const staleConnectorError = 'JepumScraper network 연결 실패 · connector jepumscraper · endpoint api-v1-health · base 127.0.0.1:5012';
      const currentScope = window.compMarketCurrentWorkScope();
      const scopedRows = siteId => window.compMarketStampRowsWithCurrentWork([
        { id: siteId + '-1', platform: siteId, title: currentScope.productName || '상태 검증 상품', product_url: 'https://example.invalid/' + siteId + '/1' },
        { id: siteId + '-2', platform: siteId, title: currentScope.productName || '상태 검증 상품', product_url: 'https://example.invalid/' + siteId + '/2' },
      ], currentScope, { replaceScope: true });
      const market = {
        collectMode: 'vm',
        searchId: 'search_final_v183',
        selectedSites: siteIds,
        marketTargets: Object.fromEntries(siteIds.map(siteId => [siteId, 2])),
        groupedResults: {
          coupang: scopedRows('coupang'),
          naver: scopedRows('naver'),
          gmarket: scopedRows('gmarket'),
          auction: [],
          elevenst: scopedRows('elevenst'),
        },
        error: staleConnectorError,
        status: staleConnectorError,
        collectionStatus: {
          error: staleConnectorError,
          progress: 100,
          currentMarket: '완료',
          accepted: 8,
          elapsed: '6초',
          marketReports: [
            { marketId: 'coupang', requested: 2, accepted: 2, shortfall: 0, sourceLabel: 'VM' },
            { marketId: 'naver', requested: 2, accepted: 2, shortfall: 0, sourceLabel: 'VM' },
            { marketId: 'gmarket', requested: 2, accepted: 2, shortfall: 0, sourceLabel: 'VM' },
            { marketId: 'auction', requested: 2, accepted: 0, shortfall: 2, shortfallReason: 'zero_result', sourceLabel: 'VM' },
            { marketId: 'elevenst', requested: 2, accepted: 2, shortfall: 0, sourceLabel: 'VM' },
          ],
        },
      };
      const host = document.createElement('main');
      host.dataset.qaVmStatusHarness = 'true';
      host.style.cssText = 'box-sizing:border-box;min-height:100vh;padding:24px;background:var(--bg);color:var(--text);font-family:Pretendard,\"Noto Sans KR\",sans-serif';
      const board = window.renderFactoryVmSearchSiteBoard(market, { force: true });
      host.innerHTML = '<section class="factory-section" style="max-width:1180px;margin:0 auto"><div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><h1 style="margin:0;font-size:22px">VM 후보 수집 상태 검증</h1><span class="factory-pill">최종 결과 우선</span></div><p style="margin:8px 0 0;color:var(--text-m);font-size:13px;line-height:1.6;word-break:keep-all;overflow-wrap:normal">마켓별 최종 보고서가 이전 공통 연결 오류보다 우선 표시됩니다.</p>' + board + '</section>';
      document.body.replaceChildren(host);
      const cards = Array.from(host.querySelectorAll('div[style*="border:1px solid;border-radius:9px"]'));
      cards.forEach((card, index) => { card.dataset.qaMarket = siteIds[index] || ('site-' + index); });
      return Object.fromEntries(siteIds.map(siteId => {
        const card = host.querySelector('[data-qa-market="' + siteId + '"]');
        return [siteId, { text: card?.innerText || '', style: card?.getAttribute('style') || '' }];
      }));
    })()`);

    const captures = [];
    for (const viewport of VIEWPORTS) captures.push(await captureViewport(cdp, viewport));

    const auction = state.auction || {};
    const successfulMarkets = ['coupang', 'naver', 'gmarket', 'elevenst'];
    assertChecks([
      { ok: /검색 완료 · 결과 없음/.test(auction.text), message: `옥션 최종 zero_result가 결과 없음으로 표시되지 않았습니다: ${auction.text}` },
      { ok: !/수집 실패/.test(auction.text), message: `옥션 카드에 이전 공통 오류가 남았습니다: ${auction.text}` },
      { ok: /245,158,11/.test(auction.style), message: `옥션 zero_result 카드가 주의 색상으로 렌더링되지 않았습니다: ${auction.style}` },
      ...successfulMarkets.map(siteId => ({
        ok: /2건 확보/.test(state[siteId]?.text || ''),
        message: `${siteId} 성공 결과가 확보 상태로 렌더링되지 않았습니다: ${state[siteId]?.text || ''}`,
      })),
      ...captures.map(capture => ({
        ok: capture.cardCount === 5 && capture.auctionVisible,
        message: `${capture.viewport.width}px 화면에서 마켓 카드가 누락됐습니다: ${JSON.stringify(capture)}`,
      })),
      ...captures.map(capture => ({
        ok: capture.scrollWidth <= capture.viewport.width + 1,
        message: `${capture.viewport.width}px 화면에서 가로 넘침이 발생했습니다: ${capture.scrollWidth}px`,
      })),
      ...captures.map(capture => ({
        ok: capture.png.width >= capture.viewport.width - 20
          && capture.png.width <= capture.viewport.width
          && capture.png.height >= capture.viewport.height,
        message: `캡처 크기가 올바르지 않습니다: ${JSON.stringify(capture.png)}`,
      })),
    ]);
    console.log(JSON.stringify({ ok: true, state, captures }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
