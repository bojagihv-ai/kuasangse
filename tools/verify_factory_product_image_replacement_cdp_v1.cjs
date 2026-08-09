const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {
  assertChecks,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), '.omo', 'evidence', 'factory-product-image-replacement-v1');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-product-image-replacement-v1.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-product-image-replacement-v1.json');

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function createPng(width = 160, height = 120) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  let seed = 0x7f4a7c15;
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const offset = row + 1 + x * 3;
      pixels[offset] = seed & 0xff;
      pixels[offset + 1] = (seed >>> 8) & 0xff;
      pixels[offset + 2] = (seed >>> 16) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const NEW_IMAGE_BUFFER = createPng();
const NEW_IMAGE_BASE64 = NEW_IMAGE_BUFFER.toString('base64');

function svgDataUrl(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#fff7ed"/><rect x="70" y="92" width="500" height="230" rx="28" fill="${color}"/><text x="320" y="220" text-anchor="middle" font-size="30" font-family="Arial" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  const expectedBuildId = currentSourceBuildId();
  const tempImagePath = path.join(os.tmpdir(), `kuasangse-image-replacement-${process.pid}-${Date.now()}.png`);
  let cdpRuntime = null;
  let cdp = null;
  let failure = null;
  let record = { ok: false, expectedBuildId, tempImagePath };

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(tempImagePath, NEW_IMAGE_BUFFER);
    cdpRuntime = await ensureCdp(CDP_URL);
    const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    for (const [method, params] of [
      ['Page.enable'], ['Network.enable'], ['Runtime.enable'], ['DOM.enable'],
      ['Network.setCacheDisabled', { cacheDisabled: true }],
      ['Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }],
    ]) await cdp.send(method, params);
    await cdp.send('Page.navigate', { url: `${APP_URL}?factoryImageReplacement=v1` });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof factoryRuntimeReadFactory === 'function'
      && typeof factoryRuntimeReplaceFactorySnapshot === 'function'`, 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);

    const oldPreview = svgDataUrl('old-product-image', '#b91c1c');
    const oldBase64 = oldPreview.split(',', 2)[1] || '';
    const oldProductName = 'image-replacement-old';
    const oldWorkspaceId = `project:${oldProductName}-${Date.now()}`;
    const seeded = await evaluateFactoryCdpFixture(cdp, `(async ({ setAppState, cloneFactory, replaceFactory, readFactory, renderApp }) => {
      const oldPreview = ${JSON.stringify(oldPreview)};
      const oldBase64 = ${JSON.stringify(oldBase64)};
      const productName = ${JSON.stringify(oldProductName)};
      const workspaceId = ${JSON.stringify(oldWorkspaceId)};
      setAppState({ step: 'factory', error: '', currentProjectId: workspaceId, currentProjectName: productName, productName, imageBase64: oldBase64, imageMime: 'image/svg+xml', imagePreview: oldPreview, imageName: 'old-product.svg' });
      const factory = cloneFactory();
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId, name: productName, createdAt: Date.now() };
      factory.currentProjectId = workspaceId;
      factory.currentProjectName = productName;
      factory.automation = { ...(factory.automation || {}), activeTab: 'start' };
      factory.product = { ...(factory.product || {}), productName, userProductName: productName, imageBase64: oldBase64, imageMime: 'image/svg+xml', imagePreview: oldPreview, imageName: 'old-product.svg', inputImageFingerprint: 'old-image-fingerprint-v1', lockedInputImageFingerprint: 'old-image-fingerprint-v1', inputImages: [{ id: 'old-input-v1', name: 'old-product.svg', base64: oldBase64, mime: 'image/svg+xml', preview: oldPreview, lockedInput: true }] };
      replaceFactory(factory, { mode: 'hydrate', workspaceId, reason: 'factory-image-replacement-v1-seed' });
      await Promise.resolve(renderApp());
      const current = readFactory();
      return { imageBase64: current.product?.imageBase64 || '', inputCount: (current.product?.inputImages || []).length, oldImageNodes: [...document.images].filter(img => String(img.src || '').includes(oldBase64)).length };
    })`);
    if (seeded.imageBase64 !== oldBase64 || seeded.inputCount !== 1 || seeded.oldImageNodes < 1) {
      throw new Error(`기존 이미지 fixture 준비 실패: ${JSON.stringify(seeded)}`);
    }
    await evaluate(cdp, `(() => { state.error = ''; return true; })()`);

    const inputRebindFixture = await evaluate(cdp, `(() => {
      const before = document.querySelector('#factoryGuideProductFile');
      if (!before) return { found: false };
      const replacement = before.cloneNode(true);
      before.replaceWith(replacement);
      return {
        found: true,
        oldDisconnected: !before.isConnected,
        replacementConnected: replacement.isConnected,
        distinctNode: before !== replacement,
      };
    })()`);
    const root = await cdp.send('DOM.getDocument', { depth: -1 });
    const inputNode = await cdp.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#factoryGuideProductFile' });
    if (!inputNode.nodeId) throw new Error('시작 탭 제품 이미지 file input을 찾지 못했습니다.');
    const inputDescription = await cdp.send('DOM.describeNode', { nodeId: inputNode.nodeId });
    const inputBackendNodeId = inputDescription.node?.backendNodeId;
    if (!inputBackendNodeId) throw new Error('시작 탭 제품 이미지 file input backend node를 찾지 못했습니다.');
    await evaluate(cdp, `(() => {
      const input = document.querySelector('#factoryGuideProductFile');
      globalThis.__factoryImageReplacementOriginalInput = input;
      globalThis.__factoryImageReplacementEvents = [];
      globalThis.__factoryImageReplacementButtonClicks = 0;
      globalThis.__factoryImageReplacementInputClicks = 0;
      document.querySelector('[data-factory-open-product-file="guide"]')?.addEventListener('click', () => {
        globalThis.__factoryImageReplacementButtonClicks += 1;
      }, { capture: true });
      input?.addEventListener('click', () => {
        globalThis.__factoryImageReplacementInputClicks += 1;
      }, { capture: true });
      input?.addEventListener('change', event => globalThis.__factoryImageReplacementEvents.push({ files: event.target?.files?.length || 0, name: event.target?.files?.[0]?.name || '', trusted: event.isTrusted === true }), { capture: true });
      return !!input;
    })()`);
    const newBase64Literal = JSON.stringify(NEW_IMAGE_BASE64);
    const cacheCollisionFixture = await evaluate(cdp, `(() => {
      const nextDataUrl = 'data:image/png;base64,' + ${newBase64Literal};
      const collisionKey = factoryLightImageKey(nextDataUrl);
      const store = factoryLightImageStore();
      const urls = globalThis.__factoryLightImageUrls;
      const previousUrl = urls?.get?.(collisionKey);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      store.set(collisionKey, ${JSON.stringify(oldPreview)});
      const previousBlob = factoryDataUrlToBlob(${JSON.stringify(oldPreview)});
      if (previousBlob) urls.set(collisionKey, URL.createObjectURL(previousBlob));
      return {
        collisionKey,
        staleStored: store.get(collisionKey) === ${JSON.stringify(oldPreview)},
        staleUrlCached: Boolean(urls?.get?.(collisionKey)),
      };
    })()`);
    await evaluate(cdp, `(() => {
      document.querySelector('[data-factory-open-product-file="guide"]')?.click();
      return true;
    })()`);
    const chooserRenderGap = await evaluate(cdp, `(() => {
      const before = globalThis.__factoryImageReplacementOriginalInput;
      render();
      const after = document.querySelector('#factoryGuideProductFile');
      return {
        originalConnected: Boolean(before?.isConnected),
        sameInputAfterRender: before === after,
      };
    })()`);
    await cdp.send('DOM.setFileInputFiles', { backendNodeId: inputBackendNodeId, files: [tempImagePath] });

    const replacementExpression = `(() => {
      const current = factoryRuntimeReadFactory();
      const product = current?.product || {};
      const inputImages = Array.isArray(product.inputImages) ? product.inputImages : [];
      const guideImage = document.querySelector('#factoryGuideProductDrop img[data-factory-light-image-key]');
      const guideImageKey = String(guideImage?.dataset?.factoryLightImageKey || '');
      const guideStoredImage = guideImageKey && typeof factoryLightImageStore === 'function'
        ? String(factoryLightImageStore()?.get?.(guideImageKey) || '')
        : '';
      return state.imageBase64 === ${newBase64Literal}
        && product.imageBase64 === ${newBase64Literal}
        && inputImages.length === 1
        && inputImages[0]?.base64 === ${newBase64Literal}
        && guideStoredImage === 'data:image/png;base64,' + ${newBase64Literal}
        && guideImage?.dataset?.factoryLightLoaded === '1'
        && String(guideImage?.src || '').startsWith('blob:');
    })()`;
    try {
      await waitFor(cdp, replacementExpression, 30000);
    } catch (error) {
      record.timeoutProof = await evaluateFactoryCdpFixture(cdp, `(({ readAppState, readFactory }) => {
        const app = readAppState();
        const current = readFactory();
        const product = current.product || {};
        const input = document.querySelector('#factoryGuideProductFile');
        const identity = value => {
          const text = String(value || '');
          return {
            length: text.length,
            fingerprint: typeof factoryImagePayloadFingerprint === 'function'
              ? String(factoryImagePayloadFingerprint(text) || '')
              : '',
          };
        };
        return {
          appImageBase64: app.imageBase64 || '',
          appImageIdentity: identity(app.imageBase64),
          stateError: String(state.error || ''),
          operationToken: typeof factoryRuntimeRequireStore === 'function' ? factoryRuntimeRequireStore().getOperationToken() : null,
          activeTab: current.automation?.activeTab || '',
          factoryImageBase64: product.imageBase64 || '',
          factoryImageIdentity: identity(product.imageBase64),
          expectedImageIdentity: identity(${newBase64Literal}),
          factoryImageName: product.imageName || '',
          factoryInputImages: Array.isArray(product.inputImages) ? product.inputImages : [],
          events: Array.isArray(globalThis.__factoryImageReplacementEvents) ? globalThis.__factoryImageReplacementEvents : [],
          buttonClicks: Number(globalThis.__factoryImageReplacementButtonClicks || 0),
          inputClicks: Number(globalThis.__factoryImageReplacementInputClicks || 0),
          inputRebindFixture: ${JSON.stringify(inputRebindFixture)},
          chooserRenderGap: ${JSON.stringify(chooserRenderGap)},
          cacheCollisionFixture: ${JSON.stringify(cacheCollisionFixture)},
          inputType: input?.files?.[0]?.type || '',
          inputName: input?.files?.[0]?.name || '',
          hydrateTimerActive: Boolean(globalThis.__factoryLightImageHydrateTimer),
          hydrateRootCount: Number(globalThis.__factoryLightImageHydrateRoots?.size || 0),
          guideImage: (() => {
            const image = document.querySelector('#factoryGuideProductDrop img[data-factory-light-image-key]');
            const key = String(image?.dataset?.factoryLightImageKey || '');
            const stored = key && typeof factoryLightImageStore === 'function'
              ? String(factoryLightImageStore()?.get?.(key) || '')
              : '';
            return {
              exists: Boolean(image),
              key,
              loaded: image?.dataset?.factoryLightLoaded === '1',
              datasetError: String(image?.dataset?.factoryLightError || ''),
              title: String(image?.title || ''),
              srcPrefix: String(image?.src || '').slice(0, 48),
              srcIdentity: identity(image?.src || ''),
              storedLength: stored.length,
              storedIdentity: identity(stored),
              storedMatchesNew: stored === 'data:image/png;base64,' + ${newBase64Literal},
            };
          })(),
          errorText: String(document.body.innerText || '').split('\\n').filter(line => /오류|실패|error/i.test(line)).slice(-5),
        };
      })`);
      throw error;
    }

    const proof = await evaluateFactoryCdpFixture(cdp, `(({ readAppState, readFactory }) => {
      const app = readAppState();
      const current = readFactory();
      const product = current.product || {};
      const events = Array.isArray(globalThis.__factoryImageReplacementEvents) ? globalThis.__factoryImageReplacementEvents : [];
      const images = [...document.images].map(img => String(img.src || ''));
      const lightImages = [...document.images].map(img => {
        const key = String(img.dataset?.factoryLightImageKey || '');
        return {
          key,
          loaded: img.dataset?.factoryLightLoaded === '1',
          src: String(img.src || ''),
          stored: key && typeof factoryLightImageStore === 'function'
            ? String(factoryLightImageStore()?.get?.(key) || '')
            : '',
        };
      });
      return {
        runtimeBuildId: String(globalThis.__KUASANGSE_APP_BUILD_ID__ || '').trim(),
        loaderBuildId: String(document.documentElement?.dataset?.kuasangseBuildId || '').trim(),
        appImageBase64: app.imageBase64 || '',
        factoryImageBase64: product.imageBase64 || '',
        factoryImageName: product.imageName || '',
        inputImages: Array.isArray(product.inputImages) ? product.inputImages : [],
        events,
        buttonClicks: Number(globalThis.__factoryImageReplacementButtonClicks || 0),
        inputClicks: Number(globalThis.__factoryImageReplacementInputClicks || 0),
        inputRebindFixture: ${JSON.stringify(inputRebindFixture)},
        chooserRenderGap: ${JSON.stringify(chooserRenderGap)},
        cacheCollisionFixture: ${JSON.stringify(cacheCollisionFixture)},
        newImageNodeCount: lightImages.filter(item => item.src.includes(${newBase64Literal}) || item.stored.includes(${newBase64Literal})).length,
        newImageBlobNodeCount: lightImages.filter(item => item.loaded && item.src.startsWith('blob:') && item.stored.includes(${newBase64Literal})).length,
        lightImages: lightImages.map(item => ({
          key: item.key,
          loaded: item.loaded,
          srcPrefix: item.src.slice(0, 48),
          storedLength: item.stored.length,
          storedMatchesNew: item.stored.includes(${newBase64Literal}),
        })),
        oldImageNodeCount: images.filter(src => src.includes(${JSON.stringify(oldBase64)})).length,
        error: String(document.querySelector('[data-factory-runtime-error]')?.textContent || '').trim(),
      };
    })`);
    await evaluate(cdp, `(async () => {
      if (typeof saveLastWorkNow === 'function') await Promise.resolve(saveLastWorkNow({ sync: false }));
      if (typeof persistentStateSavePromise !== 'undefined' && persistentStateSavePromise) {
        await Promise.resolve(persistentStateSavePromise);
      }
      await new Promise(resolve => setTimeout(resolve, 900));
      return true;
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof factoryRuntimeReadFactory === 'function'`, 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);
    await waitFor(cdp, `(() =>
      globalThis.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(expectedBuildId)}
      && typeof factoryRuntimeReadFactory === 'function'
      && factoryRuntimeReadFactory().product?.imageBase64 === ${newBase64Literal}
      && state.imageBase64 === ${newBase64Literal}
      && document.querySelector('#factoryGuideProductDrop img[data-factory-light-loaded="1"]')?.src?.startsWith('blob:')
    )()`, 60000);
    const reloadProof = await evaluateFactoryCdpFixture(cdp, `(({ readAppState, readFactory }) => {
      const app = readAppState();
      const current = readFactory();
      const image = document.querySelector('#factoryGuideProductDrop img');
      const key = String(image?.dataset?.factoryLightImageKey || '');
      const stored = key && typeof factoryLightImageStore === 'function'
        ? String(factoryLightImageStore()?.get?.(key) || '')
        : '';
      image?.scrollIntoView?.({ block: 'center' });
      return {
        runtimeBuildId: String(globalThis.__KUASANGSE_APP_BUILD_ID__ || '').trim(),
        appImageMatches: app.imageBase64 === ${newBase64Literal},
        factoryImageMatches: current.product?.imageBase64 === ${newBase64Literal},
        inputImageMatches: current.product?.inputImages?.[0]?.base64 === ${newBase64Literal},
        imageName: current.product?.imageName || '',
        activeTab: current.automation?.activeTab || '',
        imageKey: key,
        imageLoaded: image?.dataset?.factoryLightLoaded === '1',
        imageSrcPrefix: String(image?.src || '').slice(0, 48),
        storedMatchesNew: stored === 'data:image/png;base64,' + ${newBase64Literal},
        oldImageVisible: [...document.images].some(item => String(item.src || '').includes(${JSON.stringify(oldBase64)})),
        error: String(document.querySelector('[data-factory-runtime-error]')?.textContent || '').trim(),
      };
    })`);
    await new Promise(resolve => setTimeout(resolve, 100));
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    const checks = [
      { ok: proof.runtimeBuildId === expectedBuildId && proof.loaderBuildId === expectedBuildId, message: `번들 build 불일치: ${JSON.stringify(proof)}` },
      { ok: proof.inputRebindFixture?.found && proof.inputRebindFixture?.oldDisconnected && proof.inputRebindFixture?.replacementConnected && proof.inputRebindFixture?.distinctNode, message: `file input 교체 재현 fixture가 준비되지 않았습니다: ${JSON.stringify(proof.inputRebindFixture)}` },
      { ok: proof.chooserRenderGap?.originalConnected === true && proof.chooserRenderGap?.sameInputAfterRender === true, message: `파일 선택 중 재렌더가 열린 input을 보존하지 못했습니다: ${JSON.stringify(proof.chooserRenderGap)}` },
      { ok: proof.cacheCollisionFixture?.staleStored === true && proof.cacheCollisionFixture?.staleUrlCached === true, message: `이전 이미지 캐시 충돌 fixture가 준비되지 않았습니다: ${JSON.stringify(proof.cacheCollisionFixture)}` },
      { ok: proof.buttonClicks === 1 && proof.inputClicks >= 1, message: `보이는 이미지 교체 버튼이 file input을 열지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.events.length === 1 && proof.events[0]?.files === 1 && proof.events[0]?.name.endsWith('.png') && proof.events[0]?.trusted, message: `교체 native change 증거가 1회가 아닙니다: ${JSON.stringify(proof.events)}` },
      { ok: proof.appImageBase64 === NEW_IMAGE_BASE64 && proof.factoryImageBase64 === NEW_IMAGE_BASE64 && proof.inputImages.length === 1 && proof.inputImages[0]?.base64 === NEW_IMAGE_BASE64, message: `교체 이미지가 app/factory/inputImages에 수렴하지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.newImageNodeCount > 0 && proof.newImageBlobNodeCount > 0 && proof.oldImageNodeCount === 0 && !proof.error, message: `대용량 교체 이미지가 blob 미리보기에 보이지 않거나 이전 이미지/오류가 남았습니다: ${JSON.stringify(proof)}` },
      { ok: reloadProof.runtimeBuildId === expectedBuildId && reloadProof.appImageMatches && reloadProof.factoryImageMatches && reloadProof.inputImageMatches && reloadProof.activeTab === 'start' && reloadProof.imageLoaded && reloadProof.imageSrcPrefix.startsWith('blob:') && reloadProof.storedMatchesNew && !reloadProof.oldImageVisible && !reloadProof.error, message: `새로고침 뒤 교체 이미지가 작업 상태와 화면에 그대로 복원되지 않았습니다: ${JSON.stringify(reloadProof)}` },
      { ok: fs.existsSync(SCREENSHOT_PATH) && fs.statSync(SCREENSHOT_PATH).size > 24 && fs.readFileSync(SCREENSHOT_PATH).subarray(0, 8).toString('hex') === '89504e470d0a1a0a', message: `PNG 화면 증거가 유효하지 않습니다: ${SCREENSHOT_PATH}` },
    ];
    record = { ok: checks.every(check => check.ok), expectedBuildId, appUrl: APP_URL, cdpUrl: CDP_URL, seeded, proof, reloadProof, screenshot: SCREENSHOT_PATH, checks };
    assertChecks(checks);
  } catch (error) {
    failure = error;
    record = { ...record, ok: false, error: error?.stack || String(error) };
  } finally {
    const cleanup = { cdpClosed: false, runtimeCleaned: false, tempImageRemoved: false, errors: [] };
    try { if (cdp) await cdp.close(); cleanup.cdpClosed = true; } catch (error) { cleanup.errors.push(`cdp.close: ${error?.message || error}`); }
    try { if (cdpRuntime?.cleanup) await cdpRuntime.cleanup(); cleanup.runtimeCleaned = true; } catch (error) { cleanup.errors.push(`cdpRuntime.cleanup: ${error?.message || error}`); }
    try { await fs.promises.rm(tempImagePath, { force: true }); cleanup.tempImageRemoved = !fs.existsSync(tempImagePath); } catch (error) { cleanup.errors.push(`temp image: ${error?.message || error}`); }
    record = { ...record, ok: record.ok && cleanup.errors.length === 0, cleanup, tempImageRemoved: cleanup.tempImageRemoved, resultPath: RESULT_PATH };
    try { fs.writeFileSync(RESULT_PATH, JSON.stringify(record, null, 2), 'utf8'); } catch (error) { if (!failure) failure = error; }
  }
  if (failure) throw failure;
  console.log(JSON.stringify({
    ok: record.ok,
    expectedBuildId: record.expectedBuildId,
    interaction: {
      buttonClicks: record.proof?.buttonClicks || 0,
      inputClicks: record.proof?.inputClicks || 0,
      events: record.proof?.events || [],
    },
    cache: {
      fixture: record.proof?.cacheCollisionFixture || null,
      newImageBlobNodeCount: record.proof?.newImageBlobNodeCount || 0,
      oldImageNodeCount: record.proof?.oldImageNodeCount || 0,
    },
    reloadProof: record.reloadProof || null,
    screenshot: record.screenshot,
    cleanup: record.cleanup,
    resultPath: record.resultPath,
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
