const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const APP_LOADER = path.join(ROOT, 'src', 'app-loader.js');
const WORKSPACE_LOCK = path.join(ROOT, 'src', 'modules', 'workspace-lock.mjs');
const SIDEBAR_ROUTES = Object.freeze([
  'upload',
  'analyzing',
  'competitor',
  'sections',
  'generating',
  'preview',
  'imagecuts',
  'optionsorter',
  'factory',
  'automation',
  'modelsettings',
  'manual',
]);

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} definition is required`);
  const braceStart = fileSource.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} boundary is incomplete`);
}

test('Task 7 shell registry adapter resolves all twelve runtime routes without exposing descriptor registry', () => {
  // Given: the classic shell owns twelve installed menu instances.
  const functionSource = extractFunction(source(CORE_03), 'createRuntimeMenuRegistryAdapter');
  const createAdapter = new Function(
    `${functionSource}; return createRuntimeMenuRegistryAdapter;`,
  )();
  const menus = new Map(SIDEBAR_ROUTES.map(route => [route, Object.freeze({ id: route })]));

  // When: route lookup crosses the classic-to-ESM adapter.
  const registry = createAdapter(menus);

  // Then: every route resolves from the real menu map and no descriptor API leaks through.
  assert.deepEqual(SIDEBAR_ROUTES.map(route => registry.getByRoute(route)?.id), SIDEBAR_ROUTES);
  assert.equal(registry.getByRoute('missing'), null);
  assert.equal(Object.hasOwn(registry, 'list'), false);
  assert.equal(Object.hasOwn(registry, 'get'), false);
  assert.equal(Object.isFrozen(registry), true);
});

test('Task 7 shell composition adapts lifecycle render input and diagnostic snapshot API explicitly', () => {
  // Given: the production shell composition source is loaded.
  const core = source(CORE_03);
  const composition = extractFunction(core, 'installShellRuntimeComposition');

  // When/Then: canonical ESM constructors are required and receive explicit adapters.
  assert.match(composition, /src\/shell\/render-lifecycle\.mjs/);
  assert.match(composition, /src\/shell\/route-controller\.mjs/);
  assert.match(composition, /src\/shell\/legacy-diagnostic-bridge\.mjs/);
  assert.match(composition, /createRuntimeMenuRegistryAdapter\(runtimeMenuModules\)/);
  assert.doesNotMatch(composition, /registry\s*:\s*moduleRegistry\b/);
  assert.match(composition, /render\s*:\s*renderRuntimeMenuActivation/);
  assert.match(composition, /snapshot\(\)\s*\{\s*return factoryRuntimeRequireStore\(\)\.getSnapshot\(\);\s*\}/);
  assert.match(composition, /createLegacyDiagnosticBridge/);
  assert.match(composition, /createRenderLifecycleCoordinator/);
  assert.match(composition, /createRouteController/);
});

test('Task 7 shell composition smoke instantiates real lifecycle, router, and diagnostic modules', async () => {
  // Given: the real shell constructors and twelve installed menu instances are available.
  const moduleUrl = relativePath => `${pathToFileURL(path.join(ROOT, relativePath)).href}?smoke=${Date.now()}-${Math.random()}`;
  const [lifecycleModule, routeModule, diagnosticModule, registryModule] = await Promise.all([
    import(moduleUrl('src/shell/render-lifecycle.mjs')),
    import(moduleUrl('src/shell/route-controller.mjs')),
    import(moduleUrl('src/shell/legacy-diagnostic-bridge.mjs')),
    import(moduleUrl('src/modules/module-registry.mjs')),
  ]);
  const menus = new Map(SIDEBAR_ROUTES.map(route => [route, Object.freeze({
    select(snapshot) { return Object.freeze({ route, workspaceId: snapshot.workspaceId }); },
    render() { return `<section data-route="${route}"></section>`; },
    bind() { return () => undefined; },
    onEnter() {},
    onLeave() {},
  })]));
  const root = { innerHTML: '' };
  const diagnosticRoot = {};
  const activations = [];
  const internalSnapshot = Object.freeze({ factory: Object.freeze({ workspaceId: 'workspace-a' }) });
  const functionSource = extractFunction(source(CORE_03), 'installShellRuntimeComposition');
  const install = new Function(
    'runtimeMenuModules',
    'document',
    'window',
    'factoryRuntimeRequireStore',
    'getNavGateInfo',
    'renderRuntimeMenuActivation',
    'createRuntimeMenuRegistryAdapter',
    `let shellRuntimeComposition = null; ${functionSource}; return installShellRuntimeComposition;`,
  )(
    menus,
    { getElementById() { return root; } },
    diagnosticRoot,
    () => ({ getSnapshot() { return internalSnapshot; } }),
    route => ({ blocked: false, redirect: route }),
    input => { activations.push(input); },
    new Function(`${extractFunction(source(CORE_03), 'createRuntimeMenuRegistryAdapter')}; return createRuntimeMenuRegistryAdapter;`)(),
  );

  // When: the classic boundary composes the canonical ESM modules and navigates all routes.
  const composition = install({
    'src/shell/render-lifecycle.mjs': lifecycleModule,
    'src/shell/route-controller.mjs': routeModule,
    'src/shell/legacy-diagnostic-bridge.mjs': diagnosticModule,
    'src/modules/module-registry.mjs': registryModule,
  });
  for (const route of SIDEBAR_ROUTES) {
    await composition.routeController.navigate(route, { workspaceId: 'workspace-a', bypassGate: true });
  }

  // Then: the real controller drives the object render contract and diagnostics adapt getSnapshot.
  assert.deepEqual(activations.map(item => item.route), SIDEBAR_ROUTES);
  assert.deepEqual(composition.diagnosticBridge.snapshot(), internalSnapshot);
  assert.equal(Object.isFrozen(composition.diagnosticBridge.snapshot()), true);
  const diagnosticDescriptor = Object.getOwnPropertyDescriptor(diagnosticRoot, '__KUASANGSE_DIAGNOSTIC__');
  assert.ok(diagnosticDescriptor);
  assert.equal(diagnosticDescriptor.writable, false);
  assert.equal(diagnosticDescriptor.configurable, false);
  assert.equal(Object.isFrozen(diagnosticDescriptor.value), true);
  assert.equal(Object.hasOwn(diagnosticRoot, 'state'), false);
  assert.equal(Object.hasOwn(diagnosticRoot, '__kuasangseState'), false);
  assert.equal(Object.hasOwn(diagnosticRoot, 'factoryState'), false);
  await composition.routeController.dispose();
});

