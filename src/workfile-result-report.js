const KUASANGSE_WORKFILE_RESULT_REPORT_SCHEMA = 'kuasangse.workfile-result-report';
const KUASANGSE_WORKFILE_RESULT_REPORT_VERSION = 1;
const KUASANGSE_FACTORY_REPORT_STAGES = Object.freeze([
  Object.freeze({ number: 1, key: 'start', label: '시작' }),
  Object.freeze({ number: 2, key: 'db', label: 'DB 확정' }),
  Object.freeze({ number: 3, key: 'fields', label: '필수값' }),
  Object.freeze({ number: 4, key: 'competitor', label: '경쟁사' }),
  Object.freeze({ number: 5, key: 'assets', label: '생성컷 선택' }),
  Object.freeze({ number: 6, key: 'sections', label: '섹션 생성' }),
  Object.freeze({ number: 7, key: 'publish', label: '전송/저장' }),
]);

function factoryResultReportText(value) {
  return String(value ?? '').trim();
}

function factoryResultReportRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function factoryResultReportList(value) {
  return Array.isArray(value) ? value : [];
}

function factoryResultReportWorkfileName(projectName = '') {
  const activeName = typeof kuasangseProjectFileActiveHandle !== 'undefined'
    ? factoryResultReportText(kuasangseProjectFileActiveHandle?.name)
    : '';
  if (activeName) return activeName;
  const base = factoryResultReportText(projectName || '새 작업')
    .replace(/\.kuasangse$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_');
  return `${base || '새 작업'}.kuasangse`;
}

function factoryResultReportStage(number) {
  return KUASANGSE_FACTORY_REPORT_STAGES.find(stage => stage.number === number)
    || KUASANGSE_FACTORY_REPORT_STAGES[0];
}

function factoryResultReportActiveStageNumber(factory) {
  const tab = factoryResultReportText(factory.automation?.activeTab || factory.activeStage).toLowerCase();
  const aliases = {
    start: 1,
    db: 2,
    fields: 3,
    competitor: 4,
    competitors: 4,
    assets: 5,
    hero: 5,
    size: 5,
    options: 5,
    cuts: 5,
    sections: 6,
    detail: 6,
    publish: 7,
    send: 7,
    export: 7,
  };
  return aliases[tab] || 1;
}

function factoryResultReportLocalProgress(payload, factory, summary) {
  const product = factoryResultReportRecord(factory.product);
  const stages = factoryResultReportRecord(factory.stages);
  const parallel = factoryResultReportRecord(factory.automation?.parallelProgress);
  const productName = factoryResultReportText(
    product.userProductName || product.productName || payload.productName,
  );
  let lastCompleted = productName || payload.imagePreview || payload.imageBase64 ? 1 : 0;
  if (stages.db?.status === 'done') lastCompleted = Math.max(lastCompleted, 2);
  if (Object.keys(factoryResultReportRecord(product.finalDb)).length >= 4) {
    lastCompleted = Math.max(lastCompleted, 3);
  }
  if (
    parallel.vm?.status === 'done'
    || factoryResultReportList(product.competitorCandidates).length
    || factoryResultReportList(product.vmCandidates).length
  ) {
    lastCompleted = Math.max(lastCompleted, 4);
  }
  const assetStageKeys = ['hero', 'size', 'options', 'cuts'];
  if (assetStageKeys.every(key => stages[key]?.status === 'done')) {
    lastCompleted = Math.max(lastCompleted, 5);
  }
  if (stages.detail?.status === 'done') {
    lastCompleted = Math.max(lastCompleted, 6);
  }
  const activeStage = factoryResultReportActiveStageNumber(factory);
  lastCompleted = Math.max(lastCompleted, Math.max(0, activeStage - 1));
  return { lastCompleted, activeStage };
}

function factoryResultReportOptionCounts(payload, product, receipt) {
  const groups = factoryResultReportList(product.cafe24OptionGroupsDraft);
  const optionGroupCount = Number(receipt.optionGroupCount || groups.length || 0);
  const optionValueCount = Number(receipt.optionValueCount || groups.reduce((sum, group) => (
    sum + factoryResultReportList(group?.values || group?.option_value).length
  ), 0));
  const selectedKey = factoryResultReportText(product.selectedCafe24CandidateKey);
  const candidate = factoryResultReportList(product.cafe24Candidates).find(item => (
    factoryResultReportText(item?.key) === selectedKey
  ));
  const raw = factoryResultReportRecord(candidate?.raw || candidate);
  const variants = factoryResultReportList(
    product.cafe24Variants || product.cafe24VariantRows || raw.variants,
  );
  const variantCount = Number(receipt.variantCount || variants.length || 0);
  return { optionGroupCount, optionValueCount, variantCount };
}

function factoryApplyCafe24PublicationReceipt(factoryValue, recordValue, options = {}) {
  const factory = factoryResultReportRecord(factoryValue);
  const product = factoryResultReportRecord(factory.product);
  factory.product = product;
  const record = factoryResultReportRecord(recordValue);
  const finalDb = factoryResultReportRecord(product.finalDb);
  const mallId = factoryResultReportText(options.mallId || record.mallId || 'bojagi1928');
  const productNo = factoryResultReportText(
    options.productNo || record.productNo || finalDb.product_no || finalDb.cafe24_product_no,
  );
  const sourceWorkfileName = factoryResultReportText(
    options.sourceWorkfileName || record.sourceWorkfileName,
  ) || factoryResultReportWorkfileName(record.projectName);
  const receipt = Object.freeze({
    schema: 'kuasangse.cafe24-publication-receipt',
    version: 1,
    sourceWorkfileName,
    projectId: factoryResultReportText(record.projectId || factory.currentProjectId),
    projectName: factoryResultReportText(record.projectName || factory.currentProjectName),
    productNo,
    productCode: factoryResultReportText(record.productCode || finalDb.product_code),
    productName: factoryResultReportText(record.productName || finalDb.product_name),
    mallId,
    registeredAt: Number(record.registeredAt || Date.now()),
    display: factoryResultReportText(record.cafe24Display || finalDb.display_status || 'F'),
    selling: factoryResultReportText(record.cafe24Selling || finalDb.selling_status || 'F'),
    registrationMode: factoryResultReportText(
      record.registrationMode || factory.openMarketSync?.cafe24RegistrationMode,
    ),
    optionGroupCount: Number(options.optionGroupCount || record.optionGroupCount || 0),
    optionValueCount: Number(options.optionValueCount || record.optionValueCount || 0),
    variantCount: Number(options.variantCount || record.variantCount || 0),
    adminUrl: productNo
      ? `https://${mallId}.cafe24.com/disp/admin/shop1/product/ProductRegister?product_no=${encodeURIComponent(productNo)}`
      : '',
    storefrontUrl: productNo
      ? `https://${mallId}.cafe24.com/product/detail.html?product_no=${encodeURIComponent(productNo)}`
      : '',
  });
  product.cafe24PublicationReceipt = receipt;
  return receipt;
}

function buildFactoryWorkfileResultReport(options = {}) {
  const payload = factoryResultReportRecord(options.payload);
  const identity = factoryResultReportRecord(options.identity);
  const summary = factoryResultReportRecord(options.summary);
  const factory = factoryResultReportRecord(payload.factory);
  const product = factoryResultReportRecord(factory.product);
  const finalDb = factoryResultReportRecord(product.finalDb);
  const sync = factoryResultReportRecord(factory.openMarketSync);
  const receipt = factoryResultReportRecord(product.cafe24PublicationReceipt);
  const mallId = factoryResultReportText(options.defaultMallId || receipt.mallId || 'bojagi1928');
  const productNo = factoryResultReportText(
    receipt.productNo || finalDb.product_no || finalDb.cafe24_product_no,
  );
  const finalStatus = factoryResultReportText(
    sync.finalRegistrationStatus || product.cafe24ApiStatus,
  );
  const registered = Boolean(
    productNo && (receipt.productNo || /최종 등록 완료|새 상품 등록 완료|반영완료/.test(finalStatus)),
  );
  const failed = /실패/.test(finalStatus);
  const progress = factoryResultReportLocalProgress(payload, factory, summary);
  const lastCompleted = registered ? 7 : progress.lastCompleted;
  const stoppedAt = registered
    ? 7
    : Math.max(progress.activeStage, Math.min(7, Math.max(1, lastCompleted + 1)));
  const counts = factoryResultReportOptionCounts(payload, product, receipt);
  const sourceWorkfileName = factoryResultReportText(receipt.sourceWorkfileName)
    || factoryResultReportWorkfileName(identity.name || payload.currentProjectName);
  const statusCode = registered
    ? 'cafe24_registered'
    : failed
      ? 'failed'
      : lastCompleted > 0
        ? 'factory_in_progress'
        : 'not_started';
  const statusLabels = {
    cafe24_registered: 'Cafe24 등록 완료',
    failed: '실패 후 중단',
    factory_in_progress: '조립공장 진행 중',
    not_started: '작업 시작 전',
  };
  return Object.freeze({
    schema: KUASANGSE_WORKFILE_RESULT_REPORT_SCHEMA,
    version: KUASANGSE_WORKFILE_RESULT_REPORT_VERSION,
    generatedAt: Number(options.generatedAt || Date.now()),
    workfile: Object.freeze({
      name: sourceWorkfileName,
      projectId: factoryResultReportText(identity.id || payload.currentProjectId),
      projectName: factoryResultReportText(identity.name || payload.currentProjectName),
    }),
    status: Object.freeze({ code: statusCode, label: statusLabels[statusCode] }),
    factory: Object.freeze({
      lastCompletedStage: Object.freeze({ ...factoryResultReportStage(lastCompleted) }),
      stoppedAtStage: Object.freeze({ ...factoryResultReportStage(stoppedAt) }),
      activeTab: factoryResultReportText(factory.automation?.activeTab),
      sections: Number(summary.sections || 0),
    }),
    cafe24: Object.freeze({
      registered,
      productNo,
      productCode: factoryResultReportText(receipt.productCode || finalDb.product_code),
      productName: factoryResultReportText(
        receipt.productName || finalDb.cafe24_product_name || finalDb.product_name || product.productName,
      ),
      mallId,
      display: factoryResultReportText(receipt.display || finalDb.display_status),
      selling: factoryResultReportText(receipt.selling || finalDb.selling_status),
      registrationMode: factoryResultReportText(
        receipt.registrationMode || sync.cafe24RegistrationMode,
      ),
      registeredAt: Number(receipt.registeredAt || sync.finalRegistrationUpdatedAt || 0),
      sourceWorkfileName,
      optionGroupCount: counts.optionGroupCount,
      optionValueCount: counts.optionValueCount,
      variantCount: counts.variantCount,
      adminUrl: productNo
        ? `https://${mallId}.cafe24.com/disp/admin/shop1/product/ProductRegister?product_no=${encodeURIComponent(productNo)}`
        : '',
      storefrontUrl: productNo
        ? `https://${mallId}.cafe24.com/product/detail.html?product_no=${encodeURIComponent(productNo)}`
        : '',
      finalStatus,
    }),
  });
}
