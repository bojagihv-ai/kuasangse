const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('restored candidate runtime clears only dead progress and preserves results', () => {
  const core = source(CORE_06);
  const functionSource = sourceSlice(
    core,
    'function factoryClearRestoredCandidateRuntimeOwned(',
    '\nasync function factoryRunDbCandidatesForSelection(',
  );
  const context = vm.createContext({ Date });
  vm.runInContext(
    `${functionSource}\nthis.clearRestoredCandidateRuntime = factoryClearRestoredCandidateRuntimeOwned;`,
    context,
  );

  const factory = {
    automation: {
      candidateSearchProgress: {
        running: true,
        kind: 'start-sinhwa-db',
        message: '신화사DB 프로그램 실행 중',
        updatedAt: 10,
      },
      parallelProgress: {
        sinhwa: { status: 'running', progress: 45, message: '수집 중' },
        cafe24: { status: 'running', progress: 10, message: '연결 확인 중' },
        vm: { status: 'done', progress: 100, message: '후보 13건' },
      },
    },
    product: {
      sinhwaDbProgramStatus: { state: 'starting', starting: true },
      cafe24ProgramStatus: { state: 'starting', starting: true },
      candidateReviewStatus: '신화사DB/Cafe24 후보를 수집하고 있습니다.',
      pendingDbCandidates: [{ id: 'db-1' }],
      pendingCafe24Candidates: [{ id: 'cafe24-1' }],
    },
    stages: {
      db: { status: 'running', message: '후보 수집 중' },
    },
    assets: [{ id: 'hero-1', stageId: 'hero' }],
  };

  assert.equal(context.clearRestoredCandidateRuntime(factory, { log: false }), true);
  assert.equal(factory.automation.candidateSearchProgress.running, false);
  assert.match(factory.automation.candidateSearchProgress.message, /새로고침/);
  assert.equal(factory.automation.parallelProgress.sinhwa.status, 'done');
  assert.equal(factory.automation.parallelProgress.sinhwa.progress, 100);
  assert.equal(factory.automation.parallelProgress.cafe24.status, 'done');
  assert.equal(factory.automation.parallelProgress.cafe24.progress, 100);
  assert.equal(factory.automation.parallelProgress.vm.status, 'done');
  assert.equal(factory.product.sinhwaDbProgramStatus, null);
  assert.equal(factory.product.cafe24ProgramStatus, null);
  assert.equal(factory.stages.db.status, 'review');
  assert.deepEqual(factory.product.pendingDbCandidates, [{ id: 'db-1' }]);
  assert.deepEqual(factory.product.pendingCafe24Candidates, [{ id: 'cafe24-1' }]);
  assert.deepEqual(factory.assets, [{ id: 'hero-1', stageId: 'hero' }]);
  assert.equal(context.clearRestoredCandidateRuntime(factory, { log: false }), false);
});

test('candidate runtime cleanup persists only after server hydration wins', () => {
  const persistenceHydration = sourceSlice(
    source(CORE_02),
    'async function hydratePersistentSessionAssets(',
    '\nfunction expireCookie(',
  );
  const startupHydration = sourceSlice(
    source(CORE_06),
    'async function runClassicRuntimeHydration(',
    '\nfunction hydrateClassicRuntime(',
  );

  assert.match(
    persistenceHydration,
    /factoryClearRestoredCandidateRuntime\(\{\s*save:\s*false,/,
  );
  assert.match(
    startupHydration,
    /await hydrateServerLastWorkSnapshot\(\{[\s\S]*factoryClearRestoredCandidateRuntime\(\{\s*save:\s*true,/,
  );
});
