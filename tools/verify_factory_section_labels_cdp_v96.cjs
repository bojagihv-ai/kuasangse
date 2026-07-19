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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9336';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-section-label-cdp-v96.json');
const PREVIEW_SCREENSHOT = path.join(OUT_DIR, 'factory-section-label-app-preview-cdp-v96.png');
const CUSTOMER_SCREENSHOT = path.join(OUT_DIR, 'factory-section-label-customer-cdp-v96.png');

const BANNED_LABEL_RE = /\[(?:헤더|Header|훅|Hook|핵심\s*특징|Features|상세\s*스펙|Specifications|사용\s*시나리오|Scenario|비교\s*우위|Competitive|소재|Material|인증|Certification|리뷰|Reviews|프로모션|Promotion|배송|Shipping|FAQ|CTA|Footer|푸터)\]/gi;

function svgData(label, color = '#6366f1') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="420" viewBox="0 0 760 420">
  <rect width="760" height="420" fill="#fff7ed"/>
  <rect x="110" y="90" width="540" height="240" rx="34" fill="${color}"/>
  <text x="380" y="222" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function collectBanned(value) {
  return Array.from(String(value || '').matchAll(BANNED_LABEL_RE)).map(match => match[0]);
}

async function capture(cdp, filePath, fullPage = true) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = cdpRuntime.targets.find(item => item.type === 'page') || cdpRuntime.targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  const payload = {
    ok: false,
    url: APP_URL,
    previewScreenshot: PREVIEW_SCREENSHOT,
    customerScreenshot: CUSTOMER_SCREENSHOT,
  };
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.orderedSections && window.buildExportHtml)', 60000);

    const seed = await evaluate(cdp, `(() => {
      const labels = [
        '[헤더]', '[Header]', '[훅]', '[Hook]', '[핵심 특징]', '[Features]', '[상세 스펙]',
        '[Specifications]', '[사용 시나리오]', '[Scenario]', '[비교 우위]', '[Material]',
        '[Certification]', '[FAQ]', '[CTA]'
      ];
      const productName = 'LabelGuardProductV96';
      const image = ${JSON.stringify(svgData('label-v96'))};
      const base64 = image.includes(',') ? image.split(',').slice(1).join(',') : image;
      window.state.step = 'preview';
      window.state.productName = productName;
      window.state.analysis = { product_name: productName, category: '검증상품' };
      window.state.imagePreview = image;
      window.state.imageBase64 = base64;
      window.state.imageMime = 'image/svg+xml';
      window.state.layoutTemplate = 'classic';
      window.state.sectionContents = {};
      window.state.sectionImages = {};
      const sections = window.orderedSections();
      sections.forEach((section, index) => {
        const labelA = labels[index % labels.length];
        const labelB = labels[(index + 1) % labels.length];
        const labelC = labels[(index + 2) % labels.length];
        window.state.sectionContents[section.id] = {
          headline: labelA,
          subheadline: '[' + section.name + ']',
          body_text: labelB + '\\n고객 노출 문장 ' + (index + 1) + ': 작업용 라벨 없이 제품 장점을 설명합니다.',
          extra_elements: [labelC, '실제 장점 ' + (index + 1) + '번은 고객에게 보여야 합니다.'],
          cta_text: index === sections.length - 1 ? '[CTA]' : '',
          color_scheme: {
            background: index % 2 ? '#ffffff' : '#f8fafc',
            text_primary: '#111827',
            text_secondary: '#334155',
            accent: '#6366f1'
          },
          font_suggestion: {
            headline_size: '34px',
            body_size: '16px',
            headline_weight: '800',
            headline_font: 'Pretendard',
            body_font: 'Noto Sans KR'
          }
        };
      });
      window.render();
      const exportHtml = window.buildExportHtml(window.state.analysis, window.state.sectionContents, window.state.sectionImages, []);
      const parser = new DOMParser();
      const doc = parser.parseFromString(exportHtml, 'text/html');
      const exportText = doc.body?.innerText || doc.body?.textContent || '';
      return {
        productName,
        sectionCount: sections.length,
        sectionIds: sections.map(section => section.id),
        previewText: document.querySelector('.preview-wrap')?.innerText || '',
        exportHtml,
        exportText,
        visiblePhraseCount: (exportText.match(/고객 노출 문장/g) || []).length,
        bodyChildCount: doc.body?.children?.length || 0
      };
    })()`);

    payload.seed = {
      productName: seed.productName,
      sectionCount: seed.sectionCount,
      sectionIds: seed.sectionIds,
      visiblePhraseCount: seed.visiblePhraseCount,
      bodyChildCount: seed.bodyChildCount,
      previewBannedLabels: collectBanned(seed.previewText),
      exportBannedLabels: collectBanned(seed.exportText),
      exportHtmlBannedLabels: collectBanned(seed.exportHtml),
      exportTextSample: String(seed.exportText || '').slice(0, 1800),
    };
    await capture(cdp, PREVIEW_SCREENSHOT, true);

    const customerDataUrl = `data:text/html;base64,${Buffer.from(seed.exportHtml).toString('base64')}`;
    await cdp.send('Page.navigate', { url: customerDataUrl });
    await waitFor(cdp, 'document.readyState === "complete" && !!document.body', 30000);
    await new Promise(resolve => setTimeout(resolve, 600));
    const customer = await evaluate(cdp, `(() => {
      const text = document.body?.innerText || '';
      const html = document.documentElement?.outerHTML || '';
      return {
        title: document.title,
        text,
        html,
        visiblePhraseCount: (text.match(/고객 노출 문장/g) || []).length,
        bodyChildCount: document.body?.children?.length || 0,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight
      };
    })()`);
    await capture(cdp, CUSTOMER_SCREENSHOT, true);
    payload.customer = {
      title: customer.title,
      visiblePhraseCount: customer.visiblePhraseCount,
      bodyChildCount: customer.bodyChildCount,
      scrollHeight: customer.scrollHeight,
      innerHeight: customer.innerHeight,
      bannedLabels: collectBanned(customer.text),
      htmlBannedLabels: collectBanned(customer.html),
      textSample: String(customer.text || '').slice(0, 1800),
    };

    const failures = [];
    if (seed.sectionCount !== 15) failures.push(`15섹션이 아닙니다: ${seed.sectionCount}`);
    if (customer.visiblePhraseCount !== 15) failures.push(`고객 문장 노출 개수 불일치: ${customer.visiblePhraseCount}`);
    if (payload.seed.exportBannedLabels.length) failures.push(`export 텍스트 작업용 라벨 노출: ${payload.seed.exportBannedLabels.join(', ')}`);
    if (payload.customer.bannedLabels.length) failures.push(`고객 렌더 작업용 라벨 노출: ${payload.customer.bannedLabels.join(', ')}`);
    if (payload.customer.htmlBannedLabels.length) failures.push(`고객 HTML 작업용 라벨 잔류: ${payload.customer.htmlBannedLabels.join(', ')}`);
    payload.ok = failures.length === 0;
    payload.failures = failures;
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    assertChecks(failures.map(message => ({ ok: false, message })));
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    payload.error = error?.stack || error?.message || String(error);
    payload.failures = payload.failures || [error?.message || String(error)];
    try { fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8'); } catch (_) {}
    throw error;
  } finally {
    try { cdp.close(); } catch (_) {}
    await cdpRuntime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
