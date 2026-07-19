const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(process.cwd(), 'src', 'cafe24-api.js');

function apiHubEnvelope(data) {
  return {
    ok: true,
    status: 200,
    response: { body: { ok: true, data } },
  };
}

function fetchResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function createHarness(responses) {
  const calls = [];
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    console,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: String(options.method || 'GET') });
      const response = responses.shift();
      if (!response) throw new Error(`unexpected Cafe24 request: ${url}`);
      return fetchResponse(response);
    },
    setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath });
  return { calls, sandbox };
}

async function verifyAutoRefreshBeforeStatusCheck() {
  const mallId = 'bojagi1928';
  const { calls, sandbox } = createHarness([
    apiHubEnvelope({
      refreshed: true,
      results: [{ mall_id: mallId, refreshed: true, status: 'refreshed', reason: 'stored token refreshed' }],
    }),
    apiHubEnvelope({
      selected_mall_id: mallId,
      missing_scopes: [],
      checks: [
        { id: 'token-keeper', status: 'pass', message: 'token valid' },
        { id: 'mall-connection', status: 'pass', message: 'connection valid' },
        { id: 'scopes', status: 'pass', message: 'scopes valid' },
      ],
    }),
    apiHubEnvelope({
      data: [{
        mall_id: mallId,
        token_status: 'healthy',
        refresh_token_expires_at: '2026-07-27T07:21:54.000Z',
        refresh_token_expires_in_seconds: 1209600,
      }],
    }),
  ]);

  // Given: stored Cafe24 refresh authority is valid.
  // When: the factory asks for OAuth status before candidate collection.
  const status = await sandbox.fetchCafe24OAuthStatus(mallId);

  // Then: refresh occurs first and the usable status preserves that fact without credentials.
  assert.deepEqual(calls.map(call => call.url.split('/').pop()), ['refresh-token', 'setup-status', 'connections'], 'OAuth status must refresh and then inspect the stored connection deadline');
  assert.equal(status.state, 'ready', 'refreshed token must yield a ready OAuth status');
  assert.equal(status.refreshAttempted, true, 'status must expose that auto refresh was attempted');
  assert.equal(status.refreshed, true, 'status must expose successful automatic refresh');
  assert.equal(status.refreshWarning, false, 'a healthy refresh authority outside the warning window must not warn');
  assert.equal(/access_token|refresh_token|client_secret|authorization/i.test(JSON.stringify(status)), false, 'OAuth status must not expose credentials');
}

async function verifyDirectCafe24CallRefreshesBeforeProducts() {
  const mallId = 'bojagi1928';
  const { calls, sandbox } = createHarness([
    apiHubEnvelope({
      refreshed: true,
      results: [{ mall_id: mallId, refreshed: true, status: 'healthy', reason: 'stored token refreshed' }],
    }),
    { products: [{ product_no: 101, product_name: '테스트 수저' }] },
  ]);

  // Given: candidate collection calls the shared Cafe24 product endpoint directly.
  // When: the stored access token may be stale.
  const products = await sandbox.fetchCafe24ProductsByQuery('수저', 3);

  // Then: the direct call must refresh first, then read products.
  assert.deepEqual(calls.map(call => call.url.split('/').pop()), ['refresh-token', 'products'], 'direct Cafe24 reads must refresh the stored token before using the access token');
  assert.equal(products.length, 1, 'the direct product response must remain available after the preflight');
}

async function verifyRefreshAuthorityWarning() {
  const mallId = 'bojagi1928';
  const { sandbox } = createHarness([
    apiHubEnvelope({
      refreshed: false,
      results: [{ mall_id: mallId, refreshed: false, status: 'healthy', reason: 'token still healthy' }],
    }),
    apiHubEnvelope({
      selected_mall_id: mallId,
      missing_scopes: [],
      checks: [
        { id: 'token-keeper', status: 'pass', message: 'token valid' },
        { id: 'mall-connection', status: 'pass', message: 'connection valid' },
        { id: 'scopes', status: 'pass', message: 'scopes valid' },
      ],
    }),
    apiHubEnvelope({
      data: [{
        mall_id: mallId,
        token_status: 'healthy',
        refresh_token_expires_at: '2026-07-13T08:21:54.000Z',
        refresh_token_expires_in_seconds: 3600,
      }],
    }),
  ]);

  const status = await sandbox.fetchCafe24OAuthStatus(mallId);

  assert.equal(status.refreshWarning, true, 'a refresh authority inside the warning window must be visible');
  assert.match(status.refreshWarningMessage, /갱신 권한 만료까지/, 'the warning must tell the operator what is expiring');
}

verifyAutoRefreshBeforeStatusCheck()
  .then(() => verifyDirectCafe24CallRefreshesBeforeProducts())
  .then(() => verifyRefreshAuthorityWarning())
  .then(() => console.log(JSON.stringify({ ok: true, test: 'Cafe24 auto refresh before status check' }, null, 2)))
  .catch(error => {
    console.error(`Cafe24 OAuth auto-refresh verifier failed: ${error.message || error}`);
    process.exitCode = 1;
  });
