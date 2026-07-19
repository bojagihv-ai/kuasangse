'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function fakeRoot(selectors = {}) {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = listeners.get(type);
      bucket?.delete(listener);
      if (!bucket?.size) listeners.delete(type);
    },
    contains() { return true; },
    querySelector(selector) { return selectors[selector] || null; },
    querySelectorAll(selector) { return selectors[selector] || []; },
    dispatch(type, target, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener({ target, preventDefault() {}, stopPropagation() {}, ...event });
      }
    },
  };
}

async function flushMicrotasks(count = 6) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

async function startIntegrationHarness(options = {}) {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const integration = sourceSlice(
    source,
    'function factoryRuntimeDetachedValue(',
    'function installRuntimeMenuModules(',
  );
  const installer = sourceSlice(
    source,
    'function installRuntimeMenuModules(',
    'function renderActiveRuntimeMenu(',
  );
  const runtimeRenderer = sourceSlice(
    source,
    'function renderActiveRuntimeMenu(',
    'function runtimeShellNavigationSnapshot(',
  );
  const [
    { createFactoryStore }, { createStartFactoryTab }, { createDbFactoryTab },
    { createFieldsFactoryTab }, { createCompetitorFactoryTab }, { createAssetsFactoryTab },
    { createSectionsFactoryTab }, { createPublishFactoryTab }, { createFactoryMenu },
    { createRenderLifecycleCoordinator },
  ] = await Promise.all([
    import(`${pathToFileURL(path.join(ROOT, 'src/modules/factory-store.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/start-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/db-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/fields-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/competitor-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/assets-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/sections-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/publish-tab.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/factory-menu.mjs')).href}?runtime=${Date.now()}`),
    import(`${pathToFileURL(path.join(ROOT, 'src/shell/render-lifecycle.mjs')).href}?runtime=${Date.now()}`),
  ]);

  const factory = {
    workspace: { id: 'project-a' },
    product: {
      productName: 'before', userProductName: 'before', naturalHint: '', inputImages: [],
      dbFieldSettings: {}, dbCustomFields: [],
    },
    automation: { activeTab: 'start', startRunCounts: {} },
    stages: {
      hero: { targetCount: 1, prompt: '', selectedAssetIds: [], inputAssetIds: [] },
      size: { targetCount: 1, prompt: '', selectedAssetIds: [], inputAssetIds: [] },
      options: { targetCount: 1, prompt: '', selectedAssetIds: [], inputAssetIds: [] },
      cuts: { targetCount: 1, prompt: '', selectedAssetIds: [], inputAssetIds: [] },
    },
    assets: [{
      id: 'asset-1', stageId: 'hero', title: '대표 후보',
      image: 'data:image/png;base64,AA==', used: false, rejected: false,
    }],
    previousAssets: [], detailPlacement: {}, openMarketSync: {},
  };
  const state = {
    currentProjectId: 'project-a', step: 'factory', factory, compPage: {},
    sectionContents: {}, sectionImages: {}, sectionInstructions: {}, error: '',
  };
  state.compPage.marketScrape = {
    candidateView: 'vm', collectMode: 'vm', loading: false,
    marketTargets: { coupang: 3 }, totalTarget: 9, topN: 3,
    results: [{
      id: 'candidate-long', platform: 'coupang',
      title: `긴 후보 ${'가나다라마바사아자차카타파하'.repeat(30)}`,
      product_url: 'https://example.invalid/product/candidate-long',
    }],
    vmResults: [], localResults: [], groupedResults: {}, selectedIds: [],
    scrapedImages: [], selectedImageIds: [],
  };
  state.compPage.marketScrape.vmResults = state.compPage.marketScrape.results;
  let readOnly = false;
  let renderCount = 0;
  let storeReportCount = 0;
  let capturedCapabilities = null;
  let capturedDbCapabilities = null;
  let capturedFieldsCapabilities = null;
  let capturedCompetitorCapabilities = null;
  let capturedAssetsCapabilities = null;
  let capturedSectionsCapabilities = null;
  let capturedPublishCapabilities = null;
  let capturedFactoryMenuCapabilities = null;
  const dbCalls = [];
  const fieldsCalls = [];
  const competitorCalls = [];
  const assetsCalls = [];
  const sectionsCalls = [];
  const publishRenderCalls = [];
  const domClicks = [];
  const domScrolls = [];
  const document = {
    querySelector(selector) {
      if (selector === '[data-factory-option-color-file]') {
        return { click() { domClicks.push('option-color-file'); } };
      }
      if ([
        '#factoryPublishInlineFinalPanel #factoryFinalRegistrationPanel',
        '#factoryFinalRegistrationPanel',
        '#factoryMaterialReviewSection',
        '.factory-run-status-rail',
      ].includes(selector)) {
        return {
          scrollIntoView() { domScrolls.push(selector); },
          querySelector() { return { focus() { domScrolls.push(`${selector}:focus`); } }; },
        };
      }
      return null;
    },
    getElementById(id) {
      return { click() { domClicks.push(id); } };
    },
  };
  const instrumentedStoreFactory = options => {
    const reportError = options.reportError;
    return createFactoryStore({
      ...options,
      reportError(error, context) {
        storeReportCount += 1;
        return reportError?.(error, context);
      },
    });
  };
  const instrumentedStartFactory = capabilities => {
    capturedCapabilities = capabilities;
    return createStartFactoryTab(capabilities);
  };
  const instrumentedDbFactory = capabilities => {
    capturedDbCapabilities = capabilities;
    return createDbFactoryTab(capabilities);
  };
  const instrumentedFieldsFactory = capabilities => {
    capturedFieldsCapabilities = capabilities;
    return createFieldsFactoryTab(capabilities);
  };
  const instrumentedCompetitorFactory = capabilities => {
    capturedCompetitorCapabilities = capabilities;
    return createCompetitorFactoryTab(capabilities);
  };
  const instrumentedAssetsFactory = capabilities => {
    capturedAssetsCapabilities = capabilities;
    return createAssetsFactoryTab(capabilities);
  };
  const instrumentedSectionsFactory = capabilities => {
    capturedSectionsCapabilities = capabilities;
    return createSectionsFactoryTab(capabilities);
  };
  const instrumentedPublishFactory = capabilities => {
    capturedPublishCapabilities = capabilities;
    return createPublishFactoryTab(capabilities);
  };
  const instrumentedFactoryMenu = capabilities => {
    capturedFactoryMenuCapabilities = capabilities;
    return createFactoryMenu(capabilities);
  };

  const compile = new Function(
    'state', 'factoryState', 'currentWorkspaceAuthority', 'workspaceAuthorityIsReadOnly',
    'factorySetCurrentProductIdentity', 'scheduleLastWorkSave', 'saveLastWorkNow',
    'factorySetProductImage', 'factoryPromoteStoredProductCandidateToInput',
    'factoryRunDbCompetitorHeroCutsFlow', 'document', 'render',
    'escapeHtml', 'escAttr', 'renderFactoryLightImage',
    'factoryAutomationCounts', 'factoryAutomationWizardTasks',
    'renderFactoryAutomationTaskChecklist', 'renderFactoryCandidateReviewPanels',
    'factoryApplyWizardDbSearchQuery', 'factoryRunDbCandidatesForSelection',
    'factoryRunCafe24CandidateSearchOnly', 'factoryRunCafe24CandidateAdditionalSearch',
    'factoryRunDbVmCandidatesOnlyFlow', 'factoryStartSinhwaDbAndRerunCandidates',
    'factoryStartCafe24ControlAndRerunCandidates', 'factoryOpenCafe24OAuthLogin',
    'factoryRefreshCafe24OAuthStatus', 'factoryApplyDbCandidateFromReview',
    'factoryApplyCafe24CandidateFromReview', 'factoryConfirmNoDbCandidate',
    'factoryConfirmNoCafe24Candidate',
    'disabledAttr', 'factoryAutomationStatusTone', 'factoryAutomationReviewSummary',
    'factoryBojagiSquareSizeOptionSuggestion', 'factoryFieldTransferRows',
    'factoryFieldTransferState', 'factorySinhwaSelectedTransferTarget',
    'factoryCafe24SelectedTransferTarget', 'renderFactoryAutomationStatusCard',
    'renderFactoryAutomationAssetChooser',
    'factorySetAutomationWizardFieldDraft', 'factoryCommitAutomationWizardFieldValue',
    'factoryAutomationWizardDrafts', 'factoryPersistAutomationWizardDrafts',
    'factorySetFieldTransferSelection', 'factoryExecuteSelectedFieldTransfer',
    'factoryMissingFieldSourceSelector', 'factoryRunStage',
    'factorySetOptionColorImageUsage', 'factoryOpenOptionSorterEditor',
    'factoryAddOptionColorImageFiles',
    'renderFactoryAutomationVmSearchInfo', 'renderCompetitorAnalyzeLogItems',
    'renderCompMarketScrapePanel', 'factoryRunVmCompetitorCollectionForSelection',
    'compMarketConfirmLocalCandidateCollection', 'runCompMarketScrape',
    'compMarketRequireCurrentImageAnalysis', 'refreshCompetitorAnalysisFromServer',
    'ensureCompMarketScrapeState', 'saveCompMarketUiState', 'compMarketFindResultById',
    'compMarketMarkDetailSelectionChanged', 'compMarketMarkSelectionChanged',
    'analyzeCompMarketScrapedImages', 'reloadCompMarketSearchResultsFromCurrentId',
    'runCompMarketDetailCapture', 'runCompMarketDetailCaptureAndAnalyze',
    'compMarketAllCandidateResults', 'compMarketResultId',
    'compMarketVisibleDetailImagesForSelection', 'compMarketScrapedImageId',
    'compMarketSetCandidateSourceView',
    'factoryAddStageInputFiles', 'factoryCreateProductInputAsset',
    'factorySendAssetToStage', 'factoryToggleAssetUse', 'factoryToggleAssetReject',
    'factoryOpenAssetPreview', 'factoryPlaceAsset', 'factoryArchiveAsset',
    'factoryUpdateFromInputs', 'factoryCommitVisibleDbSizeManualDrafts',
    'factoryAutomationSizeReviewStatus', 'factorySetStageStatus', 'factoryLog',
    'factorySyncDbOptionsToOptionSorter', 'factoryImportOptionSorterResults',
    'factoryAddCompletedFiles',
    'factoryApplySelectedAssetsToSections',
    'factoryFinalRegistrationSettings', 'factoryRenderCacheBaseDraft',
    'factoryOpenMarketBuildBaseDraft', 'factoryRenderCacheFinalCafe24Model',
    'factoryFinalRegistrationCafe24Model', 'SECTIONS',
    'renderFactoryFinalRegistrationPanel',
    `"use strict";
      const runtimeMenuModules = new Map();
      let factoryRuntimeStore = null;
      let factoryRuntimeBootstrapFactory = null;
      let factoryRuntimeStartTab = null;
      let factoryRuntimeDbTab = null;
      let factoryRuntimeFieldsTab = null;
      let factoryRuntimeCompetitorTab = null;
      let factoryRuntimeAssetsTab = null;
      let factoryRuntimeSectionsTab = null;
      let factoryRuntimePublishTab = null;
      let factoryRuntimeRefreshPending = false;
      let factoryRuntimeRefreshNeedsRender = false;
      let factoryRuntimeRefreshScheduled = false;
      ${integration}
      ${installer}
      ${runtimeRenderer}
      return {
        install: installRuntimeMenuModules,
        renderRoute: route => renderActiveRuntimeMenu(runtimeMenuModules.get(route) || null),
        getMenu: route => runtimeMenuModules.get(route) || null,
        getFactoryMenu: () => runtimeMenuModules.get('factory'),
        getStore: () => factoryRuntimeStore,
        getStartTab: () => factoryRuntimeStartTab,
        getDbTab: () => factoryRuntimeDbTab,
        getFieldsTab: () => factoryRuntimeFieldsTab,
        getCompetitorTab: () => factoryRuntimeCompetitorTab,
        getAssetsTab: () => factoryRuntimeAssetsTab,
        getSectionsTab: () => factoryRuntimeSectionsTab,
        getPublishTab: () => factoryRuntimePublishTab,
      };`,
  );
  const compiledRuntime = compile(
    state,
    () => factory,
    () => ({ scopeId: 'project:project-a', fencingToken: 7, mode: readOnly ? 'readonly' : 'editing' }),
    () => readOnly,
    (name, options = {}) => {
      const target = options.factory || factory;
      target.product.productName = String(name || '');
      target.product.userProductName = String(name || '');
    },
    () => {},
    () => {},
    () => true,
    () => Promise.resolve(true),
    () => Promise.resolve(true),
    document,
    () => { renderCount += 1; },
    value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    value => String(value ?? '').replaceAll('"', '&quot;'),
    (src, alt, attrs) => `<img src="${src}" alt="${alt}" ${attrs}>`,
    current => ({
      dbCandidates: current.product?.dbCandidates?.length || 0,
      cafe24Candidates: current.product?.cafe24Candidates?.length || 0,
      confirmedDb: !!current.product?.confirmedDb,
      cafe24Selected: !!current.product?.selectedCafe24CandidateKey,
      sizeSelected: 0,
      sizeAssets: 0,
      optionAssets: 1,
    }),
    () => [],
    () => '<div data-db-checklist></div>',
    () => '<div data-db-review></div>',
    rawQuery => {
      const query = String(rawQuery || '').trim();
      factory.automation.dbSearchQuery = query;
      return query;
    },
    () => {
      dbCalls.push('rerunDbQuery');
      return options.dbDeferred?.promise || Promise.resolve(true);
    },
    () => { dbCalls.push('rerunCafe24Query'); return Promise.resolve(true); },
    () => { dbCalls.push('appendCafe24Query'); return Promise.resolve(true); },
    () => { dbCalls.push('rerunDbVmOnly'); return Promise.resolve(true); },
    () => { dbCalls.push('startSinhwaDbAndRerun'); return Promise.resolve(true); },
    () => { dbCalls.push('startCafe24ControlAndRerun'); return Promise.resolve(true); },
    () => { dbCalls.push('cafe24OauthStart'); return true; },
    () => { dbCalls.push('cafe24OauthStatusRefreshAndRerun'); return Promise.resolve(true); },
    index => { dbCalls.push(`applyDbCandidate:${index}`); return Promise.resolve(true); },
    index => { dbCalls.push(`applyCafe24Candidate:${index}`); return Promise.resolve(true); },
    () => { dbCalls.push('confirmNoDbCandidate'); return true; },
    () => { dbCalls.push('confirmNoCafe24Candidate'); return true; },
    (disabled, reason = '') => disabled ? `disabled title="${reason}"` : '',
    status => ({
      label: status === 'done' ? '완료' : '채우기 필요',
      color: 'var(--ok)', border: 'var(--border)', bg: 'transparent', icon: 'check_circle',
    }),
    current => {
      const committed = current.automation?.fieldReview?.width_mm;
      const draft = current.automation?.fieldDrafts?.width_mm;
      return {
        fields: [{
          id: 'width_mm', label: '가로', group: '상품등록 필수', required: true,
          status: committed ? 'done' : 'missing', value: committed?.value || '',
          hasDraft: !!draft, draftValue: draft?.value || '', readonly: false,
        }],
        missingRegister: committed ? [] : [{ id: 'width_mm' }],
        missingGenerate: [], autoDone: [], sizeReady: !!committed,
        fieldCommitNotice: current.automation?.fieldCommitNotice || '',
      };
    },
    () => null,
    current => [{
      id: 'width_mm', label: '가로',
      value: current.automation?.fieldReview?.width_mm?.value || '100mm',
      sinhwa: true, cafe24: false,
    }],
    current => current.automation?.fieldTransfer || {
      selectedFieldIds: [], status: 'idle', target: '', message: '', results: {},
    },
    () => ({ jcode: 'J1', name: '상품' }),
    () => null,
    (label, value) => `<div data-fields-status>${label}:${value}</div>`,
    (_factory, stageId) => `<div data-assets-stage="${stageId}"></div>`,
    (input, current = factory) => {
      const fieldId = input.dataset.factoryWizardField;
      current.automation.fieldDrafts = current.automation.fieldDrafts || {};
      current.automation.fieldDrafts[fieldId] = {
        value: input.value, label: input.dataset.factoryWizardLabel,
      };
      fieldsCalls.push(`draft:${fieldId}:${input.value}`);
    },
    (fieldId, value, label, _renderAfter = false, current = factory) => {
      current.automation.fieldReview = current.automation.fieldReview || {};
      current.automation.fieldReview[fieldId] = { fieldId, value, label };
      delete current.automation.fieldDrafts?.[fieldId];
      fieldsCalls.push(`commit:${fieldId}:${value}`);
    },
    current => {
      current.automation.fieldDrafts = current.automation.fieldDrafts || {};
      return current.automation.fieldDrafts;
    },
    () => {},
    (fieldIds, current = factory) => {
      current.automation.fieldTransfer = current.automation.fieldTransfer || {
        status: 'idle', target: '', message: '', results: {},
      };
      current.automation.fieldTransfer.selectedFieldIds = [...fieldIds];
      fieldsCalls.push(`selection:${fieldIds.join(',')}`);
      return [...fieldIds];
    },
    target => {
      fieldsCalls.push(`transfer:${target}`);
      return options.fieldsDeferred?.promise || Promise.resolve(true);
    },
    () => '#factoryFinalRegistrationPanel',
    stage => {
      fieldsCalls.push(`stage:${stage}`);
      assetsCalls.push(`run-stage:${stage}`);
      sectionsCalls.push(`run-stage:${stage}`);
      return stage === 'detail'
        ? (options.sectionsDeferred?.promise || Promise.resolve(true))
        : (options.assetsDeferred?.promise || Promise.resolve(true));
    },
    usage => { fieldsCalls.push(`option:${usage}`); return true; },
    () => { fieldsCalls.push('openOptionSorter'); return true; },
    files => { fieldsCalls.push(`upload:${files.length}`); return files.length; },
    () => '<div data-competitor-vm-info></div>',
    logs => `<div data-competitor-logs>${logs.length}</div>`,
    () => '<div data-competitor-full-panel></div>',
    () => {
      competitorCalls.push('rerun-vm');
      return options.competitorDeferred?.promise || Promise.resolve(true);
    },
    () => true,
    mode => { competitorCalls.push(`scrape:${mode}`); return Promise.resolve(true); },
    () => true,
    () => { competitorCalls.push('refresh-analysis'); return Promise.resolve(true); },
    () => state.compPage.marketScrape,
    () => {},
    (market, id) => {
      const index = market.results.findIndex(item => String(item.id) === String(id));
      return index < 0 ? null : { item: market.results[index], index };
    },
    () => { competitorCalls.push('selection-changed'); },
    () => { competitorCalls.push('image-selection-changed'); },
    mode => { competitorCalls.push(`analyze-images:${mode}`); return Promise.resolve(true); },
    () => { competitorCalls.push('reload'); return Promise.resolve(true); },
    (_value, detailOptions = {}) => { competitorCalls.push(`detail:${detailOptions.runtime || 'vm'}`); return Promise.resolve(true); },
    () => { competitorCalls.push('detail-analyze'); return Promise.resolve(true); },
    market => market.results || [],
    item => String(item.id || ''),
    market => market.scrapedImages || [],
    image => String(image.id || ''),
    source => {
      state.compPage.marketScrape.candidateView = source === 'local' ? 'local' : 'vm';
      competitorCalls.push(`source:${source}`);
      return state.compPage.marketScrape;
    },
    (stageId, files) => {
      assetsCalls.push(`stage-files:${stageId}:${files.length}`);
      return files.length;
    },
    stageId => {
      const asset = { id: `product-${stageId}`, stageId };
      assetsCalls.push(`create-product:${stageId}`);
      return asset;
    },
    (assetId, stageId) => {
      assetsCalls.push(`send:${assetId}:${stageId}`);
      return true;
    },
    (assetId, current = factory) => {
      const asset = current.assets.find(item => item.id === assetId);
      if (asset) asset.used = !asset.used;
      assetsCalls.push(`use:${assetId}`);
      return !!asset;
    },
    (assetId, current = factory) => {
      const asset = current.assets.find(item => item.id === assetId);
      if (asset) asset.rejected = !asset.rejected;
      assetsCalls.push(`reject:${assetId}`);
      return !!asset;
    },
    assetId => { assetsCalls.push(`preview:${assetId}`); return true; },
    assetId => { assetsCalls.push(`place:${assetId}`); return true; },
    asset => {
      assetsCalls.push(`archive:${asset.id}`);
      return options.assetsArchiveDeferred?.promise || Promise.resolve(true);
    },
    () => { assetsCalls.push('update-inputs'); },
    () => { assetsCalls.push('commit-size-drafts'); },
    () => ({ requiredMissing: [], key: 'size-key' }),
    (stageId, status) => {
      factory.stages[stageId] = { ...(factory.stages[stageId] || {}), status };
      assetsCalls.push(`status:${stageId}:${status}`);
    },
    message => { assetsCalls.push(`log:${message}`); },
    () => { assetsCalls.push('sync-db-options'); return { ok: true }; },
    () => { assetsCalls.push('sync-option-results'); return 1; },
    files => { assetsCalls.push(`completed-files:${files.length}`); return files.length; },
    (current = factory) => {
      sectionsCalls.push('apply-sections');
      current.detailPlacement['asset-1'] = 'detail-main';
      return 1;
    },
    () => ({
      targetLabel: 'Cafe24 등록', displayLabel: '진열함', sellingLabel: '판매함',
      includeOpenMarket: false,
    }),
    () => { publishRenderCalls.push('cache-base-draft'); return {}; },
    () => { publishRenderCalls.push('base-draft'); return {}; },
    () => { publishRenderCalls.push('cache-cafe24-model'); return { canRun: true, label: '실행 가능', reason: '준비됨' }; },
    () => { publishRenderCalls.push('cafe24-model'); return { canRun: true, label: '실행 가능', reason: '준비됨' }; },
    [{ id: 'intro' }, { id: 'detail' }],
    () => {
      publishRenderCalls.push('final-panel');
      return '<div id="factoryFinalRegistrationPanel" data-publish-final-panel>최종 등록 설정</div>';
    },
  );
  let menuLifecycle = null;
  let menuLifecycleRoot = null;
  const runtime = {
    ...compiledRuntime,
    async bindRoute(route, root) {
      const normalizedRoute = String(route || '').trim();
      if (!normalizedRoute) {
        const active = menuLifecycle;
        menuLifecycle = null;
        menuLifecycleRoot = null;
        return active?.dispose();
      }
      if (!menuLifecycle || menuLifecycleRoot !== root) {
        await menuLifecycle?.dispose();
        menuLifecycleRoot = root;
        menuLifecycle = createRenderLifecycleCoordinator({ root, render() {} });
      }
      const menu = compiledRuntime.getMenu(normalizedRoute);
      if (!menu) throw new Error(`unregistered route: ${normalizedRoute}`);
      return menuLifecycle.activate({
        route: normalizedRoute,
        menu,
        snapshot: menu.select(state),
        workspaceId: state.currentProjectId,
      });
    },
  };
  const namespaces = Object.freeze({
    'src/modules/factory-store.mjs': { createFactoryStore: instrumentedStoreFactory },
    'src/menus/factory/tabs/start-tab.mjs': { createStartFactoryTab: instrumentedStartFactory },
    'src/menus/factory/tabs/db-tab.mjs': { createDbFactoryTab: instrumentedDbFactory },
    'src/menus/factory/tabs/fields-tab.mjs': { createFieldsFactoryTab: instrumentedFieldsFactory },
    'src/menus/factory/tabs/competitor-tab.mjs': { createCompetitorFactoryTab: instrumentedCompetitorFactory },
    'src/menus/factory/tabs/assets-tab.mjs': { createAssetsFactoryTab: instrumentedAssetsFactory },
    'src/menus/factory/tabs/sections-tab.mjs': { createSectionsFactoryTab: instrumentedSectionsFactory },
    'src/menus/factory/tabs/publish-tab.mjs': { createPublishFactoryTab: instrumentedPublishFactory },
    'src/menus/factory/factory-menu.mjs': { createFactoryMenu: instrumentedFactoryMenu },
  });
  runtime.install(namespaces);
  const installRenderCount = renderCount;
  renderCount = 0;
  return {
    runtime, state, factory,
    capabilities: () => capturedCapabilities,
    dbCapabilities: () => capturedDbCapabilities,
    fieldsCapabilities: () => capturedFieldsCapabilities,
    competitorCapabilities: () => capturedCompetitorCapabilities,
    assetsCapabilities: () => capturedAssetsCapabilities,
    sectionsCapabilities: () => capturedSectionsCapabilities,
    publishCapabilities: () => capturedPublishCapabilities,
    factoryMenuCapabilities: () => capturedFactoryMenuCapabilities,
    dbCalls,
    fieldsCalls,
    competitorCalls,
    assetsCalls,
    sectionsCalls,
    publishRenderCalls,
    domClicks,
    domScrolls,
    namespaces,
    setReadOnly(value) { readOnly = value; },
    renderCount: () => renderCount,
    installRenderCount: () => installRenderCount,
    storeReportCount: () => storeReportCount,
    createFactoryStore: instrumentedStoreFactory,
  };
}

