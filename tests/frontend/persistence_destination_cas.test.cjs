const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULES = path.resolve(__dirname, '../../src/modules/persistence');

function envelope(value, fencingToken, revision) {
  return {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha',
    savedAt: revision, digest: `digest-${value}`,
    metadata: {
      operationId: `operation-${value}`,
      leaseId: `lease-${value.toLowerCase()}`,
      fencingToken: String(fencingToken),
      revision: { scopeId: 'project:alpha', counter: revision, updatedAt: revision, writerId: value },
    },
    snapshot: { value },
  };
}

async function load(name) {
  const url = pathToFileURL(path.join(MODULES, name)).href;
  return import(`${url}?cas=${Date.now()}-${Math.random()}`);
}

test('Given an option assignment patch When stored Then the classified recovery key remains readable in the same work scope', async () => {
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const authority = {
    snapshot: () => ({
      scopeId: 'project:alpha',
      leaseId: 'lease-alpha',
      fencingToken: 7,
      revision: 41,
    }),
  };
  const adapter = createSessionStorageAdapter({ storage, authority });
  const value = JSON.stringify({
    workspaceScope: 'project:alpha',
    savedAt: 42,
    optionSorter: { pool: [], slots: [{ id: 'slot-1', imgIds: ['red'] }] },
  });

  adapter.setItem('pdp_option_sorter_live_v1', value, {
    persistenceAuthority: authority.snapshot(),
    assertAuthority() {},
    assertCompletion() {},
  });

  assert.equal(adapter.getItem('pdp_option_sorter_live_v1'), value);
});

test('Given F5 rotates the edit lease When the same tab has an option assignment patch Then the patch remains readable', async () => {
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const draftValues = new Map();
  const sharedValues = new Map();
  const storageOf = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  let authorityValue = {
    scopeId: 'project:alpha',
    leaseId: 'lease-before-f5',
    fencingToken: 7,
    revision: 41,
  };
  const authority = { snapshot: () => ({ ...authorityValue }) };
  const adapter = createSessionStorageAdapter({
    storage: storageOf(sharedValues),
    draftStorage: storageOf(draftValues),
    authority,
  });
  const value = JSON.stringify({
    workspaceScope: 'project:alpha',
    savedAt: 42,
    optionSorter: { pool: [], slots: [{ id: 'slot-1', imgIds: ['red'] }] },
  });
  adapter.setItem('pdp_option_sorter_live_v1', value, {
    persistenceAuthority: authority.snapshot(),
    assertAuthority() {},
    assertCompletion() {},
  });

  authorityValue = { ...authorityValue, leaseId: 'lease-after-f5', revision: 42 };

  assert.equal(adapter.getItem('pdp_option_sorter_live_v1'), value);
});

test('Given F5 rotates the edit fence When the same tab has required-field drafts Then size draft remains readable', async () => {
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const draftValues = new Map();
  const sharedValues = new Map();
  const storageOf = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  let authorityValue = {
    scopeId: 'project:alpha',
    leaseId: 'lease-before-f5',
    fencingToken: 7,
    revision: 41,
  };
  const authority = { snapshot: () => ({ ...authorityValue }) };
  const adapter = createSessionStorageAdapter({
    storage: storageOf(sharedValues),
    draftStorage: storageOf(draftValues),
    authority,
  });
  const value = JSON.stringify({
    workKey: 'project:alpha|run-1|모시꽃수파우치|image-1',
    drafts: { size: { value: '가로21cm*세로14cm', label: '사이즈/규격' } },
  });

  adapter.setItem('factory_wizard_field_drafts_v1', value, {
    persistenceAuthority: authority.snapshot(),
    assertAuthority() {},
    assertCompletion() {},
  });

  authorityValue = { ...authorityValue, leaseId: 'lease-after-f5', revision: 42 };

  assert.equal(adapter.getItem('factory_wizard_field_drafts_v1'), value);
  assert.equal(sharedValues.size, 0, '필수값 초안도 공유 localStorage로 새지 않아야 한다');
});

