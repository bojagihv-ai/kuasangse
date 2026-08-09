const assert = require('node:assert/strict');
const test = require('node:test');
const { openBrowserContractHarness } = require('./browser_contract_harness.cjs');

async function openReadyBrowser() {
  const browser = await openBrowserContractHarness();
  await browser.call(async () => {
    await Promise.resolve(window.__KUASANGSE_BOOTSTRAP_PROMISE__).catch(() => {});
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (window.__KUASANGSE_APP_LOADER__?.ready === true && document.querySelector('#app > .app')) {
        await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__).catch(() => {});
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('factory app readiness timed out');
  });
  return browser;
}

test('lightweight last-work snapshots preserve recent generated cut results', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(() => {
      const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const payload = buildLightweightSessionPayload({
        productName: '회귀 테스트 상품',
        cuts: {
          prompts: [{ id: 'cut-a', label: 'A컷', prompt: '제품 정면', result: image, completedAt: Date.now() }],
          sizePrompts: [],
        },
      });
      return payload.cuts.prompts[0];
    });
    assert.equal(result.result, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
    assert.equal(result.imagePersistence, 'session-recent-inline');
  } finally {
    await browser.close();
  }
});

test('last-work restore scoring increases when a prompt contains a generated cut result', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(() => {
      const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const base = {
        productName: '회귀 테스트 상품',
        cuts: { prompts: [{ id: 'cut-a', label: 'A컷', prompt: '제품 정면' }], sizePrompts: [] },
      };
      const withResult = structuredClone(base);
      withResult.cuts.prompts[0].result = image;
      return {
        withoutResult: lastWorkSnapshotScore(base),
        withResult: lastWorkSnapshotScore(withResult),
      };
    });
    assert.ok(result.withResult > result.withoutResult);
  } finally {
    await browser.close();
  }
});

test('A/B image switch paints the selected card before a slow image preload settles', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(async () => {
      const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const root = document.createElement('section');
      root.dataset.previewSection = 'hero';
      root.innerHTML = `
        <img data-section-main-image src="old-image">
        <button class="variant-quickchip" data-apply-variant-image="hero:variant-b"></button>`;
      document.body.append(root);
      const originalImage = window.Image;
      window.Image = class SlowImage {
        constructor() { this.complete = false; }
        set src(value) { this._src = value; }
        get src() { return this._src; }
      };
      try {
        void updateSectionVariantImageDom('hero', { id: 'variant-b', image }, 'switch-token');
        await new Promise(resolve => setTimeout(resolve, 0));
        return {
          mainImage: root.querySelector('[data-section-main-image]')?.getAttribute('src') || '',
          active: root.querySelector('[data-apply-variant-image]')?.classList.contains('active') || false,
        };
      } finally {
        window.Image = originalImage;
        root.remove();
      }
    });
    assert.equal(result.mainImage, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
    assert.equal(result.active, true);
  } finally {
    await browser.close();
  }
});

