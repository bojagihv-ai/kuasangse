(function () {
  const MANIFEST_URL = 'src/runtime-manifest.json';
  const BOOTSTRAP_MODULE = 'src/shell/bootstrap.mjs';
  const CLASSIC_RUNTIME_REQUEST_EVENT = 'kuasangse:classic-runtime-request';
  const CLASSIC_RUNTIME_RESPONSE_EVENT = 'kuasangse:classic-runtime-response';
  const CLASSIC_RUNTIME_RESPONSE_TIMEOUT_MS = 5000;
  const CLASSIC_RUNTIME_HYDRATION_TIMEOUT_MS = 120000;
  const CLASSIC_RUNTIME_FACTORY_COMMAND_TIMEOUT_MS = 3600000;
  const RUNTIME_BUILD_CHECK_INTERVAL_MS = 15000;
  const loadErrors = [];
  let classicRuntimeRequestSequence = 0;
  let runtimeBuildGuardDisposer = null;

  function freezeOperationalValue(value) {
    if (typeof value === 'function') throw new TypeError('operational metadata cannot contain functions');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Object.freeze(value.map(freezeOperationalValue));
    const detached = {};
    for (const [key, child] of Object.entries(value)) {
      detached[key] = freezeOperationalValue(child);
    }
    return Object.freeze(detached);
  }

  function publishOperationalMetadata(name, value) {
    const frozen = freezeOperationalValue(value);
    const existing = Object.getOwnPropertyDescriptor(window, name);
    if (existing?.configurable === false) return existing.value;
    Object.defineProperty(window, name, {
      value: frozen,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return frozen;
  }

  function frozenLoadErrorsSnapshot() {
    return freezeOperationalValue(loadErrors);
  }

  Object.defineProperty(window, '__KUASANGSE_LOAD_ERRORS__', {
    get: frozenLoadErrorsSnapshot,
    enumerable: false,
    configurable: false,
  });
  window.addEventListener('error', event => {
    loadErrors.push({
      message: String(event.message || 'script error'),
      source: String(event.filename || ''),
      line: Number(event.lineno || 0),
      column: Number(event.colno || 0),
    });
    if (loadErrors.length > 20) loadErrors.shift();
  });

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character] || character));
  }

  function showLoadStatus(message) {
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = `
      <div style="max-width:720px;margin:48px auto;padding:18px;border:1px solid rgba(99,102,241,.35);border-radius:12px;background:#11131f;color:#e5e7eb;font-family:system-ui,'Malgun Gothic',sans-serif">
        <h1 style="font-size:20px;margin:0 0 8px">상세페이지 자동 생성기 로딩 중</h1>
        <p style="margin:0;color:#a5b4fc;line-height:1.6">${escapeHtml(message)}</p>
      </div>`;
  }

  function showLoadError(error) {
    console.error('앱 스크립트 로드 실패', error);
    const root = document.getElementById('app');
    if (!root) return;
    const message = String(error?.message || error);
    root.innerHTML = `
      <div style="max-width:720px;margin:48px auto;padding:18px;border:1px solid rgba(239,68,68,.5);border-radius:12px;background:#1f1115;color:#fee2e2;font-family:system-ui,'Malgun Gothic',sans-serif">
        <h1 style="font-size:20px;margin:0 0 8px">앱 스크립트 로드 실패</h1>
        <p style="margin:0 0 10px;color:#fecaca">실행 매니페스트 또는 앱 파일을 불러오지 못했습니다. 로컬 서버를 확인한 뒤 새로고침해주세요.</p>
        <pre style="white-space:pre-wrap;font-size:12px;color:#fca5a5">${escapeHtml(message)}</pre>
        <button type="button" onclick="location.reload()" style="margin-top:12px;border:1px solid rgba(248,113,113,.45);background:#2a1620;color:#fee2e2;border-radius:8px;padding:8px 12px;cursor:pointer">새로고침</button>
      </div>`;
  }

  const RUNTIME_BOOT_CACHE_TOKEN = `boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function resourceUrl(file, buildId) {
    const url = new URL(file, document.baseURI);
    url.searchParams.set('v', buildId);
    url.searchParams.set('boot', RUNTIME_BOOT_CACHE_TOKEN);
    return url.href;
  }

  function installRuntimeImportMap(files, buildId) {
    const imports = Object.fromEntries([...new Set(files.filter(Boolean))].map(file => [
      new URL(file, document.baseURI).href,
      resourceUrl(file, buildId),
    ]));
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.dataset.kuasangseRuntimeImportMap = buildId;
    importMap.textContent = JSON.stringify({ imports });
    document.head.appendChild(importMap);
    return importMap;
  }

  function preloadRuntimeBundle(file, buildId) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = resourceUrl(file, buildId);
    document.head.appendChild(link);
    return link;
  }

  function workspaceAuthorityServerBases() {
    let configured = '';
    try { configured = String(localStorage.getItem('gemini_backend_url') || '').trim(); } catch (_) {}
    return [...new Set([
      configured.replace(/\/+$/, ''),
      String(location.origin || '').replace(/\/+$/, ''),
      'http://127.0.0.1:5050',
      'http://localhost:5050',
    ].filter(Boolean))];
  }

  async function readManifest() {
    const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${MANIFEST_URL} HTTP ${response.status}`);
    return response.json();
  }

  function validateManifest(manifest) {
    if (!manifest || manifest.schema !== 'kuasangse.runtime.v1') throw new Error('지원하지 않는 runtime manifest입니다.');
    if (!String(manifest.buildId || '').trim()) throw new Error('runtime manifest buildId가 비어 있습니다.');
    if (!manifest.bundle || !manifest.authorityModule || !Array.isArray(manifest.modules) || !Array.isArray(manifest.scripts)) throw new Error('runtime manifest 파일 목록이 올바르지 않습니다.');
    return manifest;
  }

  function freezeRuntimeManifest(manifest) {
    return Object.freeze({
      ...manifest,
      modules: Object.freeze(manifest.modules.slice()),
      scripts: Object.freeze(manifest.scripts.slice()),
    });
  }

  function loadExternalScript(file, buildId) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = resourceUrl(file, buildId);
      script.dataset.kuasangseSource = file;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`${file} 로드 실패`)), { once: true });
      document.body.appendChild(script);
    });
  }

  function requestClassicRuntime(command, payload = null) {
    const requestId = `loader-${Date.now()}-${classicRuntimeRequestSequence += 1}`;
    const timeoutMs = ['factory-cafe24-command', 'factory-control-command'].includes(command)
      ? CLASSIC_RUNTIME_FACTORY_COMMAND_TIMEOUT_MS
      : command === 'hydrate' || command === 'workspace-reload'
        ? CLASSIC_RUNTIME_HYDRATION_TIMEOUT_MS
        : CLASSIC_RUNTIME_RESPONSE_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        window.removeEventListener(CLASSIC_RUNTIME_RESPONSE_EVENT, onResponse);
        callback(value);
      };
      const onResponse = event => {
        const response = event?.detail;
        if (!response || response.requestId !== requestId) return;
        if (response.ok === true) {
          finish(resolve, response.value);
          return;
        }
        finish(reject, new Error(String(response.error || `classic runtime ${command} failed`)));
      };
      const timeoutId = window.setTimeout(() => {
        finish(reject, new Error(`classic runtime endpoint did not respond: ${command}`));
      }, timeoutMs);
      window.addEventListener(CLASSIC_RUNTIME_RESPONSE_EVENT, onResponse);
      window.dispatchEvent(new CustomEvent(CLASSIC_RUNTIME_REQUEST_EVENT, {
        detail: Object.freeze({ requestId, command, payload }),
      }));
    });
  }

  function runtimeBuildId(manifest) {
    return String(manifest?.buildId || '').trim();
  }

  // buildId 만으로는 '같은 번호, 다른 내용' 을 구분하지 못한다.
  // buildId 카운터는 git 이 추적하는 매니페스트 안에 있어서 되돌리기 한 번에 되감기고,
  // 그러면 이미 쓴 번호가 다른 내용으로 다시 발급된다. 그때 이 가드는
  // nextBuildId === currentBuildId 라 영원히 침묵하고, 탭은 낡은 코드를 계속 돌린다.
  // 내용 지문을 함께 봐서 그 침묵 구간을 없앤다. 지문이 없는 매니페스트는 예전처럼 동작한다.
  function runtimeBuildSignature(manifest) {
    const buildId = runtimeBuildId(manifest);
    if (!buildId) return '';
    const digest = String(manifest?.sourceDigest || '').trim();
    return digest ? `${buildId}@${digest}` : buildId;
  }

  function showRuntimeStaleGate(currentBuildId, nextBuildId) {
    if (document.getElementById('kuasangseRuntimeStaleGate')) return;
    document.documentElement.dataset.kuasangseRuntimeStale = '1';
    const gate = document.createElement('div');
    gate.id = 'kuasangseRuntimeStaleGate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'kuasangseRuntimeStaleTitle');
    gate.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;background:rgba(4,6,14,.88);backdrop-filter:blur(5px);font-family:system-ui,\'Malgun Gothic\',sans-serif';
    gate.innerHTML = `<div style="width:min(560px,100%);box-sizing:border-box;padding:22px;border:1px solid rgba(99,102,241,.65);border-radius:14px;background:#11131f;color:#e5e7eb;box-shadow:0 24px 80px rgba(0,0,0,.52)">
      <div id="kuasangseRuntimeStaleTitle" style="font-size:19px;font-weight:900">새 빌드가 적용되었습니다</div>
      <p style="margin:9px 0 0;color:#c7d2fe;line-height:1.6">이 탭은 이전 코드(${escapeHtml(currentBuildId)})로 열려 있어 잘못된 클릭 처리를 막았습니다. 현재 작업을 저장한 뒤 새 코드(${escapeHtml(nextBuildId)})로 다시 엽니다.</p>
      <button id="kuasangseApplyNewBuild" type="button" style="width:100%;margin-top:16px;border:0;border-radius:9px;padding:11px 14px;background:#6366f1;color:white;font-size:14px;font-weight:900;cursor:pointer">새 빌드 적용</button>
    </div>`;
    const applyButton = gate.querySelector('#kuasangseApplyNewBuild');
    applyButton?.addEventListener('click', async () => {
      applyButton.disabled = true;
      applyButton.textContent = '현재 작업 저장 후 새로고침 중...';
      try {
        if (typeof window.flushLastWorkBeforeRuntimeReload !== 'function') {
          throw new Error('현재 작업 저장 경로를 사용할 수 없습니다.');
        }
        const saved = await window.flushLastWorkBeforeRuntimeReload();
        if (saved !== true) throw new Error('현재 작업 저장 결과를 확인하지 못했습니다.');
      } catch (_) {
        applyButton.disabled = false;
        applyButton.textContent = '현재 작업 저장 실패 · 새로고침 안 함';
        applyButton.setAttribute('aria-label', '현재 작업 저장에 실패해 새로고침을 중단했습니다.');
        return;
      }
      window.location.reload();
    });
    document.body.appendChild(gate);
    applyButton?.focus();
  }

  // currentSignature 를 주면 내용 지문까지 비교한다. 주지 않으면 buildId 만 보던
  // 예전 동작 그대로다(하위 호환).
  function installRuntimeBuildFreshnessGuard(currentBuildId, options = {}, currentSignature = '') {
    const windowObject = options.windowObject || window;
    const documentObject = options.documentObject || document;
    const read = options.readManifest || readManifest;
    const onStale = options.onStale || showRuntimeStaleGate;
    const intervalMs = Math.max(1000, Number(options.intervalMs || RUNTIME_BUILD_CHECK_INTERVAL_MS));
    let disposed = false;
    let checking = false;
    let stale = false;
    const checkNow = async () => {
      if (disposed || stale || checking) return stale;
      checking = true;
      try {
        const nextManifest = await read();
        const nextBuildId = runtimeBuildId(nextManifest);
        if (!nextBuildId) return false;
        // 비교는 지문까지 포함해서 하고, 사람에게 보여주는 것은 번호 그대로 둔다.
        const baseline = currentSignature || currentBuildId;
        const nextSignature = currentSignature ? runtimeBuildSignature(nextManifest) : nextBuildId;
        if (nextSignature === baseline) return false;
        stale = true;
        onStale(currentBuildId, nextBuildId);
        return true;
      } catch (_) {
        return false;
      } finally {
        checking = false;
      }
    };
    const onFocus = () => { void checkNow(); };
    const onVisibilityChange = () => {
      if (documentObject.visibilityState === 'visible') void checkNow();
    };
    windowObject.addEventListener('focus', onFocus);
    documentObject.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = windowObject.setInterval(() => {
      if (documentObject.visibilityState === 'hidden') return;
      void checkNow();
    }, intervalMs);
    return Object.freeze({
      checkNow,
      dispose() {
        if (disposed) return;
        disposed = true;
        windowObject.clearInterval(intervalId);
        windowObject.removeEventListener('focus', onFocus);
        documentObject.removeEventListener('visibilitychange', onVisibilityChange);
      },
    });
  }

  async function loadApp() {
    try {
      const manifest = freezeRuntimeManifest(validateManifest(await readManifest()));
      const buildId = String(manifest.buildId).trim();
      preloadRuntimeBundle(manifest.bundle, buildId);
      installRuntimeImportMap(
        [BOOTSTRAP_MODULE, manifest.authorityModule, ...manifest.modules],
        buildId,
      );
      publishOperationalMetadata('__KUASANGSE_RUNTIME_MANIFEST__', manifest);
      publishOperationalMetadata('__KUASANGSE_APP_BUILD_ID__', buildId);
      showLoadStatus('모듈과 앱 스크립트를 불러오는 중입니다…');

      const bootstrapNamespace = await import(resourceUrl(BOOTSTRAP_MODULE, buildId));
      const createBootstrapCoordinator = bootstrapNamespace.createBootstrapCoordinator;
      if (typeof createBootstrapCoordinator !== 'function') {
        throw new Error('createBootstrapCoordinator export가 없습니다.');
      }
      const isBatchWorker = new URL(location.href).searchParams.get('batchWorker') === '1';
      let loadedModules = null;
      const hydrationEnvelope = Object.freeze({
        schema: 'kuasangse.app-state',
        version: 'app-state:v1',
        state: Object.freeze({}),
      });
      const coordinator = createBootstrapCoordinator({
        authority: async () => {
          const authorityNamespace = await import(resourceUrl(manifest.authorityModule, buildId));
          if (typeof authorityNamespace.installWorkspaceLock !== 'function') {
            throw new Error('installWorkspaceLock export가 없습니다.');
          }
          authorityNamespace.installWorkspaceLock(window, {
            reloadAccepted: accepted => requestClassicRuntime('workspace-reload', accepted),
            serverBases: workspaceAuthorityServerBases,
            ttlMs: isBatchWorker ? 120_000 : undefined,
          });
        },
        modules: async () => {
          const entries = await Promise.all(manifest.modules.map(async file => Object.freeze([
            file,
            file === BOOTSTRAP_MODULE
              ? bootstrapNamespace
              : await import(resourceUrl(file, buildId)),
          ])));
          loadedModules = Object.freeze(Object.fromEntries(entries));
        },
        bundleCompat: async () => {
          await loadExternalScript(manifest.bundle, buildId);
          publishOperationalMetadata(
            '__KUASANGSE_BUNDLE_METADATA__',
            window.__KUASANGSE_BUNDLE_METADATA__,
          );
        },
        installMenuModules: () => requestClassicRuntime('menu-install', loadedModules),
        hydrate: envelope => requestClassicRuntime('hydrate', envelope),
        render: () => requestClassicRuntime('render', isBatchWorker ? { mode: 'batch-worker' } : null),
        hydrationEnvelope,
      });
      const bootStatus = await coordinator.boot();
      if (bootStatus.phase !== 'ready' || bootStatus.ready !== true) {
        throw new Error('bootstrap coordinator가 ready 상태를 반환하지 않았습니다.');
      }

      if (!isBatchWorker) {
        if (runtimeBuildGuardDisposer) runtimeBuildGuardDisposer();
        const runtimeBuildGuard = installRuntimeBuildFreshnessGuard(
          buildId, {}, runtimeBuildSignature(manifest),
        );
        runtimeBuildGuardDisposer = runtimeBuildGuard.dispose;
        void runtimeBuildGuard.checkNow();
      }

      if (isBatchWorker) {
        const workerRoot = document.getElementById('app');
        if (workerRoot) {
          workerRoot.innerHTML = `
            <main class="batch-worker-shell" aria-live="polite" style="box-sizing:border-box;padding-inline-start:var(--space-2, 8px);padding-inline-end:var(--space-2, 8px);">
              <strong>생산관제 워커 실행 중</strong>
              <span>백그라운드 명령·상태 동기화만 수행합니다.</span>
            </main>
          `;
        }
        const workerSearchParams = new URL(location.href).searchParams;
        const workerApiUrl = new URL(
          workerSearchParams.get('controlTowerBase') || 'http://127.0.0.1:5062',
          location.origin,
        );
        if (
          workerApiUrl.protocol !== 'http:'
          || !['127.0.0.1', 'localhost'].includes(workerApiUrl.hostname)
        ) {
          throw new Error('batch worker controlTowerBase는 loopback HTTP 주소만 허용합니다.');
        }
        const workerNamespace = loadedModules?.['src/modules/batch-control-worker.mjs'];
        const timerNamespace = loadedModules?.['src/modules/unthrottled-interval.mjs'];
        const cafe24BridgeNamespace = loadedModules?.['src/modules/factory-cafe24-command-bridge.mjs'];
        const factoryControlBridgeNamespace = loadedModules?.['src/modules/factory-control-command-bridge.mjs'];
        if (typeof workerNamespace?.installBatchControlWorker !== 'function') {
          throw new Error('batch-control-worker capability가 매니페스트에서 발견되지 않았습니다.');
        }
        if (typeof cafe24BridgeNamespace?.installFactoryCafe24CommandBridge !== 'function') {
          throw new Error('factory-cafe24 command bridge capability가 매니페스트에서 발견되지 않았습니다.');
        }
        if (typeof factoryControlBridgeNamespace?.installFactoryControlCommandBridge !== 'function') {
          throw new Error('factory-control command bridge capability가 매니페스트에서 발견되지 않았습니다.');
        }
        cafe24BridgeNamespace.installFactoryCafe24CommandBridge(window, {
          requestClassicRuntime: payload => requestClassicRuntime('factory-cafe24-command', payload),
        });
        factoryControlBridgeNamespace.installFactoryControlCommandBridge(window, {
          requestClassicRuntime: payload => requestClassicRuntime('factory-control-command', payload),
        });
        const cafe24CommandBridge = window.__KUASANGSE_BATCH_CONTROL_COMMAND_BRIDGE__;
        const factoryControlCommandBridge = window.__KUASANGSE_FACTORY_CONTROL_COMMAND_BRIDGE__;
        const commandBridge = Object.freeze({
          inspect: (...args) => cafe24CommandBridge.inspect(...args),
          verify: (...args) => cafe24CommandBridge.verify(...args),
          run: (kind, ...args) => (
            kind === 'factory-control'
              ? factoryControlCommandBridge.run(kind, ...args)
              : cafe24CommandBridge.run(kind, ...args)
          ),
        });
        const workerTimers = typeof timerNamespace?.createUnthrottledTimers === 'function'
          ? timerNamespace.createUnthrottledTimers(window)
          : {
            setIntervalImpl: window.setInterval.bind(window),
            clearIntervalImpl: window.clearInterval.bind(window),
          };
        const workerReceipt = workerNamespace.installBatchControlWorker(window, {
          apiBase: workerApiUrl.origin,
          workerId: `factory-worker-${buildId}-${RUNTIME_BOOT_CACHE_TOKEN}`,
          runtimeBuildId: buildId,
          commandBridge,
          projectionBridge: factoryControlCommandBridge,
          authorityHeartbeat: () => window.__KUASANGSE_WORKSPACE_LOCK__?.heartbeat?.(),
          fetchImpl: window.fetch.bind(window),
          // 숨은 탭에서도 시계가 멈추지 않아야 관제탑이 워커를 살아 있다고 본다.
          setIntervalImpl: workerTimers.setIntervalImpl,
          clearIntervalImpl: workerTimers.clearIntervalImpl,
        });
        workerReceipt.worker.startHeartbeat();
        workerReceipt.worker.startSessionHeartbeat();
        workerReceipt.worker.startPolling();
        workerReceipt.worker.startProjectionPolling();
      }

      const loadedAt = new Date().toISOString();
      publishOperationalMetadata('__KUASANGSE_SCRIPT_FILES__', manifest.scripts);
      publishOperationalMetadata('__KUASANGSE_CAFE24_READY__', true);
      publishOperationalMetadata('__KUASANGSE_APP_LOADER__', {
        buildId,
        loadedAt,
        bundle: manifest.bundle,
        files: manifest.scripts,
        modules: manifest.modules,
        authorityModule: manifest.authorityModule,
        loadMode: 'coordinated-manifest-bundle-no-eval',
        phase: bootStatus.phase,
        ready: bootStatus.ready,
      });
      document.documentElement.dataset.kuasangseBuildId = buildId;
      document.documentElement.dataset.kuasangseLoadedAt = loadedAt;
      document.documentElement.dataset.kuasangseCafe24Ready = '1';

      setTimeout(() => {
        const root = document.getElementById('app');
        const expectedRootSelector = isBatchWorker ? '.batch-worker-shell' : '.app';
        if (!root?.querySelector(expectedRootSelector)) {
          showLoadError(new Error('스크립트는 로드됐지만 화면 렌더가 완료되지 않았습니다.'));
        }
      }, 12000);
    } catch (error) {
      showLoadError(error);
    }
  }

  loadApp();
})();
