const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = require('node:path').resolve(__dirname, '../..');

async function load() {
  return import(`${pathToFileURL(`${ROOT}/src/menus/factory/tabs/fields-tab.mjs`).href}?fields=${Date.now()}-${Math.random()}`);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function harness({ readOnly = false, deferred = null } = {}) {
  const snapshot = freeze({
    factory: {
      automation: { activeTab: 'fields', optionMode: 'none' },
      product: {},
    },
    productDb: {},
  });
  const calls = [];
  const listeners = new Map();
  let token = 'workspace:a:fence:1';
  const actions = {
    setFieldDraft(value) { calls.push(['draft', value]); return { ok: true }; },
    commitField(value) { calls.push(['commit', value]); return { ok: true }; },
    commitAllFields(value) { calls.push(['commit-all', value]); return { ok: true }; },
    editField(value) { calls.push(['edit', value]); return { ok: true }; },
    setFieldTransferSelection(value) { calls.push(['select', value]); return { ok: true }; },
    executeSelectedFieldTransfer(value) { calls.push(['transfer', value]); return deferred?.promise || { ok: true }; },
    runGuideAction(value) { calls.push(['guide', value]); return { ok: true }; },
    addOptionColorImageFiles(value) { calls.push(['upload', value]); return { ok: true }; },
  };
  const renderHelpers = {
    escapeHtml: value => String(value ?? ''),
    escAttr: value => String(value ?? ''),
    disabledAttr: disabled => disabled ? 'disabled' : '',
    factoryAutomationCounts: () => ({ sizeSelected: 0, sizeAssets: 0, optionAssets: 1 }),
    factoryAutomationReviewSummary: () => ({
      fields: [{ id: 'width_mm', label: '가로', group: '상품등록 필수', required: true, status: 'done', value: '100mm' }],
      missingRegister: [], missingGenerate: [], autoDone: [], sizeReady: true,
    }),
    factoryFieldTransferRows: () => [{ id: 'width_mm', label: '가로', value: '100mm', sinhwa: true, cafe24: false }],
    factoryFieldTransferState: () => ({ selectedFieldIds: [], status: 'idle', target: '', message: '' }),
    factorySinhwaSelectedTransferTarget: () => ({ jcode: 'J1', name: '상품' }),
    factoryCafe24SelectedTransferTarget: () => null,
    factoryBojagiSquareSizeOptionSuggestion: () => null,
    factoryAutomationStatusTone: () => ({ label: '완료', color: 'var(--ok)', border: 'var(--border)', bg: 'transparent', icon: 'check_circle' }),
    renderFactoryAutomationStatusCard: (label, value) => `<div>${label}:${value}</div>`,
    renderFactoryAutomationTaskChecklist: () => '',
  };
  return {
    snapshot,
    calls,
    setToken(value) { token = value; },
    capabilities: {
      getSnapshot: () => snapshot,
      assertMutable() { if (readOnly) throw new Error('READ_ONLY'); },
      getOperationToken: () => token,
      isOperationCurrent: value => value === token,
      reportError(error) { calls.push(['error', error]); },
      actions,
      renderHelpers,
    },
    root: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      listeners,
    },
  };
}

test('fields tab renders the original field/transfer selectors from an immutable snapshot', async () => {
  const namespace = await load();
  assert.deepEqual(Object.keys(namespace), ['createFieldsFactoryTab']);
  const fixture = harness();
  const tab = namespace.createFieldsFactoryTab(fixture.capabilities);
  assert.strictEqual(tab.select({ forbiddenRawRoot: true }), fixture.snapshot);
  const html = tab.render(fixture.snapshot);
  assert.match(html, /data-factory-wizard-field/);
  assert.match(html, /data-factory-wizard-commit/);
  assert.match(html, /data-factory-field-transfer-panel/);
  assert.match(html, /data-factory-field-transfer-target="sinhwa"/);
  assert.match(html, /data-factory-option-color-upload/);
  assert.match(html, /focus-missing-field-source/);
});

test('fields tab root delegation installs and removes listeners idempotently', async () => {
  const namespace = await load();
  const fixture = harness();
  const tab = namespace.createFieldsFactoryTab(fixture.capabilities);
  const dispose = tab.bind(fixture.root);
  assert.deepEqual([...fixture.root.listeners.keys()].sort(), ['blur', 'change', 'click', 'input']);
  dispose();
  dispose();
  assert.equal(fixture.root.listeners.size, 0);
});

test('fields tab write command is rejected by read-only authority before action', async () => {
  const namespace = await load();
  const fixture = harness({ readOnly: true });
  const tab = namespace.createFieldsFactoryTab(fixture.capabilities);
  assert.throws(() => tab.invoke('commitField', { fieldId: 'width_mm', value: '100' }), /READ_ONLY/);
  assert.equal(fixture.calls.some(call => call[0] === 'commit'), false);
});

test('fields tab transfer completion is rejected after workspace fence changes', async () => {
  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const namespace = await load();
  const fixture = harness({ deferred });
  const tab = namespace.createFieldsFactoryTab(fixture.capabilities);
  const pending = tab.invoke('transferFields', { target: 'sinhwa' });
  fixture.setToken('workspace:b:fence:2');
  resolve({ ok: true });
  await assert.rejects(pending, /STALE/);
});
