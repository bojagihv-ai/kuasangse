const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const MODULE_URL = pathToFileURL(path.join(FRONTEND, 'src', 'tab-liveness.mjs')).href;

function fakeWindow({ withLocks = true } = {}) {
  const listeners = new Map();
  const requests = [];
  let clock = 5000;
  return {
    tick(ms) { clock += ms; },
    emit(type) { for (const handler of [...(listeners.get(type) || [])]) handler(); },
    requests,
    listenerCount(type) { return (listeners.get(type) || []).length; },
    windowObject: {
      Date: { now: () => clock },
      document: {
        addEventListener(type, handler) {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
          const list = listeners.get(type) || [];
          const index = list.indexOf(handler);
          if (index >= 0) list.splice(index, 1);
        },
      },
      navigator: withLocks
        ? { locks: { request(name, holder) { requests.push(name); return Promise.resolve(holder()); } } }
        : {},
    },
  };
}

test('관제탑 화면도 잠금을 쥐어 크롬이 얼리지 못하게 한다', async () => {
  const { installTabLiveness, TAB_LIVENESS_LOCK } = await import(MODULE_URL);
  const host = fakeWindow();

  const liveness = installTabLiveness(host.windowObject);

  assert.equal(liveness.held, true);
  assert.deepEqual(host.requests, [TAB_LIVENESS_LOCK]);
  // 워커 탭 잠금과 이름이 달라야 서로를 밀어내지 않는다.
  assert.notEqual(TAB_LIVENESS_LOCK, 'kuasangse.batch-worker.tab-liveness');
});

test('얼었다 깨어나면 얼마나 멈춰 있었는지 알리고 다시 읽게 한다', async () => {
  // 화면이 멈춘 줄 모르면 옛 그림을 지금 상태로 읽는다. 그것이 이 기능의 이유다.
  const { installTabLiveness } = await import(MODULE_URL);
  const host = fakeWindow();
  const liveness = installTabLiveness(host.windowObject);
  const seen = [];
  liveness.onResumed(state => seen.push(state));

  host.emit('freeze');
  assert.equal(liveness.liveness().frozen, true);
  host.tick(95_000);
  host.emit('resume');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].lastFreeze.durationMs, 95_000);
  assert.equal(liveness.liveness().frozen, false);
  assert.equal(liveness.liveness().freezeCount, 1);
});

test('짧게 얼었다 깬 것은 사람에게 알리지 않는다', async () => {
  // 탭을 잠깐 전환할 때마다 경고가 뜨면 진짜 경고를 안 읽게 된다.
  const { describeFreeze, STALE_AFTER_MS } = await import(MODULE_URL);

  assert.equal(describeFreeze({ lastFreeze: { durationMs: STALE_AFTER_MS - 1 } }), '');
  assert.equal(describeFreeze(null), '');
  assert.match(describeFreeze({ lastFreeze: { durationMs: 45_000 } }), /45초 동안 멈춰/);
  assert.match(describeFreeze({ lastFreeze: { durationMs: 180_000 } }), /3분 동안 멈춰/);
});

test('잠금을 못 쓰는 브라우저에서도 화면은 그대로 돈다', async () => {
  const { installTabLiveness } = await import(MODULE_URL);
  const host = fakeWindow({ withLocks: false });

  const liveness = installTabLiveness(host.windowObject);

  assert.equal(liveness.held, false);
  assert.equal(host.requests.length, 0);
  host.emit('freeze');
  assert.equal(liveness.liveness().frozen, true);
});

test('관제탑 화면이 이 보호를 실제로 싣는다', () => {
  // 모듈만 있고 화면이 안 부르면 아무 일도 일어나지 않는다.
  const html = fs.readFileSync(path.join(FRONTEND, 'control-tower.html'), 'utf8');
  assert.match(html, /installTabLiveness/);
  assert.match(html, /tab-liveness\.mjs\?tabLiveness=\d+/);
});
