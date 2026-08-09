'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function restoredCompletionReconciler(globals = {}) {
  const context = vm.createContext({ ...globals });
  const functionSource = sourceSlice(
    source('src/app-core-03.js'),
    'function factoryReconcileRestoredCompletionState(',
    'function normalizeFactoryState(',
  );
  vm.runInContext(`${functionSource}
globalThis.reconcile = factoryReconcileRestoredCompletionState;`, context);
  return context.reconcile;
}

function cutsSourceRestoreHelper(globals = {}) {
  const context = vm.createContext({
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
    ...globals,
  });
  const functionSource = sourceSlice(
    source('src/app-core-02.js'),
    'function restoreCutsSourceFromCurrentProductImage(',
    'function applySessionAssetsPayload(',
  );
  vm.runInContext(`${functionSource}
globalThis.restoreCutsSource = restoreCutsSourceFromCurrentProductImage;`, context);
  return context.restoreCutsSource;
}

function productImageBackupScopeRuntime(globals = {}) {
  const persistenceSource = source('src/app-core-02.js');
  const context = vm.createContext({
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
    LAST_PRODUCT_IMAGE_BACKUP_ID: 'lastProductImageBackup',
    WORKSPACE_DB: { appSettings: 'appSettings' },
    workspaceBlankResetInProgress: false,
    workspaceBlankResetToken: 0,
    workspaceHydrationScopeIsCurrent: () => true,
    getCurrentLastWorkWorkspaceScope: () => 'draft:test',
    workspacePersistenceApi: () => ({
      normalizeWorkspaceScope(value) {
        const raw = String(value?.id ?? value ?? '').trim();
        return /^(?:project|draft):/i.test(raw) ? raw : `draft:${raw || 'test'}`;
      },
    }),
    ...globals,
  });
  const backupItemSource = sourceSlice(
    persistenceSource,
    'function productImageBackupItem(',
    'function compactProductImageBackupItem(',
  );
  const backupScopeSource = sourceSlice(
    persistenceSource,
    'function lastProductImageBackupStorageId(',
    'function compactProductImageBackupPayload(',
  );
  const conflictSource = sourceSlice(
    persistenceSource,
    'function productImageBackupConflictsWithCurrentWork(',
    'function applyProductImageBackupPayload(',
  );
  const applySource = sourceSlice(
    persistenceSource,
    'function applyProductImageBackupPayload(',
    'async function saveLastProductImageBackupToDbIfChanged(',
  );
  const hydrateSource = sourceSlice(
    persistenceSource,
    'async function hydrateLastProductImageBackup(',
    'const LOCAL_SESSION_MAX_CHARS',
  );
  const currentPayloadSource = sourceSlice(
    persistenceSource,
    'function currentProductImageBackupPayload(',
    'function productImageBackupFingerprint(',
  );
  vm.runInContext(
    `${backupItemSource}\n${backupScopeSource}\n${currentPayloadSource}\n${conflictSource}\n${applySource}\n${hydrateSource}\n`
      + 'globalThis.currentPayload = currentProductImageBackupPayload;\n'
      + 'globalThis.hydrateBackup = hydrateLastProductImageBackup;',
    context,
  );
  return context;
}

function goalRunStatusClassifiers() {
  const context = vm.createContext({});
  const functionSource = sourceSlice(
    source('src/app-core-05.js'),
    'function factoryGoalRunNeedsAttention(',
    'function factoryGoalRunDisplayProgress(',
  );
  vm.runInContext(`${functionSource}
globalThis.needsAttention = factoryGoalRunNeedsAttention;
globalThis.hasFailure = factoryGoalRunHasFailure;`, context);
  return context;
}

test('Given restored cut results without their source When the current product image exists Then only the missing source is reattached', () => {
  // Given: the workfile retained generated results, but its large source payload was stripped.
  const cuts = {
    sourceBase64: null,
    sourcePreview: null,
    hasSourceImage: true,
    sizeFactoryStageId: 'size',
    prompts: [{ result: '/api/local-archive/images/cut-1.png' }],
    sizePrompts: [{ result: '/api/local-archive/images/size-1.png' }],
  };
  const restore = cutsSourceRestoreHelper({
    state: {
      imageBase64: 'iVBORw0KGgoAAA',
      imageMime: 'image/png',
      imagePreview: 'data:image/png;base64,iVBORw0KGgoAAA',
      imageName: '현재상품.png',
      analysisImages: [],
    },
  });

  // When: the restore boundary reconciles image-cut input continuity.
  const changed = restore(cuts, { product: {} });

  // Then: the canonical current-product image unlocks both cut stages without touching results.
  assert.equal(changed, true);
  assert.equal(cuts.sourceBase64, 'iVBORw0KGgoAAA');
  assert.equal(cuts.sourcePreview, 'data:image/png;base64,iVBORw0KGgoAAA');
  assert.equal(cuts.workImageBase64, 'iVBORw0KGgoAAA');
  assert.equal(cuts.prompts[0].result, '/api/local-archive/images/cut-1.png');
  assert.equal(cuts.sizePrompts[0].result, '/api/local-archive/images/size-1.png');
});

test('Given an explicit image-cut source When restoring Then the current product image never overwrites it', () => {
  // Given: the user explicitly chose a different source for image-cut work.
  const cuts = {
    sourceBase64: 'EXPLICIT_SOURCE',
    sourceMime: 'image/jpeg',
    sourcePreview: 'data:image/jpeg;base64,EXPLICIT_SOURCE',
    prompts: [{ result: '/api/local-archive/images/cut-1.png' }],
  };
  const restore = cutsSourceRestoreHelper({
    state: {
      imageBase64: 'CURRENT_PRODUCT',
      imageMime: 'image/png',
      imagePreview: 'data:image/png;base64,CURRENT_PRODUCT',
      analysisImages: [],
    },
  });

  // When: restore reconciliation runs.
  const changed = restore(cuts, { product: {} });

  // Then: explicit user state remains authoritative.
  assert.equal(changed, false);
  assert.equal(cuts.sourceBase64, 'EXPLICIT_SOURCE');
  assert.equal(cuts.sourceMime, 'image/jpeg');
});

