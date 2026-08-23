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
      foreign: compMarketWorkKeysCompatible('work:project::run::product::image', 'other-run::other-product::other-image'),
      regeneratedRun: compMarketWorkKeysCompatible('work:project::run::product::image', 'other-run::product::image'),
      empty: compMarketWorkKeysCompatible('work:project::run::product::image', ''),
    };`, context);
  // regeneratedRun 은 의도된 호환이다. 경쟁사 run 을 다시 돌려도 같은 product/input 의
  // 담아둔 후보는 살아남아야 한다 (competitor_project_scope_hydration.test.cjs 의
  // 'same product and input candidate survives a regenerated competitor run prefix').
  // 음성 대조군은 product/image 자체가 다른 키로 둔다.
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    exact: true,
    legacy: true,
    reverseLegacy: true,
    foreign: false,
    regeneratedRun: true,
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
    'function factoryRuntimeCandidateRows(',
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
    // 같은 전역의 app-core-05 헬퍼. 실물은 competitor_project_scope_hydration 이 검증한다.
    compMarketSelectionIdsForVisibleRows: (selectedIds, previousRows, visibleRows) => {
      const visible = new Set((visibleRows || []).map((row, index) => String(row?.id || `row-${index}`)));
      return (selectedIds || []).filter(id => visible.has(String(id)));
    },
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeDetachedValue: value => value,
    factoryRuntimeFreezeDetachedValue: value => value,
  });
  vm.runInContext(`${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);
  const snapshot = context.readViewSnapshot();
  assert.deepEqual(snapshot.competitors.compPage.marketScrape.results, [{ id: 'saved-vm-1' }]);
  assert.deepEqual(snapshot.competitors.compPage.marketScrape.vmResults, [{ id: 'saved-vm-1' }]);
  assert.deepEqual(Array.from(snapshot.competitors.compPage.marketScrape.selectedIds), ['saved-vm-1']);
});

test('조립공장 화면 snapshot은 선택 버전이 없는 canonical 후보 mirror가 저장된 선택을 덮어쓰지 않는다', () => {
  const source03 = fs.readFileSync(CORE_03, 'utf8');
  const viewSource = sourceSlice(
    source03,
    'function factoryRuntimeCandidateRows(',
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
    // 같은 전역의 app-core-05 헬퍼. 실물은 competitor_project_scope_hydration 이 검증한다.
    compMarketSelectionIdsForVisibleRows: (selectedIds, previousRows, visibleRows) => {
      const visible = new Set((visibleRows || []).map((row, index) => String(row?.id || `row-${index}`)));
      return (selectedIds || []).filter(id => visible.has(String(id)));
    },
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeDetachedValue: value => value,
    factoryRuntimeFreezeDetachedValue: value => value,
  });
  vm.runInContext(`${viewSource}\nthis.readViewSnapshot = factoryRuntimeReadViewSnapshot;`, context);
  const snapshot = context.readViewSnapshot();
  assert.deepEqual(Array.from(snapshot.competitors.compPage.marketScrape.selectedIds), ['saved-vm-1']);
});

test('durable 작업파일의 후보 선택은 보관함 snapshot의 빈 선택으로 덮이지 않는다', () => {
  // 이 판단은 57d7370 에서 compMarketSelectedIdsForNormalizedState 로 추출됐다.
  // 호출부가 그 헬퍼에 위임하는지, 헬퍼가 실제로 저장된 선택을 우선하는지를 함께 본다.
  const callSite = sourceSlice(
    source,
    'const restoredSelectedIds =',
    'if (restoredRows.length) {',
  );
  assert.match(
    callSite,
    /compMarketSelectedIdsForNormalizedState\(\s*foreignWorkPayload,\s*persistedSelectedIds,\s*raw\.selectedIds,\s*\)/,
  );

  const helperSource = sourceSlice(
    source,
    'function compMarketSelectedIdsForNormalizedState(',
    'function ensureCompMarketScrapeState(',
  );
  assert.match(helperSource, /persistedSelectedIds\.size/);
  assert.match(helperSource, /Array\.from\(persistedSelectedIds\)/);

  const context = vm.createContext({});
  vm.runInContext(
    `${helperSource}
this.resolve = compMarketSelectedIdsForNormalizedState;`,
    context,
  );
  assert.deepEqual(
    Array.from(context.resolve(false, new Set(['durable-1']), [])),
    ['durable-1'],
    '보관함 snapshot의 빈 선택이 durable 작업파일의 선택을 덮으면 안 됩니다.',
  );
  assert.deepEqual(
    Array.from(context.resolve(false, new Set(), ['raw-1'])),
    ['raw-1'],
    '저장된 선택이 없을 때만 raw 선택으로 내려가야 합니다.',
  );
  assert.deepEqual(
    Array.from(context.resolve(true, new Set(['durable-1']), ['raw-1'])),
    [],
    '다른 작업의 payload면 어떤 선택도 이어받으면 안 됩니다.',
  );
});
