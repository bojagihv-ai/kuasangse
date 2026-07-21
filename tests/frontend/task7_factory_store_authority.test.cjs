'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const PRODUCTION_FACTORY_READERS = Object.freeze([
  'src/app-core-02.js',
  'src/app-core-03.js',
  'src/app-core-05.js',
  'src/app-core-06.js',
  'src/cafe24-api.js',
  'src/cafe24-fields.js',
  'src/cafe24-options.js',
  'src/cafe24-payloads.js',
  'src/cafe24-product-form.js',
  'src/cafe24-sync.js',
]);

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

async function importFresh(relativePath, label) {
  const url = pathToFileURL(path.join(ROOT, relativePath));
  url.searchParams.set('authority-test', `${label}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function initialSnapshot(count = 1) {
  return {
    factory: { nested: { count }, automation: { activeTab: 'start' } },
    productDb: {},
    competitors: {},
    factoryAssets: {},
    detailDocument: {},
    cafe24: {},
  };
}

async function createB2AutomationRuntimeHarness(label) {
  const core = source('src/app-core-03.js');
  const factoryCore = source('src/app-core-06.js');
  const createRuntimePolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', `b2-${label}`);
  const factoryValue = () => ({
    product: { analysis: { product_name: 'B2 테스트 상품' } },
    automation: {},
    goalRun: {
      running: false,
      stopRequested: false,
      failureReason: '',
      progress: 0,
      currentStage: '',
      targets: { hero: 1, size: 0, options: 0, cuts: 0, detail: 0 },
      maxLoops: 1,
      mode: 'auto',
    },
    stages: {
      db: { status: 'idle' },
      hero: { status: 'idle' },
      size: { status: 'idle' },
      options: { status: 'idle' },
      cuts: { status: 'idle' },
      detail: { status: 'idle' },
      export: { status: 'idle' },
    },
    assets: [],
    previousAssets: [],
    detailPlacement: {},
    archive: {},
    logs: [],
    logStageId: '',
    activeStage: '',
    uiPanels: {},
    openMarketSync: {},
  });
  const snapshotValue = () => ({
    factory: factoryValue(),
    productDb: {},
    competitors: {},
    factoryAssets: {},
    detailDocument: {},
    cafe24: {},
  });
  const store = createFactoryStore({
    initialSnapshot: snapshotValue(),
    workspaceId: `workspace-b2-${label}`,
    commandPolicies: createRuntimePolicies(),
  });
  const events = [];
  const sideEffects = { log: 0, save: 0, render: 0 };
  const controls = {
    currentCommand: '',
    onStage: async () => true,
    onArchive: async () => true,
  };
  const staleError = action => Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${action}`), {
    code: 'STALE_FACTORY_RUNTIME_ACTION',
  });
  const context = vm.createContext({
    state: { analysis: null, sectionBatchRun: null },
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeStaleActionError: staleError,
    factoryRuntimeUpdateOwnedFactory: (command, owner, mutator) => {
      const token = store.getOperationToken();
      controls.currentCommand = command;
      events.push(`command-open:${owner}:${command}`);
      const transaction = store.updateDraft(
        mutator,
        { owner, expectedRevision: token.revision },
        command,
      );
      const finish = receipt => {
        events.push(`command-commit:${command}`);
        return receipt;
      };
      return transaction && typeof transaction.then === 'function'
        ? Promise.resolve(transaction).then(finish)
        : finish(transaction);
    },
    factoryStageLabel: stageId => `stage:${stageId}`,
    factoryRunStage: async (stageId, options) => {
      events.push(`external-stage:${stageId}`);
      return controls.onStage(stageId, options);
    },
    factoryArchiveSession: async options => {
      events.push('external-archive');
      return controls.onArchive(options);
    },
    factorySelectedUsableAssets: (stageId, factory) => (factory.assets || []).filter(asset => asset.stageId === stageId),
    factoryUsableAssetsForStage: (stageId, factory) => (factory.assets || []).filter(asset => asset.stageId === stageId),
    factoryHasSizeFacts: () => true,
    factoryUpdateFromInputs: () => true,
    factorySetStageStatus: (stageId, status, message, factory) => {
      factory.stages[stageId] = { ...(factory.stages[stageId] || {}), status, message };
      return true;
    },
    factoryLog: (message, tone, factory) => {
      sideEffects.log += 1;
      factory.logs = [{ message, tone }, ...(factory.logs || [])];
      return true;
    },
    factorySetGoalRunProgress: (progress, stage, message, tone, options = {}) => {
      const factory = options.factory;
      if (factory) {
        factory.goalRun.progress = Number(progress || 0);
        if (stage) factory.goalRun.currentStage = stage;
        if (options.failureReason !== undefined) factory.goalRun.failureReason = options.failureReason;
      }
      return progress;
    },
    factoryGoalProgressClamp: value => Math.max(0, Math.min(100, Number(value || 0))),
    factoryPatchGoalRunStatusInPlace: () => true,
    factoryRuntimeRenderWithOwnedDraft: (_factory, renderer) => {
      if (typeof renderer === 'function') return renderer();
      sideEffects.render += 1;
      return undefined;
    },
    factoryEnsureSizeImageReviewConfirmedForRun: () => ({ ok: true, autoConfirmed: false }),
    factoryScheduleRunStageFeedbackSave: () => { sideEffects.save += 1; },
    factoryYieldToPaint: async () => true,
    saveLastWorkNow: () => { sideEffects.save += 1; },
    render: () => { sideEffects.render += 1; },
  });
  const automationSource = sourceSlice(
    factoryCore,
    'function factoryRequireCurrentRunOperation(',
    'function factoryMakeSessionFolderName(',
  );
  const stageButtonSource = sourceSlice(
    factoryCore,
    'async function factoryHandleRunStageButton(',
    '// ── bindEvents 확장 (조립공장) ──',
  );
  vm.runInContext(`${automationSource}\n${stageButtonSource}\nthis.b2Workers = Object.freeze({
    auto: factoryRunAuto,
    goal: factoryRunGoalLoop,
    stage: factoryHandleRunStageButton,
    stop: factoryStopGoalRun,
  });`, context);
  return { context, controls, events, factoryValue, sideEffects, snapshotValue, store };
}

test('B2 production source has no factoryState-equivalent live selector or refresh-after-mutate mirror', () => {
  const forbidden = [
    /\bfactoryState\b/g,
    /classicFactoryStateSelectors/g,
    /factoryRuntimeLegacySnapshot/g,
    /factoryRuntimeRefreshStore/g,
    /factoryRuntimeMarkRefresh/g,
  ];
  const offenders = PRODUCTION_FACTORY_READERS.flatMap(relativePath => {
    const text = source(relativePath);
    return forbidden.flatMap(pattern => {
      const count = [...text.matchAll(pattern)].length;
      return count ? [`${relativePath}:${pattern.source}:${count}`] : [];
    });
  });
  assert.deepEqual(offenders, []);
});

test('field commands allow their factory-owned wizard activity timestamp', () => {
  const core = source('src/app-core-03.js');
  const createRuntimePolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  const policy = createRuntimePolicies()['factory/fields:commitField'];
  const factoryPaths = policy.parts
    .filter(part => part.owner === 'factory')
    .flatMap(part => part.paths);

  assert.equal(factoryPaths.includes('automation.lastWizardActionAt'), true);
});

