const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  buildStartupChecks,
  buildStartupSeed,
  startupSeedScript,
  storageFingerprint,
} = require('../../tools/factory_startup_restore_harness_utils.cjs');
const {
  factoryCdpFixtureExpression,
  factoryCdpFixtureReadyExpression,
} = require('../../tools/factory_cdp_test_utils.cjs');

function validProof(token, seed) {
  const current = { scope: seed.currentScope, identity: seed.currentIdentity, canApply: true };
  const foreign = { scope: seed.foreignScope, identity: seed.foreignIdentity, canApply: false };
  const backend = { status: 200, hasSnapshot: false, workspaceId: seed.projectScope, revision: 0, bodyLength: 50, sha256: 'same', fileExists: false };
  const globalBackend = { ...backend, workspaceId: '' };
  const storage = storageFingerprint({ sentinel: 'original' });
  const appOrigin = 'http://127.0.0.1:19381';
  const backendOrigin = 'http://127.0.0.1:19382';
  const authority = {
    mode: 'offline-edit', scopeId: seed.draftWorkspaceId, leaseId: '',
    fencingToken: 0, ownerId: 'DB05 owner', sessionId: 'db05-session', revision: 4,
  };
  const mutations = [
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/refresh-token' },
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/setup-status' },
  ];
  return {
    expected: { ...seed, appOrigin, backendOrigin },
    appWorkspaceId: seed.projectId,
    factoryWorkspaceId: seed.projectId,
    persistenceScope: seed.draftWorkspaceId,
    branch: { scopeId: seed.draftWorkspaceId, documentScopeId: seed.projectScope },
    currentScope: seed.currentScope,
    token,
    settledToken: { ...token },
    authority,
    settledAuthority: { ...authority },
    db: [current, foreign],
    cafe24: [current, foreign],
    buttons: {
      dbDraft: { exists: true, disabled: false },
      cafeDraft: { exists: true, disabled: false },
      dbForeign: { exists: false, disabled: null },
      cafeForeign: { exists: false, disabled: null },
    },
    cleanup: { seedScriptRemoved: true, storageRestored: true, cdpClosed: true, runtimeCleaned: true, errors: [], beforeStorage: storage, afterStorage: { ...storage } },
    backend: { beforeTarget: backend, afterTarget: { ...backend }, beforeGlobal: globalBackend, afterGlobal: { ...globalBackend } },
    networkProbe: { requests: [...mutations], mutations, unexpected: [], authorityExpected: { ...authority } },
    loadErrors: [],
  };
}

test('DB-05 startup seed isolates API Hub GETs from native fetch', async () => {
  const seed = buildStartupSeed(22308);
  const nativeFetches = [];
  const storage = () => {
    const values = new Map();
    return {
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    };
  };
  const context = vm.createContext({
    console,
    fetch: async input => {
      nativeFetches.push(String(input));
      return new Response(JSON.stringify({ native: true }), { status: 599 });
    },
    location: { href: 'http://127.0.0.1:19381/' },
    localStorage: storage(),
    sessionStorage: storage(),
    Request,
    Response,
    URL,
  });
  context.window = context;
  vm.runInContext(startupSeedScript(seed, {
    appOrigin: 'http://127.0.0.1:19381',
    backendOrigin: 'http://127.0.0.1:19382',
  }), context);

  const status = await context.fetch('http://127.0.0.1:4321/api/playbooks/gpt-oauth/status');
  const options = await context.fetch('http://127.0.0.1:4321/api/llm/options');
  assert.deepEqual(nativeFetches, []);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    connectorId: 'chatgpt_login_oauth', mode: 'chatgpt-login-oauth',
    authMode: 'chatgpt', chatGptLoginReady: true,
  });
  assert.equal(options.status, 200);
  assert.deepEqual(await options.json(), {
    latestModel: 'gpt-5.6-sol', modelOptions: [{ id: 'gpt-5.6-sol' }],
    reasoningOptions: [{ id: 'medium' }], serviceTierOptions: [{ id: 'standard' }],
  });
  assert.deepEqual([...context.__DB05_NETWORK_PROBE__.unexpected], []);

  const blockedGet = await context.fetch('http://127.0.0.1:4321/api/catalog');
  const blockedHead = await context.fetch('http://127.0.0.1:4321/api/status', { method: 'HEAD' });
  assert.equal(blockedGet.status, 409);
  assert.equal(blockedHead.status, 409);
  assert.deepEqual(nativeFetches, []);
  assert.deepEqual(
    [...context.__DB05_NETWORK_PROBE__.unexpected].map(item => `${item.method} ${item.origin}${item.path}`),
    [
      'GET http://127.0.0.1:4321/api/catalog',
      'HEAD http://127.0.0.1:4321/api/status',
    ],
  );
});

