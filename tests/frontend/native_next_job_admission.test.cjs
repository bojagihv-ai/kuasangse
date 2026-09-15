const test = require('node:test');
const assert = require('node:assert/strict');
const { manualResumeFixture } = require('./native_manual_resume_fixture.cjs');
const { deferred, driver } = require('./native_factory_command_fixture.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function nextWorker(m, options = {}) {
  const native = await import('../../src/modules/native-factory-command-routing.mjs');
  const { createBatchControlWorker } = await import('../../src/modules/batch-control-worker.mjs');
  const lifecycle = [], calls = [], timers = new Map(), entered = deferred();
  const order = { orderId: 'fixture-next-b', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'fixture-batch', productId: 'sinhwa:731', productKey: '시험B', currentRunId: 'b', stageId: 'factory-product',
    operationToken: 'fixture-b', idempotencyKey: 'fixture-b:1', expectedWorkfileRevision: 0,
    command: { kind: 'factory-control', version: 'factory-control-command:v1', name: 'runFactoryProduct', payload: {
      schema: 'factory-product-run-command:v1', jobId: 'b', batchId: 'fixture-batch', mode: 'auto', productName: '시험B',
      source: { kind: 'sinhwa-db', selectionId: '731' }, jcode: 731, requiredValues: {}, inputImages: [],
      startFresh: true, expectedStageKey: '', idempotencyKey: 'fixture-b',
    } } };
  if (options.invalid) order.contractVersion = 'invalid';
  const worker = createBatchControlWorker({ apiBase: 'http://fixture.invalid', workerId: 'fixture-worker', runtimeBuildId: 'fixture', workerSessionId: 'fixture-session',
    commandBridge: {
      ...(options.native === false ? {} : { waitForAdmission: async value => {
        entered.resolve();
        await native.waitForNativeFactoryWorkerAdmission(value);
      } }),
      run: async (_kind, _name, payload) => {
        if (options.native !== false) await native.assertNativeFactoryJobOpen(payload.jobId);
        calls.push('run-b');
        if (options.executionFailure) throw new Error('real-execution-failure');
        return { fixtureOnly: true, productName: payload.productName };
      },
    },
    setIntervalImpl: (handler, ms) => { timers.set(ms, handler); return ms; }, clearIntervalImpl: ms => timers.delete(ms),
    fetchImpl: async (url, init = {}) => {
      const endpoint = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
      lifecycle.push({ endpoint, error: body?.error || null, sequence: body?.eventSequence });
      const result = endpoint === '/api/session' ? { sessionId: 'fixture-http', csrfToken: 'fixture-csrf' }
        : endpoint === '/api/worker/claim' ? { order } : { accepted: true };
      return { ok: true, status: 200, json: async () => result };
    },
  });
  return { worker, lifecycle, calls, timers, entered };
}

test('native worker without an installed console connection retains its rejection', async () => {
  const b = await nextWorker(null);
  await assert.rejects(b.worker.start(), /native_command_routing_unavailable/);
  assert.equal(b.calls.length, 0);
  assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith('/fail')).length, 1);
});

for (const beforeReadJobs of [false, true]) test(`ready B waits through A terminal readback (${beforeReadJobs ? 'before jobs read' : 'during projection read'}) without fail`, async () => {
  const m = await manualResumeFixture();
  await m.tabs.db.invoke('confirm-no-db-candidate');
  await m.tabs.db.invoke('confirm-no-cafe24-candidate');
  const baseline = m.h.readLocal().store.getSnapshot().factory;
  const arrived = deferred(), release = deferred();
  m.options.projectionPatch = async projection => {
    if (m.resumePosts.length === 1 && m.job.attempts === 2) { arrived.resolve(); await release.promise; }
    return projection;
  };
  if (beforeReadJobs) {
    m.options.afterResume = () => { m.options.otherJobs = [{ jobId: 'b', status: 'running', dispatched: true }]; };
  }
  const resumeFlight = m.ui.document.getElementById('nativeBatchResume').click();
  const observed = await Promise.race([arrived.promise.then(() => 'readback'), resumeFlight.then(() => 'ended')]);
  const b = await nextWorker(m);
  m.options.otherJobs = [{ jobId: 'b', status: 'running', dispatched: true }];
  const stopHeartbeat = b.worker.startHeartbeat(15000);
  let workerError = null;
  const workerFlight = b.worker.start().catch(error => { workerError = error.message; });
  await tick(); await tick();
  const failedBeforeRelease = b.lifecycle.some(item => item.endpoint.endsWith('/fail'));
  const callsBeforeRelease = b.calls.length;
  await b.worker.heartbeat();
  // Unlike the original characterization's finally, gate release does not wait for B to finish.
  release.resolve();
  await resumeFlight; await workerFlight; stopHeartbeat();
  console.log(JSON.stringify({ beforeReadJobs, observed, workerError, lifecycle: b.lifecycle, aHold: m.h.routing.pending }));
  assert.equal(observed, 'readback');
  assert.equal(failedBeforeRelease, false);
  assert.equal(callsBeforeRelease, 0);
  assert.equal(workerError, null);
  for (const suffix of ['/ack', '/heartbeat', '/complete']) assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith(suffix)).length, 1, suffix);
  assert.equal(b.lifecycle.some(item => item.endpoint.endsWith('/fail')), false);
  assert.deepEqual(b.calls, ['run-b']);
  assert.equal(m.resumePosts.length, 1);
  assert.equal(m.h.routing.pending, false);
  const after = m.h.readLocal().store.getSnapshot().factory;
  for (const field of ['assets', 'stages', 'fields']) assert.deepEqual(after[field], baseline[field]);
});

