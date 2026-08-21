const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  captureRuntimeSourceSnapshot,
  compareRuntimeSourceSnapshots,
  findAvailableCdpBasePort,
  isRetryableInfrastructureFailure,
  prepareDetail04Fixture,
  prepareTaskOwnedDailyFixture,
  startTaskOwnedDailyServices,
  startTaskOwnedStaticServer,
  stopServices,
} = require('../../tools/run_daily_regression.cjs');
const {
  buildRegressionSteps,
} = require('../../tools/regression_manifest.cjs');
const {
  assertCdpRuntimeIsolation,
  connectCdp,
  ensureCdp,
  waitForCdpPredicateWithReconnect,
} = require('../../tools/factory_cdp_test_utils.cjs');
const {
  cdpUrlForAttempt,
  ensureAppServer,
} = require('./browser_contract_harness.cjs');

const browserStep = {
  args: ['tools/verify_factory_sample_cdp_v1.cjs'],
};

async function reserveLocalPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('daily runner skips an occupied CDP port range before starting its isolated browser', async t => {
  const occupiedPort = await findAvailableCdpBasePort(2, 12000);
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(occupiedPort, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const selectedPort = await findAvailableCdpBasePort(2, occupiedPort);

  assert.notEqual(selectedPort, occupiedPort);
  assert.ok(selectedPort > occupiedPort);
});

test('Windows 소유 프로세스 정리는 자식 트리 전체를 종료한다', () => {
  const cleanupSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'owned_process_cleanup.cjs'),
    'utf8',
  );
  const harnessSource = fs.readFileSync(
    path.join(__dirname, 'browser_contract_harness.cjs'),
    'utf8',
  );
  const cdpSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'factory_cdp_test_utils.cjs'),
    'utf8',
  );

  assert.match(cleanupSource, /taskkill(?:\.exe)?['"`]?,\s*\[['"`]\/PID['"`][\s\S]*?['"`]\/T['"`][\s\S]*?['"`]\/F['"`]/);
  assert.match(harnessSource, /terminateOwnedProcessTree\(child\)/);
  assert.match(cdpSource, /terminateOwnedProcessTree\(proc\)/);
});

test('브라우저 계약 하네스는 8081이 없으면 소유한 임시 앱 서버로 회귀를 계속한다', async t => {
  const port = await reserveLocalPort();
  const appUrl = `http://127.0.0.1:${port}/app.html`;
  const service = await ensureAppServer(appUrl);
  t.after(() => service.cleanup());

  assert.equal(service.started, true);
  const response = await fetch(appUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<!DOCTYPE html>/i);
});

test('브라우저 계약 하네스는 기존 앱 서버를 빌리지 않고 종료하지도 않는다', async t => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!DOCTYPE html><title>existing</title>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const appUrl = `http://127.0.0.1:${port}/app.html`;

  const service = await ensureAppServer(appUrl);
  assert.equal(service.started, false);
  await service.cleanup();

  const response = await fetch(appUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /existing/);
});

