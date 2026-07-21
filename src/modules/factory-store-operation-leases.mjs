import { cleanText } from './factory-store-data.mjs';

export function createFactoryOperationLeases({ ensureActive, readOperationToken }) {
  const active = new Map();

  function keyFor(value) {
    const key = cleanText(value);
    if (!key) throw new TypeError('factory operation lease key is required');
    return key;
  }

  function staleError(key) {
    const error = new Error(`STALE_FACTORY_STORE_OPERATION: ${key}`);
    error.code = 'STALE_FACTORY_STORE_OPERATION';
    return error;
  }

  function abort(record) {
    if (!record || record.controller.signal.aborted) return false;
    record.controller.abort();
    return true;
  }

  function cancelAll() {
    for (const record of active.values()) abort(record);
    active.clear();
  }

  function acquire(value, expectedToken = readOperationToken()) {
    ensureActive();
    const key = keyFor(value);
    if (expectedToken !== readOperationToken()) throw staleError(key);
    const existing = active.get(key);
    if (existing) return Object.freeze({
      acquired: false, operationKey: key, operationToken: existing.operationToken,
      signal: existing.controller.signal, release: () => false,
    });
    const record = { controller: new AbortController(), operationToken: expectedToken };
    active.set(key, record);
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      if (active.get(key) !== record) return false;
      active.delete(key);
      return true;
    };
    return Object.freeze({
      acquired: true, operationKey: key, operationToken: expectedToken,
      signal: record.controller.signal, release,
    });
  }

  function cancel(value, expectedToken = readOperationToken()) {
    ensureActive();
    const key = keyFor(value);
    if (expectedToken !== readOperationToken()) throw staleError(key);
    const record = active.get(key);
    if (!record) return false;
    active.delete(key);
    abort(record);
    return true;
  }

  function has(value = '') {
    ensureActive();
    const key = cleanText(value);
    return key ? active.has(key) : active.size > 0;
  }

  return Object.freeze({ acquire, cancel, cancelAll, has, keys: () => [...active.keys()] });
}
