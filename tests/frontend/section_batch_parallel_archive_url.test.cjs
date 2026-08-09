const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

test('local archive section URLs resolve against the backend origin instead of the app server', () => {
  const functions = sourceBetween(
    CORE_02,
    'function isDisplayableImageSrc',
    'function imageDataUrlHasUsablePayload',
  );
  const context = {
    factoryRuntimeArchiveImageUrl: ({ imageUrl }) => `http://127.0.0.1:5050${imageUrl}`,
  };
  vm.runInNewContext(`${functions}\nthis.resolveImage = displayableImageSrc;`, context);

  assert.equal(
    context.resolveImage('/api/local-archive/assets/archive-1/image'),
    'http://127.0.0.1:5050/api/local-archive/assets/archive-1/image',
  );
});

test('missing section batch starts at most two generation requests at once', async () => {
  const generateSelectedMissingSectionsSource = sourceBetween(
    CORE_06,
    'async function generateSelectedMissingSections',
    'function downloadTextFile',
  );
  const sections = [
    { id: 'header', name: '헤더' },
    { id: 'hook', name: '훅' },
    { id: 'features', name: '특징' },
    { id: 'shipping', name: '배송' },
  ];
  const controls = new Map();
  const started = [];
  let active = 0;
  let maxActive = 0;
  const state = {
    analysis: { product_name: '테스트' },
    sectionBatchRun: null,
    sectionBatchSelection: Object.fromEntries(sections.map(section => [section.id, true])),
    sectionContents: {},
    factory: null,
  };
  const context = {
    Promise,
    SECTIONS: sections,
    SECTION_BATCH_MAX_CONCURRENCY: 2,
    assertRuntimeOperationContextCurrent() {},
    ensureCurrentProductAnalysisForGeneration() {},
    productAnalysisGenerationBlockReason: () => '',
    selectedSectionIdsForBatch: () => sections.map(section => section.id),
    missingSectionIdsForBatch: () => sections.map(section => section.id),
    applySectionBatchGenerationOptions: () => ({
      basisLabel: '총합버전',
      generationLabel: '이미지+글자 전체 생성',
    }),
    sectionBatchStopRequested: () => false,
    finishSectionBatchAfterStop: () => true,
    sectionBatchProgressFor: (index, total, ratio = 0) => Math.round(((index + ratio) / total) * 100),
    startSectionBatchHeartbeat: () => 1,
    clearInterval() {},
    setTimeout: callback => {
      callback();
      return 1;
    },
    savePersistentState() {},
    render() {},
    updateSectionBatchRun(patch, log) {
      state.sectionBatchRun = {
        ...(state.sectionBatchRun || {}),
        ...patch,
        logs: log
          ? [log, ...(state.sectionBatchRun?.logs || [])]
          : (state.sectionBatchRun?.logs || []),
      };
      return state.sectionBatchRun;
    },
    generateSingleSection(sectionId) {
      started.push(sectionId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise(resolve => {
        controls.set(sectionId, () => {
          state.sectionContents[sectionId] = { headline: sectionId };
          active -= 1;
          resolve(true);
        });
      });
    },
    state,
    sectionBatchStopRequestedRunId: '',
  };
  vm.createContext(context);
  vm.runInContext(
    `${generateSelectedMissingSectionsSource}\nthis.runMissingSectionBatch = generateSelectedMissingSections;`,
    context,
  );

  const run = context.runMissingSectionBatch({ all: true, operationContext: { id: 'test-run' } });
  await nextTurn();
  assert.deepEqual(started, ['header', 'hook'], 'the first pair should start together');
  assert.equal(maxActive, 2);

  controls.get('header')();
  controls.get('hook')();
  await nextTurn();
  await nextTurn();
  assert.deepEqual(started, ['header', 'hook', 'features', 'shipping']);
  assert.equal(maxActive, 2, 'a third request must never overlap the active pair');

  controls.get('features')();
  controls.get('shipping')();
  assert.equal(await run, true);
  assert.equal(state.sectionBatchRun.status, 'done');
  assert.equal(state.sectionBatchRun.completed, 4);
});
