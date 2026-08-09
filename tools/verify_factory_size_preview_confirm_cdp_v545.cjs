const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9345';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence', 'factory-size-preview-v545');

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="820" viewBox="0 0 1280 820">
  <rect width="1280" height="820" fill="#f8f4ef"/>
  <rect x="160" y="130" width="960" height="560" rx="36" fill="${color}"/>
  <text x="640" y="425" text-anchor="middle" font-family="Arial" font-size="62" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function capture(cdp, fileName) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const file = path.join(OUT_DIR, fileName);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

async function clickCenter(cdp, selector) {
  const rect = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      width: box.width,
      height: box.height,
    };
  })()`);
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`click target is not visible: ${selector}`);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  return rect;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  let cdp;
  try {
    const target = cdpRuntime.targets.find(item => item.type === 'page') || cdpRuntime.targets[0];
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
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);

    const images = {
      input: svgData('입력 원본', '#334155'),
      cuts: svgData('대리석 이미지컷', '#a855f7'),
      size1: svgData('사이즈컷 1', '#0f766e'),
      size2: svgData('사이즈컷 2', '#0369a1'),
      size3: svgData('사이즈컷 3', '#b45309'),
    };
    const seeded = await evaluateFactoryCdpFixture(cdp, `async ({
      setAppState,
      replaceFactory,
      readFactory,
      renderApp,
    }) => {
      const images = ${JSON.stringify(images)};
      const workspaceId = 'regression:factory-size-preview-v545:' + Date.now();
      const productName = '사이즈컷확정검증';
      const runId = 'factory_size_preview_run_v545';
      const inputBase64 = images.input.replace(/^data:image\\/[^;,]+;base64,/i, '');
      const inputFingerprint = window.factoryImagePayloadFingerprint(inputBase64);
      const productKey = window.factoryNormalizeIdentityText(productName);
      setAppState({
        step: 'factory',
        currentProjectId: workspaceId,
        currentProjectName: '사이즈컷·확대 확정 검증',
        productName,
        imageBase64: inputBase64,
        imageMime: 'image/svg+xml',
        imagePreview: images.input,
        imageName: 'size-preview-input.svg',
      });
      const factory = window.normalizeFactoryState({});
      factory.workspace = { id: workspaceId, name: '사이즈컷·확대 확정 검증', createdAt: Date.now() };
      factory.currentProjectId = workspaceId;
      factory.currentProjectName = '사이즈컷·확대 확정 검증';
      factory.product = factory.product || {};
      Object.assign(factory.product, {
        productName,
        userProductName: productName,
        currentRunId: runId,
        generationRunId: runId,
        lockedInputImageFingerprint: inputFingerprint,
        inputImageFingerprint: inputFingerprint,
        imageBase64: inputBase64,
        imageMime: 'image/svg+xml',
        imagePreview: images.input,
        imageName: 'size-preview-input.svg',
      });
      factory.automation = factory.automation || {};
      factory.automation.activeTab = 'assets';
      factory.automation.currentRunId = runId;
      factory.automation.lastAutoSizeRunKey = 'preserve-last-auto-size';
      factory.automation.sizeImageDbConfirmedKey = 'preserve-db-confirmed';
      factory.stages = factory.stages || {};
      factory.stages.cuts = {
        ...(factory.stages.cuts || {}),
        status: 'done',
        currentRunId: runId,
        latestGenerationRunId: runId,
        selectedAssetIds: [],
        completedItemCount: 1,
        expectedItemCount: 1,
      };
      factory.stages.size = {
        ...(factory.stages.size || {}),
        status: 'done',
        message: '3개 후보 표시 완료',
        currentRunId: runId,
        latestGenerationRunId: runId,
        selectedAssetIds: [],
        completedItemCount: 3,
        expectedItemCount: 3,
      };
      const asset = (id, stageId, title, image) => {
        const assetProductKey = stageId === 'size' ? 'candidate-scope-refreshing' : productKey;
        return {
          id,
          stageId,
          type: 'image',
          title,
          image,
          prompt: '제품명: ' + productName + '\\n' + title,
          used: false,
          rejected: false,
          workspaceId,
          currentRunId: runId,
          generationRunId: runId,
          productKey: assetProductKey,
          inputImageFingerprint: inputFingerprint,
          metadata: { workspaceId, productName, currentRunId: runId, generationRunId: runId, productKey: assetProductKey, inputImageFingerprint: inputFingerprint, stageId },
          sourceMap: { workspaceId, productName, currentRunId: runId, generationRunId: runId, productKey: assetProductKey, inputImageFingerprint: inputFingerprint, stageId },
        };
      };
      factory.assets = [
        asset('cuts-v545', 'cuts', '대리석', images.cuts),
        asset('size-v545-1', 'size', '사이즈컷 1', images.size1),
        asset('size-v545-2', 'size', '사이즈컷 2', images.size2),
        asset('size-v545-3', 'size', '사이즈컷 3', images.size3),
      ];
      replaceFactory(factory, { reason: 'size-preview-v545', workspaceId });
      await renderApp();
      const before = readFactory();
      const visibleSizeCardsBefore = document.querySelectorAll('[data-factory-asset-id^="size-v545-"]').length;
      const beforeSize = {
        status: before.stages.size.status,
        message: before.stages.size.message,
        completed: before.stages.size.completedItemCount,
        expected: before.stages.size.expectedItemCount,
        currentRunId: before.stages.size.currentRunId,
        latestGenerationRunId: before.stages.size.latestGenerationRunId,
        assets: window.factoryUsableAssetsForStage('size', before).map(item => item.id),
      };
      const scheduleResult = await Promise.resolve(window.factoryScheduleSizeCutAfterCandidateConfirm('Cafe24 확정'));
      await renderApp();
      const after = readFactory();
      const visibleSizeCardsAfter = document.querySelectorAll('[data-factory-asset-id^="size-v545-"]').length;
      const afterSize = {
        status: after.stages.size.status,
        message: after.stages.size.message,
        completed: after.stages.size.completedItemCount,
        expected: after.stages.size.expectedItemCount,
        currentRunId: after.stages.size.currentRunId,
        latestGenerationRunId: after.stages.size.latestGenerationRunId,
        assets: window.factoryUsableAssetsForStage('size', after).map(item => item.id),
      };
      let displayCalls = 0;
      const originalDisplay = window.factoryAssetDisplayImage;
      window.factoryAssetDisplayImage = (...args) => {
        displayCalls += 1;
        return originalDisplay(...args);
      };
      const openedAt = Date.now();
      window.factoryOpenAssetPreview('size-v545-1');
      const openMs = Date.now() - openedAt;
      window.factoryAssetDisplayImage = originalDisplay;
      const confirm = document.getElementById('factoryAssetPreviewConfirm');
      return {
        scheduleResult,
        beforeSize,
        afterSize,
        visibleSizeCardsBefore,
        visibleSizeCardsAfter,
        displayCalls,
        totalAssets: after.assets.length,
        openMs,
        overlayVisible: !!document.getElementById('factoryAssetPreviewOverlay'),
        confirmText: confirm?.textContent?.trim() || '',
        confirmEnabled: !!confirm && !confirm.disabled,
      };
    }`);

    await waitFor(cdp, `document.getElementById('factoryAssetPreviewConfirm')?.textContent?.trim() === '이 컷 확정'`, 5000);
    const beforeScreenshot = await capture(cdp, '01-modal-before-confirm.png');
    const confirmRect = await clickCenter(cdp, '#factoryAssetPreviewConfirm');
    await new Promise(resolve => setTimeout(resolve, 150));
    const postClickImmediate = await evaluate(cdp, `(() => {
      const factory = window.factoryRuntimeReadFactory();
      const button = document.getElementById('factoryAssetPreviewConfirm');
      const asset = factory.assets.find(item => item.id === 'size-v545-1');
      let currentPayload = null;
      let currentJob = null;
      try {
        currentPayload = window.factoryAssetHasCurrentProductPayload(asset, factory, { allowHtml: true });
        currentJob = window.factoryAssetMatchesCurrentJob(asset, 'size', factory, {
          strictScope: true,
          strictRunId: true,
          requireExpectedProductKey: true,
          requireExpectedInputFingerprint: true,
          requireExpectedRunId: true,
          requireExpectedStageId: true,
        });
      } catch (error) {
        currentJob = { error: error?.message || String(error) };
      }
      return {
        overlayVisible: !!document.getElementById('factoryAssetPreviewOverlay'),
        buttonText: button?.textContent?.trim() || '',
        ariaPressed: button?.getAttribute('aria-pressed') || '',
        assetUsed: asset?.used === true,
        selected: factory.stages.size?.selectedAssetIds?.includes('size-v545-1') === true,
        currentPayload,
        currentJob,
        stageRunId: window.factoryCurrentStageRunId?.('size', factory) || '',
        productKey: window.factoryIdentityKey?.(factory) || '',
        inputFingerprint: window.factoryCurrentInputImageFingerprint?.(factory) || '',
        asset,
      };
    })()`);
    if (postClickImmediate.buttonText !== '확정됨') {
      throw new Error(`preview confirm pointer click failed: ${JSON.stringify(postClickImmediate)}`);
    }
    await waitFor(cdp, `document.getElementById('factoryAssetPreviewConfirm')?.textContent?.trim() === '확정됨'`, 5000);
    const confirmed = await evaluate(cdp, `(() => {
      const factory = window.factoryRuntimeReadFactory();
      const asset = factory.assets.find(item => item.id === 'size-v545-1');
      const button = document.getElementById('factoryAssetPreviewConfirm');
      return {
        buttonText: button?.textContent?.trim() || '',
        ariaPressed: button?.getAttribute('aria-pressed') || '',
        ariaBusy: button?.getAttribute('aria-busy') || '',
        assetUsed: asset?.used === true,
        selected: factory.stages.size?.selectedAssetIds?.includes('size-v545-1') === true,
      };
    })()`);
    const confirmedScreenshot = await capture(cdp, '02-modal-confirmed.png');
    await clickCenter(cdp, '#factoryAssetPreviewClose');
    await waitFor(cdp, `!document.getElementById('factoryAssetPreviewOverlay')`, 5000);
    const closed = await evaluate(cdp, `(() => {
      const factory = window.factoryRuntimeReadFactory();
      return {
        overlayGone: !document.getElementById('factoryAssetPreviewOverlay'),
        assetUsed: factory.assets.find(item => item.id === 'size-v545-1')?.used === true,
        selected: factory.stages.size?.selectedAssetIds?.includes('size-v545-1') === true,
        cardCount: document.querySelectorAll('[data-factory-asset-id="size-v545-1"]').length,
      };
    })()`);
    const closedScreenshot = await capture(cdp, '03-card-after-close.png');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 620,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(cdp, `(() => { window.factoryOpenAssetPreview('size-v545-1'); return true; })()`);
    await waitFor(cdp, `!!document.getElementById('factoryAssetPreviewOverlay')`, 5000);
    const smallViewport = await evaluate(cdp, `(() => {
      const modal = document.querySelector('.factory-asset-preview-modal')?.getBoundingClientRect();
      const confirm = document.getElementById('factoryAssetPreviewConfirm')?.getBoundingClientRect();
      const close = document.getElementById('factoryAssetPreviewClose')?.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        modal: modal ? { top: modal.top, bottom: modal.bottom, width: modal.width } : null,
        confirmReachable: !!confirm && confirm.top >= 0 && confirm.bottom <= innerHeight,
        closeReachable: !!close && close.top >= 0 && close.bottom <= innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`);
    const smallScreenshot = await capture(cdp, '04-modal-1024x620.png');

    const checks = [
      { ok: seeded.scheduleResult === true, message: `완료 사이즈 보호 반환값 실패: ${seeded.scheduleResult}` },
      { ok: seeded.beforeSize.status === 'done' && seeded.afterSize.status === 'done', message: `사이즈 상태 퇴행: ${seeded.beforeSize.status} -> ${seeded.afterSize.status}` },
      { ok: seeded.afterSize.completed === 3 && seeded.afterSize.expected === 3, message: `사이즈 진행 수치 퇴행: ${JSON.stringify(seeded.afterSize)}` },
      { ok: seeded.beforeSize.assets.length === 0 && seeded.afterSize.assets.length === 0, message: `엄격 범위 필터가 비어 있지 않습니다: ${JSON.stringify(seeded)}` },
      { ok: seeded.visibleSizeCardsBefore >= 3 && seeded.visibleSizeCardsAfter >= 3, message: `완료된 사이즈 후보 표시 유실: ${JSON.stringify(seeded)}` },
      { ok: seeded.beforeSize.currentRunId === seeded.afterSize.currentRunId && seeded.beforeSize.latestGenerationRunId === seeded.afterSize.latestGenerationRunId, message: '사이즈 실행ID가 변경됐습니다.' },
      { ok: seeded.overlayVisible && seeded.confirmEnabled && seeded.confirmText === '이 컷 확정', message: `확대창 초기 상태 실패: ${JSON.stringify(seeded)}` },
      { ok: seeded.displayCalls <= seeded.totalAssets + 2, message: `확대창 이미지 계산 중복: ${seeded.displayCalls}/${seeded.totalAssets}` },
      { ok: seeded.openMs < 500, message: `확대창 열기 지연: ${seeded.openMs}ms` },
      { ok: confirmRect.width > 0 && confirmRect.height > 0, message: '확정 버튼 포인터 영역이 없습니다.' },
      { ok: postClickImmediate.currentPayload === false && postClickImmediate.currentJob?.ok === false, message: `엄격 범위 불일치 재현 실패: ${JSON.stringify(postClickImmediate)}` },
      { ok: confirmed.buttonText === '확정됨' && confirmed.ariaPressed === 'true' && confirmed.ariaBusy === 'false', message: `확정 버튼 피드백 실패: ${JSON.stringify(confirmed)}` },
      { ok: confirmed.assetUsed && confirmed.selected, message: `확정 상태 커밋 실패: ${JSON.stringify(confirmed)}` },
      { ok: closed.overlayGone && closed.assetUsed && closed.selected && closed.cardCount >= 1, message: `확대창 닫기 뒤 선택 유지 실패: ${JSON.stringify(closed)}` },
      { ok: smallViewport.confirmReachable && smallViewport.closeReachable && !smallViewport.horizontalOverflow, message: `작은 화면 조작 도달성 실패: ${JSON.stringify(smallViewport)}` },
    ];
    assertChecks(checks);
    const report = {
      ok: true,
      appUrl: APP_URL,
      seeded,
      confirmed,
      closed,
      smallViewport,
      screenshots: [beforeScreenshot, confirmedScreenshot, closedScreenshot, smallScreenshot],
      checks,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (cdp) cdp.close();
    await cdpRuntime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
