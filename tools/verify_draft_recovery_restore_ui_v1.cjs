// 계약: **남긴 복구본을 화면에서 골라 되살릴 수 있다.**
//
// 사본만 쌓고 걷을 길이 없으면 그물을 쳐 놓고 안 걷는 것과 같다.
// 이 사본은 편집권(lease)을 거치지 않고 저장된 참고본이므로 **자동 복원에는 쓰지 않는다** -
// 목록을 먼저 보여 주고, 사람이 하나를 고른 뒤에야 불러온다. 이 검사가 그 순서를 지킨다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'draft-recovery-restore-ui-v1.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.navigate', { url: `${APP_URL}?draftRecoveryUi=v1&t=${Date.now()}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof saveLastWorkNow === 'function'
    && typeof renderDraftRecoveryPanel === 'function'
    && typeof getCurrentLastWorkWorkspaceScope === 'function'`, 60000);

  const original = `되살리기원본_${Date.now()}`;
  const overwritten = `덮어쓴이름_${Date.now()}`;

  // 1) 원본 제품명으로 복구본을 남긴다.
  const seeded = await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    const factory = cloneFactory(readFactory());
    factory.product = { ...factory.product, productName: ${JSON.stringify(original)}, userProductName: ${JSON.stringify(original)} };
    replaceFactory(factory, { mode: 'hydrate' });
    setAppState({ productName: ${JSON.stringify(original)} });
    renderApp();
    await saveLastWorkNow({ force: true, sync: false });
    return { scopeId: getCurrentLastWorkWorkspaceScope?.() || '' };
  }`);
  await new Promise(resolve => setTimeout(resolve, 2500));

  // 2) 그 뒤 제품명을 덮어쓴다 = "잃어버린" 상태를 만든다.
  await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    const factory = cloneFactory(readFactory());
    factory.product = { ...factory.product, productName: ${JSON.stringify(overwritten)}, userProductName: ${JSON.stringify(overwritten)} };
    replaceFactory(factory, { mode: 'hydrate' });
    setAppState({ productName: ${JSON.stringify(overwritten)} });
    renderApp();
    return true;
  }`);

  // 3) 화면에서 "복구본 보기" 를 누른다. 자동으로 열려 있으면 안 된다.
  const beforeClick = await evaluate(cdp, `(() => ({
    hasOpenButton: !!document.querySelector('[data-draft-recovery-action="list"]'),
    autoOpenedRows: document.querySelectorAll('[data-draft-recovery-action="restore"]').length,
  }))()`);
  await evaluate(cdp, `(() => { document.querySelector('[data-draft-recovery-action="list"]')?.click(); return true; })()`);
  // 여기서 waitFor 로 죽으면 증거 파일이 안 남아 원인을 알 수 없다. 끝까지 재고 나서 판정한다.
  let listed = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    listed = await evaluate(cdp, `(() => ({
      rows: document.querySelectorAll('[data-draft-recovery-action="restore"]').length,
      text: document.body.innerText.includes(${JSON.stringify(original)}),
      view: (typeof state !== 'undefined' && state.draftRecovery) ? state.draftRecovery : null,
      panelLen: typeof renderDraftRecoveryPanel === 'function' ? String(renderDraftRecoveryPanel() || '').length : -1,
      scope: String(getCurrentLastWorkWorkspaceScope?.() || ''),
    }))()`);
    if (listed?.rows > 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 4) 되살리기를 누른다.
  await evaluate(cdp, `(() => { document.querySelector('[data-draft-recovery-action="restore"]')?.click(); return true; })()`);
  await new Promise(resolve => setTimeout(resolve, 3000));
  const after = await evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory }) => ({
    productName: readAppState().productName || readFactory().product?.productName || '',
    error: String(state?.draftRecovery?.error || ''),
  })`);

  const evidence = { seeded, original, overwritten, beforeClick, listed, after };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(evidence, null, 2), 'utf8');

  const checks = [
    { ok: /^draft:/.test(String(seeded?.scopeId)),
      message: `전제 불성립 - 저장 전 작업이 아닙니다: ${seeded?.scopeId}` },
    { ok: beforeClick.hasOpenButton === true,
      message: '저장 전 작업인데 복구본 보기 버튼이 없습니다. 사본을 쌓아도 걷을 길이 없습니다.' },
    { ok: beforeClick.autoOpenedRows === 0,
      message: `누르지도 않았는데 복구본 목록이 열려 있습니다(${beforeClick.autoOpenedRows}건). 이 사본은 자동으로 다루면 안 됩니다.` },
    { ok: listed.rows > 0,
      message: '복구본 목록이 비어 있습니다.' },
    { ok: listed.text === true,
      message: `목록에 원래 제품명이 안 보입니다. 무엇을 되살리는지 모른 채 고르게 됩니다.` },
    { ok: after.productName === original,
      message: `되살리기를 눌렀는데 내용이 돌아오지 않았습니다: 지금 "${after.productName}" (기대 "${original}", 덮어쓴 값 "${overwritten}") · 오류=${after.error}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 복구본을 화면에서 골라 되살렸다 ("${overwritten}" -> "${original}") - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
