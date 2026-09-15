'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');

test('제품 worker 실패 보고는 terminal projection trace를 함께 보존한다', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src/modules/batch-control-worker.mjs')));
  const posts = [];
  const order = {
    orderId: 'factory-product-terminal-trace',
    contractVersion: module.BATCH_CONTROL_WORK_ORDER_VERSION,
    capabilityVersion: module.BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
    batchId: 'batch-terminal-trace',
    productId: 'factory-job:terminal-trace',
    productKey: 'terminal-trace',
    currentRunId: 'job-terminal-trace',
    stageId: 'final_detail',
    operationToken: 'token-terminal-trace',
    idempotencyKey: 'idem-terminal-trace',
    expectedWorkfileRevision: 9,
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'runFactoryProduct',
      payload: {
        schema: 'factory-product-run-command:v1',
        jobId: 'job-terminal-trace',
        batchId: 'batch-terminal-trace',
        idempotencyKey: 'idem-terminal-trace',
        mode: 'manual',
        source: { kind: 'manual' },
        productName: 'terminal-trace',
        workfileName: 'terminal-trace.kuasangse',
        jcode: null,
        imageModel: undefined,
        requiredValues: {
          category: 'category', material: 'material', originCountry: 'origin',
          size: '55x55', salePrice: '1000', stock: '1', usage: 'use', optionMode: 'none',
        },
        inputImages: [{
          role: 'base', ordinal: 1, name: 'base', fileName: 'base.png',
          colorName: '', sha256: 'fixture-sha', dataUrl: 'data:image/png;base64,AA==',
        }],
        startFresh: false,
        expectedStageKey: 'final_detail',
        restoreOnly: false,
        adoptHydratedWorkfile: false,
      },
    },
  };
  const terminalProjection = {
    schema: 'factory-control-projection:v1',
    progress: {
      stageKey: 'detail',
      status: 'failed',
      percent: 86,
      trace: {
        schema: 'factory-detail-stage-debug:v1',
        correlationId: 'job-terminal-trace:workspace:run:9:trace',
        phase: 'request_timeout',
        sectionId: 'key_features',
        errorCode: 'factory_section_request_timeout',
      },
    },
  };
  const response = body => ({ ok: true, status: 200, json: async () => body });
  const worker = module.createBatchControlWorker({
    apiBase: 'http://tower',
    workerId: 'worker-terminal-trace',
    workerSessionId: 'session-terminal-trace',
    commandBridge: { run: async () => { throw new Error('detail failed'); } },
    projectionBridge: { getProjection: async () => terminalProjection },
    fetchImpl: async (url, init = {}) => {
      const endpoint = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      if (endpoint !== '/api/session') posts.push({ endpoint, body });
      if (endpoint === '/api/session') return response({ sessionId: 'tower-session', csrfToken: 'csrf' });
      if (endpoint === '/api/worker/claim') return response({ order });
      return response({ accepted: true });
    },
  });

  await assert.rejects(() => worker.start(), /detail failed/);

  const failed = posts.find(entry => entry.endpoint.endsWith('/fail'));
  assert.ok(failed, '실패 보고가 없습니다');
  assert.equal(failed.body.terminalProjection.progress.trace.phase, 'request_timeout');
  assert.equal(failed.body.terminalProjection.progress.trace.sectionId, 'key_features');
});
