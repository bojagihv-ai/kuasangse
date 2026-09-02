const text = value => String(value ?? '').trim();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];

const pick = (...values) => values.find(value => text(value)) ?? '';

export function resolveCandidateAsset(candidateValue, assetsValue, stageKey) {
  const candidate = record(candidateValue);
  const candidateId = text(candidate.id);
  const candidateAssetId = text(candidate.assetId);
  const outputKeys = new Set(
    [candidateId, candidateAssetId]
      .filter(Boolean)
      .map(identity => `output:${identity}`),
  );
  const sectionId = text(candidate.sectionId)
    || (text(stageKey) === 'sections'
      ? (/^([^:]+):[^:]+$/u.exec(candidateId)?.[1] || '')
      : '');
  if (text(stageKey) === 'sections' && sectionId) outputKeys.add(`output:sections:${sectionId}`);
  const matches = list(assetsValue).filter(raw => {
    const asset = record(raw);
    if (text(asset.phase) !== 'output' || text(asset.factoryStageKey) !== text(stageKey)) return false;
    return (candidateAssetId && [text(asset.id), text(asset.storedAssetId)].includes(candidateAssetId))
      || (candidateId && candidateId === text(asset.id))
      || outputKeys.has(text(asset.assetKey));
  });
  return Object.freeze({
    status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'missing',
    asset: matches.length === 1 ? matches[0] : null,
  });
}

export const INPUT_STAGE_KEYS = Object.freeze([
  'sinhwa_db_product',
  'cafe24_match_candidates',
  'manual_new_product',
  'base_images',
  'option_color_images',
  'runtime_manifest',
  'requirements_snapshot',
  'competitor_collection_request',
  'policy_overrides',
  'factory_handoff_checkpoint',
]);

export const CONVEYOR_STAGE_KEYS = Object.freeze([
  'intake',
  'product_matching',
  'required_values',
  'representative_image',
  'generated_images',
  'final_detail',
  'cafe24_preflight',
]);

export const OUTPUT_STAGE_KEYS = Object.freeze([
  'db_cafe_market_candidates',
  'required_values_snapshot',
  'representative_image_a_cut',
  'size_image_a_cut',
  'option_color_a_cut',
  'general_image_cut_a_cut',
  'section_variant_a_cut',
  'final_detail_html',
  'cafe24_preflight_payload',
  'cafe24_registration_receipt',
  'cafe24_remote_readback',
  'workfile_revision',
  'audit_timeline',
  'gpt_judgment_receipts',
]);

