const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

test('a takeover invalidates an older pending acquire and releases its late accepted lease', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?acquireTakeover=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
  let resolveOldAcquire;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/acquire')) {
        await new Promise(resolve => { resolveOldAcquire = resolve; });
        return {
          ok: true,
          async json() {
            return {
              granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
              leaseId: 'lease-old', fencingToken: 1, revision: 0,
            };
          },
        };
      }
      if (url.includes('/takeover')) return {
        ok: true,
        async json() {
          return {
            granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
            leaseId: 'lease-new', fencingToken: 2, revision: 1,
          };
        },
      };
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root,
    serverBases: () => ['http://test.invalid'],
    reloadAccepted: async () => true,
  });

  const pendingAcquire = coordinator.acquire({ scopeId: 'project:alpha', ownerId: 'old' });
  while (!resolveOldAcquire) await new Promise(resolve => setImmediate(resolve));
  const takeover = await coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'new', confirmed: true });
  resolveOldAcquire();
  await pendingAcquire;

  assert.equal(takeover.leaseId, 'lease-new');
  assert.equal(coordinator.snapshot().leaseId, 'lease-new');
  assert.equal(coordinator.snapshot().fencingToken, 2);
  const releases = requests.filter(item => item.url.includes('/release'));
  assert.equal(releases.length, 1);
  assert.deepEqual(
    ['leaseId', 'fencingToken'].map(field => JSON.parse(releases[0].options.body)[field]),
    ['lease-old', 1],
  );
});

test('a newer acquire invalidates a takeover waiting for reload and releases its accepted lease', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?takeoverAcquire=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
  let resolveReload;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/takeover')) return {
        ok: true,
        async json() {
          return {
            granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
            leaseId: 'lease-takeover', fencingToken: 2, revision: 1,
          };
        },
      };
      if (url.includes('/acquire')) return {
        ok: true,
        async json() {
          return {
            granted: true, state: 'editing', scopeId: 'project:beta', sessionId: 'session-local',
            leaseId: 'lease-acquire', fencingToken: 3, revision: 0,
          };
        },
      };
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root,
    serverBases: () => ['http://test.invalid'],
    reloadAccepted: async () => new Promise(resolve => { resolveReload = resolve; }),
  });

  const pendingTakeover = coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'takeover', confirmed: true });
  while (!resolveReload) await new Promise(resolve => setImmediate(resolve));
  const acquire = await coordinator.acquire({ scopeId: 'project:beta', ownerId: 'latest' });
  resolveReload(true);
  const supersededTakeover = await pendingTakeover;

  assert.equal(acquire.leaseId, 'lease-acquire');
  assert.equal(supersededTakeover.leaseId, 'lease-acquire');
  assert.equal(coordinator.snapshot().scopeId, 'project:beta');
  assert.equal(coordinator.snapshot().leaseId, 'lease-acquire');
  const releases = requests.filter(item => item.url.includes('/release'));
  assert.equal(releases.length, 1);
  assert.deepEqual(
    ['leaseId', 'fencingToken'].map(field => JSON.parse(releases[0].options.body)[field]),
    ['lease-takeover', 2],
  );
});

test('openReadOnly invalidates a takeover waiting for reload and preserves readonly after completion', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?takeoverReadonly=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
  let resolveReload;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/takeover')) return {
        ok: true,
        async json() {
          return {
            granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
            leaseId: 'lease-takeover', fencingToken: 6, revision: 3,
          };
        },
      };
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root,
    serverBases: () => ['http://test.invalid'],
    reloadAccepted: async () => new Promise(resolve => { resolveReload = resolve; }),
  });

  const pendingTakeover = coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'pending', confirmed: true });
  while (!resolveReload) await new Promise(resolve => setImmediate(resolve));
  const readonly = coordinator.openReadOnly('manual readonly');
  resolveReload(true);
  const supersededTakeover = await pendingTakeover;

  assert.equal(readonly.mode, 'readonly');
  assert.equal(supersededTakeover.mode, 'readonly');
  assert.equal(coordinator.snapshot().mode, 'readonly');
  const staleRelease = requests.find(item => item.url.includes('/release'));
  assert.ok(staleRelease);
  assert.deepEqual(
    ['leaseId', 'fencingToken'].map(field => JSON.parse(staleRelease.options.body)[field]),
    ['lease-takeover', 6],
  );
});

test('a superseded takeover cannot block or clear the guard for a newer takeover generation', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?takeoverGeneration=${Date.now()}`;
  const { createWorkspaceLockCoordinator, WorkspaceLockError } = await import(moduleUrl);
  let takeoverCount = 0;
  let resolveReloadA;
  let resolveReloadB;
  const releases = [];
  const root = {
    crypto: { randomUUID: () => 'session-local' }, setInterval: () => 1, clearInterval() {},
    fetch: async (url, options = {}) => {
      if (url.includes('/release')) { releases.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; }
      if (url.includes('/acquire')) return { ok: false, json: async () => ({
        state: 'readonly', scopeId: 'project:beta', ownerId: 'other', fencingToken: 4, revision: 1,
        code: 'LEASE_HELD',
      }) };
      takeoverCount += 1;
      return { ok: true, json: async () => ({
        granted: true, state: 'editing', scopeId: takeoverCount === 1 ? 'project:alpha' : 'project:beta',
        sessionId: 'session-local', leaseId: takeoverCount === 1 ? 'lease-a' : 'lease-b',
        fencingToken: takeoverCount === 1 ? 3 : 5, revision: 2,
      }) };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root, serverBases: () => ['http://test.invalid'],
    reloadAccepted: accepted => new Promise(resolve => {
      if (accepted.leaseId === 'lease-a') resolveReloadA = resolve;
      else resolveReloadB = resolve;
    }),
  });
  const takeoverA = coordinator.takeover({ scopeId: 'project:alpha', confirmed: true });
  while (!resolveReloadA) await new Promise(resolve => setImmediate(resolve));
  await coordinator.acquire({ scopeId: 'project:beta', ownerId: 'new' });
  const takeoverB = coordinator.takeover({ scopeId: 'project:beta', confirmed: true });
  while (!resolveReloadB) await new Promise(resolve => setImmediate(resolve));
  resolveReloadA(true);
  await takeoverA;
  await assert.rejects(
    coordinator.takeover({ scopeId: 'project:beta', confirmed: true }),
    error => error instanceof WorkspaceLockError && error.code === 'TAKEOVER_IN_PROGRESS',
  );
  resolveReloadB(true);
  await takeoverB;

  assert.equal(coordinator.snapshot().leaseId, 'lease-b');
  assert.equal(coordinator.snapshot().fencingToken, 5);
  assert.deepEqual(releases.map(item => item.leaseId), ['lease-a']);
});
