// IME-ENTER-01 — 한글 조합 중 Enter 가 전송돼 마지막 글자가 빠지는 것
//
// 사장님 말(2026-09-02): "한글 치다가 엔터 누르면 마지막 글자가 빠진 채로 날아간다."
// 실측: 키 입력 핸들러 36곳 중 composition 이벤트를 다루는 곳은 start-tab 하나였고, Enter 로
// 보내는 에이전트 채팅(doSend)·이미지 지시(addImageDirective)는 isComposing 검사가 없었다.
// 기존 CDP 검사 120개 중 실제 타이핑(Input.insertText/imeSetComposition/dispatchKeyEvent)을
// 쓰는 파일은 0개라서, 합성 이벤트(new CompositionEvent)로는 이 버그를 못 잡았다.
//
// 이 검사가 지키는 것 — 실제 Chrome 에 IME 조합을 그대로 흉내내서:
//   1. '수' 를 확정하고 '저' 를 조합 중인 상태(keyCode 229)에서 Enter 를 눌러도 아무것도 전송되지 않는다.
//   2. 조합이 끝난(compositionend) 뒤 Enter 를 누르면 '수저' 전체가 전송된다.
//   3. 세 곳 — 제품명 입력(#factoryGuideProductName)·에이전트 채팅(#agentInput)·이미지 지시(#directiveInput).
//   4. 제품명은 저장 뒤 F5 를 눌러도 '수저' 그대로 돌아온다 (FIELD-03 과 같은 원칙, 실제 IME 경로로).
const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  assertNoSilentFieldLoss,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), '.omo', 'evidence', 'ime-composition-enter-v1');
const RESULT_PATH = path.join(OUT_DIR, 'ime-composition-enter-v1.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'ime-composition-enter-v1.png');
const WORD = '수저';

// 실제 한국어 IME 가 Chrome 에 보내는 순서를 그대로 흉내낸다.
//   '수' 확정(insertText) → '저' 조합 시작(imeSetComposition) → 조합 중 Enter(keyCode 229)
//   → 조합 확정(insertText '저' → compositionend) → Enter(keyCode 13)
async function focus(cdp, selector) {
  await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`${selector} 을 찾지 못했습니다.`)});
    el.focus();
    return document.activeElement === el;
  })()`);
}

async function pressEnter(cdp, { composing }) {
  // 조합 중에는 Windows IME 가 keyCode 229 로 보낸다. Blink 는 조합 상태를 보고 isComposing 을 세운다.
  const base = composing
    ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 }
    : { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: base.windowsVirtualKeyCode });
}

async function typeWordWithComposition(cdp, selector, probe) {
  await focus(cdp, selector);
  await cdp.send('Input.insertText', { text: WORD.slice(0, 1) });
  await cdp.send('Input.imeSetComposition', { text: WORD.slice(1), selectionStart: 1, selectionEnd: 1 });
  const composingState = await evaluate(cdp, probe);
  await pressEnter(cdp, { composing: true });
  const afterComposingEnter = await evaluate(cdp, probe);
  await cdp.send('Input.insertText', { text: WORD.slice(1) });
  const afterCommit = await evaluate(cdp, probe);
  await pressEnter(cdp, { composing: false });
  const afterFinalEnter = await evaluate(cdp, probe);
  return { composingState, afterComposingEnter, afterCommit, afterFinalEnter };
}

async function captureFailureDiagnostics(cdp) {
  if (!cdp) return null;
  const diagnostics = await evaluate(cdp, `(() => ({
    url: location.href,
    buildId: document.documentElement.dataset.kuasangseBuildId || '',
    step: typeof state === 'object' && state ? state.step : '',
    keyLog: globalThis.__imeEnterKeyLog || null,
    bodyText: String(document.body?.innerText || '').slice(0, 2000),
  }))()`).catch(error => ({ diagnosticError: error.message || String(error) }));
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    diagnostics.screenshotPath = SCREENSHOT_PATH;
  } catch (error) {
    diagnostics.screenshotError = error.message || String(error);
  }
  return diagnostics;
}

async function main() {
  const expectedBuildId = currentSourceBuildId();
  let cdpRuntime = null;
  let cdp = null;
  let failure = null;
  let record = { ok: false, expectedBuildId, word: WORD };

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    cdpRuntime = await ensureCdp(CDP_URL);
    const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    for (const [method, params] of [
      ['Page.enable'],
      ['Runtime.enable'],
      ['Network.enable'],
      ['Network.setCacheDisabled', { cacheDisabled: true }],
      ['Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }],
    ]) await cdp.send(method, params);

    await cdp.send('Page.navigate', { url: `${APP_URL}?imeCompositionEnter=v1` });
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);

    // 브라우저가 실제로 어떤 키 이벤트를 만들었는지 기록해 둔다 (isComposing/keyCode 실측 증거).
    await evaluate(cdp, `(() => {
      globalThis.__imeEnterKeyLog = [];
      document.addEventListener('keydown', e => {
        if (e.key === 'Enter') globalThis.__imeEnterKeyLog.push({
          target: e.target?.id || e.target?.tagName || '', keyCode: e.keyCode, isComposing: e.isComposing,
        });
      }, true);
      return true;
    })()`);

    // ── 1. 제품명 입력 (조립공장 시작 탭) ─────────────────────────────────────
    const seeded = await evaluateFactoryCdpFixture(cdp, `(({ setAppState, cloneFactory, replaceFactory, readFactory, renderApp }) => {
      const factory = cloneFactory();
      factory.product = { ...(factory.product || {}), productName: 'before', userProductName: 'before' };
      factory.automation = { ...(factory.automation || {}), activeTab: 'start' };
      setAppState({ step: 'factory', productName: 'before', error: '' });
      replaceFactory(factory, { reason: 'ime-composition-enter-v1-seed' });
      renderApp();
      return { productName: readFactory().product?.productName || '' };
    })`);
    await waitFor(cdp, `document.querySelector('#factoryGuideProductName')`, 30000);
    await evaluate(cdp, `(() => { const el = document.querySelector('#factoryGuideProductName'); el.value = ''; return true; })()`);
    const productNameProbe = `(() => ({
      dom: document.querySelector('#factoryGuideProductName')?.value ?? null,
      canonical: factoryRuntimeReadFactory().product?.productName || '',
      stateName: state.productName || '',
    }))()`;
    const productName = await typeWordWithComposition(cdp, '#factoryGuideProductName', productNameProbe);

    const saved = await evaluate(cdp, `(async () => {
      await Promise.resolve(saveLastWorkNow({ server: false, force: true }));
      return { canonical: factoryRuntimeReadFactory().product?.productName || '', stateName: state.productName || '' };
    })()`);

    // ── 2. 에이전트 채팅 ────────────────────────────────────────────────────
    // 실제 전송(LLM 호출) 대신 전역 함수를 기록기로 바꿔 끼운다. 번들은 top-level 연결이라
    // doSend 가 호출 시점에 전역 바인딩을 다시 찾으므로 바꿔 끼운 것이 그대로 쓰인다.
    await evaluate(cdp, `(() => {
      globalThis.__imeEnterCalls = { agent: [], directive: [] };
      agentSendMessage = text => { globalThis.__imeEnterCalls.agent.push(String(text)); };
      addImageDirective = text => { globalThis.__imeEnterCalls.directive.push(String(text)); };
      // 시작 탭 입력칸에 초점이 남아 있으면 render() 가 마법사 편집을 지키느라 다시 그리지 않는다.
      document.activeElement?.blur?.();
      state.agentOpen = true;
      state.agentMessages = [];
      render();
      return true;
    })()`);
    await waitFor(cdp, `document.querySelector('#agentInput')`, 30000);
    const agentProbe = `(() => ({
      dom: document.querySelector('#agentInput')?.value ?? null,
      sent: globalThis.__imeEnterCalls.agent.slice(),
    }))()`;
    const agent = await typeWordWithComposition(cdp, '#agentInput', agentProbe);

    // ── 3. 이미지 지시사항 (섹션 메뉴) ──────────────────────────────────────
    await evaluate(cdp, `(() => {
      document.activeElement?.blur?.();
      state.agentOpen = false;
      state.step = 'sections';
      state.imageDirectivesOpen = true;
      state.imageDirectiveInput = '';
      render();
      return true;
    })()`);
    await waitFor(cdp, `document.querySelector('#directiveInput')`, 30000);
    const directiveProbe = `(() => ({
      dom: document.querySelector('#directiveInput')?.value ?? null,
      stateInput: state.imageDirectiveInput || '',
      added: globalThis.__imeEnterCalls.directive.slice(),
    }))()`;
    const directive = await typeWordWithComposition(cdp, '#directiveInput', directiveProbe);

    const keyLog = await evaluate(cdp, 'globalThis.__imeEnterKeyLog');
    record = { ...record, seeded, productName, saved, agent, directive, keyLog };

    // ── 4. F5 뒤 제품명 복원 ────────────────────────────────────────────────
    // 옛 문서에 표식을 남겨 두고, 표식이 사라진(새 문서) 뒤에 준비 상태를 기다린다.
    // (실측 2026-09-02: 표식 없이 기다리면 reload 직전 옛 문서가 '준비됨' 으로 잡혀 새 문서에서 ReferenceError)
    await evaluate(cdp, `(() => { globalThis.__imeEnterOldDocument = true; return true; })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(cdp, `(!globalThis.__imeEnterOldDocument && ${factoryCdpFixtureReadyExpression()})`, 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);
    const restored = await evaluate(cdp, `(() => ({
      buildId: document.documentElement.dataset.kuasangseBuildId || '',
      canonical: factoryRuntimeReadFactory().product?.productName || '',
      stateName: state.productName || '',
      runtimeError: state.error || '',
    }))()`);
    record.restored = restored;

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    // 브라우저가 정말로 조합 상태의 Enter(229·isComposing) 와 확정 뒤 Enter(13) 를 만들었는지 — 검사 자체의 정직성.
    const composingEnters = keyLog.filter(e => e.isComposing === true && e.keyCode === 229);
    const committedEnters = keyLog.filter(e => e.isComposing === false && e.keyCode === 13);
    const checks = [
      { ok: seeded.productName === 'before', message: `fixture 준비 실패: ${JSON.stringify(seeded)}` },
      { ok: composingEnters.length === 3 && committedEnters.length === 3, message: `브라우저 키 이벤트가 IME 조합을 흉내내지 못함(조합 중 229 ×3, 확정 뒤 13 ×3 이어야): ${JSON.stringify(keyLog)}` },

      // '수' 는 확정됐고 '저' 는 아직 조합 중 — canonical 에는 확정된 '수' 까지만 들어가야 한다.
      { ok: productName.composingState.canonical === WORD.slice(0, 1) && productName.composingState.dom === WORD, message: `제품명: 조합 중 글자가 canonical 에 들어감: ${JSON.stringify(productName)}` },
      { ok: productName.afterComposingEnter.canonical === WORD.slice(0, 1) && productName.afterComposingEnter.dom === WORD, message: `제품명: 조합 중 Enter 가 값을 건드림: ${JSON.stringify(productName)}` },
      { ok: productName.afterCommit.canonical === WORD && productName.afterCommit.stateName === WORD, message: `제품명: compositionend 뒤 '${WORD}' 미커밋: ${JSON.stringify(productName)}` },
      { ok: productName.afterFinalEnter.canonical === WORD && productName.afterFinalEnter.dom === WORD, message: `제품명: 확정 뒤 Enter 가 값을 바꿈: ${JSON.stringify(productName)}` },

      { ok: agent.afterComposingEnter.sent.length === 0, message: `에이전트 채팅: 조합 중 Enter 에 전송됨(마지막 글자 빠짐): ${JSON.stringify(agent)}` },
      { ok: agent.afterComposingEnter.dom === WORD, message: `에이전트 채팅: 조합 중 Enter 가 입력창을 비움: ${JSON.stringify(agent)}` },
      { ok: agent.afterFinalEnter.sent.length === 1 && agent.afterFinalEnter.sent[0] === WORD, message: `에이전트 채팅: 확정 뒤 Enter 로 '${WORD}' 가 전송돼야 함: ${JSON.stringify(agent)}` },
      { ok: agent.afterFinalEnter.dom === '', message: `에이전트 채팅: 전송 뒤 입력창이 비워져야 함: ${JSON.stringify(agent)}` },

      { ok: directive.afterComposingEnter.added.length === 0, message: `이미지 지시: 조합 중 Enter 에 추가됨(마지막 글자 빠짐): ${JSON.stringify(directive)}` },
      { ok: directive.afterFinalEnter.added.length === 1 && directive.afterFinalEnter.added[0] === WORD, message: `이미지 지시: 확정 뒤 Enter 로 '${WORD}' 가 추가돼야 함: ${JSON.stringify(directive)}` },

      { ok: saved.canonical === WORD, message: `저장 직전 제품명 불일치: ${JSON.stringify(saved)}` },
      { ok: restored.buildId === expectedBuildId, message: `bundle build 불일치: ${restored.buildId} !== ${expectedBuildId}` },
      { ok: restored.canonical === WORD && restored.stateName === WORD, message: `F5 뒤 제품명 불일치: ${JSON.stringify(restored)}` },
      { ok: !restored.runtimeError, message: `런타임 오류 발생: ${restored.runtimeError}` },
    ];
    assertChecks(checks);
    record = { ...record, ok: true, screenshotPath: SCREENSHOT_PATH };
  } catch (error) {
    failure = error;
    record = {
      ...record,
      error: error.stack || error.message || String(error),
      diagnostics: await captureFailureDiagnostics(cdp),
    };
    await assertNoSilentFieldLoss(cdp, { allowAutoLoss: true });
  } finally {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(RESULT_PATH, `${JSON.stringify(record, null, 2)}\n`);
    if (cdp) await cdp.close();
    if (cdpRuntime) await cdpRuntime.cleanup();
  }

  if (failure) throw failure;
  console.log(JSON.stringify(record, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
