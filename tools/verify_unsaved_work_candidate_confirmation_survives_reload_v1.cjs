// 계약: **저장 버튼을 누르기 전 작업이라도, 화면에서 고른 DB/Cafe24 확정은 강제 새로고침을 견딘다.**
//
// 2026-08-31 주인님: "또 날라갔다 db랑 카페24 몇번쨰냐"
//   화면에는 "DB 후보 0건, Cafe24 후보 0건", "아직 후보를 확인하지 않음" 만 남아 있었다.
//
// 왜 이미 있는 검사가 못 잡았나 — DB-02(verify_factory_candidate_confirmation_reload_cdp_v185)는
//   (1) `project_candidate_confirm_v185_*` 라는 **이미 저장된 작업**을 미리 심어 두고 시작하고,
//   (2) 확정값을 클릭이 아니라 `factory.product.confirmedDb = ...` 로 **손으로 찔러 넣고**,
//   (3) `saveLastWorkNow()` 로 **명시적으로 저장한 뒤** 새로고침한다.
// 주인님이 실제로 하시는 것은 셋 다 아니다. 저장 전(draft:) 작업에서, 후보 카드를 눌러 확정하고,
// 따로 저장하지 않은 채 새로고침(또는 새 빌드 적용)한다. 그 경로는 검사된 적이 없다.
//
// 그리고 그 경로에는 그물이 하나도 없다 — app-core-02.js 의 서버 저장은
//   if (!scopeId.startsWith('project:')) { return false; }
// 로 draft 작업을 조용히 건너뛴다. 사본이 브라우저 안에 딱 하나뿐이라, 그것만 날아가면 끝이다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');
const { readPersistedExpression } = require('./factory_candidate_confirmation_harness_utils.cjs');

