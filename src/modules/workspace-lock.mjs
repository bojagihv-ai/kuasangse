import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_TTL_MS,
  WorkspaceLockError,
  bases,
  fromServer,
  frozenSnapshot,
  isDraft,
  text,
  unavailable,
} from './workspace-lock-protocol.mjs';

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
  let channel = null;
  let heartbeatTimer = null;
  let mutationQueue = Promise.resolve();
  const acquireFlights = new Map();

  function notify(next) {
    current = frozenSnapshot({ ...next, sessionId: next.sessionId || sessionId });
    for (const listener of listeners) listener(current);
    return current;
  }

  async function request(path, body, { keepalive = false } = {}) {
    let lastError = null;
    for (const base of serverBases()) {
      try {
        const response = await root.fetch(`${text(base).replace(/\/$/, '')}/api/workspace-lock/${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
          keepalive,
        });
        const payload = await response.json();
        return { response, payload };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new WorkspaceLockError('AUTHORITY_UNAVAILABLE', 'workspace authority unavailable');
  }

  function announce(type = 'presence') {
    channel?.postMessage({
      type, scopeId: current.scopeId, sessionId, ownerId: current.ownerId,
      fencingToken: current.fencingToken, revision: current.revision, mode: current.mode,
    });
  }

  function bindChannel(scopeId) {
    channel?.close?.();
    channel = typeof root.BroadcastChannel === 'function'
      ? new root.BroadcastChannel(`kuasangse:workspace:${scopeId}`)
      : null;
    channel?.addEventListener?.('message', event => {
      const message = event?.data || {};
      if (message.sessionId === sessionId || message.scopeId !== current.scopeId) return;
      if (Number(message.fencingToken) > current.fencingToken && current.mode === 'editing') {
        notify({
          ...current, mode: 'readonly', reasonCode: 'TAKEN_OVER',
          ownerId: text(message.ownerId), fencingToken: Number(message.fencingToken),
          revision: Math.max(current.revision, Number(message.revision) || 0),
          reason: '다른 창이 편집권을 가져가 이 창은 읽기 전용으로 전환되었습니다.',
        });
      }
    });
  }

  async function heartbeat() {
    if (current.mode !== 'editing') return current;
    try {
      const { response, payload } = await request('heartbeat', {
        workspaceId: current.scopeId, leaseId: current.leaseId,
        fencingToken: current.fencingToken, ttlMs,
      });
      if (!response.ok) {
        return notify({
          ...fromServer(payload, current.scopeId), mode: 'readonly',
          reasonCode: text(payload.code || 'STALE_FENCE'),
          reason: payload.reason || '편집권이 만료되거나 다른 창으로 이동했습니다.',
        });
      }
      const next = notify(fromServer(payload, current.scopeId));
      announce('heartbeat');
      return next;
    } catch (error) {
      return notify(unavailable(current.scopeId, error));
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) root.clearInterval?.(heartbeatTimer);
    heartbeatTimer = root.setInterval?.(async () => heartbeat(), heartbeatMs) || null;
  }

  async function acquire({ scopeId, ownerId, confirmedTakeover = false } = {}) {
    const scope = text(scopeId);
    if (!scope) throw new WorkspaceLockError('INVALID_SCOPE', 'workspace scope is required');
    const flightKey = `${scope}\u0000${confirmedTakeover ? 'takeover' : 'acquire'}`;
    const activeFlight = acquireFlights.get(flightKey);
    if (activeFlight) return activeFlight;
    const operation = (async () => {
      bindChannel(scope);
      if (isDraft(scope)) {
        const draft = notify(unavailable(scope));
        announce('presence');
        return draft;
      }
      notify({ mode: 'acquiring', scopeId: scope, ownerId: text(ownerId), sessionId });
      try {
        const { response, payload } = await request('acquire', {
          workspaceId: scope, ownerId: text(ownerId) || '이 창', sessionId,
          ttlMs, confirmedTakeover,
        });
        if (!response.ok) {
          const held = fromServer(payload, scope);
          return notify({
            ...held, mode: 'readonly', reasonCode: text(payload.code || 'LEASE_HELD'),
            reason: payload.reason || `${held.ownerId || '다른 창'}에서 이 작업을 편집 중입니다.`,
          });
        }
        const next = notify(fromServer(payload, scope));
        startHeartbeat();
        announce(confirmedTakeover ? 'takeover' : 'presence');
        return next;
      } catch (error) {
        return notify(unavailable(scope, error));
      }
    })();
    acquireFlights.set(flightKey, operation);
    try {
      return await operation;
    } finally {
      if (acquireFlights.get(flightKey) === operation) acquireFlights.delete(flightKey);
    }
  }

  async function takeover({ scopeId = current.scopeId, ownerId = current.ownerId, confirmed = false } = {}) {
    if (!confirmed) throw new WorkspaceLockError('TAKEOVER_CONFIRMATION_REQUIRED', 'takeover confirmation is required');
    const requestedScope = text(scopeId);
    if (isDraft(requestedScope) || current.mode === 'offline-edit') {
      throw new WorkspaceLockError(
        'OFFLINE_DRAFT_TAKEOVER_FORBIDDEN',
        '로컬 초안은 서버 편집권 인계 대상이 아닙니다.',
        current,
      );
    }
    if (typeof reloadAccepted !== 'function') {
      throw new WorkspaceLockError(
        'TAKEOVER_RELOAD_REQUIRED', 'accepted workspace reload handler is unavailable', current,
      );
    }
    try {
      const { response, payload } = await request('takeover', {
        workspaceId: requestedScope, ownerId: text(ownerId) || '이 창', sessionId,
        ttlMs, confirmed: true,
      });
      if (!response.ok) throw new WorkspaceLockError(text(payload.code), text(payload.error || payload.reason));
      const accepted = fromServer(payload, requestedScope);
      notify({
        ...accepted,
        mode: 'acquiring',
        reasonCode: 'TAKEOVER_RELOAD',
        reason: '마지막 승인 저장본을 불러오는 중입니다.',
      });
      try {
        const reloaded = await reloadAccepted(accepted);
        if (reloaded !== true) {
          throw new WorkspaceLockError(
            'TAKEOVER_RELOAD_FAILED', 'accepted workspace reload did not confirm installation', accepted,
          );
        }
      } catch (error) {
        try {
          await request('release', {
            workspaceId: accepted.scopeId,
            leaseId: accepted.leaseId,
            fencingToken: accepted.fencingToken,
          });
        } catch (_) {}
        const failed = notify({
          ...accepted,
          mode: 'readonly',
          reasonCode: 'TAKEOVER_RELOAD_FAILED',
          reason: '마지막 승인 저장본을 확인하지 못해 편집권을 적용하지 않았습니다.',
        });
        throw new WorkspaceLockError(
          'TAKEOVER_RELOAD_FAILED', text(error?.message || error), failed,
        );
      }
      const next = notify(accepted);
      startHeartbeat();
      announce('takeover');
      return next;
    } catch (error) {
      if (error instanceof WorkspaceLockError) throw error;
      return notify(unavailable(requestedScope, error));
    }
  }

  async function refresh() {
    if (!current.scopeId || isDraft(current.scopeId)) return current;
    try {
      const query = `status?workspaceId=${encodeURIComponent(current.scopeId)}`;
      const { payload } = await request(query, null);
      const server = fromServer(payload, current.scopeId);
      if (server.leaseId && server.leaseId === current.leaseId && server.sessionId === sessionId) {
        return notify(server);
      }
      return notify({
        ...server, mode: 'readonly', reasonCode: server.reasonCode || 'LEASE_HELD',
        reason: server.ownerId ? `${server.ownerId}에서 이 작업을 편집 중입니다.` : '현재 편집권이 없습니다.',
      });
    } catch (error) {
      return notify(unavailable(current.scopeId, error));
    }
  }

  async function release({ keepalive = false } = {}) {
    if (current.mode !== 'editing') return current;
    try {
      await request('release', {
        workspaceId: current.scopeId, leaseId: current.leaseId,
        fencingToken: current.fencingToken,
      }, { keepalive });
    } catch (_) {}
    const next = notify({ ...current, mode: 'released', reasonCode: 'RELEASED', reason: '편집권을 반납했습니다.' });
    announce('release');
    return next;
  }

  function openReadOnly(reason = '사용자가 읽기 전용 모드를 선택했습니다.') {
    return notify({ ...current, mode: 'readonly', reasonCode: 'USER_READ_ONLY', reason });
  }

  function observeRevision(revision, fencingToken = current.fencingToken) {
    if (Number(fencingToken) !== current.fencingToken) return current;
    const nextRevision = Number(revision) || 0;
    if (nextRevision <= current.revision) return current;
    const next = notify({ ...current, revision: nextRevision });
    announce('revision');
    return next;
  }

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
    acquire, heartbeat, observeRevision, openReadOnly, refresh, release, snapshot: () => current,
    runMutation, subscribe, takeover,
  });
}

export function installWorkspaceLock(root = globalThis, options = {}) {
  if (!root.__KUASANGSE_WORKSPACE_LOCK__) {
    root.__KUASANGSE_WORKSPACE_LOCK__ = createWorkspaceLockCoordinator({ ...options, root });
  }
  return root.__KUASANGSE_WORKSPACE_LOCK__;
}
