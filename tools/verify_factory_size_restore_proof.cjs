const fs = require('fs');
const path = require('path');
const {
  assertCdpRuntimeIsolation,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const API_ROOT = process.env.KUASANGSE_BACKEND_BASE || process.env.KUASANGSE_BACKEND_URL || '';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9447';
const productName = process.env.KUASANGSE_PROOF_PRODUCT || '버튼실제사이즈검증띠수네모동전지갑';
const evidenceDir = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const jsonPath = path.join(evidenceDir, 'factory-size-local-restore-reload-proof.json');
const shotPath = path.join(evidenceDir, 'factory-size-local-restore-reload-proof.png');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function timedSend(cdp, method, params = {}, timeoutMs = 10000) {
  return Promise.race([
    cdp.send(method, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs)),
  ]);
}

function compactArchiveRow(row = {}) {
  return {
    archiveId: row.archiveId,
    title: row.title,
    currentRunId: row.currentRunId,
    productKey: row.productKey,
    stageId: row.stageId,
    savedAt: row.savedAt,
    imageUrl: row.imageUrl,
    bytes: row.files?.imageBytes || 0,
    inputImageFingerprint: String(row.inputImageFingerprint || '').slice(0, 24),
  };
}

function setupExpression({ backendBase, inputFingerprint, ids, productName, runId }) {
  return `(async () => {
    const backendBase = ${JSON.stringify(backendBase)};
    const inputFingerprint = ${JSON.stringify(inputFingerprint)};
    const ids = ${JSON.stringify(ids)};
    const productName = ${JSON.stringify(productName)};
    const runId = ${JSON.stringify(runId)};
    state.step = 'imagecuts';
    state.backendBaseUrl = backendBase;
    state.productName = productName;
    state.imageBase64 = '';
    state.imageMime = 'image/png';
    state.imagePreview = '__stored_in_indexeddb__';
    const factory = factoryState();
    const normalizedProductKey = typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(productName)
      : productName;
    factory.activeTab = 'assets';
    factory.activeStage = 'size';
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.productKey = normalizedProductKey;
    factory.product.productIdentityKey = normalizedProductKey;
    factory.product.naturalHint = '동전지갑';
    factory.product.currentRunId = runId;
    factory.product.hasImage = true;
    factory.product.inputImageFingerprint = inputFingerprint;
    factory.product.currentUploadImageFingerprint = inputFingerprint;
    factory.product.lockedInputImageFingerprint = inputFingerprint;
    factory.product.lockedInputImageName = 'size_restore_input.png';
    factory.product.lockedInputImageMime = 'image/png';
    factory.product.lockedInputImageSetAt = Date.now();
    factory.product.inputImages = [{
      id: 'size_restore_input',
      name: 'size_restore_input.png',
      hasImage: true,
      lockedInput: true,
      mime: 'image/png',
      preview: '__stored_in_indexeddb__',
      inputImageFingerprint: inputFingerprint,
      sourceImageKey: inputFingerprint,
      productImageKey: inputFingerprint,
      productKey: normalizedProductKey,
      factoryProductKey: normalizedProductKey,
      scopeProductKey: normalizedProductKey,
      currentRunId: runId,
      generationRunId: runId,
      uploadedAt: Date.now(),
    }];
    factory.goalRun = factory.goalRun || {};
    factory.automation = factory.automation || {};
    factory.goalRun.currentRunId = runId;
    factory.automation.currentRunId = runId;
    factory.stages.size = {
      ...(factory.stages.size || {}),
      targetCount: 3,
      currentRunId: runId,
      latestGenerationRunId: runId,
      status: 'idle',
      message: '사이즈컷 로컬 복구 검증 준비',
    };
    state.cuts = state.cuts || {};
    state.cuts.factoryStageId = 'size';
    state.cuts.sizeFactoryStageId = 'size';
    state.cuts.sizePromptSlotCount = 3;
    state.cuts.sizePrompts = [1, 2, 3].map(index => stampCutPromptSource({
      id: 'verify_real_button_size_' + index,
      label: '사이즈 복구 ' + index,
      prompt: '현재 제품 사이즈컷 복구 확인 ' + index,
      result: null,
      generating: false,
      error: '',
      factoryStageId: 'size',
      stageId: 'size',
    }, 'size'));
    factory.assets = (factory.assets || []).filter(asset => asset?.stageId !== 'size');
    const loaded = [];
    for (const id of ids) {
      loaded.push({ id, ok: await factoryLoadLocalArchiveAsset(id, { silent: true }) });
    }
    const restored = factoryRestoreCutPromptResultsFromAssets('size', { log: false });
    saveLastWorkNow();
    render();
    return window.__factorySizeRestoreSummary();
  })()`;
}

