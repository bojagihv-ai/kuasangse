'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable: ${startMarker}`);
  return source.slice(start, end);
}

test('경쟁사 후보가 더 풍부한 서버 snapshot은 옵션 상태가 더 풍부해도 복원 우선순위를 얻는다', () => {
  const source = fs.readFileSync(CORE_02, 'utf8');
  const scoreSource = sourceBetween(
    source,
    'function lastWorkCompMarketScore(',
    'function lastWorkSnapshotScore(',
  );
  const context = vm.createContext({});
  vm.runInContext(`${scoreSource}\nglobalThis.score = lastWorkCompMarketScore;`, context);

  const current = {
    compPage: { marketScrape: { vmResults: [], results: [], selectedIds: [] } },
  };
  const server = {
    compPage: {
      marketScrape: {
        vmResults: Array.from({ length: 14 }, (_, index) => ({ id: `vm-${index}` })),
        results: Array.from({ length: 14 }, (_, index) => ({ id: `result-${index}` })),
        selectedIds: ['vm-0'],
      },
    },
  };

  assert.ok(context.score(server) > context.score(current));
});
