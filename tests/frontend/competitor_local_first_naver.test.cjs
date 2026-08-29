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

test('본컴을 먼저 부른다', () => {
  const localAt = FLOW.indexOf("runScrape('local')");
  const vmAt = FLOW.indexOf("runScrape('vm')");
  assert.ok(localAt >= 0, '본컴 경로 호출이 없습니다. 네이버가 다시 0건이 됩니다.');
  assert.ok(vmAt >= 0, 'VM 경로가 사라졌습니다. 예비로 남겨야 합니다.');
  assert.ok(localAt < vmAt, 'VM 을 먼저 부르면 제품마다 2분씩 기다렸다 실패합니다.');
});

test('본컴이 0건일 때만 VM 으로 넘어간다', () => {
  // 본컴이 후보를 가져왔는데도 VM 을 또 돌리면 시간만 두 배로 든다.
  assert.match(FLOW, /if \(!scrapeResult\?\.timedOut && !localRows\.rows\.length\)/);
  const guardAt = FLOW.indexOf('!localRows.rows.length');
  const vmAt = FLOW.indexOf("runScrape('vm')");
  assert.ok(guardAt >= 0 && vmAt > guardAt, 'VM 재시도가 0건 확인보다 앞에 있습니다.');
});

test('넘어갈 때 사람에게 알린다', () => {
  // 조용히 넘어가면 왜 느린지 알 수 없다.
  assert.match(FLOW, /본컴 후보 수집이 0건이라 VM 경로로 한 번 더 시도합니다/);
});

test('두 경로가 같은 수집 문맥을 쓴다', () => {
  // 문맥이 갈리면 작업 전환 감지(collectionContext)와 중단이 한쪽에만 걸린다.
  const runner = sourceSlice(FLOW, 'const runScrape = runtime =>', 'try {');
  assert.match(runner, /runCompMarketScrape\(runtime, \{/);
  assert.match(runner, /collectionContext,/);
  assert.match(runner, /compMarketRunWithOwnedWorkScope\(/);
  assert.match(runner, /timeoutMs,/);
});

test('생산관제 경로의 본컴 우선은 그대로 둔다', () => {
  // 같은 원칙이 두 경로에 다 있어야 한다. 한쪽만 고치면 다른 쪽에서 또 샌다.
  assert.match(CORE_03, /for \(const action of \['start-local', 'start-vm'\]\)/);
});
