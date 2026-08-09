const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = path.resolve(
  __dirname,
  '../../src/modules/persistence/archive-adapter.mjs',
);

async function loadArchiveAdapter() {
  return import(`${pathToFileURL(MODULE).href}?offline-branch=${Date.now()}-${Math.random()}`);
}

function authorityError(code, message, snapshot) {
  const error = new Error(message);
  error.code = code;
  error.snapshot = snapshot;
  return error;
}

test('offline PSD branch archives project-scoped assets under its current branch fence', async () => {
  const { fetchArchiveWithAuthority } = await loadArchiveAdapter();
  const calls = [];
  const current = {
    mode: 'offline-edit',
    scopeId: 'draft:tab-branch-a',
    leaseId: '',
    fencingToken: 0,
    revision: 7,
  };
  const authority = {
    snapshot: () => ({ ...current }),
    runMutation: operation => operation(),
  };
  const adapter = {
    async fetchResponse(url, options) {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  };

  await fetchArchiveWithAuthority({
    adapter,
    authority,
    url: '/api/local-archive/assets',
    options: {
      method: 'POST',
      body: JSON.stringify({
        asset: {
          id: 'asset-a',
          workspaceId: 'project-product-a',
          productKey: 'product-a',
        },
      }),
    },
    createAuthorityError: authorityError,
  });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.asset.workspaceId, 'project-product-a');
  assert.equal(body.authorityWorkspaceId, 'draft:tab-branch-a');
  assert.equal(body.expectedRevision, 7);
});

test('offline PSD archive completion is rejected after the tab branch changes', async () => {
  const { fetchArchiveWithAuthority } = await loadArchiveAdapter();
  let current = {
    mode: 'offline-edit',
    scopeId: 'draft:tab-branch-a',
    leaseId: '',
    fencingToken: 0,
    revision: 3,
  };
  let finishRequest;
  const requestFinished = new Promise(resolve => { finishRequest = resolve; });
  const authority = {
    snapshot: () => ({ ...current }),
    runMutation: operation => operation(),
  };
  const adapter = {
    async fetchResponse() {
      await requestFinished;
      return { ok: true, status: 200 };
    },
  };
  const pending = fetchArchiveWithAuthority({
    adapter,
    authority,
    url: '/api/local-archive/assets',
    options: {
      method: 'POST',
      body: JSON.stringify({ asset: { workspaceId: 'project-product-a' } }),
    },
    createAuthorityError: authorityError,
  });

  current = { ...current, scopeId: 'draft:tab-branch-b' };
  finishRequest();

  await assert.rejects(pending, error => error?.code === 'STALE_FENCE');
});
