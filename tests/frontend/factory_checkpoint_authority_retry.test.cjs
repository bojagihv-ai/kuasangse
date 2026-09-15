'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const JOB_ID = 'factory-job-095bdf5a4d9847ea8c9945f0db22e726';
const SCOPE = `project:batch:${JOB_ID}`;

test('체크포인트 판은 복귀한 draft 잠금이 아니라 저장 문서의 판을 읽는다', () => {
  const helper = sourceSlice(source('src/app-core-03.js'),
    'function factoryRuntimeAuthoritativeWorkspaceRevision(', 'async function factoryRuntimeSha256Text(');
  const draft = 'draft:lastwork_worker';
  const context = vm.createContext({
    getCurrentLastWorkWorkspaceScope: () => draft,
    getCurrentDocumentWorkspaceScope: () => SCOPE,
    currentWorkspaceRevision: scopeId => ({ scopeId, counter: scopeId === SCOPE ? 118 : 133 }),
    window: { __KUASANGSE_WORKSPACE_LOCK__: { snapshot: () => ({ mode: 'editing', scopeId: draft, revision: 133 }) } },
  });
  vm.runInContext(helper, context);
  const revision = context.factoryRuntimeAuthoritativeWorkspaceRevision();
  assert.equal(revision.scopeId, SCOPE);
  assert.equal(revision.counter, 118);
});

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

test('최종 상세 본문 보관 영수증을 작업파일과 체크포인트보다 먼저 저장한다', async () => {
  const { context } = buildSave([{ mode: 'editing', scopeId: SCOPE }]);
  const asset = { id: 'detail-full', type: 'html', stageId: 'detail', html: '<p>14개 섹션</p>' };
  const factory = { assets: [asset] };
  let stored;
  context.factoryRuntimeReadFactory = () => factory;
  context.archiveDetailVariantHtml = async target => {
    await new Promise(setImmediate);
    target.documentArchiveId = 'be1bc585c9299c19';
    return true;
  };
  context.saveCurrentProject = async () => { stored = structuredClone(factory); return true; };
  await context.saveCheckpoint({ jobId: JOB_ID }, 'waiting_manual', 'final_detail');
  assert.equal(stored.assets[0].documentArchiveId, 'be1bc585c9299c19',
    '다시 열었을 때 본문 연결이 사라지지 않도록 보관 완료 후 작업파일을 저장해야 합니다');
  context.archiveDetailVariantHtml = async () => false;
  delete asset.documentArchiveId;
  await assert.rejects(() => context.saveCheckpoint({ jobId: JOB_ID }),
    { code: 'factory_product_detail_archive_failed' });
});

test('상세 보관은 체크포인트 문서의 편집권을 다른 초안으로 바꾸지 않는다', async () => {
  const { fetchArchiveWithAuthority } = await import('../../src/modules/persistence/archive-adapter.mjs');
  const html = '<main>선택된 14개 섹션</main>';
  const asset = { id: 'chosen-final', html };
  const factory = { currentProjectId: `batch:${JOB_ID}`, product: { productName: '파우치', productKey: 'pouch' } };
  let current = { scopeId: SCOPE, mode: 'editing', revision: 155 };
  let expectedArchiveScope = SCOPE;
  const authority = { snapshot: () => current, runMutation: operation => operation() };
  const context = vm.createContext({
    state: {}, factoryRuntimeBackendBaseUrl: () => 'http://archive',
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentWorkspaceId: () => factory.currentProjectId,
    getCurrentDocumentWorkspaceScope: id => `project:${id}`,
    getCurrentLastWorkWorkspaceScope: () => 'draft:worker',
    currentWorkspaceAuthority: () => current,
    ensureWorkspaceEditAuthority: async (scopeId = 'draft:worker') => {
      current = { ...current, scopeId, mode: scopeId.startsWith('draft:') ? 'offline-edit' : 'editing' };
      return current;
    },
    workspaceArchiveFetch: (url, options) => fetchArchiveWithAuthority({
      authority, url, options,
      createAuthorityError: (code, message) => Object.assign(new Error(message), { code }),
      adapter: { fetchResponse: async (_url, init) => {
        const payload = JSON.parse(init.body);
        assert.equal(payload.authorityWorkspaceId, expectedArchiveScope, '보관은 호출한 작업의 편집권을 유지해야 한다');
        return { ok: true, json: async () => ({ archive: { archiveId: 'final-archive' } }) };
      } },
    }),
  });
  vm.runInContext('"use strict";\n' + sourceSlice(source('src/app-core-03.js'),
    'async function archiveDetailVariantHtml(', 'function rememberSectionVariant('), context);
  assert.equal(await context.archiveDetailVariantHtml(asset, html), true);
  assert.equal(asset.documentArchiveId, 'final-archive');
  assert.equal(current.scopeId, SCOPE);
  const frozen = Object.freeze({ id: 'frozen-final', html });
  const stored = { assets: [{ ...frozen }] };
  context.factoryRuntimeUpdateOwnedFactory = async (_command, _owner, mutate) => mutate(stored);
  assert.equal(await context.archiveDetailVariantHtml(frozen, html), true);
  assert.equal(stored.assets[0].documentArchiveId, 'final-archive');
  assert.equal(frozen.documentArchiveId, undefined, '읽기 전용 스냅샷을 직접 수정하지 않는다');
  current = { scopeId: 'draft:worker', mode: 'offline-edit', revision: 3 };
  expectedArchiveScope = 'draft:worker';
  const imported = { id: 'imported-preview', html };
  assert.equal(await context.archiveDetailVariantHtml(imported, html), true);
  assert.equal(imported.documentArchiveId, 'final-archive');
  assert.equal(current.scopeId, 'draft:worker', '불러온 문서의 자동 보관은 독립 초안 편집권을 바꾸지 않는다');
});

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
