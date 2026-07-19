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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const RUN_LABEL = String(process.env.KUASANGSE_REAL_VERTEX_RUN_LABEL || 'v120').replace(/[^a-z0-9_-]/gi, '-');
const EVIDENCE_JSON = path.join(OUT_DIR, `factory-real-vertex-one-each-${RUN_LABEL}.json`);
const sampleImagePath = process.env.KUASANGSE_REAL_IMAGE_SAMPLE
  || path.resolve(__dirname, '..', 'output', 'local-archive', '2026-07-03', 'Codex원본보관검증', 'factory_local_run_mr4r1vzy_ftlh10', 'input-images', 'input', '184715_Codex원본보관검증_제품_원본_입력_이미지_factory_input_3751', 'image.png');

const STAGES = (process.env.KUASANGSE_REAL_VERTEX_STAGES || 'hero,size,cuts')
  .split(',')
  .map(stage => stage.trim())
  .filter(stage => ['hero', 'size', 'cuts'].includes(stage));

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

async function screenshot(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

function stageExpression(stageId) {
  return `(() => {
    const stageId = ${JSON.stringify(stageId)};
    const factory = window.factoryState?.() || {};
    const stage = factory.stages?.[stageId] || {};
    const goal = factory.goalRun || {};
    const prompts = stageId === 'size' ? (window.state?.cuts?.sizePrompts || []) : (window.state?.cuts?.prompts || []);
    const usable = (factory.assets || []).filter(asset => asset?.stageId === stageId);
    const assets = usable.map(asset => ({
      id: asset.id || '',
      title: asset.title || '',
      stageId: asset.stageId || '',
      currentRunId: asset.currentRunId || asset.metadata?.currentRunId || asset.sourceMap?.currentRunId || '',
      generationRunId: asset.generationRunId || asset.metadata?.generationRunId || asset.sourceMap?.generationRunId || '',
      productKey: asset.productKey || asset.metadata?.productKey || asset.sourceMap?.productKey || '',
      inputImageFingerprint: asset.inputImageFingerprint || asset.metadata?.inputImageFingerprint || asset.sourceMap?.inputImageFingerprint || '',
      localArchiveId: asset.localArchiveId || asset.archiveId || asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId || '',
      imageUrl: asset.imageUrl || asset.metadata?.imageUrl || asset.sourceMap?.imageUrl || '',
      hasImage: !!(
        asset.image ||
        asset.imageUrl ||
        asset.localArchiveId ||
        asset.archiveId ||
        asset.metadata?.imageUrl ||
        asset.metadata?.localArchiveId ||
        asset.sourceMap?.imageUrl ||
        asset.sourceMap?.localArchiveId
      ),
      match: typeof window.factoryAssetMatchesCurrentJob === 'function'
        ? window.factoryAssetMatchesCurrentJob(asset, stageId, factory)
        : { ok: true, mismatches: [] },
    }));
    const panel = document.querySelector('#factoryAutomationAssetChooser_' + stageId);
    const status = document.querySelector('[data-factory-goal-status]');
    return {
      stageId,
      status: stage.status || '',
      message: stage.message || '',
      expectedItemCount: Number(stage.expectedItemCount || stage.targetCount || prompts.length || 0),
      completedItemCount: Number(stage.completedItemCount || 0),
      usable: usable.length,
      promptResults: prompts.filter(prompt => !!prompt?.result).length,
      promptGenerating: prompts.filter(prompt => !!prompt?.generating).length,
      runBusy: stageId === 'size' ? !!window.state?.cuts?.sizeRunBusy : !!window.state?.cuts?.runBusy,
      firstPromptError: String(prompts?.[0]?.error || ''),
      firstPromptResultPrefix: String(prompts?.[0]?.result || '').slice(0, 80),
      assets,
      currentRunId: typeof window.factoryCurrentStageRunId === 'function' ? window.factoryCurrentStageRunId(stageId, factory) : '',
      workflowRunId: typeof window.factoryCurrentWorkflowRunId === 'function' ? window.factoryCurrentWorkflowRunId(factory) : '',
      productKey: typeof window.factoryCurrentProductKey === 'function' ? window.factoryCurrentProductKey(factory) : '',
      inputImageFingerprint: typeof window.factoryCurrentInputImageFingerprint === 'function' ? window.factoryCurrentInputImageFingerprint(factory) : '',
      goal: {
        running: !!goal.running,
        progress: Number(goal.progress || 0),
        currentStage: String(goal.currentStage || ''),
        failureReason: String(goal.failureReason || ''),
      },
      statusTitle: String(status?.querySelector('[data-factory-goal-title]')?.textContent || '').trim(),
      statusPill: String(status?.querySelector('[data-factory-goal-pill]')?.textContent || '').trim(),
      statusFailure: String(status?.querySelector('[data-factory-goal-failure]')?.textContent || '').trim(),
      panelText: String(panel?.innerText || '').slice(0, 1200),
      cutsLogs: (window.state?.cuts?.runLogs || []).slice(-12).map(log => ({
        message: log?.message || String(log || ''),
        status: log?.status || log?.level || '',
        detail: log?.detail || '',
      })),
      factoryLogs: (factory.logs || []).slice(-20).map(log => log?.message || log?.text || String(log || '')),
    };
  })()`;
}

async function readStage(cdp, stageId) {
  return evaluate(cdp, stageExpression(stageId));
}

function quickStageExpression(stageId) {
  return `(() => {
    const stageId = ${JSON.stringify(stageId)};
    const factory = window.factoryState?.() || {};
    const stage = factory.stages?.[stageId] || {};
    const goal = factory.goalRun || {};
    const prompts = stageId === 'size' ? (window.state?.cuts?.sizePrompts || []) : (window.state?.cuts?.prompts || []);
    const assets = (factory.assets || []).filter(asset => asset?.stageId === stageId);
    return {
      status: stage.status || '',
      message: stage.message || '',
      assetCount: assets.length,
      promptResults: prompts.filter(prompt => !!prompt?.result).length,
      promptGenerating: prompts.filter(prompt => !!prompt?.generating).length,
      runBusy: stageId === 'size' ? !!window.state?.cuts?.sizeRunBusy : !!window.state?.cuts?.runBusy,
      goalRunning: !!goal.running,
      goalFailure: String(goal.failureReason || ''),
    };
  })()`;
}

async function runStage(cdp, stageId) {
  const click = await evaluate(cdp, `(() => {
    const stageId = ${JSON.stringify(stageId)};
    const factory = window.factoryState?.();
    if (!factory) throw new Error('factory state not available');
    factory.goalRun = {
      ...(factory.goalRun || {}),
      running: false,
      progress: 80,
      currentStage: '이전 실행 확인 필요',
      failureReason: '이전 실행이 끝까지 마무리되지 않았습니다. 필요한 항목만 다시 실행하세요.',
      activeOperationId: '',
    };
    window.render();
    const panel = document.querySelector('#factoryAutomationAssetChooser_' + stageId);
    if (panel) panel.scrollIntoView({ block: 'center', inline: 'nearest' });
    const button = panel?.querySelector('[data-factory-run-stage]');
    if (!button) throw new Error(stageId + ' user button not found');
    if (button.disabled) throw new Error(stageId + ' user button unexpectedly disabled');
    button.click();
    return { clicked: true, buttonText: String(button.textContent || '').trim() };
  })()`);
  await waitFor(cdp, `(() => {
    const s = (${stageExpression(stageId)});
    return s.status === 'running' || s.promptGenerating > 0 || s.runBusy;
  })()`, 15000);
  const running = await readStage(cdp, stageId);
  const runningScreenshot = await screenshot(cdp, `factory-real-vertex-${stageId}-running-${RUN_LABEL}.png`);
  let waitError = '';
  const waitMs = Number(process.env.KUASANGSE_REAL_VERTEX_STAGE_WAIT_MS || 360000);
  const waitStartedAt = Date.now();
  let lastLogAt = 0;
  let lastQuick = null;
  while (Date.now() - waitStartedAt < waitMs) {
    lastQuick = await evaluate(cdp, quickStageExpression(stageId)).catch(error => ({
      evalError: error?.message || String(error),
    }));
    const terminalSuccess = lastQuick.assetCount >= 1 && lastQuick.promptResults >= 1 &&
      !lastQuick.runBusy && lastQuick.promptGenerating === 0 &&
      !lastQuick.goalRunning && !lastQuick.goalFailure;
    const terminalFailure = (['error', 'blocked'].includes(lastQuick.status) && !lastQuick.runBusy && lastQuick.promptGenerating === 0) ||
      (!lastQuick.goalRunning && !!lastQuick.goalFailure);
    if (terminalSuccess || terminalFailure) break;
    if (Date.now() - lastLogAt > 10000) {
      lastLogAt = Date.now();
      console.error(`[${RUN_LABEL}] ${stageId} wait ${Math.round((Date.now() - waitStartedAt) / 1000)}s ${JSON.stringify(lastQuick)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  if (Date.now() - waitStartedAt >= waitMs) {
    waitError = `stage wait timeout after ${waitMs}ms: ${JSON.stringify(lastQuick)}`;
  }
  const finished = await readStage(cdp, stageId).catch(error => ({ stageId, readError: error?.message || String(error) }));
  const finishedScreenshot = await screenshot(cdp, `factory-real-vertex-${stageId}-finished-${RUN_LABEL}.png`).catch(error => `screenshot-error: ${error?.message || error}`);
  return { click, running, runningScreenshot, waitError, finished, finishedScreenshot };
}

let activeCdp = null;
let activeCdpRuntime = null;

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(sampleImagePath)) throw new Error(`sample image not found: ${sampleImagePath}`);
  const inputBase64 = fs.readFileSync(sampleImagePath).toString('base64');
  const cdpRuntime = await ensureCdp(CDP_URL);
  activeCdpRuntime = cdpRuntime;
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  activeCdp = cdp;
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const url = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}verify=real_vertex_one_each_v120_${Date.now()}`;
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `typeof window.render === 'function' && typeof window.factoryGenerateImageCutsBackedStage === 'function' && typeof window.factoryStampLockedInputImage === 'function'`, 60000);

  const setup = await callInPage(cdp, ({ inputBase64, stages }) => {
    const requestedStages = Array.isArray(stages) ? stages : [];
    const productName = 'Vertex실제1장검증띠수네모동전지갑';
    const sourceUrl = `data:image/png;base64,${inputBase64}`;
    window.state.step = 'factory';
    window.state.backendBaseUrl = 'http://127.0.0.1:5050';
    window.state.modelConfig = window.state.modelConfig || {};
    window.state.modelConfig.imageModel = 'gemini-3.1-flash-image';
    window.state.productName = productName;
    window.state.imageBase64 = inputBase64;
    window.state.imageMime = 'image/png';
    window.state.imagePreview = sourceUrl;
    window.state.imageName = 'vertex-real-one-each-input.png';
    window.state.productInfoManualValues = {
      product_name: productName,
      size_spec: '가로 10.4cm x 세로 8.3cm',
      width_mm: '10.4cm',
      depth_mm: '8.3cm',
      weight: '14g',
    };
    window.state.cuts = window.state.cuts || {};
    const factory = window.factoryState();
    factory.activeTab = 'assets';
    factory.product = factory.product || {};
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.naturalHint = '동전지갑';
    factory.product.finalDb = {
      ...(factory.product.finalDb || {}),
      product_name: productName,
      size_spec: '가로 10.4cm x 세로 8.3cm',
      width_mm: '10.4cm',
      depth_mm: '8.3cm',
      weight: '14g',
    };
    factory.product.dbSizeManualDrafts = {
      size_spec: '가로 10.4cm x 세로 8.3cm',
      width_mm: '10.4cm',
      depth_mm: '8.3cm',
      weight: '14g',
    };
    factory.product.dbSizeManualValues = {
      size_spec: '가로 10.4cm x 세로 8.3cm',
      width_mm: '10.4cm',
      depth_mm: '8.3cm',
      weight: '14g',
    };
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
    factory.automation = factory.automation || {};
    factory.automation.activeTab = 'assets';
    factory.goalRun = {
      ...(factory.goalRun || {}),
      running: false,
      progress: 80,
      currentStage: '이전 실행 확인 필요',
      failureReason: '이전 실행이 끝까지 마무리되지 않았습니다. 필요한 항목만 다시 실행하세요.',
      activeOperationId: '',
    };
    factory.stages = factory.stages || {};
    ['hero', 'size', 'cuts'].forEach(stageId => {
      factory.stages[stageId] = {
        ...(factory.stages[stageId] || {}),
        targetCount: 1,
        selectedAssetIds: [],
        status: 'idle',
        message: 'Vertex 실제 1장 검증 준비',
      };
    });
    factory.assets = (factory.assets || []).filter(asset => !['hero', 'size', 'cuts'].includes(asset?.stageId));
    window.factoryStampLockedInputImage(factory, {
      base64: inputBase64,
      mime: 'image/png',
      preview: sourceUrl,
      name: 'vertex-real-one-each-input.png',
    }, { id: 'verify_real_vertex_one_each_input_v120' });
    window.state.cuts.factoryStageId = 'cuts';
    window.state.cuts.sizeFactoryStageId = 'size';
    window.state.cuts.promptSlotCount = 1;
    window.state.cuts.sizePromptSlotCount = 1;
    const realCutPrompt = {
      id: 'verify_real_vertex_cut_1',
      label: 'Vertex 실제 이미지컷 1장',
      prompt: '현재 업로드된 동전지갑 제품만 사용해서 흰 배경의 선명한 상품 컷 1장을 생성. 다른 상품이나 이전 보자기 이미지는 절대 사용하지 말 것.',
      result: null,
      generating: false,
      error: '',
      warning: '',
      factoryStageId: 'cuts',
      stageId: 'cuts',
    };
    const stampFn = typeof window.stampCutPromptSource === 'function'
      ? window.stampCutPromptSource
      : (typeof stampCutPromptSource === 'function' ? stampCutPromptSource : null);
    window.state.cuts.prompts = requestedStages.includes('cuts')
      ? [(stampFn ? stampFn(realCutPrompt, 'cuts') : realCutPrompt)]
      : [];
    window.state.cuts.sizePrompts = [];
    window.state.cuts.runBusy = false;
    window.state.cuts.sizeRunBusy = false;
    if (typeof window.factorySyncDbSizeManualValue === 'function') {
      window.factorySyncDbSizeManualValue('size_spec', '가로 10.4cm x 세로 8.3cm', factory);
      window.factorySyncDbSizeManualValue('width_mm', '10.4cm', factory);
      window.factorySyncDbSizeManualValue('depth_mm', '8.3cm', factory);
      window.factorySyncDbSizeManualValue('weight', '14g', factory);
    }
    if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(factory);
    window.saveLastWorkNow?.();
    window.render();
    return {
      imageReady: window.hasImageConnection?.() || false,
      provider: window.getCurrentImageRunInfo?.() || null,
      backendBaseUrl: window.state.backendBaseUrl,
      model: window.state.modelConfig.imageModel,
      productKey: window.factoryCurrentProductKey?.(factory) || '',
      inputImageFingerprint: window.factoryCurrentInputImageFingerprint?.(factory) || '',
      hasSizeFacts: window.factoryHasSizeFacts?.() || false,
    };
  }, { inputBase64, stages: STAGES });

  const beforeScreenshot = await screenshot(cdp, `factory-real-vertex-before-${RUN_LABEL}.png`);
  const startedAt = Date.now();
  const stageResults = {};
  for (const stageId of STAGES) {
    stageResults[stageId] = await runStage(cdp, stageId);
  }
  const finalState = await evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    return {
      elapsedMs: Date.now() - ${startedAt},
      totalAssets: (factory.assets || []).filter(asset => ['hero', 'size', 'cuts'].includes(asset?.stageId)).length,
      logs: (factory.logs || []).slice(-30).map(log => log?.message || log?.text || String(log || '')),
      archiveAssets: (factory.assets || [])
        .filter(asset => ['hero', 'size', 'cuts'].includes(asset?.stageId))
        .map(asset => ({
          id: asset.id || '',
          stageId: asset.stageId || '',
          archiveId: asset.archiveId || asset.localArchiveId || asset.metadata?.localArchiveId || '',
          imageUrl: asset.imageUrl || asset.metadata?.imageUrl || '',
        })),
    };
  })()`);
  const evidence = { url, sampleImagePath, setup, beforeScreenshot, stageResults, finalState };
  fs.writeFileSync(EVIDENCE_JSON, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify({ ...evidence, evidenceJson: EVIDENCE_JSON }, null, 2));

  const checks = [
    { ok: setup.imageReady === true, message: `이미지 연결 준비 실패: ${JSON.stringify(setup.provider)}` },
    { ok: /vertex/i.test(String(setup.provider?.route || setup.provider?.providerLabel || setup.provider?.providerId || '')) || setup.provider?.modelId || setup.model, message: `Vertex/이미지 모델 정보가 비어 있습니다: ${JSON.stringify(setup.provider)}` },
  ];
  for (const stageId of STAGES) {
    const result = stageResults[stageId];
    const finished = result.finished;
    checks.push({ ok: result.click?.clicked === true, message: `${stageId} 실제 생성 버튼 클릭 실패: ${JSON.stringify(result.click)}` });
    checks.push({ ok: ['done', 'review'].includes(finished.status), message: `${stageId} 상태 실패: ${finished.status} ${finished.message}` });
    checks.push({ ok: finished.usable >= 1 && finished.promptResults >= 1, message: `${stageId} 후보/프롬프트 결과 부족: ${finished.usable}/${finished.promptResults}` });
    checks.push({ ok: finished.runBusy === false && finished.promptGenerating === 0, message: `${stageId} busy/generating 잔류` });
    checks.push({ ok: finished.assets.length >= 1 && finished.assets[0].hasImage && finished.assets[0].localArchiveId && finished.assets[0].imageUrl, message: `${stageId} 이미지/아카이브 메타 누락: ${JSON.stringify(finished.assets[0] || null)}` });
    checks.push({ ok: finished.assets[0]?.match?.ok === true, message: `${stageId} 현재 작업키 불일치: ${JSON.stringify(finished.assets[0]?.match || null)}` });
    checks.push({
      ok: finished.goal?.running === false &&
        finished.goal?.progress === 100 &&
        !finished.goal?.failureReason &&
        !/실패/.test(`${finished.statusTitle} ${finished.statusPill} ${finished.statusFailure}`),
      message: `${stageId} 실제 버튼 완료가 이전 실패로 표시됨: ${JSON.stringify({ goal: finished.goal, title: finished.statusTitle, pill: finished.statusPill, failure: finished.statusFailure })}`,
    });
  }
  assertChecks(checks);
  cdp.close();
  activeCdp = null;
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
  activeCdpRuntime = null;
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  try { activeCdp?.close?.(); } catch (_) {}
  Promise.resolve(activeCdpRuntime?.cleanup?.()).finally(() => process.exit(1));
});
