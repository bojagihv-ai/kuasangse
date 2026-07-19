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
const screenshotPath = path.join(evidenceDir, 'factory-real-cuts-button-once-v90.png');
const evidenceJsonPath = path.join(evidenceDir, 'factory-real-cuts-button-once-v90.json');
const EXPECTED_CUT_COUNT = 4;
const TERMINAL_WAIT_MS = Number(process.env.KUASANGSE_REAL_CUTS_WAIT_MS || 600000);
const sampleImagePath = process.env.KUASANGSE_REAL_IMAGE_SAMPLE
  || path.resolve(__dirname, '..', 'output', 'local-archive', '2026-07-03', 'Codex원본보관검증', 'factory_local_run_mr4r1vzy_ftlh10', 'input-images', 'input', '184715_Codex원본보관검증_제품_원본_입력_이미지_factory_input_3751', 'image.png');

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withCommandTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} command timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function captureScreenshotEvidence(cdp) {
  try {
    const shot = await withCommandTimeout(
      cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }),
      15000,
      'screenshot'
    );
    fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    return { screenshotPath, screenshotError: '' };
  } catch (err) {
    return { screenshotPath: '', screenshotError: err?.message || String(err) };
  }
}

function assertSuccessfulSummary(summary) {
  if (summary.runBusy || summary.promptGenerating) throw new Error('버튼 실제 생성 뒤 busy/generating 상태가 남았습니다.');
  if (!summary.currentRunId || !summary.productKey || !summary.inputImageFingerprint || !summary.hasBaseImage) {
    throw new Error(`버튼 실제 생성의 작업 기준이 비어 있습니다: ${JSON.stringify({
      currentRunId: summary.currentRunId,
      productKey: summary.productKey,
      inputImageFingerprint: summary.inputImageFingerprint,
      hasBaseImage: summary.hasBaseImage,
    })}`);
  }
  if (summary.promptResults < EXPECTED_CUT_COUNT || summary.usable < EXPECTED_CUT_COUNT || !summary.hasResultImage) {
    throw new Error(`버튼 실제 생성 후보가 남지 않았습니다: ${JSON.stringify(summary)}`);
  }
  if ((summary.assets || []).slice(0, EXPECTED_CUT_COUNT).some(asset => !asset.hasImage || !asset.match?.ok)) {
    throw new Error('버튼 실제 생성 후보의 이미지/현재 작업키 검증 실패');
  }
}

const summaryExpression = `(() => {
  const factory = factoryState();
  const stage = factory.stages.cuts || {};
  const usable = factoryUsableAssetsForStage('cuts', factory);
  const first = usable[0] || null;
  const prompts = state.cuts?.prompts || [];
  const currentRunId = typeof factoryCurrentWorkflowRunId === 'function' ? factoryCurrentWorkflowRunId(factory) : '';
  const productKey = typeof factoryCurrentProductKey === 'function' ? factoryCurrentProductKey(factory) : '';
  const inputImageFingerprint = typeof factoryCurrentInputImageFingerprint === 'function' ? factoryCurrentInputImageFingerprint(factory) : '';
  return {
    status: stage.status || '',
    message: stage.message || '',
    currentRunId,
    productKey,
    inputImageFingerprint,
    hasBaseImage: !!(factory?.product?.imageBase64 || state.imageBase64),
    expectedItemCount: Number(stage.expectedItemCount || stage.targetCount || prompts.length || 0),
    completedItemCount: Number(stage.completedItemCount || 0),
    usable: usable.length,
    promptCount: prompts.length,
    promptResults: prompts.filter(prompt => !!prompt?.result).length,
    promptErrors: prompts.map((prompt, index) => ({ index: index + 1, error: String(prompt?.error || '') })).filter(item => item.error),
    runBusy: !!state.cuts?.runBusy,
    promptGenerating: prompts.filter(prompt => prompt?.generating).length,
    hasResultImage: !!prompts?.[0]?.result,
    firstPromptError: String(prompts?.[0]?.error || ''),
    resultImagePrefix: String(prompts?.[0]?.result || '').slice(0, 30),
    asset: first ? {
      id: first.id,
      title: first.title,
      hasImage: !!factoryAssetDisplayImage(first),
      match: factoryAssetMatchesCurrentJob(first, 'cuts', factory),
    } : null,
    assets: usable.map(asset => ({
      id: asset.id,
      title: asset.title,
      archiveId: asset.archiveId || asset.localArchiveId || '',
      imageUrl: asset.imageUrl || asset.url || asset.src || '',
      imageLen: String(asset.image || asset.imageBase64 || asset.dataUrl || '').length,
      hasImage: !!factoryAssetDisplayImage(asset),
      match: factoryAssetMatchesCurrentJob(asset, 'cuts', factory),
    })),
    lastLogs: (state.cuts?.runLogs || []).slice(-10).map(log => log?.message || log),
  };
})()`;

