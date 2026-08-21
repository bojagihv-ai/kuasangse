// 회귀: 경쟁사 이미지 분석이 시작되지 못했는데도 화면이 '분석 진행 중...'에 영구히 갇히던 문제.
//
// 원 증상 (2026-08-21):
//   compMarketAnalyze()가 compPage.subStep='analyzing'으로 바꾼 뒤 startCompetitorAnalysis()를 호출하는데,
//   startCompetitorAnalysis()의 시작 실패 경로가 return으로 조용히 빠져나가면서
//   subStep을 되돌리지 않아 버튼이 비활성 '분석 진행 중...'으로 잠기고
//   복구 버튼('완료 결과 다시 가져오기')까지 렌더에서 숨겨졌다.
//   화면 판정은 competitor-tab-images.mjs의 `compPage.subStep === 'analyzing'` 하나로만 이뤄진다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const COMPETITOR_TAB_IMAGES = path.join(
  ROOT, 'src', 'menus', 'factory', 'tabs', 'competitor-tab-images.mjs',
);

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} definition is required`);
  const signatureEnd = fileSource.slice(start).match(/\)\s*\{/);
  assert.ok(signatureEnd, `${functionName} body is required`);
  const braceStart = start + signatureEnd.index + signatureEnd[0].lastIndexOf('{');
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} boundary is incomplete`);
}

// startCompetitorAnalysis()의 시작 실패 경로만 실행할 수 있는 최소 샌드박스.
function createAnalyzeStartHarness({ mode = 'images', uploadedImages = [], llmError = null } = {}) {
  const core = source(CORE_06);
  const calls = { tickerStopped: 0, renders: 0, statuses: [], oauthRefreshes: 0 };
  const state = {
    error: '',
    compPage: {
      subStep: 'analyzing',
      mode,
      uploadedImages,
      htmlText: '',
      urlInput: '',
      analyzeProgress: 42,
      analyzeStage: '이미지 준비',
      analyzeMsg: '선택 이미지 1장을 분석 입력으로 준비 중...',
      analyzeDetail: '수집 이미지를 읽어 분석 입력으로 변환하고 있습니다.',
      pendingAnalysisImageSelection: { key: 'sig-1' },
    },
  };
  const market = { loading: true, phase: 'analyze-running', error: '', lastUpdatedAt: 0 };

  const factory = new Function(
    'state', 'market', 'calls', 'llmError', 'document',
    `
      const assertRuntimeOperationContextCurrent = () => undefined;
      const render = () => { calls.renders += 1; };
      const stopCompetitorAnalyzeTicker = () => { calls.tickerStopped += 1; };
      const ensureCompMarketScrapeState = () => market;
      const compMarketSetStatus = (message, kind, tone) => { calls.statuses.push({ message, kind, tone }); };
      const ensureGptOAuthStatusFresh = async () => { calls.oauthRefreshes += 1; };
      const getLLMClient = () => { if (llmError) throw new Error(llmError); return {}; };
      const beginCompetitorAnalyzeRun = () => { throw new Error('분석 런이 시작되면 안 되는 경로입니다'); };
      ${extractFunction(core, 'failCompetitorAnalyzeStart')}
      async ${extractFunction(core, 'startCompetitorAnalysis')}
      return startCompetitorAnalysis;
    `,
  );

  return {
    state,
    market,
    calls,
    run: factory(state, market, calls, llmError, { getElementById: () => null }),
  };
}

