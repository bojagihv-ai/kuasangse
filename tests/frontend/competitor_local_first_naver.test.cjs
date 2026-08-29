'use strict';

// 계약: 수동 시작 버튼의 경쟁사 후보 수집은 **본컴을 먼저** 쓰고, 0건일 때만 VM 을 예비로 쓴다.
//
// 사용자 질문(2026-08-30): "지금 네이버(스마트스토어) 잘 수집하고있니?"
// 답: 아니오. 그리고 원인은 스크래퍼가 아니라 우리 앱의 경로 선택이었다.
//
// 실측 (API Hub 127.0.0.1:4321 경유 JepumScraper 직접 호출, 키워드 '수저집 파우치'):
//   본컴(local) → status success · total 20
//                 coupang 4 · **naver 4** · gmarket 4 · auction 4 · 11st 4
//   VM          → status error   · total 0  (90초 소요)
//
//   스크래퍼 설정: 네이버만 api_enabled=true (5개 마켓 중 유일). 로그인 없이도 수집된다.
//   앞선 0건은 네이버 차단 쿨다운(cooldown until …: blocked) 때문이었고 일시적이었다.
//
// 왜 이 경로만 문제였나:
//   생산관제(배치) 경로는 02f0ce7 에서 이미 ['start-local','start-vm'] 로 바꿨는데,
//   수동 시작 버튼 경로만 runCompMarketScrape('vm') 고정으로 남아 있었다.
//   그래서 사용자 저장본에 쿠팡·G마켓·11번가·옥션은 있고 네이버만 0건이었다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 이 경로 전체를 실물로 돌리려면 브라우저가 필요하다(FIELD-04 가 그 역할).
// 여기서는 **순서 계약**만 지킨다. 순서가 뒤집히면 네이버가 다시 0건이 된다.
const FLOW = sourceSlice(
  CORE_06,
  'async function factoryRunVmCompetitorCollectionForSelection(',
  'if (vmTimedOut) {',
);

test('수동 경로는 아직 VM 을 쓴다 — 되돌린 상태를 기록해 둔다', () => {
  // 본컴 우선으로 바꿨다가 되돌렸다. 이유는 app-core-06.js 의 주석에 남겼다.
  // 요약: 본컴 행은 시장 상태에만 쌓이고, 그쪽은 함수 진입 때 잡아둔 currentScope 로
  // 걸러진다. 시작 버튼이 작업 신원을 회전시켜 그 scope 가 어긋나 19건이 전부 탈락했다.
  // VM 행은 응답 본문으로 와서 그 검사를 거치지 않기 때문에 지금까지 문제가 없었다.
  assert.match(FLOW, /runCompMarketScrape\('vm'/);
  assert.doesNotMatch(FLOW, /runScrape\('local'\)/, '행 선별을 고치기 전에 본컴 우선으로 되돌리면 후보가 0건이 됩니다.');
});

test('되돌린 이유가 코드에 남아 있다', () => {
  // 다음 사람이(또는 내가) 같은 수정을 다시 시도했다가 같은 곳에서 막히지 않도록.
  assert.match(FLOW, /본컴 우선으로 바꾸려던 시도를 되돌렸다/);
  assert.match(FLOW, /smartstore\.naver\.com 4건/);
  assert.match(FLOW, /factoryFreshVmCandidateRows/);
});

test('생산관제 경로의 본컴 우선은 그대로 둔다', () => {
  // 그쪽은 다른 함수를 거쳐 이 행 선별을 타지 않으므로 영향이 없다.
  assert.match(CORE_03, /for \(const action of \['start-local', 'start-vm'\]\)/);
});
