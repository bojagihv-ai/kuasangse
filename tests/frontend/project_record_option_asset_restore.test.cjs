'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const CORE02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const identityContracts = import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'persistence', 'work-identity.mjs')).href);
const revisionContracts = import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'workspace-revision.mjs')).href);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `extractable source: ${startMarker}`);
  return source.slice(start, end);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

async function actualContracts() {
  return { identity: await identityContracts, revision: await revisionContracts };
}

function runtimeFor(projectId, fingerprint, source = CORE03, currentRevision = 582, activeScope = `project:${projectId}`, contracts = null, storage = {}) {
  const activeRevision = Number.isSafeInteger(currentRevision)
    ? { scopeId: activeScope, counter: currentRevision, updatedAt: 2000, writerId: 'active' }
    : null;
  let liveFactory = { workspace: { id: projectId }, product: { productName: '색동동전지갑' }, assets: [], logs: [] };
  const defaultFn = () => {};
  const state = {
    factory: clone(liveFactory),
    optionSorter: { images: [], optionResults: [] },
    compPage: {},
    cuts: { prompts: [], sizePrompts: [] },
    sectionGenerationModes: {}, sectionBasisModes: {}, sectionAssembly: {}, sectionImages: {}, sectionContents: {},
    sectionInstructionSources: {}, hiddenSectionIds: [], customSections: [], analysisImages: [], workIdentity: null,
  };
  const identity = snapshot => {
    const scope = String(snapshot?.workspaceScope?.id || `project:${snapshot?.factory?.workspace?.id || ''}`);
    const input = String(snapshot?.inputImageFingerprint || snapshot?.factory?.product?.lockedInputImageFingerprint || '');
    if (![`project:${projectId}`, activeScope].includes(scope)) return { ok: false, code: 'WORK_IDENTITY_SCOPE_CONFLICT' };
    if (input !== fingerprint) return { ok: false, code: 'WORK_IDENTITY_IMAGE_BINDING_CONFLICT' };
    return {
      ok: true,
      scopeId: `project:${projectId}`,
      identity: { instanceId: `work:${projectId}:1788921618700`, workspaceId: `project:${projectId}`,
        initialProductName: '색동동전지갑', initialProductKey: '색동동전지갑',
        initialInputImageFingerprint: fingerprint, createdAt: 1788921618700 },
      productKey: '색동동전지갑', inputImageFingerprint: fingerprint,
    };
  };
  const bridge = {};
  const globals = new Proxy({
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, structuredClone, setTimeout,
    state,
    IMAGE_STORED_MARKER: "__stored_in_indexeddb__",
    imageBase64Only: value => String(value || "").replace(/^data:[^;]+;base64,/, ""),
    displayableImageSrc: value => String(value || "") !== "__stored_in_indexeddb__" ? String(value || "") : "",
    lastProductImageBackupStorageId: () => "primary-backup",
    bridge,
    SECTIONS: [],
    WORKSPACE_DB: { appSettings: "appSettings", snapshots: "snapshots" },
    workspaceScopeTransitionState: { inProgress: false },
    workspaceIdentityFailureMessage: result => result.code,
    currentWorkspaceAuthority: () => ({ scopeId: activeScope, mode: "editing", fencingToken: "test-fence" }),
    ensureExplicitProjectLoadAuthority: async () => ({ branchScope: activeScope, authority: { scopeId: activeScope, mode: "editing", fencingToken: "test-fence" } }),
    factoryRuntimeRequireStore: () => ({ getSnapshot: () => clone(liveFactory),
      getOperationToken: () => ({ workspaceId: projectId, revision: 582 }), isOperationCurrent: () => true,
      switchWorkspace: (_id, options) => { liveFactory = clone(options.snapshot); } }),
    factoryBeginVisualValidationRenderBatch: () => ({ token: "test-visual" }),
    projectRestorePreservesCurrentWork: () => false,
    flushQueuedPersistentState: async () => storage.persistFails !== true,
    workspaceGet: async (_store, id) => clone(storage[id] || null),
    workspaceGetSessionAssets: async scope => clone(storage[scope] || null),
    cloneData: clone,
    workspaceBlankResetInProgress: true,
    workspacePersistenceApi: () => ({
      restore: async () => { if (storage.restoreFails) throw new Error("server unavailable"); return clone(storage.serverRestore || null); },
      validateSnapshotIdentity: contracts?.identity?.validateWorkspaceSnapshotIdentity || identity,
      normalizeWorkspaceScope: value => String(value || '').trim(),
      createWorkIdentity: contracts?.identity?.createWorkspaceWorkIdentity || (value => ({ ...value, initialProductKey: String(value.initialProductName || '').replace(/\s+/g, '') })),
      workIdentitiesMatch: contracts?.identity?.workspaceWorkIdentitiesMatch || ((left, right) => (
        left?.initialProductKey === right?.initialProductKey
          && left?.initialInputImageFingerprint === right?.initialInputImageFingerprint
      )),
    }),
    getCurrentLastWorkWorkspaceScope: () => activeScope,
    currentWorkspaceBranch: (scope, project) => (scope.startsWith('draft:') && contracts?.identity?.createWorkspaceWorkBranch
      ? contracts.identity.createWorkspaceWorkBranch({ branchId: scope.slice('draft:'.length), scopeId: scope,
        documentId: project, documentScopeId: `project:${project}`, createdAt: 1788921618700 })
      : null),
    currentWorkspaceRevision: () => clone(activeRevision),
    currentBranchDocumentMigrationBoundary: () => null,
    workspaceRevisionApi: () => ({
      current: () => clone(activeRevision),
      compare: contracts?.revision?.compareWorkspaceRevisions || ((revision, current) => {
        const counter = Number(revision?.counter);
        if (!String(revision?.scopeId || '') || !Number.isSafeInteger(counter) || counter < 1) return -1;
        if (!current) return 1;
        if (String(revision.scopeId) !== String(current.scopeId)) return null;
        return Math.sign(counter - Number(current.counter || 0));
      }),
      shouldApply: (revision, scope, options) => contracts?.revision?.shouldApplyWorkspaceSnapshot
        ? contracts.revision.shouldApplyWorkspaceSnapshot({ candidate: revision, current: activeRevision, scopeId: scope, allowEqual: options?.allowEqual === true })
        : (!activeRevision || Number(revision?.counter || 0) >= activeRevision.counter),
    }),
    lastWorkSnapshotWorkspaceScope: snapshot => String(snapshot?.workspaceScope?.id || `project:${snapshot?.factory?.workspace?.id || ''}`),
    workspaceSnapshotRevision: snapshot => snapshot?.workspaceRevision || null,
    normalizeFactoryState: clone,
    factoryRuntimeReadFactory: () => clone(liveFactory),
    factoryRuntimeReplaceFactorySnapshot: factory => { liveFactory = clone(factory); },
    factoryRuntimeDetachedValue: clone,
    factoryPreserveProgressForSameWork: (incoming, current) => ({ ...clone(current), ...clone(incoming),
      product: { ...clone(current.product), ...clone(incoming.product) },
      assets: clone(incoming.assets), logs: clone(incoming.logs) }),
    factoryNormalizeIdentityText: value => String(value || "").replace(/\s+/g, "").toLowerCase(),
    factoryHasMeaningfulWork: factory => !!(factory?.product?.productName || factory?.assets?.length),
    factorySinhwaCandidateKey: candidate => candidate?.jcode || candidate?.id || "",
    factoryCafe24CandidateKey: candidate => candidate?.product_no || candidate?.id || "",
    factoryWorkspaceIdentityFromSource: factory => ({ id: String(factory?.workspace?.id || '') }),
    factoryStampWorkspaceIdentity: factory => { factory.workspace = { ...(factory.workspace || {}), id: projectId }; },
    factoryMigrateReviewCandidateWorkspaceScope: () => {},
    factoryRecoverRestoredReviewCandidateWorkspaceScope: () => 0,
    resolveRestoredCandidateReviewWorkspaceId: value => value,
    ensureActiveWorkIdentity: () => null,
    workspaceValidatedImageStatePayload: () => ({ payload: null, images: [], blocked: false }),
    normalizeAnalysisMatchSettings: value => value || {}, normalizeProductInfoFieldSettings: value => value || {},
    normalizeSectionGenerationModes: value => value || {}, normalizeSectionBasisModes: value => value || {},
    normalizeSectionAssembly: value => value || {}, normalizeCustomSections: value => value || [],
    mergeFixedDetailImages: (...values) => Object.assign({}, ...values.filter(Boolean)), loadFixedDetailImages: () => ({}),
    normalizeModelConfig: value => value || {}, getInitialBrandPresetDraft: () => ({}),
    LAYOUT_TEMPLATES: [], applyCompAnalysisSnapshot: () => {},
    lastWorkPayloadProductName: assets => assets?.productName || '',
    restoreLastWorkProjectIdentityFromAssets: () => {},
    lastWorkFactoryHasSelfConsistentCurrentAssets: () => false,
    stripRuntimeAssetsForApply: clone, sanitizeLastWorkPayloadProductScope: value => value,
    factoryIdentityKey: factory => String(factory?.product?.productName || ''),
    factoryProductHasImage: () => false, factorySetCurrentProductIdentity: () => {},
    restoreSectionContentsFromStoredVariants: () => false, mergeRuntimeSectionImages: (_current, incoming) => clone(incoming || {}),
    stripRuntimeAnalysisImages: clone, stripRuntimeDetailBlockImages: clone, stripRuntimeVariantImages: clone,
    mergeFactoryStoredImages: value => value,
    repairRestoredDraftFactoryAssetWorkspaceScope: () => false, restoreSpecificationSizeImageFromFactory: () => false,
    repairRestoredSessionIdentityDrift: () => false, syncProductImageAcrossWorkspaces: () => false,
    restoreOptionSorterLabelsFromFactory: value => value, observeWorkspaceRevisionSnapshot: () => null,
    defaultOptionSorterState: () => ({ slots: [], pool: [], images: [], optionResults: [] }),
    normalizeOptionSorterState: clone,
    uid: prefix => `${prefix}-id`, optionSorterSlotNameIsGeneric: () => false,
    hasInlineImagePayload: () => false, stripCutsRuntimeFlags: clone, stripCutsImages: clone,
    loadCutPromptsUpdatedAt: () => 0, loadBestCutPromptState: () => ({ prompts: [], updatedAt: 0 }),
    chooseBestCutPromptState: () => ({ prompts: [], updatedAt: 0 }), restoreCutsSourceFromCurrentProductImage: () => false,
    getCurrentCompAnalysisTime: () => 0, sanitizeCompMarketScrapeForPersistence: clone,
    mergeCompMarketStoredState: (_current, incoming) => clone(incoming || {}),
  }, {
    has: () => true,
    get(target, property) {
      if (property in target) return target[property];
      if (property === Symbol.unscopables) return undefined;
      return defaultFn;
    },
  });
  const context = vm.createContext(globals);
  const sources = [
    sourceBetween(source, "function factoryMergeIdentityScope(", "\nfunction factoryHasMeaningfulWork("),
    sourceBetween(CORE02, "function productImageBackupItem(", "\nfunction compactProductImageBackupItem("),
    sourceBetween(CORE02, "function currentProductImageBackupPayload(", "\nfunction productImageBackupFingerprint("),
    sourceBetween(CORE02, "function productImageBackupConflictsWithCurrentWork(", "\nasync function saveLastProductImageBackupToDbIfChanged("),
    sourceBetween(CORE02, "function hasRestoredImagePayloadValue(", "\nfunction wasStorageWarningDismissed("),
    sourceBetween(source, "function factoryImagePayloadFingerprint(", "\nfunction factoryImageFingerprintLooksUsable("),
    sourceBetween(source, "async function hydrateWorkspacePayloadImageBackup(", "\nfunction workspaceProductImageBackupFromPayload("),
    sourceBetween(source, "async function loadSnapshotRecord(", "\nfunction factoryProjectFileSummary("),
    sourceBetween(CORE02, 'function validateIncomingWorkspaceBoundary(', '\nconst FACTORY_LAST_SNAPSHOT_RECOVERY_KEY'),
    sourceBetween(CORE02, 'function lastWorkSnapshotMatchesCurrentWorkspace(', '\nfunction lastWorkSnapshotMatchesWorkspaceScope('),
    sourceBetween(CORE02, 'function workspaceRevisionAllowsSnapshot(', '\nfunction observeWorkspaceRevisionSnapshot('),
    sourceBetween(CORE02, 'function mergeOptionSorterStoredImages(', '\nfunction mergeSameWorkDerivedValue('),
    sourceBetween(CORE02, 'function applySessionAssetsPayload(', '\nfunction repairRestoredSessionIdentityDrift('),
    sourceBetween(source, 'function preserveSameWorkWorkspacePayload(', '\nfunction persistAppliedWorkspacePayloadSideEffects('),
    sourceBetween(source, 'function attachWorkspaceWorkIdentity(', '\nfunction rebindWorkspaceSnapshotForExplicitProjectLoad('),
    sourceBetween(source, 'function rebindWorkspaceSnapshotForExplicitProjectLoad(', '\nfunction projectWorkspaceSnapshotForDocument('),
    sourceBetween(source, 'function resolveIncomingWorkspaceWorkIdentity(', '\nfunction buildWorkspacePayload('),
    ...(source.includes('function shouldRestoreValidatedProjectRecordAssets(')
      ? [sourceBetween(source, 'function shouldRestoreValidatedProjectRecordAssets(', '\nfunction applyWorkspacePayload(')]
      : []),
    sourceBetween(source, 'function applyWorkspacePayload(', '\nasync function refreshWorkspaceLists('),
  ];
  vm.runInContext(`${sources.join('\n')}\nbridge.apply = applyWorkspacePayload; bridge.applyAssets = applySessionAssetsPayload; bridge.hydrate = hydrateWorkspacePayloadImageBackup; bridge.loadSnapshot = loadSnapshotRecord; bridge.backup = currentProductImageBackupPayload; bridge.missingRefs = countSessionAssetRestoreRefs;`, context);
  return {
    state,
    backup: bridge.backup,
    missingRefs: bridge.missingRefs,
    loadSnapshot: bridge.loadSnapshot,
    hydrate: bridge.hydrate,
    apply: bridge.apply,
    applyAssets: bridge.applyAssets,
    factory: () => clone(liveFactory),
    seedFactory: factory => { liveFactory = clone(factory); },
  };
}

