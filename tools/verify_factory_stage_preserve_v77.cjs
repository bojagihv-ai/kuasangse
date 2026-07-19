const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const evidenceDir = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const screenshotPath = path.join(evidenceDir, 'factory-stage-preserve-v78-cuts-visible.png');
const EXPECTED_BUILD_ID = currentSourceBuildId(path.resolve(__dirname, '..'));

const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGP8z8DwnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const bluePng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGNkYPj/HwADAgH/1XMv5wAAAABJRU5ErkJggg==';
const greenPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGNk+M/wnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function dataUrl(base64) {
  return `data:image/png;base64,${base64}`;
}

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

async function setupFactory(cdp) {
  await callInPage(cdp, ({ red, blue }) => {
    const productName = '검증용동전지갑';
    const oldRunId = 'old_cut_run_v77';
    const sourceUrl = `data:image/png;base64,${red}`;
    const oldUrl = `data:image/png;base64,${blue}`;
    state.step = 'factory';
    state.productName = productName;
    state.imageBase64 = red;
    state.imageMime = 'image/png';
    state.imagePreview = sourceUrl;
    state.imageName = '검증용_제품.png';
    const factory = factoryState();
    factory.product.productName = productName;
    factory.product.naturalHint = '동전지갑';
    factoryStampLockedInputImage(factory, {
      base64: red,
      mime: 'image/png',
      preview: sourceUrl,
      name: '검증용_제품.png',
    }, { id: 'verify_input_v77' });
    factory.stages.cuts = {
      ...(factory.stages.cuts || {}),
      currentRunId: oldRunId,
      latestGenerationRunId: oldRunId,
      targetCount: 1,
      selectedAssetIds: [],
      status: 'done',
      message: '기존 후보 1개',
    };
    const productKey = factoryCurrentProductKey(factory);
    const inputKey = factoryCurrentInputImageFingerprint(factory);
    state.cuts.factoryStageId = 'cuts';
    state.cuts.promptSlotCount = 1;
    state.cuts.prompts = [{
      id: 'verify_cut_1',
      label: '검증 이미지컷',
      prompt: '현재 제품을 깔끔한 흰 배경에 배치',
      result: oldUrl,
      generating: false,
      completedAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000,
      currentRunId: oldRunId,
      factoryGenerationRunId: oldRunId,
      generationRunId: oldRunId,
      productKey,
      inputImageFingerprint: inputKey,
      sourceImageKey: inputKey,
      inputImageKey: inputKey,
      productImageKey: inputKey,
      stageId: 'cuts',
      factoryStageId: 'cuts',
      sourceStageId: 'cuts',
      metadata: {
        currentRunId: oldRunId,
        factoryGenerationRunId: oldRunId,
        generationRunId: oldRunId,
        productKey,
        inputImageFingerprint: inputKey,
        sourceImageKey: inputKey,
        inputImageKey: inputKey,
        productImageKey: inputKey,
        stageId: 'cuts',
        factoryStageId: 'cuts',
      },
    }];
    const asset = factoryRegisterAsset('cuts', oldUrl, {
      title: '기존 검증 후보',
      used: true,
      currentRunId: oldRunId,
      generationRunId: oldRunId,
      productKey,
      inputImageFingerprint: inputKey,
      metadata: {
        currentRunId: oldRunId,
        generationRunId: oldRunId,
        productKey,
        inputImageFingerprint: inputKey,
        stageId: 'cuts',
      },
      sourceMap: {
        currentRunId: oldRunId,
        generationRunId: oldRunId,
        productKey,
        inputImageFingerprint: inputKey,
        importedStageId: 'cuts',
        cutSlotIndex: 0,
        cutSlotKey: 'verify_old_cut',
      },
      skipLocalArchive: true,
    });
    if (asset) factory.stages.cuts.selectedAssetIds = [asset.id];
    factorySetStageStatus('cuts', 'done', '기존 후보 1개');
    savePrompts();
    saveLastWorkNow();
    render();
    return true;
  }, { red: redPng, blue: bluePng });
}

