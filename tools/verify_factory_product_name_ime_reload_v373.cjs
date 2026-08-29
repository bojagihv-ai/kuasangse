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
const OUT_DIR = path.join(process.cwd(), '.omo', 'evidence', 'factory-product-name-ime-v373');
const RESULT_PATH = path.join(OUT_DIR, 'factory-product-name-ime-v373.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-product-name-ime-v373.png');
const PRODUCT_NAME = '모시바둑파우치';

async function captureFailureDiagnostics(cdp) {
  if (!cdp) return null;
  const diagnostics = await evaluate(cdp, `(() => {
    const factory = typeof factoryRuntimeReadFactory === 'function'
      ? factoryRuntimeReadFactory()
      : null;
    return {
      url: location.href,
      buildId: document.documentElement.dataset.kuasangseBuildId || '',
      hasProductNameInput: !!document.querySelector('#factoryGuideProductName'),
      activeTab: factory?.automation?.activeTab || '',
      bodyText: String(document.body?.innerText || '').slice(0, 3000),
    };
  })()`).catch(error => ({ diagnosticError: error.message || String(error) }));
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
  let record = { ok: false, expectedBuildId, productName: PRODUCT_NAME };

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
      ['Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }],
    ]) await cdp.send(method, params);

    await cdp.send('Page.navigate', { url: `${APP_URL}?factoryProductNameIme=v373` });
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);

    const seeded = await evaluateFactoryCdpFixture(cdp, `(({ setAppState, cloneFactory, replaceFactory, readFactory, renderApp }) => {
      const factory = cloneFactory();
      factory.product = {
        ...(factory.product || {}),
        productName: 'before',
        userProductName: 'before',
        cafe24FinalRegistration: {
          ...(factory.product?.cafe24FinalRegistration || {}),
          productName: 'ㅁ',
          product_name: 'ㅁ',
        },
      };
      factory.automation = { ...(factory.automation || {}), activeTab: 'start' };
      setAppState({ step: 'factory', productName: 'before', error: '' });
      replaceFactory(factory, { reason: 'factory-product-name-ime-v373-seed' });
      renderApp();
      return {
        productName: readFactory().product?.productName || '',
        inputValue: document.querySelector('#factoryGuideProductName')?.value || '',
      };
    })`);
    await waitFor(cdp, `document.querySelector('#factoryGuideProductName')`, 30000);

    const interaction = await evaluate(cdp, `(() => {
      const input = document.querySelector('#factoryGuideProductName');
      if (!input) throw new Error('제품명 입력창을 찾지 못했습니다.');
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      input.value = 'ㅁ';
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'ㅁ',
        inputType: 'insertCompositionText',
        isComposing: true,
      }));
      const during = {
        canonical: factoryRuntimeReadFactory().product?.productName || '',
        dom: input.value,
      };
      input.value = ${JSON.stringify(PRODUCT_NAME)};
      input.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: ${JSON.stringify(PRODUCT_NAME)},
      }));
      const after = {
        canonical: factoryRuntimeReadFactory().product?.productName || '',
        stateName: state.productName || '',
        dom: input.value,
      };
      return { during, after };
    })()`);

    const saved = await evaluate(cdp, `(async () => {
      const saveResults = await Promise.resolve(saveLastWorkNow({ server: false, force: true }));
      const readSnapshot = key => {
        try {
          const value = JSON.parse(localStorage.getItem(key) || 'null');
          return value ? {
            step: value.step || '',
            productName: value.productName || value.factory?.product?.productName || '',
            activeTab: value.factory?.automation?.activeTab || '',
            workspaceScope: value.workspaceScope?.id || value.workspaceScope || '',
          } : null;
        } catch (_) {
          return { parseError: true };
        }
      };
      const factory = factoryRuntimeReadFactory();
      return {
        canonical: factory.product?.productName || '',
        stateName: state.productName || '',
        checkpoint: JSON.parse(localStorage.getItem('pdp_last_work_input_checkpoint_v1') || 'null')?.productName || '',
        saveResults: Array.isArray(saveResults) ? saveResults.map(item => ({ status: item?.status || '', value: item?.value || false })) : [],
        session: readSnapshot('pdp_session'),
        bootstrap: readSnapshot('pdp_last_work_bootstrap_v1'),
        factorySnapshot: readSnapshot('factory_last_snapshot_v1'),
        persistenceContext: {
          serverLastWorkHydrated: typeof serverLastWorkHydrated === 'boolean' ? serverLastWorkHydrated : null,
          serverLastWorkHydrating: typeof serverLastWorkHydrating === 'boolean' ? serverLastWorkHydrating : null,
          workspaceBlankResetInProgress: typeof workspaceBlankResetInProgress === 'boolean' ? workspaceBlankResetInProgress : null,
          workspaceScopeTransition: typeof workspaceScopeTransitionState === 'object' && workspaceScopeTransitionState
            ? { ...workspaceScopeTransitionState }
            : null,
          currentScope: typeof getCurrentLastWorkWorkspaceScope === 'function' ? getCurrentLastWorkWorkspaceScope() : '',
        },
      };
    })()`);
    record = { ...record, seeded, interaction, saved };

    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);
    await evaluate(cdp, `(async () => {
      await Promise.resolve(globalThis.__KUASANGSE_STARTUP_RESTORE_PROMISE__);
      return true;
    })()`);
    await waitFor(cdp, `document.querySelector('#factoryGuideProductName')`, 30000);

    const restored = await evaluate(cdp, `(() => ({
      buildId: document.documentElement.dataset.kuasangseBuildId || '',
      canonical: factoryRuntimeReadFactory().product?.productName || '',
      stateName: state.productName || '',
      dom: document.querySelector('#factoryGuideProductName')?.value || '',
      firstJamoOnly: document.querySelector('#factoryGuideProductName')?.value === 'ㅁ',
      runtimeError: state.error || '',
    }))()`);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const checks = [
      { ok: seeded.productName === 'before', message: `fixture 준비 실패: ${JSON.stringify(seeded)}` },
      { ok: interaction.during.canonical === 'before', message: `조합 중 첫 자모가 canonical에 저장됨: ${JSON.stringify(interaction.during)}` },
      { ok: interaction.after.canonical === PRODUCT_NAME, message: `compositionend 완성값 미커밋: ${JSON.stringify(interaction.after)}` },
      { ok: interaction.after.stateName === PRODUCT_NAME, message: `state 상품명 미동기화: ${JSON.stringify(interaction.after)}` },
      { ok: saved.canonical === PRODUCT_NAME && saved.stateName === PRODUCT_NAME, message: `저장 직전 완성 상품명 불일치: ${JSON.stringify(saved)}` },
      { ok: restored.buildId === expectedBuildId, message: `bundle build 불일치: ${restored.buildId} !== ${expectedBuildId}` },
      { ok: restored.canonical === PRODUCT_NAME, message: `F5 뒤 canonical 상품명 불일치: ${JSON.stringify(restored)}` },
      { ok: restored.stateName === PRODUCT_NAME, message: `F5 뒤 state 상품명 불일치: ${JSON.stringify(restored)}` },
      { ok: restored.dom === PRODUCT_NAME && restored.firstJamoOnly === false, message: `F5 뒤 입력값 불일치: ${JSON.stringify(restored)}` },
      { ok: !restored.runtimeError, message: `런타임 오류 발생: ${restored.runtimeError}` },
    ];
    assertChecks(checks);
    record = { ok: true, expectedBuildId, productName: PRODUCT_NAME, seeded, interaction, saved, restored, screenshotPath: SCREENSHOT_PATH };
  } catch (error) {
    failure = error;
    record = {
      ...record,
      error: error.stack || error.message || String(error),
      diagnostics: await captureFailureDiagnostics(cdp),
    };
    // 공통 보존 검사: 사람이 손으로 넣은 값이 조용히 사라지지 않았는가.
    // (2026-08-29 — 회귀가 145/145 초록불인데도 사용자 값이 날아간 뒤 세운 그물)
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
