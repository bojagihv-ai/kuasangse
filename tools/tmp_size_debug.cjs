const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

(async () => {
  const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
  const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';

  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No CDP page target found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

  const base64ify = s => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
  const seed = Date.now();
  const productName = 'tmpdbg-' + seed;
  const runId = 'run-' + seed;
  const productKey = productName.toLowerCase();
  const input = base64ify('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="red"/></svg>');
  const inputBase64 = input.replace(/^data:image\/[^;,]+;base64,/, '');
  const inputFp = await evaluate(cdp, 'window.factoryImagePayloadFingerprint(' + JSON.stringify(inputBase64) + ')');

  const data = {
    productName,
    runId,
    productKey,
    inputFp,
    inputBase64,
    input,
    images: {
      hero: base64ify('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="blue"/></svg>'),
      size: base64ify('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="green"/></svg>'),
      cuts: base64ify('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="purple"/></svg>'),
    },
  };

  const script = `
    (async function(p){
      window.state.step = 'factory';
      window.state.productName = p.productName;
      window.state.currentProjectName = p.productName;
      window.state.imageBase64 = p.inputBase64;
      window.state.imageMime = 'image/svg+xml';
      window.state.imagePreview = p.input;
      window.state.imageName = 'input.svg';
      window.factory = window.normalizeFactoryState ? window.normalizeFactoryState({}) : {};
      const factory = window.factoryState();
      factory.product = factory.product || {};
      Object.assign(factory.product, {
        productName: p.productName,
        userProductName: p.productName,
        currentRunId: p.runId,
        generationRunId: p.runId,
        lockedCurrentRunId: p.runId,
        productKey: p.productKey,
        lockedProductKey: p.productKey,
        inputImageFingerprint: p.inputFp,
        lockedInputImageFingerprint: p.inputFp,
      });
      ['hero','size','cuts'].forEach(stageId => {
        factory.stages[stageId] = {
          currentRunId: p.runId,
          latestGenerationRunId: p.runId,
          status: 'done',
          message: 'done'
        };
      });

      const trace = [];
      for (const stageId of ['hero','size','cuts']) {
        const img = p.images[stageId];
        const asset = window.factoryRegisterAsset(stageId, img, {
          title: stageId + ' title',
          currentRunId: p.runId,
          generationRunId: p.runId,
          productKey: p.productKey,
          inputImageFingerprint: p.inputFp,
          used: true,
          skipLocalArchive: true,
          metadata: { productName: p.productName, productKey: p.productKey, currentRunId: p.runId, generationRunId: p.runId, inputImageFingerprint: p.inputFp, stageId },
          sourceMap: { productName: p.productName, productKey: p.productKey, currentRunId: p.runId, generationRunId: p.runId, inputImageFingerprint: p.inputFp, stageId },
        });
        const stageLog = {
          stageId,
          assetNull: asset === null,
          hasAsset: !!asset,
          imageLen: asset ? String(asset.image || '').length : 0,
          beforeHasImage: !!(asset && /^data:image/.test(String(asset.image || ''))),
          assetId: asset ? asset.id : '',
        };
        if (asset) {
          try {
            const ok = await window.factoryQueueLocalArchiveAsset(asset, 'tmpdbg');
            stageLog.queueOk = ok;
            stageLog.archiveId = String(asset.archiveId || (asset.localArchive && asset.localArchive.archiveId) || '');
            stageLog.localArchive = asset.localArchive || null;
            stageLog.imageUrl = String(asset.imageUrl || '');
          } catch (e) {
            stageLog.queueOk = false;
            stageLog.error = String(e && e.message || e || '');
          }
        }
        trace.push(stageLog);
      }
      return trace;
    })(__PAYLOAD__)
  `;

  const out = await evaluate(cdp, script.replace('__PAYLOAD__', JSON.stringify(data)));
  console.log(JSON.stringify(out, null, 2));

  await cdp.close();
  await cdpRuntime.cleanup();
})();
