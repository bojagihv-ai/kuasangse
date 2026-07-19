const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const EVENT_PROPERTIES = Object.freeze([
  'onclick', 'onchange', 'oninput', 'onblur', 'onfocus', 'onkeydown',
  'ondragstart', 'ondragover', 'ondragleave', 'ondrop',
]);

function importMenu(file) {
  const url = pathToFileURL(path.join(ROOT, 'src', 'menus', file)).href;
  return import(`${url}?task7-event-ownership=${Date.now()}-${Math.random()}`);
}

function eventNode(dataset = {}, selector = '') {
  const listeners = new Map();
  return {
    dataset: { ...dataset }, listeners, selector, tagName: 'BUTTON', type: 'button', value: '',
    checked: false, disabled: false, files: [], children: [], style: {}, clickCount: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener); listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = listeners.get(type); bucket?.delete(listener);
      if (!bucket?.size) listeners.delete(type);
    },
    setAttribute() {},
    matches(candidate) { return candidate === selector; },
    closest(candidate) { return this.matches(candidate) ? this : null; },
    click() { this.clickCount += 1; }, focus() {}, select() {},
  };
}

function domRoot(controls) {
  const nodes = new Map(controls.map(control => [control.selector, eventNode(control.dataset, control.selector)]));
  const rootListeners = new Map();
  const rootToken = {};
  for (const node of nodes.values()) node.rootToken = rootToken;
  return {
    nodes, rootListeners,
    contains(node) { return node?.rootToken === rootToken; },
    addEventListener(type, listener) {
      const bucket = rootListeners.get(type) || new Set();
      bucket.add(listener); rootListeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = rootListeners.get(type); bucket?.delete(listener);
      if (!bucket?.size) rootListeners.delete(type);
    },
    querySelector(selector) { return nodes.get(selector) || this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      if (nodes.has(selector)) return [nodes.get(selector)];
      return String(selector).split(',').map(part => nodes.get(part.trim())).filter(Boolean);
    },
  };
}

function activeBindings(node) {
  return EVENT_PROPERTIES.filter(property => typeof node[property] === 'function').length
    + [...node.listeners.values()].reduce((total, bucket) => total + bucket.size, 0);
}

function fire(node, type, event = {}, root = null) {
  const payload = { target: node, preventDefault() {}, stopPropagation() {}, ...event };
  node?.[`on${type}`]?.(payload);
  for (const listener of node?.listeners.get(type) || []) listener(payload);
  for (const listener of root?.rootListeners.get(type) || []) listener(payload);
}

function assertControlsOwned(route, root, controls) {
  for (const control of controls) {
    const node = root.nodes.get(control.selector);
    for (const event of control.events) {
      const propertyBound = typeof node?.[`on${event}`] === 'function';
      const listenerBound = (node?.listeners.get(event)?.size || 0) > 0;
      const delegated = (root.rootListeners.get(event)?.size || 0) > 0;
      assert.ok(propertyBound || listenerBound || delegated,
        `${route} ${control.selector}: ${event} is not owned by menu.bind()`);
    }
  }
}

function functions(overrides = {}) {
  return new Proxy({ ...overrides }, {
    get(target, property) {
      if (Reflect.has(target, property)) return Reflect.get(target, property);
      return () => undefined;
    },
  });
}

function domainCapabilities(actions, overrides = {}) {
  return {
    getSnapshot: () => ({}), assertMutable() {},
    getOperationToken: () => 'workspace:a:fence:1', reportError() {},
    actions: Object.fromEntries(actions.map(name => [name, () => undefined])),
    renderHelpers: functions({ SECTION_BASIS_MODES: [], SECTION_GENERATION_MODES: [] }),
    ...overrides,
  };
}

const c = (selector, events = 'click', dataset = {}) => Object.freeze({
  selector, events: Object.freeze(events.split(' ')), dataset: Object.freeze(dataset),
});

