'use strict';

// 계약: 조립공장 시작 버튼(파란 버튼)을 누른 제품명이 그 작업의 작업파일 이름이 된다.
//
// 사용자 요구(2026-08-29):
//   "조립공장의 처음부분에 슬라브나비수부채집 입력하고 저 파란버튼을 눌러서 시작하잖아.
//    그걸 되게 중요하게 여겨주고 그거위주로 가게끔좀해줘"
//   "kuasangse란 작업파일 위주로 갔으면 좋겠어. 새작업일 경우 맨처음 기입할떄 제품명이
//    첫작업파일명으로 등록되고(물론 차후에 언제든 바꿀수있고 또 첫작업파일명을 너무 강하게
//    인식해서 거기매몰되면안되고) 진행되는걸로"
//
// 왜: 예전에는 시작 버튼이 **이름만** 바꾸고 작업파일은 열려 있던 것 그대로였다.
//   관제탑 배치 문서가 열려 있으면 그 안에서 이름표만 갈아 끼우는 꼴이 되어,
//   새로고침하면 그 문서의 원래 이름('수저집 파우치')으로 되돌아갔다.
//   사용자는 이 문제로 20번쯤 같은 고통을 겪었다.
//
// 규칙(이름은 출발점이지 족쇄가 아니다):
//   남의 문서(batch:) 안 → 내 작업파일로 분리 / 저장본 없음 → 이 이름으로 세움 /
//   이미 내 작업파일 → 건드리지 않음 / 다량생산 워커 → 아무것도 안 함
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 로직 자체이므로 스텁으로 대체하지 않고 실물을 싣는다.
function loadAdopt({ batchWorker = false, projectId = '', projectName = '' } = {}) {
  const source = sourceSlice(
    CORE_03,
    'async function factoryAdoptWorkfileNameOnStart(',
    'async function startNewProjectDraft(',
  );
  const forked = [];
  const state = { currentProjectId: projectId, currentProjectName: projectName };
  const factory = { workspace: { name: projectName }, currentProjectName: projectName };
  const context = vm.createContext({
    state,
    classicRuntimeBatchWorkerMode: batchWorker,
    startNewProjectDraft: async options => { forked.push(options); },
    factoryRuntimeUpdateOwnedFactory: (_cmd, _owner, mutator) => mutator(factory),
    savePersistentState() {},
  });
  vm.runInContext(`${source}\nthis.adopt = factoryAdoptWorkfileNameOnStart;`, context);
  return { adopt: context.adopt, state, factory, forked };
}

test('남의 배치 문서 안에서 시작하면 내 작업파일로 분리한다', async () => {
  // 실제 피해: batch:factory-job-d9881... '수저집 파우치' 안에서 작업하다 이름이 되돌아갔다.
  const { adopt, forked } = loadAdopt({ projectId: 'batch:factory-job-d9881fb8', projectName: '수저집 파우치' });
  assert.equal(await adopt('슬라브나비수부채집'), true);
  // vm 안에서 만들어진 객체라 deepEqual 은 프로토타입이 달라 걸린다. 필드로 비교한다.
  assert.equal(forked.length, 1, '남의 문서 안에서 이름만 바꾸면 새로고침에 되돌아갑니다.');
  assert.equal(forked[0]?.name, '슬라브나비수부채집');
});

test('저장본이 아직 없으면 이 이름을 첫 작업파일 이름으로 세운다', async () => {
  const { adopt, state, factory, forked } = loadAdopt({ projectId: '', projectName: '' });
  assert.equal(await adopt('슬라브나비수부채집'), true);
  assert.equal(state.currentProjectName, '슬라브나비수부채집');
  assert.equal(factory.workspace.name, '슬라브나비수부채집');
  assert.equal(factory.currentProjectName, '슬라브나비수부채집');
  assert.deepEqual(forked, [], '저장 ID가 없을 때는 분리할 것도 없으므로 흔들지 않습니다.');
});

test('이미 내 작업파일 안이면 이름을 건드리지 않는다', async () => {
  // "첫작업파일명을 너무 강하게 인식해서 거기매몰되면안되고" — 이후 이름은 사람이 정한다.
  const { adopt, state, forked } = loadAdopt({ projectId: 'project_ms9p4a50', projectName: '내가 정한 이름' });
  assert.equal(await adopt('슬라브나비수부채집'), false);
  assert.equal(state.currentProjectName, '내가 정한 이름', '사람이 붙인 작업파일 이름을 덮으면 안 됩니다.');
  assert.deepEqual(forked, []);
});

test('다량생산 워커 탭에서는 아무것도 하지 않는다', async () => {
  // 관제탑 배치는 제 문서(batch:...)를 그대로 써야 한다. 여기서 분리하면 생산이 깨진다.
  const { adopt, state, forked } = loadAdopt({
    batchWorker: true, projectId: 'batch:factory-job-abc', projectName: '배치 제품',
  });
  assert.equal(await adopt('아무 이름'), false);
  assert.equal(state.currentProjectName, '배치 제품');
  assert.deepEqual(forked, [], '배치 워커가 제 문서에서 분리되면 다량생산 결과가 흩어집니다.');
});

test('제품명이 비면 아무것도 하지 않는다', async () => {
  const { adopt, forked } = loadAdopt({ projectId: 'batch:factory-job-abc' });
  assert.equal(await adopt(''), false);
  assert.equal(await adopt('   '), false);
  assert.deepEqual(forked, []);
});

test('시작 버튼이 이 규칙을 실제로 부른다', () => {
  const runDb = sourceSlice(CORE_03, '    runDb(value = {}, operationContext) {', 'factoryRuntimeBridgeAction');
  assert.match(runDb, /await factoryAdoptWorkfileNameOnStart\(value\.productName\)/);
  // 잠금 **안에서** 불러야 한다. 밖에서 await 하면 그 사이에 START 가 두 번 걸린다
  // (task7_factory_runtime_integration 의 '같은 장시간 작업을 두 번 시작하지 않는다' 계약).
  const leaseAt = runDb.indexOf('factoryRuntimeWithOperationLease');
  const adoptAt = runDb.indexOf('factoryAdoptWorkfileNameOnStart');
  assert.ok(leaseAt >= 0 && adoptAt > leaseAt, '작업파일 채택이 잠금 밖에 있습니다.');
});

test('이름 지정 분리가 기존 복사본 동작을 깨지 않는다', () => {
  // startNewProjectDraft() 를 인자 없이 부르던 기존 호출부는 그대로여야 한다.
  const draft = sourceSlice(CORE_03, 'async function startNewProjectDraft(options = {})', 'markWorkspaceDocumentDirty()');
  assert.match(draft, /const requestedName = String\(options\.name \|\| ''\)\.trim\(\)\.slice\(0, 80\)/);
  assert.match(draft, /state\.currentProjectName = requestedName \|\| `\$\{deriveProjectName\(\) \|\| '상세페이지 작업'\} 복사본`/);
  assert.match(CORE_03, /void startNewProjectDraft\(\);/, '기존 다른이름 버튼 호출부가 사라졌습니다.');
});
