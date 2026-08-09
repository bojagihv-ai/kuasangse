'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const CAFE24_SYNC = path.join(ROOT, 'src', 'cafe24-sync.js');
const FACTORY_STORE = path.join(ROOT, 'src', 'modules', 'factory-store.mjs');
const DB_TAB = path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'db-tab.mjs');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

async function importFactoryStore(label) {
  const url = pathToFileURL(FACTORY_STORE);
  url.searchParams.set(label, `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

async function createBridgeHarness() {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const policySource = sourceSlice(
    source,
    'function factoryRuntimeCreateCommandPolicies(',
    'const FACTORY_RUNTIME_COMMAND_POLICIES',
  );
  const bridgeSource = sourceSlice(
    source,
    'function factoryRuntimeBridgeAction(',
    'function factoryRuntimeWithOperationLease(',
  );
  const createPolicies = new Function(`${policySource}; return factoryRuntimeCreateCommandPolicies;`)();
  const { createFactoryStore } = await importFactoryStore('one-click-bridge');
  const commandPolicies = createPolicies();
  const store = createFactoryStore({
    workspaceId: 'project:one-click',
    revision: 0,
    commandPolicies,
    initialSnapshot: {
      factory: {
        automation: { dbSearchQuery: '' },
        goalRun: { progress: 0 },
        product: { productName: '' },
      },
    },
  });
  const storeFacade = {
    getOperationToken: () => store.getOperationToken(),
    getSnapshot: () => store.getSnapshot(),
    isOperationCurrent: token => store.isOperationCurrent(token),
    updateDraft(mutator, metadata, commandName) {
      return store.updateDraft(mutator, {
        owner: String(metadata.owner),
        expectedRevision: Number(metadata.expectedRevision),
      }, String(commandName));
    },
  };
  const ownedDrafts = [];
  const context = vm.createContext({
    FACTORY_RUNTIME_COMMAND_POLICIES: commandPolicies,
    FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA: 'factory-runtime-command-receipt:v1',
    FACTORY_RUNTIME_READ_COMMANDS: [],
    factoryRuntimeRequireStore: () => storeFacade,
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeStaleActionError(actionName) {
      return Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${actionName}`), {
        code: 'STALE_FACTORY_RUNTIME_ACTION',
      });
    },
    render() {},
    scheduleLastWorkSave() {},
    state: { step: 'factory' },
  });
  context.factoryRuntimeRenderWithOwnedDraft = (draft, execute) => {
    ownedDrafts.push(draft);
    context.factoryRuntimeOwnedRenderDraft = ownedDrafts[0];
    const release = () => {
      const index = ownedDrafts.indexOf(draft);
      if (index >= 0) ownedDrafts.splice(index, 1);
      context.factoryRuntimeOwnedRenderDraft = ownedDrafts[0] || null;
    };
    try {
      const result = execute(draft);
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(release);
      }
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  };
  vm.runInContext(`${bridgeSource}\nthis.bridge = factoryRuntimeBridgeAction;`, context);
  return {
    bridge: context.bridge,
    readOwnedDraft: () => context.factoryRuntimeOwnedRenderDraft,
    store,
  };
}

