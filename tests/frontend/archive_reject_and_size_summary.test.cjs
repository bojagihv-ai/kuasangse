'use strict';

// 회귀 두 건. 둘 다 실측으로 원인을 확정한 뒤 고친 것이다.
//
// 1) GENERATE-01 간헐 실패 — 진짜 이유가 가려지던 문제
//    실패 로그 패턴: `release 200` → `POST assets 409`.
//    저장이 끝날 때마다 편집권을 반납하는 동작이 이미지 업로드와 겹치면 서버가 409로 거절한다.
//    그런데 어댑터가 **서버 응답을 보기 전에** 스코프 검사부터 던져서, 화면에는
//    '권한이 바뀌었다' 로만 보였다. 게다가 스코프가 그대로면 409 응답이 성공처럼
//    그냥 반환돼 나갔다(조용한 누수).
//    ※ 처음 세운 가설(draft 분기 A 의 mode 검사가 과하다)은 **반증됐다**.
//      A 는 서버가 draft 쓰기를 전혀 검증하지 않으므로 유일한 방어다. 완화하면 안 된다.
//
// 2) 사이즈 칸이 빈칸으로 나오던 문제
//    저장본에 '20cm' 이 세 군데나 살아 있는데도, 숫자가 하나뿐이면 사이즈로 안 쳐주는
//    정규화 규칙에 걸려 통째로 버려졌다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const ADAPTER = fs.readFileSync(path.join(ROOT, 'src/modules/persistence/archive-adapter.mjs'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 실물 정규화 함수를 그대로 싣는다. 스텁으로 대체하면 판정 자체를 검증하지 못한다.
function loadNormalizeSizeSummary() {
  const src = sourceSlice(CORE_06, 'function factoryParseDbSizeText(', 'function factoryDbSizeParsedCandidate(');
  return new Function(`${src}
    function factoryFormatMetricFactValue(n, u) { return String(n) + u; }
    return factoryNormalizeSizeSummaryFactValue;`)();
}

test('서버가 거절하면 그 사실을 그대로 올린다', () => {
  const branch = sourceSlice(ADAPTER, 'const pathScope = decodeURIComponent(', 'return response;\n  };');
  // 응답 검사가 스코프 검사보다 앞에 있어야 진짜 이유가 보인다.
  const rejectAt = branch.indexOf('ARCHIVE_REJECTED');
  const scopeAt = branch.indexOf('latest.scopeId !== scopeId');
  assert.ok(rejectAt >= 0, '서버 거절을 알리는 오류가 없습니다. 409 가 성공처럼 빠져나갑니다.');
  assert.ok(scopeAt > rejectAt, '스코프 검사가 먼저 던지면 409 가 권한 오류로 가려집니다.');
  assert.match(branch, /if \(!response\.ok\)/);
  assert.match(branch, /status: response\.status/, '어느 상태코드로 거절됐는지 담아야 진단이 됩니다.');
});

test('draft 분기의 mode 검사는 완화하지 않는다', () => {
  // 서버는 draft: 스코프 쓰기를 검증하지 않는다. 이 검사가 유일한 방어다.
  // 처음 세운 가설대로 여기를 풀면 draft 경로가 무방비가 된다.
  const draftBranch = sourceSlice(ADAPTER, 'if (currentOfflineBranch) {', 'const pathScope = decodeURIComponent(');
  assert.match(
    draftBranch,
    /!latest \|\| latest\.mode !== 'offline-edit' \|\| latest\.scopeId !== currentScope/,
    'draft 분기의 방어가 약해졌습니다. 서버가 draft 쓰기를 검증하지 않으므로 여기가 유일한 방어입니다.',
  );
});

test('축이 하나뿐인 치수도 사이즈로 인정한다', () => {
  // 실제 피해: 저장본에 '20cm' 이 살아 있는데 화면 사이즈 칸이 빈칸이었다.
  const normalize = loadNormalizeSizeSummary();
  assert.equal(normalize('20cm'), '20cm');
  assert.equal(normalize('가로 20cm'), '가로 20cm');
  assert.equal(normalize('200mm'), '200mm');
  // 두 축이 있는 기존 동작은 그대로.
  assert.equal(normalize('20x15cm'), '20x15cm');
  assert.equal(normalize('가로 55cm x 세로 55cm'), '가로 55cm x 세로 55cm');
});

test('무게와 맨숫자는 여전히 사이즈가 아니다', () => {
  // 무게는 mm/cm 가 없으므로 이 완화에 걸리지 않아야 한다.
  const normalize = loadNormalizeSizeSummary();
  assert.equal(normalize('1.00g'), '', '무게가 사이즈 칸에 들어가면 안 됩니다.');
  assert.equal(normalize('5.3g'), '');
  assert.equal(normalize('2.5kg'), '');
  assert.equal(normalize('20'), '', '단위 없는 맨숫자는 사이즈로 볼 수 없습니다.');
  assert.equal(normalize(''), '');
  assert.equal(normalize('{"a":1}'), '');
});

test('사이즈 폴백을 더 열지 않는다 — 남의 제품 값이 새어 들어온다', () => {
  // 실측 경고: app-core-05.js:9871 하드 컷이나 스코프 게이트를 함께 열었더니
  // '20cm' 대신 다른 제품('맞춤-아트아리랑')의 후보값 '23x40' 이 사이즈 칸에 박혔다.
  // 이번 수정은 **주어진 값을 어떻게 읽을지**만 바꿨고, 값의 출처는 건드리지 않았다.
  const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
  assert.match(
    CORE_05,
    /if \(isSizeScopedField\) return \{ value: '', source: '' \};/,
    '사이즈 계열의 출처 차단이 사라졌습니다. 다른 제품의 치수가 들어옵니다.',
  );
  // 정규화는 값을 새로 찾아오지 않는다. 넘겨받은 문자열만 판정한다.
  const src = sourceSlice(CORE_06, 'function factoryNormalizeSizeSummaryFactValue(', 'function factoryDbSizeParsedCandidate(');
  assert.doesNotMatch(src, /factory\.product|dbCandidates|confirmedDb/, '정규화가 값의 출처를 뒤지면 안 됩니다.');
});
