'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

async function importFresh(relativePath, tag) {
  const url = pathToFileURL(path.join(ROOT, ...relativePath.split('/')));
  return import(`${url.href}?${tag}=${Date.now()}-${Math.random()}`);
}

function frozenSnapshot(count = 1) {
  return Object.freeze({
    factory: Object.freeze({ nested: Object.freeze({ count }) }),
    productDb: Object.freeze({ rows: Object.freeze([]) }),
    competitors: Object.freeze({}),
    factoryAssets: Object.freeze({}),
    detailDocument: Object.freeze({}),
    cafe24: Object.freeze({}),
  });
}

function tabDefinition(overrides = {}) {
  return {
    version: 'factory-tab:v1',
    id: 'factory/start',
    owner: 'factory',
    capabilities: ['factory:read', 'factory:write'],
    commands: {
      inspect: { capability: 'factory:read', execute: value => value },
      save: { capability: 'factory:write', execute: value => value },
    },
    select: snapshot => snapshot,
    render: () => '<section></section>',
    bind: () => () => {},
    onEnter: () => {},
    onLeave: () => {},
    persistence: { reads: ['factory'], writes: ['factory'] },
    ...overrides,
  };
}

function runtimeCapabilities(overrides = {}) {
  const snapshot = frozenSnapshot();
  const token = Object.freeze({ workspaceId: 'workspace-a', revision: 1, fence: 1 });
  return {
    getSnapshot: () => snapshot,
    assertMutable: () => true,
    getOperationToken: () => token,
    isOperationCurrent: candidate => candidate === token,
    reportError: error => error,
    actions: Object.freeze({ save: value => value }),
    renderHelpers: Object.freeze({ escapeHtml: value => String(value) }),
    ...overrides,
  };
}

test('factory tab contract exports the locked version and creates a frozen definition-only contract', async () => {
  // Given: the composition shell has a complete factory-tab definition but no runtime binding.
  const module = await importFresh('src/menus/factory/factory-tab-contract.mjs', 'definition');

  // When: the shell validates the definition-only spy contract.
  const contract = module.createFactoryTabContract(tabDefinition());

  // Then: the locked public version and immutable contract shape are exposed.
  assert.equal(module.FACTORY_TAB_CONTRACT_VERSION, 'factory-tab:v1');
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.capabilities), true);
  assert.equal(Object.getPrototypeOf(contract.commands), null);
  assert.equal(Object.isFrozen(contract.commands.save), true);
  assert.equal(Object.isFrozen(contract.persistence), true);
  assert.equal(contract.invoke('inspect', 'ok'), 'ok');
});

test('factory tab contract validates the seven runtime capabilities as exact own fields', async () => {
  // Given: an exact runtime capability record and hostile legacy variants.
  const { createFactoryTabContract } = await importFresh(
    'src/menus/factory/factory-tab-contract.mjs', 'capabilities',
  );
  const exact = runtimeCapabilities();
  const inherited = Object.create(exact);
  const missing = runtimeCapabilities();
  delete missing.reportError;
  const legacy = { ...runtimeCapabilities(), state: { mutable: true } };
  let getterReads = 0;
  const accessor = runtimeCapabilities();
  Object.defineProperty(accessor, 'getOperationToken', {
    enumerable: true,
    get() {
      getterReads += 1;
      return () => 'live-shortcut';
    },
  });

  // When/Then: exact own capabilities pass; inherited, missing, and shortcut state fail immediately.
  assert.doesNotThrow(() => createFactoryTabContract(tabDefinition(), exact));
  assert.throws(() => createFactoryTabContract(tabDefinition(), inherited), /own|capabilit/i);
  assert.throws(() => createFactoryTabContract(tabDefinition(), missing), /reportError/);
  assert.throws(() => createFactoryTabContract(tabDefinition(), legacy), /state|unexpected|capabilit/i);
  assert.throws(() => createFactoryTabContract(tabDefinition(), accessor), /data|accessor|own/i);
  assert.equal(getterReads, 0);
});

