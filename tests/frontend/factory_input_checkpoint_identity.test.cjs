'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source boundary: ${endMarker}`);
  return source.slice(start, end);
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const bodyStart = source.indexOf(') {', start) + 2;
  assert.notEqual(bodyStart, 1, `missing function body: ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

test('Ctrl+F5 뒤 임시 work instance가 바뀌어도 같은 확정 입력 체크포인트를 복원한다', () => {
  const helper = functionSource(CORE_06, 'factoryDbSizeCheckpointMatchesCurrentWork');
  const current = {
    workInstanceId: 'restart-instance',
    workspaceId: 'project:current',
    productKey: '모시꽃수파우치',
    currentRunId: 'run-current',
    inputImageFingerprint: 'image-current',
    stageId: 'db-size',
  };
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => ({}),
    factoryDbSizeCheckpointScope: () => current,
  });
  vm.runInContext(`${helper}\nthis.matches = factoryDbSizeCheckpointMatchesCurrentWork;`, context);

  const sameWorkAfterReload = {
    checkpointScope: { ...current, workInstanceId: 'before-reload-instance' },
  };
  assert.equal(context.matches(sameWorkAfterReload), true);
  assert.equal(context.matches({ checkpointScope: { ...current, workspaceId: 'project:foreign' } }), false);
  assert.equal(context.matches({ checkpointScope: { ...current, currentRunId: 'run-foreign' } }), false);
  assert.equal(context.matches({ checkpointScope: { ...current, inputImageFingerprint: 'image-foreign' } }), false);
});

test('필수값 초안 키는 탭 임시 ID나 후보 선택 변경에 흔들리지 않는다', () => {
  const helper = sourceSlice(
    CORE_06,
    'function factoryAutomationWizardDraftWorkKey(',
    'function factoryReadAutomationWizardDraftPayload(',
  );
  const context = vm.createContext({
    state: { currentProjectId: 'project:current', productName: '모시꽃수파우치', workIdentity: { instanceId: 'tab-a' } },
    factoryCurrentWorkspaceId: factory => factory.workspace.id,
    factoryCurrentWorkflowRunId: factory => factory.product.currentRunId,
    factoryCurrentProductKey: factory => factory.product.productKey,
    factoryCurrentInputImageFingerprint: factory => factory.product.inputImageFingerprint,
  });
  vm.runInContext(`${helper}\nthis.key = factoryAutomationWizardDraftWorkKey;`, context);

  const base = {
    workspace: { id: 'project:current' },
    product: {
      currentRunId: 'run-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'image-current',
      selectedCafe24CandidateKey: 'candidate-a',
    },
  };
  const afterReload = {
    ...base,
    workIdentity: { instanceId: 'tab-b' },
    product: { ...base.product, selectedCafe24CandidateKey: 'candidate-b' },
  };
  assert.equal(context.key(base), context.key(afterReload));
  assert.notEqual(context.key(base), context.key({ ...base, product: { ...base.product, currentRunId: 'run-new' } }));
});

test('입력 체크포인트는 오래된 state.factory가 아니라 현재 공장 저장소를 읽는다', () => {
  const payload = sourceSlice(
    CORE_02,
    'function lastWorkInputCheckpointPayload(',
    'function saveLastWorkInputCheckpoint(',
  );
  assert.match(payload, /factoryRuntimeReadCommittedFactory\(\)/);
  assert.match(payload, /: state\.factory/);
});

test('필수값 확정은 mutator 반환값과 무관하게 최신 store 스냅샷을 즉시 저장한다', () => {
  const commit = functionSource(CORE_06, 'factoryCommitAutomationWizardFieldValue');
  assert.match(commit, /fieldId && receipt\?\.snapshot\?\.factory/);
  assert.match(commit, /saveLastWorkNow\(\{ factory: receipt\.snapshot\.factory \}\)/);
  assert.match(commit, /return true;/);
});
