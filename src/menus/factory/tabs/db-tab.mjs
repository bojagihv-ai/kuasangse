import {
  FACTORY_TAB_CONTRACT_VERSION,
  createFactoryTabContract,
} from '../factory-tab-contract.mjs';

const READ = 'product-db:read';
const WRITE = 'product-db:write';
const GUIDE_ACTIONS = Object.freeze([
  'go-tab:fields', 'rerun-db-query', 'rerun-cafe24-query', 'append-cafe24-query',
  'reset-db-query', 'rerun-db-vm-only', 'run-db', 'start-sinhwa-db-and-rerun',
  'start-cafe24-control-and-rerun', 'cafe24-oauth-start',
  'cafe24-oauth-status-refresh-and-rerun', 'focus-size',
]);
const ACTION_ALIASES = Object.freeze({
  'go-tab:fields': 'goToFields', 'rerun-db-query': 'rerunDbQuery',
  'rerun-cafe24-query': 'rerunCafe24Query', 'append-cafe24-query': 'appendCafe24Query',
  'reset-db-query': 'resetDbQuery', 'rerun-db-vm-only': 'rerunDbVmOnly', 'run-db': 'runDb',
  'start-sinhwa-db-and-rerun': 'startSinhwaDbAndRerun',
  'start-cafe24-control-and-rerun': 'startCafe24ControlAndRerun',
  'cafe24-oauth-start': 'cafe24OauthStart',
  'cafe24-oauth-status-refresh-and-rerun': 'cafe24OauthStatusRefreshAndRerun',
  'focus-size': 'focusSize',
});

