const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const GATEWAY = path.join(ROOT, 'src', 'modules', 'workspace-persistence.mjs');

async function loadGateway() {
  assert.equal(fs.existsSync(GATEWAY), true, 'missing real workspace persistence orchestrator');
  return import(`${pathToFileURL(GATEWAY).href}?test=${Date.now()}-${Math.random()}`);
}

function memoryAdapter(name, initial = null) {
  let value = initial;
  let failNext = false;
  const writes = [];
  return {
    name,
    fail() { failNext = true; },
    async read() { return value; },
    async write(record) {
      if (failNext) {
        failNext = false;
        throw new Error(`${name}-injected-failure`);
      }
      value = structuredClone(record);
      writes.push(structuredClone(record));
      return value;
    },
    value() { return value; },
    writes,
  };
}

function metadata(scopeId, counter = 1) {
  return {
    operationId: `operation-${counter}`,
    revision: { scopeId, counter, updatedAt: counter, writerId: 'test-writer' },
    fencingToken: `carry-only-${counter}`,
  };
}

test('Given adapters When committing Then one authoritative point receives versioned metadata', async () => {
  const { createWorkspacePersistence, WORKSPACE_PERSISTENCE_SCHEMA } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });

  const result = await gateway.commit({
    projectId: 'alpha',
    snapshot: { productName: 'alpha product' },
    metadata: metadata('project:alpha'),
    replicas: ['session', 'server', 'workfile', 'archive'],
    isCurrent: () => true,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.clean, true);
  assert.equal(result.authoritative, 'indexeddb');
  assert.equal(adapters.indexeddb.value().schema, WORKSPACE_PERSISTENCE_SCHEMA);
  assert.equal(adapters.indexeddb.value().metadata.operationId, 'operation-1');
  assert.equal(adapters.indexeddb.value().metadata.fencingToken, 'carry-only-1');
});

test('Given a replica failure When committing Then accepted data survives but state is partial and dirty', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const previous = { snapshot: { productName: 'previous' } };
  await adapters.indexeddb.write(previous);
  adapters.server.fail();
  const gateway = createWorkspacePersistence({ adapters });

  const result = await gateway.commit({
    projectId: 'alpha',
    snapshot: { productName: 'accepted' },
    metadata: metadata('project:alpha', 2),
    replicas: ['server'],
    isCurrent: () => true,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.partial, true);
  assert.equal(result.clean, false);
  assert.equal(adapters.indexeddb.value().snapshot.productName, 'accepted');
  assert.equal(result.failures[0].adapter, 'server');
});

test('Given each replica boundary fails When committing Then its failure is isolated after authoritative acceptance', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  for (const failingName of ['session', 'server', 'workfile', 'archive']) {
    const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
      .map(name => [name, memoryAdapter(name)]));
    adapters[failingName].fail();
    const gateway = createWorkspacePersistence({ adapters });
    const result = await gateway.commit({
      projectId: `failure-${failingName}`,
      snapshot: { productName: `accepted despite ${failingName}` },
      metadata: metadata(`project:failure-${failingName}`, 6),
      replicas: [failingName],
      isCurrent: () => true,
    });

    assert.equal(result.accepted, true, `${failingName}: authoritative write`);
    assert.equal(result.partial, true, `${failingName}: partial state`);
    assert.equal(result.clean, false, `${failingName}: dirty state`);
    assert.deepEqual(result.failures.map(item => item.adapter), [failingName]);
    assert.equal(adapters.indexeddb.value().snapshot.productName, `accepted despite ${failingName}`);
  }
});

test('Given an authoritative failure When committing Then the last accepted snapshot is unchanged', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  await adapters.indexeddb.write({ snapshot: { productName: 'last accepted' } });
  adapters.indexeddb.fail();
  const gateway = createWorkspacePersistence({ adapters });

  const result = await gateway.commit({
    projectId: 'alpha',
    snapshot: { productName: 'must not win' },
    metadata: metadata('project:alpha', 3),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.clean, false);
  assert.equal(adapters.indexeddb.value().snapshot.productName, 'last accepted');
  assert.equal(adapters.server.writes.length, 0);
});

test('Given a rejected authoritative write When session is requested Then rejected content is never staged or restorable', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });
  await gateway.commit({
    projectId: 'authority-fence', snapshot: { value: 'LAST-ACCEPTED' },
    metadata: metadata('project:authority-fence', 20), replicas: ['session'], isCurrent: () => true,
  });
  adapters.indexeddb.fail();

  const rejected = await gateway.commit({
    projectId: 'authority-fence', snapshot: { value: 'REJECTED-BUT-MUST-NOT-STAGE' },
    metadata: metadata('project:authority-fence', 21), replicas: ['session'], isCurrent: () => true,
  });
  const restored = await gateway.restore({ projectId: 'authority-fence', sources: ['session'] });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.clean, false);
  assert.equal(adapters.session.writes.length, 1);
  assert.equal(adapters.session.value().snapshot.value, 'LAST-ACCEPTED');
  assert.equal(restored.snapshot.value, 'LAST-ACCEPTED');
});

