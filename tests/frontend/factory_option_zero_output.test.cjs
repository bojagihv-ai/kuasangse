'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return SOURCE.slice(start, end);
}

function createStageHarness(optionSorter, generate) {
  const events = [];
  const factory = { assets: [], stages: {} };
  const context = {
    state: { step: 'factory', optionSorter },
    optionSorterColorImagesDisabled: os => !!os.colorImagesDisabled,
    clearOptionColorSectionPlacement: () => events.push('clear-placement'),
    factorySetStageStatus: (_stage, status, message) => events.push({ status, message }),
    factoryLog: (message, level) => events.push({ level, message }),
    saveLastWorkNow: () => events.push('save'),
    render: () => events.push('render'),
    factoryRuntimeReadFactory: () => factory,
    factorySyncDbOptionsToOptionSorter: () => ({ ok: true, values: ['자주', '빨강'], plan: {} }),
    factoryStageGoalProgressRange: () => [30, 40],
    factorySetGoalRunProgress: () => {},
    factoryStartGoalHeartbeat: () => 'heartbeat',
    factoryStopGoalHeartbeat: () => events.push('stop-heartbeat'),
    optGenerateOptionImages: () => generate(context.state.optionSorter),
    factoryOptionSorterResultMatchesCurrentJob: () => ({ ok: true }),
    factoryOptionSorterResultImage: result => result.image || '',
    factoryFindOptionSorterResultAsset: () => null,
    factoryRegisterAsset: (_stage, image, options) => {
      const asset = { id: `asset_${factory.assets.length + 1}`, image, ...options };
      factory.assets.push(asset);
      return asset;
    },
    factorySyncOptionSorterResultAssetReference: () => {},
  };
  vm.createContext(context);
  vm.runInContext(sourceSlice('async function factoryGenerateOptionsStage(', 'async function factoryGenerateCutsStage('), context);
  return { context, events, factory };
}

function createGeneratorHarness() {
  const logs = [];
  const optionSorter = { images: [{ id: 'source', name: '자주' }], optionResults: [], optionContentMode: 'full_image', optionSheetMethod: 'locked_canvas' };
  const pair = { order: 1, optionName: '자주', img: optionSorter.images[0] };
  const context = {
    state: { step: 'factory', optionSorter },
    ensureOptionSorterDefaults: () => {},
    optionSorterColorImagesDisabled: () => false,
    getOptionImagePairs: () => [pair],
    optNextBatchNo: () => 1,
    optBatchLabel: () => 'A안',
    getOptionToneDisplayName: () => '기본 정돈',
    factoryEnsureArchiveStageRunId: () => {},
    factoryRuntimeReadFactory: () => ({}),
    factoryOptionResultCurrentScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => ['workspaceId'],
    optAppendLogs: (_os, message) => logs.push(message),
    optScheduleSave: () => {},
    render: () => {},
    waitForNextPaint: async () => {},
    hasLlmConnection: () => false,
    optEnsureImageColorHints: async () => {},
    getOptionOutputSheets: () => [{ index: 1, label: '1번', pairs: [pair], layout: '1x1' }],
    getOptionGenerationPipeline: () => ({ id: 'canvas', name: '캔버스', usesImageModel: false, usesAppText: false, engineLabel: '캔버스', harness: '' }),
    optGetActiveStyleSample: () => null,
    optGetActiveStyleSampleImagePart: () => null,
    optPairColorConflict: () => null,
    optGetSelectedLayoutPattern: () => ({ selectedLabel: '1x1', capacity: 1, selectedPattern: [1], selectedRows: 1, selectedCols: 1 }),
    optGetOptionSheetSize: () => ({ width: 100, height: 100, mode: 'auto' }),
    getCurrentImageRunInfo: () => ({}),
    buildOptionSelectionSheetPrompt: () => 'prompt',
    optComposeOptionSheetCanvas: async () => { throw new Error('자주 원본 이미지가 아직 복원되지 않았습니다.'); },
    optPersistGeneratedResultState: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(sourceSlice('async function optGenerateOptionImages(', 'function optDownloadOptionResult('), context);
  return { context, logs };
}

test('실제 생성기는 시트 실패가 0장일 때 원인을 실패 영수증으로 돌려준다', async () => {
  const { context, logs } = createGeneratorHarness();
  const receipt = await context.optGenerateOptionImages();
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, '자주 원본 이미지가 아직 복원되지 않았습니다.');
  assert.deepEqual(Array.from(receipt.generatedResultIds), []);
  assert.ok(logs.some(message => String(message).includes(receipt.reason)));
});

