const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = require('../../src/runtime-manifest.json');
const { buildRegressionSteps } = require('../../tools/regression_manifest.cjs');
const { verifyRuntimeBundle } = require('../../tools/build_runtime_bundle.cjs');
const NON_RUNTIME_ESM = Object.freeze([
  'src/modules/pdp-api-client.mjs',
  'src/modules/pdp-sync-queue.mjs',
  'src/modules/persistence/migration-backup.mjs',
]);

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

function runtimeModules() {
  return [MANIFEST.authorityModule, ...(MANIFEST.modules || [])];
}

test('ARCH-MANIFEST-01: browser ESM은 manifest에, backend·migration 도구는 폐쇄 목록에 정확히 한 번 분류된다', () => {
  const discovered = walk(path.join(ROOT, 'src'))
    .filter(file => file.endsWith('.mjs'))
    .map(relative)
    .sort();
  const registered = runtimeModules().slice().sort();
  assert.equal(new Set(registered).size, registered.length, 'duplicate runtime module registration');
  assert.deepEqual(
    registered.filter(file => NON_RUNTIME_ESM.includes(file)),
    [],
    'non-runtime ESM must not enter the browser manifest',
  );
  assert.deepEqual([...registered, ...NON_RUNTIME_ESM].sort(), discovered);
});

test('ARCH-SIZE-01: 모든 runtime ESM은 250 pure LOC 이하이다', () => {
  const oversized = runtimeModules()
    .map(file => ({ file, lines: pureLoc(source(file)) }))
    .filter(item => item.lines > 250);
  assert.deepEqual(
    oversized,
    [],
    `oversized runtime modules:\n${oversized.map(item => `- ${item.file}: ${item.lines} pure LOC`).join('\n')}`,
  );
});

test('ARCH-PERSISTENCE-01: browser persistence primitive는 승인된 authority·adapter 경계에만 있다', () => {
  const storageAllowed = new Set([
    'src/modules/workspace-persistence.mjs',
    'src/modules/workspace-revision.mjs',
    'src/modules/workspace-lock.mjs',
    'src/modules/persistence/indexeddb-driver.mjs',
    'src/modules/persistence/session-storage-adapter.mjs',
    'src/modules/persistence/workfile-adapter.mjs',
  ]);
  const fetchAllowed = new Set([
    'src/modules/workspace-lock-transport.mjs',
    'src/modules/persistence/archive-adapter.mjs',
  ]);
  const storagePattern = /\b(?:localStorage|sessionStorage|indexedDB|showSaveFilePicker|showOpenFilePicker)\b/;
  const fetchPattern = /\bfetch\s*\(/;
  const violations = [];
  for (const file of runtimeModules()) {
    const text = source(file);
    if (storagePattern.test(text) && !storageAllowed.has(file)) violations.push(`${file}: storage`);
    if (fetchPattern.test(text) && !fetchAllowed.has(file)) violations.push(`${file}: fetch`);
  }
  assert.deepEqual(violations, []);
});

test('ARCH-GLOBALS-01: classic runtime은 mutable state 전역을 다시 만들지 않는다', () => {
  const files = [MANIFEST.loader, ...(MANIFEST.scripts || [])];
  const forbidden = /(?:window|globalThis)\s*(?:\.\s*(?:state|factoryState|__kuasangseState)|\[\s*['"](?:state|factoryState|__kuasangseState)['"]\s*\])\s*=(?!=)/;
  const violations = files.filter(file => forbidden.test(source(file)));
  assert.deepEqual(violations, []);
});

test('ARCH-BUNDLE-01: generated bundle은 manifest classic source와 byte-for-byte 일치한다', () => {
  assert.equal(verifyRuntimeBundle(ROOT), true);
});

test('ARCH-REGISTRY-01: lifecycle·migration·concurrency aggregate gate가 daily manifest에 등록된다', () => {
  const steps = buildRegressionSteps('python');
  const ids = steps.map(step => step.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate regression step id');
  for (const id of ['ARCH-LIFECYCLE-01', 'SAVE-MIGRATION-01', 'SAVE-CONCURRENCY-01']) {
    assert.ok(ids.includes(id), `missing aggregate gate: ${id}`);
  }
});
