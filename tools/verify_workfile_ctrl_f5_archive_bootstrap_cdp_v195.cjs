const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const API_ROOT = process.env.KUASANGSE_BACKEND_URL
  || process.env.KUASANGSE_BACKEND_BASE
  || 'http://127.0.0.1:5050';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'workfile-ctrl-f5-archive-bootstrap-v195.png');
const RESULT_PATH = path.join(OUT_DIR, 'workfile-ctrl-f5-archive-bootstrap-v195.json');
const AUTH_SESSION_ID = `archive-bootstrap-${process.pid}-${Date.now()}`;
const authorities = new Map();

function projectScope(workspaceId) {
  const value = String(workspaceId || '').trim();
  return value.startsWith('project:') ? value : `project:${value}`;
}

async function acquireAuthority(workspaceId) {
  const scopeId = projectScope(workspaceId);
  if (authorities.has(scopeId)) return authorities.get(scopeId);
  const body = {
    workspaceId: scopeId,
    ownerId: 'Ctrl+F5 archive regression',
    sessionId: AUTH_SESSION_ID,
    ttlMs: 120_000,
  };
  let response = await fetch(`${API_ROOT}/api/workspace-lock/acquire`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    response = await fetch(`${API_ROOT}/api/workspace-lock/takeover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, confirmed: true }),
    });
  }
  const authority = await response.json();
  if (!response.ok || authority.granted !== true) throw new Error(`편집권 취득 실패 HTTP ${response.status}`);
  authorities.set(scopeId, authority);
  return authority;
}

async function releaseAuthorities() {
  for (const authority of authorities.values()) {
    await fetch(`${API_ROOT}/api/workspace-lock/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: authority.scopeId,
        leaseId: authority.leaseId,
        fencingToken: authority.fencingToken,
      }),
    });
  }
  authorities.clear();
}

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300"><rect width="420" height="300" fill="#fff"/><rect x="40" y="32" width="340" height="236" fill="${color}"/><text x="210" y="158" text-anchor="middle" fill="#fff" font-size="24">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function imageFingerprint(dataUrl) {
  const base64 = String(dataUrl || '').replace(/^data:image\/[^;,]+;base64,/i, '');
  return `${base64.length}:${base64.slice(0, 72)}:${base64.slice(-72)}`;
}

