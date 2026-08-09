const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9355';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-competitor-candidate-pointer-v588.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-competitor-candidate-pointer-v588.png');
const BRANCH_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-competitor-candidate-document-lock-branch-v588.png');

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pointerClick(cdp, selector) {
  await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const point = await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const top = document.elementFromPoint(x, y);
    return {
      x,
      y,
      text: node.textContent.trim(),
      disabled: !!node.disabled,
      topAction: top?.closest?.('[data-comp-market-toggle-result]')?.getAttribute('data-comp-market-toggle-result') || '',
      elementsAtPoint: document.elementsFromPoint(x, y).slice(0, 6).map(item => ({
        tag: item.tagName,
        className: String(item.className || '').slice(0, 96),
      })),
    };
  })()`);
  if (!point) throw new Error(`competitor candidate button not found: ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  return point;
}

async function openFixture(cdp) {
  await cdp.send('Page.navigate', {
    url: `${APP_URL}?competitorCandidatePointer=v588&nonce=${Date.now()}`,
  });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryRuntimeCompetitorMarketAction)', 60000);
  await evaluate(cdp, '(async () => { if (document.fonts?.ready) await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; })()');
}

async function seedCandidate(cdp) {
  return evaluateFactoryCdpFixture(cdp, `async ({ setAppState, cloneFactory, replaceFactory, renderApp }) => {
    const workspaceId = 'competitor-candidate-pointer-workspace-v588';
    const productName = '경쟁사 후보 선택 포인터 검증';
    const candidateId = 'competitor-candidate-v588';
    const imageFingerprint = 'competitor-candidate-pointer-image-v588';
    const candidate = {
      id: candidateId,
      product_id: candidateId,
      platform: 'coupang',
      title: '포인터 클릭 검증 복주머니 후보',
      product_url: 'https://example.invalid/competitor-candidate-v588',
      price: '12000',
      similarity_score: 98,
      _search_runtime: 'vm',
      sourceLabel: 'VM 결과',
    };
    const factory = cloneFactory();
    factory.workspace = { ...(factory.workspace || {}), id: workspaceId, name: '경쟁사 후보 선택 포인터 검증' };
    factory.currentProjectId = workspaceId;
    factory.product = {
      ...(factory.product || {}),
      productName,
      userProductName: productName,
      productKey: factoryNormalizeIdentityText(productName),
      currentRunId: 'competitor-candidate-pointer-run-v588',
      generationRunId: 'competitor-candidate-pointer-run-v588',
      inputImageFingerprint: imageFingerprint,
      lockedInputImageFingerprint: imageFingerprint,
    };
    factory.automation = {
      ...(factory.automation || {}),
      activeTab: 'competitor',
      activeTaskId: 'competitor-candidates',
      currentRunId: 'competitor-candidate-pointer-run-v588',
      competitorPanelOpen: false,
    };
    factory.goalRun = {
      ...(factory.goalRun || {}),
      currentRunId: 'competitor-candidate-pointer-run-v588',
      running: false,
      progress: 0,
    };
    factory.compPage = {
      ...(factory.compPage || {}),
      marketScrape: {
        ...(factory.compPage?.marketScrape || {}),
        collectMode: 'vm',
        candidateView: 'vm',
        topN: 3,
        totalTarget: 3,
        marketTargets: { coupang: 3, naver: 3, gmarket: 3, auction: 3, elevenst: 3 },
        sessionId: 'competitor-candidate-pointer-session-v588',
        searchId: 'competitor-candidate-pointer-search-v588',
        results: [candidate],
        vmResults: [candidate],
        localResults: [],
        groupedResults: { coupang: [candidate] },
        vmGroupedResults: { coupang: [candidate] },
        localGroupedResults: {},
        selectedIds: [],
        selectedImageIds: [],
        scrapedImages: [],
        loading: false,
        error: '',
        lastUpdatedAt: Date.now(),
      },
    };
    setAppState({
      step: 'factory',
      currentProjectId: workspaceId,
      currentProjectName: '경쟁사 후보 선택 포인터 검증',
      productName,
      compPage: structuredClone(factory.compPage),
    });
    window.scheduleLastWorkSave = () => {};
    window.saveLastWorkNow = () => {};
    replaceFactory(factory, { mode: 'hydrate', workspaceId, takeoverAuthority: null });
    window.__competitorCandidatePointerTrace = [];
    const capture = event => {
      const node = event.target?.closest?.('[data-comp-market-toggle-result]');
      if (!node) return;
      window.__competitorCandidatePointerTrace.push({
        phase: event.eventPhase,
        trusted: event.isTrusted,
        candidateId: node.dataset.compMarketToggleResult || '',
        defaultPrevented: event.defaultPrevented,
      });
    };
    window.addEventListener('click', capture, true);
    window.__removeCompetitorCandidatePointerTrace = () => window.removeEventListener('click', capture, true);
    await renderApp();
    return { workspaceId, candidateId };
  }`);
}

