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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9355';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-pointer-selection-v159.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-pointer-selection-v159.png');
const HIDDEN_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-stale-hidden-v159.png');
const READ_ONLY_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-readonly-recovery-v159.png');

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pointerClick(cdp, selector) {
  await evaluate(cdp, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button.getBoundingClientRect();
    const scroller = button.closest('.app') || document.scrollingElement;
    if (scroller && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      scroller.scrollTop += rect.top - ((window.innerHeight - rect.height) / 2);
    }
    return true;
  })()`);
  await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const point = await evaluate(cdp, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return null;
    button.addEventListener('click', event => {
      window.__candidatePointerTrace = Array.isArray(window.__candidatePointerTrace)
        ? window.__candidatePointerTrace
        : [];
      window.__candidatePointerTrace.push({
        phase: event.eventPhase,
        trusted: event.isTrusted,
        action: button.getAttribute('data-factory-apply-db-candidate') !== null ? 'db' : 'cafe24',
        targetTag: event.target?.tagName || '',
      });
    }, { capture: true, once: true });
    const rect = button.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const top = document.elementFromPoint(x, y);
    const buttonStyle = getComputedStyle(button);
    const ancestorDiagnostics = [];
    for (let current = button; current && current !== document.body; current = current.parentElement) {
      const style = getComputedStyle(current);
      const currentRect = current.getBoundingClientRect();
      const clipsPointer = ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX) || ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowY);
      const containsPointer = x >= currentRect.left && x <= currentRect.right && y >= currentRect.top && y <= currentRect.bottom;
      if (style.contentVisibility !== 'visible' || style.pointerEvents !== 'auto' || style.visibility !== 'visible' || (clipsPointer && !containsPointer)) {
        ancestorDiagnostics.push({
          tag: current.tagName,
          className: String(current.className || '').slice(0, 120),
          contentVisibility: style.contentVisibility,
          pointerEvents: style.pointerEvents,
          visibility: style.visibility,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          clipsPointer,
          containsPointer,
          rect: { left: currentRect.left, top: currentRect.top, right: currentRect.right, bottom: currentRect.bottom },
        });
      }
    }
    return {
      x,
      y,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      buttonText: button.textContent.trim(),
      topTag: top?.tagName || '',
      buttonStyle: {
        contentVisibility: buttonStyle.contentVisibility,
        pointerEvents: buttonStyle.pointerEvents,
        visibility: buttonStyle.visibility,
        display: buttonStyle.display,
      },
      elementsAtPoint: document.elementsFromPoint(x, y).slice(0, 8).map(element => ({
        tag: element.tagName,
        className: String(element.className || '').slice(0, 120),
      })),
      ancestorDiagnostics,
      topAction: top?.closest?.('[data-factory-apply-db-candidate],[data-factory-apply-cafe24-candidate]')?.getAttribute('data-factory-apply-db-candidate')
        ?? top?.closest?.('[data-factory-apply-db-candidate],[data-factory-apply-cafe24-candidate]')?.getAttribute('data-factory-apply-cafe24-candidate')
        ?? null,
    };
  })()`);
  if (!point) {
    const diagnostic = await evaluate(cdp, `(() => ({
      selector: ${JSON.stringify(selector)},
      buttonCount: document.querySelectorAll('[data-factory-apply-db-candidate],[data-factory-apply-cafe24-candidate]').length,
      pendingDbCount: window.factoryState()?.product?.pendingDbCandidates?.length || 0,
      pendingCafe24Count: window.factoryState()?.product?.pendingCafe24Candidates?.length || 0,
      activeTab: window.factoryState()?.automation?.activeTab || '',
    }))()`);
    throw new Error(`candidate button not found: ${selector} ${JSON.stringify(diagnostic)}`);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  return point;
}

