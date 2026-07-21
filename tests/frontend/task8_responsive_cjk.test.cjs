const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_HTML = path.resolve(__dirname, '..', '..', 'app.html');
const css = fs.readFileSync(APP_HTML, 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\{[^}]*\\}`))?.[0] || '';
}

test('TASK8-RESPONSIVE-CJK: 전역 안내·제목·분석 카드가 한글 음절을 임의로 쪼개지 않는다', () => {
  for (const selector of ['.app-notice', '.page-title', '.page-desc', '.settings-section h3', '.analysis-box']) {
    const source = rule(selector);
    assert.notEqual(source, '', `${selector} CSS rule is missing`);
    assert.match(source, /word-break:keep-all/);
    assert.match(source, /overflow-wrap:normal/);
    assert.match(source, /line-break:strict/);
  }
});

test('TASK8-RESPONSIVE-CJK: 900px 이하 조립공장 탭은 두 열을 유지하면서 전체 라벨을 줄바꿈한다', () => {
  const mobileTabRule = [...css.matchAll(/\.factory-automation-tab\{[^}]*\}/g)]
    .map(match => match[0])
    .find(source => source.includes('flex:1 1 calc(50% - 6px)')) || '';
  assert.notEqual(mobileTabRule, '', 'mobile factory tab rule is missing');
  assert.match(mobileTabRule, /white-space:normal/);
  assert.match(mobileTabRule, /word-break:keep-all/);
  assert.match(mobileTabRule, /overflow-wrap:normal/);
  assert.match(mobileTabRule, /line-break:strict/);
  assert.match(mobileTabRule, /max-width:100%/);
});

test('TASK8-RESPONSIVE-CJK: 공장 설명 텍스트는 작은 폭에서도 CJK 단어를 보존한다', () => {
  const headingRules = [
    '.factory-section-head h3',
    '.factory-automation-panel h4',
  ];
  const copyRules = [
    '.factory-desc',
    '.factory-section-head p',
    '.factory-automation-panel p',
    '.factory-automation-note',
    '.factory-small',
  ];
  for (const selector of headingRules) {
    const source = rule(selector);
    assert.notEqual(source, '', `${selector} CSS rule is missing`);
    assert.match(source, /word-break:keep-all/);
    assert.match(source, /overflow-wrap:normal/);
    assert.match(source, /line-break:strict/);
  }
  for (const selector of copyRules) {
    const source = rule(selector);
    assert.notEqual(source, '', `${selector} CSS rule is missing`);
    assert.match(source, /word-break:keep-all/);
    assert.match(source, /overflow-wrap:break-word/);
    assert.match(source, /line-break:strict/);
  }
});

test('TASK8-SCROLL-OWNER: 앱 전체는 오른쪽 단일 스크롤로 사이드바와 본문 끝까지 도달한다', () => {
  const appRule = rule('.app');
  const sidebarRule = rule('.sidebar');
  const mainRule = rule('.main');
  assert.match(appRule, /height:100vh/);
  assert.match(appRule, /overflow-y:auto/);
  assert.match(appRule, /overflow-x:hidden/);
  assert.match(appRule, /scrollbar-gutter:stable/);
  assert.doesNotMatch(sidebarRule, /overflow-y:(?:auto|scroll)/);
  assert.doesNotMatch(mainRule, /overflow-y:(?:auto|scroll)/);
  assert.match(sidebarRule, /min-height:100vh/);

  const mobileSidebarRules = [...css.matchAll(/\.sidebar\{[^}]*\}/g)].map(match => match[0]);
  assert.equal(mobileSidebarRules.some(source => /overflow-y:(?:auto|scroll)/.test(source)), false);
});

test('TASK8-RESPONSIVE-CJK: 모바일 현재 화면 배너와 모델 크기 문구는 어절을 보존한다', () => {
  for (const selector of ['.mobile-step-copy', '.model-size-keep-ratio-note', '.model-size-summary']) {
    const source = rule(selector);
    assert.notEqual(source, '', `${selector} CSS rule is missing`);
    assert.match(source, /word-break:keep-all/);
    assert.match(source, /overflow-wrap:normal/);
    assert.match(source, /line-break:strict/);
  }
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?\.model-size-input-row\{grid-template-columns:minmax\(0,1fr\)\}/);
});
