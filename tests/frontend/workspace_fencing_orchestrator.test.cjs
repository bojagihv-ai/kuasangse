const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const GATEWAY = path.resolve(__dirname, '../../src/modules/workspace-persistence.mjs');
const OPERATION_CACHE = path.resolve(__dirname, '../../src/modules/persistence/operation-cache.mjs');

async function loadGateway() {
  return import(`${pathToFileURL(GATEWAY).href}?fence=${Date.now()}-${Math.random()}`);
}

async function loadOperationCache() {
  return import(`${pathToFileURL(OPERATION_CACHE).href}?cache=${Date.now()}-${Math.random()}`);
}

function cacheCandidate(operationId) {
  return {
    schema: 'test.persistence',
    version: 1,
    scopeId: `project:${operationId}`,
    savedAt: 1,
    digest: `digest:${operationId}`,
    metadata: {
      operationId,
      leaseId: 'cache-lease',
      fencingToken: '1',
      revision: {
        scopeId: `project:${operationId}`,
        counter: 1,
        updatedAt: 1,
        writerId: 'cache-test',
      },
    },
    snapshot: { value: operationId },
  };
}

function terminalResult() {
  return {
    accepted: true,
    authoritative: 'indexeddb',
    clean: true,
    partial: false,
    failures: [],
  };
}

function adapter(name) {
  const writes = [];
  return {
    name,
    writes,
    async read() { return writes.at(-1) || null; },
    async write(value) { writes.push(structuredClone(value)); return value; },
  };
}

function command(authority, value, counter) {
  return {
    projectId: 'alpha',
    snapshot: { value },
    metadata: {
      operationId: `operation-${counter}`,
      revision: { scopeId: 'project:alpha', counter, updatedAt: counter, writerId: 'test' },
      fencingToken: String(authority.fencingToken),
    },
    authority,
    replicas: ['session', 'server', 'workfile', 'archive'],
  };
}

test('delayed A completion after B takeover writes to no destination', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = { scopeId: 'project:alpha', leaseId: 'a', fencingToken: 1, mode: 'editing' };
  const gateway = createWorkspacePersistence({ adapters, authority: { snapshot: () => current } });
  const delayedA = command(current, 'A', 1);
  current = { scopeId: 'project:alpha', leaseId: 'b', fencingToken: 2, mode: 'editing' };
  const resultA = await gateway.commit(delayedA);
  const resultB = await gateway.commit(command(current, 'B', 1));

  assert.equal(resultA.accepted, false);
  assert.equal(resultA.code, 'STALE_FENCE');
  assert.equal(resultB.accepted, true);
  for (const target of Object.values(adapters)) {
    assert.deepEqual(target.writes.map(item => item.snapshot.value), ['B'], target.name);
  }
});

test('readonly and pagehide commits are rejected before every side effect', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  const readonly = { scopeId: 'project:alpha', leaseId: '', fencingToken: 9, mode: 'readonly' };
  const gateway = createWorkspacePersistence({ adapters, authority: { snapshot: () => readonly } });
  const result = await gateway.commit({ ...command(readonly, 'stale-pagehide', 9), trigger: 'pagehide' });

  assert.equal(result.accepted, false);
  assert.equal(result.code, 'READ_ONLY');
  assert.equal(Object.values(adapters).every(item => item.writes.length === 0), true);
});

test('editing project authority preserves and commits its linked draft branch', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  const current = {
    scopeId: 'project:alpha', leaseId: 'project-lease', fencingToken: 7,
    revision: 3, mode: 'editing',
  };
  const gateway = createWorkspacePersistence({ adapters, authority: { snapshot: () => current } });
  const result = await gateway.commit({
    scopeId: 'draft:alpha-branch',
    snapshot: {
      currentProjectId: 'alpha',
      workspaceScope: { id: 'draft:alpha-branch' },
      workspaceBranch: {
        schema: 'kuasangse.work-branch.v1',
        branchId: 'alpha-branch',
        scopeId: 'draft:alpha-branch',
        documentId: 'alpha',
        documentScopeId: 'project:alpha',
        createdAt: 0,
      },
      value: 'linked-branch-save',
    },
    metadata: {
      operationId: 'linked-branch-save',
      revision: {
        scopeId: 'draft:alpha-branch', counter: 1, updatedAt: 1, writerId: 'branch-test',
      },
    },
    replicas: ['session'],
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.deepEqual(adapters.indexeddb.writes.map(item => item.snapshot.value), ['linked-branch-save']);
  assert.deepEqual(adapters.session.writes.map(item => item.snapshot.value), ['linked-branch-save']);
  assert.equal(adapters.server.writes.length, 0);
});

test('project authority rejects a draft branch linked to another document', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  const current = {
    scopeId: 'project:alpha', leaseId: 'project-lease', fencingToken: 7,
    revision: 3, mode: 'editing',
  };
  const gateway = createWorkspacePersistence({ adapters, authority: { snapshot: () => current } });
  const result = await gateway.commit({
    scopeId: 'draft:foreign-branch',
    snapshot: {
      currentProjectId: 'beta',
      workspaceScope: { id: 'draft:foreign-branch' },
      workspaceBranch: {
        schema: 'kuasangse.work-branch.v1',
        branchId: 'foreign-branch',
        scopeId: 'draft:foreign-branch',
        documentId: 'beta',
        documentScopeId: 'project:beta',
        createdAt: 0,
      },
      value: 'foreign-branch-save',
    },
    metadata: {
      operationId: 'foreign-branch-save',
      revision: {
        scopeId: 'draft:foreign-branch', counter: 1, updatedAt: 1, writerId: 'branch-test',
      },
    },
    replicas: ['session'],
  });

  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.equal(result.code, 'STALE_SCOPE');
  assert.equal(Object.values(adapters).every(item => item.writes.length === 0), true);
});

