const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const UTILS = path.join(ROOT, 'tools', 'factory_cdp_test_utils.cjs');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CAFE24_SYNC = path.join(ROOT, 'src', 'cafe24-sync.js');

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} definition is required`);
  const parameterClose = fileSource.indexOf(')', start);
  const braceStart = fileSource.indexOf('{', parameterClose);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} boundary is incomplete`);
}

function canonicalCandidateFunctions() {
  const core = fs.readFileSync(CORE_03, 'utf8');
  const sync = fs.readFileSync(CAFE24_SYNC, 'utf8');
  return [
    extractFunction(core, 'factoryWorkspaceIdentityFromSource'),
    extractFunction(core, 'factoryCurrentWorkspaceId'),
    extractFunction(core, 'factoryNormalizeIdentityText'),
    extractFunction(core, 'factoryCurrentProductKey'),
    extractFunction(sync, 'factoryCaptureLockedProductName'),
    extractFunction(sync, 'factoryCandidateReviewScope'),
    extractFunction(sync, 'factoryCandidateReviewScopeKey'),
    extractFunction(sync, 'factoryCandidateReviewScopeKeyFromCandidate'),
    extractFunction(sync, 'factoryCandidateReviewCanApply'),
  ].join('\n');
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

test('legacy CDP compatibility is diagnostic-gated and commits mutations without window aliases', async () => {
  const { legacyCdpCompatibilityExpression } = require(UTILS);
  assert.equal(typeof legacyCdpCompatibilityExpression, 'function');
  assert.equal(
    legacyCdpCompatibilityExpression('window.customDiagnosticValue + 1'),
    'window.customDiagnosticValue + 1',
    'expressions without retired aliases must stay on the canonical runtime path',
  );

  const root = {};
  const document = {};
  const context = vm.createContext({ structuredClone, window: root, globalThis: root, document });
  vm.runInContext(`
    const state = { step: 'upload', factory: { stale: true } };
    let currentFactory = Object.freeze({ nested: Object.freeze({ count: 1 }) });
    let factoryReadCount = 0;
    let replaceCount = 0;
    let replaceReason = '';
    const factoryRuntimeReadFactory = () => {
      factoryReadCount += 1;
      return currentFactory;
    };
    const factoryRuntimeReplaceFactorySnapshot = (value, options = {}) => {
      replaceCount += 1;
      replaceReason = options.reason || '';
      currentFactory = Object.freeze({ nested: Object.freeze({ ...value.nested }) });
      return currentFactory;
    };
    const render = function render() {
      return state.step + ':' + factoryRuntimeReadFactory().nested.count;
    };
    window.canonicalBump = function canonicalBump() {
      currentFactory = Object.freeze({ nested: Object.freeze({ count: 3 }) });
      return currentFactory.nested.count;
    };
    document.canonicalEvent = function canonicalEvent() {
      currentFactory = Object.freeze({ nested: Object.freeze({ count: 5 }) });
    };
    let classicRuntimeHydrationReady = false;
    let classicRuntimeInitialRenderComplete = false;
  `, context);

  const legacyExpression = `async () => {
    window.state.step = 'factory';
    window.factoryState.nested.count = 2;
    window.canonicalBump();
    window.factoryState.nested.compatible = true;
    const rendered = window.render();
    return {
      rendered,
      step: window.__kuasangseState.step,
      count: window.factoryState.nested.count,
      callableCount: window.factoryState().nested.count,
    };
  }`;

  const beforeDiagnostic = await vm.runInContext(
    legacyCdpCompatibilityExpression(`(${legacyExpression})().then(() => 'unexpected')`),
    context,
  ).catch(error => error.name);
  assert.equal(beforeDiagnostic, 'TypeError', 'compatibility must stay unavailable before diagnostics install');

  Object.defineProperty(root, '__KUASANGSE_DIAGNOSTIC__', {
    value: Object.freeze({ factory: Object.freeze({ nested: Object.freeze({ count: 1 }) }) }),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(root, 'nativeLike', {
    get() {
      if (this !== root) throw new TypeError('Illegal invocation');
      return 7;
    },
    configurable: true,
  });
  assert.equal(
    vm.runInContext(legacyCdpCompatibilityExpression('!!window.state'), context),
    false,
    'legacy aliases must not make readiness probes pass before hydration completes',
  );
  vm.runInContext(`
    classicRuntimeHydrationReady = true;
    classicRuntimeInitialRenderComplete = true;
  `, context);
  const readsBeforeStateOnlyProbe = vm.runInContext('factoryReadCount', context);
  assert.equal(
    vm.runInContext(
      legacyCdpCompatibilityExpression('window.state.step === "upload"'),
      context,
    ),
    true,
  );
  assert.equal(
    vm.runInContext('factoryReadCount', context),
    readsBeforeStateOnlyProbe,
    'state-only polling must not clone or serialize the factory snapshot',
  );
  const result = await vm.runInContext(
    legacyCdpCompatibilityExpression(`(${legacyExpression})()`),
    context,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    rendered: 'factory:3',
    step: 'factory',
    count: 3,
    callableCount: 3,
  });
  assert.equal(vm.runInContext('replaceCount', context), 2);
  assert.equal(vm.runInContext('replaceReason', context), 'legacy-cdp-test-compat');
  assert.equal(vm.runInContext('state.factory.stale', context), true, 'canonical state.factory is not reused');
  assert.equal(
    vm.runInContext(
      legacyCdpCompatibilityExpression('window.state.step === "factory" ? window.nativeLike : 0'),
      context,
    ),
    7,
    'window accessors must retain their canonical receiver',
  );
  const restoredRender = await vm.runInContext(
    legacyCdpCompatibilityExpression(`(async () => {
      const savedRender = window.render;
      window.render = () => 'override:' + savedRender();
      const overridden = window.render();
      window.render = savedRender;
      return { overridden, restored: window.render() };
    })()`),
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(restoredRender)), {
    overridden: 'override:factory:3',
    restored: 'factory:3',
  });
  const proxyReplacement = await vm.runInContext(
    legacyCdpCompatibilityExpression(`(async () => {
      window.state.factory = new Proxy({ nested: { count: 4 } }, {});
      window.render();
      return window.factoryState.nested.count;
    })()`),
    context,
  );
  assert.equal(proxyReplacement, 4, 'Proxy-backed legacy snapshots must remain cloneable');
  const refreshedAfterDomEvent = vm.runInContext(
    legacyCdpCompatibilityExpression(`(() => {
      document.canonicalEvent();
      return window.factoryState().nested.count;
    })()`),
    context,
  );
  assert.equal(refreshedAfterDomEvent, 5, 'canonical DOM event mutations must refresh a clean draft');
  for (const legacyAlias of ['state', '__kuasangseState', 'factoryState', 'render']) {
    assert.equal(Object.hasOwn(root, legacyAlias), false, `${legacyAlias} must not be installed on window`);
  }
});

test('DB-01 fixture invokes canonical candidate scope functions through the adapter', () => {
  const { factoryCdpFixtureExpression, factoryCdpFixtureReadyExpression } = require(UTILS);
  const context = vm.createContext({ structuredClone });
  vm.runInContext(`${canonicalCandidateFunctions()}
    const state = { currentProjectId: '', currentProjectName: '', productName: '' };
    let draftScope = 'draft:before-v163';
    let currentFactory = { workspace: { id: '', name: '' }, product: {} };
    const factoryRuntimeReadFactory = () => currentFactory;
    const factoryRuntimeReplaceFactorySnapshot = value => {
      currentFactory = structuredClone(value);
      return currentFactory;
    };
    const factoryRuntimeStore = {
      getSnapshot: () => ({ factory: currentFactory }),
      getOperationToken: () => ({ workspaceId: draftScope, revision: 0, fence: 1 }),
    };
    const render = () => 'fixture-render';
    let classicRuntimeHydrationReady = true;
    let classicRuntimeInitialRenderComplete = true;
    function getCurrentLastWorkWorkspaceScope() {
      return draftScope;
    }
    function rotateLastWorkDraftScope() {
      draftScope = 'draft:after-v163';
      return draftScope;
    }
  `, context);

  assert.equal(vm.runInContext(factoryCdpFixtureReadyExpression(), context), true);
  const result = vm.runInContext(factoryCdpFixtureExpression(`({
    setAppState,
    cloneFactory,
    readFactory,
    replaceFactory,
  }) => {
    const productName = '새 초안 범위 검증 수저집';
    setAppState({ productName });
    const factory = cloneFactory();
    factory.workspace = { id: '', name: '' };
    factory.product = { productKey: factoryNormalizeIdentityText(productName) };
    replaceFactory(factory);
    const beforeFactory = readFactory();
    const beforeScopeKey = factoryCandidateReviewScopeKey(beforeFactory);
    const candidate = { reviewProductScopeKey: beforeScopeKey, reviewProductName: productName };
    const beforeSelectable = factoryCandidateReviewCanApply(candidate, beforeFactory);
    const rotatedScope = rotateLastWorkDraftScope();
    const afterScopeKey = factoryCandidateReviewScopeKey(readFactory());
    const staleSelectable = factoryCandidateReviewCanApply(candidate, readFactory());
    return {
      beforeScopeKey,
      beforeSelectable,
      rotatedScope,
      afterScopeKey,
      staleSelectable,
    };
  }`), context);

  assert.equal(result.beforeSelectable, true);
  assert.equal(result.staleSelectable, false);
  assert.notEqual(result.beforeScopeKey, result.afterScopeKey);
  assert.equal(result.rotatedScope, 'draft:after-v163');
});

test('legacy CDP compatibility accepts an empty canonical factory before first hydration', () => {
  const { legacyCdpCompatibilityExpression } = require(UTILS);
  const root = {};
  const context = vm.createContext({ structuredClone, window: root, globalThis: root });
  vm.runInContext(`
    const state = { factory: null };
    let currentFactory = null;
    const factoryRuntimeReadFactory = () => currentFactory;
    const factoryRuntimeReplaceFactorySnapshot = value => {
      currentFactory = structuredClone(value);
      return currentFactory;
    };
    const render = () => currentFactory;
    let classicRuntimeHydrationReady = true;
    let classicRuntimeInitialRenderComplete = true;
  `, context);
  Object.defineProperty(root, '__KUASANGSE_DIAGNOSTIC__', {
    value: Object.freeze({}),
    configurable: false,
  });
  const result = vm.runInContext(
    legacyCdpCompatibilityExpression(`(() => {
      window.state.factory = { product: { productName: 'first' } };
      window.render();
      return window.factoryState.product.productName;
    })()`),
    context,
  );
  assert.equal(result, 'first');
  assert.equal(vm.runInContext('currentFactory.product.productName', context), 'first');
});
