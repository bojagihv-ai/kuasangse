const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

const FACTORY_TAB_SPECS = Object.freeze([
  Object.freeze({
    id: 'factory/start',
    file: 'src/menus/factory/tabs/start-tab.mjs',
    factory: 'createStartFactoryTab',
    owner: 'factory',
  }),
  Object.freeze({
    id: 'factory/db',
    file: 'src/menus/factory/tabs/db-tab.mjs',
    factory: 'createDbFactoryTab',
    owner: 'product-db',
  }),
  Object.freeze({
    id: 'factory/fields',
    file: 'src/menus/factory/tabs/fields-tab.mjs',
    factory: 'createFieldsFactoryTab',
    owner: 'product-db',
  }),
  Object.freeze({
    id: 'factory/competitor',
    file: 'src/menus/factory/tabs/competitor-tab.mjs',
    factory: 'createCompetitorFactoryTab',
    owner: 'competitors',
  }),
  Object.freeze({
    id: 'factory/assets',
    file: 'src/menus/factory/tabs/assets-tab.mjs',
    factory: 'createAssetsFactoryTab',
    owner: 'factory-assets',
  }),
  Object.freeze({
    id: 'factory/sections',
    file: 'src/menus/factory/tabs/sections-tab.mjs',
    factory: 'createSectionsFactoryTab',
    owner: 'detail-document',
  }),
  Object.freeze({
    id: 'factory/publish',
    file: 'src/menus/factory/tabs/publish-tab.mjs',
    factory: 'createPublishFactoryTab',
    owner: 'cafe24',
  }),
]);

const FACTORY_TAB_CONTRACT = 'src/menus/factory/factory-tab-contract.mjs';
const FACTORY_MENU = 'src/menus/factory/factory-menu.mjs';
const REQUIRED_BOUNDARIES = Object.freeze([
  FACTORY_TAB_CONTRACT,
  FACTORY_MENU,
  ...FACTORY_TAB_SPECS.map(spec => spec.file),
]);