test('protected richer-server no-op stops before IndexedDB and replicas without becoming a warning failure', async () => {
  // Given: the server confirms that its current accepted revision already protects richer work.
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  adapters.server.write = async () => ({
    protectedNoOp: true,
    scopeId: 'project:alpha',
    revision: 1,
    reason: 'incoming snapshot has no competitor analysis result',
  });
  const current = {
    scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 7,
    revision: 1, mode: 'editing',
  };
  const gateway = createWorkspacePersistence({ adapters, authority: { snapshot: () => current } });

  // When: an autosave proposes revision 2 without the protected server-only result.
  const result = await gateway.commit({
    ...command(current, 'compact-autosave', 2),
    replicas: ['session'],
  });

  // Then: it is a successful no-op and no local or remote destination advances.
  assert.equal(result.accepted, true);
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.protectedNoOp, true);
  assert.equal(result.reason, 'incoming snapshot has no competitor analysis result');
  assert.equal(result.acceptedRevision, 1);
  assert.equal(Object.values(adapters).every(item => item.writes.length === 0), true);
});

test('queued mutations from the same live lease receive consecutive revisions', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 3,
    revision: 0, mode: 'editing',
  };
  let queue = Promise.resolve();
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
    runMutation(operation) {
      const running = queue.then(operation);
      queue = running.catch(() => undefined);
      return running;
    },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });
  const first = { ...command(current, 'A', 1), rebaseRevision: true };
  const second = {
    ...command(current, 'B', 1),
    metadata: { ...command(current, 'B', 1).metadata, operationId: 'operation-second' },
    rebaseRevision: true,
  };

  const [resultA, resultB] = await Promise.all([gateway.commit(first), gateway.commit(second)]);

  assert.equal(resultA.accepted, true);
  assert.equal(resultB.accepted, true);
  assert.deepEqual(adapters.server.writes.map(item => item.metadata.revision.counter), [1, 2]);
  assert.deepEqual(adapters.server.writes.map(item => item.snapshot.value), ['A', 'B']);
});

test('queued blank-draft mutations receive consecutive revisions instead of colliding in IndexedDB', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const fencingUrl = pathToFileURL(path.resolve(__dirname, '../../src/modules/persistence/fencing.mjs')).href;
  const { assertReplicaCanPublish } = await import(`${fencingUrl}?draft-cas=${Date.now()}-${Math.random()}`);
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let acceptedEnvelope = null;
  adapters.indexeddb.write = async envelope => {
    assertReplicaCanPublish(acceptedEnvelope, envelope);
    acceptedEnvelope = structuredClone(envelope);
    adapters.indexeddb.writes.push(structuredClone(envelope));
    return envelope;
  };
  let current = {
    scopeId: 'draft:isolated-work', leaseId: '', fencingToken: 0,
    revision: 0, mode: 'offline-edit',
  };
  let queue = Promise.resolve();
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
    runMutation(operation) {
      const running = queue.then(operation);
      queue = running.catch(() => undefined);
      return running;
    },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });
  const draftCommand = (value, operationId) => ({
    scopeId: 'draft:isolated-work',
    snapshot: { value },
    metadata: {
      operationId,
      leaseId: '',
      fencingToken: '',
      revision: {
        scopeId: 'draft:isolated-work', counter: 1, updatedAt: 1, writerId: 'draft-test',
      },
    },
    rebaseRevision: true,
  });

  const [first, second] = await Promise.all([
    gateway.commit(draftCommand('blank-state', 'draft-operation-1')),
    gateway.commit(draftCommand('replacement-image', 'draft-operation-2')),
  ]);

  assert.equal(first.accepted, true, JSON.stringify(first));
  assert.equal(second.accepted, true, JSON.stringify(second));
  assert.deepEqual(adapters.indexeddb.writes.map(item => item.metadata.revision.counter), [1, 2]);
  assert.equal(current.revision, 2);
});

