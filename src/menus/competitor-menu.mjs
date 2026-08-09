import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import { renderCompetitorStepView } from './competitor-menu-view.mjs';

const RENDER_HELPER_NAMES = Object.freeze([
  "getCurrentLlmRunInfo",
  "formatElapsedSeconds",
  "renderCompetitorFlowNav",
  "renderCompetitorAnalyzeLogItems",
  "renderCompetitorLlmPill",
  "compMarketAnalysisMatchesSelectedImages",
  "renderCompetitorStylePresetCard",
  "renderCompetitorEvidenceCard",
  "ensureCurrentProductAnalysisForGeneration",
  "hasCurrentProductAnalysisForGeneration",
  "orderedSections",
  "getSectionGenerationModeInfo",
  "sectionBasisDisplayInfo",
  "getSectionBasisModeInfo",
  "getSectionBasisDetail",
  "sectionBasisOptionLabel",
  "renderPlanInstructionReadable", "renderPlanImprovementBridge", "getSectionPromptResolutionInfo",
  "productAnalysisGenerationBlockReason",
  "loadCompAnalysis",
  "ensureCompMarketScrapeState",
  "compMarketSavedAnalysisMatchesSelectedImages",
  "sectionWorkScopeMeta",
  "sectionWorkScopeMatches",
  "renderCompMarketScrapePanel", "renderCompetitorAnalysisModelOptions",
  "renderFactoryLightImage",
  "disabledAttr",
  "escAttr",
  "escapeHtml"
]);