test('factory tab contract refuses mutable selected state and makes bind cleanup idempotent', async () => {
  // Given: one tab that leaks mutable selected data and one tab with a counted disposer.
  const { createFactoryTabContract } = await importFresh(
    'src/menus/factory/factory-tab-contract.mjs', 'immutable-select',
  );
  let cleanupCount = 0;
  let getterReads = 0;
  const accessorSnapshot = {};
  Object.defineProperty(accessorSnapshot, 'state', {
    enumerable: true,
    get() {
      getterReads += 1;
      return Object.freeze({});
    },
  });
  Object.freeze(accessorSnapshot);
  const mutable = createFactoryTabContract(tabDefinition({ select: () => ({ nested: {} }) }));
  const accessor = createFactoryTabContract(tabDefinition({ select: () => accessorSnapshot }));
  const lifecycle = createFactoryTabContract(tabDefinition({
    select: () => frozenSnapshot(),
    bind: () => () => { cleanupCount += 1; },
  }));

  // When: selection and repeated cleanup are exercised.
  const dispose = lifecycle.bind({});
  dispose();
  dispose();

  // Then: mutable state is not exposed and the underlying cleanup runs once.
  assert.throws(() => mutable.select(), /immutable|frozen/i);
  assert.throws(() => accessor.select(), /immutable|frozen/i);
  assert.equal(getterReads, 0);
  assert.equal(cleanupCount, 1);
  assert.throws(() => lifecycle.invoke('toString'), /undeclared command/);
});

test('factory tab contract fences async write commands and rethrows reported failures', async () => {
  // Given: a pending write command and a runtime operation token that can become stale.
  const { createFactoryTabContract } = await importFresh(
    'src/menus/factory/factory-tab-contract.mjs', 'stale-command',
  );
  let resolve;
  let current = Object.freeze({ workspaceId: 'workspace-a', revision: 1, fence: 1 });
  let mutableChecks = 0;
  const reported = [];
  const runtime = runtimeCapabilities({
    assertMutable: () => { mutableChecks += 1; },
    getOperationToken: () => current,
    isOperationCurrent: candidate => candidate === current,
    reportError: error => { reported.push(error); },
  });
  const contract = createFactoryTabContract(tabDefinition({
    commands: {
      save: {
        capability: 'factory:write',
        execute: () => new Promise(done => { resolve = done; }),
      },
    },
  }), runtime);

  // When: the workspace token changes before the async result completes.
  const pending = contract.invoke('save');
  current = Object.freeze({ workspaceId: 'workspace-b', revision: 0, fence: 2 });
  resolve('foreign-result');

  // Then: authority was checked first, stale completion is reported, and the same failure escapes.
  await assert.rejects(pending, /STALE/i);
  assert.equal(mutableChecks, 1);
  assert.equal(reported.length, 1);
  assert.match(reported[0].message, /STALE/i);
});

test('factory store freezes nested snapshots and owner updates advance revision without rotating operation identity', async () => {
  // Given: an editable workspace at revision 3 with nested factory state.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'update');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(1),
    workspaceId: 'workspace-a',
    revision: 3,
  });
  const before = store.getSnapshot();
  const beforeToken = store.getOperationToken();

  // When: the owning reducer returns the next factory slice.
  const after = store.update(
    slice => ({ ...slice, nested: { count: slice.nested.count + 1 } }),
    { owner: 'factory', expectedRevision: 3 },
  );

  // Then: no mutation escape remains, storage revision advances, and the workspace operation remains current.
  assert.equal(Object.isFrozen(store), true);
  assert.equal(Object.isFrozen(after), true);
  assert.equal(Object.isFrozen(after.factory.nested), true);
  assert.notStrictEqual(after, before);
  assert.equal(after.factory.nested.count, 2);
  assert.equal(before.factory.nested.count, 1);
  assert.throws(() => { after.factory.nested.count = 99; }, TypeError);
  assert.equal(store.isOperationCurrent(beforeToken), true);
  assert.equal(store.getOperationToken().revision, 4);
  assert.equal('actions' in store, false);
  assert.equal('renderHelpers' in store, false);
});

