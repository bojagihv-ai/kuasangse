import { migrateLegacySession } from './migrations.mjs';
import { normalizeWorkspaceScope } from './contracts.mjs';
import { assertReplicaCanPublish, persistenceFence } from './fencing.mjs';
import { sanitizeWorkspaceSnapshot, workspaceContentDigest } from './serialization.mjs';

export const WORKSPACE_SESSION_KEYS = Object.freeze(new Set([
  'pdp_session', 'pdp_session_img', 'pdp_session_imgs', 'pdp_detail_image_blocks',
  'pdp_last_work_bootstrap_v1', 'pdp_last_work_draft_scope_v1',
  'factory_last_snapshot_v1',
]));

function parse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

const RECOVERY_RECORD_SCHEMA = 'kuasangse.recovery.v1';
const LAST_WORK_BOOTSTRAP_KEY = 'pdp_last_work_bootstrap_v1';

function recoveryRecord(raw) {
  const value = parse(raw);
  return value?.schema === RECOVERY_RECORD_SCHEMA ? value : null;
}

function recordScope(record) {
  const value = record?.scopeId
    || record?.workspaceScope?.id
    || record?.workspaceRevision?.scopeId
    || record?.currentProjectId;
  if (!value) return '';
  try { return normalizeWorkspaceScope(value); } catch (_) { return ''; }
}

