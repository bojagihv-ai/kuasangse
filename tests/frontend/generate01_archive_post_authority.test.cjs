'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

async function loadArchiveAdapter() {
  const { pathToFileURL } = require('node:url');
  const modulePath = path.join(ROOT, 'src/modules/persistence/archive-adapter.mjs');
  return import(`${pathToFileURL(modulePath).href}?generate01=${Date.now()}-${Math.random()}`);
}

test('GENERATE-01 archive POST reacquires the target project lease after the draft restore', async () => {
  const { fetchArchiveWithAuthority } = await loadArchiveAdapter();
  const writer = sourceSlice(
    fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8'),
    'async function factoryBackendArchiveAsset(', 'function factoryApplyLocalArchiveRecordToAsset(',
  );
  const scopeId = 'project:generate-01';
  let current = { scopeId, mode: 'readonly', leaseId: '', fencingToken: 0, revision: 4 };
  const transitions = [];
  const requests = [];
  const authority = {
    snapshot: () => ({ ...current }),
    runMutation: async operation => operation(),
  };
  const context = vm.createContext({
    state: { backendBaseUrl: 'http://archive.test' },
    window: { AbortSignal: null },
    factoryBackendBaseUrl: () => 'http://archive.test',
    factoryLocalArchivePayload: () => ({
      workspaceId: 'generate-01',
      asset: { id: 'hero-1', workspaceId: 'generate-01', image: 'data:image/png;base64,AA==' },
    }),
    currentWorkspaceAuthority: () => current,
    getCurrentLastWorkWorkspaceScope: () => 'draft:tab-after-save',
    ensureWorkspaceEditAuthority: async (scope, options) => {
      transitions.push({ scope, options: { ...options }, before: { ...current } });
      current = { scopeId: scope, mode: 'editing', leaseId: 'lease-generate-01', fencingToken: 21, revision: 5 };
      return current;
    },
    workspaceArchiveFetch: (url, options) => fetchArchiveWithAuthority({
      authority,
      url,
      options,
      createAuthorityError: (code, message, snapshot) => Object.assign(new Error(message), { code, snapshot }),
      adapter: { async fetchResponse(requestUrl, requestOptions) {
        requests.push({ url: requestUrl, body: JSON.parse(requestOptions.body), authority: { ...current } });
        return { ok: true, status: 200, async text() { return JSON.stringify({ ok: true, archive: { archiveId: 'archive-hero-1' } }); } };
      } },
    }),
  });
  vm.runInContext(`${writer}\nthis.archive = factoryBackendArchiveAsset;`, context);

  const result = await context.archive({ id: 'hero-1', image: 'data:image/png;base64,AA==' }, 'hero-generated');

  assert.equal(result.archive.archiveId, 'archive-hero-1');
  assert.deepEqual(transitions, [{
    scope: scopeId,
    options: { force: true },
    before: { scopeId, mode: 'readonly', leaseId: '', fencingToken: 0, revision: 4 },
  }]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].authority, current);
  assert.equal(requests[0].body.authorityWorkspaceId, scopeId);
  assert.equal(requests[0].body.leaseId, 'lease-generate-01');
  assert.equal(requests[0].body.fencingToken, 21);
});

test('archive POST keeps the existing offline draft authority', async () => {
  const { fetchArchiveWithAuthority } = await loadArchiveAdapter();
  const writer = sourceSlice(
    fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8'),
    'async function factoryBackendArchiveAsset(', 'function factoryApplyLocalArchiveRecordToAsset(',
  );
  const current = { scopeId: 'draft:generate-01', mode: 'offline-edit', leaseId: '', fencingToken: 0, revision: 8 };
  let ensureCalls = 0;
  let archivedBody;
  const authority = { snapshot: () => ({ ...current }), runMutation: async operation => operation() };
  const context = vm.createContext({
    state: { backendBaseUrl: 'http://archive.test' },
    window: { AbortSignal: null },
    factoryBackendBaseUrl: () => 'http://archive.test',
    factoryLocalArchivePayload: () => ({
      workspaceId: 'generate-01',
      asset: { id: 'hero-offline', workspaceId: 'generate-01', image: 'data:image/png;base64,AA==' },
    }),
    currentWorkspaceAuthority: () => current,
    getCurrentLastWorkWorkspaceScope: () => current.scopeId,
    ensureWorkspaceEditAuthority: async () => { ensureCalls += 1; throw new Error('offline draft authority must not be replaced'); },
    workspaceArchiveFetch: (url, options) => fetchArchiveWithAuthority({
      authority,
      url,
      options,
      createAuthorityError: (code, message, snapshot) => Object.assign(new Error(message), { code, snapshot }),
      adapter: { async fetchResponse(_requestUrl, requestOptions) {
        archivedBody = JSON.parse(requestOptions.body);
        return { ok: true, status: 200, async text() { return JSON.stringify({ ok: true, archive: { archiveId: 'archive-offline' } }); } };
      } },
    }),
  });
  vm.runInContext(`${writer}\nthis.archive = factoryBackendArchiveAsset;`, context);

  const result = await context.archive({ id: 'hero-offline', image: 'data:image/png;base64,AA==' }, 'hero-generated');

  assert.equal(result.archive.archiveId, 'archive-offline');
  assert.equal(ensureCalls, 0);
  assert.equal(archivedBody.authorityWorkspaceId, current.scopeId);
  assert.equal(archivedBody.expectedRevision, 8);
});
