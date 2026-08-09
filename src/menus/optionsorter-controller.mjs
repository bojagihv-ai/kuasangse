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
  const getSlotNamePresets = requiredFunction(capabilities, 'getSlotNamePresets');
  const saveSlotNamePreset = requiredFunction(capabilities, 'saveSlotNamePreset');
  const loadVisionColors = requiredFunction(capabilities, 'loadVisionColors');
  const applyVisionColors = requiredFunction(capabilities, 'applyVisionColors');
  const restoreArchivedSourceImages = requiredFunction(capabilities, 'restoreArchivedSourceImages');
  const requestRender = requiredFunction(capabilities, 'requestRender');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const bindHelpers = capabilities.bindHelpers || {};
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of OPTION_SORTER_RENDER_HELPERS) requiredFunction(renderHelpers, name);

  const lifecycle = createOptionSorterLifecycleState(getOperationToken);
  let activeBinding = null;

  function bind(root) {
    activeBinding?.dispose();
    const disposeCurrent = bindOptionSorter(root, {
      getSnapshot, assertMutable, requestRender, reportError,
      bindHelpers: { ...bindHelpers, getSlotNamePresets, saveSlotNamePreset },
      claimArchiveStatusLoad: lifecycle.claimArchiveStatusLoad,
    });
    let live = true;
    const dispose = () => {
      if (!live) return;
      live = false;
      if (activeBinding?.dispose === dispose) activeBinding = null;
      disposeCurrent();
    };
    activeBinding = { root, dispose };
    return dispose;
  }

  const commands = createOptionSorterCommands({
    assertMutable, mutateOptions, persistOptions, loadVisionColors, applyVisionColors,
    requestRender, operationStamp: lifecycle.operationStamp, isCurrent: lifecycle.isCurrent,
  });
  const onEnter = () => {
    lifecycle.onEnter();
    restoreArchivedSourceImages().catch(reportError);
  };
  return createOptionSorterContract({
    getSnapshot,
    commands,
    render: view => renderOptionSorterView({
      ...view,
      slotNamePresets: getSlotNamePresets(),
    }, renderHelpers),
    bind,
    refresh(root) {
      if (!activeBinding) {
        if (root) bind(root);
        return;
      }
      bind(root || activeBinding.root);
    },
    onEnter,
    onLeave: lifecycle.onLeave,
  });
}
