/**
 * 작업대 부팅 — 관제탑 상태를 2초마다 읽고, 줄을 그리고, 행의 버튼을 API 에 잇는다.
 *
 * 화면은 세 자리뿐이다: 제품 넣기(접힘) · 줄 · 진단(접힘). 옛 앞면(control-tower.html)은
 * 그대로 두고 진단에서 연다 — 지우는 게 아니라 자리를 옮긴다.
 *
 * 펼친 행에서 사람이 하는 일이 여기서 API 로 간다:
 *   컷    → POST /api/factory/jobs/selections (손: mode=manual · 자동: mode=auto + judgementOptions.provider)
 *   값    → POST /api/factory/jobs/{id}/values (바뀐 칸만) · GET /api/pdp/sources?q= (신화DB 찾기)
 *   출처  → POST /api/factory/jobs/{id}/tab-command (tabId db · 옛 앞면의 DB 탭과 같은 명령) → 영수증 폴링
 *   Cafe24 → 미리보기 → 승인 → 확인 → 등록, 옛 앞면과 같은 네 본문. 관문은 조립공장이 지금 연 제품에만 걸린다.
 *
 * 자동 고르기: 제품별 토글(또는 전체 기본값)이 켜져 있으면 컷 고르기 차례가 올 때마다 그 판정자에게 맡긴다.
 * 같은 단계·같은 후보 수에는 한 번만 부른다(새로고침해도 — localStorage 에 적어 둔다).
 */
import { apiRequest, ORIGINS } from './api.mjs?wb=1';
import { FILTERS, buildQueueModel, renderQueue, autoPickFor } from './queue.mjs?wb=1';
import { mountIntake } from './intake.mjs?wb=1';
import { providerName } from './panels.mjs?wb=1';

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
  factory_tab_command_job_mismatch: '조립공장이 지금 다른 제품을 열고 있습니다.',
  factory_tab_command_action_invalid: '조립공장이 받지 않는 명령입니다.',
  factory_tab_command_invalid: '명령 본문이 조립공장 규격과 다릅니다.',
  factory_product_job_not_editable: '지금 상태에서는 조립공장이 고칠 수 없는 작업입니다.',
  policy_manual: '이 단계는 넣을 때 「내가 고른다」로 정해 두어 판정자가 고르지 않습니다. 컷을 눌러 직접 고르세요.',
  candidate_empty: '고를 후보가 아직 없습니다.',
  stage_not_waiting: '지금은 고르는 차례가 아닙니다.',
  stale_product_checkpoint: '저장 지점이 바뀌었습니다. 화면을 새로 고친 뒤 다시 하세요.',
  idempotency_conflict: '같은 요청이 이미 접수돼 있습니다.',
});

/** 자동 판정 기본 옵션. 옛 앞면의 기본값과 같다. provider 만 버튼이 정한다. */
export const JUDGEMENT_DEFAULTS = Object.freeze({
  model: 'latestModel',
  reasoningEffort: 'medium',
  serviceTier: 'standard',
  preset: 'fast_single',
});

const STORAGE = Object.freeze({
  autoPick: 'wb-auto-pick',
  autoPickDefault: 'wb-auto-pick-default',
  autoDone: 'wb-auto-pick-done',
});

function loadStored(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* 저장소가 없어도 화면은 돈다 */ }
}

const state = {
  jobs: [],
  projection: {},
  filter: 'all',
  openJobId: '',
  busy: new Set(),
  lastError: '',
  panels: new Map(),
  // 체크박스로 고른 작업들 — 한 번에 지운다.
  selected: new Set(),
  autoPick: record(loadStored(STORAGE.autoPick, {})),
  autoPickDefault: text(loadStored(STORAGE.autoPickDefault, '')),
  // jobId → { signature, at, error } — 같은 단계·후보 수에 두 번 묻지 않는다.
  autoDone: record(loadStored(STORAGE.autoDone, {})),
};