async function seedCandidateReview(cdp, mode, type) {
  const marker = `후보 마커 ${mode} ${type}`;
  const seeded = await evaluate(cdp, `(() => {
    const mode = ${JSON.stringify(mode)};
    const type = ${JSON.stringify(type)};
    const marker = ${JSON.stringify(marker)};
    const productName = '포인터 후보 선택 검증 수저집';
    const workspaceId = 'candidate-pointer-workspace-v159';
    const runId = 'candidate-pointer-run-v159';
    const inputImageFingerprint = 'candidate-pointer-image-v159';
    const factory = window.factoryState();
    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = '포인터 후보 선택 검증';
    window.state.productName = productName;
    factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
    factory.currentProjectId = workspaceId;
    factory.product = {
      ...(factory.product || {}),
      productName,
      userProductName: productName,
      productKey: window.factoryNormalizeIdentityText(productName),
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
      candidateReviewStatus: '포인터 후보 선택 검증: 신화사DB 1건 · Cafe24 1건.',
    };
    factory.automation = { ...(factory.automation || {}), activeTab: 'db', currentRunId: runId };
    factory.goalRun = { ...(factory.goalRun || {}), currentRunId: runId };
    factory.archive = { ...(factory.archive || {}), localRunId: '' };
    const reviewProductIdentityKey = window.factoryCandidateReviewIdentityKey(factory);
    const reviewProductScopeKey = window.factoryCandidateReviewScopeKey(factory);
    const dbCandidate = {
      jcode: 'PTR-DB-159',
      jname: marker + ' 신화사DB 후보',
      product_name: marker + ' 신화사DB 후보',
      score: 97,
      match_query: productName,
      reviewProductScopeKey,
      reviewProductIdentityKey,
      reviewProductName: productName,
    };
    const cafeCandidate = {
      product_no: 'P0000PTR159',
      product_code: 'P0000PTR159',
      product_name: marker + ' Cafe24 후보',
      price: '14000',
      score: 96,
      match_query: productName,
      reviewProductScopeKey,
      reviewProductIdentityKey,
      reviewProductName: productName,
    };
    factory.product.pendingDbCandidates = [dbCandidate];
    factory.product.dbCandidates = [];
    factory.product.pendingCafe24Candidates = [cafeCandidate];
    factory.product.cafe24Candidates = [];
    window.__candidatePointerTrace = [];
    window.saveLastWorkNow = () => {};
    window.factoryScheduleSizeCutAfterCandidateConfirm = () => {};
    window.applySinhwaDbMatch = () => {};
    window.fetchSinhwaProductDetail = async () => ({ ...dbCandidate });
    window.fetchCafe24ProductFullByNo = async () => { throw new Error('pointer test detail intentionally unavailable'); };
    if (mode === 'stale-run-legacy') {
      delete dbCandidate.reviewProductScopeKey;
      delete cafeCandidate.reviewProductScopeKey;
      factory.product.currentRunId = '';
      factory.product.generationRunId = '';
      factory.product.inputImageFingerprint = '';
      factory.product.lockedInputImageFingerprint = '';
      factory.automation.currentRunId = '';
      factory.goalRun.currentRunId = '';
    }
    if (mode === 'run-advanced') {
      const advancedRunId = runId + '-advanced';
      const advancedFingerprint = inputImageFingerprint + '-advanced';
      factory.product.currentRunId = advancedRunId;
      factory.product.generationRunId = advancedRunId;
      factory.product.inputImageFingerprint = advancedFingerprint;
      factory.product.lockedInputImageFingerprint = advancedFingerprint;
      factory.automation.currentRunId = advancedRunId;
      factory.goalRun.currentRunId = advancedRunId;
    }
    if (mode === 'product-mismatch') {
      const otherProductName = '다른 제품';
      window.factorySetCurrentProductIdentity(otherProductName, {
        factory,
        productKey: otherProductName,
        rotateWorkIdentity: true,
        syncState: true,
        syncDom: false,
      });
    }
    window.render();
    return {
      mode,
      type,
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      reviewProductIdentityKey,
      currentIdentityKey: window.factoryCandidateReviewIdentityKey(window.factoryState()),
      marker,
    };
  })()`);
  const selector = '[data-factory-apply-db-candidate],[data-factory-apply-cafe24-candidate]';
  if (mode === 'product-mismatch') {
    await waitFor(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length === 0`, 10000)
      .catch(async error => {
        const mismatchState = await evaluate(cdp, `(() => ({
          buttonCount: document.querySelectorAll(${JSON.stringify(selector)}).length,
          reviewText: document.querySelector('.factory-candidate-review')?.textContent?.trim().slice(0, 500) || '',
          productName: window.factoryState()?.product?.productName || '',
          currentScopeKey: window.factoryCandidateReviewScopeKey(window.factoryState()),
          dbScopeKey: window.factoryState()?.product?.pendingDbCandidates?.[0]?.reviewProductScopeKey || '',
          cafeScopeKey: window.factoryState()?.product?.pendingCafe24Candidates?.[0]?.reviewProductScopeKey || '',
        }))()`);
        throw new Error(`${error.message}: ${JSON.stringify(mismatchState)}`);
      });
  } else {
    await waitFor(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length === 2
      && !!document.querySelector('.factory-candidate-review')?.textContent?.includes(${JSON.stringify(marker)})`, 10000);
  }
  const settled = await evaluate(cdp, `(() => ({
    currentIdentityKey: window.factoryCandidateReviewIdentityKey(window.factoryState()),
    buttonCount: document.querySelectorAll(${JSON.stringify(selector)}).length,
    reviewText: document.querySelector('.factory-candidate-review')?.textContent?.trim().slice(0, 500) || '',
  }))()`);
  return { ...seeded, ...settled };
}