test('Given an old same-tab required-field draft When F5 rotates the fence and the draft is rewritten Then the new draft replaces the old one', async () => {
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const draftValues = new Map();
  const storageOf = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  let authorityValue = {
    scopeId: 'project:alpha',
    leaseId: 'lease-before-f5',
    fencingToken: 7,
    revision: 41,
  };
  const authority = { snapshot: () => ({ ...authorityValue }) };
  const adapter = createSessionStorageAdapter({
    storage: storageOf(new Map()),
    draftStorage: storageOf(draftValues),
    authority,
  });
  const context = () => ({
    persistenceAuthority: authority.snapshot(),
    assertAuthority() {},
    assertCompletion() {},
  });
  adapter.setItem('factory_wizard_field_drafts_v1', JSON.stringify({
    workKey: 'project:alpha|run-1|모시꽃수파우치|image-1',
    drafts: { size: { value: '가로21cm*세로14cm' } },
  }), context());

  authorityValue = { ...authorityValue, leaseId: 'lease-after-f5', revision: 42 };
  const replacement = JSON.stringify({
    workKey: 'project:alpha|run-1|모시꽃수파우치|image-1',
    drafts: { size: { value: '가로22cm*세로15cm' } },
  });

  adapter.setItem('factory_wizard_field_drafts_v1', replacement, context());

  assert.equal(JSON.parse(adapter.getItem('factory_wizard_field_drafts_v1')).drafts.size.value, '가로22cm*세로15cm');
});

test('Given import session replica When published Then session and bootstrap share the accepted scope and revision', async () => {
  // Given: an accepted import envelope whose snapshot names the current workfile.
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const adapter = createSessionStorageAdapter({ storage });
  const accepted = envelope('IMPORT', 7, 41);
  accepted.snapshot = {
    value: 'IMPORT',
    currentProjectId: 'alpha',
    currentProjectName: '수저집',
    currentProjectCreatedAt: 1710000000000,
    step: 'factory',
  };

  // When: import requests the reload pointer in the same session adapter write.
  await adapter.write(accepted, {
    writeBootstrap: true,
    recoverySnapshot: { ...accepted.snapshot, value: 'LOCAL-RECOVERY' },
    assertAuthority() {},
    assertCompletion() {},
  });

  // Then: both local keys identify exactly the accepted scope/revision.
  const session = JSON.parse(values.get('pdp_session'));
  const bootstrapRecord = JSON.parse(values.get('pdp_last_work_bootstrap_v1'));
  const bootstrap = JSON.parse(bootstrapRecord.value);
  assert.equal(session.persistenceEnvelope.scopeId, 'project:alpha');
  assert.equal(session.persistenceEnvelope.metadata.revision.counter, 41);
  assert.equal(session.value, 'LOCAL-RECOVERY');
  assert.equal(session.persistenceEnvelope.snapshot.value, 'LOCAL-RECOVERY');
  assert.notEqual(session.persistenceEnvelope.digest, accepted.digest);
  assert.equal(bootstrap.workspaceScope.id, 'project:alpha');
  assert.equal(bootstrap.workspaceRevision.counter, 41);
  assert.equal(bootstrap.currentProjectId, 'alpha');
  assert.equal(bootstrap.currentProjectName, '수저집');
});

