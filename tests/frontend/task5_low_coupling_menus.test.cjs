const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function absolute(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function source(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

async function importFresh(relativePath) {
  return import(`${pathToFileURL(absolute(relativePath)).href}?task5=${Date.now()}-${Math.random()}`);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] || character));
}

const MANUAL_STEPS = Object.freeze([
  Object.freeze({
    n: 1,
    title: '사진 <분석>',
    short: '상품을 파악합니다.',
    detail: '사진과 직접 입력한 상품명을 함께 확인합니다.',
    output: '분석 결과',
  }),
]);

test('MENU-MANUAL API: manual route는 allowlisted factory 하나만 공개하는 실제 ESM이다', async () => {
  const relativePath = 'src/menus/manual-menu.mjs';
  assert.equal(fs.existsSync(absolute(relativePath)), true, `${relativePath} is required`);
  const module = await importFresh(relativePath);
  assert.deepEqual(Object.keys(module).sort(), ['createManualMenu']);
});

test('MENU-MANUAL activation/render: 주입 capability만으로 기존 한국어 화면을 렌더한다', async () => {
  const { createManualMenu } = await importFresh('src/menus/manual-menu.mjs');
  const menu = createManualMenu({
    getWorkflowSteps: () => MANUAL_STEPS,
    escapeHtml,
  });

  assert.equal(menu.version, 'menu:v1');
  assert.equal(menu.id, 'manual');
  assert.deepEqual(menu.routes, ['manual']);
  assert.deepEqual(menu.ownedSlices, ['manualUi']);
  assert.deepEqual(menu.capabilities, []);
  assert.deepEqual(Object.keys(menu.commands), []);
  assert.deepEqual(menu.persistence, { reads: [], writes: [] });

  const html = menu.render(menu.select({ manualUi: { expandedTopic: '' } }));
  assert.match(html, /상세페이지 자동화 설명서/);
  assert.match(html, /제품 분석 화면으로/);
  assert.match(html, /사진 &lt;분석&gt;/);
  assert.doesNotMatch(html, /사진 <분석>/);
  assert.match(html, /data-manual-nav="analyzing"/);
  assert.doesNotMatch(html, /data-nav="analyzing"/);
});

test('MENU-MANUAL owner/save-reload/read-only: 읽기 전용 메뉴는 상태를 쓰거나 저장하지 않는다', async () => {
  const { createManualMenu } = await importFresh('src/menus/manual-menu.mjs');
  const menu = createManualMenu({ getWorkflowSteps: () => MANUAL_STEPS, escapeHtml });
  const before = Object.freeze({ manualUi: Object.freeze({ expandedTopic: 'analysis' }) });
  const selected = menu.select(before);

  assert.deepEqual(selected, { expandedTopic: 'analysis' });
  assert.equal(selected, before.manualUi);
  assert.throws(() => menu.invoke('mutateOwner'), /undeclared command/);
  assert.deepEqual(before, { manualUi: { expandedTopic: 'analysis' } });
  assert.deepEqual(menu.persistence.reads, []);
  assert.deepEqual(menu.persistence.writes, []);

  const reloaded = Object.freeze({ manualUi: Object.freeze({ expandedTopic: 'db' }) });
  assert.deepEqual(menu.select(reloaded), { expandedTopic: 'db' });
});

test('MENU-MANUAL lifecycle: 50회 enter/leave가 listener·timer·save를 늘리지 않는다', async () => {
  const { createManualMenu } = await importFresh('src/menus/manual-menu.mjs');
  const counters = { listeners: 0, timers: 0, saves: 0, enters: 0, leaves: 0 };
  const menu = createManualMenu({ getWorkflowSteps: () => MANUAL_STEPS, escapeHtml });

  for (let cycle = 0; cycle < 50; cycle += 1) {
    menu.onEnter({ counters });
    counters.enters += 1;
    const dispose = menu.bind({ counters });
    dispose();
    dispose();
    menu.onLeave({ counters });
    counters.leaves += 1;
  }

  assert.deepEqual(counters, { listeners: 0, timers: 0, saves: 0, enters: 50, leaves: 50 });
});

