const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const APP_CORE_03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const APP_CORE_05 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const APP_CORE_06 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
const OPTION_BINDINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'optionsorter-generation-bindings.mjs'),
  'utf8',
);
const FACTORY_ASSETS = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'assets-tab.mjs'),
  'utf8',
);
const FACTORY_BINDINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'assets-tab-bind.mjs'),
  'utf8',
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    if (source[index] === '(') parenDepth += 1;
    if (source[index] === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body must exist`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

test('group-shot state defaults to all source colors and normalizes stale custom selections', () => {
  // Given: a saved workfile has one valid color image and one stale selected id.
  const sandbox = {
    uid: prefix => `${prefix}_1`,
    clampOptionSheetCount: value => Number(value || 2),
    clampOptionSheetPixels: value => Number(value || 1246),
    optSyncSlotCountToImages() {},
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(APP_CORE_02, 'defaultOptionSorterState'),
    extractFunction(APP_CORE_02, 'normalizeOptionSorterState'),
  ].join('\n'), sandbox);

  // When: defaults and the saved workfile are normalized.
  const defaults = sandbox.defaultOptionSorterState();
  const normalized = sandbox.normalizeOptionSorterState({
    ...defaults,
    images: [{ id: 'red', name: '빨강' }],
    optionGroupShotSelectionMode: 'custom',
    optionGroupShotSelectedImageIds: ['red', 'deleted'],
    optionGroupShotRunning: true,
  });

  // Then: a new job selects every image, while reload retains only live custom ids.
  assert.equal(defaults.optionGroupShotSelectionMode, 'all');
  assert.deepEqual(Array.from(defaults.optionGroupShotSelectedImageIds), []);
  assert.equal(defaults.optionGroupShotTargetCount, 1);
  assert.deepEqual(Array.from(normalized.optionGroupShotSelectedImageIds), ['red']);
  assert.equal(normalized.optionGroupShotRunning, false);
});

test('group-shot generation is one result archived as options and linked to hero', () => {
  // Given/When: inspect the production generation and archive path.
  const generator = extractFunction(APP_CORE_06, 'optGenerateOptionGroupShot');
  const archiver = extractFunction(APP_CORE_06, 'factoryArchiveOptionSorterResultToWorkfile');
  const heroLinker = extractFunction(APP_CORE_06, 'factoryEnsureOptionGroupShotHeroAsset');
  const heroReferenceSync = extractFunction(APP_CORE_06, 'factorySyncOptionGroupShotHeroAssetReference');

  // Then: the model receives selected sources, emits one typed result, saves it once,
  // and links the archived source into the representative-image stage.
  assert.match(generator, /optGetGroupShotSelectedImages/);
  assert.match(generator, /generateWithSelectedImageModel/);
  assert.match(generator, /resultKind:\s*'color-group-shot'/);
  assert.match(generator, /optionGroupShotTargetCount/);
  assert.match(generator, /factoryArchiveOptionSorterResultToWorkfile/);
  assert.match(archiver, /factoryEnsureOptionGroupShotHeroAsset/);
  assert.match(heroLinker, /factoryRegisterAsset\('hero'/);
  assert.match(heroLinker, /optionGroupShotResultId/);
  assert.match(heroLinker, /skipLocalArchive:\s*true/);
  assert.doesNotMatch(heroLinker, /result\.heroAssetId\s*=/);
  assert.match(heroReferenceSync, /result\.heroAssetId\s*=/);
  assert.match(archiver, /factorySyncOptionGroupShotHeroAssetReference\(result,\s*receipt\.snapshot\?\.factory\)/);
  assert.match(APP_CORE_03, /factory\/optionsorter:archiveGeneratedResult[\s\S]*?previousAssets[\s\S]*?stages\.options[\s\S]*?stages\.hero[\s\S]*?runtimeAssetPrunedAt[\s\S]*?runtimeAssetPrunedCount/);
});

test('option sorter and factory expose the same group-shot controls without hidden actions', () => {
  // Given/When: inspect both menu surfaces and their delegated bindings.
  // Then: selection, prompt, generation, and representative-candidate status are reachable.
  assert.match(APP_CORE_06, /data-opt-group-shot-image/);
  assert.match(APP_CORE_06, /id="optGenerateGroupShot"/);
  assert.match(APP_CORE_06, /id="optGroupShotPrompt"/);
  assert.match(APP_CORE_06, /data-opt-group-shot-selected-count/);
  assert.match(APP_CORE_05, /renderOptionGroupShotPanel\(state\.optionSorter/);
  assert.match(OPTION_BINDINGS, /optSetGroupShotImageSelected/);
  assert.match(OPTION_BINDINGS, /optGenerateOptionGroupShot/);
  assert.match(FACTORY_ASSETS, /generateGroupShot/);
  assert.match(FACTORY_BINDINGS, /data-opt-group-shot-image/);
  assert.match(FACTORY_BINDINGS, /data-opt-group-shot-select-all/);
  assert.match(FACTORY_BINDINGS, /data-opt-group-shot-clear/);
});
