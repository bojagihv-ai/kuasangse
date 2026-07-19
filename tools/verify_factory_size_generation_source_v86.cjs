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
const screenshotPath = path.join(evidenceDir, 'factory-size-generation-source-v86.png');
const evidenceJsonPath = path.join(evidenceDir, 'factory-size-generation-source-v86.json');

const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGP8z8DwnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const greenPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGNk+M/wnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

async function readSizeSummary(cdp, result) {
  return evaluate(cdp, `(() => {
    const factory = factoryState();
    const stage = factory.stages.size || {};
    const usable = factoryUsableAssetsForStage('size', factory);
    return {
      result: ${JSON.stringify(result)},
      status: stage.status || '',
      message: stage.message || '',
      usable: usable.length,
      promptResults: (state.cuts?.sizePrompts || []).filter(prompt => !!prompt?.result).length,
      sizeRunBusy: !!state.cuts?.sizeRunBusy,
      calls: window.__sizeV86?.calls || [],
      runLogs: (state.cuts?.runLogs || []).slice(-20).map(log => ({
        message: log?.message || log,
        status: log?.status || log?.level || '',
        detail: log?.detail || '',
      })),
      prompts: (state.cuts?.sizePrompts || []).map((prompt, index) => ({
        index,
        id: prompt?.id || '',
        label: prompt?.label || '',
        hasResult: !!prompt?.result,
        generating: !!prompt?.generating,
        generationStartedAt: prompt?.generationStartedAt || null,
        error: prompt?.error || '',
        warning: prompt?.warning || '',
        currentRunId: prompt?.currentRunId || '',
        generationRunId: prompt?.generationRunId || '',
        productKey: prompt?.productKey || '',
        inputImageFingerprint: prompt?.inputImageFingerprint || prompt?.inputImageKey || prompt?.sourceImageKey || '',
        stageId: prompt?.stageId || prompt?.factoryStageId || '',
      })),
      assetSummaries: usable.map(asset => ({
        id: asset.id,
        hasImage: !!factoryAssetDisplayImage(asset),
        match: factoryAssetMatchesCurrentJob(asset, 'size', factory),
      })),
    };
  })()`);
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
  const url = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}verify=v86_${Date.now()}`;
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `typeof factoryGenerateImageCutsBackedStage === 'function' && typeof factoryStampLockedInputImage === 'function'`, 30000);

  await callInPage(cdp, ({ red }) => {
    const productName = '검증용사이즈동전지갑';
    const sourceUrl = `data:image/png;base64,${red}`;
    state.step = 'factory';
    state.productName = productName;
    state.imageBase64 = red;
    state.imageMime = 'image/png';
    state.imagePreview = sourceUrl;
    state.imageName = '검증용_사이즈_현재제품.png';
    state.cuts = state.cuts || {};
    const factory = factoryState();
    factory.activeTab = 'assets';
    factory.activeStage = 'size';
    factory.product.productName = productName;
    factory.product.naturalHint = '동전지갑';
    factory.productPayload = {
      product_name: productName,
      size: '가로 10.4cm x 세로 8.3cm',
      width_mm: '10.4cm',
      depth_mm: '8.3cm',
      weight: '14g',
    };
    factory.requiredFields = [
      { fieldId: 'size', label: '사이즈/규격', value: '가로 10.4cm x 세로 8.3cm', source: '직접 입력' },
      { fieldId: 'width_mm', label: '가로', value: '10.4cm', source: '직접 입력' },
      { fieldId: 'depth_mm', label: '세로', value: '8.3cm', source: '직접 입력' },
      { fieldId: 'weight', label: '제품 무게', value: '14g', source: '직접 입력' },
    ];
    factory.stages.size = {
      ...(factory.stages.size || {}),
      targetCount: 3,
      selectedAssetIds: [],
      status: 'idle',
      message: '검증 준비',
    };
    factory.assets = (factory.assets || []).filter(asset => asset.stageId !== 'size');
    factoryStampLockedInputImage(factory, {
      base64: red,
      mime: 'image/png',
      preview: sourceUrl,
      name: '검증용_사이즈_현재제품.png',
    }, { id: 'verify_size_input_v86' });
    state.cuts.factoryStageId = 'size';
    state.cuts.sizeFactoryStageId = 'size';
    state.cuts.sourceBase64 = '';
    state.cuts.sourceMime = '';
    state.cuts.sourcePreview = '';
    state.cuts.workImageBase64 = '';
    state.cuts.workImageMime = '';
    state.cuts.workImagePreview = '';
    state.cuts.sizePromptSlotCount = 3;
    state.cuts.sizePrompts = [
      '가로 세로 안내',
      '상세 규격 표',
      '착용감 안내',
    ].map((label, index) => stampCutPromptSource({
      id: `verify_size_runtime_${index + 1}`,
      label,
      prompt: `${label}: 가로 10.4cm, 세로 8.3cm, 무게 14g를 이미지 안에 선명히 표시`,
      result: null,
      generating: false,
      error: '',
      warning: '',
      factoryStageId: 'size',
      stageId: 'size',
    }, 'size'));
    saveLastWorkNow();
    render();
    return true;
  }, { red: redPng });

  await callInPage(cdp, ({ green }) => {
    window.__sizeV86 = { calls: [] };
    hasImageConnection = () => true;
    generateImageWithAbortableTimeout = async (label, prompt, base64, mime, extraImages, options) => {
      window.__sizeV86.calls.push({
        label,
        hasBase64: !!base64,
        base64Prefix: String(base64 || '').slice(0, 24),
        mime,
        promptHasSize: /10\.4cm/.test(prompt) && /8\.3cm/.test(prompt) && /14g/.test(prompt),
        stageId: options?.stageId || '',
      });
      return `data:image/png;base64,${green}`;
    };
    return true;
  }, { green: greenPng });

  const result = await evaluate(cdp, `factoryGenerateImageCutsBackedStage('size')`);
  try {
    await waitFor(cdp, `(() => {
      const stage = factoryState().stages.size || {};
      const usable = factoryUsableAssetsForStage('size', factoryState()).length;
      return !state.cuts?.sizeRunBusy && ['done', 'review'].includes(stage.status) && usable >= 3;
    })()`, 15000);
  } catch (err) {
    const failedSummary = await readSizeSummary(cdp, result).catch(readErr => ({
      readError: readErr?.message || String(readErr),
    }));
    fs.writeFileSync(evidenceJsonPath, JSON.stringify({
      failure: err?.message || String(err),
      summary: failedSummary,
    }, null, 2), 'utf8');
    throw err;
  }
  const summary = await readSizeSummary(cdp, result);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  fs.writeFileSync(evidenceJsonPath, JSON.stringify({ result, summary, screenshotPath }, null, 2), 'utf8');
  console.log(JSON.stringify({ result, summary, screenshotPath, evidenceJsonPath }, null, 2));

  if (result !== true) throw new Error('사이즈컷 생성 함수가 성공을 반환하지 않았습니다.');
  if (summary.sizeRunBusy) throw new Error('사이즈컷 busy 상태가 남았습니다.');
  if (summary.promptResults < 3 || summary.usable < 3) throw new Error(`사이즈컷 후보 수 부족: ${summary.promptResults}/${summary.usable}`);
  if (!summary.calls.length || summary.calls.some(call => !call.hasBase64 || call.stageId !== 'size' || !call.promptHasSize)) {
    throw new Error(`사이즈컷 생성 호출 입력 검증 실패: ${JSON.stringify(summary.calls)}`);
  }
  if (summary.assetSummaries.some(asset => !asset.hasImage || !asset.match?.ok)) {
    throw new Error('사이즈컷 후보의 이미지/현재 작업키 검증 실패');
  }
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
