'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = path.join(ROOT, 'src', 'app-core-03.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bridgeSource() {
  const source = fs.readFileSync(CORE, 'utf8');
  const start = source.indexOf('function factoryRuntimeBridgeAction(');
  const end = source.indexOf('function factoryRuntimeWithOperationLease(', start);
  assert.notEqual(start, -1, 'factoryRuntimeBridgeAction source is required');
  assert.notEqual(end, -1, 'factoryRuntimeWithOperationLease boundary is required');
  return source.slice(start, end);
}

test('필수값 확정의 forceSave는 탭 전이 타이머보다 먼저 최신 canonical factory를 저장한다', () => {
  let snapshot = { factory: { product: { dbFieldSettings: {} } } };
  let immediateSave = null;
  let scheduledSaveCalls = 0;
  let checkpointCalls = 0;
  const store = {
    getOperationToken() { return { revision: 7, workspaceId: 'draft:field-confirm' }; },
    isOperationCurrent() { return true; },
    getSnapshot() { return snapshot; },
    updateDraft(mutator) {
      const draft = clone(snapshot.factory);
      const result = mutator(draft);
      snapshot = { factory: draft };
      return { snapshot, result, assignments: [] };
    },
  };
  const context = vm.createContext({
    FACTORY_RUNTIME_COMMAND_POLICIES: {
      'factory/fields:commitField': { coordinator: 'product-db' },
    },
    FACTORY_RUNTIME_READ_COMMANDS: [],
    FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA: 'factory-runtime-command-receipt:v1',
    factoryRuntimeOwnedRenderDraft: null,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeStaleActionError: name => new Error(`stale:${name}`),
    factoryRuntimeReadFactory: () => snapshot.factory,
    factoryRuntimeRenderWithOwnedDraft: (draft, execute) => execute(draft),
    factoryRuntimeDetachedValue: clone,
    saveLastWorkNow(options) {
      immediateSave = clone(options);
      return Promise.resolve([]);
    },
    scheduleLastWorkSave() { scheduledSaveCalls += 1; },
    saveLastWorkInputCheckpoint() { checkpointCalls += 1; },
    state: { step: 'factory' },
    render() {},
  });
  vm.runInContext(`${bridgeSource()}\nthis.bridge = factoryRuntimeBridgeAction;`, context);

  const receipt = context.bridge(
    'factory/fields:commitField',
    null,
    draft => {
      draft.product.dbFieldSettings.size = { manualValue: '가로21cm*세로14cm' };
      return 'size';
    },
    { forceSave: true },
  );

  assert.equal(receipt.value, 'size');
  assert.deepEqual(immediateSave, {
    factory: { product: { dbFieldSettings: { size: { manualValue: '가로21cm*세로14cm' } } } },
    sync: false,
  });
  assert.equal(scheduledSaveCalls, 0, 'forceSave를 지연 타이머로 바꾸면 뒤따르는 화면 전이가 확정값 저장을 취소할 수 있다.');
  assert.equal(checkpointCalls, 1, 'forceSave 경계는 새로고침 전에 입력 체크포인트도 남겨야 한다.');
});
