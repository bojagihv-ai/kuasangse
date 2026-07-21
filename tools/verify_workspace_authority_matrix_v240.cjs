const fs = require('fs');
const path = require('path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9490';
const OUT_DIR = path.join(process.cwd(), '.omo', 'evidence', 'kuasangse-menu-modularization', 'task-4');
const RUNTIME_MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'runtime-manifest.json'), 'utf8'));
const BUILD_ID = String(RUNTIME_MANIFEST.buildId || '').trim();
const BUILD_LABEL = (BUILD_ID.match(/v\d+$/i)?.[0] || BUILD_ID || 'unknown-build').replace(/[^a-z0-9._-]+/gi, '-');

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 480 },
  { width: 390, height: 600 },
];

const STATES = [
  { id: 'editing', mode: 'editing', reasonCode: 'LEASE_GRANTED', reason: '', owner: '편집 중인 창의 매우 긴 작업파일 이름 - 슬라브 나비 수저집 전체 색상 옵션 수정본' },
  { id: 'readonly', mode: 'readonly', reasonCode: 'LEASE_HELD', reason: '다른 창에서 이 작업을 편집 중입니다.', owner: '다른 창의 매우 긴 작업파일 이름 - 상세 VM 수정과 사이즈 확인 대기본' },
  { id: 'takeover-declined', mode: 'readonly', reasonCode: 'TAKEOVER_CONFIRMATION_REQUIRED', reason: '사용자가 편집권 가져오기를 취소했습니다.', owner: '인계를 거절한 창의 매우 긴 작업파일 이름 - 안전 보존 기준본' },
  { id: 'takeover-confirmed', mode: 'editing', reasonCode: 'LEASE_GRANTED', reason: '마지막 승인 저장본을 확인한 뒤 편집권을 가져왔습니다.', owner: '인계를 확인한 창의 매우 긴 작업파일 이름 - 최신 승인 저장본' },
  { id: 'stale', mode: 'readonly', reasonCode: 'TAKEN_OVER', reason: '다른 창이 편집권을 가져가 이 창은 읽기 전용으로 전환되었습니다.', owner: '새 편집 창의 매우 긴 작업파일 이름 - stale 쓰기 차단 기준본' },
  { id: 'offline', mode: 'offline-edit', reasonCode: 'OFFLINE_DRAFT', reason: '새 작업은 오프라인 편집 모드로 계속할 수 있습니다.', owner: '오프라인 로컬 초안 창의 매우 긴 작업파일 이름 - 아직 서버 미저장' },
];

const TARGETS = [
  'upload', 'analyzing', 'competitor', 'sections', 'generating', 'preview',
  'imagecuts', 'optionsorter', 'factory', 'automation', 'modelsettings', 'manual',
  'factory/start', 'factory/db', 'factory/fields', 'factory/competitor',
  'factory/assets', 'factory/sections', 'factory/publish',
];

function assertMatrix(rows) {
  const failures = [];
  for (const row of rows) {
    const prefix = `${row.state}/${row.viewport}/${row.target}`;
    if (!row.bannerVisible) failures.push(`${prefix}: banner missing`);
    if (row.actionCount !== 4 || !row.actionsReachable || row.actionTextClipped || !row.actionKeepAll) failures.push(`${prefix}: actions unreachable, clipped, or split`);
    if (!row.bottomReachable || !row.verticalOverflowReady) failures.push(`${prefix}: vertical bottom unreachable`);
    if (row.horizontalOverflow > 1 || row.mainHorizontalOverflow > 1) failures.push(`${prefix}: horizontal overflow`);
    if (!row.ownerAtomic || !row.descriptionKeepAll) failures.push(`${prefix}: Korean authority copy or owner label split incorrectly`);
    if (!row.workfileNameKeepAll) failures.push(`${prefix}: Korean workfile name split incorrectly`);
    if (row.state === 'offline' && (!row.takeoverDisabled || !row.takeoverBlockedReason)) failures.push(`${prefix}: offline draft takeover is not visibly blocked`);
    if (row.viewport === '390x600' && (
      row.fabTakeoverOverlapArea > 0 || row.fabScrollbarOverlapArea > 0
      || row.fabTakeoverGap < 16 || row.fabScrollbarGap < 8
    )) failures.push(`${prefix}: floating assistant overlaps or crowds authority action/main scrollbar`);
    if (row.loadErrorCount || row.brokenImageCount) failures.push(`${prefix}: load or image error`);
  }
  if (failures.length) throw new Error(`Workspace authority matrix failed:\n${failures.join('\n')}`);
}

