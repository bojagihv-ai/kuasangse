'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/app-core-03.js'), 'utf8');
const begin = source.indexOf('async function renderClassicRuntimeAfterHydration(');
const end = source.indexOf('function getCurrentStepLabel()', begin);
assert.ok(begin >= 0 && end > begin, 'original runtime render boundary must exist');

function runtime() {
  const state = {
    step: 'factory', currentProjectId: 'batch:factory-job-preservation-proof',
    product: { name: '보존 기준 제품', widthMm: 150, depthMm: 80 },
    assets: [{ id: 'existing-cut', selected: true }], logs: ['기존 생성 완료'],
  };
  const before = structuredClone(state);
  const rendered = [];
  const context = vm.createContext({
    classicRuntimeHydrationReady: true,
    classicRuntimeHydrationActive: true,
    classicRuntimeInitialRenderComplete: false,
    classicRuntimeBatchWorkerMode: false,
    classicRuntimeBatchConsoleMode: false,
    state,
    runtimeMenuModules: new Map([['factory', { id: 'original-factory' }]]),
    shellRuntimeComposition: null,
    shouldDeferFactoryWizardFullRender: () => false,
    renderActiveRuntimeMenu: menu => menu.id,
    renderShellFrame: ({ activeMenuHtml }) => rendered.push(activeMenuHtml),
  });
  vm.runInContext(source.slice(begin, end), context);
  return { context, state, before, rendered };
}

test('baseline: original single-product render retains all existing work', async () => {
  const proof = runtime();
  const result = await proof.context.renderClassicRuntimeAfterHydration();
  assert.equal(result.rendered, true);
  assert.deepEqual(proof.rendered, ['original-factory']);
  assert.equal(proof.context.classicRuntimeBatchWorkerMode, false);
  assert.deepEqual(proof.state, proof.before);
  await proof.context.renderClassicRuntimeAfterHydration();
  assert.equal(proof.rendered.length, 1, 'hydration render is idempotent');
});

test('baseline: hidden batch worker skips original UI without losing A', async () => {
  const proof = runtime();
  const result = await proof.context.renderClassicRuntimeAfterHydration({ mode: 'batch-worker' });
  assert.equal(result.rendered, false);
  assert.equal(proof.context.classicRuntimeBatchWorkerMode, true);
  vm.runInContext('render()', proof.context);
  assert.equal(proof.rendered.length, 0);
  assert.deepEqual(proof.state, proof.before);
});

test('baseline: original factory shell renders all seven real tab contracts', async () => {
  const shell = await import(pathToFileURL(path.join(root, 'src/menus/factory/factory-menu-shell.mjs')));
  const expected = ['start', 'db', 'fields', 'competitor', 'assets', 'sections', 'publish'];
  for (const activeId of expected) {
    const html = shell.renderFactoryMenuShell({ activeId, tabMarkup: '<p>보존된 작업</p>' });
    const buttons = [...html.matchAll(/<button\b[^>]*data-factory-auto-tab="([^"]+)"[^>]*>/g)];
    assert.deepEqual(buttons.map(match => match[1]), expected);
    assert.deepEqual(buttons.filter(match => /aria-selected="true"/.test(match[0])).map(match => match[1]), [activeId]);
    assert.ok(html.includes('<p>보존된 작업</p>'));
  }
});

test('native display: renders the original factory while retaining worker isolation', async () => {
  const proof = runtime();
  const result = await proof.context.renderClassicRuntimeAfterHydration({ mode: 'batch-worker', display: true });
  assert.equal(result.rendered, true, 'visible production mode must use the original renderer');
  assert.equal(proof.context.classicRuntimeBatchWorkerMode, true, 'rendering must not disable worker safety');
  assert.deepEqual(proof.rendered, ['original-factory']);
  assert.deepEqual(proof.state, proof.before);
  vm.runInContext('render()', proof.context);
  assert.equal(proof.rendered.length, 2, 'later native menu updates must remain visible');
});