test('Given an F5 starts with draft authority When this tab has a project bootstrap Then the project identity is still readable', async () => {
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const bootstrap = JSON.stringify({
    workspaceScope: { id: 'project:alpha' },
    currentProjectId: 'alpha',
    currentProjectName: '모시바둑파우치',
    step: 'factory',
  });
  const recovery = JSON.stringify({
    schema: 'kuasangse.recovery.v1',
    value: bootstrap,
    persistenceAuthority: {
      scopeId: 'project:alpha',
      leaseId: 'project-lease',
      fencingToken: 9,
      revision: 41,
    },
  });
  const values = new Map([['pdp_last_work_bootstrap_v1', recovery]]);
  const draftStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const sharedStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  const authority = {
    snapshot: () => ({
      scopeId: 'draft:f5-startup',
      leaseId: 'draft-lease',
      fencingToken: 1,
      revision: 0,
    }),
  };
  const adapter = createSessionStorageAdapter({
    storage: sharedStorage,
    draftStorage,
    authority,
  });

  assert.equal(
    adapter.getItem('pdp_last_work_bootstrap_v1'),
    bootstrap,
    'F5 discarded this tab project bootstrap because startup still held temporary draft authority',
  );

  const sharedValues = new Map([['pdp_last_work_bootstrap_v1', recovery]]);
  const sharedOnlyAdapter = createSessionStorageAdapter({
    storage: {
      getItem: key => sharedValues.get(key) ?? null,
      setItem: (key, value) => sharedValues.set(key, String(value)),
      removeItem: key => sharedValues.delete(key),
    },
    draftStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    authority,
  });
  assert.equal(
    sharedOnlyAdapter.getItem('pdp_last_work_bootstrap_v1'),
    null,
    'another tab shared bootstrap bypassed the draft authority guard',
  );
});

test('Given bootstrap key publish fails When import session replica writes Then both local keys roll back', async () => {
  // Given: old session/bootstrap values and a fault injected on the second physical key.
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const oldSession = JSON.stringify({ persistenceEnvelope: envelope('OLD', 6, 40) });
  const oldBootstrap = JSON.stringify({ schema: 'kuasangse.recovery.v1', value: '{"old":true}' });
  const values = new Map([
    ['pdp_session', oldSession],
    ['pdp_last_work_bootstrap_v1', oldBootstrap],
  ]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === 'pdp_last_work_bootstrap_v1') throw new Error('injected bootstrap write failure');
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
  };
  const adapter = createSessionStorageAdapter({ storage });

  // When: the new import publishes session first and the bootstrap write fails.
  await assert.rejects(
    adapter.write(envelope('IMPORT', 7, 41), {
      writeBootstrap: true,
      assertAuthority() {},
      assertCompletion() {},
    }),
    /injected bootstrap write failure/,
  );

  // Then: no half-imported local recovery state remains.
  assert.equal(values.get('pdp_session'), oldSession);
  assert.equal(values.get('pdp_last_work_bootstrap_v1'), oldBootstrap);
});

