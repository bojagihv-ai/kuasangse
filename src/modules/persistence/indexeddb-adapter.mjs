import { migrateIndexedDbV4Record } from './migrations.mjs';
import { normalizeProjectScope, normalizeWorkspaceScope } from './contracts.mjs';
import { destinationVersion } from './fencing.mjs';
import { createBrowserIndexedDbDriver } from './indexeddb-driver.mjs';

export { createBrowserIndexedDbDriver };

const SHARED_GLOBAL_STORES = new Set(['appSettings']);

function projectIdFromScope(scopeId) {
  return normalizeProjectScope(scopeId).slice('project:'.length);
}

export function scopedSessionAssetId(projectId) {
  return `session-assets:${normalizeWorkspaceScope(projectId)}`;
}

export function sessionAssetRecordMatchesAuthority(record, authority, scopeId) {
  if (!record || typeof record !== 'object') return false;
  const scope = normalizeWorkspaceScope(scopeId);
  const recordScope = record.persistenceAuthority?.scopeId
    || record.scopeId
    || record.workspaceScope?.id
    || '';
  if (recordScope) {
    try {
      if (normalizeWorkspaceScope(recordScope) !== scope) return false;
    } catch (_) {
      return false;
    }
  }
  if (!authority || authority.scopeId !== scope) return true;
  const recordRevision = Number(record.persistenceAuthority?.revision) || 0;
  const authorityRevision = Number(authority.revision) || 0;
  return !(recordRevision && authorityRevision && recordRevision !== authorityRevision);
}

function workspaceEnvelopeId(scopeId) {
  return `workspace-envelope:${normalizeWorkspaceScope(scopeId)}`;
}

function isSharedGlobalStore(storeName) {
  return SHARED_GLOBAL_STORES.has(storeName);
}

function isDestinationTombstone(record) {
  return record?.persistenceDestination?.deleted === true;
}

function withDestinationVersion(record, expectedVersion, deleted = false) {
  return {
    ...record,
    persistenceDestination: Object.freeze({ version: expectedVersion + 1, deleted }),
  };
}

const COMMIT_RECORD_STORES = new Set(['appSettings', 'projects', 'snapshots']);

function commitRecords(context = {}) {
  const records = Array.isArray(context.records) ? context.records : [];
  return records.map(entry => {
    if (!COMMIT_RECORD_STORES.has(entry?.storeName)) {
      throw new Error(`unsupported authoritative commit store: ${entry?.storeName || ''}`);
    }
    if (!entry.value || typeof entry.value !== 'object' || !String(entry.value.id || '').trim()) {
      throw new Error('authoritative commit record requires an id');
    }
    return { storeName: entry.storeName, value: structuredClone(entry.value) };
  });
}

function commitSessionAssets(envelope, context = {}) {
  if (!context.sessionAssets || typeof context.sessionAssets !== 'object') return null;
  const scopeId = normalizeWorkspaceScope(envelope.scopeId);
  return {
    ...structuredClone(context.sessionAssets),
    id: scopedSessionAssetId(scopeId),
    scopeId,
    workspaceScope: { id: scopeId },
    workspaceRevision: structuredClone(envelope.metadata.revision),
    currentProjectId: scopeId.startsWith('project:') ? projectIdFromScope(scopeId) : '',
    persistenceAuthority: {
      scopeId,
      leaseId: String(envelope.metadata.leaseId || ''),
      fencingToken: Number(envelope.metadata.fencingToken) || 0,
      revision: Number(envelope.metadata.revision?.counter) || 0,
      operationId: String(envelope.metadata.operationId || ''),
      digest: String(envelope.digest || ''),
    },
  };
}

function legacyScope(record) {
  const raw = record?.scopeId
    || record?.workspaceScope?.id
    || record?.workspaceRevision?.scopeId
    || record?.currentProjectId;
  if (!raw) return '';
  try { return normalizeProjectScope(raw); } catch (_) { return ''; }
}