const required = (record, name) => {
  if (typeof record?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return record[name];
};
const fallbackEscape = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const helper = (helpers, name, fallback) => typeof helpers?.[name] === 'function' ? helpers[name] : fallback;
const factoryOf = snapshot => snapshot?.factory && typeof snapshot.factory === 'object' ? snapshot.factory : (snapshot || {});

function fallbackCounts(factory) {
  const product = factory.product || {};
  const db = product.pendingDbCandidates?.length ? product.pendingDbCandidates : product.dbCandidates;
  const cafe24 = product.pendingCafe24Candidates?.length ? product.pendingCafe24Candidates : product.cafe24Candidates;
  return { dbCandidates: Array.isArray(db) ? db.length : 0, cafe24Candidates: Array.isArray(cafe24) ? cafe24.length : 0,
    confirmedDb: !!product.confirmedDb, cafe24Selected: !!(product.selectedCafe24CandidateKey || product.cafe24DraftProductKey) };
}

function fallbackChecklist(tasks, helpers) {
  const escape = helper(helpers, 'escapeHtml', fallbackEscape);
  return `<div class="factory-automation-step-list">${tasks.filter(task => task.tab === 'db').map(task => `<div class="factory-automation-step"><span class="material-icons-outlined">pending</span><div><div class="factory-automation-step-title">${escape(task.title)}</div><div class="factory-automation-step-desc">${escape(task.desc)}</div></div><button class="btn-sm" data-factory-guide-action="${escape(task.action)}">이 작업 열기</button></div>`).join('')}</div>`;
}

function viewOf(snapshot, helpers) {
  const factory = factoryOf(snapshot);
  const countFn = helper(helpers, 'factoryAutomationCounts', fallbackCounts);
  const taskFn = helper(helpers, 'factoryAutomationWizardTasks', () => []);
  const counts = snapshot?.factoryAutomationCounts || snapshot?.counts || countFn(factory) || {};
  const tasks = snapshot?.factoryAutomationTasks || snapshot?.tasks || taskFn(factory, counts) || [];
  return { factory, counts, tasks: Array.isArray(tasks) ? tasks : [] };
}

function renderDb(snapshot, helpers) {
  const { factory, counts, tasks } = viewOf(snapshot, helpers);
  const product = factory.product || {};
  const auto = factory.automation || {};
  const escape = helper(helpers, 'escapeHtml', fallbackEscape);
  const attr = helper(helpers, 'escAttr', escape);
  const checklist = helper(helpers, 'renderFactoryAutomationTaskChecklist', fallbackChecklist);
  const candidateReview = helper(helpers, 'renderFactoryCandidateReviewPanels', () => '');
  const dbReady = !!(counts.confirmedDb || counts.cafe24Selected);
  const query = String(auto.dbSearchQuery || product.productName || snapshot?.productName || product.naturalHint || '').trim();
  const progress = auto.candidateSearchProgress && typeof auto.candidateSearchProgress === 'object' ? auto.candidateSearchProgress : {};
  const busy = !!progress.running;
  const busyAttr = busy ? ' disabled' : '';
  const appendLabel = busy && progress.kind === 'append-cafe24' ? 'Cafe24 추가검색 중...' : '기존 후보 제외 Cafe24 추가검색';
  const status = progress.message ? `<div class="factory-small" style="margin-top:10px;padding:9px 10px;border:1px solid ${busy ? 'rgba(245,158,11,.55)' : 'rgba(34,197,94,.45)'};border-radius:8px;background:${busy ? 'rgba(245,158,11,.10)' : 'rgba(34,197,94,.09)'};color:${busy ? '#fbbf24' : '#86efac'}">${busy ? '진행 중: ' : '최근 결과: '}${escape(progress.message)}</div>` : '';
  const ready = dbReady ? `<div class="factory-card" style="margin:12px 0;padding:12px;border-color:rgba(34,197,94,.40);background:rgba(16,185,129,.08)"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><div style="font-size:13px;font-weight:950;color:var(--ok)">현재 확정 상품이 준비됐습니다.</div><div class="factory-small" style="margin-top:4px">재검색은 보조 기능으로 두고, 다음 필수값 검수로 이어가면 됩니다.</div></div><button class="btn-primary" data-factory-guide-action="go-tab:fields">필수값 검수로 이동</button></div></div>` : '';
  const review = candidateReview(factory) || '';
  return `<div class="factory-automation-grid"><div class="factory-automation-panel"><h4>2. DB 확정</h4><p>신화사DB와 Cafe24 후보 중 실제 상품이 맞는 것을 고르면 완성 DB 기준값으로 모입니다. 선택 전에는 자동 확정하지 않습니다.</p>${ready}<div class="factory-card" style="margin:12px 0;padding:12px"><div style="font-size:13px;font-weight:950;color:var(--text);margin-bottom:6px">후보가 안 보이면 바로 다시 검색</div><p style="margin:0 0 10px;color:var(--text-m);font-size:12px;line-height:1.45">검색어를 줄이거나 색상/수량/수식어를 빼고 다시 검색할 수 있습니다. 추가검색은 지금 보이는 Cafe24 후보를 지우지 않고, 이미 뜬 상품번호/상품코드/상품명은 제외한 새 후보만 붙입니다.</p><label class="field" style="margin:0"><span>DB/Cafe24 재검색어</span><input class="input" data-factory-db-search-query value="${attr(query)}" placeholder="예: 크리스탈보자기, 보자기, 선물포장 보자기"></label><div class="factory-automation-actions" style="margin-top:10px"><button class="${dbReady ? 'btn-sm' : 'btn-primary'}" data-factory-guide-action="rerun-db-query"${busyAttr}><span class="material-icons-outlined" style="font-size:16px">manage_search</span>${escape(busy ? '검색 작업 진행 중' : '이 검색어로 DB/Cafe24 다시 검색')}</button><button class="btn-sm" data-factory-guide-action="rerun-cafe24-query"${busyAttr}>${escape(busy ? '검색 작업 진행 중' : 'Cafe24만 다시 검색')}</button><button class="btn-sm" data-factory-guide-action="append-cafe24-query"${busyAttr}>${escape(appendLabel)}</button><button class="btn-sm" data-factory-guide-action="reset-db-query">현재 제품명으로 되돌리기</button></div>${status}</div>${checklist(tasks, 'db')}<div class="factory-automation-actions"><button class="btn-sm" data-factory-guide-action="rerun-db-vm-only">DB/VM 후보만 다시 수집</button><button class="btn-sm" data-factory-guide-action="run-db">전체 시작 다시 실행</button><button class="btn-sm" data-factory-guide-action="go-tab:fields">필수값 검수로 이동</button></div></div><div class="factory-automation-panel factory-candidate-automation-panel"><h4>후보 선택</h4>${review || '<div class="factory-small">아직 후보가 없습니다. 시작 탭에서 제품명을 확인하고 수집 버튼을 눌러주세요.</div>'}</div></div>`;
}

function actionFn(actions, names) {
  for (const name of names) if (typeof actions?.[name] === 'function') return actions[name];
  return null;
}

function commandFor(assertMutable, actions, actionName) {
  return { capability: WRITE, execute(value, operationContext) {
    assertMutable();
    const direct = actionFn(actions, [ACTION_ALIASES[actionName], actionName].filter(Boolean));
    const generic = actionFn(actions, ['runFactoryGuideAction', 'runGuideAction']);
    if (direct) return direct(value, operationContext);
    if (generic) return generic(actionName, value, operationContext);
    return value;
  } };
}

export function createDbFactoryTab(capabilities = {}) {
  const getSnapshot = required(capabilities, 'getSnapshot');
  const assertMutable = required(capabilities, 'assertMutable');
  const getOperationToken = required(capabilities, 'getOperationToken');
  const isOperationCurrent = required(capabilities, 'isOperationCurrent');
  const reportError = required(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const renderHelpers = capabilities.renderHelpers || {};
  const commands = Object.create(null);
  for (const action of GUIDE_ACTIONS) commands[action] = commandFor(assertMutable, actions, action);
  for (const [name, action] of Object.entries({
    'set-db-search-query': 'setDbSearchQuery', 'commit-db-search-query': 'commitDbSearchQuery',
    'apply-db-candidate': 'applyDbCandidate', 'apply-cafe24-candidate': 'applyCafe24Candidate',
    'confirm-no-db-candidate': 'confirmNoDbCandidate', 'confirm-no-cafe24-candidate': 'confirmNoCafe24Candidate',
    'clear-db-candidate': 'clearDbCandidateSelection', 'clear-cafe24-candidate': 'clearCafe24CandidateSelection',
    'guide-action': 'runFactoryGuideAction',
  })) commands[name] = commandFor(assertMutable, actions, action);
  const runtimeCapabilities = { getSnapshot, assertMutable, getOperationToken, isOperationCurrent, reportError, actions, renderHelpers };
  let contract;
  const invoke = (name, value) => {
    try {
      const result = contract.invoke(name, value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };
  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION, id: 'factory/db', owner: 'product-db',
    capabilities: [READ, WRITE], commands,
    select() { return getSnapshot(); },
    render(snapshot) { return renderDb(snapshot, renderHelpers); },
    bind(root) {
      if (!root || typeof root.addEventListener !== 'function') return () => {};
      const inside = node => !!node && (!root.contains || root.contains(node));
      const readQuery = () => String(root.querySelector?.('[data-factory-db-search-query]')?.value || '').trim();
      const click = event => {
        const target = event?.target;
        const node = target?.closest?.('[data-factory-guide-action], [data-factory-apply-db-candidate], [data-factory-apply-cafe24-candidate], [data-factory-confirm-no-db-candidate], [data-factory-confirm-no-cafe24-candidate], [data-factory-clear-db-candidate], [data-factory-clear-cafe24-candidate]');
        if (!inside(node)) return;
        event.preventDefault?.(); event.stopPropagation?.();
        const guide = node.dataset?.factoryGuideAction;
        if (guide) { const value = ['rerun-db-query', 'rerun-cafe24-query', 'append-cafe24-query'].includes(guide) ? readQuery() : undefined; invoke(Object.prototype.hasOwnProperty.call(commands, guide) ? guide : 'guide-action', value); return; }
        if (node.dataset?.factoryApplyDbCandidate !== undefined) { invoke('apply-db-candidate', { index: Number(node.dataset.factoryApplyDbCandidate) }); return; }
        if (node.dataset?.factoryApplyCafe24Candidate !== undefined) { invoke('apply-cafe24-candidate', { index: Number(node.dataset.factoryApplyCafe24Candidate) }); return; }
        if (node.dataset?.factoryConfirmNoDbCandidate !== undefined) { invoke('confirm-no-db-candidate'); return; }
        if (node.dataset?.factoryConfirmNoCafe24Candidate !== undefined) { invoke('confirm-no-cafe24-candidate'); return; }
        if (node.dataset?.factoryClearDbCandidate !== undefined) { invoke('clear-db-candidate'); return; }
        if (node.dataset?.factoryClearCafe24Candidate !== undefined) invoke('clear-cafe24-candidate');
      };
      const input = event => { const node = event?.target; if (node?.matches?.('[data-factory-db-search-query]')) invoke('set-db-search-query', String(node.value || '')); };
      const focusout = event => { const node = event?.target; if (node?.matches?.('[data-factory-db-search-query]')) invoke('commit-db-search-query', String(node.value || '').trim()); };
      root.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('focusout', focusout);
      let disposed = false;
      return () => { if (disposed) return; disposed = true; root.removeEventListener?.('click', click); root.removeEventListener?.('input', input); root.removeEventListener?.('focusout', focusout); };
    },
    onEnter() {}, onLeave() {}, persistence: { reads: ['product-db'], writes: ['product-db'] },
  }, runtimeCapabilities);
  return contract;
}
