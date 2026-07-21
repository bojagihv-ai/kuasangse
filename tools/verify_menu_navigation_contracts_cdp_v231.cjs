const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = process.env.KUASANGSE_MENU_EVIDENCE_DIR
  ? path.resolve(ROOT, process.env.KUASANGSE_MENU_EVIDENCE_DIR)
  : path.join(ROOT, '.omo', 'evidence', 'kuasangse-menu-modularization', 'task-1');
const REPORT_PATH = path.join(EVIDENCE_DIR, 'browser.json');
const CLEANUP_PATH = path.join(EVIDENCE_DIR, 'cleanup.txt');
const VIEWPORTS = process.env.KUASANGSE_MENU_SINGLE_VIEWPORT
  ? [(() => {
      const [width, height] = process.env.KUASANGSE_MENU_SINGLE_VIEWPORT.split('x').map(Number);
      return { label: 'single', width, height };
    })()]
  : [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'short', width: 1280, height: 620 },
  { label: 'narrow', width: 535, height: 697 },
  ];
const ROUTES = [
  ['upload', '이미지 업로드'],
  ['analyzing', 'AI 분석'],
  ['competitor', '경쟁사 분석'],
  ['sections', '섹션 설정'],
  ['generating', '자동 생성'],
  ['preview', '미리보기'],
  ['imagecuts', '이미지컷 생성'],
  ['optionsorter', '옵션 분류기'],
  ['factory', '조립공장'],
  ['automation', '자동화'],
  ['modelsettings', '모델 설정'],
  ['manual', '상세페이지 자동화 설명서'],
];
const FACTORY_TABS = [
  ['start', '시작'],
  ['db', 'DB 확정'],
  ['fields', '필수값'],
  ['competitor', '경쟁사'],
  ['assets', '생성컷 선택'],
  ['sections', '섹션 생성'],
  ['publish', '전송'],
];

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'app.html';
      const file = path.resolve(ROOT, relative);
      const rootPrefix = `${ROOT}${path.sep}`.toLowerCase();
      if (file.toLowerCase() !== ROOT.toLowerCase() && !file.toLowerCase().startsWith(rootPrefix)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end('not found');
        return;
      }
      const body = fs.readFileSync(file);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': body.length,
        'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'last-modified': fs.statSync(file).mtime.toUTCString(),
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch (error) {
      response.writeHead(500).end(String(error?.message || error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function stopStaticServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await Promise.race([
    new Promise(resolve => server.close(resolve)),
    delay(3000),
  ]);
}

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function pngInfo(file) {
  const buffer = fs.readFileSync(file);
  return {
    signature: buffer.subarray(0, 8).toString('hex'),
    valid: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

async function capture(cdp, file) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  fs.writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
  return pngInfo(file);
}

function pidAlive(pid) {
  if (!Number(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

const INSTRUMENTATION_SOURCE = `(() => {
  const handlerIds = new WeakMap();
  const active = new Set();
  let nextHandlerId = 1;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  const nativeWarn = console.warn.bind(console);
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.map(value => value?.stack || value?.message || String(value)).join(' | '));
    nativeWarn(...args);
  };
  const optionCapture = options => typeof options === 'boolean' ? options : !!options?.capture;
  const keyFor = (target, type, handler, options) => {
    if ((typeof handler !== 'function' && (typeof handler !== 'object' || handler === null))) return '';
    if (!handlerIds.has(handler)) handlerIds.set(handler, nextHandlerId++);
    const targetName = target === window ? 'window' : target === document ? 'document' : '';
    return targetName ? [targetName, type, optionCapture(options), handlerIds.get(handler)].join('|') : '';
  };
  EventTarget.prototype.addEventListener = function(type, handler, options) {
    const key = keyFor(this, type, handler, options);
    if (key) active.add(key);
    return nativeAdd.call(this, type, handler, options);
  };
  EventTarget.prototype.removeEventListener = function(type, handler, options) {
    const key = keyFor(this, type, handler, options);
    if (key) active.delete(key);
    return nativeRemove.call(this, type, handler, options);
  };
  window.__MENU_QA__ = {
    active,
    warnings,
    blockedExternalRequests: 0,
    saveCounts: { savePersistentState: 0, scheduleLastWorkSave: 0, saveLastWorkNow: 0 },
    saveHooks: {},
    globalListenerSnapshot() {
      return { count: active.size, keys: Array.from(active).sort() };
    },
  };
})();`;

async function clickSelector(cdp, selector) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const token = `menu-qa-click-${Date.now()}-${attempt}`;
    const point = await evaluate(cdp, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      node.dataset.menuQaClickToken = ${JSON.stringify(token)};
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        disabled: !!node.disabled,
        display: style.display,
        visibility: style.visibility,
        targetTag: node.tagName,
        targetText: node.textContent?.trim().slice(0, 80) || '',
        hitTag: hit?.tagName || '',
        hitText: hit?.textContent?.trim().slice(0, 80) || '',
        hitMatches: hit === node || node.contains(hit),
      };
    })()`);
    if (!point || point.disabled || point.width <= 0 || point.height <= 0 || point.display === 'none' || point.visibility === 'hidden') {
      throw new Error(`click target unavailable: ${selector} ${JSON.stringify(point)}`);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    const stable = await evaluate(cdp, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.dataset.menuQaClickToken !== ${JSON.stringify(token)}) return false;
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === node || node.contains(hit);
    })()`);
    if (!stable) {
      await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(resolve))');
      continue;
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    return { ...point, attempts: attempt };
  }
  throw new Error(`click target kept rerendering: ${selector}`);
}

async function inspectLayout(cdp) {
  return evaluate(cdp, `(() => {
    const scrollRoot = document.querySelector('.app');
    const main = document.querySelector('main.main');
    const sidebar = document.querySelector('.sidebar');
    if (!scrollRoot || !main || !sidebar) return { ok: false, reason: 'shell layout missing' };
    const originalScrollTop = scrollRoot.scrollTop;
    const maxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
    scrollRoot.scrollTop = maxScrollTop;
    const reachedBottom = maxScrollTop <= 1 || Math.abs(scrollRoot.scrollTop - maxScrollTop) <= 2;
    scrollRoot.scrollTop = originalScrollTop;
    const scrollRootStyle = getComputedStyle(scrollRoot);
    const mainStyle = getComputedStyle(main);
    const sidebarStyle = getComputedStyle(sidebar);
    const mainRect = main.getBoundingClientRect();
    const rootOverflow = Math.max(
      0,
      document.documentElement.scrollWidth - innerWidth,
      document.body?.scrollWidth - innerWidth || 0,
      main.scrollWidth - main.clientWidth,
    );
    const sidebarIndependentScroll = sidebar.scrollHeight > sidebar.clientHeight + 2
      && /auto|scroll/.test(sidebarStyle.overflowY);
    return {
      ok: rootOverflow <= 2
        && reachedBottom
        && /auto|scroll/.test(scrollRootStyle.overflowY)
        && !sidebarIndependentScroll,
      viewport: { width: innerWidth, height: innerHeight },
      rootOverflow,
      reachedBottom,
      sidebarIndependentScroll,
      overflowCandidates: Array.from(main.querySelectorAll('*'))
        .map(node => {
          const rect = node.getBoundingClientRect();
          return {
            tag: node.tagName,
            id: node.id || '',
            className: typeof node.className === 'string' ? node.className.slice(0, 180) : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        })
        .filter(item => item.width > 0 && (item.right > mainRect.right + 2 || item.left < mainRect.left - 2))
        .sort((left, right) => (right.right - mainRect.right) - (left.right - mainRect.right))
        .slice(0, 8),
      main: {
        clientHeight: main.clientHeight,
        scrollHeight: main.scrollHeight,
        clientWidth: main.clientWidth,
        scrollWidth: main.scrollWidth,
        overflowY: mainStyle.overflowY,
        right: Math.round(main.getBoundingClientRect().right),
      },
      scrollRoot: {
        clientHeight: scrollRoot.clientHeight,
        scrollHeight: scrollRoot.scrollHeight,
        overflowY: scrollRootStyle.overflowY,
        right: Math.round(scrollRoot.getBoundingClientRect().right),
      },
      sidebar: {
        clientHeight: sidebar.clientHeight,
        scrollHeight: sidebar.scrollHeight,
        overflowY: sidebarStyle.overflowY,
      },
    };
  })()`);
}

async function setupPage(cdp, appUrl, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: `${appUrl}?menuContract=v231-${viewport.label}-${Date.now()}` });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryRuntimeReadFactory && document.querySelector(".sidebar"))', 60000);
  await evaluate(cdp, `(() => {
    window.startCafe24OAuthAutoRefresh = () => {};
    window.factoryStartCafe24OAuthAutoRefresh = () => {};
    return true;
  })()`);
  await delay(1800);
  await evaluate(cdp, `(() => {
    state.showApiModal = false;
    state.error = null;
    state.uiNotice = null;
    state.analysis = null;
    state.sectionContents = {};
    state.currentProjectId = '';
    state.currentProjectName = '메뉴 계약 검증';
    state.productName = '메뉴 계약 검증';
    const factory = normalizeFactoryState({});
    factory.currentProjectId = '';
    factory.workspace = { ...(factory.workspace || {}), id: '' };
    factory.product.productName = '메뉴 계약 검증';
    factory.product.userProductName = '메뉴 계약 검증';
    factory.automation.activeTab = 'start';
    factoryRuntimeReplaceFactorySnapshot(factory, { reason: 'menu-qa-bootstrap' });
    for (const name of Object.keys(window.__MENU_QA__.saveCounts)) {
      const original = window[name];
      window.__MENU_QA__.saveHooks[name] = typeof original === 'function';
      if (typeof original === 'function') {
        window[name] = function menuQaSaveCounter() {
          window.__MENU_QA__.saveCounts[name] += 1;
          return undefined;
        };
      }
    }
    window.factoryStartCafe24OAuthAutoRefresh = () => {};
    render();
    return true;
  })()`);
  await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function inspectStaticContracts(cdp) {
  return evaluate(cdp, `(() => {
    const routes = Array.from(document.querySelectorAll('.sidebar [data-nav]')).map(node => ({
      id: node.dataset.nav,
      label: node.querySelector('.nav-label')?.textContent?.trim() || '',
      blocked: node.classList.contains('blocked'),
      ariaLabel: node.getAttribute('aria-label') || '',
    }));
    const top = document.querySelector('.top-command-row');
    const topIds = ['blankWorkBtn', 'saveCurrentProjectFileBtn', 'saveProjectFileAsBtn', 'importProjectFileBtn'];
    return {
      routes,
      top: {
        firstMainChild: document.querySelector('main.main')?.firstElementChild?.className || '',
        hasStrip: !!top?.querySelector('.db-workfile-strip'),
        hasLegacyBar: !!document.querySelector('.global-workfile-bar'),
        text: top?.innerText || '',
        controls: topIds.map(id => {
          const node = document.getElementById(id);
          const rect = node?.getBoundingClientRect();
          const mainRect = document.querySelector('main.main')?.getBoundingClientRect();
          return {
            id,
            text: node?.textContent?.trim() || '',
            inTop: !!node?.closest('.top-command-row'),
            visible: !!rect && rect.width > 0 && rect.height > 0,
            fullyReachable: !!rect && !!mainRect && rect.left >= mainRect.left - 1 && rect.right <= mainRect.right + 1,
            left: rect?.left || 0,
            right: rect?.right || 0,
            mainLeft: mainRect?.left || 0,
            mainRight: mainRect?.right || 0,
          };
        }),
      },
      listeners: window.__MENU_QA__.globalListenerSnapshot(),
      saveHooks: { ...window.__MENU_QA__.saveHooks },
    };
  })()`);
}

