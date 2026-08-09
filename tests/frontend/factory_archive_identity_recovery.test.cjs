'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
const ASSET_CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const INPUT_CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const UPLOAD_MENU = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'upload-menu.mjs'), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = CORE.indexOf(startMarker);
  const end = CORE.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return CORE.slice(start, end);
}

function assetSourceSlice(startMarker, endMarker) {
  const start = ASSET_CORE.indexOf(startMarker);
  const end = ASSET_CORE.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing asset source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing asset source marker: ${endMarker}`);
  return ASSET_CORE.slice(start, end);
}

function inputSourceSlice(startMarker, endMarker) {
  const start = INPUT_CORE.indexOf(startMarker);
  const end = INPUT_CORE.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing input source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing input source marker: ${endMarker}`);
  return INPUT_CORE.slice(start, end);
}

function uploadMenuSourceSlice(startMarker, endMarker) {
  const start = UPLOAD_MENU.indexOf(startMarker);
  const end = UPLOAD_MENU.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing upload menu source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing upload menu source marker: ${endMarker}`);
  return UPLOAD_MENU.slice(start, end);
}

test('현재 입력 원본이 메모리에서 사라져도 같은 작업·상품의 최신 생성본 fingerprint를 복구한다', async () => {
  const helperSource = sourceSlice(
    'async function factoryInferCurrentArchiveInputFingerprint(',
    'function factoryLocalArchiveRefreshSignature(',
  );
  const bootstrapSource = sourceSlice(
    'async function factoryBootstrapCurrentWorkfileArchive(',
    'function factoryCurrentWorkfileArchiveScopes(',
  );
  assert.match(
    bootstrapSource,
    /!identity\.inputImageFingerprint \|\| !hasCurrentProductImage/,
  );
  const shouldBootstrapSource = sourceSlice(
    'function factoryShouldBootstrapCurrentWorkfileArchive(',
    'async function factoryBootstrapCurrentWorkfileArchiveInternal(',
  );
  assert.match(
    shouldBootstrapSource,
    /!factoryCurrentWorkfileArchiveScopes\(factory\)\.length \|\| !hasCurrentProductImage/,
  );
  const restoreSource = sourceSlice(
    'async function factoryRestoreCurrentWorkfileLocalArchive(',
    'async function factoryRestoreLocalArchiveToCurrentWork(',
  );
  assert.match(
    restoreSource,
    /hadCurrentProductImage[\s\S]*beforeIdentity\.inputImageFingerprint !== afterIdentity\.inputImageFingerprint/,
  );
  assert.match(
    restoreSource,
    /factoryEnsureSourceImagePart.*input/,
    'marker-only work must attempt input archive recovery before stage-only restoration',
  );
  const ensureSource = sourceSlice(
    'async function factoryEnsureSourceImagePart(',
    'async function factoryRestoreCurrentWorkfileLocalArchive(',
  );
  assert.match(
    ensureSource,
    /analysis: stageId === 'input'/,
    'input archive recovery must repopulate the analysis image list',
  );
  assert.match(
    ensureSource,
    /const applied = factoryApplyCommittedSourceImageComposition\([\s\S]*void render\(\)/,
    'committed input recovery must rerender the visible analysis image list',
  );
  assert.match(
    restoreSource,
    /const hasInlineCurrentProductImage = !!\([\s\S]*!hasInlineCurrentProductImage[\s\S]*factoryEnsureSourceImagePart\('input'/,
    'marker-only product images must trigger source recovery on startup restore',
  );
  const rows = [
    {
      archiveId: 'foreign',
      workspaceId: 'draft:other',
      productKey: '호박바늘꽂이',
      inputImageFingerprint: 'foreign-fingerprint',
      stageId: 'hero',
      savedAt: '2026-07-27T15:20:00Z',
    },
    {
      archiveId: 'older',
      workspaceId: 'draft:current',
      productKey: '호박바늘꽂이',
      inputImageFingerprint: 'old-fingerprint',
      stageId: 'hero',
      savedAt: '2026-07-27T14:00:00Z',
    },
    {
      archiveId: 'hero-new',
      workspaceId: 'draft:current',
      productKey: '호박바늘꽂이',
      inputImageFingerprint: 'current-fingerprint',
      stageId: 'hero',
      savedAt: '2026-07-27T15:12:46Z',
    },
    {
      archiveId: 'cuts-new',
      workspaceId: 'draft:current',
      productKey: '호박바늘꽂이',
      inputImageFingerprint: 'current-fingerprint',
      stageId: 'cuts',
      savedAt: '2026-07-27T15:15:34Z',
    },
  ];
  const context = vm.createContext({
    URLSearchParams,
    factoryBackendBaseUrl: () => 'http://archive.test',
    state: { backendBaseUrl: '' },
    workspaceArchiveFetch: async url => {
      assert.match(url, /workspaceId=draft%3Acurrent/);
      assert.match(url, /productKey=/);
      return { ok: true, json: async () => ({ ok: true, assets: rows }) };
    },
  });
  vm.runInContext(
    `${helperSource}\nthis.inferFingerprint = factoryInferCurrentArchiveInputFingerprint;`,
    context,
  );

  const result = await context.inferFingerprint({
    workspaceId: 'draft:current',
    productKey: '호박바늘꽂이',
  });

  assert.equal(result.inputImageFingerprint, 'current-fingerprint');
  assert.equal(result.assetCount, 2);
});

test('같은 상품의 다른 작업파일 결과도 목록에 제공하되 현재 원본 복원 범위와 분리한다', async () => {
  const helperSource = sourceSlice(
    'async function factoryFetchProductArchiveHistoryAssets(',
    'function factoryScheduleLocalArchiveAutoRefresh(',
  );
  const rows = [
    { archiveId: 'same-work', workspaceId: 'draft:current', productKey: '호박바늘꽂이' },
    { archiveId: 'other-work', workspaceId: 'draft:other', productKey: '호박바늘꽂이' },
    { archiveId: 'other-product', workspaceId: 'draft:current', productKey: '다른상품' },
  ];
  const context = vm.createContext({
    URLSearchParams,
    factoryCurrentWorkfileArchiveIdentity: () => ({
      workspaceId: 'draft:current',
      productKey: '호박바늘꽂이',
      inputImageFingerprint: 'current-fingerprint',
    }),
    factoryBackendBaseUrl: () => 'http://archive.test',
    state: { backendBaseUrl: '' },
    workspaceArchiveFetch: async url => {
      assert.match(url, /productKey=/);
      return { ok: true, json: async () => ({ ok: true, assets: rows }) };
    },
  });
  vm.runInContext(
    `${helperSource}\nthis.fetchHistory = factoryFetchProductArchiveHistoryAssets;`,
    context,
  );

  const result = await context.fetchHistory({});

  assert.equal(result.ok, true);
  assert.deepEqual(
    Array.from(result.assets, item => item.archiveId),
    ['same-work', 'other-work'],
  );
});

test('이미지 생성 또는 다른 공정 lease가 실행 중이면 로컬 아카이브 자동 새로고침은 끝난 뒤에만 실행한다', async () => {
  const deferSource = sourceSlice(
    'function factoryShouldDeferLocalArchiveAutoRefresh(',
    'function factoryScheduleLocalArchiveAutoRefresh(',
  );
  const scheduleSource = sourceSlice(
    'function factoryScheduleLocalArchiveAutoRefresh(',
    'function factoryRenderLocalArchivePanel(',
  );
  const timers = [];
  const factory = { archive: {} };
  let activeLease = true;
  let activeImageGeneration = false;
  let refreshCalls = 0;
  const context = vm.createContext({
    Date,
    state: { cuts: {} },
    FACTORY_LOCAL_ARCHIVE_REFRESHED_SIGNATURES: new Set(),
    factoryLocalArchiveAutoRefreshTimer: null,
    factoryLocalArchiveRefreshSignature: () => 'project:current|input:fingerprint',
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => ({ workspaceId: 'project:current' }),
      hasActiveOperationLease: () => activeLease,
    }),
    factoryRuntimeReadFactory: () => factory,
    factoryRuntimeIsOperationCurrent: () => true,
    factoryHasCurrentPageImageGenerationRun: () => activeImageGeneration,
    factoryRefreshLocalArchiveAssets: async () => { refreshCalls += 1; },
    factoryRenderLocalArchivePanel: () => {},
    setTimeout: callback => {
      timers.push(callback);
      return { id: timers.length };
    },
  });
  vm.runInContext(
    `${deferSource}\n${scheduleSource}\nthis.schedule = factoryScheduleLocalArchiveAutoRefresh;`,
    context,
  );

  context.schedule(factory);
  assert.equal(timers.length, 1);
  await timers.shift()();
  assert.equal(refreshCalls, 0, 'running operation must not start archive refresh');
  assert.equal(timers.length, 1, 'running operation must schedule one retry');

  activeLease = false;
  activeImageGeneration = true;
  await timers.shift()();
  assert.equal(refreshCalls, 0, 'active image generation must not start archive refresh');
  assert.equal(timers.length, 1, 'active image generation must schedule one retry');

  activeImageGeneration = false;
  await timers.shift()();
  assert.equal(refreshCalls, 1, 'refresh runs once after the operation settles');
});

test('현재 작업파일·상품·입력 원본이 같으면 유실된 stage run을 복원 대상으로 인정한다', () => {
  assert.match(ASSET_CORE, /function factoryLocalArchiveMatchesCurrentInput\(/);
  const restoreSource = sourceSlice(
    'function factoryLocalArchiveRestoreTargets(',
    'function factoryRestoreLocalArchiveAssetFast(',
  );
  assert.match(restoreSource, /factoryLocalArchiveMatchesCurrentInput\(item, factory\)/);
  const applySource = sourceSlice(
    'async function factoryRestoreLocalArchiveToCurrentWork(',
    'function sectionLocalArchiveStageId(',
  );
  assert.match(applySource, /const activeRunId =/);
  assert.match(applySource, /const restoredRunId = isLegacyDraftRecovery/);
  assert.match(applySource, /stage\.currentRunId = restoredRunId/);
  assert.match(applySource, /latest\.archive\.stageRunIds\[targetStageId\] = restoredRunId/);
  const fastRestoreSource = sourceSlice(
    'function factoryRestoreLocalArchiveAssetFast(',
    'function factoryCommitLocalArchivePreviewCopyStatus(',
  );
  assert.match(fastRestoreSource, /const activeRunId =/);
  assert.match(fastRestoreSource, /const currentRunId = String\(/);
  assert.match(fastRestoreSource, /isLegacyDraftRecovery \? \(activeRunId \|\| sourceRunId\)/);
});

test('명시적 복원은 같은 원본의 현재 marker와 이전 임시 작업 이미지만 현재 작업에 연결한다', () => {
  const matchSource = assetSourceSlice(
    'function factoryLocalArchiveMatchesCurrentProductInput(',
    'function factoryLocalArchiveMatchesCurrentWork(',
  );
  const targetsSource = sourceSlice(
    'function factoryLocalArchiveRestoreTargets(',
    'function factoryRestoreLocalArchiveAssetFast(',
  );
  const visualPayloadSource = sourceSlice(
    'function factoryAssetHasRestorableVisualPayload(',
    'function factoryLocalArchiveRestoreTargets(',
  );
  const applySource = sourceSlice(
    'async function factoryRestoreLocalArchiveToCurrentWork(',
    'function sectionLocalArchiveStageId(',
  );
  const factory = {
    workspace: { id: 'project:current' },
    product: { productName: '모시꽃수파우치' },
    archive: {
      linkedLegacyAssetIds: [],
      stageRunIds: {
        hero: 'hero-current-marker-without-pixels',
        cuts: 'cuts-current-marker-without-pixels',
      },
      localAssets: [
        {
          archiveId: 'current-size',
          workspaceId: 'project:current',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          stageId: 'size',
          currentRunId: 'size-current',
          imageUrl: '/archive/current-size',
        },
        {
          archiveId: 'legacy-hero',
          workspaceId: 'draft:lastwork_previous',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          stageId: 'hero',
          currentRunId: 'hero-legacy',
          imageUrl: '/archive/legacy-hero',
        },
        {
          archiveId: 'legacy-cuts',
          workspaceId: 'draft:lastwork_previous',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          stageId: 'cuts',
          currentRunId: 'cuts-legacy',
          imageUrl: '/archive/legacy-cuts',
        },
        {
          archiveId: 'other-project',
          workspaceId: 'project:other',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          stageId: 'hero',
          currentRunId: 'other-run',
          imageUrl: '/archive/other-project',
        },
        {
          archiveId: 'different-input',
          workspaceId: 'draft:lastwork_previous',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'different-image',
          stageId: 'hero',
          currentRunId: 'wrong-image',
          imageUrl: '/archive/different-input',
        },
      ],
    },
    assets: [
      { stageId: 'hero', image: '__stored_in_indexeddb__', metadata: { localArchiveId: 'legacy-hero' } },
      { stageId: 'cuts', result: '__stored_in_indexeddb__', sourceMap: { localArchiveId: 'legacy-cuts' } },
      { stageId: 'size', metadata: { localArchiveId: 'current-size' } },
    ],
  };
  const context = vm.createContext({
    state: { currentProjectId: 'project:current', productName: '모시꽃수파우치' },
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentWorkspaceId: target => target.workspace.id,
    factoryCurrentProductIdentityMeta: () => ({ productName: '모시꽃수파우치' }),
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => 'same-image',
    factoryImageFingerprintLooksUsable: value => !!value,
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\s+/g, '').toLowerCase(),
    factoryLocalArchiveRestoreStageRank: () => 0,
    factoryLocalArchiveItemLooksLikeDetailDocument: () => false,
    factoryLocalArchiveItemHasImageFile: item => !!item.imageUrl,
  });
  vm.runInContext(
    `${matchSource}\n${visualPayloadSource}\n${targetsSource}\nthis.matches = factoryLocalArchiveMatchesCurrentInput;\nthis.recoverable = factoryLocalArchiveCanRecoverLegacyDraftInput;\nthis.targets = factoryLocalArchiveRestoreTargets;`,
    context,
  );

  const legacyHero = factory.archive.localAssets.find(item => item.archiveId === 'legacy-hero');
  const otherProject = factory.archive.localAssets.find(item => item.archiveId === 'other-project');
  assert.equal(context.matches(legacyHero, factory), false, 'unlinked draft asset must not appear as current work');
  assert.equal(context.recoverable(legacyHero, factory), true, 'exact same input legacy draft may be explicitly recovered');
  assert.equal(context.recoverable(otherProject, factory), false, 'another saved project must never become a recovery target');
  assert.deepEqual(
    Array.from(context.targets(factory), item => item.archiveId).sort(),
    ['current-size', 'legacy-cuts', 'legacy-hero'],
    'manual recovery selects the current marker replacement and missing matching legacy stages',
  );

  factory.archive.linkedLegacyAssetIds = ['legacy-hero'];
  assert.equal(context.matches(legacyHero, factory), true, 'the explicit link survives future current-work matching');
  assert.match(applySource, /linkedLegacyAssetIds/, 'successful recovery persists its exact archive ID on the workfile');
});

test('현재 작업의 marker-only 사이즈 자산은 같은 보관 이미지로 다시 복원한다', () => {
  const matchSource = assetSourceSlice(
    'function factoryLocalArchiveMatchesCurrentProductInput(',
    'function factoryLocalArchiveMatchesCurrentWork(',
  );
  const visualPayloadSource = sourceSlice(
    'function factoryAssetHasRestorableVisualPayload(',
    'function factoryLocalArchiveRestoreTargets(',
  );
  const targetsSource = sourceSlice(
    'function factoryLocalArchiveRestoreTargets(',
    'function factoryRestoreLocalArchiveAssetFast(',
  );
  const factory = {
    workspace: { id: 'project:current' },
    product: { productName: '모시꽃수파우치' },
    archive: {
      stageRunIds: { size: 'size-current' },
      localAssets: [{
        archiveId: 'current-size',
        workspaceId: 'project:current',
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'same-image',
        stageId: 'size',
        currentRunId: 'size-current',
        imageUrl: '/archive/current-size',
      }],
    },
    assets: [{
      stageId: 'size',
      image: '__stored_in_indexeddb__',
      metadata: { localArchiveId: 'current-size' },
    }],
  };
  const context = vm.createContext({
    state: { currentProjectId: 'project:current', productName: '모시꽃수파우치' },
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentWorkspaceId: target => target.workspace.id,
    factoryCurrentProductIdentityMeta: () => ({ productName: '모시꽃수파우치' }),
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => 'same-image',
    factoryImageFingerprintLooksUsable: value => !!value,
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\s+/g, '').toLowerCase(),
    factoryLocalArchiveRestoreStageRank: () => 0,
    factoryLocalArchiveItemLooksLikeDetailDocument: () => false,
    factoryLocalArchiveItemHasImageFile: item => !!item.imageUrl,
  });
  vm.runInContext(
    `${matchSource}\n${visualPayloadSource}\n${targetsSource}\nthis.targets = factoryLocalArchiveRestoreTargets;`,
    context,
  );

  assert.deepEqual(
    Array.from(context.targets(factory), item => item.archiveId),
    ['current-size'],
    'marker-only asset must not suppress the archive image that replaces it',
  );

  factory.assets[0].image = '';
  factory.assets[0].imageUrl = '/archive/current-size';
  assert.deepEqual(
    Array.from(context.targets(factory), item => item.archiveId),
    [],
    'a displayable local archive URL must still prevent a duplicate restore',
  );
});

test('marker-only 후보 복원은 기존 후보 ID를 유지하고 중복 자산을 등록하지 않는다', () => {
  const fastRestoreSource = sourceSlice(
    'function factoryRestoreLocalArchiveAssetFast(',
    'function factoryCommitLocalArchivePreviewCopyStatus(',
  );
  const existing = {
    id: 'saved-hero-candidate',
    stageId: 'hero',
    image: '__stored_in_indexeddb__',
    imageUrl: '',
    metadata: { localArchiveId: 'hero-archive' },
    sourceMap: { localArchiveId: 'hero-archive' },
  };
  const factory = {
    workspace: { id: 'project:current' },
    product: { productName: '모시꽃수파우치' },
    assets: [existing],
    stages: { hero: { selectedAssetIds: ['saved-hero-candidate'] } },
  };
  let registerCalls = 0;
  const context = vm.createContext({
    state: { productName: '모시꽃수파우치' },
    factorySectionIdFromLocalArchiveStage: () => '',
    factoryLocalArchiveImageUrl: item => item.imageUrl,
    factoryLocalArchiveItemLooksLikeDetailDocument: () => false,
    factoryCurrentProductIdentityMeta: () => ({ productName: '모시꽃수파우치' }),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryCurrentInputImageFingerprint: () => 'same-image',
    factoryLocalArchiveCanRecoverLegacyDraftInput: () => false,
    factoryCurrentWorkflowRunId: () => 'work-run-current',
    factoryCurrentStageRunId: () => 'hero-run-current',
    factoryLocalArchiveSessionRunId: () => '',
    factoryCurrentWorkspaceId: () => 'project:current',
    factoryNormalizeStageScope: value => value,
    factoryApplyLocalArchiveImageReference: (asset, ref) => {
      asset.archiveId = ref.archiveId;
      asset.imageUrl = ref.imageUrl;
      asset.imagePersistence = 'local-archive-url';
      asset.hasImage = true;
      asset.localArchive = { saved: true, archiveId: ref.archiveId, imageUrl: ref.imageUrl };
      asset.metadata = { ...(asset.metadata || {}), localArchiveId: ref.archiveId };
      asset.sourceMap = { ...(asset.sourceMap || {}), localArchiveId: ref.archiveId };
      return asset;
    },
    factoryRegisterAsset: () => {
      registerCalls += 1;
      return { id: 'unexpected-duplicate' };
    },
    factoryUsableAssetsForStage: () => [],
    uniqueApiKeys: values => [...new Set(values)],
  });
  vm.runInContext(
    `${fastRestoreSource}\nthis.restoreFast = factoryRestoreLocalArchiveAssetFast;`,
    context,
  );

  const restored = context.restoreFast({
    archiveId: 'hero-archive',
    stageId: 'hero',
    imageUrl: '/api/local-archive/assets/hero-archive/image',
    productKey: '모시꽃수파우치',
    workspaceId: 'project:current',
    currentRunId: 'hero-run-current',
  }, factory);

  assert.equal(restored, true);
  assert.equal(registerCalls, 0);
  assert.equal(factory.assets.length, 1);
  assert.equal(factory.assets[0].id, 'saved-hero-candidate');
  assert.equal(factory.assets[0].imageUrl, '/api/local-archive/assets/hero-archive/image');
});

test('같은 archive를 공유하는 후보 복원은 정확한 후보 ID에만 원본을 연결한다', () => {
  const fastRestoreSource = sourceSlice(
    'function factoryRestoreLocalArchiveAssetFast(',
    'function factoryCommitLocalArchivePreviewCopyStatus(',
  );
  const first = {
    id: 'saved-hero-first',
    stageId: 'hero',
    image: '__stored_in_indexeddb__',
    imageUrl: '',
    metadata: { localArchiveId: 'shared-hero-archive' },
    sourceMap: { localArchiveId: 'shared-hero-archive' },
  };
  const second = {
    id: 'saved-hero-second',
    stageId: 'hero',
    image: '__stored_in_indexeddb__',
    imageUrl: '',
    metadata: { localArchiveId: 'shared-hero-archive' },
    sourceMap: { localArchiveId: 'shared-hero-archive' },
  };
  const factory = {
    workspace: { id: 'project:current' },
    product: { productName: '모시꽃수파우치' },
    assets: [first, second],
    stages: { hero: { selectedAssetIds: ['saved-hero-first', 'saved-hero-second'] } },
  };
  const context = vm.createContext({
    state: { productName: '모시꽃수파우치' },
    factorySectionIdFromLocalArchiveStage: () => '',
    factoryLocalArchiveImageUrl: item => item.imageUrl,
    factoryLocalArchiveItemLooksLikeDetailDocument: () => false,
    factoryCurrentProductIdentityMeta: () => ({ productName: '모시꽃수파우치' }),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryCurrentInputImageFingerprint: () => 'same-image',
    factoryLocalArchiveCanRecoverLegacyDraftInput: () => false,
    factoryCurrentWorkflowRunId: () => 'work-run-current',
    factoryCurrentStageRunId: () => 'hero-run-current',
    factoryLocalArchiveSessionRunId: () => '',
    factoryCurrentWorkspaceId: () => 'project:current',
    factoryNormalizeStageScope: value => value,
    factoryApplyLocalArchiveImageReference: (asset, ref) => {
      asset.archiveId = ref.archiveId;
      asset.imageUrl = ref.imageUrl;
      return asset;
    },
    factoryRegisterAsset: () => ({ id: 'unexpected-duplicate' }),
    factoryUsableAssetsForStage: () => [],
    uniqueApiKeys: values => [...new Set(values)],
  });
  vm.runInContext(
    `${fastRestoreSource}\nthis.restoreFast = factoryRestoreLocalArchiveAssetFast;`,
    context,
  );

  assert.equal(context.restoreFast({
    assetId: 'saved-hero-second',
    archiveId: 'shared-hero-archive',
    stageId: 'hero',
    imageUrl: '/api/local-archive/assets/shared-hero-archive/image',
    productKey: '모시꽃수파우치',
    workspaceId: 'project:current',
    currentRunId: 'hero-run-current',
  }, factory), true);
  assert.equal(first.imageUrl, '');
  assert.equal(second.imageUrl, '/api/local-archive/assets/shared-hero-archive/image');
});

test('현재 작업 범위와 맞지 않는 이미지컷 자산은 같은 원본의 이전 컷 복원을 막지 않는다', () => {
  const matchSource = assetSourceSlice(
    'function factoryLocalArchiveMatchesCurrentProductInput(',
    'function factoryLocalArchiveMatchesCurrentWork(',
  );
  const visualPayloadSource = sourceSlice(
    'function factoryAssetHasRestorableVisualPayload(',
    'function factoryLocalArchiveRestoreTargets(',
  );
  const targetsSource = sourceSlice(
    'function factoryLocalArchiveRestoreTargets(',
    'function factoryRestoreLocalArchiveAssetFast(',
  );
  const factory = {
    workspace: { id: 'project:current' },
    product: { productName: '모시꽃수파우치' },
    stages: { cuts: { currentRunId: 'cuts-current' } },
    archive: {
      stageRunIds: { cuts: 'cuts-current' },
      localAssets: [{
        archiveId: 'legacy-cuts',
        workspaceId: 'draft:lastwork_previous',
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'same-image',
        stageId: 'cuts',
        currentRunId: 'cuts-legacy',
        imageUrl: '/archive/legacy-cuts',
      }],
    },
    assets: [{
      stageId: 'cuts',
      imageUrl: '/archive/stale-cuts',
      metadata: {
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'same-image',
        currentRunId: 'cuts-stale',
      },
    }],
  };
  const context = vm.createContext({
    state: { currentProjectId: 'project:current', productName: '모시꽃수파우치' },
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentWorkspaceId: target => target.workspace.id,
    factoryCurrentProductIdentityMeta: () => ({ productName: '모시꽃수파우치' }),
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => 'same-image',
    factoryCurrentStageRunId: stageId => factory.stages?.[stageId]?.currentRunId || '',
    factoryImageFingerprintLooksUsable: value => !!value,
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\s+/g, '').toLowerCase(),
    factoryLocalArchiveRestoreStageRank: () => 0,
    factoryLocalArchiveItemLooksLikeDetailDocument: () => false,
    factoryLocalArchiveItemHasImageFile: item => !!item.imageUrl,
    factoryAssetHasCurrentProductPayload: asset => asset?.metadata?.currentRunId === 'cuts-current',
  });
  vm.runInContext(
    `${matchSource}\n${visualPayloadSource}\n${targetsSource}\nthis.targets = factoryLocalArchiveRestoreTargets;`,
    context,
  );

  assert.deepEqual(
    Array.from(context.targets(factory), item => item.archiveId),
    ['legacy-cuts'],
    'stale current-scope marker must not suppress the matching legacy cut recovery',
  );
});

test('상품명이 바뀌어도 동일한 입력 이미지 지문이면 원본 입력 아카이브를 복원 후보로 인정한다', () => {
  const productInputSource = assetSourceSlice(
    'function factoryLocalArchiveMatchesCurrentProductInput(',
    'function factoryLocalArchiveCanRecoverLegacyDraftInput(',
  );
  const restoreIdentitySource = sourceSlice(
    'function factoryInputArchiveItemMatchesRestoreIdentity(',
    'async function factoryFetchCurrentInputArchiveCandidates(',
  );
  const factory = {
    product: { productName: '모시꽃수파우치' },
  };
  const legacyInput = {
    archiveId: 'legacy-input',
    stageId: 'input',
    productName: '제품명 미정',
    productKey: '제품명 미정',
    inputImageFingerprint: 'same-image',
    files: { imagePath: 'C:/archive/image.jpg' },
  };
  const context = vm.createContext({
    state: { productName: '모시꽃수파우치' },
    factoryCurrentProductIdentityMeta: () => ({ productName: '모시꽃수파우치' }),
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => 'same-image',
    factoryImageFingerprintLooksUsable: value => !!value,
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\\s+/g, '').toLowerCase(),
    factoryLocalArchiveItemHasImageFile: item => !!item.files?.imagePath,
  });
  vm.runInContext(
    productInputSource + '\n' + restoreIdentitySource + '\nthis.matchesProduct = factoryLocalArchiveMatchesCurrentProductInput;\nthis.matchesRestore = factoryInputArchiveItemMatchesRestoreIdentity;',
    context,
  );

  assert.equal(
    context.matchesProduct(legacyInput, factory),
    true,
    'the exact image fingerprint is stronger than a stale placeholder product name',
  );
  assert.equal(
    context.matchesRestore(legacyInput, {
      currentKey: '모시꽃수파우치',
      currentNameKey: '모시꽃수파우치',
      expectedFingerprint: 'same-image',
      expectedUsable: true,
    }),
    true,
    'candidate discovery must keep the same-image archive even when its old name is 제품명 미정',
  );
});

test('실제 payload 지문이 같은 유일한 input 아카이브는 예전 상품명과 run metadata여도 복원한다', async () => {
  const identitySource = sourceSlice(
    'function factoryInputArchiveIdentityForRestore(',
    'function factoryInputArchiveItemMatchesRestoreIdentity(',
  );
  const matchSource = sourceSlice(
    'function factoryInputArchiveItemMatchesRestoreIdentity(',
    'function factoryInputArchiveRestoreScore(',
  );
  const scoreSource = sourceSlice(
    'function factoryInputArchiveRestoreScore(',
    'async function factoryFetchCurrentInputArchiveCandidates(',
  );
  const fetchSource = sourceSlice(
    'async function factoryFetchCurrentInputArchiveCandidates(',
    'async function factoryCurrentInputArchiveSourcePart(',
  );
  const currentSource = sourceSlice(
    'async function factoryCurrentInputArchiveSourcePart(',
    'function factoryLocalArchiveSourceScore(',
  );
  const exactFingerprint = 'fixture-fingerprint-exact';
  const inputRow = {
    archiveId: 'legacy-placeholder-input',
    assetKind: 'input',
    stageId: 'input',
    productName: '제품명 미정',
    productKey: '',
    currentRunId: 'old-run',
    inputImageFingerprint: exactFingerprint,
    files: { imagePath: 'legacy-input.jpg' },
  };
  const factory = {
    product: {
      productName: '모시꽃수파우치',
      currentRunId: 'current-run',
      inputImageFingerprint: exactFingerprint,
    },
  };
  let broadCompatibilityChecks = 0;
  const context = vm.createContext({
    state: { backendBaseUrl: 'http://127.0.0.1:5050', productName: '모시꽃수파우치' },
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentRestoreIdentityText: () => '모시꽃수파우치',
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => exactFingerprint,
    factoryImageFingerprintLooksUsable: value => !!value,
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\s+/g, '').toLowerCase(),
    factoryLocalArchiveItemHasImageFile: item => !!item.files?.imagePath,
    workspaceArchiveFetch: async () => ({ ok: true, json: async () => ({ assets: [inputRow] }) }),
    factoryLocalArchiveAssetImagePart: async () => ({
      base64: 'verified-current-input-payload',
      mime: 'image/jpeg',
      productName: inputRow.productName,
      productKey: inputRow.productKey,
      currentRunId: inputRow.currentRunId,
      inputImageFingerprint: exactFingerprint,
    }),
    factoryImagePayloadFingerprint: () => exactFingerprint,
    factoryCanAcceptRestoredSourceForCurrentProduct: () => {
      broadCompatibilityChecks += 1;
      return false;
    },
  });
  vm.runInContext(
    `${identitySource}\n${matchSource}\n${scoreSource}\n${fetchSource}\n${currentSource}\nthis.currentPart = factoryCurrentInputArchiveSourcePart;`,
    context,
  );

  const restored = await context.currentPart('input', factory);
  assert.equal(restored?.archiveItem?.archiveId, inputRow.archiveId, 'the one exact-payload input archive must restore despite stale placeholder metadata');
  assert.equal(broadCompatibilityChecks, 0, 'validated exact input payload must not be rejected by the broader run/name compatibility guard');
});

test('입력 원본 복구는 exact fingerprint 조회를 우선하고 다중 input 후보를 거절한다', async () => {
  const identitySource = sourceSlice(
    'function factoryInputArchiveIdentityForRestore(',
    'function factoryInputArchiveItemMatchesRestoreIdentity(',
  );
  const matchSource = sourceSlice(
    'function factoryInputArchiveItemMatchesRestoreIdentity(',
    'function factoryInputArchiveRestoreScore(',
  );
  const scoreSource = sourceSlice(
    'function factoryInputArchiveRestoreScore(',
    'async function factoryFetchCurrentInputArchiveCandidates(',
  );
  const fetchSource = sourceSlice(
    'async function factoryFetchCurrentInputArchiveCandidates(',
    'async function factoryCurrentInputArchiveSourcePart(',
  );
  const currentSource = sourceSlice(
    'async function factoryCurrentInputArchiveSourcePart(',
    'function factoryLocalArchiveSourceScore(',
  );
  const urls = [];
  const exactFingerprint = 'fixture-fingerprint-exact';
  const inputRows = [
    { archiveId: 'input-one', assetKind: 'input', stageId: 'input', inputImageFingerprint: exactFingerprint, files: { imagePath: 'one.jpg' } },
    { archiveId: 'input-two', assetKind: 'input', stageId: 'input', inputImageFingerprint: exactFingerprint, files: { imagePath: 'two.jpg' } },
  ];
  const factory = { product: { inputImageFingerprint: exactFingerprint, productName: '모시꽃수파우치' } };
  const context = vm.createContext({
    state: { backendBaseUrl: 'http://127.0.0.1:5050', productName: '모시꽃수파우치' },
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentRestoreIdentityText: () => '모시꽃수파우치',
    factoryCurrentProductKey: () => '모시꽃수파우치',
    factoryCurrentInputImageFingerprint: () => exactFingerprint,
    factoryImageFingerprintLooksUsable: value => !!value,
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\s+/g, '').toLowerCase(),
    factoryLocalArchiveItemHasImageFile: item => !!item.files?.imagePath,
    workspaceArchiveFetch: async url => {
      urls.push(url);
      return { ok: true, json: async () => ({ assets: inputRows }) };
    },
    factoryLocalArchiveAssetImagePart: async () => ({ base64: 'dGVzdA==', mime: 'image/png' }),
    factoryImagePayloadFingerprint: () => exactFingerprint,
    factoryCanAcceptRestoredSourceForCurrentProduct: () => true,
  });
  vm.runInContext(
    `${identitySource}\n${matchSource}\n${scoreSource}\n${fetchSource}\n${currentSource}\nthis.fetchCandidates = factoryFetchCurrentInputArchiveCandidates; this.currentPart = factoryCurrentInputArchiveSourcePart;`,
    context,
  );
  const candidates = await context.fetchCandidates(factory);
  assert.match(urls[0], /inputImageFingerprint=fixture-fingerprint-exact/);
  assert.equal(candidates.length, 2);
  assert.equal(await context.currentPart('input', factory), null, 'ambiguous exact input candidates must not choose an arbitrary image');
});

test('marker-only 분석 이미지의 입력 지문을 새로고침 복원 identity에 유지한다', () => {
  const lockSource = inputSourceSlice(
    'function factoryLockedInputImageFingerprint(',
    'function factoryLockedInputImagePayload(',
  );
  const context = vm.createContext({
    state: {
      analysisImages: [{
        preview: '__stored_in_indexeddb__',
        inputImageFingerprint: 'same-image',
      }],
    },
    factoryLockedInputImageCandidateRows: () => [],
    factoryLockedInputPayloadFromRow: () => null,
    factoryImagePayloadFingerprint: () => '',
  });
  vm.runInContext(
    `${lockSource}\nthis.read = factoryLockedInputImageFingerprint;`,
    context,
  );
  assert.equal(
    context.read({ product: {} }, { analysisImages: context.state.analysisImages }),
    'same-image',
    'marker-only image metadata must keep the exact input fingerprint for archive recovery',
  );
});

test('저장소 마커는 분석 썸네일에 빈 이미지 카드로 렌더하지 않는다', () => {
  const imageSource = assetSourceSlice(
    'function analysisImageSrc(',
    'function imageAnalysisWorkflowSteps(',
  );
  assert.match(
    imageSource,
    /ref\?\.preview && ref\.preview !== '__stored_in_indexeddb__'/,
    'indexeddb marker must not be treated as a visible image URL',
  );
  const contextSource = assetSourceSlice(
    'const analysisThumbs = (state.analysisImages || [])',
    '  return `<div',
  );
  assert.match(
    contextSource,
    /displayableImageSrc\(item\.src\)/,
    'analysis thumbnails must omit sources that the renderer cannot display',
  );
});