test('Task 7 START uses the public app-core installer, detached store, and deterministic DOM lifecycle', async () => {
  // Given: actual app-core install source wired to the real store and start-tab factories.
  const fixture = await startIntegrationHarness();
  const store = fixture.runtime.getStore();
  const tab = fixture.runtime.getStartTab();
  const capabilities = fixture.capabilities();

  // Then: only the locked seven runtime fields cross into the tab, through an immutable snapshot.
  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'renderHelpers', 'reportError',
  ]);
  assert.equal('state' in capabilities, false);
  assert.equal('factoryState' in capabilities, false);
  assert.equal(Object.isFrozen(store.getSnapshot()), true);
  assert.notStrictEqual(store.getSnapshot().factory, fixture.factory);

  // And: the actual START renderer emits the preserved DOM contract.
  const html = tab.render(tab.select());
  assert.match(html, /data-factory-tab="start"/);
  assert.match(html, /id="factoryGuideProductName"/);
  assert.match(html, /data-factory-guide-action="run-db"/);
  assert.match(html, /DB\/경쟁사 수집 및 대표\/이미지컷 생성/);

  // When: its real bind lifecycle receives a product-name input event.
  const root = fakeRoot();
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()].sort(), ['change', 'click', 'dragover', 'drop', 'input']);
  root.dispatch('input', {
    id: 'factoryGuideProductName', tagName: 'INPUT', value: '통합 상품',
  });
  await Promise.resolve();
  await Promise.resolve();

  // Then: the store is authoritative, the detached bootstrap object stays unchanged, and dispose leaves no listener.
  assert.equal(fixture.factory.product.productName, 'before');
  assert.equal(store.getSnapshot().factory.product.productName, '통합 상품');
  assert.equal(store.getOperationToken().revision, 1);
  assert.equal(fixture.renderCount(), 0);
  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);

  // And: reportError is routed through the store-owned reporter, never a direct fallback.
  capabilities.reportError(new Error('START_RECEIPT_ERROR'));
  assert.equal(fixture.storeReportCount(), 1);
  assert.equal(fixture.state.error, 'START_RECEIPT_ERROR');
});