async function readSummary(cdp, timeoutMs = 5000) {
  return withCommandTimeout(evaluate(cdp, summaryExpression), timeoutMs, 'summary');
}

async function waitForTerminalSummary(cdp, timeoutMs = 180000) {
  const started = Date.now();
  let lastSummary = null;
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      lastSummary = await readSummary(cdp, 5000);
      const terminalSuccess = !lastSummary.runBusy
        && !lastSummary.promptGenerating
        && lastSummary.usable >= EXPECTED_CUT_COUNT
        && lastSummary.promptResults >= EXPECTED_CUT_COUNT
        && (lastSummary.assets || []).slice(0, EXPECTED_CUT_COUNT).every(asset => asset.hasImage && asset.match?.ok);
      const terminalFailure = !lastSummary.runBusy && !lastSummary.promptGenerating && (
        /error|blocked/i.test(lastSummary.status || '') ||
        !!lastSummary.firstPromptError ||
        (lastSummary.promptErrors || []).length > 0 ||
        /실패|초과|중단|찾지 못|비어|quota|오류|error|abort|timeout/i.test(`${lastSummary.message || ''} ${(lastSummary.lastLogs || []).join(' ')}`)
      );
      if (terminalSuccess || terminalFailure) return lastSummary;
    } catch (err) {
      lastError = err;
    }
    await delay(1000);
  }
  try {
    const finalSummary = await readSummary(cdp, 30000);
    if (finalSummary) return finalSummary;
  } catch (err) {
    lastError = err;
  }
  if (lastSummary) return lastSummary;
  throw lastError || new Error('terminal summary timeout');
}

