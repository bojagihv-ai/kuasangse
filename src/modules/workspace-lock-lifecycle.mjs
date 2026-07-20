import { fromServer, isDraft, text, unavailable } from './workspace-lock-protocol.mjs';

export function createWorkspaceLockLifecycle({
  root,
  sessionId,
  heartbeatMs,
  ttlMs,
  request,
  readCurrent,
  notify,
  captureAuthorityTransition,
  sameAuthorityTransition,
  authorityTransitionIsCurrent,
}) {
  let channel = null;
  let heartbeatTimer = null;
  let heartbeatFlight = null;
  let refreshFlight = null;

  function announce(type = 'presence') {
    const current = readCurrent();
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
      const current = readCurrent();
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

  function serverSnapshotIsMonotonic(server) {
    const current = readCurrent();
    return server.fencingToken >= current.fencingToken && server.revision >= current.revision;
  }

  async function runHeartbeat(transition) {
    try {
      const { response, payload } = await request('heartbeat', {
        workspaceId: transition.scopeId, leaseId: transition.leaseId,
        fencingToken: transition.fencingToken, ttlMs,
      });
      if (!authorityTransitionIsCurrent(transition)) return readCurrent();
      const server = fromServer(payload, transition.scopeId);
      if (!serverSnapshotIsMonotonic(server)) return readCurrent();
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
      if (!authorityTransitionIsCurrent(transition)) return readCurrent();
      return notify(unavailable(transition.scopeId, error));
    }
  }

  function heartbeat() {
    const current = readCurrent();
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

  async function runRefresh(transition) {
    try {
      const query = `status?workspaceId=${encodeURIComponent(transition.scopeId)}`;
      const { payload } = await request(query, null);
      if (!authorityTransitionIsCurrent(transition)) return readCurrent();
      const server = fromServer(payload, transition.scopeId);
      if (!serverSnapshotIsMonotonic(server)) return readCurrent();
      if (server.leaseId && server.leaseId === transition.leaseId && server.sessionId === sessionId) {
        return notify(server);
      }
      return notify({
        ...server, mode: 'readonly', reasonCode: server.reasonCode || 'LEASE_HELD',
        reason: server.ownerId ? `${server.ownerId}에서 이 작업을 편집 중입니다.` : '현재 편집권이 없습니다.',
      });
    } catch (error) {
      if (!authorityTransitionIsCurrent(transition)) return readCurrent();
      return notify(unavailable(transition.scopeId, error));
    }
  }

  function refresh() {
    const current = readCurrent();
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

  function observeRevision(revision, fencingToken = readCurrent().fencingToken) {
    const current = readCurrent();
    if (current.mode === 'acquiring') return current;
    if (Number(fencingToken) !== current.fencingToken) return current;
    const nextRevision = Number(revision) || 0;
    if (nextRevision <= current.revision) return current;
    const next = notify({ ...current, revision: nextRevision });
    announce('revision');
    return next;
  }

  return Object.freeze({ announce, bindChannel, heartbeat, observeRevision, refresh, startHeartbeat });
}
