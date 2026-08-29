'use strict';

// 계약: 조립공장 시작 버튼(파란 버튼)을 누른 제품명이 그 작업의 작업파일 이름이 된다.
//
// 사용자 요구(2026-08-29):
//   "kuasangse란 작업파일 위주로 갔으면 좋겠어. 새작업일 경우 맨처음 기입할떄 제품명이
//    첫작업파일명으로 등록되고(물론 차후에 언제든 바꿀수있고 또 첫작업파일명을 너무 강하게
//    인식해서 거기매몰되면안되고) 진행되는걸로"
//
// ── 2026-08-29 교정 · 처음 만든 방식이 사고를 냈다 ──
// 처음에는 배치 문서 안이면 startNewProjectDraft 로 작업파일을 갈랐다. 그 함수는
// 저장 ID를 잠시 **빈 값**으로 만드는데, 그 순간 신원 정리가 돌면
// factoryManualFieldSettingMatchesCurrentWork 가 모든 수동값을 '남의 것' 으로 판정해
// 사람이 손으로 넣은 사이즈/가로/세로가 전부 지워졌다.
//   ("왜자꾸 너가 코딩하나할떄마다 이게날라가냐고")
//
// 8/9 '잘되는상태커밋ver1'(1d40fcb) 과 대조해 배운 것:
//   그때 저장 ID를 비우는 진입점은 4개였고 **전부 사람이 직접 누르는 것**이었다
//   ('새 작업', '다른 이름', '사본 저장'). 삭제 코드 자체는 그때도 똑같이 날카로웠다.
//   달라진 건 그 칼 앞에 사람을 세우는 길이 하나 늘어난 것 — 내가 붙인 시작 버튼이다.
//
// 규칙:
//   저장본 없음      → 이 이름을 첫 작업파일 이름으로 세운다 (저장 ID는 건드리지 않는다)
//   문서가 열려 있음 → **아무것도 가르지 않는다.** 배치 문서면 알려만 준다
//   다량생산 워커    → 아무것도 안 한다
//   ★ 파괴적인 동작(저장 ID 비우기)은 사람이 '다른 이름'·'새 작업' 을 누른 순간에만.
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
  const notices = [];
  const state = { currentProjectId: projectId, currentProjectName: projectName };
  const factory = { workspace: { name: projectName }, currentProjectName: projectName };
  const context = vm.createContext({
    state,
    classicRuntimeBatchWorkerMode: batchWorker,
    startNewProjectDraft: async options => { forked.push(options); },
    setUiNotice: (message, level) => { notices.push({ message: String(message), level }); },
    factoryRuntimeUpdateOwnedFactory: (_cmd, _owner, mutator) => mutator(factory),
    savePersistentState() {},
  });
  vm.runInContext(`${source}\nthis.adopt = factoryAdoptWorkfileNameOnStart;`, context);
  return { adopt: context.adopt, state, factory, forked, notices };
}

test('남의 배치 문서 안에서 시작해도 작업파일을 가르지 않는다', async () => {
  // 이것이 오늘 사고의 형태였다. 가르는 순간 저장 ID가 비고 수동값이 전부 지워졌다.
  const h = loadAdopt({ projectId: 'batch:factory-job-d9881fb8', projectName: '수저집 파우치' });
  assert.equal(await h.adopt('슬라브나비수부채집'), false);
  assert.equal(h.forked.length, 0, '사람이 누르지도 않았는데 파괴적인 동작을 실행하면 안 됩니다.');
  // 대신 사람에게 알린다. 가르는 것은 사람이 '다른 이름' 을 눌렀을 때만.
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].message, /다른 이름/);
});

test('이미 내 작업파일 안이어도 가르지 않는다', async () => {
  const h = loadAdopt({ projectId: 'project_ms9p4a50', projectName: '내가 정한 이름' });
  assert.equal(await h.adopt('슬라브나비수부채집'), false);
  assert.equal(h.forked.length, 0);
  assert.equal(h.state.currentProjectName, '내가 정한 이름', '사람이 붙인 이름을 덮으면 안 됩니다.');
  assert.equal(h.notices.length, 0, '내 작업파일에서는 안내도 필요 없습니다.');
});