async function clickRoutes(cdp) {
  const visits = [];
  for (const [id] of ROUTES) {
    await clickSelector(cdp, `[data-nav="${id}"]`);
    const outcome = await evaluate(cdp, `(() => ({
      requested: ${JSON.stringify(id)},
      activeStep: state.step,
      notice: state.uiNotice?.message || '',
      blocked: document.querySelector('[data-nav="${id}"]')?.classList.contains('blocked') || false,
      activeNav: document.querySelector('.sidebar [data-nav].active')?.dataset.nav || '',
    }))()`);
    outcome.layout = await inspectLayout(cdp);
    visits.push(outcome);
  }
  return visits;
}

async function exerciseManualPrimaryAction(cdp, viewport) {
  await clickSelector(cdp, '.sidebar [data-nav="manual"]');
  const before = await evaluate(cdp, `(() => {
    const button = document.querySelector('.container [data-manual-nav="analyzing"]');
    const rect = button?.getBoundingClientRect();
    return {
      activeStep: state.step,
      title: document.querySelector('.container .page-title')?.textContent?.trim() || '',
      buttonText: button?.textContent?.trim() || '',
      buttonReachable: !!rect && rect.width > 0 && rect.height > 0,
    };
  })()`);
  const layout = await inspectLayout(cdp);
  const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}-manual.png`);
  const png = await capture(cdp, screenshotPath);
  await clickSelector(cdp, '.container [data-manual-nav="analyzing"]');
  const after = await evaluate(cdp, `({ activeStep: state.step, activeNav: document.querySelector('.sidebar [data-nav].active')?.dataset.nav || '' })`);
  return { before, after, layout, screenshotPath, png };
}

async function exerciseModelSettingsPrimaryAction(cdp, viewport) {
  await clickSelector(cdp, '.sidebar [data-nav="modelsettings"]');
  const before = await evaluate(cdp, `(() => {
    const saveButton = document.getElementById('saveModelSettings');
    const rect = saveButton?.getBoundingClientRect();
    return {
      activeStep: state.step,
      title: document.querySelector('.container .page-title')?.textContent?.trim() || '',
      saveReachable: !!rect && rect.width > 0 && rect.height > 0,
      imageSizeMode: state.modelConfig?.imageSizeMode || '',
    };
  })()`);
  await clickSelector(cdp, '#imgSizeModeCustom');
  await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 400))');
  const custom = await evaluate(cdp, `({
    activeStep: state.step,
    imageSizeMode: state.modelConfig?.imageSizeMode || '',
    widthEnabled: !document.getElementById('imgWidthInput')?.disabled,
    settledOpacity: Number.parseFloat(getComputedStyle(document.querySelector('.container .fade-in')).opacity || '0'),
  })`);
  const layout = await inspectLayout(cdp);
  const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}-modelsettings.png`);
  const png = await capture(cdp, screenshotPath);
  await clickSelector(cdp, '#imgSizeModeAuto');
  const restored = await evaluate(cdp, `({
    activeStep: state.step,
    imageSizeMode: state.modelConfig?.imageSizeMode || '',
  })`);
  return { before, custom, restored, layout, screenshotPath, png };
}

