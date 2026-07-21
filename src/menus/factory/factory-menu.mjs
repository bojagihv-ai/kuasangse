import { MENU_CONTRACT_VERSION, createMenuContract } from '../../modules/menu-contracts.mjs';
import {
  bindFactoryMenuShell,
  canonicalFactoryTab,
  renderFactoryMenuShell,
} from './factory-menu-shell.mjs';

const FACTORY_TAB_VERSION = 'factory-tab:v1';
const FACTORY_TAB_IDS = Object.freeze([
  'factory/start',
  'factory/db',
  'factory/fields',
  'factory/competitor',
  'factory/assets',
  'factory/sections',
  'factory/publish',
]);

function clean(value) { return String(value ?? '').trim(); }

function deepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && !descriptor.get && !descriptor.set && deepFrozen(descriptor.value, seen);
  });
}

function freezeTree(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value); for (const child of Object.values(value)) freezeTree(child, seen);
  return Object.freeze(value);
}

function requiredFunction(source, name) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') {
    throw new TypeError(`factory menu capability ${name} must be an own function`);
  }
  return descriptor.value;
}

function ownValue(source, name) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || descriptor.get || descriptor.set) throw new TypeError(`factory menu field ${name} must be an own value`);
  return descriptor.value;
}

function registryTabId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const id = raw.startsWith('factory/') ? raw : `factory/${raw}`;
  if (!FACTORY_TAB_IDS.includes(id)) throw new Error(`unknown factory tab: ${raw || '<empty>'}`);
  return id;
}

function staleOperationError(id) {
  const error = new Error(`STALE_FACTORY_MENU_OPERATION: ${id}`);
  error.code = 'STALE_FACTORY_MENU_OPERATION'; return error;
}

function validateTabRegistry(tabRegistry) {
  if (!Array.isArray(tabRegistry) || tabRegistry.length !== FACTORY_TAB_IDS.length) throw new TypeError('factory tab registry must contain exactly seven descriptors');
  const seen = new Set();
  tabRegistry.forEach((descriptor, index) => {
    if (!deepFrozen(descriptor)) throw new TypeError(`factory tab registry descriptor ${index} must be immutable`);
    const id = clean(ownValue(descriptor, 'id'));
    if (id !== FACTORY_TAB_IDS[index]) throw new Error(`factory tab registry order mismatch: ${id || '<empty>'}`);
    if (seen.has(id)) throw new Error(`duplicate factory tab registry id: ${id}`);
    seen.add(id);
    if (ownValue(descriptor, 'kind') !== 'factory-tab' || ownValue(descriptor, 'order') !== index
      || ownValue(descriptor, 'api') !== FACTORY_TAB_VERSION) {
      throw new Error(`invalid factory tab registry descriptor: ${id}`);
    }
  });
  return tabRegistry;
}

function validateTabs(tabs) {
  if (!(tabs instanceof Map)) throw new TypeError('factory tabs must be a Map');
  if (tabs.size !== FACTORY_TAB_IDS.length) throw new Error('factory tab registry missing or extra tabs: expected exactly seven');
  const seen = new Set();
  for (const id of FACTORY_TAB_IDS) {
    if (!tabs.has(id)) throw new Error(`missing factory tab: ${id}`);
    const tab = tabs.get(id);
    if (seen.has(tab) || !deepFrozen(tab)
      || ownValue(tab, 'version') !== FACTORY_TAB_VERSION
      || ownValue(tab, 'id') !== id) {
      throw new Error(`invalid factory tab: ${id}`);
    }
    for (const field of ['select', 'render', 'bind', 'onEnter', 'onLeave']) requiredFunction(tab, field);
    seen.add(tab);
  }
  for (const id of tabs.keys()) {
    if (!FACTORY_TAB_IDS.includes(id)) throw new Error(`unknown factory tab: ${clean(id)}`);
  }
  return tabs;
}