const STAGE_DEFINITIONS = Object.freeze({
  input: Object.freeze([
    ['sinhwa_db_product', '신화사 DB 제품 선택', 'sinhwa requirements snapshot'],
    ['cafe24_match_candidates', 'Cafe24 매칭 후보', 'Cafe24 candidate registry'],
    ['manual_new_product', 'DB 없는 신제품 직접 입력', 'manual product intake'],
    ['base_images', '기본 이미지', 'runtime manifest inputImages'],
    ['option_color_images', '옵션 이미지 이름 / 색상', 'runtime manifest color options'],
    ['runtime_manifest', '제품 폴더 / runtime manifest', 'versioned runtime manifest'],
    ['requirements_snapshot', '필수값 / 불변 snapshot', 'sinhwa requirements'],
    ['competitor_collection_request', '경쟁사 수집 요청', 'market collection request'],
    ['policy_overrides', '배치 / 제품 / 단계 정책', 'policy snapshot'],
    ['factory_handoff_checkpoint', '조립공장 handoff / sync / checkpoint', 'registered command bridge'],
  ]),
  conveyor: Object.freeze([
    ['intake', '투입', 'job ledger'],
    ['product_matching', '제품 후보 매칭', 'candidate decisions'],
    ['required_values', '필수값 확정', 'requirements ledger'],
    ['representative_image', '대표 이미지', 'production artifacts'],
    ['generated_images', '사이즈 / 옵션 / 이미지 / 섹션 생성', 'production artifacts'],
    ['final_detail', '최종 상세페이지', 'workfile revision'],
    ['cafe24_preflight', 'Cafe24 사전점검', 'Cafe24 staging contract'],
  ]),
  output: Object.freeze([
    ['db_cafe_market_candidates', 'DB / Cafe24 / 마켓 후보', 'candidate registry'],
    ['required_values_snapshot', '필수값 후보 / immutable snapshot', 'requirements ledger'],
    ['representative_image_a_cut', '대표 이미지 후보 / 선택 A컷', 'production artifacts'],
    ['size_image_a_cut', '사이즈 이미지 후보 / 선택 A컷', 'production artifacts'],
    ['option_color_a_cut', '옵션·색상 후보 / 선택 A컷', 'production artifacts'],
    ['general_image_cut_a_cut', '일반 이미지컷 후보 / 선택 A컷', 'production artifacts'],
    ['section_variant_a_cut', '섹션 변형 후보 / 선택 A컷', 'production artifacts'],
    ['final_detail_html', '최종 상세페이지 후보 / 선택 HTML', 'workfile artifacts'],
    ['cafe24_preflight_payload', 'Cafe24 사전점검 / payload', 'Cafe24 staging contract'],
    ['cafe24_registration_receipt', 'Cafe24 등록 receipt', 'Cafe24 staging receipt'],
    ['cafe24_remote_readback', 'Cafe24 remote readback', 'Cafe24 readback receipt'],
    ['workfile_revision', 'workfile / revision', 'versioned workfile bridge'],
    ['audit_timeline', '감사 타임라인', 'event ledger'],
    ['gpt_judgment_receipts', '모든 GPT 판단 receipt', 'GPT OAuth judgment registry'],
  ]),
});

export const ASSEMBLY_WORKBENCH_STEPS = Object.freeze([
  Object.freeze({ key: 'start', label: '시작' }),
  Object.freeze({ key: 'db', label: 'DB 확정' }),
  Object.freeze({ key: 'required', label: '필수값' }),
  Object.freeze({ key: 'competitors', label: '경쟁사' }),
  Object.freeze({ key: 'cuts', label: '생성컷 선택' }),
  Object.freeze({ key: 'sections', label: '섹션 생성' }),
  Object.freeze({ key: 'send', label: '전송' }),
]);

const CUT_STAGE_KEYS = Object.freeze(['representative', 'size', 'option_color', 'general']);
const WORKBENCH_STAGE_KEYS = Object.freeze({
  intake: 'start',
  queued: 'start',
  product_matching: 'db',
  db_product_match: 'db',
  cafe24_product_match: 'db',
  required_values: 'required',
  required_fields: 'required',
  competitors: 'competitors',
  competitor_collection: 'competitors',
  competitor_product_match: 'competitors',
  representative: 'cuts',
  size: 'cuts',
  option_color: 'cuts',
  general: 'cuts',
  generated_images: 'cuts',
  sections: 'sections',
  final_detail: 'sections',
  cafe24: 'send',
  cafe24_preflight: 'send',
  registration: 'send',
});

function assemblyStage(current, key) {
  return list(record(current).stages).find(stage => text(record(stage).key) === key) || {};
}

function assemblyGroups(current, keys) {
  return keys.map(key => {
    const stage = record(assemblyStage(current, key));
    const candidates = list(stage.candidates);
    return Object.freeze({
      key,
      candidateCount: candidates.length,
      selectedCount: text(stage.selectedId) ? 1 : 0,
    });
  });
}

function currentAssemblyStep(current, job) {
  const jobRecord = record(job);
  const stageKey = text(jobRecord.stageKey || record(current).progress?.stageKey);
  if (text(jobRecord.status).toLowerCase() === 'completed' || WORKBENCH_STAGE_KEYS[stageKey] === 'send') return 'send';
  if (WORKBENCH_STAGE_KEYS[stageKey]) return WORKBENCH_STAGE_KEYS[stageKey];
  if (list(record(current).inputs).some(input => list(record(input).missing).length)) return 'required';
  if (assemblyStage(current, 'final_detail').selectedId || assemblyStage(current, 'sections').selectedId) return 'sections';
  if (CUT_STAGE_KEYS.some(key => text(record(assemblyStage(current, key)).selectedId))) return 'cuts';
  return 'start';
}

