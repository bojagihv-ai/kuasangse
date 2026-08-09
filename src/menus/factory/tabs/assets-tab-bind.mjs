function eventTarget(event, selector) {
  const target = event?.target;
  if (target?.closest) return target.closest(selector);
  if (target?.matches?.(selector)) return target;
  return null;
}

function stop(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

export function bindAssetsTab(root, fire) {
  const disposers = [];
  const listen = (type, handler) => {
    if (!root?.addEventListener) return;
    root.addEventListener(type, handler);
    disposers.push(() => root.removeEventListener?.(type, handler));
  };
  const click = event => {
    const guide = eventTarget(event, '[data-factory-guide-action]');
    if (guide) { stop(event); fire('guideAction', guide.dataset?.factoryGuideAction || ''); return; }
    const run = eventTarget(event, '[data-factory-run-stage]');
    if (run) { stop(event); fire('runStage', run.dataset?.factoryRunStage || ''); return; }
    const size = eventTarget(event, '[data-factory-confirm-size-image]');
    if (size) { stop(event); fire('confirmSizeImage'); return; }
    const open = eventTarget(event, '[data-factory-open-optionsorter]');
    if (open) { stop(event); fire('openOptionsorter'); return; }
    const syncDb = eventTarget(event, '[data-factory-sync-db-options]');
    if (syncDb) { stop(event); fire('syncDbOptions'); return; }
    const syncResults = eventTarget(event, '[data-factory-sync-option-results]');
    if (syncResults) { stop(event); fire('syncOptionResults'); return; }
    const usage = eventTarget(event, '[data-factory-color-image-usage]');
    if (usage) { stop(event); fire('setColorImageUsage', usage.dataset?.factoryColorImageUsage || ''); return; }
    const groupShotImage = eventTarget(event, '[data-opt-group-shot-image]');
    if (groupShotImage) {
      stop(event);
      fire('setGroupShotImageSelected', {
        imageId: groupShotImage.dataset?.optGroupShotImage || '',
        selected: groupShotImage.dataset?.optGroupShotSelected !== 'true',
      });
      return;
    }
    if (eventTarget(event, '[data-opt-group-shot-select-all]')) { stop(event); fire('selectAllGroupShotImages'); return; }
    if (eventTarget(event, '[data-opt-group-shot-clear]')) { stop(event); fire('clearGroupShotImages'); return; }
    if (eventTarget(event, '#optGenerateGroupShot')) { stop(event); fire('generateGroupShot'); return; }
    if (eventTarget(event, '[data-factory-option-color-upload]')) { stop(event); fire('openOptionColorFile'); return; }
    const previous = eventTarget(event, '[data-factory-toggle-previous-assets]');
    if (previous) { stop(event); fire('togglePreviousAssets', previous.dataset?.factoryTogglePreviousAssets || ''); return; }
    if (eventTarget(event, '[data-factory-toggle-assets]')) { stop(event); fire('toggleAssets'); return; }
    const use = eventTarget(event, '[data-factory-asset-use]');
    if (use) { stop(event); fire('toggleAssetUse', use.dataset?.factoryAssetUse || ''); return; }
    const reject = eventTarget(event, '[data-factory-asset-reject]');
    if (reject) { stop(event); fire('toggleAssetReject', reject.dataset?.factoryAssetReject || ''); return; }
    const preview = eventTarget(event, '[data-factory-preview-asset]');
    if (preview) { stop(event); fire('previewAsset', preview.dataset?.factoryPreviewAsset || ''); return; }
    const place = eventTarget(event, '[data-factory-place]');
    if (place) { stop(event); fire('placeAsset', place.dataset?.factoryPlace || ''); return; }
    const archive = eventTarget(event, '[data-factory-archive-asset]');
    if (archive) { stop(event); fire('archiveAsset', archive.dataset?.factoryArchiveAsset || ''); return; }
    const send = eventTarget(event, '[data-factory-send]');
    if (send) {
      stop(event);
      const [assetId, stageId] = String(send.dataset?.factorySend || '').split(':');
      if (assetId && stageId) fire('sendAsset', assetId, stageId);
      return;
    }
    const drop = eventTarget(event, '[data-factory-drop]');
    if (drop) { stop(event); fire('openStageFile', drop.dataset?.factoryDrop || ''); return; }
    if (eventTarget(event, '#factoryAddCompletedAsset')) { stop(event); fire('openCompletedFile'); }
  };
  const input = event => {
    const target = event?.target;
    const stageTarget = eventTarget(event, '[data-factory-stage-target]');
    if (stageTarget) { fire('setStageTarget', stageTarget.dataset?.factoryStageTarget || '', target?.value ?? ''); return; }
    const prompt = eventTarget(event, '[data-factory-stage-prompt]');
    if (prompt) { fire('setStagePrompt', prompt.dataset?.factoryStagePrompt || '', target?.value ?? ''); return; }
    if (eventTarget(event, '#optGroupShotPrompt')) fire('setGroupShotPrompt', target?.value ?? '');
  };
  const change = event => {
    const target = event?.target;
    const optionColorFile = eventTarget(event, '[data-factory-option-color-file]');
    if (optionColorFile) { fire('addStageInputFiles', 'options', optionColorFile.files || []); optionColorFile.value = ''; return; }
    const stageFile = eventTarget(event, '[data-factory-stage-file]');
    if (stageFile) { fire('addStageInputFiles', stageFile.dataset?.factoryStageFile || '', target?.files || []); if (target) target.value = ''; return; }
    if (eventTarget(event, '#factoryCompleteFile')) { fire('addCompletedFiles', target?.files || []); if (target) target.value = ''; return; }
    input(event);
  };
  const keydown = event => {
    const drop = eventTarget(event, '[data-factory-drop]');
    if (drop && (event.key === 'Enter' || event.key === ' ')) { stop(event); fire('openStageFile', drop.dataset?.factoryDrop || ''); }
  };
  const dragstart = event => {
    const card = eventTarget(event, '[data-factory-asset-id]');
    const id = card?.dataset?.factoryAssetId || '';
    if (!card || !id) return;
    event.dataTransfer?.setData?.('text/factory-asset-id', id);
    event.dataTransfer?.setData?.('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    card.classList?.add?.('dragging');
  };
  const dragend = event => eventTarget(event, '[data-factory-asset-id]')?.classList?.remove?.('dragging');
  const dragover = event => {
    const drop = eventTarget(event, '[data-factory-drop]');
    if (!drop) return;
    event.preventDefault?.();
    drop.classList?.add?.('drag-over');
  };
  const dragleave = event => eventTarget(event, '[data-factory-drop]')?.classList?.remove?.('drag-over');
  const dropEvent = event => {
    const drop = eventTarget(event, '[data-factory-drop]');
    if (!drop) return;
    event.preventDefault?.();
    drop.classList?.remove?.('drag-over');
    const stageId = drop.dataset?.factoryDrop || '';
    const files = event.dataTransfer?.files;
    if (files?.length) { fire('addStageInputFiles', stageId, files); return; }
    if (event.dataTransfer?.getData?.('text/factory-source') === 'product') {
      const created = fire('createProductInputAsset', stageId);
      if (created && typeof created.then === 'function') created.then(asset => { if (asset?.id) fire('sendAsset', asset.id, stageId); });
      else if (created?.id) fire('sendAsset', created.id, stageId);
      return;
    }
    const id = event.dataTransfer?.getData?.('text/factory-asset-id') || event.dataTransfer?.getData?.('text/plain');
    if (id) fire('sendAsset', id, stageId);
  };
  listen('click', click);
  listen('input', input);
  listen('change', change);
  listen('keydown', keydown);
  listen('dragstart', dragstart);
  listen('dragend', dragend);
  listen('dragover', dragover);
  listen('dragleave', dragleave);
  listen('drop', dropEvent);
  return () => { while (disposers.length) disposers.pop()(); };
}
