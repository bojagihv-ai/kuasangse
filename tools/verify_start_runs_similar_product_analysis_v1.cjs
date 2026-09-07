// 계약: **조립공장 시작이 도는 앱 안에서, 유사 제품 분석 단계가 실제 state 에 결과를 남기고 화면은 옮기지 않는다.**
//
// 주인님 2026-09-06: "첫번째 화면의 ai분석도 ... 조립공장의 시작 버튼을 눌렀을때 분석 시작하도록"
// 2026-09-07: 빠진 유사 제품 분석만 채우고 섹션 화면으로 이동하지 않는다.
//
// 시작 버튼 전체(DB·VM·이미지 생성)를 격리 환경에서 끝까지 돌리면 VM 수집이 끼어 흔들리므로,
// 시작 버튼이 "현재 이미지 AI 분석" 작업 안에서 부르는 바로 그 함수를 같은 소유 draft 경로로 부른다.
// LLM 만 가짜(클라이언트 클래스의 searchSimilarProducts)로 바꾸고 나머지는 실제 앱이다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'start-runs-similar-product-analysis-v1.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const seed = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?similarProducts=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()} && typeof factoryEnsureSimilarProductAnalysisForOneClick === 'function'`, 60000);

  const result = await evaluate(cdp, `(async () => {
    const productName = '검사용_유사제품_${seed}';
    const fixture = {
      similar_products: [
        { name: '유사 A', price_range: '3만원대', strengths: '자개 무늬', detail_page_style: '전통 공예 강조' },
        { name: '유사 B', price_range: '5만원대', strengths: '원목 마감', detail_page_style: '라이프스타일 컷' },
      ],
      market_insights: '검사용',
      detail_page_trends: ['넓은 여백'],
      recommended_approach: '고급 공예품 결로 정리',
    };
    const calls = [];
    // 첫 화면 AI 분석이 쓰는 클라이언트 클래스들의 searchSimilarProducts 만 가짜로 바꾼다.
    const patched = [];
    const patch = (name, ctor) => {
      if (typeof ctor !== 'function' || typeof ctor.prototype?.searchSimilarProducts !== 'function') return;
      ctor.prototype.searchSimilarProducts = async function (n, c) { calls.push([name, n, c]); return JSON.parse(JSON.stringify(fixture)); };
      patched.push(name);
    };
    if (typeof GeminiAPI !== 'undefined') patch('GeminiAPI', GeminiAPI);
    if (typeof OpenAIAPI !== 'undefined') patch('OpenAIAPI', OpenAIAPI);
    if (typeof GptOAuthAPI !== 'undefined') patch('GptOAuthAPI', GptOAuthAPI);
    if (typeof ApiHubOpenAIAPI !== 'undefined') patch('ApiHubOpenAIAPI', ApiHubOpenAIAPI);
    if (!state.backendBaseUrl) state.backendBaseUrl = 'http://127.0.0.1:5050';

    state.step = 'factory';
    state.productName = productName;
    state.competitorData = null;
    state.analysis = { product_name: productName, category: '주얼리·소품 보관함', image_inference_engine: 'gemini' };
    const draft0 = cloneData(factoryRuntimeReadFactory());
    draft0.product = { ...(draft0.product || {}), productName, userProductName: productName, productKey: productName };
    factoryRuntimeReplaceFactorySnapshot(draft0, { reason: 'similar-products-test', mode: 'hydrate' });
    render();
    const stepBefore = state.step;

    // 시작 버튼의 작업이 부르는 것과 같은 소유 draft 경로 (factoryRunCurrentProductImageAnalysisOnly 와 같은 명령).
    const store = factoryRuntimeRequireStore();
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/db:runCurrentProductAnalysisOnly',
      'product-db',
      draft => factoryEnsureSimilarProductAnalysisForOneClick({ factory: draft, operationToken: store.getOperationToken() }),
    );
    const first = await receipt.result;
    // 두 번째 호출은 재사용해야 한다 (LLM 재호출 없음).
    const receipt2 = await factoryRuntimeUpdateOwnedFactory(
      'factory/db:runCurrentProductAnalysisOnly',
      'product-db',
      draft => factoryEnsureSimilarProductAnalysisForOneClick({ factory: draft, operationToken: store.getOperationToken() }),
    );
    const second = await receipt2.result;
    const factory = factoryRuntimeReadFactory();
    return {
      patched,
      calls,
      first,
      second,
      stepBefore,
      stepAfter: state.step,
      competitorCount: Array.isArray(state.competitorData?.similar_products) ? state.competitorData.similar_products.length : -1,
      recommended: state.competitorData?.recommended_approach || '',
      logs: (factory.logs || []).slice(-8).map(item => String(item?.message || item?.text || '')),
    };
  })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
  assertChecks([
    { ok: result.patched.length > 0, message: `전제 불성립 - 가짜로 바꿀 LLM 클라이언트 클래스를 찾지 못했습니다: ${JSON.stringify(result.patched)}` },
    { ok: result.calls.length === 1, message: `유사 제품 분석 LLM 호출이 정확히 1번이어야 합니다(두 번째는 재사용): ${JSON.stringify(result.calls)}` },
    { ok: result.calls[0] && /검사용_유사제품_/.test(result.calls[0][1]) && result.calls[0][2] === '주얼리·소품 보관함',
      message: `제품명과 분석 카테고리로 물어야 합니다: ${JSON.stringify(result.calls)}` },
    { ok: result.competitorCount === 2 && /고급 공예품/.test(result.recommended),
      message: `state.competitorData 에 결과가 기록돼야 통합버전 섹션이 참고합니다: ${JSON.stringify({ count: result.competitorCount, recommended: result.recommended })}` },
    { ok: result.stepBefore === 'factory' && result.stepAfter === 'factory',
      message: `화면을 옮기면 안 됩니다(첫 화면 startAnalysis 는 sections 로 옮긴다): ${JSON.stringify({ before: result.stepBefore, after: result.stepAfter })}` },
    { ok: result.first?.ok === true && result.first?.count === 2 && result.second?.reused === true,
      message: `첫 호출은 2개 기록, 두 번째는 재사용이어야 합니다: ${JSON.stringify({ first: result.first, second: result.second })}` },
    { ok: result.logs.some(line => /유사 제품 분석 완료: 2개/.test(line)),
      message: `조립공장 로그에 "유사 제품 분석 완료" 가 남아야 사장님이 알 수 있습니다: ${JSON.stringify(result.logs)}` },
  ]);
  console.log(`[PASS] 유사 제품 분석이 시작 경로에서 기록됨 - LLM ${result.calls.length}회 · 후보 ${result.competitorCount}개 · 화면 ${result.stepBefore}→${result.stepAfter} · 재사용 OK - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
