'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('렌더·자동저장 예산은 실제 측정값만 판정하고 초과 구간을 구분한다', () => {
  const context = vm.createContext({ Math, Number });
  vm.runInContext(`${extractFunction(CORE_02, 'runtimePerformanceBudgetModel')}\nthis.model = runtimePerformanceBudgetModel;`, context);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.model(87, 529))),
    { renderMs: 87, persistenceMs: 529, measured: true, overBudget: false, slow: [] },
  );
  assert.deepEqual(Array.from(context.model(151, 1001).slow), ['render', 'persistence']);
  assert.equal(context.model(0, 0).measured, false);

  assert.match(CORE_02, /kuasangsePersistenceLastMs/);
  assert.match(CORE_02, /id="runtimePerformanceStatus"/);
});
