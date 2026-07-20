const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const IMAGECUTS_MODULES = Object.freeze([
  'imagecuts-menu.mjs',
  'imagecuts-contract.mjs',
  'imagecuts-controller.mjs',
  'imagecuts-view.mjs',
  'imagecuts-view-source.mjs',
  'imagecuts-view-results.mjs',
]);

function modulePath(file) {
  return path.join(ROOT, 'src', 'menus', file);
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

test('Task 8 이미지컷 facade는 createImageCutsMenu 호환 export만 유지한다', async () => {
  const namespace = await import(pathToFileURL(modulePath('imagecuts-menu.mjs')).href + `?task8=${Date.now()}`);
  assert.deepEqual(Object.keys(namespace), ['createImageCutsMenu']);
  assert.equal(typeof namespace.createImageCutsMenu, 'function');
});

test('Task 8 이미지컷 contract/controller/view 모듈은 각각 250 pure LOC 이하이다', () => {
  for (const file of IMAGECUTS_MODULES) {
    assert.equal(fs.existsSync(modulePath(file)), true, `${file}: 분리 모듈이 존재해야 한다`);
    const loc = pureLoc(fs.readFileSync(modulePath(file), 'utf8'));
    assert.ok(loc <= 250, `${file}: ${loc} pure LOC`);
  }
});
