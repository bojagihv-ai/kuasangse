const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULES = path.resolve(__dirname, '../../src/modules/persistence');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function load(name) {
  const url = pathToFileURL(path.join(MODULES, name)).href;
  return import(`${url}?shared-cas=${Date.now()}-${Math.random()}`);
}

function authority(scopeId) {
  return {
    persistenceAuthority: {
      scopeId,
      leaseId: `lease:${scopeId}`,
      fencingToken: 1,
      revision: 0,
    },
    assertAuthority() {},
    assertCompletion() {},
  };
}

function createDriver(assertReplicaCanPublish, pausedMarkers = []) {
  const records = new Map();
  const gates = new Map(pausedMarkers.map(marker => [
    marker, { started: deferred(), resume: deferred() },
  ]));
  const recordKey = (store, id) => `${store}:${id}`;
  const values = store => [...records.entries()]
    .filter(([key]) => key.startsWith(`${store}:`))
    .map(([, value]) => structuredClone(value));

  const driver = {
    async get(store, id) { return structuredClone(records.get(recordKey(store, id)) || null); },
    async getAll(store) { return values(store); },
    async delete(store, id) { records.delete(recordKey(store, id)); },
    async put(store, value) { records.set(recordKey(store, value.id), structuredClone(value)); },
    async compareAndPut(store, value, guard) {
      const gate = gates.get(value.marker);
      if (gate) {
        gate.started.resolve();
        await gate.resume.promise;
      }
      const key = recordKey(store, value.id);
      const current = records.get(key) || null;
      const currentVersion = Number(current?.persistenceDestination?.version) || 0;
      if (guard.expectedDestinationVersion !== undefined
        && currentVersion !== guard.expectedDestinationVersion) {
        const error = new Error('stale destination version');
        error.code = 'STALE_REPLICA';
        throw error;
      }
      guard.assertAuthority?.();
      assertReplicaCanPublish(current, guard.envelope || guard);
      records.set(key, structuredClone(value));
    },
    async compareAndDelete(store, id, guard) {
      const key = recordKey(store, id);
      const current = records.get(key) || null;
      guard.assertAuthority?.();
      assertReplicaCanPublish(current, guard.envelope || guard);
      records.delete(key);
    },
    async compareAndPutMany(entries) {
      for (const entry of entries) {
        records.set(recordKey(entry.storeName, entry.value.id), structuredClone(entry.value));
      }
    },
  };

  return {
    driver,
    raw: (store, id) => records.get(recordKey(store, id)) || null,
    started: marker => gates.get(marker).started.promise,
    resume: marker => gates.get(marker).resume.resolve(),
  };
}

async function fixture(pausedMarkers = []) {
  const { assertReplicaCanPublish } = await load('fencing.mjs');
  const { createIndexedDbPersistenceAdapter } = await load('indexeddb-adapter.mjs');
  const physical = createDriver(assertReplicaCanPublish, pausedMarkers);
  return {
    adapter: createIndexedDbPersistenceAdapter({ driver: physical.driver }),
    physical,
  };
}

test('Given a global preference changes scopes sequentially Then each accepted write advances destination version', async () => {
  // Given: alpha owns the first accepted global preference value.
  const { adapter, physical } = await fixture();
  await adapter.put('appSettings', { id: 'global-pref', marker: 'A' }, authority('project:alpha'));

  // When: beta later writes the same global key from its independent workspace authority.
  await adapter.put('appSettings', { id: 'global-pref', marker: 'B' }, authority('project:beta'));

  // Then: the sequential cross-scope update is allowed and its destination version advances.
  assert.equal((await adapter.get('appSettings', 'global-pref')).marker, 'B');
  assert.equal(physical.raw('appSettings', 'global-pref').persistenceDestination.version, 2);
});

test('Given stale A spans delete and recreate Then the tombstone version prevents ABA overwrite', async () => {
  // Given: A captures version 1 and pauses before replacing the shared preference.
  const { adapter, physical } = await fixture(['A']);
  await adapter.put('appSettings', { id: 'global-pref', marker: 'seed' }, authority('project:seed'));
  const pendingA = adapter.put(
    'appSettings', { id: 'global-pref', marker: 'A' }, authority('project:alpha'),
  );
  await physical.started('A');

  // When: beta deletes to a versioned tombstone and gamma recreates from that tombstone.
  await adapter.delete('appSettings', 'global-pref', authority('project:beta'));
  assert.equal(await adapter.get('appSettings', 'global-pref'), null);
  assert.deepEqual(await adapter.getAll('appSettings'), []);
  await adapter.put('appSettings', { id: 'global-pref', marker: 'C' }, authority('project:gamma'));
  physical.resume('A');

  // Then: stale A's expected version 1 cannot replace recreated version 3.
  await assert.rejects(pendingA, error => error?.code === 'STALE_REPLICA');
  assert.equal((await adapter.get('appSettings', 'global-pref')).marker, 'C');
  assert.equal(physical.raw('appSettings', 'global-pref').persistenceDestination.version, 3);
});

test('Given three writers capture one global version Then only the first physical CAS publishes', async () => {
  // Given: A, B, and C all capture absent destination version 0 before any publish.
  const { adapter, physical } = await fixture(['A', 'B', 'C']);
  const writes = ['A', 'B', 'C'].map(marker => adapter.put(
    'appSettings', { id: 'global-pref', marker }, authority(`project:${marker.toLowerCase()}`),
  ));
  await Promise.all(['A', 'B', 'C'].map(marker => physical.started(marker)));

  // When: C wins the atomic destination CAS and the older prepared writers resume.
  physical.resume('C');
  await writes[2];
  physical.resume('B');
  physical.resume('A');

  // Then: both losing writers reject and C remains the sole accepted value.
  await assert.rejects(writes[0], error => error?.code === 'STALE_REPLICA');
  await assert.rejects(writes[1], error => error?.code === 'STALE_REPLICA');
  assert.equal((await adapter.get('appSettings', 'global-pref')).marker, 'C');
});

test('Given different scope-keyed project records Then destination CAS keeps the keys independent', async () => {
  // Given: alpha and beta records occupy different physical project keys.
  const { adapter } = await fixture();

  // When: both workspaces publish their own records.
  await Promise.all([
    adapter.put('projects', { id: 'alpha', marker: 'A' }, authority('project:alpha')),
    adapter.put('projects', { id: 'beta', marker: 'B' }, authority('project:beta')),
  ]);

  // Then: neither cross-scope record blocks or overwrites the other.
  assert.equal((await adapter.get('projects', 'alpha')).marker, 'A');
  assert.equal((await adapter.get('projects', 'beta')).marker, 'B');
});