async function createCandidateQueueHarness() {
  const core03 = fs.readFileSync(CORE_03, 'utf8');
  const ownedRuntime = sourceSlice(
    core03,
    'var factoryRuntimeOwnedRenderDraft = null;',
    'function factoryRuntimeWorkspaceId(',
  );
  const leaseRuntime = sourceSlice(
    core03,
    'function factoryRuntimeWithOperationLease(',
    'function factoryRuntimeFollowupCommandReceipt(',
  );
  let activeLeaseKey = '';
  let revision = 0;
  let workspaceId = 'project:one-click';
  let fence = 1;
  let snapshot = { factory: { product: {} } };
  const commits = [];
  const timers = new Map();
  let nextTimerId = 0;

  const store = {
    assertMutable: () => true,
    getSnapshot: () => snapshot,
    getOperationToken: () => Object.freeze({
      version: 'factory-store:v1', workspaceId, fence, revision,
    }),
    isOperationCurrent: token => token?.version === 'factory-store:v1'
      && token?.workspaceId === workspaceId
      && token?.fence === fence,
    hasActiveOperationLease: operationKey => operationKey
      ? activeLeaseKey === operationKey
      : Boolean(activeLeaseKey),
    getActiveOperationLeaseKeys: () => activeLeaseKey ? [activeLeaseKey] : [],
    acquireOperationLease(operationKey, operationToken) {
      if (!this.isOperationCurrent(operationToken)) {
        throw new Error(`STALE_FACTORY_STORE_OPERATION: ${operationKey}`);
      }
      if (activeLeaseKey) return { acquired: false, signal: null, release: () => false };
      activeLeaseKey = operationKey;
      return {
        acquired: true,
        signal: null,
        release() {
          if (activeLeaseKey !== operationKey) return false;
          activeLeaseKey = '';
          return true;
        },
      };
    },
    updateDraft(mutator, metadata, commandName) {
      const startingRevision = revision;
      const draft = structuredClone(snapshot.factory);
      const value = mutator(draft);
      const commit = result => {
        if (startingRevision !== revision) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${startingRevision}, current ${revision}`);
        }
        if (metadata.expectedRevision !== revision) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${metadata.expectedRevision}, current ${revision}`);
        }
        snapshot = { factory: draft };
        revision += 1;
        commits.push(commandName);
        return { snapshot, result, assignments: [] };
      };
      return value && typeof value.then === 'function'
        ? Promise.resolve(value).then(commit)
        : commit(value);
    },
    switchWorkspace(nextWorkspaceId, value = {}) {
      workspaceId = nextWorkspaceId;
      snapshot = value.snapshot || snapshot;
      revision = Number.isInteger(value.revision) ? value.revision : 0;
      fence += 1;
      activeLeaseKey = '';
    },
  };

  const context = vm.createContext({
    clearTimeout(timerId) { timers.delete(timerId); },
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeBootstrapFactory: {},
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeStaleActionError(actionName) {
      return Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${actionName}`), {
        code: 'STALE_FACTORY_RUNTIME_ACTION',
      });
    },
    factoryRuntimeStore: store,
    render() {},
    setTimeout(callback) {
      const timerId = ++nextTimerId;
      timers.set(timerId, callback);
      return timerId;
    },
    state: { compPage: {}, currentProjectId: 'project:one-click', factory: {} },
    workspaceBlankResetInProgress: false,
  });
  vm.runInContext(
    `${ownedRuntime}\n${leaseRuntime}\nthis.runOwned = factoryRuntimeUpdateOwnedFactory;\nthis.runOwnedDuringLease = factoryRuntimeUpdateOwnedFactoryDuringLease;\nthis.runLease = factoryRuntimeWithOperationLease;\nthis.replaceFactorySnapshot = factoryRuntimeReplaceFactorySnapshot;`,
    context,
  );
  let selectionRequest = null;
  let candidateActionOperationToken = null;
  context.factoryApplyDbCandidateFromReview = index => {
    selectionRequest = context.runOwned(
      'factory/cafe24:apply-db-candidate',
      'cafe24',
      draft => {
        draft.product.selectedCandidateIndex = index;
        return true;
      },
    );
    return selectionRequest;
  };
  context.factoryApplyCafe24CandidateFromReview = () => {
    throw new Error('unexpected Cafe24 candidate path');
  };
  const moduleUrl = pathToFileURL(DB_TAB);
  moduleUrl.searchParams.set('one-click-queue', `${Date.now()}-${Math.random()}`);
  const { createDbFactoryTab } = await import(moduleUrl.href);
  let candidateClickListener = null;
  const candidateRoot = {
    addEventListener(type, listener) { if (type === 'click') candidateClickListener = listener; },
    removeEventListener(type, listener) {
      if (type === 'click' && candidateClickListener === listener) candidateClickListener = null;
    },
    contains() { return true; },
    querySelector() { return null; },
  };
  const candidateTab = createDbFactoryTab({
    getSnapshot: () => store.getSnapshot(),
    assertMutable: () => store.assertMutable(),
    getOperationToken: () => store.getOperationToken(),
    isOperationCurrent: token => store.isOperationCurrent(token),
    reportError(error) { throw error; },
    actions: {
      applyDbCandidate(value, operationContext) {
        candidateActionOperationToken = operationContext?.operationToken || null;
        return context.factoryApplyDbCandidateFromReview(value.index, operationContext);
      },
      applyCafe24Candidate(value, operationContext) {
        candidateActionOperationToken = operationContext?.operationToken || null;
        return context.factoryApplyCafe24CandidateFromReview(value.index, operationContext);
      },
    },
    renderHelpers: {},
  });
  const disposeCandidateBinding = candidateTab.bind(candidateRoot);
  return {
    commits,
    context,
    disposeCandidateBinding,
    getCandidateActionOperationToken: () => candidateActionOperationToken,
    getSelectionRequest: () => selectionRequest,
    handleCandidate(event) {
      assert.equal(typeof candidateClickListener, 'function');
      return candidateClickListener(event);
    },
    replaceFactorySnapshot: context.replaceFactorySnapshot,
    store,
  };
}

test('same-workspace branch bridge refreshes revision while preserving the outer operation identity', async () => {
  const { bridge, store } = await createBridgeHarness();
  const outerOperationToken = store.getOperationToken();
  store.update(
    factory => ({ ...factory, goalRun: { progress: 25 } }),
    { owner: 'factory', expectedRevision: outerOperationToken.revision },
  );
  assert.equal(store.isOperationCurrent(outerOperationToken), true);

  const receipt = bridge(
    'factory/start:setProductName',
    { operationToken: outerOperationToken },
    draft => {
      draft.product.productName = '방울수저집';
      return draft.product.productName;
    },
  );

  assert.equal(receipt.value, '방울수저집');
  assert.equal(receipt.operationToken.workspaceId, outerOperationToken.workspaceId);
  assert.equal(receipt.operationToken.revision, 2);
  assert.equal(store.getSnapshot().factory.goalRun.progress, 25);
  assert.equal(store.getSnapshot().factory.product.productName, '방울수저집');
});

test('candidate confirmation updates the active one-click draft without invalidating its revision', async () => {
  const { bridge, readOwnedDraft, store } = await createBridgeHarness();
  const operationToken = store.getOperationToken();
  let releaseOuter;
  const outerWait = new Promise(resolve => { releaseOuter = resolve; });
  const outer = bridge(
    'factory/start:runDb',
    { operationToken },
    async draft => {
      draft.goalRun.progress = 50;
      await outerWait;
      return true;
    },
    { render: true },
  );
  await flushMicrotasks();
  assert.equal(readOwnedDraft()?.goalRun?.progress, 50, 'the one-click draft must remain active while collection is pending');

  const candidate = await bridge(
    'factory/cafe24:apply-db-candidate',
    { operationToken },
    draft => {
      draft.product.selectedDbCandidateKey = 'db-1';
      return true;
    },
    { render: true, patchTab: 'db', forceSave: true },
  );
  const visibleSelection = readOwnedDraft()?.product?.selectedDbCandidateKey || '';
  releaseOuter();
  const outerResult = await Promise.resolve(outer).then(
    value => ({ value, error: null }),
    error => ({ value: null, error }),
  );

  assert.equal(candidate.value, true);
  assert.equal(visibleSelection, 'db-1', 'the selected state must be written to the draft currently rendered to the user');
  assert.equal(outerResult.error, null, outerResult.error?.message || 'the one-click transaction must still commit');
  assert.equal(store.getSnapshot().factory.product.selectedDbCandidateKey, 'db-1');
});

test('branch bridge still rejects the outer operation after a workspace switch', async () => {
  const { bridge, store } = await createBridgeHarness();
  const outerOperationToken = store.getOperationToken();
  store.switchWorkspace('project:other', { snapshot: store.getSnapshot(), revision: 0 });

  assert.throws(
    () => bridge('factory/start:setProductName', { operationToken: outerOperationToken }, () => true),
    /STALE_FACTORY_RUNTIME_ACTION/,
  );
  assert.equal(store.getOperationToken().workspaceId, 'project:other');
  assert.equal(store.getOperationToken().revision, 0);
});

test('VM and image-cut continuation gate accepts peer commits but rejects workspace replacement', async () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const requireCurrentSource = sourceSlice(
    source,
    'function factoryRequireCurrentRunOperation(',
    'function factoryRunOperationIsStale(',
  );
  const { createFactoryStore } = await importFactoryStore('one-click-continuation');
  const store = createFactoryStore({
    workspaceId: 'project:one-click',
    initialSnapshot: { factory: { product: {} } },
  });
  const context = vm.createContext({
    factoryRuntimeStaleActionError(actionName) {
      return Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${actionName}`), {
        code: 'STALE_FACTORY_RUNTIME_ACTION',
      });
    },
  });
  vm.runInContext(`${requireCurrentSource}\nthis.requireCurrent = factoryRequireCurrentRunOperation;`, context);
  const outerOperationToken = store.getOperationToken();
  store.update(
    factory => ({ ...factory, peerCommit: true }),
    { owner: 'factory', expectedRevision: outerOperationToken.revision },
  );

  assert.doesNotThrow(() => context.requireCurrent(
    'factory/competitor:runVmCandidatesForSelection', store, outerOperationToken, null,
  ));
  assert.doesNotThrow(() => context.requireCurrent(
    'factory/assets:generateAllCuts', store, outerOperationToken, null,
  ));

  store.switchWorkspace('project:other', { snapshot: store.getSnapshot(), revision: 0 });
  assert.throws(
    () => context.requireCurrent('factory/assets:generateAllCuts', store, outerOperationToken, null),
    /STALE_FACTORY_RUNTIME_ACTION/,
  );
});

