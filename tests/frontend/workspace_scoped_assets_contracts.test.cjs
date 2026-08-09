const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const ADAPTER = path.join(ROOT, 'src', 'modules', 'persistence', 'indexeddb-adapter.mjs');

async function loadAdapter() {
  assert.equal(fs.existsSync(ADAPTER), true, 'missing IndexedDB private adapter');
  return import(`${pathToFileURL(ADAPTER).href}?test=${Date.now()}-${Math.random()}`);
}

function memoryDriver() {
  const stores = new Map();
  let failNextPut = false;
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  return {
    failPut() { failNextPut = true; },
    async get(name, key) { return structuredClone(store(name).get(key) ?? null); },
    async getAll(name) { return [...store(name).values()].map(value => structuredClone(value)); },
    async put(name, value) {
      if (failNextPut) { failNextPut = false; throw new Error('put-failed'); }
      store(name).set(value.id, structuredClone(value));
    },
    async delete(name, key) { store(name).delete(key); },
    async putMany(entries) { for (const entry of entries) await this.put(entry.storeName, entry.value); },
    async compareAndPut(name, value) { return this.put(name, value); },
    async compareAndDelete(name, key) { return this.delete(name, key); },
    async compareAndPutMany(entries) { return this.putMany(entries); },
    async migrateLegacySessionAssets(scopeId, targetValue) {
      const existing = await this.get('sessionAssets', targetValue.id);
      if (existing) return { migrated: false, reason: 'scoped-record-exists', record: existing };
      const legacy = await this.get('sessionAssets', 'current');
      const legacyScope = legacy?.workspaceScope?.id
        || (legacy?.currentProjectId ? `project:${legacy.currentProjectId}` : '');
      if (!legacy || legacyScope !== scopeId) return { migrated: false, reason: 'identity-mismatch' };
      await this.put('sessionAssets', targetValue);
      await this.delete('sessionAssets', 'current');
      return { migrated: true, record: targetValue };
    },
    raw(name, key) { return store(name).get(key); },
  };
}

test('two logical projects retain distinct physical session asset records', async () => {
  const { createIndexedDbPersistenceAdapter, scopedSessionAssetId } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });

  await adapter.putSessionAssets('alpha', { imageBase64: 'alpha-image' });
  await adapter.putSessionAssets('beta', { imageBase64: 'beta-image' });

  assert.notEqual(scopedSessionAssetId('alpha'), scopedSessionAssetId('beta'));
  assert.equal((await adapter.getSessionAssets('alpha')).imageBase64, 'alpha-image');
  assert.equal((await adapter.getSessionAssets('beta')).imageBase64, 'beta-image');
});

test('draft session assets retain the saved document they branched from', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const workspaceBranch = {
    schema: 'kuasangse.work-branch.v1',
    branchId: 'tab-a',
    scopeId: 'draft:tab-a',
    documentId: 'alpha',
    documentScopeId: 'project:alpha',
    createdAt: 0,
  };

  await adapter.putSessionAssets('draft:tab-a', {
    currentProjectId: 'alpha',
    workspaceBranch,
    imageBase64: 'branch-image',
  });

  const stored = await adapter.getSessionAssets('draft:tab-a');
  assert.equal(stored.scopeId, 'draft:tab-a');
  assert.equal(stored.currentProjectId, 'alpha');
  assert.deepEqual(stored.workspaceBranch, workspaceBranch);
});

test('authoritative draft commit retains its document binding and rejects a conflicting one', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const workspaceBranch = {
    schema: 'kuasangse.work-branch.v1',
    branchId: 'tab-a',
    scopeId: 'draft:tab-a',
    documentId: 'alpha',
    documentScopeId: 'project:alpha',
    createdAt: 0,
  };
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'draft:tab-a', savedAt: 123,
    digest: 'fnv1a32:draft',
    metadata: {
      operationId: 'draft-commit', fencingToken: 1, leaseId: 'draft-lease',
      revision: { scopeId: 'draft:tab-a', counter: 1, updatedAt: 123, writerId: 'tab-a' },
    },
    snapshot: { currentProjectId: 'alpha', workspaceBranch },
  };

  await adapter.write(envelope, {
    sessionAssets: { currentProjectId: 'alpha', workspaceBranch, marker: 'accepted' },
    assertAuthority() {},
    assertCompletion() {},
  });
  const stored = await adapter.getSessionAssets('draft:tab-a');
  assert.equal(stored.currentProjectId, 'alpha');
  assert.equal(stored.marker, 'accepted');

  await assert.rejects(
    adapter.putSessionAssets('draft:tab-a', {
      currentProjectId: 'beta',
      workspaceBranch,
    }),
    /document id conflicts/,
  );
});