test('daily 프런트엔드는 OS 할당 exclusive 포트를 실행 종료까지 직접 소유한다', async t => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-daily-static-'));
  const service = await startTaskOwnedStaticServer(runDir);
  t.after(async () => {
    await new Promise(resolve => service.server.close(resolve));
    service.stdout.end();
    service.stderr.end();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${service.port}/app.html`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-kuasangse-test-server'), 'task-owned-daily-frontend');
  assert.match(await response.text(), /<!DOCTYPE html>/i);

  const competing = net.createServer();
  await assert.rejects(
    new Promise((resolve, reject) => {
      competing.once('error', reject);
      competing.listen({
        host: '127.0.0.1',
        port: service.port,
        exclusive: true,
      }, resolve);
    }),
    error => error?.code === 'EADDRINUSE',
  );
  competing.close();
});

test('브라우저 계약 하네스 재개방은 종료 직후 같은 CDP port를 재사용하지 않는다', () => {
  assert.equal(cdpUrlForAttempt('http://127.0.0.1:24000', 0), 'http://127.0.0.1:24000');
  assert.equal(cdpUrlForAttempt('http://127.0.0.1:24000', 1), 'http://127.0.0.1:24001');
  assert.equal(cdpUrlForAttempt('http://127.0.0.1:24000', 9), 'http://127.0.0.1:24009');
});

test('회귀 브라우저는 이미 실행 중인 사용자 CDP에 자동 연결하지 않는다', async t => {
  const foreignCdp = http.createServer((request, response) => {
    if (request.url === '/json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify([{
        id: 'user-browser-tab',
        type: 'page',
        url: 'http://127.0.0.1:8081/app.html',
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/user-browser-tab',
      }]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    foreignCdp.once('error', reject);
    foreignCdp.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => foreignCdp.close(resolve)));
  const cdpUrl = `http://127.0.0.1:${foreignCdp.address().port}`;

  await assert.rejects(
    ensureCdp(cdpUrl),
    /기존 CDP.*사용자 브라우저|pre-existing CDP.*user browser/i,
  );
});

test('회귀 브라우저는 격리 state와 archive 없이 사용자 backend를 향해 시작하지 않는다', () => {
  assert.throws(
    () => assertCdpRuntimeIsolation({
      KUASANGSE_BACKEND_BASE: 'http://127.0.0.1:5050',
    }),
    /격리 state.*archive|isolated state.*archive/i,
  );
  assert.doesNotThrow(() => assertCdpRuntimeIsolation({
    KUASANGSE_BACKEND_BASE: 'http://127.0.0.1:12050',
    KUASANGSE_LOCAL_STATE_FOLDER: 'C:\\temp\\kuasangse-test-state',
    KUASANGSE_LOCAL_ARCHIVE_FOLDER: 'C:\\temp\\kuasangse-test-archive',
  }));
});

test('브라우저가 시작되기 전 발생한 CDP 연결 실패만 재시도 대상으로 분류한다', () => {
  // Given: 실제 제품 판정에 도달하기 전 CDP 연결이 끊긴 결과가 있다.
  const result = { passed: false, tail: 'CDP WebSocket error before command completed' };

  // When: 회귀 실행기의 인프라 실패 분류기를 호출한다.
  const retryable = isRetryableInfrastructureFailure(browserStep, result);

  // Then: 일시적인 브라우저 인프라 실패이므로 한 번 재시도할 수 있어야 한다.
  assert.equal(retryable, true);
});

test('격리 Chrome HTTP 소켓이 응답 전에 닫히면 브라우저 인프라 실패로 한 번 재시도한다', () => {
  const result = {
    passed: false,
    tail: "TypeError: fetch failed\nSocketError: other side closed\ncode: 'UND_ERR_SOCKET'",
  };

  assert.equal(isRetryableInfrastructureFailure(browserStep, result), true);
});

test('앱 전역 객체 준비 전 타임아웃은 초기 로드 실패로 분류한다', () => {
  // Given: 격리 Chrome에서 앱 전역 객체가 만들어지기 전에 준비 대기가 끝났다.
  const result = {
    passed: false,
    tail: 'waitFor timeout: !!(window.__kuasangseState && window.factoryState)',
  };

  // When: 회귀 실행기의 인프라 실패 분류기를 호출한다.
  const retryable = isRetryableInfrastructureFailure(browserStep, result);

  // Then: 제품 로직 검증 전 실패이므로 한 번 재시도할 수 있어야 한다.
  assert.equal(retryable, true);
  assert.equal(isRetryableInfrastructureFailure(browserStep, {
    passed: false,
    tail: "waitFor timeout: (() => (typeof state === 'object' && classicRuntimeHydrationReady === true))()",
  }), true);
  assert.equal(isRetryableInfrastructureFailure(browserStep, {
    passed: false,
    tail: 'waitFor timeout: !!((window.__kuasangseState || window.state) && window.render)',
  }), true);
});

test('실제 브라우저 제품 검증 실패는 재시도로 숨기지 않는다', () => {
  // Given: 브라우저가 열린 뒤 실제 기능 단언이 실패한 결과가 있다.
  const result = {
    passed: false,
    tail: 'Factory browser verification failed: current product image was not restored',
  };

  // When: 회귀 실행기의 인프라 실패 분류기를 호출한다.
  const retryable = isRetryableInfrastructureFailure(browserStep, result);

  // Then: 제품 회귀는 즉시 실패로 남겨야 하므로 재시도하면 안 된다.
  assert.equal(retryable, false);
});

test('브라우저 단계 프로세스 타임아웃은 새 격리 브라우저로 한 번 재시도한다', () => {
  const result = { passed: false, timedOut: true, tail: 'test worker stopped before summary' };
  assert.equal(isRetryableInfrastructureFailure(browserStep, result), true);
});

test('브라우저 검사가 아닌 단계는 같은 오류 문구가 있어도 재시도하지 않는다', () => {
  // Given: 일반 Node 단위 테스트에서 연결 오류 문구가 출력되었다.
  const nonBrowserStep = { args: ['tests/frontend/factory_core_contracts.test.cjs'] };
  const result = { passed: false, tail: 'ECONNREFUSED' };

  // When: 회귀 실행기의 인프라 실패 분류기를 호출한다.
  const retryable = isRetryableInfrastructureFailure(nonBrowserStep, result);

  // Then: 재시도 범위는 격리 브라우저 검사로만 제한되어야 한다.
  assert.equal(retryable, false);
});

test('CDP 응답 대기표를 전송 전에 등록해 즉시 응답도 유실하지 않는다', async t => {
  // Given: send 호출 안에서 바로 응답하는 결정적 WebSocket을 준비한다.
  const originalWebSocket = global.WebSocket;
  class ImmediateResponseWebSocket {
    constructor() {
      this.listeners = new Map();
      queueMicrotask(() => this.emit('open', {}));
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }

    send(raw) {
      const request = JSON.parse(raw);
      this.emit('message', {
        data: JSON.stringify({ id: request.id, result: { acknowledged: true } }),
      });
    }

    close() {}
  }
  global.WebSocket = ImmediateResponseWebSocket;
  t.after(() => { global.WebSocket = originalWebSocket; });

  // When: 응답이 같은 호출 스택에서 돌아오는 CDP 명령을 보낸다.
  const cdp = connectCdp('ws://regression.invalid/devtools/page/immediate');
  await cdp.opened;
  const result = await cdp.send('Runtime.evaluate', {}, 25);

  // Then: 응답을 놓치지 않고 해당 요청 Promise가 완료되어야 한다.
  assert.deepEqual(result, { acknowledged: true });
});

test('상태 관찰 CDP가 멈추면 같은 탭에 새 연결로 다시 확인한다', async t => {
  // Given: 첫 연결은 Runtime.evaluate 응답을 잃고 두 번째 연결은 완료 상태를 반환한다.
  const originalFetch = global.fetch;
  const originalWebSocket = global.WebSocket;
  let connectionCount = 0;
  global.fetch = async () => ({
    ok: true,
    json: async () => [{
      id: 'stable-page-target',
      type: 'page',
      webSocketDebuggerUrl: 'ws://regression.invalid/devtools/page/stable-page-target',
    }],
  });
  class RecoveringWebSocket {
    constructor() {
      this.connectionNumber = ++connectionCount;
      this.listeners = new Map();
      queueMicrotask(() => this.emit('open', {}));
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }

    send(raw) {
      if (this.connectionNumber === 1) return;
      const request = JSON.parse(raw);
      this.emit('message', {
        data: JSON.stringify({
          id: request.id,
          result: { result: { type: 'boolean', value: true } },
        }),
      });
    }

    close() {
      this.emit('close', {});
    }
  }
  global.WebSocket = RecoveringWebSocket;
  t.after(() => {
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  });

  // When: 전체 제품 제한은 유지하되 개별 상태 명령은 짧게 제한한다.
  const observation = await waitForCdpPredicateWithReconnect(
    'http://127.0.0.1:19999',
    'window.__operationMarker?.settled === true',
    {
      targetId: 'stable-page-target',
      timeoutMs: 200,
      commandTimeoutMs: 25,
      pollIntervalMs: 1,
    },
  );
  t.after(() => observation.cdp.close());

  // Then: 연결 timeout 자체가 아니라 새 연결의 true 판정으로만 완료한다.
  assert.equal(observation.value, true);
  assert.equal(connectionCount, 2);
  assert.equal(observation.reconnectCount, 1);
});

test('무결성 브라우저 회귀는 실제 전역 마지막 작업과 분리된 workspace를 사용한다', () => {
  // Given: 전체 회귀에 포함된 무결성 브라우저 검증기 소스를 읽는다.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'verify_factory_integrity_cdp_v80.cjs'),
    'utf8',
  );

  // When/Then: fixture adapter가 회귀 전용 workspace를 app/store 양쪽에 같은 값으로 지정해야 한다.
  assert.match(
    source,
    /const\s+workspaceId\s*=\s*['"]regression:factory-integrity-v80['"]/,
  );
  assert.match(
    source,
    /setAppState\(\{[\s\S]*?currentProjectId:\s*workspaceId[\s\S]*?\}\)/,
  );
  assert.match(source, /f\.workspace\s*=\s*\{[\s\S]*?id:\s*workspaceId[\s\S]*?\}/);
  assert.match(source, /replaceFactory\(f,\s*\{[\s\S]*?mode:\s*['"]hydrate['"][\s\S]*?workspaceId[\s\S]*?\}\)/);
  assert.doesNotMatch(source, /window\s*\.\s*(?:state|factoryState|render)\b/);
});

test('회귀 실행 중 소스가 바뀌면 변경 파일을 검출한다', t => {
  // Given: 실행 시작 시점의 두 소스 파일을 격리된 임시 폴더에 준비한다.
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kuasangse-source-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app.html'), '<main>v1</main>');
  fs.writeFileSync(path.join(root, 'src', 'app-loader.js'), 'window.version = 1;');
  const sources = ['app.html', 'src/app-loader.js'];
  const before = captureRuntimeSourceSnapshot(root, sources);

  // When: 다른 세션이 로더만 수정한 상황을 만든다.
  fs.writeFileSync(path.join(root, 'src', 'app-loader.js'), 'window.version = 2;');
  const after = captureRuntimeSourceSnapshot(root, sources);
  const comparison = compareRuntimeSourceSnapshots(before, after);

  // Then: 실행 결과를 신뢰하지 않고 정확한 변경 파일을 제시할 수 있어야 한다.
  assert.equal(comparison.stable, false);
  assert.deepEqual(comparison.changed, ['src/app-loader.js']);
});

test('PERF-02는 격리된 앱 로더 완료를 확인하고 실패 진단과 CDP 정리를 보존한다', () => {
  // Given: 독립 daily에서 한 번 멈춘 PERF-02 브라우저 검증기 소스를 읽는다.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'verify_factory_periodic_ticker_patch_cdp_v001.cjs'),
    'utf8',
  );

  // When/Then: 캐시를 차단하고 로더 완료를 확인하며 실패 시 단계별 증거를 남겨야 한다.
  assert.match(source, /Network\.enable/);
  assert.match(source, /Network\.setCacheDisabled/);
  assert.match(source, /__KUASANGSE_APP_LOADER__/);
  assert.match(source, /__KUASANGSE_LOAD_ERRORS__/);
  assert.match(source, /startupDiagnostic/);
  assert.match(source, /navigationResult/);

  // And: target 선택 또는 연결이 실패해도 격리 Chrome 정리는 항상 실행되어야 한다.
  assert.match(source, /let cdp = null;/);
  assert.match(source, /finally\s*\{[\s\S]*?cdp\?\.close\(\)[\s\S]*?await runtime\.cleanup\?\.\(\)/);
});

test('IMG-02는 시작·복원 어느 단계에서 실패해도 격리 CDP를 항상 정리한다', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'verify_factory_persistence_cdp_v81.cjs'),
    'utf8',
  );

  assert.match(source, /let cdp = null;/);
  assert.match(source, /try\s*\{[\s\S]*?finally\s*\{[\s\S]*?cdp\?\.close\(\)[\s\S]*?await cdpRuntime\.cleanup\?\.\(\)/);
});

test('IMG-03 실제 이미지 교체 회귀는 daily 실행 목록에 포함된다', () => {
  const step = buildRegressionSteps('python').find(candidate => candidate.id === 'IMG-03');

  assert.deepEqual(step && {
    tier: step.tier,
    area: step.area,
    file: step.args?.[0],
  }, {
    tier: 'daily',
    area: '1 시작 이미지 교체',
    file: 'tools/verify_factory_product_image_replacement_cdp_v1.cjs',
  });
});

test('IMG-03 우선 이미지는 timer 지연 없이 현재 render에서 즉시 hydrate한다', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');
  const renderShellFrame = source.slice(
    source.indexOf('function renderShellFrame('),
    source.indexOf('let factoryControlProjectionSequence'),
  );

  assert.match(
    renderShellFrame,
    /factoryHydrateLightImages\(root\)[\s\S]*scheduleFactoryHydrateLightImages\(root\)/,
  );
});

test('SAVE-03 fixture는 복원 탭 권한과 분리된 고유 offline draft scope를 먼저 획득한다', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../tools/verify_factory_new_file_blank_cdp_v85.cjs'),
    'utf8',
  );

  assert.match(source, /const workspaceId = '';/);
  assert.match(source, /const authorityScope = `draft:save03_/);
  assert.match(source, /process\.env\.KUASANGSE_LOCAL_ARCHIVE_FOLDER/);
  assert.match(source, /await ensureWorkspaceEditAuthority\(authorityScope,\s*\{\s*force:\s*true\s*\}\)/);
  assert.match(source, /mode !== 'offline-edit'/);
  assert.match(source, /authorityBeforeSeed/);
});

test('daily 전체는 공유 5050/8081 대신 task-owned archive, state, frontend, backend를 사용한다', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../tools/run_daily_regression.cjs'),
    'utf8',
  );
  const authorityRoute = fs.readFileSync(
    path.resolve(__dirname, '../../backend/routes/api_workspace_lock.py'),
    'utf8',
  );

  assert.match(source, /async function startTaskOwnedDailyServices/);
  assert.match(source, /KUASANGSE_DAILY_FRONTEND_PORT/);
  assert.match(source, /KUASANGSE_DAILY_BACKEND_PORT/);
  assert.match(source, /KUASANGSE_LOCAL_ARCHIVE_FOLDER/);
  assert.match(source, /KUASANGSE_LOCAL_STATE_FOLDER/);
  assert.match(authorityRoute, /Path\(Config\.LOCAL_STATE_FOLDER\).*workspace-authority\.json/);
  assert.match(source, /task-owned-daily-frontend/);
  assert.match(source, /startTaskOwnedStaticServer/);
  assert.match(source, /exclusive:\s*true/);
  assert.match(source, /task-owned-daily-backend/);
  assert.match(source, /runStep\(steps\[index\], index, runDir, runtime\.env\)/);
  assert.match(source, /stopServices\(runtime\.services\)/);
  assert.doesNotMatch(source, /if \(!await urlIsReady\(appUrl\)\)/);
  assert.doesNotMatch(source, /if \(!await urlIsReady\(`\$\{apiBase\}\/api\/sections`\)\)/);
});

test('DETAIL-04 task runtime은 상세 검증 시작 전에 pinned fixture 하나만 준비하고 repository archive를 보존한다', async t => {
  const fixtureRoot = path.resolve(__dirname, '..', 'fixtures', 'detail-04');
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
  const rootSourcePath = path.resolve(__dirname, '..', '..', ...manifest.targetRelativePath.split('/'));
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-detail04-run-'));
  const rootSourceExists = fs.existsSync(rootSourcePath);
  const rootSourceHash = rootSourceExists
    ? crypto.createHash('sha256').update(fs.readFileSync(rootSourcePath)).digest('hex').toUpperCase()
    : '';
  const rootSourceMode = rootSourceExists ? fs.statSync(rootSourcePath).mode & 0o777 : 0;
  const pythonExe = fs.existsSync(path.resolve(__dirname, '../../backend/venv311/Scripts/python.exe'))
    ? path.resolve(__dirname, '../../backend/venv311/Scripts/python.exe')
    : 'python';
  let runtime;
  let caught;
  try {
    runtime = await startTaskOwnedDailyServices(
      pythonExe,
      runDir,
      await findAvailableCdpBasePort(1),
    );
    const copiedPath = path.join(runtime.runtimeRoot, ...manifest.targetRelativePath.split('/'));
    const probe = spawnSync(process.execPath, ['-e', [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "const target=path.join(process.env.KUASANGSE_DETAIL_04_RUNTIME_ROOT,...process.env.DETAIL_04_TARGET.split('/'));",
      "if(!fs.existsSync(target))process.exit(1);",
      'process.stdout.write(target);',
    ].join('')], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: { ...runtime.env, DETAIL_04_TARGET: manifest.targetRelativePath },
    });

    assert.equal(runtime.detail04Fixture.targetRelativePath, manifest.targetRelativePath);
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stdout, copiedPath);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(copiedPath)).digest('hex').toUpperCase(), manifest.fixtureSha256);
    assert.deepEqual(
      fs.readdirSync(runtime.runtimeRoot, { recursive: true })
        .filter(relativePath => fs.statSync(path.join(runtime.runtimeRoot, relativePath)).isFile())
        .map(relativePath => relativePath.replace(/\\/g, '/')),
      [manifest.targetRelativePath],
    );
    assert.equal(fs.existsSync(rootSourcePath), rootSourceExists);
    if (rootSourceExists) {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(rootSourcePath)).digest('hex').toUpperCase(), rootSourceHash);
      assert.equal(fs.statSync(rootSourcePath).mode & 0o777, rootSourceMode);
    }
  } catch (error) {
    caught = error;
  } finally {
    if (runtime) await stopServices(runtime.services);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(runDir), false);
  t.diagnostic('temporary task runtime removed after the pretest fixture probe');
  if (caught) throw caught;
});

test('DETAIL-04 task-owned fixture는 손상, stale GUID, 경로 탈출, root 오용에서 fail closed 한다', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-detail04-corrupt-'));
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-detail04-run-'));
  const runtimeRoot = path.join(runDir, 'task-owned-runtime');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/detail-04/manifest.json'), 'utf8'));
  t.after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(fixtureRoot, 'image.jpg'), 'corrupt fixture');
  fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
    ...manifest,
    fixtureRelativePath: 'image.jpg',
  }));

  assert.throws(
    () => prepareDetail04Fixture({
      root: runtimeRoot,
      runDir,
      fixtureRoot,
      env: { KUASANGSE_TASK_OWNED_RUNTIME: '1' },
    }),
    /DETAIL-04 fixture SHA-256 mismatch/,
  );
  fs.copyFileSync(path.resolve(__dirname, '../fixtures/detail-04/image.jpg'), path.join(fixtureRoot, 'image.jpg'));
  fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
    ...manifest,
    fixtureRelativePath: '../image.jpg',
  }));
  assert.throws(
    () => prepareDetail04Fixture({
      root: runtimeRoot,
      runDir,
      fixtureRoot,
      env: { KUASANGSE_TASK_OWNED_RUNTIME: '1' },
    }),
    /invalid DETAIL-04 fixture path/,
  );
  fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
    ...manifest,
    targetRelativePath: manifest.targetRelativePath.replace('draft_lastwork_', 'draft_stale_'),
  }));
  assert.throws(
    () => prepareDetail04Fixture({
      root: runtimeRoot,
      runDir,
      fixtureRoot,
      env: { KUASANGSE_TASK_OWNED_RUNTIME: '1' },
    }),
    /invalid DETAIL-04 fixture manifest/,
  );
  assert.throws(
    () => prepareDetail04Fixture({
      root: path.resolve(__dirname, '../..'),
      runDir,
      fixtureRoot,
      env: { KUASANGSE_TASK_OWNED_RUNTIME: '1' },
    }),
    /invalid DETAIL-04 task-owned runtime root/,
  );
});

test('앱 로더 전송이 한 번 끊겨도 제한된 자체 복구 뒤에만 최종 오류를 표시한다', () => {
  // Given: runtime manifest가 app-loader.js를 삽입하는 실제 부트스트랩을 읽는다.
  const source = fs.readFileSync(path.resolve(__dirname, '../../app.html'), 'utf8');

  // When/Then: 한 번의 정적 파일 전송 실패를 즉시 영구 실패로 만들지 않아야 한다.
  assert.match(source, /const MAX_LOADER_ATTEMPTS = 2;/);
  assert.match(source, /window\.__KUASANGSE_LOADER_BOOTSTRAP__/);
  assert.match(source, /async function loadRuntimeLoader\(manifest\)/);
  assert.match(source, /for \(let attempt = 1; attempt <= MAX_LOADER_ATTEMPTS; attempt \+= 1\)/);
  assert.match(source, /loaderUrl\.searchParams\.set\('attempt', String\(attempt\)\)/);
  assert.match(source, /bootstrapState\.status = 'retrying'/);
  assert.match(source, /bootstrapState\.status = 'failed'/);
});

test('workspace authority matrix 증거는 runtime manifest의 실제 build ID를 사용한다', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../tools/verify_workspace_authority_matrix_v240.cjs'), 'utf8');
  assert.match(source, /runtime-manifest\.json/);
  assert.match(source, /BUILD_ID/);
  assert.doesNotMatch(source, /build:\s*['"]v243['"]/);
  assert.doesNotMatch(source, /workspace-authority-matrix-v243/);
});
