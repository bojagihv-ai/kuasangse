/**
 * 작업대 부팅 — 관제탑 상태를 2초마다 읽고, 줄을 그리고, 행의 버튼을 API 에 잇는다.
 *
 * 화면은 세 자리뿐이다: 제품 넣기(접힘) · 줄 · 진단(접힘). 옛 앞면(control-tower.html)은
 * 그대로 두고 진단에서 연다 — 지우는 게 아니라 자리를 옮긴다.
 *
 * 펼친 행에서 사람이 하는 일 셋(컷 고르기 · 값 채우기 · Cafe24 승인)이 여기서 API 로 간다:
 *   컷    → POST /api/factory/jobs/selections (손: mode=manual · 자동: mode=auto + judgementOptions.provider)
 *   값    → POST /api/factory/jobs/{id}/values (바뀐 칸만) · GET /api/pdp/sources?q= (신화DB 찾기)
 *   Cafe24 → 미리보기 → 승인 → 확인 → 등록, 옛 앞면과 같은 네 본문. 관문은 조립공장이 지금 연 제품에만 걸린다.
 */
import { apiRequest, ORIGINS } from './api.mjs?wb=1';
import { FILTERS, buildQueueModel, renderQueue } from './queue.mjs?wb=1';

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = value => (Array.isArray(value) ? value : []);

const DELETE_COPY = Object.freeze({
  factory_product_job_not_found: '이미 지워진 작업입니다.',
  factory_product_job_busy: '조립공장이 지금 이 작업을 처리하는 중이라 지울 수 없습니다. 끝나거나 멈춘 뒤 다시 시도하세요.',
  factory_product_job_active_session: '지금 조립공장이 붙잡고 있는 작업이라 지울 수 없습니다. 다른 제품으로 넘어간 뒤 지우세요.',
  factory_product_job_already_registered: 'Cafe24 에 이미 등록된 작업이라 지울 수 없습니다. 실제로 올라간 기록은 남겨 둡니다.',
});

/** 사람 말로 바꿔 줄 오류 코드. 없는 코드는 코드 그대로 보인다 — 숨기지 않는다. */
const ERROR_COPY = Object.freeze({
  oauth_not_ready: '판정자 로그인이 안 되어 있습니다. API 허브에서 GPT/Claude 로그인을 먼저 하세요.',
  judge_provider_invalid: '관제탑이 모르는 판정자입니다.',
  candidate_membership_invalid: '그 컷은 이 단계의 후보가 아닙니다. 화면을 새로 고치고 다시 고르세요.',
  factory_selection_pending: '이미 예약된 선택이 있습니다. 조립공장이 적용한 뒤 다시 시도하세요.',
  factory_product_values_invalid: '관제탑이 받지 않는 값 이름이 섞였습니다.',
  factory_session_missing: '조립공장 연결이 끊겼습니다. 조립공장 창을 다시 여세요.',
  factory_worker_busy: '조립공장이 다른 작업을 돌리는 중입니다. 끝난 뒤 여세요.',
  factory_product_job_not_resumable: '지금은 열 수 없는 상태입니다.',
  cafe24_preflight_blocked: '등록 준비가 덜 됐습니다 — 분류·상세페이지·이미지 중 빠진 것이 있습니다.',
  factory_cafe24_approval_required: '승인 관문을 거쳐야 등록됩니다.',
  stale_run_fingerprint: '조립공장 상태가 바뀌었습니다. 화면을 새로 고친 뒤 다시 하세요.',
});

/** 자동 판정 기본 옵션. 옛 앞면의 기본값과 같다. provider 만 버튼이 정한다. */
export const JUDGEMENT_DEFAULTS = Object.freeze({
  model: 'latestModel',
  reasoningEffort: 'medium',
  serviceTier: 'standard',
  preset: 'fast_single',
});

const state = {
  jobs: [],
  projection: {},
  filter: 'all',
  openJobId: '',
  busy: new Set(),
  lastError: '',
  panel: emptyPanel(''),
};

