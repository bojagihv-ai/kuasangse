const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const CORE = path.resolve(__dirname, '../../src/app-core-02.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source slice: ${startMarker}`);
  return source.slice(start, end);
}

function createDraftSaveRuntime(fetchImpl, { transitionInProgress = false } = {}) {
  const source = fs.readFileSync(CORE, 'utf8');
  const draft = sourceSlice(source, 'function saveDraftRecoverySnapshot(', '\nfunction buildServerLastWorkSnapshot');
  const server = sourceSlice(source, 'async function saveServerLastWorkSnapshot(', '\nfunction scheduleServerLastWorkSave');
  const saver = sourceSlice(source, 'function saveLastWorkNow(', '\nfunction flushLastWorkBeforeLeave');
  return new Function('fetch', 'kuasangseBackendBaseUrl', 'transitionInProgress', `
    const state = { productName: 'draft recovery red', factory: {} };
    const draftScope = 'draft:recovery-red';
    const DRAFT_RECOVERY_MIN_INTERVAL_MS = 20000;
    let draftRecoveryLastSentAt = 0;
    let draftRecoverySending = false;
    const workspaceScopeTransitionState = { inProgress: transitionInProgress };
    let optionSorterLiveSaveTimer = null;
    const captureWorkspaceDocumentFence = () => ({ scopeId: draftScope, resetToken: 0 });
    const workspaceDocumentFenceIsCurrent = () => true;
    const getCurrentLastWorkWorkspaceScope = () => draftScope;
    const getCurrentDocumentWorkspaceScope = () => '';
    const buildServerLastWorkSnapshot = () => ({ productName: state.productName });
    const savePersistentState = () => false;
    const flushQueuedPersistentState = () => Promise.resolve(false);
    const saveLastWorkBootstrap = () => true;
    const flushFactoryLastSnapshotSave = () => Promise.resolve(true);
    const saveLastProductImageBackupToDbIfChanged = () => Promise.resolve(false);
    const markPendingSessionAssetSaveIfChanged = () => {};
    const factoryArchiveWritesInFlight = () => false;
    const serverLastWorkFailureDelayMs = () => 0;
    const scheduleServerLastWorkSave = () => {};
    const sessionAssetsHydrated = false;
    let lastWorkSaveTimer = null;
    let lastWorkSyncingVisibleInputs = false;
    let workspaceBlankResetInProgress = false;
    let serverLastWorkHydrated = true;
    let serverLastWorkSavePromise = null;
    let serverLastWorkSaveRequestedAgain = false;
    let serverLastWorkForceSaveRequested = false;
    let serverLastWorkFactorySnapshotRequested = null;
    let serverLastWorkFailureCount = 0;
    let serverLastWorkRetryAfter = 0;
    ${draft}
    ${server}
    ${saver}
    return { saveLastWorkNow, saveServerLastWorkSnapshot, saveDraftRecoverySnapshot };
  `)(fetchImpl, () => 'http://backend.test', transitionInProgress);
}

