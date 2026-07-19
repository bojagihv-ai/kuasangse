const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function moduleUrl(relativePath) {
  const absolute = path.join(ROOT, ...relativePath.split('/'));
  return `${pathToFileURL(absolute).href}?unit=${Date.now()}-${Math.random()}`;
}

function importShell(name) {
  return import(moduleUrl(`src/shell/${name}.mjs`));
}

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

function makeMenu(id, events, counts) {
  return Object.freeze({
    id,
    routes: Object.freeze([id]),
    select(snapshot) {
      return Object.freeze({ route: id, workspaceId: snapshot.workspaceId });
    },
    render(snapshot) {
      counts.render += 1;
      return `${id}:${snapshot.workspaceId}`;
    },
    bind() {
      counts.bind += 1;
      counts.listeners += 1;
      events.push(`${id}:bind`);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        counts.dispose += 1;
        counts.listeners -= 1;
        events.push(`${id}:dispose`);
      };
    },
    onEnter() {
      counts.enter += 1;
      counts.timers += 1;
      events.push(`${id}:enter`);
    },
    onLeave() {
      counts.leave += 1;
      counts.timers -= 1;
      events.push(`${id}:leave`);
    },
  });
}

function makeCounts() {
  return {
    render: 0,
    bind: 0,
    dispose: 0,
    enter: 0,
    leave: 0,
    listeners: 0,
    timers: 0,
    saves: 0,
  };
}

test('Given 차단 route When gate가 redirect하면 Then registry의 redirect menu만 활성화한다', async () => {
  // Given
  const [{ createRouteController }, { createRenderLifecycleCoordinator }] = await Promise.all([
    importShell('route-controller'),
    importShell('render-lifecycle'),
  ]);
  const events = [];
  const uploadCounts = makeCounts();
  const sectionsCounts = makeCounts();
  const menus = new Map([
    ['upload', makeMenu('upload', events, uploadCounts)],
    ['sections', makeMenu('sections', events, sectionsCounts)],
  ]);
  const lookups = [];
  const registry = {
    getByRoute(route) {
      lookups.push(route);
      return menus.get(route) || null;
    },
  };
  const lifecycle = createRenderLifecycleCoordinator({
    root: {},
    render({ route, menu, snapshot }) {
      events.push(`render:${route}`);
      menu.render(snapshot);
    },
  });
  const controller = createRouteController({
    registry,
    renderLifecycle: lifecycle,
    routeGate(route) {
      return route === 'sections'
        ? { blocked: true, redirect: 'upload', reason: 'analysis required' }
        : { blocked: false };
    },
  });

  // When
  await controller.navigate('sections', { workspaceId: 'workspace-a' });
  const operation = controller.captureOperation();
  await controller.navigate('upload', { workspaceId: 'workspace-a' });

  // Then
  assert.equal(controller.currentRoute(), 'upload');
  assert.deepEqual(lookups, ['upload']);
  assert.equal(sectionsCounts.enter, 0);
  assert.equal(uploadCounts.render, 1, 'same route/workspace redirect is a no-op');
  assert.equal(controller.isCurrent(operation), true);

  await controller.navigate('upload', { workspaceId: 'workspace-b' });
  assert.equal(controller.isCurrent(operation), false, 'workspace-only changes fence old work');
  controller.dispose();
});

