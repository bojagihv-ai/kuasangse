const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const IDS = Object.freeze([
  'factory/start', 'factory/db', 'factory/fields', 'factory/competitor',
  'factory/assets', 'factory/sections', 'factory/publish',
]);

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}

function fakeRoot() {
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
    click(value) {
      const button = typeof value === 'object'
        ? value
        : { getAttribute: name => name === 'data-factory-auto-tab' ? value : null };
      let prevented = false;
      for (const listener of [...(listeners.get('click') || [])]) {
        listener({
          target: { closest: selector => selector === '[data-factory-auto-tab]' ? button : null },
          preventDefault() { prevented = true; },
        });
      }
      return prevented;
    },
  };
}

async function menuHarness({ readOnly = false, deferred = null } = {}) {
  const calls = [];
  const reports = [];
  let token = 'workspace:a:fence:1';
  let leafListeners = 0;
  const snapshot = frozen({ factory: { automation: { activeTab: 'start' } } });
  const tabs = new Map(IDS.map(id => [id, frozen({
    version: 'factory-tab:v1',
    id,
    select: () => frozen({ id }),
    render: () => `<div>${id}</div>`,
    bind() { leafListeners += 1; return () => { leafListeners -= 1; }; },
    onEnter() {},
    onLeave() {},
  })]));
  const tabRegistry = frozen(IDS.map((id, order) => ({ id, kind: 'factory-tab', order, api: 'factory-tab:v1' })));
  const actions = {
    selectFactoryTab(id) {
      calls.push(id);
      return deferred?.promise || Promise.resolve(id);
    },
  };
  const namespace = await import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/factory-menu.mjs')).href}?focused=${Date.now()}-${Math.random()}`);
  const menu = namespace.createFactoryMenu({
    getSnapshot: () => snapshot,
    assertMutable() { if (readOnly) throw new Error('READ_ONLY'); },
    getOperationToken: () => token,
    isOperationCurrent: candidate => candidate === token,
    reportError: error => reports.push(error),
    actions,
    tabs,
    tabRegistry,
  });
  return { menu, calls, reports, setToken: value => { token = value; }, leafListeners: () => leafListeners };
}

test('FACTORY-MENU owns seven shell tab clicks through selectTab', async () => {
  const fixture = await menuHarness();
  assert.deepEqual([...fixture.menu.capabilities], ['factory:write']);
  assert.deepEqual(Object.keys(fixture.menu.commands), ['selectTab']);
  const root = fakeRoot();
  const dispose = fixture.menu.bind(root);
  for (const id of IDS) assert.equal(root.click(id.split('/')[1]), true);
  await Promise.resolve();
  assert.deepEqual(fixture.calls, IDS);
  dispose();
  assert.equal(root.listeners.size, 0);
  assert.equal(fixture.leafListeners(), 0);
});

test('FACTORY-MENU rejects inherited commands and non-registry tab ids', async () => {
  const fixture = await menuHarness();
  assert.throws(() => fixture.menu.invoke('toString'), /undeclared command/);
  assert.throws(() => fixture.menu.invoke('selectTab', 'materials'), /unknown factory tab/i);
  assert.throws(() => fixture.menu.invoke('selectTab', 'factory/unknown'), /unknown factory tab/i);
  const root = fakeRoot();
  const dispose = fixture.menu.bind(root);
  root.click({ dataset: Object.create({ factoryAutoTab: 'db' }) });
  dispose();
  assert.deepEqual(fixture.calls, []);
});

test('FACTORY-MENU blocks read-only selection before action dispatch', async () => {
  const fixture = await menuHarness({ readOnly: true });
  assert.throws(() => fixture.menu.invoke('selectTab', 'db'), /READ_ONLY/);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.reports.length, 1);
});

test('FACTORY-MENU rejects stale async selection completion', async () => {
  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const fixture = await menuHarness({ deferred });
  const pending = fixture.menu.invoke('selectTab', 'sections');
  fixture.setToken('workspace:b:fence:2');
  resolve('foreign');
  await assert.rejects(pending, /STALE_FACTORY_MENU_OPERATION|STALE/);
  assert.deepEqual(fixture.calls, ['factory/sections']);
  assert.equal(fixture.reports.length, 1);
});

test('FACTORY-MENU leaves zero listeners and saves after 50 cycles', async () => {
  const fixture = await menuHarness();
  const root = fakeRoot();
  for (let cycle = 0; cycle < 50; cycle += 1) {
    fixture.menu.onEnter();
    const dispose = fixture.menu.bind(root);
    dispose();
    dispose();
    fixture.menu.onLeave();
    assert.equal(root.listeners.size, 0);
    assert.equal(fixture.leafListeners(), 0);
  }
  assert.deepEqual(fixture.calls, []);
});
