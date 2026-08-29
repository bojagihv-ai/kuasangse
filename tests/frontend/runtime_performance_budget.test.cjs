'use strict';

// 회귀: 아무 일도 없는데 빨간 경고가 뜨던 문제.
//
// 사용자 제보(2026-08-29):
//   "빨강으로 주의표시가 떠서 뭐야뭐야 했더니 아무일아닙니다 안전합니다는
//    말이 거꾸로 된거잖아 설계가 잘못된거지"
//   "지금이 안전한구간이면 초록으로 잡고 좀 과부화다 싶으면 주황으로 잡고,
//    너무 길어지고있다 그러면 빨강으로 잡고해야지"
//
// 그때 실제 화면: 렌더 19ms · 자동저장 1080ms → '성능 확인 필요'(빨강).
// 예전 판정은 두 단계뿐이었고 자동저장 1000ms 를 1밀리초라도 넘으면 곧바로 빨간불이었다.
// 아무 문제 없는 구간에서 경고가 뜨면 표시가 신뢰를 잃고, 정말 느려졌을 때도 무시하게 된다.
//
// 계약: 안전(초록) · 주의(주황) · 경고(빨강) 세 단계로 나눈다.
//       빨간불은 정말 느릴 때만 켠다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const APP_HTML = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

// 판정 로직 자체이므로 스텁을 두지 않고 실물과 실제 구간표를 함께 싣는다.
function loadModel() {
  const bandsStart = CORE_02.indexOf('const RUNTIME_PERFORMANCE_BANDS =');
  const bandsEnd = CORE_02.indexOf('};', bandsStart) + 2;
  assert.ok(bandsStart >= 0 && bandsEnd > bandsStart, '구간표를 찾지 못했습니다.');
  const context = vm.createContext({ Math, Number });
  vm.runInContext(
    `${CORE_02.slice(bandsStart, bandsEnd)}
     ${extractFunction(CORE_02, 'runtimePerformanceBandLevel')}
     ${extractFunction(CORE_02, 'runtimePerformanceDurationText')}
     ${extractFunction(CORE_02, 'runtimePerformanceBudgetModel')}
     this.model = runtimePerformanceBudgetModel;
     this.durationText = runtimePerformanceDurationText;`,
    context,
  );
  return context;
}

test('사용자가 실제로 본 값(렌더 19ms · 자동저장 1080ms)은 안전이다', () => {
  // 이것이 이 수정의 출발점이다. 예전에는 여기서 빨간불이 켜졌다.
  const { model } = loadModel();
  const result = model(19, 1080);
  assert.equal(result.level, 'ok', '아무 문제 없는 구간에서 경고를 띄우면 표시가 신뢰를 잃습니다.');
  assert.equal(result.overBudget, false);
  assert.deepEqual(Array.from(result.slow), []);
});

test('세 단계를 구분한다 — 안전·주의·경고', () => {
  const { model } = loadModel();

  assert.equal(model(87, 529).level, 'ok');
  // 자동저장만 무거워지는 흔한 경우.
  assert.equal(model(20, 3200).level, 'warn', '2초를 넘으면 주의는 줘야 합니다.');
  assert.equal(model(20, 7400).level, 'bad', '5초를 넘으면 경고여야 합니다.');
  // 화면 그리기 쪽.
  assert.equal(model(210, 300).level, 'warn');
  assert.equal(model(520, 300).level, 'bad');
  // 하나라도 나쁘면 전체가 그 단계로 올라간다.
  assert.equal(model(520, 100).level, 'bad');
  assert.equal(model(20, 3200).persistenceLevel, 'warn');
  assert.equal(model(20, 3200).renderLevel, 'ok');
});

test('빨간불은 정말 느릴 때만 켠다', () => {
  const { model } = loadModel();
  assert.equal(model(151, 1001).overBudget, false, '예전 기준이라면 여기서 빨간불이었습니다.');
  assert.equal(model(151, 1001).level, 'warn');
  assert.equal(model(401, 5001).overBudget, true);
});

test('재지 않았으면 판정하지 않는다', () => {
  const { model } = loadModel();
  assert.equal(model(0, 0).measured, false);
});

test('시간은 사람이 읽기 쉬운 단위로 보여준다', () => {
  const { durationText } = loadModel();
  assert.equal(durationText(19), '19ms');
  assert.equal(durationText(999), '999ms');
  assert.equal(durationText(1080), '1.1초', '1초가 넘으면 밀리초보다 초가 읽기 쉽습니다.');
  assert.equal(durationText(7400), '7.4초');
});

test('화면 표시와 색이 세 단계를 그대로 반영한다', () => {
  assert.match(CORE_02, /id="runtimePerformanceStatus"/);
  assert.match(CORE_02, /data-performance-level="\$\{model\.level\}"/);
  assert.match(CORE_02, /kuasangsePersistenceLastMs/);

  // '렌더' 는 개발자 말이다. 화면에는 사람 말로 쓴다.
  assert.match(CORE_02, /화면 그리기/);
  assert.doesNotMatch(CORE_02, /성능 확인 필요/, '겁주는 옛 문구가 남아 있습니다.');

  // 주의(주황) 단계에 쓸 색이 실제로 정의돼 있어야 한다. 없으면 주황이 안 나온다.
  assert.match(APP_HTML, /\.workfile-save-status\.warn\{[^}]*var\(--warn\)/);
});

test('AI 분석 연동 배지는 DB 후보 선택과 다른 것임을 이름으로 밝힌다', () => {
  // 실제 피해: DB 후보를 골라 둔 채로 '제품정보 DB: 연결 기록 없음' 을 보고
  //   고른 것이 날아간 줄 알았다. 둘 다 그냥 'DB' 라고 불러서 생긴 오해다.
  // 주석에는 옛 문구가 인용돼 있으므로, 실제로 화면에 쓰이는 자리만 겨냥한다.
  assert.doesNotMatch(CORE_02, /:\s*'제품정보 DB: 연결 기록 없음'/, '오해를 부르던 옛 문구가 화면에 남아 있습니다.');
  assert.match(CORE_02, /AI 분석에 아직 안 넘김/);
  assert.match(CORE_02, /AI 분석에 넘김: \$\{formatLatestDbSyncTime\(info\.syncedAt\)\}/);
  assert.match(CORE_02, /조립공장에서 고른 신화사DB 후보와는 다릅니다/);
});
