export function bindOptionSorterLayout(context) {
  const {
    activeElement, byId, queryAll, queryOne, optionSorter, requestRender,
    clampOptionSheetCount, clampOptionSheetPixels, ensureOptionSorterDefaults,
    getOptionImagePairs, getOptionOutputSheets, optApplyOptionSheetPixelPreset,
    optGetOptionSheetPixelRecommendations, optGetOptionSheetSize, optGetPixelAspectWarning,
    optGetSelectedLayoutPattern, optLayoutSummaryFromSheets, optParseLayoutPatternInput,
    optRefreshOptionSheetPixelForLayout, optRenderPatternPreview, optScheduleSave,
  } = context;

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
}
