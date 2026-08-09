const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertChecks, connectCdp, currentSourceBuildId, ensureCdp, evaluate, evaluateFactoryCdpFixture, factoryCdpFixtureReadyExpression, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), '.omo', 'evidence', 'factory-new-work-input-image-v166');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-new-work-input-image-v166.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-new-work-input-image-v166.json');
const NEW_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M/wHwAF/gL+Q8rXAAAAAElFTkSuQmCC';

function svgDataUrl(label, color = '#b91c1c') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#fff7ed"/><rect x="70" y="92" width="500" height="230" rx="28" fill="${color}"/><text x="320" y="220" text-anchor="middle" font-size="30" font-family="Arial" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  const expectedBuildId = currentSourceBuildId();
  const tempImagePath = path.join(os.tmpdir(), `kuasangse-new-work-input-${process.pid}-${Date.now()}.png`);
  let cdpRuntime = null;
  let cdp = null;
  let failure = null;
  let record = { ok: false, expectedBuildId, tempImagePath };

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(tempImagePath, Buffer.from(NEW_IMAGE_BASE64, 'base64'));
    cdpRuntime = await ensureCdp(CDP_URL);
    const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    for (const [method, params] of [
      ['Page.enable'], ['Network.enable'], ['Runtime.enable'], ['DOM.enable'],
      ['Network.setCacheDisabled', { cacheDisabled: true }],
      ['Emulation.setDeviceMetricsOverride', {
        width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1280),
        height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 860),
        deviceScaleFactor: 1,
        mobile: false,
      }],
    ]) await cdp.send(method, params);
    await cdp.send('Page.navigate', { url: `${APP_URL}?newWorkInputImage=v166` });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof startBlankWorkDraft === 'function'
      && typeof factoryRuntimeReadFactory === 'function'
      && typeof factoryRuntimeReplaceFactorySnapshot === 'function'`, 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);

    const oldPreview = svgDataUrl('factory-new-work-old-v166');
    const oldBase64 = oldPreview.split(',', 2)[1] || '';
    const oldProductName = 'factory-new-work-old-v166';
    const oldWorkspaceId = `project:${oldProductName}-${Date.now()}`;
    const oldCandidateId = 'factory-new-work-old-candidate-v166';
    const oldAssetId = 'factory-new-work-old-asset-v166';
    const oldPreviousAssetId = 'factory-new-work-old-previous-asset-v166';
    const oldCutResultId = 'factory-new-work-old-cut-result-v166';
    const oldRunId = 'factory-new-work-old-run-v166';
    const oldSeed = await evaluateFactoryCdpFixture(cdp, `(async ({ setAppState, cloneFactory, replaceFactory, readAppState, readFactory, renderApp }) => {
      const oldPreview = ${JSON.stringify(oldPreview)};
      const oldBase64 = ${JSON.stringify(oldBase64)};
      const oldProductName = ${JSON.stringify(oldProductName)};
      const oldWorkspaceId = ${JSON.stringify(oldWorkspaceId)};
      const oldCandidateId = ${JSON.stringify(oldCandidateId)};
      const asset = id => ({ id, stageId: 'hero', type: 'image', title: oldProductName, image: oldPreview, currentRunId: ${JSON.stringify(oldRunId)}, generationRunId: ${JSON.stringify(oldRunId)} });
      const productKey = typeof factoryNormalizeIdentityText === 'function' ? factoryNormalizeIdentityText(oldProductName) : oldProductName;
      setAppState({ step: 'factory', currentProjectId: oldWorkspaceId, currentProjectName: oldProductName, currentProjectCreatedAt: Date.now(), workspaceDocumentDirty: true, productName: oldProductName, imageBase64: oldBase64, imageMime: 'image/svg+xml', imagePreview: oldPreview, imageName: 'factory-new-work-old-v166.svg', analysisImages: [{ name: 'factory-new-work-old-v166.svg', mime: 'image/svg+xml', base64: oldBase64, preview: oldPreview }], dbMatchCandidates: [{ id: oldCandidateId, productName: oldProductName }], cuts: { results: [{ id: ${JSON.stringify(oldCutResultId)}, image: oldPreview }] } });
      const factory = cloneFactory();
      factory.workspace = { ...(factory.workspace || {}), id: oldWorkspaceId, name: oldProductName, createdAt: Date.now() };
      factory.currentProjectId = oldWorkspaceId;
      factory.currentProjectName = oldProductName;
      factory.product = { ...(factory.product || {}), productName: oldProductName, userProductName: oldProductName, productKey, productIdentityKey: productKey, currentRunId: ${JSON.stringify(oldRunId)}, generationRunId: ${JSON.stringify(oldRunId)}, imageBase64: oldBase64, imagePreview: oldPreview, imageMime: 'image/svg+xml', imageName: 'factory-new-work-old-v166.svg', inputImageFingerprint: 'factory-new-work-old-fingerprint-v166', lockedInputImageFingerprint: 'factory-new-work-old-fingerprint-v166', inputImages: [{ id: 'factory-new-work-old-input-v166', name: 'factory-new-work-old-v166.svg', mime: 'image/svg+xml', base64: oldBase64, preview: oldPreview, lockedInput: true }], competitors: [{ id: oldCandidateId, productName: oldProductName }], pendingDbCandidates: [{ id: oldCandidateId, productName: oldProductName }], dbCandidates: [{ id: oldCandidateId, productName: oldProductName }], pendingCafe24Candidates: [{ id: oldCandidateId, productName: oldProductName }], cafe24Candidates: [{ id: oldCandidateId, productName: oldProductName }] };
      factory.automation = { ...(factory.automation || {}), activeTab: 'start', currentRunId: ${JSON.stringify(oldRunId)} };
      factory.assets = [asset(${JSON.stringify(oldAssetId)})];
      factory.previousAssets = [asset(${JSON.stringify(oldPreviousAssetId)})];
      replaceFactory(factory, { mode: 'hydrate', workspaceId: oldWorkspaceId, reason: 'factory-new-work-v166-old-seed' });
      await Promise.resolve(renderApp());
      const app = readAppState();
      const current = readFactory();
      return { appWorkspaceId: app.currentProjectId || '', appWorkspaceName: app.currentProjectName || '', appProductName: app.productName || '', appImageBase64: app.imageBase64 || '', appCutResultIds: (app.cuts?.results || []).map(item => item?.id), appCandidateCount: (app.dbMatchCandidates || []).length, factoryWorkspaceId: current.workspace?.id || '', factoryWorkspaceName: current.workspace?.name || '', factoryCurrentProjectId: current.currentProjectId || '', factoryCurrentProjectName: current.currentProjectName || '', factoryProductName: current.product?.productName || '', factoryImageBase64: current.product?.imageBase64 || '', factoryInputCount: (current.product?.inputImages || []).length, factoryCandidateCount: (current.product?.competitors || []).length, factoryAssetIds: (current.assets || []).map(item => item?.id), factoryPreviousAssetIds: (current.previousAssets || []).map(item => item?.id), oldRenderedImageCount: [...document.images].filter(img => String(img.src || '').includes(oldBase64)).length, bodyHasOldProduct: (document.body.innerText || '').includes(oldProductName) };
    })`);

    const resetProof = await evaluateFactoryCdpFixture(cdp, `(async ({ readAppState, readFactory }) => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rows = (...values) => values.flatMap(value => Array.isArray(value) ? value : []);
      const button = ['#factoryWorkspaceNewWorkBtn', '#factoryNewWorkBtn', '#blankWorkBtn'].map(selector => document.querySelector(selector)).find(Boolean);
      if (!button) throw new Error('새 작업 버튼을 찾지 못했습니다.');
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      button.click();
      let modalChoice = '';
      const modalDeadline = Date.now() + 10000;
      while (Date.now() < modalDeadline) {
        const discard = document.querySelector('#workspaceDocumentModal [data-choice="discard"]');
        if (discard) { modalChoice = 'discard'; discard.click(); break; }
        if (!document.querySelector('#workspaceDocumentModal')) break;
        await wait(25);
      }
      const settled = () => {
        const app = readAppState();
        const current = readFactory();
        const product = current.product || {};
        const inputImages = Array.isArray(product.inputImages) ? product.inputImages : [];
        const cutsResults = Array.isArray(app.cuts?.results) ? app.cuts.results : [];
        const candidates = rows(product.competitors, product.pendingDbCandidates, product.dbCandidates, product.pendingCafe24Candidates, product.cafe24Candidates);
        const hasImage = !!(app.imageBase64 || app.imagePreview || product.imageBase64 || product.imagePreview
          || inputImages.some(item => item?.base64 || item?.preview || item?.dataUrl)
          || cutsResults.some(item => item?.image || item?.base64 || item?.preview));
        const identityBlank = !String(app.currentProjectId || '').trim() && !String(app.currentProjectName || '').trim()
          && !String(current.workspace?.id || '').trim() && !String(current.workspace?.name || '').trim()
          && !String(current.currentProjectId || '').trim() && !String(current.currentProjectName || '').trim();
        const pending = (typeof workspaceBlankResetInProgress !== 'undefined' && workspaceBlankResetInProgress)
          || (typeof persistentStateSaving !== 'undefined' && persistentStateSaving)
          || (typeof lastWorkSaveTimer !== 'undefined' && lastWorkSaveTimer);
        return !hasImage && !String(app.productName || '').trim() && !String(product.productName || product.userProductName || '').trim()
          && inputImages.length === 0 && cutsResults.length === 0 && candidates.length === 0
          && (current.assets || []).length === 0 && (current.previousAssets || []).length === 0 && identityBlank && !pending
          && !document.querySelector('#workspaceDocumentModal');
      };
      let blankResetSettled = false;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) { blankResetSettled = settled(); if (blankResetSettled) break; await wait(50); }
      const app = readAppState();
      const current = readFactory();
      const product = current.product || {};
      const inputImages = Array.isArray(product.inputImages) ? product.inputImages : [];
      const cutsResults = Array.isArray(app.cuts?.results) ? app.cuts.results : [];
      const candidates = rows(product.competitors, product.pendingDbCandidates, product.dbCandidates, product.pendingCafe24Candidates, product.cafe24Candidates);
      const appRefs = [app];
      const factoryRefs = [current];
      const oldRef = value => { const text = JSON.stringify(value); return text.includes(${JSON.stringify(oldBase64)}) || text.includes(${JSON.stringify(oldPreview)}); };
      return {
        clickedButtonId: button.id, modalChoice, blankResetSettled,
        currentProjectId: app.currentProjectId || '', currentProjectName: app.currentProjectName || '', productName: app.productName || '',
        imageBase64: app.imageBase64 || '', imagePreview: app.imagePreview || '', analysisImages: (app.analysisImages || []).length,
        appCutResultIds: cutsResults.map(item => item?.id), appOldRef: appRefs.some(oldRef),
        factoryWorkspaceId: current.workspace?.id || '', factoryWorkspaceName: current.workspace?.name || '',
        factoryCurrentProjectId: current.currentProjectId || '', factoryCurrentProjectName: current.currentProjectName || '',
        factoryProductName: product.productName || product.userProductName || '', factoryImageBase64: product.imageBase64 || '', factoryImagePreview: product.imagePreview || '',
        factoryInputCount: inputImages.length, factoryCandidateCount: candidates.length, factoryAssetIds: (current.assets || []).map(item => item?.id),
        factoryPreviousAssetIds: (current.previousAssets || []).map(item => item?.id), factoryOldRef: factoryRefs.some(oldRef),
        bodyHasOldProduct: (document.body.innerText || '').includes(${JSON.stringify(oldProductName)}),
        oldRenderedImageCount: [...document.images].filter(img => { const src = String(img.src || ''); return src.includes(${JSON.stringify(oldBase64)}) || src.includes(${JSON.stringify(oldPreview)}); }).length,
        fileInputPresent: !!document.querySelector('#factoryGuideProductFile'),
      };
    })`);
    if (!resetProof.fileInputPresent) {
      const startTab = await evaluate(cdp, `(() => { const tab = document.querySelector('[data-factory-auto-tab="start"]'); if (tab) tab.click(); return !!tab; })()`);
      if (!startTab) throw new Error('시작 탭 버튼을 찾지 못했습니다.');
      await waitFor(cdp, '!!document.querySelector("#factoryGuideProductFile")', 10000);
    }

    const documentRoot = await cdp.send('DOM.getDocument', { depth: -1 });
    const inputNode = await cdp.send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#factoryGuideProductFile' });
    if (!inputNode.nodeId) throw new Error('시작 탭 제품 이미지 file input을 찾지 못했습니다.');
    await evaluate(cdp, `(() => {
      const input = document.querySelector('#factoryGuideProductFile');
      if (!input || !input.isConnected) throw new Error('제품 이미지 file input이 업로드 직전에 사라졌습니다.');
      globalThis.__factoryNewWorkFileEvents = [];
      input.addEventListener('change', event => {
        const current = document.querySelector('#factoryGuideProductFile');
        globalThis.__factoryNewWorkFileEvents.push({ files: event.target?.files?.length || 0, name: event.target?.files?.[0]?.name || '',
          targetId: event.target?.id || '', targetConnected: event.target?.isConnected === true, targetIsCurrent: event.target === current, trusted: event.isTrusted === true });
      }, { capture: true });
      return true;
    })()`);
    await cdp.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [tempImagePath] });
    await new Promise(resolve => setTimeout(resolve, 100));
    const fileInputChangeProof = await evaluate(cdp, `(() => {
      const input = document.querySelector('#factoryGuideProductFile');
      const events = Array.isArray(globalThis.__factoryNewWorkFileEvents) ? [...globalThis.__factoryNewWorkFileEvents] : [];
      return { id: input?.id || '', connected: input?.isConnected === true, files: input?.files?.length || 0, eventCount: events.length, events };
    })()`);
    record.fileInputChangeProof = fileInputChangeProof;
    if (fileInputChangeProof.eventCount !== 1 || fileInputChangeProof.events[0]?.files !== 1
      || fileInputChangeProof.events[0]?.targetId !== 'factoryGuideProductFile'
      || !fileInputChangeProof.events[0]?.targetConnected || !fileInputChangeProof.events[0]?.targetIsCurrent || !fileInputChangeProof.events[0]?.trusted) {
      throw new Error(`현재 연결된 start 탭 input의 native change 1회 증명이 없습니다: ${JSON.stringify(fileInputChangeProof)}`);
    }

    const newBase64Literal = JSON.stringify(NEW_IMAGE_BASE64);
    await waitFor(cdp, `(() => {
      const current = factoryRuntimeReadFactory();
      const product = current?.product || {};
      const inputImages = Array.isArray(product.inputImages) ? product.inputImages : [];
      return state.imageBase64 === ${newBase64Literal} && product.imageBase64 === ${newBase64Literal}
        && inputImages.length > 0 && inputImages.every(item => item?.base64 === ${newBase64Literal})
        && [...document.images].some(img => String(img.src || '').includes(${newBase64Literal}));
    })()`, 30000);
    const uploadProof = await evaluateFactoryCdpFixture(cdp, `(({ readAppState, readFactory }) => {
      const rows = (...values) => values.flatMap(value => Array.isArray(value) ? value : []);
      const app = readAppState();
      const current = readFactory();
      const product = current.product || {};
      const inputImages = Array.isArray(product.inputImages) ? product.inputImages : [];
      const cutsResults = Array.isArray(app.cuts?.results) ? app.cuts.results : [];
      const candidates = rows(product.competitors, product.pendingDbCandidates, product.dbCandidates, product.pendingCafe24Candidates, product.cafe24Candidates);
      const oldRef = value => { const text = JSON.stringify(value); return text.includes(${JSON.stringify(oldBase64)}) || text.includes(${JSON.stringify(oldPreview)}); };
      const appRefs = [app];
      const factoryRefs = [current];
      const imageNodes = [...document.images];
      return {
        runtimeBuildId: String(globalThis.__KUASANGSE_APP_BUILD_ID__ || '').trim(), loaderBuildId: String(document.documentElement?.dataset?.kuasangseBuildId || '').trim(),
        appProductName: app.productName || '', appImageBase64: app.imageBase64 || '', appImagePreview: app.imagePreview || '',
        appCutResultIds: cutsResults.map(item => item?.id), factoryProductName: product.productName || '', factoryUserProductName: product.userProductName || '',
        factoryImageBase64: product.imageBase64 || '', factoryImagePreview: product.imagePreview || '', factoryInputImages: inputImages,
        factoryCandidateCount: candidates.length, factoryAssetIds: (current.assets || []).map(item => item?.id), factoryPreviousAssetIds: (current.previousAssets || []).map(item => item?.id),
        factoryWorkspaceId: current.workspace?.id || '', factoryWorkspaceName: current.workspace?.name || '', factoryCurrentProjectId: current.currentProjectId || '', factoryCurrentProjectName: current.currentProjectName || '',
        appOldRef: appRefs.some(oldRef), factoryOldRef: factoryRefs.some(oldRef), fileInputEventCount: Array.isArray(globalThis.__factoryNewWorkFileEvents) ? globalThis.__factoryNewWorkFileEvents.length : 0, productNameInput: document.querySelector('#factoryGuideProductName')?.value || '',
        newImageNodeCount: imageNodes.filter(img => String(img.src || '').includes(${newBase64Literal})).length,
        oldImageNodeCount: imageNodes.filter(img => { const src = String(img.src || ''); return src.includes(${JSON.stringify(oldBase64)}) || src.includes(${JSON.stringify(oldPreview)}); }).length,
        bodyHasOldProduct: (document.body.innerText || '').includes(${JSON.stringify(oldProductName)}),
      };
    })`);
    const screenshotResult = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshotResult.data, 'base64'));
    const checks = [
      { ok: !!expectedBuildId && uploadProof.runtimeBuildId === expectedBuildId && uploadProof.loaderBuildId === expectedBuildId, message: `runtime-manifest/loader build 불일치: ${JSON.stringify({ expectedBuildId, runtime: uploadProof.runtimeBuildId, loader: uploadProof.loaderBuildId })}` },
      { ok: oldSeed.appWorkspaceId === oldWorkspaceId && oldSeed.appWorkspaceName === oldProductName && oldSeed.appProductName === oldProductName && oldSeed.appImageBase64 === oldBase64 && oldSeed.appCutResultIds.includes(oldCutResultId) && oldSeed.appCandidateCount > 0 && oldSeed.factoryWorkspaceId === oldWorkspaceId && oldSeed.factoryWorkspaceName === oldProductName && oldSeed.factoryCurrentProjectId === oldWorkspaceId && oldSeed.factoryCurrentProjectName === oldProductName && oldSeed.factoryProductName === oldProductName && oldSeed.factoryImageBase64 === oldBase64 && oldSeed.factoryInputCount === 1 && oldSeed.factoryCandidateCount > 0 && oldSeed.factoryPreviousAssetIds.includes(oldPreviousAssetId) && oldSeed.factoryAssetIds.includes(oldAssetId), message: `canonical 이전 workspace/asset fixture가 준비되지 않았습니다: ${JSON.stringify(oldSeed)}` },
      { ok: resetProof.clickedButtonId && resetProof.modalChoice === 'discard', message: `실제 새 작업 버튼/저장 안 함 경로를 통과하지 못했습니다: ${JSON.stringify(resetProof)}` },
      { ok: resetProof.blankResetSettled && !resetProof.currentProjectId && !resetProof.currentProjectName && !resetProof.factoryWorkspaceId && !resetProof.factoryWorkspaceName && !resetProof.factoryCurrentProjectId && !resetProof.factoryCurrentProjectName, message: `새 작업 후 app/canonical workspace identity가 비워지지 않았습니다: ${JSON.stringify(resetProof)}` },
      { ok: !resetProof.productName && !resetProof.factoryProductName && !resetProof.imageBase64 && !resetProof.imagePreview && !resetProof.factoryImageBase64 && !resetProof.factoryImagePreview, message: `새 작업 후 이전 상품명/이미지가 남았습니다: ${JSON.stringify(resetProof)}` },
      { ok: resetProof.analysisImages === 0 && resetProof.appCutResultIds.length === 0 && resetProof.factoryInputCount === 0 && resetProof.factoryCandidateCount === 0 && resetProof.factoryAssetIds.length === 0 && resetProof.factoryPreviousAssetIds.length === 0 && !resetProof.appOldRef && !resetProof.factoryOldRef && !resetProof.bodyHasOldProduct && resetProof.oldRenderedImageCount === 0, message: `새 작업 후 이전 후보·cuts.results·자산·이미지 참조가 남았습니다: ${JSON.stringify(resetProof)}` },
      { ok: fileInputChangeProof.eventCount === 1 && uploadProof.fileInputEventCount === 1 && fileInputChangeProof.events[0].files === 1 && fileInputChangeProof.events[0].targetIsCurrent && fileInputChangeProof.events[0].targetConnected && fileInputChangeProof.events[0].trusted, message: `현재 연결된 start 탭 file input native change가 정확히 1회 발생하지 않았습니다: ${JSON.stringify({ fileInputChangeProof, finalEventCount: uploadProof.fileInputEventCount })}` },
      { ok: uploadProof.appImageBase64 === NEW_IMAGE_BASE64 && uploadProof.appImagePreview.includes(NEW_IMAGE_BASE64) && uploadProof.factoryImageBase64 === NEW_IMAGE_BASE64 && uploadProof.factoryImagePreview.includes(NEW_IMAGE_BASE64) && uploadProof.factoryInputImages.length === 1 && uploadProof.factoryInputImages[0].base64 === NEW_IMAGE_BASE64 && String(uploadProof.factoryInputImages[0].preview || '').includes(NEW_IMAGE_BASE64) && uploadProof.newImageNodeCount > 0, message: `NEW 이미지가 app/canonical product/inputImages/render에 수렴하지 않았습니다: ${JSON.stringify(uploadProof)}` },
      { ok: !uploadProof.appProductName && !uploadProof.factoryProductName && !uploadProof.factoryUserProductName && !uploadProof.productNameInput, message: `새 이미지 업로드만으로 제품명이 자동 입력되었습니다: ${JSON.stringify(uploadProof)}` },
      { ok: uploadProof.appCutResultIds.length === 0 && uploadProof.factoryCandidateCount === 0 && uploadProof.factoryAssetIds.length === 0 && uploadProof.factoryPreviousAssetIds.length === 0 && !uploadProof.appOldRef && !uploadProof.factoryOldRef && !uploadProof.bodyHasOldProduct && uploadProof.oldImageNodeCount === 0 && !uploadProof.factoryWorkspaceId && !uploadProof.factoryWorkspaceName && !uploadProof.factoryCurrentProjectId && !uploadProof.factoryCurrentProjectName, message: `NEW 이미지 업로드 후 이전 cuts/후보/자산/이미지/workspace가 남았습니다: ${JSON.stringify(uploadProof)}` },
      { ok: fs.existsSync(SCREENSHOT_PATH) && fs.statSync(SCREENSHOT_PATH).size > 24 && fs.readFileSync(SCREENSHOT_PATH).subarray(0, 8).toString('hex') === '89504e470d0a1a0a', message: `PNG 화면 증거가 유효하지 않습니다: ${SCREENSHOT_PATH}` },
    ];
    record = { ...record, ok: checks.every(check => check.ok), expectedBuildId, appUrl: APP_URL, cdpUrl: CDP_URL, oldSeed, resetProof, uploadProof, fileInputChangeProof, screenshot: SCREENSHOT_PATH, checks };
    assertChecks(checks);
  } catch (error) {
    failure = error;
    record = { ...record, ok: false, error: error?.stack || String(error) };
  } finally {
    const cleanup = { cdpClosed: false, runtimeCleaned: false, tempImageRemoved: false, errors: [] };
    try { if (cdp) await cdp.close(); cleanup.cdpClosed = true; } catch (error) { cleanup.errors.push(`cdp.close: ${error?.message || error}`); }
    try { if (cdpRuntime?.cleanup) await cdpRuntime.cleanup(); cleanup.runtimeCleaned = true; } catch (error) { cleanup.errors.push(`cdpRuntime.cleanup: ${error?.message || error}`); }
    try { await fs.promises.rm(tempImagePath, { force: true }); cleanup.tempImageRemoved = !fs.existsSync(tempImagePath); } catch (error) { cleanup.errors.push(`temp image: ${error?.message || error}`); }
    if (!cleanup.tempImageRemoved) cleanup.errors.push(`temp image remains: ${tempImagePath}`);
    record = { ...record, ok: record.ok && cleanup.errors.length === 0, cleanup, tempImageRemoved: cleanup.tempImageRemoved, resultPath: RESULT_PATH };
    if (cleanup.errors.length && !failure) failure = new Error(`검증 정리 실패: ${cleanup.errors.join('; ')}`);
    try { fs.writeFileSync(RESULT_PATH, JSON.stringify(record, null, 2), 'utf8'); } catch (error) { if (!failure) failure = error; }
  }
  if (failure) throw failure;
  console.log(JSON.stringify(record, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