test('offline draft authoritative IndexedDB write forwards same-revision permission only when explicitly granted', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const fencingPath = path.join(ROOT, 'src', 'modules', 'persistence', 'fencing.mjs');
  const { assertReplicaCanPublish } = await import(
    `${pathToFileURL(fencingPath).href}?offline-draft-authoritative=${Date.now()}-${Math.random()}`,
  );
  const driver = memoryDriver();
  const originalCompareAndPutMany = driver.compareAndPutMany.bind(driver);
  driver.compareAndPutMany = async (entries, guard = {}) => {
    const current = await driver.get(guard.storeName, guard.key);
    assertReplicaCanPublish(current, guard.envelope, {
      allowSameRevisionMutation: guard.allowSameRevisionMutation === true,
    });
    return originalCompareAndPutMany(entries, guard);
  };
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const scopeId = 'draft:tab-authoritative-same-revision';
  const before = {
    schema: 'kuasangse.workspace', version: 2, scopeId, savedAt: 1,
    digest: 'fnv1a32:before',
    metadata: {
      operationId: 'before', leaseId: '', fencingToken: 0,
      revision: { scopeId, counter: 11, updatedAt: 1, writerId: 'tab-a' },
    },
    snapshot: { currentProjectId: '', workspaceScope: { id: scopeId }, value: 'before' },
  };
  const after = {
    ...before,
    savedAt: 2,
    digest: 'fnv1a32:after',
    metadata: {
      ...before.metadata,
      operationId: 'after',
      revision: { ...before.metadata.revision, updatedAt: 2 },
    },
    snapshot: { ...before.snapshot, value: 'after' },
  };

  await adapter.write(before, { assertAuthority() {}, assertCompletion() {} });
  await adapter.write(after, {
    allowSameRevisionMutation: true,
    assertAuthority() {},
    assertCompletion() {},
  });

  assert.equal((await adapter.read(scopeId)).snapshot.value, 'after');
});

test('document migration reads matching old assets without deleting or rewriting the source', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  await driver.put('sessionAssets', {
    id: 'session-assets:project:alpha',
    scopeId: 'project:alpha',
    currentProjectId: 'alpha',
    marker: 'scoped-source',
  });
  await driver.put('sessionAssets', {
    id: 'current',
    currentProjectId: 'beta',
    marker: 'legacy-other-document',
  });

  const source = await adapter.getDocumentSessionAssetsForBranchMigration('project:alpha');
  assert.equal(source.marker, 'scoped-source');
  assert.equal(driver.raw('sessionAssets', 'session-assets:project:alpha').marker, 'scoped-source');
  assert.equal(driver.raw('sessionAssets', 'current').marker, 'legacy-other-document');
  assert.equal(await adapter.getDocumentSessionAssetsForBranchMigration('project:gamma'), null);
});

test('session assets unwrap nested reactive values before IndexedDB structured cloning', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const reactive = new Proxy({
    label: 'clone-safe',
    transientCallback() {},
  }, {});

  await adapter.putSessionAssets('alpha', { nested: reactive });
  assert.equal(driver.raw('sessionAssets', 'session-assets:project:alpha').nested.label, 'clone-safe');
  assert.equal(driver.raw('sessionAssets', 'session-assets:project:alpha').nested.transientCallback, undefined);

  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 123,
    digest: 'fnv1a32:clone-safe',
    metadata: {
      operationId: 'clone-safe-session-assets', fencingToken: 1,
      revision: { scopeId: 'project:alpha', counter: 1, updatedAt: 123, writerId: 'test' },
    },
    snapshot: { currentProjectId: 'alpha' },
  };
  await adapter.write(envelope, { sessionAssets: { nested: reactive } });
  const committed = driver.raw('sessionAssets', 'session-assets:project:alpha');
  assert.equal(committed.nested.label, 'clone-safe');
  assert.equal(committed.nested.transientCallback, undefined);
});

