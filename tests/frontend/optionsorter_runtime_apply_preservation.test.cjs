const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'src/app-core-02.js'), 'utf8');
function extract(start, end) { return core.slice(core.indexOf(start), core.indexOf(end, core.indexOf(start))); }
const strip = extract('function stripOptionSorterImages(', '\nconst OPTION_SORTER_LIVE_RECOVERY_KEY');
const runtime = extract('function stripRuntimeAssetsForApply(', '\nfunction stripSectionImages');
const { stripOptionSorterImages, stripRuntimeAssetsForApply } = new Function(
  'runtimeExternalImageSrc', strip + runtime + '; return { stripOptionSorterImages, stripRuntimeAssetsForApply };'
)(() => '');
function fixture() {
  return {
    images: [{ id: 'color-2', name: '색동 2', base64: 'c291cmNl', preview: 'data:image/png;base64,c291cmNl',
      inputImageFingerprint: 'source-fingerprint', sourceImageKey: 'source-fingerprint',
      factoryColorImageId: 'color-2', colorHint: { id: 'pink', hex: '#dd7189' }, hasImageData: true }],
    optionResults: [{ id: 'sheet', image: 'sheet-bytes', archiveId: 'sheet-archive',
      splitImages: [{ image: 'split-one', hasImage: true }, { image: 'split-two', hasImage: true }] }],
  };
}
test('runtime apply keeps unarchived option sources and split bytes from a full saved payload', () => {
  const before = fixture();
  const after = stripRuntimeAssetsForApply({ optionSorter: before }).optionSorter;
  assert.equal(after.images[0].base64, before.images[0].base64, 'runtime hydration discarded the only source bytes');
  assert.equal(after.images[0].inputImageFingerprint, before.images[0].inputImageFingerprint);
  assert.deepEqual(after.optionResults[0].splitImages, before.optionResults[0].splitImages);
  assert.deepEqual(before, fixture(), 'serialization must not mutate the baseline');
});
test('durable compaction preserves unarchived source and split payloads beyond the recent limit', () => {
  const before = fixture();
  before.optionResults.push({ id: 'unarchived-result', image: 'only-result-bytes' });
  const after = stripOptionSorterImages(before, { preserveRecentResults: true, imageLimit: 0, resultLimit: 0 });
  assert.equal(after.images[0].base64, before.images[0].base64);
  assert.equal(after.optionResults[0].image, null, 'archived sheet can remain compact');
  assert.equal(after.optionResults[1].image, 'only-result-bytes');
  assert.deepEqual(after.optionResults[0].splitImages, before.optionResults[0].splitImages);
});
test('lightweight state retains source identity and color metadata for queue input restoration', () => {
  const before = fixture();
  const after = stripOptionSorterImages(before);
  for (const key of ['inputImageFingerprint', 'sourceImageKey', 'factoryColorImageId', 'colorHint']) {
    assert.deepEqual(after.images[0][key], before.images[0][key], 'lost restoration identity: ' + key);
  }
  assert.equal(after.images[0].base64, undefined, 'lightweight copies should not duplicate source bytes');
});

const merge = extract('function mergeOptionSorterStoredImages(', '\nfunction mergeSameWorkDerivedValue');
const recover = extract('function recoverStaleSessionInlineImages(', '\nfunction restoreCutsSourceFromCurrentProductImage');
function recoveryRuntime(current, scope = 'batch:current') {
  const state = structuredClone(current);
  const recoverStaleSessionInlineImages = new Function('state', 'lastWorkSnapshotMatchesCurrentWorkspace',
    'hasInlineImagePayload', 'normalizeOptionSorterState', 'optionSorterSlotNameIsGeneric',
    merge + recover + '; return recoverStaleSessionInlineImages;'
  )(state, assets => assets.workspaceScope.id === scope,
    (image, keys) => keys.some(key => !!image[key]), value => value, () => false);
  return { state, recoverStaleSessionInlineImages };
}
test('same-scope stale image recovery adds missing bytes without reducing current product, logs, sections or choices', () => {
  const original = fixture();
  const current = { optionSorter: stripOptionSorterImages(original), factory: {
    product: { finalDb: { weight: '15g' } }, logs: [{ message: 'new log' }],
    stages: { options: { selectedAssetIds: ['current-choice'] } }, assets: [{ id: 'current-asset' }],
  }, sectionContents: { header: 'current section' } };
  current.optionSorter.slots = [{ id: 'slot', name: '현재 색상명', imgIds: ['color-2'] }];
  const { state, recoverStaleSessionInlineImages } = recoveryRuntime(current);
  assert.equal(recoverStaleSessionInlineImages({ workspaceScope: { id: 'batch:current' }, optionSorter: original }), true);
  assert.equal(state.optionSorter.images[0].base64, original.images[0].base64);
  assert.deepEqual(state.optionSorter.optionResults[0].splitImages, original.optionResults[0].splitImages);
  assert.deepEqual(state.factory, current.factory);
  assert.deepEqual(state.sectionContents, current.sectionContents);
  assert.deepEqual(state.optionSorter.slots, current.optionSorter.slots);
});
test('stale image recovery rejects a different workspace without mutation', () => {
  const current = { optionSorter: stripOptionSorterImages(fixture()) };
  const { state, recoverStaleSessionInlineImages } = recoveryRuntime(current);
  assert.equal(recoverStaleSessionInlineImages({ workspaceScope: { id: 'batch:other' }, optionSorter: fixture() }), false);
  assert.deepEqual(state, current);
});
test('the existing queue input restoration can match an option source after lightweight serialization', () => {
  const controller = fs.readFileSync(path.join(root, 'src/app-core-03.js'), 'utf8');
  const start = controller.indexOf('function factoryRuntimeControlRestoreInputPayloads(');
  const body = controller.slice(start, controller.indexOf('function factoryRuntimeControlProvidedColorOptionValues(', start));
  const state = { optionSorter: stripOptionSorterImages(fixture()) };
  const restore = new Function('state', 'factoryImagePayloadFingerprint', body + '; return factoryRuntimeControlRestoreInputPayloads;')(
    state, () => 'source-fingerprint');
  restore({ product: {} }, [{ base64: 'c291cmNl', preview: 'data:image/png;base64,c291cmNl', mime: 'image/png' }]);
  assert.equal(state.optionSorter.images[0].base64, 'c291cmNl');
});
