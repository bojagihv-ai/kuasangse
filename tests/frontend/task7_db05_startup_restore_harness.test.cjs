const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  buildStartupChecks,
  buildStartupSeed,
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
    mode: 'editing', scopeId: seed.projectScope, leaseId: `db05-lease-${seed.projectId}`,
    fencingToken: 7, ownerId: 'DB05 owner', sessionId: 'db05-session', revision: 4,
  };
  const mutations = [
    { method: 'POST', origin: backendOrigin, path: '/api/workspace-lock/acquire' },
    ...Array.from({ length: 4 }, () => ({ method: 'POST', origin: backendOrigin, path: '/api/last-work' })),
    { method: 'POST', origin: backendOrigin, path: `/api/local-archive/workfiles/${encodeURIComponent(seed.projectId)}/recover-latest` },
    { method: 'POST', origin: backendOrigin, path: '/api/cafe24-control/start' },
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/refresh-token' },
    { method: 'POST', origin: 'http://127.0.0.1:4321', path: '/api/invoke/cafe24_control_tower/setup-status' },
  ];
  return {
    expected: { ...seed, appOrigin, backendOrigin },
    appWorkspaceId: seed.projectId,
    factoryWorkspaceId: seed.projectId,
    persistenceScope: seed.projectScope,
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

test('DB-05 startup checks reject token, authority, network, and cleanup drift by stable code', async () => {
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
    { method: 'POST', origin: proof.expected.backendOrigin, path: '/api/workspace-lock/acquire' },
    { method: 'POST', origin: proof.expected.backendOrigin, path: '/api/last-work' },
    { method: 'POST', origin: proof.expected.backendOrigin, path: `/api/local-archive/workfiles/${encodeURIComponent(seed.projectId)}/recover-latest` },
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
