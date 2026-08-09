'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const LOADER = path.join(ROOT, 'src', 'app-loader.js');
const APP_HTML = path.join(ROOT, 'app.html');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('runtime import map gives transitive ESM imports the manifest build id before bootstrap import', () => {
  const source = fs.readFileSync(LOADER, 'utf8');
  const cacheBustSource = sourceSlice(
    source,
    '  const RUNTIME_BOOT_CACHE_TOKEN',
    '  function workspaceAuthorityServerBases(',
  );
  const appended = [];
  const document = {
    baseURI: 'http://127.0.0.1:8081/app.html',
    createElement: tagName => ({ tagName, dataset: {}, textContent: '', type: '' }),
    head: { appendChild: node => appended.push(node) },
  };
  const { install, bootToken } = new Function(
    'document',
    `${cacheBustSource}; return { install: installRuntimeImportMap, bootToken: RUNTIME_BOOT_CACHE_TOKEN };`,
  )(document);

  install(['src/modules/workspace-mutations.mjs', 'src/modules/persistence/indexeddb-adapter.mjs'], 'build-v280');

  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, 'importmap');
  const imports = JSON.parse(appended[0].textContent).imports;
  assert.equal(
    imports['http://127.0.0.1:8081/src/modules/persistence/indexeddb-adapter.mjs'],
    `http://127.0.0.1:8081/src/modules/persistence/indexeddb-adapter.mjs?v=build-v280&boot=${encodeURIComponent(bootToken)}`,
  );
  assert.match(bootToken, /^boot-/);
  const installIndex = source.indexOf('installRuntimeImportMap(\n        [BOOTSTRAP_MODULE');
  const firstModuleImportIndex = source.indexOf('await import(resourceUrl(BOOTSTRAP_MODULE, buildId))');
  assert.ok(installIndex > 0 && installIndex < firstModuleImportIndex);
});

test('app shell gives the outer runtime loader a fresh token on every page boot', () => {
  const source = fs.readFileSync(APP_HTML, 'utf8');

  assert.match(source, /const LOADER_BOOT_CACHE_TOKEN = `loader-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`/);
  assert.match(source, /loaderUrl\.searchParams\.set\('boot', LOADER_BOOT_CACHE_TOKEN\)/);
});