function emptyPanel(jobId) {
  return {
    jobId,
    pick: { chosen: {}, receipt: null, note: '', busy: false, prompts: {}, composeDraft: {} },
    values: { sources: [], searched: false, prefill: {}, note: '', busy: false },
    gate: { step: '', done: [], error: '', result: null },
    source: { busy: false, note: '' },
    // 섹션 편집 초안 — 저장 전 글자는 여기 있다가 다시 그릴 때 되살아난다. open 은 펼쳐 둔 섹션.
    sections: { drafts: {}, open: {}, expanded: false },
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
  if (!state.panels.has(jobId)) state.panels.set(jobId, emptyPanel(jobId));
  return state.panels.get(jobId);
}

/** 조립공장이 준 조작 자료(operator controls). 살아 있는 제품에만 있다. */
function operatorControls(projection) {
  const item = list(record(projection).inputs).find(input => text(input?.key) === 'operator_controls');
  return list(item?.items).find(entry => text(entry?.schema) === 'factory-operator-controls:v1') || null;
}

/**
 * 참조 단계에서 사람을 기다리는 살아 있는 제품 — { jobId, stage: 'db' | 'competitors', db, competitor } 또는 null.
 * 조립공장이 스스로 못 정한 출처(신화DB·Cafe24 매칭)나 경쟁사 후보 선택이 여기로 온다.
 */
function sourceWait() {
  const jobId = activeJobId();
  const job = jobById(jobId);
  const stage = text(job?.stageKey);
  if (!job || !['db', 'competitors'].includes(stage) || !['waiting_manual', 'blocked'].includes(text(job.status))) return null;
  const controls = operatorControls(state.projection);
  const db = record(controls?.db);
  const competitor = record(controls?.competitor);
  if (stage === 'db' && !Object.keys(db).length) return null;
  if (stage === 'competitors' && !Object.keys(competitor).length) return null;
  return { jobId, stage, db, competitor };
}

/** 살아 있는 제품의 섹션 15개 공정과 선택지 — { jobId, sections, options } 또는 null. 조립공장 조작 자료 그대로. */
function sectionsCtx() {
  const jobId = activeJobId();
  if (!jobId || !jobById(jobId)) return null;
  const controls = operatorControls(state.projection);
  const sections = list(controls?.sections);
  if (!sections.length) return null;
  return { jobId, sections, options: record(controls?.options) };
}

function renderHeader(model) {
  $('wb-count-mine').textContent = String(model.counts.mine);
  $('wb-count-run').textContent = String(model.counts.run);
  $('wb-count-done').textContent = String(model.counts.done);
  $('wb-headline').textContent = model.headline;
  const auto = $('wb-auto-pick-default');
  if (auto && auto.value !== state.autoPickDefault) auto.value = state.autoPickDefault;
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
    ['컷 자동 고르기', `${state.autoPickDefault ? `전체 기본 ${providerName(state.autoPickDefault)}` : '전체 기본 끔'} · 제품별 ${Object.keys(state.autoPick).length}건`],
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

function currentModel() {
  return buildQueueModel({ jobs: state.jobs, projection: state.projection, activeJobId: activeJobId() });
}

function render() {
  // 글자를 치는 중이면 다시 그리지 않는다 — 입력이 날아간다. 체크박스·라디오·버튼은 글자가 아니다.
  const active = document.activeElement;
  const typing = active && roots.queue.contains(active) && (
    active.tagName === 'TEXTAREA' || active.tagName === 'SELECT'
    || (active.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(String(active.type || 'text').toLowerCase()))
  );
  if (typing) return;
  const model = currentModel();
  renderHeader(model);
  renderFilters(model);
  const panel = state.openJobId ? panelFor(state.openJobId) : emptyPanel('');
  renderQueue(roots.queue, model, {
    filter: state.filter,
    openJobId: state.openJobId,
    projection: state.projection,
    panel: { ...panel, siblings: siblingsWithValues() },
    autoPick: state.autoPick,
    autoPickDefault: state.autoPickDefault,
    source: sourceWait() || {},
    sections: sectionsCtx() || {},
    selected: state.selected,
    handlers: {
      remember: (key, value) => { panelFor(state.openJobId).sections.drafts[key] = value; },
      rememberOpen: (id, open) => {
        const current = panelFor(state.openJobId).sections;
        if (id === '__root') current.expanded = open === true;
        else current.open[id] = open === true;
      },
      toggleSelect: (jobId, checked) => {
        if (checked) state.selected.add(jobId); else state.selected.delete(jobId);
        renderBulk();
      },
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
      showPrompt: ({ archiveId }) => void loadCutPrompt(archiveId),
      prefillCompose: ({ stageKey, prompt }) => {
        const current = panelFor(state.openJobId);
        current.pick.composeDraft = { ...current.pick.composeDraft, [stageKey]: prompt };
        render();
      },
      rememberCompose: ({ stageKey, prompt }) => { panelFor(state.openJobId).pick.composeDraft[stageKey] = prompt; },
      compose: request => void composeCut(request),
      save: (jobId, values) => void saveValues(jobId, values),
      search: query => void searchSources(query),
      importSource: source => importSource(source),
      copyFrom: jobId => copyValuesFrom(jobId),
      openInFactory: jobId => void openInFactory(jobId),
      publish: jobId => void publishToCafe24(jobId),
      recover: request => void recoverJob(request),
      setAutoPick: ({ jobId, provider }) => setAutoPick(jobId, provider),
      tabCommand: request => void sendTabCommand(request),
    },
  });
  renderBulk();
  renderDiag();
}

/** 고른 작업 수와 「선택 지우기」 — 고른 게 없으면 숨긴다. 줄에서 사라진 작업은 선택에서도 뺀다. */
function renderBulk() {
  const bar = $('wb-bulk');
  if (!bar) return;
  for (const jobId of [...state.selected]) if (!jobById(jobId)) state.selected.delete(jobId);
  const count = state.selected.size;
  bar.hidden = count === 0;
  const label = $('wb-bulk-count');
  if (label) label.textContent = `${count}개 골랐습니다`;
}

/** 고른 작업을 한 번에 지운다. 확인은 한 번, 지우기는 하나씩(백엔드에 일괄 삭제가 없다). 못 지운 것은 이유와 함께. */
async function bulkDelete() {
  const ids = [...state.selected];
  if (!ids.length || state.busy.has('bulk-delete')) return;
  const names = ids.map(jobId => text(jobById(jobId)?.productName) || jobId);
  const preview = names.slice(0, 5).join(', ') + (names.length > 5 ? ` 외 ${names.length - 5}개` : '');
  if (!globalThis.confirm(`${ids.length}개 작업을 지울까요? ${preview}\n되돌릴 수 없고, 저장 기록에서도 실제로 없어집니다.`)) return;
  state.busy.add('bulk-delete');
  const removed = [];
  const failed = [];
  try {
    for (const jobId of ids) {
      try {
        const result = await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
        removed.push(text(result?.productName) || text(jobById(jobId)?.productName) || jobId);
        state.jobs = state.jobs.filter(job => text(job.jobId) !== jobId);
        state.selected.delete(jobId);
        if (state.openJobId === jobId) state.openJobId = '';
      } catch (error) {
        failed.push(`${text(jobById(jobId)?.productName) || jobId}: ${DELETE_COPY[text(error?.code)] || humanError(error)}`);
      }
    }
    if (roots.queue.contains(document.activeElement)) document.activeElement.blur();
    setStatus(
      `${removed.length}개를 지웠습니다${failed.length ? ` · 못 지운 ${failed.length}개 — ${failed.join(' / ')}` : '.'}`,
      failed.length ? 'error' : 'ok',
    );
  } finally {
    state.busy.delete('bulk-delete');
    render();
    void refresh();
  }
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

/** 판정자에게 맡긴다. 돌아오는 값은 성공 여부 — 자동 고르기가 재시도 여부를 정하는 데 쓴다. */
async function judgeCandidates({ jobId, provider, automatic = false }) {
  const panel = panelFor(jobId);
  if (panel.pick.busy) return false;
  panel.pick.busy = true;
  panel.pick.note = `${providerName(provider)}가 후보를 보는 중… 보통 10초 안팎입니다.`;
  render();
  let ok = false;
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
    const copy = selectionCopy(result, `${automatic ? '자동 고르기 · ' : ''}${providerName(provider)} 가`);
    setStatus(copy.message, copy.tone);
    panel.pick.note = copy.tone === 'ok' ? '' : text(receipt.reason) || '';
    ok = copy.tone === 'ok';
    await refresh();
  } catch (error) {
    panel.pick.note = '';
    setStatus(`${automatic ? '자동 고르기 ' : '자동 선택 '}실패 · ${humanError(error)}`, 'error');
  } finally {
    panel.pick.busy = false;
    render();
  }
  return ok;
}

/** 컷의 저장된 프롬프트 — 조립공장 보관함 기록(옛 보드의 「프롬프트 보기」와 같은 GET). 한 번 읽으면 패널에 남는다. */
async function loadCutPrompt(archiveId) {
  const panel = panelFor(state.openJobId);
  const id = text(archiveId);
  if (!id || panel.pick.prompts[id]) return;
  panel.pick.prompts = { ...panel.pick.prompts, [id]: { loading: true } };
  render();
  try {
    const body = await apiRequest(`/api/factory/archive-prompt/${encodeURIComponent(id)}`);
    panel.pick.prompts = { ...panel.pick.prompts, [id]: { prompt: text(body?.prompt), note: text(body?.note) } };
  } catch (error) {
    panel.pick.prompts = { ...panel.pick.prompts, [id]: { prompt: '', note: `프롬프트를 못 읽었습니다 · ${humanError(error)}` } };
  }
  render();
}

/** 새 컷 만들기 — 옛 보드의 compose 폼과 같은 요청. 조립공장이 이 프롬프트로 그 단계 컷을 하나 더 만든다. */
async function composeCut({ jobId, stageKey, prompt }) {
  const panel = panelFor(jobId);
  const wanted = text(prompt);
  if (!wanted) {
    setStatus('프롬프트를 적어야 새 컷을 만들 수 있습니다.', 'error');
    return;
  }
  if (panel.pick.busy) return;
  panel.pick.busy = true;
  render();
  try {
    await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/compose-cut`, { method: 'POST', body: { stageKey, prompt: wanted } });
    panel.pick.composeDraft = { ...panel.pick.composeDraft, [stageKey]: '' };
    setStatus(`${stageKey} 새 컷을 만들라고 조립공장에 보냈습니다. 만들어지면 후보에 더해집니다.`, 'ok');
    await refresh();
  } catch (error) {
    setStatus(`새 컷 만들기 실패 · ${humanError(error)}`, 'error');
  } finally {
    panel.pick.busy = false;
    render();
  }
}

/** 제품별 자동 고르기 설정을 바꾼다. 켜면 지금 기다리는 단계부터 바로 맡긴다. */
function setAutoPick(jobId, provider) {
  const next = { ...state.autoPick };
  if (text(provider)) next[jobId] = text(provider);
  else if (state.autoPickDefault) next[jobId] = 'off';
  else delete next[jobId];
  state.autoPick = next;
  saveStored(STORAGE.autoPick, next);
  // 토글·판정자 select 에 초점이 남아 있으면 그리기가 미뤄진다 — 설정은 바로 보여야 한다.
  if (roots.queue.contains(document.activeElement)) document.activeElement.blur();
  const resolved = autoPickFor(jobId, state.autoPick, state.autoPickDefault);
  setStatus(resolved.provider
    ? `${text(jobById(jobId)?.productName) || jobId} 의 컷은 ${providerName(resolved.provider)}가 고릅니다.`
    : `${text(jobById(jobId)?.productName) || jobId} 의 컷은 내가 고릅니다.`, 'ok');
  render();
  void autoPickTick();
}

function setAutoPickDefault(provider) {
  state.autoPickDefault = text(provider);
  saveStored(STORAGE.autoPickDefault, state.autoPickDefault);
  setStatus(state.autoPickDefault
    ? `새로 오는 컷 고르기는 ${providerName(state.autoPickDefault)}에게 맡깁니다(제품별로 끌 수 있음).`
    : '새로 오는 컷 고르기는 내가 합니다.', 'ok');
  render();
  void autoPickTick();
}

/**
 * 자동 고르기 한 바퀴. 켜진 제품 중 컷 고르기 차례이고 아직 예약 안 된 단계가 있으면 판정자를 부른다.
 * 같은 단계·후보 수(서명)는 한 번만. 실패한 서명은 2분 뒤에 다시.
 */
async function autoPickTick() {
  const model = currentModel();
  for (const row of model.rows) {
    const { provider } = autoPickFor(row.jobId, state.autoPick, state.autoPickDefault);
    if (!provider || row.state !== 'mine' || row.kind !== 'pick') continue;
    const cells = list(record(row.raw).cells).filter(cell => cell.pickable && !text(cell.reservedCandidateId));
    if (!cells.length) continue;
    const signature = `${cells.map(cell => `${text(cell.stageKey)}:${cell.candidateCount}`).join('|')}@${provider}`;
    const last = record(state.autoDone[row.jobId]);
    if (last.signature === signature && (!last.error || Date.now() - Number(last.at || 0) < 120_000)) continue;
    const key = `auto:${row.jobId}`;
    if (state.busy.has(key)) continue;
    state.busy.add(key);
    state.autoDone = { ...state.autoDone, [row.jobId]: { signature, at: Date.now(), error: '' } };
    saveStored(STORAGE.autoDone, state.autoDone);
    try {
      const ok = await judgeCandidates({ jobId: row.jobId, provider, automatic: true });
      if (!ok) {
        state.autoDone = { ...state.autoDone, [row.jobId]: { signature, at: Date.now(), error: 'failed' } };
        saveStored(STORAGE.autoDone, state.autoDone);
      }
    } finally {
      state.busy.delete(key);
    }
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

/**
 * 조립공장 탭 명령. 옛 앞면의 buildFactoryTabCommand 와 같은 본문 — 살아 있는 세션의 정체(제품·실행·지문·리비전)를
 * 실어 보내고, 접수된 주문(orderId)의 영수증이 applied 가 될 때까지 기다린다.
 */
export function buildTabCommand({ jobId, tabId, action, value, projection, idempotencyKey }) {
  const session = record(record(projection).session);
  const registration = record(record(projection).registration);
  if (record(projection).connected !== true || text(registration.jobId) !== jobId || text(session.workspaceId) !== `batch:${jobId}`
    || !['productId', 'productKey', 'runId', 'inputFingerprint'].every(key => text(session[key]))
    || ![session.revision, session.storeRevision].every(number => Number.isInteger(number) && number >= 0)) {
    throw Object.assign(new Error('현재 제품의 저장 상태를 확인할 수 없습니다. 조립공장이 이 제품을 연 뒤 다시 하세요.'), { code: 'factory_tab_command_job_mismatch' });
  }
  return {
    schema: 'factory-tab-command:v1',
    jobId,
    tabId,
    action,
    value: value === undefined ? null : value,
    expectedWorkspaceId: session.workspaceId,
    productId: session.productId,
    productKey: session.productKey,
    expectedRunId: session.runId,
    expectedInputFingerprint: session.inputFingerprint,
    expectedRevision: session.revision,
    expectedStoreRevision: session.storeRevision,
    idempotencyKey,
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendTabCommand({ jobId, tabId, action, value, label = '변경' }) {
  const panel = panelFor(jobId);
  if (panel.source.busy) return;
  panel.source.busy = true;
  panel.source.note = `${label} 요청을 조립공장에 보내는 중…`;
  render();
  try {
    const base = `/api/factory/jobs/${encodeURIComponent(jobId)}/tab-command`;
    const idempotencyKey = `wb-tab:${jobId}:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
    let accepted = null;
    // 조립공장은 자기 저장(autosave)으로도 리비전을 올린다. 그 사이에 만든 명령은 stale_workfile_revision 으로
    // 거절되는데(실측 2026-09-17: 연속 명령 4건 중 2건), 정체(제품·실행·지문)는 그대로라 최신 투영으로 다시 만들면 통한다.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const projection = attempt === 1 ? state.projection : await apiRequest('/api/factory/state');
      if (attempt > 1 && projection && typeof projection === 'object') state.projection = projection;
      const payload = buildTabCommand({ jobId, tabId, action, value, projection, idempotencyKey });
      try {
        accepted = await apiRequest(base, { method: 'POST', body: payload });
        break;
      } catch (error) {
        if (text(error?.code) !== 'stale_workfile_revision' || attempt === 3) throw error;
        await wait(1500);
      }
    }
    if (!accepted?.accepted || !text(accepted.orderId)) throw new Error('조립공장이 요청을 접수하지 못했습니다.');
    const deadline = Date.now() + 90_000;
    let receipt = null;
    while (Date.now() < deadline) {
      await wait(1000);
      const result = await apiRequest(`${base}/${encodeURIComponent(text(accepted.orderId))}`);
      if (text(result?.status) === 'error' || text(result?.error?.code)) {
        throw Object.assign(new Error(text(result?.error?.message) || text(result?.reason) || '조립공장이 명령을 거절했습니다.'), { code: text(result?.error?.code) || text(result?.reason) });
      }
      if (result?.receipt) {
        receipt = result.receipt;
        if (text(receipt.status) !== 'applied' || text(receipt.jobId) !== jobId || text(receipt.tabId) !== tabId || text(receipt.action) !== action) {
          throw new Error(`조립공장이 다른 결과를 돌려줬습니다 (${text(receipt.status) || '상태 없음'})`);
        }
        break;
      }
    }
    if (!receipt) throw new Error('조립공장 응답을 90초 동안 기다렸지만 오지 않았습니다.');
    // 영수증이 실어 온 투영이 가장 새롭다(리비전이 올라가 있다). 다음 명령은 이 리비전을 기대값으로 써야 통한다 —
    // 2초 폴링이 따라잡기 전에 두 번째 명령을 보내면 옛 리비전으로 거절된다(실측 2026-09-17).
    if (record(record(receipt.projection).session).workspaceId) state.projection = receipt.projection;
    // 저장된 섹션의 초안은 이제 조립공장 값이 정본이다 — 되살리지 않는다.
    if (tabId === 'sections' && text(record(value).sectionId)) {
      const prefix = `${text(record(value).sectionId)}:`;
      for (const key of Object.keys(panel.sections.drafts)) if (key.startsWith(prefix)) delete panel.sections.drafts[key];
    }
    panel.source.note = `${label} 적용됨.`;
    setStatus(`${label} — 조립공장에 적용했습니다.`, 'ok');
    await refresh();
    // 신화DB·Cafe24 둘 다 정해졌으면 사람이 또 누를 이유가 없다 — 이어서 돌린다.
    const pending = sourceWait();
    if (tabId === 'db' && !pending) {
      const job = jobById(jobId);
      if (text(job?.status) === 'waiting_manual') {
        setStatus('출처 확정 끝 · 이어서 돌립니다.', 'ok');
        await resumeJob(jobId);
      }
    } else if (tabId === 'db' && pending) {
      const db = record(pending.db);
      const dbDone = db.dbNone === true || text(db.selectedDbCandidateKey);
      const cafe24Done = db.cafe24None === true || text(db.selectedCafe24CandidateKey);
      if (dbDone && cafe24Done) {
        setStatus('출처 확정 끝 · 이어서 돌립니다.', 'ok');
        await resumeJob(jobId);
      }
    }
  } catch (error) {
    panel.source.note = '';
    setStatus(`${label} 실패 · ${humanError(error)}${text(error?.code) ? ` (${text(error.code)})` : ''}`, 'error');
  } finally {
    panel.source.busy = false;
    render();
  }
}

/**
 * 막힌 등록을 되살리는 조립공장 지시 — 옛 보드의 recover 세 가지(섹션 다시 생성 · 섹션 잠금 풀기 · Cafe24 대상 떼기).
 * POST /api/factory/jobs/{id}/recover {action}. 조립공장이 받아서 처리하고 진행이 바뀌면 줄에 반영된다.
 */
async function recoverJob({ jobId, action, label = action }) {
  const panel = panelFor(jobId);
  if (panel.source.busy) return;
  panel.source.busy = true;
  render();
  try {
    await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/recover`, { method: 'POST', body: { action } });
    setStatus(`${label} — 조립공장에 지시했습니다. 진행이 바뀌면 줄에 반영됩니다.`, 'ok');
    await refresh();
  } catch (error) {
    setStatus(`${label} 실패 · ${humanError(error)}${text(error?.code) ? ` (${text(error.code)})` : ''}`, 'error');
  } finally {
    panel.source.busy = false;
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
  void autoPickTick();
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
  const intakeBody = $('wb-intake-body');
  if (intakeBody) {
    mountIntake(intakeBody, {
      handlers: {
        status: (message, tone) => setStatus(message, tone),
        queued: job => {
          toggleIntake(false);
          state.filter = 'all';
          state.openJobId = text(job?.jobId);
          void refresh();
        },
      },
    });
  }
  const autoDefault = $('wb-auto-pick-default');
  if (autoDefault) {
    autoDefault.value = state.autoPickDefault;
    autoDefault.addEventListener('change', () => setAutoPickDefault(autoDefault.value));
  }
  $('wb-bulk-delete')?.addEventListener('click', () => void bulkDelete());
  $('wb-bulk-clear')?.addEventListener('click', () => { state.selected.clear(); render(); });
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
