const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  captureRuntimeSourceSnapshot,
  compareRuntimeSourceSnapshots,
  isRetryableInfrastructureFailure,
} = require('../../tools/run_daily_regression.cjs');
const {
  connectCdp,
  waitForCdpPredicateWithReconnect,
} = require('../../tools/factory_cdp_test_utils.cjs');

const browserStep = {
  args: ['tools/verify_factory_sample_cdp_v1.cjs'],
};

test('브라우저가 시작되기 전 발생한 CDP 연결 실패만 재시도 대상으로 분류한다', () => {
  // Given: 실제 제품 판정에 도달하기 전 CDP 연결이 끊긴 결과가 있다.
  const result = { passed: false, tail: 'CDP WebSocket error before command completed' };

  // When: 회귀 실행기의 인프라 실패 분류기를 호출한다.
  const retryable = isRetryableInfrastructureFailure(browserStep, result);

  // Then: 일시적인 브라우저 인프라 실패이므로 한 번 재시도할 수 있어야 한다.
  assert.equal(retryable, true);
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