async function saveArchiveAsset(scope, stageId, currentRunId, title, image) {
  const authority = await acquireAuthority(scope.workspaceId);
  const response = await fetch(`${API_ROOT}/api/local-archive/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: 'verify-workfile-ctrl-f5-archive-bootstrap-v195',
      ...scope,
      authorityWorkspaceId: authority.scopeId,
      leaseId: authority.leaseId,
      fencingToken: authority.fencingToken,
      expectedRevision: authority.revision,
      revision: authority.revision,
      currentRunId,
      stageId,
      asset: {
        id: `${stageId}-${currentRunId}-${title}`,
        title,
        type: 'image',
        image,
        ...scope,
        currentRunId,
        generationRunId: currentRunId,
        stageId,
        metadata: { ...scope, currentRunId, stageId },
        sourceMap: { ...scope, currentRunId, stageId },
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `아카이브 저장 실패 HTTP ${response.status}`);
  return data.archive;
}

async function reloadAndRead(cdp, expectedStageRuns) {
  const previousTimeOrigin = await evaluate(cdp, 'performance.timeOrigin');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, 60000);
  await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.factoryRestoreCurrentWorkfileLocalArchive)', 60000);
  await waitFor(cdp, factoryCdpFixtureReadyExpression(), 120000);
  const hydration = await evaluate(cdp, `(async () => (
    await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__).catch(error => ({ error: String(error) }))
  ))()`);
  try {
    await waitFor(cdp, `(() => {
      const factory = factoryRuntimeReadFactory();
      const expected = ${JSON.stringify(expectedStageRuns)};
      const assets = Array.isArray(factory.assets) ? factory.assets : [];
      return Object.entries(expected).every(([stageId, runId]) =>
        factory.archive?.stageRunIds?.[stageId] === runId &&
        (stageId === 'input' || assets.some(asset =>
          asset.stageId === stageId &&
          asset.currentRunId === runId &&
          (asset.imageUrl || asset.image) &&
          (asset.localArchive?.archiveId || asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId)
        ))
      );
    })()`, 15000);
  } catch (error) {
    const diagnostics = await evaluate(cdp, `(async () => {
      const beforeRetryFactory = factoryRuntimeReadFactory();
      const beforeRetry = {
        sessionAssetsHydrated: !!window.__KUASANGSE_SESSION_ASSETS_HYDRATED__,
        serverLastWorkHydrated: typeof serverLastWorkHydrated === 'boolean' ? serverLastWorkHydrated : null,
        serverLastWorkHydrating: typeof serverLastWorkHydrating === 'boolean' ? serverLastWorkHydrating : null,
        archiveStatus: beforeRetryFactory.archive?.localStatus || '',
        archiveError: beforeRetryFactory.archive?.localAssetsError || '',
        archiveLoading: !!beforeRetryFactory.archive?.localAssetsLoading,
        archiveCount: Array.isArray(beforeRetryFactory.archive?.localAssets)
          ? beforeRetryFactory.archive.localAssets.length
          : -1,
        stageRunIds: { ...(beforeRetryFactory.archive?.stageRunIds || {}) },
        assetCount: Array.isArray(beforeRetryFactory.assets) ? beforeRetryFactory.assets.length : -1,
        warnings: Array.isArray(window.__CTRL_F5_QA_WARNINGS__)
          ? window.__CTRL_F5_QA_WARNINGS__.slice(-20)
          : [],
        fetches: Array.isArray(window.__CTRL_F5_QA_FETCHES__)
          ? window.__CTRL_F5_QA_FETCHES__.slice(-80)
          : [],
      };
      let retry = null;
      try {
        retry = await factoryRestoreCurrentWorkfileLocalArchive({ silent: true });
      } catch (retryError) {
        retry = { error: String(retryError?.stack || retryError) };
      }
      const state = window.__kuasangseState;
      const factory = factoryRuntimeReadFactory();
      const persistenceRead = (() => {
        try {
          const raw = workspaceSessionGetItem('pdp_session');
          const value = raw ? JSON.parse(raw) : null;
          const scopeId = value?.workspaceScope?.id || '';
          return {
            rawLength: String(raw || '').length,
            currentProjectId: value?.currentProjectId || '',
            scopeId,
            candidate: value?.workspaceRevision || null,
            current: window.__KUASANGSE_WORKSPACE_REVISION__?.current?.(scopeId) || null,
            allowed: scopeId ? workspaceRevisionAllowsSnapshot(value, { scopeId, allowEqual: true }) : false,
          };
        } catch (readError) {
          return { error: String(readError?.stack || readError) };
        }
      })();
      const liveLoad = (() => {
        try {
          const value = loadPersistentSession();
          return value ? {
            currentProjectId: value.currentProjectId || '',
            workspaceScope: value.workspaceScope || '',
            revision: value.workspaceRevision || null,
          } : null;
        } catch (loadError) {
          return { error: String(loadError?.stack || loadError) };
        }
      })();
      const readSessionRecord = key => {
        try {
          const stored = JSON.parse(localStorage.getItem(key) || 'null');
          const value = stored?.schema === 'kuasangse.recovery.v1'
            ? JSON.parse(stored.value || 'null')
            : stored;
          return value ? {
            schema: stored?.schema || value?.persistenceEnvelope?.schema || '',
            workspaceScope: value.workspaceScope || value.workspaceId || '',
            currentProjectId: value.currentProjectId || '',
            currentProjectName: value.currentProjectName || '',
            revision: value.workspaceRevision || value.persistenceAuthority?.revision || null,
          } : null;
        } catch (storageError) {
          return { error: String(storageError) };
        }
      };
      return {
        beforeRetry,
        retry,
        session: readSessionRecord('pdp_session'),
        bootstrap: readSessionRecord('pdp_last_work_bootstrap_v1'),
        rawSessionLength: String(localStorage.getItem('pdp_session') || '').length,
        loadedSession: typeof _savedSession === 'object' && _savedSession ? {
          currentProjectId: _savedSession.currentProjectId || '',
          workspaceScope: _savedSession.workspaceScope || '',
          revision: _savedSession.workspaceRevision || null,
        } : null,
        persistenceRead,
        liveLoad,
        hydration: ${JSON.stringify(hydration)},
        authority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
        projectId: state.currentProjectId || '',
        productName: state.productName || '',
        productKey: window.factoryCurrentProductKey?.(factory) || '',
        fingerprint: window.factoryCurrentInputImageFingerprint?.(factory) || '',
        identity: window.factoryCurrentWorkfileArchiveIdentity?.(factory) || null,
        scopes: window.factoryCurrentWorkfileArchiveScopes?.(factory) || [],
        stageRunIds: factory.archive?.stageRunIds || {},
        localStatus: factory.archive?.localStatus || '',
        localError: factory.archive?.localAssetsError || '',
        assets: (factory.assets || []).map(asset => ({
          stageId: asset.stageId || '',
          currentRunId: asset.currentRunId || '',
          archiveId: asset.localArchive?.archiveId || asset.metadata?.localArchiveId || '',
          imageUrl: asset.imageUrl || '',
        })),
      };
    })()`);
    throw new Error(`${error.message}\nbootstrap diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  return evaluate(cdp, `(() => {
    const state = window.__kuasangseState;
    const factory = factoryRuntimeReadFactory();
    return {
      projectId: state.currentProjectId || '',
      productName: state.productName || '',
      scope: window.getCurrentLastWorkWorkspaceScope?.() || '',
      stageRunIds: { ...(factory.archive?.stageRunIds || {}) },
      assets: (factory.assets || []).map(asset => ({
        id: asset.id || '',
        title: asset.title || '',
        stageId: asset.stageId || '',
        currentRunId: asset.currentRunId || '',
        archiveId: asset.localArchive?.archiveId || asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId || '',
        imageUrl: asset.imageUrl || '',
      })),
      productImagePresent: !!(
        state.imageBase64 ||
        (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__') ||
        factory.product?.imageBase64 ||
        (factory.product?.imagePreview && factory.product.imagePreview !== '__stored_in_indexeddb__')
      ),
      localStatus: factory.archive?.localStatus || '',
      storageWarning: state.storageWarning || '',
      persisted: (() => {
        try {
          const value = JSON.parse(workspaceSessionGetItem('pdp_session') || 'null');
          return {
            currentProjectId: value?.currentProjectId || '',
            scopeId: value?.workspaceScope?.id || value?.persistenceEnvelope?.scopeId || '',
            revision: value?.workspaceRevision || value?.persistenceEnvelope?.metadata?.revision || null,
          };
        } catch (_) {
          return null;
        }
      })(),
      revisionRegistry: (() => {
        try { return JSON.parse(localStorage.getItem('kuasangse_workspace_revisions_v1') || '{}'); }
        catch (_) { return {}; }
      })(),
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seed = String(Date.now());
  const productName = `CtrlF5작업파일복원${seed}`;
  const inputImage = svgData('제품 원본', '#334155');
  const scope = {
    workspaceId: `ctrl-f5-bootstrap-v195-${seed}`,
    productName,
    productKey: productName.replace(/\s+/g, '').toLowerCase(),
    inputImageFingerprint: imageFingerprint(inputImage),
  };
  const expectedStageRuns = {
    input: `input-run-${seed}`,
    hero: `hero-run-${seed}`,
    size: `size-run-${seed}`,
    options: `options-run-${seed}`,
    cuts: `cuts-run-${seed}`,
  };
  const oldHero = await saveArchiveAsset(scope, 'hero', `hero-old-run-${seed}`, '이전 대표이미지', svgData('이전 대표', '#991b1b'));
  await new Promise(resolve => setTimeout(resolve, 1100));
  await saveArchiveAsset(scope, 'input', expectedStageRuns.input, '제품 원본 이미지', inputImage);
  await saveArchiveAsset(scope, 'hero', expectedStageRuns.hero, '현재 대표이미지 1', svgData('대표 1', '#2563eb'));
  await saveArchiveAsset(scope, 'hero', expectedStageRuns.hero, '현재 대표이미지 2', svgData('대표 2', '#1d4ed8'));
  await saveArchiveAsset(scope, 'size', expectedStageRuns.size, '현재 사이즈이미지', svgData('사이즈', '#047857'));
  await saveArchiveAsset(scope, 'options', expectedStageRuns.options, '현재 색상옵션이미지', svgData('색상옵션', '#be185d'));
  await saveArchiveAsset(scope, 'cuts', expectedStageRuns.cuts, '현재 이미지컷', svgData('이미지컷', '#0f766e'));
  await releaseAuthorities();

  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__CTRL_F5_QA_WARNINGS__ = [];
        const nativeWarn = console.warn.bind(console);
        console.warn = (...args) => {
          window.__CTRL_F5_QA_WARNINGS__.push(args.map(value => {
            if (value instanceof Error) return value.stack || value.message;
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value); } catch (_) { return String(value); }
          }).join(' '));
          nativeWarn(...args);
        };
        const nativeFetch = window.fetch.bind(window);
        window.__CTRL_F5_QA_FETCHES__ = [];
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : String(input?.url || '');
          const method = String(init?.method || 'GET').toUpperCase();
          window.__CTRL_F5_QA_FETCHES__.push({ method, url, at: Date.now() });
          if (method === 'GET' && /\\/api\\/last-work(?:[/?]|$)/.test(url)) {
            return Promise.resolve(new Response(JSON.stringify({ hasSnapshot: false }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }));
          }
          return nativeFetch(input, init);
        };
      })()`,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyCtrlF5ArchiveBootstrap=${seed}` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.saveSessionAssetsToDb)', 60000);
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 120000);

    const prepared = await evaluate(cdp, `(async () => {
      await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__).catch(() => null);
      const state = window.__kuasangseState;
      const scope = ${JSON.stringify(scope)};
      const now = Date.now();
      state.currentProjectId = scope.workspaceId;
      state.currentProjectName = scope.productName;
      state.currentProjectCreatedAt = now;
      state.productName = scope.productName;
      state.step = 'factory';
      state.imageBase64 = null;
      state.imagePreview = '__stored_in_indexeddb__';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionResults: [],
        optionLastGeneratedResultIds: [],
      });
      const factory = window.factoryState();
      window.factoryStampWorkspaceIdentity?.(factory, { projectId: scope.workspaceId, projectName: scope.productName, createdAt: now });
      factory.product.productName = scope.productName;
      factory.product.userProductName = scope.productName;
      factory.product.productKey = scope.productKey;
      factory.product.currentProductKey = scope.productKey;
      factory.product.productIdentityKey = scope.productKey;
      factory.product.lockedProductKey = scope.productKey;
      factory.product.inputImageFingerprint = scope.inputImageFingerprint;
      factory.product.lockedInputImageFingerprint = scope.inputImageFingerprint;
      factory.product.currentUploadImageFingerprint = scope.inputImageFingerprint;
      factory.product.currentRunId = '';
      factory.product.generationRunId = '';
      factory.product.imageBase64 = null;
      factory.product.imagePreview = '__stored_in_indexeddb__';
      factory.product.hasImage = true;
      factory.assets = [];
      factory.previousAssets = [];
      factory.archive = { ...(factory.archive || {}), stageRunIds: {}, localAssets: [] };
      factory.automation.currentRunId = '';
      factory.goalRun.currentRunId = '';
      Object.values(factory.stages || {}).forEach(stage => {
        stage.currentRunId = '';
        stage.latestGenerationRunId = '';
        stage.selectedAssetIds = [];
      });
      factory.automation.activeTab = 'assets';
      const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
      const authorityScope = window.getCurrentLastWorkWorkspaceScope();
      const authority = await window.ensureWorkspaceEditAuthority(authorityScope);
      if (!['editing', 'offline-edit'].includes(authority.mode) || authority.scopeId !== authorityScope) {
        throw new Error('browser branch authority acquisition failed');
      }
      const sessionAssetId = window.__KUASANGSE_WORKSPACE_PERSISTENCE__.sessionAssetId(authorityScope);
      const readRawSessionAsset = () => new Promise((resolve, reject) => {
        const open = indexedDB.open('pdp_workspace_v1', 4);
        open.onerror = () => reject(open.error || new Error('IndexedDB open failed'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('sessionAssets', 'readonly').objectStore('sessionAssets').get(sessionAssetId);
          request.onerror = () => reject(request.error || new Error('session asset read failed'));
          request.onsuccess = () => {
            resolve(request.result || null);
            db.close();
          };
        };
      });
      window.render();
      await window.saveSessionAssetsToDb();
      const rawBeforePersistent = await readRawSessionAsset();
      const persistenceRequest = window.savePersistentState({ skipVisibleSync: true });
      const persistenceWasQueued = persistenceRequest === false;
      const persistenceCompletion = persistenceWasQueued
        ? window.flushQueuedPersistentState({ skipVisibleSync: true })
        : persistenceRequest;
      const persistenceCompletionThenable = !!persistenceCompletion && typeof persistenceCompletion.then === 'function';
      if (!persistenceCompletionThenable) {
        throw new Error('savePersistentState durable completion Promise required');
      }
      const persisted = await persistenceCompletion;
      if (persisted !== true) {
        const serverState = await fetch('http://127.0.0.1:5050/api/last-work?workspaceId=' + encodeURIComponent(authorityScope), { cache: 'no-store' })
          .then(response => response.json()).catch(error => ({ error: String(error) }));
        throw new Error('savePersistentState durable commit failed: ' + JSON.stringify({
          authority: lock.snapshot(),
          storageWarning: state.storageWarning || '',
          persistenceWasQueued,
          persistentStateSaving,
          persistentStateSaveQueued,
          serverLastWorkHydrating,
          serverRevision: serverState.revision || 0,
          serverHasSnapshot: !!serverState.hasSnapshot,
        }));
      }
      const stored = await window.workspaceGet('sessionAssets', 'current');
      const rawAfterPersistent = await readRawSessionAsset();
      if (!stored) {
        throw new Error('scoped session asset was not readable after durable commit: ' + JSON.stringify({
          authority: lock.snapshot(),
          currentScope: window.getCurrentLastWorkWorkspaceScope(),
          sessionAssetId,
          storageWarning: state.storageWarning || '',
          rawBeforeRevision: rawBeforePersistent?.persistenceAuthority?.revision || 0,
          rawAfterRevision: rawAfterPersistent?.persistenceAuthority?.revision || 0,
          rawBeforeScope: rawBeforePersistent?.persistenceAuthority?.scopeId || rawBeforePersistent?.scopeId || '',
          rawAfterScope: rawAfterPersistent?.persistenceAuthority?.scopeId || rawAfterPersistent?.scopeId || '',
        }));
      }
      return {
        scope: window.getCurrentLastWorkWorkspaceScope(),
        persistenceCompletionThenable,
        persistenceWasQueued,
        currentRunId: stored.factory?.product?.currentRunId || '',
        stageRunIds: stored.factory?.archive?.stageRunIds || {},
        assetCount: stored.factory?.assets?.length || 0,
      };
    })()`);

    const first = await reloadAndRead(cdp, expectedStageRuns);
    let second;
    try {
      second = await reloadAndRead(cdp, expectedStageRuns);
    } catch (error) {
      throw new Error(`${error.message}\nfirst reload diagnostics: ${JSON.stringify(first)}`);
    }
    const oldHeroPresent = second.assets.some(asset => asset.archiveId === oldHero.archiveId);
    await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      factory.automation.activeTab = 'assets';
      window.render();
      const panel = document.getElementById('factoryAutomationAssetChooser_options');
      panel?.scrollIntoView({ block: 'center' });
      return !!panel;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const expectedScope = prepared.scope;
    const requiredStages = ['hero', 'size', 'options', 'cuts'];
    const checks = [
      { ok: prepared.persistenceCompletionThenable === true, message: `Ctrl+F5 직전 durable 저장 완료 계약이 없습니다: ${JSON.stringify(prepared)}` },
      { ok: /^draft:/.test(expectedScope), message: `Ctrl+F5 직전 PSD 탭 분기가 준비되지 않았습니다: ${JSON.stringify(prepared)}` },
      { ok: first.projectId === scope.workspaceId && first.scope === expectedScope, message: `첫 Ctrl+F5 뒤 작업파일 경계가 달라졌습니다: ${JSON.stringify(first)}` },
      { ok: first.persisted?.currentProjectId === scope.workspaceId && first.persisted?.scopeId === expectedScope, message: `첫 Ctrl+F5 뒤 탭 분기 저장본이 문서와 분리됐습니다: ${JSON.stringify(first.persisted)}` },
      { ok: Object.entries(expectedStageRuns).every(([stageId, runId]) => first.stageRunIds[stageId] === runId), message: `첫 Ctrl+F5 뒤 단계 run 복원이 틀렸습니다: ${JSON.stringify(first.stageRunIds)}` },
      { ok: requiredStages.every(stageId => first.assets.some(asset => asset.stageId === stageId && asset.currentRunId === expectedStageRuns[stageId] && asset.archiveId && asset.imageUrl)), message: `첫 Ctrl+F5 뒤 후보 이미지가 모두 복원되지 않았습니다: ${JSON.stringify(first.assets)}` },
      { ok: first.productImagePresent, message: `첫 Ctrl+F5 뒤 기본이미지가 복원되지 않았습니다: ${JSON.stringify(first)}` },
      { ok: Object.entries(expectedStageRuns).every(([stageId, runId]) => second.stageRunIds[stageId] === runId), message: `두 번째 Ctrl+F5 뒤 단계 run이 유지되지 않았습니다: ${JSON.stringify(second.stageRunIds)}` },
      { ok: second.projectId === scope.workspaceId && second.scope === expectedScope && second.persisted?.scopeId === expectedScope, message: `두 번째 Ctrl+F5 뒤 PSD 탭 분기가 바뀌었습니다: ${JSON.stringify(second)}` },
      { ok: requiredStages.every(stageId => second.assets.some(asset => asset.stageId === stageId && asset.currentRunId === expectedStageRuns[stageId] && asset.archiveId && asset.imageUrl)), message: `두 번째 Ctrl+F5 뒤 후보 이미지가 사라졌습니다: ${JSON.stringify(second.assets)}` },
      { ok: second.productImagePresent, message: `두 번째 Ctrl+F5 뒤 기본이미지가 사라졌습니다: ${JSON.stringify(second)}` },
      { ok: !oldHeroPresent, message: `이전 대표이미지 run이 현재 후보에 섞였습니다: ${oldHero.archiveId}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      prepared,
      first,
      second,
      oldHeroPresent,
      screenshot: SCREENSHOT_PATH,
      failures: checks.filter(check => !check.ok).map(check => check.message),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
