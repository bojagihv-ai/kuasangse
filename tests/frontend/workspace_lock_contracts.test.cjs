const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const LOCK_PATH = path.resolve(__dirname, '../../src/modules/workspace-lock.mjs');

async function loadLock() {
  return import(`${pathToFileURL(LOCK_PATH).href}?test=${Date.now()}-${Math.random()}`);
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function harness() {
  const requests = [];
  const listeners = new Map();
  const channels = [];
  class Channel {
    constructor(name) { this.name = name; this.messages = []; channels.push(this); }
    postMessage(value) { this.messages.push(structuredClone(value)); }
    addEventListener(type, callback) { this.callback = callback; }
    close() { this.closed = true; }
  }
  const root = {
    BroadcastChannel: Channel,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    setInterval(callback) { this.interval = callback; return 1; },
    clearInterval() {},
    crypto: { randomUUID: () => 'session-a' },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/acquire')) return response(200, {
        ok: true, granted: true, state: 'editing', scopeId: 'project:alpha',
        leaseId: 'lease-a', fencingToken: 7, ownerId: '창 A', expiresAt: 99_999,
        revision: 3,
      });
      if (url.includes('/heartbeat')) return response(409, {
        ok: false, code: 'STALE_FENCE', state: 'readonly', scopeId: 'project:alpha',
        ownerId: '창 B', fencingToken: 8, revision: 4,
      });
      if (url.includes('/takeover')) return response(200, {
        ok: true, granted: true, state: 'editing', scopeId: 'project:alpha',
        leaseId: 'lease-b', fencingToken: 8, ownerId: '창 B', expiresAt: 99_999,
        revision: 4,
      });
      return response(200, { ok: true, state: 'available', scopeId: 'project:alpha' });
    },
  };
  return { root, requests, listeners, channels };
}

test('Ctrl+F5 뒤 같은 탭은 workspace lock session identity를 유지한다', async () => {
  const { createWorkspaceLockCoordinator } = await loadLock();
  const values = new Map();
  let created = 0;
  const root = {
    crypto: { randomUUID: () => `session-${++created}` },
    sessionStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  };

  const beforeReload = createWorkspaceLockCoordinator({ root, serverBases: () => [] });
  const afterReload = createWorkspaceLockCoordinator({ root, serverBases: () => [] });

  assert.equal(beforeReload.snapshot().sessionId, 'session-1');
  assert.equal(afterReload.snapshot().sessionId, 'session-1');
  assert.equal(created, 1);
});

test('server lease snapshot은 typed frozen state이고 stale heartbeat가 즉시 read-only 전환한다', async () => {
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root, channels } = harness();
  const coordinator = createWorkspaceLockCoordinator({ root, heartbeatMs: 10 });
  const acquired = await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });
  await root.interval();
  const stale = coordinator.snapshot();

  assert.equal(acquired.mode, 'editing');
  assert.equal(acquired.fencingToken, 7);
  assert.equal(Object.isFrozen(acquired), true);
  assert.equal(stale.mode, 'readonly');
  assert.equal(stale.reasonCode, 'STALE_FENCE');
  assert.equal(channels[0].messages.some(item => item.type === 'presence'), true);
});

test('동일 scope 편집권 acquire가 겹치면 한 요청을 공유하고 자기 자신과 충돌하지 않는다', async () => {
  // Given: 첫 acquire 응답 전에 startup hydrate가 같은 scope의 편집권을 다시 요청한다.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root } = harness();
  let acquireCalls = 0;
  let releaseFirst;
  root.fetch = async url => {
    if (!url.includes('/acquire')) return response(200, { ok: true, state: 'available' });
    acquireCalls += 1;
    if (acquireCalls === 1) {
      await new Promise(resolve => { releaseFirst = resolve; });
      return response(200, {
        ok: true, granted: true, state: 'editing', scopeId: 'project:alpha',
        leaseId: 'lease-a', fencingToken: 7, ownerId: '창 A', sessionId: 'session-a',
        expiresAt: 99_999, revision: 3,
      });
    }
    return response(409, {
      ok: false, code: 'LEASE_HELD', state: 'readonly', scopeId: 'project:alpha',
      leaseId: 'lease-a', fencingToken: 7, ownerId: '창 A', sessionId: 'session-a', revision: 3,
    });
  };
  const coordinator = createWorkspaceLockCoordinator({ root });

  // When: both callers overlap before the server accepts the first request.
  const first = coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });
  const second = coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });
  await new Promise(resolve => setImmediate(resolve));
  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  // Then: both observe the same accepted lease from one physical request.
  assert.equal(acquireCalls, 1);
  assert.equal(firstResult.mode, 'editing');
  assert.equal(secondResult.mode, 'editing');
  assert.equal(firstResult.leaseId, 'lease-a');
  assert.equal(secondResult.leaseId, 'lease-a');
  assert.equal(coordinator.snapshot().mode, 'editing');
});