test('A/B image variants remain switchable in both directions and survive project round-trip', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(async () => {
      const imageA = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')}`;
      const imageB = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>')}`;
      const backup = {
        currentProjectId: state.currentProjectId,
        currentProjectName: state.currentProjectName,
        currentProjectCreatedAt: state.currentProjectCreatedAt,
        sectionImages: state.sectionImages,
        sectionVariants: state.sectionVariants,
        currentSectionVariantIds: state.currentSectionVariantIds,
        sectionVariantSwitchTokens: state.sectionVariantSwitchTokens,
      };
      try {
        state.currentProjectId = 'qa-a-b-repeat-round-trip';
        state.currentProjectName = 'A/B 반복 선택 회귀';
        state.currentProjectCreatedAt = Date.now();
        state.sectionImages = { ...(state.sectionImages || {}), header: imageA };
        state.sectionVariants = {
          ...(state.sectionVariants || {}),
          header: [
            {
              id: 'qa-variant-a',
              label: 'A안',
              source: 'ai',
              content: { headline: 'A안' },
              image: null,
              imageRef: 'current-section-image',
            },
            {
              id: 'qa-variant-b',
              label: 'B안',
              source: 'ai',
              content: { headline: 'B안' },
              image: imageB,
              imageRef: '',
            },
          ],
        };
        state.currentSectionVariantIds = {
          ...(state.currentSectionVariantIds || {}),
          header: 'qa-variant-a',
        };
        state.sectionVariantSwitchTokens = {};

        const switchedToB = await applySectionVariantImageOnly('header', 'qa-variant-b');
        const switchedBackToA = await applySectionVariantImageOnly('header', 'qa-variant-a');
        const bundle = await buildFactoryProjectFileBundle({ name: state.currentProjectName });
        const restored = parseFactoryProjectFileBundle(JSON.stringify(bundle)).project.payload;
        const restoredAssets = restored.assetPayload;
        const restoredA = restoredAssets.sectionVariants.header.find(item => item.id === 'qa-variant-a');
        const restoredB = restoredAssets.sectionVariants.header.find(item => item.id === 'qa-variant-b');
        const restoredImage = variant => variant.image || (
          variant.imageRef === 'current-section-image' &&
          restoredAssets.currentSectionVariantIds.header === variant.id
            ? restoredAssets.sectionImages.header
            : ''
        );
        return {
          switchedToB,
          switchedBackToA,
          currentVariantId: state.currentSectionVariantIds.header,
          currentImage: state.sectionImages.header,
          restoredA: restoredImage(restoredA),
          restoredB: restoredImage(restoredB),
        };
      } finally {
        Object.assign(state, backup);
      }
    });
    assert.equal(result.switchedToB, true);
    assert.equal(result.switchedBackToA, true);
    assert.equal(result.currentVariantId, 'qa-variant-a');
    assert.match(result.currentImage, /fill%3D%22red%22/);
    assert.match(result.restoredA, /fill%3D%22red%22/);
    assert.match(result.restoredB, /fill%3D%22blue%22/);
  } finally {
    await browser.close();
  }
});

test('A/B quick bar marks only the current variant when candidate image URLs match', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(() => {
      const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const backup = {
        sectionImages: state.sectionImages,
        sectionVariants: state.sectionVariants,
        currentSectionVariantIds: state.currentSectionVariantIds,
      };
      try {
        state.sectionImages = { ...(state.sectionImages || {}), header: image };
        state.sectionVariants = {
          ...(state.sectionVariants || {}),
          header: [
            { id: 'qa-variant-a', label: 'A안', source: 'ai', content: { headline: 'A안' }, image },
            { id: 'qa-variant-b', label: 'B안', source: 'ai', content: { headline: 'B안' }, image },
          ],
        };
        state.currentSectionVariantIds = {
          ...(state.currentSectionVariantIds || {}),
          header: 'qa-variant-b',
        };
        const host = document.createElement('div');
        host.innerHTML = renderSectionVariantQuickBar('header');
        return {
          activeCount: host.querySelectorAll('.variant-quickchip.active').length,
          activeAction: host.querySelector('.variant-quickchip.active')?.dataset.applyVariantImage || '',
        };
      } finally {
        Object.assign(state, backup);
      }
    });
    assert.equal(result.activeCount, 1);
    assert.equal(result.activeAction, 'header:qa-variant-b');
  } finally {
    await browser.close();
  }
});

