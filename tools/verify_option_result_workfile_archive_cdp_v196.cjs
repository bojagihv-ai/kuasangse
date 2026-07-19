const assert = require('node:assert/strict');
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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9366';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'option-result-workfile-archive-v196.png');
const RESULT_PATH = path.join(OUT_DIR, 'option-result-workfile-archive-v196.json');

function largeOptionImage() {
  const filler = 'option-pixel-data'.repeat(16000);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><!--${filler}--><rect width="480" height="640" fill="#fff"/><rect x="48" y="48" width="384" height="544" fill="#be185d"/><text x="240" y="326" text-anchor="middle" fill="#fff" font-size="30">색상옵션 즉시 저장</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function imageFingerprint(dataUrl) {
  const base64 = String(dataUrl || '').replace(/^data:image\/[^;,]+;base64,/i, '');
  return `${base64.length}:${base64.slice(0, 72)}:${base64.slice(-72)}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'app-core-06.js'), 'utf8');
  assert.match(
    source,
    /await\s+factoryArchiveOptionSorterResultToWorkfile\(resultRecord/,
    '옵션 생성 성공 경로가 작업파일 로컬 아카이브 완료를 기다리지 않습니다.',
  );

  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyOptionWorkfileArchive=${Date.now()}` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.factoryState && window.factoryArchiveOptionSorterResultToWorkfile)', 60000);

    const seed = String(Date.now());
    const productName = `옵션작업파일보존${seed}`;
    const optionImage = largeOptionImage();
    const scope = {
      workspaceId: `option-workfile-v196-${seed}`,
      productName,
      productKey: productName.replace(/\s+/g, '').toLowerCase(),
      inputImageFingerprint: imageFingerprint(optionImage),
    };
    const resultId = `option-result-v196-${seed}`;
    const prepared = await evaluate(cdp, `(async () => {
      const state = window.__kuasangseState;
      const scope = ${JSON.stringify(scope)};
      const result = {
        id: ${JSON.stringify(resultId)},
        optionName: '현재 작업 색상옵션표',
        title: '현재 작업 색상옵션표',
        image: ${JSON.stringify(optionImage)},
        hasImage: true,
        prompt: '즉시 저장 검증',
        createdAt: new Date().toISOString(),
      };
      state.currentProjectId = scope.workspaceId;
      state.currentProjectName = scope.productName;
      state.productName = scope.productName;
      state.step = 'factory';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionResults: [result],
        optionLastGeneratedResultIds: [result.id],
      });
      const factory = window.factoryState();
      window.factoryStampWorkspaceIdentity?.(factory, { projectId: scope.workspaceId, projectName: scope.productName, createdAt: Date.now() });
      factory.product.productName = scope.productName;
      factory.product.userProductName = scope.productName;
      factory.product.productKey = scope.productKey;
      factory.product.currentProductKey = scope.productKey;
      factory.product.productIdentityKey = scope.productKey;
      factory.product.lockedProductKey = scope.productKey;
      factory.product.inputImageFingerprint = scope.inputImageFingerprint;
      factory.product.lockedInputImageFingerprint = scope.inputImageFingerprint;
      factory.product.currentRunId = '';
      factory.product.generationRunId = '';
      factory.automation.currentRunId = '';
      factory.goalRun.currentRunId = '';
      factory.stages.options.currentRunId = '';
      factory.stages.options.latestGenerationRunId = '';
      factory.assets = [];
      factory.previousAssets = [];
      factory.archive = { ...(factory.archive || {}), stageRunIds: {}, localAssets: [] };
      const asset = await window.factoryArchiveOptionSorterResultToWorkfile(result, { reason: 'verify-option-v196' });
      const latestFactory = window.factoryState();
      const storedResult = state.optionSorter.optionResults.find(item => item.id === result.id);
      return {
        runId: latestFactory.archive?.stageRunIds?.options || '',
        stageRunId: latestFactory.stages.options.currentRunId || '',
        asset: asset ? {
          id: asset.id || '',
          stageId: asset.stageId || '',
          currentRunId: asset.currentRunId || '',
          archiveId: asset.localArchive?.archiveId || asset.archiveId || '',
          imageUrl: asset.imageUrl || '',
          localSaved: asset.localArchive?.saved === true,
        } : null,
        result: storedResult ? {
          factoryScope: storedResult.factoryScope || null,
          resultAssetId: storedResult.resultAssetId || '',
          archiveId: storedResult.archiveId || '',
          imageUrl: storedResult.imageUrl || '',
          hasImage: storedResult.hasImage === true,
          inlineImageLength: String(storedResult.image || '').length,
        } : null,
      };
    })()`);

    const manifestQuery = new URLSearchParams({
      productKey: scope.productKey,
      currentRunId: prepared.runId,
      inputImageFingerprint: scope.inputImageFingerprint,
      stageId: 'options',
    });
    const manifestResponse = await fetch(
      `${API_ROOT}/api/local-archive/workfiles/${encodeURIComponent(scope.workspaceId)}/manifest?${manifestQuery}`,
    );
    const manifest = await manifestResponse.json().catch(() => ({}));

    const restored = await evaluate(cdp, `(async () => {
      const factory = window.factoryState();
      factory.assets = [];
      factory.archive.localAssets = [];
      const outcome = await window.factoryRestoreCurrentWorkfileLocalArchive({ silent: true });
      factory.automation.activeTab = 'assets';
      window.render();
      return {
        outcome,
        assets: (factory.assets || []).filter(asset => asset.stageId === 'options').map(asset => ({
          currentRunId: asset.currentRunId || '',
          archiveId: asset.localArchive?.archiveId || asset.metadata?.localArchiveId || '',
          imageUrl: asset.imageUrl || '',
        })),
      };
    })()`);
    await waitFor(cdp, 'document.querySelectorAll("#factoryAutomationAssetChooser_options [data-factory-asset-id]").length >= 1', 30000);
    await evaluate(cdp, `(() => {
      const panel = document.getElementById('factoryAutomationAssetChooser_options');
      panel?.scrollIntoView({ block: 'center' });
      return !!panel;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 400));
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const checks = [
      { ok: !!prepared.runId && prepared.runId === prepared.stageRunId, message: `옵션 단계 runId가 생성·고정되지 않았습니다: ${JSON.stringify(prepared)}` },
      { ok: prepared.asset?.stageId === 'options' && prepared.asset.currentRunId === prepared.runId && prepared.asset.localSaved && prepared.asset.archiveId && prepared.asset.imageUrl, message: `옵션 결과가 즉시 로컬 저장되지 않았습니다: ${JSON.stringify(prepared)}` },
      { ok: prepared.result?.factoryScope?.workspaceId === scope.workspaceId && prepared.result?.factoryScope?.productKey === scope.productKey && prepared.result?.factoryScope?.inputImageFingerprint === scope.inputImageFingerprint && prepared.result?.factoryScope?.currentRunId === prepared.runId && prepared.result?.factoryScope?.stageId === 'options', message: `옵션 결과의 5중 작업 범위가 완성되지 않았습니다: ${JSON.stringify(prepared.result)}` },
      { ok: prepared.result?.archiveId === prepared.asset?.archiveId && prepared.result?.imageUrl && prepared.result?.hasImage, message: `옵션 결과가 로컬 아카이브 참조를 받지 못했습니다: ${JSON.stringify(prepared.result)}` },
      { ok: manifestResponse.ok && manifest.ok === true && (manifest.assets || []).some(asset => asset.archiveId === prepared.asset?.archiveId), message: `작업파일 매니페스트에 옵션 이미지가 없습니다: ${JSON.stringify(manifest)}` },
      { ok: restored.outcome?.restored >= 1 && restored.assets.some(asset => asset.currentRunId === prepared.runId && asset.archiveId === prepared.asset?.archiveId && asset.imageUrl), message: `메모리 이미지를 지운 뒤 로컬 작업파일에서 옵션 후보를 복원하지 못했습니다: ${JSON.stringify(restored)}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      scope,
      prepared,
      manifestCount: manifest.count || 0,
      restored,
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
