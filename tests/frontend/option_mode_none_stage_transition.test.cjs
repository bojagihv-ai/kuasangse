const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadWaitingStage() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryRuntimeControlWaitingStage(');
  const end = source.indexOf('\nfunction factoryRuntimeControlCheckpointProjectId(', start);
  assert.ok(start >= 0 && end > start, 'waiting-stage normalization must be extractable');
  const context = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)}\nthis.waitingStage = factoryRuntimeControlWaitingStage;`, context);
  return context.waitingStage;
}

function loadGoalLoop(stageCalls) {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const start = source.indexOf('const FACTORY_GOAL_STAGE_A_CUT_DECISIONS');
  const end = source.indexOf('\nfunction factoryMakeSessionFolderName(', start);
  assert.ok(start >= 0 && end > start, 'goal-stage DAG must be extractable');
  const completed = new Set(['db', 'hero', 'size']);
  const context = vm.createContext({
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => 'fixture-token' }),
    factoryRequireCurrentRunOperation: () => true,
    factoryUpdateFromInputs: () => {},
    factoryLog: () => {},
    saveLastWorkNow: () => {},
    render: () => {},
    factoryStageLabel: stageId => stageId === 'options' ? '색상옵션' : stageId,
    factoryGoalAssetCount: stageId => completed.has(stageId) ? 1 : 0,
    factoryHasSizeFacts: () => true,
    factorySetStageStatus: () => {},
    factoryRunStage: async stageId => {
      stageCalls.push(stageId);
      if (stageId === 'options') return false;
      completed.add(stageId);
      return true;
    },
    factoryArchiveSession: async () => {},
    factoryRunOperationIsStale: () => false,
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.runGoalLoop = factoryRunGoalLoop;`, context);
  return context.runGoalLoop;
}

function loadRestoreCheckpoint(projection, factory) {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const waitingStart = source.indexOf('function factoryRuntimeControlWaitingStage(');
  const waitingEnd = source.indexOf('\nfunction factoryRuntimeControlCheckpointProjectId(', waitingStart);
  const requiredStart = source.indexOf('async function factoryRuntimeControlRestoreRequiredValues(');
  const requiredEnd = source.indexOf('\nfunction factoryRuntimeControlCompetitorSnapshot(', requiredStart);
  const restoreStart = source.indexOf('async function factoryRuntimeControlRestoreProductCheckpoint(');
  const restoreEnd = source.indexOf('\nasync function factoryRuntimeControlPrepareProduct(', restoreStart);
  assert.ok(waitingStart >= 0 && waitingEnd > waitingStart, 'waiting-stage normalization must be extractable');
  assert.ok(requiredStart >= 0 && requiredEnd > requiredStart, 'required-value restoration must be extractable');
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'restore boundary must be extractable');
  const context = vm.createContext({
    state: { projectBusy: false, productInfoManualValues: {} },
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeControlValidateProductCheckpoint: checkpoint => structuredClone(checkpoint),
    loadProjectRecord: async () => true,
    factoryRuntimeControlProjection: async () => (typeof projection === 'function' ? projection() : projection),
    factoryRuntimeControlProjectionMatchesCheckpoint: () => true,
    getCurrentDocumentWorkspaceScope: projectId => `project:${projectId}`,
    ensureWorkspaceEditAuthority: async scopeId => ({ mode: 'editing', scopeId }),
    factoryRuntimeUpdateOwnedFactory: async (_operation, _scope, mutate) => mutate(factory),
    factoryApplySelectedAssetsToSections: () => true,
    saveLastWorkNow: async () => true,
    factoryRuntimeControlProvidedColorOptionsMatch: () => true,
    factoryRuntimeReadFactory: () => factory,
    factoryRuntimeControlApplyProvidedColorOptions: () => false,
    factoryRuntimeControlCheckpointFromProjection: (_payload, _projection, status, stageKey) => ({ status, stageKey }),
    factoryRuntimeBatchCommandError: message => new Error(message),
  });
  vm.runInContext(
    `${source.slice(waitingStart, waitingEnd)}\n${source.slice(requiredStart, requiredEnd)}\n${source.slice(restoreStart, restoreEnd)}\nthis.restoreCheckpoint = factoryRuntimeControlRestoreProductCheckpoint;`,
    context,
  );
  return context.restoreCheckpoint;
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `production slice must be extractable: ${startMarker}`);
  return source.slice(start, end);
}

