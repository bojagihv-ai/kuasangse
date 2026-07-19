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
const SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'option-factory-sync-v186.png');

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
      const runId = 'option_sync_run_v186';
      const productKey = '옵션동기화테스트';
      const inputImageFingerprint = 'option-sync-input-v186';
      const workspaceId = 'option-sync-workspace-v186';
      const image = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#fff"/><text x="160" y="125" text-anchor="middle">option sync</text></svg>');

      state.step = 'factory';
      state.currentProjectId = workspaceId;
      state.productName = '옵션 동기화 테스트';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionColorImageUsage: 'use',
        optionResults: [{
          id: 'option_result_sync_v186',
          image,
          optionName: '색상 옵션표 동기화 테스트',
          batchLabel: '검증 배치',
          prompt: 'verification',
          modelLabel: 'verification-model',
        }],
      });
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
      factory.product = {
        ...(factory.product || {}),
        productName: '옵션 동기화 테스트',
        userProductName: '옵션 동기화 테스트',
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
      factory.assets = (factory.assets || []).filter(asset => asset?.sourceMap?.optionResultId !== 'option_result_sync_v186');
      window.render();
      const currentFactory = window.factoryState();
      const asset = (currentFactory.assets || []).find(item => item?.sourceMap?.optionResultId === 'option_result_sync_v186');
      const optionPanel = document.querySelector('#factoryAutomationAssetChooser_options');
      const visible = !!optionPanel && !!optionPanel.querySelector('[data-factory-asset-id]') && document.body.textContent.includes('색상옵션');
      return {
        optionUsage: state.optionSorter?.optionColorImageUsage || '',
        optionImagesDisabled: window.optionSorterColorImagesDisabled(state.optionSorter),
        pendingOptionResultCount: state.optionSorter?.optionResults?.filter(result => result?.id && result?.image).length || 0,
        currentProductKey: window.factoryCurrentProductKey(currentFactory),
        factoryAssetCount: (currentFactory.assets || []).length,
        asset: asset ? {
          stageId: asset.stageId,
          sourceMap: asset.sourceMap,
          currentRunId: asset.currentRunId,
          generationRunId: asset.generationRunId,
          productKey: asset.productKey,
          inputImageFingerprint: asset.inputImageFingerprint,
          workspaceId: asset.workspaceId,
          hasImage: !!(asset.image || asset.imageUrl),
        } : null,
        optionStageStatus: currentFactory.stages.options?.status || '',
        optionStageMessage: currentFactory.stages.options?.message || '',
        visible,
      };
    })()`);

    const checks = [
      { ok: !!proof.asset, message: `옵션분류기 결과가 조립공장 options 자산으로 들어오지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.asset?.stageId === 'options', message: `옵션 결과 stageId가 options가 아닙니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.sourceMap?.optionResultId === 'option_result_sync_v186', message: `옵션 결과 원본 ID 연결이 없습니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.sourceMap?.stageId === 'options', message: `옵션 결과 sourceMap.stageId가 없습니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.currentRunId === 'option_sync_run_v186' && proof.asset?.generationRunId === 'option_sync_run_v186', message: `옵션 결과 runId가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.productKey === '옵션동기화테스트', message: `옵션 결과 productKey가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.inputImageFingerprint === 'option-sync-input-v186', message: `옵션 결과 inputImageFingerprint가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.workspaceId === 'option-sync-workspace-v186', message: `옵션 결과 workspaceId가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.hasImage, message: `옵션 결과 이미지 payload가 없습니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.optionStageStatus === 'done', message: `조립공장 옵션 단계가 완료 상태가 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.visible, message: `조립공장 옵션 UI가 표시되지 않았습니다: ${JSON.stringify(proof)}` },
    ];
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    await evaluate(cdp, `(() => {
      const target = document.querySelector('#factoryAutomationAssetChooser_options');
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return !!target;
    })()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    const result = { ok: checks.every(check => check.ok), proof, screenshotPath: SCREENSHOT_PATH };
    console.log(JSON.stringify(result, null, 2));
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