test('browser candidate selection waits for one-click lease release and then drains once', async () => {
  const harness = await createCandidateQueueHarness();
  const operationToken = harness.store.getOperationToken();
  let releaseOuter;
  const outerGate = new Promise(resolve => { releaseOuter = resolve; });
  const outerRun = harness.context.runLease(
    'factory/runDb',
    { operationToken },
    operation => harness.store.updateDraft(
      async draft => {
        await outerGate;
        draft.product.oneClickFinished = true;
        return 'outer-done';
      },
      { owner: 'factory', expectedRevision: operation.operationToken.revision },
      'factory/start:runDb',
    ),
  );
  const button = {
    dataset: { factoryApplyDbCandidate: '0' },
    disabled: false,
    closest: () => button,
  };
  const event = {
    target: button,
    preventDefault() {},
    stopPropagation() {},
  };
  let selectionSettled = false;
  let returned;
  let preReleaseError = null;
  try {
    returned = harness.handleCandidate(event);
    await Promise.resolve();
    const selectionRequest = harness.getSelectionRequest();
    Promise.resolve(selectionRequest).then(() => { selectionSettled = true; });
    await Promise.resolve();

    assert.equal(returned, undefined, 'DOM event ownership must stay inside the modular DB tab');
    assert.equal(typeof selectionRequest?.then, 'function', 'selection must wait instead of committing inside one-click');
    assert.equal(selectionSettled, false);
    assert.deepEqual(harness.commits, []);
  } catch (error) {
    preReleaseError = error;
  } finally {
    releaseOuter();
  }

  const [outerOutcome, selectionOutcome] = await Promise.allSettled([
    outerRun,
    Promise.resolve(harness.getSelectionRequest()),
  ]);
  if (preReleaseError) throw preReleaseError;
  assert.equal(outerOutcome.status, 'fulfilled');
  assert.equal(selectionOutcome.status, 'fulfilled');
  const outerReceipt = outerOutcome.value;
  const selectionReceipt = selectionOutcome.value;
  assert.equal(outerReceipt.result, 'outer-done');
  assert.equal(selectionReceipt.result, true);
  assert.deepEqual(
    harness.getCandidateActionOperationToken(),
    operationToken,
    '후보 확정 클릭은 탭 계약이 캡처한 operation token을 액션까지 그대로 전달해야 한다',
  );
  assert.deepEqual(harness.commits, [
    'factory/start:runDb',
    'factory/cafe24:apply-db-candidate',
  ]);
  assert.equal(harness.store.getSnapshot().factory.product.oneClickFinished, true);
  assert.equal(harness.store.getSnapshot().factory.product.selectedCandidateIndex, 0);
  harness.disposeCandidateBinding();
});

