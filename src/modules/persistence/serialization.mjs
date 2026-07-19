import {
  WORKSPACE_PERSISTENCE_SCHEMA,
  WORKSPACE_PERSISTENCE_VERSION,
  normalizeProjectScope,
} from './contracts.mjs';
import {
  migrateWorkfilePayload,
  sanitizePersistenceValue,
} from './migrations.mjs';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function externalMetadata(metadata = {}) {
  const revision = metadata.revision && typeof metadata.revision === 'object'
    ? {
      scopeId: String(metadata.revision.scopeId || '').trim(),
      counter: Number(metadata.revision.counter) || 0,
      updatedAt: Number(metadata.revision.updatedAt) || 0,
    }
    : null;
  return {
    operationId: String(metadata.operationId || '').trim(),
    revision,
  };
}

export function sanitizeWorkspaceSnapshot(snapshot) {
  return sanitizePersistenceValue(snapshot) || {};
}

export function workspaceContentDigest(snapshot) {
  const source = stable(sanitizeWorkspaceSnapshot(snapshot));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function serializeWorkspaceEnvelope(value) {
  const migrated = migrateWorkfilePayload(value);
  return JSON.stringify({
    ...migrated,
    metadata: externalMetadata(migrated.metadata),
    snapshot: sanitizeWorkspaceSnapshot(migrated.snapshot),
  });
}

export function serializeWorkspace({ projectId, snapshot, metadata = {}, savedAt = 0 } = {}) {
  const scopeId = normalizeProjectScope(projectId);
  return serializeWorkspaceEnvelope({
    schema: WORKSPACE_PERSISTENCE_SCHEMA,
    version: WORKSPACE_PERSISTENCE_VERSION,
    scopeId,
    savedAt: Number(savedAt) || 0,
    metadata: externalMetadata(metadata),
    snapshot: sanitizeWorkspaceSnapshot(snapshot || {}),
  });
}

export function deserializeWorkspace(text) {
  const parsed = typeof text === 'string' ? JSON.parse(text) : text;
  const migrated = migrateWorkfilePayload(parsed);
  return {
    ...migrated,
    metadata: sanitizePersistenceValue(migrated.metadata || {}) || {},
    snapshot: sanitizeWorkspaceSnapshot(migrated.snapshot || {}),
  };
}
