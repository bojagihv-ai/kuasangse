'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');

function compileCounter(state, factory) {
  const start = CORE.indexOf('function countSessionAssetRestoreRefs(');
  const end = CORE.indexOf('\nfunction wasStorageWarningDismissed(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = vm.createContext({
    state,
    factoryRuntimeReadFactory: () => factory,
    hasRestoredImagePayloadValue: value => Boolean(
      value && value !== '__stored_in_indexeddb__',
    ),
    factoryImagePayloadFingerprint: value => {
      const base64 = String(value || '').replace(/^data:image\/[^;,]+;base64,/i, '');
      return base64 ? `${base64.length}:${base64}` : '';
    },
    hasInlineImagePayload: (record, keys) => keys.some(key => {
      const value = record?.[key];
      return Boolean(value && value !== '__stored_in_indexeddb__');
    }),
  });
  vm.runInContext(
    `${CORE.slice(start, end)}\nthis.countRestoreRefs = countSessionAssetRestoreRefs;`,
    context,
  );
  return context.countRestoreRefs;
}

function compileWarningMessage(state, factory, missingCount) {
  const start = CORE.indexOf('function showImageRestoreWarningIfNeeded(');
  const end = CORE.indexOf('\nfunction mergeOptionSorterStoredImages(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = vm.createContext({
    state,
    countSessionAssetRestoreRefs: () => missingCount,
    wasStorageWarningDismissed: () => false,
    factoryRuntimeReadFactory: () => factory,
    hasInlineImagePayload: (record, keys) => keys.some(key => Boolean(
      record?.[key] && record[key] !== '__stored_in_indexeddb__',
    )),
  });
  vm.runInContext(
    `${CORE.slice(start, end)}\nthis.showRestoreWarning = showImageRestoreWarningIfNeeded;`,
    context,
  );
  return context.showRestoreWarning;
}