test('takeover는 confirmed true 없이는 요청되지 않고 lifecycle은 저장 전에 lease를 반납하지 않는다', async () => {
  // Given: A holds an editing lease and the browser lifecycle may begin a final save.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root, requests, listeners } = harness();
  const coordinator = createWorkspaceLockCoordinator({ root });
  await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });

  // When: an unconfirmed takeover is rejected and pagehide is observed.
  await assert.rejects(
    coordinator.takeover({ scopeId: 'project:alpha', ownerId: '창 B', confirmed: false }),
    /confirmation/i,
  );
  assert.equal(listeners.has('pagehide'), false);
  assert.equal(requests.some(item => item.url.includes('/release')), false);
  await coordinator.release({ keepalive: true });
  const release = requests.find(item => item.url.includes('/release'));

  // Then: only the explicit post-save release carries A's exact fence.
  assert.ok(release);
  const body = JSON.parse(release.options.body);
  assert.equal(body.leaseId, 'lease-a');
  assert.equal(body.fencingToken, 7);
});

test('takeover는 승인본 reload가 끝날 때까지 editing 상태를 공개하지 않는다', async () => {
  // Given: A is read-only and B's accepted snapshot reload is paused.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root } = harness();
  let releaseReload;
  const reloadGate = new Promise(resolve => { releaseReload = resolve; });
  const coordinator = createWorkspaceLockCoordinator({ root, reloadAccepted: () => reloadGate });
  await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });

  // When: takeover succeeds at the server but reload has not completed.
  const pending = coordinator.takeover({ scopeId: 'project:alpha', ownerId: '창 B', confirmed: true });
  await new Promise(resolve => setImmediate(resolve));

  // Then: the UI remains non-editable until the accepted snapshot is installed.
  assert.equal(coordinator.snapshot().mode, 'acquiring');
  assert.equal(coordinator.snapshot().reasonCode, 'TAKEOVER_RELOAD');
  releaseReload(true);
  assert.equal((await pending).mode, 'editing');
  assert.equal(coordinator.snapshot().leaseId, 'lease-b');
});

test('takeover 승인본 reload 실패는 새 lease를 반납하고 readonly로 남는다', async () => {
  // Given: the accepted snapshot cannot be loaded after takeover.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root, requests } = harness();
  const coordinator = createWorkspaceLockCoordinator({
    root,
    reloadAccepted: async () => { throw new Error('reload-failed'); },
  });
  await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });

  // When: the confirmed takeover reaches the reload boundary.
  await assert.rejects(
    coordinator.takeover({ scopeId: 'project:alpha', ownerId: '창 B', confirmed: true }),
    error => error?.code === 'TAKEOVER_RELOAD_FAILED',
  );

  // Then: B's lease is explicitly released and the coordinator never exposes editing.
  const releases = requests.filter(item => item.url.includes('/release'));
  assert.equal(releases.length, 1);
  assert.equal(JSON.parse(releases[0].options.body).leaseId, 'lease-b');
  assert.equal(coordinator.snapshot().mode, 'readonly');
  assert.equal(coordinator.snapshot().reasonCode, 'TAKEOVER_RELOAD_FAILED');
});

test('takeover 승인본 reload가 false이면 lease를 반납하고 readonly로 남는다', async () => {
  // Given: the reload callback fulfills but explicitly reports that no snapshot was installed.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root, requests } = harness();
  const coordinator = createWorkspaceLockCoordinator({
    root,
    reloadAccepted: async () => false,
  });
  await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });

  // When: the confirmed takeover receives the invalid reload acknowledgement.
  await assert.rejects(
    coordinator.takeover({ scopeId: 'project:alpha', ownerId: '창 B', confirmed: true }),
    error => error?.code === 'TAKEOVER_RELOAD_FAILED',
  );

  // Then: the new fence is released and editing is never exposed.
  assert.equal(requests.filter(item => item.url.includes('/release')).length, 1);
  assert.equal(coordinator.snapshot().mode, 'readonly');
  assert.equal(coordinator.snapshot().reasonCode, 'TAKEOVER_RELOAD_FAILED');
});