function projectRecord(projectId, fingerprint) {
  const logs = Array.from({ length: 107 }, (_, index) => ({ id: `log-${index}`, time: index, message: `log ${index}` }));
  const workspaceRevision = { scopeId: `project:${projectId}`, counter: 579, updatedAt: 1789354107907, writerId: 'cdf29b69-efa2-4a98-b3a4-54bae534c1fd' };
  const workIdentity = { schema: 'kuasangse.work-identity.v1', instanceId: `work:${projectId}:1788921618700`, workspaceId: `project:${projectId}`,
    initialProductName: '색동동전지갑', initialProductKey: '색동동전지갑',
    initialInputImageFingerprint: fingerprint, createdAt: 1788921618700 };
  return {
    name: '색동동전지갑', productName: '색동동전지갑', step: 'factory',
    workspaceRevision, workIdentity,
    factory: { workspace: { id: projectId }, product: { productName: '색동동전지갑', lockedInputImageFingerprint: fingerprint },
      assets: Array.from({ length: 20 }, (_, index) => ({ id: `asset-${index}` })), logs },
    optionSorter: { images: [], optionResults: [] },
    assetPayload: {
      workspaceScope: { id: `project:${projectId}` }, inputImageFingerprint: fingerprint,
      workspaceRevision: clone(workspaceRevision), workIdentity: clone(workIdentity),
      productName: '색동동전지갑', factory: { workspace: { id: projectId },
        product: { productName: '색동동전지갑', lockedInputImageFingerprint: fingerprint },
        assets: Array.from({ length: 20 }, (_, index) => ({ id: `asset-${index}` })), logs },
      optionSorter: {
        images: [{ id: 'color-1', base64: 'Ynl0ZXMtMQ==' }, { id: 'color-2', base64: 'Ynl0ZXMtMg==' }],
        slots: [{ id: 'slot-1', name: '색동1', imgIds: ['color-1'] }, { id: 'slot-2', name: '색동2', imgIds: ['color-2'] }],
        optionResults: Array.from({ length: 3 }, (_, resultIndex) => ({ id: `result-${resultIndex}`,
          splitImages: [{ image: `bytes-${resultIndex}-a` }, { image: `bytes-${resultIndex}-b` }] })),
      },
    },
  };
}

