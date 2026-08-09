const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('생성 결과 화면마다 분류된 로컬 보관 폴더 열기 제어를 제공한다', () => {
  const factoryAssets = read('src', 'app-core-05.js');
  const runtime = read('src', 'app-core-06.js');
  const cuts = read('src', 'menus', 'imagecuts-view-results.mjs');
  const sections = read('src', 'menus', 'sections-menu-view.mjs');
  const preview = read('src', 'menus', 'preview-menu-view.mjs');
  const optionSorter = read('src', 'menus', 'optionsorter-view.mjs');

  assert.match(factoryAssets, /data-factory-open-local-archive-folder/);
  assert.match(factoryAssets, /data-factory-local-archive-id/);
  assert.match(runtime, /async function factoryOpenLocalArchiveFolder\(/);
  assert.match(runtime, /\/api\/local-archive\/folders\/open/);
  assert.match(runtime, /factory\/archive:setLocalShowAll/);
  assert.match(runtime, /data-factory-open-local-archive-folder/);
  assert.match(runtime, /bindFactoryLocalArchiveFolderOpenDelegation\(\)/);
  assert.match(cuts, /data-factory-open-local-archive-folder="cuts"/);
  assert.match(cuts, /data-factory-open-local-archive-folder="size"/);
  assert.match(sections, /data-factory-open-local-archive-folder="section_header"/);
  assert.match(preview, /data-factory-open-local-archive-folder="section_header"/);
  assert.match(optionSorter, /data-factory-open-local-archive-folder="options"/);
});
