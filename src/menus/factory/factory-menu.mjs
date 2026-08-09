import { MENU_CONTRACT_VERSION, createMenuContract } from '../../modules/menu-contracts.mjs';
import {
  bindFactoryMenuShell,
  canonicalFactoryTab,
  renderFactoryMenuShell,
} from './factory-menu-shell.mjs';
import {
  FACTORY_TAB_IDS,
  validateFactoryTabRegistry,
  validateFactoryTabs,
} from './factory-menu-validation.mjs';

function clean(value) { return String(value ?? '').trim(); }

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
  const tabs = validateFactoryTabs(ownValue(capabilities, 'tabs'));
  validateFactoryTabRegistry(ownValue(capabilities, 'tabRegistry'));

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
      const shellRuntimeAction = actionId === 'runGuideAction'; if (!shellRuntimeAction) assertMutable('factory');
      const token = getOperationToken();
      const verify = output => {
        const receipt = output?.schema === 'factory-runtime-command-receipt:v1' ? output : null;
        if (!isOperationCurrent(receipt?.operationToken || token)) throw staleOperationError(id);
        return receipt ? receipt.value : output;
      };
      const result = action.call(actions, id); if (shellRuntimeAction) return result;
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
    const tabRoot = root;
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

  const shellHandlers = () => ({
    selectTab: value => menu.invoke('selectTab', value),
    jumpStage: value => menu.invoke('jumpStage', value),
    setLogFilter: value => menu.invoke('setLogFilter', value),
    runGuideAction: value => menu.invoke('runGuideAction', value),
  });

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
      return freezeTree({ activeTabId: `factory/${shortId}`, tabSnapshot, factory: snapshot.factory || {} });
    },
    render(view = {}) {
      const fullId = clean(view.activeTabId);
      const shortId = canonicalFactoryTab(fullId || activeTabId || 'start');
      activate(shortId);
      const tabSnapshot = view.tabSnapshot === undefined ? freezeTree(tabFor(shortId).select(getSnapshot() || {})) : view.tabSnapshot;
      const tabMarkup = tabFor(shortId).render(tabSnapshot);
      const factory = view.factory === undefined ? (getSnapshot()?.factory || {}) : view.factory;
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
      const binding = {
        root,
        disposeShell: bindFactoryMenuShell(root, shellHandlers()),
        live: true,
        dispose: null,
      };
      const dispose = () => {
        if (!binding.live) return;
        binding.live = false;
        if (rootBinding === binding) rootBinding = null;
        binding.disposeShell();
        disposeBinding();
      };
      binding.dispose = dispose;
      rootBinding = binding;
      return dispose;
    },
    refresh(root) {
      const nextRoot = root || rootBinding?.root;
      if (!rootBinding) {
        if (nextRoot) menu.bind(nextRoot);
        return;
      }
      if (nextRoot !== rootBinding.root || rootBinding.root?.isConnected === false) {
        rootBinding.disposeShell();
        disposeBinding();
        rootBinding.root = nextRoot;
        bindActive(nextRoot);
        rootBinding.disposeShell = bindFactoryMenuShell(nextRoot, shellHandlers());
        return;
      }
      const nextTabRoot = nextRoot;
      if (activeBinding?.tabRoot === nextTabRoot && nextTabRoot?.isConnected !== false) return;
      disposeBinding(); bindActive(nextRoot);
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
