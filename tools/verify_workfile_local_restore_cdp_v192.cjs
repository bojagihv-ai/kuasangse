const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const API_ROOT = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9362';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'workfile-local-restore-v192.png');
const RESULT_PATH = path.join(OUT_DIR, 'workfile-local-restore-v192.json');

function svgData(label, color) {
  const filler = 'x'.repeat(220000);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><!--${filler}--><rect width="480" height="320" fill="#f8fafc"/><rect x="72" y="42" width="336" height="236" rx="24" fill="${color}"/><text x="240" y="172" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function readRestoredState(cdp) {
  return evaluate(cdp, `(() => {
    const state = window.__kuasangseState;
    const factory = window.factoryState();
    const assets = Array.isArray(factory.assets) ? factory.assets : [];
    return {
      projectId: state.currentProjectId || '',
      productName: state.productName || '',
      scope: window.getCurrentLastWorkWorkspaceScope?.() || '',
      assets: assets.map(asset => ({
        id: asset.id || '',
        title: asset.title || '',
        stageId: asset.stageId || '',
        image: asset.image || '',
        imageUrl: asset.imageUrl || '',
        archiveId: asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId || '',
      })),
      localAssets: Array.isArray(factory.archive?.localAssets) ? factory.archive.localAssets.map(item => ({
        archiveId: item.archiveId || '',
        stageId: item.stageId || '',
        currentRunId: item.currentRunId || '',
      })) : [],
      localStatus: factory.archive?.localStatus || '',
    };
  })()`);
}

async function reloadAndWait(cdp, expectedStages) {
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.factoryRestoreCurrentWorkfileLocalArchive)', 60000);
  try {
    await waitFor(cdp, `(() => {
      const assets = window.factoryState().assets || [];
      const expected = ${JSON.stringify(expectedStages)};
      return expected.every(stageId => assets.some(asset =>
        asset.stageId === stageId &&
        (asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId) &&
        (asset.imageUrl || asset.image)
      ));
    })()`, 60000);
  } catch (error) {
    throw new Error(`${error.message}\nrestore diagnostics: ${JSON.stringify(await readRestoredState(cdp))}`);
  }
  await new Promise(resolve => setTimeout(resolve, 1200));
  return readRestoredState(cdp);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 920,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : String(input?.url || '');
          if (/\\/api\\/last-work(?:[/?]|$)/.test(url)) {
            return Promise.resolve(new Response(JSON.stringify({ hasSnapshot: false }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }));
          }
          return nativeFetch(input, init);
        };
      })()`,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyWorkfileLocalRestore=${Date.now()}` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.workspaceGet)', 60000);

    const seed = String(Date.now());
    const projectId = `workfile_local_restore_v192_${seed}`;
    const productName = `작업파일원본복원${seed}`;
    const productKey = productName.replace(/\s+/g, '').toLowerCase();
    const runId = `run_workfile_local_restore_v192_${seed}`;
    const foreignRunId = `run_foreign_${seed}`;
    const inputImageFingerprint = `220324:workfile_local_restore_v192_${seed}:verified`;
    const heroImage = svgData('대표이미지', '#2563eb');
    const optionImage = svgData('색상옵션', '#be185d');
    const cutImage = svgData('이미지컷', '#0f766e');
    const foreignImage = svgData('다른실행', '#991b1b');
    const expectedStages = ['hero', 'options', 'cuts'];
    const expectedAssets = [
      { stageId: 'hero', title: '현재 작업 대표 이미지', imageLabel: '대표이미지' },
      { stageId: 'options', title: '현재 작업 색상 옵션 이미지', imageLabel: '색상옵션' },
      { stageId: 'cuts', title: '현재 작업 이미지컷', imageLabel: '이미지컷' },
    ];

    const seeded = await evaluate(cdp, `(async () => {
      const state = window.__kuasangseState;
      const projectId = ${JSON.stringify(projectId)};
      const productName = ${JSON.stringify(productName)};
      const productKey = ${JSON.stringify(productKey)};
      const runId = ${JSON.stringify(runId)};
      const inputImageFingerprint = ${JSON.stringify(inputImageFingerprint)};
      const now = Date.now();
      state.currentProjectId = projectId;
      state.currentProjectName = productName;
      state.currentProjectCreatedAt = now;
      state.productName = productName;
      state.step = 'factory';
      const factory = window.factoryState();
      window.factoryStampWorkspaceIdentity?.(factory, { projectId, projectName: productName, createdAt: now });
      factory.product.productName = productName;
      factory.product.userProductName = productName;
      factory.product.productKey = productKey;
      factory.product.productIdentityKey = productKey;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.inputImageFingerprint = inputImageFingerprint;
      factory.product.lockedInputImageFingerprint = inputImageFingerprint;
      factory.automation.currentRunId = runId;
      factory.automation.activeTab = 'assets';
      factory.assets = [];
      ['hero', 'options', 'cuts'].forEach(stageId => {
        factory.stages[stageId].currentRunId = runId;
        factory.stages[stageId].latestGenerationRunId = runId;
        factory.stages[stageId].status = 'review';
      });
      const shared = {
        workspaceId: projectId,
        currentRunId: runId,
        generationRunId: runId,
        productKey,
        inputImageFingerprint,
        productName,
        enforceCurrentJob: true,
      };
      const hero = window.factoryRegisterAsset('hero', ${JSON.stringify(heroImage)}, { ...shared, title: '현재 작업 대표 이미지' });
      const options = window.factoryRegisterAsset('options', ${JSON.stringify(optionImage)}, { ...shared, title: '현재 작업 색상 옵션 이미지' });
      const cuts = window.factoryRegisterAsset('cuts', ${JSON.stringify(cutImage)}, { ...shared, title: '현재 작업 이미지컷' });
      window.render();
      return { scope: window.getCurrentLastWorkWorkspaceScope(), assetIds: [hero?.id || '', options?.id || '', cuts?.id || ''] };
    })()`);

    try {
      await waitFor(cdp, `(() => {
        const expected = ${JSON.stringify(expectedAssets)};
        const projectId = ${JSON.stringify(projectId)};
        const productKey = ${JSON.stringify(productKey)};
        const runId = ${JSON.stringify(runId)};
        const inputImageFingerprint = ${JSON.stringify(inputImageFingerprint)};
        const assets = window.factoryState().assets || [];
        return expected.every(item => assets.some(asset => (
          String(asset?.stageId || '') === item.stageId &&
          String(asset?.title || '') === item.title &&
          String(asset?.workspaceId || '') === projectId &&
          String(asset?.productKey || '') === productKey &&
          String(asset?.currentRunId || '') === runId &&
          String(asset?.inputImageFingerprint || '') === inputImageFingerprint &&
          asset?.localArchive?.saved && asset?.localArchive?.archiveId
        )));
      })()`, 30000);
    } catch (error) {
      const diagnostics = await evaluate(cdp, `(() => ({
        backendBaseUrl: window.__kuasangseState?.backendBaseUrl || '',
        factoryBackendBaseUrl: typeof window.factoryBackendBaseUrl === 'function' ? window.factoryBackendBaseUrl() : '',
        localStatus: window.factoryState().archive?.localStatus || '',
        assets: (window.factoryState().assets || []).map(asset => ({
          id: asset.id,
          stageId: asset.stageId,
          title: asset.title,
          workspaceId: asset.workspaceId,
          productKey: asset.productKey,
          currentRunId: asset.currentRunId,
          inputImageFingerprint: asset.inputImageFingerprint,
          imageLength: String(asset.image || '').length,
          localArchive: asset.localArchive || null,
        })),
      }))()`);
      throw new Error(`${error.message}\narchive diagnostics: ${JSON.stringify(diagnostics)}`);
    }

    const manifest = await fetchJson(
      `${API_ROOT}/api/local-archive/workfiles/${encodeURIComponent(projectId)}/manifest?${new URLSearchParams({ productKey, currentRunId: runId, inputImageFingerprint }).toString()}`,
    );
    const archiveImageProofs = await Promise.all(expectedAssets.map(async expected => {
      const asset = (manifest.assets || []).find(item => (
        String(item?.stageId || '') === expected.stageId &&
        String(item?.title || '') === expected.title
      ));
      if (!asset?.imageUrl) return { ...expected, archiveId: asset?.archiveId || '', titleMatches: false, imageMatches: false };
      const response = await fetch(`${API_ROOT}${asset.imageUrl}`);
      const body = response.ok ? await response.text() : '';
      return {
        ...expected,
        archiveId: asset.archiveId || '',
        titleMatches: true,
        imageMatches: body.includes(expected.imageLabel),
      };
    }));
    const foreignArchive = await fetchJson(`${API_ROOT}/api/local-archive/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'verify-workfile-foreign-run',
        workspaceId: projectId,
        productName,
        productKey,
        currentRunId: foreignRunId,
        inputImageFingerprint,
        stageId: 'hero',
        asset: {
          id: `foreign_asset_${seed}`,
          stageId: 'hero',
          title: '다른 실행 이미지 - 복원 금지',
          image: foreignImage,
          workspaceId: projectId,
          productKey,
          currentRunId: foreignRunId,
          inputImageFingerprint,
          metadata: { workspaceId: projectId, productKey, currentRunId: foreignRunId, inputImageFingerprint, stageId: 'hero' },
          sourceMap: { workspaceId: projectId, productKey, currentRunId: foreignRunId, inputImageFingerprint, stageId: 'hero' },
        },
      }),
    });

    const preparedForRecovery = await evaluate(cdp, `(async () => {
      await window.saveSessionAssetsToDb();
      const stored = await window.workspaceGet('sessionAssets', 'current');
      stored.factory.assets = [];
      stored.factory.archive = { ...(stored.factory.archive || {}), localAssets: [] };
      if (stored.optionSorter) {
        stored.optionSorter.optionResults = [];
        stored.optionSorter.optionLastGeneratedResultIds = [];
      }
      await window.workspacePut('sessionAssets', stored);
      return {
        storedProjectId: stored.currentProjectId || '',
        storedFactoryAssetCount: stored.factory.assets.length,
        storedRunId: stored.factory.stages?.hero?.currentRunId || '',
      };
    })()`);

    const restored = await reloadAndWait(cdp, expectedStages);
    const visible = await evaluate(cdp, `(() => {
      const panel = document.getElementById('factoryAutomationAssetChooser_options');
      if (panel) panel.scrollIntoView({ block: 'center' });
      const option = (window.factoryState().assets || []).find(asset => asset.stageId === 'options');
      const image = option && panel?.querySelector('[data-factory-asset-img="' + CSS.escape(option.id) + '"]');
      return {
        panelFound: !!panel,
        optionAssetId: option?.id || '',
        imageFound: !!image,
        decoded: Number(image?.naturalWidth || 0) > 0,
        imageUrl: image?.currentSrc || image?.src || '',
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 800));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));

    const restoredStages = new Set(restored.assets.map(asset => asset.stageId));
    const localArchiveIds = restored.assets.filter(asset => expectedStages.includes(asset.stageId)).map(asset => asset.archiveId).filter(Boolean);
    const checks = [
      { ok: seeded.scope === `project:${projectId}`, message: `작업파일 scope가 올바르지 않습니다: ${JSON.stringify(seeded)}` },
      { ok: manifest.hasManifest && manifest.count >= expectedStages.length, message: `현재 작업파일 매니페스트에 후보가 저장되지 않았습니다: ${JSON.stringify(manifest)}` },
      { ok: manifest.assets.every(item => /[\\/]workfiles[\\/]/.test(String(item.folder || ''))), message: `원본이 작업파일 전용 폴더가 아닌 곳에 저장됐습니다: ${JSON.stringify(manifest.assets)}` },
      { ok: archiveImageProofs.every(item => item.archiveId && item.titleMatches && item.imageMatches), message: `현재 작업 원본 이미지 내용이 매니페스트와 일치하지 않습니다: ${JSON.stringify(archiveImageProofs)}` },
      { ok: !!foreignArchive.archive?.archiveId, message: '격리 검증용 다른 run 이미지 저장에 실패했습니다.' },
      { ok: preparedForRecovery.storedProjectId === projectId && preparedForRecovery.storedFactoryAssetCount === 0 && preparedForRecovery.storedRunId === runId, message: `브라우저 복원 전제 상태가 올바르지 않습니다: ${JSON.stringify(preparedForRecovery)}` },
      { ok: restored.projectId === projectId && restored.scope === `project:${projectId}`, message: `새로고침 뒤 현재 작업파일 경계가 달라졌습니다: ${JSON.stringify(restored)}` },
      { ok: expectedStages.every(stageId => restoredStages.has(stageId)), message: `작업파일 로컬 원본에서 후보를 모두 복원하지 못했습니다: ${JSON.stringify(restored)}` },
      { ok: localArchiveIds.length >= expectedStages.length, message: `복원 후보에 로컬 보관 연결이 없습니다: ${JSON.stringify(restored)}` },
      { ok: !restored.assets.some(asset => asset.title.includes('다른 실행 이미지')), message: `다른 run 후보가 현재 작업에 섞였습니다: ${JSON.stringify(restored)}` },
      { ok: visible.panelFound && visible.imageFound && visible.decoded && /\/api\/local-archive\/assets\//.test(visible.imageUrl), message: `색상옵션 복원 후보가 실제 화면에 로컬 원본 이미지로 표시되지 않았습니다: ${JSON.stringify(visible)}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      seeded,
      manifest: { count: manifest.count, manifestPath: manifest.manifestPath, workfileFolder: manifest.workfileFolder },
      archiveImageProofs,
      preparedForRecovery,
      restored,
      visible,
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
  process.exit(1);
});