test('후보 확정은 다른 실행 lease 뒤에서 한 번만 대기하고 같은 후보 중복은 즉시 거부한다', async () => {
  const harness = await createCandidateQueueHarness();
  const operationToken = harness.store.getOperationToken();
  let releaseOuter;
  const outerGate = new Promise(resolve => { releaseOuter = resolve; });
  const outerRun = harness.context.runLease(
    'factory/runDb',
    { operationToken },
    operation => harness.store.updateDraft(
      async draft => {
        await outerGate;
        draft.product.oneClickFinished = true;
        return 'outer-done';
      },
      { owner: 'factory', expectedRevision: operation.operationToken.revision },
      'factory/start:runDb',
    ),
  );
  const first = harness.context.runLease(
    'factory/cafe24:apply-db-candidate',
    { operationToken, queueWhenBusy: true },
    () => harness.context.runOwnedDuringLease(
      'factory/cafe24:apply-db-candidate',
      'cafe24',
      draft => {
        draft.product.selectedCandidateIndex = 0;
        return 'selected';
      },
    ),
  );
  const duplicate = harness.context.runLease(
    'factory/cafe24:apply-db-candidate',
    { operationToken, queueWhenBusy: true },
    () => { throw new Error('duplicate candidate confirmation must not execute'); },
  );

  await flushMicrotasks();
  assert.equal(await duplicate, false);
  assert.deepEqual(harness.commits, []);
  releaseOuter();

  const [outerResult, candidateResult] = await Promise.all([outerRun, first]);
  assert.equal(outerResult.result, 'outer-done');
  assert.equal(candidateResult.result, 'selected');
  assert.deepEqual(harness.commits, [
    'factory/start:runDb',
    'factory/cafe24:apply-db-candidate',
  ]);
  assert.equal(harness.store.getSnapshot().factory.product.selectedCandidateIndex, 0);
  harness.disposeCandidateBinding();
});