function emptyPanel(jobId) {
  return {
    jobId,
    pick: { chosen: {}, receipt: null, note: '', busy: false },
    values: { sources: [], searched: false, prefill: {}, note: '', busy: false },
    gate: { step: '', done: [], error: '', result: null },
  };
}

const roots = {};

function $(id) { return document.getElementById(id); }

function setStatus(message, tone = 'info') {
  if (!roots.status) return;
  roots.status.textContent = message;
  roots.status.dataset.tone = tone;
  roots.status.hidden = !message;
}

function humanError(error) {
  const code = text(error?.code);
  return ERROR_COPY[code] || text(error?.message || error) || code || '알 수 없는 오류';
}

function activeJobId() {
  return text(record(state.projection.registration).jobId);
}

function jobById(jobId) {
  return state.jobs.find(job => text(job.jobId) === text(jobId)) || null;
}

function panelFor(jobId) {
  if (state.panel.jobId !== jobId) state.panel = emptyPanel(jobId);
  return state.panel;
}

function renderHeader(model) {
  $('wb-count-mine').textContent = String(model.counts.mine);
  $('wb-count-run').textContent = String(model.counts.run);
  $('wb-count-done').textContent = String(model.counts.done);
  $('wb-headline').textContent = model.headline;
}

function renderFilters(model) {
  const root = roots.filters;
  root.replaceChildren();
  for (const filter of FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-btn sm';
    button.dataset.queueFilter = filter.key;
    button.setAttribute('aria-pressed', String(state.filter === filter.key));
    const count = filter.key === 'all' ? model.rows.length : model.counts[filter.key] ?? 0;
    button.textContent = `${filter.label} ${count}`;
    button.addEventListener('click', () => { state.filter = filter.key; render(); });
    root.append(button);
  }
}

function renderDiag() {
  const root = roots.diag;
  if (!root || root.hidden) return;
  const projection = state.projection;
  const worker = record(projection.workerSession);
  const rows = [
    ['조립공장', projection.connected === true ? `연결됨 · ${text(worker.workerId) || '워커'}` : `연결 안 됨${text(projection.reason) ? ` · ${text(projection.reason)}` : ''}`],
    ['관제 서버', ORIGINS.apiBase],
    ['API 허브', ORIGINS.apiHub],
    ['조립공장 주소', ORIGINS.factoryBackend],
    ['지금 열린 제품', activeJobId() || '없음'],
    ['줄에 선 작업', `${state.jobs.length}건`],
  ];
  const dl = document.createElement('dl');
  dl.className = 'wb-kv';
  for (const [key, value] of rows) {
    const dt = document.createElement('dt'); dt.textContent = key;
    const dd = document.createElement('dd'); dd.textContent = value;
    dl.append(dt, dd);
  }
  $('wb-diag-body').replaceChildren(dl);
}

/** 값 복사 후보 — 줄에서 값을 이미 가진 다른 제품. */
function siblingsWithValues() {
  return state.jobs
    .filter(job => Object.values(record(job.requiredValues)).some(value => text(value)))
    .map(job => ({ jobId: text(job.jobId), productName: text(job.productName), requiredValues: record(job.requiredValues) }));
}

