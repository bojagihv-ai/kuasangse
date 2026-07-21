import { AUTHORITATIVE_ADAPTER, PERSISTENCE_ADAPTER_NAMES, RESTORE_SOURCE_PRECEDENCE, normalizeProjectScope, normalizeWorkspaceScope } from './persistence/contracts.mjs';
import { WorkspaceAuthorityError } from './persistence/fencing.mjs';
import { migrateWorkfilePayload, sanitizePersistenceEnvelope } from './persistence/migrations.mjs';
import { sanitizeWorkspaceSnapshot } from './persistence/serialization.mjs';
import { comparePersistenceCandidates, createPersistenceEnvelope, createPersistenceFailure, immutablePersistenceResult } from './persistence-envelope.mjs';

export function createWorkspacePersistence({ adapters, authority = null } = {}) {
  if (!adapters || typeof adapters !== 'object') throw new TypeError('persistence adapters are required');
  for (const name of PERSISTENCE_ADAPTER_NAMES) {
    if (!adapters[name] || typeof adapters[name].read !== 'function' || typeof adapters[name].write !== 'function') {
      throw new TypeError(`missing persistence adapter: ${name}`);
    }
  }
  const operations = new Map();

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
    if (current?.mode !== 'editing' || current.scopeId !== scopeId
      || claimedFence !== Number(current.fencingToken)
      || claimedLease !== String(current.leaseId || '')) return command;
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

  function authorityRejection(envelope, claimed = null, options = {}) {
    if (!authority?.snapshot) return null;
    const current = authority.snapshot();
    if (envelope.scopeId.startsWith('draft:') && current?.mode === 'offline-edit'
      && current.scopeId === envelope.scopeId) return null;
    if (!current || current.scopeId !== envelope.scopeId) {
      return new WorkspaceAuthorityError('STALE_SCOPE', 'workspace authority scope changed', current);
    }
    if (current.mode !== 'editing') {
      return new WorkspaceAuthorityError('READ_ONLY', current.reason || 'workspace is read-only', current);
    }
    const claimedToken = Number(claimed?.fencingToken ?? envelope.metadata.fencingToken);
    const claimedLease = String(claimed?.leaseId || envelope.metadata.leaseId || '');
    if (!claimedToken || !claimedLease) {
      return new WorkspaceAuthorityError('PRECONDITION_REQUIRED', 'lease and fencing token are required', current);
    }
    if (claimedToken !== Number(current.fencingToken) || claimedLease !== String(current.leaseId || '')) {
      return new WorkspaceAuthorityError('STALE_FENCE', 'workspace fencing token is stale', current);
    }
    const envelopeRevision = Number(envelope.metadata.revision.counter);
    const currentRevision = Number(current.revision) || 0;
    const revisionMatches = envelopeRevision === currentRevision + 1
      || (options.allowCommittedRevision === true && envelopeRevision === currentRevision);
    if (!revisionMatches) {
      return new WorkspaceAuthorityError('STALE_REVISION', 'workspace revision is stale', current);
    }
    return null;
  }

  function rejectedResult(envelope, error) {
    return immutablePersistenceResult({
      accepted: false, authoritative: 'server+indexeddb', clean: false,
      partial: false, envelope, code: error.code,
      failures: [createPersistenceFailure('authority', error)],
    });
  }

  function guardedContext(name, command, envelope, operation) {
    const claimed = command.authority || null;
    const assertAuthority = () => {
      const rejection = authorityRejection(envelope, claimed, {
        allowCommittedRevision: operation?.completed?.has('server') === true,
      });
      if (rejection) throw rejection;
      return authority?.snapshot?.() || claimed;
    };
    const assertCompletion = () => {
      const rejection = authorityRejection(envelope, claimed, { allowCommittedRevision: true });
      if (rejection) throw rejection;
      return authority?.snapshot?.() || claimed;
    };
    const current = authority?.snapshot?.() || claimed || {};
    return {
      ...(command.context?.[name] || {}),
      assertAuthority,
      assertCompletion,
      currentAuthority: current,
      scopeId: envelope.scopeId,
      leaseId: current.leaseId || envelope.metadata.leaseId,
      fencingToken: current.fencingToken || envelope.metadata.fencingToken,
      expectedRevision: Number(current.revision) || 0,
    };
  }

  function requestedReplicas(replicas = []) {
    const requested = [...new Set(replicas)].filter(name => name !== AUTHORITATIVE_ADAPTER);
    for (const name of requested) {
      if (!PERSISTENCE_ADAPTER_NAMES.includes(name)) throw new Error(`unknown persistence replica: ${name}`);
    }
    return requested;
  }

  function restoreSources(sources = RESTORE_SOURCE_PRECEDENCE) {
    const selected = [...new Set(sources)];
    for (const source of selected) {
      if (!RESTORE_SOURCE_PRECEDENCE.includes(source)) throw new Error(`unknown restore source: ${source}`);
    }
    return selected;
  }

  async function commitUnlocked(command = {}) {
    command = commandWithCurrentRevision(command);
    const requested = requestedReplicas(command.replicas || []);
    const candidate = createPersistenceEnvelope(command);
    const initialRejection = authorityRejection(candidate, command.authority || null);
    if (initialRejection) return rejectedResult(candidate, initialRejection);
    const managedProject = !!authority?.snapshot && candidate.scopeId.startsWith('project:');
    if (managedProject && !requested.includes('server')) requested.unshift('server');
    let operation = operations.get(candidate.metadata.operationId);
    if (!operation) {
      operation = { envelope: candidate, required: new Set(requested), completed: new Set(), accepted: false, result: null };
      operations.set(candidate.metadata.operationId, operation);
    } else {
      if (candidate.scopeId !== operation.envelope.scopeId || candidate.digest !== operation.envelope.digest) {
        throw new Error('operationId cannot be reused for different workspace content');
      }
      if (operation.result?.clean) return operation.result;
    }
    const { envelope } = operation;
    const failures = [];
    if (managedProject && !operation.completed.has('server')) {
      try {
        const serverOutcome = await adapters.server.write(envelope, guardedContext('server', command, envelope, operation));
        if (serverOutcome?.protectedNoOp === true) {
          operations.delete(envelope.metadata.operationId);
          return immutablePersistenceResult({
            accepted: true,
            authoritative: 'server+indexeddb',
            clean: true,
            partial: false,
            protectedNoOp: true,
            acceptedRevision: Number(serverOutcome.acceptedRevision ?? serverOutcome.revision) || 0,
            envelope,
            failures: [],
          });
        }
        operation.completed.add('server');
      } catch (error) {
        return rejectedResult(envelope, error instanceof WorkspaceAuthorityError
          ? error
          : new WorkspaceAuthorityError(error?.code || 'SERVER_CAS_REJECTED', String(error?.message || error), error?.snapshot));
      }
    }
    if (!operation.accepted) {
      try {
        const rejection = authorityRejection(envelope, command.authority || null, {
          allowCommittedRevision: managedProject && operation.completed.has('server'),
        });
        if (rejection) throw rejection;
        await adapters[AUTHORITATIVE_ADAPTER].write(
          envelope,
          managedProject ? guardedContext(AUTHORITATIVE_ADAPTER, command, envelope, operation) : command.context?.[AUTHORITATIVE_ADAPTER],
        );
        operation.accepted = true;
        operation.completed.add(AUTHORITATIVE_ADAPTER);
      } catch (error) {
        if (!managedProject) operations.delete(envelope.metadata.operationId);
        return immutablePersistenceResult({
          accepted: false, authoritative: managedProject ? 'server+indexeddb' : AUTHORITATIVE_ADAPTER, clean: false,
          partial: managedProject && operation.completed.has('server'), envelope,
          code: error?.code || 'AUTHORITATIVE_WRITE_FAILED', failures: [createPersistenceFailure(AUTHORITATIVE_ADAPTER, error)],
        });
      }
    }
    for (const name of operation.required) {
      if (operation.completed.has(name)) continue;
      try {
        const rejection = authorityRejection(envelope, command.authority || null, {
          allowCommittedRevision: managedProject && operation.completed.has('server'),
        });
        if (rejection) throw rejection;
        await adapters[name].write(
          envelope,
          managedProject ? guardedContext(name, command, envelope, operation) : command.context?.[name],
        );
        operation.completed.add(name);
      } catch (error) {
        failures.push(createPersistenceFailure(name, error));
      }
    }
    const completionRejection = authorityRejection(envelope, command.authority || null, {
      allowCommittedRevision: managedProject && operation.completed.has('server'),
    });
    if (completionRejection) failures.push(createPersistenceFailure('authority', completionRejection));
    const current = !completionRejection
      && (typeof command.isCurrent !== 'function' || command.isCurrent(envelope.digest) !== false);
    const pending = [...operation.required].filter(name => !operation.completed.has(name));
    const result = immutablePersistenceResult({
      accepted: true,
      authoritative: managedProject ? 'server+indexeddb' : AUTHORITATIVE_ADAPTER,
      clean: current && pending.length === 0,
      partial: pending.length > 0,
      envelope,
      failures,
    });
    if (result.clean && managedProject) {
      authority.observeRevision?.(envelope.metadata.revision.counter, envelope.metadata.fencingToken);
    }
    operation.result = result;
    return result;
  }

  function commit(command = {}) {
    return authority?.runMutation
      ? authority.runMutation(() => commitUnlocked(command))
      : commitUnlocked(command);
  }

  async function restore({ projectId, scopeId, explicitWorkfile = null, sources = RESTORE_SOURCE_PRECEDENCE } = {}) {
    const scope = scopeId ? normalizeWorkspaceScope(scopeId) : normalizeProjectScope(projectId);
    if (explicitWorkfile) {
      const record = migrateWorkfilePayload(explicitWorkfile);
      if (record.scopeId !== scope) throw new Error('explicit workfile scope mismatch');
      return Object.freeze({ source: 'workfile', snapshot: sanitizeWorkspaceSnapshot(record.snapshot) });
    }
    const candidates = [];
    const selectedSources = restoreSources(sources);
    for (const source of selectedSources) {
      try {
        const rawRecord = await adapters[source].read(scope);
        const record = rawRecord ? sanitizePersistenceEnvelope(rawRecord, source) : null;
        if (record && normalizeWorkspaceScope(record.scopeId) === scope) candidates.push({ source, record });
      } catch (_) {}
    }
    candidates.sort(comparePersistenceCandidates);
    const selected = candidates[0] || null;
    if (!selected) return null;
    const revision = selected.record.metadata?.revision;
    return Object.freeze({ source: selected.source, snapshot: sanitizeWorkspaceSnapshot(selected.record.snapshot), revision: revision ? Object.freeze({ ...revision }) : null });
  }

  return Object.freeze({ commit, restore });
}
