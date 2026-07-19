const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function moduleUrl(relativePath) {
  const file = path.join(ROOT, ...relativePath.split('/'));
  return `${pathToFileURL(file).href}?test=${Date.now()}-${Math.random()}`;
}

const OWNERSHIP = [
  { path: 'alpha', owner: 'alpha-owner' },
  { path: 'beta', owner: 'beta-owner' },
];

test('상태 소유권은 shell/shared composition과 모든 메뉴 slice를 빠짐없이 등록한다', async () => {
  const {
    STATE_PATH_OWNERSHIP,
    assertExhaustiveStateOwnership,
    createInitialAppState,
    validateStateOwnership,
  } = await import(moduleUrl('src/modules/state-ownership.mjs'));

  assert.deepEqual(STATE_PATH_OWNERSHIP.map(entry => entry.path), [
    'shell', 'shared', 'productAnalysis', 'competitors', 'detailDocument',
    'imageCuts', 'options', 'factory', 'automation', 'appPreferences',
    'manualUi', 'productDb', 'factoryAssets', 'cafe24',
  ]);
  assert.equal(STATE_PATH_OWNERSHIP.find(entry => entry.path === 'shell').owner, 'shell');
  assert.equal(STATE_PATH_OWNERSHIP.find(entry => entry.path === 'shared').owner, 'composition');
  assert.equal(assertExhaustiveStateOwnership(createInitialAppState(), STATE_PATH_OWNERSHIP), true);

  assert.throws(() => validateStateOwnership([
    { path: 'factory', owner: 'factory' },
    { path: 'factory.assets', owner: 'factory-assets' },
  ]), /overlapping ownership/);
});

test('store는 등록 reducer만 쓰게 하고 unknown action과 peer slice reducer를 거부한다', async () => {
  const {
    createAppStore,
    defineReducer,
  } = await import(moduleUrl('src/modules/app-store.mjs'));

  const increment = defineReducer({
    type: 'alpha/increment',
    owner: 'alpha-owner',
    path: 'alpha',
    reduce: (slice, payload) => ({ count: slice.count + payload.by }),
  });
  const invalidResult = defineReducer({
    type: 'alpha/invalid-result',
    owner: 'alpha-owner',
    path: 'alpha',
    reduce: () => undefined,
  });
  const store = createAppStore({
    initialState: { alpha: { count: 1 }, beta: { count: 9 } },
    ownership: OWNERSHIP,
    reducers: [increment, invalidResult],
  });

  store.dispatch({ type: 'alpha/increment', payload: { by: 2 } });
  assert.deepEqual(store.snapshot(), { alpha: { count: 3 }, beta: { count: 9 } });
  assert.throws(() => store.dispatch({ type: 'missing/action' }), /unknown action/);
  assert.throws(() => store.dispatch(null), /action/);

  const beforeInvalid = store.snapshot();
  assert.throws(() => store.dispatch({ type: 'alpha/invalid-result' }), /plain state data/);
  assert.deepEqual(store.snapshot(), beforeInvalid, 'a failed reducer must be atomic');

  assert.throws(() => createAppStore({
    initialState: { alpha: {}, beta: {} },
    ownership: OWNERSHIP,
    reducers: [defineReducer({
      type: 'alpha/write-beta',
      owner: 'alpha-owner',
      path: 'beta',
      reduce: () => ({}),
    })],
  }), /peer mutation/);
});

test('snapshot과 selector 결과는 deep immutable detached data이고 hydration은 versioned envelope만 받는다', async () => {
  const {
    APP_STATE_ENVELOPE_SCHEMA,
    APP_STATE_VERSION,
    createAppStore,
  } = await import(moduleUrl('src/modules/app-store.mjs'));

  const store = createAppStore({
    initialState: { alpha: { nested: { value: 1 } }, beta: { value: 2 } },
    ownership: OWNERSHIP,
  });
  const snapshot = store.snapshot();
  const selected = store.select(state => state.alpha);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.alpha.nested), true);
  assert.equal(Object.isFrozen(selected.nested), true);
  try { snapshot.alpha.nested.value = 100; } catch (_) {}
  try { selected.nested.value = 200; } catch (_) {}
  assert.equal(store.select(state => state.alpha.nested.value), 1);

  assert.equal(store.hydrate({
    schema: APP_STATE_ENVELOPE_SCHEMA,
    version: APP_STATE_VERSION,
    state: { alpha: { nested: { value: 3 } }, beta: { value: 4 } },
  }), APP_STATE_VERSION);
  assert.equal(store.select(state => state.alpha.nested.value), 3);

  const beforeMalformed = store.snapshot();
  assert.throws(() => store.hydrate({
    schema: APP_STATE_ENVELOPE_SCHEMA,
    version: 'app-state:v999',
    state: { alpha: {}, beta: {} },
  }), /unsupported hydration version/);
  assert.throws(() => store.hydrate({
    schema: APP_STATE_ENVELOPE_SCHEMA,
    version: APP_STATE_VERSION,
    state: { alpha: {}, beta: {}, peer: {} },
  }), /unowned state path/);
  assert.throws(() => store.hydrate({
    schema: APP_STATE_ENVELOPE_SCHEMA,
    version: APP_STATE_VERSION,
    state: JSON.parse('{"alpha":{"__proto__":{"polluted":true}},"beta":{"value":2}}'),
  }), /unsafe state key/);
  assert.deepEqual(store.snapshot(), beforeMalformed, 'malformed hydration must be atomic');
});

test('composition command layer만 product→options→factory→workfile→detail→Cafe24 bridge action을 만든다', async () => {
  const {
    COMPOSITION_COMMAND_NAMES,
    COMPOSITION_TRANSITIONS,
    createCompositionCommands,
  } = await import(moduleUrl('src/modules/composition-commands.mjs'));

  assert.deepEqual(COMPOSITION_COMMAND_NAMES, [
    'productToOptions',
    'optionsToFactory',
    'factoryToWorkfile',
    'workfileToDetail',
    'detailToCafe24',
  ]);
  assert.deepEqual(COMPOSITION_TRANSITIONS.map(item => [item.source, item.target]), [
    ['product-analysis', 'options'],
    ['options', 'factory'],
    ['factory', 'shared.workfile'],
    ['shared.workfile', 'detail-document'],
    ['detail-document', 'cafe24'],
  ]);

  const actions = [];
  const commands = createCompositionCommands({ dispatch: action => actions.push(action) });
  commands.productToOptions({ productId: 'p-1' });
  assert.deepEqual(actions[0], {
    type: 'composition/bridge',
    owner: 'composition',
    capability: 'composition:product-to-options',
    transition: 'productToOptions',
    source: 'product-analysis',
    target: 'options',
    payload: { productId: 'p-1' },
  });
  assert.equal(Object.isFrozen(actions[0]), true);
  assert.throws(() => commands.run('peerToCafe24', {}), /undeclared composition command/);
  assert.throws(
    () => commands.productToOptions(JSON.parse('{"__proto__":{"polluted":true}}')),
    /unsafe composition payload key/,
  );
});
