import { createFactoryTabContract, FACTORY_TAB_CONTRACT_VERSION } from '../factory-tab-contract.mjs';
import { renderFieldsFactoryTab } from './fields-tab-render.mjs';

const ACTION_NAMES = Object.freeze({
  draft: Object.freeze(['setFieldDraft', 'setAutomationWizardFieldDraft']),
  commit: Object.freeze(['commitField', 'commitAutomationWizardFieldValue', 'commitAutomationWizardField']),
  commitAll: Object.freeze(['commitAllFields', 'commitVisibleAutomationWizardFields']),
  edit: Object.freeze(['editField', 'editAutomationWizardField']),
  selection: Object.freeze(['setFieldTransferSelection']),
  clearSelection: Object.freeze(['clearFieldTransferSelection', 'setFieldTransferSelection']),
  transfer: Object.freeze(['executeSelectedFieldTransfer']),
  guide: Object.freeze(['runGuideAction', 'runFactoryGuideAction']),
  optionUpload: Object.freeze(['uploadOptionColor', 'addOptionColorImageFiles']),
});

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

function actionFor(actions, names) {
  for (const name of names) {
    if (typeof actions?.[name] === 'function') return actions[name];
  }
  return null;
}

function closest(target, selector) {
  if (typeof target?.closest === 'function') return target.closest(selector);
  return target?.matches?.(selector) ? target : null;
}

function fieldPayload(input, eventType = 'input') {
  if (!input) return null;
  const fieldId = String(input.dataset?.factoryWizardField || '').trim();
  if (!fieldId) return null;
  return Object.freeze({
    fieldId,
    id: fieldId,
    label: String(input.dataset?.factoryWizardLabel || fieldId),
    value: String(input.value || ''),
    previousValue: String(input.dataset?.factoryWizardPreviousValue || ''),
    eventType,
  });
}

function nodes(root, selector) {
  const result = root?.querySelectorAll?.(selector);
  return result ? Array.from(result) : [];
}

function fieldInput(root, fieldId, source) {
  const local = closest(source, '.factory-automation-status-card')?.querySelector?.('[data-factory-wizard-field]');
  if (local) return local;
  return nodes(root, '[data-factory-wizard-field]').find(item => item.dataset?.factoryWizardField === fieldId) || null;
}

function selectedTransferIds(panel, selector) {
  return nodes(panel, selector)
    .map(item => String(item.value || '').trim())
    .filter(Boolean);
}

