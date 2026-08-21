'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = path.join(ROOT, 'src', 'app-core-02.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} definition is required`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} boundary is incomplete`);
}

test('candidate confirmation changes the canonical session asset fingerprint', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const fingerprintSource = extractFunction(source, 'sessionAssetSaveFingerprint');
  const canonicalFactory = {
    product: {
      selectedCafe24CandidateKey: '',
      cafe24CandidateResolution: '',
      pendingCafe24Candidates: [{ product_no: '2814', product_name: '천 호박 바늘쌈 바늘꽂이' }],
    },
    assets: [],
  };
  const context = vm.createContext({
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
    state: {
      factory: {
        product: {
          selectedCafe24CandidateKey: '',
          cafe24CandidateResolution: '',
        },
      },
      analysisImages: [],
      sectionImages: {},
      detailImageBlocks: [],
      sectionVariants: {},
      aiRepairUndoStack: {},
      cuts: {},
      optionSorter: {},
      compPage: {},
    },
    factoryRuntimeReadCommittedFactory: () => canonicalFactory,
  });
  vm.runInContext(`${fingerprintSource}
    globalThis.fingerprint = sessionAssetSaveFingerprint;
  `, context);

  const before = context.fingerprint();
  canonicalFactory.product.selectedCafe24CandidateKey = '2814';
  canonicalFactory.product.confirmedCafe24ProductKey = '2814';
  canonicalFactory.product.cafe24CandidateResolution = 'selected';
  const after = context.fingerprint();

  assert.notEqual(after, before);
  assert.equal(JSON.parse(after).factory.candidateReview.selectedCafe24CandidateKey, '2814');
  assert.equal(
    JSON.parse(after).factory.candidateReview.pendingCafe24Candidates[0],
    '2814',
    'candidate list identity must participate in the persistence boundary',
  );
});

test('new-work product identity changes the canonical session asset fingerprint', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const fingerprintSource = extractFunction(source, 'sessionAssetSaveFingerprint');
  const state = {
    productName: '',
    currentProjectId: '',
    currentProjectName: '',
    step: 'factory',
    factory: { product: {}, assets: [] },
    analysisImages: [], sectionImages: {}, detailImageBlocks: [], sectionVariants: {},
    aiRepairUndoStack: {}, cuts: {}, optionSorter: {}, compPage: {},
  };
  const context = vm.createContext({
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
    state,
    factoryRuntimeReadCommittedFactory: () => state.factory,
  });
  vm.runInContext(`${fingerprintSource}\n    globalThis.fingerprint = sessionAssetSaveFingerprint;\n  `, context);

  const before = context.fingerprint();
  state.productName = '새 작업 상품';
  const after = context.fingerprint();

  assert.notEqual(after, before, 'product-only edits must not reuse an empty session asset record');
  assert.equal(JSON.parse(after).productIdentity.productName, '새 작업 상품');
});

test('option slot label and assignment changes change the canonical session asset fingerprint', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const fingerprintSource = extractFunction(source, 'sessionAssetSaveFingerprint');
  const state = {
    productName: '옵션 상품',
    currentProjectId: '',
    currentProjectName: '',
    step: 'optionsorter',
    factory: { product: {}, assets: [] },
    analysisImages: [], sectionImages: {}, detailImageBlocks: [], sectionVariants: [],
    aiRepairUndoStack: {}, cuts: {},
    optionSorter: { slots: [{ id: 'slot_1', name: '1번', imgIds: [] }], images: [], optionResults: [] },
    compPage: {},
  };
  const context = vm.createContext({
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
    state,
    factoryRuntimeReadCommittedFactory: () => state.factory,
  });
  vm.runInContext(`${fingerprintSource}\n    globalThis.fingerprint = sessionAssetSaveFingerprint;\n  `, context);

  const before = context.fingerprint();
  state.optionSorter.slots[0].name = '1.빨강';
  state.optionSorter.slots[0].imgIds = ['img-red'];
  const after = context.fingerprint();

  assert.notEqual(after, before, 'slot labels and assignments must reach the session asset save boundary');
  assert.deepEqual(JSON.parse(after).optionSorter.slots[0], ['slot_1', '1.빨강', ['img-red']]);
});
