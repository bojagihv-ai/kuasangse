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
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-field-confirmation-persistence-v143.png');
const VISIBLE_SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-field-confirmation-persistence-visible-v143.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryAutomationReviewSummary)', 60000);

  const proof = await evaluate(cdp, `(async () => {
    const projectId = 'field_confirmation_persistence_v143';
    const productName = '필수값확정유지검증상품';
    const runId = 'field_confirmation_run_v143';
    window.state.step = 'factory';
    window.state.currentProjectId = projectId;
    window.state.currentProjectName = productName;
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = productName;
    window.state.factory = window.normalizeFactoryState({});
    let factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, { projectId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.inputImageFingerprint = 'field-confirmation-image-v143';
    factory.automation.currentRunId = runId;
    factory.goalRun.currentRunId = runId;
    factory.automation.activeTab = 'fields';
    await window.render();

    const setAndConfirm = (fieldId, value) => {
      window.factoryCommitAutomationWizardFieldValue(fieldId, value, fieldId, false, factory);
    };

    setAndConfirm('usage', '선물 포장, 답례품');
    // DB 입력판 재구성은 확정 기록을 지우지 않아도 직접값 설정을 다시 만들 수 있다.
    // 이때 확인 버튼으로 남긴 값이 화면의 완료 판정에서 계속 살아 있어야 한다.
    delete factory.product.dbFieldSettings.usage;
    window.factoryUpdateFinalDbFromFields(factory);
    setAndConfirm('width_mm', '4.8cm');
    setAndConfirm('depth_mm', '23cm');
    setAndConfirm('weight', '5.3g');
    const summary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const usage = summary.fields.find(field => field.id === 'usage') || {};
    const persistedValues = {
      usageManualValue: factory.product.dbFieldSettings?.usage?.manualValue || '',
      usageReviewValue: factory.automation.fieldReview?.usage?.value || '',
      widthValue: factory.product.dbFieldSettings?.width_mm?.manualValue || '',
      depthValue: factory.product.dbFieldSettings?.depth_mm?.manualValue || '',
      weightValue: factory.product.dbFieldSettings?.weight?.manualValue || '',
    };
    const checkpoint = {
      checkpointScope: {
        workspaceId: projectId,
        productKey: window.factoryCurrentProductKey(factory),
        currentRunId: runId,
        inputImageFingerprint: window.factoryCurrentInputImageFingerprint(factory),
        stageId: 'db-size',
      },
      factory: {
        product: { finalDb: { width_mm: '99cm' } },
        automation: { sizeFieldDrafts: { width_mm: { value: '99cm' } } },
      },
    };
    sessionStorage.setItem('pdp_last_input_checkpoint_v1', JSON.stringify(checkpoint));
    factory.automation.sizeFieldDrafts = {};
    delete factory.product.dbFieldSettings.width_mm;
    factory.product.dbSizeManualByScope = {};
    window.state.currentProjectId = 'field_confirmation_foreign_checkpoint_workspace_v143';
    const foreignCheckpointRestored = window.factoryRestoreDbSizeDraftsFromInputCheckpoint(factory);
    const foreignCheckpointDraft = factory.automation.sizeFieldDrafts?.width_mm?.value || '';
    window.state.currentProjectId = projectId;
    const sameCheckpointRestored = window.factoryRestoreDbSizeDraftsFromInputCheckpoint(factory);
    const sameCheckpointDraft = factory.automation.sizeFieldDrafts?.width_mm?.value || '';
    setAndConfirm('usage', '');
    const clearedSummary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const clearedUsage = clearedSummary.fields.find(field => field.id === 'usage') || {};
    const reviewAfterClear = factory.automation.fieldReview?.usage?.value || '';
    setAndConfirm('usage', '선물 포장, 답례품');
    delete factory.product.dbFieldSettings.usage;
    factory.automation.currentRunId = 'field_confirmation_foreign_run_v143';
    const foreignRunSummary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const foreignRunUsage = foreignRunSummary.fields.find(field => field.id === 'usage') || {};
    factory.automation.currentRunId = runId;
    window.state.currentProjectId = 'field_confirmation_foreign_workspace_v143';
    const foreignWorkspaceSummary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const foreignWorkspaceUsage = foreignWorkspaceSummary.fields.find(field => field.id === 'usage') || {};
    window.state.currentProjectId = projectId;
    factory.product.inputImageFingerprint = 'field-confirmation-foreign-image-v143';
    const foreignInputSummary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const foreignInputUsage = foreignInputSummary.fields.find(field => field.id === 'usage') || {};
    factory.product.inputImageFingerprint = 'field-confirmation-image-v143';
    window.factoryUpdateFinalDbFromFields(factory);
    factory.product.confirmedDb = { product_name: productName, usage: 'DB 확정 사용용도' };
    factory.product.dbCandidates = [{ key: 'preserve-db-candidate-v143', product_name: productName }];
    factory.product.pendingDbCandidates = [{ key: 'preserve-pending-db-candidate-v143', product_name: productName }];
    factory.product.selectedDbCandidateKey = 'preserve-db-candidate-v143';
    factory.product.dbCandidateResolution = 'selected';
    factory.product.cafe24Candidates = [{ key: 'preserve-cafe24-candidate-v143', product_name: productName }];
    factory.product.pendingCafe24Candidates = [{ key: 'preserve-pending-cafe24-candidate-v143', product_name: productName }];
    factory.product.selectedCafe24CandidateKey = 'preserve-cafe24-candidate-v143';
    factory.product.cafe24CandidateResolution = 'selected';
    window.factoryClearProductScopedDbManualFields(factory, 'test-preserve-cafe24', { preserveCafe24: true });
    const preserveCafe24Proof = {
      dbCount: factory.product.dbCandidates?.length || 0,
      cafe24Count: factory.product.cafe24Candidates?.length || 0,
      selectedCafe24: factory.product.selectedCafe24CandidateKey || '',
    };
    factory.product.confirmedDb = { product_name: productName, usage: 'DB 확정 사용용도' };
    factory.product.dbCandidates = [{ key: 'preserve-db-candidate-v143', product_name: productName }];
    factory.product.pendingDbCandidates = [{ key: 'preserve-pending-db-candidate-v143', product_name: productName }];
    factory.product.selectedDbCandidateKey = 'preserve-db-candidate-v143';
    factory.product.dbCandidateResolution = 'selected';
    factory.product.cafe24Candidates = [{ key: 'preserve-cafe24-candidate-v143', product_name: productName }];
    factory.product.pendingCafe24Candidates = [{ key: 'preserve-pending-cafe24-candidate-v143', product_name: productName }];
    factory.product.selectedCafe24CandidateKey = 'preserve-cafe24-candidate-v143';
    factory.product.cafe24CandidateResolution = 'selected';
    window.factoryClearProductScopedDbManualFields(factory, 'test-preserve-db', { preserveDb: true });
    const preserveDbProof = {
      confirmedDbUsage: factory.product.confirmedDb?.usage || '',
      dbCount: factory.product.dbCandidates?.length || 0,
      selectedDb: factory.product.selectedDbCandidateKey || '',
      cafe24Count: factory.product.cafe24Candidates?.length || 0,
    };
    setAndConfirm('usage', '선물 포장, 답례품');
    setAndConfirm('width_mm', '4.8cm');
    setAndConfirm('depth_mm', '23cm');
    setAndConfirm('weight', '5.3g');
    factory.product.confirmedDb = { id: 'old-db-candidate-v143', product_name: productName, usage: '이전 확정 DB 사용용도' };
    factory.product.dbCandidates = [{ id: 'old-db-candidate-v143', jcode: 'old-db-candidate-v143', product_name: productName, usage: '이전 DB 후보 사용용도' }];
    factory.product.cafe24Candidates = [{ product_no: 'old-cafe24-candidate-v143', product_name: productName, usage: '이전 Cafe24 후보 사용용도' }];
    factory.product.selectedDbCandidateKey = 'old-db-candidate-v143';
    factory.product.selectedCafe24CandidateKey = 'old-cafe24-candidate-v143';
    const candidateBaseline = {
      confirmedDb: window.cloneData(factory.product.confirmedDb),
      dbCandidates: window.cloneData(factory.product.dbCandidates),
      cafe24Candidates: window.cloneData(factory.product.cafe24Candidates),
      selectedDbCandidate: factory.product.selectedDbCandidateKey,
      selectedCafe24Candidate: factory.product.selectedCafe24CandidateKey,
    };
    window.factorySetCurrentProductIdentity('다른 제품', { syncDom: false, syncFinal: false });
    factory = window.factoryState();
    const correctedSummary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const correctedUsage = correctedSummary.fields.find(field => field.id === 'usage') || {};
    const correctedManualValues = Object.fromEntries(
      ['usage', 'width_mm', 'depth_mm', 'weight'].map(fieldId => [
        fieldId,
        factory.product.dbFieldSettings?.[fieldId]?.manualValue || '',
      ]),
    );
    const blankNameResult = window.factorySetCurrentProductIdentity('', { syncDom: false, syncFinal: false });
    const correctedPreservation = {
      reviewUsage: factory.automation.fieldReview?.usage?.value || '',
      confirmedDb: window.cloneData(factory.product.confirmedDb),
      dbCandidates: factory.product.dbCandidates?.length || 0,
      cafe24Candidates: factory.product.cafe24Candidates?.length || 0,
      selectedDbCandidate: factory.product.selectedDbCandidateKey || '',
      selectedCafe24Candidate: factory.product.selectedCafe24CandidateKey || '',
      blankNamePreserved: blankNameResult === window.factoryCurrentProductKey(factory),
    };
    factory.automation.sizeFieldDrafts = {};
    factory.product.dbSizeManualByScope = {};
    ['size', 'dimensions', 'dimension', 'jsize', 'width_mm', 'width', 'product_width', 'depth_mm', 'depth', 'product_depth', 'height', 'product_height', 'weight', 'product_weight_g', 'product_weight'].forEach(key => {
      if (factory.product.dbFieldSettings?.[key]) delete factory.product.dbFieldSettings[key];
      if (window.state.productInfoManualValues?.[key]) delete window.state.productInfoManualValues[key];
    });
    factory.product.analysis = { width_mm: '777cm', dimensions: '가로 777cm x 세로 888cm' };
    factory.productPayload = { width_mm: '776cm', productKey: productName };
    factory.product.productPayload = { width_mm: '778cm', productKey: productName };
    factory.product.finalDb = { width_mm: '779cm', product_name: productName };
    window.state.analysis = { width_mm: '780cm' };
    const stalePersistedWidth = window.factoryDbSizeManualValueForField('width_mm', factory).value || '';
    const currentScope = window.factoryDbSizeCheckpointScope(factory);
    factory.product.analysis = {
      ...currentScope,
      width_mm: '12cm',
      dimensions: '가로 12cm x 세로 24cm',
    };
    const scopedPersistedWidth = window.factoryDbSizeManualValueForField('width_mm', factory).value || '';
    const previousWorkspaceScope = window.getCurrentLastWorkWorkspaceScope();
    await window.resetActiveWorkspaceDocumentCore();
    const newWorkFactory = window.factoryState();
    const newWorkSummary = window.factoryAutomationReviewSummary(newWorkFactory, window.factoryAutomationCounts(newWorkFactory));
    const newWorkUsage = newWorkSummary.fields.find(field => field.id === 'usage') || {};
    const newWorkWorkspaceScope = window.getCurrentLastWorkWorkspaceScope();
    window.completeWorkspaceBlankResetBoundary();
    return {
      usageStatus: usage.status || '',
      usageValue: usage.value || '',
      usageManualValue: persistedValues.usageManualValue,
      usageReviewValue: persistedValues.usageReviewValue,
      usageDraftExists: !!factory.automation.fieldDrafts?.usage,
      missingUsage: summary.missingGenerate.some(field => field.id === 'usage'),
      widthValue: persistedValues.widthValue,
      depthValue: persistedValues.depthValue,
      weightValue: persistedValues.weightValue,
      dbSizeScopeKey: window.factoryDbSizeCurrentScopeKey(factory),
      widthSettingScopeKey: factory.product.dbFieldSettings?.width_mm?.scopeKey || '',
      foreignCheckpointRestored,
      foreignCheckpointDraft,
      sameCheckpointRestored,
      sameCheckpointDraft,
      clearedUsageStatus: clearedUsage.status || '',
      clearedUsageValue: clearedUsage.value || '',
      reviewAfterClear,
      foreignRunUsageStatus: foreignRunUsage.status || '',
      foreignRunUsageValue: foreignRunUsage.value || '',
      foreignWorkspaceUsageStatus: foreignWorkspaceUsage.status || '',
      foreignWorkspaceUsageValue: foreignWorkspaceUsage.value || '',
      foreignInputUsageStatus: foreignInputUsage.status || '',
      foreignInputUsageValue: foreignInputUsage.value || '',
      preserveCafe24Proof,
      preserveDbProof,
      correctedUsageStatus: correctedUsage.status || '',
      correctedUsageValue: correctedUsage.value || '',
      correctedManualValues,
      blankNameResult,
      candidateBaseline,
      correctedPreservation,
      stalePersistedWidth,
      scopedPersistedWidth,
      previousWorkspaceScope,
      newWorkWorkspaceScope,
      newWorkUsageStatus: newWorkUsage.status || '',
      newWorkUsageValue: newWorkUsage.value || '',
      newWorkReviewUsage: newWorkFactory.automation?.fieldReview?.usage?.value || '',
      newWorkConfirmedDb: newWorkFactory.product?.confirmedDb || null,
      newWorkDbCandidates: newWorkFactory.product?.dbCandidates?.length || 0,
      newWorkCafe24Candidates: newWorkFactory.product?.cafe24Candidates?.length || 0,
    };
  })()`);

  await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then(result => fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));
  assertChecks([
    { ok: proof.usageStatus === 'done', message: `사용용도 상태가 완료가 아닙니다: ${proof.usageStatus}` },
    { ok: proof.usageValue === '선물 포장, 답례품', message: `사용용도 값이 사라졌습니다: ${proof.usageValue}` },
    { ok: proof.usageManualValue === '선물 포장, 답례품', message: `사용용도 직접 입력값이 유실됐습니다: ${proof.usageManualValue}` },
    { ok: proof.usageReviewValue === '선물 포장, 답례품', message: `사용용도 확인 기록이 유실됐습니다: ${proof.usageReviewValue}` },
    { ok: proof.usageDraftExists === false, message: '확인한 사용용도가 입력 중 초안으로 남아 있습니다.' },
    { ok: proof.missingUsage === false, message: '확인한 사용용도가 생성 필수값 누락으로 되돌아갔습니다.' },
    { ok: proof.widthValue === '4.8cm' && proof.depthValue === '23cm' && proof.weightValue === '5.3g', message: `뒤에 입력한 생성 필수값이 저장되지 않았습니다: ${JSON.stringify({ width: proof.widthValue, depth: proof.depthValue, weight: proof.weightValue, scope: proof.dbSizeScopeKey, widthScope: proof.widthSettingScopeKey })}` },
    { ok: proof.foreignCheckpointRestored === false && proof.foreignCheckpointDraft === '', message: '다른 작업파일의 사이즈 체크포인트가 복원됐습니다.' },
    { ok: proof.sameCheckpointRestored === true && proof.sameCheckpointDraft === '99cm', message: '현재 작업파일의 사이즈 체크포인트가 복원되지 않았습니다.' },
    { ok: proof.clearedUsageStatus === 'missing' && proof.clearedUsageValue === '' && proof.reviewAfterClear === '', message: '사용자가 비운 사용용도가 이전 확인값으로 되살아났습니다.' },
    { ok: proof.foreignRunUsageStatus === 'missing' && proof.foreignRunUsageValue === '', message: '다른 실행 ID에 이전 작업의 사용용도가 섞였습니다.' },
    { ok: proof.foreignWorkspaceUsageStatus === 'missing' && proof.foreignWorkspaceUsageValue === '', message: '다른 작업파일에 이전 작업의 사용용도가 섞였습니다.' },
    { ok: proof.foreignInputUsageStatus === 'missing' && proof.foreignInputUsageValue === '', message: '다른 입력 이미지에 이전 작업의 사용용도가 섞였습니다.' },
    { ok: proof.preserveCafe24Proof.dbCount === 0 && proof.preserveCafe24Proof.cafe24Count === 1 && proof.preserveCafe24Proof.selectedCafe24 === 'preserve-cafe24-candidate-v143', message: `DB 후보 확정용 초기화가 Cafe24 후보를 보존하지 못했습니다: ${JSON.stringify(proof.preserveCafe24Proof)}` },
    { ok: proof.preserveDbProof.confirmedDbUsage === 'DB 확정 사용용도' && proof.preserveDbProof.dbCount === 1 && proof.preserveDbProof.selectedDb === 'preserve-db-candidate-v143' && proof.preserveDbProof.cafe24Count === 0, message: `Cafe24 후보 확정용 초기화가 DB 후보를 보존하지 못했습니다: ${JSON.stringify(proof.preserveDbProof)}` },
    { ok: proof.correctedUsageStatus === 'done' && proof.correctedUsageValue === '선물 포장, 답례품' && proof.correctedPreservation.reviewUsage === '선물 포장, 답례품', message: `같은 작업의 제품명 수정이 사용용도를 지웠습니다: ${JSON.stringify(proof)}` },
    { ok: JSON.stringify(proof.correctedManualValues) === JSON.stringify({ usage: '선물 포장, 답례품', width_mm: '4.8cm', depth_mm: '23cm', weight: '5.3g' }), message: `같은 작업의 제품명 수정이 수동 필드를 지웠습니다: ${JSON.stringify(proof.correctedManualValues)}` },
    { ok: proof.candidateBaseline.confirmedDb?.usage === '이전 확정 DB 사용용도' && proof.candidateBaseline.dbCandidates?.length === 1 && proof.candidateBaseline.cafe24Candidates?.length === 1, message: `이름 수정 전 후보 PIN이 유효하지 않습니다: ${JSON.stringify(proof.candidateBaseline)}` },
    { ok: Object.entries(proof.candidateBaseline.confirmedDb).every(([key, value]) => proof.correctedPreservation.confirmedDb?.[key] === value) && proof.correctedPreservation.confirmedDb?.reviewProductScopeKey && proof.correctedPreservation.dbCandidates === 1 && proof.correctedPreservation.cafe24Candidates === 1 && proof.correctedPreservation.selectedDbCandidate === proof.candidateBaseline.selectedDbCandidate && proof.correctedPreservation.selectedCafe24Candidate === proof.candidateBaseline.selectedCafe24Candidate && proof.correctedPreservation.blankNamePreserved, message: `같은 작업의 제품명 수정이 이전 확정 DB 또는 후보 선택값을 지웠습니다: ${JSON.stringify({ before: proof.candidateBaseline, after: proof.correctedPreservation })}` },
    { ok: proof.correctedPreservation.blankNamePreserved && proof.correctedUsageValue === '선물 포장, 답례품', message: `빈 제품명 입력이 현재 작업을 훼손했습니다: ${proof.blankNameResult}` },
    { ok: proof.stalePersistedWidth === '', message: `identity 없는 오래된 분석/payload 사이즈가 현재 작업에 복구됐습니다: ${proof.stalePersistedWidth}` },
    { ok: proof.scopedPersistedWidth === '12cm', message: `현재 작업 scope가 찍힌 분석 사이즈가 복구되지 않았습니다: ${proof.scopedPersistedWidth}` },
    { ok: proof.newWorkWorkspaceScope && proof.newWorkWorkspaceScope !== proof.previousWorkspaceScope, message: `새 작업이 별도 workspace scope를 만들지 않았습니다: ${JSON.stringify({ before: proof.previousWorkspaceScope, after: proof.newWorkWorkspaceScope })}` },
    { ok: proof.newWorkUsageStatus === 'missing' && proof.newWorkUsageValue === '' && proof.newWorkReviewUsage === '', message: '명시적 새 작업에 이전 제품의 사용용도가 섞였습니다.' },
    { ok: proof.newWorkConfirmedDb === null && proof.newWorkDbCandidates === 0 && proof.newWorkCafe24Candidates === 0, message: '명시적 새 작업에 이전 확정 DB 또는 후보 선택값이 남았습니다.' },
  ]);
  const visual = await evaluate(cdp, `(async () => {
    const projectId = 'field_confirmation_persistence_visual_v143';
    const productName = '사용용도화면검증상품';
    const runId = 'field_confirmation_visual_run_v143';
    window.state.step = 'factory';
    window.state.currentProjectId = projectId;
    window.state.currentProjectName = productName;
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = productName;
    window.state.factory = window.normalizeFactoryState({});
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity(factory, { projectId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
    factory.product.productName = productName;
    factory.product.userProductName = productName;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.product.inputImageFingerprint = 'field-confirmation-visual-image-v143';
    factory.automation.currentRunId = runId;
    factory.goalRun.currentRunId = runId;
    factory.automation.activeTab = 'fields';
    await window.render();
    const setAndConfirm = (fieldId, value) => {
      window.factoryCommitAutomationWizardFieldValue(fieldId, value, fieldId, false, factory);
    };
    setAndConfirm('usage', '선물 포장, 답례품');
    delete factory.product.dbFieldSettings.usage;
    window.factoryUpdateFinalDbFromFields(factory);
    setAndConfirm('width_mm', '4.8cm');
    setAndConfirm('depth_mm', '23cm');
    setAndConfirm('weight', '5.3g');
    await window.render();
    await new Promise(resolve => setTimeout(resolve, 450));
    const inputs = Array.from(document.querySelectorAll('[data-factory-wizard-field="usage"]'));
    const input = inputs.find(item => item.closest('.factory-automation-panel')) || inputs[0];
    const row = input?.closest('.factory-automation-status-card') || input?.parentElement;
    row?.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = row?.getBoundingClientRect();
    const summary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const usage = summary.fields.find(field => field.id === 'usage') || {};
    return {
      usageStatus: usage.status || '',
      usageValue: usage.value || '',
      cardText: String(row?.textContent || '').trim(),
      inputValue: String(input?.value || ''),
      inputVisible: !!rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
      viewportY: rect?.top || 0,
      screenshotClip: rect ? {
        x: Math.max(0, rect.left - 12),
        y: Math.max(0, rect.top - 12),
        width: Math.min(window.innerWidth - Math.max(0, rect.left - 12), rect.width + 24),
        height: Math.min(window.innerHeight - Math.max(0, rect.top - 12), rect.height + 24),
        scale: 1,
      } : null,
    };
  })()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  await cdp.send('Page.captureScreenshot', { format: 'png' })
    .then(result => fs.writeFileSync(VISIBLE_SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));
  assertChecks([
    { ok: visual.usageStatus === 'done' && visual.usageValue === '선물 포장, 답례품', message: '화면용 사용용도 확인 상태가 완료가 아닙니다.' },
    { ok: visual.cardText.includes('사용용도') && visual.inputValue === '선물 포장, 답례품', message: `화면용 카드에 사용용도 완료값이 보이지 않습니다: ${JSON.stringify({ card: visual.cardText, value: visual.inputValue })}` },
    { ok: visual.inputVisible, message: `화면용 사용용도 입력 행이 뷰포트에 보이지 않습니다: y=${visual.viewportY}` },
  ]);
  // ── 여기서부터: 제목이 약속한 '새로고침 유지' 를 실제로 확인한다 ──────────────
  //
  // 2026-09-02 까지 이 검사는 Page.reload 를 한 번도 하지 않았다(최초 로드뿐).
  // 이름은 "필수값 확인 상태 새로고침 유지" 인데 실제로는 메모리 정합성만 봤다.
  // 사장님은 이 이름을 보고 안심하신다 — "필수값 고른 게 날아가면 안 된다" 는
  // 그분이 가장 자주 말씀하신 원칙이다. 그래서 진짜로 새로고침한다.
  await evaluate(cdp, `(async () => {
    // 확정값을 다시 세우고 저장까지 마친 뒤 새로고침한다.
    const factory = window.factoryState();
    window.factoryCommitAutomationWizardFieldValue('usage', '선물 포장, 답례품', 'usage', false, factory);
    if (typeof window.saveLastWorkNow === 'function') {
      await window.saveLastWorkNow({ force: true, sync: false });
    }
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 2500));
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState && window.factoryAutomationReviewSummary)', 60000);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const afterReload = await evaluate(cdp, `(() => {
    const factory = window.factoryState();
    const summary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
    const usage = summary.fields.find(field => field.id === 'usage') || {};
    return {
      productName: window.state?.productName || '',
      usageStatus: usage.status || '',
      usageValue: usage.value || '',
      manualValue: factory.product?.dbFieldSettings?.usage?.manualValue || '',
      reviewValue: factory.automation?.fieldReview?.usage?.value || '',
    };
  })()`);
  assertChecks([
    { ok: afterReload.usageValue === '선물 포장, 답례품' || afterReload.manualValue === '선물 포장, 답례품' || afterReload.reviewValue === '선물 포장, 답례품',
      message: `Ctrl+F5 뒤 확정한 필수값이 사라졌습니다: ${JSON.stringify(afterReload)}` },
    { ok: afterReload.usageStatus === 'done',
      message: `Ctrl+F5 뒤 확인 상태가 완료가 아닙니다: ${JSON.stringify(afterReload)}` },
  ]);

  console.log(JSON.stringify({ ok: true, proof, visual, afterReload, screenshot: SCREENSHOT_PATH, visibleScreenshot: VISIBLE_SCREENSHOT_PATH }, null, 2));
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
