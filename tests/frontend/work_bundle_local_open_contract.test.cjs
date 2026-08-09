const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHash, webcrypto } = require('node:crypto');
const { pathToFileURL } = require('node:url');

test('신화사 자산관에서 선택한 로컬 작업파일을 상세페이지 앱이 안전하게 연다', () => {
  const runtimePath = path.resolve(__dirname, '../../src/app-core-03.js');
  const imageCutsViewPath = path.resolve(__dirname, '../../src/menus/imagecuts-view-results.mjs');
  const imageCutsRuntimePath = path.resolve(__dirname, '../../src/app-core-06.js');
  const manifestPath = path.resolve(__dirname, '../../src/runtime-manifest.json');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  const imageCutsView = fs.readFileSync(imageCutsViewPath, 'utf8');
  const imageCutsRuntime = fs.readFileSync(imageCutsRuntimePath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Given: the asset manager transfers a user-selected ArrayBuffer from its fixed local origin.
  // When: the detail-page runtime initializes its external workfile-open boundary.
  // Then: the receiver module is loaded, origin-gated, and wired to the real import flow.
  assert.match(runtime, /createExternalWorkfileOpenBridge/);
  assert.match(runtime, /http:\/\/127\.0\.0\.1:5173/);
  assert.match(runtime, /importFactoryProjectFileBundle/);
  assert.match(runtime, /importWorkfile: async \(text, fileName, options = \{\}\)/);
  assert.match(runtime, /skipLeaveConfirm: options\.skipLeaveConfirm === true/);
  assert.match(runtime, /const syncBundle = await buildFactoryProjectFileBundle/);
  assert.match(runtime, /requestCurrentWorkBundleLiveSync\('로컬 작업파일 불러오기'/);
  assert.match(runtime, /sourceScheme: 'local-workfile'/);
  assert.match(runtime, /scheduleCurrentWorkBundleSync/);
  assert.match(runtime, /hasPending: hasPendingCurrentWorkBundleSync/);
  assert.match(runtime, /const bundleKey = currentWorkBundleKey\(\)/);
  assert.match(runtime, /hasPendingWorkBundleSync\(bundleKey\)/);
  assert.match(runtime, /scopeWorkBundleForCurrentBranch\(bundle, options\)/);
  assert.match(imageCutsView, /p\.localArchiveId[\s\S]*로컬/);
  assert.match(imageCutsRuntime, /p\.localArchiveId[\s\S]*로컬/);
  assert.ok(manifest.modules.includes('src/modules/external-workfile-open.mjs'));
});

test('외부 작업파일 열기 통로는 고정된 신화사 자산관 창만 허용한다', async () => {
  const modulePath = path.resolve(__dirname, '../../src/modules/external-workfile-open.mjs');
  const { createExternalWorkfileOpenBridge } = await import(pathToFileURL(modulePath).href);
  const sentMessages = [];
  const opener = {
    postMessage(message, origin) {
      sentMessages.push({ message, origin });
    },
  };
  let messageHandler = null;
  const root = {
    location: { search: '?open-source=sinhwa-assets' },
    opener,
    addEventListener(type, handler) {
      if (type === 'message') messageHandler = handler;
    },
    removeEventListener() {},
  };
  const imported = [];
  const bridge = createExternalWorkfileOpenBridge({
    root,
    allowedOrigins: ['http://127.0.0.1:5173'],
    async importWorkfile(text, fileName, options) {
      imported.push({ text, fileName, options });
      return { fileName };
    },
  });

  assert.equal(bridge.active, true);
  assert.equal(sentMessages[0].message.type, 'kuasangse:external-workfile-open-ready');
  assert.equal(typeof messageHandler, 'function');

  await messageHandler({
    origin: 'http://127.0.0.1:5173',
    source: opener,
    data: { type: 'kuasangse:external-workfile-open-probe' },
  });
  assert.equal(sentMessages.at(-1).message.type, 'kuasangse:external-workfile-open-ready');

  await messageHandler({
    origin: 'http://malicious.invalid',
    source: opener,
    data: {
      type: 'kuasangse:external-workfile-open-request',
      fileName: '차단.kuasangse',
      buffer: new TextEncoder().encode('blocked').buffer,
    },
  });
  assert.equal(imported.length, 0);

  await messageHandler({
    origin: 'http://127.0.0.1:5173',
    source: opener,
    data: {
      type: 'kuasangse:external-workfile-open-request',
      fileName: '호박바늘쌈.kuasangse',
      buffer: new TextEncoder().encode('workfile-data').buffer,
    },
  });
  assert.deepEqual(imported, [{
    text: 'workfile-data',
    fileName: '호박바늘쌈.kuasangse',
    options: undefined,
  }]);
  assert.equal(sentMessages.at(-1).message.ok, true);
});

test('등록된 작업파일 hydration 명령은 경로 없이 정확한 내용 digest를 검증해 worker 상태를 교체한다', async () => {
  const modulePath = path.resolve(__dirname, '../../src/modules/external-workfile-open.mjs');
  const { createExternalWorkfileOpenBridge } = await import(
    `${pathToFileURL(modulePath).href}?hydrate=${Date.now()}`
  );
  const imported = [];
  const root = {
    crypto: webcrypto,
    location: { search: '?batchWorker=1' },
    opener: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const workfileText = JSON.stringify({
    format: 'kuasangse.factory.project',
    project: { id: 'project_mrx0tgw5_mrzrpg', name: '방울수저집', payload: {} },
  });
  const expectedSha256 = createHash('sha256')
    .update(workfileText, 'utf8')
    .digest('hex');

  const bridge = createExternalWorkfileOpenBridge({
    root,
    allowedOrigins: [],
    async importWorkfile(text, fileName, options) {
      imported.push({ text, fileName, options });
      return {
        projectId: 'project_mrx0tgw5_mrzrpg',
        name: 'gpt가한방울수저집 (8)',
        productKey: '방울수저집',
      };
    },
  });
  const receipt = await root.__KUASANGSE_WORKFILE_COMMAND_BRIDGE__.hydrate({
    contractVersion: 'factory-workfile-hydration-command:v1',
    capabilityVersion: 'factory-workfile-hydration-command:v1',
    fileName: 'gpt가한방울수저집 (8).kuasangse',
    workfileText,
    expectedSha256,
  });

  assert.equal(bridge.active, false);
  assert.equal(root.__KUASANGSE_WORKFILE_COMMAND_BRIDGE__.version, 'factory-workfile-hydration-command:v1');
  assert.deepEqual(imported, [{
    text: workfileText,
    fileName: 'gpt가한방울수저집 (8).kuasangse',
    options: { skipLeaveConfirm: true },
  }]);
  assert.deepEqual(receipt, {
    schema: 'factory-workfile-hydration-receipt:v1',
    capabilityVersion: 'factory-workfile-hydration-command:v1',
    fileName: 'gpt가한방울수저집 (8).kuasangse',
    workfileSha256: expectedSha256,
    projectId: 'project_mrx0tgw5_mrzrpg',
    name: '방울수저집',
  });
  await assert.rejects(
    root.__KUASANGSE_WORKFILE_COMMAND_BRIDGE__.hydrate({
      contractVersion: 'factory-workfile-hydration-command:v1',
      capabilityVersion: 'factory-workfile-hydration-command:v1',
      fileName: 'C:/Users/kua/Downloads/target.kuasangse',
      workfileText,
      expectedSha256,
    }),
    /작업파일 이름에는 경로를 포함할 수 없습니다/,
  );
  await assert.rejects(
    root.__KUASANGSE_WORKFILE_COMMAND_BRIDGE__.hydrate({
      contractVersion: 'factory-workfile-hydration-command:v1',
      capabilityVersion: 'factory-workfile-hydration-command:v1',
      fileName: 'gpt가한방울수저집 (8).kuasangse',
      workfileText,
      expectedSha256: '0'.repeat(64),
    }),
    /작업파일 digest가 일치하지 않습니다/,
  );
});
