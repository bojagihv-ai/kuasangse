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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9475';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-no-auto-v186.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-no-auto-v186.png');
const SMALL_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-no-auto-v186-small.png');
const SMALL_RAIL_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-confirmation-no-auto-v186-small-rail.png');

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture(cdp, targetPath) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(targetPath, Buffer.from(screenshot.data, 'base64'));
}

async function clickCandidateButton(cdp) {
  const point = await evaluate(cdp, `(() => {
    const button = document.querySelector('[data-factory-apply-db-candidate="0"]');
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button.getBoundingClientRect();
    const factory = window.factoryState();
    const candidate = factory.product.pendingDbCandidates?.[0] || {};
    const top = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      text: button.textContent.trim(),
      disabled: button.disabled,
      hasOnClick: typeof button.onclick === 'function',
      selectable: window.factoryCandidateReviewCanApply(candidate, factory),
      candidateScope: window.factoryCandidateReviewScopeKeyFromCandidate(candidate),
      currentScope: window.factoryCandidateReviewScopeKey(factory),
      topTag: top?.tagName || '',
    };
  })()`);
  if (!point) throw new Error('신화사DB 후보 선택 버튼을 찾지 못했습니다.');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  return point;
}

async function seedCandidateReview(cdp) {
  return evaluate(cdp, `(() => {
    const productName = '후보확정 자동생성 차단 검증 수저집';
    const workspaceId = 'candidate-no-auto-workspace-v186';
    const runId = 'candidate-no-auto-run-v186';
    const inputImageFingerprint = 'candidate-no-auto-image-v186';
    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = '후보 확정 대기 검증';
    window.state.productName = productName;
    window.state.factory = window.normalizeFactoryState({});
    const factory = window.factoryState();
    factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
    factory.currentProjectId = workspaceId;
    factory.product = {
      ...(factory.product || {}),
      productName,
      userProductName: productName,
      productKey: window.factoryNormalizeIdentityText(productName),
      productIdentityKey: window.factoryNormalizeIdentityText(productName),
      currentRunId: runId,
      generationRunId: runId,
      inputImageFingerprint,
      lockedInputImageFingerprint: inputImageFingerprint,
      selectedDbCandidateKey: '',
      selectedCafe24CandidateKey: '',
      dbCandidateResolution: '',
      cafe24CandidateResolution: '',
      confirmedDb: null,
      confirmedCafe24ProductKey: '',
      cafe24DraftProductKey: '',
      candidateAutoApply: false,
      candidateReviewStatus: '신화사DB 후보를 선택해 자동 생성 방지 동작을 확인합니다.',
    };
    factory.automation = { ...(factory.automation || {}), activeTab: 'db', sizeAutoRunRunning: false };
    factory.goalRun = { ...(factory.goalRun || {}), running: false, mode: 'review' };
    const candidate = {
      jcode: 'NOAUTO-DB-186',
      jname: '자동 생성 차단 검증 신화사DB 후보',
      product_name: '자동 생성 차단 검증 신화사DB 후보',
      score: 98,
      match_query: productName,
      reviewProductName: productName,
      reviewProductScopeKey: window.factoryCandidateReviewScopeKey(factory),
      reviewProductIdentityKey: window.factoryCandidateReviewIdentityKey(factory),
    };
    factory.product.pendingDbCandidates = [candidate];
    factory.product.dbCandidates = [];
    factory.product.pendingCafe24Candidates = [];
    factory.product.cafe24Candidates = [];
    window.__candidateNoAutoTrace = { stageCalls: [] };
    window.saveLastWorkNow = () => {};
    window.factoryHasSizeFacts = () => true;
    window.factoryAutomationSizeReviewStatus = () => ({ confirmed: true });
    window.factoryRunStage = async stageId => {
      window.__candidateNoAutoTrace.stageCalls.push(stageId);
      return true;
    };
    window.fetchSinhwaProductDetail = async () => ({ ...candidate });
    window.applySinhwaDbMatch = () => {};
    window.render();
    return {
      buttonCount: document.querySelectorAll('[data-factory-apply-db-candidate]').length,
      candidateKey: window.factorySinhwaCandidateKey(candidate),
    };
  })()`);
}

