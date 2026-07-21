import { createFactoryDraftUpdater } from './factory-store-draft.mjs';
import { createFactoryOperationLeases } from './factory-store-operation-leases.mjs';
import {
  cleanText,
  clonePlainData,
  immutableCopy,
  isPlainRecord,
  mutationMetadata,
  nonNegativeInteger,
  normalizeCommandPolicies,
  ownerForStatePath,
  ownerPath,
  plainDataEqual,
  readPath,
  validateSnapshotRoots,
  writePath,
} from './factory-store-data.mjs';

export const FACTORY_STORE_VERSION = 'factory-store:v1';

export function createFactoryStore(options = {}) {
  if (!isPlainRecord(options)) throw new TypeError('factory store options must be an object');
  const workspace = cleanText(options.workspaceId);
  if (!workspace) throw new TypeError('factory store workspaceId is required');
  const mutationGuard = options.assertMutable ?? (() => true);
  const errorReporter = options.reportError ?? null;
  const commandPolicies = normalizeCommandPolicies(options.commandPolicies);
  if (typeof mutationGuard !== 'function') throw new TypeError('assertMutable option must be a function');
  if (errorReporter !== null && typeof errorReporter !== 'function') {
    throw new TypeError('reportError option must be a function');
  }

  let snapshot = immutableCopy(options.initialSnapshot ?? {});
  validateSnapshotRoots(snapshot);
  let workspaceId = workspace;
  let revision = nonNegativeInteger(options.revision ?? 0, 'revision');
  let fence = 1;
  let disposed = false;
  let operationToken = makeOperationToken();
  const listeners = new Set();

  function makeOperationToken() {
    return Object.freeze({ version: FACTORY_STORE_VERSION, workspaceId, revision, fence });
  }

  function ensureActive() {
    if (disposed) throw new Error('factory store is disposed');
  }

  const operationLeases = createFactoryOperationLeases({
    ensureActive,
    readOperationToken: () => operationToken,
  });

  function assertMutable(owner) {
    ensureActive();
    const ownership = ownerPath(owner);
    const context = Object.freeze({
      owner: ownership.owner,
      path: ownership.path,
      workspaceId,
      revision,
      operationToken,
    });
    mutationGuard(context);
    return context;
  }

  function authorizeMutation(metadata) {
    const mutation = mutationMetadata(metadata);
    const context = assertMutable(mutation.owner);
    if (mutation.expectedRevision !== revision) {
      throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${mutation.expectedRevision}, current ${revision}`);
    }
    return Object.freeze({ mutation, context });
  }

  function authorizeCommandMutation(metadata, policy) {
    const mutation = mutationMetadata(metadata);
    if (mutation.owner !== policy.coordinator) {
      throw new Error(`factory command coordinator mismatch: ${policy.name}:${mutation.owner}`);
    }
    const owners = [...new Set([policy.coordinator, ...policy.parts.map(part => part.owner)])];
    const contexts = owners.map(assertMutable);
    if (mutation.expectedRevision !== revision) {
      throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${mutation.expectedRevision}, current ${revision}`);
    }
    return Object.freeze({ mutation, contexts: Object.freeze(contexts), owners: Object.freeze(owners) });
  }

  function notify(change) {
    for (const listener of [...listeners]) listener(snapshot, change);
  }

  function commit(nextSnapshot, kind, owner, commandName = '') {
    const previousRevision = revision;
    snapshot = immutableCopy(nextSnapshot);
    revision = previousRevision + 1;
    fence += 1;
    operationToken = makeOperationToken();
    const change = Object.freeze({
      kind, owner, commandName, workspaceId, previousRevision, revision, operationToken,
      activeOperationLeaseKeys: Object.freeze(operationLeases.keys()),
    });
    notify(change);
    return snapshot;
  }

  function update(reducer, metadata) {
    ensureActive();
    if (typeof reducer !== 'function') throw new TypeError('factory store update requires a reducer');
    const { mutation: ownership } = authorizeMutation(metadata);
    const currentSlice = readPath(snapshot, ownership.path);
    const nextSlice = reducer(currentSlice, snapshot);
    if (nextSlice === undefined) throw new TypeError('factory store reducer must return an owned slice');
    const nextSnapshot = clonePlainData(snapshot);
    writePath(nextSnapshot, ownership.path, clonePlainData(nextSlice));
    return commit(nextSnapshot, 'update', ownership.owner);
  }

  const updateDraft = createFactoryDraftUpdater({
    assertMutable,
    authorizeCommandMutation,
    authorizeMutation,
    commandPolicies,
    commit,
    ensureActive,
    getOperationToken: () => operationToken,
    getRevision: () => revision,
    getSnapshot: () => snapshot,
  });

  function replaceSnapshot(value, metadata) {
    ensureActive();
    const { mutation: ownership } = authorizeMutation(metadata);
    const candidate = clonePlainData(value);
    validateSnapshotRoots(candidate);
    const roots = new Set([...Object.keys(snapshot), ...Object.keys(candidate)]);
    for (const root of roots) {
      const rootOwner = ownerForStatePath(root);
      if (rootOwner !== ownership.owner && !plainDataEqual(snapshot[root], candidate[root])) {
        throw new Error(`peer owner replacement rejected: ${ownership.owner} cannot replace ${rootOwner}`);
      }
    }
    return commit(candidate, 'replace', ownership.owner);
  }

  function getOperationToken() {
    ensureActive();
    return operationToken;
  }

  function switchWorkspace(nextWorkspaceId, value = {}) {
    ensureActive();
    if (!isPlainRecord(value)) throw new TypeError('workspace switch options must be an object');
    const normalized = cleanText(nextWorkspaceId);
    if (!normalized) throw new TypeError('workspaceId is required');
    const nextSnapshot = immutableCopy(value.snapshot ?? snapshot);
    validateSnapshotRoots(nextSnapshot);
    operationLeases.cancelAll();
    const previousWorkspaceId = workspaceId;
    workspaceId = normalized;
    revision = nonNegativeInteger(value.revision ?? 0, 'revision');
    snapshot = nextSnapshot;
    fence += 1;
    operationToken = makeOperationToken();
    notify(Object.freeze({ kind: 'workspace-switch', previousWorkspaceId, workspaceId, revision, operationToken }));
    return snapshot;
  }

  function subscribe(listener) {
    ensureActive();
    if (typeof listener !== 'function') throw new TypeError('factory store listener must be a function');
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function reportError(error) {
    ensureActive();
    if (!(error instanceof Error)) throw new TypeError('factory store error must be an Error');
    if (errorReporter) errorReporter(error, Object.freeze({ workspaceId, revision }));
    return error;
  }

  function dispose() {
    if (disposed) return;
    operationLeases.cancelAll();
    disposed = true;
    listeners.clear();
    operationToken = null;
  }

  return Object.freeze({
    version: FACTORY_STORE_VERSION,
    getSnapshot: () => snapshot,
    replaceSnapshot,
    update,
    updateDraft,
    assertMutable,
    getOperationToken,
    isOperationCurrent: candidate => !disposed && candidate === operationToken,
    acquireOperationLease: operationLeases.acquire,
    cancelOperationLease: operationLeases.cancel,
    hasActiveOperationLease: operationLeases.has,
    switchWorkspace,
    subscribe,
    reportError,
    dispose,
  });
}
