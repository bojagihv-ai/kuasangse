const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, 'src', 'app-core-03.js');
const SYNC = path.join(ROOT, 'src', 'cafe24-sync.js');
const UTILS = path.join(ROOT, 'tools', 'factory_cdp_test_utils.cjs');
const TRANSITION_UTILS = path.join(ROOT, 'tools', 'factory_workspace_transition_harness_utils.cjs');
const VERIFIER = path.join(ROOT, 'tools', 'verify_factory_candidate_workspace_transition_v220.cjs');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} definition is required`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} boundary is incomplete`);
}

function canonicalTransitionFunctions() {
  // 이 VM 검사는 순수 scope/identity 경계만 production source에서 추출한다.
  // 비동기 DB/Cafe24 apply와 persistence는 구현을 복제하지 않고 실제 CDP verifier가 직접 실행한다.
  const core = fs.readFileSync(CORE, 'utf8');
  const sync = fs.readFileSync(SYNC, 'utf8');
  return [
    extractFunction(core, 'factoryWorkspaceIdentityFromSource'),
    extractFunction(core, 'factoryCurrentWorkspaceId'),
    extractFunction(core, 'factoryNormalizeIdentityText'),
    extractFunction(core, 'factoryIdentityKeysCompatible'),
    extractFunction(core, 'factoryCurrentProductKey'),
    extractFunction(core, 'factoryStampWorkspaceIdentity'),
    extractFunction(core, 'factoryReviewCandidateWorkspaceId'),
    extractFunction(core, 'factoryReviewCandidateProductKey'),
    extractFunction(core, 'factoryMigrateReviewCandidateWorkspaceScope'),
    extractFunction(sync, 'factoryCaptureLockedProductName'),
    extractFunction(sync, 'factoryCandidateReviewScope'),
    extractFunction(sync, 'factoryCandidateReviewScopeKey'),
    extractFunction(sync, 'factoryCandidateReviewScopeKeyFromCandidate'),
    extractFunction(sync, 'factoryCandidateReviewIdentityKey'),
    extractFunction(sync, 'factoryCandidateReviewCanApply'),
  ].join('\n');
}

test('DB-03 cleanup accepts only its exact hashed scoped path', () => {
  const { resolveTestScopePaths } = require(TRANSITION_UTILS);
  const scope = 'project:project_db03_cleanup_123';
  const expected = resolveTestScopePaths(scope, '', ROOT);
  assert.match(expected.livePath, /pdp-last-work-scoped[\\/][a-f0-9]{64}\.json$/);
  assert.equal(expected.backupPath, expected.livePath.replace(/\.json$/, '.bak.json'));
  assert.throws(() => resolveTestScopePaths('project:user-file', '', ROOT), /rejected non-test scope/);
  assert.throws(() => resolveTestScopePaths(scope, path.join(ROOT, 'backend', '.local', 'outside.json'), ROOT), /escaped test scope/);
});

test('DB-03 verifier keeps both migrated candidate buttons present and enabled', () => {
  const source = fs.readFileSync(VERIFIER, 'utf8');
  assert.match(source, /button\('\[data-factory-apply-db-candidate="0"\]'\)/);
  assert.match(source, /button\('\[data-factory-apply-cafe24-candidate="0"\]'\)/);
  assert.match(source, /buttons\?\.db\?\.exists === true && seedResult\.afterTransition\.buttons\.db\.disabled === false/);
  assert.match(source, /buttons\?\.cafe24\?\.exists === true && seedResult\.afterTransition\.buttons\.cafe24\.disabled === false/);
});