function loadRealRestoreCheckpoint(factory, options = {}) {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const hydrateSource = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const jobId = options.jobId || 'job-optionless-real-projection';
  const projectId = `batch:${jobId}`;
  const error = '색상옵션 값을 찾지 못했습니다.';
  const events = options.events || [];
  let currentFactory = factory;
  let currentRevision = options.revision ?? 11;
  const context = vm.createContext({
    Date,
    structuredClone,
    state: { currentProjectId: projectId, currentProjectName: '옵션 없음 복원', productInfoManualValues: {}, sectionVariants: {} },
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeReadViewSnapshot: () => ({ factory: currentFactory, competitors: { compPage: {} } }),
    factoryRuntimeReadFactory: () => currentFactory,
    factoryCurrentProductKey: value => value.product.currentProductKey,
    factoryCurrentWorkflowRunId: value => value.automation.currentRunId,
    factoryCurrentInputImageFingerprint: value => value.product.lockedInputImageFingerprint,
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ counter: currentRevision, scopeId: `project:${projectId}` }),
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => ({ revision: currentRevision, fence: 1 }) }),
    factoryControlProjectionSequence: 0,
    factoryCafe24TargetInfo: () => ({ productNo: options.productNo || '10' }),
    factoryRuntimeInspectBatchCafe24Registration: async () => ({
      status: 'ready', categoryId: '1', categoryLabel: '생활', htmlDigest: 'html', imageDigests: ['image'],
      expectedWorkfileRevision: 11, optionName: '', optionValues: [], variantCount: 0, inventoryQuantity: '99',
    }),
    factoryRuntimeBatchCafe24BindingMatches: () => false,
    factoryProjectFileImageFingerprint: value => value,
    factoryRuntimeControlCompPage: () => ({}),
    factoryAutomationReviewSummary: () => ({}),
    factoryAutomationCounts: () => ({}),
    factoryCurrentProductNameForIdentity: value => value.product.productName,
    factoryStageLabel: stageId => stageId,
    loadProjectRecord: async () => {
      events.push('load-local-project');
      return options.missingLocalProject === true ? null : true;
    },
    getCurrentDocumentWorkspaceScope: value => `project:${value}`,
    ensureWorkspaceEditAuthority: async scopeId => ({ mode: 'editing', scopeId }),
    factoryRuntimeUpdateOwnedFactory: async (_operation, _scope, mutate) => mutate(factory),
    factoryApplySelectedAssetsToSections: () => true,
    saveLastWorkNow: async () => true,
    factoryCafe24CurrentProductKey: () => '',
    factoryRuntimeBatchCommandError: message => new Error(message),
    ...(options.durableRestore ? {
      serverLastWorkHydrated: false,
      serverLastWorkHydrating: false,
      serverLastWorkHydrationPromise: null,
      workspaceBlankResetToken: 0,
      workspacePersistenceApi: () => ({
        restore: async () => {
          events.push('durable-read');
          return structuredClone(options.durableRestore);
        },
      }),
      getCurrentLastWorkWorkspaceScope: () => `project:${projectId}`,
      getCurrentDocumentWorkspaceScope: () => `project:${projectId}`,
      workspaceHydrationScopeIsCurrent: () => true,
      cloneData: structuredClone,
      lastWorkSnapshotMatchesWorkspaceScope: () => true,
      lastWorkSnapshotScore: () => 1,
      getCurrentLastWorkScore: () => 0,
      getCurrentLastWorkSavedAt: () => 0,
      lastWorkCompAnalysisTime: () => 0,
      lastWorkCompMarketScore: () => 0,
      getCurrentCompAnalysisTime: () => 0,
      snapshotSectionImagesQualityScore: () => 0,
      sectionImagesQualityScore: () => 0,
      optionSorterSnapshotIsMoreComplete: () => false,
      lastWorkOptionLabelsRestoreNeeded: () => false,
      persistedCutResultCount: () => 0,
      lastWorkRequiredFieldRestoreNeeded: () => false,
      lastWorkFactoryHasSelfConsistentCurrentAssets: () => false,
      snapshotHasInlineImagePayload: () => false,
      applyServerLastWorkSnapshot: snapshot => {
        const selectedRevision = Number(snapshot.workspaceRevision?.counter);
        events.push(`apply-selected-revision:${selectedRevision}`);
        currentRevision = selectedRevision;
        currentFactory = structuredClone(snapshot.assets.factory);
        return true;
      },
      markWorkspaceDocumentClean: () => {},
      sessionAssetsHydrated: false,
      workspaceScopeTransitionState: { persistentSaveQueued: false },
      setTimeout: () => 0,
      savePersistentState: async () => true,
    } : {}),
    ...(options.serverFactory ? {
      hydrateServerLastWorkSnapshot: async (hydrateOptions, validation) => {
        events.push(`hydrate-server:${JSON.stringify(hydrateOptions)}`);
        if (options.hydrationResult === false) return false;
        const serverSnapshot = {
          workspaceRevision: { counter: options.revision ?? 11, scopeId: `project:${projectId}` },
          assets: { currentProjectId: projectId, factory: structuredClone(options.serverFactory) },
        };
        if (typeof validation?.validateSnapshot === 'function'
          && validation.validateSnapshot(serverSnapshot) !== true) {
          events.push('hydrate-server:identity-rejected');
          return false;
        }
        currentFactory = structuredClone(options.serverFactory);
        return true;
      },
    } : {}),
  });
  const slices = [
    ...(options.durableRestore ? [
      sourceSlice(hydrateSource, 'function workspaceSnapshotRevision(', '\nfunction currentWorkspaceRevision('),
      sourceSlice(hydrateSource, 'async function hydrateServerLastWorkSnapshot(', '\nasync function refreshCompetitorAnalysisFromServer('),
    ] : []),
    sourceSlice(source, 'function factoryControlThumbnailReference', '\nfunction factoryRuntimeControlCompPage'),
    sourceSlice(source, 'function factoryControlCompetitorInputGroup', '\nfunction factoryControlAssetCandidate'),
    sourceSlice(source, 'function factoryControlAssetCandidate', '\nfunction createFactoryControlPreflightCache'),
    sourceSlice(source, 'function createFactoryControlPreflightCache', '\nasync function factoryRuntimeControlProjection'),
    sourceSlice(source, 'async function factoryRuntimeControlProjection()', '\nfunction factoryRuntimeControlAssertSelection'),
    sourceSlice(source, 'function factoryRuntimeControlProvidedColorOptionValues', '\nfunction factoryRuntimeControlWaitingStage'),
    sourceSlice(source, 'function factoryRuntimeControlWaitingStage', '\nfunction factoryRuntimeControlCheckpointProjectId'),
    sourceSlice(source, 'function factoryRuntimeControlCheckpointProjectId', '\nfunction factoryRuntimeControlValidateProductCheckpoint'),
    sourceSlice(source, 'function factoryRuntimeControlValidateProductCheckpoint', '\nfunction factoryRuntimeControlCheckpointFromProjection'),
    sourceSlice(source, 'function factoryRuntimeControlCheckpointFromProjection', '\nfunction factoryRuntimeControlProjectionMatchesCheckpoint'),
    sourceSlice(source, 'function factoryRuntimeControlProjectionMatchesCheckpoint', '\nasync function factoryRuntimeControlSaveProductCheckpoint'),
    sourceSlice(source, 'async function factoryRuntimeControlRestoreRequiredValues', '\nfunction factoryRuntimeControlCompetitorSnapshot'),
    sourceSlice(source, 'async function factoryRuntimeControlRestoreProductCheckpoint', '\nasync function factoryRuntimeControlPrepareProduct'),
  ];
  vm.runInContext(`${slices.join('\n')}\nthis.project = factoryRuntimeControlProjection;\nthis.restoreCheckpoint = factoryRuntimeControlRestoreProductCheckpoint;`, context);
  return {
    error,
    events,
    project: context.project,
    readFactory: () => structuredClone(currentFactory),
    restoreCheckpoint: context.restoreCheckpoint,
  };
}