async function exerciseAutomationPrimaryAction(cdp, viewport) {
  await clickSelector(cdp, '.sidebar [data-nav="automation"]');
  const prepared = await evaluate(cdp, `(() => {
    const original = { connected: !!state.auto.driveConnected, intervalMin: state.auto.intervalMin };
    state.auto.driveConnected = true;
    render();
    const slider = document.getElementById('intervalSlider');
    const rect = slider?.getBoundingClientRect();
    window.__MENU_QA_AUTOMATION_ORIGINAL__ = original;
    return {
      activeStep: state.step,
      title: document.querySelector('.container .page-title')?.textContent?.trim() || '',
      sliderReachable: !!rect && rect.width > 0 && rect.height > 0,
      originalInterval: original.intervalMin,
    };
  })()`);
  const changed = await evaluate(cdp, `(() => {
    const slider = document.getElementById('intervalSlider');
    slider.value = '15';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      activeStep: state.step,
      intervalMin: state.auto.intervalMin,
      persisted: localStorage.getItem('auto_interval'),
      display: document.getElementById('intervalDisplay')?.textContent?.trim() || '',
    };
  })()`);
  const layout = await inspectLayout(cdp);
  await evaluate(cdp, `(() => {
    const scrollRoot = document.querySelector('.app');
    if (scrollRoot) scrollRoot.scrollTop = 0;
    window.scrollTo(0, 0);
    return true;
  })()`);
  const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}-automation.png`);
  const png = await capture(cdp, screenshotPath);
  const restored = await evaluate(cdp, `(() => {
    const original = window.__MENU_QA_AUTOMATION_ORIGINAL__;
    const slider = document.getElementById('intervalSlider');
    slider.value = String(original.intervalMin);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    state.auto.driveConnected = original.connected;
    render();
    delete window.__MENU_QA_AUTOMATION_ORIGINAL__;
    return { activeStep: state.step, intervalMin: state.auto.intervalMin, connected: state.auto.driveConnected };
  })()`);
  return { prepared, changed, restored, layout, screenshotPath, png };
}

async function exerciseImageCutsPrimaryAction(cdp, viewport) {
  await clickSelector(cdp, '.sidebar [data-nav="imagecuts"]');
  const prepared = await evaluate(cdp, `(() => {
    state.cuts.runBusy = false;
    for (const prompt of state.cuts.prompts || []) prompt.generating = false;
    const originalCount = state.cuts.promptSlotCount || state.cuts.prompts?.length || 4;
    const delta = originalCount < 30 ? 1 : -1;
    window.__MENU_QA_CUTS_ORIGINAL__ = { originalCount, delta };
    render();
    const button = document.querySelector('[data-cut-slot-delta="' + delta + '"]');
    const rect = button?.getBoundingClientRect();
    return {
      activeStep: state.step,
      title: document.querySelector('.container .page-title')?.textContent?.trim() || '',
      originalCount,
      delta,
      buttonReachable: !!rect && rect.width > 0 && rect.height > 0 && !button.disabled,
      containerText: document.querySelector('.container')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '',
      activeNav: document.querySelector('.sidebar [data-nav].active')?.dataset.nav || '',
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      loadErrors: window.__KUASANGSE_LOAD_ERRORS__ || [],
    };
  })()`);
  if (!prepared.buttonReachable) throw new Error(`imagecuts primary control unavailable: ${JSON.stringify(prepared)}`);
  await clickSelector(cdp, `[data-cut-slot-delta="${prepared.delta}"]`);
  await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 150))');
  const changed = await evaluate(cdp, `({
    activeStep: state.step,
    promptSlotCount: state.cuts.promptSlotCount,
    promptLength: state.cuts.prompts?.length || 0,
    promptInputCount: document.querySelectorAll('[data-cut-prompt]').length,
  })`);
  const layout = await inspectLayout(cdp);
  await evaluate(cdp, `(() => {
    const scrollRoot = document.querySelector('.app');
    if (scrollRoot) scrollRoot.scrollTop = 0;
    window.scrollTo(0, 0);
    return true;
  })()`);
  const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}-imagecuts.png`);
  const png = await capture(cdp, screenshotPath);
  await clickSelector(cdp, `[data-cut-slot-delta="${-prepared.delta}"]`);
  await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 150))');
  const restored = await evaluate(cdp, `(() => {
    const original = window.__MENU_QA_CUTS_ORIGINAL__;
    delete window.__MENU_QA_CUTS_ORIGINAL__;
    return {
      activeStep: state.step,
      promptSlotCount: state.cuts.promptSlotCount,
      promptLength: state.cuts.prompts?.length || 0,
      originalCount: original.originalCount,
    };
  })()`);
  return { prepared, changed, restored, layout, screenshotPath, png };
}

