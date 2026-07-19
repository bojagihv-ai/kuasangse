const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (payload, ok = true) => ({ ok, json: async () => payload });
const lease = (scopeId, leaseId, fencingToken, revision = 1) => ({
  granted: true, state: 'editing', scopeId, sessionId: 'session-local', leaseId, fencingToken, revision,
});

async function setup(fetch, options = {}) {
  const url = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?completion=${Date.now()}-${Math.random()}`;
  const { createWorkspaceLockCoordinator } = await import(url);
  const root = { crypto: { randomUUID: () => 'session-local' }, setInterval: () => 1, clearInterval() {}, fetch };
  return createWorkspaceLockCoordinator({ root, serverBases: () => ['http://test.invalid'], ...options });
}

async function acquire(coordinator, scopeId) {
  return coordinator.acquire({ scopeId, ownerId: scopeId });
}

test('a delayed release completion cannot replace a newer editing lease', async () => {
  const releaseDone = deferred();
  const bodies = [];
  let acquireCount = 0;
  const coordinator = await setup(async (url, options = {}) => {
    if (url.includes('/acquire')) { acquireCount += 1; return response(lease(`project:${acquireCount}`, `lease-${acquireCount}`, acquireCount)); }
    bodies.push(JSON.parse(options.body));
    return releaseDone.promise;
  });
  await acquire(coordinator, 'project:1');
  const oldRelease = coordinator.release();
  while (!bodies.length) await tick();
  await acquire(coordinator, 'project:2');
  releaseDone.resolve(response({ ok: true }));
  await oldRelease;
  assert.equal(coordinator.snapshot().mode, 'editing');
  assert.equal(coordinator.snapshot().scopeId, 'project:2');
  assert.equal(coordinator.snapshot().leaseId, 'lease-2');
  assert.equal(coordinator.snapshot().fencingToken, 2);
  assert.deepEqual([bodies[0].workspaceId, bodies[0].leaseId, bodies[0].fencingToken], ['project:1', 'lease-1', 1]);
});

test('a same-scope reacquire waits for the prior release request to settle', async () => {
  const releaseDone = deferred();
  let acquireCalls = 0;
  const coordinator = await setup(async url => {
    if (url.includes('/acquire')) {
      acquireCalls += 1;
      return response(lease('project:alpha', acquireCalls === 1 ? 'lease-old' : 'lease-new', acquireCalls));
    }
    if (url.includes('/release')) return releaseDone.promise;
    return response({ ok: true });
  });
  await acquire(coordinator, 'project:alpha');
  const oldRelease = coordinator.release();
  await tick();
  const newAcquire = coordinator.acquire({ scopeId: 'project:alpha' });
  await tick();
  assert.equal(acquireCalls, 1, 'same-scope acquire must not overtake its release request');
  releaseDone.resolve(response({ ok: true }));
  await oldRelease;
  await newAcquire;
  assert.equal(acquireCalls, 2);
  assert.equal(coordinator.snapshot().mode, 'editing');
  assert.equal(coordinator.snapshot().leaseId, 'lease-new');
});

test('duplicate release calls share one exact lease release request', async () => {
  const releaseDone = deferred();
  let releaseCalls = 0;
  const coordinator = await setup(async url => {
    if (url.includes('/acquire')) return response(lease('project:alpha', 'lease-a', 4));
    releaseCalls += 1;
    return releaseDone.promise;
  });
  await acquire(coordinator, 'project:alpha');
  const first = coordinator.release();
  const second = coordinator.release();
  await tick();
  assert.equal(releaseCalls, 1);
  releaseDone.resolve(response({ ok: true }));
  await Promise.all([first, second]);
  assert.equal(releaseCalls, 1);
  assert.equal(coordinator.snapshot().mode, 'released');
});

for (const outcome of ['success', 'error']) test(`a delayed heartbeat ${outcome} cannot clobber a newer lease`, async () => {
  const heartbeatDone = deferred();
  let acquireCount = 0;
  const coordinator = await setup(async url => {
    if (url.includes('/acquire')) { acquireCount += 1; return response(lease(`project:${acquireCount}`, `lease-${acquireCount}`, acquireCount)); }
    if (url.includes('/heartbeat')) return heartbeatDone.promise;
    return response({ ok: true });
  });
  await acquire(coordinator, 'project:1');
  const oldHeartbeat = coordinator.heartbeat();
  await tick();
  coordinator.openReadOnly();
  await acquire(coordinator, 'project:2');
  if (outcome === 'success') heartbeatDone.resolve(response(lease('project:1', 'lease-1', 1, 99)));
  else heartbeatDone.reject(new Error('late heartbeat failure'));
  await oldHeartbeat;
  assert.equal(coordinator.snapshot().leaseId, 'lease-2');
  assert.equal(coordinator.snapshot().mode, 'editing');
});

test('a delayed refresh completion cannot replace a newer editing lease', async () => {
  const refreshDone = deferred();
  let acquireCount = 0;
  const coordinator = await setup(async url => {
    if (url.includes('/acquire')) { acquireCount += 1; return response(lease(`project:${acquireCount}`, `lease-${acquireCount}`, acquireCount)); }
    if (url.includes('/status?')) return refreshDone.promise;
    return response({ ok: true });
  });
  await acquire(coordinator, 'project:1');
  const oldRefresh = coordinator.refresh();
  await tick();
  coordinator.openReadOnly();
  await acquire(coordinator, 'project:2');
  refreshDone.resolve(response(lease('project:1', 'lease-1', 1, 77)));
  await oldRefresh;
  assert.equal(coordinator.snapshot().leaseId, 'lease-2');
  assert.equal(coordinator.snapshot().revision, 1);
});

for (const operation of ['heartbeat', 'refresh']) test(`${operation} is single-flight and cannot roll back revision`, async () => {
  const operationDone = deferred();
  let operationCalls = 0;
  const coordinator = await setup(async url => {
    if (url.includes('/acquire')) return response(lease('project:alpha', 'lease-a', 3, 1));
    operationCalls += 1;
    return operationDone.promise;
  });
  await acquire(coordinator, 'project:alpha');
  const first = coordinator[operation]();
  const second = coordinator[operation]();
  await tick();
  assert.equal(operationCalls, 1);
  coordinator.observeRevision(9, 3);
  operationDone.resolve(response(lease('project:alpha', 'lease-a', 3, 2)));
  await Promise.all([first, second]);
  assert.equal(coordinator.snapshot().revision, 9);
  assert.equal(coordinator.snapshot().leaseId, 'lease-a');
});

for (const phase of ['response', 'reload']) test(`stale takeover ${phase} cleanup preserves an exact reused lease`, async () => {
  const takeoverDone = deferred();
  const reloadDone = deferred();
  const releases = [];
  const shared = lease('project:alpha', 'lease-shared', 7, 3);
  let reloadStarted = false;
  const lock = await setup(async (url, options = {}) => {
    if (url.includes('/release')) { releases.push(JSON.parse(options.body)); return response({ ok: true }); }
    if (url.includes('/takeover')) return phase === 'response' ? takeoverDone.promise : response(shared);
    if (url.includes('/acquire')) return response(shared);
    return response({ ok: true });
  }, {
    reloadAccepted: async () => { reloadStarted = true; return reloadDone.promise; },
  });
  const oldTakeover = lock.takeover({ scopeId: 'project:alpha', confirmed: true });
  if (phase === 'reload') while (!reloadStarted) await tick();
  else await tick();
  lock.openReadOnly();
  await lock.acquire({ scopeId: 'project:alpha' });
  if (phase === 'response') takeoverDone.resolve(response(shared));
  else reloadDone.resolve(true);
  await oldTakeover;
  assert.equal(lock.snapshot().mode, 'editing');
  assert.equal(lock.snapshot().leaseId, 'lease-shared');
  assert.equal(lock.snapshot().fencingToken, 7);
  assert.equal(releases.length, 0);
});