function render() {
  // 글자를 치는 중이면 다시 그리지 않는다 — 입력이 날아간다.
  const active = document.activeElement;
  if (roots.queue.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName)) return;
  const model = buildQueueModel({ jobs: state.jobs, projection: state.projection, activeJobId: activeJobId() });
  renderHeader(model);
  renderFilters(model);
  const panel = state.openJobId ? panelFor(state.openJobId) : emptyPanel('');
  renderQueue(roots.queue, model, {
    filter: state.filter,
    openJobId: state.openJobId,
    projection: state.projection,
    panel: { ...panel, siblings: siblingsWithValues() },
    handlers: {
      open: row => { state.openJobId = state.openJobId === row.jobId ? '' : row.jobId; render(); },
      resume: jobId => void resumeJob(jobId),
      remove: (jobId, productName) => void removeJob(jobId, productName),
      choose: ({ stageKey, candidateId }) => {
        const current = panelFor(state.openJobId);
        current.pick.chosen = { ...current.pick.chosen, [stageKey]: candidateId };
        render();
      },
      select: request => void selectCandidate(request),
      judge: request => void judgeCandidates(request),
      save: (jobId, values) => void saveValues(jobId, values),
      search: query => void searchSources(query),
      importSource: source => importSource(source),
      copyFrom: jobId => copyValuesFrom(jobId),
      openInFactory: jobId => void openInFactory(jobId),
      publish: jobId => void publishToCafe24(jobId),
    },
  });
  renderDiag();
}

async function resumeJob(jobId) {
  if (state.busy.has(jobId)) return;
  state.busy.add(jobId);
  try {
    const response = await apiRequest('/api/factory/jobs/resume', { method: 'POST', body: { jobIds: [jobId] } });
    const failed = Number(response?.failed || 0);
    const reason = list(response?.results).map(r => text(r?.reason)).filter(Boolean)[0];
    setStatus(failed ? `다시 시작하지 못했습니다${reason ? ` · ${ERROR_COPY[reason] || reason}` : ''}` : '저장된 지점부터 다시 시작했습니다.', failed ? 'error' : 'ok');
    await refresh();
  } catch (error) {
    setStatus(`다시 시작 실패 · ${humanError(error)}`, 'error');
  } finally {
    state.busy.delete(jobId);
    render();
  }
}

async function removeJob(jobId, productName) {
  if (state.busy.has(jobId)) return;
  const label = productName || jobId;
  if (!globalThis.confirm(`${label} 작업을 지울까요? 되돌릴 수 없고, 저장 기록에서도 실제로 없어집니다.`)) return;
  state.busy.add(jobId);
  try {
    const result = await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    state.jobs = state.jobs.filter(job => text(job.jobId) !== jobId);
    if (state.openJobId === jobId) state.openJobId = '';
    if (roots.queue.contains(document.activeElement)) document.activeElement.blur();
    setStatus(`${text(result?.productName) || label} 작업을 지웠습니다.`, 'ok');
  } catch (error) {
    setStatus(DELETE_COPY[text(error?.code)] || `작업을 지우지 못했습니다 · ${humanError(error)}`, 'error');
  } finally {
    state.busy.delete(jobId);
    render();
  }
}

/** 예약 선택 결과 한 건을 사람 말로. status 는 applied · reserved · skipped · error. */
function selectionCopy(result, who) {
  const status = text(result?.status);
  const reason = text(result?.reason);
  if (status === 'applied') return { message: `${who} 컷을 골랐습니다 · 조립공장이 바로 이어 갑니다.`, tone: 'ok' };
  if (status === 'reserved') return { message: `${who} 컷을 예약했습니다 · 조립공장이 이 제품을 다시 열면 적용됩니다.`, tone: 'ok' };
  if (status === 'skipped') return { message: `${who} 건너뜀 · ${ERROR_COPY[reason] || reason || '고를 단계가 없습니다'}`, tone: 'error' };
  return { message: `${who} 실패 · ${ERROR_COPY[reason] || reason || '알 수 없는 이유'}`, tone: 'error' };
}

async function selectCandidate({ jobId, stageKey, candidateId }) {
  const panel = panelFor(jobId);
  if (panel.pick.busy || !text(candidateId)) return;
  panel.pick.busy = true;
  render();
  try {
    const response = await apiRequest('/api/factory/jobs/selections', {
      method: 'POST',
      body: { mode: 'manual', selections: [{ jobId, stageKey, candidateId }], autoResume: true },
    });
    const result = list(response?.results)[0];
    const copy = selectionCopy(result, `${stageKey} ${candidateId}`);
    setStatus(copy.message, copy.tone);
    if (copy.tone === 'ok') panel.pick.chosen = {};
    await refresh();
  } catch (error) {
    setStatus(`컷 선택 실패 · ${humanError(error)}`, 'error');
  } finally {
    panel.pick.busy = false;
    render();
  }
}

