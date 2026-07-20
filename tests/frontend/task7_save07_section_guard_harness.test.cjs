const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  assertSafeSectionGuardTempDir,
  buildSectionGuardChecks,
  buildSectionGuardSeed,
  minimalSectionGuardSnapshot,
} = require('../../tools/factory_section_guard_harness_utils.cjs');

function validProof(seed) {
  return {
    expected: seed,
    lease: { granted: true, leaseId: 'lease-save07', fencingToken: 7, revision: 0 },
    seedResponse: { status: 200, body: { ok: true, accepted: true, revision: 1 } },
    sectionDrop: { status: 200, body: { ok: true, accepted: false, keptExisting: true } },
    identityDrift: { status: 200, body: { ok: true, accepted: false, keptExisting: true } },
    incompleteBootstrap: { status: 200, body: { ok: true, accepted: false, keptExisting: true } },
    after: {
      status: 200,
      body: { ok: true, hasSnapshot: true, revision: 1, snapshot: structuredClone(seed.snapshot) },
    },
    cleanup: { backendStopped: true, portReleased: true, tempRemoved: true, errors: [] },
  };
}

test('SAVE-07 checks reject guard, identity, revision, and cleanup drift by stable code', () => {
  const seed = buildSectionGuardSeed(22707);
  const proof = validProof(seed);
  assert.equal(Object.values(buildSectionGuardChecks(proof)).every(check => check.ok), true);

  const acceptedDrop = structuredClone(proof);
  acceptedDrop.sectionDrop.body.accepted = true;
  assert.equal(buildSectionGuardChecks(acceptedDrop).sectionDropRejected.ok, false);

  const identityDrift = structuredClone(proof);
  identityDrift.after.body.snapshot.assets.factory.product.productKey = 'foreign-product';
  assert.equal(buildSectionGuardChecks(identityDrift).identityPreserved.ok, false);

  const revisionDrift = structuredClone(proof);
  revisionDrift.after.body.revision = 2;
  assert.equal(buildSectionGuardChecks(revisionDrift).revisionPreserved.ok, false);

  const cleanupDrift = structuredClone(proof);
  cleanupDrift.cleanup.portReleased = false;
  assert.equal(buildSectionGuardChecks(cleanupDrift).lifecycleCleanup.ok, false);
});

test('SAVE-07 minimal snapshots express section loss without mutating the seed', () => {
  const seed = buildSectionGuardSeed(22708);
  const dropped = minimalSectionGuardSnapshot(seed.snapshot, { dropSections: true });
  const incomplete = minimalSectionGuardSnapshot(seed.snapshot, { dropSections: true, incompleteIdentity: true });
  assert.equal(Object.keys(dropped.assets.sectionImages).length, 1);
  assert.equal(Object.keys(dropped.assets.sectionContents).length, 1);
  assert.deepEqual(incomplete.assets.factory.product, {});
  assert.equal(Object.keys(seed.snapshot.assets.sectionImages).length, 15);
});

test('SAVE-07 temp cleanup accepts only its owned os.tmpdir prefix', () => {
  const safe = path.join(os.tmpdir(), 'kuasangse-save07-contract');
  assert.equal(assertSafeSectionGuardTempDir(safe), path.resolve(safe));
  assert.throws(
    () => assertSafeSectionGuardTempDir(path.join(ROOT, 'backend', '.local')),
    /unsafe SAVE-07 temp directory/,
  );
});

test('SAVE-07 verifier owns an isolated backend and has no real workspace defaults', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'verify_last_work_section_guard_v227.cjs'), 'utf8');
  assert.equal(source.includes('127.0.0.1:' + '5050'), false);
  assert.equal(source.includes('project_mrm2jesp_6sr4ib'), false);
  assert.equal(source.includes('launchIsolatedSectionGuardBackend'), true);
  assert.equal(source.includes("proc.once('error'"), true);
  assert.equal(source.includes('safeRemoveSectionGuardTempDir'), true);
  assert.equal(source.includes('portReleased'), true);
  assert.equal(source.includes('if (require.main === module)'), true);
});
