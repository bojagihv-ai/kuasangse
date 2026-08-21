const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must be extractable`);
  return source.slice(start, end);
}

function loadOptionImageMerger() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  let functionSource = extract(
    source,
    'function mergeOptionSorterStoredImages(',
    '\nfunction mergeSameWorkDerivedValue(',
  );
  if (process.env.KUASANGSE_QUEUE_REPAIR_MUTATION === 'drop-option-images') {
    functionSource = functionSource.replace(
      ': mergeRows(current.images, incoming.images, imageKey)',
      ': mergeRows([], incoming.images, imageKey)',
    );
  }
  const context = vm.createContext({ optionSorterSlotNameIsGeneric: () => false });
  vm.runInContext(`${functionSource}\nthis.merge = mergeOptionSorterStoredImages;`, context);
  return context.merge;
}

function loadWaitingStage() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  let functionSource = extract(
    source,
    'function factoryRuntimeControlWaitingStage(',
    '\nfunction factoryRuntimeControlCheckpointProjectId(',
  );
  if (process.env.KUASANGSE_QUEUE_REPAIR_MUTATION === 'keep-stale-option-color') {
    functionSource = functionSource.replace(
      "payload.requiredValues?.optionMode === 'none'",
      'false',
    );
  }
  const context = vm.createContext({});
  vm.runInContext(`${functionSource}\nthis.waitingStage = factoryRuntimeControlWaitingStage;`, context);
  return context.waitingStage;
}

test('same-work restore keeps all four protected option images in the next projection', () => {
  // Given: A has four saved option-source images and a thin same-work restore has none.
  const saved = {
    images: [
      { id: 'base', archiveId: 'base-archive' },
      { id: 'green', archiveId: 'green-archive' },
      { id: 'red', archiveId: 'red-archive' },
      { id: 'yellow', archiveId: 'yellow-archive' },
    ],
    slots: [],
  };
  const thinRestore = { images: [], slots: [] };

  // When: the shared same-work option-sorter boundary creates the next saved projection.
  const projected = loadOptionImageMerger()(saved, thinRestore);

  // Then: protected image cardinality and identifiers do not decrease.
  assert.equal(projected.images.length, 4);
  assert.deepEqual(
    Array.from(projected.images, image => image.id),
    ['base', 'green', 'red', 'yellow'],
  );
});

test('optionMode none skips stale option_color without creating an option value', () => {
  // Given: B has no saved color value but a stale option_color stage precedes a valid manual stage.
  const projection = {
    stages: [
      { key: 'option_color', candidates: [{ id: 'unbacked-color' }], selectedIds: [] },
      { key: 'general', candidates: [{ id: 'saved-required-values' }], selectedIds: [] },
    ],
  };
  const payload = {
    requiredValues: {
      optionMode: 'none',
      material: 'ABS 플라스틱',
      usage: '책상 위 소품 정리',
    },
  };
  const before = structuredClone(payload);

  // When: the shared waiting-stage boundary normalizes the stale stage.
  const waitingStage = loadWaitingStage()(projection, payload);

  // Then: processing advances without inventing or writing an option value.
  assert.equal(waitingStage.key, 'general');
  assert.deepEqual(payload, before);
  assert.equal(Object.hasOwn(payload.requiredValues, 'optionValues'), false);
  assert.deepEqual(projection.stages[0].selectedIds, []);
});
