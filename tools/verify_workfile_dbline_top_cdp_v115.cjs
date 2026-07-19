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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9515';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const REPORT_PATH = path.join(OUT_DIR, 'workfile-dbline-top-v115.json');
const SCREENSHOTS = {
  desktop: path.join(OUT_DIR, 'workfile-dbline-top-desktop-v115.png'),
  scrolled: path.join(OUT_DIR, 'workfile-dbline-top-scrolled-v115.png'),
  mobile: path.join(OUT_DIR, 'workfile-dbline-top-mobile-v115.png'),
  smallHeight: path.join(OUT_DIR, 'workfile-dbline-top-small-height-v115.png'),
};

async function capture(cdp, filePath, fullPage = false) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
  return filePath;
}

async function inspect(cdp, label) {
  return evaluate(cdp, `(async () => {
    const frame = document.querySelector('.global-workfile-frame');
    const bar = document.querySelector('.global-workfile-bar');
    const main = document.querySelector('main.main');
    const container = document.querySelector('.container');
    const byId = id => document.getElementById(id);
    const rectOf = node => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const text = bar ? bar.innerText : '';
    const fullText = document.body ? document.body.innerText : '';
    const buttons = ['saveProjectBtn', 'newProjectBtn', 'exportProjectFileBtn', 'importProjectFileBtn', 'blankWorkBtn', 'saveSnapshotBtn', 'loadProjectBtn']
      .map(id => ({ id, text: byId(id)?.innerText || '', rect: rectOf(byId(id)), visible: !!byId(id) && getComputedStyle(byId(id)).display !== 'none' }));
    const standaloneDbNotices = [...document.querySelectorAll('.db-sync-strip,.notice,.app-notice,.factory-small')]
      .filter(node => /DB 동기화/.test(node.innerText || '') && !node.closest('.global-workfile-bar'))
      .map(node => ({ className: node.className, text: (node.innerText || '').trim().slice(0, 160), rect: rectOf(node) }));
    const apiStrip = document.querySelector('.api-status-wrap,.api-status-strip');
    return {
      label: ${JSON.stringify(label)},
      viewport: { width: innerWidth, height: innerHeight },
      mainFirstChildClass: main?.firstElementChild?.className || '',
      mainRect: rectOf(main),
      frameRect: rectOf(frame),
      barRect: rectOf(bar),
      containerRect: rectOf(container),
      apiStripRect: rectOf(apiStrip),
      barText: text,
      hasCurrentFileLabel: text.includes('현재 작업파일'),
      hasFileName: text.includes('수저집.kuasangse'),
      hasDbSyncInBar: text.includes('DB 동기화 기록 없음') || text.includes('DB 동기화'),
      hasSaveOpenNew: ['저장', '파일로 저장', '파일 불러오기', '새 파일', '불러오기'].every(item => text.includes(item)),
      hasSavedCount: /저장본\\s+\\d+개/.test(text),
      standaloneDbNotices,
      visibleButtons: buttons,
      hasLowerDuplicateWorkfileBox: fullText.includes('작업 문서 저장 · 열기') || fullText.includes('작업 문서 저장'),
      scroll: {
        mainScrollTop: main?.scrollTop || 0,
        mainScrollHeight: main?.scrollHeight || 0,
        mainClientHeight: main?.clientHeight || 0,
        mainScrollWidth: main?.scrollWidth || 0,
        mainClientWidth: main?.clientWidth || 0,
        bodyScrollHeight: document.body?.scrollHeight || 0,
        docClientHeight: document.documentElement?.clientHeight || 0,
      },
      textHasLegacyTopTitle: fullText.includes('DB 동기화: 기록 없음'),
    };
  })()`);
}

async function seedApp(cdp) {
  await evaluate(cdp, `(async () => {
    window.state.step = 'factory';
    window.state.currentProjectName = '수저집';
    window.state.currentProjectId = 'project_visual_dbline_v115';
    window.state.workspaceDocumentDirty = true;
    window.state.productName = '수저집';
    window.state.projectsLoaded = true;
    window.state.projects = [
      { id: 'project_visual_dbline_v115', name: '수저집', snapshotCount: 3, updatedAt: Date.now() },
      { id: 'coin_wallet_v115', name: '띠수네모동전지갑', snapshotCount: 1, updatedAt: Date.now() - 10000 }
    ];
    if (typeof window.normalizeFactoryState === 'function') {
      window.state.factory = window.normalizeFactoryState(window.state.factory || {});
      window.state.factory.product.productName = '수저집';
      window.state.factory.product.userProductName = '수저집';
      window.state.factory.automation.activeTab = 'start';
    }
    if (typeof window.render === 'function') window.render();
    await new Promise(resolve => setTimeout(resolve, 250));
    return true;
  })()`);
}

async function setViewport(cdp, width, height, mobile = false) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
}

function cdpUrlFor(index) {
  const url = new URL(CDP_URL);
  url.port = String(Number(url.port || '9515') + index);
  return url.toString().replace(/\/$/, '');
}