test('업로드 메뉴는 표시 불가능한 분석 이미지 레코드를 빈 카드로 만들지 않는다', () => {
  const uploadSource = uploadMenuSourceSlice(
    'function renderUploadView(view, helpers) {',
    '\n}\n',
  );
  assert.match(
    uploadSource,
    /const visibleImages = \(Array\.isArray\(view\.analysisImages\)/,
    'upload menu must derive cards from visible image sources rather than raw records',
  );
  assert.match(
    uploadSource,
    /\.filter\(item => item\.html\)/,
    'upload menu must omit records whose renderer returns no image markup',
  );
});

test('로컬 아카이브 복원 중 store revision 경합은 정확히 한 번만 다시 시도한다', async () => {
  const restoreSource = sourceSlice(
    'async function factoryRestoreCurrentWorkfileLocalArchive(',
    'async function factoryRestoreLocalArchiveToCurrentWork(',
  );
  assert.match(restoreSource, /STALE_FACTORY_STORE_REVISION/);
  assert.match(restoreSource, /options\.staleRevisionRetry !== true/);

  let refreshCalls = 0;
  let alwaysStale = false;
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => ({ id: 'factory-current' }),
    factoryCurrentWorkfileArchiveIdentity: () => ({
      workspaceId: 'draft:current',
      productKey: '호박바늘꽂이',
      inputImageFingerprint: 'current-fingerprint',
    }),
    factoryFindAvailableProductImage: () => true,
    factoryBootstrapCurrentWorkfileArchive: async () => ({ ok: true }),
    factoryRefreshLocalArchiveAssets: async () => {
      refreshCalls += 1;
      if (alwaysStale || refreshCalls === 1) {
        throw new Error('STALE_FACTORY_STORE_REVISION: expected 3, current 4');
      }
    },
    factoryCurrentWorkfileArchiveScopes: () => [{ workspaceId: 'draft:current' }],
    factoryRestoreLocalArchiveToCurrentWork: async () => ({
      ok: true,
      restored: 6,
      total: 6,
    }),
  });
  vm.runInContext(
    `${restoreSource}\nthis.restoreCurrentArchive = factoryRestoreCurrentWorkfileLocalArchive;`,
    context,
  );

  const restored = await context.restoreCurrentArchive({ silent: true });
  assert.equal(restored.ok, true);
  assert.equal(restored.restored, 6);
  assert.equal(refreshCalls, 2);

  refreshCalls = 0;
  alwaysStale = true;
  await assert.rejects(
    context.restoreCurrentArchive({ silent: true }),
    /STALE_FACTORY_STORE_REVISION/,
  );
  assert.equal(refreshCalls, 2);
});
