// 회귀: 성공한 archive 쓰기를 lease 갱신만으로 실패로 뒤집던 문제.
//
// archive-adapter 는 쓰기를 보낸 뒤 authority 스냅샷을 다시 읽어
// leaseId/fencingToken 이 바뀌었으면 STALE_FENCE 를 던졌다. 그런데 그 쓰기는
// 서버가 leaseId·fencingToken·expectedRevision 으로 이미 CAS 검증해 반영한 뒤다.
// 던져도 되돌려지지 않으므로 "실패했다"는 오보만 남는다.
//
// 실제 피해: 2026-08-22 GENERATE-01 이 7회 중 2회
//   "이미지 API 실패: archive mutation completed after authority changed" 로 실패했다.
//   하이드레이션 끝의 draft 브랜치 권한 복구(force:true)가 왕복 중에 토큰을 바꾼다.
//
// 계약: 스코프가 바뀐 경우만 위험하다(결과를 다른 작업에 적용하면 그 작업이 오염된다).
//       같은 스코프 안의 lease 갱신·재획득은 성공한 쓰기를 유지해야 한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

async function load() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const adapterUrl = pathToFileURL(
    path.join(ROOT, 'src', 'modules', 'persistence', 'archive-adapter.mjs'),
  ).href;
  const contractsUrl = pathToFileURL(
    path.join(ROOT, 'src', 'modules', 'persistence', 'contracts.mjs'),
  ).href;
  const [adapterNs, contractsNs] = await Promise.all([
    import(`${adapterUrl}?lease-renewal=${stamp}`),
    import(`${contractsUrl}?lease-renewal=${stamp}`),
  ]);
  return { ...adapterNs, ...contractsNs };
}

function authorityError(code, message, snapshot) {
  const error = new Error(message);
  error.code = code;
  error.snapshot = snapshot;
  return error;
}

// 요청이 왕복하는 동안 authority 를 바꿔치기할 수 있는 하네스.
async function runWrite({ fetchArchiveWithAuthority, scopeId, mutateDuringFlight }) {
  let current = {
    mode: 'editing',
    scopeId,
    leaseId: 'lease-1',
    fencingToken: 7,
    revision: 3,
  };
  let finish;
  const inFlight = new Promise(resolve => { finish = resolve; });
  const authority = {
    snapshot: () => ({ ...current }),
    runMutation: operation => operation(),
  };
  const adapter = {
    async fetchResponse() {
      await inFlight;
      return { ok: true, status: 200, marker: 'written' };
    },
  };
  const pending = fetchArchiveWithAuthority({
    adapter,
    authority,
    url: '/api/local-archive/assets',
    options: { method: 'POST', body: JSON.stringify({ asset: { workspaceId: scopeId } }) },
    createAuthorityError: authorityError,
  });
  current = { ...current, ...mutateDuringFlight(current) };
  finish();
  return pending;
}

test('같은 스코프에서 lease 가 갱신되어도 성공한 쓰기를 실패로 뒤집지 않는다', async () => {
  const { fetchArchiveWithAuthority, normalizeProjectScope } = await load();
  const scopeId = normalizeProjectScope('lease-renewal-a');

  // 하이드레이션 끝의 draft 브랜치 권한 복구처럼 같은 스코프에서 lease 를 다시 딴 상황.
  const response = await runWrite({
    fetchArchiveWithAuthority,
    scopeId,
    mutateDuringFlight: () => ({ leaseId: 'lease-2', fencingToken: 8 }),
  });

  assert.equal(response.ok, true, '서버가 이미 반영한 쓰기는 성공으로 남아야 한다');
  assert.equal(response.marker, 'written');
});

test('fencingToken 만 올라간 경우도 성공을 유지한다', async () => {
  const { fetchArchiveWithAuthority, normalizeProjectScope } = await load();
  const scopeId = normalizeProjectScope('lease-renewal-b');

  const response = await runWrite({
    fetchArchiveWithAuthority,
    scopeId,
    mutateDuringFlight: () => ({ fencingToken: 99 }),
  });

  assert.equal(response.ok, true);
});

test('스코프가 바뀌면 여전히 STALE_FENCE 로 막는다', async () => {
  const { fetchArchiveWithAuthority, normalizeProjectScope } = await load();
  const scopeId = normalizeProjectScope('lease-renewal-c');
  const otherScope = normalizeProjectScope('lease-renewal-other');

  // 결과를 다른 작업에 적용하면 그 작업이 오염되므로 이 경우는 반드시 막아야 한다.
  await assert.rejects(
    runWrite({
      fetchArchiveWithAuthority,
      scopeId,
      mutateDuringFlight: () => ({ scopeId: otherScope }),
    }),
    error => error?.code === 'STALE_FENCE',
  );
});

test('아무것도 바뀌지 않으면 당연히 성공이다', async () => {
  const { fetchArchiveWithAuthority, normalizeProjectScope } = await load();
  const scopeId = normalizeProjectScope('lease-renewal-d');

  const response = await runWrite({
    fetchArchiveWithAuthority,
    scopeId,
    mutateDuringFlight: () => ({}),
  });

  assert.equal(response.ok, true);
});

test('사후 검사는 스코프만 본다 (lease·token 비교가 남아 있으면 안 된다)', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'modules', 'persistence', 'archive-adapter.mjs'),
    'utf8',
  );
  const projectBranch = source.slice(source.indexOf('const pathScope'));
  assert.match(
    projectBranch,
    /if \(latest\.scopeId !== scopeId\) \{[\s\S]{0,160}STALE_FENCE/,
    '쓰기 후 검사는 스코프 변경만 막아야 한다',
  );
  assert.doesNotMatch(
    projectBranch,
    /latest\.leaseId !== current\.leaseId/,
    '성공한 쓰기를 lease 변경만으로 실패 처리하면 안 된다',
  );
});