test('Given the same operation When retried Then replicas are idempotent', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });
  const command = {
    projectId: 'alpha', snapshot: { value: 1 }, metadata: metadata('project:alpha', 4), replicas: ['server'], isCurrent: () => true,
  };

  const first = await gateway.commit(command);
  const second = await gateway.commit(command);

  assert.deepEqual(second, first);
  assert.equal(adapters.indexeddb.writes.length, 1);
  assert.equal(adapters.server.writes.length, 1);
});

test('Given multiple failed replicas When retrying one name Then the full pending set is retained', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  adapters.server.fail();
  adapters.archive.fail();
  const gateway = createWorkspacePersistence({ adapters });
  const command = {
    projectId: 'retry-all', snapshot: { value: 1 }, metadata: metadata('project:retry-all', 8),
    replicas: ['server', 'archive'], isCurrent: () => true,
  };

  const first = await gateway.commit(command);
  const second = await gateway.commit({ ...command, replicas: ['server'] });

  assert.equal(first.clean, false);
  assert.deepEqual(first.failures.map(item => item.adapter).sort(), ['archive', 'server']);
  assert.equal(second.clean, true);
  assert.equal(adapters.indexeddb.writes.length, 1);
  assert.equal(adapters.server.writes.length, 1);
  assert.equal(adapters.archive.writes.length, 1);
});

test('Given an unknown replica When committing Then validation precedes authoritative side effects', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });

  await assert.rejects(gateway.commit({
    projectId: 'invalid-replica', snapshot: { value: 1 },
    metadata: metadata('project:invalid-replica', 9), replicas: ['unknown-boundary'],
  }), /unknown persistence replica/);

  assert.equal(adapters.indexeddb.writes.length, 0);
});

test('Given content changes during save When all writes succeed Then the document remains dirty', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });

  const result = await gateway.commit({
    projectId: 'changed', snapshot: { value: 1 }, metadata: metadata('project:changed', 10),
    replicas: ['workfile'], isCurrent: () => false,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.partial, false);
  assert.equal(result.clean, false);
});

test('Given restore candidates When restoring Then explicit workfile and deterministic precedence win', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name, {
      schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha',
      metadata: metadata('project:alpha', 5), savedAt: 500, snapshot: { source: name },
    })]));
  const gateway = createWorkspacePersistence({ adapters });

  const automatic = await gateway.restore({ projectId: 'alpha' });
  const explicit = await gateway.restore({
    projectId: 'alpha',
    explicitWorkfile: { scopeId: 'project:alpha', metadata: metadata('project:alpha', 1), snapshot: { source: 'explicit' } },
  });

  assert.equal(automatic.source, 'indexeddb');
  assert.equal(explicit.source, 'workfile');
  assert.equal(explicit.snapshot.source, 'explicit');
});

test('Given mixed revisions and scopes When restoring Then the newest matching revision wins before source precedence', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = {
    indexeddb: memoryAdapter('indexeddb', {
      schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha',
      metadata: metadata('project:alpha', 4), savedAt: 400, snapshot: { source: 'indexeddb-older' },
    }),
    server: memoryAdapter('server', {
      schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha',
      metadata: metadata('project:alpha', 7), savedAt: 700, snapshot: { source: 'server-newer' },
    }),
    session: memoryAdapter('session', {
      schema: 'kuasangse.workspace', version: 2, scopeId: 'project:other',
      metadata: metadata('project:other', 99), savedAt: 9900, snapshot: { source: 'wrong-scope' },
    }),
    workfile: memoryAdapter('workfile'),
    archive: memoryAdapter('archive', {
      schema: 'kuasangse.workspace', version: 2, scopeId: 'project:alpha',
      metadata: metadata('project:alpha', 7), savedAt: 650, snapshot: { source: 'archive-same-revision-older-save' },
    }),
  };
  const gateway = createWorkspacePersistence({ adapters });

  const restored = await gateway.restore({ projectId: 'alpha' });

  assert.equal(restored.source, 'server');
  assert.deepEqual(restored.revision, metadata('project:alpha', 7).revision);
  assert.equal(restored.snapshot.source, 'server-newer');
});

