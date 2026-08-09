import { PREVIEW_LAYER_ACTION_NAMES } from './preview-layer-events.mjs';

export const PREVIEW_RENDER_HELPER_NAMES = Object.freeze([
  'syncFixedSectionPlacementImages',
  'orderedSections',
  'factoryRecoveredDetailPreviewHtml',
  'renderBrandStudioPanel',
  'renderToneQuickPanel',
  'renderQaPanel',
  'renderFixedDetailImagePanel',
  'renderRecoveredDetailPreviewNotice',
  'renderRecoveredDetailPreviewAside',
  'renderPreviewOutline',
  'renderFixedDetailImageForExport',
  'cssFontFamily',
  'displayableImageSrc',
  'canUndoAiRepair',
  'getSectionGenerationModeInfo',
  'resolveSectionRenderGenerationMode',
  'renderSectionVariantQuickBar',
  'renderSectionVariantEvaluationPanel',
  'renderPreviewEditPanel',
  'renderSectionTemplate',
  'renderDetailImageBlocksAfter',
  'renderFactoryLightImage',
  'publicSectionText',
  'nl2br',
  'escAttr',
  'escapeHtml',
]);

export const PREVIEW_ACTION_NAMES = Object.freeze([
  'setViewport', 'navigate', 'startGenerating', 'togglePreviewEdit', 'openAiRepair', 'closeAiRepair',
  'updateAiRepairField', 'persistAiRepairMask', 'runAiRepair', 'undoAiRepair', 'regenerateSection',
  'applyPreviewEdit', 'updatePreviewInstruction', 'setSectionLock', 'saveManualSection',
  'applySectionVariant', 'applySectionVariantImage', 'evaluateSectionVariants',
  'applyBestEvaluatedVariant', 'setRecoveredDetailMode', 'runQaCheck', 'runAiQaCheck',
  'toggleLayerMode', 'resetAllLayers', 'exportLayeredSVG', 'exportPhotoshopPackage',
  'exportJpgAll', 'exportJpgSections', 'exportHTML', 'openRemainingSectionsAfterStop',
  'recoverPreviewArchiveSections', 'deleteDetailImage', 'moveDetailImage', 'focusSectionImage',
  'deleteSectionImage', 'openImageInsert', 'chooseSectionPlacement', 'closeImageInsert',
  'applyImageInsert', 'updateImageInsertFolder', 'loadDetailDriveImages',
  'connectImageInsertDrive', 'useDriveDetailImage', 'useCutDetailImage', 'setImageInsertError',
  'requestRender',
  ...PREVIEW_LAYER_ACTION_NAMES,
]);

export const PREVIEW_REQUIRED_ACTION_NAMES = Object.freeze(
  new Set(['setViewport', 'navigate', 'startGenerating']),
);
