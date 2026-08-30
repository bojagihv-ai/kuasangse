'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function runtimePolicies() {
  const core = source('src/app-core-03.js');
  const createPolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  return createPolicies();
}

async function storeData() {
  const url = pathToFileURL(path.join(ROOT, 'src/modules/factory-store-data.mjs'));
  url.searchParams.set('size-vm-latency-regression', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('completed current size fallback admits only a done stage with displayable latest-run assets', () => {
  const core = source('src/app-core-03.js');
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => ({}),
    factoryStageLatestGenerationRunId(stageId, factory) {
      return factory.stages?.[stageId]?.latestGenerationRunId || '';
    },
    factoryAssetsForStage(stageId, factory) {
      return factory.assets.filter(asset => asset.stageId === stageId);
    },
    factoryAssetGenerationRunId(asset) {
      return asset.generationRunId || '';
    },
    factoryAssetHasDisplayImage(asset) {
      return asset.display === true;
    },
  });
  const helperSource = sourceSlice(
    core,
    'function factoryCompletedAssetsForCurrentStageRun(',
    'function factoryCurrentProductKey(',
  );
  vm.runInContext(`${helperSource}\nthis.completedAssets = factoryCompletedAssetsForCurrentStageRun;`, context);

  const factory = {
    stages: {
      size: {
        status: 'done',
        latestGenerationRunId: 'size-run-current',
        completedItemCount: 3,
      },
    },
    assets: [
      { id: 'accepted', stageId: 'size', generationRunId: 'size-run-current', display: true },
      { id: 'wrong-run', stageId: 'size', generationRunId: 'size-run-old', display: true },
      { id: 'hidden', stageId: 'size', generationRunId: 'size-run-current', display: true, currentProductHidden: true },
      { id: 'no-display', stageId: 'size', generationRunId: 'size-run-current', display: false },
      { id: 'wrong-stage', stageId: 'cuts', generationRunId: 'size-run-current', display: true },
    ],
  };

  assert.deepEqual(
    Array.from(context.completedAssets('size', factory), asset => asset.id),
    ['accepted'],
  );
  for (const status of ['running', 'review', 'blocked']) {
    factory.stages.size.status = status;
    assert.deepEqual(
      Array.from(context.completedAssets('size', factory), asset => asset.id),
      [],
      `${status} size stage must not use the completed-run fallback`,
    );
  }
});

test('size confirmation owns manual size drafts and never persists from inside its command transaction', async () => {
  const { normalizeCommandPolicies, validateCommandDiff } = await storeData();
  const policy = normalizeCommandPolicies(runtimePolicies())
    .get('factory/assets:confirmFactorySizeImage');
  const assignments = validateCommandDiff(
    policy,
    {
      automation: {
        sizeFieldDrafts: { width_mm: '20.5cm', depth_mm: '14.5cm' },
        sizeImageDbConfirmedKey: '',
        sizeImageDbConfirmedAt: 0,
        updatedAt: 0,
      },
    },
    {
      automation: {
        sizeFieldDrafts: {},
        sizeImageDbConfirmedKey: 'confirmed-size-key',
        sizeImageDbConfirmedAt: 10,
        updatedAt: 10,
      },
    },
  );
  assert.equal(
    assignments.some(item => item.owner === 'product-db' && item.changedPath.startsWith('automation.sizeFieldDrafts')),
    true,
  );

  const core = source('src/app-core-03.js');
  const draft = {
    automation: {
      sizeFieldDrafts: { width_mm: '20.5cm', depth_mm: '14.5cm' },
    },
    stages: { size: {} },
    logs: [],
  };
  let broadSaveCalls = 0;
  const context = vm.createContext({
    Date: { now: () => 10 },
    document: {},
    factoryRuntimeBridgeAction(_action, _operationContext, execute) {
      return execute(draft);
    },
    factoryUpdateFromInputs() {},
    factoryCommitVisibleDbSizeManualDrafts(_document, options) {
      options.factory.automation.sizeFieldDrafts = {};
    },
    factoryAutomationSizeReviewStatus() {
      return { requiredMissing: [], key: 'confirmed-size-key' };
    },
    factorySetStageStatus(_stageId, status, message, factory) {
      factory.stages.size = { status, message };
    },
    factoryLog(message, type, factory) {
      factory.logs.push({ message, type });
    },
    saveLastWorkNow() {
      broadSaveCalls += 1;
    },
  });
  const actionsSource = sourceSlice(
    core,
    'function factoryRuntimeAssetsActions()',
    'function factoryRuntimeSectionsActions()',
  );
  vm.runInContext(`${actionsSource}\nthis.assetsActions = factoryRuntimeAssetsActions();`, context);

  assert.equal(context.assetsActions.confirmFactorySizeImage(), true);
  assert.equal(draft.automation.sizeImageDbConfirmedKey, 'confirmed-size-key');
  assert.equal(broadSaveCalls, 0);
});

test('size generation button stays clickable when required size values are ready but not separately confirmed', () => {
  const core = source('src/app-core-05.js');
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => ({}),
    factoryStageMessageForCurrentProduct: stage => stage.message,
    factoryAutomationSizeReviewStatus: () => ({
      confirmed: false,
      requiredMissing: [],
      fields: [
        { fieldId: 'width_mm', value: '20.5cm' },
        { fieldId: 'depth_mm', value: '14.5cm' },
      ],
    }),
    disabledAttr: (disabled, reason) => disabled ? `disabled title="${reason}"` : '',
    escapeHtml: value => String(value),
  });
  const renderSource = sourceSlice(
    core,
    'function renderFactoryCandidateSizeGenerationWait(',
    'function factoryGoalRunNeedsAttention(',
  );
  vm.runInContext(`${renderSource}\nthis.renderSizeWait = renderFactoryCandidateSizeGenerationWait;`, context);
  const html = context.renderSizeWait({
    stages: { size: { status: 'blocked', message: 'DB 사이즈값 확인이 필요합니다.' } },
  });

  assert.match(html, /data-factory-run-stage="size"/);
  assert.doesNotMatch(html, /data-factory-run-stage="size"[^>]*disabled/);
});

test('candidate confirmation never downgrades an already completed current size run', () => {
  const cafe24 = source('src/cafe24-sync.js');
  const factory = {
    automation: {
      lastAutoSizeRunKey: 'completed-size-run',
      sizeImageDbConfirmedKey: 'confirmed-size-fields',
    },
    stages: {
      size: {
        status: 'done',
        message: '3개 후보 표시 완료',
        completedItemCount: 3,
        expectedItemCount: 3,
        currentRunId: 'size-run-current',
        latestGenerationRunId: 'size-run-current',
      },
    },
    assets: [1, 2, 3].map(index => ({
      id: `size-${index}`,
      stageId: 'size',
      generationRunId: 'size-run-current',
      imageUrl: `/api/local-archive/assets/size-${index}/image`,
    })),
    logs: [],
  };
  const stageChanges = [];
  const context = vm.createContext({
    factoryUsableAssetsForStage() {
      return [];
    },
    factoryCompletedAssetsForCurrentStageRun(stageId, draft) {
      return draft.assets.filter(asset => asset.stageId === stageId);
    },
    factoryAssetGenerationRunId(asset) {
      return asset.generationRunId || '';
    },
    factoryAssetDisplayImage(asset) {
      return asset.imageUrl || '';
    },
    factoryHasSizeFacts: () => false,
    factoryAutomationSizeReviewStatus: () => ({ confirmed: false }),
    factorySetStageStatus(stageId, status, message, draft) {
      stageChanges.push({ stageId, status, message });
      draft.stages[stageId] = { ...(draft.stages[stageId] || {}), status, message };
    },
    factoryLog(message, type, draft) {
      draft.logs.push({ message, type });
    },
    saveLastWorkNow() {},
    render() {},
  });
  const scheduleSource = sourceSlice(
    cafe24,
    'function factoryScheduleSizeCutAfterCandidateConfirm(',
    'function factoryCaptureCandidateReviewRequestIdentity(',
  );
  vm.runInContext(`${scheduleSource}\nthis.scheduleSizeAfterCandidate = factoryScheduleSizeCutAfterCandidateConfirm;`, context);

  assert.equal(context.scheduleSizeAfterCandidate('Cafe24 확정', factory), true);
  assert.equal(factory.stages.size.status, 'done');
  assert.equal(factory.stages.size.message, '3개 후보 표시 완료');
  assert.equal(factory.automation.lastAutoSizeRunKey, 'completed-size-run');
  assert.equal(factory.automation.sizeImageDbConfirmedKey, 'confirmed-size-fields');
  assert.deepEqual(stageChanges, []);
});

