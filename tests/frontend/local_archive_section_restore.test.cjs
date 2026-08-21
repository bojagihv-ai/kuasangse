const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
const PREVIEW_MENU = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-menu.mjs'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function compileRestore() {
  const source = sourceBetween(
    CORE,
    'async function factoryRestoreLocalArchiveToCurrentWork(',
    'function sectionLocalArchiveStageId(',
  );
  const calls = { full: [], fast: [] };
  const context = {
    Promise,
    factoryRuntimeUpdateOwnedFactory() { throw new Error('test supplies an owned factory'); },
    saveLastWorkNow() {},
    factoryRenderLocalArchivePanel() {},
    factoryRefreshLocalArchiveAssets: async () => ({ ok: true }),
    factoryLocalArchiveRestoreTargets: () => [
      { archiveId: 'section-header', stageId: 'section_header', title: '헤더 섹션 결과' },
      { archiveId: 'hero-image', stageId: 'hero', title: '대표 이미지' },
    ],
    factoryLoadLocalArchiveAsset: async (archiveId, options) => {
      calls.full.push({ archiveId, options });
      return true;
    },
    factoryRestoreLocalArchiveAssetFast: item => {
      calls.fast.push(item.archiveId);
      return true;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.restore = factoryRestoreLocalArchiveToCurrentWork;`, context);
  return { calls, restore: context.restore };
}

test('automatic archive restore hydrates a section through the full asset endpoint', async () => {
  const { calls, restore } = compileRestore();
  const factory = { archive: { localAssets: [] } };

  const outcome = await restore({ factory, refresh: false, silent: true, render: false });

  assert.equal(outcome.ok, true);
  assert.deepEqual(calls.full.map(call => call.archiveId), ['section-header']);
  assert.deepEqual(calls.fast, ['hero-image']);
  assert.equal(calls.full[0].options.factory, factory);
  assert.equal(calls.full[0].options.silent, true);
  assert.equal(calls.full[0].options.render, false);
});

test('startup archive restore is not starved by unrelated deferred runtime work', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryRestoreLocalArchiveToCurrentWork(',
    'function sectionLocalArchiveStageId(',
  );
  const factory = { archive: { localAssets: [] } };
  let released = false;
  let deferredFlushes = 0;
  let legacyLeaseWrapperCalls = 0;
  const operationToken = Object.freeze({ workspaceId: 'restore-startup', revision: 3, fence: 1 });
  const context = {
    Promise,
    FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL: Symbol('operation-lease-internal'),
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => operationToken,
      acquireOperationLease(operationKey, requestedToken) {
        assert.equal(operationKey, 'factory-archive:restore-current-work');
        assert.equal(requestedToken, operationToken);
        return {
          acquired: true,
          operationToken,
          release() {
            released = true;
            return true;
          },
        };
      },
    }),
    factoryRuntimeWithOperationLease() {
      legacyLeaseWrapperCalls += 1;
      return new Promise(() => {});
    },
    async factoryRuntimeUpdateOwnedFactory(commandName, owner, mutator, internalMode) {
      assert.equal(commandName, 'factory/runtime:restoreLocalArchiveToCurrentWork');
      assert.equal(owner, 'factory-assets');
      assert.equal(internalMode, context.FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL);
      return { result: await mutator(factory) };
    },
    factoryRuntimeFlushDeferredOperations() { deferredFlushes += 1; },
    saveLastWorkNow: async () => {},
    factoryRenderLocalArchivePanel() {},
    factoryRefreshLocalArchiveAssets: async () => ({ ok: true }),
    factoryLocalArchiveRestoreTargets: () => [
      { archiveId: 'hero-image', stageId: 'hero', title: '대표 이미지' },
    ],
    factoryLoadLocalArchiveAsset: async () => false,
    factoryRestoreLocalArchiveAssetFast: () => true,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.restore = factoryRestoreLocalArchiveToCurrentWork;`, context);

  const outcome = await Promise.race([
    context.restore({ silent: true, render: false }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('startup restore was starved')), 250)),
  ]);

  assert.equal(outcome.ok, true);
  assert.equal(legacyLeaseWrapperCalls, 0);
  assert.equal(released, true);
  assert.equal(deferredFlushes, 1);
});

