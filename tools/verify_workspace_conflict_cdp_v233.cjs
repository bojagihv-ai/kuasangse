const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  fetchJson,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_BASE || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), '.omo', 'evidence', 'kuasangse-menu-modularization', 'task-4');

async function pageTarget(targetId) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const target = (await fetchJson(`${CDP_URL}/json`)).find(item => item.id === targetId);
    if (target?.webSocketDebuggerUrl) return target;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`CDP target not found: ${targetId}`);
}

async function preparePage(cdp, width, height) {
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `!!(
    window.state
    && window.render
    && window.workspacePersistenceApi
    && window.__KUASANGSE_WORKSPACE_LOCK__
    && document.querySelector('.app')
  )`, 60_000);
  await evaluate(cdp, `(() => {
    if (document.getElementById('task4-capture-stability')) return true;
    const style = document.createElement('style');
    style.id = 'task4-capture-stability';
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.appendChild(style);
    return true;
  })()`);
}

async function setWorkspace(cdp, projectId, name) {
  return evaluate(cdp, `(async () => {
    const projectId = ${JSON.stringify(projectId)};
    const scopeId = 'project:' + projectId;
    window.state.currentProjectId = projectId;
    window.state.currentProjectName = ${JSON.stringify(name)};
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = ${JSON.stringify(name)};
    if (window.state.factory && typeof window.state.factory === 'object') {
      window.state.factory.workspace = {
        ...(window.state.factory.workspace || {}),
        id: projectId,
        name: ${JSON.stringify(name)},
      };
      window.state.factory.currentProjectId = projectId;
      window.state.factory.currentProjectName = ${JSON.stringify(name)};
    }
    const authority = await window.ensureWorkspaceEditAuthority(scopeId, { force: true });
    window.render();
    return authority;
  })()`);
}

async function capture(cdp, fileName) {
  await cdp.send('Page.bringToFront');
  await new Promise(resolve => setTimeout(resolve, 120));
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  const output = path.join(OUT_DIR, fileName);
  fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
  return output;
}

async function layoutProof(cdp) {
  return evaluate(cdp, `(() => {
    const main = document.querySelector('.main');
    const banner = document.querySelector('.workspace-authority-banner');
    const actions = [...document.querySelectorAll('[data-workspace-authority-action]')];
    const before = main.scrollTop;
    main.scrollTop = main.scrollHeight;
    const reachedBottom = Math.ceil(main.scrollTop + main.clientHeight) >= main.scrollHeight;
    main.scrollTop = before;
    const viewportWidth = document.documentElement.clientWidth;
    const owner = banner?.querySelector('.workspace-authority-owner');
    const ownerStyle = owner ? getComputedStyle(owner) : null;
    const ownerLineHeight = Number.parseFloat(ownerStyle?.lineHeight || '') || 0;
    const ownerRect = owner?.getBoundingClientRect();
    return {
      mode: window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().mode,
      bannerVisible: !!banner && banner.getBoundingClientRect().width > 0,
      actionLabels: actions.map(item => item.textContent.trim()),
      actionsReachable: actions.every(item => item.getBoundingClientRect().width > 0),
      actionTextClipped: actions.some(item => item.scrollWidth > item.clientWidth + 1),
      horizontalOverflow: document.documentElement.scrollWidth - viewportWidth,
      mainHorizontalOverflow: main.scrollWidth - main.clientWidth,
      mainScrollable: main.scrollHeight > main.clientHeight,
      reachedBottom,
      loadErrorCount: (window.__KUASANGSE_LOAD_ERRORS__ || []).length,
      brokenImageCount: [...document.images].filter(image => image.complete && image.naturalWidth === 0).length,
      owner: owner ? {
        title: owner.getAttribute('title') || '',
        text: owner.textContent.trim(),
        whiteSpace: ownerStyle.whiteSpace,
        textOverflow: ownerStyle.textOverflow,
        overflowX: ownerStyle.overflowX,
        oneLine: !!ownerRect && (!ownerLineHeight || ownerRect.height <= ownerLineHeight + 2),
        clipped: owner.scrollWidth > owner.clientWidth + 1,
      } : null,
    };
  })()`);
}