function compilePersistentSessionAssetHydrator(sessionAssets, observed) {
  const start = CORE.indexOf('async function hydratePersistentSessionAssets(');
  const end = CORE.indexOf('\n// ════════════════════════════════════════════════════════════════', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = vm.createContext({
    state: { step: 'factory', currentProjectId: '' },
    sessionAssetsHydrated: false,
    workspaceBlankResetToken: 0,
    pendingSessionAssetSaveAfterHydrate: false,
    workspaceBlankResetInProgress: false,
    getCurrentLastWorkWorkspaceScope: () => 'project:current',
    workspaceHydrationScopeIsCurrent: () => true,
    workspaceGetSessionAssets: async () => sessionAssets,
    WORKSPACE_DB: { projects: 'projects' },
    workspaceGet: async (storeName, projectId) => {
      observed.projectLookup = { storeName, projectId };
      return storeName === 'projects' && projectId === 'current'
        ? {
          payload: {
            productImageBackup: {
              id: 'workspaceProductImageBackup:project:current',
              storage: 'appSettings',
              primary: { base64: '' },
            },
          },
        }
        : null;
    },
    migrateDocumentSessionAssetsToCurrentBranch: async () => null,
    lastWorkSnapshotMatchesWorkspaceScope: () => true,
    lastWorkPayloadProductName: () => '모시꽃수파우치',
    snapshotHasInlineImagePayload: () => false,
    recoverStaleSessionInlineImages: () => false,
    hydrateLastProductImageBackup: async () => false,
    hydrateWorkspacePayloadImageBackup: async payload => ({
      ...payload,
      productImageBackup: {
        ...payload.productImageBackup,
        primary: { base64: 'RESTORED_PROJECT_BACKUP' },
      },
    }),
    applySessionAssetsPayload: assets => {
      observed.base64 = assets.productImageBackup?.primary?.base64 || '';
      return true;
    },
    markSessionAssetFingerprintSaved: () => {},
    showImageRestoreWarningIfNeeded: () => false,
    render: () => {},
    scheduleCompetitorEvidenceCanvasPaint: () => {},
    scheduleSessionAssetSave: () => {},
    setTimeout: callback => { callback(); return 0; },
    clearTimeout: () => {},
  });
  vm.runInContext(
    `${CORE.slice(start, end)}\nthis.hydratePersistentSessionAssets = hydratePersistentSessionAssets;`,
    context,
  );
  return context.hydratePersistentSessionAssets;
}

function compileServerLastWorkHydrator(observed) {
  const start = CORE.indexOf('async function hydrateServerLastWorkSnapshot(');
  const end = CORE.indexOf('\nasync function refreshCompetitorAnalysisFromServer(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const snapshot = {
    assets: {
      productImageBackup: {
        id: 'workspaceProductImageBackup:project:current',
        storage: 'appSettings',
        primary: { base64: '' },
      },
    },
    savedAt: 1,
  };
  const context = vm.createContext({
    state: { sectionImages: {}, compPage: {}, productInfoManualValues: {} },
    serverLastWorkHydrated: false,
    serverLastWorkHydrating: false,
    serverLastWorkHydrationPromise: null,
    serverLastWorkLastSavedAt: 0,
    sessionAssetsHydrated: false,
    pendingSessionAssetSaveAfterHydrate: false,
    workspaceBlankResetToken: 0,
    workspaceScopeTransitionState: { persistentSaveQueued: false },
    getCurrentLastWorkWorkspaceScope: () => 'project:current',
    getCurrentDocumentWorkspaceScope: () => '',
    workspaceHydrationScopeIsCurrent: () => true,
    workspacePersistenceApi: () => ({
      restore: async () => ({ snapshot }),
    }),
    lastWorkSnapshotMatchesWorkspaceScope: () => true,
    lastWorkSnapshotScore: () => 0,
    getCurrentLastWorkScore: () => 0,
    optionSorterSnapshotIsMoreComplete: () => false,
    hasInlineImagePayload: () => false,
    lastWorkOptionLabelsRestoreNeeded: () => false,
    getCurrentLastWorkSavedAt: () => 0,
    lastWorkCompAnalysisTime: () => 0,
    getCurrentCompAnalysisTime: () => 0,
    lastWorkCompMarketScore: () => 0,
    snapshotSectionImagesQualityScore: () => 0,
    sectionImagesQualityScore: () => 0,
    persistedCutResultCount: () => 0,
    lastWorkRequiredFieldRestoreNeeded: () => false,
    lastWorkFactoryHasSelfConsistentCurrentAssets: () => false,
    factoryRuntimeReadFactory: () => ({}),
    // 추출한 hydrate 블록은 app-core-02 모듈 스코프의 이 두 함수를 참조한다.
    // 스텁이 없으면 ReferenceError가 내부 catch에 삼켜져 복원 자체가 일어나지 않는다.
    workspaceSnapshotRevision: snapshot => (snapshot && snapshot.workspaceRevision) || null,
    observeWorkspaceRevisionSnapshot: () => null,
    hydrateWorkspacePayloadImageBackup: async payload => ({
      ...payload,
      productImageBackup: {
        ...payload.productImageBackup,
        primary: { base64: 'RESTORED_SERVER_BACKUP' },
      },
    }),
    applyServerLastWorkSnapshot: incoming => {
      observed.base64 = incoming.assets.productImageBackup.primary.base64;
      return true;
    },
    markWorkspaceDocumentClean: () => {},
    snapshotHasInlineImagePayload: () => false,
    saveCompAnalysis: () => {},
    render: () => {},
    setTimeout: () => 0,
  });
  vm.runInContext(
    `${CORE.slice(start, end)}\nthis.hydrateServerLastWorkSnapshot = hydrateServerLastWorkSnapshot;`,
    context,
  );
  return context.hydrateServerLastWorkSnapshot;
}

function compileLastProductBackupHydrator(observed, options = {}) {
  const start = CORE.indexOf('async function hydrateLastProductImageBackup(');
  const end = CORE.indexOf('\nconst LOCAL_SESSION_MAX_CHARS', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = vm.createContext({
    state: {
      currentProjectId: options.currentProjectId ?? 'current',
      currentProjectName: options.currentProjectName || '',
    },
    workspaceBlankResetInProgress: false,
    lastProductImageBackupFingerprint: '',
    WORKSPACE_DB: { appSettings: 'appSettings', projects: 'projects' },
    factoryRuntimeReadFactory: () => options.factory || {},
    getCurrentLastWorkWorkspaceScope: () => 'draft:current',
    workspaceHydrationScopeIsCurrent: () => true,
    lastProductImageBackupStorageId: scopeId => `lastProductImageBackup:${scopeId}`,
    workspaceGet: async (storeName, id) => {
      observed.lookups.push({ storeName, id });
      if (storeName === 'projects' && id === 'current') {
        return {
          payload: {
            productImageBackup: {
              id: 'workspaceProductImageBackup:project:current',
              storage: 'appSettings',
              primary: { base64: '' },
            },
          },
        };
      }
      if (storeName === 'appSettings' && id === 'workspaceProductImageBackup:project:current') {
        return {
          id,
          workspaceScope: { id: 'draft:legacy' },
          primary: { base64: 'RESTORED_COMMON_BACKUP' },
        };
      }
      return null;
    },
    workspaceGetAll: async storeName => (
      storeName === 'projects' ? (options.projects || []) : []
    ),
    migrateDocumentProductImageBackupToCurrentBranch: async () => null,
    productImageBackupMatchesCurrentWorkspace: (payload, workspaceScope) => (
      payload?.workspaceScope?.id === workspaceScope
    ),
    applyProductImageBackupPayload: payload => {
      observed.base64 = payload.primary.base64;
      observed.workspaceScope = payload.workspaceScope?.id || '';
      return true;
    },
    productImageBackupFingerprint: () => 'fingerprint',
  });
  vm.runInContext(
    `${CORE.slice(start, end)}\nthis.hydrateLastProductImageBackup = hydrateLastProductImageBackup;`,
    context,
  );
  return context.hydrateLastProductImageBackup;
}

test('Given one legacy input marker and its restored current image When counting restore failures Then the restored marker is not reported missing', () => {
  // Given: an old workfile kept the marker but not a fingerprint, while its one
  // canonical product image has already been restored.
  const state = {
    step: 'factory',
    imageBase64: 'CURRENT_IMAGE',
    imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
    analysisImages: [{ hasImageData: true, base64: '', preview: '' }],
  };
  const factory = {
    product: {
      hasImage: true,
      imageBase64: 'CURRENT_IMAGE',
      imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
      inputImages: [],
    },
    assets: [],
  };

  // When: the restore warning counter evaluates the hydrated session.
  const countRestoreRefs = compileCounter(state, factory);

  // Then: the legacy marker is satisfied by the restored canonical image.
  assert.equal(countRestoreRefs(), 0);
});

test('Given restored analysis images plus one legacy marker When counting restore failures Then the current product image satisfies that marker', () => {
  // Given: one generated analysis image still has its payload while only the
  // canonical input marker was stripped by legacy persistence.
  const state = {
    step: 'factory',
    imageBase64: 'CURRENT_IMAGE',
    imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
    analysisImages: [
      { hasImageData: true, base64: 'DERIVED_IMAGE', preview: '' },
      { hasImageData: true, base64: '', preview: '' },
    ],
  };
  const factory = {
    product: {
      hasImage: true,
      imageBase64: 'CURRENT_IMAGE',
      imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
      inputImages: [],
    },
    assets: [],
  };

  // When: the restore warning counter evaluates all analysis rows.
  const countRestoreRefs = compileCounter(state, factory);

  // Then: the one marker-only legacy row is satisfied by the current input.
  assert.equal(countRestoreRefs(), 0);
});

test('Given one legacy input marker without any restored current image When counting restore failures Then it remains missing', () => {
  // Given: neither the app state nor the factory has the referenced image.
  const state = {
    step: 'factory',
    imageBase64: '',
    imagePreview: '',
    analysisImages: [{ hasImageData: true, base64: '', preview: '' }],
  };
  const factory = {
    product: { hasImage: true, inputImages: [] },
    assets: [],
  };

  // When: the restore warning counter evaluates the incomplete session.
  const countRestoreRefs = compileCounter(state, factory);

  // Then: the unresolved legacy marker and product image are both reported.
  assert.equal(countRestoreRefs(), 2);
});

test('Given one legacy factory input marker and its restored product image When counting restore failures Then the marker is satisfied', () => {
  // Given: the factory input row is metadata-only, but the canonical product
  // image has already been hydrated from the workfile archive.
  const state = {
    step: 'factory',
    imageBase64: 'CURRENT_IMAGE',
    imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
    analysisImages: [],
  };
  const factory = {
    product: {
      hasImage: true,
      imageBase64: 'CURRENT_IMAGE',
      imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
      inputImages: [{ hasImage: true, base64: '', preview: '' }],
    },
    assets: [],
  };

  // When: the restore warning counter evaluates the hydrated factory.
  const countRestoreRefs = compileCounter(state, factory);

  // Then: the one legacy marker does not create a false failure.
  assert.equal(countRestoreRefs(), 0);
});

test('Given an input marker with a different explicit fingerprint When counting restore failures Then the mismatch remains visible', () => {
  // Given: the marker explicitly belongs to a different image.
  const state = {
    step: 'factory',
    imageBase64: 'CURRENT_IMAGE',
    imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
    analysisImages: [{
      hasImageData: true,
      base64: '',
      preview: '',
      inputImageFingerprint: 'different-image',
    }],
  };
  const factory = {
    product: {
      hasImage: true,
      imageBase64: 'CURRENT_IMAGE',
      imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
      inputImages: [],
    },
    assets: [],
  };

  // When: the restore warning counter evaluates the mismatch.
  const countRestoreRefs = compileCounter(state, factory);

  // Then: only the genuinely mismatched reference is reported.
  assert.equal(countRestoreRefs(), 1);
});

test('Given an archived generated asset marker When counting active restore failures Then retired output is ignored', () => {
  // Given: a previous candidate was archived before the current seven outputs
  // were restored, so its payload is intentionally absent.
  const state = {
    step: 'factory',
    imageBase64: 'CURRENT_IMAGE',
    imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
    analysisImages: [],
  };
  const factory = {
    product: {
      hasImage: true,
      imageBase64: 'CURRENT_IMAGE',
      imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
      inputImages: [],
    },
    assets: [{ id: 'retired-size-cut', hasImage: true, archived: true }],
  };

  // When: the restore warning counter evaluates active work.
  const countRestoreRefs = compileCounter(state, factory);

  // Then: intentionally retired output does not produce a restore failure.
  assert.equal(countRestoreRefs(), 0);
});

test('Given a generated asset with a durable local archive ID When counting restore failures Then it is not reported as missing', () => {
  const state = {
    step: 'factory',
    imageBase64: 'CURRENT_IMAGE',
    imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
    analysisImages: [],
  };
  const factory = {
    product: {
      hasImage: true,
      imageBase64: 'CURRENT_IMAGE',
      imagePreview: 'data:image/png;base64,CURRENT_IMAGE',
      inputImages: [],
    },
    assets: [{ id: 'restored-hero', hasImage: true, archiveId: 'archive-hero-1' }],
  };

  const countRestoreRefs = compileCounter(state, factory);

  assert.equal(countRestoreRefs(), 0);
});

test('Given archive-backed option results When counting restore failures Then only a result with no durable image source is missing', () => {
  const state = {
    step: 'optionsorter',
    optionSorter: {
      images: [],
      optionResults: [
        { id: 'result-1', hasImage: true, image: null, archiveId: 'archive-result-1', imageUrl: '/api/local-archive/assets/archive-result-1/image' },
        { id: 'result-2', hasImage: true, image: null, archiveId: 'archive-result-2', imageUrl: '/api/local-archive/assets/archive-result-2/image' },
        { id: 'result-3', hasImage: true, image: null, archiveId: 'archive-result-3', imageUrl: '/api/local-archive/assets/archive-result-3/image' },
        { id: 'result-4', hasImage: true, image: null, archiveId: 'archive-result-4', imageUrl: '/api/local-archive/assets/archive-result-4/image' },
        { id: 'result-missing', hasImage: true, image: null, archiveId: '', imageUrl: '' },
      ],
    },
  };

  const countRestoreRefs = compileCounter(state, { product: {}, assets: [] });

  assert.equal(countRestoreRefs(), 1);
});

test('Given missing edit sources but restored generated outputs When warning is shown Then the output recovery is stated explicitly', () => {
  const state = {
    currentProjectId: 'project-restored-output',
    step: 'factory',
    storageWarning: '',
    storageWarningDismissKey: '',
  };
  const factory = {
    assets: [{ id: 'archive-backed-hero', hasImage: true, archiveId: 'hero-archive-1' }],
  };

  const showRestoreWarning = compileWarningMessage(state, factory, 2);

  assert.equal(showRestoreWarning(), true);
  assert.match(state.storageWarning, /저장된 이미지 복원: 대표·생성 결과 1개를 로컬 보관함에서 정상 복원했습니다/);
  assert.doesNotMatch(state.storageWarning, /저장된 이미지 복원에 실패했습니다/);
});

test('Given a session record with no backup but a same-project backup reference When refresh hydration applies assets Then it hydrates that project backup before applying markers', async () => {
  const observed = { base64: '' };
  const hydratePersistentSessionAssets = compilePersistentSessionAssetHydrator({
    factory: { product: { hasImage: true } },
  }, observed);

  await hydratePersistentSessionAssets();

  assert.deepEqual(observed.projectLookup, { storeName: 'projects', projectId: 'current' });
  assert.equal(observed.base64, 'RESTORED_PROJECT_BACKUP');
});

test('Given a server last-work marker reference When refresh hydration applies it after the session Then it resolves the original before applying the server snapshot', async () => {
  const observed = { base64: '' };
  const hydrateServerLastWorkSnapshot = compileServerLastWorkHydrator(observed);

  await hydrateServerLastWorkSnapshot({ force: true, render: false });

  assert.equal(observed.base64, 'RESTORED_SERVER_BACKUP');
});

test('Given a draft tab with no last-product record but an active project backup reference When common final hydration runs Then it restores that project backup', async () => {
  const observed = { base64: '', workspaceScope: '', lookups: [] };
  const hydrateLastProductImageBackup = compileLastProductBackupHydrator(observed);

  const changed = await hydrateLastProductImageBackup({ restoreInline: true });

  assert.equal(changed, true);
  assert.deepEqual(observed.lookups, [
    { storeName: 'appSettings', id: 'lastProductImageBackup:draft:current' },
    { storeName: 'projects', id: 'current' },
    { storeName: 'appSettings', id: 'workspaceProductImageBackup:project:current' },
  ]);
  assert.equal(observed.base64, 'RESTORED_COMMON_BACKUP');
  assert.equal(observed.workspaceScope, 'draft:current');
});

test('Given a draft tab whose state project identity is blank but factory retains it When common final hydration runs Then it restores that project backup', async () => {
  const observed = { base64: '', workspaceScope: '', lookups: [] };
  const hydrateLastProductImageBackup = compileLastProductBackupHydrator(observed, {
    currentProjectId: '',
    factory: { workspace: { id: 'current' } },
  });

  const changed = await hydrateLastProductImageBackup({ restoreInline: true });

  assert.equal(changed, true);
  assert.deepEqual(observed.lookups, [
    { storeName: 'appSettings', id: 'lastProductImageBackup:draft:current' },
    { storeName: 'projects', id: 'current' },
    { storeName: 'appSettings', id: 'workspaceProductImageBackup:project:current' },
  ]);
  assert.equal(observed.base64, 'RESTORED_COMMON_BACKUP');
  assert.equal(observed.workspaceScope, 'draft:current');
});

test('Given a draft tab whose project ID is blank but saved project name is exact When common final hydration runs Then it restores only that saved project backup', async () => {
  const observed = { base64: '', workspaceScope: '', lookups: [] };
  const hydrateLastProductImageBackup = compileLastProductBackupHydrator(observed, {
    currentProjectId: '',
    currentProjectName: '찐0804모시꽃수파우치 복사본',
    projects: [{
      id: 'current',
      name: '찐0804모시꽃수파우치 복사본',
      payload: {
        productImageBackup: {
          id: 'workspaceProductImageBackup:project:current',
          storage: 'appSettings',
        },
      },
    }],
  });

  const changed = await hydrateLastProductImageBackup({ restoreInline: true });

  assert.equal(changed, true);
  assert.deepEqual(observed.lookups, [
    { storeName: 'appSettings', id: 'lastProductImageBackup:draft:current' },
    { storeName: 'projects', id: 'current' },
    { storeName: 'appSettings', id: 'workspaceProductImageBackup:project:current' },
  ]);
  assert.equal(observed.base64, 'RESTORED_COMMON_BACKUP');
  assert.equal(observed.workspaceScope, 'draft:current');
});