test('blank-draft authority advances after IndexedDB accepts even when a replica fails', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const fencingUrl = pathToFileURL(path.resolve(__dirname, '../../src/modules/persistence/fencing.mjs')).href;
  const { assertReplicaCanPublish } = await import(`${fencingUrl}?draft-partial=${Date.now()}-${Math.random()}`);
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let acceptedEnvelope = null;
  adapters.indexeddb.write = async envelope => {
    assertReplicaCanPublish(acceptedEnvelope, envelope);
    acceptedEnvelope = structuredClone(envelope);
    adapters.indexeddb.writes.push(structuredClone(envelope));
    return envelope;
  };
  let failSessionOnce = true;
  adapters.session.write = async envelope => {
    if (failSessionOnce) {
      failSessionOnce = false;
      throw new Error('session bootstrap revision is already occupied');
    }
    adapters.session.writes.push(structuredClone(envelope));
    return envelope;
  };
  let current = {
    scopeId: 'draft:partial-work', leaseId: '', fencingToken: 0,
    revision: 0, mode: 'offline-edit',
  };
  let queue = Promise.resolve();
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
    runMutation(operation) {
      const running = queue.then(operation);
      queue = running.catch(() => undefined);
      return running;
    },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });
  const draftCommand = (value, operationId) => ({
    scopeId: 'draft:partial-work',
    snapshot: { value },
    metadata: {
      operationId,
      revision: { scopeId: 'draft:partial-work', counter: 1, updatedAt: 1, writerId: 'draft-test' },
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  const partial = await gateway.commit(draftCommand('first-image', 'draft-partial-1'));
  const recovered = await gateway.commit(draftCommand('replacement-image', 'draft-partial-2'));

  assert.equal(partial.accepted, true, JSON.stringify(partial));
  assert.equal(partial.partial, true, JSON.stringify(partial));
  assert.equal(recovered.accepted, true, JSON.stringify(recovered));
  assert.equal(recovered.clean, true, JSON.stringify(recovered));
  assert.deepEqual(adapters.indexeddb.writes.map(item => item.metadata.revision.counter), [1, 2]);
  assert.equal(current.revision, 2);
});

test('server revision observed by heartbeat during commit does not reject remaining replicas', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 11,
    revision: 0, mode: 'editing',
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  adapters.server.write = async (envelope, context) => {
    context.assertAuthority();
    adapters.server.writes.push(structuredClone(envelope));
    current = { ...current, revision: envelope.metadata.revision.counter };
    context.assertCompletion();
    return envelope;
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit(command(current, 'heartbeat-race', 1));

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false);
  for (const target of Object.values(adapters)) {
    assert.deepEqual(target.writes.map(item => item.snapshot.value), ['heartbeat-race'], target.name);
  }
});

test('restored authoritative revision rebases the next managed commit', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 3,
    revision: 2, mode: 'editing',
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  adapters.server.read = async () => ({
    scopeId: 'project:alpha',
    snapshot: { value: 'restored' },
    digest: 'restored-digest',
    metadata: {
      operationId: 'restored-operation',
      leaseId: 'live-lease',
      fencingToken: 3,
      revision: {
        scopeId: 'project:alpha', counter: 7, updatedAt: 7, writerId: 'server',
      },
    },
  });
  const gateway = createWorkspacePersistence({ adapters, authority });

  const restored = await gateway.restore({ scopeId: 'project:alpha', sources: ['server'] });
  const result = await gateway.commit({
    ...command(current, 'after-restore', 1),
    rebaseRevision: true,
  });

  assert.equal(restored.revision.counter, 7);
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(adapters.server.writes.at(-1).metadata.revision.counter, 8);
  assert.equal(current.revision, 8);
});