test('Given a foreign automatic product backup When a different blank workspace starts Then it never reads or applies that backup', async () => {
  // Given: work A saved its image, while work B has no product/image yet.
  const foreignBackup = {
    id: 'lastProductImageBackup',
    productName: '롱카드지갑',
    primary: { source: 'app', base64: 'FOREIGN_IMAGE', mime: 'image/png', name: 'long-card.png' },
  };
  const state = { productName: '', imageBase64: '', imagePreview: '', imageMime: '', imageName: '', analysisImages: [], cuts: {} };
  const factory = { product: {} };
  const requestedKeys = [];
  const runtime = productImageBackupScopeRuntime({
    state,
    cloneData: value => value,
    normalizeFactoryState: value => value,
    factoryRuntimeReadFactory: () => factory,
    factoryRuntimeReplaceFactorySnapshot: () => {},
    factorySetCurrentProductIdentity: value => { state.productName = value; },
    restoreCutsSourceFromCurrentProductImage: () => false,
    ensureCompMarketScrapeState: () => ({}),
    displayableImageSrc: value => String(value || '').startsWith('data:image/'),
    lastWorkIdentityKeysCompatible: () => false,
    productImageBackupFingerprint: () => '',
    uid: prefix => `${prefix}_id`,
    getCurrentLastWorkWorkspaceScope: () => 'project:work-b',
    workspaceGet: async (_store, key) => {
      requestedKeys.push(key);
      return key === 'lastProductImageBackup' ? foreignBackup : null;
    },
  });

  // When: the automatic startup backup hydrate runs in work B.
  const changed = await runtime.hydrateBackup({ restoreInline: true, syncMarket: false });

  // Then: work B looks up only its own scoped record and remains empty.
  assert.equal(changed, false);
  assert.equal(state.productName, '');
  assert.equal(state.imageBase64, '');
  assert.equal(factory.product.imageBase64 || '', '');
  assert.deepEqual(requestedKeys, ['lastProductImageBackup:project:work-b']);
});

test('Given an automatic image backup in a workspace When it is saved Then its id and payload retain that workspace scope', () => {
  // Given: active work B has a product image to persist automatically.
  const runtime = productImageBackupScopeRuntime({
    state: {
      productName: '양단호박바늘쌈',
      imageBase64: 'WORK_B_IMAGE',
      imageMime: 'image/png',
      imagePreview: 'data:image/png;base64,WORK_B_IMAGE',
      imageName: 'work-b.png',
      analysisImages: [],
      factory: { product: {} },
      compPage: { marketScrape: {} },
    },
    getCurrentLastWorkWorkspaceScope: () => 'project:work-b',
    displayableImageSrc: value => String(value || '').startsWith('data:image/'),
  });

  // When: the automatic backup payload is built.
  const payload = runtime.currentPayload();

  // Then: it cannot occupy or impersonate another workspace's automatic record.
  assert.equal(payload.id, 'lastProductImageBackup:project:work-b');
  assert.equal(payload.workspaceScope?.id, 'project:work-b');
});

test('Given session cuts restore before the large product backup When that backup arrives Then cut-source reconciliation runs at the later boundary', () => {
  // Given: startup restores lightweight/session state first and IndexedDB image backup second.
  const persistenceSource = source('src/app-core-02.js');

  // When: the late product-image backup boundary is inspected.
  const backupApplySource = sourceSlice(
    persistenceSource,
    'function applyProductImageBackupPayload(',
    'async function saveLastProductImageBackupToDbIfChanged(',
  );

  // Then: it also reconnects saved cut results to the newly restored canonical product image.
  assert.match(
    backupApplySource,
    /restoreCutsSourceFromCurrentProductImage\(state\.cuts,\s*factory\)/,
  );
});

test('Given a completed workfile with stale interrupted status When restored Then transient failure state is cleared', () => {
  // Given: all required sections exist, but a prior interrupted run remains in the saved factory state.
  const factory = {
    automation: { activeTaskId: 'stage-size' },
    goalRun: {
      running: false,
      progress: 100,
      currentStage: '후보 선택 대기',
      failureReason: '이전 실행의 후보/이미지는 보존했습니다.',
      activeOperationId: '',
    },
    stages: {
      detail: { status: 'running', message: '응답 대기' },
    },
  };
  const payload = {
    sectionOrder: ['one', 'two'],
    sectionContents: { one: '<section>1</section>', two: '<section>2</section>' },
    sectionImages: {},
  };

  // When: the workfile restore boundary reconciles transient execution state.
  const result = restoredCompletionReconciler()(factory, payload);

  // Then: completed output is authoritative and no stale task/failure remains.
  assert.equal(result.automation.activeTaskId, '');
  assert.equal(result.stages.detail.status, 'done');
  assert.equal(result.goalRun.running, false);
  assert.equal(result.goalRun.progress, 100);
  assert.equal(result.goalRun.failureReason, '');
  assert.equal(result.goalRun.activeOperationId, '');
});