test('actual workspace-to-session restore recovers two sources, three results, six split bytes, A assets, and log order', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const fingerprint = 'sha256:current-input';
  const input = projectRecord(projectId, fingerprint);
  const before = clone(input);
  const runtime = runtimeFor(projectId, fingerprint, CORE03, 582, `project:${projectId}`, await actualContracts());

  runtime.apply(input, { projectId, replaceWorkspace: true, validatedProjectRecordRestore: true });

  assert.deepEqual(input, before, 'workspace payload input remains immutable');
  assert.equal(runtime.state.optionSorter.images.length, 2, JSON.stringify({ optionSorter: runtime.state.optionSorter, warning: runtime.state.storageWarning }));
  assert.equal(runtime.state.optionSorter.optionResults.length, 3);
  assert.equal(runtime.state.optionSorter.optionResults.flatMap(row => row.splitImages).length, 6);
  assert.deepEqual(runtime.state.optionSorter.images.map(row => row.base64), ['Ynl0ZXMtMQ==', 'Ynl0ZXMtMg==']);
  assert.deepEqual(runtime.state.optionSorter.optionResults.flatMap(row => row.splitImages.map(image => image.image)), [
    'bytes-0-a', 'bytes-0-b', 'bytes-1-a', 'bytes-1-b', 'bytes-2-a', 'bytes-2-b',
  ]);
  assert.equal(runtime.factory().assets.length, 20);
  assert.deepEqual(runtime.factory().logs, before.factory.logs);
});

