'use strict';

// 계약: **앱이 관제탑 이벤트 스트림을 듣고, 관제탑이 바뀌면 작업 목록을 다시 읽는다 (통합 4단계).**
//
// 주인님 2026-09-06: "작업중인게 실시간으로 동기화로 볼 수 있어야 하는데".
// 관제탑 화면의 실측(2026-08-28)대로 cursor=0 으로 붙지 않는다 - 쌓인 이벤트 수천 건이 한꺼번에 쏟아진다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function harness({ stateCursor = '77', sessionOk = true } = {}) {
  const core = read('src/app-core-06.js');
  const block = sourceSlice(core, 'const FACTORY_TOWER_EVENT_TYPES = Object.freeze([', '\nfunction factoryTowerJobDocumentScope(');
  const sources = [];
  class FakeEventSource {
    constructor(url, options) {
      this.url = url; this.options = options; this.listeners = {}; this.readyState = 0; this.onopen = null; this.onerror = null;
      sources.push(this);
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type) { (this.listeners[type] || []).forEach(handler => handler({ type })); }
  }
  const timers = [];
  const refreshCalls = [];
  const fetchCalls = [];
  let renders = 0;
  const state = { factoryTowerJobs: { items: [], fetchedAt: 1, loading: false, error: '', base: 'http://127.0.0.1:41009' } };
  const context = vm.createContext({
    state,
    EventSource: FakeEventSource,
    Date,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    encodeURIComponent,
    fetch: async (url, options) => {
      fetchCalls.push([url, options]);
      if (url.endsWith('/api/session')) return { ok: sessionOk, status: sessionOk ? 200 : 500 };
      if (url.endsWith('/api/factory/state')) return { ok: true, status: 200, json: async () => ({ eventCursor: stateCursor }) };
      throw new Error('unexpected fetch ' + url);
    },
    factoryTowerJobsState: () => state.factoryTowerJobs,
    factoryControlTowerBases: () => ['http://127.0.0.1:41009'],
    factoryTowerJobsRefresh: async options => { refreshCalls.push(options); return state.factoryTowerJobs; },
    render: () => { renders += 1; },
  });
  vm.runInContext(`${block}\nthis.connect = factoryTowerLiveConnect; this.liveState = factoryTowerLiveState; this.types = FACTORY_TOWER_EVENT_TYPES;`, context);
  return { context, sources, timers, refreshCalls, fetchCalls, state, renders: () => renders };
}

test('세션 쿠키를 받고, 지금 커서부터 듣는다 (cursor=0 금지) - 그리고 이벤트가 오면 목록을 다시 읽는다', async () => {
  const h = harness({ stateCursor: '77' });
  assert.equal(await h.context.connect({ render: true }), true);
  assert.deepEqual(h.fetchCalls.map(([url]) => url), ['http://127.0.0.1:41009/api/session', 'http://127.0.0.1:41009/api/factory/state']);
  assert.equal(h.fetchCalls[0][1].credentials, 'include', '이벤트 스트림은 관제탑 세션 쿠키를 요구한다');
  assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].url, 'http://127.0.0.1:41009/api/factory/events?cursor=77');
  assert.equal(h.sources[0].options.withCredentials, true);
  const live = h.context.liveState();
  assert.equal(live.connected, false);
  h.sources[0].onopen();
  assert.equal(live.connected, true);
  assert.ok(h.renders() >= 1, '연결되면 화면에 "실시간 연결" 이 뜬다');
  // 관제탑 화면이 듣는 이벤트를 같이 듣는다
  for (const type of ['factory.snapshot', 'factory.product.updated', 'factory.a_cut.selected', 'factory.stage.updated', 'factory.product.checkpoint.rebound']) {
    assert.ok(h.context.types.includes(type), type);
    assert.ok(h.sources[0].listeners[type]?.length, `${type} 을 듣는다`);
  }
  h.sources[0].emit('factory.product.updated');
  assert.equal(live.lastEventType, 'factory.product.updated');
  const refreshTimer = h.timers.find(timer => timer.ms === 1200);
  assert.ok(refreshTimer, '이벤트는 1.2초 모아서 한 번만 다시 읽는다');
  refreshTimer.fn();
  // vm 안에서 만든 객체는 프로토타입이 달라 strict deepEqual 이 거짓 실패한다 - 값만 비교한다.
  assert.deepEqual(JSON.parse(JSON.stringify(h.refreshCalls)), [{ render: true, quiet: true, live: false }], '다시 읽을 때 또 연결하지 않는다(live:false)');
  // 이미 연결돼 있으면 다시 만들지 않는다
  assert.equal(await h.context.connect(), true);
  assert.equal(h.sources.length, 1);
});

test('브라우저가 재시도를 포기하면(readyState 2) 30초 뒤 처음부터 다시 잇는다', async () => {
  const h = harness();
  await h.context.connect({ render: true });
  const source = h.sources[0];
  source.onopen();
  source.readyState = 2;
  source.onerror();
  const live = h.context.liveState();
  assert.equal(live.connected, false);
  assert.match(live.error, /다시 잇는 중/);
  const reconnect = h.timers.find(timer => timer.ms === 30000);
  assert.ok(reconnect, '30초 뒤 재연결');
  reconnect.fn();
  // 재연결은 세션·상태를 다시 받은 뒤(비동기) 스트림을 만든다 - 몇 틱 기다린다.
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.sources.length, 2, '새 스트림을 만든다');
});

test('세션을 못 받으면 연결 실패를 화면에 남기고 30초 뒤 다시 시도한다', async () => {
  const h = harness({ sessionOk: false });
  assert.equal(await h.context.connect(), false);
  const live = h.context.liveState();
  assert.match(live.error, /실시간 연결 실패/);
  assert.ok(h.timers.some(timer => timer.ms === 30000));
});

test('목록 조회 성공 뒤 연결을 시작하고, 카드에 실시간 표시가 있다', () => {
  const core06 = read('src/app-core-06.js');
  const core05 = read('src/app-core-05.js');
  const refresh = sourceSlice(core06, 'async function factoryTowerJobsRefresh(', '\n// ── 관제탑 실시간 연결');
  assert.match(refresh, /if \(loaded && options\.live !== false\) void factoryTowerLiveConnect\(/);
  assert.match(core05, /data-factory-tower-live="on"[^>]*>실시간 연결/);
  assert.match(core05, /data-factory-tower-live="off"/);
  // EventSource 는 state 밖에 둔다 - state 는 structuredClone 으로 복제된다.
  assert.match(core06, /let factoryTowerEventSource = null;/);
  assert.doesNotMatch(sourceSlice(core06, 'function factoryTowerLiveState(', '\nfunction factoryTowerScheduleRefresh('), /EventSource/);
});
