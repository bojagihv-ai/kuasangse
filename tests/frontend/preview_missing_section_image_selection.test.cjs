const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-menu-view.mjs'), 'utf8');
const MENU = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-menu.mjs'), 'utf8');
const CORE05 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const CORE06 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
const CORE03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');

test('empty preview sections remain scroll targets and expose image placement choices', () => {
  const start = VIEW.indexOf('if (!content)');
  const missingPath = VIEW.slice(start, VIEW.indexOf('const c = content', start));
  assert.match(missingPath, /renderMissingPreviewSection\(s\)/);
  assert.match(VIEW, /const renderMissingPreviewSection[\s\S]*data-preview-section=/);
  assert.match(VIEW, /const renderMissingPreviewSection[\s\S]*data-open-image-insert=/);
  assert.match(VIEW, /const renderMissingPreviewSection[\s\S]*data-choose-section-placement/);
  assert.match(VIEW, /const renderMissingPreviewSection[\s\S]*sectionPlacementChoicesFromOptions/);
});

test('preview menu routes placement selection to a runtime action', () => {
  assert.equal(MENU.includes('chooseSectionPlacement'), true);
  assert.equal(MENU.includes('data-choose-section-placement'), true);
  assert.equal(CORE03.includes("currentScroller.scrollTo({ top: Math.max(0, top)"), true);
  assert.equal(CORE03.includes('chooseSectionPlacement(payload = {}, operationContext)'), true);
  assert.equal(CORE03.includes('function bindPreviewOutlineNavigation(root)'), true);
  assert.equal(CORE03.includes("root.addEventListener('click', handler, true)"), true);
  assert.equal(CORE03.includes('bindPreviewOutlineNavigation(document)'), true);
  assert.equal(CORE03.includes("dataset.previewSection || ''") , true);
  assert.equal(CORE03.includes('[120, 360, 800, 1400].forEach'), true);
});

test('missing-section local image inserts create content and remain manual', () => {
  assert.equal(CORE05.includes('ensureSectionContentForPlacedImage(sectionId'), true);
  assert.equal(CORE05.includes('placed_asset_manual = true'), true);
  assert.equal(CORE06.includes('placed_asset_manual === true'), true);
});

test('preview placement applies a resolved option asset to the target section', () => {
  assert.equal(CORE06.includes('function applyPreviewSectionPlacement(sectionId, placementValue'), true);
  assert.equal(CORE06.includes('resolveSectionPlacementAsset(placementValue)'), true);
  assert.equal(CORE06.includes('ensureSectionContentForPlacedImage(sectionId, asset)'), true);
});

test('restored option result images remain selectable after archive hydration', () => {
  const helperStart = CORE06.indexOf('function sectionPlacementChoicesFromOptions()');
  const helper = CORE06.slice(helperStart, CORE06.indexOf('function sectionPlacementChoicesFromSectionImages()', helperStart));
  assert.match(helper, /factoryOptionSorterResultImage\(result, factory\)/);
  assert.match(CORE06.slice(CORE06.indexOf('function getDefaultOptionPlacementValue()')), /factoryOptionSorterResultImage\(result, factory\)/);
});
