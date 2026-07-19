const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

/*
 * Task 7 failing-first shell contract.
 *
 * The four paths below are intentional architecture boundaries.  They are
 * imported directly instead of inferred from a bundle so that a wrapper-only
 * implementation cannot satisfy the shell contract accidentally.
 *
 *   src/shell/route-controller.mjs         route registry + navigation gate
 *   src/shell/render-lifecycle.mjs         render/bind/leave disposer owner
 *   src/shell/bootstrap.mjs                authority/module/boot coordinator
 *   src/shell/legacy-diagnostic-bridge.mjs read-only diagnostic projection
 */

const ROOT = path.resolve(__dirname, '..', '..');
const TARGETS = Object.freeze({
  routeController: 'src/shell/route-controller.mjs',
  renderLifecycle: 'src/shell/render-lifecycle.mjs',
  bootstrap: 'src/shell/bootstrap.mjs',
  diagnostics: 'src/shell/legacy-diagnostic-bridge.mjs',
});
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
const HYDRATION_ENVELOPE = Object.freeze({
  schema: 'kuasangse.app-state',
  version: 'app-state:v1',
  state: Object.freeze({ shell: Object.freeze({ route: 'upload' }) }),
});

function absolute(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function source(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function moduleUrl(relativePath) {
  return `${pathToFileURL(absolute(relativePath)).href}?task7=${Date.now()}-${Math.random()}`;
}

async function importTarget(relativePath) {
  // Keep the import boundary explicit.  A missing target is a useful red
  // result here, and Node's original ERR_MODULE_NOT_FOUND identifies it.
  return import(moduleUrl(relativePath));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function detachedFrozen(value) {
  return deepFreeze(structuredClone(value));
}

function makeRoot() {
  return {
    innerHTML: '',
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeMenu(id, counters) {
  const menu = {
    id,
    routes: Object.freeze([id]),
    select(snapshot) {
      return detachedFrozen({ route: id, workspaceId: snapshot?.workspaceId || '' });
    },
    render(snapshot) {
      counters.render += 1;
      return `<section data-route="${id}">${snapshot?.workspaceId || ''}</section>`;
    },
    bind() {
      counters.bind += 1;
      counters.activeListeners += 1;
      counters.eventLog?.push(`${id}:bind`);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        counters.dispose += 1;
        counters.activeListeners -= 1;
        counters.eventLog?.push(`${id}:dispose`);
      };
    },
    onEnter() {
      counters.enter += 1;
      counters.activeTimers += 1;
      counters.eventLog?.push(`${id}:enter`);
    },
    onLeave() {
      counters.leave += 1;
      counters.activeTimers -= 1;
      counters.eventLog?.push(`${id}:leave`);
    },
  };
  return Object.freeze(menu);
}

function makeCounters(eventLog = null) {
  return {
    render: 0,
    bind: 0,
    dispose: 0,
    enter: 0,
    leave: 0,
    activeListeners: 0,
    activeTimers: 0,
    eventLog,
  };
}

function makeRegistry(descriptors, eventLog = null) {
  const counters = new Map(descriptors.map(descriptor => [descriptor.id, makeCounters(eventLog)]));
  const menus = new Map(descriptors.map(descriptor => [descriptor.id, makeMenu(
    descriptor.id,
    counters.get(descriptor.id),
  )]));
  return {
    descriptors,
    counters,
    menus,
    list(kind = '') {
      return kind ? descriptors.filter(descriptor => descriptor.kind === kind) : descriptors.slice();
    },
    getByRoute(route) {
      return menus.get(String(route || '').trim()) || null;
    },
    get(route) {
      return menus.get(String(route || '').trim()) || null;
    },
  };
}

function totalCounters(registry, field) {
  return [...registry.counters.values()].reduce((sum, counters) => sum + counters[field], 0);
}

function statusError(status) {
  if (!status) return '';
  if (status.error instanceof Error) return status.error.message;
  if (status.error && typeof status.error === 'object') return String(status.error.message || status.error.detail || status.error);
  return String(status.error || status.message || '');
}

function extractFunctionBlock(text, name) {
  const start = text.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) return '';
  const open = text.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === '\'' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

test('T7 shell target boundary는 네 개의 명시적 ESM 모듈을 요구한다', async () => {
  for (const [label, relativePath] of Object.entries(TARGETS)) {
    assert.equal(fs.existsSync(absolute(relativePath)), true, `${label}: missing ${relativePath}`);
  }

  const route = await importTarget(TARGETS.routeController);
  const lifecycle = await importTarget(TARGETS.renderLifecycle);
  const bootstrap = await importTarget(TARGETS.bootstrap);
  const diagnostics = await importTarget(TARGETS.diagnostics);
  assert.equal(typeof route.createRouteController, 'function');
  assert.equal(typeof lifecycle.createRenderLifecycleCoordinator, 'function');
  assert.equal(typeof bootstrap.createBootstrapCoordinator, 'function');
  assert.equal(typeof diagnostics.createLegacyDiagnosticBridge, 'function');
});

test('T7 route controller는 module registry의 12 sidebar route만 선택하고 gate redirect를 적용한다', async () => {
  const [{ createRouteController }, { createRenderLifecycleCoordinator }, { moduleRegistry }] = await Promise.all([
    importTarget(TARGETS.routeController),
    importTarget(TARGETS.renderLifecycle),
    importTarget('src/modules/module-registry.mjs'),
  ]);
  const descriptors = moduleRegistry.list('sidebar');
  assert.deepEqual(descriptors.map(item => item.id), SIDEBAR_ROUTES);
  assert.equal(Object.isFrozen(descriptors), true);

  const registry = makeRegistry(descriptors);
  const root = makeRoot();
  const rendered = [];
  const lifecycle = createRenderLifecycleCoordinator({
    root,
    render({ route, menu, snapshot }) {
      rendered.push(route);
      root.innerHTML = menu.render(snapshot);
    },
  });
  const controller = createRouteController({
    registry,
    renderLifecycle: lifecycle,
    routeGate() { return { blocked: false }; },
  });

  // With the route gate open, every registry entry must be selected through
  // getByRoute; the controller cannot render a private switch statement.
  for (const route of SIDEBAR_ROUTES) {
    const result = await controller.navigate(route, { workspaceId: 'workspace-a', bypassGate: true });
    assert.ok(result === undefined || typeof result === 'object');
    assert.equal(controller.currentRoute(), route);
    assert.equal(rendered.at(-1), route);
  }
  assert.equal(rendered.length, SIDEBAR_ROUTES.length);
  assert.deepEqual([...registry.menus.keys()], SIDEBAR_ROUTES);

  const gated = createRouteController({
    registry,
    renderLifecycle: createRenderLifecycleCoordinator({ root: makeRoot(), render() {} }),
    routeGate(route) {
      return route === 'sections' ? { blocked: true, redirect: 'upload', reason: 'analysis required' } : { blocked: false };
    },
  });
  await gated.navigate('sections', { workspaceId: 'workspace-a' });
  assert.equal(gated.currentRoute(), 'upload', 'blocked route must follow the explicit gate redirect');
  assert.equal(registry.counters.get('sections').enter, 1, 'bypassGate route above is the only sections activation');
});

test('T7 render lifecycle는 old disposer/onLeave와 new onEnter/bind 순서를 한 번만 실행하고 50 cycle 후 정리된다', async () => {
  const [{ createRouteController }, { createRenderLifecycleCoordinator }, { moduleRegistry }] = await Promise.all([
    importTarget(TARGETS.routeController),
    importTarget(TARGETS.renderLifecycle),
    importTarget('src/modules/module-registry.mjs'),
  ]);
  const descriptors = moduleRegistry.list('sidebar');
  const lifecycleOrder = [];
  const registry = makeRegistry(descriptors, lifecycleOrder);
  const root = makeRoot();
  const events = [];
  const lifecycle = createRenderLifecycleCoordinator({
    root,
    render({ route, menu, snapshot }) {
      events.push(`render:${route}`);
      root.innerHTML = menu.render(snapshot);
    },
  });
  const controller = createRouteController({ registry, renderLifecycle: lifecycle });

  await controller.navigate('upload', { workspaceId: 'workspace-a' });
  const uploadRenderCount = registry.counters.get('upload').render;
  await controller.navigate('upload', { workspaceId: 'workspace-a' });
  assert.equal(registry.counters.get('upload').render, uploadRenderCount, 'same route/workspace must be a no-op');

  const firstTransitionEnd = lifecycleOrder.length;
  await controller.navigate('analyzing', { workspaceId: 'workspace-a' });
  const transition = lifecycleOrder.slice(firstTransitionEnd);
  const oldDispose = transition.indexOf('upload:dispose');
  const oldLeave = transition.indexOf('upload:leave');
  const newEnter = transition.indexOf('analyzing:enter');
  const newBind = transition.indexOf('analyzing:bind');
  assert.ok(oldDispose >= 0 && oldLeave >= 0, 'old route must dispose and leave');
  assert.ok(newEnter >= 0 && newBind >= 0, 'new route must enter and bind');
  assert.ok(oldDispose < newEnter && oldLeave < newEnter, 'old route cleanup precedes new enter');
  assert.ok(oldDispose < newBind && oldLeave < newBind, 'old route cleanup precedes new bind');

  for (let cycle = 0; cycle < 50; cycle += 1) {
    for (const descriptor of descriptors) {
      await controller.navigate(descriptor.id, { workspaceId: 'workspace-a' });
    }
  }
  controller.dispose();
  controller.dispose();
  lifecycle.dispose();
  lifecycle.dispose();

  for (const [route, counters] of registry.counters) {
    assert.equal(counters.bind, counters.dispose, `${route}: every bind has one disposer`);
    assert.equal(counters.enter, counters.leave, `${route}: every enter has one leave`);
    assert.equal(counters.activeListeners, 0, `${route}: no listener remains after dispose`);
    assert.equal(counters.activeTimers, 0, `${route}: no timer remains after dispose`);
  }
  assert.ok(events.length >= SIDEBAR_ROUTES.length, 'render lifecycle must render actual routes');
  assert.equal(lifecycle.currentRoute(), null);
});

test('T7 route/workspace switch invalidates stale operation tokens while same route+workspace stays current', async () => {
  const [{ createRouteController }, { createRenderLifecycleCoordinator }, { moduleRegistry }] = await Promise.all([
    importTarget(TARGETS.routeController),
    importTarget(TARGETS.renderLifecycle),
    importTarget('src/modules/module-registry.mjs'),
  ]);
  const registry = makeRegistry(moduleRegistry.list('sidebar'));
  const controller = createRouteController({
    registry,
    renderLifecycle: createRenderLifecycleCoordinator({ root: makeRoot(), render() {} }),
  });
  await controller.navigate('upload', { workspaceId: 'workspace-a' });
  const first = controller.captureOperation();
  assert.equal(controller.isCurrent(first), true);

  await controller.navigate('preview', { workspaceId: 'workspace-b' });
  assert.equal(controller.isCurrent(first), false, 'route + workspace change fences old async work');
  const second = controller.captureOperation();
  assert.equal(controller.isCurrent(second), true);
  await controller.navigate('preview', { workspaceId: 'workspace-b' });
  assert.equal(controller.isCurrent(second), true, 'same route + workspace must not invalidate active work');

  await controller.navigate('preview', { workspaceId: 'workspace-c' });
  assert.equal(controller.isCurrent(second), false, 'workspace-only change also fences stale work');
  controller.dispose();
});

test('T7 bootstrap은 authority→modules→bundle/compat→menu install→versioned hydrate→initial render를 idempotently 보장한다', async () => {
  const { createBootstrapCoordinator } = await importTarget(TARGETS.bootstrap);
  const events = [];
  const counters = { listeners: 0, timers: 0, saves: 0, logs: 0 };
  let hydrated = false;
  const stage = (name, action = async () => undefined) => async (...args) => {
    events.push(name);
    return action(...args);
  };
  const coordinator = createBootstrapCoordinator({
    authority: stage('authority'),
    modules: stage('modules'),
    bundleCompat: stage('bundle-compat'),
    installMenuModules: stage('menu-install', async () => {
      counters.listeners += 1;
      counters.timers += 1;
      counters.saves += 1;
      counters.logs += 1;
    }),
    hydrationEnvelope: HYDRATION_ENVELOPE,
    hydrate: stage('hydrate', async envelope => {
      assert.deepEqual(envelope, HYDRATION_ENVELOPE, 'hydration must receive a versioned envelope');
      hydrated = true;
    }),
    render: stage('render', async () => {
      assert.equal(hydrated, true, 'initial render cannot precede hydration');
    }),
  });
  assert.equal(typeof coordinator.boot, 'function');
  assert.equal(typeof coordinator.getStatus, 'function');

  const firstBoot = coordinator.boot();
  const secondBoot = coordinator.boot();
  await Promise.all([firstBoot, secondBoot]);
  await coordinator.boot();
  assert.deepEqual(events, [
    'authority',
    'modules',
    'bundle-compat',
    'menu-install',
    'hydrate',
    'render',
  ]);
  assert.deepEqual(counters, { listeners: 1, timers: 1, saves: 1, logs: 1 });
  const status = coordinator.getStatus();
  assert.equal(status.ready, true);
  assert.equal(status.phase, 'ready');
});

test('T7 bootstrap의 authority/manifest/module 일부 실패는 visibly reject되고 partial ready를 남기지 않는다', async () => {
  const { createBootstrapCoordinator } = await importTarget(TARGETS.bootstrap);
  const events = [];
  const failure = new Error('manifest module import failed: src/shell/missing.mjs');
  const coordinator = createBootstrapCoordinator({
    authority: async () => { events.push('authority'); },
    modules: async () => {
      events.push('modules');
      throw failure;
    },
    bundleCompat: async () => { events.push('bundle-compat'); },
    installMenuModules: async () => { events.push('menu-install'); },
    hydrate: async () => { events.push('hydrate'); },
    render: async () => { events.push('render'); },
  });
  const first = coordinator.boot();
  const second = coordinator.boot();
  await Promise.all([
    assert.rejects(first, /manifest module import failed/),
    assert.rejects(second, /manifest module import failed/),
  ]);
  assert.deepEqual(events, ['authority', 'modules']);
  const status = coordinator.getStatus();
  assert.equal(status.ready, false);
  assert.equal(status.phase, 'failed');
  assert.match(statusError(status), /manifest module import failed/);
  assert.notEqual(status.partialReady, true, 'failure cannot be reported as partial readiness');
});

test('T7 diagnostic bridge는 mutable global alias 대신 frozen detached snapshot만 설치한다', async () => {
  const { createLegacyDiagnosticBridge } = await importTarget(TARGETS.diagnostics);
  const state = {
    shell: { route: 'upload' },
    factory: { selected: { id: 'asset-1' } },
  };
  const store = {
    snapshot() { return detachedFrozen(state); },
  };
  const root = {};
  const bridge = createLegacyDiagnosticBridge({ store, root });
  assert.equal(typeof bridge.install, 'function');
  assert.equal(typeof bridge.snapshot, 'function');
  const exposed = bridge.install();
  assert.equal(root.__KUASANGSE_DIAGNOSTIC__, exposed);
  assert.equal(Object.hasOwn(root, 'state'), false);
  assert.equal(Object.hasOwn(root, '__kuasangseState'), false);
  assert.equal(Object.hasOwn(root, 'factoryState'), false);
  const descriptor = Object.getOwnPropertyDescriptor(root, '__KUASANGSE_DIAGNOSTIC__');
  assert.ok(descriptor);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.equal(Object.isFrozen(exposed), true);
  assert.equal(Object.isFrozen(exposed.factory), true);
  try { exposed.factory.selected.id = 'mutated'; } catch (_) {}
  assert.equal(store.snapshot().factory.selected.id, 'asset-1');

  const inheritedRoot = Object.create({
    state: { mutable: true },
    __kuasangseState: { mutable: true },
    factoryState() { return { mutable: true }; },
  });
  const inheritedBridge = createLegacyDiagnosticBridge({ store, root: inheritedRoot });
  assert.throws(() => inheritedBridge.install(), /legacy global|inherited|mutable/i);
  bridge.dispose();
});

test('T7 factory selector/diagnostic snapshot은 archive/save/timer side effect 없이 읽기만 한다', async () => {
  const { createLegacyDiagnosticBridge } = await importTarget(TARGETS.diagnostics);
  const effects = { archive: 0, save: 0, timer: 0 };
  const store = {
    snapshot() {
      return detachedFrozen({ factory: { current: { id: 'asset-1' } } });
    },
    select(selector) {
      return detachedFrozen(selector({ factory: { current: { id: 'asset-1' } } }));
    },
  };
  const root = {};
  const bridge = createLegacyDiagnosticBridge({
    store,
    root,
    archive() { effects.archive += 1; },
    save() { effects.save += 1; },
    setTimer() { effects.timer += 1; },
  });
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.factory.current.id, 'asset-1');
  assert.deepEqual(effects, { archive: 0, save: 0, timer: 0 });
  assert.equal(Object.isFrozen(snapshot), true);
  bridge.dispose();
});

test('T7 classic app-core router/bootstrap/global source boundary는 shell ESM으로 위임된 뒤에만 green이다', () => {
  const classicRouter = source('src/app-core-03.js');
  const classicFactory = source('src/app-core-05.js');
  const classicAsync = source('src/app-core-06.js');
  const loader = source('src/app-loader.js');
  const renderBlock = extractFunctionBlock(classicRouter, 'render');
  if (renderBlock) {
    assert.doesNotMatch(renderBlock, /state\.step\s*===|renderRuntimeMenu\s*\(/,
      'classic render must not contain a hardcoded route switch');
    assert.doesNotMatch(renderBlock, /switch\s*\(\s*state\.step\s*\)/,
      'classic render must delegate to the registry/lifecycle shell');
  }
  const classic = [classicRouter, classicFactory, classicAsync].join('\n');
  assert.doesNotMatch(classic, /window\s*\.\s*__kuasangseState\s*=/,
    'mutable __kuasangseState publication is forbidden');
  assert.doesNotMatch(classic, /Object\.defineProperty\(\s*window\s*,\s*['"]state['"]/, 
    'mutable window.state getter publication is forbidden');
  assert.doesNotMatch(classic, /window\s*\.\s*state\s*=/,
    'mutable window.state assignment is forbidden');
  assert.doesNotMatch(classic, /(?:^|\n)\s*(?:async\s+)?function\s+factoryState\s*\(/,
    'classic factoryState function binding is a mutable global exposure');
  assert.doesNotMatch(loader, /for\s*\(\s*const\s+file\s+of\s+manifest\.modules\s*\)/,
    'manifest module orchestration belongs to bootstrap.mjs');
  assert.doesNotMatch(loader, /installRuntimeMenus\s*\(/,
    'menu installation belongs to bootstrap/shell');
  assert.match(loader, /bootstrap\.mjs|createBootstrapCoordinator/,
    'app-loader must import the canonical bootstrap boundary');
  const routeController = source(TARGETS.routeController);
  assert.doesNotMatch(routeController, /\bswitch\s*\(/,
    'route controller must query registry descriptors, not a route switch');
  assert.doesNotMatch(routeController, /render(?:Upload|Analyzing|Competitor|Sections|Generating|Preview)\s*\(/,
    'route controller must not own classic per-route renderers');
});
