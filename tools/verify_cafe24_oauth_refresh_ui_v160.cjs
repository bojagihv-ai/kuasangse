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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9355';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'cafe24-oauth-refresh-ui-v160.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'cafe24-oauth-refresh-ui-v160.png');

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?oauthRefreshUi=v160` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.render)', 60000);
    const evidence = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const productName = 'Cafe24 자동 갱신 확인 상품';
      window.state.step = 'factory';
      window.state.productName = productName;
      factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        cafe24OAuthStatus: {
          state: 'reauth_required',
          needsReauth: true,
          mallId: 'bojagi1928',
          missingScopes: [],
          tokenMessage: '저장된 갱신 권한 재승인 필요',
          message: 'Cafe24 OAuth access 토큰이 만료되어 재연결이 필요합니다.',
        },
      };
      window.render();
      const panel = document.querySelector('[data-factory-cafe24-oauth="reauth-required"]');
      const autoRefreshHelp = Array.from(panel?.querySelectorAll('.factory-small') || [])
        .find(element => element.textContent.includes('저장된 갱신 권한'));
      const autoRefreshHelpStyle = autoRefreshHelp ? getComputedStyle(autoRefreshHelp) : null;
      const rect = panel?.getBoundingClientRect();
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        panelText: panel?.textContent || '',
        panelWidth: Math.round(rect?.width || 0),
        panelHeight: Math.round(rect?.height || 0),
        viewportWidth: window.innerWidth,
        documentOverflowX: document.documentElement.scrollWidth > window.innerWidth,
        autoRefreshHelpWordBreak: autoRefreshHelpStyle?.wordBreak || '',
        autoRefreshHelpOverflowWrap: autoRefreshHelpStyle?.overflowWrap || '',
        buttons: Array.from(panel?.querySelectorAll('button') || []).map(button => ({
          text: button.textContent.trim(),
          clientHeight: button.clientHeight,
          scrollHeight: button.scrollHeight,
        })),
      };
    })()`);
    await evaluate(cdp, "document.querySelector('[data-factory-cafe24-oauth=\"reauth-required\"]')?.scrollIntoView({ block: 'center' })");
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    const checks = [
      { ok: evidence.buildId === '20260713-candidate-scope-oauth-refresh-ui-v168', message: `unexpected build: ${evidence.buildId}` },
      { ok: evidence.panelText.includes('저장된 갱신 권한으로 access 토큰을 자동 연장합니다.'), message: 'automatic refresh explanation is missing from the OAuth panel' },
      { ok: evidence.autoRefreshHelpWordBreak === 'keep-all' && evidence.autoRefreshHelpOverflowWrap === 'normal', message: `automatic refresh explanation can split Korean words: ${evidence.autoRefreshHelpWordBreak}/${evidence.autoRefreshHelpOverflowWrap}` },
      { ok: evidence.buttons.some(button => button.text.includes('Cafe24 OAuth 연결 시작')) && evidence.buttons.some(button => button.text.includes('인증 확인 후 후보 다시 수집')), message: `OAuth recovery actions missing: ${JSON.stringify(evidence.buttons)}` },
      { ok: evidence.buttons.every(button => button.clientHeight <= 46 && button.scrollHeight <= 46), message: `OAuth recovery action wraps or clips at this card width: ${JSON.stringify(evidence.buttons)}` },
      { ok: evidence.panelWidth > 0 && evidence.panelHeight > 0, message: `OAuth panel did not render: ${evidence.panelWidth}x${evidence.panelHeight}` },
      { ok: !evidence.documentOverflowX, message: 'OAuth panel caused horizontal document overflow' },
    ];
    const failures = checks.filter(check => !check.ok).map(check => check.message);
    fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: failures.length === 0, evidence, checks, failures, screenshotPath: SCREENSHOT_PATH }, null, 2));
    assertChecks(checks);
    console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, evidence }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