async function readState(cdp, candidateId) {
  return evaluate(cdp, `(() => {
    const viewSnapshot = typeof factoryRuntimeReadViewSnapshot === 'function'
      ? factoryRuntimeReadViewSnapshot()
      : null;
    const factory = viewSnapshot?.factory || (typeof factoryRuntimeReadFactory === 'function'
      ? factoryRuntimeReadFactory()
      : window.factoryState?.());
    const competitorSlice = viewSnapshot?.competitors || {};
    const legacyFactory = window.factoryState?.();
    const market = competitorSlice?.compPage?.marketScrape || factory?.compPage?.marketScrape || {};
    const factoryMarket = factory?.compPage?.marketScrape || {};
    const legacyMarket = legacyFactory?.compPage?.marketScrape || {};
    const candidate = document.querySelector('[data-comp-market-toggle-result="${candidateId}"]');
    const detail = document.querySelector('[data-comp-market-quick-action="detail-vm"]');
    return {
      selectedIds: Array.isArray(market.selectedIds) ? market.selectedIds.slice() : [],
      selectionVersion: Number(market.detailSelectionVersion || 0),
      factorySelectedIds: Array.isArray(factoryMarket.selectedIds) ? factoryMarket.selectedIds.slice() : [],
      legacySelectedIds: Array.isArray(legacyMarket.selectedIds) ? legacyMarket.selectedIds.slice() : [],
      candidateText: candidate?.textContent?.trim() || '',
      candidateDisabled: !!candidate?.disabled,
      detailText: detail?.textContent?.trim() || '',
      detailDisabled: !!detail?.disabled,
      trace: window.__competitorCandidatePointerTrace || [],
      error: String(window.state?.error || market.error || ''),
      activeTab: factory?.automation?.activeTab || '',
    };
  })()`);
}

async function invokeSelectedDetailCapture(cdp) {
  return evaluate(cdp, `(async () => {
    const original = runCompMarketDetailCapture;
    const calls = [];
    try {
      runCompMarketDetailCapture = async (ids, options) => {
        calls.push({ ids: Array.isArray(ids) ? ids.map(String) : [], runtime: String(options?.runtime || '') });
        return { intercepted: true };
      };
      const receipt = await factoryRuntimeCompetitorMarketAction({ type: 'quick-action', action: 'detail-vm' });
      return {
        calls,
        receiptValue: receipt?.value || null,
        error: String(window.state?.error || ''),
      };
    } finally {
      runCompMarketDetailCapture = original;
    }
  })()`);
}

async function startDelayedLegacyCompetitorCompletion(cdp) {
  return evaluate(cdp, `(async () => {
    let release = null;
    const completion = new Promise(resolve => { release = resolve; });
    const action = factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:market:quick-action',
      undefined,
      () => completion,
    );
    window.__competitorCandidatePointerLegacyCompletion = {
      release: () => release?.({ ok: true }),
      action,
    };
    await Promise.resolve();
    return {
      started: typeof release === 'function',
      selectedIds: factoryRuntimeReadViewSnapshot()?.competitors?.compPage?.marketScrape?.selectedIds || [],
    };
  })()`);
}

async function finishDelayedLegacyCompetitorCompletion(cdp) {
  return evaluate(cdp, `(async () => {
    const pending = window.__competitorCandidatePointerLegacyCompletion;
    if (!pending?.release || !pending?.action) throw new Error('delayed legacy competitor completion was not started');
    pending.release();
    await pending.action;
    return true;
  })()`);
}