test('actual resolver/rebind keeps the original record proof through an active draft branch without a revision', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const fingerprint = 'sha256:current-input';
  const runtime = runtimeFor(projectId, fingerprint, CORE03, null, 'draft:lastwork_mu0n9184_y3oryf', await actualContracts());

  runtime.apply(projectRecord(projectId, fingerprint), {
    projectId,
    replaceWorkspace: true,
    validatedProjectRecordRestore: true,
  });

  assert.equal(runtime.state.optionSorter.images.length, 2);
  assert.equal(runtime.state.optionSorter.optionResults.length, 3);
  assert.equal(runtime.state.optionSorter.optionResults.flatMap(row => row.splitImages).length, 6);
});

test('ordinary non-explicit restore remains under the existing blank-reset boundary', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const fingerprint = 'sha256:current-input';
  const runtime = runtimeFor(projectId, fingerprint, CORE03, 582, `project:${projectId}`, await actualContracts());
  runtime.apply(projectRecord(projectId, fingerprint), { projectId, replaceWorkspace: true });
  assert.equal(runtime.state.optionSorter.images.length, 0);
  assert.equal(runtime.state.optionSorter.optionResults.length, 0);
});

test('invalid explicit record proof throws before state, A assets, or ordered logs are replaced', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const fingerprint = 'sha256:current-input';
  for (const { label, mutate } of [
    { label: 'foreign-scope', mutate: payload => { payload.assetPayload.workspaceScope.id = 'project:foreign-job'; } },
    { label: 'foreign-fingerprint', mutate: payload => { payload.assetPayload.inputImageFingerprint = 'sha256:foreign-input'; } },
    { label: 'revision-counter', mutate: payload => { payload.assetPayload.workspaceRevision.counter = 578; } },
    { label: 'zero-counter', mutate: payload => { payload.assetPayload.workspaceRevision.counter = 0; payload.workspaceRevision.counter = 0; } },
    { label: 'invalid-counter', mutate: payload => { payload.assetPayload.workspaceRevision.counter = 'bad'; payload.workspaceRevision.counter = 'bad'; } },
    { label: 'timestamp', mutate: payload => { payload.assetPayload.workspaceRevision.updatedAt -= 1; } },
    { label: 'writer', mutate: payload => { payload.assetPayload.workspaceRevision.writerId = 'different-writer'; } },
    { label: 'identity', mutate: payload => { payload.assetPayload.workIdentity.instanceId = 'work:foreign:1'; } },
    { label: 'newer-foreign-product', mutate: payload => {
      payload.assetPayload.workspaceRevision.counter = 583;
      payload.assetPayload.factory.product.productName = 'foreign-product';
      payload.assetPayload.workIdentity.initialProductKey = 'foreign-product';
    } },
  ]) {
    const input = projectRecord(projectId, fingerprint);
    mutate(input);
    const runtime = runtimeFor(projectId, fingerprint, CORE03, 582, `project:${projectId}`, await actualContracts());
    const beforeOptions = { images: [{ id: 'A-source', base64: 'A-bytes' }], optionResults: [{ id: 'A-result' }] };
    const beforeFactory = { workspace: { id: projectId }, product: { productName: '색동동전지갑' },
      assets: Array.from({ length: 20 }, (_, index) => ({ id: `A-${index}` })),
      logs: Array.from({ length: 107 }, (_, index) => ({ id: `A-log-${index}` })) };
    runtime.state.optionSorter = clone(beforeOptions);
    runtime.seedFactory(beforeFactory);
    assert.throws(() => runtime.apply(input, {
      projectId,
      replaceWorkspace: true,
      validatedProjectRecordRestore: true,
    }));
    assert.deepEqual(runtime.state.optionSorter, beforeOptions, label);
    assert.deepEqual(runtime.factory(), beforeFactory, label);
  }
});

