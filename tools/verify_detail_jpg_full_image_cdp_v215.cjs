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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9515';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'detail-jpg-full-image-v215.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'detail-jpg-full-image-preview-v215.png');
const JPG_PATH = path.join(OUT_DIR, 'detail-jpg-full-image-export-v215.jpg');
const SOURCE_IMAGE_REL = 'output/local-archive/workfiles/draft_lastwork_mrj2stm7_g44a9b__28f7940b4c65/assets/슬라브나비수저집/factory_work_run_mrlatnkr_mwj9f6/4314552_9j_4UFYRXhpZgAASUkqAAgAAAAMAA8BAgAGAAAAngAAABABAgAPAAAAp/section-images/section_competitive_edge/160540_비교_우위_(Competitive_Edge)_섹션_결과_section_archive_co/image.jpg';

function appAssetUrl(relativePath) {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return new URL(`/${encoded}`, APP_URL).href;
}

async function capture(cdp, filePath) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sourcePath = path.join(process.cwd(), ...SOURCE_IMAGE_REL.split('/'));
  if (!fs.existsSync(sourcePath)) throw new Error(`검증 원본 이미지가 없습니다: ${sourcePath}`);

  const sourceBuild = currentSourceBuildId();
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  const result = {
    ok: false,
    sourceBuild,
    sourcePath,
    screenshots: [SCREENSHOT_PATH],
    jpgPath: JPG_PATH,
  };

  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyDetailJpg=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.captureCleanJpegBlob && window.orderedSections)', 60000);

    const sourceUrl = appAssetUrl(SOURCE_IMAGE_REL);
    result.setup = await evaluate(cdp, `(() => {
      const sectionId = 'competitive_edge';
      const sourceUrl = ${JSON.stringify(sourceUrl)};
      const section = window.orderedSections().find(item => item.id === sectionId);
      const content = {
        headline: '이 문장은 전체 이미지 밖에 중복되면 안 됩니다',
        subheadline: '전체 이미지 시안은 원본 한 장 그대로 보여야 합니다',
        body_text: 'JPG 내보내기에서 앱의 별도 본문과 이미지 일부를 다시 조립하지 않습니다.',
        extra_elements: ['원본 상단 보존', '원본 중앙 보존', '원본 하단 보존'],
        color_scheme: { background: '#ffffff', text_primary: '#111111', text_secondary: '#333333' },
        font_suggestion: { headline_size: '36px', body_size: '16px' },
      };
      const variantContent = { ...content, generation_mode: 'full_image', generation_basis: 'combined' };

      window.state.step = 'preview';
      window.state.productName = '상세JPG전체이미지검증';
      window.state.analysis = { product_name: window.state.productName, category: '회귀검증' };
      window.state.layoutTemplate = 'classic';
      window.state.previewViewport = 'pc';
      window.state.previewLayerMode = false;
      window.state.previewLayerEdits = {};
      window.state.fixedDetailImages = { brand: null, package: null, return: null };
      window.state.sectionContents = { [sectionId]: content };
      window.state.sectionImages = { [sectionId]: sourceUrl };
      window.state.sectionVariants = {
        [sectionId]: [{
          id: 'variant_full_image_v215',
          label: '전체 이미지 원본',
          source: 'single',
          createdAt: Date.now(),
          content: variantContent,
          image: sourceUrl,
          imageRef: '',
        }],
      };
      window.state.currentSectionVariantIds = { [sectionId]: 'variant_full_image_v215' };
      window.state.sectionGenerationMeta = {
        [sectionId]: { mode: 'full_image', basis: 'combined', label: '전체 이미지 원본' },
      };
      window.state.sectionGenerationModes = { [sectionId]: 'mixed' };
      window.state.sectionOrder = [sectionId];
      window.state.hiddenSectionIds = window.orderedSections()
        .filter(item => item.id !== sectionId)
        .map(item => item.id);
      window.state.skipSections = [];
      window.state.customSections = [];
      window.state.sectionGenerating = {};
      window.state.error = '';
      window.render();
      return {
        build: window.__KUASANGSE_APP_BUILD_ID__ || '',
        sectionId,
        sectionName: section?.name || '',
        selectedVariantMode: variantContent.generation_mode,
        currentSettingMode: window.getSectionGenerationMode(sectionId),
        metadataMode: window.state.sectionGenerationMeta[sectionId].mode,
        sourceUrl,
      };
    })()`);

    await waitFor(cdp, `(() => {
      const image = document.querySelector('[data-preview-section="competitive_edge"] img[data-section-main-image]');
      return !!(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    })()`, 30000);

    // 전체 이미지 시안은 화면에서도 이미지 레이어 하나만 보여야 한다.
    result.preview = await evaluate(cdp, `(() => {
      const root = document.querySelector('[data-preview-section="competitive_edge"]');
      const image = root?.querySelector('img[data-section-main-image]');
      const visible = element => {
        for (let node = element; node && node !== root; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      };
      const textNodes = Array.from(root?.querySelectorAll('h2,h3,p') || []).filter(visible);
      const visibleLayers = Array.from(root?.querySelectorAll('[data-layer-id]') || [])
        .filter(visible)
        .map(node => node.dataset.layerId);
      const rect = image?.getBoundingClientRect();
      return {
        visibleTextCount: textNodes.length,
        visibleText: textNodes.map(node => String(node.textContent || '').trim()),
        visibleLayers,
        imageComplete: !!image?.complete,
        naturalWidth: image?.naturalWidth || 0,
        naturalHeight: image?.naturalHeight || 0,
        renderedWidth: rect?.width || 0,
        renderedHeight: rect?.height || 0,
        sectionText: String(root?.innerText || '').trim().slice(0, 600),
      };
    })()`);

    await evaluate(cdp, `(() => {
      document.querySelector('[data-preview-section="competitive_edge"]')?.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await capture(cdp, SCREENSHOT_PATH);

    // 사용자가 누르는 전체 JPG 경로와 같은 captureCleanJpegBlob으로 실제 JPEG를 만든다.
    const exported = await evaluate(cdp, `(async () => {
      const preview = document.querySelector('.preview-wrap');
      const blob = await window.captureCleanJpegBlob(preview, { scale: 1, quality: 0.94 });
      const bitmap = await createImageBitmap(blob);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('JPG FileReader 실패'));
        reader.readAsDataURL(blob);
      });
      return {
        width: bitmap.width,
        height: bitmap.height,
        size: blob.size,
        type: blob.type,
        dataUrl,
      };
    })()`);
    const jpegBase64 = String(exported.dataUrl || '').split(',')[1] || '';
    fs.writeFileSync(JPG_PATH, Buffer.from(jpegBase64, 'base64'));
    result.exported = { ...exported, dataUrl: undefined };

    const naturalRatio = result.preview.naturalHeight / Math.max(1, result.preview.naturalWidth);
    const renderedRatio = result.preview.renderedHeight / Math.max(1, result.preview.renderedWidth);
    const exportedRatio = exported.height / Math.max(1, exported.width);
    result.ratios = { naturalRatio, renderedRatio, exportedRatio };

    assertChecks([
      { ok: result.setup.build === sourceBuild, message: `실행 빌드가 현재 소스와 다릅니다: ${result.setup.build} / ${sourceBuild}` },
      { ok: result.setup.selectedVariantMode === 'full_image', message: `선택 시안 모드가 전체 이미지가 아닙니다: ${result.setup.selectedVariantMode}` },
      { ok: result.setup.metadataMode === 'full_image', message: `저장 메타 모드가 전체 이미지가 아닙니다: ${result.setup.metadataMode}` },
      { ok: result.setup.currentSettingMode === 'mixed', message: `회귀 fixture의 현재 UI 모드가 mixed가 아닙니다: ${result.setup.currentSettingMode}` },
      { ok: result.preview.visibleTextCount === 0, message: `전체 이미지 시안 밖에 앱 제목/본문 ${result.preview.visibleTextCount}개가 중복 렌더됐습니다: ${result.preview.visibleText.join(' / ')}` },
      { ok: result.preview.visibleLayers.length === 1 && result.preview.visibleLayers[0] === 'image', message: `전체 이미지 시안의 보이는 레이어가 이미지 하나가 아닙니다: ${result.preview.visibleLayers.join(',')}` },
      { ok: result.preview.imageComplete && result.preview.naturalWidth > 0, message: 'JPG 캡처 전에 원본 이미지가 로드·디코드되지 않았습니다.' },
      { ok: Math.abs(renderedRatio - naturalRatio) < 0.02, message: `화면 이미지 종횡비가 원본과 다릅니다: ${naturalRatio.toFixed(4)} -> ${renderedRatio.toFixed(4)}` },
      { ok: Math.abs(exportedRatio - naturalRatio) < 0.04, message: `JPG 종횡비가 원본과 다릅니다: ${naturalRatio.toFixed(4)} -> ${exportedRatio.toFixed(4)}` },
      { ok: exported.size > 10000 && exported.type === 'image/jpeg', message: `실제 JPG 산출물이 비정상입니다: ${exported.type} / ${exported.size} bytes` },
    ]);

    result.ok = true;
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.error = error?.stack || error?.message || String(error);
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    throw error;
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