const ROUTE_CONTROLS = Object.freeze({
  upload: Object.freeze([
    c('#uploadArea', 'click dragover drop'), c('#fileInput', 'change'),
    c('#productNameInput', 'input change'), c('#clearAnalysisImages'), c('#addMoreImgBtn'),
    c('#addMoreFileInput', 'change'), c('[data-remove-analysis-img]', 'click', { removeAnalysisImg: '0' }),
    c('#startAnalysis'),
  ]),
  analyzing: Object.freeze([
    c('#stopAnalysisRunBtn'), c('#analysisHubStartBtn'), c('#analysisHubImageOnlyBtn'),
    c('#analysisHubDbMatchBtn'), c('#analysisHubImageSinhwaBtn'), c('#analysisHubImageMultiBtn'),
    c('#analysisHubImageOnlyCafe24Btn'), c('#analysisHubImageOnlyCafe24MatrixBtn'),
    c('#openAutomationManualFromAnalysis'), c('#analysisHubUploadBtn'), c('#analysisHubReplaceBtn'),
    c('#analysisHubClearImagesBtn'), c('#analysisHubUploadZone', 'click dragover drop'),
    c('#analysisHubFileInput', 'change'), c('#analysisHubThumbAddBtn'),
    c('[data-analysis-hub-primary]', 'click', { analysisHubPrimary: '1' }),
    c('#analysisMatchNameInput', 'input change'), c('#analysisNaturalTextInput', 'input change'),
    c('#analysisUseNameToggle', 'change'), c('#analysisUseNaturalToggle', 'change'),
    c('#analysisImageInferenceEngineSelect', 'change'), c('#analysisCafe24RankEngineSelect', 'change'),
    c('#analysisGptOAuthModelSelect', 'change'), c('#analysisGeminiModelSelect', 'change'),
    c('[data-analysis-match-source]', 'change', { analysisMatchSource: 'image' }),
    c('#dbMatchNowBtn'), c('#dbRefreshCurrentBtn'), c('#analysisHubLoadFactoryLatestBtn'),
    c('#dbLoadColorOptionsBtn'), c('#dbApplyColorOptionsBtn'), c('#dbCandidateCloseBtn'),
    c('[data-db-candidate-apply]', 'click', { dbCandidateApply: 'code' }),
    c('[data-cafe24-candidate-apply]', 'click', { cafe24CandidateApply: '1' }),
    c('#productInfoOptionsToggle'), c('#resetProductInfoFieldsBtn'),
    c('[data-product-info-toggle]', 'click', { productInfoToggle: 'name:active' }),
    c('[data-product-info-save]', 'click', { productInfoSave: 'name' }),
    c('[data-product-info-clear]', 'click', { productInfoClear: 'name' }),
    c('[data-analysis-combo]', 'click', { analysisCombo: 'image' }),
    c('[data-analysis-source-toggle]', 'click', { analysisSourceToggle: 'image' }),
  ]),
  competitor: Object.freeze([
    c('[data-comp-mode]', 'click', { compMode: 'image' }), c('[data-comp-back]', 'click', { compBack: 'input' }),
    c('[data-comp-flow-target]', 'click', { compFlowTarget: 'plan' }), c('[data-comp-flow-generate]'),
    c('[data-comp-style-draft]'), c('[data-comp-style-save]'),
    c('#compDropZone', 'click dragover drop'), c('#compImageInput', 'change'),
    c('#loadLatestJepumDetail'), c('#openJepumDetailFolder'),
    c('#compMarketName', 'input'), c('#compMarketTotalTarget', 'input change'),
    c('[data-comp-market-target]', 'input change', { compMarketTarget: 'coupang' }),
    c('#compMarketAutoDetail', 'change'), c('[data-comp-market-site]', 'change', { compMarketSite: 'coupang' }),
    c('#compMarketDrop', 'click dragover drop'), c('#compMarketImageInput', 'change'),
    c('#compMarketUseCurrentImage'), c('#compMarketStart'), c('#compMarketStartLocal'),
    c('[data-comp-market-source-view]', 'click', { compMarketSourceView: 'local' }),
    c('[data-factory-comp-market-total-target]', 'input change'),
    c('[data-factory-comp-market-target]', 'input change', { factoryCompMarketTarget: 'naver' }),
    c('#compMarketReloadSearchResults'), c('#compMarketRecoverDetailImages'), c('#compMarketReloadDetailImages'),
    c('#compMarketDetailSelected'), c('#compMarketVmAnalyze'), c('#compMarketDetailSelectedMain'),
    c('#compMarketDetailSelectedLocalMain'), c('#compMarketVmAnalyzeMain'), c('#compMarketDetailSelectedVm'),
    c('#compMarketDetailSelectedLocal'), c('#compMarketDetailSelectedAnalyzeVm'),
    c('#compMarketSelectAllCandidates'), c('#compMarketClearCandidateSelection'), c('#compMarketClear'),
    c('[data-comp-market-use-url-id]', 'click', { compMarketUseUrlId: 'candidate-1' }),
    c('[data-comp-market-toggle-result]', 'click', { compMarketToggleResult: 'candidate-1' }),
    c('[data-comp-market-quick-action]', 'click', { compMarketQuickAction: 'select-all' }),
    c('[data-comp-market-toggle-image]', 'click', { compMarketToggleImage: 'image-1' }),
    c('[data-comp-market-preview-image]', 'click', { compMarketPreviewImage: 'image-1' }),
    c('#compMarketCloseImagePreview'), c('#compMarketCloseImagePreviewFixed'),
    c('#compMarketOpenVisibleVm'), c('#compMarketManualOpenVm'), c('#compMarketManualResume'),
    c('#compMarketOpenVmLoginSession'), c('#compMarketSelectAllImages'), c('#compMarketClearImageSelection'),
    c('#compMarketAnalyzeSelectedImages'), c('#compMarketAnalyzeAllImages'),
    c('[data-comp-remove-img]', 'click', { compRemoveImg: '0' }), c('#compHtmlInput', 'change'),
    c('#compHtmlText', 'input'), c('#compUrlInput', 'input'), c('#compScraperBase', 'input'),
    c('#compPingBtn'), c('#compStartAnalyze'), c('#compLoadReport'), c('#compLoadPlan'),
    c('#compViewPlan'), c('#compGenPlan'), c('.comp-plan-toggle', 'change', { sid: 'hero' }),
    c('.comp-plan-input', 'input', { sid: 'hero' }),
    c('[data-comp-gen-section]', 'click', { compGenSection: 'hero' }),
    c('#compApplyGenerate'), c('#compApplySections'),
    c('[data-comp-preview-img]', 'click', { compPreviewImg: '0' }),
    c('[data-comp-evidence-open]', 'click', { compEvidenceOpen: '{}' }),
    c('#closeCompImagePreview'), c('#compImagePreviewOverlay'),
    c('#closeCompEvidencePreview'), c('#compEvidencePreviewOverlay'),
  ]),
  sections: Object.freeze([
    c('#generateAll'), c('#generateAll2'), c('#sectionBatchBasisMode', 'click change'),
    c('#sectionBatchGenerationMode', 'click change'), c('#selectMissingSectionsForBatch'),
    c('#clearMissingSectionBatchSelection'), c('#generateAllMissingSections'),
    c('#generateSelectedMissingSections'),
    c('[data-section-batch]', 'click change', { sectionBatch: 'hero' }), c('#addCustomSectionBtn'),
    c('#restoreHiddenSectionsBtn'), c('#saveSectionDriveFolder'), c('#driveConnectFromSections'),
    c('#uploadAllSectionImages'), c('[data-section-toggle]', 'click', { sectionToggle: 'hero' }),
    c('[data-hide-section]', 'click', { hideSection: 'hero' }),
    c('[data-section-input]', 'click input', { sectionInput: 'hero' }),
    c('[data-section-mode]', 'click change', { sectionMode: 'hero' }),
    c('[data-section-basis]', 'click change', { sectionBasis: 'hero' }),
    c('[data-generate-section]', 'click', { generateSection: 'hero' }),
    c('[data-lock-section]', 'click', { lockSection: 'hero' }),
    c('[data-section-generate-comp-plan]', 'click'),
    c('[data-section-open-competitor]', 'click'),
    c('[data-section-assembly-source]', 'click change', { sectionAssemblySource: 'hero:current' }),
    c('[data-section-assembly-cut-usage]', 'click change', { sectionAssemblyCutUsage: 'hero' }),
    c('[data-section-assembly-cut]', 'click change', { sectionAssemblyCut: 'hero' }),
    c('[data-section-assembly-note]', 'click input', { sectionAssemblyNote: 'hero' }),
    c('#autoSectionAssemblyCutsBtn'), c('#clearSectionAssemblyCutsBtn'),
    c('[data-apply-section-helper]', 'click', { applySectionHelper: 'hero' }),
    c('[data-apply-all-section-helpers]'),
  ]),
  generating: Object.freeze([c('#stopAfterCurrentSection')]),
  preview: Object.freeze([
    c('[data-edit-preview]', 'click', { editPreview: 'hero' }),
    c('[data-ai-repair]', 'click', { aiRepair: 'hero' }),
    c('[data-undo-ai-repair]', 'click', { undoAiRepair: 'hero' }),
    c('[data-regen]', 'click', { regen: 'hero' }),
    c('[data-apply-edit]', 'click', { applyEdit: 'hero' }),
    c('[data-edit-input]', 'input', { editInput: 'hero' }),
    c('[data-lock-preview]', 'click', { lockPreview: 'hero' }),
    c('[data-save-manual]', 'click', { saveManual: 'hero' }),
    c('[data-apply-variant]', 'click', { applyVariant: 'hero:variant-a' }),
    c('[data-apply-variant-image]', 'click', { applyVariantImage: 'hero:variant-b' }),
    c('[data-apply-eval-best]', 'click', { applyEvalBest: 'hero' }),
    c('[data-preview-recovered-detail-mode]', 'click', { previewRecoveredDetailMode: 'on' }),
    c('#runQaBtn'), c('#runAiQaBtn'), c('#toggleLayerMode'), c('#resetAllLayers'),
    c('#exportLayeredSVG'), c('#exportPhotoshopPackage'), c('#exportJpgAll'),
    c('#exportJpgSections'), c('#exportHTML'), c('#viewportPc'), c('#viewportMobile'),
  ]),
  imagecuts: Object.freeze([
    c('#cutsUploadArea', 'click dragover drop'), c('#cutsFileInput', 'change'),
    c('#cutsWorkUploadArea', 'click dragover drop'), c('#cutsWorkFileInput', 'change'),
    c('#cutsStyleReferenceToggle', 'change'), c('#genAllCutsBtn'),
    c('[data-cut-prompt]', 'input change blur', { cutPrompt: '0' }),
    c('[data-gen-cut]', 'click', { genCut: '0' }),
  ]),
  optionsorter: Object.freeze([
    c('#optUploadZone', 'click dragover dragleave drop'), c('#optFileInput', 'change'),
    c('#optAddImagesBtn'), c('#optClearImages'),
    c('[data-opt-remove-img]', 'click', { optRemoveImg: 'image-1' }),
    c('#optAddSlotInput'), c('#optGoSort'),
  ]),
  automation: Object.freeze([
    c('#serverAutoRefreshBtn'), c('#connectDriveBtn'), c('#setInputFolder'), c('#setOutputFolder'),
    c('#intervalSlider', 'input'), c('#startAutoBtn'), c('#stopAutoBtn'), c('#runOnceBtn'),
    c('#resetProcessedBtn'),
  ]),
  modelsettings: Object.freeze([
    c('[data-pick-provider]', 'click', { pickProvider: 'gemini' }),
    c('[data-pick-model]', 'click', { pickModel: 'model' }),
    c('[data-pick-imgmodel]', 'click', { pickImgmodel: 'image-model' }),
    c('#toggleGeminiKey'), c('#toggleOpenAIKey'), c('#imgSizeModeAuto'), c('#imgSizeModeCustom'),
    c('#saveModelSettings'), c('#loadVertexConfigBtn'), c('#saveVertexConfigBtn'),
    c('[data-gpt-oauth-preset]', 'click', { gptOauthPreset: 'balanced' }),
    c('[id$="gptOAuthModelSelect"]', 'change'), c('[id$="gptOAuthReasoningSelect"]', 'change'),
    c('[id$="gptOAuthServiceTierSelect"]', 'change'), c('[id$="useGptOAuthAsLlmBtn"]'),
    c('[id$="probeGptOAuthBtn"]'),
    c('[id$="refreshGptOAuthStatusBtn"]'), c('[id$="openGptOAuthLoginBtn"]'),
    c('[id$="forceGptOAuthLoginBtn"]'),
  ]),
  manual: Object.freeze([c('[data-nav]', 'click', { nav: 'analyzing' })]),
});

