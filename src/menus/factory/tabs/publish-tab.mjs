import {
  FACTORY_TAB_CONTRACT_VERSION,
  createFactoryTabContract,
} from '../factory-tab-contract.mjs';
import { renderPublishFactoryTab } from './publish-tab-render.mjs';

const GUIDE_ACTION_ALIASES = Object.freeze({
  'focus-final-registration': Object.freeze(['focusFinalRegistration', 'focus-final-registration']),
  'focus-stage-log': Object.freeze(['focusStageLog', 'focus-stage-log']),
  'focus-materials': Object.freeze(['focusMaterials', 'focus-materials']),
});

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

function ownFunction(record, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record || {}, name) && typeof record[name] === 'function') return record[name];
    const candidate = record?.[name];
    if (typeof candidate === 'function') return candidate;
  }
  return null;
}

function pickAction(record, names) {
  const action = ownFunction(record, names);
  if (!action) throw new TypeError(`actions.${names[0]} must be a function`);
  return action;
}

function staleError() {
  const error = new Error('STALE_FACTORY_TAB_OPERATION: factory/publish');
  error.code = 'STALE_FACTORY_TAB_OPERATION';
  return error;
}

export function createPublishFactoryTab(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const isOperationCurrent = requiredFunction(capabilities, 'isOperationCurrent');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions && typeof capabilities.actions === 'object'
    ? capabilities.actions
    : Object.create(null);
  const renderHelpers = capabilities.renderHelpers && typeof capabilities.renderHelpers === 'object'
    ? capabilities.renderHelpers
    : Object.create(null);
  const runGuideAction = pickAction(actions, ['runFactoryGuideAction', 'runGuideAction', 'guideAction']);
  const runtime = {
    getSnapshot,
    assertMutable,
    getOperationToken,
    isOperationCurrent,
    reportError,
    actions,
    renderHelpers,
  };

  function guardedAction(actionName, value) {
    const operationToken = getOperationToken();
    const context = Object.freeze({
      operationToken,
      isCurrent: () => isOperationCurrent(operationToken),
    });
    const aliases = GUIDE_ACTION_ALIASES[actionName] || Object.freeze([actionName]);
    const direct = ownFunction(actions, aliases);
    const generic = ownFunction(actions, [
      'runFactoryGuideAction',
      'runGuideAction',
      'guideAction',
      'handleGuideAction',
    ]) || runGuideAction;
    const result = direct
      ? direct(value)
      : generic
        ? generic(value)
        : undefined;
    if (!result || typeof result.then !== 'function') {
      const committedToken = result?.schema === 'factory-runtime-command-receipt:v1'
        ? result.operationToken
        : operationToken;
      if (!isOperationCurrent(committedToken)) throw staleError();
      return result;
    }
    return Promise.resolve(result).then(output => {
      const committedToken = output?.schema === 'factory-runtime-command-receipt:v1'
        ? output.operationToken
        : operationToken;
      if (!isOperationCurrent(committedToken)) throw staleError();
      return output;
    });
  }

  const commands = {
    focusFinalRegistration: {
      capability: 'cafe24:write',
      execute(value) {
        return guardedAction('focus-final-registration', value);
      },
    },
    focusStageLog: {
      capability: 'cafe24:write',
      execute(value) {
        return guardedAction('focus-stage-log', value);
      },
    },
    focusMaterials: {
      capability: 'cafe24:write',
      execute(value) {
        return guardedAction('focus-materials', value);
      },
    },
    guideAction: {
      capability: 'cafe24:write',
      execute(value) {
        const action = typeof value === 'string' ? value : String(value?.action || '').trim();
        if (!action) return undefined;
        return guardedAction(action, value);
      },
    },
    runGuideAction: {
      capability: 'cafe24:write',
      execute(value) {
        const action = typeof value === 'string' ? value : String(value?.action || '').trim();
        if (!action) return undefined;
        return guardedAction(action, value);
      },
    },
  };

  let contract;
  const invokeGuide = value => {
    try {
      const result = contract.invoke('guideAction', value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION,
    id: 'factory/publish',
    owner: 'cafe24',
    capabilities: ['cafe24:read', 'cafe24:write'],
    commands,
    select() {
      const snapshot = getSnapshot();
      return snapshot && typeof snapshot === 'object' ? snapshot : Object.freeze({});
    },
    render(view) {
      return renderPublishFactoryTab(view, renderHelpers);
    },
    bind(root) {
      if (!root || typeof root.addEventListener !== 'function') return () => {};
      const onClick = event => {
        const target = event?.target;
        const button = target?.closest?.('[data-factory-guide-action],[data-factory-run-stage]')
          || (target?.dataset ? target : null);
        if (!button || (typeof root.contains === 'function' && !root.contains(button)) || button.disabled) return;
        const guideAction = String(button.dataset?.factoryGuideAction || '').trim();
        const stage = String(button.dataset?.factoryRunStage || '').trim();
        const action = guideAction || (stage ? `run-stage:${stage}` : '');
        if (!action) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        invokeGuide(action);
      };
      root.addEventListener('click', onClick);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        root.removeEventListener?.('click', onClick);
      };
    },
    onEnter() {},
    onLeave() {},
    persistence: { reads: ['cafe24'], writes: ['cafe24'] },
  }, runtime);

  return contract;
}