test('Given 두 menu When 50회 반복 활성화하면 Then disposer와 onLeave가 정확히 짝을 이룬다', async () => {
  // Given
  const { createRenderLifecycleCoordinator } = await importShell('render-lifecycle');
  const events = [];
  const leftCounts = makeCounts();
  const rightCounts = makeCounts();
  const left = makeMenu('left', events, leftCounts);
  const right = makeMenu('right', events, rightCounts);
  const lifecycle = createRenderLifecycleCoordinator({
    root: {},
    render({ route, menu, snapshot }) {
      events.push(`render:${route}`);
      menu.render(snapshot);
    },
  });

  // When
  await lifecycle.activate({ route: 'left', menu: left, snapshot: { workspaceId: 'w' }, workspaceId: 'w' });
  const transitionStart = events.length;
  await lifecycle.activate({ route: 'right', menu: right, snapshot: { workspaceId: 'w' }, workspaceId: 'w' });
  const firstTransition = events.slice(transitionStart);
  for (let cycle = 0; cycle < 50; cycle += 1) {
    await lifecycle.activate({ route: 'left', menu: left, snapshot: { workspaceId: 'w' }, workspaceId: 'w' });
    await lifecycle.activate({ route: 'right', menu: right, snapshot: { workspaceId: 'w' }, workspaceId: 'w' });
  }
  lifecycle.dispose();
  lifecycle.dispose();

  // Then
  assert.deepEqual(firstTransition, [
    'left:dispose',
    'left:leave',
    'render:right',
    'right:enter',
    'right:bind',
  ]);
  for (const counts of [leftCounts, rightCounts]) {
    assert.equal(counts.bind, counts.dispose);
    assert.equal(counts.enter, counts.leave);
    assert.equal(counts.listeners, 0);
    assert.equal(counts.timers, 0);
    assert.equal(counts.saves, 0);
  }
  assert.equal(lifecycle.currentRoute(), null);
});

test('Given 지연 render When workspace를 전환하면 Then 이전 operation은 완료 전에 stale이 된다', async () => {
  // Given
  const { createRenderLifecycleCoordinator } = await importShell('render-lifecycle');
  const events = [];
  const counts = makeCounts();
  const menu = makeMenu('preview', events, counts);
  const renderStarted = deferred();
  const releaseRender = deferred();
  const lifecycle = createRenderLifecycleCoordinator({
    root: {},
    async render({ snapshot }) {
      if (snapshot.workspaceId !== 'workspace-b') return;
      renderStarted.resolve();
      await releaseRender.promise;
    },
  });
  await lifecycle.activate({
    route: 'preview',
    menu,
    snapshot: { workspaceId: 'workspace-a' },
    workspaceId: 'workspace-a',
  });
  const oldOperation = lifecycle.captureOperation();

  // When
  const switching = lifecycle.activate({
    route: 'preview',
    menu,
    snapshot: { workspaceId: 'workspace-b' },
    workspaceId: 'workspace-b',
  });
  await renderStarted.promise;

  // Then
  assert.equal(lifecycle.isCurrent(oldOperation), false);
  releaseRender.resolve();
  await switching;
  const currentOperation = lifecycle.captureOperation();
  await lifecycle.activate({
    route: 'preview',
    menu,
    snapshot: { workspaceId: 'workspace-b' },
    workspaceId: 'workspace-b',
  });
  assert.equal(lifecycle.isCurrent(currentOperation), true);
  lifecycle.dispose();
});

test('Given 동시 boot 호출 When 첫 단계가 대기하면 Then 하나의 promise와 정확한 단계 순서를 공유한다', async () => {
  // Given
  const { createBootstrapCoordinator } = await importShell('bootstrap');
  const events = [];
  const authorityStarted = deferred();
  const releaseAuthority = deferred();
  const envelope = Object.freeze({
    schema: 'kuasangse.app-state',
    version: 'app-state:v1',
    state: Object.freeze({ shell: Object.freeze({ route: 'upload' }) }),
  });
  const stage = name => async () => { events.push(name); };
  const coordinator = createBootstrapCoordinator({
    authority: async () => {
      events.push('authority');
      authorityStarted.resolve();
      await releaseAuthority.promise;
    },
    modules: stage('modules'),
    bundleCompat: stage('bundle-compat'),
    installMenuModules: stage('menu-install'),
    hydrationEnvelope: envelope,
    hydrate: async value => {
      events.push('hydrate');
      assert.deepEqual(value, envelope);
    },
    render: stage('render'),
  });

  // When
  const first = coordinator.boot();
  const second = coordinator.boot();
  await authorityStarted.promise;

  // Then
  assert.strictEqual(first, second);
  releaseAuthority.resolve();
  await Promise.all([first, second]);
  assert.strictEqual(coordinator.boot(), first);
  assert.deepEqual(events, [
    'authority',
    'modules',
    'bundle-compat',
    'menu-install',
    'hydrate',
    'render',
  ]);
  const status = coordinator.getStatus();
  assert.equal(Object.isFrozen(status), true);
  assert.deepEqual(Object.keys(status), ['phase', 'ready', 'error']);
  assert.deepEqual(status, { phase: 'ready', ready: true, error: null });
});

