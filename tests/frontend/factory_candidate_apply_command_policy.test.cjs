'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function runtimePolicies() {
  const core = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  const createPolicies = new Function(
    `${sourceSlice(core, 'function factoryRuntimeCreateCommandPolicies()', 'const FACTORY_RUNTIME_COMMAND_POLICIES =')}\nreturn factoryRuntimeCreateCommandPolicies;`,
  )();
  return createPolicies();
}

function competitorGuideAction(globals = {}) {
  const core = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  const context = vm.createContext({ ...globals });
  const actionSource = sourceSlice(
    core,
    'function factoryRuntimeCompetitorGuideAction(',
    'function factoryRuntimeCompetitorMarketAction(',
  );
  vm.runInContext(`${actionSource}
globalThis.runCompetitorGuideAction = factoryRuntimeCompetitorGuideAction;`, context);
  return context.runCompetitorGuideAction;
}

async function storeData() {
  const url = pathToFileURL(path.join(ROOT, 'src/modules/factory-store-data.mjs'));
  url.searchParams.set('candidate-apply-command-policy', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test('candidate apply commands own their option and size-review automation mutations', async () => {
  // Given: both candidate commands run option inference and size-review scheduling
  // inside their single store transaction.
  const { normalizeCommandPolicies, validateCommandDiff } = await storeData();
  const policies = normalizeCommandPolicies(runtimePolicies());
  const before = {
    automation: {
      fieldReview: { width_mm: { value: '48mm' } },
      lastAutoSizeRunKey: 'previous-size-run',
      optionMode: 'pending',
      optionSourceSummary: { count: 0 },
      sizeAutoRunRunning: true,
      sizeAutofillNotice: 'previous notice',
      sizeImageDbConfirmedKey: 'previous-confirmation',
    },
  };
  const after = {
    automation: {
      fieldReview: {},
      lastAutoSizeRunKey: '',
      optionMode: 'provided',
      optionSourceSummary: { count: 1 },
      sizeAutoRunRunning: false,
      sizeAutofillNotice: 'selected product dimensions applied',
      sizeImageDbConfirmedKey: '',
    },
  };
  const expectedAssignments = [
    ['automation.fieldReview.width_mm', 'product-db'],
    ['automation.lastAutoSizeRunKey', 'factory-assets'],
    ['automation.optionMode', 'factory-assets'],
    ['automation.optionSourceSummary.count', 'factory-assets'],
    ['automation.sizeAutoRunRunning', 'factory-assets'],
    ['automation.sizeAutofillNotice', 'factory-assets'],
    ['automation.sizeImageDbConfirmedKey', 'factory-assets'],
  ];

  for (const command of [
    'factory/cafe24:apply-db-candidate',
    'factory/cafe24:apply-cafe24-candidate',
    'factory/cafe24:refresh-selected-cafe24-candidate',
  ]) {
    // When: the command validator checks the exact automation diff.
    const assignments = validateCommandDiff(policies.get(command), before, after);

    // Then: only the candidate workflow's factory-assets paths are accepted.
    assert.deepEqual(
      assignments.map(({ changedPath, owner }) => ({ changedPath, owner })),
      expectedAssignments.map(([changedPath, owner]) => ({ changedPath, owner })),
    );
  }
});

test('candidate apply commands still reject unrelated automation mutations', async () => {
  // Given: an apply command attempts an unrelated factory automation write.
  const { normalizeCommandPolicies, validateCommandDiff } = await storeData();
  const policy = normalizeCommandPolicies(runtimePolicies())
    .get('factory/cafe24:apply-cafe24-candidate');

  // When / Then: the command boundary remains fail-closed.
  assert.throws(
    () => validateCommandDiff(policy, { automation: { activeTab: 'db' } }, { automation: { activeTab: 'publish' } }),
    /FACTORY_COMMAND_PATH_REJECTED:.*automation\.activeTab/,
  );
});

test('candidate no-result and clear commands own every state path they mutate', async () => {
  const { normalizeCommandPolicies, validateCommandDiff } = await storeData();
  const policies = normalizeCommandPolicies(runtimePolicies());
  const before = {
    product: {
      selectedDbCandidateKey: 'PTR-DB-159',
      dbCandidateResolution: 'selected',
    },
    automation: {
      optionMode: 'provided',
      optionSourceSummary: { count: 1, updatedAt: 1 },
    },
    stages: { db: { status: 'done', updatedAt: 1 } },
    logs: [],
    logStageId: '',
    activeStage: '',
  };
  const after = {
    product: {
      selectedDbCandidateKey: '',
      dbCandidateResolution: 'none',
    },
    automation: {
      optionMode: 'none',
      optionSourceSummary: { count: 0, updatedAt: 2 },
    },
    stages: { db: { status: 'done', updatedAt: 2 } },
    logs: [{ message: 'candidate resolution changed' }],
    logStageId: 'db',
    activeStage: 'db',
  };

  for (const command of [
    'factory/db:confirmNoDbCandidate',
    'factory/db:confirmNoCafe24Candidate',
    'factory/db:clearDbCandidateSelection',
    'factory/db:clearCafe24CandidateSelection',
  ]) {
    const assignments = validateCommandDiff(policies.get(command), before, after);
    const byPath = new Map(assignments.map(item => [item.changedPath, item.owner]));
    assert.equal(byPath.get('product.selectedDbCandidateKey'), 'product-db');
    assert.equal(byPath.get('automation.optionMode'), 'factory-assets');
    assert.equal(byPath.get('automation.optionSourceSummary.updatedAt'), 'factory-assets');
    assert.equal(byPath.get('stages.db.updatedAt'), 'factory-assets');
    assert.equal(byPath.get('logs'), 'factory');
    assert.equal(byPath.get('logStageId'), 'factory');
    assert.equal(byPath.get('activeStage'), 'factory');
  }
});

test('factory DB tab candidate actions request the committed runtime receipt', () => {
  const core = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  const dbActions = sourceSlice(
    core,
    'function factoryRuntimeDbActions()',
    '\nfunction factoryRuntimeDbHelpers()',
  );

  for (const action of ['applyDbCandidate', 'applyCafe24Candidate']) {
    const start = dbActions.indexOf(`${action}(value = {}, operationContext)`);
    assert.notEqual(start, -1, `missing ${action}`);
    const next = dbActions.indexOf('\n    },', start);
    assert.notEqual(next, -1, `missing ${action} end`);
    assert.match(
      dbActions.slice(start, next),
      /returnReceipt:\s*true/,
      `${action} must preserve the post-commit operation token for the tab contract`,
    );
  }
});

test('workspace identity reset owns only the immutable identity and workspace header', async () => {
  const { normalizeCommandPolicies, validateCommandDiff } = await storeData();
  const policy = normalizeCommandPolicies(runtimePolicies())
    .get('factory/runtime:updateWorkspaceIdentity');
  const before = {
    workIdentity: { instanceId: 'work:a' },
    workspace: { id: 'project:a', name: 'A' },
    currentProjectId: 'project:a',
    currentProjectName: 'A',
    product: { productName: 'A' },
  };
  const after = {
    ...before,
    workIdentity: null,
    workspace: { id: '', name: 'A copy' },
    currentProjectId: '',
    currentProjectName: 'A copy',
  };

  assert.deepEqual(
    validateCommandDiff(policy, before, after)
      .map(({ changedPath, owner }) => ({ changedPath, owner }))
      .sort((left, right) => left.changedPath.localeCompare(right.changedPath)),
    [
      { changedPath: 'currentProjectId', owner: 'factory' },
      { changedPath: 'currentProjectName', owner: 'factory' },
      { changedPath: 'workIdentity', owner: 'factory' },
      { changedPath: 'workspace.id', owner: 'factory' },
      { changedPath: 'workspace.name', owner: 'factory' },
    ],
  );
  assert.throws(
    () => validateCommandDiff(policy, before, { ...after, product: { productName: 'B' } }),
    /FACTORY_COMMAND_PATH_REJECTED:.*product\.productName/,
  );
});

test('explicit product and base-image replacement may rotate only their work identity boundary', async () => {
  const { normalizeCommandPolicies, validateCommandDiff } = await storeData();
  const policies = normalizeCommandPolicies(runtimePolicies());
  const before = {
    workIdentity: { instanceId: 'work:before' },
    automation: { dbSearchQuery: '이전상품' },
    product: { productName: '이전상품', imageBase64: 'old-image' },
  };

  const renamed = {
    ...before,
    workIdentity: null,
    automation: {
      ...before.automation,
      dbSearchQuery: '새상품',
      workIdentityTransition: { reason: 'explicit-product-replacement', at: 100 },
    },
    product: { ...before.product, productName: '새상품' },
  };
  assert.doesNotThrow(() => validateCommandDiff(
    policies.get('factory/start:setProductName'),
    before,
    renamed,
  ));

  const reimaged = {
    ...before,
    workIdentity: null,
    automation: {
      ...before.automation,
      workIdentityTransition: { reason: 'explicit-base-image-replacement', at: 101 },
    },
    product: { ...before.product, imageBase64: 'new-image' },
  };
  assert.doesNotThrow(() => validateCommandDiff(
    policies.get('factory/start:setProductImage'),
    before,
    reimaged,
  ));
});

test('competitor panel toggle stays inside its command transaction without broad persistence writes', () => {
  const draft = { automation: { competitorPanelOpen: false } };
  let broadSaveCalls = 0;
  const runAction = competitorGuideAction({
    factoryRuntimeBridgeAction(_command, _operationContext, execute) {
      return execute(draft);
    },
    saveLastWorkNow() {
      broadSaveCalls += 1;
      draft.lastSavedAt = Date.now();
    },
  });

  const result = runAction('toggle-competitor-panel');

  assert.equal(result, true);
  assert.equal(draft.automation.competitorPanelOpen, true);
  assert.equal(broadSaveCalls, 0);
  assert.equal(Object.hasOwn(draft, 'lastSavedAt'), false);
});

test('VM 후보 재수집은 현재 작업 lease를 먼저 확보한 뒤 네트워크 작업을 follow-up으로 실행한다', async () => {
  const calls = [];
  const receipt = Object.freeze({
    schema: 'factory-runtime-command-receipt:v1',
    operationToken: Object.freeze({ workspaceId: 'draft:test', revision: 3 }),
    value: true,
    assignments: Object.freeze([]),
  });
  const runAction = competitorGuideAction({
    FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA: 'factory-runtime-command-receipt:v1',
    factoryRuntimeWithOperationLease(command, operationContext, execute) {
      calls.push(['lease', command, operationContext?.operationToken]);
      assert.equal(command, 'factory/competitor:guide:rerun-vm-competitors');
      assert.strictEqual(operationContext?.operationToken, receipt.operationToken);
      return execute({
        operationToken: receipt.operationToken,
        operationSignal: { aborted: false },
      });
    },
    async factoryRunVmCompetitorCollectionForSelection(options) {
      calls.push(['vm', options.operationToken]);
      assert.equal(Object.hasOwn(options, 'factory'), false, '네트워크 작업에 transaction draft를 넘기면 안 됩니다.');
      assert.equal(options.forceCollect, true);
      assert.equal(options.operationSignal?.aborted, false);
      return { ok: true, count: 4 };
    },
    factoryRuntimeFollowupCommandReceipt(initialReceipt, result) {
      calls.push(['followup', result.count]);
      return { ...initialReceipt, value: result };
    },
  });

  const result = await runAction('rerun-vm-competitors', { operationToken: receipt.operationToken });

  assert.deepEqual(calls.map(call => call[0]), ['lease', 'vm', 'followup']);
  assert.deepEqual(result.value, { ok: true, count: 4 });
});
