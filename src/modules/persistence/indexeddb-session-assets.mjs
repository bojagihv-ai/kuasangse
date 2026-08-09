import { normalizeProjectScope, normalizeWorkspaceScope } from './contracts.mjs';
import { sanitizePersistenceValue } from './migrations.mjs';

export function cloneSessionAssets(value) {
  const source = value && typeof value === 'object' ? value : {};
  try {
    return structuredClone(source);
  } catch (error) {
    if (error?.name !== 'DataCloneError') throw error;
    const sanitized = sanitizePersistenceValue(source);
    return structuredClone(sanitized && typeof sanitized === 'object' ? sanitized : {});
  }
}

export function projectIdFromScope(scopeId) {
  return normalizeProjectScope(scopeId).slice('project:'.length);
}

function cleanDocumentId(value) {
  return String(value || '').replace(/^project:/i, '').trim();
}

export function sessionAssetsDocumentId(scopeId, payload = {}) {
  const scope = normalizeWorkspaceScope(scopeId);
  if (scope.startsWith('project:')) return projectIdFromScope(scope);

  const branch = payload?.workspaceBranch && typeof payload.workspaceBranch === 'object'
    ? payload.workspaceBranch
    : null;
  if (branch?.scopeId && normalizeWorkspaceScope(branch.scopeId) !== scope) {
    throw new TypeError('session assets branch scope must match its storage scope');
  }
  const branchDocumentId = cleanDocumentId(branch?.documentId);
  const payloadDocumentId = cleanDocumentId(payload?.currentProjectId);
  if (branchDocumentId && payloadDocumentId && branchDocumentId !== payloadDocumentId) {
    throw new TypeError('session assets document id conflicts with its branch binding');
  }
  const documentId = branchDocumentId || payloadDocumentId;
  const documentScopeId = String(branch?.documentScopeId || '').trim();
  if (documentScopeId && normalizeProjectScope(documentScopeId) !== `project:${documentId}`) {
    throw new TypeError('session assets document scope conflicts with its branch binding');
  }
  return documentId;
}

export function scopedSessionAssetId(projectId) {
  return `session-assets:${normalizeWorkspaceScope(projectId)}`;
}

export function sessionAssetRecordMatchesAuthority(record, authority, scopeId) {
  if (!record || typeof record !== 'object') return false;
  const scope = normalizeWorkspaceScope(scopeId);
  const recordScope = record.persistenceAuthority?.scopeId
    || record.scopeId
    || record.workspaceScope?.id
    || '';
  if (recordScope) {
    try {
      if (normalizeWorkspaceScope(recordScope) !== scope) return false;
    } catch (_) {
      return false;
    }
  }
  if (!authority || authority.scopeId !== scope) return true;
  if (scope.startsWith('draft:') && authority.mode === 'offline-edit') return true;
  const recordRevision = Number(record.persistenceAuthority?.revision) || 0;
  const authorityRevision = Number(authority.revision) || 0;
  return !(recordRevision && authorityRevision && recordRevision > authorityRevision);
}

export function legacyScope(record) {
  const raw = record?.scopeId
    || record?.workspaceScope?.id
    || record?.workspaceRevision?.scopeId
    || record?.currentProjectId;
  if (!raw) return '';
  try { return normalizeProjectScope(raw); } catch (_) { return ''; }
}
