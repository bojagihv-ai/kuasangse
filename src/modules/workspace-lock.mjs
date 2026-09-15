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

const WORKSPACE_LOCK_SESSION_KEY = 'kuasangse.workspace-lock.session-id';

function stableSessionId(root) {
  try {
    const existing = String(root.sessionStorage?.getItem(WORKSPACE_LOCK_SESSION_KEY) || '').trim();
    if (existing) return existing;
  } catch {}
  const created = root.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { root.sessionStorage?.setItem(WORKSPACE_LOCK_SESSION_KEY, created); } catch {}
  return created;
}

export function createWorkspaceLockCoordinator({
  root = globalThis,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  ttlMs = DEFAULT_TTL_MS,
  serverBases = () => bases(root),
  reloadAccepted = null,
} = {}) {
  const sessionId = stableSessionId(root);
  const listeners = new Set();
  let current = frozenSnapshot({ mode: 'idle', sessionId });
  let mutationQueue = Promise.resolve();
  let mutationBarrier = mutationQueue;
  let pendingMutations = 0;
  let releaseIntent = 0;

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

  function enqueueMutation(operation) {
    const running = mutationQueue.then(operation);
    mutationQueue = running.catch(() => undefined);
    return running;
  }

  function runMutation(operation) {
    if (typeof operation !== 'function') throw new TypeError('workspace mutation callback is required');
    pendingMutations += 1;
    const running = enqueueMutation(async () => {
      try {
        return await operation();
      } finally {
        pendingMutations -= 1;
      }
    });
    mutationBarrier = running.catch(() => undefined);
    return running;
  }

  function afterQueuedMutations(operation) {
    return pendingMutations > 0 ? mutationBarrier.then(operation) : operation();
  }

  function acquire(options) {
    const scopeId = String(options?.scopeId || '').trim();
    const currentAuthority = current;
    if (pendingMutations > 0
      && currentAuthority.mode === 'editing'
      && currentAuthority.scopeId === scopeId
      && options?.confirmedTakeover !== true) {
      releaseIntent += 1;
      return Promise.resolve(currentAuthority);
    }
    return afterQueuedMutations(() => transitions.acquire(options));
  }

  function openReadOnly(reason) {
    return afterQueuedMutations(() => transitions.openReadOnly(reason));
  }

  function takeover(options) {
    return afterQueuedMutations(() => transitions.takeover(options));
  }

  function release(options) {
    const transition = transitions.captureAuthorityTransition();
    const intent = releaseIntent += 1;
    return enqueueMutation(() => intent === releaseIntent
      && transitions.authorityTransitionIsCurrent(transition)
      ? transitions.release(options)
      : current);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('workspace lock listener is required');
    listeners.add(listener);
    listener(current);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    acquire,
    heartbeat: lifecycle.heartbeat,
    observeRevision: lifecycle.observeRevision,
    openReadOnly,
    refresh: lifecycle.refresh,
    release,
    snapshot: () => current,
    runMutation,
    subscribe,
    takeover,
  });
}

export function installWorkspaceLock(root = globalThis, options = {}) {
  if (!root.__KUASANGSE_WORKSPACE_LOCK__) {
    root.__KUASANGSE_WORKSPACE_LOCK__ = createWorkspaceLockCoordinator({ ...options, root });
  }
  return root.__KUASANGSE_WORKSPACE_LOCK__;
}
