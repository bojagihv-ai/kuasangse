const test = require('node:test');
const assert = require('node:assert/strict');
const { driver } = require('./native_factory_command_fixture.cjs');
const { mountConsole } = require('./native_console_dom_fixture.cjs');
const { manualResumeFixture } = require('./native_manual_resume_fixture.cjs');
const { deferred } = require('./native_factory_command_fixture.cjs');

test('visible native save-and-resume follows a successful DB checkpoint instead of leaving waiting_manual without an action', async () => {
  const h = await driver();
  const ui = await mountConsole(h);
  await h.tabs.db.invoke('apply-db-candidate', { index: 0 });
  assert.equal(h.calls.filter(value => value === 'checkpoint').length, 1);
  assert.equal((await h.io.apiRequest('/api/factory/jobs')).jobs[0].status, 'waiting_manual');
  const resume = ui.document.getElementById('nativeBatchResume');
  assert.ok(resume, 'checkpoint succeeded but the native screen has no visible same-job resume control');
  assert.equal(resume.hidden, false);
  assert.equal(resume.textContent, '저장 후 작업 재개');
});

test('DB run-db alias is rejected before local new-run mutation on a bound native job', async () => {
  const h = await driver();
  const before = h.readLocal().store.getSnapshot();
  assert.throws(() => h.routing.dispatch({ tabId: 'factory/db', commandName: 'run-db', args: [] }), /native_command_identity_change_requires_new_job/);
  assert.equal(h.routing.dirty, false);
  assert.deepEqual(h.readLocal().store.getSnapshot(), before);
});

test('visible button saves once then normal-resumes the same job DB -> required fields -> competitors with original policies and A+B', async () => {
  const m = await manualResumeFixture();
  const before = m.h.readLocal().store.getSnapshot().factory;
  await m.tabs.db.invoke('confirm-no-db-candidate');
  await m.tabs.db.invoke('confirm-no-cafe24-candidate');
  assert.equal(m.job.stageKey, 'db', 'tab-command checkpoint does not advance waiting job');
  const gate = deferred(); m.options.jobsGate = gate;
  const button = m.ui.document.getElementById('nativeBatchResume');
  const click = button.click();
  await button.click();
  assert.equal(m.ui.app.inert, true);
  gate.resolve(); await click;
  delete m.options.jobsGate;
  assert.equal(m.resumePosts.length, 1);
  assert.equal(m.job.stageKey, 'required_fields');
  assert.equal(m.job.status, 'waiting_manual');
  assert.match(m.ui.status.textContent, /소재.*직접 확인/);
  assert.equal(m.h.routing.pending, false);
  assert.equal(m.calls.filter(value => value === 'factory/db:confirmNoDbCandidate').length, 1);
  assert.equal(m.calls.filter(value => value === 'factory/db:confirmNoCafe24Candidate').length, 1);
  assert.ok(m.calls.indexOf('checkpoint') < m.calls.indexOf('resume'));
  await m.tabs.fields.invoke('commitAllFields', { fields: [{ fieldId: 'material', value: '면' }] });
  await button.click();
  assert.equal(m.resumePosts.length, 2);
  assert.equal(m.job.stageKey, 'competitors');
  assert.match(m.ui.status.textContent, /경쟁사 선택 대기.*쿠팡/);
  const after = m.h.readLocal().store.getSnapshot().factory;
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(after.stages, before.stages);
  assert.deepEqual(after.fields, before.fields);
  assert.equal(after.product.finalDb.material, '면');
  assert.ok(after.logs.length >= before.logs.length);
});

test('navigation stays local and the real DB contract rejects only its new-run alias before mutation', async () => {
  const m = await manualResumeFixture();
  await m.tabs.db.invoke('go-tab:fields');
  assert.deepEqual(m.calls, ['navigate-fields']);
  assert.throws(() => m.tabs.db.invoke('run-db'), /native_command_identity_change_requires_new_job/);
  assert.equal(m.calls.includes('new-run'), false);
  assert.equal(m.h.routing.dirty, false);
  assert.match(m.ui.status.textContent, /저장 후 작업 재개.*대량 입력/);
});

