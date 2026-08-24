'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');

async function loadWorkerModule() {
  return import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')).href);
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function buildWorker(moduleExports, order, { ackFails = false } = {}) {
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/api/session')) {
      return jsonResponse({ sessionId: 'tower-session', csrfToken: 'tower-csrf' });
    }
    if (target.endsWith('/api/worker/claim')) {
      posts.push({ path: '/api/worker/claim' });
      return jsonResponse({ order });
    }
    let body = null;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    posts.push({ path: target.replace('http://tower', ''), body });
    if (ackFails && target.includes('/ack')) {
      return jsonResponse({ error: { code: 'stale_factory_session' } }, false, 422);
    }
    return jsonResponse({ accepted: true });
  };

  const worker = moduleExports.createBatchControlWorker({
    apiBase: 'http://tower',
    workerId: 'factory-worker-test',
    runtimeBuildId: 'build-test',
    workerSessionId: 'worker-session',
    commandBridge: { run: async () => ({ ok: true }) },
    fetchImpl,
    nowImpl: () => 1000,
  });
  return { worker, posts };
}

function validOrder(moduleExports) {
  return {
    orderId: 'factory-product-broken',
    contractVersion: moduleExports.BATCH_CONTROL_WORK_ORDER_VERSION,
    capabilityVersion: moduleExports.BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
    batchId: 'batch-1',
    productId: 'factory-job:job-1',
    productKey: '슬라브 겹보',
    currentRunId: 'job-1',
    stageId: 'representative',
    operationToken: 'token-1',
    idempotencyKey: 'idem-1',
    expectedWorkfileRevision: 3,
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'selectFactoryACut',
      payload: {
        productId: 'factory-job:job-1',
        productKey: '슬라브 겹보',
        stageKey: 'representative',
        candidateId: 'factory_hero_1',
        expectedRunId: 'job-1',
        expectedInputFingerprint: 'sha256:input',
        idempotencyKey: 'idem-1',
        expectedRevision: 3,
      },
    },
  };
}

test('받을 수 없는 주문은 그 이유를 관제탑에 돌려준다', async () => {
  // 조용히 멈추면 관제탑은 그 작업을 '실행 중' 으로 붙든 채 아무도 하지 않는 상태가 된다.
  const moduleExports = await loadWorkerModule();
  const broken = { ...validOrder(moduleExports), expectedWorkfileRevision: -1 };
  const { worker, posts } = buildWorker(moduleExports, broken);

  await assert.rejects(() => worker.start());

  const failed = posts.find(entry => entry.path.includes('/fail'));
  assert.ok(failed, `실패를 보고하지 않았습니다: ${posts.map(p => p.path).join(', ')}`);
  assert.ok(
    String(failed.body?.error || '').includes('revision_invalid'),
    `원인을 그대로 돌려주지 않았습니다: ${failed.body?.error}`,
  );
  assert.ok(!posts.some(entry => entry.path.includes('/ack')), 'ack 이전 단계여야 합니다');
});

test('ack 자체가 거절돼도 실행 중으로 남기지 않는다', async () => {
  const moduleExports = await loadWorkerModule();
  const { worker, posts } = buildWorker(moduleExports, validOrder(moduleExports), { ackFails: true });

  await assert.rejects(() => worker.start());

  assert.ok(posts.some(entry => entry.path.includes('/ack')), 'ack 을 시도해야 합니다');
  assert.ok(
    posts.some(entry => entry.path.includes('/fail')),
    `ack 실패를 보고하지 않았습니다: ${posts.map(p => p.path).join(', ')}`,
  );
});

test('정상 주문은 종전대로 ack 하고 수행한다', async () => {
  const moduleExports = await loadWorkerModule();
  const { worker, posts } = buildWorker(moduleExports, validOrder(moduleExports));

  const result = await worker.start();

  assert.equal(result.status, 'completed');
  assert.ok(posts.some(entry => entry.path.includes('/ack')));
  assert.ok(posts.some(entry => entry.path.includes('/complete')));
  assert.ok(!posts.some(entry => entry.path.includes('/fail')), '정상 주문인데 실패를 보고했습니다');
});

test('Cafe24 등록 명령도 워커 계약이 받아들인다', async () => {
  // 계약에 없으면 워커가 ack 전에 거부해, 관제탑은 등록 작업을 영원히 '실행 중' 으로 붙든다.
  const moduleExports = await loadWorkerModule();
  const order = {
    ...validOrder(moduleExports),
    orderId: 'factory-cafe24-1',
    stageId: 'cafe24',
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'registerFactoryCafe24',
      payload: { jobId: 'job-1', cafe24: { categoryId: '119', salePrice: '2700' } },
    },
  };
  const { worker, posts } = buildWorker(moduleExports, order);

  const result = await worker.start();

  assert.equal(result.status, 'completed');
  assert.ok(!posts.some(entry => entry.path.includes('/fail')), '등록 명령을 거부했습니다');
});