async function clickRunButton(cdp) {
  await waitFor(cdp, `!!document.querySelector('[data-factory-run-stage="cuts"]')`, 10000);
  const clicked = await evaluate(cdp, `(() => {
    const buttons = Array.from(document.querySelectorAll('[data-factory-run-stage="cuts"]'));
    const button = buttons.find(item => !item.disabled && item.offsetParent !== null) ||
      buttons.find(item => !item.disabled) ||
      null;
    if (!button) {
      return {
        ok: false,
        total: buttons.length,
        disabled: buttons.map(item => !!item.disabled),
        text: buttons.map(item => String(item.textContent || '').trim()),
      };
    }
    button.scrollIntoView({ block: 'center', inline: 'nearest' });
    button.click();
    return {
      ok: true,
      total: buttons.length,
      text: String(button.textContent || '').trim(),
    };
  })()`);
  if (!clicked?.ok) {
    throw new Error(`이미지컷 실행 버튼을 찾지 못했습니다: ${JSON.stringify(clicked)}`);
  }
  return clicked;
}

async function waitForGenerationCycle(cdp) {
  await new Promise(resolve => setTimeout(resolve, 100));
  await waitFor(cdp, `(() => {
    const promptBusy = !!state.cuts?.prompts?.some(prompt => prompt?.generating);
    return !state.cuts?.runBusy && !promptBusy;
  })()`, 15000);
}

async function stageSummary(cdp) {
  return evaluate(cdp, `(() => {
    const factory = factoryState();
    const stage = factory.stages.cuts || {};
    const assets = (factory.assets || []).filter(asset => asset.stageId === 'cuts');
    const usable = typeof factoryUsableAssetsForStage === 'function'
      ? factoryUsableAssetsForStage('cuts', factory)
      : assets;
    return {
      build: window.__KUASANGSE_APP_BUILD_ID__,
      status: stage.status || '',
      message: stage.message || '',
      currentRunId: stage.currentRunId || '',
      latestGenerationRunId: stage.latestGenerationRunId || '',
      selectedCount: Array.isArray(stage.selectedAssetIds) ? stage.selectedAssetIds.length : 0,
      assets: assets.length,
      usable: usable.length,
      promptResult: !!state.cuts?.prompts?.[0]?.result,
      promptGenerating: !!state.cuts?.prompts?.[0]?.generating,
      runBusy: !!state.cuts?.runBusy,
      activeRuntime: typeof factoryImageStageHasActiveRun === 'function'
        ? factoryImageStageHasActiveRun('cuts', stage.currentRunId || stage.latestGenerationRunId || '')
        : null,
      currentInputKey: typeof factoryCurrentInputImageFingerprint === 'function'
        ? factoryCurrentInputImageFingerprint(factory)
        : '',
      productKey: typeof factoryCurrentProductKey === 'function' ? factoryCurrentProductKey(factory) : '',
      hasDeclaredProductImage: typeof factoryHasDeclaredProductImage === 'function'
        ? factoryHasDeclaredProductImage(factory)
        : null,
      firstUsableAsset: usable[0] ? {
        id: usable[0].id,
        title: usable[0].title,
        image: !!(typeof factoryAssetDisplayImage === 'function' ? factoryAssetDisplayImage(usable[0]) : usable[0].image),
        used: !!usable[0].used,
        generationRunId: typeof factoryAssetGenerationRunId === 'function' ? factoryAssetGenerationRunId(usable[0]) : '',
        inputImageKey: typeof factoryAssetInputImageKey === 'function' ? factoryAssetInputImageKey(usable[0]) : '',
        productKey: typeof factoryAssetProductKey === 'function' ? factoryAssetProductKey(usable[0]) : '',
        match: typeof factoryAssetMatchesCurrentJob === 'function'
          ? factoryAssetMatchesCurrentJob(usable[0], 'cuts', factory)
          : null,
      } : null,
      firstRawAsset: assets[0] ? {
        id: assets[0].id,
        title: assets[0].title,
        generationRunId: typeof factoryAssetGenerationRunId === 'function' ? factoryAssetGenerationRunId(assets[0]) : '',
      } : null,
      debugCounters: {
        handleRunStage: window.__stagePreserveHandleRunStageCalls || 0,
        factoryRunStage: window.__stagePreserveFactoryRunStageCalls || 0,
        generateImage: window.__stagePreserveGenerateImageCalls || 0,
      },
      handleArgs: window.__stagePreserveHandleArgs || [],
      logs: (state.factory?.logs || []).slice(-5).map(row => row?.message || row),
    };
  })()`);
}

