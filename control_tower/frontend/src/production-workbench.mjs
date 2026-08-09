import {
  FACTORY_CONTROL_EVENT_VERSION,
  FactorySyncConflict,
  applyFactoryDelta,
  buildACutSelectionCommand,
  disconnectedFactoryProjection,
  normalizeFactoryProjection,
} from './factory-sync-model.mjs';
import { bindMenuShell, projectMenuBadges } from './menu-shell.mjs?menuReorg=1';

export {
  buildCandidateReviewActions,
  buildIoConveyorProjection,
  mergeCommandResult,
  normalizeJob,
  normalizeJobs,
  reviewPayloadSignature,
} from './production-workbench-model.mjs';
export {
  applyFactoryDelta,
  buildACutSelectionCommand,
  disconnectedFactoryProjection,
  normalizeFactoryProjection,
} from './factory-sync-model.mjs';

const STAGE_LABELS = Object.freeze({
  representative: '대표 이미지',
  size: '사이즈',
  option_color: '옵션·색상',
  general: '일반 이미지컷',
  sections: '섹션 변형',
  final_detail: '최종 상세페이지',
});
const INPUT_LABELS = Object.freeze({
  product: '제품·DB 입력',
  requirements: '필수값 스냅샷',
  source_images: '기본·색상·옵션 이미지',
  strategy: '전략·정책',
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
  representative_image: '대표 이미지 A컷',
  size_image: '사이즈 이미지 A컷',
  option_image: '옵션·색상 이미지 A컷',
  general_image: '일반 이미지컷 A컷',
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
  paused: '일시정지',
  waiting_manual: 'A컷 결정 필요',
  empty: '아직 생성되지 않음',
  ready: '준비',
  approval_required: '승인 필요',
  executing: '등록 실행 중',
  staged_verified: '등록 검증 완료',
  disconnected: '조립공장 연결 끊김',
});
const CANDIDATE_PAGE_SIZE = 24;
const WORK_BUNDLE_ROLE_LABELS = Object.freeze({
  base: '기본 입력',
  'cafe24-candidate-image': 'Cafe24 후보',
  'color-option-input': '색상·옵션 입력',
  'color-option': '옵션·색상',
  competitor: '경쟁사',
  'competitor-image': '경쟁사 후보',
  'competitor-page': '경쟁사 상세 수집',
  hero: '대표',
  'color-option-output': '옵션·색상',
  size: '사이즈',
  lifestyle: '라이프스타일',
  feature: '특징',
  section: '섹션',
  'stitched-detail': '최종 상세',
  generated: '생성 결과',
  other: '기타',
});

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
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

