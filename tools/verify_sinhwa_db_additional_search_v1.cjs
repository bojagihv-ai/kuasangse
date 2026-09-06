// 계약: **DB 탭의 "기존 후보 제외 신화사DB 추가검색" 을 누르면, 보이던 후보는 그대로 두고 새 후보만 맨 위에 붙어 화면에 보인다.**
//
// 주인님 2026-09-06: "신화사db 중에 사실 저게 있거든? ... 카페24 추가검색하는 것처럼 추가검색하려고 했는데 그런 버튼이 없네?"
// 실제 앱(CDP)에서 신화사DB 검색만 가짜로 바꿔(같은 전역 함수 이름) 버튼을 실제로 누른다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'sinhwa-db-additional-search-v1.json');

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
  await cdp.send('Page.navigate', { url: `${APP_URL}?dbAppend=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()} && typeof factoryRunSinhwaCandidateAdditionalSearch === 'function'`, 60000);

  const seeded = await evaluate(cdp, `(async () => {
    const productName = '검사용 크리스탈 보자기 ${seed}';
    const A = { jcode: 101, id: 101, product_name: '크리스탈 보자기 A', jname: '크리스탈 보자기 A', score: 90, match_score: 90 };
    const B = { jcode: 102, id: 102, product_name: '크리스탈 보자기 B', jname: '크리스탈 보자기 B', score: 80, match_score: 80 };
    const C = { jcode: 103, id: 103, product_name: '크리스탈 보자기 C', jname: '크리스탈 보자기 C', score: 70, match_score: 70 };
    window.__dbAppendV1 = { searchCalls: [] };
    // 신화사DB 검색만 가짜로: A 는 이미 보이는 후보, B·C 가 새 후보
    factorySearchSinhwaReviewCandidates = async (terms, limit) => { window.__dbAppendV1.searchCalls.push([terms, limit]); return [A, B, C]; };
    state.step = 'factory';
    state.productName = productName;
    const factory = cloneData(factoryRuntimeReadFactory());
    factory.product = { ...(factory.product || {}), productName, userProductName: productName, productKey: productName, candidateAutoApply: false };
    factory.automation = { ...(factory.automation || {}), activeTab: 'db', dbSearchQuery: productName };
    factoryRuntimeReplaceFactorySnapshot(factory, { reason: 'db-append-test', mode: 'hydrate' });
    // 보이는 후보 A 를 실제 후보 목록 규칙(범위 도장)으로 넣는다
    factoryRuntimeUpdateOwnedFactory('factory/cafe24:collect-product-candidates', 'cafe24', draft => {
      draft.product.pendingDbCandidates = factorySlimReviewCandidateList([A], 'sinhwa', 20, draft);
      draft.product.pendingCafe24Candidates = [];
      draft.product.candidateReviewStatus = '검사용: 후보 1건';
      return true;
    });
    render();
    await new Promise(resolve => setTimeout(resolve, 500));
    const live = factoryRuntimeReadFactory();
    const panel = document.querySelector('[data-factory-guide-action="append-db-query"]');
    return {
      pendingBefore: (live.product.pendingDbCandidates || []).map(c => c.jcode),
      buttonText: panel ? panel.innerText : '',
      activeTab: live.automation?.activeTab,
    };
  })()`);

  // 버튼을 실제로 누른다
  await evaluate(cdp, `(() => { const b = document.querySelector('[data-factory-guide-action="append-db-query"]'); if (!b) throw new Error('append-db-query button missing'); b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
  await waitFor(cdp, `(() => { const p = factoryRuntimeReadFactory().automation?.candidateSearchProgress; return p && p.kind === 'append-sinhwa' && p.running === false; })()`, 20000);
  await new Promise(resolve => setTimeout(resolve, 500));
  const after = await evaluate(cdp, `(() => {
    const live = factoryRuntimeReadFactory();
    const pending = live.product.pendingDbCandidates || [];
    const text = document.body.innerText || '';
    return {
      searchCalls: window.__dbAppendV1.searchCalls,
      pendingAfter: pending.map(c => c.jcode),
      appended: pending.filter(c => c.factory_recent_append).map(c => c.jcode),
      reviewStatus: String(live.product.candidateReviewStatus || ''),
      stage: { status: live.stages?.db?.status, message: live.stages?.db?.message },
      progress: live.automation?.candidateSearchProgress,
      screenHasB: text.includes('크리스탈 보자기 B'),
      screenHasC: text.includes('크리스탈 보자기 C'),
      screenHasA: text.includes('크리스탈 보자기 A'),
      screenHasBadge: text.includes('이번 추가검색'),
      cafe24Pending: (live.product.pendingCafe24Candidates || []).length,
    };
  })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ seeded, after }, null, 2), 'utf8');
  assertChecks([
    { ok: JSON.stringify(seeded.pendingBefore) === '[101]' && /신화사DB 추가검색/.test(seeded.buttonText),
      message: `전제 불성립 - 후보 A 1건과 DB 탭의 추가검색 버튼이 있어야 합니다: ${JSON.stringify(seeded)}` },
    { ok: after.searchCalls.length === 1, message: `신화사DB 검색은 1번만: ${JSON.stringify(after.searchCalls)}` },
    { ok: JSON.stringify(after.pendingAfter) === '[102,103,101]',
      message: `새 후보 B, C 가 맨 위에 붙고 A 는 그대로 남아야 합니다(이전 경로는 A 를 지웠다): ${JSON.stringify(after.pendingAfter)}` },
    { ok: JSON.stringify(after.appended) === '[102,103]', message: `"이번 추가검색" 표식은 새 후보에만: ${JSON.stringify(after.appended)}` },
    { ok: after.screenHasA && after.screenHasB && after.screenHasC && after.screenHasBadge,
      message: `화면에 A·B·C 와 "이번 추가검색" 표식이 보여야 합니다: ${JSON.stringify({ a: after.screenHasA, b: after.screenHasB, c: after.screenHasC, badge: after.screenHasBadge })}` },
    { ok: /신화사DB 새 후보 2건 추가/.test(String(after.stage.message || '')) && after.stage.status === 'review',
      message: `단계 문구가 결과를 말해야 합니다: ${JSON.stringify(after.stage)}` },
    { ok: after.cafe24Pending === 0 && /추가검색 완료/.test(after.reviewStatus), message: `Cafe24 후보는 손대지 않고 상태 문구가 남아야 합니다: ${JSON.stringify({ cafe24: after.cafe24Pending, status: after.reviewStatus })}` },
  ]);
  console.log(`[PASS] 신화사DB 추가검색 - 후보 ${seeded.pendingBefore.length}건 → ${after.pendingAfter.length}건(새 ${after.appended.length}건 맨 위) · 화면 표식 · "${after.stage.message}" - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