test('current lease can refine scoped session assets within its accepted revision', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const fencingPath = path.join(ROOT, 'src', 'modules', 'persistence', 'fencing.mjs');
  const { assertReplicaCanPublish } = await import(
    `${pathToFileURL(fencingPath).href}?same-revision=${Date.now()}-${Math.random()}`
  );
  const driver = memoryDriver();
  const originalCompareAndPut = driver.compareAndPut.bind(driver);
  driver.compareAndPut = async (name, value, guard = {}) => {
    const current = await driver.get(name, value.id);
    assertReplicaCanPublish(current, guard.envelope || guard, {
      allowSameRevisionMutation: guard.allowSameRevisionMutation === true,
    });
    return originalCompareAndPut(name, value, guard);
  };
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const authority = {
    scopeId: 'project:alpha', leaseId: 'live-lease', fencingToken: 8,
    revision: 12,
  };
  await driver.put('sessionAssets', {
    id: 'session-assets:project:alpha', scopeId: 'project:alpha', imageBase64: 'old-image',
    persistenceAuthority: {
      ...authority, operationId: 'accepted-operation', digest: 'accepted-digest',
    },
  });

  await adapter.putSessionAssets('project:alpha', { imageBase64: 'new-image' }, {
    persistenceAuthority: authority,
    assertAuthority: () => true,
    assertCompletion: () => true,
  });

  assert.equal((await adapter.getSessionAssets('project:alpha')).imageBase64, 'new-image');
});

test('explicit persistence authority outranks stale payload workspace revision during image refinement', async () => {
  const fencingPath = path.join(ROOT, 'src', 'modules', 'persistence', 'fencing.mjs');
  const { assertReplicaCanPublish, persistenceFence } = await import(
    `${pathToFileURL(fencingPath).href}?authority-precedence=${Date.now()}-${Math.random()}`
  );
  const authority = {
    scopeId: 'project:alpha',
    leaseId: 'live-lease',
    fencingToken: 8,
    revision: 13,
  };
  const existing = {
    scopeId: 'project:alpha',
    workspaceRevision: { scopeId: 'project:alpha', counter: 12 },
    persistenceAuthority: authority,
  };
  const candidate = {
    scopeId: 'project:alpha',
    workspaceRevision: { scopeId: 'project:alpha', counter: 11 },
    persistenceAuthority: authority,
  };

  assert.equal(persistenceFence(existing).revision, 13);
  assert.equal(persistenceFence(candidate).revision, 13);
  assert.equal(
    assertReplicaCanPublish(existing, candidate, { allowSameRevisionMutation: true }),
    'publish',
  );
});

test('새 lease는 같은 작업파일의 과거 image revision을 보완 복원하되 미래 revision은 거절한다', async () => {
  // Given: 이미지 저장본은 직전 lease에서 승인됐고 reload 중 메타데이터 revision만 한 칸 앞섰다.
  const { sessionAssetRecordMatchesAuthority } = await loadAdapter();
  const record = {
    id: 'session-assets:project:alpha', scopeId: 'project:alpha',
    persistenceAuthority: { scopeId: 'project:alpha', fencingToken: 49, revision: 46 },
  };
  const reloadedAuthority = {
    mode: 'editing', scopeId: 'project:alpha', fencingToken: 50, revision: 46,
  };

  // When/Then: 같은 scope의 같거나 과거 revision은 이미지 보완본으로 복원한다.
  assert.equal(sessionAssetRecordMatchesAuthority(record, reloadedAuthority, 'project:alpha'), true);
  assert.equal(sessionAssetRecordMatchesAuthority(
    record,
    { ...reloadedAuthority, revision: 47 },
    'project:alpha',
  ), true);

  // And: 현재 권위보다 미래이거나 다른 작업파일인 저장본은 계속 거절한다.
  assert.equal(sessionAssetRecordMatchesAuthority(
    { ...record, persistenceAuthority: { ...record.persistenceAuthority, revision: 48 } },
    { ...reloadedAuthority, revision: 47 },
    'project:alpha',
  ), false);
  assert.equal(sessionAssetRecordMatchesAuthority(
    { ...record, scopeId: 'project:beta', persistenceAuthority: { scopeId: 'project:beta', revision: 46 } },
    reloadedAuthority,
    'project:alpha',
  ), false);
});

