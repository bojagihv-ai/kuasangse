// 계약: **이미지 생성은 성공했는데 보관 저장만 거절됐을 때, 그 사실을 사실대로 즉시 알린다.**
//
// 사장님 증상: 잘 되던 생성이 뻘겋게 "실패" 로 뜨고, 다시 누르면 되고, 요금은 두 번 나간다.
//
// 확인된 사슬 (2026-09-03, 파일:줄 직접 확인 + 적대적 검증 통과):
//   1) 이미지 API 200 — 그림이 손에 있고 요금도 나갔다
//   2) 그 그림을 로컬 보관함에 넣는 POST 가 409 로 거절
//      (편집권 반납이 큰 이미지 전송을 서버에서 추월한다.
//       회귀 백엔드 로그 두 판에서 `release 200 -> assets 409` 로 실측)
//   3) app-core-06.js 의 factoryPersistGeneratedCutPromptResult:6601 이 throw
//   4) generateCut:30088 의 catch 가 `p.result = previousResult || null` 로
//      **방금 만든 그림을 버린다**
//   5) 그리고 `p.error = '이미지 API 실패: ...'` 라고 적는다 - API 는 성공했는데도
//
// 이 검사는 5)를 겨냥한다. 2)는 결정적으로 주입한다(우연에 기대지 않는다).
// 4)는 고치지 않기로 했다 - 아래 '여기가 계약이다' 의 실험 근거를 보라.
//
// 왜 보관 함수를 직접 부르는 검사로는 안 되나:
//   2026-09-03 에 그렇게 만들었다가 그냥 통과했다. 손실은 보관 함수가 아니라
//   **그것을 부르는 쪽의 catch** 에서 일어나기 때문이다. 그래서 generateCut 을 직접 탄다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'generated-image-survives-archive-reject-v1.json');

