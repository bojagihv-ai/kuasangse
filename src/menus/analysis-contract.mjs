export const RENDER_HELPER_NAMES = Object.freeze([
  'getActiveAnalysisRun',
  'expireStaleAnalysisRunIfNeeded',
  'renderAnalysisHub',
  'escapeHtml',
  'renderModelRunLine',
  'renderAnalysisRunLogs',
]);

export const ANALYSIS_ACTION_NAMES = Object.freeze([
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

export const CLICK_ACTIONS = Object.freeze({
  analysisHubStartBtn: 'startAnalysis', analysisHubImageOnlyBtn: 'startImageAnalysisOnly', analysisHubDbMatchBtn: 'matchCurrentProductToSinhwaDb', dbMatchNowBtn: 'matchCurrentProductToSinhwaDb',
  analysisHubImageSinhwaBtn: 'startImageBasedSinhwaDbMatch', analysisHubImageMultiBtn: 'startIntegratedSourceMatch',
  analysisHubImageOnlyCafe24Btn: 'startImageOnlyCafe24Experiment', analysisHubImageOnlyCafe24MatrixBtn: 'startImageOnlyCafe24ExperimentMatrix',
  openAutomationManualFromAnalysis: 'openAutomationManual', analysisHubClearImagesBtn: 'clearImages', dbRefreshCurrentBtn: 'refreshCurrentDbMatch',
  analysisHubLoadFactoryLatestBtn: 'loadFactoryLatest',
  dbLoadColorOptionsBtn: 'loadDbColorOptions', dbApplyColorOptionsBtn: 'applyDbColorOptions',
  dbCandidateCloseBtn: 'closeDbCandidate', productInfoOptionsToggle: 'toggleProductInfoOptions', resetProductInfoFieldsBtn: 'resetProductInfoFields',
});

export const DATA_CLICK_ACTIONS = Object.freeze([
  ['[data-analysis-hub-primary]', 'setPrimaryImage', 'analysisHubPrimary', Number],
  ['[data-db-candidate-apply]', 'applyDbCandidate', 'dbCandidateApply', String],
  ['[data-cafe24-candidate-apply]', 'applyCafe24Candidate', 'cafe24CandidateApply', String],
  ['[data-product-info-toggle]', 'toggleProductInfoField', 'productInfoToggle', String],
  ['[data-product-info-clear]', 'clearProductInfoValue', 'productInfoClear', String],
  ['[data-analysis-combo]', 'setAnalysisCombo', 'analysisCombo', String],
  ['[data-analysis-source-toggle]', 'toggleAnalysisSource', 'analysisSourceToggle', String],
]);

export function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}
