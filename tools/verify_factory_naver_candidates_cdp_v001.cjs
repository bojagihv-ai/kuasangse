// 실제 앱에서 **파란 시작 버튼을 눌러** 스마트스토어(네이버) 후보가 실제로 잡히는지 본다.
//
// 사용자(2026-08-30): "나보고 눌러보라하지말고 너가 눌르라고"
//
// 확인 순서:
//   1) 조립공장 시작 탭에 제품명을 넣는다
//   2) 이미지 생성 수량을 0으로 낮춘다 (경쟁사 수집만 보려는 것이므로)
//   3) **파란 시작 버튼(data-factory-guide-action="run-db")을 실제로 클릭한다**
//   4) 경쟁사 후보가 쌓일 때까지 기다린다
//   5) 후보의 주소를 호스트별로 세어 **naver 가 들어있는지** 확인한다
//
// 왜 이 검사가 필요한가 (실측 2026-08-30, API Hub 경유 JepumScraper 직접 호출):
//   본컴(local) → success 20/20  coupang 4 · **naver 4** · gmarket 4 · auction 4 · 11st 4
//   VM          → error   0/20   (90초 소요)
//   그런데 수동 시작 버튼 경로만 runCompMarketScrape('vm') 고정이라 네이버가 0건이었다.
//   사용자 저장본에서도 쿠팡·G마켓·11번가·옥션은 있고 네이버만 0건이었다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-naver-candidates-v001.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-naver-candidates-v001.json');

