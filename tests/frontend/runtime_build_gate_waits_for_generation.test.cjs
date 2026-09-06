'use strict';

// 계약: **생성이 돌고 있는 동안에는 새 빌드 창이 뜨지 않는다.**
//
// 실측 2026-09-06: 사이즈컷 3장을 만드는 도중 번들이 바뀌어 "새 빌드가 적용되었습니다" 창이
// 떴고, 사장님이 누르자 새로고침되며 1장만 남았다(실행 로그 마지막 줄 "사이즈컷 2 생성 시작").
// 이미지컷도 같은 무늬로 3장 중 1장만 남았다.
//
// 로더는 런타임(window.kuasangseImageGenerationBusy)에 묻고, 바쁘면 창을 미룬다.
// 미루는 시간에는 상한이 있다 - 생성 표시가 잘못 남아 영영 바쁘다고 하는 경우를 막는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const LOADER = path.join(ROOT, 'src', 'app-loader.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function installGuardHarness() {
  const source = fs.readFileSync(LOADER, 'utf8');
  const guardSource = sourceSlice(source, 'function runtimeBuildId(', '\n  async function loadApp(');
  const context = vm.createContext({ RUNTIME_BUILD_CHECK_INTERVAL_MS: 15000 });
  vm.runInContext(`${guardSource}\nthis.installGuard = installRuntimeBuildFreshnessGuard;`, context);
  const fakeWindow = {
    addEventListener() {},
    removeEventListener() {},
    setInterval() { return 1; },
    clearInterval() {},
  };
  const fakeDocument = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  return { context, fakeWindow, fakeDocument };
}

test('생성 중이면 새 빌드 창을 미루고, 생성이 끝나면 그때 띄운다', async () => {
  const { context, fakeWindow, fakeDocument } = installGuardHarness();
  let busy = true;
  const staleCalls = [];
  const deferredCalls = [];
  const guard = context.installGuard('v1', {
    windowObject: fakeWindow,
    documentObject: fakeDocument,
    readManifest: async () => ({ buildId: 'v2' }),
    onStale: (current, next) => staleCalls.push([current, next]),
    onDeferred: (current, next) => deferredCalls.push([current, next]),
    isBusy: () => busy,
    intervalMs: 25,
  });

  assert.equal(await guard.checkNow(), false, '바쁜 동안은 낡았다고 판정하지 않는다');
  assert.equal(await guard.checkNow(), false);
  assert.deepEqual(staleCalls, [], '생성 중에 창이 뜨면 사장님이 눌러 생성을 죽인다');
  assert.deepEqual(deferredCalls, [['v1', 'v2'], ['v1', 'v2']], '미뤘다는 표시는 남긴다');

  busy = false;
  assert.equal(await guard.checkNow(), true, '생성이 끝나면 다음 확인에서 창을 띄운다');
  assert.deepEqual(staleCalls, [['v1', 'v2']]);
  assert.equal(await guard.checkNow(), true);
  assert.deepEqual(staleCalls, [['v1', 'v2']], '창은 한 번만');
});

test('바쁘다는 표시가 상한을 넘겨 남아 있으면 그래도 창을 띄운다', async () => {
  const { context, fakeWindow, fakeDocument } = installGuardHarness();
  const staleCalls = [];
  const guard = context.installGuard('v1', {
    windowObject: fakeWindow,
    documentObject: fakeDocument,
    readManifest: async () => ({ buildId: 'v2' }),
    onStale: (current, next) => staleCalls.push([current, next]),
    onDeferred: () => {},
    isBusy: () => true,
    deferMaxMs: 0,
    intervalMs: 25,
  });
  assert.equal(await guard.checkNow(), true);
  assert.deepEqual(staleCalls, [['v1', 'v2']]);
});

test('기본 판정은 런타임의 window.kuasangseImageGenerationBusy 를 묻는다 (없으면 안 바쁨)', async () => {
  const { context, fakeWindow, fakeDocument } = installGuardHarness();
  const staleCalls = [];
  fakeWindow.kuasangseImageGenerationBusy = () => true;
  const guard = context.installGuard('v1', {
    windowObject: fakeWindow,
    documentObject: fakeDocument,
    readManifest: async () => ({ buildId: 'v2' }),
    onStale: (current, next) => staleCalls.push([current, next]),
    onDeferred: () => {},
    intervalMs: 25,
  });
  assert.equal(await guard.checkNow(), false, '런타임이 바쁘다면 미룬다');
  delete fakeWindow.kuasangseImageGenerationBusy;
  assert.equal(await guard.checkNow(), true, '판정 함수가 없으면 예전처럼 바로 띄운다');
  assert.equal(staleCalls.length, 1);
});

test('런타임의 바쁨 판정: 단계 실행 키 · 진행 중 요청 · 자동 실행 중 하나라도 있으면 바쁘다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const registries = sourceSlice(source, 'const factoryActiveImageStageRunKeys = new Set();', 'const FACTORY_IMAGE_GENERATION_PAGE_SESSION_ID');
  const busyFn = sourceSlice(source, 'function factoryImageGenerationBusy(', 'if (typeof window');
  assert.match(source, /window\.kuasangseImageGenerationBusy = factoryImageGenerationBusy/, '로더가 묻는 이름으로 내놓아야 한다');

  let goalRunning = false;
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => ({ goalRun: { running: goalRunning } }),
  });
  vm.runInContext(`${registries}\n${busyFn}\nthis.busy = factoryImageGenerationBusy; this.runKeys = factoryActiveImageStageRunKeys; this.requestKeys = factoryActiveImageRequestKeys;`, context);

  assert.equal(context.busy(), false, '아무것도 없으면 한가하다');
  context.runKeys.add('size:run_1');
  assert.equal(context.busy(), true, '전체 생성 루프가 도는 동안(단계 실행 키) 바쁘다 - 요청과 요청 사이 틈에도');
  context.runKeys.clear();
  context.requestKeys.set('size:run_1:label', { startedAt: Date.now() });
  assert.equal(context.busy(), true, 'API 요청이 나가 있으면 바쁘다');
  context.requestKeys.clear();
  goalRunning = true;
  assert.equal(context.busy(), true, '조립공장 자동 실행 중이면 바쁘다');
  goalRunning = false;
  assert.equal(context.busy(), false);
});