test('nonnative commands and genuine malformed or execution failures retain original lifecycle', async () => {
  for (const options of [{ native: false }, { native: false, invalid: true }, { native: false, executionFailure: true }]) {
    const b = await nextWorker(null, options);
    if (options.invalid || options.executionFailure) {
      await assert.rejects(b.worker.start(), /contract_version_unsupported|real-execution-failure/);
      assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith('/fail')).length, 1);
      assert.equal(b.calls.length, options.invalid ? 0 : 1);
    } else {
      await b.worker.start();
      assert.deepEqual(b.calls, ['run-b']);
    }
  }
});

for (const failure of ['lostResume', 'unknownResume', 'stale', 'missingSaved']) test(`ACKed B waits for verified A reconciliation after ${failure}; polling cannot duplicate it`, async () => {
  const m = await manualResumeFixture({ [failure]: true });
  if (failure === 'missingSaved') {
    m.h.options.missingSaved = false;
    m.options.afterResume = () => { m.h.options.missingSaved = true; };
  }
  if (failure === 'stale') m.options.afterResume = () => {
    m.options.projectionPatch = p => ({ ...p, session: { ...p.session, inputFingerprint: 'stale' } });
  };
  await m.ui.document.getElementById('nativeBatchResume').click();
  assert.equal(m.resumePosts.length, 1);
  assert.equal(m.h.routing.resuming, true);
  const b = await nextWorker(m);
  const stop = b.worker.startPolling(1000);
  await b.entered.promise; await tick();
  const repeatedPolls = [b.timers.get(1000)(), b.timers.get(1000)()];
  await b.worker.heartbeat(); await b.worker.heartbeat();
  assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith('/claim')).length, 1);
  assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith('/ack')).length, 1);
  assert.equal(b.calls.length, 0);
  assert.equal(b.lifecycle.some(item => item.endpoint.endsWith('/fail')), false);
  assert.equal(m.ui.app.inert, true);
  assert.match(m.ui.status.textContent, /주문 접수 후.*저장 결과 확인/);
  assert.throws(() => m.tabs.fields.invoke('commitField', { fieldId: 'material', value: 'wrong' }), /pending/);
  assert.throws(() => m.h.routing.resume(), /pending/);
  if (failure === 'stale' || failure === 'missingSaved') {
    await assert.rejects(m.h.routing.reconcile(), /native_resume_stale_scope|native_resume_checkpoint_unverified/);
    assert.equal(b.calls.length, 0);
  }
  delete m.options.projectionPatch;
  m.h.options.missingSaved = false;
  m.options.otherJobs = [{ jobId: 'b', status: 'running', dispatched: true }];
  await m.h.routing.reconcile();
  await Promise.all(repeatedPolls); stop();
  assert.deepEqual(b.calls, ['run-b']);
  assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith('/complete')).length, 1);
  assert.equal(b.lifecycle.some(item => item.endpoint.endsWith('/fail')), false);
  assert.equal(m.resumePosts.length, 1, 'reconciliation reads the accepted order; it never reposts A');
  assert.equal(m.h.routing.pending, false);
  console.log(JSON.stringify({ failure, lifecycle: b.lifecycle, calls: b.calls, resumePosts: m.resumePosts.length }));
});

test('non-resume dirty or pending native state keeps existing rejection and real failure behavior', async () => {
  for (const kind of ['dirty', 'pending', 'invalid', 'executionFailure']) {
    const m = await manualResumeFixture();
    if (kind === 'dirty') m.h.routing.markDirty();
    if (kind === 'pending') {
      m.h.options.lostPost = true;
      await assert.rejects(m.tabs.fields.invoke('commitField', { fieldId: 'material', value: 'keep' }), /response-lost/);
      m.h.options.lostPost = false;
      m.h.options.getError = true;
    }
    const b = await nextWorker(m, { invalid: kind === 'invalid', executionFailure: kind === 'executionFailure' });
    await assert.rejects(b.worker.start(), /dirty_or_pending|receipt-unavailable|contract_version_unsupported|real-execution-failure/);
    assert.equal(b.calls.length, kind === 'executionFailure' ? 1 : 0);
    assert.equal(b.lifecycle.filter(item => item.endpoint.endsWith('/fail')).length, 1);
  }
});