test('completed current size assets remain selectable while candidate scope is temporarily empty', () => {
  const core = source('src/app-core-06.js');
  const asset = {
    id: 'size-current-run-1',
    stageId: 'size',
    title: '사이즈컷 1',
    used: false,
    rejected: false,
  };
  const factory = {
    assets: [asset],
    stages: { size: { selectedAssetIds: [] } },
    logs: [],
  };
  const context = vm.createContext({
    factoryAssetHasCurrentProductPayload: () => false,
    factoryCompletedAssetsForCurrentStageRun: () => [asset],
    factoryLog(message, type, draft) {
      draft.logs.push({ message, type });
    },
    uniqueApiKeys: values => [...new Set(values.filter(Boolean))],
    saveLastWorkNow() {},
    render() {},
  });
  const assetUseSource = sourceSlice(
    core,
    'function factoryAssetIsCompletedCurrentSizeRun(',
    'function factoryToggleAssetReject(',
  );
  vm.runInContext(`${assetUseSource}\nthis.confirmAssetUse = factoryConfirmAssetUse; this.toggleAssetUse = factoryToggleAssetUse;`, context);

  assert.equal(context.confirmAssetUse(asset.id, { factory, skipRender: true }), true);
  assert.equal(asset.used, true);
  assert.deepEqual(factory.stages.size.selectedAssetIds, [asset.id]);

  assert.equal(context.toggleAssetUse(asset.id, factory, { render: false }), true);
  assert.equal(asset.used, false);
  assert.equal(context.toggleAssetUse(asset.id, factory, { render: false }), true);
  assert.equal(asset.used, true);
});

test('asset preview confirmation reports both success and rejection instead of silently doing nothing', async () => {
  const core = source('src/app-core-06.js');
  const helperSource = sourceSlice(
    core,
    'function factoryConfirmAssetFromPreview(',
    'function factoryCutPromptListForStage(',
  );
  const outcomes = [true, false, Promise.resolve(true)];
  const logs = [];
  const context = vm.createContext({
    factoryConfirmAssetUse() {
      return outcomes.shift();
    },
    factoryLog(message, type) {
      logs.push({ message, type });
    },
  });
  vm.runInContext(`${helperSource}\nthis.confirmFromPreview = factoryConfirmAssetFromPreview;`, context);
  const button = () => ({
    textContent: '이 컷 확정',
    disabled: false,
    title: '',
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  });

  const successButton = button();
  assert.equal(context.confirmFromPreview('asset-1', successButton), true);
  assert.equal(successButton.textContent, '확정됨');
  assert.equal(successButton.attrs['aria-pressed'], 'true');

  const rejectedButton = button();
  assert.equal(context.confirmFromPreview('asset-2', rejectedButton), false);
  assert.match(rejectedButton.textContent, /확정 불가/);
  assert.match(rejectedButton.title, /현재 작업/);

  const asyncButton = button();
  const pending = context.confirmFromPreview('asset-3', asyncButton);
  assert.equal(asyncButton.disabled, true);
  assert.equal(await pending, true);
  assert.equal(asyncButton.disabled, false);
  assert.equal(asyncButton.textContent, '확정됨');
  assert.deepEqual(logs, []);
});

