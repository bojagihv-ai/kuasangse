const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const GATEWAY = path.join(ROOT, 'src/modules/workspace-persistence.mjs');
const INDEXED_DB = path.join(ROOT, 'src/modules/persistence/indexeddb-adapter.mjs');
const FENCING = path.join(ROOT, 'src/modules/persistence/fencing.mjs');

async function loadGateway() {
  return import(`${pathToFileURL(GATEWAY).href}?mutations=${Date.now()}-${Math.random()}`);
}

async function loadModule(file, label) {
  return import(`${pathToFileURL(file).href}?${label}=${Date.now()}-${Math.random()}`);
}

function mutationAdapters(effects) {
  return {
    session: {
      setItem: async () => effects.push('recovery-set'),
      removeItem: async () => effects.push('recovery-remove'),
    },
    indexeddb: {
      put: async store => effects.push(`${store}-put`),
      delete: async store => effects.push(`${store}-delete`),
      putSessionAssets: async () => effects.push('sessionAssets-put'),
    },
    archive: { writeHandle: async () => effects.push('archive-file') },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function editableAuthority(initial) {
  let current = initial;
  let queue = Promise.resolve();
  return {
    snapshot: () => current,
    replace: next => { current = next; },
    runMutation(operation) {
      const running = queue.then(operation);
      queue = running.catch(() => undefined);
      return running;
    },
  };
}

test('Given readonly authority When every direct facade mutation is called Then no storage changes', async () => {
  // Given: a project is visible but this window owns no editing lease.
  const { createGuardedWorkspaceMutations } = await loadGateway();
  assert.equal(typeof createGuardedWorkspaceMutations, 'function');
  const effects = [];
  let runMutationCalls = 0;
  const authority = {
    snapshot: () => ({
      scopeId: 'project:alpha', leaseId: 'lease-b', fencingToken: 2,
      revision: 4, mode: 'readonly', reasonCode: 'LEASE_HELD',
    }),
    runMutation(operation) {
      runMutationCalls += 1;
      return Promise.resolve().then(operation);
    },
  };
  const mutations = createGuardedWorkspaceMutations({
    adapters: mutationAdapters(effects), authority,
  });
  const calls = [
    () => mutations.writeRecoveryValue('pdp_last_work_bootstrap_v1', '{}'),
    () => mutations.clearRecoveryValue('pdp_last_work_bootstrap_v1'),
    () => mutations.updateProject({ id: 'alpha', workspaceScope: { id: 'project:alpha' } }),
    () => mutations.removeProject('alpha'),
    () => mutations.saveSnapshot({ id: 'snapshot-a', projectId: 'alpha' }),
    () => mutations.removeSnapshot('snapshot-a', 'project:alpha'),
    () => mutations.saveSessionAssets('project:alpha', { savedAt: 1 }),
    () => mutations.clearSessionAssets('project:alpha'),
    () => mutations.saveArchiveFile({ createWritable() {} }, 'value', 'project:alpha'),
  ];

  // When: autosave, lifecycle, and command paths attempt each mutation facade.
  for (const call of calls) {
    await assert.rejects(call, error => ['READ_ONLY', 'STALE_FENCE'].includes(error?.code));
  }

  // Then: every attempt passed through the coordinator queue and none reached an adapter.
  assert.equal(runMutationCalls, calls.length);
  assert.deepEqual(effects, []);
});

test('Given the browser facade source When scanned Then no unguarded adapter mutation is exported', () => {
  // Given: the public persistence facade and classic lifecycle callers.
  const gateway = fs.readFileSync(GATEWAY, 'utf8');
  const lifecycle = ['src/app-core-02.js', 'src/app-core-06.js']
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');

  // When/Then: every workspace write is routed through the guarded mutation facade or commit.
  assert.match(gateway, /createGuardedWorkspaceMutations/);
  assert.match(gateway, /\.\.\.guardedMutations/);
  assert.doesNotMatch(gateway, /writeRecoveryValue:\s*\([^)]*\)\s*=>\s*adapters\.session\.setItem/);
  assert.doesNotMatch(gateway, /(?:updateProject|saveSnapshot):\s*[^\n]*adapters\.indexeddb\.put/);
  assert.doesNotMatch(gateway, /(?:removeProject|removeSnapshot|clearSessionAssets):\s*[^\n]*adapters\.indexeddb\.delete/);
  assert.doesNotMatch(gateway, /saveSessionAssets:\s*[^\n]*adapters\.indexeddb\.putSessionAssets/);
  assert.doesNotMatch(gateway, /saveArchiveFile:\s*[^\n]*adapters\.archive\.writeHandle/);
  assert.match(lifecycle, /saveSessionAssetsToDbIfChanged/);
  assert.doesNotMatch(lifecycle, /__KUASANGSE_WORKSPACE_PERSISTENCE__\.(?:adapters|indexeddb|session|archive)/);
});

test('Given a global preference clear is queued during a scope transition Then destination CAS remains eligible', async () => {
  // Given: an alpha-scoped recovery write occupies the coordinator queue and a global clear waits behind it.
  const { createGuardedWorkspaceMutations } = await loadGateway();
  const started = deferred();
  const resume = deferred();
  const preferences = new Map([['lastProductImageBackup', { id: 'lastProductImageBackup' }]]);
  const state = {
    scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 1, revision: 0, mode: 'editing',
  };
  const authority = editableAuthority(state);
  const mutations = createGuardedWorkspaceMutations({
    authority,
    adapters: {
      session: {
        async setItem(_key, _value, context) {
          context.assertAuthority();
          started.resolve();
          await resume.promise;
          context.assertCompletion();
        },
        async removeItem() {},
      },
      indexeddb: {
        async put(_store, value, context) {
          context.assertAuthority();
          preferences.set(value.id, value);
          context.assertCompletion();
        },
        async delete(_store, id, context) {
          assert.equal(context.scopeId, 'app-global');
          context.assertAuthority();
          preferences.delete(id);
          context.assertCompletion();
        },
        async putSessionAssets() {},
      },
      archive: { async writeHandle() {} },
    },
  });
  const staleRecovery = mutations.writeRecoveryValue('pdp_last_work_bootstrap_v1', 'draft:next');
  await started.promise;
  const pendingClear = mutations.clearPreference('lastProductImageBackup');

  // When: the visible workspace rotates before the queued writes resume.
  authority.replace({
    scopeId: 'draft:next', leaseId: '', fencingToken: 0, revision: 0, mode: 'offline-edit',
  });
  resume.resolve();

  // Then: the old workspace write rejects, while the app-global clear is not tied to alpha's claim.
  await assert.rejects(staleRecovery, error => error?.code === 'STALE_SCOPE');
  await pendingClear;
  assert.equal(preferences.has('lastProductImageBackup'), false);
});

test('Given idle startup authority When draft scope is created Then the per-tab pointer writes as app-global', async () => {
  // Given: startup has not acquired a workspace yet, so there is no active scope to fence against.
  const { createGuardedWorkspaceMutations } = await loadGateway();
  const writes = [];
  const authority = editableAuthority({ scopeId: '', leaseId: '', fencingToken: 0, revision: 0, mode: 'idle' });
  const mutations = createGuardedWorkspaceMutations({
    authority,
    adapters: {
      session: {
        async setItem(key, value, context) {
          writes.push({ key, value, scopeId: context.scopeId });
        },
        async removeItem() {},
      },
      indexeddb: { async put() {}, async delete() {}, async putSessionAssets() {} },
      archive: { async writeHandle() {} },
    },
  });

  // When: the first blank draft scope is persisted before workspace acquisition.
  await mutations.writeRecoveryValue('pdp_last_work_draft_scope_v1', 'draft:new-tab');

  // Then: persistence does not require a nonexistent active workspace authority.
  assert.deepEqual(writes, [{
    key: 'pdp_last_work_draft_scope_v1', value: 'draft:new-tab', scopeId: 'app-global',
  }]);
});

for (const destination of ['recovery', 'projects', 'snapshots', 'sessionAssets']) {
  test(`Given A paused inside ${destination} helper When B commits Then stale A cannot publish`, async () => {
    // Given: direct A and B facades share one physical replica with a controllable pre-publish pause.
    const { createGuardedWorkspaceMutations } = await loadGateway();
    assert.equal(typeof createGuardedWorkspaceMutations, 'function');
    const started = deferred();
    const resume = deferred();
    const records = new Map();
    const publish = async (key, value, context = {}) => {
      context.assertAuthority?.();
      if (value?.marker === 'A' || value === 'A') {
        started.resolve();
        await resume.promise;
      }
      context.assertCompletion?.();
      records.set(key, structuredClone(value));
      return value;
    };
    const adapters = {
      session: {
        setItem: (key, value, context) => publish(`recovery:${key}`, value, context),
        removeItem: async () => undefined,
      },
      indexeddb: {
        put: (store, value, context) => publish(`${store}:${value.id}`, value, context),
        delete: async () => undefined,
        putSessionAssets: (scope, value, context) => publish(`sessionAssets:${scope}`, value, context),
      },
      archive: { writeHandle: async () => undefined },
    };
    const stateA = {
      scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 1, revision: 0, mode: 'editing',
    };
    const authorityA = editableAuthority(stateA);
    const mutationsA = createGuardedWorkspaceMutations({ adapters, authority: authorityA });
    const calls = {
      recovery: mutations => mutations.writeRecoveryValue('pdp_last_work_bootstrap_v1', mutations === mutationsA ? 'A' : 'B'),
      projects: mutations => mutations.updateProject({ id: 'alpha', marker: mutations === mutationsA ? 'A' : 'B' }),
      snapshots: mutations => mutations.saveSnapshot({ id: 'snapshot-a', projectId: 'alpha', marker: mutations === mutationsA ? 'A' : 'B' }),
      sessionAssets: mutations => mutations.saveSessionAssets('project:alpha', { marker: mutations === mutationsA ? 'A' : 'B' }),
    };
    const pendingA = calls[destination](mutationsA);
    await started.promise;

    // When: B owns fence 2 and publishes before A resumes.
    authorityA.replace({ ...stateA, leaseId: 'lease-b', fencingToken: 2, revision: 1, mode: 'readonly' });
    const stateB = { ...stateA, leaseId: 'lease-b', fencingToken: 2, revision: 1, mode: 'editing' };
    const mutationsB = createGuardedWorkspaceMutations({ adapters, authority: editableAuthority(stateB) });
    await calls[destination](mutationsB);
    resume.resolve();

    // Then: A reports stale authority and B remains the final replica value.
    await assert.rejects(pendingA, error => ['READ_ONLY', 'STALE_FENCE'].includes(error?.code));
    const finalValue = [...records.values()].at(-1);
    assert.equal(typeof finalValue === 'string' ? finalValue : finalValue.marker, 'B');
  });
}

test('Given alpha preference A pauses When beta writes the same global key Then stale A cannot replace B', async () => {
  // Given: A starts from alpha and pauses at the physical shared-key publish boundary.
  const { createGuardedWorkspaceMutations } = await loadGateway();
  const { createIndexedDbPersistenceAdapter } = await loadModule(INDEXED_DB, 'shared-idb');
  const { assertReplicaCanPublish } = await loadModule(FENCING, 'shared-fence');
  const started = deferred();
  const resume = deferred();
  const records = new Map();
  const recordKey = (store, id) => `${store}:${id}`;
  const driver = {
    async get(store, id) { return records.get(recordKey(store, id)) || null; },
    async getAll() { return []; },
    async delete(store, id) { records.delete(recordKey(store, id)); },
    async put(store, value) { records.set(recordKey(store, value.id), structuredClone(value)); },
    async compareAndPut(store, value, guard) {
      if (value.marker === 'A') {
        started.resolve();
        await resume.promise;
      }
      const key = recordKey(store, value.id);
      const current = records.get(key);
      const currentVersion = Number(current?.persistenceDestination?.version) || 0;
      if (guard.expectedDestinationVersion !== undefined
        && currentVersion !== guard.expectedDestinationVersion) {
        const error = new Error('stale shared destination');
        error.code = 'STALE_REPLICA';
        throw error;
      }
      assertReplicaCanPublish(current, guard.envelope || guard);
      records.set(key, structuredClone(value));
    },
  };
  const adapters = {
    session: { setItem() {}, removeItem() {} },
    indexeddb: createIndexedDbPersistenceAdapter({ driver }),
    archive: { writeHandle() {} },
  };
  const stateA = {
    scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 1, revision: 0, mode: 'editing',
  };
  const authorityA = editableAuthority(stateA);
  const mutationsA = createGuardedWorkspaceMutations({ adapters, authority: authorityA });
  const pendingA = mutationsA.savePreference({ id: 'global-pref', marker: 'A' });
  await started.promise;

  // When: alpha loses its scope and beta publishes B to the same global preference key.
  authorityA.replace({
    scopeId: 'project:beta', leaseId: 'lease-b', fencingToken: 1, revision: 0, mode: 'readonly',
  });
  const authorityB = editableAuthority({
    scopeId: 'project:beta', leaseId: 'lease-b', fencingToken: 1, revision: 0, mode: 'editing',
  });
  const mutationsB = createGuardedWorkspaceMutations({ adapters, authority: authorityB });
  await mutationsB.savePreference({ id: 'global-pref', marker: 'B' });
  resume.resolve();

  // Then: A reports STALE_SCOPE and the final physical IDB record remains B.
  await assert.rejects(
    pendingA, error => ['STALE_SCOPE', 'STALE_REPLICA'].includes(error?.code),
  );
  assert.equal(records.get('appSettings:global-pref').marker, 'B');
});
