import {
  FACTORY_CONTROL_EVENT_VERSION,
  FactorySyncConflict,
  applyFactoryDelta,
  buildACutSelectionCommand,
  disconnectedFactoryProjection,
  normalizeFactoryProjection,
  reconcileFactoryProjectionForSameWork,
} from './factory-sync-model.mjs?selectedId=4';
import { bindMenuShell, projectMenuBadges } from './menu-shell.mjs?menuReorg=3';
import { buildOperatorQueueRow } from './operator-queue-model.mjs?batchList=2';
// 사람 말로 옮긴 사유 표는 보드 모델이 들고 있다. 화면마다 따로 두면 한쪽만 번역되어
// 같은 코드가 어떤 화면에서는 한국어로, 어떤 화면에서는 원시 코드로 뜬다.
import { OPERATOR_MESSAGES } from './production-board-model.mjs?parallelBoard=43';
import { deriveAssemblyWorkbench, resolveCandidateAsset } from './production-workbench-model.mjs?currentProductTruth=2';
import { groupWorkBundleSectionAssets } from './production-result-groups.mjs?detailSections=1';
import {
  createWorkfileJobTabRegistry,
  workfileIdentityMatches,
  workfileTargetIdentityMatches,
  workfileTabIdentity,
} from './workfile-job-tabs-model.mjs?workfileTabs=5';

export {
  buildCandidateReviewActions,
  buildIoConveyorProjection,
  mergeCommandResult,
  normalizeJob,
  normalizeJobs,
  reviewPayloadSignature,
  resolveCandidateAsset,
} from './production-workbench-model.mjs?currentProductTruth=2';
export {
  applyFactoryDelta,
  buildACutSelectionCommand,
  disconnectedFactoryProjection,
  normalizeFactoryProjection,
  reconcileFactoryProjectionForSameWork,
} from './factory-sync-model.mjs?selectedId=4';
export { groupWorkBundleSectionAssets } from './production-result-groups.mjs?detailSections=1';
export { createWorkfileJobTabRegistry } from './workfile-job-tabs-model.mjs?workfileTabs=5';

const STAGE_LABELS = Object.freeze({
  representative: '대표이미지',
  size: '사이즈이미지',
  option_color: '색상옵션',
  general: '이미지컷',
  sections: '섹션 변형',
  final_detail: '최종 상세페이지',
});
const INPUT_LABELS = Object.freeze({
  product: '제품과 자료 출처',
  requirements: '필수값',
  source_images: '제품·색상 이미지',
  strategy: '자동화 방식',
  competitors: '경쟁사 후보·상세 분석',
});
const AUTOMATION_DECISIONS = Object.freeze({
  sinhwa_db_product: '신화사 DB 제품 후보',
  cafe24_product: 'Cafe24 제품 후보',
  competitor_coupang: '경쟁사 · 쿠팡',
  competitor_smartstore: '경쟁사 · 스마트스토어',
  competitor_gmarket: '경쟁사 · G마켓',
  competitor_auction: '경쟁사 · 옥션',
  competitor_elevenst: '경쟁사 · 11번가',
  required_field_candidate: '필수값 후보·충돌',
  representative_image: '대표이미지 A컷',
  size_image: '사이즈이미지 A컷',
  option_image: '색상옵션 A컷',
  general_image: '이미지컷 A컷',
  section_variant: '섹션 변형 A컷',
  final_detail: '최종 상세페이지 A컷',
});
const STAGE_DECISIONS = Object.freeze({
  representative: 'representative_image',
  size: 'size_image',
  option_color: 'option_image',
  general: 'general_image',
  sections: 'section_variant',
  final_detail: 'final_detail',
});
const STATUS_LABELS = Object.freeze({
  auto: '자동',
  manual: '수동',
  blocked: '차단',
  failed: '실패',
  completed: '완료',
  running: '진행 중',
  queued: '대기',
  paused: '일시정지',
  waiting_manual: 'A컷 결정 필요',
  empty: '아직 생성되지 않음',
  ready: '준비',
  approval_required: '승인 필요',
  staged_pending_readback: '원격 재확인 대기',
  executing: '등록 실행 중',
  staged_verified: '등록 검증 완료',
  disconnected: '조립공장 연결 끊김',
  unlinked: '연결 안 됨',
  ambiguous: '연결 확인 필요',
  rebind_required: '승인 파일 연결 필요',
  target_rebind_required: '선택 작업 연결 승인 필요',
  stale: '작업파일 갱신 필요',
});
const CANDIDATE_PAGE_SIZE = 24;
const FACTORY_HISTORY_QUERY = 'factoryHistoryJob';
const WORK_BUNDLE_ROLE_LABELS = Object.freeze({
  base: '기본 입력',
  'cafe24-candidate-image': 'Cafe24 후보',
  'color-option-input': '색상·옵션 입력',
  'color-option': '색상옵션',
  competitor: '경쟁사',
  'competitor-image': '경쟁사 후보',
  'competitor-page': '경쟁사 상세 수집',
  hero: '대표이미지',
  'color-option-output': '색상옵션',
  size: '사이즈이미지',
  lifestyle: '라이프스타일',
  feature: '특징',
  section: '섹션',
  'stitched-detail': '최종 상세',
  generated: '생성 결과',
  other: '기타',
});
const HISTORY_SELECTION_STAGE_LABELS = Object.freeze({
  general: '이미지컷',
  representative: '대표이미지',
  size: '사이즈이미지',
  option_color: '색상옵션',
  sections: '상세 섹션',
  final_detail: '최종 상세',
});
const CAFE24_DEFAULT_MALL_ID = 'bojagi1928';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function firstText(...values) {
  return values.map(text).find(Boolean) || '';
}

export function buildWorkfileRebindPayload({ job: jobValue, projection: projectionValue, workfile: workfileValue }) {
  const job = record(jobValue);
  const projection = normalizeFactoryProjection(projectionValue);
  const workfile = record(workfileValue);
  const jobId = text(job.jobId);
  const workfileText = typeof workfile.workfileText === 'string' ? workfile.workfileText : '';
  if (!workfile.file || !workfileText.trim()) {
    const error = new Error('workfile_reselect_required');
    error.code = 'workfile_reselect_required';
    throw error;
  }
  if (!jobId || text(projection.registration.jobId) !== jobId) {
    const error = new Error('factory_job_view_not_current');
    error.code = 'factory_job_view_not_current';
    throw error;
  }
  const explicitTargetMatch = text(workfile.targetJobId) === jobId
    && workfileTargetIdentityMatches(projection.session, workfile.identity);
  if (
    text(job.status) !== 'blocked'
    || (!workfileIdentityMatches(projection.session, workfile.identity) && !explicitTargetMatch)
  ) {
    const error = new Error('factory_workfile_rebind_identity_mismatch');
    error.code = 'factory_workfile_rebind_identity_mismatch';
    throw error;
  }
  const current = workfileTabIdentity(projection.session);
  const incoming = workfileTabIdentity(workfile.identity);
  const sha256 = text(workfile.sha256).toLowerCase();
  if (incoming.revision < current.revision || !incoming.runId || !/^[a-f0-9]{64}$/u.test(sha256)) {
    const error = new Error('stale_workfile_revision');
    error.code = 'stale_workfile_revision';
    throw error;
  }
  return Object.freeze({
    fileName: text(workfile.fileName),
    workfileText,
    expectedSha256: sha256,
    expectedWorkspaceId: current.workspaceId,
    expectedProductId: current.productId,
    expectedProductKey: current.productKey,
    expectedRunId: incoming.runId,
    expectedInputFingerprint: current.inputFingerprint,
    expectedWorkfileRevision: current.revision,
    expectedHydratedWorkfileRevision: incoming.revision,
    expectedCheckpointRevision: current.revision,
    expectedCheckpointRunId: current.runId,
    idempotencyKey: `workfile-rebind:${jobId}:${current.revision}:${incoming.revision}:${sha256}`,
  });
}

export function buildWorkfileForkPayload({ projection: projectionValue, workfile: workfileValue }) {
  const projection = normalizeFactoryProjection(projectionValue);
  const workfile = record(workfileValue);
  const identity = workfileTabIdentity(workfile.identity);
  const classification = record(workfile.classification);
  const workfileText = typeof workfile.workfileText === 'string' ? workfile.workfileText : '';
  const sha256 = text(workfile.sha256).toLowerCase();
  if (
    !workfile.file
    || !workfileText.trim()
    || !/^[a-f0-9]{64}$/u.test(sha256)
    || list(record(workfile.identity).conflicts).length
    || !identity.workspaceId
    || !identity.productKey
    || !identity.runId
    || !identity.inputFingerprint
    || identity.revision < 0
  ) {
    const error = new Error('workfile_identity_invalid');
    error.code = 'workfile_identity_invalid';
    throw error;
  }
  if (
    projection.registration.jobId
    || ['workspaceId', 'productId', 'productKey', 'runId', 'inputFingerprint'].some(
      field => text(projection.session[field]),
    )
  ) {
    const error = new Error('factory_workfile_fork_foreign_live_job');
    error.code = 'factory_workfile_fork_foreign_live_job';
    throw error;
  }
  const requiredAliases = Object.freeze({
    category: 'category',
    material: 'material',
    origin: 'originCountry',
    originCountry: 'originCountry',
    dimensions: 'size',
    size: 'size',
    sale_price: 'salePrice',
    salePrice: 'salePrice',
    stock: 'stock',
    recommended_use: 'usage',
    usage: 'usage',
    optionMode: 'optionMode',
  });
  const requiredValues = Object.fromEntries(
    list(record(classification.inputs).requiredFields)
      .filter(field => text(record(field).status) === 'confirmed' && requiredAliases[text(record(field).key)])
      .map(field => [requiredAliases[text(record(field).key)], text(record(field).value)])
      .filter(([, value]) => value),
  );
  const productName = text(record(classification.product).name || workfile.fileName);
  let hydratedProductId = identity.productId;
  if (!hydratedProductId) {
    try {
      const document = record(JSON.parse(workfileText));
      const payload = record(record(document.project).payload);
      const assetPayload = record(payload.assetPayload);
      const factory = record(Object.keys(record(payload.factory)).length ? payload.factory : assetPayload.factory);
      const finalDb = record(record(factory.product).finalDb);
      const productNos = [...new Set([finalDb.cafe24_product_no, finalDb.product_no]
        .map(value => text(value))
        .filter(value => /^[1-9]\d*$/u.test(value)))];
      if (productNos.length > 1) {
        const error = new Error('workfile_identity_invalid');
        error.code = 'workfile_identity_invalid';
        throw error;
      }
      if (productNos.length === 1) hydratedProductId = `cafe24:${productNos[0]}`;
    } catch (error) {
      if (error?.code === 'workfile_identity_invalid') throw error;
    }
  }
  return Object.freeze({
    fileName: text(workfile.fileName),
    workfileText,
    expectedSha256: sha256,
    expectedWorkspaceId: identity.workspaceId,
    expectedProductId: hydratedProductId || `factory:${identity.productKey}`,
    expectedProductKey: identity.productKey,
    expectedRunId: identity.runId,
    expectedInputFingerprint: identity.inputFingerprint,
    expectedWorkfileRevision: projection.session.revision,
    expectedHydratedWorkfileRevision: identity.revision,
    batchId: `workfile:${sha256.slice(0, 16)}`,
    mode: 'manual',
    productName,
    requiredValues,
    idempotencyKey: `factory-workfile-fork:${sha256}:${identity.revision}:manual`,
  });
}

export function buildFactoryResumePayload({ job: jobValue, projection: projectionValue, imageModel = '' }) {
  const job = record(jobValue);
  const projection = normalizeFactoryProjection(projectionValue);
  if (!text(job.jobId) || text(projection.registration.jobId) !== text(job.jobId)) {
    const error = new Error('factory_job_view_not_current');
    error.code = 'factory_job_view_not_current';
    throw error;
  }
  if (!projection.session.runId || projection.session.revision < 0) {
    const error = new Error('factory_product_checkpoint_invalid');
    error.code = 'factory_product_checkpoint_invalid';
    throw error;
  }
  return Object.freeze({
    imageModel: text(imageModel),
    expectedCheckpointRevision: projection.session.revision,
    expectedCheckpointRunId: projection.session.runId,
  });
}

