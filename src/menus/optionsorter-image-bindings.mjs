export function bindOptionSorterImages(context) {
  const {
    byId, queryAll, optionSorter, requestRender, defaultOptionSorterState, optAddImages,
    optAppendLogs, optOpenImagePreview, optScheduleSave, optSetColorImageUsage,
    optSyncSlotCountToImages, saveLastWorkNow,
  } = context;

  // ── 옵션 분류기 이벤트 ────────────────────────────────────────
  // 이미지 업로드
  const optUploadZone = byId('optUploadZone');
  const optFileInput = byId('optFileInput');
  const optAddImagesBtn = byId('optAddImagesBtn');
  if (optAddImagesBtn && optFileInput) {
    optAddImagesBtn.onclick = () => optFileInput.click();
  }
  if (optUploadZone) {
    optUploadZone.onclick = e => { if (e.target.tagName !== 'INPUT') optFileInput?.click(); };
    optUploadZone.ondragover = e => { e.preventDefault(); optUploadZone.classList.add('dragover'); };
    optUploadZone.ondragleave = () => optUploadZone.classList.remove('dragover');
    optUploadZone.ondrop = e => { e.preventDefault(); optUploadZone.classList.remove('dragover'); optAddImages(e.dataTransfer.files); };
  }
  if (optFileInput) optFileInput.onchange = e => {
    optAddImages(e.target.files);
    e.target.value = '';
  };

  queryAll('[data-opt-color-image-usage]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      optSetColorImageUsage(btn.dataset.optColorImageUsage, optionSorter());
      saveLastWorkNow();
      requestRender();
    };
  });

  const optClearImages = byId('optClearImages');
  if (optClearImages) optClearImages.onclick = () => {
    const os = optionSorter();
    os.optionSourceClearedAt = Date.now();
    os.optionSourceDeletedArchiveIds = [];
    os.images = []; os.pool = [];
    os.previewImageId = null;
    optAppendLogs(os, '현재 옵션 이미지만 비웠습니다. 기존 생성 결과는 아래에서 기존색상쓰기/샘플로 계속 사용할 수 있습니다.');
    os.optionSourceArchiveStatus = '현재 옵션 원본 목록을 비웠습니다. 로컬 보관 파일 자체는 삭제하지 않았습니다.';
    os.optionGenProgress = 0;
    os.optionVisionColorBusy = false;
    os.slots = defaultOptionSorterState().slots;
    optScheduleSave();
    saveLastWorkNow({ force: true, deep: true });
    requestRender();
  };
  queryAll('[data-opt-remove-img]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const id = btn.dataset.optRemoveImg;
      const os = optionSorter();
      const removed = os.images.find(i => i.id === id);
      const archiveId = String(removed?.archiveId || removed?.localArchive?.archiveId || '').trim();
      if (archiveId) {
        os.optionSourceDeletedArchiveIds = Array.from(new Set([
          ...(Array.isArray(os.optionSourceDeletedArchiveIds) ? os.optionSourceDeletedArchiveIds : []),
          archiveId,
        ]));
      }
      os.images = os.images.filter(i => i.id !== id);
      os.pool = os.pool.filter(i => i !== id);
      if (os.previewImageId === id) os.previewImageId = null;
      os.slots.forEach(s => { s.imgIds = s.imgIds.filter(i => i !== id); });
      optSyncSlotCountToImages(os);
      optScheduleSave();
      saveLastWorkNow({ force: true, deep: true });
      requestRender();
    };
  });
  queryAll('[data-opt-preview-img]').forEach(el => {
    const openPreview = e => {
      if (e?.target?.closest?.('[data-opt-remove-img]')) return;
      if (typeof optOpenImagePreview === 'function') {
        optOpenImagePreview(el.dataset.optPreviewImg);
      } else {
        optionSorter().previewImageId = el.dataset.optPreviewImg;
        requestRender();
      }
    };
    el.onclick = openPreview;
    el.onkeydown = e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openPreview(e);
    };
  });
  const optImagePreviewOverlay = byId('optImagePreviewOverlay');
  if (optImagePreviewOverlay) optImagePreviewOverlay.onclick = event => {
    if (event.target !== optImagePreviewOverlay) return;
    document.getElementById('optImagePreviewOverlay')?.remove();
    optionSorter().previewImageId = null;
    optionSorter().previewResultId = null;
    requestRender();
  };
  const closeOptImagePreview = byId('closeOptImagePreview');
  if (closeOptImagePreview) closeOptImagePreview.onclick = () => {
    document.getElementById('optImagePreviewOverlay')?.remove();
    optionSorter().previewImageId = null;
    optionSorter().previewResultId = null;
    requestRender();
  };
  queryAll('[data-opt-option-mode]').forEach(btn => {
    btn.onclick = () => {
      optionSorter().optionImageMode = btn.dataset.optOptionMode || 'ready';
      optScheduleSave();
      requestRender();
    };
  });
}
