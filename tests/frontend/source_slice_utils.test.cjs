'use strict';
// 계약: **소스를 문자열로 읽는 검사는 작업본 줄 끝(CRLF/LF)에 따라 결과가 달라지면 안 된다.**
//
// 2026-09-02 실측: 원본 작업 트리의 src/app-core-01.js·cafe24-api.js 가 w/crlf, cafe24-sync.js 가
// w/mixed 였고, competitor_section_plan_prompt_contract.test.cjs:161·175 의 `\n}\n` 패턴은
// 그 상태에서 "함수가 없다" 고 거짓 실패한다. 이 검사는 같은 파일을 CRLF 로 바꿔 쓴 사본으로
// 공용 도우미가 동일한 조각을 돌려주는지 실제로 실행해 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  functionSource,
  normalizeLineEndings,
  readSourceLf,
  sourceSlice,
} = require('./source_slice_utils.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

function writeTemp(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-source-slice-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');
  return { dir, file };
}

test('CRLF 사본과 LF 원본에서 같은 함수 조각을 돌려준다', t => {
  const original = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.equal(original.includes('\r'), false, '저장소 원본은 LF 여야 합니다(.gitattributes eol=lf).');
  const crlf = writeTemp('app-core-03.crlf.js', original.replace(/\n/g, '\r\n'));
  t.after(() => fs.rmSync(crlf.dir, { recursive: true, force: true }));

  const fromLf = functionSource(original, 'competitorPromptReportIsCurrent');
  const fromCrlf = functionSource(readSourceLf(crlf.file), 'competitorPromptReportIsCurrent');
  assert.ok(fromLf, 'LF 원본에서 함수를 찾아야 합니다.');
  assert.equal(fromCrlf, fromLf);

  // 도우미 없이 읽으면 CRLF 사본에서는 옛 패턴이 실패한다 — 이 도우미가 필요한 이유.
  const raw = fs.readFileSync(crlf.file, 'utf8');
  assert.equal(raw.match(/function competitorPromptReportIsCurrent\([^]*?\n}\n/), null);
});

test('normalizeLineEndings 는 CRLF·CR 을 LF 로 바꾸고 LF 는 그대로 둔다', () => {
  assert.equal(normalizeLineEndings('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  assert.equal(normalizeLineEndings('a\nb'), 'a\nb');
});

test('sourceSlice 는 CRLF 입력에서도 LF 조각을 돌려주고, 표식이 없으면 던진다', () => {
  assert.equal(sourceSlice('x\r\nSTART\r\nbody\r\nEND\r\n', 'START', 'END'), 'START\nbody\n');
  assert.throws(() => sourceSlice('nothing', 'START', 'END'), /소스 조각 시작/);
  assert.throws(() => sourceSlice('START only', 'START', 'END'), /소스 조각 끝/);
});

test('functionSource 는 async 함수와 정규식 특수문자가 든 이름도 찾는다', () => {
  const source = 'function a$b() {\n  return 1;\n}\n\nasync function c() {\n  return 2;\n}\n';
  assert.equal(functionSource(source, 'a$b'), 'function a$b() {\n  return 1;\n}\n');
  assert.equal(functionSource(source, 'c'), 'async function c() {\n  return 2;\n}\n');
  assert.equal(functionSource(source, 'missing'), null);
});
