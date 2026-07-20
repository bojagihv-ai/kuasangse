import {
  RESTORE_SOURCE_PRECEDENCE,
  WORKSPACE_PERSISTENCE_SCHEMA,
  WORKSPACE_PERSISTENCE_VERSION,
  normalizePersistenceMetadata,
  normalizeProjectScope,
  normalizeWorkspaceScope,
} from './persistence/contracts.mjs';
import { sanitizeWorkspaceSnapshot, workspaceContentDigest } from './persistence/serialization.mjs';

export function immutablePersistenceResult(value) {
  return Object.freeze({
    ...value,
    failures: Object.freeze((value.failures || []).map(failure => Object.freeze({ ...failure }))),
  });
}

export function createPersistenceFailure(adapter, error) {
  return { adapter, message: String(error?.message || error), error };
}

function candidateRevision(candidate) {
  const revision = candidate?.metadata?.revision || candidate?.workspaceRevision || {};
  return {
    counter: Number(revision.counter) || 0,
    updatedAt: Number(revision.updatedAt) || 0,
  };
}

export function comparePersistenceCandidates(left, right) {
  const a = candidateRevision(left.record);
  const b = candidateRevision(right.record);
  if (a.counter !== b.counter) return b.counter - a.counter;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  const saved = Number(right.record?.savedAt || 0) - Number(left.record?.savedAt || 0);
  if (saved) return saved;
  return RESTORE_SOURCE_PRECEDENCE.indexOf(left.source) - RESTORE_SOURCE_PRECEDENCE.indexOf(right.source);
}

export function createPersistenceEnvelope(command) {
  const scopeId = command.scopeId
    ? normalizeWorkspaceScope(command.scopeId)
    : normalizeProjectScope(command.projectId);
  const metadata = normalizePersistenceMetadata(command.metadata, scopeId);
  const snapshot = sanitizeWorkspaceSnapshot(command.snapshot || {});
  return Object.freeze({
    schema: WORKSPACE_PERSISTENCE_SCHEMA,
    version: WORKSPACE_PERSISTENCE_VERSION,
    scopeId,
    savedAt: Number(command.savedAt) || Date.now(),
    digest: workspaceContentDigest(snapshot),
    metadata,
    snapshot,
  });
}
