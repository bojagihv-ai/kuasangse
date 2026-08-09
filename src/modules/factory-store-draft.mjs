import {
  cleanText,
  clonePlainData,
  immutableCopy,
  isPlainRecord,
  isUnsafeStateKey,
  plainDataEqual,
  readPath,
  validateCommandDiff,
  writePath,
} from './factory-store-data.mjs';

const MISSING_DRAFT_FIELD = Symbol('missing-draft-field');

function mergeConcurrentDraftField(base, draft, current, hasBase, hasDraft, hasCurrent) {
  if (!hasDraft) {
    if (!hasBase) return hasCurrent ? clonePlainData(current) : MISSING_DRAFT_FIELD;
    if (!hasCurrent) return plainDataEqual(draft, base) ? MISSING_DRAFT_FIELD : MISSING_DRAFT_FIELD;
    return plainDataEqual(current, base) ? MISSING_DRAFT_FIELD : clonePlainData(current);
  }
  if (!hasCurrent) {
    if (!hasBase) return clonePlainData(draft);
    return plainDataEqual(draft, base) ? MISSING_DRAFT_FIELD : MISSING_DRAFT_FIELD;
  }
  if (hasBase && plainDataEqual(draft, base)) return clonePlainData(current);
  if (hasBase && plainDataEqual(current, base)) return clonePlainData(draft);
  if (!hasBase && plainDataEqual(draft, current)) return clonePlainData(draft);
  if (isPlainRecord(base) && isPlainRecord(draft) && isPlainRecord(current)) {
    const merged = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(draft), ...Object.keys(current)]);
    for (const key of keys) {
      const value = mergeConcurrentDraftField(
        base[key],
        draft[key],
        current[key],
        Object.prototype.hasOwnProperty.call(base, key),
        Object.prototype.hasOwnProperty.call(draft, key),
        Object.prototype.hasOwnProperty.call(current, key),
      );
      if (value !== MISSING_DRAFT_FIELD) merged[key] = value;
    }
    return merged;
  }
  // A direct user action that changed the same leaf wins over a late worker.
  return clonePlainData(current);
}

function mergeConcurrentDraftSlice(base, draft, current) {
  const value = mergeConcurrentDraftField(base, draft, current, true, true, true);
  return value === MISSING_DRAFT_FIELD ? {} : value;
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
        if (isUnsafeStateKey(key)) throw new TypeError(`unsafe factory draft key: ${key}`);
        return Reflect.set(current, key, unwrap(nextValue), receiver);
      },
      deleteProperty(current, key) {
        if (isUnsafeStateKey(key)) throw new TypeError(`unsafe factory draft key: ${key}`);
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

export function createFactoryDraftUpdater({
  assertMutable,
  authorizeCommandMutation,
  authorizeMutation,
  commandPolicies,
  commit,
  ensureActive,
  hasActiveOperationLease,
  getOperationToken,
  getRevision,
  getSnapshot,
}) {
  return function updateDraft(mutator, metadata, commandName = '', options = {}) {
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
    const startingToken = getOperationToken();
    const operationLeaseActiveAtStart = hasActiveOperationLease();
    const currentSlice = readPath(getSnapshot(), draftPath);
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
    const finish = (result, allowRebase) => {
      try {
        const currentToken = getOperationToken();
        const operationLeaseStarted = !operationLeaseActiveAtStart && hasActiveOperationLease();
        const staleRevision = startingToken !== currentToken || ownership.expectedRevision !== getRevision();
        const sameScope = startingToken?.workspaceId === currentToken?.workspaceId
          && startingToken?.fence === currentToken?.fence;
        const shouldRebase = (staleRevision || operationLeaseStarted)
          && allowRebase
          && options.rebaseOnStale === true
          && sameScope;
        if (operationLeaseStarted && !shouldRebase) {
          const error = new Error('STALE_FACTORY_STORE_OPERATION: operation lease started during draft transaction');
          error.code = 'STALE_FACTORY_STORE_OPERATION';
          throw error;
        }
        authorizedOwners.forEach(assertMutable);
        if (staleRevision && !shouldRebase) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${ownership.expectedRevision}, current ${getRevision()}`);
        }
        const latestSnapshot = shouldRebase ? getSnapshot() : null;
        const latestSlice = shouldRebase ? readPath(latestSnapshot, draftPath) : null;
        const committedSlice = shouldRebase
          ? mergeConcurrentDraftSlice(currentSlice, mutableSlice, latestSlice)
          : mutableSlice;
        const assignments = policy ? validateCommandDiff(policy, shouldRebase ? latestSlice : currentSlice, committedSlice) : Object.freeze([]);
        const detachedResult = immutableCopy(result);
        const nextSnapshot = clonePlainData(shouldRebase ? latestSnapshot : getSnapshot());
        writePath(nextSnapshot, draftPath, committedSlice);
        const committed = commit(nextSnapshot, 'update-draft', ownership.owner, normalizedCommandName);
        return Object.freeze({ snapshot: committed, result: detachedResult, assignments });
      } finally {
        revoke();
      }
    };
    let result;
    try {
      result = mutator(transaction.draft, getSnapshot(), context);
    } catch (error) {
      return fail(error);
    }
    const asynchronous = !!(result && typeof result.then === 'function');
    return asynchronous
      ? Promise.resolve(result).then(value => finish(value, true), fail)
      : finish(result, false);
  };
}