test('Given local recovery already contains B When stale A writes Then one-key CAS preserves B', async () => {
  // Given: the local session key contains B with a higher fence and revision.
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const values = new Map([['pdp_session', JSON.stringify({ persistenceEnvelope: envelope('B', 2, 2) })]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const adapter = createSessionStorageAdapter({ storage });

  // When: stale A reaches the physical localStorage publish boundary.
  await assert.rejects(
    adapter.write(envelope('A', 1, 1), { assertAuthority() {} }),
    error => ['STALE_FENCE', 'STALE_REVISION', 'STALE_REPLICA'].includes(error?.code),
  );

  // Then: B remains the only accepted local recovery envelope.
  const stored = JSON.parse(values.get('pdp_session'));
  assert.equal(stored.persistenceEnvelope.snapshot.value, 'B');
});

test('Given authority advanced to B When local recovery is still A Then stale recovery is not loaded', async () => {
  // Given: local recovery was written by A before B took over the same scope.
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const stale = {
    schema: 'kuasangse.recovery.v1',
    value: 'stale-a',
    persistenceAuthority: {
      scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 1, revision: 1,
    },
  };
  const values = new Map([['factory_last_snapshot_v1', JSON.stringify(stale)]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const authority = {
    snapshot: () => ({
      scopeId: 'project:alpha', leaseId: 'lease-b', fencingToken: 2, revision: 2, mode: 'editing',
    }),
  };
  const adapter = createSessionStorageAdapter({ storage, authority });

  // When: bootstrap recovery reads the one-key replica after takeover.
  const restored = adapter.getItem('factory_last_snapshot_v1');

  // Then: A's stale payload is never accepted as B's current workspace state.
  assert.equal(restored, null);
});

test('Given multiple browser tabs When draft pointers are stored Then each tab has an independent scope', async () => {
  // Given: durable recovery is shared, while each browser tab has its own session storage.
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const sharedValues = new Map();
  const tabValues = new Map();
  const makeStorage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  const adapter = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabValues),
  });
  const context = {
    persistenceAuthority: { scopeId: 'app-global', leaseId: '', fencingToken: 0, revision: 0 },
    assertAuthority() {},
    assertCompletion() {},
  };

  // When: this tab records its current blank draft pointer.
  adapter.setItem('pdp_last_work_draft_scope_v1', 'draft:tab-a', context);

  // Then: the pointer is isolated in sessionStorage and can survive a reload of this tab only.
  assert.equal(sharedValues.has('pdp_last_work_draft_scope_v1'), false);
  assert.equal(adapter.getItem('pdp_last_work_draft_scope_v1'), 'draft:tab-a');
  assert.equal(tabValues.has('pdp_last_work_draft_scope_v1'), true);
});

test('Given two tabs edit different blank drafts When each tab reloads Then neither tab restores the other draft', async () => {
  // Given: both tabs share durable fallback storage but own independent sessionStorage.
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const sharedValues = new Map();
  const tabAValues = new Map();
  const tabBValues = new Map();
  const makeStorage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  const authorityFor = scopeId => ({
    snapshot: () => ({
      scopeId, leaseId: '', fencingToken: 0, revision: 0, mode: 'offline-edit',
    }),
  });
  const draftEnvelope = (scopeId, value, revision) => ({
    schema: 'kuasangse.workspace',
    version: 2,
    scopeId,
    savedAt: revision,
    digest: `digest-${scopeId}-${value}`,
    metadata: {
      operationId: `operation-${scopeId}-${revision}`,
      leaseId: '',
      fencingToken: '0',
      revision: { scopeId, counter: revision, updatedAt: revision, writerId: value },
    },
    snapshot: {
      currentProjectId: '',
      currentProjectName: value,
      productName: value,
      step: 'factory',
    },
  });
  const adapterA = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabAValues),
    authority: authorityFor('draft:tab-a'),
  });
  const adapterB = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabBValues),
    authority: authorityFor('draft:tab-b'),
  });
  const context = {
    writeBootstrap: true,
    assertAuthority() {},
    assertCompletion() {},
  };

  // When: A saves first and B later replaces the shared last-work fallback.
  await adapterA.write(draftEnvelope('draft:tab-a', '새상품A', 1), context);
  await adapterB.write(draftEnvelope('draft:tab-b', '방울수저집', 1), context);

  // Then: reloading A must recover A from its tab, while B still recovers B.
  const restoredA = await adapterA.read('draft:tab-a');
  const restoredB = await adapterB.read('draft:tab-b');
  assert.equal(restoredA?.snapshot?.productName, '새상품A');
  assert.equal(restoredB?.snapshot?.productName, '방울수저집');
  assert.equal(
    JSON.parse(adapterA.getItem('pdp_last_work_bootstrap_v1')).currentProjectName,
    '새상품A',
  );
  assert.equal(
    JSON.parse(adapterB.getItem('pdp_last_work_bootstrap_v1')).currentProjectName,
    '방울수저집',
  );
});

