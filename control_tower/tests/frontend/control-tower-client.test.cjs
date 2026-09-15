const assert = require('node:assert/strict');
const test = require('node:test');

test('shared client refreshes a missing CSRF session once and preserves the request signal and body', async () => {
  const { createControlTowerClient } = await import('../../frontend/src/control-tower-client.mjs');
  const calls = [];
  const responses = [
    { ok: false, status: 403, body: { error: { code: 'csrf_required' } } },
    { ok: true, status: 200, body: { sessionId: 'fixture-session', csrfToken: 'fixture-csrf' } },
    { ok: true, status: 202, body: { accepted: true } },
  ];
  const client = createControlTowerClient({ apiBase: 'http://127.0.0.1:41009', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const result = responses.shift();
    return { ...result, json: async () => result.body };
  } });
  const signal = new AbortController().signal;
  assert.deepEqual(await client.apiRequest('/api/factory/jobs', { method: 'POST', body: '{"fixture":true}', signal }), { accepted: true });
  assert.equal(calls.length, 3);
  assert.ok(calls[1].url.endsWith('/api/session'));
  assert.equal(calls[2].options.signal, signal);
  assert.equal(calls[2].options.body, calls[0].options.body);
  assert.equal(calls[2].options.credentials, 'include');
  assert.equal(calls[2].options.headers['X-Control-Tower-CSRF'], 'fixture-csrf');
  assert.equal(calls[2].options.headers['X-Control-Tower-Session'], 'fixture-session');
});

test('shared client rejects nonlocal origins and never retries a business failure', async () => {
  const { createControlTowerClient } = await import('../../frontend/src/control-tower-client.mjs');
  assert.throws(() => createControlTowerClient({ apiBase: 'https://example.com' }), /factory_api_origin_invalid/);
  let count = 0;
  const client = createControlTowerClient({ apiBase: 'http://localhost:41009', fetchImpl: async () => {
    count += 1;
    return { ok: false, status: 409, json: async () => ({ error: { code: 'stale_product_checkpoint' } }) };
  } });
  await assert.rejects(client.apiRequest('/api/factory/jobs/example/resume', { method: 'POST' }), { code: 'stale_product_checkpoint', status: 409 });
  assert.equal(count, 1);
});