test('Given adversarial snapshot keys When committing Then authority and every replica receive only sanitized user data', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });

  const result = await gateway.commit({
    projectId: 'secure-commit',
    snapshot: {
      productName: 'safe',
      OAuth: { token: 'secret' },
      Credentials: { password: 'secret' },
      CookieJar: { idToken: 'secret' },
      bearer_token: 'secret',
      csrfToken: 'secret',
      fencingToken: 'snapshot-fence',
      writerId: 'snapshot-writer',
      extensionVendor: { keep: true },
    },
    metadata: metadata('project:secure-commit', 11),
    replicas: ['session', 'server', 'workfile', 'archive'],
    isCurrent: () => true,
  });

  assert.equal(result.clean, true);
  for (const name of ['indexeddb', 'session', 'server', 'workfile', 'archive']) {
    const snapshot = adapters[name].value().snapshot;
    assert.equal(snapshot.productName, 'safe');
    assert.deepEqual(snapshot.extensionVendor, { keep: true });
    for (const key of ['OAuth', 'Credentials', 'CookieJar', 'bearer_token', 'csrfToken', 'fencingToken', 'writerId']) {
      assert.equal(Object.hasOwn(snapshot, key), false, `${name} leaked ${key}`);
    }
  }
});

test('Given every restore source and explicit v2 workfile When restoring Then snapshots are sanitized and authority records stay internal', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const maliciousRecord = source => ({
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:secure-restore', savedAt: 20,
    metadata: metadata('project:secure-restore', 12),
    snapshot: {
      source,
      productName: 'safe',
      api_key: 'secret',
      OAuth: { idToken: 'secret' },
      Credentials: { password: 'secret' },
      CookieJar: { bearerToken: 'secret' },
      session: { token: 'secret' },
      fencingToken: 'snapshot-fence',
      writerId: 'snapshot-writer',
      extensionVendor: { keep: true },
    },
    extensions: { vendorTop: { keep: true } },
  });

  for (const source of ['indexeddb', 'server', 'session', 'archive']) {
    const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
      .map(name => [name, memoryAdapter(name, name === source ? maliciousRecord(source) : null)]));
    const restored = await createWorkspacePersistence({ adapters }).restore({
      projectId: 'secure-restore', sources: [source],
    });
    assert.equal(restored.source, source);
    assert.equal(restored.snapshot.productName, 'safe');
    assert.deepEqual(restored.snapshot.extensionVendor, { keep: true });
    assert.equal(Object.hasOwn(restored, 'record'), false, `${source} exposed authority record`);
    for (const key of ['api_key', 'OAuth', 'Credentials', 'CookieJar', 'session', 'fencingToken', 'writerId']) {
      assert.equal(Object.hasOwn(restored.snapshot, key), false, `${source} leaked ${key}`);
    }
  }

  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const explicit = await createWorkspacePersistence({ adapters }).restore({
    projectId: 'secure-restore', explicitWorkfile: maliciousRecord('explicit'),
  });
  assert.equal(explicit.source, 'workfile');
  assert.equal(explicit.snapshot.source, 'explicit');
  assert.equal(Object.hasOwn(explicit, 'record'), false);
  assert.equal(Object.hasOwn(explicit.snapshot, 'OAuth'), false);
  assert.equal(Object.hasOwn(explicit.snapshot, 'fencingToken'), false);
});

test('Given the browser migration facade When a v2 workfile is inspected Then trusted authority metadata is not exposed', async () => {
  const { createBrowserWorkspacePersistence } = await loadGateway();
  const storage = new Map();
  const api = createBrowserWorkspacePersistence({
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
  });
  const migrated = api.migrateWorkfilePayload({
    schema: 'kuasangse.workspace', version: 2, scopeId: 'project:public-migrate', savedAt: 1,
    metadata: metadata('project:public-migrate', 14),
    snapshot: { productName: 'safe', OAuth: { token: 'secret' }, workspaceRevision: { counter: 99 } },
  });

  assert.equal(migrated.snapshot.productName, 'safe');
  assert.equal(Object.hasOwn(migrated.snapshot, 'OAuth'), false);
  assert.equal(Object.hasOwn(migrated.snapshot, 'workspaceRevision'), false);
  assert.equal(Object.hasOwn(migrated.metadata, 'operationId'), false);
  assert.equal(Object.hasOwn(migrated.metadata, 'fencingToken'), false);
  assert.equal(Object.hasOwn(migrated.metadata.revision, 'writerId'), false);
});