async function judgeCandidates({ jobId, provider }) {
  const panel = panelFor(jobId);
  if (panel.pick.busy) return;
  panel.pick.busy = true;
  panel.pick.note = `${provider === 'claude-oauth' ? 'Claude' : 'GPT'} 가 후보를 보는 중… 보통 10초 안팎입니다.`;
  render();
  try {
    const response = await apiRequest('/api/factory/jobs/selections', {
      method: 'POST',
      body: { mode: 'auto', jobIds: [jobId], judgementOptions: { ...JUDGEMENT_DEFAULTS, provider }, autoResume: true },
    });
    const result = list(response?.results)[0];
    const receipt = record(result?.decisionReceipt);
    panel.pick.receipt = Object.keys(receipt).length
      ? { provider: text(receipt.provider) || provider, candidateId: text(result?.candidateId), ...receipt }
      : null;
    const copy = selectionCopy(result, provider === 'claude-oauth' ? 'Claude 가' : 'GPT 가');
    setStatus(copy.message, copy.tone);
    panel.pick.note = copy.tone === 'ok' ? '' : text(receipt.reason) || '';
    await refresh();
  } catch (error) {
    panel.pick.note = '';
    setStatus(`자동 선택 실패 · ${humanError(error)}`, 'error');
  } finally {
    panel.pick.busy = false;
    render();
  }
}