test('Task 7 START installer fails closed and blocks read-only DOM mutations', async () => {
  const fixture = await startIntegrationHarness();
  assert.throws(
    () => fixture.runtime.install({
      'src/modules/factory-store.mjs': { createFactoryStore: fixture.createFactoryStore },
    }),
    /missing factory runtime capability: createStartFactoryTab/,
  );

  const root = fakeRoot();
  const dispose = fixture.runtime.getStartTab().bind(root);
  fixture.setReadOnly(true);
  root.dispatch('input', {
    id: 'factoryGuideProductName', tagName: 'INPUT', value: '차단 상품',
  });
  assert.equal(fixture.factory.product.productName, 'before');
  assert.equal(fixture.runtime.getStore().getSnapshot().factory.product.productName, 'before');
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 DB installs its explicit allowlists and drives the real DOM contract', async () => {
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getDbTab();
  const store = fixture.runtime.getStore();
  const capabilities = fixture.dbCapabilities();
  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'renderHelpers', 'reportError',
  ]);
  assert.deepEqual(Object.keys(capabilities.actions), [
    'goToFields', 'rerunDbQuery', 'rerunCafe24Query', 'appendCafe24Query',
    'resetDbQuery', 'rerunDbVmOnly', 'runDb', 'startSinhwaDbAndRerun',
    'startCafe24ControlAndRerun', 'cafe24OauthStart',
    'cafe24OauthStatusRefreshAndRerun', 'focusSize', 'setDbSearchQuery',
    'commitDbSearchQuery', 'applyDbCandidate', 'applyCafe24Candidate',
    'confirmNoDbCandidate', 'confirmNoCafe24Candidate', 'runFactoryGuideAction',
  ]);
  assert.deepEqual(Object.keys(capabilities.renderHelpers), [
    'escapeHtml', 'escAttr', 'factoryAutomationCounts',
    'factoryAutomationWizardTasks', 'renderFactoryAutomationTaskChecklist',
    'renderFactoryCandidateReviewPanels',
  ]);

  const html = tab.render(tab.select());
  assert.match(html, /<h4>2\. DB 확정<\/h4>/);
  assert.match(html, /data-factory-db-search-query/);
  assert.match(html, /data-db-review/);
  assert.match(html, /data-factory-guide-action="go-tab:fields"/);

  const queryInput = {
    value: '  새 검색어  ',
    matches(selector) { return selector === '[data-factory-db-search-query]'; },
  };
  const root = fakeRoot({ '[data-factory-db-search-query]': queryInput });
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()].sort(), ['click', 'focusout', 'input']);
  root.dispatch('input', queryInput);
  await flushMicrotasks();
  assert.equal(fixture.state.error, '');
  assert.equal(fixture.factory.automation.dbSearchQuery, undefined);
  assert.equal(store.getSnapshot().factory.automation.dbSearchQuery, '  새 검색어  ');
  assert.equal(store.getOperationToken().revision, 1);

  root.dispatch('focusout', queryInput);
  await flushMicrotasks();
  assert.equal(fixture.factory.automation.dbSearchQuery, undefined);
  assert.equal(store.getSnapshot().factory.automation.dbSearchQuery, '새 검색어');
  assert.equal(store.getOperationToken().revision, 2);

  const guide = {
    dataset: { factoryGuideAction: 'rerun-db-query' },
    closest(selector) { return selector.includes('[data-factory-guide-action]') ? this : null; },
  };
  root.dispatch('click', guide);
  await flushMicrotasks(10);
  assert.deepEqual(fixture.dbCalls, ['rerunDbQuery']);
  assert.equal(fixture.factory.automation.dbSearchQuery, '새 검색어');
  assert.equal(store.getOperationToken().revision, 3);

  assert.equal(tab.invoke('go-tab:fields'), 'factory/fields');
  await flushMicrotasks();
  assert.equal(fixture.factory.automation.activeTab, 'start');
  assert.equal(store.getSnapshot().factory.automation.activeTab, 'fields');
  assert.equal(store.getSnapshot().factory.automation.activeTab, 'fields');
  assert.equal(store.getOperationToken().revision, 4);
  assert.equal(fixture.renderCount(), 1);
  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 DB rejects read-only and stale async actions before accepting completion', async () => {
  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getDbTab().invoke('set-db-search-query', 'blocked'),
    /READ_ONLY/,
  );
  assert.equal(readOnly.factory.automation.dbSearchQuery, undefined);
  assert.equal(readOnly.runtime.getStore().getOperationToken().revision, 0);

  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const stale = await startIntegrationHarness({ dbDeferred: deferred });
  const store = stale.runtime.getStore();
  const pending = stale.runtime.getDbTab().invoke('rerun-db-query', 'stale query');
  store.switchWorkspace('project-b', { snapshot: store.getSnapshot(), revision: 0 });
  resolve(true);
  await assert.rejects(pending, /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.equal(store.getOperationToken().workspaceId, 'project-b');
  assert.equal(store.getOperationToken().revision, 0);
  assert.equal(stale.state.error.includes('STALE'), true);
});