test('Given two tabs open the same saved document When each tab autosaves Then F5 restores only that tab branch', async () => {
  const { createSessionStorageAdapter } = await load('session-storage-adapter.mjs');
  const sharedValues = new Map();
  const tabAValues = new Map();
  const tabBValues = new Map();
  const makeStorage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  const authorityFor = scopeId => ({
    snapshot: () => ({
      scopeId, leaseId: '', fencingToken: 0, revision: 0, mode: 'offline-edit',
    }),
  });
  const documentBranchEnvelope = (scopeId, branchId, productName, revision) => ({
    schema: 'kuasangse.workspace',
    version: 2,
    scopeId,
    savedAt: revision,
    digest: `digest-${scopeId}-${productName}`,
    metadata: {
      operationId: `operation-${branchId}-${revision}`,
      leaseId: '',
      fencingToken: '0',
      revision: { scopeId, counter: revision, updatedAt: revision, writerId: branchId },
    },
    snapshot: {
      currentProjectId: 'shared-document',
      currentProjectName: '같은문서',
      productName,
      workspaceScope: { id: scopeId },
      workspaceBranch: {
        schema: 'kuasangse.work-branch.v1',
        branchId,
        scopeId,
        documentId: 'shared-document',
        documentScopeId: 'project:shared-document',
        createdAt: 1,
      },
    },
  });
  const adapterA = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabAValues),
    authority: authorityFor('draft:tab-a'),
  });
  const adapterB = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabBValues),
    authority: authorityFor('draft:tab-b'),
  });
  const context = { writeBootstrap: true, assertAuthority() {}, assertCompletion() {} };

  await adapterA.write(documentBranchEnvelope('draft:tab-a', 'tab-a', '같은문서-A편집', 1), context);
  await adapterB.write(documentBranchEnvelope('draft:tab-b', 'tab-b', '같은문서-B편집', 1), context);

  assert.equal((await adapterA.read('draft:tab-a'))?.snapshot?.productName, '같은문서-A편집');
  assert.equal((await adapterB.read('draft:tab-b'))?.snapshot?.productName, '같은문서-B편집');
  assert.equal(JSON.parse(adapterA.getItem('pdp_last_work_bootstrap_v1')).workspaceScope.id, 'draft:tab-a');
  assert.equal(JSON.parse(adapterB.getItem('pdp_last_work_bootstrap_v1')).workspaceScope.id, 'draft:tab-b');
  assert.equal(sharedValues.size, 0);
});

test('Given a browser tab owns an active work When recovery keys are written Then shared localStorage remains physically empty', async () => {
  const { createSessionStorageAdapter, WORKSPACE_SESSION_KEYS } = await load('session-storage-adapter.mjs');
  const sharedValues = new Map();
  const tabValues = new Map();
  const makeStorage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  const authority = {
    snapshot: () => ({
      scopeId: 'project:alpha', leaseId: 'lease-tab-alpha', fencingToken: 7, revision: 41, mode: 'editing',
    }),
  };
  const adapter = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabValues),
    authority,
  });
  const context = {
    persistenceAuthority: authority.snapshot(),
    assertAuthority() {},
    assertCompletion() {},
  };

  for (const key of WORKSPACE_SESSION_KEYS) {
    adapter.setItem(key, JSON.stringify({ key, owner: 'tab-alpha' }), context);
  }
  await adapter.write(envelope('TAB-ALPHA', 7, 41), {
    ...context,
    writeBootstrap: true,
    recoverySnapshot: {
      currentProjectId: 'alpha',
      currentProjectName: '양단호박바늘쌈',
      productName: '양단호박바늘쌈',
      step: 'factory',
    },
  });

  assert.deepEqual(
    [...sharedValues.keys()],
    [],
    'active work recovery leaked into cross-tab localStorage',
  );
  assert.ok(tabValues.has('pdp_session'));
  assert.ok(tabValues.has('pdp_last_work_bootstrap_v1'));
  for (const key of WORKSPACE_SESSION_KEYS) assert.ok(tabValues.has(key), `${key} was not stored in this tab`);
});

