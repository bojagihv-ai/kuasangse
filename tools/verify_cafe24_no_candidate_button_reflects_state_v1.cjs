// 계약: **"Cafe24 후보 없음 · 신제품으로 진행" 을 누르면 화면이 곧바로 확정 상태로 바뀐다.**
//
// 주인님 2026-09-06: "카페24 후보없음 신제품으로 등록을 눌렀는데 왜 먹통이지?"
//
// 확인된 사실: 저장본을 읽어보니 눌린 것도 처리된 것도 맞았다.
//   cafe24CandidateResolution: 'none'
//   candidateReviewStatus: "Cafe24 후보 없음 확정: ... 새 상품 등록 초안으로 진행합니다."
// 즉 상태는 바뀌었는데 화면이 안 따라온 것처럼 보였다.
//
// 오늘 같은 무늬를 세 번 만났다(SAVE-04 썸네일 · FULL-07 버튼 · FULL-08 생성버튼):
// 상태는 바뀌었는데 그 상태를 보여 주는 DOM 만 옛날 그대로인 것.
// 그래서 이 자리에도 눈을 만든다 - 누른 뒤 화면이 실제로 바뀌는지 본다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'cafe24-no-candidate-button-v1.json');

const BUTTON = '[data-factory-confirm-no-cafe24-candidate]';

async function readButton(cdp) {
  return evaluateFactoryCdpFixture(cdp, `async ({ readFactory }) => {
    const button = document.querySelector(${JSON.stringify(BUTTON)});
    const product = readFactory().product || {};
    return {
      exists: !!button,
      text: (button?.innerText || '').replace(/\\s+/g, ' ').trim(),
      disabled: button?.disabled === true,
      resolution: String(product.cafe24CandidateResolution || ''),
      reviewStatus: String(product.candidateReviewStatus || ''),
    };
  }`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1365, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  const seed = String(Date.now());
  const productName = `후보없음확정_${seed}`;

  await cdp.send('Page.navigate', { url: `${APP_URL}?cafeNoCandidate=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryConfirmNoCafe24Candidate === 'function'`, 60000);

  // Cafe24 후보가 하나 있는 상태 - 사장님 화면과 같은 모습.
  await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    setAppState({ step: 'factory', productName: ${JSON.stringify(productName)} });
    const factory = cloneFactory(readFactory());
    factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
    factory.product = {
      ...factory.product,
      productName: ${JSON.stringify(productName)},
      userProductName: ${JSON.stringify(productName)},
      cafe24Candidates: [],
      cafe24CandidateResolution: '',
      selectedCafe24CandidateKey: '',
      confirmedCafe24ProductKey: '',
      candidateReviewStatus: '',
    };
    replaceFactory(factory, { mode: 'hydrate' });
    // 후보는 **앱이 쓰는 신원 키**를 달아야 화면에 남는다.
    // factoryCandidateReviewCanApply(cafe24-sync.js:6078)가 신원이 안 맞는 후보를 걸러낸다.
    const live = cloneFactory(readFactory());
    const identity = typeof factoryCandidateReviewIdentityKey === 'function'
      ? factoryCandidateReviewIdentityKey(live) : '';
    live.product.cafe24Candidates = [{
      key: '3025', productNo: 3025, productName: '공진단상자 공진단케이스', price: 10900,
      reviewProductIdentityKey: identity,
    }];
    replaceFactory(live, { mode: 'hydrate' });
    renderApp();
    return { identity };
  }`);
  await waitFor(cdp, `!!document.querySelector(${JSON.stringify(BUTTON)})`, 20000);
  const before = await readButton(cdp);

  // 사장님이 누르는 그 버튼을 그대로 누른다.
  await evaluateFactoryCdpFixture(cdp, `async () => {
    document.querySelector(${JSON.stringify(BUTTON)})?.click();
    return true;
  }`);

  // 화면이 따라올 시간을 준다. 여기서 기다리는 것은 판정을 무르게 하는 것이 아니라
  // "누르면 화면이 8초 안에 바뀐다" 를 분명히 하는 것이다. 안 바뀌면 그대로 실패한다.
  let renderTimedOut = false;
  try {
    await waitFor(cdp, `document.querySelector(${JSON.stringify(BUTTON)})?.disabled === true`, 8000);
  } catch (_) {
    renderTimedOut = true;
  }
  const after = await readButton(cdp);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ productName, before, after, renderTimedOut }, null, 2), 'utf8');

  const checks = [
    { ok: before.exists && before.disabled === false && /신제품으로 진행/.test(before.text),
      message: `전제 불성립 - 누르기 전 버튼이 정상 상태가 아닙니다: ${JSON.stringify(before)}` },

    // 상태가 바뀌었는가 (이건 사장님 저장본에서도 확인됐다)
    { ok: after.resolution === 'none',
      message: `누른 뒤에도 확정 상태가 아닙니다: ${JSON.stringify(after)}` },
    { ok: /확정/.test(after.reviewStatus),
      message: `확정 문구가 남지 않았습니다: ${JSON.stringify({ reviewStatus: after.reviewStatus })}` },

    // ── 화면이 따라왔는가. 여기가 이 검사의 존재 이유다 ──
    { ok: after.disabled === true,
      message: '눌렀는데 버튼이 그대로 눌리는 상태입니다 - 사장님 눈에는 아무 일도 안 일어난 것으로 보입니다'
        + `${renderTimedOut ? ' (8초 기다려도 안 바뀜)' : ''}: ${JSON.stringify(after)}` },
    { ok: /확정됨/.test(after.text),
      message: `버튼 문구가 안 바뀌었습니다: ${JSON.stringify({ text: after.text })}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] Cafe24 후보 없음 확정 뒤 화면이 따라옴 - 문구 "${after.text}" · 잠김 ${after.disabled}`
    + ` - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
