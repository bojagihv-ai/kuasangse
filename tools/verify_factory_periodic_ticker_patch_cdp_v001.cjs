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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9345';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-periodic-ticker-patch-v001.json');
const SIMULATE_FIRST_LOADER_FAILURE = process.env.KUASANGSE_SIMULATE_FIRST_LOADER_FAILURE === '1';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  let navigationResult = null;
  let startupDiagnostic = null;

  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (SIMULATE_FIRST_LOADER_FAILURE) {
      await cdp.send('Network.setBlockedURLs', { urls: ['*app-loader.js*attempt=1*'] });
    }
    await cdp.send('Runtime.enable');
    const verifyUrl = new URL(APP_URL);
    verifyUrl.searchParams.set('factoryPeriodicTickerPatch', String(Date.now()));
    navigationResult = await cdp.send('Page.navigate', { url: verifyUrl.href });
    try {
      await waitFor(cdp, '!!(window.__KUASANGSE_APP_LOADER__ && window.state && window.render && window.startAnalysisPhaseProgress && window.startSectionBatchHeartbeat)', 60000);
    } catch (error) {
      startupDiagnostic = await evaluate(cdp, `(() => {
        const resources = performance.getEntriesByType('resource').map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, duration: Math.round(entry.duration), transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize }));
        const appText = String(document.getElementById('app')?.innerText || '').slice(0, 2000);
        const loadErrors = window.__KUASANGSE_LOAD_ERRORS__ || [];
        const loader = window.__KUASANGSE_APP_LOADER__ || null;
        const bootstrap = window.__KUASANGSE_LOADER_BOOTSTRAP__ || null;
        const loaderStage = loader ? 'ready' : bootstrap?.status || (appText.includes('앱 스크립트 로드 실패') ? 'load-error' : loadErrors.length ? 'script-error' : window.__KUASANGSE_RUNTIME_MANIFEST__ ? 'runtime-loading' : document.readyState === 'loading' ? 'document-loading' : 'manifest-loading');
        return { href: location.href, readyState: document.readyState, buildId: window.__KUASANGSE_APP_BUILD_ID__ || '', loaderStage, loader, bootstrap, bootstrapPromiseThenable: !!window.__KUASANGSE_BOOTSTRAP_PROMISE__?.then, loadErrors, globals: { state: typeof window.state, render: typeof window.render, analysisTicker: typeof window.startAnalysisPhaseProgress, sectionHeartbeat: typeof window.startSectionBatchHeartbeat }, appText, resourceFailures: resources.filter(entry => entry.duration === 0 || (!entry.transferSize && !entry.decodedBodySize)), resources: resources.slice(-80) };
      })()`).catch(diagnosticError => ({ diagnosticError: String(diagnosticError?.stack || diagnosticError) }));
      startupDiagnostic.resourceProbe = await evaluate(cdp, `(async () => {
        const url = window.__KUASANGSE_LOADER_BOOTSTRAP__?.loaderUrl || '';
        if (!url) return { attempted: false };
        try {
          const response = await fetch(url, { cache: 'no-store' });
          const body = await response.arrayBuffer();
          return { attempted: true, url, status: response.status, ok: response.ok, bytes: body.byteLength };
        } catch (probeError) {
          return { attempted: true, url, error: String(probeError?.message || probeError) };
        }
      })()`).catch(probeError => ({ attempted: true, diagnosticError: String(probeError?.stack || probeError) }));
      const failure = { ok: false, error: String(error?.stack || error), navigationResult, startupDiagnostic, runtime: runtime.diagnostics?.() || { launched: runtime.launched } };
      fs.writeFileSync(RESULT_PATH, JSON.stringify(failure, null, 2), 'utf8');
      throw new Error(`${error.message}\nstartup diagnostic: ${JSON.stringify(startupDiagnostic)}`);
    }
    const result = await evaluate(cdp, `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      state.step = 'factory';
      window.render();
      await wait(1200);
      const initialDesc = document.querySelector('#factoryAutomationWizard .factory-section-head p');
      const initialDescStyle = initialDesc ? getComputedStyle(initialDesc) : null;
      const layout = {
        factoryDescPresent: !!initialDesc,
        factoryDescWordBreak: initialDescStyle?.wordBreak || '',
        factoryDescOverflowWrap: initialDescStyle?.overflowWrap || '',
      };
      const measure = async (name, setup, start, cleanup) => {
        const factory = window.factoryState();
        factory.product = factory.product || {};
        factory.product.cafe24ReferenceAutoTried = true;
        factory.product.cafe24ReferenceLoading = false;
        await setup();
        window.render();
        await wait(1200);
        const originalRender = window.render;
        let renderCount = 0;
        window.render = function(...args) {
          renderCount += 1;
          return originalRender.apply(this, args);
        };
        let timer = null;
        try {
          timer = await start();
          await wait(4500);
        } finally {
          if (typeof timer === 'function') timer();
          if (typeof timer === 'number') clearInterval(timer);
          window.render = originalRender;
          await cleanup();
        }
        return { name, renderCount };
      };
      const analysis = await measure('analysis_phase_progress', async () => {
        const id = 'factory-periodic-ticker-patch-analysis-v001';
        state.step = 'analyzing';
        state.progress = 20;
        state.progressMsg = '제품 이미지 AI 분석 중';
        state.currentAnalysisRunId = id;
        state.analysisRuns = [{
          id,
          status: 'running',
          progress: 20,
          startedAt: Date.now(),
          logs: Array.from({ length: 80 }, (_, index) => ({
            message: '분석 진행 로그 ' + (index + 1),
            detail: '주기 갱신 회귀 계측',
            progress: 20,
            ts: Date.now() - (80 - index) * 1000,
          })),
        }];
      }, async () => startAnalysisPhaseProgress({ start: 20, end: 50, expectedMs: 8000, tickMs: 2000, displayMessage: '제품 이미지 AI 분석 중', logMessage: '제품 이미지 AI 분석 중' }), async () => {
        if (state.analysisRuns?.[0]) state.analysisRuns[0].status = 'completed';
      });
      const section = await measure('section_batch_heartbeat', async () => {
        state.step = 'generating';
        state.progress = 20;
        state.progressMsg = '섹션 생성 중';
        state.sectionBatchRun = { id: 'factory-periodic-ticker-patch-section-v001', status: 'running', startedAt: Date.now(), total: 12, completed: 0, failed: 0, progress: 20, message: '테스트 섹션 생성 중', detail: '계측', currentSectionId: '', currentSectionName: '테스트 섹션', logs: [] };
      }, async () => startSectionBatchHeartbeat(0, 12, '테스트 섹션'), async () => {
        if (state.sectionBatchRun) state.sectionBatchRun.status = 'idle';
      });
      return {
        analysis,
        section,
        layout,
        loaderBootstrap: window.__KUASANGSE_LOADER_BOOTSTRAP__ ? { ...window.__KUASANGSE_LOADER_BOOTSTRAP__ } : null,
      };
    })()`);
    const failures = [];
    if (result.analysis.renderCount !== 0) failures.push(`분석 진행 ticker가 full render를 ${result.analysis.renderCount}회 호출했습니다.`);
    if (result.section.renderCount !== 0) failures.push(`섹션 heartbeat가 full render를 ${result.section.renderCount}회 호출했습니다.`);
    if (!result.layout.factoryDescPresent) failures.push('조립공장 설명 영역을 찾지 못했습니다.');
    if (result.layout.factoryDescWordBreak !== 'keep-all') failures.push(`조립공장 설명의 한국어 줄바꿈 규칙이 유지되지 않았습니다: ${result.layout.factoryDescWordBreak}`);
    if (result.layout.factoryDescOverflowWrap !== 'break-word') failures.push(`조립공장 설명의 긴 문자열 줄바꿈 규칙이 유지되지 않았습니다: ${result.layout.factoryDescOverflowWrap}`);
    if (SIMULATE_FIRST_LOADER_FAILURE && (result.loaderBootstrap?.attempts !== 2 || result.loaderBootstrap?.status !== 'loaded')) {
      failures.push(`첫 app-loader 전송 실패 뒤 자체 복구되지 않았습니다: ${JSON.stringify(result.loaderBootstrap)}`);
    }
    const payload = { ok: failures.length === 0, simulatedFirstLoaderFailure: SIMULATE_FIRST_LOADER_FAILURE, result, failures, navigationResult };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ ...payload, resultPath: RESULT_PATH }, null, 2));
    assertChecks(failures.map(message => ({ ok: false, message })));
  } finally {
    try { cdp?.close(); } catch (_) {}
    await runtime.cleanup?.();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
