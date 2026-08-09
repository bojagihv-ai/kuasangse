const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP_CORE = path.resolve(__dirname, '../../src/app-core-02.js');

function createRecoveryWriter({ lock, persistence, warnings }) {
  const source = fs.readFileSync(APP_CORE, 'utf8');
  const start = source.indexOf('const FACTORY_LAST_SNAPSHOT_RECOVERY_KEY');
  const end = source.indexOf('\nfunction workspaceSessionSetItem', start);
  assert.ok(start >= 0 && end > start, 'recovery write helper source was not found');
  return new Function(
    'workspaceLockApi',
    'workspacePersistenceApi',
    'console',
    `${source.slice(start, end)}\nreturn { writeWorkspaceRecoveryValue };`,
  )(
    () => lock,
    () => persistence,
    { warn: (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' ')) },
  ).writeWorkspaceRecoveryValue;
}

test('필수값 체크포인트는 같은 편집권의 앞선 replica revision을 관찰한 뒤 한 번 재시도한다', async () => {
  const warnings = [];
  const observed = [];
  const writes = [];
  let authority = {
    scopeId: 'project:field-checkpoint-reconcile',
    leaseId: 'lease-field-checkpoint',
    fencingToken: 23,
    revision: 4,
  };
  const lock = {
    snapshot: () => authority,
    observeRevision(revision, fencingToken) {
      observed.push({ revision, fencingToken });
      authority = { ...authority, revision: Math.max(authority.revision, Number(revision) || 0) };
      return authority;
    },
  };
  const persistence = {
    async writeRecoveryValue(key, value) {
      writes.push({ key, value, attempt: writes.length + 1 });
      if (writes.length === 1) {
        const error = new Error('replica already contains a newer revision');
        error.code = 'STALE_REVISION';
        error.current = {
          scopeId: authority.scopeId,
          leaseId: authority.leaseId,
          fencingToken: authority.fencingToken,
          revision: 11,
        };
        throw error;
      }
      return true;
    },
  };
  const writeRecoveryValue = createRecoveryWriter({ lock, persistence, warnings });

  const saved = await writeRecoveryValue('pdp_last_input_checkpoint_v1', 'confirmed-fields');

  assert.equal(saved, true);
  assert.deepEqual(writes, [
    { key: 'pdp_last_input_checkpoint_v1', value: 'confirmed-fields', attempt: 1 },
    { key: 'pdp_last_input_checkpoint_v1', value: 'confirmed-fields', attempt: 2 },
  ]);
  assert.deepEqual(observed, [{ revision: 11, fencingToken: 23 }]);
  assert.equal(authority.revision, 11);
  assert.deepEqual(warnings, []);
});

test('필수값 체크포인트는 다른 lease의 replica revision을 관찰해도 재시도하지 않는다', async () => {
  const warnings = [];
  const observed = [];
  const writes = [];
  const authority = {
    scopeId: 'project:field-checkpoint-lease-guard',
    leaseId: 'lease-current',
    fencingToken: 31,
    revision: 4,
  };
  const lock = {
    snapshot: () => authority,
    observeRevision(revision, fencingToken) {
      observed.push({ revision, fencingToken });
      return authority;
    },
  };
  const persistence = {
    async writeRecoveryValue(key, value) {
      writes.push({ key, value, attempt: writes.length + 1 });
      const error = new Error('replica lease differs at the same fencing token');
      error.code = 'STALE_REVISION';
      error.current = {
        scopeId: authority.scopeId,
        leaseId: 'lease-other',
        fencingToken: authority.fencingToken,
        revision: 11,
      };
      throw error;
    },
  };
  const writeRecoveryValue = createRecoveryWriter({ lock, persistence, warnings });

  await assert.rejects(
    writeRecoveryValue('pdp_last_input_checkpoint_v1', 'confirmed-fields'),
    /replica lease differs at the same fencing token/,
  );

  assert.deepEqual(writes, [
    { key: 'pdp_last_input_checkpoint_v1', value: 'confirmed-fields', attempt: 1 },
  ]);
  assert.deepEqual(observed, []);
  assert.deepEqual(warnings, [
    'Workspace recovery write failed (pdp_last_input_checkpoint_v1): replica lease differs at the same fencing token',
  ]);
});

test('옵션 분류기 색상명 복구값도 앞선 replica revision을 관찰한 뒤 한 번 재시도한다', async () => {
  const warnings = [];
  const observed = [];
  const writes = [];
  let authority = {
    scopeId: 'project:optionsorter-color-map-reconcile',
    leaseId: 'lease-optionsorter-color-map',
    fencingToken: 41,
    revision: 7,
  };
  const lock = {
    snapshot: () => authority,
    observeRevision(revision, fencingToken) {
      observed.push({ revision, fencingToken });
      authority = { ...authority, revision: Math.max(authority.revision, Number(revision) || 0) };
      return authority;
    },
  };
  const persistence = {
    async writeRecoveryValue(key, value) {
      writes.push({ key, value, attempt: writes.length + 1 });
      if (writes.length === 1) {
        const error = new Error('replica already contains a newer revision');
        error.code = 'STALE_REVISION';
        error.current = {
          scopeId: authority.scopeId,
          leaseId: authority.leaseId,
          fencingToken: authority.fencingToken,
          revision: 13,
        };
        throw error;
      }
      return true;
    },
  };
  const writeRecoveryValue = createRecoveryWriter({ lock, persistence, warnings });

  const saved = await writeRecoveryValue(
    'pdp_option_sorter_live_v1',
    JSON.stringify({ workspaceScope: authority.scopeId, optionSorter: { slots: [] } }),
  );

  assert.equal(saved, true);
  assert.equal(writes.length, 2);
  assert.deepEqual(observed, [{ revision: 13, fencingToken: 41 }]);
  assert.equal(authority.revision, 13);
  assert.deepEqual(warnings, []);
});
