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
const SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'color-option-factory-sync-v187.png');

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

    await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      const state = window.state;
      const factory = window.factoryState();
      const runId = 'option_sync_run_v187';
      const productKey = '색상옵션동기화테스트';
      const inputImageFingerprint = 'option-sync-input-v187';
      const workspaceId = 'option-sync-workspace-v187';
      const optionResultId = 'option_result_archive_v187';
      const archiveId = 'option-sync-archive-v187';

      state.step = 'factory';
      state.currentProjectId = workspaceId;
      state.productName = productKey;
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionColorImageUsage: 'use',
        optionResults: [{
          id: optionResultId,
          image: null,
          hasImage: true,
          imagePersistence: 'local-archive-url',
          imageUrl: '/api/local-archive/assets/' + archiveId + '/image',
          archiveId,
          optionName: '복원 후 색상옵션표',
          batchLabel: '복원 검증 배치',
          prompt: 'verification',
          modelLabel: 'verification-model',
          factoryScope: {
            workspaceId,
            currentRunId: runId,
            productKey,
            inputImageFingerprint,
            stageId: 'options',
          },
        }],
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
      factory.assets = [];
      factory.previousAssets = [];

      return true;
    })()`);

    const proof = await evaluate(cdp, `(async () => {
      const state = window.state;
      const optionResultId = 'option_result_archive_v187';
      const imported = await window.factoryImportOptionSorterResults({ silent: true, skipRender: true });
      await window.render();
      const currentFactory = window.factoryState();
      const asset = (currentFactory.assets || []).find(item => item?.sourceMap?.optionResultId === optionResultId);
      const optionPanel = document.querySelector('#factoryAutomationAssetChooser_options');
      const visible = !!optionPanel && !!optionPanel.querySelector('[data-factory-asset-id]');
      const result = state.optionSorter.optionResults[0] || {};
      return {
        imported,
        optionUsage: state.optionSorter?.optionColorImageUsage || '',
        optionImagesDisabled: window.optionSorterColorImagesDisabled(state.optionSorter),
        currentFactoryAssetCount: (currentFactory.assets || []).length,
        asset: asset ? {
          stageId: asset.stageId,
          sourceMap: { optionResultId: asset.sourceMap?.optionResultId || '' },
          currentRunId: asset.currentRunId,
          generationRunId: asset.generationRunId,
          productKey: asset.productKey,
          inputImageFingerprint: asset.inputImageFingerprint,
          workspaceId: asset.workspaceId,
          archiveId: asset.archiveId,
          imageUrl: asset.imageUrl,
          hasImage: !!(asset.image || asset.imageUrl),
        } : null,
        resultLink: {
          resultAssetId: result.resultAssetId || '',
          archiveId: result.archiveId || '',
          imageUrl: result.imageUrl || '',
        },
        optionStageStatus: currentFactory.stages.options?.status || '',
        optionStageMessage: currentFactory.stages.options?.message || '',
        visible,
      };
    })()`);

    const checks = [
      { ok: !!proof.asset, message: `이미지 문자열이 압축된 옵션 결과가 조립공장 자산으로 복원되지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.asset?.stageId === 'options', message: `복원된 옵션 자산 stageId가 options가 아닙니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.sourceMap?.optionResultId === 'option_result_archive_v187', message: `복원된 옵션 결과 원본 ID 연결이 없습니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.currentRunId === 'option_sync_run_v187' && proof.asset?.generationRunId === 'option_sync_run_v187', message: `복원된 옵션 자산 runId가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.productKey === '색상옵션동기화테스트', message: `복원된 옵션 자산 productKey가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.inputImageFingerprint === 'option-sync-input-v187', message: `복원된 옵션 자산 inputImageFingerprint가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.workspaceId === 'option-sync-workspace-v187', message: `복원된 옵션 자산 workspaceId가 현재 작업과 다릅니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.asset?.archiveId === 'option-sync-archive-v187' && /\/api\/local-archive\/assets\/option-sync-archive-v187\/image$/.test(proof.asset?.imageUrl || ''), message: `복원된 옵션 자산의 로컬 보관 경로가 없습니다: ${JSON.stringify(proof.asset)}` },
      { ok: proof.optionStageStatus === 'done', message: `조립공장 색상옵션 단계가 완료 상태가 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.visible, message: `조립공장 색상옵션 UI에 복원된 카드가 표시되지 않았습니다: ${JSON.stringify(proof)}` },
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
