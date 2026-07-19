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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9337';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-tabs-perf-cdp-v96.json');

const FACTORY_TABS = [
  { key: 'factory_start', label: '조립공장', tabId: 'start', screenshot: 'factory-tabs-perf-start-cdp-v96.png' },
  { key: 'db', label: 'DB 확정', tabId: 'db', screenshot: 'factory-tabs-perf-db-cdp-v96.png' },
  { key: 'assets', label: '생성컷 선택', tabId: 'assets', screenshot: 'factory-tabs-perf-assets-cdp-v96.png' },
  { key: 'sections', label: '섹션 설정', tabId: 'sections', screenshot: 'factory-tabs-perf-sections-cdp-v96.png' },
  { key: 'publish', label: '전송', tabId: 'publish', screenshot: 'factory-tabs-perf-publish-cdp-v96.png' },
];

function svgData(label, color = '#6366f1', bytes = 9000) {
  const filler = `${label}-`.repeat(Math.max(1, Math.ceil(bytes / Math.max(1, label.length + 1))));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="520" viewBox="0 0 820 520">
  <rect width="820" height="520" fill="#f8fafc"/>
  <rect x="86" y="72" width="648" height="376" rx="38" fill="${color}"/>
  <text x="410" y="250" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#fff">${label}</text>
  <text x="410" y="310" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#dbeafe">${filler.slice(0, 1200)}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function capture(cdp, fileName) {
  const filePath = path.join(OUT_DIR, fileName);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
  return filePath;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = cdpRuntime.targets.find(item => item.type === 'page') || cdpRuntime.targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1180,
      height: 560,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.orderedSections)', 60000);

    const images = Array.from({ length: 48 }, (_, index) => {
      const colors = ['#2563eb', '#059669', '#7c3aed', '#ea580c', '#0891b2'];
      return svgData(`tab-${index + 1}`, colors[index % colors.length]);
    });
    const seed = await evaluate(cdp, `(() => {
      const images = ${JSON.stringify(images)};
      const productName = '탭렉측정상품V96';
      const runId = 'tabs_perf_run_v96';
      const stages = ['hero', 'size', 'cuts', 'options', 'detail'];
      const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(productName) : productName;
      const inputImage = images[0];
      const inputBase64 = inputImage.includes(',') ? inputImage.split(',').slice(1).join(',') : inputImage;
      const inputFp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(inputBase64) : 'tabs_perf_input_v96';
      window.state.step = 'factory';
      window.state.productName = productName;
      window.state.currentProjectName = productName;
      window.state.imagePreview = inputImage;
      window.state.imageBase64 = inputBase64;
      window.state.imageMime = 'image/svg+xml';
      window.state.analysis = {
        product_name: productName,
        category: '검증상품',
        price: '12900',
        materials: '폴리에스터',
        size: '10 x 8 cm',
        product_features: ['탭 성능 측정', '15섹션 보유']
      };
      window.state.productInfoManualValues = {
        product_name: productName,
        price: '12900',
        width_mm: '10cm',
        depth_mm: '8cm',
        weight: '42g',
        material: '폴리에스터'
      };
      window.state.sectionContents = {};
      window.state.sectionImages = {};
      window.orderedSections().forEach((section, index) => {
        window.state.sectionContents[section.id] = {
          headline: '고객용 제목 ' + (index + 1),
          subheadline: '작업 라벨 없는 상세 문장',
          body_text: '탭 성능 측정을 위한 섹션 본문입니다. 제품 장점과 사용 상황을 자연스럽게 설명합니다.',
          extra_elements: ['고객용 장점 ' + (index + 1), '반복 작업 화면에서도 끊김 없이 확인'],
          color_scheme: {
            background: index % 2 ? '#ffffff' : '#f8fafc',
            text_primary: '#111827',
            text_secondary: '#334155',
            accent: '#6366f1'
          },
          font_suggestion: {
            headline_size: '32px',
            body_size: '16px',
            headline_weight: '800',
            headline_font: 'Pretendard',
            body_font: 'Noto Sans KR'
          }
        };
        if (index < 5) window.state.sectionImages[section.id] = images[index + 1];
      });
      const factory = window.factoryState();
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
      factory.product.imagePreview = inputImage;
      factory.product.imageBase64 = inputBase64;
      factory.product.imageMime = 'image/svg+xml';
      factory.product.inputImages = [{
        id: 'tabs_perf_input_v96',
        name: 'tabs-perf-input.svg',
        base64: inputBase64,
        mime: 'image/svg+xml',
        preview: inputImage,
        hasImage: true,
        currentRunId: runId,
        productKey,
        inputImageFingerprint: inputFp
      }];
      factory.automation = factory.automation || {};
      factory.automation.currentRunId = runId;
      factory.automation.activeTab = 'start';
      factory.sources = factory.sources || {};
      factory.sources.sinhwa = {
        status: 'done',
        selectedId: 'tabs-db-v96',
        candidates: [{
          id: 'tabs-db-v96',
          product_name: productName,
          price: '12900',
          material: '폴리에스터',
          size: '10 x 8 cm'
        }]
      };
      factory.market = factory.market || {};
      factory.market.selectedCandidates = [{
        id: 'tabs-market-v96',
        title: productName + ' 후보',
        platform: 'VM 결과',
        price: '12900',
        product_url: 'https://example.invalid/tabs-v96'
      }];
      factory.stages = factory.stages || {};
      stages.forEach(stageId => {
        factory.stages[stageId] = {
          ...(factory.stages[stageId] || {}),
          status: 'done',
          message: '탭 렉 측정 후보',
          currentRunId: runId,
          latestGenerationRunId: runId,
          selectedAssetIds: []
        };
      });
      factory.assets = images.slice(0, 45).map((image, index) => {
        const stageId = stages[index % stages.length];
        const meta = {
          currentRunId: runId,
          generationRunId: runId,
          productKey,
          productIdentityKey: productKey,
          inputImageFingerprint: inputFp,
          inputImageKey: inputFp,
          sourceImageKey: inputFp,
          productImageKey: inputFp,
          stageId,
          productName
        };
        const asset = {
          id: 'tabs_perf_asset_' + index,
          stageId,
          type: stageId === 'detail' ? 'html' : 'image',
          title: '탭 성능 후보 ' + (index + 1),
          image,
          html: stageId === 'detail' ? '<section><img src="' + image + '"><p>탭 성능 상세</p></section>' : '',
          used: index % 7 === 0,
          currentRunId: runId,
          generationRunId: runId,
          productKey,
          inputImageFingerprint: inputFp,
          metadata: meta,
          sourceMap: { ...meta }
        };
        if (factory.stages[stageId] && index < 15) {
          factory.stages[stageId].selectedAssetIds = window.uniqueApiKeys([...(factory.stages[stageId].selectedAssetIds || []), asset.id]);
        }
        return asset;
      });
      window.state.factory = window.normalizeFactoryState ? window.normalizeFactoryState(factory) : factory;
      const t0 = performance.now();
      window.render();
      return {
        productName,
        runId,
        sectionCount: window.orderedSections().length,
        assetCount: factory.assets.length,
        initialRenderCallMs: Math.round(performance.now() - t0)
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 500));

    const results = [];
    for (const tab of FACTORY_TABS) {
      const timing = await evaluate(cdp, `new Promise(resolve => {
        const started = performance.now();
        window.state.step = 'factory';
        const factory = window.factoryState();
        factory.automation = factory.automation || {};
        factory.automation.activeTab = ${JSON.stringify(tab.tabId)};
        window.render();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const main = document.querySelector('.main');
          const tabButton = document.querySelector('[data-factory-auto-tab=${JSON.stringify(tab.tabId)}]');
          const activeButton = document.querySelector('.factory-automation-tab.active');
          const text = document.body?.innerText || '';
          resolve({
            key: ${JSON.stringify(tab.key)},
            label: ${JSON.stringify(tab.label)},
            tabId: ${JSON.stringify(tab.tabId)},
            frameMs: Math.round(performance.now() - started),
            renderMs: Math.round(window.__KUASANGSE_RENDER_LAST_MS__ || 0),
            domNodes: document.querySelectorAll('*').length,
            imgCount: document.images.length,
            activeText: activeButton?.innerText?.trim() || '',
            tabVisible: !!tabButton,
            labelVisible: text.includes(${JSON.stringify(tab.label)}) || text.includes('섹션 생성'),
            mainScrollable: !!main && main.scrollHeight > main.clientHeight,
            mainScrollHeight: main?.scrollHeight || 0,
            mainClientHeight: main?.clientHeight || 0,
            mainOverflowY: main ? getComputedStyle(main).overflowY : '',
            bodyScrollHeight: document.documentElement.scrollHeight,
            innerHeight: window.innerHeight,
          });
        }));
      })`);
      await evaluate(cdp, `(() => {
        const el = document.querySelector('[data-factory-auto-tab=${JSON.stringify(tab.tabId)}]') || document.querySelector('#factoryAutomationWizard') || document.body;
        el.scrollIntoView({ block: 'start', inline: 'nearest' });
        window.scrollBy(0, -10);
        return true;
      })()`).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 250));
      timing.screenshot = await capture(cdp, tab.screenshot);
      results.push(timing);
    }

    const previewTiming = await evaluate(cdp, `new Promise(resolve => {
      const started = performance.now();
      window.state.step = 'preview';
      window.render();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const main = document.querySelector('.main');
        const text = document.body?.innerText || '';
        resolve({
          key: 'preview',
          label: '미리보기',
          frameMs: Math.round(performance.now() - started),
          renderMs: Math.round(window.__KUASANGSE_RENDER_LAST_MS__ || 0),
          domNodes: document.querySelectorAll('*').length,
          imgCount: document.images.length,
          labelVisible: text.includes('상세페이지 미리보기'),
          sectionPhraseCount: (text.match(/고객용 제목/g) || []).length,
          mainScrollable: !!main && main.scrollHeight > main.clientHeight,
          mainScrollHeight: main?.scrollHeight || 0,
          mainClientHeight: main?.clientHeight || 0,
          mainOverflowY: main ? getComputedStyle(main).overflowY : '',
          bodyScrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
        });
      }));
    })`);
    await evaluate(cdp, `(() => {
      document.querySelector('.preview-wrap')?.scrollIntoView({ block: 'start', inline: 'nearest' });
      return true;
    })()`).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 250));
    previewTiming.screenshot = await capture(cdp, 'factory-tabs-perf-preview-cdp-v96.png');
    results.splice(4, 0, previewTiming);

    const failures = [];
    for (const item of results) {
      if (item.frameMs > 1500) failures.push(`${item.label} frameMs ${item.frameMs}ms`);
      if (item.renderMs > 1000) failures.push(`${item.label} renderMs ${item.renderMs}ms`);
      if (item.domNodes > 12000) failures.push(`${item.label} DOM 노드 ${item.domNodes}`);
      if (!item.mainScrollable || item.mainOverflowY === 'hidden') failures.push(`${item.label} 작은 높이 스크롤 도달성 실패`);
      if (!item.labelVisible) failures.push(`${item.label} 화면 라벨 확인 실패`);
    }
    if (seed.sectionCount !== 15) failures.push(`섹션 수가 15개가 아닙니다: ${seed.sectionCount}`);

    const payload = {
      ok: failures.length === 0,
      url: APP_URL,
      viewport: { width: 1180, height: 560 },
      seed,
      results,
      failures,
      thresholds: {
        frameMs: '<=1500',
        renderMs: '<=1000',
        domNodes: '<=12000',
        mainScrollable: true,
      },
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    assertChecks(failures.map(message => ({ ok: false, message })));
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await cdpRuntime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
