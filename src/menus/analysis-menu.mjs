import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

const RENDER_HELPER_NAMES = Object.freeze([
  "getActiveAnalysisRun",
  "expireStaleAnalysisRunIfNeeded",
  "renderAnalysisHub",
  "escapeHtml",
  "renderModelRunLine",
  "renderAnalysisRunLogs"
]);

const ANALYSIS_ACTION_NAMES = Object.freeze([
  'updateProductName', 'commitProductName', 'updateNaturalText', 'commitNaturalText',
  'setUseName', 'setUseNaturalText', 'setImageInferenceEngine', 'setCafe24RankEngine',
  'setGptOAuthModel', 'setGeminiModel', 'setMatchSource', 'startAnalysis',
  'startImageAnalysisOnly', 'matchCurrentProductToSinhwaDb', 'startImageBasedSinhwaDbMatch',
  'startIntegratedSourceMatch', 'startImageOnlyCafe24Experiment', 'startImageOnlyCafe24ExperimentMatrix',
  'openAutomationManual', 'uploadFiles', 'clearImages', 'setPrimaryImage', 'refreshCurrentDbMatch',
  'loadFactoryLatest', 'loadDbColorOptions', 'applyDbColorOptions', 'closeDbCandidate',
  'applyDbCandidate', 'applyCafe24Candidate', 'toggleProductInfoOptions', 'resetProductInfoFields',
  'toggleProductInfoField', 'saveProductInfoValue', 'clearProductInfoValue', 'setAnalysisCombo',
  'toggleAnalysisSource', 'toggleAnalysisLog', 'toggleRawJson', 'selectBrandPreset',
  'selectLayoutTemplate', 'createBrandPreset', 'saveBrandPreset', 'deleteBrandPreset',
  'updateBrandPresetDraft',
]);

const CLICK_ACTIONS = Object.freeze({
  analysisHubStartBtn: 'startAnalysis', analysisHubImageOnlyBtn: 'startImageAnalysisOnly', analysisHubDbMatchBtn: 'matchCurrentProductToSinhwaDb', dbMatchNowBtn: 'matchCurrentProductToSinhwaDb',
  analysisHubImageSinhwaBtn: 'startImageBasedSinhwaDbMatch', analysisHubImageMultiBtn: 'startIntegratedSourceMatch',
  analysisHubImageOnlyCafe24Btn: 'startImageOnlyCafe24Experiment', analysisHubImageOnlyCafe24MatrixBtn: 'startImageOnlyCafe24ExperimentMatrix',
  openAutomationManualFromAnalysis: 'openAutomationManual', analysisHubClearImagesBtn: 'clearImages', dbRefreshCurrentBtn: 'refreshCurrentDbMatch',
  analysisHubLoadFactoryLatestBtn: 'loadFactoryLatest',
  dbLoadColorOptionsBtn: 'loadDbColorOptions', dbApplyColorOptionsBtn: 'applyDbColorOptions',
  dbCandidateCloseBtn: 'closeDbCandidate', productInfoOptionsToggle: 'toggleProductInfoOptions', resetProductInfoFieldsBtn: 'resetProductInfoFields',
});

const DATA_CLICK_ACTIONS = Object.freeze([
  ['[data-analysis-hub-primary]', 'setPrimaryImage', 'analysisHubPrimary', Number],
  ['[data-db-candidate-apply]', 'applyDbCandidate', 'dbCandidateApply', String],
  ['[data-cafe24-candidate-apply]', 'applyCafe24Candidate', 'cafe24CandidateApply', String],
  ['[data-product-info-toggle]', 'toggleProductInfoField', 'productInfoToggle', String],
  ['[data-product-info-clear]', 'clearProductInfoValue', 'productInfoClear', String],
  ['[data-analysis-combo]', 'setAnalysisCombo', 'analysisCombo', String],
  ['[data-analysis-source-toggle]', 'toggleAnalysisSource', 'analysisSourceToggle', String],
]);

const BRAND_PRESET_FIELDS = Object.freeze([
  ['#brandPresetName', 'name'],
  ['#brandPresetTone', 'tone'],
  ['#brandPresetKeywords', 'requiredKeywords'],
  ['#brandPresetBanned', 'bannedPhrases'],
  ['#brandPresetHeadlineFont', 'headlineFont'],
  ['#brandPresetBodyFont', 'bodyFont'],
  ['#brandPresetAccent', 'accentColor'],
  ['#brandPresetBackground', 'backgroundColor'],
  ['#brandPresetImageDirectives', 'imageDirectives'],
  ['#brandPresetGlobalInstruction', 'globalInstruction'],
]);

const ANALYSIS_PANEL_BUTTONS = Object.freeze([
  ['#analysisLogToggle', 'toggleAnalysisLog'],
  ['#toggleRawJson', 'toggleRawJson'],
  ['#newBrandPresetBtn', 'createBrandPreset'],
  ['#saveBrandPresetBtn', 'saveBrandPreset'],
  ['#deleteBrandPresetBtn', 'deleteBrandPreset'],
]);

const analysisPanelBindings = new WeakMap();