function assertCaptureDiagnostics(diagnostics) {
  const failures = diagnostics
    .filter(item => item.storageWarning || item.storageWarningVisibleText)
    .map(item => `${item.state}/${item.viewport}: storageWarning=${JSON.stringify(item.storageWarning)} dom=${JSON.stringify(item.storageWarningVisibleText)}`);
  if (failures.length) throw new Error(`Workspace authority matrix leaked storage warnings:\n${failures.join('\n')}`);
}

async function preparePage(cdp) {
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `window.state && window.render && window.factoryState
    && window.__KUASANGSE_WORKSPACE_LOCK__ && document.querySelector('.app')`, 60_000);
  await evaluate(cdp, `(async () => {
    const startupPersistence = typeof persistentStateSavePromise !== 'undefined'
      ? persistentStateSavePromise
      : null;
    if (startupPersistence) await Promise.resolve(startupPersistence).catch(() => false);
    if (typeof persistentStateSaveRetryTimer !== 'undefined' && persistentStateSaveRetryTimer) {
      clearTimeout(persistentStateSaveRetryTimer);
      persistentStateSaveRetryTimer = null;
    }
    if (typeof persistentStateSaveQueued !== 'undefined') persistentStateSaveQueued = false;
    window.savePersistentState = () => Promise.resolve(true);
    const style = document.createElement('style');
    style.id = 'task4-matrix-stability';
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.appendChild(style);
    window.__TASK4_MATRIX_AUTHORITY__ = window.__KUASANGSE_WORKSPACE_LOCK__.snapshot();
    window.__KUASANGSE_WORKSPACE_LOCK__ = Object.freeze({
      snapshot: () => window.__TASK4_MATRIX_AUTHORITY__,
    });
    return true;
  })()`);
}

