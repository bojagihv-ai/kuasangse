'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');

test('경쟁사 상태 정규화는 진행 중 VM 작업의 객체 정체성을 유지한다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const start = source.indexOf('function compMarketCommitNormalizedState(');
  const end = source.indexOf('function ensureCompMarketScrapeState(', start);
  assert.notEqual(start, -1, 'state identity helper must exist');
  assert.notEqual(end, -1, 'state identity helper boundary must exist');

  const context = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)}\nthis.commitState = compMarketCommitNormalizedState;`, context);

  const runningMarket = {
    loading: true,
    searchId: '',
    results: [],
    transientWorkerHandle: { id: 'bridge-job' },
  };
  const compPage = { marketScrape: runningMarket };
  const normalized = {
    ...runningMarket,
    searchId: 'search-current',
    results: [{ id: 'candidate-current' }],
  };

  const committed = context.commitState(compPage, runningMarket, normalized);

  assert.equal(committed, runningMarket);
  assert.equal(compPage.marketScrape, runningMarket);
  assert.equal(runningMarket.searchId, 'search-current');
  assert.deepEqual(
    JSON.parse(JSON.stringify(runningMarket.results)),
    [{ id: 'candidate-current' }],
  );
  assert.equal(runningMarket.transientWorkerHandle.id, 'bridge-job');
});