test('archive restore releases its operation lease before best-effort workfile persistence settles', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryRestoreLocalArchiveToCurrentWork(',
    'function sectionLocalArchiveStageId(',
  );
  const factory = { archive: { localAssets: [] } };
  let released = false;
  let saveCalls = 0;
  const operationToken = Object.freeze({ workspaceId: 'restore-persistence', revision: 3, fence: 1 });
  const context = {
    Promise,
    FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL: Symbol('operation-lease-internal'),
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => operationToken,
      acquireOperationLease: () => ({
        acquired: true,
        operationToken,
        release() {
          released = true;
          return true;
        },
      }),
    }),
    async factoryRuntimeUpdateOwnedFactory(commandName, owner, mutator, internalMode) {
      assert.equal(commandName, 'factory/runtime:restoreLocalArchiveToCurrentWork');
      assert.equal(owner, 'factory-assets');
      assert.equal(internalMode, context.FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL);
      return { result: await mutator(factory) };
    },
    factoryRuntimeFlushDeferredOperations() {},
    saveLastWorkNow() {
      saveCalls += 1;
      return new Promise(() => {});
    },
    factoryRenderLocalArchivePanel() {},
    factoryRefreshLocalArchiveAssets: async () => ({ ok: true }),
    factoryLocalArchiveRestoreTargets: () => [
      { archiveId: 'hero-image', stageId: 'hero', title: '대표 이미지' },
    ],
    factoryLoadLocalArchiveAsset: async () => false,
    factoryRestoreLocalArchiveAssetFast: () => true,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.restore = factoryRestoreLocalArchiveToCurrentWork;`, context);

  const outcome = await Promise.race([
    context.restore({ silent: true, render: false }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('archive restore waited on background persistence')), 250)),
  ]);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.restored, 1);
  assert.equal(outcome.total, 1);
  assert.equal(saveCalls, 1);
  assert.equal(released, true);
});

test('current work restore discovers missing archived stages even when other stages are already present', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryRestoreCurrentWorkfileLocalArchive(',
    'async function factoryRestoreLocalArchiveToCurrentWork(',
  );
  const order = [];
  const factory = {
    product: { hasImage: true },
    archive: { stageRunIds: { hero: 'hero-run-current' } },
    stages: { hero: { currentRunId: 'hero-run-current' }, size: {} },
  };
  const context = {
    Promise,
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentWorkfileArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '양단호박바늘쌈',
      inputImageFingerprint: 'same-input-fingerprint',
    }),
    factoryFindAvailableProductImage: () => ({ base64: 'image' }),
    factoryBootstrapCurrentWorkfileArchive: async (options = {}) => {
      assert.equal(
        options.factory,
        undefined,
        'startup restore must let archive bootstrap commit through the factory store',
      );
      order.push('bootstrap');
      factory.archive.stageRunIds.size = 'size-run-recovered';
      factory.stages.size.currentRunId = 'size-run-recovered';
      return { ok: true, stageScopes: { size: 'size-run-recovered' } };
    },
    factoryRefreshLocalArchiveAssets: async options => {
      assert.equal(options.skipBootstrap, true);
      order.push('refresh');
      return { ok: true };
    },
    factoryCurrentWorkfileArchiveScopes: () => [{ currentRunId: 'hero-run-current' }],
    factoryRestoreLocalArchiveToCurrentWork: async () => {
      order.push('restore');
      return { ok: true, restored: 3, total: 3 };
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.restoreCurrent = factoryRestoreCurrentWorkfileLocalArchive;`, context);

  const outcome = await context.restoreCurrent({ silent: true });

  assert.deepEqual(order, ['bootstrap', 'refresh', 'restore']);
  assert.deepEqual(outcome, { ok: true, restored: 3, total: 3 });
  assert.equal(factory.archive.stageRunIds.size, 'size-run-recovered');
});