test('Given an incomplete workfile with a real failure When restored Then the failure remains visible', () => {
  // Given: one required section is missing and the saved failure is not a stale candidate-review marker.
  const factory = {
    automation: { activeTaskId: 'stage-detail' },
    goalRun: {
      running: false,
      progress: 45,
      currentStage: 'Cafe24 등록 실패',
      failureReason: '상품 등록 API 오류',
      activeOperationId: '',
    },
    stages: {
      detail: { status: 'error', message: '생성 실패' },
    },
  };
  const payload = {
    sectionOrder: ['one', 'two'],
    sectionContents: { one: '<section>1</section>' },
    sectionImages: {},
  };

  // When: the incomplete workfile is restored.
  const result = restoredCompletionReconciler()(factory, payload);

  // Then: only the impossible active task is cleared; the real failure is preserved.
  assert.equal(result.automation.activeTaskId, '');
  assert.equal(result.stages.detail.status, 'error');
  assert.equal(result.goalRun.progress, 45);
  assert.equal(result.goalRun.failureReason, '상품 등록 API 오류');
});

test('Given preserved candidates awaiting review When status renders Then it is attention instead of failure', () => {
  const classifiers = goalRunStatusClassifiers();
  const candidateReview = {
    running: false,
    progress: 100,
    currentStage: '후보 선택 대기',
    failureReason: '이전 실행의 후보/이미지는 보존했습니다. 맞는 후보를 선택하거나 필요한 항목만 다시 실행하세요.',
  };
  const realFailure = {
    running: false,
    progress: 45,
    currentStage: 'Cafe24 등록 실패',
    failureReason: '상품 등록 API 오류',
  };

  assert.equal(classifiers.needsAttention(candidateReview), true);
  assert.equal(classifiers.hasFailure(candidateReview), false);
  assert.equal(classifiers.hasFailure(realFailure), true);
});

test('Given optional Cafe24 background health is unavailable When status renders Then the active factory run is not failed', () => {
  const classifiers = goalRunStatusClassifiers();
  const backgroundWarning = {
    running: false,
    progress: 100,
    currentStage: '후보 선택 대기',
    failureReason: 'Cafe24 OAuth 자동 점검 실패: Control Tower 연결 거부',
  };
  const autoRefreshSource = sourceSlice(
    source('src/app-core-06.js'),
    'function factoryStartCafe24OAuthAutoRefresh()',
    'let workspaceAuthorityUiLock = null;',
  );

  assert.equal(classifiers.hasFailure(backgroundWarning), false);
  assert.match(autoRefreshSource, /자동 점검 보류:[\s\S]*?type:\s*'warn'/);
  assert.doesNotMatch(autoRefreshSource, /자동 점검 실패:[\s\S]*?type:\s*'error'/);
});

test('Given optional Sinhwa asset sync is deferred When status renders Then the active factory run is attention instead of failure', () => {
  const classifiers = goalRunStatusClassifiers();
  const syncWarning = {
    running: false,
    progress: 0,
    currentStage: '로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다: 신화사 상세페이지 자산 API 요청에 실패했습니다.',
    failureReason: '',
  };
  const actualFactoryFailure = {
    running: false,
    progress: 35,
    currentStage: '신화사DB 후보 수집 실패',
    failureReason: '신화사DB 후보 수집 API 오류',
  };

  assert.equal(classifiers.needsAttention(syncWarning), true);
  assert.equal(classifiers.hasFailure(syncWarning), false);
  assert.equal(classifiers.hasFailure(actualFactoryFailure), true);
});

test('Given a completed lightweight session without sectionOrder When restored Then default section ids prove completion', () => {
  // Given: lightweight browser sessions can omit sectionOrder while retaining every default section result.
  const sections = [{ id: 'one' }, { id: 'two' }];
  const factory = {
    automation: { activeTaskId: 'stage-detail' },
    goalRun: {
      running: false,
      progress: 100,
      currentStage: '후보 선택 대기',
      failureReason: '이전 실행의 후보/이미지는 보존했습니다.',
    },
    stages: { detail: { status: 'running', message: '응답 대기' } },
  };
  const payload = {
    sectionOrder: null,
    sectionContents: { one: '<section>1</section>', two: '<section>2</section>' },
    sectionImages: {},
  };

  // When: completion is reconciled with the app's default section definitions.
  const result = restoredCompletionReconciler({ SECTIONS: sections })(factory, payload);

  // Then: the completed lightweight session is not shown as a failed run.
  assert.equal(result.stages.detail.status, 'done');
  assert.equal(result.goalRun.failureReason, '');
});

test('Given empty saved section shells When restored Then they do not prove detail completion', () => {
  // Given: every required key exists, but none contains generated user-visible output.
  const factory = {
    automation: { activeTaskId: 'stage-detail' },
    goalRun: {
      running: false,
      progress: 100,
      currentStage: '후보 선택 대기',
      failureReason: '이전 실행의 후보/이미지는 보존했습니다.',
    },
    stages: { detail: { status: 'running', message: '응답 대기' } },
  };
  const payload = {
    sectionOrder: ['one', 'two'],
    sectionContents: {
      one: {},
      two: { __sectionWorkScope: { mode: 'all' } },
    },
    sectionImages: {},
  };

  // When: the restore authority evaluates the persisted artifacts.
  const result = restoredCompletionReconciler()(factory, payload);

  // Then: structural shells are not mistaken for completed detail output.
  assert.equal(result.stages.detail.status, 'running');
  assert.equal(result.goalRun.progress, 100);
  assert.equal(result.goalRun.failureReason, '이전 실행의 후보/이미지는 보존했습니다.');
});

