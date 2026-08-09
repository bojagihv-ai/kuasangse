import { immutablePersistenceResult } from '../persistence-envelope.mjs';

const MAX_RETAINED_PARTIAL_OPERATION_ENTRIES = 128;
const MAX_RETAINED_TERMINAL_OPERATION_ENTRIES = 128;

function operationIdentity(envelope) {
  return Object.freeze({
    schema: envelope.schema,
    version: envelope.version,
    scopeId: envelope.scopeId,
    savedAt: Number(envelope.savedAt) || 0,
    digest: envelope.digest,
    metadata: Object.freeze({
      operationId: String(envelope.metadata.operationId || ''),
      leaseId: String(envelope.metadata.leaseId || ''),
      fencingToken: String(envelope.metadata.fencingToken || ''),
      revision: Object.freeze({ ...envelope.metadata.revision }),
    }),
  });
}

function envelopeFromIdentity(identity, snapshot) {
  return Object.freeze({
    schema: identity.schema,
    version: identity.version,
    scopeId: identity.scopeId,
    savedAt: identity.savedAt,
    digest: identity.digest,
    metadata: identity.metadata,
    snapshot,
  });
}

function activeOperation(envelope, required, previous = null) {
  return {
    envelope,
    required: new Set(required),
    completed: new Set(previous?.completed || []),
    accepted: previous?.accepted === true,
    observedReplicaRevision: Number(previous?.observedReplicaRevision) || 0,
    safeReplicaRevision: Number(previous?.safeReplicaRevision) || 0,
  };
}

function compactResult(result) {
  const compact = {
    accepted: result.accepted,
    authoritative: result.authoritative,
    clean: result.clean,
    partial: result.partial,
    failures: Object.freeze((result.failures || []).map(failure => Object.freeze({
      adapter: failure.adapter,
      message: failure.message,
    }))),
  };
  for (const key of ['code', 'protectedNoOp', 'acceptedRevision']) {
    if (Object.hasOwn(result, key)) compact[key] = result[key];
  }
  return Object.freeze(compact);
}

export function createPersistenceOperationCache() {
  const operations = new Map();
  const partialRetainedOrder = [];
  const terminalRetainedOrder = [];

  function removeFromRetainedOrder(operationId, retainedOrder) {
    const index = retainedOrder.indexOf(operationId);
    if (index >= 0) retainedOrder.splice(index, 1);
  }

  function removeFromAllRetainedOrders(operationId) {
    removeFromRetainedOrder(operationId, partialRetainedOrder);
    removeFromRetainedOrder(operationId, terminalRetainedOrder);
  }

  function rememberRetained(operationId, operation, terminal) {
    const retainedOrder = terminal ? terminalRetainedOrder : partialRetainedOrder;
    const maxEntries = terminal
      ? MAX_RETAINED_TERMINAL_OPERATION_ENTRIES
      : MAX_RETAINED_PARTIAL_OPERATION_ENTRIES;
    removeFromAllRetainedOrders(operationId);
    operations.set(operationId, operation);
    retainedOrder.push(operationId);
    while (retainedOrder.length > maxEntries) {
      const evictedId = retainedOrder.shift();
      const evicted = operations.get(evictedId);
      if (evicted?.retained && evicted.terminal === terminal) operations.delete(evictedId);
    }
  }

  function acquire({ candidate, required, rebaseRevision = false }) {
    const operationId = candidate.metadata.operationId;
    const stored = operations.get(operationId);
    if (!stored) {
      const created = activeOperation(candidate, required);
      operations.set(operationId, created);
      return created;
    }
    const identity = stored.identity || stored.envelope;
    if (candidate.scopeId !== identity.scopeId || candidate.digest !== identity.digest) {
      throw new Error('operationId cannot be reused for different workspace content');
    }
    if (stored.terminal) return stored;

    let operation = stored;
    if (stored.retained) {
      removeFromAllRetainedOrders(operationId);
      operation = activeOperation(
        envelopeFromIdentity(stored.identity, candidate.snapshot),
        stored.required,
        stored,
      );
      operations.set(operationId, operation);
    }

    const storedRevision = Number(operation.envelope.metadata.revision.counter) || 0;
    const observedRevision = Number(operation.observedReplicaRevision) || 0;
    const candidateRevision = Number(candidate.metadata.revision.counter) || 0;
    if (rebaseRevision && observedRevision > storedRevision && candidateRevision > observedRevision) {
      operation = activeOperation(candidate, required, { observedReplicaRevision: observedRevision });
      operations.set(operationId, operation);
    }
    return operation;
  }

  function replay(operation, candidate) {
    const envelope = envelopeFromIdentity(operation.identity, candidate.snapshot);
    return immutablePersistenceResult({
      ...operation.result,
      envelope,
      failures: operation.result.failures.map(failure => ({ ...failure })),
    });
  }

  function retainPartial(operation) {
    const operationId = operation.envelope.metadata.operationId;
    rememberRetained(operationId, {
      retained: true,
      terminal: false,
      identity: operationIdentity(operation.envelope),
      required: Object.freeze([...operation.required]),
      completed: Object.freeze([...operation.completed]),
      accepted: operation.accepted === true,
      observedReplicaRevision: Number(operation.observedReplicaRevision) || 0,
      safeReplicaRevision: Number(operation.safeReplicaRevision) || 0,
    }, false);
  }

  function retainTerminal(operation, result) {
    const operationId = operation.envelope.metadata.operationId;
    rememberRetained(operationId, {
      retained: true,
      terminal: true,
      identity: operationIdentity(operation.envelope),
      result: compactResult(result),
    }, true);
  }

  function drop(operationId) {
    operations.delete(operationId);
    removeFromAllRetainedOrders(operationId);
  }

  return Object.freeze({ acquire, drop, replay, retainPartial, retainTerminal });
}
