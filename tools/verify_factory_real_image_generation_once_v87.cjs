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
const screenshotPath = path.join(evidenceDir, 'factory-real-image-generation-once-v87.png');
const sampleImagePath = process.env.KUASANGSE_REAL_IMAGE_SAMPLE
  || path.resolve(__dirname, '..', 'output', 'local-archive', '2026-07-03', 'Codex원본보관검증', 'factory_local_run_mr4r1vzy_ftlh10', 'input-images', 'input', '184715_Codex원본보관검증_제품_원본_입력_이미지_factory_input_3751', 'image.png');

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (!fs.existsSync(sampleImagePath)) throw new Error(`sample image not found: ${sampleImagePath}`);
  const inputBase64 = fs.readFileSync(sampleImagePath).toString('base64');
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
  await waitFor(cdp, `typeof factoryGenerateImageCutsBackedStage === 'function' && typeof factoryStampLockedInputImage === 'function'`, 30000);

  const setup = await callInPage(cdp, ({ inputBase64 }) => {
    const productName = '실제생성검증띠수네모동전지갑';
    const sourceUrl = `data:image/png;base64,${inputBase64}`;
    state.step = 'factory';
    state.backendBaseUrl = 'http://127.0.0.1:5050';
    state.modelConfig = state.modelConfig || {};
    state.modelConfig.imageModel = 'gemini-3.1-flash-image';
    state.productName = productName;
    state.imageBase64 = inputBase64;
    state.imageMime = 'image/png';
    state.imagePreview = sourceUrl;
    state.imageName = '실제생성검증_현재제품.png';
    state.cuts = state.cuts || {};
    const factory = factoryState();
    factory.activeTab = 'assets';
    factory.activeStage = 'cuts';
    factory.product.productName = productName;
    factory.product.naturalHint = '동전지갑';
    factory.stages.cuts = {
      ...(factory.stages.cuts || {}),
      targetCount: 1,
      selectedAssetIds: [],
      status: 'idle',
      message: '실제 생성 검증 준비',
    };
    factory.assets = (factory.assets || []).filter(asset => asset.stageId !== 'cuts');
    factoryStampLockedInputImage(factory, {
      base64: inputBase64,
      mime: 'image/png',
      preview: sourceUrl,
      name: '실제생성검증_현재제품.png',
    }, { id: 'verify_real_input_v87' });
    state.cuts.factoryStageId = 'cuts';
    state.cuts.promptSlotCount = 1;
    state.cuts.prompts = [
      stampCutPromptSource({
        id: 'verify_real_cut_1',
        label: '실제 API 검증 컷',
        prompt: '현재 업로드된 동전지갑 제품만 사용해서 흰 배경의 선명한 상품 컷 1장을 생성. 다른 상품이나 이전 보자기 이미지는 절대 사용하지 말 것.',
        result: null,
        generating: false,
        error: '',
        warning: '',
        factoryStageId: 'cuts',
        stageId: 'cuts',
      }, 'cuts')
    ];
    saveLastWorkNow();
    render();
    return {
      imageReady: hasImageConnection(),
      backendBaseUrl: state.backendBaseUrl,
      imageModel: state.modelConfig.imageModel,
      inputKey: factoryCurrentInputImageFingerprint(factory),
    };
  }, { inputBase64 });

  const started = Date.now();
  const result = await evaluate(cdp, `factoryGenerateImageCutsBackedStage('cuts')`);
  await waitFor(cdp, `(() => {
    const stage = factoryState().stages.cuts || {};
    const usable = factoryUsableAssetsForStage('cuts', factoryState()).length;
    return !state.cuts?.runBusy && ['done', 'review'].includes(stage.status) && usable >= 1;
  })()`, 180000);
  const summary = await evaluate(cdp, `(() => {
    const factory = factoryState();
    const stage = factory.stages.cuts || {};
    const usable = factoryUsableAssetsForStage('cuts', factory);
    const first = usable[0] || null;
    return {
      status: stage.status || '',
      message: stage.message || '',
      usable: usable.length,
      promptResults: (state.cuts?.prompts || []).filter(prompt => !!prompt?.result).length,
      runBusy: !!state.cuts?.runBusy,
      promptGenerating: (state.cuts?.prompts || []).filter(prompt => prompt?.generating).length,
      hasResultImage: !!state.cuts?.prompts?.[0]?.result,
      resultImagePrefix: String(state.cuts?.prompts?.[0]?.result || '').slice(0, 30),
      asset: first ? {
        id: first.id,
        title: first.title,
        hasImage: !!factoryAssetDisplayImage(first),
        match: factoryAssetMatchesCurrentJob(first, 'cuts', factory),
      } : null,
      lastLogs: (state.cuts?.runLogs || []).slice(-8).map(log => log?.message || log),
    };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ result, setup, elapsedMs: Date.now() - started, summary, screenshotPath }, null, 2));

  if (result !== true) throw new Error('실제 이미지컷 생성 함수가 성공을 반환하지 않았습니다.');
  if (summary.runBusy || summary.promptGenerating) throw new Error('실제 생성 뒤 busy/generating 상태가 남았습니다.');
  if (summary.promptResults < 1 || summary.usable < 1 || !summary.hasResultImage) {
    throw new Error(`실제 생성 후보가 남지 않았습니다: ${JSON.stringify(summary)}`);
  }
  if (!summary.asset?.hasImage || !summary.asset?.match?.ok) {
    throw new Error('실제 생성 후보의 이미지/현재 작업키 검증 실패');
  }
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
