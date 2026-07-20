import { renderImageCutsResultsView } from './imagecuts-view-results.mjs';
import { renderImageCutsSourceView } from './imagecuts-view-source.mjs';

export function renderImageCutsView(view, helpers) {
  const {
    applyLatestCutPromptSlotBackups,
    clearFinishedCutGenerationFlagsFromLogs,
    clearLocalFallbackResultsFromPrompts,
    cutImageFingerprint,
    cutsClearOverdueGenerationRuntime,
    cutsCurrentLockedProductSourceState,
    cutsDataUrlFromPayload,
    cutsHasActiveImageGeneration,
    cutsShouldRunRenderMaintenance,
    defaultPromptCount,
    escapeHtml,
    factoryClearDisconnectedImageGenerationRuntime,
    factoryClearRestoredImageGenerationRuntime,
    factoryCutPromptPreviewSrc,
    factoryHasCurrentPageImageGenerationRun,
    factoryRejectLocalFallbackAssetsForStage,
    factoryRestoreCutPromptResultsFromAssets,
    getCurrentImageRunInfo,
    hasImageConnection,
    hasPromptFields,
    maxPromptCount,
    normalizeCutPrompts,
    normalizeCutPromptSlotCount,
    restoreCutImagePayloadsFromPreview,
    restoreGeneralCutsAfterSizeMix,
    restoreSizeCutResultsFromCache,
    sessionAssetsHydrated,
    syncCutPromptsFromDom,
  } = helpers;
  const c = view.cuts;
  const sessionImageHydrationPending = !sessionAssetsHydrated();
  if (typeof factoryClearDisconnectedImageGenerationRuntime === 'function') {
    try {
      factoryClearDisconnectedImageGenerationRuntime({ save: true, log: true, render: false });
    } catch (error) {}
  }
  if (!sessionImageHydrationPending && typeof cutsClearOverdueGenerationRuntime === 'function') {
    try {
      cutsClearOverdueGenerationRuntime({ save: true, log: true, render: false });
    } catch (error) {}
  }
  const hasLiveImageGenerationRun = !!(
    typeof factoryHasCurrentPageImageGenerationRun === 'function'
    && factoryHasCurrentPageImageGenerationRun(c)
  );
  if (
    !sessionImageHydrationPending
    && !hasLiveImageGenerationRun
    && typeof factoryClearRestoredImageGenerationRuntime === 'function'
  ) {
    try {
      factoryClearRestoredImageGenerationRuntime({ save: true, log: false });
    } catch (error) {}
  }
  if (!sessionImageHydrationPending && !cutsHasActiveImageGeneration(c) && hasPromptFields()) {
    syncCutPromptsFromDom({ save: true });
  }

  const shouldRunMaintenance = cutsShouldRunRenderMaintenance(c, sessionImageHydrationPending);
  if (shouldRunMaintenance) restoreCutImagePayloadsFromPreview(c);
  c.promptSlotCount = normalizeCutPromptSlotCount(
    c.promptSlotCount,
    c.prompts?.length || defaultPromptCount,
  );
  c.prompts = normalizeCutPrompts(c.prompts, { count: c.promptSlotCount });
  c.sizePromptSlotCount = normalizeCutPromptSlotCount(
    c.sizePromptSlotCount,
    c.sizePrompts?.length || defaultPromptCount,
  );
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
  const anyResult = c.prompts.some(prompt => factoryCutPromptPreviewSrc(prompt, 'cuts'));
  const anyGenerating = c.prompts.some(prompt => prompt.generating) || !!c.runBusy;
  const promptCount = c.prompts.length;
  const resultCount = c.prompts.filter(prompt => factoryCutPromptPreviewSrc(prompt, 'cuts')).length;
  const sizeResultCount = (c.sizePrompts || []).filter(prompt => factoryCutPromptPreviewSrc(prompt, 'size')).length;
  const totalResultCount = resultCount + sizeResultCount;
  const imageRunInfo = getCurrentImageRunInfo();
  const imageConnectionReady = hasImageConnection();
  const cutBlockReason = lockedProductMissing
    ? lockedSourceState.message
    : !hasGenerationInput
      ? '샘플 또는 작업 이미지를 먼저 업로드해주세요.'
      : (!imageConnectionReady ? '이미지 생성 모델 API 연결을 먼저 확인해주세요.' : '');
  const state = Object.freeze({
    anyGenerating,
    anyResult,
    c,
    cutBlockReason,
    factoryLockedStage,
    hasGenerationInput,
    hasSrc,
    hasWorkImage,
    imageConnectionReady,
    lockedProductMissing,
    maxPromptCount,
    promptCount,
    resultCount,
    sessionImageHydrationPending,
    sizeResultCount,
    sourcePanelSub,
    sourcePanelTitle,
    sourcePreviewForDisplay,
    styleReferenceEnabled,
    styleReferenceMessage,
    styleReferenceUsable,
    totalResultCount,
    workPreviewForDisplay,
  });

  return `<div class="fade-in">
    <h1 class="page-title">✨ 이미지컷 생성</h1>
    <p class="page-desc">제품 이미지를 올리고 ${promptCount}가지 프롬프트로 각각 다른 이미지컷을 생성합니다. 기본은 4칸이며 필요하면 지시칸을 늘리거나 줄일 수 있습니다.</p>
    <p style="font-size:12px;color:var(--primary);margin-bottom:20px;background:var(--primary-dim);padding:8px 12px;border-radius:8px;display:inline-block">
      🤖 이미지 생성 모델: <strong>${escapeHtml(imageRunInfo.modelLabel || imageRunInfo.modelId)}</strong> · ${escapeHtml(imageRunInfo.route || '')}
    </p>
    ${renderImageCutsSourceView(state, helpers)}
    ${renderImageCutsResultsView(state, helpers)}
  </div>`;
}