test('Given another tab has no active work When a sibling tab saved recovery Then no active key is readable', async () => {
  const { createSessionStorageAdapter, WORKSPACE_SESSION_KEYS } = await load('session-storage-adapter.mjs');
  const sharedValues = new Map();
  const tabAValues = new Map();
  const tabBValues = new Map();
  const makeStorage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  const adapterA = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabAValues),
  });
  const adapterB = createSessionStorageAdapter({
    storage: makeStorage(sharedValues),
    draftStorage: makeStorage(tabBValues),
  });
  const context = {
    persistenceAuthority: {},
    assertAuthority() {},
    assertCompletion() {},
  };

  for (const key of WORKSPACE_SESSION_KEYS) adapterA.setItem(key, `tab-a:${key}`, context);

  for (const key of WORKSPACE_SESSION_KEYS) {
    assert.equal(adapterB.getItem(key), null, `${key} crossed the physical tab boundary`);
  }
  assert.equal(sharedValues.size, 0);
});

test('Given IndexedDB already contains B When stale A transaction runs Then atomic compare-and-put preserves B', async () => {
  // Given: a driver exposing an atomic compare-and-put transaction and a newer B envelope.
  const { createIndexedDbPersistenceAdapter } = await load('indexeddb-adapter.mjs');
  const records = new Map([['sessionAssets:workspace-envelope:project:alpha', {
    id: 'workspace-envelope:project:alpha', scopeId: 'project:alpha',
    workspaceEnvelope: envelope('B', 2, 2),
  }]]);
  const key = (store, id) => `${store}:${id}`;
  const driver = {
    async get(store, id) { return records.get(key(store, id)) || null; },
    async getAll() { return []; },
    async delete(store, id) { records.delete(key(store, id)); },
    async put(store, value) { records.set(key(store, value.id), structuredClone(value)); },
    async putMany(entries) {
      for (const entry of entries) records.set(key(entry.storeName, entry.value.id), structuredClone(entry.value));
    },
    async compareAndPutMany(entries, guard) {
      const current = records.get(key(guard.storeName, guard.key))?.workspaceEnvelope || null;
      const candidate = guard.envelope;
      if (current && Number(current.metadata.fencingToken) > Number(candidate.metadata.fencingToken)) {
        const error = new Error('stale indexeddb fence');
        error.code = 'STALE_FENCE';
        throw error;
      }
      for (const entry of entries) records.set(key(entry.storeName, entry.value.id), structuredClone(entry.value));
    },
  };
  const adapter = createIndexedDbPersistenceAdapter({ driver });

  // When: stale A attempts the authoritative multi-store transaction.
  await assert.rejects(
    adapter.write(envelope('A', 1, 1), { assertAuthority() {} }),
    error => ['STALE_FENCE', 'STALE_REVISION', 'STALE_REPLICA'].includes(error?.code),
  );

  // Then: the authoritative workspace envelope is still B.
  assert.equal(
    records.get('sessionAssets:workspace-envelope:project:alpha').workspaceEnvelope.snapshot.value,
    'B',
  );
});