test('Task 7 fields installs explicit allowlists and owns draft, commit, guide, and cleanup DOM paths', async () => {
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getFieldsTab();
  const store = fixture.runtime.getStore();
  const capabilities = fixture.fieldsCapabilities();
  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'renderHelpers', 'reportError',
  ]);
  assert.deepEqual(Object.keys(capabilities.actions), [
    'setFieldDraft', 'commitField', 'commitAllFields', 'editField',
    'setFieldTransferSelection', 'clearFieldTransferSelection',
    'executeSelectedFieldTransfer', 'runGuideAction', 'uploadOptionColor',
  ]);
  assert.deepEqual(Object.keys(capabilities.renderHelpers), [
    'escapeHtml', 'escAttr', 'disabledAttr', 'factoryAutomationStatusTone',
    'factoryAutomationCounts', 'factoryAutomationReviewSummary',
    'factoryBojagiSquareSizeOptionSuggestion', 'factoryFieldTransferRows',
    'factoryFieldTransferState', 'factorySinhwaSelectedTransferTarget',
    'factoryCafe24SelectedTransferTarget', 'renderFactoryAutomationTaskChecklist',
    'renderFactoryAutomationStatusCard',
  ]);

  const html = tab.render(tab.select());
  assert.match(html, /<h4>3\. 필수값<\/h4>/);
  assert.match(html, /data-factory-wizard-field="width_mm"/);
  assert.match(html, /data-factory-wizard-commit="width_mm"/);
  assert.match(html, /data-factory-field-transfer-panel/);
  assert.match(html, /data-factory-option-color-upload/);

  const field = {
    dataset: { factoryWizardField: 'width_mm', factoryWizardLabel: '가로' },
    tagName: 'INPUT', value: '120mm',
    matches(selector) { return selector === '[data-factory-wizard-field]'; },
    closest(selector) { return selector === '[data-factory-wizard-field]' ? this : null; },
  };
  const root = fakeRoot({ '[data-factory-wizard-field]': [field] });
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()].sort(), ['blur', 'change', 'click', 'input']);
  root.dispatch('input', field);
  await flushMicrotasks();
  assert.equal(fixture.factory.automation.fieldDrafts, undefined);
  assert.equal(store.getSnapshot().factory.automation.fieldDrafts.width_mm.value, '120mm');
  assert.equal(store.getOperationToken().revision, 1);

  const commit = {
    dataset: { factoryWizardCommit: 'width_mm' },
    closest(selector) {
      if (selector === '[data-factory-wizard-commit]') return this;
      return null;
    },
  };
  root.dispatch('click', commit);
  await flushMicrotasks();
  assert.equal(fixture.factory.automation.fieldReview, undefined);
  assert.equal(store.getSnapshot().factory.automation.fieldReview.width_mm.value, '120mm');
  assert.equal(store.getOperationToken().revision, 2);
  assert.equal(fixture.renderCount(), 1);

  const guide = {
    dataset: { factoryGuideAction: 'go-tab:assets' },
    closest(selector) { return selector === '[data-factory-guide-action]' ? this : null; },
  };
  root.dispatch('click', guide);
  await flushMicrotasks(10);
  assert.equal(fixture.factory.automation.activeTab, 'start');
  assert.equal(store.getSnapshot().factory.automation.activeTab, 'assets');
  assert.equal(store.getSnapshot().factory.automation.activeTab, 'assets');
  assert.equal(store.getOperationToken().revision, 3);
  assert.equal(fixture.renderCount(), 2);

  assert.equal(tab.invoke('uploadOptionColors', { files: [{ type: 'image/png' }] }), 1);
  await flushMicrotasks();
  assert.equal(fixture.fieldsCalls.includes('upload:1'), true);
  assert.equal(store.getOperationToken().revision, 4);
  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 fields rejects read-only mutation and stale transfer completion', async () => {
  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getFieldsTab().invoke('commitField', {
      fieldId: 'width_mm', value: '130mm', label: '가로', renderAfter: true,
    }),
    /READ_ONLY/,
  );
  assert.equal(readOnly.fieldsCalls.some(call => call.startsWith('commit:')), false);
  assert.equal(readOnly.runtime.getStore().getOperationToken().revision, 0);

  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const stale = await startIntegrationHarness({ fieldsDeferred: deferred });
  const store = stale.runtime.getStore();
  const pending = stale.runtime.getFieldsTab().invoke('transferFields', { target: 'sinhwa' });
  store.switchWorkspace('project-b', { snapshot: store.getSnapshot(), revision: 0 });
  resolve(true);
  await assert.rejects(pending, /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.deepEqual(stale.fieldsCalls, ['transfer:sinhwa']);
  assert.equal(store.getOperationToken().workspaceId, 'project-b');
  assert.equal(store.getOperationToken().revision, 0);
});

