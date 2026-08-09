'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CORE = path.join(__dirname, '../../src/app-core-05.js');
const CORE_03 = path.join(__dirname, '../../src/app-core-03.js');
const source = fs.readFileSync(CORE, 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`source slice not found: ${startMarker}`);
  return text.slice(start, end);
}

test('저장본의 프로젝트 접두사 없는 VM 작업키는 같은 run/product/image/stage의 현재 작업키로 복원된다', () => {
  assert.match(source, /function compMarketWorkKeysCompatible\(/);
  const helperSource = sourceSlice(
    source,
    'function compMarketWorkKeysCompatible(',
    'function compMarketWorkScopeMatchesCurrent(',
  );
  const context = vm.createContext({});
  vm.runInContext(`${helperSource}
    this.result = {
      exact: compMarketWorkKeysCompatible('work:project::run::product::image', 'work:project::run::product::image'),
      legacy: compMarketWorkKeysCompatible('work:project::run::product::image', 'run::product::image'),
      reverseLegacy: compMarketWorkKeysCompatible('run::product::image', 'work:project::run::product::image'),
      foreign: compMarketWorkKeysCompatible('work:project::run::product::image', 'other-run::product::image'),
      empty: compMarketWorkKeysCompatible('work:project::run::product::image', ''),
    };`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    exact: true,
    legacy: true,
    reverseLegacy: true,
    foreign: false,
    empty: true,
  });

  const scopeSource = sourceSlice(
    source,
    'function compMarketWorkScopeMatchesCurrent(',
    'function compMarketApplyCurrentWorkScope(',
  );
  assert.match(scopeSource, /compMarketWorkKeysCompatible\(/);
  assert.match(source, /compMarketWorkKeysCompatible\(currentWorkKey, workKey\)/);
});

test('조립공장 화면 snapshot은 빈 canonical 후보 mirror가 저장된 factory 후보를 덮어쓰지 않는다', () => {
  const source03 = fs.readFileSync(CORE_03, 'utf8');
  const viewSource = sourceSlice(
    source03,
    'function factoryRuntimeReadViewSnapshot()',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const factory = {
    competitors: {
      compPage: {
        marketScrape: {
          results: [{ id: 'saved-vm-1' }],
          vmResults: [{ id: 'saved-vm-1' }],
          selectedIds: ['saved-vm-1'],
        },
      },
    },
  };
  const store = {
    getSnapshot: () => ({
      factory,
      competitors: {
        compPage: {
          marketScrape: {
            results: [],
            vmResults: [],
            selectedIds: [],
          },
        },
      },
    }),
  };
  const context = vm.createContext({
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeDetachedValue: value => value,
    factoryRuntimeFreezeDetachedValue: value => value,
  });
  vm.runInContext(`${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);
  const snapshot = context.readViewSnapshot();
  assert.deepEqual(snapshot.competitors.compPage.marketScrape.results, [{ id: 'saved-vm-1' }]);
  assert.deepEqual(snapshot.competitors.compPage.marketScrape.vmResults, [{ id: 'saved-vm-1' }]);
  assert.deepEqual(snapshot.competitors.compPage.marketScrape.selectedIds, ['saved-vm-1']);
});

test('조립공장 화면 snapshot은 선택 버전이 없는 canonical 후보 mirror가 저장된 선택을 덮어쓰지 않는다', () => {
  const source03 = fs.readFileSync(CORE_03, 'utf8');
  const viewSource = sourceSlice(
    source03,
    'function factoryRuntimeReadViewSnapshot()',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const factory = {
    competitors: {
      compPage: {
        marketScrape: {
          results: [{ id: 'saved-vm-1' }],
          vmResults: [{ id: 'saved-vm-1' }],
          selectedIds: ['saved-vm-1'],
          detailSelectionVersion: 0,
        },
      },
    },
  };
  const store = {
    getSnapshot: () => ({
      factory,
      competitors: {
        compPage: {
          marketScrape: {
            results: [{ id: 'saved-vm-1' }],
            vmResults: [{ id: 'saved-vm-1' }],
            selectedIds: [],
          },
        },
      },
    }),
  };
  const context = vm.createContext({
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeDetachedValue: value => value,
    factoryRuntimeFreezeDetachedValue: value => value,
  });
  vm.runInContext(`${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);
  const snapshot = context.readViewSnapshot();
  assert.deepEqual(snapshot.competitors.compPage.marketScrape.selectedIds, ['saved-vm-1']);
});

test('durable 작업파일의 후보 선택은 보관함 snapshot의 빈 선택으로 덮이지 않는다', () => {
  const restoreSource = sourceSlice(
    source,
    'const restoredSelectedIds =',
    'if (restoredRows.length) {',
  );
  assert.match(restoreSource, /persistedSelectedIds\.size/);
  assert.match(restoreSource, /Array\.from\(persistedSelectedIds\)/);
});