async function bootLoader(query, pagePath = '/factory-native/app.html', replies = {}) {
  const loader = fs.readFileSync(path.join(root, 'src/app-loader.js'), 'utf8');
  const loadStart = loader.indexOf('  async function loadApp()');
  const loadEnd = loader.lastIndexOf('\n  loadApp();');
  const code = loader.slice(loadStart, loadEnd).replace(/await import\(/g, 'await importModule(');
  const calls = [];
  const boot = await import(pathToFileURL(path.join(root, 'src/shell/bootstrap.mjs')));
  const native = await import('../../src/modules/native-batch-console.mjs');
  const journal = await import('../../src/modules/native-command-journal.mjs');
  const controlBridge = await import('../../src/modules/factory-control-command-bridge.mjs');
  native.configureNativeFactoryRuntime({ location: null });
  const browserCalls = [], stored = new Map(), listeners = new Map();
  let mountedOptions;
  const workerOptions = [];
  const pageRoot = { innerHTML: '' };
  const window = {
    fetch: async () => { calls.push('fetch'); }, setInterval() {}, clearInterval() {},
    get sessionStorage() {
      browserCalls.push('journal-access');
      return { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
    },
    crypto: { randomUUID: () => 'injected-key', subtle: require('node:crypto').webcrypto.subtle },
    setTimeout: (callback, ms) => { browserCalls.push(['wait', ms]); callback(); },
    confirm: message => { browserCalls.push(['confirm', message]); return false; },
    addEventListener: (name, callback) => listeners.set(name, callback),
    EventSource: class {
      constructor(url, options) { browserCalls.push(['events', url, options.withCredentials]); }
      addEventListener(name, callback) { listeners.set(name, callback); }
      close() { browserCalls.push('events-close'); }
    },
  };
  const modules = {
    bootstrap: boot,
    authority: { installWorkspaceLock() {} },
    'src/modules/native-batch-console.mjs': { ...native, mountNativeBatchConsole(_document, options) { mountedOptions = options; } },
    'src/modules/native-command-journal.mjs': journal,
    'src/modules/factory-cafe24-command-bridge.mjs': {
      installFactoryCafe24CommandBridge: () => { window.__KUASANGSE_BATCH_CONTROL_COMMAND_BRIDGE__ = {}; },
    },
    'src/modules/factory-control-command-bridge.mjs': {
      createFactoryControlCommandBridge: controlBridge.createFactoryControlCommandBridge,
      installFactoryControlCommandBridge: () => { window.__KUASANGSE_FACTORY_CONTROL_COMMAND_BRIDGE__ = {}; },
    },
    'src/modules/batch-control-worker.mjs': {
      installBatchControlWorker(_window, options) {
        workerOptions.push(options);
        calls.push('worker-install');
        return { worker: Object.fromEntries(['startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling']
          .map(name => [name, () => calls.push(name)])) };
      },
    },
  };
  const manifest = { buildId: 'baseline', bundle: 'bundle', authorityModule: 'authority', scripts: [], modules: Object.keys(modules).filter(key => key.startsWith('src/')) };
  const context = vm.createContext({
    window, URL, location: new URL(`http://127.0.0.1:${pagePath === '/app.html' ? 8081 : 42011}${pagePath}?${query}`),
    document: { getElementById: () => pageRoot, documentElement: { dataset: {} } },
    BOOTSTRAP_MODULE: 'bootstrap', RUNTIME_BOOT_CACHE_TOKEN: 'proof',
    readManifest: async () => manifest, validateManifest: value => value, freezeRuntimeManifest: value => value,
    preloadRuntimeBundle() {}, installRuntimeImportMap() {}, publishOperationalMetadata() {}, showLoadStatus() {},
    resourceUrl: file => file, importModule: async file => modules[file], loadExternalScript: async () => {},
    workspaceAuthorityServerBases() {}, requestClassicRuntime: async (command, payload) => {
      calls.push({ command, payload, nativeEnabled: native.isNativeFactoryConsole() });
      if (command === 'menu-install') native.configureNativeFactoryRuntime({ readLocal: () => ({}) });
      if (command === 'factory-control-command') {
        if (replies.error) throw replies.error;
        return replies.projection;
      }
    },
    setTimeout() {}, showLoadError: error => { throw error; }, runtimeBuildGuardDisposer: null,
    installRuntimeBuildFreshnessGuard: () => ({ dispose() {}, checkNow() {} }), runtimeBuildSignature() {},
  });
  vm.runInContext(code, context);
  await context.loadApp();
  return { calls, pageRoot, mountedOptions, stored, browserCalls, listeners, window, native, workerOptions };
}

test('baseline: hidden loader starts the existing worker heartbeat and polling', async () => {
  const proof = await bootLoader('batchWorker=1');
  assert.deepEqual(proof.calls.filter(value => typeof value === 'string'), [
    'worker-install', 'startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling',
  ]);
  assert.ok(proof.pageRoot.innerHTML.includes('batch-worker-shell'));
  assert.equal(proof.mountedOptions, undefined);
  assert.deepEqual(proof.browserCalls, [], 'hidden worker must not open a native journal');
  assert.equal(proof.workerOptions[0].commandBridge.waitForAdmission, undefined);
});

test('ordinary 8081 loader does not activate native routing or acquire browser capabilities', async () => {
  const proof = await bootLoader('', '/app.html');
  assert.equal(proof.calls.find(value => value.command === 'menu-install').nativeEnabled, false);
  assert.equal(proof.mountedOptions, undefined);
  assert.deepEqual(proof.browserCalls, []);
  assert.equal(proof.workerOptions.length, 0);
});

test('native loader injects scoped journal and browser capabilities before original menu install', async () => {
  // Given: a fresh native boot, with no ambient browser state in the ESM modules.
  const proof = await bootLoader('batchWorker=1&batchConsole=1&controlTowerBase=http://127.0.0.1:41009');
  const options = proof.mountedOptions;
  assert.equal(proof.calls.find(value => value.command === 'menu-install').nativeEnabled, true);
  assert.equal(proof.native.isNativeFactoryConsole(), true, 'runtime action installation retains injected location');
  assert.ok(Object.isFrozen(options.journal));
  assert.equal(options.journal.getItem, undefined, 'UI receives a journal, not the browser storage object');
  // When: exercise the injected boundaries without browser or live API access.
  options.journal.write({ dirty: true, dirtyEpoch: 1, localActive: false, pending: null });
  options.publishMenu({ activate() {} });
  options.onBeforeUnload(() => {});
  options.onJobCreated(() => {});
  assert.equal(options.confirm('human decision'), false);
  await options.wait(10);
  const { watchNativeFactorySelection } = await import('../../src/modules/native-factory-command-routing.mjs');
  let received;
  const close = watchNativeFactorySelection(options, 'cursor/1', receipt => { received = receipt; });
  proof.listeners.get('factory.a_cut.selected')({ data: 'invalid' });
  assert.equal(received, undefined);
  proof.listeners.get('factory.a_cut.selected')({ data: JSON.stringify({ receipt: { id: 'selected' } }) });
  close();
  // Then: journal scope, original event semantics and crypto provenance are preserved.
  assert.deepEqual([...proof.stored.keys()], ['native-factory-command:v1:http://127.0.0.1:41009']);
  assert.equal(JSON.parse([...proof.stored.values()][0]).dirty, true);
  assert.equal(options.randomUUID(), 'injected-key');
  assert.equal(Buffer.from(await options.digest(new TextEncoder().encode('abc'))).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(typeof proof.window.controlTowerMenu.activate, 'function');
  assert.ok(Object.isFrozen(proof.window.controlTowerMenu));
  assert.ok(proof.listeners.has('beforeunload') && proof.listeners.has('control-tower:job-created'));
  assert.deepEqual(received, { id: 'selected' });
  assert.ok(proof.browserCalls.some(call => call[0] === 'events' && call[1].endsWith('cursor=cursor%2F1') && call[2]));
  assert.equal(proof.browserCalls.at(-1), 'events-close');
});

test('native display: loader opens the original UI without installing or starting a worker', async () => {
  const proof = await bootLoader('batchWorker=1&batchConsole=1');
  assert.deepEqual(proof.calls.filter(value => typeof value === 'string'), []);
  const renderCall = proof.calls.find(value => value.command === 'render');
  assert.equal(renderCall.payload.mode, 'batch-worker');
  assert.equal(renderCall.payload.display, true);
  assert.equal(proof.pageRoot.innerHTML.includes('batch-worker-shell'), false);
  assert.equal(proof.workerOptions.length, 0);
  proof.mountedOptions.installWorker();
  assert.equal(typeof proof.workerOptions[0].commandBridge.waitForAdmission, 'function');
});

test('native display: confirmation dialogs remain under human control', () => {
  const source6 = fs.readFileSync(path.join(root, 'src/app-core-06.js'), 'utf8');
  const shimStart = source6.indexOf('function classicRuntimeIsBatchWorker()');
  const shimEnd = source6.indexOf('function startClassicRuntimeBackgroundLifecycle()', shimStart);
  for (const display of [false, true]) {
    const confirm = () => false;
    const window = { location: { href: `http://127.0.0.1:42011/app.html?batchWorker=1${display ? '&batchConsole=1' : ''}` }, confirm };
    const context = vm.createContext({ window, URL, console: { info() {} } });
    vm.runInContext(source6.slice(shimStart, shimEnd), context);
    assert.equal(context.installClassicRuntimeBatchDialogShim(), !display);
    assert.equal(window.confirm('preserve human decision'), !display);
    if (display) assert.equal(window.confirm, confirm);
  }
});

test('startup identity: loader reads the existing getter only on request and returns its exact allowlist', async () => {
  const capturedAt = '2026-09-12T14:00:00.000Z';
  const replies = { projection: {
    schema: 'factory-control-projection:v1', capturedAt,
    registration: { jobId: 'fixture-identity-job', approvalToken: 'TEST_ONLY_EXCLUDED' },
    session: { runId: 'fixture-identity-run', csrfToken: 'TEST_ONLY_EXCLUDED' },
    inputs: [{ key: 'product', items: [{ productName: '표시 전용 샘플' }] }],
    imageBody: 'TEST_ONLY_EXCLUDED', otherJobs: ['TEST_ONLY_EXCLUDED'],
  } };
  const proof = await bootLoader('batchWorker=1&batchConsole=1', '/factory-native/app.html', replies);
  const getterCalls = () => proof.calls.filter(call => call.command === 'factory-control-command');
  assert.equal(getterCalls().length, 0, 'mount must not read the projection');
  assert.equal(typeof proof.mountedOptions.readStartupIdentity, 'function', 'missing explicit identity read callback');
  const before = JSON.stringify(replies.projection);
  const result = await proof.mountedOptions.readStartupIdentity();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    productName: '표시 전용 샘플', registration: { jobId: 'fixture-identity-job' },
    session: { runId: 'fixture-identity-run' }, capturedAt,
  });
  assert.equal(JSON.stringify(replies.projection), before);
  assert.deepEqual(JSON.parse(JSON.stringify(getterCalls().map(({ command, payload }) => ({ command, payload })))), [{
    command: 'factory-control-command',
    payload: { capabilityVersion: 'factory-control-command:v1', command: 'getFactoryProjection' },
  }]);
  replies.projection = { schema: 'factory-control-projection:v1', capturedAt, registration: {}, session: {}, inputs: [] };
  assert.deepEqual(JSON.parse(JSON.stringify(await proof.mountedOptions.readStartupIdentity())), {
    productName: '', registration: { jobId: '' }, session: { runId: '' }, capturedAt,
  });
  replies.error = new Error('synthetic projection read failure');
  await assert.rejects(proof.mountedOptions.readStartupIdentity());
  assert.equal(getterCalls().length, 3, 'one getter per explicit read, including blank and failure');
  assert.ok(getterCalls().every(call => call.payload.command === 'getFactoryProjection'));
  assert.deepEqual(proof.calls.filter(call => typeof call === 'string'), [], 'no fetch, worker installation or polling');
  assert.equal(proof.workerOptions.length, 0);
  assert.equal(proof.browserCalls.some(call => Array.isArray(call) && call[0] === 'events'), false);
});