test('후보 확정의 선택·상세 저장은 하나의 lease 안에서만 통과하고 중복 확정은 시작하지 않는다', async () => {
  const harness = await createCandidateQueueHarness();
  const operationToken = harness.store.getOperationToken();
  let releaseDetail;
  const detailGate = new Promise(resolve => { releaseDetail = resolve; });
  const first = harness.context.runLease(
    'factory/cafe24:apply-db-candidate',
    { operationToken },
    async operation => {
      const selected = await harness.context.runOwnedDuringLease(
        'factory/cafe24:apply-db-candidate',
        'cafe24',
        draft => {
          draft.product.selectedCandidateIndex = 0;
          return 'selected';
        },
      );
      await detailGate;
      const detailed = await harness.context.runOwnedDuringLease(
        'factory/cafe24:apply-db-candidate',
        'cafe24',
        draft => {
          draft.product.candidateDetailLoaded = true;
          return 'detailed';
        },
      );
      return { operation, selected, detailed };
    },
  );
  await flushMicrotasks();
  const duplicate = harness.context.runLease(
    'factory/cafe24:apply-db-candidate',
    { operationToken },
    () => { throw new Error('duplicate candidate confirmation must not execute'); },
  );
  await flushMicrotasks();

  try {
    assert.equal(await duplicate, false, '같은 후보 확정은 상세 조회가 끝날 때까지 단일 실행이어야 한다');
    assert.deepEqual(harness.commits, ['factory/cafe24:apply-db-candidate']);
  } finally {
    releaseDetail();
  }

  const result = await first;
  assert.equal(result.selected.result, 'selected');
  assert.equal(result.detailed.result, 'detailed');
  assert.deepEqual(harness.commits, [
    'factory/cafe24:apply-db-candidate',
    'factory/cafe24:apply-db-candidate',
  ]);
  assert.equal(harness.store.getSnapshot().factory.product.selectedCandidateIndex, 0);
  assert.equal(harness.store.getSnapshot().factory.product.candidateDetailLoaded, true);
  harness.disposeCandidateBinding();
});

