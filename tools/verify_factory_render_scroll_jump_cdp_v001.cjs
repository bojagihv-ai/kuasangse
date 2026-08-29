// 회귀: 후보를 고르거나 필수값을 입력할 때마다 화면이 위로 확 튀던 문제.
//
// 사용자 증상 원문(2026-08-29):
//   "이거 픽할때마다 화면이 위로 확확 튀는데 왜그래?"
//   "필수값입력할때도 화면이 위로 확 튀어"
//
// 그동안 못 잡은 이유: 후보 0건·짧은 화면에서만 확인했다. 스크롤이 생기지 않으면
// 증상이 아예 발현되지 않는다. 그래서 이 검증은 **화면을 충분히 길게 만들고
// 실제로 스크롤을 내린 다음** 다시 그린다.
//
// 두 증상의 공통 경로는 재렌더 하나다. 그래서 렌더 직후(sync) · 다음 프레임(rAF) ·
// 배치 완료(400ms) 세 시점을 각각 잰다.
//   - sync 만 어긋나고 나중에 돌아오면: 복원이 배치 전에 잘린 것(클램핑).
//   - 끝까지 안 돌아오면: 복원이 아예 실패한 것.
//
// 계약: 다시 그려도 사람이 보고 있던 스크롤 위치가 유지된다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9357';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-render-scroll-jump-v001.json');

