'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-05.js'), 'utf8');

test('resumed production-control state exposes 16 saved competitors when competitorData is null', () => {
  const start = SOURCE.indexOf('function factoryCompetitorMatchesCurrentWork(');
  const end = SOURCE.indexOf('function factoryEnsureAutomationRunScope(', start);
  assert.ok(start >= 0 && end > start, 'saved competitor fallback must be extractable');

  const workspaceId = 'batch:factory-job-88e6ba8fa26a41b0ae396d2be6cb160a';
  const scope = {
    scopeKey: 'factory_work_run_mss7zm8b_9i1ifd::방울수저집::same-input',
    currentRunId: 'factory_work_run_mss7zm8b_9i1ifd',
    productKey: '방울수저집',
    inputImageFingerprint: 'same-input',
    stageId: 'competitors',
  };
  const candidates = Array.from({ length: 16 }, (_, index) => ({
    id: `vm-candidate-${index + 1}`,
    title: `방울수저집 경쟁상품 ${index + 1}`,
    product_url: `https://example.test/products/${index + 1}`,
    _search_runtime: 'vm',
    factoryWorkKey: scope.scopeKey,
    currentRunId: scope.currentRunId,
    factoryProductKey: scope.productKey,
    inputImageFingerprint: scope.inputImageFingerprint,
    stageId: scope.stageId,
  }));
  const factory = {
    workspace: { id: workspaceId },
    product: { competitors: candidates },
  };
  const state = { currentProjectId: workspaceId, competitorData: null };
  const before = structuredClone({ factory, state });
  const context = vm.createContext({
    state,
    factoryRuntimeReadFactory: () => factory,
    compMarketCurrentWorkScope: () => scope,
    compMarketCandidateMatchesCurrentWork: (item, current) => (
      item.currentRunId === current.currentRunId
      && item.factoryProductKey === current.productKey
      && item.inputImageFingerprint === current.inputImageFingerprint
      && item.stageId === current.stageId
    ),
  });
  vm.runInContext(`${SOURCE.slice(start, end)}\nthis.matches = factoryCompetitorMatchesCurrentWork; this.read = factoryCurrentWorkCompetitors;`, context);

  assert.equal(context.read(factory).length, 16);
  assert.equal(context.matches({ ...candidates[0], workspaceId: 'batch:foreign-job' }, factory), false);
  assert.equal(context.matches({ ...candidates[0], inputImageFingerprint: 'foreign-input' }, factory), false);
  assert.deepEqual({ factory, state }, before, 'resume fallback must not decrease or rewrite A-state');
});