test('F5 뒤 같은 탭 draft의 더 최신 필수값 session은 현재 authority보다 앞서도 복원한다', async () => {
  const { sessionAssetRecordMatchesAuthority } = await loadAdapter();
  const record = {
    id: 'session-assets:draft:tab-a',
    scopeId: 'draft:tab-a',
    workspaceBranch: {
      schema: 'kuasangse.work-branch.v1',
      branchId: 'tab-a',
      scopeId: 'draft:tab-a',
      documentId: 'alpha',
      documentScopeId: 'project:alpha',
      createdAt: 0,
    },
    persistenceAuthority: { scopeId: 'draft:tab-a', fencingToken: 0, revision: 48 },
  };
  const reloadedAuthority = {
    mode: 'offline-edit', scopeId: 'draft:tab-a', fencingToken: 0, revision: 47,
  };

  assert.equal(sessionAssetRecordMatchesAuthority(record, reloadedAuthority, 'draft:tab-a'), true);
  assert.equal(sessionAssetRecordMatchesAuthority(
    { ...record, scopeId: 'draft:tab-b', persistenceAuthority: { ...record.persistenceAuthority, scopeId: 'draft:tab-b' } },
    reloadedAuthority,
    'draft:tab-a',
  ), false);
});

test('legacy current migrates only when identity matches and deletes only after scoped write', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  await driver.put('sessionAssets', { id: 'current', currentProjectId: 'alpha', imageBase64: 'legacy' });

  const mismatch = await adapter.migrateLegacySessionAssets('beta');
  assert.equal(mismatch.migrated, false);
  assert.ok(driver.raw('sessionAssets', 'current'));

  const match = await adapter.migrateLegacySessionAssets('alpha');
  assert.equal(match.migrated, true);
  assert.equal((await adapter.getSessionAssets('alpha')).imageBase64, 'legacy');
  assert.equal(driver.raw('sessionAssets', 'current'), undefined);
});

test('legacy current survives a failed scoped write', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  await driver.put('sessionAssets', { id: 'current', workspaceScope: { id: 'project:alpha' }, imageBase64: 'legacy' });
  driver.failPut();

  await assert.rejects(adapter.migrateLegacySessionAssets('alpha'), /put-failed/);

  assert.ok(driver.raw('sessionAssets', 'current'));
  assert.equal(await adapter.getSessionAssets('alpha'), null);
});

test('scope normalization is exact and rejects empty project identity', async () => {
  const { normalizeProjectScope, normalizeWorkspaceScope, scopedSessionAssetId } = await loadAdapter();
  assert.equal(normalizeProjectScope(' alpha '), 'project:alpha');
  assert.equal(normalizeProjectScope('project:alpha'), 'project:alpha');
  assert.equal(normalizeProjectScope(normalizeProjectScope('alpha')), 'project:alpha');
  assert.equal(normalizeWorkspaceScope('draft:alpha'), 'draft:alpha');
  assert.equal(normalizeWorkspaceScope(normalizeWorkspaceScope('draft:alpha')), 'draft:alpha');
  assert.equal(scopedSessionAssetId('project:alpha'), 'session-assets:project:alpha');
  assert.throws(() => normalizeProjectScope(''), /project identity is required/);
  assert.throws(() => normalizeProjectScope('draft:alpha'), /draft scope is not a project identity/);
  assert.throws(() => normalizeWorkspaceScope('draft:'), /draft identity is required/);
  assert.throws(() => normalizeWorkspaceScope('project:draft:alpha'), /draft scope is not a project identity/);
});

test('real IndexedDB adapter round-trips the full v2 persistence envelope', async () => {
  const { createIndexedDbPersistenceAdapter } = await loadAdapter();
  const driver = memoryDriver();
  const adapter = createIndexedDbPersistenceAdapter({ driver });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 123,
    digest: 'fnv1a32:abcd1234',
    metadata: {
      operationId: 'operation-roundtrip',
      revision: { scopeId: 'project:alpha', counter: 7, updatedAt: 122, writerId: 'writer-a' },
      fencingToken: 'carry-only-7',
    },
    snapshot: { currentProjectId: 'alpha', currentProjectName: 'A', extensionVendor: { keep: true } },
  };

  await adapter.write(envelope);
  const restored = await adapter.read('project:alpha');

  assert.deepEqual(restored, envelope);
});

