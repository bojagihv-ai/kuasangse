const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'src', 'modules', 'persistence', 'migrations.mjs');
const SERIALIZATION = path.join(ROOT, 'src', 'modules', 'persistence', 'serialization.mjs');

async function load(relativeFile) {
  const file = path.join(ROOT, ...relativeFile.split('/'));
  assert.equal(fs.existsSync(file), true, `missing persistence module: ${relativeFile}`);
  return import(`${pathToFileURL(file).href}?test=${Date.now()}-${Math.random()}`);
}

test('legacy session/bootstrap migration is pure, versioned, and idempotent', async () => {
  const { migrateLegacySession } = await load('src/modules/persistence/migrations.mjs');
  const legacy = { currentProjectId: 'alpha', productName: '수저집', savedAt: 10, extensionVendor: { keep: 1 } };
  const before = structuredClone(legacy);

  const once = migrateLegacySession(legacy);
  const twice = migrateLegacySession(once);

  assert.deepEqual(legacy, before);
  assert.deepEqual(twice, once);
  assert.equal(once.scopeId, 'project:alpha');
  assert.equal(once.version, 2);
  assert.deepEqual(once.snapshot.extensionVendor, { keep: 1 });
});

test('IDB v4, server, archive, v1 workfile and raw payload migrate without known-data loss', async () => {
  const migrations = await load('src/modules/persistence/migrations.mjs');
  const fixtures = [
    migrations.migrateIndexedDbV4Record({ id: 'alpha', payload: { productName: 'A', ext: { idb: true } } }),
    migrations.migrateServerSnapshot({ workspaceId: 'project:alpha', snapshot: { productName: 'A', ext: { server: true } } }),
    migrations.migrateArchiveReference({ workspaceId: 'alpha', archiveId: 'arc-1', imageUrl: '/api/local-archive/assets/arc-1/image', ext: { archive: true } }),
    migrations.migrateWorkfilePayload({ format: 'kuasangse-project', version: 1, project: { id: 'alpha', payload: { productName: 'A', ext: { file: true } } } }),
    migrations.migrateWorkfilePayload({ currentProjectId: 'alpha', productName: 'A', ext: { raw: true } }),
  ];

  assert.ok(fixtures.every(item => item.version === 2));
  assert.ok(fixtures.every(item => item.scopeId === 'project:alpha'));
  assert.equal(fixtures[0].snapshot.ext.idb, true);
  assert.equal(fixtures[1].snapshot.ext.server, true);
  assert.equal(fixtures[2].snapshot.ext.archive, true);
  assert.equal(fixtures[3].snapshot.ext.file, true);
  assert.equal(fixtures[4].snapshot.ext.raw, true);
  for (const item of fixtures) assert.deepEqual(migrations.migrateWorkfilePayload(item), item);
});

test('server outer assets outrank an unreferenced stale persistence-envelope snapshot', async () => {
  const { migrateServerSnapshot } = await load('src/modules/persistence/migrations.mjs');
  const migrated = migrateServerSnapshot({
    workspaceId: 'project:alpha',
    snapshot: {
      workspaceId: 'project:alpha',
      assets: {
        currentProjectId: 'alpha',
        productName: 'A',
        optionSorter: {
          images: [{ id: 'red-image' }],
          optionResults: [{ id: 'result-1' }],
          slots: [{ id: 'slot-red', name: '1.빨강', imgIds: ['red-image'] }],
        },
        compPage: {
          analysisResult: { title: '보존할 분석' },
          sectionPlan: { header: { id: 'header' } },
          marketScrape: {
            selectedIds: ['candidate-1'],
            detailResults: { 'candidate-1': { title: '보존할 상세' } },
          },
        },
      },
      persistenceEnvelope: {
        schema: 'kuasangse.workspace',
        version: 2,
        scopeId: 'project:alpha',
        snapshot: {
          currentProjectId: 'alpha',
          productName: 'A',
          optionSorter: { slots: [{ id: 'old-slot', name: '1번', imgIds: [] }] },
        },
      },
    },
  });

  assert.deepEqual(migrated.snapshot.optionSorter.slots.map(slot => slot.name), ['1.빨강']);
  assert.equal(migrated.snapshot.optionSorter.optionResults.length, 1);
  assert.equal(migrated.snapshot.compPage.analysisResult.title, '보존할 분석');
  assert.equal(migrated.snapshot.compPage.marketScrape.detailResults['candidate-1'].title, '보존할 상세');
});

