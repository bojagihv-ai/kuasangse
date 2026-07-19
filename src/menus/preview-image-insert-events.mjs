const ACTION_ALIASES = Object.freeze({
  closeImageInsert: Object.freeze(['closeImageInsert']),
  applyImageInsert: Object.freeze(['applyImageInsert', 'insertLocalImage']),
  updateImageInsertFolder: Object.freeze(['updateImageInsertFolder']),
  loadDetailDriveImages: Object.freeze(['loadDetailDriveImages', 'loadInsertDriveImages']),
  connectImageInsertDrive: Object.freeze(['connectImageInsertDrive', 'connectInsertDrive', 'connectDrive']),
  useDriveDetailImage: Object.freeze(['useDriveDetailImage', 'useInsertDriveImage']),
  useCutDetailImage: Object.freeze(['useCutDetailImage', 'useInsertCutImage']),
  setImageInsertError: Object.freeze(['setImageInsertError']),
  requestRender: Object.freeze(['requestRender']),
});

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

function closestInside(root, target, selector) {
  const node = target?.closest?.(selector);
  return node && root?.contains?.(node) !== false ? node : null;
}

function errorMessage(error) {
  return String(error?.message || error || '이미지를 불러오지 못했습니다.');
}

export function createPreviewImageInsertEvents(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const readImageFileAsDataUrl = requiredFunction(capabilities, 'readImageFileAsDataUrl');
  const actions = capabilities.actions || {};
  const callAction = typeof capabilities.callAction === 'function'
    ? capabilities.callAction
    : (name, value, context, ...args) => {
      const aliases = ACTION_ALIASES[name] || [name];
      const actionName = aliases.find(candidate => typeof actions[candidate] === 'function');
      if (!actionName) return undefined;
      return actions[actionName](value, ...args, context);
    };
  const isOpen = typeof capabilities.isOpen === 'function'
    ? capabilities.isOpen
    : () => getSnapshot()?.imageInsert?.open === true;
  const reportError = typeof capabilities.reportError === 'function' ? capabilities.reportError : () => undefined;
  const bindingByRoot = new WeakMap();

  function bind(root, rootIsCurrent = () => true) {
    if (!root || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function') {
      throw new TypeError('preview image insert root must support event listeners');
    }
    bindingByRoot.get(root)?.();

    const operationToken = getOperationToken();
    let disposed = false;
    let invalidated = false;
    const context = Object.freeze({
      operationToken,
      isCurrent: () => !disposed && !invalidated && rootIsCurrent() && isOpen() && getOperationToken() === operationToken,
    });
    const call = (name, value, ...args) => callAction(name, value, context, ...args);
    const reportCurrentError = error => {
      if (!context.isCurrent()) return;
      try {
        const result = call('setImageInsertError', errorMessage(error));
        if (result && typeof result.catch === 'function') result.catch(() => undefined);
        const renderResult = call('requestRender');
        if (renderResult && typeof renderResult.catch === 'function') renderResult.catch(() => undefined);
      } catch (reportFailure) {
        if (context.isCurrent()) reportError(reportFailure);
      }
    };
    const callAsync = (name, value) => {
      try {
        const result = call(name, value);
        if (result && typeof result.catch === 'function') {
          Promise.resolve(result).catch(error => reportCurrentError(error));
        }
        return result;
      } catch (error) {
        reportCurrentError(error);
        return undefined;
      }
    };
    const onClick = event => {
      const overlay = closestInside(root, event?.target, '#imageInsertOverlay');
      if (overlay && event?.target === overlay) {
        event.preventDefault?.();
        call('closeImageInsert');
        invalidated = true;
        return;
      }
      if (closestInside(root, event?.target, '#closeImageInsert')) {
        event.preventDefault?.();
        call('closeImageInsert');
        invalidated = true;
        return;
      }
      if (closestInside(root, event?.target, '#pickDetailImageFile')) {
        event.preventDefault?.();
        root.querySelector?.('#detailImageInsertFileInput')?.click?.();
        return;
      }
      if (closestInside(root, event?.target, '#loadDetailDriveImages')) {
        event.preventDefault?.();
        const folder = root.querySelector?.('#detailImageDriveFolderInput')?.value || '';
        callAsync('loadDetailDriveImages', String(folder));
        return;
      }
      if (closestInside(root, event?.target, '#connectImageInsertDrive')) {
        event.preventDefault?.();
        callAsync('connectImageInsertDrive');
        return;
      }
      const drive = closestInside(root, event?.target, '[data-use-drive-detail-image]');
      if (drive) {
        event.preventDefault?.();
        callAsync('useDriveDetailImage', String(drive.dataset?.useDriveDetailImage || ''));
        return;
      }
      const cut = closestInside(root, event?.target, '[data-use-cut-detail-image]');
      if (cut) {
        event.preventDefault?.();
        callAsync('useCutDetailImage', String(cut.dataset?.useCutDetailImage || ''));
      }
    };
    const onInput = event => {
      const input = closestInside(root, event?.target, '#detailImageDriveFolderInput');
      if (!input) return;
      call('updateImageInsertFolder', String(input.value || ''));
    };
    const onChange = event => {
      const input = closestInside(root, event?.target, '#detailImageInsertFileInput')
        || (event?.target?.files ? root.querySelector?.('#detailImageInsertFileInput') : null);
      const file = input?.files?.[0] || event?.target?.files?.[0];
      if (!input || !file || !context.isCurrent()) return;
      let readResult;
      try {
        readResult = readImageFileAsDataUrl(file, context);
      } catch (error) {
        reportCurrentError(error);
        return;
      }
      Promise.resolve(readResult).then(dataUrl => {
        if (!context.isCurrent()) return;
        call('applyImageInsert', dataUrl, file.name, '내 파일');
      }).catch(error => reportCurrentError(error));
    };
    const listeners = Object.freeze({ click: onClick, input: onInput, change: onChange });
    root.addEventListener('click', onClick, true);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      invalidated = true;
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      if (bindingByRoot.get(root) === dispose) bindingByRoot.delete(root);
    };
    bindingByRoot.set(root, dispose);
    return dispose;
  }

  return Object.freeze({ bind });
}

export function createPreviewImageInsertBridge(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const invokeAction = requiredFunction(capabilities, 'invokeAction');
  const readImageFileAsDataUrl = typeof capabilities.readImageFileAsDataUrl === 'function'
    ? capabilities.readImageFileAsDataUrl
    : () => Promise.reject(new Error('파일 읽기 capability가 없습니다.'));
  return createPreviewImageInsertEvents({
    getSnapshot,
    getOperationToken,
    readImageFileAsDataUrl,
    actions: capabilities.actions,
    callAction(name, value, context, ...args) {
      const payload = name === 'applyImageInsert' ? { dataUrl: value, label: args[0], source: args[1] } : value;
      return invokeAction(name, payload, context.isCurrent);
    },
  });
}

export const bindPreviewImageInsertEvents = createPreviewImageInsertEvents;
