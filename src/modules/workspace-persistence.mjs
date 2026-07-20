import { createArchiveAdapter, fetchArchiveWithAuthority } from './persistence/archive-adapter.mjs';
import {
  createIndexedDbPersistenceAdapter,
  scopedSessionAssetId,
  sessionAssetRecordMatchesAuthority,
} from './persistence/indexeddb-adapter.mjs';
import { createServerLastWorkAdapter } from './persistence/server-last-work-adapter.mjs';
import { createSessionStorageAdapter } from './persistence/session-storage-adapter.mjs';
import { createWorkfileAdapter } from './persistence/workfile-adapter.mjs';
import {
  WORKSPACE_PERSISTENCE_SCHEMA,
  WORKSPACE_PERSISTENCE_VERSION,
  createPersistenceMetadata,
  normalizeProjectScope,
  normalizeWorkspaceScope,
} from './persistence/contracts.mjs';
import { WorkspaceAuthorityError } from './persistence/fencing.mjs';
import { migrateWorkfilePayload } from './persistence/migrations.mjs';
import { sanitizeWorkspaceSnapshot, workspaceContentDigest } from './persistence/serialization.mjs';
import { createGuardedWorkspaceMutations } from './workspace-mutations.mjs';
import { createWorkspacePersistence as createWorkspacePersistenceOrchestrator } from './workspace-persistence-orchestrator.mjs';

const PERSISTENCE_CAPABILITY_KEY = '__KUASANGSE_WORKSPACE_PERSISTENCE__';
const PERSISTENCE_CAPABILITY_MARKER = Symbol.for('kuasangse.workspace.persistence.capability');

export { WORKSPACE_PERSISTENCE_SCHEMA, WORKSPACE_PERSISTENCE_VERSION };
export { WorkspaceAuthorityError, createGuardedWorkspaceMutations };

export function createWorkspacePersistence({ adapters, authority = null } = {}) {
  return createWorkspacePersistenceOrchestrator({ adapters, authority });
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