async function runViewport({ label, index, width, height, mobile = false, scrollTop = 0, fullPage = false, screenshot }) {
  const runtime = await ensureCdp(cdpUrlFor(index));
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await setViewport(cdp, width, height, mobile);
    await cdp.send('Page.navigate', { url: `${APP_URL}?workfileDblineTopV115=${Date.now()}-${label}` });
    await waitFor(cdp, '!!(window.state && window.render && document.querySelector(".main"))', 60000);
    await seedApp(cdp);
    await waitFor(cdp, '!!document.querySelector(".global-workfile-bar")', 30000);
    if (scrollTop) {
      await evaluate(cdp, `document.querySelector('main.main').scrollTop = ${Number(scrollTop) || 0}; true`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const inspection = await inspect(cdp, label);
    await capture(cdp, screenshot, fullPage);
    return inspection;
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    ok: false,
    url: APP_URL,
    cdpUrl: CDP_URL,
    screenshots: SCREENSHOTS,
    checks: [],
    inspections: {},
  };
  try {
    report.inspections.desktop = await runViewport({
      label: 'desktop',
      index: 0,
      width: 1440,
      height: 900,
      screenshot: SCREENSHOTS.desktop,
    });
    report.inspections.scrolled = await runViewport({
      label: 'scrolled',
      index: 1,
      width: 1440,
      height: 900,
      scrollTop: 480,
      screenshot: SCREENSHOTS.scrolled,
    });
    report.inspections.mobile = await runViewport({
      label: 'mobile',
      index: 2,
      width: 390,
      height: 760,
      mobile: true,
      fullPage: true,
      screenshot: SCREENSHOTS.mobile,
    });
    report.inspections.smallHeight = await runViewport({
      label: 'smallHeight',
      index: 3,
      width: 900,
      height: 420,
      fullPage: true,
      screenshot: SCREENSHOTS.smallHeight,
    });

    const checks = [
      {
        ok: report.inspections.desktop.mainFirstChildClass === 'global-workfile-frame',
        message: '작업파일 바가 main의 첫 요소가 아닙니다.',
      },
      {
        ok: report.inspections.desktop.frameRect?.top === 0 && report.inspections.desktop.barRect?.top === 0,
        message: '작업파일 바가 화면 맨 위 0px에 붙지 않았습니다.',
      },
      {
        ok: report.inspections.desktop.hasCurrentFileLabel && report.inspections.desktop.hasFileName,
        message: '현재 작업파일/수저집.kuasangse 표시가 없습니다.',
      },
      {
        ok: report.inspections.desktop.hasDbSyncInBar,
        message: 'DB 동기화 상태가 작업파일 바 안에 없습니다.',
      },
      {
        ok: report.inspections.desktop.hasSaveOpenNew,
        message: '저장/파일로 저장/파일 불러오기/새 파일/불러오기 컨트롤이 모두 보이지 않습니다.',
      },
      {
        ok: report.inspections.desktop.standaloneDbNotices.length === 0,
        message: '작업파일 바 밖에 별도 DB 동기화 줄이 남아 있습니다.',
      },
      {
        ok: !report.inspections.desktop.hasLowerDuplicateWorkfileBox,
        message: '조립공장 저장 목록 안에 옛 작업 문서 저장/열기 박스가 남아 있습니다.',
      },
      {
        ok: report.inspections.scrolled.frameRect?.top === 0 && report.inspections.scrolled.barRect?.top === 0,
        message: '스크롤 후 작업파일 바가 상단 고정되지 않았습니다.',
      },
      {
        ok: report.inspections.mobile.hasFileName && report.inspections.mobile.hasSaveOpenNew,
        message: '모바일 폭에서 파일명/주요 컨트롤이 보이지 않습니다.',
      },
      {
        ok: report.inspections.mobile.scroll.mainScrollWidth <= report.inspections.mobile.scroll.mainClientWidth + 1,
        message: '모바일 폭에서 수평 잘림이 발생했습니다.',
      },
      {
        ok: report.inspections.smallHeight.scroll.mainScrollHeight > report.inspections.smallHeight.scroll.mainClientHeight,
        message: '작은 높이에서 main 세로 스크롤이 생기지 않았습니다.',
      },
      {
        ok: report.inspections.smallHeight.hasSaveOpenNew,
        message: '작은 높이에서 파일 저장/열기/새 파일 컨트롤이 도달 불가입니다.',
      },
      {
        ok: !report.inspections.desktop.textHasLegacyTopTitle,
        message: '기존 “DB 동기화: 기록 없음” 제목 줄이 아직 남아 있습니다.',
      },
    ];
    report.checks = checks;
    assertChecks(checks);
    report.ok = true;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, screenshots: SCREENSHOTS }, null, 2));
  } catch (error) {
    report.error = error?.stack || error?.message || String(error);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    throw error;
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
