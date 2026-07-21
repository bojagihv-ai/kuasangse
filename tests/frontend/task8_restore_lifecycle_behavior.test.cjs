'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

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

test('Given a transient storage read failure, hydration retries once and completes restore cleanup', async () => {
  const calls = [];
  const restoredAssets = Object.freeze({ currentProjectId: 'project-retry', productName: '재시도 상품' });
  let readAttempts = 0;
  const context = vm.createContext({
    state: { step: 'factory' },
    sessionAssetsHydrated: false,
    workspaceBlankResetToken: 'workspace:retry',
    pendingSessionAssetSaveAfterHydrate: false,
    async workspaceGetSessionAssets() {
      readAttempts += 1;
      calls.push(`read:${readAttempts}`);
      if (readAttempts === 1) throw new Error('transient browser storage failure');
      return restoredAssets;
    },
    lastWorkSnapshotMatchesCurrentWorkspace: () => true,
    lastWorkPayloadProductName: () => '재시도 상품',
    applySessionAssetsPayload(assets) {
      calls.push(assets === restoredAssets ? 'apply:restored' : 'apply:unexpected');
      return true;
    },
    hydrateLastProductImageBackup: async () => false,
    snapshotHasInlineImagePayload: () => false,
    recoverStaleSessionInlineImages: () => false,
    markSessionAssetFingerprintSaved: () => calls.push('fingerprint'),
    render: () => calls.push('render'),
    scheduleCompetitorEvidenceCanvasPaint: () => calls.push('paint'),
    paintCompetitorEvidenceCanvases: () => calls.push('paint-fallback'),
    factoryClearRestoredImageGenerationRuntime() {
      calls.push('cleanup');
      return false;
    },
    showImageRestoreWarningIfNeeded() {
      calls.push('warning-reconciled');
      return false;
    },
    scheduleSessionAssetSave: () => calls.push('save'),
    setTimeout(callback, delay) {
      calls.push(`timer:${delay}`);
      queueMicrotask(callback);
      return calls.length;
    },
    console: { warn: message => calls.push(`warn:${message}`) },
  });
  const functionSource = sourceSlice(
    source('src/app-core-02.js'),
    'async function hydratePersistentSessionAssets(',
    'function expireCookie(',
  );
  vm.runInContext(`${functionSource}
globalThis.runHydration = hydratePersistentSessionAssets;
globalThis.hydrationComplete = () => sessionAssetsHydrated;`, context);

  await context.runHydration();
  await new Promise(resolve => queueMicrotask(resolve));

  assert.equal(readAttempts, 2);
  assert.deepEqual(calls.filter(call => call.startsWith('timer:')), ['timer:50', 'timer:0']);
  assert.equal(calls.includes('apply:restored'), true);
  assert.equal(calls.includes('cleanup'), true);
  assert.equal(calls.includes('warning-reconciled'), true);
  assert.equal(context.hydrationComplete(), true);
  assert.ok(calls.filter(call => call === 'render').length >= 1);
});

