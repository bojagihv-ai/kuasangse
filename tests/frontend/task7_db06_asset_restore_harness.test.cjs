const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const { buildAssetChecks, buildAssetSeed } = require('../../tools/factory_asset_restore_harness_utils.cjs');
const { selectAssetCdpTarget } = require('../../tools/verify_factory_candidate_asset_restore_v224.cjs');

function validProof(seed) {
  const current = { scope: seed.currentScope, identity: seed.currentIdentity, canApply: true };
  const foreign = { scope: seed.foreignScope, identity: seed.foreignIdentity, canApply: false };
  return {
    expected: seed,
    applied: true,
    appWorkspaceId: seed.projectId,
    factoryWorkspaceId: seed.projectId,
    currentScope: seed.currentScope,
    db: [current, foreign],
    cafe24: [current, foreign],
    buttons: {
      dbDraft: { exists: true, disabled: false },
      cafeDraft: { exists: true, disabled: false },
      dbForeign: { exists: true, disabled: true },
      cafeForeign: { exists: true, disabled: true },
    },
    cleanup: { cdpClosed: true, runtimeCleaned: true, errors: [] },
  };
}

test('DB-06 asset checks reject scope, button, and cleanup drift by stable code', () => {
  const seed = buildAssetSeed(22406);
  const proof = validProof(seed);
  assert.equal(Object.values(buildAssetChecks(proof)).every(check => check.ok), true);

  const draftDrift = structuredClone(proof);
  draftDrift.db[0].scope = seed.draftScope;
  assert.equal(buildAssetChecks(draftDrift).migratedIdentity.ok, false);

  const enabledForeign = structuredClone(proof);
  enabledForeign.cafe24[1].canApply = true;
  assert.equal(buildAssetChecks(enabledForeign).foreignDisabled.ok, false);

  const missingButton = structuredClone(proof);
  missingButton.buttons.dbDraft.exists = false;
  assert.equal(buildAssetChecks(missingButton).currentEnabled.ok, false);

  const cleanupFailure = structuredClone(proof);
  cleanupFailure.cleanup.errors.push({ stage: 'runtime-cleanup', error: 'injected' });
  assert.equal(buildAssetChecks(cleanupFailure).lifecycleCleanup.ok, false);
});

test('DB-06 verifier does not reintroduce legacy window state hooks', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'verify_factory_candidate_asset_restore_v224.cjs'), 'utf8');
  const legacyHooks = ['window.__' + 'kuasangseState', 'window.' + 'factoryState', 'window.' + 'render'];
  assert.equal(legacyHooks.some(hook => source.includes(hook)), false);
  assert.equal(source.includes('factoryCdpFixtureReadyExpression'), true);
  assert.equal(source.includes('evaluateFactoryCdpFixture'), true);
});

test('DB-06 verifier rejects a missing CDP page target before opening transport', () => {
  assert.throws(
    () => selectAssetCdpTarget({ targets: [{ type: 'service_worker' }] }),
    /CDP page target not found/,
  );
});
