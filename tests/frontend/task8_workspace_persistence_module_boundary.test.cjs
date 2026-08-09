const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULES = Object.freeze({
  facade: 'src/modules/workspace-persistence.mjs',
  envelope: 'src/modules/persistence-envelope.mjs',
  authorityRuntime: 'src/modules/persistence/authority-runtime.mjs',
  operationCache: 'src/modules/persistence/operation-cache.mjs',
  commitEngine: 'src/modules/persistence/commit-engine.mjs',
  orchestrator: 'src/modules/workspace-persistence-orchestrator.mjs',
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

function pureLoc(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

test('Task8 persistence modules own one boundary each and stay within 250 pure LOC', () => {
  for (const relativePath of Object.values(MODULES)) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, `missing module: ${relativePath}`);
    assert.ok(pureLoc(read(relativePath)) <= 250, `${relativePath} exceeds 250 pure LOC`);
  }

  const facade = read(MODULES.facade);
  const envelope = read(MODULES.envelope);
  const orchestrator = read(MODULES.orchestrator);
  assert.match(facade, /from ['"]\.\/workspace-persistence-orchestrator\.mjs['"]/);
  assert.match(orchestrator, /from ['"]\.\/persistence-envelope\.mjs['"]/);
  assert.doesNotMatch(envelope, /\b(?:window|globalThis|self|document|localStorage|indexedDB)\b/);
  assert.doesNotMatch(orchestrator, /\b(?:localStorage|indexedDB|createSessionStorageAdapter|createIndexedDbPersistenceAdapter)\b/);
  assert.match(facade, /createSessionStorageAdapter/);
  assert.match(facade, /export function installWorkspacePersistence\(root = globalThis\)/);
});

test('Task8 persistence facade preserves its complete public API', async () => {
  const module = await import(`${pathToFileURL(path.join(ROOT, MODULES.facade)).href}?boundary=${Date.now()}`);
  assert.deepEqual(Object.keys(module).sort(), [
    'WORKSPACE_PERSISTENCE_SCHEMA',
    'WORKSPACE_PERSISTENCE_VERSION',
    'WorkspaceAuthorityError',
    'createBrowserWorkspacePersistence',
    'createGuardedWorkspaceMutations',
    'createWorkspacePersistence',
    'installWorkspacePersistence',
  ]);
  for (const name of Object.keys(module).filter(name => name.startsWith('create') || name.startsWith('install'))) {
    assert.equal(typeof module[name], 'function', `${name} must remain callable`);
  }
});