test('server-accepted partial commit advances authority before a fresh retry', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 4,
    revision: 0, mode: 'editing',
  };
  let failSessionOnce = true;
  adapters.session.write = async envelope => {
    if (failSessionOnce) {
      failSessionOnce = false;
      throw new Error('session replica unavailable');
    }
    adapters.session.writes.push(structuredClone(envelope));
    return envelope;
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const first = await gateway.commit({
    ...command(current, 'first', 1),
    replicas: ['session'],
    rebaseRevision: true,
  });
  const second = await gateway.commit({
    ...command(current, 'second', 1),
    metadata: { ...command(current, 'second', 1).metadata, operationId: 'operation-second' },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(first.accepted, true, JSON.stringify(first));
  assert.equal(first.partial, true, JSON.stringify(first));
  assert.equal(second.clean, true, JSON.stringify(second));
  assert.deepEqual(adapters.server.writes.map(item => item.metadata.revision.counter), [1, 2]);
  assert.equal(current.revision, 2);
});

test('newer same-fence replica revision is adopted before the next managed retry', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 5,
    revision: 0, mode: 'editing',
  };
  let failIndexedDbOnce = true;
  adapters.indexeddb.write = async envelope => {
    if (failIndexedDbOnce) {
      failIndexedDbOnce = false;
      throw Object.assign(new Error('replica already contains a newer revision'), {
        name: 'PersistenceReplicaError',
        code: 'STALE_REVISION',
        current: {
          scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 5,
          revision: 5,
        },
      });
    }
    adapters.indexeddb.writes.push(structuredClone(envelope));
    return envelope;
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const first = await gateway.commit({
    ...command(current, 'stale-local-replica', 1),
    replicas: ['session'],
    rebaseRevision: true,
  });
  const second = await gateway.commit({
    ...command(current, 'rebased-after-replica', 1),
    metadata: {
      ...command(current, 'rebased-after-replica', 1).metadata,
      operationId: 'operation-after-replica',
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(first.accepted, false, JSON.stringify(first));
  assert.equal(first.partial, true, JSON.stringify(first));
  assert.equal(second.clean, true, JSON.stringify(second));
  assert.deepEqual(adapters.server.writes.map(item => item.metadata.revision.counter), [1, 6]);
  assert.equal(current.revision, 6);
});

test('same operationId rebuilds its envelope after a newer replica revision is observed', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 9,
    revision: 0, mode: 'editing',
  };
  let failIndexedDbOnce = true;
  adapters.indexeddb.write = async envelope => {
    if (failIndexedDbOnce) {
      failIndexedDbOnce = false;
      throw Object.assign(new Error('replica is ahead of the in-flight operation'), {
        name: 'PersistenceReplicaError',
        code: 'STALE_REVISION',
        current: {
          scopeId: envelope.scopeId, leaseId: envelope.metadata.leaseId,
          fencingToken: envelope.metadata.fencingToken, revision: 5,
        },
      });
    }
    adapters.indexeddb.writes.push(structuredClone(envelope));
    return envelope;
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });
  const initial = {
    ...command(current, 'same-operation-content', 1),
    replicas: ['session'],
    rebaseRevision: true,
  };

  const first = await gateway.commit(initial);
  const second = await gateway.commit(initial);

  assert.equal(first.accepted, false, JSON.stringify(first));
  assert.equal(first.partial, true, JSON.stringify(first));
  assert.equal(second.clean, true, JSON.stringify(second));
  assert.deepEqual(adapters.server.writes.map(item => item.metadata.revision.counter), [1, 6]);
  assert.equal(adapters.indexeddb.writes.at(-1).metadata.revision.counter, 6);
  assert.equal(current.revision, 6);
});

test('same-content stale replica after server acceptance is completed without a retry warning', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 6,
    revision: 0, mode: 'editing',
  };
  adapters.indexeddb.write = async envelope => {
    throw Object.assign(new Error('replica already contains this operation at a newer revision'), {
      name: 'PersistenceReplicaError',
      code: 'STALE_REVISION',
      current: {
        scopeId: envelope.scopeId,
        leaseId: envelope.metadata.leaseId,
        fencingToken: envelope.metadata.fencingToken,
        revision: envelope.metadata.revision.counter + 1,
        operationId: envelope.metadata.operationId,
        digest: envelope.digest,
      },
    });
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    ...command(current, 'same-content', 1),
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.deepEqual(result.failures, []);
  assert.equal(adapters.server.writes.length, 1);
  assert.equal(adapters.session.writes.length, 1);
  assert.equal(current.revision, 2);
});

test('different-content stale replica remains rejected and is never overwritten', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 7,
    revision: 0, mode: 'editing',
  };
  adapters.indexeddb.write = async envelope => {
    throw Object.assign(new Error('replica contains newer different content'), {
      name: 'PersistenceReplicaError',
      code: 'STALE_REVISION',
      current: {
        scopeId: envelope.scopeId,
        leaseId: envelope.metadata.leaseId,
        fencingToken: envelope.metadata.fencingToken,
        revision: envelope.metadata.revision.counter + 1,
        operationId: 'different-operation',
        digest: 'fnv1a32:different-content',
      },
    });
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    ...command(current, 'must-not-overwrite', 1),
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.equal(result.partial, true, JSON.stringify(result));
  assert.equal(result.code, 'STALE_REVISION');
  assert.equal(adapters.server.writes.length, 1);
  assert.equal(adapters.session.writes.length, 0);
  assert.equal(current.revision, 2);
});

test('same-content stale session replica is treated as an idempotent completion', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 8,
    revision: 0, mode: 'editing',
  };
  adapters.session.write = async envelope => {
    throw Object.assign(new Error('session already contains this operation at a newer revision'), {
      name: 'PersistenceReplicaError',
      code: 'STALE_REVISION',
      current: {
        scopeId: envelope.scopeId,
        leaseId: envelope.metadata.leaseId,
        fencingToken: envelope.metadata.fencingToken,
        revision: envelope.metadata.revision.counter + 1,
        operationId: envelope.metadata.operationId,
        digest: envelope.digest,
      },
    });
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    ...command(current, 'same-session-content', 1),
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.deepEqual(result.failures, []);
  assert.equal(adapters.indexeddb.writes.length, 1);
  assert.equal(current.revision, 2);
});

