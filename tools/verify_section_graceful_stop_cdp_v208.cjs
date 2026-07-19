const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9338';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RUNNING_SCREENSHOT = path.join(OUT_DIR, 'section-graceful-stop-running-v208.png');
const REQUESTED_SCREENSHOT = path.join(OUT_DIR, 'section-graceful-stop-requested-v208.png');
const PREVIEW_SCREENSHOT = path.join(OUT_DIR, 'section-graceful-stop-preview-v208.png');
const SMALL_PREVIEW_SCREENSHOT = path.join(OUT_DIR, 'section-graceful-stop-preview-small-v208.png');
const RESULT_PATH = path.join(OUT_DIR, 'section-graceful-stop-v208.json');

async function capture(cdp, filePath) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);

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
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyBust=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.generateAllSections && window.factoryState)', 60000);
    await new Promise(resolve => setTimeout(resolve, 1500));

    const setup = await evaluate(cdp, `(() => {
      const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const imageBase64 = imageData.split(',')[1];
      const allSections = window.orderedSections().slice(0, 3);
      const factory = window.factoryState();
      factory.workspaceId = 'project_section_stop_v208';
      factory.product = {
        ...(factory.product || {}),
        userProductName: '섹션중지검증상품',
        productName: '섹션중지검증상품',
        productKey: '섹션중지검증상품',
        productIdentityKey: '섹션중지검증상품',
        currentRunId: 'run_section_stop_v208',
        inputImageFingerprint: 'fingerprint_section_stop_v208',
        lockedInputImageFingerprint: 'fingerprint_section_stop_v208',
        imageBase64,
        imageMime: 'image/png',
        imagePreview: imageData,
      };
      window.state.currentProjectId = 'project_section_stop_v208';
      window.state.currentProjectName = '섹션중지검증상품';
      window.state.productName = '섹션중지검증상품';
      window.state.imageBase64 = imageBase64;
      window.state.imageMime = 'image/png';
      window.state.imagePreview = imageData;
      window.state.analysisImages = [{ base64: imageBase64, mime: 'image/png' }];
      window.state.analysis = {
        product_name: '섹션중지검증상품',
        category: '검증용 제품',
        mood: '정돈된 실용성',
        key_features: ['현재 섹션 완료 후 중지'],
      };
      if (typeof window.attachCurrentAnalysisImageIdentity === 'function') {
        window.attachCurrentAnalysisImageIdentity(window.state.analysis);
      }
      window.state.sectionContents = {};
      window.state.sectionImages = {};
      window.state.sectionLocks = {};
      window.state.sectionGenerating = {};
      window.state.sectionBatchRun = null;
      window.state.sectionWorkScope = typeof window.sectionWorkScopeMeta === 'function'
        ? window.sectionWorkScopeMeta()
        : null;
      window.__sectionStopErrorsV208 = [];
      window.addEventListener('error', event => {
        window.__sectionStopErrorsV208.push(String(event?.error?.stack || event?.message || 'window error'));
      });
      window.addEventListener('unhandledrejection', event => {
        window.__sectionStopErrorsV208.push(String(event?.reason?.stack || event?.reason || 'unhandled rejection'));
      });
      window.orderedSections = () => allSections;
      window.ensureCurrentProductAnalysisForGeneration = () => true;
      window.hasImageConnection = () => true;
      window.syncFixedSectionPlacementImage = () => null;
      window.__sectionStopV208 = {
        calls: [],
        imageCalls: [],
        targetIds: allSections.map(section => section.id),
        firstResolved: false,
      };
      window.__sectionStopV208.firstGate = new Promise(resolve => {
        window.__sectionStopV208.resolveFirst = () => {
          window.__sectionStopV208.firstResolved = true;
          resolve();
        };
      });
      window.getLLMClient = () => ({
        generateSectionContent: async section => {
          window.__sectionStopV208.calls.push(section.id);
          const callNumber = window.__sectionStopV208.calls.length;
          if (window.__sectionStopV208.calls.length === 1) await window.__sectionStopV208.firstGate;
          return {
            headline: '부분 완료 고객 문구 ' + callNumber,
            subheadline: '현재 섹션 저장 확인',
            body_text: '고객용 상세 설명 ' + callNumber,
            bullets: ['다음 섹션 호출 금지'],
            color_scheme: { background: '#ffffff', text_primary: '#111827', text_secondary: '#4b5563' },
            font_suggestion: { headline_size: '36px', body_size: '16px' },
          };
        },
      });
      window.generateWithSelectedImageModel = async prompt => {
        window.__sectionStopV208.imageCalls.push(String(prompt || ''));
        return imageData;
      };
      window.state.step = 'sections';
      window.render();
      window.__sectionStopV208.runPromise = window.generateAllSections();
      return { targetIds: window.__sectionStopV208.targetIds };
    })()`);

    await waitFor(cdp, `(() => {
      const test = window.__sectionStopV208 || {};
      return test.calls?.length === 1 && window.state?.step === 'generating';
    })()`, 15000);
    const running = await evaluate(cdp, `(() => {
      const button = document.getElementById('stopAfterCurrentSection');
      return {
        buttonExists: !!button,
        buttonText: String(button?.textContent || '').trim(),
        currentSectionId: window.state.sectionBatchRun?.currentSectionId || '',
        message: window.state.sectionBatchRun?.message || '',
      };
    })()`);
    await capture(cdp, RUNNING_SCREENSHOT);

    if (!running.buttonExists) {
      await evaluate(cdp, 'window.__sectionStopV208.resolveFirst(); true');
      await evaluate(cdp, 'window.__sectionStopV208.runPromise');
      throw new Error('현재 섹션 완료 후 중지 버튼이 생성 화면에 없습니다.');
    }

    const requested = await evaluate(cdp, `(() => {
      document.getElementById('stopAfterCurrentSection').click();
      const run = window.state.sectionBatchRun || {};
      const button = document.getElementById('stopAfterCurrentSection');
      return {
        stopRequested: !!run.stopRequested,
        status: run.status || '',
        message: run.message || '',
        buttonText: String(button?.textContent || '').trim(),
        buttonDisabled: !!button?.disabled,
      };
    })()`);
    await capture(cdp, REQUESTED_SCREENSHOT);
    await evaluate(cdp, 'window.__sectionStopV208.resolveFirst(); true');
    try {
      await waitFor(cdp, `window.state?.sectionBatchRun?.status === 'stopped'`, 20000);
    } catch (error) {
      const stalled = await evaluate(cdp, `(() => ({
        run: window.state?.sectionBatchRun || null,
        calls: window.__sectionStopV208?.calls || [],
        imageCalls: window.__sectionStopV208?.imageCalls?.length || 0,
        firstResolved: !!window.__sectionStopV208?.firstResolved,
        generating: window.state?.sectionGenerating || {},
        contentIds: Object.keys(window.state?.sectionContents || {}),
        imageIds: Object.keys(window.state?.sectionImages || {}),
        error: window.state?.error || '',
      }))()`);
      throw new Error(`${error.message}\n중단 대기 상태: ${JSON.stringify(stalled, null, 2)}`);
    }
    const runResult = await evaluate(cdp, 'window.__sectionStopV208.runPromise');
    await new Promise(resolve => setTimeout(resolve, 300));

    const proof = await evaluate(cdp, `(() => {
      const test = window.__sectionStopV208 || {};
      const run = window.state.sectionBatchRun || {};
      const html = window.buildExportHtml(
        window.state.analysis,
        window.state.sectionContents,
        window.state.sectionImages,
        window.state.detailImageBlocks || []
      );
      return {
        runResult: ${JSON.stringify(runResult)},
        calls: test.calls || [],
        imageCallCount: test.imageCalls?.length || 0,
        targetIds: test.targetIds || [],
        status: run.status || '',
        completed: Number(run.completed || 0),
        total: Number(run.total || 0),
        failed: Number(run.failed || 0),
        progress: Number(run.progress || 0),
        message: run.message || '',
        detail: run.detail || '',
        stopRequested: !!run.stopRequested,
        step: window.state.step || '',
        contentIds: Object.keys(window.state.sectionContents || {}),
        imageIds: Object.keys(window.state.sectionImages || {}),
        previewSections: Array.from(document.querySelectorAll('[data-preview-section]')).map(node => node.dataset.previewSection),
        bodyText: String(document.body.innerText || ''),
        htmlHasFirst: html.includes('부분 완료 고객 문구 1'),
        htmlHasSecond: html.includes('부분 완료 고객 문구 2'),
        runtimeErrors: window.__sectionStopErrorsV208 || [],
      };
    })()`);
    await capture(cdp, PREVIEW_SCREENSHOT);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 620,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const smallLayout = await evaluate(cdp, `(() => {
      const noticeButton = document.getElementById('openRemainingSectionsAfterStop');
      const notice = noticeButton?.closest('.app-notice') || noticeButton?.parentElement || null;
      if (notice) notice.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = notice?.getBoundingClientRect() || null;
      const root = document.scrollingElement || document.documentElement;
      const main = document.querySelector('.main');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
        pageScrollable: root.scrollHeight > root.clientHeight + 1,
        mainScrollable: !!main && main.scrollHeight > main.clientHeight + 1,
        noticeExists: !!notice,
        noticeReachable: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
        noticeRect: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width) } : null,
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await capture(cdp, SMALL_PREVIEW_SCREENSHOT);

    fs.writeFileSync(RESULT_PATH, JSON.stringify({
      ok: false,
      phase: 'before-assertions',
      running,
      requested,
      proof,
      smallLayout,
      screenshots: [RUNNING_SCREENSHOT, REQUESTED_SCREENSHOT, PREVIEW_SCREENSHOT, SMALL_PREVIEW_SCREENSHOT],
    }, null, 2));

    assertChecks([
      { ok: requested.stopRequested, message: '중지 요청 상태가 기록되지 않았습니다.' },
      { ok: requested.buttonDisabled, message: '중지 요청 뒤 버튼이 비활성화되지 않았습니다.' },
      { ok: /마무리|중지/.test(requested.buttonText), message: '중지 요청 뒤 현재 섹션 마무리 상태가 표시되지 않았습니다.' },
      { ok: proof.calls.length === 1, message: `중지 요청 뒤 다음 섹션이 호출됐습니다: ${proof.calls.join(', ')}` },
      { ok: proof.status === 'stopped', message: `중지 종료 상태가 아닙니다: ${proof.status}` },
      { ok: proof.completed === 1, message: `완료 섹션 수가 1이 아닙니다: ${proof.completed}` },
      { ok: proof.contentIds.length === 1 && proof.contentIds[0] === setup.targetIds[0], message: `완료 섹션 콘텐츠가 정확히 하나 남지 않았습니다: ${proof.contentIds.join(', ')}` },
      { ok: proof.imageIds.length === 1 && proof.imageIds[0] === setup.targetIds[0], message: `완료 섹션 이미지가 정확히 하나 남지 않았습니다: ${proof.imageIds.join(', ')}` },
      { ok: proof.step === 'preview', message: `중지 후 미리보기로 이동하지 않았습니다: ${proof.step}` },
      { ok: proof.previewSections.includes(setup.targetIds[0]), message: '완료된 섹션이 미리보기 DOM에 없습니다.' },
      { ok: proof.bodyText.includes('현재 섹션까지 생성하고 중지'), message: '부분 완료 안내가 미리보기에 표시되지 않았습니다.' },
      { ok: proof.htmlHasFirst && !proof.htmlHasSecond, message: `부분 상세 HTML 범위가 맞지 않습니다. first=${proof.htmlHasFirst}, second=${proof.htmlHasSecond}` },
      { ok: proof.runtimeErrors.length === 0, message: `브라우저 런타임 예외가 발생했습니다: ${proof.runtimeErrors.join(' | ')}` },
      { ok: smallLayout.noticeExists && smallLayout.noticeReachable, message: `작은 화면에서 부분 완료 안내에 도달할 수 없습니다: ${JSON.stringify(smallLayout)}` },
      { ok: !smallLayout.horizontalOverflow, message: `작은 화면에 가로 넘침이 있습니다: ${JSON.stringify(smallLayout)}` },
      { ok: smallLayout.pageScrollable || smallLayout.mainScrollable, message: `작은 화면에서 전체 콘텐츠 세로 스크롤이 열리지 않습니다: ${JSON.stringify(smallLayout)}` },
    ]);

    const result = {
      ok: true,
      running,
      requested,
      proof,
      smallLayout,
      screenshots: [RUNNING_SCREENSHOT, REQUESTED_SCREENSHOT, PREVIEW_SCREENSHOT, SMALL_PREVIEW_SCREENSHOT],
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