test('DRAFT-NET save waits for the draft recovery POST before resolving', async () => {
  let resolveDirectPost;
  const directRequests = [];
  const directRuntime = createDraftSaveRuntime((url, options) => {
    directRequests.push({ url, options });
    return new Promise(resolve => { resolveDirectPost = resolve; });
  });
  const directSaving = directRuntime.saveServerLastWorkSnapshot('direct', { force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(directRequests.length, 1, 'draft recovery POST must start at the server-save seam');
  resolveDirectPost({ ok: true, status: 200 });
  await directSaving;

  let resolvePost;
  const requests = [];
  const runtime = createDraftSaveRuntime((url, options) => {
    requests.push({ url, options });
    return new Promise(resolve => { resolvePost = resolve; });
  }, { transitionInProgress: true });

  const saving = runtime.saveLastWorkNow({ force: true, sync: false });
  let settled = false;
  saving.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(requests.length, 1, 'draft recovery POST must start');
  assert.equal(settled, false, 'saveLastWorkNow must remain pending until the POST completes');

  resolvePost({ ok: true, status: 200 });
  await saving;
  assert.equal(settled, true);
});

function createOptionPayloadRuntime(recovery, previousLightweight = null) {
  const source = fs.readFileSync(CORE, 'utf8');
  const strip = sourceSlice(source, 'function stripOptionSorterImages(', '\nfunction buildLightweightSessionPayload');
  const load = sourceSlice(source, 'function loadOptionSorterLiveRecovery(', '\nfunction saveOptionSorterLiveRecovery');
  const generic = sourceSlice(source, 'function optionSorterSlotNameIsGeneric(', '\nfunction optionSorterDurableProgress');
  const merge = sourceSlice(source, 'function mergeOptionSorterStoredImages(', '\nfunction recoverStaleSessionInlineImages');
  const payload = sourceSlice(source, 'function currentSessionAssetsPayload(', '\nfunction getServerLastWorkBases');
  return new Function('recovery', 'previousLightweight', `
    const SESSION_ASSET_ID = 'session-assets';
    const IMAGE_STORED_MARKER = '__stored__';
    const scope = 'project:option-source-red';
    const state = {
      currentProjectId: 'option-source-red',
      productName: 'option source red',
      step: 'optionsorter',
      optionSorter: {
        images: [], pool: [], slots: [], optionResults: [],
        optionSourceClearedAt: 0, optionSourceDeletedArchiveIds: [],
      },
      factory: { product: {} },
    };
    let lastLightweightSessionPayload = previousLightweight;
    const getLastLightweightSessionPayloadForScope = scopeId => {
      const expectedScope = String(scopeId || '').trim();
      if (!expectedScope) return lastLightweightSessionPayload;
      return lastLightweightSessionPayload?.workspaceScope?.id === expectedScope
        ? lastLightweightSessionPayload
        : null;
    };
    const workspaceSessionGetItem = () => recovery;
    const workspacePersistenceApi = () => ({ normalizeWorkspaceScope: value => String(value || '') });
    const getCurrentLastWorkWorkspaceScope = () => scope;
    const getCurrentDocumentWorkspaceScope = () => '';
    const lastWorkSnapshotWorkspaceScope = snapshot => String(snapshot?.workspaceScope?.id || snapshot?.workspaceScope || snapshot?.workspaceId || '');
    const currentWorkspaceRevision = () => ({ scopeId: scope, counter: 1 });
    const currentWorkspaceBranch = () => null;
    const cloneData = value => JSON.parse(JSON.stringify(value));
    const stripFactoryImages = value => cloneData(value);
    const getCafe24FieldViewStorageSnapshot = () => ({});
    const resolveCafe24FieldViewForLastWork = () => ({});
    const currentWorkspaceInputImageFingerprint = () => '';
    const ensureActiveWorkIdentity = () => ({ initialProductKey: 'option-source-red' });
    const productImageBackupReferencePayload = () => ({});
    const compactProductImageBackupPayload = () => ({});
    const loadFixedDetailImages = () => [];
    const stripAnalysisImages = value => value;
    const stripSectionImages = value => value;
    const stripDetailBlockImages = value => value;
    const stripFixedDetailImagesForSession = value => value;
    const stripVariantImages = value => value;
    const stripAiRepairUndoImages = value => value;
    const stripAiRepairDraft = value => value;
    const stripCutsImages = value => value;
    const stripCutsRuntimeFlags = value => value;
    const stripCompPageImages = value => value;
    ${strip}
    ${load}
    ${generic}
    ${merge}
    ${payload}
    return { state, currentSessionAssetsPayload };
  `)(recovery, previousLightweight);
}

test('OPT-05 empty autosave preserves a same-scope archived option source marker', () => {
  const recovery = JSON.stringify({
    workspaceScope: 'project:option-source-red',
    projectId: 'option-source-red',
    savedAt: 100,
    optionSorter: {
      images: [{
        id: 'source-1', archiveId: 'archive-1',
        imageUrl: '/api/local-archive/assets/archive-1/image',
        imagePersistence: 'local-archive-url',
        sourceType: 'option-sorter-source-upload',
      }],
      pool: ['source-1'],
      slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['source-1'] }],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  });
  const runtime = createOptionPayloadRuntime(recovery);

  const payload = runtime.currentSessionAssetsPayload({ includeImages: false });

  assert.equal(payload.optionSorter.images.length, 1);
  assert.equal(payload.optionSorter.images[0].archiveId, 'archive-1');
  assert.deepEqual(payload.optionSorter.pool, ['source-1']);
});

test('OPT-05 preserves an explicit newer source clear over the live recovery marker', () => {
  const recovery = JSON.stringify({
    workspaceScope: 'project:option-source-red',
    projectId: 'option-source-red',
    savedAt: 100,
    optionSorter: {
      images: [{ id: 'source-1', archiveId: 'archive-1' }],
      pool: ['source-1'],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  });
  const runtime = createOptionPayloadRuntime(recovery);
  runtime.state.optionSorter.optionSourceClearedAt = 200;

  const payload = runtime.currentSessionAssetsPayload({ includeImages: false });

  assert.deepEqual(payload.optionSorter.images, []);
  assert.deepEqual(payload.optionSorter.pool, []);
  assert.equal(payload.optionSorter.optionSourceClearedAt, 200);
});

test('OPT-05 empty autosave preserves the previous same-scope lightweight archive marker', () => {
  const previousLightweight = {
    workspaceScope: { id: 'project:option-source-red' },
    optionSorter: {
      images: [{ id: 'source-1', archiveId: 'archive-1', imageUrl: '/archive/1' }],
      pool: ['source-1'],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  };
  const runtime = createOptionPayloadRuntime(null, previousLightweight);

  const payload = runtime.currentSessionAssetsPayload({ includeImages: false });

  assert.equal(payload.optionSorter.images.length, 1);
  assert.equal(payload.optionSorter.images[0].archiveId, 'archive-1');
  assert.deepEqual(payload.optionSorter.pool, ['source-1']);
});

test('OPT-05 persistent save reconciles the prior option-source marker before publishing the next lightweight snapshot', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const save = sourceSlice(source, 'function savePersistentState(', '\nasync function flushQueuedPersistentState');
  const assignment = save.indexOf('lastLightweightSessionPayload = result.payload');

  assert.ok(assignment >= 0, 'persistent save must publish a lightweight payload');
  const reconciliation = save.indexOf('mergeOptionSorterStoredImages(');
  assert.ok(
    reconciliation >= 0 && reconciliation < assignment,
    'the previous same-scope option-source marker must be merged before the new lightweight payload replaces it',
  );
  const payloadAssignment = save.lastIndexOf('result.payload = {', reconciliation);
  assert.ok(payloadAssignment >= 0 && payloadAssignment < assignment, 'the merged option sorter must update the session payload');
  assert.match(
    save.slice(payloadAssignment, assignment + 80),
    /result\.payload\s*=\s*\{[\s\S]*optionSorter[\s\S]*lastLightweightSessionPayload\s*=\s*result\.payload/,
    'the reconciled option sorter must be published through the next result payload',
  );
});

test('OPT-05 server snapshot keeps the prior same-scope option marker before replacing lightweight state', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const build = sourceSlice(source, 'function buildServerLastWorkSnapshot(', '\nfunction workspaceCommitMetadata');
  const assignment = build.indexOf('lastLightweightSessionPayload = lightweight');
  const reconciliation = build.indexOf('mergeOptionSorterStoredImages(');

  assert.ok(assignment >= 0, 'server snapshot must publish a lightweight payload');
  assert.ok(
    reconciliation >= 0 && reconciliation < assignment,
    'server snapshot must reconcile the prior same-scope option marker before replacing it',
  );
  assert.match(
    build,
    /lastWorkSnapshotWorkspaceScope\(previousLightweight\)[\s\S]*mergeOptionSorterStoredImages\(/,
    'the server snapshot must only carry forward option rows from the same workspace scope',
  );
});

test('OPT-05 keeps project and draft lightweight option markers in separate scope caches', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const assets = sourceSlice(source, 'function currentSessionAssetsPayload(', '\nfunction getServerLastWorkBases');
  const build = sourceSlice(source, 'function buildServerLastWorkSnapshot(', '\nfunction workspaceCommitMetadata');
  const save = sourceSlice(source, 'function savePersistentState(', '\nasync function flushQueuedPersistentState');

  assert.match(source, /lastLightweightSessionPayloadByScope\s*=\s*new Map\(\)/);
  assert.match(source, /function getLastLightweightSessionPayloadForScope\(/);
  assert.match(
    assets,
    /getLastLightweightSessionPayloadForScope\(persistenceScopeId\)/,
    'session assets must read the lightweight payload for its own project/draft scope',
  );
  assert.match(
    build,
    /getLastLightweightSessionPayloadForScope\(workspaceScope\)/,
    'server snapshots must read the project-scoped lightweight payload',
  );
  assert.match(
    save,
    /getLastLightweightSessionPayloadForScope\(scopeId\)/,
    'persistent saves must reconcile only the lightweight payload for their own scope',
  );
});

test('OPT-05 treats a successful or unchanged session-asset boundary as server-save ready', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const assetsSave = sourceSlice(source, 'async function saveSessionAssetsToDb(', '\nasync function saveSessionAssetsToDbOnce');
  const assetsSaveOnce = sourceSlice(source, 'async function saveSessionAssetsToDbOnce(', '\nfunction scheduleSessionAssetSave');
  const assetsFastPath = sourceSlice(source, 'function saveSessionAssetsToDbIfChanged(', '\nasync function sessionAssetsForAuthoritativeCommit');

  assert.match(assetsSave, /return\s+(?:\w+\s*!==\s*false|true)/, 'session-asset save must expose a success result');
  assert.match(assetsSaveOnce, /return\s+true\s*;/, 'successful/no-op IndexedDB asset saves must resolve true');
  assert.match(assetsSaveOnce, /return\s+false\s*;/, 'real IndexedDB asset failures must resolve false');
  assert.match(assetsFastPath, /return\s+Promise\.resolve\(true\)/, 'an unchanged asset fingerprint is a successful no-op');
});

test('OPT-05 manual save supersedes a pending option-sorter live-save timer', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const save = sourceSlice(source, 'function saveLastWorkNow(', '\nfunction flushLastWorkBeforeLeave');

  assert.match(
    save,
    /optionSorterLiveSaveTimer[\s\S]*clearTimeout\(optionSorterLiveSaveTimer\)[\s\S]*optionSorterLiveSaveTimer\s*=\s*null/,
    'manual save must cancel the older option-sorter timer before publishing its own snapshot',
  );
});

test('OPT-05 queued persistence waits for the workspace transition before retrying the server snapshot', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const flush = sourceSlice(source, 'async function flushQueuedPersistentState(', '\nfunction loadPersistentSession');

  assert.match(
    flush,
    /await\s+waitForWorkspaceScopeTransition\(\)/,
    'a manual save caught during a workspace transition must await the transition before retrying',
  );
});