test('archive bootstrap is read-only and preserves the current PSD tab branch', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryBootstrapCurrentWorkfileArchive(',
    'function factoryCurrentWorkfileArchiveScopes(',
  );
  const identity = {
    workspaceId: 'project-current',
    productKey: '양단호박바늘쌈',
    inputImageFingerprint: 'same-input-fingerprint',
  };
  const factory = {
    product: { hasImage: true },
    archive: { stageRunIds: {} },
    stages: { hero: {} },
  };
  const operationToken = Object.freeze({ workspaceId: identity.workspaceId, revision: 3, fence: 1 });
  const branchScope = 'draft:lastwork_read_only_branch';
  let fetchCalls = 0;
  const successPayload = {
    ok: true,
    assets: [{
      workspaceId: identity.workspaceId,
      productKey: identity.productKey,
      inputImageFingerprint: identity.inputImageFingerprint,
      currentRunId: 'hero-run-recovered',
      stageId: 'hero',
    }],
  };
  const response = (ok, status, payload) => ({
    ok,
    status,
    json: async () => payload,
  });
  const context = {
    Promise,
    URLSearchParams,
    FACTORY_LOCAL_ARCHIVE_BOOTSTRAP_WAIT: null,
    FACTORY_LOCAL_ARCHIVE_BOOTSTRAP_RESULTS: new Map(),
    AbortSignal: undefined,
    window: {},
    state: { backendBaseUrl: 'http://127.0.0.1:5050' },
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => operationToken,
      isOperationCurrent: token => token === operationToken,
      getSnapshot: () => ({ factory }),
    }),
    factoryCurrentWorkfileArchiveIdentity: () => identity,
    factoryFindAvailableProductImage: () => ({ base64: 'image' }),
    getCurrentLastWorkWorkspaceScope: () => branchScope,
    currentWorkspaceAuthority: () => ({
      mode: 'editing',
      scopeId: branchScope,
      fencingToken: 17,
    }),
    ensureWorkspaceEditAuthority: async () => {
      throw new Error('automatic archive bootstrap must not acquire edit authority');
    },
    factoryWorkfileArchiveRequestIsCurrent: (_identity, scope, fence) => {
      assert.equal(scope, branchScope);
      assert.equal(fence, 17);
      return true;
    },
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async (url, options) => {
      fetchCalls += 1;
      assert.equal(options.method, 'GET');
      assert.match(url, /\/api\/local-archive\/assets\?/);
      assert.match(url, new RegExp(`workspaceId=${identity.workspaceId}`));
      return response(true, 200, successPayload);
    },
    factoryAdoptWorkfileArchiveStageRuns: stageScopes => {
      factory.archive.stageRunIds = { ...stageScopes };
      return Object.keys(stageScopes).length;
    },
    factoryCommitWorkfileArchiveBootstrap() {},
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.bootstrap = factoryBootstrapCurrentWorkfileArchive;`, context);

  const outcome = await context.bootstrap({ factory, operationToken });

  assert.equal(outcome.ok, true);
  assert.equal(fetchCalls, 1);
  assert.equal(context.getCurrentLastWorkWorkspaceScope(), branchScope);
  assert.equal(factory.archive.stageRunIds.hero, 'hero-run-recovered');
});

test('archive request fence rejects a changed PSD tab branch or authority token', () => {
  const source = sourceBetween(
    CORE,
    'function factoryWorkfileArchiveRequestIsCurrent(',
    'function factoryAdoptWorkfileArchiveStageRuns(',
  );
  const identity = {
    workspaceId: 'project-current',
    productKey: '양단호박바늘쌈',
    inputImageFingerprint: 'same-input-fingerprint',
  };
  let branchScope = 'draft:branch-a';
  let authority = { mode: 'editing', scopeId: branchScope, fencingToken: 31 };
  const context = {
    factoryCurrentWorkfileArchiveIdentity: () => identity,
    factoryRuntimeReadFactory: () => ({}),
    getCurrentLastWorkWorkspaceScope: () => branchScope,
    currentWorkspaceAuthority: () => authority,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.isCurrent = factoryWorkfileArchiveRequestIsCurrent;`, context);

  assert.equal(context.isCurrent(identity, 'draft:branch-a', 31), true);
  branchScope = 'draft:branch-b';
  assert.equal(context.isCurrent(identity, 'draft:branch-a', 31), false);
  branchScope = 'draft:branch-a';
  authority = { mode: 'editing', scopeId: branchScope, fencingToken: 32 };
  assert.equal(context.isCurrent(identity, 'draft:branch-a', 31), false);
});

