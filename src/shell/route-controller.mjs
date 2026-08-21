function cleanText(value) {
  return String(value ?? '').trim();
}

function requiredMethod(source, field, owner) {
  if (typeof source?.[field] !== 'function') {
    throw new TypeError(`${owner} ${field} must be a function`);
  }
  return source[field].bind(source);
}

export function createRouteController({ registry, renderLifecycle, routeGate } = {}) {
  const getByRoute = requiredMethod(registry, 'getByRoute', 'route registry');
  const activate = requiredMethod(renderLifecycle, 'activate', 'render lifecycle');
  const lifecycleRoute = requiredMethod(renderLifecycle, 'currentRoute', 'render lifecycle');
  const captureLifecycleOperation = requiredMethod(
    renderLifecycle,
    'captureOperation',
    'render lifecycle',
  );
  const isLifecycleCurrent = requiredMethod(renderLifecycle, 'isCurrent', 'render lifecycle');
  const disposeLifecycle = requiredMethod(renderLifecycle, 'dispose', 'render lifecycle');
  const gate = routeGate ?? (() => Object.freeze({ blocked: false }));
  if (typeof gate !== 'function') throw new TypeError('route gate must be a function');

  let activeWorkspaceId = '';
  let disposed = false;
  let requestSequence = 0;
  let revision = 0;
  const operations = new WeakSet();

  function currentRoute() {
    return lifecycleRoute();
  }

  function captureOperation() {
    const operation = Object.freeze({
      revision,
      lifecycle: captureLifecycleOperation(),
    });
    operations.add(operation);
    return operation;
  }

  function isCurrent(operation) {
    return !disposed
      && Boolean(operation)
      && operations.has(operation)
      && operation.revision === revision
      && isLifecycleCurrent(operation.lifecycle);
  }

  async function navigate(rawRoute, snapshot = {}) {
    if (disposed) throw new Error('route controller is disposed');
    const requestedRoute = cleanText(rawRoute);
    if (!requestedRoute) throw new TypeError('route is required');
    const workspaceId = cleanText(snapshot?.workspaceId);
    const request = requestSequence + 1;
    requestSequence = request;

    let route = requestedRoute;
    if (!snapshot?.bypassGate) {
      const decision = await gate(requestedRoute, snapshot);
      if (request !== requestSequence || disposed) {
        return Object.freeze({ ignored: true, reason: 'stale-navigation' });
      }
      if (decision?.blocked) {
        route = cleanText(decision.redirect);
        if (!route) throw new Error(`blocked route requires a redirect: ${requestedRoute}`);
      }
    }

    if (currentRoute() === route && activeWorkspaceId === workspaceId) {
      return Object.freeze({ activated: false, route, workspaceId });
    }
    const menu = getByRoute(route);
    if (!menu) throw new Error(`unregistered route: ${route}`);
    if (typeof menu.select !== 'function') throw new TypeError(`menu ${route} select must be a function`);

    revision += 1;
    const navigationRevision = revision;
    if (typeof menu.prepare === 'function') {
      await menu.prepare(snapshot);
      if (request !== requestSequence || disposed || navigationRevision !== revision) {
        return Object.freeze({ ignored: true, reason: 'stale-navigation' });
      }
    }
    const selected = await menu.select(snapshot);
    if (request !== requestSequence || disposed || navigationRevision !== revision) {
      return Object.freeze({ ignored: true, reason: 'stale-navigation' });
    }
    const result = await activate({ route, menu, snapshot: selected, workspaceId });
    if (request === requestSequence && navigationRevision === revision && !disposed) {
      activeWorkspaceId = workspaceId;
    }
    return result;
  }

  function dispose() {
    if (disposed) return undefined;
    disposed = true;
    requestSequence += 1;
    revision += 1;
    activeWorkspaceId = '';
    return disposeLifecycle();
  }

  return Object.freeze({ navigate, currentRoute, dispose, captureOperation, isCurrent });
}
