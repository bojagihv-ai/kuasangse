'use strict';

// 계약: **번들에서 선언보다 앞서 `typeof` 로 let 변수를 보지 않는다.**
//
// 2026-08-30 실측으로 겪은 사고:
//   `typeof classicRuntimeBatchWorkerMode !== 'undefined'` 로 안전하게 감쌌다고 생각했다.
//   아니었다. 그 변수는 **뒤에 오는 파일에서 let 으로** 선언되고,
//   let 은 선언 전 접근이면 `typeof` 조차 ReferenceError 를 던진다(TDZ).
//   (var 나 아예 없는 변수였다면 typeof 가 막아 줬을 함정이다)
//
//   그 예외가 부팅 초반 복원 경로를 끊었고, 일일 회귀 SAVE-26 이 잡았다 —
//   "강제 새로고침이 조립공장 생성물을 잃었습니다: 10개 -> 0개".
//   단위검사 1,838개는 전부 초록이었다. 브라우저를 실제로 띄우는 검사만 잡을 수 있었다.
//
// 그래서 번들 순서를 기계가 보게 한다. 사람 눈으로 파일 순서를 기억할 수는 없다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const BUNDLE = fs.readFileSync(path.join(ROOT, 'dist/app-runtime.bundle.js'), 'utf8');

// 번들 전역에서 let/const 로 선언되는 런타임 상태 변수들.
// 여기 적힌 것을 typeof 로 '안전하게' 보려는 시도가 곧 함정이다.
const GUARDED_LET_NAMES = [
  'classicRuntimeBatchWorkerMode',
  'classicRuntimeHydrationActive',
  'classicRuntimeHydrationReady',
];

for (const name of GUARDED_LET_NAMES) {
  test(`${name} 을 선언보다 앞에서 typeof 로 보지 않는다`, () => {
    const declaration = BUNDLE.indexOf(`let ${name}`);
    if (declaration < 0) return; // 이름이 바뀌었으면 이 검사는 지킬 것이 없다
    const needle = `typeof ${name}`;
    const risky = [];
    let cursor = BUNDLE.indexOf(needle);
    while (cursor >= 0) {
      if (cursor < declaration) risky.push(cursor);
      cursor = BUNDLE.indexOf(needle, cursor + 1);
    }
    assert.deepEqual(
      risky,
      [],
      `${name} 을 선언(${declaration}) 앞에서 typeof 로 봅니다: ${risky.join(', ')}.\n`
      + 'let 은 typeof 로도 막히지 않습니다. try/catch 로 감싸거나 선언을 앞으로 옮기세요.',
    );
  });
}

test('실제로 던지는지 확인 — 이 검사의 근거', () => {
  // 이 검사가 무엇을 막는지 스스로 증명한다. 전제가 틀리면 검사도 의미가 없다.
  let threw = false;
  try {
    // eslint-disable-next-line no-unused-expressions, block-scoped-var
    typeof laterLet !== 'undefined';
  } catch (error) {
    threw = error instanceof ReferenceError;
  }
  // eslint-disable-next-line no-unused-vars
  let laterLet = false;
  assert.equal(threw, true, 'let 이 TDZ 에서 typeof 로 안 던진다면 이 계약은 필요 없습니다.');
});

test('배치 워커 판정은 던지지 않게 감싸져 있다', () => {
  const core02 = fs.readFileSync(path.join(ROOT, 'src/app-core-02.js'), 'utf8');
  const core03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  for (const [label, source] of [['app-core-02', core02], ['app-core-03', core03]]) {
    if (!source.includes('classicRuntimeBatchWorkerMode')) continue;
    assert.match(
      source,
      /try \{ batchWorkerMode(Now)? = classicRuntimeBatchWorkerMode === true; \} catch \(_\)/,
      `${label} 에서 배치 워커 판정이 감싸져 있지 않습니다.`,
    );
  }
});