async function focusCutsCandidateArea(cdp) {
  await evaluate(cdp, `(() => {
    const factory = factoryState();
    factory.activeTab = 'assets';
    factory.activeStage = 'cuts';
    render();
    const candidate = document.querySelector('[data-factory-asset-id]');
    if (candidate) candidate.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 200));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `window.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(EXPECTED_BUILD_ID)}`, 30000);
  await setupFactory(cdp);

  await evaluate(cdp, `(() => {
    window.__stagePreserveHandleRunStageCalls = 0;
    window.__stagePreserveFactoryRunStageCalls = 0;
    window.__stagePreserveGenerateImageCalls = 0;
    window.__stagePreserveHandleArgs = [];
    const originalHandle = factoryHandleRunStageButton;
    factoryHandleRunStageButton = async function(...args) {
      window.__stagePreserveHandleRunStageCalls += 1;
      const button = args[0];
      window.__stagePreserveHandleArgs.push({
        disabled: !!button?.disabled,
        stageId: button?.dataset?.factoryRunStage || '',
        text: String(button?.textContent || '').trim(),
        isConnected: !!button?.isConnected,
      });
      return originalHandle.apply(this, args);
    };
    const originalFactoryRunStage = factoryRunStage;
    factoryRunStage = async function(...args) {
      window.__stagePreserveFactoryRunStageCalls += 1;
      return originalFactoryRunStage.apply(this, args);
    };
    hasImageConnection = () => true;
    generateWithSelectedImageModel = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      throw new Error('검증용 API 실패');
    };
    return true;
  })()`);
  const firstClick = await clickRunButton(cdp);
  await waitForGenerationCycle(cdp);
  const afterFailure = await stageSummary(cdp);

  await callInPage(cdp, ({ green }) => {
    hasImageConnection = () => true;
    generateWithSelectedImageModel = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return `data:image/png;base64,${green}`;
    };
    generateImageWithAbortableTimeout = async () => {
      window.__stagePreserveGenerateImageCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 30));
      return `data:image/png;base64,${green}`;
    };
    return true;
  }, { green: greenPng });
  const secondClick = await clickRunButton(cdp);
  await waitForGenerationCycle(cdp);
  const afterSecondAttempt = await stageSummary(cdp);
  console.log(JSON.stringify({
    phase: 'afterSecondAttemptBeforeDoneWait',
    firstClick,
    secondClick,
    afterFailure,
    afterSecondAttempt,
  }, null, 2));
  await waitFor(cdp, `(() => {
    const stage = factoryState().stages.cuts || {};
    return ['done', 'review'].includes(stage.status) && factoryUsableAssetsForStage('cuts', factoryState()).length > 0;
  })()`, 10000);
  const afterSuccess = await stageSummary(cdp);

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `window.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(EXPECTED_BUILD_ID)}`, 30000);
  await new Promise(resolve => setTimeout(resolve, 500));
  const afterReload = await stageSummary(cdp);

  await focusCutsCandidateArea(cdp);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));

  console.log(JSON.stringify({
    afterFailure,
    firstClick,
    secondClick,
    afterSecondAttempt,
    afterSuccess,
    afterReload,
    screenshotPath,
  }, null, 2));

  if (afterFailure.promptGenerating || afterFailure.runBusy || !afterFailure.promptResult || afterFailure.usable < 1) {
    throw new Error('실패 후 기존 후보 보존 검증 실패');
  }
  if (!afterFailure.firstUsableAsset?.image || !afterFailure.firstUsableAsset?.match?.ok) {
    throw new Error('실패 후 현재 작업 후보 이미지 연결 검증 실패');
  }
  if (afterSuccess.promptGenerating || afterSuccess.runBusy || afterSuccess.usable < 1 || !['done', 'review'].includes(afterSuccess.status)) {
    throw new Error('성공 후 후보 표시 검증 실패');
  }
  if (
    !afterSuccess.firstUsableAsset?.image ||
    !afterSuccess.firstUsableAsset?.match?.ok ||
    afterSuccess.latestGenerationRunId === 'old_cut_run_v77' ||
    afterSuccess.firstUsableAsset.generationRunId !== afterSuccess.latestGenerationRunId
  ) {
    throw new Error('성공 후 최신 후보 우선/작업키 검증 실패');
  }
  if (afterReload.promptGenerating || afterReload.runBusy || afterReload.usable < 1 || !afterReload.promptResult) {
    throw new Error('새로고침 후 후보 보존 검증 실패');
  }
  if (
    !afterReload.firstUsableAsset?.image ||
    !afterReload.firstUsableAsset?.match?.ok ||
    afterReload.latestGenerationRunId === 'old_cut_run_v77' ||
    afterReload.firstUsableAsset.generationRunId !== afterReload.latestGenerationRunId
  ) {
    throw new Error('새로고침 후 최신 후보 재연결 검증 실패');
  }
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})();
