'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('새 빌드 재로딩은 현재 작업을 저장한 뒤에만 페이지를 교체한다', () => {
  const loader = read('src/app-loader.js');
  assert.match(
    loader,
    /flushLastWorkBeforeRuntimeReload\(\)/,
    'stale-build gate must use the durable runtime-reload flush instead of the unload-only checkpoint',
  );
  assert.match(
    loader,
    /await window\.flushLastWorkBeforeRuntimeReload\(\)/,
    'stale-build gate must await the durable flush before reload',
  );
});

test('runtime 재로딩 flush는 A 상태를 저장 완료까지 기다린다', () => {
  const core02 = read('src/app-core-02.js');
  const flushSource = sourceSlice(
    core02,
    'async function flushLastWorkBeforeRuntimeReload(',
    'function resetLastWorkBeforeLeaveFlush(',
  );
  assert.match(flushSource, /await saveLastWorkNow\(/);
  assert.match(flushSource, /force:\s*true/);
  assert.match(flushSource, /await settleLastWorkBootstrapWrites\(\)/);
  assert.match(flushSource, /await settleWorkspaceScopeTransitionPersistence\(\)/);
});
