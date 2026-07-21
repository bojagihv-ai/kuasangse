import {
  cleanText,
  clonePlainData,
  immutableCopy,
  isUnsafeStateKey,
  readPath,
  validateCommandDiff,
  writePath,
} from './factory-store-data.mjs';

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
  getOperationToken,
  getRevision,
  getSnapshot,
}) {
  return function updateDraft(mutator, metadata, commandName = '') {
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
    const finish = result => {
      try {
        authorizedOwners.forEach(assertMutable);
        if (startingToken !== getOperationToken() || ownership.expectedRevision !== getRevision()) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${ownership.expectedRevision}, current ${getRevision()}`);
        }
        const assignments = policy ? validateCommandDiff(policy, currentSlice, mutableSlice) : Object.freeze([]);
        const detachedResult = immutableCopy(result);
        const nextSnapshot = clonePlainData(getSnapshot());
        writePath(nextSnapshot, draftPath, mutableSlice);
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
    return result && typeof result.then === 'function'
      ? Promise.resolve(result).then(finish, fail)
      : finish(result);
  };
}
