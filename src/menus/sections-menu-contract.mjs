export const SECTION_RENDER_HELPERS = Object.freeze([
  'ensureCurrentProductAnalysisForGeneration', 'ensureSectionWorkScopeCurrent',
  'syncFixedSectionPlacementImages', 'hasCurrentProductAnalysisForGeneration',
  'productAnalysisGenerationBlockReason', 'orderedSections', 'displayableImageSrc',
  'getSectionBasisModeInfo', 'getSectionGenerationModeInfo', 'renderBrandStudioPanel',
  'renderFixedDetailImagePanel', 'renderFactoryLightImage', 'renderAnalysisLog',
  'renderImageDirectivesPanel', 'renderCompetitorTipBankSummary',
  'renderSectionAssemblySummaryPanel', 'renderSectionBatchRunPanel', 'getSectionAssembly',
  'sectionAssemblyCutUsageInfo', 'getSectionInstructionSourceInfo', 'getSectionResultSourceInfo',
  'sectionBasisDisplayInfo', 'getSectionBasisDetail', 'sectionAssemblySourceSummary',
  'sectionBasisOptionLabel', 'renderSectionCompactPromptPreview',
  'renderSectionCompetitorPlanNotice', 'renderSectionGeneratedImagePreview',
  'renderSectionImageHelper', 'renderSectionBasisChooser', 'renderSectionBasisPromptCompare',
  'renderSectionAssemblyPanel', 'renderSectionModeChooser', 'disabledAttr', 'escAttr', 'escapeHtml',
]);

export const SECTION_ACTIONS = Object.freeze([
  'generateAll', 'updateBatchBasisMode', 'updateBatchGenerationMode',
  'selectMissingSections', 'clearMissingSectionSelection', 'generateMissingSections',
  'updateBatchSelection', 'addCustomSection', 'restoreHiddenSections', 'saveDriveFolder',
  'connectDrive', 'uploadAllSectionImages', 'toggleSection', 'hideSection',
  'updateSectionInstruction', 'setSectionGenerationMode', 'setSectionBasisMode',
  'generateSection', 'toggleSectionLock', 'navigate', 'generateCompetitorPlan', 'openCompetitor',
  'updateSectionAssemblySource', 'updateSectionAssemblyCutUsage', 'updateSectionAssemblyCut',
  'updateSectionAssemblyNote', 'autoDistributeSectionAssemblyCuts', 'clearSectionAssemblyCutUsage',
  'applySectionImageHelperTips', 'applyAllSectionImageHelperTips',
  'beginSectionOrderChange', 'updateSectionOrder', 'toggleAnalysisLog', 'toggleRawJson',
  'selectBrandPreset', 'selectLayoutTemplate', 'createBrandPreset', 'saveBrandPreset',
  'deleteBrandPreset', 'updateBrandPresetDraft',
]);

export const REQUIRED_SECTION_ACTIONS = Object.freeze(new Set(['generateAll', 'generateSection', 'navigate']));