async function verifyGroup(cdp, state, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return evaluate(cdp, `(async () => {
    const authorityState = ${JSON.stringify(state)};
    const targets = ${JSON.stringify(TARGETS)};
    const viewport = ${JSON.stringify(`${viewport.width}x${viewport.height}`)};
    const rows = [];
    window.__TASK4_MATRIX_AUTHORITY__ = Object.freeze({
      mode: authorityState.mode,
      scopeId: authorityState.mode === 'offline-edit' ? 'draft:task4-visual' : 'project:task4-visual',
      leaseId: authorityState.mode === 'offline-edit' ? '' : 'task4-visual-lease',
      fencingToken: authorityState.mode === 'offline-edit' ? 0 : 41,
      ownerId: authorityState.owner + ' · 창 A7F4',
      sessionId: 'task4-visual-session-A7F4',
      revision: authorityState.mode === 'offline-edit' ? 0 : 12,
      reasonCode: authorityState.reasonCode,
      reason: authorityState.reason,
      expiresAt: Date.now() + 30000,
    });
    window.state.currentProjectId = authorityState.mode === 'offline-edit' ? '' : 'task4-visual';
    window.state.currentProjectName = authorityState.owner;
    window.state.productName = '슬라브 나비 수저집';
    window.state.error = '';
    window.state.storageWarning = '';
    window.state.storageWarningDismissKey = '';
    for (const target of targets) {
      const [step, tab] = target.split('/');
      window.state.step = step;
      if (step === 'factory') {
        const factory = window.factoryState();
        factory.automation = { ...(factory.automation || {}), activeTab: tab || 'start' };
      }
      window.render();
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scrollRoot = document.querySelector('.app');
      const main = document.querySelector('.main');
      const banner = document.querySelector('.workspace-authority-banner');
      const actions = [...document.querySelectorAll('[data-workspace-authority-action]')];
      const owner = banner?.querySelector('.workspace-authority-owner');
      scrollRoot.scrollTop = 0;
      banner?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const ownerStyle = owner ? getComputedStyle(owner) : null;
      const ownerRect = owner?.getBoundingClientRect();
      const lineHeight = Number.parseFloat(ownerStyle?.lineHeight || '') || 0;
      const actionsReachable = actions.every(action => {
        const rect = action.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0;
      });
      const actionTextClipped = actions.some(action => action.scrollWidth > action.clientWidth + 1);
      const actionKeepAll = actions.every(action => getComputedStyle(action).wordBreak === 'keep-all');
      const description = banner?.querySelector('.workspace-authority-description');
      const takeover = banner?.querySelector('[data-workspace-authority-action="takeover"]');
      const workfileName = document.querySelector('.db-workfile-name');
      const workfileNameBase = document.querySelector('.db-workfile-name-base');
      const agentFab = document.querySelector('.agent-fab');
      const overlapArea = (first, second) => {
        if (!first || !second) return 0;
        return Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
          * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      };
      const fabRect = agentFab?.getBoundingClientRect();
      const takeoverRect = takeover?.getBoundingClientRect();
      const scrollRootRect = scrollRoot.getBoundingClientRect();
      const scrollbarWidth = Math.max(0, scrollRoot.offsetWidth - scrollRoot.clientWidth);
      const scrollbarRect = scrollbarWidth > 0 ? {
        left: scrollRootRect.right - scrollbarWidth,
        right: scrollRootRect.right,
        top: scrollRootRect.top,
        bottom: scrollRootRect.bottom,
      } : null;
      scrollRoot.scrollTop = scrollRoot.scrollHeight;
      const bottomReachable = Math.ceil(scrollRoot.scrollTop + scrollRoot.clientHeight) >= scrollRoot.scrollHeight;
      const overflowY = getComputedStyle(scrollRoot).overflowY;
      const verticalOverflowReady = scrollRoot.scrollHeight <= scrollRoot.clientHeight || ['auto', 'scroll'].includes(overflowY);
      const viewportWidth = document.documentElement.clientWidth;
      const overflowOffenders = [...document.querySelectorAll('main *')]
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            id: element.id || '',
            className: String(element.className || '').slice(0, 120),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          };
        })
        .filter(item => item.right > viewportWidth + 1 || item.left < -1 || item.scrollWidth > item.clientWidth + 1)
        .slice(0, 12);
      rows.push({
        state: authorityState.id,
        viewport,
        target,
        bannerVisible: !!banner && banner.getBoundingClientRect().width > 0,
        actionCount: actions.length,
        actionsReachable,
        actionTextClipped,
        actionKeepAll,
        bottomReachable,
        verticalOverflowReady,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mainHorizontalOverflow: main.scrollWidth - main.clientWidth,
        overflowOffenders,
        ownerAtomic: !!owner && !!owner.getAttribute('title') && ownerStyle.whiteSpace === 'nowrap'
          && ownerStyle.textOverflow === 'ellipsis' && ownerStyle.overflowX === 'hidden'
          && (!lineHeight || ownerRect.height <= lineHeight + 2),
        ownerClipped: !!owner && owner.scrollWidth > owner.clientWidth + 1,
        descriptionKeepAll: !!description && getComputedStyle(description).wordBreak === 'keep-all',
        workfileNameKeepAll: !!workfileName && !!workfileNameBase
          && getComputedStyle(workfileName).wordBreak === 'keep-all'
          && getComputedStyle(workfileNameBase).wordBreak === 'keep-all',
        takeoverDisabled: !!takeover?.disabled,
        takeoverBlockedReason: String(takeover?.getAttribute('title') || '').includes('인계 대상이 아닙니다'),
        fabTakeoverOverlapArea: overlapArea(fabRect, takeoverRect),
        fabScrollbarOverlapArea: overlapArea(fabRect, scrollbarRect),
        fabTakeoverGap: fabRect && takeoverRect ? Math.max(0, fabRect.top - takeoverRect.bottom) : 0,
        fabScrollbarGap: fabRect && scrollbarRect ? Math.max(0, scrollbarRect.left - fabRect.right) : 0,
        fabRect: fabRect ? { left: fabRect.left, top: fabRect.top, right: fabRect.right, bottom: fabRect.bottom } : null,
        takeoverRect: takeoverRect ? { left: takeoverRect.left, top: takeoverRect.top, right: takeoverRect.right, bottom: takeoverRect.bottom } : null,
        scrollbarRect,
        loadErrorCount: (window.__KUASANGSE_LOAD_ERRORS__ || []).length,
        brokenImageCount: [...document.images].filter(image => image.complete && image.naturalWidth === 0).length,
      });
    }
    window.state.step = 'upload';
    window.render();
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelector('.app').scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return rows;
  })()`);
}