test('preserve fallback cannot supply missing original record proof', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const fingerprint = 'sha256:current-input';
  const input = projectRecord(projectId, fingerprint);
  delete input.assetPayload.workspaceRevision;
  delete input.assetPayload.workIdentity;
  const runtime = runtimeFor(projectId, fingerprint, CORE03, 582, `project:${projectId}`, await actualContracts());
  assert.throws(() => runtime.apply(input, {
    projectId,
    replaceWorkspace: true,
    preserveCurrentWork: true,
    preserveFallback: projectRecord(projectId, fingerprint),
    validatedProjectRecordRestore: true,
  }), /검증되지 않은 작업 저장본 자산/);
});

module.exports = { actualContracts, projectRecord, runtimeFor };

function referencedProject() {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const payload = projectRecord(projectId, 'sha256:current-input');
  payload.assetPayload.optionSorter.optionResults.forEach(result => result.splitImages.forEach((split, index) => {
    Object.assign(split, { sourceId: 'color-' + (index + 1), optionName: '색동 ' + (index + 1),
      order: index + 1, sourceOrder: index + 1, fileName: (index + 1) + '.png', hasImage: true });
  }));
  const stored = clone(payload.assetPayload);
  stored.workspaceRevision.counter = 582;
  stored.workspaceRevision.updatedAt += 100;
  stored.scopeId = 'project:' + projectId;
  payload.assetPayload.optionSorter.images.forEach(row => { row.base64 = null; });
  payload.assetPayload.optionSorter.optionResults.forEach(row => row.splitImages.forEach(split => { split.image = null; }));
  payload.imagePersistence = { mode: 'appSettings-reference' };
  payload.assetPayload.imagePersistence = { mode: 'lightweight' };
  return { projectId, payload, stored };
}