async function readSelection(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState();
    const dbReviewCandidates = factory.product.pendingDbCandidates?.length
      ? factory.product.pendingDbCandidates
      : (factory.product.dbCandidates || []);
    const cafe24ReviewCandidates = factory.product.pendingCafe24Candidates?.length
      ? factory.product.pendingCafe24Candidates
      : (factory.product.cafe24Candidates || []);
    return {
      selectedDbCandidateKey: factory.product.selectedDbCandidateKey || '',
      selectedCafe24CandidateKey: factory.product.selectedCafe24CandidateKey || '',
      dbCandidateResolution: factory.product.dbCandidateResolution || '',
      cafe24CandidateResolution: factory.product.cafe24CandidateResolution || '',
      candidateReviewStatus: factory.product.candidateReviewStatus || '',
      trace: window.__candidatePointerTrace || [],
      dbButtonText: document.querySelector('[data-factory-apply-db-candidate="0"]')?.textContent?.trim() || '',
      cafeButtonText: document.querySelector('[data-factory-apply-cafe24-candidate="0"]')?.textContent?.trim() || '',
      dbButtonDisabled: !!document.querySelector('[data-factory-apply-db-candidate="0"]')?.disabled,
      cafeButtonDisabled: !!document.querySelector('[data-factory-apply-cafe24-candidate="0"]')?.disabled,
      dbClearButtonCount: document.querySelectorAll('[data-factory-clear-db-candidate]').length,
      cafeClearButtonCount: document.querySelectorAll('[data-factory-clear-cafe24-candidate]').length,
      dbClearButtonDisabled: !!document.querySelector('[data-factory-clear-db-candidate]')?.disabled,
      cafeClearButtonDisabled: !!document.querySelector('[data-factory-clear-cafe24-candidate]')?.disabled,
      dbNoCandidateText: document.querySelector('[data-factory-confirm-no-db-candidate]')?.textContent?.trim() || '',
      cafeNoCandidateText: document.querySelector('[data-factory-confirm-no-cafe24-candidate]')?.textContent?.trim() || '',
      dbNoCandidateDisabled: !!document.querySelector('[data-factory-confirm-no-db-candidate]')?.disabled,
      cafeNoCandidateDisabled: !!document.querySelector('[data-factory-confirm-no-cafe24-candidate]')?.disabled,
      pendingDbCandidateCount: factory.product.pendingDbCandidates?.length || 0,
      pendingCafe24CandidateCount: factory.product.pendingCafe24Candidates?.length || 0,
      dbReviewCandidateCount: dbReviewCandidates.length,
      cafe24ReviewCandidateCount: cafe24ReviewCandidates.length,
      stateError: window.state?.error || '',
      operationRevision: window.factoryRuntimeStore?.getOperationToken?.()?.revision ?? null,
    };
  })()`);
}

async function openCandidatePointerPage(cdp, caseId) {
  await cdp.send('Page.navigate', {
    url: `${APP_URL}?candidatePointer=v159&case=${encodeURIComponent(caseId)}&nonce=${Date.now()}`,
  });
  await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryApplyDbCandidateFromReview && window.factoryApplyCafe24CandidateFromReview)', 60000);
  await evaluate(cdp, `(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
}

