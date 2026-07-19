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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-final-registration-preserves-work-v225.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.factoryState && window.factoryApplyFinalRegistrationBasicInfoInputs)', 60000);

  const proof = await evaluate(cdp, `(async () => {
    const workspaceId = 'final_registration_preserve_v225';
    const workProductName = '슬라브나비수저집';
    const registrationProductName = '슬라브나비수저집테스트';
    const runId = 'final_registration_run_v225';
    const fingerprint = 'final-registration-input-v225';
    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = '최종등록보존검증';
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = workProductName;
    window.state.factory = window.normalizeFactoryState({});
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, {
      projectId: workspaceId,
      projectName: '최종등록보존검증',
      createdAt: window.state.currentProjectCreatedAt,
    });
    factory.product.productName = workProductName;
    factory.product.userProductName = workProductName;
    factory.product.productKey = workProductName;
    factory.product.currentProductKey = factory.product.productKey;
    factory.product.productIdentityKey = factory.product.productKey;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.inputImageFingerprint = fingerprint;
    factory.product.lockedInputImageFingerprint = fingerprint;
    factory.automation.currentRunId = runId;
    factory.goalRun.currentRunId = runId;
    factory.product.dbCandidates = [{ key: 'db-v225', product_name: workProductName }];
    factory.product.cafe24Candidates = [{ key: 'cafe24-v225', product_name: workProductName }];
    factory.product.selectedDbCandidateKey = 'db-v225';
    factory.product.selectedCafe24CandidateKey = 'cafe24-v225';
    factory.product.dbCandidateResolution = 'selected';
    factory.product.cafe24CandidateResolution = 'selected';
    factory.product.dbFieldSettings = {
      usage: {
        enabled: true,
        manualTouched: true,
        manualValue: '선물 포장, 답례품',
        workspaceId,
        productKey: factory.product.productKey,
        currentRunId: runId,
        inputImageFingerprint: fingerprint,
        stageId: 'field:usage',
      },
    };
    factory.product.generatedAssets = [
      {
        id: 'hero-v225',
        kind: 'hero',
        stage: 'hero',
        stageId: 'hero',
        name: '대표이미지',
        productKey: factory.product.productKey,
        workspaceId,
        currentRunId: runId,
        inputImageFingerprint: fingerprint,
        used: true,
        rejected: false,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
      {
        id: 'size-v225',
        kind: 'size',
        stage: 'size',
        stageId: 'size',
        name: '사이즈이미지',
        productKey: factory.product.productKey,
        workspaceId,
        currentRunId: runId,
        inputImageFingerprint: fingerprint,
        used: true,
        rejected: false,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
    ];
    factory.product.cafe24FinalRegistration = {
      productName: workProductName,
      price: '4000',
    };
    factory.product.finalDb = {
      product_name: workProductName,
      sale_price: '4000',
      usage: '선물 포장, 답례품',
    };

    // Cafe24 등록 전 현재 작업의 제품 범위, 후보, 필수값, 생성 이미지를 기준 답안으로 고정한다.
    const snapshot = () => ({
      stateProductName: window.state.productName,
      productName: factory.product.productName,
      userProductName: factory.product.userProductName,
      productKey: window.factoryCurrentProductKey(factory),
      dbCandidates: factory.product.dbCandidates.length,
      cafe24Candidates: factory.product.cafe24Candidates.length,
      usage: factory.product.dbFieldSettings.usage.manualValue,
      activeAssets: factory.product.generatedAssets.filter(asset => !asset.rejected).length,
      rejectedAssets: factory.product.generatedAssets.filter(asset => asset.rejected).length,
    });
    const before = snapshot();
    const container = document.createElement('section');
    container.innerHTML = [
      '<input data-factory-final-basic-field="product_name" value="' + registrationProductName + '">',
      '<input data-factory-final-basic-field="sale_price" value="4000">',
      '<input data-factory-final-basic-field="consumer_price" value="">',
      '<input data-factory-final-basic-field="purchase_price" value="">',
    ].join('');
    document.body.appendChild(container);
    window.factoryApplyFinalRegistrationBasicInfoInputs({
      container,
      silent: true,
      render: false,
    });
    // 공통 입력 동기화가 실행되어도 Cafe24 등록용 상품명은 현재 작업명으로 덮어쓰지 않아야 한다.
    window.factoryUpdateFromInputs();
    const after = {
      ...snapshot(),
      registrationProductName: factory.product.cafe24FinalRegistration?.productName || '',
      finalDbProductName: factory.product.finalDb?.product_name || '',
      registrationPanelProductName: window.factoryFinalRegistrationBasicInfoModel(factory).productName,
    };

    // 실제 최종 등록 오케스트레이터의 외부 Cafe24 경계만 모의해 실패와 성공을 모두 검증한다.
    const original = {
      settings: window.factoryFinalRegistrationSettings,
      detailModel: window.factoryFinalRegistrationDetailModel,
      cafe24Model: window.factoryFinalRegistrationCafe24Model,
      detailAsset: window.factoryEnsureCurrentDetailHtmlAsset,
      saveCafe24: window.factorySaveCafe24ProductFromFinalDb,
      history: window.factoryRecordFinalRegistrationHistory,
      render: window.renderPreservingMainScroll,
      save: window.saveLastWorkNow,
      updateInputs: window.factoryUpdateFromInputs,
      ensureModules: window.ensureCafe24Modules,
    };
    let externalResult = false;
    let externalCalls = 0;
    window.factoryFinalRegistrationSettings = () => ({
      includeOpenMarket: false,
      targetLabel: 'Cafe24만',
      cafe24RegistrationLabel: '기존 상품 수정',
      displayLabel: '진열안함',
      sellingLabel: '판매안함',
    });
    window.factoryFinalRegistrationDetailModel = () => ({ canProceed: true, ok: true, label: '15/15', generated: 15 });
    window.factoryFinalRegistrationCafe24Model = () => ({ canRun: true, mode: 'update', label: '기존 상품 #999', productNo: '999' });
    window.factoryEnsureCurrentDetailHtmlAsset = () => ({ html: '<p>현재 상세페이지</p>', reused: true, sectionCount: 15 });
    window.factorySaveCafe24ProductFromFinalDb = async () => {
      externalCalls += 1;
      return externalResult;
    };
    window.factoryRecordFinalRegistrationHistory = async () => true;
    window.renderPreservingMainScroll = () => {};
    window.saveLastWorkNow = () => {};
    window.factoryUpdateFromInputs = () => {};
    window.ensureCafe24Modules = async () => true;
    let failureResult;
    let successResult;
    try {
      failureResult = await window.factoryRunFinalRegistration({
        container,
        skipConfirm: true,
        skipLocalAssetPrepare: true,
      });
      externalResult = true;
      successResult = await window.factoryRunFinalRegistration({
        container,
        skipConfirm: true,
        skipLocalAssetPrepare: true,
      });
    } finally {
      window.factoryFinalRegistrationSettings = original.settings;
      window.factoryFinalRegistrationDetailModel = original.detailModel;
      window.factoryFinalRegistrationCafe24Model = original.cafe24Model;
      window.factoryEnsureCurrentDetailHtmlAsset = original.detailAsset;
      window.factorySaveCafe24ProductFromFinalDb = original.saveCafe24;
      window.factoryRecordFinalRegistrationHistory = original.history;
      window.renderPreservingMainScroll = original.render;
      window.saveLastWorkNow = original.save;
      window.factoryUpdateFromInputs = original.updateInputs;
      window.ensureCafe24Modules = original.ensureModules;
    }
    const afterFailureAndSuccess = snapshot();
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
    return { before, after, failureResult, successResult, externalCalls, afterFailureAndSuccess };
  })()`);

  await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then(result => fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));

  assertChecks([
    { ok: proof.after.stateProductName === proof.before.stateProductName, message: `Cafe24 등록 상품명이 현재 작업의 state.productName을 바꿨습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.productName === proof.before.productName && proof.after.userProductName === proof.before.userProductName, message: `Cafe24 등록 상품명이 현재 작업 제품명을 바꿨습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.productKey === proof.before.productKey, message: `Cafe24 등록 상품명이 현재 작업 productKey를 바꿨습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.registrationProductName === '슬라브나비수저집테스트', message: `Cafe24 전송용 상품명이 저장되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.finalDbProductName === '슬라브나비수저집테스트', message: `Cafe24 payload 상품명이 반영되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.registrationPanelProductName === '슬라브나비수저집테스트', message: `7번 최종 등록 화면에 Cafe24 전송용 상품명이 표시되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.dbCandidates === proof.before.dbCandidates && proof.after.cafe24Candidates === proof.before.cafe24Candidates, message: `Cafe24 등록 적용 중 현재 작업 후보가 초기화됐습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.usage === proof.before.usage, message: `Cafe24 등록 적용 중 현재 작업 필수값이 초기화됐습니다: ${JSON.stringify(proof)}` },
    { ok: proof.after.activeAssets === proof.before.activeAssets && proof.after.rejectedAssets === 0, message: `Cafe24 등록 적용 중 현재 작업 이미지가 격리됐습니다: ${JSON.stringify(proof)}` },
    { ok: proof.failureResult === false && proof.successResult === true && proof.externalCalls === 2, message: `Cafe24 성공/실패 모의 경로가 모두 실행되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: JSON.stringify(proof.afterFailureAndSuccess) === JSON.stringify(proof.before), message: `Cafe24 등록 성공 또는 실패 뒤 현재 작업 상태가 달라졌습니다: ${JSON.stringify(proof)}` },
  ]);

  console.log(JSON.stringify({ ok: true, proof, screenshot: SCREENSHOT_PATH }, null, 2));
  cdp.close();
  await cdpRuntime.cleanup();
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
