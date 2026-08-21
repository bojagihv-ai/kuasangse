import { AUTHORITATIVE_ADAPTER, PERSISTENCE_ADAPTER_NAMES } from './contracts.mjs';
import { WorkspaceAuthorityError } from './fencing.mjs';
import {
  createPersistenceEnvelope,
  createPersistenceFailure,
  immutablePersistenceResult,
} from '../persistence-envelope.mjs';

export function createPersistenceCommitEngine({ adapters, authorityRuntime, operationCache }) {
  function requestedReplicas(replicas = []) {
    const requested = [...new Set(replicas)].filter(name => name !== AUTHORITATIVE_ADAPTER);
    for (const name of requested) {
      if (!PERSISTENCE_ADAPTER_NAMES.includes(name)) {
        throw new Error(`unknown persistence replica: ${name}`);
      }
    }
    return requested;
  }

  function rejectedResult(envelope, error) {
    return immutablePersistenceResult({
      accepted: false, authoritative: 'server+indexeddb', clean: false, partial: false,
      envelope, code: error.code, failures: [createPersistenceFailure('authority', error)],
    });
  }

  function staleResult(envelope, { partial = false } = {}) {
    return immutablePersistenceResult({
      accepted: true, authoritative: 'server+indexeddb', clean: false, partial,
      stale: true, envelope, failures: [],
    });
  }

  function commandIsCurrent(command, envelope) {
    return typeof command.isCurrent !== 'function'
      || command.isCurrent(envelope.digest) !== false;
  }

  function authorityOptions(operation, managedProject) {
    return { allowCommittedRevision: managedProject && operation.completed.has('server'), allowSupersededRevision: operation.safeReplicaRevision || 0 };
  }

  async function commitUnlocked(command = {}, retryState = {}) {
    const preparedCommand = authorityRuntime.commandWithCurrentRevision(command);
    const requested = requestedReplicas(preparedCommand.replicas || []);
    const candidate = createPersistenceEnvelope(preparedCommand);
    const initialRejection = authorityRuntime.rejection(candidate, preparedCommand.authority || null);
    if (initialRejection) return rejectedResult(candidate, initialRejection);
    if (!commandIsCurrent(preparedCommand, candidate)) return staleResult(candidate);
    const managedProject = authorityRuntime.hasSnapshot() && candidate.scopeId.startsWith('project:');
    const currentAuthority = authorityRuntime.snapshot();
    const managedDraft = currentAuthority?.mode === 'offline-edit'
      && currentAuthority.scopeId === candidate.scopeId && candidate.scopeId.startsWith('draft:');
    const managedLinkedDraft = authorityRuntime.isLinkedProjectAuthority(candidate);
    if (managedProject && !requested.includes('server')) requested.unshift('server');
    const operation = operationCache.acquire({ candidate, required: requested, rebaseRevision: preparedCommand.rebaseRevision === true });
    if (operation.terminal) return operationCache.replay(operation, candidate);

    const { envelope } = operation;
    const retryManagedSessionRevision = () => {
      if (!(managedDraft || managedProject || managedLinkedDraft) || preparedCommand.rebaseRevision !== true || retryState.sessionRevisionRebased === true) return null;
      const observedRevision = Number(operation.observedReplicaRevision) || 0;
      const currentRevision = Number(envelope.metadata.revision?.counter) || 0;
      if (managedLinkedDraft && observedRevision <= currentRevision) return null;
      const retryCommand = managedLinkedDraft
        ? {
          ...command,
          metadata: {
            ...(command.metadata || {}),
            revision: {
              ...(command.metadata?.revision || {}),
              scopeId: envelope.scopeId,
              counter: observedRevision + 1,
              updatedAt: Math.max(Date.now(), Number(command.metadata?.revision?.updatedAt) || 0),
            },
          },
        }
        : command;
      operationCache.retainPartial(operation);
      return commitUnlocked(retryCommand, { sessionRevisionRebased: true });
    };
    const stopStaleCommand = () => {
      operationCache.drop(envelope.metadata.operationId);
      return staleResult(envelope, { partial: operation.completed.size > 0 });
    };
    if (!commandIsCurrent(preparedCommand, envelope)) return stopStaleCommand();
    const failures = [];
    if (managedProject && !operation.completed.has('server')) {
      try {
        if (!commandIsCurrent(preparedCommand, envelope)) return stopStaleCommand();
        const serverOutcome = await adapters.server.write(
          envelope,
          authorityRuntime.guardedContext({
            name: 'server', command: preparedCommand, envelope, operation,
          }),
        );
        if (serverOutcome?.protectedNoOp === true) {
          authorityRuntime.observeRevision({
            revision: Number(serverOutcome.acceptedRevision ?? serverOutcome.revision) || 0,
            scopeId: envelope.scopeId,
            fencingToken: envelope.metadata.fencingToken,
            trusted: true,
          });
          operationCache.drop(envelope.metadata.operationId);
          return immutablePersistenceResult({
            accepted: true,
            authoritative: 'server+indexeddb',
            clean: true,
            partial: false,
            protectedNoOp: true,
            reason: String(serverOutcome.reason || ''),
            acceptedRevision: Number(serverOutcome.acceptedRevision ?? serverOutcome.revision) || 0,
            envelope,
            failures: [],
          });
        }
        operation.completed.add('server');
        authorityRuntime.observeRevision({
          revision: envelope.metadata.revision.counter,
          scopeId: envelope.scopeId,
          fencingToken: envelope.metadata.fencingToken,
          trusted: true,
        });
      } catch (error) {
        const result = rejectedResult(envelope, error instanceof WorkspaceAuthorityError
          ? error
          : new WorkspaceAuthorityError(
            error?.code || 'SERVER_CAS_REJECTED',
            String(error?.message || error),
            error?.snapshot,
          ));
        operationCache.drop(envelope.metadata.operationId);
        return result;
      }
    }

    if (!operation.accepted) {
      try {
        if (!commandIsCurrent(preparedCommand, envelope)) return stopStaleCommand();
        const rejection = authorityRuntime.rejection(
          envelope,
          preparedCommand.authority || null,
          authorityOptions(operation, managedProject),
        );
        if (rejection) throw rejection;
        await adapters[AUTHORITATIVE_ADAPTER].write(
          envelope,
          (managedProject || managedDraft || managedLinkedDraft)
            ? authorityRuntime.guardedContext({
              name: AUTHORITATIVE_ADAPTER, command: preparedCommand, envelope, operation,
            })
            : preparedCommand.context?.[AUTHORITATIVE_ADAPTER],
        );
        operation.accepted = true;
        operation.completed.add(AUTHORITATIVE_ADAPTER);
      } catch (error) {
        const recovered = authorityRuntime.recoverReplicaRevision({ error, envelope, operation });
        if (recovered) {
          operation.accepted = true;
          operation.completed.add(AUTHORITATIVE_ADAPTER);
        } else {
          authorityRuntime.observeReplicaRevision({ error, envelope, operation });
        }
        if (!recovered) {
          const result = immutablePersistenceResult({
            accepted: false,
            authoritative: managedProject ? 'server+indexeddb' : AUTHORITATIVE_ADAPTER,
            clean: false,
            partial: managedProject && operation.completed.has('server'),
            envelope,
            code: error?.code || 'AUTHORITATIVE_WRITE_FAILED',
            failures: [createPersistenceFailure(AUTHORITATIVE_ADAPTER, error)],
          });
          if (result.partial) operationCache.retainPartial(operation);
          else operationCache.drop(envelope.metadata.operationId);
          return result;
        }
      }
    }

    for (const name of operation.required) {
      if (operation.completed.has(name)) continue;
      try {
        if (!commandIsCurrent(preparedCommand, envelope)) return stopStaleCommand();
        const rejection = authorityRuntime.rejection(
          envelope,
          preparedCommand.authority || null,
          authorityOptions(operation, managedProject),
        );
        if (rejection) throw rejection;
        const writeContext = (managedProject || ((managedDraft || managedLinkedDraft) && name === 'session'))
          ? authorityRuntime.guardedContext({
            name, command: preparedCommand, envelope, operation,
          })
          : preparedCommand.context?.[name];
        await adapters[name].write(envelope, writeContext);
        operation.completed.add(name);
      } catch (error) {
        if (authorityRuntime.recoverReplicaRevision({ error, envelope, operation })) {
          operation.completed.add(name);
        } else {
          const observedReplicaRevision = authorityRuntime.observeReplicaRevision({
            error, envelope, operation,
          });
          if (name === 'session' && observedReplicaRevision) {
            const retried = retryManagedSessionRevision();
            if (retried) return retried;
          }
          failures.push(createPersistenceFailure(name, error));
        }
      }
    }

    const completionRejection = authorityRuntime.rejection(
      envelope,
      preparedCommand.authority || null,
      authorityOptions(operation, managedProject),
    );
    if (completionRejection) {
      failures.push(createPersistenceFailure('authority', completionRejection));
    }
    const current = !completionRejection && commandIsCurrent(preparedCommand, envelope);
    const pending = [...operation.required].filter(name => !operation.completed.has(name));
    const result = immutablePersistenceResult({
      accepted: true,
      authoritative: managedProject ? 'server+indexeddb' : AUTHORITATIVE_ADAPTER,
      clean: current && pending.length === 0,
      partial: pending.length > 0,
      envelope,
      failures,
    });
    if (managedDraft && result.accepted) {
      authorityRuntime.observeRevision({
        revision: envelope.metadata.revision.counter,
        scopeId: envelope.scopeId,
        fencingToken: envelope.metadata.fencingToken,
        trusted: true,
      });
    }
    if (managedProject && result.clean) {
      authorityRuntime.observeRevision({
        revision: envelope.metadata.revision.counter,
        scopeId: envelope.scopeId,
        fencingToken: envelope.metadata.fencingToken,
        trusted: true,
      });
    }
    if (result.partial) operationCache.retainPartial(operation);
    else operationCache.retainTerminal(operation, result);
    return result;
  }

  function commit(command = {}) {
    return authorityRuntime.runMutation(() => commitUnlocked(command));
  }

  return Object.freeze({ commit });
}
