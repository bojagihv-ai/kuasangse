function buildFinalRegistrationSeed(seedValue = Date.now()) {
  const seed = String(seedValue);
  const workspaceId = `final_registration_preserve_v225_${seed}`;
  const workProductName = `슬라브나비수저집 ${seed}`;
  const registrationProductName = `슬라브나비수저집테스트 ${seed}`;
  const runId = `final_registration_run_v225_${seed}`;
  const fingerprint = `final-registration-input-v225-${seed}`;
  const usage = '선물 포장, 답례품';
  const factory = {
    workspace: { id: workspaceId, name: '최종등록보존검증', createdAt: 1735689600000 },
    currentProjectId: workspaceId,
    currentProjectName: '최종등록보존검증',
    product: {
      productName: workProductName,
      userProductName: workProductName,
      productKey: workProductName,
      currentProductKey: workProductName,
      productIdentityKey: workProductName,
      currentRunId: runId,
      generationRunId: runId,
      inputImageFingerprint: fingerprint,
      lockedInputImageFingerprint: fingerprint,
      dbCandidates: [{ key: `db-v225-${seed}`, product_name: workProductName }],
      cafe24Candidates: [{ key: `cafe24-v225-${seed}`, product_name: workProductName }],
      selectedDbCandidateKey: `db-v225-${seed}`,
      selectedCafe24CandidateKey: `cafe24-v225-${seed}`,
      dbCandidateResolution: 'selected',
      cafe24CandidateResolution: 'selected',
      dbFieldSettings: {
        usage: {
          enabled: true,
          manualTouched: true,
          manualValue: usage,
          workspaceId,
          productKey: workProductName,
          currentRunId: runId,
          inputImageFingerprint: fingerprint,
          stageId: 'field:usage',
        },
      },
      generatedAssets: [
        {
          id: `hero-v225-${seed}`, kind: 'hero', stage: 'hero', stageId: 'hero',
          name: '대표이미지', productKey: workProductName, workspaceId, currentRunId: runId,
          inputImageFingerprint: fingerprint, used: true, rejected: false,
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
        {
          id: `size-v225-${seed}`, kind: 'size', stage: 'size', stageId: 'size',
          name: '사이즈이미지', productKey: workProductName, workspaceId, currentRunId: runId,
          inputImageFingerprint: fingerprint, used: true, rejected: false,
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
      cafe24FinalRegistration: { productName: workProductName, price: '4000' },
      finalDb: { product_name: workProductName, sale_price: '4000', usage },
    },
    automation: { currentRunId: runId, activeTab: 'send' },
    goalRun: { currentRunId: runId },
  };
  return {
    workspaceId,
    workProductName,
    registrationProductName,
    runId,
    fingerprint,
    usage,
    factory,
  };
}

function check(code, ok, message) {
  return Object.freeze({ code, ok: ok === true, message });
}

function same(left, right, keys) {
  return keys.every(key => left?.[key] === right?.[key]);
}

function buildFinalRegistrationChecks(proof) {
  const expected = proof.expected || {};
  const preservedKeys = [
    'stateProductName', 'productName', 'userProductName', 'productKey',
    'dbCandidates', 'cafe24Candidates', 'usage', 'activeAssets', 'rejectedAssets',
  ];
  return Object.freeze({
    stateProductNamePreserved: check('stateProductNamePreserved', proof.after?.stateProductName === proof.before?.stateProductName, `Cafe24 등록 상품명이 현재 작업 state 상품명을 바꿨습니다: ${JSON.stringify(proof)}`),
    factoryProductNamesPreserved: check('factoryProductNamesPreserved', proof.after?.productName === proof.before?.productName && proof.after?.userProductName === proof.before?.userProductName, `Cafe24 등록 상품명이 현재 작업 factory 제품명을 바꿨습니다: ${JSON.stringify(proof)}`),
    productKeyPreserved: check('productKeyPreserved', proof.after?.productKey === proof.before?.productKey, `Cafe24 등록 상품명이 현재 작업 productKey를 바꿨습니다: ${JSON.stringify(proof)}`),
    registrationProductName: check('registrationProductName', proof.after?.registrationProductName === expected.registrationProductName, `Cafe24 전송용 상품명이 저장되지 않았습니다: ${JSON.stringify(proof.after)}`),
    payloadProductName: check('payloadProductName', proof.after?.finalDbProductName === expected.registrationProductName, `Cafe24 payload 상품명이 반영되지 않았습니다: ${JSON.stringify(proof.after)}`),
    panelProductName: check('panelProductName', proof.after?.registrationPanelProductName === expected.registrationProductName, `최종 등록 화면 상품명이 전송용 상품명과 다릅니다: ${JSON.stringify(proof.after)}`),
    candidatesPreserved: check('candidatesPreserved', proof.after?.dbCandidates === proof.before?.dbCandidates && proof.after?.cafe24Candidates === proof.before?.cafe24Candidates, `Cafe24 등록 적용 중 현재 작업 후보가 초기화됐습니다: ${JSON.stringify(proof)}`),
    usagePreserved: check('usagePreserved', proof.after?.usage === proof.before?.usage, `Cafe24 등록 적용 중 현재 작업 필수값이 초기화됐습니다: ${JSON.stringify(proof)}`),
    assetsPreserved: check('assetsPreserved', proof.after?.activeAssets === proof.before?.activeAssets && proof.after?.rejectedAssets === 0, `Cafe24 등록 적용 중 현재 작업 이미지가 격리됐습니다: ${JSON.stringify(proof)}`),
    successAndFailurePaths: check('successAndFailurePaths', proof.failureResult === false && proof.successResult === true && proof.externalCalls === 2, `Cafe24 성공/실패 모의 경로가 모두 실행되지 않았습니다: ${JSON.stringify(proof)}`),
    postRunPreserved: check('postRunPreserved', same(proof.afterFailureAndSuccess, proof.before, preservedKeys), `Cafe24 등록 성공 또는 실패 뒤 현재 작업 상태가 달라졌습니다: ${JSON.stringify(proof)}`),
    lifecycleCleanup: check('lifecycleCleanup', proof.cleanup?.cdpClosed === true && proof.cleanup?.runtimeCleaned === true && Array.isArray(proof.cleanup?.errors) && proof.cleanup.errors.length === 0, `final registration cleanup lifecycle 실패: ${JSON.stringify(proof.cleanup)}`),
  });
}

module.exports = {
  buildFinalRegistrationChecks,
  buildFinalRegistrationSeed,
};
