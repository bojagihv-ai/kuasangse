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
//   예전 본컴 경로는 사이트를 **하나씩 순차로** 돌았다(사이트당 최대 70회 폴링 × 1.5초).
//   빈 사이트마다 105초를 통째로 버려 5개면 최대 525초 — 9분이 지나도 후보가 없었다.
//   그 느림을 세 번 모두 "수집은 되는데 작업에 안 들어온다" 로 오진했다.
//   2026-08-30 본컴도 **한 번에 전 사이트 검색**으로 바꿨다(실측 120초).
//   호출자 타임아웃은 factoryVmCandidateTimeoutMs()*3 = 30분이라 원래 충분했다.
// ── 2026-08-30 실측: 배치 전환 뒤 남은 문제 (수집 아님, **작업 반영**) ──
//   본컴 배치는 잘 된다: 한 검색으로 39초에 20건, 스마트스토어(네이버) 4건 포함.
//     "본컴에서 5개 사이트를 한 번에 검색 중..." → 후보 검색 대기 1/160 → 26/160 → 완료
//     실행 기록도 하나(5개 사이트 담김, status=done, total=20).
//   그런데 factory.product.competitors 는 0 이다. 수집한 19~20건이 작업으로 안 들어온다.
//   원인 후보를 진단으로 좁혀 두었다 — **작업 범위 두 값이 서로 엇갈린다**:
//     지금 작업 : workspaceId=naver_candidates_1788069294174 · runId=(빈 값)
//     수집한 행 : workspaceId=(빈 값)                        · runId=factory_work_run_...
//     productKey 와 이미지 지문은 양쪽이 일치한다.
//   즉 도장은 찍혔는데 workspaceId 는 안 찍히고, 비교하는 쪽은 runId 가 비어 있다.
//   이 증상은 배치 전환 **이전에도 같았다**(포트 수정 직후 실행도 9분간 0건).
//   다음 사람은 tools/verify_factory_naver_candidates_cdp_v001.cjs 의 [진단:시간초과] 덤프를
//   그대로 보면 된다 — currentScope 와 rowStamps 를 나란히 찍는다.

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

test('한 번에 전 사이트를 검색한다고 코드에 적혀 있다', () => {
  // 이 계약이 지키려는 것은 문장이 아니라 **"느린 것을 멈춤으로 오진하지 말라"** 는 것이다.
  // 그래서 배치로 바꾸면서 문장이 아니라 새 실측값으로 갈아끼운다.
  assert.match(FLOW, /한 번에 전 사이트를 검색한다/);
  assert.match(FLOW, /120초/);
  assert.doesNotMatch(FLOW, /★ 본컴은 \*\*사이트를 하나씩 순차로\*\* 돈다/,
    '순차라는 낡은 설명이 남아 있으면 다음 사람이 또 525초를 기다린다.');
});

