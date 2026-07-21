const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_CDP_COMMAND_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.KUASANGSE_CDP_COMMAND_TIMEOUT_MS || 30000) || 30000
);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

function isolatedBackendBootstrapSource() {
  const raw = process.env.KUASANGSE_BACKEND_BASE || process.env.KUASANGSE_BACKEND_URL || '';
  if (!raw) return '';
  const backendBase = new URL(raw).origin;
  return `(() => {
    const backendBase = ${JSON.stringify(backendBase)};
    try { localStorage.setItem('gemini_backend_url', backendBase); } catch (_) {}
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const url = new URL(rawUrl, window.location.href);
      const hardcodedBackend = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '5050';
      const sameOriginApi = url.origin === window.location.origin && url.pathname.startsWith('/api/');
      if (!hardcodedBackend && !sameOriginApi) return nativeFetch(input, init);
      const target = backendBase + url.pathname + url.search;
      const request = input instanceof Request ? new Request(target, input) : target;
      return nativeFetch(request, init);
    };
  })()`;
}

function connectCdp(wsUrl) {
  let nextId = 1;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  const rejectPending = (error) => {
    for (const { reject, timer } of pending.values()) {
      if (timer) clearTimeout(timer);
      try { reject(error); } catch (_) {}
    }
    pending.clear();
  };
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject, timer } = pending.get(msg.id);
    pending.delete(msg.id);
    if (timer) clearTimeout(timer);
    if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else resolve(msg.result || {});
  });
  ws.addEventListener('close', () => {
    rejectPending(new Error(`CDP WebSocket closed before command completed: ${wsUrl}`));
  });
  ws.addEventListener('error', event => {
    rejectPending(new Error(`CDP WebSocket error before command completed: ${event?.message || wsUrl}`));
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const bootstrapSource = isolatedBackendBootstrapSource();
  let bootstrapInstalled = false;
  function sendRaw(method, params = {}, timeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            reject(new Error(`CDP command timed out after ${timeoutMs}ms: ${method}`));
          }, timeoutMs)
        : null;
      pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  }
  return {
    opened,
    async send(method, params = {}, timeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS) {
      const result = await sendRaw(method, params, timeoutMs);
      if (method === 'Page.enable' && bootstrapSource && !bootstrapInstalled) {
        await sendRaw('Page.addScriptToEvaluateOnNewDocument', { source: bootstrapSource }, timeoutMs);
        bootstrapInstalled = true;
      }
      return result;
    },
    close(timeoutMs = 2000) {
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise(resolve => {
        let timer = null;
        const finish = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };
        ws.addEventListener('close', finish, { once: true });
        ws.addEventListener('error', finish, { once: true });
        timer = setTimeout(finish, Math.max(1, Number(timeoutMs) || 2000));
        try { ws.close(); } catch (_) { finish(); }
      });
    },
  };
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: legacyCdpCompatibilityExpression(expression),
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const message = [
      details.text,
      details.exception?.description,
      details.exception?.value,
    ].filter(Boolean).join('\n');
    throw new Error(message || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

function legacyCdpCompatibilityExpression(expression) {
  const source = String(expression || '').trim();
  if (!source) throw new TypeError('CDP expression is required');
  const needsLegacyAliases = /\bwindow\s*(?:\.\s*(?:state|__kuasangseState|factoryState|render)\b|\[\s*['\"](?:state|__kuasangseState|factoryState|render)['\"]\s*\])/.test(source);
  if (!needsLegacyAliases) return source;
  return `(() => {
    const __classicHydrationComplete = typeof classicRuntimeHydrationReady === 'undefined'
      || (classicRuntimeHydrationReady === true && classicRuntimeInitialRenderComplete === true);
    if (typeof window === 'undefined' || !window.__KUASANGSE_DIAGNOSTIC__ || !__classicHydrationComplete) {
      return (${source});
    }
    return ((__lexicalState, __readFactory, __replaceFactory, __lexicalRender, __root) => {
      const __clone = value => {
        if (typeof structuredClone === 'function') {
          try {
            return structuredClone(value);
          } catch (_) {
            // Diagnostic fixtures can pass a Proxy-backed legacy alias here.
          }
        }
        return JSON.parse(JSON.stringify(value));
      };
      let __factoryDraft = null;
      let __factoryBaseline = '';
      let __factoryProxyCache = new WeakMap();
      const __ensureFactoryDraft = () => {
        if (__factoryDraft) return __factoryDraft;
        __factoryDraft = __clone(__readFactory() || {});
        __factoryBaseline = JSON.stringify(__factoryDraft);
        return __factoryDraft;
      };
      const __replaceFactoryDraft = value => {
        const next = __clone(value || {});
        if (!__factoryDraft) __factoryDraft = {};
        for (const key of Reflect.ownKeys(__factoryDraft)) Reflect.deleteProperty(__factoryDraft, key);
        Object.assign(__factoryDraft, next);
        __factoryProxyCache = new WeakMap();
        __factoryBaseline = JSON.stringify(__factoryDraft);
      };
      const __refreshFactoryDraft = () => {
        if (!__factoryDraft) return false;
        if (JSON.stringify(__factoryDraft) !== __factoryBaseline) return false;
        const latest = __readFactory();
        if (JSON.stringify(latest) === __factoryBaseline) return false;
        __replaceFactoryDraft(latest);
        return true;
      };
      const __proxify = value => {
        if (!value || typeof value !== 'object') return value;
        if (__factoryProxyCache.has(value)) return __factoryProxyCache.get(value);
        const proxy = new Proxy(value, {
          get(target, key, receiver) {
            return __proxify(Reflect.get(target, key, receiver));
          },
        });
        __factoryProxyCache.set(value, proxy);
        return proxy;
      };
      const __commitFactory = () => {
        if (!__factoryDraft) return false;
        if (JSON.stringify(__factoryDraft) === __factoryBaseline) return false;
        __replaceFactory(__factoryDraft, { reason: 'legacy-cdp-test-compat' });
        __factoryBaseline = JSON.stringify(__factoryDraft);
        return true;
      };
      const state = new Proxy(__lexicalState, {
        get(target, key, receiver) {
          if (key === 'factory') {
            __ensureFactoryDraft();
            __refreshFactoryDraft();
            return __proxify(__factoryDraft);
          }
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value, receiver) {
          if (key !== 'factory') return Reflect.set(target, key, value, receiver);
          __replaceFactoryDraft(value);
          __factoryBaseline = JSON.stringify({});
          return true;
        },
      });
      const factoryState = new Proxy(function factoryState() {
        __ensureFactoryDraft();
        __refreshFactoryDraft();
        return __proxify(__factoryDraft);
      }, {
        apply() {
          __ensureFactoryDraft();
          __refreshFactoryDraft();
          return __proxify(__factoryDraft);
        },
        get(target, key, receiver) {
          if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
          __ensureFactoryDraft();
          __refreshFactoryDraft();
          return __proxify(Reflect.get(__factoryDraft, key));
        },
        set(target, key, value) {
          __ensureFactoryDraft();
          return Reflect.set(__factoryDraft, key, value);
        },
        deleteProperty(target, key) {
          __ensureFactoryDraft();
          return Reflect.deleteProperty(__factoryDraft, key);
        },
        has(target, key) {
          __ensureFactoryDraft();
          return Reflect.has(target, key) || Reflect.has(__factoryDraft, key);
        },
      });
      let __renderOverride = null;
      let __renderOverrideDepth = 0;
      const render = (...args) => {
        __commitFactory();
        let result;
        if (__renderOverride && __renderOverrideDepth === 0) {
          __renderOverrideDepth += 1;
          try {
            result = __renderOverride(...args);
          } finally {
            __renderOverrideDepth -= 1;
          }
        } else {
          result = __lexicalRender(...args);
        }
        __refreshFactoryDraft();
        return result;
      };
      const __functionCache = new WeakMap();
      const window = new Proxy(__root, {
        get(target, key, receiver) {
          if (key === 'state' || key === '__kuasangseState') return state;
          if (key === 'factoryState') return factoryState;
          if (key === 'render') return render;
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          if (__functionCache.has(value)) return __functionCache.get(value);
          const wrapped = new Proxy(value, {
            apply(fn, thisArg, args) {
              __commitFactory();
              const result = Reflect.apply(fn, thisArg === window ? target : thisArg, args);
              if (result && typeof result.then === 'function') {
                return Promise.resolve(result).then(value => {
                  __refreshFactoryDraft();
                  return value;
                });
              }
              __refreshFactoryDraft();
              return result;
            },
          });
          __functionCache.set(value, wrapped);
          return wrapped;
        },
        set(target, key, value, receiver) {
          if (key === 'render') {
            __renderOverride = typeof value === 'function' && value !== render ? value : null;
            return true;
          }
          if (key === 'state' || key === '__kuasangseState' || key === 'factoryState') return false;
          return Reflect.set(target, key, value, target);
        },
      });
      const __run = (state, factoryState, render, window) => (${source});
      const result = __run(state, factoryState, render, window);
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then(value => {
          __commitFactory();
          return value;
        });
      }
      __commitFactory();
      return result;
    })(state, factoryRuntimeReadFactory, factoryRuntimeReplaceFactorySnapshot, render, window);
  })()`;
}

function factoryCdpFixtureReadyExpression() {
  return `(() => (
    typeof state === 'object'
    && state !== null
    && typeof factoryRuntimeReadFactory === 'function'
    && typeof factoryRuntimeReplaceFactorySnapshot === 'function'
    && typeof render === 'function'
    && typeof factoryRuntimeStore === 'object'
    && factoryRuntimeStore !== null
    && typeof factoryRuntimeStore.getOperationToken === 'function'
    && classicRuntimeHydrationReady === true
    && classicRuntimeInitialRenderComplete === true
  ))()`;
}

function factoryCdpFixtureExpression(runSource) {
  const source = String(runSource || '').trim();
  if (!source) throw new TypeError('factory CDP fixture callback source is required');
  return `((run) => {
    const clone = value => typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
    const setAppState = patch => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('factory CDP app state patch must be an object');
      }
      Object.assign(state, clone(patch));
    };
    const readFactory = () => factoryRuntimeReadFactory();
    const readAppState = () => clone(state);
    const readAppWorkspaceId = () => String(state.currentProjectId || '').trim();
    const readOperationToken = () => clone(factoryRuntimeStore.getOperationToken());
    const cloneFactory = () => clone(readFactory());
    const replaceFactory = (value, options = {}) => factoryRuntimeReplaceFactorySnapshot(value, {
      reason: 'cdp-test-fixture',
      ...options,
    });
    const renderApp = () => render();
    return run(Object.freeze({
      setAppState,
      readAppState,
      readAppWorkspaceId,
      readFactory,
      readOperationToken,
      cloneFactory,
      replaceFactory,
      renderApp,
    }));
  })(${source})`;
}

async function evaluateFactoryCdpFixture(cdp, runSource, awaitPromise = true) {
  return evaluate(cdp, factoryCdpFixtureExpression(runSource), awaitPromise);
}

function isCdpTransportError(error) {
  return /CDP WebSocket (?:error|closed)|CDP command timed out/i.test(String(error?.message || error));
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = false;
    try {
      ok = await evaluate(cdp, expression);
    } catch (error) {
      if (isCdpTransportError(error)) throw error;
    }
    if (ok) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`waitFor timeout: ${expression}`);
}

async function waitForCdpPredicateWithReconnect(cdpUrl, expression, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 30000) || 30000);
  const commandTimeoutMs = Math.max(1, Number(options.commandTimeoutMs || 2000) || 2000);
  const pollIntervalMs = Math.max(0, Number(options.pollIntervalMs || 250) || 250);
  const targetId = String(options.targetId || '').trim();
  const startedAt = Date.now();
  let cdp = null;
  let reconnectCount = 0;
  let lastError = null;
  let lastValue = false;

  const closeCurrent = () => {
    if (!cdp) return;
    try { cdp.close(); } catch (_) {}
    cdp = null;
  };
  const connectCurrentTarget = async () => {
    const targets = await fetchJson(`${cdpUrl}/json`);
    const target = (Array.isArray(targets) ? targets : []).find(item =>
      item.type === 'page' && (!targetId || item.id === targetId)
    );
    if (!target?.webSocketDebuggerUrl) {
      throw new Error(`CDP page target not found: ${targetId || '(first page)'}`);
    }
    cdp = connectCdp(target.webSocketDebuggerUrl);
    let openTimer = null;
    try {
      await Promise.race([
        cdp.opened,
        new Promise((_, reject) => {
          openTimer = setTimeout(
            () => reject(new Error(`CDP connection open timed out after ${commandTimeoutMs}ms`)),
            commandTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (openTimer) clearTimeout(openTimer);
    }
  };

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (!cdp) await connectCurrentTarget();
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const response = await cdp.send('Runtime.evaluate', {
        expression: legacyCdpCompatibilityExpression(expression),
        awaitPromise: true,
        returnByValue: true,
      }, Math.min(commandTimeoutMs, remainingMs));
      if (response.exceptionDetails) {
        const detail = response.exceptionDetails.exception?.description
          || response.exceptionDetails.text
          || 'Runtime.evaluate failed';
        throw new Error(detail);
      }
      lastValue = response.result?.value;
      if (lastValue) {
        return { cdp, value: lastValue, reconnectCount, durationMs: Date.now() - startedAt };
      }
    } catch (error) {
      lastError = error;
      if (!isCdpTransportError(error) && !/CDP connection open timed out/i.test(String(error?.message || error))) {
        closeCurrent();
        throw error;
      }
      closeCurrent();
      reconnectCount += 1;
    }
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs > 0 && pollIntervalMs > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
    }
  }
  closeCurrent();
  const detail = lastError ? `; last transport error: ${lastError.message || lastError}` : '';
  throw new Error(`waitFor timeout after ${timeoutMs}ms: ${expression}; last value: ${String(lastValue)}${detail}`);
}

function chromeCandidates() {
  if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
}

function findChromeExecutable() {
  const found = chromeCandidates().find(candidate => {
    if (!candidate || /^[a-z0-9._-]+$/i.test(candidate)) return candidate;
    return fs.existsSync(candidate);
  });
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH or start CDP manually.');
  return found;
}

async function waitForCdpJson(cdpUrl, timeoutMs = 12000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetchJson(`${cdpUrl}/json`);
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw lastError || new Error(`CDP not available: ${cdpUrl}`);
}

async function ensureCdp(cdpUrl) {
  try {
    return { targets: await fetchJson(`${cdpUrl}/json`), cleanup: async () => {}, launched: false };
  } catch (_) {
    const chrome = findChromeExecutable();
    const port = new URL(cdpUrl).port || '9333';
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-cdp-'));
    const proc = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const exit = { code: null, signal: null };
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-16000);
    });
    proc.once('exit', (code, signal) => {
      exit.code = code;
      exit.signal = signal;
    });
    const diagnostics = () => ({
      launched: true,
      pid: proc.pid,
      exitCode: exit.code,
      signal: exit.signal,
      stderr: stderr.trim(),
    });
    const cleanup = async () => {
      const exited = exit.code !== null || exit.signal !== null
        ? Promise.resolve()
        : new Promise(resolve => proc.once('exit', resolve));
      try { proc.kill('SIGKILL'); } catch (_) {}
      await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try {
          await fetchJson(`${cdpUrl}/json`);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (_) {
          break;
        }
      }
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
    };
    try {
      return { targets: await waitForCdpJson(cdpUrl), cleanup, diagnostics, launched: true };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }
}

function assertChecks(checks) {
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  if (failures.length) {
    throw new Error(`Factory browser verification failed:\n- ${failures.join('\n- ')}`);
  }
}

function currentSourceBuildId(rootDir = process.cwd()) {
  const manifestPath = path.join(rootDir, 'src', 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const buildId = String(manifest.buildId || '').trim();
  if (!buildId) throw new Error(`runtime manifest buildId를 찾지 못했습니다: ${manifestPath}`);
  return buildId;
}

module.exports = {
  assertChecks,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureExpression,
  factoryCdpFixtureReadyExpression,
  legacyCdpCompatibilityExpression,
  fetchJson,
  waitFor,
  waitForCdpPredicateWithReconnect,
};
