import { normalizeFactoryProjection } from './factory-sync-model.mjs?selectedId=4';

const FACTORY_PROJECTION_SCHEMA = 'factory-control-projection:v1';
const FACTORY_COMMAND_VERSION = 'factory-control-command:v1';
const FACTORY_STAGE_KEYS = Object.freeze([
  'representative',
  'size',
  'option_color',
  'general',
  'sections',
  'final_detail',
]);

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

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function durableCandidate(value) {
  const source = record(value);
  const id = firstText(source.id, source.candidateId, source.assetId);
  if (!id) return null;
  return {
    id,
    assetId: firstText(source.assetId, id),
    thumbnailUrl: firstText(source.thumbnailUrl, source.thumbnailRef),
    digest: text(source.digest),
    source: text(source.source),
    model: text(source.model),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
    rationale: text(source.rationale),
    receipt: source.receipt && typeof source.receipt === 'object' && !Array.isArray(source.receipt)
      ? { ...source.receipt }
      : null,
  };
}

function durableStage(value) {
  const source = record(value);
  const key = firstText(source.key, source.stageKey);
  if (!FACTORY_STAGE_KEYS.includes(key)) return null;
  const candidates = list(source.candidates).map(durableCandidate).filter(Boolean);
  const selectedId = firstText(source.selectedId, source.selectedCandidateId, list(source.selectedIds)[0]);
  return {
    key,
    status: text(source.status || (selectedId ? 'completed' : candidates.length ? 'waiting_manual' : 'empty')),
    selectedId: candidates.some(candidate => candidate.id === selectedId) ? selectedId : '',
    updatedAt: text(source.updatedAt),
    candidates,
  };
}

export function createDurableJobProjection(jobValue, fallbackValue = {}) {
  const job = record(jobValue);
  const progress = record(job.progress);
  const fallback = record(fallbackValue);
  const fallbackSession = record(fallback.session);
  const fallbackRegistration = record(fallback.registration);
  const stages = list(progress.stages).map(durableStage).filter(Boolean);
  if (!stages.some(stage => stage.candidates.length || stage.selectedId)) return null;
  const jobId = text(job.jobId);
  const productName = firstText(job.productName, fallbackSession.productKey);
  const registrationProgress = record(progress.registration);
  const productKey = firstText(
    registrationProgress.productKey,
    fallbackRegistration.productKey,
    fallbackSession.productKey,
    productName,
  );
  return normalizeFactoryProjection({
    schema: FACTORY_PROJECTION_SCHEMA,
    capabilityVersion: firstText(fallback.capabilityVersion, FACTORY_COMMAND_VERSION),
    cursor: firstText(fallback.cursor, `job:${jobId}`),
    sequence: integer(fallback.sequence),
    connected: false,
    status: 'blocked',
    reason: 'factory_session_missing',
    capturedAt: firstText(progress.updatedAt, fallback.capturedAt),
    session: {
      workspaceId: firstText(fallbackSession.workspaceId, job.workspaceId),
      productId: firstText(fallbackSession.productId, job.productId, registrationProgress.productId),
      productKey,
      runId: firstText(fallbackSession.runId, job.runId, job.currentRunId),
      inputFingerprint: firstText(fallbackSession.inputFingerprint, job.inputFingerprint),
      revision: integer(fallbackSession.revision, integer(job.revision)),
      workfileName: firstText(fallbackSession.workfileName, job.workfileName),
      workfileSource: text(fallbackSession.workfileSource),
      workfileSha256: firstText(fallbackSession.workfileSha256, job.sourceSha256),
      workfileBytes: integer(fallbackSession.workfileBytes),
    },
    inputs: list(fallback.inputs),
    stages,
    progress,
    registration: {
      ...fallbackRegistration,
      ...registrationProgress,
      jobId: firstText(registrationProgress.jobId, fallbackRegistration.jobId, jobId),
      productId: firstText(registrationProgress.productId, fallbackRegistration.productId, job.productId),
      productKey,
    },
    receipts: list(fallback.receipts),
    products: list(fallback.products),
  });
}

export function workfileTabIdentity(value) {
  const source = record(value);
  const revision = Number(source.revision);
  return Object.freeze({
    workspaceId: firstText(source.workspaceId, source.projectId),
    productId: text(source.productId),
    productKey: text(source.productKey),
    runId: text(source.runId),
    inputFingerprint: text(source.inputFingerprint),
    revision: Number.isInteger(revision) && revision >= 0 ? revision : -1,
  });
}

export function workfileIdentityMatches(leftValue, rightValue) {
  if (list(record(leftValue).conflicts).length || list(record(rightValue).conflicts).length) return false;
  const left = workfileTabIdentity(leftValue);
  const right = workfileTabIdentity(rightValue);
  if (!left.workspaceId || !left.productId || !left.productKey || !left.inputFingerprint) return false;
  if (!right.workspaceId || !right.productId || !right.productKey || !right.inputFingerprint) return false;
  return left.workspaceId === right.workspaceId
    && left.productId === right.productId
    && left.productKey === right.productKey
    && left.inputFingerprint === right.inputFingerprint;
}

