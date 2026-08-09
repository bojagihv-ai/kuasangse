const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const fixture = path.join(root, 'control_tower', 'fixtures', 'two-product-mixed-manual', 'manifest.json');
const driver = path.join(root, 'tools', 'verify_control_tower_e2e_cdp.mjs');

test('Given the Task 15 fixture, when the E2E driver inspects it, then it declares one manual and one automatic product', () => {
  const result = spawnSync(process.execPath, [driver, '--inspect-fixture', '--fixture', fixture], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.products, [
    { productId: 'task15-product-a', representative: 'manual' },
    { productId: 'task15-product-b', representative: 'auto' },
  ]);
  assert.equal(summary.externalWrite, false);
  assert.equal(summary.workerAuthority, 'durable-process-restart');
  assert.deepEqual(summary.staleIdentityFields, [
    'runId',
    'inputFingerprint',
    'revision',
    'eventSequence',
  ]);
  assert.deepEqual(summary.strictIdentityFields, [
    'productId',
    'productKey',
    'orderId',
    'revision',
    'imageIdentity',
  ]);
  assert.equal(summary.browserControlAudit, 'all-rendered-controls-per-viewport');
});