function panelNode(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function panelListen(disposers, root, selector, type, listener) {
  const node = panelNode(root, selector);
  if (!node?.addEventListener) return;
  node.addEventListener(type, listener);
  disposers.push(() => node.removeEventListener?.(type, listener));
}

/**
 * Bind the analysis/log and brand-preset controls that are rendered inside the
 * sections view. The owner remains this analysis module, while the caller
 * supplies the route-fenced action dispatcher.
 */
function bindAnalysisPanelEvents(root, dispatch, normalizeColor = value => value) {
  if (typeof dispatch !== 'function') throw new TypeError('analysis panel dispatch must be a function');
  if (!root || typeof root.querySelector !== 'function') return () => {};
  analysisPanelBindings.get(root)?.();

  const disposers = [];
  const call = (name, value) => dispatch(name, value);
  for (const [selector, action] of ANALYSIS_PANEL_BUTTONS) {
    panelListen(disposers, root, selector, 'click', event => {
      event?.preventDefault?.();
      call(action);
    });
  }
  panelListen(disposers, root, '#brandPresetSelect', 'change', event => {
    call('selectBrandPreset', event?.target?.value || '');
  });
  panelListen(disposers, root, '#layoutTemplateSelect', 'change', event => {
    call('selectLayoutTemplate', event?.target?.value || '');
  });
  for (const [selector, field] of BRAND_PRESET_FIELDS) {
    panelListen(disposers, root, selector, 'input', event => {
      call('updateBrandPresetDraft', { field, value: event?.target?.value || '' });
    });
  }

  const bindColorPair = (field, textSelector, pickerSelector) => {
    panelListen(disposers, root, pickerSelector, 'input', event => {
      const value = event?.target?.value || '';
      const textInput = panelNode(root, textSelector);
      if (textInput) textInput.value = value;
      call('updateBrandPresetDraft', { field, value });
    });
    panelListen(disposers, root, textSelector, 'blur', event => {
      const value = String(event?.target?.value || '');
      const normalized = normalizeColor(value);
      if (!normalized) return;
      const picker = panelNode(root, pickerSelector);
      if (picker) picker.value = normalized;
      if (event?.target) event.target.value = normalized;
      call('updateBrandPresetDraft', { field, value: normalized });
    });
  };
  bindColorPair('accentColor', '#brandPresetAccent', '#brandPresetAccentPicker');
  bindColorPair('backgroundColor', '#brandPresetBackground', '#brandPresetBackgroundPicker');

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    while (disposers.length) disposers.pop()();
    if (analysisPanelBindings.get(root) === dispose) analysisPanelBindings.delete(root);
  };
  analysisPanelBindings.set(root, dispose);
  return dispose;
}

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createAnalysisMenu(capabilities = {}) {
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

Object.defineProperty(createAnalysisMenu, 'bindAnalysisPanelEvents', { value: bindAnalysisPanelEvents });

function renderAnalyzingView(view, helpers) {
  const {
    getActiveAnalysisRun,
    expireStaleAnalysisRunIfNeeded,
    renderAnalysisHub,
    escapeHtml,
    renderModelRunLine,
    renderAnalysisRunLogs,
  } = helpers;
  const run = getActiveAnalysisRun();
  if (expireStaleAnalysisRunIfNeeded(run)) return renderAnalysisHub();
  if (!run || run.status !== 'running') return renderAnalysisHub();
  const progress = Math.max(0, Math.min(100, Math.round(Number(run.progress ?? view.progress ?? 0) || 0)));
  const latestLog = Array.isArray(run.logs) && run.logs.length ? run.logs[run.logs.length - 1] : null;
  const message = view.progressMsg || latestLog?.message || '제품 이미지 분석 중...';
  const lastUpdatedAt = run.lastUpdatedAt || latestLog?.ts || run.startedAt;
  const elapsedSec = lastUpdatedAt ? Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000)) : 0;
  return `<div data-analysis-progress-status style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:46vh">
    <div class="spinner-lg"></div>
    <h2 style="font-size:22px;margin-top:24px;margin-bottom:8px">AI 분석 진행 중</h2>
    <p data-analysis-progress-message style="color:var(--text-d);margin-bottom:10px">${escapeHtml(message)}</p>
    <div style="font-size:12px;color:var(--text-m);margin-bottom:20px">${escapeHtml(renderModelRunLine(run.llm))}</div>
    <div class="progress-outer"><div data-analysis-progress-bar class="progress-inner" style="width:${progress}%">${progress}%</div></div>
    <div style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:12px">
      <span data-analysis-progress-elapsed style="font-size:11px;color:var(--text-m)">마지막 진행 갱신 ${elapsedSec}초 전</span>
      <button class="btn-sm" id="stopAnalysisRunBtn" style="color:var(--warn);padding:6px 10px">
        <span class="material-icons-outlined" style="font-size:14px">stop_circle</span>
        분석 중단하고 돌아가기
      </button>
    </div>
    <div class="analysis-box" style="width:min(760px,100%);margin-top:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
        <div style="font-size:15px;font-weight:900">실시간 작업 로그</div>
        <div style="font-size:12px;color:var(--text-m)">나중에 AI 분석 종합에서 다시 볼 수 있습니다.</div>
      </div>
      <div data-analysis-progress-logs>${renderAnalysisRunLogs(run)}</div>
    </div>
  </div>`;
}