test('native continuation race is wired into the existing automatic regression manifest', () => {
  const { buildRegressionSteps } = require('../../tools/regression_manifest.cjs');
  const steps = buildRegressionSteps().filter(step => step.id === 'NATIVE-QUEUE-01');
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].args, ['tests/frontend/native_next_job_admission.test.cjs']);
});

test('same-job reopen restores a missing runtime checkpoint before save and preserves an already open checkpoint', async () => {
  const { driver, fn } = require('./native_factory_command_fixture.cjs');
  const { mountConsole } = require('./native_console_dom_fixture.cjs');
  const { assertNativeFactoryJobOpen } = await import('../../src/modules/native-factory-command-routing.mjs');
  for (const freshTab of [true, false]) {
    const h = await driver();
    const checkpoint = { ...h.context.factoryRuntimeControlCheckpointFromProjection.latest };
    require('node:vm').runInContext(fn('factoryRuntimeControlCheckpointFromProjection'), h.context);
    if (!freshTab) h.context.factoryRuntimeControlCheckpointFromProjection.latest = checkpoint;
    const before = h.readLocal().store.getSnapshot().factory;
    const requests = [];
    const originalApi = h.io.apiRequest;
    h.io.readProjection = async () => ({ ...h.projection(), inputs: [{ key: 'operator_controls', items: [{
      schema: 'factory-operator-controls:v1', workflow: h.context.factoryRuntimeControlTabWorkflow(),
    }] }] });
    h.io.apiRequest = async (url, init = {}) => {
      if (url === '/api/factory/jobs') return { jobs: [{ jobId: 'a', productName: '상품', status: 'waiting_manual',
        checkpointAvailable: true, checkpointRevision: checkpoint.revision, checkpointRunId: checkpoint.runId }] };
      if (url === '/api/factory/jobs/a/resume') {
        const payload = JSON.parse(init.body);
        requests.push(payload);
        assert.deepEqual(payload, { restoreOnly: true,
          expectedCheckpointRevision: checkpoint.revision, expectedCheckpointRunId: checkpoint.runId });
        await assertNativeFactoryJobOpen('a');
        await h.context.factoryRuntimeControlRestoreProductCheckpoint({ jobId: 'a', checkpoint, restoreOnly: true });
        return { accepted: true };
      }
      return originalApi(url, init);
    };
    const ui = await mountConsole(h);
    assert.equal(h.context.factoryRuntimeControlTabWorkflow().status, freshTab ? '' : 'waiting_manual');
    const open = ui.document.getElementById('nativeBatchQueue').querySelector('[data-native-open-job]');
    assert.equal(open.disabled, false);
    await open.click();
    for (let count = 0; count < 50 && !/저장본을 열었습니다/.test(ui.status.textContent); count += 1) await tick();
    assert.match(ui.status.textContent, /저장본을 열었습니다/);
    assert.equal(requests.length, freshTab ? 1 : 0, 'matching product identity alone is not a restored workflow');
    assert.equal(h.context.factoryRuntimeControlTabWorkflow().status, 'waiting_manual');
    await h.routing.save();
    assert.equal(h.calls.filter(value => value === 'checkpoint').length, 1);
    assert.equal(h.routing.pending, false);
    assert.equal(h.routing.dirty, false);
    const after = h.readLocal().store.getSnapshot().factory;
    for (const field of ['product', 'assets', 'stages', 'fields', 'logs']) assert.deepEqual(after[field], before[field]);
  }
});

test('a different inactive peer keeps its auto-resume intent without blocking current work; live and current fences remain', async () => {
  for (const scenario of [
    { status: 'waiting_manual', allowed: true },
    { status: 'blocked', allowed: true },
    { status: 'completed', allowed: true },
    { status: 'queued', allowed: false },
    { status: 'running', allowed: false },
    { status: 'unknown', allowed: false },
    { status: 'waiting_manual', dispatched: true, allowed: false },
    { status: 'waiting_manual', pendingSelection: { candidateId: 'reserved' }, allowed: false },
    { status: 'waiting_manual', current: true, allowed: false },
  ]) {
    const peer = { jobId: 'old-peer', status: scenario.status, autoResumePending: true,
      dispatched: !!scenario.dispatched, pendingSelection: scenario.pendingSelection || null };
    const before = structuredClone(peer);
    const m = await manualResumeFixture({ otherJobs: scenario.current ? [] : [peer] });
    if (scenario.current) m.job.autoResumePending = true;
    if (scenario.allowed) await m.ui.document.getElementById('nativeBatchResume').click();
    else await assert.rejects(m.h.routing.resume(), /native_resume_worker_busy/);
    assert.equal(m.resumePosts.length, scenario.allowed ? 1 : 0, JSON.stringify(scenario));
    assert.deepEqual(peer, before, 'the other work and its deferred intent must not be cleared or retried');
    if (scenario.allowed) {
      assert.ok(m.calls.indexOf('checkpoint') < m.calls.indexOf('resume'));
      assert.equal(m.h.routing.pending, false);
    } else assert.match(m.ui.status.textContent, /native_resume_worker_busy/);
  }
});

