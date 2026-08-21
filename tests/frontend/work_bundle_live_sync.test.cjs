const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadModule() {
  const modulePath = path.resolve(__dirname, '../../src/modules/work-bundle-live-sync.mjs');
  return import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
}

function fakeTimers() {
  let sequence = 0;
  const entries = new Map();
  return {
    setTimer(callback, delay) {
      sequence += 1;
      entries.set(sequence, { callback, delay });
      return sequence;
    },
    clearTimer(id) {
      entries.delete(id);
    },
    entries,
    async runNext() {
      const first = entries.entries().next().value;
      assert.ok(first, '실행할 예약 작업이 있어야 합니다.');
      const [id, entry] = first;
      entries.delete(id);
      await entry.callback();
    },
  };
}

test('여러 이미지의 로컬 저장 알림을 한 번의 최신 작업 묶음 동기화로 합친다', async () => {
  const { createWorkBundleLiveSync } = await loadModule();
  const timers = fakeTimers();
  const calls = [];
  const controller = createWorkBundleLiveSync({
    buildBundle: async () => ({ project: { id: 'work-1' } }),
    synchronize: async (bundle, options) => {
      calls.push({ bundle, options });
      return { uploads: [] };
    },
    hasPending: () => false,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    debounceMs: 700,
  });

  controller.request('대표 이미지 1 저장');
  controller.request('대표 이미지 2 저장');
  controller.request('대표 이미지 3 저장');

  assert.equal(timers.entries.size, 1);
  assert.equal([...timers.entries.values()][0].delay, 700);
  await timers.runNext();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.reason, '대표 이미지 3 저장');
  assert.equal(calls[0].options.sourceScheme, 'local-archive');
});

test('옵션 원본 저장은 사용자의 연속 드래그가 끝난 뒤까지 자산관 동기화를 미룬다', async () => {
  const { createWorkBundleLiveSync } = await loadModule();
  const timers = fakeTimers();
  const controller = createWorkBundleLiveSync({
    buildBundle: async () => ({ project: { id: 'work-options' } }),
    synchronize: async () => ({ uploads: [] }),
    hasPending: () => false,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    debounceMs: 900,
  });

  controller.request('색상 옵션 원본 로컬 저장', {
    debounceMs: 6000,
    fullReconcile: false,
  });

  assert.equal(timers.entries.size, 1);
  assert.equal([...timers.entries.values()][0].delay, 6000);
});

test('동기화 실패는 대기로 남기고 다음 재시도에서 자동 복구한다', async () => {
  const { createWorkBundleLiveSync } = await loadModule();
  const timers = fakeTimers();
  let attempts = 0;
  const states = [];
  const controller = createWorkBundleLiveSync({
    buildBundle: async () => ({ project: { id: 'work-2' } }),
    synchronize: async () => {
      attempts += 1;
      return attempts === 1 ? null : { uploads: [] };
    },
    hasPending: () => true,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    retryDelays: [1500, 5000],
    onState: (state) => states.push(state),
  });

  const first = await controller.request('생성 이미지 저장', { immediate: true });
  assert.equal(first, null);
  assert.equal([...timers.entries.values()][0].delay, 1500);
  assert.ok(states.some((state) => state.status === 'retry-waiting'));

  await timers.runNext();
  assert.equal(attempts, 2);
  assert.ok(states.some((state) => state.status === 'synced'));
  assert.equal(timers.entries.size, 0);
});

test('프로그램 시작 때 남은 대기가 있으면 즉시 재전송한다', async () => {
  const { createWorkBundleLiveSync } = await loadModule();
  let synchronized = 0;
  const controller = createWorkBundleLiveSync({
    buildBundle: async () => ({ project: { id: 'work-3' } }),
    synchronize: async () => {
      synchronized += 1;
      return { uploads: [] };
    },
    hasPending: () => true,
  });

  await controller.replayPending('프로그램 시작');
  assert.equal(synchronized, 1);
});

test('작업파일 저장은 대기 시간을 건너뛰고 전체 대조를 즉시 실행한다', async () => {
  const { createWorkBundleLiveSync } = await loadModule();
  const calls = [];
  const controller = createWorkBundleLiveSync({
    buildBundle: async () => ({ project: { id: 'work-4' } }),
    synchronize: async (_bundle, options) => {
      calls.push(options);
      return { uploads: [] };
    },
    hasPending: () => false,
  });

  await controller.request('작업파일 저장', {
    immediate: true,
    fullReconcile: true,
    sourceScheme: 'workfile-handle',
    fileName: '호박바늘쌈.kuasangse',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fullReconcile, true);
  assert.equal(calls[0].sourceScheme, 'workfile-handle');
  assert.equal(calls[0].fileName, '호박바늘쌈.kuasangse');
});

test('현재 열어 둔 작업 묶음은 5초마다 활동 상태를 보내고 종료 시 멈춘다', async () => {
  const { createWorkBundleActivityHeartbeat } = await loadModule();
  let currentBundleKey = 'kuasangse:work-live-1';
  let intervalCallback = null;
  let clearedTimer = null;
  const calls = [];
  const controller = createWorkBundleActivityHeartbeat({
    getBundleKey: () => currentBundleKey,
    sendActivity: async (activity) => {
      calls.push(activity);
      return { expiresInSeconds: 15 };
    },
    clientId: 'browser-session-1',
    setIntervalFn: (callback, delay) => {
      assert.equal(delay, 5000);
      intervalCallback = callback;
      return 42;
    },
    clearIntervalFn: (timer) => {
      clearedTimer = timer;
    },
  });

  await controller.start();
  assert.deepEqual(calls, [{
    bundleKey: 'kuasangse:work-live-1',
    clientId: 'browser-session-1',
  }]);

  currentBundleKey = 'kuasangse:work-live-2';
  await intervalCallback();
  assert.deepEqual(calls[1], {
    bundleKey: 'kuasangse:work-live-2',
    clientId: 'browser-session-1',
  });

  controller.dispose();
  assert.equal(clearedTimer, 42);
});

test('최초 작업 묶음 동기화가 끝나기 전에는 heartbeat 활동 요청을 보내지 않는다', async () => {
  const { createWorkBundleActivityHeartbeat } = await loadModule();
  let ready = false;
  let intervalCallback = null;
  const calls = [];
  const controller = createWorkBundleActivityHeartbeat({
    getBundleKey: () => 'kuasangse:work-startup',
    isReady: () => ready,
    sendActivity: async activity => { calls.push(activity); },
    clientId: 'browser-session-startup',
    setIntervalFn: callback => { intervalCallback = callback; return 7; },
    clearIntervalFn() {},
  });

  await controller.start();
  assert.equal(calls.length, 0, 'remote bundle이 생기기 전 activity POST를 보내면 안 된다');
  ready = true;
  await intervalCallback();
  assert.equal(calls.length, 1);
});