function realProjectionFixture() {
  return {
    workspace: { id: 'batch:job-optionless-real-projection' },
    automation: { optionMode: 'pending', currentRunId: 'run-optionless-real-projection' },
    product: {
      currentProductKey: 'optionless-real-projection',
      lockedInputImageFingerprint: 'fixture-input',
      productName: '옵션 없음 복원 제품',
      finalDb: { material: '면' },
      requirementsSnapshot: { material: '면' },
      dbFieldSettings: { material: { manualValue: '면' } },
    },
    goalRun: { jobId: 'job-optionless-real-projection', status: 'blocked', failureReason: '색상옵션 값을 찾지 못했습니다.' },
    activeStage: 'options',
    stages: {
      hero: { status: 'done', selectedAssetIds: ['hero-a'] },
      size: { status: 'done', selectedAssetIds: ['size-a'] },
      options: { status: 'blocked', message: '색상옵션 값을 찾지 못했습니다.' },
      cuts: { status: 'idle' },
      detail: { status: 'idle' },
    },
    assets: [{ id: 'hero-a', stageId: 'hero', used: true }, { id: 'size-a', stageId: 'size', used: true }],
  };
}

function realProjectionPayload(requiredValues) {
  return {
    jobId: 'job-optionless-real-projection',
    productName: '옵션 없음 복원 제품',
    requiredValues,
    checkpoint: {
      schema: 'factory-product-checkpoint:v1',
      jobId: 'job-optionless-real-projection',
      projectId: 'batch:job-optionless-real-projection',
      productId: 'cafe24:10',
      productKey: 'optionless-real-projection',
      runId: 'run-optionless-real-projection',
      inputFingerprint: 'fixture-input',
      revision: 11,
      status: 'blocked',
      stageKey: 'option_color',
      savedAt: 1,
    },
  };
}

