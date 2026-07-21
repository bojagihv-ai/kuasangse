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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9518';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const REPORT_PATH = path.join(OUT_DIR, 'top-command-row-v118.json');
const SCREENSHOTS = {
  desktop: path.join(OUT_DIR, 'top-command-row-v118-desktop.png'),
  smallHeight: path.join(OUT_DIR, 'top-command-row-v118-small-height.png'),
  tiny: path.join(OUT_DIR, 'top-command-row-v118-tiny.png'),
};
const WORKFILE_NAME = '슬라브나비수저집';
const WORKFILE_FILE_NAME = `${WORKFILE_NAME}.kuasangse`;

async function capture(cdp, filePath) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function seedFactory(cdp) {
  await evaluate(cdp, `(async () => {
    window.state.step = 'factory';
    window.state.currentProjectName = ${JSON.stringify(WORKFILE_NAME)};
    window.state.currentProjectId = 'project_top_command_row_v118';
    window.state.workspaceDocumentDirty = false;
    window.state.productName = ${JSON.stringify(WORKFILE_NAME)};
    window.state.projectsLoaded = true;
    window.state.projects = [
      { id: 'project_top_command_row_v118', name: ${JSON.stringify(WORKFILE_NAME)}, snapshotCount: 3, updatedAt: Date.now() },
      { id: 'wallet_top_command_row_v118', name: '띠수네모동전지갑', snapshotCount: 1, updatedAt: Date.now() - 10000 }
    ];
    if (typeof window.normalizeFactoryState === 'function') {
      window.state.factory = window.normalizeFactoryState(window.state.factory || {});
      window.state.factory.product.productName = ${JSON.stringify(WORKFILE_NAME)};
      window.state.factory.product.userProductName = ${JSON.stringify(WORKFILE_NAME)};
      window.state.factory.automation.activeTab = 'start';
    }
    if (typeof window.render === 'function') window.render();
    await new Promise(resolve => setTimeout(resolve, 300));
    return true;
  })()`);
}

async function inspect(cdp, label) {
  return evaluate(cdp, `(async () => {
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
    const main = document.querySelector('main.main');
    const scrollRoot = document.querySelector('.app');
    const row = document.querySelector('.top-command-row');
    const db = document.querySelector('.db-workfile-strip');
    const dbSync = document.querySelector('.db-workfile-sync');
    const fileName = document.querySelector('.db-workfile-name');
    const api = document.querySelector('.top-command-row .api-status-wrap');
    const apiStrip = document.querySelector('.top-command-row .api-status-strip');
    const container = document.querySelector('.container');
    const firstChild = main?.firstElementChild;
    const ids = ['blankWorkBtn', 'saveCurrentProjectFileBtn', 'saveProjectFileAsBtn', 'importProjectFileBtn'];
    const buttons = ids.map(id => {
      const node = document.getElementById(id);
      return {
        id,
        text: node?.innerText || '',
        rect: rectOf(node),
        visible: !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0,
        inTopRow: !!node?.closest('.top-command-row'),
      };
    });
    return {
      label: ${JSON.stringify(label)},
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      viewport: { width: innerWidth, height: innerHeight },
      mainFirstChildClass: firstChild?.className || '',
      mainRect: rectOf(main),
      rowRect: rectOf(row),
      dbRect: rectOf(db),
      dbSyncRect: rectOf(dbSync),
      fileNameRect: rectOf(fileName),
      fileNameText: fileName?.textContent?.trim() || '',
      fileNameClientWidth: fileName?.clientWidth || 0,
      fileNameScrollWidth: fileName?.scrollWidth || 0,
      fileNameClientHeight: fileName?.clientHeight || 0,
      fileNameScrollHeight: fileName?.scrollHeight || 0,
      fileNameWhiteSpace: fileName ? getComputedStyle(fileName).whiteSpace : '',
      apiRect: rectOf(api),
      apiStripRect: rectOf(apiStrip),
      containerRect: rectOf(container),
      rowText: row?.innerText || '',
      dbText: db?.innerText || '',
      apiText: api?.innerText || '',
      buttons,
      topDeltaDbApi: db && api ? Math.abs(Math.round(db.getBoundingClientRect().top) - Math.round(api.getBoundingClientRect().top)) : null,
      topDeltaDbSyncApi: dbSync && apiStrip ? Math.abs(Math.round(dbSync.getBoundingClientRect().top) - Math.round(apiStrip.getBoundingClientRect().top)) : null,
      mainOverflowX: main ? main.scrollWidth - main.clientWidth : 0,
      mainScrollable: !!scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight,
      rowPosition: row ? getComputedStyle(row).position : '',
      hasLegacyGlobalWorkfileBar: !!document.querySelector('.global-workfile-bar'),
      bodyHasOldStandaloneTopBeforeRow: (() => {
        const nodes = [...document.querySelectorAll('main.main > *')];
        const rowIndex = nodes.findIndex(node => node.classList.contains('top-command-row'));
        return nodes.slice(0, rowIndex).some(node => /DB 동기화/.test(node.innerText || ''));
      })(),
    };
  })()`);
}

