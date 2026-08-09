export const WORK_IDENTITY_SCHEMA = 'kuasangse.work-identity.v1';
export const WORK_BRANCH_SCHEMA = 'kuasangse.work-branch.v1';

export function cleanText(value) {
  return String(value ?? '').trim();
}

export function normalizedIdentityText(value) {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('ko-KR');
}

export function optionalWorkspaceScope(value) {
  let cleaned = cleanText(value?.id ?? value);
  if (!cleaned) return '';
  if (/^draft:/i.test(cleaned)) {
    while (/^draft:/i.test(cleaned)) cleaned = cleaned.slice('draft:'.length).trim();
    return cleaned && !/^project:/i.test(cleaned) ? `draft:${cleaned}` : '';
  }
  while (/^project:/i.test(cleaned)) cleaned = cleaned.slice('project:'.length).trim();
  return cleaned && !/^draft:/i.test(cleaned) ? `project:${cleaned}` : '';
}

export function uniqueValues(values, normalize = cleanText) {
  const byKey = new Map();
  for (const value of values) {
    const raw = cleanText(value);
    const key = normalize(raw);
    if (raw && key && !byKey.has(key)) byKey.set(key, raw);
  }
  return [...byKey.entries()].map(([key, value]) => ({ key, value }));
}

export function createWorkspaceWorkBranch({
  branchId,
  scopeId = '',
  documentId = '',
  documentScopeId = '',
  createdAt = 0,
} = {}) {
  const id = cleanText(branchId);
  if (!id) throw new TypeError('work branch branchId is required');
  const scope = optionalWorkspaceScope(scopeId || `draft:${id}`);
  if (!scope.startsWith('draft:')) throw new TypeError('work branch scope must be a draft scope');
  const rawDocumentId = cleanText(documentId).replace(/^project:/i, '').trim();
  const documentScope = optionalWorkspaceScope(documentScopeId || (rawDocumentId ? `project:${rawDocumentId}` : ''));
  if (documentScope && !documentScope.startsWith('project:')) {
    throw new TypeError('work branch document scope must be a project scope');
  }
  if (rawDocumentId && documentScope !== `project:${rawDocumentId}`) {
    throw new TypeError('work branch document id must match its document scope');
  }
  const timestamp = Number(createdAt);
  return Object.freeze({
    schema: WORK_BRANCH_SCHEMA,
    branchId: id,
    scopeId: scope,
    documentId: rawDocumentId,
    documentScopeId: documentScope,
    createdAt: Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : 0,
  });
}

export function normalizeWorkspaceWorkBranch(value) {
  if (!value || typeof value !== 'object' || value.schema !== WORK_BRANCH_SCHEMA) return null;
  try {
    return createWorkspaceWorkBranch(value);
  } catch (_) {
    return null;
  }
}

export function workspaceWorkBranchesMatch(left, right) {
  const a = normalizeWorkspaceWorkBranch(left);
  const b = normalizeWorkspaceWorkBranch(right);
  if (!a || !b) return false;
  return a.branchId === b.branchId
    && a.scopeId === b.scopeId
    && a.documentId === b.documentId
    && a.documentScopeId === b.documentScopeId
    && a.createdAt === b.createdAt;
}

export function createWorkspaceWorkIdentity({
  instanceId,
  workspaceId = '',
  initialProductName = '',
  initialInputImageFingerprint = '',
  createdAt = Date.now(),
} = {}) {
  const id = cleanText(instanceId);
  if (!id) throw new TypeError('work identity instanceId is required');
  const timestamp = Number(createdAt);
  return Object.freeze({
    schema: WORK_IDENTITY_SCHEMA,
    instanceId: id,
    workspaceId: optionalWorkspaceScope(workspaceId),
    initialProductName: cleanText(initialProductName),
    initialProductKey: normalizedIdentityText(initialProductName),
    initialInputImageFingerprint: cleanText(initialInputImageFingerprint),
    createdAt: Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : 0,
  });
}

export function normalizeWorkspaceWorkIdentity(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    return createWorkspaceWorkIdentity({
      instanceId: value.instanceId,
      workspaceId: value.workspaceId,
      initialProductName: value.initialProductName,
      initialInputImageFingerprint: value.initialInputImageFingerprint,
      createdAt: value.createdAt,
    });
  } catch (_) {
    return null;
  }
}

export function workspaceWorkIdentitiesMatch(left, right) {
  const a = normalizeWorkspaceWorkIdentity(left);
  const b = normalizeWorkspaceWorkIdentity(right);
  if (!a || !b) return false;
  return a.instanceId === b.instanceId
    && a.workspaceId === b.workspaceId
    && a.initialProductKey === b.initialProductKey
    && a.initialInputImageFingerprint === b.initialInputImageFingerprint
    && a.createdAt === b.createdAt;
}
