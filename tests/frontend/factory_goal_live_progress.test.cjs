'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
function slice(file, start, end) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test('비동기 goal 실행의 공개 진행은 커밋 전에도 현재 상세 공정을 보여준다', async () => {
  // Given: 저장 상태는 DB 완료이고, 다음 상세 생성은 아직 응답하지 않는다.
  const committed = {
    activeStage: 'db', product: { analysis: {} }, automation: { optionMode: 'none' },
    stages: { db: { status: 'done' }, detail: { status: 'idle' } },
    goalRun: { maxLoops: 1, targets: { hero: 0, size: 0, cuts: 0, detail: 1 }, mode: 'auto', progress: 100 },
  };
  let begin;
  let finish;
  const started = new Promise(resolve => { begin = resolve; });
  const generated = new Promise(resolve => { finish = resolve; });
  let completed = false;
  const context = {
    state: {}, factoryRuntimeOwnedRenderLeases: [], factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => ({ revision: 1 }),
      acquireOperationLease: () => ({ acquired: true, signal: null, release() {} }),
    }),
    factoryRequireCurrentRunOperation() {}, factoryUpdateFromInputs() {},
    factoryLog() {}, saveLastWorkNow() {}, render() {},
    factoryGoalAssetCount: () => completed ? 1 : 0,
    factoryStageLabel: stage => stage,
    factoryHasSizeFacts: () => true,
    factoryArchiveSession: async () => {},
    FACTORY_GOAL_STAGE_A_CUT_DECISIONS: {},
    factoryRuntimeUpdateOwnedFactory: async (_action, _owner, mutate) => ({ result: await mutate(structuredClone(committed)) }),
    factoryRunStage: async (stage, { factory }) => {
      factory.activeStage = stage;
      factory.stages[stage].status = 'running';
      factory.stages[stage].message = '3/15';
      factory.goalRun.progress = 20;
      begin();
      await generated;
      completed = true;
      return true;
    },
  };
  vm.createContext(context);
  vm.runInContext([
    slice('src/app-core-03.js', 'function factoryRuntimeRenderWithOwnedDraft(', 'function factoryRuntimeReadFactory('),
    slice('src/app-core-03.js', 'function factoryControlProgress(', 'function createFactoryControlPreflightCache('),
    slice('src/app-core-06.js', 'async function factoryRunGoalLoop(', 'function factoryMakeSessionFolderName('),
  ].join('\n'), context);

  // When: 실제 루프가 응답 대기 중인 현재 상태를 projection과 같은 경계로 읽는다.
  const work = context.factoryRunGoalLoop({ forceDetail: true });
  await started;
  const progress = context.factoryControlProgress(context.factoryRuntimeOwnedRenderDraft || committed);
  finish();
  await work;

  // Then: 이전 DB의 100%가 아니며, 실행 종료 후 임시 표시 범위도 해제된다.
  assert.equal(progress.stageKey, 'detail');
  assert.equal(progress.status, 'running');
  assert.equal(progress.percent, 20);
  assert.equal(progress.message, '3/15');
  assert.equal(context.factoryRuntimeOwnedRenderDraft, null);
});

test('저장된 등록 완료는 수동 대기로 내려가지 않고 생성만 끝난 작업은 등록 완료가 아니다', async () => {
  const { savedFactory, runtime } = require('./factory_cafe24_native_receipt_fixture.cjs');
  const factory = savedFactory();
  factory.activeStage = 'export';
  factory.stages = { export: { status: 'done', message: '디스크 보관 건너뜀 · 로컬 보관 유지' } };
  factory.goalRun.progress = 100;
  const { context, project } = runtime(factory);
  context.factoryStageLabel = stage => stage;
  vm.runInContext(slice('src/app-core-03.js', 'function factoryControlProgress(',
    'function createFactoryControlPreflightCache('), context);

  const restored = await project();
  assert.equal(restored.progress.status, 'completed');
  assert.equal(restored.registration.status, 'approval_required', '옛 등록 이력은 새 쓰기 승인이 아니다');
  assert.equal(restored.registration.publicationReceipt.status, 'verified');

  factory.product.cafe24RegistrationReceipt.mismatches.push('대표이미지');
  assert.equal((await project()).progress.status, 'manual', '등록 검증 실패를 완료로 표시하지 않는다');
  factory.product.cafe24RegistrationReceipt.mismatches = [];
  factory.activeStage = 'hero';
  factory.stages.hero = { status: 'done' };
  assert.equal((await project()).progress.status, 'manual', '중간 컷 완료는 전체 완료가 아니다');
  factory.activeStage = 'export';
  factory.stages.export.status = 'error';
  assert.equal((await project()).progress.status, 'failed', '실제 오류를 수동 대기로 감추지 않는다');
  factory.goalRun.running = true;
  assert.equal((await project()).progress.status, 'running');
});
