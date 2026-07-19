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
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-project-file-cdp-v84.png');

function svgDataUrl(label, color = '#4f46e5') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
    <rect width="720" height="420" fill="#f8fafc"/>
    <rect x="80" y="90" width="560" height="240" rx="30" fill="${color}"/>
    <text x="360" y="220" text-anchor="middle" font-size="34" font-family="Arial" fill="#ffffff">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const testProjectId = `project_file_v84_${Date.now()}`;
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 860,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(
    cdp,
    '!!(window.state && window.render && window.buildFactoryProjectFileBundle && window.importFactoryProjectFileBundle && window.currentSessionAssetsPayload && window.ensureWorkspaceEditAuthority)',
    60000,
  );
  await evaluate(cdp, `(async () => {
    await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
    return true;
  })()`);
  await waitFor(cdp, `(() =>
    typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true &&
    typeof serverLastWorkHydrated !== 'undefined' && serverLastWorkHydrated === true &&
    typeof serverLastWorkHydrating !== 'undefined' && serverLastWorkHydrating === false &&
    typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false &&
    typeof persistentStateSaveRetryTimer !== 'undefined' && !persistentStateSaveRetryTimer &&
    typeof lastWorkSaveTimer !== 'undefined' && !lastWorkSaveTimer
  )()`, 60000);

  const proof = await evaluate(cdp, `(async () => {
    try {
    const img = ${JSON.stringify(svgDataUrl('kuasangse-file-v84', '#0f766e'))};
    const productName = '작업파일검증상품';
    const workspaceId = ${JSON.stringify(testProjectId)};
    const runId = 'run_project_file_v84';
    const inputFingerprint = 'fingerprint_project_file_v84';
    const productKey = window.factoryNormalizeIdentityText(productName);
    const base64 = img.includes(',') ? (img.split(',', 2)[1] || '') : img;

    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = productName;
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = productName;
    window.state.imagePreview = img;
    window.state.imageBase64 = base64;
    window.state.imageMime = 'image/svg+xml';
    window.state.imageName = 'project-file-input.svg';
    window.state.analysisImages = [{
      name: 'project-file-input.svg',
      mime: 'image/svg+xml',
      preview: img,
      base64,
    }];
    window.state.cuts = {
      prompts: [{
        id: 'embedded-foreign-prompt-v84',
        label: '작업파일 내부 다른 범위 결과',
        prompt: '텍스트는 보존',
        result: img,
        imageUrl: img,
        workspaceId,
        currentRunId: runId,
        productKey,
        inputImageFingerprint: inputFingerprint,
      }],
      sizePrompts: [{
        id: 'embedded-valid-size-prompt-v84',
        label: '현재 작업 사이즈 결과',
        prompt: '사이즈 결과 보존',
        result: img,
        stageId: 'size',
        workspaceId,
        currentRunId: runId,
        productKey,
        inputImageFingerprint: inputFingerprint,
      }],
    };
    window.state.optionSorter = window.normalizeOptionSorterState(window.defaultOptionSorterState());
    window.state.compPage = {};
    window.state.sectionContents = { header: { title: '작업파일 헤더', body: '작업파일 복원 검증 본문' } };
    window.state.sectionImages = { header: img };
    window.state.fixedDetailImages = window.normalizeFixedDetailImages({
      brand: { dataUrl: img, name: 'project-file-brand.svg', mime: 'image/svg+xml', updatedAt: Date.now() },
    });
    window.state.factory = window.normalizeFactoryState({});
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, { projectId: workspaceId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.lockedInputImageFingerprint = inputFingerprint;
    factory.product.inputImageFingerprint = inputFingerprint;
    factory.product.productKey = productKey;
    factory.product.productIdentityKey = productKey;
    factory.product.imagePreview = img;
    factory.product.imageBase64 = base64;
    factory.product.imageMime = 'image/svg+xml';
    factory.product.imageName = 'project-file-input.svg';
    factory.product.inputImages = [{
      id: 'input_project_file_v84',
      name: 'project-file-input.svg',
      preview: img,
      base64,
      mime: 'image/svg+xml',
      currentRunId: runId,
      productKey,
      inputImageFingerprint: inputFingerprint,
      workspaceId,
    }];
    factory.automation.currentRunId = runId;
    factory.automation.activeTab = 'assets';
    factory.assets = [
      window.normalizeFactoryAsset({
        id: 'asset_project_file_v84',
        title: '작업파일 대표컷',
        stageId: 'hero',
        type: 'image',
        image: img,
        mime: 'image/svg+xml',
        currentRunId: runId,
        generationRunId: runId,
        productKey,
        inputImageFingerprint: inputFingerprint,
        workspaceId,
        metadata: { productName, productKey, currentRunId: runId, inputImageFingerprint: inputFingerprint, workspaceId, currentProjectId: workspaceId },
        sourceMap: { productName, productKey, currentRunId: runId, inputImageFingerprint: inputFingerprint, workspaceId, currentProjectId: workspaceId },
      }, 0),
    ];
    factory.stages.hero = {
      ...(factory.stages.hero || {}),
      status: 'done',
      currentRunId: runId,
      latestGenerationRunId: runId,
      selectedAssetIds: ['asset_project_file_v84'],
    };

    const authorityBeforeBuild = await window.ensureWorkspaceEditAuthority('project:' + workspaceId);
    if (authorityBeforeBuild?.mode !== 'editing') {
      throw new Error('test scope acquire failed: ' + JSON.stringify(authorityBeforeBuild));
    }
    window.state.imagePreview = img;
    window.state.imageBase64 = base64;
    window.state.imageMime = 'image/svg+xml';
    window.state.imageName = 'project-file-input.svg';
    window.state.analysisImages = [{
      name: 'project-file-input.svg',
      mime: 'image/svg+xml',
      preview: img,
      base64,
    }];
    factory.product.imagePreview = img;
    factory.product.imageBase64 = base64;
    factory.product.imageMime = 'image/svg+xml';
    factory.product.imageName = 'project-file-input.svg';
    factory.product.inputImages = [{
      id: 'input_project_file_v84',
      name: 'project-file-input.svg',
      preview: img,
      base64,
      mime: 'image/svg+xml',
      currentRunId: runId,
      productKey,
      inputImageFingerprint: inputFingerprint,
      workspaceId,
    }];

    const fixtureImageState = {
      appBase64Length: String(window.state.imageBase64 || '').length,
      appPreviewLength: String(window.state.imagePreview || '').length,
      factoryBase64Length: String(factory.product.imageBase64 || '').length,
      factoryPreviewLength: String(factory.product.imagePreview || '').length,
      inputBase64Length: String(factory.product.inputImages?.[0]?.base64 || '').length,
      backup: window.compactProductImageBackupPayload?.() || null,
    };
    const bundle = await window.buildFactoryProjectFileBundle({ name: productName });
    const sanitizeProbeTarget = targetName => {
      const sourcePayload = JSON.parse(JSON.stringify(bundle.project?.payload?.assetPayload || {}));
      const sanitized = window.sanitizeLastWorkPayloadProductScope
        ? window.sanitizeLastWorkPayloadProductScope(sourcePayload, { targetName })
        : sourcePayload;
      const normalizedFactory = window.normalizeFactoryState(JSON.parse(JSON.stringify(sanitized.factory || {})));
      return {
        targetName,
        productName: normalizedFactory.product?.productName || '',
        assetIds: (normalizedFactory.assets || []).map(item => item.id),
        assetRejected: (normalizedFactory.assets || []).map(item => !!item.rejected),
        assetReasons: (normalizedFactory.assets || []).map(item => item.metadata?.rejectedReason || ''),
      };
    };
    const before = {
      format: bundle.format,
      version: bundle.version,
      projectId: bundle.project?.id || '',
      payloadProjectId: bundle.project?.payload?.currentProjectId || '',
      payloadWorkspaceId: bundle.project?.payload?.factory?.workspace?.id || '',
      inlineMode: bundle.project?.payload?.imagePersistence?.mode || '',
      assetPayloadInlineMode: bundle.project?.payload?.assetPayload?.imagePersistence?.mode || '',
      manifestSchema: bundle.manifest?.schema || '',
      payloadManifestSchema: bundle.project?.payload?.projectFileManifest?.schema || '',
      manifestIdentity: bundle.manifest?.identity || {},
      manifestImageTotal: Number(bundle.manifest?.images?.total || 0),
      manifestInlineTotal: Number(bundle.manifest?.images?.inline || 0),
      manifestMissingScopedFields: bundle.manifest?.images?.missingScopedFields || [],
      manifestAssetImage: (bundle.manifest?.images?.entries || []).find(item => String(item.path || '').includes('factory.assets') && item.assetId === 'asset_project_file_v84') || null,
      manifestSectionImage: (bundle.manifest?.images?.entries || []).find(item => String(item.path || '').includes('sectionImages.header')) || null,
      manifestProductImage: (bundle.manifest?.images?.entries || []).find(item => item.stageId === 'input') || null,
      manifestInputPaths: (bundle.manifest?.images?.entries || []).filter(item => item.stageId === 'input').map(item => item.path),
      assetPayloadAssetIds: (bundle.project?.payload?.assetPayload?.factory?.assets || []).map(item => item.id),
      assetImageLength: String(bundle.project?.payload?.assetPayload?.factory?.assets?.[0]?.image || '').length,
      productImageLength: Math.max(
        String(bundle.project?.payload?.assetPayload?.factory?.product?.imageBase64 || '').length,
        String(bundle.project?.payload?.assetPayload?.imageBase64 || '').length,
        String(bundle.project?.payload?.assetPayload?.productImageBackup?.primary?.base64 || '').length,
        String(bundle.project?.payload?.productImageBackup?.primary?.base64 || '').length,
      ),
      sectionImageLength: String(bundle.project?.payload?.assetPayload?.sectionImages?.header || '').length,
      fixedDetailImageLength: String(bundle.project?.payload?.fixedDetailImages?.brand?.dataUrl || '').length,
      embeddedCutPromptImageLength: String(bundle.project?.payload?.assetPayload?.cuts?.prompts?.[0]?.result || '').length,
      sanitizeWithFileProduct: sanitizeProbeTarget(productName),
      sanitizeWithOtherProduct: sanitizeProbeTarget('다른작업'),
    };

    window.state.currentProjectId = 'project_other_v84';
    window.state.currentProjectName = '다른작업';
    window.state.productName = '다른작업';
    window.state.imagePreview = null;
    window.state.imageBase64 = null;
    window.state.sectionContents = {};
    window.state.sectionImages = {};
    window.state.fixedDetailImages = window.normalizeFixedDetailImages({
      brand: { dataUrl: ${JSON.stringify(svgDataUrl('foreign-fixed-v84', '#7f1d1d'))}, name: 'foreign.svg' },
    });
    window.state.factory = window.normalizeFactoryState({});
    window.state.cuts = { ...(window.state.cuts || {}), foreignOnlyV84: 'remove-me' };
    window.state.optionSorter = window.normalizeOptionSorterState({
      ...window.defaultOptionSorterState(),
      foreignOnlyV84: 'remove-me',
    });
    window.state.compPage = { ...(window.state.compPage || {}), marketScrape: { selectedIds: ['foreign-v84'] } };
    localStorage.setItem('cuts_prompts_history', JSON.stringify([{
      updatedAt: Date.now() + 100000,
      prompts: [{ id: 'foreign-prompt-v84', label: '다른 작업 프롬프트', prompt: 'foreign-cut-prompt-v84' }],
    }]));
    localStorage.setItem('cuts_prompts_slot_backup', JSON.stringify({
      updatedAt: Date.now() + 100000,
      slots: { 0: { id: 'foreign-slot-v84', label: '다른 작업 슬롯', prompt: 'foreign-cut-slot-v84' } },
    }));

    window.__projectFileApplyDebug = [];
    const originalApplySessionAssetsPayload = window.applySessionAssetsPayload;
    if (typeof originalApplySessionAssetsPayload === 'function') {
      window.applySessionAssetsPayload = function wrappedApplySessionAssetsPayload(assets, options) {
        window.__projectFileApplyDebug.push({
          phase: 'before-apply-session-assets',
          optionKeys: Object.keys(options || {}),
          options,
          incomingAssetIds: (assets?.factory?.assets || []).map(item => item.id),
          incomingProductName: assets?.factory?.product?.productName || assets?.productName || '',
          stateProductName: window.state?.productName || '',
          stateFactoryProductName: window.state?.factory?.product?.productName || '',
          stateAssetIds: (window.state?.factory?.assets || []).map(item => item.id),
        });
        const result = originalApplySessionAssetsPayload.call(this, assets, options);
        window.__projectFileApplyDebug.push({
          phase: 'after-apply-session-assets',
          result,
          stateProductName: window.state?.productName || '',
          stateFactoryProductName: window.state?.factory?.product?.productName || '',
          stateAssetIds: (window.state?.factory?.assets || []).map(item => item.id),
          stateAssetRejected: (window.state?.factory?.assets || []).map(item => !!item.rejected),
          storageWarning: window.state?.storageWarning || '',
        });
        return result;
      };
    }
    const originalRefreshWorkspaceLists = window.refreshWorkspaceLists;
    window.refreshWorkspaceLists = async () => { throw new Error('post-commit-refresh-failure-v84'); };
    const imported = await window.importFactoryProjectFileBundle(bundle, { fileName: '작업파일검증상품.kuasangse', skipLeaveConfirm: true });
    const authorityAfterImport = window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null;
    window.refreshWorkspaceLists = originalRefreshWorkspaceLists;
    window.render();
    await new Promise(resolve => setTimeout(resolve, 100));

    const restoredFactory = window.factoryState();
    const bodyText = document.body.innerText || '';
    const stableBeforeTamper = {
      projectId: window.state.currentProjectId,
      projectName: window.state.currentProjectName,
      productName: window.state.productName,
      imagePreview: window.state.imagePreview,
      assetIds: (window.state.factory?.assets || []).map(item => item.id),
    };
    const tamperedBundle = JSON.parse(JSON.stringify(bundle));
    const tamperedEntry = (tamperedBundle.manifest?.images?.entries || [])
      .find(item => String(item.path || '').includes('factory.assets') && item.assetId === 'asset_project_file_v84');
    if (tamperedEntry) tamperedEntry.currentRunId = 'run_foreign_v84';
    let tamperError = '';
    try {
      await window.importFactoryProjectFileBundle(tamperedBundle, { skipLeaveConfirm: true });
    } catch (error) {
      tamperError = String(error?.message || error || '');
    }
    const duplicateBundle = JSON.parse(JSON.stringify(bundle));
    let duplicateError = '';
    if ((duplicateBundle.manifest?.images?.entries || []).length > 1) {
      duplicateBundle.manifest.images.entries[1] = JSON.parse(JSON.stringify(duplicateBundle.manifest.images.entries[0]));
      duplicateBundle.project.payload.projectFileManifest.images.entries[1] = JSON.parse(JSON.stringify(duplicateBundle.project.payload.projectFileManifest.images.entries[0]));
      try {
        await window.importFactoryProjectFileBundle(duplicateBundle, { skipLeaveConfirm: true });
      } catch (error) {
        duplicateError = String(error?.message || error || '');
      }
    }
    const beforePersistFailure = {
      projectId: window.state.currentProjectId,
      projectName: window.state.currentProjectName,
      productName: window.state.productName,
      imagePreview: window.state.imagePreview,
      assetIds: (window.state.factory?.assets || []).map(item => item.id),
    };
    const originalPersistProjectBundle = window.persistFactoryProjectBundleLocally;
    window.persistFactoryProjectBundleLocally = async () => { throw new Error('forced-idb-transaction-failure-v84'); };
    let persistFailureError = '';
    try {
      await window.importFactoryProjectFileBundle(bundle, { skipLeaveConfirm: true });
    } catch (error) {
      persistFailureError = String(error?.message || error || '');
    }
    window.persistFactoryProjectBundleLocally = originalPersistProjectBundle;
    const afterPersistFailure = {
      projectId: window.state.currentProjectId,
      projectName: window.state.currentProjectName,
      productName: window.state.productName,
      imagePreview: window.state.imagePreview,
      assetIds: (window.state.factory?.assets || []).map(item => item.id),
    };
    window.render();
    const stableAfterTamper = {
      projectId: window.state.currentProjectId,
      projectName: window.state.currentProjectName,
      productName: window.state.productName,
      imagePreview: window.state.imagePreview,
      assetIds: (window.state.factory?.assets || []).map(item => item.id),
    };
    return {
      before,
      imported,
      fixtureImageState,
      authorityBeforeBuild,
      authorityAfterImport,
      applySessionFunctionHasForce: String(window.applySessionAssetsPayload || '').includes('forceProductRestore'),
      applyDebug: window.__projectFileApplyDebug || [],
      currentProjectId: window.state.currentProjectId,
      currentProjectName: window.state.currentProjectName,
      productName: restoredFactory.product?.productName || window.state.productName || '',
      imagePreview: window.state.imagePreview || '',
      imageBase64Length: String(window.state.imageBase64 || '').length,
      factoryWorkspaceId: restoredFactory.workspace?.id || '',
      factoryProductWorkspaceId: restoredFactory.product?.inputImages?.[0]?.workspaceId || '',
      rawStateAssetIds: (window.state.factory?.assets || []).map(item => item.id),
      rawStateAssetRejected: (window.state.factory?.assets || []).map(item => !!item.rejected),
      storageWarning: window.state.storageWarning || '',
      assetIds: (restoredFactory.assets || []).map(item => item.id),
      assetWorkspaceIds: (restoredFactory.assets || []).map(item => item.workspaceId || ''),
      sectionContentTitle: window.state.sectionContents?.header?.title || '',
      sectionImageLength: String(window.state.sectionImages?.header || '').length,
      fixedDetailImageRestored: window.state.fixedDetailImages?.brand?.dataUrl === img,
      replacementRemovedForeignState: !window.state.cuts?.foreignOnlyV84
        && !window.state.optionSorter?.foreignOnlyV84
        && !(window.state.compPage?.marketScrape?.selectedIds || []).includes('foreign-v84'),
      replacementRemovedForeignPromptBackup: !(window.state.cuts?.prompts || [])
        .some(item => /foreign-cut-(?:prompt|slot)-v84/.test(String(item?.prompt || ''))),
      embeddedForeignPromptImageRemoved: (window.state.cuts?.prompts || [])
        .some(item => item?.id === 'embedded-foreign-prompt-v84' && item?.prompt === '텍스트는 보존' && !item?.result && !item?.image && !item?.imageUrl),
      embeddedValidSizePromptImagePreserved: (window.state.cuts?.sizePrompts || [])
        .some(item => item?.id === 'embedded-valid-size-prompt-v84' && item?.stageId === 'size' && item?.result === img),
      bodyHasCurrentSaveButton: bodyText.includes('현재 상태 저장'),
      bodyHasSaveAsButton: bodyText.includes('다른 이름으로 저장'),
      bodyHasImportButton: bodyText.includes('작업파일 불러오기') || bodyText.includes('파일 불러오기'),
      bodyHasProjectId: bodyText.includes(workspaceId),
      tamperError,
      duplicateError,
      persistFailureError,
      persistFailurePreservedState: JSON.stringify(beforePersistFailure) === JSON.stringify(afterPersistFailure),
      tamperPreservedState: JSON.stringify(stableBeforeTamper) === JSON.stringify(stableAfterTamper),
      restoreStatusText: document.getElementById('workfileSaveStatus')?.textContent?.trim() || '',
    };
    } catch (error) {
      return {
        __error: String(error && (error.stack || error.message) || error),
      };
    }
  })()`);
  if (proof.__error) throw new Error(proof.__error);

  await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then(result => fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));

  console.log(JSON.stringify({ proofBeforeAssert: proof }, null, 2));

  assertChecks([
    { ok: proof.before.format === 'kuasangse.factory.project', message: '작업파일 format이 올바르지 않습니다.' },
    { ok: proof.before.version === 1, message: '작업파일 version이 올바르지 않습니다.' },
    { ok: proof.before.projectId === testProjectId, message: '작업파일 project.id가 현재 작업 ID가 아닙니다.' },
    { ok: proof.before.payloadProjectId === testProjectId, message: 'payload currentProjectId가 보존되지 않았습니다.' },
    { ok: proof.before.payloadWorkspaceId === testProjectId, message: 'payload factory.workspace.id가 보존되지 않았습니다.' },
    { ok: proof.before.inlineMode === 'kuasangse-file-inline', message: '작업파일이 이미지 포함 모드로 표시되지 않았습니다.' },
    { ok: proof.before.assetPayloadInlineMode === 'inline', message: 'assetPayload가 이미지 포함 모드가 아닙니다.' },
    { ok: proof.before.manifestSchema === 'kuasangse.factory.project.manifest', message: '작업파일 manifest가 bundle에 없습니다.' },
    { ok: proof.before.payloadManifestSchema === 'kuasangse.factory.project.manifest', message: '작업파일 manifest가 payload에 없습니다.' },
    { ok: proof.before.manifestIdentity?.workspaceId === testProjectId, message: 'manifest workspaceId가 현재 작업 ID가 아닙니다.' },
    { ok: proof.before.manifestIdentity?.currentRunId === 'run_project_file_v84', message: 'manifest currentRunId가 보존되지 않았습니다.' },
    { ok: !!proof.before.manifestIdentity?.productKey, message: 'manifest productKey가 비었습니다.' },
    { ok: proof.before.manifestIdentity?.inputImageFingerprint === 'fingerprint_project_file_v84', message: 'manifest inputImageFingerprint가 보존되지 않았습니다.' },
    { ok: proof.before.manifestImageTotal >= 3 && proof.before.manifestInlineTotal >= 3, message: 'manifest가 제품/후보/섹션 이미지 항목을 충분히 기록하지 않았습니다.' },
    { ok: !!proof.before.manifestAssetImage, message: 'manifest에 생성 후보 이미지 항목이 없습니다.' },
    { ok: proof.before.manifestAssetImage?.currentRunId === 'run_project_file_v84', message: 'manifest 후보 이미지 runId가 보존되지 않았습니다.' },
    { ok: !!proof.before.manifestIdentity?.productKey && proof.before.manifestAssetImage?.productKey === proof.before.manifestIdentity.productKey, message: 'manifest 후보 이미지 productKey가 보존되지 않았습니다.' },
    { ok: proof.before.manifestAssetImage?.inputImageFingerprint === 'fingerprint_project_file_v84', message: 'manifest 후보 이미지 inputImageFingerprint가 보존되지 않았습니다.' },
    { ok: proof.before.manifestAssetImage?.stageId === 'hero', message: 'manifest 후보 이미지 stageId가 보존되지 않았습니다.' },
    { ok: !!proof.before.manifestProductImage, message: 'manifest에 기본 이미지 항목이 없습니다.' },
    { ok: !!proof.before.manifestSectionImage, message: 'manifest에 섹션 이미지 항목이 없습니다.' },
    { ok: proof.before.assetImageLength > 100, message: '생성 후보 이미지가 작업파일 안에 포함되지 않았습니다.' },
    { ok: proof.before.productImageLength > 100, message: '제품 기본 이미지가 작업파일 안에 포함되지 않았습니다.' },
    { ok: proof.before.sectionImageLength > 100, message: '섹션 이미지가 작업파일 안에 포함되지 않았습니다.' },
    { ok: proof.before.fixedDetailImageLength > 100, message: '고정 상세 이미지가 작업파일 안에 포함되지 않았습니다.' },
    { ok: proof.before.embeddedCutPromptImageLength > 100, message: '검증용 다른 범위 프롬프트 결과 이미지가 작업파일에 포함되지 않았습니다.' },
    { ok: proof.authorityBeforeBuild?.mode === 'editing' && proof.authorityBeforeBuild?.scopeId === `project:${testProjectId}`, message: '검증 작업 범위의 정상 편집권을 얻지 못했습니다.' },
    { ok: proof.authorityAfterImport?.mode === 'editing' && proof.authorityAfterImport?.scopeId === `project:${testProjectId}`, message: '작업파일 import 중 검증 작업 편집권이 바뀌었습니다.' },
    { ok: proof.currentProjectId === testProjectId, message: '작업파일 import 후 currentProjectId가 복원되지 않았습니다.' },
    { ok: proof.currentProjectName === '작업파일검증상품', message: '작업파일 import 후 저장 이름이 복원되지 않았습니다.' },
    { ok: proof.productName === '작업파일검증상품', message: '작업파일 import 후 상품명이 복원되지 않았습니다.' },
    { ok: proof.imageBase64Length > 100 || String(proof.imagePreview || '').startsWith('data:'), message: '작업파일 import 후 제품 이미지가 복원되지 않았습니다.' },
    { ok: proof.factoryWorkspaceId === testProjectId, message: '작업파일 import 후 factory.workspace.id가 복원되지 않았습니다.' },
    { ok: proof.assetIds.includes('asset_project_file_v84'), message: '작업파일 import 후 생성 후보가 복원되지 않았습니다.' },
    { ok: proof.assetWorkspaceIds.every(id => id === testProjectId), message: '작업파일 import 후 후보 workspaceId가 현재 작업으로 찍히지 않았습니다.' },
    { ok: proof.sectionContentTitle === '작업파일 헤더', message: '작업파일 import 후 섹션 내용이 복원되지 않았습니다.' },
    { ok: proof.sectionImageLength > 100, message: '작업파일 import 후 섹션 이미지가 복원되지 않았습니다.' },
    { ok: proof.fixedDetailImageRestored, message: '다른 문서 고정 상세 이미지가 남거나 저장된 고정 이미지가 복원되지 않았습니다.' },
    { ok: proof.replacementRemovedForeignState, message: '다른 작업파일의 컷/옵션/마켓 선택 상태가 병합되었습니다.' },
    { ok: proof.replacementRemovedForeignPromptBackup, message: '다른 작업의 로컬 컷 프롬프트 백업이 병합되었습니다.' },
    { ok: proof.embeddedForeignPromptImageRemoved, message: '작업파일 내부의 다른 범위 컷 결과 이미지가 현재 프롬프트에 남았습니다.' },
    { ok: proof.embeddedValidSizePromptImagePreserved, message: '현재 범위의 정상 사이즈컷 결과 이미지가 제거되었습니다.' },
    { ok: proof.bodyHasCurrentSaveButton && proof.bodyHasSaveAsButton && proof.bodyHasImportButton, message: '조립공장 화면에 현재 상태 저장/다른 이름으로 저장/불러오기 버튼이 모두 보이지 않습니다.' },
    { ok: proof.bodyHasProjectId, message: '조립공장 화면에 현재 저장 ID가 보이지 않습니다.' },
    { ok: proof.tamperError.includes('작업파일 이미지 범위 불일치'), message: `변조 작업파일이 거부되지 않았습니다: ${proof.tamperError}` },
    { ok: proof.duplicateError.includes('중복 이미지 경로'), message: `중복 manifest 경로가 거부되지 않았습니다: ${proof.duplicateError}` },
    { ok: proof.persistFailureError.includes('forced-idb-transaction-failure-v84') && proof.persistFailurePreservedState, message: `IndexedDB 실패 후 기존 화면이 보존되지 않았습니다: ${proof.persistFailureError}` },
    { ok: proof.tamperPreservedState, message: '변조 작업파일 거부 후 기존 화면 상태가 바뀌었습니다.' },
    { ok: proof.restoreStatusText.includes('불러오기 실패') && proof.restoreStatusText.includes('기존 작업 유지'), message: `복원 실패 상태가 상단에 표시되지 않습니다: ${proof.restoreStatusText}` },
  ]);

  console.log(JSON.stringify({ ok: true, proof, screenshot: SCREENSHOT_PATH }, null, 2));
  } finally {
    try {
      await evaluate(cdp, '(async () => { try { await window.__KUASANGSE_WORKSPACE_LOCK__?.release?.(); } catch (_) {} return true; })()');
    } catch (_) {}
    try { cdp.close(); } catch (_) {}
    if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