test('asset preview hydrates its large image once and does not rescan every asset twice', () => {
  const core = source('src/app-core-06.js');
  const previewSource = sourceSlice(
    core,
    'function factoryOpenAssetPreview(',
    'function factoryAutomationCustomCutPrompts(',
  );

  assert.doesNotMatch(
    previewSource,
    /factory\.assets\.filter\(item => factoryPreviewableAssetImage\(item\)[\s\S]*factory\.assets\.filter\(item => factoryPreviewableAssetImage\(item\)\)/,
  );
  assert.equal((previewSource.match(/scheduleFactoryHydrateLightImages\(overlay\)/g) || []).length, 1);
  assert.equal((previewSource.match(/factoryHydrateLightImages\(overlay\)/g) || []).length, 1);
  assert.match(
    previewSource,
    /typeof scheduleFactoryHydrateLightImages === 'function'[\s\S]*else if \(typeof factoryHydrateLightImages === 'function'\)/,
  );
});

test('GENERATE-03: size preview keeps a preserved current-source archive visible when its canonical asset was pruned', () => {
  const factory = { assets: [], product: { productName: '낙지발노리개' } };
  let currentProductKey = '낙지발노리개';
  let currentSourceKey = 'input-image-1';
  const core5 = source('src/app-core-05.js');
  const helperSource = sourceSlice(
    core5,
    'function factoryPreviewOnlySizeAssets(',
    'function renderFactoryStageCard(',
  );
  const context = vm.createContext({
    state: {
      cuts: {
        sizePrompts: [{
          id: 'size-cut-1',
          label: '사이즈 안내컷 1',
          prompt: '현재 제품 사이즈 안내',
          result: 'http://127.0.0.1:5050/api/local-archive/assets/archive-size-1/image',
          assetId: 'factory-size-1',
          resultAssetId: 'factory-size-1',
          productKey: '낙지발노리개',
          sourceImageKey: 'input-image-1',
        }],
      },
    },
    factoryRuntimeReadFactory: () => factory,
    factoryCutPromptMatchesStage: (_cut, stageId) => stageId === 'size',
    cutsCurrentSourceImageKey: () => currentSourceKey,
    cutPromptSourceImageKey: cut => cut.sourceImageKey || '',
    cutPromptProductKey: cut => cut.productKey || '',
    factoryCurrentProductKey: () => currentProductKey,
    factoryJobProductKeysCompatible: (left, right) => left === right,
    factoryCutPromptResultDisplaySrc(cut, stageId, options) {
      assert.equal(stageId, 'size');
      assert.equal(options.requireCurrent, true);
      assert.equal(options.requireJob, false);
      assert.equal(options.factory, factory);
      return cut.result;
    },
  });
  vm.runInContext(`${helperSource}\nthis.previewOnlySizeAssets = factoryPreviewOnlySizeAssets;`, context);

  const assets = context.previewOnlySizeAssets(factory);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, 'factory-size-1');
  assert.equal(assets[0].previewOnly, true);
  assert.equal(assets[0].image, 'http://127.0.0.1:5050/api/local-archive/assets/archive-size-1/image');
  assert.equal(factory.assets.length, 0, 'preview fallback must not mutate canonical factory assets');

  currentSourceKey = '';
  assert.equal(context.previewOnlySizeAssets(factory).length, 0, 'missing current input identity must reject the preserved result');
  currentSourceKey = 'input-image-2';
  assert.equal(context.previewOnlySizeAssets(factory).length, 0, 'another input image must not reuse the preserved result');
  currentSourceKey = 'input-image-1';
  context.state.cuts.sizePrompts[0].sourceImageKey = '';
  assert.equal(context.previewOnlySizeAssets(factory).length, 0, 'missing prompt input identity must reject the preserved result');
  context.state.cuts.sizePrompts[0].sourceImageKey = 'input-image-1';

  currentProductKey = '';
  assert.equal(context.previewOnlySizeAssets(factory).length, 0, 'missing current product identity must reject the preserved result');
  currentProductKey = '다른상품';
  assert.equal(context.previewOnlySizeAssets(factory).length, 0, 'another product must not reuse the preserved result');
  currentProductKey = '낙지발노리개';
  context.state.cuts.sizePrompts[0].productKey = '';
  assert.equal(context.previewOnlySizeAssets(factory).length, 0, 'missing prompt product identity must reject the preserved result');
  context.state.cuts.sizePrompts[0].productKey = '낙지발노리개';
  assert.equal(context.previewOnlySizeAssets(factory).length, 1, 'matching product and input identities restore preview access');

  const cardContext = vm.createContext({
    FACTORY_LIGHT_IMAGE_PRIORITY_LIMIT: 4,
    factoryVisibleAssetTitle: value => value,
    factoryAssetDisplayImage: asset => asset.image || '',
    renderFactoryLightImage: () => '<img>',
    escapeHtml: value => String(value ?? ''),
    escAttr: value => String(value ?? ''),
  });
  const cardSource = sourceSlice(
    core5,
    'function renderFactoryStageResults(',
    'function renderFactoryAssetCard(',
  );
  vm.runInContext(`${cardSource}\nthis.renderResults = renderFactoryStageResults;`, cardContext);
  const cardMarkup = cardContext.renderResults({ id: 'size', label: '사이즈이미지' }, factory, assets, 0);
  assert.match(cardMarkup, /draggable="false"/);
  assert.match(cardMarkup, /data-factory-preview-asset="factory-size-1"/);
  assert.match(cardMarkup, /disabled[^>]*>보기 전용<\/button>/);
  assert.doesNotMatch(cardMarkup, /data-factory-asset-use=/);
  assert.doesNotMatch(cardMarkup, /data-factory-send=/);

  let appendedOverlay = null;
  let keyHandler = null;
  let confirmed = 0;
  let sent = 0;
  let rendered = 0;
  const previewContext = vm.createContext({
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', className: '', innerHTML: '', onclick: null, remove() {} }),
      body: { appendChild: overlay => { appendedOverlay = overlay; } },
      addEventListener: (type, handler) => { if (type === 'keydown') keyHandler = handler; },
      removeEventListener() {},
    },
    factoryRuntimeReadFactory: () => factory,
    factoryPreviewOnlySizeAssets: () => assets,
    factoryPreviewableAssetImage: asset => asset?.image || '',
    factoryStageLabel: () => '사이즈이미지',
    renderFactoryLightImage: () => '<img>',
    escapeHtml: value => String(value ?? ''),
    escAttr: value => String(value ?? ''),
    factoryLog() {},
    factoryConfirmAssetFromPreview: () => { confirmed += 1; },
    factorySendAssetToStage: () => { sent += 1; },
    render: () => { rendered += 1; },
  });
  const previewSource = sourceSlice(
    source('src/app-core-06.js'),
    'function factoryOpenAssetPreview(',
    'function factoryAutomationCustomCutPrompts(',
  );
  vm.runInContext(`${previewSource}\nthis.openPreview = factoryOpenAssetPreview;`, previewContext);
  previewContext.openPreview('factory-size-1');
  assert.ok(appendedOverlay, 'preview-only modal must render');
  assert.match(appendedOverlay.innerHTML, /보관 원본 보기 전용/);
  assert.doesNotMatch(appendedOverlay.innerHTML, /factoryAssetPreviewConfirm/);
  assert.doesNotMatch(appendedOverlay.innerHTML, /factoryAssetPreviewSend/);
  assert.equal(typeof keyHandler, 'function');
  keyHandler({ key: 'Enter', preventDefault() {} });
  assert.equal(confirmed, 0, 'Enter must not confirm a preview-only asset');
  assert.equal(sent, 0, 'preview-only modal must not send an asset to another stage');
  assert.equal(rendered, 0, 'preview-only modal must not change stage status or selection');
  assert.equal(factory.assets.length, 0, 'preview-only interaction must not persist a canonical asset');
});

test('goal heartbeat stops quietly when its owned draft proxy has been revoked', () => {
  const core = source('src/app-core-06.js');
  let tick = null;
  let cleared = 0;
  const context = vm.createContext({
    Date,
    setInterval(callback) {
      tick = callback;
      return 41;
    },
    clearInterval(handle) {
      assert.equal(handle, 41);
      cleared += 1;
    },
    factoryRuntimeReadFactory: () => ({ goalRun: { running: false } }),
    factorySetGoalRunProgress() {},
  });
  const heartbeatSource = sourceSlice(
    core,
    'const FACTORY_GOAL_PROGRESS_LOG_INTERVAL_MS',
    'let factoryStandaloneGoalOperationSequence',
  );
  vm.runInContext(`${heartbeatSource}\nthis.startHeartbeat = factoryStartGoalHeartbeat;`, context);
  const { proxy, revoke } = Proxy.revocable({ goalRun: { running: true } }, {});
  context.startHeartbeat('VM 상세페이지 수집 중', 54, 70, 5000, { factory: proxy });
  revoke();

  assert.equal(typeof tick, 'function');
  assert.doesNotThrow(() => tick());
  assert.equal(cleared, 1);
});

test('VM candidate heartbeat never falls back to a full render when no partial patch target exists', () => {
  const core = source('src/app-core-06.js');
  let fullRenders = 0;
  const context = vm.createContext({
    document: {
      querySelectorAll() {
        return [];
      },
    },
    render() {
      fullRenders += 1;
    },
  });
  const helperSource = sourceSlice(
    core,
    'function compMarketRefreshVmCandidateBridgeView(',
    'async function compMarketTryVmCandidateBridgeSearch(',
  );
  vm.runInContext(`${helperSource}\nthis.refreshVmBridge = compMarketRefreshVmCandidateBridgeView;`, context);

  for (let index = 0; index < 8; index += 1) {
    assert.equal(context.refreshVmBridge({ automation: { activeTab: 'db' } }), false);
  }
  assert.equal(fullRenders, 0, 'a polling fallback must not trigger full app renders');
});

