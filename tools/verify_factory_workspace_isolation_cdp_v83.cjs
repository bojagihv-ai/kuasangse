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
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-workspace-isolation-cdp-v83.png');

function svgDataUrl(label, color = '#2563eb') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
    <rect width="640" height="420" fill="#f8fafc"/>
    <rect x="80" y="95" width="480" height="230" rx="28" fill="${color}"/>
    <text x="320" y="220" text-anchor="middle" font-size="32" font-family="Arial" fill="#ffffff">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
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
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryAssetMatchesCurrentJob === 'function'`, 60000);

  const proof = await evaluateFactoryCdpFixture(cdp, `async ({
    setAppState,
    readAppState,
    cloneFactory,
    replaceFactory,
    renderApp,
  }) => {
    const img = ${JSON.stringify(svgDataUrl('workspace-current', '#0f766e'))};
    const productName = '작업파일격리검증상품';
    const workspaceId = 'project_workspace_current_v83';
    const foreignWorkspaceId = 'project_workspace_foreign_v83';
    const runId = 'run_workspace_v83';
    const inputFingerprint = window.factoryImagePayloadFingerprint(img);
    const productKey = window.factoryNormalizeIdentityText(productName);

    const createdAt = Date.now();
    const imageBase64 = img.replace(/^data:image\\/[^;,]+;base64,/i, '');
    setAppState({
      step: 'factory',
      currentProjectId: workspaceId,
      currentProjectName: productName,
      currentProjectCreatedAt: createdAt,
      productName,
      imagePreview: img,
      imageBase64,
      imageMime: 'image/svg+xml',
    });
    const scopeId = 'project:' + workspaceId;
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    const ownerId = 'workspace isolation v83 · ' + lock.snapshot().sessionId.slice(-6);
    const authority = await lock.acquire({ scopeId, ownerId });
    if (authority.mode !== 'editing') throw new Error('workspace isolation authority acquisition failed: ' + authority.mode);
    const factory = cloneFactory();
    window.factoryStampWorkspaceIdentity(factory, { projectId: workspaceId, projectName: productName, createdAt });
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.lockedInputImageFingerprint = inputFingerprint;
    factory.product.imageBase64 = imageBase64;
    factory.product.imagePreview = img;
    factory.product.imageMime = 'image/svg+xml';
    factory.product.inputImages = [{
      id: 'input_workspace_v83',
      name: 'workspace-input.svg',
      base64: imageBase64,
      preview: img,
      mime: 'image/svg+xml',
      currentRunId: runId,
      productKey,
      inputImageFingerprint: inputFingerprint,
      workspaceId,
    }];
    factory.automation.currentRunId = runId;
    factory.automation.activeTab = 'assets';
    factory.stages.hero = {
      ...(factory.stages.hero || {}),
      status: 'done',
      currentRunId: runId,
      latestGenerationRunId: runId,
      selectedAssetIds: [],
    };

    const baseAsset = {
      stageId: 'hero',
      type: 'image',
      image: img,
      mime: 'image/svg+xml',
      currentRunId: runId,
      generationRunId: runId,
      productKey,
      inputImageFingerprint: inputFingerprint,
      metadata: { productName, productKey, inputImageFingerprint: inputFingerprint, currentRunId: runId, stageId: 'hero' },
      sourceMap: { productName, productKey, inputImageFingerprint: inputFingerprint, currentRunId: runId, stageId: 'hero' },
    };
    const currentAsset = window.normalizeFactoryAsset({
      ...baseAsset,
      id: 'asset_workspace_current_v83',
      title: '현재 저장파일 대표컷',
      workspaceId,
      metadata: { ...baseAsset.metadata, workspaceId, currentProjectId: workspaceId },
      sourceMap: { ...baseAsset.sourceMap, workspaceId, currentProjectId: workspaceId },
    }, 0);
    const foreignAsset = window.normalizeFactoryAsset({
      ...baseAsset,
      id: 'asset_workspace_foreign_v83',
      title: '다른 저장파일 대표컷',
      workspaceId: foreignWorkspaceId,
      metadata: { ...baseAsset.metadata, workspaceId: foreignWorkspaceId, currentProjectId: foreignWorkspaceId },
      sourceMap: { ...baseAsset.sourceMap, workspaceId: foreignWorkspaceId, currentProjectId: foreignWorkspaceId },
    }, 1);
    const unscopedAsset = window.normalizeFactoryAsset({
      ...baseAsset,
      id: 'asset_workspace_missing_v83',
      title: 'workspace 없는 대표컷',
    }, 2);
    delete unscopedAsset.workspaceId;
    delete unscopedAsset.currentProjectId;
    if (unscopedAsset.metadata) {
      delete unscopedAsset.metadata.workspaceId;
      delete unscopedAsset.metadata.currentProjectId;
    }
    if (unscopedAsset.sourceMap) {
      delete unscopedAsset.sourceMap.workspaceId;
      delete unscopedAsset.sourceMap.currentProjectId;
    }
    factory.assets = [currentAsset, foreignAsset, unscopedAsset];
    replaceFactory(factory);

    const currentJob = window.factoryAssetMatchesCurrentJob(currentAsset, 'hero', factory);
    const foreignJob = window.factoryAssetMatchesCurrentJob(foreignAsset, 'hero', factory);
    const unscopedJob = window.factoryAssetMatchesCurrentJob(unscopedAsset, 'hero', factory, { strictScope: true });
    const usable = window.factoryUsableAssetsForStage('hero', factory);
    const archivePayload = window.factoryLocalArchivePayload(currentAsset, 'workspace-isolation-test');
    const workspacePayload = window.buildWorkspacePayload({ productImageBackup: null });
    const matchingWorkspaceArchiveMatches = window.factoryLocalArchiveMatchesCurrentWork({
      workspaceId,
      stageId: 'section_header',
      productName,
      productKey,
      currentRunId: runId,
      inputImageFingerprint: inputFingerprint,
    }, factory);
    const missingWorkspaceArchiveMatches = window.factoryLocalArchiveMatchesCurrentWork({
      stageId: 'section_header',
      productName,
      productKey,
      currentRunId: runId,
      inputImageFingerprint: inputFingerprint,
    }, factory);
    factory.product.currentRunId = '';
    factory.product.generationRunId = '';
    factory.automation.currentRunId = '';
    factory.goalRun.currentRunId = '';
    factory.archive.localRunId = '';
    const observedMissingCurrentRunId = window.factoryCurrentWorkflowRunId(factory);
    const missingCurrentRunArchiveMatches = window.factoryLocalArchiveMatchesCurrentWork({
      workspaceId,
      stageId: 'section_header',
      productName,
      productKey,
      currentRunId: 'run_workspace_foreign_v83',
      inputImageFingerprint: inputFingerprint,
    }, factory);
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.automation.currentRunId = runId;
    factory.goalRun.currentRunId = runId;
    replaceFactory(factory);
    const sectionBeforeDirectLoad = JSON.stringify(readAppState().sectionContents?.header || null);
    const originalFetch = window.fetch;
    const scopedRecord = {
      archiveId: 'archive_direct_scope_v83',
      workspaceId,
      productName,
      productKey,
      currentRunId: runId,
      inputImageFingerprint: inputFingerprint,
      stageId: 'section_header',
    };
    window.fetch = async url => {
      const foreignEverywhere = String(url).includes('foreign-scope');
      const currentEverywhere = String(url).includes('current-scope');
      const foreignWorkspace = foreignWorkspaceId;
      const assetWorkspace = currentEverywhere ? workspaceId : foreignWorkspace;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          record: foreignEverywhere ? { ...scopedRecord, workspaceId: foreignWorkspace } : scopedRecord,
          asset: {
            ...scopedRecord,
            workspaceId: assetWorkspace,
            metadata: { ...scopedRecord, workspaceId: assetWorkspace },
            sourceMap: { ...scopedRecord, workspaceId: assetWorkspace },
            content: { headline: currentEverywhere ? 'CURRENT-DIRECT-LOAD' : 'TAMPERED-DIRECT-LOAD' },
          },
          metadata: {
            identity: foreignEverywhere ? { ...scopedRecord, workspaceId: foreignWorkspace } : scopedRecord,
            metadata: foreignEverywhere ? { ...scopedRecord, workspaceId: foreignWorkspace } : scopedRecord,
            sourceMap: foreignEverywhere ? { ...scopedRecord, workspaceId: foreignWorkspace } : scopedRecord,
          },
          imageDataUrl: img,
        }),
      };
    };
    const conflictingWrapperLoadOk = await window.factoryLoadLocalArchiveAsset('conflicting-wrapper', { silent: true });
    const foreignScopeLoadOk = await window.factoryLoadLocalArchiveAsset('foreign-scope', { silent: true });
    const sectionAfterRejectedLoads = JSON.stringify(readAppState().sectionContents?.header || null);
    const currentScopeLoadOk = await window.factoryLoadLocalArchiveAsset('current-scope', { silent: true });
    window.fetch = originalFetch;
    const currentScopeHeadline = String(readAppState().sectionContents?.header?.headline || '');
    renderApp();

    return {
      workspaceId,
      factoryWorkspaceId: factory.workspace?.id || '',
      currentJobOk: !!currentJob.ok,
      currentJobMismatches: currentJob.mismatches || [],
      foreignJobOk: !!foreignJob.ok,
      foreignJobMismatches: foreignJob.mismatches || [],
      unscopedJobOk: !!unscopedJob.ok,
      unscopedJobMismatches: unscopedJob.mismatches || [],
      matchingWorkspaceArchiveMatches,
      missingWorkspaceArchiveMatches,
      observedMissingCurrentRunId,
      missingCurrentRunArchiveMatches,
      conflictingWrapperLoadOk,
      foreignScopeLoadOk,
      directLoadSectionUnchanged: sectionAfterRejectedLoads === sectionBeforeDirectLoad,
      currentScopeLoadOk,
      currentScopeHeadline,
      usableIds: usable.map(item => item.id),
      archiveWorkspaceId: archivePayload.workspaceId || '',
      archiveAssetWorkspaceId: archivePayload.asset?.workspaceId || '',
      payloadCurrentProjectId: workspacePayload.currentProjectId || '',
      payloadFactoryWorkspaceId: workspacePayload.factory?.workspace?.id || '',
      bodyHasProjectId: /project_workspace_current_v83/.test(document.body.innerText || ''),
    };
  }`);

  await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then(result => fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));

  assertChecks([
    { ok: proof.factoryWorkspaceId === proof.workspaceId, message: 'factory.workspace.id가 현재 저장파일 ID가 아닙니다.' },
    { ok: proof.currentJobOk, message: `현재 저장파일 asset이 거부되었습니다: ${JSON.stringify(proof.currentJobMismatches)}` },
    { ok: !proof.foreignJobOk && proof.foreignJobMismatches.includes('workspaceId'), message: `다른 저장파일 asset이 workspaceId mismatch로 거부되지 않았습니다: ${JSON.stringify(proof.foreignJobMismatches)}` },
    { ok: !proof.unscopedJobOk && proof.unscopedJobMismatches.includes('workspaceId'), message: `workspaceId 없는 asset이 거부되지 않았습니다: ${JSON.stringify(proof.unscopedJobMismatches)}` },
    { ok: proof.matchingWorkspaceArchiveMatches === true, message: '현재 workspaceId의 로컬 아카이브가 현재 작업으로 판정되지 않았습니다.' },
    { ok: proof.missingWorkspaceArchiveMatches === false, message: 'workspaceId 없는 로컬 아카이브가 현재 작업으로 판정되었습니다.' },
    { ok: proof.observedMissingCurrentRunId === '', message: `현재 runId가 완전히 비워지지 않았습니다: ${proof.observedMissingCurrentRunId}` },
    { ok: proof.missingCurrentRunArchiveMatches === false, message: '현재 runId가 없는 작업에 외부 run 아카이브가 허용됐습니다.' },
    { ok: proof.conflictingWrapperLoadOk === false, message: '서로 충돌하는 archive 래퍼가 직접 로드됐습니다.' },
    { ok: proof.foreignScopeLoadOk === false, message: '외부 workspace archive가 직접 로드됐습니다.' },
    { ok: proof.directLoadSectionUnchanged === true, message: '거부된 직접 로드가 현재 섹션 내용을 변경했습니다.' },
    { ok: proof.currentScopeLoadOk === true, message: '정확히 일치하는 현재 workspace archive가 직접 로드되지 않았습니다.' },
    { ok: proof.currentScopeHeadline === 'CURRENT-DIRECT-LOAD', message: `현재 workspace archive 내용이 적용되지 않았습니다: ${proof.currentScopeHeadline}` },
    { ok: proof.usableIds.includes('asset_workspace_current_v83'), message: '현재 저장파일 asset이 사용 가능 후보에 없습니다.' },
    { ok: !proof.usableIds.includes('asset_workspace_foreign_v83'), message: '다른 저장파일 asset이 사용 가능 후보에 섞였습니다.' },
    { ok: proof.archiveWorkspaceId === proof.workspaceId && proof.archiveAssetWorkspaceId === proof.workspaceId, message: '로컬 보관 payload에 저장파일 ID가 찍히지 않았습니다.' },
    { ok: proof.payloadCurrentProjectId === proof.workspaceId && proof.payloadFactoryWorkspaceId === proof.workspaceId, message: '작업 저장 payload에 저장파일 ID가 보존되지 않았습니다.' },
    { ok: proof.bodyHasProjectId, message: '작업파일 UI에 현재 저장 ID가 보이지 않습니다.' },
  ]);

  console.log(JSON.stringify({ ok: true, proof, screenshot: SCREENSHOT_PATH }, null, 2));
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
