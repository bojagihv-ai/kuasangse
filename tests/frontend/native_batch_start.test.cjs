const test = require('node:test');
const assert = require('node:assert/strict');
const { driver } = require('./native_factory_command_fixture.cjs');
const { mountConsole } = require('./native_console_dom_fixture.cjs');

async function setup(state = { schema: 'factory-control-projection:v1', connected: false }, helloError = null) {
  const { createNativeBatchStart } = await import('../../src/modules/native-batch-console.mjs');
  const calls = [];
  const worker = Object.fromEntries(['startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling']
    .map(name => [name, () => calls.push(name)]));
  worker.hello = async () => { calls.push('hello'); if (helloError) throw helloError; return { accepted: true }; };
  const start = createNativeBatchStart({
    readState: async () => { calls.push('read'); return state; },
    installWorker: () => { calls.push('install'); return { worker }; },
  });
  return { calls, start };
}

test('explicit recovery takeover may replace a stale worker only when requested', async () => {
  const { createNativeBatchStart } = await import('../../src/modules/native-batch-console.mjs');
  const calls = [];
  const worker = Object.fromEntries(['startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling']
    .map(name => [name, () => calls.push(name)]));
  worker.hello = async () => { calls.push('hello'); return { accepted: true }; };
  const start = createNativeBatchStart({
    allowExistingSession: true,
    readState: async () => { calls.push('read'); return { schema: 'factory-control-projection:v1', connected: true }; },
    installWorker: options => { calls.push(['install', options]); return { worker }; },
  });
  await start();
  assert.deepEqual(calls, [
    'read', ['install', { replaceExistingSession: true }], 'hello',
    'startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling',
  ]);
});

test('explicit native start is idle on load and opens existing polling only once after admission', async () => {
  const { calls, start } = await setup();
  assert.deepEqual(calls, []);
  await Promise.all([start(), start()]);
  await start();
  assert.deepEqual(calls, ['read', 'install', 'hello', 'startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling']);
});

test('another live worker or malformed state cannot install a competing native worker', async () => {
  for (const state of [{ schema: 'factory-control-projection:v1', connected: true }, {}]) {
    const { calls, start } = await setup(state);
    await assert.rejects(start(), /factory_worker_already_connected|factory_state_invalid/);
    assert.deepEqual(calls, ['read']);
  }
});

test('stale build admission failure never starts claim or projection polling', async () => {
  const { calls, start } = await setup(undefined, new Error('factory_worker_build_mismatch'));
  await assert.rejects(start(), /factory_worker_build_mismatch/);
  assert.deepEqual(calls, ['read', 'install', 'hello']);
});

test('visible worker sends the atomic no-replacement fence in the existing hello request', async () => {
  const { createBatchControlWorker } = await import('../../src/modules/batch-control-worker.mjs');
  const bodies = [];
  const worker = createBatchControlWorker({
    workerId: 'native-start-proof', runtimeBuildId: 'native-test', replaceExistingSession: false,
    commandBridge: { run() { throw new Error('must not run'); } },
    projectionBridge: { getProjection: async () => ({ schema: 'factory-control-projection:v1', session: {} }) },
    fetchImpl: async (url, request = {}) => {
      if (request.method === 'POST') bodies.push(JSON.parse(request.body));
      return { ok: true, status: 200, json: async () => request.method === 'POST'
        ? { accepted: true } : { sessionId: 'test-only', csrfToken: 'test-only' } };
    },
  });
  await worker.hello();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].replaceExistingSession, false);
});

async function identityConsole(read) {
  const h = await driver();
  const before = h.readLocal().store.getSnapshot();
  const effects = [], reads = [];
  const apiRequest = h.io.apiRequest;
  h.io.apiRequest = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') { effects.push(url); throw new Error('unexpected identity write'); }
    return apiRequest(url, init);
  };
  const worker = Object.fromEntries(['hello', 'startHeartbeat', 'startSessionHeartbeat', 'startPolling', 'startProjectionPolling']
    .map(name => [name, () => { effects.push(name); return { accepted: true }; }]));
  const ui = await mountConsole(h, {
    installWorker: () => { effects.push('install'); return { worker }; },
    syncProjection: () => { effects.push('syncProjection'); },
    readStartupIdentity: async () => { reads.push('getProjection'); return read(); },
  }, { autoStart: false });
  const assertNoActions = () => {
    assert.deepEqual(effects, [], 'worker install, hello, claim/polling, save, restore and registration must stay idle');
    assert.deepEqual(h.posts, []);
    assert.deepEqual(h.calls, [], 'no local save, restore, generation or sync');
    assert.deepEqual(h.readLocal().store.getSnapshot(), before);
  };
  assertNoActions();
  return { ...ui, reads, assertNoActions };
}