test('Task 7 competitor preserves all controls in a 535x697 markup stress receipt', async () => {
  const viewport = Object.freeze({ width: 535, height: 697 });
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getCompetitorTab();
  const capabilities = fixture.competitorCapabilities();
  assert.deepEqual(Object.keys(capabilities.actions), ['runGuideAction', 'runMarketAction']);
  assert.deepEqual(Object.keys(capabilities.renderHelpers), [
    'escapeHtml', 'escAttr', 'disabledAttr', 'renderFactoryAutomationVmSearchInfo',
    'renderFactoryAutomationTaskChecklist', 'renderFactoryAutomationStatusCard',
    'renderFactoryLightImage', 'renderCompetitorAnalyzeLogItems',
    'renderCompMarketScrapePanel',
  ]);

  const html = tab.render(tab.select());
  assert.deepEqual(viewport, { width: 535, height: 697 });
  assert.match(html, /data-factory-competitor-tab/);
  assert.match(html, /min-width:0;max-width:100%;overflow-wrap:anywhere/);
  assert.match(html, /<h4 style="margin:0">4\. 경쟁사<\/h4>/);
  assert.match(html, /data-factory-guide-action="rerun-vm-competitors"/);
  assert.match(html, /data-factory-comp-market-total-target/);
  assert.match(html, /data-comp-market-toggle-result="candidate-long"/);
  assert.match(html, /긴 후보 가나다라마/);
  assert.match(html, /data-factory-guide-action="toggle-competitor-panel"/);
  assert.doesNotMatch(html, /data-factory-competitor-tab[^>]*height:\s*697px/);
});

