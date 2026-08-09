const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const PERSISTENCE_CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const VIEW_CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const ARCHIVE_CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function sourceBetween(start, end) {
  const startIndex = CORE.indexOf(start);
  const endIndex = CORE.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return CORE.slice(startIndex, endIndex);
}

function sourceBetweenIn(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('recent and imported workfiles refresh their scoped local archive after the workspace transition', () => {
  const helper = sourceBetween(
    'async function refreshLoadedWorkfileArchiveAssets(',
    'async function loadProjectRecord(',
  );
  assert.match(helper, /factoryRefreshLocalArchiveAssets\(\{[\s\S]*force: true[\s\S]*cacheMs: 0/);
  assert.match(helper, /const store = factoryRuntimeRequireStore\(\);[\s\S]*store\.isOperationCurrent\(operationToken\)/);

  const recentLoad = sourceBetween(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );
  assert.match(recentLoad, /workspaceScopeTransitionState\.inProgress = false;[\s\S]*await refreshLoadedWorkfileArchiveAssets\(/);

  const importedLoad = sourceBetween(
    'async function importFactoryProjectFileBundle(',
    'async function importFactoryProjectFileFromText(',
  );
  assert.match(importedLoad, /workspaceScopeTransitionState\.inProgress = false;[\s\S]*await refreshLoadedWorkfileArchiveAssets\(/);
});

test('startup render schedules the same scoped archive refresh after F5 restore', () => {
  const startIndex = VIEW_CORE.indexOf('function renderFactoryLocalArchiveMiniPanel(');
  const endIndex = VIEW_CORE.indexOf('function renderGlobalWorkfileBar(', startIndex);
  assert.notEqual(startIndex, -1);
  assert.notEqual(endIndex, -1);
  const renderer = VIEW_CORE.slice(startIndex, endIndex);
  assert.match(
    renderer,
    /factoryScheduleLocalArchiveAutoRefresh\(factory\)/,
    'the startup-restored workfile must not depend on a manual refresh click',
  );
});

test('already restored archive images disable the restore control instead of accepting a no-op click', () => {
  const startIndex = VIEW_CORE.indexOf('function renderFactoryLocalArchiveMiniPanel(');
  const endIndex = VIEW_CORE.indexOf('function renderGlobalWorkfileBar(', startIndex);
  assert.notEqual(startIndex, -1);
  assert.notEqual(endIndex, -1);
  const renderer = VIEW_CORE.slice(startIndex, endIndex);

  assert.match(renderer, /const restoreTargets = typeof factoryLocalArchiveRestoreTargets === 'function'/);
  assert.match(renderer, /disabledAttr\(!restoreReady, restoreDisabledReason\)/);
  assert.match(renderer, /이미 복원됨/);
});

test('only the explicit New Work action can run the full blank-work reset', () => {
  const recentLoad = sourceBetween(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );
  const blankWork = sourceBetween(
    'async function startBlankWorkDraft(',
    'async function startNewWorkDocument(',
  );

  assert.doesNotMatch(
    recentLoad,
    /resetActiveWorkspaceDocumentCore\(/,
    'loading an existing workfile must replace it, never turn it into a blank draft',
  );
  assert.match(
    blankWork,
    /confirmSaveBeforeLeavingWorkspace\('새 작업'\)[\s\S]*await resetActiveWorkspaceDocumentCore\(\)/,
    'the destructive reset remains behind the explicit New Work confirmation',
  );
});

test('startup restores the latest saved project only when the blank state was not an explicit New Work reset', () => {
  const bootstrap = sourceBetweenIn(
    PERSISTENCE_CORE,
    'function saveLastWorkBootstrap(',
    'async function settleLastWorkBootstrapWrites(',
  );
  const workspaceList = sourceBetweenIn(
    CORE,
    'async function refreshWorkspaceLists(',
    'async function saveCurrentProject(',
  );

  assert.match(
    bootstrap,
    /workspaceKind/,
    'bootstrap must persist whether the blank document came from an explicit New Work action',
  );
  assert.match(
    workspaceList,
    /loadLastWorkBootstrap\(\)/,
    'startup list hydration must inspect the explicit blank-work marker',
  );
  assert.match(
    workspaceList,
    /loadProjectRecord\(/,
    'startup list hydration must reconnect a saved project when the current pointer is missing',
  );
  assert.match(
    workspaceList,
    /blank-reset|content-draft/,
    'explicit blank/content drafts must remain untouched by automatic latest-project recovery',
  );
});

test('startup project recovery is not blocked by a partially hydrated session', () => {
  const workspaceList = sourceBetweenIn(
    CORE,
    'async function maybeRestoreLatestSavedProjectOnStartup(',
    'async function saveCurrentProject(',
  );
  const recentLoad = sourceBetween(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );

  assert.match(
    workspaceList,
    /workspaceKind === 'project'[\s\S]*loadProjectRecord\(target\.id, \{ startupRestore: true \}\)/,
    'a saved-project bootstrap must reconnect even when image/session content was hydrated first',
  );
  assert.match(
    workspaceList,
    /candidateCount\(currentFactory\) > 0[\s\S]*candidateCount\(savedFactory\) === 0/,
    'startup recovery must only replace a partial session when the saved project actually contains candidate data',
  );
  assert.match(
    recentLoad,
    /options\.startupRestore === true[\s\S]*confirmSaveBeforeLeavingWorkspace/,
    'only the clean startup restore path may bypass the save/discard prompt',
  );
  assert.match(
    recentLoad,
    /preserveCurrentScope: options\.startupRestore === true/,
    'startup project recovery must keep the existing browser draft scope',
  );
});

test('startup archive refresh recomputes the restore warning before patching the panel', () => {
  const start = ARCHIVE_CORE.indexOf('function factoryScheduleLocalArchiveAutoRefresh(');
  const end = ARCHIVE_CORE.indexOf('function factoryRenderLocalArchivePanel(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const autoRefresh = ARCHIVE_CORE.slice(start, end);

  assert.match(
    autoRefresh,
    /factoryRefreshLocalArchiveAssets\(\{ auto: true \}\)\.then\(\(\) => \{[\s\S]*showImageRestoreWarningIfNeeded\(\)[\s\S]*render\(\)[\s\S]*factoryRenderLocalArchivePanel/,
    'an F5 archive refresh must clear a stale restore warning before the panel is patched',
  );
});
