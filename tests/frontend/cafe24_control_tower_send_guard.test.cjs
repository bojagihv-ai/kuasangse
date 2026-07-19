const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(process.cwd(), 'src', 'cafe24-api.js');

function apiHubEnvelope(data) {
  return {
    ok: true,
    status: 200,
    response: { body: { ok: true, data } },
  };
}

function createHarness(responses, expectedPaths) {
  const calls = [];
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    clearInterval,
    console,
    setTimeout,
    setInterval: () => 1,
    fetch: async (url, options = {}) => {
      const request = { url: String(url), method: String(options.method || 'GET') };
      calls.push(request);
      const expectedPath = expectedPaths[calls.length - 1];
      if (expectedPath && !request.url.includes(expectedPath)) {
        throw new Error(`Cafe24 전송 전에 Control Tower 상태를 먼저 확인해야 합니다. expected=${expectedPath} actual=${request.url}`);
      }
      const next = responses.shift();
      if (!next) throw new Error(`unexpected Cafe24 request: ${request.url}`);
      const status = Number(next.status || 200);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(next.body),
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath });
  return { calls, sandbox };
}

function healthyOAuthResponses(mallId) {
  return [
    { body: apiHubEnvelope({ refreshed: true, results: [{ mall_id: mallId, refreshed: true, status: 'refreshed' }] }) },
    { body: apiHubEnvelope({
      selected_mall_id: mallId,
      missing_scopes: [],
      checks: [
        { id: 'token-keeper', status: 'pass', message: 'token valid' },
        { id: 'mall-connection', status: 'pass', message: 'connection valid' },
        { id: 'scopes', status: 'pass', message: 'scopes valid' },
      ],
    }) },
    { body: apiHubEnvelope({ data: [{ mall_id: mallId, token_status: 'healthy' }] }) },
  ];
}

test('Cafe24 전송은 Control Tower가 꺼져 있으면 먼저 자동 기동한다', async () => {
  // Given: Control Tower가 꺼져 있고 기존 OAuth 상태는 정상인 전송 환경을 준비한다.
  const mallId = 'bojagi1928';
  const expectedPaths = [
    '/api/cafe24-control/status',
    '/api/cafe24-control/start',
    '/api/invoke/cafe24_control_tower/refresh-token',
    '/api/invoke/cafe24_control_tower/console-products',
  ];
  const { calls, sandbox } = createHarness([
    { body: { ok: true, running: false, message: 'Cafe24 Control Tower가 꺼져 있습니다.' } },
    { body: { ok: true, running: true, message: 'Cafe24 Control Tower 실행을 확인했습니다.' } },
    ...healthyOAuthResponses(mallId).slice(0, 1),
    { body: apiHubEnvelope({ saved: true }) },
  ], expectedPaths);

  // When: 실제 공통 Cafe24 콘솔 전송 경계를 호출한다.
  const result = await sandbox.callCafe24Console(
    'PUT',
    '/api/v2/admin/products/123',
    { mallId, body: { body: { product: { price: '2000' } } } },
    'Update Cafe24 product 123',
  );

  // Then: 꺼짐 확인 후 한 번만 기동하고, 그 뒤에만 외부 전송을 호출한다.
  assert.equal(result.data.saved, true);
  assert.deepEqual(calls.map(call => call.url.includes('/api/cafe24-control/start')), [false, true, false, false]);
});

test('Cafe24 전송은 이미 실행 중이면 중복 기동하지 않는다', async () => {
  // Given: Control Tower가 이미 실행 중인 환경을 준비한다.
  const mallId = 'bojagi1928';
  const expectedPaths = [
    '/api/cafe24-control/status',
    '/api/invoke/cafe24_control_tower/refresh-token',
    '/api/invoke/cafe24_control_tower/console-products',
  ];
  const { calls, sandbox } = createHarness([
    { body: { ok: true, running: true, message: '이미 실행 중입니다.' } },
    ...healthyOAuthResponses(mallId).slice(0, 1),
    { body: apiHubEnvelope({ saved: true }) },
  ], expectedPaths);

  // When: 같은 공통 전송 경계를 호출한다.
  await sandbox.callCafe24Console('PUT', '/api/v2/admin/products/123', { mallId, body: { body: { product: { price: '2000' } } } });

  // Then: 상태 확인 뒤 start 요청 없이 기존 실행 인스턴스를 사용한다.
  assert.equal(calls.some(call => call.url.endsWith('/api/cafe24-control/start')), false);
});

test('Cafe24 Control Tower 자동 기동 실패는 외부 전송으로 넘어가지 않는다', async () => {
  // Given: Control Tower 상태는 꺼져 있고 기존 실행 API가 실패한다.
  const { calls, sandbox } = createHarness([
    { body: { ok: true, running: false, message: '꺼져 있습니다.' } },
    { status: 504, body: { ok: false, message: '45초 안에 API 연결을 확인하지 못했습니다.' } },
  ], ['/api/cafe24-control/status', '/api/cafe24-control/start']);

  // When/Then: 전송은 중단되고 사용자가 볼 수 있는 오류가 유지된다.
  await assert.rejects(
    sandbox.callCafe24Console('PUT', '/api/v2/admin/products/123', { mallId: 'bojagi1928', body: { body: { product: { price: '2000' } } } }),
    /45초 안에 API 연결을 확인하지 못했습니다/,
  );
  assert.equal(calls.length, 2);
});

test('동시 Cafe24 전송은 Control Tower 기동을 한 번만 요청한다', async () => {
  // Given: 두 전송이 동시에 시작되고 Control Tower는 꺼져 있다.
  const mallId = 'bojagi1928';
  const expectedPaths = [
    '/api/cafe24-control/status',
    '/api/cafe24-control/start',
    '/api/invoke/cafe24_control_tower/refresh-token',
    '/api/invoke/cafe24_control_tower/console-products',
    '/api/invoke/cafe24_control_tower/console-products',
  ];
  const { calls, sandbox } = createHarness([
    { body: { ok: true, running: false, message: '꺼져 있습니다.' } },
    { body: { ok: true, running: true, message: '실행 완료' } },
    ...healthyOAuthResponses(mallId).slice(0, 1),
    { body: apiHubEnvelope({ saved: true }) },
    { body: apiHubEnvelope({ saved: true }) },
  ], expectedPaths);

  // When: 실제 Cafe24 콘솔 전송 경계를 동시에 두 번 호출한다.
  await Promise.all([
    sandbox.callCafe24Console('PUT', '/api/v2/admin/products/123', { mallId, body: { body: { product: { price: '2000' } } } }),
    sandbox.callCafe24Console('PUT', '/api/v2/admin/products/123', { mallId, body: { body: { product: { price: '2000' } } } }),
  ]);

  // Then: 상태 확인과 기동은 한 번이고 실제 전송 두 건만 각각 진행된다.
  assert.equal(calls.filter(call => call.url.endsWith('/api/cafe24-control/status')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/api/cafe24-control/start')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/console-products')).length, 2);
});
