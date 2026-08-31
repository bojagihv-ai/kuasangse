// 계약: **아래로 스크롤해도 왼쪽 메뉴가 따라온다.**
//
// 주인님 2026-08-31: "스크롤을 아래로 내려도 왼쪽메뉴가 따라다녔으면 좋겠어
//                     위로 올라갔다 내려갔다 힘들어"
//
// 왜 안 따라왔나 - 스크롤 컨테이너는 .app(height:100vh;overflow-y:auto)이고 사이드바는 그
// 직계 자식인데, align-self:stretch 가 사이드바를 스크롤 전체 높이만큼 늘려버려
// sticky 가 움직일 자리가 없었다. align-self:flex-start + height:100vh 로 바꿔야 한다.
//
// 좁은 화면(<=900px)에서는 아이콘만 남고 hover 툴팁이 사이드바 바깥에 그려지므로
// overflow 로 잘리면 안 된다 - 그쪽은 overflow:visible 로 되돌려 두었다.
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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'sidebar-follows-scroll-v1.json');

const SCROLL_BY = 900;

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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: `${APP_URL}?sidebarFollowsScroll=v1&t=${Date.now()}` });
  await waitFor(cdp, `!!document.querySelector('.sidebar') && !!document.querySelector('.app')`, 60000);
  await new Promise(resolve => setTimeout(resolve, 1200));

  const measured = await evaluate(cdp, `(() => {
    const app = document.querySelector('.app');
    const sidebar = document.querySelector('.sidebar');
    const style = getComputedStyle(sidebar);
    // 화면이 이미 길지 않으면 스크롤 자체가 없어 검사가 헛돈다. 검사용으로만 늘린다.
    const main = document.querySelector('.main');
    let spacer = null;
    if (app.scrollHeight - app.clientHeight < ${SCROLL_BY} + 400 && main) {
      spacer = document.createElement('div');
      spacer.setAttribute('data-sidebar-scroll-probe', '1');
      spacer.style.height = '3000px';
      main.appendChild(spacer);
    }
    const before = sidebar.getBoundingClientRect();
    const scrollable = app.scrollHeight - app.clientHeight;  // 늘린 뒤의 값
    app.scrollTop = ${SCROLL_BY};
    const appliedScroll = app.scrollTop;
    const after = sidebar.getBoundingClientRect();
    const navItems = sidebar.querySelectorAll('.nav-item');
    const firstNav = navItems[0]?.getBoundingClientRect() || null;
    const lastNav = navItems[navItems.length - 1]?.getBoundingClientRect() || null;
    if (spacer) spacer.remove();
    app.scrollTop = 0;
    return {
      position: style.position,
      alignSelf: style.alignSelf,
      top: style.top,
      overflowY: style.overflowY,
      viewportHeight: window.innerHeight,
      scrollable,
      appliedScroll,
      sidebarHeight: Math.round(before.height),
      beforeTop: Math.round(before.top),
      afterTop: Math.round(after.top),
      afterBottom: Math.round(after.bottom),
      navCount: navItems.length,
      firstNavTop: firstNav ? Math.round(firstNav.top) : null,
      lastNavBottom: lastNav ? Math.round(lastNav.bottom) : null,
      sidebarInnerScrollable: sidebar.scrollHeight - sidebar.clientHeight,
    };
  })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify(measured, null, 2), 'utf8');

  const checks = [
    { ok: measured.position === 'sticky',
      message: `사이드바가 sticky 가 아닙니다: position=${measured.position}` },
    { ok: measured.alignSelf !== 'stretch',
      message: `align-self:stretch 면 사이드바가 스크롤 전체 높이로 늘어나 sticky 가 움직일 자리가 없습니다: ${measured.alignSelf}` },
    { ok: measured.appliedScroll >= SCROLL_BY - 5,
      message: `전제 불성립 - 실제로 ${SCROLL_BY}px 스크롤되지 않았습니다(적용 ${measured.appliedScroll}, 스크롤 가능 ${measured.scrollable})` },
    { ok: measured.afterTop >= -1 && measured.afterTop <= 1,
      message: `스크롤 뒤 사이드바가 화면 위로 밀려났습니다: top ${measured.beforeTop} -> ${measured.afterTop} (0이어야 따라옵니다)` },
    { ok: measured.firstNavTop !== null && measured.firstNavTop >= 0 && measured.firstNavTop < measured.viewportHeight,
      message: `스크롤 뒤 첫 메뉴가 화면 밖입니다: firstNavTop=${measured.firstNavTop}, 화면높이=${measured.viewportHeight}` },
    { ok: measured.lastNavBottom !== null && measured.lastNavBottom <= measured.viewportHeight + 1,
      message: `마지막 메뉴가 화면 아래로 잘려 누를 수 없습니다: lastNavBottom=${measured.lastNavBottom}, 화면높이=${measured.viewportHeight}, 사이드바 내부 스크롤 여유=${measured.sidebarInnerScrollable}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 스크롤 ${measured.appliedScroll}px 뒤에도 왼쪽 메뉴가 제자리(top=${measured.afterTop}) - 증거 ${RESULT_PATH}`);
  return cdp;
}

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