export function deriveAssemblyWorkbench(currentValue = {}, jobValue = {}, cafe24Registered = false) {
  const current = record(currentValue);
  const job = record(jobValue);
  const currentKey = currentAssemblyStep(current, job);
  const currentIndex = ASSEMBLY_WORKBENCH_STEPS.findIndex(step => step.key === currentKey);
  const status = text(job.status || record(current.progress).status).toLowerCase();
  const disconnected = current.connected === false;
  const inputMissing = list(current.inputs).reduce((total, input) => total + list(record(input).missing).length, 0);
  const cuts = assemblyGroups(current, CUT_STAGE_KEYS);
  const sections = assemblyGroups(current, ['sections', 'final_detail']);
  const blockers = list(record(current.registration).blockers).map(text).filter(Boolean);
  const steps = ASSEMBLY_WORKBENCH_STEPS.map((definition, index) => {
    const groups = definition.key === 'cuts' ? cuts : definition.key === 'sections' ? sections : [];
    const candidateCount = groups.reduce((total, group) => total + group.candidateCount, 0);
    const selectedCount = groups.reduce((total, group) => total + group.selectedCount, 0);
    let state = index < currentIndex ? 'done' : index > currentIndex ? 'pending' : 'active';
    if (index === currentIndex && status === 'blocked') state = 'blocked';
    if (index === currentIndex && status === 'waiting_manual') state = 'manual';
    if (definition.key === 'required' && inputMissing && index === currentIndex) state = 'blocked';
    if (definition.key === 'send' && cafe24Registered === true && !disconnected) state = 'done';
    if (disconnected && index === currentIndex) state = 'blocked';
    const blocker = definition.key === 'required' && inputMissing
      ? `필수값 ${inputMissing}개 누락`
      : disconnected && index === currentIndex
        ? '조립공장 연결 끊김'
      : state === 'manual'
        ? 'A컷 선택 필요'
        : definition.key === 'send' && blockers.length
          ? blockers[0]
          : state === 'blocked'
            ? pick(job.message, current.blockReason, '작업 차단')
            : '';
    return Object.freeze({
      ...definition,
      state,
      candidateCount,
      selectedCount,
      blocker,
      nextAction: blocker || (state === 'done' ? '완료' : state === 'active' ? '현재 공정 확인' : '공정 대기'),
      groups: Object.freeze(groups),
    });
  });
  return Object.freeze({
    currentStep: steps[currentIndex],
    steps: Object.freeze(steps),
  });
}

const LIFECYCLE_STATES = new Set([
  'empty',
  'loading',
  'error',
  'blocked',
  'planned',
  'connected',
  'synced',
]);

const REVIEW_STAGE = Object.freeze({
  db_product_match: 'db_cafe_market_candidates',
  cafe24_product_match: 'db_cafe_market_candidates',
  competitor_product_match: 'db_cafe_market_candidates',
  required_field_candidate: 'required_values_snapshot',
  representative_image: 'representative_image_a_cut',
  representative_a_cut: 'representative_image_a_cut',
  size_a_cut: 'size_image_a_cut',
  option_color_a_cut: 'option_color_a_cut',
  image_cut_a_cut: 'general_image_cut_a_cut',
  section_variant_a_cut: 'section_variant_a_cut',
  final_detail_candidate: 'final_detail_html',
});

function lifecycleState(payload, jobs, reviews, artifacts) {
  const requested = text(payload.state).toLowerCase();
  if (LIFECYCLE_STATES.has(requested)) return requested;
  if (payload.error) return 'error';
  return jobs.length || reviews.length || artifacts.length ? 'connected' : 'empty';
}

function latestUpdate(jobs) {
  return jobs.map(job => pick(job.updatedAt, job.lastUpdated, record(job.stage).updatedAt))
    .filter(Boolean)
    .sort()
    .at(-1) || '';
}