test('local async, other queued work and uncertain save receipt never bypass the visible resume fence', async () => {
  const m = await manualResumeFixture();
  const gate = deferred();
  const local = m.h.routing.dispatch({ tabId: 'factory/assets', commandName: 'local-file', args: [new File(['keep'], 'keep.png')] });
  local.observeLocalResult(gate.promise);
  await m.ui.document.getElementById('nativeBatchResume').click();
  assert.equal(m.resumePosts.length, 0);
  assert.throws(() => m.h.routing.resume(), /native_command_pending/);
  gate.resolve(); await gate.promise; await Promise.resolve();
  m.options.otherJobs = [{ jobId: 'other', status: 'queued' }];
  await m.ui.document.getElementById('nativeBatchResume').click();
  assert.equal(m.resumePosts.length, 0);
  m.options.otherJobs = [];
  m.h.options.lostPost = true;
  await m.ui.document.getElementById('nativeBatchQueueRefresh').click();
  await Promise.resolve();
  await assert.rejects(m.h.routing.resume(), /response-lost/);
  assert.equal(m.resumePosts.length, 0);
  assert.equal(m.h.routing.pending, true);
});

test('same-job identity change across fresh preflight rejects before save or resume', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  const m = await manualResumeFixture();
  const gate = deferred(); m.options.jobsGate = gate;
  const click = m.ui.document.getElementById('nativeBatchResume').click();
  await Promise.resolve();
  const product = m.h.readLocal().store.getSnapshot().factory.product;
  m.h.change({ product: { ...product, currentRunId: 'changed-during-read' } });
  gate.resolve(); await click;
  assert.equal(m.resumePosts.length, 0);
  assert.equal(m.posts.length, 0);
  assert.match(m.ui.status.textContent, /native_resume_stale_scope/);
  assert.equal(warning.mock.callCount(), 1);
  const diagnostic = JSON.parse(warning.mock.calls[0].arguments[1]);
  assert.equal(diagnostic.phase, '저장 전');
  assert.equal(diagnostic.identitySame, false);
  assert.equal(Object.hasOwn(diagnostic, 'productId'), false);
});

test('lost normal-resume response is never posted again; fresh empty native boot restores saved same-job readback', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const m = await manualResumeFixture({ storage, lostResume: true });
  await m.tabs.db.invoke('confirm-no-db-candidate');
  await m.tabs.db.invoke('confirm-no-cafe24-candidate');
  await m.ui.document.getElementById('nativeBatchResume').click();
  assert.equal(m.resumePosts.length, 1);
  assert.equal(m.h.routing.pending, true);
  await m.ui.document.getElementById('nativeBatchResume').click();
  assert.equal(m.resumePosts.length, 1);
  const fresh = await manualResumeFixture({ storage, server: m.h.server, bootEmpty: true });
  assert.equal(fresh.h.readLocal().jobId, '');
  assert.notEqual(fresh.h.readLocal().store, m.h.readLocal().store);
  assert.equal(fresh.h.routing.pending, true);
  await fresh.h.routing.reconcile();
  assert.equal(fresh.h.routing.pending, false);
  assert.equal(fresh.h.readLocal().jobId, 'a');
  assert.deepEqual(fresh.h.readLocal().store.getSnapshot().factory.assets, m.h.readLocal().store.getSnapshot().factory.assets);
  assert.equal(fresh.resumePosts.length, 0);
  assert.equal(fresh.posts.length, 0);
});