test('factory store rejects stale revisions, unknown owners, and cross-owner replacement', async () => {
  // Given: a current factory snapshot at revision 1.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'ownership');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-a',
    revision: 1,
  });
  const before = store.getSnapshot();
  const foreign = {
    ...before,
    factory: { nested: { count: 2 } },
    productDb: { rows: ['foreign'] },
  };

  // When/Then: CAS, ownership, and peer-slice boundaries all fail before state changes.
  assert.throws(
    () => store.update(slice => slice, { owner: 'factory', expectedRevision: 0 }),
    /revision|stale/i,
  );
  assert.throws(
    () => store.update(slice => slice, { owner: 'unknown-owner', expectedRevision: 1 }),
    /owner/i,
  );
  assert.throws(
    () => store.replaceSnapshot(foreign, { owner: 'factory', expectedRevision: 1 }),
    /peer|owner/i,
  );
  assert.strictEqual(store.getSnapshot(), before);
  assert.equal(store.getOperationToken().revision, 1);
});

test('factory store replacement and workspace switches invalidate prior operation tokens', async () => {
  // Given: a token from workspace A revision 0.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'workspace');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-a',
  });
  const workspaceAToken = store.getOperationToken();

  // When: an owned replacement advances revision and a workspace switch installs revision 7.
  const replacement = { ...store.getSnapshot(), factory: { nested: { count: 5 } } };
  store.replaceSnapshot(replacement, { owner: 'factory', expectedRevision: 0 });
  const replacedToken = store.getOperationToken();
  store.switchWorkspace('workspace-b', { snapshot: frozenSnapshot(9), revision: 7 });

  // Then: both older generations are stale and the new workspace token is current.
  const current = store.getOperationToken();
  assert.equal(store.isOperationCurrent(workspaceAToken), false);
  assert.equal(store.isOperationCurrent(replacedToken), false);
  assert.equal(store.isOperationCurrent(current), true);
  assert.equal(current.workspaceId, 'workspace-b');
  assert.equal(current.revision, 7);
  assert.equal(store.getSnapshot().factory.nested.count, 9);
});

test('factory store mutation guard, subscriptions, and repeated disposal are deterministic', async () => {
  // Given: one read-only store and one store with a subscriber.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'lifecycle');
  const readOnly = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-read-only',
    assertMutable: () => { throw new Error('READ_ONLY'); },
  });
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-a',
  });
  const changes = [];
  const unsubscribe = store.subscribe((snapshot, change) => changes.push({ snapshot, change }));

  // When: authority blocks one update, the live subscriber sees one update, then cleanup repeats.
  assert.throws(
    () => readOnly.update(slice => slice, { owner: 'factory', expectedRevision: 0 }),
    /READ_ONLY/,
  );
  store.update(slice => ({ ...slice, nested: { count: 2 } }), {
    owner: 'factory', expectedRevision: 0,
  });
  unsubscribe();
  unsubscribe();
  store.dispose();
  store.dispose();

  // Then: exactly one immutable event escaped and disposed mutation/token issuance is rejected.
  assert.equal(changes.length, 1);
  assert.equal(Object.isFrozen(changes[0].snapshot), true);
  assert.equal(Object.isFrozen(changes[0].change), true);
  assert.throws(() => store.getOperationToken(), /disposed/i);
  assert.equal(store.isOperationCurrent(changes[0].change.operationToken), false);
  assert.throws(
    () => store.update(slice => slice, { owner: 'factory', expectedRevision: 1 }),
    /disposed/i,
  );
});

test('factory store reports errors only through the injected reporter and preserves the error', async () => {
  // Given: an injected local reporter and an unrelated global sentinel.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'errors');
  const reported = [];
  const sentinel = Symbol('untouched');
  globalThis.__task7FactoryError = sentinel;
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-a',
    reportError: error => { reported.push(error); },
  });
  const failure = new Error('factory failure');

  // When: the store reports a domain failure.
  const returned = store.reportError(failure);

  // Then: the exact error reaches the consumer and no global channel is written.
  assert.strictEqual(returned, failure);
  assert.deepEqual(reported, [failure]);
  assert.strictEqual(globalThis.__task7FactoryError, sentinel);
  delete globalThis.__task7FactoryError;
});

