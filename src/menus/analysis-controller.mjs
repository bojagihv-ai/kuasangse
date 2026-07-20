import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import {
  ANALYSIS_ACTION_NAMES,
  CLICK_ACTIONS,
  DATA_CLICK_ACTIONS,
  RENDER_HELPER_NAMES,
  requiredFunction,
} from './analysis-contract.mjs';
import { renderAnalyzingView } from './analysis-view.mjs';

export function createAnalysisMenuController(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const stopAnalysis = requiredFunction(actions, 'stopAnalysis');
  const analysisActions = Object.fromEntries(ANALYSIS_ACTION_NAMES.map(name => [
    name, typeof actions[name] === 'function' ? actions[name] : () => undefined,
  ]));
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);

  let active = false, generation = 0;
  let contract;
  const activeDisposers = new Set();

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
    stopAnalysis: {
      capability: 'product-analysis:write',
      execute(value) {
        assertMutable();
        return runCommand(stopAnalysis, value);
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
      const result = runCommand(analysisActions[name], value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'analyzing',
    routes: ['analyzing'],
    ownedSlices: ['product-analysis'],
    capabilities: ['product-analysis:read', 'product-analysis:write'],
    persistence: { reads: ['product-analysis'], writes: ['product-analysis'] },
    select() {
      return getSnapshot() || {};
    },
    commands,
    render(view) {
      return renderAnalyzingView(view, renderHelpers);
    },
    bind(root) {
      const token = getOperationToken();
      const boundGeneration = generation;
      const isCurrent = () => active && generation === boundGeneration && getOperationToken() === token;
      const closest = (event, selector) => {
        const node = event?.target?.closest?.(selector);
        return node && root?.contains?.(node) !== false ? node : null;
      };
      const call = (name, value) => invokeAction(name, value, isCurrent);
      const fileInput = root?.querySelector?.('#analysisHubFileInput');
      const openFiles = mode => {
        if (!fileInput || !isCurrent()) return;
        fileInput.dataset.mode = mode;
        fileInput.click?.();
      };
      const onClick = event => {
        if (closest(event, '#stopAnalysisRunBtn')) { event.preventDefault?.(); if (isCurrent()) invoke('stopAnalysis'); return; }
        if (closest(event, '#analysisHubUploadBtn')) { openFiles('add'); return; }
        if (closest(event, '#analysisHubReplaceBtn')) { openFiles('replace'); return; }
        if (closest(event, '#analysisHubThumbAddBtn')) { event.stopPropagation?.(); openFiles('add'); return; }
        const zone = closest(event, '#analysisHubUploadZone');
        if (zone && !event.target?.closest?.('button')) { openFiles('add'); return; }
        for (const [id, name] of Object.entries(CLICK_ACTIONS)) {
          if (closest(event, `#${id}`)) { call(name); return; }
        }
        const save = closest(event, '[data-product-info-save]');
        if (save) {
          const fieldId = save.dataset.productInfoSave;
          const input = root?.querySelector?.(`[data-product-info-manual="${fieldId}"]`);
          call('saveProductInfoValue', { fieldId, value: input?.value || '' });
          return;
        }
        for (const [selector, name, key, parse] of DATA_CLICK_ACTIONS) {
          const node = closest(event, selector);
          if (node) { call(name, parse(node.dataset[key])); return; }
        }
      };
      const onInput = event => {
        if (closest(event, '#analysisMatchNameInput')) call('updateProductName', event.target?.value || '');
        else if (closest(event, '#analysisNaturalTextInput')) call('updateNaturalText', event.target?.value || '');
      };
      const onChange = event => {
        const node = event.target;
        if (closest(event, '#analysisHubFileInput')) {
          const files = node?.files;
          if (files?.length) call('uploadFiles', { files, replace: fileInput?.dataset?.mode === 'replace' });
          if (fileInput) { fileInput.value = ''; fileInput.dataset.mode = 'add'; }
          return;
        }
        const changeActions = [
          ['#analysisMatchNameInput', 'commitProductName'], ['#analysisNaturalTextInput', 'commitNaturalText'],
          ['#analysisUseNameToggle', 'setUseName', 'checked'], ['#analysisUseNaturalToggle', 'setUseNaturalText', 'checked'],
          ['#analysisImageInferenceEngineSelect', 'setImageInferenceEngine', 'value'],
          ['#analysisCafe24RankEngineSelect', 'setCafe24RankEngine', 'value'],
          ['#analysisGptOAuthModelSelect', 'setGptOAuthModel', 'value'], ['#analysisGeminiModelSelect', 'setGeminiModel', 'value'],
        ];
        for (const [selector, name, property] of changeActions) {
          if (closest(event, selector)) { call(name, property ? node?.[property] : undefined); return; }
        }
        const source = closest(event, '[data-analysis-match-source]');
        if (source) call('setMatchSource', { source: source.dataset.analysisMatchSource, enabled: !!source.checked });
      };
      const onDragOver = event => { if (closest(event, '#analysisHubUploadZone')) event.preventDefault?.(); };
      const onDrop = event => {
        if (!closest(event, '#analysisHubUploadZone')) return;
        event.preventDefault?.();
        if (event.dataTransfer?.files?.length) call('uploadFiles', { files: event.dataTransfer.files, replace: false });
      };
      const listeners = { click: onClick, input: onInput, change: onChange, dragover: onDragOver, drop: onDrop };
      for (const [type, handler] of Object.entries(listeners)) root?.addEventListener?.(type, handler);
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const [type, handler] of Object.entries(listeners)) root?.removeEventListener?.(type, handler);
        activeDisposers.delete(dispose);
      };
      activeDisposers.add(dispose);
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
