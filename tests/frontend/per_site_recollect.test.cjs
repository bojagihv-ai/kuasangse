'use strict';

// 계약: **사이트 하나만 따로 다시 수집할 수 있다.**
//
// 주인님 2026-08-30:
//   "스마트스토어만 클릭해서 따로 수집, 옥션만 따로 수집 이런식으로
//    따로수집하는 기능이 구현안되어있고"
//
// 왜 필요한가 (실측):
//   같은 제품명으로 연달아 수집해 보면 사이트별 실패가 무작위로 섞인다 —
//   한 번은 네이버만 error 로 0건, 다음엔 옥션만 0건.
//   그런데 지금까지는 하나가 비면 **다섯 곳을 전부 다시** 도는 수밖에 없었다.
//   그건 느릴 뿐 아니라 멀쩡한 사이트까지 다시 찔러 차단 쿨다운을 부른다.
//   (실측: 네이버는 오늘 반복 조회로 'cooldown until ...: blocked' 에 걸렸다)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'src/menus/factory/factory-menu-shell.mjs'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('사이트 카드마다 다시 수집 버튼이 있다', () => {
  assert.match(CORE_05, /data-factory-guide-action="rerun-site-competitors"/);
  assert.match(CORE_05, /data-site="\$\{escAttr\(row\.siteId\)\}"/,
    '어느 사이트인지 실어 보내지 않으면 무엇을 다시 수집할지 알 수 없습니다.');
  // 수집 중에는 못 누르게 한다. 겹쳐 돌면 서로 밀린다.
  assert.match(CORE_05, /\$\{market\.loading \? 'disabled' : ''\}/);
});

test('껍데기가 사이트를 함께 넘긴다', () => {
  assert.match(SHELL, /'rerun-site-competitors',/, '껍데기가 이 동작을 무시하면 버튼이 죽습니다.');
  assert.match(SHELL, /site \? \{ action, site \} : action/);
  // 예전 동작(문자열)은 그대로여야 한다.
  assert.match(SHELL, /handlers\.runGuideAction\?\.\(/);
});

test('액션이 사이트를 받아 그 사이트만 수집한다', () => {
  const handler = sourceSlice(CORE_03, "if (action === 'rerun-site-competitors') {", 'return factoryRuntimeBridgeAction(`factory/competitor:guide:');
  assert.match(handler, /const site = String\(options\.site \|\| ''\)\.trim\(\);/);
  assert.match(handler, /if \(!site\) return false;/, '사이트 없이 부르면 전체 수집이 돌아버립니다.');
  assert.match(handler, /runCompMarketScrape\(runtime, \{ onlySites: \[site\] \}\)/);
});

test('실행 경로는 사용자가 고른 것을 따른다', () => {
  // 화면에서 'VM에서 수집' 을 골랐는데 본컴으로 돌면 사용자가 고른 것을 뒤집는 것이다.
  const handler = sourceSlice(CORE_03, "if (action === 'rerun-site-competitors') {", 'return factoryRuntimeBridgeAction(`factory/competitor:guide:');
  assert.match(handler, /ensureCompMarketScrapeState\(\)\.collectMode === 'local' \? 'local' : 'vm'/);
});

test('수집기가 고른 사이트만 돈다', () => {
  const scrape = sourceSlice(CORE_06, 'const requestedOnlySites = Array.isArray(options.onlySites)', 'const originalProductName');
  assert.match(scrape, /options\.onlySites/);
  // 선택 목록에 없는 사이트를 억지로 넣지 않는다.
  assert.match(scrape, /filter\(site => market\.selectedSites\.includes\(site\)\)/);
  assert.match(CORE_06, /고른 사이트가 현재 선택 목록에 없습니다/);
});

test('명령 정책에 등록돼 있다', () => {
  // 빠뜨리면 수집에 성공하는 순간 저장이 거절되어 작업이 통째로 버려진다(300edbe 에서 겪음).
  const policy = sourceSlice(CORE_03, "'factory/competitor:guide:rerun-local-competitors',", "], 'competitors', [part('competitors', ['compPage'])], 'competitors');");
  assert.match(policy, /'factory\/competitor:guide:rerun-site-competitors',/);
});

test('예전 문자열 호출도 그대로 동작한다', () => {
  // 기존 동작들(rerun-local-competitors 등)이 깨지면 안 된다.
  const fn = sourceSlice(CORE_03, 'function factoryRuntimeCompetitorGuideAction(', "if (action === 'open-vm-capture')");
  assert.match(fn, /const action = String\(detail\.action \?\? actionValue \?\? ''\)\.trim\(\);/);
});