async function capture(cdp, state, viewport) {
  await cdp.send('Page.bringToFront');
  await evaluate(cdp, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120))))`);
  const diagnostic = await evaluate(cdp, `(() => {
    const storageWarningVisibleText = String(document.querySelector('#closeStorageWarning')?.parentElement?.innerText || '');
    return {
      storageWarning: String(window.state.storageWarning || ''),
      storageWarningDismissKey: String(window.state.storageWarningDismissKey || ''),
      storageWarningVisibleText,
      persistenceSaving: typeof persistentStateSaving === 'boolean' ? persistentStateSaving : null,
      persistenceQueued: typeof persistentStateSaveQueued === 'boolean' ? persistentStateSaveQueued : null,
      authority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
    };
  })()`);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  const fileName = `workspace-authority-${state.id}-${viewport.width}x${viewport.height}.png`;
  const output = path.join(OUT_DIR, fileName);
  fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
  return { output, diagnostic: { state: state.id, viewport: `${viewport.width}x${viewport.height}`, ...diagnostic } };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const response = await fetch(APP_URL, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`App test server returned HTTP ${response.status}`);
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  const rows = [];
  const screenshots = [];
  const captureDiagnostics = [];
  try {
    await preparePage(cdp);
    for (const state of STATES) {
      for (const viewport of VIEWPORTS) {
        const group = await verifyGroup(cdp, state, viewport);
        rows.push(...group);
        const captured = await capture(cdp, state, viewport);
        screenshots.push(captured.output);
        captureDiagnostics.push(captured.diagnostic);
        console.log(`matrix ${state.id} ${viewport.width}x${viewport.height}: ${group.length}/19`);
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, `workspace-authority-matrix-${BUILD_LABEL}.raw.json`), JSON.stringify({ build: BUILD_ID, rows, screenshots, captureDiagnostics }, null, 2));
    assertMatrix(rows);
    assertCaptureDiagnostics(captureDiagnostics);
    if (rows.length !== 342 || screenshots.length !== 18) {
      throw new Error(`matrix evidence count mismatch: rows=${rows.length}, screenshots=${screenshots.length}`);
    }
    const proof = { build: BUILD_ID, fontsReady: true, rows, screenshots, captureDiagnostics };
    fs.writeFileSync(path.join(OUT_DIR, `workspace-authority-matrix-${BUILD_LABEL}.json`), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify({ ok: true, domStates: rows.length, screenshots: screenshots.length }, null, 2));
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
