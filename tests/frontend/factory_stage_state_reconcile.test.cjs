'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = path.join(ROOT, 'src', 'app-core-03.js');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

function createReconcilerContext(state) {
  const source = fs.readFileSync(CORE, 'utf8');
  const helper = sourceSlice(
    source,
    'function factoryReconcilePersistedStageState',
    '\nfunction normalizeFactoryState',
  );
  const context = vm.createContext({
    Date,
    state,
    orderedSections: () => Object.keys(state.sectionContents || {}).map(id => ({ id })),
  });
  vm.runInContext(`${helper}\nthis.reconcile = factoryReconcilePersistedStageState;`, context);
  return context.reconcile;
}

test('복원된 DB/Cafe24 선택과 상세 섹션이 빈 공정 레일로 낮아지지 않는다', () => {
  const state = {
    sectionContents: {
      hero: { headline: '대표' },
      detail: { headline: '상세' },
    },
    sectionImages: {},
    sectionOrder: ['hero', 'detail', 'missing'],
    compPage: { marketScrape: { vmResults: [{ id: 'vm-1' }] } },
  };
  const reconcile = createReconcilerContext(state);
  const factory = {
    product: {
      selectedDbCandidateKey: 'db-1',
      selectedCafe24CandidateKey: 'cafe24-1',
      dbCandidates: [{ id: 'db-1' }, { id: 'db-2' }],
      cafe24Candidates: [{ id: 'cafe24-1' }, { id: 'cafe24-2' }],
    },
    stages: {
      db: { status: 'idle', targetCount: 1 },
      detail: { status: 'idle', targetCount: 1 },
    },
    automation: { parallelProgress: {} },
    assets: [],
  };

  const next = reconcile(factory);

  assert.equal(factory.stages.db.status, 'idle', 'A 상태 원본은 직접 바뀌면 안 됩니다.');
  assert.equal(next.stages.db.status, 'done');
  assert.equal(next.automation.parallelProgress.sinhwa.progress, 100);
  assert.equal(next.automation.parallelProgress.cafe24.progress, 100);
  assert.equal(next.automation.parallelProgress.vm.progress, 100);
  assert.equal(next.stages.detail.completedItemCount, 2);
  assert.equal(next.stages.detail.targetCount, 3);
  assert.equal(next.stages.detail.status, 'idle', '부분 상세 출력은 완료로 위장하지 않고 진행률만 복원해야 합니다.');
});

test('후보 선택 대기(review) 상태는 정규화에서 idle로 사라지지 않는다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const stageNormalizer = sourceSlice(
    source,
    'function normalizeFactoryStageState',
    '\nfunction factoryImageSrcFromString',
  );
  const context = vm.createContext({
    FACTORY_STAGE_DEFS: [{ id: 'db' }],
    defaultFactoryStageState: () => ({ db: { status: 'idle', targetCount: 1 } }),
  });
  vm.runInContext(`${stageNormalizer}\nthis.normalize = normalizeFactoryStageState;`, context);
  assert.equal(context.normalize({ db: { status: 'review' } }).db.status, 'review');
});