test('저장본이 아직 없으면 이 이름을 첫 작업파일 이름으로 세운다', async () => {
  const h = loadAdopt({ projectId: '', projectName: '' });
  assert.equal(await h.adopt('슬라브나비수부채집'), true);
  assert.equal(h.state.currentProjectName, '슬라브나비수부채집');
  assert.equal(h.factory.workspace.name, '슬라브나비수부채집');
  assert.equal(h.factory.currentProjectName, '슬라브나비수부채집');
  assert.equal(h.forked.length, 0, '저장 ID가 없을 때는 가를 것도 없으므로 흔들지 않습니다.');
});

test('다량생산 워커 탭에서는 아무것도 하지 않는다', async () => {
  // 관제탑 배치는 제 문서(batch:...)를 그대로 써야 한다.
  const h = loadAdopt({ batchWorker: true, projectId: 'batch:factory-job-abc', projectName: '배치 제품' });
  assert.equal(await h.adopt('아무 이름'), false);
  assert.equal(h.state.currentProjectName, '배치 제품');
  assert.equal(h.forked.length, 0);
  assert.equal(h.notices.length, 0, '워커 탭에 사람 대상 안내를 띄우면 안 됩니다.');
});

test('제품명이 비면 아무것도 하지 않는다', async () => {
  const h = loadAdopt({ projectId: 'batch:factory-job-abc' });
  assert.equal(await h.adopt(''), false);
  assert.equal(await h.adopt('   '), false);
  assert.equal(h.forked.length, 0);
  assert.equal(h.notices.length, 0);
});

test('시작 버튼이 이 규칙을 잠금 안에서 부른다', () => {
  const runDb = sourceSlice(CORE_03, '    runDb(value = {}, operationContext) {', 'factoryRuntimeBridgeAction');
  assert.match(runDb, /await factoryAdoptWorkfileNameOnStart\(value\.productName\)/);
  // 잠금 밖에서 await 하면 그 사이에 START 가 두 번 걸린다(task7 계약).
  const leaseAt = runDb.indexOf('factoryRuntimeWithOperationLease');
  const adoptAt = runDb.indexOf('factoryAdoptWorkfileNameOnStart');
  assert.ok(leaseAt >= 0 && adoptAt > leaseAt, '작업파일 채택이 잠금 밖에 있습니다.');
});

test('저장 ID를 비우는 진입점은 사람이 누르는 것뿐이다', () => {
  // 8/9 '잘되는상태커밋ver1' 의 성질을 되찾은 것이다. 여기가 늘면 또 같은 사고가 난다.
  const calls = CORE_03.split('\n')
    .map((line, index) => ({ line: line.trim(), no: index + 1 }))
    .filter(row => row.line.includes('startNewProjectDraft(') && !row.line.startsWith('async function'));
  assert.equal(
    calls.length,
    2,
    `저장 ID를 비우는 호출부가 늘었습니다: ${calls.map(c => `${c.no}:${c.line}`).join(' | ')}`,
  );
  assert.ok(calls.some(c => c.line.includes('saveAs && state.currentProjectId')), '사본 저장 경로가 사라졌습니다.');
  assert.ok(calls.some(c => c.line.includes('void startNewProjectDraft();')), "'다른 이름' 버튼 경로가 사라졌습니다.");
  // 시작 버튼 경로에서는 절대 부르지 않는다.
  const adopt = sourceSlice(CORE_03, 'async function factoryAdoptWorkfileNameOnStart(', 'async function startNewProjectDraft(');
  assert.ok(!adopt.includes('startNewProjectDraft('), '시작 버튼이 다시 파괴 함수를 부르고 있습니다.');
});

test('이름 지정 분리 기능 자체는 남겨 둔다', () => {
  // '다른 이름' 이 이름을 받아 가를 수 있어야 한다. 없앤 것은 '시작 버튼이 자동으로' 하는 것뿐이다.
  const draft = sourceSlice(CORE_03, 'async function startNewProjectDraft(options = {})', 'markWorkspaceDocumentDirty()');
  assert.match(draft, /const requestedName = String\(options\.name \|\| ''\)\.trim\(\)\.slice\(0, 80\)/);
  assert.match(draft, /state\.currentProjectName = requestedName \|\|/);
});
