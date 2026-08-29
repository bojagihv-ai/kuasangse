'use strict';

// 회귀: 개별 박스 안에 스크롤을 만들어 내용을 잘라 두던 문제.
//
// 사용자 고정 UI 원칙(CLAUDE.md): 노드/범례/설정/카드/폼/옵션 리스트 같은 개별 요소에는
// 내부 스크롤을 만들지 않는다. 내용이 늘면 그 컴포넌트가 아래로 커지고, 스크롤은 전체
// 작업공간 하나만 둔다.
//
// 실제 피해: 2026-08-28 메뉴 전수 점검에서 이미지컷 실시간 로그가 170px 상자에 갇혀
//   1,706px(77줄) 중 10%만 보였다. 같은 패턴이 인라인 스타일로 9곳 남아 있었다.
//   CSS 클래스 쪽은 이미 정리돼 있었지만(.factory-run-status-card 는 max-height:none),
//   템플릿 문자열 안의 인라인 스타일이라 그 그물을 빠져나갔다.
//
// 계약: 런타임 소스의 인라인 스타일에 'max-height:<고정px> + overflow:auto' 조합을
//       새로 만들지 않는다. 뷰포트 기준(100vh 등)이나 자체 스크롤을 갖는 모달 껍데기는
//       전체 스크롤 하나에 해당하므로 이 규칙의 대상이 아니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

const RUNTIME_SOURCES = [
  'src/app-core-01.js',
  'src/app-core-02.js',
  'src/app-core-03.js',
  'src/app-core-04.js',
  'src/app-core-05.js',
  'src/app-core-06.js',
];

// 고정 px 한계와 자동 스크롤이 같은 style 속성 안에 함께 오는 경우만 잡는다.
// (calc(100vh - N) 처럼 뷰포트 기준인 것은 전체 스크롤이므로 제외된다.)
const FIXED_HEIGHT_THEN_SCROLL = /max-height:\s*\d+px[^"'`]{0,120}?overflow(?:-y)?:\s*(?:auto|scroll)/;
const SCROLL_THEN_FIXED_HEIGHT = /overflow(?:-y)?:\s*(?:auto|scroll)[^"'`]{0,120}?max-height:\s*\d+px/;

function styleAttributes(text) {
  // style="..." 안의 내용만 검사한다. 줄 번호를 함께 돌려준다.
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/style="([^"]*)"/g)) {
      found.push({ line: index + 1, css: match[1] });
    }
  });
  return found;
}

test('런타임 인라인 스타일은 개별 박스 내부 스크롤을 만들지 않는다', () => {
  const offenders = [];
  for (const relativePath of RUNTIME_SOURCES) {
    const absolute = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    for (const { line, css } of styleAttributes(text)) {
      if (FIXED_HEIGHT_THEN_SCROLL.test(css) || SCROLL_THEN_FIXED_HEIGHT.test(css)) {
        offenders.push(`${relativePath}:${line} → ${css.slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '개별 박스에 내부 스크롤을 만들면 내용이 잘려 보입니다. '
      + 'height:auto + overflow:visible 로 두고 전체 스크롤 하나만 쓰세요.\n'
      + offenders.join('\n'),
  );
});

test('정리한 9개 박스는 다시 고정 높이로 돌아가지 않는다', () => {
  // 2026-08-28 에 실제로 잘려 있던 자리들. 각 소스에서 해당 렌더러가 여전히
  // 스크롤 없이 그려지는지 대표 조각으로 확인한다.
  const core01 = fs.readFileSync(path.join(ROOT, 'src/app-core-01.js'), 'utf8');
  const core05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
  const core06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

  assert.doesNotMatch(core01, /overflow-y:auto;max-height:360px/, 'API 사용량 이력 표');
  assert.doesNotMatch(core05, /max-height:460px;overflow:auto/, '등록한 제품 리스트');
  assert.doesNotMatch(core05, /max-height:156px;overflow:auto/, '경쟁사 분석 로그');
  assert.doesNotMatch(core05, /max-height:170px;overflow:auto/, '섹션 생성 로그');
  assert.doesNotMatch(core05, /max-height:330px;overflow:auto/, '경쟁사 상세이미지 그리드');
  assert.doesNotMatch(core05, /max-height:120px;overflow:auto/, '시장수집 로그');
  assert.doesNotMatch(core06, /max-height:180px;overflow-y:auto/, '자동화 이벤트 로그');
  assert.doesNotMatch(core06, /max-height:260px;overflow:auto/, '생성 프롬프트 원문');
  assert.doesNotMatch(core06, /gap:7px;max-height:170px;overflow:auto/, '이미지컷 실시간 로그');

  // 이미지컷 로그는 실제로 존재하되 스크롤 없이 그려져야 한다.
  assert.match(core06, /이미지컷 실시간 로그/);
  assert.match(core06, /<div style="display:grid;gap:7px;overflow:visible">/);
});

test('후보 목록은 CSS 클래스로도 내부 스크롤 상자를 만들지 않는다', () => {
  // 이 검사는 원래 런타임 소스의 **인라인 스타일만** 훑었다. 그래서 app.html 의 CSS
  // 클래스로 선언된 상자를 통째로 놓쳤고, 2026-08-29 사용자 제보로 드러났다.
  //
  // 실제 피해: '이거 픽할때마다 화면이 위로 확확 튀는데 왜그래?'
  //   .factory-candidate-list 가 max-height:360px + overflow-y:auto 였다. 후보를 고르면
  //   목록이 다시 그려지면서 안쪽 스크롤이 맨 위로 떨어졌다.
  //   격리 브라우저 실측(PERF-04): 1061 -> 0.
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  const rule = /\.factory-candidate-list\s*\{([^}]*)\}/.exec(html);
  assert.ok(rule, '.factory-candidate-list 규칙을 찾지 못했습니다.');
  const css = rule[1];

  assert.doesNotMatch(css, /max-height:\s*\d+px/, '후보 목록에 고정 높이를 주면 내용이 잘립니다.');
  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/, '후보 목록에 자체 세로 스크롤을 만들면 고를 때마다 맨 위로 되돌아갑니다.');
  assert.match(css, /overflow-y:\s*visible/);
  assert.match(css, /height:\s*auto/);
});
