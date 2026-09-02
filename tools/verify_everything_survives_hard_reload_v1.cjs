// 계약: **한 작업 안에서 생성한 것·고른 것·확정한 것이 함께 Ctrl+F5 를 견딘다.**
//
// 주인님 2026-09-02:
//   "이미지 생성한거나 필수값고른거나 vm선택한것 등등 날라가거나했던것
//    그것도 항상 주의해야돼 코딩하면서 안날라가게"
//   "사라지는 건 오직 '새 작업' 을 눌렀을 때뿐"
//
// 왜 따로 필요한가:
//   넷을 **각각** 지키는 검사는 있다 — IMG-02(생성 이미지), FULL-01/FIELD-01(필수값),
//   VM-02/DB-03(VM 후보), SAVE-26(조립공장 생성물).
//   그런데 넷이 **한 작업에 함께 들어 있을 때** 서로를 밀어내지 않는지 보는 검사가 없었다.
//   "이거 고치면 저거 날아간다" 가 나는 자리가 정확히 거기다 — 한 쪽 복원이 다른 쪽을
//   덮거나, 명령 정책이 한 쪽만 허용해 나머지가 통째로 거절되거나(실측 2026-08-31,
//   'factory/start:runDb' 정책에 competitors 가 빠져 초안 전체가 버려진 적이 있다).
//
// 그래서 하나의 작업에 넷을 다 넣고 강제 새로고침을 두 번 한다.
// 두 번 하는 이유: 첫 새로고침은 메모리에서, 두 번째는 저장본에서 복원되는 경로가 다르다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'everything-survives-hard-reload-v1.json');

