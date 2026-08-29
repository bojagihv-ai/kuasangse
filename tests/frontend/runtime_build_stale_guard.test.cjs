'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const LOADER = path.join(ROOT, 'src', 'app-loader.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('normal app installs a stale-build gate after the coordinated boot is ready', () => {
  const source = fs.readFileSync(LOADER, 'utf8');
  assert.match(source, /function installRuntimeBuildFreshnessGuard\s*\(/);
  assert.match(source, /id\s*=\s*['"]kuasangseRuntimeStaleGate['"]/);
  assert.match(source, /새 빌드 적용/);
  assert.match(source, /if \(!isBatchWorker\)[\s\S]{0,240}?installRuntimeBuildFreshnessGuard\(\s*buildId\b/);
  // 내용 지문까지 넘겨야 '같은 번호 다른 내용' 을 잡는다. 번호만 넘기면 가드가 침묵한다.
  assert.match(source, /installRuntimeBuildFreshnessGuard\([\s\S]{0,80}?runtimeBuildSignature\(manifest\)/);
});

test('build guard blocks a stale tab exactly once and keeps same-build tabs interactive', async () => {
  const source = fs.readFileSync(LOADER, 'utf8');
  const guardSource = sourceSlice(
    source,
    'function runtimeBuildId(',
    '\n  async function loadApp(',
  );
  const windowListeners = new Map();
  const documentListeners = new Map();
  let intervalCallback = null;
  let clearedInterval = null;
  const fakeWindow = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
    setInterval(callback) { intervalCallback = callback; return 17; },
    clearInterval(value) { clearedInterval = value; },
  };
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
  };
  const context = vm.createContext({ RUNTIME_BUILD_CHECK_INTERVAL_MS: 15000 });
  vm.runInContext(`${guardSource}\nthis.installGuard = installRuntimeBuildFreshnessGuard;`, context);
  const manifests = [{ buildId: 'v581' }, { buildId: 'v582' }, { buildId: 'v583' }];
  const staleCalls = [];
  const guard = context.installGuard('v581', {
    windowObject: fakeWindow,
    documentObject: fakeDocument,
    readManifest: async () => manifests.shift(),
    onStale: (current, next) => staleCalls.push([current, next]),
    intervalMs: 25,
  });

  assert.equal(await guard.checkNow(), false);
  assert.deepEqual(staleCalls, []);
  assert.equal(await guard.checkNow(), true);
  assert.deepEqual(staleCalls, [['v581', 'v582']]);
  assert.equal(await guard.checkNow(), true);
  assert.deepEqual(staleCalls, [['v581', 'v582']], 'stale gate must be installed once');
  assert.equal(typeof intervalCallback, 'function');
  assert.equal(typeof windowListeners.get('focus'), 'function');
  assert.equal(typeof documentListeners.get('visibilitychange'), 'function');

  guard.dispose();
  assert.equal(clearedInterval, 17);
  assert.equal(windowListeners.size, 0);
  assert.equal(documentListeners.size, 0);
});

test('build guard interval does not poll while its tab is hidden', async () => {
  const source = fs.readFileSync(LOADER, 'utf8');
  const guardSource = sourceSlice(
    source,
    'function runtimeBuildId(',
    '\n  async function loadApp(',
  );
  let intervalCallback = null;
  let readCalls = 0;
  const fakeWindow = {
    addEventListener() {},
    removeEventListener() {},
    setInterval(callback) { intervalCallback = callback; return 19; },
    clearInterval() {},
  };
  const fakeDocument = {
    visibilityState: 'hidden',
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({ RUNTIME_BUILD_CHECK_INTERVAL_MS: 15000 });
  vm.runInContext(`${guardSource}\nthis.installGuard = installRuntimeBuildFreshnessGuard;`, context);
  context.installGuard('v581', {
    windowObject: fakeWindow,
    documentObject: fakeDocument,
    readManifest: async () => {
      readCalls += 1;
      return { buildId: 'v581' };
    },
    intervalMs: 25,
  });

  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readCalls, 0, '숨겨진 앱 탭은 manifest를 반복 조회하면 안 됩니다.');

  fakeDocument.visibilityState = 'visible';
  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readCalls, 1, '다시 보이는 탭은 기존처럼 build freshness를 확인해야 합니다.');
});