test('DB-05 startup fetch probe keeps app-origin native fallback out of API Hub transport count', async () => {
  const seed = buildStartupSeed(22309);
  const nativeFetches = [];
  const storage = () => ({ setItem: () => {}, removeItem: () => {} });
  const context = vm.createContext({
    console,
    fetch: async input => {
      nativeFetches.push(String(input));
      return new Response(JSON.stringify({ native: true }), { status: 599 });
    },
    location: { href: 'http://127.0.0.1:19381/' },
    localStorage: storage(),
    sessionStorage: storage(),
    Request,
    Response,
    URL,
  });
  context.window = context;
  vm.runInContext(startupSeedScript(seed, {
    appOrigin: 'http://127.0.0.1:19381',
    backendOrigin: 'http://127.0.0.1:19382',
  }), context);

  assert.equal((await context.fetch('http://127.0.0.1:4321/api/playbooks/gpt-oauth/status')).status, 200);
  assert.equal((await context.fetch('http://127.0.0.1:4321/api/invoke/cafe24_control_tower/refresh-token', { method: 'POST' })).status, 200);
  assert.equal(context.__DB05_NETWORK_PROBE__.nativeApiHubTransportCount, 0);
  assert.deepEqual(nativeFetches, []);

  assert.equal((await context.fetch('http://127.0.0.1:4321/api/catalog')).status, 409);
  assert.equal(context.__DB05_NETWORK_PROBE__.nativeApiHubTransportCount, 0);

  assert.equal((await context.fetch('http://127.0.0.1:19381/native-fallback')).status, 599);
  assert.deepEqual(nativeFetches, ['http://127.0.0.1:19381/native-fallback']);
  assert.equal(context.__DB05_NETWORK_PROBE__.nativeApiHubTransportCount, 0);
});

test('DB-05 startup fetch probe counts test-only API Hub native transport at the native seam', async () => {
  const seed = buildStartupSeed(22310);
  const nativeFetches = [];
  const storage = () => ({ setItem: () => {}, removeItem: () => {} });
  const context = vm.createContext({
    console,
    fetch: async input => {
      nativeFetches.push(String(input));
      return new Response(JSON.stringify({ native: true }), { status: 599 });
    },
    location: { href: 'http://127.0.0.1:19381/' },
    localStorage: storage(),
    sessionStorage: storage(),
    Request,
    Response,
    URL,
  });
  context.window = context;
  vm.runInContext(startupSeedScript(seed, {
    appOrigin: 'http://127.0.0.1:19381',
    backendOrigin: 'http://127.0.0.1:19382',
    testOnlyNativeApiHubTransport: true,
  }), context);

  assert.equal((await context.fetch('http://127.0.0.1:4321/__db05_test_native_api_hub_transport')).status, 599);
  assert.deepEqual(nativeFetches, ['http://127.0.0.1:4321/__db05_test_native_api_hub_transport']);
  assert.equal(context.__DB05_NETWORK_PROBE__.nativeApiHubTransportCount, 1);
});

