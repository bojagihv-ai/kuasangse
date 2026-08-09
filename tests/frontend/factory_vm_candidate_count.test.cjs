'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function executionLimitResolver() {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const helperStart = source.indexOf('function factoryAutomationStartRunCountForExecution(');
  const helperEnd = source.indexOf('function factoryRequestedPromptLimitForStage(', helperStart);
  const assignmentStart = source.indexOf('const configuredRunLimit =', helperEnd);
  const competitorStart = source.indexOf('const competitorRunLimit =', assignmentStart);
  const assignmentEnd = source.indexOf(';', competitorStart) + 1;
  assert.notEqual(helperStart, -1, 'VM execution count helper must exist');
  assert.notEqual(helperEnd, -1, 'VM execution count helper boundary must exist');
  assert.notEqual(assignmentStart, -1, 'VM configured count assignment must exist');
  assert.notEqual(competitorStart, -1, 'VM execution count assignment must exist');
  assert.notEqual(assignmentEnd, 0, 'VM execution count assignment must end');
  const helperSource = source.slice(helperStart, helperEnd);
  const assignment = source.slice(assignmentStart, assignmentEnd).trim();
  const context = vm.createContext({
    factoryEnsureAutomationRunScope() {},
    factoryRuntimeReadFactory: () => ({ automation: {} }),
    factory: { automation: { startRunCounts: {} } },
    market: { topN: 4 },
    options: {},
  });
  vm.runInContext(`${helperSource}\nfunction resolve(factory, market) { ${assignment}; return competitorRunLimit; }`, context);
  return (factory = context.factory, market = context.market) => context.resolve(factory, market);
}

test('VM 후보 실행 수량은 상태 필드가 없으면 UI 기본값 3을 사용한다', () => {
  // Given: 저장된 시작 수량이 없고 시장 상태의 이전 topN은 4이다.
  const resolveLimit = executionLimitResolver();

  // When: VM 후보 실행 수량 fallback을 계산한다.
  const limit = resolveLimit();

  // Then: 이전 market.topN이 아니라 UI 기본값 3을 사용한다.
  assert.equal(limit, 3);
});

test('VM 후보 실행 수량은 명시적인 사용자 override를 유지한다', () => {
  // Given: 사용자가 VM 후보 시작 수량을 2로 명시했다.
  const resolveLimit = executionLimitResolver();
  const factory = { automation: { startRunCounts: { competitors: 2 } } };

  // When: VM 후보 실행 수량 fallback을 계산한다.
  const limit = resolveLimit(factory);

  // Then: 명시한 2를 그대로 사용한다.
  assert.equal(limit, 2);
});

test('VM 후보 실행 수량은 UI 최대값 3을 넘지 않는다', () => {
  // Given: 사용자가 UI 최대값보다 큰 VM 후보 수량을 저장했다.
  const resolveLimit = executionLimitResolver();
  const factory = { automation: { startRunCounts: { competitors: 9 } } };

  // When: VM 후보 실행 수량을 계산한다.
  const limit = resolveLimit(factory);

  // Then: UI 최대값 3으로 제한한다.
  assert.equal(limit, 3);
});

test('VM 후보 실행 수량은 명시적인 0 override를 건너뛰기로 유지한다', () => {
  // Given: 사용자가 이번 VM 후보 수집 수량을 0으로 지정했다.
  const resolveLimit = executionLimitResolver();
  const factory = { automation: { startRunCounts: { competitors: 0 } } };

  // When: VM 후보 실행 수량을 계산한다.
  const limit = resolveLimit(factory);

  // Then: 0을 유지해 이번 실행을 건너뛴다.
  assert.equal(limit, 0);
});
