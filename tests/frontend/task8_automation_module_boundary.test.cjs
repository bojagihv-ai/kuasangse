const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MENU_DIRECTORY = path.join(ROOT, 'src', 'menus');
const AUTOMATION_MODULES = Object.freeze([
  'automation-contract.mjs',
  'automation-controller.mjs',
  'automation-bindings.mjs',
  'automation-view.mjs',
  'automation-menu.mjs',
]);

function modulePath(file) {
  return path.join(MENU_DIRECTORY, file);
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

test('TASK8-AUTOMATION-STRUCTURE: contract/controller/bindings/view 경계와 공개 API를 보존한다', async () => {
  for (const file of AUTOMATION_MODULES) {
    assert.equal(fs.existsSync(modulePath(file)), true, `${file} is required`);
  }

  const namespace = await import(`${pathToFileURL(modulePath('automation-menu.mjs')).href}?task8=${Date.now()}`);
  assert.deepEqual(Object.keys(namespace), ['createAutomationMenu']);
  assert.equal(typeof namespace.createAutomationMenu, 'function');
});

test('TASK8-AUTOMATION-SIZE: 자동화 production ESM은 각각 250 pure LOC 이하이다', () => {
  const oversized = AUTOMATION_MODULES
    .filter(file => fs.existsSync(modulePath(file)))
    .map(file => ({ file, lines: pureLoc(fs.readFileSync(modulePath(file), 'utf8')) }))
    .filter(item => item.lines > 250);

  assert.deepEqual(oversized, [], oversized.map(item => `${item.file}: ${item.lines} pure LOC`).join('\n'));
});

test('TASK8-AUTOMATION-BOUNDARY: facade는 분리 모듈을 조립하고 mutable global을 읽지 않는다', () => {
  const facade = fs.readFileSync(modulePath('automation-menu.mjs'), 'utf8');
  for (const dependency of AUTOMATION_MODULES.slice(0, -1)) {
    assert.match(facade, new RegExp(`from ['"]\\./${dependency.replace('.', '\\.')}['"]`));
  }

  for (const file of AUTOMATION_MODULES) {
    if (!fs.existsSync(modulePath(file))) continue;
    const source = fs.readFileSync(modulePath(file), 'utf8');
    assert.doesNotMatch(source, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/, file);
    assert.doesNotMatch(source, /\bstate\s*(?:\.|\[)/, file);
  }
});