test('same-content autosave ahead of the acknowledged checkpoint resumes that checkpoint; changed content stays fenced', async () => {
  const { createNativeFactoryResume } = await import('../../src/modules/native-factory-resume.mjs');
  const { buildFactoryResumePayload } = await import('../../control_tower/frontend/src/production-workbench.mjs');
  for (const drift of ['metadata', 'store', 'inputs', 'stages', 'checkpoint']) {
    const m = await manualResumeFixture();
    const before = m.h.readLocal().store.getSnapshot().factory;
    let acknowledgedRevision;
    const control = createNativeFactoryResume({ ...m.h.io, buildResumePayload: buildFactoryResumePayload,
      blocked: () => m.h.routing.pending, dirty: () => m.h.routing.dirty, publish() {},
      saveCheckpoint: async () => {
        const result = await m.h.routing.save();
        acknowledgedRevision = result.value.checkpoint.revision;
        m.options.jobPatch = { checkpointRevision: acknowledgedRevision };
        if (drift === 'store') m.h.change({ product: { ...before.product,
          finalDb: { ...before.product.finalDb, material: '새 로컬값' } } });
        await m.h.context.saveCurrentProject({ assertCurrent() {} });
        if (drift === 'checkpoint') m.options.jobPatch.checkpointRevision += 1;
        if (drift === 'inputs' || drift === 'stages') m.options.projectionPatch = projection => ({
          ...projection, [drift]: [...projection[drift], { key: 'changed-after-receipt' }],
        });
        return result;
      },
    });
    m.options.afterResume = () => { delete m.options.jobPatch; };
    if (drift === 'metadata') {
      await control.resume();
      assert.equal(m.resumePosts.length, 1);
      assert.equal(m.resumePosts[0].expectedCheckpointRevision, acknowledgedRevision);
      assert.ok(m.h.server.savedRevision > acknowledgedRevision);
      assert.equal(control.pending, false);
    } else {
      await assert.rejects(control.resume(), /native_resume_checkpoint_unverified/);
      assert.equal(m.resumePosts.length, 0, drift);
    }
    const after = m.h.readLocal().store.getSnapshot().factory;
    for (const key of ['assets', 'stages', 'fields']) assert.deepEqual(after[key], before[key]);
    assert.equal(after.product.finalDb.material, drift === 'store' ? '새 로컬값' : before.product.finalDb.material);
  }
});

test('verified metadata autosave during resume proof preserves success while changed content and unproven revisions stay fenced', async t => {
  t.mock.method(console, 'warn', () => {});
  const { createNativeFactoryResume } = await import('../../src/modules/native-factory-resume.mjs');
  const { buildFactoryResumePayload } = await import('../../control_tower/frontend/src/production-workbench.mjs');
  for (const proofStage of [1, 2]) {
    for (const drift of ['metadata', 'store', 'identity', 'rollback', 'missing-proof']) {
      const m = await manualResumeFixture();
      const before = m.h.readLocal().store.getSnapshot().factory;
      let proofs = 0;
      const control = createNativeFactoryResume({ ...m.h.io, buildResumePayload: buildFactoryResumePayload,
        blocked: () => m.h.routing.pending, dirty: () => m.h.routing.dirty, publish() {},
        saveCheckpoint: async () => {
          const result = await m.h.routing.save();
          m.options.jobPatch = { checkpointRevision: result.value.checkpoint.revision };
          return result;
        },
        verifySavedCheckpoint: async checkpoint => {
          if (++proofs === proofStage) {
            if (drift === 'missing-proof') return false;
            if (drift === 'metadata') await m.h.context.saveCurrentProject({ assertCurrent() {} });
            if (drift === 'store') m.h.change({ product: { ...before.product,
              finalDb: { ...before.product.finalDb, material: '새 로컬값' } } });
            if (drift === 'identity') m.h.change({ product: { ...before.product, currentRunId: 'foreign' } });
            if (drift === 'rollback') m.h.context.factoryRuntimeAuthoritativeWorkspaceRevision = () => ({ scopeId: 'project:batch:a', counter: 0 });
          }
          return m.h.io.verifySavedCheckpoint(checkpoint);
        },
      });
      m.options.afterResume = () => { delete m.options.jobPatch; };
      if (drift === 'metadata') {
        await control.resume();
        assert.equal(m.resumePosts.length, 1, `proof ${proofStage}`);
        assert.equal(control.pending, false);
      } else {
        await assert.rejects(control.resume(), /native_resume_stale_scope|native_resume_checkpoint_unverified/, `${drift}/${proofStage}`);
        assert.equal(m.resumePosts.length, proofStage === 1 ? 0 : 1, `${drift}/${proofStage}`);
        assert.equal(control.pending, proofStage === 2);
      }
      const after = m.h.readLocal().store.getSnapshot().factory;
      for (const key of ['assets', 'stages', 'fields']) assert.deepEqual(after[key], before[key]);
    }
  }
});