test('Given a clean cached operation When its operationId is reused with different content Then validation rejects before cached success', async () => {
  const { createWorkspacePersistence } = await loadGateway();
  const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
    .map(name => [name, memoryAdapter(name)]));
  const gateway = createWorkspacePersistence({ adapters });
  const command = {
    projectId: 'cached-operation', snapshot: { value: 'A' },
    metadata: metadata('project:cached-operation', 13), replicas: ['session'], isCurrent: () => true,
  };

  const first = await gateway.commit(command);
  await assert.rejects(gateway.commit({ ...command, snapshot: { value: 'B' } }), /operationId cannot be reused/);

  assert.equal(first.clean, true);
  assert.equal(adapters.indexeddb.writes.length, 1);
  assert.equal(adapters.session.writes.length, 1);
  assert.equal(adapters.indexeddb.value().snapshot.value, 'A');
  assert.equal(adapters.session.value().snapshot.value, 'A');
});

test('Given automatic session persistence When inspected Then no replica staging exists before authoritative commit', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const gatewaySource = fs.readFileSync(GATEWAY, 'utf8');
  const start = source.indexOf('function savePersistentState(');
  const end = source.indexOf('function savePersistentStateNow(', start);
  const saveBlock = source.slice(start, end);

  assert.doesNotMatch(saveBlock, /stageSessionRecovery\s*\(/);
  assert.doesNotMatch(gatewaySource, /stageSessionRecovery\s*:/);
  assert.match(saveBlock, /workspacePersistenceApi\(\)\.commit\s*\([\s\S]*replicas:\s*\['session'\]/);
});

test('classic runtime has no direct workspace persistence boundary after migration', async () => {
  await loadGateway();
  const classic = ['src/app-core-02.js', 'src/app-core-03.js', 'src/app-core-06.js']
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert.doesNotMatch(classic, /\bindexedDB\.(?:open|deleteDatabase)\s*\(/);
  assert.doesNotMatch(classic, /\b(?:window\.)?show(?:Save|Open)FilePicker\s*\(/);
  assert.doesNotMatch(classic, /\.createWritable\s*\(/);
  assert.doesNotMatch(classic, /fetch\([^\n]{0,180}\/api\/last-work/);
  assert.doesNotMatch(classic, /fetch\([^\n]{0,180}\/api\/local-archive/);
  assert.doesNotMatch(classic, /localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]pdp_(?:session|session_img|session_imgs|detail_image_blocks|last_work_bootstrap_v1)/);
});

test('Given the classic runtime When scanned structurally Then no adapter-shaped bypass remains', async () => {
  const gatewaySource = fs.readFileSync(GATEWAY, 'utf8');
  const classicFiles = ['src/app-core-02.js', 'src/app-core-03.js', 'src/app-core-06.js'];
  const scan = spawnSync('ast-grep.exe', [
    'run', '-p', 'workspacePersistenceApi().$BOUNDARY.$METHOD($$$ARGS)', '--lang', 'js',
    '--json=compact', ...classicFiles,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.ok([0, 1].includes(scan.status), scan.stderr || scan.stdout);
  const matches = scan.stdout.trim() ? JSON.parse(scan.stdout) : [];

  assert.deepEqual(matches, [], `classic adapter bypasses:\n${matches.map(item => `${item.file}:${item.range.start.line + 1} ${item.text}`).join('\n')}`);
  assert.doesNotMatch(gatewaySource, /return Object\.freeze\(\{\s*\.\.\.orchestrator,\s*compatibility|\bcompatibility\s*[,}]/);
  assert.doesNotMatch(gatewaySource, /return Object\.freeze\(\{\s*adapters\s*,/);
  for (const forbidden of ['put', 'delete', 'request', 'writeHandle']) {
    assert.doesNotMatch(gatewaySource, new RegExp(`compatibility[\\s\\S]{0,1200}\\b${forbidden}\\b`));
  }
});

test('Given actual save and load functions When inspected Then they invoke commit and restore', () => {
  const classic = ['src/app-core-02.js', 'src/app-core-03.js']
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  const commitCalls = classic.match(/workspacePersistenceApi\(\)\.commit\s*\(/g) || [];
  const restoreCalls = classic.match(/workspacePersistenceApi\(\)\.restore\s*\(/g) || [];
  assert.ok(commitCalls.length >= 3, `expected real commit calls, received ${commitCalls.length}`);
  assert.ok(restoreCalls.length >= 2, `expected real restore calls, received ${restoreCalls.length}`);

  const workfileStart = classic.indexOf('async function exportCurrentProjectFile(');
  const workfileEnd = classic.indexOf('function parseFactoryProjectFileBundle(', workfileStart);
  const workfile = classic.slice(workfileStart, workfileEnd);
  assert.match(workfile, /await workspacePersistenceApi\(\)\.commit\s*\(/);
  assert.match(workfile, /if \(!commitResult\.clean\) throw/);
  assert.ok(workfile.indexOf('commitResult.clean') < workfile.indexOf('markWorkspaceDocumentClean()'));
});
