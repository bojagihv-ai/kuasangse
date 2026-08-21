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

test('compact archive-backed option source keeps its durable restore marker', () => {
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

  const normalized = sandbox.normalizeOptionSorterState({
    ...sandbox.defaultOptionSorterState(),
    images: [{
      id: 'source-1',
      archiveId: 'archive-source-1',
      imageUrl: '/api/local-archive/assets/archive-source-1/image',
      imagePersistence: 'session-recent-inline',
      localArchive: { archiveId: 'archive-source-1', saved: true },
    }],
  });

  assert.equal(normalized.images.length, 1);
  assert.equal(normalized.images[0].archiveId, 'archive-source-1');
  assert.equal(normalized.images[0].imagePersistence, 'local-archive-url');
});

test('legacy same-work snapshot with mapped options reopens the matching stage', () => {
  // Given: an older snapshot kept the initial screen marker although matching work exists.
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

  // When: the legacy same-work state is normalized during hydration.
  const normalized = sandbox.normalizeOptionSorterState({
    ...sandbox.defaultOptionSorterState(),
    images: [{ id: 'red' }],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['red'] }],
    optionResults: [{ id: 'result_1', imageUrl: '/saved-result.png' }],
    subStep: 'input',
  });

  // Then: the richer matching stage is shown instead of hiding completed work.
  assert.equal(normalized.subStep, 'sort');
});

test('newer explicit image-change request keeps the option input stage', () => {
  // Given: the user explicitly chose to return to the image input stage after matching.
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

  // When: the explicitly timestamped input state is normalized.
  const normalized = sandbox.normalizeOptionSorterState({
    ...sandbox.defaultOptionSorterState(),
    images: [{ id: 'red' }],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['red'] }],
    optionResults: [{ id: 'result_1', imageUrl: '/saved-result.png' }],
    subStep: 'input',
    subStepUpdatedAt: 200,
  });

  // Then: automatic recovery does not override the user's newer explicit choice.
  assert.equal(normalized.subStep, 'input');
});

test('same-work merge does not let an older input marker hide the matching stage', () => {
  // Given: the current tab is in matching, while a thin incoming snapshot still says input.
  const sandbox = {
    optionSorterSlotNameIsGeneric: value => /^\d+번$/.test(String(value || '').trim()),
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_02, 'mergeOptionSorterStoredImages'), sandbox);

  // When: same-work option state is merged.
  const merged = sandbox.mergeOptionSorterStoredImages({
    images: [{ id: 'red' }],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['red'] }],
    optionResults: [{ id: 'result_1' }],
    subStep: 'sort',
    subStepUpdatedAt: 100,
  }, {
    images: [{ id: 'red' }],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['red'] }],
    optionResults: [{ id: 'result_1' }],
    subStep: 'input',
  });

  // Then: the older stage marker cannot hide the matching workspace.
  assert.equal(merged.subStep, 'sort');
  assert.equal(merged.subStepUpdatedAt, 100);
});

test('same archived option source keeps one image identity across archive and snapshot restore', () => {
  const sandbox = {
    optionSorterSlotNameIsGeneric: value => /^\d+번$/.test(String(value || '').trim()),
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_02, 'mergeOptionSorterStoredImages'), sandbox);

  const merged = sandbox.mergeOptionSorterStoredImages({
    images: [{ id: 'oi_archive_1', archiveId: 'archive-1', imageUrl: '/archive-1' }],
    pool: ['oi_archive_1'],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['oi_archive_1'] }],
  }, {
    images: [{ id: 'oi_saved_1', archiveId: 'archive-1', imageUrl: '/archive-1' }],
    pool: ['oi_saved_1'],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['oi_saved_1'] }],
  });

  assert.deepEqual(Array.from(merged.images, image => image.id), ['oi_archive_1']);
  assert.deepEqual(Array.from(merged.pool), ['oi_archive_1']);
  assert.deepEqual(Array.from(merged.slots[0].imgIds), ['oi_archive_1']);
  assert.equal(merged.images[0].imagePersistence, 'local-archive-url');
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