test('Given factory logs When rendered Then recent and stage logs use compact native disclosure without an inner scrollbar', () => {
  // Given: the two factory log renderers and their stylesheet contract.
  const renderSource = source('src/app-core-05.js');
  const recentLogRenderer = sourceSlice(
    renderSource,
    'function renderFactoryAutomationRunStatus(',
    'function renderFactoryAutomationCurrentTask(',
  );
  const stageLogRenderer = sourceSlice(
    renderSource,
    'function renderFactoryStageLogBoard(',
    'function renderFactoryStageRailBody(',
  );
  const stylesheet = source('app.html');

  // When: the generated markup and matching CSS are inspected.
  // Then: both log surfaces use closed-by-default native disclosure and page-level scrolling.
  assert.match(recentLogRenderer, /<details[^>]+data-factory-goal-log-panel/);
  assert.match(stageLogRenderer, /<details[^>]+data-factory-stage-log-board/);
  assert.match(recentLogRenderer, /\$\{logs\.length\}건 · 오류 \$\{errorCount\}건/);
  assert.match(stageLogRenderer, /\$\{logs\.length\}건 · 오류 \$\{errorCount\}건/);
  assert.match(stageLogRenderer, /const completedStageSummary =/);
  assert.match(stylesheet, /\.factory-log-disclosure\b/);
  assert.doesNotMatch(stylesheet, /\.factory-log\{[^}]*max-height:[^;}]+[^}]*overflow:auto/);
});

