'use strict';

// 계약: **회복된 한 단계 때문에 전체 실행이 실패로 보이지 않는다. 그리고 깜빡이지 않는다.**
//
// 2026-08-31 주인님:
//   "수집이 되었는데 진행되는 와중에, 진행상황이 뻘겋게되면서 실패라고 나왔거든?
//    그러다 마저 진행되면서 다시 뻘건테두리가 없어졌는데 왜이러는거지?"
//
// 원인 두 가지 (판정 함수를 그대로 실행해 확인했다):
//
// (1) 판정이 문장에 '실패' 라는 글자가 있는지로만 갈렸다.
//       "현재 원본 색상 검수 실패 · 현재 작업 후보로 유지했습니다."      -> 실패로 표시
//       "현재 제품 이미지 AI 분석 실패: ... 후보 수집은 계속 시도합니다." -> 실패로 표시
//     두 문장 다 "작업은 살아 있다" 고 스스로 말하는데도 그랬다.
//
// (2) 판정 근거로 **최근 로그 한 줄**이 들어왔다.
//       const stage = goal.currentStage || (logs[0]?.message || '대기');
//       factoryGoalRunHasFailure(goal, stage)
//     goal.currentStage 가 비는 순간(단계와 단계 사이) 마지막 로그가 판정을 대신했다.
//     그 줄이 하필 오류면 전체 패널이 빨개졌다가, 다음 로그가 오면 풀린다 = 깜빡임.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 문자열 매칭이 아니라 **실제로 실행해서** 계약을 지킨다.
const judged = sourceSlice(CORE_05, 'function factoryGoalRunNeedsAttention(', 'function factoryGoalRunDisplayProgress(');
const context = { String, RegExp, Math, Number, Boolean };
vm.createContext(context);
vm.runInContext(`${judged}\nglobalThis.__hasFailure = factoryGoalRunHasFailure;`, context);
const hasFailure = context.__hasFailure;
const run = stage => hasFailure({ running: false, failureReason: '' }, stage);

test('작업이 이어졌다고 스스로 말하는 단계는 전체 실패가 아니다', () => {
  assert.equal(run('현재 원본 색상 검수 실패 · 현재 작업 후보로 유지했습니다.'), false);
  assert.equal(run('현재 제품 이미지 AI 분석 실패: 어쩌고. DB/경쟁사 후보 수집은 계속 시도합니다.'), false);
});

test('진짜 실패는 그대로 실패다', () => {
  // 여기가 느슨해지면 진짜 사고를 조용히 넘기게 된다. 그건 훨씬 나쁘다.
  assert.equal(run('새 생성 실패: 컷 1 생성 실패: 이미지 API 실패: archive mutation rejected by server (409) · 기존 후보 1개 보존'), true,
    "'보존' 같은 넓은 말로 회복 판정을 하면 진짜 실패를 놓칩니다.");
  assert.equal(run('VM 상세페이지 수집 실패: 요청 시간이 360초를 넘어 중단되었습니다.'), true);
  assert.equal(run('신화사DB 후보 적용 실패: 상세 조회 실패'), true);
});

test('정상 문구는 원래대로 정상이다', () => {
  assert.equal(run('6번 · 경쟁사 후보 9건 수집 완료. 자동 상세 스크래핑은 실행하지 않았습니다.'), false);
  assert.equal(run('신화사DB 후보 조회 완료: 9건'), false);
  assert.equal(run(''), false);
});

test('실행 실패 사유가 있으면 여전히 실패다', () => {
  assert.equal(hasFailure({ running: false, failureReason: '이미지 API 실패' }, ''), true);
});

test('판정에 최근 로그 한 줄을 쓰지 않는다', () => {
  // 이것이 깜빡임의 뿌리다. stage 는 화면 문구, 판정은 실행 자신(goal)만 답한다.
  const panel = sourceSlice(CORE_05, "const stage = goal.currentStage || (logs[0]?.message || '대기');", 'const market =');
  assert.match(panel, /const verdictStage = String\(goal\.currentStage \|\| ''\);/);
  assert.match(panel, /factoryGoalRunHasFailure\(goal, verdictStage\)/);
  assert.match(panel, /factoryGoalRunNeedsAttention\(goal, verdictStage\)/);
  assert.doesNotMatch(panel, /factoryGoalRunHasFailure\(goal, stage\)/,
    '로그 한 줄이 판정에 들어오면 오류 로그가 뜰 때마다 전체가 빨개졌다 풀립니다.');
});
