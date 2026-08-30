'use strict';

// 계약: 수동 시작 버튼의 경쟁사 후보 수집은 **본컴을 먼저** 쓰고, 0건일 때만 VM 을 예비로 쓴다.
//
// 사용자 질문(2026-08-30): "지금 네이버(스마트스토어) 잘 수집하고있니?"
// 답은 '아니오' 였고, 원인은 스크래퍼가 아니라 우리 앱의 경로 선택이었다.
//
// ── 실측 (API Hub 127.0.0.1:4321 경유 JepumScraper 직접 호출) ──
//   본컴(local) → success 20/20  coupang 4 · **naver 4** · gmarket 4 · auction 4 · 11st 4
//   VM          → error   0/20   (90초 소요)
//   스크래퍼 설정상 네이버만 api_enabled=true 다(5개 마켓 중 유일). 로그인 없이도 수집된다.
//   처음 조회에서 0건이었던 것은 네이버 차단 쿨다운이었고 일시적이었다.
//
// ── 실측 (COMP-NAVER 검증기로 **실제 시작 버튼을 눌러** 확인) ──
//   [OK] 수집 19건(네이버 4) · **작업 반영 19건(네이버 4)** · 115.8초
//   사이트별: coupang 4 · smartstore.naver.com 4 · gmarket 4 · auction 3 · 11st 4
//
// ── 세 번 헛짚은 기록 (다음에 같은 함정에 빠지지 않도록) ──
//   본컴 경로는 사이트를 **하나씩 순차로** 돈다(app-core-06.js 의 originalSelectedSites 루프,
//   사이트당 최대 70회 폴링 × 1.5초, 옥션만 36회). 그래서 약 116초가 걸린다.
//   VM 경로는 한 번에 전 사이트를 검색한다(compMarketTryVmSearch).
//   이 차이를 모르고 검증기 대기를 2~5분으로 짧게 잡아, 세 번 모두
//   "수집은 되는데 작업에 안 들어온다" 로 오진했다. 실제로는 아직 도는 중이었다.
//   호출자 타임아웃은 factoryVmCandidateTimeoutMs()*3 = 30분이라 원래 충분했다.
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

// 이 경로 전체를 실물로 돌리는 것은 COMP-NAVER 검증기가 한다(실제 버튼을 누른다).
// 여기서는 **순서 계약**만 지킨다. 순서가 뒤집히면 네이버가 다시 0건이 된다.
const FLOW = sourceSlice(
  CORE_06,
  'async function factoryRunVmCompetitorCollectionForSelection(',
  'if (vmTimedOut) {',
);