test('native saved checkpoint proof uses the persisted server revision, not the pre-commit project copy', async () => {
  const { fn } = require('./native_factory_command_fixture.cjs');
  const vm = require('node:vm');
  const { createServerLastWorkAdapter } = await import('../../src/modules/persistence/server-last-work-adapter.mjs');
  const { normalizeProjectScope } = await import('../../src/modules/persistence/contracts.mjs');
  const m = await manualResumeFixture();
  const core = m.h.context;
  const snapshot = structuredClone(m.h.server.savedSnapshot);
  snapshot.workspaceRevision = { scopeId: 'project:batch:a', counter: 7 };
  const checkpoint = { ...core.factoryRuntimeControlCheckpointFromProjection.latest, revision: 10 };
  let response = { hasSnapshot: true, workspaceId: 'project:batch:a', revision: 10, snapshot };
  const adapter = createServerLastWorkAdapter({ bases: () => ['http://saved.invalid'],
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).searchParams.get('workspaceId'), 'project:batch:a');
      assert.equal(init.method, 'GET');
      assert.equal(init.cache, 'no-store');
      return { ok: true, json: async () => response };
    },
  });
  core.WORKSPACE_DB = { projects: 'projects' };
  core.workspaceGet = async () => ({ payload: snapshot });
  core.workspacePersistenceApi = () => ({ normalizeProjectScope, restore: async request => {
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { scopeId: 'project:batch:a', sources: ['server'] });
    const record = await adapter.read(request.scopeId);
    return record && { source: 'server', snapshot: record.snapshot, revision: record.metadata.revision };
  } });
  for (const name of ['factoryRuntimeControlProjectionMatchesCheckpoint', 'factoryRuntimeControlServerSnapshotMatchesCheckpoint']) vm.runInContext(fn(name), core);
  const source = require('node:fs').readFileSync('src/app-core-03.js', 'utf8');
  const start = source.indexOf('verifySavedCheckpoint: async checkpoint => {');
  const end = source.indexOf('\n    readSavedLocalProof:', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end).replace('verifySavedCheckpoint:', 'this.verify =').replace(/,\s*$/, ';'), core);
  assert.equal(await core.verify(checkpoint), true, 'server committed 10; the project copy still carries pre-commit 7');
  response.revision = 9;
  assert.equal(await core.verify(checkpoint), false, 'a genuinely older server document is not proof');
  response.revision = 11;
  for (const [field, value] of [['productName', 'foreign'], ['currentRunId', 'foreign'], ['inputImageFingerprint', 'foreign']]) {
    response.snapshot = structuredClone(snapshot);
    response.snapshot.factory.product[field] = value;
    assert.equal(await core.verify(checkpoint), false, field);
  }
  response = { hasSnapshot: false, snapshot: null };
  assert.equal(await core.verify(checkpoint), false);
  assert.equal(snapshot.workspaceRevision.counter, 7, 'reading proof must not rewrite the local project');
});

test('same-job prepare restores supplied option mode only while pending and preserves explicit choices', async () => {
  const { fn } = require('./native_factory_command_fixture.cjs');
  for (const [current, supplied, expected] of [
    ['pending', 'provided', 'provided'], ['pending', 'none', 'none'],
    ['provided', 'none', 'provided'], ['none', 'provided', 'none'], ['pending', 'invalid', 'pending'],
  ]) {
    const m = await manualResumeFixture();
    m.h.change({ automation: { optionMode: current } });
    const before = m.h.readLocal().store.getSnapshot().factory;
    Object.assign(m.h.context, {
      factoryRuntimeControlExecutionMode: () => 'auto', factoryRuntimeControlProductImage: image => image,
      factoryRuntimeControlRestoreInputPayloads() {}, factoryRuntimeControlApplyProvidedColorOptions() {},
    });
    require('node:vm').runInContext(fn('factoryRuntimeControlPrepareProduct'), m.h.context);
    await m.h.context.factoryRuntimeControlPrepareProduct({ jobId: 'a', productName: '상품',
      source: { kind: 'workfile' }, startFresh: false, requiredValues: { optionMode: supplied }, inputImages: [] });
    const after = m.h.readLocal().store.getSnapshot().factory;
    assert.equal(after.automation.optionMode, expected, `${current} + ${supplied}`);
    for (const key of ['fields', 'assets', 'stages']) assert.deepEqual(after[key], before[key]);
    assert.equal(after.product.productName, before.product.productName);
    assert.equal(after.product.currentRunId, before.product.currentRunId);
  }
});

