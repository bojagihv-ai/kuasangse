import { bindOptionSorter } from './optionsorter-bindings.mjs';
import {
  OPTION_SORTER_RENDER_HELPERS,
  createOptionSorterCommands,
  createOptionSorterContract,
} from './optionsorter-contract.mjs';
import { createOptionSorterLifecycleState } from './optionsorter-state.mjs';
import { renderOptionSorterView } from './optionsorter-view.mjs';

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createOptionSorterMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const mutateOptions = requiredFunction(capabilities, 'mutateOptions');
  const persistOptions = requiredFunction(capabilities, 'persistOptions');
  const loadVisionColors = requiredFunction(capabilities, 'loadVisionColors');
  const applyVisionColors = requiredFunction(capabilities, 'applyVisionColors');
  const requestRender = requiredFunction(capabilities, 'requestRender');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const bindHelpers = capabilities.bindHelpers || {};
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of OPTION_SORTER_RENDER_HELPERS) requiredFunction(renderHelpers, name);

  const lifecycle = createOptionSorterLifecycleState(getOperationToken);

  const commands = createOptionSorterCommands({
    assertMutable, mutateOptions, persistOptions, loadVisionColors, applyVisionColors,
    requestRender, operationStamp: lifecycle.operationStamp, isCurrent: lifecycle.isCurrent,
  });
  return createOptionSorterContract({
    getSnapshot,
    commands,
    render: view => renderOptionSorterView(view, renderHelpers),
    bind: root => bindOptionSorter(root, {
      getSnapshot, assertMutable, requestRender, reportError, bindHelpers,
      claimArchiveStatusLoad: lifecycle.claimArchiveStatusLoad,
    }),
    onEnter: lifecycle.onEnter,
    onLeave: lifecycle.onLeave,
  });
}