test('Task 7 competitor owns market target, candidate click, guide, and disposer paths', async () => {
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getCompetitorTab();
  const store = fixture.runtime.getStore();
  const root = fakeRoot();
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()].sort(), ['change', 'click', 'input']);

  const candidate = {
    dataset: { compMarketToggleResult: 'candidate-long' },
    closest(selector) { return selector === '[data-comp-market-toggle-result]' ? this : null; },
  };
  root.dispatch('click', candidate);
  await flushMicrotasks();
  assert.deepEqual(fixture.state.compPage.marketScrape.selectedIds, []);
  assert.deepEqual(store.getSnapshot().competitors.compPage.marketScrape.selectedIds, ['candidate-long']);
  assert.equal(store.getOperationToken().revision, 1);
  assert.equal(fixture.renderCount(), 1);

  const totalTarget = {
    dataset: {}, value: '17',
    closest(selector) { return selector === '[data-factory-comp-market-total-target]' ? this : null; },
  };
  root.dispatch('input', totalTarget);
  await flushMicrotasks();
  assert.equal(fixture.state.compPage.marketScrape.totalTarget, 9);
  assert.equal(store.getSnapshot().competitors.compPage.marketScrape.totalTarget, 17);
  assert.equal(store.getOperationToken().revision, 2);
  assert.equal(fixture.renderCount(), 1);

  const guide = {
    dataset: { factoryGuideAction: 'toggle-competitor-panel' },
    closest(selector) { return selector === '[data-factory-guide-action]' ? this : null; },
  };
  root.dispatch('click', guide);
  await flushMicrotasks();
  assert.equal(fixture.factory.automation.competitorPanelOpen, undefined);
  assert.equal(store.getSnapshot().factory.automation.competitorPanelOpen, true);
  assert.equal(store.getOperationToken().revision, 3);
  assert.equal(fixture.renderCount(), 2);

  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 competitor rejects read-only mutation and stale async guide completion', async () => {
  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getCompetitorTab().invoke('marketAction', {
      type: 'toggle-candidate', candidateId: 'candidate-long',
    }),
    /READ_ONLY/,
  );
  assert.deepEqual(readOnly.state.compPage.marketScrape.selectedIds, []);

  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const stale = await startIntegrationHarness({ competitorDeferred: deferred });
  const store = stale.runtime.getStore();
  const pending = stale.runtime.getCompetitorTab().invoke('guideAction', 'rerun-vm-competitors');
  store.switchWorkspace('project-b', { snapshot: store.getSnapshot(), revision: 0 });
  resolve(true);
  await assert.rejects(pending, /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.deepEqual(stale.competitorCalls, ['rerun-vm']);
  assert.equal(store.getOperationToken().workspaceId, 'project-b');
  assert.equal(store.getOperationToken().revision, 0);
});

test('Task 7 assets installs exact allowlists and preserves the four-stage renderer', async () => {
  const viewport = Object.freeze({ width: 535, height: 697 });
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getAssetsTab();
  const capabilities = fixture.assetsCapabilities();

  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'renderHelpers', 'reportError',
  ]);
  assert.deepEqual(Object.keys(capabilities.actions), [
    'runFactoryGuideAction', 'setFactoryStageTarget', 'setFactoryStagePrompt',
    'runFactoryStage', 'addFactoryStageInputFiles', 'createFactoryProductInputAsset',
    'sendFactoryAssetToStage', 'toggleFactoryAssetUse', 'toggleFactoryAssetReject',
    'openFactoryAssetPreview', 'placeFactoryAsset', 'archiveFactoryAsset',
    'confirmFactorySizeImage', 'openFactoryOptionSorter', 'syncFactoryDbOptions',
    'syncFactoryOptionResults', 'setFactoryOptionColorImageUsage',
    'toggleFactoryAssets', 'toggleFactoryPreviousAssets', 'openFactoryStageFile',
    'openFactoryOptionColorFile', 'addFactoryCompletedFiles', 'openFactoryCompletedFile',
  ]);
  assert.deepEqual(Object.keys(capabilities.renderHelpers), [
    'factoryAutomationCounts', 'factoryAutomationWizardTasks',
    'renderFactoryAutomationStatusCard', 'renderFactoryAutomationAssetChooser',
    'renderFactoryAutomationTaskChecklist',
  ]);

  const html = tab.render(tab.select());
  assert.deepEqual(viewport, { width: 535, height: 697 });
  assert.match(html, /data-factory-guide-action="focus-asset-stage:hero"/);
  for (const stageId of ['hero', 'size', 'options', 'cuts']) {
    assert.match(html, new RegExp(`data-assets-stage="${stageId}"`));
  }
  assert.doesNotMatch(html, /height:\s*697px/);
});

test('Task 7 assets owns click, input, change, keyboard, drag-drop, and disposer paths', async () => {
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getAssetsTab();
  const store = fixture.runtime.getStore();
  const root = fakeRoot();
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()].sort(), [
    'change', 'click', 'dragend', 'dragleave', 'dragover',
    'dragstart', 'drop', 'input', 'keydown',
  ]);

  const targetInput = {
    dataset: { factoryStageTarget: 'hero' }, value: '4',
    closest(selector) { return selector === '[data-factory-stage-target]' ? this : null; },
  };
  root.dispatch('input', targetInput);
  await flushMicrotasks();
  assert.equal(fixture.factory.stages.hero.targetCount, 1);
  assert.equal(store.getSnapshot().factory.stages.hero.targetCount, 4);
  assert.equal(store.getOperationToken().revision, 1);

  const promptInput = {
    dataset: { factoryStagePrompt: 'hero' }, value: '정면 자연광',
    closest(selector) { return selector === '[data-factory-stage-prompt]' ? this : null; },
  };
  root.dispatch('input', promptInput);
  await flushMicrotasks();
  assert.equal(fixture.factory.stages.hero.prompt, '');
  assert.equal(store.getSnapshot().factory.stages.hero.prompt, '정면 자연광');
  assert.equal(store.getOperationToken().revision, 2);

  const useButton = {
    dataset: { factoryAssetUse: 'asset-1' },
    closest(selector) { return selector === '[data-factory-asset-use]' ? this : null; },
  };
  root.dispatch('click', useButton);
  await flushMicrotasks();
  assert.equal(fixture.factory.assets[0].used, false);
  assert.equal(store.getSnapshot().factory.assets[0].used, true);
  assert.equal(store.getOperationToken().revision, 3);

  const stageFile = {
    dataset: { factoryStageFile: 'hero' }, files: [{ type: 'image/png' }], value: 'selected',
    closest(selector) { return selector === '[data-factory-stage-file]' ? this : null; },
  };
  root.dispatch('change', stageFile);
  await flushMicrotasks();
  assert.equal(stageFile.value, '');
  assert.equal(fixture.assetsCalls.includes('stage-files:hero:1'), true);
  assert.equal(store.getOperationToken().revision, 4);

  const dropTarget = {
    dataset: { factoryDrop: 'hero' },
    classList: { add() {}, remove() {} },
    closest(selector) { return selector === '[data-factory-drop]' ? this : null; },
  };
  root.dispatch('keydown', dropTarget, { key: 'Enter' });
  assert.deepEqual(fixture.domClicks, ['factoryStageFile_hero']);
  assert.equal(store.getOperationToken().revision, 4);

  const optionUpload = {
    closest(selector) { return selector === '[data-factory-option-color-upload]' ? this : null; },
  };
  root.dispatch('click', optionUpload);
  assert.deepEqual(fixture.domClicks, ['factoryStageFile_hero', 'option-color-file']);

  const completedButton = {
    closest(selector) { return selector === '#factoryAddCompletedAsset' ? this : null; },
  };
  root.dispatch('click', completedButton);
  assert.deepEqual(fixture.domClicks, [
    'factoryStageFile_hero', 'option-color-file', 'factoryCompleteFile',
  ]);

  const completedFile = {
    files: [{ type: 'image/png' }, { type: 'image/jpeg' }], value: 'selected',
    closest(selector) { return selector === '#factoryCompleteFile' ? this : null; },
  };
  root.dispatch('change', completedFile);
  await flushMicrotasks();
  assert.equal(completedFile.value, '');
  assert.equal(fixture.assetsCalls.includes('completed-files:2'), true);
  assert.equal(store.getOperationToken().revision, 5);

  const dragClasses = new Set();
  const dragCard = {
    dataset: { factoryAssetId: 'asset-1' },
    classList: {
      add(value) { dragClasses.add(value); },
      remove(value) { dragClasses.delete(value); },
    },
    closest(selector) { return selector === '[data-factory-asset-id]' ? this : null; },
  };
  const dragData = new Map();
  const dataTransfer = {
    files: [], effectAllowed: '',
    setData(type, value) { dragData.set(type, value); },
    getData(type) { return dragData.get(type) || ''; },
  };
  root.dispatch('dragstart', dragCard, { dataTransfer });
  assert.equal(dragData.get('text/factory-asset-id'), 'asset-1');
  assert.equal(dataTransfer.effectAllowed, 'copy');
  assert.equal(dragClasses.has('dragging'), true);
  root.dispatch('dragend', dragCard, { dataTransfer });
  assert.equal(dragClasses.has('dragging'), false);

  root.dispatch('drop', dropTarget, { dataTransfer });
  await flushMicrotasks();
  assert.equal(fixture.assetsCalls.includes('send:asset-1:hero'), true);
  assert.equal(store.getOperationToken().revision, 6);

  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 assets rejects read-only mutation and stale async stage completion', async () => {
  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getAssetsTab().invoke('toggleAssetUse', 'asset-1'),
    /READ_ONLY/,
  );
  assert.equal(readOnly.factory.assets[0].used, false);
  assert.equal(readOnly.runtime.getStore().getOperationToken().revision, 0);

  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const stale = await startIntegrationHarness({ assetsDeferred: deferred });
  const store = stale.runtime.getStore();
  const pending = stale.runtime.getAssetsTab().invoke('runStage', 'hero');
  store.switchWorkspace('project-b', { snapshot: store.getSnapshot(), revision: 0 });
  resolve(true);
  await assert.rejects(pending, /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.equal(stale.assetsCalls.includes('run-stage:hero'), true);
  assert.equal(store.getOperationToken().workspaceId, 'project-b');
  assert.equal(store.getOperationToken().revision, 0);
});