test('stable competitor capture clicks use the existing tab contract and never fall through a pending fence', async () => {
  const source = require('node:fs').readFileSync('src/app-core-06.js', 'utf8');
  const start = source.indexOf("const factoryPageRoot = document.querySelector('.factory-page')");
  const end = source.indexOf('const factoryWorkspaceProjectName', start);
  assert.ok(start > 0 && end > start);
  for (const mode of ['native', 'pending', 'legacy']) {
    const payload = { type: 'toggle-candidate', candidateId: 'keep-current-candidate' };
    const routed = [], direct = [], errors = [];
    let handler, prevented = 0;
    const root = { contains: () => true };
    const context = { document: { documentElement: { dataset: {} }, querySelector: () => root,
      getElementById: () => null, addEventListener: (name, callback, capture) => {
        assert.equal(name, 'click'); assert.equal(capture, true); handler = callback;
      } },
      factoryCompetitorDelegatedMarketPayload: () => payload,
      factoryRuntimeCompetitorTab: mode === 'legacy' ? null : { invoke: (name, value) => {
        routed.push({ name, value });
        if (mode === 'pending') throw new Error('native_command_pending');
        return Promise.resolve(true);
      } },
      factoryRuntimeCompetitorMarketAction: value => { direct.push(value); return true; },
      factoryRuntimeReportError: error => errors.push(error.message), render() {},
    };
    require('node:vm').runInNewContext(source.slice(start, end), context);
    handler({ target: { closest() {} }, defaultPrevented: false,
      preventDefault() { prevented += 1; }, stopPropagation() {}, stopImmediatePropagation() {} });
    await tick();
    assert.equal(prevented, 1);
    assert.deepEqual(routed, mode === 'legacy' ? [] : [{ name: 'marketAction', value: payload }], mode);
    assert.deepEqual(direct, mode === 'legacy' ? [payload] : [], mode);
    assert.deepEqual(errors, mode === 'pending' ? ['native_command_pending'] : []);
  }
});

test('committed competitor selections reach legacy persistence before the save is scheduled', async () => {
  const { fn } = require('./native_factory_command_fixture.cjs');
  const { createFactoryStore } = await import('../../src/modules/factory-store.mjs');
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync('src/app-core-03.js', 'utf8');
  const start = source.indexOf('function factoryRuntimeCreateCommandPolicies()');
  const end = source.indexOf('const FACTORY_RUNTIME_COMMAND_POLICIES =', start);
  const policies = new Function(source.slice(start, end) + '\nreturn factoryRuntimeCreateCommandPolicies();')();
  const initial = { marketScrape: { results: [{ id: 'candidate-a' }], selectedIds: [], detailSelectionVersion: 0 } };
  const store = createFactoryStore({ workspaceId: 'batch:a', commandPolicies: policies,
    initialSnapshot: { factory: { product: { productName: '상품' } }, competitors: { compPage: initial } } });
  const saves = [];
  const context = vm.createContext({ state: { compPage: structuredClone(initial) },
    factoryRuntimeRequireStore: () => ({ ...store, updateDraft: (mutate, metadata, name, options) =>
      store.updateDraft(mutate, structuredClone(metadata), name, structuredClone(options)) }),
    FACTORY_RUNTIME_COMMAND_POLICIES: policies,
    FACTORY_RUNTIME_READ_COMMANDS: [], FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA: 'factory-runtime-command-receipt:v1',
    factoryRuntimeOwnedRenderDraft: null, factoryRuntimeDetachedValue: structuredClone,
    factoryRuntimeRenderWithOwnedDraft: (_draft, run) => run(),
    factoryRuntimeStaleActionError: () => new Error('stale-operation'),
    scheduleLastWorkSave: () => saves.push(structuredClone(context.state.compPage)),
  });
  vm.runInContext(fn('factoryRuntimeBridgeAction'), context);
  const action = 'factory/competitor:market:toggle-candidate';
  const oldToken = store.getOperationToken();
  await context.factoryRuntimeBridgeAction(action, {}, draft => {
    draft.compPage.marketScrape.selectedIds = ['candidate-a'];
    draft.compPage.marketScrape.detailSelectionVersion = 1;
  });
  assert.deepEqual(saves[0].marketScrape.selectedIds, ['candidate-a']);
  assert.notEqual(context.state.compPage, store.getSnapshot().competitors.compPage);
  await context.factoryRuntimeBridgeAction(action, {}, draft => {
    draft.compPage.marketScrape.selectedIds = [];
    draft.compPage.marketScrape.detailSelectionVersion = 2;
  });
  assert.deepEqual(saves[1].marketScrape.selectedIds, []);
  assert.equal(saves[1].marketScrape.detailSelectionVersion, 2);
  assert.throws(() => context.factoryRuntimeBridgeAction(action, {
    operationToken: { ...oldToken, workspaceId: 'batch:foreign' },
  }, () => {}), /stale-operation/);
  assert.equal(saves.length, 2);
  assert.deepEqual(store.getSnapshot().competitors.compPage.marketScrape.results, initial.marketScrape.results);
});