test('detail rail reports processed candidates instead of staying at five percent', () => {
  const core = source('src/app-core-05.js');
  const context = vm.createContext({
    FACTORY_PARALLEL_PROGRESS_DEFS: [],
    factoryParallelTaskProgressView: () => ({}),
    factoryUsableAssetsForStage: () => [],
  });
  const progressSource = sourceSlice(
    core,
    'function factoryStageProgressView(',
    'function renderFactoryStageProgress(',
  );
  vm.runInContext(`${progressSource}\nthis.detailProgress = factoryStageProgressView;`, context);

  assert.equal(context.detailProgress(
    { id: 'detail' },
    { stages: { detail: { status: 'running', completedItemCount: 1, targetCount: 2 } } },
  ), 50);
  assert.equal(context.detailProgress(
    { id: 'detail' },
    { stages: { detail: { status: 'review', completedItemCount: 2, targetCount: 2 } } },
  ), 100);
});

test('detail rail summary never renders more recovered images than its denominator', () => {
  const core = source('src/app-core-05.js');
  const context = vm.createContext({
    state: {
      compPage: {
        marketScrape: {
          scrapedImages: [{ id: 'detail-1' }, { id: 'detail-2' }],
        },
      },
    },
    compMarketCurrentWorkScope: () => ({}),
    compMarketFilterScrapedImagesForCurrentWork: images => images,
    factoryUsableAssetsForStage: () => [],
  });
  const summarySource = sourceSlice(
    core,
    'function factoryStageRailMeta(',
    'const FACTORY_PARALLEL_PROGRESS_DEFS',
  );
  vm.runInContext(`${summarySource}\nthis.detailSummary = factoryStageRailMeta;`, context);

  assert.equal(context.detailSummary(
    { id: 'detail' },
    { stages: { detail: { targetCount: 1 } } },
    { detail: [] },
  ), '2/2개 · 로그 0건');
});