function bServerWorkfileFixture() {
  const jobId = 'factory-job-a66111b339304b5ab3f2b8de4fedf751';
  const productKey = '수동a컷검증미니데스크오거나이저b20260817';
  const runId = 'factory_work_run_b_retained';
  const inputFingerprint = 'sha256:b-retained-input';
  const stageIds = ['hero', 'size', 'options', 'cuts', 'detail'];
  return {
    workspace: { id: `batch:${jobId}` },
    batchJobId: jobId,
    automation: { currentRunId: runId },
    goalRun: { jobId, status: 'waiting_manual' },
    product: {
      currentProductKey: productKey,
      lockedInputImageFingerprint: inputFingerprint,
      productName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817',
      inputImages: [{ id: 'retained-input-1', name: '입력 1', role: 'base' }],
      finalDb: { categoryId: '1' },
    },
    stages: Object.fromEntries(stageIds.map(stageId => [stageId, { status: 'done' }])),
    assets: Array.from({ length: 47 }, (_, index) => ({
      id: `retained-output-${index + 1}`,
      stageId: stageIds[index % stageIds.length],
      used: true,
    })),
  };
}

test('optionMode none skips option_color while color and malformed modes keep the stage', () => {
  const waitingStage = loadWaitingStage();
  const projection = {
    stages: [
      { key: 'option_color', candidates: [{ id: 'color-a' }], selectedIds: [] },
      { key: 'general', candidates: [{ id: 'general-a' }], selectedIds: [] },
    ],
  };

  assert.equal(waitingStage(projection, { requiredValues: { optionMode: 'none' } }).key, 'general');
  assert.equal(waitingStage(projection, { requiredValues: { optionMode: 'provided' } }).key, 'option_color');
  assert.equal(waitingStage(projection, { requiredValues: {} }).key, 'option_color');
  assert.equal(waitingStage(projection, { requiredValues: { optionMode: 'unknown' } }).key, 'option_color');
});

