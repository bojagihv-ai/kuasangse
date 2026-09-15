'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isDeepStrictEqual } = require('node:util');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '../..');
const core3 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const core6 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function original(source, name) {
  const marker = `${source.includes(`async function ${name}(`) ? 'async ' : ''}function ${name}(`;
  const start = source.indexOf(marker);
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}

test('options uses the goal-owned draft: original stage/generator/archive keep hero4 + size3 + option1', async () => {
  const { createFactoryDraftUpdater } = await import(pathToFileURL(path.join(ROOT, 'src/modules/factory-store-draft.mjs')));
  const { immutableCopy } = await import(pathToFileURL(path.join(ROOT, 'src/modules/factory-store-data.mjs')));
  const heroIds = ['factory_hero_mty32bc0_zwtoc5', 'factory_hero_mty32bbz_uvik4p', 'factory_hero_mty32bbz_h3cg6t', 'factory_hero_mty32bbz_3yi0e7'];
  const sizeIds = ['factory_size_mtynloy3_cpkt6c', 'factory_size_mtynloy3_2ak3ej', 'factory_size_mtynloy3_xxy7ba'];
  const saved = process.env.OPTIONS_SAVED_A_FIXTURE ? JSON.parse(fs.readFileSync(process.env.OPTIONS_SAVED_A_FIXTURE, 'utf8')).assets : null;
  const product = saved?.factory.product || { productName: 'scope-C', productKey: 'scope-C', currentRunId: 'workflow-run', inputImageFingerprint: 'input-C', width: 150, depth: 80, price: 2000, stock: 99 };
  const analysis = saved?.compPage.analysisResult || { sections: [{ id: 'kept-section' }], criteria: ['kept-criterion'] };
  const factory = saved ? clone(saved.factory) : { product, assets: heroIds.map(id => ({ id, stageId: 'hero' })), previousAssets: [], stages: { options: { status: 'idle' } }, archive: { stageRunIds: {} } };
  const sizeAssets = saved ? saved.factory.assets.filter(a => sizeIds.includes(a.id)) : sizeIds.map(id => ({ id, stageId: 'size' }));
  factory.assets = factory.assets.filter(a => heroIds.includes(a.id));
  let snapshot = { factory, analysis };
  let revision = 0;
  let token = { workspaceId: 'workspace-C', fence: 1, revision };
  const commits = [];
  // Authorization and I/O are fixture adapters; draft cloning/revocation/rebase are the real module.
  const updateDraft = createFactoryDraftUpdater({
    assertMutable: () => {}, ensureActive: () => {}, commandPolicies: new Map(),
    authorizeCommandMutation: () => { throw new Error('unexpected policy adapter'); },
    authorizeMutation: metadata => ({ mutation: { owner: 'factory', path: 'factory', expectedRevision: metadata.expectedRevision }, context: {} }),
    hasActiveOperationLease: () => true, getOperationToken: () => token,
    getRevision: () => revision, getSnapshot: () => snapshot,
    commit: next => { snapshot = immutableCopy(next); token = { ...token, revision: ++revision }; commits.push(snapshot.factory.assets.map(a => a.id)); return snapshot; },
  });
  const store = { getOperationToken: () => token, hasActiveOperationLease: () => true, updateDraft: (mutator, metadata, _command, options) => updateDraft(mutator, metadata, '', options) };
  const logs = [];
  const pair = { order: 1, optionName: 'white', img: { id: 'source', name: 'white' } };
  const os = { images: [pair.img], optionResults: [], optionContentMode: 'full_image', optionSheetMethod: 'locked_canvas', optionTonePresetId: 'basic' };
  const context = {
    state: { step: 'factory', currentProjectId: 'workspace-C', optionSorter: os },
    factoryRuntimeStore: store, factoryRuntimeRequireStore: () => store,
    factoryRuntimeReadFactory: () => snapshot.factory, factoryRuntimeIsOperationCurrent: candidate => candidate === token,
    uid: prefix => `${prefix}_fixture`, factorySetStageStatus: (stage, status, message, factory) => { factory.stages[stage] = { ...factory.stages[stage], status, message }; },
    factoryLog: message => logs.push(message), saveLastWorkNow: () => {}, render: () => {},
    factorySyncDbOptionsToOptionSorter: () => ({ ok: true, values: ['white'], plan: {} }),
    factoryStageGoalProgressRange: () => [30, 40], factorySetGoalRunProgress: () => {},
    factoryStartGoalHeartbeat: () => 1, factoryStopGoalHeartbeat: () => {},
    optionSorterColorImagesDisabled: () => false, ensureOptionSorterDefaults: () => {},
    getOptionImagePairs: () => [pair], optNextBatchNo: () => 1, optBatchLabel: () => 'A', getOptionToneDisplayName: () => 'basic',
    optAppendLogs: (_os, message) => logs.push(message), optScheduleSave: () => {}, waitForNextPaint: async () => {},
    hasLlmConnection: () => false, optEnsureImageColorHints: async () => {},
    getOptionOutputSheets: () => [{ index: 1, label: 'sheet', pairs: [pair], layout: '1x1' }],
    getOptionGenerationPipeline: () => ({ id: 'canvas', name: 'canvas', usesImageModel: false, usesAppText: false, engineLabel: 'canvas' }),
    optGetActiveStyleSample: () => null, optGetActiveStyleSampleImagePart: () => null, optPairColorConflict: () => null,
    optGetSelectedLayoutPattern: () => ({ selectedLabel: '1x1', capacity: 1, selectedPattern: [1], selectedRows: 1, selectedCols: 1 }),
    optGetOptionSheetSize: () => ({ width: 100, height: 100 }), getCurrentImageRunInfo: () => ({}),
    buildOptionSelectionSheetPrompt: () => 'fixture prompt', optComposeOptionSheetCanvas: async () => 'data:image/png;base64,fixture',
    optGetGroupShotSelectedImages: () => os.images, hasImageConnection: () => true,
    buildOptionGroupShotPrompt: () => 'group fixture prompt', optImageDataPart: async () => ({ base64: 'fixture', mime: 'image/png' }),
    generateWithSelectedImageModel: async () => 'data:image/png;base64,group-fixture',
    optBuildOptionGenerationDetails: () => ({}), optSplitOptionSheetResultImage: async () => [],
    optDataUrlToImagePart: () => null, optPersistGeneratedResultState: async () => {},
    factoryCoerceImageSrc: values => values.find(value => typeof value === 'string' && value) || '',
    factoryRegisterAsset: (stageId, image, options) => {
      const count = options.factory.assets.filter(a => a.stageId === 'options').length;
      const id = stageId === 'hero' ? 'group-hero-fixture' : count ? `option-fixture-${count + 1}` : 'option-fixture';
      const asset = { id, stageId, image, currentRunId: options.currentRunId, sourceMap: clone(options.sourceMap || {}) };
      options.factory.assets.push(asset); return asset;
    },
    factoryQueueLocalArchiveAsset: async asset => { asset.archiveId = 'fixture-archive'; return true; },
    factorySyncOptionSorterResultAssetReference: asset => { const result = os.optionResults.find(r => r.id === asset.sourceMap.optionResultId); if (result) result.resultAssetId = asset.id; },
  };
  const names3 = ['factoryNormalizeIdentityText', 'factoryIdentityKeysCompatible', 'factoryNormalizeStageScope', 'factoryCurrentWorkspaceId', 'factoryCurrentProductKey', 'factoryLockedInputImageFingerprint', 'factoryCurrentInputImageFingerprint', 'factoryCurrentStageRunId', 'factoryCurrentWorkflowRunId', 'factoryCurrentJobKey', 'factoryJobProductKeysCompatible', 'factoryJobKeyMismatch', 'factoryRuntimeUpdateOwnedFactory'];
  const names6 = ['factoryGenerateOptionsStage', 'optGenerateOptionImages', 'optGenerateOptionGroupShot', 'factoryEnsureArchiveStageRunId', 'factoryArchiveOptionSorterResultToWorkfile', 'factoryEnsureOptionGroupShotHeroAsset', 'factorySyncOptionGroupShotHeroAssetReference', 'factoryOptionResultScope', 'factoryOptionResultScopeMissingFields', 'factoryOptionResultCurrentScope', 'factoryOptionSorterResultMatchesCurrentJob', 'factoryFindOptionSorterResultAsset', 'factoryOptionSorterResultImage'];
  const constants = core3.slice(core3.indexOf('var factoryRuntimeOwnedRenderDraft = null;'), core3.indexOf('\nfunction factoryRuntimeDeferredOperationsPending('));
  const source = constants + names3.map(n => original(core3, n)).join('\n') + names6.map(n => original(core6, n)).join('\n');
  const runtime = Function('context', `with (context) { ${source}; return { factoryGenerateOptionsStage, factoryOptionSorterResultMatchesCurrentJob, optGenerateOptionImages, optGenerateOptionGroupShot, factoryArchiveOptionSorterResultToWorkfile }; }`)(context);
  let beforeIds;
  let receiptScope;
  const receipt = await updateDraft(async draft => {
    draft.assets.push(...clone(sizeAssets));
    beforeIds = draft.assets.map(a => a.id);
    const result = await runtime.factoryGenerateOptionsStage({ factory: draft });
    receiptScope = runtime.factoryOptionSorterResultMatchesCurrentJob(os.optionResults[0], draft);
    return result;
  }, { expectedRevision: revision }, '', { rebaseOnStale: true });
  const afterIds = snapshot.factory.assets.map(a => a.id);
  console.log(JSON.stringify({ result: receipt.result, beforeIds, afterIds, mismatches: receiptScope.mismatches, commits, failure: logs.filter(m => typeof m === 'string' && m.startsWith('색상옵션 생성 실패:')) }));
  assert.ok(isDeepStrictEqual(snapshot.factory.product, product), 'all original product fields preserved');
  assert.ok(isDeepStrictEqual(snapshot.analysis, analysis), 'all original analysis preserved');
  assert.equal(receipt.result, true);
  assert.deepEqual(afterIds, [...heroIds, ...sizeIds, 'option-fixture']);
  assert.equal(receiptScope.ok, true);
  assert.equal(os.optionResults.length, 1);
  assert.equal(os.optionResults[0].resultAssetId, 'option-fixture');
  if (saved) for (const asset of saved.factory.assets) {
    assert.ok(isDeepStrictEqual(snapshot.factory.assets.find(a => a.id === asset.id), asset), `original asset unchanged: ${asset.id}`);
  }
  assert.equal(os.optionResults[0].resultKind, undefined, 'the options stage generates grid results, not group shots');
  const manualGrid = await runtime.optGenerateOptionImages();
  assert.equal(manualGrid.ok, true);
  assert.equal(snapshot.factory.assets.length, 9);
  assert.equal(os.optionResults[1].resultAssetId, 'option-fixture-2');
  const group = await runtime.optGenerateOptionGroupShot();
  assert.ok(group, 'original group-shot generator succeeded');
  assert.equal(group.resultKind, 'color-group-shot');
  assert.equal(group.heroAssetId, 'group-hero-fixture');
  assert.equal(group.resultAssetId, 'option-fixture-3');
  assert.equal(snapshot.factory.assets.length, 11, 'one option asset and one group hero added');
  await runtime.factoryArchiveOptionSorterResultToWorkfile(group);
  assert.equal(snapshot.factory.assets.length, 11, 'repeat archive adds no duplicate option or hero');
  assert.equal(new Set(snapshot.factory.assets.map(a => a.id)).size, 11);
  console.log(JSON.stringify({ manualGrid: manualGrid.ok, groupHeroLinked: group.heroAssetId === 'group-hero-fixture', groupOptionLinked: group.resultAssetId === 'option-fixture-3', duplicateCount: 0 }));
});
