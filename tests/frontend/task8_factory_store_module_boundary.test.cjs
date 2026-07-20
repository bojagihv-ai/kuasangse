'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const FACTORY_STORE_MODULES = [
  'src/modules/factory-store-data.mjs',
  'src/modules/factory-store-draft.mjs',
  'src/modules/factory-store-runtime.mjs',
  'src/modules/factory-store.mjs',
];

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

test('FACTORY-STORE-MODULE-BOUNDARY: data/draft/runtime 경계와 facade 공개 API를 고정한다', async () => {
  for (const relativePath of FACTORY_STORE_MODULES) {
    assert.equal(fs.existsSync(path.join(ROOT, ...relativePath.split('/'))), true, `${relativePath} is required`);
  }

  const facade = source('src/modules/factory-store.mjs');
  assert.match(facade, /from\s+['"]\.\/factory-store-runtime\.mjs['"]/);
  assert.doesNotMatch(facade, /Proxy\.revocable|function\s+clonePlainData|function\s+createFactoryStore/);

  const namespace = await import(`${pathToFileURL(path.join(ROOT, 'src/modules/factory-store.mjs')).href}?task8=${Date.now()}`);
  assert.deepEqual(Object.keys(namespace).sort(), ['FACTORY_STORE_VERSION', 'createFactoryStore']);
  assert.equal(namespace.FACTORY_STORE_VERSION, 'factory-store:v1');
  assert.equal(typeof namespace.createFactoryStore, 'function');
});

test('FACTORY-STORE-MODULE-LOC: factory store production modules are at most 250 pure LOC', () => {
  const oversized = FACTORY_STORE_MODULES
    .filter(relativePath => fs.existsSync(path.join(ROOT, ...relativePath.split('/'))))
    .map(relativePath => ({ relativePath, lines: pureLoc(source(relativePath)) }))
    .filter(item => item.lines > 250);

  assert.deepEqual(oversized, [], oversized.map(item => `${item.relativePath}: ${item.lines}`).join('\n'));
});