test('factory store keeps ordinary commits in the same async operation fence while revision CAS still advances', async () => {
  // Given: an active workspace operation token and a revision-scoped lease.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'operation-identity');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-operation-identity',
    revision: 3,
  });
  const initialToken = store.getOperationToken();
  const initialRevision = initialToken.revision;
  const lease = store.acquireOperationLease('factory/operation-identity', initialToken);

  // When: an ordinary owned commit advances the store revision, then the old operation cancels its lease.
  store.update(
    slice => ({ ...slice, nested: { count: slice.nested.count + 1 } }),
    { owner: 'factory', expectedRevision: initialRevision },
  );
  const afterCommitToken = store.getOperationToken();
  const cancelled = store.cancelOperationLease('factory/operation-identity', initialToken);

  // Then: the workspace/fence operation remains current, the revision advances, and old CAS writes stay rejected.
  assert.equal(store.isOperationCurrent(initialToken), true);
  assert.equal(store.isOperationCurrent(afterCommitToken), true);
  assert.equal(afterCommitToken.revision, initialRevision + 1);
  assert.equal(cancelled, true);
  assert.equal(lease.signal.aborted, true);
  assert.throws(
    () => store.update(slice => slice, { owner: 'factory', expectedRevision: initialRevision }),
    /STALE_FACTORY_STORE_REVISION/,
  );
});

test('factory store rejects forged token clones from operation authority and lease controls', async () => {
  // Given: one genuine token and plain spread clones with identical visible fields.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'operation-token-forgery');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-operation-token-forgery',
  });
  const genuineToken = store.getOperationToken();
  const forgedToken = { ...genuineToken };
  const frozenForgedToken = Object.freeze({ ...genuineToken });

  // When/Then: only an issued object is current; clone-shaped tokens cannot acquire or cancel a lease.
  assert.equal(store.isOperationCurrent(genuineToken), true);
  assert.equal(store.isOperationCurrent(forgedToken), false);
  assert.equal(store.isOperationCurrent(frozenForgedToken), false);
  assert.equal(store.isOperationCurrent(null), false);
  assert.equal(store.isOperationCurrent('not-a-token'), false);
  assert.throws(
    () => store.acquireOperationLease('factory/forged', forgedToken),
    /STALE_FACTORY_STORE_OPERATION/,
  );
  const lease = store.acquireOperationLease('factory/forged', genuineToken);
  assert.throws(
    () => store.cancelOperationLease('factory/forged', forgedToken),
    /STALE_FACTORY_STORE_OPERATION/,
  );
  assert.equal(store.cancelOperationLease('factory/forged', genuineToken), true);
  assert.equal(lease.signal.aborted, true);
});

test('factory store issuance authority is isolated across stores sharing workspace and fence fields', async () => {
  // Given: two stores that intentionally expose the same workspace, revision, and fence values.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'operation-token-store-isolation');
  const options = {
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-operation-token-shared-fields',
    revision: 4,
  };
  const firstStore = createFactoryStore(options);
  const secondStore = createFactoryStore(options);
  const firstToken = firstStore.getOperationToken();
  const secondToken = secondStore.getOperationToken();

  // When/Then: a token issued by the other store cannot authorize this store's leases.
  assert.equal(firstToken.workspaceId, secondToken.workspaceId);
  assert.equal(firstToken.revision, secondToken.revision);
  assert.equal(firstToken.fence, secondToken.fence);
  assert.equal(secondStore.isOperationCurrent(firstToken), false);
  assert.throws(
    () => secondStore.acquireOperationLease('factory/foreign-store', firstToken),
    /STALE_FACTORY_STORE_OPERATION/,
  );
  assert.throws(
    () => secondStore.cancelOperationLease('factory/foreign-store', firstToken),
    /STALE_FACTORY_STORE_OPERATION/,
  );
  const ownLease = secondStore.acquireOperationLease('factory/foreign-store', secondToken);
  assert.equal(secondStore.cancelOperationLease('factory/foreign-store', secondToken), true);
  assert.equal(ownLease.signal.aborted, true);
});

