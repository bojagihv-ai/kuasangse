import {
  CREDENTIAL_STORAGE_KEYS,
  PREFERENCE_STORAGE_KEYS,
  WORKSPACE_PERSISTENCE_SCHEMA,
  WORKSPACE_PERSISTENCE_VERSION,
  normalizeWorkspaceScope,
} from './contracts.mjs';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ENVELOPE_KEYS = new Set([
  'schema', 'version', 'scopeId', 'savedAt', 'updatedAt', 'exportedAt', 'origin',
  'metadata', 'persistence', 'workspaceRevision', 'fencingToken', 'operationId',
  'snapshot', 'payload', 'lightweight', 'assets', 'workspaceScope', 'workspaceId',
  'currentProjectId', 'id', 'project', 'format', 'app', 'manifest', 'summary',
  'digest', 'workspaceEnvelope', 'persistenceEnvelope', 'envelope', 'extensions', 'snapshotRef',
]);
const MAX_SANITIZE_DEPTH = 64;
const MAX_SANITIZE_NODES = 50000;

function normalizedKey(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizedKeySegments(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const DENY_STORAGE_KEYS = new Set([
  ...[...CREDENTIAL_STORAGE_KEYS].map(normalizedKey),
  ...[...PREFERENCE_STORAGE_KEYS].map(normalizedKey),
]);
const DENY_EXACT = new Set([
  'apikey', 'token', 'auth', 'authentication', 'authorization', 'oauth', 'credential', 'credentials',
  'cookie', 'cookiejar', 'session', 'lease', 'fence', 'fencing', 'writer', 'secret',
  'password', 'secrets', 'filehandle', 'directoryhandle', 'requestid', 'timer', 'timerid',
  'savetimer', 'operationid', 'workspacerevision', 'persistence', 'persistenceauthority',
  'persistencemetadata',
]);
const TRANSIENT_KEYS = new Set([
  'busy', 'loading', 'running', 'error', 'hydrating', 'pending', 'inflight',
]);
// The product schema has exactly one non-secret token-shaped business field.
const BUSINESS_SAFE_TOKEN_KEYS = new Set(['designtoken']);

export function isSensitivePersistenceKey(key) {
  const compact = normalizedKey(key);
  if (!compact) return false;
  const segments = normalizedKeySegments(key);
  const hasSegment = (...values) => segments.some(segment => values.includes(segment));
  if (DANGEROUS_KEYS.has(String(key).toLowerCase())) return true;
  if (DENY_STORAGE_KEYS.has(compact) || DENY_EXACT.has(compact) || TRANSIENT_KEYS.has(compact)) return true;
  if (!BUSINESS_SAFE_TOKEN_KEYS.has(compact)
      && (/(?:token|tokens)$/.test(compact) || hasSegment('token', 'tokens'))) return true;
  if (/(?:credential|credentials)$/.test(compact) || hasSegment('credential', 'credentials')) return true;
  if ((hasSegment('auth', 'authentication', 'authorization', 'oauth') && hasSegment('header', 'headers'))
      || /^(?:auth|authentication|authorization|oauth).*headers?$/.test(compact)) return true;
  if (hasSegment('cookie', 'cookies', 'secret', 'secrets', 'password', 'passwords')
      || /(?:cookies?|secrets?|passwords?)$/.test(compact)) return true;
  if ((hasSegment('api') && hasSegment('key', 'keys')) || /apikeys?$/.test(compact)) return true;
  if ((hasSegment('session', 'lease', 'writer') && hasSegment('id', 'ids'))
      || /(?:session|lease|writer)ids?$/.test(compact)) return true;
  if (/^oauth\d*(?:config|state|data|session|credentials?)?$/.test(compact)) return true;
  if (/^(?:auth|authentication|authorization)(?:header|token|config|state|data|session)?$/.test(compact)) return true;
  if (/^(?:session|lease|writer)(?:id|token|session|sessionid|state|data|store|container)?$/.test(compact)) return true;
  if (/^(?:fence|fencing)(?:id|token)?$/.test(compact)) return true;
  return false;
}

function sanitizeValue(value, state, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || depth > MAX_SANITIZE_DEPTH) return undefined;
  state.nodes += 1;
  if (state.nodes > MAX_SANITIZE_NODES || state.seen.has(value)) return undefined;
  state.seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .map(item => sanitizeValue(item, state, depth + 1))
      .filter(item => item !== undefined);
    state.seen.delete(value);
    return result;
  }
  const result = {};
  for (const childKey of Object.keys(value)) {
    if (isSensitivePersistenceKey(childKey)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, childKey);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
    const cleaned = sanitizeValue(descriptor.value, state, depth + 1);
    if (cleaned === undefined) continue;
    Object.defineProperty(result, childKey, {
      value: cleaned, enumerable: true, configurable: true, writable: true,
    });
  }
  state.seen.delete(value);
  return result;
}