const ACTION_NAMES = Object.freeze([
  'setMode', 'setSubStep', 'navigateFlow', 'generatePlan', 'applyStylePreset', 'importImages',
  'loadLatestDetailImages', 'openDetailFolder', 'updateMarketName', 'updateMarketTarget',
  'setMarketAutoCapture', 'setMarketSite', 'importMarketImage', 'useCurrentProductImage',
  'startMarketSearch', 'setCandidateSourceView', 'reloadMarketResults', 'recoverDetailImages',
  'reloadDetailImages', 'captureDetails', 'captureDetailsAndAnalyze', 'selectAllCandidates',
  'clearCandidateSelection', 'clearMarket', 'useCandidateUrl', 'toggleCandidate', 'runMarketQuickAction',
  'toggleMarketImage', 'previewMarketImage', 'closeMarketImagePreview', 'openVisibleVm', 'resumeDetailJob',
  'openVmLogin', 'selectAllMarketImages', 'clearMarketImageSelection', 'analyzeMarketImages',
  'previewUploadedImage', 'closeUploadedImagePreview', 'openEvidencePreview', 'closeEvidencePreview',
  'removeUploadedImage', 'importHtmlFile', 'updateHtmlText', 'updateUrl', 'updateScraperBase',
  'pingBackend', 'startAnalysis', 'loadSavedReport', 'loadSavedPlan', 'updatePlanEnabled',
  'updatePlanInstructions', 'setSectionBasisMode', 'setSectionGenerationMode', 'generateSection',
  'applyPlan', 'maybeRecoverDetailImages', 'setGptOAuthModel',
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createCompetitorMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const isOperationCurrent = typeof capabilities.isOperationCurrent === 'function' ? capabilities.isOperationCurrent : candidate => getOperationToken() === candidate;
  const actions = capabilities.actions || {};
  const menuActions = Object.fromEntries(ACTION_NAMES.map(name => [
    name, name === 'startAnalysis' ? requiredFunction(actions, name)
      : (typeof actions[name] === 'function' ? actions[name] : () => undefined),
  ]));
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);
  if (!Array.isArray(renderHelpers.SECTION_BASIS_MODES)) throw new TypeError('SECTION_BASIS_MODES must be an array');
  if (!Array.isArray(renderHelpers.SECTION_GENERATION_MODES)) throw new TypeError('SECTION_GENERATION_MODES must be an array');

  let active = false, generation = 0, contract;
  const activeDisposers = new Set();
  const bindingByRoot = new WeakMap();

  function runCommand(action, value) {
    const operationToken = getOperationToken();
    const context = Object.freeze({
      operationToken,
      isCurrent: () => isOperationCurrent(operationToken),
    });
    const result = action(value, context);
    if (!result || typeof result.then !== 'function') return result;
    return Promise.resolve(result).then(output => {
      if (!context.isCurrent()) throw new Error('STALE_MENU_OPERATION');
      return output;
    });
  }

  const commands = {
    startAnalysis: {
      capability: 'competitors:write',
      execute(value) {
        assertMutable();
        return runCommand(menuActions.startAnalysis, value);
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
    id: 'competitor',
    routes: ['competitor'],
    ownedSlices: ['competitors'],
    capabilities: ['competitors:read', 'competitors:write'],
    persistence: { reads: ['competitors'], writes: ['competitors'] },
    select() {
      return getSnapshot() || {};
    },
    commands,
    render(view) {
      return renderCompetitorStepView(view, renderHelpers);
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
      const imageInput = root?.querySelector?.('#compImageInput');
      const marketImageInput = root?.querySelector?.('#compMarketImageInput');
      const clickActions = Object.freeze({
        loadLatestJepumDetail: 'loadLatestDetailImages', openJepumDetailFolder: 'openDetailFolder',
        compMarketUseCurrentImage: 'useCurrentProductImage', compMarketReloadSearchResults: 'reloadMarketResults',
        compMarketRecoverDetailImages: 'recoverDetailImages', compMarketReloadDetailImages: 'reloadDetailImages',
        compMarketVmAnalyze: 'captureDetailsAndAnalyze', compMarketVmAnalyzeMain: 'captureDetailsAndAnalyze',
        compMarketDetailSelectedAnalyzeVm: 'captureDetailsAndAnalyze', compMarketSelectAllCandidates: 'selectAllCandidates',
        compMarketClearCandidateSelection: 'clearCandidateSelection', compMarketClear: 'clearMarket',
        compMarketCloseImagePreview: 'closeMarketImagePreview', compMarketCloseImagePreviewFixed: 'closeMarketImagePreview',
        compMarketOpenVisibleVm: 'openVisibleVm', compMarketManualOpenVm: 'openVisibleVm',
        compMarketManualOpenVmCompact: 'openVisibleVm', compMarketManualResume: 'resumeDetailJob',
        compMarketManualResumeCompact: 'resumeDetailJob', compMarketOpenVmLoginSession: 'openVmLogin',
        compMarketSelectAllImages: 'selectAllMarketImages', compMarketClearImageSelection: 'clearMarketImageSelection',
        closeCompImagePreview: 'closeUploadedImagePreview', compImagePreviewOverlay: 'closeUploadedImagePreview',
        closeCompEvidencePreview: 'closeEvidencePreview', compEvidencePreviewOverlay: 'closeEvidencePreview',
        compPingBtn: 'pingBackend', compLoadReport: 'loadSavedReport', compLoadPlan: 'loadSavedPlan',
      });
      const onClick = event => {
        const node = event.target;
        const mode = closest(event, '[data-comp-mode]'); if (mode) { call('setMode', mode.dataset.compMode); return; }
        const back = closest(event, '[data-comp-back]'); if (back) { call('setSubStep', back.dataset.compBack); return; }
        const flow = closest(event, '[data-comp-flow-target]'); if (flow) { call('navigateFlow', flow.dataset.compFlowTarget); return; }
        if (closest(event, '[data-comp-flow-generate]') || closest(event, '#compGenPlan')) { call('generatePlan'); return; }
        if (closest(event, '[data-comp-style-draft]')) { call('applyStylePreset', false); return; }
        if (closest(event, '[data-comp-style-save]')) { call('applyStylePreset', true); return; }
        if (closest(event, '#compDropZone')) { imageInput?.click?.(); return; }
        if (closest(event, '#compMarketDrop')) { marketImageInput?.click?.(); return; }
        if (closest(event, '#compMarketStart')) { call('startMarketSearch', 'vm'); return; }
        if (closest(event, '#compMarketStartLocal')) { call('startMarketSearch', 'local'); return; }
        const sourceView = closest(event, '[data-comp-market-source-view]'); if (sourceView) { call('setCandidateSourceView', sourceView.dataset.compMarketSourceView); return; }
        const localCapture = closest(event, '#compMarketDetailSelectedLocalMain') || closest(event, '#compMarketDetailSelectedLocal');
        if (localCapture) { call('captureDetails', { runtime: 'local' }); return; }
        if (closest(event, '#compMarketDetailSelected') || closest(event, '#compMarketDetailSelectedMain') || closest(event, '#compMarketDetailSelectedVm')) { call('captureDetails', { runtime: 'vm' }); return; }
        const useUrl = closest(event, '[data-comp-market-use-url-id]'); if (useUrl) { call('useCandidateUrl', useUrl.dataset.compMarketUseUrlId); return; }
        const candidate = closest(event, '[data-comp-market-toggle-result]'); if (candidate) { call('toggleCandidate', candidate.dataset.compMarketToggleResult); return; }
        const quick = closest(event, '[data-comp-market-quick-action]'); if (quick) { call('runMarketQuickAction', quick.dataset.compMarketQuickAction); return; }
        const image = closest(event, '[data-comp-market-toggle-image]'); if (image) { call('toggleMarketImage', image.dataset.compMarketToggleImage); return; }
        const marketPreview = closest(event, '[data-comp-market-preview-image]'); if (marketPreview) { call('previewMarketImage', marketPreview.dataset.compMarketPreviewImage); return; }
        if (closest(event, '#compMarketAnalyzeSelectedImages')) { call('analyzeMarketImages', 'selected'); return; }
        if (closest(event, '#compMarketAnalyzeAllImages')) { call('analyzeMarketImages', 'all'); return; }
        const uploadedPreview = closest(event, '[data-comp-preview-img]'); if (uploadedPreview) { event.stopPropagation?.(); call('previewUploadedImage', Number(uploadedPreview.dataset.compPreviewImg)); return; }
        const evidence = closest(event, '[data-comp-evidence-open]'); if (evidence) { event.stopPropagation?.(); try { call('openEvidencePreview', JSON.parse(evidence.dataset.compEvidenceOpen || '{}')); } catch (_) {} return; }
        const remove = closest(event, '[data-comp-remove-img]'); if (remove) { event.stopPropagation?.(); call('removeUploadedImage', Number(remove.dataset.compRemoveImg)); return; }
        if (closest(event, '#compStartAnalyze')) { event.preventDefault?.(); if (isCurrent()) invoke('startAnalysis'); return; }
        if (closest(event, '#compViewPlan')) { call('setSubStep', 'plan'); return; }
        const section = closest(event, '[data-comp-gen-section]'); if (section) { call('generateSection', section.dataset.compGenSection); return; }
        if (closest(event, '#compApplyGenerate')) { call('applyPlan', 'generating'); return; }
        if (closest(event, '#compApplySections')) { call('applyPlan', 'sections'); return; }
        const id = node?.id;
        if (id && clickActions[id]) call(clickActions[id]);
      };
      const onInput = event => {
        const node = event.target;
        if (closest(event, '#compMarketName')) call('updateMarketName', node.value || '');
        else if (closest(event, '#compMarketTotalTarget') || closest(event, '[data-factory-comp-market-total-target]')) call('updateMarketTarget', { siteId: '', value: node.value, commit: false });
        else if (closest(event, '[data-comp-market-target]') || closest(event, '[data-factory-comp-market-target]')) call('updateMarketTarget', { siteId: node.dataset.compMarketTarget || node.dataset.factoryCompMarketTarget || '', value: node.value, commit: false });
        else if (closest(event, '#compHtmlText')) call('updateHtmlText', node.value || '');
        else if (closest(event, '#compUrlInput')) call('updateUrl', node.value || '');
        else if (closest(event, '#compScraperBase')) call('updateScraperBase', node.value || '');
        else { const plan = closest(event, '.comp-plan-input'); if (plan) call('updatePlanInstructions', { sectionId: plan.dataset.sid, instructions: plan.value || '' }); }
      };
      const onChange = event => {
        const node = event.target;
        if (closest(event, '#compImageInput')) { if (node.files?.length) call('importImages', node.files); return; }
        if (closest(event, '#compHtmlInput')) { if (node.files?.[0]) call('importHtmlFile', node.files[0]); return; }
        if (closest(event, '#compMarketImageInput')) { if (node.files?.[0]) call('importMarketImage', node.files[0]); return; }
        if (closest(event, '#compMarketAutoDetail')) { call('setMarketAutoCapture', !!node.checked); return; }
        const site = closest(event, '[data-comp-market-site]'); if (site) { call('setMarketSite', { siteId: site.dataset.compMarketSite, enabled: !!site.checked }); return; }
        if (closest(event, '#compMarketTotalTarget') || closest(event, '[data-factory-comp-market-total-target]')) { call('updateMarketTarget', { siteId: '', value: node.value, commit: true }); return; }
        if (closest(event, '[data-comp-market-target]') || closest(event, '[data-factory-comp-market-target]')) { call('updateMarketTarget', { siteId: node.dataset.compMarketTarget || node.dataset.factoryCompMarketTarget || '', value: node.value, commit: true }); return; } if (closest(event, '#compAnalysisGptOAuthModelSelect')) { call('setGptOAuthModel', node.value); return; }
        const basis = closest(event, '.section-basis-select'); if (basis) { call('setSectionBasisMode', { sectionId: basis.dataset.sectionBasis, basisId: basis.value }); return; }
        const mode = closest(event, '.section-mode-select'); if (mode) { call('setSectionGenerationMode', { sectionId: mode.dataset.sectionMode, modeId: mode.value }); return; }
        const plan = closest(event, '.comp-plan-toggle'); if (plan) call('updatePlanEnabled', { sectionId: plan.dataset.sid, enabled: !!plan.checked });
      };
      const onDragOver = event => { if (closest(event, '#compDropZone') || closest(event, '#compMarketDrop')) event.preventDefault?.(); };
      const onDrop = event => {
        if (closest(event, '#compDropZone')) { event.preventDefault?.(); if (event.dataTransfer?.files?.length) call('importImages', event.dataTransfer.files); return; }
        if (closest(event, '#compMarketDrop')) { event.preventDefault?.(); if (event.dataTransfer?.files?.[0]) call('importMarketImage', event.dataTransfer.files[0]); }
      };
      const listeners = { click: onClick, input: onInput, change: onChange, dragover: onDragOver, drop: onDrop };
      for (const [type, handler] of Object.entries(listeners)) root?.addEventListener?.(type, handler);
      const legacyAnalyze = typeof root?.addEventListener === 'function' ? null : root?.querySelector?.('#compStartAnalyze');
      const previousLegacyClick = legacyAnalyze?.onclick;
      const legacyClick = event => { event?.preventDefault?.(); invoke('startAnalysis'); };
      if (legacyAnalyze) legacyAnalyze.onclick = legacyClick;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const [type, handler] of Object.entries(listeners)) root?.removeEventListener?.(type, handler);
        if (legacyAnalyze?.onclick === legacyClick) legacyAnalyze.onclick = previousLegacyClick || null;
        activeDisposers.delete(dispose);
        if (bindingByRoot.get(root) === dispose) bindingByRoot.delete(root);
      };
      activeDisposers.add(dispose);
      bindingByRoot.set(root, dispose);
      call('maybeRecoverDetailImages');
      return dispose;
    },
    onEnter() {
      active = true;
      generation += 1;
      void active; void generation; void getOperationToken();
    },
    onLeave() {
      for (const dispose of [...activeDisposers].reverse()) dispose();
      active = false;
      generation += 1;
    },
  });

  return contract;
}
