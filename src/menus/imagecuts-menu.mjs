import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

const ACTION_NAMES = Object.freeze([
  'loadSource', 'goFactoryStart', 'clearSource', 'loadWorkImage', 'clearWorkImage',
  'runWorkDrive', 'chooseArchive', 'archiveAll', 'downloadAll', 'saveSession',
  'recoverPrompts', 'resetGeneration', 'setCutSlotCount', 'setSizeSlotCount',
  'generateCut', 'generateSizeCut', 'generateAllCuts', 'generateAllSizeCuts',
  'clearCutResults', 'clearSizeResults', 'applyPlacement',
]);

const RENDER_HELPER_NAMES = Object.freeze([
  "factoryClearDisconnectedImageGenerationRuntime",
  "cutsClearOverdueGenerationRuntime",
  "factoryHasCurrentPageImageGenerationRun",
  "factoryClearRestoredImageGenerationRuntime",
  "cutsHasActiveImageGeneration",
  "syncCutPromptsFromDom",
  "cutsShouldRunRenderMaintenance",
  "restoreCutImagePayloadsFromPreview",
  "normalizeCutPromptSlotCount",
  "normalizeCutPrompts",
  "restoreSizeCutResultsFromCache",
  "factoryRestoreCutPromptResultsFromAssets",
  "clearLocalFallbackResultsFromPrompts",
  "applyLatestCutPromptSlotBackups",
  "restoreGeneralCutsAfterSizeMix",
  "clearFinishedCutGenerationFlagsFromLogs",
  "factoryRejectLocalFallbackAssetsForStage",
  "cutsDataUrlFromPayload",
  "cutsCurrentLockedProductSourceState",
  "cutImageFingerprint",
  "factoryCutPromptPreviewSrc",
  "getCurrentImageRunInfo",
  "hasImageConnection",
  "renderCutsRunLogPanel",
  "renderFactoryLightImage",
  "cutGeneratingHelperText",
  "cutsVisibleLogText",
  "renderFactoryCutPromptPreviewImage",
  "renderSizeCutsPanel",
  "renderDetailSectionPlacementPanel",
  "disabledAttr",
  "escapeHtml",
  "escapeAttr",
  "sessionAssetsHydrated",
  "hasPromptFields",
  "hasDriveService"
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

function one(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function all(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

export function createImageCutsMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const updateCuts = requiredFunction(capabilities, 'updateCuts');
  const updatePrompt = requiredFunction(capabilities, 'updatePrompt');
  const updatePlacement = requiredFunction(capabilities, 'updatePlacement');
  const persistCuts = requiredFunction(capabilities, 'persistCuts');
  const requestRender = requiredFunction(capabilities, 'requestRender');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const promptUser = requiredFunction(capabilities, 'promptUser');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  for (const name of [...ACTION_NAMES, 'resolveWorkFolder']) requiredFunction(actions, name);
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);
  const defaultPromptCount = Number(renderHelpers.defaultPromptCount || 4);
  const maxPromptCount = Number(renderHelpers.maxPromptCount || 30);

  let active = false;
  let generation = 0;
  let contract;

  const stamp = () => ({ generation, token: getOperationToken() });
  const isCurrent = operation => active
    && operation.generation === generation
    && operation.token === getOperationToken();

  async function guarded(service, apply, value) {
    const operation = stamp();
    const result = await service(value);
    if (!isCurrent(operation)) return { ignored: true, reason: 'stale-operation' };
    apply(result, value);
    return result;
  }

  function mutable() {
    assertMutable();
  }

  function persist(reason, value) {
    persistCuts({ reason, value });
  }

  const commands = {
    setStyleReference: {
      capability: 'image-cuts:write',
      execute(value) {
        mutable();
        const styleReferenceEnabled = value !== false;
        updateCuts({ styleReferenceEnabled });
        persist('style-reference', styleReferenceEnabled);
        requestRender();
        return styleReferenceEnabled;
      },
    },
    saveWorkFolder: {
      capability: 'image-cuts:write',
      execute(value) {
        mutable();
        const folderId = String(value || '').trim();
        if (!folderId) return Promise.resolve(null);
        return guarded(actions.resolveWorkFolder, result => {
          updateCuts({
            workDriveFolderId: result.id || folderId,
            workDriveFolderName: result.name || result.id || folderId,
          });
          persist('work-drive-folder', result);
          requestRender();
        }, folderId);
      },
    },
    setPrompt: {
      capability: 'image-cuts:write',
      execute(value = {}) {
        mutable();
        const kind = value.kind === 'size' ? 'size' : 'cut';
        const index = Number.parseInt(value.index, 10);
        if (!Number.isFinite(index) || index < 0) return false;
        updatePrompt({ kind, index, patch: { prompt: String(value.value || ''), promptUpdatedAt: Date.now() } });
        persist('prompt', { kind, index });
        return true;
      },
    },
    renamePrompt: {
      capability: 'image-cuts:write',
      execute(value = {}) {
        mutable();
        const kind = value.kind === 'size' ? 'size' : 'cut';
        const index = Number.parseInt(value.index, 10);
        const label = String(value.label || '').trim();
        if (!Number.isFinite(index) || index < 0 || !label) return false;
        updatePrompt({ kind, index, patch: { label } });
        persist('rename-prompt', { kind, index });
        requestRender();
        return true;
      },
    },
    setPlacement: {
      capability: 'image-cuts:write',
      execute(value = {}) {
        mutable();
        const sectionId = String(value.sectionId || '').trim();
        if (!sectionId) return false;
        updatePlacement({ sectionId, value: String(value.value || '') });
        persist('placement', { sectionId });
        return true;
      },
    },
  };

  for (const name of ACTION_NAMES) {
    commands[name] = {
      capability: 'image-cuts:write',
      execute(value) {
        mutable();
        return actions[name](value);
      },
    };
  }

  function listen(disposers, node, type, listener) {
    if (!node?.addEventListener) return;
    node.addEventListener(type, listener);
    disposers.push(() => node.removeEventListener?.(type, listener));
  }

  function invoke(command, value) {
    try {
      return Promise.resolve(contract.invoke(command, value)).catch(reportError);
    } catch (error) {
      reportError(error);
      return Promise.resolve(null);
    }
  }

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'imagecuts',
    routes: ['imagecuts'],
    ownedSlices: ['image-cuts'],
    capabilities: ['image-cuts:read', 'image-cuts:write'],
    select(root = {}) {
      const snapshot = getSnapshot() || {};
      return { cuts: root.cuts || snapshot.cuts || {} };
    },
    commands,
    render(view) {
      return renderImageCutsView(view, { ...renderHelpers, defaultPromptCount, maxPromptCount });
    },
    bind(root) {
      const disposers = [];
      const sourceInput = one(root, '#cutsFileInput');
      const sourceArea = one(root, '#cutsUploadArea');
      listen(disposers, sourceArea, 'click', event => {
        if (event?.target?.closest?.('button,input,textarea,select,a,label,[contenteditable="true"]')) return;
        sourceInput?.click?.();
      });
      listen(disposers, sourceArea, 'dragover', event => event.preventDefault());
      listen(disposers, sourceArea, 'drop', event => {
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file?.type?.startsWith('image/')) invoke('loadSource', file);
      });
      listen(disposers, sourceInput, 'change', event => {
        const file = event.target?.files?.[0];
        if (file) invoke('loadSource', file);
      });
      for (const node of all(root, '[data-cuts-pick-current-product]')) listen(disposers, node, 'click', event => {
        event.preventDefault();
        event.stopPropagation();
        sourceInput?.click?.();
      });
      for (const node of all(root, '[data-cuts-go-factory-start]')) listen(disposers, node, 'click', event => {
        event.preventDefault();
        event.stopPropagation();
        invoke('goFactoryStart');
      });
      for (const node of all(root, '[data-clear-cut-source]')) listen(disposers, node, 'click', event => {
        event.stopPropagation();
        invoke('clearSource');
      });

      const workInput = one(root, '#cutsWorkFileInput');
      const workArea = one(root, '#cutsWorkUploadArea');
      listen(disposers, workArea, 'click', () => workInput?.click?.());
      listen(disposers, workArea, 'dragover', event => event.preventDefault());
      listen(disposers, workArea, 'drop', event => {
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file?.type?.startsWith('image/')) invoke('loadWorkImage', file);
      });
      listen(disposers, workInput, 'change', event => {
        const file = event.target?.files?.[0];
        if (file) invoke('loadWorkImage', file);
      });
      for (const node of all(root, '[data-clear-cut-work]')) listen(disposers, node, 'click', event => {
        event.stopPropagation();
        invoke('clearWorkImage');
      });

      const styleToggle = one(root, '#cutsStyleReferenceToggle');
      listen(disposers, styleToggle, 'change', () => invoke('setStyleReference', !!styleToggle.checked));
      listen(disposers, one(root, '#cutsClearSourceInline'), 'click', () => invoke('clearSource'));
      listen(disposers, one(root, '#cutsWorkFolderSaveBtn'), 'click', () => {
        invoke('saveWorkFolder', one(root, '#cutsWorkFolderInput')?.value || '');
      });

      const buttonCommands = [
        ['#cutsWorkDriveRunBtn', 'runWorkDrive'],
        ['#chooseCutsArchiveFolderBtn', 'chooseArchive'],
        ['#saveAllCutsLocalBtn', 'archiveAll'],
        ['#downloadAllCutsBtn', 'downloadAll'],
        ['#saveCutsSessionNowBtn', 'saveSession'],
        ['#recoverCutsPromptsBtn', 'recoverPrompts'],
        ['#resetCutsGenerationStateBtn', 'resetGeneration'],
        ['#genAllCutsBtn', 'generateAllCuts'],
        ['#genAllSizeCutsBtn', 'generateAllSizeCuts'],
        ['#clearAllCutsBtn', 'clearCutResults'],
        ['#clearAllSizeCutsBtn', 'clearSizeResults'],
        ['#applyPlacementBtn', 'applyPlacement'],
      ];
      for (const [selector, command] of buttonCommands) {
        listen(disposers, one(root, selector), 'click', () => invoke(command));
      }

      for (const node of all(root, '[data-cut-slot-delta]')) listen(disposers, node, 'click', () => {
        const cuts = getSnapshot()?.cuts || {};
        const current = cuts.promptSlotCount || cuts.prompts?.length || defaultPromptCount;
        invoke('setCutSlotCount', current + (Number.parseInt(node.dataset.cutSlotDelta, 10) || 0));
      });
      for (const node of all(root, '[data-size-cut-slot-delta]')) listen(disposers, node, 'click', () => {
        const cuts = getSnapshot()?.cuts || {};
        const current = cuts.sizePromptSlotCount || cuts.sizePrompts?.length || defaultPromptCount;
        invoke('setSizeSlotCount', current + (Number.parseInt(node.dataset.sizeCutSlotDelta, 10) || 0));
      });

      const bindPrompt = (selector, kind, dataKey) => {
        for (const node of all(root, selector)) {
          const save = event => invoke('setPrompt', {
            kind,
            index: Number.parseInt(node.dataset[dataKey], 10),
            value: event.target?.value || '',
          });
          listen(disposers, node, 'input', save);
          listen(disposers, node, 'change', save);
          listen(disposers, node, 'blur', save);
        }
      };
      bindPrompt('[data-cut-prompt]', 'cut', 'cutPrompt');
      bindPrompt('[data-size-cut-prompt]', 'size', 'sizeCutPrompt');

      for (const node of all(root, '[data-gen-cut]')) listen(disposers, node, 'click', () => invoke('generateCut', Number(node.dataset.genCut)));
      for (const node of all(root, '[data-gen-size-cut]')) listen(disposers, node, 'click', () => invoke('generateSizeCut', Number(node.dataset.genSizeCut)));

      const bindRename = (selector, kind, dataKey) => {
        for (const node of all(root, selector)) listen(disposers, node, 'click', () => {
          const index = Number(node.dataset[dataKey]);
          const cuts = getSnapshot()?.cuts || {};
          const rows = kind === 'size' ? cuts.sizePrompts : cuts.prompts;
          const current = rows?.[index]?.label || (kind === 'size' ? '사이즈컷 ' + (index + 1) : '컷 ' + (index + 1));
          const label = promptUser((kind === 'size' ? '사이즈컷' : '컷') + ' 이름을 입력하세요:', current);
          if (String(label || '').trim()) invoke('renamePrompt', { kind, index, label });
        });
      };
      bindRename('[data-rename-cut]', 'cut', 'renameCut');
      bindRename('[data-rename-size-cut]', 'size', 'renameSizeCut');

      for (const node of all(root, '[data-place-section]')) listen(disposers, node, 'change', event => {
        invoke('setPlacement', { sectionId: node.dataset.placeSection, value: event.target?.value || '' });
      });

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        while (disposers.length) disposers.pop()();
      };
    },
    onEnter() {
      active = true;
      generation += 1;
    },
    onLeave() {
      active = false;
      generation += 1;
    },
    persistence: { reads: ['image-cuts'], writes: ['image-cuts'] },
  });

  return contract;
}