function artifactFor(artifacts, key) {
  return artifacts.find(item => pick(item.stageKey, item.stageId, item.type) === key);
}

function reviewCounts(reviews, key) {
  const matching = reviews.filter(review => REVIEW_STAGE[pick(review.decisionType, review.type, 'representative_image')] === key);
  return {
    candidateCount: matching.reduce((total, review) => total + list(review.candidates).length, 0),
    selectedCount: matching.filter(review => pick(review.selectedCandidateId, review.decisionId)).length,
    pendingCount: matching.filter(review => !pick(review.selectedCandidateId, review.decisionId)).length,
  };
}

function hasStageEvidence(key, zone, context, artifact, counts) {
  if (artifact || counts.candidateCount > 0 || counts.selectedCount > 0) return true;
  if (zone === 'conveyor') return context.jobs.length > 0;
  const jobs = context.jobs;
  if (key === 'sinhwa_db_product') return jobs.some(job => text(record(job.product).jcode || job.jcode));
  if (key === 'manual_new_product') return jobs.some(job => pick(record(job.source).kind, record(job.input).kind) === 'manual');
  if (key === 'base_images' || key === 'option_color_images') {
    return jobs.some(job => list(record(job.input).inputImages ?? job.inputImages).length > 0);
  }
  if (key === 'runtime_manifest') return jobs.some(job => pick(job.runtimeManifestRef, record(job.input).manifestRef));
  if (key === 'requirements_snapshot' || key === 'required_values_snapshot') {
    return jobs.some(job => Object.keys(record(job.requirements ?? job.requiredFields)).length > 0);
  }
  if (key === 'policy_overrides') return jobs.some(job => Object.keys(record(job.policy)).length > 0 || text(job.policyPreset));
  if (key === 'factory_handoff_checkpoint' || key === 'workfile_revision') {
    return jobs.some(job => pick(record(job.links).openFactory, job.workfileRef, job.revision));
  }
  if (key === 'representative_image_a_cut') {
    return jobs.some(job => Object.keys(record(job.representative ?? job.aCut)).length > 0);
  }
  if (key === 'audit_timeline') return jobs.some(job => Number.isInteger(Number(job.eventSequence)));
  if (key.startsWith('cafe24_')) {
    return jobs.some(job => Object.keys(record(job.publication ?? job.publish)).length > 0);
  }
  return false;
}

function stageRow(definition, zone, context) {
  const [key, label, source] = definition;
  const artifact = artifactFor(context.artifacts, key);
  const counts = reviewCounts(context.reviews, key);
  const candidateCount = Math.max(0, Number(artifact?.candidateCount ?? counts.candidateCount) || 0);
  const selectedCount = Math.max(0, Number(artifact?.selectedCount ?? counts.selectedCount) || 0);
  const artifactState = text(artifact?.state).toLowerCase();
  const evidence = hasStageEvidence(key, zone, context, artifact, counts);
  const baseState = context.forcedState
    || (LIFECYCLE_STATES.has(artifactState) ? artifactState : '')
    || (evidence ? 'connected' : context.jobs.length ? 'planned' : context.lifecycle);
  const syncStatus = pick(artifact?.syncStatus, baseState === 'synced' ? 'synced' : '', baseState === 'connected' || baseState === 'planned' ? 'waiting' : baseState).toLowerCase();
  const state = syncStatus === 'synced'
    ? 'synced'
    : baseState;
  const nextAction = counts.pendingCount > 0
    ? { id: 'select', enabled: true, reason: '' }
    : selectedCount > 0 || state === 'synced'
    ? { id: 'view', enabled: true, reason: '' }
    : candidateCount > 0
      ? { id: 'select', enabled: true, reason: '' }
      : { id: 'view', enabled: false, reason: state === 'blocked' ? 'blocked' : 'sync_waiting' };
  return Object.freeze({
    key,
    zone,
    label,
    source,
    candidateCount,
    selectedCount,
    selectionStatus: counts.pendingCount > 0 ? 'awaiting_manual' : selectedCount > 0 ? 'selected' : candidateCount > 0 ? 'awaiting_manual' : 'not_started',
    policy: context.policy,
    state,
    syncStatus,
    updatedAt: pick(artifact?.updatedAt, context.updatedAt),
    storageRef: pick(artifact?.storageRef, artifact?.artifactRef),
    digest: pick(artifact?.digest, artifact?.sha256),
    nextAction: Object.freeze(nextAction),
  });
}

