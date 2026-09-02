'use strict';
// 소스를 문자열로 읽어 검사하는 테스트의 공용 도우미.
//
// 왜 있나: core.autocrlf=true 인 윈도우 체크아웃에서 작업본이 CRLF 가 되면, `\n}\n` 같은
// 패턴으로 함수 끝을 찾는 검사가 "함수가 없다" 고 거짓 실패한다(DETAIL-11, 2026-08-21 /
// 2026-09-02 재발). 저장소는 .gitattributes 로 LF 를 못박았지만, 이미 CRLF 로 내려받은
// 작업본(app-core-01/cafe24-api/cafe24-sync 가 원본 작업 트리에서 w/crlf·mixed 로 실측)에는
// 그 규칙이 소급되지 않는다. 그래서 읽는 쪽에서 줄 끝을 LF 로 정규화해 검사 결과가
// 체크아웃 설정과 무관하게 같도록 한다.
const fs = require('node:fs');

function normalizeLineEndings(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

// 파일을 읽고 CRLF/CR 을 LF 로 정규화해 돌려준다.
function readSourceLf(filePath) {
  return normalizeLineEndings(fs.readFileSync(filePath, 'utf8'));
}

// startMarker 부터 endMarker 직전까지 잘라 준다. 둘 중 하나라도 없으면 던진다.
function sourceSlice(text, startMarker, endMarker) {
  const source = normalizeLineEndings(text);
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`소스 조각 시작을 찾지 못했습니다: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end < 0) throw new Error(`소스 조각 끝을 찾지 못했습니다: ${endMarker}`);
  return source.slice(start, end);
}

// 최상위 `function name(` 선언을 시작으로, 들여쓰기 없는 `}` 줄까지를 함수 본문으로 돌려준다.
// 정규식 `\n}\n` 을 각 테스트가 따로 적지 않게 하려는 것. 못 찾으면 null.
function functionSource(text, name) {
  const source = normalizeLineEndings(text);
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(?:^|\\n)((?:async\\s+)?function\\s+' + escaped + '\\s*\\([^]*?\\n\\}\\n)');
  const match = source.match(pattern);
  return match ? match[1] : null;
}

module.exports = {
  functionSource,
  normalizeLineEndings,
  readSourceLf,
  sourceSlice,
};