test('migrations are deterministic without wall-clock or random fallbacks', async () => {
  const migrations = await load('src/modules/persistence/migrations.mjs');
  const legacy = { currentProjectId: 'alpha', productName: 'A', extensionEnvelope: { keep: true } };
  const originalNow = Date.now;
  try {
    Date.now = () => 111;
    const first = migrations.migrateWorkfilePayload(legacy);
    Date.now = () => 999999;
    const second = migrations.migrateWorkfilePayload(legacy);
    assert.deepEqual(second, first);
    assert.deepEqual(first.extensions.extensionEnvelope, { keep: true });
  } finally {
    Date.now = originalNow;
  }
});

test('workspace serializer round-trips unknown extensions and excludes secrets/transients', async () => {
  const { deserializeWorkspace, serializeWorkspace } = await load('src/modules/persistence/serialization.mjs');
  const input = {
    productName: 'A',
    extensionVendor: { custom: [1, 2, 3] },
    gemini_api_key: 'must-not-leak',
    oauth: { accessToken: 'must-not-leak', nestedKnown: 'removed-with-credential-container' },
    factory: { busy: true, requestId: 'transient', product: { productName: 'A' } },
    fileHandle: { kind: 'file' },
  };

  const text = serializeWorkspace({ projectId: 'alpha', snapshot: input, metadata: {
    operationId: 'op-1', revision: { scopeId: 'project:alpha', counter: 1 }, fencingToken: 'not-exported',
  } });
  const restored = deserializeWorkspace(text);

  assert.deepEqual(restored.snapshot.extensionVendor, input.extensionVendor);
  assert.equal(restored.snapshot.productName, 'A');
  assert.equal(restored.snapshot.factory.product.productName, 'A');
  assert.equal('gemini_api_key' in restored.snapshot, false);
  assert.equal('oauth' in restored.snapshot, false);
  assert.equal('busy' in restored.snapshot.factory, false);
  assert.equal('requestId' in restored.snapshot.factory, false);
  assert.equal('fileHandle' in restored.snapshot, false);
  assert.equal('fencingToken' in restored.metadata, false);
});

test('serializer rejects prototype pollution keys and every credential/session/lease header shape', async () => {
  const { deserializeWorkspace, serializeWorkspace } = await load('src/modules/persistence/serialization.mjs');
  const malicious = JSON.parse('{"safe":{"keep":1},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"authHeader":"secret","authorizationHeader":"secret","sessionToken":"secret","writerSessionId":"secret","leaseSessionId":"secret","leaseToken":"secret"}');

  const restored = deserializeWorkspace(serializeWorkspace({
    projectId: 'alpha', snapshot: malicious, savedAt: 10,
    metadata: { operationId: 'safe-op', revision: { scopeId: 'project:alpha', counter: 1, updatedAt: 10, writerId: 'writer' } },
  }));

  assert.equal({}.polluted, undefined);
  assert.deepEqual(restored.snapshot.safe, { keep: 1 });
  for (const key of ['__proto__', 'constructor', 'prototype', 'authHeader', 'authorizationHeader', 'sessionToken', 'writerSessionId', 'leaseSessionId', 'leaseToken']) {
    assert.equal(Object.hasOwn(restored.snapshot, key), false, `${key} leaked`);
  }
});