test('reference hydration reads document session assets before the actual draft restore without mutating either input', async () => {
  const { projectId, payload, stored } = referencedProject();
  const before = clone({ payload, stored });
  const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:restore', await actualContracts(), {
    ['project:' + projectId]: stored,
  });
  const hydrated = await runtime.hydrate(payload);
  assert.deepEqual(hydrated.assetPayload.optionSorter.images.map(row => row.base64), stored.optionSorter.images.map(row => row.base64));
  assert.deepEqual(hydrated.assetPayload.optionSorter.optionResults.flatMap(row => row.splitImages.map(split => split.image)),
    stored.optionSorter.optionResults.flatMap(row => row.splitImages.map(split => split.image)));
  assert.deepEqual(hydrated.factory, payload.factory);
  assert.deepEqual(hydrated.workspaceRevision, payload.workspaceRevision);
  runtime.apply(hydrated, { projectId, replaceWorkspace: true, validatedProjectRecordRestore: true });
  assert.equal(runtime.state.optionSorter.images.length, 2);
  assert.equal(runtime.state.optionSorter.optionResults.flatMap(row => row.splitImages).filter(split => split.image).length, 6);
  assert.deepEqual({ payload, stored }, before);
});

test('reference hydration isolates foreign identity, scope, revision, missing records and image IDs', async () => {
  for (const mutate of [
    value => { value.workIdentity.instanceId = 'other-instance'; },
    value => { value.workIdentity.initialProductKey = 'other-product'; },
    value => { value.inputImageFingerprint = 'other-input'; },
    value => { value.workspaceScope.id = 'project:other'; },
    value => { value.scopeId = 'project:other'; },
    value => { value.workspaceRevision.scopeId = 'project:other'; },
    value => { value.workspaceRevision.counter = 1; },
    value => { value.workspaceRevision = null; },
  ]) {
    const { projectId, payload, stored } = referencedProject(); mutate(stored);
    const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:restore', await actualContracts(), { ['project:' + projectId]: stored });
    assert.deepEqual(await runtime.hydrate(payload), payload);
  }
  const { projectId, payload, stored } = referencedProject();
  const noRecord = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:restore', await actualContracts());
  assert.deepEqual(await noRecord.hydrate(payload), payload);
  stored.optionSorter.images.forEach(row => { row.id = 'foreign-' + row.id; });
  stored.optionSorter.optionResults.forEach(row => { row.id = 'foreign-' + row.id; });
  const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:restore', await actualContracts(), { ['project:' + projectId]: stored });
  const hydrated = await runtime.hydrate(payload);
  assert.equal(hydrated.assetPayload.optionSorter.images.filter(row => row.base64).length, 0);
  assert.equal(hydrated.assetPayload.optionSorter.optionResults.flatMap(row => row.splitImages).filter(split => split.image).length, 0);
});

test('reference hydration matches split identity across reordered rows and refuses ambiguous or renamed references', async () => {
  const { projectId, payload, stored } = referencedProject();
  stored.optionSorter.optionResults[0].splitImages.reverse();
  stored.optionSorter.optionResults[1].splitImages[0].optionName = '다른 색상';
  stored.optionSorter.optionResults[2].splitImages.push(clone(stored.optionSorter.optionResults[2].splitImages[0]));
  stored.optionSorter.optionResults.push({ id: 'not-in-snapshot', splitImages: [{ image: 'foreign' }] });
  payload.assetPayload.optionSorter.optionResults[0].splitImages[1].image = 'current-inline';
  const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:restore', await actualContracts(), { ['project:' + projectId]: stored });
  const before = clone({ payload, stored });
  const hydrated = await runtime.hydrate(payload);
  assert.deepEqual(hydrated.assetPayload.optionSorter.optionResults.map(row => row.splitImages.map(split => split.image)), [
    ['bytes-0-a', 'current-inline'], [null, 'bytes-1-b'], [null, 'bytes-2-b'],
  ]);
  assert.deepEqual({ payload, stored }, before);
});

