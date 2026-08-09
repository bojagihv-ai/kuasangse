import {
  WORK_BRANCH_SCHEMA,
  WORK_IDENTITY_SCHEMA,
  createWorkspaceWorkBranch,
  createWorkspaceWorkIdentity,
  normalizeWorkspaceWorkBranch,
  normalizeWorkspaceWorkIdentity,
  normalizedIdentityText,
  optionalWorkspaceScope,
  uniqueValues,
  workspaceWorkBranchesMatch,
  workspaceWorkIdentitiesMatch,
} from './work-identity-foundation.mjs';

export {
  WORK_BRANCH_SCHEMA,
  WORK_IDENTITY_SCHEMA,
  createWorkspaceWorkBranch,
  createWorkspaceWorkIdentity,
  workspaceWorkBranchesMatch,
  workspaceWorkIdentitiesMatch,
};

function snapshotFactories(snapshot) {
  return [snapshot?.factory, snapshot?.assetPayload?.factory]
    .filter(value => value && typeof value === 'object');
}

function snapshotWorkIdentityCandidates(snapshot) {
  return [
    snapshot?.workIdentity,
    snapshot?.assetPayload?.workIdentity,
    snapshot?.factory?.workIdentity,
    snapshot?.assetPayload?.factory?.workIdentity,
  ].filter(value => value && typeof value === 'object');
}

function snapshotWorkBranchCandidates(snapshot) {
  return [
    snapshot?.workspaceBranch,
    snapshot?.assetPayload?.workspaceBranch,
  ].filter(value => value && typeof value === 'object');
}

