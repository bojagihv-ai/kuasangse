const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const evidenceDir = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const screenshotPath = path.join(evidenceDir, 'factory-image-generation-runtime-v85-cuts.png');

const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGP8z8DwnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const greenPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGNk+M/wnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

async function setupCurrentFactory(cdp) {
  await callInPage(cdp, ({ red }) => {
    const productName = '검증용띠수네모동전지갑';
    const sourceUrl = `data:image/png;base64,${red}`;
    state.step = 'factory';
    state.productName = productName;
    state.imageBase64 = red;
    state.imageMime = 'image/png';
    state.imagePreview = sourceUrl;
    state.imageName = '검증용_현재제품.png';
    state.analysis = {
      category: '동전지갑',
      colors: '빨강',
      material: '누비 원단',
      key_features: ['띠 장식', '네모 형태', '동전 수납'],
    };
    state.cuts = state.cuts || {};
    const factory = factoryState();
    factory.activeTab = 'assets';
    factory.activeStage = 'cuts';
    factory.product.productName = productName;
    factory.product.naturalHint = '동전지갑';
    factory.automation = factory.automation || {};
    factory.automation.startRunActive = false;
    factory.automation.currentRunId = 'verify_workflow_v85';
    factory.stages.cuts = {
      ...(factory.stages.cuts || {}),
      targetCount: 4,
      selectedAssetIds: [],
      status: 'idle',
      message: '검증 준비',
    };
    factory.assets = (factory.assets || []).filter(asset => asset.stageId !== 'cuts');
    factoryStampLockedInputImage(factory, {
      base64: red,
      mime: 'image/png',
      preview: sourceUrl,
      name: '검증용_현재제품.png',
    }, { id: 'verify_input_runtime_v85' });
    state.cuts.factoryStageId = 'cuts';
    state.cuts.promptSlotCount = 4;
    state.cuts.prompts = [
      '정면 컷',
      '소품 배치 컷',
      '디테일 컷',
      '사용 장면 컷',
    ].map((label, index) => stampCutPromptSource({
      id: `verify_runtime_cut_${index + 1}`,
      label,
      prompt: `${label}: 현재 업로드된 동전지갑만 사용해서 선명한 상품 사진으로 생성`,
      result: null,
      generating: false,
      error: '',
      warning: '',
      factoryStageId: 'cuts',
      stageId: 'cuts',
    }, 'cuts'));
    savePrompts();
    saveLastWorkNow();
    render();
    return {
      productKey: factoryCurrentProductKey(factory),
      inputKey: factoryCurrentInputImageFingerprint(factory),
      promptCount: state.cuts.prompts.length,
    };
  }, { red: redPng });
}

async function installMockGenerator(cdp) {
  await callInPage(cdp, ({ green }) => {
    window.__runtimeV85 = {
      calls: 0,
      clearEvents: [],
    };
    hasImageConnection = () => true;
    generateWithSelectedImageModel = async () => `data:image/png;base64,${green}`;
    generateImageWithAbortableTimeout = async label => {
      window.__runtimeV85.calls += 1;
      const factory = factoryState();
      const stage = factory.stages.cuts || {};
      if (window.__runtimeV85.calls === 1) {
        const timeoutMs = factoryImageStageRunningTimeoutMs('cuts', stage);
        stage.runStartedAt = Date.now() - timeoutMs - 1000;
        stage.runHeartbeatAt = stage.runStartedAt;
        const before = {
          status: stage.status,
          currentRunId: stage.currentRunId,
          latestGenerationRunId: stage.latestGenerationRunId,
          hasActive: factoryImageStageHasActiveRun('cuts', stage),
        };
        const cleared = factoryClearRestoredImageGenerationRuntime({ log: false, save: false });
        window.__runtimeV85.clearEvents.push({
          label,
          cleared,
          before,
          after: {
            status: stage.status,
            currentRunId: stage.currentRunId,
            latestGenerationRunId: stage.latestGenerationRunId,
            hasActive: factoryImageStageHasActiveRun('cuts', stage),
          },
        });
      }
      await new Promise(resolve => setTimeout(resolve, 25));
      return `data:image/png;base64,${green}`;
    };
    return true;
  }, { green: greenPng });
}

