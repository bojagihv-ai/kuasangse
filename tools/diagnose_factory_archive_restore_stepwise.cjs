const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9460';
const productName = process.env.KUASANGSE_PROOF_PRODUCT || '버튼실제사이즈검증띠수네모동전지갑';
const evidenceDir = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const outPath = path.join(evidenceDir, 'factory-archive-restore-stepwise.json');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function timedSend(cdp, method, params = {}, timeoutMs = 10000) {
  return Promise.race([
    cdp.send(method, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs)),
  ]);
}

function stepExpression({ productName, runId, inputFingerprint }) {
  return `(() => {
    const factory = factoryState();
    state.step = 'imagecuts';
    state.backendBaseUrl = 'http://127.0.0.1:5050';
    if (typeof factorySetCurrentProductIdentity === 'function') {
      factorySetCurrentProductIdentity(${JSON.stringify(productName)}, {
        factory,
        productKey: ${JSON.stringify(productName)},
        syncDom: true,
        forceDom: true,
        setSearchQuery: true,
        syncFinal: true,
      });
    } else {
      state.productName = ${JSON.stringify(productName)};
      factory.product.productName = ${JSON.stringify(productName)};
      factory.product.userProductName = ${JSON.stringify(productName)};
      factory.product.productKey = factoryNormalizeIdentityText(${JSON.stringify(productName)});
      factory.product.productIdentityKey = factory.product.productKey;
    }
    factory.product.currentRunId = ${JSON.stringify(runId)};
    factory.product.hasImage = true;
    factory.product.inputImageFingerprint = ${JSON.stringify(inputFingerprint)};
    factory.product.currentUploadImageFingerprint = ${JSON.stringify(inputFingerprint)};
    factory.product.lockedInputImageFingerprint = ${JSON.stringify(inputFingerprint)};
    factory.goalRun = factory.goalRun || {};
    factory.automation = factory.automation || {};
    factory.goalRun.currentRunId = ${JSON.stringify(runId)};
    factory.automation.currentRunId = ${JSON.stringify(runId)};
    factory.stages.size = {
      ...(factory.stages.size || {}),
      currentRunId: ${JSON.stringify(runId)},
      latestGenerationRunId: ${JSON.stringify(runId)},
      status: 'idle',
    };
    state.cuts = state.cuts || {};
    state.cuts.factoryStageId = 'size';
    state.cuts.sizeFactoryStageId = 'size';
    state.cuts.sizePromptSlotCount = 3;
    state.cuts.sizePrompts = [1, 2, 3].map(index => stampCutPromptSource({
      id: 'stepwise_size_' + index,
      label: '사이즈 복구 ' + index,
      prompt: '현재 제품 사이즈컷 복구 확인 ' + index,
      result: null,
      generating: false,
      error: '',
      factoryStageId: 'size',
      stageId: 'size',
    }, 'size'));
    factory.assets = (factory.assets || []).filter(asset => asset?.stageId !== 'size');
    return {
      productName: state.productName,
      productKey: factoryCurrentProductKey(factory),
      inputImageFingerprint: factoryCurrentInputImageFingerprint(factory),
      helper: typeof factorySetCurrentProductIdentity,
    };
  })()`;
}

function summaryExpression() {
  return `(() => {
    const factory = factoryState();
    const usable = factoryUsableAssetsForStage('size', factory);
    return {
      productName: state.productName,
      productKey: factoryCurrentProductKey(factory),
      inputImageFingerprint: factoryCurrentInputImageFingerprint(factory),
      localStatus: factory.archive?.localStatus || '',
      assetCount: (factory.assets || []).filter(asset => asset?.stageId === 'size').length,
      usable: usable.length,
      assets: usable.map(asset => ({
        archiveId: asset.archiveId || asset.localArchiveId,
        title: asset.title,
        hasImage: !!factoryAssetDisplayImage(asset),
        match: factoryAssetMatchesCurrentJob(asset, 'size', factory),
      })),
      prompts: (state.cuts?.sizePrompts || []).map(prompt => ({
        id: prompt.id,
        result: !!prompt.result,
        archiveId: prompt.archiveId || prompt.localArchiveId || '',
      })),
    };
  })()`;
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const list = await fetchJson(`http://127.0.0.1:5050/api/local-archive/assets?limit=6&stageId=size&productKey=${encodeURIComponent(productName)}`);
  const rows = (list.items || list.assets || []).filter(row => row.archiveId).slice(0, 3);
  if (!rows.length) throw new Error('restore candidates not found');
  const runId = rows[0].currentRunId;
  const inputFingerprint = String(rows[0].inputImageFingerprint || '').trim();
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  const evidence = { rows: rows.map(row => ({ archiveId: row.archiveId, title: row.title, productKey: row.productKey })), steps: [] };
  await cdp.opened;
  try {
    await timedSend(cdp, 'Page.enable');
    await timedSend(cdp, 'Runtime.enable');
    await timedSend(cdp, 'Network.enable');
    await timedSend(cdp, 'Network.setCacheDisabled', { cacheDisabled: true });
    await timedSend(cdp, 'Page.navigate', { url: `${APP_URL}?restoreStepwise=${Date.now()}` });
    await waitFor(cdp, `typeof render === 'function' && typeof factoryLoadLocalArchiveAsset === 'function'`, 30000);
    evidence.bootstrap = await evaluate(cdp, stepExpression({ productName, runId, inputFingerprint }));
    for (const row of rows) {
      const before = await evaluate(cdp, summaryExpression());
      let loadResult = null;
      let error = '';
      try {
        loadResult = await evaluate(cdp, `(async () => await factoryLoadLocalArchiveAsset(${JSON.stringify(row.archiveId)}, { silent: true, productName: ${JSON.stringify(productName)}, productKey: ${JSON.stringify(productName)} }))()`);
      } catch (err) {
        error = err?.message || String(err);
      }
      const after = error ? null : await evaluate(cdp, summaryExpression());
      evidence.steps.push({ archiveId: row.archiveId, before, loadResult, error, after });
      if (error) break;
    }
    evidence.final = await evaluate(cdp, summaryExpression()).catch(err => ({ error: err?.message || String(err) }));
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: !evidence.steps.some(step => step.error), outPath, final: evidence.final }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    if (runtime.cleanup) await runtime.cleanup();
  }
})().catch(err => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ fatal: err?.stack || err?.message || String(err) }, null, 2), 'utf8');
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
