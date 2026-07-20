const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MENU_DIRECTORY = path.join(ROOT, 'src', 'menus');
const MODELSETTINGS_MODULES = Object.freeze([
  'modelsettings-config.mjs',
  'modelsettings-controller.mjs',
  'modelsettings-bindings.mjs',
  'modelsettings-view.mjs',
  'modelsettings-menu.mjs',
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

test('TASK8-MODELSETTINGS-STRUCTURE: config/controller/bindings/view 경계와 공개 API를 보존한다', async () => {
  for (const file of MODELSETTINGS_MODULES) {
    assert.equal(fs.existsSync(modulePath(file)), true, `${file} is required`);
  }

  const namespace = await import(`${pathToFileURL(modulePath('modelsettings-menu.mjs')).href}?task8=${Date.now()}`);
  assert.deepEqual(Object.keys(namespace), ['createModelSettingsMenu']);
  assert.equal(typeof namespace.createModelSettingsMenu, 'function');
});

test('TASK8-MODELSETTINGS-SIZE: 모델 설정 production ESM은 각각 250 pure LOC 이하이다', () => {
  const oversized = MODELSETTINGS_MODULES
    .map(file => ({ file, lines: pureLoc(fs.readFileSync(modulePath(file), 'utf8')) }))
    .filter(item => item.lines > 250);

  assert.deepEqual(oversized, [], oversized.map(item => `${item.file}: ${item.lines} pure LOC`).join('\n'));
});

test('TASK8-MODELSETTINGS-BOUNDARY: facade는 분리 모듈을 조립하고 global 상태를 읽지 않는다', () => {
  const facade = fs.readFileSync(modulePath('modelsettings-menu.mjs'), 'utf8');
  for (const dependency of MODELSETTINGS_MODULES.slice(0, -1)) {
    assert.match(facade, new RegExp(`from ['"]\\./${dependency.replace('.', '\\.')}['"]`));
  }

  for (const file of MODELSETTINGS_MODULES) {
    const source = fs.readFileSync(modulePath(file), 'utf8');
    assert.doesNotMatch(source, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/, file);
  }
});