const summaryBootstrap = `(() => {
  window.__factorySizeRestoreSummary = () => {
    const factory = factoryState();
    const usable = factoryUsableAssetsForStage('size', factory);
    const prompts = state.cuts?.sizePrompts || [];
    return {
      usable: usable.length,
      promptResults: prompts.filter(prompt => !!prompt?.result).length,
      runBusy: !!(state.cuts?.runBusy || state.cuts?.sizeRunBusy),
      promptGenerating: prompts.filter(prompt => prompt?.generating).length,
      runId: factoryCurrentWorkflowRunId(factory),
      productKey: factoryCurrentProductKey(factory),
      inputImageFingerprint: factoryCurrentInputImageFingerprint(factory),
      loadedStatus: factory.archive?.localStatus || '',
      assets: usable.map(asset => ({
        archiveId: asset.archiveId || asset.localArchiveId,
        title: asset.title,
        hasImage: !!factoryAssetDisplayImage(asset),
        match: factoryAssetMatchesCurrentJob(asset, 'size', factory),
      })),
      prompts: prompts.map(prompt => ({
        id: prompt.id,
        archiveId: prompt.archiveId || prompt.localArchiveId || '',
        hasResult: !!prompt.result,
        match: prompt.archiveId
          ? factoryAssetMatchesCurrentJob((factory.assets || []).find(asset => (asset.archiveId || asset.localArchiveId) === prompt.archiveId), 'size', factory)
          : null,
      })),
    };
  };
  return true;
})()`;

(async () => {
  assertCdpRuntimeIsolation();
  fs.mkdirSync(evidenceDir, { recursive: true });
  console.error('[size-restore-proof] archive query');
  const list = await fetchJson(`${API_ROOT}/api/local-archive/assets?limit=6&stageId=size&productKey=${encodeURIComponent(productName)}`);
  const archiveRows = (list.items || list.assets || []).filter(row => row.archiveId).slice(0, 3);
  if (archiveRows.length < 3) throw new Error(`사이즈 보관 원본 부족: ${archiveRows.length}`);
  const runId = archiveRows[0].currentRunId;
  const archiveIds = archiveRows.map(row => row.archiveId).reverse();
  const inputFingerprint = String(archiveRows[0].inputImageFingerprint || '').trim();
  console.error(`[size-restore-proof] rows=${archiveRows.length} run=${runId} inputFp=${inputFingerprint.slice(0, 24)}`);
  const runtime = await ensureCdp(CDP_URL);
  console.error(`[size-restore-proof] cdp launched=${!!runtime.launched} targets=${runtime.targets?.length || 0}`);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  try {
    await timedSend(cdp, 'Page.enable');
    await timedSend(cdp, 'Runtime.enable');
    await timedSend(cdp, 'Network.enable');
    await timedSend(cdp, 'Network.setCacheDisabled', { cacheDisabled: true });
    await timedSend(cdp, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await timedSend(cdp, 'Page.navigate', { url: `${APP_URL}?sizeRestoreProof=${Date.now()}` });
    await waitFor(cdp, `typeof render === 'function' && typeof factoryLoadLocalArchiveAsset === 'function'`, 30000);
    console.error('[size-restore-proof] app ready');
    await evaluate(cdp, summaryBootstrap);
    console.error('[size-restore-proof] setup restore before reload');
    const beforeReload = await evaluate(cdp, setupExpression({
      backendBase: new URL(API_ROOT).origin,
      inputFingerprint,
      ids: archiveIds,
      productName,
      runId,
    }));
    console.error(`[size-restore-proof] before usable=${beforeReload.usable} prompts=${beforeReload.promptResults}`);
    await timedSend(cdp, 'Page.reload', { ignoreCache: true });
    await waitFor(cdp, `typeof render === 'function' && typeof factoryRestoreCutPromptResultsFromAssets === 'function'`, 30000);
    await delay(2000);
    console.error('[size-restore-proof] after reload app ready');
    await evaluate(cdp, summaryBootstrap);
    await evaluate(cdp, `(() => { factoryRestoreCutPromptResultsFromAssets('size', { log: false }); render(); return true; })()`);
    const afterReload = await evaluate(cdp, `window.__factorySizeRestoreSummary()`);
    console.error(`[size-restore-proof] after usable=${afterReload.usable} prompts=${afterReload.promptResults}`);
    await evaluate(cdp, `(() => { const btn = document.getElementById('genAllSizeCutsBtn'); if (btn) btn.scrollIntoView({ block: 'center' }); return true; })()`).catch(() => false);
    const screenshot = await timedSend(cdp, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15000).catch(err => ({ error: err.message || String(err) }));
    if (screenshot.data) fs.writeFileSync(shotPath, Buffer.from(screenshot.data, 'base64'));
    const ok = beforeReload.usable >= 3
      && beforeReload.promptResults >= 3
      && beforeReload.assets.every(asset => asset.hasImage && asset.match?.ok)
      && afterReload.usable >= 3
      && afterReload.promptResults >= 3
      && !afterReload.runBusy
      && afterReload.assets.every(asset => asset.hasImage && asset.match?.ok);
    const evidence = {
      ok,
      archiveRows: archiveRows.map(compactArchiveRow),
      beforeReload,
      afterReload,
      jsonPath,
      shotPath: screenshot.data ? shotPath : '',
      shotError: screenshot.error || '',
    };
    fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
      ok,
      beforeReload: {
        usable: beforeReload.usable,
        promptResults: beforeReload.promptResults,
        productKey: beforeReload.productKey,
      },
      afterReload: {
        usable: afterReload.usable,
        promptResults: afterReload.promptResults,
        runBusy: afterReload.runBusy,
        promptGenerating: afterReload.promptGenerating,
        productKey: afterReload.productKey,
      },
      jsonPath,
      shotPath: screenshot.data ? shotPath : '',
    }, null, 2));
    if (!ok) process.exitCode = 2;
  } finally {
    try { cdp.close(); } catch (_) {}
    if (runtime.cleanup) await runtime.cleanup();
  }
})().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