export function createFieldsFactoryTab(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const isOperationCurrent = requiredFunction(capabilities, 'isOperationCurrent');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const renderHelpers = capabilities.renderHelpers || {};
  const runtimeCapabilities = Object.freeze({
    getSnapshot,
    assertMutable,
    getOperationToken,
    isOperationCurrent,
    reportError,
    actions,
    renderHelpers,
  });
  let contract;

  function dispatch(kind, value) {
    const action = actionFor(actions, ACTION_NAMES[kind]);
    if (!action) return undefined;
    const operationToken = getOperationToken();
    const context = Object.freeze({ operationToken, isCurrent: () => isOperationCurrent(operationToken) });
    const result = action(value, context);
    if (!result || typeof result.then !== 'function') return result;
    return Promise.resolve(result).then(output => {
      const committedToken = output?.schema === 'factory-runtime-command-receipt:v1'
        ? output.operationToken
        : operationToken;
      if (!isOperationCurrent(committedToken)) {
        const stale = new Error('STALE_FACTORY_TAB_OPERATION: factory/fields');
        stale.code = 'STALE_FACTORY_TAB_OPERATION';
        throw stale;
      }
      return output;
    });
  }

  const commands = {
    setFieldDraft: { capability: 'product-db:write', execute: value => dispatch('draft', value) },
    editField: { capability: 'product-db:write', execute: value => dispatch('edit', value) },
    commitField: { capability: 'product-db:write', execute: value => dispatch('commit', value) },
    commitAllFields: { capability: 'product-db:write', execute: value => dispatch('commitAll', value) },
    setTransferSelection: { capability: 'product-db:write', execute: value => dispatch('selection', value) },
    clearTransferSelection: { capability: 'product-db:write', execute: value => dispatch('clearSelection', value) },
    transferFields: { capability: 'product-db:write', execute: value => dispatch('transfer', value) },
    runGuideAction: { capability: 'product-db:write', execute: value => dispatch('guide', value) },
    uploadOptionColors: { capability: 'product-db:write', execute: value => dispatch('optionUpload', value) },
  };

  function invokeFromEvent(name, value) {
    try {
      const result = contract.invoke(name, value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  function bind(root) {
    if (!root || typeof root.addEventListener !== 'function') return () => {};
    const onInput = event => {
      const input = closest(event?.target, '[data-factory-wizard-field]');
      const payload = fieldPayload(input, 'input');
      if (payload) invokeFromEvent('setFieldDraft', payload);
    };
    const onBlur = event => {
      const input = closest(event?.target, '[data-factory-wizard-field]');
      const payload = fieldPayload(input, 'blur');
      if (payload) invokeFromEvent('setFieldDraft', payload);
    };
    const onChange = event => {
      const input = closest(event?.target, '[data-factory-wizard-field]');
      const transferId = closest(event?.target, '[data-factory-field-transfer-id]');
      if (input && !transferId) {
        const payload = fieldPayload(input, 'change');
        if (payload) invokeFromEvent('setFieldDraft', payload);
        return;
      }
      if (transferId) {
        const panel = closest(transferId, '[data-factory-field-transfer-panel]') || root;
        invokeFromEvent('setTransferSelection', Object.freeze({ selectedFieldIds: selectedTransferIds(panel, '[data-factory-field-transfer-id]:checked') }));
        return;
      }
      const file = closest(event?.target, '[data-factory-option-color-file]');
      if (file) {
        invokeFromEvent('uploadOptionColors', Object.freeze({ files: Object.freeze(Array.from(file.files || [])) }));
        file.value = '';
      }
    };
    const onClick = event => {
      const target = event?.target;
      const guide = closest(target, '[data-factory-guide-action]');
      if (guide) {
        event?.preventDefault?.();
        invokeFromEvent('runGuideAction', Object.freeze({ action: String(guide.dataset?.factoryGuideAction || '') }));
        return;
      }
      const edit = closest(target, '[data-factory-wizard-edit]');
      if (edit) {
        event?.preventDefault?.();
        invokeFromEvent('editField', Object.freeze({ fieldId: String(edit.dataset?.factoryWizardEdit || '') }));
        return;
      }
      const commitAll = closest(target, '[data-factory-wizard-commit-all]');
      if (commitAll) {
        event?.preventDefault?.();
        const panel = closest(commitAll, '#factoryWizardMissingFieldsPanel') || root;
        const fields = nodes(panel, '[data-factory-wizard-field]').map(fieldPayload).filter(Boolean);
        invokeFromEvent('commitAllFields', Object.freeze({ fields: Object.freeze(fields), renderAfter: true }));
        return;
      }
      const commit = closest(target, '[data-factory-wizard-commit]');
      if (commit && !commit.dataset?.factoryWizardEdit) {
        event?.preventDefault?.();
        const fieldId = String(commit.dataset?.factoryWizardCommit || '');
        const payload = fieldPayload(fieldInput(root, fieldId, commit));
        if (payload) invokeFromEvent('commitField', Object.freeze({ ...payload, renderAfter: true }));
        return;
      }
      const selectAll = closest(target, '[data-factory-field-transfer-select-all]');
      if (selectAll) {
        event?.preventDefault?.();
        const panel = closest(selectAll, '[data-factory-field-transfer-panel]') || root;
        invokeFromEvent('setTransferSelection', Object.freeze({ selectedFieldIds: selectedTransferIds(panel, '[data-factory-field-transfer-id]:not(:disabled)') }));
        return;
      }
      const clear = closest(target, '[data-factory-field-transfer-clear]');
      if (clear) {
        event?.preventDefault?.();
        invokeFromEvent('clearTransferSelection', Object.freeze({ selectedFieldIds: [] }));
        return;
      }
      const transfer = closest(target, '[data-factory-field-transfer-target]');
      if (transfer) {
        event?.preventDefault?.();
        if (!transfer.disabled) invokeFromEvent('transferFields', Object.freeze({ target: String(transfer.dataset?.factoryFieldTransferTarget || '') }));
        return;
      }
      const upload = closest(target, '[data-factory-option-color-upload]');
      if (upload) {
        event?.preventDefault?.();
        const panel = closest(upload, '[data-factory-option-color-panel]') || closest(upload, '.factory-automation-actions') || root;
        const input = panel?.querySelector?.('[data-factory-option-color-file]') || root.querySelector?.('[data-factory-option-color-file]');
        input?.click?.();
      }
    };
    root.addEventListener('input', onInput);
    root.addEventListener('blur', onBlur, true);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      root.removeEventListener?.('input', onInput);
      root.removeEventListener?.('blur', onBlur, true);
      root.removeEventListener?.('change', onChange);
      root.removeEventListener?.('click', onClick);
    };
  }

  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION,
    id: 'factory/fields',
    owner: 'product-db',
    capabilities: ['product-db:read', 'product-db:write'],
    commands,
    select() {
      return getSnapshot();
    },
    render(view) {
      return renderFieldsFactoryTab(view, renderHelpers);
    },
    bind,
    onEnter() {},
    onLeave() {},
    persistence: { reads: ['product-db'], writes: ['product-db'] },
  }, runtimeCapabilities);
  return contract;
}
