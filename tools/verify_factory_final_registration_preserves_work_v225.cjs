const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');
const {
  buildFinalRegistrationChecks,
  buildFinalRegistrationSeed,
} = require('./factory_final_registration_preservation_harness_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-final-registration-preserves-work-v225.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-final-registration-preserves-work-v225.png');

function selectFinalRegistrationCdpTarget(runtime) {
  const target = (runtime?.targets || []).find(item => item.type === 'page') || runtime?.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  return target;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seed = buildFinalRegistrationSeed(Date.now());
  let runtime = null;
  let cdp = null;
  let proof = null;
  let failure = null;
  const cleanup = { cdpClosed: false, runtimeCleaned: false, errors: [] };

  try {
    runtime = await ensureCdp(CDP_URL);
    const target = selectFinalRegistrationCdpTarget(runtime);
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const verifyUrl = new URL(APP_URL);
    verifyUrl.searchParams.set('finalRegistrationPreservation', `verify-v225-${seed.workspaceId}`);
    await cdp.send('Page.navigate', { url: verifyUrl.href });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof normalizeFactoryState === 'function'
      && typeof factoryStampWorkspaceIdentity === 'function'
      && typeof factoryApplyFinalRegistrationBasicInfoInputs === 'function'
      && typeof factoryRunFinalRegistration === 'function'
      && typeof settleWorkspaceScopeTransitionPersistence === 'function'
      && typeof ensureWorkspaceEditAuthority === 'function'`, 60000);
    proof = await evaluateFactoryCdpFixture(cdp, `async ({ setAppState, readAppState, readFactory, cloneFactory, replaceFactory }) => {
      const seed = ${JSON.stringify(seed)};
      await settleWorkspaceScopeTransitionPersistence();
      setAppState({
        step: 'factory',
        currentProjectId: seed.workspaceId,
        currentProjectName: '최종등록보존검증',
        currentProjectCreatedAt: 1735689600000,
        productName: seed.workProductName,
      });
      const initialFactory = normalizeFactoryState(seed.factory);
      factoryStampWorkspaceIdentity(initialFactory, {
        projectId: seed.workspaceId,
        projectName: '최종등록보존검증',
        createdAt: 1735689600000,
      });
      replaceFactory(initialFactory);
      const authority = await ensureWorkspaceEditAuthority('project:' + seed.workspaceId, { force: true });
      if (authority?.mode !== 'editing') {
        throw new Error('SAVE-06 test workspace authority was not acquired');
      }
      const snapshot = () => {
        const app = readAppState();
        const factory = readFactory();
        const assets = factory.product?.generatedAssets || [];
        return {
          stateProductName: app.productName || '',
          productName: factory.product?.productName || '',
          userProductName: factory.product?.userProductName || '',
          productKey: factoryCurrentProductKey(factory),
          dbCandidates: (factory.product?.dbCandidates || []).length,
          cafe24Candidates: (factory.product?.cafe24Candidates || []).length,
          usage: factory.product?.dbFieldSettings?.usage?.manualValue || '',
          activeAssets: assets.filter(asset => !asset.rejected).length,
          rejectedAssets: assets.filter(asset => asset.rejected).length,
        };
      };
      const before = snapshot();
      const container = document.createElement('section');
      container.innerHTML = [
        '<input data-factory-final-basic-field="product_name" value="' + seed.registrationProductName + '">',
        '<input data-factory-final-basic-field="sale_price" value="4000">',
        '<input data-factory-final-basic-field="consumer_price" value="">',
        '<input data-factory-final-basic-field="purchase_price" value="">',
      ].join('');
      document.body.appendChild(container);
      const original = {
        settings: globalThis.factoryFinalRegistrationSettings,
        detailModel: globalThis.factoryFinalRegistrationDetailModel,
        cafe24Model: globalThis.factoryFinalRegistrationCafe24Model,
        detailAsset: globalThis.factoryEnsureCurrentDetailHtmlAsset,
        saveCafe24: globalThis.factorySaveCafe24ProductFromFinalDb,
        publishDetail: globalThis.factoryPublishCafe24ScopedDetailHtml,
        postSyncPlan: globalThis.factoryCafe24CreatePostSyncPlan,
        postSync: globalThis.factoryRunCafe24PostCreateSync,
        fetchProduct: globalThis.fetchCafe24ProductFullByNo,
        history: globalThis.factoryRecordFinalRegistrationHistory,
        render: globalThis.renderPreservingMainScroll,
        save: globalThis.saveLastWorkNow,
        updateInputs: globalThis.factoryUpdateFromInputs,
        ensureModules: globalThis.ensureCafe24Modules,
      };
      let after = null;
      let failureResult = null;
      let successResult = null;
      let externalResult = false;
      let externalCalls = 0;
      try {
        globalThis.renderPreservingMainScroll = () => {};
        globalThis.saveLastWorkNow = () => {};
        factoryApplyFinalRegistrationBasicInfoInputs({ container, silent: true, render: false });
        factoryUpdateFromInputs();
        const appliedFactory = readFactory();
        after = {
          ...snapshot(),
          registrationProductName: appliedFactory.product?.cafe24FinalRegistration?.productName || '',
          finalDbProductName: appliedFactory.product?.finalDb?.product_name || '',
          registrationPanelProductName: factoryFinalRegistrationBasicInfoModel(cloneFactory()).productName,
        };
        const completeDetailHtml = Array.from(
          { length: 15 },
          (_, index) => '<img src="https://example.com/detail-' + (index + 1) + '.jpg" alt="상세 ' + (index + 1) + '">',
        ).join('');
        globalThis.factoryFinalRegistrationSettings = () => ({ includeOpenMarket: false, targetLabel: 'Cafe24만', cafe24RegistrationLabel: '기존 상품 수정', displayLabel: '진열안함', sellingLabel: '판매안함' });
        globalThis.factoryFinalRegistrationDetailModel = () => ({ canProceed: true, ok: true, label: '15/15', generated: 15 });
        globalThis.factoryFinalRegistrationCafe24Model = () => ({ canRun: true, mode: 'update', label: '기존 상품 #999', productNo: '999' });
        globalThis.factoryEnsureCurrentDetailHtmlAsset = () => ({ html: completeDetailHtml, reused: true, sectionCount: 15 });
        globalThis.factorySaveCafe24ProductFromFinalDb = async () => {
          externalCalls += 1;
          return externalResult;
        };
        globalThis.factoryPublishCafe24ScopedDetailHtml = async () => true;
        globalThis.factoryCafe24CreatePostSyncPlan = () => ({ imageSlotCount: 0, readyActions: [] });
        globalThis.factoryRunCafe24PostCreateSync = async () => true;
        globalThis.fetchCafe24ProductFullByNo = async () => ({
          raw: {
            product_no: '999',
            product_name: seed.registrationProductName,
            price: '4000',
            description: completeDetailHtml,
            detail_image: '/mock-detail.jpg',
          },
        });
        globalThis.factoryRecordFinalRegistrationHistory = async () => true;
        globalThis.factoryUpdateFromInputs = () => {};
        globalThis.ensureCafe24Modules = async () => true;
        failureResult = await factoryRunFinalRegistration({ container, skipConfirm: true, skipLocalAssetPrepare: true });
        externalResult = true;
        successResult = await factoryRunFinalRegistration({ container, skipConfirm: true, skipLocalAssetPrepare: true });
      } finally {
        globalThis.factoryFinalRegistrationSettings = original.settings;
        globalThis.factoryFinalRegistrationDetailModel = original.detailModel;
        globalThis.factoryFinalRegistrationCafe24Model = original.cafe24Model;
        globalThis.factoryEnsureCurrentDetailHtmlAsset = original.detailAsset;
        globalThis.factorySaveCafe24ProductFromFinalDb = original.saveCafe24;
        globalThis.factoryPublishCafe24ScopedDetailHtml = original.publishDetail;
        globalThis.factoryCafe24CreatePostSyncPlan = original.postSyncPlan;
        globalThis.factoryRunCafe24PostCreateSync = original.postSync;
        globalThis.fetchCafe24ProductFullByNo = original.fetchProduct;
        globalThis.factoryRecordFinalRegistrationHistory = original.history;
        globalThis.renderPreservingMainScroll = original.render;
        globalThis.saveLastWorkNow = original.save;
        globalThis.factoryUpdateFromInputs = original.updateInputs;
        globalThis.ensureCafe24Modules = original.ensureModules;
      }
      const afterFailureAndSuccess = snapshot();
      const terminalFactory = readFactory();
      const terminalReceipt = terminalFactory.product?.cafe24RegistrationReceipt || null;
      const terminalRegistration = {
        status: terminalReceipt?.status || '',
        error: terminalReceipt?.error || '',
        mismatches: terminalReceipt?.mismatches || [],
        finalStatus: terminalFactory.openMarketSync?.finalRegistrationStatus || '',
      };
      container.remove();
      const evidence = document.createElement('section');
      evidence.id = 'finalRegistrationPreservationEvidence';
      evidence.style.cssText = 'margin:24px;padding:22px;background:#0b1020;color:#f8fafc;border:1px solid #4f46e5;border-radius:8px;font:16px/1.6 sans-serif';
      evidence.innerHTML = '<h2 style="margin:0 0 12px">Cafe24 등록 전후 작업 보존 검증</h2>'
        + '<div>현재 작업 제품: <strong>' + after.productName + '</strong></div>'
        + '<div>Cafe24 전송 상품명: <strong>' + after.registrationProductName + '</strong></div>'
        + '<div>후보 DB/Cafe24: <strong>' + after.dbCandidates + ' / ' + after.cafe24Candidates + '</strong></div>'
        + '<div>활성/격리 이미지: <strong>' + after.activeAssets + ' / ' + after.rejectedAssets + '</strong></div>';
      document.body.replaceChildren(evidence);
      return { before, after, failureResult, successResult, externalCalls, afterFailureAndSuccess, terminalRegistration };
    }`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (cdp) cdp.close();
      cleanup.cdpClosed = true;
    } catch (error) {
      cleanup.errors.push({ stage: 'cdp-close', error: error?.stack || String(error) });
      failure = failure || error;
    } finally {
      try {
        await runtime?.cleanup?.();
        cleanup.runtimeCleaned = true;
      } catch (error) {
        cleanup.errors.push({ stage: 'runtime-cleanup', error: error?.stack || String(error) });
        failure = failure || error;
      }
    }
  }

  const completeProof = { ...(proof || {}), expected: seed, cleanup };
  const checks = Object.values(buildFinalRegistrationChecks(completeProof));
  const result = { ok: !failure && checks.every(check => check.ok), proof: completeProof, checks, screenshotPath: SCREENSHOT_PATH };
  if (failure) result.error = failure?.stack || String(failure);
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  if (failure) throw failure;
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { main, selectFinalRegistrationCdpTarget };

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