async function saveValues(jobId, values) {
  const panel = panelFor(jobId);
  if (panel.values.busy) return;
  const changed = Object.fromEntries(Object.entries(record(values)).filter(([, value]) => typeof value === 'string'));
  if (!Object.keys(changed).length) {
    panel.values.note = '바뀐 값이 없습니다.';
    render();
    return;
  }
  panel.values.busy = true;
  render();
  try {
    await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/values`, { method: 'POST', body: changed });
    panel.values.prefill = {};
    panel.values.note = '';
    setStatus(`값 ${Object.keys(changed).length}칸을 저장했습니다 · 조립공장이 이 값으로 이어 갑니다.`, 'ok');
    await refresh();
  } catch (error) {
    setStatus(`값 저장 실패 · ${humanError(error)}`, 'error');
  } finally {
    panel.values.busy = false;
    render();
  }
}

async function searchSources(query) {
  const panel = panelFor(state.openJobId);
  const q = text(query);
  if (!q) return;
  try {
    const response = await apiRequest(`/api/pdp/sources?q=${encodeURIComponent(q)}`);
    panel.values.sources = list(response?.sources);
    panel.values.searched = true;
    if (roots.queue.contains(document.activeElement)) document.activeElement.blur();
  } catch (error) {
    setStatus(`신화DB 찾기 실패 · ${humanError(error)}`, 'error');
  }
  render();
}

/** 신화DB 제품에서 가져올 수 있는 것: 이름과 분류. 나머지 값은 사람이 채운다 — 없는 값을 지어내지 않는다. */
function importSource(source) {
  const panel = panelFor(state.openJobId);
  const next = {};
  if (text(source?.productName)) next.productName = text(source.productName);
  if (text(source?.category)) next.category = text(source.category);
  panel.values.prefill = { ...panel.values.prefill, ...next };
  panel.values.note = Object.keys(next).length
    ? `신화DB J${text(source?.jcode)} 에서 ${Object.keys(next).length}칸을 채웠습니다. 저장을 눌러야 반영됩니다.`
    : '이 제품에는 가져올 값이 없습니다.';
  render();
}

/** 줄의 다른 제품에서 값 복사 — 빈 칸만 채운다. 이미 적힌 값은 건드리지 않는다. */
function copyValuesFrom(fromJobId) {
  const panel = panelFor(state.openJobId);
  const source = record(jobById(fromJobId)?.requiredValues);
  const current = record(jobById(state.openJobId)?.requiredValues);
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    if (text(value) && !text(current[key]) && !text(panel.values.prefill[key])) next[key] = text(value);
  }
  panel.values.prefill = { ...panel.values.prefill, ...next };
  panel.values.note = Object.keys(next).length
    ? `${text(jobById(fromJobId)?.productName) || fromJobId} 에서 빈 칸 ${Object.keys(next).length}개를 채웠습니다. 저장을 눌러야 반영됩니다.`
    : '채울 빈 칸이 없습니다.';
  render();
}

/** 조립공장에서 이 제품을 연다(돌리지는 않는다). 저장 지점이 있으면 그 지점을 기대값으로 보낸다. */
async function openInFactory(jobId) {
  if (state.busy.has(jobId)) return;
  state.busy.add(jobId);
  const job = record(jobById(jobId));
  const body = { restoreOnly: true };
  if (Number.isInteger(job.checkpointRevision)) body.expectedCheckpointRevision = job.checkpointRevision;
  if (text(job.checkpointRunId)) body.expectedCheckpointRunId = text(job.checkpointRunId);
  try {
    await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST', body });
    setStatus('조립공장에서 이 제품을 여는 중입니다. 열리면 이 자리에 승인 버튼이 뜹니다.', 'ok');
    await refresh();
  } catch (error) {
    setStatus(`열지 못했습니다 · ${humanError(error)}`, 'error');
  } finally {
    state.busy.delete(jobId);
    render();
  }
}

/** 옛 앞면의 buildCafe24StagingPayload 와 같은 본문. 조립공장이 지금 연 제품의 등록 사실로만 만든다. */
export function stagingPayload(projection) {
  const source = record(projection);
  const registration = record(source.registration);
  const session = record(source.session);
  const blockers = list(registration.blockers).map(text).filter(Boolean);
  if (source.connected !== true) throw Object.assign(new Error('factory_session_missing'), { code: 'factory_session_missing' });
  if (blockers.length) throw Object.assign(new Error('cafe24_preflight_blocked'), { code: 'cafe24_preflight_blocked' });
  const payload = {
    batchId: text(registration.batchId || session.workspaceId || session.runId),
    productId: text(registration.productId || session.productId),
    productKey: text(registration.productKey || session.productKey),
    categoryId: text(registration.categoryId),
    htmlDigest: text(registration.htmlDigest),
    imageDigests: list(registration.imageDigests).map(text).filter(Boolean),
    expectedWorkfileRevision: Number.isInteger(registration.expectedWorkfileRevision) ? registration.expectedWorkfileRevision : session.revision,
    expectedRunId: text(session.runId),
    expectedInputFingerprint: text(session.inputFingerprint),
    idempotencyKey: text(registration.idempotencyKey),
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  };
  if (!payload.batchId || !payload.productId || !payload.productKey || !payload.categoryId || !payload.htmlDigest
    || !payload.imageDigests.length || !payload.expectedRunId || !payload.expectedInputFingerprint) {
    throw Object.assign(new Error('cafe24_preflight_blocked'), { code: 'cafe24_preflight_blocked' });
  }
  return payload;
}

/** 승인 묶음 — 미리보기가 준 다이제스트·기대값을 뒤 세 단계가 그대로 되돌려 준다. */
export function approvalBinding(preview) {
  const source = record(preview);
  const payload = record(source.payload);
  return Object.fromEntries([
    'payloadDigest', 'productId', 'productKey', 'expectedWorkfileRevision', 'expectedRunId', 'expectedInputFingerprint', 'idempotencyKey',
  ].map(key => [key, key in source ? source[key] : payload[key]]));
}

async function publishToCafe24(jobId) {
  const panel = panelFor(jobId);
  if (panel.gate.step) return;
  if (activeJobId() !== jobId) {
    setStatus('조립공장이 지금 다른 제품을 열고 있습니다. 이 제품을 먼저 여세요.', 'error');
    return;
  }
  const productName = text(jobById(jobId)?.productName) || jobId;
  if (!globalThis.confirm(`${productName} 을(를) Cafe24 스토어에 실제로 등록합니다. 진행할까요?`)) return;
  panel.gate = { step: 'preview', done: [], error: '', result: null };
  render();
  const step = async (key, run) => {
    panel.gate.step = key;
    render();
    const value = await run();
    panel.gate.done = [...panel.gate.done, key];
    return value;
  };
  try {
    const preview = await step('preview', () => apiRequest('/api/cafe24/staging-preview', { method: 'POST', body: stagingPayload(state.projection) }));
    const binding = approvalBinding(preview);
    const approved = await step('approve', () => apiRequest('/api/cafe24/approve', {
      method: 'POST', body: { approvalRequestId: preview.approvalRequestId, approved: true, ...binding },
    }));
    const confirmation = await step('confirm', () => apiRequest('/api/cafe24/confirm', {
      method: 'POST', body: { approvalToken: approved.approvalToken, confirmed: true, ...binding },
    }));
    const result = await step('publish', () => apiRequest('/api/cafe24/publish', {
      method: 'POST', body: { jobId, approvalToken: approved.approvalToken, confirmationNonce: confirmation.confirmationNonce, ...binding },
    }));
    panel.gate.step = '';
    panel.gate.result = { status: text(result?.status), receiptId: text(record(result?.publicationReceipt).receiptId) };
    // 관문 네 칸을 먼저 "끝" 으로 그린다 — 상태 재조회(refresh)를 기다리는 동안 마지막 칸이 "진행 중" 으로 남지 않게.
    render();
    setStatus(`${productName} 을(를) Cafe24 에 등록했습니다 · ${text(result?.status) || '접수'}`, 'ok');
    await refresh();
  } catch (error) {
    panel.gate.step = '';
    panel.gate.error = `${humanError(error)}${text(error?.code) ? ` (${text(error.code)})` : ''}`;
    setStatus(`Cafe24 등록 실패 · ${humanError(error)}`, 'error');
  } finally {
    render();
  }
}

async function refresh() {
  try {
    const [jobs, projection] = await Promise.all([
      apiRequest('/api/factory/jobs'),
      apiRequest('/api/factory/state'),
    ]);
    if (Array.isArray(jobs?.jobs)) state.jobs = jobs.jobs;
    if (projection && typeof projection === 'object') state.projection = projection;
    state.lastError = '';
  } catch (error) {
    state.lastError = text(error?.message || error);
    setStatus(`관제탑 상태를 못 읽었습니다 · ${state.lastError}`, 'error');
  }
  render();
}

function bindShell() {
  roots.queue = $('wb-queue');
  roots.filters = $('wb-filters');
  roots.status = $('wb-status');
  roots.diag = $('wb-diag');
  const intake = $('wb-intake');
  const toggleIntake = open => {
    intake.hidden = !open;
    $('wb-btn-intake').setAttribute('aria-expanded', String(open));
  };
  $('wb-btn-intake').addEventListener('click', () => toggleIntake(intake.hidden));
  $('wb-btn-intake-close')?.addEventListener('click', () => toggleIntake(false));
  const toggleDiag = open => {
    roots.diag.hidden = !open;
    $('wb-btn-diag').setAttribute('aria-expanded', String(open));
    if (open) renderDiag();
  };
  $('wb-btn-diag').addEventListener('click', () => toggleDiag(roots.diag.hidden));
  $('wb-old-page').href = `./control-tower.html${globalThis.location.search}`;
}

export function boot() {
  bindShell();
  void refresh();
  globalThis.setInterval(() => void refresh(), 2000);
}

if (typeof document !== 'undefined' && document.getElementById('wb-queue')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
