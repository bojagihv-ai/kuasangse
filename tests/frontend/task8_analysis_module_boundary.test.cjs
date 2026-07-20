const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MENU_DIRECTORY = path.join(ROOT, 'src', 'menus');
const ANALYSIS_MODULES = Object.freeze([
  'analysis-contract.mjs',
  'analysis-view.mjs',
  'analysis-panel-bindings.mjs',
  'analysis-controller.mjs',
  'analysis-menu.mjs',
]);

function modulePath(file) {
  return path.join(MENU_DIRECTORY, file);
}

function source(file) {
  return fs.readFileSync(modulePath(file), 'utf8');
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

test('TASK8-ANALYSIS-STRUCTURE: contract/view/panel/controller 경계와 공개 API를 보존한다', async () => {
  for (const file of ANALYSIS_MODULES) {
    assert.equal(fs.existsSync(modulePath(file)), true, `${file} is required`);
  }

  const namespace = await import(`${pathToFileURL(modulePath('analysis-menu.mjs')).href}?task8=${Date.now()}`);
  assert.deepEqual(Object.keys(namespace), ['createAnalysisMenu']);
  assert.equal(typeof namespace.createAnalysisMenu, 'function');

  const helper = Object.getOwnPropertyDescriptor(namespace.createAnalysisMenu, 'bindAnalysisPanelEvents');
  assert.equal(typeof helper?.value, 'function');
  assert.equal(helper.enumerable, false);
  assert.equal(helper.writable, false);
  assert.equal(helper.configurable, false);
});

test('TASK8-ANALYSIS-SIZE: 분석 메뉴 production ESM은 각각 250 pure LOC 이하이다', () => {
  const oversized = ANALYSIS_MODULES
    .map(file => ({ file, lines: pureLoc(source(file)) }))
    .filter(item => item.lines > 250);

  assert.deepEqual(oversized, [], oversized.map(item => `${item.file}: ${item.lines} pure LOC`).join('\n'));
});

test('TASK8-ANALYSIS-BOUNDARY: facade/controller는 책임별 모듈만 조립하고 global 상태를 읽지 않는다', () => {
  const facade = source('analysis-menu.mjs');
  assert.match(facade, /from ['"]\.\/analysis-controller\.mjs['"]/);
  assert.match(facade, /from ['"]\.\/analysis-panel-bindings\.mjs['"]/);

  const controller = source('analysis-controller.mjs');
  assert.match(controller, /from ['"]\.\/analysis-contract\.mjs['"]/);
  assert.match(controller, /from ['"]\.\/analysis-view\.mjs['"]/);

  for (const file of ANALYSIS_MODULES) {
    assert.doesNotMatch(
      source(file),
      /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/,
      file,
    );
  }
});