export function createFactoryMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const isOperationCurrent = requiredFunction(capabilities, 'isOperationCurrent');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = ownValue(capabilities, 'actions');
  const selectFactoryTab = actions?.selectFactoryTab;
  const jumpFactoryStage = actions?.jumpFactoryStage;
  const setFactoryStageLogFilter = actions?.setFactoryStageLogFilter;
  const runFactoryShellGuideAction = actions?.runFactoryShellGuideAction;
  if (typeof selectFactoryTab !== 'function') throw new TypeError('factory menu action selectFactoryTab must be a function');
  if (typeof jumpFactoryStage !== 'function') throw new TypeError('factory menu action jumpFactoryStage must be a function');
  if (typeof setFactoryStageLogFilter !== 'function') throw new TypeError('factory menu action setFactoryStageLogFilter must be a function');
  if (typeof runFactoryShellGuideAction !== 'function') throw new TypeError('factory menu action runFactoryShellGuideAction must be a function');
  const renderHelpers = ownValue(capabilities, 'renderHelpers');
  const renderFactoryAutomationRunStatus = requiredFunction(renderHelpers, 'renderFactoryAutomationRunStatus');
  const renderFactoryWorkspacePanel = typeof renderHelpers?.renderFactoryWorkspacePanel === 'function' ? renderHelpers.renderFactoryWorkspacePanel : () => '';
  const tabs = validateTabs(ownValue(capabilities, 'tabs'));
  validateTabRegistry(ownValue(capabilities, 'tabRegistry'));

  let activeTabId = null;
  let entered = false;
  let activeBinding = null;
  let rootBinding = null;

  function reportAndThrow(error) { reportError(error); throw error; }

  function executeFactoryAction(actionId, action, value) {
    let id;
    try {
      id = actionId === 'selectTab' ? registryTabId(value) : clean(value);
      if (!id) throw new Error(`factory menu ${actionId} value is required`);
      assertMutable('factory');
      const token = getOperationToken();
      const verify = output => {
        const receipt = output?.schema === 'factory-runtime-command-receipt:v1' ? output : null;
        if (!isOperationCurrent(receipt?.operationToken || token)) throw staleOperationError(id);
        return receipt ? receipt.value : output;
      };
      const result = action.call(actions, id);
      return result && typeof result.then === 'function'
        ? Promise.resolve(result).then(verify).catch(reportAndThrow) : verify(result);
    } catch (error) { return reportAndThrow(error); }
  }

  const selectTab = value => executeFactoryAction('selectTab', selectFactoryTab, value);
  const jumpStage = value => executeFactoryAction('jumpStage', jumpFactoryStage, value);
  const setLogFilter = value => executeFactoryAction('setLogFilter', setFactoryStageLogFilter, value);
  const runGuideAction = value => executeFactoryAction('runGuideAction', runFactoryShellGuideAction, value);

  function tabFor(id) {
    const tab = tabs.get(`factory/${id}`);
    if (!tab) throw new Error(`missing factory tab: factory/${id}`);
    return tab;
  }

  function snapshotTabId(snapshot) { return canonicalFactoryTab(snapshot?.factory?.automation?.activeTab); }

  function disposeBinding() {
    const binding = activeBinding;
    if (!binding) return false;
    activeBinding = null; binding.dispose(); return true;
  }

  function activate(id) {
    if (activeTabId === id) return;
    const oldId = activeTabId;
    const oldTab = oldId ? tabFor(oldId) : null;
    const oldWasEntered = entered;
    const oldRoot = activeBinding?.root;
    const oldWasBound = disposeBinding();
    if (oldWasEntered) {
      entered = false;
      oldTab.onLeave();
    }
    activeTabId = id;
    const nextTab = tabFor(id);
    if (oldWasEntered) {
      nextTab.onEnter();
      entered = true;
    }
    if (oldWasBound) bindActive(oldRoot);
  }

  function bindActive(root) {
    const tab = tabFor(activeTabId || 'start');
    const tabRoot = root?.querySelector?.('.factory-automation-body') || root;
    const dispose = tab.bind(tabRoot);
    if (typeof dispose !== 'function') throw new TypeError(`factory tab ${tab.id} bind must return a disposer`);
    let live = true;
    const wrapped = () => {
      if (!live) return;
      live = false;
      if (activeBinding?.dispose === wrapped) activeBinding = null;
      dispose();
    };
    activeBinding = { root, tabRoot, dispose: wrapped };
    return wrapped;
  }

  const menu = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'factory',
    routes: ['factory'],
    ownedSlices: ['factory'],
    capabilities: ['factory:write'],
    commands: {
      selectTab: { capability: 'factory:write', execute: selectTab },
      jumpStage: { capability: 'factory:write', execute: jumpStage },
      setLogFilter: { capability: 'factory:write', execute: setLogFilter },
      runGuideAction: { capability: 'factory:write', execute: runGuideAction },
    },
    select(rootSnapshot = getSnapshot()) {
      const snapshot = rootSnapshot || {};
      const shortId = snapshotTabId(snapshot);
      activate(shortId);
      const tabSnapshot = freezeTree(tabFor(shortId).select(snapshot));
      return freezeTree({ activeTabId: `factory/${shortId}`, tabSnapshot });
    },
    render(view = {}) {
      const fullId = clean(view.activeTabId);
      const shortId = canonicalFactoryTab(fullId || activeTabId || 'start');
      activate(shortId);
      const tabSnapshot = view.tabSnapshot === undefined ? freezeTree(tabFor(shortId).select(getSnapshot() || {})) : view.tabSnapshot;
      const tabMarkup = tabFor(shortId).render(tabSnapshot);
      const factory = getSnapshot()?.factory || {};
      return `${renderFactoryWorkspacePanel(factory)}${renderFactoryMenuShell({
        activeId: shortId,
        statusMarkup: renderFactoryAutomationRunStatus(factory, { rail: true }),
        tabMarkup,
      })}`;
    },
    bind(root) {
      if (!activeTabId) activate(snapshotTabId(getSnapshot() || {}));
      if (rootBinding) return rootBinding.dispose;
      bindActive(root);
      const disposeShell = bindFactoryMenuShell(root, {
        selectTab: value => menu.invoke('selectTab', value),
        jumpStage: value => menu.invoke('jumpStage', value),
        setLogFilter: value => menu.invoke('setLogFilter', value),
        runGuideAction: value => menu.invoke('runGuideAction', value),
      });
      let live = true;
      const dispose = () => {
        if (!live) return; live = false;
        if (rootBinding?.dispose === dispose) rootBinding = null;
        disposeShell(); disposeBinding();
      };
      rootBinding = { root, dispose }; return dispose;
    },
    refresh(root) {
      if (!rootBinding) return;
      const nextTabRoot = root?.querySelector?.('.factory-automation-body') || root;
      if (activeBinding?.tabRoot === nextTabRoot && nextTabRoot?.isConnected !== false) return;
      disposeBinding(); bindActive(rootBinding.root || root);
    },
    onEnter() {
      if (!activeTabId) activate(snapshotTabId(getSnapshot() || {}));
      if (entered) return;
      tabFor(activeTabId).onEnter(); entered = true;
    },
    onLeave() {
      if (rootBinding) rootBinding.dispose(); else disposeBinding();
      if (!entered) return;
      entered = false; tabFor(activeTabId).onLeave();
    },
    persistence: { reads: ['factory'], writes: ['factory'] },
  });
  return menu;
}
