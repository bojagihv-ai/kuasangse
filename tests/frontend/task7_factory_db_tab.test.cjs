'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const target = path.join(ROOT, 'src/menus/factory/tabs/db-tab.mjs');

async function load() {
  return import(`${pathToFileURL(target).href}?db-test=${Date.now()}-${Math.random()}`);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function harness({ readOnly = false, pending = false } = {}) {
  const snapshot = freeze({
    factory: { automation: { activeTab: 'db', dbSearchQuery: '보자기' }, product: { productName: '보자기' }, stages: {}, assets: [], logs: [] },
    productDb: {}, competitors: {}, factoryAssets: {}, detailDocument: {}, cafe24: {},
  });
  let token = 'workspace-a:1';
  let resolve;
  const deferred = new Promise(done => { resolve = done; });
  const calls = [];
  const actions = new Proxy(Object.create(null), {
    get(_target, name) {
      if (name === 'then') return undefined;
      return (...args) => { calls.push({ name: String(name), args }); return pending ? deferred : Promise.resolve(args); };
    },
  });
  const renderHelpers = {
    escapeHtml: value => String(value ?? ''),
    escAttr: value => String(value ?? ''),
    factoryAutomationCounts: () => ({ dbCandidates: 1, cafe24Candidates: 2 }),
    factoryAutomationWizardTasks: () => [],
    renderFactoryAutomationTaskChecklist: () => '<div data-checklist="db"></div>',
    renderFactoryCandidateReviewPanels: () => '<div data-candidates="db"></div>',
  };
  const capabilities = {
    getSnapshot: () => snapshot,
    assertMutable: () => { calls.push({ name: 'assertMutable' }); if (readOnly) throw new Error('READ_ONLY'); },
    getOperationToken: () => token,
    isOperationCurrent: candidate => candidate === token,
    reportError: error => calls.push({ name: 'reportError', error }),
    actions,
    renderHelpers,
  };
  return { snapshot, calls, capabilities, changeToken(value) { token = value; }, resolve, deferred };
}

function fakeRoot() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    contains() { return true; },
    querySelector() { return { value: '  재검색어  ' }; },
  };
}

test('FACTORY-DB: identity, immutable select, faithful DB render, and delegated cleanup', async () => {
  const { createDbFactoryTab } = await load();
  const h = harness();
  const tab = createDbFactoryTab(h.capabilities);
  assert.equal(tab.id, 'factory/db');
  assert.equal(tab.owner, 'product-db');
  assert.strictEqual(tab.select({ forbiddenRawRoot: true }), h.snapshot);
  const html = tab.render(h.snapshot);
  assert.match(html, /2\. DB 확정/);
  assert.match(html, /data-factory-db-search-query/);
  assert.match(html, /rerun-db-query/);
  const root = fakeRoot();
  for (let cycle = 0; cycle < 50; cycle += 1) {
    tab.onEnter();
    const dispose = tab.bind(root);
    dispose();
    dispose();
    tab.onLeave();
    assert.equal(root.listeners.size, 0);
  }
});

test('FACTORY-DB: read-only mutation is blocked and stale guide completion is rejected', async () => {
  const { createDbFactoryTab } = await load();
  const readOnly = harness({ readOnly: true });
  const blocked = createDbFactoryTab(readOnly.capabilities);
  assert.throws(() => blocked.invoke('run-db'), /READ_ONLY/);
  assert.equal(readOnly.calls.some(call => call.name === 'run-db'), false);

  const stale = harness({ pending: true });
  const tab = createDbFactoryTab(stale.capabilities);
  const pending = tab.invoke('rerun-db-query', '새 검색어');
  stale.changeToken('workspace-b:2');
  stale.resolve({ ok: true });
  await assert.rejects(pending, /STALE_FACTORY_TAB_OPERATION|STALE/i);
  assert.ok(stale.calls.some(call => call.name === 'rerunDbQuery' || call.name === 'rerun-db-query'));
});