test('실제 DB·Cafe24 후보 확정 함수는 선택부터 상세 반영까지 후보 전용 lease를 유지한다', () => {
  const source = fs.readFileSync(CAFE24_SYNC, 'utf8');
  const dbSource = sourceSlice(
    source,
    'async function factoryApplyDbCandidateFromReview(',
    'function factoryApplyCafe24CandidateSelectionFromReview(',
  );
  const cafeSource = sourceSlice(
    source,
    'async function factoryApplyCafe24CandidateFromReview(',
    'function factoryConfirmNoDbCandidate',
  );
  for (const [label, candidateSource, key] of [
    ['DB', dbSource, 'factory/cafe24:apply-db-candidate'],
    ['Cafe24', cafeSource, 'factory/cafe24:apply-cafe24-candidate'],
  ]) {
    assert.match(candidateSource, new RegExp(`factoryRuntimeWithOperationLease\\(\\s*['\"]${key}['\"]`), `${label} 후보 확정 lease가 없습니다`);
    assert.match(candidateSource, /operationLeaseHeld:\s*true/, `${label} 후보 확정이 lease 소유 상태를 전달하지 않습니다`);
    assert.match(candidateSource, /factoryRuntimeUpdateOwnedFactoryDuringLease/, `${label} 후보 확정의 내부 저장이 lease 안에서 실행되지 않습니다`);
  }
});

test('late session hydration cannot replace the active one-click operation snapshot', async () => {
  const harness = await createCandidateQueueHarness();
  const seedToken = harness.store.getOperationToken();
  harness.store.updateDraft(
    draft => {
      draft.goalRun = { running: true, progress: 84, currentStage: 'DB/VM/이미지 작업 응답 대기 중' };
      return true;
    },
    { owner: 'factory', expectedRevision: seedToken.revision },
    'factory/test:seed-active-run',
  );
  const operationToken = harness.store.getOperationToken();
  const lease = harness.store.acquireOperationLease('factory/runDb', operationToken);
  assert.equal(lease.acquired, true);

  harness.replaceFactorySnapshot(
    { product: {}, goalRun: { running: false, progress: 100, currentStage: '이전 실행 확인 필요' } },
    {
      mode: 'hydrate',
      normalized: true,
      reason: 'session-assets-payload',
      workspaceId: operationToken.workspaceId,
    },
  );

  assert.equal(harness.store.hasActiveOperationLease('factory/runDb'), true);
  assert.equal(harness.store.getOperationToken().fence, operationToken.fence);
  assert.deepEqual(
    harness.store.getSnapshot().factory.goalRun,
    { running: true, progress: 84, currentStage: 'DB/VM/이미지 작업 응답 대기 중' },
  );
  lease.release();
  harness.disposeCandidateBinding();
});

test('background restore and cleanup commands cannot commit over an active one-click operation', async () => {
  const harness = await createCandidateQueueHarness();
  const operationToken = harness.store.getOperationToken();
  const lease = harness.store.acquireOperationLease('factory/runDb', operationToken);
  assert.equal(lease.acquired, true);
  const commands = [
    'factory/runtime:refreshLocalArchiveAssets',
    'factory/runtime:restoreLocalArchiveToCurrentWork',
    'factory/assets:clearRestoredImageGenerationRuntime',
    'factory/db:clearRestoredCandidateRuntime',
  ];

  commands.forEach(commandName => {
    const receipt = harness.context.runOwned(
      commandName,
      'factory-assets',
      draft => {
        draft.product.backgroundRestoreMutation = commandName;
        return true;
      },
    );
    assert.equal(receipt.result, false, `${commandName} must be ignored until one-click releases`);
  });

  assert.equal(harness.store.getSnapshot().factory.product.backgroundRestoreMutation, undefined);
  assert.deepEqual(harness.commits, []);
  lease.release();
  harness.disposeCandidateBinding();
});