// 1x1 png. 이미지 API 가 돌려주는 척한다.
const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// 앱 코드보다 먼저 심는다. persistence 어댑터는 만들어질 때 fetch 를 붙들기 때문에
// 페이지가 뜬 뒤에 바꾸면 늦다.
const INJECT = `(() => {
  if (window.__archiveRejectV1) return;
  const state = { imageCalls: 0, archivePosts: 0, forced409: 0 };
  window.__archiveRejectV1 = state;
  const nativeFetch = window.fetch.bind(window);
  const pixel = ${JSON.stringify(PNG_PIXEL)};
  window.fetch = async (input, init) => {
    const url = String((input && input.url) || input || '');
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    // (1) 이미지 API 는 성공시킨다 - 그림도 있고 요금도 나간 상태를 만든다.
    if (method === 'POST' && url.indexOf('/api/gemini/generate-content') !== -1) {
      state.imageCalls += 1;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pixel } }] } }],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // (2) 보관 저장은 편집권 사유로 거절한다 - 서버가 실제로 주는 모양 그대로.
    if (method === 'POST' && /\\/api\\/local-archive\\/assets(?:\\?|$)/.test(url)) {
      state.archivePosts += 1;
      state.forced409 += 1;
      return new Response(JSON.stringify({ ok: false, code: 'LEASE_EXPIRED', error: 'lease expired' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    }
    return nativeFetch(input, init);
  };
})();`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  const seed = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?archiveReject=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && !!window.__archiveRejectV1
    && typeof generateCut === 'function'
    && typeof normalizeCutPromptItem === 'function'`, 60000);

  // 컷 한 장을 생성할 수 있는 최소 상태를 만든다.
  // factoryStageId 를 비워 조립공장 잠금 경로를 타지 않게 한다(제품 사진 동기화가 필요 없어진다).
  const seeded = await evaluateFactoryCdpFixture(cdp, `async ({ setAppState, renderApp }) => {
    const cuts = window.state.cuts;
    cuts.factoryStageId = '';
    cuts.runBusy = false;
    cuts.sourceBase64 = ${JSON.stringify(PNG_PIXEL)};
    cuts.sourceMime = 'image/png';
    cuts.workImageBase64 = '';
    cuts.prompts = [normalizeCutPromptItem({
      id: 'reject-cut-1',
      title: '보관거절 검사용 컷',
      prompt: '검사용 지시',
    }, 0)];
    cuts.promptSlotCount = 1;
    setAppState({ step: 'cuts' });
    renderApp();
    return {
      promptCount: cuts.prompts.length,
      hasSource: !!cuts.sourceBase64,
      resultBefore: !!cuts.prompts[0]?.result,
    };
  }`);

  // 생성한다. 이미지 API 는 성공하고, 보관은 409 로 거절된다.
  const ran = await evaluateFactoryCdpFixture(cdp, `async () => {
    let threw = '';
    try {
      await generateCut(0, null, { syncDom: false });
    } catch (error) {
      threw = String(error?.message || error);
    }
    return { threw };
  }`);
  await new Promise(resolve => setTimeout(resolve, 2500));

  const after = await evaluateFactoryCdpFixture(cdp, `async () => {
    const p = window.state.cuts?.prompts?.[0] || {};
    const race = window.__archiveRejectV1 || {};
    return {
      imageCalls: Number(race.imageCalls || 0),
      forced409: Number(race.forced409 || 0),
      hasResult: !!p.result,
      resultLength: String(p.result || '').length,
      hasImage: !!(p.hasImage || p.imageUrl || p.result),
      error: String(p.error || ''),
      warning: String(p.warning || ''),
      generating: p.generating === true,
    };
  }`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ seeded, ran, after }, null, 2), 'utf8');

  const checks = [
    { ok: seeded.promptCount === 1 && seeded.hasSource && seeded.resultBefore === false,
      message: `전제 불성립 - 생성 준비가 안 됐습니다: ${JSON.stringify(seeded)}` },
    { ok: after.imageCalls >= 1,
      message: `전제 불성립 - 이미지 API 를 한 번도 부르지 않았습니다. 이 검사가 아무것도 안 보고 있습니다: ${JSON.stringify(after)}` },
    { ok: after.forced409 >= 1,
      message: `전제 불성립 - 보관 409 를 주입하지 못했습니다: ${JSON.stringify(after)}` },

    // ── 여기가 계약이다 ──────────────────────────────────────────────
    //
    // 왜 "그림을 화면에 남겨라" 를 계약으로 삼지 않는가 (실험으로 결정, 2026-09-04):
    //   tools/probe_unarchived_cut_result_survives_reload.cjs 로 실측했다.
    //   보관되지 않은 그림을 화면에 남기면,
    //     작은 그림(114자)  -> 강제 새로고침 2회를 견딘다
    //     실제 크기(1.1MB) -> **첫 새로고침에 사라진다. 오류 문구까지 함께 지워진다.**
    //   즉 남기면 사장님은 "그림이 살아 있구나" 믿고 계속 일하다가 F5 한 번에 잃고,
    //   왜 없어졌는지도 모른다. 지금처럼 즉시 실패로 알려 주는 것보다 **더 나쁘다.**
    //   주인님 제1원칙("생성한 것이 날아가지 않는 것")을 지키려면 남기지 않는 쪽이 맞다.
    //   그래서 이 검사가 지키는 것은 "그림을 남겨라" 가 아니라
    //   **"실패를 숨기지 말고 사실대로, 즉시 알려라"** 이다.
    { ok: !/이미지\s*API\s*실패/.test(after.error),
      message: `이미지 API 는 성공했는데 "이미지 API 실패" 라고 표시했습니다 - 거짓 표시입니다: ${JSON.stringify({ error: after.error })}` },
    { ok: after.error === '' || /보관|저장|편집권|권한/.test(after.error),
      message: `무엇이 실패했는지 사람이 알 수 없는 문구입니다: ${JSON.stringify({ error: after.error })}` },
    { ok: after.generating === false,
      message: `생성 중 표시가 남아 화면이 영영 도는 것처럼 보입니다: ${JSON.stringify(after)}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 이미지 API ${after.imageCalls}회 성공 · 보관 409 ${after.forced409}회 주입 시`
    + ` 문구가 사실대로임 (문구: ${JSON.stringify(after.error)}) - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
