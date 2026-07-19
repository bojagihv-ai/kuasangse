import {
  AUTHORITATIVE_ADAPTER,
  PERSISTENCE_ADAPTER_NAMES,
  RESTORE_SOURCE_PRECEDENCE,
  WORKSPACE_PERSISTENCE_SCHEMA,
  WORKSPACE_PERSISTENCE_VERSION,
  createPersistenceMetadata,
  normalizePersistenceMetadata,
  normalizeProjectScope,
  normalizeWorkspaceScope,
} from './persistence/contracts.mjs';
import { createArchiveAdapter, fetchArchiveWithAuthority } from './persistence/archive-adapter.mjs';
import { WorkspaceAuthorityError } from './persistence/fencing.mjs';
import {
  createIndexedDbPersistenceAdapter,
  scopedSessionAssetId,
  sessionAssetRecordMatchesAuthority,
} from './persistence/indexeddb-adapter.mjs';
import {
  migrateWorkfilePayload,
  sanitizePersistenceEnvelope,
} from './persistence/migrations.mjs';
import { createServerLastWorkAdapter } from './persistence/server-last-work-adapter.mjs';
import { createSessionStorageAdapter } from './persistence/session-storage-adapter.mjs';
import { sanitizeWorkspaceSnapshot, workspaceContentDigest } from './persistence/serialization.mjs';
import { createWorkfileAdapter } from './persistence/workfile-adapter.mjs';
import { createGuardedWorkspaceMutations } from './workspace-mutations.mjs';

const PERSISTENCE_CAPABILITY_KEY = '__KUASANGSE_WORKSPACE_PERSISTENCE__';
const PERSISTENCE_CAPABILITY_MARKER = Symbol.for('kuasangse.workspace.persistence.capability');

export { WORKSPACE_PERSISTENCE_SCHEMA, WORKSPACE_PERSISTENCE_VERSION };
export { WorkspaceAuthorityError, createGuardedWorkspaceMutations };

function immutableResult(value) {
  return Object.freeze({
    ...value,
    failures: Object.freeze((value.failures || []).map(failure => Object.freeze({ ...failure }))),
  });
}

function failure(adapter, error) {
  return { adapter, message: String(error?.message || error), error };
}

function candidateRevision(candidate) {
  const revision = candidate?.metadata?.revision || candidate?.workspaceRevision || {};
  return {
    counter: Number(revision.counter) || 0,
    updatedAt: Number(revision.updatedAt) || 0,
  };
}

function compareCandidates(left, right) {
  const a = candidateRevision(left.record);
  const b = candidateRevision(right.record);
  if (a.counter !== b.counter) return b.counter - a.counter;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  const saved = Number(right.record?.savedAt || 0) - Number(left.record?.savedAt || 0);
  if (saved) return saved;
  return RESTORE_SOURCE_PRECEDENCE.indexOf(left.source) - RESTORE_SOURCE_PRECEDENCE.indexOf(right.source);
}

