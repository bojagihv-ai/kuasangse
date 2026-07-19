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
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');

function svgData(label, color = '#6366f1') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
  <rect width="960" height="720" fill="#f8fafc"/>
  <rect x="132" y="132" width="696" height="456" rx="48" fill="${color}"/>
  <text x="480" y="378" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function screenshot(cdp, fileName) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT_DIR, fileName);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

async function clickStageAndCapture(cdp, stageId) {
  await evaluate(cdp, `(() => {
    const panel = document.querySelector('#factoryAutomationAssetChooser_${stageId}');
    if (panel) panel.scrollIntoView({ block: 'center', inline: 'nearest' });
    const btn = panel?.querySelector('[data-factory-run-stage="${stageId}"]');
    if (!btn) throw new Error('${stageId} run button not found');
    btn.click();
    return true;
  })()`);
  await waitFor(
    cdp,
    `(() => {
      const factory = window.factoryState?.() || {};
      const stage = factory.stages?.${stageId === 'size' ? 'size' : stageId} || {};
      const panel = document.querySelector('#factoryAutomationAssetChooser_${stageId}');
      const panelText = panel?.innerText || '';
      if (stage.status !== 'running' || !/생성 중|생성중|요청됨|준비/.test(panelText)) return false;
      const prompts = ${stageId === 'size' ? 'window.state?.cuts?.sizePrompts || []' : 'window.state?.cuts?.prompts || []'};
      window.__factoryGenerationRunningSnapshotV119 = {
        stageId: '${stageId}',
        status: stage.status || '',
        message: stage.message || '',
        panelText: panelText.slice(0, 900),
        panelId: panel?.id || '',
        panelConnected: panel?.isConnected === true,
        panelMatchesTarget: panel === document.getElementById('factoryAutomationAssetChooser_${stageId}'),
        runningButtonText: panel?.querySelector('[data-factory-run-stage="${stageId}"]')?.innerText || '',
        generatingPromptCount: prompts.filter(item => item?.generating).length,
        sizeConfirmed: !!(factory.automation?.sizeImageDbConfirmedKey),
      };
      return true;
    })()`,
    10000
  );
  const running = await evaluate(cdp, `window.__factoryGenerationRunningSnapshotV119`);
  const runningScreenshot = await screenshot(cdp, `factory-generation-${stageId}-running-v119.png`);
  await waitFor(
    cdp,
    `(() => {
      const factory = window.factoryState?.() || {};
      const stage = factory.stages?.${stageId === 'size' ? 'size' : stageId} || {};
      const usable = typeof window.factoryUsableAssetsForStage === 'function'
        ? window.factoryUsableAssetsForStage('${stageId}', factory)
        : (factory.assets || []).filter(asset => asset?.stageId === '${stageId}');
      const prompts = ${stageId === 'size' ? 'window.state?.cuts?.sizePrompts || []' : 'window.state?.cuts?.prompts || []'};
      const promptGenerating = prompts.some(item => !!item?.generating);
      const runActive = typeof window.factoryImageStageHasActiveRun === 'function'
        ? window.factoryImageStageHasActiveRun('${stageId}', stage)
        : false;
      const messageLooksActive = /생성 중|응답 대기|요청|준비|처리 완료/.test(String(stage.message || ''));
      const failed = ['error', 'blocked'].includes(stage.status) && !promptGenerating && !runActive;
      return usable.length >= 1 || failed || (!promptGenerating && !runActive && stage.status && !messageLooksActive && stage.status !== 'running');
    })()`,
    90000
  );
  const finished = await evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    const assets = (factory.assets || []).filter(asset => asset?.stageId === '${stageId}');
    const usable = typeof window.factoryUsableAssetsForStage === 'function'
      ? window.factoryUsableAssetsForStage('${stageId}', factory)
      : assets;
    const stage = factory.stages?.${stageId === 'size' ? 'size' : stageId} || {};
    return {
      stageId: '${stageId}',
      status: stage.status || '',
      message: stage.message || '',
      usableCount: usable.length,
      assetCount: assets.length,
      assets: usable.map(asset => ({
        id: asset.id || '',
        title: asset.title || '',
        stageId: asset.stageId || '',
        workspaceId: asset.workspaceId || asset.metadata?.workspaceId || asset.sourceMap?.workspaceId || '',
        currentRunId: asset.currentRunId || asset.metadata?.currentRunId || asset.sourceMap?.currentRunId || '',
        generationRunId: asset.generationRunId || asset.metadata?.generationRunId || asset.sourceMap?.generationRunId || '',
        productKey: asset.productKey || asset.metadata?.productKey || asset.sourceMap?.productKey || '',
        inputImageFingerprint: asset.inputImageFingerprint || asset.metadata?.inputImageFingerprint || asset.sourceMap?.inputImageFingerprint || '',
        localArchiveId: asset.localArchiveId || asset.archiveId || asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId || '',
        imageUrl: asset.imageUrl || asset.metadata?.imageUrl || asset.sourceMap?.imageUrl || '',
      })),
    };
  })()`);
  const finishedScreenshot = await screenshot(cdp, `factory-generation-${stageId}-finished-v119.png`);
  return { running, runningScreenshot, finished, finishedScreenshot };
}

async function runDirectStageWithStaleGoalAndCapture(cdp, stageId) {
  const result = await evaluate(cdp, `(async () => {
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
    const runResult = await window.factoryRunStage(${JSON.stringify(stageId)});
    const done = window.factoryState?.() || {};
    const goal = done.goalRun || {};
    const stage = done.stages?.[${JSON.stringify(stageId)}] || {};
    const status = document.querySelector('[data-factory-goal-status]');
    return {
      runResult,
      stage: {
        status: stage.status || '',
        message: stage.message || '',
      },
      goal: {
        running: !!goal.running,
        progress: Number(goal.progress || 0),
        currentStage: goal.currentStage || '',
        failureReason: goal.failureReason || '',
      },
      statusTitle: status?.querySelector('[data-factory-goal-title]')?.textContent?.trim() || '',
      statusPill: status?.querySelector('[data-factory-goal-pill]')?.textContent?.trim() || '',
      statusFailure: status?.querySelector('[data-factory-goal-failure]')?.textContent?.trim() || '',
    };
  })()`);
  const finishedScreenshot = await screenshot(cdp, `factory-generation-direct-${stageId}-finished-v119.png`);
  return { result, finishedScreenshot };
}

async function clickStartAndCapture(cdp) {
  const setup = await evaluate(cdp, `(() => {
    const factory = window.factoryState?.();
    if (!factory) throw new Error('factory state not available');
    const calls = [];
    window.__factoryStartButtonV119 = { calls };
    window.factoryEnsureCurrentProductImageAnalysisForOneClick = async () => {
      calls.push('analysis');
      return { ok: true };
    };
    window.factoryRunDbCandidatesForSelection = async () => {
      calls.push('db');
      return { ok: true, label: 'DB 후보 수집' };
    };
    window.factoryRunVmCompetitorCollectionForSelection = async () => {
      calls.push('vm');
      return { ok: true, label: '경쟁사 후보 수집' };
    };
    factory.automation = factory.automation || {};
    factory.automation.activeTab = 'start';
    factory.automation.startRunCounts = {
      ...(factory.automation.startRunCounts || {}),
      hero: 1,
      cuts: 1,
      competitors: 0,
    };
    factory.goalRun = {
      ...(factory.goalRun || {}),
      running: false,
      progress: 80,
      currentStage: '이전 실행 확인 필요',
      failureReason: '이전 실행이 끝까지 마무리되지 않았습니다. 필요한 항목만 다시 실행하세요.',
      activeOperationId: '',
    };
    window.render();
    const button = document.getElementById('factoryRunDb');
    if (!button) throw new Error('start button not found');
    if (button.disabled) throw new Error('start button unexpectedly disabled');
    const aliases = {
      analysis: window.factoryEnsureCurrentProductImageAnalysisForOneClick === factoryEnsureCurrentProductImageAnalysisForOneClick,
      db: window.factoryRunDbCandidatesForSelection === factoryRunDbCandidatesForSelection,
      vm: window.factoryRunVmCompetitorCollectionForSelection === factoryRunVmCompetitorCollectionForSelection,
    };
    button.click();
    return { aliases, buttonText: String(button.textContent || '').trim() };
  })()`);
  await waitFor(cdp, `(() => {
    const goal = window.factoryState?.().goalRun || {};
    return !!goal.running;
  })()`, 10000);
  const runningScreenshot = await screenshot(cdp, 'factory-generation-start-running-v119.png');
  try {
    await waitFor(cdp, `(() => {
      const factory = window.factoryState?.() || {};
      const goal = factory.goalRun || {};
      const hasCurrentAsset = stageId => (factory.assets || []).some(asset =>
        asset?.stageId === stageId && window.factoryAssetMatchesCurrentJob?.(asset, stageId, factory)?.ok
      );
      return !goal.running && !goal.failureReason && hasCurrentAsset('hero') && hasCurrentAsset('cuts');
    })()`, 30000);
  } catch (error) {
    const diagnostic = await evaluate(cdp, `(() => {
      const factory = window.factoryState?.() || {};
      const summarize = stageId => ({
        stage: factory.stages?.[stageId] || {},
        assets: (factory.assets || []).filter(asset => asset?.stageId === stageId).map(asset => ({
          id: asset.id || '',
          matches: window.factoryAssetMatchesCurrentJob?.(asset, stageId, factory) || null,
        })),
      });
      return {
        calls: window.__factoryStartButtonV119?.calls || [],
        goal: factory.goalRun || {},
        hero: summarize('hero'),
        cuts: summarize('cuts'),
        authority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
        warning: window.state?.storageWarning || '',
        archiveRequests: window.__factoryArchiveRequestsV119 || [],
        logs: (factory.logs || []).slice(-20),
      };
    })()`);
    throw new Error('start completion timeout: ' + JSON.stringify(diagnostic));
  }
  const finished = await evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    const goal = factory.goalRun || {};
    const status = document.querySelector('[data-factory-goal-status]');
    const stage = stageId => factory.stages?.[stageId] || {};
    const currentAssets = stageId => (factory.assets || []).filter(asset =>
      asset?.stageId === stageId && window.factoryAssetMatchesCurrentJob?.(asset, stageId, factory)?.ok
    ).map(asset => ({
      id: asset.id || '',
      workspaceId: asset.workspaceId || asset.metadata?.workspaceId || asset.sourceMap?.workspaceId || '',
      localArchiveId: asset.localArchiveId || asset.archiveId || asset.metadata?.localArchiveId || '',
      imageUrl: asset.imageUrl || asset.metadata?.imageUrl || '',
    }));
    return {
      calls: window.__factoryStartButtonV119?.calls || [],
      goal: {
        running: !!goal.running,
        progress: Number(goal.progress || 0),
        currentStage: goal.currentStage || '',
        failureReason: goal.failureReason || '',
      },
      hero: { status: stage('hero').status || '', assets: currentAssets('hero') },
      cuts: { status: stage('cuts').status || '', assets: currentAssets('cuts') },
      statusTitle: status?.querySelector('[data-factory-goal-title]')?.textContent?.trim() || '',
      statusPill: status?.querySelector('[data-factory-goal-pill]')?.textContent?.trim() || '',
      statusFailure: status?.querySelector('[data-factory-goal-failure]')?.textContent?.trim() || '',
    };
  })()`);
  const finishedScreenshot = await screenshot(cdp, 'factory-generation-start-finished-v119.png');
  return { setup, runningScreenshot, finished, finishedScreenshot };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

  const inputImage = svgData('generation-input-v119', '#0ea5e9');
  const resultImage = svgData('generated-v119', '#22c55e');
  const workspaceId = `generation_workspace_v119_${Date.now()}`;
  await evaluate(cdp, `(async () => {
    const inputImage = ${JSON.stringify(inputImage)};
    const resultImage = ${JSON.stringify(resultImage)};
    const productName = 'GenerationStatusV119';
    const workspaceId = ${JSON.stringify(workspaceId)};
    const runId = 'generation_status_run_v119';
    const base64 = inputImage.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(productName) : productName;
    const fp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(base64) : 'generation_fp_v119';

    window.hasImageConnection = () => true;
    window.__factoryArchiveRequestsV119 = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const response = await nativeFetch(input, init);
      const url = String(input?.url || input || '');
      if (/\\/api\\/local-archive\\/assets(?:\\?|$)/.test(url) && String(init?.method || 'GET').toUpperCase() === 'POST') {
        window.__factoryArchiveRequestsV119.push({
          url,
          request: JSON.parse(String(init.body || '{}')),
          status: response.status,
          response: await response.clone().json().catch(() => ({})),
        });
      }
      return response;
    };
    window.__KUASANGSE_IMAGE_GENERATION_TEST_HOOK__ = async ({ label }) => {
      // Full 회귀 중 브라우저 부하가 있어도 running 상태를 관찰할 시간을 확보한다.
      await new Promise(resolve => setTimeout(resolve, 2500));
      const encoded = resultImage.replace('generated-v119', String(label || 'generated-v119'));
      return encoded;
    };

    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = productName;
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = productName;
    window.state.imageBase64 = base64;
    window.state.imageMime = 'image/svg+xml';
    window.state.imagePreview = inputImage;
    window.state.imageName = 'generation-status-input-v119.svg';
    window.state.productInfoManualValues = {
      product_name: productName,
      size_spec: '23x40',
      width_mm: '23',
      depth_mm: '40',
      weight: '5.3',
    };

    const factory = window.factoryState();
    if (typeof window.factoryStampWorkspaceIdentity === 'function') {
      window.factoryStampWorkspaceIdentity(factory, {
        projectId: workspaceId,
        projectName: productName,
        createdAt: window.state.currentProjectCreatedAt,
      });
    }
    factory.product = factory.product || {};
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.lockedInputImageFingerprint = fp;
    factory.product.inputImageFingerprint = fp;
    factory.product.imageBase64 = base64;
    factory.product.imageMime = 'image/svg+xml';
    factory.product.imagePreview = inputImage;
    factory.product.imageName = 'generation-status-input-v119.svg';
    factory.product.inputImages = [{
      id: 'generation_input_v119',
      name: 'generation-status-input-v119.svg',
      base64,
      mime: 'image/svg+xml',
      preview: inputImage,
      hasImage: true,
      inputImageFingerprint: fp,
      sourceImageKey: fp,
      productImageKey: fp,
      productKey,
      currentRunId: runId,
    }];
    factory.product.finalDb = {
      ...(factory.product.finalDb || {}),
      product_name: productName,
      size_spec: '23x40',
      width_mm: '23',
      depth_mm: '40',
      weight: '5.3',
    };
    factory.product.dbSizeManualDrafts = {
      size_spec: '23x40',
      width_mm: '23',
      depth_mm: '40',
      weight: '5.3',
    };
    factory.product.dbSizeManualValues = {
      size_spec: '23x40',
      width_mm: '23',
      depth_mm: '40',
      weight: '5.3',
    };
    factory.automation = factory.automation || {};
    factory.automation.currentRunId = runId;
    factory.automation.activeTab = 'assets';
    delete factory.automation.sizeImageDbConfirmedKey;
    delete factory.automation.sizeImageDbConfirmedAt;
    factory.stages = factory.stages || {};
    ['hero', 'size', 'cuts'].forEach(stageId => {
      factory.stages[stageId] = {
        ...(factory.stages[stageId] || {}),
        status: 'idle',
        message: 'v119 검증 대기',
        targetCount: 1,
        selectedAssetIds: [],
      };
    });
    factory.assets = [];
    factory.previousAssets = [];
    window.state.cuts = window.state.cuts || {};
    window.state.cuts.prompts = [];
    window.state.cuts.sizePrompts = [];
    window.state.cuts.runBusy = false;
    window.state.cuts.sizeRunBusy = false;
    window.state.factory = window.normalizeFactoryState ? window.normalizeFactoryState(factory) : factory;
    if (typeof window.factorySyncDbSizeManualValue === 'function') {
      window.factorySyncDbSizeManualValue('size_spec', '23x40', window.factoryState());
      window.factorySyncDbSizeManualValue('width_mm', '23', window.factoryState());
      window.factorySyncDbSizeManualValue('depth_mm', '40', window.factoryState());
      window.factorySyncDbSizeManualValue('weight', '5.3', window.factoryState());
    }
    if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(window.factoryState());
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    let authority = await lock.acquire({
      scopeId: 'project:' + workspaceId,
      ownerId: 'generation status regression',
    });
    if (authority.mode !== 'editing') {
      authority = await lock.takeover({
        confirmed: true,
        scopeId: 'project:' + workspaceId,
        ownerId: 'generation status regression',
      });
    }
    if (authority.mode !== 'editing') throw new Error('generation authority acquisition failed');
    window.render();
    return true;
  })()`);

  await waitFor(cdp, 'document.querySelector("#factoryAutomationAssetChooser_hero [data-factory-run-stage=\\"hero\\"]")', 10000);
  const beforeScreenshot = await screenshot(cdp, 'factory-generation-before-v119.png');
  const hero = await clickStageAndCapture(cdp, 'hero');
  const size = await clickStageAndCapture(cdp, 'size');
  const cuts = await clickStageAndCapture(cdp, 'cuts');
  const directStage = await runDirectStageWithStaleGoalAndCapture(cdp, 'hero');
  const start = await clickStartAndCapture(cdp);
  const finalState = await evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    return {
      workspaceId: factory.workspace?.id || window.state?.currentProjectId || '',
      sizeConfirmed: !!factory.automation?.sizeImageDbConfirmedKey,
      sizeConfirmedAt: factory.automation?.sizeImageDbConfirmedAt || 0,
      logs: (factory.logs || []).slice(-20).map(item => item.message || item.text || ''),
      assetCount: (factory.assets || []).length,
      previousAssetCount: (factory.previousAssets || []).length,
      previousAssets: (factory.previousAssets || []).map(asset => ({
        id: asset.id || '',
        stageId: asset.stageId || '',
        workspaceId: asset.workspaceId || asset.metadata?.workspaceId || asset.sourceMap?.workspaceId || '',
        currentRunId: asset.currentRunId || asset.metadata?.currentRunId || asset.sourceMap?.currentRunId || '',
        productKey: asset.productKey || asset.metadata?.productKey || asset.sourceMap?.productKey || '',
      })),
    };
  })()`);
  const scopeDiagnostics = await evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    const toJob = item => ({
      workspaceId: item?.workspaceId || item?.metadata?.workspaceId || item?.sourceMap?.workspaceId || '',
      currentRunId: item?.currentRunId || item?.generationRunId || item?.metadata?.currentRunId || item?.metadata?.generationRunId || item?.sourceMap?.currentRunId || item?.sourceMap?.generationRunId || '',
      productKey: item?.productKey || item?.metadata?.productKey || item?.sourceMap?.productKey || item?.metadata?.productIdentityKey || item?.sourceMap?.productIdentityKey || '',
      inputImageFingerprint: item?.inputImageFingerprint || item?.metadata?.inputImageFingerprint || item?.sourceMap?.inputImageFingerprint || item?.metadata?.inputImageKey || item?.sourceMap?.inputImageKey || item?.metadata?.sourceImageKey || item?.sourceMap?.sourceImageKey || '',
      stageId: item?.stageId || item?.metadata?.stageId || item?.sourceMap?.stageId || item?.sourceMap?.importedStageId || '',
    });
    const stageRows = ['hero', 'size', 'cuts'].map(stageId => {
      const prompts = stageId === 'size' ? (window.state?.cuts?.sizePrompts || []) : (window.state?.cuts?.prompts || []);
      const expected = typeof window.factoryCurrentJobKey === 'function' ? window.factoryCurrentJobKey(stageId, factory) : {};
      const collect = row => {
        const actual = toJob(row);
        const check = typeof window.factoryAssetMatchesCurrentJob === 'function'
          ? window.factoryAssetMatchesCurrentJob({ ...row, stageId: row?.stageId || stageId }, stageId, factory, {
              strictScope: true,
              strictRunId: true,
              requireExpectedProductKey: true,
              requireExpectedInputFingerprint: true,
              requireExpectedRunId: true,
              requireExpectedStageId: true,
            })
          : null;
        return { id: row?.id || '', title: row?.title || row?.label || '', hasResult: !!row?.result || !!row?.image || !!row?.imageUrl, actual, mismatches: check?.mismatches || [], expected: check?.expected || expected };
      };
      return {
        stageId,
        expected,
        stage: factory.stages?.[stageId] || {},
        prompts: prompts.filter(row => row?.result).slice(0, 4).map(collect),
        assets: (factory.assets || []).filter(row => row?.stageId === stageId).slice(0, 4).map(collect),
        previousAssets: (factory.previousAssets || []).filter(row => row?.stageId === stageId).slice(0, 8).map(collect),
      };
    });
    return { workspaceId: factory.workspace?.id || window.state?.currentProjectId || '', stageRows };
  })()`);
  cdp.close();
  await cdpRuntime.cleanup();

  const results = { url: APP_URL, beforeScreenshot, hero, size, cuts, directStage, start, finalState, scopeDiagnostics };
  const jsonEvidence = path.join(OUT_DIR, 'factory-generation-status-v119.json');
  fs.writeFileSync(jsonEvidence, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ...results, jsonEvidence }, null, 2));
  const checks = [];
  for (const item of [hero, size, cuts]) {
    checks.push({
      ok: item.running.status === 'running' &&
        item.running.panelId === `factoryAutomationAssetChooser_${item.running.stageId}` &&
        item.running.panelConnected === true &&
        item.running.panelMatchesTarget === true &&
        /생성 중|요청됨|준비/.test(item.running.panelText),
      message: `${item.running.stageId} 생성중 표시 실패: ${item.running.status} ${item.running.panelText}`,
    });
    checks.push({
      ok: item.finished.usableCount >= 1 && !['error', 'blocked'].includes(item.finished.status),
      message: `${item.finished.stageId} 후보 생성 실패: ${item.finished.status} ${item.finished.message}`,
    });
    checks.push({
      ok: item.finished.assets.every(asset => asset.stageId === item.finished.stageId && asset.localArchiveId && asset.imageUrl),
      message: `${item.finished.stageId} 로컬 아카이브 메타데이터 누락: ${JSON.stringify(item.finished.assets)}`,
    });
    checks.push({
      ok: item.finished.assets.every(asset => asset.workspaceId === workspaceId),
      message: `${item.finished.stageId} 생성 후보의 작업공간 식별자 누락 또는 불일치: ${JSON.stringify(item.finished.assets)}`,
    });
  }
  checks.push({
    ok: finalState.workspaceId === workspaceId,
    message: `생성 검증의 현재 작업공간이 바뀌었습니다: ${finalState.workspaceId}`,
  });
  checks.push({
    ok: size.running.sizeConfirmed === true && finalState.sizeConfirmed === true,
    message: '사이즈 재생성 버튼의 DB 사이즈 자동 확인이 동작하지 않았습니다.',
  });
  checks.push({
    ok: finalState.assetCount >= 3,
    message: `대표/사이즈/이미지컷 후보 수 부족: ${finalState.assetCount}`,
  });
  checks.push({
    ok: finalState.previousAssetCount === 0,
    message: `같은 실행의 대표/사이즈 결과가 이미지컷 이전 작업으로 잘못 분리됐습니다: ${JSON.stringify(finalState.previousAssets)}`,
  });
  checks.push({
    ok: directStage.result.runResult === true && directStage.result.stage.status === 'done',
    message: `직접 실행 대표이미지 생성 실패: ${JSON.stringify(directStage.result)}`,
  });
  checks.push({
    ok: directStage.result.goal.running === false &&
      directStage.result.goal.progress === 100 &&
      !directStage.result.goal.failureReason &&
      !/실패/.test(`${directStage.result.statusTitle} ${directStage.result.statusPill} ${directStage.result.statusFailure}`),
    message: `완료된 직접 이미지 실행이 이전 실패 상태로 남았습니다: ${JSON.stringify(directStage.result)}`,
  });
  checks.push({
    ok: Object.values(start.setup.aliases).every(Boolean) && ['analysis', 'db', 'vm'].every(name => start.finished.calls.includes(name)),
    message: `시작 버튼의 비이미지 작업 대체 경로가 실행되지 않았습니다: ${JSON.stringify(start)}`,
  });
  checks.push({
    ok: start.finished.goal.running === false &&
      start.finished.goal.progress === 100 &&
      !start.finished.goal.failureReason &&
      !/실패/.test(`${start.finished.statusTitle} ${start.finished.statusPill} ${start.finished.statusFailure}`),
    message: `시작 버튼 완료가 실패 상태로 남았습니다: ${JSON.stringify(start.finished)}`,
  });
  checks.push({
    ok: ['done', 'review'].includes(start.finished.hero.status) &&
      ['done', 'review'].includes(start.finished.cuts.status) &&
      start.finished.hero.assets.every(asset => asset.workspaceId === workspaceId && asset.localArchiveId && asset.imageUrl) &&
      start.finished.cuts.assets.every(asset => asset.workspaceId === workspaceId && asset.localArchiveId && asset.imageUrl),
    message: `시작 버튼의 대표/이미지컷 후보 보관 또는 작업 범위가 깨졌습니다: ${JSON.stringify(start.finished)}`,
  });
  assertChecks(checks);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
