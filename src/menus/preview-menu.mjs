import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import { renderPreviewView } from './preview-menu-view.mjs';

const RENDER_HELPER_NAMES = Object.freeze([
  "syncFixedSectionPlacementImages",
  "orderedSections",
  "factoryRecoveredDetailPreviewHtml",
  "renderBrandStudioPanel",
  "renderToneQuickPanel",
  "renderQaPanel",
  "renderFixedDetailImagePanel",
  "renderRecoveredDetailPreviewNotice",
  "renderRecoveredDetailPreviewAside",
  "renderPreviewOutline",
  "renderFixedDetailImageForExport",
  "cssFontFamily",
  "displayableImageSrc",
  "canUndoAiRepair",
  "getSectionGenerationModeInfo",
  "resolveSectionRenderGenerationMode",
  "renderSectionVariantQuickBar",
  "renderSectionVariantEvaluationPanel",
  "renderPreviewEditPanel",
  "renderSectionTemplate",
  "renderDetailImageBlocksAfter",
  "renderFactoryLightImage",
  "publicSectionText",
  "nl2br",
  "escAttr",
  "escapeHtml"
]);

const ACTION_NAMES = Object.freeze([
  'setViewport', 'navigate', 'startGenerating', 'togglePreviewEdit', 'openAiRepair',
  'undoAiRepair', 'regenerateSection', 'applyPreviewEdit', 'updatePreviewInstruction',
  'runQaCheck', 'runAiQaCheck', 'toggleLayerMode', 'resetAllLayers', 'exportLayeredSVG',
  'exportPhotoshopPackage', 'exportJpgAll', 'exportJpgSections', 'exportHTML',
  'openRemainingSectionsAfterStop',
]);
const REQUIRED_ACTION_NAMES = Object.freeze(new Set(['setViewport', 'navigate', 'startGenerating']));

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createPreviewMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const menuActions = Object.fromEntries(ACTION_NAMES.map(name => [
    name,
    REQUIRED_ACTION_NAMES.has(name)
      ? requiredFunction(actions, name)
      : (typeof actions[name] === 'function' ? actions[name] : () => undefined),
  ]));
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);


  let active = false;
  let generation = 0;
  let contract;
  const activeDisposers = new Set();
  const bindingByRoot = new WeakMap();

  function runCommand(action, value) {
    const operationToken = getOperationToken();
    const context = Object.freeze({
      operationToken,
      isCurrent: () => getOperationToken() === operationToken,
    });
    const result = action(value, context);
    if (!result || typeof result.then !== 'function') return result;
    return Promise.resolve(result).then(output => {
      if (!context.isCurrent()) throw new Error('STALE_MENU_OPERATION');
      return output;
    });
  }

  const commands = {
    setViewport: {
      capability: 'detail-document:write',
      execute(value) {
        assertMutable();
        return runCommand(menuActions.setViewport, value);
      },
    },
    navigate: {
      capability: 'detail-document:write',
      execute(value) {
        assertMutable();
        return runCommand(menuActions.navigate, value);
      },
    },
    startGenerating: {
      capability: 'detail-document:write',
      execute(value) {
        assertMutable();
        return runCommand(menuActions.startGenerating, value);
      },
    },
  };

  function invoke(name, value) {
    try {
      const result = contract.invoke(name, value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  function invokeAction(name, value, isCurrent) {
    if (!isCurrent()) return undefined;
    try {
      assertMutable();
      const result = runCommand(menuActions[name], value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'preview',
    routes: ['preview'],
    ownedSlices: ['detail-document'],
    capabilities: ['detail-document:read', 'detail-document:write'],
    persistence: { reads: ['detail-document'], writes: ['detail-document'] },
    select() {
      return getSnapshot() || {};
    },
    commands,
    render(view) {
      return renderPreviewView(view, renderHelpers);
    },
    bind(root) {
      bindingByRoot.get(root)?.();
      const token = getOperationToken();
      const boundGeneration = generation;
      let disposed = false;
      const isCurrent = () => !disposed && active && generation === boundGeneration && getOperationToken() === token;
      const closest = (event, selector) => {
        const node = event?.target?.closest?.(selector);
        return node && root?.contains?.(node) !== false ? node : null;
      };
      const call = (name, value) => invokeAction(name, value, isCurrent);
      const onClick = event => {
        const route = closest(event, '[data-route-target]');
        if (route) { event.preventDefault?.(); if (isCurrent()) invoke('navigate', route.dataset.routeTarget); return; }
        if (closest(event, '[data-start-generating]')) { event.preventDefault?.(); if (isCurrent()) invoke('startGenerating'); return; }
        if (closest(event, '#openRemainingSectionsAfterStop')) { event.preventDefault?.(); call('openRemainingSectionsAfterStop'); return; }
        const viewport = closest(event, '[data-preview-viewport]');
        if (viewport) { event.preventDefault?.(); if (isCurrent()) invoke('setViewport', viewport.dataset.previewViewport); return; }
        if (closest(event, '#viewportPc')) { event.preventDefault?.(); if (isCurrent()) invoke('setViewport', 'pc'); return; }
        if (closest(event, '#viewportMobile')) { event.preventDefault?.(); if (isCurrent()) invoke('setViewport', 'mobile'); return; }
        const edit = closest(event, '[data-edit-preview]'); if (edit) { call('togglePreviewEdit', edit.dataset.editPreview); return; }
        const repair = closest(event, '[data-ai-repair]'); if (repair) { call('openAiRepair', repair.dataset.aiRepair); return; }
        const undo = closest(event, '[data-undo-ai-repair]'); if (undo) { call('undoAiRepair', undo.dataset.undoAiRepair); return; }
        const regen = closest(event, '[data-regen]'); if (regen) { call('regenerateSection', regen.dataset.regen); return; }
        const apply = closest(event, '[data-apply-edit]');
        if (apply) {
          const sectionId = apply.dataset.applyEdit;
          const inputs = [...(root?.querySelectorAll?.('[data-edit-input]') || [])];
          const input = inputs.filter(node => node.dataset.editInput === sectionId).at(-1);
          call('applyPreviewEdit', { sectionId, value: input?.value || '' });
          return;
        }
        const clickActions = {
          runQaBtn: 'runQaCheck', runAiQaBtn: 'runAiQaCheck', toggleLayerMode: 'toggleLayerMode',
          resetAllLayers: 'resetAllLayers', exportLayeredSVG: 'exportLayeredSVG',
          exportPhotoshopPackage: 'exportPhotoshopPackage', exportJpgAll: 'exportJpgAll',
          exportJpgSections: 'exportJpgSections', exportHTML: 'exportHTML',
        };
        for (const [id, name] of Object.entries(clickActions)) {
          if (closest(event, `#${id}`)) { call(name); return; }
        }
      };
      const onInput = event => {
        const input = closest(event, '[data-edit-input]');
        if (input) call('updatePreviewInstruction', { sectionId: input.dataset.editInput, value: input.value || '' });
      };
      const listeners = { click: onClick, input: onInput };
      for (const [type, handler] of Object.entries(listeners)) root?.addEventListener?.(type, handler);
      const legacyBindings = [];
      if (typeof root?.addEventListener !== 'function') {
        const legacySpecs = [
          ['[data-route-target]', 'navigate', 'routeTarget'],
          ['[data-preview-viewport]', 'setViewport', 'previewViewport'],
          ['[data-start-generating]', 'startGenerating', ''],
        ];
        for (const [selector, name, dataKey] of legacySpecs) {
          for (const node of root?.querySelectorAll?.(selector) || []) {
            const previous = node.onclick;
            const handler = event => {
              event?.preventDefault?.();
              invoke(name, dataKey ? node.dataset[dataKey] : undefined);
            };
            node.onclick = handler;
            legacyBindings.push(() => { if (node.onclick === handler) node.onclick = previous || null; });
          }
        }
      }
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const [type, handler] of Object.entries(listeners)) root?.removeEventListener?.(type, handler);
        for (const disposeLegacy of legacyBindings.splice(0).reverse()) disposeLegacy();
        activeDisposers.delete(dispose);
        if (bindingByRoot.get(root) === dispose) bindingByRoot.delete(root);
      };
      activeDisposers.add(dispose);
      bindingByRoot.set(root, dispose);
      return dispose;
    },
    onEnter() {
      active = true;
      generation += 1;
      void active;
      void generation;
      void getOperationToken();
    },
    onLeave() {
      for (const dispose of [...activeDisposers].reverse()) dispose();
      active = false;
      generation += 1;
    },
  });

  return contract;
}
