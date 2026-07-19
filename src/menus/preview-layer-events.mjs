const ACTION_ALIASES = Object.freeze({
  undoEditorChange: Object.freeze(['undoEditorChange']),
  redoEditorChange: Object.freeze(['redoEditorChange']),
  applyTonePreset: Object.freeze(['applyTonePreset']),
  pushEditorHistory: Object.freeze(['pushEditorHistory', 'beginPreviewOrderChange']),
  resetPreviewOrder: Object.freeze(['resetPreviewOrder']),
  updateSectionOrder: Object.freeze(['updateSectionOrder', 'updatePreviewOrder']),
  setActivePreviewLayer: Object.freeze(['setActivePreviewLayer', 'selectPreviewLayer']),
  setLayerEdit: Object.freeze(['setLayerEdit', 'updateLayerEdit']),
  resetLayerEdit: Object.freeze(['resetLayerEdit', 'resetPreviewLayer']),
  resetLayerSection: Object.freeze(['resetLayerSection', 'resetPreviewLayerSection']),
  nudgeLayer: Object.freeze(['nudgeLayer', 'nudgePreviewLayer']),
  commitLayerDrag: Object.freeze(['commitLayerDrag', 'commitPreviewLayerDrag']),
});

export const PREVIEW_LAYER_ACTION_NAMES = Object.freeze([
  'undoEditorChange', 'redoEditorChange', 'applyTonePreset', 'pushEditorHistory', 'resetPreviewOrder', 'updateSectionOrder',
  'setActivePreviewLayer', 'setLayerEdit', 'resetLayerEdit', 'resetLayerSection', 'nudgeLayer', 'commitLayerDrag',
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

function cleanPart(value) { return String(value ?? '').trim(); }

function layerParts(value) {
  const [sectionId, layerId, prop] = cleanPart(value).split(':');
  return { sectionId: cleanPart(sectionId), layerId: cleanPart(layerId), prop: cleanPart(prop) };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function layerMode(snapshot) {
  return snapshot?.previewLayerMode === true;
}

function nodeInside(root, event, selector) {
  const node = event?.target?.closest?.(selector);
  return node && root?.contains?.(node) !== false ? node : null;
}

function inputFocused(documentRef, event) {
  const node = documentRef?.activeElement || event?.target;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(node?.tagName || '').toUpperCase());
}

export function createPreviewLayerEvents(capabilities = {}) {
  const getSnapshot = typeof capabilities.getSnapshot === 'function' ? capabilities.getSnapshot : () => ({});
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const getLayerEdit = typeof capabilities.getLayerEdit === 'function'
    ? capabilities.getLayerEdit
    : () => ({});
  const getDocument = typeof capabilities.getOwnerDocument === 'function'
    ? capabilities.getOwnerDocument
    : (typeof capabilities.getDocument === 'function' ? capabilities.getDocument : () => capabilities.ownerDocument || capabilities.documentRef || null);
  const getSortable = typeof capabilities.getSortable === 'function'
    ? capabilities.getSortable
    : () => capabilities.sortable || null;
  const actions = capabilities.actions || capabilities;
  const callAction = typeof capabilities.callAction === 'function'
    ? capabilities.callAction
    : (name, value, context) => {
      const actionName = (ACTION_ALIASES[name] || [name]).find(candidate => typeof actions[candidate] === 'function');
      return actionName ? actions[actionName](value, context) : undefined;
    };
  const reportError = typeof capabilities.reportError === 'function' ? capabilities.reportError : () => undefined;
  const bindingByRoot = new WeakMap();
  const sortableByRoot = new WeakMap();

  function bind(root, rootIsCurrent = () => true) {
    if (!root || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function') {
      throw new TypeError('preview layer root must support event listeners');
    }
    bindingByRoot.get(root)?.();
    const operationToken = getOperationToken();
    let disposed = false;
    const documentRef = getDocument() || root.ownerDocument || null;
    const context = Object.freeze({ operationToken, isCurrent: () => !disposed && rootIsCurrent() && getOperationToken() === operationToken });
    const isCurrent = context.isCurrent;
    const invoke = (name, value) => {
      if (!isCurrent()) return undefined;
      try {
        const result = callAction(name, value, context);
        if (result && typeof result.catch === 'function') result.catch(error => { if (isCurrent()) reportError(error); });
        return result;
      } catch (error) {
        if (isCurrent()) reportError(error);
        return undefined;
      }
    };
    const history = (sectionId, layerId, label) => invoke(
      'pushEditorHistory', sectionId || layerId ? `${sectionId || '섹션'} ${layerId || '레이어'} ${label}` : label,
    );
    const onClick = event => {
      const undo = nodeInside(root, event, '#editorUndoBtn') || nodeInside(root, event, '#editorUndoTopBtn');
      if (undo) { event.preventDefault?.(); invoke('undoEditorChange'); return; }
      const redo = nodeInside(root, event, '#editorRedoBtn') || nodeInside(root, event, '#editorRedoTopBtn');
      if (redo) { event.preventDefault?.(); invoke('redoEditorChange'); return; }
      const tone = nodeInside(root, event, '[data-tone-preset]');
      if (tone) { event.preventDefault?.(); invoke('applyTonePreset', tone.dataset.tonePreset); return; }
      if (nodeInside(root, event, '#resetPreviewOrder')) { event.preventDefault?.(); invoke('resetPreviewOrder'); return; }
      const selected = nodeInside(root, event, '[data-layer-select]');
      if (selected) {
        const { sectionId, layerId } = layerParts(selected.dataset.layerSelect);
        if (sectionId && layerId) invoke('setActivePreviewLayer', { sectionId, layerId });
        return;
      }
      const domLayer = nodeInside(root, event, '[data-layer-section][data-layer-id]');
      if (domLayer) {
        const sectionId = cleanPart(domLayer.dataset.layerSection); const layerId = cleanPart(domLayer.dataset.layerId);
        if (sectionId && layerId && layerMode(getSnapshot())) { event.stopPropagation?.(); invoke('setActivePreviewLayer', { sectionId, layerId }); }
        return;
      }
      const resetSection = nodeInside(root, event, '[data-layer-reset-section]');
      if (resetSection) {
        const sectionId = cleanPart(resetSection.dataset.layerResetSection);
        if (sectionId) { history(sectionId, '', '레이어 초기화 전'); invoke('resetLayerSection', { sectionId }); }
        return;
      }
      const reset = nodeInside(root, event, '[data-layer-reset]');
      if (reset) {
        const { sectionId, layerId } = layerParts(reset.dataset.layerReset);
        if (sectionId && layerId) { history(sectionId, layerId, '초기화 전'); invoke('resetLayerEdit', { sectionId, layerId }); }
        return;
      }
      const nudge = nodeInside(root, event, '[data-layer-nudge]');
      if (nudge) {
        const [sectionId, layerId, dx, dy] = cleanPart(nudge.dataset.layerNudge).split(':');
        if (sectionId && layerId) { history(sectionId, layerId, '이동 전'); invoke('nudgeLayer', { sectionId, layerId, dx: finiteNumber(dx), dy: finiteNumber(dy) }); }
      }
    };
    const startInputHistory = event => {
      const input = nodeInside(root, event, '[data-layer-prop]');
      if (!input || input.dataset.historyStarted === '1') return;
      const { sectionId, layerId } = layerParts(input.dataset.layerProp);
      if (sectionId && layerId) { history(sectionId, layerId, '조정 전'); input.dataset.historyStarted = '1'; }
    };
    const onBlur = event => { const input = nodeInside(root, event, '[data-layer-prop]'); if (input) input.dataset.historyStarted = ''; };
    const onInput = event => {
      const input = nodeInside(root, event, '[data-layer-prop]');
      if (!input) return;
      const { sectionId, layerId, prop } = layerParts(input.dataset.layerProp);
      if (!sectionId || !layerId || !prop) return;
      const value = prop === 'align' ? String(input.value || '') : finiteNumber(input.value);
      invoke('setLayerEdit', { sectionId, layerId, patch: { [prop]: value } });
    };
    const activeDrags = new Map();
    const onPointerDown = event => {
      const input = nodeInside(root, event, '[data-layer-prop]');
      if (input) { startInputHistory(event); return; }
      const element = nodeInside(root, event, '[data-layer-section][data-layer-id]');
      if (!element || !layerMode(getSnapshot()) || event?.button !== 0) return;
      const sectionId = cleanPart(element.dataset.layerSection); const layerId = cleanPart(element.dataset.layerId);
      if (!sectionId || !layerId) return;
      event.preventDefault?.(); event.stopPropagation?.();
      invoke('setActivePreviewLayer', { sectionId, layerId });
      history(sectionId, layerId, '드래그 전');
      const start = getLayerEdit(sectionId, layerId) || {};
      const drag = { pointerId: event.pointerId, startX: finiteNumber(event.clientX), startY: finiteNumber(event.clientY), x: finiteNumber(start.x), y: finiteNumber(start.y), scale: finiteNumber(start.scale, 1) };
      activeDrags.set(element, drag);
      element.setPointerCapture?.(event.pointerId);
      element.style.cursor = 'grabbing';
      const update = moveEvent => {
        if (!isCurrent() || activeDrags.get(element) !== drag) return;
        const x = Math.round(drag.x + finiteNumber(moveEvent.clientX) - drag.startX);
        const y = Math.round(drag.y + finiteNumber(moveEvent.clientY) - drag.startY);
        drag.nextX = x; drag.nextY = y;
        element.style.transform = `translate(${x}px,${y}px) scale(${drag.scale})`;
      };
      const finish = finishEvent => {
        if (activeDrags.get(element) !== drag) return;
        activeDrags.delete(element);
        element.removeEventListener?.('pointermove', update);
        element.removeEventListener?.('pointerup', finish);
        element.removeEventListener?.('pointercancel', cancel);
        element.releasePointerCapture?.(finishEvent?.pointerId ?? drag.pointerId);
        element.style.cursor = '';
        if (finishEvent?.type === 'pointerup' && isCurrent() && Number.isFinite(drag.nextX) && Number.isFinite(drag.nextY)) {
          invoke('commitLayerDrag', { sectionId, layerId, x: drag.nextX, y: drag.nextY });
        }
      };
      const cancel = finishEvent => finish({ ...finishEvent, type: 'pointercancel' });
      drag.update = update; drag.finish = finish; drag.cancel = cancel;
      element.addEventListener?.('pointermove', update); element.addEventListener?.('pointerup', finish); element.addEventListener?.('pointercancel', cancel);
    };
    const onKeyDown = event => {
      if (inputFocused(documentRef, event)) return;
      const key = String(event?.key || '').toLowerCase();
      if (event?.ctrlKey && !event?.shiftKey && key === 'z') { event.preventDefault?.(); invoke('undoEditorChange'); return; }
      if (event?.ctrlKey && (key === 'y' || (event?.shiftKey && key === 'z'))) { event.preventDefault?.(); invoke('redoEditorChange'); return; }
      const active = getSnapshot()?.activePreviewLayer;
      if (!layerMode(getSnapshot()) || !active) return;
      const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event?.key];
      if (!direction) return;
      event.preventDefault?.();
      const step = event?.shiftKey ? 10 : 1;
      history(active.sectionId, active.layerId, '키보드 이동 전');
      invoke('nudgeLayer', { sectionId: active.sectionId, layerId: active.layerId, dx: direction[0] * step, dy: direction[1] * step });
    };
    const listeners = [[root, 'click', onClick], [root, 'input', onInput], [root, 'focus', startInputHistory, true], [root, 'pointerdown', onPointerDown], [root, 'blur', onBlur, true]];
    for (const [target, type, handler, capture] of listeners) target.addEventListener(type, handler, capture);
    documentRef?.addEventListener?.('keydown', onKeyDown);
    const outline = root.querySelector?.('#previewOutlineSortable');
    const sortableApi = getSortable();
    if (outline && typeof sortableApi?.create === 'function') {
      const sortable = sortableApi.create(outline, {
        handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
        onStart: () => { if (isCurrent()) history('', '', '미리보기 섹션 순서 변경 전'); },
        onEnd: () => {
          if (!isCurrent()) return;
          const ids = [...(outline.querySelectorAll?.('[data-outline-section-id]') || [])].map(node => cleanPart(node.dataset.outlineSectionId)).filter(Boolean);
          invoke('updateSectionOrder', ids);
        },
      });
      sortableByRoot.set(root, sortable);
    }
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const [target, type, handler, capture] of listeners) target.removeEventListener(type, handler, capture);
      documentRef?.removeEventListener?.('keydown', onKeyDown);
      for (const [element, drag] of activeDrags) {
        element.removeEventListener?.('pointermove', drag.update); element.removeEventListener?.('pointerup', drag.finish); element.removeEventListener?.('pointercancel', drag.cancel);
        element.releasePointerCapture?.(drag.pointerId); element.style.cursor = '';
      }
      activeDrags.clear();
      sortableByRoot.get(root)?.destroy?.(); sortableByRoot.delete(root);
      if (bindingByRoot.get(root) === dispose) bindingByRoot.delete(root);
    };
    bindingByRoot.set(root, dispose);
    return dispose;
  }

  return Object.freeze({ bind, refresh: bind });
}

export const bindPreviewLayerEvents = createPreviewLayerEvents;

export function createPreviewLayerBridge(input = {}) {
  const runtime = input.runtimeCapabilities || {};
  const renderHelpers = input.renderHelpers || {};
  const events = createPreviewLayerEvents({
    getSnapshot: input.getSnapshot,
    getOperationToken: input.getOperationToken,
    getDocument: runtime.getDocument,
    getSortable: runtime.getSortable || renderHelpers.getSortable,
    getLayerEdit: runtime.getLayerEdit,
    actions: input.actions,
    callAction: input.invokeAction,
    reportError: input.reportError,
  });
  const boundRoots = new WeakMap();
  const bind = (root, isCurrent) => { const dispose = events.bind(root, isCurrent); boundRoots.set(root, dispose); return dispose; };
  const refresh = (root, isCurrent) => { boundRoots.get(root)?.(); return bind(root, isCurrent); };
  const dispose = root => { boundRoots.get(root)?.(); boundRoots.delete(root); };
  return Object.freeze({ bind, refresh, dispose });
}
