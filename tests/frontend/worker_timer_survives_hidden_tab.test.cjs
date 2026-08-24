'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_URL = pathToFileURL(path.join(ROOT, 'src/modules/unthrottled-interval.mjs')).href;

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fakeWindow({ withWorker = true } = {}) {
  const posted = [];
  const worker = { postMessage: message => posted.push(message), onmessage: null };
  const windowObject = {
    setInterval: () => 'window-timer',
    clearInterval: () => {},
    posted,
    worker,
  };
  if (withWorker) {
    windowObject.Worker = function Worker() { return worker; };
    windowObject.Blob = function Blob() {};
    windowObject.URL = { createObjectURL: () => 'blob:clock', revokeObjectURL: () => {} };
  }
  return windowObject;
}

test('시계를 전용 워커로 옮긴다', async () => {
  // 크롬은 숨은 탭의 setInterval 을 1분에 한 번까지 늦춘다. 실측에서 5초 간격이
  // 60초, 93초로 벌어졌고 그동안 관제탑이 워커 세션을 끊어 큐가 멈췄다.
  const { createUnthrottledTimers } = await import(MODULE_URL);
  const windowObject = fakeWindow();
  const timers = createUnthrottledTimers(windowObject);

  assert.equal(timers.backing, 'worker');
  timers.setIntervalImpl(() => {}, 15000);
  assert.deepEqual(windowObject.posted, [{ type: 'start', id: 1, delay: 15000 }]);
});

test('워커 시계가 울리면 그 콜백만 부른다', async () => {
  const { createUnthrottledTimers } = await import(MODULE_URL);
  const windowObject = fakeWindow();
  const timers = createUnthrottledTimers(windowObject);
  const fired = [];
  const first = timers.setIntervalImpl(() => fired.push('first'), 1000);
  timers.setIntervalImpl(() => fired.push('second'), 1000);

  windowObject.worker.onmessage({ data: { id: first } });
  assert.deepEqual(fired, ['first']);
});

test('멈춘 시계는 다시 울리지 않는다', async () => {
  const { createUnthrottledTimers } = await import(MODULE_URL);
  const windowObject = fakeWindow();
  const timers = createUnthrottledTimers(windowObject);
  const fired = [];
  const id = timers.setIntervalImpl(() => fired.push('tick'), 1000);

  timers.clearIntervalImpl(id);
  windowObject.worker.onmessage({ data: { id } });

  assert.deepEqual(fired, []);
  assert.deepEqual(windowObject.posted.at(-1), { type: 'stop', id });
});

test('워커를 못 쓰는 곳에서는 창 시계로 돈다', async () => {
  // 늦더라도 도는 편이, 아예 안 도는 것보다 낫다.
  const { createUnthrottledTimers } = await import(MODULE_URL);
  const timers = createUnthrottledTimers(fakeWindow({ withWorker: false }));

  assert.equal(timers.backing, 'window');
  assert.equal(timers.setIntervalImpl(() => {}, 1000), 'window-timer');
});

test('배치 워커가 이 시계를 실제로 쓴다', () => {
  const loader = source('src/app-loader.js');
  assert.ok(loader.includes('createUnthrottledTimers'), '로더가 워커 시계를 만들지 않습니다');
  const at = loader.indexOf('installBatchControlWorker(window, {');
  assert.notEqual(at, -1);
  const region = loader.slice(at, at + 900);
  assert.ok(region.includes('workerTimers.setIntervalImpl'), '배치 워커에 워커 시계를 넘기지 않습니다');
  assert.ok(!region.includes('window.setInterval.bind'), '아직 창 시계를 넘깁니다');
});

test('새 모듈이 런타임 목록에 등록돼 있다', () => {
  assert.ok(source('src/runtime-manifest.json').includes('src/modules/unthrottled-interval.mjs'));
  assert.ok(source('src/modules/runtime-module-ids.mjs').includes('src/modules/unthrottled-interval.mjs'));
});
