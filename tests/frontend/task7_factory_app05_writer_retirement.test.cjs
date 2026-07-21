'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const APP05_PATH = path.join(ROOT, 'src/app-core-05.js');
const UPLOAD_MENU_PATH = path.join(ROOT, 'src/menus/upload-menu.mjs');
const ANALYSIS_MENU_PATH = path.join(ROOT, 'src/menus/analysis-menu.mjs');
const ANALYSIS_CONTROLLER_PATH = path.join(ROOT, 'src/menus/analysis-controller.mjs');
const AUDIT_PATH = path.join(
  ROOT,
  '.omo/evidence/kuasangse-menu-modularization/task-7/remediation-B2-B3/full-selector-scope-audit-v3.cjs',
);

function source() {
  return fs.readFileSync(APP05_PATH, 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function canonicalAudit() {
  return JSON.parse(execFileSync(process.execPath, [AUDIT_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }));
}

async function importFresh(relativePath, label) {
  const url = pathToFileURL(path.join(ROOT, relativePath));
  url.searchParams.set('app05-writer-retirement', `${label}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('app-core-05 canonical direct-writer denominator is retired to zero', () => {
  const result = canonicalAudit();
  const row = result.files.find(item => item.file === 'src/app-core-05.js');
  assert.ok(row, 'canonical audit must report app-core-05');
  assert.equal(row.directWriterScopes, 0);
  assert.equal(row.directMutationCount, 0);
});

test('app-core-05 mutator cores require an explicit owned draft', () => {
  const text = source();
  const signatures = [
    'factoryEnsureAutomationRunScope',
    'factoryEnsureOpenMarketSync',
    'factoryApplyFinalCafe24StatusToDb',
    'factoryFinalRegistrationDetailModel',
    'factoryEnsureCurrentDetailHtmlAsset',
    'factoryClearFinalRegistrationStaleResult',
    'factorySetStagePromptForCurrentWork',
    'factoryLog',
    'factorySetStageStatus',
    'factoryRememberPreviousAsset',
    'factoryUpdateFromInputs',
  ];
  for (const name of signatures) {
    const match = text.match(new RegExp(`function ${name}\\(([^)]*)\\)`));
    assert.ok(match, `missing ${name}`);
    assert.doesNotMatch(match[1], /factoryRuntimeReadFactory/);
  }

  const registerAsset = sourceSlice(
    text,
    'function factoryRegisterAsset(',
    'function factoryUpdateFromInputs(',
  );
  assert.doesNotMatch(registerAsset, /meta\.factory\s*\|\|\s*factoryRuntimeReadFactory\(\)/);
  assert.match(registerAsset, /factoryRuntimeUpdateOwnedFactory\(/);
});

test('classic product and file listeners are retired while upload and analysis ESM own their actions', () => {
  const text = source();
  const bindEvents = sourceSlice(text, 'function bindEvents(', 'function handleFile(');
  const handleFile = sourceSlice(text, 'function handleFile(', 'function handleMultipleFiles(');
  const uploadMenu = fs.readFileSync(UPLOAD_MENU_PATH, 'utf8');
  const analysisMenu = fs.readFileSync(ANALYSIS_MENU_PATH, 'utf8');
  const analysisController = fs.readFileSync(ANALYSIS_CONTROLLER_PATH, 'utf8');

  assert.equal((bindEvents.match(/factorySetCurrentProductIdentity\(/g) || []).length, 0);
  assert.doesNotMatch(bindEvents, /#(?:productNameInput|fileInput|analysisMatchNameInput|analysisHubFileInput)/);
  assert.doesNotMatch(bindEvents, /factorySetCurrentProductIdentity\([^\n]*factoryRuntimeReadFactory\(\)/);
  assert.match(uploadMenu, /invokeUploadAction\('updateProductName'/);
  assert.match(uploadMenu, /invokeUploadAction\('saveProductName'/);
  assert.match(uploadMenu, /invokeUploadAction\('uploadFiles'/);
  assert.match(analysisMenu, /createAnalysisMenuController\(capabilities\)/);
  assert.match(analysisController, /call\('updateProductName'/);
  assert.match(analysisController, /\['#analysisMatchNameInput', 'commitProductName'\]/);
  assert.match(analysisController, /call\('uploadFiles'/);

  assert.match(handleFile, /factory\/runtime:syncProductImageAcrossWorkspaces/);
  assert.match(handleFile, /factoryRuntimeIsOperationCurrent\(operationToken\)/);
  assert.match(handleFile, /syncProductImageAcrossWorkspaces\(\{[\s\S]*factory:\s*draft/);
  assert.doesNotMatch(handleFile, /syncProductImageAcrossWorkspaces\(\{\s*prefer:\s*'app'\s*\}\)/);
});

test('explicit draft helpers mutate only the supplied draft in the runtime harness', () => {
  const text = source();
  const automationSource = sourceSlice(
    text,
    'function factoryEnsureAutomationRunScope(',
    'function factorySinhwaCandidateKey(',
  );
  const stagePromptSource = sourceSlice(
    text,
    'function factorySetStagePromptForCurrentWork(',
    'function renderFactoryStageCard(',
  );
  let selectorReads = 0;
  const buildAutomation = new Function(
    'compMarketCurrentWorkScope',
    'factoryRuntimeReadFactory',
    `${automationSource}; return factoryEnsureAutomationRunScope;`,
  );
  const ensureAutomation = buildAutomation(
    () => ({ scopeKey: 'workspace::run::product' }),
    () => { selectorReads += 1; throw new Error('selector fallback forbidden'); },
  );
  const draft = { automation: { startRunScopeKey: 'old', startRunCounts: { competitors: 4 } } };
  assert.equal(ensureAutomation(draft), 'workspace::run::product');
  assert.deepEqual(draft.automation.startRunCounts, {});

  const buildStagePrompt = new Function(
    'factoryStagePromptCurrentScope',
    `${stagePromptSource}; return factorySetStagePromptForCurrentWork;`,
  );
  const setPrompt = buildStagePrompt(() => ({
    currentRunId: 'run-1',
    productKey: 'product-1',
    inputImageFingerprint: 'image-1',
    stageId: 'hero',
    scopeKey: 'scope-1',
  }));
  setPrompt(draft, 'hero', 'new prompt');
  assert.equal(draft.stages.hero.prompt, 'new prompt');
  assert.equal(draft.stages.hero.promptScopeKey, 'scope-1');
  assert.equal(selectorReads, 0);
});

test('log, stage-status, and previous-asset public entries transact before mutation', () => {
  const text = source();
  const helperSource = sourceSlice(
    text,
    'function factoryLog(',
    'function factoryRegisterAssetNeedsCurrentJobGate(',
  );
  const draft = {
    logs: [],
    logStageId: '',
    activeStage: '',
    stages: { hero: { status: 'idle' } },
    previousAssets: [],
    goalRun: {},
  };
  const calls = [];
  const buildHelpers = new Function(
    'factoryRuntimeUpdateOwnedFactory',
    'factoryNowTime',
    'factoryCompactLogMessage',
    'factoryCurrentJobKey',
    'factoryLogStageId',
    'factoryPatchGoalRunStatusInPlace',
    'FACTORY_STAGE_DEFS',
    'normalizeFactoryAsset',
    'cloneData',
    `${helperSource}; return { factoryLog, factorySetStageStatus, factoryRememberPreviousAsset };`,
  );
  const helpers = buildHelpers(
    (command, owner, mutator) => {
      calls.push({ command, owner });
      return { result: mutator(draft) };
    },
    () => '12:00:00',
    value => String(value),
    stageId => ({ workspaceId: 'ws-1', currentRunId: 'run-1', productKey: 'p-1', inputImageFingerprint: 'i-1', stageId }),
    () => 'general',
    () => {},
    [{ id: 'hero' }],
    value => ({ ...value }),
    value => JSON.parse(JSON.stringify(value)),
  );

  helpers.factoryLog('hello', 'ok');
  helpers.factorySetStageStatus('hero', 'running', 'working');
  helpers.factoryRememberPreviousAsset({ id: 'asset-1', metadata: {} }, 'old result');

  assert.deepEqual(calls, [
    { command: 'factory/runtime:log', owner: 'factory' },
    { command: 'factory/runtime:setStageStatus', owner: 'factory-assets' },
    { command: 'factory/runtime:rememberPreviousAsset', owner: 'factory-assets' },
  ]);
  assert.equal(draft.logs[0].message, 'hello');
  assert.equal(draft.stages.hero.status, 'running');
  assert.equal(draft.previousAssets[0].id, 'asset-1');
});

test('registered app05 commands accept owned paths and reject stale or sibling writes', async () => {
  const core03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  const policySource = sourceSlice(
    core03,
    'function factoryRuntimeCreateCommandPolicies(',
    'const FACTORY_RUNTIME_COMMAND_POLICIES',
  );
  const createPolicies = new Function(`${policySource}; return factoryRuntimeCreateCommandPolicies;`)();
  const commandPolicies = createPolicies();
  const { createFactoryStore } = await importFresh('src/modules/factory-store.mjs', 'policy-runtime');
  const store = createFactoryStore({
    workspaceId: 'workspace-app05',
    initialSnapshot: {
      factory: {
        automation: { dbSearchQuery: '', startRunCounts: {} },
        product: {},
        openMarketSync: {},
        stages: { hero: {} },
        assets: [],
        previousAssets: [],
        archive: {},
        logs: [],
        logStageId: '',
        activeStage: '',
        goalRun: {},
      },
      productDb: {},
      competitors: {},
      factoryAssets: {},
      detailDocument: {},
      cafe24: {},
    },
    commandPolicies,
    assertMutable: () => true,
  });

  let token = store.getOperationToken();
  store.updateDraft(draft => {
    draft.assets.push({ id: 'asset-1', archived: false });
    draft.stages.hero.selectedAssetIds = ['asset-1'];
    return { id: 'asset-1' };
  }, { owner: 'factory-assets', expectedRevision: token.revision }, 'factory/runtime:registerAsset');

  token = store.getOperationToken();
  store.updateDraft(draft => {
    draft.product.productName = '제품 A';
    draft.automation.dbSearchQuery = '제품 A';
    draft.openMarketSync.marketPlusUrl = 'https://example.invalid';
    draft.stages.hero.prompt = '대표컷';
    draft.goalRun.maxLoops = 3;
    return true;
  }, { owner: 'factory', expectedRevision: token.revision }, 'factory/runtime:updateFromInputs');

  token = store.getOperationToken();
  store.updateDraft(draft => {
    draft.assets[0].archived = true;
    draft.archive.status = '자산 저장 완료';
    return true;
  }, { owner: 'factory-assets', expectedRevision: token.revision }, 'factory/runtime:completeRegisteredAssetArchive');
  assert.equal(store.getSnapshot().factory.assets[0].archived, true);
  assert.equal(store.getSnapshot().factory.archive.status, '자산 저장 완료');

  const staleToken = token;
  assert.throws(() => store.updateDraft(draft => {
    draft.assets.push({ id: 'stale' });
  }, { owner: 'factory-assets', expectedRevision: staleToken.revision }, 'factory/runtime:registerAsset'), /STALE_FACTORY_STORE_REVISION/);

  token = store.getOperationToken();
  assert.throws(() => store.updateDraft(draft => {
    draft.product.illegalSiblingWrite = true;
  }, { owner: 'factory-assets', expectedRevision: token.revision }, 'factory/runtime:registerAsset'), /FACTORY_COMMAND_PATH_REJECTED/);
});

test('register-asset persistence effects start only after its owned commit receipt', () => {
  const text = source();
  const registerSource = sourceSlice(
    text,
    'function factoryRegisterAsset(',
    'function factoryUpdateFromInputs(',
  );
  const events = [];
  const operationToken = Object.freeze({ workspaceId: 'workspace-app05', revision: 4, fence: 5 });
  const asset = { id: 'asset-1', image: 'data:image/png;base64,QUJD' };
  const buildRegister = new Function(
    'factoryRuntimeUpdateOwnedFactory',
    'factoryRuntimeRequireStore',
    'scheduleSessionAssetSaveIfChanged',
    'factoryQueueLocalArchiveAsset',
    'cloneData',
    'factoryRuntimeIsOperationCurrent',
    'factoryArchiveAsset',
    'factoryCommitRegisteredAssetArchiveResult',
    `${registerSource}; return factoryRegisterAsset;`,
  );
  const registerAsset = buildRegister(
    (command, owner) => {
      events.push(`commit:${command}:${owner}`);
      return {
        result: asset,
        snapshot: { factory: { archive: { autoSave: true, folderName: 'workspace-folder' } } },
      };
    },
    () => ({ getOperationToken: () => operationToken }),
    () => events.push('session-save'),
    () => {
      events.push('local-archive');
      return Promise.resolve(true);
    },
    value => JSON.parse(JSON.stringify(value)),
    token => token === operationToken,
    () => {
      events.push('file-archive');
      return new Promise(() => {});
    },
    () => events.push('archive-completion'),
  );

  assert.equal(registerAsset('hero', asset.image), asset);
  assert.deepEqual(events, [
    'commit:factory/runtime:registerAsset:factory-assets',
    'session-save',
    'local-archive',
    'file-archive',
  ]);
});

test('archive completion is fenced by the exact token and matching asset id', () => {
  const text = source();
  const completionSource = sourceSlice(
    text,
    'function factoryApplyRegisteredAssetArchiveResult(',
    'function factoryRegisterAsset(',
  );
  const operationToken = Object.freeze({ workspaceId: 'workspace-app05', revision: 8, fence: 9 });
  const draft = {
    assets: [
      { id: 'asset-1', archived: false },
      { id: 'asset-2', archived: false },
    ],
    archive: {},
    logs: [],
  };
  const bridgeCalls = [];
  const buildCompletion = new Function(
    'cloneData',
    'factoryLog',
    'factoryRuntimeBridgeAction',
    'scheduleSessionAssetSaveIfChanged',
    `${completionSource}; return { factoryApplyRegisteredAssetArchiveResult, factoryCommitRegisteredAssetArchiveResult };`,
  );
  const completion = buildCompletion(
    value => JSON.parse(JSON.stringify(value)),
    () => {},
    (command, context, mutator, options) => {
      bridgeCalls.push({ command, token: context.operationToken, render: options.render });
      return { result: mutator(draft) };
    },
    () => {},
  );

  completion.factoryCommitRegisteredAssetArchiveResult(
    operationToken,
    'asset-1',
    { id: 'asset-1', archived: true, archivedAt: '2026-07-18T00:00:00.000Z' },
    { archive: { status: '자산 저장 완료' } },
  );
  assert.strictEqual(bridgeCalls[0].token, operationToken);
  assert.equal(bridgeCalls[0].command, 'factory/runtime:completeRegisteredAssetArchive');
  assert.equal(draft.assets[0].archived, true);
  assert.equal(draft.assets[1].archived, false);

  const mismatch = completion.factoryApplyRegisteredAssetArchiveResult(
    draft,
    'asset-2',
    { id: 'asset-1', archived: true },
    { archive: { status: 'wrong asset' } },
  );
  assert.deepEqual(mismatch, { ok: false, assetIdMismatch: true });
  assert.equal(draft.assets[1].archived, false);
  assert.equal(draft.archive.status, '자산 저장 완료');
});
