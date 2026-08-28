'use strict';

// 회귀: VM 후보수집이 왜 0건인지 화면이 말하지 못하던 문제.
//
// 스크래퍼는 마켓별로 사유를 구분해서 준다. zero_result(검색은 됐는데 결과 없음),
// error(수집 실패), 그리고 platforms 아래에 상세를 준다
// (예: 네이버쇼핑 { error: 'cooldown until ...: blocked', policy: { consecutive_failures: 41 } }).
//
// 그런데 화면은 전부 'API 사유 미제공' 한 줄로 뭉갰다. 2026-08-28 실측:
//   옥션 raw 30건 -> 승인 2건(성공), 네이버는 차단돼 쿨다운 중, 나머지는 zero_result.
//   화면에는 다섯 마켓이 똑같이 "검색 완료 · 결과 없음 / 미달 사유: API 사유 미제공"
//   으로 보여서, 멀쩡히 도는 수집과 차단된 수집을 구분할 수 없었다.
//
// 계약: 사유를 구분해서 사람 말로 보여준다. 특히 차단/쿨다운은 그대로 드러낸다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function loadReasonText() {
  const start = CORE_05.indexOf('function compMarketShortfallReasonText(');
  const end = CORE_05.indexOf('function compMarketFilterCandidatesForCurrentWork(', start);
  assert.ok(start >= 0 && end > start, 'compMarketShortfallReasonText 를 찾지 못했습니다');
  return new Function(`${CORE_05.slice(start, end)}; return compMarketShortfallReasonText;`)();
}

test('검색은 됐지만 결과가 없는 경우와 수집이 실패한 경우를 구분해 말한다', () => {
  const reasonText = loadReasonText();
  const zero = reasonText('zero_result', {});
  const failed = reasonText('error', { error: 'HTTP 500' });

  assert.match(zero, /결과|상품이 없/, 'zero_result 는 결과가 없다는 뜻으로 보여야 합니다.');
  assert.match(failed, /오류/, 'error 는 오류라고 보여야 합니다.');
  assert.notEqual(zero, failed, '두 사유가 같은 문장이면 원인을 구분할 수 없습니다.');
});

test('차단·쿨다운은 감추지 않고 그대로 보여준다', () => {
  // 실측한 네이버쇼핑 응답 그대로.
  const reasonText = loadReasonText();
  const text = reasonText('error', { error: 'cooldown until 2026-08-28T23:32:56: blocked' });

  assert.match(text, /막아|차단|대기/, '차단 상태라는 것을 사람이 알 수 있어야 합니다.');
  assert.match(text, /cooldown until 2026-08-28T23:32:56/, '언제까지 막혔는지 원문을 남겨야 합니다.');
});

test('사유가 아예 없으면 없는 말을 지어내지 않는다', () => {
  const reasonText = loadReasonText();
  assert.equal(reasonText('', {}), '', '사유가 없으면 빈 문자열이어야 합니다.');
  assert.equal(reasonText(null, {}), '');
});

test('화면은 API 사유 미제공 대신 옮긴 문장을 쓴다', () => {
  // 예전에는 두 표시 지점이 모두 'API 사유 미제공' 으로 대체했다.
  assert.doesNotMatch(
    CORE_05,
    /미달 사유: \$\{escapeHtml\((?:report|row)\.shortfallReason \|\| 'API 사유 미제공'\)\}/,
    '사유를 뭉개는 표시가 남아 있습니다.',
  );
  assert.match(CORE_05, /compMarketShortfallReasonText\(row\.shortfallReason, row\)/);
  assert.match(CORE_05, /compMarketShortfallReasonText\(report\.shortfallReason, report\)/);
});

test('스크래퍼의 platforms 상세가 마켓별 보고로 실려 화면까지 간다', () => {
  // 이 연결이 끊기면 차단 사유를 알아도 화면에서는 볼 수 없다.
  assert.match(CORE_06, /platform_reports|platformReports|'platforms'/);
  assert.match(CORE_06, /platformDetailByMarket/);
  assert.match(CORE_06, /cooldown_until|cooldownUntil/);
  assert.match(CORE_06, /consecutive_failures|consecutiveFailures/);

  // 마켓별 보고에 상세가 담기고,
  assert.match(CORE_06, /error: String\(\s*report\.error \|\| report\.message \|\| platformDetailByMarket\[marketId\]\?\.error \|\| '',\s*\)\.trim\(\)/);
  // 화면 행까지 옮겨져야 한다.
  assert.match(CORE_05, /error: String\(report\.error \|\| ''\)/);
  assert.match(CORE_05, /cooldownUntil: String\(report\.cooldownUntil \|\| ''\)/);
});