test('B3 production action bridge commits through the owned store draft transaction', async () => {
  const core = source('src/app-core-03.js');
  const persistenceCore = source('src/app-core-02.js');
  const identityRepairWriter = sourceSlice(
    persistenceCore,
    'function repairRestoredSessionIdentityDrift(',
    'async function hydratePersistentSessionAssets(',
  );
  assert.doesNotMatch(identityRepairWriter, /factoryRuntimeReadFactory\(\)/);
  assert.match(identityRepairWriter, /function repairRestoredSessionIdentityDrift\(reason = 'restore', factory\)/);
  assert.match(core, /repairRestoredSessionIdentityDrift\('startup', state\.factory\)/);
  const workspaceStampWriter = sourceSlice(
    core,
    'function factoryStampWorkspaceIdentity(',
    'function factoryStampItemWorkspaceIdentity(',
  );
  const productIdentityWriter = sourceSlice(
    core,
    'function factorySetCurrentProductIdentity(',
    'function factoryAuthoritativeProductName(',
  );
  const lockedInputWriter = sourceSlice(
    core,
    'function factoryStampLockedInputImage(',
    'function factoryRepairProductImagePayloadDrift(',
  );
  const visualLogWriter = sourceSlice(
    core,
    'function factoryVisualValidationLogOnce(',
    'function factoryScheduleVisualValidationRender(',
  );
  const visualStageWriter = sourceSlice(
    core,
    'function factoryRefreshStageAfterVisualValidation(',
    'function factoryScheduleAssetVisualValidation(',
  );
  const visualCompletionWriter = sourceSlice(
    core,
    'function factoryScheduleAssetVisualValidation(',
    'function factoryHasDeclaredProductImage(',
  );
  const workflowRunWriter = sourceSlice(
    core,
    'function factoryStartNewWorkflowRun(',
    'function factoryCurrentJobKey(',
  );
  const productImageSyncWriter = sourceSlice(
    core,
    'function syncProductImageAcrossWorkspaces(',
    'function factoryStageStatusClass(',
  );
  for (const writer of [
    workspaceStampWriter,
    productIdentityWriter,
    lockedInputWriter,
    visualLogWriter,
    visualStageWriter,
    workflowRunWriter,
    productImageSyncWriter,
  ]) {
    assert.doesNotMatch(writer, /(?:=|\|\|)\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(productIdentityWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:setCurrentProductIdentity/);
  assert.match(visualCompletionWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:completeVisualValidation/);
  assert.doesNotMatch(visualCompletionWriter, /const\s+liveFactory\s*=\s*factoryRuntimeReadFactory\(\)/);
  assert.match(productImageSyncWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:syncProductImageAcrossWorkspaces/);
  assert.match(core, /goFactoryStart\(\)[\s\S]*factoryRuntimeUpdateOwnedFactory\('factory:selectFactoryTab'/);
  for (const command of [
    'factory/runtime:setCurrentProductIdentity',
    'factory/runtime:completeVisualValidation',
    'factory/runtime:syncProductImageAcrossWorkspaces',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  const factoryCore = source('src/app-core-06.js');
  const sourceEnsureWriter = sourceSlice(
    factoryCore,
    'async function factoryEnsureSourceImagePart(',
    'function factoryCommitSourceImageAsLockedInput(',
  );
  const sourceCommitWriter = sourceSlice(
    factoryCore,
    'function factoryCommitSourceImageAsLockedInput(',
    'function factoryApplyCommittedSourceImageComposition(',
  );
  const sourcePromotionWriter = sourceSlice(
    factoryCore,
    'async function factoryPromoteStoredProductCandidateToInput(',
    'function factoryScheduleStoredProductCandidatePromotion(',
  );
  const sourceArchiveTimerWriter = sourceSlice(
    factoryCore,
    'function factoryScheduleCurrentInputArchiveRestore(',
    'function factoryClearVmCompetitorData(',
  );
  const runtimeStartActions = sourceSlice(
    core,
    'function factoryRuntimeStartActions(',
    'function factoryRuntimeDbActions(',
  );
  assert.match(sourceEnsureWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/source:ensureLockedInput/);
  assert.match(sourceEnsureWriter, /store\.isOperationCurrent\(operationToken\)/);
  assert.doesNotMatch(sourceEnsureWriter, /(?:const|let|var)\s+factory\s*=\s*(?:options\.factory\s*\|\|\s*)?factoryRuntimeReadFactory\(\)/);
  assert.doesNotMatch(sourceCommitWriter, /state\.image(?:Base64|Mime|Preview|Name)\s*=/);
  assert.match(sourcePromotionWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/source:promoteStoredProductInput/);
  assert.match(sourcePromotionWriter, /factoryPromoteStoredProductCandidateToInputDraft\([\s\S]*operationToken/);
  assert.match(sourcePromotionWriter, /store\.isOperationCurrent\(operationToken\)/);
  assert.doesNotMatch(sourcePromotionWriter, /syncProductImageAcrossWorkspaces\(/);
  assert.doesNotMatch(sourcePromotionWriter, /factoryApplyProductToApp\(/);
  assert.doesNotMatch(sourcePromotionWriter, /state\.image(?:Base64|Mime|Preview|Name)\s*=/);
  assert.match(sourceArchiveTimerWriter, /const scheduledToken = store\.getOperationToken\(\)/);
  assert.match(sourceArchiveTimerWriter, /factorySourceOperationIdentityMatches\(scheduledIdentity/);
  assert.match(sourceArchiveTimerWriter, /operationToken = store\.getOperationToken\(\)/);
  assert.match(sourceArchiveTimerWriter, /factoryCommitInputArchiveRestoreStatus\(/);
  assert.match(sourceArchiveTimerWriter, /archive: false/);
  assert.doesNotMatch(sourceArchiveTimerWriter, /(?:const|let)\s+restored\s*=\s*factoryRuntimeReadFactory\(\)/);
  assert.match(runtimeStartActions, /factoryPromoteStoredProductCandidateToInput\(\{[\s\S]*factory: current,[\s\S]*operationToken/);
  assert.match(runtimeStartActions, /factoryFinalizeStoredProductPromotion\(promotionResult,[\s\S]*receipt\.operationToken/);
  for (const command of [
    'factory/source:ensureLockedInput',
    'factory/source:promoteStoredProductInput',
    'factory/source:setInputArchiveRestoreStatus',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  const dbCandidateWriter = sourceSlice(
    factoryCore,
    'async function factoryRunDbCandidatesForSelection(',
    'function factoryBeginCandidateProgramStart(',
  );
  const candidateProgramWriter = sourceSlice(
    factoryCore,
    'async function factoryRunCandidateProgramStart(',
    'async function factoryStartSinhwaDbAndRerunCandidates(',
  );
  const oauthLoginWriter = sourceSlice(
    factoryCore,
    'function factoryOpenCafe24OAuthLogin(',
    'function factoryBeginCafe24OAuthStatusCheck(',
  );
  const oauthStatusWriter = sourceSlice(
    factoryCore,
    'async function factoryRefreshCafe24OAuthStatus(',
    'async function factoryRunVmCompetitorCollectionForSelection(',
  );
  const runtimeDbActions = sourceSlice(
    core,
    'function factoryRuntimeDbActions(',
    'function factoryRuntimeDbHelpers(',
  );
  assert.match(dbCandidateWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:runCandidatesForSelection/);
  assert.match(dbCandidateWriter, /await factoryRunDbStage\(\{ factory, operationToken \}\)[\s\S]*store\.isOperationCurrent\(operationToken\)/);
  assert.doesNotMatch(dbCandidateWriter, /options\.factory\s*\|\|\s*factoryRuntimeReadFactory\(\)/);
  assert.match(candidateProgramWriter, /await startProgram\(\)[\s\S]*store\.isOperationCurrent\(operationToken\)/);
  assert.match(candidateProgramWriter, /factoryCommitCandidateProgramState\([\s\S]*operationToken = store\.getOperationToken\(\)/);
  assert.match(candidateProgramWriter, /factoryRunDbCandidatesForSelection\(\{ operationToken \}\)/);
  assert.equal((oauthLoginWriter.match(/store\.isOperationCurrent\(operationToken\)/g) || []).length >= 3, true);
  assert.match(oauthLoginWriter, /window\.open\([\s\S]*factoryApplyCafe24OAuthLoginResult\(factory, mallId, opened\)/);
  assert.match(oauthStatusWriter, /await fetchCafe24OAuthStatus\(mallId\)[\s\S]*store\.isOperationCurrent\(operationToken\)/);
  assert.match(oauthStatusWriter, /String\(status\?\.mallId \|\| mallId\)\.trim\(\) !== mallId/);
  assert.match(oauthStatusWriter, /factoryCommitCafe24OAuthStatus\('ready',[\s\S]*operationToken = store\.getOperationToken\(\)/);
  assert.match(runtimeDbActions, /factoryBeginCandidateProgramStart\('sinhwa', draft\)[\s\S]*factoryStartSinhwaDbAndRerunCandidates\(\{[\s\S]*operationToken: receipt\.operationToken/);
  assert.match(runtimeDbActions, /factoryBeginCandidateProgramStart\('cafe24', draft\)[\s\S]*factoryStartCafe24ControlAndRerunCandidates\(\{[\s\S]*operationToken: receipt\.operationToken/);
  assert.match(runtimeDbActions, /factoryBeginCafe24OAuthStatusCheck\(draft\)[\s\S]*factoryRefreshCafe24OAuthStatus\(\{[\s\S]*operationToken: receipt\.operationToken/);
  assert.match(runtimeDbActions, /factoryOpenCafe24OAuthLogin\(\{[\s\S]*factory: draft,[\s\S]*operationToken/);
  assert.equal((runtimeDbActions.match(/factoryRuntimeRequireCurrentFollowupReceipt\(/g) || []).length, 4);
  assert.doesNotMatch(runtimeDbActions, /draft => factory(?:StartSinhwaDbAndRerunCandidates|StartCafe24ControlAndRerunCandidates|RefreshCafe24OAuthStatus)\(/);
  for (const command of [
    'factory/db:runCandidatesForSelection',
    'factory/db:setCandidateProgramState',
    'factory/db:openCafe24OAuthLogin',
    'factory/db:setCafe24OAuthStatus',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  const vmCandidateWriter = sourceSlice(
    factoryCore,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  const analysisEnsureWriter = sourceSlice(
    factoryCore,
    'async function factoryEnsureCurrentProductImageAnalysisForOneClick(',
    'async function factoryRunCurrentProductImageAnalysisOnly(',
  );
  const analysisOnlyWriter = sourceSlice(
    factoryCore,
    'async function factoryRunCurrentProductImageAnalysisOnly(',
    'async function factoryYieldToPaint(',
  );
  const dbOneClickWriter = sourceSlice(
    factoryCore,
    'async function factoryRunDbCompetitorHeroCutsFlow(',
    'async function factoryRunDbVmCandidatesOnlyFlow(',
  );
  const runtimeCompetitorMarket = sourceSlice(
    core,
    'function factoryRuntimeCompetitorMarketAction(',
    'function factoryRuntimeCompetitorHelpers(',
  );
  for (const writer of [vmCandidateWriter, analysisEnsureWriter, analysisOnlyWriter, dbOneClickWriter]) {
    assert.doesNotMatch(writer, /factoryRuntimeReadFactory\(\)/);
    assert.match(writer, /store\.isOperationCurrent\(operationToken\)/);
  }
  assert.match(vmCandidateWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/competitor:runVmCandidatesForSelection/);
  assert.match(analysisOnlyWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:runCurrentProductAnalysisOnly/);
  assert.match(analysisOnlyWriter, /factoryEnsureCurrentProductImageAnalysisForOneClick\(\{[\s\S]*factory,[\s\S]*operationToken/);
  assert.match(dbOneClickWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:runDb/);
  assert.match(dbOneClickWriter, /factoryRunVmCompetitorCollectionForSelection\(\{ factory, operationToken \}\)/);
  assert.match(runtimeCompetitorMarket, /factoryRuntimeRequireCurrentFollowupReceipt\('factory\/competitor:market:quick-action', receipt\)/);
  assert.match(runtimeCompetitorMarket, /factoryRunVmCompetitorCollectionForSelection\(\{ operationToken: receipt\.operationToken \}\)/);
  assert.doesNotMatch(runtimeCompetitorMarket, /if \(quickAction === 'start-vm'\) return factoryRunVmCompetitorCollectionForSelection\(\)/);
  for (const command of [
    'factory/competitor:runVmCandidatesForSelection',
    'factory/db:runCurrentProductAnalysisOnly',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  const autoWriter = sourceSlice(
    factoryCore,
    'async function factoryRunAuto(',
    'function factoryGoalAssetCount(',
  );
  const goalLoopWriter = sourceSlice(
    factoryCore,
    'async function factoryRunGoalLoop(',
    'function factoryMakeSessionFolderName(',
  );
  const stageButtonWriter = sourceSlice(
    factoryCore,
    'async function factoryHandleRunStageButton(',
    '// ── bindEvents 확장 (조립공장) ──',
  );
  for (const writer of [autoWriter, goalLoopWriter, stageButtonWriter]) {
    assert.doesNotMatch(writer, /factoryRuntimeReadFactory\(\)/);
    assert.match(writer, /factoryRequireCurrentRunOperation\(/);
    assert.match(writer, /operationSignal/);
    assert.match(writer, /factoryRuntimeUpdateOwnedFactory\(/);
  }
  for (const writer of [autoWriter, goalLoopWriter]) {
    assert.doesNotMatch(writer, /(?:store\.)?getSnapshot\(\)/);
  }
  assert.match(autoWriter, /factory\/automation:runAuto/);
  assert.match(autoWriter, /acquireOperationLease\('factory\/automation:goal-run'/);
  assert.match(goalLoopWriter, /factory\/automation:runGoalLoop/);
  assert.match(goalLoopWriter, /acquireOperationLease\('factory\/automation:goal-run'/);
  assert.match(goalLoopWriter, /factoryArchiveSession\(\{[\s\S]*factory,[\s\S]*operationToken/);
  assert.match(autoWriter, /stoppedByUser \? 'warn'[\s\S]*factory,\s*\n\s*\);/);
  assert.match(goalLoopWriter, /stoppedByUser \? 'warn'[\s\S]*factory,\s*\n\s*\);/);
  assert.match(stageButtonWriter, /factory\/assets:handleRunStageButton/);
  assert.match(stageButtonWriter, /acquireOperationLease\('factory\/assets:stage-run'/);
  const stopGoalWriter = sourceSlice(
    factoryCore,
    'function factoryStopGoalRun(',
    'async function factoryRunAuto(',
  );
  assert.match(stopGoalWriter, /cancelOperationLease\('factory\/automation:goal-run'/);
  assert.match(stopGoalWriter, /cancelOperationLease\('factory\/assets:stage-run'/);
  assert.match(stopGoalWriter, /factory\/automation:stopGoalRun/);
  const stopGoalHandler = sourceSlice(
    factoryCore,
    "const stopGoal = document.getElementById('factoryStopGoal');",
    '// ── bindEvents 확장 (이미지컷) ──',
  );
  assert.match(stopGoalHandler, /stopGoal\.onclick = \(\) => factoryStopGoalRun\(\)/);
  for (const command of [
    'factory/automation:runAuto',
    'factory/automation:runGoalLoop',
    'factory/assets:handleRunStageButton',
    'factory/automation:stopGoalRun',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  const dbSizeWriterSlices = [
    sourceSlice(factoryCore, 'function factoryDbSizeManualScopeBucket(', 'function factoryDbSizeScopedManualValueForField('),
    sourceSlice(factoryCore, 'function factorySyncDbSizeManualValue(', 'function factoryApplyDbSizeManualValue('),
    sourceSlice(factoryCore, 'function factoryDbSizeDrafts(', 'function factoryDbSizeCheckpointScope('),
    sourceSlice(factoryCore, 'function factoryRestoreDbSizeDraftsFromInputCheckpoint(', 'function factorySetDbSizeManualDraft('),
    sourceSlice(factoryCore, 'function factorySetDbSizeManualDraft(', 'function factoryCommitDbSizeManualDraft('),
    sourceSlice(factoryCore, 'function factoryCommitDbSizeManualDraft(', 'function factoryCommitVisibleDbSizeManualDrafts('),
  ];
  for (const writer of dbSizeWriterSlices) {
    assert.doesNotMatch(writer, /(?:=|\|\|)\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(dbSizeWriterSlices[4], /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:setSizeManualDraft/);
  assert.match(dbSizeWriterSlices[5], /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:commitSizeManualDraft/);
  const app06ExplicitWriters = [
    sourceSlice(factoryCore, 'function factoryApplyWizardDbSearchQuery(', 'function factoryWizardDbSearchQueryFromInput('),
    sourceSlice(factoryCore, 'function factoryCommitSourceImageAsLockedInput(', 'function factoryApplyCutsSourceImageToState('),
    sourceSlice(factoryCore, 'function factoryClearVmCompetitorData(', 'function factoryMarkVmCandidateCollectionFailure('),
    sourceSlice(factoryCore, 'function factoryMarkVmCandidateCollectionFailure(', 'function factoryShowVmCandidateSelectionTab('),
    sourceSlice(factoryCore, 'function factoryShowVmCandidateSelectionTab(', 'function factoryImportCompetitorDataToFactory('),
    sourceSlice(factoryCore, 'function factoryImportCompetitorDataToFactory(', 'async function factoryCollectCompetitorReferencesForReview('),
    sourceSlice(factoryCore, 'function factorySeedStageInputsFromStage(', 'function factoryClearStageInputsFromStages('),
    sourceSlice(factoryCore, 'function factoryClearStageInputsFromStages(', 'var factoryOneClickPromptLimits'),
    sourceSlice(factoryCore, 'function factorySyncCutPromptsForOneClick(', 'function factoryGoalProgressClamp('),
    sourceSlice(factoryCore, 'function factoryNormalizeStoppedGoalRun(', 'function factoryPatchGoalRunStatusInPlace('),
    sourceSlice(factoryCore, 'function factorySetGoalRunProgress(', 'function factoryStageGoalProgressRange('),
    sourceSlice(factoryCore, 'function factoryBeginStandaloneGoalOperation(', 'function factoryFinishStandaloneGoalOperation('),
    sourceSlice(factoryCore, 'function factoryFinishStandaloneGoalOperation(', 'async function factoryRunStandaloneGoalOperation('),
    sourceSlice(factoryCore, 'function factoryStoreCurrentProductAnalysis(', 'function factoryErrorText('),
    sourceSlice(factoryCore, 'function factoryRestoreImageStageSnapshot(', 'async function factoryPrepareImageCutsEditor('),
    sourceSlice(factoryCore, 'function factorySendAssetToStage(', 'function factoryConfirmAssetUse('),
    sourceSlice(factoryCore, 'function factoryConfirmAssetUse(', 'function factoryToggleAssetUse('),
    sourceSlice(factoryCore, 'function factoryToggleAssetUse(', 'function factoryToggleAssetReject('),
    sourceSlice(factoryCore, 'function factoryMarkAssetImageLoadFailed(', 'function factoryAssetRenderedImageFallback('),
    sourceSlice(factoryCore, 'function factoryPlaceAsset(', 'function factoryGoNextStage('),
    sourceSlice(factoryCore, 'function factoryGoNextStage(', 'async function factoryRunAuto('),
    sourceSlice(factoryCore, 'function factoryImportImageCutsPromptsToStage(', 'function factoryRememberCutResultAsPrevious('),
    sourceSlice(factoryCore, 'function factoryRetagCurrentRunAssetsToCurrentInput(', 'function factoryForceImportFreshCutResults('),
    sourceSlice(factoryCore, 'function factoryLocalArchiveSessionRunId(', 'function factoryLocalArchiveIdentity('),
    sourceSlice(factoryCore, 'function factoryRetryMissingLocalArchiveAssets(', 'function factoryLocalArchiveSearchProductName('),
    sourceSlice(factoryCore, 'function factoryAdoptWorkfileArchiveStageRuns(', 'async function factoryBootstrapCurrentWorkfileArchive('),
    sourceSlice(factoryCore, 'function factoryScheduleLocalArchiveAutoRefresh(', 'function factoryRenderLocalArchivePanel('),
    sourceSlice(factoryCore, 'function factoryRestoreLocalArchiveAssetFast(', 'function factoryOpenLocalArchivePreview('),
    sourceSlice(factoryCore, 'function factorySyncDbOptionsToOptionSorter(', 'function factoryOpenOptionSorterEditor('),
    sourceSlice(factoryCore, 'function factoryEnsureArchiveStageRunId(', 'async function factoryArchiveOptionSorterResultToWorkfile('),
    sourceSlice(factoryCore, 'async function factoryAdoptExistingLocalArchiveAsset(', 'async function factoryQueueLocalArchiveAsset('),
    sourceSlice(factoryCore, 'function factoryTouchImageStageRun(', 'function factoryImageStageRunningTimeoutMs('),
    sourceSlice(factoryCore, 'function factoryFieldTransferState(', 'function factoryFieldTransferRows('),
  ];
  for (const writer of app06ExplicitWriters) {
    assert.doesNotMatch(writer, /(?:=|\|\|)\s*factoryRuntimeReadFactory\(\)/);
  }
  const localArchiveSourceReader = sourceSlice(
    factoryCore,
    'async function factoryLocalArchiveSourceImagePart(',
    'async function factoryEnsureSourceImagePart(',
  );
  assert.doesNotMatch(localArchiveSourceReader, /factory\.archive\s*=/);
  const archiveAutoRefreshWriter = sourceSlice(
    factoryCore,
    'function factoryScheduleLocalArchiveAutoRefresh(',
    'function factoryRenderLocalArchivePanel(',
  );
  assert.match(archiveAutoRefreshWriter, /getOperationToken\(\)/);
  assert.match(archiveAutoRefreshWriter, /factoryRuntimeIsOperationCurrent\(operationToken\)/);
  const fastArchiveRestoreWriter = sourceSlice(
    factoryCore,
    'function factoryRestoreLocalArchiveAssetFast(',
    'function factoryOpenLocalArchivePreview(',
  );
  assert.match(fastArchiveRestoreWriter, /factoryRegisterAsset\([\s\S]*?\{[\s\S]*?factory,/);
  const optionArchiveWriter = sourceSlice(
    factoryCore,
    'async function factoryArchiveOptionSorterResultToWorkfile(',
    'function factoryOptionSorterResultMatchesCurrentJob(',
  );
  assert.match(optionArchiveWriter, /factory\/optionsorter:archiveGeneratedResult/);
  assert.match(optionArchiveWriter, /const factory = options\.factory/);
  assert.match(optionArchiveWriter, /factoryRegisterAsset\([\s\S]*?\{[\s\S]*?factory,/);
  assert.match(optionArchiveWriter, /factoryQueueLocalArchiveAsset\([\s\S]*?\{[\s\S]*?factory,[\s\S]*?operationToken,/);
  assert.match(optionArchiveWriter, /factorySetStageStatus\('options',[\s\S]*?factory\)/);
  assert.doesNotMatch(optionArchiveWriter, /(?:const|let|var)\s+factory\s*=\s*factoryRuntimeReadFactory\(\)/);
  const restoredCutStageWriter = sourceSlice(
    factoryCore,
    'function factoryCommitRestoredCutStageRunIdentity(',
    'function factoryRestoreCutPromptResultsFromAssets(',
  );
  const restoredCutResultsReader = sourceSlice(
    factoryCore,
    'function factoryRestoreCutPromptResultsFromAssets(',
    'function factoryApplyIncomingGeneratedImageToAsset(',
  );
  const imageCutImportWriter = sourceSlice(
    factoryCore,
    'function factoryImportImageCutsResults(',
    'function factoryDbOptionPlanForOptionSorter(',
  );
  const freshCutImportWriter = sourceSlice(
    factoryCore,
    'function factoryForceImportFreshCutResults(',
    'var factoryCurrentProductFallbackJobs',
  );
  const delayedArchiveRecoveryWriter = sourceSlice(
    factoryCore,
    'function factoryScheduleCutPromptArchiveRecovery(',
    'async function factoryAdoptExistingLocalArchiveAsset(',
  );
  assert.match(restoredCutStageWriter, /factory\/assets:restoreCutStageRunIdentity/);
  assert.doesNotMatch(restoredCutResultsReader, /factory\.stages\s*=/);
  assert.match(imageCutImportWriter, /factory\/assets:importImageCutResults/);
  assert.match(imageCutImportWriter, /const factory = options\.factory/);
  assert.doesNotMatch(imageCutImportWriter, /options\.factory\s*\|\|\s*factoryRuntimeReadFactory/);
  assert.match(freshCutImportWriter, /factory\/assets:forceImportFreshCutResults/);
  assert.doesNotMatch(freshCutImportWriter, /factoryOverride\s*\|\|\s*factoryRuntimeReadFactory/);
  assert.match(delayedArchiveRecoveryWriter, /const targetAssetId = String\(assetId/);
  assert.match(delayedArchiveRecoveryWriter, /const operationToken = store\.getOperationToken\(\)/);
  assert.match(delayedArchiveRecoveryWriter, /await factoryFindMatchingLocalArchiveAsset[\s\S]*factoryRuntimeIsOperationCurrent\(operationToken\)/);
  assert.match(delayedArchiveRecoveryWriter, /String\(item\?\.id \|\| ''\) === targetAssetId/);
  const overdueGenerationCleanup = sourceSlice(
    factoryCore,
    'function cutsClearOverdueGenerationRuntime(',
    'let cutsRenderMaintenanceMemo',
  );
  const restoredGenerationCleanup = sourceSlice(
    factoryCore,
    'function factoryHasRestoredImageGenerationRuntime(',
    'function latestCutGenerationLogStatus(',
  );
  const cutTimeoutWriter = sourceSlice(
    factoryCore,
    'function markCutUiTimeout(',
    'async function runCutGenerationWithUiTimeout(',
  );
  assert.match(overdueGenerationCleanup, /factoryMarkImageStageTimeoutState\(normalizedStage, message/);
  assert.doesNotMatch(overdueGenerationCleanup, /stage\.(?:status|message|runHeartbeatAt|updatedAt)\s*=/);
  assert.match(restoredGenerationCleanup, /factory\/assets:clearRestoredImageGenerationRuntime/);
  assert.match(restoredGenerationCleanup, /factoryClearRestoredImageGenerationRuntimeOwned\(draft, options\)/);
  assert.doesNotMatch(restoredGenerationCleanup, /const factory = factoryRuntimeReadFactory\(\)/);
  assert.match(cutTimeoutWriter, /factoryMarkImageStageTimeoutState\(normalizedStage, finalMessage\)/);
  assert.doesNotMatch(cutTimeoutWriter, /factory\.stages\[normalizedStage\]\.(?:status|message|runHeartbeatAt|updatedAt)\s*=/);
  const archiveBootstrapWriter = sourceSlice(
    factoryCore,
    'function factoryCommitWorkfileArchiveBootstrap(',
    'function factoryCurrentWorkfileArchiveScopes(',
  );
  const archivePreviewWriter = sourceSlice(
    factoryCore,
    'function factoryCommitLocalArchivePreviewCopyStatus(',
    'function handleFactoryLocalArchivePreviewClick(',
  );
  const filesystemArchiveWriters = sourceSlice(
    factoryCore,
    'function factoryApplyArchiveDirectoryState(',
    'async function factoryArchiveSession(',
  );
  assert.match(archiveBootstrapWriter, /const operationToken = options\.operationToken \|\| store\.getOperationToken\(\)/);
  assert.match(factoryCore, /function factoryWorkfileArchiveRequestIsCurrent\(/);
  assert.match(archiveBootstrapWriter, /await ensureWorkspaceEditAuthority[\s\S]*factoryWorkfileArchiveRequestIsCurrent\(identity, authorityScope, fencingToken\)/);
  assert.match(archiveBootstrapWriter, /await response\.json[\s\S]*factoryWorkfileArchiveRequestIsCurrent\(identity, authorityScope, fencingToken\)/);
  assert.doesNotMatch(archiveBootstrapWriter, /await response\.json[\s\S]*store\.isOperationCurrent\(operationToken\)/);
  assert.match(archiveBootstrapWriter, /explicitFactory[\s\S]*factoryAdoptWorkfileArchiveStageRuns\(stageScopes, explicitFactory\)/);
  assert.match(archiveBootstrapWriter, /factory\/archive:completeWorkfileBootstrap/);
  assert.match(archivePreviewWriter, /const operationToken = factoryRuntimeRequireStore\(\)\.getOperationToken\(\)/);
  assert.match(archivePreviewWriter, /await navigator\.clipboard\?\.writeText\(copyPath\)[\s\S]*factoryRuntimeIsOperationCurrent\(operationToken\)/);
  assert.match(archivePreviewWriter, /factory\/archive:setPreviewCopyStatus/);
  assert.doesNotMatch(filesystemArchiveWriters, /= factoryRuntimeReadFactory\(\)/);
  assert.match(filesystemArchiveWriters, /factory\/archive:restoreDirectoryHandle/);
  assert.match(filesystemArchiveWriters, /factory\/archive:chooseDirectory/);
  assert.match(filesystemArchiveWriters, /factory\/archive:setSessionDirectory/);
  assert.match(filesystemArchiveWriters, /const archiveWriteId = uid\('factory_fs_archive'\)/);
  assert.match(filesystemArchiveWriters, /await factoryWriteFile[\s\S]*store\.isOperationCurrent\(operationToken\)/);
  assert.match(filesystemArchiveWriters, /String\(item\?\.id \|\| ''\) === requestedAssetId/);
  const optionColorUsageWriter = sourceSlice(
    factoryCore,
    'function optSetColorImageUsage(',
    'function optNormalizeStyleSample(',
  );
  assert.doesNotMatch(optionColorUsageWriter, /factoryRuntimeReadFactory/);
  const panelToggleWriter = sourceSlice(
    factoryCore,
    'const runFactoryTogglePanel = btn => {',
    'const factoryPageRoot = document.querySelector',
  );
  assert.match(panelToggleWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:toggleUiPanel/);
  assert.doesNotMatch(panelToggleWriter, /factoryRuntimeReadFactory/);
  const cafe24AdvancedToggleWriter = sourceSlice(
    factoryCore,
    "document.querySelectorAll('details[data-factory-cafe24-advanced]').forEach(details => {",
    '    bindFactoryCafe24StructuredFieldEvents();',
  );
  assert.match(cafe24AdvancedToggleWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:setCafe24AdvancedPanelOpen/);
  assert.doesNotMatch(cafe24AdvancedToggleWriter, /factoryRuntimeReadFactory/);
  const oauthAutoRefreshWriter = sourceSlice(
    factoryCore,
    'function factoryStartCafe24OAuthAutoRefresh()',
    'let workspaceAuthorityUiLock = null;',
  );
  assert.match(oauthAutoRefreshWriter, /let operationToken = store\.getOperationToken\(\)/);
  assert.match(oauthAutoRefreshWriter, /factoryRuntimeIsOperationCurrent\(operationToken\)/);
  assert.match(oauthAutoRefreshWriter, /factory\/runtime:setCafe24OAuthAutoRefreshStatus/);
  assert.doesNotMatch(oauthAutoRefreshWriter, /factoryRuntimeReadFactory/);
  assert.match(app06ExplicitWriters[0], /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/db:applyWizardSearchQuery/);
  const bridge = sourceSlice(
    core,
    'function factoryRuntimeBridgeAction(',
    'function factoryRuntimeReportError(',
  );
  assert.match(bridge, /store\.updateDraft\(/);
  assert.doesNotMatch(bridge, /factoryRuntimeMarkRefresh|factoryRuntimeRefreshStore/);

  const sync = source('src/cafe24-sync.js');
  const manualFieldWriter = sourceSlice(
    sync,
    'function factorySetDbFieldManualValue(',
    'function factoryCollectCafe24CategoryRowsFromDom(',
  );
  assert.match(manualFieldWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:setDbFieldManualValue/);
  assert.doesNotMatch(manualFieldWriter, /options\.factory \|\| factoryRuntimeReadFactory/);

  const placementWriter = sourceSlice(
    factoryCore,
    'function factoryClearHeroDetailPlacements(',
    'function factoryApplySelectedAssetsToSections(',
  );
  assert.match(placementWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:clearHeroDetailPlacements/);
  const directDeletes = PRODUCTION_FACTORY_READERS.flatMap(relativePath => {
    const matches = source(relativePath).match(/delete\s+(?:factory|current|done)\./g) || [];
    return matches.map(match => `${relativePath}:${match}`);
  });
  assert.deepEqual(directDeletes, []);

  const assetCore = source('src/app-core-05.js');
  const completedFilesWriter = sourceSlice(
    assetCore,
    'async function factoryAddCompletedFiles(',
    'function factorySetOptionColorImageUsage(',
  );
  const optionFilesWriter = sourceSlice(
    assetCore,
    'async function factoryAddOptionColorImageFiles(',
    'function factoryCreateProductInputAsset(',
  );
  const stageFilesWriter = sourceSlice(
    assetCore,
    'async function factoryAddStageInputFiles(',
    'let competitorEvidenceCanvasPaintTimer',
  );
  for (const writer of [completedFilesWriter, optionFilesWriter, stageFilesWriter]) {
    assert.match(writer, /await Promise\.all\(/);
    assert.match(writer, /options\.factory/);
  }

  const optionStageWriter = sourceSlice(
    factoryCore,
    'async function factoryGenerateOptionsStage(',
    'async function factoryGenerateCutsStage(',
  );
  assert.match(optionStageWriter, /const factory = options\.factory \|\| factoryRuntimeReadFactory\(\)/);
  assert.match(factoryCore, /factoryGenerateOptionsStage\(\{ factory \}\)/);
  const heroCutsOneClickWriter = sourceSlice(
    factoryCore,
    'async function factoryRunHeroAndCutsForOneClick(',
    'function factoryClearStaleProductAnalysis(',
  );
  const staleAnalysisWriter = sourceSlice(
    factoryCore,
    'function factoryClearStaleProductAnalysis(',
    'function factoryStoreCurrentProductAnalysis(',
  );
  const dbVmOnlyWriter = sourceSlice(
    factoryCore,
    'async function factoryRunDbVmCandidatesOnlyFlow(',
    'function factoryBuildImagePrompt(',
  );
  const legacyImageStageWriter = sourceSlice(
    factoryCore,
    'async function factoryGenerateImageStage(',
    'async function factoryGenerateOptionsStage(',
  );
  const legacyCutsStageWriter = sourceSlice(
    factoryCore,
    'async function factoryGenerateCutsStage(',
    'function factoryPreferredSectionForAsset(',
  );
  const selectedAssetPlacementWriter = sourceSlice(
    factoryCore,
    'function factoryApplySelectedAssetsToSections(',
    'function factoryApplyCombinedSectionBasisForDetailStage(',
  );
  const detailStageWriter = sourceSlice(
    factoryCore,
    'async function factoryGenerateDetailStage(',
    'async function factoryRunStage(',
  );
  for (const writer of [
    heroCutsOneClickWriter,
    staleAnalysisWriter,
    dbVmOnlyWriter,
    legacyImageStageWriter,
    legacyCutsStageWriter,
    selectedAssetPlacementWriter,
    detailStageWriter,
  ]) {
    assert.doesNotMatch(writer, /factoryRuntimeReadFactory\(\)/);
  }
  assert.match(heroCutsOneClickWriter, /const factory = options\.factory;[\s\S]*requires an owned draft/);
  assert.match(staleAnalysisWriter, /function factoryClearStaleProductAnalysis\(factory\)[\s\S]*requires an owned draft/);
  assert.match(dbVmOnlyWriter, /const factory = options\.factory;[\s\S]*requires an owned draft/);
  assert.match(legacyImageStageWriter, /factoryEnsureSourceImagePart\(stageId, \{ factory \}\)/);
  assert.match(legacyCutsStageWriter, /factoryEnsureSourceImagePart\('cuts', \{ factory \}\)/);
  assert.match(selectedAssetPlacementWriter, /function factoryApplySelectedAssetsToSections\(factory\)[\s\S]*requires an owned draft/);
  assert.match(detailStageWriter, /const detailFactory = options\.factory;[\s\S]*factoryApplySelectedAssetsToSections\(detailFactory\)/);
  assert.doesNotMatch(detailStageWriter, /factoryMarkImageStageRunInactive\(stageId, generationRunId\)/);
  assert.match(factoryCore, /if \(stageId === 'detail'\) return factoryGenerateDetailStage\(\{ factory \}\)/);
  for (const legacyName of ['factoryGenerateImageStage', 'factoryGenerateCutsStage']) {
    const occurrences = [...factoryCore.matchAll(new RegExp(`\\b${legacyName}\\s*\\(`, 'g'))].length;
    assert.equal(occurrences, 1, `${legacyName} must remain definition-only until a separate deletion decision`);
  }
  const optionSendWriter = sourceSlice(
    factoryCore,
    'function factorySendOptionSorterResultsToFactory(',
    'function factoryCurrentRunImportedAssetCount(',
  );
  assert.match(optionSendWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/optionsorter:sendResultsToFactory/);
  assert.match(optionSendWriter, /factoryImportOptionSorterResults\(\{[\s\S]*factory,/);

  const productImageWriter = sourceSlice(
    assetCore,
    'function factorySetProductImage(',
    'async function factoryAddCompletedFiles(',
  );
  assert.match(productImageWriter, /return new Promise\(\(resolve, reject\) =>/);
  assert.match(productImageWriter, /options\.operationToken[\s\S]*factoryRuntimeIsOperationCurrent/);
  assert.doesNotMatch(productImageWriter, /const factory = factoryRuntimeReadFactory\(\)/);
  assert.match(core, /factorySetProductImage\(file, \{ factory: draft, operationToken \}\)/);

  const archiveWriter = sourceSlice(
    factoryCore,
    'async function factoryArchiveCurrentInputImage(',
    'function factoryRetryMissingLocalArchiveAssets(',
  );
  const archiveRefreshWriter = sourceSlice(
    factoryCore,
    'async function factoryRefreshLocalArchiveAssets(',
    'function factoryLocalArchiveRecordCompatible(',
  );
  for (const [writer, command] of [
    [archiveWriter, 'factory/runtime:archiveCurrentInputImage'],
    [archiveRefreshWriter, 'factory/runtime:refreshLocalArchiveAssets'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /const (?:factory|latestFactory) = factoryRuntimeReadFactory\(\)/);
  }

  const preserveDetailWriter = sourceSlice(
    assetCore,
    'function factoryPreserveCurrentDetailHtmlBeforeSectionReset(',
    'function factoryRegistrationImageRef(',
  );
  const finalAssetWriter = sourceSlice(
    assetCore,
    'async function factoryPrepareFinalRegistrationLocalAssets(',
    'async function factoryRunFinalRegistration(',
  );
  const finalRegistrationWriter = sourceSlice(
    assetCore,
    'async function factoryRunFinalRegistration(',
    'function renderFactoryOpenMarketSalesPanel(',
  );
  const openMarketEvents = sourceSlice(
    assetCore,
    'function bindFactoryOpenMarketEvents(',
    'registerBindEventExtension(bindFactoryOpenMarketEvents);',
  );
  assert.match(preserveDetailWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/runtime:preserveDetailHtml/);
  assert.match(finalAssetWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/final-registration:prepare-assets/);
  assert.match(finalAssetWriter, /factoryRefreshLocalArchiveAssets\(\{[\s\S]*factory,/);
  assert.match(finalAssetWriter, /factoryHydrateCafe24ImagesFromLocalArchive\(\{[\s\S]*factory,/);
  assert.match(finalRegistrationWriter, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/final-registration:run/);
  assert.match(finalRegistrationWriter, /factorySaveCafe24ProductFromFinalDb\(\{[\s\S]*factory,/);
  assert.match(finalRegistrationWriter, /factoryCreateCafe24ProductFromFinalDb\(\{[\s\S]*factory,/);
  assert.match(openMarketEvents, /factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/openmarket:event/);
  for (const writer of [preserveDetailWriter, finalAssetWriter, finalRegistrationWriter, openMarketEvents]) {
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }

  const localArchiveWriter = sourceSlice(
    factoryCore,
    'async function factoryLoadLocalArchiveAsset(',
    'function factoryLocalArchiveRestoreStageRank(',
  );
  const localHydrateWriter = sourceSlice(
    factoryCore,
    'async function factoryHydrateCafe24ImagesFromLocalArchive(',
    'async function factoryRestoreCurrentWorkfileLocalArchive(',
  );
  const localRestoreWriter = sourceSlice(
    factoryCore,
    'async function factoryRestoreLocalArchiveToCurrentWork(',
    'function sectionLocalArchiveStageId(',
  );
  for (const [writer, command] of [
    [localArchiveWriter, 'factory/runtime:loadLocalArchiveAsset'],
    [localHydrateWriter, 'factory/runtime:hydrateCafe24ImagesFromLocalArchive'],
    [localRestoreWriter, 'factory/runtime:restoreLocalArchiveToCurrentWork'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }

  const cafe24Payloads = source('src/cafe24-payloads.js');
  const cafe24ApiSourceWriter = sourceSlice(
    cafe24Payloads,
    'async function factoryRefreshCafe24ApiSources(',
    'async function factoryProbeCafe24EndpointHealthFromCurrent(',
  );
  const cafe24EndpointWriter = sourceSlice(
    cafe24Payloads,
    'async function factoryProbeCafe24EndpointHealthFromCurrent(',
    'async function fetchCafe24ReferenceList(',
  );
  const cafe24ReferenceWriter = sourceSlice(
    cafe24Payloads,
    'async function factoryRefreshCafe24ReferenceLists(',
    'function factoryTruthyCafe24Flag(',
  );
  for (const [writer, command] of [
    [cafe24ApiSourceWriter, 'factory/cafe24:refresh-api-sources'],
    [cafe24EndpointWriter, 'factory/cafe24:probe-endpoint-health'],
    [cafe24ReferenceWriter, 'factory/cafe24:refresh-reference-lists'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }

  const cafe24Sync = source('src/cafe24-sync.js');
  const cafe24ProductImagesWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24ProductImages(',
    'function factoryCafe24AdditionalImageResponseRaw(',
  );
  const cafe24AdditionalImagesWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24AdditionalImages(',
    'function factoryCafe24DetailInlineImageDataUrls(',
  );
  const cafe24DetailHtmlWriter = sourceSlice(
    cafe24Sync,
    'async function factoryPublishCafe24ScopedDetailHtml(',
    'function factoryUpdateCafe24IconDraftFromDom(',
  );
  for (const [writer, command] of [
    [cafe24ProductImagesWriter, 'factory/cafe24:sync-product-images'],
    [cafe24AdditionalImagesWriter, 'factory/cafe24:sync-additional-images'],
    [cafe24DetailHtmlWriter, 'factory/cafe24:publish-detail-html'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(cafe24DetailHtmlWriter, /factoryUploadCafe24DetailInlineImages\([\s\S]*factory,/);

  const cafe24IconRefreshWriter = sourceSlice(
    cafe24Sync,
    'async function factoryRefreshCafe24Icons(',
    'function factoryVerifyCafe24IconEcho(',
  );
  const cafe24IconSyncWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24Icons(',
    'function factoryApplyCafe24RelationDraftFromDom(',
  );
  const cafe24RelationsWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24Relations(',
    'async function factoryRefreshCafe24Promotions(',
  );
  const cafe24PromotionsWriter = sourceSlice(
    cafe24Sync,
    'async function factoryRefreshCafe24Promotions(',
    'function factoryUpdateCafe24SeoTagsDraftFromDom(',
  );
  for (const [writer, command] of [
    [cafe24IconRefreshWriter, 'factory/cafe24:refresh-icons'],
    [cafe24IconSyncWriter, 'factory/cafe24:sync-icons'],
    [cafe24RelationsWriter, 'factory/cafe24:sync-relations'],
    [cafe24PromotionsWriter, 'factory/cafe24:refresh-promotions'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(cafe24IconSyncWriter, /factoryUpdateCafe24IconDraftFromDom\(\{ factory \}\)/);
  assert.match(cafe24RelationsWriter, /factoryApplyCafe24RelationDraftFromDom\(\{ factory \}\)/);

  const cafe24SeoTagsRefreshWriter = sourceSlice(
    cafe24Sync,
    'async function factoryRefreshCafe24SeoTags(',
    'function factoryVerifyCafe24SeoEcho(',
  );
  const cafe24SeoSyncWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24Seo(',
    'async function factoryFetchCafe24ShopProductByNo(',
  );
  const cafe24EnglishNameWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24EnglishShopName(',
    'async function factorySyncCafe24Tags(',
  );
  const cafe24TagsWriter = sourceSlice(
    cafe24Sync,
    'async function factorySyncCafe24Tags(',
    'function factoryUpdateCafe24MemoDraftFromDom(',
  );
  for (const [writer, command] of [
    [cafe24SeoTagsRefreshWriter, 'factory/cafe24:refresh-seo-tags'],
    [cafe24SeoSyncWriter, 'factory/cafe24:sync-seo'],
    [cafe24EnglishNameWriter, 'factory/cafe24:sync-english-shop-name'],
    [cafe24TagsWriter, 'factory/cafe24:sync-tags'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(cafe24SeoSyncWriter, /factoryUpdateCafe24SeoTagsDraftFromDom\(\{ factory \}\)/);
  assert.match(cafe24TagsWriter, /factoryUpdateCafe24SeoTagsDraftFromDom\(\{ factory \}\)/);

  const cafe24MemoRefreshWriter = sourceSlice(cafe24Sync, 'async function factoryRefreshCafe24Memos(', 'async function factorySyncCafe24Memo(');
  const cafe24MemoSyncWriter = sourceSlice(cafe24Sync, 'async function factorySyncCafe24Memo(', 'async function factoryDeleteCafe24Memo(');
  const cafe24MemoDeleteWriter = sourceSlice(cafe24Sync, 'async function factoryDeleteCafe24Memo(', 'function factoryUpdateCafe24MainDraftFromDom(');
  const cafe24MainRefreshWriter = sourceSlice(cafe24Sync, 'async function factoryRefreshCafe24MainProducts(', 'async function factorySyncCafe24MainProduct(');
  const cafe24MainSyncWriter = sourceSlice(cafe24Sync, 'async function factorySyncCafe24MainProduct(', 'async function factoryDeleteCafe24MainProduct(');
  const cafe24MainDeleteWriter = sourceSlice(cafe24Sync, 'async function factoryDeleteCafe24MainProduct(', 'async function factorySyncCafe24CategoryLink(');
  for (const [writer, command] of [
    [cafe24MemoRefreshWriter, 'factory/cafe24:refresh-memos'],
    [cafe24MemoSyncWriter, 'factory/cafe24:sync-memo'],
    [cafe24MemoDeleteWriter, 'factory/cafe24:delete-memo'],
    [cafe24MainRefreshWriter, 'factory/cafe24:refresh-main-products'],
    [cafe24MainSyncWriter, 'factory/cafe24:sync-main-product'],
    [cafe24MainDeleteWriter, 'factory/cafe24:delete-main-product'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(cafe24MemoSyncWriter, /factoryUpdateCafe24MemoDraftFromDom\(\{ factory \}\)/);
  for (const writer of [cafe24MainRefreshWriter, cafe24MainSyncWriter, cafe24MainDeleteWriter]) {
    assert.match(writer, /factoryUpdateCafe24MainDraftFromDom\(\{ factory \}\)/);
  }

  const cafe24CategoryWriter = sourceSlice(cafe24Sync, 'async function factorySyncCafe24CategoryLink(', 'async function factorySyncCafe24OptionsAndVariants(');
  const cafe24OptionsWriter = sourceSlice(cafe24Sync, 'async function factorySyncCafe24OptionsAndVariants(', 'async function factoryRunOptionContextMatch(');
  const cafe24OptionMatchWriter = sourceSlice(cafe24Sync, 'async function factoryRunOptionContextMatch(', 'function factoryCafe24ControlPlanFromBody(');
  for (const [writer, command] of [
    [cafe24CategoryWriter, 'factory/cafe24:sync-category-link'],
    [cafe24OptionsWriter, 'factory/cafe24:sync-options-variants'],
    [cafe24OptionMatchWriter, 'factory/cafe24:run-option-context-match'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }

  const cafe24SaveWriter = sourceSlice(cafe24Sync, 'async function factorySaveCafe24ProductFromFinalDb(', 'async function factoryVerifyCafe24SingleFieldRoundTrip(');
  const cafe24RollbackWriter = sourceSlice(cafe24Sync, 'async function factoryRollbackLastCafe24SingleFieldVerification(', 'async function factoryRunCafe24ReadySync(');
  const cafe24ReadySyncWriter = sourceSlice(cafe24Sync, 'async function factoryRunCafe24ReadySync(', 'async function factoryRunCafe24PostCreateSync(');
  const cafe24PostCreateWriter = sourceSlice(cafe24Sync, 'async function factoryRunCafe24PostCreateSync(', 'function factoryExtractCafe24ProductFromBody(');
  for (const [writer, command] of [
    [cafe24SaveWriter, 'factory/cafe24:save-product'],
    [cafe24RollbackWriter, 'factory/cafe24:rollback-single-field'],
    [cafe24ReadySyncWriter, 'factory/cafe24:run-ready-sync'],
    [cafe24PostCreateWriter, 'factory/cafe24:run-post-create-sync'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
  }
  assert.match(cafe24ReadySyncWriter, /const nestedOptions = \{ skipConfirm: true, factory, render: false \}/);
  assert.match(cafe24PostCreateWriter, /onProgress: emitProgress,[\s\S]*factory,[\s\S]*render: false/);

  const cafe24UseTestWriter = sourceSlice(cafe24Sync, 'async function factoryUseCafe24TestProduct(', 'async function factorySetCafe24MarketSyncFlag(');
  const cafe24MarketSyncWriter = sourceSlice(cafe24Sync, 'async function factorySetCafe24MarketSyncFlag(', 'function factoryAttachCafe24ProductAsCurrentTarget(');
  const cafe24CreateWriter = sourceSlice(cafe24Sync, 'async function factoryCreateCafe24ProductFromFinalDb(', 'function factorySetDbFieldManualValue(');
  const cafe24HiddenTestWriter = sourceSlice(cafe24Sync, 'async function factoryCreateCafe24HiddenTestProduct(', 'function factoryAnalysisImportText(');
  for (const [writer, command] of [
    [cafe24UseTestWriter, 'factory/cafe24:use-test-product'],
    [cafe24MarketSyncWriter, 'factory/cafe24:set-market-sync'],
    [cafe24CreateWriter, 'factory/cafe24:create-product'],
    [cafe24HiddenTestWriter, 'factory/cafe24:create-hidden-test'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*factoryRuntimeReadFactory\(\)/);
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  assert.match(cafe24UseTestWriter, /factoryAttachCafe24ProductAsCurrentTarget\([\s\S]*current\)/);
  assert.match(cafe24CreateWriter, /factorySaveCafe24ProductFromFinalDb\(\{[\s\S]*factory,[\s\S]*render: false/);
  assert.match(cafe24CreateWriter, /factoryPublishCafe24ScopedDetailHtml\([\s\S]*factory,[\s\S]*render: false/);
  assert.match(cafe24CreateWriter, /factoryRunCafe24PostCreateSync\([\s\S]*factory,[\s\S]*render: false/);
  assert.match(cafe24HiddenTestWriter, /factoryCreateCafe24ProductFromFinalDb\(\{[\s\S]*factory,[\s\S]*render: false/);

  const candidateDbApplyWriter = sourceSlice(cafe24Sync, 'async function factoryApplyDbCandidateFromReview(', 'async function factoryApplyCafe24CandidateFromReview(');
  const candidateCafe24ApplyWriter = sourceSlice(cafe24Sync, 'async function factoryApplyCafe24CandidateFromReview(', 'function factoryConfirmNoDbCandidate(');
  const candidateCollectWriter = sourceSlice(cafe24Sync, 'async function factoryCollectProductCandidatesForReview(', 'async function factoryCollectCafe24CandidatesForReviewOnly(');
  for (const [writer, command] of [
    [candidateDbApplyWriter, 'factory/cafe24:apply-db-candidate'],
    [candidateCafe24ApplyWriter, 'factory/cafe24:apply-cafe24-candidate'],
    [candidateCollectWriter, 'factory/cafe24:collect-product-candidates'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*(?:options\.factory\s*\|\|\s*)?factoryRuntimeReadFactory\(\)/);
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  assert.match(candidateDbApplyWriter, /factoryScheduleSizeCutAfterCandidateConfirm\([\s\S]*persist: false,[\s\S]*render: false/);
  assert.match(candidateCafe24ApplyWriter, /factoryScheduleSizeCutAfterCandidateConfirm\([\s\S]*persist: false,[\s\S]*render: false/);
  assert.match(candidateCollectWriter, /factoryApplyDbCandidateFromReview\(0, \{ render: false, factory: current \}\)/);
  assert.match(candidateCollectWriter, /factoryApplyCafe24CandidateFromReview\(0, \{ render: false, factory: current \}\)/);
  assert.match(candidateCollectWriter, /factoryStartCafe24CandidateRerank\([\s\S]*\{ factory: current \}\)/);

  const candidateCafe24CollectWriter = sourceSlice(cafe24Sync, 'async function factoryCollectCafe24CandidatesForReviewOnly(', 'async function factoryCollectAdditionalCafe24CandidatesForReview(');
  const candidateAdditionalCollectWriter = sourceSlice(cafe24Sync, 'async function factoryCollectAdditionalCafe24CandidatesForReview(', 'async function factoryRunCafe24CandidateAdditionalSearch(');
  const candidateAdditionalRunWriter = sourceSlice(cafe24Sync, 'async function factoryRunCafe24CandidateAdditionalSearch(', 'async function factoryRunCafe24CandidateSearchOnly(');
  const candidateSearchOnlyWriter = sourceSlice(`${cafe24Sync}\n/* test-eof */`, 'async function factoryRunCafe24CandidateSearchOnly(', '/* test-eof */');
  for (const [writer, command] of [
    [candidateCafe24CollectWriter, 'factory/cafe24:collect-cafe24-candidates'],
    [candidateAdditionalCollectWriter, 'factory/cafe24:collect-additional-cafe24-candidates'],
    [candidateAdditionalRunWriter, 'factory/cafe24:run-candidate-additional-search'],
    [candidateSearchOnlyWriter, 'factory/cafe24:run-candidate-search-only'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*(?:options\.factory\s*\|\|\s*)?factoryRuntimeReadFactory\(\)/);
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  assert.match(candidateCafe24CollectWriter, /factoryApplyCafe24CandidateFromReview\(0, \{ render: false, factory: current \}\)/);
  assert.match(candidateCafe24CollectWriter, /factoryStartCafe24CandidateRerank\([\s\S]*\{ factory: current \}\)/);
  assert.match(candidateAdditionalCollectWriter, /factoryStartCafe24CandidateRerank\([\s\S]*\{ factory: current \}\)/);
  assert.match(candidateAdditionalRunWriter, /factoryUpdateFromInputs\(factory\)[\s\S]*factoryApplyProductToApp\(factory\)/);
  assert.match(candidateAdditionalRunWriter, /factoryCollectAdditionalCafe24CandidatesForReview\(\{ factory, render: false \}\)/);
  assert.match(candidateSearchOnlyWriter, /factoryUpdateFromInputs\(factory\)[\s\S]*factoryApplyProductToApp\(factory\)/);
  assert.match(candidateSearchOnlyWriter, /factoryCollectCafe24CandidatesForReviewOnly\(\{ factory, render: false \}\)/);

  const cafe24ProductForm = source('src/cafe24-product-form.js');
  const sourcePanelsCollapseWriter = sourceSlice(cafe24ProductForm, 'function factorySetAllSourcePanelsCollapsed(', 'function factoryToggleSourcePanelSection(');
  const dbInputSnapshotBuilder = sourceSlice(cafe24ProductForm, 'function factoryBuildDbInputSnapshot(', 'function factoryFlushDbInputPanelDomValues(');
  const dbInputFlushWriter = sourceSlice(cafe24ProductForm, 'function factoryFlushDbInputPanelDomValues(', 'async function factorySaveCurrentDbInputSnapshot(');
  const dbInputSnapshotWriter = sourceSlice(cafe24ProductForm, 'async function factorySaveCurrentDbInputSnapshot(', 'function factoryLoadDbInputSnapshot(');
  for (const [writer, command] of [
    [sourcePanelsCollapseWriter, 'factory/cafe24:set-source-panels-collapsed'],
    [dbInputFlushWriter, 'factory/cafe24:flush-db-input-panel'],
    [dbInputSnapshotWriter, 'factory/cafe24:save-db-input-snapshot'],
  ]) {
    assert.match(writer, new RegExp(`factoryRuntimeUpdateOwnedFactory\\([\\s\\S]*${command.replace('/', '\\/')}`));
    assert.doesNotMatch(writer, /(?:const|let)\s+\w+\s*=\s*(?:options\.factory\s*\|\|\s*)?factoryRuntimeReadFactory\(\)/);
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
  assert.match(dbInputSnapshotBuilder, /factoryFlushDbInputPanelDomValues\(\{ factory \}\)/);
  assert.match(dbInputSnapshotBuilder, /factoryUpdateFromInputs\(factory\)/);
  assert.match(dbInputSnapshotBuilder, /factoryUpdateFinalDbFromFields\(factory\)/);
  assert.match(dbInputFlushWriter, /factorySetDbFieldManualValue\([\s\S]*factory \}/);
  assert.match(dbInputSnapshotWriter, /factoryFlushDbInputPanelDomValues\(\{ factory \}\)/);
  assert.match(dbInputSnapshotWriter, /factorySetAllSourcePanelsCollapsed\(true, \{ render: false \}\)/);

  let activeReader = null;
  class ProductImageFileReader {
    constructor() { activeReader = this; }
    readAsDataURL(file) { this.file = file; }
  }
  const imageState = { productName: '제품 A' };
  const stamped = [];
  const synced = [];
  const imageLogs = [];
  let operationCurrent = true;
  const createProductImageWriter = new Function(
    'FileReader', 'factoryRuntimeUpdateOwnedFactory', 'saveLastWorkNow', 'render',
    'factoryRuntimeIsOperationCurrent', 'factoryRuntimeStaleActionError',
    'factoryStampLockedInputImage', 'syncProductImageAcrossWorkspaces', 'factoryLog', 'state',
    `${productImageWriter}; return factorySetProductImage;`,
  );
  const setProductImage = createProductImageWriter(
    ProductImageFileReader,
    () => { throw new Error('unexpected self-owned fallback'); },
    () => {},
    () => {},
    () => operationCurrent,
    action => Object.assign(new Error(`STALE:${action}`), { code: 'STALE_FACTORY_RUNTIME_ACTION' }),
    (factory, payload) => {
      factory.product.imageBase64 = payload.base64;
      stamped.push({ factory, payload });
    },
    options => synced.push(options),
    (message, tone, factory) => imageLogs.push({ message, tone, factory }),
    imageState,
  );
  const imageDraft = { product: { productName: '제품 A' } };
  let imageSettled = false;
  const pendingImage = setProductImage(
    { name: 'input.png', type: 'image/png' },
    { factory: imageDraft, operationToken: Object.freeze({ revision: 1 }) },
  ).then(result => {
    imageSettled = true;
    return result;
  });
  assert.equal(imageSettled, false);
  assert.equal(imageDraft.product.imageBase64, undefined);
  activeReader.onload({ target: { result: 'data:image/png;base64,QUJD' } });
  const imageResult = await pendingImage;
  assert.equal(imageResult.ok, true);
  assert.equal(imageResult.archivePayload.base64, 'QUJD');
  assert.strictEqual(stamped[0].factory, imageDraft);
  assert.strictEqual(synced[0].factory, imageDraft);
  assert.equal(synced[0].archiveInput, false);
  assert.strictEqual(imageLogs[0].factory, imageDraft);

  operationCurrent = false;
  const staleDraft = { product: { productName: '제품 B' } };
  const staleImage = setProductImage(
    { name: 'stale.png', type: 'image/png' },
    { factory: staleDraft, operationToken: Object.freeze({ revision: 2 }) },
  );
  activeReader.onload({ target: { result: 'data:image/png;base64,REVG' } });
  await assert.rejects(staleImage, /STALE:factory\/start:setProductImage/);
  assert.equal(staleDraft.product.imageBase64, undefined);

  class DeferredFileReader {
    readAsDataURL(file) {
      queueMicrotask(() => this.onload?.({ target: { result: `data:${file.type};base64,AA==` } }));
    }
  }
  const registered = [];
  const stageUpdates = [];
  const logs = [];
  const createCompletedFilesWriter = new Function(
    'FileReader', 'factoryRegisterAsset', 'factorySetStageStatus', 'factoryLog',
    'saveLastWorkNow', 'render',
    `${completedFilesWriter}; return factoryAddCompletedFiles;`,
  );
  const addCompletedFiles = createCompletedFilesWriter(
    DeferredFileReader,
    (_stageId, image, meta) => {
      const asset = { id: `asset-${registered.length + 1}`, image };
      meta.factory.assets.push(asset);
      registered.push({ asset, factory: meta.factory });
      return asset;
    },
    (stageId, status, message, factory) => stageUpdates.push({ stageId, status, message, factory }),
    (message, tone, factory) => logs.push({ message, tone, factory }),
    () => {},
    () => {},
  );
  const fileDraft = { assets: [] };
  let settled = false;
  const pendingFiles = addCompletedFiles([
    { name: 'complete.png', type: 'image/png' },
    { name: 'ignore.txt', type: 'text/plain' },
  ], { factory: fileDraft, render: false }).then(result => {
    settled = true;
    return result;
  });
  assert.equal(settled, false);
  assert.equal(fileDraft.assets.length, 0);
  assert.equal(await pendingFiles, 1);
  assert.equal(fileDraft.assets.length, 1);
  assert.strictEqual(registered[0].factory, fileDraft);
  assert.strictEqual(stageUpdates[0].factory, fileDraft);
  assert.strictEqual(logs[0].factory, fileDraft);
});

test('completed image hydration clears an earlier restore warning once canonical references are resolved', () => {
  const persistenceCore = source('src/app-core-02.js');
  const warningSource = sourceSlice(
    persistenceCore,
    'function showImageRestoreWarningIfNeeded(',
    'function mergeOptionSorterStoredImages(',
  );
  const state = {
    currentProjectId: 'project-resolved',
    step: 'factory',
    storageWarning: '저장된 이미지 복원에 실패했습니다. 1개 이미지 원본을 읽지 못했습니다.',
    storageWarningDismissKey: 'image-restore:project-resolved:factory:1',
  };
  let missingCount = 0;
  const reconcile = new Function(
    'state',
    'countSessionAssetRestoreRefs',
    'wasStorageWarningDismissed',
    `${warningSource}\nreturn showImageRestoreWarningIfNeeded;`,
  )(state, () => missingCount, () => false);

  assert.equal(reconcile(), true);
  assert.equal(state.storageWarning, '');
  assert.equal(state.storageWarningDismissKey, '');

  missingCount = 2;
  assert.equal(reconcile(), true);
  assert.match(state.storageWarning, /2개 이미지 원본/);
  assert.equal(state.storageWarningDismissKey, 'image-restore:project-resolved:factory:2');
});

test('menu visual QA harness prepares and reads factory state through the canonical store API', () => {
  const harness = source('tools/verify_menu_navigation_contracts_cdp_v231.cjs');
  assert.doesNotMatch(harness, /\bfactoryState\s*\(/);
  assert.match(harness, /factoryRuntimeReplaceFactorySnapshot\(factory/);
  assert.match(harness, /factoryRuntimeReadFactory\(\)\.automation/);
});

test('image restore warnings only count the active menu and current visible image references', () => {
  const persistenceCore = source('src/app-core-02.js');
  const counterSource = sourceSlice(
    persistenceCore,
    'function hasRestoredImagePayloadValue(',
    'function wasStorageWarningDismissed(',
  );
  const count = (state, canonicalFactory = state.factory) => new Function(
    'state',
    'factoryRuntimeReadFactory',
    'IMAGE_STORED_MARKER',
    `${counterSource}\nreturn countSessionAssetRestoreRefs;`,
  )(
    state,
    () => canonicalFactory,
    '__stored_in_indexeddb__',
  )();
  const marker = { hasImageData: true };
  const state = {
    step: 'factory',
    analysisImages: [],
    detailImageBlocks: [{ hasDataUrl: true }],
    sectionVariants: { hero: [{ id: 'old', hasImage: true }] },
    currentSectionVariantIds: { hero: 'old' },
    sectionImages: { hero: 'data:image/png;base64,current' },
    optionSorter: { images: [marker], optionResults: [{ hasImage: true }] },
    cuts: { hasSourceImage: true },
    compPage: { hasUploadedImages: true, uploadedImages: [] },
    imageBase64: 'current-product-payload',
    factory: { product: { hasImage: true }, assets: [{ hasImage: true, imageUrl: 'data:image/png;base64,asset' }] },
  };
  assert.equal(count(state), 0);
  assert.equal(count({ ...state, step: 'optionsorter' }), 2);
  assert.equal(count(
    { ...state, factory: { product: { hasImage: true }, inputImages: [{ hasImage: true }] } },
    { ...state.factory, assets: [{ hasImage: true }] },
  ), 1);

  const markerOnlyFactory = {
    ...state,
    imageBase64: '',
    factory: {
      product: {
        hasImage: true,
        imagePreview: '__stored_in_indexeddb__',
        inputImages: [{ hasImage: true, preview: '__stored_in_indexeddb__' }],
      },
      assets: [{ hasImage: true, image: '__stored_in_indexeddb__' }],
    },
  };
  assert.equal(count(markerOnlyFactory, markerOnlyFactory.factory), 3);

  const currentSectionMarker = {
    ...state,
    step: 'sections',
    detailImageBlocks: [],
    sectionImages: { hero: '__stored_in_indexeddb__' },
    sectionVariants: { hero: [{ id: 'current', hasImage: true, image: '' }] },
    currentSectionVariantIds: { hero: 'current' },
  };
  assert.equal(count(currentSectionMarker), 1);
});

test('detail stage completes on its caller-owned draft without invoking image-stage cleanup', async () => {
  const factoryCore = source('src/app-core-06.js');
  const detailStageSource = sourceSlice(
    factoryCore,
    'async function factoryGenerateDetailStage(',
    'async function factoryRunStage(',
  );
  const imageStageSource = sourceSlice(
    factoryCore,
    'async function factoryGenerateImageCutsBackedStage(',
    'async function factoryGenerateImageStage(',
  );
  assert.match(imageStageSource, /finally\s*\{[\s\S]*factoryMarkImageStageRunInactive\(stageId, generationRunId\)/);

  const factory = {
    product: { analysis: { product_name: 'owned-detail-product' } },
    stages: { detail: { status: 'idle', message: '' } },
    assets: [],
    detailPlacement: {},
    goalRun: { running: true, progress: 0, failureReason: '' },
  };
  const state = {
    analysis: { product_name: 'owned-detail-product' },
    sectionContents: {},
    sectionImages: {},
    detailImageBlocks: [],
    sectionBatchRun: null,
    step: 'factory',
  };
  let heartbeatStarts = 0;
  let heartbeatStops = 0;
  let imageCleanupCalls = 0;
  let registeredFactory = null;
  const context = vm.createContext({
    state,
    cloneData: value => structuredClone(value),
    factoryUpdateFromInputs: draft => assert.strictEqual(draft, factory),
    factoryApplySelectedAssetsToSections: draft => {
      assert.strictEqual(draft, factory);
      return 0;
    },
    factoryApplyCombinedSectionBasisForDetailStage: () => 0,
    factorySetStageStatus: (stageId, status, message, draft) => {
      assert.strictEqual(draft, factory);
      draft.stages[stageId] = { ...(draft.stages[stageId] || {}), status, message };
    },
    factoryLog: (_message, _type, draft) => assert.strictEqual(draft, factory),
    factoryStageGoalProgressRange: () => [20, 90],
    factorySetGoalRunProgress: (progress, stage, _message, _type, options) => {
      assert.strictEqual(options.factory, factory);
      options.factory.goalRun.progress = progress;
      options.factory.goalRun.currentStage = stage;
    },
    saveLastWorkNow: () => true,
    render: () => true,
    factoryStartGoalHeartbeat: (_stage, _base, _max, _interval, options) => {
      assert.strictEqual(options.factory, factory);
      heartbeatStarts += 1;
      return 'detail-heartbeat';
    },
    factoryStopGoalHeartbeat: timer => {
      assert.equal(timer, 'detail-heartbeat');
      heartbeatStops += 1;
    },
    ensureCurrentProductAnalysisForGeneration: () => true,
    analysisMatchesCurrentImageInput: () => true,
    analysisHasUsableInference: () => true,
    factoryEnsureCurrentProductImageAnalysisForOneClick: async () => {
      throw new Error('ready analysis must not invoke external image analysis');
    },
    generateAllSections: async () => true,
    orderedSections: () => [],
    sectionWorkScopeMeta: () => ({}),
    sectionContentBelongsToCurrentWork: () => true,
    buildExportHtml: () => '<html><body>detail</body></html>',
    deriveProjectName: () => 'owned-detail',
    factoryRegisterAsset: (_stageId, _html, meta) => {
      registeredFactory = meta.factory;
      return { title: 'owned-detail HTML' };
    },
    factoryMarkImageStageRunInactive: () => { imageCleanupCalls += 1; },
  });
  vm.runInContext(`${detailStageSource}\nthis.runOwnedDetailStage = factoryGenerateDetailStage;`, context);

  const completed = await context.runOwnedDetailStage({ factory });
  assert.equal(completed, true);
  assert.strictEqual(registeredFactory, factory);
  assert.equal(factory.stages.detail.status, 'done');
  assert.equal(factory.goalRun.progress, 100);
  assert.equal(factory.goalRun.failureReason, '');
  assert.equal(factory.product.detailStageDebug.message, '상세페이지 전체 섹션 생성 응답 확인');
  assert.equal(heartbeatStarts, 1);
  assert.equal(heartbeatStops, 1);
  assert.equal(imageCleanupCalls, 0);
});

test('B1 VM and analysis orchestration opens exact commands and rejects stale work before external calls', async () => {
  const factoryCore = source('src/app-core-06.js');
  const vmCandidateSource = sourceSlice(
    factoryCore,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  const analysisEnsureSource = sourceSlice(
    factoryCore,
    'async function factoryEnsureCurrentProductImageAnalysisForOneClick(',
    'async function factoryRunCurrentProductImageAnalysisOnly(',
  );
  const analysisOnlySource = sourceSlice(
    factoryCore,
    'async function factoryRunCurrentProductImageAnalysisOnly(',
    'async function factoryYieldToPaint(',
  );
  const dbOneClickSource = sourceSlice(
    factoryCore,
    'async function factoryRunDbCompetitorHeroCutsFlow(',
    'async function factoryRunDbVmCandidatesOnlyFlow(',
  );
  const initialToken = Object.freeze({ workspaceId: 'workspace-b1', revision: 7, fence: 11 });
  let activeToken = initialToken;
  let externalCalls = 0;
  const commands = [];
  const drafts = {
    vm: { product: {}, automation: {}, goalRun: {}, stages: { db: {} }, logs: [] },
    analysis: { product: {}, automation: {}, goalRun: { running: true }, stages: { db: {} }, logs: [] },
    db: { product: {}, automation: {}, goalRun: { running: true }, stages: { db: {} }, logs: [] },
    ensure: { product: {}, automation: {}, goalRun: {}, stages: { db: {} }, logs: [] },
  };
  const store = {
    getOperationToken: () => activeToken,
    isOperationCurrent: token => token === activeToken,
  };
  const context = vm.createContext({
    state: { analysis: { product_name: 'ready-analysis' }, productName: '' },
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeStaleActionError: action => Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${action}`), {
      code: 'STALE_FACTORY_RUNTIME_ACTION',
    }),
    factoryRuntimeUpdateOwnedFactory: async (command, owner, mutator) => {
      commands.push(`${owner}:${command}`);
      const draft = command.includes('runVmCandidates')
        ? drafts.vm
        : command.includes('runCurrentProductAnalysisOnly')
          ? drafts.analysis
          : drafts.db;
      return { result: await mutator(draft) };
    },
    cleanDbSearchTerm: () => '',
    factoryLog: () => true,
    render: () => true,
    factoryUpdateFromInputs: () => true,
    factoryApplyProductToApp: () => true,
    restoreFactoryInputImageForGeneration: () => true,
    factoryClearStaleProductAnalysis: () => false,
    ensureCurrentProductAnalysisForGeneration: () => true,
    analysisMatchesCurrentImageInput: () => true,
    analysisHasUsableInference: () => true,
    factoryStoreCurrentProductAnalysis: factory => {
      factory.product.analysis = { product_name: 'ready-analysis' };
      return true;
    },
    factorySetStageStatus: () => true,
    saveLastWorkNow: () => true,
    factoryYieldToPaint: async () => true,
    factoryEnsureImageInferenceWithFallback: async () => {
      externalCalls += 1;
      return {};
    },
  });
  vm.runInContext(`
    ${vmCandidateSource}
    ${analysisEnsureSource}
    ${analysisOnlySource}
    ${dbOneClickSource}
    this.b1Workers = {
      vm: factoryRunVmCompetitorCollectionForSelection,
      ensure: factoryEnsureCurrentProductImageAnalysisForOneClick,
      analysis: factoryRunCurrentProductImageAnalysisOnly,
      db: factoryRunDbCompetitorHeroCutsFlow,
    };
  `, context);

  const vmResult = await context.b1Workers.vm();
  const analysisResult = await context.b1Workers.analysis();
  const dbResult = await context.b1Workers.db();
  const ensured = await context.b1Workers.ensure({ factory: drafts.ensure, operationToken: initialToken });
  assert.equal(vmResult.ok, false);
  assert.equal(analysisResult, false);
  assert.equal(dbResult, false);
  assert.equal(ensured.ok, true);
  assert.deepEqual(commands, [
    'competitors:factory/competitor:runVmCandidatesForSelection',
    'product-db:factory/db:runCurrentProductAnalysisOnly',
    'product-db:factory/db:runDb',
  ]);
  assert.equal(externalCalls, 0);

  activeToken = Object.freeze({ workspaceId: 'workspace-b2', revision: 0, fence: 12 });
  await assert.rejects(context.b1Workers.vm({ operationToken: initialToken }), /STALE_FACTORY_RUNTIME_ACTION/);
  await assert.rejects(context.b1Workers.analysis({ operationToken: initialToken }), /STALE_FACTORY_RUNTIME_ACTION/);
  await assert.rejects(context.b1Workers.db({ operationToken: initialToken }), /STALE_FACTORY_RUNTIME_ACTION/);
  await assert.rejects(
    context.b1Workers.ensure({ factory: drafts.ensure, operationToken: initialToken }),
    /STALE_FACTORY_RUNTIME_ACTION/,
  );
  assert.equal(commands.length, 3);
  assert.equal(externalCalls, 0);
});

test('B1 VM worker commits after a stubbed successful VM result and rejects a switched workspace before commit', async () => {
  const factoryCore = source('src/app-core-06.js');
  const vmCandidateSource = sourceSlice(
    factoryCore,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  const runScenario = async ({ switchDuringExternal = false } = {}) => {
    const initialToken = Object.freeze({ workspaceId: 'workspace-vm-success', revision: 3, fence: 7 });
    let activeToken = initialToken;
    const events = [];
    const row = { id: 'vm-row-1', title: 'VM 후보', _vm_search_id: 'vm-search-1' };
    const market = {
      selectedSites: ['site-a'],
      marketTargets: { 'site-a': 1 },
      selectedImageIds: [],
      groupedResults: {},
      scrapedImages: [],
    };
    const factory = {
      product: { productName: '테스트 제품', analysis: {} },
      automation: {},
      goalRun: { running: true, progress: 20 },
      stages: { db: {} },
      logs: [],
      uiPanels: {},
    };
    const store = {
      getOperationToken: () => activeToken,
      isOperationCurrent: token => token === activeToken,
    };
    const context = vm.createContext({
      state: { analysis: {}, productName: '테스트 제품', compPage: { marketScrape: market } },
      AbortController,
      COMP_MARKET_SITES: [{ id: 'site-a' }],
      factoryRuntimeRequireStore: () => store,
      factoryRuntimeStaleActionError: action => Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${action}`), {
        code: 'STALE_FACTORY_RUNTIME_ACTION',
      }),
      factoryRuntimeUpdateOwnedFactory: async (command, owner, mutator) => {
        events.push(`command-open:${owner}:${command}`);
        const result = await mutator(factory);
        events.push('command-commit');
        return { result };
      },
      cleanDbSearchTerm: value => String(value || '').trim(),
      factoryWizardDbSearchQueryFromInput: () => '',
      ensureCompMarketScrapeState: () => market,
      seedCompMarketDefaultProductContext: () => true,
      compMarketReadCandidateTargets: () => true,
      compMarketTargetForSite: () => 1,
      factoryAutomationStartRunCountForExecution: () => 1,
      compMarketCurrentWorkScope: () => ({ productKey: 'vm-product-1' }),
      compMarketApplyCurrentWorkScope: () => true,
      compMarketSetSiteSearchStatus: () => true,
      compMarketRecordVmSearchAttempt: () => true,
      factoryLog: () => true,
      factorySetGoalRunProgress: () => true,
      scheduleLastWorkSave: () => true,
      render: () => true,
      factoryRuntimeRenderWithOwnedDraft: () => true,
      factoryYieldToPaint: async () => true,
      factoryStartGoalHeartbeat: () => 'vm-heartbeat',
      factoryStopGoalHeartbeat: () => true,
      saveLastWorkNow: async () => true,
      factoryVmCandidateTimeoutMs: () => 1000,
      factoryResolveTaskWithTimeout: async promise => promise,
      runCompMarketScrape: async () => {
        events.push('vm-external-stub');
        market.results = [row];
        market.groupedResults = { 'site-a': [row] };
        market.searchId = 'vm-search-1';
        market.vmSearchId = 'vm-search-1';
        if (switchDuringExternal) {
          activeToken = Object.freeze({ workspaceId: 'workspace-vm-switched', revision: 0, fence: 8 });
        }
        return { ok: true, searchId: 'vm-search-1' };
      },
      compMarketCollectionContextIsCurrent: () => true,
      factoryFreshVmCandidateRows: () => ({ searchId: 'vm-search-1', sourceRows: [row], rows: [row] }),
      compMarketUpdateSiteSearchStatusFromGrouped: () => true,
      factoryNormalizeVmRowsFromCurrentRun: value => value,
      factoryVmCompetitorSearchTerms: () => ['테스트 제품'],
      factoryRunMarketplaceAssistedCandidateFallback: async () => {
        throw new Error('successful VM rows must not open fallback collection');
      },
      compMarketAssertCollectionContext: () => true,
      factoryImportCompetitorDataToFactory: rows => {
        factory.product.competitors = rows;
        factory.product.competitorSource = 'JepumScraper VM 후보 수집';
        return rows.length;
      },
      compMarketGroupProducts: rows => ({ 'site-a': rows }),
      compMarketPersistCandidateSnapshot: () => true,
      factoryShowVmCandidateSelectionTab: draft => {
        draft.automation.activeTab = 'competitor';
      },
      factoryMarkVmCandidateCollectionFailure: () => true,
      factoryClearVmCompetitorData: () => true,
    });
    vm.runInContext(`${vmCandidateSource}\nthis.runVmWorker = factoryRunVmCompetitorCollectionForSelection;`, context);
    return { context, events, factory, initialToken };
  };

  const success = await runScenario();
  const result = await success.context.runVmWorker({ operationToken: success.initialToken });
  assert.equal(result.ok, true);
  assert.equal(success.factory.product.competitors[0].id, 'vm-row-1');
  assert.deepEqual(success.events, [
    'command-open:competitors:factory/competitor:runVmCandidatesForSelection',
    'vm-external-stub',
    'command-commit',
  ]);

  const stale = await runScenario({ switchDuringExternal: true });
  await assert.rejects(
    stale.context.runVmWorker({ operationToken: stale.initialToken }),
    /STALE_FACTORY_RUNTIME_ACTION/,
  );
  assert.deepEqual(stale.events, [
    'command-open:competitors:factory/competitor:runVmCandidatesForSelection',
    'vm-external-stub',
  ]);
});

test('B2 auto and goal loop share one lease and commit only their exact successful command', async () => {
  const harness = await createB2AutomationRuntimeHarness('shared-goal-lease');
  let releaseAutoStage;
  let markAutoStageStarted;
  const autoStageStarted = new Promise(resolve => { markAutoStageStarted = resolve; });
  let firstAutoStage = true;
  harness.controls.onStage = async () => {
    if (harness.controls.currentCommand === 'factory/automation:runAuto' && firstAutoStage) {
      firstAutoStage = false;
      markAutoStageStarted();
      await new Promise(resolve => { releaseAutoStage = resolve; });
    }
    return true;
  };

  const autoRun = harness.context.b2Workers.auto();
  await autoStageStarted;
  assert.equal(await harness.context.b2Workers.auto(), false);
  assert.equal(await harness.context.b2Workers.goal(), false);
  releaseAutoStage();
  assert.equal(await autoRun, true);
  assert.deepEqual(harness.events.filter(event => /^(?:command|external)/.test(event)), [
    'command-open:factory:factory/automation:runAuto',
    'external-stage:db',
    'external-stage:hero',
    'external-stage:size',
    'external-stage:options',
    'external-stage:cuts',
    'external-stage:detail',
    'external-stage:export',
    'command-commit:factory/automation:runAuto',
  ]);

  const goalEventStart = harness.events.length;
  harness.controls.onStage = async (stageId, options) => {
    if (stageId === 'hero') options.factory.assets.push({ id: 'goal-hero-1', stageId: 'hero' });
    return true;
  };
  assert.equal(await harness.context.b2Workers.goal(), true);
  assert.deepEqual(harness.events.slice(goalEventStart).filter(event => /^(?:command|external)/.test(event)), [
    'command-open:factory:factory/automation:runGoalLoop',
    'external-stage:hero',
    'external-archive',
    'command-commit:factory/automation:runGoalLoop',
  ]);
  assert.equal(harness.store.getSnapshot().factory.assets[0].id, 'goal-hero-1');
});

test('B2 stage button rejects re-entry and workspace switch aborts before commit or post-switch effects', async () => {
  const harness = await createB2AutomationRuntimeHarness('stage-reentry');
  const button = { disabled: false, dataset: { factoryRunStage: 'size' } };
  let releaseStage;
  let markStageStarted;
  const stageStarted = new Promise(resolve => { markStageStarted = resolve; });
  harness.controls.onStage = async (stageId, options) => {
    markStageStarted();
    await new Promise(resolve => { releaseStage = resolve; });
    options.factory.stages[stageId].status = 'done';
    return true;
  };
  const first = harness.context.b2Workers.stage(button);
  await stageStarted;
  assert.equal(await harness.context.b2Workers.stage(button), false);
  releaseStage();
  assert.equal(await first, true);
  assert.deepEqual(harness.events.filter(event => /^(?:command|external)/.test(event)), [
    'command-open:factory:factory/assets:handleRunStageButton',
    'external-stage:size',
    'command-commit:factory/assets:handleRunStageButton',
  ]);

  const stale = await createB2AutomationRuntimeHarness('stage-switch');
  let effectsAtSwitch = null;
  stale.controls.onStage = async () => {
    stale.store.switchWorkspace('workspace-b2-stage-switched', {
      snapshot: stale.snapshotValue(),
      revision: 0,
    });
    effectsAtSwitch = { ...stale.sideEffects };
    return true;
  };
  await assert.rejects(
    stale.context.b2Workers.stage(button),
    /STALE_FACTORY_RUNTIME_ACTION|STALE_FACTORY_STORE/,
  );
  assert.deepEqual(stale.events.filter(event => /^(?:command|external)/.test(event)), [
    'command-open:factory:factory/assets:handleRunStageButton',
    'external-stage:size',
  ]);
  assert.deepEqual(stale.sideEffects, effectsAtSwitch);
  assert.deepEqual(stale.store.getSnapshot().factory.logs, []);
});

test('B2 stop records once for the current run and second or stale stop has zero effects', async () => {
  const harness = await createB2AutomationRuntimeHarness('stop-idempotence');
  let releaseAutoStage;
  let markAutoStageStarted;
  const autoStageStarted = new Promise(resolve => { markAutoStageStarted = resolve; });
  harness.controls.onStage = async () => {
    markAutoStageStarted();
    await new Promise(resolve => { releaseAutoStage = resolve; });
    return true;
  };
  const autoRun = harness.context.b2Workers.auto();
  await autoStageStarted;

  const beforeStop = { ...harness.sideEffects };
  assert.equal(harness.context.b2Workers.stop(), true);
  assert.deepEqual(harness.sideEffects, {
    log: beforeStop.log + 1,
    save: beforeStop.save + 1,
    render: beforeStop.render + 1,
  });
  const stoppedSnapshot = harness.store.getSnapshot().factory;
  assert.equal(stoppedSnapshot.logs.length, 1);
  assert.match(stoppedSnapshot.logs[0].message, /중단하고 검수 상태/);

  const afterFirstStop = { ...harness.sideEffects };
  assert.equal(harness.context.b2Workers.stop(), false);
  assert.deepEqual(harness.sideEffects, afterFirstStop);
  assert.equal(harness.store.getSnapshot().factory.logs.length, 1);

  const staleToken = harness.store.getOperationToken();
  harness.store.switchWorkspace('workspace-b2-stop-switched', {
    snapshot: harness.snapshotValue(),
    revision: 0,
  });
  const beforeStaleStop = { ...harness.sideEffects };
  assert.throws(
    () => harness.context.b2Workers.stop({ operationToken: staleToken }),
    /STALE_FACTORY_RUNTIME_ACTION/,
  );
  assert.deepEqual(harness.sideEffects, beforeStaleStop);
  assert.deepEqual(harness.store.getSnapshot().factory.logs, []);

  releaseAutoStage();
  await assert.rejects(autoRun, /STALE_FACTORY_RUNTIME_ACTION|STALE_FACTORY_STORE/);
  assert.deepEqual(harness.sideEffects, beforeStaleStop);
  assert.deepEqual(harness.events.filter(event => /^(?:command|external)/.test(event)), [
    'command-open:factory:factory/automation:runAuto',
    'external-stage:db',
    'command-open:factory:factory/automation:stopGoalRun',
    'command-commit:factory/automation:stopGoalRun',
  ]);
});

test('B3 detail and cut generation source requires exact commands, stable identity, and owned drafts', () => {
  const core = source('src/app-core-03.js');
  const factoryCore = source('src/app-core-06.js');
  const detailWriter = sourceSlice(
    factoryCore,
    'async function runCompMarketDetailCapture(',
    'async function compMarketResumeDetailJobRequest(',
  );
  const cutsWriter = sourceSlice(
    factoryCore,
    'async function generateAllCuts(',
    'const SIZE_CUTS_RESULT_CACHE_KEY',
  );
  const sizeWriter = sourceSlice(
    factoryCore,
    'async function generateAllSizeCuts(',
    'function cutPromptMeaningfulScore(',
  );
  const singleCutWriter = sourceSlice(
    factoryCore,
    'async function generateCut(',
    'async function generateAllCuts(',
  );
  const singleSizeWriter = sourceSlice(
    factoryCore,
    'async function generateSizeCut(',
    'async function generateAllSizeCuts(',
  );
  const persistedCutWriter = sourceSlice(
    factoryCore,
    'async function factoryPersistGeneratedCutPromptResult(',
    'function factoryClearAssetSupersededMarker(',
  );
  const imageStageWriter = sourceSlice(
    factoryCore,
    'async function factoryGenerateImageCutsBackedStage(',
    'async function factoryGenerateImageStage(',
  );
  for (const writer of [detailWriter, cutsWriter, sizeWriter]) {
    assert.doesNotMatch(writer, /factoryRuntimeReadFactory\(\)/);
    assert.match(writer, /factoryRuntimeUpdateOwnedFactory\(/);
    assert.match(writer, /factoryRequireCurrentRunOperation\(/);
    assert.match(writer, /operationSignal/);
  }
  assert.match(detailWriter, /factory\/competitor:runDetailCapture/);
  assert.match(detailWriter, /acquireOperationLease\('factory\/competitor:detail-capture'/);
  assert.match(detailWriter, /stableTargetKey/);
  assert.match(detailWriter, /\.slice\(\)\.sort\(\)\.join/);
  assert.match(cutsWriter, /factory\/assets:generateAllCuts/);
  assert.match(sizeWriter, /factory\/assets:generateAllSizeCuts/);
  assert.match(cutsWriter, /acquireOperationLease\('factory\/assets:image-cuts-generation'/);
  assert.match(sizeWriter, /acquireOperationLease\('factory\/assets:image-cuts-generation'/);
  assert.match(cutsWriter, /generateCut\([\s\S]*?factory,[\s\S]*?operationToken,[\s\S]*?operationSignal:/);
  assert.match(sizeWriter, /generateSizeCut\([\s\S]*?factory,[\s\S]*?operationToken,[\s\S]*?operationSignal:/);
  for (const writer of [singleCutWriter, singleSizeWriter]) {
    assert.match(writer, /const factory = options\.factory \|\| factoryRuntimeReadFactory\(\)/);
    assert.match(writer, /factorySyncCutsSourceToCurrentProductAsync\([\s\S]*?factory,[\s\S]*?operationToken:[\s\S]*?operationSignal:/);
    assert.match(writer, /generateImageWithAbortableTimeout\([\s\S]*?operationSignal: options\.operationSignal/);
    assert.match(writer, /factoryPersistGeneratedCutPromptResult\([\s\S]*?factory,[\s\S]*?operationToken:[\s\S]*?operationSignal:/);
    assert.equal((writer.match(/requireCurrent\(\)/g) || []).length >= 5, true);
  }
  assert.match(persistedCutWriter, /const factory = options\.factory \|\| factoryRuntimeReadFactory\(\)/);
  assert.match(persistedCutWriter, /factoryQueueLocalArchiveAsset\([\s\S]*?factory,[\s\S]*?operationToken: options\.operationToken/);
  assert.match(persistedCutWriter, /factoryRequireCurrentRunOperation\([\s\S]*?options\.operationSignal/);
  assert.match(imageStageWriter, /generateAllSizeCuts\(\{ factory, operationToken: options\.operationToken, operationSignal: options\.operationSignal \}\)/);
  assert.match(imageStageWriter, /generateAllCuts\(\{ factory, operationToken: options\.operationToken, operationSignal: options\.operationSignal \}\)/);
  assert.match(imageStageWriter, /factoryStopGoalHeartbeat\(heartbeat\);[\s\S]*?factoryRunOperationIsStale\(e\)/);
  for (const writer of [cutsWriter, sizeWriter]) {
    assert.doesNotMatch(writer, /(?:state|window|globalThis)\.factory/);
  }
  for (const command of [
    'factory/competitor:runDetailCapture',
    'factory/assets:generateAllCuts',
    'factory/assets:generateAllSizeCuts',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
});

test('B4 archive and selected-file operations require identity-fenced single commits', () => {
  const core = source('src/app-core-03.js');
  const factoryCore = source('src/app-core-06.js');
  const archiveWriter = sourceSlice(
    factoryCore,
    'async function factoryQueueLocalArchiveAsset(',
    'async function factoryArchiveCurrentInputImage(',
  );
  const archiveIdentity = sourceSlice(
    factoryCore,
    'function factoryLocalArchiveAssetOperationIdentity(',
    'function factoryLocalArchiveAssetIdentityError(',
  );
  const fileWriter = sourceSlice(
    factoryCore,
    'function cutsPromoteFileToCurrentProduct(',
    'function loadCutSource(',
  );
  for (const writer of [archiveWriter, fileWriter]) {
    assert.doesNotMatch(writer, /factoryRuntimeReadFactory\(\)/);
    assert.match(writer, /factoryRuntimeUpdateOwnedFactory\(/);
    assert.match(writer, /operationToken/);
  }
  assert.match(archiveWriter, /factory\/assets:archiveFactoryAsset/);
  assert.match(archiveWriter, /factoryLocalArchiveAssetOperationIdentity/);
  assert.match(archiveWriter, /await factoryBackendArchiveAsset\([\s\S]*?factoryLocalArchiveAssetOperationIsCurrent/);
  assert.match(archiveIdentity, /contentDigest/);
  assert.match(archiveIdentity, /assetId/);
  assert.match(archiveIdentity, /workspaceId/);
  assert.match(fileWriter, /factory\/source:promoteCutsInputFile/);
  assert.match(fileWriter, /cutsSelectedFileIdentity/);
  assert.match(fileWriter, /reader\.onerror/);
  assert.match(fileWriter, /reader\.onabort/);
  assert.match(fileWriter, /reader\.onload\s*=\s*null/);
  assert.match(fileWriter, /reader\.onerror\s*=\s*null/);
  assert.match(fileWriter, /reader\.onabort\s*=\s*null/);
  assert.match(fileWriter, /firstTerminalEvent|terminalEvent/);
  for (const command of [
    'factory/assets:archiveFactoryAsset',
    'factory/source:promoteCutsInputFile',
  ]) {
    assert.match(core, new RegExp(command.replace('/', '\\/')));
  }
});

async function createB4SelectedFileRuntimeHarness(label) {
  const core = source('src/app-core-03.js');
  const factoryCore = source('src/app-core-06.js');
  const createRuntimePolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', `b4-file-${label}`);
  const factoryValue = () => ({
    product: {
      productName: 'B4 파일 테스트 상품',
      userProductName: 'B4 파일 테스트 상품',
      productKey: 'b4-product',
      productIdentityKey: 'b4-product',
      lockedInputImageFingerprint: 'old-fingerprint',
    },
    automation: { currentRunId: 'run-old', currentRunStartedAt: 1 },
    goalRun: { currentRunId: 'run-old' },
    stages: {
      hero: { status: 'done', selectedAssetIds: ['old-hero'] },
      cuts: { status: 'done', selectedAssetIds: ['old-cut'] },
      size: { status: 'done', selectedAssetIds: ['old-size'] },
    },
    assets: [{ id: 'old-cut', stageId: 'cuts' }],
    previousAssets: [],
    archive: { localStatus: 'unchanged' },
    logs: [],
  });
  const snapshotValue = () => ({
    factory: factoryValue(),
    productDb: {},
    competitors: {},
    factoryAssets: {},
    detailDocument: {},
    cafe24: {},
  });
  const store = createFactoryStore({
    initialSnapshot: snapshotValue(),
    workspaceId: `workspace-b4-file-${label}`,
    commandPolicies: createRuntimePolicies(),
  });
  const readers = [];
  const events = [];
  const archiveRequests = [];
  const sideEffects = {
    archive: 0,
    composition: 0,
    compositionAttempts: 0,
    cuts: 0,
    log: 0,
    refresh: 0,
    render: 0,
    save: 0,
  };
  const controls = {
    mutateSibling: false,
    switchAfterCommitBeforeComposition: false,
    throwOnRead: false,
  };
  class ControlledFileReader {
    constructor() {
      this.file = null;
      this.onload = null;
      this.onerror = null;
      this.onabort = null;
      this.readyState = 0;
      this.abortCount = 0;
      readers.push(this);
    }

    readAsDataURL(file) {
      if (controls.throwOnRead) throw new Error('stub reader throw');
      this.file = file;
      this.readyState = 1;
    }

    abort() {
      this.abortCount += 1;
      this.readyState = 2;
      const handler = this.onabort;
      if (handler) handler({ target: this });
    }

    emit(kind, result = '') {
      this.readyState = 2;
      const handler = this[`on${kind}`];
      if (handler) handler({ target: { result } });
    }
  }
  const staleError = action => Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${action}`), {
    code: 'STALE_FACTORY_RUNTIME_ACTION',
  });
  const sourceIdentity = (factory, token) => ({
    workspaceId: String(token?.workspaceId || ''),
    productKey: String(factory?.product?.productKey || ''),
    productName: String(factory?.product?.productName || ''),
  });
  let identityCheckCount = 0;
  const identityMatches = (expected, factory) => {
    identityCheckCount += 1;
    if (controls.switchAfterCommitBeforeComposition && identityCheckCount === 3) {
      controls.switchAfterCommitBeforeComposition = false;
      store.switchWorkspace(`workspace-b4-file-${label}-switched-after-commit`, {
        snapshot: snapshotValue(),
        revision: 0,
      });
    }
    const token = store.getOperationToken();
    const current = sourceIdentity(factory, token);
    return store.isOperationCurrent(token) &&
      expected.workspaceId === current.workspaceId &&
      expected.productKey === current.productKey;
  };
  const context = vm.createContext({
    FileReader: ControlledFileReader,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeStaleActionError: staleError,
    factoryRuntimeUpdateOwnedFactory: (command, owner, mutator) => {
      const token = store.getOperationToken();
      events.push(`command-open:${owner}:${command}`);
      let receipt;
      try {
        receipt = store.updateDraft(
          mutator,
          { owner, expectedRevision: token.revision },
          command,
        );
      } catch (error) {
        events.push(`command-error:${error?.message || error}`);
        throw error;
      }
      events.push(`command-commit:${command}`);
      return receipt;
    },
    factorySourceOperationIdentity: sourceIdentity,
    factorySourceOperationIdentityMatches: identityMatches,
    imageBase64Only: value => String(value || '').trim(),
    inferImageMimeFromBase64: (_base64, fallback) => fallback,
    factoryCurrentProductIdentityMeta: factory => ({
      productName: factory.product.productName,
      productIdentityKey: factory.product.productKey,
    }),
    factoryStampLockedInputImage: (factory, payload, meta) => {
      assert.equal(meta.deferPeerState, true);
      factory.product.imageBase64 = payload.base64;
      factory.product.imageMime = payload.mime;
      factory.product.imagePreview = payload.preview;
      factory.product.imageName = payload.name;
      factory.product.hasImage = true;
      factory.product.lockedInputImageFingerprint = `fp:${payload.base64}`;
      factory.product.inputImageFingerprint = `fp:${payload.base64}`;
      factory.product.inputImages = [{ id: 'b4-input', base64: payload.base64 }];
      factory.assets = [];
      factory.previousAssets = [{ id: 'old-cut', stageId: 'cuts' }];
      factory.stages.cuts.status = 'idle';
      factory.automation.currentRunId = 'run-new';
      factory.automation.currentRunStartedAt = 2;
      factory.goalRun.currentRunId = 'run-new';
      if (controls.mutateSibling) factory.archive.localStatus = 'forbidden sibling write';
      return `fp:${payload.base64}`;
    },
    factoryApplyCommittedSourceImageComposition: (composition, options) => {
      sideEffects.compositionAttempts += 1;
      if (!store.isOperationCurrent(options.operationToken)) return false;
      sideEffects.composition += 1;
      events.push(`composition:${composition.name}`);
      return true;
    },
    factoryApplyCutsSourceImageToState: stageId => {
      sideEffects.cuts += 1;
      events.push(`cuts:${stageId}`);
      return true;
    },
    cutsAppendRunLog: () => {
      sideEffects.log += 1;
      events.push('log');
    },
    factoryArchiveCurrentInputImage: async (payload, options) => {
      sideEffects.archive += 1;
      archiveRequests.push({ payload, options });
      events.push('archive');
      return { payload, options };
    },
    factoryRefreshLocalArchiveAssets: async () => {
      sideEffects.refresh += 1;
      return true;
    },
    savePrompts: () => {
      sideEffects.save += 1;
      events.push('save-prompts');
    },
    cutsScheduleLightSave: () => {
      sideEffects.save += 1;
      events.push('save-light');
    },
    renderPreservingMainScroll: () => {
      sideEffects.render += 1;
      events.push('render');
    },
  });
  const fileWriter = sourceSlice(
    factoryCore,
    'function cutsPromoteFileToCurrentProduct(',
    'function loadCutSource(',
  );
  const runtimeNames = Object.keys(context);
  context.b4PromoteFile = new Function(
    ...runtimeNames,
    `${fileWriter}\nreturn cutsPromoteFileToCurrentProduct;`,
  )(...runtimeNames.map(name => context[name]));
  return { archiveRequests, context, controls, events, factoryValue, readers, sideEffects, snapshotValue, store };
}

test('B4 selected file load commits once, composes once, preserves archive identity, and cleans handlers', async () => {
  const harness = await createB4SelectedFileRuntimeHarness('success');
  const file = { name: 'current.png', type: 'image/png', size: 10, lastModified: 20 };
  assert.equal(harness.context.b4PromoteFile(file, 'cuts'), true);
  const reader = harness.readers[0];
  reader.emit('load', 'data:image/png;base64,CURRENT_IMAGE');
  await Promise.resolve();

  const committed = harness.store.getSnapshot().factory;
  assert.equal(committed.product.imageBase64, 'CURRENT_IMAGE', harness.events.join('\n'));
  assert.equal(committed.archive.localStatus, 'unchanged');
  assert.equal(harness.sideEffects.composition, 1);
  assert.equal(harness.sideEffects.cuts, 1);
  assert.equal(harness.sideEffects.archive, 1);
  assert.equal(harness.sideEffects.log, 1);
  assert.equal(harness.sideEffects.save, 2);
  assert.equal(harness.sideEffects.render, 1);
  assert.deepEqual(harness.events.slice(0, 7), [
    'command-open:factory-assets:factory/source:promoteCutsInputFile',
    'command-commit:factory/source:promoteCutsInputFile',
    'composition:current.png',
    'cuts:cuts',
    'log',
    'archive',
    'save-prompts',
  ]);
  assert.equal(harness.archiveRequests[0].options.operationIdentity.workspaceId, 'workspace-b4-file-success');
  assert.equal(harness.archiveRequests[0].options.operationIdentity.productKey, 'b4-product');
  assert.equal(harness.archiveRequests[0].options.operationToken.revision, 1);
  reader.emit('error');
  reader.abort();
  assert.equal(harness.sideEffects.composition, 1);
  assert.equal(harness.sideEffects.archive, 1);
  assert.equal(reader.onload, null);
  assert.equal(reader.onerror, null);
  assert.equal(reader.onabort, null);
  assert.equal(harness.context.b4PromoteFile.activeReader, null);
  assert.equal(harness.context.b4PromoteFile.activeFile, null);
  assert.equal(harness.context.b4PromoteFile.activeFileIdentity, null);
});

test('B4 selected file error and abort are first-terminal and leave zero effects or references', async () => {
  for (const terminalKind of ['error', 'abort']) {
    const harness = await createB4SelectedFileRuntimeHarness(`terminal-${terminalKind}`);
    const file = { name: `${terminalKind}.png`, type: 'image/png', size: 10, lastModified: 20 };
    assert.equal(harness.context.b4PromoteFile(file, 'cuts'), true);
    const reader = harness.readers[0];
    if (terminalKind === 'abort') reader.abort();
    else reader.emit('error');
    reader.emit('load', 'data:image/png;base64,LATE_IMAGE');

    assert.deepEqual(harness.sideEffects, {
      archive: 0,
      composition: 0,
      compositionAttempts: 0,
      cuts: 0,
      log: 0,
      refresh: 0,
      render: 0,
      save: 0,
    });
    assert.equal(reader.onload, null);
    assert.equal(reader.onerror, null);
    assert.equal(reader.onabort, null);
    assert.equal(harness.context.b4PromoteFile.activeReader, null);
    assert.equal(harness.context.b4PromoteFile.activeFile, null);
    assert.equal(harness.context.b4PromoteFile.activeFileIdentity, null);
  }

  const thrown = await createB4SelectedFileRuntimeHarness('terminal-throw');
  thrown.controls.throwOnRead = true;
  assert.equal(thrown.context.b4PromoteFile({
    name: 'throw.png', type: 'image/png', size: 10, lastModified: 20,
  }, 'cuts'), false);
  assert.deepEqual(thrown.sideEffects, {
    archive: 0,
    composition: 0,
    compositionAttempts: 0,
    cuts: 0,
    log: 0,
    refresh: 0,
    render: 0,
    save: 0,
  });
  assert.equal(thrown.context.b4PromoteFile.activeReader, null);
  assert.equal(thrown.context.b4PromoteFile.activeFile, null);
  assert.equal(thrown.context.b4PromoteFile.activeFileIdentity, null);
});

test('B4 newer selection aborts the prior reader and only the current file can commit', async () => {
  const harness = await createB4SelectedFileRuntimeHarness('double-selection');
  const firstFile = { name: 'first.png', type: 'image/png', size: 1, lastModified: 1 };
  const secondFile = { name: 'second.png', type: 'image/png', size: 2, lastModified: 2 };
  assert.equal(harness.context.b4PromoteFile(firstFile, 'cuts'), true);
  const firstReader = harness.readers[0];
  assert.equal(harness.context.b4PromoteFile(secondFile, 'cuts'), true);
  const secondReader = harness.readers[1];
  assert.equal(firstReader.abortCount, 1);
  firstReader.emit('load', 'data:image/png;base64,FIRST_IMAGE');
  secondReader.emit('load', 'data:image/png;base64,SECOND_IMAGE');
  await Promise.resolve();

  assert.equal(harness.store.getSnapshot().factory.product.imageBase64, 'SECOND_IMAGE');
  assert.equal(harness.sideEffects.composition, 1);
  assert.equal(harness.sideEffects.archive, 1);
});

test('B4 workspace switches before load or composition produce zero stale peer effects', async () => {
  const beforeLoad = await createB4SelectedFileRuntimeHarness('switch-before-load');
  const beforeLoadFile = { name: 'before-load.png', type: 'image/png', size: 1, lastModified: 1 };
  beforeLoad.context.b4PromoteFile(beforeLoadFile, 'cuts');
  beforeLoad.store.switchWorkspace('workspace-b4-file-before-load-switched', {
    snapshot: beforeLoad.snapshotValue(),
    revision: 0,
  });
  beforeLoad.readers[0].emit('load', 'data:image/png;base64,STALE_BEFORE_LOAD');
  assert.equal(beforeLoad.sideEffects.composition, 0);
  assert.equal(beforeLoad.sideEffects.archive, 0);
  assert.equal(beforeLoad.sideEffects.log, 0);
  assert.equal(beforeLoad.sideEffects.save, 0);
  assert.equal(beforeLoad.sideEffects.render, 0);

  const beforeComposition = await createB4SelectedFileRuntimeHarness('switch-before-composition');
  const beforeCompositionFile = { name: 'before-composition.png', type: 'image/png', size: 1, lastModified: 1 };
  beforeComposition.controls.switchAfterCommitBeforeComposition = true;
  beforeComposition.context.b4PromoteFile(beforeCompositionFile, 'cuts');
  beforeComposition.readers[0].emit('load', 'data:image/png;base64,STALE_BEFORE_COMPOSITION');
  assert.equal(beforeComposition.sideEffects.compositionAttempts, 0);
  assert.equal(beforeComposition.sideEffects.composition, 0);
  assert.equal(beforeComposition.sideEffects.cuts, 0);
  assert.equal(beforeComposition.sideEffects.archive, 0);
  assert.equal(beforeComposition.sideEffects.log, 0);
  assert.equal(beforeComposition.sideEffects.save, 0);
  assert.equal(beforeComposition.sideEffects.render, 0);
});

test('B4 exact source promotion policy accepts owned paths and rolls back a sibling archive write', async () => {
  const harness = await createB4SelectedFileRuntimeHarness('policy-rollback');
  const allowedToken = harness.store.getOperationToken();
  const allowed = harness.store.updateDraft(draft => {
    draft.product.imageName = 'allowed.png';
    draft.assets = [];
    draft.previousAssets = [];
    draft.stages.cuts.status = 'idle';
    draft.automation.currentRunId = 'allowed-run';
    draft.automation.currentRunStartedAt = 2;
    draft.goalRun.currentRunId = 'allowed-run';
    return true;
  }, {
    owner: 'factory-assets',
    expectedRevision: allowedToken.revision,
  }, 'factory/source:promoteCutsInputFile');
  assert.equal(allowed.result, true);

  const beforeReject = harness.store.getSnapshot();
  const rejectToken = harness.store.getOperationToken();
  assert.throws(() => harness.store.updateDraft(draft => {
    draft.product.imageName = 'must-roll-back.png';
    draft.archive.localStatus = 'forbidden sibling write';
  }, {
    owner: 'factory-assets',
    expectedRevision: rejectToken.revision,
  }, 'factory/source:promoteCutsInputFile'), /PATH_REJECTED|owner/i);
  assert.strictEqual(harness.store.getSnapshot(), beforeReject);
  assert.equal(harness.store.getSnapshot().factory.product.imageName, 'allowed.png');
  assert.equal(harness.store.getSnapshot().factory.archive.localStatus, 'unchanged');
});

test('source image promotion rejects stale async payloads and composes peer image state only after a current commit', async () => {
  const factoryCore = source('src/app-core-06.js');
  const promotionDraftWriter = sourceSlice(
    factoryCore,
    'async function factoryPromoteStoredProductCandidateToInputDraft(',
    'function factoryScheduleStoredProductCandidatePromotion(',
  );
  const compositionWriter = sourceSlice(
    factoryCore,
    'function factoryApplyCommittedSourceImageComposition(',
    'function factoryApplyCutsSourceImageToState(',
  );
  const operationToken = Object.freeze({ workspaceId: 'workspace-source-a', revision: 3, fence: 1 });
  const candidate = { id: 'archive-input-a', src: 'memory://input-a', title: '입력 원본 A', stageLabel: '입력' };
  const peerState = { productName: '제품 A' };
  let operationCurrent = true;
  let payloadPromise = null;
  const createPromotionDraft = new Function(
    'factoryRuntimeRequireStore', 'factoryRuntimeStaleActionError', 'currentProductImagePayload',
    'factoryStoredProductCandidateForDisplay', 'factoryStoredProductCandidateIsInputSource',
    'factorySourceOperationIdentity', 'factoryStoredProductCandidateKey',
    'factoryStoredProductCandidateToPayload', 'factorySourceOperationIdentityMatches',
    'imageBase64Only', 'inferImageMimeFromBase64', 'factoryCurrentProductIdentityMeta',
    'state', 'factoryStampLockedInputImage', 'factoryImagePayloadFingerprint', 'factoryLog',
    `${promotionDraftWriter}; return factoryPromoteStoredProductCandidateToInputDraft;`,
  );
  const promoteDraft = createPromotionDraft(
    () => ({
      getOperationToken: () => operationToken,
      isOperationCurrent: token => operationCurrent && token === operationToken,
    }),
    action => Object.assign(new Error(`STALE:${action}`), { code: 'STALE_FACTORY_RUNTIME_ACTION' }),
    () => null,
    () => candidate,
    () => true,
    factory => ({ workspaceId: operationToken.workspaceId, productKey: factory.product.productKey, productName: factory.product.productName }),
    image => String(image?.id || image?.src || ''),
    () => payloadPromise,
    (expected, factory) => operationCurrent && expected.productKey === factory.product.productKey,
    value => String(value || ''),
    (_base64, fallback) => fallback,
    factory => ({ productName: factory.product.productName, productIdentityKey: factory.product.productKey }),
    peerState,
    (factory, payload) => {
      factory.product.imageBase64 = payload.base64;
      factory.product.lockedInputImageFingerprint = `fp:${payload.base64}`;
    },
    value => `fp:${value}`,
    (message, tone, factory) => {
      factory.logs = [{ message, tone }, ...(factory.logs || [])];
    },
  );

  let resolveStalePayload;
  payloadPromise = new Promise(resolve => { resolveStalePayload = resolve; });
  const staleDraft = {
    product: { productName: '제품 A', userProductName: '제품 A', productKey: 'product-a' },
    logs: [],
  };
  const stalePromotion = promoteDraft({ factory: staleDraft, operationToken });
  operationCurrent = false;
  resolveStalePayload({ base64: 'STALE_IMAGE', mime: 'image/png', preview: 'stale', name: 'stale.png' });
  await assert.rejects(stalePromotion, /STALE:factory\/source:promoteStoredProductInput/);
  assert.equal(staleDraft.product.imageBase64, undefined);
  assert.equal(peerState.imageBase64, undefined);

  operationCurrent = true;
  payloadPromise = Promise.resolve({ base64: 'CURRENT_IMAGE', mime: 'image/png', preview: 'current', name: 'current.png' });
  const currentDraft = {
    product: { productName: '제품 A', userProductName: '제품 A', productKey: 'product-a' },
    logs: [],
  };
  const promotionResult = await promoteDraft({ factory: currentDraft, operationToken });
  assert.equal(promotionResult.ok, true);
  assert.equal(currentDraft.product.imageBase64, 'CURRENT_IMAGE');
  assert.equal(peerState.imageBase64, undefined);

  const createComposition = new Function(
    'imageBase64Only', 'factoryRuntimeIsOperationCurrent', 'inferImageMimeFromBase64',
    'state', 'factoryImagePayloadFingerprint', 'ensureCompMarketScrapeState',
    `${compositionWriter}; return factoryApplyCommittedSourceImageComposition;`,
  );
  const composeCommitted = createComposition(
    value => String(value || ''),
    () => operationCurrent,
    (_base64, fallback) => fallback,
    peerState,
    value => `fp:${value}`,
    () => null,
  );
  operationCurrent = false;
  assert.equal(composeCommitted(promotionResult.composition, { force: true, operationToken }), false);
  assert.equal(peerState.imageBase64, undefined);
  operationCurrent = true;
  assert.equal(composeCommitted(promotionResult.composition, { force: true, analysis: true, operationToken }), true);
  assert.equal(peerState.imageBase64, 'CURRENT_IMAGE');
  assert.equal(peerState.analysisImages[0].base64, 'CURRENT_IMAGE');
});

test('DB program and Cafe24 OAuth workers reject stale external completions before committing', async () => {
  const factoryCore = source('src/app-core-06.js');
  const programWriter = sourceSlice(
    factoryCore,
    'async function factoryRunCandidateProgramStart(',
    'async function factoryStartSinhwaDbAndRerunCandidates(',
  );
  const oauthStatusWriter = sourceSlice(
    factoryCore,
    'async function factoryRefreshCafe24OAuthStatus(',
    'async function factoryRunVmCompetitorCollectionForSelection(',
  );
  let activeToken = Object.freeze({ workspaceId: 'workspace-db-oauth', revision: 7, fence: 1 });
  const store = {
    getOperationToken: () => activeToken,
    isOperationCurrent: token => token === activeToken,
  };
  const programCommits = [];
  const oauthCommits = [];
  const downstreamTokens = [];
  let saveCount = 0;
  let renderCount = 0;
  const staleError = action => Object.assign(new Error(`STALE:${action}`), {
    code: 'STALE_FACTORY_RUNTIME_ACTION',
  });
  const createProgramWorker = new Function(
    'factoryRuntimeRequireStore', 'factoryRuntimeStaleActionError', 'factoryCommitCandidateProgramState',
    'saveLastWorkNow', 'render', 'factoryYieldToPaint', 'factoryRuntimeUpdateOwnedFactory',
    'factoryRunDbVmCandidatesOnlyFlow', 'factoryRunDbCandidatesForSelection',
    `${programWriter}; return factoryRunCandidateProgramStart;`,
  );
  const runProgram = createProgramWorker(
    () => store,
    staleError,
    (kind, phase, recoveryScope, payload, operationToken) => {
      programCommits.push({ kind, phase, recoveryScope, payload, operationToken });
      activeToken = Object.freeze({ ...operationToken, revision: operationToken.revision + 1 });
      return { result: { ok: phase === 'ready' } };
    },
    () => { saveCount += 1; },
    () => { renderCount += 1; },
    async () => {},
    () => { throw new Error('unexpected VM downstream'); },
    () => { throw new Error('unexpected VM flow'); },
    async options => {
      downstreamTokens.push(options.operationToken);
      return { ok: true, label: 'DB 후보' };
    },
  );

  let resolveProgram;
  let markProgramStarted;
  const programStarted = new Promise(resolve => { markProgramStarted = resolve; });
  const staleProgramToken = activeToken;
  const staleProgram = runProgram(
    'cafe24',
    () => {
      markProgramStarted();
      return new Promise(resolve => { resolveProgram = resolve; });
    },
    {
      started: { ok: true, recoveryScope: { productKey: 'product-a' } },
      operationToken: staleProgramToken,
    },
  );
  await programStarted;
  activeToken = Object.freeze({ ...staleProgramToken, revision: staleProgramToken.revision + 1 });
  resolveProgram({ running: true, message: 'late program response' });
  assert.equal(await staleProgram, false);
  assert.equal(programCommits.length, 0);
  assert.equal(downstreamTokens.length, 0);
  assert.equal(saveCount, 0);
  assert.equal(renderCount, 0);

  const successProgramToken = Object.freeze({ ...activeToken, revision: activeToken.revision + 1 });
  activeToken = successProgramToken;
  assert.deepEqual(await runProgram(
    'cafe24',
    async () => ({ running: true, message: 'program ready' }),
    {
      started: { ok: true, recoveryScope: { productKey: 'product-a' } },
      operationToken: successProgramToken,
    },
  ), { ok: true, label: 'DB 후보' });
  assert.equal(programCommits.length, 1);
  assert.equal(programCommits[0].phase, 'ready');
  assert.strictEqual(downstreamTokens[0], activeToken);
  assert.equal(saveCount, 1);
  assert.equal(renderCount, 1);

  let fetchImpl = null;
  const createOauthWorker = new Function(
    'factoryRuntimeRequireStore', 'factoryRuntimeStaleActionError', 'factoryCommitCafe24OAuthStatus',
    'saveLastWorkNow', 'render', 'factoryYieldToPaint', 'fetchCafe24OAuthStatus',
    'factoryRunDbCandidatesForSelection',
    `${oauthStatusWriter}; return factoryRefreshCafe24OAuthStatus;`,
  );
  const refreshOauth = createOauthWorker(
    () => store,
    staleError,
    (phase, mallId, payload, operationToken) => {
      oauthCommits.push({ phase, mallId, payload, operationToken });
      activeToken = Object.freeze({ ...operationToken, revision: operationToken.revision + 1 });
      return { result: { ok: phase === 'ready' } };
    },
    () => { saveCount += 1; },
    () => { renderCount += 1; },
    async () => {},
    mallId => fetchImpl(mallId),
    async options => {
      downstreamTokens.push(options.operationToken);
      return { ok: true, label: 'OAuth DB 후보' };
    },
  );

  let resolveStatus;
  let markFetchStarted;
  const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
  fetchImpl = mallId => {
    markFetchStarted(mallId);
    return new Promise(resolve => { resolveStatus = resolve; });
  };
  const staleOauthToken = activeToken;
  const staleOauth = refreshOauth({
    started: { ok: true, mallId: 'test-mall' },
    mallId: 'test-mall',
    operationToken: staleOauthToken,
    rerunCandidates: true,
  });
  assert.equal(await fetchStarted, 'test-mall');
  activeToken = Object.freeze({ ...staleOauthToken, revision: staleOauthToken.revision + 1 });
  resolveStatus({ state: 'ready', mallId: 'test-mall' });
  assert.equal(await staleOauth, null);
  assert.equal(oauthCommits.length, 0);

  const mismatchOauthToken = Object.freeze({ ...activeToken, revision: activeToken.revision + 1 });
  activeToken = mismatchOauthToken;
  fetchImpl = async () => ({ state: 'ready', mallId: 'other-mall' });
  assert.equal(await refreshOauth({
    started: { ok: true, mallId: 'test-mall' },
    mallId: 'test-mall',
    operationToken: mismatchOauthToken,
  }), null);
  assert.equal(oauthCommits.length, 0);

  const successOauthToken = Object.freeze({ ...activeToken, revision: activeToken.revision + 1 });
  activeToken = successOauthToken;
  fetchImpl = async () => ({ state: 'ready', mallId: 'test-mall', message: 'connected' });
  assert.deepEqual(await refreshOauth({
    started: { ok: true, mallId: 'test-mall' },
    mallId: 'test-mall',
    operationToken: successOauthToken,
    rerunCandidates: true,
  }), { ok: true, label: 'OAuth DB 후보' });
  assert.equal(oauthCommits.length, 1);
  assert.equal(oauthCommits[0].phase, 'ready');
  assert.strictEqual(downstreamTokens.at(-1), activeToken);
  assert.equal(saveCount, 2);
  assert.equal(renderCount, 2);
});

test('factory store draft transaction is authority-first, atomic, fenced, and cannot leak its draft', async () => {
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'draft');
  const authorityChecks = [];
  const store = createFactoryStore({
    initialSnapshot: initialSnapshot(),
    workspaceId: 'workspace-a',
    revision: 4,
    assertMutable: context => { authorityChecks.push(`${context.owner}:${context.revision}`); },
  });

  let leakedDraft;
  const receipt = store.updateDraft(draft => {
    leakedDraft = draft;
    draft.nested.count = 2;
    return { count: draft.nested.count };
  }, { owner: 'factory', expectedRevision: 4 });

  assert.deepEqual(receipt.result, { count: 2 });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.result), true);
  assert.equal(receipt.snapshot.factory.nested.count, 2);
  assert.equal(store.getOperationToken().revision, 5);
  assert.throws(() => leakedDraft.nested, /revoked|draft|transaction/i);

  const beforeFailure = store.getSnapshot();
  assert.throws(() => store.updateDraft(draft => {
    draft.nested.count = 99;
    throw new Error('ROLLBACK');
  }, { owner: 'factory', expectedRevision: 5 }), /ROLLBACK/);
  assert.strictEqual(store.getSnapshot(), beforeFailure);
  assert.equal(store.getOperationToken().revision, 5);

  assert.throws(
    () => store.updateDraft(() => null, { owner: 'factory', expectedRevision: 4 }),
    /STALE|revision/i,
  );
  assert.deepEqual(authorityChecks, ['factory:4', 'factory:4', 'factory:5', 'factory:5']);

  let release;
  let asyncDraft;
  const pending = store.updateDraft(async draft => {
    asyncDraft = draft;
    draft.nested.count = 7;
    await new Promise(resolve => { release = resolve; });
    return draft.nested;
  }, { owner: 'factory', expectedRevision: 5 });
  store.update(
    slice => ({ ...slice, nested: { count: 3 } }),
    { owner: 'factory', expectedRevision: 5 },
  );
  release();
  await assert.rejects(pending, /STALE|revision/i);
  assert.equal(store.getSnapshot().factory.nested.count, 3);
  assert.equal(store.getOperationToken().revision, 6);
  assert.throws(() => asyncDraft.nested, /revoked|draft|transaction/i);
});

test('factory store operation leases reject same-key re-entry and cancel privately on switch or dispose', async () => {
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'operation-leases');
  const createStore = workspaceId => createFactoryStore({
    initialSnapshot: initialSnapshot(),
    workspaceId,
  });
  const store = createStore('workspace-lease-a');
  const token = store.getOperationToken();
  const first = store.acquireOperationLease('factory/automation:goal-run', token);
  const duplicate = store.acquireOperationLease('factory/automation:goal-run', token);
  const independent = store.acquireOperationLease('factory/assets:stage-run', token);

  assert.equal(first.acquired, true);
  assert.equal(duplicate.acquired, false);
  assert.equal(independent.acquired, true);
  assert.equal(first.signal.aborted, false);
  assert.equal(independent.signal.aborted, false);
  assert.equal(duplicate.release(), false);
  assert.equal(first.release(), true);
  assert.equal(first.release(), false);

  const reacquired = store.acquireOperationLease('factory/automation:goal-run', token);
  assert.equal(reacquired.acquired, true);
  store.switchWorkspace('workspace-lease-b', { snapshot: initialSnapshot(), revision: 0 });
  assert.equal(reacquired.signal.aborted, true);
  assert.equal(independent.signal.aborted, true);
  assert.equal(reacquired.release(), false);
  assert.throws(
    () => store.acquireOperationLease('factory/automation:goal-run', token),
    /STALE_FACTORY_STORE_OPERATION/,
  );

  const disposeStore = createStore('workspace-lease-dispose');
  const disposeLease = disposeStore.acquireOperationLease(
    'factory/automation:goal-run',
    disposeStore.getOperationToken(),
  );
  disposeStore.dispose();
  assert.equal(disposeLease.signal.aborted, true);
  assert.equal(disposeLease.release(), false);
});

test('declared command policies reject cross-owner diffs and split mixed-owner composition atomically', async () => {
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'command-policy');
  const checks = [];
  const snapshot = initialSnapshot();
  snapshot.factory = {
    product: { productName: 'before' },
    stages: { hero: { targetCount: 1 } },
    automation: { activeTab: 'start' },
  };
  const store = createFactoryStore({
    initialSnapshot: snapshot,
    workspaceId: 'workspace-policy',
    assertMutable: context => checks.push(`${context.owner}:${context.revision}`),
    commandPolicies: {
      'factory/db:set-name': {
        coordinator: 'product-db',
        targetPath: 'factory',
        parts: [{ owner: 'product-db', paths: ['product'] }],
      },
      'factory/start:compose-db-assets': {
        coordinator: 'factory',
        targetPath: 'factory',
        parts: [
          { owner: 'product-db', paths: ['product'] },
          { owner: 'factory-assets', paths: ['stages'] },
        ],
      },
    },
  });

  const dbReceipt = store.updateDraft(draft => {
    draft.product.productName = 'database-owned';
    return 'database-owned';
  }, { owner: 'product-db', expectedRevision: 0 }, 'factory/db:set-name');
  assert.equal(dbReceipt.snapshot.factory.product.productName, 'database-owned');
  assert.deepEqual(dbReceipt.assignments.map(item => item.owner), ['product-db']);

  const beforeRejected = store.getSnapshot();
  assert.throws(() => store.updateDraft(draft => {
    draft.product.productName = 'must-roll-back';
    draft.stages.hero.targetCount = 2;
  }, { owner: 'product-db', expectedRevision: 1 }, 'factory/db:set-name'), /PATH_REJECTED|owner/i);
  assert.strictEqual(store.getSnapshot(), beforeRejected);
  assert.equal(store.getOperationToken().revision, 1);

  const mixed = store.updateDraft(draft => {
    draft.product.productName = 'composed';
    draft.stages.hero.targetCount = 4;
    return { completed: true };
  }, { owner: 'factory', expectedRevision: 1 }, 'factory/start:compose-db-assets');
  assert.equal(mixed.snapshot.factory.product.productName, 'composed');
  assert.equal(mixed.snapshot.factory.stages.hero.targetCount, 4);
  assert.deepEqual([...new Set(mixed.assignments.map(item => item.owner))].sort(), ['factory-assets', 'product-db']);
  assert.equal(mixed.snapshot.factory.automation.activeTab, 'start');

  const beforeUndeclared = store.getSnapshot();
  assert.throws(() => store.updateDraft(draft => {
    draft.automation.activeTab = 'publish';
  }, { owner: 'factory', expectedRevision: 2 }, 'factory/start:compose-db-assets'), /PATH_REJECTED|owner/i);
  assert.strictEqual(store.getSnapshot(), beforeUndeclared);
  assert.throws(
    () => store.updateDraft(() => null, { owner: 'factory', expectedRevision: 2 }, 'factory/unknown'),
    /undeclared/i,
  );
  assert.equal(checks.includes('product-db:0'), true);
  assert.equal(checks.includes('factory-assets:1'), true);

  const core = source('src/app-core-03.js');
  const createRuntimePolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  const runtimeSnapshot = initialSnapshot();
  runtimeSnapshot.factory = {
    product: {},
    automation: { startRunCounts: { competitors: 0, cuts: 4 } },
    goalRun: {},
    stages: { hero: {}, size: {}, cuts: {}, options: {}, db: {} },
    assets: [],
    previousAssets: [],
    detailPlacement: {},
    archive: {},
    logs: [],
    logStageId: '',
    activeStage: '',
    uiPanels: {},
  };
  const runtimeStore = createFactoryStore({
    initialSnapshot: runtimeSnapshot,
    workspaceId: 'workspace-runtime-policy',
    commandPolicies: createRuntimePolicies(),
  });
  const runtimePolicies = createRuntimePolicies();
  for (const command of [
    'factory/cafe24:load-db-input-snapshot',
    'factory/cafe24:delete-db-input-snapshot',
    'factory/cafe24:update-image-draft',
  ]) {
    const policy = runtimePolicies[command];
    assert.equal(policy.coordinator, 'cafe24');
    assert.equal(policy.targetPath, 'factory');
    assert.deepEqual(policy.parts.map(part => ({ owner: part.owner, paths: [...part.paths] })), [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'factory', paths: ['logs', 'logStageId'] },
    ]);
    const declaredPaths = policy.parts.flatMap(part => part.paths);
    assert.equal(new Set(declaredPaths).size, declaredPaths.length, `${command} must not overlap declared paths`);
  }
  assert.deepEqual(runtimePolicies['factory/assets:confirmFactoryAssetUse'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'stages'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:markFactoryAssetImageLoadFailed'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'stages.db.status', 'stages.db.message'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:goFactoryNextStage'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['stages'] },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:importFactoryImageCutPrompts'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['stages'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:sendFactoryAssetToStage'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['stages'] },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:toggleFactoryAssetUse'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'stages'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:placeFactoryAsset'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'detailPlacement'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/optionsorter:ensureArchiveStageRunId'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{
      owner: 'factory-assets',
      paths: [
        'archive.stageRunIds',
        'stages.options.currentRunId',
        'stages.options.latestGenerationRunId',
      ],
    }],
  });
  assert.deepEqual(runtimePolicies['factory/optionsorter:archiveGeneratedResult'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'archive', 'stages.options'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:touchImageStageRun'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{ owner: 'factory-assets', paths: ['stages.hero', 'stages.size', 'stages.cuts'] }],
  });
  assert.deepEqual(runtimePolicies['factory/assets:markImageStageTimeout'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{ owner: 'factory-assets', paths: ['stages.hero', 'stages.size', 'stages.cuts'] }],
  });
  assert.deepEqual(runtimePolicies['factory/assets:clearRestoredImageGenerationRuntime'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['stages.hero', 'stages.size', 'stages.cuts'] },
      {
        owner: 'factory',
        paths: [
          'goalRun.running', 'goalRun.stopRequested',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
          'logs', 'logStageId',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/archive:completeWorkfileBootstrap'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{ owner: 'factory-assets', paths: ['archive.stageRunIds', 'archive.localStatus', 'stages'] }],
  });
  assert.deepEqual(runtimePolicies['factory/archive:setPreviewCopyStatus'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['archive.localStatus'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/archive:restoreDirectoryHandle'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{ owner: 'factory-assets', paths: ['archive.folderName'] }],
  });
  assert.deepEqual(runtimePolicies['factory/archive:chooseDirectory'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['archive.folderName', 'archive.status'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/archive:setSessionDirectory'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{
      owner: 'factory-assets',
      paths: ['archive.folderName', 'archive.sessionFolderName', 'archive.status'],
    }],
  });
  assert.deepEqual(runtimePolicies['factory/assets:archiveFactoryAsset'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      {
        owner: 'factory-assets',
        paths: ['assets', 'archive', 'runtimeAssetPrunedAt', 'runtimeAssetPrunedCount'],
      },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:restoreCutStageRunIdentity'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{ owner: 'factory-assets', paths: ['stages.hero', 'stages.size', 'stages.cuts'] }],
  });
  assert.deepEqual(runtimePolicies['factory/assets:importImageCutResults'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'previousAssets', 'stages'] },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/assets:forceImportFreshCutResults'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'previousAssets', 'stages'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:toggleUiPanel'], {
    coordinator: 'factory',
    targetPath: 'factory',
    parts: [{ owner: 'factory', paths: ['uiPanels'] }],
  });
  assert.deepEqual(runtimePolicies['factory/db:setCafe24AdvancedPanelOpen'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [{ owner: 'product-db', paths: ['product.cafe24AdvancedOpen'] }],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:setCafe24OAuthAutoRefreshStatus'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product.cafe24OAuthStatus'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:clearForeignCompetitorRunCount'], {
    coordinator: 'factory',
    targetPath: 'factory',
    parts: [{ owner: 'factory', paths: ['automation.startRunCounts.competitors'] }],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:log'], {
    coordinator: 'factory',
    targetPath: 'factory',
    parts: [
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
      { owner: 'factory-assets', paths: ['stages.db.status', 'stages.db.message'] },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:setStageStatus'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['stages'] },
      { owner: 'factory', paths: ['activeStage', 'logStageId'] },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:rememberPreviousAsset'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [{ owner: 'factory-assets', paths: ['previousAssets'] }],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:registerAsset'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'stages', 'previousAssets'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:completeRegisteredAssetArchive'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'factory-assets', paths: ['assets', 'archive'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:updateFromInputs'], {
    coordinator: 'factory',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'product-db', paths: ['automation.dbSearchQuery'] },
      { owner: 'cafe24', paths: ['openMarketSync'] },
      { owner: 'factory-assets', paths: ['stages'] },
      { owner: 'factory', paths: ['goalRun.targets', 'goalRun.maxLoops', 'goalRun.mode'] },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:apply-product-to-app'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [{ owner: 'product-db', paths: ['product'] }],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:apply-latest-to-analysis'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'factory-assets', paths: ['stages.db'] },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/runtime:sync-current-state'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'factory-assets', paths: ['stages', 'assets', 'previousAssets', 'detailPlacement'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/cafe24:update-form-drafts'], {
    coordinator: 'cafe24',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'product-db', paths: ['automation.fieldReview'] },
      { owner: 'factory', paths: ['logs', 'logStageId'] },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/cafe24:rerank-candidates'], {
    coordinator: 'cafe24',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'factory-assets', paths: ['stages'] },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/db:schedule-size-cut-review'], {
    coordinator: 'factory-assets',
    targetPath: 'factory',
    parts: [
      {
        owner: 'factory-assets',
        paths: [
          'automation.lastAutoSizeRunKey', 'automation.sizeImageDbConfirmedKey',
          'automation.sizeAutoRunRunning', 'stages',
        ],
      },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/db:add-custom-field'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'factory-assets', paths: ['stages.db.status', 'stages.db.message'] },
      {
        owner: 'factory',
        paths: [
          'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/db:apply-final-db'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'factory-assets', paths: ['stages.db'] },
      {
        owner: 'factory',
        paths: [
          'activeStage', 'logs', 'logStageId',
          'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
        ],
      },
    ],
  });
  assert.deepEqual(runtimePolicies['factory/db:applyWizardSearchQuery'], {
    coordinator: 'product-db',
    targetPath: 'factory',
    parts: [
      { owner: 'product-db', paths: ['product'] },
      { owner: 'product-db', paths: ['automation.dbSearchQuery'] },
      {
        owner: 'factory',
        paths: [
          'automation.activeTab', 'automation.activeTaskId',
          'automation.lastWizardActionAt', 'automation.updatedAt',
        ],
      },
    ],
  });
  for (const command of ['factory/db:save-field-preset', 'factory/db:apply-field-preset']) {
    assert.deepEqual(runtimePolicies[command], {
      coordinator: 'product-db',
      targetPath: 'factory',
      parts: [
        { owner: 'product-db', paths: ['product'] },
        { owner: 'factory-assets', paths: ['stages.db.status', 'stages.db.message'] },
        {
          owner: 'factory',
          paths: [
            'logs', 'logStageId',
            'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
          ],
        },
      ],
    });
  }
  runtimeStore.updateDraft(draft => {
    draft.product.productName = 'identity-owned';
    draft.automation.dbSearchQuery = 'identity-owned';
  }, { owner: 'product-db', expectedRevision: 0 }, 'factory/runtime:setCurrentProductIdentity');
  runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'visual-1' });
    draft.stages.hero.status = 'done';
    draft.logs.push({ message: 'visual-complete' });
    draft.goalRun.status = 'done';
  }, { owner: 'factory-assets', expectedRevision: 1 }, 'factory/runtime:completeVisualValidation');
  runtimeStore.updateDraft(draft => {
    draft.product.imageBase64 = 'QUJD';
    draft.assets.push({ id: 'image-sync' });
    draft.automation.currentRunId = 'run-1';
    draft.goalRun.currentRunId = 'run-1';
  }, { owner: 'factory-assets', expectedRevision: 2 }, 'factory/runtime:syncProductImageAcrossWorkspaces');
  runtimeStore.updateDraft(draft => {
    draft.automation.sizeFieldDrafts = { width_mm: { value: '120' } };
    draft.automation.updatedAt = 10;
  }, { owner: 'product-db', expectedRevision: 3 }, 'factory/db:setSizeManualDraft');
  runtimeStore.updateDraft(draft => {
    draft.product.finalDb = { width_mm: '120' };
    draft.automation.sizeFieldDrafts = {};
    draft.automation.updatedAt = 11;
  }, { owner: 'product-db', expectedRevision: 4 }, 'factory/db:commitSizeManualDraft');
  runtimeStore.updateDraft(draft => {
    draft.product.dbInputSnapshots = [{ id: 'snapshot-1' }];
    draft.logs = [{ message: 'snapshot-loaded' }];
    draft.logStageId = 'db';
  }, { owner: 'cafe24', expectedRevision: 5 }, 'factory/cafe24:load-db-input-snapshot');
  runtimeStore.updateDraft(draft => {
    draft.product.dbInputSnapshots = [];
    draft.logs = [{ message: 'snapshot-deleted' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'cafe24', expectedRevision: 6 }, 'factory/cafe24:delete-db-input-snapshot');
  runtimeStore.updateDraft(draft => {
    delete draft.automation.startRunCounts.competitors;
  }, { owner: 'factory', expectedRevision: 7 }, 'factory/runtime:clearForeignCompetitorRunCount');
  runtimeStore.updateDraft(draft => {
    draft.logs = [{ message: 'owned-log' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '후보 선택 대기';
    draft.goalRun.progress = 90;
    draft.goalRun.failureReason = '확인 필요';
    draft.stages.db.status = 'review';
    draft.stages.db.message = '후보 선택 대기';
  }, { owner: 'factory', expectedRevision: 8 }, 'factory/runtime:log');
  runtimeStore.updateDraft(draft => {
    draft.stages.size = { status: 'running' };
    draft.activeStage = 'size';
    draft.logStageId = 'size';
  }, { owner: 'factory-assets', expectedRevision: 9 }, 'factory/runtime:setStageStatus');
  runtimeStore.updateDraft(draft => {
    draft.previousAssets = [{ id: 'previous-1' }];
  }, { owner: 'factory-assets', expectedRevision: 10 }, 'factory/runtime:rememberPreviousAsset');
  const beforeImageDraftToken = runtimeStore.getOperationToken();
  runtimeStore.updateDraft(draft => {
    draft.product.cafe24ImageDraft = { main: { url: 'local://main.jpg' } };
    draft.logs = [{ message: 'image-draft-updated' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'cafe24', expectedRevision: 11 }, 'factory/cafe24:update-image-draft');
  const afterImageDraftToken = runtimeStore.getOperationToken();
  assert.equal(runtimeStore.isOperationCurrent(beforeImageDraftToken), false);
  assert.equal(runtimeStore.isOperationCurrent(afterImageDraftToken), true);
  assert.equal(afterImageDraftToken.revision, beforeImageDraftToken.revision + 1);
  runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'registered-1', stageId: 'hero' });
    draft.stages.hero.selectedAssetIds = ['registered-1'];
    draft.previousAssets.push({ id: 'isolated-1' });
    draft.logs = [{ message: 'asset-registered' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '자산 등록';
    draft.goalRun.progress = 91;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 12 }, 'factory/runtime:registerAsset');
  runtimeStore.updateDraft(draft => {
    draft.product.productName = '입력 반영 상품';
    draft.product.naturalHint = '입력 반영 힌트';
    draft.automation.dbSearchQuery = '입력 반영 상품';
    draft.openMarketSync = { ...(draft.openMarketSync || {}), marketPlusUrl: 'https://market.test' };
    draft.stages.hero.targetCount = 3;
    draft.goalRun.targets = { hero: 3 };
    draft.goalRun.maxLoops = 4;
    draft.goalRun.mode = 'review';
  }, { owner: 'factory', expectedRevision: 13 }, 'factory/runtime:updateFromInputs');
  runtimeStore.updateDraft(draft => {
    draft.product.icons = [{ code: 'new' }];
    draft.product.optionExtras = { use: true };
    draft.automation.fieldReview = { icons: { status: 'draft' } };
    draft.logs = [{ message: 'form-drafts-updated' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'cafe24', expectedRevision: 14 }, 'factory/cafe24:update-form-drafts');
  const beforeArchiveCompletionToken = runtimeStore.getOperationToken();
  runtimeStore.updateDraft(draft => {
    const asset = draft.assets.find(item => item.id === 'registered-1');
    asset.localArchive = { saving: false, saved: true, archiveId: 'archive-1' };
    asset.archiveId = 'archive-1';
    asset.archived = true;
    draft.archive.localStatus = '자동 로컬 보관 완료';
    draft.archive.saveLog = ['registered-1 로컬 보관'];
    draft.logs = [{ message: 'asset-archive-complete' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '자산 보관 완료';
    draft.goalRun.progress = 92;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 15 }, 'factory/runtime:completeRegisteredAssetArchive');
  const afterArchiveCompletionToken = runtimeStore.getOperationToken();
  assert.equal(runtimeStore.isOperationCurrent(beforeArchiveCompletionToken), false);
  assert.equal(runtimeStore.isOperationCurrent(afterArchiveCompletionToken), true);
  assert.equal(afterArchiveCompletionToken.revision, beforeArchiveCompletionToken.revision + 1);
  runtimeStore.updateDraft(draft => {
    draft.product.dbCustomFields = [{ id: 'custom-material', enabled: true }];
    draft.product.finalDb = { ...draft.product.finalDb, material: 'steel' };
    draft.stages.db.status = 'review';
    draft.stages.db.message = '커스텀 필드 추가';
    draft.logs = [{ message: 'custom-field-added' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'DB 필드 편집';
    draft.goalRun.progress = 93;
    draft.goalRun.failureReason = '';
  }, { owner: 'product-db', expectedRevision: 16 }, 'factory/db:add-custom-field');
  runtimeStore.updateDraft(draft => {
    draft.product.confirmedDb = { material: 'steel' };
    draft.product.dbLocked = true;
    draft.stages.db = { ...draft.stages.db, status: 'done', message: '완성 DB 필드 반영 완료' };
    draft.activeStage = 'db';
    draft.logs = [{ message: 'final-db-applied' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'DB 확정';
    draft.goalRun.progress = 94;
    draft.goalRun.failureReason = '';
  }, { owner: 'product-db', expectedRevision: 17 }, 'factory/db:apply-final-db');
  runtimeStore.updateDraft(draft => {
    draft.product.dbFieldPresetId = 'preset-1';
    draft.stages.db.status = 'done';
    draft.stages.db.message = '프리셋 저장';
    draft.logs = [{ message: 'field-preset-saved' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'DB 프리셋 저장';
    draft.goalRun.progress = 95;
    draft.goalRun.failureReason = '';
  }, { owner: 'product-db', expectedRevision: 18 }, 'factory/db:save-field-preset');
  runtimeStore.updateDraft(draft => {
    draft.product.dbFieldSettings = { material: { enabled: true } };
    draft.stages.db.status = 'done';
    draft.stages.db.message = '프리셋 적용';
    draft.logs = [{ message: 'field-preset-applied' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'DB 프리셋 적용';
    draft.goalRun.progress = 96;
    draft.goalRun.failureReason = '';
  }, { owner: 'product-db', expectedRevision: 19 }, 'factory/db:apply-field-preset');
  runtimeStore.updateDraft(draft => {
    draft.product.imageMime = 'image/webp';
    draft.product.imagePreview = 'data:image/webp;base64,QUJD';
  }, { owner: 'product-db', expectedRevision: 20 }, 'factory/runtime:apply-product-to-app');
  runtimeStore.updateDraft(draft => {
    draft.product.analysis = { product_name: '입력 반영 상품' };
    draft.product.lastSyncedAt = 21;
    draft.stages.db = { ...draft.stages.db, status: 'done', message: 'AI 분석 반영 완료' };
    draft.activeStage = 'db';
    draft.logs = [{ message: 'latest-analysis-applied' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'AI 분석 반영';
    draft.goalRun.progress = 97;
    draft.goalRun.failureReason = '';
  }, { owner: 'product-db', expectedRevision: 21 }, 'factory/runtime:apply-latest-to-analysis');
  runtimeStore.updateDraft(draft => {
    draft.product.competitors = [{ id: 'competitor-1' }];
    draft.assets.push({ id: 'synced-asset-1', stageId: 'cuts' });
    draft.previousAssets.push({ id: 'synced-previous-1' });
    draft.detailPlacement = { hero: ['synced-asset-1'] };
    draft.stages.cuts = { status: 'review' };
    draft.logs = [{ message: 'current-state-synced' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '현재 상태 동기화';
    draft.goalRun.progress = 98;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 22 }, 'factory/runtime:sync-current-state');
  const beforeRerankToken = runtimeStore.getOperationToken();
  runtimeStore.updateDraft(draft => {
    draft.product.pendingCafe24Candidates = [{ product_no: 24, score: 99 }];
    draft.product.cafe24RerankRunning = false;
    draft.stages.db = { ...draft.stages.db, status: 'review', message: 'Cafe24 후보 선택 대기' };
    draft.activeStage = 'db';
    draft.logs = [{ message: 'candidates-reranked' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'Cafe24 후보 재점수';
    draft.goalRun.progress = 99;
    draft.goalRun.failureReason = '';
  }, { owner: 'cafe24', expectedRevision: 23 }, 'factory/cafe24:rerank-candidates');
  runtimeStore.updateDraft(draft => {
    draft.automation.lastAutoSizeRunKey = '';
    draft.automation.sizeImageDbConfirmedKey = 'size-confirmed-1';
    draft.automation.sizeAutoRunRunning = false;
    draft.stages.size = { ...draft.stages.size, status: 'blocked', message: '명시적 생성 대기' };
    draft.activeStage = 'size';
    draft.logs = [{ message: 'size-review-scheduled' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '사이즈 확인 완료';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 24 }, 'factory/db:schedule-size-cut-review');
  assert.equal(runtimeStore.isOperationCurrent(beforeRerankToken), false);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.cafe24RerankRunning = true;
  }, { owner: 'cafe24', expectedRevision: beforeRerankToken.revision }, 'factory/cafe24:rerank-candidates'), /STALE/i);
  runtimeStore.updateDraft(draft => {
    draft.product.productName = '마법사 재검색 상품';
    draft.product.productKey = '마법사재검색상품';
    draft.automation.dbSearchQuery = '마법사 재검색 상품';
    draft.automation.activeTab = 'db';
    draft.automation.activeTaskId = 'db-select';
    draft.automation.lastWizardActionAt = 26;
    draft.automation.updatedAt = 26;
  }, { owner: 'product-db', expectedRevision: 25 }, 'factory/db:applyWizardSearchQuery');
  const runtimeCommitted = runtimeStore.getSnapshot().factory;
  assert.equal(runtimeCommitted.product.productName, '마법사 재검색 상품');
  assert.equal(runtimeCommitted.stages.hero.status, 'done');
  assert.equal(runtimeCommitted.product.imageBase64, 'QUJD');
  assert.equal(runtimeCommitted.product.finalDb.width_mm, '120');
  assert.deepEqual(runtimeCommitted.automation.sizeFieldDrafts, {});
  assert.deepEqual(runtimeCommitted.product.dbInputSnapshots, []);
  assert.equal(runtimeCommitted.logs[0].message, 'size-review-scheduled');
  assert.equal(runtimeCommitted.automation.startRunCounts.competitors, undefined);
  assert.equal(runtimeCommitted.automation.startRunCounts.cuts, 4);
  assert.equal(runtimeCommitted.goalRun.currentStage, '사이즈 확인 완료');
  assert.equal(runtimeCommitted.stages.db.status, 'review');
  assert.equal(runtimeCommitted.stages.size.status, 'blocked');
  assert.equal(runtimeCommitted.previousAssets[0].id, 'previous-1');
  assert.equal(runtimeCommitted.product.cafe24ImageDraft.main.url, 'local://main.jpg');
  assert.equal(runtimeCommitted.product.productName, '마법사 재검색 상품');
  assert.equal(runtimeCommitted.automation.dbSearchQuery, '마법사 재검색 상품');
  assert.equal(runtimeCommitted.openMarketSync.marketPlusUrl, 'https://market.test');
  assert.equal(runtimeCommitted.product.icons[0].code, 'new');
  assert.equal(runtimeCommitted.automation.fieldReview.icons.status, 'draft');
  assert.equal(runtimeCommitted.assets.find(item => item.id === 'registered-1').archiveId, 'archive-1');
  assert.equal(runtimeCommitted.archive.localStatus, '자동 로컬 보관 완료');
  assert.equal(runtimeCommitted.product.dbCustomFields[0].id, 'custom-material');
  assert.equal(runtimeCommitted.product.confirmedDb.material, 'steel');
  assert.equal(runtimeCommitted.product.dbFieldPresetId, 'preset-1');
  assert.equal(runtimeCommitted.product.dbFieldSettings.material.enabled, true);
  assert.equal(runtimeCommitted.product.imageMime, 'image/webp');
  assert.equal(runtimeCommitted.product.analysis.product_name, '입력 반영 상품');
  assert.equal(runtimeCommitted.product.competitors[0].id, 'competitor-1');
  assert.equal(runtimeCommitted.assets.some(item => item.id === 'synced-asset-1'), true);
  assert.equal(runtimeCommitted.detailPlacement.hero[0], 'synced-asset-1');
  assert.equal(runtimeCommitted.product.pendingCafe24Candidates[0].product_no, 24);
  assert.equal(runtimeCommitted.automation.sizeImageDbConfirmedKey, 'size-confirmed-1');
  assert.equal(runtimeCommitted.product.productName, '마법사 재검색 상품');
  assert.equal(runtimeCommitted.automation.dbSearchQuery, '마법사 재검색 상품');
  runtimeStore.updateDraft(draft => {
    const asset = draft.assets.find(item => item.id === 'registered-1');
    asset.used = true;
    asset.rejected = false;
    draft.stages.hero.selectedAssetIds = ['registered-1'];
    draft.logs = [{ message: 'asset-confirmed' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 26 }, 'factory/assets:confirmFactoryAssetUse');
  runtimeStore.updateDraft(draft => {
    const asset = draft.assets.find(item => item.id === 'registered-1');
    asset.metadata = { ...(asset.metadata || {}), imageLoadFailed: true };
    asset.imageLoadFailed = true;
    asset.imageLoadFailedSrc = 'local://missing.jpg';
    asset.used = false;
    draft.logs = [{ message: 'asset-image-failed', activeDiagnostic: true }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 27 }, 'factory/assets:markFactoryAssetImageLoadFailed');
  runtimeStore.updateDraft(draft => {
    draft.stages.cuts = { ...draft.stages.cuts, inputAssetIds: ['registered-1'] };
    draft.activeStage = 'cuts';
    draft.logs = [{ message: 'asset-next-stage' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 28 }, 'factory/assets:goFactoryNextStage');
  runtimeStore.updateDraft(draft => {
    draft.stages.cuts = {
      ...draft.stages.cuts,
      prompt: '현재 제품 이미지컷 프롬프트',
      targetCount: 1,
      status: 'idle',
      message: '프롬프트 1개 가져오기 완료',
    };
    draft.logs = [{ message: 'cut-prompts-imported' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 29 }, 'factory/assets:importFactoryImageCutPrompts');
  runtimeStore.updateDraft(draft => {
    draft.stages.size = { ...draft.stages.size, inputAssetIds: ['registered-1'] };
    draft.activeStage = 'size';
    draft.logs = [{ message: 'asset-sent-to-stage' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '자산 전달 완료';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 30 }, 'factory/assets:sendFactoryAssetToStage');
  runtimeStore.updateDraft(draft => {
    const asset = draft.assets.find(item => item.id === 'registered-1');
    asset.used = true;
    asset.rejected = false;
    draft.stages.hero.selectedAssetIds = ['registered-1'];
    draft.logs = [{ message: 'asset-use-toggled' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 31 }, 'factory/assets:toggleFactoryAssetUse');
  runtimeStore.updateDraft(draft => {
    const asset = draft.assets.find(item => item.id === 'registered-1');
    asset.placedSectionId = 'header';
    asset.used = true;
    draft.detailPlacement['registered-1'] = 'header';
    draft.logs = [{ message: 'asset-placed' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 32 }, 'factory/assets:placeFactoryAsset');
  const assetUiCommitted = runtimeStore.getSnapshot().factory;
  assert.equal(assetUiCommitted.assets.find(item => item.id === 'registered-1').imageLoadFailed, true);
  assert.deepEqual(assetUiCommitted.stages.hero.selectedAssetIds, ['registered-1']);
  assert.deepEqual(assetUiCommitted.stages.cuts.inputAssetIds, ['registered-1']);
  assert.equal(assetUiCommitted.stages.cuts.prompt, '현재 제품 이미지컷 프롬프트');
  assert.equal(assetUiCommitted.stages.size.inputAssetIds[0], 'registered-1');
  assert.equal(assetUiCommitted.activeStage, 'size');
  assert.equal(assetUiCommitted.detailPlacement['registered-1'], 'header');
  assert.equal(assetUiCommitted.logs[0].message, 'asset-placed');
  runtimeStore.updateDraft(draft => {
    draft.archive.stageRunIds = { ...(draft.archive.stageRunIds || {}), options: 'options-run-1' };
    draft.stages.options.currentRunId = 'options-run-1';
    draft.stages.options.latestGenerationRunId = 'options-run-1';
  }, { owner: 'factory-assets', expectedRevision: 33 }, 'factory/optionsorter:ensureArchiveStageRunId');
  runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'option-archive-1', stageId: 'options', archiveId: 'archive-option-1' });
    draft.archive.localStatus = '옵션표 로컬 보관 완료';
    draft.stages.options.status = 'done';
    draft.stages.options.message = '옵션표 후보 연결 완료';
    draft.logs = [{ message: 'option-result-archived' }, ...draft.logs];
    draft.logStageId = 'options';
  }, { owner: 'factory-assets', expectedRevision: 34 }, 'factory/optionsorter:archiveGeneratedResult');
  runtimeStore.updateDraft(draft => {
    draft.stages.hero.currentRunId = 'hero-run-1';
    draft.stages.hero.latestGenerationRunId = 'hero-run-1';
    draft.stages.hero.status = 'running';
    draft.stages.hero.runHeartbeatAt = 35;
  }, { owner: 'factory-assets', expectedRevision: 35 }, 'factory/assets:touchImageStageRun');
  runtimeStore.updateDraft(draft => {
    draft.uiPanels.archive = true;
  }, { owner: 'factory', expectedRevision: 36 }, 'factory/runtime:toggleUiPanel');
  runtimeStore.updateDraft(draft => {
    draft.product.cafe24AdvancedOpen = { variants: true };
  }, { owner: 'product-db', expectedRevision: 37 }, 'factory/db:setCafe24AdvancedPanelOpen');
  runtimeStore.updateDraft(draft => {
    draft.product.cafe24OAuthStatus = { state: 'connected', mallId: 'test-mall' };
    draft.logs = [{ message: 'oauth-auto-refresh' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = 'OAuth 상태 확인';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'product-db', expectedRevision: 38 }, 'factory/runtime:setCafe24OAuthAutoRefreshStatus');
  assert.equal(runtimeStore.getSnapshot().factory.product.cafe24OAuthStatus.state, 'connected');
  runtimeStore.updateDraft(draft => {
    draft.stages.size.currentRunId = 'size-restored-run-1';
    draft.stages.size.latestGenerationRunId = 'size-restored-run-1';
    draft.stages.size.status = 'review';
  }, { owner: 'factory-assets', expectedRevision: 39 }, 'factory/assets:restoreCutStageRunIdentity');
  runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'imported-cut-1', stageId: 'cuts' });
    draft.previousAssets.push({ id: 'previous-cut-1', stageId: 'cuts' });
    draft.stages.cuts.status = 'done';
    draft.activeStage = 'cuts';
    draft.logs = [{ message: 'image-cut-imported' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '이미지컷 가져오기';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 40 }, 'factory/assets:importImageCutResults');
  runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forced-cut-1', stageId: 'cuts' });
    draft.previousAssets.push({ id: 'forced-previous-cut-1', stageId: 'cuts' });
    draft.stages.cuts.message = '현재 생성 결과 강제 연결 완료';
    draft.logs = [{ message: 'fresh-cut-forced' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '현재 이미지컷 연결';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 41 }, 'factory/assets:forceImportFreshCutResults');
  runtimeStore.updateDraft(draft => {
    draft.stages.size.status = 'error';
    draft.stages.size.message = '사이즈 생성 시간 초과';
    draft.stages.size.runHeartbeatAt = 42;
    draft.stages.size.updatedAt = 42;
  }, { owner: 'factory-assets', expectedRevision: 42 }, 'factory/assets:markImageStageTimeout');
  runtimeStore.updateDraft(draft => {
    draft.stages.cuts.status = 'idle';
    draft.stages.cuts.message = '복원된 진행 표시 정리';
    draft.goalRun.running = false;
    draft.goalRun.stopRequested = false;
    draft.goalRun.currentStage = '생성 대기';
    draft.goalRun.progress = 0;
    draft.goalRun.failureReason = '복원된 생성 상태 정리';
    draft.logs = [{ message: 'restored-generation-cleared' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'factory-assets', expectedRevision: 43 }, 'factory/assets:clearRestoredImageGenerationRuntime');
  runtimeStore.updateDraft(draft => {
    draft.archive.stageRunIds = { ...(draft.archive.stageRunIds || {}), cuts: 'cuts-bootstrap-run-1' };
    draft.archive.localStatus = '작업파일 로컬 복원 준비 완료';
    draft.stages.cuts.currentRunId = 'cuts-bootstrap-run-1';
    draft.stages.cuts.latestGenerationRunId = 'cuts-bootstrap-run-1';
  }, { owner: 'factory-assets', expectedRevision: 44 }, 'factory/archive:completeWorkfileBootstrap');
  runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = '보관 경로 복사 완료';
    draft.logs = [{ message: 'archive-path-copied' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '보관 경로 복사';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 45 }, 'factory/archive:setPreviewCopyStatus');
  runtimeStore.updateDraft(draft => {
    draft.archive.folderName = 'restored-archive-folder';
  }, { owner: 'factory-assets', expectedRevision: 46 }, 'factory/archive:restoreDirectoryHandle');
  runtimeStore.updateDraft(draft => {
    draft.archive.folderName = 'chosen-archive-folder';
    draft.archive.status = '저장 폴더 지정 완료';
    draft.logs = [{ message: 'archive-folder-chosen' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '보관 폴더 지정';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 47 }, 'factory/archive:chooseDirectory');
  runtimeStore.updateDraft(draft => {
    draft.archive.folderName = 'chosen-archive-folder';
    draft.archive.sessionFolderName = 'session-run-1';
    draft.archive.status = '세션 폴더 준비 완료';
  }, { owner: 'factory-assets', expectedRevision: 48 }, 'factory/archive:setSessionDirectory');
  runtimeStore.updateDraft(draft => {
    const asset = draft.assets.find(item => item.id === 'registered-1');
    asset.archived = true;
    asset.archivedAt = '2026-07-18T00:00:00.000Z';
    asset.metadata = { ...(asset.metadata || {}), filesystemArchiveWriteId: 'factory-fs-run-1' };
    draft.archive.lastSavedAt = asset.archivedAt;
    draft.archive.status = '자산 저장 완료';
    draft.logs = [{ message: 'filesystem-asset-archived' }, ...draft.logs];
    draft.logStageId = '';
    draft.goalRun.currentStage = '파일 보관 완료';
    draft.goalRun.progress = 100;
    draft.goalRun.failureReason = '';
  }, { owner: 'factory-assets', expectedRevision: 49 }, 'factory/assets:archiveFactoryAsset');
  runtimeStore.updateDraft(draft => {
    draft.automation.activeTab = 'db';
    draft.product.pendingDbCandidates = [{ id: 'db-candidate-1' }];
    draft.stages.db.status = 'review';
    draft.archive.localStatus = 'DB 후보 수집 완료';
    draft.logs = [{ message: 'db-candidates-ready' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'product-db', expectedRevision: 50 }, 'factory/db:runCandidatesForSelection');
  runtimeStore.updateDraft(draft => {
    draft.product.sinhwaDbProgramStatus = { state: 'starting' };
    draft.automation.candidateSearchProgress = { running: true, kind: 'start-sinhwa-db' };
    draft.logs = [{ message: 'candidate-program-starting' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'product-db', expectedRevision: 51 }, 'factory/db:setCandidateProgramState');
  runtimeStore.updateDraft(draft => {
    draft.product.cafe24OAuthStatus = { state: 'awaiting_user', mallId: 'test-mall' };
    draft.logs = [{ message: 'oauth-login-opened' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'product-db', expectedRevision: 52 }, 'factory/db:openCafe24OAuthLogin');
  runtimeStore.updateDraft(draft => {
    draft.product.cafe24OAuthStatus = { state: 'ready', mallId: 'test-mall' };
    draft.logs = [{ message: 'oauth-status-ready' }, ...draft.logs];
    draft.logStageId = '';
  }, { owner: 'product-db', expectedRevision: 53 }, 'factory/db:setCafe24OAuthStatus');
  runtimeStore.updateDraft(draft => {
    draft.product.competitors = [{ id: 'vm-candidate-1' }];
    draft.product.competitorSource = 'VM';
    draft.automation.activeTab = 'competitor';
    draft.uiPanels.materials = false;
    draft.stages.db.status = 'running';
  }, { owner: 'competitors', expectedRevision: 54 }, 'factory/competitor:runVmCandidatesForSelection');
  runtimeStore.updateDraft(draft => {
    draft.product.analysis = { product_name: 'analysis-product-1' };
    draft.goalRun.currentStage = '현재 이미지 AI 분석 완료';
    draft.goalRun.progress = 100;
    draft.stages.db.status = 'done';
    draft.logs = [{ message: 'image-analysis-ready' }, ...draft.logs];
  }, { owner: 'product-db', expectedRevision: 55 }, 'factory/db:runCurrentProductAnalysisOnly');
  runtimeStore.updateDraft(draft => {
    draft.goalRun.running = false;
    draft.goalRun.currentStage = '전체 자동 실행 완료';
    draft.goalRun.progress = 100;
    draft.logs = [{ message: 'auto-run-ready' }, ...draft.logs];
    draft.stages.hero.status = 'done';
  }, { owner: 'factory', expectedRevision: 56 }, 'factory/automation:runAuto');
  runtimeStore.updateDraft(draft => {
    draft.goalRun.running = false;
    draft.goalRun.currentStage = 'goal 루프 완료';
    draft.goalRun.progress = 100;
    draft.logs = [{ message: 'goal-loop-ready' }, ...draft.logs];
    draft.assets.push({ id: 'goal-loop-asset-1', stageId: 'hero' });
  }, { owner: 'factory', expectedRevision: 57 }, 'factory/automation:runGoalLoop');
  runtimeStore.updateDraft(draft => {
    draft.automation.activeTab = 'assets';
    draft.automation.activeTaskId = 'stage-size';
    draft.uiPanels.assets = true;
    draft.goalRun.currentStage = '사이즈 생성 완료';
    draft.stages.size.status = 'done';
    draft.logs = [{ message: 'stage-button-ready' }, ...draft.logs];
  }, { owner: 'factory', expectedRevision: 58 }, 'factory/assets:handleRunStageButton');
  runtimeStore.updateDraft(draft => {
    draft.goalRun.stopRequested = true;
    draft.goalRun.running = false;
    draft.goalRun.failureReason = '사용자가 중단하고 검수를 선택했습니다.';
    draft.logs = [{ message: 'goal-run-stopped' }, ...draft.logs];
  }, { owner: 'factory', expectedRevision: 59 }, 'factory/automation:stopGoalRun');
  const runtimeUiCommitted = runtimeStore.getSnapshot().factory;
  assert.equal(runtimeUiCommitted.archive.stageRunIds.options, 'options-run-1');
  assert.equal(runtimeUiCommitted.assets.some(item => item.id === 'option-archive-1'), true);
  assert.equal(runtimeUiCommitted.stages.hero.currentRunId, 'hero-run-1');
  assert.equal(runtimeUiCommitted.uiPanels.archive, true);
  assert.equal(runtimeUiCommitted.product.cafe24AdvancedOpen.variants, true);
  assert.equal(runtimeUiCommitted.product.cafe24OAuthStatus.state, 'ready');
  assert.equal(runtimeUiCommitted.stages.size.currentRunId, 'size-restored-run-1');
  assert.equal(runtimeUiCommitted.assets.some(item => item.id === 'imported-cut-1'), true);
  assert.equal(runtimeUiCommitted.assets.some(item => item.id === 'forced-cut-1'), true);
  assert.equal(runtimeUiCommitted.archive.sessionFolderName, 'session-run-1');
  assert.equal(runtimeUiCommitted.assets.find(item => item.id === 'registered-1').metadata.filesystemArchiveWriteId, 'factory-fs-run-1');
  assert.equal(runtimeUiCommitted.product.pendingDbCandidates[0].id, 'db-candidate-1');
  assert.equal(runtimeUiCommitted.automation.candidateSearchProgress.kind, 'start-sinhwa-db');
  assert.equal(runtimeUiCommitted.product.cafe24OAuthStatus.state, 'ready');
  assert.equal(runtimeUiCommitted.product.competitors[0].id, 'vm-candidate-1');
  assert.equal(runtimeUiCommitted.product.analysis.product_name, 'analysis-product-1');
  assert.equal(runtimeUiCommitted.assets.some(item => item.id === 'goal-loop-asset-1'), true);
  assert.equal(runtimeUiCommitted.automation.activeTaskId, 'stage-size');
  assert.equal(runtimeUiCommitted.goalRun.stopRequested, true);
  const beforeRuntimeReject = runtimeStore.getSnapshot();
  const rejectionRevision = runtimeStore.getOperationToken().revision;
  assert.equal(rejectionRevision, 60);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.competitorSource = 'stale-vm';
  }, { owner: 'competitors', expectedRevision: 54 }, 'factory/competitor:runVmCandidatesForSelection'), /STALE/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'competitors', expectedRevision: rejectionRevision }, 'factory/competitor:runVmCandidatesForSelection'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:runCurrentProductAnalysisOnly'), /PATH_REJECTED|owner/i);
  for (const command of [
    'factory/automation:runAuto',
    'factory/automation:runGoalLoop',
    'factory/assets:handleRunStageButton',
    'factory/automation:stopGoalRun',
  ]) {
    assert.throws(() => runtimeStore.updateDraft(draft => {
      draft.openMarketSync = { forbidden: command };
    }, { owner: 'factory', expectedRevision: rejectionRevision }, command), /PATH_REJECTED|owner/i);
  }
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-identity' });
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/runtime:setCurrentProductIdentity'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-cafe24-snapshot' });
  }, { owner: 'cafe24', expectedRevision: rejectionRevision }, 'factory/cafe24:load-db-input-snapshot'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.automation.startRunCounts.cuts = 0;
  }, { owner: 'factory', expectedRevision: rejectionRevision }, 'factory/runtime:clearForeignCompetitorRunCount'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.goalRun.running = true;
  }, { owner: 'factory', expectedRevision: rejectionRevision }, 'factory/runtime:log'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.previousAssets.push({ id: 'forbidden-from-stage-status' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/runtime:setStageStatus'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-previous-assets' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/runtime:rememberPreviousAsset'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.automation.imageDraftTouched = true;
  }, { owner: 'cafe24', expectedRevision: rejectionRevision }, 'factory/cafe24:update-image-draft'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/runtime:registerAsset'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-input-sync' });
  }, { owner: 'factory', expectedRevision: rejectionRevision }, 'factory/runtime:updateFromInputs'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'cafe24', expectedRevision: rejectionRevision }, 'factory/cafe24:update-form-drafts'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.previousAssets.push({ id: 'forbidden-from-archive-completion' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/runtime:completeRegisteredAssetArchive'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.automation.fieldReview = { forbidden: true };
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:add-custom-field'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-final-db';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:apply-final-db'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.hero.status = 'forbidden-from-preset-save';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:save-field-preset'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.activeStage = 'forbidden-from-preset-apply';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:apply-field-preset'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.hero.status = 'forbidden-from-product-to-app';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/runtime:apply-product-to-app'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-analysis-import';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/runtime:apply-latest-to-analysis'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/runtime:sync-current-state'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-rerank';
  }, { owner: 'cafe24', expectedRevision: rejectionRevision }, 'factory/cafe24:rerank-candidates'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.sizeReview = 'forbidden-from-size-review';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/db:schedule-size-cut-review'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-wizard-query' });
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:applyWizardSearchQuery'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-asset-confirm';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:confirmFactoryAssetUse'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.hero.status = 'forbidden-from-image-failure';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:markFactoryAssetImageLoadFailed'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-next-stage' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:goFactoryNextStage'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.activeStage = 'forbidden-from-prompt-import';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:importFactoryImageCutPrompts'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-send-to-stage' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:sendFactoryAssetToStage'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-toggle-use';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:toggleFactoryAssetUse'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.hero.status = 'forbidden-from-place-asset';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:placeFactoryAsset'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-ensure-archive-run' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/optionsorter:ensureArchiveStageRunId'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.productName = 'forbidden-from-option-archive';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/optionsorter:archiveGeneratedResult'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-image-stage-touch' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:touchImageStageRun'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-image-stage-timeout' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:markImageStageTimeout'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-restored-generation-cleanup';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:clearRestoredImageGenerationRuntime'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.productName = 'forbidden-from-workfile-bootstrap';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/archive:completeWorkfileBootstrap'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.hero.status = 'forbidden-from-preview-copy';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/archive:setPreviewCopyStatus'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.sessionFolderName = 'forbidden-from-restored-directory';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/archive:restoreDirectoryHandle'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.sessionFolderName = 'forbidden-from-directory-choice';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/archive:chooseDirectory'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-session-directory' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/archive:setSessionDirectory'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.productName = 'forbidden-from-filesystem-archive';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:archiveFactoryAsset'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.assets.push({ id: 'forbidden-from-restored-cut-stage' });
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:restoreCutStageRunIdentity'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.productName = 'forbidden-from-image-cut-import';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:importImageCutResults'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.archive.localStatus = 'forbidden-from-fresh-cut-import';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/assets:forceImportFreshCutResults'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.activeStage = 'forbidden-from-panel-toggle';
  }, { owner: 'factory', expectedRevision: rejectionRevision }, 'factory/runtime:toggleUiPanel'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.productName = 'forbidden-from-advanced-panel';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:setCafe24AdvancedPanelOpen'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.db.status = 'forbidden-from-oauth-refresh';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/runtime:setCafe24OAuthAutoRefreshStatus'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/source:ensureLockedInput'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/source:promoteStoredProductInput'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.product.productName = 'forbidden-from-input-archive-status';
  }, { owner: 'factory-assets', expectedRevision: rejectionRevision }, 'factory/source:setInputArchiveRestoreStatus'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.openMarketSync = { forbidden: true };
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:runCandidatesForSelection'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.db.status = 'forbidden-from-program-state';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:setCandidateProgramState'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.automation.activeTab = 'forbidden-from-oauth-login';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:openCafe24OAuthLogin'), /PATH_REJECTED|owner/i);
  assert.throws(() => runtimeStore.updateDraft(draft => {
    draft.stages.db.status = 'forbidden-from-oauth-status';
  }, { owner: 'product-db', expectedRevision: rejectionRevision }, 'factory/db:setCafe24OAuthStatus'), /PATH_REJECTED|owner/i);
  assert.strictEqual(runtimeStore.getSnapshot(), beforeRuntimeReject);
});

async function createB3CutsRuntimeHarness(label) {
  const core = source('src/app-core-03.js');
  const factoryCore = source('src/app-core-06.js');
  const createRuntimePolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', `b3-cuts-${label}`);
  const factoryValue = () => ({
    product: { productName: 'B3 컷 테스트 상품' },
    automation: {},
    goalRun: { progress: 0, currentStage: '', failureReason: '' },
    stages: {
      hero: { status: 'idle' },
      cuts: { status: 'idle', selectedAssetIds: [] },
      size: { status: 'idle', selectedAssetIds: [] },
    },
    assets: [],
    previousAssets: [],
    detailPlacement: {},
    archive: {},
    logs: [],
    uiPanels: {},
    openMarketSync: {},
  });
  const snapshotValue = () => ({
    factory: factoryValue(),
    productDb: {},
    competitors: {},
    factoryAssets: {},
    detailDocument: {},
    cafe24: {},
  });
  const store = createFactoryStore({
    initialSnapshot: snapshotValue(),
    workspaceId: `workspace-b3-cuts-${label}`,
    commandPolicies: createRuntimePolicies(),
  });
  const state = {
    cuts: {
      factoryStageId: 'cuts',
      sizeFactoryStageId: 'size',
      sourceBase64: 'source-b64',
      sourceMime: 'image/png',
      workImageBase64: '',
      prompts: [
        { id: 'cut-b', label: '컷 B', prompt: 'prompt B', result: null },
        { id: 'cut-a', label: '컷 A', prompt: 'prompt A', result: null },
      ],
      sizePrompts: [
        { id: 'size-b', label: '사이즈 B', prompt: 'size B', result: null },
        { id: 'size-a', label: '사이즈 A', prompt: 'size A', result: null },
      ],
      runLogs: [],
      runBusy: false,
      sizeRunBusy: false,
    },
    error: '',
  };
  const events = [];
  const calls = [];
  const helperDrafts = [];
  const activeStageRuns = new Set();
  const sideEffects = { log: 0, save: 0, render: 0 };
  const controls = {
    onCut: async () => true,
    onSize: async () => true,
    onSync: async () => true,
  };
  let uidSequence = 0;
  const staleError = action => Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${action}`), {
    code: 'STALE_FACTORY_RUNTIME_ACTION',
  });
  const requireCurrent = (action, runtimeStore, token, signal) => {
    if (signal?.aborted || !runtimeStore.isOperationCurrent(token)) throw staleError(action);
    return true;
  };
  const context = vm.createContext({
    state,
    FACTORY_IMAGE_GENERATION_PAGE_SESSION_ID: 'b3-page-session',
    CUTS_DEFAULT_PROMPT_COUNT: 2,
    sessionAssetsHydrated: false,
    setTimeout: callback => {
      callback();
      return 1;
    },
    factoryRuntimeRequireStore: () => store,
    factoryRequireCurrentRunOperation: requireCurrent,
    factoryRuntimeUpdateOwnedFactory: (command, owner, mutator) => {
      const token = store.getOperationToken();
      events.push(`command-open:${owner}:${command}`);
      const transaction = store.updateDraft(
        mutator,
        { owner, expectedRevision: token.revision },
        command,
      );
      const finish = receipt => {
        events.push(`command-commit:${command}`);
        return receipt;
      };
      return transaction && typeof transaction.then === 'function'
        ? Promise.resolve(transaction).then(finish)
        : finish(transaction);
    },
    factoryRunOperationIsStale: error => ['STALE_FACTORY_RUNTIME_ACTION', 'STALE_FACTORY_STORE_OPERATION'].includes(error?.code) || /STALE_FACTORY_(?:RUNTIME|STORE)/.test(error?.message || ''),
    factoryNormalizeCutPromptStage: value => String(value || 'cuts'),
    syncCutPromptsFromDom: () => true,
    factorySyncCutsSourceToCurrentProductAsync: async (stageId, options) => {
      calls.push(`sync:${stageId}`);
      helperDrafts.push(!!options.factory && !!options.operationToken && !!options.operationSignal);
      return controls.onSync(stageId, options);
    },
    restoreCutImagePayloadsFromPreview: () => true,
    ensureSizeCutSourceChoice: () => true,
    normalizeCutPrompts: prompts => prompts,
    factorySourceImagePart: () => ({ base64: 'source-b64', mime: 'image/png' }),
    hasImageConnection: () => true,
    cutsSetBlockingError: message => {
      state.error = message;
      sideEffects.log += 1;
      return false;
    },
    factoryImageStageHasActiveRun: () => false,
    factoryCurrentStageRunId: (stageId, factory) => factory.stages?.[stageId]?.currentRunId || '',
    uid: prefix => `${prefix}-${++uidSequence}`,
    factoryMarkImageStageRunActive: (stageId, runId) => activeStageRuns.add(`${stageId}:${runId}`),
    factoryMarkImageStageRunInactive: (stageId, runId) => activeStageRuns.delete(`${stageId}:${runId}`),
    stampCutPromptSource: prompt => prompt,
    factoryTouchImageStageRun: (stageId, runId, options = {}) => {
      helperDrafts.push(!!options.factory);
      const stage = options.factory.stages[stageId] || (options.factory.stages[stageId] = {});
      stage.currentRunId = runId || stage.currentRunId || '';
      stage.status = options.status || stage.status;
      stage.message = options.message || stage.message;
      stage.completedItemCount = options.completedItemCount;
      return true;
    },
    cutsAppendRunLog: message => {
      sideEffects.log += 1;
      state.cuts.runLogs.push(message);
    },
    savePrompts: () => { sideEffects.save += 1; },
    cutsScheduleLightSave: () => { sideEffects.save += 1; },
    cutsScheduleAssetPersistence: () => { sideEffects.save += 1; },
    renderPreservingMainScroll: () => { sideEffects.render += 1; },
    factoryRuntimeRenderWithOwnedDraft: (_factory, renderer) => {
      if (typeof renderer === 'function') return renderer();
      sideEffects.render += 1;
      return undefined;
    },
    cutsYieldAfterRender: async () => true,
    factoryStageGoalProgressRange: () => [20, 80],
    factorySetGoalRunProgress: (progress, stage, message, tone, options = {}) => {
      helperDrafts.push(!!options.factory);
      options.factory.goalRun.progress = progress;
      options.factory.goalRun.currentStage = stage;
      return progress;
    },
    cutRequestTimeoutMs: () => 1000,
    normalizeCutPromptItem: item => ({ ...item }),
    normalizeCutPromptSlotCount: value => Number(value || 0),
    runCutGenerationWithUiTimeout: async (stageId, index, worker) => worker(),
    generateCut: async (index, override, options) => {
      calls.push(`cut:${state.cuts.prompts[index].id}`);
      helperDrafts.push(!!options.factory && !!options.operationToken && !!options.operationSignal);
      const result = await controls.onCut(index, options);
      if (result !== false) state.cuts.prompts[index].result = `memory://${state.cuts.prompts[index].id}`;
      return result;
    },
    generateSizeCut: async (index, options) => {
      calls.push(`size:${state.cuts.sizePrompts[index].id}`);
      helperDrafts.push(!!options.factory && !!options.operationToken && !!options.operationSignal);
      const result = await controls.onSize(index, options);
      if (result !== false) state.cuts.sizePrompts[index].result = `memory://${state.cuts.sizePrompts[index].id}`;
      return result;
    },
    cutPromptGenerationRunId: prompt => prompt?.generationRunId || prompt?.currentRunId || '',
    factoryCutPromptPreviewSrc: prompt => prompt?.result || '',
    clearCutGenerationRuntimeState: () => true,
    factoryStampFreshGeneratedCutResult: (prompt, stageId, runId, factory) => {
      helperDrafts.push(!!factory);
      prompt.stageId = stageId;
      prompt.generationRunId = runId;
      return prompt;
    },
    factoryImportImageCutsResults: (stageId, options = {}) => {
      helperDrafts.push(!!options.factory);
      calls.push(`import:${stageId}`);
      return 1;
    },
    factoryForceImportFreshCutResults: (stageId, runId, factory) => {
      helperDrafts.push(!!factory);
      return 1;
    },
    factoryUsableAssetsForStage: () => [{}],
  });
  const cutsSource = sourceSlice(factoryCore, 'async function generateAllCuts(', 'const SIZE_CUTS_RESULT_CACHE_KEY');
  const sizeSource = sourceSlice(factoryCore, 'async function generateAllSizeCuts(', 'function cutPromptMeaningfulScore(');
  vm.runInContext(`${cutsSource}\n${sizeSource}\nthis.b3CutsWorkers = Object.freeze({ cuts: generateAllCuts, size: generateAllSizeCuts });`, context);
  return { activeStageRuns, calls, context, controls, events, factoryValue, helperDrafts, sideEffects, snapshotValue, staleError, state, store };
}

test('B3 cuts and size share one generation lease, preserve prompt order, and reject sibling writes', async () => {
  const harness = await createB3CutsRuntimeHarness('shared-lease');
  let releaseFirstCut;
  harness.controls.onCut = index => index === 0
    ? new Promise(resolve => { releaseFirstCut = resolve; })
    : Promise.resolve(true);

  const cutsRun = harness.context.b3CutsWorkers.cuts();
  for (let turn = 0; turn < 8 && typeof releaseFirstCut !== 'function'; turn += 1) await Promise.resolve();
  assert.equal(typeof releaseFirstCut, 'function');
  assert.equal(await harness.context.b3CutsWorkers.size(), false);
  assert.equal(harness.events.some(event => event.includes('generateAllSizeCuts')), false);

  releaseFirstCut(true);
  assert.equal(await cutsRun, true);
  assert.deepEqual(harness.calls.filter(call => call.startsWith('cut:')), ['cut:cut-b', 'cut:cut-a']);
  assert.deepEqual(harness.state.cuts.prompts.map(prompt => prompt.id), ['cut-b', 'cut-a']);
  assert.equal(harness.helperDrafts.every(Boolean), true);
  assert.equal(harness.activeStageRuns.size, 0);
  assert.deepEqual(harness.events, [
    'command-open:factory-assets:factory/assets:generateAllCuts',
    'command-commit:factory/assets:generateAllCuts',
  ]);

  harness.controls.onSize = async () => true;
  assert.equal(await harness.context.b3CutsWorkers.size(), true);
  assert.deepEqual(harness.calls.filter(call => call.startsWith('size:')), ['size:size-b', 'size:size-a']);
  assert.deepEqual(harness.state.cuts.sizePrompts.map(prompt => prompt.id), ['size-b', 'size-a']);

  const token = harness.store.getOperationToken();
  assert.throws(() => harness.store.updateDraft(draft => {
    draft.automation.activeTab = 'sibling write rejected';
  }, { owner: 'factory-assets', expectedRevision: token.revision }, 'factory/assets:generateAllCuts'), /PATH_REJECTED|owner/i);
});

test('B3 current cut partial failure keeps its result meaning and releases the generation lease', async () => {
  const harness = await createB3CutsRuntimeHarness('current-partial');
  harness.controls.onCut = async index => {
    if (index === 1) throw new Error('stub current partial failure');
    return true;
  };
  assert.equal(await harness.context.b3CutsWorkers.cuts(), false);
  assert.match(harness.state.error, /^전체 생성 중단: stub current partial failure/);
  assert.equal(harness.state.cuts.prompts[0].result, 'memory://cut-b');
  assert.equal(harness.state.cuts.prompts[1].result, null);
  assert.equal(harness.activeStageRuns.size, 0);

  harness.controls.onCut = async () => true;
  harness.state.error = '';
  assert.equal(await harness.context.b3CutsWorkers.cuts(), true);
  assert.equal(harness.events.filter(event => event === 'command-commit:factory/assets:generateAllCuts').length, 2);
});

test('B3 stale cut partial failure has zero post-switch effects and the cancelled lease does not stick', async () => {
  const harness = await createB3CutsRuntimeHarness('stale-partial');
  let effectsAtSwitch = null;
  harness.controls.onCut = async index => {
    if (index === 0) return true;
    effectsAtSwitch = { ...harness.sideEffects };
    harness.store.switchWorkspace('workspace-b3-cuts-switched', {
      snapshot: harness.snapshotValue(),
      revision: 0,
    });
    throw harness.staleError('factory/assets:generateAllCuts');
  };
  await assert.rejects(harness.context.b3CutsWorkers.cuts(), /STALE_FACTORY_RUNTIME_ACTION|STALE_FACTORY_STORE/);
  assert.deepEqual(harness.sideEffects, effectsAtSwitch);
  assert.equal(harness.activeStageRuns.size, 0);
  assert.equal(harness.events.filter(event => event === 'command-commit:factory/assets:generateAllCuts').length, 0);

  harness.controls.onCut = async () => true;
  assert.equal(await harness.context.b3CutsWorkers.cuts(), true);
  assert.equal(harness.events.filter(event => event === 'command-commit:factory/assets:generateAllCuts').length, 1);
});

async function createB3DetailRuntimeHarness(label) {
  const core = source('src/app-core-03.js');
  const factoryCore = source('src/app-core-06.js');
  const createRuntimePolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', `b3-detail-${label}`);
  const factoryValue = () => ({
    product: { productName: 'B3 상세 테스트 상품' },
    automation: {},
    goalRun: { progress: 0, currentStage: '', failureReason: '' },
    stages: { detail: { status: 'idle', targetCount: 0 }, cuts: { status: 'idle' } },
    assets: [],
    previousAssets: [],
    detailPlacement: {},
    archive: {},
    logs: [],
    uiPanels: {},
    openMarketSync: {},
  });
  const snapshotValue = () => ({
    factory: factoryValue(),
    productDb: {},
    competitors: {},
    factoryAssets: {},
    detailDocument: {},
    cafe24: {},
  });
  const store = createFactoryStore({
    initialSnapshot: snapshotValue(),
    workspaceId: `workspace-b3-detail-${label}`,
    commandPolicies: createRuntimePolicies(),
  });
  const market = {
    selectedIds: ['b', 'a'],
    results: [
      { id: 'b', title: '후보 B', platform: 'stub', product_url: 'https://example.test/b' },
      { id: 'a', title: '후보 A', platform: 'stub', product_url: 'https://example.test/a' },
    ],
    selectedImageIds: [],
    scrapedImages: [],
    sessionId: 'local-session',
    searchKeyword: 'B3 상세 테스트 상품',
    route: 'stub-local',
    detailSelectionVersion: 0,
    loading: false,
  };
  const events = [];
  const activeHeartbeats = new Set();
  const sideEffects = { log: 0, save: 0, status: 0, render: 0 };
  const controls = {
    onExternal: async payload => ({
      images: payload.selectedIds.map(id => ({ id: `img-${id}`, candidateId: id, url: `memory://${id}` })),
    }),
  };
  const staleError = action => Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${action}`), {
    code: 'STALE_FACTORY_RUNTIME_ACTION',
  });
  const context = vm.createContext({
    state: {},
    JEPUM_MARKET_API: { endpoints: {} },
    ensureCompMarketScrapeState: () => market,
    factoryRuntimeRequireStore: () => store,
    factoryRequireCurrentRunOperation: (action, runtimeStore, token, signal) => {
      if (signal?.aborted || !runtimeStore.isOperationCurrent(token)) throw staleError(action);
      return true;
    },
    factoryRuntimeUpdateOwnedFactory: (command, owner, mutator) => {
      const token = store.getOperationToken();
      events.push(`command-open:${owner}:${command}`);
      const transaction = store.updateDraft(
        mutator,
        { owner, expectedRevision: token.revision },
        command,
      );
      const finish = receipt => {
        events.push(`command-commit:${command}`);
        return receipt;
      };
      return transaction && typeof transaction.then === 'function'
        ? Promise.resolve(transaction).then(finish)
        : finish(transaction);
    },
    factoryRunOperationIsStale: error => ['STALE_FACTORY_RUNTIME_ACTION', 'STALE_FACTORY_STORE_OPERATION'].includes(error?.code) || /STALE_FACTORY_(?:RUNTIME|STORE)/.test(error?.message || ''),
    compMarketSetStatus: (message, code, tone) => {
      sideEffects.status += 1;
      market.status = message;
      market.statusCode = code;
      market.statusTone = tone;
    },
    compMarketLog: message => {
      sideEffects.log += 1;
      market.lastLog = message;
    },
    render: () => { sideEffects.render += 1; },
    factoryPatchGoalRunStatusInPlace: () => true,
    factoryYieldToPaint: async () => true,
    compMarketResultId: item => String(item?.id || ''),
    compMarketResolveResultById: (current, id, byId) => byId.get(String(id)) || null,
    compMarketDetailOperationUrl: item => String(item?.product_url || item?.url || item?.detail_url || '').trim(),
    compMarketSiteLabel: value => value,
    factorySetGoalRunProgress: (progress, stage, message, tone, options = {}) => {
      const factory = options.factory;
      factory.goalRun.progress = progress;
      factory.goalRun.currentStage = stage;
      if (options.failureReason !== undefined) factory.goalRun.failureReason = options.failureReason;
      return progress;
    },
    factoryStartGoalHeartbeat: () => {
      const handle = { id: activeHeartbeats.size + 1 };
      activeHeartbeats.add(handle);
      return handle;
    },
    factoryStopGoalHeartbeat: handle => {
      if (handle) activeHeartbeats.delete(handle);
    },
    compMarketCollectionContextIsCurrent: () => true,
    compMarketCurrentWorkScope: () => ({}),
    factoryCompetitorCandidateScopePayload: () => ({}),
    compMarketEnsureVmDetailCaptureReady: async () => { throw new Error('VM external call forbidden in B3 test'); },
    compMarketInvokeV1: async () => { throw new Error('v1 external call forbidden in B3 test'); },
    compMarketProductPayloadForDetail: item => item,
    compMarketTryVmScrapeDetails: async () => { throw new Error('VM external call forbidden in B3 test'); },
    compMarketFetchJson: async (route, request) => {
      const body = JSON.parse(request.body);
      events.push(`external-local:${body.selected_ids.join(',')}`);
      return controls.onExternal({ route, selectedIds: body.selected_ids.slice() });
    },
    compMarketSave: () => { sideEffects.save += 1; },
    compMarketRememberManualIntervention: () => false,
    compMarketExtractDetailImages: result => result?.images || [],
    compMarketFilterScrapedImagesForCurrentWork: images => images,
    compMarketDedupeScrapedImages: images => images,
    compMarketMergeScrapedImages: (previous, incoming) => incoming.slice(),
    compMarketDetailJobInfo: () => ({ entries: [], failed: 0, completed: 2, total: 2, active: false, manual: false }),
    compMarketDetailJobWaitMessage: (info, fallback) => fallback,
    compMarketScrapedImageId: image => image.id,
  });
  const detailHelpers = sourceSlice(factoryCore, 'function compMarketDetailOperationIds(', 'async function runCompMarketDetailCapture(');
  const detailWorker = sourceSlice(factoryCore, 'async function runCompMarketDetailCapture(', 'async function compMarketResumeDetailJobRequest(');
  vm.runInContext(`${detailHelpers}\n${detailWorker}\nthis.b3DetailWorker = runCompMarketDetailCapture;`, context);
  return { activeHeartbeats, context, controls, events, factoryValue, market, sideEffects, snapshotValue, staleError, store };
}

test('B3 detail uses one exact lease, keeps selected and output order, and clears heartbeat on success', async () => {
  const harness = await createB3DetailRuntimeHarness('success-order');
  let releaseExternal;
  harness.controls.onExternal = payload => new Promise(resolve => {
    releaseExternal = () => resolve({
      images: payload.selectedIds.map(id => ({ id: `img-${id}`, candidateId: id, url: `memory://${id}` })),
    });
  });
  const first = harness.context.b3DetailWorker(['b', 'a'], { runtime: 'local' });
  for (let turn = 0; turn < 8 && typeof releaseExternal !== 'function'; turn += 1) await Promise.resolve();
  assert.equal(typeof releaseExternal, 'function');
  assert.equal(await harness.context.b3DetailWorker(['b', 'a'], { runtime: 'local' }), false);
  releaseExternal();
  await first;

  assert.deepEqual(Array.from(harness.market.detailOperation.selectedIds), ['b', 'a']);
  assert.deepEqual(Array.from(harness.market.scrapedImages, image => image.candidateId), ['b', 'a']);
  assert.equal(harness.market.detailOperation.stableTargetKey, ['a', 'b'].join('\u001f'));
  assert.equal(harness.activeHeartbeats.size, 0);
  assert.deepEqual(harness.events, [
    'command-open:competitors:factory/competitor:runDetailCapture',
    'external-local:b,a',
    'command-commit:factory/competitor:runDetailCapture',
  ]);

  const token = harness.store.getOperationToken();
  assert.throws(() => harness.store.updateDraft(draft => {
    draft.stages.cuts.status = 'sibling detail write rejected';
  }, { owner: 'competitors', expectedRevision: token.revision }, 'factory/competitor:runDetailCapture'), /PATH_REJECTED|owner/i);
});

test('B3 detail workspace switch aborts stale completion with no post-switch effects and no heartbeat leak', async () => {
  const harness = await createB3DetailRuntimeHarness('stale-switch');
  let effectsAtSwitch = null;
  harness.controls.onExternal = async payload => {
    effectsAtSwitch = { ...harness.sideEffects };
    harness.store.switchWorkspace('workspace-b3-detail-switched', {
      snapshot: harness.snapshotValue(),
      revision: 0,
    });
    return { images: payload.selectedIds.map(id => ({ id: `img-${id}`, candidateId: id })) };
  };
  await assert.rejects(
    harness.context.b3DetailWorker(['b', 'a'], { runtime: 'local' }),
    /STALE_FACTORY_RUNTIME_ACTION|STALE_FACTORY_STORE/,
  );
  assert.deepEqual(harness.sideEffects, effectsAtSwitch);
  assert.equal(harness.activeHeartbeats.size, 0);
  assert.equal(harness.events.some(event => event === 'command-commit:factory/competitor:runDetailCapture'), false);
});

test('B3 image request timer registry is empty after success, throw, and operation abort', async () => {
  const factoryCore = source('src/app-core-06.js');
  const workerSource = sourceSlice(
    factoryCore,
    'async function generateImageWithAbortableTimeout(',
    'function cutGeneratingHelperText(',
  );
  const activeTimers = new Set();
  const activeRequests = new Set();
  const trackedSetTimeout = (callback, delay) => {
    const handle = setTimeout(callback, delay);
    activeTimers.add(handle);
    return handle;
  };
  const trackedClearTimeout = handle => {
    activeTimers.delete(handle);
    clearTimeout(handle);
  };
  const context = vm.createContext({
    AbortController,
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    cutRequestTimeoutMs: () => 60000,
    cutGenerationTimeoutMessage: label => `${label} timeout`,
    generateWithSelectedImageModel: async () => 'unused',
    getCurrentImageRunInfo: () => ({}),
    factoryImageRequestKey: (stageId, label) => `${stageId}:${label}`,
    factoryMarkImageRequestActive: key => activeRequests.add(key),
    factoryMarkImageRequestInactive: key => activeRequests.delete(key),
    cutsAppendRunLog: () => true,
    withTimeout: async work => work,
  });
  vm.runInContext(`${workerSource}\nthis.b3ImageWorker = generateImageWithAbortableTimeout;`, context);

  const success = await context.b3ImageWorker('success', 'prompt', 'base64', 'image/png', [], {
    timeoutMs: 60000,
    executor: async () => 'memory://success',
  });
  assert.equal(success, 'memory://success');
  assert.equal(activeTimers.size, 0);
  assert.equal(activeRequests.size, 0);

  await assert.rejects(
    context.b3ImageWorker('throw', 'prompt', 'base64', 'image/png', [], {
      timeoutMs: 60000,
      executor: async () => { throw new Error('stub image throw'); },
    }),
    /stub image throw/,
  );
  assert.equal(activeTimers.size, 0);
  assert.equal(activeRequests.size, 0);

  const controller = new AbortController();
  const aborted = context.b3ImageWorker('abort', 'prompt', 'base64', 'image/png', [], {
    timeoutMs: 60000,
    operationSignal: controller.signal,
    executor: async (prompt, base64, mime, extraImages, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('stub operation abort');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  controller.abort('workspace switched');
  await assert.rejects(aborted, /abort timeout/);
  assert.equal(activeTimers.size, 0);
  assert.equal(activeRequests.size, 0);
});
