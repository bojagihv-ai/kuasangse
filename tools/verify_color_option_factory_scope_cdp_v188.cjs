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
const EVIDENCE_DIR = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'color-option-factory-scope-v188.png');

async function main() {
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
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryImportOptionSorterResults)', 60000);

    const proof = await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      const state = window.state;
      const factory = window.factoryState();
      const runId = 'option_scope_run_v188';
      const oldRunId = 'option_scope_old_run_v188';
      const productKey = '색상옵션현재작업테스트';
      const inputImageFingerprint = 'option-scope-input-v188';
      const workspaceId = 'option-scope-workspace-v188';
      const resultIds = ['option_scope_result_v188_1', 'option_scope_result_v188_2', 'option_scope_result_v188_3'];
      const resultRows = resultIds.map((id, index) => ({
        id,
        image: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="260"><rect width="360" height="260" fill="#ffffff"/><text x="180" y="135" text-anchor="middle">current option sheet ' + (index + 1) + '</text></svg>'),
        hasImage: true,
        optionName: '현재 작업 색상옵션표 ' + (index + 1),
        batchLabel: '현재 작업 배치',
        prompt: 'verification',
        modelLabel: 'verification-model',
        factoryScope: {
          workspaceId,
          currentRunId: runId,
          productKey,
          inputImageFingerprint,
          stageId: 'options',
        },
      }));

      state.step = 'factory';
      state.currentProjectId = workspaceId;
      state.productName = productKey;
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionColorImageUsage: 'use',
        optionResults: resultRows,
      });
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
      factory.product = {
        ...(factory.product || {}),
        productName: productKey,
        userProductName: productKey,
        currentProductKey: productKey,
        productKey,
        lockedProductKey: productKey,
        lockedInputImageFingerprint: inputImageFingerprint,
        currentRunId: runId,
        generationRunId: runId,
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: runId, activeTab: 'assets' };
      factory.goalRun = { ...(factory.goalRun || {}), currentRunId: runId };
      factory.stages = factory.stages || {};
      factory.stages.options = {
        ...(factory.stages.options || {}),
        currentRunId: runId,
        latestGenerationRunId: runId,
        selectedAssetIds: [],
        status: 'idle',
      };
      factory.previousAssets = [];
      factory.assets = [{
        id: 'stale_option_asset_v188',
        stageId: 'options',
        type: 'image',
        title: '이전 작업 색상옵션표',
        image: resultRows[0].image,
        workspaceId: 'old-workspace-v188',
        currentRunId: oldRunId,
        generationRunId: oldRunId,
        productKey: '이전상품',
        inputImageFingerprint: 'old-input-v188',
        metadata: {
          workspaceId: 'old-workspace-v188',
          currentRunId: oldRunId,
          generationRunId: oldRunId,
          productKey: '이전상품',
          inputImageFingerprint: 'old-input-v188',
          stageId: 'options',
        },
        sourceMap: {
          optionResultId: resultIds[0],
          workspaceId: 'old-workspace-v188',
          currentRunId: oldRunId,
          generationRunId: oldRunId,
          productKey: '이전상품',
          inputImageFingerprint: 'old-input-v188',
          stageId: 'options',
        },
      }];

      window.render();
      const currentFactory = window.factoryState();
      const currentAssets = (currentFactory.assets || []).filter(asset => resultIds.includes(asset?.sourceMap?.optionResultId));
      const currentAsset = currentAssets.find(asset => asset.currentRunId === runId && asset?.sourceMap?.optionResultId === resultIds[0]);
      const usableAssets = window.factoryUsableAssetsForStage('options', currentFactory)
        .filter(asset => resultIds.includes(asset?.sourceMap?.optionResultId));
      const optionPanel = document.querySelector('#factoryAutomationAssetChooser_options');
      const candidateCard = optionPanel?.querySelector('[data-factory-asset-id]');
      return {
        currentAssetCount: currentAssets.length,
        usableAssetCount: usableAssets.length,
        previousAssetCount: (currentFactory.previousAssets || []).filter(asset => asset?.sourceMap?.optionResultId === resultIds[0]).length,
        currentAsset: currentAsset ? {
          stageId: currentAsset.stageId,
          workspaceId: currentAsset.workspaceId,
          currentRunId: currentAsset.currentRunId,
          productKey: currentAsset.productKey,
          inputImageFingerprint: currentAsset.inputImageFingerprint,
          sourceMap: currentAsset.sourceMap,
          hasImage: !!(currentAsset.image || currentAsset.imageUrl),
        } : null,
        stageStatus: currentFactory.stages.options?.status || '',
        stageMessage: currentFactory.stages.options?.message || '',
        visible: !!optionPanel && !!optionPanel.querySelector('[data-factory-asset-id]'),
        candidateRect: candidateCard ? (() => {
          const rect = candidateCard.getBoundingClientRect();
          return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
        })() : null,
        candidateText: candidateCard?.textContent?.trim().slice(0, 160) || '',
      };
    })()`);

    const checks = [
      { ok: proof.currentAssetCount === 3, message: `현재 후보 3장이 모두 연결되지 않았거나 이전 후보와 섞였습니다: ${JSON.stringify(proof)}` },
      { ok: proof.usableAssetCount === 3, message: `현재 작업 색상옵션 후보 3장이 usable 풀에 없습니다: ${JSON.stringify(proof)}` },
      { ok: proof.previousAssetCount === 1, message: `이전 작업 후보가 이전 결과 보관함으로 분리되지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.currentAsset?.stageId === 'options', message: `현재 후보 stageId가 options가 아닙니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.currentAsset?.workspaceId === 'option-scope-workspace-v188', message: `현재 후보 workspaceId가 다릅니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.currentAsset?.currentRunId === 'option_scope_run_v188', message: `현재 후보 currentRunId가 다릅니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.currentAsset?.productKey === '색상옵션현재작업테스트', message: `현재 후보 productKey가 다릅니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.currentAsset?.inputImageFingerprint === 'option-scope-input-v188', message: `현재 후보 inputImageFingerprint가 다릅니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.currentAsset?.sourceMap?.optionResultId === 'option_scope_result_v188_1', message: `옵션 결과 원본 연결이 없습니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.currentAsset?.hasImage, message: `현재 후보 이미지가 없습니다: ${JSON.stringify(proof.currentAsset)}` },
      { ok: proof.stageStatus === 'done' && /3개/.test(proof.stageMessage), message: `옵션 단계가 3장 완료 상태가 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.visible, message: `조립공장 옵션 후보 UI에 현재 후보가 표시되지 않았습니다: ${JSON.stringify(proof)}` },
    ];
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    await evaluate(cdp, `(() => {
      const target = document.querySelector('#factoryAutomationAssetChooser_options [data-factory-asset-id]')
        || document.querySelector('#factoryAutomationAssetChooser_options');
      const main = target?.closest?.('main.main');
      if (target && main) {
        const mainRect = main.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const contentTop = targetRect.top - mainRect.top + main.scrollTop;
        const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
        main.scrollTo({ top: Math.min(maxScrollTop, Math.max(0, contentTop - 96)), behavior: 'auto' });
      } else {
        target?.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      return !!target;
    })()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ ok: checks.every(check => check.ok), proof, screenshotPath: SCREENSHOT_PATH }, null, 2));
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
