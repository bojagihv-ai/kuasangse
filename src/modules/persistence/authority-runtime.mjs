import {
  normalizeProjectScope,
  normalizeWorkspaceScope,
  validateWorkspaceSnapshotIdentity,
} from './contracts.mjs';
import { WorkspaceAuthorityError } from './fencing.mjs';

export function createPersistenceAuthorityRuntime(authority = null) {
  function linkedProjectAuthority(envelope, current = snapshot()) {
    if (!current?.scopeId?.startsWith('project:') || !envelope?.scopeId?.startsWith('draft:')) {
      return false;
    }
    const validation = validateWorkspaceSnapshotIdentity(envelope.snapshot);
    return validation.ok
      && validation.branch?.scopeId === envelope.scopeId
      && validation.branch?.documentScopeId === current.scopeId;
  }

  function hasSnapshot() {
    return Boolean(authority?.snapshot);
  }

  function isLinkedProjectAuthority(envelope) {
    const current = snapshot();
    return current?.mode === 'editing' && linkedProjectAuthority(envelope, current);
  }

  function snapshot() {
    return authority?.snapshot?.() || null;
  }

  function observeRevision({ revision, scopeId, fencingToken = 0, trusted = false }) {
    if (!authority?.snapshot || typeof authority.observeRevision !== 'function') return false;
    const current = authority.snapshot();
    const nextRevision = Number(revision) || 0;
    const normalizedScope = normalizeWorkspaceScope(scopeId);
    if (!current || current.scopeId !== normalizedScope
      || nextRevision <= (Number(current.revision) || 0)) return false;
    const observedFence = Number(fencingToken) || 0;
    if (!trusted && observedFence !== Number(current.fencingToken || 0)) return false;
    authority.observeRevision(nextRevision, current.fencingToken);
    return true;
  }

  function replicaRevisionConflict(error, envelope) {
    if (error?.code !== 'STALE_REVISION') return null;
    const current = error.current;
    if (!current || typeof current !== 'object') return null;
    const currentScope = String(current.scopeId || '');
    const envelopeScope = String(envelope.scopeId || '');
    const currentLease = String(current.leaseId || '');
    const envelopeLease = String(envelope.metadata.leaseId || '');
    const currentFence = Number(current.fencingToken) || 0;
    const envelopeFence = Number(envelope.metadata.fencingToken) || 0;
    const currentRevision = Number(current.revision) || 0;
    const envelopeRevision = Number(envelope.metadata.revision.counter) || 0;
    if (currentScope !== envelopeScope
      || currentLease !== envelopeLease
      || currentFence !== envelopeFence
      || currentRevision <= envelopeRevision) return null;
    const currentDigest = String(current.digest || '');
    const envelopeDigest = String(envelope.digest || '');
    const sameDigest = currentDigest !== '' && currentDigest === envelopeDigest;
    const currentOperation = String(current.operationId || '');
    const envelopeOperation = String(envelope.metadata.operationId || '');
    const sameOperation = currentOperation !== '' && currentOperation === envelopeOperation;
    return {
      revision: currentRevision,
      semanticallySame: sameDigest || (sameOperation && currentDigest === ''),
    };
  }

  function authorityAtReplicaRevision(current, envelope, revision) {
    return current
      && current.scopeId === envelope.scopeId
      && String(current.leaseId || '') === String(envelope.metadata.leaseId || '')
      && Number(current.fencingToken) === Number(envelope.metadata.fencingToken)
      && Number(current.revision) === Number(revision);
  }

  function observeReplicaRevision({ error, envelope, operation = null }) {
    const conflict = replicaRevisionConflict(error, envelope);
    if (!conflict) return false;
    const authorityBeforeObserve = snapshot();
    const linkedProjectDraft = linkedProjectAuthority(envelope, authorityBeforeObserve);
    const observed = observeRevision({
      revision: conflict.revision,
      scopeId: envelope.scopeId,
      fencingToken: envelope.metadata.fencingToken,
    });
    const alreadyObserved = authorityAtReplicaRevision(
      authorityBeforeObserve,
      envelope,
      conflict.revision,
    );
    if ((observed || alreadyObserved || linkedProjectDraft) && operation) {
      operation.observedReplicaRevision = Math.max(
        Number(operation.observedReplicaRevision) || 0,
        conflict.revision,
      );
    }
    return observed || alreadyObserved || linkedProjectDraft;
  }

  function recoverReplicaRevision({ error, envelope, operation }) {
    const conflict = replicaRevisionConflict(error, envelope);
    if (!conflict?.semanticallySame) return false;
    const authorityBeforeObserve = snapshot();
    const observed = observeRevision({
      revision: conflict.revision,
      scopeId: envelope.scopeId,
      fencingToken: envelope.metadata.fencingToken,
    });
    const alreadyObserved = authorityAtReplicaRevision(
      authorityBeforeObserve,
      envelope,
      conflict.revision,
    );
    if (authority?.snapshot && !observed && !alreadyObserved) return false;
    operation.safeReplicaRevision = Math.max(
      Number(operation.safeReplicaRevision) || 0,
      conflict.revision,
    );
    return true;
  }

  function commandWithCurrentRevision(command) {
    if (command.rebaseRevision !== true || !authority?.snapshot) return command;
    const current = authority.snapshot();
    const metadata = command.metadata || {};
    const claimed = command.authority || {};
    const scopeId = command.scopeId
      ? normalizeWorkspaceScope(command.scopeId)
      : normalizeProjectScope(command.projectId);
    const claimedFence = Number(metadata.fencingToken || claimed.fencingToken) || 0;
    const claimedLease = String(metadata.leaseId || claimed.leaseId || '');
    const managedDraft = current?.mode === 'offline-edit'
      && current.scopeId === scopeId
      && scopeId.startsWith('draft:');
    const managedProject = current?.mode === 'editing'
      && current.scopeId === scopeId
      && claimedFence === Number(current.fencingToken)
      && claimedLease === String(current.leaseId || '');
    if (!managedDraft && !managedProject) return command;
    return {
      ...command,
      metadata: {
        ...metadata,
        leaseId: current.leaseId,
        fencingToken: current.fencingToken,
        revision: {
          ...(metadata.revision || {}),
          scopeId,
          counter: (Number(current.revision) || 0) + 1,
          updatedAt: Math.max(Date.now(), Number(metadata.revision?.updatedAt) || 0),
        },
      },
    };
  }

  function rejection(envelope, claimed = null, options = {}) {
    if (!authority?.snapshot) return null;
    const current = authority.snapshot();
    if (envelope.scopeId.startsWith('draft:') && current?.mode === 'offline-edit'
      && current.scopeId === envelope.scopeId) return null;
    if (linkedProjectAuthority(envelope, current)) {
      return current.mode === 'editing'
        ? null
        : new WorkspaceAuthorityError('READ_ONLY', current.reason || 'workspace is read-only', current);
    }
    if (!current || current.scopeId !== envelope.scopeId) {
      return new WorkspaceAuthorityError('STALE_SCOPE', 'workspace authority scope changed', current);
    }
    if (current.mode !== 'editing') {
      return new WorkspaceAuthorityError('READ_ONLY', current.reason || 'workspace is read-only', current);
    }
    const claimedToken = Number(claimed?.fencingToken ?? envelope.metadata.fencingToken);
    const claimedLease = String(claimed?.leaseId || envelope.metadata.leaseId || '');
    if (!claimedToken || !claimedLease) {
      return new WorkspaceAuthorityError(
        'PRECONDITION_REQUIRED',
        'lease and fencing token are required',
        current,
      );
    }
    if (claimedToken !== Number(current.fencingToken)
      || claimedLease !== String(current.leaseId || '')) {
      return new WorkspaceAuthorityError('STALE_FENCE', 'workspace fencing token is stale', current);
    }
    const envelopeRevision = Number(envelope.metadata.revision.counter);
    const currentRevision = Number(current.revision) || 0;
    const revisionMatches = envelopeRevision === currentRevision + 1
      || (options.allowCommittedRevision === true && envelopeRevision === currentRevision)
      || (Number(options.allowSupersededRevision) > 0
        && currentRevision === Number(options.allowSupersededRevision)
        && envelopeRevision < currentRevision);
    if (!revisionMatches) {
      return new WorkspaceAuthorityError('STALE_REVISION', 'workspace revision is stale', current);
    }
    return null;
  }

  function guardedContext({ name, command, envelope, operation }) {
    const claimed = command.authority || null;
    const assertAuthority = () => {
      const error = rejection(envelope, claimed, {
        allowCommittedRevision: operation?.completed?.has('server') === true,
        allowSupersededRevision: operation?.safeReplicaRevision || 0,
      });
      if (error) throw error;
      return snapshot() || claimed;
    };
    const assertCompletion = () => {
      const error = rejection(envelope, claimed, {
        allowCommittedRevision: true,
        allowSupersededRevision: operation?.safeReplicaRevision || 0,
      });
      if (error) throw error;
      return snapshot() || claimed;
    };
    const current = snapshot() || claimed || {};
    const ownsOfflineDraft = current?.mode === 'offline-edit'
      && current.scopeId === envelope.scopeId
      && envelope.scopeId.startsWith('draft:');
    const ownsLinkedProjectDraft = current?.mode === 'editing'
      && linkedProjectAuthority(envelope, current);
    return {
      ...(command.context?.[name] || {}),
      assertAuthority,
      assertCompletion,
      currentAuthority: current,
      allowSameRevisionMutation: (name === 'session' || name === 'indexeddb')
        && (
          (operation?.completed?.has('server') === true
            && Number(current.revision) === Number(envelope.metadata.revision?.counter))
          || (ownsOfflineDraft
            && Number(envelope.metadata.revision?.counter) === Number(current.revision) + 1)
          || ownsLinkedProjectDraft
        ),
      scopeId: envelope.scopeId,
      leaseId: current.leaseId || envelope.metadata.leaseId,
      fencingToken: current.fencingToken || envelope.metadata.fencingToken,
      expectedRevision: Number(current.revision) || 0,
    };
  }

  function runMutation(operation) {
    return authority?.runMutation ? authority.runMutation(operation) : operation();
  }

  return Object.freeze({
    commandWithCurrentRevision,
    guardedContext,
    hasSnapshot,
    isLinkedProjectAuthority,
    observeReplicaRevision,
    observeRevision,
    recoverReplicaRevision,
    rejection,
    runMutation,
    snapshot,
  });
}
