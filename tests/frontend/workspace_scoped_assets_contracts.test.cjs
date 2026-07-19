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

test('새 lease의 더 높은 fence는 같은 accepted revision의 scoped assets 복원을 막지 않는다', async () => {
  // Given: 저장본은 직전 lease에서 승인됐고 reload가 같은 revision으로 새 lease를 받았다.
  const { sessionAssetRecordMatchesAuthority } = await loadAdapter();
  const record = {
    id: 'session-assets:project:alpha', scopeId: 'project:alpha',
    persistenceAuthority: { scopeId: 'project:alpha', fencingToken: 49, revision: 46 },
  };
  const reloadedAuthority = {
    mode: 'editing', scopeId: 'project:alpha', fencingToken: 50, revision: 46,
  };

  // When/Then: fence 세대가 바뀌어도 accepted revision이 같으면 복원하고, revision 불일치는 거절한다.
  assert.equal(sessionAssetRecordMatchesAuthority(record, reloadedAuthority, 'project:alpha'), true);
  assert.equal(sessionAssetRecordMatchesAuthority(
    record,
    { ...reloadedAuthority, revision: 47 },
    'project:alpha',
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
  assert.deepEqual(persistenceEnvelope, envelope, 'server carries the exact v2 envelope alongside legacy fields');
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
  assert.deepEqual(posted.snapshot.persistenceEnvelope, envelope);
  assert.equal(posted.repair, true);
});
