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

function takeoverAuthoritySource() {
  const core02 = read('src/app-core-02.js');
  return sourceBetween(
    core02,
    ['const workspaceTakeoverHydrationAuthority =', 'const TAKEOVER_HYDRATION_AUTHORITY_ASSERT'],
    'function factoryLastSnapshotRecoveryWriteDecision',
  );
}

function authorityHarnessSource() {
  return `
    ${takeoverAuthoritySource()}
    const authorityApi = typeof workspaceTakeoverHydrationAuthority === 'undefined'
      ? Object.freeze({ create: createWorkspaceTakeoverHydrationAuthority, assert: assertTakeoverHydrationAuthority })
      : workspaceTakeoverHydrationAuthority;
  `;
}

function workspaceTransitionStateSource() {
  const core02 = read('src/app-core-02.js');
  return sourceBetween(
    core02,
    ['const workspaceScopeTransitionState ='],
    'const SERVER_LAST_WORK_RETRY_BASE_MS',
  );
}

function requiredFieldRestoreSource() {
  const core02 = read('src/app-core-02.js');
  return sourceBetween(
    core02,
    ['const LAST_WORK_REQUIRED_FIELD_ALIASES = Object.freeze'],
    'function lastWorkSnapshotScore',
  );
}

test('classic runtime keeps takeover authority lexical and rejects forged, proxied, stale, or closed tokens', () => {
  const accepted = {
    mode: 'editing', scopeId: 'project:alpha', sessionId: 'session-local', leaseId: 'lease-b',
    fencingToken: 8, revision: 4,
  };
  const sandbox = { accepted, current: { ...accepted, mode: 'acquiring' } };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`
    const currentWorkspaceAuthority = () => current;
    ${authorityHarnessSource()}
    const authority = authorityApi.create(accepted);
    globalThis.exposedNames = Object.freeze({
      create: Object.hasOwn(window, 'createWorkspaceTakeoverHydrationAuthority'),
      assert: Object.hasOwn(window, 'assertTakeoverHydrationAuthority'),
      namespace: Object.hasOwn(window, 'workspaceTakeoverHydrationAuthority'),
    });
    globalThis.verify = () => authorityApi.assert(authority);
    globalThis.verifyForged = () => authorityApi.assert(Object.freeze({
      identity: authority.identity,
      close: authority.close,
    }));
    globalThis.verifyProxy = () => authorityApi.assert(new Proxy(authority, {}));
    globalThis.closeAuthority = () => authority.close();
  `, context);

  assert.deepEqual({ ...context.exposedNames }, { create: false, assert: false, namespace: false });
  assert.doesNotThrow(() => vm.runInContext('verify()', context));
  assert.throws(() => vm.runInContext('verifyForged()', context), /INVALID_TAKEOVER_HYDRATION_AUTHORITY/);
  assert.throws(() => vm.runInContext('verifyProxy()', context), /INVALID_TAKEOVER_HYDRATION_AUTHORITY/);
  context.current = { ...context.current, mode: 'editing' };
  assert.throws(() => vm.runInContext('verify()', context), /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
  context.current = { ...context.current, mode: 'acquiring' };
  context.current = { ...context.current, fencingToken: 9 };
  assert.throws(() => vm.runInContext('verify()', context), /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
  context.current = { ...context.current, fencingToken: 8, leaseId: 'wrong-lease' };
  assert.throws(() => vm.runInContext('verify()', context), /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
  context.current = { ...context.current, leaseId: 'lease-b', revision: 5 };
  assert.throws(() => vm.runInContext('verify()', context), /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
  context.current = { ...context.current, revision: 4 };
  vm.runInContext('closeAuthority()', context);
  assert.throws(() => vm.runInContext('verify()', context), /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
});

test('failed takeover apply restores the prior app and factory snapshots before rethrow', async () => {
  const core02 = read('src/app-core-02.js');
  const hydrateSource = sourceBetween(
    core02,
    ['async function hydrateServerLastWorkSnapshot'],
    'async function refreshCompetitorAnalysisFromServer',
  );
  const accepted = {
    scopeId: 'project:alpha', sessionId: 'session-local', leaseId: 'lease-b',
    fencingToken: 8, revision: 4,
  };
  const sandbox = { accepted, current: { ...accepted, mode: 'acquiring' } };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`
    const currentWorkspaceAuthority = () => current;
    ${authorityHarnessSource()}
    const state = { marker: 'before', retained: { value: 1 }, sectionImages: {} };
    let factory = { workspace: { id: 'project:alpha' }, product: { name: 'before' } };
    const rollbackReasons = [];
    let workspaceBlankResetToken = 0;
    let serverLastWorkHydrated = false;
    let serverLastWorkHydrating = false;
    let sessionAssetsHydrated = false;
    let pendingSessionAssetSaveAfterHydrate = false;
    const getCurrentLastWorkWorkspaceScope = () => 'project:alpha';
    const workspaceHydrationScopeIsCurrent = () => true;
    let deferRestore = false;
    let resolveRestore = null;
    const cloneData = value => JSON.parse(JSON.stringify(value));
    const factoryRuntimeReadFactory = () => factory;
    const factoryRuntimeReplaceFactorySnapshot = (value, options) => {
      if (options.takeoverAuthority) authorityApi.assert(options.takeoverAuthority);
      rollbackReasons.push(options.reason);
      factory = value;
      return factory;
    };
    const workspacePersistenceApi = () => ({
      restore: async () => {
        if (deferRestore) await new Promise(resolve => { resolveRestore = resolve; });
        return {
          revision: { counter: 4 },
          snapshot: { workspaceScope: { id: 'project:alpha' }, savedAt: 10, assets: {}, workspaceRevision: { counter: 4 } },
        };
      },
    });
    const lastWorkSnapshotMatchesCurrentWorkspace = () => true;
    const lastWorkSnapshotMatchesWorkspaceScope = () => true;
    const workspaceSnapshotRevision = snapshot => snapshot.workspaceRevision;
    const lastWorkSnapshotScore = () => 10;
    const getCurrentLastWorkScore = () => 0;
    const getCurrentLastWorkSavedAt = () => 0;
    const lastWorkCompAnalysisTime = () => 0;
    const getCurrentCompAnalysisTime = () => 0;
    const snapshotSectionImagesQualityScore = () => 0;
    const sectionImagesQualityScore = () => 0;
    const persistedCutResultCount = () => 0;
    const hasInlineImagePayload = () => false;
    const lastWorkFactoryHasSelfConsistentCurrentAssets = () => false;
    const observeWorkspaceRevisionSnapshot = () => null;
    const applyServerLastWorkSnapshot = (_snapshot, options) => {
      authorityApi.assert(options.takeoverAuthority);
      state.marker = 'after';
      state.transient = true;
      factory = { workspace: { id: 'project:alpha' }, product: { name: 'after' } };
      throw new Error('APPLY_FAILED');
    };
    const markWorkspaceDocumentClean = () => {};
    const scheduleSessionAssetSaveIfChanged = () => {};
    const snapshotHasInlineImagePayload = () => false;
    const render = () => {};
    const saveCompAnalysis = () => {};
    const saveServerLastWorkSnapshot = async () => {};
    ${requiredFieldRestoreSource()}
    ${workspaceTransitionStateSource()}
    ${hydrateSource}
    const authority = authorityApi.create(accepted);
    globalThis.runHydrate = () => hydrateServerLastWorkSnapshot({
      force: true,
      takeoverSync: true,
      minimumRevision: authority.identity.revision,
      takeoverAuthority: authority,
    });
    globalThis.readResult = () => JSON.stringify({ state, factory, rollbackReasons });
    globalThis.runStaleHydrate = () => {
      deferRestore = true;
      const authority = authorityApi.create(accepted);
      return hydrateServerLastWorkSnapshot({ force: true, takeoverSync: true, takeoverAuthority: authority });
    };
    globalThis.supersede = () => {
      current = { ...accepted, scopeId: 'project:newer', leaseId: 'lease-newer', fencingToken: 9, mode: 'editing' };
      state.marker = 'newer';
      factory = { workspace: { id: 'project:newer' }, product: { name: 'newer' } };
      resolveRestore();
    };
  `, context);

  await assert.rejects(context.runHydrate(), /APPLY_FAILED/);
  assert.deepEqual(JSON.parse(context.readResult()), {
    state: { marker: 'before', retained: { value: 1 }, sectionImages: {} },
    factory: { workspace: { id: 'project:alpha' }, product: { name: 'before' } },
    rollbackReasons: ['takeover-hydrate-rollback'],
  });
  const staleHydrate = context.runStaleHydrate();
  context.supersede();
  await assert.rejects(staleHydrate, /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
  assert.deepEqual(JSON.parse(context.readResult()), {
    state: { marker: 'newer', retained: { value: 1 }, sectionImages: {} },
    factory: { workspace: { id: 'project:newer' }, product: { name: 'newer' } },
    rollbackReasons: ['takeover-hydrate-rollback'],
  });
});

test('reload failure closes its authority and the coordinator releases the lease with failure reason', async () => {
  const core06 = read('src/app-core-06.js');
  const reloadSource = sourceBetween(
    core06,
    ['async function reloadAcceptedWorkspace'],
    'async function runClassicRuntimeHydration',
  );
  const sandbox = { current: null };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`
    const currentWorkspaceAuthority = () => current;
    ${authorityHarnessSource()}
    let capturedAuthority = null;
    const hydrateServerLastWorkSnapshot = async options => {
      capturedAuthority = options.takeoverAuthority;
      authorityApi.assert(capturedAuthority);
      throw new Error('APPLY_FAILED');
    };
    ${reloadSource}
    globalThis.reloadAccepted = accepted => {
      current = { ...accepted, mode: 'acquiring' };
      return reloadAcceptedWorkspace(accepted);
    };
    globalThis.assertCapturedAuthority = () => authorityApi.assert(capturedAuthority);
  `, context);

  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/modules/workspace-lock.mjs')).href}?rollback=${Date.now()}`;
  const { createWorkspaceLockCoordinator } = await import(moduleUrl);
  const requests = [];
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
            leaseId: 'lease-b', fencingToken: 8, revision: 4,
          };
        },
      };
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  const coordinator = createWorkspaceLockCoordinator({
    root,
    serverBases: () => ['http://test.invalid'],
    reloadAccepted: context.reloadAccepted,
  });

  await assert.rejects(
    coordinator.takeover({ scopeId: 'project:alpha', ownerId: 'B', confirmed: true }),
    error => error?.code === 'TAKEOVER_RELOAD_FAILED',
  );
  assert.throws(context.assertCapturedAuthority, /STALE_TAKEOVER_HYDRATION_AUTHORITY/);
  assert.equal(coordinator.snapshot().mode, 'readonly');
  assert.equal(coordinator.snapshot().reasonCode, 'TAKEOVER_RELOAD_FAILED');
  const releases = requests.filter(item => item.url.includes('/release'));
  assert.equal(releases.length, 1);
  assert.equal(JSON.parse(releases[0].options.body).leaseId, 'lease-b');
});