export function workfileTargetIdentityMatches(targetValue, workfileValue) {
  if (list(record(targetValue).conflicts).length || list(record(workfileValue).conflicts).length) return false;
  const target = workfileTabIdentity(targetValue);
  const workfile = workfileTabIdentity(workfileValue);
  if (!target.workspaceId || !target.productId || !target.productKey || !target.inputFingerprint) return false;
  if (!workfile.workspaceId || !workfile.productKey || !workfile.runId || !workfile.inputFingerprint || workfile.revision < 0) return false;
  if (workfile.productId && workfile.productId !== target.productId) return false;
  return workfile.workspaceId === target.workspaceId
    && workfile.productKey === target.productKey
    && workfile.inputFingerprint === target.inputFingerprint;
}

function workfileLinkState(tab, workfile) {
  if (text(record(workfile).targetJobId) === text(tab.jobId) && workfileTargetIdentityMatches(tab.identity, workfile.identity)) {
    const current = workfileTabIdentity(tab.identity);
    const incoming = workfileTabIdentity(workfile.identity);
    if (current.revision === incoming.revision && current.runId === incoming.runId) return 'linked';
    return text(tab.status) === 'blocked' ? 'target_rebind_required' : 'stale';
  }
  if (!workfile || !workfileIdentityMatches(tab.identity, workfile.identity)) return 'unlinked';
  const current = workfileTabIdentity(tab.identity);
  const incoming = workfileTabIdentity(workfile.identity);
  if (current.revision === incoming.revision && current.runId === incoming.runId) return 'linked';
  return text(tab.status) === 'blocked' ? 'rebind_required' : 'stale';
}

function publicWorkfileTab(tab, activeKey) {
  const workfile = tab.workfile;
  const projection = record(tab.projectionSnapshot);
  const stages = list(projection.stages);
  const workfileStages = list(record(record(workfile).classification).outputs?.stages);
  const selectedCount = stages.length
    ? stages.filter(stage => text(record(stage).selectedId)).length
    : workfileStages.reduce((total, stage) => total + Number(record(stage).selectedCount || 0), 0);
  const remainingCount = stages.length
    ? stages.filter(stage => list(record(stage).candidates).length && !text(record(stage).selectedId)).length
    : workfileStages.filter(stage => Number(record(stage).candidateCount || 0) && !Number(record(stage).selectedCount || 0)).length;
  const missingCount = workfile
    ? Number(record(record(workfile.classification).inputs).missingFieldCount || 0)
    : list(projection.inputs).reduce((total, input) => total + list(record(input).missing).length, 0);
  return Object.freeze({
    key: tab.key,
    jobId: text(tab.jobId),
    productName: text(tab.productName),
    workfileName: text(record(workfile).fileName || tab.workfileName),
    status: text(tab.status || 'queued'),
    stageKey: text(tab.selectedStageKey || tab.stageKey),
    mode: text(tab.mode || 'manual'),
    missingCount,
    selectedCount,
    remainingCount,
    linkState: tab.linkState || workfileLinkState(tab, workfile),
    active: tab.key === activeKey,
    selectedStageKey: text(tab.selectedStageKey),
    inspectedCandidateId: text(tab.inspectedCandidateId),
    recentSelection: tab.recentSelection ? Object.freeze({ ...tab.recentSelection }) : null,
  });
}