test('본컴이 전 사이트를 한 번에 검색한다', () => {
  // 사이트별 순차 루프로 되돌아가면 빈 사이트마다 105초를 버려 최대 525초가 된다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  assert.match(local, /compMarketTryV1Search\(market, originalSelectedSites,/,
    '전 사이트를 한 번에 넘겨야 합니다. [site] 하나씩 넘기면 다시 느려집니다.');
  // 부정 검사를 '옛 for 문법 하나' 로만 걸면 다른 문법으로 순차가 되살아나도 못 잡는다.
  // 실제로 검토에서 `for (const site of ...)` 안에 단일 사이트 검색을 넣어도 통과했다.
  // 그래서 **문법이 아니라 행위**를 막는다 — 사이트 하나짜리 검색 호출 자체를 금지한다.
  assert.doesNotMatch(local, /compMarketTryV1Search\(market, \[/,
    '사이트 하나씩 검색하는 호출이 되살아났습니다. 빈 사이트마다 105초를 버리게 됩니다.');
  assert.doesNotMatch(local, /for \(const \[index, site\] of originalSelectedSites\.entries\(\)\)/,
    '사이트별 순차 루프가 되살아났습니다.');
});

test('검색이 하나면 실행 기록도 하나다', () => {
  // 사이트별로 5개를 남기면 같은 searchId 를 가리키는 런이 6개가 되고
  // (products 의 _source_sites 로 만들어지는 통합 런 1개가 더 붙는다),
  // '다시 불러오기' 가 같은 검색을 여섯 번 읽는다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  assert.match(local, /rememberLocalSearchRun\(originalSelectedSites, \{/,
    '배치 실행 기록은 전 사이트를 담은 하나여야 합니다.');
  assert.doesNotMatch(local, /rememberLocalSearchRun\(site, \{[\s\S]{0,200}status: rows\.length/,
    '사이트별로 런을 쪼개면 같은 검색을 여러 번 읽게 됩니다.');
});

test('복구하는 동안 화면이 "끝났다" 고 거짓말하지 않는다', () => {
  // publishLocalProgress 가 loading=false·phase='done' 을 찍어 완료 화면이 실제로 그려진다.
  // 그 뒤로 복구가 수십 초~수 분 더 도는데, 그대로 두면 이 저장소가 제일 크게 데인
  // "멈춘 것처럼 보이는 화면" 이 된다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  const recoverAt = local.indexOf('compMarketRecoverRecentCompletedProductsForSites');
  const reviveAt = local.indexOf('market.loading = true;');
  assert.ok(reviveAt >= 0 && reviveAt < recoverAt, '복구 전에 실행 패널을 되살려야 합니다.');
  assert.match(local, /0건 · 최근 완료 검색에서 복구 중\.\.\./, '무엇을 하는 중인지 화면에 적어야 합니다.');
  // 복구가 0건이어도 마지막에 반드시 다시 그려야 "복구 중..." 에서 굳지 않는다.
  const tail = local.slice(recoverAt);
  assert.match(tail, /복구할 최근 완료 검색을 찾지 못했습니다/);
  assert.ok(tail.lastIndexOf('render();') > tail.lastIndexOf('if (recoveredProducts.length) {'),
    '복구 결과와 무관하게 마지막에 한 번 그려야 합니다.');
});

test('상태 조회가 한 번 흔들렸다고 전 사이트를 버리지 않는다', () => {
  // 배치는 검색이 하나라 이 예외 하나가 5개 사이트를 다 날린다.
  // 순차일 때는 사이트 하나만 잃었다. 폭발 범위가 커진 만큼 견디게 한다.
  const poll = sourceSlice(CORE_06, "const waitLabel = searchRuntime === 'vm'", 'finalStatus = status;');
  assert.match(poll, /statusFailStreak \+= 1;/);
  assert.match(poll, /if \(statusFailStreak >= 3\) throw new Error/);
  // 그래도 죽었으면, 이미 발급된 검색 결과를 한 번은 읽어 본다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  assert.match(local, /const startedSearchId = String\(market\.searchId \|\| ''\)\.trim\(\);/);
  assert.match(local, /compMarketReadV1SearchProducts\(startedSearchId, market, originalSelectedSites, 'local'\)/);
});

test('0건인 사이트만 골라 복구한다', () => {
  // 순차에서는 사이트마다 재시도·benchmark 구제를 각각 받았다. 배치는 전체가 0건일 때만
  // 그 구제가 걸리므로, 네이버만 0건인 상황이 그대로 구멍이 된다. 그 구멍을 메우는 계약이다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  assert.match(local, /const emptySites = originalSelectedSites\.filter\(/);
  assert.match(local, /compMarketRecoverRecentCompletedProductsForSites\(market, emptySites, 'local', collectionContext\)/);
});

test('실행 기록을 남긴다', () => {
  // 이 기록이 없으면 "수집은 됐는데 작업에 안 들어온다" 가 된다
  // (factoryFreshVmCandidateRows 가 허용 searchId 집합으로 쓴다).
  // 배치 런이 하나여야 한다는 것은 아래 '검색이 하나면 실행 기록도 하나다' 가 따로 지킨다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  assert.match(local, /rememberLocalSearchRun\(/);
  assert.match(local, /status: batchProducts\.length \? 'done' : 'zero_result'/);
  assert.match(local, /status: 'recovered'/, '복구분도 기록해야 아래 mergedRuns 덮어쓰기에서 살아남습니다.');
});

test('수집 중에도 어느 사이트를 도는지 화면에 남는다', () => {
  // activeSiteLabel 이 비면 사이트판이 본컴 수집 중에도 'VM 검색 중' 이라고 거짓말한다.
  const local = sourceSlice(CORE_06, '// 사이트를 하나씩 돌지 않는다.', 'market.selectedSites = originalSelectedSites;');
  assert.match(local, /market\.activeSiteLabel = `\$\{originalSelectedSites\.length\}개 사이트 동시`/);
  assert.match(local, /compMarketSetSiteSearchStatus\(market, originalSelectedSites, '본컴 검색 중', 'busy'\)/);
});

test('생산관제 경로의 본컴 우선은 그대로 둔다', () => {
  // 같은 원칙이 두 경로에 다 있어야 한다. 한쪽만 고치면 다른 쪽에서 또 샌다.
  assert.match(CORE_03, /for \(const action of \['start-local', 'start-vm'\]\)/);
});

test('화면이 얼어붙는 현상을 재는 장치가 검증기에 있다', () => {
  // 2026-08-30 · 원인까지 밝혀졌다. 기록을 남긴다 — 같은 함정이 세 번째로 오고 있었다.
  //
  //   증상: 시작 버튼을 누르고 몇 초 뒤부터 화면 전체가 멈춘다. 사소한 식조차 답이 없다.
  //   내가 세 번 오진한 것: "수집이 멈췄다 / 작업 반영 0건 / 렌더러가 죽었다".
  //
  //   진짜 원인: 앱이 alert() 를 띄우고 사람의 대답을 기다리고 있었다.
  //     "필수 프로그램을 시작할 수 없습니다. VM 후보 수집기: 포트 5003에 다른 프로그램이 실행 중입니다."
  //   그리고 그 말은 **사실이었다** — 포트 관리국 기록상 5003 은 이메일통합에 영구 배정되었고,
  //   제품스크래퍼는 43000 으로 옮겨갔다. 앱만 5003 을 계속 보고 있었다.
  //   그래서 스마트스토어(네이버)가 한 건도 안 잡혔던 것이다.
  //
  //   고친 곳: backend/routes/api_shared.py — 포트를 외우지 않고 API 허브에 물어 찾는다.
  //   회귀: backend/tests/test_jepum_scraper_port_discovery.py
  //
  //   남은 결함(따로 고쳐야 함): 이 경로가 **alert() 로 화면 전체를 세운다.**
  //   사람이 자리를 비우면 앱이 통째로 멈춘다. 막지 않는 안내로 바꾸는 것이 옳다.
  const verifier = fs.readFileSync(path.join(ROOT, 'tools/verify_factory_naver_candidates_cdp_v001.cjs'), 'utf8');
  assert.match(verifier, /응답성/, '얼어붙음을 재는 장치가 사라졌습니다. 다시 오진하게 됩니다.');
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