// 사람이 보던 자리에서 이만큼 넘게 밀리면 '튀었다' 고 본다.
const ALLOWED_DRIFT_PX = 48;
// 누른 것이 화면에서 이만큼 넘게 움직이면 사람 눈에 '확 튀었다' 로 보인다.
const ANCHOR_DRIFT_PX = 64;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);

  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // 사용자 화면과 같은 데스크톱 폭. 좁으면 레이아웃이 접혀 증상이 사라진다.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?factoryRenderScrollJump=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

    const result = await evaluate(cdp, `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

      // 사용자 화면과 같은 모양: 신화사DB 후보 12건 + DB 탭.
      // 실제 앱은 후보를 담을 때 범위 키를 찍는다(factorySlimReviewCandidateList).
      // 찍지 않으면 후보를 고른 뒤 나머지가 범위 필터에 걸려 사라지고, 그건 앱 동작이
      // 아니라 시험 데이터의 결함이다. 그래서 여기서도 같은 규칙으로 찍는다.
      const PRODUCT_NAME = '슬라브나비수수저집';
      const WORKSPACE_ID = 'render-scroll-jump-fixture';
      const SCOPE_KEY = WORKSPACE_ID + '::' + PRODUCT_NAME.replace(/\s+/g, '').toLowerCase() + '::candidate-review';
      const candidates = Array.from({ length: 12 }, (_, index) => ({
        product_name: '나비수저집 ' + (index + 1),
        jcode: String(1600 + index),
        match_query: PRODUCT_NAME,
        reviewProductName: PRODUCT_NAME,
        reviewProductScopeKey: SCOPE_KEY,
        score: 200 - index,
      }));

      state.currentProjectId = WORKSPACE_ID;
      state.step = 'factory';
      const factory = window.factoryState();
      factory.product = {
        ...(factory.product || {}),
        userProductName: PRODUCT_NAME,
        productName: PRODUCT_NAME,
        dbCandidates: candidates,
        selectedDbCandidateKey: '',
      };
      factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
      window.render();
      await wait(700);

      const scroller = () => (document.querySelector('.app') || document.scrollingElement);
      const el = scroller();
      if (!el) throw new Error('스크롤 컨테이너를 찾지 못했습니다.');

      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxTop < 200) {
        return { skipped: true, reason: '스크롤이 생기지 않아 증상을 재현할 수 없습니다. maxTop=' + maxTop };
      }

      // 사람이 화면 중간쯤을 보고 있는 상태.
      const parked = Math.round(maxTop * 0.6);
      el.scrollTop = parked;
      await frame();
      const before = el.scrollTop;

      // 재렌더. 사용자가 후보를 고르거나 필수값을 입력할 때 도는 그 경로다.
      window.render();
      const sync = scroller()?.scrollTop ?? -1;
      await frame();
      const afterFrame = scroller()?.scrollTop ?? -1;
      await wait(400);
      const settled = scroller()?.scrollTop ?? -1;

      // 후보 목록은 max-height:360px 짜리 **안쪽 스크롤 상자**다(사용자 화면의 그 스크롤바).
      // 페이지가 아니라 이 목록이 맨 위로 되돌아가면, 사람 눈에는 '화면이 위로 튀는' 것으로 보인다.
      const list = () => document.querySelector('.factory-candidate-list');
      const listEl = list();
      // 상자 여부는 **후보가 가득할 때** 재야 한다. 픽하면 목록이 줄어 넘칠 게 없어지고,
      // 그때 재면 상자가 있어도 '없음' 으로 보여 결함을 놓친다. (2026-08-29 실제로 놓쳤다.)
      const listCardsWhenMeasured = document.querySelectorAll('.factory-candidate-card').length;
      const listIsScrollBox = (() => {
        if (!listEl) return null;
        const style = getComputedStyle(listEl);
        const overflowY = (style.overflowY || '') + ' ' + (style.overflow || '');
        return /auto|scroll/i.test(overflowY) && listEl.scrollHeight > listEl.clientHeight + 2;
      })();
      const listMax = listEl ? Math.max(0, listEl.scrollHeight - listEl.clientHeight) : 0;
      let listBefore = 0, listSync = 0, listSettled = 0, listNodeKept = null;
      if (listEl && listMax > 40) {
        listEl.scrollTop = Math.round(listMax * 0.7);
        await frame();
        listBefore = listEl.scrollTop;
        window.render();
        listSync = list()?.scrollTop ?? -1;
        await wait(400);
        listSettled = list()?.scrollTop ?? -1;
        // 노드가 살아남았는지: 살아남았다면 스크롤도 살아남아야 한다.
        listNodeKept = list() === listEl;
      }

      // 실제 버튼이 있으면 그것도 눌러 본다. 없으면 건너뛴다(후보 범위 필터 때문).
      const el2 = scroller();
      const parked2 = Math.round(Math.max(0, el2.scrollHeight - el2.clientHeight) * 0.6);
      el2.scrollTop = parked2;
      const listEl2 = list();
      const listMax2 = listEl2 ? Math.max(0, listEl2.scrollHeight - listEl2.clientHeight) : 0;
      if (listEl2 && listMax2 > 40) listEl2.scrollTop = Math.round(listMax2 * 0.7);
      await frame();
      const beforePick = el2.scrollTop;
      const beforePickList = list()?.scrollTop ?? -1;
      const pickButton = document.querySelector('[data-factory-apply-db-candidate]:not([disabled])');
      // UX 계약: 스크롤 숫자가 아니라 **누른 것이 화면에서 같은 자리에 있어야** 한다.
      // 동작을 누르면 내용이 접혀 페이지가 짧아지고, 브라우저가 스크롤을 끝으로 잘라내면서
      // 화면이 위로 올라간다. 그때 사람이 보던 카드가 어디로 갔는지를 잰다.
      const anchorCard = pickButton ? pickButton.closest('.factory-candidate-card') : null;
      const anchorTopBefore = anchorCard ? Math.round(anchorCard.getBoundingClientRect().top) : null;
      let anchorTopAfter = anchorTopBefore;
      let pickSettled = beforePick;
      let pickListSettled = beforePickList;
      const pickMaxBefore = Math.max(0, el2.scrollHeight - el2.clientHeight);
      let pickMaxAfter = pickMaxBefore;
      const cardCount = () => document.querySelectorAll('.factory-candidate-card').length;
      const panelHeights = () => Array.from(document.querySelectorAll('.factory-candidate-panel'))
        .map(node => Math.round(node.getBoundingClientRect().height));
      const cardsBefore = cardCount();
      const panelsBefore = panelHeights();
      const f1 = window.factoryState();
      const arrayBefore = (f1?.product?.dbCandidates || []).length;
      let arrayAfter = arrayBefore, scopeKeyAfter = '', confirmedAfter = false, selectedAfter = '';
      let cardsAfter = cardsBefore;
      let panelsAfter = panelsBefore;
      if (pickButton) {
        // 실제 사용자는 pointerdown -> mouseup -> click 순서로 누른다.
        // element.click() 만 부르면 pointerdown 이 나지 않아 실제와 다른 경로가 된다.
        const rect = pickButton.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 };
        pickButton.dispatchEvent(new PointerEvent('pointerdown', opts));
        pickButton.dispatchEvent(new MouseEvent('mouseup', opts));
        pickButton.click();
        await wait(700);
        const after = scroller();
        pickSettled = after?.scrollTop ?? -1;
        pickListSettled = list()?.scrollTop ?? -1;
        pickMaxAfter = after ? Math.max(0, after.scrollHeight - after.clientHeight) : -1;
        cardsAfter = cardCount();
        panelsAfter = panelHeights();
        if (anchorCard && anchorCard.isConnected) {
          anchorTopAfter = Math.round(anchorCard.getBoundingClientRect().top);
        } else {
          const replacement = document.querySelector('.factory-candidate-card');
          anchorTopAfter = replacement ? Math.round(replacement.getBoundingClientRect().top) : null;
        }
        const f2 = window.factoryState();
        arrayAfter = (f2?.product?.dbCandidates || []).length;
        scopeKeyAfter = String((f2?.product?.dbCandidates || [])[0]?.reviewProductScopeKey || '');
        confirmedAfter = !!f2?.product?.confirmedDb;
        selectedAfter = String(f2?.product?.selectedDbCandidateKey || '');
      }

      return {
        skipped: false,
        scroller: el.tagName + '.' + String(el.className || '').split(' ')[0],
        maxTop,
        rerender: { before, sync, afterFrame, settled },
        pick: { found: !!pickButton, before: beforePick, settled: pickSettled,
                maxBefore: pickMaxBefore, maxAfter: pickMaxAfter,
                cardsBefore, cardsAfter, panelsBefore, panelsAfter,
                arrayBefore, arrayAfter, scopeKeyAfter, confirmedAfter, selectedAfter,
                anchorTopBefore, anchorTopAfter },
        innerList: {
          max: listMax, before: listBefore, sync: listSync, settled: listSettled, nodeKept: listNodeKept,
          pickBefore: beforePickList, pickSettled: pickListSettled,
          isScrollBox: listIsScrollBox,
          cardsWhenMeasured: listCardsWhenMeasured,
        },
      };
    })()`);

    if (result?.skipped) throw new Error(`재현 조건을 만들지 못했습니다: ${result.reason}`);

    const drift = (a, b) => Math.abs(Number(b) - Number(a));
    const r = result.rerender;
    const checks = [
      {
        ok: drift(r.before, r.settled) <= ALLOWED_DRIFT_PX,
        message: `다시 그려도 보던 자리를 지킨다 (before=${r.before} settled=${r.settled}, 허용 ${ALLOWED_DRIFT_PX}px)`,
      },
      {
        ok: Number(r.settled) > ALLOWED_DRIFT_PX,
        message: `다시 그려도 맨 위로 되돌아가지 않는다 (settled=${r.settled})`,
      },
      {
        // 근본 계약(CLAUDE.md UI 원칙): 후보 목록은 개별 스크롤 상자가 아니어야 한다.
        // 상자가 있으면 고를 때마다 그 안이 맨 위로 되돌아간다 — 2026-08-29 실측 1061 -> 0.
        // 상자가 없으면 되돌아갈 스크롤 자체가 없다.
        ok: result.innerList.isScrollBox === false,
        message: `후보 목록은 개별 스크롤 상자가 아니다 (isScrollBox=${result.innerList.isScrollBox})`,
      },
      {
        // 안쪽 상자가 되살아난 경우에도, 최소한 그냥 다시 그리는 것만으로 위치를 잃지 않아야 한다.
        ok: !(result.innerList.max > 40)
          || drift(result.innerList.before, result.innerList.settled) <= ALLOWED_DRIFT_PX,
        message: `안쪽 스크롤이 남아 있다면 재렌더로 잃지 않는다 (before=${result.innerList.before} settled=${result.innerList.settled})`,
      },
      {
        // 후보 픽은 화면 높이를 실제로 바꾼다(확정 안내가 뜨고 패널이 접힌다).
        // 화면이 짧아지면 브라우저가 스크롤을 끝으로 잘라내는데 그건 리셋이 아니다.
        // 그래서 '내용이 줄지 않았는데도 위치를 잃는 경우' 만 실패로 본다.
        ok: !result.pick.found
          || result.pick.maxAfter < result.pick.before
          || drift(result.pick.before, result.pick.settled) <= ALLOWED_DRIFT_PX,
        message: `내용이 그대로면 후보를 골라도 위치를 지킨다 (before=${result.pick.before} settled=${result.pick.settled} 최대 ${result.pick.maxBefore}->${result.pick.maxAfter}, 카드 ${result.pick.cardsBefore}->${result.pick.cardsAfter})`,
      },
      {
        // 진짜 UX 계약. 사람이 누른 것은 화면에서 같은 높이에 머물러야 한다.
        // 다만 동작 때문에 내용이 접혀 페이지가 크게 짧아지면, 되밀 여유 자체가 없어진다.
        // 그때는 '할 수 있는 만큼(끝까지) 밀었는가' 로 본다. 아무것도 안 하고 그냥
        // 잘려버리는 것과, 최대치까지 밀어 최대한 붙잡는 것은 체감이 다르다.
        ok: !result.pick.found || result.pick.anchorTopBefore === null
          || drift(result.pick.anchorTopBefore, result.pick.anchorTopAfter) <= ANCHOR_DRIFT_PX
          || Number(result.pick.settled) >= Number(result.pick.maxAfter) - 1,
        message: `누른 것을 제자리에 붙잡는다 (카드 top ${result.pick.anchorTopBefore} -> ${result.pick.anchorTopAfter}, 스크롤 ${result.pick.settled}/${result.pick.maxAfter})`,
      },
    ];

    fs.writeFileSync(RESULT_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      allowedDriftPx: ALLOWED_DRIFT_PX,
      result,
      checks,
    }, null, 2) + '\n', 'utf8');

    assertChecks(checks);
    console.log(`[PASS] 재렌더가 스크롤 위치를 지킵니다. before=${r.before} sync=${r.sync} frame=${r.afterFrame} settled=${r.settled}`);
  } finally {
    cdp.close?.();
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error('[FAIL]', error?.message || error);
  process.exit(1);
});
