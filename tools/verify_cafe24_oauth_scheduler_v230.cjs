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

function healthyResponses(mallId) {
  return [
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
  ];
}

function createHarness(responses) {
  const calls = [];
  const intervals = [];
  const clearedIntervals = [];
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    clearInterval: id => clearedIntervals.push(id),
    console,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: String(options.method || 'GET') });
      const response = responses.shift();
      if (!response) throw new Error(`unexpected Cafe24 request: ${url}`);
      return fetchResponse(response);
    },
    setTimeout,
    setInterval: (callback, delayMs) => {
      const id = intervals.length + 1;
      intervals.push({ callback, delayMs, id });
      return id;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath });
  return { calls, intervals, clearedIntervals, sandbox };
}

async function verifyCafe24RefreshScheduler() {
  const mallId = 'bojagi1928';
  const { calls, intervals, clearedIntervals, sandbox } = createHarness([
    ...healthyResponses(mallId),
    ...healthyResponses(mallId),
  ]);
  const statuses = [];

  // Given: the app has a valid Cafe24 refresh authority and is open but idle.
  // When: the shared OAuth scheduler starts and its interval fires once.
  const startResult = sandbox.startCafe24OAuthAutoRefresh({
    mallId,
    onStatus: status => statuses.push(status),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await intervals[0].callback();

  // Then: the scheduler refreshes through the existing status boundary twice and can be stopped cleanly.
  assert.equal(startResult.started, true, 'Cafe24 OAuth scheduler must start');
  assert.equal(startResult.intervalMs, 80 * 60 * 1000, 'Cafe24 OAuth scheduler must use the stable refresh interval');
  assert.equal(intervals.length, 1, 'Cafe24 OAuth scheduler must install one interval');
  assert.equal(statuses.length, 2, 'initial and interval refresh must both publish safe status');
  assert.deepEqual(calls.map(call => call.url.split('/').pop()), [
    'refresh-token', 'setup-status', 'connections',
    'refresh-token', 'setup-status', 'connections',
  ], 'idle refresh must use the same API Hub refresh/status path');
  assert.equal(/access_token|refresh_token|client_secret|authorization/i.test(JSON.stringify(statuses)), false, 'scheduler status must not expose credentials');

  sandbox.stopCafe24OAuthAutoRefresh();
  assert.deepEqual(clearedIntervals, [intervals[0].id], 'Cafe24 OAuth scheduler must release its interval');
}

async function verifyRefreshSingleFlight() {
  const mallId = 'bojagi1928';
  const { calls, sandbox } = createHarness([
    ...healthyResponses(mallId),
    ...healthyResponses(mallId).slice(1),
  ]);

  // Given: two UI paths ask for Cafe24 status at the same time.
  // When: both status checks begin before the first refresh finishes.
  await Promise.all([
    sandbox.fetchCafe24OAuthStatus(mallId),
    sandbox.fetchCafe24OAuthStatus(mallId),
  ]);

  // Then: the rotating refresh authority is exchanged only once.
  assert.equal(calls.filter(call => call.url.endsWith('/refresh-token')).length, 1, 'concurrent OAuth status checks must share one refresh exchange');
}

verifyCafe24RefreshScheduler()
  .then(() => verifyRefreshSingleFlight())
  .then(() => console.log(JSON.stringify({ ok: true, test: 'Cafe24 OAuth idle refresh scheduler and single-flight refresh' }, null, 2)))
  .catch(error => {
    console.error(`Cafe24 OAuth scheduler verifier failed: ${error.message || error}`);
    process.exitCode = 1;
  });
