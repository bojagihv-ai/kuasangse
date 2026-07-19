const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9360';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-input-image-reload-v165.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-input-image-reload-v165.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const expectedBuildId = currentSourceBuildId();
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Number(process.env.KUASANGSE_VIEWPORT_WIDTH || 1280),
      height: Number(process.env.KUASANGSE_VIEWPORT_HEIGHT || 900),
      deviceScaleFactor: 1,
      mobile: false,
    });
    const url = `${APP_URL}?inputImageReload=v165`;
    await cdp.send('Page.navigate', { url });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.workspacePut)', 60000);
    const setup = await evaluate(cdp, `(() => {
      const base64 = 'RkVTVF9GSjVfSU1BR0VfUkVTVE9SRV9WMTY1';
      const productName = 'F5 기본이미지 복원 검증';
      const workspaceId = 'project:f5-input-image-v165-' + Date.now();
      const runId = 'f5-input-image-run-v165';
      const inputFingerprint = 'f5-input-image-fingerprint-v165';
      const productKey = window.factoryNormalizeIdentityText(productName);
      const marker = '__stored_in_indexeddb__';
      const backupItem = {
        source: 'app',
        base64,
        mime: 'image/png',
        name: 'f5-검증-제품.png',
        updatedAt: Date.now(),
      };
      const factory = window.factoryState();
      window.state.step = 'factory';
      window.state.currentProjectId = workspaceId;
      window.state.currentProjectName = productName;
      window.state.productName = productName;
      window.state.imageBase64 = '';
      window.state.imagePreview = marker;
      window.state.imageMime = 'image/png';
      window.state.imageName = backupItem.name;
      window.state.analysisImages = [{ name: backupItem.name, mime: 'image/png', preview: marker, hasImageData: true }];
      window.state.factory = factory;
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId, name: productName };
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey,
        currentRunId: runId,
        generationRunId: runId,
        inputImageFingerprint: inputFingerprint,
        lockedInputImageFingerprint: inputFingerprint,
        imageBase64: '',
        imagePreview: marker,
        imageMime: 'image/png',
        imageName: backupItem.name,
        imageRef: 'current-product-image',
        hasImage: true,
        inputImages: [{ id: 'f5-input-v165', name: backupItem.name, mime: 'image/png', preview: marker, hasImage: true }],
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: runId, activeTab: 'input' };
      const sessionPayload = {
        id: 'current',
        savedAt: Date.now(),
        currentProjectId: workspaceId,
        workspaceScope: { id: workspaceId },
        step: 'factory',
        productName,
        imagePreview: marker,
        imageBase64: null,
        imageMime: 'image/png',
        imageName: backupItem.name,
        productImageBackup: {
          id: 'lastProductImageBackup',
          savedAt: Date.now(),
          productName,
          primary: backupItem,
        },
        analysisImages: [{ name: backupItem.name, mime: 'image/png', preview: marker, hasImageData: true }],
        factory: JSON.parse(JSON.stringify(factory)),
      };
      const imageBackup = {
        id: 'lastProductImageBackup',
        savedAt: Date.now(),
        productName,
        primary: backupItem,
        app: backupItem,
      };
      window.render();
      return { productName, workspaceId, runId, productKey, inputFingerprint, base64, marker, sessionPayload, imageBackup };
    })()`);
    await evaluate(cdp, `(async () => {
      const setup = ${JSON.stringify(setup)};
      const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
      let authority = await lock.acquire({
        scopeId: window.getCurrentLastWorkWorkspaceScope(),
        ownerId: 'input image reload regression',
      });
      if (authority.mode !== 'editing') {
        authority = await lock.takeover({
          confirmed: true,
          scopeId: window.getCurrentLastWorkWorkspaceScope(),
          ownerId: 'input image reload regression',
        });
      }
      if (authority.mode !== 'editing') throw new Error('input image authority acquisition failed');
      await window.workspacePut('sessionAssets', setup.sessionPayload);
      await window.workspacePut('appSettings', setup.imageBackup);
      const persistenceRequest = window.savePersistentState({ skipVisibleSync: true });
      const persisted = persistenceRequest === false
        ? await window.flushQueuedPersistentState({ skipVisibleSync: true })
        : await persistenceRequest;
      if (persisted !== true) throw new Error('input image session persistence failed');
      return true;
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.sessionAssetsHydrated !== false)', 60000);
    await new Promise(resolve => setTimeout(resolve, 7000));
    const storedBackup = await evaluate(cdp, `(async () => {
      const payload = await window.workspaceGet('appSettings', 'lastProductImageBackup').catch(() => null);
      return payload ? {
        productName: payload.productName || '',
        primarySource: payload.primary?.source || '',
        base64Length: String(payload.primary?.base64 || '').length,
        appBase64Length: String(payload.app?.base64 || '').length,
      } : null;
    })()`);
    const beforeExplicit = await evaluate(cdp, `(() => ({
      imageBase64: window.state.imageBase64 === 'RkVTVF9GSjVfSU1BR0VfUkVTVE9SRV9WMTY1',
      imagePreviewHasData: String(window.state.imagePreview || '').includes('RkVTVF9GSjVfSU1BR0VfUkVTVE9SRV9WMTY1'),
      factoryHasStoredReference: window.factoryState().product?.imageRef === 'current-product-image',
    }))()`);
    const explicitHydrateChanged = await evaluate(cdp, `(async () => {
      if (typeof hydrateLastProductImageBackup !== 'function') return null;
      return hydrateLastProductImageBackup({ restoreInline: true });
    })()`);
    await new Promise(resolve => setTimeout(resolve, 120));
    const afterReload = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const base64 = 'RkVTVF9GSjVfSU1BR0VfUkVTVE9SRV9WMTY1';
      const productName = 'F5 기본이미지 복원 검증';
      const imageSrc = String(window.state.imagePreview || '');
      const factoryImageSrc = String(factory.product?.imagePreview || '');
      const imageNodes = [...document.querySelectorAll('img')].filter(img => /제품|f5|복원|input/i.test([img.alt || '', img.src || ''].join(' ')));
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        currentProjectId: window.state.currentProjectId || '',
        currentProjectName: window.state.currentProjectName || '',
        productName: window.state.productName || '',
        imageBase64: window.state.imageBase64 === base64,
        imagePreviewHasData: imageSrc.includes(base64),
        imageMime: window.state.imageMime || '',
        factoryProductName: factory.product?.productName || '',
        factoryImageBase64: factory.product?.imageBase64 === base64,
        factoryImagePreviewHasData: factoryImageSrc.includes(base64),
        factoryInputHasData: factory.product?.inputImages?.some(item => item?.base64 === base64 || String(item?.preview || '').includes(base64)) === true,
        factoryHasStoredReference: factory.product?.imageRef === 'current-product-image' && factory.product?.hasImage === true,
        bodyHasProductName: (document.body.innerText || '').includes(productName),
        candidateImageNodes: imageNodes.length,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: afterReload.buildId === expectedBuildId, message: `실행 빌드와 현재 소스 빌드가 다릅니다: ${afterReload.buildId} != ${expectedBuildId}` },
      { ok: afterReload.currentProjectId === setup.workspaceId, message: `currentProjectId was not preserved: ${afterReload.currentProjectId}` },
      { ok: afterReload.currentProjectName === 'F5 기본이미지 복원 검증', message: `currentProjectName was not preserved: ${afterReload.currentProjectName}` },
      { ok: afterReload.productName === 'F5 기본이미지 복원 검증', message: `productName was not preserved: ${afterReload.productName}` },
      { ok: afterReload.imageBase64 === true, message: 'state.imageBase64 was not restored after F5' },
      { ok: afterReload.imagePreviewHasData === true, message: 'state.imagePreview did not contain the restored image after F5' },
      { ok: afterReload.factoryProductName === 'F5 기본이미지 복원 검증', message: `factory product name was not preserved: ${afterReload.factoryProductName}` },
      { ok: afterReload.factoryHasStoredReference === true, message: 'factory product image reference was not preserved after F5' },
      { ok: afterReload.factoryHasStoredReference === true, message: 'factory product image reference was not preserved after F5' },
      { ok: afterReload.bodyHasProductName === true, message: 'restored product name is not visible on the screen' },
    ];
    const failures = checks.filter(check => !check.ok).map(check => check.message);
    checks.push(
      { ok: beforeExplicit.imageBase64 === true, message: 'automatic F5 hydration did not restore state.imageBase64 before explicit retry' },
      { ok: beforeExplicit.imagePreviewHasData === true, message: 'automatic F5 hydration did not restore state.imagePreview before explicit retry' },
    );
    const payload = { ok: failures.length === 0, setup: { ...setup, sessionPayload: undefined, imageBackup: undefined }, storedBackup, beforeExplicit, explicitHydrateChanged, afterReload, checks, failures, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    assertChecks(checks);
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
