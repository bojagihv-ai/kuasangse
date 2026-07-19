const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const EXPECTED_PRODUCT_NAME = 'IntegrityProductV80';

function svgData(label, color = '#ef4444') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <rect width="640" height="420" fill="#fff7f2"/>
  <rect x="80" y="120" width="480" height="180" rx="28" fill="${color}"/>
  <text x="320" y="222" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const targets = cdpRuntime.targets;
  const target = targets.find(item => item.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);

  const img = svgData('input-v80');
  const foreignImg = svgData('foreign-v80', '#6366f1');
  const result = await evaluateFactoryCdpFixture(cdp, `async ({
    setAppState,
    readAppWorkspaceId,
    readFactory,
    readOperationToken,
    replaceFactory,
    renderApp,
  }) => {
    const inputImage = ${JSON.stringify(img)};
    const foreignImage = ${JSON.stringify(foreignImg)};
    const currentName = 'IntegrityProductV80';
    const oldName = 'OldProductV80';
    const runId = 'integrity_run_v80';
    const currentKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(currentName) : currentName;
    const oldKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(oldName) : oldName;
    const inputBase64 = inputImage.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const foreignBase64 = foreignImage.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const inputFp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(inputBase64) : 'input_fp_v80';
    const foreignFp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(foreignBase64) : 'foreign_fp_v80';

    const workspaceId = 'regression:factory-integrity-v80';
    const workspaceName = 'Factory integrity v80';
    const workspaceCreatedAt = Date.now();
    setAppState({
      step: 'factory',
      currentProjectId: workspaceId,
      currentProjectName: workspaceName,
      currentProjectCreatedAt: workspaceCreatedAt,
      productName: currentName,
      imageBase64: inputBase64,
      imageMime: 'image/svg+xml',
      imagePreview: inputImage,
      imageName: 'integrity-input.svg',
      productInfoManualValues: {
        product_name: currentName,
        width_mm: '10.4cm',
        depth_mm: '8.3cm',
        weight: '14g',
        product_weight_g: '14g',
      },
    });

    const f = window.normalizeFactoryState ? window.normalizeFactoryState({}) : {};
    f.workspace = {
      ...(f.workspace || {}),
      id: workspaceId,
      name: workspaceName,
      createdAt: workspaceCreatedAt,
    };
    f.currentProjectId = workspaceId;
    f.currentProjectName = workspaceName;
    f.product = f.product || {};
    f.product.productName = currentName;
    f.product.userProductName = currentName;
    f.product.currentRunId = runId;
    f.product.generationRunId = runId;
    f.product.lockedInputImageFingerprint = inputFp;
    f.product.inputImageFingerprint = inputFp;
    f.product.imageBase64 = inputBase64;
    f.product.imageMime = 'image/svg+xml';
    f.product.imagePreview = inputImage;
    f.product.imageName = 'integrity-input.svg';
    f.product.inputImages = [{
      id: 'integrity_input_v80',
      name: 'integrity-input.svg',
      base64: inputBase64,
      mime: 'image/svg+xml',
      preview: inputImage,
      hasImage: true,
      inputImageFingerprint: inputFp,
      sourceImageKey: inputFp,
      productImageKey: inputFp,
      productKey: currentKey,
      currentRunId: runId
    }];
    f.product.cafe24FinalRegistration = {
      productName: 'Old very long Cafe24 name should not win',
      product_name: 'Old very long Cafe24 name should not win'
    };
    f.automation = f.automation || {};
    f.automation.currentRunId = runId;
    f.automation.activeTab = 'assets';
    f.stages = f.stages || {};
    f.stages.hero = { ...(f.stages.hero || {}), status: 'done', currentRunId: runId, latestGenerationRunId: runId };
    f.stages.cuts = { ...(f.stages.cuts || {}), status: 'running', message: 'running', runStartedAt: Date.now() - 999999, currentRunId: 'stale_run_v80', latestGenerationRunId: 'stale_run_v80' };
    f.assets = [
      {
        id: 'integrity_current_asset_v80',
        stageId: 'hero',
        type: 'image',
        title: 'current asset',
        image: inputImage,
        currentRunId: runId,
        productKey: currentKey,
        inputImageFingerprint: inputFp,
        generationRunId: runId,
        metadata: { currentRunId: runId, productKey: currentKey, inputImageFingerprint: inputFp, generationRunId: runId, stageId: 'hero' },
        sourceMap: { currentRunId: runId, productKey: currentKey, inputImageFingerprint: inputFp, generationRunId: runId, stageId: 'hero' }
      },
      {
        id: 'integrity_foreign_asset_v80',
        stageId: 'hero',
        type: 'image',
        title: 'foreign asset',
        image: foreignImage,
        currentRunId: runId,
        productKey: oldKey,
        inputImageFingerprint: foreignFp,
        generationRunId: runId,
        metadata: { currentRunId: runId, productKey: oldKey, inputImageFingerprint: foreignFp, generationRunId: runId, stageId: 'hero' },
        sourceMap: { currentRunId: runId, productKey: oldKey, inputImageFingerprint: foreignFp, generationRunId: runId, stageId: 'hero' }
      }
    ];

    if (typeof window.factorySyncDbSizeManualValue === 'function') {
      window.factorySyncDbSizeManualValue('width_mm', '10.4cm', f);
      window.factorySyncDbSizeManualValue('depth_mm', '8.3cm', f);
      window.factorySyncDbSizeManualValue('weight', '14g', f);
    }
    if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(f);
    replaceFactory(f, {
      mode: 'hydrate',
      reason: 'cdp-integrity-v80',
      workspaceId,
    });
    let factory = readFactory();
    const hydrationOperationToken = readOperationToken();
    const appWorkspaceIdAfterHydrate = readAppWorkspaceId();
    const factoryWorkspaceIdAfterHydrate = String(factory.workspace?.id || factory.currentProjectId || '').trim();
    const authoritativeName = typeof window.factoryFinalRegistrationAuthoritativeProductName === 'function'
      ? window.factoryFinalRegistrationAuthoritativeProductName(factory)
      : '';
    const cleared = typeof window.factoryClearRestoredImageGenerationRuntime === 'function'
      ? window.factoryClearRestoredImageGenerationRuntime({ save: false, log: false })
      : false;
    factory = readFactory();
    const sizeFields = typeof window.factoryCollectDbSizeFieldModels === 'function'
      ? window.factoryCollectDbSizeFieldModels(factory).map(item => ({ fieldId: item.fieldId, value: item.value, source: item.source }))
      : [];
    const usableHero = typeof window.factoryUsableAssetsForStage === 'function'
      ? window.factoryUsableAssetsForStage('hero', factory).map(asset => asset.id)
      : [];
    await renderApp();
    const imgs = Array.from(document.images || []);
    return {
      expectedWorkspaceId: workspaceId,
      hydrationOperationToken,
      appWorkspaceIdAfterHydrate,
      factoryWorkspaceIdAfterHydrate,
      authoritativeName,
      productName: factory.product.productName,
      userProductName: factory.product.userProductName,
      currentProductKey: typeof window.factoryCurrentProductKey === 'function' ? window.factoryCurrentProductKey(factory) : '',
      currentInputKey: typeof window.factoryCurrentInputImageFingerprint === 'function' ? window.factoryCurrentInputImageFingerprint(factory) : '',
      hasProductPayload: !!(typeof window.currentProductImagePayload === 'function' && window.currentProductImagePayload({ allowDerived: false, prefer: 'factory' })?.base64),
      sizeFields,
      hasSizeFacts: typeof window.factoryHasSizeFacts === 'function' ? window.factoryHasSizeFacts() : null,
      cleared,
      cutsStatus: factory.stages.cuts.status,
      cutsMessage: factory.stages.cuts.message,
      usableHero,
      domNodes: document.querySelectorAll('*').length,
      imgCount: imgs.length,
      heavyDataImgCount: imgs.filter(img => /^data:image\\//i.test(String(img.src || '')) && String(img.src || '').length > 3000).length,
      placeholderDataImgCount: imgs.filter(img => /^data:image\\//i.test(String(img.src || '')) && String(img.src || '').length <= 3000).length,
      brokenImageCount: imgs.filter(img => img.complete && !img.naturalWidth && String(img.src || '')).length,
      renderMs: Number(document.documentElement.dataset.kuasangseRenderLastMs || 0)
    };
  }`);

  await waitFor(cdp, `(() => {
    const imgs = Array.from(document.images || []).filter(img => String(img.src || ''));
    return !imgs.length || imgs.every(img => img.complete && img.naturalWidth > 0);
  })()`, 5000).catch(() => {});
  const renderedImageState = await evaluate(cdp, `(() => {
    const imgs = Array.from(document.images || []);
    return {
      brokenImageCount: imgs.filter(img => img.complete && !img.naturalWidth && String(img.src || '')).length,
      brokenImageSrcs: imgs
        .filter(img => img.complete && !img.naturalWidth && String(img.src || ''))
        .slice(0, 5)
        .map(img => String(img.src || '').slice(0, 220)),
      visibleLoadedImageCount: imgs.filter(img => img.naturalWidth > 0 && getComputedStyle(img).display !== 'none').length,
      sampleSrcs: imgs.slice(0, 5).map(img => String(img.src || '').slice(0, 80))
    };
  })()`);
  result.renderedImageState = renderedImageState;
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(OUT_DIR, 'factory-integrity-cdp-v80.png');
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  cdp.close();
  await cdpRuntime.cleanup();
  const fieldValue = fieldId => result.sizeFields.find(item => item.fieldId === fieldId)?.value || '';
  assertChecks([
    {
      ok: result.hydrationOperationToken?.workspaceId === result.expectedWorkspaceId
        && result.hydrationOperationToken?.revision === 0,
      message: `hydrate operation token 불일치: ${JSON.stringify(result.hydrationOperationToken)}`,
    },
    {
      ok: result.appWorkspaceIdAfterHydrate === result.expectedWorkspaceId
        && result.factoryWorkspaceIdAfterHydrate === result.expectedWorkspaceId,
      message: `hydrate workspace 정합성 실패: ${JSON.stringify({
        expected: result.expectedWorkspaceId,
        app: result.appWorkspaceIdAfterHydrate,
        factory: result.factoryWorkspaceIdAfterHydrate,
      })}`,
    },
    { ok: result.authoritativeName === EXPECTED_PRODUCT_NAME, message: `상품명 우선순위 실패: ${result.authoritativeName}` },
    { ok: result.productName === EXPECTED_PRODUCT_NAME, message: `factory.product.productName 불일치: ${result.productName}` },
    { ok: result.userProductName === EXPECTED_PRODUCT_NAME, message: `factory.product.userProductName 불일치: ${result.userProductName}` },
    { ok: result.hasProductPayload, message: '현재 제품 원본 이미지 payload가 비어 있습니다.' },
    { ok: /10\.4/.test(fieldValue('width_mm')), message: `가로값 유실: ${fieldValue('width_mm')}` },
    { ok: /8\.3/.test(fieldValue('depth_mm')), message: `세로값 유실: ${fieldValue('depth_mm')}` },
    { ok: /14/.test(fieldValue('weight')), message: `무게값 유실: ${fieldValue('weight')}` },
    { ok: result.hasSizeFacts === true, message: '사이즈 필수값 완료 판정 실패' },
    { ok: result.cleared && result.cutsStatus === 'idle', message: `생성중 고착 정리 실패: ${result.cutsStatus}` },
    { ok: renderedImageState.brokenImageCount === 0, message: `깨진 이미지가 남았습니다: ${renderedImageState.brokenImageCount} · ${renderedImageState.brokenImageSrcs.join(' | ')}` },
    { ok: result.heavyDataImgCount <= 1, message: `무거운 data:image가 DOM에 남았습니다: ${result.heavyDataImgCount}` },
  ]);
  console.log(JSON.stringify({ url: APP_URL, result, screenshot }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
