// 계약(실측): **옵션 이미지를 일부러 지운 것이 저장을 막지 않고, Ctrl+F5 를 눌러도 그대로다.**
//
// 주인님 2026-09-02: "컷들을 생성하고 필수값을 선정하고 vm을 선정하고 하던게 날아가지않는것,
//                    날아가는경우는 새 작업을 시작한경우에만 해당, f5키나 컨트롤f5를 눌러도 붙잡고있는것"
//
// 고치기 전 무슨 일이 났나 (전수 진단 #1·#2, critical):
//   옵션 이미지를 하나 지우면 assets.optionSorter.images 개수가 줄고, 서버가
//   'optionSorter.images.length' 로 저장을 거절한다. 한 번 거절이 시작되면 그 작업의
//   **모든** 저장이 같은 사유로 막힌다. 그런데 앱은 그것을 성공으로 치고 경고까지 지워서,
//   화면은 멀쩡한 채 서버 사본만 낡아 갔다.
//   실측: project:project_mt2jaj93_ilrs1e(낙지발노리개)에 08-31 21:37 ~ 09-01 15:20 사이
//   도착한 54건이 전부 거절됐고 서버 사본은 08-21 14:54 에 멈춰 있었다.
//
// 이 검사가 재는 것: 옵션 이미지를 지운 **뒤에 한 일**(확정값)과 삭제 표식이 Ctrl+F5 를 견디는가.
//
// 이 검사가 못 재는 것 — 정직하게 적어 둔다:
//  1) 서버 거절/수용 자체. 이 하네스에서는 문서 범위가 project: 로 서지 않아
//     (setAppState + replaceFactory 로는 draft: 가지만 생긴다 — DB-02 도 같다)
//     앱이 스스로 서버 last-work 를 저장하는 경로를 브라우저로 재현할 수 없고,
//     백엔드에 직접 POST 하면 편집권 자격이 없어 428 이다.
//     그래서 서버 규칙은 backend/tests/test_option_image_deletion_is_intentional.py 가 함수 단위로 덮는다.
//  2) **지운 이미지 자체가 되살아나는 것.** 실측 2026-09-02: 세션 JSON 에는 2장으로 저장되는데
//     (persistedImageCount=2) 복원 뒤 메모리는 3장이 된다 — 자산 저장소 쪽에 3장이 남아 있고
//     복원이 그쪽을 택하기 때문이다. 이건 서버 거절과는 다른 자리(자산 저장)의 문제라
//     이 검사에서 단정하지 않는다. 별도로 잡아야 한다.
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
const RESULT_PATH = path.join(OUT_DIR, 'option-image-delete-survives-reload-v1.json');

