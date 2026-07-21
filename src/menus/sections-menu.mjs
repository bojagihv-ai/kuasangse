import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import { renderSectionsView } from './sections-menu-view.mjs';
import { bindSectionsLegacyFallback, bindSectionsSortable, createSectionsA2Handlers } from './sections-menu-a2-events.mjs';
import { REQUIRED_SECTION_ACTIONS, SECTION_ACTIONS, SECTION_RENDER_HELPERS } from './sections-menu-contract.mjs';

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createSectionsMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const menuActions = Object.fromEntries(SECTION_ACTIONS.map(name => [
    name,
    REQUIRED_SECTION_ACTIONS.has(name)
      ? requiredFunction(actions, name)
      : (typeof actions[name] === 'function' ? actions[name] : () => undefined),
  ]));
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of SECTION_RENDER_HELPERS) requiredFunction(renderHelpers, name);
  if (!Array.isArray(renderHelpers.SECTION_BASIS_MODES)) throw new TypeError('SECTION_BASIS_MODES must be an array');
  if (!Array.isArray(renderHelpers.SECTION_GENERATION_MODES)) throw new TypeError('SECTION_GENERATION_MODES must be an array');
  const bindAnalysisPanelEvents = requiredFunction(renderHelpers, 'bindAnalysisPanelEvents'); const normalizeBrandPresetColor = typeof renderHelpers.normalizeBrandPresetColor === 'function' ? renderHelpers.normalizeBrandPresetColor : value => value;

  const isOperationCurrent = typeof capabilities.isOperationCurrent === 'function'
    ? capabilities.isOperationCurrent
    : token => getOperationToken() === token;
  const getSortable = typeof renderHelpers.getSortable === 'function' ? renderHelpers.getSortable : () => null;

  let active = false, generation = 0, contract;
  const activeDisposers = new Set();
  const bindingByRoot = new WeakMap();
  const sortableByRoot = new WeakMap();

  function runCommand(action, value, rootIsCurrent = () => true) {
    const operationToken = getOperationToken();
    const context = Object.freeze({
      operationToken,
      isCurrent: () => rootIsCurrent() && isOperationCurrent(operationToken),
    });
    const result = action(value, context);
    if (!result || typeof result.then !== 'function') return result;
    return Promise.resolve(result).then(output => {
      if (!context.isCurrent()) throw new Error('STALE_MENU_OPERATION');
      return output;
    });
  }

  const commands = {
    generateAll: {
      capability: 'detail-document:write',
      execute(value, context) {
        assertMutable();
        return runCommand(menuActions.generateAll, value, context?.isCurrent);
      },
    },
    generateSection: {
      capability: 'detail-document:write',
      execute(value, context) {
        assertMutable();
        return runCommand(menuActions.generateSection, value, context?.isCurrent);
      },
    },
    navigate: {
      capability: 'detail-document:write',
      execute(value, context) {
        assertMutable();
        return runCommand(menuActions.navigate, value, context?.isCurrent);
      },
    },
  };

  function invoke(name, value, rootIsCurrent = () => true) {
    try {
      const result = contract.invoke(name, value, Object.freeze({ isCurrent: rootIsCurrent }));
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
      const result = runCommand(menuActions[name], value, isCurrent);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'sections',
    routes: ['sections'],
    ownedSlices: ['detail-document'],
    capabilities: ['detail-document:read', 'detail-document:write'],
    persistence: { reads: ['detail-document'], writes: ['detail-document'] },
    select() {
      return getSnapshot() || {};
    },
    commands,
    render(view) {
      return renderSectionsView(view, renderHelpers);
    },
    bind(root) {
      bindingByRoot.get(root)?.dispose?.();
      const token = getOperationToken();
      const boundGeneration = generation;
      let disposed = false;
      const isCurrent = () => !disposed && active && generation === boundGeneration && isOperationCurrent(token);
      const closest = (event, selector) => {
        const node = event?.target?.closest?.(selector);
        return node && root?.contains?.(node) !== false ? node : null;
      };
      const call = (name, value) => invokeAction(name, value, isCurrent);
      const a2Handlers = createSectionsA2Handlers({ closest, call });
      const onClick = event => {
        if (a2Handlers.onClick(event)) return;
        const route = closest(event, '[data-route-target]');
        if (route) { event.preventDefault?.(); if (isCurrent()) invoke('navigate', route.dataset.routeTarget, isCurrent); return; }
        if (closest(event, '#generateAll') || closest(event, '#generateAll2')) { event.preventDefault?.(); if (isCurrent()) invoke('generateAll', undefined, isCurrent); return; }
        if (closest(event, '#sectionBatchBasisMode') || closest(event, '#sectionBatchGenerationMode') || closest(event, '[data-section-batch]')) { event.stopPropagation?.(); return; }
        if (closest(event, '#selectMissingSectionsForBatch')) { event.stopPropagation?.(); call('selectMissingSections'); return; }
        if (closest(event, '#clearMissingSectionBatchSelection')) { event.stopPropagation?.(); call('clearMissingSectionSelection'); return; }
        if (closest(event, '#generateAllMissingSections')) { event.stopPropagation?.(); call('generateMissingSections', { all: true }); return; }
        if (closest(event, '#generateSelectedMissingSections')) { event.stopPropagation?.(); call('generateMissingSections', { all: false }); return; }
        if (closest(event, '#addCustomSectionBtn')) { call('addCustomSection'); return; }
        if (closest(event, '#restoreHiddenSectionsBtn')) { call('restoreHiddenSections'); return; }
        if (closest(event, '#saveSectionDriveFolder')) {
          call('saveDriveFolder', root?.querySelector?.('#sectionDriveFolderInput')?.value?.trim?.() || ''); return;
        }
        if (closest(event, '#driveConnectFromSections')) { call('connectDrive'); return; }
        if (closest(event, '#uploadAllSectionImages')) { call('uploadAllSectionImages'); return; }
        const hide = closest(event, '[data-hide-section]'); if (hide) { event.stopPropagation?.(); call('hideSection', hide.dataset.hideSection); return; }
        const input = closest(event, '[data-section-input]'); if (input) { event.stopPropagation?.(); return; }
        const modeChoice = closest(event, '[data-section-mode-choice]');
        if (modeChoice) { event.stopPropagation?.(); const [sectionId, modeId] = String(modeChoice.dataset.sectionModeChoice || '').split(':'); if (sectionId && renderHelpers.SECTION_GENERATION_MODES.some(mode => mode.id === modeId)) call('setSectionGenerationMode', { sectionId, modeId }); return; }
        const basisChoice = closest(event, '[data-section-basis-choice]');
        if (basisChoice) { event.stopPropagation?.(); const [sectionId, basisId] = String(basisChoice.dataset.sectionBasisChoice || '').split(':'); if (sectionId && renderHelpers.SECTION_BASIS_MODES.some(basis => basis.id === basisId)) call('setSectionBasisMode', { sectionId, basisId }); return; }
        const mode = closest(event, '[data-section-mode]'); if (mode) { event.stopPropagation?.(); return; }
        const basis = closest(event, '[data-section-basis]'); if (basis) { event.stopPropagation?.(); return; }
        const generate = closest(event, '[data-generate-section]');
        if (generate) { event.preventDefault?.(); event.stopPropagation?.(); if (isCurrent()) invoke('generateSection', generate.dataset.generateSection, isCurrent); return; }
        const lock = closest(event, '[data-lock-section]'); if (lock) { event.stopPropagation?.(); call('toggleSectionLock', lock.dataset.lockSection); return; }
        const toggle = closest(event, '[data-section-toggle]'); if (toggle) call('toggleSection', toggle.dataset.sectionToggle);
      };
      const onInput = event => {
        if (a2Handlers.onInput(event)) return;
        const input = closest(event, '[data-section-input]');
        if (input) call('updateSectionInstruction', { sectionId: input.dataset.sectionInput, value: input.value || '' });
      };
      const onChange = event => {
        if (a2Handlers.onChange(event)) return;
        const basisMode = closest(event, '#sectionBatchBasisMode');
        if (basisMode) { event.stopPropagation?.(); call('updateBatchBasisMode', basisMode.value); return; }
        const generationMode = closest(event, '#sectionBatchGenerationMode');
        if (generationMode) { event.stopPropagation?.(); call('updateBatchGenerationMode', generationMode.value); return; }
        const batch = closest(event, '[data-section-batch]');
        if (batch) { event.stopPropagation?.(); call('updateBatchSelection', { sectionId: batch.dataset.sectionBatch, selected: !!batch.checked }); return; }
        const mode = closest(event, '[data-section-mode]');
        if (mode) { event.stopPropagation?.(); call('setSectionGenerationMode', { sectionId: mode.dataset.sectionMode, modeId: mode.value }); return; }
        const basis = closest(event, '[data-section-basis]');
        if (basis) { event.stopPropagation?.(); call('setSectionBasisMode', { sectionId: basis.dataset.sectionBasis, basisId: basis.value }); }
      };
      const listeners = { click: onClick, input: onInput, change: onChange };
      for (const [type, handler] of Object.entries(listeners)) root?.addEventListener?.(type, handler);
      const analysisPanelDispose = bindAnalysisPanelEvents(root, call, normalizeBrandPresetColor) || (() => {});
      bindSectionsSortable({ root, isCurrent, call, getSortable, sortableByRoot });
      const legacyBindings = bindSectionsLegacyFallback({ root, invoke });
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const [type, handler] of Object.entries(listeners)) root?.removeEventListener?.(type, handler);
        analysisPanelDispose?.();
        const sortable = sortableByRoot.get(root);
        sortable?.destroy?.();
        sortableByRoot.delete(root);
        for (const disposeLegacy of legacyBindings.splice(0).reverse()) disposeLegacy();
        activeDisposers.delete(dispose);
        if (bindingByRoot.get(root)?.dispose === dispose) bindingByRoot.delete(root);
      };
      activeDisposers.add(dispose);
      bindingByRoot.set(root, { token, dispose });
      return dispose;
    },
    refresh(root) {
      const binding = bindingByRoot.get(root);
      if (!active || !binding || isOperationCurrent(binding.token)) return;
      binding.dispose();
      contract.bind(root);
    },
    onEnter() {
      active = true;
      generation += 1;
    },
    onLeave() {
      for (const dispose of [...activeDisposers].reverse()) dispose();
      active = false;
      generation += 1;
    },
  });

  return contract;
}