test('explicit preview recovery imports only the most complete matching product archive', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryRecoverPreviewSectionsFromLocalArchive(',
    'function queueSectionContentLocalArchive(',
  );
  const restored = [];
  const state = {
    sectionImages: { size_color: '__stored_in_indexeddb__' },
    sectionContents: { size_color: { headline: '기존 색상옵션' } },
  };
  const list = [
    { archiveId: 'header-1', stageId: 'section_header', productKey: '모시바둑파우치', workspaceId: 'draft-a', inputImageFingerprint: 'image-a', files: { imagePath: 'header.png' }, savedAt: '2026-07-25T10:00:00Z' },
    { archiveId: 'hook-1', stageId: 'section_hook', productKey: '모시바둑파우치', workspaceId: 'draft-a', inputImageFingerprint: 'image-a', files: { imagePath: 'hook.png' }, savedAt: '2026-07-25T10:00:01Z' },
    { archiveId: 'header-old', stageId: 'section_header', productKey: '모시바둑파우치', workspaceId: 'draft-b', inputImageFingerprint: 'image-b', files: { imagePath: 'old.png' }, savedAt: '2026-07-24T10:00:00Z' },
    { archiveId: 'foreign', stageId: 'section_header', productKey: '다른제품', workspaceId: 'draft-c', inputImageFingerprint: 'image-c', files: { imagePath: 'foreign.png' }, savedAt: '2026-07-25T10:00:00Z' },
  ];
  const optionList = [
    { archiveId: 'options-latest', stageId: 'options', productKey: '모시바둑파우치', workspaceId: 'draft-a', inputImageFingerprint: 'image-a', files: { imagePath: 'options.png' }, savedAt: '2026-07-25T10:00:02Z' },
  ];
  const details = Object.fromEntries([...list, ...optionList].map(item => [item.archiveId, {
    ok: true,
    record: item,
    asset: { content: { headline: `${item.archiveId} headline` } },
    metadata: {},
  }]));
  const context = {
    URLSearchParams,
    Date,
    Map,
    state,
    assertRuntimeOperationContextCurrent() {},
    factoryRuntimeReadFactory: () => ({ product: { productName: '모시바둑파우치' } }),
    factoryLocalArchiveSearchProductName: () => '모시바둑파우치',
    factoryCurrentProductKey: () => '모시바둑파우치',
    factoryCurrentInputImageFingerprint: () => '',
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryBackendBaseUrl: () => 'http://archive.test',
    workspaceArchiveFetch: async url => ({
      ok: true,
      json: async () => {
        if (!url.includes('?')) return details[url.split('/').at(-1)];
        return { ok: true, assets: url.includes('stageId=options') ? optionList : list };
      },
    }),
    factorySectionIdFromLocalArchiveStage: stage => String(stage).replace(/^section_/, ''),
    factoryLocalArchiveItemHasImageFile: item => !!item?.files?.imagePath,
    orderedSections: () => [{ id: 'header' }, { id: 'hook' }, { id: 'size_color' }],
    displayableImageSrc: value => /^https?:/.test(String(value || '')) ? value : '',
    factoryLocalArchiveImageUrl: record => `http://archive.test/image/${record.archiveId}`,
    factoryImageOnlySectionContent: () => ({ headline: 'image only' }),
    applySectionContent(sectionId, content, image, sourceName) { restored.push({ sectionId, content, image, sourceName }); },
    savePersistentState() { state.persisted = true; },
    saveLastWorkNow() { state.saved = true; },
    render() { state.rendered = (state.rendered || 0) + 1; },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.recover = factoryRecoverPreviewSectionsFromLocalArchive;`, context);

  const outcome = await context.recover();

  assert.deepEqual(restored.map(item => item.sectionId), ['header', 'hook', 'size_color']);
  assert.deepEqual(restored.map(item => item.content.headline), ['header-1 headline', 'hook-1 headline', 'options-latest headline']);
  assert.equal(outcome.restored, 3);
  assert.equal(state.persisted, true);
  assert.equal(state.saved, true);
  assert.equal(state.previewArchiveRecovery.tone, 'ok');
});

test('registration-only preview recovery preserves current section copy without rendering or early persistence', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryRecoverPreviewSectionsFromLocalArchive(',
    'function queueSectionContentLocalArchive(',
  );
  const restored = [];
  const state = {
    sectionImages: { header: '__stored_in_indexeddb__' },
    sectionContents: { header: { headline: '현재 편집한 헤더', body_text: '현재 문구 유지' } },
  };
  let persisted = 0;
  let rendered = 0;
  const record = {
    archiveId: 'header-current-input',
    stageId: 'section_header',
    productKey: '모시꽃수파우치',
    workspaceId: 'older-project',
    inputImageFingerprint: 'same-input',
    files: { imagePath: 'header.jpg' },
  };
  const context = {
    URLSearchParams,
    Date,
    Map,
    state,
    assertRuntimeOperationContextCurrent() {},
    factoryRuntimeReadFactory: () => ({ product: { productName: '모시꽃수파우치' } }),
    factoryLocalArchiveSearchProductName: () => '모시꽃수파우치',
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => 'same-input',
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryBackendBaseUrl: () => 'http://archive.test',
    workspaceArchiveFetch: async url => ({
      ok: true,
      json: async () => url.includes('?')
        ? { ok: true, assets: [record] }
        : { ok: true, record, asset: {}, metadata: {} },
    }),
    factorySectionIdFromLocalArchiveStage: stage => String(stage).replace(/^section_/, ''),
    factoryLocalArchiveItemHasImageFile: item => !!item?.files?.imagePath,
    orderedSections: () => [{ id: 'header' }],
    displayableImageSrc: () => '',
    factoryLocalArchiveImageUrl: () => 'http://archive.test/image/header-current-input',
    factoryImageOnlySectionContent: () => ({ headline: '대체 문구' }),
    applySectionContent(sectionId, content, image) { restored.push({ sectionId, content, image }); },
    savePersistentState() { persisted += 1; },
    saveLastWorkNow() { persisted += 1; },
    render() { rendered += 1; },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.recover = factoryRecoverPreviewSectionsFromLocalArchive;`, context);

  const outcome = await context.recover({ render: false, persist: false });

  assert.equal(outcome.restored, 1);
  assert.equal(restored[0].content.headline, '현재 편집한 헤더');
  assert.equal(restored[0].content.body_text, '현재 문구 유지');
  assert.equal(persisted, 0);
  assert.equal(rendered, 0);
});