test('same-content stale replica recovers when authority already observes its newer revision', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  let current = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 10,
    revision: 1, mode: 'editing',
  };
  adapters.session.write = async envelope => {
    current = { ...current, revision: 3 };
    throw Object.assign(new Error('session is already at the newer same-content revision'), {
      name: 'PersistenceReplicaError',
      code: 'STALE_REVISION',
      current: {
        scopeId: envelope.scopeId,
        leaseId: envelope.metadata.leaseId,
        fencingToken: envelope.metadata.fencingToken,
        revision: 3,
        operationId: envelope.metadata.operationId,
        digest: envelope.digest,
      },
    });
  };
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    ...command(current, 'authority-already-observed', 1),
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.deepEqual(result.failures, []);
  assert.equal(current.revision, 3);
});

test('restore ignores a higher-revision candidate from a stale fence and lease', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  adapters.indexeddb.writes.push({
    scopeId: 'project:alpha',
    snapshot: { source: 'stale-local' },
    metadata: {
      operationId: 'stale-local', leaseId: 'lease-old', fencingToken: 9,
      revision: { scopeId: 'project:alpha', counter: 99, updatedAt: 99, writerId: 'old-tab' },
    },
  });
  adapters.server.writes.push({
    scopeId: 'project:alpha',
    snapshot: { source: 'current-server' },
    metadata: {
      operationId: 'current-server', leaseId: 'lease-old', fencingToken: 10,
      revision: { scopeId: 'project:alpha', counter: 5, updatedAt: 5, writerId: 'server' },
    },
  });
  const current = {
    scopeId: 'project:alpha', leaseId: 'lease-new', fencingToken: 11,
    revision: 5, mode: 'editing',
  };
  const gateway = createWorkspacePersistence({
    adapters,
    authority: { snapshot: () => current },
  });

  const restored = await gateway.restore({
    scopeId: 'project:alpha',
    sources: ['indexeddb', 'server'],
  });

  assert.equal(restored.source, 'server');
  assert.equal(restored.snapshot.source, 'current-server');
});

test('restore rejects a higher-revision legacy local candidate without fence or lease for a fenced project', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  adapters.indexeddb.writes.push({
    scopeId: 'project:alpha',
    snapshot: { source: 'legacy-local-without-authority' },
    metadata: {
      operationId: 'legacy-local',
      revision: { scopeId: 'project:alpha', counter: 99, updatedAt: 99, writerId: 'old-tab' },
    },
  });
  adapters.server.writes.push({
    scopeId: 'project:alpha',
    snapshot: { source: 'current-server' },
    metadata: {
      operationId: 'current-server', leaseId: 'lease-old', fencingToken: 10,
      revision: { scopeId: 'project:alpha', counter: 5, updatedAt: 5, writerId: 'server' },
    },
  });
  const current = {
    scopeId: 'project:alpha', leaseId: 'lease-new', fencingToken: 11,
    revision: 5, mode: 'editing',
  };
  const gateway = createWorkspacePersistence({
    adapters,
    authority: { snapshot: () => current },
  });

  const restored = await gateway.restore({
    scopeId: 'project:alpha',
    sources: ['indexeddb', 'server'],
  });

  assert.equal(restored.source, 'server');
  assert.equal(restored.snapshot.source, 'current-server');
});

test('server restore accepts the requested project snapshot while the live tab holds its draft branch authority', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  adapters.server.writes.push({
    scopeId: 'project:alpha',
    snapshot: { source: 'authoritative-project-option-labels' },
    metadata: {
      operationId: 'project-restore',
      revision: { scopeId: 'project:alpha', counter: 2, updatedAt: 2, writerId: 'server' },
    },
  });
  const authority = {
    snapshot: () => ({
      scopeId: 'draft:alpha-branch', leaseId: '', fencingToken: 0,
      revision: 0, mode: 'offline-edit',
    }),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const restored = await gateway.restore({ scopeId: 'project:alpha', sources: ['server'] });

  assert.equal(restored.source, 'server');
  assert.equal(restored.snapshot.source, 'authoritative-project-option-labels');
});

test('restore still allows a legacy local candidate for an offline draft without fencing metadata', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, adapter(name)]));
  adapters.indexeddb.writes.push({
    scopeId: 'draft:offline-work',
    snapshot: { source: 'legacy-draft-local' },
    metadata: {
      operationId: 'legacy-draft-local',
      revision: { scopeId: 'draft:offline-work', counter: 99, updatedAt: 99, writerId: 'offline-tab' },
    },
  });
  const current = {
    scopeId: 'draft:offline-work', leaseId: '', fencingToken: 0,
    revision: 0, mode: 'offline-edit',
  };
  const gateway = createWorkspacePersistence({
    adapters,
    authority: { snapshot: () => current },
  });

  const restored = await gateway.restore({
    scopeId: 'draft:offline-work',
    sources: ['indexeddb'],
  });

  assert.equal(restored.source, 'indexeddb');
  assert.equal(restored.snapshot.source, 'legacy-draft-local');
});

