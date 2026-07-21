const fs = require('fs');
const net = require('net');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
  waitForCdpPredicateWithReconnect,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CONFIGURED_CDP_URL = process.env.KUASANGSE_CDP_URL || '';
const ISOLATED_BACKEND_URL = String(process.env.KUASANGSE_BACKEND_URL || '').replace(/\/+$/, '');
const WORKFILE = path.resolve(process.env.KUASANGSE_WORKFILE || 'C:/Users/kua/Documents/수저집.kuasangse');
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const REPORT_PATH = path.join(OUT_DIR, 'workfile-import-perf-v122.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'workfile-import-perf-v122.png');
const MAX_TOTAL_MS = Number(process.env.KUASANGSE_IMPORT_MAX_TOTAL_MS || 5000);
const MAX_BLOCK_MS = Number(process.env.KUASANGSE_IMPORT_MAX_BLOCK_MS || 1000);
const MAX_SAVE_PREP_MS = Number(process.env.KUASANGSE_SAVE_PREP_MAX_TOTAL_MS || 5000);
const WAIT_TIMEOUT_MS = Number(process.env.KUASANGSE_IMPORT_WAIT_TIMEOUT_MS || 30000);
const MAX_TRANSPORT_ATTEMPTS = Math.max(1, Number(process.env.KUASANGSE_CDP_TRANSPORT_ATTEMPTS || 2) || 2);

function createIsolatedWorkfile(attemptNumber) {
  const sourceText = fs.readFileSync(WORKFILE, 'utf8');
  const sourceBundle = JSON.parse(sourceText);
  const sourceProjectId = String(
    sourceBundle?.project?.id || sourceBundle?.currentProjectId || sourceBundle?.workspaceId || '',
  ).trim();
  if (!sourceProjectId) throw new Error('Workfile project identity is missing.');
  const isolatedProjectId = `verify_import_perf_${Date.now()}_${process.pid}_${attemptNumber}`;
  const isolatedText = sourceText.split(sourceProjectId).join(isolatedProjectId);
  const isolatedDirectory = path.join(OUT_DIR, `workfile-import-perf-v122-${process.pid}-${attemptNumber}`);
  const isolatedPath = path.join(isolatedDirectory, path.basename(WORKFILE));
  fs.mkdirSync(isolatedDirectory, { recursive: true });
  fs.writeFileSync(isolatedPath, isolatedText, 'utf8');
  return Object.freeze({
    filePath: isolatedPath,
    fileBytes: Buffer.byteLength(isolatedText),
    projectId: isolatedProjectId,
  });
}

function reserveEphemeralCdpUrl() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => {
        if (error) reject(error);
        else if (!port) reject(new Error('Could not reserve an ephemeral CDP port'));
        else resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
}

async function runAttempt(attemptNumber) {
  if (!fs.existsSync(WORKFILE)) throw new Error(`Workfile not found: ${WORKFILE}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const isolatedWorkfile = createIsolatedWorkfile(attemptNumber);
  const cdpUrl = CONFIGURED_CDP_URL || await reserveEphemeralCdpUrl();
  const runtime = await ensureCdp(cdpUrl);
  let cdp = null;
  let cdpStage = 'connect';
  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    cdpStage = 'enable-page';
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (ISOLATED_BACKEND_URL) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        const isolatedBackend = ${JSON.stringify(ISOLATED_BACKEND_URL)};
        localStorage.setItem('gemini_backend_url', isolatedBackend);
        window.__workspaceAcquireDiagnostics = [];
        window.__reloadWarnings = [];
        const nativeWarn = console.warn.bind(console);
        console.warn = (...args) => {
          window.__reloadWarnings.push(args.map(value => String(value?.stack || value?.message || value)).join(' | '));
          nativeWarn(...args);
        };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input, init = {}) => {
          const rawUrl = typeof input === 'string' ? input : input?.url;
          const url = new URL(rawUrl, window.location.href);
          const defaultBackend = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '5050';
          const sameOriginApi = url.origin === window.location.origin && url.pathname.startsWith('/api/');
          const target = defaultBackend || sameOriginApi
            ? isolatedBackend + url.pathname + url.search
            : url.href;
          const isWorkspaceAcquire = url.pathname.endsWith('/api/workspace-lock/acquire');
          const record = isWorkspaceAcquire ? {
            startedAt: Math.round(performance.now()),
            sourceUrl: url.href,
            targetUrl: target,
            body: (() => { try { return JSON.parse(init?.body || '{}'); } catch (_) { return init?.body || ''; } })(),
            stack: String(new Error().stack || '').split('\\n').slice(1, 8).map(line => line.trim()),
            status: 0,
            error: '',
          } : null;
          if (record) window.__workspaceAcquireDiagnostics.push(record);
          try {
            const response = defaultBackend || sameOriginApi
              ? (typeof input === 'string'
                  ? await nativeFetch(target, init)
                  : await nativeFetch(new Request(target, input), init))
              : await nativeFetch(input, init);
            if (record) {
              record.finishedAt = Math.round(performance.now());
              record.status = Number(response.status || 0);
            }
            return response;
          } catch (error) {
            if (record) {
              record.finishedAt = Math.round(performance.now());
              record.error = String(error?.stack || error?.message || error);
            }
            throw error;
          }
        };
      })()` });
    }
    cdpStage = 'navigate';
    await cdp.send('Page.navigate', { url: APP_URL });
    cdpStage = 'wait-app-ready';
    await waitFor(cdp, '!!(window.state && window.render && window.openFactoryProjectFilePicker && window.importFactoryProjectFileBundle)', 60000);
    await waitFor(cdp, `(typeof sessionAssetsHydrated === 'undefined' || sessionAssetsHydrated) &&
      (typeof serverLastWorkHydrating === 'undefined' || !serverLastWorkHydrating)`, 120000);

    cdpStage = 'instrument-import';
    await evaluate(cdp, `(() => {
      window.__workfileImportPerf = {
        startedAt: 0,
        finishedAt: 0,
        timings: {},
        timingDetails: {},
        renderCalls: [],
        renderDetails: [],
        sectionImageCheckpoints: [],
        longTasks: [],
        eventLoopGaps: [],
        lastTickAt: 0,
        errors: [],
        warnings: [],
        savePersistentCalls: [],
        localArchivePostCount: 0,
        fileChangeCount: 0,
        inputEventFallbackUsed: false,
        sourceManifestImageTotal: 0,
        sourceManifestCurrentImageTotal: 0,
        sourcePayloadImageTotal: 0,
        sourcePayloadCurrentImageTotal: 0,
        sourcePreparedImageTotal: 0,
        sourcePreparedCurrentImageTotal: 0,
        sourcePreparedCurrentPaths: [],
        operation: {
          status: 'idle',
          dispatchedAt: 0,
          handlerStartedAt: 0,
          settledAt: 0,
          error: '',
        },
      };
      const nativeWarn = console.warn.bind(console);
      console.warn = (...args) => {
        window.__workfileImportPerf.warnings.push(args.map(value => String(value?.stack || value?.message || value)).join(' | '));
        nativeWarn(...args);
      };
      const perf = window.__workfileImportPerf;
      try {
        new PerformanceObserver(list => {
          const startedAt = Number(perf.startedAt || 0);
          const finishedAt = Number(perf.finishedAt || 0);
          if (!startedAt) return;
          perf.longTasks.push(...list.getEntries()
            .filter(entry => entry.startTime >= startedAt && (!finishedAt || entry.startTime <= finishedAt))
            .map(entry => Math.round(entry.duration)));
        }).observe({ type: 'longtask', buffered: true });
      } catch (_) {}
      perf.tickTimer = setInterval(() => {
        const now = performance.now();
        if (!perf.startedAt || perf.finishedAt) {
          perf.lastTickAt = now;
          return;
        }
        const previousTick = Number(perf.lastTickAt || perf.startedAt || now);
        perf.eventLoopGaps.push(Math.round(now - previousTick));
        perf.lastTickAt = now;
      }, 50);
      const wrap = (name, isAsync) => {
        const original = window[name];
        if (typeof original !== 'function') return;
        const trackSectionImages = [
          'applySessionAssetsPayload',
          'applyWorkspacePayload',
          'persistFactoryProjectBundleLocally',
          'refreshWorkspaceLists',
        ].includes(name);
        const sectionImageSnapshot = () => {
          if (!trackSectionImages) return null;
          const entries = Object.entries(window.state?.sectionImages || {})
            .filter(([, value]) => !!value);
          return {
            count: entries.length,
            sample: entries.slice(0, 3).map(([sectionId, value]) => ({
              sectionId,
              value: String(value).slice(0, 120),
            })),
          };
        };
        const recordTiming = started => {
          const duration = Math.round(performance.now() - started);
          perf.timings[name] = duration;
          const current = perf.timingDetails[name] || { count: 0, totalMs: 0, maxMs: 0 };
          current.count += 1;
          current.totalMs += duration;
          current.maxMs = Math.max(current.maxMs, duration);
          perf.timingDetails[name] = current;
        };
        if (isAsync) {
          window[name] = async function(...args) {
            const started = performance.now();
            const beforeSectionImages = sectionImageSnapshot();
            try { return await original.apply(this, args); }
            finally {
              recordTiming(started);
              if (trackSectionImages) {
                perf.sectionImageCheckpoints.push({ name, beforeSectionImages, afterSectionImages: sectionImageSnapshot() });
              }
            }
          };
        } else {
          window[name] = function(...args) {
            const started = performance.now();
            const beforeSectionImages = sectionImageSnapshot();
            if (name === 'savePersistentState') {
              perf.savePersistentCalls.push({
                atMs: Math.round(performance.now() - perf.startedAt),
                stack: new Error('savePersistentState invocation').stack || '',
                projectBusy: !!window.state?.projectBusy,
                restoreState: String(window.state?.workfileRestoreState || ''),
                currentProjectId: String(window.state?.currentProjectId || ''),
                contentVersion: Number(window.state?.contentVersion || 0),
                workspaceDocumentDirty: !!window.state?.workspaceDocumentDirty,
                args,
              });
            }
            try { return original.apply(this, args); }
            finally {
              recordTiming(started);
              if (trackSectionImages) {
                perf.sectionImageCheckpoints.push({ name, beforeSectionImages, afterSectionImages: sectionImageSnapshot() });
              }
            }
          };
        }
      };
      const originalParseFactoryProjectFileBundle = window.parseFactoryProjectFileBundle;
      if (typeof originalParseFactoryProjectFileBundle === 'function') {
        window.parseFactoryProjectFileBundle = function(...args) {
          const started = performance.now();
          try {
            const bundle = originalParseFactoryProjectFileBundle.apply(this, args);
            const sourceEntries = bundle?.manifest?.images?.entries || [];
            perf.sourceManifestImageTotal = Number(bundle?.manifest?.images?.total || sourceEntries.length || 0);
            perf.sourceManifestCurrentImageTotal = sourceEntries.filter(entry => window.factoryProjectFileCurrentImageEntry(entry)).length;
            const sourcePayloadManifest = window.factoryProjectFileBuildManifest(bundle?.project?.payload || {}, {
              id: bundle?.project?.id || '',
              name: bundle?.project?.name || '',
            });
            const sourcePayloadEntries = sourcePayloadManifest?.images?.entries || [];
            perf.sourcePayloadImageTotal = Number(sourcePayloadManifest?.images?.total || sourcePayloadEntries.length || 0);
            perf.sourcePayloadCurrentImageTotal = sourcePayloadEntries.filter(entry => window.factoryProjectFileCurrentImageEntry(entry)).length;
            const preparedPayload = window.prepareFactoryProjectFilePayload(bundle?.project?.payload || {}, sourcePayloadManifest);
            const preparedManifest = window.factoryProjectFileBuildManifest(preparedPayload, {
              id: bundle?.project?.id || '',
              name: bundle?.project?.name || '',
            });
            const preparedEntries = preparedManifest?.images?.entries || [];
            perf.sourcePreparedImageTotal = Number(preparedManifest?.images?.total || preparedEntries.length || 0);
            const preparedCurrentEntries = preparedEntries.filter(entry => window.factoryProjectFileCurrentImageEntry(entry));
            perf.sourcePreparedCurrentImageTotal = preparedCurrentEntries.length;
            perf.sourcePreparedCurrentPaths = preparedCurrentEntries.map(entry => entry.path);
            return bundle;
          } finally {
            perf.timings.parseFactoryProjectFileBundle = Math.round(performance.now() - started);
          }
        };
      }
      const originalImportFactoryProjectFileFromText = window.importFactoryProjectFileFromText;
      if (typeof originalImportFactoryProjectFileFromText === 'function') {
        window.importFactoryProjectFileFromText = async function(...args) {
          perf.operation.status = 'running';
          perf.operation.handlerStartedAt = performance.now();
          try {
            const result = await originalImportFactoryProjectFileFromText.apply(this, args);
            perf.operation.status = 'completed';
            return result;
          } catch (error) {
            perf.operation.status = 'error';
            perf.operation.error = error?.message || String(error);
            throw error;
          } finally {
            perf.operation.settledAt = performance.now();
            if (!perf.finishedAt) {
              const previousTick = Number(perf.lastTickAt || perf.startedAt || perf.operation.settledAt);
              perf.eventLoopGaps.push(Math.round(perf.operation.settledAt - previousTick));
              perf.lastTickAt = perf.operation.settledAt;
              perf.finishedAt = perf.operation.settledAt;
            }
          }
        };
      }
      wrap('hydrateWorkspacePayloadImageBackup', true);
      wrap('applyWorkspacePayload', false);
      wrap('validateFactoryProjectFileBundle', false);
      wrap('prepareFactoryProjectFilePayload', false);
      wrap('factoryProjectFileBuildManifest', false);
      wrap('resetLiveWorkspaceForProjectFileReplacement', false);
      wrap('factoryPrimeCurrentAssetVisualValidation', false);
      wrap('factoryWaitForVisualValidationOperation', true);
      wrap('prepareFactoryProjectBundlePersistence', false);
      wrap('compactWorkspacePayloadForStorage', false);
      wrap('selectLocalSessionPayload', false);
      wrap('applySessionAssetsPayload', false);
      wrap('sanitizeLastWorkPayloadProductScope', false);
      wrap('cloneData', false);
      wrap('normalizeFactoryState', false);
      wrap('applyProductImageBackupPayload', false);
      wrap('restoreSpecificationSizeImageFromFactory', false);
      wrap('repairRestoredSessionIdentityDrift', false);
      wrap('factoryRuntimeReplaceFactorySnapshot', false);
      wrap('factoryRuntimeInitialSnapshot', false);
      wrap('factoryRuntimeDetachedValue', false);
      wrap('factoryRecoverRestoredReviewCandidateWorkspaceScope', false);
      wrap('normalizeOptionSorterState', false);
      wrap('applyCompAnalysisSnapshot', false);
      wrap('restoreProjectFileFactoryAssetsFromPayload', false);
      wrap('syncProductImageAcrossWorkspaces', false);
      wrap('currentProductImagePayload', false);
      wrap('factoryImagePayloadFingerprint', false);
      wrap('factoryStampLockedInputImage', false);
      wrap('factoryCurrentProductIdentityMeta', false);
      wrap('factoryCurrentWorkflowRunId', false);
      wrap('factoryStartNewWorkflowRun', false);
      wrap('factorySetCurrentProductIdentity', false);
      wrap('markWorkspaceDocumentDirty', false);
      wrap('factoryArchiveCurrentInputImage', true);
      wrap('ensureCompMarketScrapeState', false);
      wrap('saveLastWorkNow', false);
      wrap('persistFactoryProjectBundleLocally', true);
      wrap('refreshWorkspaceLists', true);
      wrap('savePersistentState', false);
      const originalFetch = window.fetch;
      window.fetch = function(input, init = {}) {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        if (perf.startedAt > 0 && method === 'POST' && url.includes('/api/local-archive/assets')) {
          perf.localArchivePostCount += 1;
        }
        return originalFetch.apply(this, arguments);
      };
      const originalRender = window.render;
      window.render = function(...args) {
        const context = {
          projectBusy: !!window.state?.projectBusy,
          restoreState: window.state?.workfileRestoreState || '',
          currentProjectName: window.state?.currentProjectName || '',
          stack: new Error().stack?.split('\\n').slice(2, 7).map(line => line.trim()) || [],
        };
        const started = performance.now();
        try { return originalRender.apply(this, args); }
        finally {
          const durationMs = Math.round(performance.now() - started);
          perf.renderCalls.push(durationMs);
          perf.renderDetails.push({ ...context, durationMs });
        }
      };
      Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
      const originalInputClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function() {
        if (this.type !== 'file') return originalInputClick.call(this);
      };
      window.state.currentProjectId = '';
      window.state.currentProjectName = '__before_import__';
      window.state.productName = '';
      window.state.workspaceDocumentDirty = false;
      window.openFactoryProjectFilePicker({ skipLeaveConfirm: true });
      HTMLInputElement.prototype.click = originalInputClick;
      return !!document.querySelector('input[type="file"][accept*="kuasangse"]');
    })()`);

    cdpStage = 'set-file-input';
    const doc = await cdp.send('DOM.getDocument', { depth: 1 });
    const selected = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"][accept*="kuasangse"]',
    });
    if (!selected.nodeId) throw new Error('Workfile input not found');
    await evaluate(cdp, `(() => {
      const input = document.querySelector('input[type="file"][accept*="kuasangse"]');
      if (!input) return false;
      input.addEventListener('change', () => {
        window.__workfileImportPerf.fileChangeCount += 1;
      }, { capture: true });
      return true;
    })()`);
    await evaluate(cdp, `(() => {
      const perf = window.__workfileImportPerf;
      perf.startedAt = performance.now();
      perf.finishedAt = 0;
      perf.longTasks = [];
      perf.eventLoopGaps = [];
      perf.lastTickAt = perf.startedAt;
      perf.operation.status = 'dispatched';
      perf.operation.dispatchedAt = perf.startedAt;
      return true;
    })()`);
    await cdp.send('DOM.setFileInputFiles', { files: [isolatedWorkfile.filePath], nodeId: selected.nodeId });
    let fileChangeObserved = true;
    cdpStage = 'wait-file-change';
    cdp.close();
    cdp = null;
    try {
      const fileChangeObservation = await waitForCdpPredicateWithReconnect(cdpUrl, `
        window.__workfileImportPerf?.fileChangeCount > 0 ||
        ['running', 'completed', 'error'].includes(window.__workfileImportPerf?.operation?.status)
      `, {
        targetId: target.id,
        timeoutMs: 1500,
        commandTimeoutMs: 500,
        pollIntervalMs: 50,
      });
      cdp = fileChangeObservation.cdp;
    } catch (_) {
      fileChangeObserved = false;
    }
    if (!fileChangeObserved) {
      const fallbackConnection = await waitForCdpPredicateWithReconnect(cdpUrl, 'true', {
        targetId: target.id,
        timeoutMs: 2000,
        commandTimeoutMs: 500,
        pollIntervalMs: 50,
      });
      cdp = fallbackConnection.cdp;
      const fallbackDispatched = await evaluate(cdp, `(() => {
        const input = document.querySelector('input[type="file"][accept*="kuasangse"]');
        if (!input || !input.files?.length) return false;
        window.__workfileImportPerf.inputEventFallbackUsed = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!fallbackDispatched) throw new Error('CDP file input was set without a change event or readable file.');
    }

    cdpStage = 'wait-import-complete';
    if (cdp) cdp.close();
    cdp = null;
    try {
      const completionObservation = await waitForCdpPredicateWithReconnect(cdpUrl, `(() => {
        const perf = window.__workfileImportPerf;
        if (!perf?.operation || perf.operation.settledAt <= 0) return false;
        return !window.state.projectBusy && (
          window.state.currentProjectName === '수저집' || !!window.state.error
        );
      })()`, {
        targetId: target.id,
        timeoutMs: WAIT_TIMEOUT_MS,
        commandTimeoutMs: 2000,
        pollIntervalMs: 100,
      });
      cdp = completionObservation.cdp;
    } catch (error) {
      let terminalState = { diagnosticUnavailable: true };
      try {
        const diagnosticConnection = await waitForCdpPredicateWithReconnect(cdpUrl, 'true', {
          targetId: target.id,
          timeoutMs: 2000,
          commandTimeoutMs: 500,
          pollIntervalMs: 50,
        });
        cdp = diagnosticConnection.cdp;
        terminalState = await evaluate(cdp, `(() => ({
          currentProjectName: window.state?.currentProjectName || '',
          currentProjectId: window.state?.currentProjectId || '',
          projectBusy: !!window.state?.projectBusy,
          stateError: window.state?.error || '',
          fileChangeCount: window.__workfileImportPerf?.fileChangeCount || 0,
          inputEventFallbackUsed: !!window.__workfileImportPerf?.inputEventFallbackUsed,
          operation: window.__workfileImportPerf?.operation || null,
          timings: window.__workfileImportPerf?.timings || {},
          timingDetails: window.__workfileImportPerf?.timingDetails || {},
        }))()`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
      } catch (diagnosticError) {
        terminalState = { diagnosticUnavailable: true, error: diagnosticError.message || String(diagnosticError) };
      }
      fs.writeFileSync(REPORT_PATH, JSON.stringify({
        ok: false,
        failures: [error.message],
        attemptNumber,
        terminalState,
        screenshot: SCREENSHOT_PATH,
      }, null, 2));
      throw new Error(`${error.message}\nterminalState=${JSON.stringify(terminalState)}`);
    }
    const importTerminal = await evaluate(cdp, `(() => ({
      done: !window.state.projectBusy && window.state.currentProjectName === '수저집',
      stateError: window.state.error || '',
    }))()`);
    if (!importTerminal.done) throw new Error(`Workfile import failed: ${importTerminal.stateError || 'unknown error'}`);
    await new Promise(resolve => setTimeout(resolve, 300));

    cdpStage = 'measure-save-preparation';
    const savePreparation = await evaluate(cdp, `(async () => {
      const startedAt = performance.now();
      const bundle = await window.buildFactoryProjectFileBundle({});
      const buildMs = Math.round(performance.now() - startedAt);
      const serializeStartedAt = performance.now();
      const serialized = JSON.stringify(bundle);
      const serializeMs = Math.round(performance.now() - serializeStartedAt);
      return {
        buildMs,
        serializeMs,
        totalMs: Math.round(performance.now() - startedAt),
        fileBytes: new Blob([serialized]).size,
        manifestImageTotal: Number(bundle?.manifest?.images?.total || 0),
        manifestInlineTotal: Number(bundle?.manifest?.images?.inline || 0),
        manifestCurrentImageTotal: (bundle?.manifest?.images?.entries || [])
          .filter(entry => window.factoryProjectFileCurrentImageEntry(entry)).length,
        manifestCurrentPaths: (bundle?.manifest?.images?.entries || [])
          .filter(entry => window.factoryProjectFileCurrentImageEntry(entry))
          .map(entry => entry.path),
      };
    })()`);

    cdpStage = 'collect-proof';
    const proof = await evaluate(cdp, `(() => {
      const perf = window.__workfileImportPerf;
      clearInterval(perf.tickTimer);
      const renderTotalMs = perf.renderCalls.reduce((sum, value) => sum + value, 0);
      const maxRenderMs = Math.max(0, ...perf.renderCalls);
      const maxLongTaskMs = Math.max(0, ...perf.longTasks);
      const maxEventLoopGapMs = Math.max(0, ...perf.eventLoopGaps) - 50;
      return {
        fileName: ${JSON.stringify(path.basename(WORKFILE))},
        fileBytes: ${isolatedWorkfile.fileBytes},
        totalMs: Math.round(perf.finishedAt - perf.startedAt),
        timings: perf.timings,
        timingDetails: perf.timingDetails,
        renderCallCount: perf.renderCalls.length,
        renderDetails: perf.renderDetails,
        sectionImageCheckpoints: perf.sectionImageCheckpoints,
        renderTotalMs,
        maxRenderMs,
        longTasks: perf.longTasks,
        maxLongTaskMs,
        maxEventLoopGapMs: Math.max(0, maxEventLoopGapMs),
        warnings: perf.warnings,
        savePersistentCalls: perf.savePersistentCalls,
        projectBusy: window.state.projectBusy,
        stateError: window.state.error || '',
        storageWarning: window.state.storageWarning || '',
        storageWarningVisibleText: document.querySelector('#closeStorageWarning')?.parentElement?.innerText || '',
        staleFactoryDiagnosticLogs: (typeof factoryVisibleFactoryLogs === 'function'
          ? factoryVisibleFactoryLogs(window.state.factory || {})
          : (window.state.factory?.logs || []))
          .filter(log => /이미지 원본을 표시할 수 없어 기본 후보에서 분리|현재 작업키가 맞는 생성 결과 .*색상 차이가 있어도 기본 후보에 유지|색상 검수 (?:완료|확인 실패).*(?:현재 작업 후보로 유지|후보는 현재 작업 기준으로 유지)|(?:자동 로컬 보관|로컬 보관 목록|제품 원본 로컬 보관).*(?:Failed to fetch|fetch failed|network error)|Cafe24 OAuth.*(?:access 토큰이 만료|재연결이 필요)/i.test(String(log?.message || '')))
          .map(log => ({ message: log.message || '', type: log.type || '', stageId: log.stageId || '' })),
        imageLoadFailedAssets: (window.state.factory?.assets || [])
          .filter(asset => asset?.imageLoadFailed || asset?.metadata?.imageLoadFailed || asset?.metadata?.imageLoadFailedAt)
          .map(asset => ({ id: asset.id || '', title: asset.title || '', failedSrc: asset.imageLoadFailedSrc || asset.metadata?.imageLoadFailedSrc || '' })),
        localArchivePostCount: perf.localArchivePostCount,
        fileChangeCount: perf.fileChangeCount,
        inputEventFallbackUsed: perf.inputEventFallbackUsed,
        sourceManifestImageTotal: perf.sourceManifestImageTotal,
        sourceManifestCurrentImageTotal: perf.sourceManifestCurrentImageTotal,
        sourcePayloadImageTotal: perf.sourcePayloadImageTotal,
        sourcePayloadCurrentImageTotal: perf.sourcePayloadCurrentImageTotal,
        sourcePreparedImageTotal: perf.sourcePreparedImageTotal,
        sourcePreparedCurrentImageTotal: perf.sourcePreparedCurrentImageTotal,
        sourcePreparedCurrentPaths: perf.sourcePreparedCurrentPaths,
        currentProjectName: window.state.currentProjectName,
        currentProjectId: window.state.currentProjectId,
        factoryAssets: window.state.factory?.assets?.length || 0,
        previousFactoryAssets: window.state.factory?.previousAssets?.length || 0,
        validatedFactoryAssets: (window.state.factory?.assets || []).filter(asset => asset?.metadata?.visualValidation).length,
        appImageFingerprint: typeof window.factoryImagePayloadFingerprint === 'function'
          ? window.factoryImagePayloadFingerprint(window.state.imageBase64 || '')
          : '',
        factoryImageFingerprint: typeof window.factoryImagePayloadFingerprint === 'function'
          ? window.factoryImagePayloadFingerprint(window.state.factory?.product?.imageBase64 || '')
          : '',
        lockedInputImageFingerprint: window.state.factory?.product?.lockedInputImageFingerprint || '',
        factoryCurrentRunId: window.state.factory?.product?.currentRunId || '',
        factoryProductKey: window.state.factory?.product?.productKey || '',
        sections: Object.keys(window.state.sectionContents || {}).length,
        bodyCursor: getComputedStyle(document.body).cursor,
        memory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
        } : null,
      };
    })()`);
    proof.savePreparation = savePreparation;
    proof.missingCurrentImagePaths = proof.sourcePreparedCurrentPaths
      .filter(pathName => !proof.savePreparation.manifestCurrentPaths.includes(pathName));
    proof.preReloadRecovery = await evaluate(cdp, `(() => {
      const rawSession = window.workspaceSessionGetItem('pdp_session') || '';
      const rawBootstrap = window.workspaceSessionGetItem('pdp_last_work_bootstrap_v1') || '';
      const session = (() => { try { return JSON.parse(rawSession); } catch (_) { return null; } })();
      const bootstrap = (() => { try { return JSON.parse(rawBootstrap); } catch (_) { return null; } })();
      return {
        sessionChars: rawSession.length,
        sessionScope: session?.workspaceScope?.id || session?.workspaceScope || '',
        sessionRevision: Number(session?.workspaceRevision?.counter || 0),
        bootstrapChars: rawBootstrap.length,
        bootstrapScope: bootstrap?.workspaceScope?.id || bootstrap?.workspaceScope || '',
        bootstrapRevision: Number(bootstrap?.workspaceRevision?.counter || 0),
        bootstrapProjectId: String(bootstrap?.currentProjectId || ''),
      };
    })()`);
    proof.preReloadSessionAssets = await evaluate(cdp, `(async () => {
      try {
        const assets = await window.workspaceGetSessionAssets();
        return {
          exists: !!assets,
          currentProjectId: String(assets?.currentProjectId || ''),
          workspaceScope: String(assets?.workspaceScope?.id || assets?.workspaceScope || ''),
          workspaceRevision: assets?.workspaceRevision || null,
          persistenceAuthority: assets?.persistenceAuthority || null,
          sections: Object.keys(assets?.sectionContents || {}).length,
          sectionImages: Object.values(assets?.sectionImages || {}).filter(Boolean).length,
          imageBase64Length: String(assets?.imageBase64 || '').length,
          matchesCurrentWorkspace: assets && typeof window.lastWorkSnapshotMatchesCurrentWorkspace === 'function'
            ? window.lastWorkSnapshotMatchesCurrentWorkspace(assets)
            : null,
        };
      } catch (error) {
        return { exists: false, error: String(error?.stack || error?.message || error) };
      }
    })()`);
    proof.releaseBeforeReload = await evaluate(cdp, `(async () => {
      const coordinator = window.__KUASANGSE_WORKSPACE_LOCK__;
      const before = coordinator?.snapshot?.() || null;
      const after = coordinator?.release ? await coordinator.release() : null;
      return {
        beforeMode: String(before?.mode || ''),
        beforeScopeId: String(before?.scopeId || ''),
        beforeRevision: Number(before?.revision || 0),
        afterMode: String(after?.mode || ''),
        afterScopeId: String(after?.scopeId || ''),
      };
    })()`);
    cdpStage = 'reload-after-import';
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryVisibleFactoryLogs)', 60000);
    await waitFor(cdp, `(typeof sessionAssetsHydrated === 'undefined' || sessionAssetsHydrated) &&
      (typeof serverLastWorkHydrating === 'undefined' || !serverLastWorkHydrating)`, 120000);
    let reloadRestoreTimedOut = false;
    try {
      await waitFor(cdp, `window.state.currentProjectId === ${JSON.stringify(proof.currentProjectId)} &&
        window.state.workfileRestoreState !== 'loading' && !window.state.projectBusy`, 30000);
    } catch (_) {
      reloadRestoreTimedOut = true;
    }
    const reloadSessionAssetDiagnostic = await evaluate(cdp, `(async () => {
      try {
        const assets = await window.workspaceGetSessionAssets();
        return {
          exists: !!assets,
          currentProjectId: String(assets?.currentProjectId || ''),
          workspaceScope: String(assets?.workspaceScope?.id || assets?.workspaceScope || ''),
          workspaceRevision: assets?.workspaceRevision || null,
          persistenceAuthority: assets?.persistenceAuthority || null,
          sections: Object.keys(assets?.sectionContents || {}).length,
          sectionImages: Object.values(assets?.sectionImages || {}).filter(Boolean).length,
          imageBase64Length: String(assets?.imageBase64 || '').length,
          matchesCurrentWorkspace: assets && typeof window.lastWorkSnapshotMatchesCurrentWorkspace === 'function'
            ? window.lastWorkSnapshotMatchesCurrentWorkspace(assets)
            : null,
        };
      } catch (error) {
        return { exists: false, error: String(error?.stack || error?.message || error) };
      }
    })()`);
    const reloadProof = await evaluate(cdp, `(() => ({
      buildId: String(window.__KUASANGSE_APP_BUILD_ID__ || ''),
      workspaceAcquireDiagnostics: window.__workspaceAcquireDiagnostics || [],
      reloadWarnings: window.__reloadWarnings || [],
      currentProjectId: String(window.state.currentProjectId || ''),
      currentProjectName: String(window.state.currentProjectName || ''),
      factoryAssets: window.state.factory?.assets?.length || 0,
      previousFactoryAssets: window.state.factory?.previousAssets?.length || 0,
      sections: Object.keys(window.state.sectionContents || {}).length,
      sectionImages: Object.values(window.state.sectionImages || {}).filter(Boolean).length,
      appImageFingerprint: typeof window.factoryImagePayloadFingerprint === 'function'
        ? window.factoryImagePayloadFingerprint(window.state.imageBase64 || '')
        : '',
      lockedInputImageFingerprint: String(window.state.factory?.product?.lockedInputImageFingerprint || ''),
      factoryCurrentRunId: String(window.state.factory?.product?.currentRunId || ''),
      factoryProductKey: String(window.state.factory?.product?.productKey || ''),
      storageWarning: String(window.state.storageWarning || ''),
      storageWarningVisibleText: document.querySelector('#closeStorageWarning')?.parentElement?.innerText || '',
      stateError: String(window.state.error || ''),
      recoveryLogDiagnostic: {
        activeImageRequestKeys: typeof factoryActiveImageRequestKeys !== 'undefined' ? factoryActiveImageRequestKeys.size : -1,
        activeImageStageRunKeys: typeof factoryActiveImageStageRunKeys !== 'undefined' ? factoryActiveImageStageRunKeys.size : -1,
        hasActiveRecoveryFailure: typeof factoryHasActiveRecoveryFailure === 'function'
          ? factoryHasActiveRecoveryFailure(window.state.factory || {}) : null,
        raw: (window.state.factory?.logs || []).slice(0, 20)
          .filter(log => /생성 표시|상태 복구|시간 초과|OAuth 재연결/.test(String(log?.message || '')))
          .map(log => ({ message: log.message || '', activeDiagnostic: log.activeDiagnostic === true })),
        visible: window.factoryVisibleFactoryLogs(window.state.factory || {}).slice(0, 20)
          .filter(log => /생성 표시|상태 복구|시간 초과|OAuth 재연결/.test(String(log?.message || '')))
          .map(log => ({ message: log.message || '', activeDiagnostic: log.activeDiagnostic === true })),
        rawWarns: (window.state.factory?.logs || []).slice(0, 20)
          .filter(log => String(log?.type || '') === 'warn')
          .map(log => ({ message: log.message || '', activeDiagnostic: log.activeDiagnostic === true })),
        visibleWarns: window.factoryVisibleFactoryLogs(window.state.factory || {}).slice(0, 20)
          .filter(log => String(log?.type || '') === 'warn')
          .map(log => ({ message: log.message || '', activeDiagnostic: log.activeDiagnostic === true })),
        domWarns: [...document.querySelectorAll('.factory-log-item.warn')]
          .filter(node => node.getClientRects().length > 0)
          .map(node => String(node.innerText || node.textContent || '').trim()),
      },
      restoreRefDiagnostic: (() => {
        const inline = (item, keys) => !!item && keys.some(key => !!item[key]);
        const variants = Object.values(window.state.sectionVariants || {}).flatMap(items => Array.isArray(items) ? items : []);
        const undoItems = Object.values(window.state.aiRepairUndoStack || {}).flatMap(items => Array.isArray(items) ? items : []);
        const factory = typeof factoryRuntimeReadFactory === 'function'
          ? factoryRuntimeReadFactory()
          : (window.state.factory || {});
        const sorter = window.state.optionSorter || {};
        return {
          reported: typeof countSessionAssetRestoreRefs === 'function' ? countSessionAssetRestoreRefs() : -1,
          step: String(window.state.step || ''),
          appImageBase64Length: String(window.state.imageBase64 || '').length,
          appImagePreviewLength: String(window.state.imagePreview || '').length,
          factoryProductHasImage: factory.product?.hasImage === true,
          factoryProductImageBase64Length: String(factory.product?.imageBase64 || '').length,
          factoryProductImagePreviewLength: String(factory.product?.imagePreview || '').length,
          factoryProductImageUrlLength: String(factory.product?.imageUrl || '').length,
          analysis: (window.state.analysisImages || []).filter(item => item?.hasImageData && !inline(item, ['base64', 'preview'])).length,
          detailBlocks: (window.state.detailImageBlocks || []).filter(item => item?.hasDataUrl && !item.dataUrl).length,
          variants: variants.filter(item => item?.hasImage && !item.image).length,
          undo: undoItems.filter(item => item?.hasImage && !item.image).length,
          sorterImages: (sorter.images || []).filter(item => item?.hasImageData && !inline(item, ['base64', 'preview', 'dataUrl'])).length,
          sorterResults: (sorter.optionResults || []).filter(item => item?.hasImage && !item.image).length,
          factoryInputs: (factory.product?.inputImages || []).filter(item => item?.hasImage && !inline(item, ['base64', 'preview'])).length,
          factoryAssets: (factory.assets || []).filter(item => item?.hasImage && !item.image).length,
          factoryAssetsWithAlternateSource: (factory.assets || []).filter(item => item?.hasImage && !item.image && inline(item, ['imageUrl', 'preview', 'base64', 'dataUrl', 'result'])).length,
        };
      })(),
      staleFactoryDiagnosticLogs: window.factoryVisibleFactoryLogs(window.state.factory || {})
        .filter(log => /이미지 원본을 표시할 수 없어 기본 후보에서 분리|현재 작업키가 맞는 생성 결과 .*색상 차이가 있어도 기본 후보에 유지|색상 검수 (?:완료|확인 실패).*(?:현재 작업 후보로 유지|후보는 현재 작업 기준으로 유지)|(?:자동 로컬 보관|로컬 보관 목록|제품 원본 로컬 보관).*(?:Failed to fetch|fetch failed|network error)|Cafe24 OAuth.*(?:access 토큰이 만료|재연결이 필요)/i.test(String(log?.message || '')))
        .map(log => ({ message: log.message || '', type: log.type || '', stageId: log.stageId || '' })),
      imageLoadFailedAssets: (window.state.factory?.assets || [])
        .filter(asset => asset?.imageLoadFailed || asset?.metadata?.imageLoadFailed || asset?.metadata?.imageLoadFailedAt)
        .map(asset => ({ id: asset.id || '', title: asset.title || '' })),
      bodyCursor: getComputedStyle(document.body).cursor,
      restoreTimedOut: ${reloadRestoreTimedOut},
    }))()`);
    reloadProof.sessionAssetDiagnostic = reloadSessionAssetDiagnostic;

    cdpStage = 'capture-screenshot';
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: proof.totalMs <= MAX_TOTAL_MS, message: `작업파일 불러오기 총 시간이 ${proof.totalMs}ms로 ${MAX_TOTAL_MS}ms를 초과했습니다.` },
      { ok: proof.maxEventLoopGapMs <= MAX_BLOCK_MS, message: `메인 스레드 최대 정지가 ${proof.maxEventLoopGapMs}ms로 ${MAX_BLOCK_MS}ms를 초과했습니다.` },
      { ok: proof.savePreparation.totalMs <= MAX_SAVE_PREP_MS, message: `작업파일 저장 준비 시간이 ${proof.savePreparation.totalMs}ms로 ${MAX_SAVE_PREP_MS}ms를 초과했습니다.` },
      { ok: proof.savePreparation.fileBytes > 10000000 && proof.savePreparation.manifestInlineTotal > 0, message: '저장 성능 검증용 작업파일 번들에 실제 이미지 데이터가 포함되지 않았습니다.' },
      { ok: proof.savePreparation.manifestCurrentImageTotal >= proof.sourcePreparedCurrentImageTotal, message: `현재 작업 이미지 manifest가 복원 기준 ${proof.sourcePreparedCurrentImageTotal}개에서 저장 준비 후 ${proof.savePreparation.manifestCurrentImageTotal}개로 줄었습니다.` },
      { ok: proof.currentProjectName === '수저집' && proof.factoryAssets === 6 && proof.previousFactoryAssets === 40 && proof.sections === 15, message: '현재 후보와 이전 작업 결과가 작업 범위대로 분리 복원되지 않았습니다.' },
      { ok: proof.validatedFactoryAssets === 6, message: '현재 실행 범위 후보의 검증 정보가 불러오기 과정에서 사라졌습니다.' },
      { ok: !!proof.factoryCurrentRunId && !!proof.factoryProductKey, message: '작업파일의 현재 runId/productKey가 복원되지 않았습니다.' },
      { ok: !!proof.appImageFingerprint && proof.appImageFingerprint === proof.lockedInputImageFingerprint, message: '복원된 기본 이미지 fingerprint가 작업파일 identity와 다릅니다.' },
      { ok: proof.localArchivePostCount === 0, message: `작업파일 불러오기 중 입력 이미지를 로컬 아카이브에 ${proof.localArchivePostCount}회 중복 저장했습니다.` },
      { ok: !proof.stateError, message: `작업파일 불러오기 후 오류 상태가 남았습니다: ${proof.stateError}` },
      { ok: !proof.storageWarning && !proof.storageWarningVisibleText, message: `성공한 작업파일 불러오기 뒤 이전 세션 저장 경고가 남았습니다: ${proof.storageWarning || proof.storageWarningVisibleText}` },
      { ok: proof.staleFactoryDiagnosticLogs.length === 0, message: `성공한 작업파일 불러오기 뒤 해결된 이미지 진단 로그가 ${proof.staleFactoryDiagnosticLogs.length}개 남았습니다.` },
      { ok: proof.imageLoadFailedAssets.length === 0, message: `성공한 작업파일 불러오기 뒤 재시도되지 않은 이미지 표시 실패가 ${proof.imageLoadFailedAssets.length}개 남았습니다.` },
      { ok: proof.projectBusy === false, message: '불러오기 완료 후 projectBusy가 해제되지 않았습니다.' },
      { ok: proof.bodyCursor === 'auto', message: `불러오기 완료 후 마우스 커서가 ${proof.bodyCursor} 상태로 남았습니다.` },
      { ok: proof.releaseBeforeReload.beforeMode === 'editing' && proof.releaseBeforeReload.afterMode === 'released', message: `새로고침 전 편집권 반납에 실패했습니다: ${JSON.stringify(proof.releaseBeforeReload)}` },
      { ok: reloadProof.currentProjectId === proof.currentProjectId && reloadProof.currentProjectName === proof.currentProjectName, message: `새로고침 후 작업파일 식별자가 달라졌습니다: ${reloadProof.currentProjectId}/${reloadProof.currentProjectName}` },
      { ok: reloadProof.restoreTimedOut === false, message: `새로고침 복원이 제한 시간 안에 완료되지 않았습니다: ${JSON.stringify(proof.preReloadRecovery)}` },
      { ok: reloadProof.factoryAssets === proof.factoryAssets && reloadProof.previousFactoryAssets === proof.previousFactoryAssets && reloadProof.sections === proof.sections, message: `새로고침 후 현재/이전 후보 또는 섹션 수가 달라졌습니다: ${JSON.stringify(reloadProof)}` },
      { ok: reloadProof.sectionImages > 0, message: '새로고침 후 상세 섹션 이미지가 복원되지 않았습니다.' },
      { ok: !!reloadProof.appImageFingerprint && reloadProof.appImageFingerprint === reloadProof.lockedInputImageFingerprint, message: '새로고침 후 기본 이미지 fingerprint가 작업파일 identity와 다릅니다.' },
      { ok: reloadProof.factoryCurrentRunId === proof.factoryCurrentRunId && reloadProof.factoryProductKey === proof.factoryProductKey, message: '새로고침 후 runId/productKey가 달라졌습니다.' },
      { ok: !reloadProof.storageWarning && !reloadProof.storageWarningVisibleText && !reloadProof.stateError, message: `새로고침 후 오류/세션 경고가 나타났습니다: ${reloadProof.stateError || reloadProof.storageWarning || reloadProof.storageWarningVisibleText}` },
      { ok: reloadProof.staleFactoryDiagnosticLogs.length === 0 && reloadProof.imageLoadFailedAssets.length === 0, message: `새로고침 후 해결된 진단이 다시 나타났습니다: ${JSON.stringify(reloadProof)}` },
      { ok: reloadProof.bodyCursor === 'auto', message: `새로고침 후 마우스 커서가 ${reloadProof.bodyCursor} 상태로 남았습니다.` },
    ];
    const report = {
      ok: checks.every(check => check.ok),
      failures: checks.filter(check => !check.ok).map(check => check.message),
      attemptNumber,
      transportRetries: attemptNumber - 1,
      cdpUrl,
      thresholds: { MAX_TOTAL_MS, MAX_BLOCK_MS, MAX_SAVE_PREP_MS },
      proof,
      reloadProof,
      screenshot: SCREENSHOT_PATH,
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reportPath: REPORT_PATH, ...report }, null, 2));

    assertChecks(checks);
  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, 100));
    let currentTargets = [];
    let pageState = null;
    try {
      pageState = cdp ? await evaluate(cdp, `({
        error: window.state?.error || '',
        backendBaseUrl: window.state?.backendBaseUrl || '',
        authority: typeof currentWorkspaceAuthority === 'function' ? currentWorkspaceAuthority() : null,
        projectBusy: !!window.state?.projectBusy,
        restoreState: window.state?.workfileRestoreState || '',
        currentProjectId: window.state?.currentProjectId || '',
        currentProjectName: window.state?.currentProjectName || '',
        operation: window.__workfileImportPerf?.operation || null,
        timings: window.__workfileImportPerf?.timings || {},
        timingDetails: window.__workfileImportPerf?.timingDetails || {},
        renderDetails: window.__workfileImportPerf?.renderDetails || [],
      })`) : null;
    } catch (_) {}
    try {
      const response = await fetch(`${cdpUrl}/json`);
      if (response.ok) {
        const targets = await response.json();
        currentTargets = (Array.isArray(targets) ? targets : []).map(target => ({
          id: target.id,
          type: target.type,
          title: target.title,
          url: target.url,
        }));
      }
    } catch (_) {}
    const diagnostics = {
      stage: cdpStage,
      cdpUrl,
      pageState,
      currentTargets,
      runtime: typeof runtime.diagnostics === 'function' ? runtime.diagnostics() : { launched: runtime.launched },
    };
    throw new Error(`${error.message}\ncdpDiagnostics=${JSON.stringify(diagnostics)}`);
  } finally {
    if (cdp) cdp.close();
    await runtime.cleanup();
  }
}

async function main() {
  let lastError = null;
  for (let attemptNumber = 1; attemptNumber <= MAX_TRANSPORT_ATTEMPTS; attemptNumber += 1) {
    try {
      return await runAttempt(attemptNumber);
    } catch (error) {
      lastError = error;
      const transportError = /CDP WebSocket (?:error|closed)|CDP command timed out/i.test(String(error?.message || error));
      if (!transportError || attemptNumber >= MAX_TRANSPORT_ATTEMPTS) throw error;
      console.warn(`CDP transport retry ${attemptNumber}/${MAX_TRANSPORT_ATTEMPTS - 1}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  throw lastError || new Error('Workfile performance verification did not run.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
