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

  /**
   * 편집권 반납은 **진행 중인 쓰기 뒤에** 서야 한다.
   *
   * runMutation 은 쓰기끼리만 줄을 세웠고 release 는 그 줄에 서지 않았다. 그래서
   * 이미지 자산 POST 가 날아가는 중에 반납이 먼저 도착하면, 뒤늦게 닿은 쓰기가
   * 무효해진 lease 로 거절된다. 서버는 STALE_REVISION/LEASE_EXPIRED 로 409를 준다
   * (backend/services/workspace_lock_service.py).
   *
   * 이것이 GENERATE-01 이 절반쯤 실패하던 흐름이다 - archive-adapter.mjs 의 주석이
   * 이미 그 순서를 적어 두었다: "release 200 -> POST assets 409".
   * 그때는 409를 정직하게 드러내는 것까지만 고쳤고 경합 자체는 남아 있었다.
   *
   * 창을 닫는 순간의 반납(keepalive)은 기다릴 수 없으므로 예외로 둔다.
   */
  function release(options = {}) {
    if (options?.keepalive === true) return transitions.release(options);
    const running = mutationQueue.then(() => transitions.release(options));
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
    release,
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