// 수집이 실제 외부 사이트를 도는 흐름이라 넉넉히 준다.
// 실측 2026-08-30: 본컴 경로는 사이트를 하나씩 순차로 돌기 때문에 **약 116초** 걸린다
// (사이트당 최대 70회 폴링 × 1.5초, 옥션만 36회). 짧게 잡았다가 세 번 헛짚었다 —
// 멈춘 것으로 보였지만 그냥 아직 도는 중이었다. 넉넉히 준다.
const COLLECT_TIMEOUT_MS = Number(process.env.KUASANGSE_NAVER_TIMEOUT_MS || 600000);
const KEYWORD = process.env.KUASANGSE_NAVER_KEYWORD || '수저집 파우치';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  const step = name => console.error('[step] ' + name);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Network 도메인은 켜지 않는다. 후보 이미지가 쏟아지면 이벤트가 측정을 흐린다.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, factoryCdpFixtureReadyExpression() + " && typeof saveLastWorkNow === 'function'", 60000);
    step('navigated');

    const seed = String(Date.now());

    // 1~2) 작업을 세우고, 이미지 생성 수량을 0으로 낮춘다.
    const prepared = await evaluateFactoryCdpFixture(cdp, `async ({ setAppState, readFactory, replaceFactory, renderApp }) => {
      const seed = ${JSON.stringify(seed)};
      const projectId = 'naver_candidates_' + seed;
      const productName = ${JSON.stringify(KEYWORD)};
      const createdAt = Date.now();
      setAppState({
        step: 'factory',
        currentProjectId: projectId,
        currentProjectName: productName,
        currentProjectCreatedAt: createdAt,
        productName,
      });
      let factory = normalizeFactoryState({});
      factoryStampWorkspaceIdentity(factory, { projectId, projectName: productName, createdAt });
      factory.product.productName = productName;
      factory.product.userProductName = productName;
      factory.automation.activeTab = 'start';
      // 시작 버튼은 제품 이미지가 있어야 흐름을 시작한다(화면에도 그렇게 적혀 있다).
      // 이미지가 없으면 아무 로그도 없이 조용히 끝나서, 검증기가 '눌렀는데 아무 일도
      // 안 일어남' 을 못 알아챈다. 실측으로 그렇게 한 번 헛돌았다.
      const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVQoU2NkYGD4z0AEYBxVSFJIYRxVSFJIYRwAAF0gAQFRz6bUAAAAAElFTkSuQmCC';
      factory.product.imageBase64 = tinyPng;
      factory.product.imageMime = 'image/png';
      factory.product.imageName = 'naver-verify.png';
      factory.product.imagePreview = 'data:image/png;base64,' + tinyPng;
      factory.product.inputImages = [{ base64: tinyPng, mime: 'image/png', name: 'naver-verify.png', preview: 'data:image/png;base64,' + tinyPng }];
      // 지문은 앱이 이미지에서 스스로 계산한다. 손으로 넣으면 작업범위가 어긋나
      // 수집한 후보가 '남의 것' 으로 걸러진다(실측: scopeOk=false 로 19건 전부 탈락).
      // 대표이미지·이미지컷은 이번 확인에 필요 없다. 0 으로 두면 그 단계는 건너뛴다.
      factory.automation.startRunCounts = { hero: 0, cuts: 0, competitors: 3 };
      replaceFactory(factory, { reason: 'naver-candidates-seed' });
      const authority = await ensureWorkspaceEditAuthority('project:' + projectId);
      if (authority && authority.mode !== 'editing') throw new Error('naver candidates authority acquisition failed');
      renderApp();

      const nameInput = document.getElementById('factoryGuideProductName');
      if (nameInput) {
        nameInput.value = productName;
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const startButton = document.querySelector('[data-factory-guide-action="run-db"]');
      return {
        projectId,
        productName,
        hasNameInput: !!nameInput,
        hasStartButton: !!startButton,
        startRunCounts: readFactory().automation.startRunCounts,
      };
    }`);

    assertChecks([
      { ok: prepared.hasNameInput, message: '시작 탭 제품명 입력칸을 찾지 못했습니다.' },
      { ok: prepared.hasStartButton, message: '파란 시작 버튼을 찾지 못했습니다.' },
    ]);
    step('prepared');

    // 3) 실제로 버튼을 누른다.
    await evaluate(cdp, `(() => {
      const button = document.querySelector('[data-factory-guide-action="run-db"]');
      if (!button) throw new Error('시작 버튼이 사라졌습니다.');
      button.click();
      return true;
    })()`);
    step('clicked');
    // ★ 페이지가 정말 멈추는지 잰다. 사소한 식(`1`)을 3초마다 평가해 가장 긴 지연을 남긴다.
    //
    // 이 장치를 지우지 말 것. 이것이 없어서 같은 오진을 세 번 했다.
    // 2026-08-30 이 장치로 근본 원인을 잡았다: 앱이 alert() 를 띄우고 사람의 대답을
    // 기다리느라 화면 전체가 멈춰 있었다. 문구는 "포트 5003에 다른 프로그램이 실행 중입니다"
    // 였고 사실이었다 — 스크래퍼가 43000 으로 옮겨간 것을 앱만 몰랐다.
    // (참고: connectCdp 에는 이벤트 수신 기능이 없어 대화창을 감시할 수 없다.
    //  열려 있는지 보려면 Page.handleJavaScriptDialog 를 보내 보면 된다 —
    //  없으면 'No dialog is showing' 으로 답한다.)
    {
      let worst = 0;
      let worstAt = 0;
      const probeStart = Date.now();
      for (let i = 0; i < 40; i += 1) {
        const t0 = Date.now();
        try {
          await evaluate(cdp, '1');
        } catch (error) {
          worst = Math.max(worst, Date.now() - t0);
          console.error('[응답성] 평가 실패 ' + Math.round((Date.now() - probeStart) / 1000) + '초 지점: ' + String(error && error.message || error).slice(0, 80));
          break;
        }
        const took = Date.now() - t0;
        if (took > worst) { worst = took; worstAt = Math.round((Date.now() - probeStart) / 1000); }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      console.error('[응답성] 클릭 후 2분간 가장 긴 응답 지연: ' + worst + 'ms (' + worstAt + '초 지점)');
    }
    // 눌렀는데 흐름이 시작조차 안 하면 아래 검사는 아무것도 지키지 못한다.
    await waitFor(
      cdp,
      `(() => {
        const factory = (typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : state.factory) || {};
        const stage = factory.stages && factory.stages.db && factory.stages.db.status;
        return !!(factory.goalRun && factory.goalRun.running) || stage === 'running'
          || (Array.isArray(factory.logs) && factory.logs.some(e => /첫 실행 시작/.test(String((e && e.message) || ''))));
      })()`,
      60000,
    );
    step('flow-started');
    // 흐름이 도는 **중간에** 한 번 본다. 끝나고 보면 이미 지워진 뒤일 수 있다.
    const midRun = await evaluateFactoryCdpFixture(cdp, `({ readFactory }) => {
      const f = readFactory();
      return {
        competitors: ((f.product && f.product.competitors) || []).length,
        logs: (Array.isArray(f.logs) ? f.logs.slice(-5) : []).map(e => String((e && e.message) || '').slice(0, 90)),
        projectId: String((typeof state !== 'undefined' && state.currentProjectId) || ''),
        stateCompetitors: ((state.factory && state.factory.product && state.factory.product.competitors) || []).length,
      };
    }`);
    console.error('[중간] ' + JSON.stringify(midRun));

    // 4) 경쟁사 후보가 쌓일 때까지 기다린다.
    const dumpDiagnostics = async label => {
      const info = await evaluateFactoryCdpFixture(cdp, `({ readFactory }) => {
        const factory = readFactory();
        const logs = Array.isArray(factory.logs) ? factory.logs.slice(-14) : [];
        const market = typeof ensureCompMarketScrapeState === 'function' ? ensureCompMarketScrapeState() : {};
        const parallel = (factory.automation && factory.automation.parallelProgress) || {};
        return {
          competitors: ((factory.product && factory.product.competitors) || []).length,
          stage: (factory.stages && factory.stages.db && factory.stages.db.status) || '',
          goal: (factory.goalRun && factory.goalRun.progress) || 0,
          vmTask: parallel.vm || null,
          marketPhase: String(market.phase || ''),
          marketStatus: String(market.status || '').slice(0, 160),
          marketError: String(market.error || '').slice(0, 160),
          marketLoading: !!market.loading,
          // 수집 결과가 작업으로 안 넘어오는 경우가 있어, 시장 상태 쪽도 함께 센다.
          marketHosts: (() => {
            const rows = Array.isArray(market.results) ? market.results : [];
            const counts = {};
            for (const row of rows) {
              let host = '';
              for (const key of Object.keys(row || {})) {
                const value = row[key];
                if (typeof value === 'string' && /^https?:\/\//.test(value)) {
                  const m = value.match(/^https?:\/\/([^\/?#]+)/);
                  if (m) { host = m[1].replace(/^www\./, ''); break; }
                }
              }
              const bucket = host || String((row && (row.siteId || row.site)) || '(주소없음)');
              counts[bucket] = (counts[bucket] || 0) + 1;
            }
            return { total: rows.length, counts };
          })(),
          logs: logs.map(entry => String((entry && entry.message) || '').slice(0, 200)),
        };
      }`);
      console.error('[진단:' + label + '] ' + JSON.stringify(info, null, 1));
      return info;
    };

    try {
      await waitFor(
        cdp,
        `(() => {
          const factory = (typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : state.factory) || {};
          // 시장이 '끝났다' 고 해도 **작업에 넣는 것은 그 뒤**다. 거기까지 기다린다.
          // 중간에 읽으면 쿠팡만 보이거나(수집 순서: 쿠팡->네이버->…) 작업이 비어 보인다.
          const list = factory.product && factory.product.competitors;
          return Array.isArray(list) && list.length > 0;
        })()`,
        COLLECT_TIMEOUT_MS,
      );
    } catch (error) {
      await dumpDiagnostics('시간초과');
      throw error;
    }
    // ★ 측정: waitFor 를 통과한 **직후**에 한 번 찍는다.
    // 여기서 후보>0·로그>0 인데 마지막에 0·0 이면 '긴 draft 가 끝에서 버려졌다' 가 확정된다.
    // 행 필터로는 로그 배열이 지워지지 않으므로, 로그가 사라졌다는 것이 결정적 증거다.
    const rightAfter = await evaluateFactoryCdpFixture(cdp, `({ readFactory }) => {
      const f = readFactory();
      return {
        competitors: ((f.product && f.product.competitors) || []).length,
        logs: Array.isArray(f.logs) ? f.logs.length : -1,
        dbStage: String((f.stages && f.stages.db && f.stages.db.status) || ''),
        goalRunning: !!(f.goalRun && f.goalRun.running),
      };
    }`);
    console.error('[직후] ' + JSON.stringify(rightAfter));
    step('collected');

    // 5) 후보 주소를 호스트별로 센다.
    const collected = await evaluateFactoryCdpFixture(cdp, `({ readFactory }) => {
      const factory = readFactory();
      const market = typeof ensureCompMarketScrapeState === 'function' ? ensureCompMarketScrapeState() : {};
      const fromFactory = (factory.product && factory.product.competitors) || [];
      const fromMarket = Array.isArray(market.results) ? market.results : [];
      const hostOf = value => {
        const m = String(value || '').match(/^https?:[/][/]([^/?#]+)/);
        return m ? m[1].replace(/^www[.]/, '') : '';
      };
      const countHosts = rows => {
        const counts = {};
        for (const row of rows) {
          let host = '';
          for (const key of Object.keys(row || {})) {
            const value = row[key];
            if (typeof value === 'string' && value.slice(0, 4) === 'http') {
              const found = hostOf(value);
              if (found) { host = found; break; }
            }
          }
          const bucket = host || String((row && (row.siteId || row.site || row.platform)) || '(주소없음)');
          counts[bucket] = (counts[bucket] || 0) + 1;
        }
        return counts;
      };
      const naverOf = counts => Object.keys(counts)
        .filter(host => host.toLowerCase().indexOf('naver') >= 0)
        .reduce((sum, host) => sum + counts[host], 0);
      const marketCounts = countHosts(fromMarket);
      const factoryCounts = countHosts(fromFactory);
      return {
        marketTotal: fromMarket.length,
        marketCounts,
        marketNaver: naverOf(marketCounts),
        factoryTotal: fromFactory.length,
        factoryCounts,
        factoryNaver: naverOf(factoryCounts),
        // 왜 작업으로 안 넘어오는지 보려면 행에 찍힌 실행 경로와 search id 가 필요하다.
        runtimes: Array.from(new Set(fromMarket.map(row =>
          String((row && (row._search_runtime || row.search_runtime)) || '(없음)')))),
        rowSearchIds: Array.from(new Set(fromMarket.map(row =>
          String((row && (row._search_id || row.search_id || row._vm_search_id)) || '(없음)')))).slice(0, 3),
        marketSearchId: String(market.searchId || market.vmSearchId || '(없음)'),
        logsLen: Array.isArray(factory.logs) ? factory.logs.length : -1,
        // 실제 필터를 그 자리에서 돌려 어디서 떨어지는지 본다.
        filter: (() => {
          try {
            const scope = typeof factoryCompetitorCandidateScopePayload === 'function'
              ? factoryCompetitorCandidateScopePayload('competitors', factory)
              : null;
            const out = factoryFreshVmCandidateRows(market, { searchId: market.searchId }, scope);
            const sample = fromMarket[0] || {};
            return {
              searchId: String(out.searchId || ''),
              sourceRows: (out.sourceRows || []).length,
              rows: (out.rows || []).length,
              scopeOk: typeof compMarketCandidateMatchesCurrentWork === 'function'
                ? compMarketCandidateMatchesCurrentWork(sample, scope)
                : null,
              usable: typeof compMarketIsUsableCandidate === 'function'
                ? compMarketIsUsableCandidate(sample)
                : null,
              termOk: typeof factoryCompetitorCandidateMatchesSearchTerm === 'function'
                ? factoryCompetitorCandidateMatchesSearchTerm(sample, sample.search_keyword || sample._source_keyword || market.productName)
                : null,
              scopeKeys: scope ? Object.keys(scope).slice(0, 8) : [],
              goalRunning: !!(factory.goalRun && factory.goalRun.running),
              goalProgress: (factory.goalRun && factory.goalRun.progress) || 0,
              goalFail: String((factory.goalRun && factory.goalRun.failureReason) || ''),
              dbStage: String((factory.stages && factory.stages.db && factory.stages.db.status) || ''),
              vmTask: JSON.stringify((factory.automation && factory.automation.parallelProgress && factory.automation.parallelProgress.vm) || null).slice(0, 120),
              logTail: (Array.isArray(factory.logs) ? factory.logs.slice(-6) : []).map(e => String((e && e.message) || '').slice(0, 90)),
            };
          } catch (error) { return { error: String(error && error.message || error).slice(0, 120) }; }
        })(),
      };
    }`);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(RESULT_PATH, JSON.stringify({ prepared, midRun, rightAfter, collected, screenshot: SCREENSHOT_PATH }, null, 2));

    console.error('[집계] ' + JSON.stringify(collected));
    assertChecks([
      { ok: collected.marketTotal > 0, message: '경쟁사 후보가 한 건도 안 잡혔습니다.' },
      {
        ok: collected.marketNaver > 0,
        message: '스마트스토어(네이버) 후보가 0건입니다. 사이트별: ' + JSON.stringify(collected.marketCounts),
      },
      {
        // 수집은 됐는데 작업으로 안 넘어오면 화면 카드가 비어 사용자에게는 0건으로 보인다.
        ok: collected.factoryTotal > 0,
        message: '수집은 ' + collected.marketTotal + '건인데 작업에는 ' + collected.factoryTotal + '건만 들어왔습니다.',
      },
    ]);

    console.log('[OK] 시작 버튼을 눌러 수집 ' + collected.marketTotal + '건(네이버 ' + collected.marketNaver + ')');
    console.log('     작업 반영 ' + collected.factoryTotal + '건(네이버 ' + collected.factoryNaver + ')');
    console.log('     사이트별: ' + JSON.stringify(collected.marketCounts));
    console.log('     ' + RESULT_PATH);
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  process.stderr.write('[FAIL] ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
