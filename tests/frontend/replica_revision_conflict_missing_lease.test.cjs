const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const MODULE_URL = new URL(
  `file://${path.resolve(__dirname, '../../src/modules/persistence/authority-runtime.mjs').replace(/\\/g, '/')}`,
).href;
const FENCING_URL = new URL(
  `file://${path.resolve(__dirname, '../../src/modules/persistence/fencing.mjs').replace(/\\/g, '/')}`,
).href;

// 저장이 거부됐을 때 앞선 replica revision 을 관찰해 한 번 재조정하는 길이 있다.
// 그 길이 편집권 열쇠 비교에서 막히면, 화면에서 넣은 값이 영영 저장되지 않는다.
// 실측 2026-08-29: 워커 탭이 70초마다 같은 오류를 반복하며 아무것도 저장하지 못했다.
function createAuthority({ leaseId, fencingToken, revision, scopeId }) {
  let currentRevision = revision;
  const observed = [];
  return {
    observed,
    api: {
      snapshot: () => ({ scopeId, leaseId, fencingToken, revision: currentRevision, mode: 'editing' }),
      observeRevision: (next, fence) => {
        observed.push({ next, fence });
        currentRevision = next;
      },
    },
  };
}

function staleRevisionError(current) {
  const error = new Error('replica already contains a newer revision');
  error.code = 'STALE_REVISION';
  error.current = current;
  return error;
}

function envelopeFor({ scopeId, leaseId, fencingToken, revision }) {
  return {
    scopeId,
    digest: 'digest-candidate',
    snapshot: {},
    metadata: {
      leaseId,
      fencingToken,
      operationId: 'op-candidate',
      revision: { scopeId, counter: revision },
    },
  };
}

test('열쇠가 기록되지 않은 replica 와 부딪혀도 앞선 revision 을 관찰해 재조정한다', async () => {
  const { createPersistenceAuthorityRuntime } = await import(MODULE_URL);
  const scopeId = 'project:pouch-missing-lease';
  const authority = createAuthority({
    leaseId: 'lease-current', fencingToken: 7, revision: 3, scopeId,
  });
  const runtime = createPersistenceAuthorityRuntime(authority.api);
  const operation = {};

  // 저장된 replica 에 열쇠가 남아 있지 않은 경우. 막는 쪽은 이 경우를 통과시켜
  // STALE_REVISION 까지 내려보내므로, 회복하는 쪽도 같은 규칙이어야 한다.
  const recognized = runtime.observeReplicaRevision({
    error: staleRevisionError({
      scopeId, leaseId: '', fencingToken: 7, revision: 9, digest: 'digest-stored', operationId: 'op-stored',
    }),
    envelope: envelopeFor({ scopeId, leaseId: 'lease-current', fencingToken: 7, revision: 4 }),
    operation,
  });

  assert.equal(recognized, true, '충돌을 알아보지 못하면 재조정 자체가 일어나지 않는다');
  assert.equal(operation.observedReplicaRevision, 9);
  assert.deepEqual(authority.observed, [{ next: 9, fence: 7 }]);
});

test('양쪽에 열쇠가 있고 서로 다르면 남의 편집권이므로 재조정하지 않는다', async () => {
  const { createPersistenceAuthorityRuntime } = await import(MODULE_URL);
  const scopeId = 'project:pouch-other-lease';
  const authority = createAuthority({
    leaseId: 'lease-mine', fencingToken: 7, revision: 3, scopeId,
  });
  const runtime = createPersistenceAuthorityRuntime(authority.api);
  const operation = {};

  const recognized = runtime.observeReplicaRevision({
    error: staleRevisionError({
      scopeId, leaseId: 'lease-theirs', fencingToken: 7, revision: 9,
    }),
    envelope: envelopeFor({ scopeId, leaseId: 'lease-mine', fencingToken: 7, revision: 4 }),
    operation,
  });

  assert.equal(recognized, false);
  assert.equal(operation.observedReplicaRevision, undefined);
  assert.deepEqual(authority.observed, []);
});

test('막는 쪽은 한쪽 열쇠가 비면 fence 로 막지 않고 revision 으로 막는다', async () => {
  const { assertReplicaCanPublish } = await import(FENCING_URL);
  const scopeId = 'project:pouch-guard-rule';
  const existing = {
    scopeId,
    digest: 'digest-stored',
    metadata: {
      leaseId: '', fencingToken: 7, operationId: 'op-stored',
      revision: { scopeId, counter: 9 },
    },
  };
  const candidate = envelopeFor({ scopeId, leaseId: 'lease-current', fencingToken: 7, revision: 4 });

  assert.throws(
    () => assertReplicaCanPublish(existing, candidate),
    error => error.code === 'STALE_REVISION',
    '열쇠가 빈 replica 는 STALE_FENCE 가 아니라 STALE_REVISION 으로 내려온다',
  );
});