test('Task 7 sections installs exact allowlists and preserves section policy controls', async () => {
  const viewport = Object.freeze({ width: 535, height: 697 });
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getSectionsTab();
  const capabilities = fixture.sectionsCapabilities();

  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'renderHelpers', 'reportError',
  ]);
  assert.deepEqual(Object.keys(capabilities.actions), [
    'runFactoryGuideAction', 'runFactoryStage',
  ]);
  assert.deepEqual(Object.keys(capabilities.renderHelpers), [
    'factoryAutomationCounts', 'factoryAutomationWizardTasks',
    'factoryAutomationReviewSummary', 'renderFactoryAutomationStatusCard',
    'renderFactoryAutomationTaskChecklist',
  ]);

  const html = tab.render(tab.select());
  assert.deepEqual(viewport, { width: 535, height: 697 });
  assert.match(html, /<h4>6\. 섹션 생성 기준<\/h4>/);
  assert.match(html, /data-factory-guide-action="apply-sections"/);
  assert.match(html, /data-factory-run-stage="detail"/);
  assert.match(html, /data-factory-guide-action="focus-detail-assets"/);
  assert.match(html, /섹션 체크리스트/);
  assert.doesNotMatch(html, /height:\s*697px/);
});

test('Task 7 sections owns apply, focus, detail-run, and disposer click paths', async () => {
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getSectionsTab();
  const store = fixture.runtime.getStore();
  const root = fakeRoot();
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()], ['click']);

  const apply = {
    dataset: { factoryGuideAction: 'apply-sections' }, disabled: false,
    closest(selector) { return selector === '[data-factory-guide-action]' ? this : null; },
  };
  root.dispatch('click', apply);
  await flushMicrotasks();
  assert.equal(fixture.sectionsCalls.includes('apply-sections'), true);
  assert.equal(fixture.factory.automation.activeTaskId, undefined);
  assert.equal(fixture.factory.automation.sectionPromptPlan, undefined);
  assert.equal(store.getSnapshot().factory.automation.activeTaskId, 'section-ready');
  assert.equal(store.getSnapshot().factory.automation.sectionPromptPlan.size, '확정 DB + 사이즈이미지 고정');
  assert.equal(store.getSnapshot().factory.detailPlacement['asset-1'], 'detail-main');
  assert.equal(store.getOperationToken().revision, 1);
  assert.equal(fixture.renderCount(), 1);

  const focus = {
    dataset: { factoryGuideAction: 'focus-detail-assets' }, disabled: false,
    closest(selector) { return selector === '[data-factory-guide-action]' ? this : null; },
  };
  root.dispatch('click', focus);
  await flushMicrotasks();
  assert.equal(fixture.state.error, '');
  assert.equal(fixture.factory.uiPanels, undefined);
  assert.equal(store.getSnapshot().factory.uiPanels.assets, true);
  assert.equal(store.getOperationToken().revision, 2);
  assert.equal(fixture.renderCount(), 2);

  const run = {
    dataset: { factoryRunStage: 'detail' }, disabled: false,
    closest(selector) { return selector === '[data-factory-run-stage]' ? this : null; },
  };
  root.dispatch('click', run);
  await flushMicrotasks(10);
  assert.equal(fixture.sectionsCalls.includes('run-stage:detail'), true);
  assert.equal(store.getOperationToken().revision, 3);

  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 sections rejects read-only mutation and stale detail completion', async () => {
  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getSectionsTab().invoke('guideAction', 'apply-sections'),
    /READ_ONLY/,
  );
  assert.equal(readOnly.sectionsCalls.includes('apply-sections'), false);
  assert.equal(readOnly.runtime.getStore().getOperationToken().revision, 0);

  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const stale = await startIntegrationHarness({ sectionsDeferred: deferred });
  const store = stale.runtime.getStore();
  const pending = stale.runtime.getSectionsTab().invoke('runStage', 'detail');
  store.switchWorkspace('project-b', { snapshot: store.getSnapshot(), revision: 0 });
  resolve(true);
  await assert.rejects(pending, /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.equal(stale.sectionsCalls.includes('run-stage:detail'), true);
  assert.equal(store.getOperationToken().workspaceId, 'project-b');
  assert.equal(store.getOperationToken().revision, 0);
});

test('Task 7 publish installs only focus routing and renders the final registration panel', async () => {
  const viewport = Object.freeze({ width: 535, height: 697 });
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getPublishTab();
  const capabilities = fixture.publishCapabilities();

  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'renderHelpers', 'reportError',
  ]);
  assert.deepEqual(Object.keys(capabilities.actions), ['runFactoryGuideAction']);
  assert.equal(Object.keys(capabilities.actions).some(name => /register|publish|cafe24/i.test(name)), false);
  assert.deepEqual(Object.keys(capabilities.renderHelpers), [
    'factoryAutomationCounts', 'factoryAutomationWizardTasks',
    'factoryFinalRegistrationSettings', 'renderFactoryAutomationStatusCard',
    'renderFactoryAutomationTaskChecklist', 'factoryRenderCacheBaseDraft',
    'factoryOpenMarketBuildBaseDraft', 'factoryRenderCacheFinalCafe24Model',
    'factoryFinalRegistrationCafe24Model', 'orderedSections', 'escapeHtml',
    'disabledAttr', 'renderFactoryFinalRegistrationPanel',
  ]);

  const html = tab.render(tab.select());
  assert.deepEqual(viewport, { width: 535, height: 697 });
  assert.match(html, /<h4>7\. 전송<\/h4>/);
  assert.match(html, /data-factory-guide-action="focus-final-registration"/);
  assert.match(html, /data-factory-guide-action="focus-stage-log"/);
  assert.match(html, /data-factory-guide-action="focus-materials"/);
  assert.match(html, /id="factoryPublishInlineFinalPanel"/);
  assert.match(html, /data-publish-final-panel/);
  assert.equal(fixture.publishRenderCalls.includes('final-panel'), true);
  assert.doesNotMatch(html, /height:\s*697px/);
});