export function sanitizePersistenceValue(value) {
  return sanitizeValue(value, { seen: new WeakSet(), nodes: 0 }, 0);
}

function text(value) {
  return String(value ?? '').trim();
}

function alreadyCurrent(value) {
  return value?.schema === WORKSPACE_PERSISTENCE_SCHEMA
    && Number(value?.version) === WORKSPACE_PERSISTENCE_VERSION
    && value?.scopeId
    && (value?.snapshot || value?.snapshotRef);
}

function scopeFrom(source, snapshot = source) {
  const raw = source?.scopeId
    || source?.workspaceScope?.id
    || source?.workspaceId
    || source?.currentProjectId
    || source?.id
    || source?.project?.id
    || snapshot?.workspaceScope?.id
    || snapshot?.workspaceId
    || snapshot?.currentProjectId;
  return normalizeWorkspaceScope(raw);
}

function deterministicSavedAt(source, snapshot) {
  return Number(
    source?.savedAt || source?.updatedAt || source?.exportedAt
    || source?.metadata?.revision?.updatedAt || source?.persistence?.revision?.updatedAt
    || snapshot?.savedAt || snapshot?.workspaceRevision?.updatedAt || 0
  ) || 0;
}

function ownDataEntries(value) {
  return Object.keys(value || {}).flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? [[key, descriptor.value]] : [];
  });
}

function safeExtensions(source) {
  const extensions = {};
  const declared = source?.extensions && typeof source.extensions === 'object'
    ? ownDataEntries(source.extensions)
    : [];
  for (const [key, value] of [...declared, ...ownDataEntries(source)]) {
    if (DANGEROUS_KEYS.has(key) || ENVELOPE_KEYS.has(key) || isSensitivePersistenceKey(key) || Object.hasOwn(extensions, key)) continue;
    const cleaned = sanitizePersistenceValue(value);
    if (cleaned === undefined) continue;
    Object.defineProperty(extensions, key, {
      value: cleaned, enumerable: true, configurable: true, writable: true,
    });
  }
  return extensions;
}

function trustedMetadata(source, scopeId, origin, savedAt) {
  const raw = source?.metadata && typeof source.metadata === 'object'
    ? source.metadata
    : (source?.persistence && typeof source.persistence === 'object' ? source.persistence : null);
  const revisionSource = raw?.revision && typeof raw.revision === 'object'
    ? raw.revision
    : (source?.workspaceRevision && typeof source.workspaceRevision === 'object' ? source.workspaceRevision : null);
  const revision = revisionSource ? {
    scopeId: text(revisionSource.scopeId) || scopeId,
    counter: Number(revisionSource.counter) || 0,
    updatedAt: Number(revisionSource.updatedAt) || 0,
    ...(Object.hasOwn(revisionSource, 'writerId') ? { writerId: text(revisionSource.writerId) } : {}),
  } : null;
  return {
    operationId: text(raw?.operationId || source?.operationId) || `legacy-${origin}-${scopeId}-${savedAt}`,
    revision,
    ...(raw && Object.hasOwn(raw, 'fencingToken')
      ? { fencingToken: text(raw.fencingToken) }
      : (Object.hasOwn(source || {}, 'fencingToken') ? { fencingToken: text(source.fencingToken) } : {})),
  };
}

