// 계약: **강종 뒤 빈 탭이 '마지막 초안' 표식을 덮어써도, 새 탭은 내용 있는 초안을 이어받는다.
//        그리고 빈 새 탭은 표식을 덮어쓰지 않는다.**
//
// 실측 2026-09-07 (주인님: "컴이 렉걸려서 강종했다 켜졌는데 우리 작업하던게 다 날라갔네?"):
//   어젯밤 작업은 IndexedDB 에 멀쩡히 있었는데, 강종 뒤 열린 빈 탭들이 표식을 자기 번호로 덮어써서
//   부팅이 빈 초안만 이어받았다. 실제 Chrome 에서 그 사고를 그대로 재현한 뒤 고쳐졌는지 본다.
//
// 절차 (같은 탭, sessionStorage 를 지워 '새 탭' 을 흉내낸다):
//   1. 앱을 열어 제품명을 넣고 세션 자산을 저장한다 (초안 S1, 내용 있음)
//   2. 같은 출처의 정적 페이지로 나가 sessionStorage 를 지우고, S1 심장박동을 2분 전으로, 표식을 **빈 번호**로 덮는다 (사고 재현)
//   3. 앱을 다시 연다 → 새 초안 S2 가 S1 의 내용을 이어받아야 한다 (후순위 탐색)
//   4. 다시 나가 sessionStorage 를 지우고, 표식(S2)의 심장박동을 '지금' 으로 (살아 있는 탭) → 앱을 연다
//      → 새 초안 S3 은 비어 있어야 하고, 표식은 여전히 S2 여야 한다 (빈 탭이 덮어쓰지 않음)
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const STATIC_URL = APP_URL.replace(/app\.html.*$/, 'src/runtime-manifest.json');
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'orphan-draft-adoption-v1.json');
const POINTER_ID = 'lastDraftWorkspaceScope';
const BEAT_PREFIX = 'kuasangse_draft_beat_v1:';
const DRAFT_KEY = 'pdp_last_work_draft_scope_v1';

const readyExpression = () => `${factoryCdpFixtureReadyExpression()} && typeof state !== 'undefined' && typeof saveSessionAssetsToDb === 'function' && typeof getCurrentLastWorkWorkspaceScope === 'function'`;

// 정적 페이지(앱이 안 도는 같은 출처)에서 IndexedDB 표식을 직접 읽고 쓴다.
const rawPointerScript = (op, value) => `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pdp_workspace_v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = db.transaction('appSettings', '${op === 'get' ? 'readonly' : 'readwrite'}').objectStore('appSettings');
  const result = await new Promise((res, rej) => { const r = ${op === 'get' ? `store.get('${POINTER_ID}')` : `store.put(${JSON.stringify(value)})`}; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  db.close();
  return ${op === 'get' ? 'result ? { scopeId: result.scopeId, releasedScopes: result.releasedScopes || [] } : null' : 'true'};
})()`;