async function exerciseOptionSorterPrimaryAction(cdp, viewport) {
  await clickSelector(cdp, '.sidebar [data-nav="optionsorter"]');
  const prepared = await evaluate(cdp, `(() => {
    ensureOptionSorterDefaults(state.optionSorter);
    state.optionSorter.subStep = 'input';
    const originalCount = state.optionSorter.slots.length;
    window.__MENU_QA_OPTIONS_ORIGINAL__ = { originalCount };
    render();
    const button = document.getElementById('optAddSlotInput');
    const rect = button?.getBoundingClientRect();
    return {
      activeStep: state.step,
      title: document.querySelector('.container .page-title')?.textContent?.trim() || '',
      originalCount,
      buttonReachable: !!rect && rect.width > 0 && rect.height > 0 && !button.disabled,
      containerText: document.querySelector('.container')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '',
      activeNav: document.querySelector('.sidebar [data-nav].active')?.dataset.nav || '',
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      loadErrors: window.__KUASANGSE_LOAD_ERRORS__ || [],
    };
  })()`);
  if (!prepared.buttonReachable) throw new Error(`optionsorter primary control unavailable: ${JSON.stringify(prepared)}`);
  await clickSelector(cdp, '#optAddSlotInput');
  await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 150))');
  const changed = await evaluate(cdp, `(() => {
    const last = state.optionSorter.slots.at(-1) || {};
    return {
      activeStep: state.step,
      slotCount: state.optionSorter.slots.length,
      addedSlotId: last.id || '',
      renderedSlotCount: document.querySelectorAll('[data-slot-name]').length,
      deleteHandler: typeof document.querySelector('[data-slot-del-input="' + last.id + '"]')?.onclick,
    };
  })()`);
  const layout = await inspectLayout(cdp);
  await evaluate(cdp, `(() => {
    const scrollRoot = document.querySelector('.app');
    if (scrollRoot) scrollRoot.scrollTop = 0;
    window.scrollTo(0, 0);
    return true;
  })()`);
  const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}-optionsorter.png`);
  const png = await capture(cdp, screenshotPath);
  const deleteClick = await clickSelector(cdp, `[data-slot-del-input="${changed.addedSlotId}"]`);
  await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 150))');
  const restored = await evaluate(cdp, `(() => {
    const original = window.__MENU_QA_OPTIONS_ORIGINAL__;
    delete window.__MENU_QA_OPTIONS_ORIGINAL__;
    return {
      activeStep: state.step,
      slotCount: state.optionSorter.slots.length,
      originalCount: original.originalCount,
    };
  })()`);
  return { prepared, changed, deleteClick, restored, layout, screenshotPath, png };
}

async function exerciseTaskSixDomainActions(cdp) {
  const upload = await evaluate(cdp, `(async () => {
    state.analysisImages = [];
    state.imagePreview = null;
    state.step = 'upload';
    await render();
    const button = document.getElementById('startAnalysis');
    return {
      activeStep: state.step,
      title: document.querySelector('.container .page-title')?.textContent?.trim() || '',
      buttonPresent: !!button,
      disabledWithoutImage: !!button?.disabled,
    };
  })()`);

  const analyzingPrepared = await evaluate(cdp, `(async () => {
    const now = Date.now();
    const run = { id: 'menu-qa-analysis', status: 'running', progress: 42, startedAt: now, lastUpdatedAt: now, logs: [] };
    state.analysisRuns = [run];
    state.currentAnalysisRunId = run.id;
    state.progress = 42;
    state.progressMsg = '로컬 분석 동작 검증';
    state.step = 'analyzing';
    await render();
    return {
      activeStep: state.step,
      stopPresent: !!document.getElementById('stopAnalysisRunBtn'),
      progress: document.querySelector('[data-analysis-progress-bar]')?.textContent?.trim() || '',
    };
  })()`);
  if (analyzingPrepared.stopPresent) await clickSelector(cdp, '#stopAnalysisRunBtn');
  const analyzingStopped = await evaluate(cdp, `(() => ({
    status: state.analysisRuns?.find(run => run.id === 'menu-qa-analysis')?.status || '',
    progress: state.progress,
  }))()`);

  const sections = await evaluate(cdp, `(async () => {
    state.analysis = { product_name: '메뉴 모듈 검증 상품', category: '수저집' };
    state.sectionContents = {};
    state.sectionGenerating = {};
    state.sectionLocks = {};
    state.sectionInstructions = {};
    state.sectionBatchSelection = {};
    state.step = 'sections';
    await render();
    const first = document.getElementById('generateAll');
    const second = document.getElementById('generateAll2');
    return {
      activeStep: state.step,
      firstPresent: !!first,
      secondPresent: !!second,
    };
  })()`);

  const generatingPrepared = await evaluate(cdp, `(async () => {
    state.sectionBatchRun = {
      id: 'menu-qa-generation',
      status: 'running',
      progress: 38,
      currentSectionName: '핵심 포인트',
      logs: [],
    };
    state.progress = 38;
    state.progressMsg = '로컬 섹션 생성 동작 검증';
    state.step = 'generating';
    await render();
    const stopButton = document.getElementById('stopAfterCurrentSection');
    return {
      activeStep: state.step,
      stopPresent: !!stopButton,
      stopHandler: typeof stopButton?.onclick,
    };
  })()`);
  let generatingStopClick = null;
  let generatingStopped = { stopRequested: false, status: '' };
  if (generatingPrepared.stopPresent) {
    for (let effectAttempt = 1; effectAttempt <= 3; effectAttempt += 1) {
      generatingStopClick = {
        ...await clickSelector(cdp, '#stopAfterCurrentSection'),
        effectAttempt,
      };
      await delay(50);
      generatingStopped = await evaluate(cdp, `(() => ({
        stopRequested: !!state.sectionBatchRun?.stopRequested,
        status: state.sectionBatchRun?.status || '',
      }))()`);
      if (generatingStopped.stopRequested) break;
    }
  }

  const previewPrepared = await evaluate(cdp, `(async () => {
    state.sectionBatchRun = { status: 'done', progress: 100, logs: [] };
    state.previewViewport = 'pc';
    state.step = 'preview';
    await render();
    return {
      activeStep: state.step,
      pcPresent: !!document.getElementById('viewportPc'),
      mobilePresent: !!document.getElementById('viewportMobile'),
    };
  })()`);
  const previewMobileClick = previewPrepared.mobilePresent
    ? await clickSelector(cdp, '#viewportMobile')
    : null;
  const previewChanged = await evaluate(cdp, `(() => ({
    previewViewport: state.previewViewport,
    mobileActive: document.getElementById('viewportMobile')?.classList.contains('active') || false,
  }))()`);

  const competitor = await evaluate(cdp, `(async () => {
    state.compPage.mode = 'images';
    state.compPage.subStep = 'input';
    state.compPage.uploadedImages = [];
    state.step = 'competitor';
    await render();
    const button = document.getElementById('compStartAnalyze');
    const main = document.querySelector('.main');
    return {
      activeStep: state.step,
      buttonPresent: !!button,
      disabledWithoutImages: !!button?.disabled,
      horizontalOverflow: Math.max(0, (main?.scrollWidth || 0) - (main?.clientWidth || 0)),
    };
  })()`);

  const cafe24 = await evaluate(cdp, `(async () => {
    const { createCafe24Domain } = await import('/src/domains/cafe24/index.mjs');
    const domain = createCafe24Domain();
    const preview = domain.ui.buildPublishPreview({
      productNo: '2534',
      fields: {
        product_name: '메뉴 모듈 검증 상품',
        price: '4000',
        description: '<img src="data:image/png;base64,AAAA">',
      },
      options: { option_name: '색상', option_values: ['빨강', '빨강', '파랑'] },
    });
    return {
      mode: preview.mode,
      productNo: preview.productNo,
      preflightOk: preview.preflight.ok,
      fieldCount: preview.fieldCount,
      containsUnsafeDescription: preview.fields.some(field => field.field === 'description'),
    };
  })()`);

  await evaluate(cdp, `(async () => {
    state.analysis = null;
    state.analysisRuns = [];
    state.currentAnalysisRunId = '';
    state.sectionBatchRun = {};
    state.sectionContents = {};
    state.progress = 0;
    state.progressMsg = '';
    state.error = null;
    state.step = 'upload';
    await render();
    return true;
  })()`);

  return {
    upload,
    analyzingPrepared,
    analyzingStopped,
    sections,
    generatingPrepared,
    generatingStopClick,
    generatingStopped,
    previewPrepared,
    previewMobileClick,
    previewChanged,
    competitor,
    cafe24,
  };
}

async function inspectFactoryTabs(cdp) {
  await clickSelector(cdp, '[data-nav="factory"]');
  return evaluate(cdp, `Array.from(document.querySelectorAll('[data-factory-auto-tab]')).map(node => ({
    id: node.dataset.factoryAutoTab,
    label: node.lastElementChild?.textContent?.trim() || '',
    title: node.getAttribute('title') || '',
  }))`);
}

async function clickFactoryTabs(cdp) {
  const visits = [];
  for (const [id] of FACTORY_TABS) {
    const click = await clickSelector(cdp, `[data-factory-auto-tab="${id}"]`);
    const outcome = await evaluate(cdp, `(() => ({
      requested: ${JSON.stringify(id)},
      activeTab: factoryRuntimeReadFactory().automation?.activeTab || '',
      activeButton: document.querySelector('[data-factory-auto-tab].active')?.dataset.factoryAutoTab || '',
      warnings: window.__MENU_QA__.warnings.slice(-5),
    }))()`);
    outcome.layout = await inspectLayout(cdp);
    outcome.click = click;
    visits.push(outcome);
  }
  return visits;
}

async function runRepeatCycles(cdp, count = 3) {
  const cycles = [];
  for (let cycle = 0; cycle < count; cycle += 1) {
    const before = await evaluate(cdp, `(() => ({
      listeners: window.__MENU_QA__.globalListenerSnapshot(),
      saves: { ...window.__MENU_QA__.saveCounts },
    }))()`);
    await clickSelector(cdp, '[data-nav="factory"]');
    await clickFactoryTabs(cdp);
    await clickSelector(cdp, '[data-nav="upload"]');
    const after = await evaluate(cdp, `(() => ({
      listeners: window.__MENU_QA__.globalListenerSnapshot(),
      saves: { ...window.__MENU_QA__.saveCounts },
      activeStep: state.step,
    }))()`);
    cycles.push({
      cycle: cycle + 1,
      listenerBefore: before.listeners.count,
      listenerAfter: after.listeners.count,
      listenerKeysStable: JSON.stringify(before.listeners.keys) === JSON.stringify(after.listeners.keys),
      saveDelta: Object.fromEntries(Object.keys(after.saves).map(key => [key, after.saves[key] - before.saves[key]])),
      activeStep: after.activeStep,
    });
  }
  return cycles;
}

async function settleRouteAtTop(cdp) {
  return evaluate(cdp, `(async () => {
    const scrollRoot = document.querySelector('.app');
    const sidebar = document.querySelector('.sidebar');
    const scrollToTop = () => {
      if (scrollRoot) scrollRoot.scrollTop = 0;
      window.scrollTo(0, 0);
    };
    scrollToTop();
    await new Promise(resolve => setTimeout(resolve, 250));
    scrollToTop();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const authority = document.querySelector('.workspace-authority-banner');
    const authorityRect = authority?.getBoundingClientRect?.() || null;
    return {
      mainScrollTop: scrollRoot?.scrollTop || 0,
      sidebarScrollTop: sidebar?.scrollTop || 0,
      sidebarLogoRect: (() => {
        const rect = document.querySelector('.sidebar .logo')?.getBoundingClientRect?.();
        return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null;
      })(),
      authorityPresent: !!authority,
      authorityVisible: !!authorityRect
        && authorityRect.width > 0
        && authorityRect.height > 0
        && authorityRect.bottom > 0
        && authorityRect.top < window.innerHeight,
      authorityRect: authorityRect ? {
        top: authorityRect.top,
        bottom: authorityRect.bottom,
        width: authorityRect.width,
        height: authorityRect.height,
      } : null,
    };
  })()`);
}

async function captureTaskSixRouteViews(cdp, viewport) {
  const captures = [];
  for (const route of ['sections', 'preview', 'competitor']) {
    await clickSelector(cdp, `[data-nav="${route}"]`);
    const settled = await settleRouteAtTop(cdp);
    const state = await evaluate(cdp, `(() => ({
      activeStep: window.state?.step || '',
      title: document.querySelector('main.main .page-title')?.textContent?.trim() || '',
    }))()`);
    const layout = await inspectLayout(cdp);
    const capturePosition = await settleRouteAtTop(cdp);
    const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}-${route}.png`);
    const png = await capture(cdp, screenshotPath);
    captures.push({ route, state: { ...state, settled, capturePosition }, layout, screenshotPath, png });
  }
  return captures;
}