async function openProjectScopedCandidatePointerPage(cdp, caseId) {
  await openCandidatePointerPage(cdp, `${caseId}-scope-seed`);
  await evaluate(cdp, `(async () => {
    await window.__KUASANGSE_WORKSPACE_PERSISTENCE__.writeRecoveryValue(
      'pdp_last_work_draft_scope_v1',
      'project:candidate-pointer-workspace-v159',
    );
    return window.__KUASANGSE_WORKSPACE_PERSISTENCE__.readRecoveryValue('pdp_last_work_draft_scope_v1');
  })()`);
  await openCandidatePointerPage(cdp, caseId);
}

async function runCandidatePointerCase(cdp, mode, type) {
  await openCandidatePointerPage(cdp, `${mode}-${type}`);
  const seed = await seedCandidateReview(cdp, mode, type);
  const point = await pointerClick(cdp, `[data-factory-apply-${type === 'db' ? 'db' : 'cafe24'}-candidate="0"]`);
  await pause(180);
  return { seed, point, selection: await readSelection(cdp) };
}

async function runCandidateResolutionCase(cdp, type) {
  await openCandidatePointerPage(cdp, `resolution-${type}`);
  const seed = await seedCandidateReview(cdp, 'valid', type);
  const candidateType = type === 'db' ? 'db' : 'cafe24';
  const applyPoint = await pointerClick(cdp, `[data-factory-apply-${candidateType}-candidate="0"]`);
  await pause(180);
  const selected = await readSelection(cdp);
  const clearPoint = await pointerClick(cdp, `[data-factory-clear-${candidateType}-candidate]`);
  await pause(180);
  const cleared = await readSelection(cdp);
  const noCandidatePoint = await pointerClick(cdp, `[data-factory-confirm-no-${candidateType}-candidate]`);
  await pause(180);
  const absent = await readSelection(cdp);
  return { seed, applyPoint, selected, clearPoint, cleared, noCandidatePoint, absent };
}

async function runFieldsGuideActionCase(cdp) {
  await openCandidatePointerPage(cdp, 'fields-guide-action');
  const seed = await seedCandidateReview(cdp, 'valid', 'db');
  const point = await pointerClick(cdp, '[data-factory-guide-action="go-tab:fields"]');
  await pause(160);
  const state = await evaluate(cdp, `(() => ({
    activeTab: window.factoryState()?.automation?.activeTab || '',
    fieldsVisible: !!document.querySelector('[data-factory-tab="fields"], .factory-fields, [data-factory-fields]'),
  }))()`);
  return { seed, point, state };
}

async function enterReadOnlyCandidateState(cdp) {
  return evaluate(cdp, `(async () => {
    const scopeId = 'project:candidate-pointer-workspace-v159';
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    const editing = await window.ensureWorkspaceEditAuthority(scopeId, { force: true });
    if (editing?.mode !== 'editing') throw new Error('candidate pointer editing authority was not acquired: ' + (editing?.mode || 'missing'));
    await lock.release();
    const readonly = lock.openReadOnly('후보 선택과 필수값 이동은 편집권이 필요합니다.');
    await window.render();
    return { editing, readonly, mode: lock.snapshot().mode, scopeId: lock.snapshot().scopeId };
  })()`);
}

