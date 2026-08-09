export class WorkspaceAuthorityError extends Error {
  constructor(code, message, snapshot = null) {
    super(message);
    this.name = 'WorkspaceAuthorityError';
    this.code = code;
    this.snapshot = snapshot;
  }
}

export class PersistenceReplicaError extends Error {
  constructor(code, message, current = null) {
    super(message);
    this.name = 'PersistenceReplicaError';
    this.code = code;
    this.current = current;
  }
}

function envelopeOf(value) {
  return value?.workspaceEnvelope || value?.persistenceEnvelope || value || {};
}

export function persistenceFence(value) {
  const envelope = envelopeOf(value);
  const authority = value?.persistenceAuthority || envelope?.persistenceAuthority || {};
  const metadata = envelope?.metadata || {};
  const revision = metadata.revision || authority.revision || envelope.workspaceRevision || {};
  return Object.freeze({
    scopeId: String(envelope.scopeId || value?.scopeId || authority.scopeId || revision.scopeId || ''),
    leaseId: String(metadata.leaseId || authority.leaseId || ''),
    fencingToken: Number(metadata.fencingToken ?? authority.fencingToken) || 0,
    revision: Number(revision.counter ?? revision) || 0,
    operationId: String(metadata.operationId || authority.operationId || ''),
    digest: String(envelope.digest || authority.digest || ''),
  });
}

export function destinationVersion(value) {
  const version = Number(value?.persistenceDestination?.version);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

export function assertDestinationVersion(existing, expectedVersion) {
  const currentVersion = destinationVersion(existing);
  if (currentVersion !== expectedVersion) {
    throw new PersistenceReplicaError(
      'STALE_REPLICA', 'replica destination changed before publish',
      Object.freeze({ version: currentVersion }),
    );
  }
  return currentVersion;
}

export function assertReplicaCanPublish(existing, candidate, options = {}) {
  if (!existing) return 'publish';
  const current = persistenceFence(existing);
  const next = persistenceFence(candidate);
  if (current.scopeId && next.scopeId && current.scopeId !== next.scopeId) return 'publish';
  if (current.fencingToken > next.fencingToken) {
    throw new PersistenceReplicaError('STALE_FENCE', 'replica already contains a higher fencing token', current);
  }
  if (current.fencingToken === next.fencingToken
    && current.leaseId && next.leaseId && current.leaseId !== next.leaseId) {
    throw new PersistenceReplicaError('STALE_FENCE', 'replica lease differs at the same fencing token', current);
  }
  if (current.fencingToken === next.fencingToken && current.revision > next.revision) {
    throw new PersistenceReplicaError('STALE_REVISION', 'replica already contains a newer revision', current);
  }
  if (current.fencingToken === next.fencingToken && current.revision === next.revision) {
    if (options.allowSameRevisionMutation === true) return 'publish';
    const sameOperation = current.operationId && current.operationId === next.operationId;
    const sameDigest = current.digest && current.digest === next.digest;
    if (sameOperation || sameDigest) return 'idempotent';
    if (current.operationId || current.digest) {
      throw new PersistenceReplicaError('STALE_REVISION', 'replica revision is already occupied', current);
    }
  }
  return 'publish';
}

export function authorityStamp(snapshot, scopeId = snapshot?.scopeId) {
  return Object.freeze({
    scopeId: String(scopeId || ''),
    leaseId: String(snapshot?.leaseId || ''),
    fencingToken: Number(snapshot?.fencingToken) || 0,
    revision: Number(snapshot?.revision) || 0,
  });
}

export function assertCurrentAuthority(authority, scopeId, claimed = null) {
  const current = authority?.snapshot?.() || null;
  if (scopeId.startsWith('draft:') && current?.mode === 'offline-edit' && current.scopeId === scopeId) {
    return current;
  }
  if (!current || current.scopeId !== scopeId) {
    throw new WorkspaceAuthorityError('STALE_SCOPE', 'workspace authority scope changed', current);
  }
  if (current.mode !== 'editing') {
    throw new WorkspaceAuthorityError('READ_ONLY', current.reason || 'workspace is read-only', current);
  }
  if (claimed && (String(current.leaseId || '') !== String(claimed.leaseId || '')
    || Number(current.fencingToken) !== Number(claimed.fencingToken))) {
    throw new WorkspaceAuthorityError('STALE_FENCE', 'workspace fencing token is stale', current);
  }
  return current;
}