test('Given module stage 실패 When boot가 겹치면 Then 모두 reject되고 partial ready가 없다', async () => {
  // Given
  const { createBootstrapCoordinator } = await importShell('bootstrap');
  const events = [];
  const failure = new Error('module import failed');
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

  // When
  const first = coordinator.boot();
  const second = coordinator.boot();

  // Then
  assert.strictEqual(first, second);
  await Promise.all([
    assert.rejects(first, error => error === failure),
    assert.rejects(second, error => error === failure),
  ]);
  assert.deepEqual(events, ['authority', 'modules']);
  const status = coordinator.getStatus();
  assert.equal(Object.isFrozen(status), true);
  assert.deepEqual(Object.keys(status), ['phase', 'ready', 'error']);
  assert.equal(status.phase, 'failed');
  assert.equal(status.ready, false);
  assert.strictEqual(status.error, failure);
});

test('Given own 또는 inherited legacy alias When bridge를 설치하면 Then 오염을 거부한다', async () => {
  // Given
  const { createLegacyDiagnosticBridge } = await importShell('legacy-diagnostic-bridge');
  const store = { snapshot: () => ({ shell: { route: 'upload' } }) };

  // When / Then
  for (const alias of ['state', '__kuasangseState', 'factoryState']) {
    const ownRoot = { [alias]: { mutable: true } };
    const inheritedRoot = Object.create({ [alias]: { mutable: true } });
    assert.throws(
      () => createLegacyDiagnosticBridge({ store, root: ownRoot }).install(),
      /legacy global|mutable alias|inherited/i,
    );
    assert.throws(
      () => createLegacyDiagnosticBridge({ store, root: inheritedRoot }).install(),
      /legacy global|mutable alias|inherited/i,
    );
  }
});

test('Given 중첩 mutable state When snapshot과 install을 호출하면 Then detached deep-frozen 값만 남긴다', async () => {
  // Given
  const { createLegacyDiagnosticBridge } = await importShell('legacy-diagnostic-bridge');
  const state = {
    shell: { route: 'upload' },
    factory: { selected: { id: 'asset-1', tags: ['new'] } },
  };
  const store = { snapshot: () => state };
  const root = {};
  const bridge = createLegacyDiagnosticBridge({ store, root });

  // When
  const snapshot = bridge.snapshot();
  const installed = bridge.install();
  assert.throws(() => snapshot.factory.selected.tags.push('mutated'), TypeError);
  installed.factory.selected.id = 'mutated';
  bridge.dispose();
  bridge.dispose();

  // Then
  assert.equal(state.factory.selected.id, 'asset-1');
  assert.deepEqual(state.factory.selected.tags, ['new']);
  assert.equal(Object.isFrozen(snapshot.factory.selected.tags), true);
  assert.strictEqual(bridge.install(), installed, 'dispose cannot redefine a non-configurable diagnostic');
  assert.deepEqual(Object.getOwnPropertyNames(root), ['__KUASANGSE_DIAGNOSTIC__']);
  const descriptor = Object.getOwnPropertyDescriptor(root, '__KUASANGSE_DIAGNOSTIC__');
  assert.deepEqual(
    { writable: descriptor.writable, configurable: descriptor.configurable },
    { writable: false, configurable: false },
  );
});
