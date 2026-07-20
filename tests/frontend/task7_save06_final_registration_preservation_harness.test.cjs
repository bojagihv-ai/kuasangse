const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  buildFinalRegistrationChecks,
  buildFinalRegistrationSeed,
} = require('../../tools/factory_final_registration_preservation_harness_utils.cjs');
const {
  selectFinalRegistrationCdpTarget,
} = require('../../tools/verify_factory_final_registration_preserves_work_v225.cjs');

function validProof(seed) {
  const preserved = {
    stateProductName: seed.workProductName,
    productName: seed.workProductName,
    userProductName: seed.workProductName,
    productKey: seed.workProductName,
    dbCandidates: 1,
    cafe24Candidates: 1,
    usage: seed.usage,
    activeAssets: 2,
    rejectedAssets: 0,
  };
  return {
    expected: seed,
    before: preserved,
    after: {
      ...preserved,
      registrationProductName: seed.registrationProductName,
      finalDbProductName: seed.registrationProductName,
      registrationPanelProductName: seed.registrationProductName,
    },
    failureResult: false,
    successResult: true,
    externalCalls: 2,
    afterFailureAndSuccess: preserved,
    cleanup: { cdpClosed: true, runtimeCleaned: true, errors: [] },
  };
}

test('SAVE-06 checks reject current-work, registration, path, and cleanup drift by stable code', () => {
  const seed = buildFinalRegistrationSeed(22506);
  const proof = validProof(seed);
  assert.equal(Object.values(buildFinalRegistrationChecks(proof)).every(check => check.ok), true);

  const currentWorkDrift = structuredClone(proof);
  currentWorkDrift.after.productKey = 'foreign-product';
  assert.equal(buildFinalRegistrationChecks(currentWorkDrift).productKeyPreserved.ok, false);

  const registrationDrift = structuredClone(proof);
  registrationDrift.after.finalDbProductName = seed.workProductName;
  assert.equal(buildFinalRegistrationChecks(registrationDrift).payloadProductName.ok, false);

  const pathDrift = structuredClone(proof);
  pathDrift.externalCalls = 1;
  assert.equal(buildFinalRegistrationChecks(pathDrift).successAndFailurePaths.ok, false);

  const cleanupDrift = structuredClone(proof);
  cleanupDrift.cleanup.errors.push({ stage: 'runtime-cleanup', error: 'injected' });
  assert.equal(buildFinalRegistrationChecks(cleanupDrift).lifecycleCleanup.ok, false);
});

test('SAVE-06 verifier uses canonical fixture reads instead of legacy window state hooks', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'tools', 'verify_factory_final_registration_preserves_work_v225.cjs'),
    'utf8',
  );
  const legacyHooks = ['window.' + 'state', 'window.' + 'factoryState'];
  assert.equal(legacyHooks.some(hook => source.includes(hook)), false);
  assert.equal(source.includes('factoryCdpFixtureReadyExpression'), true);
  assert.equal(source.includes('evaluateFactoryCdpFixture'), true);
});

test('SAVE-06 verifier rejects a missing CDP page target before opening transport', () => {
  assert.throws(
    () => selectFinalRegistrationCdpTarget({ targets: [{ type: 'service_worker' }] }),
    /CDP page target not found/,
  );
});
