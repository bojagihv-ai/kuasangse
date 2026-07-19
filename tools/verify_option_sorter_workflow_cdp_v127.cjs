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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9634';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATHS = {
  mobileTop: path.join(OUT_DIR, 'option-sorter-workflow-v127-375-top.png'),
  mobileLayout: path.join(OUT_DIR, 'option-sorter-workflow-v127-375-layout.png'),
  tabletTop: path.join(OUT_DIR, 'option-sorter-workflow-v127-768-top.png'),
  tabletLayout: path.join(OUT_DIR, 'option-sorter-workflow-v127-768-layout.png'),
  desktopTop: path.join(OUT_DIR, 'option-sorter-workflow-v127-1280-top.png'),
  desktopLayout: path.join(OUT_DIR, 'option-sorter-workflow-v127-1280-layout.png'),
};
const RESULT_PATH = path.join(OUT_DIR, 'option-sorter-workflow-v127-result.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.defaultOptionSorterState && window.normalizeOptionSorterState && window.hydratePersistentSessionAssets && window.hydrateServerLastWorkSnapshot)', 60000);
    await evaluate(cdp, `(async () => {
      await window.hydratePersistentSessionAssets().catch(() => false);
      await window.hydrateServerLastWorkSnapshot().catch(() => false);
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    })()`);

    await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      const images = Array.from({ length: 13 }, (_, index) => {
        const label = 'OPTION ' + String(index + 1).padStart(2, '0');
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#fff"/><rect x="42" y="22" width="156" height="136" rx="12" fill="#6366f1"/><text x="120" y="98" text-anchor="middle" font-family="Arial" font-size="18" fill="#fff">' + label + '</text></svg>';
        const base64 = btoa(svg);
        return {
          id: 'workflow_image_' + (index + 1),
          name: '옵션사진_' + (index + 1),
          mime: 'image/svg+xml',
          base64,
          preview: 'data:image/svg+xml;base64,' + base64,
        };
      });
      const slots = images.map((image, index) => ({
        id: 'workflow_slot_' + (index + 1),
        name: '옵션명_' + (index + 1),
        imgIds: [image.id],
      }));
      const legacy = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        images,
        slots,
        pool: [],
        subStep: 'sort',
        optionSheetLayoutMode: 'rows',
        optionSheetRowPattern: '2,2',
      });
      window.__optionWorkflowLegacyProof = {
        mode: legacy.optionSheetLayoutMode,
        userSet: legacy.optionSheetLayoutUserSet,
        pattern: window.optGetSelectedLayoutPattern(legacy, 13).selectedPattern,
      };
      window.state.step = 'optionsorter';
      window.state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        images,
        slots,
        pool: [],
        subStep: 'sort',
        optionSheetLayoutMode: 'auto',
        optionSheetLayoutUserSet: false,
      });
      window.render();
      return true;
    })()`);
    await waitFor(cdp, 'document.querySelectorAll(".opt-slot-card").length === 13', 15000);

    const proof = await evaluate(cdp, `(() => {
      const os = window.state.optionSorter;
      const pairs = window.getOptionImagePairs(os);
      const selected = window.optGetSelectedLayoutPattern(os, pairs.length);
      const sheets = window.getOptionOutputSheets(pairs, os);
      const source = document.getElementById('optSourceStrip');
      const assignment = document.getElementById('optAssignmentWorkspace');
      const generator = document.querySelector('.opt-option-gen-panel');
      const workflowLabels = [...document.querySelectorAll('[data-opt-workflow-step]')]
        .map(item => item.textContent.replace(/\\s+/g, ' ').trim());
      return {
        imageCount: os.images.length,
        pairCount: pairs.length,
        poolCount: os.pool.length,
        slotCount: os.slots.length,
        layoutMode: os.optionSheetLayoutMode,
        layoutUserSet: os.optionSheetLayoutUserSet,
        selectedMode: selected.mode,
        selectedPattern: selected.selectedPattern,
        selectedCapacity: selected.capacity,
        sheetCount: sheets.length,
        sheetPatterns: sheets.map(sheet => sheet.rowPattern),
        sourceCardCount: source?.querySelectorAll('[data-opt-preview-img]').length || 0,
        mappingCardCount: document.querySelectorAll('.opt-option-map-card').length,
        workflowLabels,
        domOrder: {
          source: source?.getBoundingClientRect().top || 0,
          assignment: assignment?.getBoundingClientRect().top || 0,
          generator: generator?.getBoundingClientRect().top || 0,
        },
        generateEnabled: !document.getElementById('optGenerateOptions')?.disabled,
        outputSummary: document.getElementById('optSheetOutputSummary')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        legacyMigration: window.__optionWorkflowLegacyProof,
      };
    })()`);

    const unmatchedProof = await evaluate(cdp, `(() => {
      const os = window.state.optionSorter;
      const firstSlot = os.slots[0];
      const movedId = firstSlot.imgIds.pop();
      os.pool.push(movedId);
      window.__optionWorkflowMovedId = movedId;
      window.render();
      const unmatchedPairs = window.getOptionImagePairs(os);
      return {
        pairCount: unmatchedPairs.length,
        poolCount: os.pool.length,
        generateDisabled: !!document.getElementById('optGenerateOptions')?.disabled,
        sourceCardCount: document.querySelectorAll('#optSourceStrip [data-opt-preview-img]').length,
      };
    })()`);

    const dragPoints = await evaluate(cdp, `(() => {
      const main = document.querySelector('.main');
      const assignment = document.getElementById('optAssignmentWorkspace');
      if (main && assignment) {
        main.scrollTop += assignment.getBoundingClientRect().top - main.getBoundingClientRect().top - 100;
      }
      const source = document.querySelector('#optPoolList [data-img-id="' + window.__optionWorkflowMovedId + '"]');
      const target = document.getElementById('optSlotList_workflow_slot_1');
      if (!source || !target) return null;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return {
        from: { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
        to: { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
      };
    })()`);
    if (!dragPoints) throw new Error('Option sorter drag coordinates not found');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragPoints.from.x, y: dragPoints.from.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragPoints.from.x, y: dragPoints.from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 12; step += 1) {
      const ratio = step / 12;
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: dragPoints.from.x + (dragPoints.to.x - dragPoints.from.x) * ratio,
        y: dragPoints.from.y + (dragPoints.to.y - dragPoints.from.y) * ratio,
        button: 'left',
        buttons: 1,
      });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragPoints.to.x, y: dragPoints.to.y, button: 'left', buttons: 0, clickCount: 1 });
    await waitFor(cdp, 'window.state.optionSorter.pool.length === 0 && window.getOptionImagePairs(window.state.optionSorter).length === 13', 15000);

    const dragProof = await evaluate(cdp, `(() => ({
      pairCount: window.getOptionImagePairs(window.state.optionSorter).length,
      poolCount: window.state.optionSorter.pool.length,
      firstSlotImageCount: window.state.optionSorter.slots[0]?.imgIds?.length || 0,
      generateEnabled: !document.getElementById('optGenerateOptions')?.disabled,
    }))()`);

    const manualAutoProof = await evaluate(cdp, `(() => {
      const os = window.state.optionSorter;
      document.querySelector('[data-opt-layout-manual]')?.click();
      const patternInput = document.getElementById('optSheetPatternInput');
      if (patternInput) {
        patternInput.value = '2,2';
        patternInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const manualPairs = window.getOptionImagePairs(os);
      const manualSelected = window.optGetSelectedLayoutPattern(os, manualPairs.length);
      const manual = {
        userSet: os.optionSheetLayoutUserSet,
        mode: manualSelected.mode,
        pattern: manualSelected.selectedPattern,
        sheetCount: window.getOptionOutputSheets(manualPairs, os).length,
      };

      document.querySelector('[data-opt-layout-auto]')?.click();
      const autoPairs = window.getOptionImagePairs(os);
      const autoSelected = window.optGetSelectedLayoutPattern(os, autoPairs.length);
      return {
        manual,
        auto: {
          userSet: os.optionSheetLayoutUserSet,
          mode: autoSelected.mode,
          pattern: autoSelected.selectedPattern,
          sheetCount: window.getOptionOutputSheets(autoPairs, os).length,
        },
      };
    })()`);
    const transitionProof = {
      unmatched: unmatchedProof,
      drag: dragProof,
      manual: manualAutoProof.manual,
      auto: manualAutoProof.auto,
    };

    const checks = [
      { ok: proof.imageCount === 13 && proof.sourceCardCount === 13, message: '업로드 사진 13장이 화면 상단 원본 목록에 보이지 않습니다.' },
      { ok: proof.pairCount === 13 && proof.mappingCardCount === 13, message: '드래그 매칭 13개가 생성 기준 매핑으로 유지되지 않았습니다.' },
      { ok: proof.domOrder.source > 0 && proof.domOrder.source < proof.domOrder.assignment && proof.domOrder.assignment < proof.domOrder.generator, message: `작업 순서가 사진 → 매칭 → 배치/생성이 아닙니다: ${JSON.stringify(proof.domOrder)}` },
      { ok: proof.workflowLabels.some(label => label.includes('사진 확인')) && proof.workflowLabels.some(label => label.includes('이름 매칭')) && proof.workflowLabels.some(label => label.includes('배치')), message: '세 단계 작업 흐름 표지가 보이지 않습니다.' },
      { ok: proof.layoutMode === 'auto' && proof.layoutUserSet === false && proof.selectedMode === 'auto', message: '기본 레이아웃이 사진 수 기반 자동 모드가 아닙니다.' },
      { ok: proof.legacyMigration?.mode === 'auto' && proof.legacyMigration?.userSet === false && JSON.stringify(proof.legacyMigration?.pattern) === JSON.stringify([4, 4, 4]), message: `기존 2,2 저장값이 자동 배치로 이관되지 않았습니다: ${JSON.stringify(proof.legacyMigration)}` },
      { ok: JSON.stringify(proof.selectedPattern) === JSON.stringify([4, 4, 4]) && proof.selectedCapacity === 12, message: `13장 자동 배치가 장당 12칸(4/4/4)이 아닙니다: ${JSON.stringify(proof.selectedPattern)}` },
      { ok: proof.sheetCount === 2 && JSON.stringify(proof.sheetPatterns) === JSON.stringify([[4, 4, 4], [1]]), message: `13장 자동 출력이 2장(12+1)으로 분리되지 않았습니다: ${JSON.stringify(proof.sheetPatterns)}` },
      { ok: proof.generateEnabled, message: '모든 사진이 매칭됐는데 생성 버튼이 활성화되지 않았습니다.' },
      { ok: transitionProof.unmatched.pairCount === 12 && transitionProof.unmatched.poolCount === 1 && transitionProof.unmatched.generateDisabled && transitionProof.unmatched.sourceCardCount === 13, message: `미배정 사진이 생성 매칭에서 분리되지 않았습니다: ${JSON.stringify(transitionProof.unmatched)}` },
      { ok: transitionProof.drag.pairCount === 13 && transitionProof.drag.poolCount === 0 && transitionProof.drag.firstSlotImageCount === 1 && transitionProof.drag.generateEnabled, message: `실제 드래그 후 매칭과 자동 계산이 갱신되지 않았습니다: ${JSON.stringify(transitionProof.drag)}` },
      { ok: transitionProof.manual.userSet && transitionProof.manual.mode === 'rows' && JSON.stringify(transitionProof.manual.pattern) === JSON.stringify([2, 2]) && transitionProof.manual.sheetCount === 4, message: `직접 배치가 유지되지 않았습니다: ${JSON.stringify(transitionProof.manual)}` },
      { ok: !transitionProof.auto.userSet && transitionProof.auto.mode === 'auto' && JSON.stringify(transitionProof.auto.pattern) === JSON.stringify([4, 4, 4]) && transitionProof.auto.sheetCount === 2, message: `자동 배치 복귀가 사진 수를 다시 계산하지 않았습니다: ${JSON.stringify(transitionProof.auto)}` },
    ];

    for (const [key, width] of [['mobile', 375], ['tablet', 768], ['desktop', 1280]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(cdp, `(() => {
        const main = document.querySelector('.main');
        if (main) main.scrollTop = 0;
        window.scrollTo(0, 0);
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const topShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(SCREENSHOT_PATHS[`${key}Top`], Buffer.from(topShot.data, 'base64'));
      await evaluate(cdp, `(() => {
        const main = document.querySelector('.main');
        const generator = document.querySelector('.opt-option-gen-panel');
        if (!main || !generator) return false;
        const mainRect = main.getBoundingClientRect();
        const generatorRect = generator.getBoundingClientRect();
        const reservedTop = window.innerWidth <= 900 ? 230 : 90;
        main.scrollTop += generatorRect.top - mainRect.top - reservedTop;
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const layoutShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(SCREENSHOT_PATHS[`${key}Layout`], Buffer.from(layoutShot.data, 'base64'));
    }
    const result = { ok: checks.every(check => check.ok), proof, transitionProof, screenshots: SCREENSHOT_PATHS };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    if (cdp) cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
