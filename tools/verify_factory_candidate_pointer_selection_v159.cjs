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

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pointerClick(cdp, selector) {
  await evaluate(cdp, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const point = await evaluate(cdp, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return null;
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
  return evaluate(cdp, `(() => {
    const mode = ${JSON.stringify(mode)};
    const type = ${JSON.stringify(type)};
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
      jname: '포인터 신화사DB 후보',
      product_name: '포인터 신화사DB 후보',
      score: 97,
      match_query: productName,
      reviewProductScopeKey,
      reviewProductIdentityKey,
      reviewProductName: productName,
    };
    const cafeCandidate = {
      product_no: 'P0000PTR159',
      product_code: 'P0000PTR159',
      product_name: '포인터 Cafe24 후보',
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
    window.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-factory-apply-db-candidate],[data-factory-apply-cafe24-candidate]');
      if (!button) return;
      window.__candidatePointerTrace.push({
        phase: event.eventPhase,
        trusted: event.isTrusted,
        action: button.getAttribute('data-factory-apply-db-candidate') !== null ? 'db' : 'cafe24',
        targetTag: event.target?.tagName || '',
      });
    }, true, { once: false });
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
      window.state.productName = otherProductName;
      factory.product.productName = otherProductName;
      factory.product.userProductName = otherProductName;
      factory.product.productKey = window.factoryNormalizeIdentityText(otherProductName);
    }
    window.render();
    return {
      mode,
      type,
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      reviewProductIdentityKey,
      currentIdentityKey: window.factoryCandidateReviewIdentityKey(window.factoryState()),
      buttonCount: document.querySelectorAll('[data-factory-apply-db-candidate],[data-factory-apply-cafe24-candidate]').length,
    };
  })()`);
}

async function readSelection(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState();
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
    await cdp.send('Page.navigate', { url: `${APP_URL}?candidatePointer=v159` });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryApplyDbCandidateFromReview && window.factoryApplyCafe24CandidateFromReview)', 60000);
    await evaluate(cdp, `(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`);

    const staleDbSeed = await seedCandidateReview(cdp, 'stale-run-legacy', 'db');
    if (staleDbSeed.buttonCount !== 2) throw new Error(`candidate seed render mismatch: ${JSON.stringify(staleDbSeed)}`);
    const staleDbPoint = await pointerClick(cdp, '[data-factory-apply-db-candidate="0"]');
    await pause(180);
    const staleDb = await readSelection(cdp);

    const staleCafeSeed = await seedCandidateReview(cdp, 'stale-run-legacy', 'cafe24');
    const staleCafePoint = await pointerClick(cdp, '[data-factory-apply-cafe24-candidate="0"]');
    await pause(180);
    const staleCafe = await readSelection(cdp);

    const validDbSeed = await seedCandidateReview(cdp, 'valid-run', 'db');
    const validDbPoint = await pointerClick(cdp, '[data-factory-apply-db-candidate="0"]');
    await pause(180);
    const validDb = await readSelection(cdp);

    const validCafeSeed = await seedCandidateReview(cdp, 'valid-run', 'cafe24');
    const validCafePoint = await pointerClick(cdp, '[data-factory-apply-cafe24-candidate="0"]');
    await pause(180);
    const validCafe = await readSelection(cdp);

    const runAdvancedDbSeed = await seedCandidateReview(cdp, 'run-advanced', 'db');
    const runAdvancedDbPoint = await pointerClick(cdp, '[data-factory-apply-db-candidate="0"]');
    await pause(180);
    const runAdvancedDb = await readSelection(cdp);

    const runAdvancedCafeSeed = await seedCandidateReview(cdp, 'run-advanced', 'cafe24');
    const runAdvancedCafePoint = await pointerClick(cdp, '[data-factory-apply-cafe24-candidate="0"]');
    await pause(180);
    const runAdvancedCafe = await readSelection(cdp);

    const productMismatchSeed = await seedCandidateReview(cdp, 'product-mismatch', 'db');
    const productMismatch = await readSelection(cdp);

    proof = {
      staleDb: { seed: staleDbSeed, point: staleDbPoint, selection: staleDb },
      staleCafe: { seed: staleCafeSeed, point: staleCafePoint, selection: staleCafe },
      validDb: { seed: validDbSeed, point: validDbPoint, selection: validDb },
      validCafe: { seed: validCafeSeed, point: validCafePoint, selection: validCafe },
      runAdvancedDb: { seed: runAdvancedDbSeed, point: runAdvancedDbPoint, selection: runAdvancedDb },
      runAdvancedCafe: { seed: runAdvancedCafeSeed, point: runAdvancedCafePoint, selection: runAdvancedCafe },
      productMismatch: { seed: productMismatchSeed, selection: productMismatch },
    };
    await evaluate(cdp, "document.querySelector('.factory-candidate-review')?.scrollIntoView({ block: 'start' })");
    await pause(120);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }

  const hasTrustedTrace = result => result.selection.trace.some(entry => entry.trusted && entry.action === result.seed.type);
  const checks = [
    { ok: proof.staleDb.seed.buttonCount === 2, message: `stale DB candidate buttons missing: ${proof.staleDb.seed.buttonCount}` },
    { ok: proof.staleCafe.seed.buttonCount === 2, message: `stale Cafe24 candidate buttons missing: ${proof.staleCafe.seed.buttonCount}` },
    { ok: proof.staleDb.point.topTag === 'BUTTON', message: `stale DB pointer was intercepted by ${proof.staleDb.point.topTag}` },
    { ok: proof.staleCafe.point.topTag === 'BUTTON', message: `stale Cafe24 pointer was intercepted by ${proof.staleCafe.point.topTag}` },
    { ok: hasTrustedTrace(proof.staleDb), message: 'stale DB did not receive a trusted pointer click event' },
    { ok: hasTrustedTrace(proof.staleCafe), message: 'stale Cafe24 did not receive a trusted pointer click event' },
    { ok: proof.staleDb.selection.selectedDbCandidateKey === 'PTR-DB-159', message: `stale DB candidate was not selected after trusted click: ${proof.staleDb.selection.selectedDbCandidateKey}` },
    { ok: proof.staleCafe.selection.selectedCafe24CandidateKey === 'P0000PTR159', message: `stale Cafe24 candidate was not selected after trusted click: ${proof.staleCafe.selection.selectedCafe24CandidateKey}` },
    { ok: proof.validDb.selection.selectedDbCandidateKey === 'PTR-DB-159', message: `valid DB candidate was not selected: ${proof.validDb.selection.selectedDbCandidateKey}` },
    { ok: proof.validCafe.selection.selectedCafe24CandidateKey === 'P0000PTR159', message: `valid Cafe24 candidate was not selected: ${proof.validCafe.selection.selectedCafe24CandidateKey}` },
    { ok: proof.validCafe.selection.cafeButtonText === '확정됨', message: `valid Cafe24 button did not show 확정됨: ${proof.validCafe.selection.cafeButtonText}` },
    { ok: !proof.runAdvancedDb.selection.dbButtonDisabled, message: 'same-workspace DB candidate became disabled after only run/image metadata advanced' },
    { ok: !proof.runAdvancedCafe.selection.cafeButtonDisabled, message: 'same-workspace Cafe24 candidate became disabled after only run/image metadata advanced' },
    { ok: proof.runAdvancedDb.selection.selectedDbCandidateKey === 'PTR-DB-159', message: `same-workspace DB candidate was not selected after run/image metadata advanced: ${proof.runAdvancedDb.selection.selectedDbCandidateKey}` },
    { ok: proof.runAdvancedCafe.selection.selectedCafe24CandidateKey === 'P0000PTR159', message: `same-workspace Cafe24 candidate was not selected after run/image metadata advanced: ${proof.runAdvancedCafe.selection.selectedCafe24CandidateKey}` },
    { ok: proof.productMismatch.seed.buttonCount === 0, message: `different-product candidates remained visible after the product boundary changed: ${proof.productMismatch.seed.buttonCount}` },
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: failures.length === 0, proof, checks, failures, screenshotPath: SCREENSHOT_PATH }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