function envelope(source, snapshot, origin) {
  const current = alreadyCurrent(source);
  const scopeId = scopeFrom(source, snapshot);
  const savedAt = deterministicSavedAt(source, snapshot);
  const extensions = safeExtensions(source);
  return {
    schema: WORKSPACE_PERSISTENCE_SCHEMA,
    version: WORKSPACE_PERSISTENCE_VERSION,
    scopeId,
    savedAt,
    ...(text(source?.digest) ? { digest: text(source.digest) } : {}),
    ...((text(source?.origin) || !current) ? { origin: text(source?.origin) || origin } : {}),
    metadata: trustedMetadata(source, scopeId, origin, savedAt),
    snapshot: sanitizePersistenceValue(snapshot) || {},
    ...((Object.keys(extensions).length || Object.hasOwn(source || {}, 'extensions')) ? { extensions } : {}),
  };
}

export function sanitizePersistenceEnvelope(value, origin = 'persistence') {
  const source = value && typeof value === 'object' ? value : {};
  return envelope(source, source.snapshot || source.payload || source, origin);
}

export function migrateLegacySession(value) {
  const source = value && typeof value === 'object' ? value : {};
  return envelope(source, source.snapshot || source.lightweight || source, 'session');
}

export function migrateIndexedDbV4Record(value) {
  const wrapped = alreadyCurrent(value?.workspaceEnvelope) ? value.workspaceEnvelope : value;
  const source = wrapped && typeof wrapped === 'object' ? wrapped : {};
  return envelope(source, source.payload || source.snapshot || source, 'indexeddb-v4');
}

export function migrateServerSnapshot(value) {
  const stored = value?.snapshot && typeof value.snapshot === 'object' ? value.snapshot : {};
  const nested = alreadyCurrent(stored.persistenceEnvelope) ? stored.persistenceEnvelope
    : (alreadyCurrent(value?.snapshot) ? value.snapshot : value);
  const source = nested && typeof nested === 'object' ? nested : {};
  const snapshotRef = text(source.snapshotRef);
  if (snapshotRef) {
    const referenced = snapshotRef === '$'
      ? Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'persistenceEnvelope'))
      : (snapshotRef === '$.lightweight' ? stored.lightweight : (snapshotRef === '$.assets' ? stored.assets : null));
    if (referenced && typeof referenced === 'object') return envelope(source, referenced, 'server-last-work');
  }
  const outerPayload = nested === stored.persistenceEnvelope
    ? (stored.assets && typeof stored.assets === 'object'
      ? stored.assets
      : (stored.lightweight && typeof stored.lightweight === 'object' ? stored.lightweight : null))
    : null;
  const serverSnapshot = outerPayload || (source.snapshot && source.snapshot.snapshot ? source.snapshot : (source.snapshot || source));
  return envelope(source, serverSnapshot.snapshot || serverSnapshot.assets || serverSnapshot, 'server-last-work');
}

export function migrateArchiveReference(value) {
  const wrapped = alreadyCurrent(value?.envelope) ? value.envelope : value;
  const source = wrapped && typeof wrapped === 'object' ? wrapped : {};
  return envelope(source, source.snapshot || source, 'local-archive');
}

export function migrateWorkfilePayload(value) {
  const source = value && typeof value === 'object' ? value : {};
  const snapshot = source.project?.payload || source.payload || source.snapshot || source;
  return envelope(source, snapshot, Number(source.version) === 1 ? 'workfile-v1' : 'workfile-raw');
}
