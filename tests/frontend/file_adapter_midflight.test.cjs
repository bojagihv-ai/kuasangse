const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULES = path.resolve(__dirname, '../../src/modules/persistence');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function lockManager(lockNames = null) {
  const tails = new Map();
  return {
    request(name, callback) {
      lockNames?.push(name);
      const previous = tails.get(name) || Promise.resolve();
      const running = previous.then(callback);
      tails.set(name, running.catch(() => undefined));
      return running;
    },
  };
}

function sharedHandle(initialText, startedA, resumeA) {
  let text = initialText;
  return {
    async getFile() { return { async text() { return text; } }; },
    async createWritable() {
      let buffer = text;
      return {
        async write(value) {
          buffer = String(value);
          if (buffer.includes('"value":"A"')) {
            startedA.resolve();
            await resumeA.promise;
          }
        },
        async close() { text = buffer; },
        async abort() {},
      };
    },
    value: () => text,
  };
}

function serialized(value, fencingToken, revision) {
  return JSON.stringify({
    value,
    persistence: { digest: `digest-${value}`, revision: { counter: revision }, fencingToken },
  });
}

function envelope(value, fencingToken, revision) {
  return {
    scopeId: 'project:alpha', digest: `digest-${value}`, snapshot: { value },
    metadata: {
      leaseId: `lease-${value.toLowerCase()}`, fencingToken: String(fencingToken),
      revision: { scopeId: 'project:alpha', counter: revision, updatedAt: revision, writerId: value },
    },
  };
}

async function load(name) {
  const url = pathToFileURL(path.join(MODULES, name)).href;
  return import(`${url}?file-midflight=${Date.now()}-${Math.random()}`);
}

test('Given A paused in workfile staging When B takes over Then A aborts and B is final', async () => {
  // Given: both windows share one file handle and one origin-scoped Web Lock manager.
  const { createWorkfileAdapter } = await load('workfile-adapter.mjs');
  const startedA = deferred();
  const resumeA = deferred();
  const handle = sharedHandle(serialized('initial', 0, 0), startedA, resumeA);
  const adapter = createWorkfileAdapter({ root: { navigator: { locks: lockManager() } } });
  let authorityA = { mode: 'editing', leaseId: 'lease-a', fencingToken: 1 };
  const assertA = () => {
    if (authorityA.mode !== 'editing' || authorityA.fencingToken !== 1) {
      const error = new Error('stale workfile writer');
      error.code = 'STALE_FENCE';
      throw error;
    }
  };
  const pendingA = adapter.write(envelope('A', 1, 1), {
    handle, value: serialized('A', 1, 1),
    expectedFile: { revision: 0, digest: 'digest-initial' },
    assertAuthority: assertA, scopeId: 'project:alpha',
  });
  await startedA.promise;

  // When: B takes over and starts writing while A is still staged.
  authorityA = { mode: 'readonly', leaseId: 'lease-b', fencingToken: 2 };
  const pendingB = adapter.write(envelope('B', 2, 1), {
    handle, value: serialized('B', 2, 1), saveAs: true,
    assertAuthority() {}, scopeId: 'project:alpha',
  });
  resumeA.resolve();

  // Then: A is rejected and B becomes the final file content.
  await assert.rejects(pendingA, error => error?.code === 'STALE_FENCE');
  await pendingB;
  assert.equal(JSON.parse(handle.value()).value, 'B');
});