test('Given every persisted restore layer When hydrated Then callers pass artifacts to one runtime restore authority', () => {
  // Given: the runtime source contains startup, explicit-workfile, asset, and inline-asset hydration layers.
  const runtimeSource = source('src/app-core-03.js');
  const persistenceSource = source('src/app-core-02.js');

  // When: all restore entries are inspected.
  // Then: startup uses the pure authority once, while runtime callers provide explicit restore evidence.
  assert.match(
    runtimeSource,
    /factory:\s*factoryReconcileRestoredCompletionState\(\s*normalizeFactoryState\(_savedSession\?\.factory\),\s*_savedSession\s*\|\|\s*\{\}\s*,?\s*\)/,
  );
  const applyWorkspaceSource = sourceSlice(
    runtimeSource,
    'function applyWorkspacePayload(',
    'async function refreshWorkspaceLists(',
  );
  assert.doesNotMatch(
    applyWorkspaceSource,
    /factoryReconcileRestoredCompletionState\(/,
  );
  assert.match(
    applyWorkspaceSource,
    /factoryRuntimeReplaceFactorySnapshot\(restoredFactory,\s*\{[\s\S]*?restorePayload:\s*next,/,
  );
  const applyAssetsSource = sourceSlice(
    persistenceSource,
    'function applySessionAssetsPayload(',
    'function repairRestoredSessionIdentityDrift(',
  );
  assert.doesNotMatch(
    applyAssetsSource,
    /factoryReconcileRestoredCompletionState\(/,
  );
  assert.match(
    applyAssetsSource,
    /factoryRuntimeReplaceFactorySnapshot\(workingFactory,\s*\{[\s\S]*?restorePayload:\s*assets,/,
  );
  const restoreInlineFactorySource = sourceSlice(
    runtimeSource,
    'function restoreProjectFileFactoryAssetsFromPayload(',
    'function resetLiveWorkspaceForProjectFileReplacement(',
  );
  assert.doesNotMatch(
    restoreInlineFactorySource,
    /factoryReconcileRestoredCompletionState\(/,
  );
  assert.match(
    restoreInlineFactorySource,
    /factoryRuntimeReplaceFactorySnapshot\(nextFactory,\s*\{[\s\S]*?restorePayload:\s*workspaceAssetPayload,/,
  );
  const replaceFactorySource = sourceSlice(
    runtimeSource,
    'function factoryRuntimeReplaceFactorySnapshot(',
    'function factoryRuntimeUpdateOwnedFactory(',
  );
  assert.match(
    replaceFactorySource,
    /if \(!blankDraftReset && options\.restorePayload && typeof options\.restorePayload === 'object'\)[\s\S]*?nextFactory = factoryReconcileRestoredCompletionState\(\s*nextFactory,\s*options\.restorePayload,\s*\)/,
  );
  assert.doesNotMatch(replaceFactorySource, /shouldReconcileRestoredCompletion|nextFactory,\s*state,/);
});

test('factory session assets restore the factory route even when analysis is absent', () => {
  const applyAssetsSource = sourceSlice(
    source('src/app-core-02.js'),
    'function applySessionAssetsPayload(',
    'function repairRestoredSessionIdentityDrift(',
  );

  assert.match(
    applyAssetsSource,
    /assets\.step && state\.step === 'upload' && \(state\.analysis \|\| assets\.step === 'factory'\)/,
  );
});

test('최근 작업 불러오기는 이미지 검증과 세션 고정을 끝낸 뒤 완료로 확정하고 실패 시 이전 작업으로 되돌린다', () => {
  // Given: 최근 작업 카드가 IndexedDB 프로젝트를 현재 편집 화면으로 복원한다.
  const runtimeSource = source('src/app-core-03.js');
  const loadProjectSource = sourceSlice(
    runtimeSource,
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );

  // When/Then: 지연 저장을 먼저 정리하고, 프로젝트 전체를 교체한 뒤 detached 자산 검증을 기다린다.
  assert.match(loadProjectSource, /await settleWorkspaceScopeTransitionPersistence\(\)/);
  assert.match(loadProjectSource, /visualValidationBatch\s*=\s*factoryBeginVisualValidationRenderBatch\(\)/);
  assert.match(
    loadProjectSource,
    /applyWorkspacePayload\(payload,\s*\{[\s\S]*?skipPersistence:\s*true,[\s\S]*?skipSideEffects:\s*true,[\s\S]*?replaceWorkspace:\s*true,[\s\S]*?payloadAlreadyDetached:\s*true/,
  );
  assert.match(
    loadProjectSource,
    /factoryPrimeCurrentAssetVisualValidation\(factoryRuntimeDetachedValue\(factoryRuntimeReadFactory\(\)\)\)/,
  );
  assert.match(loadProjectSource, /await factoryWaitForVisualValidationOperation\(visualValidationBatch\.token\)/);

  // 완료 상태는 F5 복구용 세션 저장이 성공한 뒤에만 확정한다.
  assert.match(loadProjectSource, /await flushQueuedPersistentState\(\{[\s\S]*?skipVisibleSync:\s*true/);
  assert.match(loadProjectSource, /factoryLog\(`작업 불러오기 완료:/);

  // 중간 실패는 부분 적용 화면을 남기지 않고 state와 factory store를 함께 원복한다.
  assert.match(loadProjectSource, /liveStateBackup\s*=\s*structuredClone\(state\)/);
  assert.match(loadProjectSource, /factoryStoreBackup\s*=\s*factoryRuntimeDetachedValue\(factoryStore\.getSnapshot\(\)\)/);
  assert.match(loadProjectSource, /factoryRuntimeRequireStore\(\)\.switchWorkspace\(factoryOperationBackup\.workspaceId/);
  assert.match(loadProjectSource, /factoryEndVisualValidationRenderBatch\(visualValidationBatch\)/);
});

test('Given a transient storage read failure, hydration retries once and completes restore cleanup', async () => {
  const calls = [];
  const restoredAssets = Object.freeze({ currentProjectId: 'project-retry', productName: '재시도 상품' });
  let readAttempts = 0;
  const context = vm.createContext({
    state: { step: 'factory' },
    sessionAssetsHydrated: false,
    workspaceBlankResetToken: 'workspace:retry',
    getCurrentLastWorkWorkspaceScope: () => 'project:retry',
    workspaceHydrationScopeIsCurrent: (_scope, _token, request) =>
      typeof request !== 'function' || request() !== false,
    lastWorkSnapshotMatchesWorkspaceScope: () => true,
    pendingSessionAssetSaveAfterHydrate: false,
    async workspaceGetSessionAssets() {
      readAttempts += 1;
      calls.push(`read:${readAttempts}`);
      if (readAttempts === 1) throw new Error('transient browser storage failure');
      return restoredAssets;
    },
    lastWorkSnapshotMatchesCurrentWorkspace: () => true,
    lastWorkPayloadProductName: () => '재시도 상품',
    applySessionAssetsPayload(assets) {
      calls.push(assets === restoredAssets ? 'apply:restored' : 'apply:unexpected');
      return true;
    },
    hydrateLastProductImageBackup: async () => false,
    snapshotHasInlineImagePayload: () => false,
    recoverStaleSessionInlineImages: () => false,
    markSessionAssetFingerprintSaved: () => calls.push('fingerprint'),
    render: () => calls.push('render'),
    scheduleCompetitorEvidenceCanvasPaint: () => calls.push('paint'),
    paintCompetitorEvidenceCanvases: () => calls.push('paint-fallback'),
    factoryClearRestoredImageGenerationRuntime() {
      calls.push('cleanup');
      return false;
    },
    showImageRestoreWarningIfNeeded() {
      calls.push('warning-reconciled');
      return false;
    },
    scheduleSessionAssetSave: () => calls.push('save'),
    setTimeout(callback, delay) {
      calls.push(`timer:${delay}`);
      queueMicrotask(callback);
      return calls.length;
    },
    console: { warn: message => calls.push(`warn:${message}`) },
  });
  const functionSource = sourceSlice(
    source('src/app-core-02.js'),
    'async function hydratePersistentSessionAssets(',
    'function expireCookie(',
  );
  vm.runInContext(`${functionSource}
globalThis.runHydration = hydratePersistentSessionAssets;
globalThis.hydrationComplete = () => sessionAssetsHydrated;`, context);

  await context.runHydration();
  await new Promise(resolve => queueMicrotask(resolve));

  assert.equal(readAttempts, 2);
  assert.deepEqual(calls.filter(call => call.startsWith('timer:')), ['timer:50', 'timer:0']);
  assert.equal(calls.includes('apply:restored'), true);
  assert.equal(calls.includes('cleanup'), true);
  assert.equal(calls.includes('warning-reconciled'), true);
  assert.equal(context.hydrationComplete(), true);
  assert.ok(calls.filter(call => call === 'render').length >= 1);
});

test('Given explicit work input supersedes startup hydrate, the current asset save is not stranded behind the cancelled restore', async () => {
  const calls = [];
  let isCurrent = true;
  const context = vm.createContext({
    state: { step: 'factory' },
    sessionAssetsHydrated: false,
    workspaceBlankResetToken: 'workspace:explicit-input',
    getCurrentLastWorkWorkspaceScope: () => 'project:explicit-input',
    workspaceHydrationScopeIsCurrent: (_scope, _token, request) =>
      typeof request !== 'function' || request() !== false,
    lastWorkSnapshotMatchesWorkspaceScope: () => true,
    pendingSessionAssetSaveAfterHydrate: true,
    async workspaceGetSessionAssets() {
      calls.push('read:stale-assets');
      isCurrent = false;
      return { currentProjectId: 'project-stale', productName: '이전 상품' };
    },
    scheduleSessionAssetSave: () => calls.push('save:current-user-input'),
  });
  const functionSource = sourceSlice(
    source('src/app-core-02.js'),
    'async function hydratePersistentSessionAssets(',
    'function expireCookie(',
  );
  vm.runInContext(`${functionSource}\nglobalThis.runHydration = hydratePersistentSessionAssets;\nglobalThis.hydrationComplete = () => sessionAssetsHydrated;`, context);

  await context.runHydration({ isCurrent: () => isCurrent });

  assert.deepEqual(calls, ['read:stale-assets', 'save:current-user-input']);
  assert.equal(context.hydrationComplete(), true);
});

test('Given product work at startup, the warning is reconciled only after every restore source settles', async () => {
  const calls = [];
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return Object.freeze({ promise, resolve });
  };
  const sessionAssets = deferred();
  const serverSnapshot = deferred();
  const localArchive = deferred();
  const imageBackup = deferred();
  const settleTurn = () => new Promise(resolve => setImmediate(resolve));
  const context = vm.createContext({
    state: { currentProjectId: 'project-startup', step: 'factory' },
    gemini: null,
    installClassicRuntimeLifecycle: () => calls.push('install'),
    disposeClassicRuntimeLifecycle: () => calls.push('dispose'),
    hasGeminiConnection: () => false,
    getCurrentLastWorkWorkspaceScope: () => 'project:project-startup',
    ensureWorkspaceEditAuthority: async () => ({ scopeId: 'project:project-startup' }),
    markSessionAssetFingerprintSaved: () => calls.push('fingerprint'),
    loadCutsArchiveFolderStatus: async () => calls.push('cuts-status'),
    refreshWorkspaceLists: async () => calls.push('workspace-lists'),
    hydratePersistentSessionAssets() {
      calls.push('session-assets:start');
      return sessionAssets.promise.then(() => calls.push('session-assets:settled'));
    },
    hydrateServerLastWorkSnapshot() {
      calls.push('server-snapshot:start');
      return serverSnapshot.promise.then(() => calls.push('server-snapshot:settled'));
    },
    factoryRestoreCurrentWorkfileLocalArchive() {
      calls.push('local-archive:start');
      return localArchive.promise.then(() => calls.push('local-archive:settled'));
    },
    factoryRuntimeReadFactory: () => ({ product: { productName: '기동 상품', hasImage: true } }),
    hydrateLastProductImageBackup() {
      calls.push('image-backup:start');
      return imageBackup.promise.then(() => calls.push('image-backup:settled'));
    },
    showImageRestoreWarningIfNeeded: () => calls.push('warning-reconciled'),
    render: () => calls.push('render'),
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
  });
  const deferredFunctionSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function continueClassicRuntimeHydrationInBackground(',
    'async function runClassicRuntimeHydration(',
  );
  const functionSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function runClassicRuntimeHydration(',
    'function hydrateClassicRuntime(',
  );
  vm.runInContext(`${deferredFunctionSource}
${functionSource}
globalThis.runStartupHydration = runClassicRuntimeHydration;`, context);

  const pending = context.runStartupHydration({ schema: 'kuasangse.app-state', version: 'app-state:v1' });
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('server-snapshot:start'), false);

  sessionAssets.resolve();
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('server-snapshot:start'), true);
  assert.equal(calls.includes('local-archive:start'), false);

  serverSnapshot.resolve();
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('local-archive:start'), true);
  assert.equal(calls.includes('image-backup:start'), false);

  localArchive.resolve();
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('image-backup:start'), true);

  imageBackup.resolve();
  const result = await pending;
  await settleTurn();

  assert.deepEqual({ ...result }, {
    schema: 'kuasangse.app-state',
    version: 'app-state:v1',
    hydrated: true,
    stale: false,
  });
  const restoreOrder = [
    'session-assets:start', 'session-assets:settled',
    'server-snapshot:start', 'server-snapshot:settled',
    'local-archive:start', 'local-archive:settled',
    'image-backup:start', 'image-backup:settled',
    'local-archive:start', 'local-archive:settled',
    'warning-reconciled',
  ];
  assert.deepEqual(calls.filter(call => restoreOrder.includes(call)), restoreOrder);
});

test('Given an explicit product transition while startup assets are restoring, the old background restore stops before server state can apply', async () => {
  const calls = [];
  let intentEpoch = 0;
  const context = vm.createContext({
    state: { currentProjectId: 'project-startup', step: 'factory' },
    serverLastWorkHydrated: false,
    serverLastWorkHydrating: false,
    workspaceScopeTransitionState: { persistentSaveQueued: false },
    classicRuntimeIsBatchWorker: () => false,
    ensureWorkspaceEditAuthority: async () => ({ scopeId: 'project:project-startup' }),
    hydratePersistentSessionAssets: async () => {
      calls.push('session-assets');
      intentEpoch += 1;
      return false;
    },
    hydrateServerLastWorkSnapshot: async () => {
      calls.push('server-snapshot');
      return false;
    },
    factoryRestoreCurrentWorkfileLocalArchive: async () => {
      calls.push('local-archive');
      return false;
    },
    factoryRuntimeReadFactory: () => ({ product: {} }),
    hydrateLastProductImageBackup: async () => {
      calls.push('image-backup');
      return false;
    },
    showImageRestoreWarningIfNeeded: () => false,
    render: () => calls.push('render'),
  });
  const deferredFunctionSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function continueClassicRuntimeHydrationInBackground(',
    'async function runClassicRuntimeHydration(',
  );
  const deferredSupportSource = sourceSlice(
    source('src/app-core-06.js'),
    'function finishClassicDeferredHydrationWithoutServerRestore()',
    'async function continueClassicRuntimeHydrationInBackground(',
  );
  vm.runInContext(`${deferredSupportSource}\n${deferredFunctionSource}\nglobalThis.runBackgroundHydration = continueClassicRuntimeHydrationInBackground;`, context);

  const result = await context.runBackgroundHydration({
    initialHydrationIdentity: Object.freeze({ scopeId: 'project:project-startup', projectId: 'project-startup' }),
    initialAuthority: Object.freeze({ scopeId: 'project:project-startup' }),
    readHydrationIdentity: () => Object.freeze({ scopeId: 'project:project-startup', projectId: 'project-startup' }),
    hydrationIdentityIsCurrent: () => true,
    hydrationIntentToken: 0,
    hydrationIntentIsCurrent: token => token === intentEpoch,
  });

  assert.equal(result, false);
  assert.deepEqual(calls, ['session-assets']);
  assert.equal(context.serverLastWorkHydrated, true);
});

test('Given a restored tab session When startup hydration reaches the server Then it does not force an older server snapshot over current work', async () => {
  const capturedOptions = [];
  const context = vm.createContext({
    state: {
      currentProjectId: 'project-startup',
      step: 'factory',
      productName: '모시꽃수파우치',
      imageBase64: null,
      imagePreview: null,
    },
    classicRuntimeIsBatchWorker: () => false,
    hydratePersistentSessionAssets: async () => false,
    hydrateServerLastWorkSnapshot: async options => {
      capturedOptions.push({ ...options });
      return false;
    },
    factoryRuntimeReadFactory: () => ({ product: { productName: '모시꽃수파우치' } }),
    render: () => {},
  });
  const deferredFunctionSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function continueClassicRuntimeHydrationInBackground(',
    'async function runClassicRuntimeHydration(',
  );
  vm.runInContext(`${deferredFunctionSource}\nglobalThis.runBackgroundHydration = continueClassicRuntimeHydrationInBackground;`, context);

  await context.runBackgroundHydration({
    initialHydrationIdentity: Object.freeze({ scopeId: 'draft:startup-tab', projectId: 'project-startup' }),
    initialAuthority: Object.freeze({ scopeId: 'draft:startup-tab' }),
    readHydrationIdentity: () => Object.freeze({ scopeId: 'draft:startup-tab', projectId: 'project-startup' }),
    hydrationIdentityIsCurrent: () => true,
    hydrationIntentToken: 0,
    hydrationIntentIsCurrent: () => true,
  });

  assert.equal(capturedOptions.length, 1);
  assert.notEqual(capturedOptions[0].force, true);
  assert.notEqual(capturedOptions[0].forceRevisionRestore, true);
});

test('Given an active menu render, warning reconciliation happens before visible markup replacement', () => {
  const calls = [];
  const root = {};
  const menu = {
    ownedSlices: ['manual-ui'],
    refresh: refreshedRoot => calls.push(refreshedRoot === root ? 'refresh' : 'refresh:unexpected'),
  };
  const context = vm.createContext({
    state: { step: 'manual' },
    document: {
      getElementById: () => root,
      documentElement: { dataset: {} },
    },
    runtimeMenuModules: new Map(),
    ensureWorkfileActionDelegation: () => calls.push('delegation'),
    showImageRestoreWarningIfNeeded: () => calls.push('warning-reconciled'),
    renderShellMarkup: () => {
      calls.push('markup');
      return '<main>updated</main>';
    },
    patchAppHtml: (target, html) => calls.push(target === root && html.includes('updated') ? 'patch' : 'patch:unexpected'),
    bindRenderedWorkfileActionButtons: target => calls.push(target === root ? 'workfile-bind' : 'workfile-bind:unexpected'),
    bindShellAfterRender: target => calls.push(target === root ? 'bind' : 'bind:unexpected'),
  });
  const functionSource = sourceSlice(
    source('src/app-core-03.js'),
    'function renderShellFrame(',
    'const CLASSIC_RUNTIME_REQUEST_EVENT',
  );
  vm.runInContext(`${functionSource}
globalThis.renderFrame = renderShellFrame;`, context);

  context.renderFrame({ root, menu, activeMenuHtml: '<section>manual</section>' });

  assert.deepEqual(calls, ['delegation', 'warning-reconciled', 'markup', 'patch', 'refresh', 'workfile-bind', 'bind']);
});

test('Given a marker-only analysis reference matching the restored product image, no loss is reported', () => {
  const imagePayload = 'restored-product-image';
  const fingerprint = `${imagePayload.length}:${imagePayload}:${imagePayload}`;
  const fingerprintSource = sourceSlice(
    source('src/app-core-03.js'),
    'function factoryImagePayloadFingerprint(',
    'function factoryImageFingerprintLooksUsable(',
  );
  const counterSource = sourceSlice(
    source('src/app-core-02.js'),
    'function hasRestoredImagePayloadValue(',
    'function wasStorageWarningDismissed(',
  );
  for (const payloadOwner of ['state', 'factory']) {
    const product = {
      hasImage: true,
      imageBase64: payloadOwner === 'factory' ? imagePayload : '',
      inputImages: [{ hasImage: true, inputImageFingerprint: fingerprint }],
    };
    const context = vm.createContext({
      state: {
        step: 'factory',
        imageBase64: payloadOwner === 'state' ? imagePayload : '',
        analysisImages: [{ hasImageData: true, inputImageFingerprint: fingerprint }],
      },
      IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
      factoryRuntimeReadFactory: () => ({ product, assets: [] }),
    });
    vm.runInContext(`${fingerprintSource}
${counterSource}
globalThis.countMissingRestoreReferences = countSessionAssetRestoreRefs;`, context);

    assert.equal(context.countMissingRestoreReferences(), 0, `${payloadOwner} payload must satisfy matching references`);
  }
});

test('Given repeated marker shells for one product backup, inline restore keeps one real image', () => {
  const persistenceSource = source('src/app-core-02.js');
  const backupItemSource = sourceSlice(
    persistenceSource,
    'function productImageBackupItem(',
    'function compactProductImageBackupItem(',
  );
  const applyBackupSource = sourceSlice(
    persistenceSource,
    'function applyProductImageBackupPayload(',
    'async function saveLastProductImageBackupToDbIfChanged(',
  );
  const cutsRestoreSource = sourceSlice(
    persistenceSource,
    'function restoreCutsSourceFromCurrentProductImage(',
    'function applySessionAssetsPayload(',
  );
  const state = {
    productName: '방울수저집',
    analysisImages: Array.from({ length: 5 }, () => ({
      mime: 'image/jpeg',
      name: 'image.jpg',
      preview: '__stored_in_indexeddb__',
      hasImageData: true,
      restoredFrom: 'lastProductImageBackup',
    })),
  };
  const factory = { product: {}, assets: [] };
  const context = vm.createContext({
    state,
    workspaceBlankResetInProgress: false,
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
    displayableImageSrc: value => String(value || '').startsWith('data:image/'),
    normalizeFactoryState: value => value,
    cloneData: value => value,
    factoryRuntimeReadFactory: () => factory,
    factoryRuntimeReplaceFactorySnapshot: () => {},
    productImageBackupConflictsWithCurrentWork: () => false,
    ensureCompMarketScrapeState: () => ({}),
    uid: prefix => `${prefix}_id`,
  });
  vm.runInContext(`${backupItemSource}
${cutsRestoreSource}
${applyBackupSource}
globalThis.applyBackup = applyProductImageBackupPayload;`, context);

  const changed = context.applyBackup({
    productName: '방울수저집',
    primary: {
      source: 'app',
      base64: 'CURRENT_IMAGE',
      mime: 'image/jpeg',
      name: 'image.jpg',
    },
  }, { factory, restoreInline: true, syncMarket: false });

  assert.equal(changed, true);
  assert.equal(state.analysisImages.length, 1);
  assert.equal(state.analysisImages[0].base64, 'CURRENT_IMAGE');
  assert.equal(state.analysisImages[0].restoredFrom, 'lastProductImageBackup');
});

test('Given a competitor-only image persistence notice, unrelated menus do not show a global warning', () => {
  const persistenceSource = source('src/app-core-02.js');
  const shellSource = source('src/app-core-03.js');
  const messageSource = sourceSlice(
    persistenceSource,
    'function compImagePersistenceWarningMessage(',
    'function stripCompSnapshotImages(',
  );
  const visibilitySource = sourceSlice(
    shellSource,
    'function shouldRenderStorageWarning(',
    'function renderStorageWarning(',
  );
  const state = { step: 'upload', storageWarning: '' };
  const context = vm.createContext({ state });
  vm.runInContext(`${messageSource}
${visibilitySource}
globalThis.warningMessage = compImagePersistenceWarningMessage;
globalThis.shouldRender = shouldRenderStorageWarning;`, context);

  state.storageWarning = context.warningMessage();
  assert.match(state.storageWarning, /경쟁사 분석/);
  assert.equal(context.shouldRender(), false);
  state.step = 'competitor';
  assert.equal(context.shouldRender(), true);
  state.step = 'upload';
  state.storageWarning = '세션 저장에 실패했습니다.';
  assert.equal(context.shouldRender(), true);
});

test('Given startup edit authority is still acquiring, session assets wait before mutable hydration', () => {
  const startupSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function runClassicRuntimeHydration(',
    'function hydrateClassicRuntime(',
  );
  const deferredHydrationSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function continueClassicRuntimeHydrationInBackground(',
    'async function runClassicRuntimeHydration(',
  );
  const authorityAwaitMatch = startupSource.match(
    /(?:const|let)\s+initialAuthority\s*=\s*await\s+initialWorkspaceAuthority;/,
  );
  const authorityAwaitIndex = authorityAwaitMatch?.index ?? -1;
  const handoffIndex = startupSource.indexOf(
    'continueClassicRuntimeHydrationInBackground({',
  );
  const sessionHydrateIndex = deferredHydrationSource.indexOf(
    'await hydratePersistentSessionAssets({ isCurrent: intentIsCurrent }).catch(() => {});',
  );

  assert.notEqual(authorityAwaitIndex, -1, 'startup must await the edit-authority acquisition');
  assert.notEqual(sessionHydrateIndex, -1, 'startup must hydrate persistent session assets');
  assert.ok(
    authorityAwaitIndex < handoffIndex,
    'mutable session hydration must not run before edit authority settles',
  );
});

test('Given a tab session is newer than the server receipt, startup cleanup waits for ordinary server hydration without forcing a stale replacement', () => {
  const persistenceHydration = sourceSlice(
    source('src/app-core-02.js'),
    'async function hydratePersistentSessionAssets(',
    'function expireCookie(',
  );
  const deferredHydration = sourceSlice(
    source('src/app-core-06.js'),
    'async function continueClassicRuntimeHydrationInBackground(',
    'async function runClassicRuntimeHydration(',
  );

  assert.match(
    persistenceHydration,
    /factoryClearRestoredImageGenerationRuntime\(\{\s*save:\s*false,/,
    'pre-server IndexedDB cleanup must never schedule a last-work write',
  );
  assert.match(
    deferredHydration,
    /await hydrateServerLastWorkSnapshot\(\{\s*isCurrent:\s*intentIsCurrent,\s*\}\)\.catch\(\(\)\s*=>\s*\{\}\);[\s\S]*factoryClearRestoredImageGenerationRuntime\(\{\s*save:\s*true,/,
    'the quality-gated server hydration must finish before runtime cleanup may persist',
  );
  assert.doesNotMatch(
    deferredHydration,
    /hydrateServerLastWorkSnapshot\(\{\s*force:\s*true,\s*forceRevisionRestore:\s*true,/,
    'startup must not force an older server receipt over the restored tab session',
  );
});
