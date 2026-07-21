const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const UTILS = path.join(ROOT, 'tools', 'factory_cdp_test_utils.cjs');
const { buildRestoreRecoveryChecks } = require('../../tools/verify_factory_candidate_restore_recovery_v221.cjs');

test('DB-04 check boundary rejects non-exact fence and empty recovery evidence', () => {
  const scope = 'project::product::candidate-review';
  const identity = 'project::run::product::image::candidate-review';
  const backend = { status: 200, hasSnapshot: false, workspaceId: 'project:project', revision: 0, bodyLength: 10, sha256: 'backend' };
  const recovery = { rawLength: 10, rawSha256: 'recovery', revisionsLength: 12, revisionsSha256: 'revisions' };
  const candidate = { scope, identity, canApply: true };
  const foreign = { scope: 'foreign::product::candidate-review', identity: 'foreign::run::product::image::candidate-review', canApply: false };
  const proof = {
    expected: { projectId: 'project', draftScope: 'draft::product::candidate-review', currentScope: scope, foreignScope: foreign.scope, currentIdentity: identity, foreignIdentity: foreign.identity },
    normalizedDraftScope: 'draft::product::candidate-review', appWorkspaceId: 'project', factoryWorkspaceId: 'project', currentScope: scope,
    before: { token: { fence: 4 }, recovery, scopedBackend: backend, globalBackend: backend },
    after: { token: { version: 'factory-store:v1', workspaceId: 'project', revision: 0, fence: 5 }, recovery: { ...recovery }, scopedBackend: { ...backend }, globalBackend: { ...backend } },
    sentinel: { recoverySha256: 'recovery', revisionsSha256: 'revisions' }, cleanup: { recoveryRestored: true, revisionsRestored: true, authorityReleased: true },
    db: [candidate, foreign], cafe24: [candidate, foreign],
    buttons: { dbDraft: { exists: true, disabled: false }, cafeDraft: { exists: true, disabled: false }, dbForeign: { exists: true, disabled: true }, cafeForeign: { exists: true, disabled: true } },
  };
  assert.equal(buildRestoreRecoveryChecks(proof).every(check => check.ok), true);
  proof.after.token.fence = 6;
  assert.equal(buildRestoreRecoveryChecks(proof)[2].ok, false);
  proof.after.token.fence = 5;
  proof.before.recovery.rawLength = 0;
  assert.equal(buildRestoreRecoveryChecks(proof)[7].ok, false);
});

test('DB-04 canonical fixture exposes the actual factory store token boundary', async () => {
  const { createFactoryStore } = await import(`${pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-store.mjs')).href}?db04=${Date.now()}`);
  const store = createFactoryStore({
    workspaceId: 'draft:db04',
    initialSnapshot: { factory: { workspace: { id: 'draft:db04' }, product: {} } },
  });
  try {
    const context = vm.createContext({
      structuredClone,
      state: { currentProjectId: '' },
      factoryRuntimeStore: store,
      factoryRuntimeReadFactory: () => store.getSnapshot().factory,
      factoryRuntimeReplaceFactorySnapshot(value, options = {}) {
        if (options.mode === 'hydrate') {
          store.switchWorkspace(options.workspaceId, { snapshot: { factory: structuredClone(value) }, revision: 0 });
        } else {
          store.replaceSnapshot({ factory: structuredClone(value) }, { owner: 'factory', expectedRevision: store.getOperationToken().revision });
        }
        return store.getSnapshot().factory;
      },
      render: () => 'rendered',
      classicRuntimeHydrationReady: true,
      classicRuntimeInitialRenderComplete: true,
    });
    const { factoryCdpFixtureExpression, factoryCdpFixtureReadyExpression } = require(UTILS);
    assert.equal(vm.runInContext(factoryCdpFixtureReadyExpression(), context), true);
    const proof = vm.runInContext(factoryCdpFixtureExpression(`({ readFactory, readOperationToken, replaceFactory }) => {
      const before = readOperationToken();
      replaceFactory({ workspace: { id: 'project:db04' }, product: {} }, { mode: 'hydrate', workspaceId: 'project:db04' });
      const after = readOperationToken();
      return { before, after, workspaceId: readFactory().workspace.id };
    }`), context);
    assert.equal(proof.before.workspaceId, 'draft:db04');
    assert.equal(proof.after.workspaceId, 'project:db04');
    assert.equal(proof.after.revision, 0);
    assert.equal(proof.after.fence, proof.before.fence + 1);
    assert.equal(proof.workspaceId, 'project:db04');
  } finally {
    store.dispose();
  }
});