test('startup identity: mount and disclosure are idle; one click reads once and renders only safe text inside details', async () => {
  const productName = '<strong>표시용 & 샘플</strong>';
  const capturedAt = '2026-09-12T14:00:00.000Z';
  const value = { productName, capturedAt, registration: { jobId: 'fixture-identity-job' }, session: { runId: 'fixture-identity-run' },
    imageBody: 'TEST_ONLY_EXCLUDED', token: 'TEST_ONLY_EXCLUDED', otherJobs: ['TEST_ONLY_EXCLUDED'] };
  const before = JSON.stringify(value);
  let fail = false;
  const ui = await identityConsole(() => {
    if (fail) throw new Error('TEST_ONLY_EXCLUDED');
    return value;
  });
  assert.deepEqual(ui.reads, []);
  const details = ui.document.getElementById('nativeBatchIdentityDetails');
  assert.ok(details, 'missing readonly identity details');
  assert.equal(details.tagName.toLowerCase(), 'details');
  assert.equal(details.open, false);
  const summary = details.querySelector('summary');
  assert.ok(summary);
  assert.match(summary.textContent, /확인 시점의 연결 대상/);
  await summary.click();
  assert.equal(details.open, true);
  assert.deepEqual(ui.reads, [], 'opening details must not invoke the getter');
  const check = ui.document.getElementById('nativeBatchIdentityCheck');
  assert.ok(check);
  assert.match(check.textContent, /확인/);
  await check.click();
  assert.deepEqual(ui.reads, ['getProjection']);
  const product = ui.document.getElementById('nativeBatchIdentityProduct');
  assert.equal(product.textContent, productName);
  assert.equal(product.children.length, 0, 'product markup must be literal text, not HTML');
  assert.equal(details.querySelector('#nativeBatchIdentityJobId').textContent, 'fixture-identity-job');
  assert.equal(details.querySelector('#nativeBatchIdentityRunId').textContent, 'fixture-identity-run');
  assert.doesNotMatch(summary.textContent, /fixture-identity-(job|run)/);
  assert.doesNotMatch(details.textContent, /TEST_ONLY_EXCLUDED|서버변경0|서버 변경 0|미래.*항상.*동일/);
  assert.equal(JSON.stringify(value), before);
  const observedAt = ui.document.getElementById('nativeBatchIdentityObservedAt');
  assert.ok(observedAt);
  assert.ok(observedAt.textContent.includes(capturedAt));
  const priorTime = observedAt.textContent;
  fail = true;
  await check.click();
  assert.deepEqual(ui.reads, ['getProjection', 'getProjection']);
  assert.equal(observedAt.textContent, priorTime, 'failed read must not refresh the last successful observation time');
  assert.equal(details.querySelector('#nativeBatchIdentityJobId').textContent, '미확인');
  assert.equal(details.querySelector('#nativeBatchIdentityRunId').textContent, '미확인');
  assert.match(details.textContent, /확인 실패/);
  assert.doesNotMatch(details.textContent, /TEST_ONLY_EXCLUDED|fixture-identity-(job|run)/);
  ui.assertNoActions();
});

test('startup identity: blank identity is not mapping approval and read errors never expose raw details', async () => {
  let fail = false;
  const ui = await identityConsole(() => {
    if (fail) throw new Error('TEST_ONLY_EXCLUDED raw credential-like diagnostic');
    return { productName: '', registration: { jobId: '' }, session: { runId: '' }, capturedAt: '2026-09-12T14:00:00.000Z' };
  });
  const details = ui.document.getElementById('nativeBatchIdentityDetails');
  assert.ok(details, 'missing readonly identity details');
  await details.querySelector('summary').click();
  const check = ui.document.getElementById('nativeBatchIdentityCheck');
  assert.ok(check);
  await check.click();
  assert.deepEqual(ui.reads, ['getProjection']);
  assert.match(details.querySelector('#nativeBatchIdentityJobId').textContent, /없음|빈 값/);
  assert.match(details.querySelector('#nativeBatchIdentityRunId').textContent, /없음|빈 값/);
  assert.doesNotMatch(details.textContent, /undefined|null|미매핑 PASS|연결 허가|TEST_ONLY_EXCLUDED/);
  fail = true;
  await check.click();
  assert.deepEqual(ui.reads, ['getProjection', 'getProjection']);
  assert.match(details.textContent, /확인.*실패/);
  assert.doesNotMatch(details.textContent, /TEST_ONLY_EXCLUDED|credential-like|raw diagnostic/);
  assert.equal(check.disabled, false);
  ui.assertNoActions();
});
