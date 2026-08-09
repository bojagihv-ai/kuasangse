'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const STORE = path.resolve(__dirname, '../../src/modules/factory-store-runtime.mjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('비동기 초안이 늦게 끝나도 같은 작업의 최신 사용자 선택을 덮어쓰지 않는다', async () => {
  const { createFactoryStore } = await import(`${pathToFileURL(STORE).href}?async-rebase=${Date.now()}`);
  const store = createFactoryStore({
    workspaceId: 'project:async-rebase',
    initialSnapshot: {
      factory: { product: { selected: '', candidates: [] } },
    },
  });
  const gate = deferred();
  const worker = store.updateDraft(
    async draft => {
      draft.product.candidates = ['worker-candidate'];
      await gate.promise;
      return 'worker';
    },
    { owner: 'factory', expectedRevision: 0 },
    '',
    { rebaseOnStale: true },
  );

  store.updateDraft(
    draft => {
      draft.product.selected = 'user-selection';
      return 'user';
    },
    { owner: 'factory', expectedRevision: 0 },
  );
  gate.resolve();
  await worker;

  assert.equal(store.getSnapshot().factory.product.selected, 'user-selection');
  assert.deepEqual(store.getSnapshot().factory.product.candidates, ['worker-candidate']);
});

test('명시적인 선택 해제는 늦게 끝난 작업보다 우선한다', async () => {
  const { createFactoryStore } = await import(`${pathToFileURL(STORE).href}?async-clear=${Date.now()}`);
  const store = createFactoryStore({
    workspaceId: 'project:async-clear',
    initialSnapshot: {
      factory: { product: { selected: 'already-selected' } },
    },
  });
  const gate = deferred();
  const worker = store.updateDraft(
    async draft => {
      draft.product.selected = 'late-worker-value';
      await gate.promise;
    },
    { owner: 'factory', expectedRevision: 0 },
    '',
    { rebaseOnStale: true },
  );

  store.updateDraft(
    draft => {
      draft.product.selected = '';
    },
    { owner: 'factory', expectedRevision: 0 },
  );
  gate.resolve();
  await worker;

  assert.equal(store.getSnapshot().factory.product.selected, '');
});