async function runtimeSummary(cdp) {
  return evaluate(cdp, `(() => {
    const factory = factoryState();
    const stage = factory.stages.cuts || {};
    const usable = typeof factoryUsableAssetsForStage === 'function'
      ? factoryUsableAssetsForStage('cuts', factory)
      : (factory.assets || []).filter(asset => asset.stageId === 'cuts');
    return {
      status: stage.status || '',
      message: stage.message || '',
      currentRunId: stage.currentRunId || '',
      latestGenerationRunId: stage.latestGenerationRunId || '',
      expectedItemCount: stage.expectedItemCount || 0,
      completedItemCount: stage.completedItemCount || 0,
      runStartedAt: !!stage.runStartedAt,
      runHeartbeatAt: !!stage.runHeartbeatAt,
      promptCount: state.cuts?.prompts?.length || 0,
      promptResults: (state.cuts?.prompts || []).filter(prompt => !!prompt?.result).length,
      promptGenerating: (state.cuts?.prompts || []).filter(prompt => !!prompt?.generating).length,
      runBusy: !!state.cuts?.runBusy,
      usable: usable.length,
      assetSummaries: usable.slice(0, 4).map(asset => ({
        id: asset.id,
        title: asset.title,
        hasImage: !!(typeof factoryAssetDisplayImage === 'function' ? factoryAssetDisplayImage(asset) : asset.image),
        generationRunId: typeof factoryAssetGenerationRunId === 'function' ? factoryAssetGenerationRunId(asset) : '',
        inputImageKey: typeof factoryAssetInputImageKey === 'function' ? factoryAssetInputImageKey(asset) : '',
        productKey: typeof factoryAssetProductKey === 'function' ? factoryAssetProductKey(asset) : '',
        match: typeof factoryAssetMatchesCurrentJob === 'function'
          ? factoryAssetMatchesCurrentJob(asset, 'cuts', factory)
          : null,
      })),
      currentInputKey: typeof factoryCurrentInputImageFingerprint === 'function' ? factoryCurrentInputImageFingerprint(factory) : '',
      productKey: typeof factoryCurrentProductKey === 'function' ? factoryCurrentProductKey(factory) : '',
      runtime: window.__runtimeV85 || null,
      timeoutMs: {
        cuts: typeof cutRequestTimeoutMs === 'function' ? cutRequestTimeoutMs('cuts') : 0,
        size: typeof cutRequestTimeoutMs === 'function' ? cutRequestTimeoutMs('size') : 0,
        sizeStageForThree: typeof factoryImageStageRunningTimeoutMs === 'function'
          ? factoryImageStageRunningTimeoutMs('size', { expectedItemCount: 3 })
          : 0,
      },
      lastLogs: (factory.logs || []).slice(-8).map(row => row?.message || row),
    };
  })()`);
}

async function focusAssets(cdp) {
  await evaluate(cdp, `(() => {
    const factory = factoryState();
    factory.activeTab = 'assets';
    factory.activeStage = 'cuts';
    render();
    const node = document.querySelector('[data-factory-asset-id]');
    if (node) node.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 300));
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const url = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}verify=v85_${Date.now()}`;
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `typeof factoryGenerateImageCutsBackedStage === 'function' && typeof factoryClearRestoredImageGenerationRuntime === 'function'`, 30000);
  await setupCurrentFactory(cdp);
  await installMockGenerator(cdp);

  const result = await evaluate(cdp, `factoryGenerateImageCutsBackedStage('cuts')`);
  await waitFor(cdp, `(() => {
    const stage = factoryState().stages.cuts || {};
    const usable = factoryUsableAssetsForStage('cuts', factoryState()).length;
    return !state.cuts?.runBusy && ['done', 'review'].includes(stage.status) && usable >= 4;
  })()`, 15000);
  const summary = await runtimeSummary(cdp);

  await focusAssets(cdp);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));

  console.log(JSON.stringify({ result, summary, screenshotPath }, null, 2));

  const clearEvent = summary.runtime?.clearEvents?.[0];
  if (result !== true) throw new Error('이미지컷 생성 함수가 성공을 반환하지 않았습니다.');
  if (!clearEvent || clearEvent.cleared !== false) {
    throw new Error('활성 생성 중 청소 루틴 차단 검증 실패');
  }
  if (summary.promptGenerating || summary.runBusy) {
    throw new Error('생성 완료 뒤 busy/generating 상태가 남았습니다.');
  }
  if (summary.promptResults < 4 || summary.usable < 4) {
    throw new Error(`후보 카드 생성 수 부족: promptResults=${summary.promptResults}, usable=${summary.usable}`);
  }
  if (!['done', 'review'].includes(summary.status)) {
    throw new Error(`생성 완료 상태 아님: ${summary.status}`);
  }
  if (summary.timeoutMs?.size < 120000) {
    throw new Error(`사이즈컷 타임아웃이 너무 짧습니다: ${summary.timeoutMs?.size}`);
  }
  if (summary.timeoutMs?.sizeStageForThree < 360000) {
    throw new Error(`사이즈컷 3장 실행 잠금 시간이 너무 짧습니다: ${summary.timeoutMs?.sizeStageForThree}`);
  }
  if (summary.assetSummaries.some(asset => !asset.hasImage || !asset.match?.ok)) {
    throw new Error('생성 후보의 이미지/현재 작업키 검증 실패');
  }
  if (!summary.currentInputKey || summary.assetSummaries.some(asset => asset.inputImageKey && asset.inputImageKey !== summary.currentInputKey)) {
    throw new Error('생성 후보의 입력 이미지 fingerprint가 현재 작업과 다릅니다.');
  }
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
