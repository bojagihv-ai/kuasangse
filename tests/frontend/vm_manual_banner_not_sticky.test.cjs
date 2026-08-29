'use strict';

// 회귀: 'VM 로그인 필요' 빨간 배너가 계속 되살아나던 문제.
//
// 사용자 제보(2026-08-29): "두번쨰껀 왜자꾸뜨냐고" / "이거 뻘건거 왜뜨냐고"
//
// 원인: compMarketLegacyManualInterventionFromText 는 최근 로그 12줄을 정규식으로 훑어
//   '상세수집' + '로그인/확인 필요' 가 같이 보이면 배너를 **지어낸다**. 그 자체는 폴백이라
//   괜찮은데, 문제는 그 추측을 두 곳에 **사실로 저장**한 것이다:
//     next.manualIntervention = 추측      ← VM 이 실제로 보고한 신호가 들어가는 자리
//     next.phase = 'detail-manual'        ← 공정 단계 자체를 바꿈
//   한 번 저장되면 로그가 밀려 사라진 뒤에도 배너가 남았다. 배너 문구 스스로
//   "VM 로그인 화면이 감지된 **이전 작업**입니다" 라고 자백하고 있었다.
//
// 계약: 추측은 상태에 저장하지 않는다. 화면에 그릴 때 그때그때 새로 추론하고,
//       정말로 멈춰 사람을 기다릴 때만 띄운다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('지어낸 추측을 manualIntervention 에 저장하지 않는다', () => {
  const normalize = sourceSlice(CORE_05, 'if (!next.manualIntervention && !foreignWorkPayload) {', 'if (hiddenCandidateCount > 0) {');
  assert.doesNotMatch(
    normalize,
    /next\.manualIntervention = /,
    '추측을 사실 자리에 저장하면 로그가 사라진 뒤에도 배너가 남습니다.',
  );
});

test('지어낸 추측으로 공정 단계를 바꾸지 않는다', () => {
  // phase 를 'detail-manual' 로 바꾸면 그 자체가 사실이 되어 배너가 영구히 살아난다.
  const normalize = sourceSlice(CORE_05, 'if (!next.manualIntervention && !foreignWorkPayload) {', 'if (hiddenCandidateCount > 0) {');
  assert.doesNotMatch(normalize, /next\.phase = 'detail-manual'/, '추측이 공정 단계를 바꾸면 안 됩니다.');
});

test('추측 배너는 정말 멈췄을 때만 띄운다', () => {
  const render = sourceSlice(CORE_05, 'function renderFactoryManualInterventionPrompt(', 'const retryAvailable');
  // 실제 신호(market.manualIntervention)가 있으면 그대로 띄운다.
  assert.match(render, /if \(!market\?\.manualIntervention\) \{/);
  // 수집이 돌고 있거나 이미 끝났으면 옛 흔적이므로 띄우지 않는다.
  assert.match(render, /market\?\.loading \|\| \/\^\(detail-done\|done\|idle\|ready\)\$\/i\.test\(phase\)/);
  assert.match(render, /return '';/);
});

test('추론 함수 자체는 남겨 둔다', () => {
  // 낡은 작업에서 실제로 사람 개입이 필요했던 경우를 위한 폴백이다. 없애는 게 아니라
  // '저장하지 않고 그릴 때만 쓴다' 로 바꾼 것이다.
  assert.match(CORE_05, /function compMarketLegacyManualInterventionFromText\(/);
  assert.match(CORE_05, /\|\| compMarketLegacyManualInterventionFromText\(sourceText, market, \{\}\)/);
});