export function createWorkfileJobTabRegistry() {
  const tabs = new Map();
  const files = new Map();
  let activeKey = '';

  const snapshot = () => Object.freeze({
    activeKey,
    tabs: Object.freeze([...tabs.values()].map(tab => publicWorkfileTab(tab, activeKey))),
  });

  const syncJobs = (jobsValue, projectionValue) => {
    const jobs = list(jobsValue).filter(job => text(record(job).jobId));
    const current = normalizeFactoryProjection(projectionValue);
    const liveJobId = text(current.registration.jobId);
    const durableKeys = new Set(jobs.map(job => `job:${text(job.jobId)}`));
    for (const [key, tab] of tabs) {
      if (tab.jobId && !durableKeys.has(key)) tabs.delete(key);
    }
    for (const job of jobs) {
      const jobId = text(job.jobId);
      const key = `job:${jobId}`;
      const sourceSha256 = text(job.sourceSha256).toLowerCase();
      const fileKey = /^[a-f0-9]{64}$/u.test(sourceSha256) ? `file:${sourceSha256}` : '';
      const fileTab = fileKey ? tabs.get(fileKey) : null;
      const fileEntry = fileKey ? files.get(fileKey) : null;
      const sourceMatches = Boolean(
        fileTab
        && fileEntry
        && Number(job.sourceRevision) === workfileTabIdentity(fileEntry.identity).revision
        && text(job.sourceRunId) === workfileTabIdentity(fileEntry.identity).runId,
      );
      const previous = tabs.get(key) || (sourceMatches ? fileTab : {}) || {};
      const durableProjection = createDurableJobProjection(job, previous.projectionSnapshot);
      const projectionSnapshot = liveJobId === jobId
        ? current
        : durableProjection || previous.projectionSnapshot;
      const identity = projectionSnapshot
        ? workfileTabIdentity(record(projectionSnapshot).session)
        : workfileTabIdentity(previous.identity);
      const tab = {
        ...previous,
        key,
        jobId,
        productName: text(job.productName || previous.productName || jobId),
        workfileName: text(job.workfileName || previous.workfileName),
        status: text(job.status || previous.status || 'queued'),
        stageKey: text(job.stageKey || previous.stageKey),
        mode: text(job.mode || previous.mode || 'manual'),
        job: Object.freeze({ ...job }),
        projectionSnapshot,
        identity,
      };
      if (sourceMatches && fileKey) {
        files.set(key, fileEntry);
        files.delete(fileKey);
        tabs.delete(fileKey);
        if (activeKey === fileKey) activeKey = key;
      }
      tab.workfile = files.get(key) || previous.workfile || null;
      tab.linkState = workfileLinkState(tab, tab.workfile);
      tabs.set(key, tab);
    }
    if (!activeKey || !tabs.has(activeKey)) {
      activeKey = durableKeys.has(`job:${liveJobId}`) ? `job:${liveJobId}` : (tabs.keys().next().value || '');
    }
    return snapshot();
  };

  const registerWorkfile = (entryValue, targetJobIdValue = '') => {
    const entry = record(entryValue);
    const sha256 = text(entry.sha256).toLowerCase();
    const fileName = text(entry.fileName);
    if (!fileName || !/^[a-f0-9]{64}$/u.test(sha256)) {
      const error = new Error('workfile_identity_invalid');
      error.code = 'workfile_identity_invalid';
      throw error;
    }
    const matches = [...tabs.values()]
      .filter(tab => tab.jobId && workfileIdentityMatches(tab.identity, entry.identity))
      .map(tab => tab.jobId);
    if (matches.length === 1) {
      const key = `job:${matches[0]}`;
      files.set(key, entry);
      const tab = tabs.get(key);
      tab.workfile = entry;
      tab.workfileName = fileName;
      tab.linkState = workfileLinkState(tab, entry);
      tabs.set(key, tab);
      activeKey = key;
      return Object.freeze({ status: 'linked', tabKey: key, matches: Object.freeze(matches) });
    }
    const targetJobId = text(targetJobIdValue);
    const targetKey = `job:${targetJobId}`;
    const target = tabs.get(targetKey);
    if (
      target
      && activeKey === targetKey
      && text(target.status) === 'blocked'
      && workfileTargetIdentityMatches(target.identity, entry.identity)
    ) {
      const associatedEntry = Object.freeze({ ...entry, targetJobId });
      files.set(targetKey, associatedEntry);
      target.workfile = associatedEntry;
      target.workfileName = fileName;
      target.linkState = workfileLinkState(target, associatedEntry);
      tabs.set(targetKey, target);
      return Object.freeze({ status: target.linkState, tabKey: targetKey, matches: Object.freeze([]) });
    }
    const key = `file:${sha256}`;
    const previous = tabs.get(key) || {};
    const status = matches.length > 1 ? 'ambiguous' : 'unlinked';
    tabs.set(key, {
      ...previous,
      key,
      jobId: '',
      productName: text(record(entry.classification).product?.name || fileName),
      workfileName: fileName,
      status,
      stageKey: '',
      mode: 'manual',
      identity: workfileTabIdentity(entry.identity),
      workfile: entry,
      linkState: status,
    });
    files.set(key, entry);
    activeKey = key;
    return Object.freeze({ status, tabKey: key, matches: Object.freeze(matches) });
  };

  const activate = key => {
    const normalized = text(key);
    if (!tabs.has(normalized)) return false;
    activeKey = normalized;
    return true;
  };

  const rememberView = ({ selectedStageKey = '', inspectedCandidateId = '' } = {}) => {
    const tab = tabs.get(activeKey);
    if (!tab) return;
    tab.selectedStageKey = text(selectedStageKey);
    tab.inspectedCandidateId = text(inspectedCandidateId);
  };

  const rememberRecentSelection = ({ tabKey = activeKey, stageKey = '', candidateId = '' } = {}) => {
    const tab = tabs.get(text(tabKey));
    if (!tab) return;
    tab.recentSelection = Object.freeze({ stageKey: text(stageKey), candidateId: text(candidateId) });
  };

  const get = key => {
    const tab = tabs.get(text(key));
    return tab ? publicWorkfileTab(tab, activeKey) : null;
  };

  return Object.freeze({
    syncJobs,
    registerWorkfile,
    activate,
    rememberView,
    rememberRecentSelection,
    snapshot,
    get,
    active: () => get(activeKey),
    projectionFor: key => tabs.get(text(key))?.projectionSnapshot || null,
    jobFor: key => tabs.get(text(key))?.job || null,
    workfileFor: key => files.get(text(key)) || null,
  });
}
