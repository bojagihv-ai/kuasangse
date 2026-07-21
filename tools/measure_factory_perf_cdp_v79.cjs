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
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL
  || process.env.KUASANGSE_BACKEND_BASE
  || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RENDER_BUDGET_MS = 900;

function makeSvgDataUrl(index, bytes = 22000) {
  const filler = String(index).padStart(3, '0') + '-'.repeat(Math.max(0, bytes));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650" viewBox="0 0 900 650">
  <rect width="900" height="650" fill="#fff7f2"/>
  <rect x="70" y="80" width="760" height="490" rx="34" fill="#1b2135"/>
  <text x="450" y="285" text-anchor="middle" font-size="54" font-family="Arial" fill="#ffffff">perf ${index}</text>
  <text x="450" y="350" text-anchor="middle" font-size="22" font-family="Arial" fill="#a5b4fc">${filler}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const count = Number(process.env.FACTORY_PERF_ASSETS || 96);
  const stageIds = ['hero', 'size', 'cuts', 'options', 'detail'];
  const stageRetentionCaps = { hero: 12, size: 10, cuts: 18, options: 10, detail: 4 };
  const requestedAssetsByStage = Object.fromEntries(stageIds.map(stageId => [stageId, 0]));
  for (let index = 0; index < count; index += 1) {
    requestedAssetsByStage[stageIds[index % stageIds.length]] += 1;
  }
  const expectedRuntimeAssetCount = stageIds.reduce(
    (total, stageId) => total + Math.min(requestedAssetsByStage[stageId], stageRetentionCaps[stageId]),
    0,
  );
  const cdpRuntime = await ensureCdp(CDP_URL);
  const targets = cdpRuntime.targets;
  const target = targets.find(item => item.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)}); } catch (_) {}`,
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);
  await evaluate(cdp, `(async () => {
    await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
    return true;
  })()`);
  const readinessExpression = `(() =>
    typeof classicRuntimeHydrationReady !== 'undefined' && classicRuntimeHydrationReady === true &&
    typeof classicRuntimeInitialRenderComplete !== 'undefined' && classicRuntimeInitialRenderComplete === true &&
    typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true &&
    typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false &&
    typeof lastWorkSaveTimer !== 'undefined' && !lastWorkSaveTimer
  )()`;
  try {
    await waitFor(cdp, readinessExpression, Number(process.env.FACTORY_PERF_READY_TIMEOUT_MS || 60000));
  } catch (error) {
    const readiness = await evaluate(cdp, `(() => ({
      classicRuntimeHydrationReady: typeof classicRuntimeHydrationReady === 'undefined' ? null : classicRuntimeHydrationReady,
      classicRuntimeInitialRenderComplete: typeof classicRuntimeInitialRenderComplete === 'undefined' ? null : classicRuntimeInitialRenderComplete,
      sessionAssetsHydrated: typeof sessionAssetsHydrated === 'undefined' ? null : sessionAssetsHydrated,
      serverLastWorkHydrated: typeof serverLastWorkHydrated === 'undefined' ? null : serverLastWorkHydrated,
      serverLastWorkHydrating: typeof serverLastWorkHydrating === 'undefined' ? null : serverLastWorkHydrating,
      persistentStateSaving: typeof persistentStateSaving === 'undefined' ? null : persistentStateSaving,
      persistentStateSaveQueued: typeof persistentStateSaveQueued === 'undefined' ? null : persistentStateSaveQueued,
      hasLastWorkSaveTimer: typeof lastWorkSaveTimer === 'undefined' ? null : !!lastWorkSaveTimer,
      hasPersistentRetryTimer: typeof persistentStateSaveRetryTimer === 'undefined' ? null : !!persistentStateSaveRetryTimer,
    }))()`);
    throw new Error(`${error.message}\nreadiness=${JSON.stringify(readiness)}`);
  }

  const images = Array.from({ length: count }, (_, i) => makeSvgDataUrl(i + 1));
  const initial = await evaluate(cdp, `(async () => {
    const payload = ${JSON.stringify({ images })};
    const stages = ['hero', 'size', 'cuts', 'options', 'detail'];
    const productName = '성능측정상품';
    const workspaceId = 'perf_workspace_v79_' + Date.now();
    const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(productName) : '성능측정상품';
    const inputImageFingerprint = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(payload.images[0]) : 'perf_input_v79';
    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = productName;
    window.state.productName = productName;
    window.state.imagePreview = payload.images[0];
    window.state.imageBase64 = payload.images[0].replace(/^data:image\\/[^;,]+;base64,/i, '');
    const authority = await window.ensureWorkspaceEditAuthority('project:' + workspaceId);
    if (authority?.mode !== 'editing') throw new Error('performance authority acquisition failed');
    const f = window.factoryState();
    window.factoryStampWorkspaceIdentity(f, { projectId: workspaceId, projectName: productName, createdAt: Date.now() });
    f.product = f.product || {};
    f.product.productName = productName;
    f.product.userProductName = productName;
    f.product.currentRunId = 'perf_run_v79';
    f.product.lockedCurrentRunId = 'perf_run_v79';
    f.product.productKey = productKey;
    f.product.lockedProductKey = productKey;
    f.product.inputImageFingerprint = inputImageFingerprint;
    f.product.lockedInputImageFingerprint = inputImageFingerprint;
    f.product.imagePreview = payload.images[0];
    f.product.imageBase64 = window.state.imageBase64;
    f.product.inputImages = [{
      id: 'perf_input_image',
      name: '성능측정 입력 이미지',
      base64: f.product.imageBase64,
      preview: payload.images[0],
      mime: 'image/svg+xml',
      hasImage: true,
      inputImageFingerprint,
      workspaceId,
    }];
    f.automation = f.automation || {};
    f.automation.currentRunId = 'perf_run_v79';
    f.automation.activeTab = 'assets';
    f.uiPanels = f.uiPanels || {};
    f.uiPanels.assets = true;
    f.assetListExpanded = true;
    f.stages = f.stages || {};
    stages.forEach(stageId => {
      f.stages[stageId] = {
        ...(f.stages[stageId] || {}),
        status: 'done',
        currentRunId: 'perf_run_v79',
        workspaceId,
        latestGenerationRunId: 'perf_run_v79',
      };
    });
    f.assets = payload.images.map((image, index) => {
      const stageId = stages[index % stages.length];
      const meta = {
        currentRunId: 'perf_run_v79',
        workspaceId,
        productKey,
        productIdentityKey: productKey,
        productName,
        inputImageFingerprint,
        inputImageKey: inputImageFingerprint,
        sourceImageKey: inputImageFingerprint,
        productImageKey: inputImageFingerprint,
        generationRunId: 'perf_run_v79',
        stageId,
        presetLabel: '성능측정',
      };
      return {
        id: 'perf_asset_' + workspaceId + '_' + index,
        stageId,
        type: 'image',
        title: '성능 측정 이미지 ' + (index + 1),
        image,
        html: '',
        used: index % 13 === 0,
        currentRunId: 'perf_run_v79',
        workspaceId,
        productKey,
        inputImageFingerprint,
        generationRunId: 'perf_run_v79',
        metadata: meta,
        sourceMap: { ...meta },
      };
    });
    const archiveResponse = await window.factoryBackendArchiveAsset(f.assets[0], 'perf-lightweight-url-proof');
    const archiveApplied = window.factoryApplyLocalArchiveRecordToAsset(
      f.assets[0],
      archiveResponse?.archive || {},
      archiveResponse?.root || ''
    );
    if (!archiveApplied) throw new Error('performance local archive proof setup failed');
    window.state.factory = f;
    const originalNormalizeAssetImageReference = window.factoryNormalizeAssetImageReference;
    let displayImageNormalizationCalls = 0;
    const displayImageNormalizationByAssetId = {};
    if (typeof originalNormalizeAssetImageReference === 'function') {
      window.factoryNormalizeAssetImageReference = function(...args) {
        displayImageNormalizationCalls += 1;
        const assetId = String(args[0]?.id || 'unknown');
        displayImageNormalizationByAssetId[assetId] = (displayImageNormalizationByAssetId[assetId] || 0) + 1;
        return originalNormalizeAssetImageReference.apply(this, args);
      };
    }
    const start = performance.now();
    try {
      window.render();
    } finally {
      if (typeof originalNormalizeAssetImageReference === 'function') {
        window.factoryNormalizeAssetImageReference = originalNormalizeAssetImageReference;
      }
    }
    return {
      renderCallMs: Math.round(performance.now() - start),
      displayImageNormalizationCalls,
      displayImageNormalizationByAssetId,
    };
  })()`);
  await new Promise(resolve => setTimeout(resolve, 900));
  await evaluate(cdp, `(() => {
    document.querySelector('[data-factory-auto-tab="assets"]')?.click();
    const btn = document.querySelector('[data-factory-toggle-assets]');
    if (btn && /펼치기/.test(btn.textContent || '')) btn.click();
    const target = document.querySelector('#factoryAutomationAssetChooser_hero') || document.querySelector('[data-factory-toggle-assets]');
    target?.scrollIntoView?.({ block: 'start' });
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 900));
  let lightweightSourcesSettled = false;
  try {
    await waitFor(cdp, `(() => {
      const assetImgs = Array.from(document.querySelectorAll('img[data-factory-asset-img]'))
        .filter(img => img.dataset.factoryLightPriority === '1');
      return assetImgs.length > 0 && assetImgs.every(img => {
        const src = String(img.src || '');
        return src.startsWith('blob:') || src.includes('/api/local-archive/assets/');
      });
    })()`, 10000);
    lightweightSourcesSettled = true;
  } catch (_) {}
  const afterRender = await evaluate(cdp, `(() => {
    const imgs = Array.from(document.images || []);
    const assetImgs = Array.from(document.querySelectorAll('img[data-factory-asset-img]'));
    const assetImageSources = assetImgs.map(img => String(img.src || ''));
    const isArchiveSource = src => /\\/api\\/local-archive\\/assets\\/[^/]+\\/image(?:$|[?#])/i.test(src);
    const isResolvedSource = src => /^blob:/i.test(src) || isArchiveSource(src);
    const isDeferredPlaceholder = (img, src) => !!img.dataset.factoryLightImageKey &&
      img.dataset.factoryLightLoaded !== '1' &&
      src.startsWith('data:image/svg+xml') &&
      src.length <= 3000;
    const resolvedAssetImgs = assetImgs.filter(img => isResolvedSource(String(img.src || '')));
    const deferredAssetImgs = assetImgs.filter(img => isDeferredPlaceholder(img, String(img.src || '')));
    const unexpectedAssetImgs = assetImgs.filter(img => {
      const src = String(img.src || '');
      return !isResolvedSource(src) && !isDeferredPlaceholder(img, src);
    });
    const archiveImageUrls = Array.from(new Set(assetImageSources.filter(isArchiveSource)));
    return {
      renderMs: window.__KUASANGSE_RENDER_LAST_MS__ || 0,
      domNodes: document.querySelectorAll('*').length,
      imgCount: imgs.length,
      dataImgCount: imgs.filter(img => /^data:image\\//i.test(String(img.src || ''))).length,
      heavyDataImgCount: imgs.filter(img => /^data:image\\//i.test(String(img.src || '')) && String(img.src || '').length > 3000).length,
      objectUrlCount: imgs.filter(img => /^blob:/i.test(String(img.src || ''))).length,
      assetImageCount: assetImgs.length,
      assetBlobUrlCount: assetImageSources.filter(src => /^blob:/i.test(src)).length,
      assetArchiveUrlCount: archiveImageUrls.length,
      assetResolvedImageCount: resolvedAssetImgs.length,
      assetDeferredPlaceholderCount: deferredAssetImgs.length,
      assetUnexpectedSourceCount: unexpectedAssetImgs.length,
      assetImageSources: assetImageSources.slice(0, 12),
      assetUnexpectedSources: unexpectedAssetImgs.slice(0, 12).map(img => String(img.src || '')),
      archiveImageUrls,
      brokenImageCount: imgs.filter(img => img.complete && !img.naturalWidth && String(img.src || '')).length,
      lightPendingCount: document.querySelectorAll('img[data-factory-light-image-key]:not([data-factory-light-loaded="1"])').length,
      lightLoadedCount: document.querySelectorAll('img[data-factory-light-image-key][data-factory-light-loaded="1"]').length,
      lightStoreSize: window.__factoryLightImageStore?.size || 0,
      lightUrlSize: window.__factoryLightImageUrls?.size || 0,
      heapUsed: performance.memory?.usedJSHeapSize || 0,
      heapTotal: performance.memory?.totalJSHeapSize || 0,
      assetsTabVisible: !!document.querySelector('#factoryAutomationAssetChooser_hero'),
      assetCards: document.querySelectorAll('[data-factory-asset-id]').length,
    };
  })()`);
  afterRender.lightweightSourcesSettled = lightweightSourcesSettled;
  const archiveImageChecks = await Promise.all((afterRender.archiveImageUrls || []).map(async url => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      return {
        url,
        status: response.status,
        contentType,
        ok: response.status === 200 && contentType.startsWith('image/'),
      };
    } catch (error) {
      return { url, status: 0, contentType: '', ok: false, error: String(error?.message || error) };
    }
  }));
  afterRender.archiveImageCheckCount = archiveImageChecks.length;
  afterRender.archiveImageCheckFailures = archiveImageChecks.filter(item => !item.ok);
  delete afterRender.archiveImageUrls;
  const debugState = await evaluate(cdp, `(() => {
    const f = window.factoryState();
    const stages = ['hero', 'size', 'cuts', 'options', 'detail'];
    const inspectAsset = (stageId) => {
      const raw = typeof window.factoryAssetsForStage === 'function'
        ? window.factoryAssetsForStage(stageId, f)
        : (f.assets || []).filter(asset => asset?.stageId === stageId);
      const asset = raw[0] || null;
      if (!asset) return { raw: raw.length, usable: 0, sample: null };
      const job = typeof window.factoryAssetMatchesCurrentJob === 'function'
        ? window.factoryAssetMatchesCurrentJob(asset, stageId, f)
        : null;
      const hasCurrent = typeof window.factoryAssetHasCurrentProductPayload === 'function'
        ? window.factoryAssetHasCurrentProductPayload(asset, f, { allowHtml: false })
        : null;
      return {
        raw: raw.length,
        usable: typeof window.factoryUsableAssetsForStage === 'function'
          ? window.factoryUsableAssetsForStage(stageId, f).length
          : 0,
        sample: {
          id: asset.id || '',
          stageId: asset.stageId || '',
          hasImage: !!(typeof window.factoryAssetDisplayImage === 'function' && window.factoryAssetDisplayImage(asset)),
          job,
          hasCurrent,
          titleScope: typeof window.factoryAssetTitleStageScope === 'function' ? window.factoryAssetTitleStageScope(asset) : '',
          declaredScopes: typeof window.factoryAssetDeclaredStageScopes === 'function' ? window.factoryAssetDeclaredStageScopes(asset) : [],
          looksFallback: typeof window.factoryAssetLooksLocalFallbackCandidate === 'function' ? window.factoryAssetLooksLocalFallbackCandidate(asset) : null,
          looksWrongStage: typeof window.factoryAssetLooksWrongStageKind === 'function' ? window.factoryAssetLooksWrongStageKind(asset, stageId) : null,
          assetKey: typeof window.factoryAssetInputImageKey === 'function' ? window.factoryAssetInputImageKey(asset) : '',
          assetRunId: typeof window.factoryAssetGenerationRunId === 'function' ? window.factoryAssetGenerationRunId(asset) : '',
          assetProductKey: typeof window.factoryAssetProductKey === 'function' ? window.factoryAssetProductKey(asset) : '',
        },
      };
    };
    return {
      currentInputKey: typeof window.factoryCurrentInputImageFingerprint === 'function' ? window.factoryCurrentInputImageFingerprint(f) : '',
      currentProductKey: typeof window.factoryCurrentProductKey === 'function' ? window.factoryCurrentProductKey(f) : '',
      identityKey: typeof window.factoryIdentityKey === 'function' ? window.factoryIdentityKey(f) : '',
      totalAssets: f.assets?.length || 0,
      latestRunIds: Object.fromEntries(stages.map(stageId => [stageId, f.stages?.[stageId]?.latestGenerationRunId || ''])),
      stages: Object.fromEntries(stages.map(stageId => [stageId, inspectAsset(stageId)])),
      bodySnippet: document.body?.innerText?.slice(0, 1200) || '',
    };
  })()`);
  const displayImageCacheBehavior = await evaluate(cdp, `(() => {
    const f = window.factoryState();
    const asset = (f.assets || []).find(item => item?.id && item?.image && !item?.archiveId && !item?.localArchive?.archiveId);
    const alternatives = (f.assets || []).filter(item => item?.image && item.image !== asset?.image);
    if (!asset || alternatives.length < 2) return { ready: false };
    const original = window.factoryAssetDisplayImage(asset);
    const replacement = alternatives[0].image;
    const cloneReplacement = alternatives[1].image;
    asset.image = replacement;
    const updated = window.factoryAssetDisplayImage(asset);
    const clone = {
      ...asset,
      image: cloneReplacement,
      dataUrl: '',
      result: '',
      metadata: {
        ...(asset.metadata || {}),
        image: '',
        result: '',
        preview: '',
        dataUrl: '',
        imageLoadFailed: false,
        imageLoadFailedAt: null,
        imageLoadFailedSrc: '',
      },
    };
    const cloneUpdated = window.factoryAssetDisplayImage(clone);
    clone.imageLoadFailed = true;
    clone.imageLoadFailedSrc = String(cloneReplacement).slice(0, 500);
    const failed = window.factoryAssetDisplayImage(clone);
    clone.imageLoadFailed = false;
    clone.imageLoadFailedSrc = '';
    const recovered = window.factoryAssetDisplayImage(clone);
    const previousBackendBaseUrl = typeof loadBackendUrl === 'function' ? loadBackendUrl() : '';
    let archiveBaseInvalidated = false;
    try {
      const archiveProbe = { id: String(asset.id) + '_archive_cache_probe', archiveId: 'factory-cache-probe' };
      saveBackendUrl('http://127.0.0.1:5050/cache-a');
      const archiveBefore = window.factoryAssetDisplayImage(archiveProbe);
      saveBackendUrl('http://127.0.0.1:5050/cache-b');
      const archiveAfter = window.factoryAssetDisplayImage(archiveProbe);
      archiveBaseInvalidated = archiveBefore.includes('/cache-a/') &&
        archiveAfter.includes('/cache-b/') &&
        archiveBefore !== archiveAfter;
    } finally {
      saveBackendUrl(previousBackendBaseUrl);
    }
    return {
      ready: true,
      originalMatches: !!original,
      updateInvalidated: updated === replacement,
      cloneInvalidated: cloneUpdated === cloneReplacement,
      failureInvalidated: failed === '',
      recoveryInvalidated: recovered === cloneReplacement,
      archiveBaseInvalidated,
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(OUT_DIR, 'factory-perf-cdp-v79.png');
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  cdp.close();
  await cdpRuntime.cleanup();
  const displayImageNormalizationCounts = Object.values(initial.displayImageNormalizationByAssetId || {});
  const displayImageNormalizedAssetCount = displayImageNormalizationCounts.length;
  const displayImageMaxNormalizationsPerAsset = Math.max(0, ...displayImageNormalizationCounts);
  delete initial.displayImageNormalizationByAssetId;
  initial.displayImageNormalizedAssetCount = displayImageNormalizedAssetCount;
  initial.displayImageMaxNormalizationsPerAsset = displayImageMaxNormalizationsPerAsset;
  const stageChecks = stageIds.flatMap(stageId => {
    const stage = debugState.stages[stageId] || {};
    const sample = stage.sample || {};
    const job = sample.job || {};
    return [
      { ok: stage.raw > 0, message: `${stageId} 후보가 없습니다.` },
      { ok: stage.usable > 0, message: `${stageId} 현재 작업 후보가 없습니다.` },
      { ok: sample.hasImage === true, message: `${stageId} 후보 이미지 표시 원본이 없습니다.` },
      { ok: job.ok === true, message: `${stageId} 작업키 불일치: ${JSON.stringify(job.mismatches || [])}` },
      { ok: sample.hasCurrent === true, message: `${stageId} 현재 제품 payload 판정 실패` },
      { ok: sample.looksWrongStage === false, message: `${stageId} 단계와 다른 후보가 섞였습니다.` },
      { ok: sample.assetProductKey === debugState.currentProductKey, message: `${stageId} productKey 불일치: ${sample.assetProductKey}` },
      { ok: sample.assetKey === debugState.currentInputKey, message: `${stageId} inputImageFingerprint 불일치: ${sample.assetKey}` },
    ];
  });
  assertChecks([
    { ok: initial.renderCallMs <= RENDER_BUDGET_MS, message: `초기 렌더가 너무 느립니다: ${initial.renderCallMs}ms` },
    {
      ok: initial.displayImageNormalizationCalls <= Math.max(8, Math.ceil(count * 3)),
      message: `이미지 표시 원본을 같은 렌더에서 과다 재판별했습니다: ${initial.displayImageNormalizationCalls}회 (자산 ${count}개 · 판별 자산 ${displayImageNormalizedAssetCount}개 · 자산당 최대 ${displayImageMaxNormalizationsPerAsset}회)`,
    },
    { ok: afterRender.renderMs <= RENDER_BUDGET_MS, message: `후속 렌더가 너무 느립니다: ${afterRender.renderMs}ms` },
    { ok: afterRender.domNodes <= 9000, message: `DOM 노드가 너무 많습니다: ${afterRender.domNodes}` },
    { ok: afterRender.heapUsed <= 180 * 1024 * 1024, message: `힙 사용량이 너무 큽니다: ${afterRender.heapUsed}` },
    {
      ok: debugState.totalAssets === expectedRuntimeAssetCount,
      message: `단계별 런타임 후보 보존 한도가 어긋났습니다: ${debugState.totalAssets}/${expectedRuntimeAssetCount} (입력 ${count})`,
    },
    {
      ok: afterRender.assetCards >= Math.min(expectedRuntimeAssetCount, 30),
      message: `단계별 화면 후보 카드가 충분히 표시되지 않았습니다: ${afterRender.assetCards}`,
    },
    { ok: afterRender.assetImageCount > 0, message: '렌더된 후보 이미지가 없습니다.' },
    {
      ok: afterRender.assetUnexpectedSourceCount === 0,
      message: `후보 이미지가 경량 blob/로컬 아카이브 또는 지연 placeholder가 아닙니다: ${afterRender.assetUnexpectedSourceCount}개 · ${JSON.stringify(afterRender.assetUnexpectedSources || [])}`,
    },
    {
      ok: afterRender.assetResolvedImageCount + afterRender.assetDeferredPlaceholderCount === afterRender.assetImageCount,
      message: `후보 이미지 경량 URL 적용 범위가 불완전합니다: ${afterRender.assetResolvedImageCount}+${afterRender.assetDeferredPlaceholderCount}/${afterRender.assetImageCount}`,
    },
    {
      ok: afterRender.lightweightSourcesSettled && afterRender.assetResolvedImageCount > 0,
      message: '이미지 경량 URL(blob 또는 로컬 아카이브) 전환이 작동하지 않습니다.',
    },
    {
      ok: afterRender.archiveImageCheckFailures.length === 0,
      message: `로컬 아카이브 이미지 URL 응답이 200/image MIME이 아닙니다: ${JSON.stringify(afterRender.archiveImageCheckFailures)}`,
    },
    { ok: afterRender.heavyDataImgCount <= Math.max(8, Math.ceil(count * 0.25)), message: `무거운 data:image가 DOM에 과다 잔류: ${afterRender.heavyDataImgCount}` },
    { ok: afterRender.brokenImageCount === 0, message: `깨진 이미지가 남았습니다: ${afterRender.brokenImageCount}` },
    { ok: displayImageCacheBehavior.ready === true, message: '이미지 표시 캐시 검증용 자산을 만들지 못했습니다.' },
    { ok: displayImageCacheBehavior.originalMatches === true, message: '이미지 표시 캐시의 원본 표시가 비었습니다.' },
    { ok: displayImageCacheBehavior.updateInvalidated === true, message: '이미지 원본 변경 뒤 표시 캐시가 갱신되지 않았습니다.' },
    { ok: displayImageCacheBehavior.cloneInvalidated === true, message: '같은 자산 ID의 복제 객체가 이전 이미지 캐시를 잘못 재사용했습니다.' },
    { ok: displayImageCacheBehavior.failureInvalidated === true, message: '이미지 표시 실패 상태가 캐시에서 즉시 반영되지 않았습니다.' },
    { ok: displayImageCacheBehavior.recoveryInvalidated === true, message: '이미지 표시 실패 해제 뒤 캐시가 복구되지 않았습니다.' },
    { ok: displayImageCacheBehavior.archiveBaseInvalidated === true, message: '백엔드 주소 변경 뒤 아카이브 이미지 URL 캐시가 갱신되지 않았습니다.' },
    ...stageChecks,
  ]);
  console.log(JSON.stringify({
    url: APP_URL,
    count,
    expectedRuntimeAssetCount,
    initial,
    afterRender,
    debugState,
    displayImageCacheBehavior,
    screenshot,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
