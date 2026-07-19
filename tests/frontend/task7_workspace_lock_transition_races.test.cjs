const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

test('a late accepted acquire cannot replace a newer offline draft authority', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?race=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
  let resolveProjectAcquire;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/acquire')) {
        await new Promise(resolve => { resolveProjectAcquire = resolve; });
        return {
          ok: true,
          async json() {
            return {
              granted: true, state: 'editing', scopeId: 'project:old', sessionId: 'session-local',
              leaseId: 'lease-old', fencingToken: 3, revision: 1,
            };
          },
        };
      }
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({ root, serverBases: () => ['http://test.invalid'] });

  const oldAcquire = coordinator.acquire({ scopeId: 'project:old', ownerId: 'old' });
  while (!resolveProjectAcquire) await new Promise(resolve => setImmediate(resolve));
  const draft = await coordinator.acquire({ scopeId: 'draft:new', ownerId: 'new' });
  resolveProjectAcquire();
  await oldAcquire;

  assert.equal(draft.mode, 'offline-edit');
  assert.equal(coordinator.snapshot().mode, 'offline-edit');
  assert.equal(coordinator.snapshot().scopeId, 'draft:new');
  const release = requests.find(item => item.url.includes('/release'));
  assert.ok(release, 'the superseded accepted server lease must be released');
  assert.equal(JSON.parse(release.options.body).leaseId, 'lease-old');
});

test('openReadOnly invalidates a pending acquire and releases its late accepted lease', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?acquireReadonly=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
  let resolveAcquire;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/acquire')) {
        await new Promise(resolve => { resolveAcquire = resolve; });
        return {
          ok: true,
          async json() {
            return {
              granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
              leaseId: 'lease-late', fencingToken: 4, revision: 2,
            };
          },
        };
      }
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({ root, serverBases: () => ['http://test.invalid'] });

  const pendingAcquire = coordinator.acquire({ scopeId: 'project:alpha', ownerId: 'pending' });
  while (!resolveAcquire) await new Promise(resolve => setImmediate(resolve));
  const readonly = coordinator.openReadOnly('manual readonly');
  resolveAcquire();
  const supersededAcquire = await pendingAcquire;

  assert.equal(readonly.mode, 'readonly');
  assert.equal(supersededAcquire.mode, 'readonly');
  assert.equal(coordinator.snapshot().mode, 'readonly');
  assert.equal(coordinator.snapshot().reasonCode, 'USER_READ_ONLY');
  const releases = requests.filter(item => item.url.includes('/release'));
  assert.equal(releases.length, 1);
  assert.deepEqual(
    ['workspaceId', 'leaseId', 'fencingToken'].map(field => JSON.parse(releases[0].options.body)[field]),
    ['project:alpha', 'lease-late', 4],
  );
});

test('release invalidates a pending acquire before its accepted lease arrives', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?acquireRelease=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
  let resolveAcquire;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/acquire')) {
        await new Promise(resolve => { resolveAcquire = resolve; });
        return {
          ok: true,
          async json() {
            return {
              granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
              leaseId: 'lease-after-release', fencingToken: 5, revision: 0,
            };
          },
        };
      }
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({ root, serverBases: () => ['http://test.invalid'] });

  const pendingAcquire = coordinator.acquire({ scopeId: 'project:alpha', ownerId: 'pending' });
  while (!resolveAcquire) await new Promise(resolve => setImmediate(resolve));
  const released = await coordinator.release();
  resolveAcquire();
  const supersededAcquire = await pendingAcquire;

  assert.equal(released.mode, 'released');
  assert.equal(supersededAcquire.mode, 'released');
  assert.equal(coordinator.snapshot().mode, 'released');
  const staleRelease = requests.find(item => item.url.includes('/release'));
  assert.ok(staleRelease);
  assert.equal(JSON.parse(staleRelease.options.body).leaseId, 'lease-after-release');
});

test('a same-scope acquire after read-only invalidation does not reuse the stale acquire flight', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?reacquire=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const pending = [];
  const requests = [];
  const root = {
    crypto: { randomUUID: () => 'session-local' }, setInterval: () => 1, clearInterval() {},
    fetch: (url, options = {}) => {
      requests.push({ url, options });
      if (!url.includes('/acquire')) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return new Promise(resolve => pending.push(resolve));
    },
  };
  const coordinator = createWorkspaceLockCoordinator({ root, serverBases: () => ['http://test.invalid'] });
  const oldAcquire = coordinator.acquire({ scopeId: 'project:alpha', ownerId: 'old' });
  while (pending.length < 1) await new Promise(resolve => setImmediate(resolve));
  coordinator.openReadOnly();
  const newAcquire = coordinator.acquire({ scopeId: 'project:alpha', ownerId: 'new' });
  for (let turn = 0; turn < 3 && pending.length < 2; turn += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2, 'a new generation must issue its own acquire request');
  pending[1]({ ok: true, json: async () => ({
    granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
    leaseId: 'lease-shared', fencingToken: 8, revision: 2,
  }) });
  await newAcquire;
  pending[0]({ ok: true, json: async () => ({
    granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
    leaseId: 'lease-shared', fencingToken: 8, revision: 1,
  }) });
  await oldAcquire;

  assert.equal(coordinator.snapshot().mode, 'editing');
  assert.equal(coordinator.snapshot().leaseId, 'lease-shared');
  assert.equal(coordinator.snapshot().fencingToken, 8);
  const releases = requests.filter(item => item.url.includes('/release'));
  assert.equal(releases.length, 0, 'stale cleanup must preserve the exact lease adopted by the newer acquire');
});

test('a same-scope acquire waits for a stale accepted-lease cleanup already in flight', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?cleanupQueue=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  let resolveOldAcquire;
  let resolveCleanup;
  let acquireCalls = 0;
  let cleanupStarted = false;
  const root = {
    crypto: { randomUUID: () => 'session-local' }, setInterval: () => 1, clearInterval() {},
    fetch: async url => {
      if (url.includes('/release')) {
        cleanupStarted = true;
        return new Promise(resolve => { resolveCleanup = resolve; });
      }
      acquireCalls += 1;
      if (acquireCalls === 1) return new Promise(resolve => { resolveOldAcquire = resolve; });
      return { ok: true, json: async () => ({
        granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
        leaseId: 'lease-new', fencingToken: 10, revision: 0,
      }) };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({ root, serverBases: () => ['http://test.invalid'] });
  const oldAcquire = coordinator.acquire({ scopeId: 'project:alpha' });
  while (!resolveOldAcquire) await new Promise(resolve => setImmediate(resolve));
  coordinator.openReadOnly();
  resolveOldAcquire({ ok: true, json: async () => ({
    granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
    leaseId: 'lease-old', fencingToken: 9, revision: 0,
  }) });
  while (!cleanupStarted) await new Promise(resolve => setImmediate(resolve));
  const newAcquire = coordinator.acquire({ scopeId: 'project:alpha' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acquireCalls, 1);
  resolveCleanup({ ok: true, json: async () => ({ ok: true }) });
  await Promise.all([oldAcquire, newAcquire]);
  assert.equal(acquireCalls, 2);
  assert.equal(coordinator.snapshot().leaseId, 'lease-new');
});
