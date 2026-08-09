const TAB_PRESENTATION = Object.freeze([
  Object.freeze({ id: 'start', no: 1, label: '시작', desc: '제품 이미지와 제품명을 넣고 병렬 수집/생성을 시작합니다.' }),
  Object.freeze({ id: 'db', no: 2, label: 'DB 확정', desc: '신화사DB와 Cafe24 후보 중 맞는 제품을 고릅니다.' }),
  Object.freeze({ id: 'fields', no: 3, label: '필수값', desc: '상품등록값과 생성에 필요한 사이즈/소재/용도를 검수합니다.' }),
  Object.freeze({ id: 'competitor', no: 4, label: '경쟁사', desc: 'VM 후보를 선택하고 상세페이지 수집/분석 이미지를 고릅니다.' }),
  Object.freeze({ id: 'assets', no: 5, label: '생성컷 선택', desc: '대표이미지, 사이즈이미지, 색상옵션, 이미지컷 사용 컷을 확정합니다.' }),
  Object.freeze({ id: 'sections', no: 6, label: '섹션 생성', desc: 'DB/경쟁사 소스 기준을 확인하고 상세페이지 섹션을 생성합니다.' }),
  Object.freeze({ id: 'publish', no: 7, label: '전송', desc: '완성 체크 후 Cafe24/마켓플러스 전송 버튼을 누릅니다.' }),
]);

const TAB_ALIASES = Object.freeze({ materials: 'start', collect: 'db', generate: 'assets' });
const SHELL_GUIDE_ACTIONS = new Set([
  'open-vm-capture',
  'resume-comp-market-detail',
  'rerun-vm-competitors',
  'rerun-local-competitors',
]);

function clean(value) { return String(value ?? '').trim(); }

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function attribute(button, name, datasetName) {
  const value = button?.getAttribute?.(name);
  if (value !== null && value !== undefined) return value;
  const descriptor = button?.dataset && Object.getOwnPropertyDescriptor(button.dataset, datasetName);
  return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : '';
}

function markSelectedTab(root, selectedId) {
  const tabButtons = root?.querySelectorAll?.('[data-factory-auto-tab]') || [];
  for (const button of tabButtons) {
    const selected = attribute(button, 'data-factory-auto-tab', 'factoryAutoTab') === selectedId;
    button.classList?.toggle?.('active', selected);
    button.setAttribute?.('aria-selected', selected ? 'true' : 'false');
  }
}

function invokeDeferred(handler, value) {
  setTimeout(() => {
    try {
      const result = handler?.(value);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  }, 0);
}

function buttons(activeId) {
  return TAB_PRESENTATION.map(tab => `<button type="button" class="factory-automation-tab${activeId === tab.id ? ' active' : ''}" data-factory-auto-tab="${escapeHtml(tab.id)}" title="${escapeHtml(tab.desc)}" role="tab" aria-selected="${activeId === tab.id ? 'true' : 'false'}"><span class="factory-automation-tab-no">${tab.no}</span><span>${escapeHtml(tab.label)}</span></button>`).join('');
}

export function canonicalFactoryTab(value) {
  const raw = clean(value);
  const shortId = raw.startsWith('factory/') ? raw.slice('factory/'.length) : raw;
  const normalized = TAB_ALIASES[shortId] || shortId;
  return TAB_PRESENTATION.some(tab => tab.id === normalized) ? normalized : 'start';
}

export function renderFactoryMenuShell({ activeId, statusMarkup = '', tabMarkup = '' } = {}) {
  const current = canonicalFactoryTab(activeId);
  return `<section class="factory-section factory-automation-shell" id="factoryAutomationWizard"><div class="factory-section-head"><div><h3>조립공장 자동화 ver</h3><p>조립공장 공정은 상단 1~7 단계 탭을 기준으로 진행합니다.</p></div></div>${statusMarkup}<div class="factory-automation-tabs" role="tablist" aria-label="조립공장 자동화 단계">${buttons(current)}</div><div class="factory-automation-body">${tabMarkup}</div></section>`;
}

export function bindFactoryMenuShell(root, handlers = {}) {
  const listener = event => {
    const target = event?.target;
    const tab = target?.closest?.('[data-factory-auto-tab]');
    const jump = target?.closest?.('[data-factory-stage-jump]');
    const filter = target?.closest?.('[data-factory-stage-log-filter]');
    const guide = target?.closest?.('[data-factory-guide-action]');
    if (root?.contains?.(tab || jump || filter || guide) === false) return;
    try {
      let result;
      if (tab) {
        const tabId = attribute(tab, 'data-factory-auto-tab', 'factoryAutoTab');
        event?.preventDefault?.();
        markSelectedTab(root, tabId);
        invokeDeferred(handlers.selectTab, tabId);
        return;
      }
      else if (jump) result = handlers.jumpStage?.(attribute(jump, 'data-factory-stage-jump', 'factoryStageJump'));
      else if (filter) result = handlers.setLogFilter?.(attribute(filter, 'data-factory-stage-log-filter', 'factoryStageLogFilter'));
      else {
        const action = attribute(guide, 'data-factory-guide-action', 'factoryGuideAction');
        if (!guide || !SHELL_GUIDE_ACTIONS.has(action)) return;
        result = handlers.runGuideAction?.(action);
      }
      event?.preventDefault?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };
  root?.addEventListener?.('click', listener);
  return () => root?.removeEventListener?.('click', listener);
}
