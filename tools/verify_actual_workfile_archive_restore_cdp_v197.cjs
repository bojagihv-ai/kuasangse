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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9367';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'actual-slabe-workfile-restored-v197.png');
const RESULT_PATH = path.join(OUT_DIR, 'actual-slabe-workfile-restored-v197.json');
const WORKSPACE_ID = 'draft:lastwork_mrkclshf_1nzm2d';
const PRODUCT_NAME = '슬라브나비수저집';
const PRODUCT_KEY = '슬라브나비수저집';
const INPUT_FINGERPRINT = '4158444:/9j/4UCIRXhpZgAASUkqAAgAAAAMAA8BAgAGAAAAngAAABABAgAPAAAApAAAABIBAwABAAAA:PY4NOBOAD+NBnfW7GttAyWCBjtDH1pcdAeR7YoGvekGfrS54+poLg9LB7CjAB9RQRzNn/9k=';
const EXPECTED_RUNS = {
  input: 'factory_work_run_mrkcmecy_9g3h4e',
  hero: 'factory_hero_run_mrkcn7mq_d6lx4c',
  size: 'factory_size_run_mrkd0o7v_fxuz1b',
  cuts: 'factory_cuts_run_mrkcovcm_5syk7p',
};

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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        localStorage.setItem('pdp_last_work_draft_scope_v1', ${JSON.stringify(WORKSPACE_ID)});
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init = {}) => {
          const url = typeof input === 'string' ? input : String(input?.url || '');
          const method = String(init?.method || input?.method || 'GET').toUpperCase();
          if (/\\/api\\/last-work(?:[/?]|$)/.test(url) && method !== 'GET') {
            return Promise.resolve(new Response(JSON.stringify({ ok: true, accepted: false, readOnlyVerification: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }));
          }
          return nativeFetch(input, init);
        };
      })()`,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyActualWorkfileArchive=v197` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.factoryRestoreCurrentWorkfileLocalArchive)', 60000);
    await waitFor(cdp, `(() => {
      const state = window.__kuasangseState;
      const factory = window.factoryState();
      return (state.productName === ${JSON.stringify(PRODUCT_NAME)} || factory.product?.productName === ${JSON.stringify(PRODUCT_NAME)}) &&
        (factory.product?.cafe24Candidates || []).length >= 21;
    })()`, 60000);

    const restore = await evaluate(cdp, `(async () => {
      const outcome = await window.factoryRestoreCurrentWorkfileLocalArchive({ silent: true });
      const factory = window.factoryState();
      factory.automation.activeTab = 'assets';
      window.__kuasangseState.step = 'factory';
      window.render();
      return outcome;
    })()`);
    try {
      await waitFor(cdp, `(() => {
        const factory = window.factoryState();
        return window.factoryUsableAssetsForStage('hero', factory).length === 4 &&
          window.factoryUsableAssetsForStage('size', factory).length === 3 &&
          window.factoryUsableAssetsForStage('cuts', factory).length === 4;
      })()`, 60000);
    } catch (error) {
      const diagnostics = await evaluate(cdp, `(() => {
        const state = window.__kuasangseState;
        const factory = window.factoryState();
        return {
          restore: ${JSON.stringify(restore)},
          scope: window.getCurrentLastWorkWorkspaceScope?.() || '',
          identity: window.factoryCurrentWorkfileArchiveIdentity?.(factory) || null,
          stageRunIds: factory.archive?.stageRunIds || {},
          stageStateRuns: Object.fromEntries(Object.entries(factory.stages || {}).map(([id, stage]) => [id, { currentRunId: stage.currentRunId || '', latestGenerationRunId: stage.latestGenerationRunId || '' }])),
          localStatus: factory.archive?.localStatus || '',
          localError: factory.archive?.localAssetsError || '',
          localAssetCount: (factory.archive?.localAssets || []).length,
          rawCounts: Object.fromEntries(['hero', 'size', 'options', 'cuts'].map(id => [id, (factory.assets || []).filter(asset => asset.stageId === id).length])),
          usableCounts: Object.fromEntries(['hero', 'size', 'options', 'cuts'].map(id => [id, window.factoryUsableAssetsForStage(id, factory).length])),
          assets: (factory.assets || []).map(asset => ({
            stageId: asset.stageId || '',
            workspaceId: asset.workspaceId || asset.metadata?.workspaceId || '',
            currentRunId: asset.currentRunId || '',
            productKey: asset.productKey || '',
            inputImageFingerprint: asset.inputImageFingerprint || '',
            archiveId: asset.archiveId || asset.localArchive?.archiveId || '',
          })),
          productName: state.productName || factory.product?.productName || '',
        };
      })()`);
      throw new Error(`${error.message}\nactual workfile diagnostics: ${JSON.stringify(diagnostics)}`);
    }
    await evaluate(cdp, `(() => {
      const panel = document.getElementById('factoryAutomationAssetChooser_hero');
      panel?.scrollIntoView({ block: 'start' });
      return !!panel;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 1200));

    const proof = await evaluate(cdp, `(() => {
      const state = window.__kuasangseState;
      const factory = window.factoryState();
      const stages = ['hero', 'size', 'options', 'cuts'];
      const stageCounts = Object.fromEntries(stages.map(stageId => [stageId, window.factoryUsableAssetsForStage(stageId, factory).length]));
      const assets = (factory.assets || []).map(asset => ({
        id: asset.id || '',
        stageId: asset.stageId || '',
        workspaceId: asset.workspaceId || asset.metadata?.workspaceId || asset.sourceMap?.workspaceId || '',
        currentRunId: asset.currentRunId || asset.generationRunId || '',
        productKey: asset.productKey || '',
        inputImageFingerprint: asset.inputImageFingerprint || '',
        archiveId: asset.archiveId || asset.localArchive?.archiveId || asset.metadata?.localArchiveId || '',
        imageUrl: asset.imageUrl || '',
      }));
      const images = Array.from(document.images);
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        currentScope: window.getCurrentLastWorkWorkspaceScope?.() || '',
        identity: window.factoryCurrentWorkfileArchiveIdentity(factory),
        productName: state.productName || factory.product?.productName || '',
        stageRunIds: { ...(factory.archive?.stageRunIds || {}) },
        stageCounts,
        cafe24Candidates: (factory.product?.cafe24Candidates || []).length,
        pendingCafe24Candidates: (factory.product?.pendingCafe24Candidates || []).length,
        dbCandidates: (factory.product?.dbCandidates || []).length,
        optionResults: (state.optionSorter?.optionResults || []).length,
        productImagePresent: !!(
          state.imageBase64 ||
          (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__') ||
          factory.product?.imageBase64 ||
          (factory.product?.imagePreview && factory.product.imagePreview !== '__stored_in_indexeddb__')
        ),
        assets,
        localStatus: factory.archive?.localStatus || '',
        brokenVisibleImages: images.filter(img => {
          const rect = img.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && img.complete && img.naturalWidth === 0;
        }).length,
        visibleLoadedImages: images.filter(img => {
          const rect = img.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && img.complete && img.naturalWidth > 0;
        }).length,
        bodyHasBuildV198: document.body.innerText.includes('빌드 v198'),
      };
    })()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const strictAssets = proof.assets.filter(asset => ['hero', 'size', 'cuts'].includes(asset.stageId));
    const checks = [
      { ok: proof.buildId === '20260715-ui-stability-v198' && proof.bodyHasBuildV198, message: `최신 번들이 아닙니다: ${proof.buildId}` },
      { ok: proof.currentScope === WORKSPACE_ID, message: `실제 작업파일 범위가 다릅니다: ${proof.currentScope}` },
      { ok: proof.identity?.workspaceId === WORKSPACE_ID && proof.identity?.productKey === PRODUCT_KEY && proof.identity?.inputImageFingerprint === INPUT_FINGERPRINT, message: `실제 작업파일 핵심 식별자가 다릅니다: ${JSON.stringify(proof.identity)}` },
      { ok: Object.entries(EXPECTED_RUNS).every(([stageId, runId]) => proof.stageRunIds[stageId] === runId), message: `실제 단계 runId가 다릅니다: ${JSON.stringify(proof.stageRunIds)}` },
      { ok: proof.productImagePresent, message: '실제 기본이미지가 복원되지 않았습니다.' },
      { ok: proof.stageCounts.hero === 4 && proof.stageCounts.size === 3 && proof.stageCounts.cuts === 4, message: `실제 생성 이미지 개수가 다릅니다: ${JSON.stringify(proof.stageCounts)}` },
      { ok: proof.cafe24Candidates === 21 && proof.pendingCafe24Candidates === 21, message: `실제 Cafe24 후보가 유지되지 않았습니다: ${proof.cafe24Candidates}/${proof.pendingCafe24Candidates}` },
      { ok: strictAssets.length === 11 && strictAssets.every(asset => asset.workspaceId === WORKSPACE_ID && asset.productKey === PRODUCT_KEY && asset.inputImageFingerprint === INPUT_FINGERPRINT && asset.currentRunId === EXPECTED_RUNS[asset.stageId] && asset.archiveId && asset.imageUrl), message: `실제 후보 중 작업 범위가 불완전하거나 섞인 항목이 있습니다: ${JSON.stringify(strictAssets)}` },
      { ok: proof.brokenVisibleImages === 0 && proof.visibleLoadedImages > 0, message: `화면 이미지 로딩 실패: 깨짐 ${proof.brokenVisibleImages}, 로드 ${proof.visibleLoadedImages}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      restore,
      proof,
      screenshot: SCREENSHOT_PATH,
      failures: checks.filter(check => !check.ok).map(check => check.message),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({
      ok: result.ok,
      restore,
      buildId: proof.buildId,
      currentScope: proof.currentScope,
      productName: proof.productName,
      stageRunIds: proof.stageRunIds,
      stageCounts: proof.stageCounts,
      cafe24Candidates: proof.cafe24Candidates,
      pendingCafe24Candidates: proof.pendingCafe24Candidates,
      dbCandidates: proof.dbCandidates,
      optionResults: proof.optionResults,
      productImagePresent: proof.productImagePresent,
      strictAssetCount: strictAssets.length,
      brokenVisibleImages: proof.brokenVisibleImages,
      visibleLoadedImages: proof.visibleLoadedImages,
      screenshot: SCREENSHOT_PATH,
      resultPath: RESULT_PATH,
      failures: result.failures,
    }, null, 2));
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
