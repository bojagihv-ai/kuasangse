'use strict';

// 계약: **API Hub 가 꺼져 분석이 못 시작하면, 그 사실을 사람 말로 말한다.**
//
// 2026-08-31 주인님: (화면 맨 위 "API Hub 연결 실패(http://127.0.0.1:4321)" 배너와 함께)
//   "이런게 뜨는데? 분석누르니까" -> 이후 "분석실패라고 떴어"
//
// 실측으로 확인한 것:
//   - 4321 포트에 프로세스가 아예 없었다(API Hub 사망).
//   - 브리지를 되살린 뒤 주인님과 똑같은 설정(gpt-5.6-luna · fast · xhigh)으로 이미지 1장을
//     직접 호출하니 9.1초에 정상 응답했다. 모델도 추론강도도 서비스등급도 원인이 아니다.
//   - 즉 "분석 실패" 는 모델이 실패한 게 아니라 중계 서버에 닿지 못한 것이었다.
//
// 그런데 코드는 fetch 의 TypeError 를 그대로 위로 올렸다. 화면에는
//   "분석 실패: Failed to fetch"
// 라는 영어 한 줄만 남는다. 맨 위 배너와 같은 원인인데 화면에서 이어지지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_01 = fs.readFileSync(path.join(ROOT, 'src/app-core-01.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 함수를 실제로 실행해서 계약을 확인한다. 문자열 매칭만으로는 동작을 못 지킨다.
const detector = sourceSlice(CORE_01, 'function isNetworkLevelFetchFailure(', '\nfunction formatGptOAuthBridgeError(');
const context = { TypeError, String, RegExp };
vm.createContext(context);
vm.runInContext(`${detector}\nglobalThis.__detect = isNetworkLevelFetchFailure;`, context);
const isNetworkLevelFetchFailure = context.__detect;

test('허브가 꺼졌을 때의 실제 예외를 네트워크 실패로 판정한다', () => {
  // Chrome 이 던지는 것
  assert.equal(isNetworkLevelFetchFailure(new TypeError('Failed to fetch')), true);
  // Firefox
  assert.equal(isNetworkLevelFetchFailure(new TypeError('NetworkError when attempting to fetch resource.')), true);
  // Safari
  assert.equal(isNetworkLevelFetchFailure(new TypeError('Load failed')), true);
});

test('시간 초과와 서버 응답 오류는 여기에 섞이지 않는다', () => {
  // 시간 초과는 따로 안내가 있다. 뭉뚱그리면 "허브를 켜세요" 라는 틀린 안내를 하게 된다.
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(isNetworkLevelFetchFailure(abort), false);
  // HTTP 4xx/5xx 는 res.ok 로 갈리므로 예외로 오지 않는다. 사용량 한도도 마찬가지다.
  assert.equal(isNetworkLevelFetchFailure(new Error('GPT OAuth bridge HTTP 500')), false);
  assert.equal(isNetworkLevelFetchFailure(new Error('usage limit reached')), false);
  assert.equal(isNetworkLevelFetchFailure(null), false);
});

test('안내가 무엇이 꺼졌고 무엇을 하면 되는지 말한다', () => {
  const guard = sourceSlice(CORE_01, 'if (isNetworkLevelFetchFailure(e)) {', 'throw e;');
  assert.match(guard, /API Hub\(\$\{this\.baseUrl\}\)에 연결하지 못해/,
    '어느 주소에 못 닿았는지 없으면 사용자가 확인할 수가 없습니다.');
  assert.match(guard, /모델이 실패한 것이 아니라 중계 서버가 꺼져 있는 상태입니다/,
    '"분석 실패" 만 보면 모델 탓으로 오해합니다.');
  assert.match(guard, /바탕화면 API Hub 를 실행하거나 상세페이지 런처를 다시 켠 뒤/,
    '무엇을 하면 되는지 없으면 안내가 아닙니다.');
});

test('시간 초과 안내는 그대로 남아 있다', () => {
  assert.match(CORE_01, /GPT OAuth 호출이 \$\{Math\.round\(timeoutMs \/ 1000\)\}초를 초과했습니다/);
});