test('goal-stage DAG skips options only for exact optionMode none', async () => {
  const noneCalls = [];
  const noneFactory = {
    automation: { optionMode: 'none' },
    product: { analysis: {} },
    goalRun: {
      maxLoops: 1,
      mode: 'auto',
      targets: { hero: 1, size: 1, options: 1, cuts: 1, detail: 0 },
      decisionModes: {},
    },
  };
  assert.equal(await loadGoalLoop(noneCalls)({ factory: noneFactory }), true);
  assert.deepEqual(noneCalls, ['cuts']);

  const colorCalls = [];
  const colorFactory = structuredClone(noneFactory);
  colorFactory.automation.optionMode = 'provided';
  assert.equal(await loadGoalLoop(colorCalls)({ factory: colorFactory }), false);
  assert.deepEqual(colorCalls, ['options']);
  assert.equal(colorFactory.goalRun.failureReason, '색상옵션 단계 실패/검수 필요');
});

test('restore skips stale option_color checkpoint for optionMode none without reducing progress', async () => {
  const projection = {
    progress: { status: 'blocked', stageKey: 'option_color', percent: 64 },
    inputs: [{ key: 'required-values', count: 6 }],
    stages: [
      { key: 'option_color', candidates: [{ id: 'color-a' }], selectedIds: [] },
      { key: 'general', label: '필수값', candidates: [{ id: 'general-a' }], selectedIds: [] },
    ],
  };
  const factory = { assets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
  const payload = {
    jobId: 'job-optionless',
    requiredValues: {
      material: '면', originCountry: '대한민국', size: '55cm', salePrice: '12000', usage: '포장', optionMode: 'none',
    },
    checkpoint: {
      schema: 'factory-product-checkpoint:v1',
      jobId: 'job-optionless',
      projectId: 'batch:job-optionless',
      productId: 'factory:job-optionless',
      productKey: 'job-optionless',
      runId: 'run-optionless',
      inputFingerprint: 'sha256:optionless',
      revision: 11,
      status: 'blocked',
      stageKey: 'option_color',
      savedAt: 1,
    },
  };

  const receipt = await loadRestoreCheckpoint(projection, factory)(payload);

  assert.equal(receipt.status, 'waiting_manual');
  assert.equal(receipt.stageKey, 'general');
  assert.equal(receipt.checkpoint.stageKey, 'general');
  assert.equal(receipt.projection.inputs[0].count, 6);
  assert.equal(factory.assets.length, 4);
  assert.equal(Object.keys(payload.requiredValues).length, 6);
});

test('restore-only uses the production projection and receipt for B-shaped optionless state', async () => {
  const factory = realProjectionFixture();
  const { error, project, restoreCheckpoint } = loadRealRestoreCheckpoint(factory);
  const before = {
    automation: structuredClone(factory.automation),
    progress: await project(),
    goalFailure: factory.goalRun.failureReason,
    material: factory.product.finalDb.material,
    assets: factory.assets.length,
  };
  const payload = realProjectionPayload({ material: '면', stock: '99', optionMode: 'none' });
  const receipt = await restoreCheckpoint(payload);
  const repeatedReceipt = await restoreCheckpoint(payload);
  const observable = {
    before,
    after: {
      automation: structuredClone(factory.automation),
      progress: receipt.projection.progress,
      goalFailure: factory.goalRun.failureReason,
      material: factory.product.finalDb.material,
      assets: factory.assets.length,
    },
    receipt: { status: receipt.status, stageKey: receipt.stageKey, message: receipt.message },
    repeatedReceipt: { status: repeatedReceipt.status, stageKey: repeatedReceipt.stageKey, message: repeatedReceipt.message },
  };
  if (process.env.OPTIONLESS_RESTORE_QA === '1') console.log(`OPTIONLESS_RESTORE_QA=${JSON.stringify(observable)}`);

  assert.equal(observable.before.automation.optionMode, 'pending');
  assert.equal(observable.before.progress.progress.status, 'blocked');
  assert.equal(observable.before.progress.progress.message, error);
  assert.equal(observable.after.automation.optionMode, 'none');
  assert.deepEqual(observable.receipt, { status: 'waiting_manual', stageKey: '', message: '제품 체크포인트 복원 완료 · A컷 선택을 이어가세요.' });
  assert.deepEqual(observable.repeatedReceipt, observable.receipt);
  assert.equal(JSON.stringify(observable.after.progress), JSON.stringify({
    stageKey: '', stageLabel: '', percent: 0, elapsedMs: 0, mode: 'manual', status: 'manual', message: '',
  }));
  assert.ok(!observable.receipt.message.includes(error));
  assert.equal(observable.after.goalFailure, '');
  assert.equal(observable.after.assets, 2);
  assert.equal(observable.after.material, '면');
  assert.equal(factory.product.requirementsSnapshot.material, '면');
});

test('missing local B project record hydrates the retained server workfile before exact restore', async () => {
  const jobId = 'factory-job-a66111b339304b5ab3f2b8de4fedf751';
  const serverFactory = bServerWorkfileFixture();
  const checkpoint = {
    schema: 'factory-product-checkpoint:v1',
    jobId,
    projectId: `batch:${jobId}`,
    productId: 'cafe24:10',
    productKey: serverFactory.product.currentProductKey,
    runId: serverFactory.automation.currentRunId,
    inputFingerprint: serverFactory.product.lockedInputImageFingerprint,
    revision: 11,
    status: 'waiting_manual',
    stageKey: 'general',
    savedAt: 1,
  };
  const events = [];
  const localFactory = {
    workspace: { id: checkpoint.projectId },
    batchJobId: jobId,
    automation: {},
    goalRun: { jobId },
    product: {},
    stages: {},
    assets: [],
  };
  const runtime = loadRealRestoreCheckpoint(localFactory, {
    events,
    jobId,
    missingLocalProject: true,
    serverFactory,
  });
  assert.equal((await runtime.project()).connected, false, 'fixture must start without a local project payload');

  const receipt = await runtime.restoreCheckpoint({ jobId, checkpoint });
  const retainedOutputCount = receipt.projection.stages.reduce(
    (count, stage) => count + stage.candidates.length,
    0,
  );
  const retainedInputCount = runtime.readFactory().product.inputImages.length;
  if (process.env.CHECKPOINT_HYDRATION_QA === '1') {
    console.log(`CHECKPOINT_HYDRATION_QA=${JSON.stringify({
      events,
      receipt: { status: receipt.status, stageKey: receipt.stageKey, session: receipt.projection.session },
      retainedInputCount,
      retainedOutputCount,
    })}`);
  }

  assert.deepEqual(events.slice(0, 2), [
    'load-local-project',
    'hydrate-server:{"force":true,"forceRevisionRestore":true,"render":false}',
  ]);
  assert.equal(receipt.schema, 'factory-product-run-receipt:v1');
  for (const [field, value] of Object.entries({
    workspaceId: checkpoint.projectId,
    productId: checkpoint.productId,
    productKey: checkpoint.productKey,
    runId: checkpoint.runId,
    inputFingerprint: checkpoint.inputFingerprint,
    revision: checkpoint.revision,
  })) {
    assert.equal(receipt.projection.session[field], value, `hydrated ${field} must match checkpoint`);
  }
  assert.equal(retainedInputCount, 1, 'hydration must retain the one server input');
  assert.equal(runtime.readFactory().assets.length, 47, 'hydration must retain all 47 server outputs');
  assert.equal(retainedOutputCount, 47, 'production projection must expose all retained outputs');

  const mismatchedRuntime = loadRealRestoreCheckpoint(localFactory, {
    events: [],
    jobId,
    missingLocalProject: true,
    serverFactory: { ...serverFactory, automation: { ...serverFactory.automation, currentRunId: 'foreign-run' } },
  });
  await assert.rejects(
    mismatchedRuntime.restoreCheckpoint({ jobId, checkpoint }),
    error => error?.message === 'factory_product_checkpoint_restore_mismatch',
    'post-hydration identity drift must fail with the typed mismatch reason',
  );
});

test('cold durable B restore uses the selected snapshot revision instead of the storage record revision', async () => {
  const jobId = 'factory-job-a66111b339304b5ab3f2b8de4fedf751';
  const serverFactory = bServerWorkfileFixture();
  const checkpoint = {
    schema: 'factory-product-checkpoint:v1',
    jobId,
    projectId: `batch:${jobId}`,
    productId: 'cafe24:10',
    productKey: serverFactory.product.currentProductKey,
    runId: serverFactory.automation.currentRunId,
    inputFingerprint: serverFactory.product.lockedInputImageFingerprint,
    revision: 20,
    status: 'blocked',
    stageKey: 'option_color',
    savedAt: 1,
  };
  const durableRestore = {
    revision: { counter: 4, scopeId: `project:${jobId}` },
    snapshot: {
      assets: {
        currentProjectId: checkpoint.projectId,
        workspaceRevision: { counter: checkpoint.revision, scopeId: `project:${jobId}` },
        factory: serverFactory,
      },
    },
  };
  const localFactory = {
    workspace: { id: checkpoint.projectId }, batchJobId: jobId, automation: {}, goalRun: { jobId },
    product: {}, stages: {}, assets: [],
  };
  const events = [];
  const runtime = loadRealRestoreCheckpoint(localFactory, {
    durableRestore, events, jobId, missingLocalProject: true,
  });
  const receipt = await runtime.restoreCheckpoint({ jobId, checkpoint });
  const retainedOutputCount = receipt.projection.stages.reduce((count, stage) => count + stage.candidates.length, 0);
  assert.equal(receipt.projection.session.revision, checkpoint.revision);
  assert.equal(runtime.readFactory().product.inputImages.length, 1);
  assert.equal(retainedOutputCount, 47);
  assert.deepEqual(events.slice(0, 3), [
    'load-local-project', 'durable-read', `apply-selected-revision:${checkpoint.revision}`,
  ]);

  const foreignRuntime = loadRealRestoreCheckpoint(structuredClone(localFactory), {
    durableRestore: {
      ...durableRestore,
      snapshot: {
        ...durableRestore.snapshot,
        assets: { ...durableRestore.snapshot.assets, workspaceRevision: { counter: 19, scopeId: `project:${jobId}` } },
      },
    },
    jobId, missingLocalProject: true,
  });
  let foreignReason = '';
  await assert.rejects(
    foreignRuntime.restoreCheckpoint({ jobId, checkpoint }),
    error => {
      foreignReason = error?.message || '';
      return foreignReason === 'factory_product_checkpoint_restore_mismatch';
    },
  );
  if (process.env.CHECKPOINT_DURABLE_REVISION_QA === '1') {
    console.log(`CHECKPOINT_DURABLE_REVISION_QA=${JSON.stringify({
      durableRecordRevision: durableRestore.revision.counter,
      selectedSnapshotRevision: receipt.projection.session.revision,
      checkpointRevision: checkpoint.revision,
      retainedInputCount: runtime.readFactory().product.inputImages.length,
      retainedOutputCount,
      foreignReason,
      events,
    })}`);
  }
});

test('missing local checkpoint rejects mismatched server state before takeover and keeps hydration failure typed', async () => {
  const jobId = 'factory-job-a66111b339304b5ab3f2b8de4fedf751';
  const serverFactory = bServerWorkfileFixture();
  const checkpoint = {
    schema: 'factory-product-checkpoint:v1',
    jobId,
    projectId: `batch:${jobId}`,
    productId: 'cafe24:10',
    productKey: serverFactory.product.currentProductKey,
    runId: serverFactory.automation.currentRunId,
    inputFingerprint: serverFactory.product.lockedInputImageFingerprint,
    revision: 11,
    status: 'waiting_manual',
    stageKey: 'general',
    savedAt: 1,
  };
  const currentA = {
    workspace: { id: checkpoint.projectId },
    batchJobId: jobId,
    automation: { currentRunId: 'a-current-run' },
    goalRun: { jobId: 'factory-job-current-a' },
    product: {
      currentProductKey: 'current-a-product',
      lockedInputImageFingerprint: 'sha256:current-a-input',
      productName: '현재 A 상태',
      inputImages: [{ id: 'a-input-1' }, { id: 'a-input-2' }],
    },
    stages: { hero: { selectedAssetIds: ['a-output-1'] } },
    assets: [{ id: 'a-output-1', stageId: 'hero', used: true }, { id: 'a-output-2', stageId: 'size', used: true }],
  };
  const aBefore = structuredClone(currentA);
  const mismatchEvents = [];
  const mismatchedRuntime = loadRealRestoreCheckpoint(currentA, {
    events: mismatchEvents,
    jobId,
    missingLocalProject: true,
    serverFactory: { ...serverFactory, automation: { ...serverFactory.automation, currentRunId: 'foreign-run' } },
  });
  let mismatchReason = '';
  await assert.rejects(
    mismatchedRuntime.restoreCheckpoint({ jobId, checkpoint }),
    error => {
      mismatchReason = error?.message || '';
      return mismatchReason === 'factory_product_checkpoint_restore_mismatch';
    },
  );
  assert.equal(JSON.stringify(mismatchedRuntime.readFactory()), JSON.stringify(aBefore));
  assert.deepEqual(mismatchEvents, [
    'load-local-project',
    'hydrate-server:{"force":true,"forceRevisionRestore":true,"render":false}',
    'hydrate-server:identity-rejected',
  ]);

  const failedHydrationEvents = [];
  const failedHydrationRuntime = loadRealRestoreCheckpoint(structuredClone(aBefore), {
    events: failedHydrationEvents,
    hydrationResult: false,
    jobId,
    missingLocalProject: true,
    serverFactory,
  });
  let hydrationFailureReason = '';
  await assert.rejects(
    failedHydrationRuntime.restoreCheckpoint({ jobId, checkpoint }),
    error => {
      hydrationFailureReason = error?.message || '';
      return hydrationFailureReason === 'factory_product_checkpoint_hydration_failed';
    },
  );
  assert.equal(JSON.stringify(failedHydrationRuntime.readFactory()), JSON.stringify(aBefore));
  if (process.env.CHECKPOINT_HYDRATION_QA === '1') {
    console.log(`CHECKPOINT_HYDRATION_REJECTION_QA=${JSON.stringify({
      mismatchReason,
      hydrationFailureReason,
      currentAUnchanged: JSON.stringify(mismatchedRuntime.readFactory()) === JSON.stringify(aBefore),
      mismatchEvents,
      failedHydrationEvents,
    })}`);
  }
});

test('production restore leaves provided, absent, and malformed option modes blocked at color', async () => {
  for (const requiredValues of [{ optionMode: 'provided' }, {}, { optionMode: 'unknown' }]) {
    const factory = realProjectionFixture();
    const { error, restoreCheckpoint } = loadRealRestoreCheckpoint(factory);
    const receipt = await restoreCheckpoint(realProjectionPayload(requiredValues));
    assert.equal(factory.automation.optionMode, 'pending');
    assert.equal(receipt.status, 'blocked');
    assert.equal(receipt.projection.progress.stageKey, 'options');
    assert.equal(receipt.projection.progress.message, error);
    assert.equal(factory.assets.length, 2);
  }
});