test('reference hydration rejects duplicate source/result IDs and preserves inline and product backup paths', async () => {
  const { projectId, payload, stored } = referencedProject();
  payload.assetPayload.optionSorter.images.push(clone(payload.assetPayload.optionSorter.images[0]));
  stored.optionSorter.optionResults.push(clone(stored.optionSorter.optionResults[0]));
  payload.productImageBackup = { id: 'product-backup', storage: 'appSettings' };
  const backup = { id: 'product-backup', primary: { base64: 'original-product' } };
  const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:restore', await actualContracts(), {
    ['project:' + projectId]: stored, 'product-backup': backup,
  });
  const result = await runtime.hydrate(payload);
  assert.deepEqual(result.productImageBackup, backup);
  assert.equal(result.assetPayload.optionSorter.images.filter(row => row.id === 'color-1').some(row => row.base64), false);
  assert.equal(result.assetPayload.optionSorter.optionResults[0].splitImages.some(row => row.image), false);
  assert.deepEqual(await runtime.hydrate({ productImageBackup: backup }), { productImageBackup: backup });
});

test('actual saved-version loader restores referenced bytes and rolls back A if its durable save fails', async () => {
  for (const failure of ['', 'persist', 'identity']) {
    const { projectId, payload, stored } = referencedProject();
    if (failure === 'identity') payload.assetPayload.workIdentity.instanceId = 'foreign-instance';
    const record = { id: 'saved-version', projectId, projectName: payload.productName, payload };
    const storage = { ['project:' + projectId]: stored, 'saved-version': record, persistFails: failure === 'persist' };
    const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:snapshot-restore', await actualContracts(), storage);
    runtime.state.optionSorter = { images: [{ id: 'A-source', base64: 'A-bytes' }], optionResults: [] };
    runtime.seedFactory(payload.factory);
    const before = clone({ options: runtime.state.optionSorter, factory: runtime.factory(), storage });
    const result = await runtime.loadSnapshot('saved-version');
    if (failure) {
      assert.equal(result, null);
      assert.deepEqual(runtime.state.optionSorter, before.options);
      assert.deepEqual(runtime.factory(), before.factory);
      assert.match(runtime.state.error, failure === 'persist' ? /브랜치를 저장하지 못했습니다/ : /WORK_IDENTITY/);
    } else {
      assert.equal(result.id, 'saved-version', runtime.state.error);
      assert.equal(runtime.state.optionSorter.optionResults.flatMap(row => row.splitImages).filter(row => row.image).length, 6);
      assert.deepEqual(runtime.state.optionSorter.images.map(row => row.base64), ['Ynl0ZXMtMQ==', 'Ynl0ZXMtMg==']);
    }
    assert.equal(runtime.state.projectBusy, false);
    assert.deepEqual(storage, before.storage);
  }
});


test('hydrated primary backup survives nested storage reference, save read-back, and foreign image rejection', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const bytes = Buffer.from('same locked product image '.repeat(20)).toString('base64');
  const fingerprint = `${bytes.length}:${bytes.slice(0, 72)}:${bytes.slice(-72)}`;
  const contracts = await actualContracts();
  for (const foreign of [false, true]) {
    const input = projectRecord(projectId, fingerprint);
    const reference = { id: 'primary-backup', storage: 'appSettings', primary: { source: 'factory', hasImage: true } };
    input.productImageBackup = clone(reference);
    input.assetPayload.productImageBackup = clone(reference);
    for (const factory of [input.factory, input.assetPayload.factory]) {
      factory.product.hasImage = true;
      factory.product.inputImages = [{ id: 'original-input', inputImageFingerprint: fingerprint, hasImage: true }];
    }
    const backup = { primary: { source: 'factory', base64: foreign ? 'foreign-image' : bytes, mime: 'image/png', name: 'original.png' } };
    const storage = { 'primary-backup': backup };
    const before = clone({ input, storage });
    const runtime = runtimeFor(projectId, fingerprint, CORE03, 582, `project:${projectId}`, contracts, storage);
    const hydrated = await runtime.hydrate(input);
    runtime.apply(hydrated, { projectId, replaceWorkspace: true, validatedProjectRecordRestore: true });
    assert.deepEqual({ input, storage }, before, 'storage and input remain immutable');
    if (foreign) {
      assert.equal(runtime.state.imageBase64, null, 'force must not override locked fingerprint');
      assert.equal(runtime.factory().product.inputImages[0].base64, undefined);
      assert.equal(runtime.backup(), null);
      assert.ok(runtime.missingRefs() > 0);
    } else {
      assert.equal(runtime.state.imageBase64, bytes);
      assert.equal(runtime.factory().product.imageBase64, bytes);
      assert.equal(runtime.state.analysisImages[0].base64, bytes);
      assert.equal(runtime.factory().product.inputImages[0].id, 'original-input');
      assert.equal(runtime.backup().primary.base64, bytes, 'next save retains canonical primary backup');
      assert.equal(runtime.backup().factory?.base64, bytes, 'backup retains canonical factory source when legacy state shell is stale');
      assert.equal(runtime.backup().primary.source, 'factory', 'factory remains the original primary provenance');
      assert.equal(runtime.missingRefs(), 0);
    }
    assert.equal(runtime.factory().assets.length, 20);
    assert.deepEqual(runtime.factory().logs, input.factory.logs);
  }
});