async function runViewport(label, width, height, screenshotPath, cdpOffset) {
  const url = new URL(CDP_URL);
  url.port = String(Number(url.port || '9518') + cdpOffset);
  const runtime = await ensureCdp(url.toString().replace(/\/$/, ''));
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await setViewport(cdp, width, height);
    await cdp.send('Page.navigate', { url: `${APP_URL}?topCommandRowV118=${Date.now()}-${label}` });
    await waitFor(cdp, '!!(window.state && window.render && document.querySelector("main.main"))', 60000);
    await seedFactory(cdp);
    await waitFor(cdp, '!!document.querySelector(".top-command-row .db-workfile-strip")', 30000);
    const inspection = await inspect(cdp, label);
    await capture(cdp, screenshotPath);
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
    screenshots: SCREENSHOTS,
    inspections: {},
    checks: [],
  };
  try {
    report.inspections.desktop = await runViewport('desktop', 1440, 900, SCREENSHOTS.desktop, 0);
    report.inspections.smallHeight = await runViewport('smallHeight', 1280, 520, SCREENSHOTS.smallHeight, 1);
    report.inspections.tiny = await runViewport('tiny', 375, 320, SCREENSHOTS.tiny, 2);
    const desktop = report.inspections.desktop;
    const smallHeight = report.inspections.smallHeight;
    const tiny = report.inspections.tiny;
    const requiredTexts = ['DB 동기화: 기록 없음', WORKFILE_FILE_NAME, '새 작업', '현재 상태 저장', '다른 이름으로 저장', '작업파일 불러오기', '연결 API'];
    const checks = [
      {
        ok: /v198$/.test(desktop.buildId),
        message: `새 빌드 ID가 아닙니다: ${desktop.buildId}`,
      },
      {
        ok: desktop.mainFirstChildClass === 'top-command-row',
        message: `main 첫 자식이 top-command-row가 아닙니다: ${desktop.mainFirstChildClass}`,
      },
      {
        ok: desktop.rowRect?.top === 0,
        message: `top-command-row가 화면 맨위 0px가 아닙니다: ${desktop.rowRect?.top}`,
      },
      {
        ok: desktop.dbRect?.top === desktop.rowRect?.top,
        message: `작업파일 바가 상단 행의 시작점과 다릅니다: db=${desktop.dbRect?.top}, row=${desktop.rowRect?.top}`,
      },
      {
        ok: desktop.apiRect?.top === desktop.rowRect?.top,
        message: `연결 API가 상단 행의 시작점과 다릅니다: api=${desktop.apiRect?.top}, row=${desktop.rowRect?.top}`,
      },
      {
        ok: desktop.topDeltaDbApi !== null && desktop.topDeltaDbApi <= 2,
        message: `작업파일 바와 연결 API top 좌표 차이가 큽니다: ${desktop.topDeltaDbApi}`,
      },
      {
        ok: requiredTexts.every(text => desktop.rowText.includes(text)),
        message: `상단 행 필수 문구 누락: ${requiredTexts.filter(text => !desktop.rowText.includes(text)).join(', ')}`,
      },
      {
        ok: desktop.dbSyncRect?.width >= 120 && desktop.dbSyncRect?.height <= 24,
        message: `DB 동기화 문구가 한 줄로 보이지 않습니다: ${JSON.stringify(desktop.dbSyncRect)}`,
      },
      {
        ok: desktop.fileNameText === WORKFILE_FILE_NAME
          && desktop.fileNameScrollWidth <= desktop.fileNameClientWidth + 1
          && desktop.fileNameScrollHeight <= desktop.fileNameClientHeight + 1,
        message: `현재 작업파일명이 잘렸습니다: ${JSON.stringify({
          text: desktop.fileNameText,
          clientWidth: desktop.fileNameClientWidth,
          scrollWidth: desktop.fileNameScrollWidth,
          clientHeight: desktop.fileNameClientHeight,
          scrollHeight: desktop.fileNameScrollHeight,
          whiteSpace: desktop.fileNameWhiteSpace,
        })}`,
      },
      {
        ok: desktop.buttons.every(button => button.visible && button.inTopRow),
        message: `작업파일 버튼이 모두 맨위 줄 안에 있지 않습니다: ${JSON.stringify(desktop.buttons)}`,
      },
      {
        ok: desktop.mainOverflowX <= 2,
        message: `상단 줄이 가로로 넘칩니다: overflow=${desktop.mainOverflowX}`,
      },
      {
        ok: !desktop.hasLegacyGlobalWorkfileBar,
        message: '예전 global-workfile-bar가 아직 남아 있습니다.',
      },
      {
        ok: !desktop.bodyHasOldStandaloneTopBeforeRow,
        message: 'top-command-row 앞에 DB 동기화 문구가 남아 있습니다.',
      },
      {
        ok: smallHeight.mainFirstChildClass === 'top-command-row' && smallHeight.rowRect?.top === 0,
        message: `작은 높이에서도 맨위가 아닙니다: ${JSON.stringify({ first: smallHeight.mainFirstChildClass, top: smallHeight.rowRect?.top })}`,
      },
      {
        ok: tiny.rowPosition === 'static' && tiny.mainScrollable && tiny.buttons.every(button => button.visible && button.inTopRow),
        message: `375x320에서 상단 명령이 본문을 가리거나 접근 불가합니다: ${JSON.stringify({ position: tiny.rowPosition, scrollable: tiny.mainScrollable, buttons: tiny.buttons })}`,
      },
    ];
    report.checks = checks;
    assertChecks(checks);
    report.ok = true;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
      ok: true,
      reportPath: REPORT_PATH,
      screenshots: SCREENSHOTS,
      desktop: {
        buildId: desktop.buildId,
        mainFirstChildClass: desktop.mainFirstChildClass,
        rowTop: desktop.rowRect?.top,
        dbTop: desktop.dbRect?.top,
        apiTop: desktop.apiRect?.top,
        topDeltaDbApi: desktop.topDeltaDbApi,
        rowText: desktop.rowText,
      },
      smallHeight: {
        rowTop: smallHeight.rowRect?.top,
        dbTop: smallHeight.dbRect?.top,
        apiTop: smallHeight.apiRect?.top,
      },
    }, null, 2));
  } catch (err) {
    report.error = err.stack || String(err);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    throw err;
  }
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
