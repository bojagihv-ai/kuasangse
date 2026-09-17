/**
 * 작업대 부팅 — 관제탑 상태를 2초마다 읽고, 줄을 그리고, 행의 버튼을 API 에 잇는다.
 *
 * 화면은 세 자리뿐이다: 제품 넣기(접힘) · 줄 · 진단(접힘). 옛 앞면(control-tower.html)은
 * 그대로 두고 진단에서 연다 — 지우는 게 아니라 자리를 옮긴다.
 */
import { apiRequest, ORIGINS } from './api.mjs?wb=1';
import { FILTERS, buildQueueModel, renderQueue } from './queue.mjs?wb=1';

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const DELETE_COPY = Object.freeze({
  factory_product_job_not_found: '이미 지워진 작업입니다.',
  factory_product_job_busy: '조립공장이 지금 이 작업을 처리하는 중이라 지울 수 없습니다. 끝나거나 멈춘 뒤 다시 시도하세요.',
  factory_product_job_active_session: '지금 조립공장이 붙잡고 있는 작업이라 지울 수 없습니다. 다른 제품으로 넘어간 뒤 지우세요.',
  factory_product_job_already_registered: 'Cafe24 에 이미 등록된 작업이라 지울 수 없습니다. 실제로 올라간 기록은 남겨 둡니다.',
});

const state = {
  jobs: [],
  projection: {},
  filter: 'all',
  openJobId: '',
  busy: new Set(),
  lastError: '',
};

const roots = {};

function $(id) { return document.getElementById(id); }

function setStatus(message, tone = 'info') {
  if (!roots.status) return;
  roots.status.textContent = message;
  roots.status.dataset.tone = tone;
  roots.status.hidden = !message;
}

function activeJobId() {
  return text(record(state.projection.registration).jobId);
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

function render() {
  // 글자를 치는 중이면 다시 그리지 않는다 — 입력이 날아간다.
  const active = document.activeElement;
  if (roots.queue.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName)) return;
  const model = buildQueueModel({ jobs: state.jobs, projection: state.projection, activeJobId: activeJobId() });
  renderHeader(model);
  renderFilters(model);
  renderQueue(roots.queue, model, {
    filter: state.filter,
    openJobId: state.openJobId,
    handlers: {
      open: row => { state.openJobId = state.openJobId === row.jobId ? '' : row.jobId; render(); },
      resume: jobId => void resumeJob(jobId),
      remove: (jobId, productName) => void removeJob(jobId, productName),
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
    const reason = (Array.isArray(response?.results) ? response.results : []).map(r => text(r?.reason)).filter(Boolean)[0];
    setStatus(failed ? `다시 시작하지 못했습니다${reason ? ` · ${reason}` : ''}` : '저장된 지점부터 다시 시작했습니다.', failed ? 'error' : 'ok');
    await refresh();
  } catch (error) {
    setStatus(`다시 시작 실패 · ${text(error?.message || error)}`, 'error');
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
    setStatus(DELETE_COPY[text(error?.code)] || `작업을 지우지 못했습니다 · ${text(error?.message || error)}`, 'error');
  } finally {
    state.busy.delete(jobId);
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
