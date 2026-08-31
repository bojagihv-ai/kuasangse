'use strict';

// 계약: **VM 상세수집이 안 되면 화면에 말한다.** 조용히 던지지 않는다.
//
// 2026-08-31 주인님: "상세수집버튼을 눌렀는데 먹통인것같은데"
//
// 실제로는 먹통이 아니었다. 확인해 보니:
//   앱 백엔드 /api/vm-bridge/readiness →
//     { "watcherAlive": false, "heartbeatAgeSeconds": 145379,
//       "message": "VM 내부 watcher 가 145379초 동안 응답하지 않았습니다..." }
//   즉 VM 화면은 켜져 있는데(VirtualBoxVM 실행 중, state: running)
//   그 안의 후보 수집 워커가 **40시간 넘게** 죽어 있었다.
//
// 앱은 그 사실을 알아채고 예외를 던졌다. 그런데 그 예외가 위에서 조용히 삼켜져
// 화면에는 아무 일도 일어나지 않은 것처럼 보였다. 그래서 '먹통' 이 된 것이다.
//
// 이 저장소가 오늘 여러 번 겪은 것과 같은 모양이다 —
// 앱이 아는 것을 사람에게 말하지 않으면, 사람은 원인을 짐작할 수밖에 없다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

const GUARD = sourceSlice(
  CORE_06,
  'if (!(vmStatus.ready || vmStatus.enabled)) {',
  'compMarketSetStatus(`VM 상세페이지 수집 시작',
);

test('던지기 전에 화면에 남긴다', () => {
  // 던지기만 하면 위에서 삼켜져 아무 일도 안 일어난 것처럼 보인다.
  const statusAt = GUARD.indexOf('compMarketSetStatus(');
  const throwAt = GUARD.indexOf('throw new Error(');
  assert.ok(statusAt >= 0, '화면 상태를 남기지 않습니다.');
  assert.ok(throwAt > statusAt, '던지기가 화면 표시보다 먼저면 사용자는 아무것도 못 봅니다.');
});

test('작업 로그에도 남긴다', () => {
  assert.match(GUARD, /compMarketLog\(`VM 상세수집 중단/);
  assert.match(GUARD, /'error'\)/);
});

test('사유를 그대로 말한다', () => {
  // '워커 준비 안 됨' 같은 뭉뚱그린 말로는 무엇을 해야 할지 알 수 없다.
  assert.match(GUARD, /vmStatus\.message \|\| vmStatus\.error \|\| vmStatus\.fallback_error/);
  // 얼마나 오래 죽어 있었는지도 말한다 — 방금 죽은 것과 40시간 죽은 것은 다른 얘기다.
  assert.match(GUARD, /heartbeatAgeSeconds/);
  assert.match(GUARD, /마지막 응답 \$\{Math\.round\(age \/ 60\)\}분 전/);
});

test('대안을 알려준다', () => {
  // 막혔다고 일이 멈출 이유가 없다. 본컴 상세수집은 VM 없이 된다.
  assert.match(GUARD, /본컴 상세수집/);
  assert.match(GUARD, /VM 안에서 후보 수집 워커를 다시 띄우거나/);
});

test('그래도 던지기는 한다', () => {
  // 화면에만 적고 그냥 진행하면 응답 없는 워커에 요청을 보내 몇 분을 기다리게 된다.
  assert.match(GUARD, /throw new Error\(`VM 상세페이지 수집 연결 실패/);
});

test('본컴 상세수집 길은 그대로 있다', () => {
  // 대안이라고 안내했는데 그 길이 없으면 안내가 거짓이 된다.
  assert.match(CORE_06, /runCompMarketDetailCapture\(null, \{ runtime: 'local' \}\)|options\.runtime === 'local'/);
});
