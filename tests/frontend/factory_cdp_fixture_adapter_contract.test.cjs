const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const UTILS = path.join(ROOT, 'tools', 'factory_cdp_test_utils.cjs');
const OWNED_VERIFIERS = [
  path.join(ROOT, 'tools', 'verify_factory_integrity_cdp_v80.cjs'),
  path.join(ROOT, 'tools', 'verify_factory_responsive_controls_v230.cjs'),
];

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

test('factory CDP fixture adapter reaches canonical lexical runtime without mutable window aliases', () => {
  const {
    factoryCdpFixtureExpression,
    factoryCdpFixtureReadyExpression,
  } = require(UTILS);

  assert.equal(typeof factoryCdpFixtureExpression, 'function');
  assert.equal(typeof factoryCdpFixtureReadyExpression, 'function');

  const context = vm.createContext({ structuredClone });
  vm.runInContext(`
    const state = { step: 'upload' };
    let currentFactory = Object.freeze({ nested: Object.freeze({ count: 1 }) });
    let replaceOptions = null;
    let operationToken = Object.freeze({ workspaceId: 'fixture:before', revision: 4, fence: 1 });
    const factoryRuntimeReadFactory = () => currentFactory;
    const factoryRuntimeReplaceFactorySnapshot = (value, options) => {
      replaceOptions = structuredClone(options);
      currentFactory = Object.freeze({ nested: Object.freeze({ ...value.nested }) });
      operationToken = Object.freeze({ workspaceId: options.workspaceId, revision: 0, fence: 2 });
      return currentFactory;
    };
    const render = function render() { return state.step + ':' + currentFactory.nested.count; };
    const factoryRuntimeStore = {
      getSnapshot: () => ({ factory: currentFactory }),
      getOperationToken: () => operationToken,
    };
    let classicRuntimeHydrationReady = true;
    let classicRuntimeInitialRenderComplete = true;
  `, context);

  const ready = vm.runInContext(factoryCdpFixtureReadyExpression(), context);
  assert.equal(ready, true);
  const result = vm.runInContext(factoryCdpFixtureExpression(`({
    setAppState,
    cloneFactory,
    replaceFactory,
    readFactory,
    readOperationToken,
    renderApp,
  }) => {
    setAppState({ step: 'factory' });
    const draft = cloneFactory();
    draft.nested.count = 2;
    replaceFactory(draft, {
      reason: 'contract-hydrate',
      mode: 'hydrate',
      workspaceId: 'fixture:after',
    });
    return {
      rendered: renderApp(),
      count: readFactory().nested.count,
      operationToken: readOperationToken(),
    };
  }`), context);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    rendered: 'factory:2',
    count: 2,
    operationToken: { workspaceId: 'fixture:after', revision: 0, fence: 2 },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInContext('replaceOptions', context))),
    { reason: 'contract-hydrate', mode: 'hydrate', workspaceId: 'fixture:after' },
  );
  for (const legacyAlias of ['state', 'factoryState', 'render']) {
    assert.equal(Object.hasOwn(context, legacyAlias), false, `${legacyAlias} must remain lexical-only`);
  }
});

test('owned factory CDP verifiers contain zero legacy mutable window alias references', () => {
  const legacyWindowAlias = /window\s*\.\s*(?:state|factoryState|render)\b/g;
  for (const file of OWNED_VERIFIERS) {
    assert.deepEqual(source(file).match(legacyWindowAlias) || [], [], path.basename(file));
  }
});
