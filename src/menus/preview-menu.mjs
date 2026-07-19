import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import { renderPreviewView } from './preview-menu-view.mjs';
import { createPreviewImageInsertBridge } from './preview-image-insert-events.mjs';
import { createPreviewAiRepairEvents } from './preview-ai-repair-events.mjs';
import { createPreviewLayerBridge, PREVIEW_LAYER_ACTION_NAMES } from './preview-layer-events.mjs';

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
  // Navigation, editing, and AI repair actions.
  'setViewport', 'navigate', 'startGenerating', 'togglePreviewEdit', 'openAiRepair', 'closeAiRepair', 'updateAiRepairField', 'persistAiRepairMask', 'runAiRepair', 'undoAiRepair', 'regenerateSection', 'applyPreviewEdit', 'updatePreviewInstruction',
  // Section content, evaluation, and layer toolbar actions.
  'setSectionLock', 'saveManualSection', 'applySectionVariant', 'applySectionVariantImage', 'evaluateSectionVariants', 'applyBestEvaluatedVariant', 'setRecoveredDetailMode', 'runQaCheck', 'runAiQaCheck', 'toggleLayerMode', 'resetAllLayers', 'exportLayeredSVG', 'exportPhotoshopPackage', 'exportJpgAll', 'exportJpgSections', 'exportHTML',
  // Image insertion and remaining-section actions.
  'openRemainingSectionsAfterStop', 'deleteDetailImage', 'moveDetailImage', 'focusSectionImage', 'deleteSectionImage', 'openImageInsert', 'closeImageInsert', 'applyImageInsert', 'updateImageInsertFolder', 'loadDetailDriveImages', 'connectImageInsertDrive', 'useDriveDetailImage', 'useCutDetailImage', 'setImageInsertError', 'requestRender',
  ...PREVIEW_LAYER_ACTION_NAMES,
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
  const reportMenuError = error => { if (error?.message !== 'STALE_MENU_OPERATION') reportError(error); };
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);


  let active = false;
  let generation = 0;
  let contract; let activeRefresh = null;
  const activeDisposers = new Set();
  const bindingByRoot = new WeakMap();

  function runCommand(action, value, rootIsCurrent = () => true) {
    const operationToken = getOperationToken();
    const context = Object.freeze({
      operationToken,
      isCurrent: () => rootIsCurrent() && getOperationToken() === operationToken,
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
      execute(value, context) {
        assertMutable();
        return runCommand(menuActions.setViewport, value, context?.isCurrent);
      },
    },
    navigate: {
      capability: 'detail-document:write',
      execute(value, context) {
        assertMutable();
        return runCommand(menuActions.navigate, value, context?.isCurrent);
      },
    },
    startGenerating: {
      capability: 'detail-document:write',
      execute(value, context) {
        assertMutable();
        return runCommand(menuActions.startGenerating, value, context?.isCurrent);
      },
    },
  };

  function invoke(name, value, rootIsCurrent = () => true) {
    try {
      const result = contract.invoke(name, value, Object.freeze({ isCurrent: rootIsCurrent }));
      if (result && typeof result.catch === 'function') result.catch(reportMenuError);
      return result;
    } catch (error) {
      reportMenuError(error);
      return undefined;
    }
  }

  function invokeAction(name, value, isCurrent) {
    if (!isCurrent()) return undefined;
    try {
      assertMutable();
      const result = runCommand(menuActions[name], value, isCurrent);
      if (result && typeof result.catch === 'function') result.catch(reportMenuError);
      return result;
    } catch (error) {
      reportMenuError(error);
      return undefined;
    }
  }

  const imageInsertEvents = createPreviewImageInsertBridge({ getSnapshot, getOperationToken, readImageFileAsDataUrl: capabilities.readImageFileAsDataUrl, actions: menuActions, invokeAction });
  const aiRepairEvents = createPreviewAiRepairEvents({ getSnapshot, getOperationToken, actions: menuActions, callAction: (name, value, context) => invokeAction(name, value, context.isCurrent), createImage: capabilities.createImage, setTimeout: capabilities.setTimeout, clearTimeout: capabilities.clearTimeout, reportError });
  const layerEvents = createPreviewLayerBridge({ getSnapshot, getOperationToken, runtimeCapabilities: capabilities, renderHelpers, actions: menuActions, invokeAction: (name, value, context) => invokeAction(name, value, context.isCurrent), reportError });

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
    refresh(root) { return activeRefresh?.(root); },
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
      const call = (name, value) => invokeAction(name, value, isCurrent); const selectorValue = value => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const readManualField = (sectionId, field) => root?.querySelector?.(`[data-manual-${field}="${selectorValue(sectionId)}"]`)?.value || '';
      const sectionSnapshot = sectionId => getSnapshot()?.sectionContents?.[sectionId] || {};
      const onClick = event => {
        const route = closest(event, '[data-route-target]');
        if (route) { event.preventDefault?.(); if (isCurrent()) invoke('navigate', route.dataset.routeTarget, isCurrent); return; }
        if (closest(event, '[data-start-generating]')) { event.preventDefault?.(); if (isCurrent()) invoke('startGenerating', undefined, isCurrent); return; }
        if (closest(event, '#openRemainingSectionsAfterStop')) { event.preventDefault?.(); call('openRemainingSectionsAfterStop'); return; }
        const viewport = closest(event, '[data-preview-viewport]');
        if (viewport) { event.preventDefault?.(); if (isCurrent()) invoke('setViewport', viewport.dataset.previewViewport, isCurrent); return; }
        if (closest(event, '#viewportPc')) { event.preventDefault?.(); if (isCurrent()) invoke('setViewport', 'pc', isCurrent); return; }
        if (closest(event, '#viewportMobile')) { event.preventDefault?.(); if (isCurrent()) invoke('setViewport', 'mobile', isCurrent); return; }
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
        const lock = closest(event, '[data-lock-preview]');
        if (lock) { const sectionId = String(lock.dataset.lockPreview || '').trim(); if (sectionId) call('setSectionLock', { sectionId, locked: !getSnapshot()?.sectionLocks?.[sectionId] }); return; }
        const manual = closest(event, '[data-save-manual]');
        if (manual) {
          const sectionId = String(manual.dataset.saveManual || '').trim();
          if (sectionId) { const content = sectionSnapshot(sectionId); call('saveManualSection', { sectionId, patch: {
            headline: readManualField(sectionId, 'headline'), subheadline: readManualField(sectionId, 'subheadline'),
            body_text: readManualField(sectionId, 'body'), cta_text: readManualField(sectionId, 'cta'),
            extra_elements: readManualField(sectionId, 'extra'), layout_suggestion: content.layout_suggestion || '',
          } }); }
          return; }
        const deleteDetailImage = closest(event, '[data-delete-detail-image]'); if (deleteDetailImage) { const blockId = String(deleteDetailImage.dataset.deleteDetailImage || '').trim(); if (blockId) call('deleteDetailImage', { blockId }); return; } const moveDetailImage = closest(event, '[data-move-detail-image]'); if (moveDetailImage) { const [blockId, direction] = String(moveDetailImage.dataset.moveDetailImage || '').split(':'); if (blockId && (direction === 'up' || direction === 'down')) call('moveDetailImage', { blockId, direction }); return; } const focusSectionImage = closest(event, '[data-focus-section-image]'); if (focusSectionImage) { const sectionId = String(focusSectionImage.dataset.focusSectionImage || '').trim(); if (sectionId) call('focusSectionImage', { sectionId }); return; } const deleteSectionImage = closest(event, '[data-delete-section-image]'); if (deleteSectionImage) { const sectionId = String(deleteSectionImage.dataset.deleteSectionImage || '').trim(); if (sectionId) call('deleteSectionImage', { sectionId }); return; } const openImageInsert = closest(event, '[data-open-image-insert]'); if (openImageInsert) { const [sectionId, mode] = String(openImageInsert.dataset.openImageInsert || '').split(':'); if (sectionId) call('openImageInsert', { sectionId, mode }); return; }
        const b1Specs = [['[data-apply-variant]', 'applyVariant', 'applySectionVariant'], ['[data-apply-variant-image]', 'applyVariantImage', 'applySectionVariantImage'], ['[data-eval-section-variants]', 'evalSectionVariants', 'evaluateSectionVariants'], ['[data-apply-eval-best]', 'applyEvalBest', 'applyBestEvaluatedVariant'], ['[data-preview-recovered-detail-mode]', 'previewRecoveredDetailMode', 'setRecoveredDetailMode']];
        for (const [selector, key, name] of b1Specs) {
          const node = closest(event, selector); if (!node) continue;
          const raw = String(node.dataset[key] || '').trim();
          if (name === 'setRecoveredDetailMode') { if (raw === 'on' || raw === 'off') call(name, raw === 'on'); return; }
          if (name === 'evaluateSectionVariants') { if (raw) call(name, { sectionId: raw }); return; }
          if (name === 'applyBestEvaluatedVariant') { if (raw) call(name, { sectionId: raw }); return; }
          const [sectionId, variantId] = raw.split(':'); if (sectionId && variantId) call(name, { sectionId, variantId }); return;
        }
        const clickActions = { runQaBtn: 'runQaCheck', runAiQaBtn: 'runAiQaCheck', toggleLayerMode: 'toggleLayerMode', resetAllLayers: 'resetAllLayers', exportLayeredSVG: 'exportLayeredSVG', exportPhotoshopPackage: 'exportPhotoshopPackage', exportJpgAll: 'exportJpgAll', exportJpgSections: 'exportJpgSections', exportHTML: 'exportHTML' };
        for (const [id, name] of Object.entries(clickActions)) {
          if (closest(event, `#${id}`)) { call(name); return; }
        }
      };
      const onInput = event => {
        const input = closest(event, '[data-edit-input]');
        if (input) call('updatePreviewInstruction', { sectionId: input.dataset.editInput, value: input.value || '' });
      };
      const listeners = { click: onClick, input: onInput }; for (const [type, handler] of Object.entries(listeners)) root?.addEventListener?.(type, handler);
      const imageInsertDispose = typeof root?.addEventListener === 'function' ? imageInsertEvents.bind(root, isCurrent) : () => undefined;
      let aiRepairDispose = typeof root?.addEventListener === 'function' ? aiRepairEvents.bind(root, isCurrent) : () => undefined;
      if (typeof root?.addEventListener === 'function') layerEvents.bind(root, isCurrent);
      activeRefresh = currentRoot => {
        if (currentRoot && currentRoot !== root) return undefined;
        aiRepairDispose?.(); aiRepairDispose = aiRepairEvents.bind(root, isCurrent);
        return layerEvents.refresh(root, isCurrent);
      };
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
        for (const [type, handler] of Object.entries(listeners)) root?.removeEventListener?.(type, handler); imageInsertDispose?.();
        aiRepairDispose?.(); layerEvents.dispose(root); activeRefresh = null;
        for (const disposeLegacy of legacyBindings.splice(0).reverse()) disposeLegacy();
        activeDisposers.delete(dispose);
        if (bindingByRoot.get(root) === dispose) bindingByRoot.delete(root);
      };
      activeDisposers.add(dispose);
      bindingByRoot.set(root, dispose);
      return dispose;
    },
    onEnter() { active = true; generation += 1; void active; void generation; void getOperationToken(); },
    onLeave() { for (const dispose of [...activeDisposers].reverse()) dispose(); active = false; generation += 1; },
  });

  return contract;
}
