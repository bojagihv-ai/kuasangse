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
  const releaseFlights = new Map();
  const releaseQueues = new Map();
  let authorityTransitionGeneration = 0;
  let authorityTransitionIntent = { generation: 0, kind: 'idle', scopeId: '', operation: null };
  let activeTakeoverGeneration = 0;
  let heartbeatFlight = null;
  let refreshFlight = null;

  function notify(next) {
    current = frozenSnapshot({ ...next, sessionId: next.sessionId || sessionId });
    for (const listener of listeners) listener(current);
    return current;
  }

  function beginAuthorityTransition(kind, scopeId) {
    const transition = {
      generation: authorityTransitionGeneration += 1,
      kind,
      scopeId: text(scopeId),
      operation: null,
    };
    authorityTransitionIntent = transition;
    return transition;
  }

  function captureAuthorityTransition() {
    return Object.freeze({
      generation: authorityTransitionGeneration,
      scopeId: current.scopeId,
      sessionId: current.sessionId,
      leaseId: current.leaseId,
      fencingToken: current.fencingToken,
    });
  }

  function sameAuthorityTransition(left, right) {
    return left?.generation === right?.generation
      && left?.scopeId === right?.scopeId
      && left?.sessionId === right?.sessionId
      && left?.leaseId === right?.leaseId
      && left?.fencingToken === right?.fencingToken;
  }

  function authorityTransitionIsCurrent(transition) {
    return sameAuthorityTransition(transition, captureAuthorityTransition());
  }

  function serverSnapshotIsMonotonic(server) {
    return server.fencingToken >= current.fencingToken && server.revision >= current.revision;
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

  function releaseAcceptedLease(accepted, { keepalive = false } = {}) {
    if (!accepted?.leaseId) return Promise.resolve();
    const scopeId = text(accepted.scopeId);
    const releaseKey = `${scopeId}\u0000${accepted.sessionId || sessionId}\u0000${accepted.leaseId}\u0000${accepted.fencingToken}`;
    const active = releaseFlights.get(releaseKey);
    if (active) return active;
    const prior = releaseQueues.get(scopeId) || Promise.resolve();
    let operation;
    operation = prior.catch(() => undefined).then(async () => {
      try {
        await request('release', {
          workspaceId: scopeId,
          leaseId: accepted.leaseId,
          fencingToken: accepted.fencingToken,
        }, { keepalive });
      } catch (_) {}
    }).finally(() => {
      if (releaseFlights.get(releaseKey) === operation) releaseFlights.delete(releaseKey);
      if (releaseQueues.get(scopeId) === operation) releaseQueues.delete(scopeId);
    });
    releaseFlights.set(releaseKey, operation);
    releaseQueues.set(scopeId, operation);
    return operation;
  }

  function currentOwnsAcceptedLease(accepted) {
    return (current.mode === 'editing' || current.mode === 'acquiring')
      && accepted.scopeId === current.scopeId
      && (accepted.sessionId || sessionId) === current.sessionId
      && accepted.leaseId === current.leaseId
      && accepted.fencingToken === current.fencingToken;
  }

  async function releaseSupersededAcceptedLease(accepted, generation) {
    while (true) {
      const latest = authorityTransitionIntent;
      const newerSameScopeAuthority = latest.generation > generation
        && (latest.kind === 'acquire' || latest.kind === 'takeover')
        && latest.scopeId === accepted.scopeId;
      if (!newerSameScopeAuthority || !latest.operation) break;
      try {
        await latest.operation;
      } catch (_) {}
      if (authorityTransitionIntent === latest) break;
    }
    if (currentOwnsAcceptedLease(accepted)) return;
    await releaseAcceptedLease(accepted);
  }

  async function waitForPriorRelease(scopeId) {
    const prior = releaseQueues.get(scopeId);
    if (!prior) return;
    try {
      await prior;
    } catch (_) {}
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

  async function runHeartbeat(transition) {
    try {
      const { response, payload } = await request('heartbeat', {
        workspaceId: transition.scopeId, leaseId: transition.leaseId,
        fencingToken: transition.fencingToken, ttlMs,
      });
      if (!authorityTransitionIsCurrent(transition)) return current;
      const server = fromServer(payload, transition.scopeId);
      if (!serverSnapshotIsMonotonic(server)) return current;
      if (!response.ok) {
        return notify({
          ...server, mode: 'readonly',
          reasonCode: text(payload.code || 'STALE_FENCE'),
          reason: payload.reason || '편집권이 만료되거나 다른 창으로 이동했습니다.',
        });
      }
      const next = notify(server);
      announce('heartbeat');
      return next;
    } catch (error) {
      if (!authorityTransitionIsCurrent(transition)) return current;
      return notify(unavailable(transition.scopeId, error));
    }
  }

  function heartbeat() {
    if (current.mode !== 'editing') return Promise.resolve(current);
    const transition = captureAuthorityTransition();
    if (heartbeatFlight && sameAuthorityTransition(heartbeatFlight.transition, transition)) {
      return heartbeatFlight.operation;
    }
    const operation = runHeartbeat(transition).finally(() => {
      if (heartbeatFlight?.operation === operation) heartbeatFlight = null;
    });
    heartbeatFlight = { transition, operation };
    return operation;
  }

  function startHeartbeat() {
    if (heartbeatTimer) root.clearInterval?.(heartbeatTimer);
    heartbeatTimer = root.setInterval?.(async () => heartbeat(), heartbeatMs) || null;
  }

  async function acquire({ scopeId, ownerId, confirmedTakeover = false } = {}) {
    const scope = text(scopeId);
    if (!scope) throw new WorkspaceLockError('INVALID_SCOPE', 'workspace scope is required');
    if (current.mode === 'acquiring' && current.reasonCode === 'TAKEOVER_RELOAD' && current.scopeId === scope) {
      throw new WorkspaceLockError('TAKEOVER_IN_PROGRESS', 'workspace takeover is already in progress', current);
    }
    const flightKey = `${scope}\u0000${confirmedTakeover ? 'takeover' : 'acquire'}`;
    const activeFlight = acquireFlights.get(flightKey);
    if (activeFlight?.generation === authorityTransitionGeneration) return activeFlight.operation;
    const transition = beginAuthorityTransition('acquire', scope);
    const generation = transition.generation;
    const operation = (async () => {
      bindChannel(scope);
      if (isDraft(scope)) {
        const draft = notify(unavailable(scope));
        announce('presence');
        return draft;
      }
      notify({ mode: 'acquiring', scopeId: scope, ownerId: text(ownerId), sessionId });
      await waitForPriorRelease(scope, generation);
      if (generation !== authorityTransitionGeneration) return current;
      try {
        const { response, payload } = await request('acquire', {
          workspaceId: scope, ownerId: text(ownerId) || '이 창', sessionId,
          ttlMs, confirmedTakeover,
        });
        const server = fromServer(payload, scope);
        if (generation !== authorityTransitionGeneration) {
          if (response.ok) await releaseSupersededAcceptedLease(server, generation);
          return current;
        }
        if (!response.ok) {
          const held = server;
          return notify({
            ...held, mode: 'readonly', reasonCode: text(payload.code || 'LEASE_HELD'),
            reason: payload.reason || `${held.ownerId || '다른 창'}에서 이 작업을 편집 중입니다.`,
          });
        }
        const next = notify(server);
        startHeartbeat();
        announce(confirmedTakeover ? 'takeover' : 'presence');
        return next;
      } catch (error) {
        if (generation !== authorityTransitionGeneration) return current;
        return notify(unavailable(scope, error));
      }
    })();
    transition.operation = operation;
    const flight = { generation, operation };
    acquireFlights.set(flightKey, flight);
    try {
      return await operation;
    } finally {
      if (acquireFlights.get(flightKey) === flight) acquireFlights.delete(flightKey);
    }
  }

  async function takeover({ scopeId = current.scopeId, ownerId = current.ownerId, confirmed = false } = {}) {
    if (!confirmed) throw new WorkspaceLockError('TAKEOVER_CONFIRMATION_REQUIRED', 'takeover confirmation is required');
    if (activeTakeoverGeneration > 0 && activeTakeoverGeneration === authorityTransitionGeneration) {
      throw new WorkspaceLockError('TAKEOVER_IN_PROGRESS', 'workspace takeover is already in progress', current);
    }
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
    const transition = beginAuthorityTransition('takeover', requestedScope);
    const generation = transition.generation;
    activeTakeoverGeneration = generation;
    let settleTransition;
    transition.operation = new Promise(resolve => { settleTransition = resolve; });
    try {
      await waitForPriorRelease(requestedScope, generation);
      if (generation !== authorityTransitionGeneration) return current;
      const { response, payload } = await request('takeover', {
        workspaceId: requestedScope, ownerId: text(ownerId) || '이 창', sessionId,
        ttlMs, confirmed: true,
      });
      const acceptedFromServer = fromServer(payload, requestedScope);
      const accepted = frozenSnapshot({
        ...acceptedFromServer,
        sessionId: acceptedFromServer.sessionId || sessionId,
      });
      if (generation !== authorityTransitionGeneration) {
        if (response.ok) await releaseSupersededAcceptedLease(accepted, generation);
        return current;
      }
      if (!response.ok) throw new WorkspaceLockError(text(payload.code), text(payload.error || payload.reason));
      notify({
        ...accepted,
        mode: 'acquiring',
        reasonCode: 'TAKEOVER_RELOAD',
        reason: '마지막 승인 저장본을 불러오는 중입니다.',
      });
      try {
        const reloaded = await reloadAccepted(accepted);
        if (generation !== authorityTransitionGeneration) {
          await releaseSupersededAcceptedLease(accepted, generation);
          return current;
        }
        if (reloaded !== true) {
          throw new WorkspaceLockError(
            'TAKEOVER_RELOAD_FAILED', 'accepted workspace reload did not confirm installation', accepted,
          );
        }
      } catch (error) {
        if (generation !== authorityTransitionGeneration) {
          await releaseSupersededAcceptedLease(accepted, generation);
          return current;
        }
        await releaseAcceptedLease(accepted);
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
      if (generation !== authorityTransitionGeneration) return current;
      if (error instanceof WorkspaceLockError) throw error;
      return notify(unavailable(requestedScope, error));
    } finally {
      settleTransition();
      if (activeTakeoverGeneration === generation) activeTakeoverGeneration = 0;
    }
  }

  async function runRefresh(transition) {
    try {
      const query = `status?workspaceId=${encodeURIComponent(transition.scopeId)}`;
      const { payload } = await request(query, null);
      if (!authorityTransitionIsCurrent(transition)) return current;
      const server = fromServer(payload, transition.scopeId);
      if (!serverSnapshotIsMonotonic(server)) return current;
      if (server.leaseId && server.leaseId === transition.leaseId && server.sessionId === sessionId) {
        return notify(server);
      }
      return notify({
        ...server, mode: 'readonly', reasonCode: server.reasonCode || 'LEASE_HELD',
        reason: server.ownerId ? `${server.ownerId}에서 이 작업을 편집 중입니다.` : '현재 편집권이 없습니다.',
      });
    } catch (error) {
      if (!authorityTransitionIsCurrent(transition)) return current;
      return notify(unavailable(transition.scopeId, error));
    }
  }

  function refresh() {
    if (current.mode === 'acquiring' || !current.scopeId || isDraft(current.scopeId)) {
      return Promise.resolve(current);
    }
    const transition = captureAuthorityTransition();
    if (refreshFlight && sameAuthorityTransition(refreshFlight.transition, transition)) {
      return refreshFlight.operation;
    }
    const operation = runRefresh(transition).finally(() => {
      if (refreshFlight?.operation === operation) refreshFlight = null;
    });
    refreshFlight = { transition, operation };
    return operation;
  }

  async function release({ keepalive = false } = {}) {
    const transition = beginAuthorityTransition('release', current.scopeId);
    if (current.mode !== 'editing') {
      if (current.mode !== 'acquiring') return current;
      const released = notify({
        ...current, mode: 'released', reasonCode: 'RELEASED', reason: '편집권을 반납했습니다.',
      });
      announce('release');
      return released;
    }
    const authority = captureAuthorityTransition();
    const operation = (async () => {
      await releaseAcceptedLease(authority, { keepalive });
      if (!authorityTransitionIsCurrent(authority)) return current;
      const next = notify({ ...current, mode: 'released', reasonCode: 'RELEASED', reason: '편집권을 반납했습니다.' });
      announce('release');
      return next;
    })();
    transition.operation = operation;
    return operation;
  }

  function openReadOnly(reason = '사용자가 읽기 전용 모드를 선택했습니다.') {
    beginAuthorityTransition('readonly', current.scopeId);
    return notify({ ...current, mode: 'readonly', reasonCode: 'USER_READ_ONLY', reason });
  }

  function observeRevision(revision, fencingToken = current.fencingToken) {
    if (current.mode === 'acquiring') return current;
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
