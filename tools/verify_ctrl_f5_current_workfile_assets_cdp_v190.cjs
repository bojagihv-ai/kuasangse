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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9350';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'ctrl-f5-current-workfile-assets-v190.png');
const RESULT_PATH = path.join(OUT_DIR, 'ctrl-f5-current-workfile-assets-v190.json');

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#f8fafc"/><rect x="72" y="42" width="336" height="236" rx="24" fill="${color}"/><text x="240" y="172" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function reloadAndRead(cdp, label) {
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.render)', 60000);
  await new Promise(resolve => setTimeout(resolve, 3200));
  return evaluate(cdp, `(() => {
    const state = window.__kuasangseState;
    const factory = window.factoryState();
    const imageData = value => /^data:image\\//i.test(String(value || ''));
    const optionResults = Array.isArray(state.optionSorter?.optionResults) ? state.optionSorter.optionResults : [];
    const factoryAssets = Array.isArray(factory.assets) ? factory.assets : [];
    return {
      label: ${JSON.stringify(label)},
      projectId: state.currentProjectId || '',
      productName: state.productName || '',
      scope: window.getCurrentLastWorkWorkspaceScope?.() || '',
      optionResultCount: optionResults.length,
      optionResultImages: optionResults.filter(result => imageData(result.image)).map(result => result.id),
      factoryAssetCount: factoryAssets.length,
      factoryAssetImages: factoryAssets.filter(asset => imageData(asset.image)).map(asset => asset.id),
      factoryCandidateAssetIds: factoryAssets.filter(asset => asset.stageId === 'options' || asset.stageId === 'cuts').map(asset => asset.id),
      visibleImageCount: Array.from(document.images).filter(image => imageData(image.currentSrc || image.src) && image.naturalWidth > 0).length,
    };
  })()`);
}