test('Task 7 publish owns final, log, materials focus routing and disposer', async () => {
  const fixture = await startIntegrationHarness();
  const tab = fixture.runtime.getPublishTab();
  const store = fixture.runtime.getStore();
  const root = fakeRoot();
  const dispose = tab.bind(root);
  assert.deepEqual([...root.listeners.keys()], ['click']);

  const guideButton = action => ({
    dataset: { factoryGuideAction: action }, disabled: false,
    closest(selector) {
      return selector === '[data-factory-guide-action],[data-factory-run-stage]' ? this : null;
    },
  });
  root.dispatch('click', guideButton('focus-final-registration'));
  await flushMicrotasks(10);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fixture.factory.automation.activeTab, 'start');
  assert.equal(fixture.factory.automation.activeTaskId, undefined);
  assert.equal(fixture.factory.uiPanels, undefined);
  assert.equal(store.getSnapshot().factory.automation.activeTab, 'publish');
  assert.equal(store.getOperationToken().revision, 1);
  assert.equal(fixture.renderCount(), 1);
  assert.equal(fixture.domScrolls.includes('#factoryPublishInlineFinalPanel #factoryFinalRegistrationPanel'), true);

  root.dispatch('click', guideButton('focus-stage-log'));
  await flushMicrotasks(10);
  assert.equal(fixture.state.error, '');
  assert.equal(fixture.domScrolls.includes('.factory-run-status-rail'), true);
  assert.equal(store.getOperationToken().revision, 1);
  assert.equal(fixture.renderCount(), 1);

  fixture.factory.uiPanels = { materials: false };
  root.dispatch('click', guideButton('focus-materials'));
  await flushMicrotasks(10);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fixture.factory.uiPanels.materials, false);
  assert.equal(store.getSnapshot().factory.uiPanels.materials, true);
  assert.equal(store.getOperationToken().revision, 2);
  assert.equal(fixture.renderCount(), 2);
  assert.equal(fixture.domScrolls.includes('#factoryMaterialReviewSection'), true);

  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('Task 7 publish rejects read-only and stale focus without invoking registration', async () => {
  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getPublishTab().invoke('guideAction', 'focus-final-registration'),
    /READ_ONLY/,
  );
  assert.equal(readOnly.factory.automation.activeTab, 'start');
  assert.equal(readOnly.runtime.getStore().getOperationToken().revision, 0);

  const stale = await startIntegrationHarness();
  const store = stale.runtime.getStore();
  const pending = stale.runtime.getPublishTab().invoke('guideAction', 'focus-materials');
  store.switchWorkspace('project-b', { snapshot: store.getSnapshot(), revision: 0 });
  await assert.rejects(pending, /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.equal(stale.factory.uiPanels, undefined);
  assert.equal(store.getOperationToken().workspaceId, 'project-b');
  assert.equal(store.getOperationToken().revision, 0);
  assert.deepEqual(Object.keys(stale.publishCapabilities().actions), ['runFactoryGuideAction']);
});

test('Task 7 factory composition installs seven canonical tabs and owns the factory route', async () => {
  const fixture = await startIntegrationHarness();
  const menu = fixture.runtime.getFactoryMenu();
  const capabilities = fixture.factoryMenuCapabilities();
  const ids = [
    'factory/start', 'factory/db', 'factory/fields', 'factory/competitor',
    'factory/assets', 'factory/sections', 'factory/publish',
  ];

  assert.equal(fixture.installRenderCount(), 1);
  assert.equal(menu.id, 'factory');
  assert.deepEqual(Object.keys(capabilities).sort(), [
    'actions', 'assertMutable', 'getOperationToken', 'getSnapshot',
    'isOperationCurrent', 'reportError', 'tabRegistry', 'tabs',
  ]);
  assert.deepEqual(Object.keys(capabilities.actions), ['selectFactoryTab']);
  assert.equal(capabilities.tabs instanceof Map, true);
  assert.equal(capabilities.tabs.size, 7);
  assert.deepEqual([...capabilities.tabs.keys()], ids);
  assert.deepEqual(capabilities.tabRegistry.map(item => item.id), ids);
  assert.equal(Object.isFrozen(capabilities.tabRegistry), true);
  assert.equal(capabilities.tabRegistry.every((item, order) => (
    Object.isFrozen(item) && item.kind === 'factory-tab'
      && item.order === order && item.api === 'factory-tab:v1'
  )), true);

  const html = fixture.runtime.renderRoute('factory');
  assert.match(html, /id="factoryAutomationWizard"/);
  assert.match(html, /data-factory-auto-tab="start"/);
  assert.match(html, /data-factory-auto-tab="db"/);
  assert.match(html, /data-factory-auto-tab="fields"/);
  assert.match(html, /data-factory-auto-tab="competitor"/);
  assert.match(html, /data-factory-auto-tab="assets"/);
  assert.match(html, /data-factory-auto-tab="sections"/);
  assert.match(html, /data-factory-auto-tab="publish"/);
  const shellSource = fs.readFileSync(CORE_03, 'utf8');
  assert.match(shellSource, /activeMenuHtml:\s*renderActiveRuntimeMenu\(menu\)/);
  assert.match(shellSource, /function renderShellFrame\(/);
  assert.match(shellSource, /function bindShellAfterRender\(/);
  assert.doesNotMatch(shellSource, /state\.step === 'factory' \? renderRuntimeMenu\('factory'\) : ''/);

  const withoutMenu = { ...fixture.namespaces };
  delete withoutMenu['src/menus/factory/factory-menu.mjs'];
  assert.throws(
    () => fixture.runtime.install(withoutMenu),
    /missing factory runtime capability: createFactoryMenu/,
  );
});

test('Task 7 factory menu switches by canonical id and renders exactly once', async () => {
  const fixture = await startIntegrationHarness();
  const store = fixture.runtime.getStore();
  const root = fakeRoot();
  fixture.runtime.renderRoute('factory');
  await fixture.runtime.bindRoute('factory', root);

  const dbButton = {
    dataset: { factoryAutoTab: 'db' },
    getAttribute(name) { return name === 'data-factory-auto-tab' ? 'db' : null; },
    closest(selector) { return selector === '[data-factory-auto-tab]' ? this : null; },
  };
  root.dispatch('click', dbButton);
  await flushMicrotasks(10);
  assert.equal(fixture.factory.automation.activeTab, 'start');
  assert.equal(store.getSnapshot().factory.automation.activeTab, 'db');
  assert.equal(store.getOperationToken().revision, 1);
  assert.equal(fixture.renderCount(), 1);

  const html = fixture.runtime.renderRoute('factory');
  assert.match(html, /data-factory-auto-tab="db"[^>]*aria-selected="true"/);
  assert.match(html, /<h4>2\. DB 확정<\/h4>/);
  assert.throws(
    () => fixture.runtime.getFactoryMenu().invoke('selectTab', 'factory/unknown'),
    /unknown factory tab/,
  );
  await fixture.runtime.bindRoute('', root);
  assert.equal(root.listeners.size, 0);
});

test('Task 7 factory route survives fifty enter-leave cycles without listeners', async () => {
  const fixture = await startIntegrationHarness();
  const root = fakeRoot();
  fixture.runtime.renderRoute('factory');
  for (let cycle = 0; cycle < 50; cycle += 1) {
    await fixture.runtime.bindRoute('factory', root);
    assert.equal(root.listeners.size > 0, true, `cycle ${cycle + 1} must bind factory listeners`);
    await fixture.runtime.bindRoute('', root);
    assert.equal(root.listeners.size, 0, `cycle ${cycle + 1} must dispose every listener`);
  }
  await fixture.runtime.bindRoute('', root);
  assert.equal(root.listeners.size, 0);

  const readOnly = await startIntegrationHarness();
  readOnly.setReadOnly(true);
  assert.throws(
    () => readOnly.runtime.getFactoryMenu().invoke('selectTab', 'factory/db'),
    /READ_ONLY/,
  );
  assert.equal(readOnly.factory.automation.activeTab, 'start');
  assert.equal(readOnly.runtime.getStore().getOperationToken().revision, 0);
});