test('Given product work at startup, the warning is reconciled only after every restore source settles', async () => {
  const calls = [];
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return Object.freeze({ promise, resolve });
  };
  const sessionAssets = deferred();
  const serverSnapshot = deferred();
  const localArchive = deferred();
  const imageBackup = deferred();
  const settleTurn = () => new Promise(resolve => setImmediate(resolve));
  const context = vm.createContext({
    state: { currentProjectId: 'project-startup', step: 'factory' },
    gemini: null,
    installClassicRuntimeLifecycle: () => calls.push('install'),
    disposeClassicRuntimeLifecycle: () => calls.push('dispose'),
    hasGeminiConnection: () => false,
    getCurrentLastWorkWorkspaceScope: () => 'project:project-startup',
    ensureWorkspaceEditAuthority: async () => ({ scopeId: 'project:project-startup' }),
    markSessionAssetFingerprintSaved: () => calls.push('fingerprint'),
    loadCutsArchiveFolderStatus: async () => calls.push('cuts-status'),
    refreshWorkspaceLists: async () => calls.push('workspace-lists'),
    hydratePersistentSessionAssets() {
      calls.push('session-assets:start');
      return sessionAssets.promise.then(() => calls.push('session-assets:settled'));
    },
    hydrateServerLastWorkSnapshot() {
      calls.push('server-snapshot:start');
      return serverSnapshot.promise.then(() => calls.push('server-snapshot:settled'));
    },
    factoryRestoreCurrentWorkfileLocalArchive() {
      calls.push('local-archive:start');
      return localArchive.promise.then(() => calls.push('local-archive:settled'));
    },
    factoryRuntimeReadFactory: () => ({ product: { productName: '기동 상품', hasImage: true } }),
    hydrateLastProductImageBackup() {
      calls.push('image-backup:start');
      return imageBackup.promise.then(() => calls.push('image-backup:settled'));
    },
    showImageRestoreWarningIfNeeded: () => calls.push('warning-reconciled'),
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
  });
  const functionSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function runClassicRuntimeHydration(',
    'function hydrateClassicRuntime(',
  );
  vm.runInContext(`${functionSource}
globalThis.runStartupHydration = runClassicRuntimeHydration;`, context);

  const pending = context.runStartupHydration({ schema: 'kuasangse.app-state', version: 'app-state:v1' });
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('server-snapshot:start'), false);

  sessionAssets.resolve();
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('server-snapshot:start'), true);
  assert.equal(calls.includes('local-archive:start'), false);

  serverSnapshot.resolve();
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('local-archive:start'), true);
  assert.equal(calls.includes('image-backup:start'), false);

  localArchive.resolve();
  await settleTurn();
  assert.equal(calls.includes('warning-reconciled'), false);
  assert.equal(calls.includes('image-backup:start'), true);

  imageBackup.resolve();
  const result = await pending;

  assert.deepEqual({ ...result }, {
    schema: 'kuasangse.app-state',
    version: 'app-state:v1',
    hydrated: true,
    stale: false,
  });
  const restoreOrder = [
    'session-assets:start', 'session-assets:settled',
    'server-snapshot:start', 'server-snapshot:settled',
    'local-archive:start', 'local-archive:settled',
    'image-backup:start', 'image-backup:settled',
    'warning-reconciled',
  ];
  assert.deepEqual(calls.filter(call => restoreOrder.includes(call)), restoreOrder);
});

test('Given an active menu render, warning reconciliation happens before visible markup replacement', () => {
  const calls = [];
  const root = {};
  const menu = {
    ownedSlices: ['manual-ui'],
    refresh: refreshedRoot => calls.push(refreshedRoot === root ? 'refresh' : 'refresh:unexpected'),
  };
  const context = vm.createContext({
    state: { step: 'manual' },
    document: {
      getElementById: () => root,
      documentElement: { dataset: {} },
    },
    runtimeMenuModules: new Map(),
    showImageRestoreWarningIfNeeded: () => calls.push('warning-reconciled'),
    renderShellMarkup: () => {
      calls.push('markup');
      return '<main>updated</main>';
    },
    patchAppHtml: (target, html) => calls.push(target === root && html.includes('updated') ? 'patch' : 'patch:unexpected'),
    bindShellAfterRender: target => calls.push(target === root ? 'bind' : 'bind:unexpected'),
  });
  const functionSource = sourceSlice(
    source('src/app-core-03.js'),
    'function renderShellFrame(',
    'const CLASSIC_RUNTIME_REQUEST_EVENT',
  );
  vm.runInContext(`${functionSource}
globalThis.renderFrame = renderShellFrame;`, context);

  context.renderFrame({ root, menu, activeMenuHtml: '<section>manual</section>' });

  assert.deepEqual(calls, ['warning-reconciled', 'markup', 'patch', 'bind', 'refresh']);
});

test('Given a marker-only analysis reference matching the restored product image, no loss is reported', () => {
  const imagePayload = 'restored-product-image';
  const fingerprint = `${imagePayload.length}:${imagePayload}:${imagePayload}`;
  const fingerprintSource = sourceSlice(
    source('src/app-core-03.js'),
    'function factoryImagePayloadFingerprint(',
    'function factoryImageFingerprintLooksUsable(',
  );
  const counterSource = sourceSlice(
    source('src/app-core-02.js'),
    'function hasRestoredImagePayloadValue(',
    'function wasStorageWarningDismissed(',
  );
  for (const payloadOwner of ['state', 'factory']) {
    const product = {
      hasImage: true,
      imageBase64: payloadOwner === 'factory' ? imagePayload : '',
      inputImages: [{ hasImage: true, inputImageFingerprint: fingerprint }],
    };
    const context = vm.createContext({
      state: {
        step: 'factory',
        imageBase64: payloadOwner === 'state' ? imagePayload : '',
        analysisImages: [{ hasImageData: true, inputImageFingerprint: fingerprint }],
      },
      IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
      factoryRuntimeReadFactory: () => ({ product, assets: [] }),
    });
    vm.runInContext(`${fingerprintSource}
${counterSource}
globalThis.countMissingRestoreReferences = countSessionAssetRestoreRefs;`, context);

    assert.equal(context.countMissingRestoreReferences(), 0, `${payloadOwner} payload must satisfy matching references`);
  }
});
