import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_TTL_MS,
  bases,
  frozenSnapshot,
} from './workspace-lock-protocol.mjs';
import { createWorkspaceLockLifecycle } from './workspace-lock-lifecycle.mjs';
import { createWorkspaceLockTransport } from './workspace-lock-transport.mjs';
import { createWorkspaceLockTransitions } from './workspace-lock-transitions.mjs';

export { WorkspaceLockError } from './workspace-lock-protocol.mjs';

export function createWorkspaceLockCoordinator({
  root = globalThis,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  ttlMs = DEFAULT_TTL_MS,
  serverBases = () => bases(root),
  reloadAccepted = null,
} = {}) {
  const sessionId = root.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listeners = new Set();
  let current = frozenSnapshot({ mode: 'idle', sessionId });
  let mutationQueue = Promise.resolve();

  function notify(next) {
    current = frozenSnapshot({ ...next, sessionId: next.sessionId || sessionId });
    for (const listener of listeners) listener(current);
    return current;
  }

  const transport = createWorkspaceLockTransport({ root, serverBases, sessionId });
  let lifecycle = null;
  const transitions = createWorkspaceLockTransitions({
    sessionId,
    ttlMs,
    reloadAccepted,
    readCurrent: () => current,
    notify,
    request: transport.request,
    releaseAcceptedLease: transport.releaseAcceptedLease,
    waitForPriorRelease: transport.waitForPriorRelease,
    getLifecycle: () => lifecycle,
  });

  lifecycle = createWorkspaceLockLifecycle({
    root,
    sessionId,
    heartbeatMs,
    ttlMs,
    request: transport.request,
    readCurrent: () => current,
    notify,
    captureAuthorityTransition: transitions.captureAuthorityTransition,
    sameAuthorityTransition: transitions.sameAuthorityTransition,
    authorityTransitionIsCurrent: transitions.authorityTransitionIsCurrent,
  });

  function runMutation(operation) {
    if (typeof operation !== 'function') throw new TypeError('workspace mutation callback is required');
    const running = mutationQueue.then(() => operation());
    mutationQueue = running.catch(() => undefined);
    return running;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('workspace lock listener is required');
    listeners.add(listener);
    listener(current);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    acquire: transitions.acquire,
    heartbeat: lifecycle.heartbeat,
    observeRevision: lifecycle.observeRevision,
    openReadOnly: transitions.openReadOnly,
    refresh: lifecycle.refresh,
    release: transitions.release,
    snapshot: () => current,
    runMutation,
    subscribe,
    takeover: transitions.takeover,
  });
}

export function installWorkspaceLock(root = globalThis, options = {}) {
  if (!root.__KUASANGSE_WORKSPACE_LOCK__) {
    root.__KUASANGSE_WORKSPACE_LOCK__ = createWorkspaceLockCoordinator({ ...options, root });
  }
  return root.__KUASANGSE_WORKSPACE_LOCK__;
}
