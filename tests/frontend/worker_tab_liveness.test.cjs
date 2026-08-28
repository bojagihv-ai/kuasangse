const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE_URL = pathToFileURL(path.join(ROOT, 'src', 'modules', 'worker-tab-liveness.mjs')).href;

function fakeWindow({ withLocks = true } = {}) {
  const listeners = new Map();
  const requests = [];
  let clock = 1000;
  return {
    tick(ms) { clock += ms; },
    emit(type) { for (const handler of listeners.get(type) || []) handler(); },
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

test('worker tab liveness is registered as one runtime module ahead of its consumer', async () => {
  // 순서가 중요하다: 설치 모듈이 이것을 import 하므로 번들에서 먼저 실려야 한다.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8'));
  const liveness = manifest.modules.indexOf('src/modules/worker-tab-liveness.mjs');
  const install = manifest.modules.indexOf('src/modules/batch-control-worker-install.mjs');
  assert.equal(manifest.modules.filter(item => item === 'src/modules/worker-tab-liveness.mjs').length, 1);
  assert.ok(liveness >= 0 && liveness < install);

  const ids = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'runtime-module-ids.mjs')));
  assert.ok(ids.KNOWN_FOUNDATION_MODULE_IDS.includes('src/modules/worker-tab-liveness.mjs'));
});

test('the worker tab holds a lock so chrome does not freeze it', async () => {
  // 잠금을 쥔 문서는 크로미엄이 얼리지 않는다. 이 잠금이 큐를 계속 흐르게 하는 보험이다.
  const { installWorkerTabLiveness, WORKER_TAB_LIVENESS_LOCK } = await import(MODULE_URL);
  const host = fakeWindow();

  const receipt = installWorkerTabLiveness(host.windowObject);

  assert.equal(receipt.held, true);
  assert.deepEqual(host.requests, [WORKER_TAB_LIVENESS_LOCK]);
  assert.equal(host.listenerCount('freeze'), 1);
  assert.equal(host.listenerCount('resume'), 1);

  assert.equal(receipt.holding(), true);
  receipt.stop();
  assert.equal(receipt.holding(), false);
  assert.equal(host.listenerCount('freeze'), 0);
});

test('a tab that froze anyway says how long it was gone', async () => {
  // 막는 것과 아는 것은 다르다. 못 막았을 때 조용히 멎으면 사람이 원인을 못 찾는다.
  const { installWorkerTabLiveness } = await import(MODULE_URL);
  const host = fakeWindow();
  const receipt = installWorkerTabLiveness(host.windowObject);

  assert.deepEqual(receipt.liveness(), {
    schema: 'batch-worker-tab-liveness:v1', freezeCount: 0, frozen: false,
  });

  host.emit('freeze');
  assert.equal(receipt.liveness().frozen, true);
  assert.equal(receipt.liveness().freezeCount, 1);

  host.tick(97_000);
  host.emit('resume');
  const after = receipt.liveness();
  assert.equal(after.frozen, false);
  assert.equal(after.freezeCount, 1);
  assert.equal(after.lastFreeze.durationMs, 97_000);
});

test('a browser without web locks still runs the worker', async () => {
  // 이 기능은 보험이지 전제가 아니다. 잠금을 못 써도 워커는 그대로 돌아야 한다.
  const { installWorkerTabLiveness } = await import(MODULE_URL);
  const host = fakeWindow({ withLocks: false });

  const receipt = installWorkerTabLiveness(host.windowObject);

  assert.equal(receipt.held, false);
  assert.equal(host.requests.length, 0);
  // 얼음 기록은 잠금과 무관하게 계속 남는다.
  host.emit('freeze');
  assert.equal(receipt.liveness().frozen, true);
});