test('populated reload reconciles saved resume results without replay and rejects missing or changed local evidence', async t => {
  t.mock.method(console, 'warn', () => {});
  const { createNativeFactoryResume } = await import('../../src/modules/native-factory-resume.mjs');
  for (const drift of ['none', 'fields', 'asset', 'selection', 'identity', 'workflow', 'saved', 'during-proof']) {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const m = await manualResumeFixture({ storage, lostResume: true });
    await m.ui.document.getElementById('nativeBatchResume').click();
    assert.equal(m.resumePosts.length, 1);
    const fresh = await manualResumeFixture({ storage, server: m.server, bootEmpty: true });
    await fresh.io.restoreLocalDraft();
    const projection = structuredClone(m.server.manualProjection);
    projection.inputs[0].items[0].workflow = { status: m.job.status, stageKey: m.job.stageKey };
    const before = fresh.readLocal().store.getSnapshot();
    const factory = before.factory;
    if (drift === 'fields') fresh.change({ product: { ...factory.product, finalDb: { material: 'edited' } } });
    if (drift === 'asset') fresh.change({ assets: factory.assets.slice(1) });
    if (drift === 'selection') fresh.change({ stages: { hero: { selectedAssetIds: [] } } });
    if (drift === 'identity') fresh.change({ product: { ...factory.product, currentRunId: 'other' } });
    const control = createNativeFactoryResume({ ...fresh.io, publish() {}, blocked: () => false, dirty: () => false,
      readProjection: async () => projection,
      readLocalProjection: async () => {
        const local = fresh.projection();
        local.inputs[0].items[0].workflow = drift === 'workflow'
          ? { status: 'running', stageKey: 'other' } : { status: '', stageKey: '' };
        return local;
      },
      readSavedLocalProof: async () => {
        if (drift === 'during-proof') fresh.change({ laterLocalEdit: true });
        return drift !== 'saved';
      },
    });
    if (drift === 'none') {
      await control.reconcile();
      assert.equal(control.pending, false);
      assert.deepEqual(fresh.readLocal().store.getSnapshot(), before);
    } else {
      await assert.rejects(control.reconcile(), /native_resume_local_readback_required|native_resume_stale_scope/, drift);
      assert.equal(control.pending, true, drift);
    }
    assert.equal(fresh.resumePosts.length, 0, drift);
    assert.equal(fresh.posts.length, 0, drift);
    assert.equal(fresh.calls.filter(value => value === 'restore-local').length, 1, 'reconcile must not replace populated local data');
  }
});

test('fresh fingerprint/checkpoint mismatch and foreign queued or running jobs cannot normal-resume', async () => {
  for (const state of ['fingerprint', 'revision', 'queued', 'running']) {
    const m = await manualResumeFixture();
    if (state === 'fingerprint') m.options.projectionPatch = p => ({ ...p, session: { ...p.session, inputFingerprint: 'foreign-image' } });
    else if (state === 'revision') m.options.jobPatch = { checkpointRevision: 0 };
    else m.options.otherJobs = [{ jobId: 'other', status: state }];
    await m.ui.document.getElementById('nativeBatchResume').click();
    assert.equal(m.resumePosts.length, 0, state);
    assert.match(m.ui.status.textContent, /확인 필요/);
  }
});

test('unknown normal-resume acceptance keeps human actions and foreign worker jobs fenced until readback', async () => {
  const m = await manualResumeFixture({ unknownResume: true });
  await m.ui.document.getElementById('nativeBatchResume').click();
  assert.equal(m.resumePosts.length, 1);
  assert.equal(m.h.routing.pending, true);
  assert.throws(() => m.tabs.fields.invoke('commitField', { fieldId: 'material', value: 'wrong' }), /pending/);
  const { assertNativeFactoryJobOpen } = await import('../../src/modules/native-factory-command-routing.mjs');
  assert.equal(m.h.routing.allowsWorkerResume('other'), false);
  await assert.rejects(assertNativeFactoryJobOpen('other'), /native_command_dirty_or_pending/);
  assert.equal(m.h.routing.pending, true);
  await assertNativeFactoryJobOpen('a');
  assert.equal(m.resumePosts.length, 1);
  await m.h.routing.reconcile();
  assert.equal(m.h.routing.pending, false);
  assert.equal(m.resumePosts.length, 1);
});

test('outer native resume remains in normal scroll flow with wrapping controls and a reachable queue instruction', async () => {
  const m = await manualResumeFixture();
  const styles = m.ui.document.head.children.find(node => node.tagName === 'style').textContent;
  assert.match(styles, /overflow-y:auto/);
  assert.match(styles, /\.native-batch-command[^}]*flex-wrap:wrap/);
  assert.match(styles, /#nativeBatchResume[^}]*white-space:normal/);
  assert.doesNotMatch(styles, /position:fixed|overflow-y:hidden/);
  const row = m.ui.document.getElementById('nativeBatchQueue').querySelector('article');
  assert.match(row.querySelector('p').textContent, /저장 후 작업 재개.*누락값/);
  assert.equal(m.ui.document.getElementById('nativeBatchResume').hidden, false);
});