test('공정은 이번 실행 0장과 이전 결과를 구분해 실제 이유로 차단한다', async () => {
  const { context, events, factory } = createStageHarness(
    { images: [{ id: 'source' }], optionResults: [{ id: 'old-result', image: 'data:image/png;base64,old' }] },
    async () => ({ ok: false, reason: '자주 원본 이미지가 아직 복원되지 않았습니다.', generatedResultIds: [] }),
  );
  assert.equal(await context.factoryGenerateOptionsStage(), false);
  assert.equal(factory.assets.length, 0);
  assert.deepEqual(events.find(event => event?.status === 'blocked'), {
    status: 'blocked', message: '자주 원본 이미지가 아직 복원되지 않았습니다.',
  });
});

test('공정은 이번 실행의 이미지 영수증만 동기화하고 완료한다', async () => {
  const { context, events, factory } = createStageHarness(
    { images: [{ id: 'source' }], optionResults: [{ id: 'old-result', image: 'old' }] },
    async os => {
      os.optionResults.push({ id: 'new-result', image: 'data:image/png;base64,new', optionName: '자주' });
      return { ok: true, contentMode: 'full_image', generatedResultIds: ['new-result'] };
    },
  );
  assert.equal(await context.factoryGenerateOptionsStage(), true);
  assert.equal(factory.assets.length, 1);
  assert.equal(factory.assets[0].sourceMap.optionResultId, 'new-result');
  assert.deepEqual(events.find(event => event?.status === 'done'), {
    status: 'done', message: '1장 옵션표 생성/동기화',
  });

  const outOfScope = createStageHarness(
    { images: [{ id: 'source' }], optionResults: [{ id: 'old-result', image: 'old' }] },
    async os => {
      os.optionResults.push({ id: 'new-result', image: 'data:image/png;base64,new', optionName: '자주' });
      return { ok: true, contentMode: 'full_image', generatedResultIds: ['new-result'] };
    },
  );
  outOfScope.context.factoryOptionSorterResultMatchesCurrentJob = () => ({ ok: false });
  assert.equal(await outOfScope.context.factoryGenerateOptionsStage(), false);
  assert.equal(outOfScope.factory.assets.length, 0);
  assert.equal(outOfScope.events.find(event => event?.status === 'blocked').message, '생성된 옵션표가 현재 작업 범위의 이미지 후보로 확인되지 않았습니다.');
});

test('명시적 색상이미지 안씀과 text_only 결과는 이미지 0장이어도 유지한다', async () => {
  const skipped = createStageHarness({ colorImagesDisabled: true, images: [], optionResults: [] }, async () => {
    throw new Error('생성기를 호출하면 안 됩니다.');
  });
  assert.equal(await skipped.context.factoryGenerateOptionsStage(), true);
  assert.equal(skipped.factory.assets.length, 0);
  assert.equal(skipped.events.find(event => event?.status === 'done').message.includes('색상이미지 안씀'), true);

  const textOnly = createStageHarness({ images: [{ id: 'source' }], optionResults: [] }, async os => {
    os.optionResults.push({ id: 'text-result', optionName: '자주' });
    return { ok: true, contentMode: 'text_only', generatedResultIds: ['text-result'] };
  });
  assert.equal(await textOnly.context.factoryGenerateOptionsStage(), true);
  assert.equal(textOnly.factory.assets.length, 0);
  assert.equal(textOnly.events.find(event => event?.status === 'done').message, '1장 옵션표 생성/동기화');
});