test('restored competitor ownership uses the work identity, not its independent search query', () => {
  const fs = require('node:fs');
  const core = fs.readFileSync('src/app-core-02.js', 'utf8');
  const identity = fs.readFileSync('src/app-core-03.js', 'utf8');
  const name = '[생산관제 시험] 색동동전지갑 20260909';
  const cases = [
    [{ productName: '색동사각동전지갑', factoryProductKey: name, productKey: name, workProductName: name }, true],
    [{ productName: '색동사각동전지갑', productKey: name }, true],
    [{ productName: '색동사각동전지갑', workProductName: name }, true],
    [{ productName: name, factoryProductKey: '다른 상품', workProductName: name }, false],
    [{ productName: name }, true],
    [{ productName: '다른 상품' }, false],
  ];
  for (const [stamp, keep] of cases) {
    const market = { ...stamp, results: Array.from({ length: 20 }, (_, i) => ({ id: `candidate-${i}` })),
      selectedIds: ['candidate-0'], detailSelectionVersion: 1, scrapedImages: [{ id: 'detail-0' }] };
    const state = { productName: name, compPage: { marketScrape: structuredClone(market) },
      productInfoManualValues: {}, dbMatchCandidates: [], storageWarning: '' };
    const context = { state, factory: { product: { productName: name, userProductName: name } } };
    require('node:vm').runInNewContext(
      identity.slice(identity.indexOf('function factoryNormalizeIdentityText('), identity.indexOf('function factoryCurrentProductNameForIdentity('))
      + core.slice(core.indexOf('function repairRestoredSessionIdentityDrift('), core.indexOf('const LAST_DRAFT_SCOPE_PREFERENCE_ID'))
      + '\nrepairRestoredSessionIdentityDrift("asset-payload", factory);', context);
    if (keep) assert.deepEqual(state.compPage.marketScrape, market, JSON.stringify(stamp));
    else assert.equal(state.compPage.marketScrape, null, JSON.stringify(stamp));
    assert.equal(state.productName, name);
  }
});

test('candidate-only workfiles restore their stamped market before analysis exists without importing foreign analysis', () => {
  const core = require('node:fs').readFileSync('src/app-core-02.js', 'utf8');
  const slice = (start, end) => core.slice(core.indexOf(start), core.indexOf(end, core.indexOf(start)));
  const scope = { scopeKey: 'run::product::image', currentRunId: 'run', productKey: 'product', inputImageFingerprint: 'image' };
  for (const conflict of ['', 'productKey', 'currentRunId', 'inputImageFingerprint', 'analysis']) {
    const market = { ...scope, productName: 'independent query',
      results: Array.from({ length: 20 }, (_, i) => ({ id: `candidate-${i}` })),
      selectedIds: ['candidate-0', 'candidate-4'], detailSelectionVersion: 2 };
    if (conflict && conflict !== 'analysis') market[conflict] = 'foreign';
    const saved = { marketScrape: market, analysisResult: conflict === 'analysis' ? { conclusion: 'foreign' } : null };
    const keep = { conclusion: 'keep current analysis' };
    const state = { compPage: { analysisResult: keep, marketScrape: { results: [], selectedIds: [] } } };
    const context = { state, sectionWorkScopeMeta: () => ({ ...scope, scopeKey: 'previous', currentRunId: 'previous' }),
      normalizeSectionScopeKeyPart: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
      sanitizeCompMarketScrapeForPersistence: value => value };
    require('node:vm').runInNewContext(
      slice('function mergeSameWorkDerivedValue(', 'function recoverStaleSessionInlineImages(')
      + slice('function sectionWorkScopeMatches(', 'function sectionWorkScopeFromContent(')
      + slice('function applyCompAnalysisSnapshot(', 'function saveCompAnalysis(')
      + '\nthis.apply = applyCompAnalysisSnapshot;', context);
    assert.equal(context.apply(saved, 'input', { currentScope: scope }), conflict === '', conflict);
    assert.equal(state.compPage.marketScrape.results.length, conflict ? 0 : 20, conflict);
    assert.deepEqual(Array.from(state.compPage.marketScrape.selectedIds), conflict ? [] : ['candidate-0', 'candidate-4']);
    assert.equal(state.compPage.analysisResult, keep, 'candidate restore must not alter analysis');
  }
});