function buildEnvelope(command) {
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

export function createWorkspacePersistence({ adapters, authority = null } = {}) {
  if (!adapters || typeof adapters !== 'object') throw new TypeError('persistence adapters are required');
  for (const name of PERSISTENCE_ADAPTER_NAMES) {
    if (!adapters[name] || typeof adapters[name].read !== 'function' || typeof adapters[name].write !== 'function') {
      throw new TypeError(`missing persistence adapter: ${name}`);
    }
  }
  const operations = new Map();

  function commandWithCurrentRevision(command) {
    if (command.rebaseRevision !== true || !authority?.snapshot) return command;
    const current = authority.snapshot();
    const metadata = command.metadata || {};
    const claimed = command.authority || {};
    const scopeId = command.scopeId
      ? normalizeWorkspaceScope(command.scopeId)
      : normalizeProjectScope(command.projectId);
    const claimedFence = Number(metadata.fencingToken || claimed.fencingToken) || 0;
    const claimedLease = String(metadata.leaseId || claimed.leaseId || '');
    if (current?.mode !== 'editing' || current.scopeId !== scopeId
      || claimedFence !== Number(current.fencingToken)
      || claimedLease !== String(current.leaseId || '')) return command;
    return {
      ...command,
      metadata: {
        ...metadata,
        leaseId: current.leaseId,
        fencingToken: current.fencingToken,
        revision: {
          ...(metadata.revision || {}),
          scopeId,
          counter: (Number(current.revision) || 0) + 1,
          updatedAt: Math.max(Date.now(), Number(metadata.revision?.updatedAt) || 0),
        },
      },
    };
  }

  function authorityRejection(envelope, claimed = null) {
    if (!authority?.snapshot) return null;
    const current = authority.snapshot();
    if (envelope.scopeId.startsWith('draft:') && current?.mode === 'offline-edit'
      && current.scopeId === envelope.scopeId) return null;
    if (!current || current.scopeId !== envelope.scopeId) {
      return new WorkspaceAuthorityError('STALE_SCOPE', 'workspace authority scope changed', current);
    }
    if (current.mode !== 'editing') {
      return new WorkspaceAuthorityError('READ_ONLY', current.reason || 'workspace is read-only', current);
    }
    const claimedToken = Number(claimed?.fencingToken ?? envelope.metadata.fencingToken);
    const claimedLease = String(claimed?.leaseId || envelope.metadata.leaseId || '');
    if (!claimedToken || !claimedLease) {
      return new WorkspaceAuthorityError('PRECONDITION_REQUIRED', 'lease and fencing token are required', current);
    }
    if (claimedToken !== Number(current.fencingToken) || claimedLease !== String(current.leaseId || '')) {
      return new WorkspaceAuthorityError('STALE_FENCE', 'workspace fencing token is stale', current);
    }
    if (Number(envelope.metadata.revision.counter) !== (Number(current.revision) || 0) + 1) {
      return new WorkspaceAuthorityError('STALE_REVISION', 'workspace revision is stale', current);
    }
    return null;
  }

  function rejectedResult(envelope, error) {
    return immutableResult({
      accepted: false, authoritative: 'server+indexeddb', clean: false,
      partial: false, envelope, code: error.code,
      failures: [failure('authority', error)],
    });
  }

  function guardedContext(name, command, envelope) {
    const claimed = command.authority || null;
    const assertAuthority = () => {
      const rejection = authorityRejection(envelope, claimed);
      if (rejection) throw rejection;
      return authority?.snapshot?.() || claimed;
    };
    const current = authority?.snapshot?.() || claimed || {};
    return {
      ...(command.context?.[name] || {}),
      assertAuthority,
      assertCompletion: assertAuthority,
      currentAuthority: current,
      scopeId: envelope.scopeId,
      leaseId: current.leaseId || envelope.metadata.leaseId,
      fencingToken: current.fencingToken || envelope.metadata.fencingToken,
      expectedRevision: Number(current.revision) || 0,
    };
  }

  function requestedReplicas(replicas = []) {
    const requested = [...new Set(replicas)].filter(name => name !== AUTHORITATIVE_ADAPTER);
    for (const name of requested) {
      if (!PERSISTENCE_ADAPTER_NAMES.includes(name)) throw new Error(`unknown persistence replica: ${name}`);
    }
    return requested;
  }

  function restoreSources(sources = RESTORE_SOURCE_PRECEDENCE) {
    const selected = [...new Set(sources)];
    for (const source of selected) {
      if (!RESTORE_SOURCE_PRECEDENCE.includes(source)) throw new Error(`unknown restore source: ${source}`);
    }
    return selected;
  }

  async function commitUnlocked(command = {}) {
    command = commandWithCurrentRevision(command);
    const requested = requestedReplicas(command.replicas || []);
    const candidate = buildEnvelope(command);
    const initialRejection = authorityRejection(candidate, command.authority || null);
    if (initialRejection) return rejectedResult(candidate, initialRejection);
    const managedProject = !!authority?.snapshot && candidate.scopeId.startsWith('project:');
    if (managedProject && !requested.includes('server')) requested.unshift('server');
    let operation = operations.get(candidate.metadata.operationId);
    if (!operation) {
      operation = { envelope: candidate, required: new Set(requested), completed: new Set(), accepted: false, result: null };
      operations.set(candidate.metadata.operationId, operation);
    } else {
      if (candidate.scopeId !== operation.envelope.scopeId || candidate.digest !== operation.envelope.digest) {
        throw new Error('operationId cannot be reused for different workspace content');
      }
      if (operation.result?.clean) return operation.result;
    }
    const { envelope } = operation;
    const failures = [];
    if (managedProject && !operation.completed.has('server')) {
      try {
        const serverOutcome = await adapters.server.write(envelope, guardedContext('server', command, envelope));
        if (serverOutcome?.protectedNoOp === true) {
          operations.delete(envelope.metadata.operationId);
          return immutableResult({
            accepted: true,
            authoritative: 'server+indexeddb',
            clean: true,
            partial: false,
            protectedNoOp: true,
            acceptedRevision: Number(serverOutcome.acceptedRevision ?? serverOutcome.revision) || 0,
            envelope,
            failures: [],
          });
        }
        operation.completed.add('server');
      } catch (error) {
        return rejectedResult(envelope, error instanceof WorkspaceAuthorityError
          ? error
          : new WorkspaceAuthorityError(error?.code || 'SERVER_CAS_REJECTED', String(error?.message || error), error?.snapshot));
      }
    }
    if (!operation.accepted) {
      try {
        const rejection = authorityRejection(envelope, command.authority || null);
        if (rejection) throw rejection;
        await adapters[AUTHORITATIVE_ADAPTER].write(
          envelope,
          managedProject ? guardedContext(AUTHORITATIVE_ADAPTER, command, envelope) : command.context?.[AUTHORITATIVE_ADAPTER],
        );
        operation.accepted = true;
        operation.completed.add(AUTHORITATIVE_ADAPTER);
      } catch (error) {
        if (!managedProject) operations.delete(envelope.metadata.operationId);
        return immutableResult({
          accepted: false, authoritative: managedProject ? 'server+indexeddb' : AUTHORITATIVE_ADAPTER, clean: false,
          partial: managedProject && operation.completed.has('server'), envelope,
          code: error?.code || 'AUTHORITATIVE_WRITE_FAILED', failures: [failure(AUTHORITATIVE_ADAPTER, error)],
        });
      }
    }
    for (const name of operation.required) {
      if (operation.completed.has(name)) continue;
      try {
        const rejection = authorityRejection(envelope, command.authority || null);
        if (rejection) throw rejection;
        await adapters[name].write(
          envelope,
          managedProject ? guardedContext(name, command, envelope) : command.context?.[name],
        );
        operation.completed.add(name);
      } catch (error) {
        failures.push(failure(name, error));
      }
    }
    const completionRejection = authorityRejection(envelope, command.authority || null);
    if (completionRejection) failures.push(failure('authority', completionRejection));
    const current = !completionRejection
      && (typeof command.isCurrent !== 'function' || command.isCurrent(envelope.digest) !== false);
    const pending = [...operation.required].filter(name => !operation.completed.has(name));
    const result = immutableResult({
      accepted: true,
      authoritative: managedProject ? 'server+indexeddb' : AUTHORITATIVE_ADAPTER,
      clean: current && pending.length === 0,
      partial: pending.length > 0,
      envelope,
      failures,
    });
    if (result.clean && managedProject) {
      authority.observeRevision?.(envelope.metadata.revision.counter, envelope.metadata.fencingToken);
    }
    operation.result = result;
    return result;
  }

  function commit(command = {}) {
    return authority?.runMutation
      ? authority.runMutation(() => commitUnlocked(command))
      : commitUnlocked(command);
  }

  async function restore({ projectId, scopeId, explicitWorkfile = null, sources = RESTORE_SOURCE_PRECEDENCE } = {}) {
    const scope = scopeId ? normalizeWorkspaceScope(scopeId) : normalizeProjectScope(projectId);
    if (explicitWorkfile) {
      const record = migrateWorkfilePayload(explicitWorkfile);
      if (record.scopeId !== scope) throw new Error('explicit workfile scope mismatch');
      return Object.freeze({ source: 'workfile', snapshot: sanitizeWorkspaceSnapshot(record.snapshot) });
    }
    const candidates = [];
    const selectedSources = restoreSources(sources);
    for (const source of selectedSources) {
      try {
        const rawRecord = await adapters[source].read(scope);
        const record = rawRecord ? sanitizePersistenceEnvelope(rawRecord, source) : null;
        if (record && normalizeWorkspaceScope(record.scopeId) === scope) candidates.push({ source, record });
      } catch (_) {}
    }
    candidates.sort(compareCandidates);
    const selected = candidates[0] || null;
    return selected
      ? Object.freeze({
        source: selected.source,
        snapshot: sanitizeWorkspaceSnapshot(selected.record.snapshot),
        revision: selected.record.metadata?.revision
          ? Object.freeze({ ...selected.record.metadata.revision })
          : null,
      })
      : null;
  }

  return Object.freeze({ commit, restore });
}

export function createBrowserWorkspacePersistence(root) {
  const authority = root.__KUASANGSE_WORKSPACE_LOCK__ || null;
  const adapters = Object.freeze({
    session: createSessionStorageAdapter({ storage: root.localStorage, authority }),
    indexeddb: createIndexedDbPersistenceAdapter(),
    server: createServerLastWorkAdapter({ root }),
    workfile: createWorkfileAdapter({ root }),
    archive: createArchiveAdapter({ root }),
  });
  const orchestrator = createWorkspacePersistence({ adapters, authority });
  const guardedMutations = createGuardedWorkspaceMutations({ adapters, authority });

  const fetchArchiveResource = (url, options = {}) => fetchArchiveWithAuthority({
    adapter: adapters.archive,
    authority,
    url,
    options,
    createAuthorityError: (code, message, snapshot) => new WorkspaceAuthorityError(code, message, snapshot),
  });

  const capability = {
    ...orchestrator,
    createMetadata: createPersistenceMetadata,
    migrateWorkfilePayload: value => {
      const record = migrateWorkfilePayload(value);
      return Object.freeze({
        ...record,
        metadata: sanitizeWorkspaceSnapshot(record.metadata),
        snapshot: sanitizeWorkspaceSnapshot(record.snapshot),
      });
    },
    normalizeProjectScope,
    normalizeWorkspaceScope,
    contentDigest: workspaceContentDigest,
    sessionAssetId: scopedSessionAssetId,
    readRecoveryValue: key => adapters.session.getItem(key),
    fetchArchiveResource,
    ...guardedMutations,
    chooseProjectFileForSave: options => adapters.workfile.selectSaveHandle(options),
    chooseProjectFileForOpen: options => adapters.workfile.selectOpenHandle(options),
    readProjectFile: handle => adapters.workfile.readHandle(handle),
    loadPreference: id => adapters.indexeddb.get('appSettings', id),
    listProjects: () => adapters.indexeddb.getAll('projects'),
    loadProject: id => adapters.indexeddb.get('projects', id),
    listSnapshots: () => adapters.indexeddb.getAll('snapshots'),
    loadSnapshot: id => adapters.indexeddb.get('snapshots', id),
    async loadSessionAssets(scopeId) {
      let record = await adapters.indexeddb.getSessionAssets(scopeId);
      if (!record && normalizeWorkspaceScope(scopeId).startsWith('project:')) {
        await guardedMutations.migrateLegacySessionAssets(scopeId);
        record = await adapters.indexeddb.getSessionAssets(scopeId);
      }
      const current = authority?.snapshot?.();
      return sessionAssetRecordMatchesAuthority(record, current, scopeId) ? record : null;
    },
  };
  Object.defineProperty(capability, PERSISTENCE_CAPABILITY_MARKER, {
    value: true,
    enumerable: false,
  });
  return Object.freeze(capability);
}

export function installWorkspacePersistence(root = globalThis) {
  const existing = Object.getOwnPropertyDescriptor(root, PERSISTENCE_CAPABILITY_KEY);
  if (existing) {
    const value = existing.value;
    if (!value || value[PERSISTENCE_CAPABILITY_MARKER] !== true || !Object.isFrozen(value)) {
      throw new TypeError('conflicting workspace persistence capability already exists');
    }
    if (existing.configurable) {
      Object.defineProperty(root, PERSISTENCE_CAPABILITY_KEY, {
        value,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    } else if (existing.writable !== false || existing.enumerable !== false) {
      throw new TypeError('workspace persistence capability descriptor is mutable');
    }
    return value;
  }
  const capability = createBrowserWorkspacePersistence(root);
  Object.defineProperty(root, PERSISTENCE_CAPABILITY_KEY, {
    value: capability,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return capability;
}

if (typeof self !== 'undefined' && self.document) installWorkspacePersistence(self);
