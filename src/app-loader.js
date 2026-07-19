(function () {
  const MANIFEST_URL = 'src/runtime-manifest.json';
  const BOOTSTRAP_MODULE = 'src/shell/bootstrap.mjs';
  const CLASSIC_RUNTIME_REQUEST_EVENT = 'kuasangse:classic-runtime-request';
  const CLASSIC_RUNTIME_RESPONSE_EVENT = 'kuasangse:classic-runtime-response';
  const CLASSIC_RUNTIME_RESPONSE_TIMEOUT_MS = 5000;
  const CLASSIC_RUNTIME_HYDRATION_TIMEOUT_MS = 120000;
  const loadErrors = [];
  let classicRuntimeRequestSequence = 0;

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

  function resourceUrl(file, buildId) {
    const url = new URL(file, document.baseURI);
    url.searchParams.set('v', buildId);
    return url.href;
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
    const timeoutMs = command === 'hydrate' || command === 'workspace-reload'
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

  async function loadApp() {
    try {
      const manifest = freezeRuntimeManifest(validateManifest(await readManifest()));
      const buildId = String(manifest.buildId).trim();
      publishOperationalMetadata('__KUASANGSE_RUNTIME_MANIFEST__', manifest);
      publishOperationalMetadata('__KUASANGSE_APP_BUILD_ID__', buildId);
      showLoadStatus('모듈과 앱 스크립트를 불러오는 중입니다…');

      const bootstrapNamespace = await import(resourceUrl(BOOTSTRAP_MODULE, buildId));
      const createBootstrapCoordinator = bootstrapNamespace.createBootstrapCoordinator;
      if (typeof createBootstrapCoordinator !== 'function') {
        throw new Error('createBootstrapCoordinator export가 없습니다.');
      }
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
        render: () => requestClassicRuntime('render'),
        hydrationEnvelope,
      });
      const bootStatus = await coordinator.boot();
      if (bootStatus.phase !== 'ready' || bootStatus.ready !== true) {
        throw new Error('bootstrap coordinator가 ready 상태를 반환하지 않았습니다.');
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
        if (!root?.querySelector('.app')) {
          showLoadError(new Error('스크립트는 로드됐지만 화면 렌더가 완료되지 않았습니다.'));
        }
      }, 12000);
    } catch (error) {
      showLoadError(error);
    }
  }

  loadApp();
})();