(async () => {
  console.error(`[verify-v90] start expected=${EXPECTED_CUT_COUNT}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (!fs.existsSync(sampleImagePath)) throw new Error(`sample image not found: ${sampleImagePath}`);
  const inputBase64 = fs.readFileSync(sampleImagePath).toString('base64');
  console.error(`[verify-v90] sample=${sampleImagePath} bytes=${inputBase64.length}`);
  const cdpRuntime = await ensureCdp(CDP_URL);
  console.error(`[verify-v90] cdp-ready targets=${cdpRuntime.targets?.length || 0}`);
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
  const url = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}verify=v90_${Date.now()}`;
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `typeof render === 'function' && typeof factoryStampLockedInputImage === 'function'`, 30000);
  console.error(`[verify-v90] page-ready ${url}`);

  const setup = await callInPage(cdp, ({ inputBase64, expectedCutCount }) => {
    const productName = '버튼실제생성검증띠수네모동전지갑';
    const sourceUrl = `data:image/png;base64,${inputBase64}`;
    state.step = 'imagecuts';
    state.backendBaseUrl = 'http://127.0.0.1:5050';
    state.modelConfig = state.modelConfig || {};
    state.modelConfig.imageModel = 'gemini-3.1-flash-image';
    state.productName = productName;
    state.imageBase64 = inputBase64;
    state.imageMime = 'image/png';
    state.imagePreview = sourceUrl;
    state.imageName = '버튼실제생성검증_현재제품.png';
    state.cuts = state.cuts || {};
    const factory = factoryState();
    factory.activeTab = 'assets';
    factory.activeStage = 'cuts';
    factory.product.productName = productName;
    factory.product.naturalHint = '동전지갑';
    factory.stages.cuts = {
      ...(factory.stages.cuts || {}),
      targetCount: expectedCutCount,
      selectedAssetIds: [],
      status: 'idle',
      message: '버튼 실제 4컷 생성 검증 준비',
    };
    factory.assets = (factory.assets || []).filter(asset => asset.stageId !== 'cuts');
    factoryStampLockedInputImage(factory, {
      base64: inputBase64,
      mime: 'image/png',
      preview: sourceUrl,
      name: '버튼실제생성검증_현재제품.png',
    }, { id: 'verify_real_button_input_v90' });
    state.cuts.factoryStageId = 'cuts';
    state.cuts.promptSlotCount = expectedCutCount;
    const prompts = [
      {
        label: '흰 배경 기본컷',
        prompt: '현재 업로드된 동전지갑 제품만 사용해서 흰 배경의 선명한 상품 이미지컷을 생성. 이전 보자기, 수저집, 다른 상품은 절대 사용하지 말 것.',
      },
      {
        label: '생활 소품 배경컷',
        prompt: '현재 업로드된 동전지갑 제품만 사용해서 밝은 생활 소품 배경의 상품 이미지컷을 생성. 이전 보자기, 수저집, 다른 상품은 절대 사용하지 말 것.',
      },
      {
        label: '근접 디테일컷',
        prompt: '현재 업로드된 동전지갑 제품만 사용해서 자수와 지퍼 디테일이 보이는 근접 이미지컷을 생성. 이전 보자기, 수저집, 다른 상품은 절대 사용하지 말 것.',
      },
      {
        label: '상세페이지 배치컷',
        prompt: '현재 업로드된 동전지갑 제품만 사용해서 쇼핑몰 상세페이지 중간에 넣기 좋은 정돈된 이미지컷을 생성. 이전 보자기, 수저집, 다른 상품은 절대 사용하지 말 것.',
      },
    ];
    state.cuts.prompts = prompts.slice(0, expectedCutCount).map((item, index) => (
      stampCutPromptSource({
        id: `verify_real_button_cut_${index + 1}`,
        label: item.label,
        prompt: item.prompt,
        result: null,
        generating: false,
        error: '',
        warning: '',
        factoryStageId: 'cuts',
        stageId: 'cuts',
      }, 'cuts')
    ));
    if (typeof factorySyncCutsSourceToCurrentProduct === 'function') {
      factorySyncCutsSourceToCurrentProduct('cuts', { log: false });
    }
    saveLastWorkNow();
    render();
    return {
      imageReady: hasImageConnection(),
      backendBaseUrl: state.backendBaseUrl,
      imageModel: state.modelConfig.imageModel,
      currentRunId: factoryCurrentWorkflowRunId(factory),
      productKey: factoryCurrentProductKey(factory),
      inputKey: factoryCurrentInputImageFingerprint(factory),
      buttonExists: !!document.getElementById('genAllCutsBtn'),
      buttonDisabled: !!document.getElementById('genAllCutsBtn')?.disabled,
      buttonTitle: document.getElementById('genAllCutsBtn')?.getAttribute('title') || '',
    };
  }, { inputBase64, expectedCutCount: EXPECTED_CUT_COUNT });

  if (!setup.buttonExists) throw new Error('이미지컷 전체 생성 버튼을 찾지 못했습니다.');
  if (setup.buttonDisabled) throw new Error(`이미지컷 전체 생성 버튼이 비활성입니다: ${setup.buttonTitle}`);
  console.error(`[verify-v90] setup=${JSON.stringify(setup)}`);

  const started = Date.now();
  await evaluate(cdp, `document.getElementById('genAllCutsBtn').click(); true`);
  console.error('[verify-v90] clicked genAllCutsBtn');
  const summary = await waitForTerminalSummary(cdp, TERMINAL_WAIT_MS);
  console.error(`[verify-v90] terminal=${JSON.stringify({
    usable: summary.usable,
    promptResults: summary.promptResults,
    runBusy: summary.runBusy,
    promptGenerating: summary.promptGenerating,
    status: summary.status,
    message: summary.message,
  })}`);

  assertSuccessfulSummary(summary);
  const screenshot = await captureScreenshotEvidence(cdp);
  const evidence = { expectedCutCount: EXPECTED_CUT_COUNT, setup, elapsedMs: Date.now() - started, summary, ...screenshot };
  fs.writeFileSync(evidenceJsonPath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify({ ...evidence, evidenceJsonPath }, null, 2));

  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
