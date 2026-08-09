'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

test('같은 전체 시작 흐름을 연속 호출해도 owned draft 작업은 한 번만 시작한다', async () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const flowSource = sourceSlice(
    source,
    'async function factoryRunDbCompetitorHeroCutsFlow(',
    'async function factoryRunDbVmCandidatesOnlyFlow(',
  );
  let releaseDraft;
  const draftPending = new Promise(resolve => { releaseDraft = resolve; });
  let ownedDraftCalls = 0;
  const activeLeases = new Map();
  const operationToken = Object.freeze({ workspaceId: 'project:test', revision: 1 });
  const context = vm.createContext({
    factoryRuntimeRequireStore: () => ({
      getOperationToken: () => operationToken,
      isOperationCurrent: candidate => candidate === operationToken,
    }),
    factoryRuntimeStaleActionError: action => new Error(`STALE:${action}`),
    factoryRuntimeUpdateOwnedFactory: async () => {
      ownedDraftCalls += 1;
      await draftPending;
      return { result: true };
    },
    factoryRuntimeWithOperationLease: (key, _operationContext, execute) => {
      if (activeLeases.has(key)) return false;
      activeLeases.set(key, true);
      const result = execute({ operationToken, operationSignal: null });
      return Promise.resolve(result).finally(() => activeLeases.delete(key));
    },
  });
  vm.runInContext(flowSource, context);

  const first = Promise.resolve(context.factoryRunDbCompetitorHeroCutsFlow());
  await flushMicrotasks();
  const second = Promise.resolve(context.factoryRunDbCompetitorHeroCutsFlow());
  await flushMicrotasks();

  try {
    assert.equal(
      ownedDraftCalls,
      1,
      '두 번째 클릭은 첫 owned draft가 끝날 때까지 새 전체 실행을 만들면 안 된다',
    );
  } finally {
    releaseDraft(true);
    await Promise.allSettled([first, second]);
  }
});