async function readState(cdp) {
  return evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory }) => {
    const factory = readFactory();
    const options = factory.optionSorter || {};
    const ids = (Array.isArray(options.images) ? options.images : [])
      .map(image => String(image?.archiveId || image?.localArchive?.archiveId || image?.id || ''));
    return {
      branchScope: getCurrentLastWorkWorkspaceScope?.() || '',
      productName: readAppState().productName || factory.product?.productName || '',
      imageIds: ids,
      deletedIds: Array.isArray(options.optionSourceDeletedArchiveIds) ? options.optionSourceDeletedArchiveIds.slice() : [],
      confirmedFieldValue: String(factory.product?.finalDb?.__probe || ''),
      storageWarning: String(state?.storageWarning || ''),
      warningKey: String(state?.storageWarningDismissKey || ''),
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
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const seed = String(Date.now());
  const productName = `옵션삭제검증_${seed}`;
  const probeValue = `확정값_${seed}`;

  await cdp.send('Page.navigate', { url: `${APP_URL}?optionDeleteReload=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof saveLastWorkNow === 'function'
    && typeof getCurrentLastWorkWorkspaceScope === 'function'`, 60000);

  // (A-1) 옵션 원본 3장을 심는다. 실제와 같이 보관 ID 를 갖는다.
  await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    setAppState({ productName: ${JSON.stringify(productName)} });
    const factory = cloneFactory(readFactory());
    factory.product = { ...factory.product, productName: ${JSON.stringify(productName)}, userProductName: ${JSON.stringify(productName)} };
    factory.optionSorter = {
      ...(factory.optionSorter || {}),
      images: [
        { id: 'oi-1', archiveId: 'arch-1' },
        { id: 'oi-2', archiveId: 'arch-2' },
        { id: 'oi-3', archiveId: 'arch-3' },
      ],
      optionSourceDeletedArchiveIds: [],
    };
    replaceFactory(factory, { mode: 'hydrate' });
    renderApp();
    await saveLastWorkNow({ force: true, sync: false });
    return true;
  }`);
  await new Promise(resolve => setTimeout(resolve, 2000));

  // (A-2) 한 장을 지우고 표식을 남긴다 — 옵션분류기 ✕ 버튼이 하는 것과 같다.
  await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp }) => {
    const factory = cloneFactory(readFactory());
    const options = factory.optionSorter || {};
    options.images = (options.images || []).filter(item => item.archiveId !== 'arch-3');
    options.optionSourceDeletedArchiveIds = [...(options.optionSourceDeletedArchiveIds || []), 'arch-3'];
    factory.optionSorter = options;
    factory.product = { ...factory.product, finalDb: { ...(factory.product?.finalDb || {}), __probe: ${JSON.stringify(probeValue)} } };
    replaceFactory(factory, { mode: 'hydrate' });
    renderApp();
    await saveLastWorkNow({ force: true, deep: true, sync: false });
    return true;
  }`);
  await new Promise(resolve => setTimeout(resolve, 3000));
  const beforeReload = await readState(cdp);

  // (A-3) Ctrl+F5 (캐시 무시 새로고침)
  const cycle = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?optionDeleteReload=v1&seed=${seed}&cycle=${cycle}` });
  await waitFor(cdp, `location.search.includes(${JSON.stringify(`cycle=${cycle}`)}) && ${factoryCdpFixtureReadyExpression()}
    && typeof getCurrentLastWorkWorkspaceScope === 'function'`, 60000);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const afterReload = await readState(cdp);

  const evidence = { productName, probeValue, beforeReload, afterReload };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(evidence, null, 2), 'utf8');

  const checks = [
    { ok: beforeReload.deletedIds.includes('arch-3'),
      message: `전제 불성립 - 삭제 표식이 남지 않았습니다: ${JSON.stringify(beforeReload)}` },
    { ok: beforeReload.confirmedFieldValue === probeValue,
      message: `전제 불성립 - 확정값이 메모리에도 없습니다: ${JSON.stringify(beforeReload)}` },

    // 핵심: 옵션 이미지를 지운 **뒤에 한 일**이 Ctrl+F5 를 견딘다.
    // 고치기 전에는 서버가 그 시점부터 모든 저장을 거절했고 앱은 그것을 성공으로 쳤다.
    { ok: afterReload.confirmedFieldValue === probeValue,
      message: `Ctrl+F5 뒤 확정값이 사라졌습니다: "${afterReload.confirmedFieldValue}" (기대 "${probeValue}")` },
    { ok: afterReload.deletedIds.includes('arch-3'),
      message: `Ctrl+F5 뒤 삭제 표식이 사라졌습니다: ${JSON.stringify(afterReload.deletedIds)}` },

    // 거절 경고가 떠 있으면 안 된다 - 일부러 지운 것은 서버가 받아야 한다.
    { ok: afterReload.warningKey !== 'protected-save-refused',
      message: `여전히 서버가 저장을 보류하고 있습니다: ${afterReload.storageWarning}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 옵션 이미지를 지운 뒤에 한 일이 Ctrl+F5 를 견딤 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
