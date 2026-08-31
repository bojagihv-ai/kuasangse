// 계약: **저장 버튼을 누르기 전(draft:) 작업도 서버에 복구용 사본을 남긴다.**
//
// 2026-08-31 주인님이 하루에 두 번 작업을 잃었다. 되살릴 방법이 없었다.
//   - 정상 저장(/api/last-work)은 project: 스코프만 받는다. 프런트가
//     `if (!scopeId.startsWith('project:')) return false` 로 조용히 건너뛰고,
//     백엔드도 편집권(lease) 검증이 project: 에만 걸려 있어 draft 는 통과 자체가 불가능하다.
//   - 그래서 저장 전 작업은 브라우저 안에 사본이 딱 하나뿐이었다.
//     그날 backend/.local/pdp-last-work-scoped 에 남은 사람 작업 스냅샷은 이틀 전 것 하나였다.
//
// 이 검사는 실제 브라우저에서 저장 전 작업을 만들고, 서버에 사본이 생기는지 본다.
// 사본은 편집권을 거치지 않으므로 **자동 복원에는 쓰지 않는다** - 사람이 고를 때만 읽는다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:19232';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'unsaved-draft-server-backup-v1.json');

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
  await cdp.send('Page.navigate', { url: `${APP_URL}?draftBackup=v1&t=${Date.now()}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof saveLastWorkNow === 'function'
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof saveDraftRecoverySnapshot === 'function'`, 60000);

  const productName = `그물검증상품_${Date.now()}`;
  const seeded = await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    const factory = cloneFactory(readFactory());
    factory.product = { ...factory.product, productName: ${JSON.stringify(productName)}, userProductName: ${JSON.stringify(productName)} };
    replaceFactory(factory, { mode: 'hydrate' });
    setAppState({ productName: ${JSON.stringify(productName)} });
    renderApp();
    const scopeId = getCurrentLastWorkWorkspaceScope?.() || '';
    // 저장 버튼을 누르지 않는다. 자동저장이 도는 그 길에서 그물이 걸려야 한다.
    await saveLastWorkNow({ force: true, sync: false });
    return { scopeId };
  }`);

  // 네트워크는 비동기다. 사본이 도착할 시간을 준다.
  await new Promise(resolve => setTimeout(resolve, 2500));

  const scopeId = String(seeded?.scopeId || '');
  const listed = await evaluate(cdp, `(async () => {
    const res = await fetch(${JSON.stringify(`${BACKEND_BASE}/api/draft-recovery?scopeId=`)} + encodeURIComponent(${JSON.stringify(scopeId)}), { cache: 'no-store' });
    return { status: res.status, body: await res.json() };
  })()`);

  let entry = null;
  const first = listed?.body?.entries?.[0];
  if (first) {
    entry = await evaluate(cdp, `(async () => {
      const res = await fetch(${JSON.stringify(`${BACKEND_BASE}/api/draft-recovery/entry?scopeId=`)} + encodeURIComponent(${JSON.stringify(scopeId)}) + '&savedAt=' + ${JSON.stringify(String(first.savedAt))}, { cache: 'no-store' });
      return { status: res.status, body: await res.json() };
    })()`);
  }

  const evidence = { productName, scopeId, listed, entry };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(evidence, null, 2), 'utf8');

  const checks = [
    { ok: /^draft:/.test(scopeId),
      message: `전제 불성립 - 저장 전 작업(draft:)이 아닙니다: ${scopeId}` },
    { ok: listed?.status === 200 && listed?.body?.ok === true,
      message: `복구본 목록을 읽지 못했습니다: ${JSON.stringify(listed)}` },
    { ok: Array.isArray(listed?.body?.entries) && listed.body.entries.length > 0,
      message: `저장 전 작업의 서버 복구본이 하나도 없습니다. 잃으면 되살릴 방법이 없습니다: ${JSON.stringify(listed?.body)}` },
    { ok: entry?.status === 200 && entry?.body?.ok === true && !!entry?.body?.snapshot,
      message: `복구본을 읽었지만 내용이 없습니다: ${JSON.stringify(entry?.body && { ok: entry.body.ok, hasSnapshot: !!entry.body.snapshot })}` },
    { ok: String(entry?.body?.productName || '') === productName
        || JSON.stringify(entry?.body?.snapshot || {}).includes(productName),
      message: `복구본이 이 작업의 것이 아닙니다: productName=${entry?.body?.productName} (기대 ${productName})` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 저장 전 작업이 서버 복구본을 남긴다 (${listed.body.entries.length}건) - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