export function buildIoConveyorProjection(payloadValue = {}) {
  const payload = record(payloadValue);
  const jobs = list(payload.jobs ?? payload.items);
  const reviews = list(payload.reviews);
  const artifacts = list(payload.artifacts);
  const requestedState = text(payload.state).toLowerCase();
  const context = {
    jobs,
    reviews,
    artifacts,
    lifecycle: lifecycleState(payload, jobs, reviews, artifacts),
    forcedState: LIFECYCLE_STATES.has(requestedState) ? requestedState : '',
    policy: pick(record(jobs[0]?.policy).preset, jobs[0]?.policyPreset, 'auto'),
    updatedAt: latestUpdate(jobs),
  };
  const input = STAGE_DEFINITIONS.input.map(definition => stageRow(definition, 'input', context));
  const conveyor = STAGE_DEFINITIONS.conveyor.map(definition => stageRow(definition, 'conveyor', context));
  const output = STAGE_DEFINITIONS.output.map(definition => stageRow(definition, 'output', context));
  const rows = [...input, ...conveyor, ...output];
  const summary = Object.freeze({
    ready: rows.filter(row => ['connected', 'synced'].includes(row.state)).length,
    missing: rows.filter(row => ['empty', 'error', 'blocked'].includes(row.state)).length,
    waitingManual: rows.filter(row => row.selectionStatus === 'awaiting_manual').length,
    syncWaiting: rows.filter(row => !['synced', 'empty', 'error', 'blocked'].includes(row.syncStatus)).length,
    synced: rows.filter(row => row.syncStatus === 'synced').length,
  });
  return Object.freeze({
    summary,
    input: Object.freeze(input),
    conveyor: Object.freeze(conveyor),
    output: Object.freeze(output),
  });
}

export function buildCandidateReviewActions(reviewValue = {}) {
  const review = record(reviewValue);
  const hasCandidates = list(review.candidates).length > 0;
  const hasSelection = Boolean(pick(review.selectedCandidateId, review.decisionId));
  const openFactoryUrl = pick(record(review.links).openFactory, review.openFactoryUrl);
  return Object.freeze([
    Object.freeze({ id: 'view', enabled: hasCandidates, reason: hasCandidates ? '' : 'candidate_missing' }),
    Object.freeze({ id: 'all_candidates', enabled: hasCandidates, reason: hasCandidates ? '' : 'candidate_missing' }),
    Object.freeze({ id: 'select', enabled: hasCandidates, reason: hasCandidates ? '' : 'candidate_missing' }),
    Object.freeze({ id: 'next_approval', enabled: hasSelection, reason: hasSelection ? '' : 'selection_required' }),
    Object.freeze({ id: 'open_factory', enabled: Boolean(openFactoryUrl), reason: openFactoryUrl ? '' : 'bridge_planned' }),
  ]);
}

export function reviewPayloadSignature(payloadValue = {}) {
  return JSON.stringify(list(record(payloadValue).items));
}

function boundedPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function progressPercent(job) {
  const progress = record(job.progress);
  if (Number.isFinite(Number(progress.percent))) return boundedPercent(progress.percent);
  const completed = Number(progress.completed ?? job.completedStages);
  const total = Number(progress.total ?? job.totalStages);
  return total > 0 && Number.isFinite(completed) ? boundedPercent((completed / total) * 100) : 0;
}

function safeThumbnail(value) {
  const url = text(value);
  if (!url || /^(?:data|blob|file):/i.test(url) || /\/content(?:\/|$|\?)/i.test(url)) return '';
  return /(?:thumb|thumbnail|preview|a-cut|a_cut)/i.test(url) ? url : '';
}

