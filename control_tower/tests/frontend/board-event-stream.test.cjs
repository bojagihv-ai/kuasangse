// 화면을 열 때마다 관제탑이 요청 폭풍을 맞던 자리를 지킨다.
// 실측 2026-08-28: 보드가 cursor=0 으로 붙어 이벤트 이력을 통째로 되받고 한 건마다
// 다시 읽어, 4초 동안 1,300건(초당 350건)이 나갔다. 크롬의 호스트당 연결이 바닥나
// 그 사이 사람이 누른 투입 요청은 소켓을 못 얻고 그대로 멎었다.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BOARD_URL = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'production-board.mjs'),
).href;

// 보드는 그리기 위해 DOM 을 쓴다. 여기서 재는 것은 그림이 아니라 나가는 요청 수라
// 노드는 최소한만 흉내 낸다.
class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  remove() {}
  focus() {}
}

function installFakeDocument(t) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: tagName => new FakeElement(tagName),
    createTextNode: value => ({ textContent: String(value) }),
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    body: new FakeElement('body'),
  };
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: { href: 'http://127.0.0.1:8083/control-tower.html' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  };
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
  return new FakeElement('div');
}

function fakeEventSourceFactory(opened) {
  return class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      opened.push(this);
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    emit(type) {
      for (const handler of this.listeners.get(type) || []) handler({ type });
    }
    close() { this.closed = true; }
  };
}

function harness({ eventCursor = '1997' } = {}) {
  const calls = [];
  const runtime = {
    factoryBackend: 'http://127.0.0.1:5062',
    factoryApp: 'http://127.0.0.1:8081',
    assetUrl: value => `http://127.0.0.1:5062${value}`,
    setStatus() {},
    apiRequest: async (path) => {
      calls.push(path);
      if (path === '/api/factory/state') {
        return { connected: true, capturedAt: '2026-08-28T00:00:00Z', eventCursor };
      }
      return { jobs: [] };
    },
  };
  return { runtime, calls };
}

test('보드는 방금 읽은 자리부터 이벤트를 듣는다 — 이력을 되받지 않는다', async t => {
  const { mountProductionBoard } = await import(BOARD_URL);
  const { runtime } = harness({ eventCursor: '1997' });
  const opened = [];
  const root = installFakeDocument(t);

  const stop = mountProductionBoard(runtime, {
    root,
    EventSourceImpl: fakeEventSourceFactory(opened),
    fetchJobs: async () => ({ jobs: [] }),
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(opened.length, 1);
  // cursor=0 이면 관제탑이 쌓아 둔 이벤트를 전부 되돌려준다.
  assert.doesNotMatch(opened[0].url, /cursor=0(&|$)/);
  assert.match(opened[0].url, /cursor=1997/);
  stop();
});

test('이벤트가 몰아쳐도 다시 읽기는 한 번만 나간다', async t => {
  const { mountProductionBoard } = await import(BOARD_URL);
  const { runtime, calls } = harness();
  const opened = [];
  const root = installFakeDocument(t);

  const stop = mountProductionBoard(runtime, {
    root,
    EventSourceImpl: fakeEventSourceFactory(opened),
    fetchJobs: async () => ({ jobs: [] }),
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  const beforeBurst = calls.filter(item => item === '/api/factory/state').length;

  // 이력 재생처럼 한꺼번에 200건이 쏟아지는 상황.
  for (let index = 0; index < 200; index += 1) opened[0].emit('factory.product.updated');
  await new Promise(resolve => setTimeout(resolve, 400));

  const afterBurst = calls.filter(item => item === '/api/factory/state').length;
  assert.equal(afterBurst - beforeBurst, 1);
  stop();
});