export function resolveCandidateAsset(candidate, assets, stageKey) {
  const source = record(candidate);
  const candidateId = text(source.id);
  const candidateAssetId = text(source.assetId);
  const outputKeys = new Set(
    [candidateId, candidateAssetId]
      .filter(Boolean)
      .map(identity => `output:${identity}`),
  );
  const sectionId = text(source.sectionId)
    || (text(stageKey) === 'sections'
      ? (/^([^:]+):[^:]+$/u.exec(candidateId)?.[1] || '')
      : '');
  if (text(stageKey) === 'sections' && sectionId) {
    outputKeys.add(`output:sections:${sectionId}`);
  }
  const matches = list(assets).filter(raw => {
    const asset = record(raw);
    if (text(asset.phase) !== 'output' || text(asset.factoryStageKey) !== text(stageKey)) return false;
    const assetId = text(asset.id);
    const storedAssetId = text(asset.storedAssetId);
    const assetKey = text(asset.assetKey);
    return (candidateAssetId && [assetId, storedAssetId].includes(candidateAssetId))
      || (candidateId && candidateId === assetId)
      || outputKeys.has(assetKey);
  });
  return Object.freeze({
    status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'missing',
    asset: matches.length === 1 ? matches[0] : null,
  });
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
    isAutomatic = () => false,
  }) {
    const current = normalizeFactoryProjection(projection);
    const bundle = normalizeWorkBundle(workBundle);
    if (
      current.connected !== true
      || record(policySnapshot).locked !== true
      || !bundle.id
      || !bundleMatchesBinding(bundle, current.session)
      || !text(current.registration.jobId)
    ) return null;
    const stage = current.stages.find(item => (
      !item.selectedId
      && item.candidates.length > 0
      && isAutomatic(item) === true
      && item.candidates.every(candidate => (
        resolveCandidateAsset(candidate, bundle.assets, item.key).status === 'matched'
      ))
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

export function workBundleAssetPage(value, phase, page = 0) {
  const bundle = normalizeWorkBundle(value);
  const items = bundle.assets.filter(asset => asset.phase === phase);
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
} = {}) {
  const projection = record(projectionValue);
  const reason = text(projection.reason || projection.blockReason);
  const streamState = ['live', 'reconnecting', 'connecting'].includes(transport) ? transport : 'connecting';
  const transportLabel = streamState === 'live'
    ? '상태 스트림 연결됨'
    : streamState === 'reconnecting'
      ? '상태 스트림 재연결 중'
      : '상태 스트림 연결 중';
  if (text(apiError)) {
    return Object.freeze({
      state: 'backend-error',
      factoryLabel: '생산관제 서버 오류',
      transportLabel,
      detail: `상태 조회 실패 · ${text(apiError)}`,
      observedAt: text(lastEventAt || projection.capturedAt),
      tone: 'error',
    });
  }
  if (projection.connected === true) {
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
      next = normalizeFactoryProjection({
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
  } else if (payload.type !== 'factory.worker.failed') {
    throw new FactorySyncConflict('factory_event_payload_invalid');
  }
  return Object.freeze({
    projection: next,
    factoryEventCursor: text(event.lastEventId),
  });
}

function element(tag, className = '', value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

export function createWorkBundleAssetCard(asset, assetUrl = value => value) {
  const card = element('article', 'a-cut-candidate work-bundle-asset');
  card.dataset.assetId = asset.id;
  card.dataset.assetKey = asset.assetKey;
  card.dataset.role = asset.role;
  card.dataset.factoryStageKey = asset.factoryStageKey;
  const frame = element('div', 'a-cut-thumb');
  const placeholder = element('p', 'factory-empty-state', '미리보기 없음');
  if (asset.thumbnailReference) {
    const image = element('img');
    image.src = assetUrl(asset.thumbnailReference);
    image.alt = asset.displayName || `${asset.role} 자산`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 160;
    image.height = 120;
    image.addEventListener('error', () => {
      placeholder.textContent = '이미지 불러오기 실패';
      placeholder.dataset.broken = 'true';
      image.replaceWith(placeholder);
    }, { once: true });
    frame.append(image);
  } else {
    frame.append(placeholder);
  }
  const meta = element('div', 'a-cut-candidate-meta');
  meta.append(
    element('strong', '', asset.displayName || asset.assetKey),
    element('span', 'factory-pill', asset.selectionState || 'contract'),
    element('small', 'status-message', `role ${asset.role} · stage ${asset.stage || '—'}`),
  );
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

function elapsedLabel(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
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
    expectedWorkfileRevision: session.revision,
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

export function mountProductionWorkbench({
  apiRequest,
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
    map: document.getElementById('io-progress-map'),
    candidates: document.getElementById('a-cut-contact-sheet'),
    inspector: document.getElementById('artifact-inspector'),
    registration: document.getElementById('factory-registration-panel'),
    queue: document.getElementById('product-list'),
    policy: document.getElementById('automation-policy-matrix'),
    policySummary: document.getElementById('automation-policy-summary'),
    overview: document.getElementById('overview-stage-summary'),
    stageSubnav: document.getElementById('stage-subnav'),
    competitors: document.getElementById('competitor-source-summary'),
    audit: document.getElementById('audit-sync-summary'),
    bundleInputs: document.getElementById('work-bundle-input-assets'),
    bundleOutputs: document.getElementById('work-bundle-output-assets'),
  };
  const requiredRoots = ['sync', 'product', 'map', 'candidates', 'inspector', 'registration', 'queue', 'policy', 'policySummary', 'bundleInputs', 'bundleOutputs'];
  if (typeof apiRequest !== 'function' || requiredRoots.some(key => !roots[key])) return () => {};

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
  let lastAutomationReceipt = null;
  let workBundle = normalizeWorkBundle({});
  let workBundleStatus = 'loading';
  let workBundleError = '';
  let workBundleInputPage = 0;
  let workBundleOutputPage = 0;
  let workBundleGeneration = 0;
  const heldDecisions = new Set();
  let approval = {
    preview: null,
    token: '',
    status: 'missing',
    receipt: null,
  };
  const fixtureCount = Math.max(0, Number.parseInt(new URLSearchParams(window.location.search).get('fixtureCount') || '0', 10) || 0);
  const fixtureMode = fixtureCount > 0;
  const requestedWorkBundleId = text(new URLSearchParams(window.location.search).get('bundleId'));

  function savingKey(stageKey, productId = projection.session.productId) {
    return `${text(productId)}:${text(stageKey)}`;
  }

  function stageSaving(stageKey) {
    return savingByTarget.get(savingKey(stageKey)) || null;
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
      new Option('상속', ''),
      new Option('자동 ON', 'auto'),
      new Option('자동 OFF', 'manual'),
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
        element('span', 'automation-effective', `${statusLabel(effective.mode)} · ${effective.source}`),
      );
      root.append(row);
    }
    const snapshot = record(automationState.snapshot);
    roots.policySummary.textContent = snapshot.locked
      ? `policy lock ${text(snapshot.snapshotId)}${automationState.draftDirty ? ' · 다음 실행 변경 대기' : ''} · stage > product > batch > batch_preset > auto_default`
      : '실행 전 미잠금 · stage > product > batch > batch_preset > auto_default';
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
    projection = normalizeFactoryProjection(nextValue);
    const stage = selectedStage(projection, selectedStageKey);
    selectedStageKey = stage?.key || '';
    for (const [key, pending] of savingByTarget) {
      if (pending.productId !== projection.session.productId) continue;
      const savedStage = projection.stages.find(item => item.key === pending.stageKey);
      if (savedStage?.selectedId === pending.candidateId) savingByTarget.delete(key);
    }
    globalThis.controlTowerMenu?.updateBadges?.(projectMenuBadges(projection, automationState));
    if (workBundleIdentityChanged(previousSession, projection.session, {
      requestedId: requestedWorkBundleId,
    })) void loadWorkBundle();
    else if (!requestedWorkBundleId) void scheduleAutomaticSelection();
  }

  function connectivity() {
    return projectFactoryConnectivity(projection, {
      transport: syncTransport,
      lastEventAt,
      apiError: factoryApiError,
    });
  }

  function renderSyncBar() {
    const root = roots.sync;
    const state = connectivity();
    const progress = record(projection.progress);
    const productLabel = projection.session.productKey || '현재 제품 없음';
    const stageLabel = progress.stageLabel || progress.stageKey || '공정 대기';
    if (roots.syncSummary) {
      roots.syncSummary.textContent = `${state.factoryLabel} · ${productLabel} · ${stageLabel} ${Number(progress.percent || 0)}%`;
    }
    root.replaceChildren();
    root.dataset.connected = String(state.state === 'connected');
    root.dataset.transport = syncTransport;
    root.dataset.connectivityTone = state.tone;
    const identity = element('dl', 'factory-sync-fields');
    identity.append(
      labelledValue('조립공장', state.factoryLabel, 'connected'),
      labelledValue('연결 상세', state.detail, 'factory-detail'),
      labelledValue('capability', projection.capabilityVersion, 'capability'),
      labelledValue('제품', projection.session.productKey, 'product-key'),
      labelledValue('run', projection.session.runId, 'run-id'),
      labelledValue('revision', projection.session.revision, 'revision'),
      labelledValue('SSE cursor', factoryEventCursor || '초기 연결', 'event-cursor'),
      labelledValue('마지막 event', state.observedAt, 'last-event'),
    );
    const actions = element('div', 'button-row factory-sync-actions');
    const refresh = element('button', '', '새로고침');
    refresh.type = 'button';
    refresh.dataset.action = 'factory-refresh';
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try {
        await apiRequest('/api/factory/refresh', { method: 'POST', body: '{}' });
        await refreshState();
      } finally {
        refresh.disabled = false;
      }
    });
    const reconnect = element('button', 'button-secondary', '다시 연결');
    reconnect.type = 'button';
    reconnect.dataset.action = 'factory-reconnect';
    reconnect.addEventListener('click', () => {
      connectEvents(true);
      void refreshState();
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

  function renderOverviewSummary() {
    if (!roots.overview) return;
    roots.overview.replaceChildren();
    const progress = record(projection.progress);
    const state = connectivity();
    const missing = projection.inputs.reduce((total, input) => total + input.missing.length, 0);
    const unresolved = projection.stages.filter(stage => !stage.selectedId).length;
    const cards = [
      ['현재 제품', projection.session.productKey || '조립공장 session 없음', projection.session.productId || '제품 ID 없음'],
      ['현재 공정', progress.stageLabel || progress.stageKey || '아직 시작되지 않음', `${Number(progress.percent || 0)}% · ${statusLabel(progress.status || projection.status)}`],
      ['차단/미결정', `${missing + unresolved}건`, `Input 누락 ${missing} · A컷 미결정 ${unresolved}`],
      ['동기화', state.factoryLabel, `${state.transportLabel} · ${state.detail} · ${factoryEventCursor ? `cursor ${factoryEventCursor}` : '초기 snapshot 대기'}`],
    ];
    for (const [label, title, detail] of cards) {
      const card = element('article', 'menu-summary-card');
      card.append(element('p', 'label', label), element('h3', '', title), element('p', 'status-message', detail));
      roots.overview.append(card);
    }
  }

  function renderCompetitors() {
    if (!roots.competitors) return;
    roots.competitors.replaceChildren();
    const inputs = projection.inputs.filter(input => ['competitors', 'competitor_sources', 'competitor'].includes(input.key));
    if (!inputs.length) {
      roots.competitors.append(element('article', 'menu-summary-card', '경쟁사 source/candidates가 현재 factory projection에 없습니다.'));
      return;
    }
    for (const input of inputs) {
      const card = element('article', 'menu-summary-card');
      const missing = input.missing.length;
      card.append(
        element('p', 'label', input.key),
        element('h3', '', `${input.count}개 후보`),
        element('p', 'status-message', missing ? `누락 ${missing} · ${input.missing.join(' · ')}` : '현재 projection에서 수집 상태 확인됨'),
      );
      roots.competitors.append(card);
    }
  }

  function renderStageSubnav() {
    if (!roots.stageSubnav) return;
    const currentKey = selectedStageKey || projection.stages[0]?.key || '';
    for (const button of roots.stageSubnav.querySelectorAll('[data-stage-key]')) {
      const stageKey = text(button.dataset.stageKey);
      button.dataset.selected = String(stageKey === currentKey);
      button.dataset.state = stageKey === 'db'
        ? 'input'
        : factoryStageUiState(projection.stages.find(stage => stage.key === stageKey), projection.connected).state;
      if (button.dataset.bound === 'true') continue;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        if (stageKey === 'db') {
          globalThis.controlTowerMenu?.activate?.('input-source', { focus: false });
          document.getElementById('workfile-input')?.focus();
          return;
        }
        selectedStageKey = stageKey;
        const stage = projection.stages.find(item => item.key === stageKey);
        inspectedCandidateId = stage?.selectedId || stage?.candidates[0]?.id || '';
        candidatePage = 0;
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
      element('p', 'label', 'SSE / WORKER IDENTITY'),
      element('h3', '', state.factoryLabel),
      element('p', 'status-message', `${state.transportLabel} · ${state.detail}`),
      element('p', 'status-message', `event cursor ${factoryEventCursor || '초기 연결'} · sequence ${projection.sequence || 0}`),
      element('p', 'status-message', `${session.productKey || '제품 없음'} · run ${session.runId || '없음'} · revision ${session.revision || '없음'} · 마지막 event ${lastEventAt || projection.capturedAt || '없음'}`),
    );
    roots.audit.append(card);
  }

  function renderProgressMap() {
    const root = roots.map;
    const state = connectivity();
    root.replaceChildren();
    const inputHeading = element('h3', '', 'Input');
    root.append(inputHeading);
    const inputList = element('div', 'io-progress-group');
    for (const input of projection.inputs) {
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
    if (!projection.inputs.length) {
      inputList.append(element('p', 'status-message', projection.connected ? 'Input snapshot이 비어 있습니다.' : state.factoryLabel));
    }
    root.append(inputList, element('h3', '', 'Output'));
    const stageList = element('div', 'io-progress-group');
    for (const stage of projection.stages) {
      const button = element('button', 'io-progress-item io-stage-button');
      const stageUi = factoryStageUiState(stage, projection.connected);
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
        render();
        roots.candidates.querySelector('button')?.focus();
      });
      stageList.append(button);
    }
    if (!projection.stages.length) stageList.append(element('p', 'status-message', state.factoryLabel));
    root.append(stageList);
  }

  function renderCandidates() {
    const root = roots.candidates;
    root.replaceChildren();
    const stage = selectedStage(projection, selectedStageKey);
    const heading = element('div', 'section-heading compact-heading');
    heading.append(element('div', '', ''), element('span', 'factory-pill', stage ? `${stage.candidates.length}개 후보` : '0개 후보'));
    heading.firstElementChild.append(
      element('p', 'eyebrow', 'A-CUT CONTACT SHEET'),
      element('h3', '', stage ? STAGE_LABELS[stage.key] : '출력 단계 선택'),
    );
    root.append(heading);
    if (!projection.connected) {
      root.append(element('p', 'factory-empty-state', connectivity().factoryLabel));
      return;
    }
    if (!stage || !stage.candidates.length) {
      root.append(element('p', 'factory-empty-state', '아직 생성되지 않음'));
      return;
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
        frame.append(image);
      } else {
        frame.append(placeholder);
      }
      const meta = element('div', 'a-cut-candidate-meta');
      meta.append(element('strong', '', candidate.id));
      if (bundleAsset) {
        meta.append(element(
          'span',
          'factory-pill',
          WORK_BUNDLE_ROLE_LABELS[bundleAsset.role] || bundleAsset.role,
        ));
      }
      if (stage.selectedId === candidate.id) meta.append(element('span', 'factory-pill selected-badge', '선택 A컷'));
      const view = element('button', 'button-secondary', '보기');
      view.type = 'button';
      view.dataset.action = 'view-candidate';
      view.addEventListener('click', () => {
        inspectedCandidateId = candidate.id;
        render();
        roots.inspector.querySelector('[data-action="select-a-cut"]')?.focus();
      });
      card.append(frame, meta, view);
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

  function renderWorkBundleAssets(root, phase, pageValue) {
    root.replaceChildren();
    const heading = element('div', 'section-heading compact-heading');
    heading.append(element('div'), element(
      'span',
      'factory-pill',
      workBundleStatus === 'ready'
        ? `${workBundle.assets.filter(asset => asset.phase === phase).length}개 자산`
        : statusLabel(workBundleStatus),
    ));
    heading.firstElementChild.append(
      element('p', 'eyebrow', phase === 'input' ? 'PDP WORK-BUNDLE INPUT' : 'PDP WORK-BUNDLE OUTPUT'),
      element('h3', '', phase === 'input' ? '실제 Input 자산' : '실제 Output 자산'),
    );
    root.append(heading);
    if (workBundleStatus !== 'ready') {
      root.append(element(
        'p',
        'factory-empty-state',
        workBundleStatus === 'loading'
          ? '신화사 PDP work-bundle을 불러오는 중입니다.'
          : `work-bundle 조회 실패 · ${workBundleError || 'blocked_external'}`,
      ));
      return;
    }
    const page = workBundleAssetPage(workBundle, phase, pageValue);
    root.dataset.bundleId = workBundle.id;
    root.dataset.total = String(page.total);
    root.dataset.rendered = String(page.items.length);
    root.dataset.page = String(page.page + 1);
    const contract = element(
      'p',
      'status-message',
      `${workBundle.workfileName || workBundle.bundleKey} · bundle ${workBundle.id} · revision ${workBundle.version}`,
    );
    root.append(contract);
    if (!page.total) {
      root.append(element('p', 'factory-empty-state', `${phase === 'input' ? 'Input' : 'Output'} 자산이 없습니다.`));
      return;
    }
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

  async function loadWorkBundle() {
    const generation = ++workBundleGeneration;
    const workspaceId = requestedWorkBundleId ? '' : text(projection.session.workspaceId);
    const productKey = requestedWorkBundleId ? '' : text(projection.session.productKey);
    workBundleStatus = 'loading';
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
      workBundleInputPage = 0;
      workBundleOutputPage = 0;
    } catch (error) {
      if (generation !== workBundleGeneration || error.code === 'stale_work_bundle_response') return;
      workBundleStatus = 'blocked';
      workBundleError = text(error.code || error.message);
      workBundle = normalizeWorkBundle({});
    }
    render();
    if (!requestedWorkBundleId) void scheduleAutomaticSelection();
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
    const jobId = text(projection.registration.jobId);
    if (!workBundle.id || !jobId) {
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
      const response = await apiRequest('/api/factory/a-cuts/select', {
        method: 'POST',
        body: JSON.stringify(buildCompositeSelectionPayload({
          projection,
          command,
          workBundle,
          jobId,
          decisionMode,
          policySnapshot: automationState.snapshot,
          judgementOptions: judgementOptions(),
        })),
      });
      lastAutomationReceipt = response.decisionReceipt || null;
      if (response.selectionStatus !== 'saving') {
        savingByTarget.delete(savingKey(stage.key));
        heldDecisions.add(STAGE_DECISIONS[stage.key]);
        setStatus('live-status', `판단 기록 완료 · ${text(response.selectionStatus)}`, 'error');
      } else {
        const selectedId = text(record(response.decisionReceipt).selectedCandidateId || candidate?.id);
        savingByTarget.set(savingKey(stage.key), { ...pending, candidateId: selectedId });
        setStatus('live-status', `${STAGE_LABELS[stage.key]} PDP 판단 기록 후 factory 명령을 전달했습니다.`, 'ok');
      }
      return response;
    } catch (error) {
      savingByTarget.delete(savingKey(stage.key));
      setStatus('live-status', `A컷 저장 실패 · ${error.message}`, 'error');
      if ([409, 422].includes(error.status)) await refreshState();
      render();
      return null;
    }
  }

  async function selectACut(stage, candidate) {
    await submitSelection(stage, candidate, 'manual');
  }

  async function selectAutomatically(stage) {
    const decisionType = STAGE_DECISIONS[stage.key];
    const snapshot = record(automationState.snapshot);
    const jobId = text(projection.registration.jobId);
    if (!decisionType || snapshot.locked !== true || !jobId) return;
    await submitSelection(stage, null, 'auto');
  }

  const automaticScheduler = createAutomaticSelectionScheduler({
    submit: (stage, mode) => submitSelection(stage, null, mode),
  });

  function scheduleAutomaticSelection() {
    return automaticScheduler({
      projection,
      workBundle,
      policySnapshot: automationState.snapshot,
      isAutomatic: stage => (
        effectiveDecision(STAGE_DECISIONS[stage.key]).mode === 'auto'
      ),
    });
  }

  function renderInspector() {
    const root = roots.inspector;
    root.replaceChildren();
    const stage = selectedStage(projection, selectedStageKey);
    const candidate = stage?.candidates.find(item => item.id === inspectedCandidateId)
      || stage?.candidates.find(item => item.id === stage.selectedId)
      || stage?.candidates[0]
      || null;
    root.append(element('p', 'eyebrow', 'ARTIFACT INSPECTOR'), element('h3', '', '후보 근거와 선택'));
    if (!candidate) {
      root.append(element('p', 'factory-empty-state', projection.connected ? '확인할 후보가 없습니다.' : '조립공장 연결 끊김'));
      return;
    }
    const fields = element('dl', 'factory-inspector-fields');
    const decisionType = STAGE_DECISIONS[stage.key];
    const effective = effectiveDecision(decisionType);
    fields.append(
      labelledValue('candidate', candidate.id, 'candidate-id'),
      labelledValue('asset', candidate.assetId, 'asset-id'),
      labelledValue('source', candidate.source, 'source'),
      labelledValue('digest', candidate.digest, 'digest'),
      labelledValue('model', candidate.model, 'model'),
      labelledValue('confidence', candidate.confidence === null ? '' : candidate.confidence, 'confidence'),
      labelledValue('rationale', candidate.rationale, 'rationale'),
      labelledValue('갱신', stage.updatedAt, 'updated-at'),
      labelledValue('자동화', `${statusLabel(effective.mode)} · ${effective.source}`, 'automation-policy'),
    );
    root.append(fields);
    const visibleReceipt = (
      record(lastAutomationReceipt).decisionType === decisionType
        ? lastAutomationReceipt
        : candidate.receipt
    );
    if (visibleReceipt) {
      const receipt = element('pre', 'artifact-receipt');
      receipt.textContent = JSON.stringify(visibleReceipt, null, 2);
      root.append(receipt);
    }
    const result = element('p', 'status-message');
    result.setAttribute('role', 'status');
    const saving = stageSaving(stage.key);
    if (saving?.candidateId === candidate.id || saving?.candidateId === 'oauth-pending') {
      result.textContent = 'saving · factory receipt와 revision을 기다리는 중';
    } else if (stage.selectedId === candidate.id) {
      result.textContent = `selected · revision ${projection.session.revision}`;
      result.dataset.tone = 'ok';
    } else {
      result.textContent = '보기 상태 · 아직 A컷으로 선택하지 않음';
    }
    const actions = element('div', 'button-row inspector-actions');
    const automatic = effective.mode === 'auto';
    const select = element('button', '', saving ? '저장 중' : automatic ? '자동 판단 ON' : 'A컷 선택');
    select.type = 'button';
    select.dataset.action = 'select-a-cut';
    select.disabled = !projection.connected
      || Boolean(saving)
      || stage.selectedId === candidate.id
      || resolveCandidateAsset(candidate, workBundle.assets, stage.key).status !== 'matched'
      || (automatic && record(automationState.snapshot).locked !== true);
    select.addEventListener('click', () => (
      automatic ? void selectAutomatically(stage) : void selectACut(stage, candidate)
    ));
    const next = element('button', 'button-secondary', '다음 미결정');
    next.type = 'button';
    next.dataset.action = 'next-unresolved';
    const unresolved = unresolvedStage(projection, stage.key);
    next.disabled = !unresolved || (automatic && !heldDecisions.has(decisionType));
    next.addEventListener('click', () => {
      if (!unresolved) return;
      selectedStageKey = unresolved.key;
      inspectedCandidateId = unresolved.candidates[0]?.id || '';
      candidatePage = 0;
      render();
      roots.candidates.querySelector('button')?.focus();
    });
    actions.append(select, next);
    root.append(actions, result);
  }

  function registrationStatus() {
    if (approval.receipt) return 'staged_verified';
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
    if (!approval.token || !confirmInput.checked) return;
    const jobId = text(projection.registration.jobId);
    if (!jobId) {
      registrationMessage = '등록 실행 차단 · job_id 없음';
      renderRegistration();
      return;
    }
    if (!window.confirm('고정된 승인 대상으로 Cafe24 등록을 한 번 실행할까요?')) return;
    approval = { ...approval, status: 'executing' };
    renderRegistration();
    try {
      const result = await apiRequest('/api/cafe24/publish', {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          approvalToken: approval.token,
          ...approvalBinding(approval.preview),
        }),
      });
      approval = {
        ...approval,
        token: '',
        status: text(result.status || 'staged_verified'),
        receipt: result.publicationReceipt || result,
      };
      registrationMessage = 'Cafe24 staged_verified · remote readback 영수증 확인';
    } catch (error) {
      approval = { ...approval, token: '', status: 'failed' };
      registrationMessage = `Cafe24 등록 실패 · ${error.message}`;
    }
    renderRegistration();
  }

  function renderRegistration() {
    const root = roots.registration;
    root.replaceChildren();
    const registration = record(projection.registration);
    const blockers = list(registration.blockers).map(text).filter(Boolean);
    const status = registrationStatus();
    root.dataset.status = status;
    const heading = element('div', 'status-row');
    heading.append(element('h3', '', 'Cafe24 등록'), element('span', 'factory-pill', statusLabel(status)));
    const fields = element('dl', 'factory-sync-fields registration-fields');
    fields.append(
      labelledValue('productId', registration.productId || projection.session.productId, 'product-id'),
      labelledValue('productKey', registration.productKey || projection.session.productKey, 'product-key'),
      labelledValue('categoryId', registration.categoryId, 'category-id'),
      labelledValue('HTML digest', registration.htmlDigest, 'html-digest'),
      labelledValue('image digests', list(registration.imageDigests).join(', '), 'image-digests'),
      labelledValue('selling / display / market_sync', `${registration.selling || 'F'} / ${registration.display || 'F'} / ${registration.market_sync || 'F'}`, 'safe-defaults'),
      labelledValue('idempotencyKey', registration.idempotencyKey, 'idempotency-key'),
      labelledValue('approval token', approval.token ? '발급됨 · 메모리 보관' : registration.approvalTokenState || approval.status, 'approval-state'),
      labelledValue('remote readback', approval.receipt?.remoteReadbackDigest || registration.remoteReadbackDigest, 'readback'),
    );
    root.append(heading, fields);
    const blockerList = element('ul', 'registration-blockers');
    blockerList.dataset.blockerCount = String(blockers.length);
    if (blockers.length) {
      for (const blocker of blockers) blockerList.append(element('li', '', blocker));
    } else {
      blockerList.append(element('li', '', '필수 Input과 모든 단계 A컷이 확정되었습니다.'));
    }
    root.append(blockerList);
    const actions = element('div', 'button-row registration-actions');
    const preflight = element('button', 'button-secondary', '사전점검');
    preflight.type = 'button';
    preflight.dataset.action = 'cafe24-preflight';
    preflight.disabled = !projection.connected;
    preflight.addEventListener('click', () => void runPreflight());
    const preview = element('button', 'button-secondary', '승인 대상 만들기');
    preview.type = 'button';
    preview.dataset.action = 'cafe24-preview';
    preview.disabled = !projection.connected || blockers.length > 0;
    preview.addEventListener('click', () => void requestApproval());
    const approve = element('button', 'button-secondary', '일회 승인');
    approve.type = 'button';
    approve.dataset.action = 'cafe24-approve';
    approve.disabled = !approval.preview || Boolean(approval.token);
    approve.addEventListener('click', () => void approveTarget());
    const confirmLabel = element('label', 'registration-confirm');
    const confirmInput = element('input');
    confirmInput.type = 'checkbox';
    confirmInput.dataset.action = 'confirm-cafe24-target';
    confirmLabel.append(confirmInput, document.createTextNode(' 고정된 대상 1건 실행 확인'));
    const execute = element('button', 'button-danger', 'Cafe24 등록 실행');
    execute.type = 'button';
    execute.dataset.action = 'cafe24-execute';
    execute.disabled = !approval.token || !confirmInput.checked || !text(registration.jobId);
    confirmInput.addEventListener('change', () => {
      execute.disabled = !approval.token || !confirmInput.checked || !text(registration.jobId);
    });
    execute.addEventListener('click', () => void executeRegistration(confirmInput));
    actions.append(preflight, preview, approve, confirmLabel, execute);
    root.append(actions);
    const message = element('p', 'status-message', registrationMessage || (
      blockers.length ? `차단 사유 ${blockers.length}개` : '사전점검 준비 완료 · 등록에는 일회 승인이 필요합니다.'
    ));
    message.setAttribute('role', 'status');
    root.append(message);
  }

  function renderQueue() {
    if (fixtureMode) return;
    const root = roots.queue;
    root.replaceChildren();
    const products = projection.products.length
      ? projection.products
      : projection.connected
        ? [{
          productId: projection.session.productId,
          productKey: projection.session.productKey,
          progress: projection.progress,
        }]
        : [];
    for (const product of products.slice(0, 15)) {
      const row = element('article', 'factory-card virtual-row');
      row.dataset.productId = text(product.productId);
      const productProgress = record(product.progress);
      row.append(
        element('strong', '', text(product.productKey || product.productId)),
        element('span', 'factory-pill', statusLabel(productProgress.status || projection.status)),
        element('p', 'status-message', `${text(productProgress.stageLabel || productProgress.stageKey)} · ${Number(productProgress.percent || 0)}% · ${elapsedLabel(productProgress.elapsedMs)}`),
      );
      root.append(row);
    }
    if (!products.length) root.append(element('p', 'status-message', '조립공장 session에 제품이 없습니다.'));
    root.dataset.apiTotal = String(products.length);
    root.dataset.apiRendered = String(Math.min(products.length, 15));
  }

  function render() {
    renderSyncBar();
    renderProductProgress();
    renderOverviewSummary();
    renderStageSubnav();
    renderProgressMap();
    renderCandidates();
    renderWorkBundleAssets(roots.bundleInputs, 'input', workBundleInputPage);
    renderWorkBundleAssets(roots.bundleOutputs, 'output', workBundleOutputPage);
    renderInspector();
    renderRegistration();
    renderCompetitors();
    renderAuditSummary();
    renderQueue();
  }

  async function refreshState() {
    try {
      const next = await apiRequest(`/api/factory/state${fixtureCount ? `?fixtureCount=${fixtureCount}` : ''}`);
      factoryApiError = '';
      setProjection(next);
      if (!selectedStageKey) selectedStageKey = projection.stages[0]?.key || '';
      syncTransport = projection.connected ? syncTransport : 'reconnecting';
      render();
    } catch (error) {
      factoryApiError = text(error.code || error.message || 'factory_state_unavailable');
      setProjection(disconnectedFactoryProjection(text(error.code || error.message)));
      syncTransport = 'reconnecting';
      render();
    }
  }

  function consumeFactoryEvent(event) {
    if (stopped) return;
    try {
      const accepted = applyFactorySseMessage(projection, factoryEventCursor, event);
      setProjection(accepted.projection);
      factoryEventCursor = accepted.factoryEventCursor;
      lastEventAt = new Date().toISOString();
      syncTransport = 'live';
      render();
    } catch (error) {
      if (!(error instanceof FactorySyncConflict)) setStatus('live-status', `factory event 해석 실패 · ${error.message}`, 'error');
    }
  }

  function connectEvents(force = false) {
    if (force) eventSource?.close?.();
    if (typeof EventSourceImpl !== 'function') {
      syncTransport = 'reconnecting';
      window.clearInterval(fallbackTimer);
      fallbackTimer = window.setInterval(() => void refreshState(), 2000);
      render();
      return;
    }
    eventSource = new EventSourceImpl(assetUrl(factoryEventsUrl(factoryEventCursor)));
    eventSource.onopen = () => {
      syncTransport = 'live';
      renderSyncBar();
    };
    for (const type of ['factory.snapshot', 'factory.stage.updated', 'factory.a_cut.selected', 'factory.worker.failed', 'factory.session.disconnected']) {
      eventSource.addEventListener(type, consumeFactoryEvent);
    }
    eventSource.onerror = () => {
      syncTransport = 'reconnecting';
      renderSyncBar();
    };
  }

  render();
  renderAutomationPolicy();
  void loadAutomationPolicy();
  void refreshState().finally(() => {
    if (requestedWorkBundleId) void loadWorkBundle();
    connectEvents();
  });
  return () => {
    stopped = true;
    eventSource?.close?.();
    window.clearInterval(fallbackTimer);
    window.removeEventListener('control-tower:policy-locked', renderLockedPolicy);
  };
}

if (globalThis.controlTowerRuntime) {
  mountProductionWorkbench(globalThis.controlTowerRuntime);
}
