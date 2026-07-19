import { STATE_PATH_OWNERSHIP, ownerForStatePath } from './state-ownership.mjs';

export const FACTORY_STORE_VERSION = 'factory-store:v1';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OWNER_PATHS = new Map(STATE_PATH_OWNERSHIP.map(entry => [entry.owner, entry.path]));

function cleanText(value) {
  return String(value ?? '').trim();
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return number;
}

function clonePlainData(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'string'
    || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('factory snapshot must contain plain data');
  if (seen.has(value)) throw new TypeError('factory snapshot must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    const copy = value.map(item => clonePlainData(item, seen));
    seen.delete(value);
    return copy;
  }
  if (!isPlainRecord(value)) throw new TypeError('factory snapshot must contain plain records');
  const copy = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new TypeError(`unsafe factory snapshot key: ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new TypeError(`factory snapshot key must be a data field: ${key}`);
    }
    copy[key] = clonePlainData(descriptor.value, seen);
  }
  seen.delete(value);
  return copy;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function immutableCopy(value) {
  return freezeTree(clonePlainData(value));
}

function plainDataEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && plainDataEqual(left[key], right[key]));
}

function readPath(state, statePath) {
  return statePath.split('.').reduce((current, segment) => current?.[segment], state);
}

function writePath(state, statePath, value) {
  const segments = statePath.split('.');
  let current = state;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainRecord(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function validateSnapshotRoots(snapshot) {
  if (!isPlainRecord(snapshot)) throw new TypeError('factory snapshot must be an object');
  for (const statePath of Object.keys(snapshot)) {
    if (!ownerForStatePath(statePath)) throw new Error(`unowned factory snapshot path: ${statePath}`);
  }
}

function ownerPath(owner) {
  const normalized = cleanText(owner);
  const path = OWNER_PATHS.get(normalized);
  if (!path) throw new Error(`unknown factory store owner: ${normalized || '<empty>'}`);
  return Object.freeze({ owner: normalized, path });
}

function commandPath(value, field) {
  const path = cleanText(value);
  const segments = path.split('.');
  if (!path || segments.some(segment => !segment || UNSAFE_KEYS.has(segment)
    || !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment))) {
    throw new TypeError(`${field} must be a safe state path`);
  }
  return path;
}

function normalizeCommandPolicies(value) {
  if (value === undefined) return new Map();
  if (!isPlainRecord(value)) throw new TypeError('factory command policies must be an object');
  const policies = new Map();
  for (const [rawName, rawPolicy] of Object.entries(value)) {
    const name = cleanText(rawName);
    if (!name || !isPlainRecord(rawPolicy)) throw new TypeError('factory command policy must be a named object');
    const keys = Object.keys(rawPolicy).sort();
    if (keys.length !== 3 || keys[0] !== 'coordinator' || keys[1] !== 'parts' || keys[2] !== 'targetPath') {
      throw new TypeError(`factory command policy ${name} requires exactly coordinator, parts, and targetPath`);
    }
    const coordinator = ownerPath(rawPolicy.coordinator).owner;
    const targetPath = commandPath(rawPolicy.targetPath, `factory command policy ${name} targetPath`);
    if (!ownerForStatePath(targetPath)) throw new Error(`unowned factory command target path: ${targetPath}`);
    if (!Array.isArray(rawPolicy.parts) || rawPolicy.parts.length === 0) {
      throw new TypeError(`factory command policy ${name} requires composition parts`);
    }
    const claims = [];
    const parts = rawPolicy.parts.map((rawPart, index) => {
      if (!isPlainRecord(rawPart)) throw new TypeError(`factory command policy ${name} part ${index} must be an object`);
      const partKeys = Object.keys(rawPart).sort();
      if (partKeys.length !== 2 || partKeys[0] !== 'owner' || partKeys[1] !== 'paths') {
        throw new TypeError(`factory command policy ${name} part ${index} requires exactly owner and paths`);
      }
      const owner = ownerPath(rawPart.owner).owner;
      if (!Array.isArray(rawPart.paths) || rawPart.paths.length === 0) {
        throw new TypeError(`factory command policy ${name} part ${index} requires paths`);
      }
      const paths = [...new Set(rawPart.paths.map((path, pathIndex) =>
        commandPath(path, `factory command policy ${name} part ${index} path ${pathIndex}`)
      ))].sort();
      for (const path of paths) {
        for (const claim of claims) {
          if (path === claim.path || path.startsWith(`${claim.path}.`) || claim.path.startsWith(`${path}.`)) {
            throw new Error(`overlapping factory command policy paths: ${name}:${claim.path}:${path}`);
          }
        }
        claims.push({ owner, path });
      }
      return Object.freeze({ owner, paths: Object.freeze(paths) });
    });
    policies.set(name, Object.freeze({
      name,
      coordinator,
      targetPath,
      parts: Object.freeze(parts),
    }));
  }
  return policies;
}

function collectChangedPaths(left, right, prefix = '', output = []) {
  if (plainDataEqual(left, right)) return output;
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    if (keys.size === 0 && prefix) output.push(prefix);
    for (const key of [...keys].sort()) {
      collectChangedPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output.push(prefix || '<root>');
  return output;
}

function validateCommandDiff(policy, before, after) {
  const changedPaths = collectChangedPaths(before, after);
  const assignments = [];
  for (const changedPath of changedPaths) {
    const matches = policy.parts.flatMap(part => part.paths
      .filter(path => changedPath === path || changedPath.startsWith(`${path}.`))
      .map(path => ({ owner: part.owner, path })));
    if (matches.length !== 1) {
      throw new Error(`FACTORY_COMMAND_PATH_REJECTED: ${policy.name}:${changedPath}`);
    }
    assignments.push(Object.freeze({ changedPath, owner: matches[0].owner, policyPath: matches[0].path }));
  }
  return Object.freeze(assignments);
}

function mutationMetadata(value) {
  if (!isPlainRecord(value)) throw new TypeError('mutation metadata must be an object');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'expectedRevision' || keys[1] !== 'owner') {
    throw new TypeError('mutation metadata requires exactly owner and expectedRevision');
  }
  const ownership = ownerPath(value.owner);
  const expectedRevision = nonNegativeInteger(value.expectedRevision, 'expectedRevision');
  return Object.freeze({ ...ownership, expectedRevision });
}

function createRevocableDraft(value) {
  const proxies = new WeakMap();
  const proxyTargets = new WeakMap();
  const revokes = [];
  const unwrap = candidate => proxyTargets.get(candidate) || candidate;
  const wrap = target => {
    if (!target || typeof target !== 'object') return target;
    if (proxies.has(target)) return proxies.get(target);
    const { proxy, revoke } = Proxy.revocable(target, {
      get(current, key, receiver) {
        return wrap(Reflect.get(current, key, receiver));
      },
      set(current, key, nextValue, receiver) {
        if (typeof key === 'string' && UNSAFE_KEYS.has(key)) {
          throw new TypeError(`unsafe factory draft key: ${key}`);
        }
        return Reflect.set(current, key, unwrap(nextValue), receiver);
      },
      deleteProperty(current, key) {
        if (typeof key === 'string' && UNSAFE_KEYS.has(key)) {
          throw new TypeError(`unsafe factory draft key: ${key}`);
        }
        return Reflect.deleteProperty(current, key);
      },
    });
    proxies.set(target, proxy);
    proxyTargets.set(proxy, target);
    revokes.push(revoke);
    return proxy;
  };
  return Object.freeze({
    draft: wrap(value),
    revoke() {
      while (revokes.length) revokes.pop()();
    },
  });
}

export function createFactoryStore(options = {}) {
  if (!isPlainRecord(options)) throw new TypeError('factory store options must be an object');
  const workspace = cleanText(options.workspaceId);
  if (!workspace) throw new TypeError('factory store workspaceId is required');
  const mutationGuard = options.assertMutable ?? (() => true);
  const errorReporter = options.reportError ?? null;
  const commandPolicies = normalizeCommandPolicies(options.commandPolicies);
  if (typeof mutationGuard !== 'function') throw new TypeError('assertMutable option must be a function');
  if (errorReporter !== null && typeof errorReporter !== 'function') throw new TypeError('reportError option must be a function');

  let snapshot = immutableCopy(options.initialSnapshot ?? {});
  validateSnapshotRoots(snapshot);
  let workspaceId = workspace;
  let revision = nonNegativeInteger(options.revision ?? 0, 'revision');
  let fence = 1;
  let disposed = false;
  let operationToken = makeOperationToken();
  const listeners = new Set();
  const activeOperationLeases = new Map();

  function makeOperationToken() {
    return Object.freeze({
      version: FACTORY_STORE_VERSION,
      workspaceId,
      revision,
      fence,
    });
  }

  function ensureActive() {
    if (disposed) throw new Error('factory store is disposed');
  }

  function operationLeaseKey(value) {
    const key = cleanText(value);
    if (!key) throw new TypeError('factory operation lease key is required');
    return key;
  }

  function staleOperationError(key) {
    const error = new Error(`STALE_FACTORY_STORE_OPERATION: ${key}`);
    error.code = 'STALE_FACTORY_STORE_OPERATION';
    return error;
  }

  function abortOperationLease(record) {
    if (!record || record.controller.signal.aborted) return false;
    record.controller.abort();
    return true;
  }

  function cancelAllOperationLeases() {
    for (const record of activeOperationLeases.values()) abortOperationLease(record);
    activeOperationLeases.clear();
  }

  function acquireOperationLease(value, expectedToken = operationToken) {
    ensureActive();
    const key = operationLeaseKey(value);
    if (expectedToken !== operationToken) throw staleOperationError(key);
    const existing = activeOperationLeases.get(key);
    if (existing) {
      return Object.freeze({
        acquired: false,
        operationKey: key,
        operationToken: existing.operationToken,
        signal: existing.controller.signal,
        release: () => false,
      });
    }
    const record = {
      controller: new AbortController(),
      operationToken: expectedToken,
    };
    activeOperationLeases.set(key, record);
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      if (activeOperationLeases.get(key) !== record) return false;
      activeOperationLeases.delete(key);
      return true;
    };
    return Object.freeze({
      acquired: true,
      operationKey: key,
      operationToken: expectedToken,
      signal: record.controller.signal,
      release,
    });
  }

  function cancelOperationLease(value, expectedToken = operationToken) {
    ensureActive();
    const key = operationLeaseKey(value);
    if (expectedToken !== operationToken) throw staleOperationError(key);
    const record = activeOperationLeases.get(key);
    if (!record) return false;
    activeOperationLeases.delete(key);
    abortOperationLease(record);
    return true;
  }

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

  function commit(nextSnapshot, kind, owner) {
    const previousRevision = revision;
    snapshot = immutableCopy(nextSnapshot);
    revision = previousRevision + 1;
    fence += 1;
    operationToken = makeOperationToken();
    const change = Object.freeze({
      kind,
      owner,
      workspaceId,
      previousRevision,
      revision,
      operationToken,
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

  function updateDraft(mutator, metadata, commandName = '') {
    ensureActive();
    if (typeof mutator !== 'function') throw new TypeError('factory store updateDraft requires a mutator');
    const normalizedCommandName = cleanText(commandName);
    const policy = normalizedCommandName ? commandPolicies.get(normalizedCommandName) : null;
    if (normalizedCommandName && !policy) throw new Error(`undeclared factory store command: ${normalizedCommandName}`);
    const authorization = policy
      ? authorizeCommandMutation(metadata, policy)
      : authorizeMutation(metadata);
    const ownership = authorization.mutation;
    const context = authorization.context ?? authorization.contexts[0];
    const authorizedOwners = authorization.owners ?? Object.freeze([ownership.owner]);
    const draftPath = policy?.targetPath || ownership.path;
    const startingToken = operationToken;
    const currentSlice = readPath(snapshot, draftPath);
    const mutableSlice = clonePlainData(currentSlice);
    const transaction = createRevocableDraft(mutableSlice);
    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      transaction.revoke();
    };
    const fail = error => {
      revoke();
      throw error;
    };
    const finish = result => {
      try {
        authorizedOwners.forEach(assertMutable);
        if (startingToken !== operationToken || ownership.expectedRevision !== revision) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${ownership.expectedRevision}, current ${revision}`);
        }
        const assignments = policy ? validateCommandDiff(policy, currentSlice, mutableSlice) : Object.freeze([]);
        const detachedResult = immutableCopy(result);
        const nextSnapshot = clonePlainData(snapshot);
        writePath(nextSnapshot, draftPath, mutableSlice);
        const committed = commit(nextSnapshot, 'update-draft', ownership.owner);
        return Object.freeze({ snapshot: committed, result: detachedResult, assignments });
      } finally {
        revoke();
      }
    };
    let result;
    try {
      result = mutator(transaction.draft, snapshot, context);
    } catch (error) {
      return fail(error);
    }
    return result && typeof result.then === 'function'
      ? Promise.resolve(result).then(finish, fail)
      : finish(result);
  }

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
    cancelAllOperationLeases();
    const previousWorkspaceId = workspaceId;
    workspaceId = normalized;
    revision = nonNegativeInteger(value.revision ?? 0, 'revision');
    snapshot = nextSnapshot;
    fence += 1;
    operationToken = makeOperationToken();
    notify(Object.freeze({
      kind: 'workspace-switch',
      previousWorkspaceId,
      workspaceId,
      revision,
      operationToken,
    }));
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
    cancelAllOperationLeases();
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
    acquireOperationLease,
    cancelOperationLease,
    switchWorkspace,
    subscribe,
    reportError,
    dispose,
  });
}
