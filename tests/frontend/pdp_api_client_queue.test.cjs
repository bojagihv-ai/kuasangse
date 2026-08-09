const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_KEY = 'test-service-key';

function moduleUrl(relativePath) {
  return `${pathToFileURL(path.join(ROOT, relativePath)).href}?test=${Date.now()}-${Math.random()}`;
}

async function startWireServer() {
  const calls = [];
  const receipts = new Map();
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    calls.push({ method: request.method, url: request.url, headers: request.headers, body });

    if (request.headers['x-pdp-control-service-key'] !== SERVICE_KEY) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'auth_required', message: 'missing key' } }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/404') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'product_not_found', message: 'missing' } }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/422/fields') {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'validation_error', message: 'bad input' } }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/409/fields') {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'stale_version', message: 'stale', currentVersion: 3 } }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/920001') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ catalog: { jcode: 920001 }, workspace: { version: 3 } }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/920002') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ catalog: { jcode: 'wrong-type' }, workspace: null }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/920001/fields' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jcode: 920001, version: 3, fields: [] }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/920001/assets') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ items: [], workspaceVersion: 3, currentACutLinkId: null }));
      return;
    }
    if (/\/(sections|compositions|runs|events)$/.test(request.url) && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ items: [], nextCursor: null, version: 3 }));
      return;
    }
    if (request.url === '/api/pdp-assets/v1/products/920001/sections' && request.method === 'POST') {
      const key = request.headers['idempotency-key'];
      const digest = JSON.stringify(body);
      if (receipts.has(key) && receipts.get(key).digest !== digest) {
        response.writeHead(409, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'idempotency_conflict', message: 'different payload' } }));
        return;
      }
      const receipt = receipts.get(key)?.receipt || {
        id: '10000000-0000-4000-8000-000000000001',
        sectionKey: body.sectionKey,
        sectionType: body.sectionType,
        title: null,
        copyText: null,
        payloadIncluded: false,
        sortOrder: 0,
        state: 'draft',
        version: 1,
        assetLinkIds: [],
      };
      receipts.set(key, { digest, receipt });
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(receipt));
      return;
    }
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'unexpected_route', message: request.url } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/pdp-assets/v1`,
    calls,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('PDP client는 실제 HTTP 경계에서 조회·저장 계약과 서비스 키를 적용한다', async () => {
  // Given
  const wire = await startWireServer();
  try {
    const { PdpApiError, createPdpApiClient } = await import(moduleUrl('src/modules/pdp-api-client.mjs'));
    const client = createPdpApiClient({ baseUrl: wire.baseUrl, serviceKey: SERVICE_KEY });

    // When
    const product = await client.getProduct(920001);
    const collections = await Promise.all([
      client.getFields(920001),
      client.getAssets(920001),
      client.getSections(920001),
      client.getCompositions(920001),
      client.getRuns(920001),
      client.getEvents(920001),
    ]);
    const section = await client.saveSection(920001, {
      idempotencyKey: 'section:920001:hero',
      payload: { sectionKey: 'hero', sectionType: 'hero' },
    });

    // Then
    assert.equal(product.catalog.jcode, 920001);
    assert.equal(collections.every(value => Array.isArray(value.items || value.fields)), true);
    assert.equal(section.id, '10000000-0000-4000-8000-000000000001');
    assert.equal(wire.calls.every(call => call.headers['x-pdp-control-service-key'] === SERVICE_KEY), true);
    assert.equal(wire.calls.at(-1).headers['idempotency-key'], 'section:920001:hero');
  } finally {
    await wire.close();
  }
});

test('PDP client는 malformed 응답과 401/404/409/422를 typed error로 보존한다', async () => {
  // Given
  const wire = await startWireServer();
  try {
    const { PdpApiError, createPdpApiClient } = await import(moduleUrl('src/modules/pdp-api-client.mjs'));
    const authenticated = createPdpApiClient({ baseUrl: wire.baseUrl, serviceKey: SERVICE_KEY });
    const unauthenticated = createPdpApiClient({ baseUrl: wire.baseUrl, serviceKey: 'wrong' });

    // When / Then
    for (const [action, status, code] of [
      [() => unauthenticated.getProduct(920001), 401, 'auth_required'],
      [() => authenticated.getProduct(404), 404, 'product_not_found'],
      [() => authenticated.saveField(409, {
        idempotencyKey: 'field:stale',
        expectedVersion: 1,
        payload: { fieldKey: 'material', state: 'confirmed', expectedVersion: 1 },
      }), 409, 'stale_version'],
      [() => authenticated.saveField(422, {
        idempotencyKey: 'field:invalid',
        payload: { fieldKey: '', state: 'unknown' },
      }), 422, 'validation_error'],
    ]) {
      await assert.rejects(action, error => (
        error instanceof PdpApiError && error.status === status && error.code === code
      ));
    }
    await assert.rejects(
      () => authenticated.getProduct(920002),
      error => error instanceof PdpApiError && error.code === 'invalid_response',
    );
  } finally {
    await wire.close();
  }
});

test('PDP client는 같은 idempotency 요청을 wire-level에서 한 결과로 재생한다', async () => {
  // Given
  const wire = await startWireServer();
  try {
    const { PdpApiError, createPdpApiClient } = await import(moduleUrl('src/modules/pdp-api-client.mjs'));
    const client = createPdpApiClient({ baseUrl: wire.baseUrl, serviceKey: SERVICE_KEY });
    const command = {
      idempotencyKey: 'section:duplicate',
      payload: { sectionKey: 'detail', sectionType: 'detail' },
    };

    // When
    const first = await client.saveSection(920001, command);
    const replay = await client.saveSection(920001, command);

    // Then
    assert.deepEqual(replay, first);
    assert.equal(wire.calls.filter(call => call.headers['idempotency-key'] === command.idempotencyKey).length, 2);
  } finally {
    await wire.close();
  }
});

test('재전송 큐는 digest 중복을 합치고 중단 checkpoint에서 재개한 뒤 정리한다', async () => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdp-sync-queue-'));
  try {
    const { createPdpSyncQueue } = await import(moduleUrl('src/modules/pdp-sync-queue.mjs'));
    const queuePath = path.join(root, 'queue.json');
    const queue = await createPdpSyncQueue({ filePath: queuePath });
    const command = {
      operation: 'asset-and-state',
      assetKey: '920001:hero.png',
      idempotencyKey: 'asset:920001:hero',
      payload: { checksum: 'a'.repeat(64), state: 'confirmed' },
    };
    const first = await queue.enqueue(command);
    const duplicate = await queue.enqueue(command);
    let uploads = 0;
    let stateWrites = 0;

    // When
    await assert.rejects(
      () => queue.replay(async (entry, control) => {
        uploads += 1;
        await control.checkpoint({ remoteAssetId: 'asset-001' });
        throw new Error('state network interrupted');
      }),
      /state network interrupted/,
    );
    const resumed = await createPdpSyncQueue({ filePath: queuePath });
    await resumed.replay(async entry => {
      assert.equal(entry.checkpoint.remoteAssetId, 'asset-001');
      stateWrites += 1;
      return { receiptId: 'receipt-001' };
    });
    const skipped = await resumed.enqueue(command);
    const cleanup = await resumed.cleanup();

    // Then
    assert.equal(duplicate.id, first.id);
    assert.equal(skipped.status, 'succeeded');
    assert.equal(uploads, 1);
    assert.equal(stateWrites, 1);
    assert.deepEqual(cleanup, { removed: 1, remaining: 0 });
    const stored = JSON.parse(await readFile(queuePath, 'utf8'));
    assert.deepEqual(stored.entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('재전송 큐는 같은 idempotency key의 다른 digest와 stale 성공 오인을 거부한다', async () => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdp-sync-queue-conflict-'));
  try {
    const { PdpSyncQueueError, createPdpSyncQueue } = await import(moduleUrl('src/modules/pdp-sync-queue.mjs'));
    const queue = await createPdpSyncQueue({ filePath: path.join(root, 'queue.json') });
    await queue.enqueue({
      operation: 'field',
      assetKey: '920001:material',
      idempotencyKey: 'field:920001:material',
      payload: { value: 'ceramic', expectedVersion: 2 },
    });

    // When / Then
    await assert.rejects(
      () => queue.enqueue({
        operation: 'field',
        assetKey: '920001:material',
        idempotencyKey: 'field:920001:material',
        payload: { value: 'glass', expectedVersion: 2 },
      }),
      error => error instanceof PdpSyncQueueError && error.code === 'idempotency_conflict',
    );
    await assert.rejects(
      () => queue.replay(async () => {
        throw Object.assign(new Error('stale_version'), { status: 409, code: 'stale_version' });
      }),
      /stale_version/,
    );
    assert.equal((await queue.list())[0].status, 'pending');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('백엔드 client 경계는 브라우저 전역에서 생성되지 않는다', async () => {
  // Given
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const { PdpApiError, createPdpApiClient } = await import(moduleUrl('src/modules/pdp-api-client.mjs'));

    // When / Then
    assert.throws(
      () => createPdpApiClient({ baseUrl: 'http://127.0.0.1:1', serviceKey: SERVICE_KEY }),
      error => error instanceof PdpApiError && error.code === 'backend_boundary_required',
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('브라우저 흐름은 자체 백엔드 PDP 경계만 호출하고 서비스 키 모듈은 번들에 넣지 않는다', async () => {
  const appSource = await readFile(path.join(ROOT, 'frontend', 'src', 'App.js'), 'utf8');
  const manifest = await readFile(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8');
  const coreSource = await readFile(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const apiSource = await readFile(path.join(ROOT, 'src', 'cafe24-api.js'), 'utf8');

  assert.match(appSource, /sinhwa-pdp\/products/);
  assert.match(appSource, /PDP_SYNC_QUEUE_KEY|enqueuePdpSync|replayPdpSyncQueue/);
  assert.doesNotMatch(appSource, /SINHWA_PDP_SERVICE_KEY|X-PDP-Control-Service-Key/);
  assert.doesNotMatch(manifest, /pdp-api-client\.mjs|pdp-sync-queue\.mjs/);
  assert.match(apiSource, /function fetchSinhwaPdpBackend/);
  assert.match(coreSource, /fetchSinhwaPdpProductContext/);
  assert.doesNotMatch(coreSource, /fetchSinhwaDirect\(/);
});