test('real .kuasangse bundle round-trip preserves A/B variants and generated cut results', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(async () => {
      const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const backup = {
        currentProjectId: state.currentProjectId,
        currentProjectName: state.currentProjectName,
        currentProjectCreatedAt: state.currentProjectCreatedAt,
        sectionContents: state.sectionContents,
        sectionImages: state.sectionImages,
        sectionVariants: state.sectionVariants,
        currentSectionVariantIds: state.currentSectionVariantIds,
        cuts: state.cuts,
      };
      try {
        state.currentProjectId = 'qa-a-b-cut-round-trip';
        state.currentProjectName = 'A/B 컷 왕복 회귀';
        state.currentProjectCreatedAt = Date.now();
        state.sectionContents = {
          ...(state.sectionContents || {}),
          header: { headline: '왕복 헤더', body_text: '왕복 테스트' },
        };
        state.sectionImages = { ...(state.sectionImages || {}), header: image };
        state.sectionVariants = {
          ...(state.sectionVariants || {}),
          header: [
            { id: 'qa-variant-a', label: 'A안', source: 'ai', content: state.sectionContents.header, image },
            { id: 'qa-variant-b', label: 'B안', source: 'ai', content: { headline: '왕복 헤더 B', body_text: '왕복 테스트 B' }, image },
          ],
        };
        state.currentSectionVariantIds = { ...(state.currentSectionVariantIds || {}), header: 'qa-variant-b' };
        state.cuts = {
          ...(state.cuts || {}),
          prompts: [{ id: 'qa-cut-a', label: 'A컷', prompt: '제품 정면', result: image, hasResult: true }],
          sizePrompts: [],
          results: [],
          sizeResults: [],
        };

        const bundle = await buildFactoryProjectFileBundle({ name: state.currentProjectName });
        const serialized = JSON.stringify(bundle);
        const restoredBundle = parseFactoryProjectFileBundle(serialized);
        const restored = restoredBundle.project.payload;
        return {
          bundleFormat: restoredBundle.format,
          variantIds: restored.sectionVariants.header.map(item => item.id),
          currentVariantId: restored.currentSectionVariantIds.header,
          cutResult: restored.cuts.prompts[0].result,
          imagePersistence: restored.imagePersistence.mode,
        };
      } finally {
        Object.assign(state, backup);
      }
    });
    assert.equal(result.bundleFormat, 'kuasangse.factory.project');
    assert.deepEqual(result.variantIds, ['qa-variant-a', 'qa-variant-b']);
    assert.equal(result.currentVariantId, 'qa-variant-b');
    assert.equal(result.cutResult, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
    assert.equal(result.imagePersistence, 'kuasangse-file-inline');
  } finally {
    await browser.close();
  }
});

test('project workfile stores one canonical input image instead of repeating it across runtime mirrors', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(() => {
      const base64 = 'A'.repeat(4096);
      const preview = `data:image/png;base64,${base64}`;
      const outputImage = 'data:image/png;base64,OUTPUT_IMAGE_MUST_STAY';
      const payload = {
        imageBase64: null,
        imagePreview: '__stored_in_indexeddb__',
        productImageBackup: {
          primary: { base64, mime: 'image/png', name: '기본이미지' },
        },
        assetPayload: {
          imageBase64: base64,
          imagePreview: preview,
          productImageBackup: {
            primary: { base64, mime: 'image/png', name: '기본이미지' },
          },
          analysisImages: [{ base64, preview, mime: 'image/png', name: '기본이미지' }],
          compPage: {
            marketScrape: { imageBase64: base64, imagePreview: preview, imageMime: 'image/png' },
          },
          factory: {
            product: {
              imageBase64: base64,
              imagePreview: preview,
              imageMime: 'image/png',
              inputImages: [{ base64, preview, mime: 'image/png', name: '기본이미지' }],
            },
          },
          sectionImages: { header: outputImage },
        },
      };

      compactFactoryProjectFileCanonicalInputImages(payload);
      const serialized = JSON.stringify(payload);
      return {
        canonicalOccurrences: serialized.split(base64).length - 1,
        topBackup: payload.productImageBackup.primary.base64,
        assetBackup: payload.assetPayload.productImageBackup,
        assetBase64: payload.assetPayload.imageBase64,
        assetPreview: payload.assetPayload.imagePreview,
        analysis: payload.assetPayload.analysisImages[0],
        market: payload.assetPayload.compPage.marketScrape,
        product: payload.assetPayload.factory.product,
        outputImage: payload.assetPayload.sectionImages.header,
      };
    });

    assert.equal(result.canonicalOccurrences, 1);
    assert.equal(result.topBackup, 'A'.repeat(4096));
    assert.equal(result.assetBackup, null);
    assert.equal(result.assetBase64, null);
    assert.equal(result.assetPreview, '__stored_in_indexeddb__');
    assert.equal(result.analysis.base64, null);
    assert.equal(result.analysis.preview, '__stored_in_indexeddb__');
    assert.equal(result.analysis.restoredFrom, 'lastProductImageBackup');
    assert.equal(result.market.imageBase64, null);
    assert.equal(result.market.imagePreview, '__stored_in_indexeddb__');
    assert.equal(result.product.imageBase64, null);
    assert.equal(result.product.imagePreview, '__stored_in_indexeddb__');
    assert.equal(result.product.inputImages[0].base64, null);
    assert.equal(result.outputImage, 'data:image/png;base64,OUTPUT_IMAGE_MUST_STAY');
  } finally {
    await browser.close();
  }
});
