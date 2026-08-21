const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MODULE = path.resolve(__dirname, '..', '..', 'src', 'app-core-03.js');

function saveCurrentProjectSource() {
  const source = fs.readFileSync(MODULE, 'utf8');
  const start = source.indexOf('async function saveCurrentProject(');
  const end = source.indexOf('\nasync function saveCurrentSnapshot(', start);
  assert.ok(start >= 0 && end > start, 'saveCurrentProject source must be extractable');
  return source.slice(start, end);
}

test('same-work project save preserves archived option source rows before snapshot construction', () => {
  // Given: the same project has a durable option-source payload from an earlier checkpoint.
  const source = saveCurrentProjectSource();

  // When: saveCurrentProject prepares its next server snapshot.
  const mergeIndex = source.indexOf('mergeOptionSorterStoredImages(existingOptionSorter, state.optionSorter || {})');
  const snapshotIndex = source.indexOf('const record = {');

  // Then: durable option rows merge into the live state before the snapshot can be protected as a drop.
  assert.match(source, /const existingOptionSorter = existing\?\.payload\?\.assetPayload\?\.optionSorter;/);
  assert.ok(mergeIndex >= 0, 'same-work project save must merge durable option rows into the live option sorter');
  assert.ok(mergeIndex < snapshotIndex, 'option preservation must happen before building the project snapshot');
});