test('registration-only preview recovery does not overwrite a currently selected section image', async () => {
  const source = sourceBetween(
    CORE,
    'async function factoryRecoverPreviewSectionsFromLocalArchive(',
    'function queueSectionContentLocalArchive(',
  );
  const restored = [];
  const state = {
    sectionImages: { material_tech: 'http://archive.test/image/selected-a-cut' },
    sectionContents: { material_tech: { headline: '현재 선택 컷 유지' } },
  };
  const record = {
    archiveId: 'material-old',
    stageId: 'section_material_tech',
    productKey: '방울수저집',
    workspaceId: 'same-project',
    inputImageFingerprint: 'same-input',
    files: { imagePath: 'old.png' },
  };
  const context = {
    URLSearchParams,
    Date,
    Map,
    state,
    assertRuntimeOperationContextCurrent() {},
    factoryRuntimeReadFactory: () => ({ product: { productName: '방울수저집' } }),
    factoryLocalArchiveSearchProductName: () => '방울수저집',
    factoryCurrentProductKey: () => '방울수저집',
    factoryCurrentInputImageFingerprint: () => 'same-input',
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryBackendBaseUrl: () => 'http://archive.test',
    workspaceArchiveFetch: async url => ({
      ok: true,
      json: async () => url.includes('?')
        ? { ok: true, assets: [record] }
        : { ok: true, record, asset: {}, metadata: {} },
    }),
    factorySectionIdFromLocalArchiveStage: stage => String(stage).replace(/^section_/, ''),
    factoryLocalArchiveItemHasImageFile: item => !!item?.files?.imagePath,
    orderedSections: () => [{ id: 'material_tech' }],
    displayableImageSrc: value => /^https?:/.test(String(value || '')) ? value : '',
    factoryLocalArchiveImageUrl: () => 'http://archive.test/image/material-old',
    factoryImageOnlySectionContent: () => ({ headline: '대체 문구' }),
    applySectionContent(sectionId, content, image) { restored.push({ sectionId, content, image }); },
    savePersistentState() {},
    saveLastWorkNow() {},
    render() {},
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.recover = factoryRecoverPreviewSectionsFromLocalArchive;`, context);

  const outcome = await context.recover({ render: false, persist: false });

  assert.equal(outcome.restored, 0);
  assert.deepEqual(restored, []);
  assert.equal(state.sectionImages.material_tech, 'http://archive.test/image/selected-a-cut');
});

test('preview entry automatically recovers non-displayable stored section image markers', () => {
  assert.match(PREVIEW_MENU, /function snapshotNeedsArchiveImageRecovery\(/);
  assert.match(
    PREVIEW_MENU,
    /runCommand\(menuActions\.recoverPreviewArchiveSections,\s*undefined,\s*isCurrent\)/,
  );
});