test('managed partial retention releases large snapshots and retries only pending destinations', async t => {
  // Given: 120 unique managed commits whose server writes succeed before IndexedDB fails once.
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../src/modules/workspace-persistence.mjs')).href;
  const probeScript = [
    `import { createWorkspacePersistence } from ${JSON.stringify(moduleUrl)};`,
    "const names = ['session', 'indexeddb', 'server', 'workfile', 'archive'];",
    'let current = null;',
    'let serverWrites = 0;',
    'let indexeddbAttempts = 0;',
    'let indexeddbWrites = 0;',
    'let sessionWrites = 0;',
    'const failedOperations = new Set();',
    "const adapters = Object.fromEntries(names.map(name => [name, { async read() { return null; }, async write() {} }]));",
    'adapters.server.write = async () => { serverWrites += 1; };',
    'adapters.indexeddb.write = async envelope => {',
    '  indexeddbAttempts += 1;',
    '  const operationId = envelope.metadata.operationId;',
    '  if (!failedOperations.has(operationId)) {',
    '    failedOperations.add(operationId);',
    "    throw Object.assign(new Error('probe IndexedDB outage'), { code: 'IDB_UNAVAILABLE' });",
    '  }',
    '  indexeddbWrites += 1;',
    '};',
    'adapters.session.write = async () => { sessionWrites += 1; };',
    'const authority = {',
    '  snapshot: () => current,',
    '  observeRevision(revision) { current = { ...current, revision }; },',
    '};',
    'const gateway = createWorkspacePersistence({ adapters, authority });',
    'global.gc();',
    'const before = process.memoryUsage().heapUsed;',
    'let retryCommand = null;',
    'for (let i = 0; i < 120; i += 1) {',
    "  current = { scopeId: `project:partial-${i}`, leaseId: 'probe-lease', fencingToken: 1, revision: 0, mode: 'editing' };",
    "  const snapshot = { blob: `${String(i).padStart(3, '0')}:` + 'x'.repeat(256 * 1024) };",
    '  const command = {',
    '    projectId: `partial-${i}`, snapshot, replicas: [\'session\'], rebaseRevision: true,',
    "    metadata: { operationId: `partial-${i}`, leaseId: 'probe-lease', fencingToken: '1', revision: { scopeId: `project:partial-${i}`, counter: 1, updatedAt: 1, writerId: 'probe' } },",
    '  };',
    '  const partial = await gateway.commit(command);',
    "  if (partial.partial !== true || partial.envelope.snapshot.blob !== snapshot.blob) throw new Error('managed partial result lost its full snapshot');",
    '  retryCommand = command;',
    '}',
    'global.gc();',
    'const after = process.memoryUsage().heapUsed;',
    '',
    '// When: mismatched content is rejected before the retained final operation is retried.',
    'let identityRejected = false;',
    'try {',
    "  await gateway.commit({ ...retryCommand, snapshot: { blob: 'different workspace content' } });",
    '} catch (error) {',
    "  identityRejected = /operationId cannot be reused/.test(String(error?.message || error));",
    '}',
    'const retried = await gateway.commit(retryCommand);',
    '',
    '// Then: retained state is small and only unfinished destinations run with the original identity.',
    'console.log(JSON.stringify({',
    '  retainedBytes: after - before,',
    '  serverWrites, indexeddbAttempts, indexeddbWrites, sessionWrites,',
    '  identityRejected, clean: retried.clean,',
    '  retriedRevision: retried.envelope.metadata.revision.counter,',
    '  snapshotRestored: retried.envelope.snapshot.blob === retryCommand.snapshot.blob,',
    '}));',
  ].join('\n');
  const probe = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', probeScript], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const measurement = JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1));
  t.diagnostic(`managed-partial-probe ${JSON.stringify(measurement)}`);
  assert.ok(measurement.retainedBytes < 12 * 1024 * 1024,
    `managed partial snapshots retained ${measurement.retainedBytes} bytes`);
  assert.deepEqual(measurement, {
    retainedBytes: measurement.retainedBytes,
    serverWrites: 120,
    indexeddbAttempts: 121,
    indexeddbWrites: 1,
    sessionWrites: 1,
    identityRejected: true,
    clean: true,
    retriedRevision: 1,
    snapshotRestored: true,
  });
});

