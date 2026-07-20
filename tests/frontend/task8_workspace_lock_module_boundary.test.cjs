const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const LOCK_MODULES = Object.freeze([
  'src/modules/workspace-lock-transport.mjs',
  'src/modules/workspace-lock-lifecycle.mjs',
  'src/modules/workspace-lock-transitions.mjs',
  'src/modules/workspace-lock.mjs',
]);

function absolute(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function source(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

async function importFresh(relativePath, tag) {
  return import(`${pathToFileURL(absolute(relativePath)).href}?${tag}=${Date.now()}-${Math.random()}`);
}

test('workspace lock은 transport, lifecycle, transition 경계를 소유한다', async () => {
  for (const relativePath of LOCK_MODULES) {
    assert.equal(fs.existsSync(absolute(relativePath)), true, `missing workspace lock boundary: ${relativePath}`);
  }

  const entrySource = source('src/modules/workspace-lock.mjs');
  assert.match(entrySource, /from ['"]\.\/workspace-lock-transport\.mjs['"]/);
  assert.match(entrySource, /from ['"]\.\/workspace-lock-lifecycle\.mjs['"]/);
  assert.match(entrySource, /from ['"]\.\/workspace-lock-transitions\.mjs['"]/);
  assert.doesNotMatch(entrySource, /\broot\.fetch\s*\(/, 'entry point must not own HTTP transport');
  assert.doesNotMatch(entrySource, /\bBroadcastChannel\b|\bsetInterval\?*\./, 'entry point must not own lock lifecycle');
  assert.doesNotMatch(entrySource, /\bauthorityTransitionGeneration\b/, 'entry point must not own transition state');

  const [entry, protocol] = await Promise.all([
    importFresh('src/modules/workspace-lock.mjs', 'entry'),
    import(pathToFileURL(absolute('src/modules/workspace-lock-protocol.mjs')).href),
  ]);
  assert.deepEqual(Object.keys(entry).sort(), [
    'WorkspaceLockError',
    'createWorkspaceLockCoordinator',
    'installWorkspaceLock',
  ]);
  assert.equal(entry.WorkspaceLockError, protocol.WorkspaceLockError);

  const coordinator = entry.createWorkspaceLockCoordinator({
    root: { crypto: { randomUUID: () => 'boundary-session' } },
    serverBases: () => ['http://test.invalid'],
  });
  assert.deepEqual(Object.keys(coordinator).sort(), [
    'acquire', 'heartbeat', 'observeRevision', 'openReadOnly', 'refresh', 'release',
    'runMutation', 'snapshot', 'subscribe', 'takeover',
  ]);
  assert.equal(Object.isFrozen(coordinator), true);
});

test('workspace lock production 모듈은 각각 250 pure LOC 이하이다', () => {
  const oversized = LOCK_MODULES
    .filter(relativePath => fs.existsSync(absolute(relativePath)))
    .map(relativePath => ({ relativePath, lines: pureLoc(source(relativePath)) }))
    .filter(item => item.lines > 250);
  assert.deepEqual(
    oversized,
    [],
    `oversized workspace lock modules:\n${oversized.map(item => `- ${item.relativePath}: ${item.lines}`).join('\n')}`,
  );
});