export function validateWorkspaceSnapshotIdentity(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return Object.freeze({ ok: false, code: 'WORK_IDENTITY_SNAPSHOT_INVALID', identity: null });
  }
  const factories = snapshotFactories(snapshot);
  const declaredScopes = uniqueValues([
    snapshot.currentProjectId,
    snapshot.workspaceScope?.id ?? snapshot.workspaceScope,
    snapshot.workspaceRevision?.scopeId,
    snapshot.assetPayload?.currentProjectId,
    snapshot.assetPayload?.workspaceScope?.id ?? snapshot.assetPayload?.workspaceScope,
    snapshot.assetPayload?.workspaceRevision?.scopeId,
    ...factories.flatMap(factory => [factory.currentProjectId, factory.workspace?.id]),
  ], optionalWorkspaceScope);
  const documentScopes = declaredScopes.filter(item => item.key.startsWith('project:'));
  const runtimeScopes = uniqueValues([
    snapshot.workspaceScope?.id ?? snapshot.workspaceScope,
    snapshot.workspaceRevision?.scopeId,
    snapshot.assetPayload?.workspaceScope?.id ?? snapshot.assetPayload?.workspaceScope,
    snapshot.assetPayload?.workspaceRevision?.scopeId,
  ], optionalWorkspaceScope);
  const branchCandidates = snapshotWorkBranchCandidates(snapshot);
  const branch = branchCandidates.length ? normalizeWorkspaceWorkBranch(branchCandidates[0]) : null;
  if (branchCandidates.length && !branch) {
    return Object.freeze({ ok: false, code: 'WORK_BRANCH_INVALID', identity: null, branch: null });
  }
  if (branch && branchCandidates.some(candidate => !workspaceWorkBranchesMatch(branch, candidate))) {
    return Object.freeze({ ok: false, code: 'WORK_BRANCH_INSTANCE_CONFLICT', identity: null, branch: null });
  }
  const scopes = branch ? documentScopes : declaredScopes;
  if (scopes.length > 1) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_SCOPE_CONFLICT',
      identity: null,
      conflicts: Object.freeze(scopes.map(item => item.value)),
    });
  }
  if (!branch && runtimeScopes.length > 1) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_SCOPE_CONFLICT',
      identity: null,
      conflicts: Object.freeze(runtimeScopes.map(item => item.value)),
    });
  }
  const allowedBranchScopes = branch
    ? new Set([branch.scopeId, branch.documentScopeId].filter(Boolean))
    : null;
  const conflictingRuntimeScopes = branch
    ? runtimeScopes.filter(item => !allowedBranchScopes.has(item.key))
    : [];
  if (conflictingRuntimeScopes.length) {
    return Object.freeze({
      ok: false,
      code: 'WORK_BRANCH_SCOPE_CONFLICT',
      identity: null,
      branch: null,
      conflicts: Object.freeze([
        branch.scopeId,
        branch.documentScopeId,
        ...conflictingRuntimeScopes.map(item => item.value),
      ].filter(Boolean)),
    });
  }
  if (branch && documentScopes.length && branch.documentScopeId !== documentScopes[0].key) {
    return Object.freeze({
      ok: false,
      code: 'WORK_BRANCH_DOCUMENT_CONFLICT',
      identity: null,
      branch: null,
      conflicts: Object.freeze([branch.documentScopeId, documentScopes[0].key]),
    });
  }
  if (branch && !documentScopes.length && branch.documentScopeId) {
    return Object.freeze({
      ok: false,
      code: 'WORK_BRANCH_DOCUMENT_CONFLICT',
      identity: null,
      branch: null,
      conflicts: Object.freeze([branch.documentScopeId]),
    });
  }

  const products = uniqueValues([
    snapshot.productName,
    ...factories.flatMap(factory => [
      factory.product?.userProductName,
      factory.product?.productName,
    ]),
  ], normalizedIdentityText);
  if (products.length > 1) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_PRODUCT_CONFLICT',
      identity: null,
      conflicts: Object.freeze(products.map(item => item.value)),
    });
  }

  const fingerprints = uniqueValues([
    snapshot.inputImageFingerprint,
    snapshot.assetPayload?.inputImageFingerprint,
    ...factories.flatMap(factory => {
      const product = factory.product || {};
      const firstInput = Array.isArray(product.inputImages) ? product.inputImages[0] || {} : {};
      return [
        product.lockedInputImageFingerprint,
        product.currentUploadImageFingerprint,
        product.inputImageFingerprint,
        firstInput.inputImageFingerprint,
      ];
    }),
  ]);
  if (fingerprints.length > 1) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_IMAGE_CONFLICT',
      identity: null,
      conflicts: Object.freeze(fingerprints.map(item => item.value)),
    });
  }

  const explicitCandidates = snapshotWorkIdentityCandidates(snapshot);
  const identity = explicitCandidates.length ? normalizeWorkspaceWorkIdentity(explicitCandidates[0]) : null;
  if (explicitCandidates.length && !identity) {
    return Object.freeze({ ok: false, code: 'WORK_IDENTITY_INVALID', identity: null });
  }
  if (identity && explicitCandidates.some(candidate => !workspaceWorkIdentitiesMatch(identity, candidate))) {
    return Object.freeze({ ok: false, code: 'WORK_IDENTITY_INSTANCE_CONFLICT', identity: null });
  }
  const identityScope = documentScopes[0]?.key || runtimeScopes[0]?.key || scopes[0]?.key || '';
  if (identity?.workspaceId && identityScope && identity.workspaceId !== identityScope) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_SCOPE_BINDING_CONFLICT',
      identity: null,
      conflicts: Object.freeze([identity.workspaceId, identityScope]),
    });
  }
  if (identity && products.length && identity.initialProductKey !== products[0].key) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_PRODUCT_BINDING_CONFLICT',
      identity: null,
      conflicts: Object.freeze([identity.initialProductName, products[0].value]),
    });
  }
  if (identity
    && identity.initialInputImageFingerprint
    && fingerprints.length
    && identity.initialInputImageFingerprint !== fingerprints[0].value) {
    return Object.freeze({
      ok: false,
      code: 'WORK_IDENTITY_IMAGE_BINDING_CONFLICT',
      identity: null,
      conflicts: Object.freeze([
        identity.initialInputImageFingerprint,
        fingerprints[0].value,
      ]),
    });
  }
  return Object.freeze({
    ok: true,
    code: identity ? 'WORK_IDENTITY_VALID' : 'WORK_IDENTITY_LEGACY_VALID',
    identity,
    branch,
    scopeId: branch?.scopeId || runtimeScopes[0]?.key || scopes[0]?.key || '',
    documentScopeId: documentScopes[0]?.key || '',
    productName: products[0]?.value || '',
    productKey: products[0]?.key || '',
    inputImageFingerprint: fingerprints[0]?.value || '',
  });
}