test('OPT-05 server snapshot waits for a transition instead of dropping the manual save', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const save = sourceSlice(source, 'async function saveServerLastWorkSnapshot(', '\nfunction scheduleServerLastWorkSave');

  assert.match(
    save,
    /workspaceScopeTransitionState\.inProgress[\s\S]*waitForWorkspaceScopeTransition\(\)/,
    'the server write must wait for the current workspace transition before returning false',
  );
});

function createOptionLiveSaveRuntime(recovery) {
  const source = fs.readFileSync(CORE, 'utf8');
  const strip = sourceSlice(source, 'function stripOptionSorterImages(', '\nfunction buildLightweightSessionPayload');
  const load = sourceSlice(source, 'function loadOptionSorterLiveRecovery(', '\nfunction saveOptionSorterLiveRecovery');
  const generic = sourceSlice(source, 'function optionSorterSlotNameIsGeneric(', '\nfunction optionSorterDurableProgress');
  const merge = sourceSlice(source, 'function mergeOptionSorterStoredImages(', '\nfunction recoverStaleSessionInlineImages');
  const save = sourceSlice(source, 'function saveOptionSorterLiveRecovery(', '\nfunction flushOptionSorterLiveRecoverySave');
  return new Function('recovery', `
    const state = {
      currentProjectId: 'option-source-red',
      optionSorter: { images: [], pool: [], slots: [], optionSourceClearedAt: 0, optionSourceDeletedArchiveIds: [] },
    };
    const workspaceSessionGetItem = () => recovery;
    let savedValue = null;
    const workspaceSessionSetItem = (_key, value) => { savedValue = value; return true; };
    const getCurrentLastWorkWorkspaceScope = () => 'project:option-source-red';
    const serverLastWorkHydrated = true;
    const serverLastWorkHydrating = false;
    let optionSorterLiveSaveQueued = false;
    ${strip}
    ${load}
    ${generic}
    ${merge}
    ${save}
    return { saveOptionSorterLiveRecovery, saved: () => savedValue };
  `)(recovery);
}

