const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const GATEWAY = path.resolve(__dirname, '../../src/modules/workspace-persistence.mjs');

async function loadGateway() {
  return import(`${pathToFileURL(GATEWAY).href}?midflight=${Date.now()}-${Math.random()}`);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function sharedAdapter(name, delayedTarget, started, resume) {
  const writes = [];
  return {
    name,
    writes,
    async read() { return writes.at(-1) || null; },
    async write(value, context = {}) {
      context.assertAuthority?.();
      if (name === delayedTarget && value.snapshot.value === 'A') {
        started.resolve();
        await resume.promise;
      }
      writes.push(structuredClone(value));
      try {
        context.assertCompletion?.();
      } catch (error) {
        writes.pop();
        throw error;
      }
      return value;
    },
  };
}

function authority(initial) {
  let current = initial;
  let queue = Promise.resolve();
  return {
    snapshot: () => current,
    replace: next => { current = next; },
    observeRevision(revision) { current = { ...current, revision }; },
    runMutation(operation) {
      const running = queue.then(operation);
      queue = running.catch(() => undefined);
      return running;
    },
  };
}

function command(current, value, replicas) {
  return {
    projectId: 'alpha',
    snapshot: { value },
    metadata: {
      operationId: `operation-${value}`,
      revision: {
        scopeId: 'project:alpha', counter: Number(current.revision) + 1,
        updatedAt: value === 'A' ? 1 : 2, writerId: value,
      },
      fencingToken: String(current.fencingToken),
      leaseId: current.leaseId,
    },
    authority: current,
    replicas,
  };
}

for (const destination of ['server', 'indexeddb', 'session', 'workfile', 'archive']) {
  test(`Given A paused inside ${destination} When B takes over and commits Then A cannot publish last`, async () => {
    // Given: A passed the destination precheck and is paused before physical completion.
    const { createWorkspacePersistence } = await loadGateway();
    const started = deferred();
    const resume = deferred();
    const adapters = Object.fromEntries(['session', 'indexeddb', 'server', 'workfile', 'archive']
      .map(name => [name, sharedAdapter(name, destination, started, resume)]));
    const stateA = { scopeId: 'project:alpha', leaseId: 'lease-a', fencingToken: 1, revision: 0, mode: 'editing' };
    const authorityA = authority(stateA);
    const gatewayA = createWorkspacePersistence({ adapters, authority: authorityA });
    const replicas = ['session', 'workfile', 'archive'].includes(destination) ? [destination] : [];
    const pendingA = gatewayA.commit(command(stateA, 'A', replicas));
    await started.promise;

    // When: B receives a higher fence, reloads the accepted revision, and commits B.
    const acceptedBeforeTakeover = destination === 'server' ? 0 : 1;
    authorityA.replace({
      scopeId: 'project:alpha', leaseId: 'lease-b', fencingToken: 2,
      revision: acceptedBeforeTakeover, mode: 'readonly', reasonCode: 'TAKEN_OVER',
    });
    const stateB = {
      scopeId: 'project:alpha', leaseId: 'lease-b', fencingToken: 2,
      revision: acceptedBeforeTakeover, mode: 'editing',
    };
    const gatewayB = createWorkspacePersistence({ adapters, authority: authority(stateB) });
    const resultB = await gatewayB.commit(command(stateB, 'B', replicas));
    resume.resolve();
    const resultA = await pendingA;

    // Then: the destination remains B and A reports a typed stale/partial failure, never clean success.
    assert.equal(resultB.accepted, true);
    assert.equal(adapters[destination].writes.at(-1).snapshot.value, 'B', destination);
    assert.equal(resultA.clean, false, destination);
    assert.ok(
      resultA.accepted === false || resultA.partial === true,
      `${destination}: stale A must not be accepted as a clean complete mutation`,
    );
    const codes = [resultA.code, ...resultA.failures.map(item => item.error?.code)].filter(Boolean);
    assert.ok(codes.some(code => ['STALE_FENCE', 'READ_ONLY', 'STALE_REVISION'].includes(code)), codes.join(','));
  });
}