export function createSessionStorageAdapter({ storage, authority = null } = {}) {
  const sessionStorage = storage || (typeof self === 'undefined' ? null : self.localStorage);
  function assertWorkspaceKey(key) {
    if (!WORKSPACE_SESSION_KEYS.has(key)) throw new Error(`unclassified workspace session key: ${key}`);
  }

  return Object.freeze({
    name: 'session',
    getItem(key) {
      assertWorkspaceKey(key);
      const raw = sessionStorage?.getItem(key) ?? null;
      const record = recoveryRecord(raw);
      if (!record) return raw;
      if (key !== 'pdp_last_work_draft_scope_v1') {
        const current = authority?.snapshot?.() || null;
        const stored = persistenceFence(record);
        if (stored.scopeId && current?.scopeId && stored.scopeId !== current.scopeId) return null;
        if (stored.scopeId === current?.scopeId && stored.fencingToken < Number(current.fencingToken)) return null;
        if (stored.scopeId === current?.scopeId
          && stored.fencingToken === Number(current.fencingToken)
          && stored.leaseId && current.leaseId && stored.leaseId !== current.leaseId) return null;
      }
      return record.value;
    },
    removeItem(key, context = {}) {
      assertWorkspaceKey(key);
      context.assertAuthority?.();
      const previous = sessionStorage?.getItem(key) ?? null;
      const existing = recoveryRecord(previous);
      if (existing) assertReplicaCanPublish(existing, { persistenceAuthority: context.persistenceAuthority });
      sessionStorage?.removeItem(key);
      try {
        context.assertCompletion?.();
      } catch (error) {
        if (previous !== null && sessionStorage?.getItem(key) === null) sessionStorage?.setItem(key, previous);
        throw error;
      }
    },
    setItem(key, value, context = {}) {
      assertWorkspaceKey(key);
      context.assertAuthority?.();
      const previous = sessionStorage?.getItem(key) ?? null;
      const candidate = {
        schema: RECOVERY_RECORD_SCHEMA,
        value: String(value),
        persistenceAuthority: context.persistenceAuthority || {},
      };
      const existing = recoveryRecord(previous);
      if (existing) assertReplicaCanPublish(existing, candidate);
      const serialized = JSON.stringify(candidate);
      sessionStorage?.setItem(key, serialized);
      try {
        context.assertCompletion?.();
      } catch (error) {
        if (sessionStorage?.getItem(key) === serialized) {
          if (previous === null) sessionStorage?.removeItem(key);
          else sessionStorage?.setItem(key, previous);
        }
        throw error;
      }
    },
    async read(scopeId) {
      const scope = normalizeWorkspaceScope(scopeId);
      const session = parse(sessionStorage?.getItem('pdp_session'));
      if (session?.persistenceEnvelope?.scopeId === scope) return structuredClone(session.persistenceEnvelope);
      if (!session || recordScope(session) !== scope) return null;
      return migrateLegacySession(session);
    },
    async write(envelope, context = {}) {
      context.assertAuthority?.();
      const previous = sessionStorage?.getItem('pdp_session') ?? null;
      const existing = parse(previous)?.persistenceEnvelope || null;
      const sessionSnapshot = context.recoverySnapshot
        ? sanitizeWorkspaceSnapshot(context.recoverySnapshot)
        : envelope.snapshot;
      const sessionEnvelope = sessionSnapshot === envelope.snapshot ? envelope : Object.freeze({
        ...envelope,
        digest: workspaceContentDigest(sessionSnapshot),
        snapshot: sessionSnapshot,
      });
      assertReplicaCanPublish(existing, sessionEnvelope);
      const serialized = JSON.stringify({
        ...sessionSnapshot,
        workspaceScope: { id: envelope.scopeId },
        workspaceRevision: envelope.metadata.revision,
        savedAt: envelope.savedAt,
        persistenceEnvelope: sessionEnvelope,
      });
      const writeBootstrap = context.writeBootstrap === true;
      const previousBootstrap = writeBootstrap
        ? sessionStorage?.getItem(LAST_WORK_BOOTSTRAP_KEY) ?? null
        : null;
      const bootstrapAuthority = writeBootstrap ? {
        scopeId: envelope.scopeId,
        leaseId: String(context.leaseId || envelope.metadata.leaseId || ''),
        fencingToken: Number(context.fencingToken || envelope.metadata.fencingToken) || 0,
        revision: Number(envelope.metadata.revision?.counter) || 0,
        operationId: String(envelope.metadata.operationId || ''),
        digest: String(envelope.digest || ''),
      } : null;
      const bootstrap = writeBootstrap ? {
        workspaceScope: { id: envelope.scopeId },
        workspaceRevision: envelope.metadata.revision,
        currentProjectId: String(envelope.snapshot?.currentProjectId || envelope.scopeId.replace(/^project:/i, '')),
        currentProjectName: String(envelope.snapshot?.currentProjectName || ''),
        currentProjectCreatedAt: envelope.snapshot?.currentProjectCreatedAt || null,
        step: String(envelope.snapshot?.step || 'upload'),
        savedAt: envelope.savedAt,
      } : null;
      const bootstrapCandidate = writeBootstrap ? {
        schema: RECOVERY_RECORD_SCHEMA,
        value: JSON.stringify(bootstrap),
        persistenceAuthority: bootstrapAuthority,
      } : null;
      if (bootstrapCandidate) {
        const existingBootstrap = recoveryRecord(previousBootstrap);
        if (existingBootstrap) assertReplicaCanPublish(existingBootstrap, bootstrapCandidate);
      }
      const serializedBootstrap = bootstrapCandidate ? JSON.stringify(bootstrapCandidate) : '';
      try {
        sessionStorage?.setItem('pdp_session', serialized);
        if (serializedBootstrap) sessionStorage?.setItem(LAST_WORK_BOOTSTRAP_KEY, serializedBootstrap);
        context.assertCompletion?.();
      } catch (error) {
        if (serializedBootstrap && sessionStorage?.getItem(LAST_WORK_BOOTSTRAP_KEY) === serializedBootstrap) {
          if (previousBootstrap === null) sessionStorage?.removeItem(LAST_WORK_BOOTSTRAP_KEY);
          else sessionStorage?.setItem(LAST_WORK_BOOTSTRAP_KEY, previousBootstrap);
        }
        if (sessionStorage?.getItem('pdp_session') === serialized) {
          if (previous === null) sessionStorage?.removeItem('pdp_session');
          else sessionStorage?.setItem('pdp_session', previous);
        }
        throw error;
      }
      return envelope;
    },
  });
}