test('Given an imported workfile When IndexedDB accepts it Then envelope project and scoped assets share exact accepted metadata', async () => {
  // Given: the three durable import records are published by one IndexedDB transaction.
  const { createIndexedDbPersistenceAdapter } = await load('indexeddb-adapter.mjs');
  const records = new Map();
  const key = (store, id) => `${store}:${id}`;
  let committedEntries = [];
  let legacyMigrationCalls = 0;
  const driver = {
    async get(store, id) { return structuredClone(records.get(key(store, id)) || null); },
    async getAll() { return []; },
    async put(store, value) { records.set(key(store, value.id), structuredClone(value)); },
    async delete(store, id) { records.delete(key(store, id)); },
    async compareAndPutMany(entries) {
      committedEntries = structuredClone(entries);
      for (const entry of entries) records.set(key(entry.storeName, entry.value.id), structuredClone(entry.value));
    },
    async migrateLegacySessionAssets() { legacyMigrationCalls += 1; },
  };
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const accepted = envelope('IMPORT', 7, 41);
  const project = { id: 'alpha', name: '수저집', sectionCount: 15 };
  const sessionAssets = { factory: { assets: [{ id: 'asset-1' }] }, previousImages: [{ id: 'image-1' }] };

  // When: the import commit includes its project record and scoped hydration payload.
  await adapter.write(accepted, {
    records: [{ storeName: 'projects', value: project }],
    sessionAssets,
    assertAuthority() {},
    assertCompletion() {},
  });

  // Then: startup finds the scoped record directly; legacy migration is unnecessary.
  assert.deepEqual(
    committedEntries.map(entry => `${entry.storeName}:${entry.value.id}`),
    [
      'sessionAssets:workspace-envelope:project:alpha',
      'projects:alpha',
      'sessionAssets:session-assets:project:alpha',
    ],
  );
  assert.deepEqual(records.get('projects:alpha'), project);
  const restored = await adapter.getSessionAssets('project:alpha');
  assert.equal(restored.scopeId, 'project:alpha');
  assert.equal(restored.workspaceScope.id, 'project:alpha');
  assert.deepEqual(restored.workspaceRevision, accepted.metadata.revision);
  assert.equal(restored.currentProjectId, 'alpha');
  assert.equal(restored.persistenceAuthority.scopeId, accepted.scopeId);
  assert.equal(restored.persistenceAuthority.leaseId, accepted.metadata.leaseId);
  assert.equal(restored.persistenceAuthority.fencingToken, Number(accepted.metadata.fencingToken));
  assert.equal(restored.persistenceAuthority.revision, accepted.metadata.revision.counter);
  assert.equal(restored.persistenceAuthority.operationId, accepted.metadata.operationId);
  assert.equal(restored.persistenceAuthority.digest, accepted.digest);
  assert.deepEqual(restored.factory, sessionAssets.factory);
  assert.equal(legacyMigrationCalls, 0);
});

test('Given scoped session-assets write fails When import transaction runs Then envelope project and assets all roll back', async () => {
  // Given: old accepted records and a failure injected after envelope and project are staged.
  const { createIndexedDbPersistenceAdapter } = await load('indexeddb-adapter.mjs');
  const key = (store, id) => `${store}:${id}`;
  const oldEnvelope = {
    id: 'workspace-envelope:project:alpha', scopeId: 'project:alpha',
    workspaceEnvelope: envelope('OLD', 6, 40),
  };
  const oldProject = { id: 'alpha', name: '기존 작업' };
  const oldAssets = { id: 'session-assets:project:alpha', scopeId: 'project:alpha', marker: 'old-assets' };
  const records = new Map([
    [key('sessionAssets', oldEnvelope.id), structuredClone(oldEnvelope)],
    [key('projects', oldProject.id), structuredClone(oldProject)],
    [key('sessionAssets', oldAssets.id), structuredClone(oldAssets)],
  ]);
  const driver = {
    async get(store, id) { return structuredClone(records.get(key(store, id)) || null); },
    async getAll() { return []; },
    async put(store, value) { records.set(key(store, value.id), structuredClone(value)); },
    async delete(store, id) { records.delete(key(store, id)); },
    async compareAndPutMany(entries) {
      const staged = new Map([...records].map(([id, value]) => [id, structuredClone(value)]));
      for (const entry of entries) {
        staged.set(key(entry.storeName, entry.value.id), structuredClone(entry.value));
        if (entry.value.id === 'session-assets:project:alpha') {
          throw new Error('injected scoped session-assets transaction failure');
        }
      }
      records.clear();
      for (const [id, value] of staged) records.set(id, value);
    },
  };
  const adapter = createIndexedDbPersistenceAdapter({ driver });

  // When: the final staged scoped-assets record fails.
  await assert.rejects(
    adapter.write(envelope('IMPORT', 7, 41), {
      records: [{ storeName: 'projects', value: { id: 'alpha', name: '새 작업' } }],
      sessionAssets: { marker: 'new-assets' },
      assertAuthority() {},
      assertCompletion() {},
    }),
    /injected scoped session-assets transaction failure/,
  );

  // Then: no half-imported record crosses the transaction boundary.
  assert.deepEqual(records.get(key('sessionAssets', oldEnvelope.id)), oldEnvelope);
  assert.deepEqual(records.get(key('projects', oldProject.id)), oldProject);
  assert.deepEqual(records.get(key('sessionAssets', oldAssets.id)), oldAssets);
});