async function runViewport(cdp, appUrl, viewport) {
  await setupPage(cdp, appUrl, viewport);
  const baseline = await inspectStaticContracts(cdp);
  const routeVisits = await clickRoutes(cdp);
  const manualPrimary = await exerciseManualPrimaryAction(cdp, viewport);
  const modelSettingsPrimary = await exerciseModelSettingsPrimaryAction(cdp, viewport);
  const automationPrimary = await exerciseAutomationPrimaryAction(cdp, viewport);
  const imageCutsPrimary = await exerciseImageCutsPrimaryAction(cdp, viewport);
  const optionSorterPrimary = await exerciseOptionSorterPrimaryAction(cdp, viewport);
  const taskSixDomainActions = await exerciseTaskSixDomainActions(cdp);
  let narrowCompetitor = null;
  if (viewport.width === 535 && viewport.height === 697) {
    await clickSelector(cdp, '[data-nav="competitor"]');
    const layout = await inspectLayout(cdp);
    const screenshotPath = path.join(EVIDENCE_DIR, 'browser-535x697-competitor-narrow-check.png');
    const png = await capture(cdp, screenshotPath);
    narrowCompetitor = {
      id: 'COMPETITOR-NARROW-LAYOUT',
      expectedStatus: 'PASS',
      layout,
      screenshotPath,
      png,
    };
  }
  const tabs = await inspectFactoryTabs(cdp);
  const tabVisits = await clickFactoryTabs(cdp);
  const repeatCycles = await runRepeatCycles(cdp);
  const taskSixRouteCaptures = await captureTaskSixRouteViews(cdp, viewport);
  await clickSelector(cdp, '[data-nav="factory"]');
  const finalLayout = await inspectLayout(cdp);
  const screenshotPath = path.join(EVIDENCE_DIR, `browser-${viewport.width}x${viewport.height}.png`);
  const png = await capture(cdp, screenshotPath);
  return { viewport, baseline, routeVisits, manualPrimary, modelSettingsPrimary, automationPrimary, imageCutsPrimary, optionSorterPrimary, taskSixDomainActions, taskSixRouteCaptures, narrowCompetitor, tabs, tabVisits, repeatCycles, finalLayout, screenshotPath, png };
}