async function createRouteMenu(route, calls = []) {
  if (route === 'upload') {
    const actionNames = [
      'uploadFiles', 'updateProductName', 'saveProductName',
      'clearAnalysisImages', 'removeAnalysisImage', 'startAnalysis',
    ];
    return (await importMenu('upload-menu.mjs')).createUploadMenu(domainCapabilities(actionNames, {
      actions: Object.fromEntries(actionNames.map(name => [name, value => calls.push([name, value])])),
    }));
  }
  if (route === 'analyzing') {
    const actionNames = ['stopAnalysis', 'updateProductName', 'commitProductName', 'startAnalysis', 'uploadFiles', 'applyDbCandidate'];
    return (await importMenu('analysis-menu.mjs')).createAnalysisMenu(domainCapabilities(actionNames, {
      actions: Object.fromEntries(actionNames.map(name => [name, value => calls.push([name, value])])),
    }));
  }
  if (route === 'competitor') {
    const names = [
      'setMode', 'setSubStep', 'navigateFlow', 'generatePlan', 'applyStylePreset', 'importImages',
      'loadLatestDetailImages', 'openDetailFolder', 'updateMarketName', 'updateMarketTarget',
      'setMarketAutoCapture', 'setMarketSite', 'importMarketImage', 'useCurrentProductImage',
      'startMarketSearch', 'setCandidateSourceView', 'reloadMarketResults', 'recoverDetailImages',
      'reloadDetailImages', 'captureDetails', 'captureDetailsAndAnalyze', 'selectAllCandidates',
      'clearCandidateSelection', 'clearMarket', 'useCandidateUrl', 'toggleCandidate', 'runMarketQuickAction',
      'toggleMarketImage', 'previewMarketImage', 'closeMarketImagePreview', 'openVisibleVm', 'resumeDetailJob',
      'openVmLogin', 'selectAllMarketImages', 'clearMarketImageSelection', 'analyzeMarketImages',
      'previewUploadedImage', 'closeUploadedImagePreview', 'openEvidencePreview', 'closeEvidencePreview',
      'removeUploadedImage', 'importHtmlFile', 'updateHtmlText', 'updateUrl', 'updateScraperBase',
      'pingBackend', 'startAnalysis', 'loadSavedReport', 'loadSavedPlan', 'updatePlanEnabled',
      'updatePlanInstructions', 'generateSection', 'applyPlan', 'maybeRecoverDetailImages',
    ];
    return (await importMenu('competitor-menu.mjs')).createCompetitorMenu(domainCapabilities(names, {
      actions: Object.fromEntries(names.map(name => [name, (value, context) => calls.push([name, value, context.operationToken])])),
    }));
  }
  if (route === 'sections') {
    const names = [
      'generateAll', 'updateBatchBasisMode', 'updateBatchGenerationMode',
      'selectMissingSections', 'clearMissingSectionSelection', 'generateMissingSections',
      'updateBatchSelection', 'addCustomSection', 'restoreHiddenSections', 'saveDriveFolder',
      'connectDrive', 'uploadAllSectionImages', 'toggleSection', 'hideSection',
      'updateSectionInstruction', 'setSectionGenerationMode', 'setSectionBasisMode',
      'generateSection', 'toggleSectionLock', 'navigate', 'generateCompetitorPlan',
      'openCompetitor', 'updateSectionAssemblySource', 'updateSectionAssemblyCutUsage',
      'updateSectionAssemblyCut', 'updateSectionAssemblyNote', 'autoDistributeSectionAssemblyCuts',
      'clearSectionAssemblyCutUsage', 'applySectionImageHelperTips', 'applyAllSectionImageHelperTips',
    ];
    return (await importMenu('sections-menu.mjs')).createSectionsMenu(domainCapabilities(names, {
      actions: Object.fromEntries(names.map(name => [name, (value, context) => calls.push([name, value, context.operationToken])])),
    }));
  }
  if (route === 'generating') return (await importMenu('generating-menu.mjs')).createGeneratingMenu(domainCapabilities(['stopAfterCurrent'], {
    actions: { stopAfterCurrent: (value, context) => calls.push(['stopAfterCurrent', value, context.operationToken]) },
  }));
  if (route === 'preview') {
    const names = [
      'setViewport', 'navigate', 'startGenerating', 'togglePreviewEdit', 'openAiRepair',
      'undoAiRepair', 'regenerateSection', 'applyPreviewEdit', 'updatePreviewInstruction',
      'runQaCheck', 'runAiQaCheck', 'toggleLayerMode', 'resetAllLayers', 'exportLayeredSVG',
      'exportPhotoshopPackage', 'exportJpgAll', 'exportJpgSections', 'exportHTML',
      'setSectionLock', 'saveManualSection', 'applySectionVariant', 'applySectionVariantImage',
      'applyBestEvaluatedVariant', 'setRecoveredDetailMode',
    ];
    return (await importMenu('preview-menu.mjs')).createPreviewMenu(domainCapabilities(names, {
      actions: Object.fromEntries(names.map(name => [name, (value, context) => calls.push([name, value, context.operationToken])])),
    }));
  }
  if (route === 'manual') return (await importMenu('manual-menu.mjs')).createManualMenu({
    getWorkflowSteps: () => [], escapeHtml: String,
    navigate: value => calls.push(['navigate', value]),
  });
  if (route === 'modelsettings') {
    return (await importMenu('modelsettings-menu.mjs')).createModelSettingsMenu({
      providers: { gemini: { models: [{ id: 'model' }] } }, imageModels: [{ id: 'image-model' }],
      normalizeConfig: value => ({ llmProvider: 'gemini', llmModel: 'model', imageModel: 'image-model', ...(value || {}) }),
      getImageProvider: () => 'gemini', getRuntimeOpenAIKey: () => '', renderGptOAuthPanel: () => '',
      disabledAttr: () => '', isGptOAuthConnected: () => true, getReasoningLabel: String,
      getServiceTierLabel: String, escapeHtml: String, assertMutable() {}, updatePreferences() {},
      savePreferences() {}, saveCredentials() {}, loadVertexConfig: async () => ({}),
      saveVertexConfig: async value => value, updateVertexConfig() {}, requestRender() {},
      getOperationToken: () => 'workspace:a:fence:1', getSnapshot: () => ({ modelConfig: {} }),
      applyGptOAuthPreset: value => calls.push(['applyGptOAuthPreset', value]),
      selectGptOAuthModel: value => calls.push(['selectGptOAuthModel', value]),
      selectGptOAuthReasoning: value => calls.push(['selectGptOAuthReasoning', value]),
      selectGptOAuthServiceTier: value => calls.push(['selectGptOAuthServiceTier', value]),
      useGptOAuthAsLlm: () => calls.push(['useGptOAuthAsLlm']),
      refreshGptOAuthStatus: () => calls.push(['refreshGptOAuthStatus']),
      probeGptOAuth: () => calls.push(['probeGptOAuth']),
      openGptOAuthLogin: force => calls.push(['openGptOAuthLogin', force]),
    });
  }
  if (route === 'automation') {
    return (await importMenu('automation-menu.mjs')).createAutomationMenu(functions({
      getSnapshot: () => ({ automation: { serverApiBase: '', serverConfig: { profiles: {} } }, logs: [] }),
      assertMutable() {}, updateAutomation() {}, persistAutomation() {}, refreshServer: async () => ({}),
      applyServerSnapshot() {}, pollServerStatus: async () => ({}), applyServerStatus() {},
      connectDrive: async () => ({}), setFolder: async value => value, saveProfile: async value => value,
      runMode: async value => value, applyRunResult() {}, setModeEnabled: async value => value,
      refreshOutput: async value => value, applyOutputResult() {}, openOutputPreview() {},
      startAutomation() {}, stopAutomation() {}, runOnce() {}, resetProcessed() {}, requestRender() {},
      getOperationToken: () => 'workspace:a:fence:1', setIntervalFn: () => 1, clearIntervalFn() {},
      formatServerDriveMessage: () => '', renderModeEditor: () => '', renderPlacementPanel: () => '',
      makeDefaultProfile: () => ({}), disabledAttr: () => '', escapeHtml: String, escapeAttr: String,
    }));
  }
  if (route === 'imagecuts') {
    const names = [
      'loadSource', 'goFactoryStart', 'clearSource', 'loadWorkImage', 'clearWorkImage', 'runWorkDrive',
      'chooseArchive', 'archiveAll', 'downloadAll', 'saveSession', 'recoverPrompts', 'resetGeneration',
      'setCutSlotCount', 'setSizeSlotCount', 'generateCut', 'generateSizeCut', 'generateAllCuts',
      'generateAllSizeCuts', 'clearCutResults', 'clearSizeResults', 'applyPlacement', 'resolveWorkFolder',
    ];
    return (await importMenu('imagecuts-menu.mjs')).createImageCutsMenu(functions({
      getSnapshot: () => ({ cuts: { prompts: [{}], sizePrompts: [] } }), assertMutable() {},
      updateCuts() {}, updatePrompt() {}, updatePlacement() {}, persistCuts() {}, requestRender() {},
      getOperationToken: () => 'workspace:a:fence:1', promptUser: () => '', reportError() {},
      actions: Object.fromEntries(names.map(name => [name, () => undefined])), renderHelpers: functions(),
    }));
  }
  if (route === 'optionsorter') {
    return (await importMenu('optionsorter-menu.mjs')).createOptionSorterMenu(functions({
      getSnapshot: () => ({ optionSorter: { images: [], pool: [], slots: [], subStep: 'input' } }),
      assertMutable() {}, mutateOptions() {}, persistOptions() {}, loadVisionColors: async () => ({}),
      applyVisionColors() {}, requestRender() {}, getOperationToken: () => 'workspace:a:fence:1',
      reportError() {}, bindHelpers: functions({ getCurrentStep: () => 'other', getSortable: () => null }),
      renderHelpers: functions(),
    }));
  }
  throw new Error(`unsupported route: ${route}`);
}

