function cleanText(value) {
  return String(value ?? '').trim();
}

function isPromise(value) {
  return Boolean(value && typeof value.then === 'function');
}

function once(action) {
  let called = false;
  let result;
  return () => {
    if (called) return result;
    called = true;
    result = action();
    return result;
  };
}

function leave(record) {
  if (!record.entered) return undefined;
  record.entered = false;
  return record.menu.onLeave();
}

function cleanup(record) {
  if (!record || record.cleaned) return undefined;
  record.cleaned = true;
  let disposed;
  try {
    disposed = record.disposer?.();
  } catch (error) {
    const left = leave(record);
    if (isPromise(left)) {
      return Promise.resolve(left).then(() => { throw error; });
    }
    throw error;
  }
  if (!isPromise(disposed)) return leave(record);
  return Promise.resolve(disposed).then(
    () => leave(record),
    error => Promise.resolve(leave(record)).then(() => { throw error; }),
  );
}

function normalizeActivation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('render lifecycle activation must be an object');
  }
  const route = cleanText(input.route);
  if (!route) throw new TypeError('render lifecycle route is required');
  const menu = input.menu;
  if (!menu || typeof menu !== 'object') throw new TypeError('render lifecycle menu is required');
  for (const field of ['bind', 'onEnter', 'onLeave']) {
    if (typeof menu[field] !== 'function') throw new TypeError(`menu ${field} must be a function`);
  }
  const snapshot = input.snapshot ?? {};
  const workspaceId = cleanText(input.workspaceId ?? snapshot?.workspaceId);
  return Object.freeze({ route, menu, snapshot, workspaceId });
}

export function createRenderLifecycleCoordinator({ root, render } = {}) {
  if (!root || !['object', 'function'].includes(typeof root)) {
    throw new TypeError('render lifecycle root is required');
  }
  if (typeof render !== 'function') throw new TypeError('render lifecycle render must be a function');

  let active = null;
  let desired = null;
  let disposed = false;
  let revision = 0;
  let transition = Promise.resolve();
  const operations = new WeakSet();

  function currentRoute() {
    return active?.route ?? null;
  }

  function captureOperation() {
    const operation = Object.freeze({ revision });
    operations.add(operation);
    return operation;
  }

  function isCurrent(operation) {
    return !disposed
      && Boolean(operation)
      && operations.has(operation)
      && operation.revision === revision;
  }

  function isTicketCurrent(ticket) {
    return !disposed && ticket === revision;
  }

  async function performActivation(input, ticket) {
    if (!isTicketCurrent(ticket)) {
      return Object.freeze({ activated: false, ignored: true, reason: 'stale-activation' });
    }

    const previous = active;
    active = null;
    await cleanup(previous);
    if (!isTicketCurrent(ticket)) {
      return Object.freeze({ activated: false, ignored: true, reason: 'stale-activation' });
    }

    await render(Object.freeze({
      root,
      route: input.route,
      menu: input.menu,
      snapshot: input.snapshot,
    }));
    if (!isTicketCurrent(ticket)) {
      return Object.freeze({ activated: false, ignored: true, reason: 'stale-activation' });
    }

    const record = {
      route: input.route,
      workspaceId: input.workspaceId,
      menu: input.menu,
      disposer: null,
      entered: true,
      cleaned: false,
    };
    try {
      await input.menu.onEnter();
      if (!isTicketCurrent(ticket)) {
        await cleanup(record);
        return Object.freeze({ activated: false, ignored: true, reason: 'stale-activation' });
      }
      const disposer = await input.menu.bind(root);
      if (typeof disposer !== 'function') throw new TypeError('menu bind must return a disposer');
      record.disposer = once(disposer);
      if (!isTicketCurrent(ticket)) {
        await cleanup(record);
        return Object.freeze({ activated: false, ignored: true, reason: 'stale-activation' });
      }
      active = record;
      return Object.freeze({
        activated: true,
        route: input.route,
        workspaceId: input.workspaceId,
      });
    } catch (error) {
      await cleanup(record);
      throw error;
    }
  }

  function activate(rawInput) {
    if (disposed) throw new Error('render lifecycle is disposed');
    const input = normalizeActivation(rawInput);
    if (desired?.route === input.route && desired.workspaceId === input.workspaceId) {
      return desired.promise;
    }
    if (!desired && active?.route === input.route && active.workspaceId === input.workspaceId) {
      return Promise.resolve(Object.freeze({
        activated: false,
        route: input.route,
        workspaceId: input.workspaceId,
      }));
    }

    revision += 1;
    const ticket = revision;
    const promise = transition
      .catch(() => undefined)
      .then(() => performActivation(input, ticket));
    transition = promise;
    desired = { route: input.route, workspaceId: input.workspaceId, promise, ticket };
    const clearDesired = () => {
      if (desired?.ticket === ticket) desired = null;
    };
    promise.then(clearDesired, clearDesired);
    return promise;
  }

  function dispose() {
    if (disposed) return undefined;
    disposed = true;
    revision += 1;
    desired = null;
    const previous = active;
    active = null;
    return cleanup(previous);
  }

  return Object.freeze({ activate, currentRoute, captureOperation, isCurrent, dispose });
}
