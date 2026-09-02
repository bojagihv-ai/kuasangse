'use strict';
// IME-ENTER-02 — 한글 조합 중 Enter 판정(isImeComposingKeyEvent)과 그것을 쓰는 핸들러 계약
//
// 사장님 말(2026-09-02): "한글 치다가 엔터 누르면 마지막 글자가 빠진 채로 날아간다."
// 실제 Chrome 에서 IME 조합을 흉내내는 검사는 IME-ENTER-01(tools/verify_ime_composition_enter_cdp_v1.cjs)이다.
// 이 검사는 그보다 싸게, 판정 함수를 실제로 실행해 보고(isComposing / keyCode 229 / 보통 Enter)
// Enter 로 값을 확정·전송하는 네 핸들러가 그 판정을 거치는지 본다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadGuard() {
  const source = read('src/app-core-01.js');
  const start = source.indexOf('function isImeComposingKeyEvent(event) {');
  assert.ok(start >= 0, 'isImeComposingKeyEvent 정의가 src/app-core-01.js 에 있어야 합니다.');
  const end = source.indexOf('\n}\n', start);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end + 3)}; this.fn = isImeComposingKeyEvent;`, context);
  return context.fn;
}

test('한글 조합 중 Enter(isComposing 또는 keyCode 229)만 조합 중으로 본다', () => {
  const guard = loadGuard();
  // Windows 한국어 IME: 조합 중 Enter
  assert.equal(guard({ key: 'Enter', keyCode: 229, isComposing: true }), true);
  // isComposing 을 안 주는 구형 환경
  assert.equal(guard({ key: 'Enter', keyCode: 229, isComposing: false }), true);
  assert.equal(guard({ key: 'Enter', keyCode: 229 }), true);
  // 조합 확정 뒤 보통 Enter → 전송돼야 한다
  assert.equal(guard({ key: 'Enter', keyCode: 13, isComposing: false }), false);
  assert.equal(guard({ key: 'Enter', keyCode: 13 }), false);
  assert.equal(guard(null), false);
  assert.equal(guard(undefined), false);
});

test('Enter 로 확정·전송하는 네 핸들러가 조합 판정을 먼저 거친다', () => {
  const core05 = read('src/app-core-05.js');
  const core06 = read('src/app-core-06.js');
  const handlers = [
    ['에이전트 채팅 doSend', core05, /agentInputEl\.onkeydown = e => \{\n\s*\/\/[^\n]*\n\s*if \(isImeComposingKeyEvent\(e\)\) return;\n\s*if \(e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); doSend\(\); \}/],
    ['이미지 지시 addImageDirective', core05, /directiveInput\.onkeydown = e => \{\n\s*if \(isImeComposingKeyEvent\(e\)\) return;[^\n]*\n\s*if \(e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); addImageDirective\(state\.imageDirectiveInput\); \}/],
    ['등록 기본정보 입력', core05, /if \(event\.key !== 'Enter' \|\| isImeComposingKeyEvent\(event\)\) return;[^\n]*\n\s*event\.preventDefault\(\);\n\s*factoryApplyFinalRegistrationBasicInfoInputs\(/],
    ['사이즈 손입력', core06, /if \(event\.key !== 'Enter' \|\| isImeComposingKeyEvent\(event\)\) return;[^\n]*\n\s*event\.preventDefault\(\);\n\s*factoryCommitDbSizeManualDraft\(/],
  ];
  for (const [label, source, pattern] of handlers) {
    assert.match(source, pattern, `${label}: Enter 핸들러가 isImeComposingKeyEvent 판정을 먼저 거쳐야 합니다.`);
  }
});

test('판정 함수가 번들에 들어가 Enter 핸들러보다 먼저 정의된다', () => {
  const bundle = read('dist/app-runtime.bundle.js');
  const defined = bundle.indexOf('function isImeComposingKeyEvent(event)');
  const firstUse = bundle.indexOf('isImeComposingKeyEvent(e)');
  assert.ok(defined >= 0, '번들에 isImeComposingKeyEvent 정의가 없습니다 — node tools/build_runtime_bundle.cjs 를 다시 돌리세요.');
  assert.ok(firstUse > defined, '판정 함수 정의가 첫 사용보다 앞에 있어야 합니다.');
});