async function readProof(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState();
    const waitPanel = document.querySelector('[data-factory-candidate-size-wait]');
    waitPanel?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return {
      selectedDbCandidateKey: factory.product.selectedDbCandidateKey || '',
      dbResolution: factory.product.dbCandidateResolution || '',
      sizeStatus: factory.stages?.size?.status || '',
      sizeMessage: factory.stages?.size?.message || '',
      stageCalls: window.__candidateNoAutoTrace?.stageCalls || [],
      statusVisible: !!waitPanel && waitPanel.innerText.includes('사이즈이미지를 자동 생성하지 않습니다'),
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
    };
  })()`);
}

async function readSmallViewport(cdp) {
  return evaluate(cdp, `(() => {
    const waitPanel = document.querySelector('[data-factory-candidate-size-wait]');
    const layout = document.querySelector('.factory-page-layout');
    const rail = document.querySelector('.factory-run-status-rail');
    const main = document.querySelector('main.main');
    waitPanel?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const scrollableAncestors = [];
    for (let node = waitPanel?.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(style.overflowY)) {
        scrollableAncestors.push({ tag: node.tagName, id: node.id || '', className: node.className || '', scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: style.overflowY });
      }
    }
    const rect = waitPanel?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    const layoutStyle = layout ? getComputedStyle(layout) : null;
    const railStyle = rail ? getComputedStyle(rail) : null;
    const horizontalOverlap = !!rect && !!railRect && Math.max(0, Math.min(rect.right, railRect.right) - Math.max(rect.left, railRect.left));
    const verticalOverlap = !!rect && !!railRect && Math.max(0, Math.min(rect.bottom, railRect.bottom) - Math.max(rect.top, railRect.top));
    const railBelowWaitPanel = !!rect && !!railRect && railRect.top >= rect.bottom;
    rail?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const reachableRailRect = rail?.getBoundingClientRect();
    const railReachableInViewport = !!reachableRailRect && reachableRailRect.top >= 0 && reachableRailRect.bottom <= window.innerHeight;
    waitPanel?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollableAncestors,
      panelInViewport: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
      messageVisible: !!waitPanel && waitPanel.innerText.includes('사이즈이미지를 자동 생성하지 않습니다'),
      layout: layoutStyle ? { display: layoutStyle.display, flexDirection: layoutStyle.flexDirection } : null,
      main: main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, overflowY: getComputedStyle(main).overflowY } : null,
      rail: railStyle && railRect ? {
        position: railStyle.position,
        width: Math.round(railRect.width),
        height: Math.round(railRect.height),
        top: Math.round(railRect.top),
        bottom: Math.round(railRect.bottom),
        belowWaitPanel: railBelowWaitPanel,
        reachableInViewport: railReachableInViewport,
      } : null,
      railOverlapArea: horizontalOverlap * verticalOverlap,
    };
  })()`);
}

async function focusSmallRail(cdp) {
  return evaluate(cdp, `(() => {
    const rail = document.querySelector('.factory-run-status-rail');
    rail?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = rail?.getBoundingClientRect();
    return rect ? {
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    } : null;
  })()`);
}

async function restoreSmallWaitPanel(cdp) {
  return evaluate(cdp, `document.querySelector('[data-factory-candidate-size-wait]')?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidateNoAuto=v186` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryApplyDbCandidateFromReview && window.render)', 60000);
    const seed = await seedCandidateReview(cdp);
    if (seed.buttonCount !== 1) throw new Error(`후보 선택 버튼 시드 불일치: ${JSON.stringify(seed)}`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const click = await clickCandidateButton(cdp);
    await pause(550);
    const proof = await readProof(cdp);
    await pause(80);
    await capture(cdp, SCREENSHOT_PATH);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 620, deviceScaleFactor: 1, mobile: false });
    const small = await readSmallViewport(cdp);
    await pause(80);
    await capture(cdp, SMALL_SCREENSHOT_PATH);
    const smallRail = await focusSmallRail(cdp);
    await pause(80);
    await capture(cdp, SMALL_RAIL_SCREENSHOT_PATH);
    await restoreSmallWaitPanel(cdp);

    const checks = [
      { ok: proof.selectedDbCandidateKey === seed.candidateKey, message: proof.selectedDbCandidateKey === seed.candidateKey ? 'DB 후보 확정 확인' : `DB 후보가 확정되지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.dbResolution === 'selected', message: proof.dbResolution === 'selected' ? 'DB 후보 선택 상태 확인' : `DB 후보 선택 상태가 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.sizeStatus === 'blocked', message: proof.sizeStatus === 'blocked' ? '사이즈 단계 대기 상태 확인' : `사이즈 단계가 대기 상태가 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.statusVisible && /자동 생성하지 않습니다/.test(proof.sizeMessage), message: proof.statusVisible && /자동 생성하지 않습니다/.test(proof.sizeMessage) ? '자동 생성 차단 문구 확인' : `자동 생성 차단 문구가 화면/상태에 없습니다: ${JSON.stringify(proof)}` },
      { ok: proof.stageCalls.length === 0, message: proof.stageCalls.length === 0 ? '후보 확정 중 size 엔진 미호출 확인' : `후보 확정만으로 size 엔진이 호출되었습니다: ${JSON.stringify(proof)}` },
      { ok: small.messageVisible && small.panelInViewport && small.scrollableAncestors.length > 0, message: small.messageVisible && small.panelInViewport && small.scrollableAncestors.length > 0 ? '작은 화면의 대기 문구와 메인 세로 스크롤 확인' : `작은 화면에서 대기 문구 또는 세로 스크롤을 확인하지 못했습니다: ${JSON.stringify(small)}` },
      { ok: small.layout?.display === 'flex' && small.layout?.flexDirection === 'column' && small.rail?.position === 'static' && small.rail?.width > 0 && small.rail?.height > 0 && small.rail?.belowWaitPanel && small.rail?.reachableInViewport && smallRail?.inViewport && smallRail.width > 0 && smallRail.height > 0 && small.railOverlapArea === 0, message: small.layout?.display === 'flex' && small.layout?.flexDirection === 'column' && small.rail?.position === 'static' && small.rail?.width > 0 && small.rail?.height > 0 && small.rail?.belowWaitPanel && small.rail?.reachableInViewport && smallRail?.inViewport && smallRail.width > 0 && smallRail.height > 0 && small.railOverlapArea === 0 ? '작은 데스크톱에서 상태 레일의 아래 분리·도달 가능·겹침 없음 확인' : `작은 데스크톱에서 상태 레일이 본문과 겹치거나 스크롤 도달할 수 없습니다: ${JSON.stringify({ small, smallRail })}` },
    ];
    const result = {
      ok: checks.every(item => item.ok),
      click,
      proof,
      small,
      smallRail,
      screenshots: [SCREENSHOT_PATH, SMALL_SCREENSHOT_PATH, SMALL_RAIL_SCREENSHOT_PATH],
      checks,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    assertChecks(checks);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup?.();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
