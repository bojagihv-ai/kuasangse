import {
  WorkspaceLockError, fromServer, frozenSnapshot, isDraft, text, unavailable,
} from './workspace-lock-protocol.mjs';

export function createWorkspaceLockTransitions({
  sessionId, ttlMs, reloadAccepted, readCurrent, notify,
  request, releaseAcceptedLease, waitForPriorRelease, getLifecycle,
}) {
  const acquireFlights = new Map();
  let authorityTransitionGeneration = 0;
  let authorityTransitionIntent = { generation: 0, kind: 'idle', scopeId: '', operation: null };
  let activeTakeoverGeneration = 0;

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
    const current = readCurrent();
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

  function currentOwnsAcceptedLease(accepted) {
    const current = readCurrent();
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

  async function acquire({ scopeId, ownerId, confirmedTakeover = false } = {}) {
    const scope = text(scopeId);
    const current = readCurrent();
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
      const lifecycle = getLifecycle();
      lifecycle.bindChannel(scope);
      if (isDraft(scope)) {
        const draft = notify(unavailable(scope));
        lifecycle.announce('presence');
        return draft;
      }
      notify({ mode: 'acquiring', scopeId: scope, ownerId: text(ownerId), sessionId });
      await waitForPriorRelease(scope);
      if (generation !== authorityTransitionGeneration) return readCurrent();
      try {
        const { response, payload } = await request('acquire', {
          workspaceId: scope, ownerId: text(ownerId) || '이 창', sessionId,
          ttlMs, confirmedTakeover,
        });
        const server = fromServer(payload, scope);
        if (generation !== authorityTransitionGeneration) {
          if (response.ok) await releaseSupersededAcceptedLease(server, generation);
          return readCurrent();
        }
        if (!response.ok) {
          const held = server;
          return notify({
            ...held, mode: 'readonly', reasonCode: text(payload.code || 'LEASE_HELD'),
            reason: payload.reason || `${held.ownerId || '다른 창'}에서 이 작업을 편집 중입니다.`,
          });
        }
        const next = notify(server);
        lifecycle.startHeartbeat();
        lifecycle.announce(confirmedTakeover ? 'takeover' : 'presence');
        return next;
      } catch (error) {
        if (generation !== authorityTransitionGeneration) return readCurrent();
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

  async function takeover(options = {}) {
    const current = readCurrent();
    const { scopeId = current.scopeId, ownerId = current.ownerId, confirmed = false } = options;
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
      await waitForPriorRelease(requestedScope);
      if (generation !== authorityTransitionGeneration) return readCurrent();
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
        return readCurrent();
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
          return readCurrent();
        }
        if (reloaded !== true) {
          throw new WorkspaceLockError(
            'TAKEOVER_RELOAD_FAILED', 'accepted workspace reload did not confirm installation', accepted,
          );
        }
      } catch (error) {
        if (generation !== authorityTransitionGeneration) {
          await releaseSupersededAcceptedLease(accepted, generation);
          return readCurrent();
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
      const lifecycle = getLifecycle();
      lifecycle.startHeartbeat();
      lifecycle.announce('takeover');
      return next;
    } catch (error) {
      if (generation !== authorityTransitionGeneration) return readCurrent();
      if (error instanceof WorkspaceLockError) throw error;
      return notify(unavailable(requestedScope, error));
    } finally {
      settleTransition();
      if (activeTakeoverGeneration === generation) activeTakeoverGeneration = 0;
    }
  }

  async function release({ keepalive = false } = {}) {
    const initial = readCurrent();
    const transition = beginAuthorityTransition('release', initial.scopeId);
    const current = readCurrent();
    if (current.mode !== 'editing') {
      if (current.mode !== 'acquiring') return current;
      const released = notify({
        ...current, mode: 'released', reasonCode: 'RELEASED', reason: '편집권을 반납했습니다.',
      });
      getLifecycle().announce('release');
      return released;
    }
    const authority = captureAuthorityTransition();
    const operation = (async () => {
      await releaseAcceptedLease(authority, { keepalive });
      if (!authorityTransitionIsCurrent(authority)) return readCurrent();
      const latest = readCurrent();
      const next = notify({ ...latest, mode: 'released', reasonCode: 'RELEASED', reason: '편집권을 반납했습니다.' });
      getLifecycle().announce('release');
      return next;
    })();
    transition.operation = operation;
    return operation;
  }

  function openReadOnly(reason = '사용자가 읽기 전용 모드를 선택했습니다.') {
    const current = readCurrent();
    beginAuthorityTransition('readonly', current.scopeId);
    return notify({ ...current, mode: 'readonly', reasonCode: 'USER_READ_ONLY', reason });
  }

  return Object.freeze({
    acquire,
    authorityTransitionIsCurrent,
    captureAuthorityTransition,
    openReadOnly,
    release,
    sameAuthorityTransition,
    takeover,
  });
}