export function createIndexedDbPersistenceAdapter({ driver } = {}) {
  const recordDriver = driver || createBrowserIndexedDbDriver(typeof self === 'undefined' ? null : self);
  async function getSessionAssets(projectId) {
    return recordDriver.get('sessionAssets', scopedSessionAssetId(projectId));
  }

  async function putSessionAssets(projectId, payload, context = {}) {
    const scopeId = normalizeWorkspaceScope(projectId);
    const record = {
      ...structuredClone(payload || {}),
      id: scopedSessionAssetId(scopeId),
      scopeId,
      workspaceScope: { id: scopeId },
      currentProjectId: scopeId.startsWith('project:') ? projectIdFromScope(scopeId) : '',
      ...(context.persistenceAuthority ? { persistenceAuthority: context.persistenceAuthority } : {}),
    };
    context.assertAuthority?.();
    if (context.persistenceAuthority) {
      await recordDriver.compareAndPut('sessionAssets', record, {
        envelope: record, assertAuthority: context.assertAuthority,
      });
    } else {
      await recordDriver.put('sessionAssets', record);
    }
    context.assertCompletion?.();
    return record;
  }

  async function putRecord(storeName, value, context = {}) {
    context.assertAuthority?.();
    const sharedGlobal = isSharedGlobalStore(storeName);
    const current = sharedGlobal ? await recordDriver.get(storeName, value.id) : null;
    context.assertAuthority?.();
    const expectedDestinationVersion = sharedGlobal ? destinationVersion(current) : undefined;
    const unstamped = context.persistenceAuthority
      ? { ...structuredClone(value), persistenceAuthority: context.persistenceAuthority }
      : value;
    const record = sharedGlobal
      ? withDestinationVersion(unstamped, expectedDestinationVersion)
      : unstamped;
    if (context.persistenceAuthority) {
      await recordDriver.compareAndPut(storeName, record, {
        envelope: record,
        assertAuthority: context.assertAuthority,
        expectedDestinationVersion,
      });
    }
    else await recordDriver.put(storeName, record);
    context.assertCompletion?.();
    return record;
  }

  async function deleteRecord(storeName, key, context = {}) {
    context.assertAuthority?.();
    if (context.persistenceAuthority) {
      if (isSharedGlobalStore(storeName)) {
        const current = await recordDriver.get(storeName, key);
        context.assertAuthority?.();
        const expectedDestinationVersion = destinationVersion(current);
        const tombstone = withDestinationVersion({
          id: key, persistenceAuthority: context.persistenceAuthority,
        }, expectedDestinationVersion, true);
        await recordDriver.compareAndPut(storeName, tombstone, {
          envelope: tombstone,
          assertAuthority: context.assertAuthority,
          expectedDestinationVersion,
        });
      } else {
        await recordDriver.compareAndDelete(storeName, key, {
          envelope: { id: key, persistenceAuthority: context.persistenceAuthority },
          assertAuthority: context.assertAuthority,
        });
      }
    } else {
      await recordDriver.delete(storeName, key);
    }
    context.assertCompletion?.();
  }

  return Object.freeze({
    name: 'indexeddb',
    database: () => recordDriver.database?.(),
    delete: deleteRecord,
    async get(storeName, key) {
      const record = await recordDriver.get(storeName, key);
      return isSharedGlobalStore(storeName) && isDestinationTombstone(record) ? null : record;
    },
    async getAll(storeName) {
      const records = await recordDriver.getAll(storeName);
      return isSharedGlobalStore(storeName)
        ? records.filter(record => !isDestinationTombstone(record))
        : records;
    },
    getSessionAssets,
    async migrateLegacySessionAssets(projectId, context = {}) {
      const scopeId = normalizeWorkspaceScope(projectId);
      const existing = await getSessionAssets(scopeId);
      if (existing) return { migrated: false, reason: 'scoped-record-exists', record: existing };
      const legacy = await recordDriver.get('sessionAssets', 'current');
      if (!legacy || legacyScope(legacy) !== scopeId) return { migrated: false, reason: 'identity-mismatch' };
      const record = {
        ...structuredClone(legacy),
        id: scopedSessionAssetId(scopeId),
        scopeId,
        workspaceScope: { id: scopeId },
        currentProjectId: scopeId.startsWith('project:') ? projectIdFromScope(scopeId) : '',
        persistenceAuthority: context.persistenceAuthority,
      };
      context.assertAuthority?.();
      const result = await recordDriver.migrateLegacySessionAssets(
        scopeId, record, record, context.assertAuthority,
      );
      context.assertCompletion?.();
      return result;
    },
    put: putRecord,
    putSessionAssets,
    async read(scopeId) {
      const scope = normalizeWorkspaceScope(scopeId);
      const authoritative = await recordDriver.get('sessionAssets', workspaceEnvelopeId(scope));
      if (authoritative?.workspaceEnvelope) return migrateIndexedDbV4Record(authoritative);
      if (!scope.startsWith('project:')) return null;
      const record = await recordDriver.get('projects', projectIdFromScope(scope));
      return record ? migrateIndexedDbV4Record(record) : null;
    },
    async write(envelope, context = {}) {
      context.assertAuthority?.();
      const record = {
        id: workspaceEnvelopeId(envelope.scopeId),
        scopeId: normalizeWorkspaceScope(envelope.scopeId),
        workspaceEnvelope: structuredClone(envelope),
      };
      const sessionAssets = commitSessionAssets(envelope, context);
      const entries = [
        { storeName: 'sessionAssets', value: record },
        ...commitRecords(context),
        ...(sessionAssets ? [{ storeName: 'sessionAssets', value: sessionAssets }] : []),
      ];
      context.assertAuthority?.();
      await recordDriver.compareAndPutMany(entries, {
        storeName: 'sessionAssets', key: record.id, envelope,
        assertAuthority: context.assertAuthority,
      });
      context.assertCompletion?.();
      return envelope;
    },
  });
}

export { normalizeProjectScope, normalizeWorkspaceScope };