async function workspaceIdentity(cdp) {
  return evaluate(cdp, `(() => {
    const authority = window.__KUASANGSE_WORKSPACE_LOCK__.snapshot();
    const takeover = document.querySelector('[data-workspace-authority-action="takeover"]');
    return {
      mode: authority.mode,
      scopeId: authority.scopeId,
      revision: authority.revision,
      currentProjectId: window.state.currentProjectId || '',
      currentProjectName: window.state.currentProjectName || '',
      productName: window.state.productName || '',
      workfileName: document.querySelector('.db-workfile-name')?.textContent?.trim() || '',
      workfileSaveState: window.state.workfileSaveState || '',
      error: window.state.error || '',
      takeoverDisabled: !!takeover?.disabled,
      takeoverTitle: takeover?.getAttribute('title') || '',
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const firstTarget = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!firstTarget?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const pageA = connectCdp(firstTarget.webSocketDebuggerUrl);
  await pageA.opened;
  const { targetId } = await pageA.send('Target.createTarget', { url: 'about:blank' });
  const secondTarget = await pageTarget(targetId);
  const pageB = connectCdp(secondTarget.webSocketDebuggerUrl);
  let pageC = null;
  const projectId = `conflict-v233-${Date.now()}`;
  const scopeId = `project:${projectId}`;
  const acceptedName = `동시편집 기준본 ${projectId}`;
  try {
    await preparePage(pageA, 1280, 480);
    await preparePage(pageB, 390, 600);
    const authorityA = await setWorkspace(pageA, projectId, '창 A의 매우 긴 작업파일 이름 - 슬라브 나비 수저집 색상 옵션 전체 수정본');
    const authorityB = await setWorkspace(pageB, projectId, '창 B의 매우 긴 작업파일 이름 - VM 상세 수정과 사이즈 확인 완료 최종본');
    const refreshBefore = await workspaceIdentity(pageB);
    await evaluate(pageB, `(() => {
      document.querySelector('[data-workspace-authority-action="refresh"]')?.click();
      return true;
    })()`);
    await waitFor(pageB, `window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().mode === 'readonly'`, 15_000);
    const refreshAfter = await workspaceIdentity(pageB);
    const refreshAction = { before: refreshBefore, after: refreshAfter };
    const readonlyLayoutB = await layoutProof(pageB);
    const readonlyScreenshotB = await capture(pageB, 'workspace-conflict-readonly-390x600.png');
    const savedA = await evaluate(pageA, `(async () => {
      window.state.productName = ${JSON.stringify(acceptedName)};
      window.state.currentProjectName = ${JSON.stringify(acceptedName)};
      const scopeId = ${JSON.stringify(scopeId)};
      const snapshot = window.buildServerLastWorkSnapshot('workspace-conflict-cdp');
      const result = await window.workspacePersistenceApi().commit({
        scopeId,
        snapshot,
        metadata: window.workspaceCommitMetadata(scopeId, 'workspace-conflict-cdp'),
        context: { server: { bases: [${JSON.stringify(BACKEND_BASE)}] } },
        isCurrent: () => true,
      });
      window.render();
      return {
        accepted: result.accepted,
        clean: result.clean,
        revision: window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().revision,
      };
    })()`);
    await evaluate(pageB, `(() => {
      window.confirm = () => true;
      document.querySelector('[data-workspace-authority-action="takeover"]').click();
      return true;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const takeoverDebug = await evaluate(pageB, `(() => ({
      authority: window.__KUASANGSE_WORKSPACE_LOCK__.snapshot(),
      error: window.state.error || '',
      buttonDisabled: document.querySelector('[data-workspace-authority-action="takeover"]')?.disabled,
      banner: document.querySelector('.workspace-authority-banner')?.textContent || '',
    }))()`);
    console.log(JSON.stringify({ authorityA, authorityB, savedA, takeoverDebug }, null, 2));
    await waitFor(pageB, `window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().mode === 'editing'
      && window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().revision >= ${Number(savedA.revision)}`, 30_000);
    await waitFor(pageA, `window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().mode === 'readonly'`, 15_000);
    const postTakeoverA = await evaluate(pageA, `(async () => {
      const scopeId = ${JSON.stringify(scopeId)};
      const before = window.__KUASANGSE_WORKSPACE_LOCK__.snapshot();
      const result = await window.workspacePersistenceApi().commit({
        scopeId,
        snapshot: { productName: '절대 저장되면 안 되는 stale A' },
        metadata: window.workspaceCommitMetadata(scopeId, 'stale-a'),
        context: { server: { bases: [${JSON.stringify(BACKEND_BASE)}] } },
      });
      return {
        mode: before.mode,
        accepted: result.accepted,
        code: result.code,
        inert: document.querySelector('.container')?.hasAttribute('inert') || false,
        saveDisabled: document.querySelector('#saveCurrentProjectFileBtn')?.disabled || false,
      };
    })()`);
    const postTakeoverB = await evaluate(pageB, `(() => ({
      authority: window.__KUASANGSE_WORKSPACE_LOCK__.snapshot(),
      productName: window.state.productName,
      banner: document.querySelector('.workspace-authority-banner')?.textContent || '',
    }))()`);
    const layoutA = await layoutProof(pageA);
    const layoutB = await layoutProof(pageB);
    const screenshotA = await capture(pageA, 'workspace-conflict-1280x480.png');
    const screenshotB = await capture(pageB, 'workspace-conflict-390x600.png');
    await pageB.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await evaluate(pageB, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const layoutWide = await layoutProof(pageB);
    const screenshotWide = await capture(pageB, 'workspace-conflict-1440x900.png');
    const server = await fetchJson(`${BACKEND_BASE}/api/last-work?workspaceId=${encodeURIComponent(scopeId)}`);
    const serverProductName = server.snapshot?.assets?.productName
      || server.snapshot?.lightweight?.productName
      || server.snapshot?.productName
      || '';

    const readonlyBefore = await workspaceIdentity(pageB);
    await evaluate(pageB, `(() => {
      document.querySelector('[data-workspace-authority-action="readonly"]')?.click();
      return true;
    })()`);
    await waitFor(pageB, `window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().mode === 'readonly'
      && window.__KUASANGSE_WORKSPACE_LOCK__.snapshot().reasonCode === 'USER_READ_ONLY'`, 15_000);
    const readonlyAfter = await workspaceIdentity(pageB);
    const readonlyAction = { before: readonlyBefore, after: readonlyAfter };

    const saveCopyBefore = await workspaceIdentity(pageB);
    await evaluate(pageB, `(() => {
      window.showSaveFilePicker = async options => ({
        kind: 'file',
        name: options?.suggestedName || 'workspace-authority-action-copy.kuasangse',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      });
      document.querySelector('[data-workspace-authority-action="save-copy"]')?.click();
      return true;
    })()`);
    await waitFor(pageB, `window.state.workfileSaveState === 'saved' || window.state.workfileSaveState === 'error'`, 30_000);
    const saveCopyAfter = await workspaceIdentity(pageB);
    const serverAfterSaveCopy = await fetchJson(`${BACKEND_BASE}/api/last-work?workspaceId=${encodeURIComponent(scopeId)}`);
    const serverAfterSaveCopyName = serverAfterSaveCopy.snapshot?.assets?.productName
      || serverAfterSaveCopy.snapshot?.lightweight?.productName
      || serverAfterSaveCopy.snapshot?.productName
      || '';
    const saveCopyAction = {
      before: saveCopyBefore,
      after: saveCopyAfter,
      originalServer: { revision: serverAfterSaveCopy.revision, productName: serverAfterSaveCopyName },
    };

    const { targetId: offlineTargetId } = await pageA.send('Target.createTarget', { url: 'about:blank' });
    const offlineTarget = await pageTarget(offlineTargetId);
    pageC = connectCdp(offlineTarget.webSocketDebuggerUrl);
    await preparePage(pageC, 390, 600);
    await evaluate(pageC, `(async () => {
      await window.__KUASANGSE_STARTUP_RESTORE_PROMISE__;
      window.state.productName = '오프라인 초안 인계 차단 기준본';
      await window.startNewProjectDraft();
      window.__TASK4_CONFIRM_COUNT__ = 0;
      window.confirm = () => { window.__TASK4_CONFIRM_COUNT__ += 1; return true; };
      window.render();
      return true;
    })()`);
    const offlineBefore = await workspaceIdentity(pageC);
    await evaluate(pageC, `(() => {
      document.querySelector('[data-workspace-authority-action="takeover"]')?.click();
      return true;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const offlineAfter = await workspaceIdentity(pageC);
    const offlineConfirmCount = await evaluate(pageC, 'window.__TASK4_CONFIRM_COUNT__ || 0');
    const offlineAction = { before: offlineBefore, after: offlineAfter, confirmCount: offlineConfirmCount };
    console.log(JSON.stringify({ refreshAction, readonlyAction, saveCopyAction, offlineAction }, null, 2));
    const requiredActions = ['상태 새로고침', '읽기 전용으로 열기', '새 작업으로 저장', '편집권 가져오기'];
    const checks = [
      { ok: authorityA.mode === 'editing', message: '창 A가 최초 편집권을 얻지 못했습니다.' },
      { ok: authorityB.mode === 'readonly', message: '창 B가 충돌 시 읽기 전용으로 열리지 않았습니다.' },
      { ok: savedA.accepted && savedA.clean && savedA.revision >= 1, message: '창 A 기준본 저장이 실패했습니다.' },
      { ok: postTakeoverA.mode === 'readonly', message: '인계 후 창 A가 읽기 전용으로 전환되지 않았습니다.' },
      { ok: !postTakeoverA.accepted, message: '인계 후 stale 창 A 저장이 허용되었습니다.' },
      { ok: postTakeoverA.inert && postTakeoverA.saveDisabled, message: '읽기 전용 UI가 명령을 비활성화하지 않았습니다.' },
      { ok: postTakeoverB.authority.mode === 'editing' && postTakeoverB.authority.revision >= savedA.revision, message: '창 B 인계 또는 최신 revision 복원이 실패했습니다.' },
      { ok: postTakeoverB.productName === acceptedName, message: '인계 후 창 B가 최신 accepted snapshot을 복원하지 않았습니다.' },
      { ok: server.revision >= savedA.revision && serverProductName === acceptedName, message: 'stale 창 A가 서버 기준본을 오염시켰습니다.' },
      { ok: refreshAction.before.mode === 'readonly' && refreshAction.after.mode === 'readonly'
        && refreshAction.before.scopeId === refreshAction.after.scopeId
        && refreshAction.before.currentProjectId === refreshAction.after.currentProjectId
        && refreshAction.before.currentProjectName === refreshAction.after.currentProjectName,
      message: '상태 새로고침이 읽기 전용 범위 또는 작업파일 identity를 바꿨습니다.' },
      { ok: readonlyAction.before.mode === 'editing' && readonlyAction.after.mode === 'readonly'
        && readonlyAction.after.scopeId === scopeId
        && readonlyAction.before.currentProjectId === readonlyAction.after.currentProjectId
        && readonlyAction.before.currentProjectName === readonlyAction.after.currentProjectName,
      message: '읽기 전용으로 열기가 원본 작업 범위를 보존하지 못했습니다.' },
      { ok: saveCopyAction.after.workfileSaveState === 'saved'
        && saveCopyAction.after.currentProjectId
        && saveCopyAction.after.currentProjectId !== projectId
        && saveCopyAction.after.scopeId !== scopeId
        && saveCopyAction.after.currentProjectName !== saveCopyAction.before.currentProjectName,
      message: '새 작업으로 저장이 별도 작업파일 identity를 만들지 못했습니다.' },
      { ok: saveCopyAction.originalServer.revision >= savedA.revision
        && saveCopyAction.originalServer.productName === acceptedName,
      message: '새 작업으로 저장이 원본 서버 기준본을 변경했습니다.' },
      { ok: offlineAction.before.mode === 'offline-edit'
        && offlineAction.before.scopeId.startsWith('draft:')
        && offlineAction.before.takeoverDisabled
        && offlineAction.before.takeoverTitle.includes('인계 대상이 아닙니다')
        && offlineAction.confirmCount === 0
        && offlineAction.after.mode === offlineAction.before.mode
        && offlineAction.after.scopeId === offlineAction.before.scopeId
        && offlineAction.after.currentProjectId === offlineAction.before.currentProjectId
        && offlineAction.after.currentProjectName === offlineAction.before.currentProjectName,
      message: '오프라인 초안 인계 동작이 비활성 사유 또는 identity를 보존하지 못했습니다.' },
      ...[readonlyLayoutB, layoutA, layoutB, layoutWide].flatMap((layout, index) => [
        { ok: layout.bannerVisible, message: `viewport ${index + 1}에서 충돌 배너가 보이지 않습니다.` },
        { ok: requiredActions.every(label => layout.actionLabels.includes(label)), message: `viewport ${index + 1}에서 충돌 복구 동작이 누락되었습니다.` },
        { ok: layout.actionsReachable && !layout.actionTextClipped && layout.mainScrollable && layout.reachedBottom, message: `viewport ${index + 1}에서 동작이나 본문 하단에 도달할 수 없습니다.` },
        { ok: layout.horizontalOverflow <= 1 && layout.mainHorizontalOverflow <= 1, message: `viewport ${index + 1}에 가로 넘침이 있습니다.` },
        { ok: layout.loadErrorCount === 0 && layout.brokenImageCount === 0, message: `viewport ${index + 1}에 로드 오류 또는 깨진 이미지가 있습니다.` },
        { ok: layout.owner?.title && layout.owner.oneLine && layout.owner.whiteSpace === 'nowrap'
          && layout.owner.textOverflow === 'ellipsis' && layout.owner.overflowX === 'hidden',
        message: `viewport ${index + 1}에서 편집 창 이름이 한 줄 말줄임 경계를 벗어났습니다.` },
      ]),
    ];
    assertChecks(checks);
    const proof = {
      projectId,
      authorityA,
      authorityB,
      savedA,
      postTakeoverA,
      postTakeoverB,
      layoutA,
      layoutB,
      readonlyLayoutB,
      layoutWide,
      server: { revision: server.revision, productName: serverProductName },
      actions: { refresh: refreshAction, readonly: readonlyAction, saveCopy: saveCopyAction, offline: offlineAction },
      screenshots: [readonlyScreenshotB, screenshotA, screenshotB, screenshotWide],
      checks,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'workspace-conflict-browser.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    pageA.close();
    pageB.close();
    pageC?.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
