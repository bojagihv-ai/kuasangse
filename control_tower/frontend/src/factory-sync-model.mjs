export const FACTORY_CONTROL_PROJECTION_VERSION = 'factory-control-projection:v1';
export const FACTORY_CONTROL_COMMAND_VERSION = 'factory-control-command:v1';
export const FACTORY_CONTROL_EVENT_VERSION = 'factory-control-event:v1';

const STAGE_KEYS = Object.freeze([
  'representative',
  'size',
  'option_color',
  'general',
  'sections',
  'final_detail',
]);
const PROJECTION_WORK_IDENTITY_FIELDS = Object.freeze([
  'workspaceId',
  'productId',
  'productKey',
  'runId',
  'inputFingerprint',
  'workfileSha256',
]);

export class FactorySyncConflict extends Error {
  constructor(code) {
    super(code);
    this.name = 'FactorySyncConflict';
    this.code = code;
  }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function normalizeCandidate(value) {
  const source = record(value);
  const id = text(source.id || source.candidateId || source.assetId);
  if (!id) throw new TypeError('factory candidate id missing');
  return {
    id,
    assetId: text(source.assetId || id),
    thumbnailUrl: text(source.thumbnailUrl || source.thumbnailRef),
    digest: text(source.digest),
    source: text(source.source),
    model: text(source.model),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
    rationale: text(source.rationale),
    receipt: clone(source.receipt || null),
  };
}

function normalizeStage(value) {
  const source = record(value);
  const key = text(source.key || source.stageKey);
  if (!STAGE_KEYS.includes(key)) throw new TypeError(`factory stage key unsupported:${key}`);
  const candidates = list(source.candidates).map(normalizeCandidate);
  const selectedId = text(source.selectedId || source.selectedCandidateId || list(source.selectedIds)[0]);
  if (selectedId && !candidates.some(candidate => candidate.id === selectedId)) {
    throw new TypeError(`factory selected candidate missing:${key}:${selectedId}`);
  }
  return {
    key,
    status: text(source.status || (candidates.length ? 'waiting_manual' : 'empty')),
    selectedId,
    updatedAt: text(source.updatedAt),
    candidates,
  };
}

function normalizeSession(value) {
  const source = record(value);
  return {
    workspaceId: text(source.workspaceId),
    productId: text(source.productId),
    productKey: text(source.productKey),
    runId: text(source.runId || source.currentRunId),
    inputFingerprint: text(source.inputFingerprint || source.expectedInputFingerprint),
    revision: integer(source.revision ?? source.workfileRevision),
    workfileName: text(source.workfileName),
    workfileSource: text(source.workfileSource),
    workfileSha256: text(source.workfileSha256),
    workfileBytes: integer(source.workfileBytes),
  };
}

export function normalizeFactoryProjection(value) {
  const source = record(value);
  if (source.schema !== FACTORY_CONTROL_PROJECTION_VERSION) {
    throw new TypeError('factory projection version unsupported');
  }
  const connected = source.connected === true;
  const projection = {
    schema: FACTORY_CONTROL_PROJECTION_VERSION,
    capabilityVersion: text(source.capabilityVersion || FACTORY_CONTROL_COMMAND_VERSION),
    cursor: text(source.cursor || source.sequence),
    sequence: integer(source.sequence),
    connected,
    status: text(source.status || (connected ? 'connected' : 'blocked')),
    reason: text(source.reason || source.blockReason),
    capturedAt: text(source.capturedAt),
    session: normalizeSession(source.session),
    inputs: list(source.inputs).map(item => ({
      key: text(record(item).key),
      count: integer(record(item).count),
      missing: list(record(item).missing).map(text).filter(Boolean),
      items: clone(list(record(item).items)),
    })).filter(item => item.key),
    stages: list(source.stages).map(normalizeStage),
    // 워커가 저장하지 못하고 있다는 사실. 여기서 떨어뜨리면 관제탑은 "연결됨" 만 보고
    // 화면에서 넣은 값이 왜 안 붙는지 끝내 말해 주지 못한다.
    storage: {
      ok: record(source.storage).ok !== false,
      warning: text(record(source.storage).warning),
    },
    progress: clone(record(source.progress)),
    registration: clone(record(source.registration)),
    receipts: list(source.receipts).map(clone),
    products: list(source.products).map(clone),
  };
  return freezeTree(projection);
}

function sameFactoryProjectionWork(current, incoming) {
  return current.connected === true
    && incoming.connected === true
    && PROJECTION_WORK_IDENTITY_FIELDS.every(field => {
      const currentValue = text(current.session[field]);
      return currentValue && currentValue === text(incoming.session[field]);
    });
}

function preserveFactoryProjectionStage(incoming, current) {
  if (!current || incoming.candidates.length >= current.candidates.length) {
    if (incoming.selectedId || !current?.selectedId) return incoming;
    const selected = current.candidates.find(candidate => candidate.id === current.selectedId);
    return {
      ...incoming,
      selectedId: current.selectedId,
      candidates: selected && !incoming.candidates.some(candidate => candidate.id === selected.id)
        ? [...incoming.candidates, clone(selected)]
        : incoming.candidates,
    };
  }
  const candidates = clone(current.candidates);
  const selectedId = incoming.selectedId || current.selectedId;
  const selected = incoming.candidates.find(candidate => candidate.id === selectedId);
  if (selected && !candidates.some(candidate => candidate.id === selected.id)) candidates.push(clone(selected));
  return { ...incoming, candidates, selectedId };
}

export function reconcileFactoryProjectionForSameWork(currentValue, incomingValue) {
  const current = normalizeFactoryProjection(currentValue);
  const incoming = normalizeFactoryProjection(incomingValue);
  if (!sameFactoryProjectionWork(current, incoming)) return incoming;
  const currentStages = new Map(current.stages.map(stage => [stage.key, stage]));
  const stages = incoming.stages.map(stage => preserveFactoryProjectionStage(stage, currentStages.get(stage.key)));
  for (const stage of current.stages) {
    if (incoming.stages.some(candidate => candidate.key === stage.key)) continue;
    if (stage.candidates.length || stage.selectedId) stages.push(clone(stage));
  }
  return normalizeFactoryProjection({ ...incoming, stages });
}

export function disconnectedFactoryProjection(reason = 'factory_session_missing') {
  return Object.freeze({
    schema: FACTORY_CONTROL_PROJECTION_VERSION,
    connected: false,
    status: 'blocked',
    reason: text(reason) || 'factory_session_missing',
    inputs: Object.freeze([]),
    stages: Object.freeze([]),
  });
}

function assertIdentity(current, event) {
  const session = current.session;
  const pairs = [
    [event.productId, session.productId],
    [event.productKey, session.productKey],
    [event.runId, session.runId],
    [event.inputFingerprint, session.inputFingerprint],
  ];
  if (pairs.some(([incoming, expected]) => text(incoming) !== text(expected))) {
    throw new FactorySyncConflict('stale_run_fingerprint');
  }
  if (integer(event.revision) < session.revision) {
    throw new FactorySyncConflict('stale_workfile_revision');
  }
}

export function applyFactoryDelta(currentValue, eventValue) {
  const current = normalizeFactoryProjection(currentValue);
  const event = record(eventValue);
  if (event.schema !== FACTORY_CONTROL_EVENT_VERSION) {
    throw new TypeError('factory event version unsupported');
  }
  const sequence = integer(event.sequence);
  if (sequence <= current.sequence) throw new FactorySyncConflict('stale_event_sequence');
  assertIdentity(current, event);
  const next = clone(current);
  next.sequence = sequence;
  next.cursor = text(event.eventId || sequence);
  next.capturedAt = text(event.occurredAt || next.capturedAt);
  next.session.revision = integer(event.revision, next.session.revision);
  if (event.stage) {
    const stage = normalizeStage(event.stage);
    const index = next.stages.findIndex(item => item.key === stage.key);
    if (index < 0) next.stages.push(stage);
    else next.stages[index] = stage;
  }
  if (event.progress) next.progress = clone(record(event.progress));
  if (event.registration) next.registration = clone(record(event.registration));
  if (event.receipt) {
    const receiptId = text(record(event.receipt).receiptId);
    if (!receiptId || !next.receipts.some(item => text(item.receiptId) === receiptId)) {
      next.receipts.push(clone(event.receipt));
    }
  }
  return reconcileFactoryProjectionForSameWork(current, next);
}

export function resumeFactoryEvents(initial, events, cursor = '') {
  let current = normalizeFactoryProjection(initial);
  const seen = new Set([text(cursor), text(current.cursor)].filter(Boolean));
  for (const event of list(events)) {
    const eventId = text(record(event).eventId || record(event).sequence);
    if (!eventId || seen.has(eventId) || integer(record(event).sequence) <= current.sequence) continue;
    current = applyFactoryDelta(current, event);
    seen.add(eventId);
  }
  return current;
}

export function buildACutSelectionCommand(projectionValue, selectionValue) {
  const projection = normalizeFactoryProjection(projectionValue);
  if (!projection.connected) throw new FactorySyncConflict('factory_session_missing');
  const selection = record(selectionValue);
  const stageKey = text(selection.stageKey);
  const candidateId = text(selection.candidateId);
  const stage = projection.stages.find(item => item.key === stageKey);
  if (!stage || !stage.candidates.some(candidate => candidate.id === candidateId)) {
    throw new TypeError('factory A-cut candidate missing');
  }
  const session = projection.session;
  return freezeTree({
    capabilityVersion: FACTORY_CONTROL_COMMAND_VERSION,
    command: 'selectFactoryACut',
    productId: session.productId,
    productKey: session.productKey,
    stageKey,
    candidateId,
    expectedRevision: session.revision,
    expectedRunId: session.runId,
    expectedInputFingerprint: session.inputFingerprint,
    idempotencyKey: `a-cut:${session.productKey}:${stageKey}:${candidateId}:${session.revision}`,
  });
}

export function projectFactoryProductPage(productsValue, options = {}) {
  const products = list(productsValue);
  const limit = Math.max(1, Math.min(25, integer(options.limit, 15)));
  const maximumStart = Math.max(0, products.length - Math.min(limit, products.length));
  const requestedStart = integer(options.start);
  const start = requestedStart >= products.length ? maximumStart : requestedStart;
  return freezeTree({
    total: products.length,
    start,
    limit,
    items: clone(products.slice(start, start + limit)),
  });
}