test('central sanitizer removes adversarial mixed-case security containers without deleting business fields', async () => {
  const { sanitizeWorkspaceSnapshot } = await load('src/modules/persistence/serialization.mjs');
  const input = {
    productKey: 'business-key',
    authorName: 'business-author',
    authorizedRetailer: 'business-authorization-word',
    sessionCount: 3,
    writerName: 'business-writer',
    designToken: 'business-design-token',
    extensionVendor: { safe: true },
    OAuth: { accessToken: 'secret' },
    Credentials: { password: 'secret' },
    CookieJar: { sid: 'secret' },
    idToken: 'secret',
    ID_TOKEN: 'secret',
    bearerToken: 'secret',
    bearer_token: 'secret',
    csrfToken: 'secret',
    apiToken: 'secret',
    token: 'secret',
    botToken: 'secret',
    githubToken: 'secret',
    notion_token: 'secret',
    privateToken: 'secret',
    arbitraryVendorToken: 'secret',
    apiCredentials: { value: 'secret' },
    API_CREDENTIALS: { value: 'secret' },
    clientCredentials: { value: 'secret' },
    database_credentials: { value: 'secret' },
    oauthCredentialStore: { value: 'secret' },
    auth_headers: { authorization: 'secret' },
    access_tokens: ['secret'],
    refresh_tokens: ['secret'],
    oauth_tokens: ['secret'],
    cookie_headers: { cookie: 'secret' },
    Cookies: ['secret'],
    client_secrets: ['secret'],
    vendorSecrets: ['secret'],
    passwords: ['secret'],
    api_keys: ['secret'],
    session_ids: ['secret'],
    lease_ids: ['secret'],
    writer_ids: ['secret'],
    nested: {
      AUTHORIZATION: 'secret',
      Authentication: { value: 'secret' },
      clientSecret: 'secret',
      Secrets: { value: 'secret' },
      passwordHash: 'secret',
      CookieHeader: 'secret',
      Session: { value: 'secret' },
      leaseId: 'secret',
      fencingToken: 'secret',
      writerId: 'secret',
      COOKIE_HEADERS: { cookie: 'secret' },
      vendorCookies: ['secret'],
      servicePasswords: ['secret'],
      thirdPartyApiKeys: ['secret'],
      activeSessionIds: ['secret'],
      renewalLeaseIds: ['secret'],
      remoteWriterIds: ['secret'],
      workspaceRevision: { counter: 999 },
      safeExtension: { keep: true },
    },
  };
  input.cycle = input;

  const cleaned = sanitizeWorkspaceSnapshot(input);

  assert.deepEqual({
    productKey: cleaned.productKey,
    authorName: cleaned.authorName,
    authorizedRetailer: cleaned.authorizedRetailer,
    sessionCount: cleaned.sessionCount,
    writerName: cleaned.writerName,
    designToken: cleaned.designToken,
    extensionVendor: cleaned.extensionVendor,
    safeExtension: cleaned.nested.safeExtension,
  }, {
    productKey: 'business-key',
    authorName: 'business-author',
    authorizedRetailer: 'business-authorization-word',
    sessionCount: 3,
    writerName: 'business-writer',
    designToken: 'business-design-token',
    extensionVendor: { safe: true },
    safeExtension: { keep: true },
  });
  for (const key of [
    'OAuth', 'Credentials', 'CookieJar', 'idToken', 'ID_TOKEN', 'bearerToken',
    'bearer_token', 'csrfToken', 'apiToken', 'token', 'botToken', 'githubToken',
    'notion_token', 'privateToken', 'arbitraryVendorToken', 'apiCredentials',
    'API_CREDENTIALS', 'clientCredentials', 'database_credentials',
    'oauthCredentialStore', 'auth_headers', 'access_tokens', 'refresh_tokens',
    'oauth_tokens', 'cookie_headers', 'Cookies', 'client_secrets', 'vendorSecrets',
    'passwords', 'api_keys', 'session_ids', 'lease_ids', 'writer_ids', 'cycle',
  ]) {
    assert.equal(Object.hasOwn(cleaned, key), false, `${key} leaked`);
  }
  for (const key of [
    'AUTHORIZATION', 'Authentication', 'clientSecret', 'Secrets', 'passwordHash',
    'CookieHeader', 'Session', 'leaseId', 'fencingToken', 'writerId',
    'COOKIE_HEADERS', 'vendorCookies', 'servicePasswords', 'thirdPartyApiKeys',
    'activeSessionIds', 'renewalLeaseIds', 'remoteWriterIds', 'workspaceRevision',
  ]) {
    assert.equal(Object.hasOwn(cleaned.nested, key), false, `nested ${key} leaked`);
  }
});