test('DB-03 transition uses the real factory store and production candidate scope functions', async () => {
  const { createFactoryStore } = await import(`${pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-store.mjs')).href}?db03=${Date.now()}`);
  const draftScope = 'draft:db03-transition';
  const projectScope = 'project:db03-transition-saved';
  const productName = 'DB03 저장 전환 후보';
  const productKey = 'db03저장전환후보';
  const store = createFactoryStore({
    workspaceId: draftScope,
    initialSnapshot: { factory: { workspace: { id: draftScope, name: productName }, currentProjectId: draftScope, product: { productName, userProductName: productName, productKey, productIdentityKey: productKey, currentRunId: 'db03-run', inputImageFingerprint: 'db03-input' } } },
  });
  const switchWorkspace = (workspaceId, factory, revision = 0) => store.switchWorkspace(
    workspaceId,
    { snapshot: structuredClone({ factory }), revision },
  );
  try {
    const context = vm.createContext({ structuredClone, store, switchWorkspace, draftScope, projectScope, productName, productKey, projectName: productName });
    vm.runInContext(`${canonicalTransitionFunctions()}
    const state = { currentProjectId: '', productName };
    const factoryRuntimeStore = store;
    const factoryRuntimeReadFactory = () => store.getSnapshot().factory;
    const factoryRuntimeReplaceFactorySnapshot = value => store.replaceSnapshot({ factory: structuredClone(value) }, { owner: 'factory', expectedRevision: store.getOperationToken().revision });
    const render = () => 'db03-rendered';
    let classicRuntimeHydrationReady = true;
    let classicRuntimeInitialRenderComplete = true;
    function getCurrentLastWorkWorkspaceScope() { return store.getOperationToken().workspaceId; }
    `, context);

    const { factoryCdpFixtureExpression, factoryCdpFixtureReadyExpression } = require(UTILS);
    assert.equal(vm.runInContext(factoryCdpFixtureReadyExpression(), context), true);
    const result = vm.runInContext(factoryCdpFixtureExpression(`({ readFactory, readOperationToken }) => {
    const current = structuredClone(readFactory());
    const currentScopeKey = factoryCandidateReviewScopeKey(current);
    const currentIdentityKey = factoryCandidateReviewIdentityKey?.(current) || '';
    const db = { jcode: 'DB03-JCODE', product_name: 'DB03 신화사 후보', reviewProductName: productName, reviewProductScopeKey: currentScopeKey, reviewProductIdentityKey: currentIdentityKey };
    const cafe = { product_no: 'DB03-C24', product_code: 'DB03-C24', product_name: 'DB03 Cafe24 후보', reviewProductName: productName, reviewProductScopeKey: currentScopeKey, reviewProductIdentityKey: currentIdentityKey };
    current.product.pendingDbCandidates = [db];
    current.product.dbCandidates = [db];
    current.product.pendingCafe24Candidates = [cafe];
    current.product.cafe24Candidates = [cafe];
    const beforeToken = readOperationToken();
    const oldDb = structuredClone(db);
    const oldCafe = structuredClone(cafe);
    const beforeDbSelectable = factoryCandidateReviewCanApply(oldDb, { workspace: { id: draftScope }, product: { productName, productKey } });
    const moved = factoryMigrateReviewCandidateWorkspaceScope(current, draftScope, projectScope);
    factoryStampWorkspaceIdentity(current, { projectId: projectScope, projectName });
    const movedScopeKey = factoryCandidateReviewScopeKey(current);
    switchWorkspace(projectScope, current, 0);
    state.currentProjectId = projectScope;
    const afterFactory = readFactory();
    const afterToken = readOperationToken();
    const newDb = afterFactory.product.pendingDbCandidates[0];
    const newCafe = afterFactory.product.pendingCafe24Candidates[0];
    return {
      moved,
      beforeToken,
      beforeDbSelectable,
      afterToken,
      oldDbSelectable: factoryCandidateReviewCanApply(oldDb, afterFactory),
      oldCafeSelectable: factoryCandidateReviewCanApply(oldCafe, afterFactory),
      currentDbSelectable: factoryCandidateReviewCanApply(newDb, afterFactory),
      currentCafeSelectable: factoryCandidateReviewCanApply(newCafe, afterFactory),
      movedScopeKey,
      dbScope: newDb.reviewProductScopeKey,
      cafeScope: newCafe.reviewProductScopeKey,
      workspaceId: factoryCurrentWorkspaceId(afterFactory),
      appWorkspaceId: state.currentProjectId,
    };
    }`), context);

    assert.equal(result.moved, 2);
    assert.equal(result.beforeToken.workspaceId, draftScope);
    assert.equal(result.beforeToken.revision, 0);
    assert.equal(result.afterToken.workspaceId, projectScope);
    assert.equal(result.afterToken.revision, 0);
    assert.ok(result.afterToken.fence > result.beforeToken.fence);
    assert.equal(result.beforeDbSelectable, true);
    assert.equal(result.oldDbSelectable, false);
    assert.equal(result.oldCafeSelectable, false);
    assert.equal(result.currentDbSelectable, true);
    assert.equal(result.currentCafeSelectable, true);
    assert.equal(result.dbScope, result.movedScopeKey);
    assert.equal(result.cafeScope, result.movedScopeKey);
    assert.equal(result.workspaceId, projectScope);
    assert.equal(result.appWorkspaceId, projectScope);
  } finally {
    store.dispose();
  }
});
