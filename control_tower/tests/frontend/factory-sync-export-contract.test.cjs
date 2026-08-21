const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const FACTORY_SYNC_MODEL = path.resolve(__dirname, '../../frontend/src/factory-sync-model.mjs');
const WORKBENCH = path.resolve(__dirname, '../../frontend/src/production-workbench.mjs');
const FACTORY_SYNC_URL = `${pathToFileURL(FACTORY_SYNC_MODEL).href}?selectedId=3`;
const WORKBENCH_URL = `${pathToFileURL(WORKBENCH).href}?factory-sync-export-contract=3`;

test('reusing selectedId keeps the original ESM module namespace after source changes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-sync-cache-buster-'));
  const moduleFile = path.join(directory, 'factory-sync-model.mjs');
  const staleUrl = `${pathToFileURL(moduleFile).href}?selectedId=2`;

  try {
    await fs.writeFile(moduleFile, 'export const legacy = true;\n');
    const oldModule = await import(staleUrl);
    await fs.writeFile(moduleFile, 'export function reconcileFactoryProjectionForSameWork() {}\n');

    const reusedModule = await import(staleUrl);
    const freshModule = await import(`${pathToFileURL(moduleFile).href}?selectedId=3`);

    assert.strictEqual(reusedModule, oldModule);
    assert.equal(typeof reusedModule.reconcileFactoryProjectionForSameWork, 'undefined');
    assert.equal(typeof freshModule.reconcileFactoryProjectionForSameWork, 'function');
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
});

test('production workbench dynamically resolves the cache-busted factory reconcile export', async () => {
  const factorySync = await import(FACTORY_SYNC_URL);
  const workbench = await import(WORKBENCH_URL);

  assert.equal(typeof factorySync.reconcileFactoryProjectionForSameWork, 'function');
  assert.equal(typeof workbench.reconcileFactoryProjectionForSameWork, 'function');
  assert.strictEqual(workbench.reconcileFactoryProjectionForSameWork, factorySync.reconcileFactoryProjectionForSameWork);
});