test('terminal operation retention does not keep large envelopes while preserving same-operation identity checks', async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../src/modules/workspace-persistence.mjs')).href;
  const probeScript = [
    `import { createWorkspacePersistence } from ${JSON.stringify(moduleUrl)};`,
    "const names = ['session', 'indexeddb', 'server', 'workfile', 'archive'];",
    "const adapters = Object.fromEntries(names.map(name => [name, { async read() { return null; }, async write() {} }]));",
    'const gateway = createWorkspacePersistence({ adapters });',
    'global.gc();',
    'const before = process.memoryUsage().heapUsed;',
    'for (let i = 0; i < 120; i += 1) {',
    "  await gateway.commit({ projectId: `probe-${i}`, snapshot: { blob: `${i}:` + 'x'.repeat(256 * 1024 - 20) }, metadata: { operationId: `probe-${i}`, revision: { scopeId: `project:probe-${i}`, counter: 1, updatedAt: 1, writerId: 'probe' } }, isCurrent: () => true });",
    '}',
    "let current = { scopeId: 'project:rejected-0', leaseId: 'probe-lease', fencingToken: 1, revision: 0, mode: 'editing' };",
    "const rejectedAdapters = Object.fromEntries(names.map(name => [name, { async read() { return null; }, async write() { if (name === 'server') throw new Error('probe server rejection'); } }]));",
    "const rejectedAuthority = { snapshot: () => current };",
    'const rejectedGateway = createWorkspacePersistence({ adapters: rejectedAdapters, authority: rejectedAuthority });',
    'for (let i = 0; i < 120; i += 1) {',
    "  current = { scopeId: `project:rejected-${i}`, leaseId: 'probe-lease', fencingToken: 1, revision: 0, mode: 'editing' };",
    "  await rejectedGateway.commit({ projectId: `rejected-${i}`, snapshot: { blob: `${i}:` + 'y'.repeat(256 * 1024 - 20) }, metadata: { operationId: `rejected-${i}`, leaseId: 'probe-lease', fencingToken: '1', revision: { scopeId: `project:rejected-${i}`, counter: 1, updatedAt: 1, writerId: 'probe' } }, isCurrent: () => true });",
    '}',
    'global.gc();',
    'console.log(JSON.stringify({ before, after: process.memoryUsage().heapUsed }));',
  ].join('\n');
  const probe = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', probeScript], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const measurement = JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1));
  assert.ok(measurement.after - measurement.before < 12 * 1024 * 1024,
    `terminal operation envelopes retained ${measurement.after - measurement.before} bytes`);
});

test('partial and terminal operation retention use independent 128-entry bounds', async () => {
  const { createPersistenceOperationCache } = await loadOperationCache();

  // Given: one retained partial operation followed by terminal churn.
  const partialProtected = createPersistenceOperationCache();
  const partialCandidate = cacheCandidate('partial-protected');
  const partialOperation = partialProtected.acquire({
    candidate: partialCandidate,
    required: ['server', 'session'],
  });
  partialOperation.completed.add('server');
  partialProtected.retainPartial(partialOperation);
  for (let i = 0; i < 129; i += 1) {
    const candidate = cacheCandidate(`terminal-churn-${i}`);
    const operation = partialProtected.acquire({ candidate, required: [] });
    partialProtected.retainTerminal(operation, terminalResult());
  }

  // When: the pending partial operation is acquired after 129 terminal entries.
  const survivingPartial = partialProtected.acquire({
    candidate: partialCandidate,
    required: ['server', 'session'],
  });

  // Then: its completed destination is still remembered for a retry.
  assert.deepEqual([...survivingPartial.completed], ['server']);

  // Given: one retained terminal operation followed by partial churn.
  const terminalProtected = createPersistenceOperationCache();
  const terminalCandidate = cacheCandidate('terminal-protected');
  const terminalOperation = terminalProtected.acquire({ candidate: terminalCandidate, required: [] });
  terminalProtected.retainTerminal(terminalOperation, terminalResult());
  for (let i = 0; i < 129; i += 1) {
    const candidate = cacheCandidate(`partial-churn-${i}`);
    const operation = terminalProtected.acquire({ candidate, required: ['session'] });
    operation.completed.add('server');
    terminalProtected.retainPartial(operation);
  }

  // When: the terminal operation is acquired after 129 partial entries.
  const survivingTerminal = terminalProtected.acquire({ candidate: terminalCandidate, required: [] });

  // Then: terminal replay remains available despite partial churn.
  assert.equal(survivingTerminal.terminal, true);

  // Given: each pool is filled to its own 128-entry boundary.
  const partialBoundary = createPersistenceOperationCache();
  const partialCandidates = [];
  for (let i = 0; i < 129; i += 1) {
    const candidate = cacheCandidate(`partial-boundary-${i}`);
    partialCandidates.push(candidate);
    const operation = partialBoundary.acquire({ candidate, required: ['session'] });
    operation.completed.add('server');
    partialBoundary.retainPartial(operation);
  }
  const terminalBoundary = createPersistenceOperationCache();
  const terminalCandidates = [];
  for (let i = 0; i < 129; i += 1) {
    const candidate = cacheCandidate(`terminal-boundary-${i}`);
    terminalCandidates.push(candidate);
    const operation = terminalBoundary.acquire({ candidate, required: [] });
    terminalBoundary.retainTerminal(operation, terminalResult());
  }

  // When: the oldest entry in each bounded pool is requested again.
  const evictedPartial = partialBoundary.acquire({
    candidate: partialCandidates[0],
    required: ['session'],
  });
  const evictedTerminal = terminalBoundary.acquire({
    candidate: terminalCandidates[0],
    required: [],
  });

  // Then: only the oldest entry in its own pool is evicted at the 129th insert.
  assert.deepEqual([...evictedPartial.completed], []);
  assert.equal(evictedTerminal.terminal, undefined);

  // Given: a retained partial operation is re-opened for its final destination.
  const transitionCache = createPersistenceOperationCache();
  const transitionCandidate = cacheCandidate('active-to-terminal');
  const transition = transitionCache.acquire({
    candidate: transitionCandidate,
    required: ['server', 'session'],
  });
  transition.completed.add('server');
  transitionCache.retainPartial(transition);

  // When: retry completes the pending replica and transitions to terminal retention.
  const activeRetry = transitionCache.acquire({
    candidate: transitionCandidate,
    required: ['server', 'session'],
  });
  activeRetry.completed.add('session');
  transitionCache.retainTerminal(activeRetry, terminalResult());
  const terminalRetry = transitionCache.acquire({
    candidate: transitionCandidate,
    required: ['server', 'session'],
  });

  // Then: the same operation replays as terminal, with no stale partial state.
  assert.equal(terminalRetry.terminal, true);
  assert.equal(terminalRetry.result.clean, true);
});

