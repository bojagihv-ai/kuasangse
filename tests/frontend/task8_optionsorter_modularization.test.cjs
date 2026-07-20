const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MENU_DIRECTORY = path.join(ROOT, 'src', 'menus');

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

test('TASK8-OPTIONS-STRUCTURE: controller/contract/view 경계와 공개 API를 보존한다', async () => {
  const requiredModules = [
    'optionsorter-bindings.mjs',
    'optionsorter-contract.mjs',
    'optionsorter-controller.mjs',
    'optionsorter-state.mjs',
    'optionsorter-view.mjs',
  ];
  for (const file of requiredModules) {
    assert.equal(fs.existsSync(path.join(MENU_DIRECTORY, file)), true, `${file} is required`);
  }

  const namespace = await import(`${pathToFileURL(path.join(MENU_DIRECTORY, 'optionsorter-menu.mjs')).href}?task8=${Date.now()}`);
  assert.deepEqual(Object.keys(namespace), ['createOptionSorterMenu']);
  assert.equal(typeof namespace.createOptionSorterMenu, 'function');
});

test('TASK8-OPTIONS-SIZE: 옵션 정렬기 production ESM은 각각 250 pure LOC 이하이다', () => {
  const oversized = fs.readdirSync(MENU_DIRECTORY)
    .filter(file => /^optionsorter-.*\.mjs$/.test(file))
    .map(file => ({ file, lines: pureLoc(fs.readFileSync(path.join(MENU_DIRECTORY, file), 'utf8')) }))
    .filter(item => item.lines > 250);
  assert.deepEqual(oversized, [], oversized.map(item => `${item.file}: ${item.lines} pure LOC`).join('\n'));
});
