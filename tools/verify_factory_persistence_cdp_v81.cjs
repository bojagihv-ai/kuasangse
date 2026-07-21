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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');

function svgData(label, color = '#ef4444', bytes = 180000) {
  const filler = `${label}-`.repeat(Math.max(1, Math.ceil(bytes / Math.max(1, label.length + 1))));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <rect width="960" height="640" fill="#fff7f2"/>
  <rect x="68" y="70" width="824" height="500" rx="42" fill="${color}"/>
  <circle cx="248" cy="320" r="108" fill="rgba(255,255,255,.2)"/>
  <text x="480" y="305" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="#ffffff">${label}</text>
  <text x="480" y="372" text-anchor="middle" font-family="Arial" font-size="20" fill="#dbeafe">${filler.slice(0, 2200)}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

  const seed = String(Date.now());
  const images = {
    input: svgData(`input-${seed}`, '#dc2626', 5000),
    hero: svgData(`hero-${seed}`, '#2563eb'),
    size: svgData(`size-${seed}`, '#059669'),
    cuts: svgData(`cuts-${seed}`, '#7c3aed'),
    section: svgData(`section-${seed}`, '#ea580c'),
  };

  const saved = await evaluate(cdp, `(async () => {
    const images = ${JSON.stringify(images)};
    const productName = 'PersistenceProductV81-${seed}';
    const workspaceId = 'persistence_workspace_v81_${seed}';
    const runId = 'persistence_run_v81_${seed}';
    const inputBase64 = images.input.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const inputFp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(inputBase64) : 'input_fp_${seed}';
    const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(productName) : productName;
    const section = (window.orderedSections ? window.orderedSections() : []).find(item => item.id === 'specifications')
      || (window.orderedSections ? window.orderedSections() : [])[0]
      || { id: 'specifications', label: '상세 스펙' };
    const sectionStageId = 'section_' + section.id;

    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.productName = productName;
    window.state.currentProjectName = productName;
    window.state.imageBase64 = inputBase64;
    window.state.imageMime = 'image/svg+xml';
    window.state.imagePreview = images.input;
    window.state.imageName = 'persistence-input.svg';
    window.state.sectionContents = window.state.sectionContents || {};
    window.state.sectionImages = window.state.sectionImages || {};
    window.state.sectionContents[section.id] = {
      headline: productName + ' 상세 스펙',
      subheadline: '저장/복원 회귀 검증',
      body_text: '로컬 보관 이미지가 새로고침 뒤에도 현재 작업 기준으로 복원되어야 합니다.',
      extra_elements: ['대표컷 보존', '사이즈컷 보존', '이미지컷 보존'],
    };
    window.state.sectionImages[section.id] = images.section;

    window.state.factory = window.normalizeFactoryState ? window.normalizeFactoryState({}) : {};
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, { projectId: workspaceId, projectName: productName, createdAt: Date.now() });
    factory.product = factory.product || {};
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.lockedCurrentRunId = runId;
    factory.product.productKey = productKey;
    factory.product.lockedProductKey = productKey;
    factory.product.inputImageFingerprint = inputFp;
    factory.product.lockedInputImageFingerprint = inputFp;
    factory.product.imageBase64 = inputBase64;
    factory.product.imageMime = 'image/svg+xml';
    factory.product.imagePreview = images.input;
    factory.product.imageName = 'persistence-input.svg';
    factory.product.hasImage = true;
    factory.product.inputImages = [{
      id: 'persistence_input_${seed}',
      name: 'persistence-input.svg',
      base64: inputBase64,
      mime: 'image/svg+xml',
      preview: images.input,
      hasImage: true,
      productKey,
      currentRunId: runId,
      inputImageFingerprint: inputFp,
      sourceImageKey: inputFp,
      productImageKey: inputFp,
      workspaceId,
    }];
    factory.automation = factory.automation || {};
    factory.automation.currentRunId = runId;
    factory.automation.activeTab = 'assets';
    factory.archive = factory.archive || {};
    factory.archive.autoSave = true;
    factory.assets = [];
    factory.stages = factory.stages || {};
    ['hero', 'size', 'cuts'].forEach(stageId => {
      factory.stages[stageId] = {
        ...(factory.stages[stageId] || {}),
        status: 'done',
        message: '보존 검증 후보',
        currentRunId: runId,
        latestGenerationRunId: runId,
        selectedAssetIds: [],
      };
    });
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    let authority = await lock.acquire({
      scopeId: 'project:' + workspaceId,
      ownerId: 'generated image persistence regression',
    });
    if (authority.mode !== 'editing') {
      authority = await lock.takeover({
        confirmed: true,
        scopeId: 'project:' + workspaceId,
        ownerId: 'generated image persistence regression',
      });
    }
    if (authority.mode !== 'editing') throw new Error('generated image authority acquisition failed');

    const stageImages = [
      ['hero', images.hero, '보존 대표이미지'],
      ['size', images.size, '보존 사이즈이미지'],
      ['cuts', images.cuts, '보존 이미지컷'],
    ];
    const savedAssets = [];
    for (const [stageId, image, title] of stageImages) {
      const asset = window.factoryRegisterAsset(stageId, image, {
        title,
        currentRunId: runId,
        generationRunId: runId,
        productKey,
        inputImageFingerprint: inputFp,
        workspaceId,
        used: true,
        skipLocalArchive: true,
        metadata: { productName, productKey, currentRunId: runId, generationRunId: runId, inputImageFingerprint: inputFp, stageId, workspaceId },
        sourceMap: { productName, productKey, currentRunId: runId, generationRunId: runId, inputImageFingerprint: inputFp, stageId, workspaceId, source: 'persistence-v81' },
      });
      if (!asset) throw new Error(stageId + ' 후보 등록 실패');
      if (factory.stages[stageId]) factory.stages[stageId].selectedAssetIds = window.uniqueApiKeys([...(factory.stages[stageId].selectedAssetIds || []), asset.id]);
      const ok = await window.factoryQueueLocalArchiveAsset(asset, 'persistence-v81');
      savedAssets.push({ stageId, assetId: asset.id, ok });
    }

    const sectionAsset = {
      id: 'persistence_section_${seed}',
      stageId: sectionStageId,
      type: 'image',
      title: '보존 섹션이미지',
      image: images.section,
      content: window.state.sectionContents[section.id],
      currentRunId: runId,
      generationRunId: runId,
      productKey,
      inputImageFingerprint: inputFp,
      metadata: { productName, productKey, currentRunId: runId, generationRunId: runId, inputImageFingerprint: inputFp, stageId: sectionStageId, sectionId: section.id },
      sourceMap: { productName, productKey, currentRunId: runId, generationRunId: runId, inputImageFingerprint: inputFp, stageId: sectionStageId, sectionId: section.id, source: 'persistence-v81' },
    };
    const sectionOk = await window.factoryQueueLocalArchiveAsset(sectionAsset, 'persistence-v81-section');
    savedAssets.push({ stageId: sectionStageId, assetId: sectionAsset.id, ok: sectionOk });

    const inputOk = await window.factoryArchiveCurrentInputImage({
      base64: inputBase64,
      mime: 'image/svg+xml',
      preview: images.input,
      name: 'persistence-input.svg',
      inputImageFingerprint: inputFp,
      uploadedAt: Date.now(),
    }, { reason: 'persistence-v81-input' });

    if (typeof window.factoryRefreshLocalArchiveAssets === 'function') {
      await window.factoryRefreshLocalArchiveAssets({ force: true, silent: true, limit: 180 });
    }
    const latestFactory = window.factoryState();
    const archiveRows = Array.isArray(latestFactory.archive?.localAssets) ? latestFactory.archive.localAssets : [];
    savedAssets.forEach(item => {
      const liveAsset = (latestFactory.assets || []).find(asset => String(asset?.id || '') === String(item.assetId || ''));
      const archiveRow = archiveRows.find(row => (
        String(row?.stageId || '') === String(item.stageId || '')
        && String(row?.productKey || '') === productKey
        && String(row?.currentRunId || '') === runId
      ));
      item.archiveId = liveAsset?.archiveId || liveAsset?.localArchive?.archiveId || archiveRow?.archiveId || '';
      item.imagePersistence = liveAsset?.imagePersistence || '';
      item.inlineImageLength = Number(liveAsset?.inlineImageLength || 0);
    });
    if (typeof window.saveLastWorkNow === 'function') window.saveLastWorkNow({ deep: true });
    if (typeof window.saveFactoryLastSnapshot === 'function') window.saveFactoryLastSnapshot(latestFactory);
    await new Promise(resolve => setTimeout(resolve, 1700));
    window.render();
    await new Promise(resolve => setTimeout(resolve, 500));
    const savedFactory = window.factoryState();

    return {
      workspaceId,
      productName,
      productKey,
      runId,
      inputFp,
      sectionId: section.id,
      sectionStageId,
      inputOk,
      inputArchiveId: savedFactory.archive?.currentInputArchive?.archiveId || '',
      savedAssets,
      assetCount: Array.isArray(savedFactory.assets) ? savedFactory.assets.length : 0,
      localRoot: savedFactory.archive?.localRoot || '',
      heavyInlineCount: (Array.isArray(savedFactory.assets) ? savedFactory.assets : []).filter(asset => /^data:image\\//i.test(String(asset.image || '')) && String(asset.image || '').length > 180000).length,
    };
  })()`);

  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);
  await new Promise(resolve => setTimeout(resolve, 2200));

  const restored = await evaluate(cdp, `(async () => {
    const expected = ${JSON.stringify(saved)};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    window.state.currentProjectId = expected.workspaceId;
    window.state.currentProjectName = expected.productName;
    const authority = await window.ensureWorkspaceEditAuthority('project:' + expected.workspaceId, {
      force: true,
      confirmedTakeover: true,
    });
    if (authority?.mode !== 'editing') throw new Error('generated image restore authority acquisition failed');
    let factory = window.factoryState();
    const before = {
      productName: factory.product?.productName || window.state.productName || '',
      hasProductPayload: !!(window.currentProductImagePayload && window.currentProductImagePayload({ allowDerived: false, prefer: 'factory' })?.base64),
      assets: Array.isArray(factory.assets) ? factory.assets.length : 0,
      heroUsable: window.factoryUsableAssetsForStage ? window.factoryUsableAssetsForStage('hero', factory).length : 0,
      sizeUsable: window.factoryUsableAssetsForStage ? window.factoryUsableAssetsForStage('size', factory).length : 0,
      cutsUsable: window.factoryUsableAssetsForStage ? window.factoryUsableAssetsForStage('cuts', factory).length : 0,
      sectionImage: !!(window.state.sectionImages && window.state.sectionImages[expected.sectionId]),
    };

    if (typeof window.factoryLoadLocalArchiveAsset === 'function' && expected.inputArchiveId && !before.hasProductPayload) {
      await window.factoryLoadLocalArchiveAsset(expected.inputArchiveId, { silent: true });
      await wait(500);
    }
    factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, {
      projectId: expected.workspaceId,
      projectName: expected.productName,
      createdAt: Date.now(),
    });
    factory.product = factory.product || {};
    factory.product.productName = expected.productName;
    factory.product.userProductName = expected.productName;
    factory.product.currentRunId = expected.runId;
    factory.product.generationRunId = expected.runId;
    factory.product.lockedCurrentRunId = expected.runId;
    factory.product.productKey = expected.productKey;
    factory.product.lockedProductKey = expected.productKey;
    factory.product.inputImageFingerprint = expected.inputFp;
    factory.product.lockedInputImageFingerprint = expected.inputFp;
    factory.automation = factory.automation || {};
    factory.automation.currentRunId = expected.runId;
    factory.automation.activeTab = 'assets';
    factory.stages = factory.stages || {};
    ['hero', 'size', 'cuts'].forEach(stageId => {
      factory.stages[stageId] = {
        ...(factory.stages[stageId] || {}),
        currentRunId: expected.runId,
        latestGenerationRunId: expected.runId,
        status: factory.stages[stageId]?.status || 'done',
      };
    });

    if (typeof window.factoryRefreshLocalArchiveAssets === 'function') {
      await window.factoryRefreshLocalArchiveAssets({ silent: true, limit: 180 });
      await wait(900);
    }
    factory = window.factoryState();
    const archiveAssets = (factory.archive?.localAssets || []).filter(item => (
      String(item.workspaceId || '') === expected.workspaceId &&
      String(item.productKey || '') === expected.productKey &&
      String(item.currentRunId || '') === expected.runId &&
      String(item.inputImageFingerprint || '') === expected.inputFp
    ));
    let restoreResult = { ok: false, restored: 0, total: 0 };
    if (typeof window.factoryRestoreLocalArchiveToCurrentWork === 'function') {
      restoreResult = await window.factoryRestoreLocalArchiveToCurrentWork({ limit: 24 });
    } else {
      for (const item of archiveAssets) {
        if (typeof window.factoryRestoreLocalArchiveAssetFast === 'function' && window.factoryRestoreLocalArchiveAssetFast(item, factory)) {
          restoreResult.restored += 1;
        }
      }
    }
    if (typeof window.render === 'function') window.render();
    await wait(1400);

    factory = window.factoryState();
    const imgs = Array.from(document.images || []);
    const sectionImage = window.state.sectionImages?.[expected.sectionId] || '';
    const stageSummary = Object.fromEntries(['hero', 'size', 'cuts'].map(stageId => {
      const usable = window.factoryUsableAssetsForStage ? window.factoryUsableAssetsForStage(stageId, factory) : [];
      const selected = usable.filter(asset => asset.used);
      return [stageId, {
        usable: usable.length,
        selected: selected.length,
        sampleImage: String((selected[0] || usable[0] || {}).image || (selected[0] || usable[0] || {}).imageUrl || '').slice(0, 120),
      }];
    }));
    return {
      before,
      currentProductName: factory.product?.productName || window.state.productName || '',
      hasProductPayload: !!(window.currentProductImagePayload && window.currentProductImagePayload({ allowDerived: false, prefer: 'factory' })?.base64),
      archiveAssets: archiveAssets.map(item => ({ archiveId: item.archiveId, stageId: item.stageId, imageUrl: item.imageUrl || '', workspaceId: item.workspaceId || '', productKey: item.productKey, runId: item.currentRunId, fingerprint: item.inputImageFingerprint || '' })),
      rawAssets: (factory.assets || []).map(item => ({
        id: item.id,
        stageId: item.stageId || '',
        workspaceId: item.workspaceId || item.metadata?.workspaceId || item.sourceMap?.workspaceId || '',
        currentRunId: item.currentRunId || item.generationRunId || item.metadata?.currentRunId || '',
        productKey: item.productKey || item.metadata?.productKey || '',
        inputImageFingerprint: item.inputImageFingerprint || item.metadata?.inputImageFingerprint || '',
      })),
      restoredCount: restoreResult.restored || 0,
      restoreResult,
      stageSummary,
      sectionImage: String(sectionImage).slice(0, 160),
      sectionImageOk: /^data:image\\//i.test(String(sectionImage)) || /\\/api\\/local-archive\\/assets\\//i.test(String(sectionImage)) || /^https?:\\/\\/127\\.0\\.0\\.1:\\d+\\/api\\/local-archive\\/assets\\//i.test(String(sectionImage)),
      domNodes: document.querySelectorAll('*').length,
      imgCount: imgs.length,
      heavyDataImgCount: imgs.filter(img => /^data:image\\//i.test(String(img.src || '')) && String(img.src || '').length > 180000).length,
      brokenImageCount: imgs.filter(img => img.complete && !img.naturalWidth && String(img.src || '')).length,
      renderMs: window.__KUASANGSE_RENDER_LAST_MS__ || 0,
      localRoot: factory.archive?.localRoot || '',
    };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(OUT_DIR, 'factory-persistence-cdp-v81.png');
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  await cdp.close();
  await cdpRuntime.cleanup();

  const savedArchiveCount = [
    saved.inputArchiveId,
    ...saved.savedAssets.map(item => item.archiveId),
  ].filter(Boolean).length;
  const resultPath = path.join(OUT_DIR, 'factory-persistence-cdp-v81-result.json');
  fs.writeFileSync(resultPath, JSON.stringify({ url: APP_URL, saved, restored, screenshot }, null, 2), 'utf8');

  assertChecks([
    { ok: saved.inputOk === true && !!saved.inputArchiveId, message: '제품 원본 입력 이미지 로컬 보관 실패' },
    { ok: saved.savedAssets.every(item => item.ok && item.archiveId), message: `생성 이미지 로컬 보관 실패: ${JSON.stringify(saved.savedAssets)}` },
    { ok: saved.heavyInlineCount === 0, message: `보관 후 무거운 inline 이미지가 후보에 남았습니다: ${saved.heavyInlineCount}` },
    { ok: savedArchiveCount >= 5, message: `저장된 archiveId가 부족합니다: ${savedArchiveCount}` },
    { ok: restored.currentProductName === saved.productName, message: `새로고침 후 상품명 불일치: ${restored.currentProductName}` },
    { ok: restored.hasProductPayload === true, message: '새로고침 후 현재 제품 원본 이미지 payload가 없습니다.' },
    { ok: restored.archiveAssets.length >= 5, message: `현재 작업 로컬 보관 목록 부족: ${restored.archiveAssets.length}` },
    { ok: restored.restoredCount >= 2, message: `로컬 보관 복원 수 부족: ${restored.restoredCount}` },
    { ok: restored.stageSummary.hero.usable > 0, message: '대표이미지 후보 복원 실패' },
    { ok: restored.stageSummary.size.usable > 0, message: '사이즈이미지 후보 복원 실패' },
    { ok: restored.stageSummary.cuts.usable > 0, message: '이미지컷 후보 복원 실패' },
    { ok: restored.sectionImageOk === true, message: `섹션 이미지 복원 실패: ${restored.sectionImage}` },
    { ok: restored.heavyDataImgCount <= 2, message: `새로고침 후 무거운 data:image가 DOM에 과다 잔류: ${restored.heavyDataImgCount}` },
    { ok: restored.brokenImageCount === 0, message: `새로고침 후 깨진 이미지가 남았습니다: ${restored.brokenImageCount}` },
    { ok: restored.domNodes <= 9000, message: `새로고침 후 DOM 노드가 너무 많습니다: ${restored.domNodes}` },
    { ok: restored.renderMs <= 900, message: `새로고침 후 렌더가 너무 느립니다: ${restored.renderMs}ms` },
  ]);

  console.log(JSON.stringify({ url: APP_URL, saved, restored, screenshot, resultPath }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
