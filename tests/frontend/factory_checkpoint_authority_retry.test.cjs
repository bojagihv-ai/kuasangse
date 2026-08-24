'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const JOB_ID = 'factory-job-095bdf5a4d9847ea8c9945f0db22e726';
const SCOPE = `project:batch:${JOB_ID}`;

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function buildSave(authorityResponses, saveResults = []) {
  const core = source('src/app-core-03.js');
  const helpers = sourceSlice(
    core,
    'function factoryRuntimeControlCheckpointProjectId(',
    'function factoryRuntimeControlValidateProductCheckpoint(',
  );
  const save = sourceSlice(
    core,
    'async function factoryRuntimeControlSaveProductCheckpoint(',
    'async function factoryRuntimeControlRestoreProductCheckpoint(',
  );
  const calls = [];
  const authorityCalls = [];
  const saveCalls = [];
  const context = {
    state: { currentProjectId: '', error: '' },
    setTimeout: (fn) => { fn(); return 0; },
    getCurrentDocumentWorkspaceScope: (currentProjectId) => `project:${currentProjectId}`,
    ensureWorkspaceEditAuthority: async (requestedScope) => {
      authorityCalls.push(requestedScope);
      calls.push(requestedScope);
      const next = authorityResponses[Math.min(authorityCalls.length - 1, authorityResponses.length - 1)];
      return next === null ? { mode: 'readonly', scopeId: 'draft:lastwork_x' } : next;
    },
    saveCurrentProject: async () => {
      saveCalls.push('save');
      calls.push('save');
      return saveResults.length ? saveResults.shift() : true;
    },
    factoryRuntimeControlProjection: async () => ({ session: { workspaceId: `batch:${JOB_ID}` } }),
    factoryRuntimeControlCheckpointFromProjection: (_payload, projection, status, stageKey) => ({
      projectId: projection.session.workspaceId,
      status,
      stageKey,
    }),
    factoryRuntimeBatchCommandError: (code) => Object.assign(new Error(code), { code }),
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}
${save}
this.saveCheckpoint = factoryRuntimeControlSaveProductCheckpoint;`, context);
  return { context, calls, authorityCalls, saveCalls };
}

test('상세페이지 빌드 직후 잠금이 draft 로 돌아가 있어도 재시도해서 저장한다', async () => {
  // 한 번 실패했다고 막아버리면 그때까지 만든 컷과 상세페이지를 통째로 잃는다.
  const granted = { mode: 'editing', scopeId: SCOPE };
  const { context, authorityCalls } = buildSave([null, granted]);
  const result = await context.saveCheckpoint({ jobId: JOB_ID }, 'waiting_manual', 'final_detail');
  assert.equal(authorityCalls.length, 2, `재시도 없이 실패했습니다 (요청 ${authorityCalls.length}회)`);
  assert.deepEqual(authorityCalls, [SCOPE, SCOPE]);
  assert.equal(result.checkpoint.stageKey, 'final_detail');
});

test('권한이 계속 나오지 않으면 재시도 뒤 명확히 실패한다', async () => {
  const { context, authorityCalls } = buildSave([null]);
  await assert.rejects(
    () => context.saveCheckpoint({ jobId: JOB_ID }, 'waiting_manual', 'final_detail'),
    (error) => error.code === 'factory_product_workspace_authority_unavailable',
  );
  assert.ok(authorityCalls.length >= 2, `재시도하지 않았습니다 (요청 ${authorityCalls.length}회)`);
});

test('첫 시도에 권한이 나오면 추가 요청을 하지 않는다', async () => {
  const { context, authorityCalls } = buildSave([{ mode: 'editing', scopeId: SCOPE }]);
  await context.saveCheckpoint({ jobId: JOB_ID }, 'waiting_manual', 'size');
  assert.equal(authorityCalls.length, 1);
});

test('저장이 낡은 판이라며 되돌아오면 편집권을 다시 잡고 한 번 더 저장한다', async () => {
  // 여기서 포기하면 상세페이지까지 다 만들어 놓고 마지막 저장에서 작업이 막힌다.
  const granted = { mode: 'editing', scopeId: SCOPE };
  const { context, calls, saveCalls } = buildSave([granted], [false, true]);

  const result = await context.saveCheckpoint({ jobId: JOB_ID }, 'completed', 'final_detail');

  assert.equal(saveCalls.length, 2, `저장을 다시 시도하지 않았습니다: ${calls.join(', ')}`);
  assert.equal(result.checkpoint.stageKey, 'final_detail');
});

test('다시 잡고도 저장이 안 되면 명확히 실패한다', async () => {
  const granted = { mode: 'editing', scopeId: SCOPE };
  const { context } = buildSave([granted], [false, false]);
  await assert.rejects(
    () => context.saveCheckpoint({ jobId: JOB_ID }, 'completed', 'final_detail'),
    (error) => String(error.code).startsWith('factory_product_checkpoint_save_failed'),
  );
});

test('체크포인트는 저장된 판을 적는다', () => {
  // 실측: 문서는 판 35 로 저장됐는데 1.3초 뒤 기록된 체크포인트는 60 이었다. 저장되지
  // 않은 판을 적으면 그 작업은 다시 열 때마다 낡은 문서 취급을 받아 영영 막힌다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlSaveProductCheckpoint(');
  assert.notEqual(at, -1);
  const end = core.indexOf('async function factoryRuntimeControlRestoreProductCheckpoint(', at);
  const region = core.slice(at, end);
  const flushAt = region.indexOf('saveLastWorkNow(');
  const projectionAt = region.indexOf('const projection = await factoryRuntimeControlProjection()');
  assert.notEqual(flushAt, -1, '판을 읽기 전에 문서를 밀어 넣지 않습니다');
  assert.ok(flushAt < projectionAt, '문서를 밀어 넣기 전에 판을 읽습니다');
});