test('real server adapter round-trips the full v2 persistence envelope', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?test=${Date.now()}-${Math.random()}`);
  let stored = null;
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === 'POST') {
      stored = JSON.parse(options.body).snapshot;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ hasSnapshot: true, snapshot: structuredClone(stored) }) };
  };
  const adapter = createServerLastWorkAdapter({ fetchImpl, bases: () => ['http://local.test'] });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 321,
    digest: 'fnv1a32:1234abcd',
    metadata: {
      operationId: 'server-roundtrip',
      revision: { scopeId: 'project:alpha', counter: 8, updatedAt: 320, writerId: 'writer-b' },
      fencingToken: 'carry-only-8',
    },
    snapshot: { currentProjectId: 'alpha', productName: 'A', extensionServer: { keep: true } },
  };

  await adapter.write(envelope);
  const { persistenceEnvelope, ...legacySnapshot } = stored;
  assert.deepEqual(legacySnapshot, envelope.snapshot, 'server keeps legacy last-work fields readable');
  const { snapshot: _snapshot, ...envelopeHeader } = envelope;
  assert.deepEqual(persistenceEnvelope, { ...envelopeHeader, snapshotRef: '$' }, 'server carries a compact v2 envelope header alongside legacy fields');
  const restored = await adapter.read('project:alpha');

  assert.deepEqual(restored, envelope);
});

test('server adapter sends one physical copy of a large workspace snapshot', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?compact=${Date.now()}-${Math.random()}`);
  const uniqueImage = `data:image/webp;base64,UNIQUE-${'x'.repeat(200_000)}`;
  let stored = null;
  let postedBody = '';
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'POST') {
        postedBody = String(options.body || '');
        stored = JSON.parse(postedBody).snapshot;
        return { ok: true, json: async () => ({ accepted: true, revision: 12 }) };
      }
      return { ok: true, json: async () => ({ hasSnapshot: true, snapshot: structuredClone(stored) }) };
    },
    bases: () => ['http://local.test'],
  });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 654,
    digest: 'fnv1a32:compact',
    metadata: {
      operationId: 'server-compact',
      revision: { scopeId: 'project:alpha', counter: 12, updatedAt: 653, writerId: 'writer-c' },
      fencingToken: 'carry-only-12',
    },
    snapshot: {
      currentProjectId: 'alpha',
      productName: 'A',
      factory: { assets: [{ id: 'hero-1', image: uniqueImage }] },
    },
  };

  await adapter.write(envelope);

  const posted = JSON.parse(postedBody);
  assert.equal(posted.snapshot.persistenceEnvelope.snapshot, undefined);
  assert.equal(posted.snapshot.persistenceEnvelope.snapshotRef, '$');
  assert.equal(postedBody.indexOf(uniqueImage), postedBody.lastIndexOf(uniqueImage));
  const restored = await adapter.read('project:alpha');
  assert.deepEqual(restored, envelope);
});

test('server restore exposes the authoritative response revision to takeover hydration', async () => {
  // Given: the accepted server snapshot predates the CAS response revision field.
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?revision=${Date.now()}-${Math.random()}`);
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        hasSnapshot: true,
        revision: 9,
        savedAt: 456,
        snapshot: {
          workspaceId: 'project:alpha',
          productName: 'accepted',
        },
      }),
    }),
    bases: () => ['http://local.test'],
  });

  // When: takeover hydration reads the server replica through the public adapter.
  const restored = await adapter.read('project:alpha');

  // Then: trusted metadata carries the revision while the user snapshot remains authority-free.
  assert.deepEqual(restored.metadata.revision, {
    scopeId: 'project:alpha', counter: 9, updatedAt: 456, writerId: 'server-authority',
  });
  assert.equal(restored.snapshot.workspaceRevision, undefined);
});

test('server adapter classifies an exact richer-snapshot keep as protected no-op at the current accepted revision', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?no-op=${Date.now()}-${Math.random()}`);
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        accepted: false,
        keptExisting: true,
        protectedNoOp: true,
        reason: 'incoming snapshot has no competitor analysis result',
        scopeId: 'project:alpha',
        revision: 1,
      }),
    }),
    bases: () => ['http://local.test'],
  });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 1,
    digest: 'fnv1a32:no-op',
    metadata: {
      operationId: 'server-no-op',
      revision: { scopeId: 'project:alpha', counter: 2, updatedAt: 1, writerId: 'writer' },
      fencingToken: '2',
    },
    snapshot: { productName: 'A' },
  };

  const result = await adapter.write(envelope, { expectedRevision: 1 });
  assert.equal(result.protectedNoOp, true);
  assert.equal(result.scopeId, 'project:alpha');
  assert.equal(result.revision, 1);
});