test('Given A paused in archive file staging When B takes over Then A aborts and B is final', async () => {
  // Given: the archive file uses the same scope lock and delayed A staging point.
  const { createArchiveAdapter } = await load('archive-adapter.mjs');
  const startedA = deferred();
  const resumeA = deferred();
  const handle = sharedHandle(serialized('initial', 0, 0), startedA, resumeA);
  const adapter = createArchiveAdapter({ root: { navigator: { locks: lockManager() } } });
  let authorityA = { mode: 'editing', leaseId: 'lease-a', fencingToken: 1 };
  const assertA = () => {
    if (authorityA.mode !== 'editing' || authorityA.fencingToken !== 1) {
      const error = new Error('stale archive writer');
      error.code = 'STALE_FENCE';
      throw error;
    }
  };
  const pendingA = adapter.write(envelope('A', 1, 1), {
    handle, value: serialized('A', 1, 1), assertAuthority: assertA, scopeId: 'project:alpha',
  });
  await startedA.promise;

  // When: B takes authority and queues its accepted archive content.
  authorityA = { mode: 'readonly', leaseId: 'lease-b', fencingToken: 2 };
  const pendingB = adapter.write(envelope('B', 2, 1), {
    handle, value: serialized('B', 2, 1), assertAuthority() {}, scopeId: 'project:alpha',
  });
  resumeA.resolve();

  // Then: A is rejected and the archive handle contains B.
  await assert.rejects(pendingA, error => error?.code === 'STALE_FENCE');
  await pendingB;
  assert.equal(JSON.parse(handle.value()).value, 'B');
});

test('Given a Blob workfile When publish completes Then verification compares its text content', async () => {
  // Given: the browser save path supplies a Blob rather than a plain string.
  const { publishWorkspaceFile } = await load('file-publish.mjs');
  let published = '';
  const handle = {
    async getFile() { return new Blob([published]); },
    async createWritable() {
      let staged = published;
      return {
        async write(value) { staged = await value.text(); },
        async close() { published = staged; },
        async abort() {},
      };
    },
  };
  const value = new Blob(['{"value":"blob"}'], { type: 'application/json' });

  // When: the real atomic file publisher writes and post-validates the Blob.
  await publishWorkspaceFile({ root: {}, handle, value, context: { scopeId: 'project:blob' } });

  // Then: the exact serialized content remains published instead of being rolled back.
  assert.equal(published, '{"value":"blob"}');
});

test('Given one handle across alpha and beta When stale A rolls back Then accepted B remains final', async () => {
  // Given: A and B target one physical handle while A pauses immediately before close.
  const { publishWorkspaceFile } = await load('file-publish.mjs');
  const startedA = deferred();
  const resumeA = deferred();
  const lockNames = [];
  let published = 'ORIGINAL';
  const handle = {
    name: 'shared.kuasangse',
    kind: 'file',
    async getFile() { return { async text() { return published; } }; },
    async createWritable() {
      let staged = published;
      return {
        async write(value) { staged = String(value); },
        async close() { published = staged; },
        async abort() {},
      };
    },
  };
  const root = { navigator: { locks: lockManager(lockNames) } };
  let completionChecks = 0;
  const pendingA = publishWorkspaceFile({
    root,
    handle,
    value: 'A',
    context: {
      scopeId: 'project:alpha',
      assertAuthority() {},
      assertCompletion() {
        completionChecks += 1;
        if (completionChecks > 1) {
          const error = new Error('alpha scope became stale');
          error.code = 'STALE_SCOPE';
          throw error;
        }
      },
    },
    verifyBeforeClose: async () => {
      startedA.resolve();
      await resumeA.promise;
    },
  });
  await startedA.promise;

  // When: beta publishes B through the same handle before A resumes.
  const pendingB = publishWorkspaceFile({
    root,
    handle,
    value: 'B',
    context: { scopeId: 'project:beta', assertAuthority() {}, assertCompletion() {} },
  });
  await new Promise(resolve => setImmediate(resolve));
  resumeA.resolve();
  const resultA = await pendingA.then(() => null, error => error);
  const resultB = await pendingB;

  // Then: one destination lock protects the handle and stale A cannot restore ORIGINAL over B.
  assert.equal(resultA?.code, 'STALE_SCOPE');
  assert.equal(resultB, handle);
  assert.equal(published, 'B');
  assert.equal(new Set(lockNames).size, 1);
});