async function runReadOnlyActionCase(cdp) {
  await openProjectScopedCandidatePointerPage(cdp, 'readonly-actions');
  const seed = await seedCandidateReview(cdp, 'valid', 'db');
  const authority = await enterReadOnlyCandidateState(cdp);
  const before = await readSelection(cdp);
  const recovery = await evaluate(cdp, `(() => {
    const card = document.querySelector('.work-identity-float');
    const banner = document.querySelector('.workspace-authority-banner');
    const takeover = document.querySelector('[data-workspace-authority-action="takeover"]');
    const container = document.querySelector('.container');
    const rect = node => {
      const value = node?.getBoundingClientRect?.();
      return value ? { left: Math.round(value.left), top: Math.round(value.top), right: Math.round(value.right), bottom: Math.round(value.bottom) } : null;
    };
    return {
      containerInert: !!container?.hasAttribute('inert'),
      cardText: card?.textContent?.trim() || '',
      bannerText: banner?.textContent?.trim() || '',
      takeoverPresent: !!takeover,
      takeoverDisabled: !!takeover?.disabled,
      takeoverInsideInertContainer: !!takeover?.closest('.container'),
      takeoverRect: rect(takeover),
      cardRect: rect(card),
    };
  })()`);
  const readonlyScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(READ_ONLY_SCREENSHOT_PATH, Buffer.from(readonlyScreenshot.data, 'base64'));
  const applyPoint = await pointerClick(cdp, '[data-factory-apply-db-candidate="0"]');
  await pause(80);
  const noDbPoint = await pointerClick(cdp, '[data-factory-confirm-no-db-candidate]');
  await pause(80);
  const noCafePoint = await pointerClick(cdp, '[data-factory-confirm-no-cafe24-candidate]');
  await pause(80);
  const fieldsPoint = await pointerClick(cdp, '[data-factory-guide-action="go-tab:fields"]');
  await pause(120);
  const after = await readSelection(cdp);
  const takeoverPoint = await pointerClick(cdp, '[data-workspace-authority-action="takeover"]');
  await waitFor(cdp, `window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.().mode === 'editing'
    && !document.querySelector('.container')?.hasAttribute('inert')`, 10000);
  const recovered = await evaluate(cdp, `(() => ({
    mode: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.().mode || '',
    containerInert: !!document.querySelector('.container')?.hasAttribute('inert'),
  }))()`);
  const recoveredApplyPoint = await pointerClick(cdp, '[data-factory-apply-db-candidate="0"]');
  await pause(120);
  const recoveredSelection = await readSelection(cdp);
  return {
    seed, authority, before, recovery, applyPoint, noDbPoint, noCafePoint, fieldsPoint, after,
    takeoverPoint, recovered, recoveredApplyPoint, recoveredSelection,
  };
}

