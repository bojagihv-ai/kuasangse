const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function sourceBetween(source, startMarkers, endMarker) {
  const start = startMarkers.map(marker => source.indexOf(marker)).find(index => index >= 0) ?? -1;
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable before ${endMarker}`);
  return source.slice(start, end);
}

test('workspace takeover reload receives a complete accepted identity even when the server omits sessionId', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?test=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const acceptedIdentities = [];
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async url => ({
      ok: true,
      async json() {
        if (url.includes('/takeover')) return {
          granted: true, state: 'editing', scopeId: 'project:alpha',
          leaseId: 'lease-b', fencingToken: 8, revision: 4,
        };
        return { granted: true, state: 'editing', scopeId: 'project:alpha' };
      },
    }),
  };
  const coordinator = createWorkspaceLockCoordinator({
    root,
    serverBases: () => ['http://test.invalid'],
    reloadAccepted: async accepted => { acceptedIdentities.push(accepted); return true; },
  });

  const result = await coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'B', confirmed: true });

  assert.deepEqual(
    ['scopeId', 'sessionId', 'leaseId', 'fencingToken', 'revision'].map(field => acceptedIdentities[0][field]),
    ['project:alpha', 'session-local', 'lease-b', 8, 4],
  );
  assert.equal(result.mode, 'editing');
});

test('a second programmatic takeover is rejected while accepted reload is acquiring', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?takeoverGuard=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  let resolveReload;
  const reloadGate = new Promise(resolve => { resolveReload = resolve; });
  let takeoverRequests = 0;
  const root = {
    crypto: { randomUUID: () => 'session-local' },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: async url => {
      if (url.includes('/takeover')) {
        takeoverRequests += 1;
        return {
          ok: true,
          async json() {
            return {
              granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
              leaseId: 'lease-takeover', fencingToken: 2, revision: 1,
            };
          },
        };
      }
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root,
    serverBases: () => ['http://test.invalid'],
    reloadAccepted: async () => reloadGate,
  });

  const first = coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'first', confirmed: true });
  while (coordinator.snapshot().reasonCode !== 'TAKEOVER_RELOAD') await new Promise(resolve => setImmediate(resolve));
  const secondRejected = assert.rejects(
    coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'second', confirmed: true }),
    error => error?.code === 'TAKEOVER_IN_PROGRESS',
  );
  resolveReload(true);
  await first;
  await secondRejected;

  assert.equal(takeoverRequests, 1);
  assert.equal(coordinator.snapshot().leaseId, 'lease-takeover');
});

test('refresh is inert while accepted takeover reload is still acquiring', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?refreshGate=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  let resolveReload;
  let statusRequests = 0;
  let acquireRequests = 0;
  const root = {
    crypto: { randomUUID: () => 'session-local' }, setInterval: () => 1, clearInterval() {},
    fetch: async url => {
      if (url.includes('/status?')) statusRequests += 1;
      if (url.includes('/acquire')) acquireRequests += 1;
      return { ok: true, json: async () => ({
        granted: true, state: 'editing', scopeId: 'project:alpha', sessionId: 'session-local',
        leaseId: 'lease-takeover', fencingToken: 2, revision: 1,
      }) };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root, serverBases: () => ['http://test.invalid'],
    reloadAccepted: async () => new Promise(resolve => { resolveReload = resolve; }),
  });
  const pending = coordinator.takeover({ scopeId: 'project:alpha', confirmed: true });
  while (!resolveReload) await new Promise(resolve => setImmediate(resolve));
  const refreshed = await coordinator.refresh();
  assert.equal(statusRequests, 0);
  assert.equal(refreshed.mode, 'acquiring');
  assert.equal(coordinator.snapshot().mode, 'acquiring');
  assert.equal(coordinator.observeRevision(99, 2).revision, 1);
  await assert.rejects(
    coordinator.acquire({ scopeId: 'project:alpha' }),
    error => error?.code === 'TAKEOVER_IN_PROGRESS',
  );
  assert.equal(acquireRequests, 0);
  resolveReload(true);
  await pending;
  assert.equal(coordinator.snapshot().mode, 'editing');
});

test('acquiring authority renders every transition action disabled with a waiting title', () => {
  const core03 = read('src/app-core-03.js');
  const bannerSource = sourceBetween(
    core03,
    ['function renderWorkspaceAuthorityBanner'],
    'const runtimeMenuModules',
  );
  const context = vm.createContext({});
  vm.runInContext(`
    const escapeHtml = value => String(value);
    const escAttr = value => String(value);
    let authority = null;
    const currentWorkspaceAuthority = () => authority;
    ${bannerSource}
    globalThis.renderBanner = value => { authority = value; return renderWorkspaceAuthorityBanner(); };
  `, context);

  const html = context.renderBanner({ mode: 'acquiring', scopeId: 'project:alpha', ownerId: '창 B' });
  assert.match(html, /data-workspace-authority-action="refresh"[^>]*title="[^"]+"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /data-workspace-authority-action="save-copy"[^>]*title="[^"]+"[^>]*disabled aria-disabled="true"/);
  assert.match(
    html,
    /data-workspace-authority-action="takeover"[^>]*title="편집권 확인이 끝날 때까지 기다려 주세요\."[^>]*disabled aria-disabled="true"/,
  );
  assert.match(
    html,
    /data-workspace-authority-action="readonly"[^>]*title="편집권 확인이 끝날 때까지 기다려 주세요\."[^>]*disabled aria-disabled="true"/,
  );
});

test('available authority acquires directly while an active foreign lease requires confirmed takeover', () => {
  const core06 = read('src/app-core-06.js');
  const classificationSource = sourceBetween(
    core06,
    ['function workspaceAuthorityNeedsConfirmedTakeover'],
    'function handleWorkspaceAuthorityAction',
  );
  const handlerSource = sourceBetween(
    core06,
    ['function handleWorkspaceAuthorityAction'],
    'function bindWorkspaceAuthorityUi',
  );
  const context = vm.createContext({});
  vm.runInContext(`
    ${classificationSource}
    globalThis.needsTakeover = workspaceAuthorityNeedsConfirmedTakeover;
  `, context);

  assert.equal(context.needsTakeover({
    mode: 'available',
    scopeId: 'project:alpha',
    reasonCode: 'AVAILABLE',
  }), false);
  assert.equal(context.needsTakeover({
    mode: 'readonly',
    scopeId: 'project:alpha',
    reasonCode: 'AUTHORITY_UNAVAILABLE',
  }), false);
  assert.equal(context.needsTakeover({
    mode: 'readonly',
    scopeId: 'project:alpha',
    reasonCode: 'LEASE_HELD',
  }), true);
  assert.match(handlerSource, /authority\s*=\s*await lock\.refresh\(\)\s*\|\|\s*lock\.snapshot\(\)/);
  assert.match(handlerSource, /if\s*\(!workspaceAuthorityNeedsConfirmedTakeover\(authority\)\)\s*\{[\s\S]*?await lock\.acquire\(/);
  assert.ok(
    handlerSource.indexOf('await lock.refresh()') < handlerSource.indexOf('await lock.acquire('),
    'the server status must be refreshed before deciding whether direct acquire is safe',
  );
  assert.ok(
    handlerSource.indexOf('await lock.acquire(') < handlerSource.indexOf('window.confirm('),
    'direct acquire must happen before the native takeover confirmation branch',
  );
});
