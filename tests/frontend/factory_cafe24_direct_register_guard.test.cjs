const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

test('worker and classic bridge reject the retired unapproved Cafe24 registration command', async () => {
  const contract = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-contract.mjs')));
  const controlBridge = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-control-command-bridge.mjs')));
  const order = {
    orderId: 'order-unapproved-cafe24',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-unapproved-cafe24',
    productId: 'cafe24:3026',
    productKey: '승인 없는 상품',
    currentRunId: 'run-unapproved-cafe24',
    stageId: 'cafe24',
    operationToken: 'cafe24:unapproved',
    idempotencyKey: 'cafe24:unapproved',
    expectedWorkfileRevision: 7,
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'registerFactoryCafe24',
      payload: { jobId: 'factory-job-unapproved-cafe24' },
    },
  };

  assert.throws(
    () => contract.validateOrder(order),
    error => error?.code === 'factory_cafe24_approval_required',
  );

  let calls = 0;
  const bridge = controlBridge.createFactoryControlCommandBridge({
    requestClassicRuntime: async () => {
      calls += 1;
      return { schema: 'factory-cafe24-registration-receipt:v1' };
    },
  });
  await assert.rejects(
    bridge.run('factory-control', 'registerFactoryCafe24', order.command.payload, order),
    error => error?.code === 'factory_cafe24_approval_required',
  );
  assert.equal(calls, 0);
});
