const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function snapshot() {
  return deepFreeze({
    factory: {
      automation: { activeTab: 'publish' },
      openMarketSync: { selectedChannels: ['naver'] },
      product: {},
    },
    detailDocument: { sectionContents: { hero: '<safe>' }, sectionImages: {} },
    cafe24: {},
  });
}

function harness({ readOnly = false, deferred = null, detailModel = null } = {}) {
  const calls = [];
  const currentSnapshot = snapshot();
  let token = 'workspace:a:fence:1';
  const actions = {
    runGuideAction(action) {
      calls.push(['guide', action]);
      return deferred?.promise || Promise.resolve(action);
    },
  };
  const helpers = {
    escapeHtml(value) { return String(value ?? '').replaceAll('<', '&lt;'); },
    disabledAttr(disabled) { return disabled ? 'disabled' : ''; },
    factoryAutomationCounts() { return { detailAssets: 1, generatedSections: 1, totalSections: 1, cafe24Selected: true }; },
    factoryAutomationWizardTasks() { return []; },
    orderedSections() { return [{ id: 'hero' }]; },
    factoryFinalRegistrationSettings() { return { targetLabel: '카페24만 등록', displayLabel: '진열함', sellingLabel: '판매함' }; },
    factoryFinalRegistrationCafe24Model() { return { canRun: true, label: '실행 가능' }; },
    factoryRenderCacheFinalDetailModel() { return detailModel || { canProceed: true, ok: true, label: '1/1개 섹션 생성', reason: '' }; },
    renderFactoryAutomationStatusCard(label, value) { return `<div>${label}:${value}</div>`; },
    renderFactoryAutomationTaskChecklist() { return ''; },
    renderFactoryFinalRegistrationPanel() { return '<div id="factoryFinalRegistrationPanel">주입 패널</div>'; },
  };
  return {
    snapshot: currentSnapshot,
    calls,
    setToken(value) { token = value; },
    capabilities: {
      getSnapshot: () => currentSnapshot,
      assertMutable() { calls.push(['authority']); if (readOnly) throw new Error('READ_ONLY'); },
      getOperationToken: () => token,
      isOperationCurrent: candidate => candidate === token,
      reportError: error => calls.push(['error', error]),
      actions,
      renderHelpers: helpers,
    },
  };
}

async function load() {
  const target = path.join(ROOT, 'src/menus/factory/tabs/publish-tab.mjs');
  return import(`${pathToFileURL(target).href}?publish=${Date.now()}-${Math.random()}`);
}

function fakeRoot() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    contains() { return true; },
  };
}

test('FACTORY-PUBLISH renders legacy selectors and injected final panel', async () => {
  const namespace = await load();
  const fixture = harness();
  const tab = namespace.createPublishFactoryTab(fixture.capabilities);
  assert.deepEqual(Object.keys(namespace), ['createPublishFactoryTab']);
  assert.equal(tab.version, 'factory-tab:v1');
  assert.equal(tab.id, 'factory/publish');
  assert.equal(tab.owner, 'cafe24');
  assert.strictEqual(tab.select({ forbidden: true }), fixture.snapshot);
  const html = tab.render(fixture.snapshot);
  for (const selector of [
    '7. 전송',
    'data-factory-guide-action="run-final-registration"',
    'Cafe24 최종 등록',
    'data-factory-guide-action="focus-stage-log"',
    'data-factory-guide-action="focus-materials"',
    'id="factoryPublishInlineFinalPanel"',
    'id="factoryFinalRegistrationPanel"',
  ]) assert.match(html, new RegExp(selector));
  assert.doesNotMatch(html, /<safe>/);
  assert.doesNotMatch(html, /data-factory-guide-action="run-final-registration" disabled/);
});

test('FACTORY-PUBLISH shares the final detail safety gate with Cafe24 final registration', async () => {
  const fixture = harness({
    detailModel: {
      canProceed: false,
      ok: false,
      label: '15/15개 섹션 생성',
      reason: '상세페이지 HTML에 작업용 라벨이 남아 있어 전송할 수 없습니다.',
    },
  });
  const tab = (await load()).createPublishFactoryTab(fixture.capabilities);
  const html = tab.render(fixture.snapshot);

  assert.match(html, /확인 필요 · 상세페이지 조각/);
  assert.match(html, /상세페이지 HTML에 작업용 라벨이 남아 있어 전송할 수 없습니다/);
  assert.match(html, /data-factory-guide-action="run-final-registration" disabled[^>]*>Cafe24 최종 등록/);
  assert.doesNotMatch(html, /최종 등록 설정으로 이동/);
});

test('FACTORY-PUBLISH delegates guide clicks and cleans up idempotently', async () => {
  const fixture = harness();
  const tab = (await load()).createPublishFactoryTab(fixture.capabilities);
  const root = fakeRoot();
  const dispose = tab.bind(root);
  const target = {
    dataset: { factoryGuideAction: 'focus-final-registration' },
    disabled: false,
    closest() { return this; },
  };
  root.listeners.get('click')({ target, preventDefault() {}, stopPropagation() {} });
  await Promise.resolve();
  assert.deepEqual(fixture.calls.slice(0, 2).map(call => call[0]), ['authority', 'guide']);
  assert.equal(fixture.calls[1][1], 'focus-final-registration');
  dispose();
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('FACTORY-PUBLISH authority blocks guide command before action', async () => {
  const fixture = harness({ readOnly: true });
  const tab = (await load()).createPublishFactoryTab(fixture.capabilities);
  assert.throws(() => tab.invoke('guideAction', 'focus-materials'), /READ_ONLY/);
  assert.equal(fixture.calls.some(call => call[0] === 'guide'), false);
});

test('FACTORY-PUBLISH rejects stale async guide completion', async () => {
  let resolve;
  const deferred = { promise: new Promise(done => { resolve = done; }) };
  const fixture = harness({ deferred });
  const tab = (await load()).createPublishFactoryTab(fixture.capabilities);
  const pending = tab.invoke('guideAction', 'focus-stage-log');
  fixture.setToken('workspace:b:fence:2');
  resolve('foreign');
  await assert.rejects(pending, /STALE_FACTORY_TAB_OPERATION|STALE/);
});

test('FACTORY-PUBLISH forwards a versioned batch command payload intact to the registered guide action', async () => {
  const fixture = harness();
  const tab = (await load()).createPublishFactoryTab(fixture.capabilities);
  const command = Object.freeze({
    action: 'run-batch-cafe24-registration',
    batchControl: Object.freeze({ productId: 'cafe24:2994', payloadDigest: 'approved' }),
  });

  await tab.invoke('runGuideAction', command);

  assert.strictEqual(fixture.calls.find(call => call[0] === 'guide')[1], command);
});

test('FACTORY-PUBLISH lifecycle cycles leave no listeners or actions', async () => {
  const fixture = harness();
  const tab = (await load()).createPublishFactoryTab(fixture.capabilities);
  const root = fakeRoot();
  for (let cycle = 0; cycle < 50; cycle += 1) {
    tab.onEnter();
    const dispose = tab.bind(root);
    dispose();
    dispose();
    tab.onLeave();
    assert.equal(root.listeners.size, 0);
  }
  assert.equal(fixture.calls.some(call => call[0] === 'guide'), false);
});