async function enterReadOnlyCandidateState(cdp, workspaceId) {
  return evaluateFactoryCdpFixture(cdp, `async ({ renderApp }) => {
    const scopeId = 'project:' + ${JSON.stringify(workspaceId)};
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    const editing = await window.ensureWorkspaceEditAuthority(scopeId, { force: true });
    await lock.release();
    const readonly = lock.openReadOnly('경쟁사 후보 선택은 편집권이 필요합니다.');
    await renderApp();
    return { editing, readonly, mode: lock.snapshot().mode };
  }`);
}

async function readReadOnlyRecoveryState(cdp, candidateId) {
  return evaluate(cdp, `(() => {
    const card = document.querySelector('.work-identity-float');
    const takeover = card?.querySelector('[data-workspace-authority-action="takeover"]');
    const container = document.querySelector('.container');
    const candidate = document.querySelector('[data-comp-market-toggle-result="${candidateId}"]');
    const viewSnapshot = factoryRuntimeReadViewSnapshot();
    const market = viewSnapshot?.competitors?.compPage?.marketScrape || {};
    const cardRect = card?.getBoundingClientRect?.();
    const interactiveOverlaps = [...document.querySelectorAll('.container button,.container [role="button"],.container a,.container input,.container select,.container textarea')]
      .filter(node => node !== takeover && !card?.contains(node))
      .filter(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .map(node => {
        const rect = node.getBoundingClientRect();
        const overlaps = !!cardRect && rect.left < cardRect.right && rect.right > cardRect.left && rect.top < cardRect.bottom && rect.bottom > cardRect.top;
        return overlaps ? {
          tag: node.tagName,
          text: (node.textContent || node.getAttribute('aria-label') || node.value || '').trim().slice(0, 96),
          rect: { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
        } : null;
      })
      .filter(Boolean);
    return {
      mode: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.().mode || '',
      containerInert: !!container?.hasAttribute('inert'),
      selectedIds: Array.isArray(market.selectedIds) ? market.selectedIds.slice() : [],
      candidateText: candidate?.textContent?.trim() || '',
      identityAuthority: card?.dataset?.workspaceAuthority || '',
      identityAuthorityText: card?.querySelector('.work-identity-authority')?.textContent?.trim() || '',
      takeoverPresent: !!takeover,
      takeoverDisabled: !!takeover?.disabled,
      takeoverInsideInertContainer: !!takeover?.closest('.container'),
      cardRect: cardRect ? { left: Math.round(cardRect.left), top: Math.round(cardRect.top), right: Math.round(cardRect.right), bottom: Math.round(cardRect.bottom) } : null,
      interactiveOverlaps,
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let proof;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 920,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1280,
      screenHeight: 920,
    });
    await openFixture(cdp);
    const seed = await seedCandidate(cdp);
    const selector = `[data-comp-market-toggle-result="${seed.candidateId}"]`;
    await waitFor(cdp, `!!document.querySelector(${JSON.stringify(selector)}) && !!document.querySelector('[data-comp-market-quick-action="detail-vm"]')`, 10000);
    const before = await readState(cdp, seed.candidateId);
    const firstPointer = await pointerClick(cdp, selector);
    await pause(450);
    const selected = await readState(cdp, seed.candidateId);
    const selectedShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(selectedShot.data, 'base64'));
    await evaluate(cdp, '(async () => { await Promise.resolve(window.render()); return true; })()');
    await pause(700);
    const rerendered = await readState(cdp, seed.candidateId);
    const detailInvocation = await invokeSelectedDetailCapture(cdp);
    const secondPointer = await pointerClick(cdp, selector);
    await pause(450);
    const cleared = await readState(cdp, seed.candidateId);
    const delayedLegacyStart = await startDelayedLegacyCompetitorCompletion(cdp);
    const delayedLegacyPointer = await pointerClick(cdp, selector);
    await pause(450);
    const selectedDuringLegacyCompletion = await readState(cdp, seed.candidateId);
    await finishDelayedLegacyCompetitorCompletion(cdp);
    await pause(450);
    const afterLegacyCompletion = await readState(cdp, seed.candidateId);
    const detailInvocationAfterLegacy = await invokeSelectedDetailCapture(cdp);
    const clearBeforeReadonlyPointer = await pointerClick(cdp, selector);
    await pause(450);
    const clearedBeforeReadonly = await readState(cdp, seed.candidateId);
    const enteredReadOnly = await enterReadOnlyCandidateState(cdp, seed.workspaceId);
    const readonlyBeforePointer = await readReadOnlyRecoveryState(cdp, seed.candidateId);
    const readonlyShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(BRANCH_SCREENSHOT_PATH, Buffer.from(readonlyShot.data, 'base64'));
    const readonlyPointer = await pointerClick(cdp, selector);
    await pause(300);
    const readonlyAfterPointer = await readReadOnlyRecoveryState(cdp, seed.candidateId);
    const readonlySelection = await readState(cdp, seed.candidateId);
    proof = {
      seed,
      before,
      firstPointer,
      selected,
      rerendered,
      detailInvocation,
      secondPointer,
      cleared,
      delayedLegacyStart,
      delayedLegacyPointer,
      selectedDuringLegacyCompletion,
      afterLegacyCompletion,
      detailInvocationAfterLegacy,
      clearBeforeReadonlyPointer,
      clearedBeforeReadonly,
      enteredReadOnly,
      readonlyBeforePointer,
      readonlyPointer,
      readonlyAfterPointer,
      readonlySelection,
    };
  } finally {
    try { await evaluate(cdp, 'window.__removeCompetitorCandidatePointerTrace?.()'); } catch (_) {}
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
  const checks = [
    { ok: proof.before.selectedIds.length === 0, message: `fixture did not begin unselected: ${JSON.stringify(proof.before.selectedIds)}` },
    { ok: proof.before.detailDisabled, message: 'fixture detail action was not disabled before a candidate was selected' },
    { ok: proof.firstPointer.topAction === proof.seed.candidateId, message: `first pointer was intercepted: ${JSON.stringify(proof.firstPointer.elementsAtPoint)}` },
    { ok: proof.selected.trace.length === 1 && proof.selected.trace[0]?.trusted === true, message: `first candidate click was not one trusted pointer event: ${JSON.stringify(proof.selected.trace)}` },
    { ok: proof.selected.selectedIds.join(',') === proof.seed.candidateId, message: `first click did not persist selection: ${JSON.stringify(proof.selected.selectedIds)}` },
    { ok: proof.selected.candidateText.includes('선택됨 - 해제'), message: `first click did not refresh candidate label: ${proof.selected.candidateText}` },
    { ok: proof.selected.detailText.includes('선택 1건 VM 상세수집') && !proof.selected.detailDisabled, message: `first click did not unlock VM detail collection: ${proof.selected.detailText} disabled=${proof.selected.detailDisabled}` },
    { ok: !proof.selected.error, message: `first click reported runtime error: ${proof.selected.error}` },
    { ok: proof.rerendered.selectedIds.join(',') === proof.seed.candidateId, message: `selection was lost by full application render: ${JSON.stringify(proof.rerendered.selectedIds)}` },
    { ok: proof.rerendered.candidateText.includes('선택됨 - 해제'), message: `full application render did not retain selected candidate label: ${proof.rerendered.candidateText}` },
    { ok: proof.rerendered.detailText.includes('선택 1건 VM 상세수집') && !proof.rerendered.detailDisabled, message: `full application render disabled VM detail collection: ${proof.rerendered.detailText} disabled=${proof.rerendered.detailDisabled}` },
    { ok: proof.detailInvocation.calls.length === 1 && proof.detailInvocation.calls[0]?.ids.join(',') === proof.seed.candidateId, message: `VM detail collection did not receive the selected candidate: ${JSON.stringify(proof.detailInvocation.calls)}` },
    { ok: !proof.detailInvocation.error, message: `VM detail collection selection handoff reported runtime error: ${proof.detailInvocation.error}` },
    { ok: proof.secondPointer.topAction === proof.seed.candidateId, message: `second pointer was intercepted: ${JSON.stringify(proof.secondPointer.elementsAtPoint)}` },
    { ok: proof.cleared.trace.length === 2 && proof.cleared.trace.every(item => item.trusted), message: `repeat click did not remain exactly one trusted event per click: ${JSON.stringify(proof.cleared.trace)}` },
    { ok: proof.cleared.selectedIds.length === 0, message: `second click did not clear selection: ${JSON.stringify(proof.cleared.selectedIds)}` },
    { ok: proof.cleared.detailDisabled && proof.cleared.detailText.includes('선택 0건 VM 상세수집'), message: `second click did not restore disabled detail action: ${proof.cleared.detailText} disabled=${proof.cleared.detailDisabled}` },
    { ok: !proof.cleared.error, message: `repeat click reported runtime error: ${proof.cleared.error}` },
    { ok: proof.delayedLegacyStart.started, message: `delayed legacy completion did not start: ${JSON.stringify(proof.delayedLegacyStart)}` },
    { ok: proof.delayedLegacyPointer.topAction === proof.seed.candidateId, message: `candidate pointer was intercepted while legacy completion waited: ${JSON.stringify(proof.delayedLegacyPointer.elementsAtPoint)}` },
    { ok: proof.selectedDuringLegacyCompletion.selectedIds.join(',') === proof.seed.candidateId, message: `candidate selection did not apply while legacy completion waited: ${JSON.stringify(proof.selectedDuringLegacyCompletion.selectedIds)}` },
    { ok: proof.afterLegacyCompletion.selectedIds.join(',') === proof.seed.candidateId, message: `stale legacy completion erased a newer candidate selection: ${JSON.stringify(proof.afterLegacyCompletion.selectedIds)}` },
    { ok: proof.afterLegacyCompletion.detailText.includes('선택 1건 VM 상세수집') && !proof.afterLegacyCompletion.detailDisabled, message: `stale legacy completion disabled VM detail capture: ${proof.afterLegacyCompletion.detailText} disabled=${proof.afterLegacyCompletion.detailDisabled}` },
    { ok: proof.detailInvocationAfterLegacy.calls.length === 1 && proof.detailInvocationAfterLegacy.calls[0]?.ids.join(',') === proof.seed.candidateId, message: `stale legacy completion broke VM detail collection handoff: ${JSON.stringify(proof.detailInvocationAfterLegacy.calls)}` },
    { ok: proof.clearedBeforeReadonly.selectedIds.length === 0 && proof.clearedBeforeReadonly.detailDisabled, message: `candidate selection did not clear before readonly guard: ${JSON.stringify(proof.clearedBeforeReadonly)}` },
    { ok: proof.enteredReadOnly.mode === 'readonly' && !proof.readonlyBeforePointer.containerInert, message: `document lock incorrectly blocked the independent tab branch: ${JSON.stringify(proof.readonlyBeforePointer)}` },
    { ok: proof.readonlyBeforePointer.identityAuthority === 'offline-edit' && proof.readonlyBeforePointer.identityAuthorityText.includes('로컬 초안 편집 중'), message: `identity card confused a document lock with the active tab branch: ${JSON.stringify(proof.readonlyBeforePointer)}` },
    { ok: !proof.readonlyBeforePointer.takeoverPresent, message: `document takeover was exposed for an independent tab branch: ${JSON.stringify(proof.readonlyBeforePointer)}` },
    { ok: proof.readonlyBeforePointer.interactiveOverlaps.length === 0, message: `tab branch identity card masks visible container controls: ${JSON.stringify(proof.readonlyBeforePointer.interactiveOverlaps)}` },
    { ok: proof.readonlyPointer.topAction === proof.seed.candidateId, message: `tab branch candidate pointer was intercepted: ${JSON.stringify(proof.readonlyPointer.elementsAtPoint)}` },
    { ok: proof.readonlyAfterPointer.selectedIds.join(',') === proof.seed.candidateId, message: `document lock blocked candidate selection in the independent tab branch: ${JSON.stringify(proof.readonlyAfterPointer)}` },
    { ok: proof.readonlySelection.detailText.includes('선택 1건 VM 상세수집') && !proof.readonlySelection.detailDisabled, message: `document lock disabled VM detail capture in the independent tab branch: ${proof.readonlySelection.detailText}` },
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  fs.writeFileSync(RESULT_PATH, `${JSON.stringify({ ok: failures.length === 0, proof, checks, failures, screenshotPath: SCREENSHOT_PATH, branchScreenshotPath: BRANCH_SCREENSHOT_PATH }, null, 2)}\n`, 'utf8');
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, branchScreenshotPath: BRANCH_SCREENSHOT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