test('terminal churn cannot turn a pending replica into a protected no-op clean result', async () => {
  // Given: the first managed operation commits server + IndexedDB but its session replica fails.
  const { createWorkspacePersistence } = await loadGateway();
  const names = ['session', 'indexeddb', 'server', 'workfile', 'archive'];
  const writes = Object.fromEntries(names.map(name => [name, []]));
  const pendingSessionAttempts = [];
  let current = {
    scopeId: 'project:pending', leaseId: 'lease-pending', fencingToken: 1,
    revision: 0, mode: 'editing',
  };
  const adapters = Object.fromEntries(names.map(name => [name, {
    async read() { return null; },
    async write(envelope) {
      writes[name].push(envelope.metadata.operationId);
      if (name === 'session' && envelope.metadata.operationId === 'pending-op') {
        pendingSessionAttempts.push(envelope.metadata.operationId);
        if (pendingSessionAttempts.length === 1) throw new Error('session replica unavailable');
      }
      if (name === 'server' && envelope.metadata.operationId === 'pending-op'
        && writes.server.filter(id => id === 'pending-op').length > 1) {
        return { protectedNoOp: true, acceptedRevision: 1 };
      }
      return envelope;
    },
  }]));
  const authority = {
    snapshot: () => current,
    observeRevision(revision) { current = { ...current, revision }; },
  };
  const gateway = createWorkspacePersistence({ adapters, authority });
  const pendingCommand = {
    projectId: 'pending',
    snapshot: { value: 'pending' },
    metadata: {
      operationId: 'pending-op',
      leaseId: 'lease-pending',
      fencingToken: '1',
      revision: { scopeId: 'project:pending', counter: 1, updatedAt: 1, writerId: 'test' },
    },
    replicas: ['session'],
    rebaseRevision: true,
  };
  const partial = await gateway.commit(pendingCommand);
  assert.equal(partial.partial, true, JSON.stringify(partial));

  // When: 129 unrelated terminal commits churn the terminal retention pool.
  for (let i = 0; i < 129; i += 1) {
    const scopeId = `project:terminal-${i}`;
    current = {
      scopeId, leaseId: `lease-${i}`, fencingToken: 1, revision: 0, mode: 'editing',
    };
    await gateway.commit({
      projectId: `terminal-${i}`,
      snapshot: { value: `terminal-${i}` },
      metadata: {
        operationId: `terminal-${i}`,
        leaseId: `lease-${i}`,
        fencingToken: '1',
        revision: { scopeId, counter: 1, updatedAt: 1, writerId: 'test' },
      },
      replicas: [],
    });
  }
  current = {
    scopeId: 'project:pending', leaseId: 'lease-pending', fencingToken: 1,
    revision: 1, mode: 'editing',
  };

  // Then: retry writes the pending session replica instead of falsely returning protectedNoOp clean.
  const retried = await gateway.commit(pendingCommand);
  assert.equal(retried.protectedNoOp, undefined, JSON.stringify(retried));
  assert.equal(retried.clean, true, JSON.stringify(retried));
  assert.deepEqual(pendingSessionAttempts, ['pending-op', 'pending-op']);
  assert.equal(writes.server.filter(id => id === 'pending-op').length, 1);
});