test('DB-05 restore save behavior and startup checks reject token, authority, network, and cleanup drift', async () => {
  const core = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const restoreStart = core.indexOf('async function factoryRestoreLocalArchiveToCurrentWork(');
  const restoreEnd = core.indexOf('\nfunction sectionLocalArchiveStageId(', restoreStart);
  assert.notEqual(restoreStart, -1);
  assert.notEqual(restoreEnd, -1);
  let saveCount = 0;
  const restoreToken = { version: 'factory-store:v1', workspaceId: 'project:manual', revision: 0, fence: 1 };
  const restoreStore = {
    getOperationToken: () => restoreToken,
    acquireOperationLease: () => ({ acquired: true, operationToken: restoreToken, release: () => true }),
  };
  const restoreContext = vm.createContext({
    FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL: Symbol('internal'),
    factoryLocalArchiveRestoreTargets: () => [],
    factoryRenderLocalArchivePanel: () => {},
    factoryRuntimeFlushDeferredOperations: () => {},
    factoryRuntimeRequireStore: () => restoreStore,
    factoryRuntimeUpdateOwnedFactory: async (_action, _owner, update) => ({
      result: await update({ archive: { localAssets: [] } }),
    }),
    saveLastWorkNow: () => {
      saveCount += 1;
      return true;
    },
  });
  vm.runInContext(`${core.slice(restoreStart, restoreEnd)}\nthis.restore = factoryRestoreLocalArchiveToCurrentWork;`, restoreContext);
  await restoreContext.restore({ refresh: false });
  assert.equal(saveCount, 1);
  saveCount = 0;
  await restoreContext.restore({ refresh: false, save: true });
  assert.equal(saveCount, 1);
  saveCount = 0;
  await restoreContext.restore({ refresh: false, save: false });
  assert.equal(saveCount, 0);

  const seed = buildStartupSeed(22305);
  const { createFactoryStore } = await import(`${pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-store.mjs')).href}?db05-check=${Date.now()}`);
  const store = createFactoryStore({
    workspaceId: seed.projectId,
    revision: 0,
    initialSnapshot: { factory: { workspace: { id: seed.projectId }, product: {} } },
  });
  try {
    for (let index = 0; index < 9; index += 1) {
      store.replaceSnapshot(store.getSnapshot(), { owner: 'factory', expectedRevision: store.getOperationToken().revision });
    }
    const proof = validProof(store.getOperationToken(), seed);
    assert.equal(Object.values(buildStartupChecks(proof)).every(check => check.ok), true);
    proof.token = { ...proof.token, fence: proof.token.fence + 1 };
    assert.equal(buildStartupChecks(proof).operationToken.ok, false);
    proof.token = store.getOperationToken();
    for (const field of ['leaseId', 'ownerId', 'sessionId']) {
      const drifted = structuredClone(proof);
      drifted.authority[field] = `drift-${field}`;
      assert.equal(buildStartupChecks(drifted).authority.ok, false, field);
    }
    proof.networkProbe.unexpected.push({ method: 'POST', origin: 'http://evil.invalid', path: '/mutate' });
    assert.equal(buildStartupChecks(proof).networkBoundary.ok, false);
    proof.networkProbe.unexpected.length = 0;
    const duplicateRecovery = structuredClone(proof);
    duplicateRecovery.networkProbe.mutations.push({
      method: 'POST',
      origin: proof.expected.backendOrigin,
      path: `/api/local-archive/workfiles/${encodeURIComponent(seed.projectId)}/recover-latest`,
    });
    assert.equal(buildStartupChecks(duplicateRecovery).networkBoundary.ok, false);
    const startupLastWorkWrite = structuredClone(proof);
    startupLastWorkWrite.networkProbe.mutations.push({
      method: 'POST', origin: proof.expected.backendOrigin, path: '/api/last-work',
    });
    assert.equal(buildStartupChecks(startupLastWorkWrite).networkBoundary.ok, false);
    proof.cleanup.afterStorage = { ...proof.cleanup.afterStorage, sha256: 'changed' };
    assert.equal(buildStartupChecks(proof).storageCleanup.ok, false);
    proof.cleanup.afterStorage = { ...proof.cleanup.beforeStorage };
    proof.cleanup.errors.push({ stage: 'storage-restore', error: 'injected' });
    assert.equal(buildStartupChecks(proof).lifecycleCleanup.ok, false);
  } finally {
    store.dispose();
  }
});

test('DB-05 startup network gate accepts idempotent OAuth refresh variations inside the allowlist', () => {
  const seed = buildStartupSeed(22307);
  const token = { version: 'factory-store:v1', workspaceId: seed.projectId, revision: 4, fence: 2 };
  const proof = validProof(token, seed);
  proof.networkProbe.mutations = [
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/refresh-token' },
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/refresh-token' },
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/setup-status' },
  ];
  proof.networkProbe.requests = [...proof.networkProbe.mutations];
  assert.equal(buildStartupChecks(proof).networkBoundary.ok, true);
});

test('DB-05 canonical fixture reads the actual startup factory-store token', async () => {
  const seed = buildStartupSeed(22306);
  const { createFactoryStore } = await import(`${pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-store.mjs')).href}?db05-fixture=${Date.now()}`);
  const store = createFactoryStore({
    workspaceId: seed.projectId,
    revision: 0,
    initialSnapshot: { factory: { workspace: { id: seed.projectId }, product: {} } },
  });
  try {
    const context = vm.createContext({
      structuredClone,
      state: { currentProjectId: seed.projectId },
      factoryRuntimeStore: store,
      factoryRuntimeReadFactory: () => store.getSnapshot().factory,
      factoryRuntimeReplaceFactorySnapshot: value => value,
      render: () => 'rendered',
      classicRuntimeHydrationReady: true,
      classicRuntimeInitialRenderComplete: true,
    });
    assert.equal(vm.runInContext(factoryCdpFixtureReadyExpression(), context), true);
    const token = vm.runInContext(factoryCdpFixtureExpression(`({ readAppWorkspaceId, readOperationToken }) => ({ workspaceId: readAppWorkspaceId(), token: readOperationToken() })`), context);
    assert.equal(token.workspaceId, seed.projectId);
    assert.deepEqual(token.token, { version: 'factory-store:v1', workspaceId: seed.projectId, revision: 0, fence: 1 });
  } finally {
    store.dispose();
  }
});