test('factory store disposal aborts leases and revokes every issued operation token', async () => {
  // Given: a live token and lease owned by one store.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'operation-token-disposal');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-operation-token-disposal',
  });
  const token = store.getOperationToken();
  const lease = store.acquireOperationLease('factory/disposal', token);
  let abortCount = 0;
  let abortObservation;
  lease.signal.addEventListener('abort', () => {
    abortCount += 1;
    let acquireError;
    let commitError;
    try {
      store.acquireOperationLease('factory/disposal-from-abort', token);
    } catch (error) {
      acquireError = error;
    }
    try {
      if (!store.isOperationCurrent(token)) throw new Error('STALE_FACTORY_STORE_OPERATION');
      store.update(slice => slice, { owner: 'factory', expectedRevision: token.revision });
    } catch (error) {
      commitError = error;
    }
    abortObservation = {
      current: store.isOperationCurrent(token),
      acquireCode: acquireError?.code || acquireError?.message,
      commitMessage: commitError?.message,
    };
  });

  // When: the store is disposed.
  store.dispose();
  store.dispose();

  // Then: all async work is aborted and the old token is no longer recognized by any authority check.
  assert.equal(lease.signal.aborted, true);
  assert.equal(abortCount, 1);
  assert.deepEqual(abortObservation, {
    current: false,
    acquireCode: 'factory store is disposed',
    commitMessage: 'STALE_FACTORY_STORE_OPERATION',
  });
  assert.equal(store.isOperationCurrent(token), false);
  assert.throws(() => store.acquireOperationLease('factory/disposal', token), /disposed/i);
  assert.throws(() => store.cancelOperationLease('factory/disposal', token), /disposed/i);
});

test('factory store leases coexist by key and workspace cancellation aborts every old context', async () => {
  // Given: two different operation keys and one duplicate key in the same workspace.
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'operation-cancellation');
  const store = createFactoryStore({
    initialSnapshot: frozenSnapshot(),
    workspaceId: 'workspace-operation-cancellation-a',
  });
  const token = store.getOperationToken();
  const first = store.acquireOperationLease('factory/operation-a', token);
  const duplicate = store.acquireOperationLease('factory/operation-a', token);
  const second = store.acquireOperationLease('factory/operation-b', token);
  let abortObservation;
  first.signal.addEventListener('abort', () => {
    let acquireError;
    let commitError;
    try {
      store.acquireOperationLease('factory/operation-from-abort', token);
    } catch (error) {
      acquireError = error;
    }
    try {
      if (!store.isOperationCurrent(token)) throw new Error('STALE_FACTORY_STORE_OPERATION');
      store.update(slice => slice, { owner: 'factory', expectedRevision: token.revision });
    } catch (error) {
      commitError = error;
    }
    abortObservation = {
      current: store.isOperationCurrent(token),
      acquireCode: acquireError?.code || acquireError?.message,
      commitMessage: commitError?.message,
    };
  });

  // When: the workspace changes while both independent contexts are active.
  store.switchWorkspace('workspace-operation-cancellation-b', {
    snapshot: frozenSnapshot(2),
    revision: 4,
  });

  // Then: same-key acquisition is single-flight, different keys coexist, and all old signals/token are stale.
  assert.equal(first.acquired, true);
  assert.equal(duplicate.acquired, false);
  assert.equal(second.acquired, true);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.deepEqual(abortObservation, {
    current: false,
    acquireCode: 'STALE_FACTORY_STORE_OPERATION',
    commitMessage: 'STALE_FACTORY_STORE_OPERATION',
  });
  assert.equal(store.isOperationCurrent(store.getOperationToken()), true);
  assert.equal(store.isOperationCurrent(token), false);
  assert.equal(store.hasActiveOperationLease(), false);
  assert.throws(
    () => store.acquireOperationLease('factory/operation-a', token),
    /STALE_FACTORY_STORE_OPERATION/,
  );
});