test('explicit recent VM image recovery can use current-product fallback without weakening automatic recovery', () => {
  const bridge = source('src/app-core-03.js');
  const core = source('src/app-core-06.js');
  const capabilitySource = sourceSlice(
    bridge,
    'recoverDetailImages()',
    'reloadDetailImages()',
  );
  const recoverySource = sourceSlice(
    core,
    'async function recoverCompMarketDetailImagesFromHistory(',
    'let compMarketAutoRecoverDetailImagesKey',
  );

  assert.match(capabilitySource, /allowProductFallback:\s*true/);
  assert.match(recoverySource, /options\.allowProductFallback/);
  assert.doesNotMatch(recoverySource, /!operation && options\.allowProductFallback/);
  assert.match(recoverySource, /compMarketStampRowsWithCurrentWork/);
  assert.match(recoverySource, /const currentScopedRecovered = typeof compMarketStampRowsWithCurrentWork/);
  assert.match(recoverySource, /compMarketFilterScrapedImagesForCurrentWork\(currentScopedRecovered/);
  assert.match(recoverySource, /const bridgeScope = productFallback/);
  assert.match(recoverySource, /productKey:\s*bridgeCurrentScope\.productKey/);
  assert.match(recoverySource, /\{ productFallback \}/);
  assert.match(recoverySource, /compMarketRecoverDetailBridgePayload\(\s*market,\s*bridgeScope,/);
  assert.match(core, /\/api\/vm-detail-captures\/recent\?/);
  assert.match(core, /\['currentRunId', 'productKey', 'inputImageFingerprint', 'stageId'\]/);
  assert.match(core, /const scopeFields = productFallback/);
  assert.match(core, /\? \['productKey'\]/);
  assert.match(core, /currentScope && typeof currentScope === 'object'/);
  assert.doesNotMatch(core, /if \(!directJobIds\.length\)/);
  assert.match(core, /compMarketExtractDetailImages\(payload,\s*market\.results\)\.length > 0/);
  assert.match(core, /compMarketDetailJobInfo\(payload\)\.manual/);
  assert.match(recoverySource, /bridgeRecovery\?\.payload\s*\|\|\s*compMarketFilterDetailHistoryPayload/);
  assert.match(recoverySource, /recovered_from_vm_detail_bridge:\s*!!bridgeRecovery/);
  assert.match(recoverySource, /bridgeRecovery\?\.jobId\s*\|\|\s*market\.detailJobId/);
  assert.match(recoverySource, /const factory = options\.factory/);
  assert.match(recoverySource, /\{ factory, saveLastWork: false, savePersistentState: false \}/);
  assert.match(recoverySource, /ensureCompMarketScrapeState\(recoveryStateOptions\)/);
  assert.match(recoverySource, /compMarketSave\(factory[\s\S]*recoveryStateOptions[\s\S]*\{ saveLastWork: false \}/);
});

test('history recovery synchronizes the detail rail as reviewed completion', async () => {
  const core = source('src/app-core-06.js');
  const factoryDraft = {
    stages: { detail: { status: 'running', targetCount: 2, completedItemCount: 0 } },
  };
  const competitorDraft = {
    compPage: {},
  };
  const commands = [];
  const context = vm.createContext({
    Date: { now: () => 20 },
    compMarketDetailJobInfo() {
      return { total: 2, completed: 1, failed: 1, manual: false };
    },
    factoryRuntimeDetachedValue(value) {
      return JSON.parse(JSON.stringify(value));
    },
    factoryRuntimeUpdateOwnedFactory(command, owner, mutate) {
      assert.equal(owner, 'competitors');
      commands.push(command);
      mutate(command === 'factory/competitor:syncDetailMarket' ? competitorDraft : factoryDraft);
      return { ok: true };
    },
  });
  const syncSource = sourceSlice(
    core,
    'async function compMarketSyncRecoveredDetailProgress(',
    'async function recoverCompMarketDetailImagesFromHistory(',
  );
  assert.doesNotMatch(syncSource, /draft\.stages\s*=/);
  vm.runInContext(`${syncSource}\nthis.syncRecovered = compMarketSyncRecoveredDetailProgress;`, context);

  await context.syncRecovered({
    scrapedImages: [{ id: 'detail-1' }],
    detailOperation: { selectedIds: ['candidate-1', 'candidate-2'] },
  }, {
    detailPayload: { tasks: [] },
  });

  assert.deepEqual(commands, [
    'factory/competitor:syncDetailMarket',
    'factory/competitor:syncRecoveredDetailProgress',
  ]);
  assert.equal(factoryDraft.stages.detail.targetCount, 2);
  assert.equal(factoryDraft.stages.detail.completedItemCount, 2);
  assert.equal(factoryDraft.stages.detail.status, 'blocked');
  assert.match(factoryDraft.stages.detail.message, /상세페이지 이미지 1장/);
  assert.equal(competitorDraft.compPage.marketScrape.scrapedImages.length, 1);
});

test('suppressed VM progress saves do not write candidate or image selection persistence', () => {
  const core = source('src/app-core-06.js');
  const saveSource = sourceSlice(
    core,
    'function compMarketSave(',
    'function compMarketSetStatus(',
  );
  const calls = {
    candidate: 0,
    selection: 0,
    analysis: [],
    lastWork: 0,
  };
  const context = vm.createContext({
    state: {
      compPage: {
        analysisResult: null,
        sectionPlan: null,
        planEdits: {},
      },
    },
    ensureCompMarketScrapeState() {
      return { selectedIds: ['candidate-1'], selectedImageIds: ['image-1'] };
    },
    compMarketPersistCandidateSnapshot() {
      calls.candidate += 1;
    },
    compMarketPersistImageSelection() {
      calls.selection += 1;
    },
    saveCompAnalysis(_analysis, _plan, _edits, options) {
      calls.analysis.push(options);
    },
    saveLastWorkNow() {
      calls.lastWork += 1;
    },
  });
  vm.runInContext(`${saveSource}\nthis.compMarketSave = compMarketSave;`, context);

  context.compMarketSave({ savePersistentState: false, saveLastWork: false });
  assert.equal(calls.candidate, 0);
  assert.equal(calls.selection, 0);
  assert.equal(calls.lastWork, 0);
  assert.equal(calls.analysis.length, 1);
  assert.equal(calls.analysis[0].skipPersistentState, true);

  context.compMarketSave();
  assert.equal(calls.candidate, 1);
  assert.equal(calls.selection, 1);
  assert.equal(calls.lastWork, 1);
  assert.equal(calls.analysis.length, 2);
  assert.equal(calls.analysis.at(-1).skipPersistentState, false);
});

test('assets size generation uses the immediate stage-button feedback path', () => {
  const core = source('src/app-core-03.js');
  const actions = sourceSlice(
    core,
    'function factoryRuntimeAssetsActions()',
    'function factoryRuntimeSectionsActions()',
  );

  assert.match(actions, /runFactoryStage\(stageId, operationContext\)[\s\S]*factoryHandleRunStageButton/);
});

test('competitor image preview stays rendered while the full VM panel is expanded', () => {
  const view = source('src/menus/factory/tabs/competitor-tab-view.mjs');
  const runtime = source('src/app-core-03.js');
  const legacyView = source('src/app-core-05.js');

  assert.match(view, /renderScrapedImagePicker\(model,\s*helpers,\s*true\)/);
  assert.doesNotMatch(view, /renderScrapedImagePicker\(model,\s*helpers,\s*!showFullPanel\)/);
  assert.match(view, /renderCompMarketScrapePanel\(model\.snapshot,\s*market,\s*\{\s*includePreviewModal:\s*false\s*\}\)/);
  assert.match(runtime, /renderCompMarketScrapePanel:\s*\(snapshot,\s*market,\s*options\)\s*=>\s*renderCompMarketScrapePanel\(snapshot,\s*market,\s*options\)/);
  assert.match(legacyView, /function renderCompMarketScrapePanel\(snapshot = null,\s*marketOverride = null,\s*options = \{\}\)/);
  assert.match(legacyView, /marketOverride && typeof marketOverride === 'object'/);
  assert.match(legacyView, /function renderCompMarketScrapedImagesPanel\(marketOverride = null,\s*options = \{\}\)/);
  assert.match(legacyView, /options\.includePreviewModal === false/);
  assert.match(legacyView, /renderCompMarketScrapedImagesPanel\(market,\s*options\)/);
});

test('recovered current-product images remain directly selectable when no active detail operation exists', () => {
  const imagesView = source('src/menus/factory/tabs/competitor-tab-images.mjs');

  assert.match(imagesView, /const selectableImages = currentImages\.length \? currentImages : previousImages/);
  assert.match(imagesView, /const selectable = new Set\(selectableImages\.map/);
  assert.match(imagesView, /selectableImage \? `<button class="btn-sm" type="button" data-comp-market-toggle-image=/);
  assert.match(imagesView, /복구 이미지 \$\{previousImages\.length\}장/);
});

test('live competitor image selection overrides a stale supplied summary count', async () => {
  const url = pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/competitor-tab-model.mjs'));
  url.searchParams.set('live-selection-count', `${Date.now()}-${Math.random()}`);
  const { createCompetitorTabView } = await import(url.href);

  const view = createCompetitorTabView({
    factory: { automationCounts: { selectedAnalysisImages: 0 } },
    competitors: {
      compPage: {
        marketScrape: {
          selectedImageIds: ['detail:image-1'],
        },
      },
    },
  });

  assert.equal(view.counts.selectedAnalysisImages, 1);
});

test('factory competitor controls retain an owner-routed click fallback after tab rerenders', () => {
  const core = source('src/app-core-06.js');
  const payloadSource = sourceSlice(
    core,
    'function factoryCompetitorDelegatedMarketPayload(',
    'registerBindEventExtension(function bindFactoryEvents()',
  );
  const delegatedSource = sourceSlice(
    core,
    "const factoryPageRoot = document.querySelector('.factory-page')",
    'const factoryWorkspaceProjectName',
  );

  assert.match(delegatedSource, /document\.getElementById\('factoryAutomationWizard'\)/);
  assert.match(payloadSource, /\[data-comp-market-toggle-image\]/);
  assert.match(payloadSource, /\[data-comp-market-preview-image\]/);
  assert.match(payloadSource, /\[data-comp-market-quick-action\]/);
  assert.match(payloadSource, /const previewDialog = node\?\.closest\?\.\('\[role="dialog"\]\[aria-label="상세페이지 이미지 크게보기"\]'\)/);
  assert.match(payloadSource, /\(!root\?\.contains\?\.\(node\) && !previewDialog\)/);
  assert.match(payloadSource, /node\.closest\?\.\('\[data-factory-competitor-tab\]'\)/);
  assert.match(delegatedSource, /const factoryDelegationHost = document\.documentElement/);
  assert.match(delegatedSource, /const currentFactoryPageRoot = document\.querySelector\('\.factory-page'\)/);
  assert.match(delegatedSource, /factoryCompetitorDelegatedMarketPayload\(target,\s*currentFactoryPageRoot\)/);
  assert.match(delegatedSource, /!event\.defaultPrevented/);
  assert.match(delegatedSource, /factoryRuntimeCompetitorMarketAction\(marketPayload\)/);
  assert.match(
    delegatedSource,
    /document\.addEventListener\('click', event => \{[\s\S]*?\n    \}, true\);/,
    'the owner-routed fallback must stay on the stable document capture surface across tab rerenders',
  );
});

test('synchronous competitor selections patch only the active factory tab', () => {
  const core = source('src/app-core-03.js');
  const bridgeSource = sourceSlice(
    core,
    'function factoryRuntimeBridgeAction(',
    'function factoryRuntimeWithOperationLease(',
  );
  const actionSource = sourceSlice(
    core,
    'function factoryRuntimeCompetitorMarketAction(',
    'function factoryRuntimeCompetitorHelpers()',
  );

  assert.match(bridgeSource, /factoryPatchAutomationWizardTab\(factoryRuntimeReadFactory\(\),\s*patchTab\)/);
  assert.match(bridgeSource, /factoryPatchAutomationCompetitorSelection\(factoryRuntimeReadFactory\(\)\)/);
  assert.match(bridgeSource, /if \(!patched\) render\(\)/);
  assert.match(actionSource, /\?\s*'competitor-selection'\s*:\s*'competitor'/);
  const uiSource = source('src/app-core-06.js');
  const selectionPatchSource = sourceSlice(
    uiSource,
    'function factoryPatchAutomationCompetitorSelection(',
    'function factoryPatchAutomationAssetsTab(',
  );
  // 경쟁사 '선택' 패치가 대상으로 삼는 것은 후보 선택 패널이다.
  // (#factoryCompetitorImagePicker 는 이미지 선택용 별도 패널이라 여기서 안 건드린다.)
  assert.match(selectionPatchSource, /#factoryCompetitorPickerPanel/);
  assert.match(selectionPatchSource, /#factoryCompetitorStatusPanel/);
  assert.match(selectionPatchSource, /#factoryCompetitorVmPanel/);
  assert.match(selectionPatchSource, /aria-label="상세페이지 이미지 크게보기"/);
  assert.match(selectionPatchSource, /document\.body\.appendChild\(nestedPreview\)/);
  assert.match(selectionPatchSource, /mountedPreview\.remove\(\)/);
  assert.match(selectionPatchSource, /factoryRuntimeCompetitorTab\.render/);
  assert.doesNotMatch(selectionPatchSource, /renderFactoryAutomationPanel/);
  assert.doesNotMatch(selectionPatchSource, /factory-automation-body/);
  const competitorViewSource = source('src/menus/factory/tabs/competitor-tab-view.mjs');
  assert.match(
    competitorViewSource,
    /id="factoryCompetitorStatusPanel"[\s\S]*?<h4 style="margin:0">현재 상태<\/h4>/,
    'the partial patch id must wrap the live count cards rather than the preceding guide panel',
  );
  const delegatedClickSource = sourceSlice(
    uiSource,
    "document.addEventListener('click'",
    'const factoryWorkspaceProjectName',
  );
  assert.match(delegatedClickSource, /shouldRefreshSelectionSummary/);
  assert.match(
    delegatedClickSource,
    /requestAnimationFrame\(\(\) => \{\s*factoryPatchAutomationCompetitorSelection\(factoryRuntimeReadFactory\(\)\)/,
    'the capture-phase owner handler must refresh the summary after the command receipt commits',
  );
});

test('competitor preview portal is removed when the active factory tab changes', () => {
  const uiSource = source('src/app-core-06.js');
  const portalSource = sourceSlice(
    uiSource,
    'function factoryRemoveCompetitorPreviewPortal()',
    'function factoryPatchAutomationAssetsTab(',
  );
  let removed = 0;
  const preview = {
    remove() {
      removed += 1;
    },
  };
  const context = vm.createContext({
    document: {
      body: {
        querySelector() {
          return preview;
        },
      },
    },
  });
  vm.runInContext(
    `${portalSource}\nthis.patchCompetitor = factoryPatchAutomationCompetitorSelection;`,
    context,
  );

  assert.equal(context.patchCompetitor({ automation: { activeTab: 'assets' } }), false);
  assert.equal(removed, 1);
});

test('competitor image actions report rejected commands instead of failing silently', () => {
  const tab = source('src/menus/factory/tabs/competitor-tab.mjs');
  const bind = sourceSlice(
    tab,
    '    bind(root) {',
    '    onEnter()',
  );

  assert.match(bind, /runtime\.reportError/);
});

test('Gmarket manual retry scopes the failed candidate and uses the authenticated create-detail path', () => {
  const core = source('src/app-core-06.js');
  const apiConfig = sourceSlice(
    core,
    'const JEPUM_MARKET_API =',
    'function compMarketNow()',
  );
  const resume = sourceSlice(
    core,
    'function compMarketManualRetryCandidateIds(',
    'async function compMarketResumeDetailJob()',
  );
  const retryAction = sourceSlice(
    core,
    'async function compMarketResumeDetailJob()',
    'async function reloadCompMarketDetailImagesFromCurrentJob()',
  );
  const detailCapture = sourceSlice(
    core,
    'async function runCompMarketDetailCapture(',
    'async function compMarketResumeDetailJob()',
  );
  const detailOperationGuard = sourceSlice(
    core,
    'function compMarketBeginDetailOperation(',
    'function compMarketAssertDetailOperationCurrent(',
  );
  const vmDetailReadiness = sourceSlice(
    core,
    'async function compMarketEnsureVmDetailCaptureReady(',
    'async function compMarketOpenVisibleVmCapture(',
  );
  const vmCaptureStatus = sourceSlice(
    core,
    'function compMarketRememberVmCaptureStatus(',
    'function compMarketVmStatusText(',
  );
  const detailImageSource = sourceSlice(
    core,
    'function compMarketDetailImageSrc(',
    'function compMarketNormalizeDetailImagePath(',
  );
  const runtimeBridgeSource = source('src/app-core-03.js');
  const competitorGuideBridge = sourceSlice(
    runtimeBridgeSource,
    'function factoryRuntimeCompetitorGuideAction(',
    'function factoryRuntimeCompetitorDraft(',
  );
  const shellGuideDelegation = source('src/menus/factory/factory-menu-shell.mjs');
  const viewSource = source('src/app-core-05.js');
  const compactView = sourceSlice(
    viewSource,
    'function renderFactoryManualInterventionPrompt(',
    'function renderFactoryAutomationRunStatus(',
  );
  const fullView = sourceSlice(
    viewSource,
    'function renderCompMarketManualInterventionPanel(',
    'function renderCompMarketRunningPanel(',
  );
  const legacyManual = sourceSlice(
    viewSource,
    'function compMarketLegacyManualInterventionFromText(',
    'const COMP_MARKET_CANDIDATE_SNAPSHOT_STORAGE_KEY',
  );

  assert.doesNotMatch(apiConfig, /resumeDetail:/);
  assert.match(resume, /intervention\.productId/);
  assert.match(resume, /platformCandidates\.length === 1/);
  assert.match(retryAction, /runCompMarketDetailCapture\(retryIds,\s*\{\s*runtime:\s*'vm',\s*selectionMode:\s*'subset',\s*reuseVmSearchSession:\s*false/);
  assert.match(retryAction, /market\.manualIntervention = null/);
  assert.doesNotMatch(retryAction, /detail-captures\/.*resume|endpoints\.resumeDetail|fetch\(/);
  assert.match(detailCapture, /execution_profile:\s*'ui_parity'/);
  assert.match(detailCapture, /browser_visibility:\s*'visible'/);
  assert.match(detailCapture, /options\.reuseVmSearchSession === false/);
  assert.match(detailCapture, /options\.reuseVmSearchSession === false \? \{\} : \{ source_session_id:\s*searchId \}/);
  assert.match(
    detailCapture,
    /if \(runtime === 'vm' && !idsBySearch\.size\) \{\s*const fallbackSearchId = String\(market\.vmSearchId \|\| market\.searchId \|\| ''\)\.trim\(\);\s*idsBySearch\.set\(fallbackSearchId, \[\.\.\.ids\]\);\s*\}/,
  );
  assert.match(detailCapture, /compMarketFetchVmCandidateBridge\('\/api\/vm-detail-capture'/);
  assert.match(detailCapture, /compMarketFetchVmCandidateBridge\(`\/api\/vm-detail-capture\/\$\{encodeURIComponent\(jobId\)\}`/);
  assert.doesNotMatch(detailCapture, /compMarketFetchJson\((?:'|`)\/api\/vm-detail-capture/);
  assert.match(detailCapture, /workingFactory/);
  assert.match(detailCapture, /publishProgress:\s*publishDetailProgress/);
  assert.match(detailCapture, /typeof options\.publishProgress === 'function'/);
  assert.match(detailCapture, /factoryRuntimeUpdateOwnedFactory\(\s*actionName,[\s\S]*factoryRuntimeUpdateOwnedFactory\(\s*'factory\/competitor:syncDetailMarket'/);
  assert.match(detailCapture, /const detailPollLimit = runtime === 'vm' \? 225 : 120/);
  assert.match(detailCapture, /if \(!manualStatusDetected && !detailReachedTerminal\)/);
  assert.doesNotMatch(detailCapture, /대기 \$\{i \+ 1\}\/120/);
  assert.doesNotMatch(
    detailCapture,
    /factoryRuntimeUpdateOwnedFactory\([\s\S]{0,220}draft\s*=>\s*runCompMarketDetailCapture/,
  );
  assert.ok(core.includes('/^\\/api\\/vm-detail-capture\\/[^/]+\\/artifacts\\/\\d+$/i'));
  assert.match(detailImageSource, /compMarketVmCandidateBridgeBaseUrl\(\)\}\$\{text\}/);
  assert.match(detailOperationGuard, /selectionMode:\s*options\.selectionMode === 'subset' \? 'subset' : 'exact'/);
  assert.match(detailOperationGuard, /operation\.selectionMode === 'subset'/);
  assert.match(vmDetailReadiness, /async function compMarketEnsureVmDetailCaptureReady\(options = \{\}\)/);
  assert.match(vmDetailReadiness, /const marketOptions = \{\s*factory: options\.factory,\s*saveLastWork: options\.saveLastWork,\s*savePersistentState: options\.savePersistentState,\s*\}/);
  assert.match(vmDetailReadiness, /compMarketSetStatus\([\s\S]*marketOptions\)/);
  assert.match(vmDetailReadiness, /compMarketRememberVmCaptureStatus\(data \|\| \{\}, marketOptions\)/);
  assert.match(vmDetailReadiness, /typeof options\.renderProgress === 'function'/);
  assert.match(vmCaptureStatus, /function compMarketRememberVmCaptureStatus\(data = \{\}, options = \{\}\)/);
  assert.match(vmCaptureStatus, /ensureCompMarketScrapeState\(options\)/);
  assert.match(detailCapture, /compMarketEnsureVmDetailCaptureReady\(\{\s*factory,\s*saveLastWork: false,\s*savePersistentState: false,\s*renderProgress: renderDetailProgress,\s*\}\)/);
  assert.match(compactView, /멈춘 후보 다시 수집/);
  assert.match(fullView, /멈춘 후보 다시 수집/);
  assert.doesNotMatch(`${compactView}\n${fullView}\n${legacyManual}`, /같은 작업 재개/);
  assert.match(compactView, /id="compMarketManualOpenVmCompact"/);
  assert.match(compactView, /id="compMarketManualResumeCompact"/);
  assert.match(fullView, /id="compMarketManualOpenVm"[^>]+data-factory-guide-action="open-vm-capture"/);
  assert.match(fullView, /id="compMarketManualResume"[^>]+data-factory-guide-action="resume-comp-market-detail"/);
  assert.doesNotMatch(`${compactView}\n${fullView}`, /onclick="return window\.factoryShellGuideActionButtonInline\(this,event\)"/);
  assert.match(competitorGuideBridge, /runFactoryShellGuideAction\(action\)/);
  assert.match(competitorGuideBridge, /compMarketManualRetryCandidateIds\(market\)/);
  assert.match(competitorGuideBridge, /runCompMarketDetailCapture\(receipt\.value,\s*\{\s*runtime:\s*'vm',\s*selectionMode:\s*'subset',\s*reuseVmSearchSession:\s*false,\s*operationToken:\s*receipt\.operationToken/);
  assert.doesNotMatch(competitorGuideBridge, /compMarketResumeDetailJob\(/);
  assert.match(shellGuideDelegation, /target\?\.closest\?\.\('\[data-factory-guide-action\]'\)/);
  // 지키려는 것은 "껍데기가 직접 일하지 않고 guide-action 경계로 넘긴다" 이다.
  // 2026-08-30 사이트 하나만 다시 수집하는 기능이 생기면서 어느 사이트인지도 함께 넘긴다
  // ({ action, site }). 경계는 그대로이므로 호출 모양만 넓힌다.
  assert.match(shellGuideDelegation, /handlers\.runGuideAction\?\.\(/);
  assert.match(shellGuideDelegation, /site \? \{ action, site \} : action/,
    '사이트 정보를 안 넘기면 사이트별 다시 수집이 어느 사이트인지 모릅니다.');
  assert.match(shellGuideDelegation, /event\?\.preventDefault\?\.\(\)/);
  assert.match(runtimeBridgeSource, /function runFactoryShellGuideAction[\s\S]*factoryRuntimeReportError\(error\)[\s\S]*render\(\)/);
});

test('VM detail readiness uses the direct bridge and a background paint wait cannot block the request', async () => {
  const core = source('src/app-core-06.js');
  const readinessSource = sourceSlice(
    core,
    'async function compMarketEnsureVmDetailCaptureReady(',
    'async function compMarketOpenVisibleVmCapture(',
  );
  const paintSource = sourceSlice(
    core,
    'function waitForNextPaint()',
    'let html2CanvasLoader = null;',
  );
  const market = { route: '저장소 공유폴더 브리지' };
  const bridgePaths = [];
  const context = vm.createContext({
    setTimeout(callback) {
      Promise.resolve().then(callback);
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame: undefined,
    compMarketSetStatus() {},
    compMarketLog() {},
    compMarketSave() {},
    render() {},
    async compMarketFetchVmCandidateBridge(path) {
      bridgePaths.push(path);
      return { status: 'ok', service: 'kuasangse-public-automation-api' };
    },
    compMarketRememberVmCaptureStatus(data) {
      market.vmCaptureStatus = data;
    },
    ensureCompMarketScrapeState() {
      return market;
    },
    compMarketVmStatusText() {
      return 'VM 상세수집 켜짐 · 워커 연결됨';
    },
  });
  vm.runInContext(
    `${readinessSource}\n${paintSource}\nthis.ensureVmDetailReady = compMarketEnsureVmDetailCaptureReady;\nthis.waitForNextPaint = waitForNextPaint;`,
    context,
  );

  const readiness = await context.ensureVmDetailReady();
  await context.waitForNextPaint();

  assert.deepEqual(bridgePaths, ['/health']);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.runtime, 'vm');
  assert.equal(market.vmCaptureStatus.transport, 'shared_folder');
  assert.match(market.route, /VM 상세수집/);
});

test('embedded full competitor controls dispatch through the factory-owned quick-action boundary', () => {
  const runtime = source('src/app-core-03.js');
  const legacyRuntime = source('src/app-core-06.js');
  const actionSource = sourceSlice(
    runtime,
    'function factoryRuntimeCompetitorMarketAction(',
    'function factoryRuntimeCompetitorHelpers(',
  );
  const view = source('src/app-core-05.js');

  assert.match(view, /id=\"compMarketReloadSearchResults\"[^>]+data-comp-market-quick-action=\"reload\"/);
  assert.match(view, /id=\"compMarketRecoverDetailImages\"[^>]+data-comp-market-quick-action=\"recover-images\"/);
  assert.match(view, /id=\"compMarketDetailSelected\"[^>]+data-comp-market-quick-action=\"detail-vm\"/);
  assert.match(view, /id=\"compMarketDetailSelectedLocal\"[^>]+data-comp-market-quick-action=\"detail-local\"/);
  assert.match(view, /id=\"compMarketSelectAllCandidates\"[^>]+data-comp-market-quick-action=\"select-all\"/);
  assert.match(view, /id=\"compMarketClearCandidateSelection\"[^>]+data-comp-market-quick-action=\"clear-selection\"/);
  assert.match(actionSource, /quickAction === 'recover-images'[\s\S]*syncFactory:\s*true,[\s\S]*factory:\s*recoveryFactory/);
  assert.match(actionSource, /quickAction === 'recover-images'[\s\S]*recoverCompMarketDetailImagesFromHistory\([\s\S]*factoryRuntimeUpdateOwnedFactory\([\s\S]*factory\/competitor:syncDetailMarket/);
  assert.match(actionSource, /quickAction === 'open-vm-login'[\s\S]*compMarketOpenVmLoginSession\(\)/);
  const legacyActionSource = sourceSlice(
    legacyRuntime,
    'function handleCompMarketQuickActionClick(',
    'function handleFactoryGenerationFallbackClick(',
  );
  assert.match(legacyActionSource, /handledActions = \[[\s\S]*'recover-images'/);
  assert.match(legacyActionSource, /action === 'recover-images'[\s\S]*recoverCompMarketDetailImagesFromHistory\(\{[\s\S]*allowProductFallback: true,[\s\S]*syncFactory: true/);
  assert.match(actionSource, /\['detail-vm', 'detail-local', 'detail-scrapling'\]\.includes\(quickAction\)[\s\S]*selectionVersion:[\s\S]*const selectionSnapshot = receipt\.value[\s\S]*runCompMarketDetailCapture\(selectedIds,[\s\S]*selectionSnapshot/);
});

test('VM detail scope uses the competitors stage run when the workflow run is not initialized', () => {
  const core = source('src/app-core-06.js');
  const scopeSource = sourceSlice(
    core,
    'function factoryCompetitorCandidateScopePayload(',
    'function factoryMarkAssistedVmCandidateRows(',
  );
  const context = vm.createContext({
    state: { productName: '' },
    cleanDbSearchTerm: value => String(value || '').trim(),
    factoryWizardDbSearchQueryFromInput: () => '',
    factoryCurrentProductKey: () => 'vm-product-1',
    factoryCurrentInputImageFingerprint: () => 'vm-image-1',
    factoryCurrentWorkflowRunId: () => '',
    factoryCurrentStageRunId: () => 'competitors-stage-run-1',
  });
  vm.runInContext(`${scopeSource}\nthis.scopeForVmCandidates = factoryCompetitorCandidateScopePayload;`, context);

  const scope = context.scopeForVmCandidates('competitors', {
    product: { productName: '모시 꽃 자수 파우치' },
    stages: { competitors: { currentRunId: 'competitors-stage-run-1' } },
  });

  assert.equal(scope.currentRunId, 'competitors-stage-run-1');
  assert.equal(scope.scopeKey, 'competitors-stage-run-1::vm-product-1::vm-image-1');
});

test('VM detail quick-action initializes and stamps a run for restored candidates without one', async () => {
  const core = source('src/app-core-03.js');
  const policies = runtimePolicies();
  const actionSource = sourceSlice(
    core,
    'function factoryRuntimeCompetitorMarketAction(',
    'function factoryRuntimeCompetitorHelpers()',
  );
  const snapshot = {
    factory: {
      automation: {},
      goalRun: {},
      product: {},
    },
    competitors: {
      compPage: {
        marketScrape: {
          selectedIds: ['restored-vm-1'],
          detailSelectionVersion: 3,
          results: [{ id: 'restored-vm-1', title: '복원 후보' }],
          groupedResults: { coupang: [{ id: 'restored-vm-1', title: '복원 후보' }] },
        },
      },
    },
  };
  const detailCalls = [];
  const staleFactoryView = {
    automation: {},
    goalRun: {},
    product: {},
  };
  const context = vm.createContext({
    console: { info() {} },
    factoryRuntimeReadFactory: () => staleFactoryView,
    factoryRuntimeRequireStore: () => ({ getSnapshot: () => snapshot }),
    factoryCurrentStageRunId: () => '',
    factoryRuntimeBridgeAction(actionName, _operationContext, execute) {
      const target = snapshot[policies[actionName].targetPath];
      return {
        operationToken: { revision: 2 },
        value: execute(target),
      };
    },
    factoryRuntimeRequireCurrentFollowupReceipt() {},
    factoryRuntimeFollowupCommandReceipt(receipt, result) {
      return { receipt, result };
    },
    factoryRuntimeCompetitorDraft(draft) {
      draft.compPage = draft.compPage || {};
      draft.compPage.marketScrape = draft.compPage.marketScrape || {};
      return { compPage: draft.compPage, market: draft.compPage.marketScrape };
    },
    factoryStartNewWorkflowRun(draft) {
      draft.automation = draft.automation || {};
      draft.goalRun = draft.goalRun || {};
      draft.product = draft.product || {};
      draft.automation.currentRunId = 'restored-detail-run-1';
      draft.goalRun.currentRunId = 'restored-detail-run-1';
      draft.product.currentRunId = 'restored-detail-run-1';
      draft.product.generationRunId = 'restored-detail-run-1';
      return 'restored-detail-run-1';
    },
    factoryCompetitorCandidateScopePayload(_stageId, draft) {
      const currentRunId = draft.automation?.currentRunId || '';
      return {
        currentRunId,
        productKey: 'vm-product-1',
        inputImageFingerprint: 'vm-image-1',
        scopeKey: `${currentRunId}::vm-product-1::vm-image-1`,
        stageId: 'competitors',
      };
    },
    compMarketApplyCurrentWorkScope(market, scope) {
      market.currentRunId = scope.currentRunId;
      market.factoryWorkKey = scope.scopeKey;
    },
    compMarketStampRowsWithCurrentWork(rows, scope) {
      return rows.map(row => ({ ...row, currentRunId: scope.currentRunId, factoryWorkKey: scope.scopeKey }));
    },
    async runCompMarketDetailCapture(ids, options) {
      detailCalls.push({ ids, options });
      return { ok: true };
    },
    async runCompMarketScraplingDetailCapture() {
      throw new Error('unexpected Scrapling path');
    },
  });
  vm.runInContext(`${actionSource}\nthis.runCompetitorMarketAction = factoryRuntimeCompetitorMarketAction;`, context);

  await context.runCompetitorMarketAction(
    { type: 'quick-action', action: 'detail-vm' },
    { operationToken: { revision: 1 } },
  );

  assert.equal(snapshot.factory.automation.currentRunId, 'restored-detail-run-1');
  assert.equal(snapshot.competitors.compPage.marketScrape.currentRunId, 'restored-detail-run-1');
  assert.equal(snapshot.competitors.compPage.marketScrape.results[0].currentRunId, 'restored-detail-run-1');
  assert.deepEqual(detailCalls[0].ids, ['restored-vm-1']);
});

test('VM detail outer capture leases the captured factory scope before inner current-scope checks', () => {
  const core = source('src/app-core-06.js');
  const detailCapture = sourceSlice(
    core,
    'async function runCompMarketDetailCapture(',
    'async function compMarketResumeDetailJob()',
  );

  assert.match(detailCapture, /const workingDetailScope = runtime === 'vm'/);
  assert.match(detailCapture, /compMarketRunWithOwnedWorkScope\(workingDetailScope, runDetailCapture\)/);
});

test('VM detail outer capture prefers a selected mirror with the initialized work scope', () => {
  const core = source('src/app-core-06.js');
  const detailCapture = sourceSlice(
    core,
    'async function runCompMarketDetailCapture(',
    'async function compMarketResumeDetailJob()',
  );

  assert.match(detailCapture, /const selectionMatchesWorkingScope = compPage =>/);
  assert.match(detailCapture, /&& selectionMatchesWorkingScope\(compPage\)/);
  assert.match(detailCapture, /const detailSelectionMirrors = \[factoryViewCompPage, activeCompPage, canonicalCompPage\]/);
});