test('Given a richer current option state than the server receipt When ordinary hydration refuses the downgrade Then it forces a server-enabled repair save', async () => {
  const core02 = read('src/app-core-02.js');
  const hydrateSource = sourceBetween(
    core02,
    ['async function hydrateServerLastWorkSnapshot'],
    'async function refreshCompetitorAnalysisFromServer',
  );
  const saveCalls = [];
  const context = vm.createContext({
    state: {
      sectionImages: {},
      optionSorter: { images: [{ id: 'red' }], slots: [{ id: 'slot-red', imgIds: ['red'] }], optionResults: [{ id: 'cut-red' }] },
      compPage: {},
      cuts: {},
      productInfoManualValues: {},
    },
    serverLastWorkHydrated: false,
    serverLastWorkHydrating: false,
    serverLastWorkHydrationPromise: null,
    workspaceBlankResetToken: 0,
    workspaceScopeTransitionState: { persistentSaveQueued: false },
    getCurrentLastWorkWorkspaceScope: () => 'project:option-work',
    getCurrentDocumentWorkspaceScope: () => 'project:option-work',
    workspaceHydrationScopeIsCurrent: () => true,
    workspacePersistenceApi: () => ({
      restore: async () => ({
        snapshot: {
          workspaceScope: { id: 'project:option-work' },
          assets: { optionSorter: { images: [], slots: [], optionResults: [] }, compPage: {}, cuts: {} },
        },
      }),
    }),
    lastWorkSnapshotMatchesWorkspaceScope: () => true,
    lastWorkSnapshotScore: () => 0,
    getCurrentLastWorkScore: () => 0,
    getCurrentLastWorkSavedAt: () => 0,
    lastWorkCompAnalysisTime: () => 0,
    getCurrentCompAnalysisTime: () => 0,
    snapshotSectionImagesQualityScore: () => 0,
    sectionImagesQualityScore: () => 0,
    hasInlineImagePayload: () => false,
    lastWorkCompMarketScore: () => 0,
    optionSorterSnapshotIsMoreComplete: (current, incoming) => (current?.images?.length || 0) > (incoming?.images?.length || 0),
    lastWorkOptionLabelsRestoreNeeded: () => false,
    persistedCutResultCount: () => 0,
    lastWorkRequiredFieldRestoreNeeded: () => false,
    factoryRuntimeReadFactory: () => ({}),
    lastWorkFactoryHasSelfConsistentCurrentAssets: () => false,
    observeWorkspaceRevisionSnapshot: () => null,
    // 추출한 hydrate 블록은 app-core-02 모듈 스코프의 이 함수를 참조한다.
    // 스텁이 없으면 ReferenceError가 내부 catch에 삼켜져 검사 대상 분기까지 가지도 못한다.
    workspaceSnapshotRevision: snapshot => (snapshot && snapshot.workspaceRevision) || null,
    snapshotHasInlineImagePayload: () => false,
    savePersistentState: options => saveCalls.push(options),
    setTimeout: callback => { callback(); return 1; },
    clearTimeout() {},
  });
  vm.runInContext(`${hydrateSource}\nglobalThis.runHydrate = hydrateServerLastWorkSnapshot;`, context);

  await context.runHydrate();

  assert.deepEqual(JSON.parse(JSON.stringify(saveCalls)), [{ server: true, force: true }]);
});