test('takeover 승인본 reload가 invalid object이면 editing을 공개하지 않는다', async () => {
  // Given: the reload callback returns an object instead of the required true acknowledgement.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root, requests } = harness();
  const coordinator = createWorkspaceLockCoordinator({
    root,
    reloadAccepted: async () => ({ restored: true }),
  });
  await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 A' });

  // When: takeover receives the structurally invalid acknowledgement.
  await assert.rejects(
    coordinator.takeover({ scopeId: 'project:alpha', ownerId: '창 B', confirmed: true }),
    error => error?.code === 'TAKEOVER_RELOAD_FAILED',
  );

  // Then: the lease is released and the coordinator remains read-only.
  assert.equal(requests.filter(item => item.url.includes('/release')).length, 1);
  assert.equal(coordinator.snapshot().mode, 'readonly');
});

test('saved workspace authority offline is readonly but unique draft is explicit offline-edit', async () => {
  const { createWorkspaceLockCoordinator } = await loadLock();
  const failingRoot = harness().root;
  failingRoot.fetch = async () => { throw new Error('offline'); };
  const coordinator = createWorkspaceLockCoordinator({ root: failingRoot });
  const saved = await coordinator.acquire({ scopeId: 'project:alpha', ownerId: 'A' });
  const draft = await coordinator.acquire({ scopeId: 'draft:unique-a', ownerId: 'A' });

  assert.equal(saved.mode, 'readonly');
  assert.equal(saved.reasonCode, 'AUTHORITY_UNAVAILABLE');
  assert.equal(draft.mode, 'offline-edit');
  assert.match(draft.reason, /새 작업|오프라인/);
});

test('unique offline draft는 confirmed takeover라도 서버 인계 요청을 시작하지 않는다', async () => {
  // Given: 서버 대상이 아닌 유일 로컬 초안이 offline-edit 상태다.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root, requests } = harness();
  const coordinator = createWorkspaceLockCoordinator({ root });
  const draft = await coordinator.acquire({ scopeId: 'draft:unique-no-takeover', ownerId: '초안 창' });
  assert.equal(draft.mode, 'offline-edit');

  // When/Then: 확인 플래그가 있어도 일반 서버 편집권 인계 경로는 fail-closed다.
  await assert.rejects(
    coordinator.takeover({ scopeId: draft.scopeId, ownerId: '초안 창', confirmed: true }),
    error => error?.code === 'OFFLINE_DRAFT_TAKEOVER_FORBIDDEN'
      && /로컬 초안|offline draft/i.test(error?.message || ''),
  );
  assert.equal(requests.some(item => item.url.includes('/takeover')), false);
  assert.equal(coordinator.snapshot().mode, 'offline-edit');
  assert.equal(coordinator.snapshot().scopeId, 'draft:unique-no-takeover');
});

test('readonly 창의 refresh는 다른 session의 같은 lease를 자기 편집권으로 승격하지 않는다', async () => {
  // Given: 다른 창이 가진 lease 정보가 readonly 응답과 status 응답에 동일하게 들어 있다.
  const { createWorkspaceLockCoordinator } = await loadLock();
  const { root } = harness();
  root.fetch = async url => {
    if (url.includes('/acquire')) return response(409, {
      ok: false, granted: false, state: 'editing', code: 'LEASE_HELD', scopeId: 'project:alpha',
      leaseId: 'lease-owner', fencingToken: 11, ownerId: '창 A', sessionId: 'session-owner', revision: 3,
    });
    if (url.includes('/status')) return response(200, {
      ok: true, granted: true, state: 'editing', scopeId: 'project:alpha',
      leaseId: 'lease-owner', fencingToken: 11, ownerId: '창 A', sessionId: 'session-owner', revision: 3,
    });
    throw new Error(`unexpected request: ${url}`);
  };
  const coordinator = createWorkspaceLockCoordinator({ root });
  const held = await coordinator.acquire({ scopeId: 'project:alpha', ownerId: '창 B' });
  assert.equal(held.mode, 'readonly');

  // When: 창 B가 상태를 새로고침한다.
  const refreshed = await coordinator.refresh();

  // Then: lease ID가 같아도 local session과 다르므로 계속 readonly다.
  assert.equal(refreshed.mode, 'readonly');
  assert.equal(refreshed.reasonCode, 'LEASE_HELD');
  assert.equal(refreshed.ownerId, '창 A');
  assert.equal(refreshed.sessionId, 'session-owner');
});

test('workspace mutations are serialized and a rejected mutation does not poison the queue', async () => {
  const { createWorkspaceLockCoordinator } = await loadLock();
  const coordinator = createWorkspaceLockCoordinator({ root: harness().root });
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const first = coordinator.runMutation(async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
    throw new Error('expected failure');
  });
  const second = coordinator.runMutation(async () => {
    order.push('second');
    return 'ok';
  });

  await Promise.resolve();
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await assert.rejects(first, /expected failure/);
  assert.equal(await second, 'ok');
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});
