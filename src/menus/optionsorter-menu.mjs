import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

const EVENT_PROPERTIES = Object.freeze([
  'onclick', 'onchange', 'oninput', 'onblur', 'onfocus', 'onkeydown',
  'ondragstart', 'ondragover', 'ondragleave', 'ondrop',
]);

const RENDER_HELPER_NAMES = Object.freeze([
  'ensureOptionSorterDefaults', 'optMissingImagePayloadCount', 'renderOptionSorterSourceStrip',
  'renderOptionSorterAssignmentWorkspace', 'renderOptionImageGeneratorPanel',
  'optRenderImageOrPlaceholder', 'renderOptionSorterImagePreviewModal', 'disabledAttr', 'escapeHtml',
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createOptionSorterMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const mutateOptions = requiredFunction(capabilities, 'mutateOptions');
  const persistOptions = requiredFunction(capabilities, 'persistOptions');
  const loadVisionColors = requiredFunction(capabilities, 'loadVisionColors');
  const applyVisionColors = requiredFunction(capabilities, 'applyVisionColors');
  const requestRender = requiredFunction(capabilities, 'requestRender');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const bindHelpers = capabilities.bindHelpers || {};
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);

  let active = false;
  let generation = 0;
  let archiveStatusLoadStarted = false;

  const operationStamp = () => ({ generation, token: getOperationToken() });
  const isCurrent = operation => active
    && operation.generation === generation
    && operation.token === getOperationToken();

  const commands = {
    addSlot: {
      capability: 'options:write',
      execute(value = {}) {
        assertMutable();
        const slot = {
          id: String(value.id || 'slot-' + Date.now()),
          name: String(value.name || '').trim() || '새 옵션',
          imgIds: Array.isArray(value.imgIds) ? [...value.imgIds] : [],
        };
        mutateOptions({ type: 'add-slot', slot });
        persistOptions({ reason: 'add-slot', slotId: slot.id });
        requestRender();
        return slot;
      },
    },
    setSubStep: {
      capability: 'options:write',
      execute(value) {
        assertMutable();
        const subStep = value === 'sort' ? 'sort' : 'input';
        mutateOptions({ type: 'set-sub-step', subStep });
        persistOptions({ reason: 'set-sub-step', subStep });
        requestRender();
        return subStep;
      },
    },
    refreshVisionColors: {
      capability: 'options:write',
      async execute(value) {
        assertMutable();
        const operation = operationStamp();
        const result = await loadVisionColors(value);
        if (!isCurrent(operation)) return { ignored: true, reason: 'stale-operation' };
        applyVisionColors(result);
        persistOptions({ reason: 'vision-colors' });
        requestRender();
        return result;
      },
    },
  };

  const contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'optionsorter',
    routes: ['optionsorter'],
    ownedSlices: ['options'],
    capabilities: ['options:read', 'options:write'],
    persistence: { reads: ['options'], writes: ['options'] },
    select(root = {}) {
      const snapshot = getSnapshot() || {};
      return { optionSorter: root.optionSorter || snapshot.optionSorter || {} };
    },
    commands,
    render(view) {
      return renderOptionSorterView(view, renderHelpers);
    },
    bind(root) {
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
      const {
        applyOptionGenerationPipeline,
        clampOptionSheetCount,
        clampOptionSheetPixels,
        clearFixedDetailImage,
        clearOptionColorSectionPlacement,
        defaultOptionSorterState,
        detectOptionTonePresetId,
        ensureDefaultSectionPlacements,
        ensureOptionSorterDefaults,
        factorySendOptionSorterResultsToFactory,
        getOptionGenerationPipeline,
        getOptionImagePairs,
        getOptionOutputSheets,
        getOptionToneDisplayName,
        getOptionTonePreset,
        handleFixedDetailImageFile,
        optAddImages,
        optAppendLogs,
        optApplyOptionSheetPixelPreset,
        optArchiveAllOptionResults,
        optArchiveOptionResult,
        optChooseArchiveFolder,
        optClearStyleSample,
        optDeleteSlot,
        optDeleteStyleSampleFromLibrary,
        optDownloadAllOptionResults,
        optDownloadOptionResult,
        optDownloadOptionResultSplits,
        optDownloadSlot,
        optFocusSlotNameByIndex,
        optGenerateOptionImages,
        optGetArchiveDirectoryHandle,
        optGetOptionSheetPixelRecommendations,
        optGetOptionSheetSize,
        optGetPixelAspectWarning,
        optGetSelectedLayoutPattern,
        optLayoutSummaryFromSheets,
        optLoadArchiveFolderStatus,
        optOpenImagePreview,
        optParseLayoutPatternInput,
        optRefreshOptionSheetPixelForLayout,
        optRefreshVisionColorHints,
        optRenderPatternPreview,
        optScheduleSave,
        optSetColorImageUsage,
        optSetStyleSample,
        optSetStyleSampleFromLibrary,
        optSetStyleSampleFromResult,
        optSwapOptionPairOrder,
        optSyncSlotCountToImages,
        optUseExistingColorImagesFromResult,
        readImageFileAsDataUrl,
        saveLastWorkNow,
        syncOptFromDOM,
        syncOptSlotsFromDOM,
        uid,
      } = bindHelpers;

      // ── 옵션 분류기 이벤트 ────────────────────────────────────────
      // 이미지 업로드
      const optUploadZone = byId('optUploadZone');
      const optFileInput = byId('optFileInput');
      const optAddImagesBtn = byId('optAddImagesBtn');
      if (optAddImagesBtn && optFileInput) {
        optAddImagesBtn.onclick = () => optFileInput.click();
      }
      if (optUploadZone) {
        optUploadZone.onclick = e => { if (e.target.tagName !== 'INPUT') optFileInput?.click(); };
        optUploadZone.ondragover = e => { e.preventDefault(); optUploadZone.classList.add('dragover'); };
        optUploadZone.ondragleave = () => optUploadZone.classList.remove('dragover');
        optUploadZone.ondrop = e => { e.preventDefault(); optUploadZone.classList.remove('dragover'); optAddImages(e.dataTransfer.files); };
      }
      if (optFileInput) optFileInput.onchange = e => {
        optAddImages(e.target.files);
        e.target.value = '';
      };
      
      queryAll('[data-opt-color-image-usage]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          optSetColorImageUsage(btn.dataset.optColorImageUsage, optionSorter());
          saveLastWorkNow();
          requestRender();
        };
      });
      
      const optClearImages = byId('optClearImages');
      if (optClearImages) optClearImages.onclick = () => {
        const os = optionSorter();
        os.images = []; os.pool = [];
        os.previewImageId = null;
        optAppendLogs(os, '현재 옵션 이미지만 비웠습니다. 기존 생성 결과는 아래에서 기존색상쓰기/샘플로 계속 사용할 수 있습니다.');
        os.optionGenProgress = 0;
        os.optionVisionColorBusy = false;
        os.slots = defaultOptionSorterState().slots;
        optScheduleSave();
        requestRender();
      };
      queryAll('[data-opt-remove-img]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const id = btn.dataset.optRemoveImg;
          const os = optionSorter();
          os.images = os.images.filter(i => i.id !== id);
          os.pool = os.pool.filter(i => i !== id);
          if (os.previewImageId === id) os.previewImageId = null;
          os.slots.forEach(s => { s.imgIds = s.imgIds.filter(i => i !== id); });
          optSyncSlotCountToImages(os);
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-preview-img]').forEach(el => {
        const openPreview = e => {
          if (e?.target?.closest?.('[data-opt-remove-img]')) return;
          if (typeof optOpenImagePreview === 'function') {
            optOpenImagePreview(el.dataset.optPreviewImg);
          } else {
            optionSorter().previewImageId = el.dataset.optPreviewImg;
            requestRender();
          }
        };
        el.onclick = openPreview;
        el.onkeydown = e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          openPreview(e);
        };
      });
      const optImagePreviewOverlay = byId('optImagePreviewOverlay');
      if (optImagePreviewOverlay) optImagePreviewOverlay.onclick = () => {
        optionSorter().previewImageId = null;
        optionSorter().previewResultId = null;
        requestRender();
      };
      const closeOptImagePreview = byId('closeOptImagePreview');
      if (closeOptImagePreview) closeOptImagePreview.onclick = () => {
        optionSorter().previewImageId = null;
        optionSorter().previewResultId = null;
        requestRender();
      };
      queryAll('[data-opt-option-mode]').forEach(btn => {
        btn.onclick = () => {
          optionSorter().optionImageMode = btn.dataset.optOptionMode || 'ready';
          optScheduleSave();
          requestRender();
        };
      });
      const optLayoutAutoBtn = queryOne('[data-opt-layout-auto]');
      if (optLayoutAutoBtn) optLayoutAutoBtn.onclick = () => {
        optionSorter().optionSheetLayoutUserSet = false;
        optionSorter().optionSheetLayoutMode = 'auto';
        optionSorter().optionSheetRowPattern = '';
        const selected = optGetSelectedLayoutPattern(optionSorter(), getOptionImagePairs(optionSorter()).length);
        optRefreshOptionSheetPixelForLayout(optionSorter(), { rows: selected.selectedRows, cols: selected.selectedCols });
        optScheduleSave();
        requestRender();
      };
      const optLayoutManualBtn = queryOne('[data-opt-layout-manual]');
      if (optLayoutManualBtn) optLayoutManualBtn.onclick = () => {
        const selected = optGetSelectedLayoutPattern(optionSorter(), getOptionImagePairs(optionSorter()).length || 1);
        optionSorter().optionSheetLayoutUserSet = true;
        optionSorter().optionSheetLayoutMode = 'rows';
        optionSorter().optionSheetRows = selected.selectedRows;
        optionSorter().optionSheetCols = selected.selectedCols;
        optionSorter().optionSheetRowPattern = selected.selectedPattern.join(',');
        optScheduleSave();
        requestRender();
      };
      queryAll('[data-opt-output-layout]').forEach(btn => {
        btn.onclick = () => {
          optionSorter().optionSheetLayoutUserSet = true;
          optionSorter().optionOutputLayout = btn.dataset.optOutputLayout || 'all';
          optionSorter().optionSheetLayoutMode = 'grid';
          optionSorter().optionSheetRowPattern = '';
          if (optionSorter().optionOutputLayout === 'pairs') {
            optionSorter().optionSheetCols = 2;
            optionSorter().optionSheetRows = 1;
          } else {
            optionSorter().optionSheetCols = 2;
            optionSorter().optionSheetRows = 2;
          }
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-layout-pattern]').forEach(btn => {
        btn.onclick = () => {
          const parsed = optParseLayoutPatternInput(btn.dataset.optLayoutPattern, getOptionImagePairs(optionSorter()).length || 1);
          if (!parsed) return;
          optionSorter().optionSheetLayoutUserSet = true;
          optionSorter().optionSheetLayoutMode = parsed.mode;
          optionSorter().optionSheetRows = parsed.rows;
          optionSorter().optionSheetCols = parsed.cols;
          optionSorter().optionSheetRowPattern = parsed.mode === 'rows' ? parsed.pattern.join(',') : '';
          optionSorter().optionOutputLayout = (parsed.cols === 2 && parsed.rows === 1) ? 'pairs' : 'all';
          optRefreshOptionSheetPixelForLayout(optionSorter(), { rows: parsed.rows, cols: parsed.cols });
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-grid-preset]').forEach(btn => {
        btn.onclick = () => {
          const [rows, cols] = String(btn.dataset.optGridPreset || '2x2').split('x').map(v => clampOptionSheetCount(v, 2));
          optionSorter().optionSheetLayoutUserSet = true;
          optionSorter().optionSheetLayoutMode = 'grid';
          optionSorter().optionSheetRowPattern = '';
          optionSorter().optionSheetRows = rows || 2;
          optionSorter().optionSheetCols = cols || 2;
          optionSorter().optionOutputLayout = (optionSorter().optionSheetCols === 2 && optionSorter().optionSheetRows === 1) ? 'pairs' : 'all';
          optRefreshOptionSheetPixelForLayout(optionSorter());
          optScheduleSave();
          requestRender();
        };
      });
      const optSheetColsInput = byId('optSheetColsInput');
      const optSheetRowsInput = byId('optSheetRowsInput');
      const optSheetPatternInput = byId('optSheetPatternInput');
      const optUpdateOptionSheetLiveSummary = () => {
        const os = optionSorter();
        ensureOptionSorterDefaults(os);
        const pairs = getOptionImagePairs(os);
        const sheets = getOptionOutputSheets(pairs, os);
        const selected = optGetSelectedLayoutPattern(os, pairs.length || 1);
        const size = optGetOptionSheetSize(os, { rows: selected.selectedRows, cols: selected.selectedCols });
        const outputSummary = `${selected.selectedLabel} · 최대 ${selected.capacity}개/장 · ${optLayoutSummaryFromSheets(sheets)} · ${size.width}px x ${size.height}px`;
        const capacityInput = byId('optSheetCapacityInput');
        if (capacityInput) capacityInput.value = `${selected.capacity}개 / 총 ${sheets.length || 0}장`;
        const summaryEl = byId('optSheetOutputSummary');
        if (summaryEl) summaryEl.textContent = `현재 출력: ${outputSummary}. ${os.optionSheetLayoutUserSet ? '직접 정한 행열' : '매칭된 사진 수 기반 자동 배치'}로 시트가 생성됩니다.`;
        const planEl = byId('optOutputPlanSummary');
        if (planEl) planEl.textContent = `출력 예정: ${sheets.length || 0}장 · ${outputSummary}`;
        const directPreview = byId('optLayoutDirectPreview');
        if (directPreview) {
          directPreview.innerHTML = optRenderPatternPreview(selected.selectedPattern || [1]);
        }
        const pixelRec = optGetOptionSheetPixelRecommendations(os, { rows: selected.selectedRows, cols: selected.selectedCols });
        const twoKEl = byId('optPixel2kValue');
        if (twoKEl) twoKEl.textContent = `${pixelRec.twoK.width}px x ${pixelRec.twoK.height}px`;
        const fourKEl = byId('optPixel4kValue');
        if (fourKEl) fourKEl.textContent = `${pixelRec.fourK.width}px x ${pixelRec.fourK.height}px`;
        const pixelRecEl = byId('optPixelRecommendationSummary');
        if (pixelRecEl) pixelRecEl.textContent = `권장 최대: 4K ${pixelRec.fourK.width}px x ${pixelRec.fourK.height}px · 2K ${pixelRec.twoK.width}px x ${pixelRec.twoK.height}px`;
        const warningEl = byId('optPixelAspectWarning');
        if (warningEl) {
          const warning = optGetPixelAspectWarning(size, pixelRec);
          warningEl.textContent = warning;
          warningEl.style.color = warning ? 'var(--danger)' : 'var(--text-m)';
        }
        const widthInput = byId('optSheetWidthInput');
        const heightInput = byId('optSheetHeightInput');
        if (widthInput && activeElement() !== widthInput) widthInput.value = size.width;
        if (heightInput && activeElement() !== heightInput) heightInput.value = size.height;
        const currentPixelPreset = os.optionSheetPixelMode === 'custom' ? (os.optionSheetPixelPreset || 'custom') : 'auto';
        queryAll('[data-opt-sheet-pixel-mode]').forEach(btn => {
          const mode = btn.dataset.optSheetPixelMode === 'custom' ? 'custom' : 'auto';
          btn.classList.toggle('active', currentPixelPreset === mode);
        });
        queryAll('[data-opt-pixel-preset]').forEach(btn => {
          const preset = btn.dataset.optPixelPreset === '4k' ? '4k' : '2k';
          btn.classList.toggle('active', currentPixelPreset === preset);
          btn.classList.toggle('recommended', currentPixelPreset === preset);
        });
      };
      const syncOptionSheetGridInputs = (shouldRender = false) => {
        optionSorter().optionSheetLayoutUserSet = true;
        optionSorter().optionSheetLayoutMode = 'grid';
        optionSorter().optionSheetRowPattern = '';
        if (optSheetColsInput) optionSorter().optionSheetCols = clampOptionSheetCount(optSheetColsInput.value, 2);
        if (optSheetRowsInput) optionSorter().optionSheetRows = clampOptionSheetCount(optSheetRowsInput.value, 2);
        optionSorter().optionOutputLayout = (optionSorter().optionSheetCols === 2 && optionSorter().optionSheetRows === 1) ? 'pairs' : 'all';
        optRefreshOptionSheetPixelForLayout(optionSorter());
        optScheduleSave();
        if (shouldRender) requestRender();
        else optUpdateOptionSheetLiveSummary();
      };
      if (optSheetColsInput) {
        optSheetColsInput.oninput = () => syncOptionSheetGridInputs(false);
        optSheetColsInput.onchange = () => syncOptionSheetGridInputs(true);
        optSheetColsInput.onblur = () => syncOptionSheetGridInputs(true);
      }
      if (optSheetRowsInput) {
        optSheetRowsInput.oninput = () => syncOptionSheetGridInputs(false);
        optSheetRowsInput.onchange = () => syncOptionSheetGridInputs(true);
        optSheetRowsInput.onblur = () => syncOptionSheetGridInputs(true);
      }
      const syncOptionSheetPatternInput = (shouldRender = false) => {
        const parsed = optParseLayoutPatternInput(optSheetPatternInput?.value || '', getOptionImagePairs(optionSorter()).length || 1);
        if (parsed) {
          optionSorter().optionSheetLayoutUserSet = true;
          optionSorter().optionSheetLayoutMode = parsed.mode;
          optionSorter().optionSheetRows = parsed.rows;
          optionSorter().optionSheetCols = parsed.cols;
          optionSorter().optionSheetRowPattern = parsed.mode === 'rows' ? parsed.pattern.join(',') : '';
          optionSorter().optionOutputLayout = (parsed.cols === 2 && parsed.rows === 1) ? 'pairs' : 'all';
          optRefreshOptionSheetPixelForLayout(optionSorter(), { rows: parsed.rows, cols: parsed.cols });
        }
        optScheduleSave();
        if (shouldRender) requestRender();
        else optUpdateOptionSheetLiveSummary();
      };
      if (optSheetPatternInput) {
        optSheetPatternInput.oninput = () => syncOptionSheetPatternInput(false);
        optSheetPatternInput.onchange = () => syncOptionSheetPatternInput(true);
        optSheetPatternInput.onblur = () => syncOptionSheetPatternInput(true);
      }
      queryAll('[data-opt-sheet-pixel-mode]').forEach(btn => {
        btn.onclick = () => {
          const nextMode = btn.dataset.optSheetPixelMode === 'custom' ? 'custom' : 'auto';
          optApplyOptionSheetPixelPreset(optionSorter(), nextMode === 'custom' ? 'custom' : 'auto');
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-pixel-preset]').forEach(btn => {
        btn.onclick = () => {
          const preset = btn.dataset.optPixelPreset === '4k' ? '4k' : '2k';
          const selected = optGetSelectedLayoutPattern(optionSorter(), getOptionImagePairs(optionSorter()).length || 1);
          optApplyOptionSheetPixelPreset(optionSorter(), preset, { rows: selected.selectedRows, cols: selected.selectedCols });
          optScheduleSave();
          requestRender();
        };
      });
      const optSheetWidthInput = byId('optSheetWidthInput');
      const optSheetHeightInput = byId('optSheetHeightInput');
      const syncOptionSheetPixelInputs = (shouldRender = false) => {
        if (optSheetWidthInput) optionSorter().optionSheetWidth = clampOptionSheetPixels(optSheetWidthInput.value, optGetOptionSheetSize(optionSorter()).autoWidth);
        if (optSheetHeightInput) optionSorter().optionSheetHeight = clampOptionSheetPixels(optSheetHeightInput.value, optGetOptionSheetSize(optionSorter()).autoHeight);
        optionSorter().optionSheetPixelMode = 'custom';
        optionSorter().optionSheetPixelPreset = 'custom';
        optScheduleSave();
        if (shouldRender) requestRender();
        else optUpdateOptionSheetLiveSummary();
      };
      if (optSheetWidthInput) {
        optSheetWidthInput.oninput = () => syncOptionSheetPixelInputs(false);
        optSheetWidthInput.onchange = () => syncOptionSheetPixelInputs(true);
        optSheetWidthInput.onblur = () => syncOptionSheetPixelInputs(true);
      }
      if (optSheetHeightInput) {
        optSheetHeightInput.oninput = () => syncOptionSheetPixelInputs(false);
        optSheetHeightInput.onchange = () => syncOptionSheetPixelInputs(true);
        optSheetHeightInput.onblur = () => syncOptionSheetPixelInputs(true);
      }
      queryAll('[data-opt-pipeline]').forEach(btn => {
        btn.onclick = () => {
          const pipelineId = btn.dataset.optPipeline || 'local_canvas';
          applyOptionGenerationPipeline(optionSorter(), pipelineId);
          const pipeline = getOptionGenerationPipeline(optionSorter());
          optAppendLogs(optionSorter(), `실제 생성 방식 선택: ${pipeline.name}`);
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-sheet-method]').forEach(btn => {
        btn.onclick = () => {
          optionSorter().optionSheetMethod = btn.dataset.optSheetMethod || 'ai_sheet';
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-content-mode]').forEach(btn => {
        btn.onclick = () => {
          optionSorter().optionContentMode = btn.dataset.optContentMode || 'full_image';
          optScheduleSave();
          requestRender();
        };
      });
      queryAll('[data-opt-tone-preset]').forEach(btn => {
        btn.onclick = () => {
          const preset = getOptionTonePreset(btn.dataset.optTonePreset);
          optionSorter().optionTonePresetId = preset.id;
          optionSorter().optionTone = preset.tone;
          optionSorter().optionGenLogs = [
            ...(optionSorter().optionGenLogs || []),
            `톤앤매너 프리셋 적용: ${preset.name}`,
          ].slice(-18);
          optScheduleSave();
          requestRender();
        };
      });
      const optOptionTone = byId('optOptionTone');
      if (optOptionTone) {
        optOptionTone.oninput = () => {
          optionSorter().optionTone = optOptionTone.value;
          optionSorter().optionTonePresetId = detectOptionTonePresetId(optOptionTone.value);
          optScheduleSave();
        };
        optOptionTone.onblur = () => { saveLastWorkNow(); requestRender(); };
      }
      const optOptionExtraPrompt = byId('optOptionExtraPrompt');
      if (optOptionExtraPrompt) {
        optOptionExtraPrompt.oninput = () => {
          optionSorter().optionExtraPrompt = optOptionExtraPrompt.value;
          optScheduleSave();
        };
        optOptionExtraPrompt.onblur = () => { saveLastWorkNow(); requestRender(); };
      }
      const optGenerateOptions = byId('optGenerateOptions');
      if (optGenerateOptions) optGenerateOptions.onclick = () => optGenerateOptionImages();
      queryAll('[data-opt-send-factory-result]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          factorySendOptionSorterResultsToFactory([btn.dataset.optSendFactoryResult]);
        };
      });
      const optSendCurrentOptionResults = byId('optSendCurrentOptionResultsToFactory');
      if (optSendCurrentOptionResults) optSendCurrentOptionResults.onclick = () => {
        const resultIds = String(optSendCurrentOptionResults.dataset.optSendCurrentResults || '')
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);
        factorySendOptionSorterResultsToFactory(resultIds);
      };
      const optVisionColorCheck = byId('optVisionColorCheck');
      if (optVisionColorCheck) optVisionColorCheck.onclick = () => optRefreshVisionColorHints().catch(e => {
        optAppendLogs(optionSorter(), `AI 비전 색상 판정 실패: ${e.message || e}`);
        optionSorter().optionVisionColorBusy = false;
        optScheduleSave();
        requestRender();
      });
      queryAll('[data-opt-preview-result]').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          optionSorter().previewResultId = el.dataset.optPreviewResult;
          optionSorter().previewImageId = null;
          requestRender();
        };
      });
      queryAll('[data-opt-set-style-sample]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const ok = optSetStyleSampleFromResult(btn.dataset.optSetStyleSample, optionSorter());
          if (!ok) optAppendLogs(optionSorter(), '샘플 지정 실패: 이미지가 있는 생성 결과를 선택해주세요.');
          saveLastWorkNow();
          requestRender();
        };
      });
      queryAll('[data-opt-load-style-sample]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const ok = optSetStyleSampleFromLibrary(btn.dataset.optLoadStyleSample, optionSorter());
          if (!ok) optAppendLogs(optionSorter(), '샘플 불러오기 실패: 보관함 샘플을 찾을 수 없습니다.');
          saveLastWorkNow();
          requestRender();
        };
      });
      queryAll('[data-opt-delete-style-sample]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          optDeleteStyleSampleFromLibrary(btn.dataset.optDeleteStyleSample, optionSorter());
          saveLastWorkNow();
          requestRender();
        };
      });
      const optClearStyleSampleBtn = byId('optClearStyleSample');
      if (optClearStyleSampleBtn) optClearStyleSampleBtn.onclick = e => {
        e.stopPropagation();
        optClearStyleSample(optionSorter());
        saveLastWorkNow();
        requestRender();
      };
      const optUploadStyleSampleBtn = byId('optUploadStyleSample');
      const optStyleSampleFileInput = byId('optStyleSampleFileInput');
      if (optUploadStyleSampleBtn && optStyleSampleFileInput) {
        optUploadStyleSampleBtn.onclick = e => {
          e.stopPropagation();
          optStyleSampleFileInput.click();
        };
        optStyleSampleFileInput.onchange = async () => {
          const file = optStyleSampleFileInput.files && optStyleSampleFileInput.files[0];
          optStyleSampleFileInput.value = '';
          if (!file) return;
          try {
            const dataUrl = await readImageFileAsDataUrl(file);
            const ok = optSetStyleSample({
              id: uid('sample'),
              sourceResultId: '',
              name: `업로드 샘플 · ${String(file.name || '옵션 디자인').slice(0, 48)}`,
              image: dataUrl,
              tonePresetName: getOptionToneDisplayName(optionSorter()),
              pipelineName: '외부 참고 디자인',
              modelLabel: 'user-upload',
              sourceName: file.name || 'uploaded-style-sample',
              createdAt: new Date().toISOString(),
            }, optionSorter(), { saveToLibrary: true });
            if (!ok) optAppendLogs(optionSorter(), '샘플 업로드 실패: 이미지 형식을 확인해주세요.');
            else ensureDefaultSectionPlacements({ forceOption: true });
          } catch (err) {
            optAppendLogs(optionSorter(), `샘플 업로드 실패: ${err.message || err}`);
          }
          saveLastWorkNow();
          requestRender();
        };
      }
      queryAll('[data-opt-download-result]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          optDownloadOptionResult(btn.dataset.optDownloadResult);
        };
      });
      queryAll('[data-opt-download-splits]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          optDownloadOptionResultSplits(btn.dataset.optDownloadSplits);
        };
      });
      queryAll('[data-opt-use-existing-colors]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const added = optUseExistingColorImagesFromResult(btn.dataset.optUseExistingColors, optionSorter());
          if (added) requestRender();
          else {
            optScheduleSave();
            requestRender();
          }
        };
      });
      queryAll('[data-opt-archive-result]').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const os = optionSorter();
          const result = (os.optionResults || []).find(item => item.id === btn.dataset.optArchiveResult);
          if (!result) return;
          try {
            if (!(await optGetArchiveDirectoryHandle())) {
              await optChooseArchiveFolder();
              if (!(await optGetArchiveDirectoryHandle())) return;
            }
            await optArchiveOptionResult(result, { force: true });
            os.optionArchiveEnabled = true;
            optAppendLogs(os, `폴더 저장 완료: ${result.optionName || result.id}`);
            saveLastWorkNow();
            requestRender();
          } catch (archiveError) {
            os.optionArchiveStatus = `폴더 저장 실패: ${archiveError.message || archiveError}`;
            optAppendLogs(os, os.optionArchiveStatus);
            optScheduleSave();
            requestRender();
          }
        };
      });
      const optClearOptionResults = byId('optClearOptionResults');
      if (optClearOptionResults) optClearOptionResults.onclick = () => {
        const os = optionSorter();
        os.optionResults = [];
        os.previewResultId = null;
        os.optionGenLogs = [];
        os.optionGenProgress = 0;
        clearOptionColorSectionPlacement();
        optScheduleSave();
        requestRender();
      };
      const optDownloadAllOptionResultsBtn = byId('optDownloadAllOptionResults');
      if (optDownloadAllOptionResultsBtn) optDownloadAllOptionResultsBtn.onclick = () => optDownloadAllOptionResults();
      queryAll('[data-fixed-detail-pick]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const slotId = btn.dataset.fixedDetailPick;
          queryOne(`input[data-fixed-detail-file="${slotId}"]`)?.click();
        };
      });
      queryAll('[data-fixed-detail-file]').forEach(input => {
        input.onchange = async e => {
          e.stopPropagation();
          const file = input.files?.[0];
          if (file) await handleFixedDetailImageFile(input.dataset.fixedDetailFile, file);
          input.value = '';
        };
      });
      queryAll('[data-fixed-detail-clear]').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          clearFixedDetailImage(btn.dataset.fixedDetailClear);
        };
      });
      const optChooseArchiveFolderBtn = byId('optChooseArchiveFolder');
      if (optChooseArchiveFolderBtn) optChooseArchiveFolderBtn.onclick = () => optChooseArchiveFolder();
      const optToggleArchiveAutoBtn = byId('optToggleArchiveAuto');
      if (optToggleArchiveAutoBtn) optToggleArchiveAutoBtn.onclick = async () => {
        const os = optionSorter();
        ensureOptionSorterDefaults(os);
        if (!os.optionArchiveEnabled && !(await optGetArchiveDirectoryHandle())) {
          await optChooseArchiveFolder();
          if (!(await optGetArchiveDirectoryHandle())) return;
        }
        os.optionArchiveEnabled = !os.optionArchiveEnabled;
        os.optionArchiveStatus = os.optionArchiveEnabled
          ? `자동 저장 켜짐: ${os.optionArchiveFolderName || '선택한 폴더'}`
          : '자동 저장을 껐습니다. 이미 저장된 폴더 파일은 그대로 유지됩니다.';
        optAppendLogs(os, os.optionArchiveStatus);
        saveLastWorkNow();
        requestRender();
      };
      const optArchiveAllResultsBtn = byId('optArchiveAllResults');
      if (optArchiveAllResultsBtn) optArchiveAllResultsBtn.onclick = () => optArchiveAllOptionResults();
      if ((optChooseArchiveFolderBtn || optArchiveAllResultsBtn) && !archiveStatusLoadStarted) {
        archiveStatusLoadStarted = true;
        optLoadArchiveFolderStatus({ render: true }).catch(e => {
          reportWarning('Option archive status load failed:', e);
        });
      }
      
      // 슬롯 추가 (입력화면)
      const optAddSlotInput = byId('optAddSlotInput');
      if (optAddSlotInput) optAddSlotInput.onclick = () => {
        const os = optionSorter();
        const n = os.slots.length + 1;
        os.slots.push({ id: 'slot_' + Date.now(), name: n + '번', imgIds: [] });
        optScheduleSave();
        requestRender();
        optFocusSlotNameByIndex(os.slots.length - 1);
      };
      
      // 입력화면 슬롯 이름 수정
      queryAll('.opt-slot-name-inp').forEach((inp, idx) => {
        inp.oninput = () => {
          const slot = optionSorter().slots.find(s => s.id === inp.dataset.slotName);
          if (slot) slot.name = inp.value;
          optScheduleSave();
        };
        inp.onfocus = () => inp.select();
        inp.onblur = () => { saveLastWorkNow(); };
        inp.onkeydown = e => {
          if (e.key !== 'Enter' && e.key !== 'Tab') return;
          e.preventDefault();
          const inputs = [...queryAll('.opt-slot-name-inp')];
          const next = inputs[idx + (e.key === 'Tab' && e.shiftKey ? -1 : 1)];
          if (next) {
            next.focus();
            next.select();
          } else {
            const goSort = byId('optGoSort');
            const addSlot = byId('optAddSlotInput');
            (goSort && !goSort.disabled ? goSort : addSlot)?.focus();
          }
        };
        inp.ondragstart = e => e.stopPropagation();
        inp.onclick = e => e.stopPropagation();
      });
      
      // 입력화면 슬롯 삭제
      queryAll('[data-slot-del-input]').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); optDeleteSlot(btn.dataset.slotDelInput); };
      });
      
      // 분류 시작 버튼
      const optGoSort = byId('optGoSort');
      if (optGoSort) optGoSort.onclick = () => {
        const os = optionSorter();
        // 아직 배정 안 된 이미지만 pool에 추가 (기존 슬롯 배정 유지)
        const assignedIds = new Set(os.slots.flatMap(s => s.imgIds));
        const newPool = os.images.filter(i => !assignedIds.has(i.id) && !os.pool.includes(i.id)).map(i => i.id);
        os.pool = [...os.pool, ...newPool].filter(id => os.images.some(im => im.id === id));
        os.slots.forEach(s => { s.imgIds = s.imgIds.filter(id => os.images.some(im => im.id === id)); });
        os.subStep = 'sort';
        optScheduleSave();
        requestRender();
      };
      
      // 분류 화면: 슬롯 추가
      const optAddSlot = byId('optAddSlot');
      if (optAddSlot) optAddSlot.onclick = () => {
        const os = optionSorter();
        const n = os.slots.length + 1;
        os.slots.push({ id: 'slot_' + Date.now(), name: n + '번', imgIds: [] });
        optScheduleSave();
        requestRender();
      };
      
      // 분류 화면: 슬롯 삭제
      queryAll('[data-slot-del]').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); optDeleteSlot(btn.dataset.slotDel); };
      });
      
      // 분류 화면: 이미지 변경 (입력으로 돌아가기)
      const optBackInput = byId('optBackInput');
      if (optBackInput) optBackInput.onclick = () => { optionSorter().subStep = 'input'; optScheduleSave(); requestRender(); };
      
      // 전체 다운로드
      const optDlAll = byId('optDlAll');
      if (optDlAll) optDlAll.onclick = () => optDownloadSlot('__all__');
      
      // 슬롯별 다운로드
      queryAll('[data-opt-dl-slot]').forEach(btn => {
        btn.onclick = () => optDownloadSlot(btn.dataset.optDlSlot);
      });
      
      // SortableJS — 분류 화면에서만 초기화
      if (currentStep() === 'optionsorter' && optionSorter().subStep === 'sort' && sortable) {
        const os = optionSorter();
        const sharedGroup = { name: 'opt-imgs', pull: true, put: true };
        const onImgEnd = () => { syncOptFromDOM(); requestRender(); };
      
        // 미배정 풀
        const poolList = byId('optPoolList');
        if (poolList) {
          createSortable(poolList, { group: sharedGroup, animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', onEnd: onImgEnd });
        }
        // 각 슬롯 리스트
        os.slots.forEach(slot => {
          const el = byId('optSlotList_' + slot.id);
          if (el) createSortable(el, { group: sharedGroup, animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', onEnd: onImgEnd });
        });
        // 슬롯 그리드 자체 재정렬
        const slotGrid = byId('optSlotGrid');
        if (slotGrid) {
          createSortable(slotGrid, { handle: '.opt-slot-handle', animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', onEnd() { syncOptSlotsFromDOM(); requestRender(); } });
        }
        const mapRows = [...queryAll('[data-opt-map-row-index]')];
        if (mapRows.length) {
          let mapOrderBefore = [];
          let mapRowOffsets = [];
          const mapGroup = { name: 'opt-map-pairs', pull: true, put: true };
          mapRows.forEach(row => {
            createSortable(row, {
              group: mapGroup,
              handle: '.opt-map-drag-handle',
              animation: 150,
              ghostClass: 'sortable-ghost',
              chosenClass: 'sortable-chosen',
              onStart() {
                mapOrderBefore = [...queryAll('[data-opt-map-pair-key]')].map(card => card.dataset.optMapPairKey);
                let offset = 0;
                mapRowOffsets = mapRows.map(item => {
                  const current = offset;
                  offset += item.children.length;
                  return current;
                });
              },
              onEnd(event) {
                const fromIndex = (mapRowOffsets[mapRows.indexOf(event.from)] || 0) + event.oldIndex;
                const toIndex = (mapRowOffsets[mapRows.indexOf(event.to)] || 0) + event.newIndex;
                const firstKey = mapOrderBefore[fromIndex];
                const secondKey = mapOrderBefore[toIndex];
                if (firstKey && secondKey) optSwapOptionPairOrder(firstKey, secondKey, optionSorter());
                requestRender();
              },
            });
          });
        }
      }
      
      

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
    },
    onEnter() {
      active = true;
      generation += 1;
    },
    onLeave() {
      active = false;
      generation += 1;
      archiveStatusLoadStarted = false;
    },
  });

  return contract;
}

function renderOptionSorterView(view, helpers) {
  const {
    ensureOptionSorterDefaults, optMissingImagePayloadCount, renderOptionSorterSourceStrip,
    renderOptionSorterAssignmentWorkspace, renderOptionImageGeneratorPanel,
    optRenderImageOrPlaceholder, renderOptionSorterImagePreviewModal, disabledAttr, escapeHtml,
  } = helpers;
  const os = view.optionSorter;
  ensureOptionSorterDefaults(os);
  const missingPayloadCount = optMissingImagePayloadCount(os);

  // ── 정렬 화면 ──────────────────────────────────────────────────
  if (os.subStep === 'sort') {
    const assigned = os.slots.reduce((s, sl) => s + sl.imgIds.length, 0);
    const total = os.images.length;
    return `<div class="fade-in">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div>
          <h1 class="page-title" style="margin-bottom:2px">옵션 분류기</h1>
          <p style="font-size:12px;color:var(--text-m)">이미지를 드래그해서 슬롯에 배정 · ${assigned}/${total}장 배정됨${missingPayloadCount ? ` · ${missingPayloadCount}장 원본 복원 중` : ''}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-sm" id="optAddImagesBtn" ${disabledAttr(total >= 30, '옵션 이미지는 최대 30장까지 추가할 수 있습니다.')}>
            <span class="material-icons-outlined" style="font-size:15px">add_photo_alternate</span> 이미지 추가
          </button>
          <input type="file" id="optFileInput" accept="image/*" multiple style="display:none">
          <button class="btn-sm" id="optAddSlot">+ 슬롯 추가</button>
          <button class="btn-sm" id="optBackInput">← 이미지 변경</button>
          <button class="btn-primary" id="optDlAll" style="padding:6px 16px;font-size:13px">
            <span class="material-icons-outlined" style="font-size:15px">download</span> 전체 다운로드
          </button>
        </div>
      </div>

      ${renderOptionSorterSourceStrip(os)}
      ${renderOptionSorterAssignmentWorkspace(os)}
      ${renderOptionImageGeneratorPanel(os)}
    </div>`;
  }

  // ── 업로드 화면 ────────────────────────────────────────────────
  return `<div class="fade-in">
    <h1 class="page-title">옵션 분류기</h1>
    <p class="page-desc">이미지를 업로드한 후 슬롯에 마우스로 드래그해서 원하는 옵션에 직접 배정하세요. 슬롯 이름도 자유롭게 변경할 수 있습니다.</p>

    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h2 style="font-size:15px;font-weight:700">제품 이미지 업로드</h2>
        <span style="font-size:12px;color:var(--text-m)">${os.images.length}장 / 최대 30장</span>
      </div>

      ${os.images.length < 30 ? `
      <div class="opt-upload-zone" id="optUploadZone">
        <span class="material-icons-outlined" style="font-size:36px;color:var(--primary);display:block;margin-bottom:8px">add_photo_alternate</span>
        <div style="font-size:14px;font-weight:500">클릭 또는 드래그하여 이미지 추가</div>
        <div style="font-size:12px;color:var(--text-m);margin-top:4px">JPG · PNG · WEBP · 최대 30장</div>
        <input type="file" id="optFileInput" accept="image/*" multiple style="display:none">
      </div>` : `<div style="font-size:12px;color:var(--text-m);text-align:center;padding:10px">최대 30장 업로드됨</div>`}

      ${os.images.length > 0 ? `
      <div style="margin-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text-m)">${os.images.length}장 준비됨${missingPayloadCount ? ` · ${missingPayloadCount}장 원본 복원 중` : ''}</span>
          <button class="btn-sm" id="optClearImages" style="color:var(--err)">전체 삭제</button>
        </div>
        <div class="opt-img-preview-row">
          ${os.images.map(img => `
            <div class="opt-img-thumb" role="button" tabindex="0" data-opt-preview-img="${img.id}" aria-label="${escapeHtml(img.name)} 크게 보기" title="${escapeHtml(img.name)} 크게 보기">
              ${optRenderImageOrPlaceholder(img, `alt="${escapeHtml(img.name)}" loading="lazy"`, '이미지 복원 중')}
              <span class="opt-img-zoom-hint">확대</span>
              <button class="rm" data-opt-remove-img="${img.id}" title="삭제">✕</button>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- 슬롯 미리보기 + 이름 변경 -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="font-size:15px;font-weight:700">슬롯 이름 미리 설정 (선택)</h2>
        <button class="btn-sm" id="optAddSlotInput">+ 슬롯 추가</button>
      </div>
      <p style="font-size:12px;color:var(--text-m);margin-bottom:12px">기본 ${os.slots.length}개 슬롯 · 이름 클릭하여 수정 · 분류 화면에서도 변경 가능</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${os.slots.map((slot, idx) => `
          <div style="display:flex;align-items:center;gap:5px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:5px 10px">
            <span style="font-size:11px;color:var(--text-m)">${idx+1}</span>
            <input class="opt-slot-name-inp" data-slot-name="${slot.id}"
              value="${escapeHtml(slot.name)}" placeholder="이름"
              style="width:64px;font-size:12px;font-weight:600">
            <button class="opt-slot-del" data-slot-del-input="${slot.id}" title="슬롯 삭제">✕</button>
          </div>`).join('')}
      </div>
    </div>

    <button class="btn-primary" id="optGoSort"
      style="width:100%;padding:14px;font-size:15px;font-weight:700;border-radius:12px;gap:8px"
      ${disabledAttr(os.images.length === 0, '분류할 제품 이미지를 먼저 업로드해주세요.')}>
      <span class="material-icons-outlined" style="font-size:20px">style</span>
      분류 시작 · ${os.images.length}장 / ${os.slots.length}개 슬롯
    </button>
    ${os.images.length === 0 ? `<p style="text-align:center;font-size:12px;color:var(--text-m);margin-top:8px">이미지를 먼저 업로드해주세요</p>` : ''}
    ${renderOptionSorterImagePreviewModal(os)}
  </div>`;
}
