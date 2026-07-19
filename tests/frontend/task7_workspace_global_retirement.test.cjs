const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const REVISION_FILE = path.join(ROOT, 'src/modules/workspace-revision.mjs');
const PERSISTENCE_FILE = path.join(ROOT, 'src/modules/workspace-persistence.mjs');
const CORE_02_FILE = path.join(ROOT, 'src/app-core-02.js');
const REVISION_KEY = '__KUASANGSE_WORKSPACE_REVISION__';
const PERSISTENCE_KEY = '__KUASANGSE_WORKSPACE_PERSISTENCE__';

async function importFresh(file, label) {
  return import(`${pathToFileURL(file).href}?${label}=${Date.now()}-${Math.random()}`);
}

function storageFixture() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function rootFixture() {
  const storage = storageFixture();
  return {
    localStorage: storage,
    sessionStorage: storageFixture(),
    crypto: { randomUUID: () => 'workspace-global-test-writer' },
    document: {},
    fetch: async () => { throw new Error('network is outside this unit boundary'); },
  };
}

test('B4 source boundary removes direct writable workspace-global assignments', () => {
  // Given: the two capability modules and the classic consumer source.
  const revision = fs.readFileSync(REVISION_FILE, 'utf8');
  const persistence = fs.readFileSync(PERSISTENCE_FILE, 'utf8');
  const classic = fs.readFileSync(CORE_02_FILE, 'utf8');

  // When/Then: modules publish only through a descriptor boundary while app-core-02
  // keeps the compatibility reads required by the classic script execution order.
  assert.doesNotMatch(revision, /(?:root|window|self|globalThis)\.__KUASANGSE_WORKSPACE_REVISION__\s*=/);
  assert.doesNotMatch(persistence, /(?:root|window|self|globalThis)\.__KUASANGSE_WORKSPACE_PERSISTENCE__\s*=/);
  assert.match(revision, /Object\.defineProperty\(/);
  assert.match(persistence, /Object\.defineProperty\(/);
  assert.match(classic, /window\.__KUASANGSE_WORKSPACE_REVISION__/);
  assert.match(classic, /window\.__KUASANGSE_WORKSPACE_PERSISTENCE__/);
});

test('revision capability is immutable, idempotent, detached, and rejects conflicts', async () => {
  // Given: a clean browser-like root and the real revision module.
  const { installWorkspaceRevisionGlobals } = await importFresh(REVISION_FILE, 'global-revision');
  const root = rootFixture();

  // When: the capability is installed twice and then attacked through its public seams.
  const first = installWorkspaceRevisionGlobals(root);
  const second = installWorkspaceRevisionGlobals(root);
  const descriptor = Object.getOwnPropertyDescriptor(root, REVISION_KEY);

  // Then: publication is one-shot and non-writable/non-configurable/non-enumerable.
  assert.strictEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(
    {
      writable: descriptor?.writable,
      configurable: descriptor?.configurable,
      enumerable: descriptor?.enumerable,
    },
    { writable: false, configurable: false, enumerable: false },
  );
  assert.equal(Reflect.set(root, REVISION_KEY, {}), false);
  assert.equal(Reflect.deleteProperty(root, REVISION_KEY), false);
  assert.equal(Reflect.set(first, 'next', () => null), false);
  assert.equal(Reflect.deleteProperty(first, 'next'), false);
  assert.equal(Object.keys(root).includes(REVISION_KEY), false);

  // And: snapshots are frozen detached values, so mutation cannot alter the registry.
  const next = first.next('project:global-test', 1000);
  const observed = first.observe(next, 'project:global-test');
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Reflect.set(observed, 'counter', 999), false);
  assert.equal(first.current('project:global-test').counter, 1);

  // And: an unrelated pre-existing property is rejected rather than overwritten.
  const conflictingRoot = rootFixture();
  Object.defineProperty(conflictingRoot, REVISION_KEY, {
    value: Object.freeze({ unrelated: true }),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  assert.throws(
    () => installWorkspaceRevisionGlobals(conflictingRoot),
    /conflicting|capability/i,
  );
});

test('persistence capability is immutable, idempotent, and exposes no adapter state', async () => {
  // Given: a browser-like root without external I/O; the real persistence facade still builds.
  const { installWorkspacePersistence } = await importFresh(PERSISTENCE_FILE, 'global-persistence');
  const root = rootFixture();

  // When: the capability is installed twice and its public object is mutated.
  const first = installWorkspacePersistence(root);
  const second = installWorkspacePersistence(root);
  const descriptor = Object.getOwnPropertyDescriptor(root, PERSISTENCE_KEY);

  // Then: only a frozen, private-closure API is exposed.
  assert.strictEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(
    {
      writable: descriptor?.writable,
      configurable: descriptor?.configurable,
      enumerable: descriptor?.enumerable,
    },
    { writable: false, configurable: false, enumerable: false },
  );
  assert.equal(Reflect.set(root, PERSISTENCE_KEY, {}), false);
  assert.equal(Reflect.deleteProperty(root, PERSISTENCE_KEY), false);
  assert.equal(Reflect.set(first, 'adapters', {}), false);
  assert.equal(Reflect.deleteProperty(first, 'commit'), false);
  assert.equal(Object.keys(root).includes(PERSISTENCE_KEY), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'adapters'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'operations'), false);

  // And: the compatibility API remains callable for the classic consumer.
  assert.equal(first.normalizeProjectScope('alpha'), 'project:alpha');
  assert.equal(first.normalizeWorkspaceScope('draft:test'), 'draft:test');
  assert.equal(typeof first.commit, 'function');
  assert.equal(typeof first.restore, 'function');

  // And: a conflicting pre-existing property is rejected rather than replaced.
  const conflictingRoot = rootFixture();
  Object.defineProperty(conflictingRoot, PERSISTENCE_KEY, {
    value: Object.freeze({ unrelated: true }),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  assert.throws(
    () => installWorkspacePersistence(conflictingRoot),
    /conflicting|capability/i,
  );
});