test('server adapter classifies an exact protected-data keep as protected no-op at the current accepted revision', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?protected-no-op=${Date.now()}-${Math.random()}`);
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        accepted: false,
        keptExisting: true,
        protectedNoOp: true,
        reason: 'incoming snapshot changed work identity or dropped protected work data',
        scopeId: 'project:alpha',
        revision: 1,
      }),
    }),
    bases: () => ['http://local.test'],
  });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 1,
    digest: 'fnv1a32:protected-no-op',
    metadata: {
      operationId: 'server-protected-no-op',
      revision: { scopeId: 'project:alpha', counter: 2, updatedAt: 1, writerId: 'writer' },
      fencingToken: '2',
    },
    snapshot: { productName: 'A' },
  };

  const result = await adapter.write(envelope, { expectedRevision: 1 });
  assert.equal(result.protectedNoOp, true);
  assert.equal(result.scopeId, 'project:alpha');
  assert.equal(result.revision, 1);
});

test('server adapter classifies a required-field drop as protected no-op at the current accepted revision', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?required-field-no-op=${Date.now()}-${Math.random()}`);
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        accepted: false,
        keptExisting: true,
        protectedNoOp: true,
        reason: 'incoming snapshot dropped protected required fields',
        scopeId: 'project:alpha',
        revision: 1,
      }),
    }),
    bases: () => ['http://local.test'],
  });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 1,
    digest: 'fnv1a32:required-field-no-op',
    metadata: {
      operationId: 'server-required-field-no-op',
      revision: { scopeId: 'project:alpha', counter: 2, updatedAt: 1, writerId: 'writer' },
      fencingToken: '2',
    },
    snapshot: { productName: 'A' },
  };

  const result = await adapter.write(envelope, { expectedRevision: 1 });
  assert.equal(result.protectedNoOp, true);
  assert.equal(result.scopeId, 'project:alpha');
  assert.equal(result.revision, 1);
});

test('server adapter preserves a true stale-writer conflict as an error', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?conflict=${Date.now()}-${Math.random()}`);
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'STALE_REVISION', error: 'stale writer' }),
    }),
    bases: () => ['http://local.test'],
  });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 1,
    digest: 'fnv1a32:conflict',
    metadata: {
      operationId: 'server-conflict', leaseId: 'lease-a',
      revision: { scopeId: 'project:alpha', counter: 2, updatedAt: 1, writerId: 'writer' },
      fencingToken: '2',
    },
    snapshot: { productName: 'A' },
  };

  await assert.rejects(
    adapter.write(envelope, { expectedRevision: 1 }),
    error => error?.code === 'STALE_REVISION' && /stale writer/.test(error.message),
  );
});

test('server adapter may persist a richer server representation for the same fenced envelope', async () => {
  const serverPath = path.join(ROOT, 'src', 'modules', 'persistence', 'server-last-work-adapter.mjs');
  const { createServerLastWorkAdapter } = await import(`${pathToFileURL(serverPath).href}?representation=${Date.now()}-${Math.random()}`);
  let posted = null;
  const adapter = createServerLastWorkAdapter({
    fetchImpl: async (_url, options = {}) => {
      posted = JSON.parse(options.body);
      return { ok: true, json: async () => ({ accepted: true, revision: 4 }) };
    },
    bases: () => ['http://local.test'],
  });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 2,
    digest: 'fnv1a32:lightweight',
    metadata: {
      operationId: 'server-representation',
      revision: { scopeId: 'project:alpha', counter: 4, updatedAt: 2, writerId: 'writer' },
      fencingToken: '4',
    },
    snapshot: { productName: 'A', factory: { assets: [] } },
  };
  const serverSnapshot = {
    id: 'current',
    lightweight: envelope.snapshot,
    assets: { productName: 'A', factory: { assets: [{ id: 'protected-image' }] } },
  };

  await adapter.write(envelope, { serverSnapshot, repair: true });

  assert.deepEqual(posted.snapshot.lightweight, envelope.snapshot);
  assert.equal(posted.snapshot.assets.factory.assets[0].id, 'protected-image');
  const { snapshot: _snapshot, ...envelopeHeader } = envelope;
  assert.deepEqual(posted.snapshot.persistenceEnvelope, { ...envelopeHeader, snapshotRef: '$.lightweight' });
  assert.equal(posted.repair, true);
});
