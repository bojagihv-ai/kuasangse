const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9345';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'option-preview-tab-v135.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'option-preview-tab-v135.png');

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
    await waitFor(cdp, '!!(window.state && window.renderOptionSorter && window.defaultOptionSorterState)', 60000);
    proof = await evaluate(cdp, `(async () => {
      const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="100%" height="100%" fill="#f8fafc"/><rect x="170" y="160" width="140" height="360" rx="18" fill="#ef4444"/><text x="240" y="620" text-anchor="middle" font-size="26" fill="#111827">RED</text></svg>');
      const os = window.defaultOptionSorterState();
      os.images = [{ id: 'preview_tab_img_v135', name: 'IMG_5956', preview: svg, base64: svg, mime: 'image/svg+xml' }];
      os.pool = ['preview_tab_img_v135'];
      os.slots = [
        { id: 'slot_red_v135', name: '빨강', imgIds: ['preview_tab_img_v135'] },
        { id: 'slot_pink_v135', name: '분홍', imgIds: [] },
      ];
      window.state.optionSorter = os;
      window.state.step = 'optionsorter';
      window.render();
      const inputs = [...document.querySelectorAll('.opt-slot-name-inp')];
      inputs[0]?.focus();
      inputs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      const focusedSlot = document.activeElement?.dataset?.slotName || '';
      const card = document.querySelector('[data-opt-preview-img="preview_tab_img_v135"]');
      card?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const overlay = document.getElementById('optImagePreviewOverlay');
      const modal = overlay?.querySelector('.opt-image-preview-modal');
      const modalRect = modal?.getBoundingClientRect();
      const modalOpen = !!overlay;
      const modalTitle = document.querySelector('.opt-image-preview-title')?.textContent?.trim() || '';
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        modalOpen,
        modalTitle,
        focusedSlot,
        portalParent: overlay?.parentElement === document.body,
        modalVisible: !!modalRect && modalRect.width > 300 && modalRect.height > 100 && modalRect.top >= 0,
      };
    })()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
  const checks = [
    { ok: proof.buildId === '20260710-option-preview-portal-v136', message: `build id mismatch: ${proof.buildId}` },
    { ok: proof.modalOpen && proof.modalTitle === 'IMG_5956', message: `원본 크게보기 모달이 열리지 않았습니다: ${proof.modalTitle}` },
    { ok: proof.portalParent && proof.modalVisible, message: '원본 크게보기 모달이 최상단에 보이게 배치되지 않았습니다.' },
    { ok: proof.focusedSlot === 'slot_pink_v135', message: `Tab이 다음 색상 입력으로 이동하지 않았습니다: ${proof.focusedSlot}` },
  ];
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: checks.every(check => check.ok), proof, checks, screenshotPath: SCREENSHOT_PATH }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