test('시작 실패한 경쟁사 분석은 화면 상태를 입력 단계로 되돌린다 (분석 진행 중 고착 방지)', async () => {
  // Given: compMarketAnalyze가 이미 subStep을 'analyzing'으로 올린 뒤 LLM 클라이언트 생성이 실패한다.
  const harness = createAnalyzeStartHarness({
    uploadedImages: [{ base64: 'x' }],
    llmError: 'GPT OAuth 연결 상태를 확인할 수 없습니다.',
  });

  // When: 분석 시작을 시도한다.
  await harness.run();

  // Then: 화면이 '분석 진행 중'에 갇히지 않고 입력 단계로 복귀해야 한다.
  assert.equal(
    harness.state.compPage.subStep,
    'input',
    "시작 실패 후 subStep이 'analyzing'으로 남으면 버튼이 영구히 비활성 '분석 진행 중...'이 된다",
  );
  assert.equal(
    harness.state.compPage.pendingAnalysisImageSelection,
    null,
    'pendingAnalysisImageSelection이 남아도 화면은 analyzing으로 판정된다',
  );
  assert.equal(harness.calls.tickerStopped, 1, '진행률 티커는 반드시 정지되어야 한다');
  assert.equal(harness.state.compPage.analyzeProgress, 0);
  assert.equal(harness.state.compPage.analyzeStage, '분석 시작 실패');
  assert.equal(harness.state.compPage.analyzeMsg, '분석 API 연결을 확인해야 합니다.');
  assert.match(harness.state.compPage.analyzeDetail, /GPT OAuth 연결 상태/);

  // And: 수집판 상태도 실패로 정리되어 재시도가 가능해야 한다.
  assert.equal(harness.market.loading, false);
  assert.equal(harness.market.phase, 'analyze-error');
  assert.equal(harness.calls.statuses.at(-1).tone, 'error');
  assert.ok(harness.calls.renders >= 1, '실패 상태가 화면에 반영되려면 render가 필요하다');
});

test('실행 직전 GPT OAuth 상태를 다시 확인해 낡은 캐시로 막지 않는다', async () => {
  // Given: 정상적으로 LLM 클라이언트를 만들 수 있는 상태.
  const harness = createAnalyzeStartHarness({ mode: 'url' });

  // When: 입력이 비어 조기 종료되더라도 게이트 이전에 상태 재확인이 끝나 있어야 한다.
  await harness.run();

  // Then: 부팅 시점 캐시가 아니라 실행 직전 상태로 판단한다.
  assert.equal(harness.calls.oauthRefreshes, 1, 'getLLMClient 게이트 전에 상태를 다시 확인해야 한다');
});

test('입력값이 비어 시작하지 못한 경우에도 분석 중 상태가 남지 않는다', async () => {
  for (const scenario of [
    { mode: 'images', uploadedImages: [], expect: '분석할 이미지가 없습니다.' },
    { mode: 'html', expect: 'HTML 입력이 비어 있습니다.' },
    { mode: 'url', expect: 'URL 입력이 비어 있습니다.' },
  ]) {
    // Given: 각 입력 모드에서 필수 입력이 비어 있다.
    const harness = createAnalyzeStartHarness(scenario);

    // When: 분석 시작을 시도한다.
    await harness.run();

    // Then: 조용히 return하지 않고 입력 단계로 되돌린 뒤 이유를 남긴다.
    assert.equal(harness.state.compPage.subStep, 'input', `${scenario.mode} 모드에서 analyzing이 남았다`);
    assert.equal(harness.state.compPage.analyzeMsg, scenario.expect);
    assert.equal(harness.market.loading, false);
    assert.equal(harness.calls.tickerStopped, 1);
  }
});

test('경쟁사 이미지 탭의 분석 중 판정과 복구 버튼 노출 조건이 유지된다', () => {
  // Given: 화면 판정은 subStep 하나에 걸려 있고, analyzing 중에는 복구 버튼이 숨겨진다.
  const view = source(COMPETITOR_TAB_IMAGES);

  // Then: 이 계약이 바뀌면 위 회귀 테스트의 전제도 함께 갱신해야 한다.
  assert.match(
    view,
    /const analyzing = compPage\.subStep === 'analyzing' \|\| Boolean\(compPage\.pendingAnalysisImageSelection\?\.key\)/,
    "분석 중 판정은 subStep과 pendingAnalysisImageSelection에서 나온다",
  );
  assert.match(
    view,
    /!analysisResult && !analyzing \?[\s\S]{0,200}완료 결과 다시 가져오기/,
    'analyzing이 참이면 복구 버튼이 사라지므로 시작 실패 시 반드시 해제되어야 한다',
  );
});
