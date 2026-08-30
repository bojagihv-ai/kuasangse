'use strict';

// 계약 두 가지.
//
// (1) **검색어를 바꿔서 수집할 수 있다.**
//   주인님 2026-08-31: "후보수집을 검색어를 다르게해서도 할수있게끔도 해줘"
//   제품명 그대로는 안 잡히는데 짧게 줄이거나 다른 말로 하면 잡히는 경우가 많다.
//   작업의 제품명은 바뀌면 안 된다 — 이번 검색에만 쓴다.
//
// (2) **모르면 모른다고 말한다.**
//   주인님이 스마트스토어 카드를 보고 물었다: "이렇게 뜨는데 실제로 검색을 했니?"
//   화면은 '검색 완료 · 결과 없음' 이라고 단정했지만, 스크래퍼에 직접 물어보니
//   실제로는 30초간 검색을 돌렸고 사이트가 접속을 막은 것이었다:
//     status: "차단/보안 확인"
//     error:  "네이버쇼핑 접속 제한 + 통합검색 폴백에서도 결과 없음"
//   물건이 없는 것과 막힌 것은 완전히 다른 얘기다.
//   사이트별 보고가 없어 사유를 모를 때는 '검색 완료' 라고 단정하지 않는다.
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

test('검색어 입력칸과 버튼이 있다', () => {
  assert.match(CORE_05, /id="compMarketKeywordOverride"/);
  assert.match(CORE_05, /data-factory-guide-action="rerun-with-keyword"/);
  assert.match(CORE_05, /data-keyword-source="#compMarketKeywordOverride"/,
    '버튼이 어느 칸을 읽을지 모르면 검색어가 전달되지 않습니다.');
});

test('껍데기가 입력칸의 지금 값을 읽어 넘긴다', () => {
  assert.match(SHELL, /'rerun-with-keyword',/);
  assert.match(SHELL, /data-keyword-source/);
  assert.match(SHELL, /const searchKeyword = clean\(keywordInput\?\.value\);/);
});

test('검색어 없이 부르면 아무 일도 하지 않는다', () => {
  // 빈 검색어로 전체 수집이 돌아버리면 사고다.
  const handler = sourceSlice(CORE_03, "if (action === 'rerun-with-keyword') {", 'return factoryRuntimeBridgeAction(`factory/competitor:guide:');
  assert.match(handler, /if \(!keyword\) \{/);
  assert.match(handler, /검색어를 입력해주세요/);
});

test('작업 제품명은 바뀌지 않는다', () => {
  // 검색어를 바꾸는 것과 제품명을 바꾸는 것은 다른 일이다.
  // 제품명을 바꾸면 확정값 보존 규칙까지 딸려 들어간다(c07dc1f).
  const scrape = sourceSlice(CORE_06, 'const requestedKeyword = String(options.searchKeyword', 'const candidateSearchTerms');
  assert.match(scrape, /const originalSearchKeyword = requestedKeyword \|\| market\.searchKeyword \|\| originalProductName;/);
  assert.doesNotMatch(scrape, /market\.productName\s*=/, '검색어 바꾸기가 제품명을 건드리면 안 됩니다.');
  assert.match(CORE_06, /작업 제품명은 그대로 둡니다/);
});

test('명령 정책에 등록돼 있다', () => {
  const policy = sourceSlice(CORE_03, "'factory/competitor:guide:rerun-local-competitors',", "], 'competitors', [part('competitors', ['compPage'])], 'competitors');");
  assert.match(policy, /'factory\/competitor:guide:rerun-with-keyword',/);
});

test('사유를 모르면 검색 완료라고 단정하지 않는다', () => {
  // '검색 완료 · 결과 없음' 은 "검색은 제대로 됐고 물건이 없다" 는 뜻이다.
  // 사이트별 보고가 없을 때 그렇게 말하면 거짓이 된다.
  assert.match(CORE_05, /결과 없음 · 사유 미확인/);
  const board = sourceSlice(CORE_05, "} else if (!loading && hasAttempt &&", 'if (!state) {');
  // 주석에 그 문구를 설명으로 적어 둘 수는 있다. 막아야 하는 것은 **대입**이다.
  assert.doesNotMatch(board, /state = '검색 완료 · 결과 없음'/,
    '사유를 모르는 자리에서 검색 완료라고 말하면 안 됩니다.');
});

test('사유를 알면 그대로 말한다', () => {
  // 차단·쿨다운은 '결과 없음' 과 다르게 보여야 한다.
  assert.match(CORE_05, /사이트가 접근을 막아 대기 중입니다/);
  assert.match(CORE_05, /검색은 됐지만 조건에 맞는 상품이 없었습니다/);
  // 사이트별 보고가 있으면 실패는 실패라고 한다.
  assert.match(CORE_05, /state = reportFailed \? '수집 실패' : '검색 완료 · 결과 없음';/);
});

test('어느 경로로 돌았는지 카드에 적는다', () => {
  // 주인님 2026-08-31: "vm에서한건지 본컴에서한건지도"
  assert.match(CORE_05, /경로 \$\{escapeHtml\(isLocalSearch \? '본컴' : 'VM'\)\}/);
  assert.match(CORE_05, /const searchTermLabel = String\(market\.searchKeyword \|\| market\.productName \|\| ''\)/);
});
