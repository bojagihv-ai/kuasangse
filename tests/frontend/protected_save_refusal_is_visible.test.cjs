'use strict';

// 계약: **서버가 저장을 보류하면 사장님이 그 사실을 알고, 되살릴 사본이 남는다.**
//
// 주인님 2026-09-02: "컷들을 생성하고 필수값을 선정하고 vm을 선정하고 하던게 날아가지않는것,
//                    날아가는경우는 새 작업을 시작한경우에만 해당"
//
// 실측으로 확인한 것 (전수 진단 #1, critical):
//   서버가 protectedNoOp(보호 거절)을 돌려주면 앱은 accepted:true 로 받고
//   savePersistentState 는 **경고를 오히려 지우고** return true 했다. 서버 자동저장은 continue.
//   그래서 거절이 이어지는 동안 화면은 멀쩡했고, 탭을 닫으면 서버의 옛 사본으로 돌아갔다.
//   output/lastwork-trace.jsonl: project:project_mt2jaj93_ilrs1e(낙지발노리개)에 도착한 54건이
//   2026-08-31 21:37 ~ 09-01 15:20 사이 전부 'optionSorter.images.length' 로 거절됐고
//   서버 사본(74ec58a2….json)의 savedAt 은 2026-08-21 14:54 에 멈춰 있었다.
//
// 고친 방향: 리비전은 여전히 올리지 않는다(서버가 안 받은 것을 올리면 이후 저장이 전부 어긋난다).
// 대신 (1) 한국어로 말하고 (2) 되살릴 사본을 남긴다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src/app-core-02.js'), 'utf8');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 사유 번역기는 실제로 실행해서 확인한다. 문자열 매칭만으로는 동작을 못 지킨다.
const describeSource = sourceSlice(CORE_02, 'function describeProtectedSaveRefusal(', '\nfunction warnProtectedSaveRefused(');
const context = { String, RegExp };
vm.createContext(context);
vm.runInContext(`${describeSource}\nglobalThis.__describe = describeProtectedSaveRefusal;`, context);
const describe = context.__describe;

test('실제로 서버가 주는 영어 사유를 한국어로 옮긴다', () => {
  // 서버가 돌려주는 실제 문장 (backend/routes/api_archive.py)
  const real = 'incoming snapshot changed work identity or dropped protected work data: optionSorter.images.length';
  const message = describe(real);
  assert.match(message, /옵션 원본 이미지가 서버 저장본보다 줄어/);
  assert.doesNotMatch(message, /[A-Za-z]{6,}/, '영어가 남아 있으면 사장님은 읽을 수 없습니다.');
  assert.match(message, /다시 지워 주시면/, '무엇을 하면 되는지 없으면 안내가 아닙니다.');
});

test('모르는 사유도 최소한 무슨 일이 났는지는 말한다', () => {
  assert.match(describe('something entirely new'), /서버가 이번 저장을 보류했습니다/);
  assert.match(describe(''), /서버가 이번 저장을 보류했습니다/);
});

test('자동저장이 경고를 지우지 않고 남긴다', () => {
  const branch = sourceSlice(CORE_02, 'if (commitResult.protectedNoOp) {', 'if (!commitResult.clean)');
  assert.match(branch, /warnProtectedSaveRefused\(commitResult\.reason/);
  assert.match(branch, /saveRejectedWorkRecoverySnapshot\(commitResult\.reason\)/);
  assert.doesNotMatch(branch, /clearResolvedSessionPersistenceWarning\(\)/,
    '서버가 거절했는데 경고를 지우면 사장님은 저장된 줄 압니다.');
});

test('서버 자동저장도 조용히 넘어가지 않는다', () => {
  const branch = sourceSlice(CORE_02, 'if (result.protectedNoOp) {', 'if (result.clean) {');
  assert.match(branch, /warnProtectedSaveRefused\(result\.reason\)/);
  assert.match(branch, /saveRejectedWorkRecoverySnapshot\(result\.reason\)/);
});

test('리비전은 여전히 올리지 않는다', () => {
  // 서버가 안 받은 것을 로컬에서 올리면 그 다음 저장이 전부 어긋난다.
  // 이 계약이 깨지면 SAVE-04·AUTH-01 이 무너진다.
  const save = sourceSlice(CORE_02, 'function savePersistentState(', 'function flushQueuedPersistentState(');
  const noOpAt = save.indexOf('if (commitResult.protectedNoOp)');
  const returnAt = save.indexOf('return true;', noOpAt);
  const commitAt = save.indexOf('commitCurrentWorkspaceRevision(');
  assert.ok(noOpAt >= 0 && returnAt > noOpAt && commitAt > returnAt,
    '보호 거절은 새 로컬 리비전을 올리기 전에 멈춰야 합니다.');
});

test('거절당한 저장된 작업도 되살릴 사본을 남긴다', () => {
  const fn = sourceSlice(CORE_02, 'function saveRejectedWorkRecoverySnapshot(', '\nfunction saveDraftRecoverySnapshot(');
  assert.match(fn, /allowSavedWork: true/);
  const store = sourceSlice(CORE_02, 'function saveDraftRecoverySnapshot(', 'if (draftRecoverySending)');
  assert.match(store, /options\.allowSavedWork === true && scope\.startsWith\('project:'\)/);
  assert.match(store, /scope\.startsWith\('draft:'\)/, '저장 전 작업의 그물은 그대로 있어야 합니다.');
});

test('되살리기 칸이 거절 중인 저장된 작업에도 뜬다', () => {
  const panel = sourceSlice(CORE_05, 'function renderDraftRecoveryPanel()', 'const view = state.draftRecovery');
  assert.match(panel, /protected-save-refused/);
  assert.match(panel, /savedWorkNeedsNet/);
  // 평소 저장된 작업에서는 여전히 숨는다 - 정상 저장·불러오기가 있기 때문이다.
  assert.match(panel, /!scopeId\.startsWith\('draft:'\) && !savedWorkNeedsNet/);
});
