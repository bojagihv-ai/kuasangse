const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ADAPTER_PATH = path.resolve(
  __dirname,
  '../../src/modules/persistence/session-storage-adapter.mjs',
);

function storage(values) {
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function recovery(value, authority) {
  return JSON.stringify({
    schema: 'kuasangse.recovery.v1',
    value,
    persistenceAuthority: authority,
  });
}

test('탭 전용 옵션 분류 복구값은 새로고침 뒤 편집권 lease가 바뀌어도 최신 이름을 저장한다', async () => {
  const { createSessionStorageAdapter } = await import(
    `${pathToFileURL(ADAPTER_PATH).href}?option-sorter-reload=${Date.now()}`,
  );
  const sharedValues = new Map();
  const tabValues = new Map([
    ['pdp_option_sorter_live_v1', recovery(
      JSON.stringify({ workspaceScope: 'draft:tab-a', optionSorter: { slots: [{ name: '1.빨강' }] } }),
      { scopeId: 'project:doc', leaseId: 'old-lease', fencingToken: 4, revision: 12 },
    )],
  ]);
  const authority = {
    snapshot: () => ({
      scopeId: 'project:doc',
      leaseId: 'new-lease',
      fencingToken: 5,
      revision: 0,
      mode: 'editing',
    }),
  };
  const adapter = createSessionStorageAdapter({
    storage: storage(sharedValues),
    draftStorage: storage(tabValues),
    authority,
  });

  const nextValue = JSON.stringify({
    workspaceScope: 'draft:tab-a',
    optionSorter: { slots: [{ name: '1.파랑' }] },
  });
  adapter.setItem('pdp_option_sorter_live_v1', nextValue, {
    persistenceAuthority: authority.snapshot(),
    assertAuthority() {},
    assertCompletion() {},
  });

  assert.equal(adapter.getItem('pdp_option_sorter_live_v1'), nextValue);
  assert.equal(sharedValues.size, 0, '탭 전용 복구값이 공유 localStorage로 새지 않아야 한다');
});
