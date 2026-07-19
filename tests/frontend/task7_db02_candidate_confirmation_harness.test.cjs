const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const UTILS = path.join(ROOT, 'tools', 'factory_cdp_test_utils.cjs');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');
const CAFE24_SYNC = path.join(ROOT, 'src', 'cafe24-sync.js');
const FACTORY_STORE = path.join(ROOT, 'src', 'modules', 'factory-store.mjs');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} definition is required`);
  const parameterClose = source.indexOf(')', start);
  const braceStart = source.indexOf('{', parameterClose);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} boundary is incomplete`);
}

function canonicalCandidateFunctions() {
  const core03 = fs.readFileSync(CORE_03, 'utf8');
  const core05 = fs.readFileSync(CORE_05, 'utf8');
  const sync = fs.readFileSync(CAFE24_SYNC, 'utf8');
  return [
    extractFunction(core03, 'factoryWorkspaceIdentityFromSource'),
    extractFunction(core03, 'factoryCurrentWorkspaceId'),
    extractFunction(core03, 'factoryNormalizeIdentityText'),
    extractFunction(core03, 'factoryCurrentProductKey'),
    extractFunction(sync, 'factoryCaptureLockedProductName'),
    extractFunction(sync, 'factoryCandidateReviewScope'),
    extractFunction(sync, 'factoryCandidateReviewScopeKey'),
    extractFunction(sync, 'factoryCandidateReviewScopeKeyFromCandidate'),
    extractFunction(sync, 'factoryCandidateReviewCanApply'),
    extractFunction(core05, 'factorySinhwaCandidateKey'),
  ].join('\n');
}

test('DB-02 confirmation uses the real factory store token and rejects rotated candidates', async () => {
  const { createFactoryStore } = await import(`${pathToFileURL(FACTORY_STORE).href}?db02=${Date.now()}`);
  const currentScope = 'project:db02-current';
  const rotatedScope = 'project:db02-rotated';
  const store = createFactoryStore({
    workspaceId: currentScope,
    revision: 0,
    initialSnapshot: {
      factory: {
        workspace: { id: currentScope, name: 'DB02 후보 확인 상품' },
        currentProjectId: currentScope,
        product: {
          productName: 'DB02 후보 확인 상품',
          userProductName: 'DB02 후보 확인 상품',
          productKey: 'db02후보확인상품',
          currentRunId: 'run:db02',
          inputImageFingerprint: 'input:db02',
        },
      },
    },
  });
  const replaceFactorySnapshot = (value, options = {}) => {
    const factory = structuredClone(value);
    if (options.mode === 'hydrate') {
      store.switchWorkspace(String(options.workspaceId), { snapshot: { factory }, revision: 0 });
    } else {
      store.replaceSnapshot({ factory }, {
        owner: 'factory',
        expectedRevision: store.getOperationToken().revision,
      });
    }
    return store.getSnapshot().factory;
  };
  const switchWorkspaceSnapshot = (scope, value) => store.switchWorkspace(
    String(scope), { snapshot: { factory: structuredClone(value) }, revision: 0 },
  );
  const context = vm.createContext({
    structuredClone,
    store,
    currentScope,
    rotatedScope,
    replaceFactorySnapshot,
    switchWorkspaceSnapshot,
  });
  vm.runInContext(`${canonicalCandidateFunctions()}
    const state = { currentProjectId: '${currentScope}', productName: 'DB02 후보 확인 상품' };
    const factoryRuntimeReadFactory = () => store.getSnapshot().factory;
    const factoryRuntimeReplaceFactorySnapshot = (value, options = {}) => replaceFactorySnapshot(value, options);
    const factoryRuntimeStore = store;
    const render = () => 'db02-rendered';
    let classicRuntimeHydrationReady = true;
    let classicRuntimeInitialRenderComplete = true;
    function getCurrentLastWorkWorkspaceScope() { return store.getOperationToken().workspaceId; }
    function factoryIdentityKeysCompatible(a, b) {
      return factoryNormalizeIdentityText(a) === factoryNormalizeIdentityText(b);
    }
    function factoryIdentityKey() { return ''; }
    function factoryCurrentProductIdentityMeta() { return {}; }
    function factoryCandidateReviewIdentityKey() { return ''; }
  `, context);

  const { factoryCdpFixtureExpression, factoryCdpFixtureReadyExpression } = require(UTILS);
  assert.equal(vm.runInContext(factoryCdpFixtureReadyExpression(), context), true);
  const result = vm.runInContext(factoryCdpFixtureExpression(`({
    setAppState,
    readAppState,
    cloneFactory,
    readFactory,
    readOperationToken,
    replaceFactory,
    renderApp,
  }) => {
    const candidate = {
      jcode: 'DB02-JCODE',
      product_name: '신화사 DB02 후보',
      reviewProductName: state.productName,
    };
    const draft = cloneFactory();
    const scopeKey = factoryCandidateReviewScopeKey(draft);
    candidate.reviewProductScopeKey = scopeKey;
    const candidateKey = factorySinhwaCandidateKey(candidate);
    draft.product.selectedDbCandidateKey = candidateKey;
    draft.product.confirmedDb = { ...candidate, selected: true };
    draft.product.dbCandidateResolution = 'selected';
    draft.product.dbCandidates = [candidate];
    replaceFactory(draft, { mode: 'candidate-confirmation', workspaceId: currentScope });
    const roundTrip = readFactory();
    const token = readOperationToken();
    const currentSelectable = factoryCandidateReviewCanApply(candidate, roundTrip);
    const rendered = renderApp();

    setAppState({ currentProjectId: rotatedScope });
    const rotated = cloneFactory();
    rotated.workspace = { ...rotated.workspace, id: rotatedScope };
    rotated.currentProjectId = rotatedScope;
    switchWorkspaceSnapshot(rotatedScope, rotated);
    const rotatedToken = readOperationToken();
    const staleSelectable = factoryCandidateReviewCanApply(candidate, readFactory());
    const rotatedScopeKey = factoryCandidateReviewScopeKey(readFactory());
    return {
      candidateKey,
      scopeKey,
      rotatedScopeKey,
      currentSelectable,
      staleSelectable,
      rendered,
      selectedDbCandidateKey: roundTrip.product.selectedDbCandidateKey,
      confirmedDbSelected: roundTrip.product.confirmedDb?.selected === true,
      dbResolution: roundTrip.product.dbCandidateResolution,
      token,
      rotatedToken,
      appWorkspaceId: readAppState().currentProjectId,
    };
  }`), context);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    candidateKey: 'DB02-JCODE',
    scopeKey: 'project:db02-current::db02후보확인상품::candidate-review',
    rotatedScopeKey: 'project:db02-rotated::db02후보확인상품::candidate-review',
    currentSelectable: true,
    staleSelectable: false,
    rendered: 'db02-rendered',
    selectedDbCandidateKey: 'DB02-JCODE',
    confirmedDbSelected: true,
    dbResolution: 'selected',
    token: {
      version: 'factory-store:v1',
      workspaceId: 'project:db02-current',
      revision: 1,
      fence: 2,
    },
    rotatedToken: {
      version: 'factory-store:v1',
      workspaceId: 'project:db02-rotated',
      revision: 0,
      fence: 3,
    },
    appWorkspaceId: 'project:db02-rotated',
  });
  for (const legacyAlias of ['factoryState', 'saveLastWorkNow', 'render']) {
    assert.equal(Object.hasOwn(context, legacyAlias), false, `${legacyAlias} must remain lexical-only`);
  }
  store.dispose();
});