test('populated native reload rebinds only a missing proven workflow without reloading or replaying saved work', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const configure = h => {
    require('node:vm').runInContext(require('./native_factory_command_fixture.cjs').fn('factoryRuntimeControlCheckpointFromProjection'), h.context);
    const project = () => {
      const value = h.projection();
      value.inputs[0].items[0].workflow = h.context.factoryRuntimeControlTabWorkflow();
      value.progress = { status: 'manual', stageKey: 'detail' };
      return value;
    };
    h.io.readLocalProjection = project;
    h.context.factoryRuntimeControlProjection = project;
    const source = require('node:fs').readFileSync('src/app-core-03.js', 'utf8');
    const restore = require('node:vm').runInContext('(' + source.match(/restoreWorkflowCheckpoint: (receipt => \{[\s\S]*?\n    \}),\n    localBusy/)[1] + ')', h.context);
    h.io.restoreWorkflowCheckpoint = receipt => { const result = restore(receipt); h.calls.push('restore-workflow'); return result; };
  };
  const h = await driver({ storage, originalActions: true, lostPost: true });
  configure(h);
  h.context.factoryRuntimeControlCheckpointFromProjection.latest = { ...h.projection().session, jobId: 'a', projectId: 'batch:a', status: 'blocked', stageKey: 'competitors' };
  await assert.rejects(h.routing.save(), /response-lost/);
  await Promise.all([...h.server.orders.values()].map(order => order.promise));
  const journal = storage.getItem('native-factory-command:v1');
  for (const drift of ['missing', 'edited', 'advanced', 'foreign', 'saved', 'store-during-proof', 'progress', 'busy', 'existing-checkpoint']) {
    storage.setItem('native-factory-command:v1', journal);
    const fresh = await driver({ storage, server: h.server, originalActions: true });
    configure(fresh);
    fresh.context.factoryRuntimeControlCheckpointFromProjection.latest = drift === 'advanced'
      ? { ...fresh.projection().session, jobId: 'a', projectId: 'batch:a', status: 'completed', stageKey: 'final_detail' } : null;
    if (drift === 'edited') fresh.change({ product: { ...fresh.readLocal().store.getSnapshot().factory.product, finalDb: { material: 'new input' } } });
    if (drift === 'foreign') fresh.change({ product: { ...fresh.readLocal().store.getSnapshot().factory.product, currentRunId: 'other-run' } });
    if (drift === 'saved') fresh.options.missingSaved = true;
    if (drift === 'busy') fresh.io.localBusy = () => true;
    if (drift === 'existing-checkpoint') fresh.context.factoryRuntimeControlCheckpointFromProjection.latest = { jobId: 'other' };
    if (drift === 'progress') {
      const project = fresh.io.readLocalProjection;
      fresh.io.readLocalProjection = () => ({ ...project(), progress: { status: 'completed', stageKey: 'final_detail' } });
    }
    if (drift === 'store-during-proof') {
      const verify = fresh.io.verifySavedCheckpoint;
      fresh.io.verifySavedCheckpoint = async checkpoint => { const saved = await verify(checkpoint); fresh.change({ laterLocalEdit: true }); return saved; };
    }
    const before = fresh.readLocal().store.getSnapshot();
    if (drift === 'missing') {
      await fresh.routing.reconcile();
      assert.equal(fresh.routing.pending, false);
      assert.equal(fresh.calls.filter(value => value === 'restore-workflow').length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(fresh.context.factoryRuntimeControlTabWorkflow())), { status: 'blocked', stageKey: 'competitors' });
    } else {
      await assert.rejects(fresh.routing.reconcile(), /native_command_restore_unverified|native_command_stale_receipt/);
      assert.equal(fresh.routing.pending, true);
      assert.equal(fresh.calls.filter(value => value === 'restore-workflow').length, 0);
    }
    if (drift === 'store-during-proof') assert.equal(fresh.readLocal().store.getSnapshot().factory.laterLocalEdit, true);
    else assert.equal(fresh.readLocal().store.getSnapshot(), before, 'input/image store is never replaced');
    assert.equal(fresh.calls.filter(value => value === 'restore').length, 0);
    assert.equal(fresh.posts.length, 0);
  }
  assert.equal(h.posts.length, 1);
});

test('a metadata-only autosave after receipt preserves exact local contents and still requires saved proof', async () => {
  for (const drift of ['metadata', 'store', 'inputs', 'stages', 'saved', 'during-proof']) {
    const h = await driver({ originalActions: true });
    const revision = h.context.factoryRuntimeAuthoritativeWorkspaceRevision;
    let offset = 0;
    h.context.factoryRuntimeAuthoritativeWorkspaceRevision = () => ({ ...revision(), counter: revision().counter + offset });
    const request = h.io.apiRequest;
    h.io.apiRequest = async (...args) => {
      const result = await request(...args);
      if (result.status === 'completed' && result.receipt && !offset) {
        offset = 1;
        h.server.savedRevision += 1;
        if (drift === 'store') h.change({ laterLocalEdit: true });
        if (drift === 'saved') h.options.missingSaved = true;
      }
      return result;
    };
    h.io.readLocalProjection = async () => {
      const projection = structuredClone(h.projection());
      if (drift === 'inputs') projection.inputs[0].items[0].fields[0].value = 'later edit';
      if (drift === 'stages') projection.stages = [];
      projection.inputs = projection.inputs.map(({ items, ...rest }) => ({ items, ...rest }));
      return projection;
    };
    const verify = h.io.verifySavedCheckpoint;
    h.io.verifySavedCheckpoint = async value => {
      const result = await verify(value);
      if (drift === 'during-proof') h.change({ laterLocalEdit: true });
      return result;
    };
    if (drift === 'metadata') {
      await h.routing.save();
      assert.equal(h.routing.pending, false);
      assert.equal(h.routing.dirty, false);
    } else {
      await assert.rejects(h.routing.save(), /native_command_stale_receipt|native_command_restore_unverified/, drift);
      assert.equal(h.routing.pending, true, drift);
      assert.throws(h.invoke, /pending/, drift);
    }
    assert.equal(h.posts.length, 1, drift);
    assert.equal(h.calls.filter(value => value === 'checkpoint').length, 1, drift);
  }
});
