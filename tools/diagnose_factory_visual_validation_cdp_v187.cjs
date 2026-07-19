const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9634';

async function main() {
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryScheduleAssetVisualValidation)', 60000);

    const proof = await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      const state = window.state;
      const factory = window.factoryState();
      const runId = 'visual_validation_run_v187';
      const productKey = '시각검수성능테스트';
      const inputImageFingerprint = 'visual-validation-input-v187';
      const workspaceId = 'visual-validation-workspace-v187';
      const sourceImage = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#102040"/></svg>');
      const assetImage = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#b02020"/></svg>');
      state.step = 'factory';
      state.currentProjectId = workspaceId;
      state.productName = productKey;
      state.imagePreview = sourceImage;
      state.imageBase64 = '';
      state.factory = window.normalizeFactoryState({
        ...factory,
        workspace: { id: workspaceId },
        product: {
          ...(factory.product || {}),
          productName: productKey,
          userProductName: productKey,
          productKey,
          currentProductKey: productKey,
          lockedProductKey: productKey,
          lockedInputImageFingerprint: inputImageFingerprint,
          imagePreview: sourceImage,
          hasImage: true,
          currentRunId: runId,
          generationRunId: runId,
        },
        automation: { ...(factory.automation || {}), currentRunId: runId },
        stages: {
          ...(factory.stages || {}),
          hero: { ...(factory.stages?.hero || {}), currentRunId: runId, latestGenerationRunId: runId, status: 'running' },
        },
        assets: Array.from({ length: 6 }, (_, index) => ({
          id: 'visual_asset_' + (index + 1),
          stageId: 'hero',
          type: 'image',
          title: '대표이미지 후보 ' + (index + 1),
          image: assetImage,
          hasImage: true,
          workspaceId,
          currentRunId: runId,
          generationRunId: runId,
          productKey,
          inputImageFingerprint,
          metadata: { workspaceId, currentRunId: runId, generationRunId: runId, productKey, inputImageFingerprint, stageId: 'hero' },
          sourceMap: { workspaceId, currentRunId: runId, generationRunId: runId, productKey, inputImageFingerprint, stageId: 'hero' },
        })),
      });
      let renderCount = 0;
      let signatureCount = 0;
      const originalRender = window.render;
      const originalComputeImageColorSignature = window.factoryComputeImageColorSignature;
      window.render = (...args) => {
        renderCount += 1;
        window.__visualValidationRenderCount = renderCount;
        return originalRender(...args);
      };
      window.factoryComputeImageColorSignature = (...args) => {
        signatureCount += 1;
        window.__visualValidationSignatureCount = signatureCount;
        return originalComputeImageColorSignature(...args);
      };
      const currentFactory = window.factoryState();
      (currentFactory.assets || []).forEach(asset => {
        window.factoryScheduleAssetVisualValidation(asset, currentFactory, {
          sourceImage,
          sourceKey: inputImageFingerprint,
          assetImage,
          assetKey: 'asset-image-' + asset.id,
        });
      });
      return { startedAt: Date.now(), assetCount: currentFactory.assets.length };
    })()`);

    await new Promise(resolve => setTimeout(resolve, 4200));
    const after = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const logs = (factory.logs || []).map(log => ({ message: log.message, type: log.type, stageId: log.stageId }));
      return {
        renderCount: window.__visualValidationRenderCount || null,
        signatureCount: window.__visualValidationSignatureCount || null,
        logs,
        mismatchLogs: logs.filter(log => /색상 검수 완료|색상 검수 확인 실패/.test(log.message || '')).length,
        uniqueMismatchMessages: new Set(logs
          .filter(log => /색상 검수 완료|색상 검수 확인 실패/.test(log.message || ''))
          .map(log => log.message)).size,
        statuses: (factory.assets || []).map(asset => asset.metadata?.visualValidation?.status || ''),
      };
    })()`);
    const checks = [
      { ok: proof.assetCount === 6, message: `진단 자산 수가 예상과 다릅니다: ${JSON.stringify(proof)}` },
      { ok: after.mismatchLogs === 6, message: `색상 검수 완료 로그가 자산별로 기록되지 않았습니다: ${JSON.stringify(after)}` },
      { ok: after.uniqueMismatchMessages === 6, message: `색상 검수 로그가 자산별로 구분되지 않습니다: ${JSON.stringify(after)}` },
      { ok: after.renderCount !== null && after.renderCount <= 2, message: `검수 완료 후 전체 렌더가 배치되지 않았습니다: ${JSON.stringify(after)}` },
      { ok: after.signatureCount !== null && after.signatureCount <= 2, message: `동일 이미지 색상 분석이 후보마다 중복 실행되었습니다: ${JSON.stringify(after)}` },
      { ok: after.statuses.length === 6 && after.statuses.every(status => status === 'mismatch'), message: `검수 상태가 모두 저장되지 않았습니다: ${JSON.stringify(after)}` },
    ];
    console.log(JSON.stringify({ ok: checks.every(check => check.ok), started: proof, after }, null, 2));
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