const CORE_CLASSIC_BOUNDARY_PATTERNS = Object.freeze([
  ['renderFactoryAutomationStartWizard', /function\s+renderFactoryAutomationStartWizard\s*\(/],
  ['renderFactoryAutomationDbWizard', /function\s+renderFactoryAutomationDbWizard\s*\(/],
  ['renderFactoryAutomationFieldsWizard', /function\s+renderFactoryAutomationFieldsWizard\s*\(/],
  ['renderFactoryAutomationCompetitorWizard', /function\s+renderFactoryAutomationCompetitorWizard\s*\(/],
  ['renderFactoryAutomationAssetsWizard', /function\s+renderFactoryAutomationAssetsWizard\s*\(/],
  ['renderFactoryAutomationSectionsWizard', /function\s+renderFactoryAutomationSectionsWizard\s*\(/],
  ['renderFactoryAutomationPublishWizard', /function\s+renderFactoryAutomationPublishWizard\s*\(/],
  ['renderFactoryAutomationPanel', /function\s+renderFactoryAutomationPanel\s*\(/],
  ['renderFactory', /function\s+renderFactory\s*\(/],
  ['factoryAutomationCanonicalTab', /function\s+factoryAutomationCanonicalTab\s*\(/],
  ['factoryBindAutomationPartialControls', /function\s+factoryBindAutomationPartialControls\s*\(/],
  ['bindFactoryAutomationAssetPanelControls', /function\s+bindFactoryAutomationAssetPanelControls\s*\(/],
  ['runFactoryAutoTab', /\b(?:const|let)\s+runFactoryAutoTab\s*=/],
]);

function absolute(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function source(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function missingBoundaries(paths = REQUIRED_BOUNDARIES) {
  return paths.filter(relativePath => !fs.existsSync(absolute(relativePath)));
}

function missingMessage(paths) {
  return `missing Task 7 factory boundaries:\n${paths.map(relativePath => `- ${relativePath}`).join('\n')}`;
}

function skipWhenMissing(t, paths = REQUIRED_BOUNDARIES) {
  const missing = missingBoundaries(paths);
  if (!missing.length) return false;
  t.skip(missingMessage(missing));
  return true;
}

async function importFresh(relativePath, tag = 'task7') {
  return import(`${pathToFileURL(absolute(relativePath)).href}?${tag}=${Date.now()}-${Math.random()}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function helperValue(name, calls) {
  if (/escape(?:Html|Attr)|text|format|label|message/i.test(name)) {
    return value => String(value ?? '');
  }
  if (/disabledAttr/i.test(name)) return disabled => disabled ? 'disabled' : '';
  if (/^(?:FACTORY_|SECTION_|COMP_|MARKET_)/.test(name)
    || /(?:List|Rows|Items|Sections|Candidates|Assets|Sources|Tabs|Stages|Fields)$/i.test(name)) {
    return () => [];
  }
  return (...args) => {
    calls.push({ kind: 'render-helper', name, args });
    return '';
  };
}

function createFakeRoot(registry) {
  const rootListeners = new Map();
  const nodes = new Map();
  const root = {
    addEventListener(type, listener) {
      const normalizedType = String(type);
      let listenersForType = rootListeners.get(normalizedType);
      if (!listenersForType) {
        listenersForType = new Map();
        rootListeners.set(normalizedType, listenersForType);
      }
      if (!listenersForType.has(listener)) {
        const key = { type: normalizedType, listener };
        listenersForType.set(listener, key);
        registry.listeners.add(key);
      }
    },
    removeEventListener(type, listener) {
      const normalizedType = String(type);
      const listenersForType = rootListeners.get(normalizedType);
      const key = listenersForType?.get(listener);
      if (!key) return;
      listenersForType.delete(listener);
      if (!listenersForType.size) rootListeners.delete(normalizedType);
      registry.listeners.delete(key);
    },
    querySelector(selector) {
      return nodes.get(selector) || null;
    },
    querySelectorAll(selector) {
      return nodes.get(selector) || [];
    },
    contains() {
      return true;
    },
  };
  return {
    root,
    addNode(selector, node) { nodes.set(selector, node); },
  };
}

function createTimerRegistry(registry) {
  let nextId = 1;
  const timers = new Map();
  const schedule = (callback, delay = 0, repeating = false) => {
    const id = nextId++;
    timers.set(id, { callback, delay, repeating });
    registry.timers.add(id);
    return id;
  };
  const cancel = id => {
    if (timers.delete(id)) registry.timers.delete(id);
  };
  return Object.freeze({
    timers,
    schedule,
    cancel,
    setTimeout: callback => schedule(callback, 0, false),
    clearTimeout: cancel,
    setInterval: callback => schedule(callback, 0, true),
    clearInterval: cancel,
  });
}

function createTabSnapshot(spec) {
  return deepFreeze({
    tabId: spec.id,
    factory: {
      automation: { activeTab: spec.id.split('/')[1] },
      product: {},
      stages: {},
      assets: [],
      logs: [],
    },
    productDb: {},
    competitors: {},
    factoryAssets: {},
    detailDocument: {},
    cafe24: {},
  });
}

function createTabCapabilities(spec, options = {}) {
  const calls = [];
  const registry = {
    listeners: new Set(),
    timers: new Set(),
    saves: 0,
  };
  const timerRegistry = createTimerRegistry(registry);
  const snapshot = options.snapshot || createTabSnapshot(spec);
  let operationToken = 'workspace:factory-a:fence-1';
  let deferred = options.deferred || null;

  const actionTarget = new Proxy(Object.create(null), {
    get(_target, name) {
      if (name === 'then') return undefined;
      return (...args) => {
        calls.push({ kind: 'action', name, args });
        if (/save|persist|commit|write/i.test(String(name))) registry.saves += 1;
        return deferred?.promise || Promise.resolve({ name, args });
      };
    },
  });
  const renderHelpers = new Proxy(Object.create(null), {
    get(_target, name) {
      if (name === 'then') return undefined;
      return helperValue(String(name), calls);
    },
  });

  const capabilities = {
    getSnapshot: () => snapshot,
    assertMutable() {
      calls.push({ kind: 'assertMutable' });
      if (options.readOnly) throw new Error('READ_ONLY');
    },
    getOperationToken: () => operationToken,
    isOperationCurrent: candidate => candidate === undefined || candidate === operationToken,
    reportError: error => calls.push({ kind: 'reportError', error }),
    actions: actionTarget,
    renderHelpers,
    requestRender: () => calls.push({ kind: 'render' }),
    save: () => { registry.saves += 1; calls.push({ kind: 'save' }); },
    persist: () => { registry.saves += 1; calls.push({ kind: 'persist' }); },
    schedule: timerRegistry.schedule,
    cancelSchedule: timerRegistry.cancel,
    setTimeout: timerRegistry.setTimeout,
    clearTimeout: timerRegistry.clearTimeout,
    setInterval: timerRegistry.setInterval,
    clearInterval: timerRegistry.clearInterval,
    timerRegistry,
  };

  return {
    value: capabilities,
    snapshot,
    registry,
    calls,
    setOperationToken(value) { operationToken = value; },
    setDeferred(value) { deferred = value; },
  };
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

function firstCommand(contract, label) {
  const names = Object.keys(contract.commands || {});
  assert.ok(names.length > 0, `${label}: at least one command is required for authority/fence checks`);
  return names.find(name => {
    const capability = String(contract.commands[name]?.capability || '');
    return /write|mutat|save|publish|run|set|select|update|delete|create/i.test(`${name}:${capability}`);
  }) || names[0];
}

function assertNoLifecycleLeaks(registry, label) {
  assert.equal(registry.listeners.size, 0, `${label}: listener leak`);
  assert.equal(registry.timers.size, 0, `${label}: timer leak`);
  assert.equal(registry.saves, 0, `${label}: lifecycle must not save`);
}

test('FACTORY-TAB-MODULES: 7개 factory-tab boundary와 composition contract 경계를 한 번에 확인한다', () => {
  const missing = missingBoundaries();
  assert.equal(missing.length, 0, missingMessage(missing));
  assert.equal(FACTORY_TAB_SPECS.length, 7);
  assert.deepEqual(FACTORY_TAB_SPECS.map(spec => spec.id), [
    'factory/start', 'factory/db', 'factory/fields', 'factory/competitor',
    'factory/assets', 'factory/sections', 'factory/publish',
  ]);
});

test('FACTORY-TAB-CONTRACT: 실제 import된 7개 factory-tab:v1가 immutable owner/select/lifecycle contract를 제공한다', async t => {
  if (skipWhenMissing(t)) return;
  const contractNamespace = await importFresh(FACTORY_TAB_CONTRACT, 'task7-contract');
  assert.equal(contractNamespace.FACTORY_TAB_CONTRACT_VERSION, 'factory-tab:v1');
  assert.equal(typeof contractNamespace.createFactoryTabContract, 'function');

  for (const spec of FACTORY_TAB_SPECS) {
    const namespace = await importFresh(spec.file, `task7-tab-${spec.id}`);
    assert.deepEqual(Object.keys(namespace).sort(), [spec.factory], `${spec.id}: named export allowlist`);
    const harness = createTabCapabilities(spec);
    const tab = namespace[spec.factory](harness.value);

    assert.equal(tab.version, 'factory-tab:v1', `${spec.id}: version`);
    assert.equal(tab.id, spec.id, `${spec.id}: id`);
    assert.equal(tab.owner, spec.owner, `${spec.id}: owner`);
    assert.ok(Object.isFrozen(tab), `${spec.id}: contract must be frozen`);
    for (const field of ['select', 'render', 'bind', 'onEnter', 'onLeave']) {
      assert.equal(typeof tab[field], 'function', `${spec.id}: ${field}`);
    }
    assert.ok(tab.capabilities && typeof tab.capabilities === 'object', `${spec.id}: capabilities`);
    assert.ok(tab.commands && typeof tab.commands === 'object', `${spec.id}: commands`);
    assert.equal(Object.getPrototypeOf(tab.commands), null, `${spec.id}: own-key command record`);
    assert.ok(tab.persistence && typeof tab.persistence === 'object', `${spec.id}: persistence`);
    assert.deepEqual([...tab.persistence.reads], [spec.owner], `${spec.id}: reads owner`);
    assert.deepEqual([...tab.persistence.writes], [spec.owner], `${spec.id}: writes owner`);

    const selected = tab.select({ forbiddenRawRoot: true });
    assert.strictEqual(selected, harness.snapshot, `${spec.id}: select must use injected immutable snapshot`);
    assert.equal(Object.isFrozen(selected), true, `${spec.id}: select snapshot must be immutable`);
    assert.equal(typeof tab.render(selected), 'string', `${spec.id}: render output`);

    const fakeRoot = createFakeRoot(harness.registry);
    const dispose = tab.bind(fakeRoot.root);
    assert.equal(typeof dispose, 'function', `${spec.id}: bind disposer`);
    dispose();
    dispose();
    assertNoLifecycleLeaks(harness.registry, spec.id);

    Object.defineProperty(Object.prototype, 'inheritedFactoryCommand', {
      configurable: true,
      value: { capability: 'factory:read', execute: () => 'prototype-command-executed' },
    });
    try {
      assert.throws(
        () => tab.invoke('inheritedFactoryCommand'),
        /undeclared command/,
        `${spec.id}: inherited command must not execute`,
      );
    } finally {
      delete Object.prototype.inheritedFactoryCommand;
    }
  }
});

test('FACTORY-TAB-LIFECYCLE: 실제 tab contract를 50회 enter/leave/bind/dispose해도 listener·timer·save가 늘지 않는다', async t => {
  if (skipWhenMissing(t)) return;
  for (const spec of FACTORY_TAB_SPECS) {
    const namespace = await importFresh(spec.file, `task7-cycle-${spec.id}`);
    const harness = createTabCapabilities(spec);
    const tab = namespace[spec.factory](harness.value);
    const fakeRoot = createFakeRoot(harness.registry);
    for (let cycle = 0; cycle < 50; cycle += 1) {
      tab.onEnter();
      const dispose = tab.bind(fakeRoot.root);
      dispose();
      dispose();
      tab.onLeave();
      assertNoLifecycleLeaks(harness.registry, `${spec.id} cycle ${cycle + 1}`);
    }
  }
});

test('FACTORY-TAB-AUTHORITY: 읽기 전용 authority는 모든 tab의 첫 mutation command 전에 차단된다', async t => {
  if (skipWhenMissing(t)) return;
  for (const spec of FACTORY_TAB_SPECS) {
    const namespace = await importFresh(spec.file, `task7-readonly-${spec.id}`);
    const harness = createTabCapabilities(spec, { readOnly: true });
    const tab = namespace[spec.factory](harness.value);
    const commandName = firstCommand(tab, spec.id);
    assert.throws(() => tab.invoke(commandName, { blocked: true }), /READ_ONLY/, spec.id);
    assert.equal(
      harness.calls.some(call => call.kind === 'action'),
      false,
      `${spec.id}: action ran through read-only authority`,
    );
  }
});

test('FACTORY-TAB-STALE: workspace operation token 변경 뒤 async completion은 stale로 거부된다', async t => {
  if (skipWhenMissing(t)) return;
  for (const spec of FACTORY_TAB_SPECS) {
    let resolve;
    const deferred = { promise: new Promise(done => { resolve = done; }) };
    const namespace = await importFresh(spec.file, `task7-stale-${spec.id}`);
    const harness = createTabCapabilities(spec, { deferred });
    const tab = namespace[spec.factory](harness.value);
    const commandName = firstCommand(tab, spec.id);
    const pending = tab.invoke(commandName, { pending: true });
    assert.equal(typeof pending?.then, 'function', `${spec.id}: command must preserve async completion`);
    harness.setOperationToken('workspace:factory-b:fence-2');
    resolve({ foreign: true });
    await assert.rejects(pending, /STALE/i, `${spec.id}: stale completion was accepted`);
  }
});

test('FACTORY-MENU-COMPOSITION: registry descriptor로 active tab을 선택하고 validated tab에 render/bind/lifecycle를 위임한다', async t => {
  if (skipWhenMissing(t)) return;
  const registryNamespace = await importFresh('src/modules/module-registry.mjs', 'task7-registry');
  const tabContractNamespace = await importFresh(FACTORY_TAB_CONTRACT, 'task7-menu-contract');
  const descriptors = registryNamespace.FACTORY_TAB_MODULE_DESCRIPTORS;
  assert.equal(descriptors.length, 7);
  assert.deepEqual(descriptors.map(item => item.id), FACTORY_TAB_SPECS.map(spec => spec.id));

  const tabs = new Map();
  const tabHarnesses = new Map();
  for (const spec of FACTORY_TAB_SPECS) {
    const calls = [];
    const snapshot = createTabSnapshot(spec);
    const spyTab = tabContractNamespace.createFactoryTabContract({
      version: tabContractNamespace.FACTORY_TAB_CONTRACT_VERSION,
      id: spec.id,
      owner: spec.owner,
      capabilities: ['factory:read'],
      commands: {
        inspect: { capability: 'factory:read', execute: value => value },
      },
      select() {
        calls.push('select');
        return snapshot;
      },
      render(view) {
        calls.push(['render', view]);
        return `<div data-spy-factory-tab="${spec.id}"></div>`;
      },
      bind(root) {
        calls.push('bind');
        const listener = () => {};
        root.addEventListener('click', listener);
        return () => root.removeEventListener('click', listener);
      },
      onEnter() {
        calls.push('onEnter');
      },
      onLeave() {
        calls.push('onLeave');
      },
      persistence: { reads: [spec.owner], writes: [spec.owner] },
    });
    tabHarnesses.set(spec.id, { snapshot, calls });
    tabs.set(spec.id, spyTab);
  }

  let activeTab = 'db';
  const rootSnapshot = () => deepFreeze({
    factory: { automation: { activeTab }, product: {}, stages: {}, assets: [], logs: [] },
    productDb: {}, competitors: {}, factoryAssets: {}, detailDocument: {}, cafe24: {},
  });
  const menuHarness = createTabCapabilities({ id: 'factory', owner: 'factory' }, {
    snapshot: rootSnapshot(),
  });
  menuHarness.value.getSnapshot = rootSnapshot;
  const menuNamespace = await importFresh(FACTORY_MENU, 'task7-menu');
  assert.deepEqual(Object.keys(menuNamespace).sort(), ['createFactoryMenu']);
  const menu = menuNamespace.createFactoryMenu({
    ...menuHarness.value,
    tabs,
    tabRegistry: descriptors,
  });

  assert.equal(menu.version, 'menu:v1');
  assert.equal(menu.id, 'factory');
  assert.deepEqual([...menu.routes], ['factory']);
  assert.deepEqual([...menu.ownedSlices], ['factory']);
  assert.deepEqual([...menu.persistence.reads], ['factory']);
  assert.deepEqual([...menu.persistence.writes], ['factory']);

  const selectedDb = menu.select(rootSnapshot());
  assert.equal(selectedDb.activeTabId, 'factory/db');
  assert.strictEqual(selectedDb.tabSnapshot, tabHarnesses.get('factory/db').snapshot);
  assert.equal(Object.isFrozen(selectedDb), true);
  assert.equal(Object.isFrozen(selectedDb.tabSnapshot), true);
  assert.equal(typeof menu.render(selectedDb), 'string');
  assert.ok(tabHarnesses.get('factory/db').calls.includes('select'));
  assert.ok(tabHarnesses.get('factory/db').calls.some(call => Array.isArray(call) && call[0] === 'render'));

  activeTab = 'publish';
  const selectedPublish = menu.select(rootSnapshot());
  assert.equal(selectedPublish.activeTabId, 'factory/publish');
  assert.strictEqual(selectedPublish.tabSnapshot, tabHarnesses.get('factory/publish').snapshot);
  assert.equal(typeof menu.render(selectedPublish), 'string');
  assert.ok(tabHarnesses.get('factory/publish').calls.some(call => Array.isArray(call) && call[0] === 'render'));

  const rootHarness = createFakeRoot(menuHarness.registry);
  menu.onEnter();
  const dispose = menu.bind(rootHarness.root);
  dispose();
  dispose();
  menu.onLeave();
  assertNoLifecycleLeaks(menuHarness.registry, 'factory menu composition');
  const publishCalls = tabHarnesses.get('factory/publish').calls.filter(call => typeof call === 'string');
  for (const lifecycle of ['select', 'bind', 'onEnter', 'onLeave']) {
    assert.ok(publishCalls.includes(lifecycle), `factory/publish ${lifecycle} was not delegated`);
  }

  const incompleteTabs = new Map(tabs);
  incompleteTabs.delete('factory/publish');
  assert.throws(
    () => menuNamespace.createFactoryMenu({ ...menuHarness.value, tabs: incompleteTabs, tabRegistry: descriptors }),
    /factory\/publish|tab registry|missing/i,
    'composition must not silently fall back to a wrapper or missing tab',
  );
});

test('FACTORY-LOC: 모든 새 factory production module은 250 pure LOC 이하이다', async t => {
  if (skipWhenMissing(t)) return;
  const factoryRoot = absolute('src/menus/factory');
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && fullPath.endsWith('.mjs')) files.push(fullPath);
    }
  };
  walk(factoryRoot);
  assert.ok(files.length >= REQUIRED_BOUNDARIES.length - 0, 'factory module directory must contain all extracted modules');
  const oversized = files
    .map(file => ({ file: path.relative(ROOT, file).replaceAll(path.sep, '/'), lines: pureLoc(fs.readFileSync(file, 'utf8')) }))
    .filter(item => item.lines > 250);
  assert.deepEqual(oversized, [], `oversized factory production modules:\n${oversized.map(item => `- ${item.file}: ${item.lines} pure LOC`).join('\n')}`);
});

test('FACTORY-CLASSIC-BOUNDARY: green 이후 classic core와 generated bundle에는 이동한 renderer/dispatcher/listener 구현이 없다', async t => {
  if (skipWhenMissing(t)) return;
  const classicSources = [
    ['src/app-core-05.js', source('src/app-core-05.js')],
    ['src/app-core-06.js', source('src/app-core-06.js')],
    ['dist/app-runtime.bundle.js', source('dist/app-runtime.bundle.js')],
  ];
  for (const [file, text] of classicSources) {
    for (const [name, pattern] of CORE_CLASSIC_BOUNDARY_PATTERNS) {
      assert.doesNotMatch(text, pattern, `${file}: moved ${name} implementation remains`);
    }
  }
  for (const spec of FACTORY_TAB_SPECS) {
    const text = source(spec.file);
    assert.doesNotMatch(text, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/, `${spec.id}: raw global access`);
    assert.doesNotMatch(text, /\bstate\s*(?:\.|\[)/, `${spec.id}: mutable global state access`);
    assert.doesNotMatch(text, /from\s+['"][^'"]*app-core[^'"]*['"]/, `${spec.id}: wrapper-only classic import`);
  }
});