for (const route of Object.keys(ROUTE_CONTROLS)) {
  test(`Task 7 ${route} menu.bind owns rendered controls without classic bindEvents`, async () => {
    const controls = ROUTE_CONTROLS[route];
    const calls = [];
    const menu = await createRouteMenu(route, calls);
    const root = domRoot(controls);
    const outsideRoot = domRoot(controls);
    menu.onEnter();
    const dispose = menu.bind(root);
    assert.equal(typeof dispose, 'function');
    assertControlsOwned(route, root, controls);
    for (const node of outsideRoot.nodes.values()) assert.equal(activeBindings(node), 0,
      `${route}: bind escaped the route root`);
    assert.equal(outsideRoot.rootListeners.size, 0, `${route}: delegated bind escaped the route root`);

    let duplicateDispose;
    if (route === 'upload' || route === 'manual') {
      duplicateDispose = menu.bind(root);
      assertControlsOwned(route, root, controls);
    }
    if (route === 'upload') {
      const files = [{ name: 'one.png', type: 'image/png' }];
      fire(root.nodes.get('#uploadArea'), 'click');
      fire(root.nodes.get('#uploadArea'), 'dragover');
      fire(root.nodes.get('#uploadArea'), 'drop', { dataTransfer: { files } });
      fire(root.nodes.get('#fileInput'), 'change', { target: { files } });
      fire(root.nodes.get('#productNameInput'), 'input', { target: { value: '새 상품' } });
      fire(root.nodes.get('#productNameInput'), 'change');
      fire(root.nodes.get('#clearAnalysisImages'), 'click');
      fire(root.nodes.get('[data-remove-analysis-img]'), 'click');
      fire(root.nodes.get('#addMoreImgBtn'), 'click');
      fire(root.nodes.get('#addMoreFileInput'), 'change', { target: { files } });
      fire(root.nodes.get('#startAnalysis'), 'click');
      assert.equal(root.nodes.get('#fileInput').clickCount, 1);
      assert.equal(root.nodes.get('#addMoreFileInput').clickCount, 1);
      assert.deepEqual(calls, [
        ['uploadFiles', files], ['uploadFiles', files], ['updateProductName', '새 상품'],
        ['saveProductName', undefined], ['clearAnalysisImages', undefined],
        ['removeAnalysisImage', 0], ['uploadFiles', files], ['startAnalysis', undefined],
      ]);
    }
    if (route === 'analyzing') {
      const files = [{ name: 'analysis.png', type: 'image/png' }];
      const nameInput = root.nodes.get('#analysisMatchNameInput');
      nameInput.value = '분석 상품';
      fire(nameInput, 'input', {}, root);
      fire(nameInput, 'change', {}, root);
      fire(root.nodes.get('#analysisHubStartBtn'), 'click', {}, root);
      fire(root.nodes.get('#analysisHubUploadBtn'), 'click', {}, root);
      const fileInput = root.nodes.get('#analysisHubFileInput');
      fire(fileInput, 'change', { target: { ...fileInput, files } }, root);
      fire(root.nodes.get('[data-db-candidate-apply]'), 'click', {}, root);
      const unknown = eventNode({}, '[data-unknown-analysis-action]');
      fire(unknown, 'click', {}, root);
      assert.equal(fileInput.clickCount, 1);
      assert.deepEqual(calls, [
        ['updateProductName', '분석 상품'], ['commitProductName', undefined],
        ['startAnalysis', undefined], ['uploadFiles', { files, replace: false }],
        ['applyDbCandidate', 'code'],
      ]);
      const staleClick = [...root.rootListeners.get('click')][0];
      menu.onLeave();
      staleClick({ target: root.nodes.get('#analysisHubStartBtn'), preventDefault() {}, stopPropagation() {} });
      assert.equal(calls.length, 5, 'stale analysis listener must be a no-op after route switch');
      menu.onEnter();
    }
    if (route === 'generating') {
      fire(root.nodes.get('#stopAfterCurrentSection'), 'click', {}, root);
      assert.deepEqual(calls, [['stopAfterCurrent', undefined, 'workspace:a:fence:1']]);
    }
    if (route === 'competitor') {
      const imageFiles = [{ name: 'competitor.png', type: 'image/png' }];
      const htmlFile = { name: 'competitor.html', type: 'text/html' };
      fire(root.nodes.get('[data-comp-mode]'), 'click', {}, root);
      fire(root.nodes.get('#compDropZone'), 'drop', { dataTransfer: { files: imageFiles } }, root);
      root.nodes.get('#compHtmlInput').files = [htmlFile];
      fire(root.nodes.get('#compHtmlInput'), 'change', {}, root);
      fire(root.nodes.get('#compMarketStart'), 'click', {}, root);
      fire(root.nodes.get('#compMarketStartLocal'), 'click', {}, root);
      const target = root.nodes.get('[data-comp-market-target]'); target.value = '7';
      fire(target, 'input', {}, root);
      const toggle = root.nodes.get('[data-comp-market-toggle-result]');
      fire(toggle, 'click', {}, root);
      const planToggle = root.nodes.get('.comp-plan-toggle'); planToggle.checked = true;
      fire(planToggle, 'change', {}, root);
      const planInput = root.nodes.get('.comp-plan-input'); planInput.value = 'plan-instruction';
      fire(planInput, 'input', {}, root);
      const semanticCalls = calls.filter(([name]) => name !== 'maybeRecoverDetailImages');
      assert.deepEqual(semanticCalls.slice(0, 9), [
        ['setMode', 'image', 'workspace:a:fence:1'],
        ['importImages', imageFiles, 'workspace:a:fence:1'],
        ['importHtmlFile', htmlFile, 'workspace:a:fence:1'],
        ['startMarketSearch', 'vm', 'workspace:a:fence:1'],
        ['startMarketSearch', 'local', 'workspace:a:fence:1'],
        ['updateMarketTarget', { siteId: 'coupang', value: '7', commit: false }, 'workspace:a:fence:1'],
        ['toggleCandidate', 'candidate-1', 'workspace:a:fence:1'],
        ['updatePlanEnabled', { sectionId: 'hero', enabled: true }, 'workspace:a:fence:1'],
        ['updatePlanInstructions', { sectionId: 'hero', instructions: 'plan-instruction' }, 'workspace:a:fence:1'],
      ]);
      const staleClick = [...root.rootListeners.get('click')][0];
      menu.onLeave();
      staleClick({ target: root.nodes.get('#compMarketStart'), preventDefault() {}, stopPropagation() {} });
      assert.equal(calls.length, 10, 'stale competitor listener must be a no-op after workspace switch');
      menu.onEnter();
    }
    if (route === 'sections') {
      fire(root.nodes.get('#generateAll'), 'click', {}, root);
      const batchBasis = root.nodes.get('#sectionBatchBasisMode'); batchBasis.value = 'current';
      fire(batchBasis, 'change', {}, root);
      const batchGeneration = root.nodes.get('#sectionBatchGenerationMode'); batchGeneration.value = 'text_only';
      fire(batchGeneration, 'change', {}, root);
      fire(root.nodes.get('#selectMissingSectionsForBatch'), 'click', {}, root);
      fire(root.nodes.get('#clearMissingSectionBatchSelection'), 'click', {}, root);
      fire(root.nodes.get('#generateAllMissingSections'), 'click', {}, root);
      fire(root.nodes.get('#generateSelectedMissingSections'), 'click', {}, root);
      const batch = root.nodes.get('[data-section-batch]'); batch.checked = true;
      fire(batch, 'change', {}, root);
      fire(root.nodes.get('#addCustomSectionBtn'), 'click', {}, root);
      fire(root.nodes.get('#restoreHiddenSectionsBtn'), 'click', {}, root);
      fire(root.nodes.get('#saveSectionDriveFolder'), 'click', {}, root);
      fire(root.nodes.get('#driveConnectFromSections'), 'click', {}, root);
      fire(root.nodes.get('#uploadAllSectionImages'), 'click', {}, root);
      fire(root.nodes.get('[data-section-toggle]'), 'click', {}, root);
      fire(root.nodes.get('[data-hide-section]'), 'click', {}, root);
      const sectionInput = root.nodes.get('[data-section-input]'); sectionInput.value = 'section-instruction';
      fire(sectionInput, 'input', {}, root);
      const sectionMode = root.nodes.get('[data-section-mode]'); sectionMode.value = 'text_only';
      fire(sectionMode, 'change', {}, root);
      const sectionBasis = root.nodes.get('[data-section-basis]'); sectionBasis.value = 'current';
      fire(sectionBasis, 'change', {}, root);
      fire(root.nodes.get('[data-generate-section]'), 'click', {}, root);
      fire(root.nodes.get('[data-lock-section]'), 'click', {}, root);
      fire(root.nodes.get('[data-section-generate-comp-plan]'), 'click', {}, root);
      fire(root.nodes.get('[data-section-open-competitor]'), 'click', {}, root);
      const assemblySource = root.nodes.get('[data-section-assembly-source]');
      assemblySource.checked = true;
      fire(assemblySource, 'change', {}, root);
      const assemblyUsage = root.nodes.get('[data-section-assembly-cut-usage]');
      assemblyUsage.value = 'section';
      fire(assemblyUsage, 'change', {}, root);
      const assemblyCut = root.nodes.get('[data-section-assembly-cut]');
      assemblyCut.value = 'cut:hero';
      fire(assemblyCut, 'change', {}, root);
      const assemblyNote = root.nodes.get('[data-section-assembly-note]');
      assemblyNote.value = 'assembly-note';
      fire(assemblyNote, 'input', {}, root);
      fire(root.nodes.get('#autoSectionAssemblyCutsBtn'), 'click', {}, root);
      fire(root.nodes.get('#clearSectionAssemblyCutsBtn'), 'click', {}, root);
      fire(root.nodes.get('[data-apply-section-helper]'), 'click', {}, root);
      fire(root.nodes.get('[data-apply-all-section-helpers]'), 'click', {}, root);
      assert.deepEqual(calls, [
        ['generateAll', undefined, 'workspace:a:fence:1'],
        ['updateBatchBasisMode', 'current', 'workspace:a:fence:1'],
        ['updateBatchGenerationMode', 'text_only', 'workspace:a:fence:1'],
        ['selectMissingSections', undefined, 'workspace:a:fence:1'],
        ['clearMissingSectionSelection', undefined, 'workspace:a:fence:1'],
        ['generateMissingSections', { all: true }, 'workspace:a:fence:1'],
        ['generateMissingSections', { all: false }, 'workspace:a:fence:1'],
        ['updateBatchSelection', { sectionId: 'hero', selected: true }, 'workspace:a:fence:1'],
        ['addCustomSection', undefined, 'workspace:a:fence:1'],
        ['restoreHiddenSections', undefined, 'workspace:a:fence:1'],
        ['saveDriveFolder', '', 'workspace:a:fence:1'],
        ['connectDrive', undefined, 'workspace:a:fence:1'],
        ['uploadAllSectionImages', undefined, 'workspace:a:fence:1'],
        ['toggleSection', 'hero', 'workspace:a:fence:1'],
        ['hideSection', 'hero', 'workspace:a:fence:1'],
        ['updateSectionInstruction', { sectionId: 'hero', value: 'section-instruction' }, 'workspace:a:fence:1'],
        ['setSectionGenerationMode', { sectionId: 'hero', modeId: 'text_only' }, 'workspace:a:fence:1'],
        ['setSectionBasisMode', { sectionId: 'hero', basisId: 'current' }, 'workspace:a:fence:1'],
        ['generateSection', 'hero', 'workspace:a:fence:1'],
        ['toggleSectionLock', 'hero', 'workspace:a:fence:1'],
        ['generateCompetitorPlan', undefined, 'workspace:a:fence:1'],
        ['openCompetitor', undefined, 'workspace:a:fence:1'],
        ['updateSectionAssemblySource', { sectionId: 'hero', sourceId: 'current', selected: true }, 'workspace:a:fence:1'],
        ['updateSectionAssemblyCutUsage', { sectionId: 'hero', cutUsage: 'section' }, 'workspace:a:fence:1'],
        ['updateSectionAssemblyCut', { sectionId: 'hero', cutAssetKey: 'cut:hero' }, 'workspace:a:fence:1'],
        ['updateSectionAssemblyNote', { sectionId: 'hero', note: 'assembly-note' }, 'workspace:a:fence:1'],
        ['autoDistributeSectionAssemblyCuts', undefined, 'workspace:a:fence:1'],
        ['clearSectionAssemblyCutUsage', undefined, 'workspace:a:fence:1'],
        ['applySectionImageHelperTips', 'hero', 'workspace:a:fence:1'],
        ['applyAllSectionImageHelperTips', undefined, 'workspace:a:fence:1'],
      ]);
      const staleClick = [...root.rootListeners.get('click')][0];
      menu.onLeave();
      staleClick({ target: root.nodes.get('#generateAll'), preventDefault() {}, stopPropagation() {} });
      assert.equal(calls.length, 30, 'stale sections listener must be a no-op after workspace switch');
      menu.onEnter();
    }
    if (route === 'preview') {
      fire(root.nodes.get('[data-edit-preview]'), 'click', {}, root);
      fire(root.nodes.get('[data-ai-repair]'), 'click', {}, root);
      fire(root.nodes.get('[data-undo-ai-repair]'), 'click', {}, root);
      fire(root.nodes.get('[data-regen]'), 'click', {}, root);
      const editInput = root.nodes.get('[data-edit-input]'); editInput.value = 'preview-instruction';
      fire(editInput, 'input', {}, root);
      fire(root.nodes.get('[data-apply-edit]'), 'click', {}, root);
      fire(root.nodes.get('#runQaBtn'), 'click', {}, root);
      fire(root.nodes.get('#runAiQaBtn'), 'click', {}, root);
      fire(root.nodes.get('#toggleLayerMode'), 'click', {}, root);
      fire(root.nodes.get('#resetAllLayers'), 'click', {}, root);
      fire(root.nodes.get('#exportLayeredSVG'), 'click', {}, root);
      fire(root.nodes.get('#exportPhotoshopPackage'), 'click', {}, root);
      fire(root.nodes.get('#exportJpgAll'), 'click', {}, root);
      fire(root.nodes.get('#exportJpgSections'), 'click', {}, root);
      fire(root.nodes.get('#exportHTML'), 'click', {}, root);
      fire(root.nodes.get('#viewportPc'), 'click', {}, root);
      fire(root.nodes.get('#viewportMobile'), 'click', {}, root);
      assert.deepEqual(calls, [
        ['togglePreviewEdit', 'hero', 'workspace:a:fence:1'],
        ['openAiRepair', 'hero', 'workspace:a:fence:1'],
        ['undoAiRepair', 'hero', 'workspace:a:fence:1'],
        ['regenerateSection', 'hero', 'workspace:a:fence:1'],
        ['updatePreviewInstruction', { sectionId: 'hero', value: 'preview-instruction' }, 'workspace:a:fence:1'],
        ['applyPreviewEdit', { sectionId: 'hero', value: 'preview-instruction' }, 'workspace:a:fence:1'],
        ['runQaCheck', undefined, 'workspace:a:fence:1'],
        ['runAiQaCheck', undefined, 'workspace:a:fence:1'],
        ['toggleLayerMode', undefined, 'workspace:a:fence:1'],
        ['resetAllLayers', undefined, 'workspace:a:fence:1'],
        ['exportLayeredSVG', undefined, 'workspace:a:fence:1'],
        ['exportPhotoshopPackage', undefined, 'workspace:a:fence:1'],
        ['exportJpgAll', undefined, 'workspace:a:fence:1'],
        ['exportJpgSections', undefined, 'workspace:a:fence:1'],
        ['exportHTML', undefined, 'workspace:a:fence:1'],
        ['setViewport', 'pc', 'workspace:a:fence:1'],
        ['setViewport', 'mobile', 'workspace:a:fence:1'],
      ]);
      const outsideEdit = outsideRoot.nodes.get('[data-edit-preview]');
      fire(outsideEdit, 'click', {}, root);
      assert.equal(calls.length, 17, 'preview delegated bind escaped the route root');
      const staleClick = [...root.rootListeners.get('click')][0];
      menu.onLeave();
      staleClick({ target: root.nodes.get('[data-edit-preview]'), preventDefault() {}, stopPropagation() {} });
      assert.equal(calls.length, 17, 'stale preview listener must be a no-op after route switch');
      menu.onEnter();
    }
    if (route === 'manual') {
      fire(root.nodes.get('[data-nav]'), 'click');
      assert.deepEqual(calls, [['navigate', 'analyzing']]);
    }
    if (route === 'modelsettings') {
      root.nodes.get('[id$="gptOAuthModelSelect"]').value = 'gpt-5.6-sol';
      root.nodes.get('[id$="gptOAuthReasoningSelect"]').value = 'high';
      root.nodes.get('[id$="gptOAuthServiceTierSelect"]').value = 'standard';
      fire(root.nodes.get('[data-gpt-oauth-preset]'), 'click', {}, root);
      fire(root.nodes.get('[id$="gptOAuthModelSelect"]'), 'change', {}, root);
      fire(root.nodes.get('[id$="gptOAuthReasoningSelect"]'), 'change', {}, root);
      fire(root.nodes.get('[id$="gptOAuthServiceTierSelect"]'), 'change', {}, root);
      fire(root.nodes.get('[id$="useGptOAuthAsLlmBtn"]'), 'click', {}, root);
      fire(root.nodes.get('[id$="probeGptOAuthBtn"]'), 'click', {}, root);
      fire(root.nodes.get('[id$="refreshGptOAuthStatusBtn"]'), 'click', {}, root);
      fire(root.nodes.get('[id$="openGptOAuthLoginBtn"]'), 'click', {}, root);
      fire(root.nodes.get('[id$="forceGptOAuthLoginBtn"]'), 'click', {}, root);
      assert.deepEqual(calls, [
        ['applyGptOAuthPreset', 'balanced'],
        ['selectGptOAuthModel', 'gpt-5.6-sol'],
        ['selectGptOAuthReasoning', 'high'],
        ['selectGptOAuthServiceTier', 'standard'],
        ['useGptOAuthAsLlm'],
        ['probeGptOAuth'],
        ['refreshGptOAuthStatus'],
        ['openGptOAuthLogin', false],
        ['openGptOAuthLogin', true],
      ]);
      const staleClick = [...root.rootListeners.get('click')][0];
      menu.onLeave();
      staleClick({ target: root.nodes.get('[data-gpt-oauth-preset]'), preventDefault() {}, stopPropagation() {} });
      assert.equal(calls.length, 9, 'stale modelsettings listener must be a no-op after route switch');
      menu.onEnter();
    }
    duplicateDispose?.();
    if (duplicateDispose) assertControlsOwned(route, root, controls);
    dispose(); dispose(); duplicateDispose?.(); menu.onLeave();
    for (const node of root.nodes.values()) assert.equal(activeBindings(node), 0,
      `${route}: disposer left an event binding`);
    assert.equal(root.rootListeners.size, 0, `${route}: disposer left a delegated event binding`);
  });
}

