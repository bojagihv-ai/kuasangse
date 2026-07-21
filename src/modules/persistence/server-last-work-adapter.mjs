import { migrateServerSnapshot } from './migrations.mjs';
import { normalizeWorkspaceScope } from './contracts.mjs';

const PROTECTED_SERVER_NOOP_REASONS = new Set([
  'incoming snapshot has no competitor analysis result',
]);

function protectedServerNoop(result, envelope, context = {}) {
  if (result?.accepted !== false || result?.keptExisting !== true || result?.protectedNoOp !== true) return null;
  if (!PROTECTED_SERVER_NOOP_REASONS.has(String(result.reason || ''))) return null;
  const scopeId = normalizeWorkspaceScope(result.scopeId || envelope.scopeId);
  const revision = Number(result.revision);
  const expectedRevision = Number(context.expectedRevision);
  if (scopeId !== envelope.scopeId || !Number.isInteger(revision)
    || !Number.isInteger(expectedRevision) || revision !== expectedRevision) return null;
  return Object.freeze({
    protectedNoOp: true,
    scopeId,
    revision,
    acceptedRevision: revision,
    reason: String(result.reason || ''),
  });
}

function defaultBases(root) {
  const origin = String(root.location?.origin || '').replace(/\/$/, '');
  return [...new Set([origin, 'http://127.0.0.1:5050'].filter(Boolean))];
}

export class ServerPersistenceError extends Error {
  constructor(status, payload = {}) {
    super(payload.error || payload.reason || `server persistence rejected (${status})`);
    this.name = 'ServerPersistenceError';
    this.status = status;
    this.code = payload.code || 'SERVER_REJECTED';
    this.snapshot = Object.freeze({ ...payload });
  }
}

export function createServerLastWorkAdapter({
  root = typeof self === 'undefined' ? null : self,
  fetchImpl = root?.fetch?.bind(root),
  bases = () => defaultBases(root),
} = {}) {
  async function request(path, options = {}, scopeId = '', baseOverride = null) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
    const scope = normalizeWorkspaceScope(scopeId);
    const separator = String(path).includes('?') ? '&' : '?';
    let lastError = null;
    const candidates = Array.isArray(baseOverride) && baseOverride.length ? baseOverride : bases();
    for (const base of candidates) {
      try {
        const response = await fetchImpl(`${String(base).replace(/\/$/, '')}${path}${separator}workspaceId=${encodeURIComponent(scope)}`, options);
        if (!response.ok) {
          let payload = {};
          try { payload = await response.json(); } catch (_) {}
          if (response.status === 409 || response.status === 428) {
            throw new ServerPersistenceError(response.status, payload);
          }
          lastError = new ServerPersistenceError(response.status, payload);
          continue;
        }
        return response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('server last-work unavailable');
  }

  return Object.freeze({
    name: 'server',
    request,
    async read(scopeId) {
      const result = await request('/api/last-work', { method: 'GET', cache: 'no-store' }, scopeId);
      if (!result?.hasSnapshot || !result.snapshot) return null;
      const migrated = migrateServerSnapshot(result);
      const hasServerRevision = Object.hasOwn(result, 'revision');
      const authoritativeRevision = Object.freeze({
        scopeId: normalizeWorkspaceScope(scopeId),
        counter: Number(result.revision) || 0,
        updatedAt: Number(result.savedAt || migrated.savedAt) || 0,
        writerId: 'server-authority',
      });
      return Object.freeze({
        ...migrated,
        metadata: Object.freeze({
          ...migrated.metadata,
          revision: hasServerRevision ? authoritativeRevision : migrated.metadata.revision,
        }),
      });
    },
    async write(envelope, context = {}) {
      context.assertAuthority?.();
      const serverSnapshot = context.serverSnapshot || envelope.snapshot;
      const result = await request('/api/last-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: envelope.scopeId,
          snapshot: {
            ...structuredClone(serverSnapshot),
            persistenceEnvelope: structuredClone(envelope),
          },
          metadata: envelope.metadata,
          leaseId: context.leaseId || envelope.metadata.leaseId,
          fencingToken: context.fencingToken || envelope.metadata.fencingToken,
          expectedRevision: Number(context.expectedRevision) || 0,
          revision: envelope.metadata.revision.counter,
          force: context.force === true,
          repair: context.repair === true,
        }),
      }, envelope.scopeId, context.bases);
      if (result?.accepted === false) {
        const noOp = protectedServerNoop(result, envelope, context);
        if (noOp) {
          if (typeof context.assertCompletion === 'function') context.assertCompletion();
          else context.assertAuthority?.();
          return noOp;
        }
        throw new ServerPersistenceError(409, {
          ...result,
          code: result.code || 'SERVER_SNAPSHOT_REJECTED',
          error: result.reason || 'server kept the existing workspace snapshot',
        });
      }
      if (typeof context.assertCompletion === 'function') context.assertCompletion();
      else context.assertAuthority?.();
      return envelope;
    },
  });
}
