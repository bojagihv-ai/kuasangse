'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('DB candidate network work finishes before the short store commit revokes its draft', async () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const start = source.indexOf('async function factoryRunDbCandidatesForSelection(');
  const end = source.indexOf('\nfunction factoryBeginCandidateProgramStart(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const functionSource = source.slice(start, end);
  assert.match(functionSource, /await saveLastWorkNow\(\{ sync: false \}\)/);

  let snapshot = {
    automation: {},
    goalRun: {},
    logs: [],
    logStageId: '',
    activeStage: 'db',
    uiPanels: {},
    product: {
      candidateAutoApply: false,
      pendingDbCandidates: [],
      pendingCafe24Candidates: [],
    },
    stages: { db: {} },
    assets: [],
    previousAssets: [],
    detailPlacement: {},
    archive: {},
    assetListExpanded: {},
    previousAssetsExpanded: {},
    runtimeAssetPrunedAt: 0,
    runtimeAssetPrunedCount: 0,
  };
  let revision = 4;
  const operationToken = () => ({ workspaceId: 'workspace-a', revision });
  let asyncDraftObserved = false;

  const context = vm.createContext({
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => operationToken(),
      getSnapshot: () => ({ factory: snapshot }),
      isOperationCurrent: token => token.workspaceId === 'workspace-a' && token.revision === revision,
    }),
    factoryRuntimeStaleActionError: action => new Error(`stale: ${action}`),
    factoryRuntimeDetachedValue: clone,
    factoryRuntimeUpdateOwnedFactory: (_command, _owner, mutator) => {
      const transaction = Proxy.revocable(clone(snapshot), {});
      const value = mutator(transaction.proxy);
      if (value && typeof value.then === 'function') {
        asyncDraftObserved = true;
        queueMicrotask(() => transaction.revoke());
        return Promise.resolve(value).then(result => {
          snapshot = clone(transaction.proxy);
          transaction.revoke();
          return { result, snapshot: { factory: snapshot }, assignments: [] };
        });
      }
      snapshot = clone(transaction.proxy);
      transaction.revoke();
      revision += 1;
      return { result: value, snapshot: { factory: snapshot }, assignments: [] };
    },
    factoryUpdateFromInputs() {},
    factorySetStageStatus(_stageId, status, message, factory) {
      factory.stages.db = { status, message };
    },
    factoryReportCandidateParallelProgress() {},
    factoryCandidateCollectionScope: factory => ({
      currentRunId: 'run-1',
      productKey: factory.product.productKey || 'product-1',
      inputImageFingerprint: 'image-1',
      stageId: 'db',
    }),
    factoryCandidateCollectionScopeMatches: (expected, factory) =>
      expected.productKey === (factory.product.productKey || 'product-1'),
    factoryRunDbStage: async ({ factory }) => {
      await Promise.resolve();
      revision += 3;
      factory.product.pendingDbCandidates = [{ jcode: 'db-1' }];
      factory.product.pendingCafe24Candidates = Array.from(
        { length: 5 },
        (_, index) => ({ product_no: index + 1 }),
      );
      return true;
    },
    factoryLog() {},
    saveLastWorkNow() {},
    render() {},
  });
  vm.runInContext(
    `${functionSource}\nthis.runCandidates = factoryRunDbCandidatesForSelection;`,
    context,
  );

  const result = await context.runCandidates({ operationToken: operationToken() });

  assert.equal(result.ok, true);
  assert.equal(asyncDraftObserved, false, 'network work must not run inside a revocable store draft');
  assert.equal(snapshot.product.pendingDbCandidates.length, 1);
  assert.equal(snapshot.product.pendingCafe24Candidates.length, 5);
});