function buildChecks(results) {
  const expectedRoutes = ROUTES.map(([id, label]) => ({ id, label }));
  const expectedTabs = FACTORY_TABS.map(([id, label]) => ({ id, label }));
  const requiredTopText = ['DB 동기화:', '.kuasangse', '새 작업', '현재 상태 저장', '다른 이름으로 저장', '작업파일 불러오기'];
  const checks = [];
  for (const result of results) {
    const label = `${result.viewport.width}x${result.viewport.height}`;
    checks.push({
      id: `${label}:sidebar-contract`,
      ok: JSON.stringify(result.baseline.routes.map(({ id, label: text }) => ({ id, label: text }))) === JSON.stringify(expectedRoutes)
        && result.baseline.routes.filter(route => route.blocked).map(route => route.id).join(',') === 'generating',
      detail: result.baseline.routes,
    });
    checks.push({
      id: `${label}:top-workfile-strip`,
      ok: result.baseline.top.firstMainChild.split(' ').includes('top-command-row')
        && result.baseline.top.hasStrip
        && !result.baseline.top.hasLegacyBar
        && result.baseline.top.controls.every(control => control.visible && control.inTop && control.fullyReachable)
        && requiredTopText.every(text => result.baseline.top.text.includes(text)),
      detail: result.baseline.top,
    });
    checks.push({
      id: `${label}:route-clicks`,
      ok: result.routeVisits.every(visit => {
        const expectedStep = visit.requested === 'generating' ? 'upload' : visit.requested;
        return visit.activeStep === expectedStep
          && visit.activeNav === expectedStep
          && visit.layout.reachedBottom
          && /auto|scroll/.test(visit.layout.scrollRoot?.overflowY || '')
          && visit.layout.sidebarIndependentScroll === false;
      }) && /제품 이미지 분석 후/.test(result.routeVisits.find(visit => visit.requested === 'generating')?.notice || ''),
      detail: result.routeVisits,
    });
    checks.push({
      id: `${label}:manual-primary-action`,
      ok: result.manualPrimary.before.activeStep === 'manual'
        && result.manualPrimary.before.title === '상세페이지 자동화 설명서'
        && /제품 분석 화면으로/.test(result.manualPrimary.before.buttonText)
        && result.manualPrimary.before.buttonReachable
        && result.manualPrimary.layout.ok
        && result.manualPrimary.png.valid
        && result.manualPrimary.png.width === result.viewport.width
        && result.manualPrimary.png.height === result.viewport.height
        && result.manualPrimary.after.activeStep === 'analyzing'
        && result.manualPrimary.after.activeNav === 'analyzing',
      detail: result.manualPrimary,
    });
    checks.push({
      id: `${label}:modelsettings-primary-action`,
      ok: result.modelSettingsPrimary.before.activeStep === 'modelsettings'
        && /모델 설정/.test(result.modelSettingsPrimary.before.title)
        && result.modelSettingsPrimary.before.saveReachable
        && result.modelSettingsPrimary.custom.activeStep === 'modelsettings'
        && result.modelSettingsPrimary.custom.imageSizeMode === 'custom'
        && result.modelSettingsPrimary.custom.widthEnabled
        && result.modelSettingsPrimary.custom.settledOpacity >= 0.99
        && result.modelSettingsPrimary.layout.ok
        && result.modelSettingsPrimary.png.valid
        && result.modelSettingsPrimary.png.width === result.viewport.width
        && result.modelSettingsPrimary.png.height === result.viewport.height
        && result.modelSettingsPrimary.restored.activeStep === 'modelsettings'
        && result.modelSettingsPrimary.restored.imageSizeMode === 'auto',
      detail: result.modelSettingsPrimary,
    });
    checks.push({
      id: `${label}:automation-primary-action`,
      ok: result.automationPrimary.prepared.activeStep === 'automation'
        && /자동화 시스템/.test(result.automationPrimary.prepared.title)
        && result.automationPrimary.prepared.sliderReachable
        && result.automationPrimary.changed.activeStep === 'automation'
        && result.automationPrimary.changed.intervalMin === 15
        && result.automationPrimary.changed.persisted === '15'
        && result.automationPrimary.changed.display === '15분'
        && result.automationPrimary.layout.ok
        && result.automationPrimary.png.valid
        && result.automationPrimary.png.width === result.viewport.width
        && result.automationPrimary.png.height === result.viewport.height
        && result.automationPrimary.restored.activeStep === 'automation'
        && result.automationPrimary.restored.intervalMin === result.automationPrimary.prepared.originalInterval,
      detail: result.automationPrimary,
    });
    checks.push({
      id: `${label}:imagecuts-primary-action`,
      ok: result.imageCutsPrimary.prepared.activeStep === 'imagecuts'
        && /이미지컷 생성/.test(result.imageCutsPrimary.prepared.title)
        && result.imageCutsPrimary.prepared.buttonReachable
        && result.imageCutsPrimary.changed.activeStep === 'imagecuts'
        && result.imageCutsPrimary.changed.promptSlotCount === result.imageCutsPrimary.prepared.originalCount + result.imageCutsPrimary.prepared.delta
        && result.imageCutsPrimary.changed.promptLength === result.imageCutsPrimary.changed.promptSlotCount
        && result.imageCutsPrimary.changed.promptInputCount === result.imageCutsPrimary.changed.promptSlotCount
        && result.imageCutsPrimary.layout.ok
        && result.imageCutsPrimary.png.valid
        && result.imageCutsPrimary.png.width === result.viewport.width
        && result.imageCutsPrimary.png.height === result.viewport.height
        && result.imageCutsPrimary.restored.activeStep === 'imagecuts'
        && result.imageCutsPrimary.restored.promptSlotCount === result.imageCutsPrimary.restored.originalCount,
      detail: result.imageCutsPrimary,
    });
    checks.push({
      id: `${label}:optionsorter-primary-action`,
      ok: result.optionSorterPrimary.prepared.activeStep === 'optionsorter'
        && /옵션 분류기/.test(result.optionSorterPrimary.prepared.title)
        && result.optionSorterPrimary.prepared.buttonReachable
        && result.optionSorterPrimary.changed.activeStep === 'optionsorter'
        && result.optionSorterPrimary.changed.slotCount === result.optionSorterPrimary.prepared.originalCount + 1
        && result.optionSorterPrimary.changed.renderedSlotCount === result.optionSorterPrimary.changed.slotCount
        && result.optionSorterPrimary.layout.ok
        && result.optionSorterPrimary.png.valid
        && result.optionSorterPrimary.png.width === result.viewport.width
        && result.optionSorterPrimary.png.height === result.viewport.height
        && result.optionSorterPrimary.restored.activeStep === 'optionsorter'
        && result.optionSorterPrimary.restored.slotCount === result.optionSorterPrimary.restored.originalCount,
      detail: result.optionSorterPrimary,
    });
    checks.push({
      id: `${label}:task6-domain-actions`,
      ok: result.taskSixDomainActions.upload.activeStep === 'upload'
        && result.taskSixDomainActions.upload.buttonPresent
        && result.taskSixDomainActions.upload.disabledWithoutImage
        && result.taskSixDomainActions.analyzingPrepared.stopPresent
        && result.taskSixDomainActions.analyzingStopped.status === 'error'
        && result.taskSixDomainActions.sections.firstPresent
        && result.taskSixDomainActions.sections.secondPresent
        && result.taskSixDomainActions.generatingPrepared.stopPresent
        && result.taskSixDomainActions.generatingStopped.stopRequested
        && result.taskSixDomainActions.previewPrepared.mobilePresent
        && result.taskSixDomainActions.previewChanged.previewViewport === 'mobile'
        && result.taskSixDomainActions.competitor.buttonPresent
        && result.taskSixDomainActions.competitor.horizontalOverflow === 0
        && result.taskSixDomainActions.cafe24.mode === 'update'
        && result.taskSixDomainActions.cafe24.productNo === '2534'
        && result.taskSixDomainActions.cafe24.preflightOk
        && !result.taskSixDomainActions.cafe24.containsUnsafeDescription,
      detail: result.taskSixDomainActions,
    });
    checks.push({
      id: `${label}:task6-route-captures`,
      ok: result.taskSixRouteCaptures.length === 3
        && result.taskSixRouteCaptures.every(capture => capture.state.activeStep === capture.route
          && capture.state.title
          && capture.state.capturePosition?.mainScrollTop === 0
          && capture.state.capturePosition?.authorityPresent
          && capture.state.capturePosition?.authorityVisible
          && capture.layout.ok
          && capture.png.valid
          && capture.png.width === result.viewport.width
          && capture.png.height === result.viewport.height),
      detail: result.taskSixRouteCaptures,
    });
    const overflowVisits = result.routeVisits.filter(visit => visit.layout.rootOverflow > 2);
    const isNarrowBaseline = result.viewport.width === 535 && result.viewport.height === 697;
    checks.push({
      id: `${label}:no-horizontal-overflow`,
      ok: overflowVisits.length === 0
        && (!isNarrowBaseline
          || (result.narrowCompetitor?.expectedStatus === 'PASS'
            && result.narrowCompetitor.layout?.ok
            && result.narrowCompetitor.png?.valid
            && result.narrowCompetitor.png.width === 535
            && result.narrowCompetitor.png.height === 697)),
      detail: isNarrowBaseline ? result.narrowCompetitor : overflowVisits,
    });
    checks.push({
      id: `${label}:factory-tab-contract`,
      ok: JSON.stringify(result.tabs.map(({ id, label: text }) => ({ id, label: text }))) === JSON.stringify(expectedTabs)
        && result.tabs.every(tab => tab.title.length > 0),
      detail: result.tabs,
    });
    checks.push({
      id: `${label}:factory-tab-clicks`,
      ok: result.tabVisits.every(visit => visit.activeTab === visit.requested && visit.activeButton === visit.requested && visit.layout.ok),
      detail: result.tabVisits,
    });
    const deltas = result.repeatCycles.map(cycle => JSON.stringify(cycle.saveDelta));
    checks.push({
      id: `${label}:repeat-lifecycle`,
      ok: result.repeatCycles.every(cycle => cycle.listenerBefore === cycle.listenerAfter && cycle.listenerKeysStable && cycle.activeStep === 'upload')
        && new Set(deltas).size === 1
        && Object.values(result.repeatCycles[0]?.saveDelta || {}).some(value => value > 0),
      detail: result.repeatCycles,
    });
    checks.push({
      id: `${label}:layout-and-png`,
      ok: result.finalLayout.ok
        && result.png.valid
        && result.png.width === result.viewport.width
        && result.png.height === result.viewport.height,
      detail: { layout: result.finalLayout, png: result.png },
    });
    checks.push({
      id: `${label}:save-hooks`,
      ok: Object.values(result.baseline.saveHooks).every(Boolean),
      detail: result.baseline.saveHooks,
    });
  }
  return checks;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const report = {
    schema: 'kuasangse.menu-navigation.browser.v231',
    startedAt: new Date().toISOString(),
    ok: false,
    externalCalls: 'business calls blocked: Cafe24, VM, paid generation, OAuth/local control endpoints; static font/icon/CDN assets only',
    viewports: VIEWPORTS,
    results: [],
    checks: [],
    cleanup: {},
  };
  let server;
  let runtime;
  let cdp;
  let ownedChromePid = null;
  try {
    server = await startStaticServer();
    const serverPort = server.address().port;
    const appUrl = `http://127.0.0.1:${serverPort}/app.html`;
    const cdpPort = process.env.KUASANGSE_CDP_URL ? null : await freeTcpPort();
    const cdpUrl = process.env.KUASANGSE_CDP_URL || `http://127.0.0.1:${cdpPort}`;
    report.server = { appUrl, port: serverPort, pid: process.pid };
    report.cdp = { url: cdpUrl };
    runtime = await ensureCdp(cdpUrl);
    const diagnostics = runtime.diagnostics?.() || { launched: runtime.launched === true };
    ownedChromePid = runtime.launched ? diagnostics.pid : null;
    report.cdp.runtime = diagnostics;
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.setBlockedURLs', { urls: [
      'http://localhost:*',
      'http://127.0.0.1:4000/*',
      'http://127.0.0.1:4321/*',
      'http://127.0.0.1:5050/*',
      'https://*.cafe24api.com/*',
      'https://*.cafe24.com/api/*',
    ] });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENTATION_SOURCE });

    for (const viewport of VIEWPORTS) {
      report.results.push(await runViewport(cdp, appUrl, viewport));
    }
    report.checks = buildChecks(report.results);
    report.ok = report.checks.every(check => check.ok);
    if (!report.ok) {
      const failures = report.checks.filter(check => !check.ok);
      throw new Error(`menu browser contracts failed:\n${failures.map(check => `- ${check.id}: ${JSON.stringify(check.detail)}`).join('\n')}`);
    }
  } catch (error) {
    report.error = error?.stack || String(error);
  } finally {
    try { cdp?.close(); } catch (_) {}
    try { await runtime?.cleanup?.(); } catch (error) { report.cleanup.chromeError = String(error?.message || error); }
    try { await stopStaticServer(server); } catch (error) { report.cleanup.serverError = String(error?.message || error); }
    await delay(500);
    report.cleanup = {
      ...report.cleanup,
      completedAt: new Date().toISOString(),
      staticServerListening: !!server?.listening,
      chromeOwned: !!ownedChromePid,
      chromePid: ownedChromePid,
      chromePidAliveAfterCleanup: ownedChromePid ? pidAlive(ownedChromePid) : null,
      cdpSocketClosed: true,
    };
    const cleanupOk = !report.cleanup.staticServerListening
      && (!report.cleanup.chromeOwned || report.cleanup.chromePidAliveAfterCleanup === false)
      && !report.cleanup.chromeError
      && !report.cleanup.serverError;
    report.cleanup.ok = cleanupOk;
    report.finishedAt = new Date().toISOString();
    report.ok = report.ok && cleanupOk && !report.error;
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CLEANUP_PATH, [
      `finishedAt=${report.finishedAt}`,
      `staticServerListening=${report.cleanup.staticServerListening}`,
      `chromeOwned=${report.cleanup.chromeOwned}`,
      `chromePid=${report.cleanup.chromePid || ''}`,
      `chromePidAliveAfterCleanup=${report.cleanup.chromePidAliveAfterCleanup ?? ''}`,
      `cdpSocketClosed=${report.cleanup.cdpSocketClosed}`,
      `cleanupOk=${report.cleanup.ok}`,
    ].join('\n') + '\n', 'utf8');
  }

  if (!report.ok) {
    console.error(report.error || `cleanup failed: ${JSON.stringify(report.cleanup)}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    screenshots: report.results.flatMap(result => [
      { path: result.screenshotPath, png: result.png },
      ...result.taskSixRouteCaptures.map(capture => ({ path: capture.screenshotPath, png: capture.png })),
    ]),
    checks: report.checks.map(check => ({ id: check.id, ok: check.ok })),
    cleanup: report.cleanup,
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