test('fresh record and saved-version hydration preserves newer durable same-work logs without changing selections', async () => {
  const projectId = 'batch:factory-job-b8996417eb8543139f295f73e8c9d723';
  const input = projectRecord(projectId, 'sha256:current-input');
  input.factory.automation = input.assetPayload.factory.automation = { currentRunId: 'same-run' };
  const priorSave = { time: '11:48:45', message: 'saved', type: 'ok', details: { a: 1, b: 2 } };
  const server = clone(input.assetPayload);
  server.workspaceRevision.counter = 582;
  server.factory.logs = [priorSave, ...server.factory.logs, priorSave];
  server.factory.product.selectedDbCandidateKey = 'must-not-import';
  const storage = { serverRestore: { source: 'server', snapshot: { assets: server }, revision: server.workspaceRevision } };
  const before = clone({ input, storage });
  const runtime = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:fresh', await actualContracts(), storage);
  const hydrated = await runtime.hydrate(input);
  assert.deepEqual(hydrated.factory.logs, server.factory.logs);
  assert.deepEqual(hydrated.assetPayload.factory.logs, server.factory.logs);
  assert.equal(hydrated.factory.product.selectedDbCandidateKey, undefined);
  assert.deepEqual({ input, storage }, before);
  const serverContract = clone(storage);
  delete serverContract.serverRestore.snapshot.assets.workspaceRevision;
  const actualEnvelope = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:fresh', await actualContracts(), serverContract);
  assert.deepEqual((await actualEnvelope.hydrate(input)).factory.logs, server.factory.logs, 'server authority returns revision beside snapshot');
  const repeated = await runtime.hydrate(hydrated);
  assert.deepEqual(repeated.factory.logs, server.factory.logs, 'multiplicity and order stay stable');

  const versionStorage = { ...clone(storage), 'saved-version': { id: 'saved-version', projectId, payload: clone(input) } };
  const version = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:fresh', await actualContracts(), versionStorage);
  await version.loadSnapshot('saved-version');
  assert.deepEqual(version.factory().logs, server.factory.logs, 'actual saved-version loader retains durable history');
  const failedStorage = { ...versionStorage, restoreFails: true };
  const failedVersion = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:fresh', await actualContracts(), failedStorage);
  failedVersion.seedFactory({ ...clone(input.factory), logs: [{ message: 'live A' }] });
  const liveBefore = failedVersion.factory();
  await failedVersion.loadSnapshot('saved-version');
  assert.deepEqual(failedVersion.factory(), liveBefore, 'failed server read cannot replace live A');
  assert.match(failedVersion.state.error, /server unavailable/);
  const topOnly = clone(input);
  topOnly.factory.logs = [{ time: 'unique', message: 'top-level saved log' }, ...topOnly.factory.logs];
  const combined = await runtime.hydrate(topOnly);
  assert.deepEqual(combined.factory.logs, [...server.factory.logs, topOnly.factory.logs[0]], 'top-level-only history is also preserved');

  for (const change of [
    s => { s.factory.workspace.id = 'different-work'; },
    s => { s.factory.automation.currentRunId = 'different-run'; },
    s => { s.factory.product.productName = 'different-product'; },
    s => { s.factory.product.lockedInputImageFingerprint = 'different-image'; },
    s => { s.workIdentity.instanceId = 'different-instance'; },
    s => { s.workspaceRevision.counter = 578; },
    s => { s.workspaceScope.id = 'project:different'; },
  ]) {
    const foreign = clone(storage);
    change(foreign.serverRestore.snapshot.assets);
    const isolated = runtimeFor(projectId, 'sha256:current-input', CORE03, null, 'draft:fresh', await actualContracts(), foreign);
    assert.deepEqual((await isolated.hydrate(input)).factory.logs, input.factory.logs);
  }
});
