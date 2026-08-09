import {
  PERSISTENCE_ADAPTER_NAMES,
  RESTORE_SOURCE_PRECEDENCE,
  normalizeProjectScope,
  normalizeWorkspaceScope,
  validateWorkspaceSnapshotIdentity,
} from './persistence/contracts.mjs';
import { createPersistenceAuthorityRuntime } from './persistence/authority-runtime.mjs';
import { createPersistenceCommitEngine } from './persistence/commit-engine.mjs';
import { migrateWorkfilePayload, sanitizePersistenceEnvelope } from './persistence/migrations.mjs';
import { createPersistenceOperationCache } from './persistence/operation-cache.mjs';
import { sanitizeWorkspaceSnapshot } from './persistence/serialization.mjs';
import { comparePersistenceCandidates } from './persistence-envelope.mjs';

export function createWorkspacePersistence({ adapters, authority = null } = {}) {
  if (!adapters || typeof adapters !== 'object') {
    throw new TypeError('persistence adapters are required');
  }
  for (const name of PERSISTENCE_ADAPTER_NAMES) {
    if (!adapters[name]
      || typeof adapters[name].read !== 'function'
      || typeof adapters[name].write !== 'function') {
      throw new TypeError(`missing persistence adapter: ${name}`);
    }
  }

  const authorityRuntime = createPersistenceAuthorityRuntime(authority);
  const operationCache = createPersistenceOperationCache();
  const { commit } = createPersistenceCommitEngine({
    adapters,
    authorityRuntime,
    operationCache,
  });

  function restoreSources(sources = RESTORE_SOURCE_PRECEDENCE) {
    const selected = [...new Set(sources)];
    for (const source of selected) {
      if (!RESTORE_SOURCE_PRECEDENCE.includes(source)) {
        throw new Error(`unknown restore source: ${source}`);
      }
    }
    return selected;
  }

  function restoreCandidateMatchesAuthority(record, rawRecord, source) {
    if (!authorityRuntime.hasSnapshot()) return true;
    const current = authorityRuntime.snapshot();
    if (!current || current.scopeId !== record.scopeId) return false;
    if (source === 'server') return true;
    const rawEnvelope = rawRecord?.workspaceEnvelope
      || rawRecord?.persistenceEnvelope
      || rawRecord
      || {};
    const metadata = rawEnvelope.metadata || record.metadata || {};
    const candidateFence = Number(metadata.fencingToken ?? rawEnvelope.fencingToken) || 0;
    const currentFence = Number(current.fencingToken) || 0;
    if (candidateFence && currentFence && candidateFence !== currentFence) return false;
    const candidateLease = String(metadata.leaseId ?? rawEnvelope.leaseId ?? '');
    const currentLease = String(current.leaseId || '');
    if (current.scopeId.startsWith('project:') && currentFence > 0) {
      return candidateFence > 0
        && candidateFence === currentFence
        && candidateLease !== ''
        && currentLease !== ''
        && candidateLease === currentLease;
    }
    return !(candidateLease && currentLease && candidateLease !== currentLease);
  }

  async function restore({
    projectId,
    scopeId,
    explicitWorkfile = null,
    sources = RESTORE_SOURCE_PRECEDENCE,
  } = {}) {
    const scope = scopeId
      ? normalizeWorkspaceScope(scopeId)
      : normalizeProjectScope(projectId);
    if (explicitWorkfile) {
      const record = migrateWorkfilePayload(explicitWorkfile);
      if (record.scopeId !== scope) throw new Error('explicit workfile scope mismatch');
      const identityValidation = validateWorkspaceSnapshotIdentity(record.snapshot);
      if (!identityValidation.ok) {
        throw new Error(`explicit workfile identity mismatch: ${identityValidation.code}`);
      }
      return Object.freeze({
        source: 'workfile',
        snapshot: sanitizeWorkspaceSnapshot(record.snapshot),
      });
    }
    const candidates = [];
    for (const source of restoreSources(sources)) {
      try {
        const rawRecord = await adapters[source].read(scope);
        const record = rawRecord ? sanitizePersistenceEnvelope(rawRecord, source) : null;
        const identityValidation = record
          ? validateWorkspaceSnapshotIdentity(record.snapshot)
          : null;
        if (record
          && identityValidation?.ok
          && normalizeWorkspaceScope(record.scopeId) === scope
          && restoreCandidateMatchesAuthority(record, rawRecord, source)) {
          candidates.push({ source, record });
        }
      } catch (_) {}
    }
    candidates.sort(comparePersistenceCandidates);
    const selected = candidates[0] || null;
    if (!selected) return null;
    const revision = selected.record.metadata?.revision;
    if (revision) {
      authorityRuntime.observeRevision({
        revision: revision.counter,
        scopeId: selected.record.scopeId,
        fencingToken: revision.fencingToken ?? selected.record.metadata?.fencingToken,
        trusted: selected.source === 'server',
      });
    }
    return Object.freeze({
      source: selected.source,
      snapshot: sanitizeWorkspaceSnapshot(selected.record.snapshot),
      revision: revision ? Object.freeze({ ...revision }) : null,
    });
  }

  return Object.freeze({ commit, restore });
}
