const MAX_MASK_HISTORY = 12;

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`); return source[name];
}

function numericSize(value, fallback = 48) {
  const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createPreviewAiRepairEvents(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const actions = capabilities.actions || {};
  const callAction = typeof capabilities.callAction === 'function'
    ? capabilities.callAction
    : (name, value, context) => actions[name]?.(value, context);
  const createImage = typeof capabilities.createImage === 'function' ? capabilities.createImage : () => null;
  const hasMaskPaint = typeof capabilities.hasMaskPaint === 'function' ? capabilities.hasMaskPaint : canvas => Boolean(canvas?.toDataURL?.());
  const buildEditMask = typeof capabilities.buildEditMask === 'function' ? capabilities.buildEditMask : canvas => canvas?.toDataURL?.('image/png') || '';
  const setTimer = typeof capabilities.setTimeout === 'function' ? capabilities.setTimeout : setTimeout;
  const clearTimer = typeof capabilities.clearTimeout === 'function' ? capabilities.clearTimeout : clearTimeout;
  const reportError = typeof capabilities.reportError === 'function' ? capabilities.reportError : () => undefined;
  const bindingByRoot = new WeakMap();

  function bind(root, rootIsCurrent = () => true) {
    if (!root || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function') {
      throw new TypeError('preview AI repair root must support event listeners');
    }
    bindingByRoot.get(root)?.();
    if (getSnapshot()?.aiRepair?.open !== true) return () => undefined;

    const operationToken = getOperationToken();
    let disposed = false;
    let invalidated = false;
    let drawing = false; let activePointerId = null; let lastPoint = null;
    let sourceImage = null;
    let maskCanvas = null;
    let sourceImageOnload = null;
    const restoreImageHandlers = new Set();
    const timers = new Set();
    const maskHistory = [];

    const context = Object.freeze({ operationToken, isCurrent: () => !disposed && !invalidated && rootIsCurrent() && getOperationToken() === operationToken });
    const isCurrent = context.isCurrent;
    const call = (name, value) => {
      if (!isCurrent()) return undefined;
      try { return callAction(name, value, context); } catch (error) { if (isCurrent()) reportError(error); return undefined; }
    };
    const point = event => {
      const rect = maskCanvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
      const width = Number(rect.width) || 1;
      const height = Number(rect.height) || 1;
      return { x: (Number(event?.clientX || 0) - rect.left) * ((maskCanvas?.width || width) / width), y: (Number(event?.clientY || 0) - rect.top) * ((maskCanvas?.height || height) / height), scale: (maskCanvas?.width || width) / width };
    };
    const setupCanvas = () => {
      if (!isCurrent() || !maskCanvas || !sourceImage) return;
      const width = Number(sourceImage.naturalWidth || sourceImage.clientWidth || 1024);
      const height = Number(sourceImage.naturalHeight || sourceImage.clientHeight || 1024);
      const dimensions = { width: Number.isFinite(width) && width > 0 ? width : 1024, height: Number.isFinite(height) && height > 0 ? height : 1024 };
      if (maskCanvas.width !== dimensions.width || maskCanvas.height !== dimensions.height) {
        maskCanvas.width = dimensions.width;
        maskCanvas.height = dimensions.height;
        restoreMask(getSnapshot()?.aiRepair?.maskDataUrl || '');
      }
      const context2d = maskCanvas.getContext?.('2d');
      if (context2d) { context2d.lineCap = 'round'; context2d.lineJoin = 'round'; }
    };
    const restoreMask = dataUrl => {
      if (!isCurrent() || !maskCanvas) return;
      const context2d = maskCanvas.getContext?.('2d');
      if (!context2d) return;
      context2d.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      if (!dataUrl) return;
      const image = createImage();
      if (!image) return;
      const onload = () => {
        restoreImageHandlers.delete(onload);
        if (!isCurrent() || !maskCanvas) return;
        context2d.drawImage(image, 0, 0, maskCanvas.width, maskCanvas.height);
      };
      restoreImageHandlers.add(onload);
      image.onload = onload;
      image.src = dataUrl;
    };
    const persistMask = value => call('persistAiRepairMask', value);
    const cacheMask = () => {
      if (!isCurrent() || !maskCanvas?.width || !maskCanvas?.height) return;
      persistMask(maskCanvas.toDataURL('image/png'));
    };
    const pushHistory = () => {
      if (!maskCanvas) return;
      maskHistory.push(maskCanvas.toDataURL('image/png'));
      if (maskHistory.length > MAX_MASK_HISTORY) maskHistory.splice(0, maskHistory.length - MAX_MASK_HISTORY);
    };
    const draw = event => {
      if (!isCurrent() || !drawing || !maskCanvas || !lastPoint) return;
      const next = point(event);
      const context2d = maskCanvas.getContext?.('2d');
      if (!context2d) return;
      context2d.globalCompositeOperation = 'source-over';
      context2d.strokeStyle = 'rgba(255,70,70,.72)';
      context2d.lineWidth = Math.max(2, numericSize(getSnapshot()?.aiRepair?.brushSize) * next.scale);
      context2d.beginPath();
      context2d.moveTo(lastPoint.x, lastPoint.y);
      context2d.lineTo(next.x, next.y);
      context2d.stroke();
      lastPoint = next;
    };
    const paintDot = target => {
      const context2d = maskCanvas?.getContext?.('2d');
      if (!context2d || !target) return;
      context2d.globalCompositeOperation = 'source-over';
      context2d.fillStyle = 'rgba(255,70,70,.72)';
      context2d.beginPath();
      context2d.arc(target.x, target.y, Math.max(2, (numericSize(getSnapshot()?.aiRepair?.brushSize) * target.scale) / 2), 0, Math.PI * 2);
      context2d.fill();
    };
    const onPointerDown = event => {
      if (!isCurrent() || !maskCanvas || getSnapshot()?.aiRepair?.busy || event?.button !== 0) return;
      event.preventDefault?.();
      setupCanvas();
      pushHistory();
      drawing = true;
      lastPoint = point(event); activePointerId = event.pointerId;
      maskCanvas.setPointerCapture?.(activePointerId);
      paintDot(lastPoint);
      draw(event);
    };
    const onPointerMove = event => draw(event);
    const finishDrawing = event => {
      if (!drawing || !isCurrent()) return;
      drawing = false; maskCanvas?.releasePointerCapture?.(event?.pointerId ?? activePointerId); activePointerId = null; lastPoint = null;
      cacheMask();
    };
    const onPointerCancel = () => finishDrawing({});
    const overlay = root.querySelector?.('#aiRepairOverlay');
    const closeButton = root.querySelector?.('#closeAiRepair');
    const mode = root.querySelector?.('#repairMode');
    const prompt = root.querySelector?.('#repairPrompt');
    const model = root.querySelector?.('#repairModel');
    const brush = root.querySelector?.('#repairBrushSize');
    const clearButton = root.querySelector?.('#repairClearMask');
    const undoButton = root.querySelector?.('#repairUndoMask');
    const undoLastEditButton = root.querySelector?.('#repairUndoLastEdit');
    const runButton = root.querySelector?.('#runAiRepair');
    sourceImage = root.querySelector?.('#repairSourceImage');
    maskCanvas = root.querySelector?.('#repairMaskCanvas');

    const onOverlayClick = event => {
      if (event?.target !== overlay) return;
      event.preventDefault?.();
      call('closeAiRepair');
      invalidated = true;
    };
    const onCloseClick = event => {
      event.preventDefault?.();
      call('closeAiRepair');
      invalidated = true;
    };
    const onFieldChange = event => {
      const target = event?.currentTarget || event?.target;
      if (!target) return;
      call('updateAiRepairField', { field: target.id === 'repairBrushSize' ? 'brushSize' : target.id.replace(/^repair/, '').toLowerCase(), value: target.value });
    };
    const onBrushInput = event => {
      const target = event?.currentTarget || event?.target;
      if (!target) return;
      const value = numericSize(target.value);
      const label = target.closest?.('.range-row')?.querySelector?.('b');
      if (label) label.textContent = `${value}px`;
      call('updateAiRepairField', { field: 'brushSize', value });
    };
    const onClearClick = event => {
      event.preventDefault?.();
      if (!isCurrent() || !maskCanvas) return;
      pushHistory();
      maskCanvas.getContext?.('2d')?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      persistMask('');
    };
    const onUndoClick = event => {
      event.preventDefault?.();
      if (!isCurrent() || !maskCanvas) return;
      restoreMask(maskHistory.pop() || '');
      const timer = setTimer(() => {
        timers.delete(timer);
        if (isCurrent()) cacheMask();
      }, 30);
      timers.add(timer);
    };
    const onUndoLastEditClick = event => {
      event.preventDefault?.();
      call('undoAiRepair', getSnapshot()?.aiRepair?.sectionId || '');
    };
    const onRunClick = event => {
      event.preventDefault?.();
      if (!isCurrent() || !maskCanvas) return;
      const visualMask = maskCanvas.toDataURL('image/png');
      const editMask = hasMaskPaint(maskCanvas) ? buildEditMask(maskCanvas) : '';
      const repair = getSnapshot()?.aiRepair || {};
      persistMask(visualMask);
      const result = call('runAiRepair', {
        visualMask,
        editMask,
        mode: repair.mode || 'spot',
        prompt: String(repair.prompt || ''),
        model: String(repair.model || ''),
      });
      if (result && typeof result.catch === 'function') Promise.resolve(result).catch(error => { if (isCurrent()) reportError(error); });
    };
    const listeners = [
      [overlay, 'click', onOverlayClick], [closeButton, 'click', onCloseClick],
      [mode, 'change', onFieldChange], [prompt, 'input', onFieldChange], [model, 'change', onFieldChange],
      [brush, 'input', onBrushInput], [clearButton, 'click', onClearClick], [undoButton, 'click', onUndoClick],
      [undoLastEditButton, 'click', onUndoLastEditClick], [runButton, 'click', onRunClick],
    ];
    for (const [node, type, handler] of listeners) node?.addEventListener?.(type, handler);
    if (sourceImage && maskCanvas) {
      sourceImageOnload = () => setupCanvas();
      sourceImage.onload = sourceImageOnload;
      if (sourceImage.complete && sourceImage.naturalWidth) setupCanvas();
      maskCanvas.addEventListener('pointerdown', onPointerDown);
      maskCanvas.addEventListener('pointermove', onPointerMove);
      maskCanvas.addEventListener('pointerup', finishDrawing);
      maskCanvas.addEventListener('pointercancel', onPointerCancel);
    }
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      invalidated = true;
      drawing = false;
      lastPoint = null;
      for (const [node, type, handler] of listeners) node?.removeEventListener?.(type, handler);
      if (maskCanvas) {
        maskCanvas.removeEventListener('pointerdown', onPointerDown);
        maskCanvas.removeEventListener('pointermove', onPointerMove);
        maskCanvas.removeEventListener('pointerup', finishDrawing);
        maskCanvas.removeEventListener('pointercancel', onPointerCancel);
        maskCanvas.releasePointerCapture?.(activePointerId); activePointerId = null;
      }
      if (sourceImage?.onload === sourceImageOnload) sourceImage.onload = null;
      for (const imageOnload of restoreImageHandlers) imageOnload.cancelled = true;
      restoreImageHandlers.clear();
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      if (bindingByRoot.get(root) === dispose) bindingByRoot.delete(root);
    };
    bindingByRoot.set(root, dispose);
    return dispose;
  }

  return Object.freeze({ bind, refresh: bind });
}

export const bindPreviewAiRepairEvents = createPreviewAiRepairEvents;
