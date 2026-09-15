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

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} source was not found`);
  return source.slice(start, end);
}

function createFactoryRecoveryWriteRuntime({ lock, persistence, warnings, getScope, projectCoversBranch }) {
  const source = fs.readFileSync(APP_CORE, 'utf8');
  const recoveryStart = source.indexOf('const FACTORY_LAST_SNAPSHOT_RECOVERY_KEY');
  const recoveryEnd = source.indexOf('\nfunction workspaceSessionSetItem', recoveryStart);
  const factoryStart = source.indexOf('function factoryLastSnapshotRecoveryWriteDecision');
  const factoryEnd = source.indexOf('\nfunction workspaceRevisionApi', factoryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'recovery write source was not found');
  assert.ok(factoryStart >= 0 && factoryEnd > factoryStart, 'factory recovery queue source was not found');
  return new Function(
    'workspaceLockApi',
    'workspacePersistenceApi',
    'console',
    'getCurrentLastWorkWorkspaceScope',
    'projectAuthorityCoversCurrentBranch',
    `
      const state = { factory: { product: { productName: 'SAVE-04 recovery pointer' } } };
      let pendingFactoryLastSnapshotRecoveryWrite = null;
      const currentWorkspaceAuthority = () => workspaceLockApi().snapshot();
      ${source.slice(recoveryStart, recoveryEnd)}
      ${source.slice(factoryStart, factoryEnd)}
      return {
        queueFactoryLastSnapshotRecoveryWrite,
        flushPendingFactoryLastSnapshotRecoveryWrite,
        ensureWorkspaceEditAuthority,
        pendingFactoryLastSnapshotRecoveryWrite: () => pendingFactoryLastSnapshotRecoveryWrite,
      };
    `,
  )(
    () => lock,
    () => persistence,
    { warn: (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' ')) },
    getScope,
    projectCoversBranch,
  );
}

test('SAVE-04 project authority defers the factory recovery write until draft authority restoration flushes it', async () => {
  const branchScope = 'draft:save-04-recovery';
  const warnings = [];
  const writes = [];
  let authority = {
    mode: 'editing',
    scopeId: 'project:save-04-recovery',
    leaseId: 'lease-project-save-04',
    fencingToken: 71,
  };
  const runtime = createFactoryRecoveryWriteRuntime({
    lock: {
      snapshot: () => authority,
      acquire: async () => authority,
    },
    persistence: {
      normalizeWorkspaceScope: value => value,
      async writeRecoveryValue(key, value) {
        writes.push({ key, value, scopeId: authority.scopeId, mode: authority.mode });
        return true;
      },
    },
    warnings,
    getScope: () => branchScope,
    projectCoversBranch: (scopeId, current) => (
      scopeId === branchScope && current?.scopeId === 'project:save-04-recovery'
    ),
  });

  const queued = await runtime.queueFactoryLastSnapshotRecoveryWrite('factory-snapshot');

  assert.equal(queued, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(runtime.pendingFactoryLastSnapshotRecoveryWrite(), {
    scopeId: branchScope,
    value: 'factory-snapshot',
  });

  authority = {
    mode: 'offline-edit',
    scopeId: branchScope,
    leaseId: '',
    fencingToken: 0,
  };
  const restored = await runtime.ensureWorkspaceEditAuthority(branchScope);
  await Promise.resolve();

  assert.equal(restored.mode, 'offline-edit');
  assert.deepEqual(writes, [{
    key: 'factory_last_snapshot_v1',
    value: 'factory-snapshot',
    scopeId: branchScope,
    mode: 'offline-edit',
  }]);
  assert.equal(runtime.pendingFactoryLastSnapshotRecoveryWrite(), null);
  assert.deepEqual(warnings, []);
});

function createSave04RecoveryBoundary({
  writeRecoveryValue,
  savePersistentState = () => Promise.resolve(true),
  flushQueuedPersistentState = () => Promise.resolve(false),
  saveSessionAssetsToDbIfChanged = () => Promise.resolve(true),
  saveServerLastWorkSnapshot = () => Promise.resolve(true),
  sessionAssetsReady = false,
}) {
  const core02 = fs.readFileSync(APP_CORE, 'utf8');
  const core03 = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');
  return new Function(
    'writeRecoveryValue',
    'savePersistentState',
    'flushQueuedPersistentState',
    'saveSessionAssetsToDbIfChanged',
    'saveServerLastWorkSnapshot',
    'sessionAssetsReady',
    `
      const factory = { product: { productName: 'SAVE-04 recovery pointer' } };
      const state = { factory };
      const STORAGE_KEYS = { factoryLastSnapshot: 'factory_last_snapshot_v1' };
      let factoryLastSnapshotSaveTimer = null;
      let factoryLastSnapshotSavePending = true;
      let lastWorkSaveTimer = null;
      let optionSorterLiveSaveTimer = null;
      let lastWorkSyncingVisibleInputs = false;
      const workspaceBlankResetInProgress = false;
      const sessionAssetsHydrated = sessionAssetsReady;
      const stripFactoryImages = value => value;
      const normalizeFactoryState = value => value;
      const loadFactoryLastSnapshot = () => null;
      const factoryHasMeaningfulWork = () => true;
      const workspaceSessionSetItem = (_key, value) => writeRecoveryValue(value);
      const captureWorkspaceDocumentFence = () => ({ scopeId: 'draft:save-04' });
      const workspaceDocumentFenceIsCurrent = () => true;
      const factoryRuntimeReadFactory = () => factory;
      const factoryRuntimeReadCommittedFactory = () => factory;
      const saveLastWorkBootstrap = () => true;
      const saveLastProductImageBackupToDbIfChanged = () => Promise.resolve(false);
      const markPendingSessionAssetSaveIfChanged = () => {};
      ${sourceBetween(core03, 'function saveFactoryLastSnapshot(', '\nfunction loadFactoryLastSnapshot')}
      ${sourceBetween(core02, 'function flushFactoryLastSnapshotSave(', '\nfunction scheduleLastWorkSave')}
      ${sourceBetween(core02, 'function saveLastWorkNow(', '\nfunction flushLastWorkBeforeLeave')}
      return { saveLastWorkNow };
    `,
  )(
    writeRecoveryValue,
    savePersistentState,
    flushQueuedPersistentState,
    saveSessionAssetsToDbIfChanged,
    saveServerLastWorkSnapshot,
    sessionAssetsReady,
  );
}

test('SAVE-04 복구 포인터는 draft 편집권 반납 전에 실제 write 완료를 기다린다', async () => {
  const events = [];
  const resolveWrites = [];
  const runtime = createSave04RecoveryBoundary({
    writeRecoveryValue(value) {
      events.push(`write:start:${value}`);
      return new Promise(resolve => {
        resolveWrites.push(() => {
          events.push('write:complete');
          resolve(true);
        });
      });
    },
  });

  const saving = runtime.saveLastWorkNow({ persistent: false, server: false, sync: false });
  let settled = false;
  saving.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(settled, false, 'recovery pointer write must remain inside the save boundary');
  resolveWrites.forEach(resolve => resolve());
  await saving;
  events.push('authority:release');
  assert.deepEqual(events.slice(-2), ['write:complete', 'authority:release']);
});

test('SAVE-04 세션 commit 뒤에만 복구 포인터를 쓰고 자산·서버 저장 전에 authority를 유지한다', async () => {
  const events = [];
  let resolveCommit = null;
  let authorityActive = true;
  const runtime = createSave04RecoveryBoundary({
    savePersistentState() {
      events.push('session:commit:start');
      return new Promise(resolve => {
        resolveCommit = () => {
          events.push('session:commit:complete');
          resolve(true);
        };
      });
    },
    writeRecoveryValue() {
      assert.equal(authorityActive, true, 'recovery pointer must retain the active authority');
      events.push('factory:recovery-write');
      return Promise.resolve(true);
    },
    saveSessionAssetsToDbIfChanged() {
      events.push('session-assets:save');
      return Promise.resolve(true);
    },
    saveServerLastWorkSnapshot() {
      events.push('server:save');
      return Promise.resolve(true);
    },
    sessionAssetsReady: true,
  });
  const saving = runtime.saveLastWorkNow({ server: true, sync: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['session:commit:start']);

  resolveCommit();
  await saving;
  authorityActive = false;
  events.push('authority:release');
  assert.deepEqual(events, [
    'session:commit:start',
    'session:commit:complete',
    'factory:recovery-write',
    'session-assets:save',
    'server:save',
    'authority:release',
  ]);
});

test('SAVE-04 세션 persistence가 false면 복구 포인터·자산·서버 저장을 성공처럼 진행하지 않는다', async () => {
  const events = [];
  const runtime = createSave04RecoveryBoundary({
    savePersistentState() {
      events.push('session:commit:false');
      return Promise.resolve(false);
    },
    flushQueuedPersistentState() {
      events.push('session:flush:false');
      return Promise.resolve(false);
    },
    writeRecoveryValue() {
      events.push('factory:recovery-write');
      return Promise.resolve(true);
    },
    saveSessionAssetsToDbIfChanged() {
      events.push('session-assets:save');
      return Promise.resolve(true);
    },
    saveServerLastWorkSnapshot() {
      events.push('server:save');
      return Promise.resolve(true);
    },
    sessionAssetsReady: true,
  });

  const results = await runtime.saveLastWorkNow({ server: true, sync: false });
  assert.deepEqual(events, ['session:commit:false', 'session:flush:false']);
  assert.ok(results.every(result => result.status === 'fulfilled' && result.value === false));
});

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
