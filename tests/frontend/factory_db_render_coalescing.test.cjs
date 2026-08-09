'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, 'src', 'app-core-06.js');

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} 정의가 필요합니다.`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} 함수 시그니처 경계가 필요합니다.`);
  const braceStart = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 본문 경계를 찾지 못했습니다.`);
}

function extractSyncFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 정의가 필요합니다.`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} 함수 시그니처 경계가 필요합니다.`);
  const braceStart = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 본문 경계를 찾지 못했습니다.`);
}

function createFactory() {
  return {
    product: { productName: '복주머니대' },
    automation: {},
    stages: {},
  };
}

function createStageHarness() {
  const renders = [];
  const context = vm.createContext({
    state: {},
    factoryDbCandidateCollectionBusy: false,
    cleanDbSearchTerm: value => String(value || '').trim(),
    factoryUpdateFromInputs: () => {},
    factoryApplyProductToApp: () => {},
    factoryCandidateCollectionScope: () => ({ productKey: '복주머니대' }),
    factoryCandidateCollectionScopeMatches: () => true,
    factorySetStageStatus: () => {},
    factoryLog: () => {},
    factorySetGoalRunProgress: () => {},
    scheduleLastWorkSave: () => {},
    factoryYieldToPaint: async () => {},
    factoryStartGoalHeartbeat: () => ({ id: 'heartbeat' }),
    factoryStopGoalHeartbeat: () => {},
    factoryCollectProductCandidatesForReview: async () => ({ dbCount: 1, cafeCount: 1 }),
    saveLastWorkNow: async () => {},
    render: () => renders.push('render'),
    console: { warn: () => {} },
  });
  const source = fs.readFileSync(CORE, 'utf8');
  vm.runInContext(`${extractFunction(source, 'factoryRunDbStage')}\nglobalThis.runDbStage = factoryRunDbStage;`, context);
  return { context, renders };
}

test('DB 후보 수집을 상위 호출이 렌더할 때 임시 복제본의 중복 전체 렌더를 만들지 않는다', async () => {
  const { context, renders } = createStageHarness();

  const result = await context.runDbStage({ factory: createFactory(), render: false });

  assert.equal(result, true);
  assert.equal(renders.length, 0, '상위 호출이 현재 작업 반영 뒤 렌더할 때 임시 factory는 render()를 호출하면 안 됩니다.');
});

test('DB 후보 수집의 직접 호출은 기존처럼 시작·완료 화면을 렌더한다', async () => {
  const { context, renders } = createStageHarness();

  const result = await context.runDbStage({ factory: createFactory() });

  assert.equal(result, true);
  assert.equal(renders.length, 2, '직접 호출의 시작·완료 상태 렌더는 유지해야 합니다.');
});

test('상위 DB 후보 수집은 하위 단계에 자신의 render 정책을 전달한다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const outer = extractFunction(source, 'factoryRunDbCandidatesForSelection');

  assert.match(
    outer,
    /factoryRunDbStage\(\{\s*factory,\s*operationToken,\s*cafe24Only,\s*render:\s*options\.render\s*\}\);/s,
    '상위 수집이 render:false로 동작할 때 하위 DB 단계도 임시 복제본을 다시 그리면 안 됩니다.',
  );
});

test('백그라운드 탭 패치는 사용자가 누르는 탭 줄 DOM을 교체하지 않는다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const patchTab = extractSyncFunction(source, 'factoryPatchAutomationWizardTab');

  assert.doesNotMatch(
    patchTab,
    /morphNode\([^\n]*factory-automation-tabs|\['\.factory-automation-tabs'/,
    '상태 갱신 중 탭 줄을 morph하면 pointerdown과 click 사이에 대상 DOM이 바뀔 수 있습니다.',
  );
  assert.match(
    patchTab,
    /\.factory-automation-body/,
    '활성 탭 본문만 부분 갱신하는 기존 동작은 유지해야 합니다.',
  );
});

test('숨겨진 탭의 주기 작업은 화면 DOM을 갱신하지 않는다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const statusPolling = extractSyncFunction(source, 'startStatusPolling');
  const goalHeartbeat = extractSyncFunction(source, 'factoryStartGoalHeartbeat');
  const sectionHeartbeat = extractSyncFunction(source, 'startSectionBatchHeartbeat');

  for (const [name, functionSource] of [
    ['자동화 상태 폴링', statusPolling],
    ['조립공장 진행 heartbeat', goalHeartbeat],
    ['섹션 생성 heartbeat', sectionHeartbeat],
  ]) {
    assert.match(
      functionSource,
      /document\.visibilityState\s*===\s*['"]hidden['"]/,
      `${name}은 숨겨진 탭에서 DOM 갱신을 건너뛰어야 합니다.`,
    );
  }
});
