const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');
const { waitForArchiveQuiet } = require('./factory_archive_quiet.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL
  || process.env.KUASANGSE_BACKEND_BASE
  || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-new-file-blank-cdp-v85.png');
const RELOAD_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-new-file-blank-reload-cdp-v85.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-new-file-blank-cdp-v85-result.json');
const ARCHIVE_ROOT = path.resolve(
  process.env.KUASANGSE_LOCAL_ARCHIVE_FOLDER
    || path.join(process.cwd(), 'output', 'local-archive'),
);
let activeCdp = null;
let activeCdpRuntime = null;

async function cleanupActiveCdp() {
  const cdp = activeCdp;
  const runtime = activeCdpRuntime;
  activeCdp = null;
  activeCdpRuntime = null;
  if (cdp) cdp.close();
  if (runtime?.cleanup) await runtime.cleanup();
}

function svgDataUrl(label, color = '#7c3aed') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
    <rect width="720" height="420" fill="#f8fafc"/>
    <rect x="70" y="86" width="580" height="248" rx="30" fill="${color}"/>
    <text x="360" y="220" text-anchor="middle" font-size="34" font-family="Arial" fill="#ffffff">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function archiveSnapshot(root) {
  const files = [];
  if (!fs.existsSync(root)) {
    return { exists: false, count: 0, files };
  }
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        files.push({
          rel: path.relative(root, full).replace(/\\/g, '/'),
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
        });
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { exists: true, count: files.length, files };
}

function missingArchiveFiles(before, after) {
  const afterMap = new Map((after.files || []).map(file => [file.rel, file]));
  return (before.files || []).filter(file => {
    if (file.rel === 'index.json') return false;
    const next = afterMap.get(file.rel);
    return !next || next.size !== file.size;
  });
}

function addedArchiveFiles(before, after) {
  const beforeSet = new Set((before.files || []).map(file => file.rel));
  return (after.files || []).filter(file => file.rel !== 'index.json' && !beforeSet.has(file.rel));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await waitForArchiveQuiet(ARCHIVE_ROOT);
  const archiveBefore = archiveSnapshot(ARCHIVE_ROOT);
  const cdpRuntime = await ensureCdp(CDP_URL);
  activeCdpRuntime = cdpRuntime;
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  activeCdp = cdp;
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)}); } catch (_) {}`,
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(
    cdp,
    `${factoryCdpFixtureReadyExpression()}
      && typeof startBlankWorkDraft === 'function'
      && typeof currentSessionAssetsPayload === 'function'
      && typeof workspacePersistenceApi === 'function'`,
    60000,
  );
  await evaluate(cdp, `(async () => {
    await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
    return true;
  })()`);
  const authorityScope = `draft:save03_${Date.now()}_${process.pid}`;
  const proof = await evaluate(cdp, `(async () => {
    const img = ${JSON.stringify(svgDataUrl('new-file-before-v85-isolated', '#be123c'))};
    const base64 = img.split(',', 2)[1] || '';
    const productName = '새파일검증이전상품';
    const workspaceId = '';
    const previousProjectId = 'save03_previous_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const previousWorkspaceScope = workspacePersistenceApi().normalizeProjectScope(previousProjectId);
    const authorityScope = getCurrentLastWorkWorkspaceScope();
    const runId = 'run_new_file_old_v85';
    const inputFingerprint = window.factoryImagePayloadFingerprint(base64);
    const productKey = window.factoryNormalizeIdentityText(productName);
    const authorityBeforeSeed = await ensureWorkspaceEditAuthority(authorityScope, { force: true });
    if (authorityBeforeSeed?.mode !== 'offline-edit' || authorityBeforeSeed?.scopeId !== authorityScope) {
      throw new Error('SAVE-03 isolated workspace authority acquisition failed: ' + JSON.stringify(authorityBeforeSeed));
    }

    window.state.step = 'factory';
    window.state.currentProjectId = '';
    window.state.currentProjectName = productName;
    window.state.currentProjectCreatedAt = Date.now();
    window.state.workspaceDocumentDirty = true;
    window.state.productName = productName;
    window.state.imagePreview = img;
    window.state.imageBase64 = base64;
    window.state.imageMime = 'image/svg+xml';
    window.state.analysis = { product_name: productName, summary: '새 파일 전 상태' };
    window.state.analysisImages = [{ name: 'before.svg', mime: 'image/svg+xml', preview: img, base64, inputImageFingerprint: inputFingerprint }];
    window.state.dbMatchCandidates = [{ id: 'foreign_db_candidate_v85', productName: '이전 DB 후보', productKey: 'old_product_key' }];
    window.state.sectionContents = { header: { title: '이전 헤더', body: '이전 상세 본문' } };
    window.state.sectionImages = { header: img };
    window.state.detailImageBlocks = [{ id: 'old_detail_image_v85', dataUrl: img, sectionId: 'header' }];
    window.state.cuts = {
      results: [{ id: 'old_cut_v85', image: img, stageId: 'cuts' }],
      prompts: [{
        id: 'old_prompt_v85',
        label: '이전 프롬프트',
        prompt: '문장만 유지',
        imageUrl: img,
        result: img,
        workspaceId,
        currentRunId: runId,
        productKey,
        inputImageFingerprint: inputFingerprint,
        stageId: 'cuts',
      }],
    };
    window.state.optionSorter = { images: [{ id: 'old_option_v85', image: img }] };
    window.state.compPage = { ...(window.state.compPage || {}), uploadedImages: [{ id: 'old_comp_upload_v85', dataUrl: img }], evidenceImages: [{ id: 'old_comp_evidence_v85', dataUrl: img }] };
    const factory = normalizeFactoryState({});
    factoryStampWorkspaceIdentity(factory, { projectId: workspaceId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
    factory.workspace.id = previousProjectId;
    factory.currentProjectId = '';
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.lockedInputImageFingerprint = inputFingerprint;
    factory.product.imagePreview = img;
    factory.product.imageBase64 = base64;
    factory.product.imageMime = 'image/svg+xml';
    factory.product.inputImages = [{
      id: 'input_new_file_old_v85',
      name: 'before.svg',
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
    factory.assets = [normalizeFactoryAsset({
      id: 'asset_new_file_old_v85',
      title: '이전 대표컷',
      stageId: 'hero',
      type: 'image',
      image: img,
      currentRunId: runId,
      generationRunId: runId,
      productKey,
      inputImageFingerprint: inputFingerprint,
      workspaceId,
      metadata: { productName, productKey, currentRunId: runId, inputImageFingerprint: inputFingerprint, stageId: 'hero', workspaceId },
      sourceMap: { productName, productKey, currentRunId: runId, inputImageFingerprint: inputFingerprint, stageId: 'hero', workspaceId },
    }, 0)];
    factoryRuntimeReplaceFactorySnapshot(factory, { reason: 'save03-seed' });
    window.sessionStorage.setItem('pdp_session', JSON.stringify(window.currentSessionAssetsPayload({ includeImages: true })));
    if (typeof compactProductImageBackupPayload === 'function' && typeof workspacePersistenceApi === 'function') {
      const imageBackup = compactProductImageBackupPayload();
      if (imageBackup?.primary) await workspacePersistenceApi().savePreference(imageBackup);
    }
    await window.workspaceSessionSetItem('kuasangse.projectFileLocationLabel.v1', productName + '.kuasangse');
    window.confirmSaveBeforeLeavingWorkspace = async () => 'continue';
    await window.render();

    const beforeText = document.body.innerText || '';
    const button =
      document.getElementById('factoryWorkspaceNewWorkBtn') ||
      document.getElementById('factoryNewWorkBtn') ||
      document.getElementById('blankWorkBtn');
    if (!button) throw new Error('새 작업 버튼을 찾지 못했습니다.');
    const sampleState = label => ({
      label,
      productName: window.state.productName || '',
      imagePreview: window.state.imagePreview || '',
      analysisImages: (window.state.analysisImages || []).length,
      factoryProductName: factoryRuntimeReadFactory().product?.productName || '',
      sessionAssetsHydrated: typeof sessionAssetsHydrated === 'undefined' ? null : sessionAssetsHydrated,
      serverLastWorkHydrating: typeof serverLastWorkHydrating === 'undefined' ? null : serverLastWorkHydrating,
      workspaceBlankResetToken: typeof workspaceBlankResetToken === 'undefined' ? null : workspaceBlankResetToken,
    });
    const fenceTrace = [];
    const originalWorkspaceDocumentFenceIsCurrent = workspaceDocumentFenceIsCurrent;
    workspaceDocumentFenceIsCurrent = fence => {
      const result = originalWorkspaceDocumentFenceIsCurrent(fence);
      if (fenceTrace.length < 24) {
        fenceTrace.push({
          fence: fence ? { ...fence } : null,
          result,
          currentScope: getCurrentLastWorkWorkspaceScope(),
          factoryScope: factoryRuntimeReadFactory().workspace?.id || '',
          resetToken: workspaceBlankResetToken,
          resetInProgress: workspaceBlankResetInProgress,
        });
      }
      return result;
    };
    button.scrollIntoView({ block: 'center', inline: 'nearest' });
    const currentScopeBeforeReset = getCurrentLastWorkWorkspaceScope();
    let resetError = '';
    const resetPromise = window.startBlankWorkDraft().catch(error => {
      resetError = String(error?.message || error || '새 작업 reset 실패');
      return false;
    });
    const resetTimeline = [sampleState('click-return')];
    await new Promise(resolve => setTimeout(resolve, 25));
    resetTimeline.push(sampleState('25ms'));
    await new Promise(resolve => setTimeout(resolve, 75));
    resetTimeline.push(sampleState('100ms'));
    await new Promise(resolve => setTimeout(resolve, 250));
    resetTimeline.push(sampleState('350ms'));
    const settleStartedAt = Date.now();
    while (Date.now() - settleStartedAt < 30000) {
      const pending = workspaceBlankResetInProgress || persistentStateSaving
        || !!lastProductImageBackupSavePromise || !!sessionAssetSavePromise || !!lastWorkSaveTimer;
      if (!pending) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await resetPromise;
    workspaceDocumentFenceIsCurrent = originalWorkspaceDocumentFenceIsCurrent;
    const blankResetSettled = !workspaceBlankResetInProgress && !persistentStateSaving
      && !lastProductImageBackupSavePromise && !sessionAssetSavePromise && !lastWorkSaveTimer;
    const backupAfterReset = await workspacePersistenceApi().loadPreference('lastProductImageBackup').catch(() => null);
    const freshFactory = factoryRuntimeReadFactory();
    const sessionRaw = window.sessionStorage.getItem('pdp_session') || '';
    let session = {};
    try { session = sessionRaw ? JSON.parse(sessionRaw) : {}; } catch (_) {}
    const buttonIds = ['factoryNewWorkBtn', 'factoryWorkspaceNewWorkBtn', 'blankWorkBtn', 'exportProjectFileBtn', 'importProjectFileBtn'];
    const buttons = buttonIds.map(id => {
      const el = document.getElementById(id);
      if (!el) return { id, exists: false };
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        id,
        exists: true,
        text: el.innerText || el.textContent || '',
        display: style.display,
        visibility: style.visibility,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      };
    });
    const afterText = document.body.innerText || '';
    return {
      authorityBeforeSeed,
      previousWorkspaceScope,
      currentScopeBeforeReset,
      resetError,
      fenceTrace,
      beforeHadOldProduct: beforeText.includes(productName),
      clickedButtonId: button.id,
      blankResetSettled,
      backupAfterResetExists: !!backupAfterReset,
      resetTimeline,
      currentProjectId: window.state.currentProjectId || '',
      currentProjectName: window.state.currentProjectName || '',
      productName: window.state.productName || '',
      imagePreview: window.state.imagePreview || '',
      imageBase64Length: String(window.state.imageBase64 || '').length,
      analysisImages: (window.state.analysisImages || []).length,
      dbMatchCandidates: (window.state.dbMatchCandidates || []).length,
      sectionContentKeys: Object.keys(window.state.sectionContents || {}),
      sectionImageKeys: Object.keys(window.state.sectionImages || {}),
      detailImageBlocks: (window.state.detailImageBlocks || []).length,
      cutsResults: (window.state.cuts?.results || []).length,
      cutsPromptImageResidue: (window.state.cuts?.prompts || []).some(item => item?.result || item?.image || item?.imageUrl || item?.dataUrl || item?.preview || item?.base64),
      cutsPromptScopeResidue: (window.state.cuts?.prompts || []).some(item => item?.workspaceId || item?.currentProjectId || item?.currentRunId || item?.productKey || item?.inputImageFingerprint || item?.stageId),
      optionImages: (window.state.optionSorter?.images || []).length,
      compUploaded: (window.state.compPage?.uploadedImages || []).length,
      compEvidence: (window.state.compPage?.evidenceImages || []).length,
      factoryWorkspaceId: freshFactory.workspace?.id || '',
      factoryProductName: freshFactory.product?.productName || '',
      factoryAssets: (freshFactory.assets || []).length,
      factoryPreviousAssets: (freshFactory.previousAssets || []).length,
      factoryRunId: freshFactory.automation?.currentRunId || freshFactory.product?.currentRunId || '',
      factoryActiveTab: freshFactory.automation?.activeTab || '',
      sessionProductName: session.productName || session.factory?.product?.productName || '',
      sessionImageBase64Length: String(session.imageBase64 || session.factory?.product?.imageBase64 || '').length,
      fileLocationLabel: window.factoryProjectFileLocationLabel() || '',
      workspaceScope: getCurrentLastWorkWorkspaceScope(),
      bodyHasOldProductAfter: afterText.includes(productName),
      bodyHasNewWorkText: afterText.includes('새 작업') || afterText.includes('빈 문서'),
      buttons,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      pageYOffset: window.pageYOffset,
    };
  })()`);

  await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then(result => fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ proof }, null, 2));

  await waitFor(cdp, `window.state.productName === '' &&
    !window.state.imagePreview &&
    String(window.state.imageBase64 || '').length === 0 &&
    (window.state.analysisImages || []).length === 0 &&
    !window.state.projectBusy &&
    !(factoryRuntimeReadFactory().product?.productName || '') &&
    (factoryRuntimeReadFactory().assets || []).length === 0`, 10000);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(
    cdp,
    `${factoryCdpFixtureReadyExpression()}
      && typeof startBlankWorkDraft === 'function'
      && typeof currentSessionAssetsPayload === 'function'
      && typeof workspacePersistenceApi === 'function'`,
    60000,
  );
  await new Promise(resolve => setTimeout(resolve, 1200));
  const reloadProof = await evaluate(cdp, `(async () => {
    const persistence = workspacePersistenceApi();
    const sessionAssets = await persistence.loadSessionAssets(getCurrentLastWorkWorkspaceScope()).catch(() => null);
    const imageBackup = await persistence.loadPreference('lastProductImageBackup').catch(() => null);
    const server = await fetch(${JSON.stringify(BACKEND_BASE)} + '/api/last-work', { cache: 'no-store' }).then(response => response.json()).catch(() => ({}));
    let localSession = {};
    try { localSession = JSON.parse(sessionStorage.getItem('pdp_session') || '{}'); } catch (_) {}
    return {
      currentProjectId: window.state.currentProjectId || '',
      currentProjectName: window.state.currentProjectName || '',
      productName: window.state.productName || '',
      imagePreview: window.state.imagePreview || '',
      imageBase64Length: String(window.state.imageBase64 || '').length,
      analysisImages: (window.state.analysisImages || []).length,
      factoryProductName: factoryRuntimeReadFactory().product?.productName || '',
      factoryAssets: (factoryRuntimeReadFactory().assets || []).length,
      bodyHasOldProduct: (document.body.innerText || '').includes('새파일검증이전상품'),
      localSessionProductName: localSession.productName || localSession.factory?.product?.productName || '',
      sessionAssetsProductName: sessionAssets?.productName || sessionAssets?.factory?.product?.productName || '',
      sessionAssetsImagePreview: sessionAssets?.imagePreview || sessionAssets?.factory?.product?.imagePreview || '',
      imageBackupExists: !!imageBackup,
      imageBackupProductName: imageBackup?.productName || '',
      fileLocationLabel: factoryProjectFileLocationLabel() || '',
      workspaceScope: getCurrentLastWorkWorkspaceScope(),
      serverProductName: server?.snapshot?.lightweight?.productName || server?.snapshot?.assets?.productName || '',
      serverScore: Number(server?.score || 0),
    };
  })()`);
  await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then(result => fs.writeFileSync(RELOAD_SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));

  const archiveAfter = archiveSnapshot(ARCHIVE_ROOT);
  const missingArchive = missingArchiveFiles(archiveBefore, archiveAfter);
  const addedArchive = addedArchiveFiles(archiveBefore, archiveAfter);
  const archivedProjectIds = new Set(
    addedArchive
      .map(file => file.rel.match(/새파일검증이전상품_(project_[^/]+)/)?.[1] || '')
      .filter(Boolean),
  );
  const foreignAddedArchive = addedArchive.filter(file => {
    if (file.rel.includes('새파일검증이전상품')) return false;
    return ![...archivedProjectIds].some(projectId => file.rel.startsWith(`workfiles/${projectId}__`));
  });
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ proof, reloadProof, missingArchive, addedArchive, foreignAddedArchive }, null, 2));

  console.log(JSON.stringify({
    proofBeforeAssert: proof,
    reloadProof,
    archiveBefore: { exists: archiveBefore.exists, count: archiveBefore.count },
    archiveAfter: { exists: archiveAfter.exists, count: archiveAfter.count },
    missingArchive,
    addedArchive,
    foreignAddedArchive,
  }, null, 2));

  assertChecks([
    { ok: proof.authorityBeforeSeed?.mode === 'offline-edit' && proof.authorityBeforeSeed?.scopeId === proof.currentScopeBeforeReset, message: `검증 fixture의 현재 탭 draft 편집권을 획득하지 못했습니다: ${JSON.stringify(proof.authorityBeforeSeed)}` },
    { ok: /^draft:/.test(proof.currentScopeBeforeReset) && proof.currentScopeBeforeReset !== proof.workspaceScope, message: `새 작업이 이전 탭 브랜치와 분리되지 않았습니다: ${JSON.stringify({ before: proof.currentScopeBeforeReset, after: proof.workspaceScope })}` },
    { ok: !proof.resetError, message: `새 작업 reset 중 오류가 발생했습니다: ${proof.resetError} · ${JSON.stringify(proof.fenceTrace)}` },
    { ok: proof.beforeHadOldProduct, message: '검증용 이전 작업 상태가 화면에 심기지 않았습니다.' },
    { ok: !!proof.clickedButtonId, message: '새 작업 버튼 클릭 경로를 통과하지 않았습니다.' },
    { ok: proof.blankResetSettled, message: '새 작업 저장/삭제 경계가 완료되지 않았습니다.' },
    { ok: !proof.backupAfterResetExists, message: '새 작업 완료 직후 이전 기본 이미지 백업이 남아 있습니다.' },
    { ok: proof.currentProjectId === '' && proof.currentProjectName === '', message: '새 작업 후 currentProject identity가 비워지지 않았습니다.' },
    { ok: proof.fileLocationLabel === '', message: '새 작업 후 이전 .kuasangse 파일명이 현재 작업파일로 남아 있습니다.' },
    { ok: proof.productName === '' && proof.factoryProductName === '', message: '새 작업 후 상품명이 남아 있습니다.' },
    { ok: !proof.imagePreview && proof.imageBase64Length === 0, message: '새 작업 후 이전 기본 이미지가 남아 있습니다.' },
    { ok: proof.analysisImages === 0, message: '새 작업 후 이전 기본 이미지 기록이 남아 있습니다.' },
    { ok: proof.dbMatchCandidates === 0, message: '새 작업 후 DB 후보가 남아 있습니다.' },
    { ok: proof.sectionContentKeys.length === 0 && proof.sectionImageKeys.length === 0, message: '새 작업 후 섹션 내용/이미지가 남아 있습니다.' },
    { ok: proof.detailImageBlocks === 0, message: '새 작업 후 상세 이미지 블록이 남아 있습니다.' },
    { ok: proof.cutsResults === 0 && proof.optionImages === 0, message: '새 작업 후 생성컷/옵션 이미지 상태가 남아 있습니다.' },
    { ok: !proof.cutsPromptImageResidue && !proof.cutsPromptScopeResidue, message: '새 작업 후 컷 프롬프트 이미지 참조 또는 이전 작업 범위가 남아 있습니다.' },
    { ok: proof.compUploaded === 0 && proof.compEvidence === 0, message: '새 작업 후 상세페이지 비교 이미지가 남아 있습니다.' },
    { ok: proof.factoryAssets === 0 && proof.factoryPreviousAssets === 0, message: '새 작업 후 조립공장 후보가 남아 있습니다.' },
    { ok: /^factory_work_run_/.test(proof.factoryRunId), message: '새 작업 후 새 workflow runId가 시작되지 않았습니다.' },
    { ok: !proof.sessionProductName && proof.sessionImageBase64Length === 0, message: '새 작업 후 pdp_session에 이전 상품/이미지가 남아 있습니다.' },
    { ok: !proof.bodyHasOldProductAfter, message: '새 작업 후 화면에 이전 상품명이 남아 있습니다.' },
    { ok: reloadProof.currentProjectId === '' && reloadProof.currentProjectName === '' && reloadProof.productName === '', message: '새 작업 후 새로고침에서 이전 작업 identity가 복원됐습니다.' },
    { ok: reloadProof.fileLocationLabel === '', message: '새 작업 후 새로고침에서 이전 .kuasangse 파일명이 다시 표시됩니다.' },
    { ok: reloadProof.workspaceScope === proof.workspaceScope, message: '새 작업 후 새로고침에서 새 초안 workspace scope가 유지되지 않았습니다.' },
    { ok: !reloadProof.imagePreview && reloadProof.imageBase64Length === 0 && reloadProof.analysisImages === 0, message: '새 작업 후 새로고침에서 이전 기본 이미지가 복원됐습니다.' },
    { ok: !reloadProof.factoryProductName && reloadProof.factoryAssets === 0 && !reloadProof.bodyHasOldProduct, message: '새 작업 후 새로고침 화면에 이전 상품/후보가 복원됐습니다.' },
    { ok: reloadProof.imageBackupExists === false && reloadProof.imageBackupProductName === '', message: '새 작업 후 이전 기본 이미지 백업이 남아 있습니다.' },
    { ok: proof.buttons.some(btn => btn.id === 'factoryNewWorkBtn' && btn.exists) || proof.buttons.some(btn => btn.id === 'blankWorkBtn' && btn.exists), message: '작업파일/새 작업 UI 버튼이 보이지 않습니다.' },
    { ok: proof.buttons.filter(btn => btn.exists).every(btn => btn.display !== 'none' && btn.visibility !== 'hidden' && btn.rect.width > 0 && btn.rect.height > 0), message: '작업파일 버튼 중 숨겨지거나 크기가 0인 항목이 있습니다.' },
    { ok: missingArchive.length === 0, message: `새 작업 과정에서 output/local-archive 파일이 사라지거나 크기가 바뀌었습니다: ${JSON.stringify(missingArchive.slice(0, 5))}` },
    { ok: foreignAddedArchive.length === 0, message: `새 작업 과정에서 이전 작업과 다른 identity의 아카이브가 추가되었습니다: ${JSON.stringify(foreignAddedArchive.slice(0, 5))}` },
  ]);

  console.log(JSON.stringify({
    ok: true,
    proof,
    reloadProof,
    archiveBefore: { exists: archiveBefore.exists, count: archiveBefore.count },
    archiveAfter: { exists: archiveAfter.exists, count: archiveAfter.count },
    addedArchive,
    foreignAddedArchive,
    screenshot: SCREENSHOT_PATH,
    reloadScreenshot: RELOAD_SCREENSHOT_PATH,
    resultPath: RESULT_PATH,
  }, null, 2));

  await cleanupActiveCdp();
}

main().catch(async err => {
  console.error(err);
  await cleanupActiveCdp().catch(cleanupError => console.error(cleanupError));
  process.exit(1);
});