function renderImageCutsView(view, helpers) {
  const {
    factoryClearDisconnectedImageGenerationRuntime,
    cutsClearOverdueGenerationRuntime,
    factoryHasCurrentPageImageGenerationRun,
    factoryClearRestoredImageGenerationRuntime,
    cutsHasActiveImageGeneration,
    syncCutPromptsFromDom,
    cutsShouldRunRenderMaintenance,
    restoreCutImagePayloadsFromPreview,
    normalizeCutPromptSlotCount,
    normalizeCutPrompts,
    restoreSizeCutResultsFromCache,
    factoryRestoreCutPromptResultsFromAssets,
    clearLocalFallbackResultsFromPrompts,
    applyLatestCutPromptSlotBackups,
    restoreGeneralCutsAfterSizeMix,
    clearFinishedCutGenerationFlagsFromLogs,
    factoryRejectLocalFallbackAssetsForStage,
    cutsDataUrlFromPayload,
    cutsCurrentLockedProductSourceState,
    cutImageFingerprint,
    factoryCutPromptPreviewSrc,
    getCurrentImageRunInfo,
    hasImageConnection,
    renderCutsRunLogPanel,
    renderFactoryLightImage,
    cutGeneratingHelperText,
    cutsVisibleLogText,
    renderFactoryCutPromptPreviewImage,
    renderSizeCutsPanel,
    renderDetailSectionPlacementPanel,
    disabledAttr,
    escapeHtml,
    escapeAttr,
    sessionAssetsHydrated,
    hasPromptFields,
    hasDriveService,
    defaultPromptCount,
    maxPromptCount,
  } = helpers;
  const escAttr = escapeAttr;
  const c = view.cuts;
  const sessionImageHydrationPending = !sessionAssetsHydrated();
  if (typeof factoryClearDisconnectedImageGenerationRuntime === 'function') {
    try {
      factoryClearDisconnectedImageGenerationRuntime({ save: true, log: true, render: false });
    } catch(e) {}
  }
  if (!sessionImageHydrationPending && typeof cutsClearOverdueGenerationRuntime === 'function') {
    try {
      cutsClearOverdueGenerationRuntime({ save: true, log: true, render: false });
    } catch(e) {}
  }
  const hasLiveImageGenerationRun = !!(
    typeof factoryHasCurrentPageImageGenerationRun === 'function' &&
    factoryHasCurrentPageImageGenerationRun(c)
  );
  if (!sessionImageHydrationPending && !hasLiveImageGenerationRun && typeof factoryClearRestoredImageGenerationRuntime === 'function') {
    try {
      factoryClearRestoredImageGenerationRuntime({ save: true, log: false });
    } catch(e) {}
  }
  if (!sessionImageHydrationPending && !cutsHasActiveImageGeneration(c) && hasPromptFields()) {
    syncCutPromptsFromDom({ save: true });
  }
  const shouldRunMaintenance = cutsShouldRunRenderMaintenance(c, sessionImageHydrationPending);
  if (shouldRunMaintenance) restoreCutImagePayloadsFromPreview(c);
  c.promptSlotCount = normalizeCutPromptSlotCount(c.promptSlotCount, c.prompts?.length || defaultPromptCount);
  c.prompts = normalizeCutPrompts(c.prompts, { count: c.promptSlotCount });
  c.sizePromptSlotCount = normalizeCutPromptSlotCount(c.sizePromptSlotCount, c.sizePrompts?.length || defaultPromptCount);
  c.sizePrompts = normalizeCutPrompts(c.sizePrompts, { count: c.sizePromptSlotCount });
  let restoredCutAssets = 0;
  let restoredSizeAssets = 0;
  if (shouldRunMaintenance) {
    restoreSizeCutResultsFromCache(c);
    restoredCutAssets = factoryRestoreCutPromptResultsFromAssets(c.factoryStageId || 'cuts', { log: false });
    restoredSizeAssets = factoryRestoreCutPromptResultsFromAssets('size', { log: false });
    const clearedCutFallbacks = clearLocalFallbackResultsFromPrompts(c.prompts, c.factoryStageId || 'cuts');
    const clearedSizeFallbacks = clearLocalFallbackResultsFromPrompts(c.sizePrompts, 'size');
    if (clearedCutFallbacks || clearedSizeFallbacks) {
      c.runStatus = `이전 로컬 결과 ${clearedCutFallbacks + clearedSizeFallbacks}개를 후보에서 제거했습니다. 이미지 API 연결을 복구한 뒤 재생성해주세요.`;
      c.runStatusType = 'warn';
      factoryRejectLocalFallbackAssetsForStage(c.factoryStageId || 'cuts');
      factoryRejectLocalFallbackAssetsForStage('size');
    }
    const autoPromptRestore = applyLatestCutPromptSlotBackups({ save: true });
    const mixedPromptRestore = restoreGeneralCutsAfterSizeMix();
    const staleGeneratingRestore = clearFinishedCutGenerationFlagsFromLogs({ save: true });
    if (autoPromptRestore.changed) {
      c.runStatus = `프롬프트 ${autoPromptRestore.recovered || 0}칸을 마지막 입력값으로 복구했습니다.`;
      c.runStatusType = 'ok';
    }
    if (mixedPromptRestore) {
      c.runStatus = '이미지컷/사이즈컷 혼용 상태를 분리했습니다.';
      c.runStatusType = 'ok';
    }
    if (staleGeneratingRestore) {
      c.runStatus = '완료된 생성 표시를 정리했습니다.';
      c.runStatusType = 'ok';
    }
    if (restoredCutAssets || restoredSizeAssets) {
      c.runStatus = `새로고침 후 현재 작업 자산에서 생성 후보 ${restoredCutAssets + restoredSizeAssets}개를 복원했습니다.`;
      c.runStatusType = 'ok';
    }
    const restoredCutFallbacks = clearLocalFallbackResultsFromPrompts(c.prompts, c.factoryStageId || 'cuts');
    const restoredSizeFallbacks = clearLocalFallbackResultsFromPrompts(c.sizePrompts, 'size');
    if (restoredCutFallbacks || restoredSizeFallbacks) {
      c.runStatus = `이전 로컬 결과 ${restoredCutFallbacks + restoredSizeFallbacks}개를 후보에서 제거했습니다. 이미지 API 연결을 복구한 뒤 재생성해주세요.`;
      c.runStatusType = 'warn';
      factoryRejectLocalFallbackAssetsForStage(c.factoryStageId || 'cuts');
      factoryRejectLocalFallbackAssetsForStage('size');
    }
  }
  const hasSrc = !!(c.sourceBase64 || c.sourcePreview);
  const hasWorkImage = !!(c.workImageBase64 || c.workImagePreview);
  const sourcePreviewForDisplay = hasSrc
    ? cutsDataUrlFromPayload(c.sourceBase64, c.sourceMime || 'image/png', c.sourcePreview)
    : '';
  const workPreviewForDisplay = hasWorkImage
    ? cutsDataUrlFromPayload(c.workImageBase64, c.workImageMime || 'image/png', c.workImagePreview)
    : '';
  const factoryLockedStage = ['hero', 'cuts'].includes(String(c.factoryStageId || ''));
  const lockedSourceState = cutsCurrentLockedProductSourceState(c.factoryStageId || 'cuts');
  const lockedProductMissing = factoryLockedStage && lockedSourceState.required && !lockedSourceState.ready;
  const hasGenerationInput = factoryLockedStage ? !lockedProductMissing : (hasSrc || hasWorkImage);
  const sourceKey = cutImageFingerprint(c.sourceBase64);
  const workKey = cutImageFingerprint(c.workImageBase64);
  const sameSourceAndWork = !!(sourceKey && workKey && sourceKey === workKey);
  const styleReferenceEnabled = c.styleReferenceEnabled !== false;
  const styleReferenceUsable = !factoryLockedStage && hasSrc && hasWorkImage && !sameSourceAndWork;
  const sourcePanelTitle = factoryLockedStage ? '현재 제품 원본' : '샘플 이미지';
  const sourcePanelSub = factoryLockedStage ? '(제품 기준 - 필수)' : '(스타일 참조 - 선택)';
  const styleReferenceMessage = factoryLockedStage
    ? '조립공장 대표/이미지컷에서는 현재 제품 원본 1장만 생성 요청에 들어갑니다. 샘플 스타일과 오른쪽 작업 이미지는 추가 참조로 보내지 않습니다.'
    : sameSourceAndWork
      ? '샘플과 작업 이미지가 같아서 샘플 참조는 자동으로 제외하고 한 장만 보냅니다.'
      : styleReferenceUsable
        ? (styleReferenceEnabled ? '작업 이미지를 제품으로 쓰고, 샘플은 배경/구도 참고로 함께 보냅니다.' : '샘플을 빼고 작업 이미지만 제품 원본으로 보냅니다.')
        : hasWorkImage
          ? '작업 이미지만으로 생성할 수 있습니다. 샘플은 없어도 됩니다.'
          : hasSrc
            ? '작업 이미지가 없어서 이 이미지를 제품 원본으로만 사용합니다.'
            : '샘플이나 작업 이미지를 넣으면 생성할 수 있습니다.';
  const anyResult = c.prompts.some(p => factoryCutPromptPreviewSrc(p, 'cuts'));
  const anyGenerating = c.prompts.some(p => p.generating) || !!c.runBusy;
  const promptCount = c.prompts.length;
  const resultCount = c.prompts.filter(p => factoryCutPromptPreviewSrc(p, 'cuts')).length;
  const sizeResultCount = (c.sizePrompts || []).filter(p => factoryCutPromptPreviewSrc(p, 'size')).length;
  const totalResultCount = resultCount + sizeResultCount;
  const imageRunInfo = getCurrentImageRunInfo();
  const imageConnectionReady = hasImageConnection();
  const cutBlockReason = lockedProductMissing
    ? lockedSourceState.message
    : !hasGenerationInput
    ? '샘플 또는 작업 이미지를 먼저 업로드해주세요.'
    : (!imageConnectionReady ? '이미지 생성 모델 API 연결을 먼저 확인해주세요.' : '');

  return `<div class="fade-in">
    <h1 class="page-title">✨ 이미지컷 생성</h1>
    <p class="page-desc">제품 이미지를 올리고 ${promptCount}가지 프롬프트로 각각 다른 이미지컷을 생성합니다. 기본은 4칸이며 필요하면 지시칸을 늘리거나 줄일 수 있습니다.</p>
    <p style="font-size:12px;color:var(--primary);margin-bottom:20px;background:var(--primary-dim);padding:8px 12px;border-radius:8px;display:inline-block">
      🤖 이미지 생성 모델: <strong>${escapeHtml(imageRunInfo.modelLabel || imageRunInfo.modelId)}</strong> · ${escapeHtml(imageRunInfo.route || '')}
    </p>
    ${sessionImageHydrationPending ? `<div class="notice info" style="margin-bottom:16px">
      저장된 이미지 후보를 브라우저 보관함에서 복구 중입니다. 복구가 끝나기 전에는 후보 없음으로 확정하지 않습니다.
    </div>` : ''}

    <!-- 이미지 업로드 영역: 샘플 + 작업 -->
    <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
      <!-- 샘플 이미지 -->
      <div style="flex:1;min-width:200px">
        <p style="font-size:12px;font-weight:600;color:var(--text-m);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📌 ${sourcePanelTitle} <span style="color:var(--text-m);font-weight:400">${sourcePanelSub}</span></p>
        <div class="source-upload" id="cutsUploadArea" style="min-height:140px">
          ${hasSrc
            ? `${typeof renderFactoryLightImage === 'function' ? renderFactoryLightImage(sourcePreviewForDisplay, sourcePanelTitle, 'style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain"') : `<img src="${sourcePreviewForDisplay}" loading="lazy" decoding="async" style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain">`}
               ${!factoryLockedStage ? `<button type="button" data-clear-cut-source style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center" title="샘플 해제">×</button>` : ''}`
            : `<span class="material-icons-outlined" style="font-size:36px;color:var(--primary);display:block;margin-bottom:6px">add_photo_alternate</span>
               <p style="font-size:14px;font-weight:500">${factoryLockedStage ? '현재 제품 원본 대기' : '샘플 이미지 업로드'}</p>
               <p style="font-size:11px;color:var(--text-m);margin-top:3px">${factoryLockedStage ? '조립공장 제품 사진을 다시 올려주세요' : '선택 사항 · 클릭 또는 드래그&amp;드롭'}</p>
               ${factoryLockedStage ? `<div style="margin-top:10px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
                 <button type="button" class="btn-sm" data-cuts-pick-current-product>제품 사진 넣기</button>
                 <button type="button" class="btn-sm" data-cuts-go-factory-start>1단계로 이동</button>
               </div>` : ''}`
          }
          <input type="file" id="cutsFileInput" accept="image/*" style="display:none">
        </div>
        <div class="factory-small" style="margin-top:6px;line-height:1.45">${escapeHtml(styleReferenceMessage)}</div>
      </div>

      <!-- 작업 이미지 -->
      <div style="flex:1;min-width:200px">
        <p style="font-size:12px;font-weight:600;color:var(--text-m);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">🔧 작업 이미지 <span style="color:var(--text-m);font-weight:400">${factoryLockedStage ? '(대표/이미지컷 단계에서는 추가 전송 안 함)' : '(처리할 제품)'}</span></p>
        <div class="source-upload" id="cutsWorkUploadArea" style="min-height:140px;border-color:${hasWorkImage ? 'var(--primary)' : 'var(--border)'}">
          ${hasWorkImage
            ? `${typeof renderFactoryLightImage === 'function' ? renderFactoryLightImage(workPreviewForDisplay, '작업 이미지', 'style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain"') : `<img src="${workPreviewForDisplay}" loading="lazy" decoding="async" style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain">`}
               <button type="button" data-clear-cut-work style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center" title="작업 이미지 해제">×</button>`
            : `<span class="material-icons-outlined" style="font-size:36px;color:#f59e0b;display:block;margin-bottom:6px">build_circle</span>
               <p style="font-size:14px;font-weight:500">작업 이미지 업로드</p>
                <p style="font-size:11px;color:var(--text-m);margin-top:3px">${factoryLockedStage ? '현재 단계에서는 왼쪽 현재 제품 원본만 사용' : '작업 이미지만으로도 생성 가능'}</p>`
          }
          <input type="file" id="cutsWorkFileInput" accept="image/*" style="display:none">
        </div>
        ${factoryLockedStage ? `<div class="factory-small" style="margin-top:6px;line-height:1.45">대표/이미지컷 생성 요청에는 오른쪽 작업 이미지를 섞지 않습니다. 현재 제품 원본 1장만 기준으로 사용합니다.</div>` : ''}
        <!-- 작업 이미지 Drive 자동화 -->
        <div style="margin-top:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
          <p style="font-size:11px;font-weight:600;color:var(--text-m);margin-bottom:6px">☁️ Drive 작업 이미지 자동화</p>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <input id="cutsWorkFolderInput" class="input" placeholder="Drive 폴더 ID" value="${c.workDriveFolderId}" style="font-size:11px;flex:1;padding:5px 8px">
            <button class="btn-sm" id="cutsWorkFolderSaveBtn" style="font-size:11px;white-space:nowrap">저장</button>
          </div>
          ${c.workDriveFolderName ? `<p style="font-size:10px;color:var(--primary);margin-bottom:6px">📁 ${c.workDriveFolderName}</p>` : ''}
          <button class="btn-sm" id="cutsWorkDriveRunBtn"
            style="font-size:11px;width:100%;justify-content:center;${c.workDriveFolderId && hasDriveService() ? '' : 'opacity:.5'}"
            ${disabledAttr(c.workDriveRunning || !c.workDriveFolderId || !hasDriveService(), c.workDriveRunning ? 'Drive 작업 이미지를 처리 중입니다.' : (!c.workDriveFolderId ? 'Drive 폴더 ID를 먼저 저장해주세요.' : 'Drive 연결 후 사용할 수 있습니다.'))}>
            ${c.workDriveRunning
              ? '<span class="material-icons-outlined" style="font-size:13px;animation:spin 1s linear infinite">sync</span> 처리 중...'
              : '<span class="material-icons-outlined" style="font-size:13px">play_arrow</span> Drive 작업 이미지 일괄 처리'}
          </button>
        </div>
      </div>
    </div>

    <div style="border:1px solid rgba(99,102,241,.26);background:rgba(99,102,241,.055);border-radius:10px;padding:10px 12px;margin:-8px 0 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="min-width:220px">
        <div style="font-size:12px;font-weight:900;color:var(--text)">샘플 참조 방식</div>
        <div class="factory-small" style="line-height:1.45">${escapeHtml(styleReferenceMessage)}</div>
      </div>
      <label style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:850;color:${styleReferenceUsable ? 'var(--text)' : 'var(--text-m)'}">
        <input type="checkbox" id="cutsStyleReferenceToggle" ${styleReferenceEnabled ? 'checked' : ''} ${styleReferenceUsable ? '' : 'disabled'} style="accent-color:var(--primary)">
        샘플을 배경/구도 참조로 사용
      </label>
      ${!factoryLockedStage && hasSrc ? `<button type="button" class="btn-sm" id="cutsClearSourceInline">샘플 없이 생성</button>` : ''}
    </div>

    ${lockedProductMissing ? `<div class="app-notice danger" style="margin-bottom:16px;align-items:flex-start">
      <span class="material-icons-outlined">report</span>
      <span style="display:block">
        <b>현재 제품 원본이 비어 있어 생성하지 않습니다.</b><br>
        대표이미지/이미지컷은 지금 작업의 제품 사진 1장만 기준으로 생성합니다. 원본이 없으면 이전 작업 후보를 끌어오지 않고 여기서 멈춥니다.
        <span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn-sm" data-cuts-pick-current-product>제품 사진 넣기</button>
          <button type="button" class="btn-sm" data-cuts-go-factory-start>제품 사진/이름 확인으로 이동</button>
        </span>
      </span>
    </div>` : !hasGenerationInput ? `<div class="app-notice warn" style="margin-bottom:16px">
      <span class="material-icons-outlined">info</span>
      <span>이미지컷 생성 버튼은 샘플 이미지나 작업 이미지 중 하나가 있어야 활성화됩니다. 샘플 없이 가려면 오른쪽 <b>작업 이미지</b>만 넣어도 됩니다.</span>
    </div>` : ''}
    ${hasGenerationInput && !imageConnectionReady ? `<div class="app-notice warn" style="margin-bottom:16px">
      <span class="material-icons-outlined">info</span>
      <span>이미지 생성 모델 연결이 아직 준비되지 않았습니다. 모델 설정/API 연결을 확인하면 생성 버튼이 활성화됩니다.</span>
    </div>` : ''}

    ${renderCutsRunLogPanel(c)}

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:4px 0 14px">
      <div style="font-size:13px;color:var(--text-m)">
        이미지컷 지시칸 <strong style="color:var(--text);font-size:16px">${promptCount}개</strong>
        <span style="font-size:11px;color:var(--text-m);margin-left:6px">기본 4개 · 최대 ${maxPromptCount}개</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-sm" data-cut-slot-delta="-1" ${disabledAttr(promptCount <= 1 || anyGenerating, anyGenerating ? '생성 중에는 지시칸 수를 바꿀 수 없습니다.' : '최소 1칸은 유지됩니다.')}>
          <span class="material-icons-outlined" style="font-size:16px">remove</span>
          칸 줄이기
        </button>
        <button class="btn-sm" data-cut-slot-delta="1" ${disabledAttr(promptCount >= maxPromptCount || anyGenerating, anyGenerating ? '생성 중에는 지시칸 수를 바꿀 수 없습니다.' : `최대 ${maxPromptCount}칸까지 가능합니다.`)}>
          <span class="material-icons-outlined" style="font-size:16px">add</span>
          칸 추가
        </button>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px 14px">
      <div style="min-width:220px">
        <div style="font-size:12px;font-weight:800;color:var(--text)">생성 결과 보관</div>
        <div style="font-size:11px;color:var(--text-m);line-height:1.5">
          현재 결과 ${totalResultCount}장<span style="color:var(--text-d)"> (이미지컷 ${resultCount} · 사이즈컷 ${sizeResultCount})</span> · 로컬 폴더: <strong style="color:var(--text)">${escapeHtml(c.localArchiveFolderName || '아직 선택 안 함')}</strong>
          ${c.localArchiveStatus ? `<br>${escapeHtml(c.localArchiveStatus)}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-sm" id="chooseCutsArchiveFolderBtn">
          <span class="material-icons-outlined" style="font-size:16px">folder_open</span>
          로컬 저장 폴더 선택
        </button>
        <button class="btn-sm" id="saveAllCutsLocalBtn" ${disabledAttr(!totalResultCount || c.localArchiveSaving, c.localArchiveSaving ? '이미 저장 중입니다.' : '저장할 생성 이미지가 없습니다.')}>
          <span class="material-icons-outlined" style="font-size:16px">${c.localArchiveSaving ? 'hourglass_empty' : 'download'}</span>
          생성 이미지 일괄저장
        </button>
        <button class="btn-sm" id="downloadAllCutsBtn" ${disabledAttr(!totalResultCount || c.localArchiveSaving, c.localArchiveSaving ? '이미 저장 중입니다.' : '저장할 생성 이미지가 없습니다.')}>
          <span class="material-icons-outlined" style="font-size:16px">file_download</span>
          다운로드로 저장
        </button>
        <button class="btn-sm" id="saveCutsSessionNowBtn">
          <span class="material-icons-outlined" style="font-size:16px">save</span>
          현재 작업 즉시 저장
        </button>
        <button class="btn-sm" id="recoverCutsPromptsBtn">
          <span class="material-icons-outlined" style="font-size:16px">history</span>
          프롬프트 복구
        </button>
        ${(anyGenerating || c.runBusy || c.sizeRunBusy) ? `<button class="btn-sm danger" id="resetCutsGenerationStateBtn">
          <span class="material-icons-outlined" style="font-size:16px">restart_alt</span>
          생성 상태 초기화
        </button>` : ''}
      </div>
    </div>

    <!-- 이미지컷 카드 -->
    <div class="cuts-grid">
      ${c.prompts.map((p, i) => `
        <div class="cut-card ${factoryCutPromptPreviewSrc(p, 'cuts') ? 'has-result' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="cut-label">${p.label}</span>
            <div style="display:flex;gap:6px">
              <button class="btn-sm" data-rename-cut="${i}">✏️ 이름변경</button>
              ${factoryCutPromptPreviewSrc(p, 'cuts') ? `<a class="btn-sm" href="${escAttr(factoryCutPromptPreviewSrc(p, 'cuts'))}" download="cut${i+1}.png">⬇️ 저장</a>` : ''}
            </div>
          </div>

          <!-- 미리보기 -->
          <div class="cut-preview">
            ${p.generating
              ? `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--text-m);font-size:12px;text-align:center"><div class="cut-spinner"></div><span>${escapeHtml(cutGeneratingHelperText(p, `컷 ${i + 1}`))}</span></div>`
              : factoryCutPromptPreviewSrc(p, 'cuts')
                ? renderFactoryCutPromptPreviewImage(p, 'cuts', i, `cut${i + 1}`)
                : `<span style="color:var(--text-m);font-size:12px">생성 전</span>`
            }
          </div>

          <!-- 프롬프트 입력 -->
          <textarea class="textarea" data-cut-prompt="${i}" rows="3"
            placeholder="예) 흰 배경에 제품을 중앙 배치, 그림자 없이 깔끔하게&#10;예) 라이프스타일 감성, 카페 테이블 위에 놓인 모습&#10;예) 다크톤 럭셔리, 검은 배경 골드 조명"
            style="font-size:12px">${escapeHtml(p.prompt || '')}</textarea>
          ${p.warning ? `<div class="app-notice warn" style="padding:8px 10px;font-size:12px;margin-top:8px">${escapeHtml(cutsVisibleLogText(p.warning))}</div>` : ''}
          ${p.error ? `<div class="app-notice danger" style="padding:8px 10px;font-size:12px;margin-top:8px">${escapeHtml(cutsVisibleLogText(p.error))}</div>` : ''}

          <!-- 개별 생성 버튼 -->
          <button class="btn-primary" data-gen-cut="${i}"
            style="font-size:13px;padding:9px 16px;justify-content:center"
            ${cutBlockReason ? `title="${escAttr(cutBlockReason)}"` : ''}
            ${disabledAttr(p.generating || !!c.runBusy || !!cutBlockReason, p.generating || c.runBusy ? '이미 생성 중입니다.' : cutBlockReason)}>
            <span class="material-icons-outlined" style="font-size:16px">${p.generating ? 'hourglass_empty' : 'auto_fix_high'}</span>
            ${p.generating ? '생성 중...' : '이 컷 생성'}
          </button>
        </div>
      `).join('')}
    </div>

    <!-- 전체 생성 버튼 -->
    <div style="display:flex;gap:10px;margin-bottom:32px">
      <button class="btn-primary" id="genAllCutsBtn"
        style="padding:14px 32px;font-size:15px"
        ${cutBlockReason ? `title="${escAttr(cutBlockReason)}"` : ''}
        ${disabledAttr(anyGenerating || !!cutBlockReason, anyGenerating ? '이미 생성 중입니다.' : cutBlockReason)}>
        <span class="material-icons-outlined" style="font-size:20px">auto_fix_high</span>
        ${promptCount}개 컷 전체 생성
      </button>
      ${anyResult ? `<button class="btn-sm" id="clearAllCutsBtn" style="padding:12px 20px">
        <span class="material-icons-outlined" style="font-size:16px">delete_sweep</span>
        결과 초기화
      </button>` : ''}
    </div>

    ${renderSizeCutsPanel(c, { cutBlockReason })}

    ${renderDetailSectionPlacementPanel({
      title: '📌 상세페이지 섹션에 배치',
      desc: '이미지컷, 사이즈컷, 색상옵션 최종픽, 조립공장/자동화 결과를 원하는 섹션에 바로 꽂습니다.',
      emptyText: '이미지컷/사이즈컷/색상옵션 결과가 생기면 여기서 섹션에 배치할 수 있습니다.'
    })}
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// IMAGE CUTS — GENERATION LOGIC
// ════════════════════════════════════════════════════════════════
