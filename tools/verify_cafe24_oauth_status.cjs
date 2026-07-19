const assert = require('node:assert/strict');

const hubBase = String(process.env.API_HUB_BASE || 'http://127.0.0.1:4321').replace(/\/+$/, '');
const connectorId = 'cafe24_control_tower';
const endpointId = 'setup-status';

function safeCheck(check = {}) {
  return {
    id: String(check.id || '').trim(),
    status: String(check.status || '').trim().toLowerCase(),
  };
}

async function main() {
  const response = await fetch(`${hubBase}/api/invoke/${connectorId}/${endpointId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  });
  const envelope = await response.json();
  assert.equal(response.ok, true, `API Hub HTTP ${response.status}`);
  assert.equal(envelope.ok, true, 'API Hub 호출 실패');

  const rawBody = envelope?.response?.body?.data ?? envelope?.response?.body ?? envelope?.body ?? envelope;
  const serialized = JSON.stringify(rawBody);
  assert.equal(/access_token|refresh_token|client_secret|authorization/i.test(serialized), false, '응답에 비공개 인증 필드가 포함됨');
  assert.equal(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}|(?:access|refresh)[_-]?token\s*[:=]\s*[^\s,"'}`]+|client[_-]?secret\s*[:=]\s*[^\s,"'}`]+/i.test(serialized), false, '응답 메시지에 비공개 인증값이 포함됨');
  assert.equal(typeof rawBody.selected_mall_id, 'string', 'selected_mall_id 없음');
  assert.equal(Array.isArray(rawBody.checks), true, 'checks 배열 없음');
  assert.equal(Array.isArray(rawBody.missing_scopes), true, 'missing_scopes 배열 없음');

  const checks = rawBody.checks.map(safeCheck);
  const checkIds = new Set(checks.map(check => check.id));
  ['mall-connection', 'scopes', 'token-keeper'].forEach(id => {
    assert.equal(checkIds.has(id), true, `OAuth 상태 check 누락: ${id}`);
  });

  const tokenCheck = checks.find(check => check.id === 'token-keeper');
  const state = tokenCheck.status === 'fail' || rawBody.missing_scopes.length
    ? 'reauth_or_scope_required'
    : 'ready_or_attention';
  console.log(JSON.stringify({
    connectorId,
    endpointId,
    httpStatus: response.status,
    mallId: rawBody.selected_mall_id,
    missingScopeCount: rawBody.missing_scopes.length,
    checks,
    normalizedState: state,
  }, null, 2));
}

main().catch(error => {
  console.error(`Cafe24 OAuth smoke 실패: ${error.message || error}`);
  process.exitCode = 1;
});
