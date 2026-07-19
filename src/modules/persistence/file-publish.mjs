const LOCAL_FILE_QUEUES = new Map();
const ANONYMOUS_HANDLE_IDS = new WeakMap();
let nextAnonymousHandleId = 1;

export class FilePublishError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FilePublishError';
    this.code = code;
  }
}

async function currentText(handle) {
  if (typeof handle?.getFile !== 'function') return null;
  const file = await handle.getFile();
  return file.text();
}

async function expectedText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.text === 'function') return value.text();
  return String(value ?? '');
}

async function replaceFile(handle, value) {
  const writable = await handle.createWritable();
  try {
    await writable.write(value);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch (_) {}
    throw error;
  }
}

function physicalHandleIdentity(handle) {
  const name = String(handle?.name || '').trim().toLocaleLowerCase();
  const kind = String(handle?.kind || 'file').trim().toLocaleLowerCase();
  if (name) return `${kind}:${name}`;
  if (!ANONYMOUS_HANDLE_IDS.has(handle)) {
    ANONYMOUS_HANDLE_IDS.set(handle, `anonymous:${nextAnonymousHandleId}`);
    nextAnonymousHandleId += 1;
  }
  return ANONYMOUS_HANDLE_IDS.get(handle);
}

async function localLock(name, operation) {
  const previous = LOCAL_FILE_QUEUES.get(name) || Promise.resolve();
  const running = previous.then(operation);
  LOCAL_FILE_QUEUES.set(name, running.catch(() => undefined));
  return running;
}

export async function publishWorkspaceFile({ root, handle, value, context = {}, verifyBeforeClose = null }) {
  if (!handle || typeof handle.createWritable !== 'function') {
    throw new FilePublishError('FILE_HANDLE_REQUIRED', 'writable file handle is required');
  }
  context.assertAuthority?.();
  const expectedOriginal = await currentText(handle);
  context.assertAuthority?.();
  const lockName = `kuasangse:file-publish:${physicalHandleIdentity(handle)}`;
  const operation = async () => {
    context.assertAuthority?.();
    const expected = await expectedText(value);
    const original = await currentText(handle);
    if (expectedOriginal !== null && original !== expectedOriginal) {
      throw new FilePublishError(
        'FILE_DESTINATION_CHANGED', 'file destination changed before atomic publish',
      );
    }
    const writable = await handle.createWritable();
    let published = false;
    try {
      await writable.write(value);
      if (verifyBeforeClose) await verifyBeforeClose();
      context.assertCompletion?.();
      context.assertAuthority?.();
      await writable.close();
      published = true;
      const actual = await currentText(handle);
      if (actual !== null && actual !== expected) {
        throw new FilePublishError('FILE_VERIFY_FAILED', 'published file content did not match staged content');
      }
      context.assertCompletion?.();
      context.assertAuthority?.();
      return handle;
    } catch (error) {
      if (!published) {
        try { await writable.abort?.(); } catch (_) {}
      } else if (original !== null) {
        const latest = await currentText(handle);
        if (latest === expected) await replaceFile(handle, original);
      }
      throw error;
    }
  };
  if (typeof root?.navigator?.locks?.request === 'function') {
    return root.navigator.locks.request(lockName, operation);
  }
  return localLock(lockName, operation);
}
