import { bindOptionSorterGeneration } from './optionsorter-generation-bindings.mjs';
import { bindOptionSorterImages } from './optionsorter-image-bindings.mjs';
import { bindOptionSorterLayout } from './optionsorter-layout-bindings.mjs';
import { bindOptionSorterResults } from './optionsorter-result-bindings.mjs';
import { bindOptionSorterSlots } from './optionsorter-slot-bindings.mjs';

const EVENT_PROPERTIES = Object.freeze([
  'onclick', 'onchange', 'oninput', 'onblur', 'onfocus', 'onkeydown',
  'ondragstart', 'ondragover', 'ondragleave', 'ondrop',
]);

export function bindOptionSorter(root, dependencies) {
  const {
    getSnapshot, assertMutable, requestRender, reportError, bindHelpers,
    claimArchiveStatusLoad,
  } = dependencies;
  const boundNodes = new Set();
  const sortableInstances = new Set();
  const remember = node => {
    if (node) boundNodes.add(node);
    return node || null;
  };
  const byId = id => remember(root?.querySelector?.('#' + id));
  const queryOne = selector => remember(root?.querySelector?.(selector));
  const queryAll = selector => Array.from(root?.querySelectorAll?.(selector) || []).map(remember);
  const optionSorter = () => getSnapshot()?.optionSorter || {};
  const currentStep = typeof bindHelpers.getCurrentStep === 'function'
    ? bindHelpers.getCurrentStep
    : () => 'optionsorter';
  const activeElement = typeof bindHelpers.getActiveElement === 'function'
    ? bindHelpers.getActiveElement
    : () => null;
  const sortable = typeof bindHelpers.getSortable === 'function'
    ? bindHelpers.getSortable()
    : null;
  const reportWarning = typeof bindHelpers.reportWarning === 'function'
    ? bindHelpers.reportWarning
    : reportError;
  const createSortable = (node, options = {}) => {
    if (!node || typeof sortable?.create !== 'function') return null;
    const guardedOptions = { ...options };
    for (const name of ['onStart', 'onEnd', 'onAdd', 'onUpdate', 'onRemove']) {
      if (typeof guardedOptions[name] !== 'function') continue;
      const listener = guardedOptions[name];
      guardedOptions[name] = (...args) => {
        assertMutable();
        return listener(...args);
      };
    }
    const instance = sortable.create(node, guardedOptions);
    if (instance) sortableInstances.add(instance);
    return instance;
  };
  const context = {
    ...bindHelpers,
    activeElement, byId, queryAll, queryOne, optionSorter, requestRender,
    currentStep, sortable, createSortable, reportWarning, claimArchiveStatusLoad,
  };

  bindOptionSorterImages(context);
  bindOptionSorterLayout(context);
  bindOptionSorterGeneration(context);
  bindOptionSorterResults(context);
  bindOptionSorterSlots(context);

  for (const node of boundNodes) {
    for (const property of EVENT_PROPERTIES) {
      if (typeof node?.[property] !== 'function') continue;
      const listener = node[property];
      node[property] = (...args) => {
        assertMutable();
        try {
          const result = listener(...args);
          if (result && typeof result.catch === 'function') result.catch(reportError);
          return result;
        } catch (error) {
          reportError(error);
          return undefined;
        }
      };
    }
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const instance of sortableInstances) {
      try { instance.destroy?.(); } catch (error) { reportError(error); }
    }
    sortableInstances.clear();
    for (const node of boundNodes) {
      for (const property of EVENT_PROPERTIES) {
        if (typeof node?.[property] === 'function') node[property] = null;
      }
    }
    boundNodes.clear();
  };
}
