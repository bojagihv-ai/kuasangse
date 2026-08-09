const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function sourceBetween(source, startMarkers, endMarker) {
  const start = startMarkers.map(marker => source.indexOf(marker)).find(index => index >= 0) ?? -1;
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable before ${endMarker}`);
  return source.slice(start, end);
}

test('startup hydration switches authority once and continues only in the restored workspace scope', async () => {
  const core06 = read('src/app-core-06.js');
  const hydrationSource = sourceBetween(
    core06,
    ['async function runClassicRuntimeHydration'],
    'function hydrateClassicRuntime',
  );
  const deferredHydrationSource = sourceBetween(
    core06,
    ['async function continueClassicRuntimeHydrationInBackground'],
    'async function runClassicRuntimeHydration',
  );
  const context = vm.createContext({ setTimeout });
  vm.runInContext(`
    const state = { currentProjectId: 'old-project', factory: {} };
    let currentScope = 'project:old-project';
    const authorityCalls = [];
    const hydratedScopes = [];
    const installClassicRuntimeLifecycle = () => {};
    const hasGeminiConnection = () => false;
    const getCurrentLastWorkWorkspaceScope = () => currentScope;
    const ensureWorkspaceEditAuthority = async scope => { authorityCalls.push(scope); return { mode: 'editing', scopeId: scope }; };
    const markSessionAssetFingerprintSaved = () => {};
    const finishClassicDeferredHydrationWithoutServerRestore = () => {};
    const loadCutsArchiveFolderStatus = async () => {};
    const refreshWorkspaceLists = async () => {};
    const hydratePersistentSessionAssets = async () => {
      state.currentProjectId = '';
      currentScope = 'draft:new-work';
    };
    const hydrateServerLastWorkSnapshot = async () => { hydratedScopes.push(currentScope); };
    const factoryRestoreCurrentWorkfileLocalArchive = null;
    const hydrateLastProductImageBackup = null;
    const factoryRuntimeReadFactory = () => ({ product: {} });
    const disposeClassicRuntimeLifecycle = () => {};
    ${deferredHydrationSource}
    ${hydrationSource}
    globalThis.runHydration = () => runClassicRuntimeHydration({ schema: 'classic', version: 1 });
    globalThis.readAuthorityCalls = () => JSON.stringify(authorityCalls);
    globalThis.readHydratedScopes = () => JSON.stringify(hydratedScopes);
  `, context);

  const result = await context.runHydration();
  assert.deepEqual({ ...result }, { schema: 'classic', version: 1, hydrated: true, stale: false });
  assert.deepEqual(JSON.parse(context.readAuthorityCalls()), ['project:old-project', 'draft:new-work']);
  assert.deepEqual(JSON.parse(context.readHydratedScopes()), ['draft:new-work']);
});
test('current last-work scope keeps the tab-local draft despite stale factory mirrors', () => {
  const core02 = read('src/app-core-02.js');
  const selectorSource = sourceBetween(
    core02,
    ['function getCurrentLastWorkWorkspaceScope'],
    'function rotateLastWorkDraftScope',
  );
  const context = vm.createContext({});
  vm.runInContext(`
    const state = { currentProjectId: '', factory: { workspace: { id: 'stale-project' } } };
    let canonicalFactory = { workspace: { id: 'canonical-project' } };
    const factoryRuntimeReadFactory = () => canonicalFactory;
    const getStoredLastWorkDraftScope = () => 'draft:new-work';
    const workspacePersistenceApi = () => ({
      normalizeProjectScope: id => 'project:' + id,
      normalizeWorkspaceScope: id => id,
    });
    ${selectorSource}
    globalThis.readScope = () => getCurrentLastWorkWorkspaceScope();
    globalThis.useOtherFactory = () => { canonicalFactory = { workspace: { id: 'other-project' } }; };
  `, context);

  assert.equal(context.readScope(), 'draft:new-work');
  vm.runInContext('useOtherFactory()', context);
  assert.equal(context.readScope(), 'draft:new-work');
});

test('F5 restore repairs a blank classic project mirror from the matching canonical workfile identity', () => {
  const core02 = read('src/app-core-02.js');
  assert.match(
    core02,
    /function restoreLastWorkProjectIdentityFromAssets\(/,
    'F5 restore has no boundary that repairs blank state.currentProjectId from the trusted factory workspace',
  );
  const helperSource = sourceBetween(
    core02,
    ['function restoreLastWorkProjectIdentityFromAssets'],
    'function rotateLastWorkDraftScope',
  );
  const applySource = sourceBetween(
    core02,
    ['function applySessionAssetsPayload'],
    'function repairRestoredSessionIdentityDrift',
  );
  assert.match(
    applySource,
    /restoreLastWorkProjectIdentityFromAssets\(assets\)/,
    'session asset hydration does not adopt the matching canonical workfile identity before restoring assets',
  );

  const context = vm.createContext({});
  vm.runInContext(`
    const state = {
      currentProjectId: '',
      currentProjectName: '',
      currentProjectCreatedAt: null,
    };
    const canonicalFactory = {
      workspace: {
        id: 'project_alpha',
        name: '모시바둑파우치',
        createdAt: 1710000000000,
      },
    };
    const factoryRuntimeReadFactory = () => canonicalFactory;
    const workspacePersistenceApi = () => ({
      normalizeProjectScope: id => 'project:' + id,
      normalizeWorkspaceScope: id => id,
    });
    const getStoredLastWorkDraftScope = () => 'draft:new-work';
    const lastWorkSnapshotWorkspaceScope = snapshot =>
      String(snapshot?.workspaceScope?.id || snapshot?.workspaceId || '');
    const getCurrentLastWorkWorkspaceScope = () => 'project:project_alpha';
    ${helperSource}
    globalThis.restoreMatching = () => restoreLastWorkProjectIdentityFromAssets({
      workspaceScope: { id: 'project:project_alpha' },
      currentProjectId: '',
      factory: canonicalFactory,
    });
    globalThis.restoreForeign = () => restoreLastWorkProjectIdentityFromAssets({
      workspaceScope: { id: 'project:project_beta' },
      factory: {
        workspace: {
          id: 'project_beta',
          name: '다른 상품',
          createdAt: 1720000000000,
        },
      },
    });
    globalThis.readState = () => JSON.stringify(state);
  `, context);

  assert.equal(context.restoreMatching(), true);
  assert.deepEqual(JSON.parse(context.readState()), {
    currentProjectId: 'project_alpha',
    currentProjectName: '모시바둑파우치',
    currentProjectCreatedAt: 1710000000000,
  });
  assert.equal(context.restoreForeign(), false);
  assert.equal(JSON.parse(context.readState()).currentProjectId, 'project_alpha');
});

test('F5 restore preserves a self-consistent canonical asset scope before product image mirrors hydrate', () => {
  const core02 = read('src/app-core-02.js');
  assert.match(
    core02,
    /function lastWorkFactoryHasSelfConsistentCurrentAssets\(/,
    'F5 restore has no boundary that recognizes a canonical current asset set',
  );
  const helperSource = sourceBetween(
    core02,
    ['function lastWorkFactoryHasSelfConsistentCurrentAssets'],
    'function rotateLastWorkDraftScope',
  );
  const applySource = sourceBetween(
    core02,
    ['function applySessionAssetsPayload'],
    'function repairRestoredSessionIdentityDrift',
  );
  const serverHydrateSource = sourceBetween(
    core02,
    ['async function hydrateServerLastWorkSnapshot'],
    'async function refreshCompetitorAnalysisFromServer',
  );
  assert.match(
    applySource,
    /preserveRestoredFactoryAssetScope[\s\S]*lastWorkFactoryHasSelfConsistentCurrentAssets\(assets\)/,
    'session hydration does not recognize the authoritative saved asset scope',
  );
  assert.match(
    applySource,
    /preserveInlineImages \|\| preserveRestoredFactoryAssetScope/,
    'session hydration still starts from a transient factory mirror instead of the saved canonical assets',
  );
  assert.match(
    applySource,
    /forceIncomingFactory \|\| preserveInlineImages \|\| preserveRestoredFactoryAssetScope/,
    'forced server hydration can still keep stale browser business state when inline images were pruned',
  );
  assert.match(
    applySource,
    /mergeFactoryStoredImages\(workingFactory,\s*currentFactorySnapshot,\s*\{[\s\S]*?keepLatestFactory:\s*true,[\s\S]*?mediaOnly:\s*true,/,
    'forced server hydration does not preserve the server receipt while backfilling only browser image payloads',
  );
  assert.match(
    applySource,
    /!preserveRestoredFactoryAssetScope[\s\S]*syncProductImageAcrossWorkspaces/,
    'product image hydration can still reclassify the restored canonical assets as previous-product results',
  );
  assert.match(
    serverHydrateSource,
    /serverRepairsCurrentAssetScope[\s\S]*lastWorkFactoryHasSelfConsistentCurrentAssets/,
    'server hydration does not detect that the local replica lost the canonical current assets',
  );
  assert.match(
    serverHydrateSource,
    /shouldApply[\s\S]*serverRepairsCurrentAssetScope/,
    'a higher-scoring but asset-empty local replica can still block canonical server asset recovery',
  );

  const context = vm.createContext({});
  vm.runInContext(`
    const LAST_WORK_GENERATED_IMAGE_STAGES = ['hero', 'size', 'cuts', 'detail', 'options'];
    const lastWorkNormalizeIdentityText = value => String(value || '').replace(/\\s+/g, '').toLowerCase();
    const lastWorkIdentityKeysCompatible = (left, right) =>
      lastWorkNormalizeIdentityText(left) === lastWorkNormalizeIdentityText(right);
    ${helperSource}
    const matching = {
      factory: {
        workspace: { id: 'project_alpha' },
        product: {
          productName: '모시바둑파우치',
          productKey: '모시바둑파우치',
          currentRunId: 'work_run_1',
          inputImageFingerprint: 'image_1',
        },
        automation: { currentRunId: 'work_run_1' },
        stages: {
          hero: { currentRunId: 'hero_run_1', latestGenerationRunId: 'hero_run_1' },
        },
        assets: [{
          id: 'hero_1',
          stageId: 'hero',
          workspaceId: 'project_alpha',
          currentRunId: 'hero_run_1',
          productKey: '모시바둑파우치',
          inputImageFingerprint: 'image_1',
          archiveId: 'archive_1',
        }],
      },
    };
    globalThis.matches = () => lastWorkFactoryHasSelfConsistentCurrentAssets(matching);
    globalThis.rejectsForeignImage = () => lastWorkFactoryHasSelfConsistentCurrentAssets({
      factory: {
        ...matching.factory,
        assets: [{ ...matching.factory.assets[0], inputImageFingerprint: 'image_2' }],
      },
    });
    globalThis.rejectsForeignRun = () => lastWorkFactoryHasSelfConsistentCurrentAssets({
      factory: {
        ...matching.factory,
        assets: [{ ...matching.factory.assets[0], currentRunId: 'hero_run_2' }],
      },
    });
  `, context);

  assert.equal(context.matches(), true);
  assert.equal(context.rejectsForeignImage(), false);
  assert.equal(context.rejectsForeignRun(), false);
});

test('F5 restore retags one self-consistent draft asset scope when only the transient draft id rotated', () => {
  const core02 = read('src/app-core-02.js');
  const core03 = read('src/app-core-03.js');
  const helperSource = sourceBetween(
    core02,
    ['function lastWorkFactoryHasSelfConsistentCurrentAssets'],
    'function rotateLastWorkDraftScope',
  );
  const applySource = sourceBetween(
    core02,
    ['function applySessionAssetsPayload'],
    'function repairRestoredSessionIdentityDrift',
  );
  assert.match(
    applySource,
    /repairRestoredDraftFactoryAssetWorkspaceScope\(workingFactory\)/,
    'session hydration does not repair a rotated draft workspace id before rendering saved assets',
  );
  assert.match(
    applySource,
    /preserveRestoredFactoryAssetScope = preserveRestoredFactoryAssetScope \|\| repairedRestoredDraftAssetScope/,
    'a repaired draft asset scope can still be reclassified by product image synchronization',
  );
  const normalizeSource = sourceBetween(
    core03,
    ['function factoryRuntimeNormalizeFactorySnapshot'],
    'function factoryRuntimeInitialSnapshot',
  );
  assert.match(
    normalizeSource,
    /repairRestoredDraftFactoryAssetWorkspaceScope\(initialFactory\)/,
    'the synchronous F5 bootstrap store does not repair a rotated draft asset scope',
  );

  const context = vm.createContext({});
  vm.runInContext(`
    const LAST_WORK_GENERATED_IMAGE_STAGES = ['hero', 'size', 'cuts'];
    const lastWorkNormalizeIdentityText = value => String(value || '').replace(/\\s+/g, '').toLowerCase();
    const lastWorkIdentityKeysCompatible = (left, right) =>
      lastWorkNormalizeIdentityText(left) === lastWorkNormalizeIdentityText(right);
    const getCurrentLastWorkWorkspaceScope = () => 'draft:lastwork_new';
    const factoryStampFactoryItemsWorkspaceIdentity = (factory, workspaceId, options = {}) => {
      ['assets', 'previousAssets'].forEach(key => {
        (factory[key] || []).forEach(asset => {
          if (asset.workspaceId !== options.previousWorkspaceId) return;
          asset.workspaceId = workspaceId;
          asset.currentProjectId = workspaceId;
          asset.metadata = { ...(asset.metadata || {}), workspaceId };
          asset.sourceMap = { ...(asset.sourceMap || {}), workspaceId };
          if (asset.localArchive) asset.localArchive.workspaceId = workspaceId;
        });
      });
    };
    ${helperSource}
    const makeFactory = (overrides = {}) => ({
      workspace: { id: 'draft:lastwork_new' },
      currentProjectId: 'draft:lastwork_new',
      product: {
        productName: '모시바둑파우치',
        productKey: '모시바둑파우치',
        inputImageFingerprint: 'image_1',
      },
      stages: {
        hero: { currentRunId: 'hero_run_1', latestGenerationRunId: 'hero_run_1' },
      },
      assets: [{
        id: 'hero_1',
        stageId: 'hero',
        workspaceId: 'draft:lastwork_old',
        currentRunId: 'hero_run_1',
        productKey: '모시바둑파우치',
        inputImageFingerprint: 'image_1',
        archiveId: 'archive_1',
        metadata: { workspaceId: 'draft:lastwork_old' },
        sourceMap: { workspaceId: 'draft:lastwork_old' },
        localArchive: { workspaceId: 'draft:lastwork_old' },
      }],
      ...overrides,
    });
    globalThis.repairMatchingDraft = () => {
      const factory = makeFactory();
      const repaired = repairRestoredDraftFactoryAssetWorkspaceScope(factory);
      return JSON.stringify({ repaired, factory });
    };
    globalThis.repairBlankDraftRoot = () => {
      const factory = makeFactory({
        workspace: { id: '' },
        currentProjectId: '',
      });
      const repaired = repairRestoredDraftFactoryAssetWorkspaceScope(factory);
      return JSON.stringify({ repaired, factory });
    };
    globalThis.rejectProjectScope = () => repairRestoredDraftFactoryAssetWorkspaceScope(
      makeFactory({ workspace: { id: 'project_alpha' }, currentProjectId: 'project_alpha' }),
    );
    globalThis.rejectForeignInput = () => {
      const factory = makeFactory();
      factory.assets[0].inputImageFingerprint = 'image_2';
      return repairRestoredDraftFactoryAssetWorkspaceScope(factory);
    };
  `, context);

  const matching = JSON.parse(context.repairMatchingDraft());
  assert.equal(matching.repaired, true);
  assert.equal(matching.factory.assets[0].workspaceId, 'draft:lastwork_new');
  assert.equal(matching.factory.assets[0].metadata.workspaceId, 'draft:lastwork_new');
  assert.equal(matching.factory.assets[0].sourceMap.workspaceId, 'draft:lastwork_new');
  assert.equal(matching.factory.assets[0].localArchive.workspaceId, 'draft:lastwork_new');
  const blankRoot = JSON.parse(context.repairBlankDraftRoot());
  assert.equal(blankRoot.repaired, true);
  assert.equal(blankRoot.factory.workspace.id, '');
  assert.equal(blankRoot.factory.currentProjectId, '');
  assert.equal(blankRoot.factory.assets[0].workspaceId, 'draft:lastwork_new');
  assert.equal(context.rejectProjectScope(), false);
  assert.equal(context.rejectForeignInput(), false);
});

test('F5 restore retags candidate review scopes only from the restored draft into the current draft', () => {
  const core02 = read('src/app-core-02.js');
  const helperSource = sourceBetween(
    core02,
    ['function resolveRestoredCandidateReviewWorkspaceId'],
    'function restoreLastWorkProjectIdentityFromAssets',
  );
  const applySource = sourceBetween(
    core02,
    ['function applySessionAssetsPayload'],
    'function repairRestoredSessionIdentityDrift',
  );
  const persistentRestoreSource = sourceBetween(
    core02,
    ['function loadPersistentSession'],
    'async function clearPersistentSession',
  );
  const core03 = read('src/app-core-03.js');
  const runtimeNormalizeSource = sourceBetween(
    core03,
    ['function factoryRuntimeNormalizeFactorySnapshot'],
    'function factoryRuntimeInitialSnapshot',
  );
  assert.match(
    applySource,
    /resolveRestoredCandidateReviewWorkspaceId\(\s*restoredCandidateWorkspaceId,\s*state\.currentProjectId/,
    'asset payload restore must resolve a rotated draft before migrating candidate scopes',
  );
  assert.match(
    persistentRestoreSource,
    /resolveRestoredCandidateReviewWorkspaceId\(\s*restoredCandidateWorkspaceId,\s*s\.currentProjectId/,
    'persistent session restore must resolve a rotated draft before migrating candidate scopes',
  );
  assert.match(
    runtimeNormalizeSource,
    /resolveRestoredCandidateReviewWorkspaceId\(\s*restoredCandidateWorkspaceId,\s*state\.currentProjectId/,
    'factory store bootstrap must migrate candidate scopes after a transient draft id rotates',
  );

  const context = vm.createContext({});
  vm.runInContext(`
    const getStoredLastWorkDraftScope = () => 'draft:lastwork_current';
    ${helperSource}
    globalThis.resolveDraft = () => resolveRestoredCandidateReviewWorkspaceId('draft:lastwork_saved', '');
    globalThis.keepProject = () => resolveRestoredCandidateReviewWorkspaceId('project:saved', '');
    globalThis.preferExplicitProject = () => resolveRestoredCandidateReviewWorkspaceId('draft:lastwork_saved', 'project:opened');
    globalThis.resolveBlankDraftRoot = () => resolveRestoredCandidateReviewWorkspaceId('', '');
  `, context);

  assert.equal(context.resolveDraft(), 'draft:lastwork_current');
  assert.equal(context.keepProject(), 'project:saved');
  assert.equal(context.preferExplicitProject(), 'project:opened');
  assert.equal(context.resolveBlankDraftRoot(), 'draft:lastwork_current');
});