async function focusOptionsCandidate(cdp, assetId) {
  const panelFound = await evaluate(cdp, `(() => {
    const panel = document.getElementById('factoryAutomationAssetChooser_options');
    if (panel) panel.scrollIntoView({ block: 'center' });
    return !!panel;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 500));
  return evaluate(cdp, `(() => {
    const imageData = value => /^data:image\\//i.test(String(value || ''));
    const panel = document.getElementById('factoryAutomationAssetChooser_options');
    const assetId = ${JSON.stringify(assetId)};
    const image = panel?.querySelector('[data-factory-asset-img="' + CSS.escape(assetId) + '"]');
    const useButton = panel?.querySelector('[data-factory-asset-use="' + CSS.escape(assetId) + '"]');
    return {
      panelFound: !!panel,
      candidateImageFound: !!image,
      candidateImageData: imageData(image?.currentSrc || image?.src),
      candidateImageDecoded: Number(image?.naturalWidth || 0) > 0,
      useButtonFound: !!useButton,
    };
  })()`);
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
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyCtrlF5Assets=${Date.now()}` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.saveSessionAssetsToDb)', 60000);
    await new Promise(resolve => setTimeout(resolve, 1800));

    const seed = String(Date.now());
    const projectId = `ctrl_f5_assets_v190_${seed}`;
    const productName = `CtrlF5이미지보존${seed}`;
    const runId = `run_ctrl_f5_assets_v190_${seed}`;
    const productKey = productName.replace(/\\s+/g, '').toLowerCase();
    const inputImageFingerprint = `fingerprint_ctrl_f5_assets_v190_${seed}`;
    const optionImage = svgData('색상옵션', '#be185d');
    const cutImage = svgData('이미지컷', '#0f766e');
    const heroImage = svgData('대표이미지', '#2563eb');

    const seeded = await evaluate(cdp, `(async () => {
      const state = window.__kuasangseState;
      const projectId = ${JSON.stringify(projectId)};
      const productName = ${JSON.stringify(productName)};
      const runId = ${JSON.stringify(runId)};
      const productKey = ${JSON.stringify(productKey)};
      const inputImageFingerprint = ${JSON.stringify(inputImageFingerprint)};
      const optionImage = ${JSON.stringify(optionImage)};
      const cutImage = ${JSON.stringify(cutImage)};
      const heroImage = ${JSON.stringify(heroImage)};
      const now = Date.now();
      state.currentProjectId = projectId;
      state.currentProjectName = productName;
      state.currentProjectCreatedAt = now;
      state.productName = productName;
      state.step = 'factory';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionResults: [{
          id: 'option-result-v190',
          title: '현재 작업 색상옵션컷',
          image: optionImage,
          hasImage: true,
          createdAt: now,
          workspaceId: projectId,
          currentRunId: runId,
          productKey,
          inputImageFingerprint,
          stageId: 'options',
        }],
        optionLastGeneratedResultIds: ['option-result-v190'],
      });
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
      ['hero', 'options', 'cuts'].forEach(stageId => {
        factory.stages[stageId].currentRunId = runId;
        factory.stages[stageId].latestGenerationRunId = runId;
        factory.stages[stageId].status = 'review';
        factory.stages[stageId].message = '현재 작업 후보를 고르세요.';
      });
      factory.automation.activeTab = 'assets';
      factory.assets = [];
      const sharedAssetMeta = {
        workspaceId: projectId,
        currentRunId: runId,
        generationRunId: runId,
        productKey,
        inputImageFingerprint,
        productName,
        enforceCurrentJob: true,
        skipLocalArchive: true,
      };
      const heroAsset = window.factoryRegisterAsset('hero', heroImage, {
        ...sharedAssetMeta,
        title: '대표이미지 후보',
      });
      const optionAsset = window.factoryRegisterAsset('options', optionImage, {
        ...sharedAssetMeta,
        title: '색상옵션 후보',
        sourceMap: { optionResultId: 'option-result-v190' },
      });
      const cutAsset = window.factoryRegisterAsset('cuts', cutImage, {
        ...sharedAssetMeta,
        title: '이미지컷 후보',
      });
      factory.stages.hero.selectedAssetIds = [];
      factory.stages.options.selectedAssetIds = [];
      factory.stages.cuts.selectedAssetIds = [];
      window.render();
      await window.saveSessionAssetsToDb();
      const stored = await window.workspaceGet('sessionAssets', 'current');
      return {
        scope: window.getCurrentLastWorkWorkspaceScope(),
        assetIds: [heroAsset?.id || '', optionAsset?.id || '', cutAsset?.id || ''],
        savedOptionResultImages: (stored.optionSorter?.optionResults || []).filter(result => /^data:image\\//i.test(String(result.image || ''))).map(result => result.id),
        savedFactoryImages: (stored.factory?.assets || []).filter(asset => /^data:image\\//i.test(String(asset.image || ''))).map(asset => asset.stageId),
      };
    })()`);

    const firstRestore = await reloadAndRead(cdp, 'first-ctrl-f5');
    await new Promise(resolve => setTimeout(resolve, 2200));
    const secondRestore = await reloadAndRead(cdp, 'second-ctrl-f5');
    const visibleCandidate = await focusOptionsCandidate(cdp, seeded.assetIds[1]);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));

    const expectedScope = `project:${projectId}`;
    const checks = [
      { ok: seeded.scope === expectedScope, message: `저장 scope가 현재 작업파일과 다릅니다: ${JSON.stringify(seeded)}` },
      { ok: seeded.savedOptionResultImages.includes('option-result-v190'), message: `IndexedDB에 색상옵션 후보 이미지가 저장되지 않았습니다: ${JSON.stringify(seeded)}` },
      { ok: ['hero', 'options', 'cuts'].every(stageId => seeded.savedFactoryImages.includes(stageId)), message: `IndexedDB에 조립공장 후보 이미지가 저장되지 않았습니다: ${JSON.stringify(seeded)}` },
      { ok: firstRestore.projectId === projectId && firstRestore.scope === expectedScope, message: `첫 Ctrl+F5 뒤 작업파일 경계가 달라졌습니다: ${JSON.stringify(firstRestore)}` },
      { ok: firstRestore.optionResultImages.includes('option-result-v190'), message: `첫 Ctrl+F5 뒤 색상옵션컷이 사라졌습니다: ${JSON.stringify(firstRestore)}` },
      { ok: ['hero', 'options', 'cuts'].every(stageId => firstRestore.factoryAssetImages.some(id => id.includes(stageId))), message: `첫 Ctrl+F5 뒤 조립공장 후보가 사라졌습니다: ${JSON.stringify(firstRestore)}` },
      { ok: secondRestore.projectId === projectId && secondRestore.scope === expectedScope, message: `두 번째 Ctrl+F5 뒤 작업파일 경계가 달라졌습니다: ${JSON.stringify(secondRestore)}` },
      { ok: secondRestore.optionResultImages.includes('option-result-v190'), message: `두 번째 Ctrl+F5 뒤 색상옵션컷이 사라졌습니다: ${JSON.stringify(secondRestore)}` },
      { ok: ['hero', 'options', 'cuts'].every(stageId => secondRestore.factoryAssetImages.some(id => id.includes(stageId))), message: `두 번째 Ctrl+F5 뒤 조립공장 후보가 사라졌습니다: ${JSON.stringify(secondRestore)}` },
      { ok: visibleCandidate.panelFound && visibleCandidate.candidateImageFound && visibleCandidate.candidateImageData && visibleCandidate.candidateImageDecoded && visibleCandidate.useButtonFound, message: `Ctrl+F5 뒤 화면의 색상옵션 후보 카드가 복원되지 않았습니다: ${JSON.stringify(visibleCandidate)}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      seeded,
      firstRestore,
      secondRestore,
      visibleCandidate,
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
