const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, currentSourceBuildId, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9346';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'option-map-layout-drag-v137.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'option-map-layout-drag-v137.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const expectedBuildId = currentSourceBuildId();
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
    await waitFor(cdp, `!!(window.state
      && window.render
      && window.defaultOptionSorterState
      && window.__KUASANGSE_APP_LOADER__?.ready === true
      && window.__KUASANGSE_APP_LOADER__?.modules?.includes('src/menus/optionsorter-menu.mjs')
      && classicRuntimeHydrationReady === true
      && classicRuntimeInitialRenderComplete === true
      && (typeof classicRuntimeDeferredHydrationPromise === 'undefined'
        || classicRuntimeDeferredHydrationPromise === null))`, 60000);
    const setup = await evaluate(cdp, `(async () => {
      const colors = ['자주', '빨강', '연핑', '연두', '검정', '파랑', '연하늘', '청록', '노랑', '연두2', '보라', '자색'];
      const os = window.defaultOptionSorterState();
      os.images = colors.map((name, index) => ({
        id: 'map_img_v137_' + index,
        name: 'IMG_' + String(5957 + index),
        preview: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="100%" height="100%" fill="#fff"/><rect x="43" y="32" width="34" height="100" rx="6" fill="#ef4444"/></svg>'),
        base64: '',
        mime: 'image/svg+xml',
      }));
      os.slots = colors.map((name, index) => ({ id: 'map_slot_v137_' + index, name, imgIds: ['map_img_v137_' + index] }));
      os.pool = [];
      os.subStep = 'sort';
      os.optionSheetLayoutUserSet = true;
      os.optionSheetLayoutMode = 'rows';
      os.optionSheetRowPattern = '3,3,3,3';
      window.state.optionSorter = os;
      window.state.step = 'optionsorter';
      await window.render();
      const readyDeadline = Date.now() + 30000;
      while (Date.now() < readyDeadline) {
        const row = document.querySelector('[data-opt-map-row-index="0"]');
        if (row && window.Sortable?.get?.(row)) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const beforeRows = [...document.querySelectorAll('[data-opt-map-row-index]')].map(row => row.children.length);
      const before = [...document.querySelectorAll('[data-opt-map-pair-key]')].map(card => card.querySelector('.name')?.textContent?.trim() || '');
      const firstRow = document.querySelector('[data-opt-map-row-index="0"]');
      const sortable = firstRow ? window.Sortable?.get?.(firstRow) : null;
      const onStart = sortable?.option?.('onStart');
      const onEnd = sortable?.option?.('onEnd');
      const cards = [...(firstRow?.querySelectorAll('[data-opt-map-pair-key]') || [])];
      // 실제 화면에 연결된 Sortable 콜백을 사용해 포인터 감지 편차 없이 같은 교환 경로를 검증한다.
      if (typeof onStart === 'function' && typeof onEnd === 'function' && cards.length >= 2) {
        onStart();
        firstRow.insertBefore(cards[1], cards[0]);
        onEnd({ from: firstRow, to: firstRow, oldIndex: 0, newIndex: 1 });
      }
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        beforeRows,
        before,
        afterRows: [...document.querySelectorAll('[data-opt-map-row-index]')].map(row => row.children.length),
        after: [...document.querySelectorAll('[data-opt-map-pair-key]')].map(card => card.querySelector('.name')?.textContent?.trim() || ''),
        pairOrder: [...(window.state.optionSorter.optionPairOrder || [])],
        step: window.state.step,
        subStep: window.state.optionSorter.subStep,
        hasFirstRow: !!firstRow,
        sortableLoaded: !!window.Sortable,
        hasSortable: !!sortable,
        dragHandle: sortable?.option?.('handle') || '',
      };
    })()`);
    if (!setup.hasSortable) throw new Error(`SortableJS map binding is unavailable: ${JSON.stringify(setup)}`);
    proof = setup;
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
  const expectedRows = [3, 3, 3, 3];
  const checks = [
    { ok: proof.buildId === expectedBuildId, message: `실행 빌드와 현재 소스 빌드가 다릅니다: ${proof.buildId} != ${expectedBuildId}` },
    { ok: proof.dragHandle === '.opt-map-drag-handle', message: `드래그 손잡이 연결이 다릅니다: ${proof.dragHandle}` },
    { ok: JSON.stringify(proof.beforeRows) === JSON.stringify(expectedRows), message: `배치 전 매핑 행이 3/3/3/3이 아닙니다: ${proof.beforeRows}` },
    { ok: JSON.stringify(proof.afterRows) === JSON.stringify(expectedRows), message: `교환 후 매핑 행이 3/3/3/3이 아닙니다: ${proof.afterRows}` },
    { ok: proof.before[0] === '자주' && proof.before[1] === '빨강' && proof.after[0] === '빨강' && proof.after[1] === '자주', message: `사진/옵션 매핑 교환이 반영되지 않았습니다: ${proof.before.slice(0, 2)} -> ${proof.after.slice(0, 2)}` },
  ];
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: checks.every(check => check.ok), proof, checks, screenshotPath: SCREENSHOT_PATH }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