// 기존 도우미 reloadAndRead 를 쓸 수 없다. 그 안의
//   workspacePersistenceApi().normalizeProjectScope(operationToken.workspaceId)
// 가 한 번도 저장된 적 없는 작업에서 'draft scope is not a project identity' 로 **던진다**.
// 즉 지금 도구로는 이 경로를 읽어 볼 수조차 없었다 - 그래서 아무도 못 봤다.
async function reloadAndReadUnsaved(cdp, appUrl) {
  const cycle = String(Date.now());
  await cdp.send('Page.navigate', { url: `${appUrl}?unsavedConfirmationReload=v1&cycle=${cycle}` });
  await waitFor(cdp, `location.search.includes(${JSON.stringify(`cycle=${cycle}`)}) && ${factoryCdpFixtureReadyExpression()}
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof workspacePersistenceApi === 'function'`, 60000);
  await new Promise(resolve => setTimeout(resolve, 1600));
  return evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory }) => {
    const appState = readAppState();
    const factory = readFactory();
    return {
      productName: appState.productName || factory.product?.productName || '',
      scope: getCurrentLastWorkWorkspaceScope?.() || '',
      state: {
        dbKey: factory.product?.selectedDbCandidateKey || '',
        cafeKey: factory.product?.selectedCafe24CandidateKey || '',
        dbResolution: factory.product?.dbCandidateResolution || '',
        cafeResolution: factory.product?.cafe24CandidateResolution || '',
        hasConfirmedDb: !!factory.product?.confirmedDb,
        confirmedCafeKey: factory.product?.confirmedCafe24ProductKey || '',
        dbConfirmFailureNote: String(factory.product?.dbConfirmFailureNote || ''),
      },
      candidateState: {
        pendingDbCount: Number(factory.product?.pendingDbCandidates?.length || 0),
        pendingCafeCount: Number(factory.product?.pendingCafe24Candidates?.length || 0),
        dbCount: Number(factory.product?.dbCandidates?.length || 0),
        cafeCount: Number(factory.product?.cafe24Candidates?.length || 0),
      },
      persisted: await ${readPersistedExpression()},
      domConfirmedCount: (document.body.innerText.match(/확정됨/g) || []).length,
    };
  }`);
}

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'unsaved-work-candidate-confirmation-reload-v1.json');

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
  await cdp.send('Page.navigate', { url: `${APP_URL}?unsavedConfirmationReload=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryApplyDbCandidateFromReview === 'function'
    && typeof factoryApplyCafe24CandidateFromReview === 'function'
    && typeof factoryCandidateReviewScopeKey === 'function'
    && typeof factoryCandidateReviewIdentityKey === 'function'
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof workspacePersistenceApi === 'function'`, 60000);

  const productName = `저장전확정검증상품_${seed}`;
  // 저장 전 작업 그대로 둔다 — replaceFactory 에 workspaceId 를 주지 않아야 draft: 로 남는다.
  const confirmed = await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    const factory = cloneFactory(readFactory());
    factory.product = {
      ...factory.product,
      productName: ${JSON.stringify(productName)},
      userProductName: ${JSON.stringify(productName)},
      candidateAutoApply: false,
    };
    factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
    replaceFactory(factory, { mode: 'hydrate' });
    setAppState({ productName: ${JSON.stringify(productName)} });
    renderApp();

    const live = readFactory();
    const scopeKey = factoryCandidateReviewScopeKey(live);
    const identityKey = factoryCandidateReviewIdentityKey(live);
    const stamp = candidate => ({
      ...candidate,
      match_query: ${JSON.stringify(productName)},
      reviewProductName: ${JSON.stringify(productName)},
      reviewProductScopeKey: scopeKey,
      reviewProductIdentityKey: identityKey,
    });
    const db = stamp({ product_name: '신화사 확정 후보', jcode: 'DB-UNSAVED-V1' });
    const cafe = stamp({ product_name: 'Cafe24 확정 후보', product_no: 'CAFE24-UNSAVED-V1', product_code: 'CAFE24-UNSAVED-V1' });

    const seeded = cloneFactory(readFactory());
    seeded.product.dbCandidates = [db];
    seeded.product.pendingDbCandidates = [db];
    seeded.product.cafe24Candidates = [cafe];
    seeded.product.pendingCafe24Candidates = [cafe];
    replaceFactory(seeded, { mode: 'hydrate' });
    renderApp();

    const scopeBeforeConfirm = getCurrentLastWorkWorkspaceScope?.() || '';
    // 화면 버튼이 부르는 것과 같은 경로. options.factory 를 주지 않아야 실제 lease/명령을 탄다.
    const dbApplied = await factoryApplyDbCandidateFromReview(0);
    const cafeApplied = await factoryApplyCafe24CandidateFromReview(0);
    const after = readFactory();
    return {
      scopeBeforeConfirm,
      dbApplied: dbApplied === true ? true : String(dbApplied ?? ''),
      cafeApplied: cafeApplied === true ? true : String(cafeApplied ?? ''),
      dbKey: after.product?.selectedDbCandidateKey || '',
      cafeKey: after.product?.selectedCafe24CandidateKey || '',
      hasConfirmedDb: !!after.product?.confirmedDb,
      confirmedCafeKey: after.product?.confirmedCafe24ProductKey || '',
      candidateReviewStatus: String(after.product?.candidateReviewStatus || ''),
      dbConfirmFailureNote: String(after.product?.dbConfirmFailureNote || ''),
    };
  }`);

  // 주인님은 따로 저장을 누르지 않는다. 자동저장이 자리잡을 시간만 준다.
  await new Promise(resolve => setTimeout(resolve, 4000));

  const firstReload = await reloadAndReadUnsaved(cdp, APP_URL);
  const secondReload = await reloadAndReadUnsaved(cdp, APP_URL);

  const evidence = { productName, confirmed, firstReload, secondReload };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(evidence, null, 2), 'utf8');

  // 어느 길로 갔는지 먼저 정한다. 검사 환경에는 신화사 서비스 키가 없어 대개 실패 쪽으로 간다.
  const confirmedDbSucceeded = confirmed.hasConfirmedDb === true;

  const checks = [
    { ok: /^draft:/.test(String(confirmed.scopeBeforeConfirm)),
      message: `전제 불성립 - 저장 전 작업(draft:)이 아닙니다: ${confirmed.scopeBeforeConfirm}` },

    // Cafe24 확정은 바깥 서비스를 타지 않는다. 저장 전 작업에서도 되어야 한다.
    { ok: confirmed.cafeApplied === true && !!confirmed.cafeKey && confirmed.confirmedCafeKey === confirmed.cafeKey,
      message: `저장 전 작업에서 Cafe24 확정이 되지 않았습니다: ${JSON.stringify(confirmed)}` },

    // 신화사DB 확정은 fetchSinhwaProductDetail 을 타므로 서비스 키가 없는 검사 환경에서는 실패한다.
    // 실패해도 좋다. 다만 **왜 안 됐는지 화면에 남아야 한다** - 조용히 실패하면
    // 주인님 눈에는 "후보 0건 · 아직 확인하지 않음" 으로만 보인다(실측 2026-08-31).
    // candidateReviewStatus 는 두 쪽이 나눠 쓰는 칸이라 Cafe24 성공이 DB 실패를 덮는다.
    // 그래서 DB 실패는 따로 붙들어 둔 자리(dbConfirmFailureNote)로 확인한다.
    { ok: confirmed.hasConfirmedDb === true || !!confirmed.dbConfirmFailureNote,
      message: `신화사DB 확정이 조용히 실패했습니다 - 사유가 어디에도 남지 않았습니다: ${JSON.stringify({ dbApplied: confirmed.dbApplied, candidateReviewStatus: confirmed.candidateReviewStatus, dbConfirmFailureNote: confirmed.dbConfirmFailureNote })}` },

    // 'A 이거나 B' 는 여기서 끝내면 안 된다 - 전수 진단 #7.
    // 둘 중 어느 길로 갔든, **그 길도 새로고침을 견뎌야** 사람에게 쓸모가 있다.
    // 확정에 성공했으면 확정값이 남아야 하고, 실패했으면 그 사유가 남아야 한다.
    // 사유가 새로고침에 날아가면 화면은 다시 "아직 확인하지 않음" 이 되어,
    // 2026-08-31 과 똑같이 아무 설명 없는 빈 화면이 된다.
    ...(confirmedDbSucceeded
      ? [
        { ok: firstReload.state.hasConfirmedDb === true && secondReload.state.hasConfirmedDb === true,
          message: `신화사DB 확정이 강제 새로고침에 사라졌습니다: ${JSON.stringify({ first: firstReload.state.hasConfirmedDb, second: secondReload.state.hasConfirmedDb })}` },
      ]
      : [
        { ok: !!firstReload.state.dbConfirmFailureNote && !!secondReload.state.dbConfirmFailureNote,
          message: `신화사DB 실패 사유가 강제 새로고침에 사라졌습니다 - 화면에는 다시 이유 없는 "아직 확인하지 않음" 만 남습니다: ${JSON.stringify({ first: firstReload.state.dbConfirmFailureNote, second: secondReload.state.dbConfirmFailureNote, atConfirm: confirmed.dbConfirmFailureNote })}` },
        { ok: /[가-힣]/.test(confirmed.dbConfirmFailureNote)
            && !/undefined|null|\[object Object\]/i.test(confirmed.dbConfirmFailureNote),
          message: `신화사DB 실패 사유가 사람이 읽을 수 없는 글입니다: ${JSON.stringify(confirmed.dbConfirmFailureNote)}` },
      ]),

    // 저장을 누르지 않은 작업이라도 고른 것은 강제 새로고침을 견뎌야 한다.
    { ok: firstReload.state.cafeKey === confirmed.cafeKey && firstReload.state.confirmedCafeKey === confirmed.confirmedCafeKey,
      message: `저장 전 작업에서 첫 강제 새로고침에 Cafe24 확정이 사라졌습니다: ${JSON.stringify(firstReload.state)} (확정 당시 ${confirmed.cafeKey})` },
    { ok: secondReload.state.cafeKey === confirmed.cafeKey && secondReload.state.confirmedCafeKey === confirmed.confirmedCafeKey,
      message: `저장 전 작업에서 두 번째 강제 새로고침에 Cafe24 확정이 사라졌습니다: ${JSON.stringify(secondReload.state)}` },
    { ok: firstReload.state.dbKey === confirmed.dbKey && secondReload.state.dbKey === confirmed.dbKey,
      message: `저장 전 작업에서 강제 새로고침에 신화사DB 선택이 사라졌습니다: ${JSON.stringify({ first: firstReload.state.dbKey, second: secondReload.state.dbKey, expected: confirmed.dbKey })}` },
    { ok: firstReload.candidateState.pendingDbCount > 0 && firstReload.candidateState.pendingCafeCount > 0,
      message: `새로고침 뒤 후보 목록이 0건이 되었습니다(화면에는 "DB 후보 0건, Cafe24 후보 0건" 으로 보입니다): ${JSON.stringify(firstReload.candidateState)}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 저장 전 작업의 DB/Cafe24 확정이 강제 새로고침 2회를 견딤`
    + ` · 신화사DB 경로: ${confirmedDbSucceeded ? '확정 성공(확정값 유지 확인)' : `확정 실패(사유 유지 확인: ${JSON.stringify(confirmed.dbConfirmFailureNote)})`}`
    + ` - 증거 ${RESULT_PATH}`);
  return cdp;
}

// CDP 소켓을 열어 둔 채 끝내면 프로세스가 살아 있어 회귀 러너가 타임아웃으로 실패 처리한다.
let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => {
    console.error(`[FAIL] ${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(() => {
    try { openCdp?.close?.(); } catch (_) {}
    process.exit(process.exitCode || 0);
  });
