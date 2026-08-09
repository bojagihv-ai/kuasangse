const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const EXPECTED_BUILD_ID = currentSourceBuildId(process.cwd());

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#f8fafc"/><rect x="88" y="46" width="304" height="228" rx="28" fill="${color}"/><text x="240" y="172" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#fff">${label}</text></svg>`;
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
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1365,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!((window.__kuasangseState || window.state) && window.render && window.saveLastWorkNow)', 60000);
  await new Promise(resolve => setTimeout(resolve, 1200));

  const seed = String(Date.now());
  const projectId = `project_scoped_reload_v138_${seed}`;
  const projectName = `옵션복원검증${seed}`;
  const runId = `run_scoped_reload_v138_${seed}`;
  const productKey = projectName.replace(/\s+/g, '').toLowerCase();
  const inputImageFingerprint = `fingerprint_scoped_reload_v138_${seed}`;
  const colors = [
    ['자주', '#be185d'],
    ['빨강', '#dc2626'],
    ['연핑', '#f9a8d4'],
    ['먹색', '#334155'],
  ];
  const images = colors.map(([name, color]) => ({ name, preview: svgData(name, color) }));
  const saved = await evaluate(cdp, `(async () => {
    const projectId = ${JSON.stringify(projectId)};
    const projectName = ${JSON.stringify(projectName)};
    const runId = ${JSON.stringify(runId)};
    const productKey = ${JSON.stringify(productKey)};
    const inputImageFingerprint = ${JSON.stringify(inputImageFingerprint)};
    const images = ${JSON.stringify(images)};
    const slots = images.map((item, index) => ({
      id: 'slot_scoped_v138_' + index,
      name: item.name,
      imgIds: ['image_scoped_v138_' + index],
    }));
    const state = window.__kuasangseState || window.state;
    state.currentProjectId = projectId;
    state.currentProjectName = projectName;
    state.currentProjectCreatedAt = Date.now();
    state.step = 'optionsorter';
    state.productName = projectName;
    state.optionSorter = window.normalizeOptionSorterState({
      ...window.defaultOptionSorterState(),
      images: images.map((item, index) => ({
        id: 'image_scoped_v138_' + index,
        name: item.name + '.svg',
        mime: 'image/svg+xml',
        preview: item.preview,
        base64: item.preview.replace(/^data:image\\/[^;,]+;base64,/i, ''),
        hasImageData: true,
        workspaceId: projectId,
        currentRunId: runId,
        productKey,
        inputImageFingerprint,
        stageId: 'options',
        createdAt: Date.now() + index,
      })),
      slots,
      pool: [],
      optionSheetLayoutUserSet: true,
      optionSheetLayoutMode: 'rows',
      optionSheetRowPattern: '2,2',
      optionSheetRows: 2,
      optionSheetCols: 2,
    });
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity?.(factory, { projectId, projectName, createdAt: state.currentProjectCreatedAt });
    factory.product.productName = projectName;
    factory.product.userProductName = projectName;
    factory.product.productKey = productKey;
    factory.product.productIdentityKey = productKey;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.inputImageFingerprint = inputImageFingerprint;
    factory.product.lockedInputImageFingerprint = inputImageFingerprint;
    factory.automation.currentRunId = runId;
    const branchScope = window.getCurrentLastWorkWorkspaceScope();
    const authority = await window.ensureWorkspaceEditAuthority(branchScope, { force: true });
    if (!['editing', 'offline-edit'].includes(authority?.mode) || authority?.scopeId !== branchScope) {
      throw new Error('scoped reload branch authority acquisition failed: ' + JSON.stringify(authority));
    }
    window.render();
    await new Promise(resolve => setTimeout(resolve, 300));
    await window.saveLastWorkNow({ force: true, deep: true });
    await new Promise(resolve => setTimeout(resolve, 1500));
    const server = await fetch('http://127.0.0.1:5050/api/last-work?workspaceId=' + encodeURIComponent('project:' + projectId), { cache: 'no-store' }).then(response => response.json());
    const storedSession = await window.workspaceGetSessionAssets?.();
    const persistence = window.workspacePersistenceApi();
    const localSession = JSON.parse(persistence.readRecoveryValue('pdp_session') || '{}');
    const bootstrap = JSON.parse(persistence.readRecoveryValue('pdp_last_work_bootstrap_v1') || '{}');
    return {
      projectId: state.currentProjectId,
      projectName: state.currentProjectName,
      scope: window.getCurrentLastWorkWorkspaceScope(),
      branchScope,
      imageCount: state.optionSorter.images.length,
      slotNames: state.optionSorter.slots.slice(0, 4).map(slot => slot.name),
      serverScope: server.workspaceId || '',
      serverImages: server.snapshot?.assets?.optionSorter?.images?.length || 0,
      storedSessionMode: storedSession?.imagePersistence?.mode || '',
      storedSessionImages: (storedSession?.optionSorter?.images || []).map(image => ({
        id: image.id || '',
        previewLength: String(image.preview || '').length,
        base64Length: String(image.base64 || '').length,
        dataUrlLength: String(image.dataUrl || '').length,
      })),
      storedSessionAuthority: storedSession?.persistenceAuthority || null,
      currentAuthority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
      serverRevision: Number(server.snapshot?.metadata?.revision?.counter)
        || Number(server.snapshot?.persistenceAuthority?.revision)
        || Number(server.snapshot?.workspaceRevision?.counter)
        || 0,
      storageWarning: state.storageWarning || '',
      localScope: localSession.workspaceScope?.id || localSession.workspaceScope || '',
      localProjectId: localSession.currentProjectId || '',
      localLength: JSON.stringify(localSession).length,
      bootstrapScope: bootstrap.workspaceScope?.id || '',
    };
  })()`);

  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!((window.__kuasangseState || window.state) && window.render && window.saveLastWorkNow)', 60000);
  const restoreStartedAt = Date.now();
  let restoreTimedOut = false;
  try {
    await waitFor(cdp, `(() => {
      const state = window.__kuasangseState || window.state;
      return (state?.optionSorter?.images || []).filter(image => String(image.preview || '').startsWith('data:image/')).length >= 4;
    })()`, 10000);
  } catch (_) {
    restoreTimedOut = true;
  }
  const restoreElapsedMs = Date.now() - restoreStartedAt;
  const restored = await evaluate(cdp, `(async () => {
    const state = window.__kuasangseState || window.state;
    const expectedProjectId = ${JSON.stringify(projectId)};
    const expectedProjectName = ${JSON.stringify(projectName)};
    const beforeProduct = state.productName;
    const foreignScope = 'project:foreign_scope_v138';
    const foreignApplied = window.applyServerLastWorkSnapshot({
      workspaceId: foreignScope,
      workspaceScope: { id: foreignScope },
      savedAt: Date.now() + 1000,
      lightweight: { productName: '외부작업파일', currentProjectId: 'foreign_scope_v138' },
      assets: {
        productName: '외부작업파일',
        optionSorter: { images: [], slots: [] },
        factory: { product: { productName: '외부작업파일' } },
      },
    });
    const optionImages = state.optionSorter.images || [];
    const mappedSlots = state.optionSorter.slots.slice(0, 4);
    const server = await fetch('http://127.0.0.1:5050/api/last-work?workspaceId=' + encodeURIComponent('project:' + expectedProjectId), { cache: 'no-store' }).then(response => response.json());
    const serverImages = server.snapshot?.assets?.optionSorter?.images || [];
    const sessionAssets = await window.workspaceGetSessionAssets?.().catch(() => null);
    const sessionAssetImages = sessionAssets?.optionSorter?.images || [];
    return {
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      projectId: state.currentProjectId,
      projectName: state.currentProjectName,
      scope: window.getCurrentLastWorkWorkspaceScope(),
      imageCount: optionImages.length,
      usableImages: optionImages.filter(image => String(image.preview || '').startsWith('data:image/')).length,
      imagePayloads: optionImages.map(image => ({
        id: image.id || '',
        hasImageData: !!image.hasImageData,
        previewLength: String(image.preview || '').length,
        base64Length: String(image.base64 || '').length,
        dataUrlLength: String(image.dataUrl || '').length,
      })),
      serverImagePayloads: serverImages.map(image => ({
        id: image.id || '',
        hasImageData: !!image.hasImageData,
        previewLength: String(image.preview || '').length,
        base64Length: String(image.base64 || '').length,
        dataUrlLength: String(image.dataUrl || '').length,
      })),
      sessionAssetImagePayloads: sessionAssetImages.map(image => ({
        id: image.id || '',
        previewLength: String(image.preview || '').length,
        base64Length: String(image.base64 || '').length,
        dataUrlLength: String(image.dataUrl || '').length,
      })),
      sessionAssetAuthority: sessionAssets?.persistenceAuthority || null,
      currentAuthority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
      storageWarning: state.storageWarning || '',
      snapshotMatches: window.lastWorkSnapshotMatchesCurrentWorkspace(server.snapshot),
      assetsMatch: window.lastWorkSnapshotMatchesCurrentWorkspace(server.snapshot?.assets || {}),
      serverAssetScope: server.snapshot?.assets?.workspaceScope?.id || server.snapshot?.assets?.workspaceScope || '',
      serverAssetProjectId: server.snapshot?.assets?.currentProjectId || '',
      slotNames: mappedSlots.map(slot => slot.name),
      slotImageIds: mappedSlots.map(slot => (slot.imgIds || [])[0] || ''),
      domThumbCount: Array.from(document.images).filter(image =>
        String(image.currentSrc || image.src || '').startsWith('data:image/') && image.naturalWidth > 0
      ).length,
      restoreElapsedMs: ${restoreElapsedMs},
      restoreTimedOut: ${restoreTimedOut},
      foreignApplied,
      productUnchanged: beforeProduct === state.productName && state.productName === expectedProjectName,
      expectedProjectId,
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(OUT_DIR, 'workfile-scoped-reload-v138.png');
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  cdp.close();
  await cdpRuntime.cleanup();
  const resultPath = path.join(OUT_DIR, 'workfile-scoped-reload-v138.json');
  const result = { url: APP_URL, saved, restored, screenshot };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
  assertChecks([
    { ok: /^draft:/.test(saved.scope) && saved.scope === saved.branchScope, message: `현재 탭 브랜치 저장 scope 불일치: ${saved.scope}` },
    { ok: saved.bootstrapScope === saved.branchScope, message: `즉시 복원 포인터 branch 불일치: ${saved.bootstrapScope}` },
    { ok: saved.localScope === saved.branchScope && saved.localProjectId === projectId, message: `로컬 branch/document 식별자 불일치: ${JSON.stringify({ scope: saved.localScope, projectId: saved.localProjectId })}` },
    { ok: saved.storedSessionImages.length === 4 && saved.storedSessionImages.every(image => image.previewLength > 0 || image.base64Length > 0 || image.dataUrlLength > 0), message: `브랜치 옵션 이미지 저장 불일치: ${JSON.stringify(saved.storedSessionImages)}` },
    { ok: !!EXPECTED_BUILD_ID && restored.buildId === EXPECTED_BUILD_ID, message: `최신 빌드가 아닙니다: ${restored.buildId} (예상: ${EXPECTED_BUILD_ID || '빌드 ID 없음'})` },
    { ok: restored.projectId === projectId && restored.projectName === projectName, message: `새로고침 후 작업파일 식별자 불일치: ${JSON.stringify(restored)}` },
    { ok: restored.imageCount === 4 && restored.usableImages === 4, message: `새로고침 후 옵션 이미지 복원 실패: ${JSON.stringify(restored)}` },
    { ok: restored.domThumbCount >= 4, message: `새로고침 후 화면 썸네일 복원 실패: ${restored.domThumbCount}` },
    { ok: Number(restored.restoreElapsedMs) < 10000, message: `새로고침 이미지 복원이 제한 시간 안에 완료되지 않았습니다: ${restored.restoreElapsedMs}ms` },
    { ok: JSON.stringify(restored.slotNames) === JSON.stringify(colors.map(([name]) => name)), message: `새로고침 후 옵션명 복원 실패: ${restored.slotNames.join(', ')}` },
    { ok: restored.slotImageIds.every(Boolean), message: `새로고침 후 사진-옵션 매핑 복원 실패: ${restored.slotImageIds.join(', ')}` },
    { ok: restored.foreignApplied === false && restored.productUnchanged, message: `다른 작업파일 상태가 현재 화면에 적용됐습니다: ${JSON.stringify(restored)}` },
  ]);
  console.log(JSON.stringify({ ...result, resultPath }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