async function openApp(cdp, seed, tag) {
  await cdp.send('Page.navigate', { url: `${APP_URL}?draftAdopt=${tag}&seed=${seed}` });
  await waitFor(cdp, readyExpression(), 60000);
  // 부팅 복원(이어받기 포함)이 끝날 때까지: 세션 자산 하이드레이션 뒤에 심장박동 타이머가 선다
  await waitFor(cdp, `(() => { try { return localStorage.getItem('${BEAT_PREFIX}' + getCurrentLastWorkWorkspaceScope()) !== null; } catch (_) { return false; } })()`, 30000);
  await new Promise(resolve => setTimeout(resolve, 1500));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });

  const seed = String(Date.now());
  const productName = `DRAFT-ADOPT 검사용 수납함 ${seed}`;

  // 1. 초안 S1 에 내용을 넣고 저장한다 (이전 시험이 남긴 초안 번호가 있어도 sessionStorage 를 비워 새로 시작)
  await cdp.send('Page.navigate', { url: STATIC_URL });
  await waitFor(cdp, `document.readyState === 'complete'`, 15000);
  await evaluate(cdp, `sessionStorage.clear(); true`);
  await openApp(cdp, seed, 'seed');
  const seeded = await evaluate(cdp, `(async () => {
    state.step = 'factory';
    state.productName = ${JSON.stringify(productName)};
    await saveSessionAssetsToDb();
    await new Promise(resolve => setTimeout(resolve, 800));
    const scope = getCurrentLastWorkWorkspaceScope();
    const record = await workspacePersistenceApi().loadDraftSessionAssetsForRecovery(scope);
    const pointer = await workspacePersistenceApi().loadPreference('${POINTER_ID}');
    return { scope, savedName: record ? String(record.productName || '') : null, pointerScope: pointer ? pointer.scopeId : null };
  })()`);

  // 2. 사고 재현: 나가서(내려가며 심장박동은 지워진다) sessionStorage 를 지우고, 표식을 빈 번호로 덮는다
  await cdp.send('Page.navigate', { url: STATIC_URL });
  await waitFor(cdp, `document.readyState === 'complete'`, 15000);
  const emptyScope = `draft:lastwork_empty_${seed}`;
  await evaluate(cdp, `(async () => {
    sessionStorage.clear();
    localStorage.setItem('${BEAT_PREFIX}${seeded.scope}', String(Date.now() - 120000));
    await ${rawPointerScript('put', { id: POINTER_ID, scopeId: emptyScope, savedAt: Date.now() })};
    return true;
  })()`);
  const pointerBeforeReopen = await evaluate(cdp, rawPointerScript('get'));

  // 3. 다시 연다 → S2 가 S1 의 내용을 이어받아야 한다
  await openApp(cdp, seed, 'reopen');
  const reopened = await evaluate(cdp, `(async () => {
    const pointer = await workspacePersistenceApi().loadPreference('${POINTER_ID}');
    return { scope: getCurrentLastWorkWorkspaceScope(), productName: String(state.productName || ''), draftKey: sessionStorage.getItem('${DRAFT_KEY}') ? 'set' : 'missing', pointerScope: pointer ? pointer.scopeId : null };
  })()`);

  // 4. 표식(S2)의 탭이 살아 있는 척: 새 탭은 비어 있어야 하고, 표식은 S2 그대로여야 한다
  await cdp.send('Page.navigate', { url: STATIC_URL });
  await waitFor(cdp, `document.readyState === 'complete'`, 15000);
  await evaluate(cdp, `(() => { sessionStorage.clear(); localStorage.setItem('${BEAT_PREFIX}${reopened.scope}', String(Date.now())); return true; })()`);
  await openApp(cdp, seed, 'empty');
  const emptyTab = await evaluate(cdp, `(async () => {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const pointer = await workspacePersistenceApi().loadPreference('${POINTER_ID}');
    return { scope: getCurrentLastWorkWorkspaceScope(), productName: String(state.productName || ''), pointerScope: pointer ? pointer.scopeId : null };
  })()`);
  // 흉내낸 심장박동은 지운다 (다음 시험이 S2 를 살아 있는 탭으로 오해하지 않도록)
  await evaluate(cdp, `(() => { localStorage.removeItem('${BEAT_PREFIX}${reopened.scope}'); return true; })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ productName, seeded, pointerBeforeReopen, reopened, emptyTab }, null, 2), 'utf8');
  assertChecks([
    { ok: seeded.savedName === productName && /^draft:lastwork_/.test(seeded.scope),
      message: `전제 불성립 - 초안 S1 에 제품명이 저장돼야 합니다: ${JSON.stringify(seeded)}` },
    { ok: seeded.pointerScope === seeded.scope,
      message: `내용이 생기면 표식이 S1 을 가리켜야 합니다: ${JSON.stringify(seeded)}` },
    { ok: pointerBeforeReopen && pointerBeforeReopen.scopeId === emptyScope,
      message: `사고 재현 전제 - 표식이 빈 번호로 덮여 있어야 합니다: ${JSON.stringify(pointerBeforeReopen)}` },
    { ok: reopened.scope !== seeded.scope && /^draft:lastwork_/.test(reopened.scope),
      message: `새 탭은 새 초안 번호여야 합니다(강종 재현): ${JSON.stringify(reopened)}` },
    { ok: reopened.productName === productName,
      message: `표식이 빈 번호를 가리켜도 내용 있는 초안(S1)을 이어받아야 합니다 (사고 그대로면 비어 있다): ${JSON.stringify(reopened)}` },
    { ok: reopened.pointerScope === reopened.scope,
      message: `이어받은 탭은 내용이 있으니 표식이 그 탭(S2)을 가리켜야 합니다: ${JSON.stringify(reopened)}` },
    { ok: emptyTab.scope !== reopened.scope && emptyTab.productName === '',
      message: `표식의 탭이 살아 있으면 새 탭은 비어 있어야 합니다: ${JSON.stringify(emptyTab)}` },
    { ok: emptyTab.pointerScope === reopened.scope,
      message: `빈 새 탭은 표식을 덮어쓰지 않아야 합니다 (사고의 원인): ${JSON.stringify(emptyTab)}` },
  ]);
  console.log(`[PASS] 초안 이어받기 - 표식이 빈 번호(${emptyScope.slice(-14)})를 가리켜도 S1 "${productName.slice(0, 22)}…" 을 S2 가 이어받음 · 빈 탭(S3)은 표식(S2)을 덮어쓰지 않음 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
