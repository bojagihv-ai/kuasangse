const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const MODEL_URL = new URL(
  `file://${path.resolve(__dirname, '../../frontend/src/factory-sync-model.mjs').replace(/\\/g, '/')}`,
).href;
const WORKBENCH_URL = new URL(
  `file://${path.resolve(__dirname, '../../frontend/src/production-workbench.mjs').replace(/\\/g, '/')}`,
).href;

function projection(storage) {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '1',
    sequence: 1,
    connected: true,
    status: 'connected',
    capturedAt: '2026-08-29T20:00:00.000Z',
    session: {
      workspaceId: 'ws', productId: 'factory:pouch', productKey: 'pouch',
      runId: 'run-1', inputFingerprint: 'fp-1', revision: 5,
    },
    inputs: [],
    stages: [],
    ...(storage === undefined ? {} : { storage }),
    progress: {},
    registration: {},
  };
}

test('워커 저장 실패는 관제탑 판까지 실려 온다', async () => {
  const { normalizeFactoryProjection } = await import(MODEL_URL);
  const normalized = normalizeFactoryProjection(projection({
    ok: false, warning: '세션 저장에 실패했습니다.',
  }));
  assert.equal(normalized.storage.ok, false);
  assert.equal(normalized.storage.warning, '세션 저장에 실패했습니다.');
});

test('저장 상태를 안 보내던 옛 워커는 정상으로 본다', async () => {
  const { normalizeFactoryProjection } = await import(MODEL_URL);
  const normalized = normalizeFactoryProjection(projection());
  assert.equal(normalized.storage.ok, true);
  assert.equal(normalized.storage.warning, '');
});

test('저장하지 못하는 워커는 "연결됨" 대신 저장 실패를 먼저 말한다', async () => {
  const { projectFactoryQueueRenderModel } = await import(WORKBENCH_URL);
  const model = projectFactoryQueueRenderModel(
    projection({ ok: false, warning: '세션 저장에 실패했습니다.' }),
    [],
    { transport: 'live' },
  );
  assert.equal(model.connectivity.state, 'storage-blocked');
  assert.equal(model.connectivity.tone, 'error');
  assert.match(model.connectivity.factoryLabel, /저장 실패/);
  assert.match(model.connectivity.detail, /값이 저장되지 않습니다/);
});

test('저장이 멀쩡하면 연결됨 그대로 보여 준다', async () => {
  const { projectFactoryQueueRenderModel } = await import(WORKBENCH_URL);
  const model = projectFactoryQueueRenderModel(
    projection({ ok: true, warning: '' }),
    [],
    { transport: 'live' },
  );
  assert.equal(model.connectivity.state, 'connected');
  assert.equal(model.connectivity.tone, 'ok');
});