function errors(job) {
  return list(job.errors ?? job.productErrors ?? record(job.error).items)
    .map(item => {
      const source = record(item);
      return {
        code: pick(source.code, source.errorCode, 'unknown_error'),
        message: pick(source.message, source.detail, source.code, '오류 상세 없음'),
      };
    });
}

export function normalizeJob(value) {
  const job = record(value);
  const product = record(job.product ?? job.source ?? job.input);
  const representative = record(job.representative ?? job.aCut ?? job.selectedAsset);
  const requirements = record(job.requirements ?? job.requiredFields);
  const review = record(job.review);
  const publication = record(job.publication ?? job.publish);
  const jcode = pick(product.jcode, job.jcode, product.productId, job.productId);

  return Object.freeze({
    raw: job,
    jobId: pick(job.jobId, job.id),
    batchId: pick(job.batchId, record(job.batch).id, '배치 미지정'),
    jcode: text(jcode),
    productName: pick(product.productName, product.name, job.productName, `제품 ${jcode || '미확인'}`),
    status: pick(job.status, job.state, 'UNKNOWN').toUpperCase(),
    eventSequence: Number.isInteger(Number(job.eventSequence)) ? Number(job.eventSequence) : 0,
    currentStage: pick(job.currentStage, record(job.stage).name, record(job.stage).id, '단계 대기'),
    thumbnailUrl: safeThumbnail(pick(
      representative.thumbnailUrl,
      representative.thumbnailRef,
      record(representative.asset).thumbnailUrl,
      job.thumbnailUrl,
    )),
    aCutStatus: pick(representative.status, representative.reviewStatus, '대기').toUpperCase(),
    requirementStatus: pick(requirements.status, job.requirementStatus, '확인 전').toUpperCase(),
    missingFields: list(requirements.missingFields ?? job.missingFields).map(text).filter(Boolean),
    reviewStatus: pick(review.status, job.reviewStatus, '확인 전').toUpperCase(),
    publicationStatus: pick(publication.status, job.publicationStatus, '미게시').toUpperCase(),
    progressPercent: progressPercent(job),
    errors: errors(job),
    commandUrl: pick(record(job.links).commands, record(job.links).command, `/api/jobs/${encodeURIComponent(pick(job.jobId, job.id))}/commands`),
  });
}

export function normalizeJobs(payload) {
  const source = Array.isArray(payload) ? payload : list(record(payload).items ?? record(payload).jobs);
  return source.map(normalizeJob).filter(job => job.jobId);
}

export function mergeCommandResult(current, incoming) {
  const currentSequence = Number(current?.eventSequence) || 0;
  const incomingSequence = Number(incoming?.eventSequence) || 0;
  return incomingSequence < currentSequence ? current : { ...current, ...incoming };
}

export const COMMANDS = Object.freeze([
  Object.freeze({ id: 'start', label: '시작' }),
  Object.freeze({ id: 'pause', label: '일시정지' }),
  Object.freeze({ id: 'resume', label: '재개' }),
  Object.freeze({ id: 'cancel', label: '취소' }),
  Object.freeze({ id: 'retry_failed', label: '실패 재시도' }),
  Object.freeze({ id: 'review', label: '검수' }),
  Object.freeze({ id: 'publish', label: '게시' }),
]);

export function commandDisabled(command, status) {
  const state = text(status).toUpperCase();
  if (command === 'start') return !['READY', 'QUEUED', 'DRAFT'].includes(state);
  if (command === 'pause') return !['RUNNING', 'PROCESSING'].includes(state);
  if (command === 'resume') return !['PAUSED', 'WAITING_MANUAL'].includes(state);
  if (command === 'cancel') return ['CANCELLED', 'COMPLETED', 'PUBLISHED'].includes(state);
  if (command === 'retry_failed') return !['FAILED', 'PARTIAL_FAILED'].includes(state);
  return false;
}