test('Task 7 classic render delegates one generic active menu and leaves menu binding to lifecycle', () => {
  // Given: the classic shell source contains the production render boundary.
  const core = source(CORE_03);
  const renderBlock = extractFunction(core, 'render');
  const shellFrame = extractFunction(core, 'renderShellFrame');
  const bindAfterRender = extractFunction(core, 'bindShellAfterRender');

  // When/Then: render has no route branches and the frame consumes one generic menu projection.
  assert.doesNotMatch(renderBlock, /state\.step\s*===/);
  assert.doesNotMatch(renderBlock, /renderRuntimeMenu\s*\(/);
  assert.match(renderBlock, /renderActiveRuntimeMenu/);
  assert.match(shellFrame, /renderShellMarkup/);
  assert.match(shellFrame, /bindShellAfterRender/);
  assert.match(bindAfterRender, /routeController\.navigate/);
  assert.doesNotMatch(core, /function\s+bindRuntimeMenu\s*\(/);
  assert.doesNotMatch(core, /activeRuntimeMenuDispose/);
});

test('Task 7 loader delegates the exact boot sequence to the canonical coordinator and event bridge', () => {
  // Given: the browser loader is the only owner of runtime startup sequencing.
  const loader = source(APP_LOADER);
  const core = source(CORE_03);

  // When/Then: it imports the canonical coordinator and supplies the six ordered stages.
  assert.match(loader, /src\/shell\/bootstrap\.mjs/);
  assert.match(loader, /createBootstrapCoordinator/);
  assert.match(
    loader,
    /createBootstrapCoordinator\(\{[\s\S]*?authority\s*:[\s\S]*?modules\s*:[\s\S]*?bundleCompat\s*:[\s\S]*?installMenuModules\s*:[\s\S]*?hydrate\s*:[\s\S]*?render\s*:/,
  );
  assert.match(loader, /coordinator\.boot\(\)/);

  // And: module installation/rendering cross a fail-closed one-shot event boundary.
  assert.match(loader, /kuasangse:classic-runtime-request/);
  assert.match(loader, /kuasangse:classic-runtime-response/);
  assert.match(loader, /classic runtime endpoint did not respond/);
  assert.match(core, /handleClassicRuntimeRequest/);
  assert.match(core, /publishClassicRuntimeResponse/);
  assert.doesNotMatch(loader, /for\s*\(const\s+file\s+of\s+manifest\.modules\)/);
  assert.doesNotMatch(loader, /installRuntimeMenus\s*\(/);
  assert.doesNotMatch(loader, /__KUASANGSE_INSTALL_RUNTIME_MENUS__/);
  assert.doesNotMatch(core, /__KUASANGSE_INSTALL_RUNTIME_MENUS__/);
  assert.doesNotMatch(loader, /__kuasangseState/);
  assert.doesNotMatch(loader, /typeof\s+window\.render/);
});

test('Task 7 authority stage explicitly installs workspace lock before its production consumer runs', async () => {
  // Given: auto-install is absent and the loader owns an explicit injected authority stage.
  const loader = source(APP_LOADER);
  const lockSource = source(WORKSPACE_LOCK);
  assert.doesNotMatch(lockSource, /if\s*\(typeof\s+self[\s\S]*?installWorkspaceLock\(self\)/);
  assert.match(loader, /authorityNamespace\.installWorkspaceLock\(window,\s*\{/);
  assert.match(loader, /reloadAccepted\s*:\s*accepted\s*=>\s*requestClassicRuntime\(['"]workspace-reload['"],\s*accepted\)/);
  assert.match(loader, /serverBases\s*:\s*workspaceAuthorityServerBases/);
  assert.match(loader, /localStorage\.getItem\(['"]gemini_backend_url['"]\)/);

  const cacheBust = `${Date.now()}-${Math.random()}`;
  const [{ createBootstrapCoordinator }, { installWorkspaceLock }] = await Promise.all([
    import(`${pathToFileURL(path.join(ROOT, 'src', 'shell', 'bootstrap.mjs')).href}?authority=${cacheBust}`),
    import(`${pathToFileURL(WORKSPACE_LOCK).href}?authority=${cacheBust}`),
  ]);
  const root = {};
  const workspaceLockApi = new Function(
    'window',
    `${extractFunction(source(CORE_02), 'workspaceLockApi')}; return workspaceLockApi;`,
  )(root);
  const calls = [];
  let installedAuthority = null;
  const coordinator = createBootstrapCoordinator({
    authority: async () => {
      calls.push('authority');
      installedAuthority = installWorkspaceLock(root, { reloadAccepted: async () => true });
    },
    modules: async () => {
      calls.push('modules');
      assert.equal(workspaceLockApi(), installedAuthority);
      assert.equal(workspaceLockApi().snapshot().mode, 'idle');
    },
    bundleCompat: async () => { calls.push('bundleCompat'); },
    installMenuModules: async () => { calls.push('menu-install'); },
    hydrate: async () => { calls.push('hydrate'); },
    render: async () => { calls.push('render'); },
    hydrationEnvelope: Object.freeze({
      schema: 'kuasangse.app-state',
      version: 'app-state:v1',
      state: Object.freeze({}),
    }),
  });

  // When: the real coordinator reaches ready.
  const status = await coordinator.boot();

  // Then: lock installation precedes every consumer and the frozen API remains observable at ready.
  assert.deepEqual(calls, ['authority', 'modules', 'bundleCompat', 'menu-install', 'hydrate', 'render']);
  assert.equal(status.phase, 'ready');
  assert.equal(status.ready, true);
  assert.equal(workspaceLockApi(), installedAuthority);
  assert.equal(Object.isFrozen(installedAuthority), true);
});

test('Task 7 loader and classic runtime exchange frozen one-shot event messages', async () => {
  // Given: the production request and endpoint functions share a browser-like event target.
  const loader = source(APP_LOADER);
  const core = source(CORE_03);
  class RuntimeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  function createEventWindow() {
    const listeners = new Map();
    const events = [];
    return {
      events,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event) {
        events.push(event);
        for (const listener of [...(listeners.get(event.type) || [])]) listener(event);
        return true;
      },
      setTimeout,
      clearTimeout,
    };
  }
  const eventWindow = createEventWindow();
  const installed = [];
  const lifecycle = [];
  const requestClassicRuntime = new Function(
    'window',
    'CustomEvent',
    'installRuntimeMenuModules',
    'hydrateClassicRuntime',
    'renderClassicRuntimeAfterHydration',
    `
      const CLASSIC_RUNTIME_REQUEST_EVENT = 'kuasangse:classic-runtime-request';
      const CLASSIC_RUNTIME_RESPONSE_EVENT = 'kuasangse:classic-runtime-response';
      const CLASSIC_RUNTIME_RESPONSE_TIMEOUT_MS = 25;
      const CLASSIC_RUNTIME_HYDRATION_TIMEOUT_MS = 25;
      let classicRuntimeRequestSequence = 0;
      ${extractFunction(loader, 'requestClassicRuntime')}
      ${extractFunction(core, 'publishClassicRuntimeResponse')}
      async ${extractFunction(core, 'handleClassicRuntimeRequest')}
      window.addEventListener(CLASSIC_RUNTIME_REQUEST_EVENT, handleClassicRuntimeRequest);
      return requestClassicRuntime;
    `,
  )(
    eventWindow,
    RuntimeEvent,
    async modules => { installed.push(modules); },
    async envelope => {
      lifecycle.push('hydrate');
      return Object.freeze({ schema: envelope.schema, version: envelope.version, hydrated: true });
    },
    async () => {
      lifecycle.push('render');
      return Object.freeze({ command: 'render', rendered: true });
    },
  );
  const modules = Object.freeze({ 'src/menus/manual-menu.mjs': Object.freeze({}) });
  const hydrationEnvelope = Object.freeze({
    schema: 'kuasangse.app-state',
    version: 'app-state:v1',
    state: Object.freeze({}),
  });

  // When: menu install, hydrate, and render cross the production one-shot bridge.
  const installResponse = await requestClassicRuntime('menu-install', modules);
  const hydrateResponse = await requestClassicRuntime('hydrate', hydrationEnvelope);
  const renderResponse = await requestClassicRuntime('render');

  // Then: the exact payload is delivered once, response listeners detach, and messages are frozen.
  assert.equal(installed.length, 1);
  assert.equal(installed[0], modules);
  assert.deepEqual(lifecycle, ['hydrate', 'render']);
  assert.deepEqual(installResponse, { command: 'menu-install' });
  assert.deepEqual(hydrateResponse, {
    schema: 'kuasangse.app-state',
    version: 'app-state:v1',
    hydrated: true,
  });
  assert.deepEqual(renderResponse, { command: 'render', rendered: true });
  const requests = eventWindow.events.filter(event => event.type === 'kuasangse:classic-runtime-request');
  const responses = eventWindow.events.filter(event => event.type === 'kuasangse:classic-runtime-response');
  assert.equal(requests.length, 3);
  assert.equal(responses.length, 3);
  assert.equal(requests.every(event => Object.isFrozen(event.detail)), true);
  assert.equal(responses.every(event => Object.isFrozen(event.detail)), true);
});

test('Task 7 loader event bridge fails closed when the classic endpoint is absent', async () => {
  // Given: no classic runtime request listener exists.
  const loader = source(APP_LOADER);
  class RuntimeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const listeners = new Map();
  const eventWindow = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent() { return true; },
    setTimeout,
    clearTimeout,
  };
  const requestClassicRuntime = new Function(
    'window',
    'CustomEvent',
    `
      const CLASSIC_RUNTIME_REQUEST_EVENT = 'kuasangse:classic-runtime-request';
      const CLASSIC_RUNTIME_RESPONSE_EVENT = 'kuasangse:classic-runtime-response';
      const CLASSIC_RUNTIME_RESPONSE_TIMEOUT_MS = 5;
      const CLASSIC_RUNTIME_HYDRATION_TIMEOUT_MS = 5;
      let classicRuntimeRequestSequence = 0;
      ${extractFunction(loader, 'requestClassicRuntime')}
      return requestClassicRuntime;
    `,
  )(eventWindow, RuntimeEvent);

  // When/Then: the request rejects and cannot become a partial success.
  await assert.rejects(
    requestClassicRuntime('render'),
    /classic runtime endpoint did not respond: render/,
  );
});

test('Task 7 canonical bootstrap is ordered and idempotent under concurrent boot calls', async () => {
  // Given: every real bootstrap stage records its invocation and the first stage is held open.
  const bootstrapUrl = `${pathToFileURL(path.join(ROOT, 'src', 'shell', 'bootstrap.mjs')).href}?order=${Date.now()}-${Math.random()}`;
  const { createBootstrapCoordinator } = await import(bootstrapUrl);
  const calls = [];
  let releaseAuthority;
  const authorityGate = new Promise(resolve => { releaseAuthority = resolve; });
  const stage = name => async () => { calls.push(name); };
  const coordinator = createBootstrapCoordinator({
    authority: async () => { calls.push('authority'); await authorityGate; },
    modules: stage('modules'),
    bundleCompat: stage('bundleCompat'),
    installMenuModules: stage('menu-install'),
    hydrate: async envelope => { calls.push(`hydrate:${envelope.version}`); },
    render: stage('render'),
    hydrationEnvelope: Object.freeze({
      schema: 'kuasangse.app-state',
      version: 'app-state:v1',
      state: Object.freeze({}),
    }),
  });

  // When: callers race the same boot operation.
  const first = coordinator.boot();
  const second = coordinator.boot();
  assert.equal(first, second);
  releaseAuthority();
  await Promise.all([first, second]);

  // Then: each stage runs exactly once in canonical order and readiness is immutable.
  assert.deepEqual(calls, [
    'authority',
    'modules',
    'bundleCompat',
    'menu-install',
    'hydrate:app-state:v1',
    'render',
  ]);
  assert.deepEqual(coordinator.getStatus(), { phase: 'ready', ready: true, error: null });
  assert.equal(Object.isFrozen(coordinator.getStatus()), true);
});

test('Task 7 canonical bootstrap fails closed and never reports ready after a stage error', async () => {
  // Given: bundle compatibility fails and later stages are observable.
  const bootstrapUrl = `${pathToFileURL(path.join(ROOT, 'src', 'shell', 'bootstrap.mjs')).href}?failure=${Date.now()}-${Math.random()}`;
  const { createBootstrapCoordinator } = await import(bootstrapUrl);
  const calls = [];
  const failure = new Error('bundle failed');
  const coordinator = createBootstrapCoordinator({
    authority: async () => { calls.push('authority'); },
    modules: async () => { calls.push('modules'); },
    bundleCompat: async () => { calls.push('bundleCompat'); throw failure; },
    installMenuModules: async () => { calls.push('menu-install'); },
    hydrate: async () => { calls.push('hydrate'); },
    render: async () => { calls.push('render'); },
    hydrationEnvelope: Object.freeze({
      schema: 'kuasangse.app-state',
      version: 'app-state:v1',
      state: Object.freeze({}),
    }),
  });

  // When/Then: boot rejects with the original failure and no later stage runs.
  await assert.rejects(coordinator.boot(), error => error === failure);
  assert.deepEqual(calls, ['authority', 'modules', 'bundleCompat']);
  assert.deepEqual(coordinator.getStatus(), { phase: 'failed', ready: false, error: failure });
  assert.equal(Object.isFrozen(coordinator.getStatus()), true);
});

test('Task 7 classic hydration is coordinator-owned and the initial render is a separate final stage', () => {
  // Given: loader, shell boundary, and classic async runtime sources are loaded together.
  const loader = source(APP_LOADER);
  const core = source(CORE_03);
  const asyncCore = source(CORE_06);

  // When/Then: hydrate crosses the event bridge and render releases the hydration gate exactly afterward.
  assert.match(loader, /hydrate\s*:\s*envelope\s*=>\s*requestClassicRuntime\(['"]hydrate['"],\s*envelope\)/);
  assert.match(core, /request\.command\s*===\s*['"]hydrate['"]/);
  assert.match(core, /renderClassicRuntimeAfterHydration/);
  assert.match(asyncCore, /function\s+hydrateClassicRuntime\s*\(/);
  assert.match(asyncCore, /function\s+runClassicRuntimeHydration\s*\(/);
  assert.match(asyncCore, /function\s+bindClassicRuntimeListeners\s*\(/);
  assert.doesNotMatch(asyncCore, /const\s+initialWorkspaceAuthority[\s\S]{0,500}?\nrender\(\);/);
  const hydration = extractFunction(asyncCore, 'runClassicRuntimeHydration');
  assert.match(
    hydration,
    /initialWorkspaceAuthority[\s\S]*ensureWorkspaceEditAuthority\(initialHydrationIdentity\.scopeId\)[\s\S]*hydratePersistentSessionAssets[\s\S]*initialAuthority[\s\S]*hydrationIdentityIsCurrent[\s\S]*ensureWorkspaceEditAuthority\(activeHydrationIdentity\.scopeId\)[\s\S]*hydrateServerLastWorkSnapshot[\s\S]*factoryRestoreCurrentWorkfileLocalArchive[\s\S]*hydrateLastProductImageBackup/,
  );
  assert.equal((hydration.match(/ensureWorkspaceEditAuthority\(/g) || []).length, 2);
  assert.doesNotMatch(hydration, /\brender\s*\(/);
  assert.doesNotMatch(asyncCore, /__KUASANGSE_STARTUP_RESTORE_PROMISE__/);

  // And: listener ownership no longer depends on writable global sentinels.
  for (const alias of [
    '__factoryLocalArchivePreviewDelegated',
    '__factoryCandidateReviewClickHandlerBound',
    '__optionSorterPreviewClickHandlerBound',
    '__KUASANGSE_WORKSPACE_AUTHORITY_UI_BOUND__',
    '__compMarketQuickActionFallbackBound',
  ]) {
    assert.equal(asyncCore.includes(alias), false, `${alias} must not own listener readiness`);
  }
});

test('Task 7 classic hydration shares one promise and receives a detached frozen factory envelope', async () => {
  // Given: the production hydration boundary receives a nested mutable factory snapshot.
  const core = source(CORE_03);
  const asyncCore = source(CORE_06);
  let releaseHydration;
  const gate = new Promise(resolve => { releaseHydration = resolve; });
  const received = [];
  const hydrateClassicRuntime = new Function(
    'runClassicRuntimeHydration',
    `
      ${extractFunction(core, 'factoryRuntimeDetachedValue')}
      ${extractFunction(asyncCore, 'classicRuntimeFreezeDetached')}
      ${extractFunction(asyncCore, 'classicRuntimeHydrationEnvelope')}
      let classicRuntimeHydrationPromise = null;
      ${extractFunction(asyncCore, 'hydrateClassicRuntime')}
      return hydrateClassicRuntime;
    `,
  )(async envelope => {
    received.push(envelope);
    await gate;
    return envelope;
  });
  const input = {
    schema: 'kuasangse.app-state',
    version: 'app-state:v1',
    state: { factory: { product: { tags: ['original'] } } },
  };

  // When: concurrent callers hydrate and the caller mutates its original snapshot.
  const first = hydrateClassicRuntime(input);
  const second = hydrateClassicRuntime(input);
  input.state.factory.product.tags.push('mutated');
  releaseHydration();
  await Promise.all([first, second]);

  // Then: one promise/run owns hydration and no nested caller reference survives.
  assert.equal(first, second);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].state.factory.product.tags, ['original']);
  assert.equal(Object.isFrozen(received[0]), true);
  assert.equal(Object.isFrozen(received[0].state.factory.product.tags), true);

  // And: malformed schema, version, or state fail before any hydration side effect.
  const invalidHydrate = new Function(
    'runClassicRuntimeHydration',
    `
      ${extractFunction(core, 'factoryRuntimeDetachedValue')}
      ${extractFunction(asyncCore, 'classicRuntimeFreezeDetached')}
      ${extractFunction(asyncCore, 'classicRuntimeHydrationEnvelope')}
      let classicRuntimeHydrationPromise = null;
      ${extractFunction(asyncCore, 'hydrateClassicRuntime')}
      return hydrateClassicRuntime;
    `,
  )(() => { throw new Error('must not run'); });
  assert.throws(
    () => invalidHydrate({ schema: 'wrong', version: 'app-state:v1', state: {} }),
    /schema must be kuasangse\.app-state/,
  );
  assert.throws(
    () => invalidHydrate({ schema: 'kuasangse.app-state', version: 'wrong', state: {} }),
    /version must be app-state:v1/,
  );
  assert.throws(
    () => invalidHydrate({ schema: 'kuasangse.app-state', version: 'app-state:v1', state: null }),
    /state must be an object/,
  );
});

test('Task 7 classic listener binder is idempotent across fifty bootstrap attempts', () => {
  // Given: each production listener group is observable independently.
  const asyncCore = source(CORE_06);
  const counts = {
    archive: 0,
    candidate: 0,
    preview: 0,
    document: 0,
    authority: 0,
    disposed: 0,
  };
  const bindClassicRuntimeListeners = new Function(
    'bindFactoryLocalArchivePreviewDelegation',
    'bindFactoryCandidateReviewDelegation',
    'bindOptionSorterPreviewDelegation',
    'bindClassicRuntimeDocumentEvents',
    'bindWorkspaceAuthorityUi',
    `
      let classicRuntimeListenersBound = false;
      ${extractFunction(asyncCore, 'bindClassicRuntimeListeners')}
      return bindClassicRuntimeListeners;
    `,
  )(
    () => { counts.archive += 1; return () => { counts.disposed += 1; }; },
    () => { counts.candidate += 1; return () => { counts.disposed += 1; }; },
    () => { counts.preview += 1; return () => { counts.disposed += 1; }; },
    () => { counts.document += 1; return () => { counts.disposed += 1; }; },
    () => { counts.authority += 1; return () => { counts.disposed += 1; }; },
  );

  // When: repeated bootstrap attempts ask for listener installation.
  let dispose;
  for (let index = 0; index < 50; index += 1) dispose = bindClassicRuntimeListeners();

  // Then: every listener group is installed exactly once.
  assert.deepEqual(counts, {
    archive: 1,
    candidate: 1,
    preview: 1,
    document: 1,
    authority: 1,
    disposed: 0,
  });
  dispose();
  assert.equal(counts.disposed, 5);
});

test('Task 7 initial render and background lifecycle each have one owner and a real disposer', async () => {
  // Given: hydration is ready and two render requests race the production final-stage gate.
  const core = source(CORE_03);
  let renders = 0;
  const renderAfterHydration = new Function(
    'render',
    `
      let classicRuntimeHydrationActive = true;
      let classicRuntimeHydrationReady = true;
      let classicRuntimeInitialRenderComplete = false;
      async ${extractFunction(core, 'renderClassicRuntimeAfterHydration')}
      return renderClassicRuntimeAfterHydration;
    `,
  )(async () => { renders += 1; });

  // When: the final stage is requested concurrently and once more after completion.
  const first = renderAfterHydration();
  const second = renderAfterHydration();
  const results = await Promise.all([first, second]);
  const third = await renderAfterHydration();

  // Then: only one render runs and all later calls report the no-op result.
  assert.equal(renders, 1);
  assert.deepEqual(results.map(item => item.rendered), [true, false]);
  assert.equal(third.rendered, false);

  // And Given: the real background lifecycle owns two timers and one OAuth refresh start.
  const asyncCore = source(CORE_06);
  const scheduled = [];
  const cleared = [];
  const effects = { refresh: 0, stop: 0, log: 0, render: 0 };
  const startBackground = new Function(
    'setTimeout',
    'clearTimeout',
    'refreshGptOAuthStatus',
    'state',
    'render',
    'initGoogleAuth',
    'factoryStartCafe24OAuthAutoRefresh',
    'factoryLog',
    'stopCafe24OAuthAutoRefresh',
    `
      let classicRuntimeBackgroundDisposer = null;
      let classicRuntimeGoogleAuthTimer = null;
      let classicRuntimeCafe24OAuthTimer = null;
      ${extractFunction(asyncCore, 'startClassicRuntimeBackgroundLifecycle')}
      return startClassicRuntimeBackgroundLifecycle;
    `,
  )(
    (_callback, delay) => { scheduled.push(delay); return scheduled.length; },
    timerId => { cleared.push(timerId); },
    () => { effects.refresh += 1; return Promise.resolve(); },
    { step: 'upload' },
    () => { effects.render += 1; },
    () => undefined,
    () => undefined,
    () => { effects.log += 1; },
    () => { effects.stop += 1; },
  );

  // When: repeated installation shares one background lifecycle and its disposer runs.
  const disposeFirst = startBackground();
  const disposeSecond = startBackground();
  assert.equal(disposeFirst, disposeSecond);
  disposeFirst();
  await Promise.resolve();

  // Then: timers are removed, OAuth refresh starts/stops once, and bind/dispose emits no log/render.
  assert.deepEqual(scheduled, [1000, 1500]);
  assert.deepEqual(cleared, [1, 2]);
  assert.deepEqual(effects, { refresh: 1, stop: 1, log: 0, render: 0 });
});

test('Task 7 loader metadata and load errors are detached frozen non-writable runtime projections', () => {
  // Given: the production publication helpers run against an isolated browser root.
  const loader = source(APP_LOADER);
  const root = {};
  const runtime = new Function(
    'window',
    `
      const loadErrors = [];
      ${extractFunction(loader, 'freezeOperationalValue')}
      ${extractFunction(loader, 'publishOperationalMetadata')}
      ${extractFunction(loader, 'frozenLoadErrorsSnapshot')}
      Object.defineProperty(window, '__KUASANGSE_LOAD_ERRORS__', {
        get: frozenLoadErrorsSnapshot,
        enumerable: false,
        configurable: false,
      });
      return Object.freeze({
        publish: publishOperationalMetadata,
        record(error) { loadErrors.push(error); },
      });
    `,
  )(root);
  const sourceValue = { files: ['a.js'], status: { ready: true } };

  // When: operational metadata is published and its caller-owned input is mutated.
  const published = runtime.publish('__KUASANGSE_APP_LOADER__', sourceValue);
  sourceValue.files.push('mutated.js');
  sourceValue.status.ready = false;

  // Then: the descriptor and every nested value are immutable and detached.
  const metadataDescriptor = Object.getOwnPropertyDescriptor(root, '__KUASANGSE_APP_LOADER__');
  assert.equal(metadataDescriptor.writable, false);
  assert.equal(metadataDescriptor.configurable, false);
  assert.equal(metadataDescriptor.value, published);
  assert.deepEqual(published, { files: ['a.js'], status: { ready: true } });
  assert.equal(Object.isFrozen(published), true);
  assert.equal(Object.isFrozen(published.files), true);
  assert.equal(Object.isFrozen(published.status), true);
  assert.equal(Reflect.set(root, '__KUASANGSE_APP_LOADER__', {}), false);

  // And: each load-error read is a fresh detached deep-frozen snapshot, never the live array.
  runtime.record({ message: 'first', detail: { line: 1 } });
  const firstErrors = root.__KUASANGSE_LOAD_ERRORS__;
  runtime.record({ message: 'second', detail: { line: 2 } });
  const secondErrors = root.__KUASANGSE_LOAD_ERRORS__;
  const errorsDescriptor = Object.getOwnPropertyDescriptor(root, '__KUASANGSE_LOAD_ERRORS__');
  assert.equal(errorsDescriptor.set, undefined);
  assert.equal(errorsDescriptor.configurable, false);
  assert.notEqual(firstErrors, secondErrors);
  assert.deepEqual(firstErrors, [{ message: 'first', detail: { line: 1 } }]);
  assert.deepEqual(secondErrors.map(error => error.message), ['first', 'second']);
  assert.equal(Object.isFrozen(secondErrors), true);
  assert.equal(Object.isFrozen(secondErrors[0]), true);
  assert.equal(Object.isFrozen(secondErrors[0].detail), true);
});

test('Task 7 image generation testability is an explicit executor capability with no global hook', async () => {
  // Given: the real timeout boundary receives an injected executor in an environment without AbortController.
  const asyncCore = source(CORE_06);
  const generationStart = asyncCore.indexOf('async function generateImageWithAbortableTimeout(');
  const generationEnd = asyncCore.indexOf('\nfunction cutGeneratingHelperText(', generationStart);
  assert.ok(generationStart >= 0 && generationEnd > generationStart);
  const generationSource = asyncCore.slice(generationStart, generationEnd);
  const calls = [];
  const fallback = async () => { throw new Error('default executor must not run'); };
  const generate = new Function(
    'cutRequestTimeoutMs',
    'generateWithSelectedImageModel',
    'getCurrentImageRunInfo',
    'factoryImageRequestKey',
    'factoryMarkImageRequestActive',
    'cutsAppendRunLog',
    'AbortController',
    'withTimeout',
    'factoryMarkImageRequestInactive',
    `${generationSource}; return generateImageWithAbortableTimeout;`,
  )(
    () => 100,
    fallback,
    () => Object.freeze({ modelId: 'model-a', route: 'test' }),
    () => 'request-a',
    () => undefined,
    () => undefined,
    undefined,
    promise => promise,
    () => undefined,
  );
  const executor = async (...args) => {
    calls.push(args);
    return 'generated';
  };

  // When: generation runs through the explicit capability.
  const result = await generate('hero', 'prompt', 'base64', 'image/png', [], {
    stageId: 'hero',
    timeoutMessage: 'timeout',
    executor,
  });

  // Then: the injected executor runs once and its private capability is not forwarded downstream.
  assert.equal(result, 'generated');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 4), ['prompt', 'base64', 'image/png', []]);
  assert.equal(Object.hasOwn(calls[0][4], 'executor'), false);
  const executorFailure = new Error('executor failed');
  await assert.rejects(
    generate('hero-failure', 'prompt', 'base64', 'image/png', [], {
      stageId: 'hero',
      timeoutMessage: 'timeout',
      executor: async () => { throw executorFailure; },
    }),
    error => error === executorFailure,
  );
  assert.doesNotMatch(asyncCore, /__KUASANGSE_IMAGE_GENERATION_TEST_HOOK__/);
});

test('Task 7 retires mutable classic globals and publishes only frozen diagnostics and metadata', () => {
  // Given: every shell-owned classic, loader, and workspace authority boundary is inventoried.
  const persistenceCore = source(CORE_02);
  const core = source(CORE_03);
  const factoryCore = source(CORE_05);
  const asyncCore = source(CORE_06);
  const loader = source(APP_LOADER);
  const lock = source(WORKSPACE_LOCK);
  const classic = `${persistenceCore}\n${core}\n${factoryCore}\n${asyncCore}`;

  // When/Then: live state, service, render, timing, rebinding, and writable test aliases are absent.
  const forbidden = Object.freeze({
    stateAssignment: /window\s*\.\s*(?:state|__kuasangseState)\s*=(?!=)/,
    legacyStateConsumption: /window\s*\.\s*__kuasangseState\b/,
    stateGetter: /Object\.defineProperty\(\s*window\s*,\s*['"]state['"]/,
    mutableFactoryFunction: /(?:^|\n)\s*(?:async\s+)?function\s+factoryState\s*\(/,
    publicRenderFunction: /(?:^|\n)\s*(?:async\s+)?function\s+render\s*\(/,
    renderTimingGlobals: /__KUASANGSE_RENDER_(?:STARTED|ENDED|LAST_MS)__/,
    reloadService: /__KUASANGSE_RELOAD_ACCEPTED_WORKSPACE__/,
    startupService: /__KUASANGSE_STARTUP_RESTORE_PROMISE__/,
    imageTestHook: /__KUASANGSE_IMAGE_GENERATION_TEST_HOOK__/,
    renderedImageAdapter: /window\.factoryHandleRenderedImageError\s*=/,
    ensureCafe24Adapter: /window\.ensureCafe24Modules\s*=/,
  });
  for (const [name, pattern] of Object.entries(forbidden)) {
    const target = name === 'ensureCafe24Adapter' ? loader : classic;
    assert.doesNotMatch(target, pattern, `${name} must be retired`);
  }

  // And: the mutable selector alias is retired; reads and diagnostics use the immutable store snapshot.
  assert.doesNotMatch(core, /\bclassicFactoryStateSelectors\b/);
  assert.match(core, /function\s+factoryRuntimeReadFactory\s*\(\)\s*\{[\s\S]*factoryRuntimeStore\.getSnapshot\(\)\?\.factory/);
  assert.match(core, /snapshot\(\)\s*\{\s*return factoryRuntimeRequireStore\(\)\.getSnapshot\(\);\s*\}/);
  assert.match(core, /const\s+render\s*=\s*function\s+render\s*\(/);
  assert.match(core, /diagnosticBridge\.install\(\)/);
  assert.match(loader, /reloadAccepted\s*:\s*accepted\s*=>\s*requestClassicRuntime\(['"]workspace-reload['"],\s*accepted\)/);
  assert.doesNotMatch(lock, /root\.__KUASANGSE_RELOAD_ACCEPTED_WORKSPACE__/);

  // And: operational metadata goes through a non-writable/non-configurable publication helper.
  assert.match(loader, /function\s+publishOperationalMetadata\s*\(/);
  const publication = extractFunction(loader, 'publishOperationalMetadata');
  assert.match(publication, /writable\s*:\s*false/);
  assert.match(publication, /configurable\s*:\s*false/);
  assert.match(loader, /__KUASANGSE_LOAD_ERRORS__/);
  assert.match(loader, /frozenLoadErrorsSnapshot/);
});