test('every migrator sanitizes already-current v2 snapshots while retaining safe extensions and internal ordering metadata', async () => {
  const migrations = await load('src/modules/persistence/migrations.mjs');
  const v2 = {
    schema: 'kuasangse.workspace',
    version: 2,
    scopeId: 'project:alpha',
    savedAt: 20,
    metadata: {
      operationId: 'trusted-operation',
      revision: { scopeId: 'project:alpha', counter: 7, updatedAt: 19, writerId: 'trusted-writer' },
      fencingToken: 'trusted-fence',
    },
    snapshot: {
      productName: 'A',
      api_key: 'secret',
      OAuth: { idToken: 'secret' },
      recordAuthority: { fencingToken: 'secret', writerId: 'secret' },
      extensionSnapshot: { keep: true },
    },
    extensions: { vendorTop: { keep: true }, Credentials: { password: 'secret' } },
  };
  const migrated = [
    migrations.migrateLegacySession(v2),
    migrations.migrateIndexedDbV4Record({ workspaceEnvelope: v2 }),
    migrations.migrateServerSnapshot({ snapshot: { persistenceEnvelope: v2 } }),
    migrations.migrateArchiveReference({ envelope: v2 }),
    migrations.migrateWorkfilePayload(v2),
  ];

  for (const record of migrated) {
    assert.equal(record.snapshot.productName, 'A');
    assert.deepEqual(record.snapshot.extensionSnapshot, { keep: true });
    assert.deepEqual(record.extensions.vendorTop, { keep: true });
    assert.equal(Object.hasOwn(record.snapshot, 'api_key'), false);
    assert.equal(Object.hasOwn(record.snapshot, 'OAuth'), false);
    assert.equal(Object.hasOwn(record.snapshot.recordAuthority, 'fencingToken'), false);
    assert.equal(Object.hasOwn(record.snapshot.recordAuthority, 'writerId'), false);
    assert.equal(Object.hasOwn(record.extensions, 'Credentials'), false);
    assert.equal(record.metadata.revision.counter, 7);
    assert.equal(record.metadata.revision.writerId, 'trusted-writer');
    assert.equal(record.metadata.fencingToken, 'trusted-fence');
  }
});

test('workfile adapter fallback round-trips safe top-level extensions and strips untrusted snapshot authority', async () => {
  const { createWorkfileAdapter } = await load('src/modules/persistence/workfile-adapter.mjs');
  let written = '';
  const handle = {
    async createWritable() {
      return {
        async write(value) { written = String(value); },
        async close() {},
        async abort() {},
      };
    },
  };
  const adapter = createWorkfileAdapter({ root: null });
  const envelope = {
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha', savedAt: 20,
    metadata: {
      operationId: 'workfile-op',
      revision: { scopeId: 'project:alpha', counter: 2, updatedAt: 20, writerId: 'internal-writer' },
      fencingToken: 'internal-fence',
    },
    snapshot: { productName: 'A', OAuth: { token: 'secret' }, fencingToken: 'snapshot-fence' },
    extensions: { vendorTop: { keep: true } },
  };

  await adapter.write(envelope, { handle });
  const restored = adapter.deserialize(written);

  assert.deepEqual(restored.extensions.vendorTop, { keep: true });
  assert.equal(restored.snapshot.productName, 'A');
  assert.equal(Object.hasOwn(restored.snapshot, 'OAuth'), false);
  assert.equal(Object.hasOwn(restored.snapshot, 'fencingToken'), false);
});

test('migration modules are genuine ESM and remain focused', () => {
  for (const file of [MIGRATIONS, SERIALIZATION]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /\bexport\s+(?:const|function|class)\b/);
    assert.doesNotMatch(source, /\b(?:window|globalThis)\b/);
    assert.ok(source.trimEnd().split(/\r?\n/).length <= 250, `${path.basename(file)} exceeds 250 LOC`);
  }
});