function httpUrl(value) {
  const candidate = text(value);
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

export function cafe24RegistrationSummary(registrationValue, sessionValue = {}, receiptValue = null) {
  const registration = record(registrationValue);
  const session = record(sessionValue);
  const receipt = record(receiptValue || registration.publicationReceipt);
  const remote = record(receipt.remoteReadback);
  const verified = text(receipt.schema) === 'factory-cafe24-terminal-publication-receipt:v1'
    && Boolean(text(receipt.receiptId))
    && text(receipt.status) === 'staged_verified'
    && Boolean(text(receipt.remoteReadbackDigest))
    && Boolean(text(remote.productNo))
    && Boolean(text(receipt.jobId))
    && text(receipt.jobId) === text(registration.jobId)
    && Boolean(text(receipt.productId))
    && text(receipt.productId) === text(registration.productId || session.productId);
  const productNo = verified ? text(remote.productNo) : '';
  const mallId = verified ? firstText(remote.mallId, receipt.mallId, CAFE24_DEFAULT_MALL_ID) : '';
  const storefrontUrl = httpUrl(
    verified ? firstText(remote.storefrontUrl, remote.productUrl, receipt.storefrontUrl, receipt.productUrl, receipt.productLink) : '',
  ) || (productNo
    ? `https://${mallId}.cafe24.com/product/detail.html?product_no=${encodeURIComponent(productNo)}`
    : '');
  const adminUrl = httpUrl(verified ? firstText(remote.adminUrl, receipt.adminUrl) : '') || (productNo
    ? `https://${mallId}.cafe24.com/disp/admin/shop1/product/ProductRegister?product_no=${encodeURIComponent(productNo)}`
    : '');
  const status = verified ? 'staged_verified' : firstText(receipt.status, registration.status);
  return Object.freeze({
    status,
    registered: verified,
    jobId: verified ? firstText(receipt.jobId, registration.jobId) : '',
    productName: verified ? firstText(remote.productName, receipt.productName) : '',
    productNo,
    productCode: verified ? firstText(remote.productCode, receipt.productCode) : '',
    mallId,
    registrationMode: verified ? firstText(remote.registrationMode, receipt.registrationMode) : '',
    sourceWorkfileName: verified ? firstText(receipt.sourceWorkfileName, session.workfileName) : '',
    registeredAt: verified ? firstText(remote.updatedAt, receipt.registeredAt) : '',
    representativeImageCount: verified ? Number(remote.representativeImageCount || receipt.representativeImageCount || 0) : 0,
    detailImageCount: verified ? Number(remote.detailImageCount || receipt.detailImageCount || 0) : 0,
    variantCount: verified ? Number(remote.variantCount || receipt.variantCount || 0) : 0,
    storefrontUrl,
    adminUrl,
    receiptId: verified ? firstText(receipt.receiptId) : '',
  });
}

function sameCurrentProductWork(current, incoming) {
  return current.connected && incoming.connected && [
    'workspaceId', 'productId', 'productKey', 'runId', 'inputFingerprint',
  ].every(key => text(current.session[key]) && text(current.session[key]) === text(incoming.session[key]));
}

function projectionRecordKey(value) {
  const source = record(value);
  return firstText(
    source.key,
    source.id,
    source.assetId,
    source.candidateId,
    source.receiptId,
    source.productId,
    source.productNo,
    source.snapshotDigest,
    source.productName,
    source.name,
    JSON.stringify(source),
  );
}

function mergeProjectionRecords(currentValues, incomingValues, preferCurrent = false) {
  const merged = new Map(list(currentValues).map(value => [projectionRecordKey(value), record(value)]));
  for (const value of list(incomingValues)) {
    const key = projectionRecordKey(value);
    if (!key) continue;
    const previous = record(merged.get(key));
    merged.set(key, preferCurrent
      ? { ...record(value), ...previous }
      : { ...previous, ...record(value) });
  }
  return [...merged.values()];
}

export function preserveCurrentProductProjection(currentValue, incomingValue) {
  const current = normalizeFactoryProjection(currentValue);
  const incoming = normalizeFactoryProjection(incomingValue);
  const reconciled = reconcileFactoryProjectionForSameWork(current, incoming);
  if (!sameCurrentProductWork(current, incoming)) return reconciled;
  const incomingIsStale = incoming.sequence <= current.sequence
    && incoming.session.revision <= current.session.revision;
  const currentInputs = new Map(current.inputs.map(item => [item.key, item]));
  const inputs = reconciled.inputs.map(item => {
    const previous = currentInputs.get(item.key);
    if (!previous) return item;
    const items = mergeProjectionRecords(previous.items, item.items, incomingIsStale);
    return {
      ...previous,
      ...item,
      count: Math.max(previous.count, item.count, items.length),
      items,
    };
  });
  for (const item of current.inputs) {
    if (!inputs.some(candidate => candidate.key === item.key) && (item.count || item.items.length || item.missing.length)) inputs.push(item);
  }
  const currentStages = new Map(current.stages.map(stage => [stage.key, stage]));
  const stages = reconciled.stages.map(stage => {
    const previous = currentStages.get(stage.key);
    if (!previous) return stage;
    const candidates = new Map(previous.candidates.map(candidate => [candidate.id, candidate]));
    for (const candidate of stage.candidates) {
      if (!incomingIsStale || !candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
    }
    return {
      ...previous,
      ...stage,
      candidates: [...candidates.values()],
      selectedId: incomingIsStale
        ? firstText(previous.selectedId, stage.selectedId)
        : firstText(stage.selectedId, previous.selectedId),
    };
  });
  for (const stage of current.stages) {
    if (!stages.some(candidate => candidate.key === stage.key) && (stage.candidates.length || stage.selectedId)) stages.push(stage);
  }
  return normalizeFactoryProjection({
    ...reconciled,
    inputs,
    stages,
    progress: incomingIsStale ? {
      ...reconciled.progress,
      ...current.progress,
      stageKey: firstText(current.progress.stageKey, reconciled.progress.stageKey),
      stageLabel: firstText(current.progress.stageLabel, reconciled.progress.stageLabel),
      status: firstText(current.progress.status, reconciled.progress.status),
      mode: firstText(current.progress.mode, reconciled.progress.mode),
    } : {
      ...current.progress,
      ...reconciled.progress,
      stageKey: firstText(reconciled.progress.stageKey, current.progress.stageKey),
      stageLabel: firstText(reconciled.progress.stageLabel, current.progress.stageLabel),
      status: firstText(reconciled.progress.status, current.progress.status),
      mode: firstText(reconciled.progress.mode, current.progress.mode),
    },
    registration: {
      ...(incomingIsStale ? reconciled.registration : current.registration),
      ...(incomingIsStale ? current.registration : reconciled.registration),
      publicationReceipt: Object.keys(record(current.registration.publicationReceipt)).length
        ? current.registration.publicationReceipt
        : reconciled.registration.publicationReceipt,
    },
    receipts: mergeProjectionRecords(current.receipts, reconciled.receipts, incomingIsStale),
    products: mergeProjectionRecords(current.products, reconciled.products, incomingIsStale),
    session: {
      ...reconciled.session,
      revision: Math.max(current.session.revision, reconciled.session.revision),
      workfileName: firstText(reconciled.session.workfileName, current.session.workfileName),
      workfileSource: firstText(reconciled.session.workfileSource, current.session.workfileSource),
      workfileSha256: firstText(reconciled.session.workfileSha256, current.session.workfileSha256),
      workfileBytes: Math.max(current.session.workfileBytes, reconciled.session.workfileBytes),
    },
  });
}

export function buildWorkfilePublicationLedger(projectionValue, receiptValue = null, historyValue = null) {
  const projection = record(projectionValue);
  const session = record(projection.session);
  const registration = record(projection.registration);
  const history = record(historyValue);
  const publication = cafe24RegistrationSummary(registration, session, receiptValue);
  const receiptCandidates = [
    record(receiptValue),
    record(registration.publicationReceipt),
    ...list(projection.receipts).map(record),
  ];
  const seen = new Set();
  const publications = receiptCandidates.flatMap(candidate => {
    const summary = cafe24RegistrationSummary(candidate, session, candidate);
    if (!summary.registered || !summary.productNo) return [];
    const key = summary.receiptId || `${summary.jobId}|${summary.productNo}|${summary.productName}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [summary];
  });
  const workfileName = firstText(
    publication.sourceWorkfileName,
    history.workfileFolderName,
    history.workfileName,
    projection.workBundle?.workfileName,
    session.workfileName,
  );
  const workfileSource = publication.sourceWorkfileName
    ? 'Cafe24 등록 영수증에 기록된 파일명'
    : history.workfileFolderName || history.workfileName
      ? 'kuasangse 완료 작업 이력'
      : session.workfileSource
        ? `상세페이지 프로그램 저장 · ${session.workfileSource}`
      : session.workfileName
        ? '조립공장 session 연결값'
        : '연결된 작업파일 없음';
  const workfileExact = Boolean(
    publication.sourceWorkfileName
    || /\.kuasangse$/i.test(text(session.workfileName)),
  );
  return Object.freeze({
    workfileName,
    workfileSource,
    workfileExact,
    workfileConnected: Boolean(workfileName),
    creationMode: workfileExact
      ? session.workfileSource
        ? '상세페이지 프로그램 기존 저장 로직으로 제품명 .kuasangse 자동 생성'
        : '기존 .kuasangse 연결 · 생산관제 자동 새 작업 생성 기록 없음'
      : workfileName
        ? '완료 이력 폴더만 확인 · 실제 .kuasangse 파일명·경로 미기록'
        : '생산관제 자동 새 .kuasangse 생성 기록 없음',
    workspaceId: text(session.workspaceId),
    productKey: firstText(session.productKey, registration.productKey),
    runId: text(session.runId),
    revision: Number(session.revision || 0),
    publication,
    publications: Object.freeze(publications),
  });
}

export function factoryHistoryJobFromLocation(search = '') {
  return text(new URLSearchParams(text(search)).get(FACTORY_HISTORY_QUERY));
}

export function defaultCompletedHistoryJobId(jobsValue, stateValue = {}) {
  const state = record(stateValue);
  if (state.hasSession === true || text(state.historyJobId) || text(state.requestedBundleId)) return '';
  const jobs = list(jobsValue);
  if (jobs.length !== 1) return '';
  const job = record(jobs[0]);
  return text(job.status) === 'completed' ? text(job.jobId) : '';
}

export function resolveLocalFactoryJobMode(projectionValue, jobsValue) {
  const jobId = text(record(record(projectionValue).registration).jobId);
  if (!jobId.startsWith('factory-job-')) return '';
  return text(list(jobsValue).find(job => text(record(job).jobId) === jobId)?.mode);
}

export function resolveLocalFactoryStageMode(projectionValue, jobsValue, stageKey) {
  const jobId = text(record(record(projectionValue).registration).jobId);
  if (!jobId.startsWith('factory-job-')) return '';
  const job = list(jobsValue).find(item => text(record(item).jobId) === jobId);
  const decisionId = STAGE_DECISIONS[text(stageKey)];
  const mode = text(record(record(record(job).policy).resolved)[decisionId]);
  return ['auto', 'manual'].includes(mode) ? mode : text(record(job).mode);
}

export function manualACutDecisionIds(jobValue) {
  const resolved = record(record(record(jobValue).policy).resolved);
  return Object.freeze(Object.entries(resolved)
    .filter(([decision]) => Object.values(STAGE_DECISIONS).includes(decision))
    .filter(([, mode]) => mode === 'manual')
    .map(([decision]) => decision));
}

export function waitingManualJobAction(jobValue, stageValue) {
  return Boolean(stageValue?.selectedId) ? 'resume' : 'open';
}

export function projectQueueProducts(projectionValue) {
  const current = normalizeFactoryProjection(projectionValue);
  if (current.products.length) return current.products;
  if (!current.connected || (!text(current.session.productId) && !text(current.session.productKey))) return [];
  return [{
    productId: current.session.productId,
    productKey: current.session.productKey,
    progress: current.progress,
  }];
}

export function cafe24RegistrationTargetLabel(registrationValue, sessionValue) {
  const registration = record(registrationValue);
  const session = record(sessionValue);
  const target = text(registration.productId || session.productId);
  if (text(registration.mode) === 'update' && target.startsWith('cafe24:')) {
    return `기존 상품 #${target.slice('cafe24:'.length)} 수정`;
  }
  return target.startsWith('cafe24:')
    ? `새 상품 등록 · 참고 상품 #${target.slice('cafe24:'.length)}`
    : '새 상품 등록';
}

export function normalizeWorkBundle(value) {
  const source = record(value);
  return Object.freeze({
    id: text(source.id),
    bundleKey: text(source.bundleKey),
    workfileName: text(source.workfileName),
    version: Number(source.version || 0),
    assets: Object.freeze(list(source.assets).map(raw => {
      const asset = record(raw);
      return Object.freeze({
        id: text(asset.id),
        assetKey: text(asset.assetKey),
        phase: text(asset.phase),
        stage: text(asset.stage),
        role: text(asset.role || 'other'),
        displayName: text(asset.displayName),
        sourceChecksum: text(asset.sourceChecksum),
        selectionState: text(asset.selectionState),
        metadata: Object.freeze({ ...record(asset.metadata) }),
        storedAssetId: text(asset.storedAssetId),
        contentReference: text(asset.contentReference),
        thumbnailReference: text(asset.thumbnailReference),
        factoryStageKey: text(asset.factoryStageKey),
        version: Number(asset.version || 0),
      });
    }).filter(asset => asset.id && ['input', 'output'].includes(asset.phase))),
  });
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function bundleMatchesBinding(value, { workspaceId = '', productKey = '' } = {}) {
  const key = text(record(value).bundleKey);
  const workspace = text(workspaceId);
  const product = text(productKey);
  if (workspace) return key === workspace || key === `kuasangse:${workspace}`;
  return Boolean(product) && (key === product || key === `kuasangse:${product}`);
}

export function workBundleIdentityChanged(previousValue, nextValue, { requestedId = '' } = {}) {
  if (text(requestedId)) return false;
  const previous = record(previousValue);
  const next = record(nextValue);
  return text(previous.workspaceId) !== text(next.workspaceId)
    || text(previous.productKey) !== text(next.productKey);
}

export function resolveWorkBundleTarget(summaries, {
  requestedId = '',
  workspaceId = '',
  productKey = '',
} = {}) {
  const workspace = text(workspaceId);
  const product = text(productKey);
  const items = list(summaries);
  const requested = text(requestedId);
  if (requested) {
    const exact = items.find(item => text(record(item).id) === requested);
    if (
      !exact
      || ((workspace || product) && !bundleMatchesBinding(exact, {
        workspaceId: workspace,
        productKey: product,
      }))
    ) {
      throw codedError('decision_target_required');
    }
    return exact;
  }
  if (!workspace && !product) throw codedError('work_bundle_target_required');
  const matches = items.filter(item => bundleMatchesBinding(item, {
    workspaceId: workspace,
    productKey: product,
  }));
  if (matches.length !== 1) throw codedError('work_bundle_target_required');
  return matches[0];
}

export async function fetchBoundWorkBundle({
  apiRequest,
  workspaceId = '',
  productKey,
  requestedId = '',
  isCurrent = () => true,
}) {
  const explicitBundle = Boolean(text(requestedId));
  const summaries = [];
  const seenCursors = new Set();
  let cursor = '';
  do {
    const listing = await apiRequest(
      `/api/pdp/work-bundles?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (!isCurrent()) throw codedError('stale_work_bundle_response');
    summaries.push(...list(listing.items));
    cursor = text(listing.nextCursor);
    if (cursor && seenCursors.has(cursor)) throw codedError('work_bundle_cursor_repeated');
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  const summary = resolveWorkBundleTarget(summaries, {
    requestedId,
    workspaceId: explicitBundle ? '' : workspaceId,
    productKey: explicitBundle ? '' : productKey,
  });
  const bundleId = text(record(summary).id);
  const detail = await apiRequest(`/api/pdp/work-bundles/${encodeURIComponent(bundleId)}`);
  if (!isCurrent()) throw codedError('stale_work_bundle_response');
  const hasLiveBinding = !explicitBundle && Boolean(text(workspaceId) || text(productKey));
  if (
    hasLiveBinding
      ? !bundleMatchesBinding(detail, { workspaceId, productKey })
      : text(record(detail).id) !== bundleId
  ) {
    throw codedError('decision_target_required');
  }
  return normalizeWorkBundle(detail);
}

export function buildCompositeSelectionPayload({
  projection,
  command,
  workBundle,
  jobId,
  decisionMode,
  policySnapshot,
  judgementOptions,
}) {
  return {
    ...record(command),
    bundleId: text(record(workBundle).id),
    jobId: text(jobId),
    expectedProjectionCursor: text(record(projection).cursor),
    decisionMode: text(decisionMode),
    policySnapshot: record(policySnapshot),
    judgementOptions: record(judgementOptions),
  };
}

export function createAutomaticSelectionScheduler({ submit }) {
  const completed = new Set();
  const inFlight = new Set();
  return async function schedule({
    projection,
    workBundle,
    policySnapshot = {},
    localJob = null,
    isAutomatic = () => false,
  }) {
    const current = normalizeFactoryProjection(projection);
    const bundle = normalizeWorkBundle(workBundle);
    const jobId = text(current.registration.jobId);
    if (
      current.connected !== true
      || record(policySnapshot).locked !== true
      || (jobId.startsWith('factory-job-') && (
        text(record(localJob).jobId) !== jobId
        || text(record(localJob).status) !== 'waiting_manual'
      ))
      || (!text(current.registration.jobId).startsWith('factory-job-') && !bundle.id)
      || (!text(current.registration.jobId).startsWith('factory-job-') && !bundleMatchesBinding(bundle, current.session))
      || !text(current.registration.jobId)
    ) return null;
    const stage = current.stages.find(item => (
      !item.selectedId
      && item.candidates.length > 0
      && isAutomatic(item) === true
      && (text(current.registration.jobId).startsWith('factory-job-') || item.candidates.every(candidate => (
        resolveCandidateAsset(candidate, bundle.assets, item.key).status === 'matched'
      )))
    ));
    if (!stage) return null;
    const key = [
      current.session.productId,
      stage.key,
      current.session.revision,
    ].map(text).join(':');
    if (completed.has(key) || inFlight.has(key)) return null;
    inFlight.add(key);
    try {
      const result = await submit(stage, 'auto');
      if (result) completed.add(key);
      return result;
    } finally {
      inFlight.delete(key);
    }
  };
}

export function workBundleAssetPage(value, phase, page = 0, factoryStageKey = '') {
  const bundle = normalizeWorkBundle(value);
  const stageKey = text(factoryStageKey);
  const items = bundle.assets.filter(asset => (
    asset.phase === phase
    && (!stageKey || text(asset.factoryStageKey) === stageKey)
  ));
  const pageCount = Math.max(1, Math.ceil(items.length / CANDIDATE_PAGE_SIZE));
  const current = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  return Object.freeze({
    total: items.length,
    page: current,
    pageCount,
    items: Object.freeze(items.slice(
      current * CANDIDATE_PAGE_SIZE,
      (current + 1) * CANDIDATE_PAGE_SIZE,
    )),
  });
}

export function resolveCandidateThumbnail(candidate = {}, assetUrl = value => value) {
  const source = text(candidate.thumbnailUrl);
  if (!source) return { kind: 'placeholder', url: '' };
  try {
    const resolved = text(assetUrl(source));
    const parsed = new URL(resolved, 'http://127.0.0.1/');
    if (!['http:', 'https:'].includes(parsed.protocol)) return { kind: 'placeholder', url: '' };
    return { kind: 'image', url: resolved };
  } catch {
    return { kind: 'placeholder', url: '' };
  }
}

export function operatorQueueState(jobValue) {
  const status = text(record(jobValue).status);
  if (status === 'waiting_manual') return Object.freeze({ key: 'selection', label: '선택 필요' });
  if (status === 'blocked') return Object.freeze({ key: 'blocked', label: '차단' });
  if (status === 'completed') return Object.freeze({ key: 'completed', label: '완료' });
  return Object.freeze({ key: 'running', label: '진행 중' });
}

export function queueFilterMatches(jobValue, filter = 'all') {
  return filter === 'all' || operatorQueueState(jobValue).key === filter;
}

export function reconcileOperatorQueueRefresh(previousJobs, responseValue, errorValue = '') {
  const previous = list(previousJobs).filter(job => (
    job && typeof job === 'object' && !Array.isArray(job) && typeof job.jobId === 'string' && job.jobId.trim()
  ));
  const error = text(errorValue);
  if (error) return Object.freeze({ jobs: previous, error });
  const response = record(responseValue);
  const incoming = list(response.jobs);
  const malformed = !Array.isArray(response.jobs) || incoming.some(job => (
    !job || typeof job !== 'object' || Array.isArray(job) || typeof job.jobId !== 'string' || !job.jobId.trim()
  ));
  if (previous.length && (!incoming.length || malformed)) {
    return Object.freeze({
      jobs: previous,
      error: malformed ? 'factory_queue_malformed_response' : 'factory_queue_empty_transient',
    });
  }
  return Object.freeze({ jobs: incoming, error: malformed ? 'factory_queue_malformed_response' : '' });
}

function eventIdNumber(value) {
  const normalized = text(value);
  return /^\d+$/.test(normalized) ? BigInt(normalized) : null;
}

export function factoryEventsUrl(factoryEventCursor = '') {
  const cursor = text(factoryEventCursor);
  return `/api/factory/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
}

const FACTORY_DISCONNECT_DETAILS = Object.freeze({
  factory_heartbeat_timeout: '공장 heartbeat 응답 시간 초과로 연결이 끊겼습니다.',
  factory_session_missing: '조립공장 session이 없습니다.',
  factory_session_disconnected: '조립공장 session 연결이 종료되었습니다.',
  'factory.session.disconnected': '조립공장 session 연결이 종료되었습니다.',
});

export function projectFactoryConnectivity(projectionValue, {
  transport = 'connecting',
  lastEventAt = '',
  apiError = '',
  hasDurableQueue = false,
} = {}) {
  const projection = record(projectionValue);
  const reason = text(projection.reason || projection.blockReason);
  const apiErrorText = text(apiError);
  const streamState = ['live', 'reconnecting', 'connecting'].includes(transport) ? transport : 'connecting';
  const transportLabel = streamState === 'live'
    ? '상태 스트림 연결됨'
    : streamState === 'reconnecting'
      ? '상태 스트림 재연결 중'
      : '상태 스트림 연결 중';
  if (apiErrorText && (projection.connected === true || hasDurableQueue)) {
    const retainedQueue = hasDurableQueue && apiErrorText.startsWith('factory_queue_');
    const queueRetained = projection.connected !== true && hasDurableQueue;
    return Object.freeze({
      state: 'degraded',
      factoryLabel: retainedQueue ? '작업 큐 갱신 지연' : queueRetained ? '생산관제 상태 조회 실패' : '생산관제 상태 갱신 지연',
      transportLabel,
      detail: retainedQueue
        ? `작업 큐 조회 실패 · 마지막 작업 큐 유지: ${apiErrorText}`
        : queueRetained
        ? `상태 조회 실패 · 마지막 작업 큐 유지: ${apiErrorText}`
        : `마지막 정상 상태 유지 · 상태 갱신 실패: ${apiErrorText}`,
      observedAt: text(lastEventAt || projection.capturedAt),
      tone: 'warn',
    });
  }
  if (apiErrorText) {
    return Object.freeze({
      state: 'backend-error',
      factoryLabel: '생산관제 서버 오류',
      transportLabel,
      detail: `상태 조회 실패 · ${apiErrorText}`,
      observedAt: text(lastEventAt || projection.capturedAt),
      tone: 'error',
    });
  }
  if (projection.connected === true) {
    // 연결됐다고 다 괜찮은 것이 아니다. 워커가 저장하지 못하고 있으면 화면에서 넣은 값이
    // 하나도 붙지 않는데, 지금까지 그 사실이 워커 탭 콘솔에만 남아 조작자는 값을 잘못
    // 넣은 줄로 알았다 — 실측 2026-08-29. 연결됨보다 이것을 먼저 말한다.
    const storageWarning = text(projection.storage?.warning);
    if (storageWarning) {
      return Object.freeze({
        state: 'storage-blocked',
        factoryLabel: '조립공장 저장 실패',
        transportLabel,
        detail: `${storageWarning} 이 상태에서는 화면에서 넣은 값이 저장되지 않습니다.`,
        observedAt: text(lastEventAt || projection.capturedAt),
        tone: 'error',
      });
    }
    return Object.freeze({
      state: 'connected',
      factoryLabel: '조립공장 연결됨',
      transportLabel,
      detail: '조립공장 session 연결이 확인되었습니다.',
      observedAt: text(lastEventAt || projection.capturedAt),
      tone: 'ok',
    });
  }
  return Object.freeze({
    state: 'disconnected',
    factoryLabel: '조립공장 연결 끊김',
    transportLabel,
    detail: FACTORY_DISCONNECT_DETAILS[reason] || (reason ? `조립공장 연결이 차단되었습니다. 사유: ${reason}` : '조립공장 session 상태를 확인할 수 없습니다.'),
    observedAt: text(lastEventAt || projection.capturedAt),
    tone: 'error',
  });
}

export function projectFactoryQueueRenderModel(projectionValue, jobsValue, {
  transport = 'connecting',
  lastEventAt = '',
  apiError = '',
} = {}) {
  const projection = normalizeFactoryProjection(projectionValue);
  const queue = Object.freeze(list(jobsValue)
    .filter(job => job && typeof job === 'object' && !Array.isArray(job) && typeof job.jobId === 'string' && job.jobId.trim())
    .map(job => Object.freeze({ ...job })));
  const projectionJobId = text(projection.registration.jobId);
  const resumableJobs = queue.filter(job => ['waiting_manual', 'running', 'blocked'].includes(text(job.status)));
  const activeJob = queue.find(job => text(job.jobId) === projectionJobId)
    || (resumableJobs.length === 1 ? resumableJobs[0] : null)
    || (queue.length === 1 ? queue[0] : null)
    || null;
  const connectivity = projectFactoryConnectivity(projection, {
    transport,
    lastEventAt,
    apiError,
    hasDurableQueue: queue.length > 0,
  });
  const detail = activeJob && Object.freeze({
    root: 'operator-queue-selection',
    job: activeJob,
    status: text(activeJob.status),
    active: text(activeJob.jobId) === projectionJobId,
    copy: connectivity.state === 'degraded' ? '상태 조회 실패 · 저장된 작업 큐 정보를 표시합니다.' : '',
  });
  return Object.freeze({ queue, activeJob, connectivity, detail });
}

export function currentFactoryProductLabel(stateValue, activeJobValue) {
  const state = record(stateValue);
  const session = record(state.session || state);
  const registration = record(state.registration);
  const activeJob = record(activeJobValue);
  return firstText(state.productKey, session.productKey, registration.productKey, activeJob.productKey, activeJob.productName);
}

export function applyFactorySseMessage(currentValue, factoryEventCursor, event) {
  const current = normalizeFactoryProjection(currentValue);
  const currentEventId = eventIdNumber(factoryEventCursor);
  const nextEventId = eventIdNumber(event?.lastEventId);
  if (nextEventId === null) throw new FactorySyncConflict('factory_event_id_invalid');
  if (currentEventId !== null && nextEventId <= currentEventId) {
    throw new FactorySyncConflict('stale_factory_event_id');
  }
  const payload = JSON.parse(text(event?.data));
  let next = current;
  if (payload.type === 'factory.session.disconnected') {
    next = normalizeFactoryProjection({
      ...current,
      connected: false,
      status: 'blocked',
      reason: text(payload.reason || payload.blockReason || 'factory_session_disconnected'),
      capturedAt: text(payload.occurredAt || current.capturedAt),
      progress: { ...current.progress, status: 'blocked' },
    });
  } else if (payload.projection) {
    const candidate = normalizeFactoryProjection(payload.projection);
    if (current.connected && candidate.sequence < current.sequence) {
      throw new FactorySyncConflict('stale_event_sequence');
    }
    if (current.connected && candidate.sequence === current.sequence) {
      const identityKeys = [
        'workspaceId',
        'productId',
        'productKey',
        'runId',
        'inputFingerprint',
        'revision',
      ];
      if (identityKeys.some(key => text(candidate.session[key]) !== text(current.session[key]))) {
        throw new FactorySyncConflict('stale_event_sequence');
      }
    } else {
      next = reconcileFactoryProjectionForSameWork(current, {
        ...candidate,
        receipts: payload.receipt
          ? [...current.receipts, payload.receipt]
          : candidate.receipts,
      });
    }
  } else if (payload.stage) {
    next = applyFactoryDelta(current, {
      ...payload,
      schema: FACTORY_CONTROL_EVENT_VERSION,
      eventId: text(event.lastEventId),
    });
  } else if (![
    'factory.worker.failed',
    'factory.product.queued',
    'factory.product.updated',
    'factory.product.checkpoint.rebound',
  ].includes(payload.type)) {
    throw new FactorySyncConflict('factory_event_payload_invalid');
  }
  return Object.freeze({
    projection: next,
    factoryEventCursor: text(event.lastEventId),
    job: payload.job && typeof payload.job === 'object' && !Array.isArray(payload.job)
      ? Object.freeze({ ...payload.job })
      : null,
  });
}

function element(tag, className = '', value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

export function renderWorkfileJobTabs(root, snapshotValue, onActivate = () => {}) {
  const snapshot = record(snapshotValue);
  const tabs = list(snapshot.tabs);
  root.replaceChildren();
  root.setAttribute('role', 'tablist');
  if (!tabs.length) {
    root.append(element('p', 'status-message', '작업 큐 또는 .kuasangse 파일을 열면 작업 탭이 표시됩니다.'));
    return;
  }
  const buttons = tabs.map((tabValue, index) => {
    const tab = record(tabValue);
    const button = element('button', 'workfile-job-tab');
    const active = tab.active === true;
    button.type = 'button';
    button.id = `workfile-job-tab-${index + 1}`;
    button.dataset.tabKey = text(tab.key);
    button.dataset.linkState = text(tab.linkState);
    button.dataset.status = text(tab.status);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('aria-controls', 'workfile-job-tabpanel');
    button.tabIndex = active ? 0 : -1;
    button.title = text(tab.workfileName || tab.productName);
    const identity = element('span', 'workfile-job-tab-copy');
    identity.append(
      element('strong', '', text(tab.productName || tab.workfileName || '제품 이름 없음')),
      element('span', 'workfile-job-tab-file', text(tab.workfileName || '작업파일 연결 필요')),
    );
    const meta = element('span', 'workfile-job-tab-meta');
    meta.append(
      element('span', 'factory-pill', STAGE_LABELS[text(tab.stageKey)] || text(tab.stageKey) || '공정 대기'),
      element('span', 'factory-pill', statusLabel(tab.mode)),
      element('span', 'factory-pill', statusLabel(tab.status)),
      element('span', 'factory-pill', `누락 ${Number(tab.missingCount || 0)}`),
      element('span', 'factory-pill', `선택 ${Number(tab.selectedCount || 0)} · 남음 ${Number(tab.remainingCount || 0)}`),
      element('span', 'factory-pill workfile-link-pill', ({
        linked: '연결됨',
        rebind_required: '승인 파일 연결 필요',
        target_rebind_required: '선택 작업 연결 승인 필요',
        ambiguous: '연결 모호',
        stale: '현재 작업과 불일치',
        unlinked: '연결 필요',
      })[text(tab.linkState)] || '연결 확인'),
    );
    button.append(identity, meta);
    const focusRenderedTab = key => queueMicrotask(() => {
      [...root.children].find(child => text(child.dataset?.tabKey) === key)?.focus();
    });
    const activate = () => {
      const key = text(tab.key);
      onActivate(key);
      focusRenderedTab(key);
    };
    button.addEventListener('click', activate);
    button.addEventListener('keydown', event => {
      const key = String(event.key ?? '');
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        activate();
        return;
      }
      const targetIndex = key === 'Home'
        ? 0
        : key === 'End'
          ? buttons.length - 1
          : key === 'ArrowLeft' || key === 'ArrowUp'
            ? (index - 1 + buttons.length) % buttons.length
            : key === 'ArrowRight' || key === 'ArrowDown'
              ? (index + 1) % buttons.length
              : -1;
      if (targetIndex < 0) return;
      event.preventDefault();
      const targetKey = text(tabs[targetIndex].key);
      buttons[targetIndex].focus();
      onActivate(targetKey);
      focusRenderedTab(targetKey);
    });
    return button;
  });
  root.append(...buttons);
}

export function createWorkBundleAssetCard(asset, assetUrl = value => value, display = {}) {
  const displayTitle = text(display.title) || asset.displayName || asset.assetKey;
  const displayDetail = text(display.detail);
  const card = element('article', 'a-cut-candidate work-bundle-asset');
  card.dataset.assetId = asset.id;
  card.dataset.assetKey = asset.assetKey;
  card.dataset.role = asset.role;
  card.dataset.factoryStageKey = asset.factoryStageKey;
  card.dataset.selectionState = asset.selectionState;
  const frame = element('button', 'a-cut-thumb work-bundle-image-trigger');
  frame.type = 'button';
  frame.dataset.assetId = asset.id;
  const placeholder = element('p', 'factory-empty-state', '이미지 주소 없음');
  let imageUrl = '';
  try {
    imageUrl = asset.thumbnailReference ? text(assetUrl(asset.thumbnailReference)) : '';
  } catch {
    imageUrl = '';
  }
  if (imageUrl) {
    const image = element('img');
    image.src = imageUrl;
    image.alt = displayTitle || `${asset.role} 자산`;
    image.loading = 'eager';
    image.decoding = 'async';
    image.width = 160;
    image.height = 120;
    frame.dataset.action = 'view-work-bundle-image';
    frame.setAttribute('aria-label', `${image.alt} 크게 보기`);
    let retriedAfterError = false;
    image.addEventListener('error', () => {
      if (!retriedAfterError && /^https?:\/\//iu.test(imageUrl)) {
        // 브라우저 HTTP 캐시에 남은 불량 사본(예: 허브 재기동 중 받은 응답)을 한 번 우회한다.
        retriedAfterError = true;
        image.src = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`;
        return;
      }
      placeholder.textContent = '이미지 불러오기 실패';
      placeholder.dataset.broken = 'true';
      image.replaceWith(placeholder);
    });
    frame.append(image);
  } else {
    placeholder.dataset.broken = 'true';
    frame.append(placeholder);
  }
  const meta = element('div', 'a-cut-candidate-meta');
  const selectionLabel = ({ selected: '선택됨', confirmed: '확정됨', candidate: '후보' })[asset.selectionState] || '작업 자료';
  const roleLabel = WORK_BUNDLE_ROLE_LABELS[asset.role] || '작업 자료';
  const stageLabel = STAGE_LABELS[asset.factoryStageKey] || STAGE_LABELS[asset.stage] || roleLabel;
  const selectionEvidence = text(record(asset.metadata).selectionEvidence);
  meta.append(
    element('strong', 'asset-card-title', displayTitle),
    element('span', 'factory-pill', selectionLabel),
    element('small', 'status-message asset-card-detail', displayDetail || `${roleLabel} · ${stageLabel}${selectionEvidence ? ' · 최종 선택 연결' : ''}`),
  );
  if (displayDetail && asset.displayName && displayDetail !== asset.displayName) {
    meta.append(element('small', 'status-message asset-archive-name', asset.displayName));
  }
  card.append(frame, meta);
  return card;
}

function labelledValue(label, value, key = '') {
  const item = element('div', 'factory-sync-field');
  if (key) item.dataset.field = key;
  item.append(element('dt', '', label), element('dd', '', text(value) || '—'));
  return item;
}

function statusLabel(value) {
  return STATUS_LABELS[text(value).toLowerCase()] || text(value) || '상태 없음';
}

function policySourceLabel(value) {
  return ({
    stage: '현재 단계 설정',
    product: '현재 제품 설정',
    batch: '생산 묶음 설정',
    batch_preset: '자동화 방식',
    auto_default: '조립공장 기본값',
    policy_snapshot: '실행 시작 때 확정한 설정',
  })[text(value)] || '현재 설정';
}

function registrationBlockerLabel(value) {
  const key = text(value);
  const fixed = {
    product_id: 'Cafe24 등록 방식을 선택해 주세요.',
    product_key: '제품명을 확인해 주세요.',
    run_id: '조립공장 작업 회차를 확인해 주세요.',
    input_fingerprint: '입력 제품 이미지를 확인해 주세요.',
    category_id: 'Cafe24 상품분류를 확인해 주세요.',
    html_digest: '최종 상세페이지를 완성해 주세요.',
    image_digests: '등록할 이미지를 확정해 주세요.',
  };
  if (fixed[key]) return fixed[key];
  const stageMatch = /^(.+)_a_cut$/.exec(key);
  if (stageMatch) return `${STAGE_LABELS[stageMatch[1]] || '현재 단계'} 선택 결과를 확정해 주세요.`;
  return key.replaceAll('_', ' ') || '등록 준비 상태를 확인해 주세요.';
}

function elapsedLabel(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function visibleFactoryMessage(value, stageKey = '') {
  const message = text(value);
  if (!message) return '';
  if (/selection required/i.test(message)) return `${STAGE_LABELS[text(stageKey)] || '현재 단계'} A컷 선택 필요`;
  if (/factory worker failed/i.test(message)) return '조립공장 실행 실패';
  // 서버 코드를 그대로 흘려보내면 화면에 factory_product_checkpoint_restore_mismatch 같은
  // 글자가 뜬다. 옮겨 둔 말이 있으면 그것을 쓰고, 코드는 괄호로 남겨 찾아볼 수 있게 한다.
  const copy = OPERATOR_MESSAGES[message];
  if (copy) return `${copy} (${message})`;
  return message;
}

function selectedStage(projection, stageKey) {
  return projection.stages.find(stage => stage.key === stageKey) || projection.stages[0] || null;
}

function unresolvedStage(projection, currentKey = '') {
  const stages = projection.stages;
  const start = Math.max(0, stages.findIndex(stage => stage.key === currentKey) + 1);
  return [...stages.slice(start), ...stages.slice(0, start)]
    .find(stage => !stage.selectedId && stage.candidates.length > 0) || null;
}

export function factoryStageUiState(stageValue, connected) {
  const stage = record(stageValue);
  const candidateCount = list(stage.candidates).length;
  if (!connected) return { state: 'disconnected', candidateCount };
  if (text(stage.selectedId)) return { state: 'selected', candidateCount };
  if (candidateCount > 0) return { state: 'unresolved', candidateCount };
  return { state: 'empty', candidateCount };
}

function approvalBinding(preview) {
  const source = record(preview);
  const payload = record(source.payload);
  return Object.fromEntries([
    'payloadDigest',
    'productId',
    'productKey',
    'expectedWorkfileRevision',
    'expectedRunId',
    'expectedInputFingerprint',
    'idempotencyKey',
  ].map(key => [key, key in source ? source[key] : payload[key]]));
}

export function buildCafe24StagingPayload(projectionValue) {
  const projection = normalizeFactoryProjection(projectionValue);
  const registration = record(projection.registration);
  const session = projection.session;
  const blockers = list(registration.blockers).map(text).filter(Boolean);
  if (!projection.connected || blockers.length) {
    throw new FactorySyncConflict(!projection.connected ? 'factory_session_missing' : 'cafe24_preflight_blocked');
  }
  const imageDigests = list(registration.imageDigests).map(text).filter(Boolean);
  const payload = {
    batchId: text(registration.batchId || session.workspaceId || session.runId),
    productId: text(registration.productId || session.productId),
    productKey: text(registration.productKey || session.productKey),
    categoryId: text(registration.categoryId),
    htmlDigest: text(registration.htmlDigest),
    imageDigests,
    expectedWorkfileRevision: Number.isInteger(registration.expectedWorkfileRevision)
      ? registration.expectedWorkfileRevision
      : session.revision,
    expectedRunId: session.runId,
    expectedInputFingerprint: session.inputFingerprint,
    idempotencyKey: text(registration.idempotencyKey),
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  };
  if (
    !payload.batchId
    || !payload.productId
    || !payload.productKey
    || !payload.categoryId
    || !payload.htmlDigest
    || !payload.imageDigests.length
    || !payload.expectedRunId
    || !payload.expectedInputFingerprint
  ) {
    throw new FactorySyncConflict('cafe24_preflight_blocked');
  }
  return Object.freeze(payload);
}

export async function acquireControlSession({ assetUrl = value => value, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(assetUrl('/api/session'), { credentials: 'include', cache: 'no-store' });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(session.error?.code || `HTTP_${response.status}`));
    error.status = response.status;
    error.code = String(session.error?.code || '');
    throw error;
  }
  return session;
}

export function createCsrfRetryingApiRequest({ apiRequest, assetUrl = value => value, fetchImpl = globalThis.fetch }) {
  return async (path, options = {}) => {
    try {
      return await apiRequest(path, options);
    } catch (error) {
      if (text(options.method).toUpperCase() === 'GET' || error?.status !== 428 || error?.code !== 'csrf_required') throw error;
      const session = await acquireControlSession({ assetUrl, fetchImpl });
      const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
        'X-Control-Tower-Session': text(session.sessionId),
        'X-Control-Tower-CSRF': text(session.csrfToken),
      };
      const response = await fetchImpl(assetUrl(path), { ...options, cache: 'no-store', headers, credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryError = new Error(String(body.error?.code || `HTTP_${response.status}`));
        retryError.status = response.status;
        retryError.code = String(body.error?.code || '');
        throw retryError;
      }
      return body;
    }
  };
}

export function coalesceRefreshState(refreshState) {
  let inFlight = null;
  return () => {
    if (!inFlight) inFlight = Promise.resolve(refreshState()).finally(() => { inFlight = null; });
    return inFlight;
  };
}

export function mountProductionWorkbench({
  apiRequest: baseApiRequest,
  assetUrl = value => value,
  setStatus = () => {},
  EventSourceImpl = globalThis.EventSource,
  automation: automationState = {},
} = {}) {
  if (!globalThis.controlTowerMenu) {
    globalThis.controlTowerMenu = bindMenuShell({
      onChange: key => document.getElementById('app')?.setAttribute('data-active-menu', key),
    });
  }
  const roots = {
    sync: document.getElementById('factory-sync-bar'),
    syncSummary: document.getElementById('sync-disclosure-summary-text'),
    product: document.getElementById('factory-product-progress'),
    ledger: document.getElementById('workfile-report-ledger'),
    map: document.getElementById('io-progress-map'),
    candidates: document.getElementById('a-cut-contact-sheet'),
    inspector: document.getElementById('artifact-inspector'),
    registration: document.getElementById('factory-registration-panel'),
    queue: document.getElementById('product-list'),
    queueTotal: document.getElementById('operator-queue-total'),
    queueSelection: document.getElementById('operator-queue-selection'),
    queueFilters: document.querySelectorAll('[data-queue-filter]'),
    policy: document.getElementById('automation-policy-matrix'),
    policySummary: document.getElementById('automation-policy-summary'),
    overview: document.getElementById('overview-stage-summary'),
    stageSubnav: document.getElementById('stage-subnav'),
    resultWorkspace: document.getElementById('production-result-workspace'),
    competitors: document.getElementById('competitor-source-summary'),
    audit: document.getElementById('audit-sync-summary'),
    bundleInputs: document.getElementById('work-bundle-input-assets'),
    bundleOutputs: document.getElementById('work-bundle-output-assets'),
    workfileTabs: document.getElementById('workfile-job-tabs'),
    workfileTabPanel: document.getElementById('workfile-job-tabpanel'),
    imageDialog: document.getElementById('work-bundle-image-dialog'),
    imageDialogImage: document.getElementById('work-bundle-image-dialog-image'),
    imageDialogTitle: document.getElementById('work-bundle-image-dialog-title'),
    imageDialogMeta: document.getElementById('work-bundle-image-dialog-meta'),
  };
  const requiredRoots = ['sync', 'product', 'ledger', 'map', 'candidates', 'inspector', 'registration', 'queue', 'policy', 'policySummary', 'bundleInputs', 'bundleOutputs', 'workfileTabs', 'workfileTabPanel'];
  if (typeof baseApiRequest !== 'function' || requiredRoots.some(key => !roots[key])) return () => {};
  const apiRequest = createCsrfRetryingApiRequest({ apiRequest: baseApiRequest, assetUrl });
  const surfaceHomes = new Map();

  function restoreWorkbenchSurfaces() {
    document.dispatchEvent(new CustomEvent('control-tower:production-board-restore'));
    for (const [surface, marker] of surfaceHomes) {
      if (marker.isConnected && surface.parentNode !== marker.parentNode) marker.replaceWith(surface);
      surfaceHomes.delete(surface);
    }
  }

  function dockWorkbenchSurface(surface, target) {
    if (!surface || !target) return;
    if (!surfaceHomes.has(surface)) {
      const marker = document.createComment(`workbench-home:${surface.id}`);
      surface.before(marker);
      surfaceHomes.set(surface, marker);
    }
    target.append(surface);
  }

  const activeMenuObserver = new MutationObserver(() => {
    if (document.getElementById('app')?.dataset.activeMenu !== 'overview') restoreWorkbenchSurfaces();
  });
  activeMenuObserver.observe(document.getElementById('app'), { attributes: true, attributeFilter: ['data-active-menu'] });
  roots.imageDialog?.addEventListener('click', event => {
    if (event.target === roots.imageDialog) closeWorkBundleImagePreview();
  });
  roots.imageDialog?.addEventListener('close', closeWorkBundleImagePreview);

  let projection = normalizeFactoryProjection(disconnectedFactoryProjection());
  let selectedStageKey = '';
  let inspectedCandidateId = '';
  let candidatePage = 0;
  const savingByTarget = new Map();
  let syncTransport = 'connecting';
  let lastEventAt = '';
  let factoryEventCursor = '';
  let factoryApiError = '';
  let eventSource = null;
  let fallbackTimer = 0;
  let stopped = false;
  let registrationMessage = '';
  let registrationRenderKey = '';
  let lastAutomationReceipt = null;
  let workBundle = normalizeWorkBundle({});
  let workBundleStatus = 'loading';
  let workBundleError = '';
  let workBundleHistory = null;
  const initialHistoryJobId = factoryHistoryJobFromLocation(window.location.search);
  let archivedJobId = initialHistoryJobId;
  let workBundleInputPage = 0;
  let workBundleOutputPage = 0;
  let workBundleOutputStageKey = '';
  let workBundleGeneration = 0;
  let productJobs = [];
  let recentlyCreatedJobIds = new Set();
  let queueFilter = 'all';
  let operatorStepKey = '';
  let operatorStepJobId = '';
  const workfileTabs = createWorkfileJobTabRegistry();
  const workfileInput = document.getElementById('workfile-input');
  let pendingWorkfileTargetJobId = '';
  let queueApiError = '';
  const pendingResumeByStage = new Map();
  const resumeInFlight = new Set();
  const workfileForkInFlight = new Set();
  const heldDecisions = new Set();
  let approval = {
    preview: null,
    token: '',
    status: 'missing',
    receipt: null,
  };
  let registrationTargetConfirmed = false;
  const fixtureCount = Math.max(0, Number.parseInt(new URLSearchParams(window.location.search).get('fixtureCount') || '0', 10) || 0);
  const fixtureMode = fixtureCount > 0;
  const requestedWorkBundleId = text(new URLSearchParams(window.location.search).get('bundleId'));

  function rememberActiveTabView() {
    workfileTabs.rememberView({ selectedStageKey, inspectedCandidateId });
  }

  function viewedProjection() {
    const active = workfileTabs.active();
    return active?.key ? workfileTabs.projectionFor(active.key) || projection : projection;
  }

  function viewedJob() {
    const active = workfileTabs.active();
    return active?.jobId ? workfileTabs.jobFor(active.key) : null;
  }

  function viewMatchesLiveProjection() {
    const active = workfileTabs.active();
    return Boolean(active?.jobId && active.jobId === text(projection.registration.jobId));
  }

  function activateWorkfileTab(key) {
    rememberActiveTabView();
    if (!workfileTabs.activate(key)) return;
    const active = workfileTabs.active();
    const current = viewedProjection();
    const stage = selectedStage(current, active?.selectedStageKey || active?.stageKey);
    selectedStageKey = stage?.key || active?.selectedStageKey || '';
    inspectedCandidateId = active?.inspectedCandidateId || stage?.selectedId || stage?.candidates[0]?.id || '';
    candidatePage = 0;
    render();
  }

  function savingKey(stageKey, productId = projection.session.productId) {
    return `${text(productId)}:${text(stageKey)}`;
  }

  function stageSaving(stageKey) {
    return savingByTarget.get(savingKey(stageKey)) || null;
  }

  function automaticDecisionHeld(job, stageKey) {
    const mode = text(record(record(record(job).policy).resolved)[STAGE_DECISIONS[stageKey]]) || text(job?.mode);
    return mode === 'auto' && (
      job.decisionStatus === 'manual_required'
      || heldDecisions.has(STAGE_DECISIONS[stageKey])
    );
  }

  function policyPreset() {
    return text(document.getElementById('batch-policy')?.value || 'full_auto');
  }

  function effectiveDecision(decisionId) {
    const locked = record(automationState.snapshot);
    const lockedModes = record(locked.resolved);
    const effectiveSources = record(locked.effectiveSources);
    if (locked.locked === true && lockedModes[decisionId]) {
      return {
        mode: lockedModes[decisionId],
        source: text(effectiveSources[decisionId] || 'policy_snapshot'),
      };
    }
    const layers = [
      ['stage', record(automationState.stageOverride)],
      ['product', record(automationState.productOverride)],
      ['batch', record(automationState.batchOverride)],
    ];
    for (const [source, values] of layers) {
      if (values[decisionId] === 'auto' || values[decisionId] === 'manual') {
        return { mode: values[decisionId], source };
      }
    }
    const preset = record(record(automationState.registry).presets)[policyPreset()];
    if (record(preset)[decisionId]) {
      return { mode: record(preset)[decisionId], source: 'batch_preset' };
    }
    return { mode: 'auto', source: 'auto_default' };
  }

  function setOverride(level, decisionId, mode) {
    const key = `${level}Override`;
    const next = { ...record(automationState[key]) };
    if (mode) next[decisionId] = mode;
    else delete next[decisionId];
    automationState[key] = next;
    automationState.draftDirty = true;
    renderAutomationPolicy();
  }

  function overrideSelect(level, decisionId) {
    const select = element('select');
    select.dataset.policyLevel = level;
    select.setAttribute('aria-label', `${AUTOMATION_DECISIONS[decisionId]} ${level}`);
    select.append(
      new Option('위 설정 따르기', ''),
      new Option('자동 판단', 'auto'),
      new Option('직접 선택', 'manual'),
    );
    select.value = text(record(automationState[`${level}Override`])[decisionId]);
    select.addEventListener('change', () => setOverride(level, decisionId, select.value));
    return select;
  }

  function renderAutomationPolicy() {
    const root = roots.policy;
    root.replaceChildren();
    const header = element('div', 'automation-policy-header');
    header.append(
      element('span', '', '판단 지점'),
      element('span', '', '배치'),
      element('span', '', '제품'),
      element('span', '', '단계'),
      element('span', '', '현재 유효값'),
    );
    root.append(header);
    for (const decisionId of Object.keys(AUTOMATION_DECISIONS)) {
      const effective = effectiveDecision(decisionId);
      const row = element('div', 'automation-policy-row');
      row.setAttribute('data-decision-id', decisionId);
      row.append(
        element('strong', '', AUTOMATION_DECISIONS[decisionId]),
        overrideSelect('batch', decisionId),
        overrideSelect('product', decisionId),
        overrideSelect('stage', decisionId),
        element('span', 'automation-effective', `${statusLabel(effective.mode)} · ${policySourceLabel(effective.source)}`),
      );
      root.append(row);
    }
    const snapshot = record(automationState.snapshot);
    roots.policySummary.textContent = snapshot.locked
      ? `현재 실행 설정 확정${automationState.draftDirty ? ' · 바꾼 값은 다음 실행부터 적용' : ''} · 단계 설정이 가장 먼저 적용됩니다.`
      : '실행 전 설정 확인 중 · 단계 → 제품 → 생산 묶음 순서로 적용됩니다.';
    roots.policySummary.dataset.locked = String(snapshot.locked === true);
    globalThis.controlTowerMenu?.updateBadges?.(projectMenuBadges(projection, automationState));
  }

  async function loadAutomationPolicy() {
    try {
      automationState.registry = await apiRequest('/api/automation/policy');
      automationState.snapshotRequest = productId => ({
        batchId: text(document.getElementById('batch-id')?.value),
        productId: text(productId),
        preset: policyPreset(),
        batchOverride: { ...record(automationState.batchOverride) },
        productOverride: { ...record(automationState.productOverride) },
        stageOverride: { ...record(automationState.stageOverride) },
      });
      renderAutomationPolicy();
    } catch (error) {
      roots.policy.replaceChildren(element('p', 'status-message', `정책 registry 차단 · ${error.message}`));
    }
  }

  for (const [controlId, level] of [['product-policy', 'product'], ['stage-policy', 'stage']]) {
    document.getElementById(controlId)?.addEventListener('change', event => {
      const mode = text(event.target.value);
      automationState[`${level}Override`] = Object.fromEntries(
        Object.keys(AUTOMATION_DECISIONS)
          .filter(() => mode)
          .map(decisionId => [decisionId, mode]),
      );
      automationState.draftDirty = true;
      renderAutomationPolicy();
    });
  }
  document.getElementById('batch-policy')?.addEventListener('change', () => {
    automationState.draftDirty = true;
    renderAutomationPolicy();
  });
  const renderLockedPolicy = () => {
    automationState.draftDirty = false;
    renderAutomationPolicy();
    void scheduleAutomaticSelection();
  };
  window.addEventListener('control-tower:policy-locked', renderLockedPolicy);

  function setProjection(nextValue) {
    const previousSession = projection.session;
    projection = preserveCurrentProductProjection(projection, nextValue);
    const stage = selectedStage(projection, selectedStageKey);
    selectedStageKey = stage?.key || '';
    for (const [key, pending] of savingByTarget) {
      if (pending.productId !== projection.session.productId) continue;
      const savedStage = projection.stages.find(item => item.key === pending.stageKey);
      if (savedStage?.selectedId !== pending.candidateId) continue;
      savingByTarget.delete(key);
      workfileTabs.rememberRecentSelection({
        tabKey: `job:${text(projection.registration.jobId)}`,
        stageKey: pending.stageKey,
        candidateId: pending.candidateId,
      });
      const nextStage = unresolvedStage(projection, pending.stageKey);
      if (nextStage && viewMatchesLiveProjection()) {
        selectedStageKey = nextStage.key;
        inspectedCandidateId = nextStage.candidates[0]?.id || '';
        candidatePage = 0;
      }
    }
    for (const [stageKey, pending] of pendingResumeByStage) {
      const savedStage = projection.stages.find(item => item.key === stageKey);
      if (savedStage?.selectedId !== pending.candidateId) continue;
      pendingResumeByStage.delete(stageKey);
      void resumeFactoryJob(pending.jobId);
    }
    globalThis.controlTowerMenu?.updateBadges?.(projectMenuBadges(projection, automationState));
    const identityChanged = workBundleIdentityChanged(previousSession, projection.session, {
      requestedId: requestedWorkBundleId,
    });
    if (
      archivedJobId
      && !factoryHistoryJobFromLocation(window.location.search)
      && identityChanged
      && (projection.session.workspaceId || projection.session.productKey)
    ) {
      archivedJobId = '';
      workBundleHistory = null;
      replaceFactoryHistoryRoute('');
    }
    if (identityChanged) void loadWorkBundle();
    else if (!requestedWorkBundleId && !archivedJobId) void scheduleAutomaticSelection();
    workfileTabs.syncJobs(productJobs, projection);
    rememberActiveTabView();
  }

  function connectivity() {
    return projectFactoryQueueRenderModel(projection, productJobs, {
      transport: syncTransport,
      lastEventAt,
      apiError: queueApiError || factoryApiError,
    }).connectivity;
  }

  async function rebindActiveWorkfile() {
    const active = workfileTabs.active();
    const job = active?.key ? workfileTabs.jobFor(active.key) : null;
    const workfile = active?.key ? workfileTabs.workfileFor(active.key) : null;
    if (!job || !workfile) return;
    try {
      const payload = buildWorkfileRebindPayload({ job, projection, workfile });
      setStatus('live-status', `${text(workfile.fileName)} 승인 파일 연결 요청 중`);
      const result = await apiRequest(`/api/factory/jobs/${encodeURIComponent(job.jobId)}/workfile-rebind`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (text(result.status) === 'rebound') {
        setStatus('live-status', `${text(workfile.fileName)} 연결 완료 · 저장된 checkpoint 확인 중`, 'ok');
        await Promise.allSettled([refreshState(), refreshQueue()]);
      } else {
        setStatus('live-status', `${text(workfile.fileName)} 연결 요청 접수 · 저장 완료 확인 대기`, 'warning');
        await refreshQueue();
      }
    } catch (error) {
      setStatus('live-status', `승인 파일 연결 실패 · ${error.message}`, 'error');
      if ([409, 422].includes(error.status)) await Promise.allSettled([refreshState(), refreshQueue()]);
    }
    render();
  }

  async function createJobFromActiveWorkfile() {
    const active = workfileTabs.active();
    const workfile = active?.key ? workfileTabs.workfileFor(active.key) : null;
    const sha256 = text(workfile?.sha256).toLowerCase();
    if (!active?.key || active.jobId || !workfile || workfileForkInFlight.has(sha256)) return;
    workfileForkInFlight.add(sha256);
    let forkCompleted = false;
    setStatus('live-status', '작업파일 검증 중', 'warning');
    renderWorkfileTabs();
    try {
      const payload = buildWorkfileForkPayload({ projection, workfile });
      const accepted = await apiRequest('/api/factory/jobs/from-workfile', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (text(accepted.status) !== 'hydrating') throw new Error('factory_workfile_fork_receipt_invalid');
      let durableJob = null;
      for (let attempt = 0; attempt < 80 && !durableJob && !stopped; attempt += 1) {
        const result = await apiRequest('/api/factory/jobs');
        const jobs = Array.isArray(result.jobs) ? result.jobs : [];
        durableJob = jobs.find(job => (
          text(job.sourceSha256).toLowerCase() === sha256
          && Number(job.sourceRevision) === Number(payload.expectedHydratedWorkfileRevision)
          && text(job.sourceRunId) === text(payload.expectedRunId)
        )) || null;
        if (durableJob) {
          productJobs = jobs;
          workfileTabs.syncJobs(productJobs, projection);
          workfileTabs.activate(`job:${text(durableJob.jobId)}`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!durableJob) throw new Error('factory_workfile_fork_durable_readback_timeout');
      setStatus('live-status', '새 작업 생성 완료', 'ok');
      await refreshState();
      forkCompleted = true;
    } catch (error) {
      setStatus('live-status', `새 작업 생성 실패 · ${text(error.code || error.message || error)}`, 'error');
    } finally {
      workfileForkInFlight.delete(sha256);
      render();
      if (forkCompleted) setStatus('live-status', '새 작업 생성 완료', 'ok');
    }
  }

  function renderWorkfileTabs() {
    workfileTabs.syncJobs(productJobs, projection);
    const snapshot = workfileTabs.snapshot();
    renderWorkfileJobTabs(roots.workfileTabs, snapshot, activateWorkfileTab);
    const active = workfileTabs.active();
    const panel = roots.workfileTabPanel;
    panel.replaceChildren();
    const activeIndex = snapshot.tabs.findIndex(tab => tab.key === snapshot.activeKey);
    if (activeIndex >= 0) panel.setAttribute('aria-labelledby', `workfile-job-tab-${activeIndex + 1}`);
    else panel.removeAttribute('aria-labelledby');
    if (!active) {
      panel.append(element('p', 'status-message', '작업 큐 또는 .kuasangse 파일을 열면 제품별 작업대가 표시됩니다.'));
      return;
    }
    const copy = element('div', 'workfile-job-tab-panel-copy');
    const linkLabel = ({
      linked: '현재 checkpoint와 승인 작업파일이 일치합니다.',
      rebind_required: '현재 checkpoint와 승인 작업파일의 run/revision이 달라 연결 승인이 필요합니다.',
      target_rebind_required: '선택한 작업과 파일의 제품 신원이 일치합니다. 이 작업에 연결하려면 명시적으로 승인하세요.',
      ambiguous: '여러 작업이 같은 신원을 주장합니다. 자동으로 고르지 않습니다.',
      stale: '진행 중인 작업과 파일 revision이 달라 연결할 수 없습니다.',
      unlinked: '정확히 일치하는 작업 식별값이 없어 연결이 필요합니다.',
    })[active.linkState] || '작업 연결 상태를 확인하고 있습니다.';
    copy.append(
      element('strong', '', text(active.productName || active.workfileName || '제품 이름 없음')),
      element('span', 'status-message', `${text(active.workfileName || '작업파일 다시 선택 필요')} · ${linkLabel}`),
    );
    const actions = element('div', 'workfile-job-tab-panel-actions');
    const workfile = workfileTabs.workfileFor(active.key);
    const job = workfileTabs.jobFor(active.key);
    if (!workfile?.file) {
      const reselect = element('button', 'button-secondary', '작업파일 다시 선택');
      reselect.type = 'button';
      reselect.dataset.action = 'reselect-workfile';
      reselect.addEventListener('click', () => {
        pendingWorkfileTargetJobId = text(active.jobId);
        if (workfileInput) workfileInput.value = '';
        workfileInput?.click();
      });
      actions.append(reselect);
    } else if (!job && active.linkState === 'unlinked') {
      const create = element('button', '', '이 파일로 새 작업 만들기');
      create.type = 'button';
      create.dataset.action = 'create-job-from-workfile';
      create.disabled = workfileForkInFlight.has(text(workfile.sha256).toLowerCase());
      create.addEventListener('click', () => void createJobFromActiveWorkfile());
      actions.append(create);
    } else if (['rebind_required', 'target_rebind_required'].includes(active.linkState)) {
      const rebind = element(
        'button',
        '',
        active.linkState === 'target_rebind_required'
          ? `선택한 ${text(active.productName || '작업')} 작업에 이 파일 연결 승인`
          : '승인 파일로 연결',
      );
      rebind.type = 'button';
      rebind.dataset.action = 'rebind-workfile';
      rebind.disabled = !job || active.jobId !== text(projection.registration.jobId);
      rebind.addEventListener('click', () => void rebindActiveWorkfile());
      actions.append(rebind);
    }
    if (job && ['blocked', 'waiting_manual', 'completed'].includes(text(job.status))) {
      const resume = element('button', 'button-secondary', '작업 재개');
      resume.type = 'button';
      resume.dataset.action = 'resume-factory-job';
      resume.disabled = !workfileTabs.projectionFor(active.key) || active.linkState !== 'linked';
      resume.addEventListener('click', () => void resumeFactoryJob(active.jobId));
      actions.append(resume);
    }
    const inspect = element('button', 'button-secondary', '후보 작업대 열기');
    inspect.type = 'button';
    inspect.dataset.action = 'open-active-candidates';
    inspect.disabled = !workfileTabs.projectionFor(active.key) || active.linkState !== 'linked';
    inspect.addEventListener('click', () => openFactoryStage(active.selectedStageKey || active.stageKey));
    actions.append(inspect);
    panel.append(copy, actions);
  }

  function renderSyncBar() {
    const root = roots.sync;
    const state = connectivity();
    const progress = record(projection.progress);
    const activeJob = activeProductJob();
    const productLabel = currentFactoryProductLabel(projection, activeJob) || '현재 제품 없음';
    const stageLabel = progress.stageLabel || progress.stageKey || '공정 대기';
    const jobStatus = text(activeJob?.status || progress.status || projection.status);
    const assembly = deriveAssemblyWorkbench(
      projection,
      activeJob,
      cafe24RegistrationSummary(projection.registration, projection.session, approval.receipt).registered,
    );
    const selectionCounts = projection.stages.reduce((total, stage) => ({
      candidates: total.candidates + stage.candidates.length,
      selected: total.selected + (stage.selectedId ? 1 : 0),
    }), { candidates: 0, selected: 0 });
    const backendTruth = factoryApiError ? `상태 조회 실패 · ${factoryApiError}` : '상태 응답 정상';
    const factoryTruth = projection.connected
      ? `연결됨 · ${projection.capabilityVersion || 'capability 미기록'}`
      : `연결 끊김 · ${state.detail}`;
    const productTruth = projection.session.productKey
      ? `${productLabel} · ${statusLabel(jobStatus)}`
      : '선택된 제품 없음';
    const queuedCount = productJobs.filter(job => text(job.status) === 'queued').length;
    let actionLabel = `${stageLabel} ${Number(progress.percent || 0)}%`;
    if (jobStatus === 'waiting_manual') actionLabel = 'A컷 선택 필요';
    else if (jobStatus === 'blocked') actionLabel = '작업 차단 확인 필요';
    else if (jobStatus === 'queued') actionLabel = '생산 순서 대기';
    else if (jobStatus === 'completed') actionLabel = registrationStatus() === 'staged_verified' ? 'Cafe24 검증 완료' : 'Cafe24 승인 필요';
    if (roots.syncSummary) {
      roots.syncSummary.textContent = `생산관제 ${backendTruth} · 조립공장 ${factoryTruth} · 현재 제품 ${productTruth} · 대기 ${queuedCount} · ${actionLabel}`;
    }
    root.replaceChildren();
    root.dataset.connected = String(state.state === 'connected');
    root.dataset.transport = syncTransport;
    root.dataset.connectivityTone = state.tone;
    const identity = element('dl', 'factory-sync-fields');
    identity.append(
      labelledValue('생산관제 backend', backendTruth, 'backend-truth'),
      labelledValue('조립공장 session/capability', factoryTruth, 'factory-truth'),
      labelledValue('현재 제품', productTruth, 'product-truth'),
      labelledValue('.kuasangse 작업파일', projection.session.workfileName || '작업파일 미기록', 'workfile-name'),
      labelledValue('작업파일 revision', projection.session.revision, 'revision'),
      labelledValue('마지막 저장', firstText(progress.savedAt, projection.registration.workfileSavedAt) || '저장 시각 미기록', 'last-save'),
      labelledValue('현재 조립 단계', assembly.currentStep.label, 'current-step'),
      labelledValue('선택/후보', `${selectionCounts.selected}/${selectionCounts.candidates}`, 'selection-counts'),
    );
    const actions = element('div', 'button-row factory-sync-actions');
    const refresh = element('button', '', '새로고침');
    refresh.type = 'button';
    refresh.dataset.action = 'factory-refresh';
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try {
        await apiRequest('/api/factory/refresh', { method: 'POST', body: '{}' });
        await Promise.allSettled([refreshState(), refreshQueue()]);
      } finally {
        refresh.disabled = false;
      }
    });
    const reconnect = element('button', 'button-secondary', '다시 연결');
    reconnect.type = 'button';
    reconnect.dataset.action = 'factory-reconnect';
    reconnect.addEventListener('click', () => {
      connectEvents(true);
      void Promise.allSettled([refreshState(), refreshQueue()]);
    });
    const transport = element('span', 'factory-pill');
    transport.dataset.syncTransport = syncTransport;
    transport.textContent = state.transportLabel;
    actions.append(refresh, reconnect, transport);
    root.append(identity, actions);
    if (state.tone !== 'ok') root.append(element('p', 'factory-connectivity-message', `${state.factoryLabel} · ${state.detail}`));
  }

  function renderProductProgress() {
    const root = roots.product;
    const state = connectivity();
    root.replaceChildren();
    const progress = record(projection.progress);
    const row = element('article', 'factory-product-row');
    row.dataset.status = text(progress.status || projection.status);
    row.dataset.productKey = projection.session.productKey;
    const heading = element('div', 'status-row');
    heading.append(
      element('h3', '', projection.session.productKey || '현재 factory session 없음'),
      element('span', 'factory-pill', state.state === 'connected' ? statusLabel(progress.status) : state.factoryLabel),
    );
    const details = element('dl', 'factory-sync-fields');
    details.append(
      labelledValue('현재 단계', progress.stageLabel || progress.stageKey, 'stage'),
      labelledValue('진행률', `${Number(progress.percent || 0)}%`, 'percent'),
      labelledValue('경과', elapsedLabel(progress.elapsedMs), 'elapsed'),
      labelledValue('정책', statusLabel(progress.mode), 'mode'),
      labelledValue('상태', statusLabel(progress.status), 'status'),
      labelledValue('workfile', projection.session.workfileName, 'workfile'),
    );
    const track = element('div', 'progress-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Number(progress.percent || 0)));
    const bar = element('div', 'progress-value');
    bar.style.inlineSize = `${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%`;
    track.append(bar);
    row.append(heading, details, track);
    if (progress.message) row.append(element('p', 'status-message', progress.message));
    root.append(row);
  }

  function openMenu(menuKey) {
    globalThis.controlTowerMenu?.activate?.(menuKey, { focus: true });
  }

  /**
   * 어떤 자리가 접힌 탭 안에 있으면 그 탭을 펴서 눈에 보이게 한다.
   *
   * 버튼과 그 결과가 다른 탭에 나뉘어 있는 화면이 있다. 결과가 접힌 채로 그려지면
   * 누른 사람에게는 아무 일도 일어나지 않은 것과 같다. 이미 펴져 있으면 건드리지 않는다.
   */
  function revealMenuPanelFor(node) {
    const panel = node?.closest?.('[data-menu-panel]');
    if (!panel || !panel.hidden) return;
    openMenu(text(panel.dataset.menuPanel));
  }

  function openFactoryStage(stageKey) {
    if (stageKey === 'competitors') {
      openMenu('competitors');
      document.getElementById('competitor-heading')?.focus?.();
      return;
    }
    if (!stageKey || stageKey === 'db') {
      openMenu('input-source');
      document.getElementById('intake-heading')?.focus?.();
      return;
    }
    if (stageKey === 'cafe24') {
      openMenu('cafe24');
      document.getElementById('factory-registration-panel')?.focus?.();
      return;
    }
    const stage = viewedProjection().stages.find(item => item.key === stageKey);
    selectedStageKey = stageKey;
    inspectedCandidateId = stage?.selectedId || stage?.candidates[0]?.id || '';
    rememberActiveTabView();
    candidatePage = 0;
    render();
    openMenu('production-acut');
    roots.candidates.querySelector('button')?.focus();
  }

  function activeProductJob() {
    return viewedJob() || projectFactoryQueueRenderModel(projection, productJobs).activeJob;
  }

  function assemblyStateLabel(step) {
    if (step.state === 'done') return '완료';
    if (step.state === 'manual') return `선택 필요${step.candidateCount ? ` · ${step.candidateCount}` : ''}`;
    if (step.state === 'blocked') return '차단';
    if (step.state === 'active') return '진행 중';
    return '대기';
  }

  function renderAssemblyWorkbenchBody(root, step, current, job) {
    root.dataset.stepKey = step.key;
    const heading = element('div', 'operator-focus-heading');
    const copy = element('div');
    copy.append(
      element('p', 'eyebrow', `${step.label} 작업면`),
      element('h3', '', `${step.label} · ${assemblyStateLabel(step)}`),
    );
    heading.append(copy, element('span', 'factory-pill', `${step.selectedCount}/${step.candidateCount || step.selectedCount || 0} 선택`));
    root.append(heading, element('p', 'status-message', step.blocker || step.nextAction));

    const boardTarget = element('div', 'operator-live-surface');
    boardTarget.dataset.productionBoardFocus = 'true';
    boardTarget.dataset.jobId = text(job?.jobId);
    if (step.key === 'start') {
      boardTarget.dataset.surface = 'intake';
      root.append(boardTarget);
    } else if (step.key === 'required') {
      boardTarget.dataset.surface = 'values';
      root.append(boardTarget);
    } else if (step.key === 'db') {
      const facts = element('div', 'menu-summary-grid');
      for (const input of current.inputs.filter(item => ['product', 'requirements', 'db', 'cafe24'].some(key => text(item.key).includes(key)))) {
        const card = element('article', 'menu-summary-card');
        card.append(
          element('strong', '', INPUT_LABELS[input.key] || input.key),
          element('p', 'status-message', `${input.count}건 · ${input.missing.length ? `미확정 ${input.missing.length}` : '확정 영수증 있음'}`),
        );
        facts.append(card);
      }
      root.append(facts);
      const action = element('button', 'button-secondary', '기존 입력·DB 작업면 열기');
      action.type = 'button';
      action.addEventListener('click', () => openFactoryStage('db'));
      root.append(action);
    } else if (step.key === 'competitors') {
      const target = element('div', 'operator-live-surface');
      root.append(target);
      dockWorkbenchSurface(roots.competitors, target);
      const action = element('button', 'button-secondary', '기존 경쟁사 작업면 열기');
      action.type = 'button';
      action.addEventListener('click', () => openFactoryStage('competitors'));
      root.append(action);
    } else if (step.key === 'cuts') {
      const groups = element('div', 'operator-cut-groups');
      for (const group of step.groups) {
        const button = element('button', 'button-secondary', `${STAGE_LABELS[group.key]} · ${group.selectedCount}/${group.candidateCount}`);
        button.type = 'button';
        button.dataset.cutStage = group.key;
        button.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('control-tower:production-board-focus-stage', { detail: { stageKey: group.key } }));
        });
        groups.append(button);
      }
      boardTarget.dataset.surface = 'cuts';
      root.append(groups, boardTarget);
    } else if (step.key === 'sections') {
      boardTarget.dataset.surface = 'sections';
      root.append(boardTarget);
    } else if (step.key === 'send') {
      const sameRegistrationJob = current.connected === true
        && text(current.registration.jobId) === text(job?.jobId);
      if (sameRegistrationJob) {
        boardTarget.dataset.surface = 'cafe24';
        root.append(boardTarget);
        const preflight = element('div', 'operator-live-surface');
        root.append(preflight);
        dockWorkbenchSurface(roots.registration, preflight);
      } else {
        const registration = record(record(job?.progress).registration || job?.registration);
        const selectedSession = record(record(job?.progress).session || job?.session);
        const session = Object.keys(selectedSession).length ? selectedSession : {
          productId: firstText(registration.productId, job?.productId),
          productKey: firstText(registration.productKey, job?.productKey, job?.productName),
          runId: text(job?.runId),
          inputFingerprint: text(job?.inputFingerprint),
          revision: Number(job?.revision || 0),
        };
        const historicalRegistration = element('section', 'operator-live-surface');
        root.append(historicalRegistration);
        renderCanonicalCafe24Registration(historicalRegistration, {
          registration,
          session,
          approvalState: {},
          connected: current.connected === true,
          readOnly: true,
          handlers: null,
          message: '현재 등록 대상이 아니어서 읽기 전용입니다. 선택한 이력 작업의 등록 사실만 표시하며 승인·실행 권한은 현재 등록 대상에 있습니다.',
        });
      }
    }
    if (boardTarget.dataset.surface) {
      document.dispatchEvent(new CustomEvent('control-tower:production-board-focus', {
        detail: {
          target: boardTarget,
          jobId: text(job?.jobId),
          surface: boardTarget.dataset.surface,
          readOnly: boardTarget.dataset.surface === 'cafe24'
            && text(current.registration.jobId) !== text(job?.jobId),
        },
      }));
    }
  }

  function createAssemblyWorkbench(assembly, current, job) {
    const panel = element('section', 'operator-stage-panel operator-assembly-workbench');
    const stageHeading = element('div', 'operator-panel-heading');
    const headingCopy = element('div');
    headingCopy.append(element('p', 'eyebrow', '조립공장 작업판'), element('h3', '', '1 시작부터 7 전송까지'));
    stageHeading.append(headingCopy, element('span', 'factory-pill', `현재 ${assembly.currentStep.label}`));
    const stageList = element('ol', 'operator-stage-list');
    stageList.id = 'operator-assembly-steps';
    for (const [index, step] of assembly.steps.entries()) {
      const item = element('li');
      const button = element('button', 'operator-stage-step');
      button.type = 'button';
      button.dataset.assemblyStep = step.key;
      button.dataset.state = step.key === operatorStepKey ? 'active' : step.state;
      button.setAttribute('aria-pressed', String(step.key === operatorStepKey));
      button.setAttribute('aria-label', `${index + 1}단계 ${step.label} · ${assemblyStateLabel(step)}`);
      button.append(
        element('span', 'operator-stage-number', String(index + 1).padStart(2, '0')),
        element('strong', '', step.label),
        element('span', 'operator-stage-state', assemblyStateLabel(step)),
      );
      button.addEventListener('click', () => {
        operatorStepKey = step.key;
        renderOverviewSummary();
      });
      item.append(button);
      stageList.append(item);
    }
    const body = element('section', 'operator-assembly-body');
    body.id = 'operator-assembly-body';
    body.setAttribute('aria-live', 'polite');
    renderAssemblyWorkbenchBody(body, assembly.steps.find(step => step.key === operatorStepKey) || assembly.currentStep, current, job);
    panel.append(stageHeading, stageList, body);
    return panel;
  }

  function renderOverviewSummary() {
    if (!roots.overview) return;
    restoreWorkbenchSurfaces();
    roots.overview.replaceChildren();
    const current = viewedProjection();
    const progress = record(current.progress);
    const activeJob = activeProductJob();
    const liveReceipt = text(current.registration.jobId) === text(projection.registration.jobId) ? approval.receipt : null;
    const assembly = deriveAssemblyWorkbench(
      current,
      activeJob,
      cafe24RegistrationSummary(current.registration, current.session, liveReceipt).registered,
    );
    const assemblyJobId = text(activeJob?.jobId || current.registration.jobId || current.session.productId);
    if (operatorStepJobId !== assemblyJobId) {
      operatorStepJobId = assemblyJobId;
      operatorStepKey = assembly.currentStep.key;
    }
    const projectionJobId = text(current.registration.jobId);
    const sameJob = Boolean(activeJob && text(activeJob.jobId) === projectionJobId);
    const inputMissing = current.inputs.reduce((total, input) => total + input.missing.length, 0);
    const counts = {
      queued: productJobs.filter(job => text(job.status) === 'queued').length,
      running: productJobs.filter(job => text(job.status) === 'running').length,
      waiting: productJobs.filter(job => text(job.status) === 'waiting_manual').length,
      completed: productJobs.filter(job => text(job.status) === 'completed').length,
    };
    const summary = element('section', 'operator-summary-strip');
    for (const [label, value, tone] of [
      ['대기', counts.queued, ''],
      ['진행 중', counts.running, 'active'],
      ['선택 필요', counts.waiting, 'warn'],
      ['완료', counts.completed, 'ok'],
    ]) {
      const metric = element('article', 'operator-metric');
      metric.dataset.tone = tone;
      metric.append(element('span', 'label', label), element('strong', '', String(value)));
      summary.append(metric);
    }
    roots.overview.append(summary);

    if (!activeJob && !current.session.productKey) {
      const empty = element('article', 'operator-empty-state');
      empty.append(
        element('p', 'eyebrow', '시작'),
        element('h3', '', '먼저 제품을 투입하세요'),
        element('p', 'status-message', '신화사 DB 제품을 선택하거나 신규 제품 자료를 직접 입력하면 조립공장 작업 큐에 등록됩니다.'),
      );
      const action = element('button', '', '제품 투입 열기');
      action.type = 'button';
      action.dataset.action = 'open-intake';
      action.addEventListener('click', () => openFactoryStage('db'));
      empty.append(action);
      roots.overview.append(empty, createAssemblyWorkbench(assembly, current, activeJob));
      return;
    }

    const jobStatus = text(activeJob?.status || progress.status || current.status || 'queued');
    const productName = text(activeJob?.productName || current.session.productKey || activeJob?.jobId);
    const sourceLabel = activeJob?.sourceKind === 'sinhwa-db'
      ? `신화사 DB · 품번 ${text(activeJob.jcode) || '없음'}`
      : activeJob
        ? `직접 입력 · 이미지 ${Number(activeJob.imageCount || 0)}장`
        : '조립공장 projection';
    const manualStages = manualACutDecisionIds(activeJob)
      .map(decision => AUTOMATION_DECISIONS[decision] || decision);
    const modeLabel = manualStages.length
      ? `후보 생성 자동 · A컷 직접 선택 ${manualStages.length}공정`
      : activeJob?.mode === 'auto' ? 'GPT 자동판단' : '단계별 수동';
    const stageLabel = text(activeJob?.stageLabel || STAGE_LABELS[activeJob?.stageKey] || progress.stageLabel || STAGE_LABELS[progress.stageKey] || progress.stageKey || '투입 대기');
    const percent = sameJob ? Math.max(0, Math.min(100, Number(progress.percent || 0))) : 0;
    const focus = element('article', 'operator-focus-card');
    focus.dataset.status = jobStatus;
    const focusHeading = element('div', 'operator-focus-heading');
    const identity = element('div');
    identity.append(element('p', 'eyebrow', '현재 제품'), element('h3', '', productName || '제품 식별자 없음'));
    focusHeading.append(identity, element('span', 'factory-pill', statusLabel(jobStatus)));
    const meta = element('div', 'operator-focus-meta');
    meta.append(
      element('span', 'factory-pill', sourceLabel),
      element('span', 'factory-pill', modeLabel),
      element('span', 'factory-pill', stageLabel),
    );
    const progressText = sameJob
      ? `${stageLabel} · ${percent}% · ${visibleFactoryMessage(progress.message || activeJob?.message, activeJob?.stageKey || progress.stageKey) || statusLabel(jobStatus)}`
      : `${stageLabel} · ${visibleFactoryMessage(activeJob?.message, activeJob?.stageKey) || '작업 순서를 기다리는 중'}`;
    const progressCopy = element('p', 'status-message', progressText);
    const track = element('div', 'progress-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(percent));
    const bar = element('div', 'progress-value');
    bar.style.inlineSize = `${percent}%`;
    track.append(bar);
    focus.append(focusHeading, meta, progressCopy, track);

    const registrationState = registrationStatus();
    const stagePanel = createAssemblyWorkbench(assembly, current, activeJob);
    roots.overview.append(stagePanel, focus);

    let nextTitle = `${stageLabel} 진행 상태를 확인하세요`;
    let nextDetail = visibleFactoryMessage(progress.message || activeJob?.message, activeJob?.stageKey || progress.stageKey) || '조립공장 event를 실시간으로 반영하고 있습니다.';
    let nextLabel = '생산 화면 열기';
    let nextStage = text(activeJob?.stageKey || progress.stageKey || 'representative');
    let nextTone = 'active';
    let directAction = null;
    if (jobStatus === 'waiting_manual') {
      const waitingStage = current.stages.find(stage => stage.key === nextStage);
      const automaticHeld = automaticDecisionHeld(activeJob, nextStage);
      if (automaticHeld) {
        nextTitle = 'GPT가 수동 확인으로 넘겼습니다';
        nextDetail = '판단 근거가 충분하지 않아 자동 선택하지 않았습니다. 후보와 근거를 보고 A컷을 직접 확정하세요.';
        nextLabel = '후보를 직접 선택';
        nextTone = 'warn';
      } else if (resolveLocalFactoryStageMode(current, productJobs, nextStage) === 'auto') {
        nextTitle = stageSaving(nextStage)
          ? 'GPT 자동판단 결과를 저장하고 있습니다'
          : 'GPT 자동판단을 준비하고 있습니다';
        nextDetail = 'GPT가 후보와 근거를 비교해 A컷을 고릅니다. 실패하면 같은 화면에서 수동으로 전환할 수 있습니다.';
        nextLabel = '자동 판단 상태 열기';
        nextTone = 'active';
      } else if (waitingStage?.selectedId) {
        nextTitle = `${STAGE_LABELS[nextStage] || stageLabel} A컷이 저장됐습니다`;
        nextDetail = '저장된 선택을 유지한 채 같은 제품의 다음 공정을 이어서 실행합니다.';
        nextLabel = '다음 단계 실행';
        nextTone = 'ok';
        directAction = () => void resumeFactoryJob(activeJob.jobId);
      } else {
        nextTitle = `${STAGE_LABELS[nextStage] || stageLabel} A컷을 선택하세요`;
        nextDetail = '후보를 확인한 뒤 A컷을 저장하면 같은 제품의 다음 공정이 자동으로 이어집니다.';
        nextLabel = '후보와 근거 열기';
        nextTone = 'warn';
      }
    } else if (jobStatus === 'blocked') {
      nextTitle = '이 제품이 멈췄습니다';
      nextDetail = visibleFactoryMessage(activeJob?.message, activeJob?.stageKey) || '차단 사유를 확인한 뒤 같은 입력 상태로 다시 실행합니다.';
      nextLabel = '같은 상태로 다시 실행';
      nextTone = 'error';
      directAction = () => void resumeFactoryJob(activeJob.jobId);
    } else if (jobStatus === 'queued') {
      nextTitle = '조립공장 실행 순서를 기다립니다';
      nextDetail = '앞 제품이 끝나거나 수동 선택 대기로 넘어가면 이 제품을 이어서 시작합니다.';
      nextLabel = '입력 자료 확인';
      nextStage = 'db';
    } else if (jobStatus === 'completed') {
      nextTitle = registrationState === 'staged_verified' ? 'Cafe24 등록 검증이 끝났습니다' : 'Cafe24 사전점검과 승인을 확인하세요';
      nextDetail = registrationState === 'staged_verified'
        ? '등록 결과 재확인 영수증까지 확인된 상태입니다.'
        : '외부 등록은 자동 실행하지 않으며 고정 대상과 일회 승인을 거쳐야 합니다.';
      nextLabel = 'Cafe24 게이트 열기';
      nextStage = 'cafe24';
      nextTone = registrationState === 'staged_verified' ? 'ok' : 'warn';
    }
    const now = element('aside', 'operator-now-card');
    now.dataset.tone = nextTone;
    const nowHeading = element('div', 'operator-now-heading');
    const nowIdentity = element('div');
    nowIdentity.append(element('p', 'eyebrow', '현재 상태와 다음 작업'), element('h3', '', nextTitle));
    nowHeading.append(nowIdentity, element('span', 'factory-pill', statusLabel(jobStatus)));
    const nowActions = element('div', 'operator-now-actions');
    const primary = element('button', '', nextLabel);
    primary.type = 'button';
    primary.dataset.action = directAction ? 'retry-factory-job' : `open-${nextStage}`;
    primary.addEventListener('click', directAction || (() => openFactoryStage(nextStage)));
    const intake = element('button', 'button-secondary', '제품 추가 투입');
    intake.type = 'button';
    intake.dataset.action = 'open-intake';
    intake.addEventListener('click', () => openFactoryStage('db'));
    nowActions.append(primary, intake);
    now.append(nowHeading, element('p', 'status-message', nextDetail), nowActions);
    roots.overview.insertBefore(now, focus);
  }

  function renderCompetitors() {
    if (!roots.competitors) return;
    roots.competitors.replaceChildren();
    const inputs = projection.inputs.filter(input => ['competitors', 'competitor_sources', 'competitor'].includes(input.key));
    if (!inputs.length) {
      roots.competitors.append(element('article', 'menu-summary-card', '아직 수집된 경쟁사 후보가 없습니다. 제품 작업을 시작하면 후보 수집부터 표시됩니다.'));
      return;
    }
    for (const input of inputs) {
      const card = element('article', 'menu-summary-card');
      const missing = input.missing.length;
      card.append(
        element('p', 'label', INPUT_LABELS[input.key] || '경쟁사 자료'),
        element('h3', '', `${input.count}개 후보`),
        element('p', 'status-message', missing ? `다음 작업: ${input.missing.join(' → ')}` : '후보 선택·상세수집·이미지 분석 완료'),
      );
      const candidateList = element('div', 'candidate-list');
      for (const item of list(input.items)) {
        const candidate = element('article', 'review-candidate');
        candidate.dataset.preview = String(item.selected === true);
        if (text(item.thumbnailUrl)) {
          const image = document.createElement('img');
          image.src = assetUrl(item.thumbnailUrl);
          image.alt = text(item.name) || '경쟁사 후보';
          image.loading = 'lazy';
          candidate.append(image);
        } else {
          candidate.append(element('span', 'product-thumb', '사진 없음'));
        }
        candidate.append(
          element('span', 'factory-pill', item.selected ? '상세수집 선택' : '후보'),
          element('span', '', [item.name, item.market, item.price].map(text).filter(Boolean).join(' · ')),
          element('span', 'factory-pill', item.analysisReady ? '분석 완료' : item.detailImageCount ? '상세수집 완료' : '수집 대기'),
        );
        candidateList.append(candidate);
      }
      if (candidateList.childElementCount) card.append(candidateList);
      roots.competitors.append(card);
    }
  }

  function renderStageSubnav() {
    if (!roots.stageSubnav) return;
    const current = viewedProjection();
    const currentKey = selectedStageKey || current.stages[0]?.key || '';
    for (const button of roots.stageSubnav.querySelectorAll('[data-stage-key]')) {
      const stageKey = text(button.dataset.stageKey);
      const historyStageCount = workBundleHistory && workBundleStatus === 'ready'
        ? workBundle.assets.filter(asset => (
          asset.phase === 'output' && text(asset.factoryStageKey) === stageKey
        )).length
        : 0;
      button.dataset.selected = String(stageKey === currentKey);
      button.dataset.state = stageKey === 'db'
        ? 'input'
        : workBundleHistory && workBundleStatus === 'ready'
          ? (historyStageCount ? 'selected' : 'empty')
        : factoryStageUiState(current.stages.find(stage => stage.key === stageKey), current.connected).state;
      button.dataset.historyCount = String(historyStageCount);
      if (button.dataset.bound === 'true') continue;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        if (stageKey === 'db') {
          globalThis.controlTowerMenu?.activate?.('input-source', { focus: false });
          document.getElementById('workfile-input')?.focus();
          return;
        }
        selectedStageKey = stageKey;
        if (workBundleHistory) {
          workBundleOutputStageKey = stageKey;
          candidatePage = 0;
          workBundleOutputPage = 0;
          render();
          roots.candidates.querySelector('button')?.focus();
          return;
        }
        const stage = current.stages.find(item => item.key === stageKey);
        inspectedCandidateId = stage?.selectedId || stage?.candidates[0]?.id || '';
        candidatePage = 0;
        rememberActiveTabView();
        render();
        roots.candidates.querySelector('button')?.focus();
      });
    }
  }

  function renderAuditSummary() {
    if (!roots.audit) return;
    roots.audit.replaceChildren();
    const session = projection.session;
    const state = connectivity();
    const card = element('article', 'menu-summary-card');
    card.append(
      element('p', 'label', '조립공장 연결 기록'),
      element('h3', '', state.factoryLabel),
      element('p', 'status-message', `${state.transportLabel} · ${state.detail}`),
      element('p', 'status-message', `${session.productKey || '제품 없음'} · 저장 차수 ${session.revision || 0} · 마지막 확인 ${lastEventAt || projection.capturedAt || '없음'}`),
    );
    roots.audit.append(card);
  }

  function replaceFactoryHistoryRoute(jobId) {
    const url = new URL(window.location.href);
    if (text(jobId)) url.searchParams.set(FACTORY_HISTORY_QUERY, text(jobId));
    else url.searchParams.delete(FACTORY_HISTORY_QUERY);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function closeWorkBundleImagePreview() {
    if (roots.imageDialog?.open && typeof roots.imageDialog.close === 'function') roots.imageDialog.close();
    roots.imageDialogImage?.removeAttribute('src');
    if (roots.imageDialogTitle) roots.imageDialogTitle.textContent = '작업자료 크게 보기';
    if (roots.imageDialogMeta) roots.imageDialogMeta.textContent = '';
  }

  function openWorkBundleImagePreview(asset) {
    const source = text(asset?.contentReference || asset?.thumbnailReference);
    const imageUrl = source ? text(assetUrl(source)) : '';
    if (!roots.imageDialog || !roots.imageDialogImage || !imageUrl) return;
    const imageLabel = text(asset.displayName) || '작업자료';
    roots.imageDialogImage.src = imageUrl;
    roots.imageDialogImage.alt = imageLabel;
    if (roots.imageDialogTitle) roots.imageDialogTitle.textContent = imageLabel;
    if (roots.imageDialogMeta) {
      const roleLabel = WORK_BUNDLE_ROLE_LABELS[asset.role] || '작업 자료';
      const stageLabel = STAGE_LABELS[asset.factoryStageKey] || STAGE_LABELS[asset.stage] || roleLabel;
      const selectionLabel = ({ selected: '선택됨', confirmed: '확정됨', candidate: '후보' })[asset.selectionState] || '작업 자료';
      roots.imageDialogMeta.textContent = `${roleLabel} · ${stageLabel} · ${selectionLabel}`;
    }
    if (typeof roots.imageDialog.showModal === 'function' && !roots.imageDialog.open) roots.imageDialog.showModal();
    else roots.imageDialog.setAttribute('open', '');
  }

  function bindWorkBundleImagePreview(root) {
    if (!root || root.dataset.imagePreviewBound === 'true') return;
    root.dataset.imagePreviewBound = 'true';
    root.addEventListener('click', event => {
      const trigger = event.target?.closest?.('[data-action="view-work-bundle-image"]');
      if (!trigger) return;
      const asset = workBundle.assets.find(item => item.id === text(trigger.dataset.assetId));
      if (asset) openWorkBundleImagePreview(asset);
    });
  }

  function renderProgressMap() {
    const root = roots.map;
    const current = viewedProjection();
    if (archivedJobId) {
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    const state = connectivity();
    root.replaceChildren();
    const inputHeading = element('h3', '', '입력 자료');
    root.append(inputHeading);
    const inputList = element('div', 'io-progress-group');
    for (const input of current.inputs) {
      const item = element('article', 'io-progress-item');
      item.dataset.inputKey = input.key;
      item.dataset.missingCount = String(input.missing.length);
      item.append(
        element('strong', '', INPUT_LABELS[input.key] || input.key),
        element('span', 'factory-pill', input.missing.length ? `누락 ${input.missing.length}` : `${input.count}개 준비`),
      );
      if (input.missing.length) item.append(element('p', 'status-message', input.missing.join(' · ')));
      inputList.append(item);
    }
    if (!current.inputs.length) {
      inputList.append(element('p', 'status-message', current.connected ? '아직 전달된 입력 자료가 없습니다.' : state.factoryLabel));
    }
    root.append(inputList, element('h3', '', '생성 결과'));
    const stageList = element('div', 'io-progress-group');
    for (const stage of current.stages) {
      const button = element('button', 'io-progress-item io-stage-button');
      const stageUi = factoryStageUiState(stage, current.connected);
      button.type = 'button';
      button.dataset.stageKey = stage.key;
      button.dataset.selected = String(stage.key === selectedStageKey);
      button.dataset.resolved = String(Boolean(stage.selectedId));
      button.dataset.state = stageUi.state;
      button.append(
        element('strong', '', STAGE_LABELS[stage.key] || stage.key),
        element('span', 'factory-pill', stageUi.state === 'selected'
          ? `A컷 선택 · ${stageUi.candidateCount}`
          : stageUi.state === 'unresolved'
            ? `결정 필요 · ${stageUi.candidateCount}`
            : statusLabel(stageUi.state)),
      );
      button.addEventListener('click', () => {
        selectedStageKey = stage.key;
        inspectedCandidateId = stage.selectedId || stage.candidates[0]?.id || '';
        candidatePage = 0;
        rememberActiveTabView();
        render();
        roots.candidates.querySelector('button')?.focus();
      });
      stageList.append(button);
    }
    if (!current.stages.length) stageList.append(element('p', 'status-message', state.factoryLabel));
    root.append(stageList);
  }

  function renderCandidateContactSheet(root, {
    stageKey = selectedStageKey,
    summary = '',
    selectionEnabled = true,
    blockedDetail = '',
    degradedQueueDetail = false,
    projectionValue = viewedProjection(),
  } = {}) {
    const current = normalizeFactoryProjection(projectionValue);
    if (archivedJobId) {
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    root.replaceChildren();
    const stage = selectedStage(current, stageKey);
    const recentSelection = workfileTabs.active()?.recentSelection;
    if (recentSelection && recentSelection.stageKey !== stage?.key) {
      const recent = element('article', 'recent-a-cut-summary');
      recent.append(
        element('span', 'factory-pill', '방금 선택'),
        element('strong', '', STAGE_LABELS[recentSelection.stageKey] || recentSelection.stageKey),
        element('span', 'status-message', recentSelection.candidateId),
      );
      root.append(recent);
    }
    const heading = element('div', 'section-heading compact-heading');
    heading.append(element('div', '', ''), element('span', 'factory-pill', stage ? `${stage.candidates.length}개 후보` : '0개 후보'));
    heading.firstElementChild.append(
      element('p', 'eyebrow', 'A컷 후보'),
      element('h3', '', stage ? STAGE_LABELS[stage.key] : '출력 단계 선택'),
    );
    root.append(heading);
    if (summary) root.append(element('p', 'status-message', summary));
    if (!current.connected && !degradedQueueDetail && !(stage && stage.candidates.length)) {
      root.append(element('p', 'factory-empty-state', connectivity().factoryLabel));
      return;
    }
    if (!stage || !stage.candidates.length) {
      if (blockedDetail) {
        const blocked = element('article', 'operator-empty-state');
        blocked.dataset.state = 'blocked';
        blocked.append(
          element('p', 'eyebrow', '차단 사유'),
          element('h3', '', '차단된 작업의 후보가 없습니다'),
          element('p', 'factory-empty-state', blockedDetail),
        );
        root.append(blocked);
        return;
      }
      root.append(element('p', 'factory-empty-state', '아직 생성되지 않음'));
      return;
    }
    // 고를 수 없는 이유는 후보가 없을 때만 적혀 있었다. 후보가 있는데 못 고르는 경우에는
    // 회색 버튼만 남아서, 왜 안 눌리는지 알 길이 없었다. 그때도 한 줄로 까닭을 적는다.
    if (!selectionEnabled) {
      const why = element('p', 'factory-empty-state', blockedDetail
        || '지금은 이 단계를 고를 차례가 아닙니다 · 작업 큐에서 작업을 재개해 주세요.');
      why.dataset.state = 'selection-closed';
      why.setAttribute('role', 'status');
      root.append(why);
    }
    const maximumPage = Math.max(0, Math.ceil(stage.candidates.length / CANDIDATE_PAGE_SIZE) - 1);
    candidatePage = Math.min(candidatePage, maximumPage);
    const start = candidatePage * CANDIDATE_PAGE_SIZE;
    const page = stage.candidates.slice(start, start + CANDIDATE_PAGE_SIZE);
    const grid = element('div', 'a-cut-contact-sheet');
    grid.dataset.stageKey = stage.key;
    grid.dataset.rendered = String(page.length);
    for (const candidate of page) {
      const bundleAsset = resolveCandidateAsset(
        candidate,
        workBundle.assets,
        stage.key,
      ).asset;
      const previewAsset = bundleAsset || {
        thumbnailReference: candidate.thumbnailUrl,
        contentReference: candidate.contentUrl,
        displayName: `${STAGE_LABELS[stage.key]} 후보`,
        role: '',
        factoryStageKey: stage.key,
        selectionState: stage.selectedId === candidate.id ? 'selected' : 'candidate',
      };
      const card = element('article', 'a-cut-candidate');
      card.dataset.candidateId = candidate.id;
      card.dataset.selected = String(stage.selectedId === candidate.id);
      card.dataset.inspected = String(inspectedCandidateId === candidate.id);
      const frame = element('div', 'a-cut-thumb');
      const thumbnail = resolveCandidateThumbnail({
        ...candidate,
        thumbnailUrl: bundleAsset?.thumbnailReference || candidate.thumbnailUrl,
      }, assetUrl);
      const placeholder = element('p', 'factory-empty-state', '후보 이미지 없음');
      placeholder.setAttribute('role', 'status');
      if (thumbnail.kind === 'image') {
        const image = element('img');
        image.src = thumbnail.url;
        image.alt = `${STAGE_LABELS[stage.key]} 후보 ${candidate.id}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = 160;
        image.height = 120;
        image.addEventListener('error', () => {
          placeholder.textContent = '이미지 불러오기 실패';
          placeholder.dataset.broken = 'true';
          image.replaceWith(placeholder);
        }, { once: true });
        const trigger = element('button', 'work-bundle-image-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-label', `${STAGE_LABELS[stage.key]} 후보 크게 보기`);
        trigger.addEventListener('click', () => openWorkBundleImagePreview(previewAsset));
        trigger.append(image);
        frame.append(trigger);
      } else {
        frame.append(placeholder);
      }
      const meta = element('div', 'a-cut-candidate-meta');
      // 제목이 factory_hero_mt46q96f_xmuyat 이면 무엇을 고르는지 알 수 없다.
      // 사람이 읽을 이름을 크게 두고, 식별자는 찾아볼 수 있게 작게 남긴다.
      const ordinal = page.indexOf(candidate) + 1 + start;
      meta.append(element('strong', '', `${STAGE_LABELS[stage.key] || stage.key} 후보 ${ordinal}`));
      meta.append(element('span', 'a-cut-candidate-id', candidate.id));
      if (bundleAsset) {
        meta.append(element(
          'span',
          'factory-pill',
          WORK_BUNDLE_ROLE_LABELS[bundleAsset.role] || bundleAsset.role,
        ));
      }
      if (stage.selectedId === candidate.id) meta.append(element('span', 'factory-pill selected-badge', '선택 A컷'));
      const actions = element('div', 'a-cut-candidate-actions');
      const select = element('button', '', stage.selectedId === candidate.id ? '선택됨' : '이 컷 선택');
      select.type = 'button';
      select.dataset.action = 'select-a-cut-direct';
      select.disabled = !current.connected
        || !selectionEnabled
        || Boolean(stageSaving(stage.key))
        || stage.selectedId === candidate.id
        || (!text(current.registration.jobId).startsWith('factory-job-')
          && resolveCandidateAsset(candidate, workBundle.assets, stage.key).status !== 'matched');
      select.addEventListener('click', () => void selectACut(stage, candidate));
      const view = element('button', 'button-secondary', '근거 보기');
      view.type = 'button';
      view.dataset.action = 'view-candidate';
      view.addEventListener('click', () => {
        inspectedCandidateId = candidate.id;
        // 인스펙터는 지금 고른 단계 안에서만 후보를 찾는다. 작업 큐에서는 단계가 다를 수 있어서,
        // 맞춰 주지 않으면 누른 컷이 아니라 그 단계의 첫 컷 근거가 뜬다.
        selectedStageKey = stage.key;
        rememberActiveTabView();
        render();
        // 근거는 생산·A컷 탭의 artifact-inspector 에 그려진다.
        // 작업 큐에서 눌렀을 때 그 탭이 접혀 있으면 화면이 하나도 안 바뀌어서
        // 사람 눈에는 "눌러도 아무 일도 없는 버튼" 이 된다. 그리기 전에 그 탭을 편다.
        revealMenuPanelFor(roots.inspector);
        roots.inspector.querySelector('[data-action="select-a-cut"]')?.focus();
      });
      actions.append(select, view);
      card.append(frame, meta, actions);
      grid.append(card);
    }
    root.append(grid);
    if (maximumPage > 0) {
      const pagination = element('nav', 'button-row candidate-pagination');
      pagination.setAttribute('aria-label', '후보 페이지');
      const previous = element('button', 'button-secondary', '이전 후보');
      previous.type = 'button';
      previous.disabled = candidatePage === 0;
      previous.addEventListener('click', () => {
        candidatePage -= 1;
        render();
      });
      const current = element('span', 'status-message', `${candidatePage + 1} / ${maximumPage + 1}`);
      const next = element('button', 'button-secondary', '다음 후보');
      next.type = 'button';
      next.disabled = candidatePage === maximumPage;
      next.addEventListener('click', () => {
        candidatePage += 1;
        render();
      });
      pagination.append(previous, current, next);
      root.append(pagination);
    }
  }

  function renderCandidates() {
    // 작업 큐는 "지금 고를 차례" 일 때만 선택 버튼을 열어 주는데 이 화면은 늘 열어 두었다.
    // 그래서 차단된 작업에서도 눌리고, 서버는 decision_target_required 로 거절했다.
    // 조립공장 작업이면 큐와 같은 잣대를 쓴다. 다른 흐름(PDP bundle)은 건드리지 않는다.
    const current = viewedProjection();
    const jobId = text(current.registration.jobId);
    const localJob = jobId.startsWith('factory-job-')
      ? productJobs.find(job => text(job.jobId) === jobId)
      : null;
    const stageKey = selectedStageKey || text(localJob?.stageKey);
    const selectionEnabled = viewMatchesLiveProjection()
      && (!localJob || (
        text(localJob.status) === 'waiting_manual'
        && (
          resolveLocalFactoryStageMode(current, productJobs, stageKey) === 'manual'
          || automaticDecisionHeld(localJob, stageKey)
        )
      ));
    renderCandidateContactSheet(roots.candidates, {
      selectionEnabled,
      blockedDetail: localJob && text(localJob.status) === 'blocked'
        ? `작업 차단 · ${visibleFactoryMessage(localJob.message, localJob.stageKey) || '작업을 재개해야 A컷을 고를 수 있습니다.'}`
        : '',
      projectionValue: current,
    });
  }

  function renderQueueSelectionWorkbench() {
    const root = roots.queueSelection;
    if (!root) return;
    const current = viewedProjection();
    const job = viewedJob();
    const connection = projectFactoryQueueRenderModel(current, job ? [job] : [], {
      transport: syncTransport,
      lastEventAt,
      apiError: queueApiError || factoryApiError,
    });
    if (!job) {
      root.hidden = false;
      root.replaceChildren(
        element('p', 'eyebrow', '여러 제품 A컷 선택'),
        element('h3', '', '현재 선택할 컷이 없습니다'),
        element('p', 'factory-empty-state', '제품이 자동 공정을 시작하거나 수동 선택 대기에 들어오면 이곳에 후보가 표시됩니다.'),
      );
      return;
    }
    const active = viewMatchesLiveProjection();
    const stageKey = selectedStageKey || text(job.stageKey);
    const row = buildOperatorQueueRow(job, Math.max(0, productJobs.findIndex(item => text(item.jobId) === text(job.jobId))));
    const stageMode = resolveLocalFactoryStageMode(current, productJobs, stageKey);
    const automaticHeld = automaticDecisionHeld(job, stageKey);
    const selectionEnabled = active
      && text(job.status) === 'waiting_manual'
      && (stageMode === 'manual' || automaticHeld);
    const blockedDetail = text(job.status) === 'blocked'
      ? `작업 차단 · ${visibleFactoryMessage(job.message, job.stageKey) || '후보가 아직 없어 선택할 수 없습니다.'}`
      : '';
    const summary = [connection.detail?.copy, !active
      ? `${row.stepLabel} · ${row.stateLabel} · 보기 전용입니다. 명시적으로 작업 재개한 뒤에만 선택을 저장할 수 있습니다.`
      : selectionEnabled
        ? `${text(job.productName || current.session.productKey)} · ${row.stepLabel} · 이 제품의 후보 중 A컷 하나를 고르세요.`
        : `${text(job.productName || current.session.productKey)} · ${row.stepLabel} · ${row.stateLabel}`]
      .filter(Boolean)
      .join(' · ');
    root.dataset.jobId = text(job.jobId);
    root.dataset.state = text(job.status);
    renderCandidateContactSheet(root, {
      stageKey,
      summary,
      selectionEnabled,
      blockedDetail,
      degradedQueueDetail: connection.connectivity.state === 'degraded',
      projectionValue: current,
    });
  }

  function detailSectionTitle(group) {
    return `${String(group.order).padStart(2, '0')} ${group.label}`;
  }

  function appendDetailSectionGroup(root, group, visibleAssets = group.assets) {
    const isPreview = visibleAssets.length < group.assets.length;
    const section = element('section', 'detail-section-group');
    section.dataset.detailSection = group.key;
    const heading = element('div', 'detail-section-group-heading');
    const copy = element('div');
    copy.append(
      element('p', 'eyebrow', `${String(group.order).padStart(2, '0')} · 상세페이지 섹션`),
      element('h4', '', group.label),
      element('p', 'status-message', isPreview
        ? `최신 보관본 1장 · 전체 ${group.assets.length}장 · 이미지를 누르면 크게 볼 수 있습니다.`
        : '실제 보관 결과 · 이미지를 누르면 크게 볼 수 있습니다.'),
    );
    heading.append(copy, element('span', 'factory-pill', `${group.assets.length}장`));
    const gallery = element('div', 'detail-section-gallery');
    for (const asset of visibleAssets) {
      const card = createWorkBundleAssetCard(asset, assetUrl, {
        title: detailSectionTitle(group),
        detail: isPreview ? `섹션 최신 보관본 · 전체 ${group.assets.length}장` : '섹션 결과 · 원본 보관 연결',
      });
      card.dataset.detailSection = group.key;
      gallery.append(card);
    }
    section.append(heading, gallery);
    root.append(section);
  }

  function appendHistoryOutputPresentation(root, page, stageFilter) {
    if (stageFilter !== 'sections' && stageFilter !== 'final_detail') return false;
    const currentGroups = groupWorkBundleSectionAssets(page.items);
    if (stageFilter === 'sections') {
      root.dataset.presentation = 'detail-sections';
      root.append(element('p', 'history-result-callout', '상세페이지 제작 순서대로 정리했습니다. 파일명 대신 섹션과 이미지로 확인하세요.'));
      const allSectionAssets = workBundle.assets.filter(asset => (
        asset.phase === 'output' && text(asset.factoryStageKey) === 'sections'
      ));
      for (const group of groupWorkBundleSectionAssets(allSectionAssets).filter(group => group.key !== 'other')) {
        if (group.latest) appendDetailSectionGroup(root, group, [group.latest]);
      }
      const archive = element('details', 'history-archive-disclosure');
      archive.append(element('summary', '', `보관된 섹션 결과 ${page.total}장 모두 보기`));
      archive.append(element('p', 'status-message', `현재 페이지 ${page.page + 1}의 ${page.items.length}장을 섹션별로 표시합니다.`));
      for (const group of currentGroups) appendDetailSectionGroup(archive, group);
      root.append(archive);
      return true;
    }
    root.dataset.presentation = 'final-detail-storyboard';
    const allFinalAssets = workBundle.assets.filter(asset => (
      asset.phase === 'output' && text(asset.factoryStageKey) === 'final_detail'
    ));
    const storyboard = element('section', 'final-detail-storyboard');
    const heading = element('div', 'detail-section-group-heading');
    const copy = element('div');
    copy.append(
      element('p', 'eyebrow', '최종 선택 연결 미리보기'),
      element('h4', '', '상세페이지로 이어지는 최종 컷'),
      element('p', 'status-message', '각 섹션의 실제 최종 선택 보관본을 상세페이지 순서로 이어서 표시합니다.'),
    );
    heading.append(copy, element('span', 'factory-pill', `${allFinalAssets.length}장 보관`));
    storyboard.append(heading);
    for (const group of groupWorkBundleSectionAssets(allFinalAssets).filter(group => group.key !== 'other')) {
      if (!group.latest) continue;
      const card = createWorkBundleAssetCard(group.latest, assetUrl, {
        title: detailSectionTitle(group),
        detail: `최종 선택 보관본 · ${group.assets.length}장 중 최신`,
      });
      card.classList.add('final-detail-page-card');
      card.dataset.detailSection = group.key;
      storyboard.append(card);
    }
    root.append(storyboard);
    const archive = element('details', 'history-archive-disclosure');
    archive.append(element('summary', '', `보관된 최종 결과 ${page.total}장 모두 보기`));
    archive.append(element('p', 'status-message', `현재 페이지 ${page.page + 1}의 ${page.items.length}장을 섹션별로 표시합니다.`));
    for (const group of currentGroups) appendDetailSectionGroup(archive, group);
    root.append(archive);
    return true;
  }

  function renderWorkBundleAssets(root, phase, pageValue, stageFilterOverride = '') {
    root.replaceChildren();
    bindWorkBundleImagePreview(root);
    const history = record(workBundleHistory);
    const historyActive = Boolean(workBundleHistory);
    const stageFilter = historyActive && phase === 'output'
      ? text(stageFilterOverride || workBundleOutputStageKey)
      : '';
    const totalForHeading = workBundleStatus === 'ready'
      ? workBundle.assets.filter(asset => (
        asset.phase === phase && (!stageFilter || text(asset.factoryStageKey) === stageFilter)
      )).length
      : 0;
    const heading = element('div', 'section-heading compact-heading');
    heading.append(element('div'), element(
      'span',
      'factory-pill',
      workBundleStatus === 'ready'
        ? `${totalForHeading}개 ${historyActive ? '자료' : '자산'}`
        : statusLabel(workBundleStatus),
    ));
    heading.firstElementChild.append(
      element('p', 'eyebrow', historyActive ? 'kuasangse 완료 작업 이력' : (phase === 'input' ? '조립공장 입력 자료' : '조립공장 생성 결과')),
      element('h3', '', historyActive
        ? (phase === 'input'
          ? '완료 작업에 넣은 입력'
          : stageFilter === 'sections'
            ? '상세페이지 섹션 결과'
            : stageFilter === 'final_detail'
              ? '최종 상세페이지 선택 결과'
              : `${STAGE_LABELS[stageFilter] || '생산'} 결과`)
        : (phase === 'input' ? '실제 입력 자료' : '실제 생성 결과')),
    );
    if (historyActive && root === roots.bundleOutputs) {
      const close = element('button', 'button-secondary', '현재 작업자료로 돌아가기');
      close.type = 'button';
      close.dataset.action = 'close-history';
      close.addEventListener('click', closeHistoricalWorkBundle);
      heading.append(close);
    }
    root.append(heading);
    if (workBundleStatus !== 'ready') {
      root.append(element(
        'p',
        'factory-empty-state',
        workBundleStatus === 'loading'
          ? '신화사 작업 자료를 불러오는 중입니다.'
          : `작업 자료를 불러오지 못했습니다 · ${workBundleError || '연결 상태를 확인해 주세요.'}`,
      ));
      return;
    }
    const page = workBundleAssetPage(workBundle, phase, pageValue, stageFilter);
    root.dataset.bundleId = workBundle.id;
    root.dataset.total = String(page.total);
    root.dataset.rendered = String(page.items.length);
    root.dataset.page = String(page.page + 1);
    root.dataset.historyJobId = historyActive ? archivedJobId : '';
    const contract = element(
      'p',
      'status-message',
      historyActive
        ? `${history.productName || workBundle.bundleKey} · 완료된 생산 결과 · ${stageFilter ? `${STAGE_LABELS[stageFilter] || stageFilter} 순서` : '작업 순서'}로 확인 · 원본 보관 기록 유지`
        : `${workBundle.workfileName || workBundle.bundleKey} · 저장 차수 ${workBundle.version}`,
    );
    root.append(contract);
    if (historyActive) {
      const input = record(history.input);
      const output = record(history.output);
      const summary = element('div', 'status-message history-readback-summary');
      if (phase === 'input') {
        const required = Object.entries(record(input.requiredValues))
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ') || '필수값 기록 없음';
        summary.textContent = `입력 ${Number(input.count || 0)}장 · 출처 ${input.sourceKind || '확인 필요'} · 실행 방식 ${input.mode || '확인 필요'} · ${required}`;
      } else {
        const selected = Object.entries(record(output.selectedByStage))
          .map(([key, value]) => `${HISTORY_SELECTION_STAGE_LABELS[key] || key} ${value}개`)
          .join(' · ') || '선택 분류 기록 없음';
        const resultCount = Number(output.selectedResultCount ?? output.selectedCount ?? 0);
        const sourceCount = Number(output.selectedSourceCount || 0);
        summary.textContent = `출력 ${Number(output.count || 0)}개 · 선택 표시 ${Number(output.selectedCount || 0)}개 · 후보 ${Number(output.candidateCount || 0)}개 · 최종 선택 결과 ${resultCount}개 · 원본 연결 ${sourceCount}개 · ${selected}`;
      }
      root.append(summary);
    }
    if (!page.total) {
      root.append(element('p', 'factory-empty-state', `${phase === 'input' ? '입력' : '생성 결과'} 자료가 없습니다.`));
      return;
    }
    root.dataset.presentation = 'grid';
    const usesDetailPresentation = historyActive && phase === 'output'
      && appendHistoryOutputPresentation(root, page, stageFilter);
    if (!usesDetailPresentation) {
      const grid = element('div', 'a-cut-contact-sheet work-bundle-contact-sheet');
      let previousRole = '';
      for (const asset of page.items) {
        if (asset.role !== previousRole) {
          const role = element(
            'h4',
            'work-bundle-role',
            WORK_BUNDLE_ROLE_LABELS[asset.role] || asset.role,
          );
          role.dataset.role = asset.role;
          grid.append(role);
          previousRole = asset.role;
        }
        grid.append(createWorkBundleAssetCard(asset, assetUrl));
      }
      root.append(grid);
    }
    if (page.pageCount > 1) {
      const pagination = element('nav', 'button-row candidate-pagination');
      pagination.setAttribute('aria-label', `${phase} 자산 페이지`);
      const previous = element('button', 'button-secondary', '이전 자산');
      previous.type = 'button';
      previous.disabled = page.page === 0;
      previous.addEventListener('click', () => {
        if (phase === 'input') workBundleInputPage -= 1;
        else workBundleOutputPage -= 1;
        render();
      });
      const current = element('span', 'status-message', `${page.page + 1} / ${page.pageCount}`);
      const next = element('button', 'button-secondary', '다음 자산');
      next.type = 'button';
      next.disabled = page.page + 1 >= page.pageCount;
      next.addEventListener('click', () => {
        if (phase === 'input') workBundleInputPage += 1;
        else workBundleOutputPage += 1;
        render();
      });
      pagination.append(previous, current, next);
      root.append(pagination);
    }
  }

  function closeHistoricalWorkBundle() {
    replaceFactoryHistoryRoute('');
    archivedJobId = '';
    workBundleHistory = null;
    workBundleOutputStageKey = '';
    workBundleError = '';
    workBundleStatus = 'loading';
    workBundle = normalizeWorkBundle({});
    void loadWorkBundle();
  }

  async function loadHistoricalWorkBundle(jobId) {
    const generation = ++workBundleGeneration;
    archivedJobId = text(jobId);
    replaceFactoryHistoryRoute(archivedJobId);
    openMenu('production-acut');
    workBundleHistory = null;
    workBundleOutputStageKey = '';
    workBundleStatus = 'loading';
    workBundleError = '';
    workBundle = normalizeWorkBundle({});
    renderWorkBundleAssets(roots.bundleInputs, 'input', workBundleInputPage);
    renderWorkBundleAssets(roots.bundleOutputs, 'output', workBundleOutputPage);
    try {
      const result = await apiRequest(`/api/factory/jobs/${encodeURIComponent(archivedJobId)}/history`);
      if (generation !== workBundleGeneration || archivedJobId !== text(jobId)) return;
      workBundle = normalizeWorkBundle(result.workBundle);
      workBundleHistory = record(result.history);
      workBundleStatus = 'ready';
      workBundleError = '';
      const archivedOutputStages = new Set(workBundle.assets
        .filter(asset => asset.phase === 'output')
        .map(asset => text(asset.factoryStageKey)));
      const initialHistoryStage = [
        'sections',
        'final_detail',
        'representative',
        'size',
        'option_color',
        'general',
      ].find(stageKey => archivedOutputStages.has(stageKey)) || '';
      workBundleOutputStageKey = initialHistoryStage;
      selectedStageKey = initialHistoryStage || selectedStageKey;
      workBundleInputPage = 0;
      workBundleOutputPage = 0;
    } catch (error) {
      if (generation !== workBundleGeneration) return;
      workBundleStatus = 'blocked';
      workBundleError = text(error.code || error.message || 'factory_history_unavailable');
      workBundle = normalizeWorkBundle({});
    }
    render();
  }

  async function loadWorkBundle() {
    if (archivedJobId) {
      await loadHistoricalWorkBundle(archivedJobId);
      return;
    }
    const generation = ++workBundleGeneration;
    const workspaceId = requestedWorkBundleId ? '' : text(projection.session.workspaceId);
    const productKey = requestedWorkBundleId ? '' : text(projection.session.productKey);
    workBundleHistory = null;
    workBundleStatus = 'loading';
    workBundleError = '';
    if (!requestedWorkBundleId && !workspaceId && !productKey) {
      workBundleStatus = 'blocked';
      workBundleError = '현재 작업 세션이 없습니다. 완료 작업에서 입력·출력·선택 보기를 누르세요.';
      workBundle = normalizeWorkBundle({});
      render();
      return;
    }
    renderWorkBundleAssets(roots.bundleInputs, 'input', workBundleInputPage);
    renderWorkBundleAssets(roots.bundleOutputs, 'output', workBundleOutputPage);
    try {
      const nextBundle = await fetchBoundWorkBundle({
        apiRequest,
        workspaceId,
        productKey,
        requestedId: requestedWorkBundleId,
        isCurrent: () => (
          generation === workBundleGeneration
          && (
            requestedWorkBundleId
            || (
              workspaceId === text(projection.session.workspaceId)
              && productKey === text(projection.session.productKey)
            )
          )
        ),
      });
      if (generation !== workBundleGeneration) return;
      workBundle = nextBundle;
      workBundleStatus = 'ready';
      workBundleError = '';
      workBundleHistory = null;
      workBundleOutputStageKey = '';
      workBundleInputPage = 0;
      workBundleOutputPage = 0;
    } catch (error) {
      if (generation !== workBundleGeneration || error.code === 'stale_work_bundle_response') return;
      workBundleStatus = 'blocked';
      workBundleError = text(error.code || error.message) === 'work_bundle_target_required'
        ? '현재 작업 세션에 연결된 작업자료가 없습니다.'
        : text(error.code || error.message);
      workBundle = normalizeWorkBundle({});
    }
    render();
    if (!requestedWorkBundleId) void scheduleAutomaticSelection();
  }

  async function restoreInitialWorkBundle() {
    const defaultJobId = defaultCompletedHistoryJobId(productJobs, {
      hasSession: Boolean(text(projection.session.workspaceId) || text(projection.session.productKey)),
      historyJobId: archivedJobId,
      requestedBundleId: requestedWorkBundleId,
    });
    if (defaultJobId) {
      await loadHistoricalWorkBundle(defaultJobId);
      return;
    }
    await loadWorkBundle();
  }

  function judgementOptions() {
    return {
      model: text(document.getElementById('model-select')?.value || 'latestModel'),
      reasoningEffort: text(document.getElementById('reasoning-select')?.value || 'medium'),
      serviceTier: text(document.getElementById('tier-select')?.value || 'standard'),
      preset: text(document.getElementById('preset-select')?.value || 'fast_single'),
    };
  }

  async function submitSelection(stage, candidate, decisionMode) {
    if (!viewMatchesLiveProjection()) {
      setStatus('live-status', '보기 전용 작업입니다. 작업 재개 후 A컷을 저장해 주세요.', 'error');
      return null;
    }
    const jobId = text(projection.registration.jobId);
    const localFactoryJob = jobId.startsWith('factory-job-');
    if ((!localFactoryJob && !workBundle.id) || !jobId) {
      setStatus('live-status', 'A컷 선택 대상 bundle과 PDP job 연결이 필요합니다.', 'error');
      return;
    }
    const pending = {
      productId: projection.session.productId,
      stageKey: stage.key,
      candidateId: candidate?.id || 'oauth-pending',
    };
    savingByTarget.set(savingKey(stage.key), pending);
    render();
    try {
      const command = candidate
        ? buildACutSelectionCommand(projection, pending)
        : {
          capabilityVersion: projection.capabilityVersion,
          command: 'selectFactoryACut',
          productId: projection.session.productId,
          productKey: projection.session.productKey,
          stageKey: stage.key,
          expectedRevision: projection.session.revision,
          expectedRunId: projection.session.runId,
          expectedInputFingerprint: projection.session.inputFingerprint,
          idempotencyKey: `a-cut-auto:${projection.session.productKey}:${stage.key}:${projection.session.revision}`,
        };
      const selectionPayload = localFactoryJob
        ? {
          ...command,
          jobId,
          expectedProjectionCursor: text(projection.cursor),
          decisionMode,
          judgementOptions: judgementOptions(),
        }
        : buildCompositeSelectionPayload({
          projection,
          command,
          workBundle,
          jobId,
          decisionMode,
          policySnapshot: automationState.snapshot,
          judgementOptions: judgementOptions(),
        });
      const response = await apiRequest(localFactoryJob
        ? `/api/factory/jobs/${encodeURIComponent(jobId)}/select`
        : '/api/factory/a-cuts/select', {
        method: 'POST',
        body: JSON.stringify(selectionPayload),
      });
      lastAutomationReceipt = response.decisionReceipt || null;
      if (response.selectionStatus !== 'saving') {
        savingByTarget.delete(savingKey(stage.key));
        heldDecisions.add(STAGE_DECISIONS[stage.key]);
        setStatus(
          'live-status',
          response.selectionStatus === 'manual_required'
            ? 'GPT 자동판단 보류 · 후보를 직접 확인해 주세요.'
            : `판단 기록 완료 · ${text(response.selectionStatus)}`,
          'error',
        );
      } else {
        const selectedId = text(record(response.decisionReceipt).selectedCandidateId || candidate?.id);
        savingByTarget.set(savingKey(stage.key), { ...pending, candidateId: selectedId });
        if (localFactoryJob && selectedId) pendingResumeByStage.set(stage.key, { jobId, candidateId: selectedId });
        setStatus('live-status', `${STAGE_LABELS[stage.key]} PDP 판단 기록 후 factory 명령을 전달했습니다.`, 'ok');
      }
      render();
      return response;
    } catch (error) {
      savingByTarget.delete(savingKey(stage.key));
      setStatus('live-status', `A컷 저장 실패 · ${aCutSaveFailureCopy(error)}`, 'error');
      if ([409, 422].includes(error.status)) await refreshState();
      render();
      return null;
    }
  }

  /**
   * 조립공장·관제탑이 거절한 까닭을 사람 말로 옮긴다.
   *
   * 서버 코드를 그대로 띄우면 무엇을 해야 하는지 알 수 없다.
   * 예를 들어 decision_target_required 는 "이 단계가 지금 고를 차례가 아니다" 라는 뜻인데,
   * 대개 작업이 차단된 채여서 먼저 재개해야 하는 상황이다.
   * 코드는 괄호로 함께 남긴다 — 사람이 읽을 말과 찾아볼 열쇠가 둘 다 필요하다.
   * 모르는 코드는 그대로 보여 준다. 지어내는 것보다 낫다.
   */
  function aCutSaveFailureCopy(error) {
    const code = text(error?.message);
    const copy = {
      decision_target_required: '지금은 이 단계를 고를 차례가 아닙니다 · 작업을 먼저 재개해 주세요',
      factory_product_job_busy: '조립공장이 이 작업을 물고 있습니다 · 끝난 뒤 다시 시도해 주세요',
      factory_worker_build_not_admitted: '조립공장이 다른 판을 쓰고 있습니다 · 작업자 창을 새로고침해 주세요',
      factory_product_job_not_found: '그 작업을 찾지 못했습니다 · 작업 큐를 새로고침해 주세요',
      stale_run_fingerprint: '후보가 지금 작업과 맞지 않습니다 · 화면을 새로고침해 주세요',
      stale_product_checkpoint: '저장된 작업 지점이 지금 조립공장 상태와 어긋납니다 · 작업 큐에서 “다시 시도”로 이어서 진행해 주세요',
      factory_a_cut_candidate_missing: '그 후보를 찾지 못했습니다 · 화면을 새로고침해 주세요',
      factory_cafe24_target_mismatch: '지금 열린 작업과 다른 작업입니다 · 그 작업을 먼저 열어 주세요',
      request_invalid: '요청이 올바르지 않습니다',
    }[code];
    return copy ? `${copy} (${code})` : code;
  }

  async function selectACut(stage, candidate) {
    await submitSelection(stage, candidate, 'manual');
  }

  async function selectAutomatically(stage) {
    const decisionType = STAGE_DECISIONS[stage.key];
    const snapshot = record(automationState.snapshot);
    const jobId = text(projection.registration.jobId);
    const localFactoryJob = jobId.startsWith('factory-job-');
    if (!decisionType || !jobId || (!localFactoryJob && snapshot.locked !== true)) return;
    await submitSelection(stage, null, 'auto');
  }

  const automaticScheduler = createAutomaticSelectionScheduler({
    submit: (stage, mode) => submitSelection(stage, null, mode),
  });

  function scheduleAutomaticSelection() {
    const jobId = text(projection.registration.jobId);
    const localFactoryJob = jobId.startsWith('factory-job-');
    const localJob = productJobs.find(job => text(job.jobId) === jobId);
    const waitingStage = projection.stages.find(stage => stage.key === localJob?.stageKey);
    if (
      localFactoryJob
      && resolveLocalFactoryStageMode(projection, productJobs, waitingStage?.key) === 'auto'
      && localJob?.status === 'waiting_manual'
      && waitingManualJobAction(localJob, waitingStage) === 'resume'
      && !automaticDecisionHeld(localJob, waitingStage.key)
    ) return resumeFactoryJob(jobId);
    return automaticScheduler({
      projection,
      workBundle,
      policySnapshot: localFactoryJob ? { locked: true } : automationState.snapshot,
      localJob,
      isAutomatic: stage => (
        localFactoryJob
          ? resolveLocalFactoryStageMode(projection, productJobs, stage.key) === 'auto'
            && !automaticDecisionHeld(localJob, stage.key)
          : effectiveDecision(STAGE_DECISIONS[stage.key]).mode === 'auto'
      ),
    });
  }

  function renderInspector() {
    const root = roots.inspector;
    const current = viewedProjection();
    if (archivedJobId) {
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    root.replaceChildren();
    const stage = selectedStage(current, selectedStageKey);
    const candidate = stage?.candidates.find(item => item.id === inspectedCandidateId)
      || stage?.candidates.find(item => item.id === stage.selectedId)
      || stage?.candidates[0]
      || null;
    root.append(element('p', 'eyebrow', '후보 근거'), element('h3', '', '후보 근거와 선택'));
    if (!candidate) {
      root.append(element('p', 'factory-empty-state', current.connected ? '확인할 후보가 없습니다.' : '조립공장 연결 끊김'));
      return;
    }
    // 어느 컷의 근거인지 먼저 보여 준다. 값만 늘어놓으면 무엇을 보고 있는지 알 수 없다.
    const heading = element('div', 'factory-inspector-subject');
    const shot = resolveCandidateThumbnail(candidate, assetUrl);
    if (shot.kind === 'image') {
      const preview = element('img', 'factory-inspector-shot');
      preview.src = shot.url;
      preview.alt = `${STAGE_LABELS[stage.key]} 후보 ${candidate.id}`;
      preview.loading = 'lazy';
      preview.decoding = 'async';
      heading.append(preview);
    }
    const naming = element('div', 'factory-inspector-naming');
    naming.append(
      element('span', 'factory-pill', STAGE_LABELS[stage.key] || stage.key),
      element('strong', '', candidate.id),
    );
    if (stage.selectedId === candidate.id) {
      naming.append(element('span', 'factory-pill selected-badge', '선택컷'));
    }
    heading.append(naming);
    root.append(heading);
    const fields = element('dl', 'factory-inspector-fields');
    const decisionType = STAGE_DECISIONS[stage.key];
    const effective = effectiveDecision(decisionType);
    const jobId = text(current.registration.jobId);
    const localFactoryJob = jobId.startsWith('factory-job-');
    const automatic = localFactoryJob
      ? resolveLocalFactoryStageMode(projection, productJobs, stage.key) === 'auto'
      : effective.mode === 'auto';
    const localJob = productJobs.find(job => text(job.jobId) === jobId);
    const automaticHeld = automatic && (localJob?.status === 'completed' || automaticDecisionHeld(localJob, stage.key));
    fields.append(
      labelledValue('생성 출처', candidate.source, 'source'),
      labelledValue('판단 모델', candidate.model, 'model'),
      labelledValue('판단 점수', candidate.confidence === null ? '' : candidate.confidence, 'confidence'),
      labelledValue('선택 이유', candidate.rationale, 'rationale'),
      labelledValue('갱신', stage.updatedAt, 'updated-at'),
      labelledValue(
        '자동화',
        `${statusLabel(automatic ? 'auto' : 'manual')} · ${localFactoryJob ? '현재 제품 설정' : policySourceLabel(effective.source)}`,
        'automation-policy',
      ),
    );
    root.append(fields);
    const visibleReceipt = (
      record(lastAutomationReceipt).decisionType === decisionType
        ? lastAutomationReceipt
        : candidate.receipt
    );
    if (visibleReceipt) root.append(element('p', 'status-message', '조립공장 선택 저장 기록이 확인됐습니다.'));
    const result = element('p', 'status-message');
    result.setAttribute('role', 'status');
    const saving = stageSaving(stage.key);
    if (saving?.candidateId === candidate.id || saving?.candidateId === 'oauth-pending') {
      result.textContent = '선택 결과를 조립공장 작업파일에 저장하는 중입니다.';
    } else if (stage.selectedId === candidate.id) {
      result.textContent = `선택 완료 · 저장 차수 ${current.session.revision}`;
      result.dataset.tone = 'ok';
    } else {
      result.textContent = '보기 상태 · 아직 A컷으로 선택하지 않음';
    }
    const actions = element('div', 'button-row inspector-actions');
    const select = element('button', '', saving ? '저장 중' : automaticHeld ? '이 후보를 수동 선택' : automatic ? '자동 판단 ON' : 'A컷 선택');
    select.type = 'button';
    select.dataset.action = 'select-a-cut';
    select.disabled = !current.connected
      || !viewMatchesLiveProjection()
      || Boolean(saving)
      || stage.selectedId === candidate.id
      || (!localFactoryJob && resolveCandidateAsset(candidate, workBundle.assets, stage.key).status !== 'matched')
      || (automatic && !localFactoryJob && record(automationState.snapshot).locked !== true);
    select.addEventListener('click', () => (
      automatic && !automaticHeld ? void selectAutomatically(stage) : void selectACut(stage, candidate)
    ));
    const next = element('button', 'button-secondary', '다음 미결정');
    next.type = 'button';
    next.dataset.action = 'next-unresolved';
    const unresolved = unresolvedStage(current, stage.key);
    next.disabled = !unresolved || (automatic && !heldDecisions.has(decisionType));
    next.addEventListener('click', () => {
      if (!unresolved) return;
      selectedStageKey = unresolved.key;
      inspectedCandidateId = unresolved.candidates[0]?.id || '';
      candidatePage = 0;
      rememberActiveTabView();
      render();
      roots.candidates.querySelector('button')?.focus();
    });
    actions.append(select, next);
    root.append(actions, result);
  }

  function registrationStatus() {
    if (cafe24RegistrationSummary(projection.registration, projection.session, approval.receipt).registered) return 'staged_verified';
    if (text(projection.registration.status) === 'staged_verified') return 'staged_pending_readback';
    if (approval.status === 'executing') return 'executing';
    if (approval.token) return 'approval_required';
    return text(projection.registration.status || 'blocked');
  }

  async function runPreflight() {
    try {
      const result = await apiRequest('/api/cafe24/preflight', { method: 'POST', body: '{}' });
      registrationMessage = `${statusLabel(result.status)} · ${text(result.reason) || 'factory preflight 응답 수신'}`;
    } catch (error) {
      registrationMessage = `사전점검 실패 · ${error.message}`;
    }
    renderRegistration();
  }

  async function requestApproval() {
    try {
      const payload = buildCafe24StagingPayload(projection);
      const preview = await apiRequest('/api/cafe24/staging-preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      approval = { preview, token: '', status: 'approval_required', receipt: null };
      registrationTargetConfirmed = false;
      registrationMessage = `일회 승인 대상 고정 · ${preview.approvalRequestId}`;
    } catch (error) {
      registrationMessage = `승인 대상 생성 실패 · ${error.message}`;
    }
    renderRegistration();
  }

  async function approveTarget() {
    try {
      const binding = approvalBinding(approval.preview);
      const result = await apiRequest('/api/cafe24/approve', {
        method: 'POST',
        body: JSON.stringify({
          approvalRequestId: approval.preview.approvalRequestId,
          approved: true,
          ...binding,
        }),
      });
      approval = { ...approval, token: result.approvalToken, status: 'approved' };
      registrationMessage = '일회 승인 완료 · 실행 전 최종 확인 필요';
    } catch (error) {
      registrationMessage = `승인 실패 · ${error.message}`;
    }
    renderRegistration();
  }

  async function executeRegistration(confirmInput) {
    registrationTargetConfirmed = confirmInput.checked;
    if (!approval.token || !registrationTargetConfirmed) return;
    const jobId = text(projection.registration.jobId);
    if (!jobId) {
      registrationMessage = '등록 실행 차단 · job_id 없음';
      renderRegistration();
      return;
    }
    approval = { ...approval, status: 'executing' };
    renderRegistration();
    try {
      const binding = approvalBinding(approval.preview);
      const confirmation = await apiRequest('/api/cafe24/confirm', {
        method: 'POST',
        body: JSON.stringify({
          approvalToken: approval.token,
          confirmed: true,
          ...binding,
        }),
      });
      const result = await apiRequest('/api/cafe24/publish', {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          approvalToken: approval.token,
          confirmationNonce: confirmation.confirmationNonce,
          ...binding,
        }),
      });
      approval = {
        ...approval,
        token: '',
        status: text(result.status || 'staged_verified'),
        receipt: result.publicationReceipt || result,
      };
      registrationTargetConfirmed = false;
      registrationMessage = 'Cafe24 등록 검증 완료 · 등록 결과 재확인 영수증 확인';
    } catch (error) {
      approval = { ...approval, token: '', status: 'failed' };
      registrationTargetConfirmed = false;
      registrationMessage = `Cafe24 등록 실패 · ${error.message}`;
    }
    renderRegistration();
  }

  async function reconcileRegistration() {
    const registration = record(projection.registration);
    const jobId = text(registration.jobId);
    if (!jobId) return;
    approval = { ...approval, status: 'executing' };
    registrationMessage = 'Cafe24 재등록 없이 원격 결과 재확인 중';
    renderRegistration();
    try {
      const payload = buildCafe24StagingPayload(projection);
      const preview = await apiRequest('/api/cafe24/staging-preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const result = await apiRequest('/api/cafe24/reconcile', {
        method: 'POST',
        body: JSON.stringify({ jobId, payloadDigest: preview.payloadDigest, ...payload }),
      });
      approval = {
        preview,
        token: '',
        status: text(result.status || 'staged_verified'),
        receipt: result.publicationReceipt || result,
      };
      registrationMessage = 'Cafe24 등록 검증 완료 · 재등록 없이 원격 결과 재확인';
    } catch (error) {
      approval = { ...approval, status: 'failed' };
      registrationMessage = `Cafe24 결과 재확인 실패 · ${error.message}`;
    }
    renderRegistration();
  }

  function externalLink(label, href) {
    const link = element('a', 'button-secondary ledger-link', label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  function renderWorkfileReportLedger() {
    const root = roots.ledger;
    const registration = record(projection.registration);
    const ledger = buildWorkfilePublicationLedger(projection, approval.receipt, workBundleHistory);
    const publication = ledger.publication;
    root.replaceChildren();
    root.dataset.workfileState = ledger.workfileConnected ? 'connected' : 'missing';
    root.dataset.cafe24State = publication.productNo ? 'registered' : 'unconfirmed';

    const heading = element('div', 'status-row');
    heading.append(
      element('h3', '', '작업파일 ↔ Cafe24 인계 요약'),
      element('span', 'factory-pill', publication.productNo ? '등록 상품 확인됨' : '등록 영수증 확인 필요'),
    );
    const fields = element('dl', 'factory-sync-fields handoff-ledger-fields');
    fields.append(
      labelledValue(
        ledger.workfileExact ? '.kuasangse 작업파일' : ledger.workfileName ? '완료 이력 폴더' : '작업파일·이력',
        ledger.workfileName || '연결된 파일 없음',
        'handoff-workfile-name',
      ),
      labelledValue('작업파일 근거', ledger.workfileSource, 'handoff-workfile-source'),
      labelledValue('파일 생성 방식', ledger.creationMode, 'handoff-workfile-creation'),
      labelledValue('제품명', publication.productName || ledger.productKey, 'handoff-product-name'),
      labelledValue('Cafe24 상품', publication.productNo ? `#${publication.productNo}` : '등록 영수증 없음', 'handoff-cafe24-product'),
      labelledValue('Cafe24 상품코드', publication.productCode, 'handoff-cafe24-code'),
      labelledValue('작업 범위', [ledger.workspaceId, ledger.runId ? `run ${ledger.runId}` : '', `저장 차수 ${ledger.revision}`].filter(Boolean).join(' · '), 'handoff-scope'),
      labelledValue('원격 결과', publication.productNo ? `${publication.representativeImageCount || 0}장 대표 · ${publication.detailImageCount || 0}장 상세 · ${publication.variantCount || 0}개 옵션` : '원격 read-back 없음', 'handoff-readback'),
    );
    root.append(heading, fields);

    const message = element(
      'p',
      'status-message handoff-ledger-message',
      ledger.workfileExact
        ? `${ledger.workfileName} 연결을 확인했습니다. ${ledger.creationMode}.`
        : ledger.workfileConnected
          ? `${ledger.workfileName} 완료 이력 폴더만 확인했습니다. 실제 .kuasangse 파일명·경로와 생산관제 자동 새 작업 생성 기록은 없습니다.`
        : '생산관제 투입 시 제품명으로 새 .kuasangse를 자동 생성한 기록이 없습니다. Cafe24 등록 전에 작업파일을 연결하고 저장 결과를 확인해야 합니다.',
    );
    message.dataset.tone = ledger.workfileExact ? 'ok' : 'error';
    root.append(message);

    const actions = element('div', 'button-row handoff-ledger-actions');
    const chooseWorkfile = element('button', 'button-secondary', '작업파일 선택 창 열기');
    chooseWorkfile.type = 'button';
    chooseWorkfile.addEventListener('click', () => document.getElementById('workfile-input')?.click());
    const openCafe24Panel = element('button', 'button-secondary', 'Cafe24 등록 목록 보기');
    openCafe24Panel.type = 'button';
    openCafe24Panel.addEventListener('click', () => openMenu('cafe24'));
    actions.append(chooseWorkfile, openCafe24Panel);
    if (publication.storefrontUrl) actions.append(externalLink('Cafe24 상품 바로가기', publication.storefrontUrl));
    if (publication.adminUrl) actions.append(externalLink('Cafe24 관리자 바로가기', publication.adminUrl));
    const jobId = firstText(publication.jobId, registration.jobId, activeProductJob()?.jobId);
    const currentJob = productJobs.find(job => text(job.jobId) === jobId);
    if (jobId && currentJob?.checkpointAvailable) {
      const history = element('button', 'button-secondary', '입력·출력·선택 이력 보기');
      history.type = 'button';
      history.addEventListener('click', () => void loadHistoricalWorkBundle(jobId));
      actions.append(history);
    }
    root.append(actions);

    const listHeading = element('div', 'handoff-ledger-list-heading');
    listHeading.append(
      element('h4', '', 'Cafe24 등록 목록'),
      element('span', 'factory-pill', `${ledger.publications.length}건`),
    );
    root.append(listHeading);
    const listRoot = element('div', 'publication-ledger-list');
    if (!ledger.publications.length) {
      listRoot.append(element('p', 'factory-empty-state', '현재 생산관제 세션에서 확인된 Cafe24 등록 영수증이 없습니다. 등록 상태가 완료여도 원격 상품번호와 영수증이 없으면 등록 목록에 넣지 않습니다.'));
    } else {
      for (const item of ledger.publications) {
        const card = element('article', 'publication-ledger-item');
        const title = element('div', 'publication-ledger-title');
        title.append(
          element('strong', '', item.productName || '상품명 미확인'),
          element('span', 'factory-pill', `#${item.productNo}`),
        );
        card.append(
          title,
          element('p', 'status-message', `${item.productCode || '상품코드 없음'} · ${item.sourceWorkfileName || ledger.workfileName || '작업파일명 미기록'}`),
        );
        const links = element('div', 'button-row');
        if (item.storefrontUrl) links.append(externalLink('상품 바로가기', item.storefrontUrl));
        if (item.adminUrl) links.append(externalLink('관리자 바로가기', item.adminUrl));
        card.append(links);
        listRoot.append(card);
      }
    }
    root.append(listRoot);
  }

  function renderCanonicalCafe24Registration(root, {
    registration,
    session,
    approvalState,
    connected,
    readOnly = false,
    handlers = null,
    message = '',
  }) {
    const approval = record(approvalState);
    const publication = cafe24RegistrationSummary(registration, session, approval.receipt);
    if (!readOnly && !handlers) throw new Error('cafe24_live_handlers_required');
    const {
      runPreflight,
      requestApproval,
      approveTarget,
      executeRegistration,
      reconcileRegistration,
      getRegistrationTargetConfirmed,
      setRegistrationTargetConfirmed,
    } = record(handlers);
    let registrationTargetConfirmed = readOnly ? false : getRegistrationTargetConfirmed();
    const unknown = readOnly ? '미확인' : '';
    const blockers = list(registration.blockers).map(registrationBlockerLabel).filter(Boolean);
    root.replaceChildren();
    const status = publication.registered
      ? 'staged_verified'
      : approval.status === 'executing'
        ? 'executing'
        : approval.token
          ? 'approval_required'
          : text(registration.status) === 'staged_verified'
            ? 'staged_pending_readback'
            : text(registration.status || 'blocked');
    root.dataset.status = status;
    const heading = element('div', 'status-row');
    heading.append(element('h3', '', 'Cafe24 등록'), element('span', 'factory-pill', statusLabel(status)));
    const fields = element('dl', 'factory-sync-fields registration-fields');
    const cafe24RegistrationLabel = cafe24RegistrationTargetLabel(registration, session) || unknown;
    fields.append(
      labelledValue('Cafe24 등록 방식', publication.registrationMode || (publication.registered ? cafe24RegistrationLabel : '원격 영수증 확인 전'), 'product-id'),
      labelledValue('제품명', registration.productKey || session.productKey || unknown, 'product-key'),
      labelledValue('Cafe24 상품번호', publication.productNo ? `#${publication.productNo}` : '등록 영수증 없음', 'remote-product-no'),
      labelledValue('Cafe24 상품코드', publication.productCode || unknown, 'remote-product-code'),
      labelledValue('Cafe24 상품분류', registration.categoryLabel || registration.categoryId || unknown, 'category-id'),
      labelledValue('상세페이지', publication.registered ? `${publication.detailImageCount}장 원격 확인` : '원격 영수증 확인 전', 'html-digest'),
      labelledValue('등록 이미지', publication.registered ? `${publication.representativeImageCount}장 원격 확인` : '원격 영수증 확인 전', 'image-digests'),
      labelledValue(
        '옵션 구성',
        publication.registered && list(registration.optionValues).length
          ? `${text(registration.optionName) || '색상'} · ${list(registration.optionValues).length}개 · ${list(registration.optionValues).map(text).join(', ')}`
          : Array.isArray(registration.optionValues) ? '옵션 없음' : unknown,
        'option-values',
      ),
      labelledValue(
        '품목별 재고',
        publication.registered && list(registration.optionValues).length
          ? `${Number(registration.variantCount || 0)}개 품목 · 각 ${text(registration.inventoryQuantity) || '99'}`
          : Array.isArray(registration.optionValues) ? '해당 없음' : unknown,
        'variant-inventory',
      ),
      labelledValue('등록 직후 상태', publication.registered ? '원격 영수증 확인됨' : '원격 영수증 확인 전', 'safe-defaults'),
      labelledValue('일회 승인', approval.token ? '승인됨' : statusLabel(registration.approvalTokenState || approval.status) || unknown, 'approval-state'),
      labelledValue('Cafe24 재확인', publication.registered ? '등록 결과 재확인 완료' : '원격 read-back 대기', 'readback'),
    );
    root.append(heading, fields);
    const blockerList = element('ul', 'registration-blockers');
    blockerList.dataset.blockerCount = String(blockers.length);
    if (blockers.length) {
      for (const blocker of blockers) blockerList.append(element('li', '', blocker));
    } else {
      blockerList.append(element('li', '', '필수값과 모든 단계 선택 결과가 확정되었습니다.'));
    }
    root.append(blockerList);
    const actions = element('div', 'button-row registration-actions');
    const preflight = element('button', 'button-secondary', '사전점검');
    preflight.type = 'button';
    preflight.disabled = !connected;
    const preview = element('button', 'button-secondary', '승인 대상 만들기');
    preview.type = 'button';
    preview.disabled = !connected || blockers.length > 0;
    const approve = element('button', 'button-secondary', '일회 승인');
    approve.type = 'button';
    approve.disabled = !approval.preview || Boolean(approval.token);
    const confirmLabel = element('label', 'registration-confirm');
    const confirmInput = element('input');
    confirmInput.type = 'checkbox';
    confirmInput.checked = registrationTargetConfirmed;
    confirmInput.disabled = readOnly;
    confirmLabel.append(confirmInput, document.createTextNode(' 고정된 대상 1건 실행 확인'));
    const execute = element('button', 'button-danger', 'Cafe24 등록 실행');
    execute.type = 'button';
    execute.disabled = !approval.token || !registrationTargetConfirmed || !text(registration.jobId);
    if (readOnly) {
      preflight.disabled = true;
      preview.disabled = true;
      approve.disabled = true;
      execute.disabled = true;
    }
    if (!readOnly) {
      preflight.dataset.action = 'cafe24-preflight';
      preflight.addEventListener('click', () => void runPreflight());
      preview.dataset.action = 'cafe24-preview';
      preview.addEventListener('click', () => void requestApproval());
      approve.dataset.action = 'cafe24-approve';
      approve.addEventListener('click', () => void approveTarget());
      confirmInput.dataset.action = 'confirm-cafe24-target';
      confirmInput.addEventListener('change', () => {
        registrationTargetConfirmed = confirmInput.checked;
        setRegistrationTargetConfirmed(confirmInput.checked);
        execute.disabled = !approval.token || !registrationTargetConfirmed || !text(registration.jobId);
      });
      execute.dataset.action = 'cafe24-execute';
      execute.addEventListener('click', () => void executeRegistration(confirmInput));
    }
    actions.append(preflight, preview, approve, confirmLabel, execute);
    if (publication.storefrontUrl) actions.append(externalLink('등록 상품 바로가기', publication.storefrontUrl));
    if (publication.adminUrl) actions.append(externalLink('Cafe24 관리자 바로가기', publication.adminUrl));
    if (text(registration.status) === 'staged_verified' && !publication.registered) {
      const reconcile = element('button', 'button-secondary', '등록 결과 재확인 · 재등록 없음');
      reconcile.type = 'button';
      reconcile.disabled = !connected || blockers.length > 0 || !text(registration.jobId) || approval.status === 'executing';
      if (readOnly) reconcile.disabled = true;
      else {
        reconcile.dataset.action = 'cafe24-reconcile';
        reconcile.addEventListener('click', () => void reconcileRegistration());
      }
      actions.append(reconcile);
    }
    root.append(actions);
    const statusMessage = element('p', 'status-message', message || (
      blockers.length ? `차단 사유 ${blockers.length}개` : '사전점검 준비 완료 · 등록에는 일회 승인이 필요합니다.'
    ));
    statusMessage.setAttribute('role', 'status');
    root.append(statusMessage);
  }

  function renderRegistration() {
    const root = roots.registration;
    const registration = record(projection.registration);
    const nextRenderKey = JSON.stringify([
      projection.connected,
      registration,
      approval.status,
      text(approval.preview?.approvalRequestId),
      Boolean(approval.token),
      Boolean(approval.receipt),
      registrationMessage,
    ]);
    if (root.childElementCount && registrationRenderKey === nextRenderKey) return;
    registrationRenderKey = nextRenderKey;
    renderCanonicalCafe24Registration(root, {
      registration,
      session: projection.session,
      approvalState: approval,
      connected: projection.connected,
      handlers: {
        runPreflight,
        requestApproval,
        approveTarget,
        executeRegistration,
        reconcileRegistration,
        getRegistrationTargetConfirmed: () => registrationTargetConfirmed,
        setRegistrationTargetConfirmed: value => { registrationTargetConfirmed = value; },
      },
      message: registrationMessage,
    });
  }

  function renderQueue() {
    if (fixtureMode) return;
    const root = roots.queue;
    if (root.contains(document.activeElement)) return;
    root.replaceChildren();
    const filteredJobs = productJobs.filter(job => queueFilterMatches(job, queueFilter));
    const focusJobId = text(workfileTabs.active()?.jobId || activeProductJob()?.jobId);
    const projectionJobId = text(projection.registration.jobId);
    if (roots.queueTotal) roots.queueTotal.replaceChildren(document.createTextNode(
      queueFilter === 'all' ? `${productJobs.length || projection.products.length}건` : `${filteredJobs.length}/${productJobs.length}건`,
    ));
    if (productJobs.length) {
      for (const job of filteredJobs) {
        const index = productJobs.indexOf(job);
        const jobId = text(job.jobId);
        const queueRow = buildOperatorQueueRow(job, index);
        const queueState = operatorQueueState(job);
        const linkedTab = workfileTabs.snapshot().tabs.find(tab => tab.jobId === jobId && tab.linkState === 'linked');
        const jobMessage = linkedTab && job.status === 'blocked'
          ? '승인 파일 연결 완료 · 작업 재개 대기'
          : visibleFactoryMessage(job.message, job.stageKey);
        const row = element('article', 'operator-job-row');
        row.dataset.jobId = text(job.jobId);
        row.dataset.status = text(job.status);
        row.dataset.current = String(jobId === focusJobId);
        row.dataset.needsSelection = String(queueRow.needsSelection);
        row.dataset.justCreated = String(recentlyCreatedJobIds.has(jobId));
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${text(job.productName || job.jobId)} 작업 보기 · ${queueRow.stageLabel} · ${queueState.label}`);
        const activateRow = () => activateWorkfileTab(`job:${jobId}`);
        row.addEventListener('click', event => {
          if (event.target?.closest?.('button, a')) return;
          activateRow();
        });
        row.addEventListener('keydown', event => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          activateRow();
        });
        const main = element('div', 'operator-job-main');
        const title = element('div', 'operator-job-title');
        title.append(
          element('strong', '', text(job.productName || job.jobId)),
          element('span', 'factory-pill', queueState.label),
        );
        const projectedSourceImage = jobId === projectionJobId
          ? list(projection.inputs.find(input => input.key === 'source_images')?.items)[0]?.thumbnailUrl
          : '';
        const bundleSourceImage = jobId === projectionJobId
          ? workBundle.assets.find(asset => asset.phase === 'input')?.thumbnailReference
          : '';
        const thumbnail = resolveCandidateThumbnail({
          thumbnailUrl: firstText(projectedSourceImage, bundleSourceImage),
        }, assetUrl);
        const thumb = element('span', 'operator-job-thumb');
        thumb.setAttribute('role', 'img');
        if (thumbnail.kind === 'image') {
          thumb.setAttribute('aria-label', `${text(job.productName || job.jobId)} 제품 이미지`);
          const image = element('img');
          image.src = thumbnail.url;
          image.alt = '';
          thumb.append(image);
        } else {
          const initials = text(job.productName || job.workfileName || job.jobId).replace(/\s+/gu, '').slice(0, 2) || '제품';
          thumb.setAttribute('aria-label', `${text(job.productName || job.jobId)} 제품 이미지 없음`);
          thumb.append(document.createTextNode(initials));
        }
        const progress = jobId === projectionJobId
          ? Number(projection.progress.percent || 0)
          : Math.round((Number.parseInt(queueRow.stepLabel, 10) / 8) * 100);
        const source = job.sourceKind === 'sinhwa-db'
          ? `신화사 DB · 품번 ${text(job.jcode) || '없음'}`
          : `직접 입력 · 이미지 ${Number(job.imageCount || 0)}장`;
        main.append(
          title,
          element('p', 'status-message', `${source} · ${queueRow.stepLabel} · ${queueRow.modeLabel}`),
          element('p', 'status-message', `${queueRow.stageLabel} · 진행률 ${Math.max(0, Math.min(100, progress))}% · ${queueState.label}${jobMessage ? ` · ${jobMessage}` : ''}`),
        );
        row.append(element('span', 'operator-job-index', queueRow.orderLabel), thumb, main);

        const actions = element('div', 'operator-job-actions');
        if (job.status === 'waiting_manual') {
          if (jobId === projectionJobId) {
            const stage = projection.stages.find(item => item.key === job.stageKey);
            const selected = Boolean(stage?.selectedId);
            const actionKind = waitingManualJobAction(job, stage);
            const automaticHeld = automaticDecisionHeld(job, job.stageKey);
            const stageMode = resolveLocalFactoryStageMode(projection, productJobs, job.stageKey);
            const action = element(
              'button',
              'button-secondary',
              automaticHeld
                ? 'GPT 보류 · 수동 선택'
                : stageMode === 'auto'
                  ? '자동 판단 상태 열기'
                  : (selected ? '다음 단계 실행' : queueRow.actionLabel),
            );
            action.type = 'button';
            action.addEventListener('click', () => (actionKind === 'resume'
              ? void resumeFactoryJob(job.jobId)
              : openFactoryStage(job.stageKey || projection.progress.stageKey)));
            actions.append(action);
          }
        } else if (job.status === 'blocked' && (jobId === projectionJobId || job.checkpointAvailable)) {
          if (job.checkpointAvailable) {
            const historyAction = element('button', 'button-secondary', '입력·출력·선택 보기');
            historyAction.type = 'button';
            historyAction.dataset.action = 'open-blocked-history';
            historyAction.addEventListener('click', () => void loadHistoricalWorkBundle(job.jobId));
            actions.append(historyAction);
          }
          if (jobId === projectionJobId) {
            const action = element('button', 'button-secondary', '같은 상태로 다시 실행');
            action.type = 'button';
            action.addEventListener('click', () => void resumeFactoryJob(job.jobId));
            actions.append(action);
          }
        } else if (job.status === 'running' && jobId === projectionJobId) {
          const action = element('button', 'button-secondary', '현재 공정 열기');
          action.type = 'button';
          action.addEventListener('click', () => openFactoryStage(job.stageKey || projection.progress.stageKey));
          actions.append(action);
        } else if (job.status === 'completed' && jobId === projectionJobId) {
          if (job.checkpointAvailable) {
            const historyAction = element('button', 'button-secondary', '입력·출력·선택 보기');
            historyAction.type = 'button';
            historyAction.dataset.action = 'open-completed-history';
            historyAction.addEventListener('click', () => void loadHistoricalWorkBundle(job.jobId));
            actions.append(historyAction);
          }
          const restoreCheckpoint = text(projection.registration.status) === 'blocked' && job.checkpointAvailable;
          const action = element('button', 'button-secondary', restoreCheckpoint ? '체크포인트 복원' : 'Cafe24 확인');
          action.type = 'button';
          action.dataset.action = restoreCheckpoint ? 'restore-completed-factory-job' : 'open-cafe24';
          action.addEventListener('click', () => (restoreCheckpoint
            ? void resumeFactoryJob(job.jobId)
            : openFactoryStage('cafe24')));
          actions.append(action);
        } else if (job.status === 'completed' && job.checkpointAvailable) {
          const historyAction = element('button', 'button-secondary', '입력·출력·선택 보기');
          historyAction.type = 'button';
          historyAction.dataset.action = 'open-completed-history';
          historyAction.addEventListener('click', () => void loadHistoricalWorkBundle(job.jobId));
          actions.append(historyAction);
        }
        if (actions.childElementCount) row.append(actions);
        root.append(row);
      }
      if (!filteredJobs.length) {
        const empty = element('article', 'operator-empty-state');
        empty.append(
          element('strong', '', '이 조건에 맞는 제품이 없습니다'),
          element('p', 'status-message', '다른 상태 필터를 선택하면 전체 작업을 다시 볼 수 있습니다.'),
        );
        root.append(empty);
      }
      root.dataset.apiTotal = String(productJobs.length);
      root.dataset.apiRendered = String(filteredJobs.length);
      return;
    }
    const products = projectQueueProducts(projection);
    for (const product of products.slice(0, 15)) {
      const row = element('article', 'operator-job-row');
      row.dataset.productId = text(product.productId);
      row.dataset.current = String(text(product.productId) === text(projection.session.productId));
      const productProgress = record(product.progress);
      const main = element('div', 'operator-job-main');
      const title = element('div', 'operator-job-title');
      title.append(
        element('strong', '', text(product.productKey || product.productId)),
        element('span', 'factory-pill', statusLabel(productProgress.status || projection.status)),
      );
      main.append(title, element('p', 'status-message', `${text(productProgress.stageLabel || productProgress.stageKey)} · ${Number(productProgress.percent || 0)}% · ${elapsedLabel(productProgress.elapsedMs)}`));
      row.append(element('span', 'operator-job-index', '01'), main);
      root.append(row);
    }
    if (!products.length) {
      const empty = element('article', 'operator-empty-state');
      empty.append(
        element('strong', '', queueApiError ? '작업 큐를 불러오지 못했습니다' : '대기 중인 제품이 없습니다'),
        element('p', 'status-message', queueApiError ? `작업 큐 조회 실패 · ${queueApiError}` : '신화사 DB 제품을 선택하거나 신규 제품 자료를 직접 입력하세요.'),
      );
      const action = element('button', '', '제품 투입 열기');
      action.type = 'button';
      action.addEventListener('click', () => openFactoryStage('db'));
      empty.append(action);
      root.append(empty);
    }
    root.dataset.apiTotal = String(products.length);
    root.dataset.apiRendered = String(Math.min(products.length, 15));
  }

  for (const button of roots.queueFilters) {
    button.addEventListener('click', () => {
      queueFilter = text(button.dataset.queueFilter) || 'all';
      for (const item of roots.queueFilters) item.setAttribute('aria-pressed', String(item === button));
      renderQueue();
    });
  }

  function render() {
    if (roots.resultWorkspace) roots.resultWorkspace.dataset.historyActive = String(Boolean(archivedJobId));
    renderWorkfileTabs();
    renderSyncBar();
    renderProductProgress();
    renderOverviewSummary();
    renderStageSubnav();
    renderProgressMap();
    renderCandidates();
    renderWorkBundleAssets(roots.bundleInputs, 'input', workBundleInputPage);
    renderWorkBundleAssets(roots.bundleOutputs, 'output', workBundleOutputPage);
    renderInspector();
    renderWorkfileReportLedger();
    renderRegistration();
    renderCompetitors();
    renderAuditSummary();
    renderQueue();
    renderQueueSelectionWorkbench();
  }

  async function refreshState() {
    try {
      const next = await apiRequest(`/api/factory/state${fixtureCount ? `?fixtureCount=${fixtureCount}` : ''}`);
      factoryApiError = '';
      const snapshotCursor = text(next.eventCursor);
      if (snapshotCursor && (!factoryEventCursor || Number(snapshotCursor) >= Number(factoryEventCursor))) {
        factoryEventCursor = snapshotCursor;
      }
      setProjection(next);
      if (!selectedStageKey) selectedStageKey = projection.stages[0]?.key || '';
      syncTransport = projection.connected ? syncTransport : 'reconnecting';
      render();
    } catch (error) {
      factoryApiError = text(error.code || error.message || 'factory_state_unavailable');
      if (!projection.connected) setProjection(disconnectedFactoryProjection(factoryApiError));
      syncTransport = 'reconnecting';
      render();
    }
  }

  async function refreshQueue() {
    try {
      const result = await apiRequest('/api/factory/jobs');
      const next = reconcileOperatorQueueRefresh(productJobs, result);
      productJobs = next.jobs;
      queueApiError = next.error;
    } catch (error) {
      const next = reconcileOperatorQueueRefresh(
        productJobs,
        null,
        text(error.code || error.message || 'factory_queue_unavailable'),
      );
      productJobs = next.jobs;
      queueApiError = next.error;
    }
    render();
    void scheduleAutomaticSelection();
  }

  const refreshAfterEventError = coalesceRefreshState(refreshState);
  const recoverEventStream = coalesceRefreshState(async () => {
    let renewed = false;
    try {
      await acquireControlSession({ assetUrl });
      renewed = true;
    } catch {}
    await refreshAfterEventError();
    if (renewed && !stopped) connectEvents(true);
  });

  async function resumeFactoryJob(jobId) {
    const key = text(jobId);
    if (!key || resumeInFlight.has(key)) return;
    const job = productJobs.find(item => text(item.jobId) === key);
    const checkpointProjection = text(projection.registration.jobId) === key
      ? projection
      : workfileTabs.projectionFor(`job:${key}`);
    if (!job || !checkpointProjection) {
      setStatus('live-status', '저장된 checkpoint 신원을 확인할 수 없습니다. 작업파일을 다시 선택해 주세요.', 'error');
      return;
    }
    resumeInFlight.add(key);
    try {
      const payload = buildFactoryResumePayload({
        job,
        projection: checkpointProjection,
        imageModel: text(document.getElementById('image-model-select')?.value),
      });
      const result = await apiRequest(`/api/factory/jobs/${encodeURIComponent(key)}/resume`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const next = result.job;
      if (next) productJobs = productJobs.map(job => job.jobId === next.jobId ? next : job);
      setStatus('live-status', `${text(next?.productName || key)} · 재개 요청 접수 · 저장된 작업 상태 확인 중`, 'warning');
    } catch (error) {
      setStatus('live-status', `다음 단계 실행 실패 · ${aCutSaveFailureCopy(error)}`, 'error');
    } finally {
      resumeInFlight.delete(key);
      if (roots.queue?.contains(document.activeElement)) document.activeElement.blur();
      await Promise.allSettled([refreshState(), refreshQueue()]);
    }
  }

  function consumeFactoryEvent(event) {
    if (stopped) return;
    try {
      const accepted = applyFactorySseMessage(projection, factoryEventCursor, event);
      if (accepted.job) {
        const incoming = accepted.job;
        const index = productJobs.findIndex(job => job.jobId === incoming.jobId);
        productJobs = index < 0
          ? [...productJobs, incoming]
          : productJobs.map((job, jobIndex) => jobIndex === index ? incoming : job);
      }
      setProjection(accepted.projection);
      factoryEventCursor = accepted.factoryEventCursor;
      lastEventAt = new Date().toISOString();
      syncTransport = 'live';
      render();
    } catch (error) {
      if (!(error instanceof FactorySyncConflict)) setStatus('live-status', `factory event 해석 실패 · ${error.message}`, 'error');
    }
  }

  function consumeCheckpointRebound(event) {
    consumeFactoryEvent(event);
    void Promise.allSettled([refreshState(), refreshQueue()]);
  }

  function connectEvents(force = false) {
    if (force) eventSource?.close?.();
    if (document.hidden) {
      eventSource = null;
      syncTransport = 'reconnecting';
      renderSyncBar();
      return;
    }
    if (document.getElementById('production-board')) {
      window.clearInterval(fallbackTimer);
      fallbackTimer = window.setInterval(() => {
        void Promise.allSettled([refreshState(), refreshQueue()]);
      }, 2000);
      renderSyncBar();
      return;
    }
    if (typeof EventSourceImpl !== 'function') {
      syncTransport = 'reconnecting';
      window.clearInterval(fallbackTimer);
      fallbackTimer = window.setInterval(() => void refreshState(), 2000);
      render();
      return;
    }
    eventSource = new EventSourceImpl(assetUrl(factoryEventsUrl(factoryEventCursor)), { withCredentials: true });
    eventSource.onopen = () => {
      syncTransport = 'live';
      renderSyncBar();
    };
    for (const type of ['factory.snapshot', 'factory.stage.updated', 'factory.a_cut.selected', 'factory.product.queued', 'factory.product.updated', 'factory.product.checkpoint.rebound', 'factory.worker.failed', 'factory.session.disconnected']) {
      eventSource.addEventListener(type, type === 'factory.product.checkpoint.rebound' ? consumeCheckpointRebound : consumeFactoryEvent);
    }
    eventSource.onerror = () => {
      syncTransport = 'reconnecting';
      void recoverEventStream();
      renderSyncBar();
    };
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      eventSource?.close?.();
      eventSource = null;
      window.clearInterval(fallbackTimer);
      fallbackTimer = 0;
      syncTransport = 'reconnecting';
      renderSyncBar();
      return;
    }
    void Promise.allSettled([refreshState(), refreshQueue()]).finally(() => {
      if (!stopped) connectEvents(true);
    });
  };

  const handleSharedFactoryEvent = event => {
    const factoryEvent = event.detail;
    if (!factoryEvent) return;
    if (factoryEvent.type === 'factory.product.checkpoint.rebound') consumeCheckpointRebound(factoryEvent);
    else consumeFactoryEvent(factoryEvent);
  };

  const registerClassifiedWorkfile = event => {
    const targetJobId = pendingWorkfileTargetJobId;
    pendingWorkfileTargetJobId = '';
    try {
      const detail = record(event.detail);
      const result = workfileTabs.registerWorkfile({
        fileName: text(detail.fileName),
        file: detail.file || null,
        workfileText: typeof detail.workfileText === 'string' ? detail.workfileText : '',
        sha256: text(detail.sha256),
        identity: record(detail.identity),
        classification: record(detail.classification),
      }, targetJobId);
      const status = result.status === 'linked'
        ? '작업파일을 exact 작업 탭에 연결했습니다.'
        : result.status === 'target_rebind_required'
          ? '선택한 작업과 파일 신원을 확인했습니다. 연결 승인 버튼을 눌러야 변경됩니다.'
        : result.status === 'ambiguous'
          ? '여러 작업과 일치해 자동 연결하지 않았습니다.'
          : '일치하는 작업이 없어 연결 필요 탭으로 열었습니다.';
      setStatus('live-status', status, result.status === 'linked' ? 'ok' : 'warning');
      const active = workfileTabs.active();
      selectedStageKey = active?.selectedStageKey || active?.stageKey || selectedStageKey;
      inspectedCandidateId = active?.inspectedCandidateId || inspectedCandidateId;
      render();
    } catch (error) {
      setStatus('live-status', `작업파일 탭 등록 실패 · ${error.message}`, 'error');
    }
  };

  render();
  renderAutomationPolicy();
  void loadAutomationPolicy();
  const refreshCreatedJob = event => {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
    const createdJobIds = [...new Set([
      ...list(detail.factoryJobIds),
      ...list(detail.jobIds),
      detail.factoryJobId,
      detail.jobId,
    ].map(value => text(value)).filter(Boolean))];
    recentlyCreatedJobIds = new Set(createdJobIds);
    void refreshQueue().then(() => {
      const createdJob = productJobs.find(job => createdJobIds.includes(text(job.jobId)));
      if (!createdJob) return;
      openMenu('queue');
      window.requestAnimationFrame(() => {
        const row = [...roots.queue.querySelectorAll('[data-job-id]')]
          .find(node => node.dataset.jobId === text(createdJob.jobId));
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
  };
  const clearPendingWorkfileTarget = () => { pendingWorkfileTargetJobId = ''; };
  window.addEventListener('control-tower:job-created', refreshCreatedJob);
  window.addEventListener('control-tower:workfile-classified', registerClassifiedWorkfile);
  window.addEventListener('control-tower:factory-event', handleSharedFactoryEvent);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  workfileInput?.addEventListener('cancel', clearPendingWorkfileTarget);
  void Promise.allSettled([refreshState(), refreshQueue()]).finally(() => {
    void restoreInitialWorkBundle();
    connectEvents();
  });
  return () => {
    stopped = true;
    activeMenuObserver.disconnect();
    restoreWorkbenchSurfaces();
    eventSource?.close?.();
    window.clearInterval(fallbackTimer);
    window.removeEventListener('control-tower:policy-locked', renderLockedPolicy);
    window.removeEventListener('control-tower:job-created', refreshCreatedJob);
    window.removeEventListener('control-tower:workfile-classified', registerClassifiedWorkfile);
    window.removeEventListener('control-tower:factory-event', handleSharedFactoryEvent);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    workfileInput?.removeEventListener('cancel', clearPendingWorkfileTarget);
  };
}

if (globalThis.controlTowerRuntime) {
  mountProductionWorkbench(globalThis.controlTowerRuntime);
}
