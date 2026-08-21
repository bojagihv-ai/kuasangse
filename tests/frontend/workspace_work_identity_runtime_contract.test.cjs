const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const core02 = fs.readFileSync(path.join(ROOT, 'src/app-core-02.js'), 'utf8');
const core03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const core05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
const core06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');
const sessionAdapter = fs.readFileSync(path.join(ROOT, 'src/modules/persistence/session-storage-adapter.mjs'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.notEqual(end, -1, `missing function ${nextName}`);
  return source.slice(start, end);
}

test('startup validates the entire persisted snapshot before normalizing or repairing fields', () => {
  const body = functionBody(core02, 'loadPersistentSession', 'clearPersistentSession');
  const validationAt = body.indexOf('validateSnapshotIdentity');
  const normalizationAt = body.indexOf('normalizeFactoryState(s.factory)');
  assert.ok(validationAt > -1, 'startup identity validation is required');
  assert.ok(validationAt < normalizationAt, 'validation must happen before any factory normalization');
  assert.doesNotMatch(body, /s\.factory\.product\.productName\s*=\s*s\.productName/);
  assert.doesNotMatch(body, /!sessionHasVisibleProductImage\s*&&\s*!s\.imagePreview\s*&&\s*s\.factory\?\.product\?\.imagePreview/);
});

test('all persisted workspace payloads carry the same immutable work identity', () => {
  const saveBody = functionBody(core02, 'savePersistentState', 'flushQueuedPersistentState');
  const sessionBody = functionBody(core02, 'currentSessionAssetsPayload', 'getServerLastWorkBases');
  const workspaceBody = functionBody(core03, 'buildWorkspacePayload', 'restoreProjectFileFactoryAssetsFromPayload');
  for (const body of [saveBody, sessionBody, workspaceBody]) {
    assert.match(body, /workIdentity\s*:/);
  }
});

test('active recovery always uses this tab draft branch even when a document id exists', () => {
  const body = functionBody(core02, 'getCurrentLastWorkWorkspaceScope', 'getCurrentDocumentWorkspaceScope');
  assert.match(body, /normalizeWorkspaceScope\(getStoredLastWorkDraftScope\(\)\)/);
  assert.doesNotMatch(body, /state\?\.currentProjectId|factory\?\.workspace|normalizeProjectScope/);
});

test('saved document identity never makes the whole active menu inert', () => {
  const body = functionBody(core03, 'renderShellMarkup', 'bindShellAfterRender');
  assert.doesNotMatch(body, /\sinert(?:\s|=)/);
  assert.doesNotMatch(body, /workspace-readonly-content/);
});

test('read-only authority locks the active menu immediately without coupling it to document identity', () => {
  const body = functionBody(core06, 'syncWorkspaceAuthorityReadOnlyDom', 'handleWorkspaceAuthorityAction');
  assert.match(body, /workspaceAuthorityIsReadOnly\(\)/);
  assert.match(body, /container\.toggleAttribute\('inert', readOnly\)/);
  assert.match(body, /saveButton\.disabled = readOnly/);
  const subscriber = functionBody(core06, 'bindWorkspaceAuthorityUi', 'classicRuntimeFreezeDetached');
  assert.match(subscriber, /handleWorkspaceAuthoritySnapshot[\s\S]*syncWorkspaceAuthorityReadOnlyDom\(\)/);
});

test('tab recovery payloads persist an explicit document-to-branch binding', () => {
  const sessionBody = functionBody(core02, 'currentSessionAssetsPayload', 'getServerLastWorkBases');
  const saveBody = functionBody(core02, 'savePersistentState', 'flushQueuedPersistentState');
  for (const body of [sessionBody, saveBody]) {
    assert.match(body, /workspaceBranch\s*:/);
  }
  assert.match(core03, /function projectWorkspaceSnapshotForDocument\(/);
});

test('unsaved tab branches never manufacture a document id just to run asset sync', () => {
  const body = functionBody(core03, 'requestCurrentWorkBundleLiveSync', 'replayPendingWorkBundleSync');
  assert.match(body, /if \(!String\(state\.currentProjectId \|\| ''\)\.trim\(\)\)/);
  assert.match(body, /return Promise\.resolve\(null\)/);
});

test('live asset sync is branch-scoped and only an explicit Save targets the document', () => {
  const workspaceIdBody = functionBody(core03, 'currentWorkBundleWorkspaceId', 'currentWorkBundleKey');
  const keyBody = functionBody(core03, 'currentWorkBundleKey', 'scopeWorkBundleForCurrentBranch');
  const scopeBody = functionBody(core03, 'scopeWorkBundleForCurrentBranch', 'currentWorkBundleActivityHeartbeat');
  const saveStart = core03.indexOf("void requestCurrentWorkBundleLiveSync('작업파일 저장 최종 대조'");
  assert.ok(saveStart > -1, 'explicit Save sync call is required');
  const saveSync = core03.slice(saveStart, saveStart + 420);

  assert.match(workspaceIdBody, /options\.documentCommit !== true/);
  assert.match(workspaceIdBody, /getCurrentLastWorkWorkspaceScope\(\)/);
  assert.match(workspaceIdBody, /branchScope\.startsWith\('draft:'\)/);
  assert.match(keyBody, /currentWorkBundleWorkspaceId\(options\)/);
  assert.match(scopeBody, /Object\.freeze\(\{ \.\.\.bundle, workspaceId \}\)/);
  assert.match(saveSync, /documentCommit: true/);
});

test('workspace replacement validates atomically before the first live state assignment', () => {
  const body = functionBody(core03, 'applyWorkspacePayload', 'refreshWorkspaceLists');
  const validationAt = body.indexOf('validateSnapshotIdentity');
  const mutationAt = body.indexOf('state.currentProjectId =');
  assert.ok(validationAt > -1, 'workspace payload identity validation is required');
  assert.ok(validationAt < mutationAt, 'validation must precede the first state mutation');
  assert.match(body, /workIdentitiesMatch/);
  assert.match(body, /replaceWorkspace/);
});

test('new document and Save As rotate work identity instead of retaining another file identity', () => {
  const saveAsBody = functionBody(core03, 'startNewProjectDraft', 'resetActiveWorkspaceDocumentCore');
  const resetBody = functionBody(core03, 'resetActiveWorkspaceDocumentCore', 'startBlankWorkDraft');
  assert.match(saveAsBody, /workIdentity\s*=\s*null/);
  assert.match(resetBody, /workIdentity\s*=\s*null/);
});

test('new document replaces the durable bootstrap pointer before clearing the visible document', () => {
  const resetBody = functionBody(core03, 'resetActiveWorkspaceDocumentCore', 'startBlankWorkDraft');
  const settleAt = resetBody.indexOf('await settleLastWorkBootstrapWrites()');
  const clearAt = resetBody.indexOf('await clearPersistentSession()');
  const pointerAt = resetBody.indexOf('await saveLastWorkBootstrap({');
  const visibleResetAt = resetBody.indexOf('state.currentProjectId = \'\';');
  const productResetAt = resetBody.indexOf('state.productName = \'\';');
  const blankSectionScopeAt = resetBody.indexOf('state.sectionWorkScope = sectionWorkScopeMeta({');
  const checkpointAt = resetBody.lastIndexOf('allowBlankResetCheckpoint: true');

  assert.ok(settleAt > -1, 'new document waits for older bootstrap writes');
  assert.ok(clearAt > settleAt, 'old durable state is cleared after pending old writes settle');
  assert.ok(pointerAt > clearAt, 'new draft pointer is installed after old state is removed');
  assert.ok(visibleResetAt > pointerAt, 'visible document is cleared only after the new pointer is durable');
  assert.ok(blankSectionScopeAt > productResetAt, 'blank section scope is derived only after the prior product is cleared');
  assert.ok(checkpointAt > visibleResetAt, 'blank document checkpoint is persisted after the visible reset');
  assert.match(resetBody, /awaitWrite:\s*true/);
  assert.match(resetBody, /documentFence:\s*resetFence/);
  assert.match(resetBody, /sectionWorkScopeMeta\(\{[\s\S]*productName:\s*''/);
  assert.match(core02, /workspaceSessionRemoveItem\(LAST_WORK_BOOTSTRAP_STORAGE_KEY\)/);
});

test('explicit product or base-image replacement rotates the immutable identity and cancels stale background restore before persistence', () => {
  const productBody = functionBody(core03, 'factorySetCurrentProductIdentity', 'factoryAuthoritativeProductName');
  const transitionBody = functionBody(core03, 'factoryBeginExplicitWorkIdentityTransition', 'factorySetCurrentProductIdentity');
  const imageBody = functionBody(core05, 'factoryApplyProductImagePayload', 'factorySetProductImage');
  const startupBody = functionBody(core06, 'runClassicRuntimeHydration', 'hydrateClassicRuntime');
  const backgroundBody = functionBody(core06, 'continueClassicRuntimeHydrationInBackground', 'runClassicRuntimeHydration');
  assert.match(productBody, /rotateWorkIdentity/);
  assert.match(productBody, /factoryBeginExplicitWorkIdentityTransition/);
  assert.match(imageBody, /factoryBeginExplicitWorkIdentityTransition/);
  assert.match(transitionBody, /invalidateWorkspaceBackgroundHydration/);
  assert.match(startupBody, /captureWorkspaceBackgroundHydrationIntent/);
  assert.match(backgroundBody, /hydrationIntentIsCurrent/);
  assert.match(productBody, /options\.syncState\s*!==\s*false/);
  assert.match(core03, /syncWorkIdentity:\s*true,\s*syncActiveProduct:\s*true/);
  assert.match(core03, /syncActiveProductImage:\s*true/);
});

test('explicit workfile load validates first and then rebinds one complete snapshot to its target project', () => {
  const resolverBody = functionBody(core03, 'resolveIncomingWorkspaceWorkIdentity', 'buildWorkspacePayload');
  const applyBody = functionBody(core03, 'applyWorkspacePayload', 'refreshWorkspaceLists');
  assert.match(core03, /function rebindWorkspaceSnapshotForExplicitProjectLoad\(/);
  assert.match(resolverBody, /explicitTargetProjectId/);
  assert.match(resolverBody, /rebindWorkspaceSnapshotForExplicitProjectLoad/);
  assert.match(applyBody, /incomingSourceWorkspaceId/);
  assert.match(applyBody, /attachWorkspaceWorkIdentity\(restoredFactory, incomingWorkIdentity/);
});

test('the always-visible identity card shows workfile, initial product and base image', () => {
  assert.match(core06, /function renderActiveWorkIdentityCard\(/);
  assert.match(core06, /initialProductName/);
  assert.match(core06, /work-identity-float/);
  assert.match(core06, /factoryProjectFileLocationLabel/);
  assert.match(core06, /activeProductName\s*&&\s*currentFingerprint\s*&&\s*boundary\.ok/);
  assert.match(core06, /boundaryMismatch\s*\|\|\s*!currentFingerprint/);
  assert.match(html, /\.work-identity-float\s*\{/);
});

test('the identity card reports a missing historical base image without substituting generated output', () => {
  const card = functionBody(core06, 'renderActiveWorkIdentityCard', 'renderAgentChat');
  assert.match(card, /const hasPreviewPixels\s*=\s*!!preview/);
  assert.match(card, /hasPreviewPixels\s*\?\s*'작업 고정됨'\s*:\s*'기본 이미지 복구 필요'/);
  assert.doesNotMatch(card, /sectionImages|factory\.assets|previousAssets|localAssets/);
  assert.match(html, /\.work-identity-float\.is-image-missing/);
});

test('the identity card recognizes a valid current data-url base image', () => {
  const card = functionBody(core06, 'renderActiveWorkIdentityCard', 'renderAgentChat');
  assert.match(card, /displayableImageSrc\(previewCandidate\)/);
  assert.doesNotMatch(card, /runtimeExternalImageSrc\(previewCandidate\)/);
});

test('every active-work cache and pointer is classified as tab-local recovery state', () => {
  for (const key of [
    'pdp_last_input_checkpoint_v1',
    'kuasangse.projectFileLocationLabel.v1',
    'cuts_size_results_cache_v1',
    'factory_wizard_field_drafts_v1',
    'kuasangse_comp_market_candidate_snapshot_v1',
    'kuasangse_comp_market_image_selection_v1',
  ]) {
    assert.match(sessionAdapter, new RegExp(`['\"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`));
  }
  assert.doesNotMatch(core02, /localStorage\.setItem\(LAST_WORK_INPUT_CHECKPOINT_KEY/);
  assert.doesNotMatch(core03, /localStorage\.(?:getItem|setItem|removeItem)\(KUASANGSE_PROJECT_FILE_LOCATION_LABEL_KEY/);
  assert.doesNotMatch(core05, /localStorage\.(?:getItem|setItem)\(COMP_MARKET_(?:CANDIDATE_SNAPSHOT|IMAGE_SELECTION)_STORAGE_KEY/);
  assert.doesNotMatch(core06, /localStorage\.(?:getItem|setItem|removeItem)\((?:SIZE_CUTS_RESULT_CACHE_KEY|FACTORY_WIZARD_FIELD_DRAFT_STORAGE_KEY)/);
});

test('product-scoped fixed detail images and competitor analysis never use shared localStorage', () => {
  const fixedLoad = functionBody(core02, 'loadFixedDetailImages', 'saveFixedDetailImages');
  const fixedSave = functionBody(core02, 'saveFixedDetailImages', 'stripFixedDetailImagesForSession');
  const compSave = functionBody(core02, 'saveCompAnalysis', 'loadCompAnalysis');
  const compLoad = functionBody(core02, 'loadCompAnalysis', 'safeSectionLiveState');
  for (const body of [fixedLoad, fixedSave, compSave, compLoad]) {
    assert.doesNotMatch(body, /localStorage\./);
  }
});

test('automatic product-image backup never crosses the active workspace boundary', () => {
  const payloadBody = functionBody(core02, 'currentProductImageBackupPayload', 'productImageBackupFingerprint');
  const hydrateStart = core02.indexOf('async function hydrateLastProductImageBackup(');
  const hydrateEnd = core02.indexOf('const LOCAL_SESSION_MAX_CHARS', hydrateStart);
  assert.notEqual(hydrateStart, -1, 'missing automatic image-backup hydrate');
  assert.notEqual(hydrateEnd, -1, 'missing automatic image-backup hydrate end');
  const hydrateBody = core02.slice(hydrateStart, hydrateEnd);
  const factoryFallback = functionBody(core06, 'factoryProductImageBackupSourcePart', 'factoryLocalArchiveAssetImagePart');

  assert.ok(payloadBody.includes('lastProductImageBackupStorageId(workspaceScope)'));
  assert.match(payloadBody, /workspaceScope:\s*\{\s*id:/);
  assert.ok(hydrateBody.includes('lastProductImageBackupStorageId(workspaceScope)'));
  assert.match(hydrateBody, /productImageBackupMatchesCurrentWorkspace/);
  assert.ok(!hydrateBody.includes('workspaceGet(WORKSPACE_DB.appSettings, LAST_PRODUCT_IMAGE_BACKUP_ID)'));
  assert.ok(factoryFallback.includes('lastProductImageBackupStorageId(workspaceScope)'));
  assert.match(factoryFallback, /productImageBackupMatchesCurrentWorkspace/);
  assert.ok(!factoryFallback.includes('workspaceGet(WORKSPACE_DB.appSettings, LAST_PRODUCT_IMAGE_BACKUP_ID)'));
});

test('old document-scoped assets are copied into this tab branch only after strict document validation', () => {
  const migrationBody = functionBody(
    core02,
    'migrateDocumentSessionAssetsToCurrentBranch',
    'hydratePersistentSessionAssets',
  );
  const hydrateBody = functionBody(core02, 'hydratePersistentSessionAssets', 'expireCookie');

  assert.match(migrationBody, /loadDocumentSessionAssetsForBranchMigration\(boundary\.documentScopeId\)/);
  assert.match(migrationBody, /validateSnapshotIdentity\(source\)/);
  assert.match(migrationBody, /sourceDocumentScope\s*!==\s*boundary\.documentScopeId/);
  assert.match(migrationBody, /bindWorkspaceSnapshotToCurrentBranch/);
  assert.match(migrationBody, /workBranchesMatch/);
  assert.match(migrationBody, /saveSessionAssets\(boundary\.branchScopeId, migrated\)/);
  assert.doesNotMatch(migrationBody, /workspaceDelete|removeProject|clearSessionAssets/);
  assert.match(hydrateBody, /migrateDocumentSessionAssetsToCurrentBranch\(hydrateScopeId/);
});

test('old document image backup migrates by copy and never by cross-workspace fallback', () => {
  const migrationBody = functionBody(
    core02,
    'migrateDocumentProductImageBackupToCurrentBranch',
    'hydrateLastProductImageBackup',
  );
  assert.match(migrationBody, /productImageBackupMatchesCurrentWorkspace\(source, boundary\.documentScopeId\)/);
  assert.match(migrationBody, /productImageBackupConflictsWithCurrentWork\(source\)/);
  assert.match(migrationBody, /workspaceScope:\s*\{\s*id:\s*boundary\.branchScopeId\s*\}/);
  assert.match(migrationBody, /workspacePut\(WORKSPACE_DB\.appSettings, migrated\)/);
  assert.doesNotMatch(migrationBody, /workspaceDelete|remove|clear/);
});

test('async hydration keeps the starting workspace scope until the response is applied', () => {
  const helperStart = core02.indexOf('function workspaceHydrationScopeIsCurrent(');
  const helperEnd = core02.indexOf('function workspaceLockApi(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'hydration scope fence helper is required');
  const context = require('node:vm').createContext({});
  require('node:vm').runInContext(`
    let currentScope = 'project:alpha';
    let currentResetToken = 4;
    const workspaceBlankResetToken = 4;
    const getCurrentLastWorkWorkspaceScope = () => currentScope;
    ${core02.slice(helperStart, helperEnd)}
    globalThis.read = (scope, token, requestIsCurrent) =>
      workspaceHydrationScopeIsCurrent(scope, token, requestIsCurrent);
    globalThis.switchScope = () => { currentScope = 'draft:new-work'; };
    globalThis.changeResetToken = () => { currentResetToken += 1; };
  `, context);

  assert.equal(context.read('project:alpha', 4, () => true), true);
  context.switchScope();
  assert.equal(context.read('project:alpha', 4, () => true), false);
  assert.equal(context.read('draft:new-work', 4, () => false), false);

  const serverBody = functionBody(core02, 'hydrateServerLastWorkSnapshot', 'refreshCompetitorAnalysisFromServer');
  const assetBody = functionBody(core02, 'hydratePersistentSessionAssets', 'expireCookie');
  const backupStart = core02.indexOf('async function hydrateLastProductImageBackup(');
  const backupEnd = core02.indexOf('const LOCAL_SESSION_MAX_CHARS', backupStart);
  assert.ok(backupStart >= 0 && backupEnd > backupStart, 'product image backup hydrate body is required');
  const backupBody = core02.slice(backupStart, backupEnd);
  assert.match(serverBody, /const requestedScopeId = getCurrentLastWorkWorkspaceScope\(\)/);
  assert.match(serverBody, /const restoreScopeId = documentScopeId \|\| hydrateScopeId/);
  assert.match(serverBody, /scopeId:\s*restoreScopeId/);
  assert.match(serverBody, /lastWorkSnapshotMatchesWorkspaceScope\(snapshot, restoreScopeId\)/);
  assert.match(serverBody, /workspaceHydrationScopeIsCurrent\(\s*hydrateScopeId/);
  assert.match(assetBody, /const hydrateScopeId = getCurrentLastWorkWorkspaceScope\(\)/);
  assert.match(assetBody, /workspaceGetSessionAssets\(hydrateScopeId\)/);
  assert.match(assetBody, /expectedWorkspaceScope:\s*hydrateScopeId/);
  assert.match(assetBody, /if \(hydrationIsCurrent\(\)\)/);
  assert.match(backupBody, /expectedWorkspaceScope/);
  assert.match(backupBody, /workspaceHydrationScopeIsCurrent\(workspaceScope/);
});
