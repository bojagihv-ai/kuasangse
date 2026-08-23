'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = path.join(ROOT, 'src', 'app-core-03.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function freezeDetached(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDetached(child);
  return Object.freeze(value);
}

test('factory view snapshot freezes reconciled factory data before tab select', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const helperSource = sourceSlice(
    source,
    'function factoryReconcilePersistedStageState',
    '\nfunction normalizeFactoryState',
  );
  const viewSource = sourceSlice(
    source,
    'function factoryRuntimeCandidateRows(',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const factory = {
    product: {
      selectedDbCandidateKey: 'db-1',
      dbCandidates: [{ id: 'db-1' }],
      selectedCafe24CandidateKey: 'cafe24-1',
      cafe24Candidates: [{ id: 'cafe24-1' }],
    },
    stages: { db: { status: 'idle' }, detail: { status: 'idle' } },
    automation: { parallelProgress: {} },
    assets: [],
  };
  const context = vm.createContext({
    Date,
    state: { compPage: {}, sectionOrder: [] },
    orderedSections: () => [],
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => ({
      getSnapshot: () => ({ factory, competitors: { compPage: {} } }),
    }),
    factoryRuntimeDetachedValue: value => value,
    factoryRuntimeFreezeDetachedValue: freezeDetached,
  });
  vm.runInContext(`${helperSource}\n${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);

  const snapshot = context.readViewSnapshot();

  assert.equal(snapshot.factory.stages.db.status, 'done');
  assert.equal(Object.isFrozen(snapshot.factory), true);
  assert.equal(Object.isFrozen(snapshot.factory.stages), true);
  assert.equal(Object.isFrozen(snapshot.factory.automation.parallelProgress), true);
});