async function readAll(cdp) {
  return evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory }) => {
    const factory = readFactory();
    const assets = Array.isArray(factory.assets) ? factory.assets : [];
    const market = factory.compMarketScrape || factory.marketScrape
      || (typeof ensureCompMarketScrapeState === 'function' ? ensureCompMarketScrapeState() : {}) || {};
    return {
      productName: readAppState().productName || factory.product?.productName || '',
      // 1) 생성한 이미지 (조립공장 생성물)
      assetIds: assets.map(item => String(item?.id || '')).filter(Boolean).sort(),
      // 2) 필수값 확정
      requiredFields: {
        usage: String(factory.product?.finalDb?.__usage || ''),
        size: String(factory.product?.finalDb?.__size || ''),
        material: String(factory.product?.finalDb?.__material || ''),
      },
      // 3) VM 후보 선택
      selectedCandidateIds: Array.isArray(market.selectedIds) ? market.selectedIds.slice().sort() : [],
      candidateCount: Array.isArray(market.results) ? market.results.length : -1,
      // 4) 이미지컷 생성 수량 (오늘 고친 래칫 자리)
      cutsTarget: Number(factory.stages?.cuts?.targetCount ?? -1),
      // 곁들여: 옵션 원본
      optionImageIds: (Array.isArray(factory.optionSorter?.images) ? factory.optionSorter.images : [])
        .map(item => String(item?.archiveId || item?.id || '')).filter(Boolean).sort(),
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
  const productName = `통합유지검증_${seed}`;
  const usage = `사용용도_${seed}`;
  const size = `4.8cm_${seed}`;
  const material = `폴리100_${seed}`;

  await cdp.send('Page.navigate', { url: `${APP_URL}?everythingSurvives=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof saveLastWorkNow === 'function'
    && typeof factoryRuntimeUpdateOwnedFactory === 'function'`, 60000);

  // 넷을 한 작업에 넣는다. 자산은 명령 정책상 factory-assets 소유라 따로 쓴다(SAVE-26 과 같은 방식).
  await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    setAppState({ productName: ${JSON.stringify(productName)} });
    const factory = cloneFactory(readFactory());
    factory.product = {
      ...factory.product,
      productName: ${JSON.stringify(productName)},
      userProductName: ${JSON.stringify(productName)},
      finalDb: {
        ...(factory.product?.finalDb || {}),
        __usage: ${JSON.stringify(usage)},
        __size: ${JSON.stringify(size)},
        __material: ${JSON.stringify(material)},
      },
    };
    factory.stages = { ...(factory.stages || {}), cuts: { ...(factory.stages?.cuts || {}), targetCount: 3 } };
    factory.optionSorter = {
      ...(factory.optionSorter || {}),
      images: [{ id: 'opt-1', archiveId: 'oarch-1' }, { id: 'opt-2', archiveId: 'oarch-2' }],
      optionSourceDeletedArchiveIds: [],
    };
    replaceFactory(factory, { mode: 'hydrate' });
    setAppState({ productName: ${JSON.stringify(productName)} });
    renderApp();

    // VM 후보 수집 결과와 그중 고른 것
    if (typeof ensureCompMarketScrapeState === 'function') {
      const market = ensureCompMarketScrapeState();
      market.results = [
        { id: 'cand-a', site: 'coupang', name: '후보 A' },
        { id: 'cand-b', site: 'gmarket', name: '후보 B' },
        { id: 'cand-c', site: '11st', name: '후보 C' },
      ];
      market.selectedIds = ['cand-b'];
    }

    // 조립공장 생성물 (이미지 생성 결과)
    await Promise.resolve(factoryRuntimeUpdateOwnedFactory('factory/runtime:registerAsset', 'factory-assets', draft => {
      draft.assets = [
        { id: 'gen-hero-1', stageId: 'hero', hasImage: true, imageUrl: '/api/local-archive/assets/a1/image', archiveId: 'a1' },
        { id: 'gen-cut-1', stageId: 'cuts', hasImage: true, imageUrl: '/api/local-archive/assets/a2/image', archiveId: 'a2' },
        { id: 'gen-cut-2', stageId: 'cuts', hasImage: true, imageUrl: '/api/local-archive/assets/a3/image', archiveId: 'a3' },
      ];
      return true;
    }));
    await saveLastWorkNow({ force: true, deep: true, sync: false });
    return true;
  }`);
  await new Promise(resolve => setTimeout(resolve, 3500));
  const before = await readAll(cdp);

  // 첫 강제 새로고침
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}`, 60000);
  await new Promise(resolve => setTimeout(resolve, 3000));
  const afterFirst = await readAll(cdp);

  // 두 번째 강제 새로고침 - 저장본에서 복원되는 경로
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}`, 60000);
  await new Promise(resolve => setTimeout(resolve, 3000));
  const afterSecond = await readAll(cdp);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ productName, before, afterFirst, afterSecond }, null, 2), 'utf8');

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const checks = [
    // 전제: 넷이 다 들어갔는가
    { ok: before.assetIds.length === 3 && before.selectedCandidateIds.length === 1
        && before.requiredFields.usage === usage && before.cutsTarget === 3,
      message: `전제 불성립 - 넷이 다 들어가지 않았습니다: ${JSON.stringify(before)}` },
  ];
  for (const [label, after] of [['첫', afterFirst], ['두 번째', afterSecond]]) {
    checks.push(
      { ok: after.productName === productName,
        message: `${label} Ctrl+F5 뒤 제품명이 사라졌습니다: "${after.productName}"` },
      { ok: same(after.assetIds, before.assetIds),
        message: `${label} Ctrl+F5 뒤 생성한 이미지가 사라졌습니다: ${JSON.stringify(after.assetIds)} (기대 ${JSON.stringify(before.assetIds)})` },
      { ok: same(after.requiredFields, before.requiredFields),
        message: `${label} Ctrl+F5 뒤 필수값이 사라졌습니다: ${JSON.stringify(after.requiredFields)} (기대 ${JSON.stringify(before.requiredFields)})` },
      { ok: same(after.selectedCandidateIds, before.selectedCandidateIds),
        message: `${label} Ctrl+F5 뒤 고른 VM 후보가 사라졌습니다: ${JSON.stringify(after.selectedCandidateIds)} (기대 ${JSON.stringify(before.selectedCandidateIds)})` },
      { ok: after.cutsTarget === before.cutsTarget,
        message: `${label} Ctrl+F5 뒤 이미지컷 생성 수량이 바뀌었습니다: ${after.cutsTarget} (기대 ${before.cutsTarget})` },
      { ok: same(after.optionImageIds, before.optionImageIds),
        message: `${label} Ctrl+F5 뒤 옵션 원본이 사라졌습니다: ${JSON.stringify(after.optionImageIds)} (기대 ${JSON.stringify(before.optionImageIds)})` },
    );
  }
  assertChecks(checks);
  console.log(`[PASS] 생성물 ${before.assetIds.length}개 · 필수값 3개 · VM 후보 선택 · 이미지컷 수량 · 옵션 원본이 강제 새로고침 2회를 함께 견딤 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