test('MENU-MANUAL failure/source boundary: 잘못된 capability는 안전하게 실패하고 classic 구현은 제거된다', async () => {
  const { createManualMenu } = await importFresh('src/menus/manual-menu.mjs');
  assert.throws(() => createManualMenu({ getWorkflowSteps: null, escapeHtml }), /getWorkflowSteps/);
  assert.throws(() => createManualMenu({ getWorkflowSteps: () => MANUAL_STEPS, escapeHtml: null }), /escapeHtml/);

  const menuSource = source('src/menus/manual-menu.mjs');
  assert.doesNotMatch(menuSource, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(menuSource, /\bstate\s*\./);
  assert.doesNotMatch(source('src/app-core-05.js'), /function\s+renderAutomationManual\s*\(/);
  assert.doesNotMatch(source('dist/app-runtime.bundle.js'), /function\s+renderAutomationManual\s*\(/);
});

const MODELSETTINGS_CONFIG = Object.freeze({
  llmProvider: 'gemini',
  llmModel: 'gemini-text',
  imageModel: 'gemini-image',
  imageSizeMode: 'auto',
  imageWidth: 860,
  imageHeight: null,
  openaiKey: '',
});

const MODELSETTINGS_PROVIDERS = Object.freeze({
  gpt_oauth: Object.freeze({ label: 'ChatGPT 로그인 OAuth', models: Object.freeze([
    Object.freeze({ id: 'gpt-oauth', label: 'GPT OAuth', desc: 'OAuth', inputPerM: 0, outputPerM: 0 }),
  ]) }),
  gemini: Object.freeze({ label: 'Google Gemini', models: Object.freeze([
    Object.freeze({ id: 'gemini-text', label: 'Gemini Text', desc: 'Gemini', inputPerM: 1, outputPerM: 2 }),
  ]) }),
  openai: Object.freeze({ label: 'OpenAI', models: Object.freeze([
    Object.freeze({ id: 'gpt-5.4-nano', label: 'GPT Nano', desc: 'OpenAI', inputPerM: 1, outputPerM: 2 }),
  ]) }),
});

const MODELSETTINGS_IMAGES = Object.freeze([
  Object.freeze({ id: 'gemini-image', label: 'Gemini Image', desc: 'Gemini image', provider: 'gemini', inputPerM: 1, outputPerM: 2 }),
  Object.freeze({ id: 'gpt-image', label: 'GPT Image', desc: 'OpenAI image', provider: 'openai', inputPerM: 1, outputPerM: 2, imageOut: 0.04 }),
]);

function createModelSettingsCapabilities(overrides = {}) {
  const calls = [];
  let operationToken = 'workspace:one:1';
  const capabilities = {
    providers: MODELSETTINGS_PROVIDERS,
    imageModels: MODELSETTINGS_IMAGES,
    normalizeConfig: value => ({ ...MODELSETTINGS_CONFIG, ...(value || {}) }),
    getImageProvider: modelId => String(modelId).startsWith('gpt') ? 'openai' : 'gemini',
    getRuntimeOpenAIKey: () => 'runtime-only-key',
    renderGptOAuthPanel: () => '<div data-gpt-oauth-panel>OAuth panel</div>',
    disabledAttr: disabled => disabled ? 'disabled' : '',
    isGptOAuthConnected: () => true,
    getReasoningLabel: value => value || 'low',
    getServiceTierLabel: value => value || 'standard',
    escapeHtml,
    assertMutable: () => {},
    updatePreferences: patch => { calls.push(['updatePreferences', patch]); return patch; },
    savePreferences: value => { calls.push(['savePreferences', value]); return value; },
    saveCredentials: value => { calls.push(['saveCredentials', value]); },
    loadVertexConfig: async () => ({ project: 'loaded-project', location: 'us-central1' }),
    saveVertexConfig: async value => ({ ok: true, ...value }),
    updateVertexConfig: value => { calls.push(['updateVertexConfig', value]); },
    requestRender: () => { calls.push(['requestRender']); },
    getOperationToken: () => operationToken,
    ...overrides,
  };
  return {
    capabilities,
    calls,
    setOperationToken(value) { operationToken = value; },
  };
}

test('MENU-SETTINGS API/render: allowlisted ESM 계약과 기존 모델 설정 DOM을 보존한다', async () => {
  const relativePath = 'src/menus/modelsettings-menu.mjs';
  assert.equal(fs.existsSync(absolute(relativePath)), true, `${relativePath} is required`);
  const module = await importFresh(relativePath);
  assert.deepEqual(Object.keys(module).sort(), ['createModelSettingsMenu']);
  const { capabilities } = createModelSettingsCapabilities();
  const menu = module.createModelSettingsMenu(capabilities);

  assert.equal(menu.id, 'modelsettings');
  assert.deepEqual(menu.routes, ['modelsettings']);
  assert.deepEqual(menu.ownedSlices, ['appPreferences']);
  assert.match(menu.render({
    modelConfig: MODELSETTINGS_CONFIG,
    backendBaseUrl: '',
    apiKey: '',
    vertexConfig: null,
  }), /id="saveModelSettings"[\s\S]*id="saveVertexConfigBtn"[\s\S]*id="loadVertexConfigBtn"/);
});

test('MENU-SETTINGS commands/read-only/save: owner 명령을 검증하고 저장본에서 OpenAI key를 제외한다', async () => {
  const { createModelSettingsMenu } = await importFresh('src/menus/modelsettings-menu.mjs');
  const mutable = createModelSettingsCapabilities();
  const menu = createModelSettingsMenu(mutable.capabilities);

  menu.invoke('selectProvider', 'openai');
  menu.invoke('selectModel', { provider: 'openai', modelId: 'gpt-5.4-nano' });
  menu.invoke('selectImageModel', 'gpt-image');
  menu.invoke('setImageSizeMode', 'custom');
  menu.invoke('saveSettings', {
    modelConfig: { ...MODELSETTINGS_CONFIG, openaiKey: 'must-not-persist', imageWidth: 1024 },
    backendBaseUrl: 'http://127.0.0.1:15155',
    geminiKey: 'gemini-secret',
    openaiKey: 'openai-secret',
  });

  const saved = mutable.calls.find(([name]) => name === 'savePreferences')?.[1];
  assert.equal(saved.modelConfig.openaiKey, undefined);
  assert.equal(JSON.stringify(saved).includes('must-not-persist'), false);
  assert.ok(mutable.calls.some(([name]) => name === 'saveCredentials'));

  const readOnly = createModelSettingsCapabilities({
    assertMutable: () => { throw new Error('READ_ONLY'); },
  });
  const readOnlyMenu = createModelSettingsMenu(readOnly.capabilities);
  assert.throws(() => readOnlyMenu.invoke('selectProvider', 'openai'), /READ_ONLY/);
  assert.equal(readOnly.calls.length, 0);
});

test('MENU-SETTINGS lifecycle/bind: addEventListener 기반 disposer가 50회 후 listener를 남기지 않는다', async () => {
  const { createModelSettingsMenu } = await importFresh('src/menus/modelsettings-menu.mjs');
  const { capabilities } = createModelSettingsCapabilities();
  const menu = createModelSettingsMenu(capabilities);
  let activeListeners = 0;
  const provider = {
    dataset: { pickProvider: 'openai' },
    addEventListener(type, listener) { if (type === 'click') activeListeners += 1; this.listener = listener; },
    removeEventListener(type, listener) { if (type === 'click' && listener === this.listener) activeListeners -= 1; },
  };
  const root = {
    querySelectorAll(selector) { return selector === '[data-pick-provider]' ? [provider] : []; },
    querySelector() { return null; },
  };

  for (let cycle = 0; cycle < 50; cycle += 1) {
    menu.onEnter();
    const dispose = menu.bind(root);
    assert.equal(activeListeners, 1);
    dispose();
    dispose();
    menu.onLeave();
    assert.equal(activeListeners, 0);
  }
});

test('MENU-SETTINGS async stale guard: leave 또는 operation token 변경 뒤 Vertex 완료를 무시한다', async () => {
  let resolveLoad;
  const pending = new Promise(resolve => { resolveLoad = resolve; });
  const harness = createModelSettingsCapabilities({ loadVertexConfig: () => pending });
  const { createModelSettingsMenu } = await importFresh('src/menus/modelsettings-menu.mjs');
  const menu = createModelSettingsMenu(harness.capabilities);
  menu.onEnter();
  const resultPromise = menu.invoke('loadVertex');
  harness.setOperationToken('workspace:two:2');
  menu.onLeave();
  resolveLoad({ project: 'stale-project', location: 'asia-northeast1' });
  const result = await resultPromise;

  assert.deepEqual(result, { ignored: true, reason: 'stale-operation' });
  assert.equal(harness.calls.some(([name]) => name === 'updateVertexConfig'), false);
});

test('MENU-SETTINGS source boundary: 모듈은 global을 읽지 않고 classic/bundle 구현은 제거된다', async () => {
  const menuSource = source('src/menus/modelsettings-menu.mjs');
  assert.doesNotMatch(menuSource, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(menuSource, /\bstate\s*\./);
  assert.doesNotMatch(source('src/app-core-06.js'), /function\s+renderModelSettings\s*\(/);
  assert.doesNotMatch(source('src/app-core-06.js'), /\/\/ ── 모델 설정 이벤트 ──/);
  assert.doesNotMatch(source('dist/app-runtime.bundle.js'), /function\s+renderModelSettings\s*\(/);
});

const AUTOMATION_VIEW = Object.freeze({
  automation: Object.freeze({
    driveConnected: false,
    serverApiBase: 'http://127.0.0.1:4000/v1',
    serverConfig: null,
    serverStatus: null,
    serverLoading: false,
    serverError: '',
    inputFolderId: '',
    outputFolderId: '',
    inputFolderName: '',
    outputFolderName: '',
    intervalMin: 10,
    running: false,
    nextRunAt: null,
    currentItem: null,
    currentMsg: '',
    currentProgress: 0,
    totalProcessed: 0,
    queue: Object.freeze([]),
    processedFileIds: Object.freeze([]),
    completed: Object.freeze([]),
  }),
  savedClientId: '',
  logs: Object.freeze([]),
});

function createAutomationCapabilities(overrides = {}) {
  const calls = [];
  let token = 'workspace:one:1';
  let nextTimer = 1;
  const timers = new Set();
  const capabilities = {
    getSnapshot: () => AUTOMATION_VIEW,
    assertMutable: () => {},
    updateAutomation: patch => { calls.push(['updateAutomation', patch]); },
    persistAutomation: value => { calls.push(['persistAutomation', value]); },
    refreshServer: async base => ({ base, profiles: {}, status: {} }),
    applyServerSnapshot: value => { calls.push(['applyServerSnapshot', value]); },
    pollServerStatus: async () => ({ byMode: {} }),
    applyServerStatus: value => { calls.push(['applyServerStatus', value]); },
    connectDrive: async () => ({ ok: true }),
    setFolder: async value => ({ ...value, name: '폴더' }),
    saveProfile: async value => value,
    runMode: async value => value,
    applyRunResult: value => { calls.push(['applyRunResult', value]); },
    setModeEnabled: async value => value,
    refreshOutput: async value => value,
    applyOutputResult: value => { calls.push(['applyOutputResult', value]); },
    openOutputPreview: value => { calls.push(['openOutputPreview', value]); },
    startAutomation: () => { calls.push(['startAutomation']); },
    stopAutomation: () => { calls.push(['stopAutomation']); },
    runOnce: () => { calls.push(['runOnce']); },
    resetProcessed: () => { calls.push(['resetProcessed']); },
    requestRender: () => { calls.push(['requestRender']); },
    getOperationToken: () => token,
    setIntervalFn: callback => { const id = nextTimer++; timers.add(id); return id; },
    clearIntervalFn: id => { timers.delete(id); },
    formatServerDriveMessage: () => '',
    renderModeEditor: () => '<div data-server-mode-editor></div>',
    renderPlacementPanel: () => '<div data-placement-panel></div>',
    makeDefaultProfile: mode => ({ mode }),
    disabledAttr: disabled => disabled ? 'disabled' : '',
    escapeHtml,
    escapeAttr: escapeHtml,
    ...overrides,
  };
  return {
    capabilities,
    calls,
    timers,
    setToken(value) { token = value; },
  };
}

test('MENU-AUTO API/render: allowlisted ESM 계약과 자동화 핵심 DOM을 보존한다', async () => {
  const relativePath = 'src/menus/automation-menu.mjs';
  assert.equal(fs.existsSync(absolute(relativePath)), true, `${relativePath} is required`);
  const module = await importFresh(relativePath);
  assert.deepEqual(Object.keys(module).sort(), ['createAutomationMenu']);
  const harness = createAutomationCapabilities();
  const menu = module.createAutomationMenu(harness.capabilities);
  assert.equal(menu.id, 'automation');
  assert.deepEqual(menu.routes, ['automation']);
  assert.deepEqual(menu.ownedSlices, ['automation']);
  const html = menu.render(AUTOMATION_VIEW);
  assert.match(html, /자동화 시스템/);
  assert.match(html, /id="serverAutoRefreshBtn"/);
  assert.match(html, /id="connectDriveBtn"/);
});

test('MENU-AUTO commands/read-only: owner 명령만 상태·저장을 변경한다', async () => {
  const { createAutomationMenu } = await importFresh('src/menus/automation-menu.mjs');
  const harness = createAutomationCapabilities();
  const menu = createAutomationMenu(harness.capabilities);
  menu.invoke('setApiBase', 'http://127.0.0.1:15156/v1');
  menu.invoke('setIntervalMinutes', 15);
  menu.invoke('resetProcessed');
  assert.ok(harness.calls.some(([name]) => name === 'updateAutomation'));
  assert.ok(harness.calls.some(([name]) => name === 'persistAutomation'));
  assert.ok(harness.calls.some(([name]) => name === 'resetProcessed'));

  const readOnly = createAutomationCapabilities({ assertMutable: () => { throw new Error('READ_ONLY'); } });
  const readOnlyMenu = createAutomationMenu(readOnly.capabilities);
  assert.throws(() => readOnlyMenu.invoke('setIntervalMinutes', 20), /READ_ONLY/);
  assert.equal(readOnly.calls.length, 0);
});

test('MENU-AUTO lifecycle: 50회 enter/leave가 polling timer와 listener를 남기지 않는다', async () => {
  const { createAutomationMenu } = await importFresh('src/menus/automation-menu.mjs');
  const harness = createAutomationCapabilities();
  const menu = createAutomationMenu(harness.capabilities);
  const root = { querySelectorAll: () => [], querySelector: () => null };
  for (let cycle = 0; cycle < 50; cycle += 1) {
    menu.onEnter();
    const dispose = menu.bind(root);
    assert.equal(harness.timers.size, 1);
    dispose();
    dispose();
    menu.onLeave();
    assert.equal(harness.timers.size, 0);
  }
});

test('MENU-AUTO async stale guard: workspace token 변경 뒤 서버 응답을 무시한다', async () => {
  let resolveRefresh;
  const pending = new Promise(resolve => { resolveRefresh = resolve; });
  const harness = createAutomationCapabilities({ refreshServer: () => pending });
  const { createAutomationMenu } = await importFresh('src/menus/automation-menu.mjs');
  const menu = createAutomationMenu(harness.capabilities);
  menu.onEnter();
  const resultPromise = menu.invoke('refreshServer', 'http://127.0.0.1:15156/v1');
  harness.setToken('workspace:two:2');
  menu.onLeave();
  resolveRefresh({ profiles: { stale: true } });
  assert.deepEqual(await resultPromise, { ignored: true, reason: 'stale-operation' });
  assert.equal(harness.calls.some(([name]) => name === 'applyServerSnapshot'), false);
});

test('MENU-AUTO source boundary: 구현과 polling/bind는 classic bundle에서 제거된다', async () => {
  const menuSource = source('src/menus/automation-menu.mjs');
  assert.doesNotMatch(menuSource, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(menuSource, /\bstate\s*\./);
  assert.doesNotMatch(source('src/app-core-06.js'), /function\s+renderAutomation\s*\(/);
  assert.doesNotMatch(source('src/app-core-06.js'), /function\s+startAutoTabPolling\s*\(/);
  assert.doesNotMatch(source('src/app-core-06.js'), /bindAutomationEvents/);
  assert.doesNotMatch(source('dist/app-runtime.bundle.js'), /function\s+renderAutomation\s*\(/);
});

const IMAGECUTS_VIEW = Object.freeze({
  cuts: {
    sourceBase64: null,
    sourceMime: null,
    sourcePreview: null,
    workImageBase64: null,
    workImageMime: null,
    workImagePreview: null,
    styleReferenceEnabled: true,
    workDriveFolderId: '',
    workDriveFolderName: '',
    workDriveRunning: false,
    localArchiveFolderName: '',
    localArchiveStatus: '',
    localArchiveSavedCount: 0,
    localArchiveSaving: false,
    runBusy: false,
    runStatus: '',
    runStatusType: '',
    runLogs: [],
    promptSlotCount: 1,
    prompts: [{ id: 'cut-1', label: '컷 1', prompt: '', result: null, generating: false }],
    sizePromptSlotCount: 1,
    sizePrompts: [{ id: 'size-1', label: '사이즈컷 1', prompt: '', result: null, generating: false }],
    sizeRunBusy: false,
    placement: {},
    factoryStageId: '',
  },
});

function createImageCutsCapabilities(overrides = {}) {
  const calls = [];
  let token = 'workspace:cuts:1';
  const actionNames = [
    'loadSource', 'goFactoryStart', 'clearSource', 'loadWorkImage', 'clearWorkImage',
    'runWorkDrive', 'chooseArchive', 'archiveAll', 'downloadAll', 'saveSession',
    'recoverPrompts', 'resetGeneration', 'setCutSlotCount', 'setSizeSlotCount',
    'generateCut', 'generateSizeCut', 'generateAllCuts', 'generateAllSizeCuts',
    'clearCutResults', 'clearSizeResults', 'applyPlacement',
  ];
  const actions = Object.fromEntries(actionNames.map(name => [name, value => {
    calls.push([name, value]);
    return value;
  }]));
  actions.resolveWorkFolder = async value => ({ id: value, name: '이미지컷 폴더' });
  const renderHelpers = {
    defaultPromptCount: 4,
    sessionAssetsHydrated: () => true,
    hasPromptFields: () => false,
    hasDriveService: () => false,
    factoryClearDisconnectedImageGenerationRuntime: () => {},
    cutsClearOverdueGenerationRuntime: () => {},
    factoryHasCurrentPageImageGenerationRun: () => false,
    factoryClearRestoredImageGenerationRuntime: () => {},
    cutsHasActiveImageGeneration: () => false,
    syncCutPromptsFromDom: () => {},
    cutsShouldRunRenderMaintenance: () => false,
    restoreCutImagePayloadsFromPreview: () => {},
    normalizeCutPromptSlotCount: value => value || 1,
    normalizeCutPrompts: value => value,
    restoreSizeCutResultsFromCache: () => {},
    factoryRestoreCutPromptResultsFromAssets: () => 0,
    clearLocalFallbackResultsFromPrompts: () => 0,
    applyLatestCutPromptSlotBackups: () => ({ changed: false }),
    restoreGeneralCutsAfterSizeMix: () => false,
    clearFinishedCutGenerationFlagsFromLogs: () => false,
    factoryRejectLocalFallbackAssetsForStage: () => {},
    cutsDataUrlFromPayload: () => '',
    cutsCurrentLockedProductSourceState: () => ({ required: false, ready: true, message: '' }),
    cutImageFingerprint: () => '',
    factoryCutPromptPreviewSrc: prompt => prompt?.result || '',
    getCurrentImageRunInfo: () => ({ modelLabel: '테스트 모델', modelId: 'test', route: 'test' }),
    hasImageConnection: () => true,
    renderCutsRunLogPanel: () => '',
    renderFactoryLightImage: () => '',
    cutGeneratingHelperText: () => '',
    cutsVisibleLogText: () => '',
    renderFactoryCutPromptPreviewImage: () => '',
    renderSizeCutsPanel: () => '',
    renderDetailSectionPlacementPanel: () => '<div data-placement-panel></div>',
    disabledAttr: disabled => disabled ? 'disabled' : '',
    escapeHtml,
    escapeAttr: escapeHtml,
  };
  const capabilities = {
    getSnapshot: () => IMAGECUTS_VIEW,
    assertMutable: () => {},
    updateCuts: patch => { calls.push(['updateCuts', patch]); },
    updatePrompt: value => { calls.push(['updatePrompt', value]); },
    updatePlacement: value => { calls.push(['updatePlacement', value]); },
    persistCuts: value => { calls.push(['persistCuts', value]); },
    requestRender: () => { calls.push(['requestRender']); },
    getOperationToken: () => token,
    promptUser: () => '새 컷 이름',
    reportError: error => { calls.push(['reportError', String(error?.message || error)]); },
    actions,
    renderHelpers,
    ...overrides,
  };
  return { capabilities, calls, setToken(value) { token = value; } };
}

test('MENU-CUTS API/render: allowlisted ESM 계약과 이미지컷 핵심 DOM을 보존한다', async () => {
  const relativePath = 'src/menus/imagecuts-menu.mjs';
  assert.equal(fs.existsSync(absolute(relativePath)), true, `${relativePath} is required`);
  const module = await importFresh(relativePath);
  assert.deepEqual(Object.keys(module).sort(), ['createImageCutsMenu']);
  const harness = createImageCutsCapabilities();
  const menu = module.createImageCutsMenu(harness.capabilities);
  assert.equal(menu.id, 'imagecuts');
  assert.deepEqual(menu.routes, ['imagecuts']);
  assert.deepEqual(menu.ownedSlices, ['image-cuts']);
  const html = menu.render(IMAGECUTS_VIEW);
  assert.match(html, /이미지컷 생성/);
  assert.match(html, /id="cutsUploadArea"/);
  assert.match(html, /data-cut-prompt/);
});

test('MENU-CUTS commands/read-only: owner 명령만 컷 상태와 저장을 변경한다', async () => {
  const { createImageCutsMenu } = await importFresh('src/menus/imagecuts-menu.mjs');
  const harness = createImageCutsCapabilities();
  const menu = createImageCutsMenu(harness.capabilities);
  menu.invoke('setStyleReference', false);
  menu.invoke('setPrompt', { kind: 'cut', index: 0, value: '새 프롬프트' });
  menu.invoke('setPlacement', { sectionId: 'section-1', value: 'cut:cut-1' });
  assert.ok(harness.calls.some(([name]) => name === 'updateCuts'));
  assert.ok(harness.calls.some(([name]) => name === 'updatePrompt'));
  assert.ok(harness.calls.some(([name]) => name === 'updatePlacement'));
  assert.ok(harness.calls.some(([name]) => name === 'persistCuts'));

  const readOnly = createImageCutsCapabilities({ assertMutable: () => { throw new Error('READ_ONLY'); } });
  const readOnlyMenu = createImageCutsMenu(readOnly.capabilities);
  assert.throws(() => readOnlyMenu.invoke('setStyleReference', true), /READ_ONLY/);
  assert.equal(readOnly.calls.length, 0);
});

test('MENU-CUTS lifecycle/bind: 50회 enter/leave 뒤 listener가 남지 않는다', async () => {
  const { createImageCutsMenu } = await importFresh('src/menus/imagecuts-menu.mjs');
  const harness = createImageCutsCapabilities();
  const menu = createImageCutsMenu(harness.capabilities);
  const root = { querySelectorAll: () => [], querySelector: () => null };
  for (let cycle = 0; cycle < 50; cycle += 1) {
    menu.onEnter();
    const dispose = menu.bind(root);
    dispose();
    dispose();
    menu.onLeave();
  }
  assert.equal(harness.calls.filter(([name]) => name === 'persistCuts').length, 0);
});

test('MENU-CUTS async stale guard: 작업 전환 뒤 Drive 폴더 조회 결과를 무시한다', async () => {
  let resolveFolder;
  const pending = new Promise(resolve => { resolveFolder = resolve; });
  const harness = createImageCutsCapabilities();
  harness.capabilities.actions.resolveWorkFolder = () => pending;
  const { createImageCutsMenu } = await importFresh('src/menus/imagecuts-menu.mjs');
  const menu = createImageCutsMenu(harness.capabilities);
  menu.onEnter();
  const resultPromise = menu.invoke('saveWorkFolder', 'folder-id');
  harness.setToken('workspace:cuts:2');
  menu.onLeave();
  resolveFolder({ id: 'folder-id', name: '오래된 폴더' });
  assert.deepEqual(await resultPromise, { ignored: true, reason: 'stale-operation' });
  assert.equal(harness.calls.some(([name]) => name === 'updateCuts'), false);
});

test('MENU-CUTS source boundary: render/bind 구현은 classic bundle에서 제거된다', async () => {
  const menuSource = source('src/menus/imagecuts-menu.mjs');
  assert.doesNotMatch(menuSource, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(menuSource, /\bstate\s*\./);
  assert.doesNotMatch(source('src/app-core-06.js'), /function\s+renderImageCuts\s*\(/);
  assert.doesNotMatch(source('src/app-core-06.js'), /bindImageCutsEvents/);
  assert.doesNotMatch(source('dist/app-runtime.bundle.js'), /function\s+renderImageCuts\s*\(/);
});

const OPTIONSORTER_VIEW = Object.freeze({
  optionSorter: {
    subStep: 'input',
    images: [],
    pool: [],
    slots: [{ id: 'slot-1', name: '1번', imgIds: [] }],
    previewImageId: null,
    previewResultId: null,
    optionResults: [],
  },
});

function createOptionSorterCapabilities(overrides = {}) {
  const calls = [];
  let token = 'workspace:options:1';
  let slotNamePresets = [];
  const capabilities = {
    getSnapshot: () => OPTIONSORTER_VIEW,
    assertMutable: () => {},
    mutateOptions: value => { calls.push(['mutateOptions', value]); },
    persistOptions: value => { calls.push(['persistOptions', value]); },
    getSlotNamePresets: () => slotNamePresets,
    saveSlotNamePreset: value => {
      slotNamePresets = [value, ...slotNamePresets.filter(item => item.id !== value.id)];
      calls.push(['saveSlotNamePreset', value]);
      return value;
    },
    loadVisionColors: async value => ({ value, colors: [] }),
    applyVisionColors: value => { calls.push(['applyVisionColors', value]); },
    restoreArchivedSourceImages: async () => ({ restored: 0 }),
    requestRender: () => { calls.push(['requestRender']); },
    getOperationToken: () => token,
    reportError: error => { calls.push(['reportError', String(error?.message || error)]); },
    bindHelpers: {},
    renderHelpers: {
      ensureOptionSorterDefaults: () => {},
      optMissingImagePayloadCount: () => 0,
      renderOptionSorterSourceStrip: () => '',
      renderOptionSorterAssignmentWorkspace: () => '',
      renderOptionImageGeneratorPanel: () => '',
      optRenderImageOrPlaceholder: () => '',
      renderOptionSorterImagePreviewModal: () => '',
      disabledAttr: disabled => disabled ? 'disabled' : '',
      escapeHtml,
    },
    ...overrides,
  };
  return { capabilities, calls, setToken(value) { token = value; } };
}

test('MENU-OPTIONS API/render: allowlisted ESM 계약과 옵션 분류기 핵심 DOM을 보존한다', async () => {
  const relativePath = 'src/menus/optionsorter-menu.mjs';
  assert.equal(fs.existsSync(absolute(relativePath)), true, `${relativePath} is required`);
  const module = await importFresh(relativePath);
  assert.deepEqual(Object.keys(module).sort(), ['createOptionSorterMenu']);
  const harness = createOptionSorterCapabilities();
  const menu = module.createOptionSorterMenu(harness.capabilities);
  assert.equal(menu.id, 'optionsorter');
  assert.deepEqual(menu.routes, ['optionsorter']);
  assert.deepEqual(menu.ownedSlices, ['options']);
  const html = menu.render(OPTIONSORTER_VIEW);
  assert.match(html, /옵션 분류기/);
  assert.match(html, /id="optUploadZone"/);
  assert.match(html, /id="optAddSlotInput"/);
  assert.match(html, /id="optSlotPresetName"/);
  assert.match(html, /id="optSaveSlotPreset"/);
  assert.match(html, /id="optLoadSlotPreset"/);
});

test('MENU-OPTIONS 슬롯명 프리셋: 저장 후 불러오면 배정 이미지를 지우지 않고 이름을 복원한다', async () => {
  const { bindOptionSorterSlots } = await importFresh('src/menus/optionsorter-slot-bindings.mjs');
  const os = {
    slots: [
      { id: 'slot-1', name: '빨강', imgIds: ['image-1'] },
      { id: 'slot-2', name: '파랑', imgIds: [] },
    ],
    images: [{ id: 'image-1' }],
    pool: [],
  };
  let presets = [];
  const nodes = {
    optSlotPresetName: { value: '기본 색상' },
    optSlotPresetSelect: { value: '' },
    optSaveSlotPreset: {},
    optLoadSlotPreset: {},
  };
  const calls = [];
  bindOptionSorterSlots({
    byId: id => nodes[id] || null,
    queryAll: () => [],
    optionSorter: () => os,
    requestRender: () => { calls.push('render'); },
    createSortable: () => null,
    currentStep: () => 'optionsorter',
    sortable: null,
    getSlotNamePresets: () => presets,
    saveSlotNamePreset(value) {
      presets = [value];
      calls.push('save-preset');
      return value;
    },
    optDeleteSlot: () => {},
    optDownloadSlot: () => {},
    optFocusSlotNameByIndex: () => {},
    optScheduleSave: () => { calls.push('save-work'); },
    optSwapOptionPairOrder: () => {},
    saveLastWorkNow: () => {},
    syncOptFromDOM: () => {},
    syncOptSlotsFromDOM: () => {},
    uid: prefix => `${prefix}-1`,
    reportWarning: message => { throw new Error(message); },
  });

  nodes.optSaveSlotPreset.onclick();
  assert.deepEqual(presets[0].slotNames, ['빨강', '파랑']);

  os.slots[0].name = '변경됨';
  os.slots[1].name = '변경됨';
  nodes.optSlotPresetSelect.value = presets[0].id;
  nodes.optLoadSlotPreset.onclick();

  assert.deepEqual(os.slots.map(slot => slot.name), ['빨강', '파랑']);
  assert.deepEqual(os.slots[0].imgIds, ['image-1']);
  assert.deepEqual(calls, ['save-preset', 'render', 'save-work', 'render']);
});

test('MENU-OPTIONS commands/read-only: owner 명령만 옵션 상태와 저장을 변경한다', async () => {
  const { createOptionSorterMenu } = await importFresh('src/menus/optionsorter-menu.mjs');
  const harness = createOptionSorterCapabilities();
  const menu = createOptionSorterMenu(harness.capabilities);
  menu.invoke('addSlot', { id: 'slot-2', name: '2번' });
  menu.invoke('setSubStep', 'sort');
  assert.ok(harness.calls.some(([name]) => name === 'mutateOptions'));
  assert.ok(harness.calls.some(([name]) => name === 'persistOptions'));
  assert.ok(harness.calls.some(([name]) => name === 'requestRender'));

  const readOnly = createOptionSorterCapabilities({ assertMutable: () => { throw new Error('READ_ONLY'); } });
  const readOnlyMenu = createOptionSorterMenu(readOnly.capabilities);
  assert.throws(() => readOnlyMenu.invoke('addSlot', {}), /READ_ONLY/);
  assert.equal(readOnly.calls.length, 0);
});

test('MENU-OPTIONS lifecycle/bind: 50회 enter/leave 뒤 listener·sortable·save가 남지 않는다', async () => {
  const { createOptionSorterMenu } = await importFresh('src/menus/optionsorter-menu.mjs');
  const harness = createOptionSorterCapabilities();
  const menu = createOptionSorterMenu(harness.capabilities);
  const root = { querySelectorAll: () => [], querySelector: () => null };
  for (let cycle = 0; cycle < 50; cycle += 1) {
    menu.onEnter();
    const dispose = menu.bind(root);
    dispose();
    dispose();
    menu.onLeave();
  }
  assert.equal(harness.calls.filter(([name]) => name === 'persistOptions').length, 0);
});

test('MENU-OPTIONS async stale guard: 작업 전환 뒤 색상 판정 결과를 무시한다', async () => {
  let resolveColors;
  const pending = new Promise(resolve => { resolveColors = resolve; });
  const harness = createOptionSorterCapabilities({ loadVisionColors: () => pending });
  const { createOptionSorterMenu } = await importFresh('src/menus/optionsorter-menu.mjs');
  const menu = createOptionSorterMenu(harness.capabilities);
  menu.onEnter();
  const resultPromise = menu.invoke('refreshVisionColors', { imageIds: ['image-1'] });
  harness.setToken('workspace:options:2');
  menu.onLeave();
  resolveColors({ colors: ['빨강'] });
  assert.deepEqual(await resultPromise, { ignored: true, reason: 'stale-operation' });
  assert.equal(harness.calls.some(([name]) => name === 'applyVisionColors'), false);
});

test('MENU-OPTIONS source boundary: render/bind 구현은 classic bundle에서 제거된다', async () => {
  const menuSource = source('src/menus/optionsorter-menu.mjs');
  assert.doesNotMatch(menuSource, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(menuSource, /\bstate\s*\./);
  assert.doesNotMatch(source('src/app-core-06.js'), /function\s+renderOptionSorter\s*\(/);
  assert.doesNotMatch(source('src/app-core-05.js'), /옵션 분류기 이벤트/);
  assert.doesNotMatch(source('dist/app-runtime.bundle.js'), /function\s+renderOptionSorter\s*\(/);
});
