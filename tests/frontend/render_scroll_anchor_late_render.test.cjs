'use strict';

// 회귀: 누른 것이 제자리에 머물지 못하던 문제 — 늦게 온 다시 그리기.
//
// 실측(2026-08-29): 회귀 PERF-04 가 **단독 실행에서는 4/4 통과**하는데
// 전체 실행에서만 실패했다 (카드 top 210 -> 608, 스크롤 1431/1595).
// 원인은 무작위 흔들림이 아니었다:
//   - 회귀 실행기는 스텝을 순차로 돌리고(경합 아님),
//   - 145개 스텝이 보관·상태 폴더 하나를 공유한다
//     (tools/run_daily_regression.cjs 의 archiveRoot/stateRoot 는 실행당 1회 생성).
//   - 그래서 뒤로 갈수록 데이터가 쌓여 다시 그리기가 느려진다.
// 그런데 보정은 클릭 후 [60, 180, 400]ms 까지만 확인하고 끝냈다.
// 400ms 뒤에 도착한 렌더에 카드가 밀리면 손을 쓸 방법이 없었다.
//
// 처음에는 관찰 시간을 늘려 계속 훑는 방식으로 고쳤다가 **DB-10 을 3/3 결정적으로 깼다**
// (실제 포인터 클릭 검사 — 보정이 스크롤을 움직이는 사이 다음 클릭 좌표가 어긋났다).
//
// 계약: 시계로 훑지 말고 **렌더에 매단다.**
//   - 렌더가 없으면 스크롤을 건드리지 않는다 (포인터 클릭을 방해하지 않는다).
//   - 늦게 도착한 렌더가 끝날 때 한 번 되민다 (카드가 밀린 채 남지 않는다).
//   - 사람이 스스로 스크롤하면 그만둔다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src/app-core-02.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 타이밍 로직 자체가 검사 대상이므로 스텁을 쓰지 않고 실물을 싣는다.
// 가짜 시계와 가짜 타이머로 실제 시간을 기다리지 않고 진행시킨다.
function loadScheduler({ anchorTop = 100 } = {}) {
  const source = sourceSlice(
    CORE_02,
    'const RENDER_SCROLL_ANCHOR_SETTLE_MS',
    'function renderPreservingMainScroll(',
  );
  let now = 0;
  const timers = [];
  const scroller = { scrollTop: 0 };
  // 카드. `top` 은 **문서상 위치**이고, 화면상 위치는 스크롤을 뺀 값이다.
  // 실제 브라우저가 그렇게 동작한다 — 되밀면 카드가 화면에서 제자리로 돌아온다.
  const node = {
    isConnected: true,
    top: anchorTop,
    getBoundingClientRect() { return { top: this.top - scroller.scrollTop }; },
  };
  const context = vm.createContext({
    Date: { now: () => now },
    Number,
    Math,
    setTimeout: (fn, ms) => { timers.push({ at: now + (Number(ms) || 0), fn }); return timers.length; },
    requestAnimationFrame: fn => { timers.push({ at: now, fn }); return timers.length; },
    mainScrollElement: () => scroller,
    captureRenderScrollAnchors: () => [{ node, top: anchorTop }],
    renderScrollAnchorCorrectionToken: 0,
  });
  vm.runInContext(
    `${source}
     this.schedule = scheduleRenderScrollAnchorCorrection;
     this.afterRender = applyPendingRenderScrollAnchorAfterRender;
     this.cancel = () => { renderScrollAnchorCorrectionToken += 1; };
     this.settleMs = RENDER_SCROLL_ANCHOR_SETTLE_MS;`,
    context,
  );
  const advance = ms => {
    const target = now + ms;
    for (;;) {
      const next = timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1);
      now = Math.max(now, next.at);
      next.fn();
    }
    now = target;
  };
  return { ...context, node, scroller, advance };
}

test('400ms 뒤에 도착한 렌더도 붙잡는다', () => {
  // 이것이 PERF-04 가 전체 실행에서만 실패하던 바로 그 상황이다.
  const h = loadScheduler({ anchorTop: 210 });
  h.schedule();
  h.advance(500);
  assert.equal(h.scroller.scrollTop, 0, '아직 아무 일도 없었으므로 건드리지 않아야 합니다.');

  // 늦은 렌더가 도착해 카드가 398px 밀렸고, 그 렌더가 끝났다.
  h.node.top = 608;
  h.afterRender();
  h.advance(50);
  assert.equal(h.scroller.scrollTop, 398, '400ms 이후에 온 렌더를 놓치면 카드가 밀린 채 남습니다.');
});

test('렌더가 없으면 스크롤을 건드리지 않는다', () => {
  // DB-10(실제 포인터 클릭)을 깨뜨린 원인. 시계로 훑으면 다음 클릭 좌표가 어긋난다.
  const h = loadScheduler({ anchorTop: 210 });
  h.schedule();
  h.advance(500);
  h.node.top = 608;      // 화면이 밀렸지만 render() 는 불리지 않았다
  h.advance(2000);
  assert.equal(h.scroller.scrollTop, 0, '렌더도 없는데 스크롤을 움직이면 포인터 클릭이 빗나갑니다.');
});

test('자리를 잡으면 더 건드리지 않는다', () => {
  // 계속 되밀면 떨림이 생긴다. 움직임이 없으면 멈춰야 한다.
  const h = loadScheduler({ anchorTop: 100 });
  h.schedule();
  h.advance(600);
  const writes = h.scroller.scrollTop;
  h.advance(2000);
  assert.equal(h.scroller.scrollTop, writes, '제자리인데 계속 쓰면 화면이 떨립니다.');
});

test('사람이 스스로 스크롤하면 즉시 그만둔다', () => {
  const h = loadScheduler({ anchorTop: 210 });
  h.schedule();
  h.advance(100);
  h.cancel();                 // wheel/touchmove/키보드 스크롤이 부르는 것과 같다
  h.node.top = 608;
  h.afterRender();
  h.advance(2000);
  assert.equal(h.scroller.scrollTop, 0, '사람이 스크롤한 뒤에 되밀면 보고 있던 곳을 빼앗습니다.');
});

test('무한정 붙잡지 않는다', () => {
  const h = loadScheduler({ anchorTop: 210 });
  assert.ok(h.settleMs >= 1000 && h.settleMs <= 5000, `관찰 시간이 비상식적입니다: ${h.settleMs}`);
  h.schedule();
  h.advance(h.settleMs + 1000);
  h.node.top = 999;           // 관찰 시간이 끝난 뒤의 렌더는
  h.afterRender();
  h.advance(50);
  assert.equal(h.scroller.scrollTop, 0, '한참 뒤의 렌더까지 쫓아가면 엉뚱한 때에 화면이 튑니다.');
});

test('render() 가 이 보정을 실제로 부른다', () => {
  const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  assert.match(
    CORE_03,
    /applyPendingRenderScrollAnchorAfterRender\(\);/,
    'render() 가 안 부르면 늦은 렌더를 영영 못 잡습니다.',
  );
});