test('Task 7 classic bindEvents owns zero route-specific selectors', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
  const start = source.indexOf('function bindEvents()');
  const end = source.indexOf('let aiRepairMaskHistory', start);
  assert.ok(start >= 0 && end > start, 'classic bindEvents boundary must remain discoverable during migration');
  const binder = source.slice(start, end);
  const a1Selectors = [
    '#analysisLogToggle', '#toggleRawJson', '#brandPresetSelect', '#layoutTemplateSelect',
    '#newBrandPresetBtn', '#saveBrandPresetBtn', '#deleteBrandPresetBtn',
    '#brandPresetName', '#brandPresetTone', '#brandPresetKeywords', '#brandPresetBanned',
    '#brandPresetHeadlineFont', '#brandPresetBodyFont', '#brandPresetAccent', '#brandPresetBackground',
    '#brandPresetImageDirectives', '#brandPresetGlobalInstruction', '#brandPresetAccentPicker',
    '#brandPresetBackgroundPicker', '#openRemainingSectionsAfterStop',
    '[data-section-mode-choice]', '[data-section-basis-choice]',
  ];
  const a2Selectors = [
    '[data-section-generate-comp-plan]', '[data-section-open-competitor]',
    '[data-section-assembly-source]', '[data-section-assembly-cut-usage]',
    '[data-section-assembly-cut]', '[data-section-assembly-note]',
    '#autoSectionAssemblyCutsBtn', '#clearSectionAssemblyCutsBtn',
    '[data-apply-section-helper]', '[data-apply-all-section-helpers]',
    'sectionSortable',
  ];
  const selectors = [...new Set([
    ...Object.values(ROUTE_CONTROLS).flat().map(control => control.selector), ...a1Selectors, ...a2Selectors,
  ])]
    .filter(selector => selector !== '[data-nav]');
  const retained = selectors.filter(selector => binder.includes(selector.replace(/^#/, '')));
  assert.deepEqual(retained, [], `classic route selectors remain: ${retained.join(', ')}`);
  assert.match(binder, /\[data-eval-section-variants\]/,
    'async variant evaluation start remains outside Preview B1 scope');
});

test('Task 7 repeated bind/dispose leaves zero route listeners after 50 cycles', async () => {
  for (const route of Object.keys(ROUTE_CONTROLS)) {
    const menu = await createRouteMenu(route);
    const root = domRoot(ROUTE_CONTROLS[route]);
    for (let cycle = 0; cycle < 50; cycle += 1) {
      menu.onEnter(); const dispose = menu.bind(root); dispose(); dispose(); menu.onLeave();
      for (const node of root.nodes.values()) assert.equal(activeBindings(node), 0,
        `${route}: cycle ${cycle + 1}`);
    }
  }
});

test('Task 7 B1 A1 menu ownership routes panel, preset, section-choice, and stop-preview actions through capabilities', async () => {
  const calls = [];
  const analysisHelpers = await importMenu('analysis-menu.mjs');
  const bindAnalysisPanelEvents = analysisHelpers.createAnalysisMenu.bindAnalysisPanelEvents;
  assert.equal(typeof bindAnalysisPanelEvents, 'function');
  const sectionsNames = [
    'addCustomSection', 'restoreHiddenSections', 'setSectionGenerationMode', 'setSectionBasisMode',
    'toggleAnalysisLog', 'toggleRawJson', 'selectBrandPreset', 'selectLayoutTemplate', 'createBrandPreset',
    'saveBrandPreset', 'deleteBrandPreset', 'updateBrandPresetDraft',
  ];
  const sections = (await importMenu('sections-menu.mjs')).createSectionsMenu(domainCapabilities([
    'generateAll', 'generateSection', 'navigate', ...sectionsNames,
  ], {
    actions: Object.fromEntries(['generateAll', 'generateSection', 'navigate', ...sectionsNames].map(name => [
      name, value => calls.push([name, value]),
    ])),
    renderHelpers: functions({
      SECTION_BASIS_MODES: [{ id: 'current' }], SECTION_GENERATION_MODES: [{ id: 'text_only' }],
      bindAnalysisPanelEvents,
    }),
  }));
  const sectionsRoot = domRoot([
    c('#analysisLogToggle'), c('#toggleRawJson'), c('#brandPresetSelect', 'change'),
    c('#layoutTemplateSelect', 'change'), c('#newBrandPresetBtn'), c('#saveBrandPresetBtn'), c('#deleteBrandPresetBtn'),
    c('#brandPresetName', 'input'), c('#brandPresetTone', 'input'), c('#brandPresetKeywords', 'input'),
    c('#brandPresetBanned', 'input'), c('#brandPresetHeadlineFont', 'input'), c('#brandPresetBodyFont', 'input'),
    c('#brandPresetAccent', 'input blur'), c('#brandPresetBackground', 'input blur'),
    c('#brandPresetImageDirectives', 'input'), c('#brandPresetGlobalInstruction', 'input'),
    c('#brandPresetAccentPicker', 'input'), c('#brandPresetBackgroundPicker', 'input'),
    c('#addCustomSectionBtn'), c('#restoreHiddenSectionsBtn'),
    c('[data-section-mode-choice]', 'click', { sectionModeChoice: 'hero:text_only' }),
    c('[data-section-basis-choice]', 'click', { sectionBasisChoice: 'hero:current' }),
  ]);
  sections.onEnter();
  const sectionsDispose = sections.bind(sectionsRoot);
  sections.bind(sectionsRoot);
  sectionsRoot.nodes.get('#brandPresetSelect').value = 'brand-1';
  sectionsRoot.nodes.get('#layoutTemplateSelect').value = 'editorial';
  fire(sectionsRoot.nodes.get('#analysisLogToggle'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#toggleRawJson'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#brandPresetSelect'), 'change', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#layoutTemplateSelect'), 'change', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#newBrandPresetBtn'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#saveBrandPresetBtn'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#deleteBrandPresetBtn'), 'click', {}, sectionsRoot);
  const presetFieldValues = [
    ['#brandPresetName', '브랜드'], ['#brandPresetTone', '차분함'], ['#brandPresetKeywords', '안심'],
    ['#brandPresetBanned', '최저가'], ['#brandPresetHeadlineFont', 'Pretendard'],
    ['#brandPresetBodyFont', 'Pretendard'], ['#brandPresetAccent', '#112233'],
    ['#brandPresetBackground', '#fefefe'], ['#brandPresetImageDirectives', '부드러운 조명'],
    ['#brandPresetGlobalInstruction', '짧고 명확하게'],
  ];
  for (const [selector, value] of presetFieldValues) {
    const node = sectionsRoot.nodes.get(selector); node.value = value;
    fire(node, 'input', {}, sectionsRoot);
  }
  sectionsRoot.nodes.get('#brandPresetAccentPicker').value = '#abcdef';
  fire(sectionsRoot.nodes.get('#brandPresetAccentPicker'), 'input', {}, sectionsRoot);
  sectionsRoot.nodes.get('#brandPresetBackgroundPicker').value = '#fedcba';
  fire(sectionsRoot.nodes.get('#brandPresetBackgroundPicker'), 'input', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#addCustomSectionBtn'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('#restoreHiddenSectionsBtn'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('[data-section-mode-choice]'), 'click', {}, sectionsRoot);
  fire(sectionsRoot.nodes.get('[data-section-basis-choice]'), 'click', {}, sectionsRoot);
  assert.deepEqual(calls, [
    ['toggleAnalysisLog', undefined], ['toggleRawJson', undefined], ['selectBrandPreset', 'brand-1'],
    ['selectLayoutTemplate', 'editorial'], ['createBrandPreset', undefined],
    ['saveBrandPreset', undefined], ['deleteBrandPreset', undefined],
    ...presetFieldValues.map(([selector, value]) => ['updateBrandPresetDraft', {
      field: ({
        '#brandPresetName': 'name', '#brandPresetTone': 'tone', '#brandPresetKeywords': 'requiredKeywords',
        '#brandPresetBanned': 'bannedPhrases', '#brandPresetHeadlineFont': 'headlineFont',
        '#brandPresetBodyFont': 'bodyFont', '#brandPresetAccent': 'accentColor',
        '#brandPresetBackground': 'backgroundColor', '#brandPresetImageDirectives': 'imageDirectives',
        '#brandPresetGlobalInstruction': 'globalInstruction',
      })[selector], value,
    }]),
    ['updateBrandPresetDraft', { field: 'accentColor', value: '#abcdef' }],
    ['updateBrandPresetDraft', { field: 'backgroundColor', value: '#fedcba' }],
    ['addCustomSection', undefined], ['restoreHiddenSections', undefined],
    ['setSectionGenerationMode', { sectionId: 'hero', modeId: 'text_only' }],
    ['setSectionBasisMode', { sectionId: 'hero', basisId: 'current' }],
  ]);
  sectionsDispose(); sections.onLeave();

  calls.length = 0;
  const preview = (await importMenu('preview-menu.mjs')).createPreviewMenu(domainCapabilities([
    'setViewport', 'navigate', 'startGenerating', 'openRemainingSectionsAfterStop',
  ], {
    actions: Object.fromEntries(['setViewport', 'navigate', 'startGenerating', 'openRemainingSectionsAfterStop'].map(name => [
      name, value => calls.push([name, value]),
    ])),
  }));
  const previewRoot = domRoot([c('#openRemainingSectionsAfterStop')]);
  preview.onEnter();
  const previewDispose = preview.bind(previewRoot);
  fire(previewRoot.nodes.get('#openRemainingSectionsAfterStop'), 'click', {}, previewRoot);
  assert.deepEqual(calls, [['openRemainingSectionsAfterStop', undefined]]);
  previewDispose(); preview.onLeave();
});

test('Task 7 B1 B1 preview controls dispatch root-scoped semantic payloads and fence stale async actions', async () => {
  const calls = [];
  const names = [
    'setViewport', 'navigate', 'startGenerating',
    'setSectionLock', 'saveManualSection', 'applySectionVariant', 'applySectionVariantImage',
    'applyBestEvaluatedVariant', 'setRecoveredDetailMode',
  ];
  const preview = (await importMenu('preview-menu.mjs')).createPreviewMenu(domainCapabilities(names, {
    getSnapshot: () => ({
      sectionLocks: { hero: false },
      sectionContents: { hero: { layout_suggestion: '기존 레이아웃' } },
    }),
    actions: Object.fromEntries(names.map(name => [name, (value, context) => {
      calls.push([name, value, context.operationToken]);
    }])),
  }));
  const root = domRoot([
    c('[data-lock-preview]', 'click', { lockPreview: 'hero' }),
    c('[data-save-manual]', 'click', { saveManual: 'hero' }),
    c('[data-apply-variant]', 'click', { applyVariant: 'hero:variant-a' }),
    c('[data-apply-variant-image]', 'click', { applyVariantImage: 'hero:variant-b' }),
    c('[data-apply-eval-best]', 'click', { applyEvalBest: 'hero' }),
    c('[data-preview-recovered-detail-mode]', 'click', { previewRecoveredDetailMode: 'on' }),
    c('[data-manual-headline="hero"]', 'input'),
    c('[data-manual-subheadline="hero"]', 'input'),
    c('[data-manual-body="hero"]', 'input'),
    c('[data-manual-cta="hero"]', 'input'),
    c('[data-manual-extra="hero"]', 'input'),
  ]);
  root.nodes.get('[data-manual-headline="hero"]').value = '헤드라인';
  root.nodes.get('[data-manual-subheadline="hero"]').value = '서브헤드라인';
  root.nodes.get('[data-manual-body="hero"]').value = '본문';
  root.nodes.get('[data-manual-cta="hero"]').value = 'CTA';
  root.nodes.get('[data-manual-extra="hero"]').value = '추가 1\n추가 2';

  preview.onEnter();
  const dispose = preview.bind(root);
  preview.bind(root);
  fire(root.nodes.get('[data-lock-preview]'), 'click', {}, root);
  fire(root.nodes.get('[data-save-manual]'), 'click', {}, root);
  fire(root.nodes.get('[data-apply-variant]'), 'click', {}, root);
  fire(root.nodes.get('[data-apply-variant-image]'), 'click', {}, root);
  fire(root.nodes.get('[data-apply-eval-best]'), 'click', {}, root);
  fire(root.nodes.get('[data-preview-recovered-detail-mode]'), 'click', {}, root);
  assert.deepEqual(calls, [
    ['setSectionLock', { sectionId: 'hero', locked: true }, 'workspace:a:fence:1'],
    ['saveManualSection', { sectionId: 'hero', patch: {
      headline: '헤드라인', subheadline: '서브헤드라인', body_text: '본문', cta_text: 'CTA',
      extra_elements: '추가 1\n추가 2', layout_suggestion: '기존 레이아웃',
    } }, 'workspace:a:fence:1'],
    ['applySectionVariant', { sectionId: 'hero', variantId: 'variant-a' }, 'workspace:a:fence:1'],
    ['applySectionVariantImage', { sectionId: 'hero', variantId: 'variant-b' }, 'workspace:a:fence:1'],
    ['applyBestEvaluatedVariant', { sectionId: 'hero' }, 'workspace:a:fence:1'],
    ['setRecoveredDetailMode', true, 'workspace:a:fence:1'],
  ]);
  const staleClick = [...root.rootListeners.get('click')][0];
  preview.onLeave();
  staleClick({ target: root.nodes.get('[data-apply-variant-image]'), preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.length, 6, 'route-leave listener must not dispatch a stale image variant action');
  dispose(); dispose();
  assert.equal(root.rootListeners.size, 0, 'duplicate bind/dispose must leave no delegated listeners');
});
