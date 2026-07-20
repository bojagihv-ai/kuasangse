function normalizeIdentityText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function buildAssetSeed(seedValue = Date.now()) {
  const seed = String(seedValue);
  const projectId = `project_asset_restore_target_v224_${seed}`;
  const productName = `자산복원 후보검증 수저집 ${seed}`;
  const productKey = normalizeIdentityText(productName);
  const runId = `asset-restore-run-v224-${seed}`;
  const fingerprint = `asset-restore-image-v224-${seed}`;
  const draftWorkspaceId = `draft:lastwork_asset_restore_v224_${seed}`;
  const foreignWorkspaceId = `project_asset_restore_foreign_v224_${seed}`;
  const scope = workspaceId => `${workspaceId}::${productKey}::candidate-review`;
  const identity = workspaceId => `${workspaceId}::${runId}::${productKey}::${fingerprint}::candidate-review`;
  const candidate = (kind, workspaceId, label) => kind === 'db'
    ? { jcode: `DB-ASSET-${label}-V224`, jname: label, product_name: label, match_query: productName, reviewProductName: productName, reviewProductScopeKey: scope(workspaceId), reviewProductIdentityKey: identity(workspaceId) }
    : { product_no: `C24-ASSET-${label}-V224`, product_code: `C24-ASSET-${label}-V224`, product_name: label, match_query: productName, reviewProductName: productName, reviewProductScopeKey: scope(workspaceId), reviewProductIdentityKey: identity(workspaceId) };
  const db = [candidate('db', draftWorkspaceId, 'DRAFT'), candidate('db', foreignWorkspaceId, 'FOREIGN')];
  const cafe24 = [candidate('cafe24', draftWorkspaceId, 'DRAFT'), candidate('cafe24', foreignWorkspaceId, 'FOREIGN')];
  const factory = {
    workspace: { id: projectId, name: productName, createdAt: 1735689600000 },
    currentProjectId: projectId,
    currentProjectName: productName,
    product: {
      productName, userProductName: productName, productKey, productIdentityKey: productKey,
      currentRunId: runId, generationRunId: runId, inputImageFingerprint: fingerprint,
      lockedInputImageFingerprint: fingerprint,
      dbCandidates: [], pendingDbCandidates: [],
      cafe24Candidates: [], pendingCafe24Candidates: [],
    },
    automation: { activeTab: 'db' },
  };
  const serverAssets = {
    workspaceScope: { id: `project:${projectId}` },
    currentProjectId: projectId,
    currentProjectName: productName,
    productName,
    factory: {
      ...factory,
      product: {
        ...factory.product,
        pendingDbCandidates: db,
        pendingCafe24Candidates: cafe24,
      },
    },
  };
  return {
    projectId, productName, productKey, runId, fingerprint,
    draftWorkspaceId, foreignWorkspaceId,
    currentScope: scope(projectId), currentIdentity: identity(projectId),
    draftScope: scope(draftWorkspaceId), draftIdentity: identity(draftWorkspaceId),
    foreignScope: scope(foreignWorkspaceId), foreignIdentity: identity(foreignWorkspaceId),
    factory, serverAssets,
  };
}

function check(code, ok, message) {
  return Object.freeze({ code, ok: ok === true, message });
}

function buildAssetChecks(proof) {
  const expected = proof.expected || {};
  return Object.freeze({
    assetApplied: check('assetApplied', proof.applied === true, `서버 자산 복원이 적용되지 않았습니다: ${JSON.stringify(proof)}`),
    scope: check('scope', proof.appWorkspaceId === expected.projectId && proof.factoryWorkspaceId === expected.projectId && proof.currentScope === expected.currentScope, `asset app/factory scope 불일치: ${JSON.stringify(proof)}`),
    migratedIdentity: check('migratedIdentity', proof.db?.[0]?.scope === expected.currentScope && proof.cafe24?.[0]?.scope === expected.currentScope && proof.db?.[0]?.identity === expected.currentIdentity && proof.cafe24?.[0]?.identity === expected.currentIdentity, `asset draft 후보 project scope/identity migration 불일치: ${JSON.stringify({ db: proof.db?.[0], cafe24: proof.cafe24?.[0] })}`),
    currentEnabled: check('currentEnabled', proof.db?.[0]?.canApply === true && proof.cafe24?.[0]?.canApply === true && proof.buttons?.dbDraft?.exists === true && proof.buttons.dbDraft.disabled === false && proof.buttons?.cafeDraft?.exists === true && proof.buttons.cafeDraft.disabled === false, `asset current 후보 또는 버튼이 비활성입니다: ${JSON.stringify(proof.buttons)}`),
    foreignIdentity: check('foreignIdentity', proof.db?.[1]?.scope === expected.foreignScope && proof.cafe24?.[1]?.scope === expected.foreignScope && proof.db?.[1]?.identity === expected.foreignIdentity && proof.cafe24?.[1]?.identity === expected.foreignIdentity, `asset foreign 후보 scope/identity 보존 실패: ${JSON.stringify({ db: proof.db?.[1], cafe24: proof.cafe24?.[1] })}`),
    foreignDisabled: check('foreignDisabled', proof.db?.[1]?.canApply === false && proof.cafe24?.[1]?.canApply === false && proof.buttons?.dbForeign?.exists === true && proof.buttons.dbForeign.disabled === true && proof.buttons?.cafeForeign?.exists === true && proof.buttons.cafeForeign.disabled === true, `asset foreign 후보 또는 버튼이 잘못 활성화됐습니다: ${JSON.stringify(proof.buttons)}`),
    lifecycleCleanup: check('lifecycleCleanup', proof.cleanup?.cdpClosed === true && proof.cleanup.runtimeCleaned === true && Array.isArray(proof.cleanup.errors) && proof.cleanup.errors.length === 0, `asset cleanup lifecycle 실패: ${JSON.stringify(proof.cleanup)}`),
  });
}

module.exports = { buildAssetChecks, buildAssetSeed, normalizeIdentityText };
