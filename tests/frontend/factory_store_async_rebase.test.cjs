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

test('기존 컷 보관 정보가 갱신되어도 비동기 생성의 새 컷과 HTML을 함께 보존한다', async () => {
  const { createFactoryStore } = await import(pathToFileURL(STORE).href);
  const store = createFactoryStore({
    workspaceId: 'project:asset-rebase',
    initialSnapshot: { factory: { assets: [
      { id: 'hero', used: true, archiveId: '' },
      { id: 'removed', used: false },
    ] } },
  });
  const gate = deferred();
  const worker = store.updateDraft(async draft => {
    draft.assets[0].used = true;
    draft.assets.unshift({ id: 'new-cut', used: false }, { id: 'new-html', used: true });
    await gate.promise;
  }, { owner: 'factory', expectedRevision: 0 }, '', { rebaseOnStale: true });

  store.updateDraft(draft => {
    draft.assets[0].archiveId = 'saved-hero';
    draft.assets[0].used = false;
    draft.assets.splice(1, 1);
    draft.assets.push({ id: 'other-new', used: false });
  }, { owner: 'factory', expectedRevision: 0 });
  gate.resolve();
  await worker;

  const assets = store.getSnapshot().factory.assets;
  assert.deepEqual(assets.map(asset => asset.id).sort(), ['hero', 'new-cut', 'new-html', 'other-new']);
  assert.deepEqual(assets.find(asset => asset.id === 'hero'), { id: 'hero', used: false, archiveId: 'saved-hero' });
  assert.equal(assets.find(asset => asset.id === 'new-html').used, true);
});