test('본컴을 먼저 부른다', () => {
  // 두 경로는 runScrape(runtime) 하나로 묶여 있다. 호출 순서를 본다.
  const localAt = FLOW.indexOf("runScrape('local')");
  const vmAt = FLOW.indexOf("runScrape('vm')");
  assert.ok(localAt >= 0, '본컴 경로 호출이 없습니다. 네이버가 다시 0건이 됩니다.');
  assert.ok(vmAt >= 0, 'VM 경로가 사라졌습니다. 예비로 남겨야 합니다.');
  assert.ok(localAt < vmAt, 'VM 을 먼저 부르면 브리지가 죽었을 때 제품마다 2분씩 헛기다립니다.');
  assert.match(FLOW, /runCompMarketScrape\(runtime, \{/, '두 경로가 같은 호출부를 써야 합니다.');
});

test('본컴이 0건일 때만 VM 으로 넘어간다', () => {
  // 본컴이 후보를 가져왔는데도 VM 을 또 돌리면 시간만 두 배로 든다.
  assert.match(FLOW, /if \(!scrapeResult\?\.timedOut && !localRows\.rows\.length\)/);
  const guardAt = FLOW.indexOf('!localRows.rows.length');
  const vmAt = FLOW.indexOf("runScrape('vm')");
  assert.ok(guardAt >= 0 && vmAt > guardAt, 'VM 재시도가 0건 확인보다 앞에 있습니다.');
});

test('넘어갈 때 사람에게 알린다', () => {
  // 조용히 넘어가면 왜 두 배로 느린지 알 수 없다.
  assert.match(FLOW, /본컴 후보 수집이 0건이라 VM 경로로 한 번 더 시도합니다/);
});

test('두 경로가 같은 수집 문맥과 타임아웃을 쓴다', () => {
  // 문맥이 갈리면 작업 전환 감지와 중단이 한쪽에만 걸린다.
  const runner = sourceSlice(FLOW, 'const runScrape = runtime =>', 'try {');
  assert.match(runner, /runCompMarketScrape\(runtime, \{/);
  assert.match(runner, /collectionContext,/);
  assert.match(runner, /compMarketRunWithOwnedWorkScope\(/);
  assert.match(runner, /timeoutMs,/);
});

test('오래 걸리는 이유가 코드에 적혀 있다', () => {
  // 이걸 모르면 또 "멈췄다" 고 오진한다. 실제로 세 번 그랬다.
  assert.match(FLOW, /사이트를 하나씩 순차/);
  assert.match(FLOW, /115\.8초|116초|약 116/);
});

test('생산관제 경로의 본컴 우선은 그대로 둔다', () => {
  // 같은 원칙이 두 경로에 다 있어야 한다. 한쪽만 고치면 다른 쪽에서 또 샌다.
  assert.match(CORE_03, /for \(const action of \['start-local', 'start-vm'\]\)/);
});

test('화면이 얼어붙는 현상을 재는 장치가 검증기에 있다', () => {
  // 2026-08-30 실측 · 아직 못 고친 결함:
  //   시작 버튼을 누르고 **63초 지점부터** 사소한 식(`1`) 평가조차 60초 넘게 응답이 없다.
  //   매 실행마다 63초로 같다. 앱이 그 시점에 얼어붙는다.
  //   이 때문에 수집이 '멈춘 것' 으로 보여 원인을 세 번 오진했다.
  //   확인한 것: CDP Network 도메인을 꺼도 같다(도구 탓 아님).
  //              중간 발행의 영속화를 꺼도 같다(저장 탓 아님).
  //   다음에 볼 것: 렌더러가 죽는지(OOM/크래시), 60초 타이머를 가진 코드가 무엇인지.
  const verifier = fs.readFileSync(path.join(ROOT, 'tools/verify_factory_naver_candidates_cdp_v001.cjs'), 'utf8');
  assert.match(verifier, /응답성/, '얼어붙음을 재는 장치가 사라졌습니다. 다시 오진하게 됩니다.');
  assert.match(verifier, /Network 도메인은 켜지 않는다/);
});

test('실제 버튼을 누르는 검증기가 파일로 남아 있다', () => {
  // 소스 패턴만 보는 검사로는 "수집이 작업까지 들어오는가" 를 못 지킨다.
  // 다만 이 검증기는 본컴 수집이 2~6분 걸려 **일일 회귀 스텝 제한(360초)을 넘는다.**
  // 그래서 manifest 에 등록하지 않는다. 손으로 돌릴 때는:
  //   node tools/run_daily_regression.cjs --ids COMP-NAVER   (manifest 에 임시 등록 후)
  // 수집을 한 번에 하도록 빨라지면 그때 등록한다.
  const verifier = path.join(ROOT, 'tools/verify_factory_naver_candidates_cdp_v001.cjs');
  assert.ok(fs.existsSync(verifier), '실제 버튼을 누르는 검증기가 사라졌습니다.');
  const source = fs.readFileSync(verifier, 'utf8');
  assert.match(source, /data-factory-guide-action="run-db"/, '시작 버튼을 실제로 누르는 부분이 사라졌습니다.');
  assert.match(source, /smartstore|naver/i);
});