test('OPT-05 live recovery write does not lower an archived source without an explicit clear', async () => {
  const recovery = JSON.stringify({
    workspaceScope: 'project:option-source-red',
    projectId: 'option-source-red',
    optionSorter: {
      images: [{ id: 'source-1', archiveId: 'archive-1', imageUrl: '/archive/1' }],
      pool: ['source-1'],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  });
  const runtime = createOptionLiveSaveRuntime(recovery);

  await runtime.saveOptionSorterLiveRecovery();

  const saved = JSON.parse(runtime.saved());
  assert.equal(saved.optionSorter.images.length, 1);
  assert.equal(saved.optionSorter.images[0].archiveId, 'archive-1');
  assert.deepEqual(saved.optionSorter.pool, ['source-1']);
});

function createDraftRestoreRuntime() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');
  const restore = sourceSlice(source, 'async function restoreDraftRecoveryEntry(', '\nfunction handleDraftRecoveryClick');
  return new Function('fetch', `
    const scope = 'draft:recovery-red';
    const state = { draftRecovery: { opened: true, loading: false, entries: [], error: '' } };
    const draftRecoveryState = () => state.draftRecovery;
    const getCurrentLastWorkWorkspaceScope = () => scope;
    const kuasangseBackendBaseUrl = () => 'http://backend.test';
    const render = () => {};
    const factoryLog = () => {};
    let capturedOptions = null;
    const applyServerLastWorkSnapshot = (snapshot, options) => {
      capturedOptions = options;
      return true;
    };
    ${restore}
    return { restoreDraftRecoveryEntry, state, capturedOptions: () => capturedOptions };
  `)(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, snapshot: { workspaceScope: { id: 'draft:recovery-red' } } }),
  }));
}

test('DRAFT-NET manual recovery bypasses only revision freshness after scope validation', async () => {
  const runtime = createDraftRestoreRuntime();

  await runtime.restoreDraftRecoveryEntry(123);

  assert.deepEqual(runtime.capturedOptions(), {
    expectedWorkspaceScopeId: 'draft:recovery-red',
    replaceWorkspace: true,
    persistReplica: true,
    forceRevisionRestore: true,
  });
  assert.equal(runtime.state.draftRecovery.error, '');
});