test('worker server adapter includes the configured detail backend in its default targets', async () => {
  const { createServerLastWorkAdapter } = await load('server-last-work-adapter.mjs');
  const requests = [];
  const adapter = createServerLastWorkAdapter({
    root: {
      location: { origin: 'http://worker.test' },
      localStorage: { getItem: key => key === 'gemini_backend_url' ? 'http://detail.test/' : null },
    },
    fetchImpl: async url => {
      requests.push(url);
      return { ok: true, async json() { return { ok: true, accepted: true, revision: 1 }; } };
    },
  });

  await adapter.write(envelope('A', 1, 1), { assertAuthority() {}, leaseId: 'lease-a', fencingToken: 1 });

  assert.match(requests[0], /^http:\/\/detail\.test\/api\/last-work/);
});

test('Given server response is delayed When local authority changes Then completion is rejected as stale', async () => {
  // Given: A has authority when the request starts and the response is held in flight.
  const { createServerLastWorkAdapter } = await load('server-last-work-adapter.mjs');
  let current = { scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 1, revision: 0, mode: 'editing' };
  let releaseResponse;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const adapter = createServerLastWorkAdapter({
    root: { location: { origin: 'http://test' } }, bases: () => ['http://test'],
    fetchImpl: async () => {
      await responseGate;
      return { ok: true, async json() { return { ok: true, accepted: true, revision: 1 }; } };
    },
  });
  const assertAuthority = () => {
    if (current.leaseId !== 'lease-a' || current.fencingToken !== 1 || current.mode !== 'editing') {
      const error = new Error('stale server completion');
      error.code = 'STALE_FENCE';
      throw error;
    }
  };
  const pending = adapter.write(envelope('A', 1, 1), {
    assertAuthority, leaseId: 'lease-a', fencingToken: 1, expectedRevision: 0,
  });

  // When: B takes over before the successful HTTP response completes.
  current = { scopeId: 'project:alpha', leaseId: 'lease-b', fencingToken: 2, revision: 1, mode: 'readonly' };
  releaseResponse();

  // Then: the adapter does not convert the delayed response into A success.
  await assert.rejects(pending, error => error?.code === 'STALE_FENCE');
});

test('Given a server lease conflict When a fallback base exists Then the write stops after the authoritative rejection', async () => {
  // Given: the first authority endpoint rejects the stale lease and a fallback endpoint is configured.
  const { createServerLastWorkAdapter, ServerPersistenceError } = await load('server-last-work-adapter.mjs');
  const requests = [];
  const adapter = createServerLastWorkAdapter({
    root: { location: { origin: 'http://test' } },
    bases: () => ['http://authority', 'http://fallback'],
    fetchImpl: async url => {
      requests.push(url);
      return {
        ok: false,
        status: 409,
        async json() { return { code: 'WORKSPACE_REVISION_CONFLICT', error: 'stale revision' }; },
      };
    },
  });

  // When/Then: a deterministic authority rejection is not replayed against another base.
  await assert.rejects(
    adapter.write(envelope('A', 1, 1), {
      assertAuthority() {}, leaseId: 'lease-a', fencingToken: 1, expectedRevision: 0,
    }),
    error => error instanceof ServerPersistenceError && error.status === 409,
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^http:\/\/authority\/api\/last-work/);
});