async function inspectCompactCandidateLayout(cdp) {
  return evaluate(cdp, `(async () => {
    const review = document.querySelector('.factory-candidate-review');
    const identity = document.querySelector('.work-identity-float');
    const rect = node => {
      const value = node?.getBoundingClientRect?.();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const intersects = (left, right) => !!left && !!right
      && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    const candidateLists = [...document.querySelectorAll('.factory-candidate-list')];
    const actions = review
      ? [...review.querySelectorAll('button:not([disabled]),a.btn-sm')]
      : [];
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const actionOverflow = actions.map(node => ({
      text: node.textContent.trim(),
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      rect: rect(node),
    }));
    const initialIdentityRect = rect(identity);
    const initialOverlaps = actionOverflow
      .filter(item => item.rect && item.rect.bottom > 0 && item.rect.top < viewport.height)
      .filter(item => intersects(initialIdentityRect, item.rect))
      .map(item => item.text);
    const lastAction = actions.at(-1) || null;
    if (lastAction) {
      lastAction.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const scrolledLastActionRect = rect(lastAction);
    const scrolledIdentityRect = rect(identity);
    const lastActionCoveredAfterScroll = intersects(scrolledIdentityRect, scrolledLastActionRect);
    review?.scrollIntoView({ block: 'start', inline: 'nearest' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      viewport,
      review: rect(review),
      identity: initialIdentityRect,
      candidateLists: candidateLists.map(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
      actionOverflow,
      initialOverlaps,
      scrolledLastActionRect,
      scrolledIdentityRect,
      lastActionCoveredAfterScroll,
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let proof = null;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 764,
      height: 485,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 764,
      screenHeight: 485,
    });
    const staleDb = await runCandidatePointerCase(cdp, 'stale-run-legacy', 'db');
    const staleCafe = await runCandidatePointerCase(cdp, 'stale-run-legacy', 'cafe24');
    const validDb = await runCandidatePointerCase(cdp, 'valid-run', 'db');
    const validCafe = await runCandidatePointerCase(cdp, 'valid-run', 'cafe24');
    const compactLayout = await inspectCompactCandidateLayout(cdp);
    await evaluate(cdp, "document.querySelector('.factory-candidate-review')?.scrollIntoView({ block: 'start' })");
    await pause(120);
    const selectedScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(selectedScreenshot.data, 'base64'));

    const runAdvancedDb = await runCandidatePointerCase(cdp, 'run-advanced', 'db');
    const runAdvancedCafe = await runCandidatePointerCase(cdp, 'run-advanced', 'cafe24');
    const resolutionDb = await runCandidateResolutionCase(cdp, 'db');
    const resolutionCafe = await runCandidateResolutionCase(cdp, 'cafe24');
    const fieldsGuideAction = await runFieldsGuideActionCase(cdp);
    const readOnlyActions = await runReadOnlyActionCase(cdp);
    await openCandidatePointerPage(cdp, 'product-mismatch-db');
    const productMismatch = {
      seed: await seedCandidateReview(cdp, 'product-mismatch', 'db'),
      selection: await readSelection(cdp),
    };

    proof = {
      staleDb,
      staleCafe,
      validDb,
      validCafe,
      compactLayout,
      runAdvancedDb,
      runAdvancedCafe,
      resolutionDb,
      resolutionCafe,
      fieldsGuideAction,
      readOnlyActions,
      productMismatch,
    };
    await evaluate(cdp, "document.querySelector('.factory-candidate-review')?.scrollIntoView({ block: 'start' })");
    await pause(120);
    const hiddenScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(HIDDEN_SCREENSHOT_PATH, Buffer.from(hiddenScreenshot.data, 'base64'));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }

  const hasTrustedTrace = result => result.selection.trace.some(entry => entry.trusted && entry.action === result.seed.type);
  const checks = [
    { ok: proof.staleDb.seed.buttonCount === 2, message: `same-product legacy DB candidate buttons missing: ${proof.staleDb.seed.buttonCount}` },
    { ok: proof.staleCafe.seed.buttonCount === 2, message: `same-product legacy Cafe24 candidate buttons missing: ${proof.staleCafe.seed.buttonCount}` },
    { ok: proof.staleDb.point.topTag === 'BUTTON', message: `legacy DB pointer was intercepted by ${proof.staleDb.point.topTag}` },
    { ok: proof.staleCafe.point.topTag === 'BUTTON', message: `legacy Cafe24 pointer was intercepted by ${proof.staleCafe.point.topTag}` },
    { ok: hasTrustedTrace(proof.staleDb), message: 'same-product legacy DB did not receive a trusted pointer click event' },
    { ok: hasTrustedTrace(proof.staleCafe), message: 'same-product legacy Cafe24 did not receive a trusted pointer click event' },
    { ok: proof.staleDb.selection.trace.length === 1, message: `legacy DB physical click was observed ${proof.staleDb.selection.trace.length} times` },
    { ok: proof.staleCafe.selection.trace.length === 1, message: `legacy Cafe24 physical click was observed ${proof.staleCafe.selection.trace.length} times` },
    { ok: proof.staleDb.selection.selectedDbCandidateKey === 'PTR-DB-159', message: `same-product legacy DB candidate was not selected: ${proof.staleDb.selection.selectedDbCandidateKey}` },
    { ok: proof.staleCafe.selection.selectedCafe24CandidateKey === 'P0000PTR159', message: `same-product legacy Cafe24 candidate was not selected: ${proof.staleCafe.selection.selectedCafe24CandidateKey}` },
    { ok: proof.validDb.point.topTag === 'BUTTON', message: `valid DB pointer was intercepted by ${proof.validDb.point.topTag}` },
    { ok: proof.validCafe.point.topTag === 'BUTTON', message: `valid Cafe24 pointer was intercepted by ${proof.validCafe.point.topTag}` },
    { ok: hasTrustedTrace(proof.validDb), message: 'valid DB did not receive a trusted pointer click event' },
    { ok: hasTrustedTrace(proof.validCafe), message: 'valid Cafe24 did not receive a trusted pointer click event' },
    { ok: proof.validDb.selection.trace.length === 1, message: `valid DB physical click was observed ${proof.validDb.selection.trace.length} times` },
    { ok: proof.validCafe.selection.trace.length === 1, message: `valid Cafe24 physical click was observed ${proof.validCafe.selection.trace.length} times` },
    { ok: proof.validDb.selection.selectedDbCandidateKey === 'PTR-DB-159', message: `valid DB candidate was not selected: ${proof.validDb.selection.selectedDbCandidateKey}` },
    { ok: proof.validCafe.selection.selectedCafe24CandidateKey === 'P0000PTR159', message: `valid Cafe24 candidate was not selected: ${proof.validCafe.selection.selectedCafe24CandidateKey}` },
    { ok: proof.validDb.selection.dbButtonText === '확정됨', message: `valid DB button did not show 확정됨: ${proof.validDb.selection.dbButtonText}` },
    { ok: proof.validCafe.selection.cafeButtonText === '확정됨', message: `valid Cafe24 button did not show 확정됨: ${proof.validCafe.selection.cafeButtonText}` },
    { ok: proof.validDb.selection.dbClearButtonCount === 1 && !proof.validDb.selection.dbClearButtonDisabled, message: 'valid DB selection did not expose an enabled 선택 해제 button' },
    { ok: proof.validCafe.selection.cafeClearButtonCount === 1 && !proof.validCafe.selection.cafeClearButtonDisabled, message: 'valid Cafe24 selection did not expose an enabled 선택 해제 button' },
    { ok: proof.compactLayout.viewport.width === 764 && proof.compactLayout.viewport.height === 485, message: `compact viewport was not applied: ${JSON.stringify(proof.compactLayout.viewport)}` },
    { ok: proof.compactLayout.candidateLists.length === 2 && proof.compactLayout.candidateLists.every(item => item.scrollWidth <= item.clientWidth + 1), message: `candidate list has horizontal overflow: ${JSON.stringify(proof.compactLayout.candidateLists)}` },
    { ok: proof.compactLayout.actionOverflow.every(item => item.scrollWidth <= item.clientWidth + 1), message: `candidate action label is clipped: ${JSON.stringify(proof.compactLayout.actionOverflow)}` },
    { ok: proof.compactLayout.initialOverlaps.length === 0, message: `identity card covers a visible candidate action: ${proof.compactLayout.initialOverlaps.join(', ')}` },
    { ok: !proof.compactLayout.lastActionCoveredAfterScroll, message: 'identity card covers the final candidate action after main-page scroll' },
    { ok: proof.runAdvancedDb.selection.dbClearButtonCount === 1 && !proof.runAdvancedDb.selection.dbClearButtonDisabled, message: 'same-workspace DB selection lost its enabled 선택 해제 button after run/image metadata advanced' },
    { ok: proof.runAdvancedCafe.selection.cafeClearButtonCount === 1 && !proof.runAdvancedCafe.selection.cafeClearButtonDisabled, message: 'same-workspace Cafe24 selection lost its enabled 선택 해제 button after run/image metadata advanced' },
    { ok: proof.runAdvancedDb.selection.selectedDbCandidateKey === 'PTR-DB-159', message: `same-workspace DB candidate was not selected after run/image metadata advanced: ${proof.runAdvancedDb.selection.selectedDbCandidateKey}` },
    { ok: proof.runAdvancedCafe.selection.selectedCafe24CandidateKey === 'P0000PTR159', message: `same-workspace Cafe24 candidate was not selected after run/image metadata advanced: ${proof.runAdvancedCafe.selection.selectedCafe24CandidateKey}` },
    { ok: proof.resolutionDb.clearPoint.topTag === 'BUTTON' && proof.resolutionDb.cleared.selectedDbCandidateKey === '' && proof.resolutionDb.cleared.dbCandidateResolution === '', message: 'DB 선택 해제가 실제 포인터 클릭 뒤 상태를 해제하지 못했습니다' },
    { ok: proof.resolutionCafe.clearPoint.topTag === 'BUTTON' && proof.resolutionCafe.cleared.selectedCafe24CandidateKey === '' && proof.resolutionCafe.cleared.cafe24CandidateResolution === '', message: 'Cafe24 선택 해제가 실제 포인터 클릭 뒤 상태를 해제하지 못했습니다' },
    { ok: proof.resolutionDb.cleared.dbReviewCandidateCount === 1, message: `DB 선택 해제 뒤 후보가 사라졌습니다: ${proof.resolutionDb.cleared.dbReviewCandidateCount}` },
    { ok: proof.resolutionCafe.cleared.cafe24ReviewCandidateCount === 1, message: `Cafe24 선택 해제 뒤 후보가 사라졌습니다: ${proof.resolutionCafe.cleared.cafe24ReviewCandidateCount}` },
    { ok: proof.resolutionDb.noCandidatePoint.topTag === 'BUTTON' && proof.resolutionDb.absent.dbCandidateResolution === 'none' && proof.resolutionDb.absent.dbNoCandidateDisabled && proof.resolutionDb.absent.dbNoCandidateText === '신화사DB 후보 없음 확정됨', message: '신화사DB 후보 없음 실제 포인터 클릭이 즉시 확정 상태로 반영되지 않았습니다' },
    { ok: proof.resolutionCafe.noCandidatePoint.topTag === 'BUTTON' && proof.resolutionCafe.absent.cafe24CandidateResolution === 'none' && proof.resolutionCafe.absent.cafeNoCandidateDisabled && proof.resolutionCafe.absent.cafeNoCandidateText === 'Cafe24 후보 없음 · 신제품 확정됨', message: 'Cafe24 후보 없음 실제 포인터 클릭이 즉시 확정 상태로 반영되지 않았습니다' },
    { ok: proof.fieldsGuideAction.point.topTag === 'BUTTON' && proof.fieldsGuideAction.state.activeTab === 'fields', message: `필수값 검수로 이동 pointer click did not activate fields: ${JSON.stringify(proof.fieldsGuideAction)}` },
    { ok: proof.readOnlyActions.authority.mode === 'readonly' && proof.readOnlyActions.authority.scopeId === 'project:candidate-pointer-workspace-v159', message: `candidate action read-only state was not active: ${JSON.stringify(proof.readOnlyActions.authority)}` },
    { ok: proof.readOnlyActions.recovery.containerInert, message: 'read-only candidate controls were not locked' },
    { ok: proof.readOnlyActions.recovery.takeoverPresent && !proof.readOnlyActions.recovery.takeoverDisabled && !proof.readOnlyActions.recovery.takeoverInsideInertContainer, message: `read-only recovery control is unavailable: ${JSON.stringify(proof.readOnlyActions.recovery)}` },
    { ok: proof.readOnlyActions.after.selectedDbCandidateKey === proof.readOnlyActions.before.selectedDbCandidateKey && proof.readOnlyActions.after.dbCandidateResolution === proof.readOnlyActions.before.dbCandidateResolution && proof.readOnlyActions.after.cafe24CandidateResolution === proof.readOnlyActions.before.cafe24CandidateResolution, message: 'read-only candidate action mutated selection state' },
    { ok: proof.readOnlyActions.after.operationRevision === proof.readOnlyActions.before.operationRevision, message: 'read-only candidate action advanced the runtime operation' },
    { ok: proof.readOnlyActions.recovery.cardText.includes('편집권 필요') && proof.readOnlyActions.recovery.cardText.includes('편집권 가져오기'), message: `read-only recovery guidance was not rendered: ${JSON.stringify(proof.readOnlyActions.recovery)}` },
    { ok: proof.readOnlyActions.takeoverPoint.topTag === 'BUTTON' && proof.readOnlyActions.recovered.mode === 'editing' && !proof.readOnlyActions.recovered.containerInert, message: `편집권 가져오기 pointer click did not restore editing: ${JSON.stringify(proof.readOnlyActions)}` },
    { ok: proof.readOnlyActions.recoveredApplyPoint.topTag === 'BUTTON' && proof.readOnlyActions.recoveredSelection.selectedDbCandidateKey === 'PTR-DB-159', message: '편집권 복구 뒤 신화사DB 후보 선택이 실제 포인터 클릭으로 다시 실행되지 않았습니다' },
    { ok: proof.productMismatch.seed.buttonCount === 0, message: `different-product candidates remained visible after the product boundary changed: ${proof.productMismatch.seed.buttonCount}` },
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  fs.writeFileSync(RESULT_PATH, JSON.stringify({
    ok: failures.length === 0,
    proof,
    checks,
    failures,
    screenshotPaths: [SCREENSHOT_PATH, HIDDEN_SCREENSHOT_PATH, READ_ONLY_SCREENSHOT_PATH],
  }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({
    ok: true,
    resultPath: RESULT_PATH,
    screenshotPaths: [SCREENSHOT_PATH, HIDDEN_SCREENSHOT_PATH, READ_ONLY_SCREENSHOT_PATH],
    proof,
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
