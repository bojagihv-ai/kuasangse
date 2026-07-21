const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const GATEWAY = path.resolve(__dirname, '../../src/modules/workspace-persistence.mjs');

async function loadGateway() {
  return import(`${pathToFileURL(GATEWAY).href}?fence=${Date.now()}-${Math.random()}`);
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
