import { WorkspaceLockError, text } from './workspace-lock-protocol.mjs';

export function createWorkspaceLockTransport({ root, serverBases, sessionId }) {
  const releaseFlights = new Map();
  const releaseQueues = new Map();

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

  async function waitForPriorRelease(scopeId) {
    const prior = releaseQueues.get(scopeId);
    if (!prior) return;
    try {
      await prior;
    } catch (_) {}
  }

  return Object.freeze({ releaseAcceptedLease, request, waitForPriorRelease });
}
