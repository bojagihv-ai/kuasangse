const os = require('node:os');
const path = require('node:path');

function buildSectionGuardSeed(seedValue = Date.now()) {
  const seed = String(seedValue);
  const workspaceId = `project:save07_section_guard_${seed}`;
  const productKey = `슬라브나비수저집-${seed}`;
  const currentRunId = `save07-run-${seed}`;
  const inputImageFingerprint = `save07-input-${seed}`;
  const sectionIds = Array.from({ length: 15 }, (_, index) => `section-${index + 1}`);
  const factoryAssets = sectionIds.map((sectionId, index) => ({
    id: `save07-asset-${index + 1}-${seed}`,
    stageId: index === 0 ? 'hero' : 'detail',
    workspaceId,
    productKey,
    currentRunId,
    inputImageFingerprint,
    rejected: false,
  }));
  const snapshot = {
    id: 'current',
    savedAt: Number(seedValue) || Date.now(),
    workspaceId,
    workspaceScope: { id: workspaceId },
    assets: {
      sectionImages: Object.fromEntries(sectionIds.map(id => [id, `save07-image:${id}`])),
      sectionContents: Object.fromEntries(sectionIds.map(id => [id, { title: id, body: `SAVE-07 ${id}` }])),
      factory: {
        workspace: { id: workspaceId },
        product: { productKey, currentRunId, inputImageFingerprint },
        assets: factoryAssets,
      },
    },
  };
  return {
    workspaceId,
    ownerId: `save07-owner-${seed}`,
    sessionId: `save07-session-${seed}`,
    productKey,
    currentRunId,
    inputImageFingerprint,
    sectionCount: 15,
    assetCount: 15,
    snapshot,
  };
}

function protectedSectionGuardIdentity(snapshot) {
  const product = snapshot?.assets?.factory?.product || {};
  return {
    productKey: product.productKey || '',
    currentRunId: product.currentRunId || '',
    inputImageFingerprint: product.inputImageFingerprint || product.lockedInputImageFingerprint || '',
  };
}

function minimalSectionGuardSnapshot(snapshot, options = {}) {
  const clone = structuredClone(snapshot);
  const sectionIds = Object.keys(clone.assets?.sectionImages || {});
  const keptIds = options.dropSections ? sectionIds.slice(0, 1) : sectionIds;
  clone.savedAt = Date.now();
  clone.assets.sectionImages = Object.fromEntries(keptIds.map(id => [id, clone.assets.sectionImages[id]]));
  clone.assets.sectionContents = Object.fromEntries(keptIds.map(id => [id, clone.assets.sectionContents[id]]));
  if (options.incompleteIdentity) {
    clone.assets.factory.product = {};
  } else if (options.productKey) {
    clone.assets.factory.product.productKey = options.productKey;
  }
  return clone;
}

function assertSafeSectionGuardTempDir(targetPath) {
  const resolved = path.resolve(String(targetPath || ''));
  const tempRoot = path.resolve(os.tmpdir());
  const prefix = `${tempRoot}${path.sep}`;
  if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('kuasangse-save07-')) {
    throw new Error(`unsafe SAVE-07 temp directory: ${resolved}`);
  }
  return resolved;
}

function check(code, ok, message) {
  return Object.freeze({ code, ok: ok === true, message });
}

function rejected(response) {
  return response?.status === 200
    && response.body?.ok === true
    && response.body?.accepted === false
    && response.body?.keptExisting === true;
}

function buildSectionGuardChecks(proof) {
  const expected = proof.expected || {};
  const after = proof.after?.body || {};
  const snapshot = after.snapshot || {};
  const identity = protectedSectionGuardIdentity(snapshot);
  const sectionImages = Object.keys(snapshot.assets?.sectionImages || {}).length;
  const sectionContents = Object.keys(snapshot.assets?.sectionContents || {}).length;
  return Object.freeze({
    leaseAcquired: check('leaseAcquired', proof.lease?.granted === true && !!proof.lease?.leaseId && Number(proof.lease?.fencingToken) > 0 && Number(proof.lease?.revision) === 0, `SAVE-07 lease 획득 실패: ${JSON.stringify(proof.lease)}`),
    seedAccepted: check('seedAccepted', proof.seedResponse?.status === 200 && proof.seedResponse?.body?.accepted === true && Number(proof.seedResponse?.body?.revision) === 1, `SAVE-07 15개 섹션 seed 저장 실패: ${JSON.stringify(proof.seedResponse)}`),
    sectionDropRejected: check('sectionDropRejected', rejected(proof.sectionDrop), `섹션 손실 저장이 거부되지 않았습니다: ${JSON.stringify(proof.sectionDrop)}`),
    identityDriftRejected: check('identityDriftRejected', rejected(proof.identityDrift), `제품 기준 변경 저장이 거부되지 않았습니다: ${JSON.stringify(proof.identityDrift)}`),
    incompleteBootstrapRejected: check('incompleteBootstrapRejected', rejected(proof.incompleteBootstrap), `불완전 부팅 저장이 거부되지 않았습니다: ${JSON.stringify(proof.incompleteBootstrap)}`),
    identityPreserved: check('identityPreserved', identity.productKey === expected.productKey && identity.currentRunId === expected.currentRunId && identity.inputImageFingerprint === expected.inputImageFingerprint, `손실 저장 시도 후 작업 identity가 바뀌었습니다: ${JSON.stringify(identity)}`),
    sectionsPreserved: check('sectionsPreserved', sectionImages === expected.sectionCount && sectionContents === expected.sectionCount, `손실 저장 시도 후 섹션이 줄었습니다: ${JSON.stringify({ sectionImages, sectionContents })}`),
    revisionPreserved: check('revisionPreserved', proof.after?.status === 200 && after.hasSnapshot === true && Number(after.revision) === 1, `거부된 저장이 revision을 진행시켰습니다: ${JSON.stringify(proof.after)}`),
    lifecycleCleanup: check('lifecycleCleanup', proof.cleanup?.backendStopped === true && proof.cleanup?.portReleased === true && proof.cleanup?.tempRemoved === true && Array.isArray(proof.cleanup?.errors) && proof.cleanup.errors.length === 0, `SAVE-07 격리 lifecycle cleanup 실패: ${JSON.stringify(proof.cleanup)}`),
  });
}

module.exports = {
  assertSafeSectionGuardTempDir,
  buildSectionGuardChecks,
  buildSectionGuardSeed,
  minimalSectionGuardSnapshot,
  protectedSectionGuardIdentity,
};