test('same-work project save keeps competitor candidates when live factory product metadata is temporarily empty', async () => {
  const source = saveCurrentProjectSource();
  const projectId = 'batch:factory-job-manual-cut';
  const projectKey = '수동a컷검증미니데스크오거나이저b';
  const existingCompPage = {
    marketScrape: {
      results: [{ id: 'coupang_8441491560', product_id: '8441491560' }],
    },
  };
  let payloadOptions = null;
  const persistentSaveCalls = [];
  const state = {
    currentProjectId: projectId,
    currentProjectName: '수동 A컷 검증 미니 데스크 오거나이저 B',
    currentProjectCreatedAt: 1,
    contentVersion: 0,
    workIdentity: null,
    factory: {},
  };
  const currentFactory = { product: {} };
  const context = vm.createContext({
    state,
    workspaceScopeTransitionState: { inProgress: false, persistentSaveQueued: false },
    WORKSPACE_DB: { projects: 'projects', appSettings: 'appSettings' },
    factoryRuntimeStore: null,
    settleWorkspaceScopeTransitionPersistence: async () => {},
    getCurrentLastWorkWorkspaceScope: () => `project:${projectId}`,
    render() {},
    factoryRuntimeNormalizeFactorySnapshot: value => value,
    factoryRuntimeReadCommittedFactory: () => currentFactory,
    factoryWorkspaceIdentityFromSource: () => ({ id: projectId }),
    factoryCurrentWorkspaceId: () => projectId,
    uid: () => projectId,
    workspaceGet: async () => ({
      id: projectId,
      createdAt: 1,
      payload: {
        workspaceScope: { id: `project:${projectId}` },
        workIdentity: { initialProductKey: projectKey },
        assetPayload: {
          factory: { product: { productName: state.currentProjectName } },
          compPage: existingCompPage,
        },
      },
    }),
    deriveProjectName: () => state.currentProjectName,
    ensureWorkspaceEditAuthority: async () => ({ mode: 'editing' }),
    factoryStampWorkspaceIdentity() {},
    factoryMigrateReviewCandidateWorkspaceScope() {},
    factoryStampFactoryItemsWorkspaceIdentity() {},
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryObjectIdentityKey: product => String(product?.productName || '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKeysCompatible: (left, right) => !!left && !!right && (left === right || left.includes(right) || right.includes(left)),
    compactProductImageBackupPayload: () => ({}),
    buildWorkspacePayload: options => {
      payloadOptions = options;
      return {};
    },
    buildFactoryProjectPersistenceServerSnapshot: () => ({}),
    workspacePersistenceApi: () => ({
      restore: async () => null,
      commit: async () => ({ accepted: true, clean: true, protectedNoOp: false }),
    }),
    workspaceCommitMetadata: () => ({}),
    markWorkspaceDocumentClean() {},
    setUiNotice() {},
    refreshWorkspaceLists: async () => {},
    savePersistentState: options => persistentSaveCalls.push(structuredClone(options || {})),
  });
  vm.runInContext(`${source}\nglobalThis.save = saveCurrentProject;`, context);

  assert.equal(await context.save(), true, state.error || 'project save must complete');
  assert.ok(payloadOptions.storedCompPage, 'same work identity must supply existing competitor candidates to the next snapshot');
  assert.equal(payloadOptions.storedCompPage.marketScrape.results[0].product_id, '8441491560');

  persistentSaveCalls.length = 0;
  assert.equal(
    await context.save({ retainProjectAuthority: true }),
    true,
    state.error || 'batch checkpoint save must complete',
  );
  assert.deepEqual(
    persistentSaveCalls,
    [],
    'batch checkpoint save must not start a draft-branch session write after retaining project authority',
  );
});

test('same-scope server-restored candidate fields survive a thin batch project save', async () => {
  const core02 = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'app-core-02.js'), 'utf8');
  const mergeStart = core02.indexOf('function mergeSameWorkDerivedValue(');
  const mergeEnd = core02.indexOf('\nfunction recoverStaleSessionInlineImages(', mergeStart);
  const scopeStart = core02.indexOf('function lastWorkSnapshotWorkspaceScope(');
  const scopeEnd = core02.indexOf('\nfunction lastWorkSnapshotMatchesTakeoverWorkspace(', scopeStart);
  const payloadStart = fs.readFileSync(MODULE, 'utf8').indexOf('function buildWorkspacePayload(');
  const payloadEnd = fs.readFileSync(MODULE, 'utf8').indexOf('\nfunction restoreProjectFileFactoryAssetsFromPayload(', payloadStart);
  assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'competitor merge source must be extractable');
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'workspace scope source must be extractable');
  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, 'workspace payload source must be extractable');

  // Given: IndexedDB has no project record, but the exact project scope was restored from server.
  const projectId = 'batch-job-16';
  const targetScopeId = `project:${projectId}`;
  const thinCandidate = { id: 'coupang_8441491560' };
  const serverCandidates = Array.from({ length: 11 }, (_, index) => ({
    id: index === 0 ? thinCandidate.id : `coupang_${index}`,
    product_id: index === 0 ? '8441491560' : String(index),
    sourceFactoryWorkKey: 'batch:factory-source',
  }));
  let committed = null;
  const restoreCalls = [];
  let restoredServer = {
    source: 'server',
    snapshot: {
      workspaceScope: { id: targetScopeId },
      assets: {
        workIdentity: { initialProductKey: '배치 후보 보존 제품' },
        compPage: {
          marketScrape: {
            results: serverCandidates,
            selectedIds: ['server-selected'],
            selectedImageIds: ['server-image'],
            detailSelectionVersion: 1,
          },
        },
      },
      lightweight: { compPage: { marketScrape: { results: [thinCandidate] } } },
    },
  };
  const currentFactory = {
    product: { productName: '배치 후보 보존 제품' },
    competitors: {
      compPage: {
        marketScrape: {
          results: [thinCandidate],
          selectedIds: ['live-selected'],
          selectedImageIds: ['live-image'],
          detailSelectionVersion: 2,
        },
      },
    },
  };
  const state = {
    currentProjectId: projectId,
    currentProjectName: '배치 후보 보존 제품',
    currentProjectCreatedAt: 1,
    productName: '배치 후보 보존 제품',
    contentVersion: 0,
    workIdentity: { initialProductKey: '배치 후보 보존 제품' },
    factory: currentFactory,
    compPage: {
      marketScrape: {
        results: [thinCandidate],
        selectedIds: ['live-selected'],
        selectedImageIds: ['live-image'],
        detailSelectionVersion: 2,
      },
    },
  };
  const context = vm.createContext({
    state,
    workspaceScopeTransitionState: { inProgress: false, persistentSaveQueued: false },
    WORKSPACE_DB: { projects: 'projects', appSettings: 'appSettings' },
    factoryRuntimeStore: null,
    settleWorkspaceScopeTransitionPersistence: async () => {},
    getCurrentLastWorkWorkspaceScope: () => targetScopeId,
    render() {},
    cloneData: value => structuredClone(value),
    factoryRuntimeNormalizeFactorySnapshot: value => structuredClone(value),
    factoryRuntimeReadCommittedFactory: () => currentFactory,
    factoryWorkspaceIdentityFromSource: () => ({ id: projectId }),
    factoryCurrentWorkspaceId: () => projectId,
    uid: () => projectId,
    workspaceGet: async () => null,
    deriveProjectName: () => state.currentProjectName,
    ensureWorkspaceEditAuthority: async () => ({ mode: 'editing' }),
    factoryStampWorkspaceIdentity() {},
    factoryMigrateReviewCandidateWorkspaceScope() {},
    factoryStampFactoryItemsWorkspaceIdentity() {},
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryObjectIdentityKey: product => String(product?.productName || '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKeysCompatible: (left, right) => !!left && !!right && left === right,
    compactProductImageBackupPayload: () => ({}),
    productImageBackupReferencePayload: () => ({}),
    workspacePersistenceApi: () => ({
      normalizeWorkspaceScope: value => value,
      restore: async options => {
        restoreCalls.push(structuredClone(options));
        return structuredClone(restoredServer);
      },
      commit: async command => {
        committed = command;
        return { accepted: true, clean: true, protectedNoOp: false };
      },
    }),
    currentWorkspaceInputImageFingerprint: () => '',
    ensureActiveWorkIdentity: () => ({ workspaceId: targetScopeId }),
    currentWorkspaceRevision: () => null,
    currentWorkspaceBranch: () => null,
    currentSessionAssetsPayload: options => ({ compPage: structuredClone(options.compPageSnapshot) }),
    projectWorkspaceSnapshotForDocument: value => value,
    sectionWorkScopeMeta: () => ({}),
    normalizeAnalysisMatchSettings: () => ({}),
    normalizeProductInfoFieldSettings: () => ({}),
    loadFixedDetailImages: () => ({}),
    buildLightweightSessionPayload: value => value,
    buildFactoryProjectPersistenceServerSnapshot: () => ({}),
    workspaceCommitMetadata: () => ({}),
    markWorkspaceDocumentClean() {},
    setUiNotice() {},
    refreshWorkspaceLists: async () => {},
    savePersistentState() {},
    Date: { now: () => 100 },
  });
  const source = process.env.KUASANGSE_MUTATE_SERVER_SOURCE_FENCE === '1'
    ? saveCurrentProjectSource().replaceAll("restored?.source === 'server'", 'true')
    : saveCurrentProjectSource();
  const payloadSource = fs.readFileSync(MODULE, 'utf8').slice(payloadStart, payloadEnd);
  const mergeSource = core02.slice(mergeStart, mergeEnd);
  const scopeSource = core02.slice(scopeStart, scopeEnd);
  vm.runInContext(`${scopeSource}\n${mergeSource}\n${payloadSource}\n${source}\nglobalThis.save = saveCurrentProject;`, context);

  // When: the batch project save creates its outgoing server snapshot.
  assert.equal(await context.save(), true, state.error || 'project save must complete');

  // Then: all durable candidates and their protected fields survive while newer live selections win.
  assert.equal(committed.snapshot.compPage.marketScrape.results.length, 11);
  assert.equal(committed.snapshot.compPage.marketScrape.results[0].product_id, '8441491560');
  assert.equal(committed.snapshot.compPage.marketScrape.results[0].sourceFactoryWorkKey, 'batch:factory-source');
  assert.deepEqual(Array.from(committed.snapshot.compPage.marketScrape.selectedIds), ['live-selected']);
  assert.deepEqual(Array.from(committed.snapshot.compPage.marketScrape.selectedImageIds), ['live-image']);

  restoredServer = {
    source: 'server',
    snapshot: {
      workspaceScope: { id: targetScopeId },
      workIdentity: { initialProductKey: '배치 후보 보존 제품' },
      compPage: {
        marketScrape: {
          results: serverCandidates,
          selectedIds: ['server-selected'],
          selectedImageIds: ['server-image'],
        },
      },
    },
  };
  assert.equal(await context.save(), true, state.error || 'normalized server snapshot must preserve protected candidates');
  assert.equal(committed.snapshot.compPage.marketScrape.results.length, 11);
  assert.equal(committed.snapshot.compPage.marketScrape.results[0].product_id, '8441491560');

  restoredServer = {
    source: 'server',
    snapshot: {
      workspaceScope: { id: 'project:other-job' },
      assets: { compPage: { marketScrape: { results: serverCandidates } } },
    },
  };
  assert.equal(await context.save(), true, state.error || 'mismatched server scope must not block project save');
  assert.equal(committed.snapshot.compPage.marketScrape.results[0].product_id, undefined);

  if (process.env.KUASANGSE_MUTATE_SERVER_SOURCE_FENCE !== '1') {
    restoredServer = null;
    assert.equal(await context.save(), true, state.error || 'null server restore must not block project save');
  }

  restoredServer = { source: 'server', snapshot: { workspaceScope: { id: targetScopeId }, assets: {} } };
  assert.equal(await context.save(), true, state.error || 'empty server compPage must not block project save');

  restoredServer = {
    source: 'server',
    snapshot: {
      workspaceScope: { id: targetScopeId },
      assets: { factory: { competitors: { compPage: { marketScrape: { results: [thinCandidate] } } } } },
      lightweight: {
        workIdentity: { initialProductKey: '배치 후보 보존 제품' },
        compPage: { marketScrape: { results: serverCandidates } },
      },
    },
  };
  assert.equal(await context.save(), true, state.error || 'lightweight fallback must preserve server candidates');
  assert.equal(committed.snapshot.compPage.marketScrape.results.length, 11);

  restoredServer = {
    source: 'server',
    snapshot: {
      workspaceScope: { id: targetScopeId },
      assets: {
        workIdentity: { initialProductKey: 'conflicting product' },
        compPage: { marketScrape: { results: serverCandidates } },
      },
    },
  };
  assert.equal(await context.save(), true, state.error || 'conflicting server identity must not block project save');
  assert.equal(committed.snapshot.compPage.marketScrape.results.length, 1);

  restoredServer = {
    source: 'indexeddb',
    snapshot: {
      workspaceScope: { id: targetScopeId },
      assets: {
        workIdentity: { initialProductKey: '배치 후보 보존 제품' },
        compPage: { marketScrape: { results: serverCandidates } },
      },
    },
  };
  assert.equal(await context.save(), true, state.error || 'non-server restore must not block project save');
  assert.equal(committed.snapshot.compPage.marketScrape.results.length, 1);
  assert.equal(committed.snapshot.compPage.marketScrape.results[0].product_id, undefined);
  assert.equal(committed.snapshot.compPage.marketScrape.results[0].sourceFactoryWorkKey, undefined);

  const unfencedSource = source.replaceAll("restored?.source === 'server'", 'true');
  assert.notEqual(unfencedSource, source, 'mutation proof must remove the server-source fence');
  vm.runInContext(`${unfencedSource}\nglobalThis.unfencedSave = saveCurrentProject;`, context);
  assert.equal(await context.unfencedSave(), true, state.error || 'unfenced mutation must complete the normal save path');
  assert.equal(committed.snapshot.compPage.marketScrape.results.length, 11);
  assert.deepEqual(
    restoreCalls,
    Array.from({ length: 9 }, () => ({ scopeId: targetScopeId, sources: ['server'] })),
  );
});
