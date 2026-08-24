export const MENU_REGISTRY = Object.freeze([
  Object.freeze({ key: 'overview', label: '개요', panelId: 'menu-panel-overview', tabId: 'menu-tab-overview' }),
  Object.freeze({ key: 'queue', label: '작업 큐', panelId: 'menu-panel-queue', tabId: 'menu-tab-queue' }),
  Object.freeze({ key: 'input-source', label: '입력·소스', panelId: 'menu-panel-input-source', tabId: 'menu-tab-input-source' }),
  Object.freeze({ key: 'competitors', label: '경쟁사', panelId: 'menu-panel-competitors', tabId: 'menu-tab-competitors' }),
  Object.freeze({ key: 'production-acut', label: '생산·A컷', panelId: 'menu-panel-production-acut', tabId: 'menu-tab-production-acut' }),
  Object.freeze({ key: 'automation', label: '자동판단', panelId: 'menu-panel-automation', tabId: 'menu-tab-automation' }),
  Object.freeze({ key: 'cafe24', label: 'Cafe24', panelId: 'menu-panel-cafe24', tabId: 'menu-tab-cafe24' }),
  Object.freeze({ key: 'audit-sync', label: '감사·동기화', panelId: 'menu-panel-audit-sync', tabId: 'menu-tab-audit-sync' }),
]);

export const FACTORY_STAGE_KEYS = Object.freeze([
  'db',
  'representative',
  'size',
  'option_color',
  'general',
  'sections',
  'final_detail',
]);

const MENU_KEYS = Object.freeze(MENU_REGISTRY.map(item => item.key));
const MENU_BADGE_LABELS = Object.freeze({
  approval_required: '승인 필요',
  blocked: '차단',
  completed: '완료',
  connected: '연결',
  disconnected: '끊김',
  draft: '초안',
  empty: '없음',
  locked: '잠금',
  manual: '수동',
  missing: '누락',
  ready: '준비',
  running: '진행',
});

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function countCandidates(value) {
  const source = record(value);
  return Number.isFinite(Number(source.count)) ? Number(source.count) : list(source.candidates).length;
}

export function menuBadgeText(value = {}) {
  const badge = record(value);
  if (Number(badge.count) > 0) return String(badge.count);
  const status = String(badge.status || '');
  return MENU_BADGE_LABELS[status] || status || '—';
}

/**
 * 탭에 실제로 찍을 배지 글자.
 * 조립공장이 끊겨 있으면 모든 탭이 '끊김'으로 도배되는데, 그건 같은 사실을 여덟 번
 * 반복하는 것뿐이라 정보가 없다. 그럴 때는 탭을 비우고 연결 안내는 배너 한 줄로 모은다.
 */
export function menuBadgeDisplay(value = {}) {
  const badge = record(value);
  if (String(badge.status || '') === 'disconnected' && !(Number(badge.count) > 0)) {
    return { text: '—', status: 'idle' };
  }
  return { text: menuBadgeText(badge), status: String(badge.status || '') };
}

export function createMenuState(initialKey = 'overview') {
  return Object.freeze({ activeKey: MENU_KEYS.includes(initialKey) ? initialKey : 'overview' });
}

export function menuPanelId(key) {
  return MENU_REGISTRY.find(item => item.key === key)?.panelId || '';
}

export function menuTabId(key) {
  return MENU_REGISTRY.find(item => item.key === key)?.tabId || '';
}

export function menuKeyForKeyboard(key, currentKey = 'overview') {
  const index = Math.max(0, MENU_KEYS.indexOf(currentKey));
  if (key === 'Home') return MENU_KEYS[0];
  if (key === 'End') return MENU_KEYS[MENU_KEYS.length - 1];
  if (key === 'ArrowRight' || key === 'ArrowDown') return MENU_KEYS[(index + 1) % MENU_KEYS.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return MENU_KEYS[(index - 1 + MENU_KEYS.length) % MENU_KEYS.length];
  if (key === 'Enter' || key === ' ') return MENU_KEYS[index];
  return '';
}

export function menuKeyForTabKeyboard(key, tabKey, currentKey = 'overview') {
  return menuKeyForKeyboard(key, key === 'Enter' || key === ' ' ? tabKey : currentKey);
}

export function applyMenuAction(state, key) {
  const current = createMenuState(record(state).activeKey);
  return createMenuState(MENU_KEYS.includes(key) ? key : current.activeKey);
}

export function projectMenuBadges(projection = {}, automation = {}) {
  const current = record(projection);
  const inputs = list(current.inputs);
  const stages = list(current.stages);
  const missingInputs = inputs.reduce((total, input) => total + list(record(input).missing).length, 0);
  const competitorInput = inputs.find(input => ['competitors', 'competitor_sources', 'competitor'].includes(record(input).key));
  const unresolvedStages = stages.filter(stage => !record(stage).selectedId).length;
  const registration = record(current.registration);
  const cafe24Status = String(registration.status || record(current.approval).status || (current.connected ? '확인 필요' : 'disconnected'));
  const policySnapshot = record(automation.snapshot);
  return {
    overview: { count: unresolvedStages + missingInputs, status: String(record(current.progress).status || (current.connected ? 'ready' : 'disconnected')) },
    queue: { count: unresolvedStages, status: String(record(current.progress).status || (current.connected ? 'ready' : 'disconnected')) },
    'input-source': { count: missingInputs, status: missingInputs ? 'missing' : (current.connected ? 'ready' : 'disconnected') },
    competitors: { count: countCandidates(competitorInput), status: competitorInput ? 'ready' : (current.connected ? 'empty' : 'disconnected') },
    'production-acut': { count: unresolvedStages, status: unresolvedStages ? 'manual' : (current.connected ? 'completed' : 'disconnected') },
    automation: { count: policySnapshot.locked ? 1 : 0, status: policySnapshot.locked ? 'locked' : 'draft' },
    cafe24: { count: list(registration.missing).length, status: cafe24Status },
    'audit-sync': { count: list(current.receipts).length, status: current.connected ? 'connected' : 'disconnected' },
  };
}

export function bindMenuShell({ documentRef = globalThis.document, onChange = () => {} } = {}) {
  const root = documentRef?.getElementById?.('primary-menu');
  const tabs = [...(root?.querySelectorAll?.('[role="tab"]') || [])];
  const panels = [...(documentRef?.querySelectorAll?.('[role="tabpanel"][data-menu-panel]') || [])];
  let state = createMenuState(tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.dataset.menuKey);

  function activate(key, { focus = false } = {}) {
    const next = applyMenuAction(state, key);
    state = next;
    for (const tab of tabs) {
      const active = tab.dataset.menuKey === state.activeKey;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.menuPanel !== state.activeKey;
    if (focus) documentRef.getElementById(menuTabId(state.activeKey))?.focus();
    onChange(state.activeKey, state);
    return state;
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.menuKey, { focus: false }));
    tab.addEventListener('keydown', event => {
      const nextKey = menuKeyForTabKeyboard(event.key, tab.dataset.menuKey, state.activeKey);
      if (!nextKey) return;
      event.preventDefault();
      activate(nextKey, { focus: event.key !== 'Enter' && event.key !== ' ' });
    });
  }
  activate(state.activeKey);

  return Object.freeze({
    activate,
    getState: () => state,
    updateBadges: badges => {
      for (const item of MENU_REGISTRY) {
        const badge = root?.querySelector?.(`[data-menu-badge="${item.key}"]`);
        const value = record(badges)[item.key];
        if (!badge || !value) continue;
        const display = menuBadgeDisplay(value);
        badge.textContent = display.text;
        badge.dataset.status = display.status;
      }
    },
  });
}
