const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  assertNoSilentFieldLoss,
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
const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAABE0lEQVR4nAEIAff+AAAAAP8rCx3/VhY6/4EhV/+sLHT/1zeR/wJCrv8tTcv/ABElF/88MDT/ZztR/5JGbv+9UYv/6Fyo/xNnxf8+cuL/ACJKLv9NVUv/eGBo/6Nrhf/OdqL/+YG//ySM3P9Pl/n/ADNvRf9eemL/iYV//7SQnP/fm7n/CqbW/zWx8/9gvBD/AESUXP9vn3n/mqqW/8W1s//wwND/G8vt/0bWCv9x4Sf/AFW5c/+AxJD/q8+t/9bayv8B5ef/LPAE/1f7If+CBj7/AGbeiv+R6af/vPTE/+f/4f8SCv7/PRUb/2ggOP+TK1X/AHcDof+iDr7/zRnb//gk+P8jLxX/Tjoy/3lFT/+kUGz/YAyZwbsCfOAAAAAASUVORK5CYII=';

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
      const base64 = ${JSON.stringify(VALID_PNG_BASE64)};
      const productName = 'F5 기본이미지 복원 검증';
      const workspaceId = 'project:f5-input-image-v165-' + Date.now();
      const branchScopeId = window.getCurrentLastWorkWorkspaceScope();
      const imageBackupId = 'lastProductImageBackup:' + branchScopeId;
      const runId = 'f5-input-image-run-v165';
      const inputFingerprint = String(base64.length) + ':' + base64.slice(0, 72) + ':' + base64.slice(-72);
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
        workspaceScope: { id: branchScopeId },
        step: 'factory',
        productName,
        imagePreview: marker,
        imageBase64: null,
        imageMime: 'image/png',
        imageName: backupItem.name,
        productImageBackup: {
          id: imageBackupId,
          savedAt: Date.now(),
          workspaceScope: { id: branchScopeId },
          storage: 'appSettings',
          productName,
          primary: backupItem,
        },
        analysisImages: [{ name: backupItem.name, mime: 'image/png', preview: marker, hasImageData: true }],
        factory: JSON.parse(JSON.stringify(factory)),
      };
      const imageBackup = {
        id: imageBackupId,
        savedAt: Date.now(),
        workspaceScope: { id: branchScopeId },
        productName,
        primary: backupItem,
        app: backupItem,
      };
      window.render();
      return { productName, workspaceId, branchScopeId, imageBackupId, runId, productKey, inputFingerprint, base64, marker, sessionPayload, imageBackup };
    })()`);
    const persistenceProof = await evaluate(cdp, `(async () => {
      const setup = ${JSON.stringify(setup)};
      const authority = await window.ensureWorkspaceEditAuthority(setup.branchScopeId, { force: true });
      if (!['editing', 'offline-edit'].includes(authority?.mode) || authority?.scopeId !== setup.branchScopeId) {
        throw new Error('input image branch authority acquisition failed: ' + JSON.stringify(authority));
      }
      await window.workspacePut('sessionAssets', setup.sessionPayload);
      await window.workspacePut('appSettings', setup.imageBackup);
      const before = {
        scopeId: window.getCurrentLastWorkWorkspaceScope(),
        serverLastWorkHydrated,
        serverLastWorkHydrating,
        transitionInProgress: workspaceScopeTransitionState.inProgress,
        persistentStateSaving,
      };
      const persistenceRequest = window.savePersistentState({ skipVisibleSync: true });
      const firstResult = persistenceRequest === false
        ? false
        : await persistenceRequest;
      const persisted = firstResult === true
        ? true
        : await window.flushQueuedPersistentState({ skipVisibleSync: true });
      return {
        persisted,
        firstResult,
        before,
        after: {
          scopeId: window.getCurrentLastWorkWorkspaceScope(),
          serverLastWorkHydrated,
          serverLastWorkHydrating,
          transitionInProgress: workspaceScopeTransitionState.inProgress,
          persistentStateSaving,
          persistentSaveQueued: workspaceScopeTransitionState.persistentSaveQueued,
          storageWarning: window.state.storageWarning || '',
        },
      };
    })()`);
    if (persistenceProof.persisted !== true) {
      fs.writeFileSync(
        RESULT_PATH,
        JSON.stringify({ ok: false, setup: { ...setup, sessionPayload: undefined, imageBackup: undefined }, persistenceProof }, null, 2),
        'utf8',
      );
      throw new Error(`input image session persistence failed: ${JSON.stringify(persistenceProof)}`);
    }
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(
      cdp,
      '!!(window.state && window.render && window.factoryState && typeof window.workspaceGet === "function" && window.__KUASANGSE_APP_LOADER__?.ready === true && window.sessionAssetsHydrated !== false)',
      60000,
    );
    await new Promise(resolve => setTimeout(resolve, 7000));
    const storedBackup = await evaluate(cdp, `(async () => {
      const setup = ${JSON.stringify(setup)};
      const payload = await window.workspaceGet('appSettings', setup.imageBackupId).catch(() => null);
      return payload ? {
        id: payload.id || '',
        workspaceScopeId: payload.workspaceScope?.id || '',
        productName: payload.productName || '',
        primarySource: payload.primary?.source || '',
        base64Length: String(payload.primary?.base64 || '').length,
        appBase64Length: String(payload.app?.base64 || '').length,
      } : null;
    })()`);
    const beforeExplicit = await evaluate(cdp, `(() => {
      const base64 = ${JSON.stringify(VALID_PNG_BASE64)};
      return {
      imageBase64: window.state.imageBase64 === base64,
      imagePreviewHasData: String(window.state.imagePreview || '').includes(base64),
      factoryHasStoredReference: window.factoryState().product?.imageRef === 'current-product-image',
      };
    })()`);
    const explicitHydrateChanged = await evaluate(cdp, `(async () => {
      if (typeof hydrateLastProductImageBackup !== 'function') return null;
      return hydrateLastProductImageBackup({ restoreInline: true });
    })()`);
    await new Promise(resolve => setTimeout(resolve, 120));
    const afterReload = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const base64 = ${JSON.stringify(VALID_PNG_BASE64)};
      const productName = 'F5 기본이미지 복원 검증';
      const imageSrc = String(window.state.imagePreview || '');
      const factoryImageSrc = String(factory.product?.imagePreview || '');
      const imageNodes = [...document.querySelectorAll('img')].filter(img => /제품|f5|복원|input/i.test([img.alt || '', img.src || ''].join(' ')));
      const identityCard = document.querySelector('.work-identity-float');
      const identityCardImageSrc = String(identityCard?.querySelector('.work-identity-thumb img')?.getAttribute('src') || '');
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
        identityCardStatus: String(identityCard?.querySelector('.work-identity-status')?.textContent || '').trim(),
        identityCardImageIsCurrentInput: identityCardImageSrc.includes(base64),
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
      { ok: afterReload.identityCardStatus === '작업 고정됨', message: `identity card misclassified restored base image: ${afterReload.identityCardStatus || '(missing)'}` },
      { ok: afterReload.identityCardImageIsCurrentInput === true, message: 'identity card did not render the restored current base image' },
      { ok: afterReload.bodyHasProductName === true, message: 'restored product name is not visible on the screen' },
      { ok: storedBackup?.id === setup.imageBackupId, message: `scoped product image backup id was not preserved: ${storedBackup?.id || '(missing)'}` },
      { ok: storedBackup?.workspaceScopeId === setup.branchScopeId, message: `scoped product image backup branch was not preserved: ${storedBackup?.workspaceScopeId || '(missing)'}` },
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
    // 공통 보존 검사: 사람이 손으로 넣은 값이 조용히 사라지지 않았는가.
    // (2026-08-29 — 회귀가 145/145 초록불인데도 사용자 값이 날아간 뒤 세운 그물)
    await assertNoSilentFieldLoss(cdp, { allowAutoLoss: true });
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
